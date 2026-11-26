const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

class Element {
  constructor() {
    this.nodes = {}; this.events = {}; this.children = []; this.attributes = {};
    this.dataset = {}; this.value = ''; this.disabled = false; this.hidden = false;
    this.classList = { toggle: (key, on) => { this[key] = on; } };
    this.style = { setProperty: (key, value) => { this.style[key] = value; } };
  }
  querySelector(key) { return this.nodes[key] ||= new Element(); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, callback) { this.events[key] = callback; }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  async click() { if (!this.disabled) return this.events.click?.(); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const archiveCheck = (ui, index) => ui.node('test-record').children[index].children[0].children[0];
function checkArchive(ui, index = 0) {
  const checkbox = archiveCheck(ui, index);
  checkbox.checked = true;
  checkbox.events.change();
}
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
    async getUsbAudioStatus() { return { state: 'active', peakSample: 0, ready: false }; },
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
  plugin.shareTest = async options => { calls.push(['shareTest', options]); };
  plugin.deleteTest = async options => {
    calls.push(['deleteTest', options]);
    return emit({ ...state, test: { ...state.test, records: [] } });
  };
  const timers = new Map();
  let nextTimer = 0;
  const window = {
    confirm: () => true,
    setTimeout(fn) { timers.set(++nextTimer, fn); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
    Capacitor: { getPlatform: () => native ? 'android' : 'web', Plugins: { IcR30: plugin } },
    BearSdrAnimals: { formatHz: hz => String(hz / 1e6), load: async () => ({ notice: '', items: [
      { code: 'KF-110', frequencies: [{ slot: 'A', hz: 148241500 }] },
      { code: 'KF-111', frequencies: [] }
    ] }) },
    BearSdrRegistration: { open(context, back) { registered = context; returned = back; return registrationResult; } }
  };
  vm.runInNewContext(fs.readFileSync('public/js/sdr/frequency-controls.js', 'utf8') + '\n' +
    fs.readFileSync('public/js/sdr/spectrum.js', 'utf8') + '\n' +
    fs.readFileSync('public/js/sdr/diagnostic-logs.js', 'utf8') + '\n' +
    fs.readFileSync('public/js/sdr/diagnostic-trace.js', 'utf8') + '\n' +
    fs.readFileSync('public/js/sdr/ic-r30.js', 'utf8'), { window, document: { createElement: () => new Element() } });
  const favorites = new Set(); let revision = 0, favoritesOnly = false;
  let monitorTransitions = 0;
  const controller = window.BearIcR30.mount(dialog, {
    usbLocked: () => usbLocked, onChange() {}, onTuned: () => { monitorTransitions++; },
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
    monitorTransitions: () => monitorTransitions,
    async pollAudio() {
      const [id, fn] = timers.entries().next().value;
      timers.delete(id);
      await fn();
    },
    setFavoritesOnly(value) { favoritesOnly = value; controller.refreshFavorites(); },
    favoritesOnly: () => favoritesOnly,
    setUsbLocked(value, active = false) { usbLocked = value; controller.updateUsb(active); },
    registration: () => registered, back: () => returned?.(),
    setRegistrationResult(value) { registrationResult = value; } };
}

test('R30 volume buttons apply immediately, combine rapid taps, and reset after reconnect', async () => {
  const ui = setup();
  const connected = { state: 'connected', deviceId: '01:02:03:04:05:06', measurement: ui.reading(145520000) };
  ui.plugin.connect = async () => ui.emit({ ...connected, volume: { current: 20, default: 20 } });
  let acknowledgeFirst;
  const requested = [];
  ui.plugin.setVolume = async ({ level }) => {
    requested.push(level);
    if (requested.length === 1) await new Promise(resolve => { acknowledgeFirst = resolve; });
    return ui.emit({ ...connected, volume: { current: level, default: 20 } });
  };
  await ui.connect();
  assert.equal(ui.node('volume-settings').hidden, false);
  assert.equal(ui.node('volume').textContent, '20');
  const firstPress = ui.node('volume-up').click();
  assert.equal(ui.node('volume').textContent, '21');
  await tick();
  assert.deepEqual(requested, [21]);
  await ui.node('volume-up').click();
  await ui.node('volume-up').click();
  ui.emit({ ...connected, volume: { current: 20, default: 20 } });
  assert.equal(ui.node('volume').textContent, '23');
  acknowledgeFirst();
  await firstPress;
  assert.deepEqual(requested, [21, 23]);
  assert.equal(ui.node('volume-status').hidden, true);
  await ui.node('volume-down').click();
  assert.deepEqual(requested, [21, 23, 22]);
  assert.equal(ui.node('volume').textContent, '22');
  await ui.node('disconnect').click();
  assert.equal(ui.node('volume-settings').hidden, true);
  await ui.connect();
  assert.equal(ui.node('volume').textContent, '20');
});

test('Bluetooth USB audio follows attachment and closing the dialog only stops UI polling', async () => {
  const ui = setup();
  const spectrumDbfs = Array(80).fill(-100);
  spectrumDbfs[19] = -31;
  const audio = {
    state: 'active', message: 'USB Audio Device', peakSample: 600,
    spectrumDbfs, spectrumCenterHz: 1200, spectrumSpanHz: 1875,
    ready: true, tracked: true, confidence: 2, toneHz: 700, snrDb: 12.5, count: 3, speakerEnabled: true,
    playbackOutput: '기기 스피커'
  };
  let attached = false;
  ui.plugin.getUsbAudioStatus = async () => attached ? audio : { state: 'waiting' };
  ui.plugin.setUsbAudioPlayback = async settings => {
    if ("muted" in settings) audio.speakerEnabled = !settings.muted;
    if ("filterLevel" in settings) audio.filterLevel = settings.filterLevel;
    return audio;
  };
  await ui.connect();
  assert.match(ui.node('audio-peak').textContent, /USB 오디오가 연결되면/);
  try {
    attached = true;
    await ui.pollAudio();
    assert.equal(ui.node('audio-level').hidden, false);
    assert.match(ui.node('audio-level').textContent, /입력 피크 -34\.7 dBFS/);
    assert.match(ui.node('audio-tone').textContent, /반복 CW 후보 · 700 Hz.*3회/);
    assert.match(ui.node('audio-peak').textContent, /최대 피크 708 Hz.*CW 후보 700 Hz/);
    assert.match(ui.node('audio-status').textContent, /기기 스피커/);
    audio.playbackOutput = '블루투스 미디어 출력';
    await ui.pollAudio();
    assert.match(ui.node('audio-status').textContent, /블루투스 미디어 출력/);
    audio.playbackOutput = '기기 스피커';
    await ui.pollAudio();
    assert.match(ui.node('audio-status').textContent, /기기 스피커/);
    ui.node('audio-filter').value = '3';
    await ui.node('audio-filter').events.change();
    assert.equal(ui.node('audio-filter').value, '3');
    await ui.node('audio-mute').click();
    assert.equal(ui.node('audio-mute').textContent, '소리 켜기');
    assert.match(ui.node('audio-peak').textContent, /CW 후보 700 Hz/);
    await ui.node('audio-mute').click();
    assert.equal(ui.node('audio-mute').textContent, '음소거');
    attached = false;
    await ui.pollAudio();
    assert.equal(ui.node('audio-level').hidden, true);
    assert.match(ui.node('audio-status').textContent, /연결 대기/);
    assert.equal(ui.controller.status().state, 'connected');
    attached = true;
    await ui.pollAudio();
    assert.match(ui.node('audio-peak').textContent, /CW 후보 700 Hz/);
  } finally {
    ui.dialog.close();
    ui.dialog.events.close();
  }
  assert.equal(ui.node('audio-level').hidden, true);
  assert.match(ui.node('audio-peak').textContent, /USB 오디오가 연결되면/);
  assert.equal(ui.calls.some(([method]) => method === 'disconnect'), false);
  assert.equal(ui.controller.status().state, 'connected');
});

test('a dead IH389 audio chain (flat input) warns, while plain receiver noise does not', async () => {
  const ui = setup();
  // Field readings: card alone / IH389 off ≤ -100 dBFS/bin, IH389 linked noise ≈ -45, beep ≈ -10.
  const level = db => Array(80).fill(db);
  const audio = { state: 'active', message: 'USB Audio Device', peakSample: 0, spectrumDbfs: level(-105), ready: false, count: 0 };
  ui.plugin.getUsbAudioStatus = async () => audio;
  await ui.connect(); // connecting already delivers the first audio frame
  const poll = async count => { for (let i = 0; i < count; i++) await ui.pollAudio(); };
  await poll(38);
  assert.equal(ui.node('audio-silent').hidden, true, 'a short gap is not a fault');
  await poll(1);
  assert.equal(ui.node('audio-silent').hidden, false);
  assert.match(ui.panel.innerHTML, /data-bt-audio-silent[^>]*>[^<]*IH389/);
  audio.spectrumDbfs = level(-45); // live chain, receiver noise only, no beep
  await poll(1);
  assert.equal(ui.node('audio-silent').hidden, true);
  audio.spectrumDbfs = level(-Infinity); // digital zero is silent too
  await poll(40);
  assert.equal(ui.node('audio-silent').hidden, false);
  audio.state = 'waiting'; // sound card unplugged: the USB status message covers it instead
  await poll(1);
  assert.equal(ui.node('audio-silent').hidden, true);
});
test('Bluetooth USB audio exposes a permission action only when Android needs it', async () => {
  const ui = setup();
  const permissionRequests = [];
  ui.plugin.getUsbAudioStatus = async ({ requestPermission }) => {
    permissionRequests.push(requestPermission);
    return requestPermission ? { state: 'starting' } : { state: 'permission' };
  };
  await ui.connect();
  assert.equal(ui.node('audio-permission').hidden, false);
  await ui.pollAudio();
  assert.deepEqual(permissionRequests, [false, false]);
  await ui.node('audio-permission').click();
  assert.deepEqual(permissionRequests, [false, false, true]);
  assert.equal(ui.node('audio-permission').hidden, true);
});

test('Bluetooth connection progress identifies SPP and CI-V without treating either as a confirmed measurement', async () => {
  const ui = setup();
  await ui.tab('bt').click();
  await tick();
  for (const message of ['Bluetooth 데이터 연결 재시도 중…', 'Bluetooth 데이터 연결됨 · CI-V 응답 재확인 중…']) {
    ui.emit({ state: 'connecting', connectionProgress: message, measurement: null });
    assert.equal(ui.node('status').textContent, message);
    assert.equal(ui.node('signal').hidden, true);
    assert.equal(ui.node('disconnect').hidden, false);
  }
});

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

test('the live meter shows changes within a segment and clears on disconnect', async () => {
  const ui = setup(); await ui.connect();
  const bar = index => ui.panel.querySelector(`[data-bt-bar="${index}"]`).style['--sdr-meter-fill'];
  const connected = ui.controller.status();
  ui.emit({ ...connected, measurement: { ...connected.measurement, smeter: 100 } });
  const firstFill = parseFloat(bar(3));
  assert.equal(bar(2), '100%');
  assert.equal(bar(4), '0%');
  assert.ok(firstFill > 0 && firstFill < 100);

  ui.emit({ ...connected, measurement: { ...connected.measurement, smeter: 101 } });
  assert.ok(parseFloat(bar(3)) > firstFill && parseFloat(bar(3)) < 100);
  assert.equal(ui.node('meter').attributes['aria-valuenow'], '101');

  await ui.node('disconnect').click();
  assert.equal(bar(3), '0%');
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
  assert.match(usb, /<button[^>]*data-sdr-stage="diagnostics">수신 진단<\/button>/);
  for (const source of [usb, bt]) {
    assert.match(source, /class="sdr-device-list"/);
    assert.match(source, /class="sdr-reception-diagnostic[^"]*"[^>]*>\s*<h3>수신 진단<\/h3>/);
    assert.match(source, /class="sdr-reception-diagnostic sdr-saved-log-list"[^>]*>\s*<h3>(USB|Bluetooth) 저장된 로그<\/h3>/);
    assert.match(source, /<summary>처음 연결하는 경우<\/summary>/);
  }
});
test('Bluetooth selected target remains in the fixed footer and can be cleared without retuning', async () => {
  const ui = setup(); await ui.connect();
  let scrolls = 0;
  ui.node('signal').scrollIntoView = () => { scrolls++; };
  await ui.node('animals').children[0].children[1].children[0].click();
  assert.equal(ui.monitorTransitions(),1);
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
  assert.equal(ui.controller.selected(), true);
  assert.equal(ui.dialog.dataset.transport, 'bluetooth');
  assert.equal(ui.tab('bt').attributes['aria-pressed'], 'true');
  const modes = ui.dialog.querySelector('[data-receiver-selector]').innerHTML;
  assert.ok(modes.indexOf('data-receiver-bt') < modes.indexOf('data-receiver-usb'));
  ui.setUsbLocked(true, true); await ui.tab('bt').click();
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
  ui.node('frequency-draft').value = '148.243'; ui.node('frequency-draft').events.input();
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
test('Bluetooth drop out of range auto-reconnects without losing the selected animal', async () => {
  const ui = setup(); await ui.connect();
  await ui.node('animals').children[0].children[1].children[0].click();
  const tuned = ui.controller.status();
  ui.emit({ ...tuned, state: 'connecting', reconnecting: true, measurement: null,
    connectionProgress: '연결 끊김 · 재연결 대기 중… (Bluetooth 연결이 종료되었습니다.)' });
  assert.match(ui.node('status').textContent, /재연결/);
  assert.equal(ui.node('disconnect').hidden, false, 'user can cancel the retry');
  assert.equal(ui.node('register').disabled, true);
  ui.emit({ ...tuned, reconnecting: false });
  assert.match(ui.node('target').textContent, /KF-110/);
  assert.equal(ui.node('register').disabled, false);
  // Giving up ends the session like a manual disconnect.
  ui.emit({ state: 'idle', measurement: null, error: 'IC-R30 재연결 실패' });
  assert.doesNotMatch(ui.node('target').textContent, /KF-110/);
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
  ui.node('frequency-draft').value = '3305'; ui.node('frequency-draft').events.input();
  const count = ui.calls.length;
  await ui.node('frequency-edit').click();
  assert.equal(ui.calls.length, count);
  assert.match(ui.node('frequency-error').textContent, /범위/);
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
  ui.node('frequency-draft').value = '148.2424'; ui.node('frequency-draft').events.input();
  assert.equal(ui.node('frequency-animal').hidden, false);
  ui.node('frequency-draft').value = '148.24241'; ui.node('frequency-draft').events.input();
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
  ui.node('frequency-draft').value = '148,2417'; ui.node('frequency-draft').events.input();
  await ui.node('frequency-edit').click();
  assert.equal(ui.calls.at(-1)[1].frequencyHz, 148241700);
  assert.equal(ui.node('register').disabled, false);
  await ui.node('frequency-edit').click();
  ui.node('frequency-draft').events.keydown({ key: 'Escape', preventDefault() {} });
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
  assert.equal(ui.node('measurement-status').hidden, true);
  assert.equal(ui.node('measurement-status').textContent, '');
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
test('test controls record, stop and share without permitting tuning during recording', async () => {
  const ui = setup();
  assert.equal(ui.node('test-start').disabled, true);
  await ui.connect();
  await ui.node('test-start').click();
  assert.equal(ui.calls.at(-1)[0], 'startTest');
  assert.equal(ui.node('fields').disabled, true);
  assert.equal(ui.node('animals').children[0].children[1].children[0].disabled, true);
  assert.equal(ui.node('test-start').disabled, true);
  assert.equal(ui.node('test-share').disabled, true);
  await ui.node('test-stop').click();
  assert.equal(ui.node('fields').disabled, false);
  checkArchive(ui);
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
test('Bluetooth audio peaks keep their horizontal positions as recording progresses', async () => {
  const ui = setup(); await ui.connect();
  const trace = { id:'first', recordedElapsedMs:1200, recordingDurationMs:10000, audioIntervalMs:100,
    audioPeaks:[0,32768,0] };
  ui.emit({ state: 'connected', error: '', measurement: ui.reading(145520000), test: {
    active: true, available: true, count: 3, changes: 2,
    durationMs: 1200, meanIntervalMs: 135, maxIntervalMs: 170, audioTrace:trace
  } });
  assert.match(ui.node('test-summary').textContent, /평균 간격 135ms \/ 최대 170ms/);
  assert.match(ui.node('test-audio-level').textContent, /1\.2 \/ 10초/);
  assert.equal(ui.node('test-progress').max, 10000);
  assert.equal(ui.node('test-progress').hidden, false);
  const original = ui.node('test-audio-line').attributes.points;
  assert.equal(original, '0,85 3,5 6,85');
  const newTrace={...trace,recordedElapsedMs:2400,audioPeaks:[...trace.audioPeaks,16000]};
  ui.plugin.getUsbAudioStatus=async()=>({state:'active',peakSample:16000,ready:false,diagnosticTrace:newTrace});
  await ui.pollAudio();
  assert.equal(ui.node('test-progress').value, 2400);
  assert.ok(ui.node('test-audio-line').attributes.points.startsWith(original+' '));
  ui.emit({ state: 'idle', error: 'CI-V timeout', measurement: null, test: {
    active: false, available: true, records: [{ id: 'saved.csv', createdAt: 0, bytes: 100 }], reason: 'disconnected',
    audioTrace:newTrace
  } });
  checkArchive(ui);
  assert.equal(ui.node('test-share').disabled, false);
  assert.match(ui.node('test-summary').textContent, /연결 종료/);
  assert.equal(ui.node('test-progress').hidden, true);
  assert.ok(ui.node('test-audio-line').attributes.points.startsWith(original+' '));
});
test('test start and export errors remain visible and a persisted CSV can be shared while disconnected', async () => {
  const ui = setup(); await ui.connect();
  ui.plugin.startTest = async () => { throw new Error('기록 공간 부족'); };
  await ui.node('test-start').click();
  assert.match(ui.node('error').textContent, /공간 부족/);
  ui.emit({ state: 'idle', measurement: null, error: '', test: { active: false, available: true, records: [{ id: 'saved.csv', createdAt: 0, bytes: 100 }] } });
  assert.equal(ui.node('test-start').disabled, true);
  let savedId;
  ui.plugin.saveTest = async ({ id }) => { savedId = id; };
  ui.emit(ui.controller.status());
  checkArchive(ui);
  await ui.node('test-save').click();
  assert.equal(savedId, 'saved.csv');
  assert.equal(ui.node('test-share').disabled, false);
  ui.plugin.shareTest = async () => { throw new Error('CSV 공유 실패'); };
  await ui.node('test-share').click();
  assert.match(ui.node('error').textContent, /CSV 공유 실패/);
});
test('switching USB and Bluetooth archives does not change or require a receiver connection', async () => {
  const ui = setup();
  await ui.tab('usb').click();
  ui.emit({ state: 'idle', error: '', measurement: null, test: {
    active: false, records: [{ id: 'saved.csv', createdAt: 0, bytes: 100, hasAudio: true }]
  } });
  assert.equal(ui.controller.showDiagnostics(true), 'usb');
  await ui.tab('bt').click();
  await tick();
  assert.equal(ui.dialog.dataset.transport, 'bluetooth');
  assert.equal(ui.controller.selected(), false);
  assert.equal(ui.node('test-start').disabled, true);
  checkArchive(ui);
  await ui.node('test-share').click();
  assert.equal(ui.calls.at(-1)[1].id, 'saved.csv');
  assert.equal(ui.calls.some(([method]) => method === 'connect'), false);
  await ui.tab('usb').click();
  assert.equal(ui.dialog.dataset.transport, 'usb');
  ui.controller.showDiagnostics(false);
  await ui.connect();
  assert.equal(ui.tab('usb').disabled, true);
  assert.equal(ui.controller.showDiagnostics(true), 'bluetooth');
  await ui.tab('usb').click();
  assert.equal(ui.dialog.dataset.transport, 'usb');
  assert.equal(ui.controller.status().state, 'connected');
  assert.equal(ui.controller.showDiagnostics(false), 'bluetooth');
  assert.equal(ui.tab('usb').disabled, true);
});
test('Bluetooth recording requires USB receiver audio and offers mic permission from diagnostics', async () => {
  const ui = setup();
  let permissionRequested = false;
  ui.plugin.getUsbAudioStatus = async ({ requestPermission }) => {
    if (!requestPermission) return { state: 'permission', message: 'USB 오디오 권한 대기' };
    permissionRequested = true;
    return { state: 'active', peakSample: 0, ready: false };
  };
  await ui.connect();
  assert.equal(ui.node('test-start').disabled, true);
  assert.equal(ui.node('test-audio-permission').hidden, false);
  await ui.node('test-audio-permission').click();
  assert.equal(permissionRequested, true);
  assert.equal(ui.node('test-start').disabled, false);
  assert.equal(ui.node('test-audio-status').hidden, true);
});
test('record selection survives refresh and deleting a missing record reports its error', async () => {
  const ui = setup(); await ui.connect();
  const records = [{ id: 'new.csv', createdAt: 100, bytes: 300 }, { id: 'old.csv', createdAt: 0, bytes: 100 }];
  const state = { state: 'connected', error: '', measurement: ui.reading(145520000), test: { active: false, records, reason: 'time_limit' } };
  ui.emit(state);
  assert.match(ui.node('test-summary').textContent, /10초 기록 완료/);
  checkArchive(ui, 1);
  ui.emit({ ...state, test: { ...state.test, records: [...records, { id: 'legacy.csv', createdAt: 0, bytes: 40 }] } });
  assert.equal(archiveCheck(ui, 1).checked, true);
  await ui.node('test-share').click();
  assert.equal(ui.calls.at(-1)[1].id, 'old.csv');
  ui.plugin.deleteTest = async () => { throw new Error('선택한 로그가 없습니다.'); };
  await ui.node('test-delete').click();
  assert.match(ui.node('error').textContent, /로그가 없습니다/);
  assert.equal(archiveCheck(ui, 1).checked, true);
});
