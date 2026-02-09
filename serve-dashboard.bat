@echo off
echo Starting Gazzer Dashboard Server...
echo.
echo Dashboard will open at: http://localhost:8080
echo Press Ctrl+C to stop the server
echo.
npx http-server . -p 8080 -o
