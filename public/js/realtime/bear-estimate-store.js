(function (root) {
  "use strict";
  const originId = row => String(row.bear_estimate_id || decode(row.payload)?.id || "");
  const decode = value => {
    if (typeof value !== "string") return value;
    try { return JSON.parse(value); } catch (_) { return null; }
  };
  function merge(local, remote) {
    const result = new Map((local || []).map(row => ["origin:" + row.id, { ...row, local_id: row.id }]));
    // Prefer the newest server receipt when older uploads produced duplicates.
    const sorted = (remote || []).slice().sort((a, b) =>
      Number(!a._cacheDeleted) - Number(!b._cacheDeleted) || String(a.updated_at || a.uploaded_at || "").localeCompare(String(b.updated_at || b.uploaded_at || "")) || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
    for (const row of sorted) {
      const origin = originId(row);
      const key = origin ? "origin:" + origin : "remote:" + row.id;
      if (row.deleted || row._cacheDeleted) { result.delete(key); continue; }
      const previous = result.get(key);
      const payload = decode(row.payload) || {};
      const remoteOnly = !previous?.local_id;
      result.set(key, {
        ...payload, ...previous,
        id: origin || "remote:" + row.id, local_id: previous?.local_id || null,
        server_id: String(row.id), bear_estimate_id: origin || null,
        bear_code: row.bear_code || payload.bear_code || "-",
        place: row.place || "미지정", owner: row.owner || "미지정",
        admin_region: row.admin_region ?? payload.admin_region ?? previous?.admin_region ?? null,
        lat: Number(row.lat), lng: Number(row.lng), lat_dms: row.lat_dms || null, lng_dms: row.lng_dms || null,
        created_at: row.source_created_at || payload.created_at || previous?.created_at || row.uploaded_at,
        shared_at: row.uploaded_at || previous?.shared_at || "shared",
        remoteOnly, isRealtime: remoteOnly,
        source_observations: decode(row.source_observations) || previous?.source_observations || payload.source_observations || [],
        analysis_options: decode(row.analysis_options) || previous?.analysis_options || payload.analysis_options || {},
        analysis_rays: decode(row.analysis_rays) || previous?.analysis_rays || payload.analysis_rays || [],
        analysis_intersections: decode(row.analysis_intersections) || previous?.analysis_intersections || payload.analysis_intersections || [],
        intersections_count: row.intersections_count ?? previous?.intersections_count ?? null
      });
    }
    return [...result.values()].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")) || String(a.id).localeCompare(String(b.id)));
  }
  function createStore(window) {
    const native = () => !!window.Capacitor?.isNativePlatform();
    const dbName = () => window.BearSQLiteConfig?.dbName || "BearPointData";
    const plugin = () => window.Capacitor.Plugins.CapacitorSQLite;
    let rows = [], loaded, queue = Promise.resolve();
    const storageKey = "bearpoint.remote-estimates.v1";
    async function load() {
      if (!loaded) loaded = (async () => {
        if (native()) {
          const state = await window.BearSQLite.initialize();
          if (!state.ready) throw new Error("SQLite 연결 대기 중입니다.");
          const result = await plugin().query({ database: dbName(), readonly: false,
            statement: "SELECT payload_json FROM bear_estimate_remote_cache", values: [] });
          rows = (result.values || []).map(row => decode(row.payload_json)).filter(Boolean);
        } else rows = decode(window.localStorage.getItem(storageKey) || "[]") || [];
        if (!Array.isArray(rows)) rows = [];
        return rows;
      })().catch(error => { loaded = null; throw error; });
      await loaded; return rows;
    }
    function accept(incoming, options = {}) {
      const task = queue.then(async () => {
        await load();
        const next = new Map(rows.map(row => [String(row.id), row]));
        const ids = new Set(incoming.map(row => String(row.id)));
        if (options.complete) for (const [id, row] of next) {
          if (!ids.has(id) && (!options.requestedAt || (row._receivedAt || 0) <= options.requestedAt)) next.set(id, { ...row, _cacheDeleted: true });
        }
        for (const row of incoming) next.set(String(row.id), { ...row, _cacheDeleted: false, _receivedAt: Date.now() });
        const values = [...next.values()];
        if (native() && values.length) {
          await plugin().executeSet({ database: dbName(), readonly: false, transaction: true,
            set: values.map(row => ({ statement: "INSERT OR REPLACE INTO bear_estimate_remote_cache (server_id,payload_json) VALUES (?,?)", values: [String(row.id), JSON.stringify(row)] })) });
        } else if (!native()) window.localStorage.setItem(storageKey, JSON.stringify(values));
        rows = values; return rows;
      });
      queue = task.catch(() => {}); return task;
    }
    return { load, accept, merge: local => merge(local, rows), raw: () => rows.slice() };
  }
  const api = { merge, originId, createStore };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BearEstimateStore = api;
})(typeof window !== "undefined" ? window : globalThis);
