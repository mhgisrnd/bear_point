const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('public/js/obs/obsRegister.js','utf8');
function fixture() {
  const attributes=new Map();
  const field=(value,tagName)=>({value,tagName,classList:{add(){},remove(){}},setAttribute(){},removeAttribute(){}});
  const rows=[['A','P1'],['B','감2'],['C','미약']].map(([a,b])=>{
    const name=field(a,'INPUT'),strength=field(b,'SELECT');
    return {name,strength,querySelector:selector=>selector==='.det-name-input'?name:strength};
  });
  const context=vm.createContext({detectorFieldsEl:{hidden:false},btnDetToggle:{setAttribute:(k,v)=>attributes.set(k,v)},
    detectorSummaryEl:{textContent:''},btnDetAdd:{},btnDetRemove:{},MAX_DET:3,
    detListEl:{querySelectorAll:selector=>selector==='.det-row'?rows:rows.flatMap(row=>[row.name,row.strength])},
    isRegisterPopupVisible:()=>false,getDetCount:()=>rows.length});
  for(const name of ['setDetectorsCollapsed','syncDetBtns','clearDetectorFieldError','markDetectorFieldError','clearDetectorRowErrors','syncDetectorRowErrorState','collectDetectorRows']) {
    const start=source.indexOf('  function '+name+'('),end=source.indexOf('\n  }',start)+4;
    vm.runInContext(source.slice(start,end),context);
  }
  return {context,rows,attributes};
}
test('folding preserves all detector values and updates accessible expanded state',()=>{
  const {context:c,attributes}=fixture();
  const before=JSON.stringify(c.collectDetectorRows());
  c.setDetectorsCollapsed(true);c.syncDetBtns();
  assert.equal(c.detectorFieldsEl.hidden,true);assert.equal(attributes.get('aria-expanded'),'false');
  assert.equal(c.detectorSummaryEl.textContent,'감지기 3개');
  assert.equal(JSON.stringify(c.collectDetectorRows()),before);
  c.setDetectorsCollapsed(false);assert.equal(c.detectorFieldsEl.hidden,false);assert.equal(attributes.get('aria-expanded'),'true');
});
test('invalid hidden detector fields are revealed for correction',()=>{
  const {context:c,rows,attributes}=fixture();
  rows[1].strength.value='';c.setDetectorsCollapsed(true);
  assert.throws(()=>c.collectDetectorRows(),/2행/);
  assert.equal(c.detectorFieldsEl.hidden,false);assert.equal(attributes.get('aria-expanded'),'true');
  assert.equal(rows[0].name.value,'A');assert.equal(rows[2].strength.value,'미약');
});
