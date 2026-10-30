@echo off
chcp 65001 >nul
cd /d "%~dp0"

rem 1) explicit override: put the node.exe path in node-path.txt (gitignored)
set "NODE="
if exist "node-path.txt" set /p NODE=<node-path.txt

rem 2) node on PATH
if not defined NODE (
  where node >nul 2>nul && set "NODE=node"
)

rem 3) common install locations
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE if exist "%ProgramFiles(x86)%\nodejs\node.exe" set "NODE=%ProgramFiles(x86)%\nodejs\node.exe"
if not defined NODE if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" set "NODE=%LOCALAPPDATA%\Programs\nodejs\node.exe"

if not defined NODE (
  echo.
  echo   Node.js not found.
  echo   Install the LTS version from https://nodejs.org
  echo   then double-click this file again.
  echo.
  pause
  exit /b 1
)

netstat -ano | findstr ":4321" | findstr LISTENING >nul
if %errorlevel%==0 (
  start "" "http://localhost:4321"
  exit /b 0
)

start "StudyLog" /min "%NODE%" server.mjs
timeout /t 2 >nul
start "" "http://localhost:4321"
exit /b 0
