const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('public/js/obs/obsList.js','utf8');

test('observation focus follows the current item without changing checkbox selection',()=>{
  const makeRow=key=>{
    const classes=new Set(['selected']),attrs=new Map([['data-observation-key',String(key)]]);
    return {classes,attrs,classList:{toggle(name,on){on?classes.add(name):classes.delete(name);}},
      getAttribute:name=>attrs.get(name),setAttribute:(name,value)=>attrs.set(name,value),removeAttribute:name=>attrs.delete(name)};
  };
  const rows=[makeRow('a'),makeRow(2)];
  const context=vm.createContext({obsListBodyEl:{querySelectorAll:()=>rows}});
  const start=source.indexOf('  let focusedObservationKey');
  vm.runInContext(source.slice(start,source.indexOf('  const observationMarkers',start)),context);
  context.focusObservationRow('a');
  assert.equal(rows[0].attrs.get('aria-current'),'true');
  context.focusObservationRow(2);
  assert.equal(rows[0].classes.has('obs-row--focused'),false);
  assert.equal(rows[0].attrs.has('aria-current'),false);
  assert.equal(rows[1].classes.has('obs-row--focused'),true);
  assert.ok(rows.every(row=>row.classes.has('selected')));
  context.focusObservationRow(null);
  assert.ok(rows.every(row=>!row.classes.has('obs-row--focused')));
});

test('the same observation keeps its selection identity across reloads and edits',()=>{
  const context=vm.createContext({toHeadingText:String,cleanupObservationFlashCache(){},
    observationFlashUntilById:new Map(),observationFlashPresetById:new Map()});
  vm.runInContext(source.slice(source.indexOf('  function mapObservationRow('),source.indexOf('  // Local data is available')),context);
  const row={id:'observation-a',bear_code:'KF-58',lat:35,lng:127};
  const first=context.mapObservationRow(row);
  const updated=context.mapObservationRow({...row,owner:'updated',place:'renamed',share_state:'shared'});
  const other=context.mapObservationRow({...row,id:'observation-b'});
  assert.equal(first._obsKey,updated._obsKey);
  assert.notEqual(first._obsKey,other._obsKey);
});

test('manual and background refresh keep surviving checks, removing only missing records',async()=>{
  const selected=new Set(['a','b']);
  let rows=[{_obsKey:'a'},{_obsKey:'b'}],syncs=0;
  const context=vm.createContext({selectedObsIds:selected,observationSamples:[],
    obsSheetEl:{setAttribute(){}},
    applySearch(){},renderObservationMarkers(){},updateSelectionUI(){},updateObservationSummary(){},updateMainStatusForList(){},
    async syncObservationList(){syncs++;}});
  context.loadObservationSamples=async()=>{context.observationSamples=rows;};
  context.getFilteredItems=()=>context.observationSamples;
  vm.runInContext(source.slice(source.indexOf('  let observationRefreshCount'),source.indexOf('  let observationListSync')),context);
  await context.refreshObservationData();
  assert.deepEqual([...selected],['a','b']);assert.equal(syncs,1);
  rows=[{_obsKey:'a'},{_obsKey:'new'}];
  await context.refreshObservationData({background:true,localOnly:true});
  assert.deepEqual([...selected],['a']);
});
