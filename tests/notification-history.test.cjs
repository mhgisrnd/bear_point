const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

test('notification button is visible before device registration and explains availability', () => {
  const ids = ['btn-notification-history', 'notification-history', 'notification-status', 'notification-read', 'notification-close'];
  const elements = Object.fromEntries(ids.map(id => [id, { hidden: true, handlers: {}, attributes: {}, setAttribute(key,value) { this.attributes[key]=value; }, contains(target) { return target === this; }, focus() {}, addEventListener(name, fn) { this.handlers[name] = fn; }, dispatchEvent() {} }]));
  const document = { getElementById: id => elements[id], handlers: {}, addEventListener(name, fn) { this.handlers[name]=fn; } };
  const window = {};
  vm.runInNewContext(fs.readFileSync('public/js/realtime/notification-history.js', 'utf8'), { window, document, Event });
  window.BearNotificationHistory.mount('Android 앱에서 사용할 수 있습니다.');
  assert.equal(elements['btn-notification-history'].hidden, false);
  elements['btn-notification-history'].handlers.click();
  assert.equal(elements['notification-history'].hidden, false);
  assert.equal(elements['btn-notification-history'].attributes['aria-expanded'], 'true');
  assert.match(elements['notification-status'].textContent, /Android/);
  document.handlers.click({target:{}});
  assert.equal(elements['notification-history'].hidden, true);
  assert.equal(elements['btn-notification-history'].attributes['aria-expanded'], 'false');
});

test('opening an unread item marks only that item and navigates to its estimate', async () => {
  const ids = ['btn-notification-history','notification-history','notification-unread','notification-status','notification-items','notification-read','notification-more','notification-close','notification-filter'];
  function element() { return { hidden:false,children:[],dataset:{},handlers:{},setAttribute(){},focus(){},addEventListener(k,fn){this.handlers[k]=fn;},replaceChildren(){this.children=[];},append(...children){this.children.push(...children);} }; }
  const elements=Object.fromEntries(ids.map(id=>[id,element()]));
  elements['notification-history'].querySelector=()=>({scrollTop:0});
  elements['notification-filter'].querySelector=()=>({value:'received'});
  const document={hidden:false,getElementById:id=>elements[id],createElement:element,addEventListener(){}};
  const calls=[],events=[];let unread=true;
  const fetch=async(url,options)=>{
    if(url.endsWith('/stream'))return {ok:true,body:{getReader:()=>({read:()=>new Promise(()=>{})})}};
    if(url.endsWith('/read')){calls.push(JSON.parse(options.body));unread=false;return {ok:true};}
    return {ok:true,json:async()=>({direction:'received',unread:unread?1:0,read_through:unread?7:0,items:[{id:7,estimate_id:'123',title:'KF-112',body:'공유',direction:'received',read_at:unread?null:'2026-11-23',accepted_at:'2026-11-23'}]})};
  };
  const window={addEventListener(){},dispatchEvent:event=>events.push(event)};
  const CustomEvent=class{constructor(type,options){this.type=type;this.detail=options.detail;}};
  vm.runInNewContext(fs.readFileSync('public/js/realtime/notification-history.js','utf8'),{window,document,fetch,CustomEvent,AbortController,TextDecoder,URLSearchParams,setTimeout,clearTimeout,Date});
  window.BearNotificationHistory.start({apiBase:'https://example.test/api',plugin:{getCredentials:async()=>({credential:'secret'})}});
  await new Promise(resolve=>setImmediate(resolve));
  await elements['notification-items'].children[0].handlers.click();
  assert.equal(calls.length,1);assert.equal(calls[0].id,7);assert.equal(calls[0].through,undefined);
  assert.equal(events[0].type,'bearpoint:notification-navigate');assert.equal(events[0].detail.serverId,'123');
  assert.equal(elements['notification-history'].hidden,true);
});

test('history displays unread count and sends the displayed boundary when marking read', async () => {
  const ids = ['btn-notification-history', 'notification-history', 'notification-unread', 'notification-status', 'notification-items', 'notification-read', 'notification-more', 'notification-close', 'notification-filter'];
  function element() { return { hidden: false, children: [], dataset: {}, handlers: {}, setAttribute() {}, focus() {}, addEventListener(name, fn) { this.handlers[name] = fn; }, replaceChildren() { this.children = []; }, append(...items) { this.children.push(...items); } }; }
  const elements = Object.fromEntries(ids.map(id => [id, element()]));
  const scroll = { scrollTop: 40 };
  elements['notification-history'].querySelector = () => scroll;
  elements['notification-filter'].querySelector = () => ({ value: 'received' });
  const document = { hidden: false, getElementById: id => elements[id], createElement: element, addEventListener() {} };
  const requests = [];
  let unread = 2, legacy = false, noItems = false;
  const fetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/stream')) return { ok: true, body: { getReader: () => ({ read: () => new Promise(() => {}) }) } };
    if (url.endsWith('/read')) { unread = 0; return { ok: true }; }
    const items = [
      { id: 17, title: 'KF-112', body: '공유', direction: 'sent', accepted_at: '2026-11-23T00:00:00Z', read_at: null },
      { id: 16, title: 'KF-108', body: '공유', direction: 'received', accepted_at: '2026-11-23T00:00:00Z', read_at: unread ? null : '2026-11-23T00:01:00Z' }
    ];
    const direction = new URL(url).searchParams.get('direction');
    return { ok: true, json: async () => ({ ...(legacy ? {} : { direction }), unread, read_through: unread ? 16 : 0, items: noItems ? [] : items.filter(item => direction === 'all' || item.direction === direction) }) };
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
  assert.equal(rows[0].children[0].children[2].textContent, '미확인');
  assert.equal(rows[0].dataset.unread, 'true');
  elements['notification-filter'].handlers.change({ target: { value: 'sent' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(scroll.scrollTop, 0);
  assert.equal(elements['notification-items'].children[0].children[0].children[0].textContent, '발송');
  assert.equal(elements['notification-items'].children[0].children[0].children.length, 2);
  assert.equal(elements['notification-read'].disabled, true);
  assert.equal(elements['notification-unread'].textContent, '2');
  noItems = true;
  elements['notification-filter'].handlers.change({ target: { value: 'received' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['notification-read'].disabled, true);
  noItems = false;
  elements['notification-filter'].handlers.change({ target: { value: 'all' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(elements['notification-items'].children.length, 2);
  await elements['notification-read'].handlers.click();
  const request = requests.find(item => item.url.endsWith('/read'));
  assert.equal(request.options.body, '{"through":16}');
  assert.equal(elements['notification-unread'].hidden, true);
  legacy = true;
  elements['notification-filter'].handlers.change({ target: { value: 'sent' } });
  await new Promise(resolve => setImmediate(resolve));
  assert.match(elements['notification-status'].textContent, /서버 업데이트/);
  assert.equal(elements['notification-items'].children.length, 0);
});
