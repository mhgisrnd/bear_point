const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync('public/js/obs/obsList.js', 'utf8');
function fixture() {
  const classes = new Set();
  const captures = [];
  const sheet = { style: {}, offsetWidth: 404, offsetHeight: 200, classList: { contains: name => classes.has(name) },
    getBoundingClientRect() { return { left: parseFloat(this.style.left || 464), top: parseFloat(this.style.top || 8), width: this.offsetWidth, height: this.offsetHeight }; } };
  const context = vm.createContext({ window: { innerWidth: 1060, innerHeight: 890 }, obsSheetEl: sheet,
    obsSheetHeaderEl: { setPointerCapture: id => captures.push(['set', id]), releasePointerCapture: id => captures.push(['release', id]) },
    isDraggingSheet: false, dragPointerId: null, dragOffsetX: 0, dragOffsetY: 0 });
  vm.runInContext(source.slice(source.indexOf('  function startSheetDrag('), source.indexOf('  function createObservationIcon(')), context);
  const event = (patch = {}) => ({ pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, clientX: 500, clientY: 20,
    cancelable: true, preventDefault() { this.prevented = true; }, target: { closest: () => null }, ...patch });
  return { context, sheet, event, captures, classes };
}
test('title touch drag captures its pointer and moves independently of the sidebar', () => {
  const { context: c, sheet, event, captures } = fixture();
  const down = event(); c.startSheetDrag(down);
  assert.equal(down.prevented, true);
  c.moveSheetDrag(event({ clientX: 600, clientY: 120 }));
  assert.equal(sheet.style.left, '564px'); assert.equal(sheet.style.top, '108px');
  c.moveSheetDrag(event({ pointerId: 2, clientX: 900 }));
  assert.equal(sheet.style.left, '564px');
  c.endSheetDrag(event());
  assert.equal(c.isDraggingSheet, false);
  assert.deepEqual(captures, [['set', 1], ['release', 1]]);
});
test('dragging is clamped at each screen edge', () => {
  const { context: c, sheet, event } = fixture();
  c.startSheetDrag(event());
  c.moveSheetDrag(event({ clientX: -100, clientY: -100 }));
  assert.equal(sheet.style.left, '0px'); assert.equal(sheet.style.top, '0px');
  c.moveSheetDrag(event({ clientX: 9999, clientY: 9999 }));
  assert.equal(sheet.style.left, '656px'); assert.equal(sheet.style.top, '690px');
});
test('header buttons, secondary touches and right clicks do not start dragging', () => {
  for (const patch of [{ target: { closest: () => ({ tagName: 'BUTTON' }) } }, { isPrimary: false }, { pointerType: 'mouse', button: 2 }]) {
    const { context: c, event, captures } = fixture();
    c.startSheetDrag(event(patch));
    assert.equal(c.isDraggingSheet, false); assert.equal(captures.length, 0);
  }
});
test('a moved popup stays inside resized screens and after expanding filter content', () => {
  const { context: c, sheet, event } = fixture();
  c.startSheetDrag(event()); c.moveSheetDrag(event({ clientX: 650, clientY: 700 })); c.endSheetDrag(event());
  sheet.offsetHeight = 500; c.keepSheetInViewport();
  assert.equal(sheet.style.top, '390px');
  c.window.innerWidth = 600; c.window.innerHeight = 600; c.keepSheetInViewport();
  assert.equal(sheet.style.left, '196px'); assert.equal(sheet.style.top, '100px');
});
