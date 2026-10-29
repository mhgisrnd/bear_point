(function () {
  "use strict";
  const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform());
  const database = () => window.BearSQLiteConfig?.dbName || "BearPointData";
  let ready;
  let pulling;
  let merging = Promise.resolve();
  const sending = new Set();
  const newMutationId = () => window.crypto?.randomUUID?.() || "edit-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  const revision = row => JSON.stringify([Number(row.server_version || 0), row.updated_at || "", row.sync_mutation_id || "", row.share_state]);
  function serialize(action) {
    const task = merging.then(action);
    merging = task.catch(() => {});
    return task;
  }
  const storageKey = "bearpoint.observations.v1";
  let webRows;
  function webRead() {
    if (!webRows) {
      try { webRows = JSON.parse(window.localStorage.getItem(storageKey) || "[]"); }
      catch (_) { webRows = []; }
      if (!Array.isArray(webRows)) webRows = [];
    }
    return webRows;
  }
  function webWrite(rows) {
    // A quota/permission failure must be reported, never presented as saved.
    window.localStorage.setItem(storageKey, JSON.stringify(rows));
    webRows = rows;
  }
  function changed() {
    if (typeof window.dispatchEvent === "function") window.dispatchEvent(new Event("observations-changed"));
  }
  async function init() {
    if (!ready) ready = (async () => {
      if (!isNative()) {
        webWrite(webRead().map(row => row.share_state === "sending" ? { ...row, share_state: "failed", sync_error: "전송 완료 여부를 확인하지 못했습니다. 다시 전송해주세요." } : row));
        return;
      }
      const state = await window.BearSQLite.initialize();
      if (!state.ready) throw new Error("SQLite 연결이 준비되지 않았습니다.");
      await run("UPDATE observations SET share_state='failed',sync_error='전송 중 앱이 종료되었습니다. 다시 전송해주세요.' WHERE share_state='sending'");
    })().catch(error => { ready = null; throw error; });
    return ready;
  }
  const plugin = () => window.Capacitor.Plugins.CapacitorSQLite;
  const run = (statement, values = []) => plugin().run({ database: database(), statement, values, transaction: true, readonly: false });
  async function all() {
    await init();
    if (!isNative()) return webRead().map(row => ({ ...row }));
    const result = await plugin().query({ database: database(), statement: "SELECT * FROM observations ORDER BY created_at DESC,id", values: [], readonly: false });
    return result.values || [];
  }
  async function find(id) {
    await init();
    if (!isNative()) return webRead().find(row => row.id === id);
    const result = await plugin().query({ database: database(), statement: "SELECT * FROM observations WHERE id=?", values: [id], readonly: false });
    return (result.values || [])[0];
  }
  function payload(row) {
    return { id: row.id, bear_code: row.bear_code, owner: row.owner, place: row.place,
      admin_region: row.admin_region || null, lat: Number(row.lat), lng: Number(row.lng), heading: ((Number(row.heading) % 360) + 360) % 360,
      detectors: typeof row.detectors_json === "string" ? JSON.parse(row.detectors_json || "[]") : row.detectors_json || [],
      created_at: row.created_at && /Z$|[+]\d\d:\d\d$/.test(row.created_at) ? row.created_at : String(row.created_at || "").replace(" ", "T") + "Z" };
  }
  async function patch(id, fields) {
    if (!isNative()) { webWrite(webRead().map(row => row.id === id ? { ...row, ...fields } : row)); return; }
    const keys = Object.keys(fields);
    await run("UPDATE observations SET " + keys.map(key => key + "=?").join(",") + " WHERE id=?", [...keys.map(key => fields[key]), id]);
  }
  function locked(row) { return row && (row.share_state === "sending" || sending.has(row.id) || !!row.server_deleted); }
  function deletable(row) { return row && !locked(row) && !row.shared_at && !Number(row.server_version) && !row.conflict_json && row.share_state !== "shared"; }
  async function assertEditable(id) {
    const row = await find(id);
    if (!row) throw new Error("관측점을 찾을 수 없습니다.");
    if (locked(row)) throw new Error(row.server_deleted ? "서버에서 삭제한 관측점입니다." : "전송 중인 관측점입니다.");
    return row;
  }
  async function saveDraft(observation, detectors, edit = false) {
    await init();
    return serialize(async () => {
    const original = edit ? await assertEditable(observation.id) : null;
    if (original && observation.editRevision != null && observation.editRevision !== revision(original)) throw new Error("수정 중 관측점이 변경되었습니다. 입력 내용은 유지됩니다. 최신 자료를 확인하고 다시 수정해주세요.");
    const fields = { bear_code: observation.bearCode, owner: observation.owner, place: observation.place,
      admin_region: observation.adminRegion || null, lat: observation.lat, lng: observation.lng,
      heading: observation.heading, detectors_json: JSON.stringify(detectors || []),
      updated_at: new Date().toISOString(), share_state: original?.share_state === "conflict" ? "conflict" : "local", sync_error: null,
      sync_mutation_id: newMutationId() };
    if (!isNative()) {
      const rows = webRead();
      if (edit && locked(rows.find(row => row.id === observation.id))) throw new Error("관측점이 전송 중이거나 삭제되었습니다.");
      webWrite(edit ? rows.map(row => row.id === observation.id ? { ...row, ...fields } : row)
        : [{ id: observation.id, created_at: new Date().toISOString(), server_version: 0, server_deleted: 0, ...fields }, ...rows]);
    } else if (edit) {
      const keys = Object.keys(fields);
      const result = await run("UPDATE observations SET " + keys.map(key => key + "=?").join(",") + " WHERE id=? AND share_state!='sending' AND server_deleted=0", [...keys.map(key => fields[key]), observation.id]);
      if (!result.changes?.changes) throw new Error("공유 상태가 변경되었습니다. 목록을 새로고침해주세요.");
    } else {
      const row = { id: observation.id, created_at: new Date().toISOString(), ...fields };
      const keys = Object.keys(row);
      await run("INSERT INTO observations (" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")", keys.map(key => row[key]));
    }
    changed();
    });
  }
  function merge(remote, acknowledged = false) {
    return serialize(() => mergeOne(remote, acknowledged));
  }
  function sameContent(local, remote) {
    const data = payload(local);
    const detectors = typeof remote.detectors_json === "string" ? JSON.parse(remote.detectors_json || "[]") : remote.detectors_json || [];
    return ["bear_code", "owner", "place", "admin_region", "lat", "lng", "heading"].every(key => (data[key] ?? null) === (remote[key] ?? null)) && JSON.stringify(data.detectors) === JSON.stringify(detectors);
  }
  async function recordConflict(id, remote) {
    await patch(id, { share_state: "conflict", conflict_json: JSON.stringify(remote), sync_error: remote.deleted ? "서버에서 삭제된 관측점입니다. 로컬 수정본은 유지됩니다." : "다른 수정 사항이 있습니다. 내용을 비교해주세요." });
  }
  async function mergeOne(remote, acknowledged = false) {
    const local = await find(remote.id);
    if (local && local.share_state !== "shared" && !acknowledged) {
      if (!sending.has(local.id) && local.share_state !== "sending" && Number(local.server_version || 0) > 0 && Number(remote.server_version) > Number(local.server_version)) {
        // A matching receipt can safely acknowledge a response lost after commit.
        if (!remote.deleted && remote.sync_mutation_id === local.sync_mutation_id && sameContent(local, remote)) return mergeOne(remote, true);
        await recordConflict(local.id, remote);
      }
      return;
    }
    if (local && Number(local.server_version || 0) > Number(remote.server_version)) return;
    const detectors = typeof remote.detectors_json === "string" ? remote.detectors_json : JSON.stringify(remote.detectors_json || []);
    const fields = { bear_code: remote.bear_code, owner: remote.owner, place: remote.place,
      admin_region: remote.admin_region, lat: Number(remote.lat), lng: Number(remote.lng), heading: Number(remote.heading),
      detectors_json: detectors, created_at: remote.created_at, updated_at: remote.updated_at,
      share_state: "shared", shared_at: remote.uploaded_at, server_version: remote.server_version,
      server_deleted: remote.deleted ? 1 : 0, sync_error: null, sync_mutation_id: null, conflict_json: null };
    // If an earlier successful response was lost, retain later unsent edits
    // before adopting the immutable canonical server record.
    if (local && acknowledged && local.share_state !== "shared") {
      const old = payload(local);
      const differs = ["bear_code", "owner", "place", "admin_region", "lat", "lng", "heading"].some(key => old[key] !== fields[key]) || JSON.stringify(old.detectors) !== detectors;
      if (differs) fields.unshared_backup = JSON.stringify(local);
    }
    if (local) await patch(remote.id, fields);
    else if (!isNative()) webWrite([...webRead(), { id: remote.id, ...fields }]);
    else {
      const row = { id: remote.id, ...fields }; const keys = Object.keys(row);
      await run("INSERT INTO observations (" + keys.join(",") + ") VALUES (" + keys.map(() => "?").join(",") + ")", keys.map(key => row[key]));
    }
  }
  function apiBase() {
    const config = window.BEAR_RUNTIME_CONFIG || {};
    if (config.observationsApiBase) return config.observationsApiBase.replace(/\/$/, "");
    // Browser pages use the API hosted alongside the page, including a
    // deployment context root. Native assets have no HTTP API of their own.
    if (!isNative()) return "api/observations";
    const realtime = config.realtimeApiBase || window.BEAR_API_BASE;
    if (realtime) return realtime.replace(/\/api\/realtime\/?$/, "/api/observations");
    return "https://bearmap.duckdns.org/api/observations";
  }
  async function request(path = "", options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(apiBase() + path, { ...options, signal: controller.signal, headers: { "Content-Type": "application/json", Accept: "application/json" }, cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Object.assign(new Error(result.message || "서버 요청에 실패했습니다."), { status: response.status, item: result.item });
      return result;
    } finally { clearTimeout(timer); }
  }
  async function upload(id) {
    await init();
    if (sending.has(id)) return { ok: false, message: "이미 전송 중입니다." };
    sending.add(id);
    try {
      let row = await find(id);
      if (!row) throw new Error("관측점을 찾을 수 없습니다.");
      if (row.share_state === "shared") return { ok: true, alreadyExists: true };
      if (row.share_state === "conflict") return { ok: false, conflict: true, message: "충돌 내용을 먼저 확인해주세요." };
      if (row.server_deleted) throw new Error("서버에서 삭제한 관측점입니다.");
      if (Number(row.server_version) > 0 && !row.sync_mutation_id) {
        await patch(id, { sync_mutation_id: newMutationId() }); row = await find(id);
      }
      await patch(id, { share_state: "sending", sync_error: null });
      row = await find(id);
      changed();
      const updating = Number(row.server_version) > 0;
      const result = await request(updating ? "/" + encodeURIComponent(id) + "/revisions" : "", { method: "POST", body: JSON.stringify({ ...payload(row), ...(updating ? { server_version: Number(row.server_version), mutation_id: row.sync_mutation_id } : {}) }) });
      if (!updating && result.alreadyExists && (!sameContent(row, result.item) || result.item.deleted)) {
        await recordConflict(id, result.item);
        return { ok: false, conflict: true, message: "이미 공유된 내용과 수정본이 다릅니다. 내용을 비교해주세요." };
      }
      await merge(result.item, true);
      return { ok: true, alreadyExists: result.alreadyExists, deleted: result.item.deleted, backup: !!(await find(id)).unshared_backup };
    } catch (error) {
      if (error.status === 409 && error.item) {
        await recordConflict(id, error.item);
        return { ok: false, conflict: true, message: error.message };
      }
      const message = error.name === "AbortError" ? "응답을 확인하지 못했습니다. 다시 전송해주세요." : error.message;
      // A local bookkeeping/read error after acknowledgement must never unlock
      // a record that was already committed as shared.
      if (isNative()) await run("UPDATE observations SET share_state='failed',sync_error=? WHERE id=? AND share_state='sending'", [message, id]);
      else if (webRead().find(row => row.id === id)?.share_state === "sending") await patch(id, { share_state: "failed", sync_error: message });
      return { ok: false, message };
    } finally { sending.delete(id); changed(); }
  }
  async function pull() {
    if (!pulling) pulling = (async () => {
      await init();
      let after = "";
      // Fetch all pages first; failed pagination never removes or marks local data.
      const remote = [];
      do {
        const page = await request("?limit=200&after=" + encodeURIComponent(after));
        remote.push(...page.items);
        if (page.next && page.next === after) throw new Error("관측점 페이지 응답이 올바르지 않습니다.");
        after = page.next;
      } while (after);
      for (const row of remote) await merge(row);
      return remote;
    })().finally(() => { pulling = null; });
    return pulling;
  }
  async function removeDraft(id) {
    await init();
    return serialize(async () => {
    const row = await assertEditable(id);
    if (!deletable(row)) throw new Error("공유된 관측점의 삭제는 관리자 페이지에서 가능합니다.");
    if (!isNative()) webWrite(webRead().filter(row => row.id !== id));
    else {
      const result = await run("DELETE FROM observations WHERE id=? AND share_state NOT IN ('shared','sending') AND COALESCE(server_version,0)=0 AND shared_at IS NULL AND conflict_json IS NULL", [id]);
      if (!result.changes?.changes) throw new Error("전송 상태가 변경되었습니다. 새로고침해주세요.");
    }
    changed();
    });
  }
  async function resolveConflict(id, strategy, reviewedVersion, mutationId) {
    await init();
    await serialize(async () => {
      const local = await assertEditable(id);
      const remote = JSON.parse(local.conflict_json || "null");
      if (local.share_state !== "conflict" || !remote || Number(remote.server_version) !== Number(reviewedVersion) || local.sync_mutation_id !== mutationId) throw new Error("비교 중 자료가 변경되었습니다. 충돌 내용을 다시 확인해주세요.");
      if (strategy === "server") await mergeOne(remote, true);
      else if (strategy === "local" && !remote.deleted) await patch(id, { server_version: remote.server_version, shared_at: remote.uploaded_at, share_state: "local", conflict_json: null, sync_error: null, sync_mutation_id: newMutationId() });
      else throw new Error("삭제된 관측점에 수정본을 덮어쓸 수 없습니다.");
    });
    changed();
    return strategy === "local" ? upload(id) : { ok: true };
  }
  async function remove(id, reviewedVersion) {
    const row = await assertEditable(id);
    if (deletable(row)) return removeDraft(id);
    if (row.share_state === "conflict") throw new Error("충돌 내용을 확인한 뒤 다시 삭제해주세요.");
    if (Number(reviewedVersion) !== Number(row.server_version) || !Number(row.server_version)) throw new Error("관측점이 변경되었습니다. 최신 내용을 확인한 뒤 다시 삭제해주세요.");
    if (sending.has(id)) throw new Error("이미 전송 중입니다.");
    sending.add(id);
    try {
      await patch(id, { share_state: "sending" }); changed();
      const result = await request("/" + encodeURIComponent(id) + "/removal", { method: "POST", body: JSON.stringify({ server_version: Number(row.server_version) }) });
      if (!result.item?.deleted || String(result.item.id) !== String(id)) throw new Error("서버 삭제 결과를 확인하지 못했습니다.");
      await merge(result.item, true);
    } catch (error) {
      await patch(id, { share_state: row.share_state });
      if (error.status === 409 && error.item) {
        if (row.share_state === "shared") await merge(error.item, true);
        else await recordConflict(id, error.item);
      }
      throw new Error(error.status === 409 ? error.message : "삭제하지 못했습니다. 자료는 기기에 유지됩니다. " + error.message);
    } finally { sending.delete(id); changed(); }
  }
  window.BearObservationSync = { init, all, find, saveDraft, upload, pull, assertEditable, removeDraft, locked, deletable, revision, resolveConflict, remove };
})();
