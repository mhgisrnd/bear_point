(function () {
  "use strict";
  const database = "AdminBoundary";
  let opening = null;
  // Serialize bridge queries so rapid GPS updates do not inflate the same
  // polygon concurrently. A bounded cache retains only nearby geometries.
  let queue = Promise.resolve();
  const cache = new Map();
  const native = () => !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());

  async function open() {
    if (!opening) opening = (async () => {
      const plugin = window.Capacitor.Plugins.CapacitorSQLite;
      if (!plugin) throw new Error("행정구역 DB 연결을 사용할 수 없습니다.");
      // Reuse the app's existing one-time asset copy before opening this DB.
      const state = await window.BearSQLite.initialize();
      if (!state.ready) throw new Error("SQLite 초기화에 실패했습니다.");
      try {
        const exists = await plugin.isDBExists({ database, readonly: true });
        if (!exists.result) throw new Error("행정구역 DB가 설치되지 않았습니다.");
      } catch (error) {
        if (!/No available connection for database/i.test(String(error.message || error))) throw error;
      }
      try {
        await plugin.createConnection({ database, version: 1, encrypted: false, mode: "no-encryption", readonly: true });
      } catch (error) {
        if (!/already|exist/i.test(String(error.message || error))) throw error;
      }
      try {
        await plugin.open({ database, readonly: true });
      } catch (error) {
        if (!/already open|already opened/i.test(String(error.message || error))) throw error;
      }
      const meta = await plugin.query({ database, readonly: true,
        statement: "SELECT value FROM metadata WHERE key = 'crs'", values: [] });
      if (!meta.values || !meta.values[0] || meta.values[0].value !== "EPSG:4326") {
        throw new Error("행정구역 DB 좌표계가 WGS84가 아닙니다.");
      }
      return plugin;
    })().catch(error => { opening = null; throw error; });
    return opening;
  }

  async function nativeLookup(lat, lng) {
    const plugin = await open();
    const candidates = await plugin.query({ database, readonly: true, values: [lng, lng, lat, lat],
      statement: "SELECT b.id, b.emd_code, b.display_name FROM admin_boundaries b JOIN boundary_rtree r ON b.id=r.id WHERE r.min_x<=? AND r.max_x>=? AND r.min_y<=? AND r.max_y>=? ORDER BY b.emd_code" });
    for (const row of candidates.values || []) {
      let bytes = cache.get(row.id);
      if (!bytes) {
        if (typeof DecompressionStream !== "function") throw new Error("행정구역 조회를 위해 Android System WebView를 업데이트해주세요.");
        const result = await plugin.query({ database, readonly: true, values: [row.id],
          statement: "SELECT hex(geometry) AS packed FROM admin_boundaries WHERE id=?" });
        const hex = result.values[0].packed;
        const packed = new Uint8Array(hex.length / 2);
        for (let i = 0; i < packed.length; i++) packed[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
        const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream("deflate"));
        bytes = new Uint8Array(await new Response(stream).arrayBuffer());
        cache.set(row.id, bytes);
        if (cache.size > 8) cache.delete(cache.keys().next().value);
      }
      if (window.BearBoundaryGeometry.contains(bytes, lng, lat)) {
        return { name: row.display_name, code: row.emd_code };
      }
    }
    return null;
  }

  function lookup(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return Promise.reject(new Error("좌표를 확인해주세요."));
    }
    if (!native()) {
      return fetch("api/admin-boundary?lat=" + lat + "&lng=" + lng).then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "행정구역 조회에 실패했습니다.");
        return body.region;
      });
    }
    const task = queue.then(() => nativeLookup(lat, lng));
    queue = task.catch(() => {});
    return task;
  }
  window.BearAdminBoundary = { lookup };
})();
