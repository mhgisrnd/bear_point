const { pgQuery } = require("../db/postgres");

const KST_TIMESTAMP_SQL = "YYYY-MM-DD HH24:MI:SS";
const KST_NOW_SQL = "(NOW() AT TIME ZONE 'Asia/Seoul')";

// 추적위치 목록 조회용 공통 SELECT 문
// 라우트: GET /api/realtime/bear-estimates -> listRealtimeBearEstimates(options)
const BEAR_ESTIMATE_SELECT_SQL = `
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
    update_id,
    TO_CHAR(update_at, '${KST_TIMESTAMP_SQL}') AS update_at,
    payload
  FROM bear_estimates_realtime
`;

// 클라이언트 입력을 DB INSERT 형태로 정규화하고 필수 좌표를 검증한다.
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

function normalizeBulkDeleteIds(ids) {
  if (!Array.isArray(ids)) {
    const error = new Error("삭제할 ids 배열이 필요합니다.");
    error.statusCode = 400;
    throw error;
  }

  const normalized = Array.from(
    new Set(
      ids
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  );

  if (!normalized.length) {
    const error = new Error("유효한 삭제 대상 id가 없습니다.");
    error.statusCode = 400;
    throw error;
  }

  return normalized;
}

function normalizeUpdatePayload(body) {
  const data = body || {};
  const bearCode = String(data.bear_code != null ? data.bear_code : data.bearCode != null ? data.bearCode : "").trim();
  const owner = String(data.owner != null ? data.owner : "").trim();
  const place = String(data.place != null ? data.place : "").trim();

  if (!bearCode) {
    const error = new Error("곰 코드는 필수입니다.");
    error.statusCode = 400;
    throw error;
  }

  return {
    bearCode,
    owner: owner || "미지정",
    place: place || "미지정",
  };
}

function buildRealtimeSearchWhereClause(keyword, bindParams) {
  // 관리자 추적조회 화면의 검색어(q)를 SQL WHERE 절로 변환한다.
  // 검색 대상: 곰 코드, 담당자, 명칭, 추정ID
  const search = String(keyword || "").trim();
  if (!search) {
    return "";
  }

  bindParams.push(`%${search}%`);
  const bindIndex = bindParams.length;

  return `
    AND (
      COALESCE(bear_code, '') ILIKE $${bindIndex}
      OR COALESCE(owner, '') ILIKE $${bindIndex}
      OR COALESCE(place, '') ILIKE $${bindIndex}
      OR COALESCE(bear_estimate_id, '') ILIKE $${bindIndex}
    )
  `;
}

// 실시간 목록을 최신 업로드 순으로 조회한다.
// options 사용 방식:
// - 대시보드 요약 조회: { limit }
// - 관리자 추적조회(검색/페이지): { page, pageSize, q }
async function listRealtimeBearEstimates(options) {
  const queryOptions = typeof options === "object" && options !== null ? options : { limit: options };
  const hasPaging = queryOptions.page != null || queryOptions.pageSize != null;
  const searchBindParams = [];
  const whereClause = buildRealtimeSearchWhereClause(queryOptions.q, searchBindParams);

  if (hasPaging) {
    // 페이지 목록/총건수 동시 제공: total, page, pageSize, items
    const page = Math.max(Number(queryOptions.page || 1), 1);
    const pageSize = Math.min(Math.max(Number(queryOptions.pageSize || 10), 1), 100);
    const offset = (page - 1) * pageSize;

    const countResult = await pgQuery(
      `
        SELECT COUNT(*)::int AS total
        FROM bear_estimates_realtime
        WHERE COALESCE(use_yn, TRUE) = TRUE
        ${whereClause}
      `,
      searchBindParams
    );

    const total = Number((countResult.rows[0] || {}).total || 0);
    const listBindParams = searchBindParams.slice();
    listBindParams.push(pageSize, offset);

    const result = await pgQuery(
      `
        ${BEAR_ESTIMATE_SELECT_SQL}
        WHERE COALESCE(use_yn, TRUE) = TRUE
        ${whereClause}
        ORDER BY uploaded_at DESC, id DESC
        LIMIT $${listBindParams.length - 1}
        OFFSET $${listBindParams.length}
      `,
      listBindParams
    );

    return {
      items: result.rows,
      total,
      page,
      pageSize,
    };
  }

  // 기존 호환: limit 기반 단순 목록 조회(대시보드에서 사용)
  const safeLimit = Math.min(Math.max(Number(queryOptions.limit || 100), 1), 500);
  const listBindParams = searchBindParams.slice();
  listBindParams.push(safeLimit);

  const result = await pgQuery(
    `
      ${BEAR_ESTIMATE_SELECT_SQL}
      WHERE COALESCE(use_yn, TRUE) = TRUE
      ${whereClause}
      ORDER BY uploaded_at DESC, id DESC
      LIMIT $${listBindParams.length}
    `,
    listBindParams
  );

  return {
    items: result.rows,
    total: result.rows.length,
    page: 1,
    pageSize: result.rows.length,
  };
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
        use_yn,
        payload
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        CASE WHEN $10::text = '' THEN NULL ELSE ($10::timestamptz AT TIME ZONE 'Asia/Seoul') END,
        TRUE,
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
        update_id,
        TO_CHAR(update_at, '${KST_TIMESTAMP_SQL}') AS update_at,
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

// 실시간 항목의 곰코드/담당자/명칭을 수정한다.
async function updateRealtimeBearEstimateById(id, body, options = {}) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    const error = new Error("유효한 id가 필요합니다.");
    error.statusCode = 400;
    throw error;
  }

  const payload = normalizeUpdatePayload(body);
  const actorId = options.actorId != null ? String(options.actorId).trim() || null : null;

  const result = await pgQuery(
    `
      UPDATE bear_estimates_realtime
      SET
        bear_code = $2,
        owner = $3,
        place = $4,
        update_id = $5,
        update_at = ${KST_NOW_SQL}
      WHERE id = $1
        AND COALESCE(use_yn, TRUE) = TRUE
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
        update_id,
        TO_CHAR(update_at, '${KST_TIMESTAMP_SQL}') AS update_at,
        payload
    `,
    [numericId, payload.bearCode, payload.owner, payload.place, actorId]
  );

  if (!result.rows.length) {
    const error = new Error("수정할 항목을 찾지 못했습니다.");
    error.statusCode = 404;
    throw error;
  }

  return result.rows[0];
}

// ids 배열에 포함된 실시간 항목들을 use_yn=false로 소프트 삭제한다.
async function deleteRealtimeBearEstimatesByIds(ids, options = {}) {
  const normalizedIds = normalizeBulkDeleteIds(ids);
  const actorId = options.actorId != null ? String(options.actorId).trim() || null : null;
  const result = await pgQuery(
    `
      UPDATE bear_estimates_realtime
      SET
        use_yn = FALSE,
        update_id = $2,
        update_at = ${KST_NOW_SQL}
      WHERE id = ANY($1::int[])
        AND COALESCE(use_yn, TRUE) = TRUE
    `,
    [normalizedIds, actorId]
  );

  return {
    deletedCount: Number(result.rowCount || 0),
  };
}

module.exports = {
  listRealtimeBearEstimates,
  insertRealtimeBearEstimate,
  updateRealtimeBearEstimateById,
  deleteRealtimeBearEstimatesByIds,
};
