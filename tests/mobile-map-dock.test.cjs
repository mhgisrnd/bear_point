const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {parse,HTMLElement}=require('node-html-parser');
const tokens=Object.getPrototypeOf(parse('<div></div>').firstChild.classList);
const originalToggle=tokens.toggle;
tokens.toggle=function(name,force){if(arguments.length<2)return originalToggle.call(this,name);force?this.add(name):this.remove(name);return force;};

const styles=new WeakMap(),listeners=new WeakMap();
function insert(parent,node,before){node.remove();const index=before?parent.childNodes.indexOf(before):parent.childNodes.length;parent.childNodes.splice(index<0?parent.childNodes.length:index,0,node);node.parentNode=parent;return node;}
Object.assign(HTMLElement.prototype,{
  before(node){insert(this.parentNode,node,this);},
  insertBefore(node,before){return insert(this,node,before);},
  append(...nodes){nodes.forEach(node=>insert(this,node));},
  addEventListener(type,callback){const map=listeners.get(this)||{};(map[type]??=[]).push(callback);listeners.set(this,map);},
  click(){for(const callback of listeners.get(this)?.click||[])callback({preventDefault(){},stopImmediatePropagation(){}});},
  getBoundingClientRect(){return {left:0,top:500,width:390,height:this.id==='mobile-map-dock'?110:220};}
});
Object.defineProperties(HTMLElement.prototype,{
  hidden:{get(){return this.hasAttribute('hidden');},set(value){value?this.setAttribute('hidden',''):this.removeAttribute('hidden');}},
  className:{get(){return this.getAttribute('class')||'';},set(value){this.setAttribute('class',value);}},
  style:{get(){if(!styles.has(this))styles.set(this,{setProperty(key,value){this[key]=value;},removeProperty(key){delete this[key];}});return styles.get(this);}},
  dataset:{get(){return new Proxy({},{get:(_,key)=>this.getAttribute('data-'+String(key).replace(/[A-Z]/g,c=>'-'+c.toLowerCase())),set:(_,key,value)=>{this.setAttribute('data-'+key,value);return true;}});}}
});
function environment(tabletMode=false){
  const dom=parse(fs.readFileSync('public/index.html','utf8'),{comment:true});
  const body=dom.querySelector('body');
  const document={body,getElementById:id=>dom.querySelector('#'+id),querySelector:selector=>dom.querySelector(selector),
    createElement:tag=>parse(`<${tag}></${tag}>`).firstChild,createComment:text=>parse(`<!--${text}-->`,{comment:true}).firstChild};
  const track=document.createElement('section');track.className='gps-track-panel';track.hidden=true;track.innerHTML='<header><div class="gps-track-header-actions"><button data-start>기록 시작</button></div></header>';body.append(track);
  const mq={matches:tabletMode,addEventListener(_event,fn){this.change=fn;}};
  const observers=[];
  class Observer{constructor(fn){this.fn=fn;this.targets=[];observers.push(this);}observe(target){this.targets.push(target);}}
  const root={innerHeight:844,matchMedia:()=>mq,requestAnimationFrame:fn=>fn(),addEventListener(){}};
  const calls={open:0,show:0,gpsOpen:0,gpsClose:0,bears:0,mapVisible:true};let tab='none';
  const observations={setMapVisible:value=>{calls.mapVisible=value;},getCurrentTab:()=>tab,openList(){calls.open++;tab='list';document.getElementById('obs-sheet').classList.remove('hidden');root.BearMobileDock.select('observations',{activate:false});},showPanel(){calls.show++;root.BearMobileDock.select('observations',{activate:false});}};
  const gps={panel:track,open(){calls.gpsOpen++;track.hidden=false;root.BearMobileDock.select('tracking',{activate:false});},close(){calls.gpsClose++;track.hidden=true;if(root.BearMobileDock?.getActive()==='tracking')root.BearMobileDock.collapse();},refreshPlacement(){}};
  vm.runInNewContext(fs.readFileSync('public/js/mobile-map-dock.js','utf8'),{window:root,document,MutationObserver:Observer,ResizeObserver:Observer});
  const originalObsParent=document.getElementById('obs-sheet').parentNode,originalBearsParent=document.getElementById('panel').parentNode;
  const api=root.createMobileMapDock({observations,gps,expandBears:()=>calls.bears++,setSidebarCollapsed:value=>{calls.sidebarCollapsed=value;body.classList.toggle('bp-sidebar-collapsed',value);}});
  const trigger=element=>observers.filter(observer=>observer.targets.includes(element)).forEach(observer=>observer.fn());
  function dispatch(element,type,properties={}){for(const fn of listeners.get(element)?.[type]||[])fn({pointerId:1,button:0,isPrimary:true,cancelable:true,preventDefault(){},...properties});}
  return {api,root,document,mq,calls,track,trigger,dispatch,originalObsParent,originalBearsParent};
}
test('mobile uses one bounded dock with three menus and preserves the existing list nodes on switches',()=>{
  const env=environment(),doc=env.document,dock=doc.getElementById('mobile-map-dock');
  const obs=doc.getElementById('obs-sheet'),bears=doc.getElementById('panel');
  assert.equal(dock.querySelectorAll('[data-menu]').length,3);
  assert.equal(env.api.isMobile(),true);assert.equal(dock.classList.contains('is-expanded'),false);
  env.api.select('observations');assert.equal(env.calls.open,1);assert.equal(obs.parentNode.id,'mobile-dock-content');
  assert.equal(obs.classList.contains('mobile-dock-inactive'),false);assert.equal(bears.classList.contains('mobile-dock-inactive'),true);
  env.api.select('bears');assert.equal(env.calls.bears,1);assert.equal(doc.getElementById('obs-sheet'),obs);
  env.api.select('observations');assert.equal(env.calls.open,1);assert.equal(env.calls.show,1);
  dock.querySelector('[data-menu="observations"]').click();assert.equal(dock.classList.contains('is-expanded'),false);
  dock.querySelector('[data-menu="observations"]').click();assert.equal(dock.classList.contains('is-expanded'),true);
});
test('detail selection reduces the list and upward dragging restores it without resetting search',()=>{
  const env=environment(),dock=env.document.getElementById('mobile-map-dock');
  env.api.select('bears');
  const fold=dock.querySelector('.mobile-dock-fold');
  const input=env.document.getElementById('bear-code-search-form').querySelector('input');
  input.setAttribute('value','KM-118');
  env.api.prepareDetail();
  assert.equal(dock.classList.contains('is-full'),false);
  assert.equal(dock.classList.contains('is-detail'),true);
  assert.equal(input.getAttribute('value'),'KM-118');
  env.dispatch(fold,'pointerdown',{clientY:500});
  env.dispatch(fold,'pointermove',{clientY:350});
  env.dispatch(fold,'pointerup',{clientY:350});
  assert.equal(dock.classList.contains('is-detail'),false);
  assert.equal(dock.classList.contains('is-full'),true);
});

