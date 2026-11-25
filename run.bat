@echo off
REM LIFEOS - one-click start for Windows. First run sets everything up (about a minute).
setlocal
cd /d "%~dp0"

where py >nul 2>nul && (set "PY=py -3") || (set "PY=python")

if not exist ".venv\Scripts\python.exe" (
  echo [LIFEOS] Creating virtual environment...
  %PY% -m venv .venv || goto :err
)

echo [LIFEOS] Installing / checking dependencies...
".venv\Scripts\python.exe" -m pip install --disable-pip-version-check -q -r requirements.txt || goto :err

if not exist data mkdir data

echo [LIFEOS] Starting on http://127.0.0.1:8000  (close this window or press Ctrl+C to stop)
start "" cmd /c "timeout /t 4 >nul & start http://127.0.0.1:8000"
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
goto :eof

:err
echo.
echo [LIFEOS] Setup failed - see the message above. You need Python 3.11+ installed.
pause
