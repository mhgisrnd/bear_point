const { ensureRealtimeTable } = require('../src/services/realtimeStore');
const { pgQuery, closePgPool } = require('../src/db/postgres');
(async () => {
  await ensureRealtimeTable();
  const result = await pgQuery("SELECT column_name FROM information_schema.columns WHERE table_name = 'bear_estimates_realtime' ORDER BY ordinal_position");
  console.log(JSON.stringify(result.rows.map((row) => row.column_name)));
  await closePgPool();
  process.exit(0);
})().catch(async (error) => {
  console.error(error && error.stack ? error.stack : String(error));
  try { await closePgPool(); } catch (_) {}
  process.exit(1);
});
