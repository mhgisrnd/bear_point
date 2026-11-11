const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('public/js/client-ol.js','utf8');
function extract(name){const start=source.indexOf('  function '+name+'(');return source.slice(start,source.indexOf('\n  }',start)+4);}

test('manual heading handle hit area follows the rendered handle at every map rotation',()=>{
  for(const rotation of [0,Math.PI/2,-Math.PI/2,Math.PI]){
    const context={Number,Math,Array,lastLatLng:[35,127],lastHeadingDeg:0,
      MAP_HEADING_HANDLE_LENGTH_PX:60,MAP_COORD_DRAG_HIT_RADIUS_PX:46,MAP_HEADING_DRAG_HIT_HANDLE_RADIUS_PX:34,MAP_HEADING_DRAG_HIT_LINE_HALF_WIDTH_PX:18,
      view:{getResolution:()=>2},mapCoordFromWgs84:()=>[1000,2000],
      controlsManager:null,obsRegisterModule:{isManualMapControlEnabled:()=>true},
      map:{getPixelFromCoordinate(c){const x=(c[0]-1000)/2,y=-(c[1]-2000)/2;return [400+x*Math.cos(rotation)-y*Math.sin(rotation),300+x*Math.sin(rotation)+y*Math.cos(rotation)];}}};
    vm.createContext(context);
    for(const name of ['getHeadingHandleCoordinate','getManualMarkerCenterPixel','pointToSegmentDistancePx','getManualHitType'])vm.runInContext(extract(name),context);
    for(const heading of [0,90,225]){
      context.lastHeadingDeg=heading;
      const handle=context.getHeadingHandleCoordinate([1000,2000],heading);
      assert.equal(context.getManualHitType({pixel:context.map.getPixelFromCoordinate(handle)}),'heading');
      assert.equal(context.getManualHitType({pixel:[400,300]}),'center');
    }
  }
});

test('my-location button cycles follow → heading-up → off and the compass target is north',async()=>{
  const anims=[];let stopped=0;
  const context={Number,Math,trackMode:'on',isMyVisible:true,lastSensorHeadingDeg:90,lastTrackedLatLng:[35,127],
    TRACK_MODE_TITLES:{},statusEl:{textContent:''},locateBtnEl:{dataset:{},title:'',setAttribute(){}},
    mapCoordFromWgs84:()=>[1,2],view:{cancelAnimations(){},animate(a){anims.push(a);}},
    stopMyLocationTracking(){stopped++;},toggleMyLocation:async()=>{}};
  vm.createContext(context);
  vm.runInContext(extract('setTrackMode'),context);
  const start=source.indexOf('  async function cycleMyLocation(');
  vm.runInContext(source.slice(start,source.indexOf('\n  }',start)+4),context);
  await context.cycleMyLocation();
  assert.equal(context.locateBtnEl.dataset.mode,'follow');const follow=anims.pop();assert.equal(follow.center[0],1);assert.equal(follow.rotation,undefined);
  await context.cycleMyLocation();
  assert.equal(context.trackMode,'heading');assert.equal(anims.pop().rotation,-Math.PI/2);
  await context.cycleMyLocation();
  assert.equal(stopped,1);
  context.trackMode='follow';context.lastSensorHeadingDeg=null;
  await context.cycleMyLocation();
  assert.equal(context.trackMode,'follow');assert.match(context.statusEl.textContent,/방향 센서/);
});

test('heading mode eases toward the target and turns the short way across north',()=>{
  const context={Math,Array};vm.createContext(context);
  for(const name of ['norm360','angleDelta','nextHeadingView'])vm.runInContext(extract(name),context);
  const across=context.nextHeadingView(350,10,null,null,0.5);
  assert.equal(across.rotationDeg,360);// 350→10은 +20° 쪽으로 반 이동, -340°로 돌지 않는다
  const back=context.nextHeadingView(10,350,null,null,0.5);
  assert.equal(back.rotationDeg,0);
  const done=context.nextHeadingView(90,90.05,[0,0],[0.1,0],0.5);
  assert.equal(done.rotationDeg,null);assert.equal(done.center,null);// 다 왔으면 멈춘다
  const move=context.nextHeadingView(0,0,[0,0],[10,20],0.25);
  assert.equal(move.center[0],2.5);assert.equal(move.center[1],5);
});

test('two-finger and Alt+Shift rotation do not start or continue manual coordinate dragging',()=>{
  for(const type of ['pointerdown','pointerdrag']){
    let callback,stops=0,hits=0;
    const context={map:{on(name,fn){callback=fn;}},stopManualMapGesture(){stops++;},getManualHitType(){hits++;return 'center';}};
    const start=source.indexOf('  map.on("'+type+'", function (event) {'),end=source.indexOf('\n  });',start)+6;
    vm.runInNewContext(source.slice(start,end),context);
    callback({activePointers:[{},{}],originalEvent:{}});
    callback({activePointers:[{}],originalEvent:{altKey:true,shiftKey:true}});
    assert.equal(stops,2);assert.equal(hits,0);
  }
});
