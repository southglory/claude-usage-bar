// OAuth credential lookup for a Claude Code config dir.
//
// Claude Code stores its claude.ai OAuth token in one of two places:
//   - Linux / Windows: <config dir>/.credentials.json
//   - macOS:           the login Keychain, as a generic password whose service name is
//                      "Claude Code-credentials" for the default ~/.claude, or
//                      "Claude Code-credentials-<first 8 hex of sha256(config dir)>"
//                      when CLAUDE_CONFIG_DIR is set. The password is the same JSON
//                      that .credentials.json holds ({ claudeAiOauth: { accessToken, ... } }).
//
// The file always wins when present. On macOS we fall back to the Keychain via the
// system `security` CLI (the same tool Claude Code itself uses to write the entry, so
// reading it does not trigger an access prompt). Keychain reads are cached for a short
// TTL because the status bar asks for the token on every refresh.
// Pure Node (no vscode dependency) so it is unit-testable on its own.
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const childProcess = require('child_process');

const CREDS_FILE = '.credentials.json';
const KEYCHAIN_SERVICE = 'Claude Code-credentials';
const KEYCHAIN_TTL_MS = 60 * 1000;
const KEYCHAIN_TIMEOUT_MS = 3000;

// Injectable for tests.
const env = {
  platform: () => process.platform,
  homedir: () => os.homedir(),
  now: () => Date.now(),
  exec: (args) => childProcess.execFileSync('security', args, {
    encoding: 'utf8',
    timeout: KEYCHAIN_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'ignore'],
  }),
};

const _keychainCache = new Map(); // dir -> { ts, creds }

const stripTrailingSep = (d) => (d.length > 1 ? d.replace(/[\\/]+$/, '') : d);

/** Keychain service names to try for a config dir, most specific first. */
function keychainServices(dir) {
  const abs = stripTrailingSep(path.resolve(dir));
  const hash = crypto.createHash('sha256').update(abs).digest('hex').slice(0, 8);
  const out = [`${KEYCHAIN_SERVICE}-${hash}`];
  // ~/.claude used without CLAUDE_CONFIG_DIR is stored under the bare service name.
  if (abs === stripTrailingSep(path.join(env.homedir(), '.claude'))) out.push(KEYCHAIN_SERVICE);
  return out;
}

/** Pull { token, expiresAt } out of the credentials JSON (file or Keychain). */
function parseCreds(raw) {
  const j = JSON.parse(raw);
  const o = (j && j.claudeAiOauth) || j || {};
  return { token: o.accessToken || o.access_token || null, expiresAt: o.expiresAt || null };
}

function readFileCreds(dir) {
  try {
    return parseCreds(fs.readFileSync(path.join(dir, CREDS_FILE), 'utf8'));
  } catch (e) {
    return null;
  }
}

/** Read the macOS Keychain entry for a config dir. null when not macOS / not found. */
function readKeychainCreds(dir) {
  if (env.platform() !== 'darwin') return null;
  const hit = _keychainCache.get(dir);
  if (hit && env.now() - hit.ts < KEYCHAIN_TTL_MS) return hit.creds;
  let creds = null;
  for (const svc of keychainServices(dir)) {
    try {
      const c = parseCreds(String(env.exec(['find-generic-password', '-s', svc, '-w'])).trim());
      if (c.token) { creds = { ...c, source: 'keychain', service: svc }; break; }
    } catch (e) {
      // not found (exit 44), locked keychain, timeout, bad JSON — try the next name
    }
  }
  _keychainCache.set(dir, { ts: env.now(), creds });
  return creds;
}

/** { token, expiresAt, source } for a config dir — file first, then macOS Keychain. */
function readToken(dir) {
  const f = readFileCreds(dir);
  if (f && f.token) return { ...f, source: 'file' };
  return readKeychainCreds(dir) || { token: null, expiresAt: null, source: null };
}

/** Changes whenever the stored credentials change (re-login / token refresh), 0 if none.
 *  File: its mtime. Keychain: a short fingerprint of the token (never the token itself). */
function credStamp(dir) {
  try { return fs.statSync(path.join(dir, CREDS_FILE)).mtimeMs; } catch (e) { /* no file */ }
  const k = readKeychainCreds(dir);
  return k && k.token
    ? 'kc:' + crypto.createHash('sha256').update(k.token).digest('hex').slice(0, 12)
    : 0;
}

/** Drop the cached Keychain read for a dir (e.g. after a 401) so the next read is fresh. */
function invalidateCreds(dir) {
  _keychainCache.delete(dir);
}

module.exports = {
  CREDS_FILE,
  readToken,
  credStamp,
  invalidateCreds,
  keychainServices,
  _env: env,
  _keychainCache,
};
