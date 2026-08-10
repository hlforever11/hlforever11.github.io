@echo off
setlocal
title YouTube Downloader Start

set "POWERSHELL=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%POWERSHELL%" (
  echo Windows PowerShell was not found:
  echo %POWERSHELL%
  echo.
  pause
  exit /b 1
)

"%POWERSHELL%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local-backend.ps1"
set "RESULT=%ERRORLEVEL%"
if not "%RESULT%"=="0" (
  echo.
  echo Start did not finish. Please send a screenshot of this window.
)
echo.
pause
exit /b %RESULT%
