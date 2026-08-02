import sys
from pathlib import Path

def get_base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent

    # paths.py is inside utils-gui/
    return Path(__file__).resolve().parent.parent