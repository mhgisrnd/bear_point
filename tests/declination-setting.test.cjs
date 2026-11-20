const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const client=fs.readFileSync('public/js/client-ol.js','utf8');
const list=fs.readFileSync('public/js/obs/obsList.js','utf8');

test('map and input bearings round-trip through the shared setting without changing source data',()=>{
  let setting=-7;
  const context=vm.createContext({window:{BearAppSettings:{getDeclinationDeg:()=>setting}}});
  const start=client.indexOf('  function getObservationDeclinationDeg(');
  vm.runInContext(client.slice(start,client.indexOf('  function getHeadingHandleCoordinate(',start)),context);
  const observation={heading:90};
  assert.equal(context.getObservationMapHeading(observation.heading),83);
  assert.equal(context.getObservationInputHeading(83),90);
  assert.equal(context.getObservationMapHeading(0),353);
  for(const correction of [-7,0,6.5]){
    setting=correction;
    for(const heading of [0,1,90,359])assert.equal(context.getObservationInputHeading(context.getObservationMapHeading(heading)),heading);
  }
  assert.equal(observation.heading,90);
});

test('analysis preview and saved analysis options use the current setting while retaining raw headings',async()=>{
  let setting=-7,result,applied;
  const previews=[],observation={id:'one',lat:35,lng:127,heading:90};
  const dialog={distanceInput:{value:'',blur(){}},errorEl:{},body:{style:{removeProperty(){}}},overlay:{style:{}},
    desc:{querySelector:()=>null},panel:{},cancelBtn:{},applyBtn:{}};
  const context=vm.createContext({window:{BearAppSettings:{getDeclinationDeg:()=>setting},BearAnalysisViewport:{},requestAnimationFrame(){}},
    onClearAnalysisEstimate:null,ensureAnalysisOptionsDialog:()=>dialog,getObservationLabel:()=> 'sample',
    setObservationListDisabled(){},setPeekMode(){},emitAnalysisPreview:value=>previews.push(value),
    closeAnalysisOptionsDialog(value){result=value;dialog.resolve(value);},triggerLightErrorVibration(){}});
  vm.runInContext(list.slice(list.indexOf('  function getAnalysisDeclinationDeg('),list.indexOf('  function getSelectedObservations(')),context);
  const completed=context.openAnalysisOptionsDialog({distanceLimitM:8000,declinationDeg:99},[observation],options=>{applied=options;return {ok:true};});
  assert.equal(previews.at(-1).declinationDeg,-7);
  assert.equal(previews.at(-1).sourceObservations[0].heading,90);
  setting=0;dialog.refreshPreview();
  assert.equal(previews.at(-1).declinationDeg,0);
  dialog.applyBtn.onclick();await completed;
  assert.equal(applied.declinationDeg,0);assert.equal(result.declinationDeg,0);
  assert.equal(observation.heading,90);
});
