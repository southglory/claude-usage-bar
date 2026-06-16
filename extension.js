// Claude Multi-Account Usage — VSCode 상태바 extension
// 여러 Claude config 디렉터리의 vscode-claude-status-cache.json 을 읽어
// 계정별 5h / 7d 사용률을 동시에 표시한다. (cc-switch ccp/ccw 멀티계정용)
'use strict';

const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE_FILE = 'vscode-claude-status-cache.json';
const CFG = 'claudeMultiUsage';

/** ~ 와 환경변수(%VAR% / ${VAR})를 실제 경로로 확장 */
function expandDir(dir) {
  let d = String(dir || '').trim();
  if (d === '~' || d.startsWith('~/') || d.startsWith('~\\')) {
    d = path.join(os.homedir(), d.slice(1));
  }
  d = d.replace(/%([^%]+)%/g, (_, n) => process.env[n] || '')
       .replace(/\$\{?env:?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (_, n) => process.env[n] || '');
  return path.normalize(d);
}

/** 폴더명에서 라벨 유도: ".claude"→"claude", ".claude-work"→"work" */
function labelFromDir(name) {
  const base = path.basename(name);
  const s = base.replace(/^\.claude/, '').replace(/^[-_]/, '');
  return s || 'claude';
}

/** 홈에서 .claude* 디렉터리를 자동 탐지 (projects/ 또는 캐시 파일 보유 시) */
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
  out.sort((a, b) => a.dir.localeCompare(b.dir)); // index 안정화
  return out;
}

/** <dir>/vscode-claude-status-cache.json 을 읽어 usageData 반환 (없으면 null) */
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

/** 사용률 → charts 색(텍스트 색, 배경 스왑 없음): 초록<warn / 노랑<crit / 빨강 */
function colorFor(util, warnAt, critAt) {
  if (typeof util !== 'number') return undefined;
  if (util >= critAt) return new vscode.ThemeColor('charts.red');
  if (util >= warnAt) return new vscode.ThemeColor('charts.yellow');
  return new vscode.ThemeColor('charts.green');
}

/** 0~1 비율 → 1/8 정밀 진행 바 ("██████▌░░"). 52%와 50%가 시각적으로 다르게 보인다. */
const BLK = ['░', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];
function bar(p, len) {
  const v = Math.max(0, Math.min(1, typeof p === 'number' ? p : 0));
  let s = '';
  for (let i = 0; i < len; i++) {
    const cell = Math.max(0, Math.min(1, v * len - i));
    s += BLK[Math.round(cell * 8)];
  }
  return s;
}

