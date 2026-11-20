const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('map focus supports analysis without a callback and list focus with a callback', async () => {
  const { default: View } = await import('ol/View.js');
  const source = fs.readFileSync(path.join(__dirname, '../public/js/client-ol.js'), 'utf8');
  const start = source.indexOf('  function flyToLatLng(');
  const end = source.indexOf('\n  //', start);
  const previousRaf = global.requestAnimationFrame;
  const previousCancel = global.cancelAnimationFrame;
  global.requestAnimationFrame = () => 1;
  global.cancelAnimationFrame = () => {};
  const view = new View({ center: [0, 0], zoom: 10 });
  try {
    const context = { window:{}, view, mapCoordFromWgs84: (lat, lng) => [lng, lat], stopFollowing() {} };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    assert.doesNotThrow(() => context.flyToLatLng([35, 127], 16));
    view.cancelAnimations();
    let completed;
    assert.doesNotThrow(() => context.flyToLatLng([35, 127], 16, value => { completed = value; }));
    view.cancelAnimations();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(completed, false);
  } finally {
    view.cancelAnimations();
    global.requestAnimationFrame = previousRaf;
    global.cancelAnimationFrame = previousCancel;
  }
});

test('observation and animal selection zoom in only below level 16 and retain closer views',()=>{
  const client=fs.readFileSync('public/js/client-ol.js','utf8');
  const observations=fs.readFileSync('public/js/obs/obsList.js','utf8');
  for(const zoom of [8,15.5,16,17.25,19,undefined]){
    const expected=Number.isFinite(zoom)?Math.max(16,zoom):16;
    let animalZoom,observationZoom;
    const animal=vm.createContext({bearListFocusVersion:0,closeObservationPopup(){},
      view:{cancelAnimations(){},getZoom:()=>zoom},flyToLatLng:(_coordinate,target)=>{animalZoom=target;}});
    const start=client.indexOf('  function focusBearListItem(');
    vm.runInContext(client.slice(start,client.indexOf('  function openBearListItemPopup(',start)),animal);
    animal.focusBearListItem('one',false,[35,127]);
    assert.equal(animalZoom,expected);
    const observation=vm.createContext({window:{},map:{getZoom:()=>zoom},observationFocusVersion:0,observationMarkers:[],onItemHaptic(){},
      flyToLatLng:(_coordinate,target)=>{observationZoom=target;}});
    const begin=observations.indexOf('  function moveToObservation(');
    vm.runInContext(observations.slice(begin,observations.indexOf('  function updateObservationMarkerScale(',begin)),observation);
    observation.moveToObservation({lat:35,lng:127},null);
    assert.equal(observationZoom,expected);
  }
});
