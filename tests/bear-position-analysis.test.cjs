const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const context = { window: {} };
vm.runInNewContext(fs.readFileSync('public/js/analysis/bear-position-analysis.js', 'utf8'), context);
const analyze = context.window.BearPositionAnalysis.analyzePosition;
const observation = { id: 'a', bearCode: 'B1', lat: 37, lng: 127, heading: 7 };

test('single observation applies distance and declination without creating intersections', () => {
  const { ok, result } = analyze([observation], { distanceLimitM: 1000, declinationDeg: -7 });
  assert.equal(ok, true);
  assert.ok(Math.abs(result.lat - (37 + 1000 / 6378137 * 180 / Math.PI)) < 1e-9);
  assert.ok(Math.abs(result.lng - 127) < 1e-9);
  assert.equal(result.options.estimationMethod, 'single');
  assert.equal(result.intersectionsCount, 0);
  assert.equal(result.analysisDetails.intersections.length, 0);
  assert.equal(result.spreadM, null);
});

test('single observation requires a positive finite distance and valid input', () => {
  for (const distanceLimitM of [undefined, 0, -1, Infinity, NaN]) {
    assert.equal(analyze([observation], { distanceLimitM }).code, 'DISTANCE_REQUIRED');
  }
  assert.equal(analyze([], {}).ok, false);
  assert.equal(analyze([{ ...observation, heading: '' }], { distanceLimitM: 1000 }).ok, false);
});

test('two bearings retain intersection analysis and range rejection', () => {
  const observations = [
    { ...observation, lat: 37, lng: 127, heading: 0 },
    { ...observation, id: 'b', lat: 37.01, lng: 126.99, heading: 90 }
  ];
  const result = analyze(observations, { distanceLimitM: 3000 });
  assert.equal(result.ok, true);
  assert.equal(result.result.options.estimationMethod, 'intersection');
  assert.equal(result.result.intersectionsCount, 1);
  assert.ok(Math.abs(result.result.lat - 37.01) < 1e-9);
  assert.ok(Math.abs(result.result.lng - 127) < 1e-9);
  assert.equal(analyze(observations, { distanceLimitM: 100 }).ok, false);
});
