const osmread = require("osm-read");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "../map-data-pbf/delhi.osm.pbf");

console.log("Looking for file at:", filePath);
console.log("Exists:", fs.existsSync(filePath));

if (!fs.existsSync(filePath)) {
  console.error("PBF file not found — check the path above.");
  process.exit(1);
}

const db = new Database("./src/places.db");

db.exec(`
  DROP TABLE IF EXISTS places;
  DROP TABLE IF EXISTS places_fts;

  CREATE TABLE places (
    id INTEGER PRIMARY KEY,
    name TEXT,
    class TEXT,
    subclass TEXT,
    lat REAL,
    lon REAL
  );

  CREATE VIRTUAL TABLE places_fts USING fts5(
    name,
    content='places',
    content_rowid='id'
  );
`);

const insert = db.prepare(`
  INSERT INTO places (id, name, class, subclass, lat, lon)
  VALUES (@id, @name, @class, @subclass, @lat, @lon)
`);

const insertFts = db.prepare(`
  INSERT INTO places_fts (rowid, name) VALUES (?, ?)
`);

let count = 0;
const insertOne = db.transaction((row) => {
  insert.run(row);
  insertFts.run(row.id, row.name);
});

osmread.parse({
  filePath: filePath,

  node: function (node) {
    const tags = node.tags || {};
    const name = tags.name;
    if (!name) return;

    const cls = tags.amenity || tags.shop || tags.tourism || tags.place || "unknown";
    const subclass = tags.amenity || tags.shop || tags.tourism || "";

    insertOne({
      id: node.id,
      name,
      class: cls,
      subclass,
      lat: node.lat,
      lon: node.lon,
    });
    count++;
    if (count % 5000 === 0) console.log(`Processed ${count} places...`);
  },

  way: function () {},
  relation: function () {},

  error: function (msg) {
    console.error("Error:", msg);
  },

  endDocument: function () {
    console.log(`Done. Inserted ${count} places into places.db`);
    db.close();
  },
});