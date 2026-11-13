const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('observation label button sits beside registration and persists its independent display preference',()=>{
  const source=fs.readFileSync('public/js/obs/obsList.js','utf8');
  const page=fs.readFileSync('public/index.html','utf8');
  assert.match(page,/id="btn-obs-labels"[^>]*>[^<]*<\/button>\s*<button[^>]*id="btn-obs-add-inline"/);
  const storage=new Map();let redraws=0,click;
  function boot(){
    const button={attributes:{},setAttribute(key,value){this.attributes[key]=value;},addEventListener(_type,fn){click=fn;}};
    const context=vm.createContext({document:{getElementById:()=>button},window:{localStorage:{getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)}},
      onItemHaptic(){},updateObservationMarkerScale(){redraws++;}});
    const start=source.indexOf('  const btnObsLabels');
    vm.runInContext(source.slice(start,source.indexOf('  const btnAnalysis',start)),context);
    return button;
  }
  let button=boot();assert.equal(button.textContent,'라벨 ON');
  click({stopPropagation(){}});assert.equal(button.textContent,'라벨 OFF');assert.equal(redraws,1);
  button=boot();assert.equal(button.textContent,'라벨 OFF');assert.equal(button.attributes['aria-pressed'],'false');
  click({stopPropagation(){}});assert.equal(button.textContent,'라벨 ON');assert.equal(redraws,2);
});
