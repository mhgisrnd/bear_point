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

test('custom ranges include both dates at Korean midnight and reject empty or reversed bounds', () => {
  const items = [
    {id:'before',created_at:'2026-11-09T14:59:59Z'},
    {id:'start',created_at:'2026-11-09T15:00:00Z'},
    {id:'end',created_at:'2026-11-11T14:59:59Z'},
    {id:'after',created_at:'2026-11-11T15:00:00Z'},
    {id:'unknown'}
  ];
  const query={period:'range',start:'2026-11-10',end:'2026-11-11'};
  assert.deepEqual(filter(items,query).map(row=>row.id),['start','end']);
  assert.deepEqual(filter(items,{...query,end:query.start}).map(row=>row.id),['start']);
  for (const dates of [{start:'',end:query.end},{start:query.end,end:query.start},{start:'2026-02-30',end:'2026-03-01'}]) {
    assert.equal(periodKey({...query,...dates}),null);
    assert.equal(filter(items,{...query,...dates}).length,0);
  }
});

test('team combines with owner and period and supports records without team IDs', () => {
  const items = [
    { id: 'regional', owner: 'Kim', team_id: 'regional', team_name: 'Regional', created_at: '2026-11-10T15:00:00Z' },
    { id: 'other', owner: 'Kim', team_id: 'other', created_at: '2026-11-10T15:00:00Z' },
    { id: 'older', owner: 'Kim', team_id: 'regional', created_at: '2026-11-09T15:00:00Z' },
    { id: 'legacy', owner: 'Lee', team_name: 'Legacy' },
    { id: 'unknown', owner: 'Lee' }
  ];
  assert.deepEqual(filter(items, { team: 'regional', owner: 'Kim', period: 'day', day: '2026-11-11' }).map(row => row.id), ['regional']);
  assert.deepEqual(filter(items, { team: 'Legacy', period: 'all' }).map(row => row.id), ['legacy']);
  assert.deepEqual(filter(items, { team: '\uBBF8\uC9C0\uC815', period: 'all' }).map(row => row.id), ['unknown']);
  assert.equal(filter(items, { period: 'all' }).length, 5);
  assert.ok(summary({ team: 'regional', teamName: 'Regional', period: 'all' }).includes('Regional'));
});

test('both filter panels pair team and period and keep date controls in a separate row', () => {
  const {parse} = require('node-html-parser');
  const page = parse(fs.readFileSync('public/index.html', 'utf8'));
  for (const prefix of ['obs', 'bear']) {
    const panel = page.querySelector('#' + prefix + '-filter-panel');
    const row = panel.querySelector('.list-filter-selects');
    assert.ok(row.querySelector('#' + prefix + '-filter-team'));
    assert.ok(row.querySelector('#' + prefix + '-filter-period'));
    assert.equal(row.querySelector('option[selected]').getAttribute('value'), 'all');
    const dates = panel.querySelector('#' + prefix + '-filter-dates');
    assert.equal(dates.hasAttribute('hidden'), true);
    assert.equal(dates.querySelectorAll('select').length, 0);
    assert.equal(dates.querySelectorAll('input').length, 5);
  }
});

test('observation input searches labels or owners immediately while retaining team, period and my-owner constraints', () => {
  const source = fs.readFileSync('public/js/obs/obsList.js', 'utf8');
  const items = [
    {id:'one', bearCode:'KF-58', place:'Valley', owner:'Kim', team_id:'wide'},
    {id:'two', bearCode:'KM-120', place:'Ridge', owner:'Lee', team_id:'wide'},
    {id:'three', bearCode:'KF-58', place:'Valley', owner:'Kim', team_id:'other'}
  ];
  let filters = {period:'all',team:'wide'};
  const context = vm.createContext({window:{BearObservationFilters:require('../public/js/obs/observation-filters')},
    searchFieldEl:{value:'obs'},searchQueryEl:{value:' ki '},observationSamples:items,
    readObservationFilters:()=>filters,getObservationLabel:item=>item.place});
  const start=source.indexOf('  function getFilteredItems()');
  vm.runInContext(source.slice(start,source.indexOf('  function applySearch()',start)),context);
  const ids=()=>[...context.getFilteredItems()].map(row=>row.id);
  assert.deepEqual(ids(),['one']);
  context.searchQueryEl.value='RID';assert.deepEqual(ids(),['two']);
  filters={...filters,owner:'Kim'};assert.deepEqual(ids(),[]);
  context.searchQueryEl.value='';assert.deepEqual(ids(),['one']);
  context.searchQueryEl.value='kim';assert.deepEqual(ids(),['one']);
  context.searchQueryEl.value='kf-5';assert.deepEqual(ids(),['one']);
  filters={period:'all',team:'wide'};context.searchQueryEl.value='km-12';assert.deepEqual(ids(),['two']);
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
    selectedObsIds: selected, currentTab: 'list',
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
});
