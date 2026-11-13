const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('observation row uses injected haptic before moving the map',()=>{
  const code=fs.readFileSync('public/js/obs/obsList.js','utf8');
  const events=[];
  const context=vm.createContext({window:{},observationFocusVersion:0,map:{getZoom:()=>15},observationMarkers:[],
    onItemHaptic:()=>events.push('haptic'),flyToLatLng:()=>events.push('move')});
  const start=code.indexOf('  function moveToObservation(');
  const end=code.indexOf('  function updateObservationMarkerScale',start);
  vm.runInContext(code.slice(start,end),context);
  context.moveToObservation({lat:35,lng:127},null);
  assert.deepEqual(events,['haptic','move']);
});

test('mobile observation selection folds the list before centering and opening details; desktop keeps its list',()=>{
  const code=fs.readFileSync('public/js/obs/obsList.js','utf8');
  for(const mobile of [true,false]){
    const events=[];
    const context=vm.createContext({window:{BearMobileDock:{isMobile:()=>mobile,collapse:()=>events.push('collapse')}},
      observationFocusVersion:0,map:{getZoom:()=>15},observationMarkers:[{obsData:{_obsKey:'one'},openPopup:()=>events.push('popup')}],
      observationMarkersLayer:{},onItemHaptic:()=>events.push('haptic'),
      flyToLatLng:(coordinate,zoom,done)=>{events.push('move');done(true);}});
    const start=code.indexOf('  function moveToObservation('),end=code.indexOf('  function updateObservationMarkerScale',start);
    vm.runInContext(code.slice(start,end),context);
    context.moveToObservation({_obsKey:'one',lat:35,lng:127},null);
    assert.deepEqual(events,mobile?['haptic','collapse','move','popup']:['haptic','move','popup']);
  }
});

test('movement history row vibrates immediately even while detail loading is pending',()=>{
  const code=fs.readFileSync('public/js/tracking/gps-track-ui.js','utf8');
  const statement=code.split('\n').find(line=>line.includes("row.addEventListener('click'"));
  const events=[];let click,finishFlash;const classes=new Set();
  const context=vm.createContext({row:{classList:{remove:name=>classes.delete(name),add:name=>classes.add(name)},addEventListener:(name,handler)=>{click=handler;}},history:{append(){}},
    root:{setTimeout:(callback,delay)=>{assert.equal(delay,900);finishFlash=callback;}},
    onItemHaptic:()=>events.push('haptic'),action:fn=>fn(),message:{},track:{id:'one'},
    show:()=>{events.push('load');return new Promise(()=>{});}});
  vm.runInContext(statement,context);
  click();
  assert.deepEqual(events,['haptic','load']);
  assert.equal(classes.has('is-flashing'),true);
  finishFlash();assert.equal(classes.has('is-flashing'),false);
});
