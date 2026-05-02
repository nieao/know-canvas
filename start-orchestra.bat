@echo off
:: ========== Anti-Crash Guard Shell ==========
if /i not "%~1"=="--guarded" (
    start "Know Canvas Orchestra Stack" cmd /k ""%~f0" --guarded"
    exit /b 0
)
:: ========== End Guard ==========

setlocal enabledelayedexpansion
title Know Canvas - Orchestra (Yjs + Conductor + HTTP Console + Vite)

echo.
echo   ========================================
echo     Know Canvas - Orchestra Multi-Agent Stack
echo     Yjs (1234) + Conductor (17083, dispatcher+worker)
echo     + HTTP Console (17082) + Vite (5180)
echo   ========================================
echo.

set "SCRIPT_DIR=%~dp0"
set "ROOM=demo-final"
set "METAHERMES_DIR=%SCRIPT_DIR%..\黑客松 5-1"

:: Try to load HERMES_USER/HERMES_PASS from sibling .env (so worker can do real Hermes calls)
if exist "%METAHERMES_DIR%\.env" (
    echo [info] Loading Hermes creds from %METAHERMES_DIR%\.env
    for /f "usebackq tokens=1,2 delims==" %%a in ("%METAHERMES_DIR%\.env") do (
        set "key=%%a"
        set "val=%%b"
        if not "!key:~0,1!"=="#" if not "!key!"=="" set "!key!=!val!"
    )
) else (
    echo [warn] no .env found - hermes worker will run in MOCK mode
)
echo.

echo [1/6] Cleaning up old processes on ports 1234, 17082, 17083, 5180...
for %%p in (1234 17082 17083 5180) do (
    for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%%p " ^| findstr "LISTENING"') do (
        echo   Port %%p in use ^(PID: %%a^), killing...
        taskkill /F /PID %%a >nul 2>&1
    )
)
echo   Ports cleared
echo.

echo [2/6] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 ( echo   ERROR: Node.js not in PATH & goto :hold )
for /f %%v in ('node -v') do echo   Node %%v
echo.

echo [3/6] Checking deps...
if not exist "%SCRIPT_DIR%node_modules" (
    cd /d "%SCRIPT_DIR%"
    if errorlevel 1 ( echo   ERROR: cant cd & goto :hold )
    echo   Installing root deps...
    call npm install
    if errorlevel 1 ( echo   npm install failed & goto :hold )
)
if not exist "%SCRIPT_DIR%server\node_modules" (
    cd /d "%SCRIPT_DIR%server"
    if errorlevel 1 ( echo   ERROR: cant cd into server & goto :hold )
    echo   Installing server deps...
    call npm install
    if errorlevel 1 ( echo   server npm install failed & goto :hold )
)
echo   Deps OK
echo.

echo [4/6] Starting backends...
:: y-ws-server (Yjs, 1234) - foundational, others depend on this
cd /d "%SCRIPT_DIR%server"
start "yws-1234" cmd /k "node y-ws-server.js"
timeout /t 3 /nobreak >nul

:: orchestra-conductor (17083) - dispatcher + hermes worker for ROOM in single process
:: Sets ORCHESTRA_BOOT_ROOMS so conductor takes over the room on boot
cd /d "%SCRIPT_DIR%server"
set "ORCHESTRA_BOOT_ROOMS=!ROOM!"
start "orchestra-conductor-17083" cmd /k "set ORCHESTRA_BOOT_ROOMS=!ROOM!&& node orchestra-conductor.js"
timeout /t 3 /nobreak >nul

:: orchestra-http (17082) - dispatch console + inject API + notifyConductor
cd /d "%SCRIPT_DIR%server"
start "orchestra-http-17082" cmd /k "node orchestra-http.js"
timeout /t 2 /nobreak >nul

echo   3 backend services started (yws + conductor + http)
echo.

echo [5/6] Starting Vite frontend (port 5180)...
cd /d "%SCRIPT_DIR%"
start "vite-5180" cmd /k "npm run dev"
timeout /t 5 /nobreak >nul
echo.

echo [6/6] All up.
echo.
echo   ========================================
echo     Orchestra Stack Running
echo     ----------------------------------------
echo     JoinRoom Page:    http://localhost:5180/
echo     Canvas (direct):  http://localhost:5180/?room=!ROOM!
echo     Dispatch Console: http://localhost:17082/
echo     Conductor API:    http://localhost:17083/health
echo     Yjs Sync WS:      ws://localhost:1234
echo     Primary Room:     !ROOM!
echo   ========================================
echo.
echo   How 3 users co-work:
echo     1. Each opens http://localhost:5180/, fills name, clicks
echo        "Quick join primary room" - all land in !ROOM!
echo     2. Console tab: fill title + body, hit "inject"
echo        TaskNode appears on canvas, flips draft -^> running -^> done
echo     3. Canvas: dbl-click empty - quick menu - add nodes manually
echo.

echo Opening browser tabs...
timeout /t 2 /nobreak >nul
start "" "http://localhost:5180/"
timeout /t 1 /nobreak >nul
start "" "http://localhost:17082/"

:hold
echo.
echo Press any key to close this launcher window (services keep running).
echo To stop everything: run stop-orchestra.bat
pause >nul

endlocal
