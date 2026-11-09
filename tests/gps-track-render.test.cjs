const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('history renders newest first across loaded pages and refresh resets previous rows',async()=>{
  function element(){return {dataset:{},children:[],classList:{toggle(){}},style:{},append(...children){this.children.push(...children);},replaceChildren(){this.children=[];},prepend(){},setAttribute(){},addEventListener(){}};}
  const history=element(),requests=[];
  let response={items:[{id:'old',started_at:100},{id:'new',started_at:300}],total:4};
  const context={history,historyVersion:0,historyOffset:0,historyLoaded:false,more:{},count:{},appliedQuery:{},displayed:null,
    filters:require('../public/js/tracking/gps-track-filters'),document:{createElement:element},date:String,elapsed:()=>'',paintTeams(){},place(){},
    syncClient:{list:async query=>{requests.push(query.offset);return response;}}};
  vm.createContext(context);
  const code=fs.readFileSync('public/js/tracking/gps-track-ui.js','utf8');
  vm.runInContext(code.slice(code.indexOf('    let historyRows=[];'),code.indexOf('    async function action(')),context);
  await context.loadHistory();
  assert.deepEqual(history.children.map(row=>row.dataset.trackId),['new','old']);
  response={items:[{id:'middle',started_at:200},{id:'old',started_at:100}],total:4};
  await context.loadHistory(false);
  assert.deepEqual(history.children.map(row=>row.dataset.trackId),['new','middle','old']);
  assert.deepEqual(requests,[0,2]);
  response={items:[{id:'latest',started_at:400}],total:1};
  await context.loadHistory();
  assert.deepEqual(history.children.map(row=>row.dataset.trackId),['latest']);
  assert.equal(context.more.hidden,true);
});
test('stationary records show one location marker; actual movement shows line and two endpoints',async()=>{
  const [Feature,Point,LineString,Vector,Style,Text,Fill,Stroke,Circle]=await Promise.all([
    'ol/Feature.js','ol/geom/Point.js','ol/geom/LineString.js','ol/source/Vector.js',
    'ol/style/Style.js','ol/style/Text.js','ol/style/Fill.js','ol/style/Stroke.js','ol/style/Circle.js'
  ].map(path=>import(path).then(module=>module.default)));
  const code=fs.readFileSync('public/js/tracking/gps-track-ui.js','utf8'),source=new Vector();
  const teams=[{id:'gurye',color:'#16A34A'}];
  const context=vm.createContext({root:{BearAppSettings:{store:{snapshot:()=>({items:teams})}}},ol:{Feature,geom:{Point,LineString},style:{Style,Text,Fill,Stroke,Circle}},source,
    history:{querySelectorAll:()=>[]},project:(lat,lng)=>[lng,lat],paint(){},displayed:null,map:{getView:()=>({fit(){}})}});
  vm.runInContext(code.slice(code.indexOf('    function draw(track,fit) {'),code.indexOf('    async function show(')),context);
  const point={lat:35,lng:127};context.draw({id:'stationary',status:'saved',color:'#9333EA',points:[point]},true);
  assert.equal(source.getFeatures().length,1);assert.equal(source.getFeatures()[0].getGeometry().getType(),'Point');
  assert.equal(source.getFeatures()[0].getStyle().getText().getText(),'기록 위치');
  const route={id:'moved',status:'saved',team_id:'gurye',team_color:'#000000',color:'#FF0000',points:[point,{lat:35.001,lng:127.001}]};
  context.draw(route,false);
  assert.equal(source.getFeatures().length,3);assert.equal(source.getFeatures()[0].getGeometry().getType(),'LineString');
  assert.equal(source.getFeatures()[0].getStyle()[1].getStroke().getColor(),'#16A34A');
  teams[0].color='#123456';context.draw(route,false);
  assert.equal(source.getFeatures()[0].getStyle()[1].getStroke().getColor(),'#123456');
});
