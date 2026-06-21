# Changelog

All notable changes to **Claude Multi-Account Usage** are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/), and this
project adheres to [Semantic Versioning](https://semver.org/).

## [0.7.1] — 2026-06-21

### Fixed
- **Accurate "cc-switch installed" detection.** The shortcut feature previously reported "ready" even when [cc-switch](https://github.com/southglory/cc-switch) wasn't installed (it checked for the `~/.cc-switch` dir, which the extension creates itself). It now checks for cc-switch's install marker (`installed.json`) or the POSIX `cc-switch.sh`. When you set a shortcut without cc-switch installed, a **Set up cc-switch** button opens the install guide (already installed? re-run its installer once to register the marker).

## [0.7.0] — 2026-06-20

### Added
- **Smart Add-account form** — one **Name** field (a leading `.` is added automatically), the **config dir** auto-fills from it with a 📁 native folder picker, and an optional **Shortcut** field. Adding an account now also writes a profile (and optional alias) to [cc-switch](https://github.com/southglory/cc-switch)'s shared `~/.cc-switch/profiles.json`, so a terminal shortcut like `ccw` becomes available once cc-switch is installed. The extension never edits your shell rc files; cc-switch turns the alias into the shell command. (Adding an account whose dir matches an existing cc-switch profile updates that profile instead of duplicating it; a shortcut already taken by a *different* account is reported and skipped.)

## [0.6.4] — 2026-06-18

### Fixed
- **Usage now refreshes promptly for API-fallback accounts.** After a re-login the extension detects the rewritten `.credentials.json` and fetches immediately instead of waiting out the throttle (previously up to 5 minutes stale). A manual **Refresh** (status bar or dashboard button) now forces an immediate API fetch, and cached usage is refreshed once a rate-limit window has actually reset (day/window rollover) — all while preserving the polite "at most once per 5 min, stop when idle" polling policy and never double-firing a fetch that is already in flight.
- **Settings links pointed to the old publisher id.** "Open Settings" and the dashboard's pricing **edit** link used `@ext:southglory.…` and opened an empty filter; corrected to `@ext:QG-devramyun.claude-multi-usage`.

## [0.6.3] — 2026-06-18

### Changed
- Docs only: `cc-switch` links now point to [`southglory/cc-switch`](https://github.com/southglory/cc-switch) (the tool that defines the `ccp`/`ccw`/`ccx` account wrappers), with a note clarifying it is distinct from the similarly-named vendor/provider switcher `farion1231/cc-switch`.
- README: added direct **Marketplace** and **Open VSX** install links; trimmed duplicate Marketplace badges (kept version only).

## [0.6.2] — 2026-06-17

### Changed
- Renamed the marketplace **display name** to **Claude Multi-Account Status Bar** (the extension id `claude-multi-usage` is unchanged). No functional changes.
- Clarified in the README that the Marketplace/Open VSX publisher `QG-devramyun` and the GitHub author `southglory` are the same person.

## [0.6.0] — 2026-06-17

### Added
- **Considerate API polling** — a new `claudeMultiUsage.apiMinIntervalSeconds` setting (default 300). The rate-limit fetch now runs at most once per 5 minutes per account, and after the first reading only when that account's session logs were updated within the window — so when you stop using Claude Code, the API calls stop.
- Marketplace-grade README: status badges, an Overview, accurate Note/Warning callouts (API cost & cadence, cost-is-estimate), and screenshots of the status bar, hover tooltip, and dashboard.
- Korean README (`README.ko.md`) with a language switcher.

### Changed
- The tooltip now shows both the absolute reset time ("resets at …") and the relative one ("time until reset …"); the always-on "Status: allowed" line was dropped (it only shows when actually limited) and the data source moved to a dim footer.

## [0.5.0] — 2026-06-17

### Added
- **Mascot Maker** (`tools/mascot-maker.html`): a pixel editor with a color palette, custom color picker, Pencil / Fill / Eraser / Eyedropper tools, animation frames, onion-skin, a colored design preview, and a live single-color status-bar preview. Build a font from it with `tools/build_mascot_font.py` (`--apply` writes straight to the bundled `quokka.ttf`).

### Changed
- **Simpler dashboard** — one clean card per account (today's spend, 5h/7d bars, cost tiles) with everything advanced folded behind a single **Details** expander.

### Fixed
- A JSDoc comment containing `projects/**/*.jsonl` closed the block comment early and broke activation in 0.4.0. Fixed; the extension is now syntax-checked before packaging.

## [0.4.0] — 2026-06-16 [superseded by 0.5.0]

### Added
- **Token-cost dashboard** — per-account cost for 5h / today / 7 days / month, a 5h token breakdown, per-project costs, burn rate + 5h-limit prediction, a 30-day history sparkline, avg cost by hour, and configurable pricing (`pricing.*`, `dailyBudget`). Cost is computed from exact token counts in the session logs × pricing (an API-equivalent estimate, not your subscription bill).
- Status-bar warning that watches both windows: the bar flips to a `7d reset …` countdown when 7d is maxed, and a bold error background badge appears at critical usage.

> This build shipped with a comment bug that prevented activation — use 0.5.0+.

## [0.3.0] — 2026-06-16

### Added
- **API usage fallback** (`fetchUsageViaApi`, on by default) — for an account with no `vscode-claude-status-cache.json`, read its `.credentials.json` OAuth token and fetch usage directly from `api.anthropic.com` via the rate-limit response headers. This is the only way to show usage for an account used only in a terminal.

## [0.2.0] — 2026-06-16

### Added
- Per-account progress bars, color thresholds, a usage dashboard webview, and a breathing pixel **quokka mascot** (custom icon font).
- Add-account + first-login flow in the dashboard.

### Changed
- Split into its own repository and republished under publisher **southglory**.
- Entire UI and docs converted to English.
- Labels now show the config-folder name as-is (`.claude`, `.claude-work`) — no name parsing.

## [0.1.0]

### Added
- Initial release: show 5h / 7d usage for multiple Claude accounts side by side in the VS Code status bar, reading each config dir's `vscode-claude-status-cache.json`, with per-account terminal launch and cc-switch (`ccp`/`ccw`) support.

[0.7.1]: https://github.com/southglory/claude-usage-bar/releases/tag/v0.7.1
[0.7.0]: https://github.com/southglory/claude-usage-bar/releases/tag/v0.7.0
[0.6.4]: https://github.com/southglory/claude-usage-bar/releases/tag/v0.6.4
[0.6.3]: https://github.com/southglory/claude-usage-bar/releases/tag/v0.6.3
[0.6.2]: https://github.com/southglory/claude-usage-bar/releases/tag/v0.6.2
[0.6.0]: https://github.com/southglory/claude-usage-bar/releases/tag/v0.6.0
[0.5.0]: https://github.com/southglory/claude-usage-bar/releases/tag/v0.5.0
[0.4.0]: https://github.com/southglory/claude-usage-bar/releases/tag/v0.4.0
[0.3.0]: https://github.com/southglory/claude-usage-bar/releases/tag/v0.3.0
[0.2.0]: https://github.com/southglory/claude-usage-bar/releases/tag/v0.2.0
