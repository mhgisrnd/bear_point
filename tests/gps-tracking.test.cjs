const {test}=require('node:test');
const assert=require('node:assert/strict');
const {sample,createWebRecorder}=require('../public/js/tracking/gps-track-store');
const clone=value=>JSON.parse(JSON.stringify(value));
function environment(saved=[]) {
  const rows=new Map(saved.map(row=>[row.id,clone(row)])),points=new Map(saved.map(row=>[row.id,clone(row.points||[])]));
  let listener,errorListener,watching=false,failAppend=false,failPut=false;
  const callbacks={};
  const repo={
    list:async()=>[...rows.values()].map(clone),
    put:async track=>{if(failPut)throw new Error('disk full');rows.set(track.id,clone(track));},
    detail:async id=>rows.has(id)?{...clone(rows.get(id)),points:clone(points.get(id)||[])}:null,
    append:async(track,point)=>{if(failAppend)throw new Error('disk full');rows.set(track.id,clone(track));points.set(track.id,[...(points.get(track.id)||[]),clone(point)]);}
  };
  const win={crypto:{randomUUID:()=> 'track-one'},addEventListener:(type,fn)=>{callbacks[type]=fn;},navigator:{
    locks:{request:(_name,_options,fn)=>Promise.resolve().then(()=>fn({}))},
    geolocation:{watchPosition:(fn,error)=>{listener=fn;errorListener=error;watching=true;return 1;},clearWatch:()=>{watching=false;}}
  }};
  const recorder=createWebRecorder(win,repo);
  return {recorder,rows,callbacks,emit:position=>listener(position),deny:()=>errorListener({code:1,message:'denied'}),watching:()=>watching,
    failAppend:()=>{failAppend=true;},failPut:value=>{failPut=value;}};
}
const options={owner:'Kim',team_id:'gurye',team_name:'구례팀',team_color:'#16A34A',interval_seconds:10,color:'#9333EA'};
const pos=(time,lat=35,lng=127,accuracy=5)=>({timestamp:time,coords:{latitude:lat,longitude:lng,accuracy}});
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('read-only web history never acquires a recording lock or changes existing tracks',async()=>{
  const row={id:'existing',status:'recording',point_count:1,started_at:100,points:[{lat:35,lng:127}]};
  const win={navigator:{locks:{request(){assert.fail('read-only pages must not acquire the recorder lock');}}},addEventListener(){}};
  const recorder=createWebRecorder(win,{list:async()=>[row],detail:async()=>row,put(){assert.fail('history reads must not rewrite records');}},{readOnly:true});
  assert.equal((await recorder.status()).other_tab,false);
  assert.equal((await recorder.list()).total,1);
  assert.equal((await recorder.detail({id:'existing'})).id,'existing');
  await assert.rejects(recorder.start({}));
});

test('web history remains readable when recording locks are unavailable',async()=>{
  const row={id:'saved',status:'saved',point_count:1,started_at:100,points:[{lat:35,lng:127}]};
  const recorder=createWebRecorder({navigator:{},addEventListener(){}},{
    list:async()=>[row],detail:async()=>row
  });
  assert.equal((await recorder.list()).total,1);
  assert.equal((await recorder.detail({id:'saved'})).points.length,1);
  assert.equal((await recorder.status()).other_tab,false);
  await assert.rejects(recorder.start(options),/이 브라우저에서는 이동 기록을 지원하지 않습니다/);
});

test('10m distance threshold stays fixed even when either GPS fix has a larger accuracy radius',()=>{
  const now=Date.now();
  for(const accuracy of [5,30,80,100]){
    const last={lat:35,lng:127,accuracy,recorded_at:now-10000};
    assert.equal(sample(last,pos(now,35.00008,127,accuracy),5,now),null);
    assert.ok(sample(last,pos(now,35.0001,127,accuracy),5,now));
  }
  assert.equal(sample(null,pos(now,35,127,101),5,now),null);
});

