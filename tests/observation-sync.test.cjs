const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const Database = require("better-sqlite3");
const express = require("express");
const { createObservationRouter } = require("../src/routes/observationRoutes");
const { normalize } = require("../src/services/observationStore");
const source = fs.readFileSync(path.join(__dirname, "../public/js/obs/observation-sync.js"), "utf8");

function fixture(native = false) {
  const storage = new Map();
  const db = new Database(":memory:");
  db.exec("CREATE TABLE observations(id TEXT PRIMARY KEY,bear_code TEXT,owner TEXT,place TEXT,admin_region TEXT,lat REAL,lng REAL,heading REAL,detectors_json TEXT,created_at TEXT,updated_at TEXT)");
  const config = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../public/js/db/sqlite-migrations.js"), "utf8"), { window: config });
  config.BearSQLiteConfig.migrations[14].forEach(sql => db.exec(sql));
  config.BearSQLiteConfig.migrations[16].forEach(sql => db.exec(sql));
  let transport = async () => { throw new Error("offline"); };
  function boot(runtimeConfig = {}) {
    const window = { Capacitor: { isNativePlatform: () => native, Plugins: { CapacitorSQLite: {
      run: async options => ({ changes: { changes: db.prepare(options.statement).run(...options.values).changes } }),
      query: async options => ({ values: db.prepare(options.statement).all(...options.values) })
    } } }, BearSQLite: { initialize: async () => ({ ready: true }) },
    BEAR_RUNTIME_CONFIG: runtimeConfig,
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
    vm.runInNewContext(source, { window, setTimeout, clearTimeout, AbortController, fetch: (...args) => transport(...args) });
    return window.BearObservationSync;
  }
  return { db, boot, setTransport: fn => { transport = fn; } };
}
const draft = (id = "obs-test") => ({ id, bearCode: "bear", owner: "owner", place: "original", adminRegion: "region", lat: 35, lng: 127, heading: 90 });
function remote(overrides = {}) {
  return { id: "obs-test", bear_code: "bear", owner: "owner", place: "original", admin_region: "region", lat: 35, lng: 127, heading: 90,
    detectors_json: [], created_at: "2026-10-28T01:00:00Z", updated_at: "2026-10-28T01:00:00Z", uploaded_at: "2026-10-28T01:00:00Z", server_version: 1, deleted: false, ...overrides };
}
const response = result => ({ ok: true, json: async () => ({ ok: true, ...result }) });

test("web observations stay on the current server while native uses the remote API", async () => {
  for (const native of [false, true]) {
    const f = fixture(native);
    let requested;
    f.setTransport(async url => { requested = url; return response({ items: [], next: null }); });
    try {
      const sync = f.boot({ realtimeApiBase: "https://example.test/base/api/realtime" });
      await sync.pull();
      assert.equal(requested, native ? "https://example.test/base/api/observations?limit=200&after=" : "api/observations?limit=200&after=");
    } finally { f.db.close(); }
  }
});

test("a dedicated observation API override remains supported", async () => {
  const f = fixture(false); let requested;
  f.setTransport(async url => { requested = url; return response({ items: [], next: null }); });
  try {
    await f.boot({ observationsApiBase: "https://example.test/custom/" }).pull();
    assert.equal(requested, "https://example.test/custom?limit=200&after=");
  } finally { f.db.close(); }
});

for (const native of [false, true]) {
  test(`${native ? "SQLite" : "web"}: shared editing preserves offline drafts, resolves conflicts explicitly and respects deletion`, async () => {
    const f = fixture(native); let sync = f.boot();
    try {
      await sync.saveDraft(draft(), []);
      assert.equal((await sync.upload("obs-test")).ok, false);
      sync = f.boot();
      assert.equal((await sync.find("obs-test")).share_state, "failed");
      await sync.saveDraft({ ...draft(), place: "offline-edit" }, [], true);
      // A stale server list must not replace unsent edits.
      f.setTransport(async () => response({ items: [remote()], next: null }));
      await sync.pull();
      assert.equal((await sync.find("obs-test")).place, "offline-edit");
      // A lost initial receipt with later edits must be compared, never overwritten.
      f.setTransport(async () => response({ item: remote(), alreadyExists: true }));
      const retry = await sync.upload("obs-test");
      assert.equal(retry.ok, false); assert.equal(retry.conflict, true);
      assert.equal((await sync.find("obs-test")).place, "offline-edit");
      let row = await sync.find("obs-test");
      await sync.resolveConflict("obs-test", "server", 1, row.sync_mutation_id);
      assert.equal((await sync.find("obs-test")).place, "original");
      assert.equal((await sync.all()).length, 1, "a shared observation replaces its local row instead of appearing twice");
      assert.equal(JSON.parse((await sync.find("obs-test")).unshared_backup).place, "offline-edit");
      await sync.saveDraft({ ...draft(), place: "app-edit" }, [], true);
      assert.equal((await sync.find("obs-test")).server_version, 1);
      await assert.rejects(() => sync.removeDraft("obs-test"), /관리자/);
      f.setTransport(async () => response({ items: [remote({ place: "admin-edit", server_version: 2 })], next: null }));
      await sync.pull();
      row = await sync.find("obs-test");
      assert.equal(row.place, "app-edit");
      assert.equal(row.share_state, "conflict");
      assert.equal((await sync.upload(row.id)).conflict, true);
      f.setTransport(async (url, options) => {
        assert.match(url, /obs-test\/revisions$/);
        const body = JSON.parse(options.body);
        assert.equal(body.server_version, 2);
        assert.equal(body.place, "app-edit");
        return response({ item: remote({ place: body.place, server_version: 3, sync_mutation_id: body.mutation_id }) });
      });
      assert.equal((await sync.resolveConflict(row.id, "local", 2, row.sync_mutation_id)).ok, true);
      assert.equal((await sync.find(row.id)).share_state, "shared");
      await sync.saveDraft({ ...draft(), place: "offline-again" }, [], true);
      f.setTransport(async () => response({ items: [remote({ deleted: true, server_version: 4 })], next: null }));
      await sync.pull();
      row = await sync.find("obs-test");
      assert.equal(row.place, "offline-again");
      assert.equal(row.share_state, "conflict");
      await assert.rejects(() => sync.resolveConflict(row.id, "local", 4, row.sync_mutation_id), /삭제/);
      await sync.resolveConflict(row.id, "server", 4, row.sync_mutation_id);
      assert.equal((await sync.find("obs-test")).server_deleted, 1);
      // Older snapshots cannot resurrect a deleted observation.
      f.setTransport(async () => response({ items: [remote()], next: null }));
      await sync.pull();
      assert.equal((await sync.find("obs-test")).server_deleted, 1);
    } finally { f.db.close(); }
  });
}

test("in-flight uploads lock editing and duplicate submissions; restart leaves a retryable failure", async () => {
  const f = fixture(true); let complete;
  f.setTransport(() => new Promise(resolve => { complete = resolve; }));
  const sync = f.boot();
  try {
    await sync.saveDraft(draft(), []);
    const upload = sync.upload("obs-test");
    while (!complete) await new Promise(resolve => setImmediate(resolve));
    await assert.rejects(() => sync.assertEditable("obs-test"), /전송 중/);
    assert.equal((await sync.upload("obs-test")).ok, false);
    complete(response({ item: remote(), alreadyExists: false }));
    await upload;
    f.db.prepare("UPDATE observations SET share_state='sending'").run();
    const restarted = f.boot(); await restarted.init();
    assert.equal((await restarted.find("obs-test")).share_state, "failed");
  } finally { f.db.close(); }
});

test("input validation rejects missing coordinates and out-of-range heading", () => {
  const data = { bear_code: "bear", owner: "owner", place: "place", lat: 35, lng: 127, heading: 90 };
  for (const patch of [{ lat: "" }, { lng: null }, { lat: 91 }, { heading: 360 }, { detectors: [{}, {}, {}, {}] }]) {
    assert.throws(() => normalize({ ...data, ...patch }));
  }
});

for (const native of [false, true]) {
  test(`${native ? 'SQLite' : 'web'}: shared deletion keeps data on failure, checks reviewed versions and acknowledges server tombstones`, async () => {
    const f = fixture(native);
    try {
      f.setTransport(async () => response({ items: [remote()], next: null }));
      const sync = f.boot(); await sync.pull();
      f.setTransport(async () => { throw new Error('offline'); });
      await assert.rejects(() => sync.remove('obs-test', 1), /기기에 유지/);
      assert.equal((await sync.find('obs-test')).share_state, 'shared');
      assert.equal((await sync.find('obs-test')).server_deleted, 0);
      f.setTransport(async () => ({ ok: false, status: 409, json: async () => ({ ok: false, message: '다른 수정 확인 필요', item: remote({ place: 'latest', server_version: 2 }) }) }));
      await assert.rejects(() => sync.remove('obs-test', 1), /다른 수정/);
      assert.equal((await sync.find('obs-test')).place, 'latest');
      await assert.rejects(() => sync.remove('obs-test', 1), /최신 내용/);
      f.setTransport(async (url, options) => {
        assert.match(url, /\/removal$/);
        assert.equal(JSON.parse(options.body).server_version, 2);
        return response({ item: remote({ deleted: true, server_version: 3 }) });
      });
      await sync.remove('obs-test', 2);
      assert.equal((await sync.find('obs-test')).server_deleted, 1);
      await sync.saveDraft(draft('local-only'), []);
      f.setTransport(async () => { throw new Error('must not send a local deletion'); });
      await sync.remove('local-only', 0);
      assert.equal(await sync.find('local-only'), undefined);
    } finally { f.db.close(); }
  });
  test(`${native ? 'SQLite' : 'web'}: lost update replies retain a stable mutation ID across restart and acknowledge once`, async () => {
    const f = fixture(native);
    try {
      let server = remote();
      f.setTransport(async () => response({ items: [server], next: null }));
      let sync = f.boot(); await sync.pull();
      await sync.saveDraft({ ...draft(), place: 'new-value' }, [], true);
      let firstBody;
      f.setTransport(async (_, options) => {
        firstBody = JSON.parse(options.body);
        server = remote({ place: firstBody.place, server_version: 2, sync_mutation_id: firstBody.mutation_id });
        throw new Error('reply lost');
      });
      assert.equal((await sync.upload('obs-test')).ok, false);
      sync = f.boot();
      f.setTransport(async (_, options) => {
        assert.equal(JSON.parse(options.body).mutation_id, firstBody.mutation_id);
        assert.equal(JSON.parse(options.body).server_version, 1);
        return response({ item: server, alreadyExists: true });
      });
      assert.equal((await sync.upload('obs-test')).ok, true);
      assert.equal((await sync.find('obs-test')).server_version, 2);
      assert.equal((await sync.find('obs-test')).place, 'new-value');
    } finally { f.db.close(); }
  });
  test(`${native ? 'SQLite' : 'web'}: a stale form or stale comparison cannot overwrite newer work`, async () => {
    const f = fixture(native);
    try {
      let server = remote();
      f.setTransport(async () => response({ items: [server], next: null }));
      const sync = f.boot(); await sync.pull();
      const token = sync.revision(await sync.find('obs-test'));
      server = remote({ place: 'other-user', server_version: 2 }); await sync.pull();
      await assert.rejects(() => sync.saveDraft({ ...draft(), place: 'stale', editRevision: token }, [], true), /수정 중/);
      assert.equal((await sync.find('obs-test')).place, 'other-user');
      await sync.saveDraft({ ...draft(), place: 'mine' }, [], true);
      server = remote({ place: 'new-server-value', server_version: 3 }); await sync.pull();
      const oldComparison = await sync.find('obs-test');
      await sync.saveDraft({ ...draft(), place: 'my-newer-value' }, [], true);
      await assert.rejects(() => sync.resolveConflict('obs-test', 'server', 3, oldComparison.sync_mutation_id), /비교 중/);
      assert.equal((await sync.find('obs-test')).place, 'my-newer-value');
    } finally { f.db.close(); }
  });
}

test("administrator PATCH/DELETE remain protected; app revisions use their own versioned endpoint", async () => {
  const calls = [];
  const store = { list: async () => ({ items: [], next: null }), insert: async () => ({ item: remote() }),
    update: async (...args) => { calls.push(args); return remote(); }, remove: async () => remote(),
    revise: async (id, body) => {
      if (body.server_version !== 1) throw Object.assign(new Error("conflict"), { statusCode: 409, item: remote({ server_version: 2 }) });
      return { item: remote({ server_version: 2 }) };
    } };
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { if (req.get("X-Test-Admin") === "true") req.adminSession = { adminAccount: { userId: "admin-test" } }; next(); });
  app.use("/api/observations", createObservationRouter(store));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/observations/obs-test`;
  try {
    for (const method of ["PATCH", "DELETE"]) assert.equal((await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
    assert.equal(calls.length, 0);
    assert.equal((await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Test-Admin": "true" }, body: "{}" })).status, 200);
    assert.equal(calls[0][2], "admin-test");
    assert.equal((await fetch(url, { method: "DELETE", headers: { "Content-Type": "application/json", "X-Test-Admin": "true", "Sec-Fetch-Site": "cross-site" }, body: "{}" })).status, 403);
    assert.equal((await fetch(url + "/revisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ server_version: 1 }) })).status, 200);
    const conflict = await fetch(url + "/revisions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ server_version: 0 }) });
    assert.equal(conflict.status, 409);
    assert.equal((await conflict.json()).item.server_version, 2);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
