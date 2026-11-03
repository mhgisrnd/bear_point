const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('local and shared bear markers use the saved team color for labels and pulse rings',async()=>{
  const [Feature,Point,Vector,Style,Icon,Text,Fill,Stroke,Circle]=await Promise.all([
    'ol/Feature.js','ol/geom/Point.js','ol/source/Vector.js','ol/style/Style.js','ol/style/Icon.js',
    'ol/style/Text.js','ol/style/Fill.js','ol/style/Stroke.js','ol/style/Circle.js'
  ].map(path=>import(path).then(module=>module.default)));
  const source=fs.readFileSync('public/js/client-ol.js','utf8');
  // Avoid image loading in Node; the styles and circles below are actual OpenLayers objects.
  const context=vm.createContext({ol:{Feature,geom:{Point},style:{Style,Icon:class extends Icon{constructor(options){super({...options,src:undefined,img:{width:34,height:34,src:'bear'},imgSize:[34,34]});}},Text,Fill,Stroke,Circle}},
    bearMarkerSource:new Vector(),mapCoordFromWgs84:(lat,lng)=>[lng,lat],buildBearEstimatePopupHtml:()=>'',
    BEAR_LABEL_OFFSET_Y:12,realtimeBearMarkerPulse:.5,startBearMarkerAnimation(){},stopBearMarkerAnimation(){}});
  const start=source.indexOf('  function bearTeamColor(item) {');
  const end=source.indexOf('  // CAPTURE_MOCK',start);
  vm.runInContext(source.slice(start,end),context);
  for(const color of ['#16A34A','#2563EB','#EA580C','#9333EA']){
    context.renderBearMarkers([{id:'local',bear_code:'KF-58',lat:35,lng:127,team_color:color},{id:'shared',bear_code:'KF-47',lat:35,lng:128,isRealtime:true,team_color:color},{id:'local-shared',bear_code:'KF-59',lat:35,lng:127.5,shared_at:'2026-11-02 12:00:00',team_color:color}]);
    const [local,shared,localShared]=context.bearMarkerSource.getFeatures();
    const expected=context.bearTeamTint(color,.95);
    assert.equal(local.getStyle().getText().getBackgroundFill().getColor(),expected);
    const styles=shared.getStyleFunction()();
    assert.equal(styles[2].getText().getBackgroundFill().getColor(),expected);
    assert.equal(styles[1].getImage().getStroke().getColor(),context.bearTeamTint(color,.8));
    assert.equal(styles[0].getImage().getStroke().getColor(),context.bearTeamTint(color,.46));
    const localSharedStyles=localShared.getStyleFunction()();
    assert.equal(localSharedStyles.length,3);
    assert.equal(localSharedStyles[0].getImage().getStroke().getColor(),styles[0].getImage().getStroke().getColor());
    assert.equal(localSharedStyles[2].getText().getBackgroundFill().getColor(),expected);
  }
  assert.equal(context.bearTeamColor({team_color:'red;bad'}),'#7e90a2');
  assert.equal(context.bearTeamColor({}),'#7e90a2');
});
