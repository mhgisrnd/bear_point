const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/js/realtime/realtimeList.js'), 'utf8');
const client = fs.readFileSync(path.join(__dirname, '../public/js/client-ol.js'), 'utf8');

function element() {
  return {
    dataset: {}, style: {}, listeners: {}, textContent: '',
    classList: { add() {}, remove() {} }, setAttribute() {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
  };
}

async function setup(overrides = {}) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const calls = [];
  const window = { Capacitor: { isNativePlatform: () => true } };
  const records = [
    { id: 1, bear_code: '002', lat: 35.308129, lng: 127.704584, timestamp: 1781658443000, place: '개발검수', owner: '개발 담당자' },
    { id: 2, bear_code: '005', lat: 35.3187076, lng: 127.5968011, timestamp: 1780392863000 },
  ];
  vm.runInNewContext(source, {
    window, document: { getElementById: get, body: element() }, navigator: {},
    fetch: async () => ({ ok: true, json: async () => ({ items: records }) }),
  });
  const module = window.createRealtimeListModule({
    onDownloadTxt: item => calls.push(['txt', item]),
    onDownloadXls: items => calls.push(['xls', items]),
    onFocusItem: () => calls.push(['focus']), ...overrides,
  });
  await new Promise(setImmediate);
  function click(kind, id = '1') {
    const row = { getAttribute: () => id };
    const button = { closest: () => row };
    let stopped = false;
    get('realtime-list').listeners.click({
      target: { closest: selector => selector === `.realtime-row-${kind}-btn` ? button : null },
      stopPropagation() { stopped = true; },
    });
    assert.equal(stopped, true);
  }
  return { get, calls, module, click };
}

test('native list TXT and XLS clicks use export callbacks without reporting a premature save', async () => {
  const { get, calls, module, click } = await setup();
  click('txt');
  click('xls', '2');
  await new Promise(setImmediate);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], 'txt');
  assert.equal(calls[0][1], module.getItems()[0]);
  assert.equal(calls[1][0], 'xls');
  assert.equal(calls[1][1][0], module.getItems()[1]);
  assert.equal(get('status').textContent, '');
});

test('bulk XLS forwards only selected items and rejects an empty selection', async () => {
  const { get, calls } = await setup();
  const bulk = get('btn-realtime-download-selected-xls');
  bulk.listeners.click();
  assert.equal(calls.length, 0);
  assert.match(get('status').textContent, /선택된 실시간 항목이 없습니다/);
  const checkbox = { checked: true, closest: () => ({ getAttribute: () => '2' }) };
  get('realtime-list').listeners.change({ target: { closest: () => checkbox } });
  bulk.listeners.click();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][1].length, 1);
  assert.equal(calls[0][1][0].id, '2');
});

test('rejected exports show an error instead of success', async () => {
  const { get, click } = await setup({ onDownloadTxt: async () => { throw new Error('disk full'); } });
  click('txt');
  await new Promise(setImmediate);
  assert.match(get('status').textContent, /TXT 처리 실패: disk full/);
  assert.equal(get('status').style.color, '#a4001e');
});

