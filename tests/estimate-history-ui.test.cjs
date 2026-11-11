const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {parse,HTMLElement}=require('node-html-parser');
const events=new WeakMap();
const tokens=Object.getPrototypeOf(parse('<div></div>').firstChild.classList);
tokens.toggle=function(name,force){const value=arguments.length===1?!this.contains(name):force;value?this.add(name):this.remove(name);return value;};
Object.assign(HTMLElement.prototype,{
  addEventListener(type,fn){const listeners=events.get(this)||{};(listeners[type]??=[]).push(fn);events.set(this,listeners);},
  fire(type,values={}){for(const fn of events.get(this)?.[type]||[])fn({target:this,preventDefault(){},...values});},
  append(...nodes){nodes.forEach(node=>this.appendChild(node));},
  replaceChildren(...nodes){this.childNodes.slice().forEach(node=>node.remove());this.append(...nodes);},
  showModal(){this.setAttribute('open','');},close(){this.removeAttribute('open');},
  scrollIntoView(){this.scrolledIntoView=true;},focus(){this.receivedFocus=true;}
});
Object.defineProperties(HTMLElement.prototype,{
  className:{get(){return this.getAttribute('class')||'';},set(value){this.setAttribute('class',value);}},
  hidden:{get(){return this.hasAttribute('hidden');},set(value){value?this.setAttribute('hidden',''):this.removeAttribute('hidden');}},
  open:{get(){return this.hasAttribute('open');}},
  elements:{get(){return new Proxy({},{get:(_,key)=>this.querySelector('[name="'+key+'"]')});}},
  value:{get(){return this.getAttribute('value')??this.querySelector('option')?.getAttribute('value')??'';},set(value){this.setAttribute('value',value);}},
  dataset:{get(){return new Proxy({},{get:(_,key)=>this.getAttribute('data-'+key),set:(_,key,value)=>{this.setAttribute('data-'+key,value);return true;}});}}
});
async function setup(loadItems){
  const modules=await Promise.all(['ol/Feature.js','ol/geom/Point.js','ol/geom/LineString.js','ol/source/Vector.js','ol/style/Style.js','ol/style/Stroke.js','ol/style/Fill.js','ol/style/Circle.js','ol/style/RegularShape.js','ol/style/Text.js'].map(path=>import(path).then(module=>module.default)));
  const [Feature,Point,LineString,Vector,Style,Stroke,Fill,Circle,RegularShape,Text]=modules;
  let instance,unregistered=0,back;
  class MapMock{
    constructor(options){this.options=options;this.handlers={};instance=this;}
    getView(){return {fit(){},animate:options=>{this.lastMove=options;this.sizeAtMove=this.sizeUpdates;},getZoom:()=>10,getResolution:()=>this.resolution||.0001};}updateSize(){this.sizeUpdates=(this.sizeUpdates||0)+1;}setTarget(value){this.target=value;}dispose(){this.disposed=true;}
    on(type,fn){this.handlers[type]=fn;}
    forEachFeatureAtPixel(_pixel,callback){return callback(this.hitFeature);}
    getPixelFromCoordinate(){return [100,100];}
  }
  class Layer{constructor(options){this.source=options.source;}setSource(value){this.source=value;}}
  class Icon{constructor(options){this.options=options;}getSrc(){return this.options.src;}}
  const body=parse('<body></body>').firstChild;
  const documentEvents={},frames=new Map();let frameId=0;
  const motion={matches:false,addEventListener(type,fn){this.change=fn;}};
  const document={body,hidden:false,createElement:tag=>parse('<'+tag+'></'+tag+'>').firstChild,activeElement:null,addEventListener(type,fn){documentEvents[type]=fn;}};
  const root={BearObservationFilters:require('../public/js/obs/observation-filters'),BearEstimateHistoryModel:require('../public/js/realtime/estimate-history-model'),
    BearEstimateHistoryMarkers:require('../public/js/realtime/estimate-history-markers'),
    matchMedia:query=>query.includes('reduced-motion')?motion:{matches:false},addEventListener(){},
    requestAnimationFrame(fn){if(fn.name==='animateHistory'){frames.set(++frameId,fn);return frameId;}fn();return 0;},cancelAnimationFrame:id=>frames.delete(id)};
  vm.runInNewContext(fs.readFileSync('public/js/realtime/estimate-history-ui.js','utf8'),{window:root,document,AbortController,Date});
  const api=root.createEstimateHistoryUi({ol:{Map:MapMock,View:class{},Feature,geom:{Point,LineString},source:{Vector},layer:{Tile:Layer,Vector:Layer},
    proj:{transform:coords=>coords},style:{Style,Stroke,Fill,Circle,RegularShape,Text,Icon},control:{defaults:{defaults:()=>[]}}},
    projection:'EPSG:4326',getBaseLayers:()=>[],loadItems,registerBack(_dialog,fn){back=fn;return()=>unregistered++;}});
  return {api,body,dialog:body.querySelector('dialog'),map:()=>instance,back:()=>back(),unregistered:()=>unregistered,document,documentEvents,motion,frames,
    frame(timestamp){const next=frames.entries().next().value;if(next){frames.delete(next[0]);next[1](timestamp);}}};
}
const row=(id,day)=>({id,bear_code:'MH-001',lat:35,lng:127+day/100,created_at:`2026-11-${String(day).padStart(2,'0')} 12:00:00`,estimation_method:'intersection'});
test('history starts with the clicked point selected, filters dates, expands its list and closes cleanly',async()=>{
  const seed=row('current',10),old=row('old',9);
  const e=await setup(async()=>({items:[seed,old]}));await e.api.open(seed);
  assert.equal(e.api.isOpen(),true);
  assert.equal(e.dialog.querySelector('h2').textContent,'MH-001');
  assert.equal(e.dialog.querySelector('[data-record="current"]').getAttribute('data-current'),'true');
  assert.equal(e.dialog.querySelector('[data-record="current"] .estimate-history-current').textContent,'현재');
  assert.equal(e.dialog.querySelector('[data-record="old"] .estimate-history-current'),null);
  assert.equal(e.dialog.querySelector('[data-close]'),null);
  assert.equal(e.dialog.querySelector('form').elements.period.value,'all');
  assert.equal(e.dialog.querySelector('[data-reset]').disabled,true);
  assert.equal(e.dialog.querySelectorAll('[data-record]').length,2);
  assert.match(e.dialog.querySelector('[data-card]').textContent,/2026/);
  assert.equal(e.dialog.querySelector('[data-record="current"]').getAttribute('aria-pressed'),'true');
  e.dialog.querySelector('[data-toggle]').fire('click');assert.equal(e.dialog.querySelector('.estimate-history-list').hidden,false);
  const form=e.dialog.querySelector('form');form.elements.period.value='day';form.elements.day.value='2026-11-09';form.fire('change');
  assert.equal(e.dialog.querySelectorAll('[data-record]').length,1);
  assert.match(e.dialog.querySelector('[data-count]').textContent,/1건.*전체 2건/);
  assert.ok(e.dialog.querySelector('[data-record="old"]'));
  assert.equal(e.dialog.querySelector('[data-reset]').disabled,false);
  const historicalPoint=e.map().options.layers.at(-1).source.getFeatures().find(feature=>feature.get('recordIds'));
  assert.equal(historicalPoint.getStyle()().length,1);
  e.dialog.querySelector('[data-reset]').fire('click');
  assert.equal(form.elements.period.value,'all');assert.equal(e.dialog.querySelectorAll('[data-record]').length,2);
  assert.equal(e.dialog.querySelector('[data-reset]').disabled,true);
  const map=e.map();e.back();assert.equal(e.api.isOpen(),false);assert.equal(map.disposed,true);assert.equal(e.unregistered(),1);
});
test('closing history while loading prevents a late response from reopening or replacing it',async()=>{
  let resolve;
  const e=await setup(()=>new Promise(done=>resolve=done));
  const pending=e.api.open(row('current',10));e.api.close();
  resolve({items:[row('late',11)]});await pending;
  assert.equal(e.api.isOpen(),false);assert.equal(e.dialog.querySelector('[data-record="late"]'),null);
});

