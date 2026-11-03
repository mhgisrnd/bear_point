const path = require("path");
const express = require("express");
const Database = require("better-sqlite3");
const { inflateSync } = require("zlib");
const { contains, displayOptions, displayFeature } = require("../../public/js/db/boundary-geometry");

function createAdminBoundaryRouter(rootDir) {
  const router = express.Router();
  let db;
  let query;
  const cache = new Map();
  const displayCache = new Map();
  function openDb() {
    if (db) return db;
    const opened = new Database(path.join(rootDir, "public/assets/databases/AdminBoundary.db"), { readonly: true, fileMustExist: true });
    try {
      if (opened.prepare("SELECT value FROM metadata WHERE key='crs'").get()?.value !== "EPSG:4326") throw new Error("Expected WGS84 boundaries");
      query = opened.prepare("SELECT b.id,b.emd_code,b.display_name FROM admin_boundaries b JOIN boundary_rtree r ON b.id=r.id WHERE r.min_x<=? AND r.max_x>=? AND r.min_y<=? AND r.max_y>=? ORDER BY b.emd_code");
      return db = opened;
    } catch (error) { opened.close(); throw error; }
  }
  router.get("/api/admin-boundaries", (req, res) => {
    let options;
    try {
      if (typeof req.query.bbox !== "string" || req.query.bbox.split(",").some(n => !n.trim()) || typeof req.query.zoom !== "string" || !req.query.zoom.trim()) throw new Error("지도 범위를 확인해주세요.");
      options = displayOptions(req.query.bbox.split(",").map(Number), Number(req.query.zoom));
    } catch (error) { return res.status(400).json({ error: error.message }); }
    const collection = { type: "FeatureCollection", features: [], limited: false, minZoom: options.minZoom };
    if (options.zoom < options.minZoom) return res.json(collection);
    try {
      const [west,south,east,north] = options.bounds;
      const rows = openDb().prepare("SELECT b.id,b.emd_code,b.display_name FROM admin_boundaries b JOIN boundary_rtree r ON b.id=r.id WHERE r.min_x<=? AND r.max_x>=? AND r.min_y<=? AND r.max_y>=? ORDER BY b.id LIMIT ?").all(east,west,north,south,options.limit+1);
      if (rows.length > options.limit) return res.json({ ...collection, limited: true });
      collection.features = rows.map(row => {
        const key = row.id + ":" + options.zoom;
        if (!displayCache.has(key)) {
          const bytes = inflateSync(db.prepare("SELECT geometry FROM admin_boundaries WHERE id=?").get(row.id).geometry);
          displayCache.set(key, displayFeature(row, bytes, options.zoom));
          if (displayCache.size > 80) displayCache.delete(displayCache.keys().next().value);
        }
        return displayCache.get(key);
      });
      res.json(collection);
    } catch (error) { console.error("[Boundary display]", error.message); res.status(503).json({ error: "행정경계망을 불러올 수 없습니다." }); }
  });
  router.get("/api/admin-boundary", (req, res) => {
    const { lat: rawLat, lng: rawLng } = req.query;
    const lat = Number(rawLat), lng = Number(rawLng);
    if (typeof rawLat !== "string" || !rawLat.trim() || typeof rawLng !== "string" || !rawLng.trim() ||
        !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return res.status(400).json({ error: "좌표를 확인해주세요." });
    }
    try {
      openDb();
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
