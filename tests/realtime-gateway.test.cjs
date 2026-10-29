const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { createAppRealtimeRouter } = require("../src/routes/appRealtimeRoutes");

test("web uses the same-origin gateway and native retains the configured remote API", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/js/realtime/realtimeList.js"), "utf8");
  const start = source.indexOf("    function resolveApiBase() {");
  const end = source.indexOf("    const API_BASE", start);
  for (const native of [false, true]) {
    const context = vm.createContext({ options: {}, normalizeApiBase: value => String(value || "").replace(/\/$/, ""),
      isNativeCapacitorRuntime: () => native, window: { BEAR_RUNTIME_CONFIG: { realtimeApiBase: "https://remote.test/api/realtime" } } });
    vm.runInContext(source.slice(start, end), context);
    assert.equal(context.resolveApiBase(), native ? "https://remote.test/api/realtime" : "api/app-realtime");
    context.options.apiBase = "https://override.test/api";
    assert.equal(context.resolveApiBase(), "https://override.test/api");
  }
});

test("gateway forwards remote records and uploads without forwarding browser credentials", async () => {
  const calls = [];
  const router = createAppRealtimeRouter({ apiBase: "https://remote.test/base/api/realtime", fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { status: 200, json: async () => options.method === "GET" ? { ok: true, items: [{ id: "remote-only" }] } : { ok: true, item: JSON.parse(options.body) } };
  } });
  const app = express(); app.use(express.json()); app.use("/api/app-realtime", router);
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/app-realtime/bear-estimates`;
  try {
    const result = await fetch(url + "?limit=200");
    assert.deepEqual((await result.json()).items, [{ id: "remote-only" }]);
    assert.equal(calls[0].url, "https://remote.test/base/api/realtime/bear-estimates?limit=200");
    const posted = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Cookie: "admin_session=local-only" }, body: JSON.stringify({ id: "estimate-1", lat: 35, lng: 127 }) });
    assert.equal((await posted.json()).item.id, "estimate-1");
    assert.equal(calls[1].options.headers.Cookie, undefined);
    assert.equal(calls[1].options.method, "POST");
    assert.equal((await fetch(url, { method: "DELETE" })).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("upstream failure becomes an explicit API error, not an empty successful list", async () => {
  const app = express();
  app.use(createAppRealtimeRouter({ apiBase: "https://remote.test/api/realtime", fetchImpl: async () => { throw new Error("upstream offline"); } }));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/bear-estimates`);
    assert.equal(result.status, 502);
    const body = await result.json(); assert.equal(body.ok, false); assert.ok(body.message);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
