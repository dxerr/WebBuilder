@echo off
echo Killing node process on port 3001...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3001" ^| findstr "LISTENING"') do (
    echo Found PID: %%a
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul
echo Starting backend server...
cd /d F:\wz\UE_CICD\UE_Web_Builder\backend
start "" /B node index.js
timeout /t 2 /nobreak >nul
echo Done.
