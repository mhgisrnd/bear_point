const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/js/sdr/diagnostics.js'), 'utf8');

// Small DOM stand-in to exercise asynchronous UI/bridge behavior, not USB hardware.
class Element {
  constructor() { this.children = []; this.events = {}; this.nodes = {}; this.disabled = false; }
  setAttribute() {}
  querySelector(key) { return this.nodes[key] ||= new Element(); }
  addEventListener(name, callback) { this.events[name] = callback; }
  append(...elements) { this.children.push(...elements); }
  appendChild(element) { this.append(element); }
  replaceChildren() { this.children = []; }
  showModal() { this.open = true; }
  close() { this.open = false; return this.events.close?.(); }
  async click() { if (!this.disabled) await this.events.click?.(); }
}
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(android = true, bridgeMode = 'injected') {
  const trigger = new Element(), body = new Element();
  const device = { deviceId: '/usb/1', name: 'RTL2832U', vendorId: 3034, productId: 10290, candidate: true, hasPermission: false, connected: false };
  const state = { hostSupported: true, state: 'idle', devices: [device] };
  let callback, permission, openCount = 0, permissionCount = 0;
  const plugin = {
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
  vm.runInNewContext(source, {
    document: { getElementById: () => trigger, createElement: () => new Element(), body },
    window: { Capacitor: capacitor }, console
  });
  const dialog = body.children[0];
  return {
    trigger, dialog, state, device, capacitor, plugin,
    button: () => dialog.querySelector('[data-devices]').children[0].children[2],
    counts: () => ({ openCount, permissionCount }),
    approve() { device.hasPermission = true; state.state = 'idle'; permission.resolve(device); permission = null; callback(state); },
    deny() { state.state = 'idle'; permission.reject(new Error('권한 거부')); permission = null; callback(state); },
  };
}

test('permission approval does not implicitly open USB; open needs a separate action', async () => {
  const ui = setup(); await ui.trigger.click(); void ui.button().click(); await tick();
  assert.equal(ui.button().disabled, true);
  await ui.button().click(); assert.equal(ui.counts().permissionCount, 1);
  ui.approve(); await tick();
  assert.equal(ui.counts().openCount, 0);
  assert.equal(ui.button().textContent, 'USB 연결 확인');
  await ui.button().click(); await tick();
  assert.equal(ui.counts().openCount, 1);
  assert.match(ui.dialog.querySelector('.sdr-status').textContent, /RF 수신 미검증/);
  await ui.dialog.close(); assert.equal(ui.state.state, 'idle');
});

test('registerPlugin API remains supported when supplied by a bundled runtime', async () => {
  const ui = setup(true, 'registered'); await ui.trigger.click();
  assert.equal(ui.dialog.open, true);
  assert.equal(ui.button().disabled, false);
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
  assert.equal(android.button().disabled, true);
  await android.button().click(); assert.equal(android.counts().permissionCount, 0);
});