test('client wiring maps realtime fields into the same exporters used by markers', () => {
  let options;
  const calls = [];
  const mapping = client.slice(client.indexOf('  function mapBearMarkerItems('), client.indexOf('  function syncBearMarkersForActiveTab('));
  const wiring = client.slice(client.indexOf('  const realtimeListModule ='), client.indexOf('  }) : null;', client.indexOf('  const realtimeListModule =')) + '  }) : null;'.length);
  const bindStart = client.indexOf('  realtimeTxtExporter = downloadBearEstimateTxt;');
  const bindings = client.slice(bindStart, client.indexOf('\n', client.indexOf('  realtimeBulkXlsExporter = downloadAllBearEstimatesXls;', bindStart)));
  const context = vm.createContext({
    window: { createRealtimeListModule(value) { options = value; } },
    downloadBearEstimateTxt: (item, fallback) => calls.push({ item, fallback }),
    downloadBearEstimateXls: (item, fallback) => calls.push({ item, fallback }),
    downloadAllBearEstimatesXls: items => calls.push({ items }),
  });
  vm.runInContext('let realtimeTxtExporter = null; let realtimeXlsExporter = null; let realtimeBulkXlsExporter = null;\n' + mapping + wiring, context);
  assert.throws(() => options.onDownloadTxt({ lat: 35.3, lon: 127.7 }), /TXT 저장 기능이 준비되지 않았습니다/);
  vm.runInContext(bindings, context);
  const item = { id: 'remote-1', bearCode: '002', lat: 35.3, lon: 127.7, latDms: 'lat-dms', lonDms: 'lon-dms', timestamp: 1781658443000, place: '지명', owner: '담당자' };
  options.onDownloadTxt(item);
  options.onDownloadXls([item]);
  const exported = calls[0].item;
  assert.equal(exported.lng, item.lon);
  assert.equal(exported.created_at, item.timestamp);
  assert.equal(exported.bear_code, item.bearCode);
  assert.equal(exported.lat_dms, item.latDms);
  assert.equal(exported.lng_dms, item.lonDms);
  assert.equal(exported.isRealtime, true);
  assert.equal(exported.place, item.place);
  assert.equal(exported.owner, item.owner);
  assert.equal(calls[1].item.isRealtime, true);
  assert.equal(calls[1].item.bear_code, item.bearCode);
  options.onDownloadXls([item, item]);
  assert.equal(calls[2].items.length, 2);
  assert.equal(calls[2].items[0].isRealtime, true);
});

test('web local and realtime XLS open a preview before generating a download', async () => {
  const singleStart = client.indexOf('  async function downloadBearEstimateXls(');
  const singleEnd = client.indexOf('    function buildXlsPreviewHtml(', singleStart);
  const bulkStart = client.indexOf('  async function downloadAllBearEstimatesXls(');
  const bulkEnd = client.indexOf('  async function deleteBearEstimateRows(', bulkStart);
  let preview;
  let loads = 0;
  const context = vm.createContext({
    Number, Intl, Date, console,
    normalizeOwnerName: value => value, normalizePlaceName: value => value,
    formatKstDateTimeLabel: () => '2026-06-17 10:07:23',
    parseSavedDateTime: value => new Date(value), decimalToDMS: () => 'DMS',
    legacyTmCoordFromWgs84: () => [254269.123, 202616.818],
    buildXlsPreviewHtml: () => '<table></table>',
    isNativeCapacitorPlatform: () => false,
    showSavedXlsPreviewPopup: async value => { preview = value; },
    loadSheetJS: async () => { loads++; throw new Error('download started'); },
    statusEl: { textContent: '' },
  });
  vm.runInContext(client.slice(singleStart, singleEnd) + client.slice(bulkStart, bulkEnd), context);
  for (const isRealtime of [false, true]) {
    const item = { id: 'item-1', isRealtime, lat: 35.3, lng: 127.7, bear_code: '002', created_at: 1781658443000 };
    await context.downloadBearEstimateXls(item, false);
    assert.match(preview.fileName, /bear_estimate_002.*\.xlsx/);
    assert.equal(typeof preview.onSave, 'function');
    assert.equal(loads, 0);
    await context.downloadAllBearEstimatesXls([item, item]);
    assert.match(preview.fileName, /bear_estimates_all_.*\.xlsx/);
    assert.equal(loads, 0);
  }
});

