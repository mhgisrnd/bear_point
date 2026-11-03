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
  assert.equal(ended.owner,'Kim');assert.equal(ended.color,'#9333EA');
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
  env.emit(pos(now));env.emit(pos(now+10000));env.emit(pos(now+20000,35.00001,127));env.emit(pos(now+30000,35.00003,127,8));await settle();
  let track=await env.recorder.detail({id:'track-one'});assert.equal(track.point_count,1);assert.equal(track.distance,0);
  env.emit(pos(now+40000,35.0002,127));await settle();
  track=await env.recorder.detail({id:'track-one'});assert.equal(track.point_count,2);assert.ok(track.distance>20&&track.distance<23);
  assert.equal((await env.recorder.stop()).status,'saved');
  const stayed=environment();await stayed.recorder.start(options);stayed.emit(pos(now));await settle();
  const ended=await stayed.recorder.stop();assert.equal(ended.status,'saved');assert.equal(ended.point_count,1);assert.equal(ended.distance,0);
});
