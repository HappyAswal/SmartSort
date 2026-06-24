@echo off
setlocal

:: %~dp0 already has trailing backslash
set "ROOT=%~dp0"
set "BACKEND=%ROOT%backend"
set "FRONTEND=%ROOT%frontend"
set "RUNBAT=%ROOT%run.bat"
set "ICO=%BACKEND%\smartsort.ico"
set "SHORTCUT=%USERPROFILE%\Desktop\SmartSort.lnk"
set "VBS=%TEMP%\ss_shortcut.vbs"
set "PYTHONW=%BACKEND%\.venv\Scripts\pythonw.exe"
set "PIP=%BACKEND%\.venv\Scripts\pip.exe"
set "PYTHON=%BACKEND%\.venv\Scripts\python.exe"

:: ── One-time setup ────────────────────────────────────────────────────────────

if not exist "%BACKEND%\.venv" (
    echo [1/3] Creating Python virtual environment...
    python -m venv "%BACKEND%\.venv"
    if errorlevel 1 (
        echo ERROR: Python not found. Please install Python 3.10+
        pause & exit /b 1
    )
)

if not exist "%PYTHON%" (
    echo ERROR: Virtual environment broken. Delete backend\.venv and try again.
    pause & exit /b 1
)

echo [2/3] Installing / verifying Python dependencies...
"%PIP%" install -r "%BACKEND%\requirements.txt" --quiet
if errorlevel 1 ( echo ERROR: pip install failed. && pause & exit /b 1 )

if not exist "%FRONTEND%\node_modules" (
    echo [3/3] Installing Node.js dependencies...
    cd /d "%FRONTEND%"
    npm install
    if errorlevel 1 ( echo ERROR: npm install failed. Is Node.js installed? && pause & exit /b 1 )
)

:: ── Generate icon (once) ─────────────────────────────────────────────────────

if not exist "%ICO%" (
    echo Generating app icon...
    "%PYTHON%" "%BACKEND%\make_icon.py"
)

:: ── Create desktop shortcut (once) ───────────────────────────────────────────

if not exist "%SHORTCUT%" (
    echo Creating desktop shortcut...
    > "%VBS%" echo Set sh = CreateObject("WScript.Shell")
    >> "%VBS%" echo Set lnk = sh.CreateShortcut("%SHORTCUT%")
    >> "%VBS%" echo lnk.TargetPath = "%RUNBAT%"
    >> "%VBS%" echo lnk.WorkingDirectory = "%ROOT%"
    >> "%VBS%" echo lnk.IconLocation = "%ICO%, 0"
    >> "%VBS%" echo lnk.Description = "SmartSort - Photo Organiser"
    >> "%VBS%" echo lnk.WindowStyle = 7
    >> "%VBS%" echo lnk.Save
    cscript //nologo "%VBS%"
    del "%VBS%"
    echo Desktop shortcut created.
)

:: ── Launch tray (no window) ───────────────────────────────────────────────────
echo Starting SmartSort...
start "" /b "%PYTHONW%" "%BACKEND%\tray.py"

timeout /t 1 /nobreak >nul
endlocal
exit
