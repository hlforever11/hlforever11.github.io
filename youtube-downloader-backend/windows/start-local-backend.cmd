@echo off
chcp 65001 >nul
title YouTube 下载助手 - 启动
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local-backend.ps1"
if errorlevel 1 (
  echo.
  echo 启动失败。请把上面的红色错误截图发给我。
)
echo.
pause

