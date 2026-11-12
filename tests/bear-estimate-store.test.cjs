const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { merge, createStore, originId } = require('../public/js/realtime/bear-estimate-store');
const receipt = (id, origin, extra = {}) => ({ id, bear_estimate_id: origin, bear_code: 'KF-58', lat: 35.3, lng: 127.7, uploaded_at: '2026-10-29 10:00:00', ...extra });
const draft = id => ({ id, bear_code: 'KF-58', lat: 35, lng: 127, created_at: '2026-10-28', source_observations: [{ id: 'observation-a' }] });

test('cleanup removes expired shared originals and disk cache; server-only rows remain queryable in memory',async()=>{
  const {createLocalStore}=require('../public/js/realtime/bear-estimate-store');
  const previous=global.BearStorageCleanup;global.BearStorageCleanup={older:stamp=>String(stamp).startsWith('2020')};
  try{
    const data=new Map(),window={localStorage:{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)}};
    const local=createLocalStore(window),cache=createStore(window);
    await local.insert({id:'a',bear_code:'A',lat:35,lng:127,source_observations_json:'[{"id":"o"}]'});
    await local.insert({id:'unsent',bear_code:'A',lat:35,lng:127});
    await local.markShared(['a'],'2020-01-01');
    const payload=(await local.list()).find(row=>row.id==='a');
    await cache.accept([receipt(1,'a',{uploaded_at:'2020-01-01',payload})],{complete:true});
    assert.equal((await cache.cleanup(Date.now(),local)).estimates,1);
    assert.deepEqual((await local.list()).map(row=>row.id),['unsent']);
    assert.equal(cache.merge(await local.list()).find(row=>row.id==='a').source_observations.length,1);
    const reopened=createStore(window);await reopened.load();
    assert.equal(reopened.merge([]).length,0,'expired shared cache must not survive an offline restart');
    await reopened.accept([receipt(1,'a',{uploaded_at:'2020-01-01',payload})],{complete:true});
    assert.equal(reopened.merge([])[0].source_observations.length,1,'online refresh restores the server result');
    assert.deepEqual(JSON.parse(data.get('bearpoint.remote-estimates.v1')),[],'online refresh does not put expired data back on disk');
  }finally{global.BearStorageCleanup=previous;}
});

test('recent live receipt overrides an old tombstone and incomplete payload cannot remove local analysis',async()=>{
  const {createLocalStore}=require('../public/js/realtime/bear-estimate-store');
  const previous=global.BearStorageCleanup;global.BearStorageCleanup={older:stamp=>String(stamp).startsWith('2020')};
  try{
    const data=new Map(),window={localStorage:{getItem:key=>data.get(key)||null,setItem:(key,value)=>data.set(key,value)}};
    const local=createLocalStore(window);await local.insert({id:'a',bear_code:'A',lat:35,lng:127});await local.markShared(['a'],'2020-01-01');
    const payload=(await local.list())[0];
    assert.equal(await local.removeSharedCopies([receipt(0,'a',{uploaded_at:'2020-01-01',_cacheDeleted:true})],Date.now()),0,'absence from active list cannot authorize deleting the original');
    assert.equal(await local.removeSharedCopies([receipt(1,'a',{uploaded_at:'2020-01-01',_cacheDeleted:true}),receipt(2,'a',{uploaded_at:'2026-11-12',payload})],Date.now()),0);
    assert.equal(await local.removeSharedCopies([receipt(3,'a',{uploaded_at:'2020-01-01',payload:{id:'a'}})],Date.now()),0);
    assert.equal((await local.list()).length,1);
  }finally{global.BearStorageCleanup=previous;}
});

