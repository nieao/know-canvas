@echo off
setlocal enabledelayedexpansion
title Know Canvas - Startup

echo.
echo   ========================================
echo     Know Canvas - Knowledge Graph Canvas
echo   ========================================
echo.

set "SCRIPT_DIR=%~dp0"

:: 1. Check and clean port 5180
echo [1/4] Checking port 5180...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":5180 " ^| findstr "LISTENING"') do (
    echo   Port 5180 in use ^(PID: %%a^), killing...
    taskkill /F /PID %%a >nul 2>&1
)
echo   Port 5180 ready
echo.

:: 2. Check Node.js
echo [2/4] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
    echo   ERROR: Node.js not found. Please install Node.js first.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do echo   Node.js %%v detected
echo.

:: 3. Check dependencies
echo [3/4] Checking dependencies...
cd /d "%SCRIPT_DIR%"
if not exist "node_modules" (
    echo   Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo   npm install failed
        pause
        exit /b 1
    )
)
echo   Dependencies ready
echo.

:: 4. Start dev server
echo [4/4] Starting dev server...
cd /d "%SCRIPT_DIR%"
start "KnowCanvas" cmd /k "npm run dev"
timeout /t 3 /nobreak >nul
echo.

:: Done
echo   ========================================
echo     Know Canvas is running!
echo     URL:    http://localhost:5180
echo     GitHub: github.com/nieao/know-canvas
echo   ========================================
echo.

:: Auto open browser
echo Opening browser...
timeout /t 2 /nobreak >nul
start "" "http://localhost:5180"

echo Press any key to close this window...
pause >nul

endlocal
