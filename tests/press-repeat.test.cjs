const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

function setup(){
  function target(){
    const events=new Map();
    return {addEventListener(type,fn){const set=events.get(type)||new Set();set.add(fn);events.set(type,set);},
      removeEventListener(type,fn){events.get(type)?.delete(fn);},
      fire(type,values={}){for(const fn of [...(events.get(type)||[])])fn({pointerId:1,button:0,isPrimary:true,detail:1,preventDefault(){},...values});}};
  }
  let time=0,id=0,value=0;
  const timers=new Map(),root=target(),document=target(),button=target();
  Object.assign(button,{disabled:false,isConnected:true,getBoundingClientRect:()=>({left:0,right:44,top:0,bottom:44})});
  root.setTimeout=(fn,delay)=>{timers.set(++id,{fn,at:time+delay});return id;};
  root.clearTimeout=id=>timers.delete(id);
  vm.runInNewContext(fs.readFileSync('public/js/analysis/press-repeat.js','utf8'),{window:root,document});
  const dispose=root.BearPressRepeat.bind(button,()=>value++);
  function advance(ms){const end=time+ms;while(true){const due=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;time=due[1].at;timers.delete(due[0]);due[1].fn();}time=end;}
  return {root,document,button,advance,dispose,value:()=>value,timers};
}

test('short tap steps once and the release click does not add another step',()=>{
  const e=setup();e.button.fire('pointerdown');assert.equal(e.value(),1);
  e.advance(200);e.button.fire('pointerup');e.button.fire('click');
  e.advance(1000);assert.equal(e.value(),1);assert.equal(e.timers.size,0);
  e.button.fire('click',{detail:0});assert.equal(e.value(),2);
});
test('holding repeats after 450ms and stops immediately when released',()=>{
  const e=setup();e.button.fire('pointerdown');e.advance(449);assert.equal(e.value(),1);
  e.advance(1);assert.equal(e.value(),2);e.advance(300);assert.equal(e.value(),5);
  e.root.fire('pointerup');e.button.fire('click');e.advance(1000);assert.equal(e.value(),5);
});
test('leaving the bounds, cancellation, backgrounding and disposal stop repetition',()=>{
  for(const stop of [
    e=>e.button.fire('pointermove',{clientX:50,clientY:20}),
    e=>e.button.fire('pointercancel'),e=>e.root.fire('blur'),
    e=>e.document.fire('visibilitychange'),e=>e.dispose()
  ]){
    const e=setup();e.button.fire('pointerdown');e.advance(500);assert.equal(e.value(),2);
    stop(e);e.advance(1000);assert.equal(e.value(),2);assert.equal(e.timers.size,0);
  }
});
test('disabled buttons and secondary pointers do not start repeating',()=>{
  const e=setup();e.button.disabled=true;e.button.fire('pointerdown');
  e.button.disabled=false;e.button.fire('pointerdown',{isPrimary:false});
  e.advance(1000);assert.equal(e.value(),0);
});
