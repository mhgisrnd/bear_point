const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('public/js/client-ol.js','utf8');
const start=code.indexOf('  function syncObservationPopupPlacement(');
const fn=code.slice(start,code.indexOf('\n  observationPopupContentEl.addEventListener',start));

function mobileFixture(width,height,mobile=true) {
  const style={},size=[width,height];let pixel=[width/2,height/2],offset,moves=0;
  const bounds={left:0,right:width,top:height-200,width,height:200};
  const popup={style,getBoundingClientRect:()=>({width:parseFloat(style.width),height:Math.min(340,parseFloat(style.maxHeight))})};
  const context={parseCssPx:parseFloat,document:{documentElement:{},
    querySelectorAll:()=>[{getClientRects:()=>[1],matches:()=>false,getBoundingClientRect:()=>({width:52,height:52,bottom:80})}],
    getElementById:()=>({classList:{contains:()=>false},getClientRects:()=>[1],getBoundingClientRect:()=>bounds})},
    window:{innerWidth:width,innerHeight:height,BearMobileDock:{isDocked:()=>true,isMobile:()=>mobile},getComputedStyle:()=>({getPropertyValue:()=> '0'})},
    map:{getViewport:()=>({getBoundingClientRect:()=>({left:0,top:0,width:size[0],height:size[1]})}),getPixelFromCoordinate:()=>pixel,
      getSize:()=>size,getView:()=>({centerOn:(coordinate,viewSize,target)=>{moves++;pixel=target;},getAnimating:()=>false,getInteracting:()=>false})},
    observationPopupContentEl:{querySelector:()=>({})},observationPopupEl:popup,
    observationPopupOverlay:{getPosition:()=>[127,35],setPositioning(){},setOffset:value=>{offset=value;}}};
  vm.createContext(context);vm.runInContext(fn,context);
  return {context,popup,bounds,size,pixel:()=>pixel,moves:()=>moves,setPixel:value=>{pixel=value;},card:()=>({x:pixel[0]+offset[0],y:pixel[1]+offset[1],...popup.getBoundingClientRect()})};
}

test('small mobile screens reserve visible space for the pin above a scrollable detail without repeated panning',()=>{
  for(const [width,height] of [[320,640],[390,844],[430,932]]){
    const f=mobileFixture(width,height);
    f.context.syncObservationPopupPlacement(undefined,true);
    const card=f.card(),pin=f.pixel();
    assert.ok(card.y>=18&&card.y+card.height<=f.bounds.top-18);
    assert.ok(pin[0]>=18&&pin[0]<=width-74);
    assert.ok(pin[1]>=70&&pin[1]<card.y-20,JSON.stringify({width,height,pin,card}));
    assert.equal(f.moves(),1);
    for(let n=0;n<5;n++)f.context.syncObservationPopupPlacement();
    assert.equal(f.moves(),1,'postrender must not recenter repeatedly');
    f.setPixel([-200,-200]);f.context.syncObservationPopupPlacement();
    assert.equal(f.moves(),1,'manual map movement must not be pulled back');
  }
});

test('landscape details stay left-aligned and follow the expanded menu without following the marker',()=>{
  const f=mobileFixture(1180,820,false);let expanded=true;
  Object.assign(f.bounds,{left:8,right:412,top:0,width:404,height:820});
  f.context.document.getElementById=()=>({classList:{contains:name=>name==='is-expanded'&&expanded},getClientRects:()=>[1],getBoundingClientRect:()=>f.bounds});
  f.context.observationPopupContentEl.scrollTop=75;
  f.context.syncObservationPopupPlacement(undefined,true);
  assert.equal(f.card().x,424);assert.equal(f.card().y,18);
  f.setPixel([900,600]);f.context.syncObservationPopupPlacement();
  assert.equal(f.card().x,424);assert.equal(f.card().y,18);
  expanded=false;Object.assign(f.bounds,{top:756,height:64});
  f.context.syncObservationPopupPlacement();assert.equal(f.card().x,18);
  assert.ok(f.card().y+f.card().height<756);
  expanded=true;Object.assign(f.bounds,{top:0,height:820});
  f.context.syncObservationPopupPlacement();assert.equal(f.card().x,424);
  assert.equal(f.context.observationPopupContentEl.scrollTop,75);
  assert.equal(f.moves(),0);
});

