const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/js/sdr/diagnostics.js'), 'utf8');
const spectrumSource = fs.readFileSync(require('node:path').join(__dirname, '../public/js/sdr/spectrum.js'), 'utf8');

// Small DOM stand-in to exercise asynchronous UI/bridge behavior, not USB hardware.
class Element {
  constructor() { this.children = []; this.events = {}; this.nodes = {}; this.disabled = false; this.value = ''; }
  setAttribute() {}
  querySelector(key) { return this.nodes[key] ||= new Element(); }
  addEventListener(name, callback) { this.events[name] = callback; }
  append(...elements) { this.children.push(...elements); }
  appendChild(element) { this.append(element); }
  replaceChildren() { this.children = []; }
  showModal() { this.open = true; }
  close() { this.open = false; return this.events.close?.(); }
  async click() { if (!this.disabled) await this.events.click?.(); }
  async change(value) { this.value = value; await this.events.change?.(); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(android = true, bridgeMode = 'injected') {
  const trigger = new Element(), body = new Element();
  const device = { deviceId: '/usb/1', name: 'RTL2832U', vendorId: 3034, productId: 10290, candidate: true, hasPermission: false, connected: false };
  const state = { hostSupported: true, state: 'idle', devices: [device] };
  let callback, permission, openCount = 0, permissionCount = 0;
  const plugin = {
    starts: [], audios: [],
    async setAudio(options) {
      this.audios.push(options); state.audio ||= { enabled: false, volume: .25 };
      if (options.enabled != null) state.audio.enabled = options.enabled;
      if (options.volume != null) state.audio.volume = options.volume;
      callback(state);
    },
    async startReception(options) { this.starts.push(options); state.receptionState = 'starting'; callback(state); },
    async stopReception() { state.receptionState = 'idle'; callback(state); },
    getStatus: async () => state,
    addListener: async (_, fn) => { callback = fn; return { remove() {} }; },
    requestDevicePermission() {
      permissionCount++;
      state.state = 'permissionPending'; callback(state);
      return new Promise((resolve, reject) => { permission = { resolve, reject }; });
    },
    async openDevice() { openCount++; device.connected = true; state.state = 'connected'; callback(state); },
    async closeDevice() {
      permission?.reject(new Error('요청 취소')); permission = null;
      device.connected = false; state.state = 'idle'; callback?.(state);
    }
  };
  const capacitor = android ? { getPlatform: () => 'android' } : undefined;
  if (android && bridgeMode === 'injected') capacitor.Plugins = { RtlSdr: plugin };
  if (android && bridgeMode === 'registered') capacitor.registerPlugin = () => plugin;
  if (android && bridgeMode === 'throws') capacitor.registerPlugin = () => { throw new Error('bridge init failure'); };
  vm.runInNewContext(spectrumSource + '\n' + source, {
    document: { getElementById: () => trigger, createElement: () => new Element(), body },
    window: { Capacitor: capacitor }, console
  });
  const dialog = body.children[0];
  for (const [key, value] of Object.entries({band: 'vhf', frequency: '150.000', rate: '1024000', gain: '10', ppm: '0'})) {
    dialog.querySelector(`[data-${key}]`).value = value;
  }
  return {
    trigger, dialog, state, device, capacitor, plugin,
    emit: () => callback(state),
    button: () => dialog.querySelector('[data-devices]').children[0].children[2],
    counts: () => ({ openCount, permissionCount }),
    approve() { device.hasPermission = true; state.state = 'idle'; permission.resolve(device); permission = null; callback(state); },
    deny() { state.state = 'idle'; permission.reject(new Error('권한 거부')); permission = null; callback(state); },
  };
}

test('permission approval automatically opens USB once without a second click', async () => {
  const ui = setup();
  ui.state.devices.unshift({ name: 'USB LAN', candidate: false }, { name: 'USB audio', candidate: false });
  await ui.trigger.click();
  assert.equal(ui.dialog.querySelector('[data-devices]').children.length, 1);
  void ui.button().click(); await tick();
  assert.equal(ui.button().disabled, true);
  await ui.button().click(); assert.equal(ui.counts().permissionCount, 1);
  ui.approve(); await tick();
  assert.equal(ui.counts().openCount, 1);
  assert.equal(ui.button().textContent, '연결됨');
  assert.equal(ui.button().className, 'sdr-connected-badge');
  assert.match(ui.dialog.querySelector('.sdr-status').textContent, /USB 연결됨/);
  await ui.dialog.close(); assert.equal(ui.state.state, 'idle');
});

test('registerPlugin API remains supported when supplied by a bundled runtime', async () => {
  const ui = setup(true, 'registered'); await ui.trigger.click();
  assert.equal(ui.dialog.open, true);
  assert.equal(ui.button().disabled, false);
});

test('automatic open failure retains permission and retries without requesting it again', async () => {
  const ui = setup();
  const openDevice = ui.plugin.openDevice;
  ui.plugin.openDevice = async () => { throw new Error('USB open failed'); };
  await ui.trigger.click(); void ui.button().click(); await tick();
  ui.approve(); await tick();
  assert.match(ui.dialog.querySelector('.sdr-message').textContent, /USB open failed/);
  assert.equal(ui.button().textContent, '연결');
  assert.equal(ui.button().disabled, false);
  ui.plugin.openDevice = openDevice;
  await ui.button().click(); await tick();
  assert.equal(ui.counts().permissionCount, 1);
  assert.equal(ui.counts().openCount, 1);
});

test('late permission approval after closing the dialog cannot reopen USB', async () => {
  const ui = setup(); let approve;
  ui.plugin.requestDevicePermission = () => {
    ui.state.state = 'permissionPending'; ui.emit();
    return new Promise(resolve => { approve = resolve; });
  };
  await ui.trigger.click(); void ui.button().click(); await tick();
  await ui.dialog.close();
  ui.device.hasPermission = true; approve(ui.device); await tick();
  assert.equal(ui.counts().openCount, 0);
  assert.equal(ui.state.state, 'idle');
});

test('missing native plugin opens diagnostics with an error and can retry on reopen', async () => {
  const ui = setup(true, 'missing'); await ui.trigger.click();
  assert.equal(ui.dialog.open, true);
  assert.match(ui.dialog.querySelector('.sdr-message').textContent, /RtlSdr/);
  assert.equal(ui.dialog.querySelector('[data-refresh]').disabled, true);
  await ui.dialog.close();
  ui.capacitor.Plugins = { RtlSdr: ui.plugin };
  await ui.trigger.click();
  assert.equal(ui.button().disabled, false);
});

test('initialization exception cannot prevent the button from opening the dialog', async () => {
  const ui = setup(true, 'throws'); await ui.trigger.click();
  assert.equal(ui.dialog.open, true);
  assert.match(ui.dialog.querySelector('.sdr-message').textContent, /bridge init failure/);
});

test('denial and cancellation allow a new permission request', async () => {
  const ui = setup(); await ui.trigger.click(); void ui.button().click(); await tick();
  ui.deny(); await tick();
  assert.equal(ui.button().disabled, false);
  assert.match(ui.dialog.querySelector('.sdr-message').textContent, /권한 거부/);
  void ui.button().click(); await tick();
  const cancel = ui.dialog.querySelector('[data-disconnect]');
  assert.equal(cancel.disabled, false);
  await cancel.click(); await tick();
  assert.equal(ui.button().disabled, false);
  assert.equal(ui.counts().openCount, 0);
  void ui.button().click(); await tick(); assert.equal(ui.counts().permissionCount, 3);
  await ui.dialog.close(); await tick();
});

test('web mode and unsupported devices cannot request USB access', async () => {
  const web = setup(false); await web.trigger.click();
  assert.equal(web.dialog.querySelector('[data-refresh]').disabled, true);
  assert.match(web.dialog.querySelector('.sdr-status').textContent, /Android/);
  const android = setup(); android.device.candidate = false; await android.trigger.click();
  const list = android.dialog.querySelector('[data-devices]');
  assert.equal(list.children.length, 1);
  assert.match(list.children[0].textContent, /RTL-SDR 없음/);
  assert.equal(list.children[0].children.length, 0);
  assert.equal(android.counts().permissionCount, 0);
});

test('reception validates settings, converts units, locks settings, and stops', async () => {
  const ui = setup(); ui.device.hasPermission = true;
  await ui.trigger.click(); await ui.button().click(); await tick();
  const start = ui.dialog.querySelector('[data-start]');
  ui.dialog.querySelector('[data-frequency]').value = '175';
  await start.click(); await tick();
  assert.equal(ui.plugin.starts.length, 0);
  assert.match(ui.dialog.querySelector('.sdr-message').textContent, /설정 범위/);
  ui.dialog.querySelector('[data-frequency]').value = '151.125';
  ui.dialog.querySelector('[data-gain]').value = '19.7';
  await start.click(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.plugin.starts[0])), { band: 'vhf', mode: 'iq', frequencyHz: 151125000, listenFrequencyHz: 151125000, sampleRate: 1024000, gainTenthsDb: 197, ppm: 0, deemphasisUs: 75 });
  assert.equal(start.disabled, true);
  assert.equal(ui.dialog.querySelector('[data-settings]').disabled, true);
  await ui.dialog.querySelector('[data-stop]').click(); await tick();
  assert.equal(start.disabled, false);
  assert.doesNotMatch(ui.dialog.querySelector('.sdr-message').textContent, /object Object/);
});

