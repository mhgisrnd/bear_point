const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('public/js/client-ol.js','utf8');

test('action feedback and its immediate toast produce one native impact',()=>{
  let now=1000;const calls=[];
  const context=vm.createContext({Date:{now:()=>now},Promise,
    window:{Capacitor:{Plugins:{Haptics:{impact:options=>{calls.push(options.style);return Promise.resolve();}}}}}});
  vm.runInContext(source.slice(source.indexOf('  function getCapacitorHapticsPlugin('),source.indexOf('  function registerBackClosableOverlay(')),context);
  context.triggerHapticImpact('LIGHT');context.triggerHapticImpact('LIGHT');
  assert.deepEqual(calls,['LIGHT']);
  now+=100;context.triggerHapticImpact('LIGHT');assert.equal(calls.length,1);
  now+=100;context.triggerHapticImpact('LIGHT');assert.deepEqual(calls,['LIGHT','LIGHT']);
});
test('unavailable native haptics fall back without interrupting the action',()=>{
  const calls=[];
  const context=vm.createContext({Date,Promise,window:{
    Capacitor:{Plugins:{Haptics:{impact(){throw new Error('bridge unavailable');}}}},
    navigator:{vibrate:ms=>calls.push(ms)}}});
  vm.runInContext(source.slice(source.indexOf('  function getCapacitorHapticsPlugin('),source.indexOf('  function registerBackClosableOverlay(')),context);
  assert.doesNotThrow(()=>context.triggerHapticImpact('LIGHT'));
  assert.deepEqual(calls,[18]);
});
test('analysis cancellation and successful progression have separate feedback behavior',()=>{
  const obs=fs.readFileSync('public/js/obs/obsList.js','utf8');
  const context=vm.createContext({window:{__bpTriggerHapticImpact:()=>calls++},
    document:{activeElement:null},setObservationListDisabled(){},setPeekMode(){},emitAnalysisPreview(){}});
  let calls=0;
  vm.runInContext(obs.slice(obs.indexOf('  function closeAnalysisOptionsDialog('),obs.indexOf('  function escapeAnalysisOptionsDialog(')),context);
  function dialog(){return {resolve(){},overlay:{style:{}},panel:{contains:()=>false}};}
  context.analysisOptionsDialogState=dialog();context.closeAnalysisOptionsDialog(null);assert.equal(calls,1);
  context.closeAnalysisOptionsDialog(null);assert.equal(calls,1);
  context.analysisOptionsDialogState=dialog();context.closeAnalysisOptionsDialog({distanceLimitM:8000});assert.equal(calls,1);
});
