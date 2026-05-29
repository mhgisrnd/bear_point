const { insertRealtimeBearEstimate, listRealtimeBearEstimates } = require('../src/services/realtimeStore');
const { pgQuery, closePgPool } = require('../src/db/postgres');
(async () => {
  const inserted = await insertRealtimeBearEstimate({
    id: 'tz-check-1',
    bear_code: 'TZ1',
    owner: 'tester',
    place: 'jirisan',
    lat: 35.33212,
    lng: 127.73142,
    created_at: '2026-05-08 13:20:18.000 +0900'
  });
  const listed = await listRealtimeBearEstimates(3);
  const target = listed.find((item) => item.bear_estimate_id === 'tz-check-1');
  console.log(JSON.stringify({ inserted, target }));
  await pgQuery("DELETE FROM bear_estimates_realtime WHERE bear_estimate_id = 'tz-check-1'");
  await closePgPool();
  process.exit(0);
})().catch(async (error) => {
  console.error(error && error.stack ? error.stack : String(error));
  try {
    await pgQuery("DELETE FROM bear_estimates_realtime WHERE bear_estimate_id = 'tz-check-1'");
  } catch (_) {}
  try { await closePgPool(); } catch (_) {}
  process.exit(1);
});
