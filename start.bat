@echo off
REM Quick-start: launches backend and frontend in two windows.
REM Backend uses `uv run` so it always finds the project's venv.
REM Run `uv sync` inside server/ and `npm install` inside client/ first.

start "aura-server" cmd /k "cd /d %~dp0server && uv run python server.py"
start "aura-client" cmd /k "cd /d %~dp0client && npm run dev"
echo Started both. Server -^> http://localhost:7860   Client -^> http://localhost:5173
