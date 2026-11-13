const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('public/js/obs/obsRegister.js','utf8');
const start=source.indexOf('  function normalizeBearEntities(');
const functions=source.slice(start,source.indexOf('  function readCachedBearEntities(',start));

test('native localhost loads the configured public catalog rather than Capacitor assets',()=>{
  for(const capacitor of [{isNativePlatform:()=>true},{getPlatform:()=> 'android'}]){
    const context=vm.createContext({window:{location:{hostname:'localhost'},Capacitor:capacitor,BEAR_RUNTIME_CONFIG:{realtimeApiBase:'https://radio.test/api/realtime/'}}});
    vm.runInContext(fs.readFileSync('public/js/sdr/animal-catalog.js','utf8'),context);
    vm.runInContext(functions,context);
    assert.equal(context.getBearEntityApiUrl(),'https://radio.test/api/realtime/bear-entities');
    const rows=context.normalizeBearEntities([{id:'1',bear_code:'MH-001',sex:'M'}]);
    assert.equal(rows.filter(item=>item.bearCode.toLowerCase().includes('mh-001')).length,1);
  }
});
test('browser catalog uses the same context-relative proxy as the exploration list',()=>{
  for(const hostname of ['localhost','127.0.0.1','bearmap.duckdns.org']){
    const context=vm.createContext({window:{location:{hostname},BEAR_RUNTIME_CONFIG:{realtimeApiBase:'https://radio.test/api/realtime'}}});
    vm.runInContext(functions,context);
    assert.equal(context.getBearEntityApiUrl(),'api/app-realtime/bear-entities');
  }
});
