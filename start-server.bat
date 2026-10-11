@echo off
cd /d "%~dp0"
echo Starting chat app local server...
where node >nul 2>nul
if %errorlevel%==0 (
  node server.js
) else (
  "C:\Users\april\.workbuddy\binaries\node\versions\22.22.2-6\node.exe" server.js
)
pause
