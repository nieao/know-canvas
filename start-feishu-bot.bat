@echo off
:: ========== Anti-Crash Guard Shell ==========
if /i not "%~1"=="--guarded" (
    start "Feishu Bot Daemon" cmd /k ""%~f0" --guarded"
    exit /b 0
)
:: ========== End Guard ==========

setlocal enabledelayedexpansion
title Know Canvas - Feishu Bot

echo.
echo   ========================================
echo     Know Canvas - Feishu Bot Daemon
echo     Subscribes Lark events via WebSocket
echo     Bridges to orchestra-http inject API
echo   ========================================
echo.

set "SCRIPT_DIR=%~dp0"

:: 1. Check lark-cli
echo [1/4] Checking lark-cli...
where lark-cli >nul 2>&1
if errorlevel 1 (
    echo   ERROR: lark-cli not in PATH
    echo   Install: npm install -g lark-cli
    goto :hold
)
echo   lark-cli OK
echo.

:: 2. Check lark-cli config (need app_id configured)
echo [2/4] Checking lark-cli config...
lark-cli auth status >nul 2>&1
if errorlevel 1 (
    echo   WARN: lark-cli config may not be initialized
    echo   Run: lark-cli config init --new
    echo   See: docs/feishu-bot-setup.md
    echo.
    timeout /t 3 /nobreak >nul
) else (
    echo   lark-cli config OK
)
echo.

:: 3. Check orchestra-http on 17082
echo [3/4] Checking orchestra-http (17082)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":17082 " ^| findstr "LISTENING"') do (
    echo   orchestra-http is up ^(PID: %%a^)
    goto :http_ok
)
echo   ERROR: orchestra-http not running on 17082
echo   Start it first: start-orchestra.bat
goto :hold
:http_ok
echo.

:: 4. Start daemon
echo [4/4] Starting Feishu bot daemon...
cd /d "%SCRIPT_DIR%server"
if errorlevel 1 (
    echo   ERROR: cannot cd into server folder
    goto :hold
)
echo.
echo   Daemon will:
echo     - subscribe Lark events (im.message.receive_v1)
echo     - inject text msgs to room=demo-final
echo     - reply with Aletheia result when ready
echo.
echo   Stop with Ctrl+C, or close this window.
echo   ========================================
echo.

node feishu-bot-daemon.js

:hold
echo.
echo Press any key to close...
pause >nul
endlocal
