#!/usr/bin/env python3
"""Extract the 12 chess-piece sprites used by Agent Chess.

Source: Epic Chess CC0 sprite pack (polyy.ai, CC0 1.0).
The pack stores 30 rotations of each piece in a 8x4 sprite sheet.
Frame 21 is the 3/4 view that reads best on a top-down board.

Run from the project root:
    python3 scripts/extract-pieces.py
"""

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = Path("/mnt/sdcard/AI/aiagent/🎮GAMES/EPIC-CHESS/assets/model sprite all in one/sprite/96px_studio")
OUT = ROOT / "app" / "assets" / "pieces"
PIECES = ["king", "queen", "rook", "bishop", "knight", "pawn"]
FRAME = 21
SIZE = 96


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for piece in PIECES:
        for color in ("light", "dark"):
            src = SRC / f"deco_{piece}_{color}_nopalette.png"
            im = Image.open(src)
            col, row = FRAME % 8, FRAME // 8
            frame = im.crop((col * SIZE, row * SIZE, (col + 1) * SIZE, (row + 1) * SIZE))
            name = f"{piece}-{'w' if color == 'light' else 'b'}.png"
            frame.save(OUT / name, optimize=True)
            print(f"{name:16} {frame.size} {len(frame.tobytes())} bytes raw")


if __name__ == "__main__":
    main()
