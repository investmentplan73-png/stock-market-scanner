@echo off
setlocal
title Options Signal Scanner Server
cd /d "%~dp0"

if not exist server.js (
  echo Cannot find server.js in %cd%
  echo Please check that the project folder exists.
  pause
  goto :end
)

echo Starting Options Signal Scanner local server...
echo Folder: %cd%
echo.
echo Keep this window open while using the scanner.
echo The server will print the final browser URL below.
echo.

where node >nul 2>nul
if %errorlevel%==0 (
  node server.js
  goto :server_stopped
)

set "CODEX_NODE=%USERPROFILE%\AppData\Local\OpenAI\Codex\bin\node.exe"
if exist "%CODEX_NODE%" (
  "%CODEX_NODE%" server.js
  goto :server_stopped
)

echo Node.js is not installed or not available in PATH.
echo Install Node.js LTS from https://nodejs.org/
echo After installing, run this file again.
pause
goto :end

:server_stopped
echo.
echo Server stopped or failed with exit code %errorlevel%.
echo If port 8787 is busy, use the localhost URL printed above, for example 8788.
echo If the browser shows fetch errors, close old server windows and run this file again.
pause

:end
endlocal
