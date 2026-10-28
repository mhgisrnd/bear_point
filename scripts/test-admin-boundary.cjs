const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const express = require("express");
const Database = require("better-sqlite3");
const { contains } = require("../public/js/db/boundary-geometry");
const { createAdminBoundaryRouter } = require("../src/routes/adminBoundaryRoutes");
const root = path.resolve(__dirname, "..");

function polygon(rings) {
  const count = rings.reduce((sum, ring) => sum + ring.length, 0);
  const b = Buffer.alloc(44 + rings.length * 4 + count * 16);
  b.writeInt32LE(5, 0); b.writeInt32LE(rings.length, 36); b.writeInt32LE(count, 40);
  let vertex = 0;
  rings.forEach((ring, i) => {
    b.writeInt32LE(vertex, 44 + i * 4);
    ring.forEach(([x, y]) => {
      b.writeDoubleLE(x, 44 + rings.length * 4 + vertex * 16);
      b.writeDoubleLE(y, 52 + rings.length * 4 + vertex++ * 16);
    });
  });
  return b;
}

test("containment handles holes, islands, edges and outside points", () => {
  const b = polygon([[[0,0],[10,0],[10,10],[0,10],[0,0]],
    [[3,3],[7,3],[7,7],[3,7],[3,3]], [[20,20],[21,20],[21,21],[20,21],[20,20]]]);
  assert.equal(contains(b, 1, 1), true);
  assert.equal(contains(b, 5, 5), false);
  assert.equal(contains(b, 20.5, 20.5), true);
  assert.equal(contains(b, 0, 4), true);
  assert.equal(contains(b, 15, 15), false);
});

test("migration 12 preserves existing observations and adds a nullable location", () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(root, "public/js/db/sqlite-migrations.js"), "utf8"), { window });
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE observations(id TEXT PRIMARY KEY, place TEXT); INSERT INTO observations VALUES ('existing','original');");
    window.BearSQLiteConfig.migrations[12].forEach(sql => db.exec(sql));
    assert.deepEqual(db.prepare("SELECT * FROM observations").get(), { id: "existing", place: "original", admin_region: null });
    db.prepare("UPDATE observations SET admin_region=? WHERE id=?").run("전라남도 구례군 구례읍", "existing");
    assert.equal(db.prepare("SELECT admin_region FROM observations").get().admin_region, "전라남도 구례군 구례읍");
    db.exec("CREATE TABLE bear_estimates(id TEXT PRIMARY KEY); INSERT INTO bear_estimates VALUES ('saved-estimate');");
    window.BearSQLiteConfig.migrations[13].forEach(sql => db.exec(sql));
    assert.deepEqual(db.prepare("SELECT * FROM bear_estimates").get(), { id: "saved-estimate", admin_region: null });
  } finally { db.close(); }
});

test("late automatic responses never overwrite manual text and a new coordinate resets the override", async () => {
  let onInput;
  let complete;
  const input = { value: "", addEventListener: (event, handler) => { onInput = handler; } };
  const window = { BearAdminBoundary: { lookup: () => new Promise(resolve => { complete = resolve; }) } };
  vm.runInNewContext(fs.readFileSync(path.join(root, "public/js/db/editable-region-field.js"), "utf8"), { window, setTimeout, clearTimeout });
  const field = window.createEditableRegionField(input);
  field.update(35, 127);
  await new Promise(resolve => setTimeout(resolve, 280));
  input.value = "현장 수정 위치"; onInput();
  complete({ name: "자동 조회 위치" });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(input.value, "현장 수정 위치");
  assert.equal(await field.resolve(35, 127), "현장 수정 위치");
  field.update(35.1, 127);
  assert.equal(input.value, "");
  field.reset();
});

