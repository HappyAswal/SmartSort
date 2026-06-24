"""
tray.py - SmartSort system tray launcher.

Starts the FastAPI backend and Vite frontend as hidden subprocesses,
shows a system tray icon with a menu to open the app or quit.
Quitting the tray icon kills both servers cleanly.
"""
import os
import sys
import time
import subprocess
import threading
import webbrowser
from pathlib import Path

# ── Try importing pystray + PIL, install if missing ──────────────────────────
def _ensure(pkg, import_name=None):
    import importlib
    try:
        importlib.import_module(import_name or pkg)
    except ImportError:
        subprocess.run([sys.executable, "-m", "pip", "install", pkg, "--quiet"], check=True)

_ensure("pystray")
_ensure("pillow", "PIL")

import pystray
from PIL import Image as PilImage, ImageDraw

ROOT    = Path(__file__).parent.parent
BACKEND = Path(__file__).parent
FRONTEND = ROOT / "frontend"
VENV_PYTHON = BACKEND / ".venv" / "Scripts" / "python.exe"

# Use venv python if available, else system python
PYTHON = str(VENV_PYTHON) if VENV_PYTHON.exists() else sys.executable

_procs: list[subprocess.Popen] = []
_ready = threading.Event()


def _make_icon() -> PilImage.Image:
    """Load the generated ICO, or draw a fallback if it doesn't exist yet."""
    ico_path = BACKEND / "smartsort.ico"
    if ico_path.exists():
        try:
            img = PilImage.open(str(ico_path))
            img = img.convert("RGBA")
            return img.resize((64, 64), PilImage.LANCZOS)
        except Exception:
            pass

    # Fallback: draw a simple indigo circle
    size = 64
    img = PilImage.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([4, 4, 60, 60], radius=12, fill=(99, 102, 241, 255))
    d.ellipse([18, 18, 46, 46], fill=(255, 255, 255, 230))
    d.ellipse([26, 26, 38, 38], fill=(99, 102, 241, 255))
    return img


def _start_servers():
    """Start backend and frontend as hidden subprocesses."""
    # ── Backend ──
    backend_cmd = [PYTHON, "main.py"]
    backend_proc = subprocess.Popen(
        backend_cmd,
        cwd=str(BACKEND),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    _procs.append(backend_proc)

    # Wait a moment for backend to bind its port
    time.sleep(2.5)

    # ── Frontend ──
    npm = "npm.cmd" if sys.platform == "win32" else "npm"
    frontend_proc = subprocess.Popen(
        [npm, "run", "dev"],
        cwd=str(FRONTEND),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=subprocess.CREATE_NO_WINDOW,
    )
    _procs.append(frontend_proc)

    # Wait for Vite to be ready then open browser
    time.sleep(3.5)
    webbrowser.open("http://localhost:5173")
    _ready.set()


def _stop_servers():
    """Terminate all child processes."""
    for proc in _procs:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass
    _procs.clear()


def _quit(icon, _item=None):
    icon.stop()
    _stop_servers()
    os._exit(0)


def _open_app(_icon=None, _item=None):
    webbrowser.open("http://localhost:5173")


def main():
    # Start servers in background thread
    t = threading.Thread(target=_start_servers, daemon=True)
    t.start()

    # Build tray menu
    menu = pystray.Menu(
        pystray.MenuItem("Open SmartSort", _open_app, default=True),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("Quit", _quit),
    )

    icon = pystray.Icon(
        name="SmartSort",
        icon=_make_icon(),
        title="SmartSort",
        menu=menu,
    )

    icon.run()


if __name__ == "__main__":
    main()