test('overlapping latest and older points show a count and expose every record in a focused list',async()=>{
  const old=row('old',9),current={...row('current',11),lng:old.lng},middle=row('middle',10);
  const e=await setup(async()=>({items:[old,middle,current]}));await e.api.open(current);
  const map=e.map(),source=map.options.layers.at(-1).source;
  const grouped=source.getFeatures().find(feature=>feature.get('recordIds')?.length===2);
  assert.ok(grouped);
  const styles=grouped.getStyle()();
  const badge=decodeURIComponent(styles[0].getImage().getSrc());
  assert.match(badge,/>1<\/text>/);assert.match(badge,/>3<\/text>/);
  assert.equal(styles[1].getText().getText(),'현재');
  map.hitFeature=grouped;map.handlers.singleclick({pixel:[100,100]});
  assert.equal(e.dialog.querySelectorAll('[data-record]').length,2);
  assert.match(e.dialog.querySelector('[data-count]').textContent,/겹친 이력 2건/);
  assert.equal(e.dialog.querySelector('[data-record="middle"]'),null);
  e.dialog.querySelector('[data-record="old"]').fire('click');
  assert.equal(e.dialog.querySelector('[data-record="old"]').getAttribute('aria-pressed'),'true');
  e.dialog.querySelector('[data-clear-group]').fire('click');
  assert.equal(e.dialog.querySelectorAll('[data-record]').length,3);
  map.resolution=1;map.handlers.moveend();
  assert.equal(source.getFeatures().filter(feature=>feature.get('recordIds')).length,1);
  e.api.close();
});

