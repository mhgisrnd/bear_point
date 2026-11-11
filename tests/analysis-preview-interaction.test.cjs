const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

test('each successive declination preview updates the ray and fits immediately',async()=>{
  const [Feature,Point,LineString,Circle,Vector]=await Promise.all([
    'ol/Feature.js','ol/geom/Point.js','ol/geom/LineString.js','ol/geom/Circle.js','ol/source/Vector.js'
  ].map(path=>import(path).then(module=>module.default)));
  const source=fs.readFileSync('public/js/client-ol.js','utf8'),fits=[];
  const analysisPreviewSource=new Vector();
  const viewport={window:{}};
  vm.runInNewContext(fs.readFileSync('public/js/analysis/analysis-viewport.js','utf8'),viewport);
  const context=vm.createContext({
    window:{BearAnalysisViewport:viewport.window.BearAnalysisViewport,addEventListener(){}},
    ol:{Feature,geom:{Point,LineString,Circle}},analysisPreviewSource,previewRayAnimationActive:false,
    mapCoordFromWgs84:(lat,lng)=>[lng,lat],parseHeadingDegForPreview:Number,
    view:{cancelAnimations(){},fit(extent,options){fits.push({extent,options});}},
    startAnalysisVisualAnimation(){},stopAnalysisVisualAnimation(){},analysisGuideSource:{getFeatures:()=>[]}
  });
  vm.runInContext(source.slice(source.indexOf('  function clearAnalysisInputPreview('),source.indexOf('  function lineIntersection(p1')),context);
  const angles=[-7,-6,-5],ends=[];
  for(const declinationDeg of angles){
    context.renderAnalysisInputPreview({distanceLimitM:8000,declinationDeg,sourceObservations:[{lat:0,lng:0,heading:90}]});
    ends.push(analysisPreviewSource.getFeatures().find(feature=>feature.get('kind')==='preview-arrow').getGeometry().getCoordinates());
    assert.equal(fits.length,ends.length);
    assert.equal(fits.at(-1).options.duration,0);
  }
  assert.notDeepEqual(ends[0],ends[1]);assert.notDeepEqual(ends[1],ends[2]);
});
