@echo off
rem Double-click to start BOTH backend and frontend:
rem   backend gateway   http://127.0.0.1:8790/v1
rem   frontend dev      http://127.0.0.1:5173/panel  (hot reload)
rem
rem NOTE: keep this file ASCII-only. cmd.exe parses .cmd in the system ANSI
rem codepage, so a UTF-8 Chinese comment gets garbled and is then executed as a
rem command. Chinese text belongs in the terminal output of dev.mjs, not here.
rem
rem %~dp0 is this script's own folder, so the project can be moved anywhere.
cd /d "%~dp0"

call npm run dev

echo.
echo [exited] press any key to close
pause >nul