test('the list uses the shared chevron and loads further records by scrolling without a More button',async()=>{
  const rows=Array.from({length:75},(_,index)=>({...row(String(index),1),created_at:new Date(Date.UTC(2026,10,1)+index*60000).toISOString()}));
  const e=await setup(async()=>({items:rows}));await e.api.open(rows.at(-1));
  const toggle=e.dialog.querySelector('[data-toggle]');
  assert.ok(toggle.querySelector('svg'));assert.equal(e.dialog.querySelectorAll('[data-record]').length,30);
  toggle.fire('click');assert.equal(toggle.getAttribute('aria-expanded'),'true');assert.ok(toggle.querySelector('svg'));
  const list=e.dialog.querySelector('.estimate-history-list');
  list.clientHeight=200;list.scrollHeight=1200;list.scrollTop=1000;list.fire('scroll');
  assert.equal(e.dialog.querySelectorAll('[data-record]').length,60);assert.equal(list.scrollTop,1000);
  assert.doesNotMatch(list.textContent,/더 보기/);e.api.close();
});

test('tapping an individual numbered circle selects and scrolls to that exact list row',async()=>{
  const old=row('old',9),middle={...row('middle',10),lng:old.lng},current={...row('current',11),lng:old.lng};
  const e=await setup(async()=>({items:[old,middle,current]}));await e.api.open(current);
  const map=e.map(),feature=map.options.layers.at(-1).source.getFeatures().find(feature=>feature.get('recordIds'));
  feature.getStyle()();map.hitFeature=feature;
  const badge=feature.get('historyBadge');
  for(const [position,id]of ['old','middle','current'].entries()){
    const beforeResize=map.sizeUpdates;
    map.handlers.singleclick({pixel:[100-badge.width/2+18+position*32,100-badge.height+20]});
    const selected=e.dialog.querySelector('[data-record="'+id+'"]');
    assert.equal(selected.getAttribute('aria-pressed'),'true');
    assert.equal(selected.scrolledIntoView,true);assert.equal(selected.receivedFocus,true);
    assert.equal(e.dialog.querySelector('.estimate-history-list').hidden,false);
    assert.equal(e.dialog.querySelectorAll('[data-record]').length,3);
    const point={old,middle,current}[id];
    assert.deepEqual(Array.from(map.lastMove.center),[point.lng,point.lat]);
    assert.ok(map.sizeAtMove>beforeResize);
    assert.equal(map.lastMove.zoom,undefined);
  }
  e.api.close();
});

test('route dashes and current ring animate, pause in the background, and stop on close or reduced motion',async()=>{
  const old=row('old',9),current=row('current',11);
  const e=await setup(async()=>({items:[old,current]}));await e.api.open(current);
  const features=e.map().options.layers.at(-1).source.getFeatures();
  const line=features.find(feature=>feature.getGeometry().getType()==='LineString');
  const marker=features.find(feature=>feature.get('recordIds')?.includes('current'));
  const styles=marker.getStyle()(),ring=styles.at(-1).getImage();
  assert.equal(e.frames.size,1);e.frame(100);e.frame(500);
  assert.notEqual(line.getStyle().getStroke().getLineDashOffset(),0);assert.ok(ring.getRadius()>13);
  e.document.hidden=true;e.documentEvents.visibilitychange();assert.equal(e.frames.size,0);
  e.document.hidden=false;e.documentEvents.visibilitychange();assert.equal(e.frames.size,1);
  e.motion.matches=true;e.motion.change();assert.equal(e.frames.size,0);assert.equal(ring.getRadius(),13);
  e.motion.matches=false;e.motion.change();assert.equal(e.frames.size,1);
  e.api.close();assert.equal(e.frames.size,0);
});
