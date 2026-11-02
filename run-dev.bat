@echo off
title SyncUp Development Environment
echo Starting SyncUp Services...

:: 1. เปิด Terminal หน้าต่างแรกเพื่อรัน Backend API
start "SyncUp API" cmd /k "corepack pnpm --filter @syncup/api dev"

:: 2. เปิด Terminal หน้าต่างที่สองเพื่อรัน Frontend Web
start "SyncUp Web" cmd /k "corepack pnpm --filter @syncup/web dev"

:: 3. รอระบบเริ่มต้น 5 วินาที แล้วเปิดเว็บเบราว์เซอร์ไปที่ http://localhost:3000
timeout /t 5 /nobreak >nul
start http://localhost:3000

echo All services started!