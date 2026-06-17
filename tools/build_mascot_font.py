#!/usr/bin/env python
"""Build a mascot icon font from frames designed in tools/mascot-maker.html.

Input JSON (what the maker exports):
  {
    "name": "Quokka",          # font family name (optional)
    "px": 36,                  # pixel size in font units (optional, default 36)
    "frames": [                # 1..N frames, each a list of equal-length rows
      ["..##..", ".####.", ...],   # any char except "." and " " is a filled pixel
      ...
    ]
  }

Each frame becomes one glyph at U+E001, U+E002, … so the extension can reference
them as $(<icon>-0), $(<icon>-1), … via contributes.icons.

Usage:
  uv run --with fonttools python tools/build_mascot_font.py <frames.json> [out.ttf] [icon-name]

It writes the .ttf (default ./mascot.ttf) and prints ready-to-paste snippets for
package.json `contributes.icons` and the `characterFrames` setting.
"""
import json
import os
import sys
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

FILLED = lambda ch: ch not in (".", " ", "")


def load(path):
    spec = json.load(open(path, encoding="utf-8"))
    frames = spec.get("frames") or []
    if not frames:
        raise SystemExit("no frames in " + path)
    cols = max(len(r) for f in frames for r in f)
    rows = max(len(f) for f in frames)
    # normalise: pad every row to `cols` and every frame to `rows`
    norm = []
    for f in frames:
        f = [r.ljust(cols, ".") for r in f]
        while len(f) < rows:
            f.append("." * cols)
        norm.append(f)
    return spec, norm, cols, rows


def glyph(frame, cols, rows, px):
    pen = TTGlyphPen(None)
    for r, line in enumerate(frame):
        for c, ch in enumerate(line):
            if not FILLED(ch):
                continue
            x0, y0 = c * px, (rows - 1 - r) * px  # row 0 at top, last row on baseline
            x1, y1 = x0 + px, y0 + px
            pen.moveTo((x0, y0)); pen.lineTo((x0, y1))
            pen.lineTo((x1, y1)); pen.lineTo((x1, y0)); pen.closePath()
    return pen.glyph()


def main():
    argv = [a for a in sys.argv[1:] if not a.startswith("-")]
    apply = "--apply" in sys.argv
    if not argv:
        raise SystemExit("usage: build_mascot_font.py <frames.json> [out.ttf] [icon-name] | --apply")
    inp = argv[0]
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if apply:
        # Overwrite the bundled quokka font the extension already references, so a
        # reload (F5) / repackage shows the new mascot — no snippet pasting.
        out = os.path.join(repo, "quokka.ttf")
        icon = "quokka"
    else:
        out = argv[1] if len(argv) > 1 else "mascot.ttf"
        icon = argv[2] if len(argv) > 2 else "mascot"
    spec, frames, cols, rows = load(inp)
    px = int(spec.get("px", 36))
    name = spec.get("name", "Mascot")
    em = 1000
    ascent = (rows + 1) * px
    adv = cols * px

    order = [".notdef"] + [f"f{i}" for i in range(len(frames))]
    fb = FontBuilder(em, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap({0xE001 + i: f"f{i}" for i in range(len(frames))})
    glyphs = {".notdef": TTGlyphPen(None).glyph()}
    for i, f in enumerate(frames):
        glyphs[f"f{i}"] = glyph(f, cols, rows, px)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics({g: (adv, 0) for g in order})
    fb.setupHorizontalHeader(ascent=ascent, descent=0)
    fb.setupNameTable({"familyName": name, "styleName": "Regular",
                       "fullName": name, "psName": name + "-Regular"})
    fb.setupOS2(sTypoAscender=ascent, sTypoDescender=0, usWinAscent=ascent, usWinDescent=0)
    fb.setupPost()
    fb.save(out)

    ttf = os.path.basename(out)
    print(f"\nwrote {out}  ({len(frames)} frame(s), {cols}x{rows}, px={px})\n")

    if apply:
        if len(frames) == 2:
            print("Applied to quokka.ttf. Reload VS Code (F5) or repackage to see it —")
            print("package.json already references quokka-0 / quokka-1, nothing else to change.")
            return
        print(f"Applied to quokka.ttf, but you have {len(frames)} frames (default config "
              "expects 2). Update package.json contributes.icons + characterFrames below:\n")

    print("-- package.json contributes.icons --")
    for i in range(len(frames)):
        cp = "%04X" % (0xE001 + i)
        print(f'  "{icon}-{i}": {{ "description": "{name} frame {i}", '
              f'"default": {{ "fontPath": "{ttf}", "fontCharacter": "\\\\{cp}" }} }},')
    print("\n-- claudeMultiUsage.characterFrames setting --")
    print("  [" + ", ".join(f'"$({icon}-{i})"' for i in range(len(frames))) + "]")
    if not apply:
        print("\n(Drop the .ttf next to package.json, paste the icons block, then set characterFrames.)")


if __name__ == "__main__":
    main()
