const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor() {
    this.nodes = {}; this.events = {}; this.children = []; this.attributes = {};
    this.dataset = {}; this.value = ''; this.disabled = false; this.hidden = false;
    this.classList = { toggle: (key, on) => { this[key] = on; } };
  }
  querySelector(key) { return this.nodes[key] ||= new Element(); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, callback) { this.events[key] = callback; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  replaceChildren() { this.children = []; }
  async click() { if (!this.disabled) return this.events.click?.(); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('shared digit markup pairs every decimal position with the correct 10 Hz through whole-MHz step', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync('public/js/sdr/frequency-controls.js', 'utf8'), { window });
  for (const [prefix, wholeDigits, expected] of [
    ['', 3, [100000000,10000000,1000000,100000,10000,1000,100,10]],
    ['bt-', 4, [1000000000,100000000,10000000,1000000,100000,10000,1000,100,10]]
  ]) {
    const markup = window.BearSdrFrequency.markup(prefix, wholeDigits);
    assert.deepEqual([...markup.matchAll(new RegExp(`data-${prefix}freq-up="(\\d+)"`, 'g'))].map(match => Number(match[1])), expected);
    assert.deepEqual([...markup.matchAll(new RegExp(`data-${prefix}freq-down="(\\d+)"`, 'g'))].map(match => Number(match[1])), expected);
  }
});
test('Android settings shortcut is inside collapsed pairing help, not beside refresh', () => {
  const source = fs.readFileSync('public/js/sdr/ic-r30.js', 'utf8');
  assert.match(source, /<details data-bt-pairing[^>]*>[\s\S]*?data-bt-settings[\s\S]*?<\/details>/);
  assert.doesNotMatch(source.match(/<div class="sdr-connection-tools">.*?<\/div>/)[0], /data-bt-settings/);
});
test('Bluetooth refresh is right-aligned in the connection heading alongside USB-style device cards', () => {
  const source = fs.readFileSync('public/js/sdr/ic-r30.js', 'utf8');
  assert.match(source, /<div class="sdr-connection-heading">[^\n]*수신기 연결[^\n]*data-bt-refresh/);
  const css = fs.readFileSync('public/css/sdr-diagnostics.css', 'utf8');
  assert.match(css, /:is\(\.sdr-usb-section, \.sdr-connection\) \.sdr-device/);
  assert.match(css, /\.sdr-connection-tools \{[^}]*margin-left: auto/);
});
test('Bluetooth receive mode is inside collapsed USB-style advanced settings', () => {
  const source = fs.readFileSync('public/js/sdr/ic-r30.js', 'utf8');
  const advanced = source.match(/<details data-bt-advanced-settings[\s\S]*?<\/details>/)[0];
  assert.match(advanced, /class="sdr-advanced"/);
  assert.match(advanced, /<summary>상세 설정/);
  assert.match(advanced, /data-bt-mode/);
  assert.match(advanced, /data-bt-apply-mode/);
  assert.doesNotMatch(advanced.match(/^<details[^>]*>/)[0], /\bopen\b/);
  const css = fs.readFileSync('public/css/sdr-diagnostics.css', 'utf8');
  assert.match(css, /\[data-updating="true"\] \[data-bt-fields\]:disabled,[\s\S]*?opacity: 1/);
});
function setup(native = true) {
  const dialog = new Element(); dialog.open = true;
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; };
  let usbLocked = false, listener, registered, returned, registrationResult = true;
  let state = { state: 'idle', error: '', measurement: null };
  const calls = [];
  const records = [{ id: 'first.csv', createdAt: 1794278036120, bytes: 1000 }];
  function emit(value) { state = value; listener?.(value); return value; }
  const reading = hz => ({ frequencyHz: hz, mode: 'CW', smeter: 153, time: Date.now() });
  const plugin = {
    async addListener(name, fn) { assert.equal(name, 'receiverStateChanged'); listener = fn; return {}; },
    async getStatus() { return state; },
    async listDevices() { return { ...state, devices: [{ deviceId: '01:02:03:04:05:06', name: 'IC-R30', sppSupported: true }] }; },
    async connect(options) { calls.push(['connect', options]); return emit({ state: 'connected', measurement: reading(145520000), error: '', deviceName: 'IC-R30' }); },
    async disconnect() { calls.push(['disconnect']); return emit({ state: 'idle', measurement: null, error: '' }); },
    async setFrequency(options) { calls.push(['frequency', options]); return emit({ ...state, measurement: reading(options.frequencyHz) }); },
    async setMode(options) { calls.push(['mode', options]); return emit({ ...state, measurement: { ...state.measurement, mode: options.mode } }); },
    async openSettings() { calls.push(['settings']); }
  };
  plugin.startTest = async () => {
    calls.push(['startTest']);
    return emit({ ...state, test: { active: true, available: true, count: 0, recent: [] } });
  };
  plugin.stopTest = async () => {
    calls.push(['stopTest']);
    return emit({ ...state, test: { ...state.test, active: false, reason: 'manual', records } });
  };
  plugin.markTest = async () => {
    calls.push(['markTest']);
    return emit({ ...state, test: { ...state.test, marks: (state.test.marks || 0) + 1 } });
  };
  plugin.shareTest = async options => { calls.push(['shareTest', options]); };
  plugin.deleteTest = async options => {
    calls.push(['deleteTest', options]);
    return emit({ ...state, test: { ...state.test, records: [] } });
  };
  const window = {
    confirm: () => true,
    Capacitor: { getPlatform: () => native ? 'android' : 'web', Plugins: { IcR30: plugin } },
    BearSdrAnimals: { formatHz: hz => String(hz / 1e6), load: async () => ({ notice: '', items: [
      { code: 'KF-110', frequencies: [{ slot: 'A', hz: 148241500 }] },
      { code: 'KF-111', frequencies: [] }
    ] }) },
    BearSdrRegistration: { open(context, back) { registered = context; returned = back; return registrationResult; } }
  };
  vm.runInNewContext(fs.readFileSync('public/js/sdr/frequency-controls.js', 'utf8') + '\n' +
    fs.readFileSync('public/js/sdr/ic-r30.js', 'utf8'), { window, document: { createElement: () => new Element() } });
  const favorites = new Set(); let revision = 0, favoritesOnly = false;
  const controller = window.BearIcR30.mount(dialog, {
    usbLocked: () => usbLocked, onChange() {},
    favorites: {
      has: code => favorites.has(code), revision: () => revision,
      only: () => favoritesOnly,
      toggleFilter() { favoritesOnly = !favoritesOnly; },
      toggle(code) { if (favorites.has(code)) favorites.delete(code); else favorites.add(code); revision++; return true; }
    }
  });
  const panel = dialog.querySelector('[data-bluetooth]');
  const footer = dialog.querySelector('[data-bt-footer]');
  const node = key => (key === 'register' || key === 'target' ? footer : panel).querySelector(`[data-bt-${key}]`);
  const tab = key => dialog.querySelector('[data-receiver-selector]').querySelector(`[data-receiver-${key}]`);
  async function connect() {
    await tab('bt').click(); await tick();
    await node('refresh').click();
    await node('devices').children[0].children[2].click();
  }
  return { dialog, panel, footer, node, tab, plugin, controller, calls, emit, connect, reading,
    setFavoritesOnly(value) { favoritesOnly = value; controller.refreshFavorites(); },
    favoritesOnly: () => favoritesOnly,
    setUsbLocked(value) { usbLocked = value; controller.updateUsb(); },
    registration: () => registered, back: () => returned?.(),
    setRegistrationResult(value) { registrationResult = value; } };
}

