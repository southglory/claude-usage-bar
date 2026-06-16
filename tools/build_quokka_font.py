#!/usr/bin/env python
"""Build quokka.ttf — a tiny icon font with the 2-frame breathing quokka mascot.

Design goals (from feedback):
  * Vertical breathing. Frame 2 is the SAME silhouette translated up one pixel,
    so the mascot bobs up/down (not left/right).
  * No ghosting. A 1px shift of an identical shape overlaps almost completely, so
    nothing smears when the two frames alternate.
  * Clean. The sprite is symmetric and every row is exactly COLS wide (asserted at
    build time), so the feet line up.

Glyphs:
  U+E001 (quokka-0) — rest frame (feet at the baseline).
  U+E002 (quokka-1) — identical silhouette bobbed up 1px.

Run:  uv run --with fonttools python tools/build_quokka_font.py
"""
import os
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

# The original quokka sprite (from pixel_quokka_sprite.html), rendered as a SOLID
# silhouette: every non-"." cell is filled, so eyes/nose/belly are not cut out (the
# head reads as a clean quokka silhouette). The head is shortened (3 plain rows from
# the reference dropped) per earlier feedback. Every row is exactly COLS wide.
ROWS = [
    ".....KKKK...KKKK......",  # ears
    ".....KPPK...KPPK......",  # ears
    "....KKKKKKKKKKKKKK....",  # head top
    "....KBBBeeBBeeBBBK....",  # eyes (filled in silhouette)
    "....KBBBewBBewBBBK....",
    "....KBPBeeBBeeBPBK....",  # cheeks
    "....KBBBBBnnBBBBBK....",  # nose
    "....KBBBBnnnnBBBBK....",
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
    ".....KK........KK.....",  # feet
]

COLS = 22
ROWCOUNT = len(ROWS)
for i, r in enumerate(ROWS):
    assert len(r) == COLS, "row %d is %d chars, expected %d" % (i, len(r), COLS)

PX = 36
EM = 1000
TOPPAD = 2                       # rows of headroom above the ears (for the bob)
ASCENT = (ROWCOUNT + TOPPAD) * PX
DESCENT = 0
ADV = COLS * PX
BOB = PX                         # frame-2 vertical bob: one pixel up

# Filled cells of the silhouette (same shape for both frames).
CELLS = [(r, c) for r, line in enumerate(ROWS) for c, ch in enumerate(line) if ch != "."]


def draw(pen, dy):
    """Draw each cell as a filled square. Row 0 is at the top; the feet row sits
    just above the baseline. dy shifts the whole (identical) silhouette up."""
    for (r, c) in CELLS:
        x0 = c * PX
        y0 = (ROWCOUNT - 1 - r) * PX + dy
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
    order = [".notdef", "quokka0", "quokka1"]
    fb = FontBuilder(EM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({0xE001: "quokka0", 0xE002: "quokka1"})
    fb.setupGlyf({
        ".notdef": TTGlyphPen(None).glyph(),
        "quokka0": glyph(0),       # rest (feet at baseline)
        "quokka1": glyph(BOB),     # same silhouette, bobbed up 1px
    })
    fb.setupHorizontalMetrics({g: (ADV, 0) for g in order})
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    fb.setupNameTable({
        "familyName": "Quokka", "styleName": "Regular",
        "fullName": "Quokka", "psName": "Quokka-Regular",
    })
    fb.setupOS2(sTypoAscender=ASCENT, sTypoDescender=DESCENT,
                usWinAscent=ASCENT, usWinDescent=DESCENT)
    fb.setupPost()
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "quokka.ttf")
    fb.save(out)
    print("wrote", out, "rows=%d cols=%d px=%d" % (ROWCOUNT, COLS, PX))


if __name__ == "__main__":
    main()
