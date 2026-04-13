@echo off
setlocal enabledelayedexpansion
title Know Canvas - Stop

echo.
echo   ========================================
echo     Know Canvas - Stopping Services
echo   ========================================
echo.

:: Kill port 5180
echo Checking port 5180...
set "FOUND=0"
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":5180 " ^| findstr "LISTENING"') do (
    echo   Killing process on port 5180 ^(PID: %%a^)...
    taskkill /F /PID %%a >nul 2>&1
    set "FOUND=1"
)

if "!FOUND!"=="0" (
    echo   No process found on port 5180
) else (
    echo   Service stopped
)

echo.
echo   ========================================
echo     All services stopped
echo   ========================================
echo.

pause >nul
endlocal
