const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const Database=require('better-sqlite3');
const {createStore}=require('../public/js/settings/app-settings-store');
const {createLocalStore,merge}=require('../public/js/realtime/bear-estimate-store');
const observationSource=fs.readFileSync('public/js/obs/observation-sync.js','utf8');
function setup(native) {
  const db=new Database(':memory:'),storage=new Map(),config={window:{}};
  vm.runInNewContext(fs.readFileSync('public/js/db/sqlite-migrations.js','utf8'),config);
  db.exec('CREATE TABLE observations (id TEXT PRIMARY KEY,bear_code TEXT,owner TEXT,place TEXT,admin_region TEXT,lat REAL,lng REAL,heading REAL,detectors_json TEXT,created_at TEXT,updated_at TEXT)');
  const migrations=config.window.BearSQLiteConfig.migrations;
  for(const version of [7,8,11,13,14,16,17,18,19,20]) for(const sql of migrations[version])db.exec(sql);
  let transport=async()=>{throw new Error('offline');};
  const win={Capacitor:{isNativePlatform:()=>native,Plugins:{CapacitorSQLite:{
    run:async({statement,values})=>({changes:{changes:db.prepare(statement).run(...values).changes}}),
    executeSet:async({set})=>({changes:{changes:db.transaction(()=>set.reduce(
      (count,{statement,values})=>count+db.prepare(statement).run(...values).changes,0))()}}),
    query:async({statement,values})=>({values:db.prepare(statement).all(...values)})
  }}},BearSQLite:{initialize:async()=>({ready:true})},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)}};
  function observations() {
    vm.runInNewContext(observationSource,{window:win,fetch:(...args)=>transport(...args),AbortController,setTimeout,clearTimeout});
    return win.BearObservationSync;
  }
  return {db,win,observations,setTransport:fn=>{transport=fn;}};
}
for(const native of [false,true]) {
  test(`${native?'SQLite':'web'} registration survives offline restart and later sharing with original staff/team`,async t=>{
    const f=setup(native);t.after(()=>f.db.close());
    const settings=createStore(f.win);await settings.save('Original staff','gurye');
    const identity=await settings.identity();
    let sync=f.observations();
    await sync.saveDraft({id:'offline-observation',bearCode:'KF-58',place:'Site',lat:35,lng:127,heading:90,...identity},[]);
    assert.equal((await sync.upload('offline-observation')).ok,false);
    let estimates=createLocalStore(f.win);
    await estimates.insert({id:'offline-estimate',bear_code:'KF-58',place:'Result',lat:35.1,lng:127.1,created_at:'2026-11-02 12:00:00',...identity,share_pending:true});
    await settings.save('New staff','namwon');
    sync=f.observations();estimates=createLocalStore(f.win);
    assert.equal((await sync.find('offline-observation')).team_id,'gurye');
    await sync.saveDraft({id:'offline-observation',bearCode:'KF-58',place:'Edited',lat:35,lng:127,heading:90,...await settings.identity()},[],true);
    assert.equal((await sync.find('offline-observation')).owner,'Original staff');
    let posted;
    f.setTransport(async(url,options)=>{
      posted=JSON.parse(options.body);
      return {ok:true,json:async()=>({ok:true,item:{...posted,detectors_json:posted.detectors,server_version:1,deleted:false,updated_at:'2026-11-02T03:00:00Z',uploaded_at:'2026-11-02T03:00:00Z'}})};
    });
    assert.equal((await sync.upload('offline-observation')).ok,true);
    assert.equal(posted.owner,'Original staff');assert.equal(posted.team_id,'gurye');assert.equal(posted.team_color,'#16A34A');
    const recovered=(await estimates.list())[0];assert.equal(recovered.owner,'Original staff');assert.equal(recovered.team_name,'구례팀');assert.equal(recovered.share_pending,1);
    const source=fs.readFileSync('public/js/realtime/realtimeList.js','utf8');
    const el=()=>({dataset:{},style:{},classList:{add(){},remove(){}},addEventListener(){},setAttribute(){}});
    const document={body:el(),getElementById:()=>el()};
    const transportWindow={};let estimatePayload;
    vm.runInNewContext(source,{window:transportWindow,document,navigator:{},fetch:async(url,options)=>{
      estimatePayload=JSON.parse(options.body);
      return {ok:true,json:async()=>({ok:true,item:{...estimatePayload,id:'server-estimate',bear_estimate_id:recovered.id,payload:estimatePayload}})};
    }});
    const realtime=transportWindow.createRealtimeListModule({unified:true});
    const shared=await realtime.sendEstimate(recovered);assert.equal(shared.ok,true);
    assert.equal(estimatePayload.team_id,'gurye');assert.equal(estimatePayload.owner,'Original staff');
    await estimates.markShared([recovered.id],'2026-11-02 13:00:00');
    const restarted=(await createLocalStore(f.win).list())[0];assert.ok(restarted.shared_at);assert.equal(restarted.team_id,'gurye');assert.equal(restarted.share_pending,0);
    const merged=merge([restarted],[{id:'remote',bear_estimate_id:recovered.id,bear_code:'KF-58',owner:'Original staff',lat:35.1,lng:127.1,payload:estimatePayload}]);
    assert.equal(merged.length,1);assert.equal(merged[0].team_color,'#16A34A');
    await sync.saveDraft({id:'old-no-team',bearCode:'KF-47',owner:'Legacy staff',place:'Old',lat:35,lng:127,heading:90},[]);
    await sync.saveDraft({id:'old-no-team',bearCode:'KF-47',place:'Old edited',lat:35,lng:127,heading:90,...await settings.identity()},[],true);
    const legacy=await sync.find('old-no-team');assert.equal(legacy.owner,'Legacy staff');assert.equal(legacy.team_id,null);
  });
  test(`${native?'SQLite':'web'} estimate save failure cannot be mistaken for a successful save`,async t=>{
    const f=setup(native);t.after(()=>f.db.close());
    const estimates=createLocalStore(f.win);
    if(native)f.win.Capacitor.Plugins.CapacitorSQLite.run=async()=>{throw new Error('full');};
    else f.win.localStorage.setItem=()=>{throw new Error('full');};
    await assert.rejects(()=>estimates.insert({id:'failed',bear_code:'KF-58',lat:35,lng:127}),/full/);
    assert.equal((await estimates.list()).length,0);
  });
  test(`${native?'SQLite':'web'} estimate deletion only removes selected unshared rows`,async t=>{
    const f=setup(native);t.after(()=>f.db.close());
    const estimates=createLocalStore(f.win);
    for(const id of ['draft','shared','unselected']) {
      await estimates.insert({id,bear_code:'KF-58',lat:35,lng:127,created_at:'2026-11-02 12:00:00'});
    }
    await estimates.markShared(['shared'],'2026-11-02 13:00:00');
    assert.equal(await estimates.removeUnshared(['draft','shared','missing']),1);
    assert.deepEqual((await estimates.list()).map(row=>row.id).sort(),['shared','unselected']);
  });
}
test('observation payload uses fixed profile identity instead of an editable owner value',()=>{
  const source=fs.readFileSync('public/js/obs/obsRegister.js','utf8');
  const start=source.indexOf('  function buildObservationPayload('),end=source.indexOf('\n  //',start);
  const context=vm.createContext({regPlaceEl:{value:'Site'},regOwnerEl:{value:'Tampered'},regBearEl:{value:'KF-58'},latestLive:{lat:35,lng:127,heading:90},
    isManualEntryEnabled:()=>false,parseFiniteNumber:Number,parseHeadingNumber:Number,isHeadingLocked:false,generateObservationId:()=> 'id'});
  vm.runInContext(source.slice(start,end),context);
  const value=context.buildObservationPayload({owner:'Configured staff',team_id:'regional',team_name:'광역팀',team_color:'#9333EA'});
  assert.equal(value.owner,'Configured staff');assert.equal(value.team_id,'regional');
});
test('optional address lookup failure does not block offline coordinate registration',async()=>{
  const input={value:'',addEventListener(){}};
  const window={BearAdminBoundary:{lookup:async()=>{throw new Error('offline');}}};
  vm.runInNewContext(fs.readFileSync('public/js/db/editable-region-field.js','utf8'),{window,setTimeout,clearTimeout});
  const field=window.createEditableRegionField(input);
  assert.equal(await field.resolve(35,127),null);
  field.reset('Manual address');assert.equal(await field.resolve(35,127),'Manual address');
});
