# Claude Multi-Account Usage

Show the **5-hour / 7-day usage** of *multiple* Claude accounts side by side in the VS Code status bar — and open a per-account Claude terminal in one click.

여러 Claude 계정의 **5시간 / 7일 사용률**을 VS Code 상태바에 **동시에** 표시하고, 계정별 터미널을 한 번에 엽니다.

**English** | [한국어](#한국어)

---

## English

### Why
Existing status-bar extensions (`long-kudo.vscode-claude-status`, `Roki.claude-token-view`) hard-code `~/.claude` and ignore `CLAUDE_CONFIG_DIR`, so a second account like `~/.claude-work` (cc-switch `ccw`) never appears. This extension takes a list of accounts and reads each directory, so **N accounts** show on one line.

### Features
- **N accounts, side by side** — no hard-coded names, no limit.
- **Auto-detect** — leave the list empty; it finds `.claude*` dirs in your home and derives labels.
- **Per-account terminal** — click an account to open a Claude terminal with that account's `CLAUDE_CONFIG_DIR` injected. No global switching — run several accounts at once.
- **cc-switch friendly** — set `command: "ccw"` / `"ccp"` to run your existing wrapper as-is.
- **Color thresholds** — turns yellow/red as usage rises; shows `한도초과` when the limit is reached.

### Data source
Reads the cache Claude Code writes per config dir (no parsing/estimation):

```jsonc
<CLAUDE_CONFIG_DIR>/vscode-claude-status-cache.json
{ "usageData": { "utilization5h": 0.29, "utilization7d": 0.04, "limitStatus": "allowed" } }
```

If an account has no cache yet (shown as `—`), run one Claude session with that account to create it.

### Install
- **Dev run**: open this folder in VS Code and press `F5` (Extension Development Host).
- **From VSIX**: `code --install-extension southglory.claude-multi-usage-0.1.0.vsix` (or Extensions panel → ⋯ → *Install from VSIX…*).
- **Marketplace**: search "Claude Multi-Account Usage" (once published).

### Configure (`settings.json`)
```jsonc
"claudeMultiUsage.accounts": [
  { "label": "personal", "dir": "~/.claude",      "command": "ccp" },
  { "label": "work",     "dir": "~/.claude-work", "command": "ccw" }
],
"claudeMultiUsage.refreshIntervalSeconds": 30,
"claudeMultiUsage.warnAt": 0.7,   // yellow threshold
"claudeMultiUsage.critAt": 0.9,   // red threshold
"claudeMultiUsage.show7d": true,
"claudeMultiUsage.launchCommand": "claude",  // default command for accounts without `command`
"claudeMultiUsage.clickAction": "launch"     // or "openCache"
```
`dir` expands `~`, `%USERPROFILE%`, `${env:VAR}`. Auto-detect runs only when the list is empty. Status bar example: `⚡ personal 29%·4%  ⚡ work 12%·3%` (first = 5h, second = 7d).

### Keybindings
```jsonc
{ "key": "ctrl+alt+1", "command": "claudeMultiUsage.launch", "args": 0 }, // 1st account
{ "key": "ctrl+alt+0", "command": "claudeMultiUsage.launch" }            // no args → picker
```

### Commands
`Claude Multi Usage: 새로고침` · `… 캐시 파일 열기` · `Claude: 계정 선택해 터미널 열기` · `Claude: 계정 추가` · `Claude: 계정 제거`

---

## 한국어

### 왜 만들었나
`long-kudo.vscode-claude-status`, `Roki.claude-token-view` 등 기존 상태바 확장은 모두 `~/.claude` 경로를 **하드코딩**하고 `CLAUDE_CONFIG_DIR`을 무시합니다. 그래서 `~/.claude-work`(cc-switch `ccw`) 같은 두 번째 계정은 보이지 않습니다. 이 확장은 계정 목록을 받아 각 디렉터리를 읽으므로 **N개 계정**을 한 줄에 나란히 보여줍니다.

### 기능
- **N개 계정 동시 표시** — 이름 하드코딩 없음, 개수 제한 없음.
- **자동 탐지** — 목록을 비우면 홈에서 `.claude*` 디렉터리를 찾아 라벨을 유도(`.claude-work`→`work`).
- **계정별 터미널** — 상태바 항목 클릭 시 그 계정의 `CLAUDE_CONFIG_DIR`을 주입한 Claude 터미널을 엽니다. 전역 전환이 아니라 **여러 계정을 동시에** 띄울 수 있습니다.
- **cc-switch 호환** — `command: "ccw"`/`"ccp"`로 기존 래퍼를 그대로 실행.
- **색상 임계** — 사용률이 오르면 노랑/빨강, `limitStatus≠allowed`면 `한도초과`.

### 데이터 소스
Claude Code가 config 디렉터리마다 써주는 캐시를 그대로 읽습니다(파싱·추정 없음):

```jsonc
<CLAUDE_CONFIG_DIR>/vscode-claude-status-cache.json
{ "usageData": { "utilization5h": 0.29, "utilization7d": 0.04,
                 "reset5hAt": 1781493600, "reset7dAt": 1782054000,
                 "limitStatus": "allowed" } }
```
캐시가 없으면(`—`) 그 계정으로 Claude 세션을 한 번 실행하면 생성됩니다.

### 설치
- **개발 실행**: 폴더를 VS Code로 열고 `F5`(Extension Development Host).
- **VSIX 설치**: `code --install-extension southglory.claude-multi-usage-0.1.0.vsix` (또는 확장 패널 → ⋯ → *Install from VSIX…*).
- **마켓플레이스**: 게시 후 "Claude Multi-Account Usage" 검색.

### 설정 (`settings.json`)
```jsonc
"claudeMultiUsage.accounts": [
  { "label": "개인", "dir": "~/.claude",      "command": "ccp" },
  { "label": "업무", "dir": "~/.claude-work", "command": "ccw" }
],
"claudeMultiUsage.refreshIntervalSeconds": 30,
"claudeMultiUsage.warnAt": 0.7,
"claudeMultiUsage.critAt": 0.9,
"claudeMultiUsage.show7d": true,
"claudeMultiUsage.clickAction": "launch"
```
`dir`은 `~`, `%USERPROFILE%`, `${env:VAR}` 확장을 지원합니다. 설정이 비어 있을 때만 자동 탐지가 동작합니다. 상태바: `⚡ 개인 29%·4%  ⚡ 업무 12%·3%`(앞=5h, 뒤=7d).

### 계정 전환 (cc-switch 기능 내장)
전역 상태를 건드리지 않고 계정별 터미널을 엽니다. 두 가지 실행 방식:
1. **env 주입(기본)** — `command` 미지정: `CLAUDE_CONFIG_DIR` 주입 후 `launchCommand`(기본 `claude`) 실행. `ccw/ccp` 별칭이 없어도 동작.
2. **cc-switch 래퍼 그대로** — `command: "ccw"`/`"ccp"`: 그 래퍼를 그대로 실행(일반 터미널에서 `ccw` 친 것과 동일).

### 단축키
```jsonc
{ "key": "ctrl+alt+1", "command": "claudeMultiUsage.launch", "args": 0 },
{ "key": "ctrl+alt+0", "command": "claudeMultiUsage.launch" }  // args 없으면 선택창
```

---

## License
MIT © southglory
