# Local Setup

## Prerequisites

- Node.js 20+
- Java 17+ (required for Planetiler)
- Python 3.13+
- Git

---

## Folder Structure

Keep the default folder names and locations unchanged.

---

## 1. Download OSM Data

Download the required `.osm.pbf` file and place it in:

```text
map-data-pbf/
```

By default this project is configured for:

```text
map-data-pbf/delhi.osm.pbf
```

---

## 2. Generate MBTiles

Run:

```bash
java -Xmx8g -jar planetiler.jar --osm-path=map-data-pbf/delhi.osm.pbf --output=map-tiles/delhi.mbtiles
```

---

## 3. Start the Vector Tile Server (Martin)

```bash
.\martin-server\martin.exe -l 127.0.0.1:3001 map-tiles\delhi.mbtiles
```

Martin will serve vector tiles on:

```
http://127.0.0.1:3001
```

---

## 4. Start the Search Backend

```bash
cd search-backend
npm install
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

```bash
valhalla_build_config --mjolnir-tile-dir valhalla_tiles --mjolnir-tile-extract valhalla_tiles.tar | sed '1s/^\xEF\xBB\xBF//' > valhalla.json
```

Build the routing tiles:

```bash
python -m valhalla valhalla_build_tiles -c valhalla.json "../map-data-pbf/delhi.osm.pbf"
```

---

## 6. Start the Routing Server

```bash
uvicorn app:app --host 0.0.0.0 --port 8002
```

Routing API:

```
http://127.0.0.1:8002
```

Swagger documentation:

```
http://127.0.0.1:8002/docs
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
| Search Backend | (configured in project) |
| Valhalla Routing API | http://127.0.0.1:8002 |
| Swagger Docs | http://127.0.0.1:8002/docs |