test('Android and web recording thresholds remain consistent',()=>{
  const {RECORDING_CONFIG}=require('../public/js/tracking/gps-track-store');
  const java=require('node:fs').readFileSync('android/app/src/main/java/com/bearpoint/app/GpsTrackConfig.java','utf8');
  for(const [native,key]of [['MIN_DISTANCE_METERS','minDistanceMeters'],['MAX_ACCURACY_METERS','maxAccuracyMeters'],['MAX_LOCATION_AGE_MS','maxLocationAgeMs'],['MAX_SPEED_METERS_PER_SECOND','maxSpeedMetersPerSecond']]){
    assert.equal(Number(java.match(new RegExp(native+' = (\\d+)'))[1]),RECORDING_CONFIG[key]);
  }
});

test('GPS samples reject stale, inaccurate, out-of-order, too-frequent and implausible jumps',()=>{
  const now=Date.now(),last={lat:35,lng:127,recorded_at:now-10000};
  assert.equal(sample(last,pos(now,36),10,now),null);
  assert.equal(sample(last,pos(now-5000),10,now),null);
  assert.equal(sample(last,pos(now,35,127,101),10,now),null);
  assert.equal(sample(null,pos(now-61000),10,now),null);
  assert.equal(sample(null,pos(now,NaN),10,now),null);
  assert.equal(sample(last,pos(now,35,127),10,now),null);
  const valid=sample(last,pos(now,35.0001,127),10,now);
  assert.ok(valid.meters>10&&valid.meters<12);
});

test('offline recorder saves samples before reporting them and stores start-time identity/options',async()=>{
  const env=environment(), now=Date.now();
  const started=await env.recorder.start(options);assert.equal(started.point_count,0);
  options.owner='Changed';options.color='#FFFFFF';
  env.emit(pos(now));env.emit(pos(now+10000,35.0001));await settle();
  assert.equal((await env.recorder.status()).active.point_count,2);
  const ended=await env.recorder.stop();assert.equal(ended.status,'saved');assert.equal(env.watching(),false);
  assert.equal(ended.owner,'Kim');assert.equal(ended.color,options.team_color);
  assert.equal((await env.recorder.detail({id:ended.id})).points.length,2);
  assert.equal((await env.recorder.status()).active,null);
});

test('duplicate starts, permission denial and failed writes do not claim successful recording',async()=>{
  const env=environment();await env.recorder.start(options);
  await assert.rejects(()=>env.recorder.start(options),/이미/);
  env.deny();await settle();assert.equal(env.watching(),false);
  assert.equal((await env.recorder.status()).active,null);
  assert.equal(env.rows.get('track-one').status,'discarded');
  const disk=environment();await disk.recorder.start(options);disk.failAppend();disk.emit(pos(Date.now()));await settle();
  assert.equal(disk.watching(),false);assert.equal(disk.rows.get('track-one').point_count,0);
  assert.equal(disk.rows.get('track-one').status,'discarded');
  const stop=environment();await stop.recorder.start(options);stop.failPut(true);
  await assert.rejects(()=>stop.recorder.stop(),/full/);
  assert.equal((await stop.recorder.status()).active.status,'recording');
  stop.failPut(false);assert.equal((await stop.recorder.stop()).status,'discarded');
});