test('Bluetooth choice is previewable on the web but hardware actions are Android-only', async () => {
  const ui = setup(false);
  await ui.tab('bt').click(); await tick();
  assert.equal(ui.dialog.dataset.transport, 'bluetooth');
  assert.equal(ui.node('refresh').disabled, true);
  assert.match(ui.node('error').textContent, /Android/);
  assert.equal(ui.calls.length, 0);
});
test('lists paired devices, connects, renders raw meter and prevents switching connected receivers', async () => {
  const ui = setup(); await ui.connect();
  assert.equal(ui.controller.status().state, 'connected');
  assert.equal(ui.node('controls').hidden, false);
  assert.equal(ui.node('strength').textContent, '153 / 255');
  assert.equal(ui.node('meter').attributes['aria-valuenow'], '153');
  assert.match(ui.node('readout').textContent, /145.52 MHz · CW/);
  assert.equal(ui.tab('usb').disabled, true);
  assert.equal(ui.node('register').disabled, false);
  assert.equal(ui.node('status').hidden, true);
  assert.equal(ui.node('connected').hidden, false);
  assert.equal(ui.node('connected-name').textContent, 'IC-R30');
  assert.equal(ui.footer.hidden, false);
  await ui.node('disconnect').click();
  assert.equal(ui.tab('usb').disabled, false);
  assert.equal(ui.node('controls').hidden, true);
  assert.equal(ui.node('status').hidden, false);
  assert.equal(ui.node('connected').hidden, true);
  assert.equal(ui.footer.hidden, true);
});
test('paired list filters by SPP service regardless of name and leaves unconfirmed devices in a collapsed fallback', async () => {
  const ui = setup();
  const names = ['Headphones', 'ICOM BT-003', 'Car Audio', 'ic-r30', 'IC R30 receiver', 'IC-R3000', 'ICOM BT-003X', '', 'Renamed receiver'];
  ui.plugin.listDevices = async () => ({ ...ui.controller.status(), devices: names.map((name, index) => ({
    name, deviceId: String(index), sppSupported: [0, 2, 8].includes(index),
    serviceInfoAvailable: index !== 7, majorDeviceClass: index === 0 ? 1024 : 7936
  })) });
  await ui.tab('bt').click(); await tick(); await ui.node('refresh').click();
  assert.deepEqual(ui.node('devices').children.map(card => card.children[0].textContent), ['Headphones', 'Car Audio', 'Renamed receiver']);
  assert.match(ui.node('devices').children[0].children[1].textContent, /SPP 지원 확인 · 오디오·영상/);
  assert.equal(ui.node('other-device-list').children.length, 6);
  assert.equal(ui.node('other-devices').hidden, false);
  assert.match(ui.node('other-devices-title').textContent, /6개/);
  assert.match(ui.node('other-device-list').children[0].children[1].textContent, /SPP 미확인/);
  assert.match(ui.node('other-device-list').children.at(-1).children[1].textContent, /서비스 정보 없음/);
  const source = fs.readFileSync('public/js/sdr/ic-r30.js', 'utf8');
  const details = source.match(/<details data-bt-other-devices[^>]*>/)[0];
  assert.doesNotMatch(details, /\bopen\b/);
  await ui.node('other-device-list').children.at(-1).children[2].click();
  assert.equal(ui.calls.at(-1)[1].deviceId, '7', 'unknown-service receivers retain the normal connect path');
  assert.equal(ui.node('other-devices').hidden, true, 'fallback must not remain visible after connecting');
  assert.equal(ui.node('service-help').hidden, true);
  await ui.node('disconnect').click();
  assert.equal(ui.node('other-devices').hidden, false);
  ui.plugin.listDevices = async () => ({ ...ui.controller.status(), devices: [] });
  await ui.node('refresh').click();
  assert.equal(ui.node('other-device-list').children.length, 0);
  assert.equal(ui.node('other-devices').hidden, true);
  assert.match(ui.node('devices').children[0].textContent, /페어링된 기기가 없습니다/);
});
test('an all-other paired list explains the fallback and refreshing cannot duplicate devices', async () => {
  const ui = setup();
  ui.plugin.listDevices = async () => ({ ...ui.controller.status(), devices: [{ name: 'Renamed receiver', deviceId: 'other' }] });
  await ui.tab('bt').click(); await tick(); await ui.node('refresh').click();
  assert.match(ui.node('devices').children[0].textContent, /SPP 서비스가 확인된 기기가 없습니다/);
  assert.equal(ui.node('other-devices').hidden, false);
  await ui.node('refresh').click();
  assert.equal(ui.node('other-device-list').children.length, 1);
  ui.plugin.listDevices = async () => ({ ...ui.controller.status(), devices: [{ name: 'Custom radio', deviceId: 'radio', sppSupported: true }] });
  await ui.node('refresh').click();
  assert.equal(ui.node('devices').children.length, 1);
  assert.equal(ui.node('other-devices').hidden, true);
});
test('both transports put status inside the same connection card and keep diagnostics available', () => {
  const usb = fs.readFileSync('public/js/sdr/diagnostics.js', 'utf8');
  const bt = fs.readFileSync('public/js/sdr/ic-r30.js', 'utf8');
  assert.match(usb, /<section data-usb-section[^>]*sdr-connection[\s\S]*?<p class="sdr-status sdr-connection-status"[\s\S]*?<\/section>/);
  assert.match(bt, /<section data-bt-connection[\s\S]*?<p data-bt-status class="sdr-connection-status"[\s\S]*?<\/section>/);
  assert.doesNotMatch(usb, /<section data-diagnostic-section[^>]*hidden/);
  for (const source of [usb, bt]) {
    assert.match(source, /class="sdr-device-list"/);
    assert.match(source, /class="sdr-reception-diagnostic[^"]*"[^>]*>\s*<summary>수신 진단 · 저장된 로그/);
    assert.match(source, /<summary>처음 연결하는 경우<\/summary>/);
  }
});
test('Bluetooth selected target remains in the fixed footer and can be cleared without retuning', async () => {
  const ui = setup(); await ui.connect();
  let scrolls = 0;
  ui.node('signal').scrollIntoView = () => { scrolls++; };
  await ui.node('animals').children[0].children[1].children[0].click();
  assert.equal(scrolls, 1);
  ui.emit(ui.controller.status());
  assert.equal(scrolls, 1, 'polling must not repeatedly move the viewport');
  assert.match(ui.node('target').textContent, /KF-110/);
  assert.equal(ui.node('clear').disabled, false);
  const calls = ui.calls.length;
  await ui.node('clear').click();
  assert.equal(ui.calls.length, calls);
  assert.equal(ui.node('register').disabled, false);
  assert.equal(ui.node('clear').disabled, true);
  assert.doesNotMatch(ui.node('target').textContent, /KF-110/);
});
test('Bluetooth search shows an empty state and IME search submits without tuning', async () => {
  const ui = setup(); await ui.connect();
  ui.node('search').value = 'missing'; ui.node('search').events.input();
  assert.equal(ui.node('animals').children[0].textContent, '검색 결과가 없습니다.');
  let prevented = false, blurred = false;
  ui.node('search').blur = () => { blurred = true; };
  ui.node('search-form').events.submit({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(blurred, true);
});
test('USB ownership prevents Bluetooth selection or a stale device connect action', async () => {
  const ui = setup();
  ui.setUsbLocked(true); await ui.tab('bt').click();
  assert.equal(ui.controller.selected(), false);
  ui.setUsbLocked(false); await ui.tab('bt').click(); await tick();
  await ui.node('refresh').click();
  ui.setUsbLocked(true);
  await ui.node('devices').children[0].children[2].click();
  assert.equal(ui.calls.length, 0);
  assert.match(ui.node('error').textContent, /USB/);
});
test('selecting an animal tunes with ACK/readback before registration and reuses the map form', async () => {
  const ui = setup(); await ui.connect();
  await ui.node('animals').children[0].children[1].children[0].click();
  assert.equal(ui.calls.at(-1)[1].frequencyHz, 148241500);
  assert.equal(ui.node('register').disabled, false);
  await ui.node('register').click();
  assert.equal(ui.registration().bearCode, 'KF-110');
  assert.equal(ui.registration().frequencyHz, 148241500);
  assert.equal(ui.registration().receiver, 'IC-R30');
  assert.equal(ui.registration().mode, 'CW');
  assert.equal(ui.dialog.open, false);
  ui.back(); assert.equal(ui.dialog.open, true);
});
test('out-of-range manual tuning, physical radio retuning and disconnect invalidate the registration target', async () => {
  const ui = setup(); await ui.connect();
  const choose = () => ui.node('animals').children[0].children[1].children[0].click();
  await choose();
  await ui.node('frequency-edit').click();
  ui.node('frequency').value = '148.243'; ui.node('frequency').events.input();
  assert.equal(ui.node('register').disabled, true);
  await ui.node('frequency-edit').click();
  assert.equal(ui.calls.at(-1)[1].frequencyHz, 148243000);
  await choose();
  ui.emit({ state: 'connected', measurement: ui.reading(149000000), error: '' });
  assert.equal(ui.node('register').disabled, false);
  await choose();
  ui.emit({ state: 'idle', measurement: null, error: 'CI-V timeout' });
  assert.equal(ui.node('register').disabled, true);
  assert.match(ui.node('error').textContent, /timeout/);
});
test('write failure or mismatched frequency never enables registration', async () => {
  const ui = setup(); await ui.connect();
  ui.plugin.setFrequency = async () => { throw new Error('CI-V FA'); };
  await ui.node('animals').children[0].children[1].children[0].click();
  assert.equal(ui.node('register').disabled, true);
  assert.match(ui.node('error').textContent, /FA/);
  ui.plugin.setFrequency = async () => ({ state: 'connected', measurement: ui.reading(145000000), error: '' });
  await ui.node('animals').children[0].children[1].children[0].click();
  assert.equal(ui.node('register').disabled, true);
  assert.match(ui.node('error').textContent, /적용 주파수/);
});
test('mode changes and frequency steps use measured values and validate range before native writes', async () => {
  const ui = setup(); await ui.connect();
  ui.node('mode').value = 'FM-N'; ui.node('mode').events.change();
  await ui.node('apply-mode').click();
  assert.equal(ui.calls.at(-1)[1].mode, 'FM-N');
  assert.match(ui.node('readout').textContent, /FM-N/);
  await ui.node('freq-up="1000"').click();
  assert.equal(ui.calls.at(-1)[1].frequencyHz, 145521000);
  await ui.node('frequency-edit').click();
  ui.node('frequency').value = '3305'; ui.node('frequency').events.input();
  const count = ui.calls.length;
  await ui.node('frequency-edit').click();
  assert.equal(ui.calls.length, count);
  assert.match(ui.node('error').textContent, /범위/);
});
test('Bluetooth uses USB-style digit buttons, commits once per tap and locks them during recording', async () => {
  const ui = setup(); await ui.connect();
  for (const [index, digit] of Array.from('014552000').entries()) {
    assert.equal(ui.node(`freq-digit="${index}"`).textContent, digit);
  }
  assert.equal(ui.node('frequency-digits').dataset.wide, 'false');
  ui.emit({ state: 'connected', measurement: ui.reading(1145520000), error: '' });
  assert.equal(ui.node('frequency-digits').dataset.wide, 'true');
  await ui.node('freq-down="1000000000"').click();
  assert.equal(ui.controller.status().measurement.frequencyHz, 145520000);
  for (const step of [10, 100, 1000, 10000]) {
    const hz = ui.controller.status().measurement.frequencyHz;
    await ui.node(`freq-up="${step}"`).click();
    assert.equal(ui.calls.at(-1)[1].frequencyHz, hz + step);
    await ui.node(`freq-down="${step}"`).click();
    assert.equal(ui.calls.at(-1)[1].frequencyHz, hz);
  }
  await ui.node('test-start').click();
  assert.equal(ui.node('freq-up="100"').disabled, true);
  assert.equal(ui.node('freq-down="100"').disabled, true);
  assert.equal(ui.node('frequency-edit').disabled, true);
});
test('Bluetooth retains only the selected animal within inclusive 900 Hz and registers actual readback', async () => {
  for (const offset of [-901, -900, -100, 0, 100, 900, 901]) {
    const ui = setup(); await ui.connect();
    await ui.node('animals').children[0].children[1].children[0].click();
    const hz = 148241500 + offset;
    ui.emit({ state: 'connected', measurement: ui.reading(hz), error: '' });
    assert.equal(ui.node('register').disabled, false, `offset ${offset}`);
    assert.equal(ui.node('clear').disabled, Math.abs(offset) > 900);
    assert.equal(ui.node('frequency-animal').hidden, Math.abs(offset) > 900);
    assert.equal(ui.node('frequency-animal').textContent, Math.abs(offset) <= 900 ? 'KF-110' : '');
    {
      await ui.node('register').click();
      assert.equal(ui.registration().frequencyHz, hz);
      assert.equal(ui.registration().bearCode, Math.abs(offset) <= 900 ? 'KF-110' : '');
    }
  }
});
test('Bluetooth range badge works without selecting an animal and allows registration only after draft input is applied', async () => {
  const ui = setup(); await ui.connect();
  ui.emit({ state: 'connected', measurement: ui.reading(148241500), error: '' });
  assert.equal(ui.node('frequency-animal').textContent, 'KF-110');
  assert.equal(ui.node('frequency-animal').hidden, false);
  assert.equal(ui.node('register').disabled, false);
  await ui.node('frequency-edit').click();
  ui.node('frequency').value = '148.2424'; ui.node('frequency').events.input();
  assert.equal(ui.node('frequency-animal').hidden, false);
  ui.node('frequency').value = '148.24241'; ui.node('frequency').events.input();
  assert.equal(ui.node('frequency-animal').hidden, true);
  assert.equal(ui.node('register').disabled, true);
});
test('Bluetooth small digit adjustment preserves selection, uncommitted input blocks registration and cancel restores it', async () => {
  const ui = setup(); await ui.connect();
  await ui.node('animals').children[0].children[1].children[0].click();
  await ui.node('freq-up="100"').click();
  assert.equal(ui.node('register').disabled, false);
  assert.equal(ui.node('clear').disabled, false);
  await ui.node('frequency-edit').click();
  assert.equal(ui.node('register').disabled, true);
  ui.node('frequency').value = '148.2417'; ui.node('frequency').events.input();
  await ui.node('frequency-edit').click();
  assert.equal(ui.calls.at(-1)[1].frequencyHz, 148241700);
  assert.equal(ui.node('register').disabled, false);
  await ui.node('frequency-edit').click();
  ui.node('freq-digit="6"').events.keydown({ key: 'Escape', preventDefault() {} });
  assert.equal(ui.node('register').disabled, false);
});
test('pending Bluetooth tuning preserves card nodes, scroll and last confirmed display without allowing stale actions', async () => {
  const ui = setup(); await ui.connect();
  await ui.node('animals').children[0].children[1].children[0].click();
  const list = ui.node('animals'), card = list.children[0], slot = card.children[1].children[0];
  list.scrollLeft = 47;
  const readout = ui.node('readout').textContent;
  let release;
  ui.plugin.setFrequency = options => new Promise(resolve => {
    ui.emit({ ...ui.controller.status(), measurement: null });
    release = () => resolve(ui.emit({ ...ui.controller.status(), measurement: ui.reading(options.frequencyHz) }));
  });
  const tuning = ui.node('freq-up="100"').click();
  await tick();
  assert.equal(ui.panel.dataset.updating, 'true');
  assert.equal(ui.node('fields').attributes['aria-busy'], 'true');
  assert.equal(list.children[0], card);
  assert.equal(card.children[1].children[0], slot);
  assert.equal(list.scrollLeft, 47);
  assert.equal(slot.disabled, true);
  assert.equal(ui.node('readout').textContent, readout);
  assert.match(ui.node('strength').textContent, /153 \/ 255 · 마지막 측정/);
  assert.equal(ui.node('meter').dataset.state, 'updating');
  assert.match(ui.node('measurement-status').textContent, /적용 중/);
  assert.equal(ui.node('register').disabled, true);
  assert.equal(ui.node('test-start').disabled, true);
  release(); await tuning;
  assert.equal(ui.panel.dataset.updating, 'false');
  assert.equal(list.children[0], card);
  assert.equal(list.scrollLeft, 47);
  assert.equal(slot.disabled, false);
  assert.equal(ui.node('meter').dataset.state, 'live');
  assert.doesNotMatch(ui.node('strength').textContent, /마지막 측정/);
  assert.match(ui.node('readout').textContent, /148.2416 MHz/);
  assert.equal(ui.node('register').disabled, false);
});
test('mode changes preserve cards and advanced expansion while disconnect clears last readings during a pending write', async () => {
  const ui = setup(); await ui.connect();
  const card = ui.node('animals').children[0];
  ui.node('advanced-settings').open = true;
  ui.node('mode').value = 'FM'; ui.node('mode').events.change();
  let reject;
  ui.plugin.setMode = () => new Promise((resolve, fail) => {
    reject = fail; ui.emit({ ...ui.controller.status(), measurement: null });
  });
  const pending = ui.node('apply-mode').click(); await tick();
  assert.equal(ui.node('animals').children[0], card);
  assert.equal(ui.node('advanced-settings').open, true);
  assert.match(ui.node('strength').textContent, /마지막 측정/);
  await ui.node('disconnect').click();
  assert.equal(ui.node('strength').textContent, '측정 대기');
  assert.equal(ui.node('readout').textContent, '수신 주파수 —');
  reject(new Error('연결 취소')); await pending;
  assert.equal(ui.panel.dataset.updating, 'false');
  assert.match(ui.node('error').textContent, /연결 취소/);
});
test('Bluetooth favorites filter and search share the USB favorite callbacks without tuning', async () => {
  const ui = setup(); await ui.connect();
  const list = ui.node('animals');
  const calls = ui.calls.length;
  await list.children[0].children[2].click();
  assert.equal(list.children[0].children[2].textContent, '★');
  await ui.node('favorites-filter').click();
  assert.equal(list.children.length, 1);
  assert.equal(ui.node('animal-count').textContent, '즐겨찾기 1개체');
  ui.node('search').value = '111'; ui.node('search').events.input();
  assert.equal(list.children[0].textContent, '검색 결과가 없습니다.');
  ui.node('search').value = ''; ui.node('search').events.input();
  await list.children[0].children[2].click();
  assert.equal(list.children[0].textContent, '즐겨찾기한 개체가 없습니다.');
  assert.equal(ui.calls.length, calls);
  assert.match(ui.node('measurement-status').textContent, /자동 측정 중/);
});
test('Bluetooth renders externally changed shared filter state and toggles that same state',async()=>{
  const ui=setup();await ui.connect();
  await ui.node('animals').children[0].children[2].click();
  ui.setFavoritesOnly(true);
  assert.equal(ui.node('favorites-filter').attributes['aria-pressed'],'true');
  assert.equal(ui.node('animals').children.length,1);
  await ui.node('favorites-filter').click();
  assert.equal(ui.favoritesOnly(),false);
  assert.equal(ui.node('favorites-filter').attributes['aria-pressed'],'false');
  assert.equal(ui.node('animals').children.length,2);
  ui.setFavoritesOnly(true);
  await ui.node('disconnect').click();
  await ui.tab('usb').click();
  await ui.tab('bt').click();await tick();
  assert.equal(ui.favoritesOnly(),true);
  assert.equal(ui.node('favorites-filter').attributes['aria-pressed'],'true');
});
test('reopening and app exit refresh state and explicitly close the Bluetooth connection', async () => {
  const ui = setup(); await ui.connect();
  ui.controller.onOpen(); await tick();
  assert.equal(ui.controller.status().state, 'connected');
  await ui.controller.exit();
  assert.equal(ui.calls.at(-1)[0], 'disconnect');
  assert.equal(ui.controller.status().measurement, null);
});
test('registration failure reopens receiver and preserves an existing draft', async () => {
  const ui = setup(); await ui.connect();
  await ui.node('animals').children[0].children[1].children[0].click();
  ui.setRegistrationResult(false);
  await ui.node('register').click();
  assert.equal(ui.dialog.open, true);
  assert.match(ui.node('error').textContent, /저장 또는 수정/);
});
test('disconnect remains available during a pending Bluetooth connection and late failure cannot restore readings', async () => {
  const ui = setup();
  await ui.tab('bt').click(); await tick(); await ui.node('refresh').click();
  let rejectConnect;
  ui.plugin.connect = () => new Promise((resolve, reject) => {
    rejectConnect = reject;
    ui.emit({ state: 'connecting', measurement: null, error: '' });
  });
  const pending = ui.node('devices').children[0].children[2].click();
  await tick();
  assert.equal(ui.node('disconnect').hidden, false);
  assert.equal(ui.node('disconnect').disabled, false);
  assert.equal(ui.tab('usb').disabled, true);
  await ui.node('disconnect').click();
  rejectConnect(new Error('연결 취소'));
  await pending;
  assert.equal(ui.controller.status().state, 'idle');
  assert.equal(ui.node('register').disabled, true);
  assert.equal(ui.node('strength').textContent, '측정 대기');
  assert.equal(ui.tab('usb').disabled, false);
});
test('a pending mode write clears the live meter but keeps the explicit subject when readback matches', async () => {
  const ui = setup(); await ui.connect();
  await ui.node('animals').children[0].children[1].children[0].click();
  ui.emit({ state: 'connected', measurement: null, error: '' });
  assert.equal(ui.node('register').disabled, true);
  assert.equal(ui.node('strength').textContent, '측정 대기');
  ui.emit({ state: 'connected', measurement: { ...ui.reading(148241500), mode: 'FM' }, error: '' });
  assert.equal(ui.node('register').disabled, false);
});
test('test controls record, mark, stop and share without permitting tuning during recording', async () => {
  const ui = setup();
  assert.equal(ui.node('test-start').disabled, true);
  await ui.connect();
  await ui.node('test-start').click();
  assert.equal(ui.calls.at(-1)[0], 'startTest');
  assert.equal(ui.node('fields').disabled, true);
  assert.equal(ui.node('animals').children[0].children[1].children[0].disabled, true);
  assert.equal(ui.node('test-start').disabled, true);
  assert.equal(ui.node('test-share').disabled, true);
  await ui.node('test-mark').click();
  assert.match(ui.node('test-summary').textContent, /청취 표시 1회/);
  await ui.node('test-stop').click();
  assert.equal(ui.node('fields').disabled, false);
  assert.equal(ui.node('test-share').disabled, false);
  assert.match(ui.node('test-summary').textContent, /수동 종료/);
  await ui.node('test-share').click();
  assert.equal(ui.calls.at(-1)[0], 'shareTest');
  assert.equal(ui.calls.at(-1)[1].id, 'first.csv');
  await ui.node('test-delete').click();
  assert.equal(ui.calls.at(-1)[1].id, 'first.csv');
  assert.equal(ui.node('test-share').disabled, true);
  assert.equal(ui.node('test-record').hidden, true);
});
test('test graph exposes small raw changes and real intervals without claiming signal detection', async () => {
  const ui = setup(); await ui.connect();
  ui.emit({ state: 'connected', error: '', measurement: ui.reading(145520000), test: {
    active: true, available: true, count: 3, min: 10, max: 11, changes: 2,
    durationMs: 1200, meanIntervalMs: 135, maxIntervalMs: 170, recent: [[100, 10], [200, 11], [370, 10]]
  } });
  assert.match(ui.node('test-summary').textContent, /평균 간격 135ms \/ 최대 170ms/);
  assert.match(ui.node('test-range').textContent, /10–11 \/ 255/);
  assert.equal(ui.node('test-line').attributes.points.split(' ').length, 3);
  ui.emit({ state: 'idle', error: 'CI-V timeout', measurement: null, test: {
    active: false, available: true, records: [{ id: 'saved.csv', createdAt: 0, bytes: 100 }], reason: 'disconnected', recent: [[100, 10], [200, 10]]
  } });
  assert.equal(ui.node('test-share').disabled, false);
  assert.equal(ui.node('test-mark').disabled, true);
  assert.match(ui.node('test-summary').textContent, /연결 종료/);
  assert.equal(ui.node('test-line').attributes.points, '0,45 300,45');
});
test('test start and export errors remain visible and a persisted CSV can be shared while disconnected', async () => {
  const ui = setup(); await ui.connect();
  ui.plugin.startTest = async () => { throw new Error('기록 공간 부족'); };
  await ui.node('test-start').click();
  assert.match(ui.node('error').textContent, /공간 부족/);
  ui.emit({ state: 'idle', measurement: null, error: '', test: { active: false, available: true, records: [{ id: 'saved.csv', createdAt: 0, bytes: 100 }] } });
  assert.equal(ui.node('test-share').disabled, false);
  ui.plugin.shareTest = async () => { throw new Error('CSV 공유 실패'); };
  await ui.node('test-share').click();
  assert.match(ui.node('error').textContent, /CSV 공유 실패/);
});
test('record selection survives refresh and deleting a missing record reports its error', async () => {
  const ui = setup(); await ui.connect();
  const records = [{ id: 'new.csv', createdAt: 100, bytes: 300 }, { id: 'old.csv', createdAt: 0, bytes: 100 }];
  const state = { state: 'connected', error: '', measurement: ui.reading(145520000), test: { active: false, records, reason: 'time_limit' } };
  ui.emit(state);
  assert.match(ui.node('test-summary').textContent, /10초 기록 완료/);
  ui.node('test-record').value = 'old.csv';
  ui.emit({ ...state, test: { ...state.test, records: [...records, { id: 'legacy.csv', createdAt: 0, bytes: 40 }] } });
  assert.equal(ui.node('test-record').value, 'old.csv');
  await ui.node('test-share').click();
  assert.equal(ui.calls.at(-1)[1].id, 'old.csv');
  ui.plugin.deleteTest = async () => { throw new Error('선택한 로그가 없습니다.'); };
  await ui.node('test-delete').click();
  assert.match(ui.node('error').textContent, /로그가 없습니다/);
  assert.equal(ui.node('test-record').value, 'old.csv');
});
