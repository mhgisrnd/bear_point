const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('public/js/client-ol.js','utf8');
function fixture() {
  let notify,nextId=0;
  const timers=new Map();
  const statusEl={textContent:'',style:{color:'red'},set innerHTML(value){this.html=value;this.textContent='반달가슴곰 위치추적분석';}};
  const context=vm.createContext({statusEl,MutationObserver:class{constructor(callback){notify=callback;}observe(target,options){assert.equal(target,statusEl);assert.equal(options.characterData,true);}},
    window:{setTimeout(callback,delay){assert.equal(delay,5000);timers.set(++nextId,callback);return nextId;},clearTimeout(id){timers.delete(id);}}});
  const start=source.indexOf('  function setDefaultStatusWithIcon()'),end=source.indexOf('  installStatusAutoReset();',start);
  vm.runInContext(source.slice(start,end)+'installStatusAutoReset();',context);
  return {statusEl,timers,notify:()=>notify()};
}
test('temporary status restores the original title and icon after five seconds',()=>{
  const f=fixture();f.statusEl.textContent='삭제 취소됨';f.notify();
  assert.equal(f.timers.size,1);
  [...f.timers.values()][0]();
  assert.equal(f.statusEl.textContent,'반달가슴곰 위치추적분석');
  assert.match(f.statusEl.html,/helloHiking.png/);assert.equal(f.statusEl.style.color,'');
});
test('newer messages restart the delay and cannot be overwritten by an old timeout',()=>{
  const f=fixture();f.statusEl.textContent='Old';f.notify();const old=[...f.timers.values()][0];
  f.statusEl.textContent='New';f.notify();assert.equal(f.timers.size,1);
  old();assert.equal(f.statusEl.textContent,'New');
  [...f.timers.values()][0]();assert.equal(f.statusEl.textContent,'반달가슴곰 위치추적분석');
});
test('the default title never creates a repeating reset timer',()=>{
  const f=fixture();f.statusEl.textContent='Message';f.notify();
  f.statusEl.textContent='반달가슴곰 위치추적분석';f.notify();assert.equal(f.timers.size,0);
});
