import re
import sys
from pathlib import Path
from paths import get_base_dir

ROOT = get_base_dir()

if len(sys.argv) != 2:
    print("Usage: python change_map.py <map_name> i.e example python change_map.py rajasthan")
    exit(1)

map_name = Path(sys.argv[1]).stem.replace(".osm", "")

pbf = ROOT / "map-data-pbf" / f"{map_name}.osm.pbf"
mbtile = ROOT / "map-tiles" / f"{map_name}.mbtiles"

if not pbf.exists():
    print(f"Error: {pbf} not found.")
    exit(1)

if not mbtile.exists():
    print(f"Error: {map_name}.mbtiles not found, please put it in map-tiles.")
    exit(1)

files = [
    ROOT / "frontend/public/map-styles/osm-liberty/style.json",
]

patterns = [
    (
        r"http://localhost:3001/[^\"']+",
        f"http://localhost:3001/{map_name}",
    ),
]

for file in files:
    if not file.exists():
        continue

    text = file.read_text(encoding="utf-8")

    for pattern, replacement in patterns:
        text = re.sub(pattern, replacement, text)

    file.write_text(text, encoding="utf-8")
    print(f"Updated {file.relative_to(ROOT)}")

print("Done.")
