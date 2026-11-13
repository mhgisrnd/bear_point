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
        active: row.active ?? previous?.active ?? null,
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
        source_observations: decode(row.source_observations) || previous?.source_observations || decode(payload.source_observations_json) || payload.source_observations || [],
        analysis_options: decode(row.analysis_options) || previous?.analysis_options || decode(payload.analysis_options_json) || payload.analysis_options || {},
        analysis_rays: decode(row.analysis_rays) || previous?.analysis_rays || decode(payload.analysis_rays_json) || payload.analysis_rays || [],
        analysis_intersections: decode(row.analysis_intersections) || previous?.analysis_intersections || decode(payload.intersections_json) || payload.analysis_intersections || [],
        estimation_method: row.estimation_method ?? payload.estimation_method ?? previous?.estimation_method ?? null,
        intersections_count: row.intersections_count ?? previous?.intersections_count ?? null
      });
    }
    const timestamp = value => {
      const text = String(value || "");
      return Date.parse(/Z$|[+-]\d\d:\d\d$/.test(text) ? text : text.replace(" ", "T") + "Z") || 0;
    };
    return [...result.values()].sort((a, b) => timestamp(b.created_at)-timestamp(a.created_at) || String(b.id).localeCompare(String(a.id)));
  }
  function createStore(window) {
    const native = () => !!window.Capacitor?.isNativePlatform();
    const dbName = () => window.BearSQLiteConfig?.dbName || "BearPointData";
    const plugin = () => window.Capacitor.Plugins.CapacitorSQLite;
    let rows = [], loaded, queue = Promise.resolve(), completeSnapshot = false;
    let diskIds = new Set();
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
        diskIds=new Set(rows.map(row=>String(row.id)));
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
        const offline=values.filter(row=>!root.BearStorageCleanup?.older(row.uploaded_at));
        if (native() && offline.length) {
          await plugin().executeSet({ database: dbName(), readonly: false, transaction: true,
            set: offline.map(row => ({ statement: "INSERT OR REPLACE INTO bear_estimate_remote_cache (server_id,payload_json) VALUES (?,?)", values: [String(row.id), JSON.stringify(row)] })) });
        } else if (!native()) window.localStorage.setItem(storageKey, JSON.stringify(offline));
        if(native())offline.forEach(row=>diskIds.add(String(row.id)));else diskIds=new Set(offline.map(row=>String(row.id)));
        rows = values;
        if (options.complete) completeSnapshot = true;
        return rows;
      });
      queue = task.catch(() => {}); return task;
    }
    function cleanup(cutoff,localStore,verified=rows) {
      const task=queue.then(async()=>{
        await load();
        const old=row=>root.BearStorageCleanup?.older(row.uploaded_at,cutoff);
        const removed=await localStore.removeSharedCopies(verified,cutoff);
        const discarded=rows.filter(row=>old(row)&&diskIds.has(String(row.id)));
        const ids=new Set(discarded.map(row=>String(row.id)));
        if(native()&&ids.size)await plugin().executeSet({database:dbName(),readonly:false,transaction:true,
          set:[...ids].map(id=>({statement:'DELETE FROM bear_estimate_remote_cache WHERE server_id=?',values:[id]}))});
        const next=rows.filter(row=>!ids.has(String(row.id)));
        if(!native()&&ids.size)window.localStorage.setItem(storageKey,JSON.stringify(next));
        ids.forEach(id=>diskIds.delete(id));
        // Keep live server rows in RAM for this session; reopening requires a server query.
        return {estimates:removed,cache:ids.size};
      });
      queue=task.catch(()=>{});return task;
    }
    return { load, accept, cleanup, merge: local => {
      // A complete server snapshot governs shared records, including old local
      // receipts which predate the remote cache. Keep original local data intact.
      const active = new Set(rows.filter(row => !row.deleted && !row._cacheDeleted).map(originId).filter(Boolean));
      const visible = completeSnapshot ? (local || []).filter(row => !row.shared_at || active.has(String(row.id))) : local;
      return merge(visible, rows);
    }, raw: () => rows.slice() };
  }
  function createLocalStore(window) {
    const key = "bearpoint.local-estimates.v1";
    const native = () => !!window.Capacitor?.isNativePlatform();
    const database = () => window.BearSQLiteConfig?.dbName || "BearPointData";
    const sqlite = () => window.Capacitor.Plugins.CapacitorSQLite;
    const columns = ["id","bear_code","owner","team_id","team_name","team_color","place","admin_region","lat","lng","lat_dms","lng_dms","intersections_count","estimation_method","source_observation_ids","source_observations_json","analysis_rays_json","intersections_json","analysis_options_json","analysis_diagnostics_json","created_at","shared_at","share_pending"];
    let queue = Promise.resolve();
    function serialize(action) { const result = queue.then(action); queue = result.catch(() => {}); return result; }
    function readWeb() {
      const rows = JSON.parse(window.localStorage.getItem(key) || "[]");
      if (!Array.isArray(rows)) throw new Error("저장된 개체 위치 자료 형식이 올바르지 않습니다.");
      let changed = false;
      for (const row of rows) {
        if (row.estimation_method != null) continue;
        const method = decode(row.analysis_options_json)?.estimationMethod;
        const sources = decode(row.source_observations_json);
        row.estimation_method = ["single", "intersection"].includes(method) ? method
          : Array.isArray(sources) && sources.length === 1 ? "single"
          : Number(row.intersections_count) > 0 || Array.isArray(sources) && sources.length > 1 ? "intersection" : null;
        if (row.estimation_method) changed = true;
      }
      if (changed) window.localStorage.setItem(key, JSON.stringify(rows));
      return rows;
    }
    async function ready() { if (native() && !(await window.BearSQLite.initialize()).ready) throw new Error("SQLite 연결이 준비되지 않았습니다."); }
    async function list() {
      await queue; await ready();
      return native() ? (await sqlite().query({database:database(),readonly:false,statement:"SELECT * FROM bear_estimates ORDER BY created_at DESC",values:[]})).values || [] : readWeb();
    }
    function insert(input) {
      const row = Object.fromEntries(columns.map(column => [column, input[column] ?? null]));
      row.estimation_method = input.estimation_method || decode(input.analysis_options_json)?.estimationMethod || null;
      if (row.estimation_method !== null && !["single", "intersection"].includes(row.estimation_method)) throw new Error("Invalid estimation_method");
      row.share_pending = input.share_pending ? 1 : 0;
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
        if (native()) for (const id of ids) await sqlite().run({database:database(),readonly:false,transaction:true,statement:"UPDATE bear_estimates SET shared_at=COALESCE(shared_at,?),share_pending=0 WHERE id=?",values:[timestamp,id]});
        else window.localStorage.setItem(key,JSON.stringify(readWeb().map(row=>ids.includes(String(row.id))?{...row,shared_at:row.shared_at||timestamp,share_pending:0}:row)));
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
    function removeSharedCopies(remote,cutoff) {
      return serialize(async()=>{
        await ready();
        const proofs=new Map(remote.slice().sort((a,b)=>Number(!a.deleted&&!a._cacheDeleted)-Number(!b.deleted&&!b._cacheDeleted)
          ||String(a.updated_at||a.uploaded_at||'').localeCompare(String(b.updated_at||b.uploaded_at||''))).map(row=>[originId(row),row]));
        const local=native()?(await sqlite().query({database:database(),readonly:false,statement:'SELECT * FROM bear_estimates',values:[]})).values||[]:readWeb();
        const ids=local.filter(row=>{
          if(!row.shared_at||Number(row.share_pending))return false;
          const proof=proofs.get(String(row.id));if(!proof)return false;
          if(!root.BearStorageCleanup?.older(row.shared_at,cutoff)||!root.BearStorageCleanup?.older(proof.uploaded_at,cutoff))return false;
          if(proof.deleted)return true;
          // Missing from the active list may mean historical/inactive, never proof of deletion.
          if(proof._cacheDeleted)return false;
          const payload=decode(proof.payload);
          // Keep the original unless the cached server payload contains its complete analysis.
          if(!payload||String(payload.id)!==String(row.id))return false;
          const cached=merge([], [proof])[0];
          if(!cached)return false;
          for(const [field,json]of [['source_observations','source_observations_json'],['analysis_options','analysis_options_json'],['analysis_rays','analysis_rays_json'],['analysis_intersections','intersections_json']]) {
            if(row[json]!=null&&JSON.stringify(decode(row[json]))!==JSON.stringify(cached[field]))return false;
          }
          return columns.filter(key=>!['shared_at','share_pending'].includes(key)).every(key=>{
            const a=row[key]??null,b=payload[key]??null;
            return JSON.stringify(a)===JSON.stringify(b);
          });
        }).map(row=>String(row.id));
        if(native()&&ids.length)await sqlite().executeSet({database:database(),readonly:false,transaction:true,
          set:ids.map(id=>({statement:'DELETE FROM bear_estimates WHERE id=? AND shared_at IS NOT NULL AND COALESCE(share_pending,0)=0',values:[id]}))});
        else if(!native()&&ids.length)window.localStorage.setItem(key,JSON.stringify(local.filter(row=>!ids.includes(String(row.id)))));
        return ids.length;
      });
    }
    return {list,insert,markShared,removeUnshared,removeSharedCopies};
  }
  const api = { merge, originId, createStore, createLocalStore };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BearEstimateStore = api;
})(typeof window !== "undefined" ? window : globalThis);
