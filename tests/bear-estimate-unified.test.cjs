const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/js/client-ol.js', 'utf8');
const transport = fs.readFileSync('public/js/realtime/realtimeList.js', 'utf8');
function filterContext(values) {
  return vm.createContext({ window: { BearObservationFilters: require('../public/js/obs/observation-filters.js') },
    bearStartFilterEl:{value:''},bearEndFilterEl:{value:''},bearPeriodFilterEl: { value: 'all' }, bearDayFilterEl: { value: '' }, bearMonthFilterEl: { value: '' }, bearYearFilterEl: { value: '' }, ...values });
}

test('code search matches fragments without case sensitivity and clears without changing source records', () => {
  const rows = [{ id: 'one', bear_code: 'KF-58', owner: 'KF-99' }, { id: 'two', bearCode: 'KM-120' }, { id: 'three', bear_code: 'KF-58' }];
  const context = filterContext({ currentBearEstimateItems: rows, bearCodeSearchEl: { value: '  kf-5  ' }, bearOwnerFilterEl: { value: '' }, bearTeamFilterEl: { value: '' } });
  const start = source.indexOf('  function readBearPeriodFilter(');
  vm.runInContext(source.slice(start, source.indexOf('  function syncBearMarkersForActiveTab(', start)), context);
  assert.deepEqual([...context.getFilteredBearEstimates()].map(row => row.id), ['one', 'three']);
  context.bearCodeSearchEl.value = '120';
  assert.equal(context.getFilteredBearEstimates()[0].id, 'two');
  context.bearCodeSearchEl.value = 'kf-99';
  assert.equal(context.getFilteredBearEstimates()[0].id, 'one', 'the same input also searches owner names');
  context.bearCodeSearchEl.value = '';
  assert.equal(context.getFilteredBearEstimates(), rows);
  assert.equal(rows.length, 3);
});

test('owner and team filters combine with code and support legacy records', () => {
  const rows = [
    { id: 'a', bear_code: 'MH-001', owner: 'Kim', team_id: 'wide', team_name: 'Wide' },
    { id: 'b', bear_code: 'MH-002', owner: 'Kim', team_id: 'south' },
    { id: 'c', bear_code: 'MH-003', owner: 'Lee', team_id: 'wide' },
    { id: 'legacy', owner: 'Kim', team_name: 'Legacy' },
    { id: 'missing' }
  ];
  const context = filterContext({ currentBearEstimateItems: rows, bearCodeSearchEl: { value: 'Kim' }, bearTeamFilterEl: { value: 'wide' } });
  const start = source.indexOf('  function readBearPeriodFilter(');
  vm.runInContext(source.slice(start, source.indexOf('  function syncBearMarkersForActiveTab(', start)), context);
  assert.deepEqual([...context.getFilteredBearEstimates()].map(row => row.id), ['a']);
  context.bearCodeSearchEl.value = '002';
  assert.equal(context.getFilteredBearEstimates().length, 0);
  context.bearCodeSearchEl.value = '';
  context.bearTeamFilterEl.value = 'Legacy';
  assert.equal(context.getFilteredBearEstimates()[0].id, 'legacy');
  context.bearCodeSearchEl.value = '미지정';
  context.bearTeamFilterEl.value = '미지정';
  assert.equal(context.getFilteredBearEstimates()[0].id, 'missing');
  context.bearCodeSearchEl.value = '';
  context.bearTeamFilterEl.value = '';
  assert.equal(context.getFilteredBearEstimates(), rows);
});

