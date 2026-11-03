const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const express=require('express');
const {createAppRealtimeRouter}=require('../src/routes/appRealtimeRoutes');
const source=fs.readFileSync('public/js/sdr/animal-catalog.js','utf8');
const row={id:'1',bear_code:'KF-110',frequency_a:'148.24150',frequency_b:'149.10000',frequency_c:null};
function fixture(fetchImpl,native=false,stored=null) {
  let cache=stored===null?null:JSON.stringify(stored);
  const window={fetch:fetchImpl,Capacitor:{getPlatform:()=>native?'android':'web'},
    BEAR_RUNTIME_CONFIG:{realtimeApiBase:'https://radio.test/api/realtime'},
    localStorage:{getItem:()=>cache,setItem:(_,value)=>{cache=value;}}};
  vm.runInNewContext(source,{window,AbortSignal});return {catalog:window.BearSdrAnimals,cache:()=>JSON.parse(cache)};
}
test('catalog retains sub-kHz registered frequencies and rejects invalid/duplicate entries',()=>{
  const c=fixture().catalog;
  const items=c.normalize([row,{bear_code:'No radio',frequency_a:'',frequency_b:'bad',frequency_c:-1},
    {bear_code:'Duplicate',frequency_a:148.2415,frequency_b:'148.24150'}, {bear_code:'',frequency_a:148}]);
  assert.equal(items.length,3);assert.equal(items[0].frequencies[0].hz,148241500);
  assert.equal(items[1].frequencies.length,0);assert.equal(items[2].frequencies.length,1);
  assert.equal(c.formatHz(148241500),'148.2415');assert.equal(c.formatHz(149100000),'149.100');
});
for(const native of [false,true])test(`catalog ${native?'native remote':'web gateway'} update and offline recovery`,async()=>{
  const urls=[];let online=true;
  const f=fixture(async url=>{urls.push(url);if(!online)throw Error('offline');
    return {ok:true,json:async()=>url.endsWith('.json')?[]:{ok:true,items:[row]}};},native);
  const result=await f.catalog.load();assert.equal(result.notice,'');assert.equal(result.items[0].code,'KF-110');
  assert.ok(urls.includes(native?'https://radio.test/api/realtime/bear-entities':'api/app-realtime/bear-entities'));
  assert.equal(f.cache()[0].frequency_a,'148.24150');online=false;
  const offline=await f.catalog.load();assert.match(offline.notice,/저장된/);
  assert.equal(offline.items[0].frequencies[0].hz,148241500);
});
test('an older API cannot erase saved frequencies; explicit empty current API can clear stale animals',async()=>{
  let items=[{id:'1',bear_code:'KF-110'}];
  const f=fixture(async()=>({ok:true,json:async()=>({ok:true,items})}),false,[row]);
  assert.equal((await f.catalog.load()).items[0].frequencies[0].hz,148241500);
  items=[];assert.equal((await f.catalog.load()).items.length,0);assert.equal(f.cache().length,0);
});
test('animal gateway forwards frequencies without cookies',async()=>{
  let request;
  const app=express();app.use('/api/app-realtime',createAppRealtimeRouter({apiBase:'https://radio.test/api/realtime',fetchImpl:async(url,options)=>{
    request={url,options};return {status:200,json:async()=>({ok:true,items:[row]})};
  }}));
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/app-realtime/bear-entities`,{headers:{Cookie:'private'}});
    assert.equal((await response.json()).items[0].frequency_a,'148.24150');
    assert.equal(request.url,'https://radio.test/api/realtime/bear-entities');assert.equal(request.options.headers.Cookie,undefined);
  }finally{await new Promise(r=>server.close(r));}
});
