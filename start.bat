@echo off
REM Auralis one-command launcher.
REM First time only:  npm run setup   (installs client deps + uv sync + creates .env)
REM Then add your GOOGLE_API_KEY to server\.env and run this file (or: npm run dev).
cd /d %~dp0
npm run dev
