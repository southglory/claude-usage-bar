# Claude Multi-Account Usage

> See the **5h / 7d usage of every Claude account at once** in the VS Code status bar — with progress bars, color warnings, a breathing quokka mascot, and a token-cost dashboard.

Most Claude status-bar extensions only track a single `~/.claude`. If you run more
than one account — a personal and a work login, or any [cc-switch](https://github.com/farion1231/cc-switch)
`ccp`/`ccw` setup — the others are invisible. **Claude Multi-Account Usage** shows
them all, side by side, and works even for an account you only ever use in a terminal.

Free, MIT-licensed, and fully open source — it reads your local Claude credentials, so
[every line is auditable](#privacy--why-its-open-source).

**Multiple accounts on one line:**

![Multiple Claude accounts in the status bar](images/statusbar.png)

**Hover any account for usage, resets, and quick actions:**

![Hover tooltip: usage bars, resets, and Dashboard / Terminal / Cache / Settings](images/tooltip.png)

## Features

- **N accounts, side by side** — no hard-coded names, no limit.
- **Auto-detect** — leave the list empty; it finds `.claude*` dirs in your home. Labels show the **folder name as-is** (`.claude`, `.claude-work`) — no parsing, no imposed convention. Rename them to anything you like.
- **Add & log in from the dashboard** — add a second `.claude-…` account by name and open a terminal to sign in for the first time, all from the panel.
- **Progress bars** — a clean, uniform-height bar per account next to the 5h · 7d percentages (see the screenshot above).
- **Color thresholds** — green → yellow → red as usage rises; shows a reset countdown when the limit is reached.
- **Breathing quokka mascot** — a tiny 2-frame pixel quokka that bobs up and down (toggle/replace via settings).
- **Usage dashboard** — one clean card per account: today's spend, 5h/7d bars, and **token-cost tiles** (5h / today / 7d / month). A single **Details** expander reveals the 5h token breakdown, per-project costs, a 30-day history sparkline, and avg cost by hour. Cost = token counts (read from the session logs) × pricing — an API-equivalent estimate, not your subscription bill.
- **Per-account terminal** — open a Claude terminal with that account's `CLAUDE_CONFIG_DIR` injected. No global switching — run several accounts at once.
- **cc-switch friendly** — set `command: "ccw"` / `"ccp"` to run your existing wrapper as-is.

## Data source

Per account, usage comes from one of two sources (in order):

1. **Cache file** — `<CLAUDE_CONFIG_DIR>/vscode-claude-status-cache.json`, written by Claude Code's VS Code integration. Free to read, but Claude Code only writes it for the **one** account VS Code polls — a second account used only in a terminal never gets one.

   ```jsonc
   { "usageData": { "utilization5h": 0.29, "utilization7d": 0.04,
                    "reset5hAt": 1781493600, "reset7dAt": 1782054000,
                    "limitStatus": "allowed" } }
   ```

2. **API fallback** (`fetchUsageViaApi`, on by default) — if there's no cache file, read the account's `.credentials.json` OAuth token and fetch its usage straight from `api.anthropic.com` via the rate-limit response headers (the method `long-kudo.vscode-claude-status` uses). This is the only way to show a second account's usage. It sends a tiny 1-token request per refresh; the tooltip shows `via API` vs `via cache`. Turn it off to use cache files only.

If an account has neither a cache nor credentials yet, use **Log in** (dashboard or tooltip) to sign in and create `.credentials.json`.

## Install

- **Dev run**: open this folder in VS Code and press `F5` (Extension Development Host).
- **From VSIX**: `code --install-extension southglory.claude-multi-usage-0.5.0.vsix` (or Extensions panel → ⋯ → *Install from VSIX…*).
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
is empty. Each account shows as `<quokka> <label> <bar> <5h>% · <7d>%` (see the
status-bar screenshot above) — the first % is the 5h window, the second is 7d.

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

## Privacy & why it's open source

This extension reads sensitive local files — your accounts' `.credentials.json`
OAuth tokens — to fetch usage. Because of that, it is **fully open source on
purpose**: don't take my word for it, read the code.

- **Your tokens never leave your machine** except to call **`api.anthropic.com`**
  directly (the same endpoint Claude Code uses), only to read your own usage. There
  is **no third-party server, no telemetry, no analytics.**
- The API fallback is **opt-out** — set `claudeMultiUsage.fetchUsageViaApi: false`
  to use only the local cache files and make zero network calls.
- All it ever reads under each config dir: `vscode-claude-status-cache.json`,
  `.credentials.json`, and `projects/**` token counts (for the cost estimate).

If you spot anything off, open an issue or PR — that's the point of MIT.

## Contributing

Issues and pull requests welcome at
<https://github.com/southglory/claude-usage-bar>. The extension is plain
JavaScript (no build step); the mascot font and `.vsix` are generated by the
scripts in `tools/`.

---

## License

[MIT](LICENSE) © southglory — free to use, fork, and modify.
