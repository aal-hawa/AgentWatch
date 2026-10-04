@echo off
rem ============================================================
rem  AgentWatch - start the local dashboard on http://localhost:4517
rem  First run automatically performs setup (npm install + build).
rem  100% local: your code never leaves this machine. Ollama is used
rem  locally at http://localhost:11434 (optional, auto-detected).
rem ============================================================
title AgentWatch
cd /d "%~dp0"

if not exist node_modules (
  echo First run detected - running one-time setup...
  echo.
  call setup.bat
  if errorlevel 1 (
    echo Setup failed - cannot start.
    pause
    exit /b 1
  )
)

set "PORT=4517"
set "HOSTNAME=127.0.0.1"
rem Local SQLite database — always inside this folder (forward slashes for Prisma)
set "DATABASE_URL=file:%CD:\=/%/db/custom.db"

if exist ".next\standalone\server.js" (
  echo Starting AgentWatch ^(production^) on http://localhost:4517 ...
  start "AgentWatch" /min cmd /c "node .next\standalone\server.js > server.log 2>&1"
) else (
  echo Starting AgentWatch ^(dev mode^) on http://localhost:4517 ...
  start "AgentWatch" /min cmd /c "npx next dev -p 4517 > server.log 2>&1"
)

echo Waiting for the dashboard to come up...
set /a tries=0
:wait
set /a tries+=1
if %tries% gtr 90 (
  echo AgentWatch did not come up after 3 minutes - check server.log in this folder.
  pause
  exit /b 1
)
timeout /t 2 /nobreak >nul
curl -s -o nul http://127.0.0.1:4517/api/settings
if errorlevel 1 goto :wait

echo.
echo  ================================================
echo   AgentWatch is running:  http://localhost:4517
echo   Stop it anytime with close.bat
echo  ================================================
echo.
start "" http://localhost:4517
exit /b 0
