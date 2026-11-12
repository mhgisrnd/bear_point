const {test}=require('node:test');
const assert=require('node:assert/strict');
const {clone}=require('../public/js/realtime/estimate-history-tiles');
test('history copies tile configuration including offline loader without sharing source lifecycle or errors',async()=>{
  const XYZ=(await import('ol/source/XYZ.js')).default,Tile=(await import('ol/layer/Tile.js')).default;
  const loader=()=>{},source=new XYZ({url:'https://tiles.example/{z}/{x}/{y}.png',tileLoadFunction:loader,wrapX:false,attributions:'test'});
  const layer=new Tile({source,opacity:.6});
  const copies=clone({source:{XYZ},layer:{Tile}},[layer]),copy=copies[0].getSource();
  assert.notEqual(copy,source);assert.equal(copy.getProjection(),source.getProjection());
  assert.equal(copy.getTileGrid(),source.getTileGrid());assert.equal(copy.getTileLoadFunction(),loader);
  assert.equal(copy.getTileUrlFunction(),source.getTileUrlFunction());
  assert.equal(copy.getWrapX(),false);assert.equal(copies[0].getOpacity(),.6);
  copy.dispose();assert.equal(source.disposed,false);source.dispose();
});
