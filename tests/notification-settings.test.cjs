const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function fixture({native=true,granted=true,enabled=true,accept=true,initialize, startupReady}={}) {
  const nodes=new Map();
  function node(selector){if(!nodes.has(selector))nodes.set(selector,{events:{},dataset:{},addEventListener(name,fn){this.events[name]=fn;}});return nodes.get(selector);}
  const calls=[],state={enabled,permissionGranted:granted};
  const plugin={
    async getNotificationSettings(){return {...state};},
    async setNotificationsEnabled(value){calls.push(['set',value.enabled]);state.enabled=value.enabled;return {...state};},
    async requestNotificationPermission(){calls.push(['request']);return {permissionGranted:state.permissionGranted,needsSettings:!state.permissionGranted};},
    async openNotificationSettings(){calls.push(['settings']);state.permissionGranted=true;return {...state};}
  };
  if (initialize) plugin.initializeNotifications=async()=>{calls.push(['initialize']);Object.assign(state,await initialize({...state}));return {...state};};
  const root={Capacitor:{isNativePlatform:()=>native,Plugins:{BearPush:plugin}},document:{addEventListener(){}},
    BearStartupReady:startupReady,
    __bpShowConfirmDialog:async()=>accept,BearPushRegistrationStatus:{async retry(){calls.push(['register']);return {message:'Synced'};}}};
  vm.runInNewContext(fs.readFileSync('public/js/settings/notification-settings.js','utf8'),{window:root});
  const api=root.BearNotificationSettings.mount({querySelector:node},{});
  return {api,state,calls,plugin,toggle:node('.app-settings-notification-enabled'),label:node('.app-notification-state'),message:node('.app-settings-notification-message')};
}
test('first-launch permission result automatically sets the displayed switch and registers the device',async()=>{
  for (const granted of [true,false]) {
    const f=fixture({enabled:false,granted:false,initialize:async()=>({enabled:granted,permissionGranted:granted})});
    await f.api.ready;
    assert.equal(f.toggle.checked,granted);
    assert.deepEqual(f.calls,[['initialize'],['register']]);
    assert.equal(f.toggle.disabled,false);
  }
});
test('startup waits for app readiness and preserves an existing OFF choice even with system permission',async()=>{
  let resolve;const startupReady=new Promise(done=>resolve=done);
  const f=fixture({enabled:false,granted:true,startupReady,initialize:async state=>state});
  assert.equal(f.toggle.disabled,true);assert.equal(f.calls.length,0);
  resolve();await f.api.ready;
  assert.equal(f.toggle.checked,false);assert.equal(f.state.enabled,false);
  assert.deepEqual(f.calls,[['initialize'],['register']]);
  f.toggle.checked=true;await f.toggle.events.change();
  assert.equal(f.state.enabled,true);
  assert.deepEqual(f.calls.slice(2),[['set',true],['register']]);
});
test('OFF persists without revoking system permission and synchronizes registration; ON needs no new permission',async()=>{
  const f=fixture();await f.api.refresh();
  assert.equal(f.label.textContent,'ON');
  f.toggle.checked=false;await f.toggle.events.change();
  assert.equal(f.state.enabled,false);assert.equal(f.state.permissionGranted,true);
  assert.equal(f.label.textContent,'OFF');
  assert.deepEqual(f.calls,[['set',false],['register']]);
  f.toggle.checked=true;await f.toggle.events.change();
  assert.deepEqual(f.calls.slice(2),[['set',true],['register']]);
  assert.equal(f.toggle.checked,true);
});
test('canceling the OFF confirmation retains ON without changing the device or server registration',async()=>{
  const f=fixture({accept:false});await f.api.refresh();
  f.toggle.checked=false;await f.toggle.events.change();
  assert.equal(f.state.enabled,true);assert.equal(f.toggle.checked,true);assert.equal(f.label.textContent,'ON');
  assert.deepEqual(f.calls,[]);
});
test('blocked ON guides to app settings and activates after returning with permission',async()=>{
  const f=fixture({granted:false,enabled:false});await f.api.refresh();
  f.toggle.checked=true;await f.toggle.events.change();
  assert.deepEqual(f.calls,[['request'],['settings'],['set',true],['register']]);
  assert.equal(f.toggle.checked,true);
});
test('declining settings leaves reception disabled',async()=>{
  const f=fixture({granted:false,enabled:false,accept:false});await f.api.refresh();
  f.toggle.checked=true;await f.toggle.events.change();
  assert.deepEqual(f.calls,[['request']]);assert.equal(f.toggle.checked,false);
});
test('first permission prompt can grant access without opening settings',async()=>{
  const f=fixture({granted:false,enabled:false});await f.api.refresh();
  f.plugin.requestNotificationPermission=async()=>{f.calls.push(['request']);f.state.permissionGranted=true;return {permissionGranted:true};};
  f.toggle.checked=true;await f.toggle.events.change();
  assert.deepEqual(f.calls,[['request'],['set',true],['register']]);
  assert.equal(f.toggle.checked,true);
});
test('web has a clear unsupported state and cannot toggle mobile reception',async()=>{
  const f=fixture({native:false});await f.api.refresh();
  assert.equal(f.toggle.disabled,true);assert.equal(f.calls.length,0);
});
test('failed token retirement still attempts server unregistration and reports the failure',async()=>{
  const f=fixture();await f.api.refresh();
  f.plugin.setNotificationsEnabled=async()=>{f.state.enabled=false;throw new Error('offline');};
  f.toggle.checked=false;await f.toggle.events.change();
  assert.deepEqual(f.calls,[['register']]);assert.equal(f.toggle.checked,false);assert.match(f.message.textContent,/offline/);
});
