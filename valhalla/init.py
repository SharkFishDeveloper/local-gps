import sys
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent

if len(sys.argv) != 2:
    print("Usage: python init.py <location>")
    print("Example: python init.py delhi")
    sys.exit(1)

location = sys.argv[1].strip().lower()

venv_dir = ROOT / ".venv"
venv_python = venv_dir / "Scripts" / "python.exe"
valhalla_build_config = venv_dir / "Scripts" / "valhalla_build_config.exe"

# Create venv if it doesn't exist
if not venv_python.exists():
    subprocess.run(
        ["python", "-m", "venv", str(venv_dir)],
        cwd=ROOT,
        check=True,
    )

# Install dependencies only if valhalla_build_config is missing
if not valhalla_build_config.exists():
    subprocess.run(
        [
            str(venv_python),
            "-m",
            "pip",
            "install",
            "-r",
            "requirements.txt",
        ],
        cwd=ROOT,
        check=True,
    )

tile_dir = ROOT / "valhalla_tiles" / location
tile_dir.mkdir(parents=True, exist_ok=True)

extract_dir = ROOT / "valhalla_extract"
extract_dir.mkdir(parents=True, exist_ok=True)

tile_extract = extract_dir / f"{location}.tar"

# Generate valhalla.json
with open(ROOT / "valhalla.json", "w", encoding="utf-8") as f:
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
config = ROOT / "valhalla.json"
config.write_text(
    config.read_text(encoding="utf-8").lstrip("\ufeff"),
    encoding="utf-8",
)

print(f"valhalla.json generated successfully.")
print(f"Tile directory : {tile_dir}")
print(f"Tile extract   : {tile_extract}")