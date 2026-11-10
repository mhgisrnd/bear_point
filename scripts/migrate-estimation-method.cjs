require('dotenv').config({ quiet: true });
const { Client } = require('pg');
const { PG_CONFIG } = require('../src/db/postgres');
const sql = `
ALTER TABLE bear_estimates_realtime ADD COLUMN IF NOT EXISTS estimation_method TEXT
  CHECK (estimation_method IN ('single', 'intersection'));
UPDATE bear_estimates_realtime SET estimation_method = CASE
  WHEN analysis_options->>'estimationMethod' IN ('single','intersection') THEN analysis_options->>'estimationMethod'
  WHEN jsonb_typeof(source_observations) = 'array' THEN CASE
    WHEN jsonb_array_length(source_observations) = 1 THEN 'single'
    WHEN jsonb_array_length(source_observations) > 1 OR intersections_count > 0 THEN 'intersection'
    ELSE NULL END
  WHEN intersections_count > 0 THEN 'intersection'
  ELSE NULL END
WHERE estimation_method IS NULL;
`;
async function migrate() {
  const client = new Client({ ...PG_CONFIG, connectionTimeoutMillis: 5000, statement_timeout: 30000 });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query(sql);
    const result = await client.query('SELECT estimation_method, COUNT(*)::int AS count FROM bear_estimates_realtime GROUP BY estimation_method');
    await client.query('COMMIT');
    console.log(JSON.stringify(result.rows));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Estimation method migration failed:', error.code || error.message);
    process.exitCode = 1;
  } finally { await client.end(); }
}
if (require.main === module) migrate();
module.exports = { sql };
