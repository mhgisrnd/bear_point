const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../public/js/progressive-list.js');

function fixture(scope) {
  let scroll;
  const scroller = { scrollTop: 0, clientHeight: 200, scrollHeight: 1500,
    addEventListener(type, callback) { assert.equal(type, 'scroll'); scroll = callback; } };
  const pager = create({ scroller, key: item => item.id, scope });
  let rows = [];
  function render(items) {
    pager.beforeClear(); rows = []; scroller.scrollTop = 0;
    pager.render(items, item => rows.push(item));
  }
  return { scroller, render, scroll: () => scroll(), rows: () => rows };
}
const items = Array.from({ length: 75 }, (_, id) => ({ id }));

test('both list containers batch rows without extra controls or changing the source data', () => {
  const view = fixture(); view.render(items);
  assert.equal(view.rows().length, 30); assert.equal(items.length, 75);
  view.scroll(); assert.equal(view.rows().length, 30);
  view.scroller.scrollTop = 1250; view.scroll(); assert.equal(view.rows().length, 60);
  view.scroll(); assert.equal(view.rows().length, 75);
  view.scroll(); assert.equal(view.rows().length, 75);
  assert.deepEqual(view.rows(), items);
});

test('refresh preserves loaded range and scroll; filtering resets and empty results discard stale items', () => {
  const view = fixture(); view.render(items);
  view.scroller.scrollTop = 1250; view.scroll();
  view.render(items.map(item => ({ ...item, owner: 'updated' })));
  assert.equal(view.rows().length, 60); assert.equal(view.scroller.scrollTop, 1250);
  assert.equal(view.rows()[0].owner, 'updated');
  view.render(items.slice(5));
  assert.equal(view.rows().length, 30); assert.equal(view.scroller.scrollTop, 0);
  assert.equal(view.rows()[0].id, 5);
  view.render([]); view.scroll(); assert.equal(view.rows().length, 0);
});

test('hidden containers do not load rows on scroll', () => {
  const view = fixture(); view.render(items);
  view.scroller.clientHeight = 0; view.scroller.scrollTop = 1500;
  view.scroll(); assert.equal(view.rows().length, 30);
});

test('refresh with additions preserves scrolling and loaded rows, while a changed filter resets them',()=>{
  let query='team-a';
  const view=fixture(()=>query);view.render(items);
  view.scroller.scrollTop=1250;view.scroll();
  view.render([{id:'new'},...items]);
  assert.equal(view.scroller.scrollTop,1250);
  assert.equal(view.rows().length,61);
  view.render(items.slice(1));
  assert.equal(view.scroller.scrollTop,1250);
  query='team-b';view.render(items.slice(1));
  assert.equal(view.scroller.scrollTop,0);assert.equal(view.rows().length,30);
});
