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
test('empty GPS sessions are skipped even if a legacy store lists them as saved',async()=>{
 const f=fixture();f.tracks[0].point_count=0;f.tracks[0].points=[];
 const result=await f.sync.sync();assert.equal(result.uploaded,0);assert.equal(result.eligible,0);assert.equal(result.skipped,1);assert.equal(f.calls.length,0);
 assert.equal(notice(result),'');assert.equal(notice(result,true),'전송할 이동 기록이 없습니다.');
 const g=fixture();g.tracks[0].points=[];assert.equal((await g.sync.sync()).eligible,0);assert.equal(g.calls.length,0);
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
