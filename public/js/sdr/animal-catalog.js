(function (root) {
  "use strict";
  const CACHE_KEY = "bearpoint.sdrAnimalCatalog.v1";
  function formatHz(hz) {
    const [whole, fraction] = (hz / 1e6).toFixed(6).split(".");
    return whole + "." + fraction.replace(/0+$/, "").padEnd(3, "0");
  }
  function normalize(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.map(row => {
      const code = String(row?.bear_code || "").trim();
      const frequencies = [];
      for (const slot of ["a", "b", "c"]) {
        const value = row?.["frequency_" + slot];
        if (value == null || String(value).trim() === "") continue;
        const mhz = Number(value), hz = Math.round(mhz * 1e6);
        if (!Number.isFinite(mhz) || hz < 100000 || hz > 999999000 || frequencies.some(f => f.hz === hz)) continue;
        frequencies.push({ slot: slot.toUpperCase(), hz });
      }
      return { id: row?.id == null ? null : String(row.id), code, frequencies };
    }).filter(item => item.code);
  }
  let pending = null;
  async function load() {
    if (pending) return pending;
    pending = (async () => {
      let stored = [], cached = false;
      try {
        const value = root.localStorage.getItem(CACHE_KEY);
        if (value !== null) { const rows = JSON.parse(value); if (Array.isArray(rows)) { stored = rows; cached = true; } }
      } catch (_) {}
      if (!cached) {
        try {
          const response = await root.fetch("json/bear-entities.json");
          if (response.ok) stored = await response.json();
        } catch (_) {}
      }
      const native = root.Capacitor && (root.Capacitor.isNativePlatform?.() || root.Capacitor.getPlatform?.() === "android");
      const base = native ? String(root.BEAR_RUNTIME_CONFIG?.realtimeApiBase || "/api/realtime").replace(/\/+$/, "") : "api/app-realtime";
      let notice = "", rows = stored;
      try {
        const response = await root.fetch(base + "/bear-entities", { cache: "no-store", signal: AbortSignal.timeout(8000) });
        const data = await response.json();
        if (!response.ok || data.ok !== true || !Array.isArray(data.items)) throw new Error("catalog unavailable");
        // An older server response must not silently erase the saved frequency catalog.
        if (data.items.length && !data.items.some(item => Object.prototype.hasOwnProperty.call(item, "frequency_a")))
          throw new Error("frequency fields unavailable");
        rows = data.items;
        try { root.localStorage.setItem(CACHE_KEY, JSON.stringify(rows)); } catch (_) {}
      } catch (_) {
        notice = "목록 갱신 실패 · 저장된 주파수 사용";
      }
      const items = normalize(rows);
      if (!items.length) notice = notice ? "개체 목록을 불러오지 못했습니다. 다시 시도해주세요." : "등록된 개체가 없습니다.";
      return { items, notice };
    })();
    try { return await pending; } finally { pending = null; }
  }
  root.BearSdrAnimals = { normalize, formatHz, load };
})(window);
