#!/usr/bin/env python
"""Build quokka.ttf — a tiny icon font with the 2-frame breathing quokka mascot.

Frame glyphs:
  U+E001 (quokka-0) — quokka at rest (sits at the baseline).
  U+E002 (quokka-1) — the SAME silhouette translated up by one pixel row.

Both glyphs are the identical silhouette at the identical inked height, so the
status-bar mascot never appears to grow or shrink — it just bobs up/down 1px
(a gentle "breathing" loop). All vertical heights are equal by construction.

Run:  uv run --with fonttools python tools/build_quokka_font.py
"""
import os
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

# ---------------------------------------------------------------------------
# Sprite — solid silhouette (every non-"." cell is filled; the only "." inside
# the shape is the gap between the two ears, which we keep). Eyes/nose/belly are
# not cut out, so the head reads as a clean silhouette.
# Head shortened (a few plain head rows dropped) per earlier feedback.
SPRITE = [
    ".....KKKK...KKKK......",  # ear tops
    ".....KPPK...KPPK......",  # ears
    "....KKKKKKKKKKKKKK....",  # head top
    "....KBBBBBBBBBBBBK....",  # head
    "....KBBBBBBBBBBBBK....",  # (eyes — filled, no holes)
    "....KBBBBBBBBBBBBK....",  # (nose — filled)
    "....KBBBBBBBBBBBBK....",  # chin
    "...KBBBBBBBBBBBBBBK...",  # shoulders
    "...KBBBBLLLLLLBBBBK...",  # belly
    "..KBBBBBLLLLLLBBBBBK..",
    ".KBBBBBBLLLLLLBBBBBBK.",
    ".KBBBBBBLLLLLLBBBBBBK.",
    "..KBBBBBLLLLLLBBBBBK..",
    "..KBBBBBLLLLLLBBBBBK..",
    "...KBBBBLLLLLLBBBBK...",
    "...KBBBBBBBBBBBBBBK...",
    "...KBBBBBBBBBBBBBBK...",
    "....KBBBBBBBBBBBBK....",
    "....KBBKKKKKKKKBBK....",  # feet base
    ".....KK........KK....",  # feet
]

COLS = max(len(r) for r in SPRITE)
ROWS = len(SPRITE)
PX = 36                      # pixel size in font units
EM = 1000
ASCENT = (ROWS + 2) * PX     # headroom so the +1px bob never clips
DESCENT = 0
BOB = PX                     # frame-2 vertical bob: exactly one pixel row

# Filled cells (row, col): everything that is not "." in the sprite.
CELLS = [(r, c)
         for r, line in enumerate(SPRITE)
         for c, ch in enumerate(line)
         if ch != "."]

# Horizontal centering inside the advance width.
ADV = COLS * PX


def draw(pen, dy):
    """Draw every sprite cell as a filled square; row 0 is at the top.

    dy shifts the whole silhouette up by dy font units (used for the bob)."""
    for (r, c) in CELLS:
        x0 = c * PX
        # row 0 -> top; feet row -> just above the baseline.
        y0 = (ROWS - 1 - r) * PX + dy
        x1, y1 = x0 + PX, y0 + PX
        pen.moveTo((x0, y0))
        pen.lineTo((x0, y1))
        pen.lineTo((x1, y1))
        pen.lineTo((x1, y0))
        pen.closePath()


def glyph(dy):
    pen = TTGlyphPen(None)
    draw(pen, dy)
    return pen.glyph()


def main():
    glyph_order = [".notdef", "quokka0", "quokka1"]
    fb = FontBuilder(EM, isTTF=True)
    fb.setupGlyphOrder(glyph_order)
    fb.setupCharacterMap({0xE001: "quokka0", 0xE002: "quokka1"})

    glyphs = {
        ".notdef": TTGlyphPen(None).glyph(),
        "quokka0": glyph(0),      # at rest
        "quokka1": glyph(BOB),    # same shape, bobbed up 1px (equal height)
    }
    fb.setupGlyf(glyphs)

    metrics = {g: (ADV, 0) for g in glyph_order}
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    fb.setupNameTable({
        "familyName": "Quokka",
        "styleName": "Regular",
        "fullName": "Quokka",
        "psName": "Quokka-Regular",
    })
    fb.setupOS2(sTypoAscender=ASCENT, sTypoDescender=DESCENT,
                usWinAscent=ASCENT, usWinDescent=DESCENT)
    fb.setupPost()

    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "quokka.ttf")
    fb.save(out)
    print("wrote", out, "rows=%d cols=%d px=%d em=%d" % (ROWS, COLS, PX, EM))


if __name__ == "__main__":
    main()