test('detail reflows after resize, while roomy layouts keep the existing marker placement',()=>{
  const f=mobileFixture(390,844);f.context.syncObservationPopupPlacement(undefined,true);
  f.size[1]=640;f.context.window.innerHeight=640;f.bounds.top=440;
  f.setPixel([195,300]);f.context.syncObservationPopupPlacement(undefined,true);
  assert.ok(f.pixel()[1]<f.card().y-20);assert.equal(f.moves(),2);
  const roomy=mobileFixture(1180,820,true);roomy.context.syncObservationPopupPlacement(undefined,true);
  assert.equal(roomy.moves(),0);
  const desktop=mobileFixture(390,844,false);desktop.context.syncObservationPopupPlacement(undefined,true);
  assert.equal(desktop.moves(),0,'desktop behavior stays unchanged');
});

test('map frames preserve the bottom scroll position and do not temporarily expand the mobile detail',()=>{
  const f=mobileFixture(390,844);
  const content=f.context.observationPopupContentEl;
  content.scrollTop=0;
  let limit;
  Object.defineProperty(f.popup.style,'maxHeight',{
    get:()=>limit,
    set:value=>{
      limit=value;
      // Simulate Chromium clamping scrollTop when the scroll viewport expands.
      const viewport=Math.max(0,parseFloat(value)-60);
      content.scrollTop=Math.min(content.scrollTop,Math.max(0,340-viewport));
    }
  });
  f.context.syncObservationPopupPlacement(undefined,true);
  const initialHeight=limit;
  content.scrollTop=340-Math.max(0,parseFloat(limit)-60);
  const bottom=content.scrollTop;
  assert.ok(bottom>0);
  for(let frame=0;frame<10;frame++)f.context.syncObservationPopupPlacement();
  assert.equal(limit,initialHeight);
  assert.equal(content.scrollTop,bottom,'registration rows and the edit button must remain reachable');
});

test('detail bounds reserve visible top and right tools',()=>{
  const style={};let offset;
  const controls=[
    {left:240,top:12,bottom:64,width:52,height:52,rightTool:false},
    {left:220,top:180,bottom:500,width:158,height:320,rightTool:true}
  ].map(bounds=>({getClientRects:()=>[1],getBoundingClientRect:()=>bounds,matches:()=>bounds.rightTool,
    querySelector:selector=>bounds.rightTool&&selector==='.map-ctl-compass'?{getBoundingClientRect:()=>({left:320})}:null}));
  const context={parseCssPx:parseFloat,
    document:{documentElement:{},querySelectorAll:()=>controls,getElementById:()=>null},
    window:{innerWidth:390,innerHeight:844,BearMobileDock:{isDocked:()=>true},getComputedStyle:()=>({getPropertyValue:()=> '0'})},
    map:{getViewport:()=>({getBoundingClientRect:()=>({left:0,top:0,width:390,height:844})}),getPixelFromCoordinate:p=>p},
    observationPopupContentEl:{querySelector:()=>({})},
    observationPopupEl:{style,getBoundingClientRect:()=>({width:parseFloat(style.width),height:Math.min(300,parseFloat(style.maxHeight))})},
    observationPopupOverlay:{getPosition:()=>[380,20],setPositioning(){},setOffset:value=>offset=value}};
  vm.createContext(context);vm.runInContext(fn,context);context.syncObservationPopupPlacement();
  assert.ok(380+offset[0]+parseFloat(style.width)<=308);
  assert.ok(20+offset[1]>=76);
});

