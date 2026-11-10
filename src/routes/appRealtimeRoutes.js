const express = require("express");
const { createMovementTrackStore } = require("../services/movementTrackStore");

// The browser uses its own host. Catalogs use the configured upstream API;
// authenticated movement reads use the map database unless an upstream read key is configured.
function createAppRealtimeRouter({ apiBase, teamsApiUrl, movementApiUrl, movementReadKey, movementStore = createMovementTrackStore(), fetchImpl = fetch }) {
  const router = express.Router();
  const base = new URL(apiBase);
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("Invalid realtime API protocol");
  const targetBase = base.href.replace(/\/$/, "");
  const teamTarget = new URL(teamsApiUrl || new URL("../teams", targetBase + "/").href);
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
    if (!req.adminSession) {
      return res.status(401).json({
        ok:false, message:"공유 이동 기록을 보려면 관리자 로그인 후 이 화면으로 돌아와주세요.",
        loginUrl:req.baseUrl.replace(/\/api\/app-realtime$/, "") + "/admin/login"
      });
    }
    const id = req.params.id;
    if (id && !/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) return res.status(400).json({ok:false});
    try {
      if (!movementReadKey) {
        if (!id) {
          const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
          if (!Number.isSafeInteger(page) || page > 1000000) return res.status(400).json({ok:false});
          return res.json(await movementStore.list(page));
        }
        const item = await movementStore.detail(id);
        return item ? res.json(item) : res.status(404).json({ok:false, message:"이동 기록을 찾을 수 없습니다."});
      }
      const target = new URL(movementApiUrl || targetBase + "/movement-tracks");
      if (!["http:", "https:"].includes(target.protocol)) throw new Error("Invalid movement API protocol");
      if (id) target.pathname = target.pathname.replace(/\/$/, "") + "/" + id;
      else target.searchParams.set("page", String(Math.max(1, Math.floor(Number(req.query.page) || 1))));
      const response = await fetchImpl(target.href, {
        method:"GET", redirect:"error", signal:AbortSignal.timeout(10000),
        headers:{Accept:"application/json", Authorization:"Bearer " + movementReadKey}
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
