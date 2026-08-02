import re
import subprocess

CREATE_NO_WINDOW = 0x08000000


def _run(cmd):
    try:
        return subprocess.check_output(
            cmd,
            stderr=subprocess.STDOUT,
            text=True,
            creationflags=CREATE_NO_WINDOW,
        ).strip()
    except Exception:
        return None


def _version_tuple(text):
    m = re.search(r"(\d+)\.(\d+)\.(\d+)", text)
    if not m:
        return None
    return tuple(map(int, m.groups()))


def check_node():
    out = _run(["node", "-v"])
    if not out:
        return {
            "name": "Node.js",
            "installed": False,
            "ok": False,
            "version": None,
            "message": "Not Installed",
        }

    version = _version_tuple(out)

    return {
        "name": "Node.js",
        "installed": True,
        "ok": version is not None and version >= (20, 0, 0),
        "version": out.lstrip("v"),
        "message": f"v{out.lstrip('v')}",
    }


def check_python():
    out = _run(["python", "--version"])
    if not out:
        return {
            "name": "Python",
            "installed": False,
            "ok": False,
            "version": None,
            "message": "Not Installed",
        }

    version = _version_tuple(out)

    return {
        "name": "Python",
        "installed": True,
        "ok": version is not None and version >= (3, 13, 0),
        "version": out.replace("Python ", ""),
        "message": out,
    }


def check_java():
    out = _run(["java", "-XshowSettings:properties", "-version"])
    if not out:
        return {
            "name": "Java",
            "installed": False,
            "ok": False,
            "version": None,
            "is_64bit": False,
            "message": "Not Installed",
        }

    version_match = re.search(r'version "(\d+)', out)
    version = int(version_match.group(1)) if version_match else 0

    is_64bit = "sun.arch.data.model = 64" in out

    return {
        "name": "Java",
        "installed": True,
        "ok": version >= 17 and is_64bit,
        "version": version,
        "is_64bit": is_64bit,
        "message": f"Java {version} ({'64-bit' if is_64bit else '32-bit'})",
    }


def check_all():
    checks = {
        "node": check_node(),
        "java": check_java(),
        "python": check_python(),
    }

    checks["all_ok"] = all(item["ok"] for item in checks.values())
    return checks


if __name__ == "__main__":
    results = check_all()

    for key, item in results.items():
        if key == "all_ok":
            continue

        icon = "✅" if item["ok"] else "❌"
        print(f"{icon} {item['name']}: {item['message']}")

    print("\nOverall:", "PASS" if results["all_ok"] else "FAIL")