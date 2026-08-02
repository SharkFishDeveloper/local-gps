import subprocess

from paths import get_base_dir
ROOT = get_base_dir()
PBF_DIR = ROOT / "map-data-pbf"
MBTILES_DIR = ROOT / "map-tiles"


def get_available_maps():
    print("=" * 60)
    print("ROOT:", ROOT)
    print("PBF_DIR:", PBF_DIR)
    print("MBTILES_DIR:", MBTILES_DIR)
    print("PBF exists:", PBF_DIR.exists())
    print("MBTiles exists:", MBTILES_DIR.exists())

    maps = []

    if not PBF_DIR.exists() or not MBTILES_DIR.exists():
        print("One or both folders do not exist.")
        return maps

    print("\nPBF files:")
    for f in PBF_DIR.iterdir():
        print(" ", repr(f.name))

    print("\nMBTiles files:")
    for f in MBTILES_DIR.iterdir():
        print(" ", repr(f.name))

    print("\nChecking matches:")

    mbtiles = {f.stem.lower(): f for f in MBTILES_DIR.glob("*.mbtiles")}

    for pbf in PBF_DIR.glob("*.osm.pbf"):
        name = pbf.name.removesuffix(".osm.pbf")

        print(f"Found PBF: {name}")

        if name.lower() in mbtiles:
            print(f" Ok  Match -> {mbtiles[name.lower()].name}")
            maps.append(name)
        else:
            print(f"  No matching MBTiles ({name}.mbtiles)")

    print("\nMaps found:", maps)
    print("=" * 60)

    return sorted(maps)


def get_current_map():
    maps = get_available_maps()
    return maps[0] if maps else None


def change_map(map_name):
    script = ROOT / "utils-gui" / "rename_map.py"

    if not script.exists():
        return False, "rename_map.py not found."

    try:
        result = subprocess.run(
            ["python", str(script), map_name],
            cwd=ROOT,
            capture_output=True,
            text=True,
            creationflags=0x08000000,
        )

        if result.returncode == 0:
            return True, result.stdout.strip() or f"Switched to {map_name}"

        return False, result.stderr.strip() or result.stdout.strip()

    except Exception as e:
        return False, str(e)


if __name__ == "__main__":
    maps = get_available_maps()

    if not maps:
        print("\nNo valid maps found.")
    else:
        print("\nAvailable maps:")
        for i, name in enumerate(maps, 1):
            print(f"{i}. {name}")