test('search completion releases focus except during IME composition; details also release search focus',()=>{
  const env=environment(),dock=env.document.getElementById('mobile-map-dock');
  let blurred=0;
  const input={matches:selector=>selector==='input.list-search-input',blur(){blurred++;}};
  env.dispatch(dock,'keydown',{key:'Enter',isComposing:true,target:input});
  env.dispatch(dock,'keydown',{key:'Enter',keyCode:229,target:input});
  assert.equal(blurred,0);
  env.dispatch(dock,'keydown',{key:'Enter',target:input});
  assert.equal(blurred,1);
  env.document.activeElement=input;
  env.api.prepareDetail();
  assert.equal(blurred,2);
});

test('tap folding animates sheet height and keeps closing content inert until completion',async()=>{
  const env=environment(),dock=env.document.getElementById('mobile-map-dock');
  const content=dock.querySelector('.mobile-dock-content'),animations=[];
  env.root.matchMedia=()=>({matches:false});
  dock.getBoundingClientRect=()=>({height:dock.classList.contains('is-expanded')?300:100});
  dock.animate=(frames,options)=>{
    let finish,reject;
    const animation={frames,options,finished:new Promise((resolve,fail)=>{finish=resolve;reject=fail;}),cancel(){reject();},finish(){finish();}};
    animations.push(animation);return animation;
  };
  env.api.select('bears');
  assert.equal(animations.length,1);
  assert.equal(animations[0].frames[0].height,'100px');
  assert.equal(animations[0].frames[1].height,'300px');
  animations[0].finish();await Promise.resolve();
  env.api.collapse();
  assert.equal(content.hidden,false);assert.equal(content.hasAttribute('inert'),true);
  assert.equal(animations[1].frames[1].height,'100px');
  animations[1].finish();await Promise.resolve();
  assert.equal(content.hidden,true);assert.equal(dock.classList.contains('is-sliding'),false);
  env.root.matchMedia=()=>({matches:true});
  env.api.select('bears');assert.equal(animations.length,2);
});

