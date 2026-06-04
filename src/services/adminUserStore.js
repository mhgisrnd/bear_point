const { pgQuery } = require("../db/postgres");

const KST_TIMESTAMP_SQL = "YYYY-MM-DD HH24:MI:SS";

function buildAdminUserSearchWhereClause(keyword, bindParams) {
  const search = String(keyword || "").trim();
  if (!search) {
    return "";
  }

  bindParams.push(`%${search}%`);
  const bindIndex = bindParams.length;

  return `
    AND (
      COALESCE(user_id, '') ILIKE $${bindIndex}
      OR COALESCE(user_name, '') ILIKE $${bindIndex}
      OR COALESCE(role_code, '') ILIKE $${bindIndex}
    )
  `;
}

async function listAdminAccounts(options = {}) {
  const page = Math.max(Number(options.page || 1), 1);
  const pageSize = Math.min(Math.max(Number(options.pageSize || 10), 1), 100);
  const offset = (page - 1) * pageSize;
  const bindParams = [];
  const whereClause = buildAdminUserSearchWhereClause(options.q, bindParams);

  const countResult = await pgQuery(
    `
      SELECT COUNT(*)::int AS total
      FROM public.admin_accounts
      WHERE 1 = 1
      ${whereClause}
    `,
    bindParams
  );

  const total = Number((countResult.rows[0] || {}).total || 0);
  const listBindParams = bindParams.slice();
  listBindParams.push(pageSize, offset);

  const result = await pgQuery(
    `
      SELECT
        id,
        user_id,
        user_name,
        role_code,
        is_active,
        TO_CHAR(last_login_at, '${KST_TIMESTAMP_SQL}') AS last_login_at,
        TO_CHAR(created_at, '${KST_TIMESTAMP_SQL}') AS created_at,
        TO_CHAR(updated_at, '${KST_TIMESTAMP_SQL}') AS updated_at
      FROM public.admin_accounts
      WHERE 1 = 1
      ${whereClause}
      ORDER BY id ASC
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

module.exports = {
  listAdminAccounts,
};