test('registration periods use Korean date boundaries for local and shared records', () => {
  const rows = [
    { id: 'before', created_at: '2026-11-09T14:59:59Z', owner: 'Kim' },
    { id: 'local', created_at: '2026-11-10T00:00:00+09:00', owner: 'Kim' },
    { id: 'shared', source_created_at: '2026-11-09 15:00:00', owner: 'Kim' },
    { id: 'numeric', timestamp: Date.parse('2026-11-10T01:00:00+09:00'), owner: 'Lee' },
    { id: 'next', created_at: '2026-11-10T15:00:00Z' },
    { id: 'missing' }
  ];
  const context = filterContext({ currentBearEstimateItems: rows, bearCodeSearchEl: { value: '' }, bearOwnerFilterEl: { value: '' }, bearTeamFilterEl: { value: '' } });
  const start = source.indexOf('  function readBearPeriodFilter(');
  vm.runInContext(source.slice(start, source.indexOf('  function syncBearMarkersForActiveTab(', start)), context);
  const ids = () => [...context.getFilteredBearEstimates()].map(row => row.id);
  context.bearPeriodFilterEl.value = 'day';
  context.bearDayFilterEl.value = '2026-11-10';
  assert.deepEqual(ids(), ['local', 'shared', 'numeric']);
  context.bearCodeSearchEl.value = 'Kim';
  assert.deepEqual(ids(), ['local', 'shared']);
  context.bearDayFilterEl.value = '2026-02-30';
  assert.deepEqual(ids(), []);
  context.bearCodeSearchEl.value = '';
  context.bearPeriodFilterEl.value = 'month';
  context.bearMonthFilterEl.value = '2026-11';
  assert.equal(ids().length, 5);
  context.bearPeriodFilterEl.value = 'year';
  context.bearYearFilterEl.value = '2025';
  assert.deepEqual(ids(), []);
  context.bearYearFilterEl.value = '20';
  assert.deepEqual(ids(), []);
  context.bearPeriodFilterEl.value = 'all';
  assert.equal(context.getFilteredBearEstimates(), rows);
});

test('filtered rendering removes hidden selections before bulk operations', () => {
  const selected = new Set(['one', 'two']);
  const context = vm.createContext({ selectedBearEstimateIds: selected });
  const start = source.indexOf('  function syncSelectedBearEstimateIds(');
  vm.runInContext(source.slice(start, source.indexOf('  //', start)), context);
  context.syncSelectedBearEstimateIds([{ id: 'one' }]);
  assert.deepEqual([...selected], ['one']);
});

test('unified transport starts without a toggle, paginates completely, and retains rows on network failure', async () => {
  const el = () => ({ dataset: {}, style: {}, classList: { add() {}, remove() {} }, addEventListener() {}, setAttribute() {} });
  const elements = new Map();
  const document = { body: el(), getElementById(id) {
    if (id === 'btn-realtime-list') return null;
    if (!elements.has(id)) elements.set(id, el());
    return elements.get(id);
  } };
  let offline = false, saved, calls = [];
  const window = {};
  vm.runInNewContext(transport, { window, document, navigator: {}, fetch: async url => {
    calls.push(url);
    if (offline) throw new Error('offline');
    const page = new URL(url, 'http://localhost/').searchParams.get('page');
    return { ok: true, json: async () => ({ total: 3, pageSize: 2, items: (page ? [3] : [1, 2]).map(id => ({ id, bear_estimate_id: 'origin-' + id, lat: 35, lng: 127 })) }) };
  } });
  const module = window.createRealtimeListModule({ unified: true, onRemoteEstimatesLoaded: (items, metadata) => { saved = { items, metadata }; } });
  await module.refresh();
  assert.ok(module);
  assert.equal(saved.items.length, 3);
  assert.equal(saved.metadata.complete, true);
  assert.ok(calls.some(url => url.includes('page=2&pageSize=2')));
  offline = true;
  const failed = await module.refresh();
  assert.equal(failed.ok, false);
  assert.equal(module.getItems().length, 3);
});

