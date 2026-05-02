@echo off
:: ========== Anti-Crash Guard Shell ==========
if /i not "%~1"=="--guarded" (
    start "Know Canvas Full Stack" cmd /k ""%~f0" --guarded"
    exit /b 0
)
:: ========== End Guard ==========

setlocal enabledelayedexpansion
title Know Canvas - Full Stack (Yjs + Claude + Hermes + Vite)

echo.
echo   ========================================
echo     Know Canvas - Full Stack Startup
echo     (Yjs sync + Claude bridge + Hermes proxy + Vite dev)
echo   ========================================
echo.

set "SCRIPT_DIR=%~dp0"
set "METAHERMES_DIR=%SCRIPT_DIR%..\黑客松 5-1"

:: Try to read HERMES creds from sibling project's .env
if exist "%METAHERMES_DIR%\.env" (
    echo [info] Loading creds from %METAHERMES_DIR%\.env
    for /f "usebackq tokens=1,2 delims==" %%a in ("%METAHERMES_DIR%\.env") do (
        set "key=%%a"
        set "val=%%b"
        if not "!key:~0,1!"=="#" if not "!key!"=="" (
            set "!key!=!val!"
        )
    )
) else (
    echo [warn] %METAHERMES_DIR%\.env not found
    echo        Hermes proxy will fail to call Hermes API.
    echo        Create %SCRIPT_DIR%.env.local with HERMES_USER/HERMES_PASS, or
    echo        ask boss to set them in environment before running this BAT.
)
echo.

echo [1/6] Cleaning up old processes on ports 1234, 18080, 17081, 5180, 8765...
for %%p in (1234 18080 17081 5180 8765) do (
    for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%%p " ^| findstr "LISTENING"') do (
        echo   Port %%p in use ^(PID: %%a^), killing...
        taskkill /F /PID %%a >nul 2>&1
    )
)
echo   Ports cleared
echo.

echo [2/6] Checking Node.js + Python...
where node >nul 2>&1
if errorlevel 1 ( echo   ERROR: Node.js not in PATH & goto :hold )
where python >nul 2>&1
if errorlevel 1 ( echo   WARN: Python not in PATH - monitor wont start )
for /f %%v in ('node -v') do echo   Node %%v
echo.

echo [3/6] Checking dependencies...
if not exist "%SCRIPT_DIR%node_modules" (
    echo   Installing root deps (this may take a minute)...
    cd /d "%SCRIPT_DIR%"
    if errorlevel 1 ( echo   ERROR: cant cd & goto :hold )
    call npm install
    if errorlevel 1 ( echo   npm install failed & goto :hold )
)
if not exist "%SCRIPT_DIR%server\node_modules" (
    echo   Installing server deps...
    cd /d "%SCRIPT_DIR%server"
    if errorlevel 1 ( echo   ERROR: cant cd into server & goto :hold )
    call npm install
    if errorlevel 1 ( echo   server npm install failed & goto :hold )
)
echo   Deps OK
echo.

echo [4/6] Starting backends...
:: y-ws-server (Yjs sync, port 1234)
cd /d "%SCRIPT_DIR%server"
start "yws-1234" cmd /k "node y-ws-server.js"
timeout /t 2 /nobreak >nul

:: claude-bridge (port 18080)
cd /d "%SCRIPT_DIR%server"
start "claude-bridge-18080" cmd /k "node claude-bridge.js"
timeout /t 2 /nobreak >nul

:: hermes-proxy (port 17081) - needs HERMES_USER/PASS
cd /d "%SCRIPT_DIR%server"
start "hermes-proxy-17081" cmd /k "node hermes-proxy.js"
timeout /t 2 /nobreak >nul
echo   3 backend services started
echo.

echo [5/6] Starting Vite frontend (port 5180)...
cd /d "%SCRIPT_DIR%"
start "vite-5180" cmd /k "npm run dev"
timeout /t 4 /nobreak >nul
echo.

echo [6/6] Starting metahermes monitor (port 8765, optional)...
if exist "%METAHERMES_DIR%\metahermes\monitor\index.html" (
    cd /d "%METAHERMES_DIR%\metahermes\monitor"
    start "monitor-8765" cmd /k "python -m http.server 8765"
    timeout /t 2 /nobreak >nul
    echo   monitor ready at http://localhost:8765/
) else (
    echo   skipped - %METAHERMES_DIR%\metahermes\monitor not found
)
echo.

echo   ========================================
echo     All services started!
echo     ----------------------------------------
echo     Frontend:       http://localhost:5180
echo     Yjs Sync WS:    ws://localhost:1234
echo     Claude Bridge:  http://localhost:18080
echo     Hermes Proxy:   http://localhost:17081
echo     Monitor:        http://localhost:8765
echo     Hermes API:     https://ha2.digitalvio.shop/kanban
echo   ========================================
echo.

echo Opening browser tabs...
timeout /t 2 /nobreak >nul
start "" "http://localhost:5180/?room=demo-railway"
timeout /t 1 /nobreak >nul
start "" "http://localhost:8765/"
timeout /t 1 /nobreak >nul
start "" "https://ha2.digitalvio.shop/kanban"

:hold
echo.
echo Press any key to close this launcher (services keep running)...
echo To stop all: run stop-full.bat
pause >nul

endlocal