test("tracking result auto-fills an editable location and stores/shares the corrected value", async () => {
  function element(tag) {
    return { tag, style: {}, children: [], value: "", listeners: {},
      appendChild(child) { this.children.push(child); },
      addEventListener(event, handler) { this.listeners[event] = handler; },
      querySelector() { return null; } };
  }
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE bear_estimates(id TEXT PRIMARY KEY, bear_code TEXT, owner TEXT, place TEXT,
    admin_region TEXT, lat REAL, lng REAL, lat_dms TEXT, lng_dms TEXT, intersections_count INTEGER,
    source_observation_ids TEXT, source_observations_json TEXT, analysis_rays_json TEXT,
    intersections_json TEXT, analysis_options_json TEXT, analysis_diagnostics_json TEXT, created_at TEXT)`);
  const shared = [];
  const window = { BearAdminBoundary: { lookup: async () => ({ name: "전라남도 구례군 구례읍" }) } };
  const context = vm.createContext({ window, setTimeout, clearTimeout, console,
    document: { createElement: element, createTextNode: text => ({ text }) },
    ol: { Overlay: function (options) { this.element = options.element; } },
    map: { addOverlay() {}, getTargetElement: () => null },
    bindAnalysisActionBarLayoutListeners() {},
    analysisActionBarEl: null, analysisActionOverlay: null, analysisOwnerInputEl: null,
    analysisPlaceInputEl: null, analysisRegionField: null, analysisRealtimeShareInputEl: null,
    currentAnalysisPoint: { lat: 35.202, lng: 127.462, bearCode: "bear-1" },
    normalizeOwnerName: value => String(value || "").trim(),
    normalizePlaceName: value => String(value || "").trim(),
    initializeEmbeddedDatabase: async () => ({ ready: true }),
    getCapacitorSQLitePlugin: () => ({ run: async options => db.prepare(options.statement).run(...options.values) }),
    decimalToDMS: value => String(value), getKstSqliteTimestamp: () => "2026-10-28 10:00:00",
    normalizeAnalysisOptions: value => value || {},
    clearAnalysisEstimateVisuals() {}, refreshBearEstimatePanel: async () => {},
    statusEl: { textContent: "" },
    realtimeListModule: { sendEstimate: async item => { shared.push(item); return { ok: true }; }, openRealtimeTab() {} },
    markBearEstimatesShared: async () => {}
  });
  vm.runInContext(fs.readFileSync(path.join(root, "public/js/db/editable-region-field.js"), "utf8"), context);
  const source = fs.readFileSync(path.join(root, "public/js/client-ol.js"), "utf8");
  const start = source.indexOf("  function mountAnalysisActionBar() {");
  const end = source.indexOf("  // 방금 계산한 분석 결과", start);
  vm.runInContext(source.slice(start, end) + "\nmountAnalysisActionBar();", context);
  try {
    context.analysisRegionField.update(35.202, 127.462);
    await new Promise(resolve => setTimeout(resolve, 280));
    const grid = context.analysisActionBarEl.children[0].children[1].children[0];
    const input = grid.children[2].children[1];
    assert.equal(input.value, "전라남도 구례군 구례읍");
    input.value = "전라남도 구례군 현장 확인 지점";
    input.listeners.input();
    const save = context.analysisActionBarEl.children[1].children[0];
    await save.listeners.click();
    const row = db.prepare("SELECT * FROM bear_estimates").get();
    assert.ok(row, context.statusEl.textContent);
    assert.equal(row.admin_region, input.value);
    assert.equal(row.lat, 35.202);
    assert.equal(shared[0].admin_region, input.value);
  } finally { context.analysisRegionField.reset(); db.close(); }
});

test("web lookup returns real regions, no match and input errors", async () => {
  const app = express(); app.use(createAdminBoundaryRouter(root));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/admin-boundary`;
  try {
    for (const [lat, lng, name] of [[37.5665,126.978,"서울특별시 중구 명동"], [35.202,127.462,"전라남도 구례군 구례읍"],
      [35.1796,129.0756,"부산광역시 연제구 연산5동"], [33.4996,126.5312,"제주특별자치도 제주시 이도2동"]]) {
      const response = await fetch(`${base}?lat=${lat}&lng=${lng}`);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).region.name, name);
    }
    assert.equal((await (await fetch(`${base}?lat=0&lng=0`)).json()).region, null);
    for (const query of ["", "?lat=&lng=127", "?lat=91&lng=127", "?lat=abc&lng=127"]) {
      assert.equal((await fetch(base + query)).status, 400);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("offline native path opens bundled DB read-only and decodes compressed geometry", async () => {
  const db = new Database(path.join(root, "public/assets/databases/AdminBoundary.db"), { readonly: true });
  let opened = 0;
  const plugin = {
    isDBExists: async () => ({ result: true }),
    createConnection: async options => { assert.equal(options.readonly, true); },
    open: async options => { assert.equal(options.readonly, true); opened++; },
    query: async options => {
      assert.equal(options.readonly, true);
      return { values: db.prepare(options.statement).all(...options.values) };
    }
  };
  const window = { Capacitor: { isNativePlatform: () => true, Plugins: { CapacitorSQLite: plugin } },
    BearSQLite: { initialize: async () => ({ ready: true }) }, BearBoundaryGeometry: { contains } };
  vm.runInNewContext(fs.readFileSync(path.join(root, "public/js/db/admin-boundary.js"), "utf8"),
    { window, Blob, Response, DecompressionStream, Uint8Array, Map, Number, Promise });
  try {
    assert.equal((await window.BearAdminBoundary.lookup(35.202, 127.462)).name, "전라남도 구례군 구례읍");
    assert.equal((await window.BearAdminBoundary.lookup(33.4996, 126.5312)).name, "제주특별자치도 제주시 이도2동");
    assert.equal(await window.BearAdminBoundary.lookup(0, 0), null);
    assert.equal(opened, 1);
  } finally { db.close(); }
});

test("registration and editing refresh location from GPS/map/manual input and persist it", async () => {
  function element() {
    const classes = new Set();
    const listeners = {};
    return { value: "", placeholder: "", style: {}, listeners,
      classList: { add: x => classes.add(x), remove: x => classes.delete(x),
        contains: x => classes.has(x), toggle: (x, on) => on ? classes.add(x) : classes.delete(x) },
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener: (event, fn) => { listeners[event] = fn; },
      setAttribute() {}, removeAttribute() {},
      getBoundingClientRect: () => ({ left: 10, top: 10, width: 400, height: 600 }) };
  }
  const elements = Object.fromEntries(["register-box", "reg-place", "reg-owner", "reg-coord", "reg-heading",
    "reg-bear", "reg-admin-region", "btn-reg-submit"].map(id => [id, element()]));
  const db = new Database(":memory:");
  db.exec("CREATE TABLE observations(id TEXT PRIMARY KEY, bear_code TEXT, owner TEXT, lat REAL, lng REAL, heading REAL, place TEXT, detectors_json TEXT, admin_region TEXT, updated_at TEXT)");
  const saved = [];
  const queries = [];
  const window = { innerHeight: 1000, innerWidth: 1200, addEventListener() {}, confirm: () => true,
    BearSQLite: { initialize: async () => ({ ready: true }) },
    Capacitor: { isNativePlatform: () => true, Plugins: { CapacitorSQLite: {
      query: async () => ({ values: [] }),
      run: async options => db.prepare(options.statement).run(...options.values)
    } } },
    BearAdminBoundary: { lookup: async (lat, lng) => {
      queries.push([lat, lng]);
      return { name: lat < 36 ? "전라남도 구례군 구례읍" : "서울특별시 중구 명동" };
    } }
  };
  const statusEl = { textContent: "" };
  vm.runInNewContext(fs.readFileSync(path.join(root, "public/js/db/editable-region-field.js"), "utf8"), {
    window, setTimeout, clearTimeout
  });
  vm.runInNewContext(fs.readFileSync(path.join(root, "public/js/obs/obsRegister.js"), "utf8"), {
    window, document: { getElementById: id => elements[id] || null, querySelectorAll: () => [], addEventListener() {} },
    setTimeout, clearTimeout, Intl, console
  });
  const form = window.createObsRegisterModule({ statusEl, onObservationSaved: async data => saved.push(data) });
  const settle = () => new Promise(resolve => setTimeout(resolve, 300));
  try {
    form.initialize(); form.open();
    elements["reg-owner"].value = "tester";
    elements["reg-place"].value = "point";
    elements["reg-bear"].value = "bear";
    form.updateLiveData({ lat: 37.5665, lng: 126.978, heading: 0, isGpsActive: true });
    await settle();
    assert.equal(elements["reg-admin-region"].value, "서울특별시 중구 명동");
    elements["reg-admin-region"].value = "직접 수정한 관측 위치";
    elements["reg-admin-region"].listeners.input();
    form.updateLiveData({ lat: 37.56651, lng: 126.97801, heading: 0, isGpsActive: true });
    assert.equal(elements["reg-admin-region"].value, "직접 수정한 관측 위치");
    elements["btn-reg-submit"].listeners.click();
    await settle();
    assert.equal(saved.length, 1, statusEl.textContent);
    const row = db.prepare("SELECT * FROM observations").get();
    assert.equal(row.admin_region, "직접 수정한 관측 위치");

    form.openForEdit({ ...row, bearCode: row.bear_code });
    form.applyMapClickCoordinate(35.202, 127.462);
    await settle();
    assert.equal(elements["reg-admin-region"].value, "전라남도 구례군 구례읍");
    elements["btn-reg-submit"].listeners.click();
    await settle();
    assert.equal(saved.length, 2, statusEl.textContent);
    assert.equal(db.prepare("SELECT admin_region FROM observations").get().admin_region, "전라남도 구례군 구례읍");

    form.openForEdit({ ...row, bearCode: row.bear_code });
    elements["reg-coord"].value = "35.202, 127.462";
    elements["reg-coord"].listeners.input();
    await settle();
    assert.equal(elements["reg-admin-region"].value, "전라남도 구례군 구례읍");
    elements["reg-coord"].value = "invalid";
    elements["reg-coord"].listeners.input();
    assert.equal(elements["reg-admin-region"].value, "");
    elements["btn-reg-submit"].listeners.click();
    await settle();
    assert.equal(saved.length, 2);
    assert.ok(queries.length >= 4);
  } finally { form.hide(false); db.close(); }
});
