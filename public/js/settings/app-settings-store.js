(function (root) {
  "use strict";
  const DEFAULT_TEAMS = [
    { id: "gurye", name: "구례팀", color: "#16A34A" },
    { id: "namwon", name: "남원팀", color: "#2563EB" },
    { id: "sancheong", name: "산청팀", color: "#EA580C" },
    { id: "regional", name: "광역팀", color: "#9333EA" }
  ];
  const clone = value => JSON.parse(JSON.stringify(value));
  const DEFAULT_TRACKING = { interval_seconds: 10 };
  function normalizeTracking(value) {
    if (!value || ![5, 10, 30, 60].includes(Number(value.interval_seconds))) throw new Error("이동 기록 설정을 확인해주세요.");
    return { interval_seconds: Number(value.interval_seconds) };
  }
  const decode = value => { try { return JSON.parse(value); } catch (_) { return null; } };
  function normalizeTeams(items) {
    if (!Array.isArray(items) || items.length > 1000) throw new Error("팀 목록 형식을 확인해주세요.");
    const ids = new Set();
    return items.map(item => {
      if (!item || typeof item.id !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(item.id) || ids.has(item.id)
        || typeof item.name !== "string" || !item.name.trim() || item.name.trim().length > 30
        || typeof item.color !== "string" || !/^#[0-9A-Fa-f]{6}$/.test(item.color)) throw new Error("팀 목록 형식을 확인해주세요.");
      ids.add(item.id);
      return { id: item.id, name: item.name.trim(), color: item.color.toUpperCase(), server_version: item.server_version || 1 };
    });
  }
  function validProfile(value) {
    return !!value && typeof value.owner === "string" && value.owner.trim().length > 0 && value.owner.length <= 100
      && typeof value.team_id === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value.team_id)
      && typeof value.team_name === "string" && !!value.team_name && /^#[0-9A-Fa-f]{6}$/.test(value.team_color || "");
  }
  function createStore(win) {
    const native = () => !!win.Capacitor?.isNativePlatform?.();
    const plugin = () => win.Capacitor.Plugins.CapacitorSQLite;
    const database = () => win.BearSQLiteConfig?.dbName || "BearPointData";
    let profile = null, catalog = { items: clone(DEFAULT_TEAMS), source: "builtin", updated_at: null };
    let tracking = clone(DEFAULT_TRACKING);
    let loading, refreshing, writes = Promise.resolve();
    async function read(key) {
      if (!native()) return decode(win.localStorage.getItem("bearpoint.settings." + key));
      const result = await plugin().query({ database: database(), readonly: false, statement: "SELECT value_json FROM app_settings WHERE setting_key=?", values: [key] });
      return decode(result.values?.[0]?.value_json);
    }
    async function write(key, value) {
      if (native()) await plugin().run({ database: database(), readonly: false, transaction: true,
        statement: "INSERT OR REPLACE INTO app_settings (setting_key,value_json) VALUES (?,?)", values: [key, JSON.stringify(value)] });
      else win.localStorage.setItem("bearpoint.settings." + key, JSON.stringify(value));
    }
    function enqueue(fn) {
      const task = writes.then(fn); writes = task.catch(() => {}); return task;
    }
    function load() {
      if (!loading) loading = (async () => {
        if (native()) {
          const state = await win.BearSQLite.initialize();
          if (!state.ready) throw new Error("설정 저장소를 열지 못했습니다. 다시 시도해주세요.");
        }
        const saved = await read("profile.v1"), teams = await read("teams.v1");
        profile = validProfile(saved) ? saved : null;
        const savedTracking = await read("tracking.v1");
        try { if (savedTracking) tracking = normalizeTracking(savedTracking); } catch (_) { /* use valid defaults */ }
        if (teams && Array.isArray(teams.items)) {
          try { catalog = { items: normalizeTeams(teams.items), source: "cache", updated_at: teams.updated_at || null }; } catch (_) { /* keep bundled defaults for invalid cache */ }
        }
        return snapshot();
      })().catch(error => { loading = null; throw error; });
      return loading.then(() => snapshot());
    }
    function snapshot() { return clone({ profile, ...catalog, tracking }); }
    function saveTracking(value) {
      return enqueue(async () => {
        await load(); const next = normalizeTracking(value);
        await write("tracking.v1", next); tracking = next; return clone(next);
      });
    }
    function url() {
      if (!native()) return "api/app-realtime/teams";
      const config = win.BEAR_RUNTIME_CONFIG || {};
      if (config.teamsApiUrl) return config.teamsApiUrl;
      return new URL("../teams", String(config.realtimeApiBase || win.BEAR_API_BASE).replace(/\/$/, "") + "/").href;
    }
    function refresh() {
      if (!refreshing) refreshing = (async () => {
        await load();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await win.fetch(url(), { signal: controller.signal, credentials: "omit", cache: "no-store", headers: { Accept: "application/json" } });
          if (!response.ok) throw new Error("팀 목록을 갱신하지 못했습니다.");
          const data = await response.json();
          if (data.ok !== true) throw new Error("팀 목록을 갱신하지 못했습니다.");
          const next = { items: normalizeTeams(data.items), source: "server", updated_at: new Date().toISOString() };
          await enqueue(async () => { await write("teams.v1", next); catalog = next; });
          return snapshot();
        } finally { clearTimeout(timer); }
      })().finally(() => { refreshing = null; });
      return refreshing;
    }
    function save(owner, teamId) {
      return enqueue(async () => {
        await load();
        const name = typeof owner === "string" ? owner.trim() : "";
        if (!name || name.length > 100 || name.includes("\0")) throw new Error("담당자 이름을 1~100자로 입력해주세요.");
        const team = catalog.items.find(item => item.id === teamId);
        if (!team) throw new Error("사용할 팀을 선택해주세요.");
        const next = { owner: name, team_id: team.id, team_name: team.name, team_color: team.color, updated_at: new Date().toISOString() };
        await write("profile.v1", next);
        profile = next;
        return clone(next);
      });
    }
    async function identity() {
      await load();
      if (!validProfile(profile)) throw new Error("설정에서 담당자와 팀을 먼저 지정해주세요.");
      const team = catalog.items.find(item => item.id === profile.team_id);
      if (!team) throw new Error("선택한 팀을 사용할 수 없습니다. 설정에서 팀을 다시 선택해주세요.");
      return { owner: profile.owner, team_id: team.id, team_name: team.name, team_color: team.color };
    }
    async function manualIdentity(owner, teamId) {
      await load();
      const name = typeof owner === "string" ? owner.trim() : "";
      if (!name || name.length > 100 || name.includes("\0")) throw new Error("담당자 이름을 1~100자로 입력해주세요.");
      const team = catalog.items.find(item => item.id === teamId);
      if (!team) throw new Error("소속 팀을 선택해주세요.");
      return { owner: name, team_id: team.id, team_name: team.name, team_color: team.color };
    }
    return { load, snapshot, refresh, save, saveTracking, identity, manualIdentity };
  }
  const api = { DEFAULT_TEAMS, DEFAULT_TRACKING, normalizeTracking, normalizeTeams, validProfile, createStore };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BearAppSettingsStore = api;
})(typeof window !== "undefined" ? window : globalThis);
