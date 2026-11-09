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
        team_id: row.team_id ?? payload.team_id ?? previous?.team_id ?? null,
        team_name: row.team_name ?? payload.team_name ?? previous?.team_name ?? null,
        team_color: row.team_color ?? payload.team_color ?? previous?.team_color ?? null,
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
  function createLocalStore(window) {
    const key = "bearpoint.local-estimates.v1";
    const native = () => !!window.Capacitor?.isNativePlatform();
    const database = () => window.BearSQLiteConfig?.dbName || "BearPointData";
    const sqlite = () => window.Capacitor.Plugins.CapacitorSQLite;
    const columns = ["id","bear_code","owner","team_id","team_name","team_color","place","admin_region","lat","lng","lat_dms","lng_dms","intersections_count","source_observation_ids","source_observations_json","analysis_rays_json","intersections_json","analysis_options_json","analysis_diagnostics_json","created_at","shared_at"];
    let queue = Promise.resolve();
    function serialize(action) { const result = queue.then(action); queue = result.catch(() => {}); return result; }
    function readWeb() {
      const rows = JSON.parse(window.localStorage.getItem(key) || "[]");
      if (!Array.isArray(rows)) throw new Error("저장된 개체 위치 자료 형식이 올바르지 않습니다.");
      return rows;
    }
    async function ready() { if (native() && !(await window.BearSQLite.initialize()).ready) throw new Error("SQLite 연결이 준비되지 않았습니다."); }
    async function list() {
      await queue; await ready();
      return native() ? (await sqlite().query({database:database(),readonly:false,statement:"SELECT * FROM bear_estimates ORDER BY created_at DESC",values:[]})).values || [] : readWeb();
    }
    function insert(input) {
      const row = Object.fromEntries(columns.map(column => [column, input[column] ?? null]));
      return serialize(async () => {
        await ready();
        if (!row.id || !Number.isFinite(row.lat) || !Number.isFinite(row.lng)) throw new Error("개체 위치 정보를 확인해주세요.");
        if (native()) await sqlite().run({database:database(),readonly:false,transaction:true,
          statement:`INSERT INTO bear_estimates (${columns.join(",")}) VALUES (${columns.map(()=>"?").join(",")})`,values:columns.map(column=>row[column])});
        else {
          const rows=readWeb();if(rows.some(item=>item.id===row.id))throw new Error("이미 저장된 개체 위치입니다.");
          window.localStorage.setItem(key,JSON.stringify([row,...rows]));
        }
        return {...row};
      });
    }
    function markShared(ids, timestamp) {
      return serialize(async () => {
        await ready();
        if (native()) for (const id of ids) await sqlite().run({database:database(),readonly:false,transaction:true,statement:"UPDATE bear_estimates SET shared_at=COALESCE(shared_at,?) WHERE id=?",values:[timestamp,id]});
        else window.localStorage.setItem(key,JSON.stringify(readWeb().map(row=>ids.includes(String(row.id))?{...row,shared_at:row.shared_at||timestamp}:row)));
      });
    }
    function removeUnshared(ids) {
      const targets = new Set(ids.map(String));
      if (!targets.size) return Promise.resolve(0);
      return serialize(async () => {
        await ready();
        if (native()) {
          const result = await sqlite().executeSet({
            database: database(), readonly: false, transaction: true,
            set: [...targets].map(id => ({
              statement: "DELETE FROM bear_estimates WHERE id = ? AND shared_at IS NULL",
              values: [id]
            }))
          });
          return result.changes?.changes || 0;
        }
        const rows = readWeb();
        const remaining = rows.filter(row => row.shared_at != null || !targets.has(String(row.id)));
        if (remaining.length !== rows.length) window.localStorage.setItem(key, JSON.stringify(remaining));
        return rows.length - remaining.length;
      });
    }
    return {list,insert,markShared,removeUnshared};
  }
  const api = { merge, originId, createStore, createLocalStore };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BearEstimateStore = api;
})(typeof window !== "undefined" ? window : globalThis);
