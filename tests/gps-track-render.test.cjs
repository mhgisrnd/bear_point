const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('stationary records show one location marker; actual movement shows line and two endpoints',async()=>{
  const [Feature,Point,LineString,Vector,Style,Text,Fill,Stroke,Circle]=await Promise.all([
    'ol/Feature.js','ol/geom/Point.js','ol/geom/LineString.js','ol/source/Vector.js',
    'ol/style/Style.js','ol/style/Text.js','ol/style/Fill.js','ol/style/Stroke.js','ol/style/Circle.js'
  ].map(path=>import(path).then(module=>module.default)));
  const code=fs.readFileSync('public/js/tracking/gps-track-ui.js','utf8'),source=new Vector();
  const context=vm.createContext({ol:{Feature,geom:{Point,LineString},style:{Style,Text,Fill,Stroke,Circle}},source,
    history:{querySelectorAll:()=>[]},project:(lat,lng)=>[lng,lat],paint(){},displayed:null,map:{getView:()=>({fit(){}})}});
  vm.runInContext(code.slice(code.indexOf('    function draw(track,fit) {'),code.indexOf('    async function show(')),context);
  const point={lat:35,lng:127};context.draw({id:'stationary',status:'saved',color:'#9333EA',points:[point]},true);
  assert.equal(source.getFeatures().length,1);assert.equal(source.getFeatures()[0].getGeometry().getType(),'Point');
  assert.equal(source.getFeatures()[0].getStyle().getText().getText(),'기록 위치');
  context.draw({id:'moved',status:'saved',points:[point,{lat:35.001,lng:127.001}]},false);
  assert.equal(source.getFeatures().length,3);assert.equal(source.getFeatures()[0].getGeometry().getType(),'LineString');
});
