const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('public/js/client-ol.js','utf8').replace(/\r\n/g,'\n');
function fixture(compass=async()=>{}){
  const watches=[],quick=[],cleared=[],positions=[];
  const context={myLocationGeneration:0,myLocationStarting:false,isMyVisible:false,watchId:null,
    USE_CAPTURE_MOCK_LOCATION:false,console:{warn(){}},statusEl:{textContent:''},
    locateBtnEl:{setAttribute(){},title:''},obsRegisterModule:null,myLocationFeature:null,
    navigator:{geolocation:{getCurrentPosition(ok,error){quick.push({ok,error});},watchPosition(ok,error){watches.push({ok,error});return watches.length;},clearWatch:id=>cleared.push(id)}},
    startCompass:compass,stopCompass(){},updateGpsHeadingSample(){},updateRegistrationPreview(){},
    updateMyLocation:(lat,lng)=>positions.push([lat,lng]),setLocateButtonActive(value){context.active=value;},myLocationSource:{clear(){context.removed=true;}}};
  vm.createContext(context);
  for(const name of ['startMyLocationTracking','stopMyLocationTracking','toggleMyLocation']){
    const match=code.match(new RegExp('  (?:async )?function '+name+'\\('));
    const start=match.index,end=code.indexOf('\n  }',start)+4;
    vm.runInContext(code.slice(start,end),context);
  }
  return {context,watches,quick,cleared,positions};
}
const position={coords:{latitude:37.5665,longitude:126.978}};

test('temporary GPS errors preserve the last marker and continue receiving; permission denial stops',async()=>{
  const f=fixture(async()=>{throw Error('sensor unavailable');}),c=f.context;
  await c.startMyLocationTracking();f.quick[0].ok(position);
  assert.equal(c.active,true);assert.equal(f.positions.length,1);
  for(const code of [2,3])f.watches[0].error({code,message:'temporary'});
  assert.equal(c.removed,undefined);assert.equal(f.cleared.length,0);assert.equal(c.active,true);
  f.watches[0].ok(position);assert.equal(f.positions.length,2);
  f.watches[0].error({code:1,message:'denied'});
  assert.equal(c.removed,true);assert.equal(c.active,false);assert.deepEqual(f.cleared,[1]);
});

test('stopping or restarting ignores late fixes and errors from the previous GPS request',async()=>{
  const f=fixture(),c=f.context;
  await c.toggleMyLocation();await c.toggleMyLocation();
  f.quick[0].ok(position);f.watches[0].ok(position);assert.equal(f.positions.length,0);
  await c.toggleMyLocation();f.watches[0].error({code:1});
  assert.equal(c.watchId,2);f.watches[1].ok(position);
  assert.equal(f.positions.length,1);assert.equal(c.active,true);
});

test('waiting for compass permission never blocks GPS acquisition',async()=>{
  const f=fixture(()=>new Promise(()=>{}));
  void f.context.startMyLocationTracking();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(f.watches.length,1);f.watches[0].ok(position);
  assert.equal(f.context.active,true);assert.equal(f.positions.length,1);
});
