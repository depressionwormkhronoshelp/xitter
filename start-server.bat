@echo off
chcp 65001 >nul
cd /d "%~dp0server"
if not exist node_modules call npm install
node server.js
pause
