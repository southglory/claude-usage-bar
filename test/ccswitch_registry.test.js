const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ccsw-'));
process.env.CC_SWITCH_HOME = path.join(tmp, '.cc-switch');
const { dotLabel, ccSwitchUpsert, readCcRegistry } = require('../ccswitch.js');

let n = 0; const ok = (c, m) => { console.log((c ? 'ok' : 'NOT OK') + ' - ' + m); if (!c) process.exitCode = 1; n++; };

// name normalization
ok(dotLabel('claude-work') === '.claude-work', 'prepends dot');
ok(dotLabel('.claude-work') === '.claude-work', 'keeps existing dot');

// create a NEW profile (dir matches no seed)
let r = ccSwitchUpsert({ name: 'demo', dir: '~/.claude-demo', alias: 'ccdemo' });
ok(r.ok, 'upsert ok');
let reg = readCcRegistry();
ok(reg.version === 2, 'registry is v2');
ok(reg.profiles['demo'].alias === 'ccdemo', 'alias stored');
ok(reg.profiles['demo'].dir === '~/.claude-demo', 'dir stored');

// dir-reuse: adding the seeded work dir reuses 'work' (no duplicate, no phantom clash)
r = ccSwitchUpsert({ name: 'claude-work', dir: '~/.claude-work', alias: 'ccw' });
ok(r.ok && r.key === 'work', 'same dir reuses seeded profile');
reg = readCcRegistry();
ok(!reg.profiles['claude-work'], 'no duplicate profile for the same dir');
ok(reg.profiles['work'].alias === 'ccw', 'reused profile keeps/sets the alias');

// duplicate alias across DIFFERENT dirs is still rejected
r = ccSwitchUpsert({ name: 'other', dir: '~/.claude-other', alias: 'ccdemo' });
ok(!r.ok && /in use|already/.test(r.error || ''), 'duplicate alias across dirs rejected');

// migration: hand-write a v1 file, then upsert must migrate
fs.writeFileSync(path.join(process.env.CC_SWITCH_HOME, 'profiles.json'),
  '{"version":1,"default":"personal","profiles":{"personal":{"dir":null,"desc":"p"},"work":{"dir":"~/.claude-work","desc":"w"}}}');
r = ccSwitchUpsert({ name: 'team', dir: '~/.claude-team', alias: 'cct' });
reg = readCcRegistry();
ok(reg.version === 2, 'migrated to v2');
ok(reg.profiles['personal'].alias === 'ccp' && reg.profiles['work'].alias === 'ccw', 'defaults backfilled');
ok(fs.existsSync(path.join(process.env.CC_SWITCH_HOME, 'profiles.json.bak')), 'backup written');
ok(reg.profiles['team'].alias === 'cct', 'new profile added during migration');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${n} assertions`);
