#!/usr/bin/env python
"""Build quokka.ttf — a tiny icon font with the 2-frame breathing quokka mascot.

Design goals (from feedback):
  * No ghosting. The body and feet are PIXEL-IDENTICAL in both frames and never
    move, so nothing smears when the two frames alternate.
  * Clean down-state. The sprite is symmetric and every row is exactly COLS wide
    (asserted at build time), so the feet line up.
  * Breathing is ADDITIVE only — frame 2 just adds a few pixels (ears perk up 1px,
    chest puffs out 1px). Pixels appear/disappear at the edges; none shift.

Glyphs:
  U+E001 (quokka-0) — rest frame.
  U+E002 (quokka-1) — rest frame + the additive breath pixels.

Run:  uv run --with fonttools python tools/build_quokka_font.py
"""
import os
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

# Solid silhouette, symmetric about the vertical centre. Every row is COLS wide.
ROWS = [
    ".....KK........KK.....",  # 0  ear tips   (cols 5-6, 15-16)
    "....KKKK......KKKK....",  # 1  ears       (cols 4-7, 14-17)
    "....KKKKKKKKKKKKKK....",  # 2  head top   (cols 4-17)
    "...KKKKKKKKKKKKKKKK...",  # 3  face       (cols 3-18)
    "...KKKKKKKKKKKKKKKK...",  # 4  face
    "...KKKKKKKKKKKKKKKK...",  # 5  face
    "....KKKKKKKKKKKKKK....",  # 6  chin       (cols 4-17)
    "..KKKKKKKKKKKKKKKKKK..",  # 7  shoulders  (cols 2-19)
    ".KKKKKKKKKKKKKKKKKKKK.",  # 8  body       (cols 1-20)
    ".KKKKKKKKKKKKKKKKKKKK.",  # 9  belly  (puffs out 1px in frame 2)
    ".KKKKKKKKKKKKKKKKKKKK.",  # 10 belly  (puffs out 1px in frame 2)
    ".KKKKKKKKKKKKKKKKKKKK.",  # 11 belly  (puffs out 1px in frame 2)
    "..KKKKKKKKKKKKKKKKKK..",  # 12 taper     (cols 2-19)
    "..KKKKKKKKKKKKKKKKKK..",  # 13 taper
    "...KKKKKKKKKKKKKKKK...",  # 14            (cols 3-18)
    "....KKKKKKKKKKKKKK....",  # 15            (cols 4-17)
    "....KKKKKKKKKKKKKK....",  # 16
    ".....KKKKKKKKKKKK.....",  # 17 lower body (cols 5-16)
    ".....KKK......KKK.....",  # 18 legs       (cols 5-7, 14-16)
    ".....KKK......KKK.....",  # 19 feet
]

COLS = 22
ROWCOUNT = len(ROWS)
for i, r in enumerate(ROWS):
    assert len(r) == COLS, "row %d is %d chars, expected %d" % (i, len(r), COLS)

PX = 36
EM = 1000
TOPPAD = 2                       # rows of headroom above the ears (for the perk)
ASCENT = (ROWCOUNT + TOPPAD) * PX
DESCENT = 0
ADV = COLS * PX

# Rest-frame cells.
CELLS0 = [(r, c) for r, line in enumerate(ROWS) for c, ch in enumerate(line) if ch != "."]

# Additive "breath" pixels for frame 2 — nothing in CELLS0 moves.
EAR_PERK = [(-1, 5), (-1, 6), (-1, 15), (-1, 16)]      # ear tips rise 1px
CHEST_PUFF = [(r, 0) for r in (9, 10, 11)] + [(r, 21) for r in (9, 10, 11)]  # belly +1px each side
CELLS1 = CELLS0 + EAR_PERK + CHEST_PUFF


def draw(pen, cells):
    """Draw each cell as a filled square. Row 0 is at the top; the feet row sits
    just above the baseline, identically in both frames (feet grounded)."""
    for (r, c) in cells:
        x0 = c * PX
        y0 = (ROWCOUNT - 1 - r) * PX        # row -1 lands one pixel above the ears
        x1, y1 = x0 + PX, y0 + PX
        pen.moveTo((x0, y0))
        pen.lineTo((x0, y1))
        pen.lineTo((x1, y1))
        pen.lineTo((x1, y0))
        pen.closePath()


def glyph(cells):
    pen = TTGlyphPen(None)
    draw(pen, cells)
    return pen.glyph()


def main():
    order = [".notdef", "quokka0", "quokka1"]
    fb = FontBuilder(EM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({0xE001: "quokka0", 0xE002: "quokka1"})
    fb.setupGlyf({
        ".notdef": TTGlyphPen(None).glyph(),
        "quokka0": glyph(CELLS0),
        "quokka1": glyph(CELLS1),
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
