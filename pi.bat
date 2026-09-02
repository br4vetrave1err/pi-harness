@echo off
REM Simple wrapper: pi.bat -> pi main session
REM Usage: pi.bat  (interactive)  or  pi.bat -p "hello"
set CONTAINER=pi-personal-agent
docker inspect -f "{{.State.Running}}" %CONTAINER% >nul 2>&1
if errorlevel 1 (
  echo Starting %CONTAINER%...
  docker compose --project-directory "%~dp0" up -d
  timeout /t 2 >nul
)
if "%~1"=="" (
  docker exec -it %CONTAINER% pi-main
) else (
  docker exec -it %CONTAINER% pi-main %*
)
