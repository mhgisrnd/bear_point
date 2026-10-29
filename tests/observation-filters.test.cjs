const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { filter, dateKey, periodKey, summary } = require('../public/js/obs/observation-filters');
const now = new Date('2026-10-29T01:00:00Z');
const rows = [
  { id: 'before-midnight', owner: '김', createdAt: '2026-10-28T14:59:59Z' },
  { id: 'midnight', owner: '김', createdAt: '2026-10-28T15:00:00Z' },
  { id: 'another-owner', owner: '박', createdAt: '2026-10-29 00:00:00' },
  { id: 'last-month', owner: '김', createdAt: '2026-09-30T00:00:00Z' },
  { id: 'new-year', owner: '김', createdAt: '2025-12-31T15:00:00Z' },
  { id: 'unknown', owner: '김', createdAt: null }
];
test('today and day use Korean midnight for UTC, offset and SQLite timestamps', () => {
  assert.deepEqual(filter(rows, { period: 'today' }, now).map(row => row.id), ['midnight', 'another-owner']);
  assert.deepEqual(filter(rows, { period: 'day', day: '2026-10-28' }).map(row => row.id), ['before-midnight']);
  assert.equal(dateKey('2026-10-29T00:00:00+09:00'), '2026-10-29');
  assert.equal(dateKey('2026-10-28 15:00:00'), '2026-10-29');
});
test('owner combines exactly with month/year; an unfiltered list retains undated rows', () => {
  assert.equal(filter(rows, { period: 'all' }).length, rows.length);
  assert.deepEqual(filter(rows, { period: 'month', month: '2026-10', owner: '김' }).map(row => row.id), ['before-midnight', 'midnight']);
  assert.equal(filter(rows, { period: 'year', year: '2026', owner: '김' }).length, 4);
  assert.equal(filter(rows, { period: 'all', owner: '김' }).length, 5);
  assert.equal(filter(rows, { period: 'all', owner: '김철수' }).length, 0);
});
test('invalid or empty dates cannot silently broaden the result set', () => {
  for (const options of [{ period: 'day', day: '' }, { period: 'day', day: '2026-02-30' }, { period: 'month', month: '2026-13' }, { period: 'year', year: '26' }]) {
    assert.equal(periodKey(options), null);
    assert.equal(filter(rows, options).length, 0);
  }
  assert.equal(periodKey({ period: 'day', day: '2024-02-29' }), '2024-02-29');
  assert.equal(dateKey('bad date'), '');
});
test('collapsed summaries expose all active conditions, and today follows a new day', () => {
  assert.equal(summary({ owner: '김', period: 'month', month: '2026-10' }), '담당자: 김 · 2026-10');
  assert.equal(summary({ period: 'all' }), '');
  assert.equal(periodKey({ period: 'today' }, new Date('2026-10-29T15:00:00Z')), '2026-10-30');
});
test('changing filters drops hidden selections before bulk actions and applies the same results to the map', () => {
  const source = fs.readFileSync('public/js/obs/obsList.js', 'utf8');
  const selected = new Set(['visible', 'hidden']);
  const visible = [{ id: 'one', _obsKey: 'visible' }];
  let mapped, selectionUpdated = false;
  const context = vm.createContext({
    selectedObsIds: selected, currentTab: 'list', btnFilterDoneEl: {},
    syncFilterControls() {}, getFilteredItems: () => visible,
    renderObservationList() {}, updateObservationSummary() {},
    renderObservationMarkers: items => { mapped = items; },
    updateSelectionUI: () => { assert.deepEqual([...selected], ['visible']); selectionUpdated = true; }
  });
  const start = source.indexOf('  function applySearch() {');
  const end = source.indexOf('  function readObservationFilters()', start);
  vm.runInContext(source.slice(start, end), context);
  context.applySearch();
  assert.equal(selectionUpdated, true);
  assert.equal(mapped, visible);
  assert.equal(context.btnFilterDoneEl.textContent, '1건 보기');
});
