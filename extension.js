// Claude Multi-Account Usage — VS Code status bar extension.
// Reads each Claude config dir's vscode-claude-status-cache.json and shows
// per-account 5h / 7d usage side by side. (For cc-switch ccp/ccw multi-account.)
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE_FILE = 'vscode-claude-status-cache.json';
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

/** epoch (seconds) -> short remaining time "1h 23m" / "12m". */
function remain(epochSec) {
  const diff = (epochSec || 0) * 1000 - Date.now();
  if (diff <= 0) return 'now';
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60);
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
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
    };
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

  refresh() {
    const { accounts, warnAt, critAt, show7d, barLen, showChar, frames } = this.config();
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
      const { data, updatedAt, file, error } = readUsage(dir);
      const label = acc.label || acc.dir;
      item.__file = file;

      if (!data) {
        const body = `${label} —`;
        item.__body = body;
        item.text = deco(body);
        item.color = undefined;
        item.backgroundColor = undefined;
        const md = new vscode.MarkdownString();
        md.isTrusted = true;
        md.appendMarkdown(`**${label}** · no usage cache yet\n\n`);
        md.appendMarkdown(error === 'ENOENT'
          ? `Run one Claude session with this account to create it.\n\n`
          : `Read error: \`${error}\`\n\n`);
        md.appendMarkdown(`\`${path.join(dir, CACHE_FILE)}\`\n\n`);
        md.appendMarkdown(this.menuLinks(idx));
        item.tooltip = md;
        item.show();
        snap.push({ idx, label, none: true, error });
        return;
      }

      const u5 = data.utilization5h;
      const u7 = data.utilization7d;
      const p5 = pct(u5);
      const p7 = pct(u7);
      const blocked = data.limitStatus && data.limitStatus !== 'allowed';
      const lvl = Math.max(typeof u5 === 'number' ? u5 : 0, typeof u7 === 'number' ? u7 : 0);

      // Progress-bar form: "personal ██████▌░ 52% · 36%" (countdown when exhausted/blocked).
      let body;
      if (blocked || (typeof u5 === 'number' && u5 >= 1)) {
        body = `${label} ${bar(1, barLen)} reset ${remain(data.reset5hAt)}`;
      } else {
        body = `${label} ${bar(u5, barLen)} ${p5 == null ? '?' : p5 + '%'}`;
        if (show7d && p7 != null) body += ` · ${p7}%`;
      }
      item.__body = body;
      item.text = deco(body);
      item.color = blocked ? new vscode.ThemeColor('charts.red') : colorFor(lvl, warnAt, critAt);
      item.backgroundColor = undefined;

      const md = new vscode.MarkdownString();
      md.isTrusted = true;
      md.appendMarkdown(`**${label}** — Claude usage\n\n`);
      md.appendMarkdown('```\n');
      md.appendMarkdown(`5h  ${bar(u5, barLen)} ${(p5 ?? '?')}%   reset ${remain(data.reset5hAt)}\n`);
      md.appendMarkdown(`7d  ${bar(u7, barLen)} ${(p7 ?? '?')}%   reset ${remain(data.reset7dAt)}\n`);
      md.appendMarkdown('```\n\n');
      md.appendMarkdown(`Status: \`${data.limitStatus || '?'}\``);
      if (updatedAt) md.appendMarkdown(` · updated ${new Date(updatedAt).toLocaleTimeString()}`);
      md.appendMarkdown(`\n\n_Left-click → refresh_\n\n${this.menuLinks(idx)}`);
      item.tooltip = md;
      item.show();
      snap.push({
        idx, label, p5, p7, blocked,
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
      if (m.type === 'refresh') this.refresh();
      else if (m.type === 'launch') this.launch(m.idx);
      else if (m.type === 'login') this.loginAccount(m.idx);
      else if (m.type === 'add') this.addFromDashboard(m.label, m.dir, m.login);
      else if (m.type === 'remove') this.removeByIndex(m.idx);
      else if (m.type === 'openCache') {
        const f = this.items[m.idx] && this.items[m.idx].__file;
        if (f) vscode.window.showTextDocument(vscode.Uri.file(f));
      }
    });
    this.refresh(); // builds snapshot + fills html via updateDashboard
  }

  updateDashboard() {
    if (this.panel) this.panel.webview.html = this.dashHtml(this._snap || []);
  }

  dashHtml(snap) {
    const esc = (s) => String(s == null ? '' : s)
      .replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const col = (p) => p == null ? 'var(--vscode-descriptionForeground)'
      : p >= 90 ? 'var(--vscode-charts-red)' : p >= 50 ? 'var(--vscode-charts-yellow)' : 'var(--vscode-charts-green)';
    const barRow = (p, lab, reset) => {
      const w = Math.max(0, Math.min(100, p || 0));
      return `<div class="barrow"><span class="lab">${lab}</span><div class="track"><div class="fill" style="width:${w}%;background:${col(p)}"></div></div>`
        + `<span class="pct" style="color:${col(p)}">${p == null ? '?' : p + '%'}</span><span class="rst">reset ${esc(reset)}</span></div>`;
    };
    const card = (s) => s.none
      ? `<div class="card"><div class="hd">${esc(s.label)}</div>`
        + `<div class="meta">No usage cache yet — log in once with this account to create it.</div>`
        + `<div class="btns"><button onclick="post('login',${s.idx})">Log in</button>`
        + `<button class="sec" onclick="post('launch',${s.idx})">Open terminal</button>`
        + `<button class="sec" onclick="post('remove',${s.idx})">Remove</button></div></div>`
      : `<div class="card"><div class="hd">${esc(s.label)}${s.blocked ? ' <span class="blocked">limit reached</span>' : ''}</div>`
        + barRow(s.p5, '5h', remain(s.reset5hAt)) + barRow(s.p7, '7d', remain(s.reset7dAt))
        + `<div class="meta">Status ${esc(s.status || '?')}${s.updatedAt ? ' · updated ' + esc(new Date(s.updatedAt).toLocaleTimeString()) : ''}</div>`
        + `<div class="btns"><button onclick="post('launch',${s.idx})">Open terminal</button>`
        + `<button class="sec" onclick="post('login',${s.idx})">Log in</button>`
        + `<button class="sec" onclick="post('openCache',${s.idx})">Cache file</button>`
        + `<button class="sec" onclick="post('remove',${s.idx})">Remove</button></div></div>`;
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:14px 18px;}
      .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;}
      h2{margin:0;font-size:16px;}
      .card{border:1px solid var(--vscode-panel-border);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:var(--vscode-editorWidget-background);}
      .hd{font-weight:700;font-size:14px;margin-bottom:8px;}
      .blocked{color:var(--vscode-charts-red);font-size:11px;border:1px solid var(--vscode-charts-red);border-radius:6px;padding:1px 6px;}
      .barrow{display:flex;align-items:center;gap:8px;margin:5px 0;font-size:12px;}
      .lab{width:22px;color:var(--vscode-descriptionForeground);}
      .track{flex:1;height:10px;border-radius:6px;background:var(--vscode-input-background);overflow:hidden;}
      .fill{height:100%;border-radius:6px;transition:width .3s;}
      .pct{width:40px;text-align:right;font-variant-numeric:tabular-nums;}
      .rst{width:104px;color:var(--vscode-descriptionForeground);font-size:11px;}
      .meta{color:var(--vscode-descriptionForeground);font-size:11px;margin:6px 0 8px;}
      .btns{display:flex;gap:6px;flex-wrap:wrap;}
      button{font-family:inherit;font-size:12px;border:none;border-radius:6px;padding:5px 10px;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
      button.sec{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);}
      button:hover{opacity:.88;} .empty{color:var(--vscode-descriptionForeground);margin-bottom:10px;}
      .add{border:1px dashed var(--vscode-panel-border);border-radius:10px;padding:12px 14px;margin-top:6px;}
      .add .row{display:flex;gap:8px;margin:8px 0;}
      .add input{flex:1;font-family:inherit;font-size:12px;padding:5px 8px;border-radius:6px;
        border:1px solid var(--vscode-input-border,transparent);background:var(--vscode-input-background);color:var(--vscode-input-foreground);}
      .hint{color:var(--vscode-descriptionForeground);font-size:11px;margin-top:6px;}
    </style></head><body>
      <div class="top"><h2>Claude Usage (multi-account)</h2><button onclick="post('refresh')">Refresh</button></div>
      ${snap.length ? snap.map(card).join('') : '<div class="empty">No accounts yet — add one below.</div>'}
      <div class="add">
        <div class="hd">Add account</div>
        <div class="row">
          <input id="lab" placeholder="label — e.g. .claude-work" />
          <input id="dir" placeholder="config dir — e.g. ~/.claude-work" />
        </div>
        <div class="btns">
          <button onclick="add(true)">Add &amp; log in</button>
          <button class="sec" onclick="add(false)">Add only</button>
        </div>
        <div class="hint">The label is shown as-is (no parsing). A new directory with no
          login opens a terminal so you can sign in the first time.</div>
      </div>
      <script>
        const v=acquireVsCodeApi();
        function post(type,idx){v.postMessage({type,idx});}
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
    vscode.commands.registerCommand('claudeMultiUsage.refresh', () => bar.refresh()),
    vscode.commands.registerCommand('claudeMultiUsage.openDashboard', () => bar.openDashboard()),
    vscode.commands.registerCommand('claudeMultiUsage.openSettings', () =>
      vscode.commands.executeCommand('workbench.action.openSettings', '@ext:southglory.claude-multi-usage')
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