test('web local and realtime TXT open a preview before downloading', async () => {
  const start = client.indexOf('  async function downloadBearEstimateTxt(');
  const end = client.indexOf('  function loadSheetJS(', start);
  let preview;
  const context = vm.createContext({
    Number, Intl, Date, console,
    normalizeOwnerName: value => value, normalizePlaceName: value => value,
    formatKstDateTimeLabel: () => '2026-06-17 10:07:23',
    parseSavedDateTime: value => new Date(value), decimalToDMS: () => 'DMS',
    legacyTmCoordFromWgs84: () => [254269.123, 202616.818],
    isNativeCapacitorPlatform: () => false,
    showSavedTxtPreviewPopup: async value => { preview = value; },
  });
  vm.runInContext(client.slice(start, end), context);
  for (const isRealtime of [false, true]) {
    await context.downloadBearEstimateTxt({
      id: 'item-1', isRealtime, lat: 35.3, lng: 127.7,
      bear_code: '002', created_at: 1781658443000,
    }, !isRealtime);
    assert.match(preview.fileName, /bear_estimate_002.*\.txt/);
    assert.match(preview.txtContent, /002/);
    assert.equal(typeof preview.onSave, 'function');
  }
});

test('web TXT and XLS previews download only after Save and close without native file dialogs', async () => {
  const txtStart = client.indexOf('  function showSavedTxtPreviewPopup(');
  const txtEnd = client.indexOf('  // XLS 파일 미리보기 팝업', txtStart);
  const xlsStart = client.indexOf('  function showSavedXlsPreviewPopup(');
  const xlsEnd = client.indexOf('  function rememberNativeTileUrl(', xlsStart);
  const buttons = [];
  const createElement = tag => ({
    tag, style: {}, children: [], listeners: {}, textContent: '', parentNode: null,
    appendChild(child) { child.parentNode = this; this.children.push(child); },
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; },
    addEventListener(type, handler) { this.listeners[type] = handler; },
  });
  const body = createElement('body');
  const context = vm.createContext({
    Promise, console, document: { body, createElement(tag) {
      const node = createElement(tag);
      if (tag === 'button') buttons.push(node);
      return node;
    } },
    window: { alert() { throw new Error('native alert must not open'); } },
    registerBackClosableOverlay: () => () => {},
    isNativeCapacitorPlatform: () => false,
    showSavedFileOpenDialog: () => { throw new Error('native dialog must not open'); },
  });
  vm.runInContext(client.slice(txtStart, txtEnd) + client.slice(xlsStart, xlsEnd), context);
  for (const [name, createPreview] of [
    ['TXT', onSave => context.showSavedTxtPreviewPopup({ fileName: 'test.txt', txtContent: 'data', onSave })],
    ['XLS', onSave => context.showSavedXlsPreviewPopup({ fileName: 'test.xlsx', previewHtml: '<table></table>', onSave })],
  ]) {
    let saves = 0;
    async function onSave() { saves++; }
    buttons.length = 0;
    const popup = createPreview(onSave);
    assert.equal(saves, 0, name);
    const saveButton = buttons.find(button => button.textContent === '저장하기');
    assert.ok(saveButton, name);
    await saveButton.listeners.click();
    assert.equal(saves, 1, name);
    assert.equal(await popup, 'saved');
  }
});

test('realtime TXT does not look up unrelated local observations with the same ID', async () => {
  const start = client.indexOf('  async function downloadBearEstimateTxt(');
  const end = client.indexOf('  function loadSheetJS(', start);
  let preview;
  let queries = 0;
  const context = {
    Number, Intl, Date, console,
    normalizeOwnerName: value => value, normalizePlaceName: value => value,
    formatKstDateTimeLabel: () => '2026-06-17 10:07:23', decimalToDMS: () => 'DMS',
    parseSavedDateTime: value => new Date(value),
    legacyTmCoordFromWgs84: () => [254269.123, 202616.818],
    getCapacitorSQLitePlugin: () => { queries++; throw new Error('must not query'); },
    isNativeCapacitorPlatform: () => true,
    showSavedTxtPreviewPopup: async value => { preview = value; },
  };
  vm.createContext(context);
  vm.runInContext(client.slice(start, end), context);
  await context.downloadBearEstimateTxt({ id: '1', isRealtime: true, lat: 35.3, lng: 127.7, bear_code: '002', created_at: 1781658443000 }, false);
  assert.equal(queries, 0);
  assert.match(preview.txtContent, /002/);
  assert.match(preview.txtContent, /관측점 목록 \(0개\)/);
});
