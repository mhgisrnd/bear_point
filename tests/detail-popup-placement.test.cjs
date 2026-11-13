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

test('detail bounds reserve visible top and right tools',()=>{
  const style={};let offset;
  const controls=[
    {left:240,top:12,bottom:64,width:52,height:52,rightTool:false},
    {left:320,top:180,bottom:500,width:58,height:320,rightTool:true}
  ].map(bounds=>({getClientRects:()=>[1],getBoundingClientRect:()=>bounds,matches:()=>bounds.rightTool}));
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
