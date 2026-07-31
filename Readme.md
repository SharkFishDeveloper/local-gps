<!-- # Local Setup

## Prerequisites

- Node.js 20+
- Java 17+ (required for Planetiler)
- Python 3.13+
- Git

---

## Important thing to remember
The files and folder names are very important, so if they are changed then update them properly.
This project has 4 servers: so you need to run them before using the local GPS.
- martin server (a backend component to render map properly in frontend)
- search-backend (for searching places in map)
- valhalla (for tracing routes)
- frontend (next.js frontend)
---

# To start default project (delhi map)
## 1. Start martin-server
```bash
.\martin-server\martin.exe -l 127.0.0.1:3001 map-tiles\delhi.mbtiles
```
## 2. Start search backend
```bash
cd search-backend
npm i
Change the file path in -> const filePath = path.join(__dirname, "../map-data-pbf/delhi.osm.pbf");
npm run build-db [This command is important, as it stores the important places in sqlite DB for better search result]
npm run dev
```
## 3. Build Valhalla Routing Tiles
Install the Python dependencies first:
```bash
cd valhalla
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8002
```

## 4. Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

# To use any map of your choice -- follow the instructions below:
## 1. Download OSM Data from [BBBk](https://extract.bbbike.org/)

Download the required `.osm.pbf` file and place it in:
```text
map-data-pbf/[filename].osmp.pbf
```
---

## 2. Generate MBTiles
This is important because we can't render a pbf file in frontend, so we need to convert the .pbf to .mbtiles format using planetiler.jar file.
Run in root dir:
```bash
java -Xmx8g -jar planetiler.jar --osm-path=map-data-pbf/[filename].osm.pbf --output=map-tiles/[filename].mbtiles
```

---

## 3. Start the Vector Tile Server (Martin)
Run in root dir:
```bash
.\martin-server\martin.exe -l 127.0.0.1:3001 map-tiles\[filename].mbtiles
```
---

## 4. Start the Search Backend

```bash
cd search-backend
Change the file path in -> const filePath = path.join(__dirname, "../map-data-pbf/[filename].osm.pbf");
npm run build-db [This command is important, as it stores the important places in sqlite DB for better search result]
npm run dev
```
---

## 5. Build Valhalla Routing Tiles
Install the Python dependencies first:
```bash
cd valhalla
pip install -r requirements.txt
```
Generate the Valhalla configuration:

```Git bash
valhalla_build_config --mjolnir-tile-dir valhalla_tiles --mjolnir-tile-extract valhalla_tiles.tar | sed '1s/^\xEF\xBB\xBF//' > valhalla.json
```

Build the routing tiles:

```Git bash
python -m valhalla valhalla_build_tiles -c valhalla.json "../map-data-pbf/[filename].osm.pbf"
```

---

## 6. Start the Routing Server

```bash
uvicorn app:app --host 0.0.0.0 --port 8002
```
Routing API:
---

## 7. Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

---

# Services

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Martin Vector Tiles | http://127.0.0.1:3001 |
| Search Backend | http://localhost:4000 |
| Valhalla Routing API | http://127.0.0.1:8002 |

Now go to http://localhost:3000 to show the UI -->

# Local Setup

## Prerequisites

- Node.js 20+
- Java 17+ (required for Planetiler)
- Python 3.13+
- Git

---

## Important Things to Remember

- The file names and folder structure are important. If you rename or move any files or folders, make sure to update the corresponding file paths in the project.
- This project consists of four services that must be running before the application works correctly:
  - **Martin Server** – Serves vector map tiles to the frontend.
  - **Search Backend** – Indexes and searches locations from the map data.
  - **Valhalla** – Provides routing and navigation APIs.
  - **Frontend** – Next.js application.

---

# Start the Default Project (Delhi Map)

## 1. Start the Martin Server

```bash
.\martin-server\martin.exe -l 127.0.0.1:3001 map-tiles\delhi.mbtiles
```

## 2. Start the Search Backend

```bash
cd search-backend
npm install
npm run dev
```

## 3. Start the Valhalla Routing Server

Install the Python dependencies:

```bash
cd valhalla
python -m venv .venv
.\.venv\Scripts\Activate
pip install -r requirements.txt
```

Start the server:
```bash
uvicorn app:app --host 0.0.0.0 --port 8002
```
Or if you don't want to activate venv, then this command, provided uvicorn is downloaded
```bash
py -m uvicorn app:app --host 0.0.0.0 --port 8002 
```

## 4. Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

---

# Use a Different Map

Follow the steps below to use any city or region of your choice.

## 1. Download OSM Data

Download the required `.osm.pbf` file from **BBBike**:

https://extract.bbbike.org/

Place the downloaded file in:

```text
map-data-pbf/[filename].osm.pbf
```

---

## 2. Generate MBTiles

The frontend cannot render an `.osm.pbf` file directly, so it must first be converted to the `.mbtiles` format using **Planetiler**.

Run from the project root:

```bash
java -Xmx8g -jar planetiler.jar --osm-path=map-data-pbf/[filename].osm.pbf --output=map-tiles/[filename].mbtiles
```

---

## 3. Start the Martin Server

Run from the project root:

```bash
.\martin-server\martin.exe -l 127.0.0.1:3001 map-tiles\[filename].mbtiles
```

---

## 4. Start the Search Backend

```bash
cd search-backend
npm install
```

Update the file path in:

```ts
const filePath = path.join(__dirname, "../map-data-pbf/[filename].osm.pbf");
```

Build the search database:

```bash
npm run build-db
```

This command extracts searchable places from the `.osm.pbf` file and stores them in a SQLite database. Run it whenever you change the map data.

Start the backend:

```bash
npm run dev
```

---

## 5. Build Valhalla Routing Tiles

Install the Python dependencies:

```bash
cd valhalla
python -m venv .venv
.\.venv\Scripts\Activate
pip install -r requirements.txt
```

Generate the Valhalla configuration:

```bash
valhalla_build_config --mjolnir-tile-dir valhalla_tiles --mjolnir-tile-extract valhalla_tiles.tar | sed '1s/^\xEF\xBB\xBF//' > valhalla.json
```

Build the routing tiles:

```bash
python -m valhalla valhalla_build_tiles -c valhalla.json "../map-data-pbf/[filename].osm.pbf"
```

---

## 6. Start the Valhalla Routing Server

```bash
uvicorn app:app --host 0.0.0.0 --port 8002
```

---

## 7. Start the Frontend

```bash
cd frontend
npm install
npm run dev
```

---

# Services

| Service | URL |
|---------|-----|
| Frontend | http://localhost:3000 |
| Martin Vector Tiles | http://127.0.0.1:3001 |
| Search Backend | http://localhost:4000 |
| Valhalla Routing API | http://127.0.0.1:8002 |

Once all the services are running, open **http://localhost:3000** in your browser.