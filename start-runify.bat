@echo off
setlocal

echo Starting Runify...
echo.

start "Runify Backend" cmd /k "cd /d "%~dp0backend" && .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8001"

start "Runify Frontend" cmd /k "cd /d "%~dp0" && npm run dev"

echo Waiting for both servers to come up...
timeout /t 5 /nobreak >nul

start http://localhost:5173

echo.
echo Runify is running in two windows: "Runify Backend" and "Runify Frontend".
echo Close either window (or Ctrl+C inside it) to stop that server.
echo This window can be closed.
