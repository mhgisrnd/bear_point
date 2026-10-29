require("dotenv").config();
const { Client } = require("pg");
const { PG_CONFIG } = require("../src/db/postgres");
const { SCHEMA_SQL } = require("../src/services/observationStore");
(async () => {
  const client = new Client({ ...PG_CONFIG, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    await client.query(SCHEMA_SQL);
    console.log("shared_observations schema ready");
  } catch (error) {
    console.error("Observation migration failed:", error.code || error.message);
    process.exitCode = 1;
  } finally { await client.end(); }
})();
