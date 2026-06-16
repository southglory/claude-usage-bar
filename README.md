# Claude Multi-Account Usage

Show the **5-hour / 7-day usage** of *multiple* Claude accounts side by side in the
VS Code status bar — with progress bars, color thresholds, a breathing quokka
mascot, a usage dashboard, and one-click per-account terminals.

![status bar](icon.png)

---

## Why

Existing status-bar extensions (`long-kudo.vscode-claude-status`,
`Roki.claude-token-view`) hard-code `~/.claude` and ignore `CLAUDE_CONFIG_DIR`, so a
second account like `~/.claude-work` (cc-switch `ccw`) never appears. This extension
takes a list of accounts and reads each directory, so **N accounts** show on one line.

## Features

- **N accounts, side by side** — no hard-coded names, no limit.
- **Auto-detect** — leave the list empty; it finds `.claude*` dirs in your home. Labels show the **folder name as-is** (`.claude`, `.claude-work`) — no parsing, no imposed convention. Rename them to anything you like.
- **Add & log in from the dashboard** — add a second `.claude-…` account by name and open a terminal to sign in for the first time, all from the panel.
- **Progress bars** — a clean whole-cell bar per account (`██████▒▒ 75% · 36%`); filled `█` and empty `▒` are the same full-cell height, so the bar is a tidy rectangle.
- **Color thresholds** — green → yellow → red as usage rises; shows a reset countdown when the limit is reached.
- **Breathing quokka mascot** — a tiny 2-frame pixel quokka that bobs up and down (toggle/replace via settings).
- **Usage dashboard** — a webview panel with bars, reset timers, and refresh / terminal / cache buttons for every account.
- **Per-account terminal** — open a Claude terminal with that account's `CLAUDE_CONFIG_DIR` injected. No global switching — run several accounts at once.
- **cc-switch friendly** — set `command: "ccw"` / `"ccp"` to run your existing wrapper as-is.

## Data source

Reads the cache Claude Code writes per config dir (no parsing / estimation):

```jsonc
<CLAUDE_CONFIG_DIR>/vscode-claude-status-cache.json
{ "usageData": { "utilization5h": 0.29, "utilization7d": 0.04,
                 "reset5hAt": 1781493600, "reset7dAt": 1782054000,
                 "limitStatus": "allowed" } }
```

If an account has no cache yet (shown as `—`), run one Claude session with that
account to create it.

## Install

- **Dev run**: open this folder in VS Code and press `F5` (Extension Development Host).
- **From VSIX**: `code --install-extension southglory.claude-multi-usage-0.2.0.vsix` (or Extensions panel → ⋯ → *Install from VSIX…*).
- **Marketplace**: search "Claude Multi-Account Usage" (once published).

## Configure (`settings.json`)

```jsonc
"claudeMultiUsage.accounts": [
  { "label": ".claude",      "dir": "~/.claude" },
  { "label": ".claude-work", "dir": "~/.claude-work" }
  // labels are free text — name them whatever you like
],
"claudeMultiUsage.refreshIntervalSeconds": 30,
"claudeMultiUsage.progressBarLength": 8,
"claudeMultiUsage.warnAt": 0.5,            // yellow threshold
"claudeMultiUsage.critAt": 0.9,            // red threshold
"claudeMultiUsage.show7d": true,
"claudeMultiUsage.showCharacter": true,    // breathing quokka mascot
"claudeMultiUsage.enableAnimation": true,
"claudeMultiUsage.launchCommand": "claude", // default for accounts without `command`
"claudeMultiUsage.clickAction": "refresh"   // refresh | dashboard | launch | openCache
```

`dir` expands `~`, `%USERPROFILE%`, `${env:VAR}`. Auto-detect runs only when the list
is empty. Status bar example: `🦘 .claude ██▒▒▒▒▒▒ 29% · 4%   🦘 .claude-work █▒▒▒▒▒▒▒ 12% · 3%`
(first % = 5h, second = 7d).

**Left-click** runs `clickAction` (refresh by default). The hover tooltip has
clickable **Dashboard · Terminal · Cache · Settings** links — VS Code does not support
a custom right-click menu on status bar items, so these live in the tooltip.

## Add an account & first login

Open the **dashboard** (tooltip → *Dashboard*, or the *Open Usage Dashboard* command):

1. Under **Add account**, type a label (shown as-is, e.g. `.claude-work`) and a config dir (e.g. `~/.claude-work`).
2. **Add & log in** saves it and opens a terminal with `CLAUDE_CONFIG_DIR` set to that dir, then runs `claude` — a brand-new directory will prompt you to sign in. (**Add only** skips the terminal.)
3. Each account card also has **Log in** (re-auth), **Open terminal**, **Cache file**, and **Remove**.

## Account switching (cc-switch built in)

Opens a per-account terminal without touching global state. Two launch modes:

1. **Env injection (default)** — no `command`: inject `CLAUDE_CONFIG_DIR`, then run `launchCommand` (default `claude`). Works even without `ccw/ccp` aliases.
2. **cc-switch wrapper as-is** — `command: "ccw"` / `"ccp"`: run that wrapper directly (same as typing `ccw` in a normal terminal).

## Keybindings

```jsonc
{ "key": "ctrl+alt+1", "command": "claudeMultiUsage.launch", "args": 0 }, // 1st account
{ "key": "ctrl+alt+0", "command": "claudeMultiUsage.launch" }            // no args → picker
```

## Commands

`Claude Multi Usage: Open Usage Dashboard` · `Refresh` · `Open Settings` ·
`Open Cache File` · `Claude: Open Terminal for Account` · `Add Account` · `Remove Account`

## Build the mascot font

The quokka icon font is generated from a sprite:

```sh
uv run --with fonttools python tools/build_quokka_font.py
```

---

## License

MIT © southglory
