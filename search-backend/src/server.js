const express = require("express");
const cors = require("cors");
const Database = require("better-sqlite3");

const app = express();
const PORT = 4000;

app.use(cors());

const db = new Database("./src/places.db", {
    readonly: true,
});

const searchStmt = db.prepare(`
SELECT
    p.id,
    p.name,
    p.class,
    p.subclass,
    p.lat,
    p.lon,
    bm25(places_fts) as rank
FROM places_fts
JOIN places p ON p.id = places_fts.rowid
WHERE places_fts MATCH ?
ORDER BY rank
LIMIT 20;
`);

app.get("/search", (req, res) => {
  const q = req.query.q?.trim();
  if (!q) return res.json([]);

  const ftsQuery = q
    .split(/\s+/)
    .map((word) => `"${word.replace(/"/g, '""')}"*`)
    .join(" ");

  try {
    const rows = searchStmt.all(ftsQuery);

    // dedupe by name, keeping the first (best-ranked) occurrence
    const seen = new Set();
    const deduped = [];
    for (const row of rows) {
      if (!seen.has(row.name)) {
        seen.add(row.name);
        deduped.push(row);
      }
      if (deduped.length === 5) break;
    }

    res.json(deduped);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Search failed" });
  }
});

app.get("/health", (_, res) => {
    res.json({
        status: "ok",
    });
});

app.listen(PORT, () => {
    console.log(`Search server running on http://localhost:${PORT}`);
});