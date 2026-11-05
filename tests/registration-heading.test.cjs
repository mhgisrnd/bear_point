const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('public/js/obs/obsRegister.js','utf8');
function fixture(){
  const field={value:'',classList:{add(){},remove(){}}};
  const state={lat:35,lng:127,heading:123.4,isGpsActive:true};
  const c=vm.createContext({latestLive:state,regHeadingEl:field,regCoordEl:null,isHeadingLocked:false,lockedHeadingDeg:null,
    DEFAULT_MANUAL_HEADING:0,isManualEntryEnabled:()=>!state.isGpsActive,parseManualCoordInput:()=>null,refreshBoundary(){}});
  for(const name of ['parseFiniteNumber','renderLiveFields']){
    const start=source.indexOf('  function '+name+'('),end=source.indexOf('\n  }',start)+4;
    vm.runInContext(source.slice(start,end),c);
  }
  return {c,field,state};
}
test('GPS and manual heading fields show numbers without retaining the degree suffix',()=>{
  const {c,field,state}=fixture();
  c.renderLiveFields();assert.equal(field.value,'123');assert.equal(field.readOnly,true);
  field.value='123°';state.isGpsActive=false;c.renderLiveFields();
  assert.equal(field.value,'123');assert.equal(field.readOnly,false);
  field.value='270.5';c.renderLiveFields();assert.equal(field.value,'270.5');
  state.isGpsActive=true;state.heading=45;c.renderLiveFields();assert.equal(field.value,'45');
});
test('zero and locked headings remain numeric and waiting values clear on manual entry',()=>{
  const {c,field,state}=fixture();state.heading=0;c.renderLiveFields();assert.equal(field.value,'0');
  c.isHeadingLocked=true;c.lockedHeadingDeg=271;c.renderLiveFields();assert.equal(field.value,'271');
  c.isHeadingLocked=false;state.heading=null;c.renderLiveFields();
  assert.equal(field.value,'방향각 대기중');
  state.isGpsActive=false;c.renderLiveFields();assert.equal(field.value,'0');assert.equal(field.readOnly,false);
});
