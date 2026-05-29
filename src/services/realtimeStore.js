const { pgQuery } = require("../db/postgres");

const KST_TIMESTAMP_SQL = "YYYY-MM-DD HH24:MI:SS.MS +0900";

// 클라이언트 입력을 DB INSERT 포맷으로 정규화하고 필수 좌표를 검증한다.
function normalizeInsertPayload(body) {
  const data = body || {};
  const lat = Number(data.lat);
  const lng = Number(data.lng != null ? data.lng : data.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const error = new Error("lat/lng 값이 필요합니다.");
    error.statusCode = 400;
    throw error;
  }

  return {
    bearEstimateId:
      data.bear_estimate_id != null
        ? String(data.bear_estimate_id)
        : data.id != null
          ? String(data.id)
          : null,
    bearCode:
      data.bear_code != null
        ? String(data.bear_code)
        : data.bearCode != null
          ? String(data.bearCode)
          : "-",
    owner: data.owner != null ? String(data.owner) : null,
    place: data.place != null ? String(data.place) : null,
    lat,
    lng,
    latDms: data.lat_dms != null ? String(data.lat_dms) : data.latDms != null ? String(data.latDms) : null,
    lngDms: data.lng_dms != null ? String(data.lng_dms) : data.lonDms != null ? String(data.lonDms) : null,
    intersectionsCount:
      Number.isFinite(Number(data.intersections_count))
        ? Number(data.intersections_count)
        : Number.isFinite(Number(data.intersectionsCount))
          ? Number(data.intersectionsCount)
          : null,
    sourceCreatedAt:
      data.created_at != null
        ? String(data.created_at)
        : data.ts != null
          ? new Date(Number(data.ts)).toISOString()
          : "",
    payload: JSON.stringify(data),
  };
}

// 실시간 목록을 최신 업로드 순으로 조회한다.
async function listRealtimeBearEstimates(limit) {
  const safeLimit = Math.min(Math.max(Number(limit || 100), 1), 500);
  const result = await pgQuery(
    `
      SELECT
        id,
        bear_estimate_id,
        bear_code,
        owner,
        place,
        lat,
        lng,
        lat_dms,
        lng_dms,
        intersections_count,
        TO_CHAR(source_created_at, '${KST_TIMESTAMP_SQL}') AS source_created_at,
        TO_CHAR(uploaded_at, '${KST_TIMESTAMP_SQL}') AS uploaded_at,
        payload
      FROM bear_estimates_realtime
      ORDER BY uploaded_at DESC, id DESC
      LIMIT $1
    `,
    [safeLimit]
  );

  return result.rows;
}

// 실시간 항목 1건을 저장하고 생성 결과를 반환한다.
async function insertRealtimeBearEstimate(body) {
  const payload = normalizeInsertPayload(body);

  const result = await pgQuery(
    `
      INSERT INTO bear_estimates_realtime (
        bear_estimate_id,
        bear_code,
        owner,
        place,
        lat,
        lng,
        lat_dms,
        lng_dms,
        intersections_count,
        source_created_at,
        payload
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        CASE WHEN $10::text = '' THEN NULL ELSE ($10::timestamptz AT TIME ZONE 'Asia/Seoul') END,
        $11::jsonb
      )
      RETURNING
        id,
        bear_estimate_id,
        bear_code,
        owner,
        place,
        lat,
        lng,
        lat_dms,
        lng_dms,
        intersections_count,
        TO_CHAR(source_created_at, '${KST_TIMESTAMP_SQL}') AS source_created_at,
        TO_CHAR(uploaded_at, '${KST_TIMESTAMP_SQL}') AS uploaded_at,
        payload
    `,
    [
      payload.bearEstimateId,
      payload.bearCode,
      payload.owner,
      payload.place,
      payload.lat,
      payload.lng,
      payload.latDms,
      payload.lngDms,
      payload.intersectionsCount,
      payload.sourceCreatedAt,
      payload.payload,
    ]
  );

  return result.rows[0];
}

module.exports = {
  listRealtimeBearEstimates,
  insertRealtimeBearEstimate,
};
