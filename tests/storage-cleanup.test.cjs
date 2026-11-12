const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const code=fs.readFileSync('public/js/settings/storage-cleanup.js','utf8');
function fixture(){
  const saved=new Map(),events={},timers=[];
  const window={localStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)},navigator:{onLine:true},
    document:{hidden:false,addEventListener(){}},addEventListener:(name,fn)=>events[name]=fn,dispatchEvent(){},
    setTimeout:fn=>timers.push(fn),setInterval(){},clearInterval(){}};
  vm.runInNewContext(code,{window,Event:class{}});
  return {api:window.BearStorageCleanup,window,saved,timers};
}
test('cleanup runs once daily, joins concurrent runs and leaves unverified categories intact',async()=>{
  const f=fixture();let calls=0,release;
  f.api.register('tracking',async()=>{calls++;await new Promise(resolve=>release=resolve);return {tracks:1,points:40};});
  f.api.register('observations',async()=>({observations:2}));f.api.register('estimates',async()=>({estimates:1,cache:3}));
  const a=f.api.run(),b=f.api.run();assert.equal(a,b);release();
  const result=await a;assert.equal(result.points,40);assert.equal(result.observations,2);
  assert.equal((await f.api.run()).deferred,true);assert.equal(calls,1);
  f.api.register('tracking',async()=>{throw Error('offline');});
  const partial=await f.api.run({manual:true});assert.match(partial.warning,/보존/);assert.equal(partial.tracks,0);
});
test('offline cleanup never calls deletion handlers; storage errors have an actionable explanation',async()=>{
  const f=fixture();for(const name of ['tracking','observations','estimates'])f.api.register(name,()=>{throw Error('must not run');});
  f.window.navigator.onLine=false;await assert.rejects(f.api.run({manual:true}),/인터넷/);
  assert.match(f.api.formatError(Error('SQLITE_FULL: database or disk is full')),/저장 공간이 부족/);
  assert.equal(f.api.older(null),false);assert.equal(f.api.older('invalid'),false);
  assert.equal(f.api.older('2020-01-01 00:00:00'),true);
});

test('retention cutoff is seven days and retains records until the full period passes',()=>{
  const f=fixture(),now=Date.now(),boundary=f.api.cutoff();
  assert.ok(Math.abs(boundary-(now-7*86400000))<1000);
  assert.equal(f.api.older(boundary-1,boundary),true);
  assert.equal(f.api.older(boundary,boundary),false);
  assert.equal(f.api.older(now-6*86400000,boundary),false);
});
