@echo off
:: ========== Anti-Crash Guard Shell ==========
if /i not "%~1"=="--guarded" (
    start "Know Canvas Stop" cmd /k ""%~f0" --guarded"
    exit /b 0
)
:: ========== End Guard ==========

setlocal enabledelayedexpansion
title Know Canvas - Stop All Services

echo.
echo   ========================================
echo     Stopping all Know Canvas services
echo   ========================================
echo.

for %%p in (1234 18080 17081 5180 8765) do (
    set "found=0"
    for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":%%p " ^| findstr "LISTENING"') do (
        echo   Stopping PID %%a on port %%p
        taskkill /F /PID %%a >nul 2>&1
        set "found=1"
    )
    if "!found!"=="0" echo   Port %%p was free
)

echo.
echo   All services stopped.
echo.
pause

endlocal
