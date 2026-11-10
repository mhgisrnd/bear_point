const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const { createLocalStore, merge } = require('../public/js/realtime/bear-estimate-store');

test('SQLite upgrade backfills known methods and keeps unknown records unclassified', () => {
  const context = { window: {} };
  vm.runInNewContext(fs.readFileSync('public/js/db/sqlite-migrations.js', 'utf8'), context);
  const db = new Database(':memory:');
  try {
    db.exec('CREATE TABLE bear_estimates (id TEXT, analysis_options_json TEXT, source_observations_json TEXT, intersections_count INTEGER)');
    const insert = db.prepare('INSERT INTO bear_estimates VALUES (?,?,?,?)');
    insert.run('single', '{"estimationMethod":"single"}', null, 0);
    insert.run('old', null, '[{},{}]', 1);
    insert.run('unknown', 'invalid', null, 0);
    for (const sql of context.window.BearSQLiteConfig.migrations[20]) db.exec(sql);
    assert.deepEqual(db.prepare('SELECT estimation_method FROM bear_estimates').all().map(r => r.estimation_method), ['single', 'intersection', null]);
    assert.throws(() => db.exec("UPDATE bear_estimates SET estimation_method='invalid'"));
  } finally { db.close(); }
});

test('method survives local save, reopening and shared receipt merge', async () => {
  const data = new Map();
  const window = { localStorage: { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) } };
  await createLocalStore(window).insert({ id: 'a', lat: 37, lng: 127, estimation_method: 'single' });
  const local = await createLocalStore(window).list();
  assert.equal(local[0].estimation_method, 'single');
  const rows = merge(local, [{ id: 1, bear_estimate_id: 'a', lat: 37, lng: 127, estimation_method: 'single' }]);
  assert.equal(rows[0].estimation_method, 'single');
});