test('IQ metrics are explicitly distinct from beacon detection and errors allow retry', async () => {
  const ui = setup(); ui.device.hasPermission = true;
  await ui.trigger.click(); await ui.button().click(); await tick();
  ui.state.receptionState = 'receiving';
  ui.state.reception = { tuner: 'FC0013', frequencyHz: 150000000, sampleRate: 1024000, gainDb: 9.7,
    ppm: 0, totalBytes: 4096000, bytesPerSecond: 2048000, powerDbfs: -22, clippingPercent: 0, elapsedSeconds: 2, hasSamples: true };
  ui.emit();
  assert.match(ui.dialog.querySelector('.sdr-status').textContent, /IQ 수신 중/);
  assert.match(ui.dialog.querySelector('[data-applied]').textContent, /FC0013.*9.7 dB/);
  assert.equal(ui.dialog.querySelector('[data-throughput]').textContent, '2.05 MB/s');
  ui.state.receptionState = 'error'; ui.state.receptionError = 'USB IQ read failed (-4)'; ui.emit();
  assert.match(ui.dialog.querySelector('.sdr-message').textContent, /USB IQ read/);
  assert.equal(ui.dialog.querySelector('[data-start]').disabled, false);
});

test('FM selection tunes 103.5 MHz, shows its window, and preserves per-band inputs', async () => {
  const ui = setup(); ui.device.hasPermission = true;
  await ui.trigger.click(); await ui.button().click(); await tick();
  const band = ui.dialog.querySelector('[data-band]'), frequency = ui.dialog.querySelector('[data-frequency]');
  frequency.value = '151.125';
  await band.change('fm');
  assert.equal(frequency.value, '103.500');
  assert.equal(frequency.min, '88'); assert.equal(frequency.max, '108');
  assert.match(ui.dialog.querySelector('[data-window]').textContent, /102.988–104.012 MHz.*2.048 MB\/s/);
  await ui.dialog.querySelector('[data-start]').click(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.plugin.starts[0])), { band: 'fm', mode: 'iq', frequencyHz: 103500000, listenFrequencyHz: 103500000, sampleRate: 1024000, gainTenthsDb: 100, ppm: 0, deemphasisUs: 75 });
  await ui.dialog.querySelector('[data-stop]').click(); await tick();
  frequency.value = '101.100';
  await band.change('vhf'); assert.equal(frequency.value, '151.125');
  await band.change('fm'); assert.equal(frequency.value, '101.100');
});

