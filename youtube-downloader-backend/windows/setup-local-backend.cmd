@echo off
chcp 65001 >nul
title YouTube 下载助手 - 首次安装
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-local-backend.ps1"
if errorlevel 1 (
  echo.
  echo 安装没有完成。请保留此窗口并把上面的红色错误截图发给我。
)
echo.
pause

