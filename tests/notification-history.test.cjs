const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('notification button is visible before device registration and explains availability', () => {
  const ids = ['btn-notification-history', 'notification-history', 'notification-status', 'notification-read', 'notification-close'];
  const elements = Object.fromEntries(ids.map(id => [id, { hidden: true, handlers: {}, setAttribute() {}, focus() {}, addEventListener(name, fn) { this.handlers[name] = fn; }, dispatchEvent() {} }]));
  const document = { getElementById: id => elements[id] };
  const window = {};
  vm.runInNewContext(fs.readFileSync('public/js/realtime/notification-history.js', 'utf8'), { window, document, Event });
  window.BearNotificationHistory.mount('Android 앱에서 사용할 수 있습니다.');
  assert.equal(elements['btn-notification-history'].hidden, false);
  elements['btn-notification-history'].handlers.click();
  assert.equal(elements['notification-history'].hidden, false);
  assert.match(elements['notification-status'].textContent, /Android/);
});

test('history displays unread count and sends the displayed boundary when marking read', async () => {
  const ids = ['btn-notification-history', 'notification-history', 'notification-unread', 'notification-status', 'notification-items', 'notification-read', 'notification-more', 'notification-close', 'notification-filter'];
  function element() { return { hidden: false, children: [], dataset: {}, handlers: {}, setAttribute() {}, focus() {}, addEventListener(name, fn) { this.handlers[name] = fn; }, replaceChildren() { this.children = []; }, append(...items) { this.children.push(...items); } }; }
  const elements = Object.fromEntries(ids.map(id => [id, element()]));
  elements['notification-filter'].value = 'received';
  const document = { hidden: false, getElementById: id => elements[id], createElement: element, addEventListener() {} };
  const requests = [];
  let unread = 2;
  const fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/stream')) return { ok: true, body: { getReader: () => ({ read: () => new Promise(() => {}) }) } };
    if (url.endsWith('/read')) { unread = 0; return { ok: true }; }
    const items = [
      { id: 17, title: 'KF-112', body: '공유', direction: 'sent', accepted_at: '2026-11-23T00:00:00Z', read_at: null },
      { id: 16, title: 'KF-108', body: '공유', direction: 'received', accepted_at: '2026-11-23T00:00:00Z', read_at: unread ? null : '2026-11-23T00:01:00Z' }
    ];
    const direction = new URL(url).searchParams.get('direction');
    return { ok: true, json: async () => ({ unread, read_through: unread ? 16 : 0, items: items.filter(item => direction === 'all' || item.direction === direction) }) };
  };
  const window = { addEventListener() {} };
  const context = { window, document, fetch, AbortController, TextDecoder, URLSearchParams, setTimeout, clearTimeout, Date };
  vm.runInNewContext(fs.readFileSync('public/js/realtime/notification-history.js', 'utf8'), context);
  window.BearNotificationHistory.start({ apiBase: 'https://example.test/api', plugin: { getCredentials: async () => ({ credential: 'secret' }) } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['notification-unread'].textContent, '2');
  const rows = elements['notification-items'].children;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].children[0].children[0].textContent, '수신');
  assert.equal(rows[0].dataset.unread, 'true');
  elements['notification-filter'].value = 'sent';
  elements['notification-filter'].handlers.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['notification-items'].children[0].children[0].children[0].textContent, '발송');
  assert.equal(elements['notification-read'].disabled, true);
  assert.equal(elements['notification-unread'].textContent, '2');
  elements['notification-filter'].value = 'all';
  elements['notification-filter'].handlers.change();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['notification-items'].children.length, 2);
  await elements['notification-read'].handlers.click();
  const request = requests.find(item => item.url.endsWith('/read'));
  assert.equal(request.options.body, '{"through":16}');
  assert.equal(elements['notification-unread'].hidden, true);
});
