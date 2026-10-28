const path = require("path");
const express = require("express");
const Database = require("better-sqlite3");
const { inflateSync } = require("zlib");
const { contains } = require("../../public/js/db/boundary-geometry");

function createAdminBoundaryRouter(rootDir) {
  const router = express.Router();
  let db;
  let query;
  const cache = new Map();
  router.get("/api/admin-boundary", (req, res) => {
    const { lat: rawLat, lng: rawLng } = req.query;
    const lat = Number(rawLat), lng = Number(rawLng);
    if (typeof rawLat !== "string" || !rawLat.trim() || typeof rawLng !== "string" || !rawLng.trim() ||
        !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return res.status(400).json({ error: "좌표를 확인해주세요." });
    }
    try {
      if (!db) {
        const opened = new Database(path.join(rootDir, "public/assets/databases/AdminBoundary.db"), { readonly: true, fileMustExist: true });
        try {
          if (opened.prepare("SELECT value FROM metadata WHERE key='crs'").get().value !== "EPSG:4326") throw new Error("Expected WGS84 boundaries");
          query = opened.prepare("SELECT b.id,b.emd_code,b.display_name FROM admin_boundaries b JOIN boundary_rtree r ON b.id=r.id WHERE r.min_x<=? AND r.max_x>=? AND r.min_y<=? AND r.max_y>=? ORDER BY b.emd_code");
          db = opened;
        } catch (error) { opened.close(); throw error; }
      }
      for (const row of query.all(lng, lng, lat, lat)) {
        let bytes = cache.get(row.id);
        if (!bytes) {
          bytes = inflateSync(db.prepare("SELECT geometry FROM admin_boundaries WHERE id=?").get(row.id).geometry);
          cache.set(row.id, bytes);
          if (cache.size > 8) cache.delete(cache.keys().next().value);
        }
        if (contains(bytes, lng, lat)) return res.json({ region: { name: row.display_name, code: row.emd_code } });
      }
      res.json({ region: null });
    } catch (error) {
      console.error("[Boundary]", error.message);
      res.status(503).json({ error: "행정구역 DB를 조회할 수 없습니다." });
    }
  });
  return router;
}
module.exports = { createAdminBoundaryRouter };
