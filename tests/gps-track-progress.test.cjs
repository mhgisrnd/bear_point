const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('public/js/tracking/gps-track-ui.js','utf8');
const poll=code.slice(code.indexOf('    async function poll() {'),code.indexOf("    start.addEventListener('click'"));

test('recorder reports location rejection without losing the route, then clears warning on recovery',async()=>{
  let response={active:{id:'active',point_count:1},location_warning:'accuracy warning'};
  let draws=0;
  const context={polling:false,document:{hidden:false},busy:false,initial:false,
    displayed:{id:'active',point_count:1},active:{id:'active',point_count:1},
    plugin:{status:async()=>response},message:{textContent:''},paint(){},syncRecords(){},refreshSharedHistory(){},
    show:async()=>{draws++;context.displayed={...response.active};}};
  vm.createContext(context);vm.runInContext(poll,context);
  await context.poll();assert.equal(context.message.textContent,'accuracy warning');assert.equal(draws,0);
  response={active:{id:'active',point_count:2}};
  await context.poll();assert.equal(context.message.textContent,'');assert.equal(draws,1);
  assert.equal(context.displayed.point_count,2);
});

test('live location diagnostics do not overwrite the selected historical route',async()=>{
  let draws=0;
  const context={polling:false,document:{hidden:false},busy:false,initial:false,
    displayed:{id:'history',point_count:10},active:{id:'active',point_count:1},
    plugin:{status:async()=>({active:{id:'active',point_count:2},location_warning:'accuracy warning'})},
    message:{textContent:'history'},paint(){},syncRecords(){},refreshSharedHistory(){},show:async()=>{draws++;}};
  vm.createContext(context);vm.runInContext(poll,context);await context.poll();
  assert.equal(context.displayed.id,'history');assert.equal(draws,0);assert.equal(context.message.textContent,'history');
});
