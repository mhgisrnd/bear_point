const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('observation marker and label use each saved team color, retaining selection and edit indicators', () => {
  const source = fs.readFileSync('public/js/client-ol.js', 'utf8');
  function Options(options) { Object.assign(this, options); }
  const context = vm.createContext({
    ol: { style: { Style: Options, Icon: Options, Text: Options, Fill: Options, Stroke: Options, Circle: Options } },
    getObservationMarkerText: item => item.place, getObservationHeadingDeg: () => 37,
    createHeadingIconDataUri: (_, color) => 'icon:' + color, OBSERVATION_HEADING_ICON_SIZE: 40,
    observationHeadingIconSrc: 'orange', observationHeadingEditIconSrc: 'editing',
    OBS_SAVE_FLASH_DURATION_MS: 4600, currentEditingObservationId: null, focusedObservationId: null, editOriginFeature: null,
    clamp01: value => Math.max(0, Math.min(1, value))
  });
  const start = source.indexOf('  function createObservationStyleFromMarker(marker) {');
  const end = source.indexOf('  const observationPopupEl', start);
  vm.runInContext(source.slice(start, end), context);
  for (const color of ['#16A34A', '#2563EB', '#EA580C', '#9333EA']) {
    const data = { id: 'one', place: 'test', team_color: color };
    const style = context.createObservationStyleFromMarker({ obsData: data });
    assert.equal(style()[0].image.src, 'icon:' + color);
    assert.equal(style()[0].text.backgroundFill.color, color + 'c7');
    data.isSelected = true;
    const selected = style();
    assert.equal(selected.length, 2);
    assert.equal(selected[1].text.backgroundFill.color, color + 'e6');
  }
  for (const color of [null, '', 'red', '#fff;bad']) {
    const styles = context.createObservationStyleFromMarker({ obsData: { place: 'old', team_color: color } })();
    assert.equal(styles[0].image.src, 'orange');
  }
  context.currentEditingObservationId = 'one';
  const editing = context.createObservationStyleFromMarker({ obsData: { id: 'one', place: 'edit', team_color: '#9333EA' } })();
  assert.equal(editing[1].image.src, 'editing');

  context.currentEditingObservationId = null;
  let now = 1300;
  context.Date = { now: () => now };
  const highlight = context.createObservationStyleFromMarker({
    obsData: { id: 'yellow', place: 'yellow team', team_color: '#FFFF00' },
    _feature: { get: key => ({ saveFlashUntil: 2200, saveFlashDurationMs: 1200 })[key] }
  });
  const first = highlight();
  assert.equal(first.length, 3);
  assert.match(first[0].image.stroke.color, /^rgba\(15,23,42,/);
  assert.match(first[1].image.stroke.color, /^rgba\(255,255,255,/);
  assert.equal(first[0].image.fill, undefined);
  assert.equal(first[2].image.src, 'icon:#FFFF00');
  assert.equal(first[2].image.opacity, 1);
  now = 1400;
  assert.ok(highlight()[0].image.radius > first[0].image.radius);
  now = 2201;
  assert.equal(highlight().length, 1);
  assert.equal(highlight()[0].image.src, 'icon:#FFFF00');
  context.focusedObservationId = 'yellow';
  const focused = highlight();
  assert.equal(focused.length, 3);
  assert.equal(focused[0].image.radius, 17);
  assert.equal(focused[1].image.stroke.color, '#ffffff');
  assert.equal(focused[2].text.backgroundStroke.width, 2.5);
  context.focusedObservationId = 'other';
  assert.equal(highlight().length, 1);
  context.focusedObservationId = null;
  assert.equal(highlight().length, 1);
});
