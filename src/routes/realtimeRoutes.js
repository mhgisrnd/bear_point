const express = require("express");
const {
  listRealtimeBearEstimates,
  insertRealtimeBearEstimate,
  updateRealtimeBearEstimateById,
  deleteRealtimeBearEstimatesByIds,
} = require("../services/realtimeStore");

// 실시간 곰 추정위치 목록 조회 API 라우터를 생성한다.
function createRealtimeRouter() {
  const router = express.Router();

  router.get("/bear-estimates", async (req, res) => {
    try {
      const result = await listRealtimeBearEstimates({
        limit: req.query.limit,
        page: req.query.page,
        pageSize: req.query.pageSize,
        q: req.query.q,
      });

      const items = Array.isArray(result.items) ? result.items : [];
      res.json({
        ok: true,
        count: items.length,
        total: Number(result.total || items.length),
        page: Number(result.page || 1),
        pageSize: Number(result.pageSize || items.length),
        items,
      });
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
      const message = statusCode === 400 ? error.message : "실시간 항목 등록 실패";
      res.status(statusCode).json({ ok: false, message, detail: statusCode === 500 ? error.message : undefined });
    }
  });

  router.patch("/bear-estimates/:id", async (req, res) => {
    try {
      const actorId =
        req.adminSession?.adminAccount?.userId
        || req.adminSession?.adminAccount?.userName
        || null;
      const item = await updateRealtimeBearEstimateById(req.params.id, req.body, { actorId });
      res.json({ ok: true, item });
    } catch (error) {
      const statusCode = Number(error && error.statusCode) || 500;
      const message = statusCode === 400 || statusCode === 404 ? error.message : "실시간 항목 수정 실패";
      res.status(statusCode).json({ ok: false, message, detail: statusCode === 500 ? error.message : undefined });
    }
  });

  router.delete("/bear-estimates", async (req, res) => {
    try {
      const actorId =
        req.adminSession?.adminAccount?.userId
        || req.adminSession?.adminAccount?.userName
        || null;
      const result = await deleteRealtimeBearEstimatesByIds((req.body || {}).ids, { actorId });
      res.json({ ok: true, deletedCount: result.deletedCount });
    } catch (error) {
      const statusCode = Number(error && error.statusCode) || 500;
      const message = statusCode === 400 ? error.message : "실시간 항목 삭제 실패";
      res.status(statusCode).json({ ok: false, message, detail: statusCode === 500 ? error.message : undefined });
    }
  });

  return router;
}

module.exports = {
  createRealtimeRouter,
};
