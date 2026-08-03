import os
import re
import shutil
import subprocess
import sys
import threading
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from map_selector import change_map
from tkinter import messagebox

CREATE_NO_WINDOW = 0x08000000
MAP_NAME_SANITIZE_RE = re.compile(r"[^A-Za-z0-9_-]+")


def get_base_dir() -> Path:
    import sys
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


class MapImportMixin:
    _map_import_running = False
    # ---------------- Progress bar (lazily created, doesn't touch _build_ui) ----------------
    def _ensure_progress_ui(self):
        if getattr(self, "_progress_frame", None) is not None:
            return

        style = ttk.Style()
        style.configure(
            "MapImport.Horizontal.TProgressbar",
            troughcolor="#e4e4e4",
            background="#2ecc71",   # green fill
            bordercolor="#bdbdbd",
            lightcolor="#2ecc71",
            darkcolor="#2ecc71",
            thickness=20,
        )

        frame = ttk.Frame(self.root, padding=(12, 6, 12, 10))
        frame.pack(side="bottom", fill="x")

        self._progress_label_var = tk.StringVar(value="")
        self._progress_label = ttk.Label(
            frame, textvariable=self._progress_label_var, font=("Segoe UI", 9)
        )
        self._progress_label.pack(anchor="w")

        self._progress_var = tk.DoubleVar(value=0)
        self._progress_bar = ttk.Progressbar(
            frame,
            orient="horizontal",
            mode="determinate",
            style="MapImport.Horizontal.TProgressbar",
            variable=self._progress_var,
            maximum=100,
        )
        self._progress_bar.pack(fill="x")

        self._progress_frame = frame

    def _set_progress(self, value: float, label: str):
        self.root.after(0, self._set_progress_ui, value, label)

    def _set_progress_ui(self, value: float, label: str):
        self._progress_var.set(value)
        self._progress_label_var.set(label)

    # ---------------- Entry point (runs on UI thread) ----------------
    def add_map(self):
        if self._map_import_running:
            messagebox.showinfo("Add Map", "A map import is already in progress.")
            return

        desktop = Path.home() / "Desktop"
        initial_dir = str(desktop) if desktop.exists() else str(Path.home())

        filepath = filedialog.askopenfilename(
            title="Select .osm.pbf file from bbbike extract.bbbike.org",
            initialdir=initial_dir,
            filetypes=[("OSM PBF files", "*.osm.pbf"), ("All files", "*.*")],
        )
        if not filepath:
            return

        src = Path(filepath)
        if not src.name.lower().endswith(".osm.pbf"):
            messagebox.showerror(
                "Invalid file",
                "Please select a file ending in .osm.pbf (downloaded from extract.bbbike.org).",
            )
            return

        raw_name = src.name[: -len(".osm.pbf")]
        map_name = MAP_NAME_SANITIZE_RE.sub("_", raw_name).strip("_").lower()
        if not map_name:
            messagebox.showerror("Invalid file", "Could not derive a valid map name from that filename.")
            return

        if not messagebox.askyesno(
            "Confirm import",
            f"Import as map name: '{map_name}'\nSource file: {src.name}\n\n"
            "This will copy the file and run Planetiler, which can take a while. Continue?",
        ):
            return

        self._ensure_progress_ui()
        self._set_progress(0, f"Starting import of '{map_name}'...")

        self._map_import_running = True
        threading.Thread(target=self._run_map_import, args=(src, map_name), daemon=True).start()

    # ---------------- Background worker thread ----------------
    def _run_map_import(self, src: Path, map_name: str):
        base = get_base_dir()
        pbf_dir = base / "map-data-pbf"
        tiles_dir = base / "map-tiles"
        dest_pbf = pbf_dir / f"{map_name}.osm.pbf"
        out_mbtiles = tiles_dir / f"{map_name}.mbtiles"
            

        # hello
        #making some changes
        try:
            self._log_map(f"=== Starting import of '{map_name}' ===")
            self._set_progress(2, f"Preparing to import '{map_name}'...")

            pbf_dir.mkdir(parents=True, exist_ok=True)
            tiles_dir.mkdir(parents=True, exist_ok=True)

            if dest_pbf.exists():
                self._log_map(f"'{dest_pbf.name}' already exists in map-data-pbf, overwriting.")

            self._log_map(f"Copying {src} -> {dest_pbf}")
            shutil.copy2(src, dest_pbf)
            self._log_map("Copy complete.")
            self._set_progress(10, "File copied. Starting Planetiler...")

            planetiler_jar = base / "planetiler.jar"
            if not planetiler_jar.exists():
                self._log_map(f"ERROR: planetiler.jar not found at {planetiler_jar}")
                self._set_progress(0, "Failed: planetiler.jar not found.")
                self._finish_map_import_threadsafe(False, map_name)
                return

            heap_sizes = ["8g", "4g", "2g", "1g"]
            rc = None
            for i, heap in enumerate(heap_sizes):
                planetiler_cmd = [
                    "java",
                    f"-Xmx{heap}",
                    "-jar",
                    str(planetiler_jar),
                    "--force",
                    "--download",
                    f"--osm-path={dest_pbf}",
                    f"--output={out_mbtiles}",
                ]
                self._log_map(f"Attempting Planetiler with -Xmx{heap} (attempt {i + 1}/{len(heap_sizes)})...")
                self._set_progress(10, f"Running Planetiler ({heap} heap)...")
                rc = self._stream_subprocess(planetiler_cmd, cwd=base)

                if rc == 0:
                    self._log_map(f"Planetiler succeeded with -Xmx{heap}.")
                    break

                self._log_map(f"Planetiler failed with -Xmx{heap} (exit code {rc}).")
                if i < len(heap_sizes) - 1:
                    self._log_map(f"Retrying with a smaller heap ({heap_sizes[i + 1]})...")

            if rc != 0:
                self._log_map(f"ERROR: planetiler failed at every heap size tried ({', '.join(heap_sizes)}). Last exit code: {rc}")
                self._set_progress(10, "Failed: Planetiler error (all heap sizes exhausted).")
                self._finish_map_import_threadsafe(False, map_name)
                return

            if not out_mbtiles.exists():
                self._log_map("ERROR: expected mbtiles file was not created.")
                self._set_progress(10, "Failed: mbtiles not created.")
                self._finish_map_import_threadsafe(False, map_name)
                return

            self._log_map(f"mbtiles created: {out_mbtiles}")
            self._set_progress(35, "mbtiles created. Updating file paths...")

            # ---- Update file paths (index.ts, build-db.js, style.json, service_manager.py) ----
            self._log_map(f"Updating file paths for '{map_name}'...")
            try:
                change_map(map_name)
                self._log_map("File paths updated.")
            except Exception as e:
                self._log_map(f"ERROR updating file paths: {e}")
                self._set_progress(35, "Failed: could not update file paths.")
                self._finish_map_import_threadsafe(False, map_name)
                return

            self._set_progress(40, "Paths updated. Checking search-backend...")

            # ---- search-backend: npm install (skip if already installed) ----
            search_backend_dir = base / "search-backend"
            if not search_backend_dir.exists():
                self._log_map(f"ERROR: {search_backend_dir} not found.")
                self._set_progress(40, "Failed: search-backend not found.")
                self._finish_map_import_threadsafe(False, map_name)
                return

            npm = "npm.cmd" if os.name == "nt" else "npm"
            node_modules = search_backend_dir / "node_modules"

            if node_modules.exists():
                self._log_map("node_modules already present, skipping npm install.")
                self._set_progress(55, "Dependencies already installed.")
            else:
                self._log_map("Running npm install in search-backend...")
                self._set_progress(45, "Running npm install...")
                rc = self._stream_subprocess([npm, "install"], cwd=search_backend_dir)
                if rc != 0:
                    self._log_map(f"ERROR: npm install exited with code {rc}")
                    self._set_progress(45, "Failed: npm install error.")
                    self._finish_map_import_threadsafe(False, map_name)
                    return
                self._log_map("npm install complete.")
                self._set_progress(55, "npm install complete.")

            # ---- search-backend: npm run build --name <map_name> ----
            self._log_map(f"Building search database for '{map_name}'...")
            self._set_progress(60, "Building search database...")
            build_cmd = [npm, "run", "build", "--name", map_name]
            rc = self._stream_subprocess(build_cmd, cwd=search_backend_dir)
            if rc != 0:
                self._log_map(f"ERROR: npm run build exited with code {rc}")
                self._set_progress(60, "Failed: search database build error.")
                self._finish_map_import_threadsafe(False, map_name)
                return

            self._set_progress(75, "Search database built. Starting Valhalla...")
            # ------------------------------------------------------------------
            # Valhalla
            # ------------------------------------------------------------------
            valhalla_dir = base / "valhalla"

            self._log_map("Building Valhalla routing data...")
            self._set_progress(80, "Building Valhalla routing data...")

            venv_dir = valhalla_dir / ".venv"
            venv_python = venv_dir / "Scripts" / "python.exe"

            if not venv_python.exists():
                self._log_map("Creating Valhalla virtual environment...")

                rc = self._stream_subprocess(
                    [
                        "python",
                        "-m",
                        "venv",
                        str(venv_dir),
                    ],
                    cwd=valhalla_dir,
                )
                if rc != 0:
                    raise RuntimeError("Failed to create Valhalla virtual environment.")

                self._log_map("Installing Valhalla dependencies...")

                rc = self._stream_subprocess(
                    [
                        str(venv_python),
                        "-m",
                        "pip",
                        "install",
                        "-r",
                        "requirements.txt",
                    ],
                    cwd=valhalla_dir,
                )
                if rc != 0:
                    raise RuntimeError("Failed to install Valhalla dependencies.")

            self._log_map("Running Valhalla initialization...")

            rc = self._stream_subprocess(
                [
                    str(venv_python),
                    "init.py",
                    map_name,
                ],
                cwd=valhalla_dir,
            )

            if rc != 0:
                self._log_map("ERROR: Valhalla setup failed.")
                self._set_progress(80, "Failed: Valhalla setup.")
                self._finish_map_import_threadsafe(False, map_name)
                return

            

            self._log_map("Valhalla routing data generated successfully.")

            self._log_map(
                f"=== Map '{map_name}' imported, search database built, and Valhalla routing generated successfully ==="
            )

            self._set_progress(100, f"Map '{map_name}' ready.")
            self._finish_map_import_threadsafe(True, map_name)
            def close_app():
                messagebox.showinfo(
                    "Restart Required",
                    "Valhalla has been set up successfully.\n\nPlease restart the application."
                )
                self.root.destroy()

            # Show the dialog after 2 seconds
            self.root.after(2000, close_app)

            return
            
            

        except Exception as e:
            self._log_map(f"ERROR: {e}")
            self._set_progress(0, f"Failed: {e}")
            self._finish_map_import_threadsafe(False, map_name)

    # ---------------- Subprocess helper (runs on the worker thread) ----------------
    def _stream_subprocess(self, cmd, cwd: Path) -> int:
        """Runs cmd, streams stdout/stderr line-by-line into the log, returns exit code."""
        self._log_map("Running: " + " ".join(str(c) for c in cmd))
        creationflags = CREATE_NO_WINDOW if os.name == "nt" else 0
        proc = subprocess.Popen(
            cmd,
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            creationflags=creationflags,
        )
        for line in proc.stdout:
            self._log_map(line.rstrip())
        proc.wait()
        return proc.returncode

    # ---------------- Thread-safe helpers (hop back to UI thread) ----------------
    def _log_map(self, message: str):
        self.root.after(0, self._append_log_line, message)

    def _append_log_line(self, message: str):
        self.log_text.configure(state="normal")
        self.log_text.insert("end", message + "\n")
        self.log_text.see("end")
        self.log_text.configure(state="disabled")

    def _finish_map_import_threadsafe(self, success: bool, map_name: str):
        self.root.after(0, self._finish_map_import, success, map_name)

    def _finish_map_import(self, success: bool, map_name: str):
        self._map_import_running = False
        if success:
            if map_name not in self.available_maps:
                self.available_maps.append(map_name)
            self._refresh_map_menu()
            self.current_map.set(map_name)
            messagebox.showinfo("Add Map", f"Map '{map_name}' imported and set as active.")
        else:
            messagebox.showerror(
                "Add Map Failed",
                f"Failed to import '{map_name}'. Check the Activity Log for details.",
            )

    def _refresh_map_menu(self):
        menu = self.map_menu["menu"]
        menu.delete(0, "end")
        for name in self.available_maps:
            menu.add_command(label=name, command=lambda n=name: self._select_map(n))

    def _select_map(self, name: str):
        self.current_map.set(name)
        change_map(name)
        self._log_map(f"Switched active map to '{name}'.")