@echo off
title AI Dubbing & Video Sync Studio
cd /d "%~dp0"
echo ========================================================
echo   AI Dubbing & Video Sync Studio (FFmpeg Native)
echo   Starting server at http://127.0.0.1:8000
echo ========================================================

:: Backend server (server.py) se tu dong mo trinh duyet khi khoi dong
python -m uvicorn server:app --host 127.0.0.1 --port 8000 --reload
pause
