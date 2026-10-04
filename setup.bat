@echo off
rem ============================================================
rem  AgentWatch - one-time setup (run automatically by start.bat)
rem  Installs dependencies, creates the local database, builds.
rem ============================================================
setlocal
cd /d "%~dp0"
echo.
echo ============================================
echo   AgentWatch setup (one-time, a few minutes)
echo ============================================
echo.

echo [1/3] Installing dependencies with npm (can take 3-8 minutes)...
if not exist node_modules (
  call npm install --no-audit --no-fund --loglevel=error
  if errorlevel 1 goto :fail
) else (
  echo     node_modules already present - skipping npm install.
)

echo [2/3] Preparing local database (SQLite, file db\custom.db)...
if not exist db mkdir db
if not exist .env node -e "const fs=require('fs'),p=require('path');const u='file:'+p.join(process.cwd(),'db','custom.db').split(require('path').sep).join('/');fs.writeFileSync('.env','DATABASE_URL='+u+'\n');console.log('    .env written:',u)"
call npx prisma db push
if errorlevel 1 goto :fail

echo [3/3] Building production bundle (2-4 minutes, one-time)...
call npx next build
if errorlevel 1 (
  echo     Build failed - AgentWatch will run in DEV mode instead. Still fully functional.
  echo SETUP-DONE-DEV-FALLBACK
  exit /b 0
)
echo     Copying static assets into the standalone bundle...
if exist .next\static robocopy .next\static .next\standalone\.next\static /E /NFL /NDL /NJH /NJS /NP >nul
if exist public robocopy public .next\standalone\public /E /NFL /NDL /NJH /NJS /NP >nul

echo.
echo SETUP-DONE
exit /b 0

:fail
echo.
echo SETUP-FAILED - read the error above. Common fix: install Node.js LTS from https://nodejs.org
pause
exit /b 1
