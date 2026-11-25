"""Process the Suntech app icon for the Electron app.

Steps:
  1. Load source PNG (RGBA), square it to the largest side.
  2. Composite over a solid #060B18 base and blend a #060B18 tint on top so the
     icon takes a cool blue-black undertone (corners become exactly #060B18).
  3. Apply rounded corners via an anti-aliased alpha mask.
  4. Export a high-res PNG (512) and a multi-size Windows .ico (16..256).

Pure Pillow; no network, deterministic.
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

UNDERTONE = (6, 11, 24)  # #060B18
TINT_OPACITY = 0.28  # how strongly the blue undertone is blended over the art
CORNER_RATIO = 0.18  # rounded-corner radius as a fraction of the icon size
SUPERSAMPLE = 4  # render the mask at higher res for smooth edges


def square(img: Image.Image) -> Image.Image:
    """Center the image on a transparent square canvas of side = max(w, h)."""
    w, h = img.size
    side = max(w, h)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(img, ((side - w) // 2, (side - h) // 2), img)
    return canvas


def apply_undertone(img: Image.Image) -> Image.Image:
    """Composite over a solid #060B18 base, then blend a #060B18 tint on top."""
    base = Image.new("RGBA", img.size, UNDERTONE + (255,))
    composited = Image.alpha_composite(base, img)

    tint = Image.new("RGBA", img.size, UNDERTONE + (255,))
    blended = Image.blend(composited, tint, TINT_OPACITY)
    # Keep full opacity for the square (corners handled by the round mask later).
    blended.putalpha(255)
    return blended


def rounded_mask(size: int, radius: int) -> Image.Image:
    """Anti-aliased rounded-rectangle alpha mask via supersampling."""
    from PIL import ImageDraw

    big = size * SUPERSAMPLE
    mask = Image.new("L", (big, big), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle(
        (0, 0, big - 1, big - 1),
        radius=radius * SUPERSAMPLE,
        fill=255,
    )
    return mask.resize((size, size), Image.LANCZOS)


def main() -> int:
    src = Path(sys.argv[1])
    out_dir = Path(sys.argv[2])
    out_dir.mkdir(parents=True, exist_ok=True)

    img = Image.open(src).convert("RGBA")
    img = square(img)

    size = 512
    img = img.resize((size, size), Image.LANCZOS)
    img = apply_undertone(img)

    radius = int(size * CORNER_RATIO)
    mask = rounded_mask(size, radius)
    img.putalpha(mask)

    png_path = out_dir / "app-icon.png"
    img.save(png_path, format="PNG")
    print(f"Wrote {png_path}")

    ico_path = out_dir / "app-icon.ico"
    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    img.save(ico_path, format="ICO", sizes=ico_sizes)
    print(f"Wrote {ico_path} with sizes {ico_sizes}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
