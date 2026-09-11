"""Download Inter Semibold and subset it to the exact string LaserCarvingCover carves.

Kept in sync with components/LaserCarvingCover.tsx: WEIGHT / TEXT must match that
file's FONT_URL and EN_TEXT, or the cover silently falls back to its non-carved mode.
fonts.googleapis.com is unreachable from this network, so we pull the woff2 from
jsDelivr and subset locally. Requires fontTools (`pip install fonttools brotli`).
"""
import urllib.request
import os
from fontTools.ttLib import TTFont
from fontTools.subset import Subsetter, Options
from io import BytesIO

FAMILY = "inter"
WEIGHT = 600
TEXT = "Welcome to Ninglo's World."
OUT_NAME = "inter-600-subset.ttf"
SRC_URL = f"https://cdn.jsdelivr.net/npm/@fontsource/{FAMILY}@5.2.8/files/{FAMILY}-latin-{WEIGHT}-normal.woff2"

# Output goes to the repo-root public/, not scripts/public/.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_PATH = os.path.join(REPO_ROOT, "public", OUT_NAME)

req = urllib.request.Request(
    SRC_URL,
    headers={
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                      "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    },
)

with urllib.request.urlopen(req, timeout=30) as resp:
    font_data = resp.read()
print(f"Downloaded {len(font_data)} bytes from {SRC_URL}")

font = TTFont(BytesIO(font_data))
print(f"Font tables: {list(font.keys())}")

options = Options()
options.hinting = False
options.desubroutinize = True
subsetter = Subsetter(options=options)
subsetter.populate(text=TEXT)
subsetter.subset(font)

# Save as TTF (uncompressed) — opentype.js parses the woff2 flavor poorly.
os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
font.flavor = None
font.save(OUT_PATH)
print(f"Saved TTF to: {OUT_PATH}")
print(f"File size: {os.path.getsize(OUT_PATH)} bytes")
