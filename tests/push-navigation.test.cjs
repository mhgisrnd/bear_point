const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function setup(pending) {
  const window={};let listener;
  vm.runInNewContext(fs.readFileSync('public/js/realtime/push-navigation.js','utf8'),{window});
  const plugin={async addListener(name,fn){assert.equal(name,'notificationOpened');listener=fn;},async consumeNotificationOpen(){const serverId=pending;pending=null;return {serverId};}};
  return {start:window.BearPushNavigation.start,plugin,tap:async id=>{pending=id;await listener();}};
}
test('cold launch consumes a tap once after map startup; warm taps navigate independently',async()=>{
  const f=setup('55'),opened=[];let resolve;
  const ready=new Promise(done=>resolve=done);
  const task=f.start({plugin:f.plugin,ready,open:async id=>opened.push(id)});
  await new Promise(setImmediate);assert.deepEqual(opened,[]);
  resolve();await task;assert.deepEqual(opened,['55']);
  await f.tap(null);assert.deepEqual(opened,['55']);
  await f.tap('90');assert.deepEqual(opened,['55','90']);
});
test('a newer tap supersedes an earlier tap still waiting for startup',async()=>{
  const f=setup('55'),opened=[];let resolve;
  const ready=new Promise(done=>resolve=done);
  const first=f.start({plugin:f.plugin,ready,open:async(id,current)=>{if(current())opened.push(id);}});
  await new Promise(setImmediate);
  const second=f.tap('90');await new Promise(setImmediate);
  resolve();await Promise.all([first,second]);assert.deepEqual(opened,['90']);
});
test('malformed or missing notification targets never open an arbitrary record',async()=>{
  for(const value of [null,'','0','abc','55/path']) {
    const f=setup(value);await f.start({plugin:f.plugin,ready:Promise.resolve(),open:()=>assert.fail('unexpected navigation')});
  }
});
test('notification target clears filters and focuses the exact record, while missing records show a notice',async()=>{
  const source=fs.readFileSync('public/js/client-ol.js','utf8').replace(/\r\n/g,'\n');
  const start=source.indexOf('open: async function (serverId, isCurrent)');
  const body=source.slice(start+'open: '.length,source.indexOf(',\n      onError:',start));
  let focused,notice,selected;
  const context={currentBearEstimateItems:[{id:'local-a',server_id:'55',remoteOnly:false,lat:37,lng:127}],
    refreshBearEstimatePanel:async()=>{},realtimeListModule:{refresh:async()=>({ok:true})},
    bearCodeSearchEl:{value:'other'},bearOwnerFilterEl:{value:'other'},bearTeamFilterEl:{value:'other'},bearPeriodFilterEl:{value:'day'},bearFilterPanelEl:{hidden:false},btnBearFilterEl:{setAttribute(){}},
    window:{BearMobileDock:{isDocked:()=>true,select:value=>selected=value},__bpShowToast:value=>notice=value},
    repaintUnifiedBearList(){},focusBearListItem(...args){focused=args;}};
  const open=vm.runInNewContext('('+body+')',context);
  await open('55',()=>true);assert.equal(JSON.stringify(focused),JSON.stringify(['local-a',false,[37,127]]));
  assert.equal(selected,'bears');assert.equal(context.bearTeamFilterEl.value,'');assert.equal(context.bearPeriodFilterEl.value,'all');
  focused=null;await open('56',()=>true);assert.equal(focused,null);assert.ok(notice);
});