/** epoch(초) → 남은 시간 짧게 "1h 23m" / "12m" */
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
    this.panel = null;   // 대시보드 웹뷰(싱글턴)
    this._snap = [];     // 대시보드용 최신 스냅샷
    this.showChar = true;
    this.frames = ['$(quokka-0)', '$(quokka-1)'];
  }

  config() {
    const c = vscode.workspace.getConfiguration(CFG);
    let accounts = c.get('accounts') || [];
    if (!accounts.length) accounts = discoverAccounts(); // 비었으면 자동 탐지
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
      frames: c.get('characterFrames', ['$(quokka-0)', '$(quokka-1)']),
      launchCommand: c.get('launchCommand', 'claude'),
      clickAction: c.get('clickAction', 'refresh'),
    };
  }

  /** 계정 수만큼 StatusBarItem 재생성 */
  rebuild() {
    this.items.forEach((i) => i.dispose());
    this.items = [];
    const { accounts, clickAction } = this.config();
    const cmd = clickAction === 'launch' ? 'claudeMultiUsage.launch'
      : clickAction === 'openCache' ? 'claudeMultiUsage.openCache'
      : clickAction === 'refresh' ? 'claudeMultiUsage.refresh'
      : 'claudeMultiUsage.openDashboard';
    // priority 를 내림차순으로 줘서 입력 순서대로 왼→오 정렬
    accounts.forEach((_, idx) => {
      const item = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100 - idx
      );
      // 클릭 시 해당 계정 index 를 인자로 넘김
      item.command = { command: cmd, title: 'Claude', arguments: [idx] };
      this.items.push(item);
    });
  }

  /** 계정 index 로 터미널을 연다.
   *  - command 지정(예: ccw/ccp): env 주입 없이 그 래퍼를 그대로 실행 = 일반 터미널 ccw 경험
   *  - 미지정: CLAUDE_CONFIG_DIR 주입 후 launchCommand(기본 claude) 실행 */
  launch(idx) {
    const { accounts, launchCommand } = this.config();
    const acc = accounts[idx];
    if (!acc) return;
    const wrapper = (acc.command || '').trim();
    const name = `Claude · ${acc.label || acc.dir}`;
    // 같은 이름 터미널이 있으면 재사용
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

  /** QuickPick 으로 계정 선택 후 launch */
  async pickAndLaunch() {
    const { accounts } = this.config();
    if (!accounts.length) return;
    const picked = await vscode.window.showQuickPick(
      accounts.map((a, i) => ({
        label: `$(rocket) ${a.label || a.dir}`,
        description: expandDir(a.dir),
        idx: i,
      })),
      { placeHolder: '터미널을 열 Claude 계정 선택' }
    );
    if (picked) this.launch(picked.idx);
  }

  /** 설정에 저장된 계정 배열(없으면 탐지 결과를 명시적으로 구체화) */
  storedAccounts() {
    const cur = vscode.workspace.getConfiguration(CFG).get('accounts') || [];
    return cur.length ? cur.slice() : discoverAccounts();
  }

  async saveAccounts(next) {
    await vscode.workspace
      .getConfiguration(CFG)
      .update('accounts', next, vscode.ConfigurationTarget.Global);
  }

  /** 계정 추가: 자동탐지 목록 또는 직접 입력, 라벨 자유 지정 */
  async addAccount() {
    const cur = this.storedAccounts();
    const seen = new Set(cur.map((a) => expandDir(a.dir)));
    const items = discoverAccounts()
      .filter((d) => !seen.has(expandDir(d.dir)))
      .map((d) => ({ label: `$(folder) ${d.label}`, description: d.dir, acc: d }));
    items.push({ label: '$(edit) 직접 입력…', description: '', acc: null });

    const pick = await vscode.window.showQuickPick(items, {
      placeHolder: '추가할 계정 (자동 탐지됨)',
    });
    if (!pick) return;

    let dir, label;
    if (pick.acc) {
      dir = pick.acc.dir;
      label = pick.acc.label;
    } else {
      dir = await vscode.window.showInputBox({
        prompt: 'CLAUDE_CONFIG_DIR 경로',
        placeHolder: '~/.claude-<이름>',
      });
      if (!dir) return;
      label = labelFromDir(dir);
    }
    label = await vscode.window.showInputBox({ prompt: '표시 이름(라벨)', value: label });
    if (label == null) return;

    const command = await vscode.window.showInputBox({
      prompt: '열기 명령 (비우면 CLAUDE_CONFIG_DIR 주입+claude). cc-switch 래퍼를 그대로 쓰려면 ccw/ccp 입력',
      placeHolder: '예: ccw / ccp / 비움',
    });
    if (command == null) return; // ESC = 취소

    const acc = { label: label.trim() || label, dir: dir.trim() };
    if (command.trim()) acc.command = command.trim();
    await this.saveAccounts([...cur, acc]);
    vscode.window.showInformationMessage(
      `Claude 계정 추가: ${acc.label} (${acc.dir}${acc.command ? ', ' + acc.command : ''})`
    );
  }

  /** 계정 제거 */
  async removeAccount() {
    const cur = this.storedAccounts();
    if (!cur.length) return;
    const pick = await vscode.window.showQuickPick(
      cur.map((a, i) => ({ label: a.label, description: expandDir(a.dir), idx: i })),
      { placeHolder: '제거할 계정' }
    );
    if (!pick) return;
    await this.saveAccounts(cur.filter((_, i) => i !== pick.idx));
    vscode.window.showInformationMessage(`Claude 계정 제거: ${pick.label}`);
  }

  refresh() {
    const { accounts, warnAt, critAt, show7d, barLen, showChar, frames } = this.config();
    this.showChar = showChar;
    this.frames = frames && frames.length ? frames : ['ᵔ', 'ᵕ'];
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
        md.appendMarkdown(`**${label}** · 사용량 캐시 없음\n\n`);
        md.appendMarkdown(error === 'ENOENT'
          ? `이 계정으로 Claude 세션을 한 번 실행하면 생성됩니다.\n\n`
          : `읽기 오류: \`${error}\`\n\n`);
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

      // 진행 바 형식: "개인 ██████▌░ 52% · 36%"  (한도/소진 시 카운트다운)
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
      md.appendMarkdown(`**${label}** — Claude 사용량\n\n`);
      md.appendMarkdown('```\n');
      md.appendMarkdown(`5h  ${bar(u5, barLen)} ${(p5 ?? '?')}%   reset ${remain(data.reset5hAt)}\n`);
      md.appendMarkdown(`7d  ${bar(u7, barLen)} ${(p7 ?? '?')}%   reset ${remain(data.reset7dAt)}\n`);
      md.appendMarkdown('```\n\n');
      md.appendMarkdown(`상태: \`${data.limitStatus || '?'}\``);
      if (updatedAt) md.appendMarkdown(` · 갱신 ${new Date(updatedAt).toLocaleTimeString()}`);
      md.appendMarkdown(`\n\n_좌클릭 → 새로고침_\n\n${this.menuLinks(idx)}`);
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

  /** 호버 툴팁용 클릭 가능한 명령 링크(우클릭 메뉴 대용) */
  menuLinks(idx) {
    const a = encodeURIComponent(JSON.stringify([idx]));
    return `[대시보드](command:claudeMultiUsage.openDashboard) · `
      + `[터미널](command:claudeMultiUsage.launch?${a}) · `
      + `[캐시](command:claudeMultiUsage.openCache?${a}) · `
      + `[설정](command:claudeMultiUsage.openSettings)`;
  }

  /** 숨쉬기 애니메이션: 본문은 그대로 두고 마스코트 프레임만 교체(가벼움) */
  tick() {
    if (!this.showChar || !this.frames || this.frames.length < 2) return;
    this.animFrame = (this.animFrame + 1) % this.frames.length;
    const f = this.frames[this.animFrame];
    for (const item of this.items) {
      if (item.__body != null) item.text = f + ' ' + item.__body;
    }
  }

  /** 클릭 → 사용량 대시보드 웹뷰 (모든 계정 바·리셋 + 새로고침·터미널·캐시 버튼) */
  openDashboard() {
    if (this.panel) {
      this.panel.reveal();
      this.updateDashboard();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      'claudeMultiUsage', 'Claude 사용량', vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.onDidDispose(() => { this.panel = null; });
    this.panel.webview.onDidReceiveMessage((m) => {
      if (!m) return;
      if (m.type === 'refresh') this.refresh();
      else if (m.type === 'launch') this.launch(m.idx);
      else if (m.type === 'openCache') {
        const f = this.items[m.idx] && this.items[m.idx].__file;
        if (f) vscode.window.showTextDocument(vscode.Uri.file(f));
      }
    });
    this.refresh(); // 스냅샷 + updateDashboard 로 html 채움
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
      ? `<div class="card"><div class="hd">${esc(s.label)}</div><div class="meta">사용량 캐시 없음 — 이 계정으로 Claude 세션을 한 번 실행하세요.</div>`
        + `<div class="btns"><button onclick="post('launch',${s.idx})">터미널 열기</button></div></div>`
      : `<div class="card"><div class="hd">${esc(s.label)}${s.blocked ? ' <span class="blocked">한도초과</span>' : ''}</div>`
        + barRow(s.p5, '5h', remain(s.reset5hAt)) + barRow(s.p7, '7d', remain(s.reset7dAt))
        + `<div class="meta">상태 ${esc(s.status || '?')}${s.updatedAt ? ' · 갱신 ' + esc(new Date(s.updatedAt).toLocaleTimeString()) : ''}</div>`
        + `<div class="btns"><button onclick="post('launch',${s.idx})">터미널 열기</button><button class="sec" onclick="post('openCache',${s.idx})">캐시 파일</button></div></div>`;
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
      .btns{display:flex;gap:6px;}
      button{font-family:inherit;font-size:12px;border:none;border-radius:6px;padding:5px 10px;cursor:pointer;background:var(--vscode-button-background);color:var(--vscode-button-foreground);}
      button.sec{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground);}
      button:hover{opacity:.88;} .empty{color:var(--vscode-descriptionForeground);}
    </style></head><body>
      <div class="top"><h2>🦘 Claude 사용량 (멀티계정)</h2><button onclick="post('refresh')">새로고침</button></div>
      ${snap.length ? snap.map(card).join('') : '<div class="empty">표시할 계정이 없습니다. 설정에서 계정을 추가하세요.</div>'}
      <script>const v=acquireVsCodeApi();function post(type,idx){v.postMessage({type,idx});}</script>
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
