import sys
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent

if len(sys.argv) != 2:
    print("Usage: python generate_valhalla_config.py <location>")
    print("Example: python generate_valhalla_config.py delhi")
    sys.exit(1)

location = sys.argv[1].strip().lower()

venv_dir = ROOT / ".venv"
valhalla_build_config = venv_dir / "Scripts" / "valhalla_build_config.exe"

if not valhalla_build_config.exists():
    print("Error: valhalla_build_config.exe not found.")
    print("Run init.py first to install the required dependencies.")
    sys.exit(1)

tile_dir = ROOT / "valhalla_tiles" / location
tile_dir.mkdir(parents=True, exist_ok=True)

extract_dir = ROOT / "valhalla_extract"
extract_dir.mkdir(parents=True, exist_ok=True)

tile_extract = extract_dir / f"{location}.tar"

config_path = ROOT / "valhalla.json"

with open(config_path, "w", encoding="utf-8") as f:
    subprocess.run(
        [
            str(valhalla_build_config),
            "--mjolnir-tile-dir",
            str(tile_dir),
            "--mjolnir-tile-extract",
            str(tile_extract),
        ],
        cwd=ROOT,
        stdout=f,
        check=True,
    )

# Remove UTF-8 BOM if present
config_path.write_text(
    config_path.read_text(encoding="utf-8").lstrip("\ufeff"),
    encoding="utf-8",
)

print("valhalla.json generated successfully.")
print(f"Config file    : {config_path}")
print(f"Tile directory : {tile_dir}")
print(f"Tile extract   : {tile_extract}")