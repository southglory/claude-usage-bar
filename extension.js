// Claude Multi-Account Usage — VS Code status bar extension.
// Per account, usage comes from one of two sources, in order:
//   1) <config dir>/vscode-claude-status-cache.json — the cache the Claude Code
//      VS Code integration writes, but ONLY for the one account it polls.
//   2) the Anthropic API — read <config dir>/.credentials.json's OAuth token and
//      GET the rate-limit response headers (the method long-kudo.vscode-claude-status
//      uses). This works for ANY account, including ones used only in a terminal.
'use strict';

const vscode = require('vscode');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { dotLabel, ccSwitchUpsert, ccSwitchInstalled } = require('./ccswitch');

const CACHE_FILE = 'vscode-claude-status-cache.json';
const CREDS_FILE = '.credentials.json';
const CFG = 'claudeMultiUsage';
const FALLBACK_FRAMES = ['$(quokka-0)', '$(quokka-1)'];

/** Expand ~ and environment variables (%VAR% / ${env:VAR}) to a real path. */
function expandDir(dir) {
  let d = String(dir || '').trim();
  if (d === '~' || d.startsWith('~/') || d.startsWith('~\\')) {
    d = path.join(os.homedir(), d.slice(1));
  }
  d = d.replace(/%([^%]+)%/g, (_, n) => process.env[n] || '')
       .replace(/\$\{?env:?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, n) => process.env[n] || '');
  return path.normalize(d);
}

/** Default label = the folder name as-is (".claude", ".claude-work"). No parsing /
 *  stripping — the user names accounts freely and we never impose a convention. */
function labelFromDir(name) {
  return path.basename(name) || 'claude';
}

/** Auto-detect .claude* dirs in the home folder (those with projects/ or a cache file). */
function discoverAccounts() {
  const home = os.homedir();
  let entries;
  try {
    entries = fs.readdirSync(home, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() && !e.isSymbolicLink()) continue;
    if (!/^\.claude($|[-_].*)/.test(e.name)) continue;
    const dir = path.join(home, e.name);
    const hasData =
      fs.existsSync(path.join(dir, 'projects')) ||
      fs.existsSync(path.join(dir, CACHE_FILE));
    if (!hasData) continue;
    out.push({ label: labelFromDir(e.name), dir: '~/' + e.name });
  }
  out.sort((a, b) => a.dir.localeCompare(b.dir)); // stable index order
  return out;
}

/** Read <dir>/vscode-claude-status-cache.json and return its usageData (null if missing). */
function readUsage(dir) {
  const file = path.join(dir, CACHE_FILE);
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const json = JSON.parse(raw);
    return { file, data: json.usageData || null, updatedAt: json.updatedAt || null };
  } catch (e) {
    return { file, data: null, updatedAt: null, error: e.code || String(e.message || e) };
  }
}

/** Read <dir>/.credentials.json -> { token, expiresAt } (claudeAiOauth.accessToken). */
function readToken(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, CREDS_FILE), 'utf8'));
    const o = j.claudeAiOauth || j;
    return { token: o.accessToken || o.access_token || null, expiresAt: o.expiresAt || null };
  } catch (e) {
    return { token: null, expiresAt: null };
  }
}

/** mtime (ms) of <dir>/.credentials.json, or 0 if missing — used to detect a re-login. */
function credMtime(dir) {
  try { return fs.statSync(path.join(dir, CREDS_FILE)).mtimeMs; } catch (e) { return 0; }
}

const norm01 = (x) => {
  const n = parseFloat(x);
  return isNaN(n) ? null : n > 1 ? n / 100 : n;   // header may be percent (0..100) or fraction
};
const toEpochSec = (x) => {
  if (x == null) return null;
  const n = Number(x);
  if (!isNaN(n) && x !== '') return n > 1e12 ? Math.round(n / 1000) : Math.round(n); // ms vs s
  const t = Date.parse(x);
  return isNaN(t) ? null : Math.round(t / 1000);
};

/** Fetch usage for a config dir straight from the Anthropic API using the account's
 *  OAuth token, reading the rate-limit response headers. Promise<usageData>. This is
 *  how long-kudo.vscode-claude-status does it — no cache file needed, works for any
 *  account. Sends a 1-token message request (minimal) just to read the headers. */
