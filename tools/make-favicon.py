#!/usr/bin/env python3
"""Rebuild assets/favicon-v2.ico.

The mark is the site's own: three bars that accumulate, the same idea the
hero animation draws at full size — owned attention compounds, rented
attention does not. Lemon on the site's background, so the tab reads as
DATRUM at 16 pixels and not as a black spike from a template.

Each size is drawn at its own resolution rather than downsampled from one
big one. A favicon is read at 16px more often than anywhere else, and a
resampled edge there turns into grey mush.

    python3 tools/make-favicon.py
"""
from PIL import Image, ImageDraw

BG = (12, 27, 31, 255)        # --bg      #0C1B1F
LEMON = (242, 210, 75, 255)   # --lemon   #F2D24B

# size: (margin, bar width, gap, [heights from the baseline])
PLAN = {
    16: (2, 3, 2, [5, 8, 11]),
    32: (4, 6, 4, [10, 16, 22]),
    48: (6, 9, 6, [15, 24, 33]),
    64: (8, 12, 8, [20, 32, 44]),
}


def draw(size):
    m, w, gap, heights = PLAN[size]
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)

    span = len(heights) * w + (len(heights) - 1) * gap
    x = (size - span) // 2          # centred, so the tab icon is not lopsided
    baseline = size - m

    for h in heights:
        d.rectangle([x, baseline - h, x + w - 1, baseline - 1], fill=LEMON)
        x += w + gap
    return img


if __name__ == "__main__":
    sizes = sorted(PLAN)
    frames = [draw(s) for s in sizes]
    frames[-1].save("assets/favicon-v2.ico", format="ICO",
                    sizes=[(s, s) for s in sizes],
                    append_images=frames[:-1])
    print("wrote assets/favicon-v2.ico:", ", ".join(f"{s}x{s}" for s in sizes))
