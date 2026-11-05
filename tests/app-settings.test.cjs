const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const Database = require('better-sqlite3');
const { createStore, normalizeTeams } = require('../public/js/settings/app-settings-store');

function environment(native) {
  const web = new Map();
  const db = new Database(':memory:');
  const schema = { window: {} }; vm.runInNewContext(fs.readFileSync('public/js/db/sqlite-migrations.js','utf8'), schema);
  db.exec(schema.window.BearSQLiteConfig.migrations[17].join(';'));
  const win = {
    Capacitor: { isNativePlatform: () => native, Plugins: { CapacitorSQLite: {
      query: async ({statement,values}) => ({ values: db.prepare(statement).all(...values) }),
      run: async ({statement,values}) => { db.prepare(statement).run(...values); }
    } } },
    BearSQLite: { initialize: async () => ({ready:true}) },
    localStorage: {getItem:k=>web.get(k)||null,setItem:(k,v)=>web.set(k,v)},
    BEAR_RUNTIME_CONFIG:{realtimeApiBase:'https://admin.test/bear/api/realtime'},
    fetch:async()=>{throw new Error('offline');}
  };
  return {win,db,web};
}
for (const native of [false,true]) {
  test(`${native?'SQLite':'web'}: manual observation identity validates team metadata without creating a fixed profile`,async t=>{
    const {win,db}=environment(native);t.after(()=>db.close());
    const store=createStore(win);await store.load();
    const identity=await store.manualIdentity(' Field owner ','gurye');
    assert.deepEqual(identity,{owner:'Field owner',team_id:'gurye',team_name:'구례팀',team_color:'#16A34A'});
    assert.equal(store.snapshot().profile,null);
    const reboot=createStore(win);await reboot.load();assert.equal(reboot.snapshot().profile,null);
    await assert.rejects(()=>store.manualIdentity('','gurye'));
    await assert.rejects(()=>store.manualIdentity('Owner','missing'));
    await assert.rejects(()=>store.manualIdentity('x'.repeat(101),'gurye'));
  });
  test(`${native?'SQLite':'web'}: tracking options persist offline independently of profile and reject invalid/failed saves`,async t=>{
    const {win,db}=environment(native);t.after(()=>db.close());
    const store=createStore(win);await store.load();
    assert.deepEqual(store.snapshot().tracking,{interval_seconds:10});
    await store.save('Kim','gurye');
    await store.saveTracking({interval_seconds:'30',color:'#ab12ef'});
    const reboot=createStore(win);await reboot.load();
    assert.deepEqual(reboot.snapshot().tracking,{interval_seconds:30});
    assert.equal(reboot.snapshot().profile.owner,'Kim');
    await assert.rejects(()=>reboot.saveTracking({interval_seconds:0,color:'#123456'}));
    await reboot.saveTracking({interval_seconds:30});
    if(native)win.Capacitor.Plugins.CapacitorSQLite.run=async()=>{throw new Error('disk full');};
    else win.localStorage.setItem=()=>{throw new Error('quota full');};
    await assert.rejects(()=>reboot.saveTracking({interval_seconds:60,color:'#FFFFFF'}),/full/);
    assert.equal(reboot.snapshot().tracking.interval_seconds,30);
  });
  test(`${native?'SQLite':'web'}: first setup, restart, profile edits and offline catalog preserve stored identity`, async t => {
    const {win,db}=environment(native);t.after(()=>db.close());
    const first=createStore(win);
    assert.equal((await first.load()).profile,null);
    assert.equal(first.snapshot().items.length,4);
    await assert.rejects(()=>first.refresh(),/offline/);
    await assert.rejects(()=>first.save(' ','gurye'),/담당자/);
    await assert.rejects(()=>first.save('Kim','unknown'),/팀/);
    const original=await first.save(' Kim ','gurye');assert.equal(original.owner,'Kim');
    const restart=createStore(win);assert.equal((await restart.load()).profile.team_id,'gurye');
    let url;
    win.fetch=async (path,options)=>{url=path;assert.equal(options.credentials,'omit');return {ok:true,json:async()=>({ok:true,items:[{id:'namwon',name:'남원 추적팀',color:'#123abc'}]})};};
    await restart.refresh();
    assert.equal(url,native?'https://admin.test/bear/api/teams':'api/app-realtime/teams');
    assert.deepEqual(restart.snapshot().profile,original);
    await assert.rejects(()=>restart.save('Other','gurye'),/팀/);
    await restart.save('Other','namwon');
    assert.equal(original.owner,'Kim');assert.equal(original.team_id,'gurye');
    const offline=createStore(win);await offline.load();
    assert.equal(offline.snapshot().source,'cache');assert.equal(offline.snapshot().items[0].color,'#123ABC');
    assert.equal(offline.snapshot().profile.owner,'Other');
    win.fetch=async()=>({ok:true,json:async()=>({ok:true,items:[]})});
    await offline.refresh();assert.equal(offline.snapshot().items.length,0);
    const empty=createStore(win);await empty.load();assert.equal(empty.snapshot().items.length,0);
  });
  test(`${native?'SQLite':'web'}: failed writes do not report saved profile or replace catalog`,async t=>{
    const {win,db}=environment(native);t.after(()=>db.close());
    const store=createStore(win);await store.load();
    if(native)win.Capacitor.Plugins.CapacitorSQLite.run=async()=>{throw new Error('disk full');};
    else win.localStorage.setItem=()=>{throw new Error('quota full');};
    await assert.rejects(()=>store.save('Kim','gurye'),/full/);assert.equal(store.snapshot().profile,null);
    win.fetch=async()=>({ok:true,json:async()=>({ok:true,items:[]})});
    await assert.rejects(()=>store.refresh(),/full/);assert.equal(store.snapshot().items.length,4);
  });
}
test('invalid and duplicate team catalog cannot erase valid cache',()=>{
  for(const value of [null,{},[{id:'gurye',name:'Team',color:'red'}],[{id:'a',name:'A',color:'#123456'},{id:'a',name:'B',color:'#123456'}]])assert.throws(()=>normalizeTeams(value));
});
test('settings migration leaves existing observation and estimate records unchanged',()=>{
  const db=new Database(':memory:');
  try {
    db.exec("CREATE TABLE observations (id TEXT,owner TEXT); INSERT INTO observations VALUES ('old','Original owner'); CREATE TABLE bear_estimates (id TEXT,owner TEXT); INSERT INTO bear_estimates VALUES ('pending','Other owner');");
    const context={window:{}};vm.runInNewContext(fs.readFileSync('public/js/db/sqlite-migrations.js','utf8'),context);
    db.exec(context.window.BearSQLiteConfig.migrations[17].join(';'));
    assert.equal(db.prepare('SELECT owner FROM observations').get().owner,'Original owner');
    assert.equal(db.prepare('SELECT owner FROM bear_estimates').get().owner,'Other owner');
  } finally {db.close();}
});
test('SQLite initialization is shared by concurrent startup callers',async()=>{
  let release, copies=0;
  const gate=new Promise(resolve=>{release=resolve;});
  const context={window:{BearSQLiteConfig:{dbVersion:17},Capacitor:{getPlatform:()=> 'android',isNativePlatform:()=>true,Plugins:{CapacitorSQLite:{
    copyFromAssets:async()=>{copies++;await gate;},isDBExists:async()=>({result:true}),createConnection:async()=>{},open:async()=>{},getVersion:async()=>({version:17})
  }}}},console};
  vm.runInNewContext(fs.readFileSync('public/js/db/sqlite-init.js','utf8'),context);
  const first=context.window.BearSQLite.initialize(), second=context.window.BearSQLite.initialize();
  assert.equal(first,second);release();assert.equal((await first).ready,true);assert.equal(copies,1);
});
