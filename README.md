# Claude Multi-Account Usage

**English** · [한국어](README.ko.md)

> Claude Code usage & token cost for **every account at once** — always visible in your VS Code status bar.

[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/QG-devramyun.claude-multi-usage?label=VS%20Marketplace&logo=visualstudiocode&color=2d7d9a)](https://marketplace.visualstudio.com/items?itemName=QG-devramyun.claude-multi-usage)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/QG-devramyun.claude-multi-usage?color=2d7d9a)](https://marketplace.visualstudio.com/items?itemName=QG-devramyun.claude-multi-usage)
[![Rating](https://img.shields.io/visual-studio-marketplace/r/QG-devramyun.claude-multi-usage?color=2d7d9a)](https://marketplace.visualstudio.com/items?itemName=QG-devramyun.claude-multi-usage)
[![Open VSX](https://img.shields.io/open-vsx/v/QG-devramyun/claude-multi-usage?label=Open%20VSX&color=c160ef)](https://open-vsx.org/extension/QG-devramyun/claude-multi-usage)
[![Release](https://img.shields.io/github/v/release/southglory/claude-usage-bar?color=4e94ce)](https://github.com/southglory/claude-usage-bar/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

**Multiple accounts, side by side:**

![Multiple Claude accounts in the status bar](images/statusbar.png)

**Hover for usage, resets, and quick actions:**

![Hover tooltip: usage bars, resets, and Dashboard / Terminal / Cache / Settings](images/tooltip.png)

**A token-cost dashboard per account:**

![Dashboard: usage, token cost, by-project, burn rate, and history](images/dashboard.png)

## Overview

**Claude Multi-Account Usage** monitors your Claude Code usage in real time, without
leaving the editor. Most status-bar extensions only track a single `~/.claude`; if you
run more than one account — a personal and a work login, or any
[cc-switch](https://github.com/farion1231/cc-switch) `ccp`/`ccw` setup — the others are
invisible. This shows them **all**, side by side, and works even for an account you only
ever use in a terminal.

It reads session data from each account's `projects/` folder locally (no extra network
calls) and, for accounts without a cache file, queries the Anthropic API for rate-limit
utilization headers. All token costs are calculated client-side from configurable
per-token rates (defaults: Claude Sonnet 4.x pricing).

> [!NOTE]
> **API calls are minimal and stop when you do.** For an account that has no local
> usage cache, the rate-limit fetch fires **at most once every 5 minutes**, and after
> the first reading only when that account's session logs were updated within the
> window — so when you stop using Claude Code, the extension stops calling the API.
> Each call is a ~1-token `claude-haiku-4-5` request (≈ **$0.0001**); typical cost is
> **< $0.01 / month**. Set `claudeMultiUsage.fetchUsageViaApi: false` to make zero API
> calls (cache-only). Tune the cadence with `claudeMultiUsage.apiMinIntervalSeconds`.

> [!WARNING]
> **Cost figures are estimates.** They are the *API-equivalent value* of your token
> counts (which are exact), not your actual subscription bill, and they assume one price
> tier for all models. Defaults follow Anthropic's published Sonnet pricing at the time
> of writing — if pricing changes, update `claudeMultiUsage.pricing.*` to match the
> latest rates on the [Anthropic pricing page](https://www.anthropic.com/pricing).

## Features

- **N accounts, side by side** — no hard-coded names, no limit.
- **Auto-detect** — leave the list empty; it finds `.claude*` dirs in your home. Labels are the **folder name as-is** (`.claude`, `.claude-work`) — no parsing. Rename freely.
- **Works for terminal-only accounts** — fetches usage from the API when no cache file exists (see Overview).
- **Color warnings on both windows** — green → yellow → red; if 7d is maxed while 5h is fine, the bar still flips red and shows the 7d reset countdown.
- **Token-cost dashboard** — per-account today's spend, 5h/7d bars, cost tiles (5h / today / 7d / month), and a **Details** drawer with the 5h token breakdown, per-project costs, a 30-day history sparkline, and avg cost by hour.
- **Per-account terminal** — open a Claude terminal with that account's `CLAUDE_CONFIG_DIR` injected. Run several at once; no global switching.
- **cc-switch friendly** — set `command: "ccw"` / `"ccp"` to run your existing wrapper as-is.
- **Breathing quokka mascot** — a tiny pixel quokka (toggle/replace, or [draw your own](#make-your-own-mascot)).

## Data source

Per account, usage comes from one of two sources (in order):

1. **Cache file** — `<CLAUDE_CONFIG_DIR>/vscode-claude-status-cache.json`, written by Claude Code's VS Code integration. Free to read, but written for the **one** account VS Code polls — a terminal-only account never gets one.
2. **API fallback** (`fetchUsageViaApi`, on by default) — read the account's `.credentials.json` OAuth token and fetch usage from `api.anthropic.com` via the rate-limit response headers (see the Note above for cost/cadence).

Token cost is computed by scanning `projects/**` session logs for exact token counts ×
your configured pricing.

## Install

- **VS Code** — [**Marketplace**](https://marketplace.visualstudio.com/items?itemName=QG-devramyun.claude-multi-usage): search **"Claude Multi-Account Status Bar"**, or `ext install QG-devramyun.claude-multi-usage`.
- **Cursor / Windsurf / VSCodium** — [**Open VSX**](https://open-vsx.org/extension/QG-devramyun/claude-multi-usage): search the same name in the extensions panel.
- **From VSIX**: download from [Releases](https://github.com/southglory/claude-usage-bar/releases) → `code --install-extension claude-multi-usage-0.6.2.vsix`.
- **Dev run**: open this folder and press `F5`.

## Configure (`settings.json`)

```jsonc
"claudeMultiUsage.accounts": [
  { "label": ".claude",      "dir": "~/.claude" },
  { "label": ".claude-work", "dir": "~/.claude-work" }
  // labels are free text — name them whatever you like
],
"claudeMultiUsage.refreshIntervalSeconds": 30,
"claudeMultiUsage.warnAt": 0.5,                // yellow threshold
"claudeMultiUsage.critAt": 0.9,                // red threshold
"claudeMultiUsage.show7d": true,
"claudeMultiUsage.fetchUsageViaApi": true,     // usage for cache-less accounts
"claudeMultiUsage.apiMinIntervalSeconds": 300, // min 5 min between API fetches
"claudeMultiUsage.pricing.inputPerMillion": 3, // cost-estimate rates (USD / 1M)
"claudeMultiUsage.clickAction": "refresh"      // refresh | dashboard | launch | openCache
```

`dir` expands `~`, `%USERPROFILE%`, `${env:VAR}`. Auto-detect runs only when the list is
empty. **Left-click** runs `clickAction`; the hover tooltip has **Dashboard · Terminal ·
Cache · Settings** links (VS Code doesn't support a custom right-click menu on status
bar items).

## Add an account & first login

Open the **dashboard** (tooltip → *Dashboard*), expand **+ Add account**, enter a label
and config dir, then **Add & log in** — it opens a terminal with `CLAUDE_CONFIG_DIR` set
and runs `claude`, so a brand-new directory prompts you to sign in. Each card also has
**Log in**, **Open terminal**, and **Remove**.

## Account switching (cc-switch built in)

Opens a per-account terminal without touching global state:

1. **Env injection (default)** — no `command`: inject `CLAUDE_CONFIG_DIR`, then run `launchCommand` (default `claude`).
2. **cc-switch wrapper** — `command: "ccw"` / `"ccp"`: run that wrapper as-is.

## Keybindings

```jsonc
{ "key": "ctrl+alt+1", "command": "claudeMultiUsage.launch", "args": 0 }, // 1st account
{ "key": "ctrl+alt+0", "command": "claudeMultiUsage.launch" }            // no args → picker
```

## Make your own mascot

Don't like the quokka? Draw your own. Open **`tools/mascot-maker.html`** in any browser —
a pixel editor where you paint each frame, onion-skin the previous one, and preview the loop.

![Mascot Maker: pixel editor with frames and live animation preview](images/mascot-maker.png)

Export `mascot.json`, then build a font:

```sh
uv run --with fonttools python tools/build_mascot_font.py mascot.json mascot.ttf mascot
```

It prints the `contributes.icons` block and `characterFrames` value to paste in. Drop
`mascot.ttf` next to `package.json` and repackage.

**One-step (dev):** apply straight to the built-in mascot with `--apply` (keep it 2 frames):

```sh
uv run --with fonttools python tools/build_mascot_font.py mascot.json --apply
```

`--apply` only overwrites the **source** `quokka.ttf`. For the status bar to actually
change, the VS Code instance that uses the font has to reload it:

- **Developing (F5 Extension Development Host):** run `--apply`, then reload that window → done.
- **Your installed extension:** the installed copy has its own `quokka.ttf`, so also repackage + reinstall:
  ```sh
  npx @vscode/vsce package && code --install-extension claude-multi-usage-*.vsix --force
  ```
  then reload. If the glyph looks cached (same `E001`/`E002` codepoints), fully **restart** VS Code.

> Why no in-editor "Apply" button? A browser page can't write into an installed extension,
> and VS Code loads icon fonts statically — so a custom pixel mascot always needs a
> repackage. For an instant, no-rebuild change, set `claudeMultiUsage.characterFrames` to
> emojis/codicons instead.

> Pixel mascots need a bundled font. For a quick change without repackaging, set
> `claudeMultiUsage.characterFrames` to emojis/codicons, e.g. `["▃","▆"]`.

## Privacy & why it's open source

This extension reads sensitive local files — your accounts' `.credentials.json` OAuth
tokens — to fetch usage. Because of that, it's **fully open source on purpose**: read
the code, don't take my word for it.

- **Your tokens never leave your machine** except to call **`api.anthropic.com`** directly (the endpoint Claude Code uses), only to read your own usage. **No third-party server, no telemetry, no analytics.**
- The API fallback is **opt-out** (`fetchUsageViaApi: false`) and rate-limited (see the Note).
- All it reads under each config dir: `vscode-claude-status-cache.json`, `.credentials.json`, and `projects/**` token counts.

## Contributing

Issues and PRs welcome at <https://github.com/southglory/claude-usage-bar>. Plain
JavaScript (no build step); the mascot font and `.vsix` are generated by the scripts in
`tools/`.

---

## License & publishing

The source is [MIT](LICENSE)-licensed © southglory — free to read, use, fork, and modify.

> The Marketplace / Open VSX publisher **`QG-devramyun`** and the author **`southglory`** (GitHub) are the **same person** — not a re-upload of someone else's work.

**Please do not re-publish this extension** — or a renamed / derivative build — to the
VS Code Marketplace, Open VSX, or any other extension store. **`QG-devramyun` (a.k.a. `southglory`) is the sole
official publisher.** (The Marketplace also prohibits impersonation and duplicate
uploads, and "Claude" is a trademark of Anthropic.) Personal forks and pull requests are
very welcome — just don't ship a competing listing.
