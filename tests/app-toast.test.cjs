const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
test('app notices share the back toast, replace its timer and disappear after three seconds',()=>{
  const source=fs.readFileSync('public/js/client-ol.js','utf8');
  const timers=new Map(),nodes=[],haptics=[];let id=0;
  const context=vm.createContext({
    BACK_EXIT_DOUBLE_PRESS_MS:2000,lastBackPressAt:0,
    triggerHapticImpact:style=>haptics.push(style),
    backExitToastEl:null,backExitToastTextEl:null,backExitToastIconEl:null,backExitToastHideTimer:null,
    window:{setTimeout(fn,ms){timers.set(++id,{fn,ms});return id;},clearTimeout(id){timers.delete(id);}},
    document:{createElement:()=>({style:{},setAttribute(){},appendChild(){}}),body:{appendChild(node){nodes.push(node);}}}
  });
  vm.runInContext(source.slice(source.indexOf('  function showBackExitToast('),source.indexOf('  window.__bpResetBackExit =')),context);
  context.window.__bpShowToast('Saved');
  assert.equal(nodes.length,1);assert.equal(nodes[0].style.position,'fixed');
  assert.equal([...timers.values()][0].ms,3000);
  assert.deepEqual(haptics,['LIGHT']);
  assert.equal(context.backExitToastIconEl.hidden,true);
  assert.equal(nodes[0].style.width,'max-content');
  assert.equal(context.backExitToastTextEl.style.wordBreak,'keep-all');
  context.window.__bpShowToast('Updated');
  assert.equal(nodes.length,1);assert.equal(timers.size,1);
  assert.equal(context.backExitToastTextEl.textContent,'Updated');
  assert.deepEqual(haptics,['LIGHT','LIGHT']);
  [...timers.values()][0].fn();assert.equal(nodes[0].style.opacity,'0');
  context.showBackExitToast('Back');assert.equal([...timers.values()][0].ms,2000);
});
