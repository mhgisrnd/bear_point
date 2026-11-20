const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('public/js/client-ol.js','utf8');
function extract(name){const start=source.indexOf('  function '+name+'(');return source.slice(start,source.indexOf('\n  }',start)+4);}

test('compass heading uses the displayed top edge for all screen rotations',()=>{
  const context={window:{screen:{orientation:{angle:0}},orientation:-90}};
  vm.createContext(context);
  for(const name of ['norm360','getScreenAngle','computeHeadingFromEvent'])vm.runInContext(extract(name),context);
  for(const [screenAngle,alpha] of [[0,315],[90,45],[180,135],[270,225]]){
    context.window.screen.orientation.angle=screenAngle;
    assert.equal(context.computeHeadingFromEvent({alpha},context.getScreenAngle()),45);
  }
  delete context.window.screen.orientation;
  assert.equal(context.getScreenAngle(),270);
  assert.equal(context.computeHeadingFromEvent({alpha:280},context.getScreenAngle()),350);
  assert.equal(context.computeHeadingFromEvent({alpha:null},context.getScreenAngle()),null);
});

async function startTestCompass(){
  const samples=[];
  const window=new EventTarget();
  const document=new EventTarget();
  const orientation=Object.assign(new EventTarget(),{angle:0});
  window.screen={orientation};
  const timers=new Map();
  let timerId=0;
  window.setTimeout=(callback,delay)=>{timers.set(++timerId,{callback,delay});return timerId;};
  window.clearTimeout=id=>timers.delete(id);
  const context={window,document,compassEnabled:false,compassHandler:null,compassEventName:null,removeCompassScreenListener:null,
    headingSmoothed:null,pendingHeadingJump:null,lastAbsoluteSampleTs:0,lastSensorHeadingDeg:null,headingDialEl:null,
    applyHeadingOffset:heading=>heading,fuseHeadingWithGps:heading=>heading,setHeading:heading=>samples.push(heading),scheduleHeadingTurn(){}};
  vm.createContext(context);
  vm.runInContext(source.match(/const COMPASS_CFG = \{[\s\S]*?\n  \};/)[0],context);
  for(const name of ['norm360','angleDelta','getScreenAngle','computeHeadingFromEvent','clearHeadingJump','filterHeading','stopCompass'])vm.runInContext(extract(name),context);
  const start=source.indexOf('  async function startCompass(');
  vm.runInContext(source.slice(start,source.indexOf('\n  }',start)+4),context);
  await context.startCompass();
  return {context,document,orientation,samples,timers,
    sample(heading){window.dispatchEvent(Object.assign(new Event('deviceorientation'),{alpha:(360-heading)%360}));}};
}

test('rotating the screen reapplies the most recent direction without waiting for another sample',async()=>{
  const {context,orientation,samples,sample}=await startTestCompass();
  sample(30);
  orientation.angle=90;
  orientation.dispatchEvent(new Event('change'));
  orientation.angle=270;
  orientation.dispatchEvent(new Event('change'));
  assert.deepEqual(samples,[30,120,300]);

  context.stopCompass();
  orientation.angle=0;
  orientation.dispatchEvent(new Event('change'));
  assert.deepEqual(samples,[30,120,300]);
});

test('a brief compass spike is held back and a sustained new direction across north is accepted',async()=>{
  const {context,samples,timers,sample}=await startTestCompass();
  sample(180);
  for(const heading of [270,271,272])sample(heading);
  assert.equal(timers.size,1);
  assert.equal(samples.at(-1),180);
  sample(180);
  assert.equal(timers.size,0);
  assert.equal(samples.at(-1),180);

  for(const heading of [358,2,3])sample(heading);
  assert.equal(samples.at(-1),180);
  assert.equal(timers.size,1);
  const [id,{callback,delay}]=timers.entries().next().value;
  assert.equal(delay,250);
  timers.delete(id);
  callback();
  assert.equal(samples.at(-1),3);
  assert.equal(context.pendingHeadingJump,null);
  sample(7);
  assert.equal(samples.at(-1),4);
});

test('a pending compass jump is discarded on backgrounding or when the compass stops',async()=>{
  const {context,document,samples,timers,sample}=await startTestCompass();
  sample(180);
  for(const heading of [270,271,272])sample(heading);
  document.hidden=true;
  document.dispatchEvent(new Event('visibilitychange'));
  assert.equal(timers.size,0);
  for(const heading of [270,271,272])sample(heading);
  assert.equal(timers.size,0);
  assert.equal(samples.at(-1),180);

  document.hidden=false;
  document.dispatchEvent(new Event('visibilitychange'));
  for(const heading of [270,271,272])sample(heading);
  assert.equal(timers.size,1);
  context.stopCompass();
  assert.equal(timers.size,0);
});

test('manual heading handle hit area follows the rendered handle at every map rotation',()=>{
  for(const rotation of [0,Math.PI/2,-Math.PI/2,Math.PI]){
    const context={Number,Math,Array,window:{},lastLatLng:[35,127],lastHeadingDeg:0,
      MAP_HEADING_HANDLE_LENGTH_PX:60,MAP_COORD_DRAG_HIT_RADIUS_PX:46,MAP_HEADING_DRAG_HIT_HANDLE_RADIUS_PX:34,MAP_HEADING_DRAG_HIT_LINE_HALF_WIDTH_PX:18,
      view:{getResolution:()=>2},mapCoordFromWgs84:()=>[1000,2000],
      controlsManager:null,obsRegisterModule:{isManualMapControlEnabled:()=>true},
      map:{getPixelFromCoordinate(c){const x=(c[0]-1000)/2,y=-(c[1]-2000)/2;return [400+x*Math.cos(rotation)-y*Math.sin(rotation),300+x*Math.sin(rotation)+y*Math.cos(rotation)];}}};
    vm.createContext(context);
    for(const name of ['getObservationDeclinationDeg','getObservationMapHeading','getHeadingHandleCoordinate','getManualMarkerCenterPixel','pointToSegmentDistancePx','getManualHitType'])vm.runInContext(extract(name),context);
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
