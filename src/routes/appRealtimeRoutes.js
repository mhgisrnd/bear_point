const express = require("express");

// The browser uses its own host. Catalogs use the configured upstream API;
// Movement reads use the same public upstream API as mobile clients.
function createAppRealtimeRouter({ apiBase, teamsApiUrl, movementApiUrl, fetchImpl = fetch }) {
  const router = express.Router();
  const base = new URL(apiBase);
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("Invalid realtime API protocol");
  const targetBase = base.href.replace(/\/$/, "");
  const teamTarget = new URL(teamsApiUrl || new URL("../teams", targetBase + "/").href);
  router.get('/bear-estimates/history', async (req,res) => {
    res.set('Cache-Control','no-store');
    const code=String(req.query.bearCode || '').trim();
    if(!code || code.length>100)return res.status(400).json({ok:false,message:'개체 코드를 확인해주세요.'});
    try {
      const target=new URL(targetBase+'/bear-estimates/history');
      target.searchParams.set('bearCode',code);
      target.searchParams.set('page',String(Math.max(1,Math.floor(Number(req.query.page)||1))));
      target.searchParams.set('pageSize',String(Math.min(100,Math.max(1,Math.floor(Number(req.query.pageSize)||100)))));
      const response=await fetchImpl(target.href,{redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'application/json'}});
      res.status(response.status).json(await response.json());
    } catch(_) {res.status(502).json({ok:false,message:'이력 서버에 연결하지 못했습니다.'});}
  });
  if (!["http:", "https:"].includes(teamTarget.protocol)) throw new Error("Invalid team API protocol");
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
  router.post("/movement-tracks", async (req,res) => {
    res.set("Cache-Control","no-store");
    try {
      const target=new URL(movementApiUrl || targetBase+"/movement-tracks");
      if(!["http:","https:"].includes(target.protocol)) throw new Error("Invalid movement API protocol");
      const response=await fetchImpl(target.href,{method:"POST",redirect:"error",signal:AbortSignal.timeout(25000),
        headers:{Accept:"application/json","Content-Type":"application/json"},body:JSON.stringify(req.body)});
      res.status(response.status).json(await response.json());
    } catch(_) {res.status(502).json({ok:false,message:"이동기록 서버에 연결할 수 없습니다."});}
  });
  router.get(["/movement-tracks", "/movement-tracks/:id"], async (req, res) => {
    res.set("Cache-Control", "no-store");
    const id = req.params.id;
    if (id && !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) return res.status(400).json({ok:false});
    try {
      const target = new URL(movementApiUrl || targetBase + "/movement-tracks");
      if (!["http:", "https:"].includes(target.protocol)) throw new Error("Invalid movement API protocol");
      if (id) target.pathname = target.pathname.replace(/\/$/, "") + "/" + id;
      else target.searchParams.set("page", String(Math.max(1, Math.floor(Number(req.query.page) || 1))));
      const response = await fetchImpl(target.href, {
        method:"GET", redirect:"error", signal:AbortSignal.timeout(10000),
        headers:{Accept:"application/json"}
      });
      const result = await response.json().catch(() => ({ok:false}));
      res.status(response.status).json(result);
    } catch (_) {
      res.status(502).json({ok:false, message:"공유 이동 기록 서버에 연결할 수 없습니다."});
    }
  });
  router.get("/bear-estimates", forward);
  router.get("/bear-entities", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const response = await fetchImpl(targetBase + "/bear-entities", {
        method: "GET", redirect: "error", signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" }
      });
      res.status(response.status).json(await response.json());
    } catch (_) { res.status(502).json({ ok: false, message: "개체 주파수 목록을 갱신하지 못했습니다." }); }
  });
  router.post("/bear-estimates", forward);
  // Read-only catalog from the administrator server; browser credentials stay local.
  router.get("/teams", async (req, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const response = await fetchImpl(teamTarget.href, { method: "GET", redirect: "error", signal: AbortSignal.timeout(8000), headers: { Accept: "application/json" } });
      res.status(response.status).json(await response.json());
    } catch (_) { res.status(502).json({ ok: false, message: "팀 목록을 갱신하지 못했습니다." }); }
  });
  return router;
}
module.exports = { createAppRealtimeRouter };
