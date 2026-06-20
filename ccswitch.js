// cc-switch shared-registry helpers — write accounts added in the extension into
// ~/.cc-switch/profiles.json so cc-switch can turn an alias into a shell command.
// Pure Node (no vscode dependency) so it is unit-testable on its own.
const fs = require('fs');
const os = require('os');
const path = require('path');

/** Prepend a leading "." to a profile name if missing (".claude-work"). */
function dotLabel(name) {
  const s = String(name || '').trim();
  return s && s[0] !== '.' ? '.' + s : s;
}

/** cc-switch config dir (honors CC_SWITCH_HOME for tests). */
function ccSwitchDir() {
  return process.env.CC_SWITCH_HOME || path.join(os.homedir(), '.cc-switch');
}

/** True if cc-switch looks installed (dir or POSIX script present). */
function ccSwitchInstalled() {
  try {
    return fs.existsSync(ccSwitchDir()) || fs.existsSync(path.join(ccSwitchDir(), 'cc-switch.sh'));
  } catch (e) { return false; }
}

/** Read the shared registry, seeding v2 or migrating v1→v2 (writes a .bak). */
function readCcRegistry() {
  const file = path.join(ccSwitchDir(), 'profiles.json');
  if (!fs.existsSync(file)) {
    return { version: 2, default: 'personal', profiles: {
      personal: { dir: null,             alias: 'ccp', desc: 'Personal account (default ~/.claude)' },
      work:     { dir: '~/.claude-work', alias: 'ccw', desc: 'Work account' } } };
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!data.version || Number(data.version) < 2) {
    fs.copyFileSync(file, file + '.bak');
    for (const [nm, al] of [['personal', 'ccp'], ['work', 'ccw']]) {
      if (data.profiles && data.profiles[nm] && !data.profiles[nm].alias) data.profiles[nm].alias = al;
    }
    data.version = 2;
  }
  return data;
}

/** Add/update one profile (+optional alias) in the shared registry. */
function ccSwitchUpsert({ name, dir, alias }) {
  try {
    const data = readCcRegistry();
    data.profiles = data.profiles || {};
    if (alias) {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(alias)) return { ok: false, error: `invalid alias '${alias}'` };
      for (const [k, p] of Object.entries(data.profiles)) {
        if (p.alias === alias && k !== name) return { ok: false, error: `alias '${alias}' already in use by '${k}'` };
      }
    }
    data.profiles[name] = { dir: dir || `~/.claude-${name}`, alias: alias || null, desc: '' };
    const d = ccSwitchDir();
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'profiles.json'), JSON.stringify(data, null, 2));
    return { ok: true };
  } catch (e) { return { ok: false, error: (e && e.message) || String(e) }; }
}

module.exports = { dotLabel, ccSwitchDir, ccSwitchInstalled, readCcRegistry, ccSwitchUpsert };
