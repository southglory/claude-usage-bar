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

/** 사용률 → 상태바 배경/전경 색 ThemeColor */
function colorFor(util, warnAt, critAt) {
  if (typeof util !== 'number') return undefined;
  if (util >= critAt) return new vscode.ThemeColor('statusBarItem.errorBackground');
  if (util >= warnAt) return new vscode.ThemeColor('statusBarItem.warningBackground');
  return undefined;
}

/** epoch(초) → "2시간 13분 후 (14:30)" 형태 */
function resetText(epochSec) {
  if (!epochSec) return '?';
  const ms = epochSec * 1000;
  const diff = ms - Date.now();
  const at = new Date(ms).toLocaleString();
  if (diff <= 0) return `리셋됨 (${at})`;
  const m = Math.floor(diff / 60000);
  const h = Math.floor(m / 60);
  const rel = h > 0 ? `${h}시간 ${m % 60}분 후` : `${m}분 후`;
  return `${rel} (${at})`;
}

class Bar {
  constructor() {
    /** @type {vscode.StatusBarItem[]} */
    this.items = [];
    this.timer = null;
  }

  config() {
    const c = vscode.workspace.getConfiguration(CFG);
    let accounts = c.get('accounts') || [];
    if (!accounts.length) accounts = discoverAccounts(); // 비었으면 자동 탐지
    return {
      accounts,
      interval: (c.get('refreshIntervalSeconds') || 30) * 1000,
      warnAt: c.get('warnAt', 0.7),
      critAt: c.get('critAt', 0.9),
      show7d: c.get('show7d', true),
      launchCommand: c.get('launchCommand', 'claude'),
      clickAction: c.get('clickAction', 'launch'),
    };
  }

  /** 계정 수만큼 StatusBarItem 재생성 */
  rebuild() {
    this.items.forEach((i) => i.dispose());
    this.items = [];
    const { accounts, clickAction } = this.config();
    const cmd = clickAction === 'openCache'
      ? 'claudeMultiUsage.openCache'
      : 'claudeMultiUsage.launch';
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
    const { accounts, warnAt, critAt, show7d } = this.config();
    if (accounts.length !== this.items.length) this.rebuild();

    accounts.forEach((acc, idx) => {
      const item = this.items[idx];
      if (!item) return;
      const dir = expandDir(acc.dir);
      const { data, updatedAt, file, error } = readUsage(dir);
      const label = acc.label || acc.dir;

      if (!data) {
        item.text = `$(pulse) ${label} —`;
        const md = new vscode.MarkdownString();
        md.appendMarkdown(`**${label}** · 사용량 캐시 없음\n\n`);
        md.appendMarkdown(error === 'ENOENT'
          ? `이 계정으로 Claude 세션을 한 번 실행하면 생성됩니다.\n\n`
          : `읽기 오류: \`${error}\`\n\n`);
        md.appendMarkdown(`\`${path.join(dir, CACHE_FILE)}\``);
        item.tooltip = md;
        item.backgroundColor = undefined;
        item.show();
        item.__file = file;
        return;
      }

      const u5 = data.utilization5h;
      const u7 = data.utilization7d;
      const p5 = pct(u5);
      const p7 = pct(u7);
      const blocked = data.limitStatus && data.limitStatus !== 'allowed';

      let text = `$(pulse) ${label} ${p5 == null ? '?' : p5 + '%'}`;
      if (show7d && p7 != null) text += `·${p7}%`;
      if (blocked) text = `$(warning) ${label} 한도초과`;
      item.text = text;
      item.backgroundColor = blocked
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : colorFor(Math.max(u5 || 0, u7 || 0), warnAt, critAt);

      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${label}** — Claude 사용량\n\n`);
      md.appendMarkdown(`| 창 | 사용률 | 리셋 |\n|---|---|---|\n`);
      md.appendMarkdown(`| 5시간 | **${p5 ?? '?'}%** | ${resetText(data.reset5hAt)} |\n`);
      md.appendMarkdown(`| 7일 | **${p7 ?? '?'}%** | ${resetText(data.reset7dAt)} |\n\n`);
      md.appendMarkdown(`상태: \`${data.limitStatus || '?'}\`\n\n`);
      if (updatedAt) md.appendMarkdown(`갱신: ${new Date(updatedAt).toLocaleString()}\n\n`);
      md.appendMarkdown(`_클릭 → 캐시 파일 열기_`);
      item.tooltip = md;
      item.__file = file;
      item.show();
    });
  }

  start() {
    this.rebuild();
    this.refresh();
    const { interval } = this.config();
    this.timer = setInterval(() => this.refresh(), interval);
  }

  restart() {
    if (this.timer) clearInterval(this.timer);
    this.start();
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.items.forEach((i) => i.dispose());
  }
}

function activate(context) {
  const bar = new Bar();
  bar.start();

  context.subscriptions.push(
    bar,
    vscode.commands.registerCommand('claudeMultiUsage.refresh', () => bar.refresh()),
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