test('selected upload skips shared and in-flight rows, reconciles lost receipts, and retains partial failures for retry', async () => {
  const rows = [{ id: 'a' }, { id: 'b', shared_at: 'shared' }, { id: 'c' }, { id: 'd' }, { id: 'e' }, { id: 'f' }];
  const sent = [], marked = [];
  const context = vm.createContext({
    currentBearEstimateItems: rows, pendingBearUploads: new Set(['e']), pendingBearDeletions: new Set(['f']), remoteSharedEstimateIds: new Set(),
    selectedBearEstimateIds: new Set(rows.map(it => it.id)), statusEl: {},
    confirmRealtimeUpload: async () => true, repaintUnifiedBearList() {},
    markBearEstimatesShared: async ids => { marked.push(...ids); rows.find(row => row.id === ids[0]).shared_at = 'now'; },
    realtimeListModule: {
      refresh: async () => { rows.find(row => row.id === 'c').shared_at = 'previous receipt'; return { ok: true }; },
      sendEstimate: async item => { sent.push(item.id); return { ok: item.id !== 'd' }; }
    }
  });
  const start = source.indexOf('  function canModifyUnsharedBearEstimate(');
  const end = source.indexOf('  async function downloadAllBearEstimatesXls(', start);
  vm.runInContext(source.slice(start, end), context);
  await context.handleUploadSelectedBearEstimates();
  assert.deepEqual(sent, ['a', 'd']);
  assert.deepEqual(marked, ['a']);
  assert.equal(rows.find(row => row.id === 'd').shared_at, undefined);
  assert.deepEqual([...context.pendingBearUploads], ['e']);
  assert.match(context.statusEl.textContent, /1건 공유 완료, 1건 공유 실패/);
});

test('failed preflight never posts and releases pending rows for a manual retry', async () => {
  let posts = 0;
  const context = vm.createContext({ currentBearEstimateItems: [{ id: 'a' }], pendingBearUploads: new Set(), pendingBearDeletions: new Set(),
    remoteSharedEstimateIds: new Set(), selectedBearEstimateIds: new Set(['a']), statusEl: {},
    confirmRealtimeUpload: async () => true, repaintUnifiedBearList() {},
    realtimeListModule: { refresh: async () => ({ ok: false, message: 'offline' }), sendEstimate: async () => { posts++; } }
  });
  const start = source.indexOf('  function canModifyUnsharedBearEstimate(');
  vm.runInContext(source.slice(start, source.indexOf('  async function downloadAllBearEstimatesXls(', start)), context);
  await context.handleUploadSelectedBearEstimates();
  assert.equal(posts, 0);
  assert.equal(context.pendingBearUploads.size, 0);
  assert.match(context.statusEl.textContent, /다시 시도/);
});

test('reconnect refreshes the list before sending only explicitly queued estimates', async () => {
  const rows = [
    { id: 'local-only', share_pending: 0 },
    { id: 'legacy' },
    { id: 'queued', share_pending: 1 },
    { id: 'receipt', share_pending: 1 },
    { id: 'deleting', share_pending: 1 }
  ];
  const calls = [];
  const context = vm.createContext({
    currentBearEstimateItems: rows, pendingBearUploads: new Set(), pendingBearDeletions: new Set(['deleting']),
    remoteSharedEstimateIds: new Set(), navigator: {onLine:false}, btnBearsRefresh:null,
    console, repaintUnifiedBearList(){}, refreshBearEstimatePanel:async()=>{},
    markBearEstimatesShared:async ids=>{ rows.find(row=>row.id===ids[0]).shared_at='now'; },
    realtimeListModule:{
      refresh:async()=>{calls.push('refresh');context.remoteSharedEstimateIds.add('receipt');return {ok:true};},
      sendEstimate:async(item,{silent})=>{assert.equal(silent,true);assert.equal(item.share_pending,undefined);calls.push(item.id);return {ok:true};}
    }
  });
  const start = source.indexOf('  function canModifyUnsharedBearEstimate(');
  const refresh = source.indexOf('  let bearRefreshInProgress = false,');
  vm.runInContext(source.slice(start, source.indexOf('  async function downloadAllBearEstimatesXls(', start))
    + source.slice(refresh, source.indexOf('  if (btnBearsRefresh) btnBearsRefresh.addEventListener', refresh)), context);
  await context.refreshUnifiedBearList({silent:true});
  assert.deepEqual(calls, []);
  context.navigator.onLine = true;
  await context.refreshUnifiedBearList({silent:true,retry:false});
  assert.deepEqual(calls, ['refresh']);
  await context.refreshUnifiedBearList({silent:true});
  assert.deepEqual(calls, ['refresh', 'refresh', 'queued']);
  assert.equal(context.pendingBearUploads.size, 0);
});
