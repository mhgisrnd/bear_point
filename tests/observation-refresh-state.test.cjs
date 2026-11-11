const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('public/js/obs/obsList.js','utf8');

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
