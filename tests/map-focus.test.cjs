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
    const context = { view, mapCoordFromWgs84: (lat, lng) => [lng, lat] };
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
