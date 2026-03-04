@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File "%~dp0run_cloudflare_tunnel_autoupdate.ps1"
pause