@echo off
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3000"') do taskkill /PID %%a /F /T
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001"') do taskkill /PID %%a /F /T
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8002"') do taskkill /PID %%a /F /T