const express = require("express");

// MBTiles 매니페스트/타일 서빙 라우터를 생성한다.
function createMbtilesRouter(mbtilesStore) {
  const router = express.Router();

  router.get("/api/mbtiles-manifest", (req, res) => {
    const manifest = mbtilesStore.buildManifest();
    if (!manifest) {
      return res.status(503).json({ error: "MBTiles not available" });
    }

    res.set("Cache-Control", "no-store");
    res.json(manifest);
  });

  router.get("/mbtiles/:z/:x/:y.tile", (req, res) => {
    if (!mbtilesStore.isReady()) {
      return res.status(503).send("MBTiles not available");
    }

    const z = parseInt(req.params.z, 10);
    const x = parseInt(req.params.x, 10);
    const y = parseInt(req.params.y, 10);

    if (!Number.isFinite(z) || !Number.isFinite(x) || !Number.isFinite(y)) {
      return res.status(400).send("Invalid tile coordinates");
    }

    const row = mbtilesStore.getTile(z, x, y);
    if (!row) {
      return res.status(204).end();
    }

    res.set("Content-Type", "image/webp");
    res.set("Cache-Control", "public, max-age=86400");
    res.send(row.tile_data);
  });

  return router;
}

module.exports = {
  createMbtilesRouter,
};
