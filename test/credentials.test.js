const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const creds = require('../credentials.js');
const { readToken, credStamp, invalidateCreds, keychainServices, _env, _keychainCache } = creds;

let n = 0; const ok = (c, m) => { console.log((c ? 'ok' : 'NOT OK') + ' - ' + m); if (!c) process.exitCode = 1; n++; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccred-'));
const home = path.join(tmp, 'home');
fs.mkdirSync(home);
const json = (tok) => JSON.stringify({ claudeAiOauth: { accessToken: tok, expiresAt: 123 } });
const svcFor = (d) => 'Claude Code-credentials-' + crypto.createHash('sha256').update(d).digest('hex').slice(0, 8);

// fake macOS + fake Keychain
let platform = 'darwin', now = 1000, calls = [];
const keychain = new Map();
_env.platform = () => platform;
_env.homedir = () => home;
_env.now = () => now;
_env.exec = (args) => {
  calls.push(args);
  const svc = args[args.indexOf('-s') + 1];
  if (!keychain.has(svc)) { const e = new Error('not found'); e.status = 44; throw e; }
  return keychain.get(svc) + '\n';
};
const reset = () => { _keychainCache.clear(); calls = []; };

// service-name derivation matches Claude Code (sha256 of the config dir, 8 hex)
const work = path.join(home, '.claude-work');
fs.mkdirSync(work);
ok(keychainServices(work)[0] === svcFor(work), 'hashed service name for a custom dir');
ok(keychainServices(work + '/')[0] === svcFor(work), 'trailing slash ignored');
ok(keychainServices(work).length === 1, 'custom dir has no bare-name fallback');
const def = path.join(home, '.claude');
ok(JSON.stringify(keychainServices(def)) === JSON.stringify([svcFor(def), 'Claude Code-credentials']), 'default ~/.claude also tries the bare service name');

// success: token found in the Keychain
keychain.set(svcFor(work), json('tok-A'));
reset();
let t = readToken(work);
ok(t.token === 'tok-A' && t.expiresAt === 123 && t.source === 'keychain', 'reads token from the Keychain');

// caching: second read within the TTL does not shell out again
calls = [];
readToken(work);
ok(calls.length === 0, 'Keychain read is cached within the TTL');
now += 61 * 1000;
readToken(work);
ok(calls.length === 1, 'Keychain re-read after the TTL');

// invalidate forces a fresh read and picks up a refreshed token
keychain.set(svcFor(work), json('tok-B'));
invalidateCreds(work);
ok(readToken(work).token === 'tok-B', 'invalidateCreds picks up a refreshed token');

// stamp: changes with the token, never contains the token
reset();
keychain.set(svcFor(work), json('tok-B'));
const s1 = credStamp(work);
keychain.set(svcFor(work), json('tok-C'));
invalidateCreds(work);
const s2 = credStamp(work);
ok(typeof s1 === 'string' && s1 !== s2, 'credStamp changes when the Keychain token changes');
ok(!String(s1).includes('tok-B'), 'credStamp does not leak the token');

// default dir: falls back to the bare service name
reset();
fs.mkdirSync(def);
keychain.set('Claude Code-credentials', json('tok-default'));
ok(readToken(def).token === 'tok-default', 'default ~/.claude uses the bare service name');

// file wins over the Keychain
reset();
fs.writeFileSync(path.join(work, '.credentials.json'), json('tok-file'));
t = readToken(work);
ok(t.token === 'tok-file' && t.source === 'file', '.credentials.json takes precedence');
ok(calls.length === 0, 'no Keychain call when the file has a token');
ok(typeof credStamp(work) === 'number' && credStamp(work) > 0, 'credStamp is the file mtime when the file exists');
fs.unlinkSync(path.join(work, '.credentials.json'));

// failure: no entry → null token, negative result cached
reset();
const none = path.join(home, '.claude-none');
t = readToken(none);
ok(t.token === null && t.source === null, 'missing Keychain entry → no token');
ok(credStamp(none) === 0, 'credStamp is 0 with no credentials');
ok(calls.length === 1, 'negative Keychain result is cached too');

// failure: garbage in the Keychain → treated as missing, no throw
reset();
keychain.set(svcFor(work), 'not json');
ok(readToken(work).token === null, 'malformed Keychain JSON → no token, no throw');

// edge: Keychain locked / security times out → no token, no throw
reset();
const realExec = _env.exec;
_env.exec = () => { const e = new Error('ETIMEDOUT'); e.code = 'ETIMEDOUT'; throw e; };
ok(readToken(work).token === null, 'security timeout → no token, no throw');
_env.exec = realExec;

// non-macOS: never touches the Keychain
reset();
platform = 'linux';
keychain.set(svcFor(work), json('tok-A'));
ok(readToken(work).token === null && calls.length === 0, 'non-macOS never calls security');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} checks`);