test('selected-band boundaries are enforced and every new rate preset reaches the bridge', async () => {
  for (const [bandValue, hz, sampleRate] of [
    ['fm', '88', '250000'], ['fm', '108', '2400000'], ['vhf', '148', '1536000'], ['vhf', '174', '2048000']
  ]) {
    const ui = setup(); ui.device.hasPermission = true;
    await ui.trigger.click(); await ui.button().click(); await tick();
    await ui.dialog.querySelector('[data-band]').change(bandValue);
    ui.dialog.querySelector('[data-frequency]').value = hz;
    await ui.dialog.querySelector('[data-rate]').change(sampleRate);
    await ui.dialog.querySelector('[data-start]').click(); await tick();
    assert.equal(ui.plugin.starts.length, 1);
    assert.equal(ui.plugin.starts[0].sampleRate, Number(sampleRate));
  }
  const ui = setup(); ui.device.hasPermission = true;
  await ui.trigger.click(); await ui.button().click(); await tick();
  for (const [bandValue, hz, sampleRate] of [
    ['vhf', '103.5', '1024000'], ['fm', '150', '1024000'], ['fm', '108.001', '1024000'],
    ['fm', '103.5', '512000'], ['fm', '103.5', '3200000'], ['fm', '', '1024000']
  ]) {
    await ui.dialog.querySelector('[data-band]').change(bandValue);
    ui.dialog.querySelector('[data-frequency]').value = hz;
    ui.dialog.querySelector('[data-rate]').value = sampleRate;
    await ui.dialog.querySelector('[data-start]').click(); await tick();
    assert.equal(ui.plugin.starts.length, 0);
  }
});

