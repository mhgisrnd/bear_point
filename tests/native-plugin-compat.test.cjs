const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('public/js/native-plugin-compat.js','utf8');
test('plain native bridge supports an older direct registerPlugin call using the injected plugin',async()=>{
  const gps={status:async()=>({active:null})};
  const window={Capacitor:{isNativePlatform:()=>true,Plugins:{GpsTracking:gps}}};
  const context=vm.createContext({window});vm.runInContext(source,context);
  assert.equal(window.Capacitor.registerPlugin('GpsTracking'),gps);
  assert.equal((await vm.runInContext("window.Capacitor.registerPlugin('GpsTracking').status()",context)).active,null);
  assert.throws(()=>window.Capacitor.registerPlugin('Missing'),/플러그인을 찾을 수 없습니다/);
  assert.throws(()=>window.Capacitor.registerPlugin('__proto__'),/플러그인을 찾을 수 없습니다/);
});
test('bundled API is preserved and web browsers do not receive a fake native bridge',()=>{
  const registered=()=>{};const window={Capacitor:{registerPlugin:registered}};
  vm.runInNewContext(source,{window});assert.equal(window.Capacitor.registerPlugin,registered);
  const web={Capacitor:{getPlatform:()=> 'web'}};vm.runInNewContext(source,{window:web});
  assert.equal(web.Capacitor.registerPlugin,undefined);
  assert.doesNotThrow(()=>vm.runInNewContext(source,{window:{}}));
});
test('native platform lookup also works in runtimes exposing only getPlatform',()=>{
  const window={Capacitor:{getPlatform:()=> 'android',Plugins:{RtlSdr:{getStatus:()=>{}}}}};
  vm.runInNewContext(source,{window});assert.equal(window.Capacitor.registerPlugin('RtlSdr'),window.Capacitor.Plugins.RtlSdr);
});
