#!/usr/bin/env python3
"""Rebuilds assets/fonts/material-symbols-rounded.woff2: a small subset of Material Symbols Rounded.

Run it from the project root after you use a NEW icon name in the code (icon("some_name")), otherwise that icon
shows up as plain text. It scans js/, index.html and css/ for every word that is a Material Symbols icon name,
asks Google Fonts once for a font containing just those icons, and saves it here. Nothing is loaded from Google
when the app runs. Needs internet access and Python 3 (no extra packages).
"""
import glob, re, urllib.request

ROOT = __file__.rsplit("/assets/fonts/", 1)[0]
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
CODEPOINTS = "https://raw.githubusercontent.com/google/material-design-icons/master/variablefont/MaterialSymbolsRounded%5BFILL%2CGRAD%2Copsz%2Cwght%5D.codepoints"

def get(url, binary=False):
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    data = urllib.request.urlopen(request, timeout=60).read()
    return data if binary else data.decode("utf-8")

names = {line.split()[0] for line in get(CODEPOINTS).splitlines() if line.strip()}
words = set()
for path in glob.glob(f"{ROOT}/js/**/*.js", recursive=True) + [f"{ROOT}/index.html"] + glob.glob(f"{ROOT}/css/*.css"):
    words |= set(re.findall(r"[a-z][a-z0-9_]*", open(path, encoding="utf-8").read()))
icons = ",".join(sorted(names & words))  # Google requires the names in alphabetical order

css = get("https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,400,0..1,0"
          f"&icon_names={icons}&display=block")
url = re.search(r"url\((https://[^)]+)\)", css).group(1)
out = f"{ROOT}/assets/fonts/material-symbols-rounded.woff2"
open(out, "wb").write(get(url, binary=True))
print(f"{len(icons.split(','))} icons -> {out}")
