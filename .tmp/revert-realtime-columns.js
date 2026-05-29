const { pgQuery, closePgPool } = require('../src/db/postgres');
(async () => {
  await pgQuery(`
    ALTER TABLE bear_estimates_realtime
    DROP COLUMN IF EXISTS source_observation_ids,
    DROP COLUMN IF EXISTS source_observations_json,
    DROP COLUMN IF EXISTS analysis_rays_json,
    DROP COLUMN IF EXISTS intersections_json,
    DROP COLUMN IF EXISTS analysis_options_json,
    DROP COLUMN IF EXISTS analysis_diagnostics_json
  `);
  const result = await pgQuery("SELECT column_name FROM information_schema.columns WHERE table_name = 'bear_estimates_realtime' ORDER BY ordinal_position");
  console.log(JSON.stringify(result.rows.map((row) => row.column_name)));
  await closePgPool();
  process.exit(0);
})().catch(async (error) => {
  console.error(error && error.stack ? error.stack : String(error));
  try { await closePgPool(); } catch (_) {}
  process.exit(1);
});
