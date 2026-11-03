const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('public/js/tracking/gps-track-ui.js','utf8');
function bridge(Capacitor){
  const context=vm.createContext({root:{Capacitor}});
  const start=source.indexOf('  function getNativeGpsPlugin('),end=source.indexOf('  root.createGpsTrackUi',start);
  vm.runInContext(source.slice(start,end),context);
  return context.getNativeGpsPlugin();
}
test('plain HTML Android uses injected GPS plugin without the bundled registerPlugin API',()=>{
  const injected={status:async()=>({active:null})};
  assert.equal(bridge({Plugins:{GpsTracking:injected}}),injected);
  assert.equal(bridge({Plugins:{GpsTracking:injected},registerPlugin(){throw Error('injected plugin must win');}}),injected);
});
test('bundled Capacitor runtime remains supported',()=>{
  const injected={};let requested;
  assert.equal(bridge({registerPlugin:name=>{requested=name;return injected;}}),injected);
  assert.equal(requested,'GpsTracking');
});
test('missing or failed GPS bridge keeps map startup alive and reports recorder unavailability on demand',async()=>{
  for(const capacitor of [{},{registerPlugin(){throw Error('not available');}}]){
    const plugin=bridge(capacitor);
    assert.equal((await plugin.status()).active,null);
    await assert.rejects(()=>plugin.start(),/최신 APK/);
    await assert.rejects(()=>plugin.list(),/최신 APK/);
  }
});
