const {test}=require('node:test'),assert=require('node:assert/strict');
const {create,endpoint,notice}=require('../public/js/tracking/gps-track-sync');
function fixture({failure=false,count=1}={}) {
 const calls=[],saved=new Map(),tracks=Array.from({length:count},(_,i)=>({id:'id-'+i,status:'saved',owner:'Kim',point_count:1,points:[{lat:35,lng:127,accuracy:5,recorded_at:1}]}));
 const win={fetch(){},setTimeout,clearTimeout,localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)}};
 const plugin={status:async()=>({}),list:async({offset})=>({items:tracks.slice(offset,offset+30)}),detail:async({id})=>tracks.find(t=>t.id===id)};
 const fetchImpl=async(url,options)=>{calls.push({url,options});if(failure)throw new Error('offline');return {ok:true,json:async()=>({ok:true,id:JSON.parse(options.body).id})};};
 return {sync:create({win,plugin,fetchImpl}),calls,saved,tracks,win};
}
test('uploads all history pages once and concurrent syncs share a single request',async()=>{
 const f=fixture({count:32});const a=f.sync.sync(),b=f.sync.sync();assert.equal(a,b);
 assert.equal((await a).uploaded,32);assert.equal(f.calls.length,32);await f.sync.sync();assert.equal(f.calls.length,32);
 assert.equal(f.calls[0].options.credentials,'omit');assert.equal(f.calls[0].url,'api/app-realtime/movement-tracks');
 assert.deepEqual(JSON.parse(f.calls[0].options.body).points,[{lat:35,lng:127,accuracy:5,recorded_at:1}]);
});
test('failed and malformed responses leave device records unacknowledged',async()=>{
 const f=fixture({failure:true});await assert.rejects(f.sync.sync(),/기기 기록을 보존/);assert.equal(f.saved.size,0);assert.equal(f.tracks.length,1);
 await assert.rejects(f.sync.sync());assert.equal(f.calls.length,2);
 const g=fixture();const bad=create({win:g.win,plugin:{status:async()=>({}),list:async()=>({items:g.tracks}),detail:async()=>g.tracks[0]},fetchImpl:async()=>({ok:true,json:async()=>({ok:true,id:'wrong'})})});
 await assert.rejects(bad.sync());assert.equal(g.saved.size,0);
});
test('recording records stay local and native uses the explicit movement endpoint',async()=>{
 const f=fixture();f.tracks[0].status='recording';assert.equal((await f.sync.sync()).uploaded,0);assert.equal(f.calls.length,0);
 assert.equal(endpoint({Capacitor:{isNativePlatform:()=>true},BEAR_RUNTIME_CONFIG:{movementApiUrl:'https://admin.test/api/realtime/movement-tracks'}}),'https://admin.test/api/realtime/movement-tracks');
});
test('a rejected legacy record stays local and does not block later uploads',async()=>{
 const f=fixture({count:2}), attempts=[];
 const plugin={status:async()=>({}),list:async()=>({items:f.tracks}),detail:async({id})=>f.tracks.find(track=>track.id===id)};
 const sync=create({win:f.win,plugin,fetchImpl:async(_url,options)=>{
  const {id}=JSON.parse(options.body);attempts.push(id);
  return id==='id-0'?{status:400,ok:false,json:async()=>({message:'기록 간격을 확인해 주세요.'})}
   :{ok:true,json:async()=>({ok:true,id})};
 }});
 await assert.rejects(sync.sync(),/1건 전송 완료 · 1건 전송 실패/);
 assert.equal(sync.acknowledged('id-0'),false);
 assert.equal(sync.acknowledged('id-1'),true);
 assert.equal(f.tracks.length,2);
 await assert.rejects(sync.sync(),/기록 간격/);
 assert.deepEqual(attempts,['id-0','id-1','id-0']);
});
test('an unexposed server route reports the deployment failure',async()=>{
 const f=fixture();
 const sync=create({win:f.win,plugin:{},fetchImpl:async()=>({
  ok:false,status:403,json:async()=>({message:'허용되지 않은 모바일 API 요청입니다.'})
 })});
 await assert.rejects(sync.refreshShared(),/서버 배포 상태/);
});
test('empty GPS sessions are skipped even if a legacy store lists them as saved',async()=>{
 const f=fixture();f.tracks[0].point_count=0;f.tracks[0].points=[];
 const result=await f.sync.sync();assert.equal(result.uploaded,0);assert.equal(result.eligible,0);assert.equal(result.skipped,1);assert.equal(f.calls.length,0);
 assert.equal(notice(result),'');assert.equal(notice(result,true),'전송할 이동 기록이 없습니다.');
 const g=fixture();g.tracks[0].points=[];await assert.rejects(g.sync.sync(),/GPS 좌표/);assert.equal(g.calls.length,0);
});
test('old receipts are rechecked against the server and deleted records stay hidden without removing local data',async()=>{
 const f=fixture({count:3}), sent=[];
 const [shared,missing,deleted]=f.tracks;
 for(const row of f.tracks)f.win.localStorage.setItem('bearpoint.gps-uploaded.'+row.id,'1');
 missing.point_count=3;
 const plugin={status:async()=>({}),list:async()=>({items:f.tracks}),detail:async({id})=>f.tracks.find(row=>row.id===id)};
 const fetchImpl=async(_url,options)=>{
  if(options.method==='POST'){
   const {id,point_count}=JSON.parse(options.body);sent.push(id);assert.equal(point_count,1);
   return {ok:true,json:async()=>({ok:true,id,deleted:id===deleted.id})};
  }
  return {ok:true,json:async()=>({ok:true,total:1,pageSize:100,items:[shared]})};
 };
 const sync=create({win:f.win,plugin,fetchImpl});
 await sync.refreshShared();
 assert.equal((await sync.sync()).uploaded,1);
 assert.deepEqual(sent,[missing.id,deleted.id]);
 assert.deepEqual((await sync.list({})).items.map(row=>row.id).sort(),[missing.id,shared.id].sort());
 assert.equal(f.tracks.length,3);
 assert.equal((await create({win:f.win,plugin,fetchImpl}).list({})).total,2);
});
test('upload acknowledgements never remove local history, including after reinitializing the sync client',async()=>{
 const f=fixture(),before=JSON.stringify(f.tracks);await f.sync.sync();assert.equal(JSON.stringify(f.tracks),before);
 const plugin={status:async()=>({}),list:async()=>({items:f.tracks}),detail:async()=>f.tracks[0]};
 const restart=create({win:f.win,plugin,fetchImpl:async()=>{throw new Error('unexpected duplicate upload');}});
 const result=await restart.sync();assert.equal(result.eligible,1);assert.equal(result.uploaded,0);assert.equal(JSON.stringify(f.tracks),before);
 assert.equal(notice(result),'');assert.equal(notice(result,true),'미전송 기록이 없습니다.');
});
test('failure to persist an acknowledgement is reported as retryable rather than all transmitted',async()=>{
 const f=fixture();f.win.localStorage.setItem=()=>{throw new Error('quota');};
 const result=await f.sync.sync();assert.equal(result.uploaded,1);assert.equal(result.remaining,1);assert.match(notice(result),/보관하지 못했습니다/);
 assert.equal(f.tracks.length,1);
});
test('shared history merges server pages with local tracks, stays available offline, and fetches shared details',async()=>{
 const f=fixture();
 const local=f.tracks[0];
 const remote={id:'other-device',owner:'서버 담당자',team_id:'gurye',started_at:20,point_count:1,status:'saved'};
 let offline=false;
 const requests=[];
 f.win.Capacitor={isNativePlatform:()=>true,Plugins:{}};
 const client=create({win:f.win,plugin:{list:async()=>({items:f.tracks})},fetchImpl:async(url,options)=>{
  requests.push({url,options});
  if(offline)throw new Error('offline');
  const data=url.endsWith('/other-device')?{...remote,points:local.points}:{
   ok:true,total:2,pageSize:1,items:[url.endsWith('page=1')?remote:{...local,owner:'server duplicate'}]
  };
  return {ok:true,json:async()=>data};
 }});
 await client.refreshShared();
 assert.deepEqual((await client.list({})).items.map(row=>[row.id,!!row.sharedOnly]),[[remote.id,true],[local.id,false]]);
 assert.equal((await client.list({team_id:'gurye'})).total,1);
 assert.equal((await client.list({owner:'Kim'})).total,1);
 assert.deepEqual((await client.sharedDetail(remote.id)).points,local.points);
 assert.ok(requests.every(({options})=>options.headers['X-Firebase-AppCheck']===undefined&&options.credentials==='omit'));
 offline=true;
 await assert.rejects(client.refreshShared(),/offline/);
 assert.equal((await client.list({})).total,2);
});
