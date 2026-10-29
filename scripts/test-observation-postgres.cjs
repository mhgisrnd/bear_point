require("dotenv").config();
const assert = require("node:assert/strict");
const { Client } = require("pg");
const { PG_CONFIG } = require("../src/db/postgres");
const { SCHEMA_SQL, createObservationStore } = require("../src/services/observationStore");
(async () => {
  const client = new Client({ ...PG_CONFIG, connectionTimeoutMillis: 5000 });
  try {
    await client.connect(); await client.query("BEGIN");
    // All test records live in a temporary table that shadows the real table.
    await client.query(SCHEMA_SQL.replace("CREATE TABLE IF NOT EXISTS shared_observations", "CREATE TEMP TABLE shared_observations"));
    const store = createObservationStore((...args) => client.query(...args));
    const data = { id: "obs-integration", bear_code: "bear", owner: "tester", place: "original", lat: 35, lng: 127, heading: 90, created_at: new Date().toISOString(), detectors: [] };
    const first = await store.insert(data); assert.equal(first.alreadyExists, false);
    const retry = await store.insert({ ...data, place: "must-not-overwrite" });
    assert.equal(retry.alreadyExists, true); assert.equal(retry.item.place, "original");
    const updated = await store.update(data.id, { ...data, place: "admin-edit", server_version: 1 }, "admin");
    assert.equal(updated.server_version, 2);
    await assert.rejects(() => store.update(data.id, { ...data, server_version: 1 }, "other"), error => error.statusCode === 409);
    const edit = { ...data, place: "app-edit", server_version: 2, mutation_id: "edit-test-123" };
    const appEdit = await store.revise(data.id, edit);
    assert.equal(appEdit.item.server_version, 3);
    assert.equal(appEdit.item.created_at.toISOString(), first.item.created_at.toISOString());
    const repeatedEdit = await store.revise(data.id, edit);
    assert.equal(repeatedEdit.alreadyExists, true);
    assert.equal(repeatedEdit.item.server_version, 3);
    await assert.rejects(() => store.revise(data.id, { ...edit, mutation_id: "edit-other-456" }), error => error.statusCode === 409 && error.item.place === "app-edit");
    await assert.rejects(() => store.revise(data.id, { ...edit, place: "different-payload" }), error => error.statusCode === 409);
    await store.update(data.id, { ...data, place: "new-admin-edit", server_version: 3 }, "admin");
    await assert.rejects(() => store.revise(data.id, edit), error => error.statusCode === 409 && error.item.server_version === 4);
    await assert.rejects(() => store.removeFromApp(data.id, 3), error => error.statusCode === 409 && error.item.server_version === 4);
    const deleted = await store.removeFromApp(data.id, 4); assert.equal(deleted.item.deleted, true);
    assert.equal((await store.removeFromApp(data.id, 4)).alreadyExists, true);
    await assert.rejects(() => store.revise(data.id, { ...edit, server_version: 5 }), error => error.statusCode === 409 && error.item.deleted);
    const repeated = await store.insert(data); assert.equal(repeated.item.deleted, true);
    assert.equal((await store.list()).items.length, 1);
    console.log("PostgreSQL observation integration passed (temporary records only)");
  } catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { await client.query("ROLLBACK").catch(() => {}); await client.end(); }
})();
