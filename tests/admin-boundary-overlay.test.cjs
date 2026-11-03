const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const express=require('express');
const Database=require('better-sqlite3');
const {contains,displayFeature,displayOptions}=require('../public/js/db/boundary-geometry');
const {createAdminBoundaryRouter}=require('../src/routes/adminBoundaryRoutes');
const root=path.resolve(__dirname,'..');
const asset=path.join(root,'public/assets/databases/AdminBoundary.db');
function polygon(rings) {
  const count=rings.reduce((sum,ring)=>sum+ring.length,0), b=Buffer.alloc(44+rings.length*4+count*16);
  b.writeInt32LE(5,0);b.writeInt32LE(rings.length,36);b.writeInt32LE(count,40);let index=0;
  rings.forEach((ring,part)=>{b.writeInt32LE(index,44+part*4);for(const [x,y] of ring){b.writeDoubleLE(x,44+rings.length*4+index*16);b.writeDoubleLE(y,52+rings.length*4+index++*16);}});
  return b;
}
test('display simplification preserves ring closure, holes and islands without altering containment bytes',()=>{
  const bytes=polygon([[[0,0],[.0000001,0],[5,0],[10,0],[10,10],[0,10],[0,0]],[[3,3],[7,3],[7,7],[3,7],[3,3]],[[20,20],[21,20],[21,21],[20,21],[20,20]]]);
  const original=Buffer.from(bytes), feature=displayFeature({id:1,display_name:'Test',emd_code:'001'},bytes,12);
  assert.equal(feature.geometry.type,'MultiLineString');assert.equal(feature.geometry.coordinates.length,3);
  assert.ok(feature.geometry.coordinates[0].length<7);
  for(const ring of feature.geometry.coordinates)assert.deepEqual(ring[0],ring.at(-1));
  assert.equal(contains(bytes,1,1),true);assert.equal(contains(bytes,5,5),false);assert.equal(contains(bytes,20.5,20.5),true);
  assert.deepEqual(bytes,original);
  assert.throws(()=>displayOptions([127,35,126,36],12));assert.throws(()=>displayOptions([127,35,128,36],Infinity));
});
test('web viewport query is bounded, validated, and independent of point lookup',{skip:!fs.existsSync(asset)},async t=>{
  const app=express();app.use(createAdminBoundaryRouter(root));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const query of ['','?bbox=127,,128,36&zoom=12','?bbox=128,35,127,36&zoom=12','?bbox=127,35,128,36&zoom=oops'])assert.equal((await fetch(base+'/api/admin-boundaries'+query)).status,400);
  const distant=await(await fetch(base+'/api/admin-boundaries?bbox=124,32,131,39&zoom=8')).json();assert.equal(distant.features.length,0);
  const crowded=await(await fetch(base+'/api/admin-boundaries?bbox=124,32,131,39&zoom=12')).json();assert.equal(crowded.limited,true);assert.equal(crowded.features.length,0);
  const response=await fetch(base+'/api/admin-boundaries?bbox=127.5,35.2,127.8,35.5&zoom=12');
  const text=await response.text(), data=JSON.parse(text);assert.equal(response.status,200);assert.ok(data.features.length>0&&data.features.length<=80);assert.ok(text.length<1000000);
  const {default:GeoJSON}=await import('ol/format/GeoJSON.js');
  const features=new GeoJSON().readFeatures(data,{dataProjection:'EPSG:4326',featureProjection:'EPSG:3857'});
  assert.equal(features.length,data.features.length);assert.ok(features[0].getGeometry().getExtent()[0]>10000000);
  const lookup=await(await fetch(base+'/api/admin-boundary?lat=35.202&lng=127.462')).json();assert.match(lookup.region.name,/구례/);
});
test('native viewport boundaries and address lookup work using the offline SQLite asset only',{skip:!fs.existsSync(asset)},async t=>{
  const db=new Database(asset,{readonly:true,fileMustExist:true});t.after(()=>db.close());let queries=0;
  const window={BearBoundaryGeometry:{contains,displayFeature,displayOptions},BearSQLite:{initialize:async()=>({ready:true})},
    Capacitor:{isNativePlatform:()=>true,Plugins:{CapacitorSQLite:{isDBExists:async()=>({result:true}),createConnection:async()=>{},open:async()=>{},
      query:async({statement,values,readonly})=>{assert.equal(readonly,true);queries++;return {values:db.prepare(statement).all(...values)};}}}}};
  vm.runInNewContext(fs.readFileSync('public/js/db/admin-boundary.js','utf8'),{window,DecompressionStream,Blob,Response,Uint8Array,console,fetch:()=>{throw new Error('Offline network must not be used');}});
  assert.equal((await window.BearAdminBoundary.visible([127.5,35.2,127.8,35.5],8)).features.length,0);assert.equal(queries,0);
  const visible=await window.BearAdminBoundary.visible([127.5,35.2,127.8,35.5],12);assert.ok(visible.features.length>0);
  const before=queries;await window.BearAdminBoundary.visible([127.5,35.2,127.8,35.5],12);assert.equal(queries,before+1,'cached display features only repeat the viewport index query');
  const region=await window.BearAdminBoundary.lookup(35.202,127.462);assert.match(region.name,/구례/);
});
test('overlay coalesces map movements, ignores stale responses, and clears immediately when disabled',async()=>{
  const requests=[],events={},list=[{id:'base'},{id:'marker'}],status=[];
  class Source{constructor(){this.features=[];}clear(){this.features=[];}addFeatures(items){this.features.push(...items);}}
  class Layer{constructor(options){Object.assign(this,options);}setVisible(value){this.visible=value;}}
  const ol={source:{Vector:Source},layer:{Vector:Layer},style:{Style:class{},Stroke:class{}},proj:{transformExtent:x=>x},format:{GeoJSON:class{readFeatures(data){return data.features;}}}};
  const view={zoom:12,bounds:[127,35,128,36],getZoom(){return this.zoom;},calculateExtent(){return this.bounds;},getProjection:()=> 'EPSG:4326'};
  const map={getLayers:()=>({getArray:()=>list,insertAt:(index,layer)=>list.splice(index,0,layer)}),getView:()=>view,getSize:()=>[500,500],on:(name,handler)=>{events[name]=handler;}};
  const preferences=new Map();
  const window={localStorage:{getItem:k=>preferences.get(k),setItem:(k,v)=>preferences.set(k,v)},BearBoundaryGeometry:{MIN_DISPLAY_ZOOM:11},
    BearAdminBoundary:{visible:(bounds,zoom)=>new Promise(resolve=>{requests.push({bounds,zoom,resolve});})}};
  vm.runInNewContext(fs.readFileSync('public/js/map/admin-boundary-overlay.js','utf8'),{window,console});
  const controller=window.createAdminBoundaryOverlay({ol,map,insertBefore:list[1],onStatus:message=>status.push(message)});
  assert.equal(list[1],controller.layer);assert.equal(controller.getVisible(),false);assert.equal(requests.length,0);
  controller.setVisible(true);assert.equal(requests.length,1);
  view.bounds=[127.1,35.1,127.2,35.2];events.moveend();view.bounds=[127.3,35.3,127.4,35.4];events.moveend();
  requests[0].resolve({features:[{id:'stale'}]});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests.length,2);assert.deepEqual(Array.from(requests[1].bounds),view.bounds);assert.equal(controller.layer.source.features.length,0);
  requests[1].resolve({features:[{id:'current'}]});await new Promise(resolve=>setImmediate(resolve));assert.equal(controller.layer.source.features[0].id,'current');
  events.moveend();controller.setVisible(false);assert.equal(controller.layer.source.features.length,0);
  requests[2].resolve({features:[{id:'late'}]});await new Promise(resolve=>setImmediate(resolve));assert.equal(controller.layer.source.features.length,0);
  view.zoom=8;controller.setVisible(true);assert.equal(requests.length,3);assert.match(status.at(-1),/확대/);
});
