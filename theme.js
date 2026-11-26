// Status-bar themes — how one account's usage is drawn in the status bar.
//
//   default  quokka  ".claude ██████▒▒ 52% · 36%"     progress bar (the original look)
//   compact  quokka  ".claude ◑ 52% · ◔ 36%"         a pie glyph per window
//   micro    none    ".claude 🟢🟡 $(clock)$(clock)"
//                    — one emoji dot per window (5h, weekly) colored by its usage, then
//                      a 5h and a weekly clock. The clocks are in the tile's text color:
//                      the normal (white) color, until a window hits its limit; then the
//                      tile is tinted by how soon that window resets (see resetTint).
//
// `icon` and `usageStyle` default to "auto" (= the theme's choice) and can each be
// overridden independently. Pure Node (no vscode dependency) so it is unit-testable;
// extension.js maps the returned levels ("ok" | "warn" | "crit") to theme colors.
'use strict';

const THEMES = {
  default: { icon: 'quokka', usageStyle: 'progressBar' },
  compact: { icon: 'quokka', usageStyle: 'pieChart' },
  micro: { icon: 'none', usageStyle: 'dot' },
};

// Static codicons; "quokka" uses the (animated) characterFrames instead.
const ICONS = {
  sparkle: '$(sparkle)',
  pulse: '$(pulse)',
  robot: '$(hubot)',
  dashboard: '$(dashboard)',
};

const WINDOW_SEC = { '5h': 5 * 3600, '7d': 7 * 24 * 3600 };

/** Resolve the effective look from raw settings. Unknown values fall back to default. */
function resolveTheme({ theme, icon, usageStyle } = {}) {
  const name = THEMES[theme] ? theme : 'default';
  const t = THEMES[name];
  const ic = icon && icon !== 'auto' && (icon === 'quokka' || icon === 'none' || ICONS[icon]) ? icon : t.icon;
  const st = ['progressBar', 'pieChart', 'dot'].includes(usageStyle) ? usageStyle : t.usageStyle;
  return { theme: name, icon: ic, usageStyle: st };
}

/** Icon frames for a resolved icon: null → use characterFrames (quokka), [] → no icon. */
function iconFrames(icon) {
  if (icon === 'quokka') return null;
  if (icon === 'none') return [];
  return [ICONS[icon] || ICONS.sparkle];
}

const clamp01 = (p) => Math.max(0, Math.min(1, typeof p === 'number' && !isNaN(p) ? p : 0));

/** 0..1 → whole-cell progress bar ("██████▒▒"). */
const FILL = '█', EMPTY = '▒';
function bar(p, len) {
  const n = Math.max(0, Math.min(len, Math.round(clamp01(p) * len)));
  return FILL.repeat(n) + EMPTY.repeat(len - n);
}

/** 0..1 → one of five pie glyphs, rounded to the nearest quarter. */
const PIE = ['○', '◔', '◑', '◕', '●'];
function pie(p) {
  return PIE[Math.round(clamp01(p) * 4)];
}

/** Usage level for a 0..1 ratio (null when unknown). */
function usageLevel(u, warnAt, critAt) {
  if (typeof u !== 'number' || isNaN(u)) return null;
  return u >= critAt ? 'crit' : u >= warnAt ? 'warn' : 'ok';
}

/** epoch (seconds) → short remaining time "1h 23m" / "2d 4h" / "12m". */
function remain(epochSec, nowMs) {
  const diff = (epochSec || 0) * 1000 - nowMs;
  if (diff <= 0) return 'now';
  const m = Math.floor(diff / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  return h > 0 ? `${h}h ${m % 60}m` : `${m}m`;
}

/** Emoji dots keep their own color whatever the tile's text color is. */
const DOT = { ok: '🟢', warn: '🟡', crit: '🔴', unknown: '⚪' };
function dot(level) {
  return DOT[level] || DOT.unknown;
}

/** Clock level from how much of a window is still left before it resets:
 *  ≤ 25% left → ok (relief soon), ≤ 60% → warn, otherwise crit (a long wait). */
function clockLevel(resetAtSec, win, nowMs) {
  if (!resetAtSec) return null;
  const left = Math.max(0, resetAtSec * 1000 - nowMs) / (WINDOW_SEC[win] * 1000);
  return left <= 0.25 ? 'ok' : left <= 0.6 ? 'warn' : 'crit';
}

/** Tile tint for the dot style's clocks: null (normal color) unless a window has hit its
 *  limit (>= 100%, or blocked for 5h). Then the reset urgency of that window — and if
 *  both are in their reset period, the more urgent of the two. */
const RANK = { ok: 1, warn: 2, crit: 3 };
function resetTint(u, nowMs) {
  const inReset = [];
  if (u.blocked || (typeof u.u5 === 'number' && u.u5 >= 1)) inReset.push(clockLevel(u.reset5hAt, '5h', nowMs) || 'crit');
  if (typeof u.u7 === 'number' && u.u7 >= 1) inReset.push(clockLevel(u.reset7dAt, '7d', nowMs) || 'crit');
  return inReset.reduce((a, b) => (a && RANK[a] >= RANK[b] ? a : b), null);
}

/** Status-bar body text (without the icon), the usage level, and — for the dot style —
 *  the clock tint. u = { u5, u7, p5, p7, blocked, reset5hAt, reset7dAt }. */
function renderUsage(label, u, opts) {
  const { usageStyle, barLen = 8, show7d = true, warnAt = 0.5, critAt = 0.9, now = Date.now() } = opts;
  const u5full = typeof u.u5 === 'number' && u.u5 >= 1;
  const u7full = typeof u.u7 === 'number' && u.u7 >= 1;
  const full = u.blocked || u5full ? '5h' : u7full ? '7d' : null;
  const resetOf = (w) => (w === '7d' ? u.reset7dAt : u.reset5hAt);
  const pctTxt = (p) => (p == null ? '?' : p + '%');
  const lvl = Math.max(typeof u.u5 === 'number' ? u.u5 : 0, typeof u.u7 === 'number' ? u.u7 : 0);
  const level = usageLevel(lvl, warnAt, critAt);

  if (usageStyle === 'dot') {
    const d5 = dot(u.blocked ? 'crit' : usageLevel(u.u5, warnAt, critAt));
    const d7 = dot(usageLevel(u.u7, warnAt, critAt));
    return { body: `${label} ${d5}${d7} $(clock)$(clock)`, level, tint: resetTint(u, now) };
  }
  let body;
  if (full) {
    const mark = usageStyle === 'pieChart' ? pie(1) : bar(1, barLen);
    body = `${label} ${mark} ${full} reset ${remain(resetOf(full), now)}`;
  } else if (usageStyle === 'pieChart') {
    body = `${label} ${pie(u.u5)} ${pctTxt(u.p5)}`;
    if (show7d && u.p7 != null) body += ` · ${pie(u.u7)} ${u.p7}%`;
  } else {
    body = `${label} ${bar(u.u5, barLen)} ${pctTxt(u.p5)}`;
    if (show7d && u.p7 != null) body += ` · ${u.p7}%`;
  }
  return { body, level, tint: null };
}

module.exports = {
  THEMES, ICONS, resolveTheme, iconFrames, bar, pie, remain,
  usageLevel, dot, clockLevel, resetTint, renderUsage,
};
