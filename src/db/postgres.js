const { Pool } = require("pg");

const PG_CONFIG = {
  host: process.env.PG_HOST || process.env.PGHOST || "172.30.6.100",
  port: Number(process.env.PG_PORT || process.env.PGPORT || 5432),
  user: process.env.PG_USER || process.env.PGUSER || "postgres",
  password: process.env.PG_PASSWORD || process.env.PGPASSWORD || "postgres",
  database: process.env.PG_DATABASE || process.env.PGDATABASE || "postgres",
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
};

let pgPool = null;

// 싱글톤 PostgreSQL 커넥션 풀을 생성/반환한다.
function getPgPool() {
  if (pgPool) return pgPool;

  pgPool = new Pool(PG_CONFIG);
  pgPool.on("error", (err) => {
    console.error("❌ PostgreSQL pool error:", err.message);
  });

  return pgPool;
}

// 공통 쿼리 실행 헬퍼로 파라미터 바인딩을 지원한다.
async function pgQuery(text, values) {
  const pool = getPgPool();
  return pool.query(text, values || []);
}

// DB 연결 상태와 기본 메타 정보를 조회한다.
async function checkPostgresHealth() {
  const result = await pgQuery(
    "SELECT current_database() AS db_name, current_user AS db_user, NOW() AS server_time"
  );
  return result.rows[0];
}

// 프로세스 종료 시 풀을 정상 종료한다.
async function closePgPool() {
  if (!pgPool) return;
  await pgPool.end();
  pgPool = null;
}

module.exports = {
  PG_CONFIG,
  pgQuery,
  checkPostgresHealth,
  closePgPool,
};
