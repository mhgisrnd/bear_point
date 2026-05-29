const express = require("express");
const {
  listRealtimeBearEstimates,
  insertRealtimeBearEstimate,
} = require("../services/realtimeStore");

// 실시간 곰 추정위치 저장/조회 API 라우터를 생성한다.
function createRealtimeRouter() {
  const router = express.Router();

  router.get("/bear-estimates", async (req, res) => {
    try {
      const items = await listRealtimeBearEstimates(req.query.limit);
      res.json({ ok: true, count: items.length, items });
    } catch (error) {
      res.status(500).json({ ok: false, message: "실시간 목록 조회 실패", detail: error.message });
    }
  });

  router.post("/bear-estimates", async (req, res) => {
    try {
      const item = await insertRealtimeBearEstimate(req.body);
      res.json({ ok: true, item });
    } catch (error) {
      const statusCode = Number(error && error.statusCode) || 500;
      const message = statusCode === 400 ? error.message : "실시간 항목 저장 실패";
      res.status(statusCode).json({ ok: false, message, detail: statusCode === 500 ? error.message : undefined });
    }
  });

  return router;
}

module.exports = {
  createRealtimeRouter,
};
