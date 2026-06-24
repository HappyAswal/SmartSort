"""
make_icon.py - Generates SmartSort.ico for the desktop shortcut.
Run once: python make_icon.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

def make_frame(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad = max(2, size // 16)

    # Background rounded square (indigo)
    d.rounded_rectangle(
        [pad, pad, size - pad, size - pad],
        radius=size // 5,
        fill=(99, 102, 241, 255),
    )

    # Camera body (white rectangle)
    bx1 = size * 0.18
    by1 = size * 0.30
    bx2 = size * 0.82
    by2 = size * 0.76
    d.rounded_rectangle([bx1, by1, bx2, by2], radius=size // 10, fill=(255, 255, 255, 240))

    # Lens (circle)
    cx, cy, r = size * 0.5, size * 0.53, size * 0.17
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(99, 102, 241, 255))
    r2 = r * 0.55
    d.ellipse([cx - r2, cy - r2, cx + r2, cy + r2], fill=(180, 200, 255, 220))

    # Viewfinder bump (small rectangle top centre)
    vw = size * 0.18
    d.rounded_rectangle(
        [size * 0.5 - vw / 2, size * 0.24, size * 0.5 + vw / 2, size * 0.32],
        radius=size // 16,
        fill=(255, 255, 255, 240),
    )

    return img

out = Path(__file__).parent / "smartsort.ico"
sizes = [256, 128, 64, 48, 32, 16]
frames = [make_frame(s) for s in sizes]
frames[0].save(
    str(out),
    format="ICO",
    sizes=[(s, s) for s in sizes],
    append_images=frames[1:],
)
print(f"Icon saved to {out}")