test('reopening preserves interrupted paths and another browser tab cannot start recording',async()=>{
  const env=environment([{...options,id:'old',started_at:1000,status:'recording',point_count:1,points:[{lat:35,lng:127,recorded_at:2000,accuracy:5}]}]);
  await env.recorder.status();assert.equal(env.rows.get('old').status,'interrupted');assert.equal(env.rows.get('old').ended_at,2000);
  const other=createWebRecorder({navigator:{locks:{request:(_n,_o,fn)=>Promise.resolve(fn(null))},geolocation:{}},addEventListener:()=>{}},{});
  await assert.rejects(()=>other.start(options),/다른 창/);
  env.callbacks.pagehide();assert.equal(env.watching(),false);
});
test('zero-fix sessions and legacy empty rows are never included in history or counts',async()=>{
  const env=environment([{...options,id:'legacy',started_at:1000,status:'saved',point_count:0}]);
  await env.recorder.start(options);const ended=await env.recorder.stop();
  assert.equal(ended.status,'discarded');assert.match(ended.error,/GPS 위치가 수신되지 않아/);
  assert.equal(env.watching(),false);assert.equal((await env.recorder.list()).total,0);
  const reboot=environment([{...options,id:'pending',started_at:1000,status:'recording',point_count:0}]);
  await reboot.recorder.status();assert.equal(reboot.rows.get('pending').status,'discarded');
  assert.equal((await reboot.recorder.list()).items.length,0);
});
test('stationary fixes do not build a zigzag path; a real movement resumes the route',async()=>{
  const env=environment(),now=Date.now();await env.recorder.start(options);
  env.emit(pos(now));env.emit(pos(now+10000));env.emit(pos(now+20000,35.000001,127));env.emit(pos(now+30000,35.000003,127,8));await settle();
  let track=await env.recorder.detail({id:'track-one'});assert.equal(track.point_count,1);assert.equal(track.distance,0);
  env.emit(pos(now+40000,35.0002,127));await settle();
  track=await env.recorder.detail({id:'track-one'});assert.equal(track.point_count,2);assert.ok(track.distance>20&&track.distance<23);
  assert.equal((await env.recorder.stop()).status,'saved');
  const stayed=environment();await stayed.recorder.start(options);stayed.emit(pos(now));await settle();
  const ended=await stayed.recorder.stop();assert.equal(ended.status,'saved');assert.equal(ended.point_count,1);assert.equal(ended.distance,0);
});

test('changing a running interval preserves the route and applies shorter and longer sampling immediately',async()=>{
  const env=environment(),now=Date.now();
  const started=await env.recorder.start({...options,owner:'Original',interval_seconds:30});
  env.emit(pos(now));await settle();
  env.emit(pos(now+10000,35.0001));await settle();
  assert.equal((await env.recorder.status()).active.point_count,1);
  await env.recorder.updateInterval({interval_seconds:5});
  env.emit(pos(now+10000,35.0001));await settle();
  assert.equal((await env.recorder.status()).active.point_count,2);
  await env.recorder.updateInterval({interval_seconds:30});
  env.emit(pos(now+20000,35.0002));await settle();
  assert.equal((await env.recorder.status()).active.point_count,2);
  env.emit(pos(now+40000,35.0003));await settle();
  const track=await env.recorder.detail({id:started.id});
  assert.equal(track.point_count,3);assert.equal(track.interval_seconds,30);
  assert.equal(track.id,started.id);assert.equal(track.started_at,started.started_at);
  assert.equal(track.owner,'Original');assert.equal(track.color,started.color);
  assert.equal(track.points[0].recorded_at,now);assert.ok(track.distance>30);
  assert.equal((await env.recorder.stop()).point_count,3);
  assert.equal((await env.recorder.updateInterval({interval_seconds:10})).active,null);
});

test('failed or invalid interval changes leave a running recorder and its sampling unchanged',async()=>{
  const env=environment(),now=Date.now();
  await env.recorder.start({...options,interval_seconds:30});env.emit(pos(now));await settle();
  await assert.rejects(()=>env.recorder.updateInterval({interval_seconds:1}));
  env.failPut(true);
  await assert.rejects(()=>env.recorder.updateInterval({interval_seconds:5}),/disk full/);
  assert.equal((await env.recorder.status()).active.interval_seconds,30);
  assert.equal(env.watching(),true);
  env.failPut(false);env.emit(pos(now+10000,35.0001));await settle();
  assert.equal((await env.recorder.status()).active.point_count,1);
});
