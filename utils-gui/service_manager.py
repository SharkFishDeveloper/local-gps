import os
import sys
import json
import socket
import subprocess
import threading
import time
import webbrowser
import queue
import tkinter as tk
from tkinter import ttk, messagebox
from pathlib import Path
from paths import get_base_dir
from requirements_check import check_all
from map_selector import get_available_maps, get_current_map, change_map
from map_import import MapImportMixin

requirements = check_all()


if not requirements["all_ok"]:
    print(requirements)

if os.name != "nt":
    sys.exit(1)

import ctypes
from ctypes import wintypes


BASE_DIR = get_base_dir()
LOG_DIR = BASE_DIR / "logs"
LOG_DIR.mkdir(exist_ok=True)
PID_FILE = LOG_DIR / "pids.json"

FRONTEND_URL = "http://localhost:3000"
CREATE_NO_WINDOW = 0x08000000
FRONTEND_HOST = "127.0.0.1"
FRONTEND_PORT = 3000
FRONTEND_WAIT_MAX_SECONDS = 90

RENAME_MAP_SCRIPT = BASE_DIR / "utils-gui" / "rename_map.py"

VALHALLA_GEN_SCRIPT = "generate_only_json.py"

SERVICES = [
    {
        "key": "martin",
        "name": "Martin Server",
        "host": "127.0.0.1",
        "port": 3001,
        "cwd": BASE_DIR,
        "command": r'martin-server\martin.exe -l 127.0.0.1:3001 map-tiles/{location}.mbtiles',
    },
    {
        "key": "search",
        "name": "Search Backend",
        "host": "127.0.0.1",
        "port": 4000,
        "cwd": BASE_DIR / "search-backend",
        "command": r'(if not exist node_modules npm install) && npm run dev --name {location}',
    },
    {
        "key": "valhalla",
        "name": "Valhalla Routing Server",
        "host": "127.0.0.1",
        "port": 8002,
        "cwd": BASE_DIR / "valhalla",
        "command": (
            r'(if not exist .venv (python -m venv .venv && '
            r'.venv\Scripts\python -m pip install -r requirements.txt)) && '
            r'call .venv\Scripts\activate.bat && '
            rf'python .\{VALHALLA_GEN_SCRIPT} {{location}} && '
            r'python -m uvicorn app:app --host 0.0.0.0 --port 8002'
        ),
    },
    {
        "key": "frontend",
        "name": "Frontend",
        "host": "127.0.0.1",
        "port": 3000,
        "cwd": BASE_DIR / "frontend",
        "command": (
            r'(if not exist node_modules npm install) && '
            r'python "{rename_script}" {location} && '
            r'npm run dev'
        ),
    },
]

kernel32 = ctypes.windll.kernel32
JobObjectExtendedLimitInformation = 9
JobObjectBasicProcessIdList = 3
JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000
PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
PROCESS_ALL_ACCESS = 0x1F0FFF


class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", wintypes.LARGE_INTEGER),
        ("PerJobUserTimeLimit", wintypes.LARGE_INTEGER),
        ("LimitFlags", wintypes.DWORD),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", wintypes.DWORD),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", wintypes.DWORD),
        ("SchedulingClass", wintypes.DWORD),
    ]


class IO_COUNTERS(ctypes.Structure):
    _fields_ = [
        ("ReadOperationCount", ctypes.c_uint64),
        ("WriteOperationCount", ctypes.c_uint64),
        ("OtherOperationCount", ctypes.c_uint64),
        ("ReadTransferCount", ctypes.c_uint64),
        ("WriteTransferCount", ctypes.c_uint64),
        ("OtherTransferCount", ctypes.c_uint64),
    ]


class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
        ("IoInfo", IO_COUNTERS),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


class JOBOBJECT_BASIC_PROCESS_ID_LIST(ctypes.Structure):
    _fields_ = [
        ("NumberOfAssignedProcesses", wintypes.DWORD),
        ("NumberOfProcessIdsInList", wintypes.DWORD),
        ("ProcessIdList", ctypes.c_void_p * 1024),
    ]


def create_kill_on_close_job():
    hJob = kernel32.CreateJobObjectW(None, None)
    if not hJob:
        return None
    info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    kernel32.SetInformationJobObject(
        hJob, JobObjectExtendedLimitInformation, ctypes.byref(info), ctypes.sizeof(info)
    )
    return hJob


