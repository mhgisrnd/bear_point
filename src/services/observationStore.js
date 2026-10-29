const { pgQuery } = require("../db/postgres");
const { createHash } = require("node:crypto");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS shared_observations (
  id TEXT PRIMARY KEY, bear_code TEXT NOT NULL, owner TEXT NOT NULL,
  place TEXT NOT NULL, admin_region TEXT, lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL, heading DOUBLE PRECISION NOT NULL,
  detectors_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  server_version INTEGER NOT NULL DEFAULT 1, deleted BOOLEAN NOT NULL DEFAULT FALSE,
  updated_by TEXT,
  CHECK (lat BETWEEN -90 AND 90), CHECK (lng BETWEEN -180 AND 180),
  CHECK (heading >= 0 AND heading < 360)
);
CREATE INDEX IF NOT EXISTS shared_observations_updated ON shared_observations(updated_at);
ALTER TABLE shared_observations ADD COLUMN IF NOT EXISTS sync_mutation_id TEXT;
ALTER TABLE shared_observations ADD COLUMN IF NOT EXISTS sync_mutation_hash TEXT;
`;

function bad(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }); }
function normalize(body) {
  const data = body || {};
  const text = (key, limit, required) => {
    const value = String(data[key] == null ? "" : data[key]).trim();
    if ((required && !value) || value.length > limit) throw bad(`${key} 값을 확인해주세요.`);
    return value;
  };
  const number = (key, min, max) => {
    if (data[key] == null || data[key] === "" || typeof data[key] === "boolean") throw bad(`${key} 값이 필요합니다.`);
    const value = Number(data[key]);
    if (!Number.isFinite(value) || value < min || value > max) throw bad(`${key} 범위를 확인해주세요.`);
    return value;
  };
  const detectors = data.detectors == null ? [] : data.detectors;
  if (!Array.isArray(detectors) || detectors.length > 3 || detectors.some(item => !item || typeof item !== "object" || Array.isArray(item))) throw bad("감지기 정보를 확인해주세요.");
  return {
    bear_code: text("bear_code", 100, true), owner: text("owner", 100, true),
    place: text("place", 150, true), admin_region: text("admin_region", 300, false) || null,
    lat: number("lat", -90, 90), lng: number("lng", -180, 180), heading: number("heading", 0, 359.999999999),
    detectors: detectors.map(item => ({ detectorName: String(item.detectorName || "").trim().slice(0, 100), signalStrength: String(item.signalStrength || "").trim().slice(0, 30) }))
  };
}

function createObservationStore(query = pgQuery) {
  let ready;
  function ensure() {
    if (!ready) ready = query(SCHEMA_SQL).catch(error => { ready = null; throw error; });
    return ready;
  }
  async function list({ after = "", limit = 200 } = {}) {
    await ensure();
    const size = Math.min(Math.max(Number(limit) || 200, 1), 200);
    const result = await query("SELECT * FROM shared_observations WHERE id > $1 ORDER BY id LIMIT $2", [String(after), size]);
    return { items: result.rows, next: result.rows.length === size ? result.rows[result.rows.length - 1].id : null };
  }
  async function insert(body) {
    const id = String(body && body.id || "").trim();
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw bad("관측점 ID를 확인해주세요.");
    const data = normalize(body);
    const created = new Date(body.created_at);
    if (!Number.isFinite(created.getTime())) throw bad("등록 시각을 확인해주세요.");
    await ensure();
    // Insert-only, including tombstones: retries never overwrite an existing
    // observation or resurrect an administrator-deleted observation.
    const result = await query(`INSERT INTO shared_observations
      (id,bear_code,owner,place,admin_region,lat,lng,heading,detectors_json,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)
      ON CONFLICT (id) DO NOTHING RETURNING *`,
    [id, data.bear_code, data.owner, data.place, data.admin_region, data.lat, data.lng, data.heading, JSON.stringify(data.detectors), created.toISOString()]);
    if (result.rows.length) return { item: result.rows[0], alreadyExists: false };
    const existing = await query("SELECT * FROM shared_observations WHERE id=$1", [id]);
    return { item: existing.rows[0], alreadyExists: true };
  }
  async function update(id, body, actor) {
    const data = normalize(body);
    const version = Number(body.server_version);
    if (!Number.isInteger(version) || version < 1) throw bad("서버 버전이 필요합니다.");
    await ensure();
    const result = await query(`UPDATE shared_observations SET
      bear_code=$2,owner=$3,place=$4,admin_region=$5,lat=$6,lng=$7,heading=$8,
      detectors_json=$9::jsonb,server_version=server_version+1,updated_at=NOW(),updated_by=$10
      WHERE id=$1 AND server_version=$11 AND deleted=FALSE RETURNING *`,
    [id, data.bear_code, data.owner, data.place, data.admin_region, data.lat, data.lng, data.heading, JSON.stringify(data.detectors), actor, version]);
    if (!result.rows.length) throw bad("다른 관리자가 변경했거나 삭제한 자료입니다. 새로고침 후 다시 확인해주세요.", 409);
    return result.rows[0];
  }
  async function get(id) {
    await ensure();
    const result = await query("SELECT * FROM shared_observations WHERE id=$1", [id]);
    if (!result.rows.length) throw bad("관측점을 찾을 수 없습니다.", 404);
    return result.rows[0];
  }
  async function revise(id, body) {
    const data = normalize(body);
    const version = Number(body.server_version);
    const mutation = String(body.mutation_id || "");
    if (!Number.isInteger(version) || version < 1) throw bad("서버 버전이 필요합니다.");
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(mutation)) throw bad("수정 요청 ID를 확인해주세요.");
    const hash = createHash("sha256").update(JSON.stringify({ version, data })).digest("hex");
    await ensure();
    // Compare and swap is atomic. A repeated request can acknowledge its own
    // commit without applying it twice, even when the first response was lost.
    const result = await query(`UPDATE shared_observations SET
      bear_code=$2,owner=$3,place=$4,admin_region=$5,lat=$6,lng=$7,heading=$8,
      detectors_json=$9::jsonb,server_version=server_version+1,updated_at=NOW(),updated_by='app',
      sync_mutation_id=$10,sync_mutation_hash=$11
      WHERE id=$1 AND server_version=$12 AND deleted=FALSE AND sync_mutation_id IS DISTINCT FROM $10 RETURNING *`,
    [id, data.bear_code, data.owner, data.place, data.admin_region, data.lat, data.lng, data.heading,
      JSON.stringify(data.detectors), mutation, hash, version]);
    if (result.rows.length) return { item: result.rows[0], alreadyExists: false };
    const current = await get(id);
    if (!current.deleted && Number(current.server_version) === version + 1 && current.sync_mutation_id === mutation && current.sync_mutation_hash === hash) return { item: current, alreadyExists: true };
    throw Object.assign(bad("다른 사용자가 변경하거나 삭제한 관측점입니다. 수정 내용을 비교해주세요.", 409), { item: current });
  }
  async function remove(id, version, actor) {
    if (!Number.isInteger(Number(version)) || Number(version) < 1) throw bad("서버 버전이 필요합니다.");
    await ensure();
    const result = await query(`UPDATE shared_observations SET deleted=TRUE,
      server_version=server_version+1,updated_at=NOW(),updated_by=$3
      WHERE id=$1 AND server_version=$2 AND deleted=FALSE RETURNING *`, [id, Number(version), actor]);
    if (!result.rows.length) throw bad("이미 변경되거나 삭제된 자료입니다. 새로고침해주세요.", 409);
    return result.rows[0];
  }
  async function removeFromApp(id, version) {
    try { return { item: await remove(id, version, "app") }; }
    catch (error) {
      if (error.statusCode !== 409) throw error;
      const item = await get(id);
      // Retrying a completed deletion never resurrects or deletes another row.
      if (item.deleted) return { item, alreadyExists: true };
      throw Object.assign(bad("다른 사용자가 변경한 관측점입니다. 최신 내용을 확인한 뒤 다시 삭제해주세요.", 409), { item });
    }
  }
  return { ensure, list, insert, update, revise, get, remove, removeFromApp };
}
module.exports = { SCHEMA_SQL, normalize, createObservationStore };
