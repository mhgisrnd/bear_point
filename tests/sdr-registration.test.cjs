const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('public/js/obs/obsRegister.js','utf8');
test('receiver frequency confirmation allows matches and respects confirmation for mismatches or unknown frequencies',async()=>{
  let accepted=false,calls=[];
  const c=vm.createContext({sdrFrequencyHz:148241000,bearEntityItems:[
    {bearCode:'A',frequencies:[{slot:'A',hz:148241900}]},
    {bearCode:'B',frequencies:[{slot:'B',hz:149000000}]},
    {bearCode:'C',frequencies:[]}
  ],window:{__bpShowConfirmDialog:async options=>{calls.push(options);return accepted;},
    BearSdrAnimals:{formatHz:hz=>String(hz/1e6)},
    BearSdrFrequency:{matchesAnimalFrequency:(a,b)=>Math.abs(a-b)<=900}}});
  const start=source.indexOf('  async function confirmSdrFrequency('),end=source.indexOf('\n  }',start)+4;
  vm.runInContext(source.slice(start,end),c);
  assert.equal(await c.confirmSdrFrequency('A'),true);assert.equal(calls.length,0);
  assert.equal(await c.confirmSdrFrequency('B'),false);
  const options=calls.at(-1);
  assert.match(options.message,/일치/);
  assert.deepEqual(JSON.parse(JSON.stringify(options.table.rows)),[
    ['A 발신기','미등록'],['B 발신기','149 MHz'],['C 발신기','미등록'],['현재 수신','148.241 MHz']
  ]);
  assert.equal(options.blurInput,true);assert.equal(options.confirmText,'등록');
  accepted=true;assert.equal(await c.confirmSdrFrequency('B'),true);
  assert.equal(await c.confirmSdrFrequency('C'),true);assert.match(calls.at(-1).message,/확인할 수 없습니다/);
  accepted=false;assert.equal(await c.confirmSdrFrequency('unknown'),false);
  c.sdrFrequencyHz=null;assert.equal(await c.confirmSdrFrequency('B'),true);
});
function fixture(){
  let visible=false,reset=0,returned=0;
  const c=vm.createContext({sdrReturn:null,sdrSourceEl:{hidden:true,textContent:''},regBearEl:{value:'',readOnly:false},btnBearFind:{disabled:false},
    sdrFrequencyHz:null,loadBearEntityCatalog:async()=>{},formMode:"create",isSubmitting:false,suppressCloseCallback:false,
    closeBearPicker(){},setPeekMode(){},applyMobileViewportSizing(){},keepPopupInViewport(){},clearCoreFieldError(){},statusEl:{},window:{BearSdrAnimals:{formatHz:hz=>String(hz/1e6)}},
    isRegisterPopupVisible:()=>visible,
    resetFormState(){reset++;c.clearSdrContext();},open(){visible=true;},
    hide(){visible=false;c.clearSdrContext();},onClose(){},
    bearPickerEl:{classList:{contains:()=>true}}});
  for(const name of ['clearSdrContext','openFromSdr','close','handleBackNavigation']){
    const start=source.indexOf('  function '+name+'('),end=source.indexOf('\n  }',start)+4;
    vm.runInContext(source.slice(start,end),c);
  }
  return {c,setVisible:v=>{visible=v;},resetCount:()=>reset,returnCount:()=>returned,cancel:()=>{returned++;}};
}
test('SDR opens the existing form with editable subject; cancel clears context and returns once',()=>{
  const f=fixture(),c=f.c;
  assert.equal(c.openFromSdr({bearCode:'KF-110',frequencyHz:148241500},f.cancel),true);
  assert.equal(c.regBearEl.value,'KF-110');assert.equal(c.regBearEl.readOnly,false);assert.equal(c.btnBearFind.disabled,false);
  assert.match(c.sdrSourceEl.textContent,/148.2415 MHz/);
  assert.equal(c.handleBackNavigation(),true);
  assert.equal(f.returnCount(),1);assert.equal(c.sdrReturn,null);assert.equal(c.sdrSourceEl.hidden,true);
  assert.equal(c.regBearEl.readOnly,false);assert.equal(c.btnBearFind.disabled,false);
  assert.equal(c.handleBackNavigation(),false);
});
test('an existing creation draft is retargeted without resetting fields and returns to the latest SDR session',()=>{
  const f=fixture(),c=f.c;let latestReturns=0;
  c.openFromSdr({bearCode:'KF-110',frequencyHz:148241500},f.cancel);
  const resets=f.resetCount();
  c.draft={place:'field notes',lat:35.32,lng:127.63,heading:126,detectors:['existing detector']};
  const before=JSON.stringify(c.draft);
  assert.equal(c.openFromSdr({bearCode:'MH-001',frequencyHz:148241000},()=>{latestReturns++;}),true);
  assert.equal(f.resetCount(),resets);assert.equal(JSON.stringify(c.draft),before);
  assert.equal(c.regBearEl.value,'MH-001');assert.equal(c.regBearEl.readOnly,false);
  assert.match(c.sdrSourceEl.textContent,/148.241 MHz/);
  c.close();assert.equal(latestReturns,1);assert.equal(f.returnCount(),0);
});

