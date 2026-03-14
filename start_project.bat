@echo off
title VaultBank - Starting Project
color 0A

echo.
echo ╔══════════════════════════════════════════════════════════════╗
echo ║                    🏦 VAULTBANK STARTUP                       ║
echo ╚══════════════════════════════════════════════════════════════╝
echo.

REM Check if server .env exists, create default if not
if not exist "server\.env" (
    echo [INFO] Creating server/.env from template...
    copy "server\.env.example" "server\.env" >nul 2>&1
    echo [OK] server/.env created. Edit it to add your Supabase keys.
)

echo [1/2] Starting VaultBank Backend Server (port 5000)...
start "VaultBank Server" cmd /k "cd /d %~dp0server && node index.js"

timeout /t 2 /nobreak >nul

echo [2/2] Starting VaultBank Frontend Client (port 3000)...
start "VaultBank Client" cmd /k "cd /d %~dp0client && npm start"

echo.
echo ══════════════════════════════════════════════════════════════════
echo   🚀 VaultBank is starting up!
echo.
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:5000
echo   Health:   http://localhost:5000/health
echo   API Docs: http://localhost:5000/api
echo.
echo   Demo Login:
echo     Email:    any email (demo mode)
echo     Password: any password
echo     2FA Code: 123456
echo.
echo   Admin Login: admin@vaultbank.com / admin123
echo ══════════════════════════════════════════════════════════════════
echo.
pause
