@echo off
setlocal enabledelayedexpansion

echo Runify setup
echo This checks for Python, Node.js, and ffmpeg, installs whichever are
echo missing, then installs Runify's own dependencies. Run this once --
echo after that, use start-runify.bat to actually launch the app.
echo.

set "JUST_INSTALLED="

where python >nul 2>nul
if errorlevel 1 (
    echo Python not found -- installing via winget...
    winget install --id Python.Python.3.14 -e --source winget --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo.
        echo Could not install Python automatically. Install it yourself from
        echo https://www.python.org/downloads/ ^(check "Add to PATH" during setup^),
        echo then run this script again.
        pause
        exit /b 1
    )
    set "JUST_INSTALLED=1"
) else (
    echo Python found.
)

where node >nul 2>nul
if errorlevel 1 (
    echo Node.js not found -- installing via winget...
    winget install --id OpenJS.NodeJS.LTS -e --source winget --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo.
        echo Could not install Node.js automatically. Install it yourself from
        echo https://nodejs.org/, then run this script again.
        pause
        exit /b 1
    )
    set "JUST_INSTALLED=1"
) else (
    echo Node.js found.
)

where ffmpeg >nul 2>nul
if errorlevel 1 (
    echo ffmpeg not found -- installing via winget...
    winget install --id Gyan.FFmpeg -e --source winget --accept-package-agreements --accept-source-agreements
    if errorlevel 1 (
        echo.
        echo Could not install ffmpeg automatically. Install it yourself from
        echo https://ffmpeg.org/download.html and make sure it's on your PATH,
        echo then run this script again.
        pause
        exit /b 1
    )
    set "JUST_INSTALLED=1"
) else (
    echo ffmpeg found.
)

if defined JUST_INSTALLED (
    echo.
    echo Some software was just installed. Windows needs a fresh terminal to
    echo pick up the updated PATH, so:
    echo   1. Close this window.
    echo   2. Double-click setup.bat again.
    echo It'll skip everything already installed and pick up where this left off.
    pause
    exit /b 0
)

echo.
echo All required software is present. Setting up Runify...
echo.

cd /d "%~dp0"

echo Installing frontend dependencies ^(this can take a minute^)...
call npm install
if errorlevel 1 (
    echo.
    echo npm install failed -- see the errors above.
    pause
    exit /b 1
)

if not exist "backend\.venv" (
    echo Creating Python virtual environment...
    python -m venv backend\.venv
)

echo Installing backend dependencies ^(this can take a few minutes the first time^)...
call backend\.venv\Scripts\python.exe -m pip install --upgrade pip
call backend\.venv\Scripts\pip.exe install -r backend\requirements.txt
if errorlevel 1 (
    echo.
    echo pip install failed -- see the errors above.
    pause
    exit /b 1
)

echo.
echo Setup complete. Double-click start-runify.bat to launch Runify.
echo.
pause