test('recording indicator persists across menu changes; folding the dock does not stop GPS',()=>{
  const env=environment(),dock=env.document.getElementById('mobile-map-dock');
  env.api.select('tracking');assert.equal(env.calls.gpsOpen,1);assert.equal(env.track.hidden,false);
  assert.ok(dock.querySelector('.mobile-dock-actions .gps-track-header-actions'));
  const legacy=env.document.getElementById('btn-gps-tracking');legacy.classList.add('is-recording');env.trigger(legacy);
  assert.equal(dock.querySelector('.mobile-recording-dot').hidden,false);
  env.api.collapse();assert.equal(env.track.hidden,false);
  env.api.select('bears');assert.equal(env.track.hidden,true);
  assert.ok(env.track.querySelector('header .gps-track-header-actions'));
  assert.equal(dock.querySelector('.mobile-recording-dot').hidden,false);
});
test('folding the observation menu preserves markers and switching menus hides them',()=>{
  const env=environment();assert.equal(env.calls.mapVisible,false);
  env.api.select('observations');assert.equal(env.calls.mapVisible,true);
  env.api.collapse();assert.equal(env.calls.mapVisible,true);
  env.api.select('observations');assert.equal(env.calls.mapVisible,true);assert.equal(env.calls.open,1);
  env.api.select('bears');assert.equal(env.calls.mapVisible,false);
  env.api.select('tracking');assert.equal(env.calls.mapVisible,false);
  env.api.select('observations');env.mq.matches=true;env.mq.change();assert.equal(env.calls.mapVisible,true);
});
test('tablet and phone share the same views and actions while rotation preserves the active menu',()=>{
  const env=environment(true),doc=env.document;
  assert.equal(env.api.isMobile(),false);assert.equal(doc.getElementById('panel').parentNode.id,'mobile-dock-content');
  assert.equal(doc.body.classList.contains('bp-tablet-dock'),true);assert.equal(doc.getElementById('mobile-map-dock').hidden,false);
  env.mq.matches=false;env.mq.change();env.api.select('observations');
  assert.equal(doc.getElementById('btn-obs-add-inline').closest('.mobile-dock-actions')!==null,true);
  env.mq.matches=true;env.mq.change();
  assert.equal(doc.getElementById('obs-sheet').parentNode.id,'mobile-dock-content');
  assert.equal(doc.getElementById('panel').parentNode.id,'mobile-dock-content');
  assert.equal(doc.getElementById('btn-obs-add-inline').closest('.mobile-dock-actions')!==null,true);
  assert.equal(doc.getElementById('mobile-map-dock').hidden,false);assert.equal(env.api.getActive(),'observations');
});
test('tablet menus share one sidebar and its existing collapse control hides observation markers',()=>{
  const env=environment(true),doc=env.document,dock=doc.getElementById('mobile-map-dock');
  env.api.select('observations');assert.equal(env.calls.mapVisible,true);assert.equal(env.calls.sidebarCollapsed,false);
  assert.ok(dock.querySelector('.mobile-dock-actions .obs-header-actions'));
  dock.querySelector('[data-menu="observations"]').click();assert.equal(env.calls.sidebarCollapsed,false);
  env.api.collapse();env.trigger(doc.body);assert.equal(env.calls.mapVisible,false);assert.equal(env.calls.sidebarCollapsed,true);
  assert.equal(dock.hasAttribute('inert'),true);
  env.api.select('tracking');assert.equal(env.calls.sidebarCollapsed,false);assert.equal(env.calls.mapVisible,false);
  assert.equal(dock.hasAttribute('inert'),false);
  assert.ok(dock.querySelector('.mobile-dock-actions .gps-track-header-actions'));
  assert.equal(doc.getElementById('obs-sheet').classList.contains('mobile-dock-inactive'),true);
  env.api.select('bears');assert.equal(doc.getElementById('panel').classList.contains('mobile-dock-inactive'),false);
});
test('registration folds the dock without resetting list state and restores it after closing',()=>{
  const env=environment(),doc=env.document,dock=doc.getElementById('mobile-map-dock');
  env.api.select('observations');const registration=doc.getElementById('register-box');
  registration.classList.remove('hidden');env.trigger(registration);
  assert.equal(dock.classList.contains('is-expanded'),false);
  env.api.select('bears');assert.equal(env.api.getActive(),'observations');
  registration.classList.add('hidden');env.trigger(registration);
  assert.equal(dock.classList.contains('is-expanded'),true);assert.equal(env.calls.open,1);
});

