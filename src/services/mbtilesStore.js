const path = require("path");
const Database = require("better-sqlite3");

// MBTiles 파일 접근 유틸(상태/매니페스트/타일 조회)을 생성한다.
function createMbtilesStore(rootDir) {
  const mbtilesPath = process.env.MBTILES_PATH
    ? path.resolve(process.env.MBTILES_PATH)
    : path.join(rootDir, "mbtiles", "korea-selection2-z7-z17-webp.mbtiles");

  let db = null;
  let tileStmt = null;

  try {
    db = new Database(mbtilesPath, { readonly: true });
    tileStmt = db.prepare(
      "SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?"
    );
    console.log("✅ MBTiles loaded:", mbtilesPath);
  } catch (error) {
    console.warn("⚠️  MBTiles not loaded:", error.message);
  }

  // MBTiles DB와 타일 statement 준비 여부를 반환한다.
  function isReady() {
    return !!(db && tileStmt);
  }

  // metadata/tiles 정보를 기반으로 매니페스트 객체를 구성한다.
  function buildManifest() {
    if (!isReady()) return null;

    const metaStmt = db.prepare("SELECT name, value FROM metadata");
    const metaRows = metaStmt.all();
    const metadata = {};
    for (const row of metaRows) {
      metadata[row.name] = row.value;
    }

    const levelsStmt = db.prepare(
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
        minY,
        maxY,
        tileCount: Number(row.tile_count),
        archives: [],
      };

      minZoom = Math.min(minZoom, z);
      maxZoom = Math.max(maxZoom, z);
      totalTiles += Number(row.tile_count);
    }

    if (!Number.isFinite(minZoom)) minZoom = Number(metadata.minzoom || 0);
    if (!Number.isFinite(maxZoom)) maxZoom = Number(metadata.maxzoom || 0);

    return {
      generatedAt: new Date().toISOString(),
      archiveCount: 0,
      minZoom,
      maxZoom,
      tileCount: totalTiles,
      outputDir: mbtilesPath,
      sourceMode: "mbtiles",
      format: metadata.format || "webp",
      levels,
      warnings: [],
    };
  }

  // XYZ 좌표를 받아 MBTiles(TMS row 변환)에서 타일 1건을 조회한다.
  function getTile(z, x, y) {
    if (!isReady()) return null;
    const tmsRow = (Math.pow(2, z) - 1) - y;
    return tileStmt.get(z, x, tmsRow);
  }

  return {
    isReady,
    buildManifest,
    getTile,
  };
}

module.exports = {
  createMbtilesStore,
};
