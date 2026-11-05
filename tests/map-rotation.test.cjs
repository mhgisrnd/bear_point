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