function fetchUsageViaApi(dir) {
  return new Promise((resolve, reject) => {
    const { token } = readToken(dir);
    if (!token) return reject(new Error('no-credentials'));
    // OAuth (claude.ai subscription) tokens only accept current models; an unknown
    // model 404s. Use the small current Haiku, like long-kudo does.
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1,
      messages: [{ role: 'user', content: '.' }],
    });
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          authorization: `Bearer ${token}`,
          'anthropic-version': '2023-06-01',
          'anthropic-beta': 'oauth-2025-04-20',
        },
      },
      (res) => {
        const h = res.headers;
        res.on('data', () => {}); // drain
        res.on('end', () => {
          const u5 = h['anthropic-ratelimit-unified-5h-utilization'];
          const u7 = h['anthropic-ratelimit-unified-7d-utilization'];
          if (u5 == null && u7 == null) return reject(new Error('http-' + res.statusCode));
          resolve({
            utilization5h: norm01(u5),
            utilization7d: norm01(u7),
            reset5hAt: toEpochSec(h['anthropic-ratelimit-unified-5h-reset']),
            reset7dAt: toEpochSec(h['anthropic-ratelimit-unified-7d-reset']),
            limitStatus: h['anthropic-ratelimit-unified-5h-status'] || 'allowed',
          });
        });
      }
    );
    req.on('error', reject);
    req.setTimeout(10000, () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

function pct(x) {
  if (typeof x !== 'number' || isNaN(x)) return null;
  return Math.round(x * 100);
}

/** Usage -> chart color (text color, no background swap): green < warn, yellow < crit, red. */
function colorFor(util, warnAt, critAt) {
  if (typeof util !== 'number') return undefined;
  if (util >= critAt) return new vscode.ThemeColor('charts.red');
  if (util >= warnAt) return new vscode.ThemeColor('charts.yellow');
  return new vscode.ThemeColor('charts.green');
}

/** 0..1 ratio -> whole-cell progress bar ("██████▒▒"). Filled (█) and empty (▒) are
 *  both full-cell block glyphs of the same height, so the whole bar is a clean
 *  rectangle (no ragged half-width edge, no short dotted ░ tail). */
const FILL = '█', EMPTY = '▒';
function bar(p, len) {
  const v = Math.max(0, Math.min(1, typeof p === 'number' ? p : 0));
  const n = Math.max(0, Math.min(len, Math.round(v * len)));
  return FILL.repeat(n) + EMPTY.repeat(len - n);
}

/** Colored bar for the HTML tooltip. Every cell is the SAME █ glyph (so all cells
 *  are exactly the same height — a clean rectangle), distinguished only by color:
 *  filled cells take the usage color, empty cells a dim gray. This avoids the
 *  height mismatch you get from mixing █ with the shorter ░/▒ shade glyphs. */
function barHtml(p, len, warnAt, critAt) {
  const v = Math.max(0, Math.min(1, typeof p === 'number' ? p : 0));
  const n = Math.max(0, Math.min(len, Math.round(v * len)));
  const fill = typeof p !== 'number' ? '#888'
    : v >= critAt ? '#f14c4c' : v >= warnAt ? '#cca700' : '#3fb950';
  let s = '';
  for (let i = 0; i < len; i++) {
    s += `<span style="color:${i < n ? fill : '#5a5a5a'};">█</span>`;
  }
  return s;
}

/** epoch (seconds) -> absolute reset time: time-of-day if within a day, else date+time. */
function resetAt(epochSec) {
  if (!epochSec) return '?';
  const d = new Date(epochSec * 1000);
  return epochSec * 1000 - Date.now() < 24 * 3600 * 1000
    ? d.toLocaleTimeString()
    : d.toLocaleString();
}

/** epoch (seconds) -> short remaining time "1h 23m" / "12m". */
function remain(epochSec) {
  const diff = (epochSec || 0) * 1000 - Date.now();
  if (diff <= 0) return 'now';
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

/** Decode a Claude Code project dir (cwd with `/`, `\`, `:`, `_` all replaced by '-')
 *  to a short label. We can't recover which '-' was an underscore, so show the last
 *  two segments (e.g. "AXO-enterprise-agents-AXO-leader" -> "AXO-leader"). */
function decodeProject(name) {
  const parts = String(name).split('-').filter(Boolean);
  return parts.length ? parts.slice(-2).join('-') : String(name);
}

/** Scan the JSONL session logs under <dir>/projects and aggregate token cost by time
 *  window, project, day and hour. Cost = token counts × pricing — the same method ccusage / long-910
 *  use. It is the API-equivalent dollar value of the tokens (one price tier for all
 *  models), NOT your real subscription bill. Token counts are exact. Heavy: caller
 *  must throttle/cache. Only files touched within 30 days are read. */
function scanCost(dir, pricing, now) {
  const root = path.join(dir, 'projects');
  const res = {
    cost1h: 0, cost5h: 0, costToday: 0, cost7d: 0, cost30d: 0,
    tok5h: { in: 0, out: 0, cr: 0, cc: 0 },
    byProject: {}, byDay: {}, byHour: new Array(24).fill(0),
    first5hTs: 0, lastTs: 0,
  };
  let projects;
  try { projects = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return res; }
  const startToday = new Date(now); startToday.setHours(0, 0, 0, 0);
  const startTodayMs = startToday.getTime();
  const H = 3600000, ms5h = 5 * H, ms7d = 7 * 24 * H, ms30d = 30 * 24 * H;
  const costOf = (u) =>
    ((u.input_tokens || 0) * pricing.in + (u.output_tokens || 0) * pricing.out
      + (u.cache_read_input_tokens || 0) * pricing.cr
      + (u.cache_creation_input_tokens || 0) * pricing.cc) / 1e6;
  for (const pd of projects) {
    if (!pd.isDirectory()) continue;
    const proj = decodeProject(pd.name);
    const pdir = path.join(root, pd.name);
    let files;
    try { files = fs.readdirSync(pdir); } catch (e) { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const fp = path.join(pdir, f);
      let st;
      try { st = fs.statSync(fp); } catch (e) { continue; }
      if (now - st.mtimeMs > ms30d) continue;
      let text;
      try { text = fs.readFileSync(fp, 'utf8'); } catch (e) { continue; }
      let start = 0;
      while (start < text.length) {
        let end = text.indexOf('\n', start);
        if (end < 0) end = text.length;
        const line = text.slice(start, end);
        start = end + 1;
        if (!line) continue;
        let j;
        try { j = JSON.parse(line); } catch (e) { continue; }
        const u = (j.message && j.message.usage) || j.usage;
        if (!u) continue;
        const ts = Date.parse(j.timestamp || (j.message && j.message.timestamp) || '');
        if (!ts) continue;
        const c = costOf(u);
        const age = now - ts;
        if (age <= ms30d) res.cost30d += c;
        if (age <= ms7d) res.cost7d += c;
        if (ts >= startTodayMs) res.costToday += c;
        if (age <= H) res.cost1h += c;
        if (age <= ms5h) {
          res.cost5h += c;
          res.tok5h.in += u.input_tokens || 0;
          res.tok5h.out += u.output_tokens || 0;
          res.tok5h.cr += u.cache_read_input_tokens || 0;
          res.tok5h.cc += u.cache_creation_input_tokens || 0;
          if (!res.first5hTs || ts < res.first5hTs) res.first5hTs = ts;
        }
        const p = res.byProject[proj] || (res.byProject[proj] = { today: 0, d7: 0, d30: 0 });
        if (age <= ms30d) p.d30 += c;
        if (age <= ms7d) p.d7 += c;
        if (ts >= startTodayMs) p.today += c;
        const d = new Date(ts);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        res.byDay[key] = (res.byDay[key] || 0) + c;
        res.byHour[d.getHours()] += c;
        if (ts > res.lastTs) res.lastTs = ts;
      }
    }
  }
  return res;
}

/** True if any session log under <dir>/projects was modified within `withinMs` —
 *  i.e. Claude Code was used on this account recently. Cheap (stat only, early-out). */
function recentlyActive(dir, withinMs) {
  const root = path.join(dir, 'projects');
  const cutoff = Date.now() - withinMs;
  let pds;
  try { pds = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { return false; }
  for (const pd of pds) {
    if (!pd.isDirectory()) continue;
    let files;
    try { files = fs.readdirSync(path.join(root, pd.name)); } catch (e) { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      try { if (fs.statSync(path.join(root, pd.name, f)).mtimeMs >= cutoff) return true; } catch (e) {}
    }
  }
  return false;
}

class Bar {
  constructor() {
    /** @type {vscode.StatusBarItem[]} */
    this.items = [];
    this.timer = null;
    this.animTimer = null;
    this.animFrame = 0;
    this.panel = null;   // dashboard webview (singleton)
    this._snap = [];     // latest snapshot for the dashboard
    this.showChar = true;
    this.frames = FALLBACK_FRAMES.slice();
    this._api = {};      // dir -> { data, updatedAt, ts, pending, error } (API-fetched usage)
    this._cost = {};     // dir -> { data, ts, pending } (scanned token cost)
  }

  config() {
    const c = vscode.workspace.getConfiguration(CFG);
    let accounts = c.get('accounts') || [];
    if (!accounts.length) accounts = discoverAccounts(); // auto-detect when empty
    return {
      accounts,
      interval: (c.get('refreshIntervalSeconds') || 30) * 1000,
      warnAt: c.get('warnAt', 0.5),
      critAt: c.get('critAt', 0.9),
      barLen: c.get('progressBarLength', 8),
      show7d: c.get('show7d', true),
      showChar: c.get('showCharacter', true),
      anim: c.get('enableAnimation', true),
      animMs: c.get('animationPeriodMs', 2000),
      frames: c.get('characterFrames', FALLBACK_FRAMES.slice()),
      launchCommand: c.get('launchCommand', 'claude'),
      clickAction: c.get('clickAction', 'refresh'),
      apiFallback: c.get('fetchUsageViaApi', true),
      apiMinInterval: (c.get('apiMinIntervalSeconds', 300)) * 1000,
      pricing: {
        in: c.get('pricing.inputPerMillion', 3),
        out: c.get('pricing.outputPerMillion', 15),
        cr: c.get('pricing.cacheReadPerMillion', 0.3),
        cc: c.get('pricing.cacheCreatePerMillion', 3.75),
      },
      dailyBudget: c.get('dailyBudget', 0),
    };
  }

  /** Throttled background token-cost scan for an account. Stores the result in
   *  this._cost[dir] and re-renders the dashboard when done. */
  ensureCost(dir, pricing, interval) {
    const slot = this._cost[dir] || (this._cost[dir] = {});
    if (slot.pending) return;
    if (slot.ts && Date.now() - slot.ts < Math.max(30000, interval)) return; // throttle
    slot.pending = true;
    Promise.resolve()
      .then(() => scanCost(dir, pricing, Date.now()))
      .then((data) => { slot.data = data; })
      .catch((e) => { slot.error = (e && e.message) || String(e); })
      .finally(() => { slot.pending = false; slot.ts = Date.now(); this.updateDashboard(); });
  }

  /** Background API fetch for an account with no cache file — kept deliberately
   *  light: at most once per `minIntervalMs` (default 5 min), and once we already
   *  have a reading we only refetch when the account was actually used within that
   *  window. So when you stop using Claude Code, the API calls stop too. */
  ensureApiUsage(dir, minIntervalMs, force) {
    const slot = this._api[dir] || (this._api[dir] = {});
    if (slot.pending) return;   // a fetch is already in flight — never double-fire
    const now = Date.now();
    // A re-login rewrites .credentials.json. Detect it so a stale throttle from a
    // pre-login failed attempt doesn't block the fresh token for up to minIntervalMs.
    const credTs = credMtime(dir);
    const credChanged = !!credTs && credTs !== slot.credTs;
    // Once a rate-limit window has actually reset (day/window rollover), our cached
    // utilization is stale even while idle.
    const resetPassed = !!slot.data &&
      ((slot.data.reset5hAt && now >= slot.data.reset5hAt * 1000) ||
       (slot.data.reset7dAt && now >= slot.data.reset7dAt * 1000));
    if (!force) {
      if (slot.ts && now - slot.ts < minIntervalMs && !credChanged) return;                  // throttle
      if (slot.data && !recentlyActive(dir, minIntervalMs) && !resetPassed && !credChanged) return; // idle → don't poll
    }
    slot.pending = true;
    fetchUsageViaApi(dir)
      .then((data) => { slot.data = data; slot.updatedAt = new Date().toISOString(); slot.error = null; })
      .catch((e) => { slot.error = (e && e.message) || String(e); })
      .finally(() => { slot.pending = false; slot.ts = Date.now(); slot.credTs = credMtime(dir); this.refresh(); });
  }

  /** Recreate one StatusBarItem per account. */
  rebuild() {
    this.items.forEach((i) => i.dispose());
    this.items = [];
    const { accounts, clickAction } = this.config();
    const cmd = clickAction === 'launch' ? 'claudeMultiUsage.launch'
      : clickAction === 'openCache' ? 'claudeMultiUsage.openCache'
      : clickAction === 'refresh' ? 'claudeMultiUsage.refresh'
      : 'claudeMultiUsage.openDashboard';
    // Descending priority so items keep the configured left-to-right order.
    accounts.forEach((_, idx) => {
      const item = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100 - idx
      );
      // Pass the account index as the click argument.
      item.command = { command: cmd, title: 'Claude', arguments: [idx] };
      this.items.push(item);
    });
  }

  /** Open a terminal for the given account index.
   *  - command set (e.g. ccw/ccp): run that wrapper as-is, no env injection (same as a normal terminal).
   *  - not set: inject CLAUDE_CONFIG_DIR, then run launchCommand (default "claude"). */
  launch(idx) {
    const { accounts, launchCommand } = this.config();
    const acc = accounts[idx];
    if (!acc) return;
    const wrapper = (acc.command || '').trim();
    const name = `Claude · ${acc.label || acc.dir}`;
    // Reuse an existing terminal with the same name.
    const existing = vscode.window.terminals.find((t) => t.name === name);
    const opts = { name };
    if (!wrapper) opts.env = { CLAUDE_CONFIG_DIR: expandDir(acc.dir) };
    const term = existing || vscode.window.createTerminal(opts);
    term.show();
    if (!existing) {
      const cmd = wrapper || (launchCommand || '').trim();
      if (cmd) term.sendText(cmd);
    }
  }

  /** Pick an account via QuickPick, then launch it. */
  async pickAndLaunch() {
    const { accounts } = this.config();
    if (!accounts.length) return;
    const picked = await vscode.window.showQuickPick(
      accounts.map((a, i) => ({
        label: `$(rocket) ${a.label || a.dir}`,
        description: expandDir(a.dir),
        idx: i,
      })),
      { placeHolder: 'Select a Claude account to open a terminal for' }
    );
    if (picked) this.launch(picked.idx);
  }

  /** Accounts stored in settings (fall back to the detected list, made explicit). */
  storedAccounts() {
    const cur = vscode.workspace.getConfiguration(CFG).get('accounts') || [];
    return cur.length ? cur.slice() : discoverAccounts();
  }

  async saveAccounts(next) {
    await vscode.workspace
      .getConfiguration(CFG)
      .update('accounts', next, vscode.ConfigurationTarget.Global);
  }

  /** Add an account: pick from auto-detected list or enter manually, with a free label. */
  async addAccount() {
    const cur = this.storedAccounts();
    const seen = new Set(cur.map((a) => expandDir(a.dir)));
    const items = discoverAccounts()
      .filter((d) => !seen.has(expandDir(d.dir)))
      .map((d) => ({ label: `$(folder) ${d.label}`, description: d.dir, acc: d }));
    items.push({ label: '$(edit) Enter manually…', description: '', acc: null });

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: 'Account to add (auto-detected)',
    });
    if (!pick) return;

    let dir, label;
    if (pick.acc) {
      dir = pick.acc.dir;
      label = pick.acc.label;
    } else {
      dir = await vscode.window.showInputBox({
        prompt: 'CLAUDE_CONFIG_DIR path',
        placeHolder: '~/.claude-<name>',
      });
      if (!dir) return;
      label = labelFromDir(dir);
    }
    label = await vscode.window.showInputBox({ prompt: 'Display label', value: label });
    if (label == null) return;

    const command = await vscode.window.showInputBox({
      prompt: 'Launch command (empty = inject CLAUDE_CONFIG_DIR + claude). To use a cc-switch wrapper as-is, enter ccw/ccp.',
      placeHolder: 'e.g. ccw / ccp / empty',
    });
    if (command == null) return; // ESC = cancel

    const acc = { label: label.trim() || label, dir: dir.trim() };
    if (command.trim()) acc.command = command.trim();
    await this.saveAccounts([...cur, acc]);
    vscode.window.showInformationMessage(
      `Added Claude account: ${acc.label} (${acc.dir}${acc.command ? ', ' + acc.command : ''})`
    );
  }

  /** Add an account straight from the dashboard form: free label + dir, optionally
   *  open a terminal for the first login. No name parsing — the label is whatever
   *  the user typed (defaults to the folder name as-is). */
  async addFromDashboard(label, dir, login) {
    dir = (dir || '').trim();
    if (!dir) {
      vscode.window.showWarningMessage('Enter a config directory (e.g. ~/.claude-work).');
      return;
    }
    label = (label || '').trim() || labelFromDir(dir);
    const cur = this.storedAccounts();
    const exists = cur.some((a) => expandDir(a.dir) === expandDir(dir));
    if (!exists) {
      await this.saveAccounts([...cur, { label, dir }]);
      this.rebuild();
      this.refresh();
    }
    const idx = this.storedAccounts().findIndex((a) => expandDir(a.dir) === expandDir(dir));
    vscode.window.showInformationMessage(
      `${exists ? 'Account exists' : 'Added account'}: ${label} (${dir})`
    );
    if (login && idx >= 0) this.loginAccount(idx);
  }

  /** First-login helper: open a terminal with this account's CLAUDE_CONFIG_DIR set
   *  and run the launch command, so a brand-new directory prompts for login. Always
   *  injects env + runs launchCommand (ignores any cc-switch wrapper) for a clean
   *  first auth. */
  loginAccount(idx) {
    const { accounts, launchCommand } = this.config();
    const acc = accounts[idx];
    if (!acc) return;
    const name = `Claude login · ${acc.label || acc.dir}`;
    const term = vscode.window.terminals.find((t) => t.name === name)
      || vscode.window.createTerminal({ name, env: { CLAUDE_CONFIG_DIR: expandDir(acc.dir) } });
    term.show();
    const cmd = (launchCommand || 'claude').trim();
    if (cmd) term.sendText(cmd);
    vscode.window.showInformationMessage(
      `Logging in "${acc.label || acc.dir}" — complete the login in the opened terminal.`
    );
  }

  /** Remove the account at idx (used by the dashboard trash button). */
  async removeByIndex(idx) {
    const cur = this.storedAccounts();
    if (idx < 0 || idx >= cur.length) return;
    const removed = cur[idx];
    await this.saveAccounts(cur.filter((_, i) => i !== idx));
    this.rebuild();
    this.refresh();
    vscode.window.showInformationMessage(`Removed account: ${removed.label || removed.dir}`);
  }

  /** Remove an account. */
  async removeAccount() {
    const cur = this.storedAccounts();
    if (!cur.length) return;
    const pick = await vscode.window.showQuickPick(
      cur.map((a, i) => ({ label: a.label, description: expandDir(a.dir), idx: i })),
      { placeHolder: 'Account to remove' }
    );
    if (!pick) return;
    await this.saveAccounts(cur.filter((_, i) => i !== pick.idx));
    vscode.window.showInformationMessage(`Removed Claude account: ${pick.label}`);
  }

  refresh(force) {
    const { accounts, warnAt, critAt, show7d, barLen, showChar, frames, apiFallback, apiMinInterval } = this.config();
    this.showChar = showChar;
    this.frames = frames && frames.length ? frames : FALLBACK_FRAMES.slice();
    if (accounts.length !== this.items.length) this.rebuild();
    const deco = (b) =>
      (showChar && this.frames.length ? this.frames[this.animFrame % this.frames.length] + ' ' : '') + b;
    const snap = [];

    accounts.forEach((acc, idx) => {
      const item = this.items[idx];
      if (!item) return;
      const dir = expandDir(acc.dir);
      let { data, updatedAt, file, error } = readUsage(dir);
      const label = acc.label || acc.dir;
      item.__file = file;
      let source = data ? 'cache' : null;

      // No cache file (e.g. a second account used only in a terminal): fall back to
      // fetching usage straight from the API, the way long-kudo does.
      const slot = this._api[dir];
      if (!data && apiFallback) {
        if (slot && slot.data) { data = slot.data; updatedAt = slot.updatedAt; source = 'api'; }
        if (readToken(dir).token) this.ensureApiUsage(dir, apiMinInterval, force); // refresh in background (polite)
      }

      if (!data) {
        const hasCreds = !!readToken(dir).token;
        const fetching = apiFallback && hasCreds && slot && slot.pending;
        const body = `${label} ${fetching ? '…' : '—'}`;
        item.__body = body;
        item.text = deco(body);
        item.color = undefined;
        item.backgroundColor = undefined;
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.appendMarkdown(`**${label}** · no usage yet\n\n`);
        if (apiFallback && hasCreds) {
          md.appendMarkdown(slot && slot.error
            ? `API fetch failed: \`${slot.error}\` (token may be expired — log in again).\n\n`
            : `Fetching usage from the API…\n\n`);
        } else if (apiFallback && !hasCreds) {
          md.appendMarkdown(`No \`${CREDS_FILE}\` in this dir — **Log in** to create it.\n\n`);
        } else {
          md.appendMarkdown(error === 'ENOENT'
            ? `No cache file; enable \`fetchUsageViaApi\` or run a session.\n\n`
            : `Read error: \`${error}\`\n\n`);
        }
        md.appendMarkdown(`\`${dir}\`\n\n`);
        md.appendMarkdown(this.menuLinks(idx));
        item.tooltip = md;
        item.show();
        snap.push({ idx, label, dir, none: true, error: slot && slot.error });
        return;
      }

      const u5 = data.utilization5h;
      const u7 = data.utilization7d;
      const p5 = pct(u5);
      const p7 = pct(u7);
      const blocked = data.limitStatus && data.limitStatus !== 'allowed';
      const lvl = Math.max(typeof u5 === 'number' ? u5 : 0, typeof u7 === 'number' ? u7 : 0);

      // Progress-bar form: "personal ██████▒ 52% · 36%". When a window is exhausted
      // (or blocked) the bar flips to a reset countdown for whichever window is full —
      // including 7d, even though the bar normally tracks 5h.
      const u5full = typeof u5 === 'number' && u5 >= 1;
      const u7full = typeof u7 === 'number' && u7 >= 1;
      let body;
      if (blocked || u5full) {
        body = `${label} ${bar(1, barLen)} 5h reset ${remain(data.reset5hAt)}`;
      } else if (u7full) {
        body = `${label} ${bar(1, barLen)} 7d reset ${remain(data.reset7dAt)}`;
      } else {
        body = `${label} ${bar(u5, barLen)} ${p5 == null ? '?' : p5 + '%'}`;
        if (show7d && p7 != null) body += ` · ${p7}%`;
      }
      item.__body = body;
      item.text = deco(body);
      // Color reflects the WORSE of 5h/7d. At critical (>= critAt or blocked) add a bold
      // background badge so a maxed 7d is unmissable even though the bar shows 5h.
      const critical = blocked || lvl >= critAt;
      item.color = critical
        ? new vscode.ThemeColor('statusBarItem.errorForeground')
        : colorFor(lvl, warnAt, critAt);
      // Badge only at critical (a warn-tier badge from ~50% would be too noisy);
      // the warn tier just tints the text yellow.
      item.backgroundColor = critical
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : undefined;

      const md = new vscode.MarkdownString();
      md.isTrusted = true;
      md.supportHtml = true; // colored █ bars render at a uniform height
      md.appendMarkdown(`**${label}** — Claude usage\n\n`);
      const row = (lab, p, b, reset) =>
        `${lab} ${barHtml(b, barLen, warnAt, critAt)} ${(p ?? '?')}%<br>`
        + `&nbsp;&nbsp;&nbsp;resets at ${resetAt(reset)} · time until reset ${remain(reset)}<br>`;
      md.appendMarkdown(row('5h', p5, u5, data.reset5hAt));
      md.appendMarkdown(row('7d', p7, u7, data.reset7dAt));
      if (blocked) md.appendMarkdown(`\n\n⚠ limit status: \`${data.limitStatus}\``);
      const src = source === 'api' ? 'via API' : 'via cache';
      md.appendMarkdown(`\n\n_${src}${updatedAt ? ' · updated ' + new Date(updatedAt).toLocaleTimeString() : ''}_`);
      md.appendMarkdown(`\n\n_Left-click → refresh_\n\n${this.menuLinks(idx)}`);
      item.tooltip = md;
      item.show();
      snap.push({
        idx, label, dir, p5, p7, blocked, source,
        status: data.limitStatus, reset5hAt: data.reset5hAt, reset7dAt: data.reset7dAt, updatedAt,
      });
    });

    this._snap = snap;
    this.updateDashboard();
  }

  /** Clickable command links for the hover tooltip (a stand-in for a right-click menu). */
  menuLinks(idx) {
    const a = encodeURIComponent(JSON.stringify([idx]));
    return `[Dashboard](command:claudeMultiUsage.openDashboard) · `
      + `[Terminal](command:claudeMultiUsage.launch?${a}) · `
      + `[Cache](command:claudeMultiUsage.openCache?${a}) · `
      + `[Settings](command:claudeMultiUsage.openSettings)`;
  }

  /** Breathing animation: keep the body text, only swap the mascot frame (cheap). */
  tick() {
    if (!this.showChar || !this.frames || this.frames.length < 2) return;
    this.animFrame = (this.animFrame + 1) % this.frames.length;
    const f = this.frames[this.animFrame];
    for (const item of this.items) {
      if (item.__body != null) item.text = f + ' ' + item.__body;
    }
  }

  /** Open the usage dashboard webview (all accounts, bars/resets + refresh/terminal/cache buttons). */
  openDashboard() {
    if (this.panel) {
      this.panel.reveal();
      this.updateDashboard();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      'claudeMultiUsage', 'Claude Usage', vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.onDidDispose(() => { this.panel = null; });
    this.panel.webview.onDidReceiveMessage((m) => {
      if (!m) return;
      if (m.type === 'refresh') this.refresh(true);
      else if (m.type === 'launch') this.launch(m.idx);
      else if (m.type === 'login') this.loginAccount(m.idx);
      else if (m.type === 'add') this.addFromDashboard(m.label, m.dir, m.login);
      else if (m.type === 'remove') this.removeByIndex(m.idx);
      else if (m.type === 'openSettings') {
        vscode.commands.executeCommand('workbench.action.openSettings',
          m.query || '@ext:QG-devramyun.claude-multi-usage');
      }
      else if (m.type === 'openCache') {
        const f = this.items[m.idx] && this.items[m.idx].__file;
        if (f) vscode.window.showTextDocument(vscode.Uri.file(f));
      }
    });
    this.refresh(); // builds snapshot + fills html via updateDashboard
  }

  updateDashboard() {
    if (!this.panel) return;
    const { pricing, interval, dailyBudget } = this.config();
    (this._snap || []).forEach((s) => { if (s.dir) this.ensureCost(s.dir, pricing, interval); });
    this.panel.webview.html = this.dashHtml(this._snap || [], pricing, dailyBudget);
  }

  dashHtml(snap, pricing, dailyBudget) {
    const esc = (s) => String(s == null ? '' : s)
      .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const money = (x) => '$' + (x || 0).toFixed(2);
    const tok = (n) => (n == null ? '0' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n));
    const col = (p) => p == null ? 'var(--vscode-descriptionForeground)'
      : p >= 90 ? 'var(--vscode-charts-red)' : p >= 50 ? 'var(--vscode-charts-yellow)' : 'var(--vscode-charts-green)';
    const now = Date.now();

    const usageRow = (lab, p, reset) => {
      const w = Math.max(0, Math.min(100, p || 0));
      return `<div class="barrow"><span class="lab">${lab}</span>`
        + `<div class="track"><div class="fill" style="width:${w}%;background:${col(p)}"></div></div>`
        + `<span class="pct" style="color:${col(p)}">${p == null ? '?' : p + '%'}</span>`
        + `<span class="rst">resets in ${esc(remain(reset))}</span></div>`;
    };
    const tile = (label, val) => `<div class="tile"><div class="tl">${label}</div><div class="tv">${val}</div></div>`;

    // Last-30-day history sparkline + avg-by-hour bars from scanned cost.
    const dayKeys = () => {
      const out = [];
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now - i * 86400000);
        out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
      }
      return out;
    };
    const spark = (byDay) => {
      const keys = dayKeys();
      const vals = keys.map((k) => (byDay && byDay[k]) || 0);
      const max = Math.max(0.01, ...vals);
      return `<div class="spark">` + vals.map((v, i) =>
        `<div class="sb" title="${esc(keys[i])}: ${money(v)}" style="height:${Math.max(2, (v / max) * 100)}%"></div>`).join('') + `</div>`;
    };
    const hours = (byHour) => {
      const max = Math.max(0.01, ...(byHour || []));
      return `<div class="spark">` + (byHour || []).map((v, i) =>
        `<div class="sb" title="${i}:00 — ${money(v)}" style="height:${Math.max(2, (v / max) * 100)}%"></div>`).join('') + `</div>`;
    };

    const noneCard = (s) =>
      `<div class="card"><div class="chd"><div class="cname">${esc(s.label)}</div>`
      + `<div class="dim">not signed in</div></div>`
      + `<div class="meta">Log in once to start tracking this account.</div>`
      + `<div class="btns"><button onclick="post('login',${s.idx})">Log in</button>`
      + `<button class="sec" onclick="post('launch',${s.idx})">Terminal</button>`
      + `<button class="sec" onclick="post('remove',${s.idx})">Remove</button></div></div>`;

    const card = (s) => {
      if (s.none) return noneCard(s);
      const cost = (this._cost[s.dir] && this._cost[s.dir].data) || null;
      const scanning = this._cost[s.dir] && this._cost[s.dir].pending && !cost;
      const burn = cost && cost.first5hTs
        ? cost.cost5h / Math.max(0.1, (now - cost.first5hTs) / 3600000) : 0;
      const t = cost ? cost.tok5h : { in: 0, out: 0, cr: 0, cc: 0 };
      const projRows = cost
        ? Object.entries(cost.byProject).sort((a, b) => b[1].d30 - a[1].d30).slice(0, 8)
          .map(([name, p]) => `<tr><td>${esc(name)}</td><td>${money(p.today)}</td><td>${money(p.d7)}</td><td>${money(p.d30)}</td></tr>`).join('')
        : '';

      // Essentials, always visible: name + today's cost, two usage bars, cost tiles.
      const head = `<div class="chd"><div class="cname">${esc(s.label)}`
        + `${s.blocked ? ' <span class="blocked">limit</span>' : ''}</div>`
        + `<div class="ctoday">${cost ? money(cost.costToday) : '—'}<span> today</span></div></div>`;
      const usage = usageRow('5h', s.p5, s.reset5hAt) + usageRow('7d', s.p7, s.reset7dAt);
      const tiles = cost
        ? `<div class="tiles">${tile('5h', money(cost.cost5h))}${tile('Today', money(cost.costToday))}${tile('7 days', money(cost.cost7d))}${tile('Month', money(cost.cost30d))}</div>`
        : `<div class="meta">${scanning ? 'Scanning session logs…' : 'No session logs yet.'}</div>`;
      const burnLine = cost
        ? `<div class="meta">🔥 ${money(burn)}/hr${s.reset5hAt ? ` · 5h limit in ~${esc(remain(s.reset5hAt))}` : ''}${dailyBudget ? ` · ${Math.round((cost.costToday / dailyBudget) * 100)}% of $${dailyBudget}/day` : ''}</div>`
        : '';

      // Everything else folded behind one Details expander.
      const details = cost ? `<details class="more"><summary>Details</summary>
        <table class="tbl"><tr><th>5h tokens</th><th>Count</th><th>Cost</th></tr>
        <tr><td>Input</td><td>${tok(t.in)}</td><td>${money(t.in * pricing.in / 1e6)}</td></tr>
        <tr><td>Output</td><td>${tok(t.out)}</td><td>${money(t.out * pricing.out / 1e6)}</td></tr>
        <tr><td>Cache read</td><td>${tok(t.cr)}</td><td>${money(t.cr * pricing.cr / 1e6)}</td></tr>
        <tr><td>Cache create</td><td>${tok(t.cc)}</td><td>${money(t.cc * pricing.cc / 1e6)}</td></tr></table>
        ${projRows ? `<div class="lbl">By project</div><table class="tbl"><tr><th>Project</th><th>Today</th><th>7d</th><th>30d</th></tr>${projRows}</table>` : ''}
        <div class="lbl">Last 30 days</div>${spark(cost.byDay)}
        <div class="lbl">Avg cost by hour</div>${hours(cost.byHour)}
        <div class="lbl">Pricing (per 1M) — <a href="#" onclick="postq('openSettings','@ext:QG-devramyun.claude-multi-usage pricing');return false">edit</a></div>
        <div class="meta">in ${money(pricing.in)} · out ${money(pricing.out)} · cache-read ${money(pricing.cr)} · cache-create ${money(pricing.cc)}</div>
      </details>` : '';

      return `<div class="card">${head}${usage}${tiles}${burnLine}${details}
        <div class="btns">
          <button onclick="post('launch',${s.idx})">Terminal</button>
          <button class="sec" onclick="post('login',${s.idx})">Log in</button>
          <button class="sec" onclick="post('remove',${s.idx})">Remove</button>
        </div>
        <div class="src">${s.source === 'api' ? 'via API' : 'via cache'}${s.updatedAt ? ' · ' + esc(new Date(s.updatedAt).toLocaleTimeString()) : ''}</div>
      </div>`;
    };

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:14px 18px;}
      .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}
      h2{margin:0;font-size:16px;}
      .card{border:1px solid var(--vscode-panel-border);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:var(--vscode-editorWidget-background);}
      .chd{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8px;}
      .cname{font-weight:700;font-size:14px;}
      .ctoday{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;}
      .ctoday span{font-size:11px;font-weight:400;color:var(--vscode-descriptionForeground);}
      .dim{color:var(--vscode-descriptionForeground);font-weight:400;font-size:12px;}
      .blocked{color:var(--vscode-charts-red);font-size:11px;border:1px solid var(--vscode-charts-red);border-radius:6px;padding:1px 6px;}
      .src{color:var(--vscode-descriptionForeground);font-size:10px;margin-top:8px;text-align:right;}
      .barrow{display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12px;}
      .lab{width:22px;color:var(--vscode-descriptionForeground);}
      .track{flex:1;height:10px;border-radius:6px;background:var(--vscode-input-background);overflow:hidden;}
      .fill{height:100%;border-radius:6px;transition:width .3s;}
      .pct{width:40px;text-align:right;font-variant-numeric:tabular-nums;}
      .rst{width:110px;color:var(--vscode-descriptionForeground);font-size:11px;}
      .tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0 6px;}
      .tile{background:var(--vscode-input-background);border-radius:8px;padding:8px 10px;text-align:center;}
      .tl{color:var(--vscode-descriptionForeground);font-size:11px;}
      .tv{font-size:15px;font-weight:700;font-variant-numeric:tabular-nums;}
      .tbl{width:100%;border-collapse:collapse;font-size:12px;margin:4px 0 8px;}
      .tbl th{text-align:left;color:var(--vscode-descriptionForeground);font-weight:500;border-bottom:1px solid var(--vscode-panel-border);}
      .tbl td,.tbl th{padding:3px 6px;}.tbl td:not(:first-child),.tbl th:not(:first-child){text-align:right;font-variant-numeric:tabular-nums;}
      .more{margin:6px 0;font-size:12px;}.more>summary{cursor:pointer;color:var(--vscode-textLink-foreground);margin-bottom:6px;}
      .lbl{font-weight:600;font-size:11px;color:var(--vscode-descriptionForeground);margin:10px 0 3px;}
      .lbl a{color:var(--vscode-textLink-foreground);font-weight:400;}
      .spark{display:flex;align-items:flex-end;gap:2px;height:42px;margin:3px 0;}
      .sb{flex:1;background:var(--vscode-charts-blue,#4e94ce);border-radius:2px 2px 0 0;min-height:2px;}
      .meta{color:var(--vscode-descriptionForeground);font-size:12px;margin:6px 0;}
      .btns{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;}
      button{font-family:inherit;font-size:12px;border:none;border-radius:6px;padding:5px 10px;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
      button.sec{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);}
      button:hover{opacity:.88;} .empty{color:var(--vscode-descriptionForeground);margin-bottom:10px;}
      .add{margin-top:6px;font-size:12px;}.add>summary{cursor:pointer;color:var(--vscode-textLink-foreground);}
      .add .row{display:flex;gap:8px;margin:8px 0;}
      .add input{flex:1;font-family:inherit;font-size:12px;padding:5px 8px;border-radius:6px;
        border:1px solid var(--vscode-input-border,transparent);background:var(--vscode-input-background);color:var(--vscode-input-foreground);}
      .hint{color:var(--vscode-descriptionForeground);font-size:11px;margin-top:6px;}
      .foot{color:var(--vscode-descriptionForeground);font-size:11px;margin-top:10px;border-top:1px solid var(--vscode-panel-border);padding-top:8px;}
    </style></head><body>
      <div class="top"><h2>Claude Usage</h2><button onclick="post('refresh')">↻ Refresh</button></div>
      ${snap.length ? snap.map(card).join('') : '<div class="empty">No accounts yet — add one below.</div>'}
      <details class="add">
        <summary>+ Add account</summary>
        <div class="row">
          <input id="lab" placeholder="label — e.g. .claude-work" />
          <input id="dir" placeholder="config dir — e.g. ~/.claude-work" />
        </div>
        <div class="btns">
          <button onclick="add(true)">Add &amp; log in</button>
          <button class="sec" onclick="add(false)">Add only</button>
        </div>
        <div class="hint">The label is shown as-is. A new directory with no login opens a terminal to sign in the first time.</div>
      </details>
      <div class="foot">Cost = token counts × pricing — an API-equivalent estimate, not your subscription bill. Token counts are exact; the last 30 days of logs are scanned.</div>
      <script>
        const v=acquireVsCodeApi();
        function post(type,idx){v.postMessage({type,idx});}
        function postq(type,query){v.postMessage({type,query});}
        function add(login){
          const lab=document.getElementById('lab').value;
          const dir=document.getElementById('dir').value;
          v.postMessage({type:'add',label:lab,dir:dir,login:login});
          document.getElementById('lab').value='';document.getElementById('dir').value='';
        }
      </script>
    </body></html>`;
  }

  start() {
    this.rebuild();
    this.refresh();
    const { interval, anim, animMs, frames, showChar } = this.config();
    this.timer = setInterval(() => this.refresh(), interval);
    if (this.animTimer) clearInterval(this.animTimer);
    if (anim && showChar && frames && frames.length >= 2) {
      this.animTimer = setInterval(() => this.tick(), Math.max(200, Math.floor(animMs / frames.length)));
    }
  }

  restart() {
    if (this.timer) clearInterval(this.timer);
    if (this.animTimer) clearInterval(this.animTimer);
    this.start();
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    if (this.animTimer) clearInterval(this.animTimer);
    if (this.panel) this.panel.dispose();
    this.items.forEach((i) => i.dispose());
  }
}

function activate(context) {
  const bar = new Bar();
  bar.start();

  context.subscriptions.push(
    bar,
    vscode.commands.registerCommand('claudeMultiUsage.refresh', () => bar.refresh(true)),
    vscode.commands.registerCommand('claudeMultiUsage.openDashboard', () => bar.openDashboard()),
    vscode.commands.registerCommand('claudeMultiUsage.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:QG-devramyun.claude-multi-usage')
    ),
    vscode.commands.registerCommand('claudeMultiUsage.launch', (idx) =>
      typeof idx === 'number' ? bar.launch(idx) : bar.pickAndLaunch()
    ),
    vscode.commands.registerCommand('claudeMultiUsage.addAccount', () => bar.addAccount()),
    vscode.commands.registerCommand('claudeMultiUsage.removeAccount', () => bar.removeAccount()),
    vscode.commands.registerCommand('claudeMultiUsage.openCache', (idx) => {
      const f = (typeof idx === 'number' && bar.items[idx]?.__file)
        || bar.items.find((i) => i.__file)?.__file;
      if (f) vscode.window.showTextDocument(vscode.Uri.file(f));
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CFG)) bar.restart();
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
