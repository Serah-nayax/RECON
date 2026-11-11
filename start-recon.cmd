@echo off
rem One-click launcher for Recon on Windows: double-click this file.
setlocal EnableDelayedExpansion
cd /d "%~dp0"

rem Portable Node (no admin rights) + Git's sh for pnpm scripts.
set "NODE_DIR=%USERPROFILE%\tools\node\node-v26.13.0-win-x64"
if exist "%NODE_DIR%\node.exe" set "PATH=%NODE_DIR%;%APPDATA%\npm;C:\Program Files\Git\usr\bin;%PATH%"
rem Trust the Windows certificate store (corporate networks inspect HTTPS).
set "NODE_OPTIONS=--use-system-ca"

where node >nul 2>nul || (echo [Recon] Node.js not found. See README. & pause & exit /b 1)
where pnpm >nul 2>nul || (echo [Recon] pnpm not found. Run: npm i -g pnpm & pause & exit /b 1)

rem Local mode: Recon listens on this PC only, so no access key is needed.
set "RECON_LOCAL=1"

if not exist ".env.local" (
  echo [Recon] .env.local is missing: run "neon deploy" once to pull the database URL.
  pause & exit /b 1
)

if not exist "node_modules" (
  echo [Recon] Installing dependencies...
  call pnpm install || (pause & exit /b 1)
)

if not exist "%LOCALAPPDATA%\ms-playwright\chromium-*" (
  echo [Recon] Installing the browser used for Google Maps search...
  pushd api-server & call npx playwright install chromium & popd
)

rem Build when a build is missing, or always with: start-recon.cmd rebuild
if /i "%~1"=="rebuild" goto build
if not exist "dashboard\dist\public\index.html" goto build
if not exist "api-server\dist\index.mjs" goto build
goto run

:build
echo [Recon] Building...
set "PORT=5000" & set "BASE_PATH=/"
call pnpm --filter @workspace/dashboard run build || (pause & exit /b 1)
call pnpm --filter @workspace/api-server run build || (pause & exit /b 1)
set "PORT="

:run
set "PORT=8080"
if exist ".env" for /f "tokens=1,* delims==" %%a in ('findstr /b "PORT=" .env') do set "PORT=%%b"
echo.
echo  ============================================================
echo   Recon is starting on http://localhost:%PORT%
echo   Your browser opens by itself in a few seconds.
echo   Close this window to stop Recon.
echo  ============================================================
echo.
start "" cmd /c "timeout /t 8 >nul & start http://localhost:%PORT%"
call pnpm --filter @workspace/api-server run start
pause
