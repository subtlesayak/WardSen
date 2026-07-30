@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File ".\installers\windows\windows-install.ps1" -ProvidersOnly
