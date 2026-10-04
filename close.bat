@echo off
rem ============================================================
rem  AgentWatch - stop the dashboard (only AgentWatch processes)
rem ============================================================
echo Stopping AgentWatch...
taskkill /F /T /FI "WINDOWTITLE eq AgentWatch*" >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -match 'node' -and ($_.CommandLine -like '*standalone*server.js*' -or $_.CommandLine -like '*next dev -p 4517*') } | ForEach-Object { try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }"
echo Done. AgentWatch is stopped.
timeout /t 2 /nobreak >nul
