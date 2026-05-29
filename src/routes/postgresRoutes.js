const express = require("express");
const { PG_CONFIG, checkPostgresHealth } = require("../db/postgres");

// PostgreSQL 상태 확인 API 라우터를 생성한다.
function createPostgresRouter() {
  const router = express.Router();

  router.get("/health", async (req, res) => {
    try {
      const health = await checkPostgresHealth();
      res.json({
        ok: true,
        host: PG_CONFIG.host,
        port: PG_CONFIG.port,
        database: health.db_name,
        user: health.db_user,
        serverTime: health.server_time,
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        message: "PostgreSQL 연결 확인 실패",
        detail: error.message,
      });
    }
  });

  return router;
}

module.exports = {
  createPostgresRouter,
};
