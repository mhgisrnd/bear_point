const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync('public/js/client-ol.js','utf8');
const start=code.indexOf('  function syncObservationPopupPlacement(');
const fn=code.slice(start,code.indexOf('\n  observationPopupContentEl.addEventListener',start));

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