test('registration keeps observation markers visible and saving opens the observation menu after the form closes',()=>{
  for(const tablet of [false,true]){
    const env=environment(tablet),doc=env.document,registration=doc.getElementById('register-box');
    env.api.select('bears');
    registration.classList.remove('hidden');env.trigger(registration);
    assert.equal(env.calls.mapVisible,true);
    env.api.showObservationsAfterSave();
    assert.equal(env.api.getActive(),'bears');
    registration.classList.add('hidden');env.trigger(registration);
    assert.equal(env.api.getActive(),'observations');
    assert.equal(doc.getElementById('mobile-map-dock').classList.contains('is-expanded'),true);
    assert.equal(env.calls.mapVisible,true);
  }
});

test('cancelling registration from another menu restores that menu and hides observation markers',()=>{
  const env=environment(),registration=env.document.getElementById('register-box');
  env.api.select('tracking');registration.classList.remove('hidden');env.trigger(registration);
  assert.equal(env.calls.mapVisible,true);
  registration.classList.add('hidden');env.trigger(registration);
  assert.equal(env.api.getActive(),'tracking');assert.equal(env.calls.mapVisible,false);
});
test('status uses an overlay toast across menus without adding rows or replaying on menu changes',()=>{
  const env=environment(),doc=env.document;env.api.select('observations');
  const messages=[];env.root.__bpShowToast=text=>messages.push(text);
  const status=doc.getElementById('status');
  status.textContent='삭제 취소됨';env.trigger(status);assert.deepEqual(messages,['삭제 취소됨']);
  env.api.select('bears');assert.equal(messages.length,1);
  status.textContent='저장 완료';env.trigger(status);assert.equal(messages.at(-1),'저장 완료');
  status.textContent='반달가슴곰 위치추적분석';env.trigger(status);assert.equal(messages.length,2);
  assert.equal(doc.querySelector('.mobile-dock-notice'),null);
});
test('tracking filters can reserve more list space without affecting other menus',()=>{
  const env=environment(),dock=env.document.getElementById('mobile-map-dock');
  env.api.select('tracking');assert.equal(dock.classList.contains('is-filtering'),false);
  env.api.setFiltersOpen(true);assert.equal(dock.classList.contains('is-filtering'),true);
  env.api.setFiltersOpen(false);assert.equal(dock.classList.contains('is-filtering'),false);
  env.api.setFiltersOpen(true);env.api.select('bears');assert.equal(dock.classList.contains('is-filtering'),false);
  env.api.select('tracking');assert.equal(dock.classList.contains('is-filtering'),false);
});
test('mouse/touch header drag follows motion and snaps open or closed without a second click toggle',()=>{
  const env=environment(),dock=env.document.getElementById('mobile-map-dock'),fold=dock.querySelector('.mobile-dock-fold');
  env.dispatch(fold,'pointerdown',{clientY:500});env.dispatch(fold,'pointermove',{clientY:420});
  assert.equal(dock.classList.contains('is-dragging'),true);
  assert.equal(dock.style['--dock-drag-content-height'],'80px');
  env.dispatch(fold,'pointerup',{clientY:420});
  assert.equal(dock.classList.contains('is-expanded'),true);assert.equal(dock.classList.contains('is-dragging'),false);
  env.dispatch(fold,'click',{detail:1});assert.equal(dock.classList.contains('is-expanded'),true);
  env.dispatch(fold,'pointerdown',{clientY:420});env.dispatch(fold,'pointermove',{clientY:500});env.dispatch(fold,'pointerup',{clientY:500});
  assert.equal(dock.classList.contains('is-expanded'),false);
  env.dispatch(fold,'click',{detail:0});assert.equal(dock.classList.contains('is-expanded'),true);
});
test('header taps fold each menu while retaining its selection and map display',()=>{
  for(const name of ['observations','bears','tracking']){
    const env=environment(),dock=env.document.getElementById('mobile-map-dock'),fold=dock.querySelector('.mobile-dock-fold');
    env.api.select(name);
    env.dispatch(fold,'pointerdown',{clientY:500});
    env.dispatch(fold,'pointerup',{clientY:500});
    env.dispatch(fold,'click',{detail:1});
    assert.equal(dock.classList.contains('is-expanded'),false);
    assert.equal(env.api.getActive(),name);
    if(name==='observations')assert.equal(env.calls.mapVisible,true);
    if(name==='tracking')assert.equal(env.track.hidden,false);
    dock.querySelector('[data-menu="'+name+'"]').click();
    assert.equal(dock.classList.contains('is-expanded'),true);
  }
});
test('pointer cancellation restores the prior state; unrelated pointers and right clicks cannot drag',()=>{
  const env=environment(),dock=env.document.getElementById('mobile-map-dock'),fold=dock.querySelector('.mobile-dock-fold');
  env.dispatch(fold,'pointerdown',{clientY:500,button:2});env.dispatch(fold,'pointermove',{clientY:400});
  assert.equal(dock.classList.contains('is-dragging'),false);
  env.dispatch(fold,'pointerdown',{clientY:500});env.dispatch(fold,'pointermove',{clientY:400,pointerId:2});
  assert.equal(dock.classList.contains('is-dragging'),false);
  env.dispatch(fold,'pointermove',{clientY:400});env.dispatch(fold,'pointercancel');
  assert.equal(dock.classList.contains('is-expanded'),false);
  assert.equal(dock.style['--dock-drag-content-height'],undefined);
});
test('dragging farther opens a full list, then dragging down returns through half and collapsed states',()=>{
  const env=environment(),dock=env.document.getElementById('mobile-map-dock'),fold=dock.querySelector('.mobile-dock-fold');
  const drag=(from,to)=>{env.dispatch(fold,'pointerdown',{clientY:from});env.dispatch(fold,'pointermove',{clientY:to});env.dispatch(fold,'pointerup',{clientY:to});};
  drag(700,620);assert.equal(dock.classList.contains('is-full'),false);assert.equal(dock.classList.contains('is-expanded'),true);
  drag(620,560);assert.equal(dock.classList.contains('is-full'),true);
  drag(200,250);assert.equal(dock.classList.contains('is-full'),false);assert.equal(dock.classList.contains('is-expanded'),true);
  drag(250,310);assert.equal(dock.classList.contains('is-expanded'),false);
  drag(700,100);assert.equal(dock.classList.contains('is-full'),true);
  env.api.collapse();drag(700,620);assert.equal(dock.classList.contains('is-full'),false);
});
