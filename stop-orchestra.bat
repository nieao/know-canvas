@echo off
:: ========== Anti-Crash Guard Shell ==========
if /i not "%~1"=="--guarded" (
    start "Know Canvas Orchestra Stop" cmd /k ""%~f0" --guarded"
    exit /b 0
)
:: ========== End Guard ==========

setlocal enabledelayedexpansion
title Know Canvas Orchestra - Stop All

echo.
echo   ========================================
echo     Stopping Orchestra Stack
echo   ========================================
echo.

:: Stop port-bound services first (yws, conductor, http, vite)
for %%p in (1234 17082 17083 5180) do (
    set "found=0"
    for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%%p " ^| findstr "LISTENING"') do (
        echo   Stopping PID %%a on port %%p
        taskkill /F /PID %%a >nul 2>&1
        set "found=1"
    )
    if "!found!"=="0" echo   Port %%p was free
)

:: Kill any leftover orchestra-* node processes (defensive sweep, e.g. legacy dispatcher/worker)
echo.
echo   Defensive sweep for legacy orchestra-* node processes...
for /f "tokens=2" %%i in ('wmic process where "name='node.exe'" get processid^,commandline /format:csv 2^>nul ^| findstr /i "orchestra-dispatcher orchestra-hermes-worker orchestra-conductor"') do (
    echo   Killing node PID %%i
    taskkill /F /PID %%i >nul 2>&1
)

echo.
echo   All Orchestra services stopped.
echo.
pause

endlocal