test('spectrum shows frequency locations, ignores DC/edges for the marker, and labels stopped data', async () => {
  const ui = setup(); ui.device.hasPermission = true;
  await ui.trigger.click(); await ui.button().click(); await tick();
  const bins = Array(1024).fill(-100); bins[512] = -10; bins[0] = -5; bins[620] = -30;
  ui.state.receptionState = 'receiving';
  ui.state.reception = { frequencyHz: 103500000, sampleRate: 1024000, spectrumDbfs: bins };
  ui.emit();
  const caption = ui.dialog.querySelector('[data-spectrum-summary]');
  assert.match(ui.dialog.querySelector("[data-spectrum-info]").textContent, /102.988–104.012 MHz/);
  assert.match(caption.textContent, /103.608 MHz.*-30.0 dBFS\/bin/);
  assert.match(ui.dialog.querySelector("[data-spectrum-info]").textContent, /1000 Hz/);
  assert.match(caption.textContent, /수신 중/);
  ui.state.receptionState = 'idle'; ui.emit();
  assert.match(caption.textContent, /정지됨 · 마지막 측정/);
  await ui.dialog.querySelector('[data-start]').click(); await tick();
  ui.state.reception = {}; ui.emit();
  assert.doesNotMatch(caption.textContent, /103.608/);
});

test('missing or malformed spectrum cannot masquerade as a live trace', async () => {
  const ui = setup(); ui.device.hasPermission = true;
  await ui.trigger.click(); await ui.button().click(); await tick();
  ui.state.receptionState = 'receiving';
  for (const bins of [undefined, [], Array(1024).fill(NaN), Array(1024).fill(Infinity)]) {
    ui.state.reception = { frequencyHz: 103500000, sampleRate: 1024000, spectrumDbfs: bins }; ui.emit();
    assert.match(ui.dialog.querySelector('[data-spectrum-summary]').textContent, /대기 중/);
  }
});


test('WFM displays native default playback, can mute and unmute, and uses device media volume', async () => {
  const ui = setup(); ui.device.hasPermission = true;
  await ui.trigger.click(); await ui.button().click(); await tick();
  await ui.dialog.querySelector('[data-mode]').change('wfm');
  assert.equal(ui.dialog.querySelector('[data-audio-panel]').hidden, false);
  assert.equal(ui.dialog.querySelector('[data-frequency]').value, '103.500');
  assert.doesNotMatch(ui.dialog.innerHTML, /data-listen|data-volume|data-preset/);
  assert.equal(ui.plugin.audios.length, 0);
  await ui.dialog.querySelector('[data-start]').click(); await tick();
  const options = ui.plugin.starts[0];
  assert.equal(options.mode, 'wfm'); assert.equal(options.listenFrequencyHz, options.frequencyHz);
  assert.equal(ui.dialog.querySelector('[data-audio]').disabled, true);
  ui.state.receptionState = 'receiving'; ui.state.reception = options;
  ui.state.audio = { enabled: true, volume: 1 }; ui.emit();
  assert.equal(ui.dialog.querySelector('[data-audio]').disabled, false);
  assert.equal(ui.dialog.querySelector('[data-audio]').textContent, '음소거');
  assert.equal(ui.plugin.audios.length, 0);
  await ui.dialog.querySelector('[data-audio]').click(); await tick();
  assert.equal(ui.plugin.audios[0].enabled, false);
  assert.equal(ui.dialog.querySelector('[data-audio]').textContent, '소리 켜기');
  ui.emit();
  assert.equal(ui.state.audio.enabled, false);
  await ui.dialog.querySelector('[data-audio]').click(); await tick();
  assert.equal(ui.plugin.audios[1].enabled, true); assert.equal(ui.plugin.audios[1].volume, 1);
  assert.equal(ui.dialog.querySelector('[data-audio]').textContent, '음소거');
  ui.state.audio.enabled = false; ui.state.audio.notice = '출력 장치가 분리되어 음소거되었습니다.'; ui.emit();
  assert.match(ui.dialog.querySelector('[data-audio-status]').textContent, /분리되어 음소거/);
});