test('complete snapshot hides legacy shared local records absent from server without deleting originals', async () => {
  const data = new Map();
  const window = { localStorage: { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) } };
  const store = createStore(window);
  const local = [{ ...draft('old'), shared_at: '2026-10-29' }, draft('unshared')];
  await store.load();
  assert.equal(store.merge(local).length, 2, 'offline startup retains local history');
  await store.accept([receipt(55, 'current', { payload: { team_name: 'Regional' } })], { complete: false });
  assert.equal(store.merge(local).length, 3, 'partial responses do not hide history');
  await store.accept([receipt(55, 'current', { payload: { team_name: 'Regional' } })], { complete: true });
  const visible = store.merge(local);
  assert.deepEqual(visible.map(row => row.id).sort(), ['current', 'unshared']);
  assert.equal(visible.find(row => row.id === 'current').team_name, 'Regional');
  assert.equal(local.length, 2, 'original local records are preserved');
  await store.accept([], { complete: true });
  assert.deepEqual(store.merge(local).map(row => row.id), ['unshared']);
});

test('merge uses source IDs, preserves separate results for the same animal and collapses repeated receipts', () => {
  const rows = merge([draft('a'), draft('b')], [receipt(1, 'a'), receipt(2, 'a', { owner: 'updated' }), receipt(3, 'c')]);
  assert.equal(rows.length, 3);
  const a = rows.find(row => row.id === 'a');
  assert.equal(a.owner, 'updated');
  assert.equal(a.server_id, '2');
  assert.equal(a.local_id, 'a');
  assert.equal(a.remoteOnly, false);
  assert.ok(a.shared_at);
  assert.deepEqual(a.source_observations, [{ id: 'observation-a' }]);
  assert.equal(rows.find(row => row.id === 'b').shared_at, undefined);
  assert.equal(rows.find(row => row.id === 'c').isRealtime, true);
  assert.equal(merge([draft('1')], [receipt(1, null)]).length, 2);
  assert.equal(originId({ payload: '{"id":"source"}' }), 'source');
});

test('browser cache survives reopening, partial responses retain other rows and complete snapshots remove deleted results', async () => {
  const storage = new Map();
  const window = { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
  const store = createStore(window);
  await store.accept([receipt(1, 'a'), receipt(2, 'b')], { complete: true });
  await store.accept([receipt(3, 'c')]);
  const reopened = createStore(window);
  await reopened.load();
  assert.equal(reopened.merge([]).length, 3);
  await reopened.accept([receipt(3, 'c')], { complete: true });
  assert.deepEqual(reopened.merge([draft('a')]).map(row => row.id), ['c']);
  await reopened.accept([receipt(4, 'a')]);
  assert.ok(reopened.merge([draft('a')]).some(row => row.id === 'a'));
});

test('active receipts win over missing duplicate receipts; stale snapshots cannot remove a just uploaded receipt', async () => {
  const store = createStore({ localStorage: { getItem: () => null, setItem() {} } });
  await store.accept([receipt(1, 'a'), receipt(2, 'a')]);
  await store.accept([receipt(1, 'a')], { complete: true });
  assert.equal(store.merge([draft('a')]).length, 1);
  await store.accept([receipt(3, 'b')]);
  await store.accept([receipt(1, 'a')], { complete: true, requestedAt: 1 });
  assert.equal(store.merge([]).length, 2);
});

test('SQLite migration and cache persist offline and handle an empty initial snapshot', async () => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  const window = {};
  vm.runInNewContext(fs.readFileSync('public/js/db/sqlite-migrations.js', 'utf8'), { window });
  const statements = window.BearSQLiteConfig.migrations[15];
  statements.forEach(statement => db.exec(statement));
  window.Capacitor = { isNativePlatform: () => true, Plugins: { CapacitorSQLite: {
    query: async ({ statement }) => ({ values: db.prepare(statement).all() }),
    executeSet: async ({ set }) => db.transaction(() => set.forEach(({ statement, values }) => db.prepare(statement).run(...values)))()
  } } };
  window.BearSQLite = { initialize: async () => ({ ready: true }) };
  const store = createStore(window);
  await store.accept([], { complete: true });
  await store.accept([receipt(1, 'a')]);
  const offline = createStore(window);
  await offline.load();
  assert.equal(offline.merge([draft('a')]).length, 1);
  assert.ok(offline.merge([draft('a')])[0].shared_at);
  db.close();
});
