const express = require("express");
const { createObservationStore } = require("../services/observationStore");

function createObservationRouter(store = createObservationStore()) {
  const router = express.Router();
  const handle = fn => async (req, res) => {
    try { res.json({ ok: true, ...await fn(req) }); }
    catch (error) {
      const status = error.statusCode || 503;
      if (status >= 500) console.error("[Observation API]", error.message);
      res.status(status).json({ ok: false, message: status < 500 ? error.message : "관측점 서버에 연결할 수 없습니다.", ...(status === 409 && error.item ? { conflict: true, item: error.item } : {}) });
    }
  };
  const admin = (req, res, next) => {
    if (!req.adminSession) return res.status(401).json({ ok: false, message: "관리자 로그인이 필요합니다." });
    // The administrator PATCH/DELETE routes retain their session and origin checks.
    const site = req.get("Sec-Fetch-Site");
    if (site === "cross-site") return res.status(403).json({ ok: false, message: "허용되지 않은 요청입니다." });
    next();
  };
  const actor = req => String(req.adminSession.adminAccount?.userId || req.adminSession.adminAccount?.userName || "admin");
  router.get("/", handle(req => store.list({ after: req.query.after, limit: req.query.limit })));
  router.post("/", handle(req => store.insert(req.body)));
  router.get("/:id", handle(async req => ({ item: await store.get(req.params.id) })));
  router.post("/:id/revisions", handle(req => store.revise(req.params.id, req.body)));
  router.post("/:id/removal", handle(req => store.removeFromApp(req.params.id, req.body.server_version)));
  router.patch("/:id", admin, handle(async req => ({ item: await store.update(req.params.id, req.body, actor(req)) })));
  router.delete("/:id", admin, handle(async req => ({ item: await store.remove(req.params.id, req.body.server_version, actor(req)) })));
  return router;
}
module.exports = { createObservationRouter };