test('WFM validates its settings and tunes the same frequency at the narrow rate', async () => {
  const ui = setup(); ui.device.hasPermission = true;
  await ui.trigger.click(); await ui.button().click(); await tick();
  await ui.dialog.querySelector('[data-mode]').change('wfm');
  ui.dialog.querySelector('[data-deemphasis]').value = '0';
  await ui.dialog.querySelector('[data-start]').click(); await tick();
  assert.equal(ui.plugin.starts.length, 0);
  assert.match(ui.dialog.querySelector('.sdr-message').textContent, /WFM/);
  ui.dialog.querySelector('[data-deemphasis]').value = '75';
  ui.dialog.querySelector('[data-rate]').value = '250000';
  await ui.dialog.querySelector('[data-start]').click(); await tick();
  assert.equal(ui.plugin.starts.length, 1);
  assert.equal(ui.plugin.starts[0].frequencyHz, 103500000);
  assert.equal(ui.plugin.starts[0].listenFrequencyHz, 103500000);
});

test('switching back to VHF removes audio controls and restores IQ analysis', async () => {
  const ui = setup(); ui.device.hasPermission = true;
  await ui.trigger.click(); await ui.button().click(); await tick();
  await ui.dialog.querySelector('[data-mode]').change('wfm');
  await ui.dialog.querySelector('[data-band]').change('vhf');
  assert.equal(ui.dialog.querySelector('[data-mode]').value, 'iq');
  assert.equal(ui.dialog.querySelector('[data-audio-panel]').hidden, true);
  await ui.dialog.querySelector('[data-start]').click(); await tick();
  assert.equal(ui.plugin.starts[0].mode, 'iq');
});

test('digit tuning carries exactly and stops at selected-band boundaries', async () => {
  const ui = setup(); await ui.trigger.click();
  const frequency = ui.dialog.querySelector('[data-frequency]');
  frequency.value = '150.999'; frequency.events.input();
  await ui.dialog.querySelector('[data-freq-up="1000"]').click();
  assert.equal(frequency.value, '151.000');
  await ui.dialog.querySelector('[data-freq-down="1000"]').click();
  assert.equal(frequency.value, '150.999');
  frequency.value = '174.000'; frequency.events.input();
  assert.equal(ui.dialog.querySelector('[data-freq-up="1000"]').disabled, true);
  await ui.dialog.querySelector('[data-freq-up="1000"]').click();
  assert.equal(frequency.value, '174.000');
  await ui.dialog.querySelector('[data-band]').change('fm');
  assert.equal(ui.dialog.querySelector('[data-freq-digit="0"]').textContent, '1');
  assert.equal(ui.dialog.querySelector('[data-freq-digit="2"]').textContent, '3');
  frequency.value = '88.000'; frequency.events.input();
  assert.equal(ui.dialog.querySelector('[data-freq-digit="0"]').textContent, '0');
  assert.equal(ui.dialog.querySelector('[data-freq-down="1000"]').disabled, true);
});

test('direct frequency input validates range, returns to digits, and reaches the receiver', async () => {
  const ui = setup(); ui.device.hasPermission = true;
  await ui.trigger.click(); await ui.button().click(); await tick();
  const edit = ui.dialog.querySelector('[data-frequency-edit]');
  const entry = ui.dialog.querySelector('[data-frequency-entry]');
  const frequency = ui.dialog.querySelector('[data-frequency]');
  await edit.click(); assert.equal(entry.hidden, false);
  frequency.value = '175'; await edit.click();
  assert.equal(entry.hidden, false);
  assert.match(ui.dialog.querySelector('.sdr-message').textContent, /148.*174/);
  frequency.value = '151.125'; await edit.click();
  assert.equal(entry.hidden, true);
  assert.equal(ui.dialog.querySelector('[data-frequency-digits]').hidden, false);
  await ui.dialog.querySelector('[data-start]').click(); await tick();
  assert.equal(ui.plugin.starts[0].frequencyHz, 151125000);
  assert.equal(edit.disabled, true);
  await ui.dialog.querySelector('[data-freq-up="1000"]').click();
  assert.equal(frequency.value, '151.125');
  await ui.dialog.querySelector('[data-stop]').click(); await tick();
  assert.equal(edit.disabled, false);
  await ui.dialog.querySelector('[data-freq-up="1000"]').click();
  assert.equal(frequency.value, '151.126');
});
