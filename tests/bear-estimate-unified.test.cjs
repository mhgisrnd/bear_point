const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/js/client-ol.js', 'utf8');
const transport = fs.readFileSync('public/js/realtime/realtimeList.js', 'utf8');

test('code search matches fragments without case sensitivity and clears without changing source records', () => {
  const rows = [{ id: 'one', bear_code: 'KF-58', owner: 'KF-99' }, { id: 'two', bearCode: 'KM-120' }, { id: 'three', bear_code: 'KF-58' }];
  const context = vm.createContext({ currentBearEstimateItems: rows, bearCodeSearchEl: { value: '  kf-5  ' } });
  const start = source.indexOf('  function getFilteredBearEstimates(');
  vm.runInContext(source.slice(start, source.indexOf('  function syncBearMarkersForActiveTab(', start)), context);
  assert.deepEqual([...context.getFilteredBearEstimates()].map(row => row.id), ['one', 'three']);
  context.bearCodeSearchEl.value = '120';
  assert.equal(context.getFilteredBearEstimates()[0].id, 'two');
  context.bearCodeSearchEl.value = 'kf-99';
  assert.equal(context.getFilteredBearEstimates().length, 0, 'only the code field is searched');
  context.bearCodeSearchEl.value = '';
  assert.equal(context.getFilteredBearEstimates(), rows);
  assert.equal(rows.length, 3);
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
  const rows = [{ id: 'a' }, { id: 'b', shared_at: 'shared' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
  const sent = [], marked = [];
  const context = vm.createContext({
    currentBearEstimateItems: rows, pendingBearUploads: new Set(['e']), remoteSharedEstimateIds: new Set(),
    selectedBearEstimateIds: new Set(rows.map(it => it.id)), statusEl: {},
    confirmRealtimeUpload: async () => true, repaintUnifiedBearList() {},
    markBearEstimatesShared: async ids => { marked.push(...ids); rows.find(row => row.id === ids[0]).shared_at = 'now'; },
    realtimeListModule: {
      refresh: async () => { rows.find(row => row.id === 'c').shared_at = 'previous receipt'; return { ok: true }; },
      sendEstimate: async item => { sent.push(item.id); return { ok: item.id !== 'd' }; }
    }
  });
  const start = source.indexOf('  async function uploadUnsharedBearEstimates(');
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
  const context = vm.createContext({ currentBearEstimateItems: [{ id: 'a' }], pendingBearUploads: new Set(),
    remoteSharedEstimateIds: new Set(), selectedBearEstimateIds: new Set(['a']), statusEl: {},
    confirmRealtimeUpload: async () => true, repaintUnifiedBearList() {},
    realtimeListModule: { refresh: async () => ({ ok: false, message: 'offline' }), sendEstimate: async () => { posts++; } }
  });
  const start = source.indexOf('  async function uploadUnsharedBearEstimates(');
  vm.runInContext(source.slice(start, source.indexOf('  async function downloadAllBearEstimatesXls(', start)), context);
  await context.handleUploadSelectedBearEstimates();
  assert.equal(posts, 0);
  assert.equal(context.pendingBearUploads.size, 0);
  assert.match(context.statusEl.textContent, /다시 시도/);
});
