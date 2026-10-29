const express = require("express");

// The browser calls its own host; the server reaches the configured remote API.
// This keeps the remote dataset, without changing the administrator's local API.
function createAppRealtimeRouter({ apiBase, fetchImpl = fetch }) {
  const router = express.Router();
  const base = new URL(apiBase);
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("Invalid realtime API protocol");
  const targetBase = base.href.replace(/\/$/, "");
  async function forward(req, res) {
    try {
      const target = new URL(targetBase + "/bear-estimates");
      if (req.method === "GET") target.searchParams.set("limit", String(Math.min(500, Math.max(1, Number(req.query.limit) || 200))));
      if (req.method === "GET" && req.query.page != null) {
        target.searchParams.set("page", String(Math.max(1, Math.floor(Number(req.query.page) || 1))));
        target.searchParams.set("pageSize", String(Math.min(200, Math.max(1, Math.floor(Number(req.query.pageSize) || 200)))));
      }
      const response = await fetchImpl(target.href, {
        method: req.method, redirect: "error", signal: AbortSignal.timeout(12000),
        headers: { Accept: "application/json", ...(req.method === "POST" ? { "Content-Type": "application/json" } : {}) },
        ...(req.method === "POST" ? { body: JSON.stringify(req.body) } : {})
      });
      const result = await response.json();
      res.set("Cache-Control", "no-store");
      res.status(response.status).json(result);
    } catch (error) {
      console.warn("[App realtime gateway]", error.name, error.cause?.code || error.message);
      res.status(502).json({ ok: false, message: "공유 개체 목록 서버에 연결할 수 없습니다. 잠시 후 다시 시도해주세요." });
    }
  }
  router.get("/bear-estimates", forward);
  router.post("/bear-estimates", forward);
  return router;
}
module.exports = { createAppRealtimeRouter };
