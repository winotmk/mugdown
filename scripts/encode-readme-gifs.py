"""Encode the captured UI frames. Run with Python and Pillow."""

import json
from pathlib import Path

from PIL import Image

for name in ("toolbar", "themes", "windows", "toolbar-en", "themes-en", "windows-en"):
    root = Path(".qa/readme-frames") / name
    timeline = json.loads((root / "timeline.json").read_text(encoding="utf-8"))
    images = []
    for frame in timeline:
        with Image.open(root / frame["file"]) as image:
            images.append(image.convert("RGB").quantize(colors=192, dither=Image.Dither.NONE))
    output = Path("docs/media") / f"{name}.gif"
    images[0].save(
        output,
        save_all=True,
        append_images=images[1:],
        duration=[frame["duration"] for frame in timeline],
        loop=0,
        optimize=True,
        disposal=1,
    )
    print(f"{output}: {output.stat().st_size:,} bytes")
