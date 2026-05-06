// server.js
const path = require("path");
const express = require("express");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;

// ✅ MBTiles DB 연결 (없으면 타일 API 비활성화)
const MBTILES_PATH = path.join(__dirname, "mbtiles", "korea-selection2-z7-z17-webp.mbtiles");
let mbtilesDb = null;
let mbtilesStmt = null;
try {
  mbtilesDb = new Database(MBTILES_PATH, { readonly: true });
  mbtilesStmt = mbtilesDb.prepare(
    "SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?"
  );
  console.log("✅ MBTiles loaded:", MBTILES_PATH);
} catch (e) {
  console.warn("⚠️  MBTiles not loaded:", e.message);
}

// ✅ 곰 최신값: 처음엔 없음
let latest = null;

// ✅ 서버 위치: 처음엔 없음
let serverPos = { lat: null, lng: null, ts: null };

// ✅ (추가) ngrok 브라우저 경고 페이지 스킵 헤더
app.use((req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  next();
});

app.use(express.static(path.join(__dirname, "public")));
app.use("/node_modules", express.static(path.join(__dirname, "node_modules")));

function buildMbtilesManifest() {
  if (!mbtilesDb) {
    return null;
  }

  const metaStmt = mbtilesDb.prepare("SELECT name, value FROM metadata");
  const metaRows = metaStmt.all();
  const metadata = {};
  for (const row of metaRows) {
    metadata[row.name] = row.value;
  }

  const levelsStmt = mbtilesDb.prepare(
    "SELECT zoom_level AS z, MIN(tile_column) AS min_x, MAX(tile_column) AS max_x, MIN(tile_row) AS min_row, MAX(tile_row) AS max_row, COUNT(*) AS tile_count FROM tiles GROUP BY zoom_level ORDER BY zoom_level"
  );
  const levelRows = levelsStmt.all();
  const levels = {};
  let minZoom = Number.POSITIVE_INFINITY;
  let maxZoom = Number.NEGATIVE_INFINITY;
  let totalTiles = 0;

  for (const row of levelRows) {
    const z = Number(row.z);
    const scaleMax = Math.pow(2, z) - 1;
    const minY = scaleMax - Number(row.max_row);
    const maxY = scaleMax - Number(row.min_row);

    levels[String(z)] = {
      minX: Number(row.min_x),
      maxX: Number(row.max_x),
      minY: minY,
      maxY: maxY,
      tileCount: Number(row.tile_count),
      archives: []
    };

    minZoom = Math.min(minZoom, z);
    maxZoom = Math.max(maxZoom, z);
    totalTiles += Number(row.tile_count);
  }

  if (!Number.isFinite(minZoom)) {
    minZoom = Number(metadata.minzoom || 0);
  }
  if (!Number.isFinite(maxZoom)) {
    maxZoom = Number(metadata.maxzoom || 0);
  }

  return {
    generatedAt: new Date().toISOString(),
    archiveCount: 0,
    minZoom: minZoom,
    maxZoom: maxZoom,
    tileCount: totalTiles,
    outputDir: MBTILES_PATH,
    sourceMode: "mbtiles",
    format: metadata.format || "webp",
    levels: levels,
    warnings: []
  };
}

app.get("/api/mbtiles-manifest", (req, res) => {
  const manifest = buildMbtilesManifest();
  if (!manifest) {
    return res.status(503).json({ error: "MBTiles not available" });
  }
  res.set("Cache-Control", "no-store");
  res.json(manifest);
});

// ✅ MBTiles 타일 엔드포인트 (TMS y축 → XYZ 변환)
app.get("/mbtiles/:z/:x/:y.tile", (req, res) => {
  if (!mbtilesDb || !mbtilesStmt) {
    return res.status(503).send("MBTiles not available");
  }
  const z = parseInt(req.params.z, 10);
  const x = parseInt(req.params.x, 10);
  const y = parseInt(req.params.y, 10);
  if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
    return res.status(400).send("Invalid tile coordinates");
  }
  // MBTiles는 TMS 좌표: row = (2^z - 1) - y
  const tmsRow = (Math.pow(2, z) - 1) - y;
  const row = mbtilesStmt.get(z, x, tmsRow);
  if (!row) {
    return res.status(204).end();
  }
  res.set("Content-Type", "image/webp");
  res.set("Cache-Control", "public, max-age=86400");
  res.send(row.tile_data);
});

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pages", "login.html"));
});

app.get("/admin/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pages", "admin-login.html"));
});


app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running: http://localhost:${PORT}`);
});