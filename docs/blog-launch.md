# I run two Claude accounts. My VS Code status bar only showed one. So I built this.

If you use Claude Code with more than one login — a personal account and a work one,
or any [cc-switch](https://github.com/farion1231/cc-switch) `ccp`/`ccw` setup — you've
probably hit this: every Claude usage extension only watches a single `~/.claude`.
Your second account is invisible. You burn through its 5-hour limit with zero warning,
because nothing is showing it to you.

**Claude Multi-Account Usage** fixes that. It shows the 5h / 7d usage of **every**
Claude account, side by side, right in the status bar.

![Multiple Claude accounts in the status bar](https://github.com/southglory/claude-usage-bar/raw/HEAD/images/statusbar.png)

## What it does

- **All your accounts on one line.** No hard-coded names, no limit. Each shows a progress bar and `5h% · 7d%`.
- **Hover for the details** — usage bars, exact reset times, and quick actions (Dashboard / Terminal / Cache / Settings).

  ![Hover tooltip](https://github.com/southglory/claude-usage-bar/raw/HEAD/images/tooltip.png)

- **Color warnings that watch *both* windows.** If your 7-day limit is maxed while 5h is fine, the bar still flips red and shows the 7d reset countdown — you won't get blindsided.
- **One-click per-account terminal** with the right `CLAUDE_CONFIG_DIR` injected. Run several accounts at once; no global switching.
- **A breathing quokka mascot**, because why not. (You can even draw your own.)

## The clever part: it works even for terminal-only accounts

Here's the catch every other extension trips on. The `vscode-claude-status-cache.json`
file (where usage lives) is written by Claude Code's VS Code integration — but **only
for the one account VS Code itself polls**. A second account you use purely in a
terminal never gets that file.

So for those accounts, this extension reads the account's own OAuth token and fetches
usage **straight from the Anthropic API**, parsing the `anthropic-ratelimit-unified-*`
response headers. Result: real 5h/7d numbers for accounts that have *no* cache file at all.

## Bonus: a token-cost dashboard

Open the dashboard and each account becomes a clean card: today's spend, 5h/7d bars,
and cost tiles for 5h / today / 7 days / month. A single **Details** drawer adds the
5h token breakdown, per-project costs, a 30-day history sparkline, and average cost by hour.

**Honest about the numbers:** cost is computed by reading the exact token counts from
your session logs and multiplying by per-million pricing (editable in settings). The
*token counts are exact*; the dollar figure is an **API-equivalent estimate**, not your
actual subscription bill — the same approach `ccusage`/`long-910` use.

## Free, open source, and auditable

It reads your local Claude credentials, so it's MIT-licensed and fully open on purpose:
tokens only ever go to `api.anthropic.com` (no third-party server, no telemetry), and
the API fetch is opt-out. Don't trust it — read the code.

**https://github.com/southglory/claude-usage-bar**

Grab the `.vsix` from [Releases](https://github.com/southglory/claude-usage-bar/releases), or:

```
code --install-extension claude-multi-usage-0.5.0.vsix
```

If you juggle more than one Claude login, give it a try — and a ⭐ if it saves you a
surprise rate-limit. Issues and PRs welcome.