test('saved/hidden forms do not return to SDR and edits, submissions and invalid targets are protected',()=>{
  const f=fixture(),c=f.c;
  f.setVisible(true);c.formMode='edit';c.regBearEl.value='Existing';
  assert.equal(c.openFromSdr({bearCode:'KF-110',frequencyHz:148241500},f.cancel),false);
  assert.equal(c.regBearEl.value,'Existing');assert.equal(f.resetCount(),0);
  c.formMode='create';c.isSubmitting=true;
  assert.equal(c.openFromSdr({bearCode:'KF-110',frequencyHz:148241500},f.cancel),false);
  assert.equal(c.regBearEl.value,'Existing');c.isSubmitting=false;
  f.setVisible(false);c.openFromSdr({bearCode:'KF-110',frequencyHz:148241500},f.cancel);
  c.hide(true);assert.equal(f.returnCount(),0);assert.equal(c.sdrReturn,null);
  assert.equal(c.openFromSdr({bearCode:'',frequencyHz:148241500},f.cancel),true);
  assert.equal(c.openFromSdr({bearCode:'KF-110',frequencyHz:NaN},f.cancel),false);
});
test('IC-R30 registration shows the actual receiver and receive mode without relabeling it as SDR CW',()=>{
  const f=fixture(),c=f.c;
  assert.equal(c.openFromSdr({bearCode:'KF-110',frequencyHz:148241500,receiver:'IC-R30',mode:'FM-N'},f.cancel),true);
  assert.match(c.sdrSourceEl.textContent,/IC-R30 Bluetooth.*148.2415 MHz.*FM-N/);
  assert.doesNotMatch(c.sdrSourceEl.textContent,/SDR|CW/);
});
test('registration accepts actual tuned frequencies above the catalog ceiling but respects receiver limits',()=>{
  const c=fixture().c;
  assert.equal(c.openFromSdr({bearCode:'KF-110',frequencyHz:999999900}),true);
  assert.match(c.sdrSourceEl.textContent,/999.9999 MHz/);
  assert.equal(c.openFromSdr({bearCode:'KF-110',frequencyHz:999999991}),false);
  assert.equal(c.openFromSdr({bearCode:'KF-110',frequencyHz:3304999000,receiver:'IC-R30',mode:'CW'}),true);
  assert.equal(c.openFromSdr({bearCode:'KF-110',frequencyHz:3304999001,receiver:'IC-R30'}),false);
});

test('map SDR handoff reuses an open form without clearing map editing state or reopening it',()=>{
  const mapSource=fs.readFileSync('public/js/client-ol.js','utf8');
  const start=mapSource.indexOf('  function openObservationRegistration('),end=mapSource.indexOf('\n  }',start)+4;
  let handed=0;
  const context=vm.createContext({obsRegisterModule:{isOpen:()=>true,openFromSdr(target,back){handed++;assert.equal(target.bearCode,'MH-001');assert.equal(typeof back,'function');return true;}}});
  vm.runInContext(mapSource.slice(start,end),context);
  assert.equal(context.openObservationRegistration({bearCode:'MH-001',frequencyHz:148241000},()=>{}),true);
  assert.equal(handed,1);
});
