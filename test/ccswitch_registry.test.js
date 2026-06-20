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

// upsert creates v2 registry with profile + alias (ccw is seeded for 'work', so use ccwork)
let r = ccSwitchUpsert({ name: 'claude-work', dir: '~/.claude-work', alias: 'ccwork' });
ok(r.ok, 'upsert ok');
let reg = readCcRegistry();
ok(reg.version === 2, 'registry is v2');
ok(reg.profiles['claude-work'].alias === 'ccwork', 'alias stored');
ok(reg.profiles['claude-work'].dir === '~/.claude-work', 'dir stored');

// duplicate alias rejected
r = ccSwitchUpsert({ name: 'other', dir: '~/.claude-other', alias: 'ccwork' });
ok(!r.ok && /in use|already/.test(r.error || ''), 'duplicate alias rejected');

// alias collides with a seeded default (work→ccw) → also rejected, with a clear owner
r = ccSwitchUpsert({ name: 'mywork', dir: '~/.claude-mywork', alias: 'ccw' });
ok(!r.ok && /work/.test(r.error || ''), 'seeded-default alias collision reported');

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
