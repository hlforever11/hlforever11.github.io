@echo off
chcp 65001 >nul
title YouTube 下载助手 - 停止
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-local-backend.ps1"
echo.
pause

