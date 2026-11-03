const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
function fixture(){
  let now=1000,next=0,ready=0;
  const timers=new Map();
  class Element{
    constructor(tag){this.tagName=tag;this.children=[];this.style={};this.events={};this.attributes={};this.open=false;this.opens=0;}
    appendChild(e){this.children.push(e);} setAttribute(k,v){this.attributes[k]=v;}
    addEventListener(name,fn){this.events[name]=fn;}
    showModal(){this.open=true;this.opens++;} close(){this.open=false;}
  }
  const c=vm.createContext({window:{setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id)},
    document:{createElement:tag=>new Element(tag),body:new Element('body'),head:new Element('head')},Date:{now:()=>now},
    startupOverlayEl:null,startupOverlayTextEl:null,startupOverlayRetryBtn:null,startupOverlayShowTimer:null,startupOverlayVisibleAt:0,
    STARTUP_OVERLAY_DELAY_MS:140,STARTUP_OVERLAY_MIN_VISIBLE_MS:320,resolveStartupReady:()=>{ready++;}});
  const s=fs.readFileSync('public/js/client-ol.js','utf8');
  vm.runInContext(s.slice(s.indexOf('  function ensureStartupOverlay()'),s.indexOf('  async function bootWithSQLiteGate()')),c);
  return {c,timers,ready:()=>ready,fire(id){const t=timers.get(id);timers.delete(id);now+=t.ms;t.fn();}};
}
test('loading mounts in the modal top layer, cannot be dismissed and releases it only after completion',async()=>{
  const f=fixture(),c=f.c;c.showStartupOverlay('Loading',false);
  assert.equal(c.startupOverlayEl.tagName,'dialog');assert.equal(c.startupOverlayEl.open,false);
  f.fire(c.startupOverlayShowTimer);assert.equal(c.startupOverlayEl.open,true);
  let prevented=false;c.startupOverlayEl.events.cancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);
  assert.equal(c.window.BearStartupLoading,true);assert.equal(f.ready(),0);
  const done=c.hideStartupOverlay();assert.equal(c.startupOverlayEl.open,true);
  f.fire([...f.timers.keys()][0]);await done;
  assert.equal(c.startupOverlayEl.open,false);assert.equal(c.window.BearStartupLoading,false);assert.equal(f.ready(),1);
});
test('a quick startup cancels the delayed modal without flashing or blocking settings',async()=>{
  const f=fixture(),c=f.c;c.showStartupOverlay('Loading',false);await c.hideStartupOverlay();
  assert.equal(f.timers.size,0);assert.equal(c.startupOverlayEl.opens,0);assert.equal(f.ready(),1);
});
test('retry errors remain above other content without marking background loading complete',()=>{
  const f=fixture(),c=f.c;c.showStartupOverlay('Retry',true,true);
  assert.equal(c.startupOverlayEl.open,true);assert.equal(c.startupOverlayRetryBtn.style.display,'block');
  assert.equal(c.startupOverlayEl.attributes['aria-busy'],'false');assert.equal(f.ready(),0);
  c.showStartupOverlay('Loading',false,true);assert.equal(c.startupOverlayEl.opens,1);
  assert.equal(c.startupOverlayRetryBtn.style.display,'none');assert.equal(c.window.BearStartupLoading,true);
});
