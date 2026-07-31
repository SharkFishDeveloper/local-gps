@echo off
cd /d "%~dp0"

echo Checking and starting services...

:: Open startup dashboard
start "" "%~dp0running-services.html"

:: 1. Martin Server
start "Martin Server" cmd /k ".\martin-server\martin.exe -l 127.0.0.1:3001 map-tiles\delhi.mbtiles"

:: 2. Search Backend
start "Search Backend" cmd /k "cd /d "%~dp0search-backend" && (if not exist node_modules npm install) && npm run dev"

:: 3. Valhalla Routing Server
start "Valhalla Server" cmd /k "cd /d "%~dp0valhalla" && (if not exist .venv (py -m venv .venv && .venv\Scripts\python -m pip install -r requirements.txt)) && call .venv\Scripts\activate.bat && python -m uvicorn app:app --host 0.0.0.0 --port 8002"

:: 4. Frontend
start "Frontend" cmd /k "cd /d "%~dp0frontend" && (if not exist node_modules npm install) && npm run dev"

:: Wait for servers to initialize before opening browser
timeout /t 20 >nul
start http://localhost:3000