def assign_pid_to_job(hJob, pid):
    hProcess = kernel32.OpenProcess(PROCESS_ALL_ACCESS, False, pid)
    if not hProcess:
        return False
    ok = kernel32.AssignProcessToJobObject(hJob, hProcess)
    kernel32.CloseHandle(hProcess)
    return bool(ok)


def job_alive_process_count(hJob):
    if not hJob:
        return 0
    info = JOBOBJECT_BASIC_PROCESS_ID_LIST()
    size = ctypes.sizeof(info)
    ok = kernel32.QueryInformationJobObject(
        hJob, JobObjectBasicProcessIdList, ctypes.byref(info), size, None
    )
    if not ok:
        return 0
    return info.NumberOfProcessIdsInList


def is_pid_alive_fast(pid):
    hProcess = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
    if not hProcess:
        return False
    exit_code = wintypes.DWORD()
    kernel32.GetExitCodeProcess(hProcess, ctypes.byref(exit_code))
    kernel32.CloseHandle(hProcess)
    return exit_code.value == 259  # STILL_ACTIVE = 259


def close_job(hJob):
    if hJob:
        kernel32.CloseHandle(hJob)


def port_is_open(host, port, timeout=0.2):
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False

# main class
class ServiceManagerGUI(MapImportMixin):
    def __init__(self, root):
        self.root = root
        self.root.title("Service Manager")
        self.root.geometry("820x550")
        self.root.minsize(900, 600)
        self.jobs = {}
        self.display_pids = {}
        self.status_vars = {}
        self.row_widgets = {}
        self._frontend_watch_stop = False
        self._switching_location = False

        self._polling_active = True
        self.ui_queue = queue.Queue()

        self.available_maps = get_available_maps()
        self.current_map = tk.StringVar(
            value=get_current_map() or "No Maps"
        )
        self._last_location = self.current_map.get().lower()

        self._build_ui()
        self._recover_previous_session()

        threading.Thread(target=self._bg_poll_loop, daemon=True).start()
        self._process_ui_queue()

    def _build_ui(self):
        style = ttk.Style()
        style.configure("Big.TButton", font=("Segoe UI", 12, "bold"), padding=10)

        # ---------------- Requirements ----------------
        reqs = check_all()

        if not reqs["all_ok"]:
            missing = []

            if not reqs["node"]["ok"]:
                missing.append("Node.js 20+")

            if not reqs["java"]["ok"]:
                missing.append("Java 17+ (64-bit)")

            if not reqs["python"]["ok"]:
                missing.append("Python 3.13+")

            tk.Label(
                self.root,
                text="❌ Missing: " + " | ".join(missing),
                fg="red",
                font=("Segoe UI", 9, "bold"),
            ).pack(fill="x", padx=12, pady=(6, 0))

        # ---------------- Buttons ----------------
        top = ttk.Frame(self.root, padding=12)
        top.pack(fill="x")
        ttk.Button(top, text="Start All Services", style="Big.TButton", command=self.start_all).pack(side="left", padx=6)
        ttk.Button(top, text="Stop All", command=self.stop_all).pack(side="left", padx=6)
        ttk.Button(top, text="Open Frontend", command=lambda: webbrowser.open(FRONTEND_URL)).pack(side="left", padx=6)
        ttk.Button(top, text="Force Kill All", command=lambda: threading.Thread(target=self.force_kill_all, daemon=True).start()).pack(side="left", padx=6)

        table = ttk.Frame(self.root, padding=(12, 4))
        table.pack(fill="x")
        headers = ["Service", "Status", "Action"]
        for col, text in enumerate(headers):
            ttk.Label(table, text=text, font=("Segoe UI", 9, "bold")).grid(row=0, column=col, sticky="w", padx=10, pady=4)

        for i, svc in enumerate(SERVICES, start=1):
            key = svc["key"]
            status_var = tk.StringVar(value="Stopped")
            self.status_vars[key] = status_var

            ttk.Label(table, text=svc["name"], width=25, font=("Segoe UI", 10)).grid(row=i, column=0, sticky="w", padx=10, pady=5)
            status_lbl = ttk.Label(table, textvariable=status_var, width=18, foreground="red", font=("Segoe UI", 10, "bold"))
            status_lbl.grid(row=i, column=1, sticky="w", padx=10, pady=5)

            ttk.Button(table, text="Restart", width=10, command=lambda k=key: self.restart_service(k)).grid(row=i, column=2, padx=10)

            self.row_widgets[key] = {"status_label": status_lbl}

        ttk.Label(self.root, text="Activity Log:", padding=(12, 8, 0, 0), font=("Segoe UI", 9, "bold")).pack(anchor="w")
        log_frame = ttk.Frame(self.root, padding=12)
        log_frame.pack(fill="both", expand=True)

        self.log_text = tk.Text(log_frame, height=14, state="disabled", wrap="word")
        scroll = ttk.Scrollbar(log_frame, command=self.log_text.yview)
        self.log_text.configure(yscrollcommand=scroll.set)
        self.log_text.pack(side="left", fill="both", expand=True)
        scroll.pack(side="right", fill="y")

        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

        # Select from existing map
        display_maps = [m.capitalize() for m in self.available_maps]
        self.map_menu = ttk.OptionMenu(
            top,
            self.current_map,
            self.current_map.get().capitalize(),
            *display_maps,
            command=self._on_location_selected,
        )
        self.map_menu.pack(side="left")

        # Add a new map
        ttk.Button(
            top,
            text="+ Add Map",
            command=self.add_map,
        ).pack(side="left", padx=6)

    def _log(self, msg):
        self.ui_queue.put(("log", msg))

    def _set_status_ui(self, key, text, color):
        self.ui_queue.put(("status", (key, text, color)))

    def _process_ui_queue(self):
        while not self.ui_queue.empty():
            try:
                item_type, data = self.ui_queue.get_nowait()
                if item_type == "log":
                    ts = time.strftime("%H:%M:%S")
                    self.log_text.configure(state="normal")
                    self.log_text.insert("end", f"[{ts}] {data}\n")
                    self.log_text.see("end")
                    self.log_text.configure(state="disabled")
                elif item_type == "status":
                    key, text, color = data
                    self.status_vars[key].set(text)
                    self.row_widgets[key]["status_label"].configure(foreground=color)
            except queue.Empty:
                break
        if self._polling_active:
            self.root.after(100, self._process_ui_queue)

    def _current_location(self):
        """The location string (lowercase) that services should be launched with."""
        return self.current_map.get().lower()

    def _build_command(self, svc, location):
        """Fill in {location} / {rename_script} placeholders for a service's command."""
        return svc["command"].format(
            location=location,
            rename_script=str(RENAME_MAP_SCRIPT),
        )

    def start_service(self, key):
        def _bg_start():
            svc = next(s for s in SERVICES if s["key"] == key)
            location = self._current_location()

            # Check if port is already open
            if "port" in svc and port_is_open(svc.get("host", "127.0.0.1"), svc["port"]):
                self._log(f"{svc['name']} is already running and listening on port {svc['port']}.")
                self._set_status_ui(key, "Running", "green")
                return

            self._set_status_ui(key, "Starting...", "#D97706")  # Amber

            cwd = Path(svc["cwd"])
            if not cwd.exists():
                err_msg = f"ERROR: Folder not found: {cwd}"
                self._log(err_msg)
                self._set_status_ui(key, "Error: Path Missing", "red")
                return

            try:
                command = self._build_command(svc, location)
            except Exception as e:
                self._log(f"ERROR building command for {svc['name']}: {e}")
                self._set_status_ui(key, "Error: Bad Command", "red")
                return

            log_path = LOG_DIR / f"{key}.log"
            try:
                log_file = open(log_path, "a", encoding="utf-8", errors="replace")
                log_file.write(f"\n\n===== Launch {time.strftime('%Y-%m-%d %H:%M:%S')} (location={location}) =====\n")
                log_file.flush()
            except Exception as e:
                self._log(f"ERROR creating log file for {svc['name']}: {e}")

            hJob = create_kill_on_close_job()
            if hJob is None:
                self._log(f"ERROR: could not create job object for {svc['name']}.")
                self._set_status_ui(key, "Error: Job Fail", "red")
                return

            try:
                proc = subprocess.Popen(
                    command,
                    shell=True,
                    cwd=str(cwd),
                    stdout=log_file,
                    stderr=subprocess.STDOUT,
                    stdin=subprocess.DEVNULL,
                    creationflags=CREATE_NO_WINDOW,
                )
            except Exception as e:
                self._log(f"ERROR launching {svc['name']}: {e}")
                close_job(hJob)
                self._set_status_ui(key, "Error: Launch Fail", "red")
                return

            assign_pid_to_job(hJob, proc.pid)
            self.jobs[key] = hJob
            self.display_pids[key] = proc.pid
            self._save_pids()
            self._log(f"Process spawned for {svc['name']} (PID {proc.pid}, location='{location}'). Waiting for port {svc['port']}...")

        threading.Thread(target=_bg_start, daemon=True).start()

    def stop_service(self, key):
        svc = next(s for s in SERVICES if s["key"] == key)
        hJob = self.jobs.get(key)

        if svc.get("port"):
            self._kill_process_by_port(svc["port"])

        if hJob is not None and not (isinstance(hJob, tuple) and hJob[0] == "legacy_pid"):
            close_job(hJob)

        self.jobs.pop(key, None)
        self._set_status_ui(key, "Stopped", "red")
        self._save_pids()
        self._log(f"Stopped {svc['name']}.")

    def restart_service(self, key):
        def _bg_restart():
            svc = next(s for s in SERVICES if s["key"] == key)
            self._log(f"Restarting {svc['name']}...")
            self.stop_service(key)
            time.sleep(0.5)
            self.start_service(key)
        threading.Thread(target=_bg_restart, daemon=True).start()

    def _kill_process_by_port(self, port):
        try:
            result = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, creationflags=CREATE_NO_WINDOW)
            for line in result.stdout.splitlines():
                parts = line.split()
                if len(parts) >= 5:
                    local_addr, pid = parts[1], parts[-1]
                    if local_addr.endswith(f":{port}") and pid.isdigit() and pid != "0":
                        subprocess.run(["taskkill", "/PID", pid, "/T", "/F"], creationflags=CREATE_NO_WINDOW, capture_output=True)
        except Exception:
            pass

    def start_all(self):
        location = self._current_location()
        self._log(f"Starting all services for location '{location}'...")
        for svc in SERVICES:
            self.start_service(svc["key"])

        self._frontend_watch_stop = False
        threading.Thread(target=self._watch_for_frontend, daemon=True).start()

    def stop_all(self):
        self._log("Stopping all services...")
        self._frontend_watch_stop = True
        threads = []
        for svc in SERVICES:
            t = threading.Thread(target=self.stop_service, args=(svc["key"],), daemon=True)
            threads.append(t)
            t.start()
        return threads

    def _stop_all_blocking(self):
        """Synchronous variant of stop_all, safe to call from a background thread."""
        self._log("Stopping all services...")
        self._frontend_watch_stop = True
        for svc in SERVICES:
            self.stop_service(svc["key"])

    def _save_pids(self):
        data = {key: pid for key, pid in self.display_pids.items() if key in self.jobs}
        try:
            PID_FILE.write_text(json.dumps(data), encoding="utf-8")
        except Exception:
            pass

    def _recover_previous_session(self):
        if not PID_FILE.exists():
            return
        try:
            data = json.loads(PID_FILE.read_text(encoding="utf-8"))
        except Exception:
            data = {}

        for key, pid in data.items():
            if key not in {s["key"] for s in SERVICES}:
                continue
            svc = next(s for s in SERVICES if s["key"] == key)
            port_open = port_is_open(svc.get("host", "127.0.0.1"), svc.get("port", 0)) if svc.get("port") else False
            alive = is_pid_alive_fast(pid)

            if alive or port_open:
                self._log(f"Found {svc['name']} active from previous session.")
                self.display_pids[key] = pid
                self.jobs[key] = ("legacy_pid", pid)
                if port_open:
                    self._set_status_ui(key, "Running", "green")
                else:
                    self._set_status_ui(key, "Starting...", "#D97706")

        self._save_pids()

    def force_kill_all(self):
        self._log("Force-killing all tracked processes...")
        for key in list(self.jobs.keys()):
            hJob = self.jobs.get(key)
            if isinstance(hJob, tuple) and hJob[0] == "legacy_pid":
                pid = hJob[1]
                subprocess.run(["taskkill", "/PID", str(pid), "/T", "/F"], creationflags=CREATE_NO_WINDOW, capture_output=True)
            else:
                close_job(hJob)
            self.jobs.pop(key, None)
            self._set_status_ui(key, "Stopped", "red")
        self._save_pids()

        ports = [str(s["port"]) for s in SERVICES if "port" in s]
        self._log("Sweeping ports " + ", ".join(ports) + " for anything left over...")
        killed_any = False
        try:
            result = subprocess.run(["netstat", "-ano"], capture_output=True, text=True, creationflags=CREATE_NO_WINDOW)
            for line in result.stdout.splitlines():
                parts = line.split()
                if len(parts) < 5:
                    continue
                local_addr, pid = parts[1], parts[-1]
                if any(local_addr.endswith(f":{p}") for p in ports) and pid.isdigit() and pid != "0":
                    subprocess.run(["taskkill", "/PID", pid, "/T", "/F"], creationflags=CREATE_NO_WINDOW, capture_output=True)
                    self._log(f"Killed PID {pid} on {local_addr}")
                    killed_any = True
        except Exception as e:
            self._log(f"ERROR during port sweep: {e}")

        if not killed_any:
            self._log("Nothing extra found on those ports.")

    def _watch_for_frontend(self):
        self._log(f"Waiting for Port {FRONTEND_PORT} to accept requests...")
        waited = 0
        while waited < FRONTEND_WAIT_MAX_SECONDS and not self._frontend_watch_stop:
            if port_is_open(FRONTEND_HOST, FRONTEND_PORT):
                self.root.after(0, lambda: webbrowser.open(FRONTEND_URL))
                self.root.after(0, lambda: self._log(f"Frontend on port {FRONTEND_PORT} is ready! Opened {FRONTEND_URL}"))
                return
            time.sleep(1)
            waited += 1
        if not self._frontend_watch_stop:
            self.root.after(0, lambda: self._log(f"Gave up waiting for port {FRONTEND_PORT} after {FRONTEND_WAIT_MAX_SECONDS}s."))

    def _bg_poll_loop(self):
        """Monitors real port and process status accurately."""
        while self._polling_active:
            for svc in SERVICES:
                key = svc["key"]
                has_job = key in self.jobs
                port_active = port_is_open(svc.get("host", "127.0.0.1"), svc.get("port", 0)) if svc.get("port") else False

                if port_active:
                    self._set_status_ui(key, "Running", "green")
                elif has_job:
                    # Check if process crashed/died before port opened
                    entry = self.jobs.get(key)
                    alive = False
                    if isinstance(entry, tuple) and entry[0] == "legacy_pid":
                        alive = is_pid_alive_fast(entry[1])
                    else:
                        alive = job_alive_process_count(entry) > 0

                    if alive:
                        self._set_status_ui(key, "Starting...", "#D97706")  # Amber / Yellow
                    else:
                        # Process died unexpectedly
                        self.jobs.pop(key, None)
                        self._save_pids()
                        self._log(f"ERROR: {svc['name']} process exited unexpectedly before opening port {svc['port']}. Check log: {key}.log")
                        self._set_status_ui(key, "Error / Crashed", "red")
                else:
                    curr_val = self.status_vars[key].get()
                    if not curr_val.startswith("Error"):
                        self._set_status_ui(key, "Stopped", "red")

            time.sleep(1.5)

    def _on_location_selected(self, display_name):
        """
        Called when the user picks a new map in the dropdown.

        This ONLY force-stops all running services and records the newly
        selected location name (used by start_service()/_current_location()
        the next time services are started). It does NOT auto-restart
        anything -- the user has to click "Start All Services" themselves
        once they're ready.
        """
        new_location = display_name.lower()

        if self._switching_location:
            self._log("Already switching location, please wait...")
            return

        if new_location == self._last_location:
            # Nothing to do, same location re-selected.
            return

        self._switching_location = True
        try:
            self.map_menu.configure(state="disabled")
        except Exception:
            pass

        def _bg_switch():
            try:
                self._log(f"Location changed to '{display_name}'. Force-stopping all services...")

                # 1. Force-stop everything currently running/tracked.
                self.force_kill_all()
                time.sleep(0.5)

                # 2. Persist the new selected map name only. No restart.
                try:
                    change_map(new_location)
                except Exception as e:
                    self._log(f"ERROR changing map to '{new_location}': {e}")

                self._last_location = new_location
                self._log(f"Map set to '{display_name}'. Click 'Start All Services' when ready.")
            finally:
                self._switching_location = False
                self.root.after(0, lambda: self.map_menu.configure(state="normal"))

        threading.Thread(target=_bg_switch, daemon=True).start()

    def _on_close(self):
        self._polling_active = False
        if any(port_is_open(s.get("host", "127.0.0.1"), s.get("port", 0)) for s in SERVICES):
            if messagebox.askyesno("Services still running", "Some services are still running. Stop them before closing?"):
                self.stop_all()
                time.sleep(0.5)
        self.root.destroy()


if __name__ == "__main__":
    root = tk.Tk()
    app = ServiceManagerGUI(root)
    root.mainloop()