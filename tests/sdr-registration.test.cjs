const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('public/js/obs/obsRegister.js','utf8');
function fixture(){
  let visible=false,reset=0,returned=0;
  const c=vm.createContext({sdrReturn:null,sdrSourceEl:{hidden:true,textContent:''},regBearEl:{value:'',readOnly:false},btnBearFind:{disabled:false},
    isSubmitting:false,suppressCloseCallback:false,statusEl:{},window:{BearSdrAnimals:{formatHz:hz=>String(hz/1e6)}},
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
test('SDR opens the existing form with locked subject; cancel clears context and returns once',()=>{
  const f=fixture(),c=f.c;
  assert.equal(c.openFromSdr({bearCode:'KF-110',frequencyHz:148241500},f.cancel),true);
  assert.equal(c.regBearEl.value,'KF-110');assert.equal(c.regBearEl.readOnly,true);assert.equal(c.btnBearFind.disabled,true);
  assert.match(c.sdrSourceEl.textContent,/148.2415 MHz/);
  assert.equal(c.handleBackNavigation(),true);
  assert.equal(f.returnCount(),1);assert.equal(c.sdrReturn,null);assert.equal(c.sdrSourceEl.hidden,true);
  assert.equal(c.regBearEl.readOnly,false);assert.equal(c.btnBearFind.disabled,false);
  assert.equal(c.handleBackNavigation(),false);
});
test('a saved/hidden form does not reopen SDR and another draft cannot be overwritten',()=>{
  const f=fixture(),c=f.c;
  f.setVisible(true);c.regBearEl.value='Unfinished';
  assert.equal(c.openFromSdr({bearCode:'KF-110',frequencyHz:148241500},f.cancel),false);
  assert.equal(c.regBearEl.value,'Unfinished');assert.equal(f.resetCount(),0);
  f.setVisible(false);c.openFromSdr({bearCode:'KF-110',frequencyHz:148241500},f.cancel);
  c.hide(true);assert.equal(f.returnCount(),0);assert.equal(c.sdrReturn,null);
  assert.equal(c.openFromSdr({bearCode:'',frequencyHz:148241500},f.cancel),false);
  assert.equal(c.openFromSdr({bearCode:'KF-110',frequencyHz:NaN},f.cancel),false);
});
