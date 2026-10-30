@echo off
chcp 65001 >nul
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4321" ^| findstr LISTENING') do (
  taskkill /PID %%a /F >nul 2>&1
)
exit /b 0