test('external tools close details without intercepting their click or popup actions',()=>{
  let handler,closed=0;
  const context={document:{addEventListener(type,fn,capture){assert.equal(type,'click');assert.equal(capture,true);handler=fn;}},closeObservationPopup(){closed++;}};
  const begin=code.indexOf('  document.addEventListener("click", function dismissDetailForMapTool');
  vm.runInNewContext(code.slice(begin,code.indexOf('\n  function focusBearListItem',begin)),context);
  handler({target:{closest:selector=>selector==='.map-detail-popup'?null:{}}});assert.equal(closed,1);
  handler({target:{closest:()=>({})}});assert.equal(closed,1);
  handler({target:{closest:()=>null}});assert.equal(closed,1);
});

test('long detail cards stay inside the usable map area even when their marker is dragged offscreen',()=>{
  for(const [width,height,side]of [[320,740,false],[844,390,false],[1180,820,true]]){
    const bounds=side?{right:360,top:12,width:360,height:height-24}:{right:width,top:height-190,width,height:190};
    const style={},popup={style,getBoundingClientRect(){return {width:parseFloat(style.width),height:Math.min(800,parseFloat(style.maxHeight))};}};
    let offset;
    const context={parseCssPx:parseFloat,document:{documentElement:{},getElementById:()=>({getClientRects:()=>[1],getBoundingClientRect:()=>bounds})},
      window:{innerWidth:width,innerHeight:height,BearMobileDock:{isDocked:()=>true},getComputedStyle:()=>({getPropertyValue:name=>name==='--safe-bottom'?'24':'12'})},
      map:{getViewport:()=>({getBoundingClientRect:()=>({left:0,top:0,width,height})}),getPixelFromCoordinate:p=>p},
      observationPopupContentEl:{querySelector:()=>({})},observationPopupEl:popup,
      observationPopupOverlay:{getPosition:()=>[0,0],setPositioning(){},setOffset:value=>{offset=value;}}};
    vm.createContext(context);vm.runInContext(fn,context);
    for(const point of [[-1000,-1000],[width+1000,height+1000],[width/2,height/2]]){
      context.syncObservationPopupPlacement(point);
      const rect=popup.getBoundingClientRect(),x=point[0]+offset[0],y=point[1]+offset[1];
      assert.ok(x>=0&&x+rect.width<=width,JSON.stringify({width,x,rect}));
      assert.ok(y>=12&&y+rect.height<=height-24,JSON.stringify({height,y,rect}));
      assert.ok(rect.height>0&&rect.height<800);
    }
  }
});


test('expanded or offscreen panels cannot collapse a detail popup into its padding',()=>{
  for(const [width,height,bounds] of [
    [390,844,{left:0,right:390,top:0,width:390,height:844}],
    [390,844,{left:0,right:390,top:80,width:390,height:764}],
    [844,390,{left:0,right:740,top:0,width:740,height:390}],
    [390,844,{left:0,right:390,top:-200,width:390,height:100}]
  ]) {
    const style={},popup={style,getBoundingClientRect(){return {width:parseFloat(style.width),height:Math.min(800,parseFloat(style.maxHeight))};}};
    let offset;
    const context={parseCssPx:parseFloat,document:{documentElement:{},getElementById:()=>({getClientRects:()=>[1],getBoundingClientRect:()=>bounds})},
      window:{innerWidth:width,innerHeight:height,BearMobileDock:{isDocked:()=>true},getComputedStyle:()=>({getPropertyValue:()=> '0'})},
      map:{getViewport:()=>({getBoundingClientRect:()=>({left:0,top:0,width,height})}),getPixelFromCoordinate:p=>p},
      observationPopupContentEl:{querySelector:()=>({})},observationPopupEl:popup,
      observationPopupOverlay:{getPosition:()=>[width/2,height/2],setPositioning(){},setOffset:value=>{offset=value;}}};
    vm.createContext(context);vm.runInContext(fn,context);context.syncObservationPopupPlacement();
    const rect=popup.getBoundingClientRect();
    assert.ok(rect.height>=160,JSON.stringify({width,height,bounds,style}));
    assert.ok(rect.width>=180,JSON.stringify({width,height,bounds,style}));
    assert.ok(height/2+offset[1]>=0&&height/2+offset[1]+rect.height<=height);
  }
});
