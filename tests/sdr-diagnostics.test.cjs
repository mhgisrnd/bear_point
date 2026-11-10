const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../public/js/sdr/diagnostics.js'), 'utf8');
const spectrumSource = fs.readFileSync(require('node:path').join(__dirname, '../public/js/sdr/spectrum.js'), 'utf8');

// Small DOM stand-in to exercise asynchronous UI/bridge behavior, not USB hardware.
class Element {
  constructor() { this.children = []; this.events = {}; this.nodes = {}; this.dataset = {}; this.disabled = false; this.value = ''; this.style = { setProperty(name,value) { this[name]=value; } }; this.classList = { toggle() {} }; }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth || 320, height: 240 }; }
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

const animalCatalog = () => ({formatHz:hz=>String(hz/1e6),load:async()=>({notice:'',items:[
  {id:'1',code:'KF-110',frequencies:[{slot:'A',hz:148241500},{slot:'B',hz:149125000}]},
  {id:'2',code:'KF-112',frequencies:[]}
]})});

test('USB reception shows the signal section once on start without scrolling on every reading',async()=>{
  const ui=setup();ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  let scrolls=0;
  ui.dialog.querySelector('[data-result]').scrollIntoView=()=>{scrolls++;};
  ui.state.receptionState='receiving';
  ui.state.reception={mode:'cw',frequencyHz:148241000,hasSamples:true,signalDbfs:-65,powerDbfs:-35};
  ui.emit();
  assert.equal(scrolls,1);
  ui.emit();
  assert.equal(scrolls,1);
});

test('CW detector uses directional power independently of confidence and keeps the target frequency',async()=>{
  const ui=setup();ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  ui.state.receptionState='receiving';
  ui.state.reception={mode:'cw',hasSamples:true,powerDbfs:-30,signalDbfs:-40,signalLevel:10,signalExcessDb:25,
    noiseDbfs:-65,listenFrequencyHz:148241000,spectrumCenterHz:148241000,spectrumSpanHz:6000,
    spectrumDbfs:Array(128).fill(-80),cwDetectorRevision:'cw-pulse-v1',cwDetectorReady:true,
    cwPulseCount:3,cwPulseRecent:true,cwCandidateTracked:true,cwCandidateHz:148241609,
    cwDirectionDbfs:-80,cwDirectionLevel:4,cwSnrDb:6.2,cwConfidence:1};
  const active=[];for(let i=0;i<10;i++)ui.dialog.querySelector(`[data-strength-bar="${i}"]`).classList.toggle=(_,on)=>active[i]=on;
  ui.emit();assert.equal(active.filter(Boolean).length,4);
  assert.equal(ui.dialog.querySelector('[data-strength-value]').textContent,'-80.0 dBFS');
  assert.match(ui.dialog.querySelector('[data-spectrum-summary]').textContent,/CW 후보 148.24161/);
  ui.state.reception.cwConfidence=2;ui.emit();assert.equal(active.filter(Boolean).length,4);
  assert.match(ui.dialog.querySelector('[data-strength-state]').textContent,/반복 CW 후보/);
  ui.state.reception.cwPulseCount=0;ui.state.reception.cwCandidateTracked=false;ui.state.reception.cwDirectionLevel=0;
  ui.emit();assert.equal(active.filter(Boolean).length,0);
  assert.equal(ui.dialog.querySelector('[data-strength-value]').textContent,'—');
  assert.match(ui.dialog.querySelector('[data-strength-state]').textContent,/CW 후보 탐색/);
});

test('notification request reopens live fixed reception without reconnecting, retuning or restarting audio',async()=>{
  const ui=setup();ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  await ui.dialog.querySelector('[data-start]').click();await tick();
  ui.state.receptionState='receiving';ui.state.backgroundReceiving=true;
  ui.state.reception={mode:'cw',frequencyHz:148229000,listenFrequencyHz:148241000,sampleRate:1024000,gainDb:19.7,ppm:0};
  ui.state.audio={enabled:true,gainDb:36};ui.emit();await ui.dialog.close();
  ui.state.receiverUiRequestId=1;ui.emit();await tick();await tick();
  assert.equal(ui.dialog.open,true);assert.equal(ui.dialog.querySelector('[data-frequency]').value,'148.241');
  assert.equal(ui.plugin.starts.length,1);assert.equal(ui.counts().openCount,1);assert.equal(ui.plugin.audios.length,0);
  assert.deepEqual(ui.plugin.acknowledged,[1]);assert.equal(ui.state.audio.enabled,true);
  await ui.dialog.close();ui.state.receiverUiRequestId=1;ui.emit();await tick();
  assert.equal(ui.dialog.open,false,'a delayed duplicate event cannot reopen a closed dialog');
  ui.state.receiverUiRequestId=2;ui.emit();await tick();await tick();
  assert.equal(ui.dialog.open,true);assert.deepEqual(ui.plugin.acknowledged,[1,2]);
  await ui.dialog.close();ui.state.receiverUiRequestId=1;ui.emit();await tick();
  assert.equal(ui.dialog.open,false,'an older request must not reopen the dialog after a newer one');
});

test('a notification request present before the JS listener is ready opens on initial status',async()=>{
  const ui=setup(true,'injected',true);
  ui.state.state='connected';ui.device.connected=true;ui.device.hasPermission=true;
  ui.state.receptionState='receiving';ui.state.backgroundReceiving=true;ui.state.fixedResultAvailable=true;
  ui.state.reception={mode:'cw',frequencyHz:148229000,listenFrequencyHz:148241000,sampleRate:1024000};
  ui.state.receiverUiRequestId=3;await tick();await tick();
  assert.equal(ui.dialog.open,true);assert.deepEqual(ui.plugin.acknowledged,[3]);
  assert.equal(ui.plugin.starts.length,0);assert.equal(ui.counts().openCount,0);
});

test('normal status does not open the receiver; scan notification selects the live scan without restarting it',async()=>{
  const ui=setup();await tick();assert.notEqual(ui.dialog.open,true);
  ui.state.state='connected';ui.device.connected=true;ui.device.hasPermission=true;
  ui.state.receptionState='scanning';ui.state.backgroundScanning=true;ui.state.scanResumeAvailable=true;
  ui.state.receiverUiRequestId=4;ui.emit();await tick();await tick();
  assert.equal(ui.dialog.open,true);assert.equal(ui.dialog.querySelector('[data-scan-results]').hidden,false);
  assert.equal(ui.plugin.scans.length,0);assert.equal(ui.state.receptionState,'scanning');
});

test('saved diagnostics remain available without a receiver and sharing uses the selected archive',async()=>{
  const ui=setup();await ui.trigger.click();await tick();
  ui.state.diagnostic={state:'idle',records:[
    {id:'sdr-diagnostic-new',time:1730790000000,sizeBytes:20000000},
    {id:'sdr-diagnostic-old',time:1730780000000,sizeBytes:19000000}
  ]};ui.emit();
  const section=ui.dialog.querySelector('[data-diagnostic-section]'),select=ui.dialog.querySelector('[data-diagnostic-record]');
  assert.equal(section.hidden,false);assert.equal(select.children.length,2);
  assert.equal(ui.dialog.querySelector('[data-result]').hidden,true);
  assert.equal(ui.dialog.querySelector('[data-diagnostic-start]').disabled,true);
  assert.equal(ui.dialog.querySelector('[data-diagnostic-share]').disabled,false);
  await select.change('sdr-diagnostic-old');ui.emit();
  assert.equal(select.value,'sdr-diagnostic-old','status refresh must preserve the archive selection');
  await ui.dialog.querySelector('[data-diagnostic-share]').click();await tick();
  assert.equal(ui.plugin.sharedId,'sdr-diagnostic-old');
});
test('USB diagnostics stay visible before connection, during permission wait and after disconnect',async()=>{
  const ui=setup();await ui.trigger.click();await tick();
  const section=ui.dialog.querySelector('[data-diagnostic-section]');
  assert.equal(section.hidden,false);
  assert.equal(ui.dialog.querySelector('[data-diagnostic-start]').disabled,true);
  assert.equal(ui.dialog.querySelector('[data-diagnostic-share]').disabled,true);
  assert.equal(ui.dialog.querySelector('[data-usb-pairing]').hidden,false);
  ui.state.state='permissionPending';ui.emit();
  assert.equal(section.hidden,false);
  ui.state.state='connected';ui.device.connected=true;ui.emit();
  assert.equal(ui.dialog.querySelector('[data-usb-pairing]').hidden,true);
  assert.equal(ui.dialog.querySelector('.sdr-status').hidden,true);
  ui.state.state='idle';ui.device.connected=false;ui.emit();
  assert.equal(section.hidden,false);
  assert.equal(ui.dialog.querySelector('[data-usb-pairing]').hidden,false);
  assert.equal(ui.dialog.querySelector('.sdr-status').hidden,false);
});

test('selected diagnostic deletion confirms, cancels and refreshes without requiring a USB receiver',async()=>{
  const ui=setup();await ui.trigger.click();await tick();
  ui.state.diagnostic={state:'ready',records:[{id:'new',time:1730790000000,sizeBytes:20e6},{id:'old',time:1730780000000,sizeBytes:19e6}]};
  const deleted=[];ui.plugin.deleteDiagnostic=async({id})=>{deleted.push(id);ui.state.diagnostic.records=ui.state.diagnostic.records.filter(r=>r.id!==id);if(!ui.state.diagnostic.records.length)ui.state.diagnostic.state='idle';};
  ui.emit();const select=ui.dialog.querySelector('[data-diagnostic-record]'),button=ui.dialog.querySelector('[data-diagnostic-delete]');
  select.value='old';let prompt='';ui.window.confirm=text=>{prompt=text;return false;};
  await button.click();assert.equal(deleted.length,0);assert.match(prompt,/삭제.*복구/s);
  ui.window.confirm=()=>true;await button.click();await tick();assert.deepEqual(deleted,['old']);
  assert.equal(select.children.length,1);assert.equal(select.value,'new');
  await button.click();await tick();assert.deepEqual(deleted,['old','new']);assert.equal(button.disabled,true);
  assert.equal(ui.dialog.querySelector('[data-diagnostic-share]').disabled,true);
  assert.equal(ui.counts().openCount,0);assert.equal(ui.plugin.starts.length,0);
});

test('diagnostic deletion is disabled while recording and failure preserves the selected record',async()=>{
  const ui=setup();await ui.trigger.click();await tick();
  ui.state.diagnostic={state:'recording',records:[{id:'keep',time:1730790000000,sizeBytes:20e6}]};
  ui.plugin.deleteDiagnostic=async()=>{throw Error('삭제 실패');};ui.window.confirm=()=>true;ui.emit();
  const button=ui.dialog.querySelector('[data-diagnostic-delete]');assert.equal(button.disabled,true);
  ui.state.diagnostic.state='idle';ui.emit();await button.click();await tick();
  assert.equal(ui.state.diagnostic.records.length,1);assert.equal(ui.dialog.querySelector('[data-diagnostic-record]').value,'keep');
  assert.equal(button.disabled,false);
});

test('a recorder overflow is shown as partial while sharing and live reception remain available',async()=>{
  const ui=setup();ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  ui.state.receptionState='receiving';ui.state.reception={mode:'cw',frequencyHz:148229000,listenFrequencyHz:148241000};
  ui.state.diagnostic={state:'ready',writerDroppedBlocks:1};ui.emit();
  assert.match(ui.dialog.querySelector('[data-diagnostic-status]').textContent,/일부만 기록/);
  assert.equal(ui.dialog.querySelector('[data-diagnostic-share]').disabled,false);
  assert.equal(ui.state.receptionState,'receiving');assert.equal(ui.plugin.starts.length,0);
});

test('CW gauge displays native weak levels and labels a held peak without depending on listening volume',async()=>{
  const ui=setup();ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  ui.state.receptionState='receiving';
  ui.state.reception={mode:'cw',hasSamples:true,powerDbfs:-33,signalDbfs:-58,noiseDbfs:-62,signalExcessDb:3.7,signalLevel:2};
  const active=[];for(let i=0;i<10;i++)ui.dialog.querySelector(`[data-strength-bar="${i}"]`).classList.toggle=(_,on)=>active[i]=on;
  ui.emit();assert.equal(active.filter(Boolean).length,2);
  ui.state.audio={enabled:true,gainDb:36};ui.emit();assert.equal(active.filter(Boolean).length,2);
  ui.state.reception.signalExcessDb=2;ui.state.reception.signalLevelHeld=true;ui.emit();
  assert.match(ui.dialog.querySelector('[data-strength-state]').textContent,/최근 피크 유지/);
  ui.state.reception.signalLevel=0;ui.state.reception.signalLevelHeld=false;ui.emit();assert.equal(active.filter(Boolean).length,0);
});

test('live listening gain does not retune or alter measured RF strength; local capture locks gain and shares only on request',async()=>{
  const ui=setup();ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  await ui.dialog.querySelector('[data-start]').click();await tick();
  ui.state.receptionState='receiving';ui.state.backgroundReceiving=true;
  ui.state.reception={mode:'cw',listenFrequencyHz:150000000,hasSamples:true,powerDbfs:-65,signalDbfs:-65,noiseDbfs:-75,signalExcessDb:10};
  ui.state.audio={enabled:true,gainDb:-1};ui.emit();
  const gain=ui.dialog.querySelector('[data-audio-gain]');assert.equal(gain.value,'-1');
  await gain.change('24');await tick();
  assert.equal(ui.state.audio.gainDb,24);assert.equal(ui.plugin.starts.length,1);
  assert.equal(ui.state.reception.signalDbfs,-65);
  const record=ui.dialog.querySelector('[data-diagnostic-start]'),share=ui.dialog.querySelector('[data-diagnostic-share]');
  assert.equal(record.disabled,false);assert.equal(share.disabled,true);
  await record.click();await tick();assert.equal(gain.disabled,true);assert.equal(record.disabled,true);
  assert.equal(ui.plugin.shared,undefined);
  ui.state.diagnostic={state:'ready',iqBytes:20480000};ui.emit();
  assert.equal(gain.disabled,false);assert.equal(share.disabled,false);
  await share.click();await tick();assert.equal(ui.plugin.shared,1);
  await ui.plugin.stopReception();assert.equal(record.disabled,true);
});

test('default gain requests tuner maximum and reports the actual FC0013 step; manual gain remains available',async()=>{
  const ui=setup();ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  assert.equal(ui.dialog.querySelector('[data-gain]').value,'50');
  await ui.dialog.querySelector('[data-start]').click();await tick();
  assert.equal(ui.plugin.starts[0].gainTenthsDb,500);
  ui.state.receptionState='receiving';ui.state.backgroundReceiving=true;
  ui.state.reception={mode:'cw',tuner:'FC0013',frequencyHz:149988000,listenFrequencyHz:150000000,sampleRate:1024000,gainDb:19.7,gainMinDb:-9.9,gainMaxDb:19.7,ppm:0};
  ui.emit();
  assert.match(ui.dialog.querySelector('[data-gain-info]').textContent,/FC0013.*19\.7.*19\.7/);
  assert.equal(ui.dialog.querySelector('[data-gain]').value,'19.7');
  await ui.plugin.stopReception();ui.dialog.querySelector('[data-gain]').value='7.1';
  await ui.dialog.querySelector('[data-start]').click();await tick();
  assert.equal(ui.plugin.starts.at(-1).gainTenthsDb,71);
});

test('fixed CW spectrum uses the selected target metadata rather than the USB center, including after stop',async()=>{
  const ui=setup();ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  const bins=Array(128).fill(-100);bins[64]=-78;
  ui.state.receptionState='receiving';ui.state.fixedResultAvailable=true;
  ui.state.reception={mode:'cw',frequencyHz:148229500,listenFrequencyHz:148241500,sampleRate:1024000,
    spectrumCenterHz:148241500,spectrumSpanHz:6000,spectrumDbfs:bins,spectrumPeakHold:true};
  ui.emit();
  const caption=ui.dialog.querySelector('[data-spectrum-summary]');
  assert.match(caption.textContent,/148\.24150 MHz/);assert.doesNotMatch(caption.textContent,/148\.229/);
  assert.match(ui.dialog.querySelector('[data-spectrum-info]').textContent,/148\.23850–148\.24450 MHz.*47 Hz/);
  await ui.plugin.stopReception();assert.match(caption.textContent,/148\.24150 MHz/);
});

test('animal catalog includes all records in the scrollable list and searches without a six-row cap',async()=>{
  const items=Array.from({length:14},(_,i)=>({id:String(i+1),code:'KF-'+(100+i),frequencies:[{slot:'A',hz:148000000+i*10000}]}));
  const catalog={formatHz:hz=>String(hz/1e6),load:async()=>({notice:'',items})};
  const ui=setup(true,'injected',false,catalog);ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  const list=ui.dialog.querySelector('[data-animal-list]');
  assert.equal(list.children.length,14);
  assert.equal(ui.dialog.querySelector('[data-animal-count]').textContent,'전체 14개체');
  list.scrollLeft=200;const first=list.children[0];ui.emit();
  assert.equal(list.scrollLeft,200);assert.equal(list.children[0],first);
  const search=ui.dialog.querySelector('[data-animal-search]');search.value='KF-113';search.events.input();
  assert.equal(list.children.length,1);
  assert.equal(ui.dialog.querySelector('[data-animal-count]').textContent,'검색 결과 1개체');
  assert.equal(list.scrollLeft,0);
  search.value='148.000';search.events.input();
  assert.equal(list.children.length,1);
  assert.equal(list.children[0].children.length,0,'frequency alone must not match an animal');
  search.value='kf-113';search.events.input();assert.equal(list.children[0].children[0].textContent,'KF-113');
  search.value='113';search.events.input();assert.equal(list.children[0].children[0].textContent,'KF-113');
  search.value='';search.events.input();assert.equal(list.children.length,14);
  await list.children[9].children[2].children[0].click();
  assert.equal(ui.dialog.querySelector('[data-frequency]').value,'148.09');
  assert.equal(ui.plugin.starts.length,0);
});

test('individual animal selection searches and tunes exact registered A/B frequencies without changing scan defaults',async()=>{
  const ui=setup(true,'injected',false,animalCatalog());ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  const list=ui.dialog.querySelector('[data-animal-list]');
  assert.equal(list.children[1].disabled,true);
  await list.children[0].children[2].children[0].click();
  assert.equal(ui.dialog.querySelector('[data-frequency]').value,'148.2415');
  assert.equal(ui.dialog.querySelector('[data-frequency-field]').hidden,false);
  assert.equal(ui.dialog.querySelector('[data-animal-results]').hidden,false);
  await ui.dialog.querySelector('[data-freq-up="10"]').click();
  assert.equal(ui.dialog.querySelector('[data-frequency]').value,'148.24151');
  assert.equal(ui.dialog.querySelector('[data-register-observation]').hidden,false);
  assert.equal(ui.dialog.querySelector('[data-register-observation]').disabled,true);
  assert.equal(ui.dialog.querySelector('[data-animal-clear]').disabled,false);
  await list.children[0].children[2].children[0].click();
  assert.equal(ui.dialog.querySelector('[data-frequency]').value,'148.2415');
  await ui.dialog.querySelector('[data-animal-list]').children[0].children[2].children[1].click();
  await ui.dialog.querySelector('[data-start]').click();
  assert.equal(ui.plugin.starts[0].frequencyHz,149125000);assert.equal(ui.plugin.starts[0].mode,'cw');
  assert.equal(ui.dialog.querySelector('[data-scan-start]').value,'148.000');
});

test('animal registration waits for samples, stops reception and hands off the same subject; cancel restores SDR',async()=>{
  const ui=setup(true,'injected',false,animalCatalog());ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  await ui.dialog.querySelector('[data-animal-list]').children[0].children[2].children[0].click();
  const button=ui.dialog.querySelector('[data-register-observation]');assert.equal(button.hidden,false);assert.equal(button.disabled,true);
  await ui.dialog.querySelector('[data-start]').click();
  ui.state.backgroundReceiving=true;ui.state.receptionState='receiving';
  ui.state.reception={mode:'cw',frequencyHz:148229500,listenFrequencyHz:148241500,sampleRate:1024000,
    hasSamples:true,powerDbfs:-56,totalBytes:65536,bytesPerSecond:2048000,signalDbfs:-56,noiseDbfs:-75,signalExcessDb:19};
  ui.emit();assert.equal(button.hidden,false);
  assert.equal(ui.dialog.querySelector('[data-frequency]').value,'148.2415');
  let context,cancel;ui.window.BearSdrRegistration={open:(data,back)=>{assert.equal(ui.dialog.open,false);assert.equal(ui.state.receptionState,'idle');context=data;cancel=back;return true;}};
  await button.click();await tick();assert.equal(context.bearCode,'KF-110');assert.equal(context.frequencyHz,148241500);
  assert.equal(ui.dialog.open,false);cancel();await tick();assert.equal(ui.dialog.open,true);
  assert.equal(ui.dialog.querySelector('[data-frequency]').value,'148.2415');
  assert.equal(ui.plugin.starts.length,1,'cancel must not restart audio without user action');
});

test('manual frequency changes cannot register an unrelated selected animal',async()=>{
  const ui=setup(true,'injected',false,animalCatalog());ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  await ui.dialog.querySelector('[data-animal-list]').children[0].children[2].children[0].click();
  await ui.dialog.querySelector('[data-animal-clear]').click();
  assert.equal(ui.dialog.querySelector('[data-frequency]').value,'148.2415');
  assert.equal(ui.dialog.querySelector('[data-frequency-field]').hidden,false);
  assert.equal(ui.dialog.querySelector('[data-register-observation]').hidden,false);
  assert.equal(ui.dialog.querySelector('[data-register-observation]').disabled,true);
  const search=ui.dialog.querySelector('[data-animal-search]');search.value='missing';search.events.input();
  assert.equal(ui.dialog.querySelector('[data-animal-list]').children[0].textContent,'검색 결과가 없습니다.');
});

test('USB preserves explicit selection within 900 Hz including both boundaries and registers the actual sampled frequency',async()=>{
  const catalog={formatHz:hz=>String(hz/1e6),load:async()=>({notice:'',items:[
    {id:'1',code:'KF-110',frequencies:[{slot:'A',hz:148241000}]},
    {id:'2',code:'KF-111',frequencies:[{slot:'A',hz:148241100}]}
  ]})};
  for(const offset of [-901,-900,-100,0,100,900,901]) {
    const ui=setup(true,'injected',false,catalog);ui.device.hasPermission=true;
    await ui.trigger.click();await ui.button().click();await tick();
    await ui.dialog.querySelector('[data-animal-list]').children[0].children[2].children[0].click();
    const hz=148241000+offset,frequency=ui.dialog.querySelector('[data-frequency]');
    frequency.value=String(hz/1e6);frequency.events.input();
    assert.equal(ui.dialog.querySelector('[data-animal-clear]').disabled,Math.abs(offset)>900,`offset ${offset}`);
    const button=ui.dialog.querySelector('[data-register-observation]');
    assert.equal(button.hidden,false);
    assert.equal(button.disabled,true,'no samples yet');
    await ui.dialog.querySelector('[data-start]').click();
    ui.state.receptionState='receiving';
    ui.state.reception={mode:'cw',frequencyHz:hz-12000,listenFrequencyHz:hz,hasSamples:true,powerDbfs:-56};
    ui.emit();
    assert.equal(button.disabled,Math.abs(offset)>900,`offset ${offset}`);
    if(Math.abs(offset)<=900) {
      let context;
      ui.window.BearSdrRegistration={open:value=>{context=value;return true;}};
      await button.click();
      assert.equal(context.bearCode,'KF-110','overlapping ranges must not switch subjects');
      assert.equal(context.frequencyHz,hz);
    }
  }
});

test('USB tolerance does not allow registration against old samples from a different tuned frequency',async()=>{
  const ui=setup(true,'injected',false,animalCatalog());ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  await ui.dialog.querySelector('[data-animal-list]').children[0].children[2].children[0].click();
  await ui.dialog.querySelector('[data-start]').click();
  ui.state.receptionState='idle';
  ui.state.reception={mode:'cw',listenFrequencyHz:148241500,hasSamples:true,powerDbfs:-56};ui.emit();
  assert.equal(ui.dialog.querySelector('[data-register-observation]').disabled,false);
  await ui.dialog.querySelector('[data-freq-up="100"]').click();
  assert.equal(ui.dialog.querySelector('[data-animal-clear]').disabled,false);
  assert.equal(ui.dialog.querySelector('[data-register-observation]').disabled,true);
});

function setup(android = true, bridgeMode = 'injected', listenerAsync = false, catalog = null, storage = null, receiverMount = null) {
  const trigger = new Element(), body = new Element();
  const device = { deviceId: '/usb/1', name: 'RTL2832U', vendorId: 3034, productId: 10290, candidate: true, hasPermission: false, connected: false };
  const state = { hostSupported: true, state: 'idle', devices: [device] };
  let callback, permission, openCount = 0, permissionCount = 0;
  const plugin = {
    starts: [], scans: [], audios: [],
    acknowledged: [],
    async acknowledgeReceiverUi({requestId}) {
      this.acknowledged.push(requestId);
      if(state.receiverUiRequestId===requestId)state.receiverUiRequestId=0;
    },
    async setAudio(options) {
      this.audios.push(options); state.audio ||= { enabled: false, volume: .25 };
      if (options.enabled != null) state.audio.enabled = options.enabled;
      if (options.volume != null) state.audio.volume = options.volume;
      if (options.gainDb != null) state.audio.gainDb = options.gainDb;
      callback(structuredClone(state));
    },
    async startDiagnostic() { state.diagnostic={state:'recording',iqBytes:1024000}; callback(structuredClone(state)); },
    async shareDiagnostic(options={}) { this.shared=(this.shared||0)+1;this.sharedId=options.id; },
    async startReception(options) { this.starts.push(options); state.receptionState = 'starting'; state.fixedResultAvailable = true; callback(structuredClone(state)); },
    async startScan(options) {
      if (options.resume && !state.scanResumeAvailable) throw new Error('이어갈 탐색 없음');
      this.scans.push(options); state.receptionState = 'starting';
      state.fixedResultAvailable = false;
      if (!options.resume) state.scan = {};
      state.scanResumeAvailable = true; state.audio = {enabled:false}; callback(structuredClone(state));
    },
    async stopReception() { state.receptionState = 'idle'; callback(structuredClone(state)); },
    async clearScanHistory() {
      if (state.receptionState !== 'idle') throw new Error('Stop reception first');
      state.scan = {}; state.scanResumeAvailable = false; callback(structuredClone(state));
    },
    async clearReceptionResult() {
      if (state.receptionState !== 'idle' && state.receptionState !== 'error') throw new Error('Stop reception first');
      state.reception = {}; state.receptionError = ''; state.fixedResultAvailable = false;
      callback(structuredClone(state));
    },
    getStatus: async () => structuredClone(state),
    addListener: (_, fn) => { callback = fn; const handle = { remove() {} }; return listenerAsync ? Promise.resolve(handle) : handle; },
    requestDevicePermission() {
      permissionCount++;
      state.state = 'permissionPending'; callback(structuredClone(state));
      return new Promise((resolve, reject) => { permission = { resolve, reject }; });
    },
    async openDevice() { openCount++; device.connected = true; state.state = 'connected'; callback(structuredClone(state)); },
    async closeDevice() {
      permission?.reject(new Error('요청 취소')); permission = null;
      device.connected = false; state.state = 'idle'; state.receptionState = 'idle'; state.scan = {}; state.scanResumeAvailable = false; state.fixedResultAvailable = false; callback?.(structuredClone(state));
    }
  };
  const capacitor = android ? { getPlatform: () => 'android' } : undefined;
  if (android && bridgeMode === 'injected') capacitor.Plugins = { RtlSdr: plugin };
  if (android && bridgeMode === 'registered') capacitor.registerPlugin = () => plugin;
  if (android && bridgeMode === 'throws') capacitor.registerPlugin = () => { throw new Error('bridge init failure'); };
  const appWindow = { Capacitor: capacitor };
  if (receiverMount) appWindow.BearIcR30 = { mount: receiverMount };
  if (storage) appWindow.localStorage = storage;
  if (catalog) appWindow.BearSdrAnimals = catalog;
  vm.runInNewContext(fs.readFileSync('public/js/sdr/frequency-controls.js', 'utf8') + '\n' + spectrumSource + '\n' + source, {
    document: { getElementById: () => trigger, createElement: () => new Element(), body },
    window: appWindow, console
  });
  const dialog = body.children[0];
  for (const [key, value] of Object.entries({frequency: '150.000', rate: '1024000', gain: '50', ppm: '0'})) {
    dialog.querySelector(`[data-${key}]`).value = value;
  }
  return {
    trigger, dialog, state, device, capacitor, plugin, window: appWindow,
    emit: () => callback(structuredClone(state)),
    button: () => dialog.querySelector('[data-devices]').children[0].children[2],
    counts: () => ({ openCount, permissionCount }),
    approve() { device.hasPermission = true; state.state = 'idle'; permission.resolve(device); permission = null; callback(structuredClone(state)); },
    deny() { state.state = 'idle'; permission.reject(new Error('권한 거부')); permission = null; callback(structuredClone(state)); },
  };
}

test('USB and Bluetooth use one favorite set and one filter state in both directions',async()=>{
  let shared,refreshes=0;
  const saved=new Map(),storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)};
  const ui=setup(true,'injected',false,animalCatalog(),storage,(_dialog,options)=>{
    shared=options.favorites;
    return {updateUsb(){},onOpen(){},selected:()=>false,refreshFavorites(){refreshes++;}};
  });
  ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  const filter=ui.dialog.querySelector('[data-animal-favorites-filter]');
  assert.equal(shared.only(),false);
  await ui.dialog.querySelector('[data-animal-list]').children[0].children[3].click();
  assert.equal(shared.has('KF-110'),true);
  await filter.click();
  assert.equal(shared.only(),true);
  assert.equal(filter.textContent,'★ 즐겨찾기');
  const before=refreshes;
  shared.toggleFilter();
  assert.equal(shared.only(),false);
  assert.equal(filter.textContent,'☆ 즐겨찾기');
  assert.ok(refreshes>before);
  shared.toggle('KF-110');
  assert.equal(ui.dialog.querySelector('[data-animal-list]').children[0].children[3].textContent,'☆');
});

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
  await ui.dialog.close(); assert.equal(ui.state.state, 'connected');
  await ui.trigger.click(); assert.equal(ui.counts().openCount, 1);
});

test('registerPlugin API remains supported when supplied by a bundled runtime', async () => {
  const ui = setup(true, 'registered'); await ui.trigger.click();
  assert.equal(ui.dialog.open, true);
  assert.equal(ui.button().disabled, false);
});

test('receiver settings and results appear after USB connection and hide again on disconnect', async () => {
  const ui = setup(); ui.device.hasPermission = true;
  await ui.trigger.click();
  const settings = ui.dialog.querySelector('[data-settings-section]');
  const result = ui.dialog.querySelector('[data-result]');
  const footer = ui.dialog.querySelector('.sdr-footer');
  for (const section of [settings, result, footer]) assert.equal(section.hidden, true);
  await ui.button().click(); await tick();
  for (const section of [settings, footer]) assert.equal(section.hidden, false);
  assert.equal(result.hidden, true);
  await ui.dialog.querySelector('[data-task-scan]').click();
  await ui.dialog.querySelector('[data-disconnect]').click(); await tick();
  for (const section of [settings, result, footer]) assert.equal(section.hidden, true);
  await ui.button().click(); await tick();
  assert.equal(settings.hidden, false);
  assert.equal(ui.dialog.querySelector('[data-frequency-field]').hidden, false);
});

test('asynchronous listener registration remains supported', async () => {
  const ui = setup(true, 'injected', true);
  await ui.trigger.click();
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
  ui.dialog.querySelector('[data-frequency]').value = '2001';
  await start.click(); await tick();
  assert.equal(ui.plugin.starts.length, 0);
  assert.match(ui.dialog.querySelector('.sdr-message').textContent, /설정 범위/);
  ui.dialog.querySelector('[data-frequency]').value = '151.125';
  ui.dialog.querySelector('[data-gain]').value = '19.7';
  await start.click(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.plugin.starts[0])), { band: 'wide', mode: 'cw', frequencyHz: 151125000, listenFrequencyHz: 151125000, sampleRate: 1024000, gainTenthsDb: 197, ppm: 0, deemphasisUs: 75 });
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
  assert.equal(ui.dialog.querySelector('[data-throughput]').textContent, '2.05 MB/s');
  ui.state.receptionState = 'error'; ui.state.receptionError = 'USB IQ read failed (-4)'; ui.emit();
  assert.match(ui.dialog.querySelector('.sdr-message').textContent, /USB IQ read/);
  assert.equal(ui.dialog.querySelector('[data-start]').disabled, false);
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


test('CW displays native default playback, can mute and unmute, and uses device media volume', async () => {
  const ui = setup(); ui.device.hasPermission = true;
  await ui.trigger.click(); await ui.button().click(); await tick();
  assert.equal(ui.dialog.querySelector('[data-audio-panel]').hidden, false);
  assert.equal(ui.dialog.querySelector('[data-frequency]').value, '150.000');
  assert.doesNotMatch(ui.dialog.innerHTML, /data-listen|data-volume|data-preset/);
  assert.equal(ui.plugin.audios.length, 0);
  await ui.dialog.querySelector('[data-start]').click(); await tick();
  const options = ui.plugin.starts[0];
  assert.equal(options.mode, 'cw'); assert.equal(options.listenFrequencyHz, options.frequencyHz);
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



test('a paused CW scan resumes with the same detector', async () => {
  const ui=await scanningUi();
  await ui.dialog.querySelector('[data-stop]').click(); await tick();
  await ui.dialog.querySelector('[data-start]').click(); await tick();
  assert.equal(ui.plugin.scans[1].mode,'cw');
  assert.equal(ui.plugin.scans[1].resume,true);
});

test('spectrum remains display-only during reception and after stop or error', async () => {
  const ui=setup();ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();
  const frequency=ui.dialog.querySelector('[data-frequency]'),canvas=ui.dialog.querySelector('[data-spectrum]');
  frequency.value='148.24100';ui.state.fixedResultAvailable=true;
  for(const state of ['receiving','idle','error']){
    ui.state.receptionState=state;
    ui.state.reception={mode:'cw',frequencyHz:148229000,listenFrequencyHz:148241000,sampleRate:1024000,spectrumDbfs:Array(1024).fill(-80)};
    ui.emit();
    canvas.events.pointerdown?.({pointerId:1,clientX:100,clientY:100});
    canvas.events.pointermove?.({pointerId:1,clientX:240,clientY:100});
    canvas.events.pointerup?.({pointerId:1});
    assert.equal(frequency.value,'148.24100');assert.equal(ui.plugin.starts.length,0);
    assert.ok(ui.dialog.querySelector('[data-spectrum-summary]').textContent);
  }
  assert.doesNotMatch(ui.dialog.innerHTML,/data-spectrum-reset|data-spectrum-tune/);
  await ui.dialog.querySelector('[data-start]').click();
  assert.equal(ui.plugin.starts[0].frequencyHz,148241000);
});

test('fixed reception stop becomes result reset without losing USB or tuning', async () => {
  const ui = setup(); ui.device.hasPermission = true;
  await ui.trigger.click(); await ui.button().click();
  await ui.dialog.querySelector('[data-start]').click();
  ui.state.receptionState = 'receiving';
  ui.state.reception = { frequencyHz: 150000000, sampleRate: 1024000,
    totalBytes: 2048000, bytesPerSecond: 2048000, powerDbfs: -45,
    clippingPercent: 0, elapsedSeconds: 1, hasSamples: true };
  ui.emit();
  const stop = ui.dialog.querySelector('[data-stop]');
  assert.equal(stop.textContent, '정지');
  await stop.click();
  await ui.dialog.querySelector('[data-close]').click();
  await ui.trigger.click();
  assert.equal(stop.textContent, '초기화');
  assert.equal(stop.disabled, false);
  await stop.click();
  assert.equal(ui.dialog.querySelector('[data-throughput]').textContent, '—');
  assert.equal(ui.dialog.querySelector('[data-frequency]').value, '150.000');
  assert.equal(ui.state.state, 'connected');
  assert.equal(ui.counts().openCount, 1);
  assert.equal(stop.disabled, true);
});


test('direct frequency editing keeps arrows visible, validates range, and reaches the receiver', async () => {
  const ui = setup(); ui.device.hasPermission = true;
  await ui.trigger.click(); await ui.button().click(); await tick();
  const edit = ui.dialog.querySelector('[data-frequency-edit]');
  const entry = ui.dialog.querySelector('[data-frequency-entry]');
  const frequency = ui.dialog.querySelector('[data-frequency]');
  await edit.click(); assert.equal(entry.hidden, true);
  assert.equal(ui.dialog.querySelector('[data-frequency-digits]').hidden, false);
  frequency.value = '2001'; await edit.click();
  assert.equal(entry.hidden, true);
  assert.match(ui.dialog.querySelector('.sdr-message').textContent, /0.1.*999.999/);
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

async function scanningUi() {
  const ui = setup(); ui.device.hasPermission = true;
  await ui.trigger.click(); await ui.button().click(); await tick();
  await ui.dialog.querySelector('[data-task-scan]').click();
  ui.dialog.querySelector('[data-dwell]').value='5000';
  ui.dialog.querySelector('[data-scan-start]').value = '103.000';
  ui.dialog.querySelector('[data-scan-end]').value = '104.000';
  await ui.dialog.querySelector('[data-start]').click(); await tick();
  ui.state.receptionState = 'scanning';
  ui.state.scan = { band: 'wide', mode: 'cw', centerHz: 103300000, segment: 2, segments: 4, cycle: 1, cycleSeconds: 4.8,
    elapsedSeconds: 2, candidates: [{id:1,frequencyHz:103505000,powerDbfs:-53,snrDb:21,lastSeenSeconds:1.9}] };
  ui.emit(); return ui;
}

test('strength bars use fixed channel-power thresholds independent of volume and mark stopped readings', async () => {
  const ui=setup();ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  const active=[];
  for(let i=0;i<10;i++) ui.dialog.querySelector(`[data-strength-bar="${i}"]`).classList.toggle=(name,on)=>{active[i]=on;};
  ui.state.receptionState='receiving';ui.state.reception={mode:'cw',hasSamples:true,powerDbfs:-40,signalDbfs:-50,noiseDbfs:-71,signalExcessDb:21};ui.emit();
  assert.equal(active.filter(Boolean).length,5);
  assert.equal(ui.dialog.querySelector('[data-strength-value]').textContent,'-50.0 dBFS');
  ui.state.audio={enabled:false};ui.emit();assert.equal(active.filter(Boolean).length,5);
  ui.state.reception.signalDbfs=-10;ui.state.reception.signalExcessDb=36;ui.emit();assert.equal(active.filter(Boolean).length,10);
  ui.state.reception.signalDbfs=-60;ui.state.reception.signalExcessDb=2;ui.emit();assert.equal(active.filter(Boolean).length,0);
  ui.state.receptionState='idle';ui.emit();
  assert.match(ui.dialog.querySelector('[data-strength-state]').textContent,/정지.*마지막/);
  ui.state.reception={};ui.emit();
  assert.equal(ui.dialog.querySelector('[data-strength-value]').textContent,'—');
  assert.equal(active.filter(Boolean).length,0);
});

test('call interruption shows stopped reception and requires a manual new start',async()=>{
  const ui=setup();ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  await ui.dialog.querySelector('[data-start]').click();await tick();
  const starts=ui.plugin.starts.length;
  ui.state.reception={frequencyHz:148229000,listenFrequencyHz:148241000,mode:'cw'};
  ui.state.receptionState='stopping';ui.state.backgroundReceiving=false;ui.state.fixedResultAvailable=true;
  ui.state.audio={enabled:false,gainDb:-1,notice:'통화로 수신을 정지했습니다. 통화 종료 후 수신 시작을 눌러주세요.'};ui.emit();
  assert.equal(ui.dialog.querySelector('[data-start]').disabled,true);
  ui.state.receptionState='idle';ui.emit();
  assert.match(ui.dialog.querySelector('[data-frequency-readout]').textContent,/정지됨/);
  assert.match(ui.dialog.querySelector('[data-audio-status]').textContent,/통화.*수신 시작/);
  assert.equal(ui.dialog.querySelector('[data-audio]').disabled,true);
  assert.equal(ui.dialog.querySelector('[data-start]').hidden,false);
  assert.equal(ui.dialog.querySelector('[data-start]').disabled,false);
  await ui.dialog.close();await ui.trigger.click();await tick();
  assert.equal(ui.plugin.starts.length,starts,'returning to the app must not restart reception');
  await ui.dialog.querySelector('[data-start]').click();await tick();assert.equal(ui.plugin.starts.length,starts+1);
});

test('result header shows actual CW listening frequency above metrics and labels stopped results', async () => {
  const ui=setup(); ui.device.hasPermission=true;
  await ui.trigger.click(); await ui.button().click(); await tick();
  ui.state.receptionState='receiving';
  ui.state.reception={frequencyHz:148229000,listenFrequencyHz:148241000,mode:'cw'};
  ui.emit();
  const readout=ui.dialog.querySelector('[data-frequency-readout]');
  assert.equal(readout.textContent,'148.241 MHz · CW · 수신 중');
  ui.dialog.querySelector('[data-frequency]').value='150.000';
  ui.state.receptionState='idle';ui.emit();
  assert.equal(readout.textContent,'148.241 MHz · CW · 정지됨');
  ui.state.reception={};ui.emit();assert.equal(readout.textContent,'수신 주파수 —');
  assert.ok(ui.dialog.innerHTML.indexOf('data-frequency-readout') < ui.dialog.innerHTML.indexOf('data-throughput'));
});

test('CW is fixed with no band or mode picker and scanning preserves CW', async () => {
  for (const mode of ['cw']) {
    const ui=setup(); ui.device.hasPermission=true;
    await ui.trigger.click(); await ui.button().click(); await tick();
    assert.doesNotMatch(ui.dialog.innerHTML,/data-band|data-mode/);
    assert.equal(ui.dialog.querySelector('[data-advanced-settings]').open,false);
    await ui.dialog.querySelector('[data-task-scan]').click();
    ui.dialog.querySelector('[data-scan-start]').value='220';
    ui.dialog.querySelector('[data-scan-end]').value='221';
    await ui.dialog.querySelector('[data-start]').click(); await tick();
    assert.equal(ui.plugin.scans[0].band,'wide');
    assert.equal(ui.plugin.scans[0].mode,mode);
    ui.state.receptionState='scanning';
    ui.state.scan={mode,band:'wide',centerHz:220500000,segment:1,segments:3,cycle:1,cycleSeconds:4,
      elapsedSeconds:1,candidates:[{id:1,frequencyHz:220500000,powerDbfs:-50,snrDb:20,lastSeenSeconds:1}]};
    ui.emit();
    await ui.dialog.querySelector('[data-candidates]').children[0].click(); await tick();
    assert.equal(ui.plugin.starts[0].mode,mode);
    assert.equal(ui.plugin.starts[0].frequencyHz,220500000);
  }
});

test('fixed reception accepts frequencies beyond the former presets including the three-digit upper limit', async () => {
  for (const mhz of ['50.100','125.000','220.000','999.999']) {
    const ui=setup(); ui.device.hasPermission=true;
    await ui.trigger.click(); await ui.button().click(); await tick();
    ui.dialog.querySelector('[data-frequency]').value=mhz;
    await ui.dialog.querySelector('[data-start]').click(); await tick();
    assert.equal(ui.plugin.starts[0].frequencyHz,Number(mhz)*1e6);
  }
});

test('CW tunes 148.241 MHz in 1 kHz steps and offers audio playback', async () => {
  const ui=setup(); ui.device.hasPermission=true;
  await ui.trigger.click(); await ui.button().click(); await tick();
  ui.dialog.querySelector('[data-frequency]').value='148.241';
  assert.equal(ui.dialog.querySelector('[data-audio-panel]').hidden,false);
  await ui.dialog.querySelector('[data-freq-up="1000"]').click();
  assert.equal(ui.dialog.querySelector('[data-frequency]').value,'148.242');
  await ui.dialog.querySelector('[data-start]').click(); await tick();
  const options=ui.plugin.starts[0];
  assert.equal(options.mode,'cw'); assert.equal(options.frequencyHz,148242000);
  ui.state.receptionState='receiving'; ui.state.reception=options;
  ui.state.audio={enabled:true}; ui.emit();
  assert.match(ui.dialog.querySelector('.sdr-status').textContent,/CW/);
  assert.equal(ui.dialog.querySelector('[data-audio]').disabled,false);
  await ui.dialog.querySelector('[data-audio]').click(); await tick();
  assert.equal(ui.plugin.audios[0].enabled,false);
});

test('restored CW shows the listening frequency instead of the offset hardware center', async () => {
  const ui=setup(); ui.device.hasPermission=true;
  ui.state.state='connected';ui.state.backgroundReceiving=true;ui.state.receptionState='receiving';
  ui.state.reception={mode:'cw',frequencyHz:148229000,listenFrequencyHz:148241000,sampleRate:1024000};
  await ui.trigger.click();
  assert.equal(ui.dialog.querySelector('[data-frequency]').value,'148.241');
});

test('editing the existing digit cells keeps arrows and starts CW at 148 MHz', async () => {
  const ui = setup(); ui.device.hasPermission = true;
  await ui.trigger.click(); await ui.button().click(); await tick();
  await ui.dialog.querySelector('[data-frequency-edit]').click();
  for (const [index, text] of [...'148000'].entries()) {
    const digit = ui.dialog.querySelector(`[data-freq-digit="${index}"]`);
    digit.textContent = text; digit.events.input();
    assert.equal(ui.dialog.querySelector('[data-frequency-digits]').hidden, false);
    assert.equal(ui.dialog.querySelector('[data-frequency-entry]').hidden, true);
  }
  assert.equal(ui.dialog.querySelector('[data-frequency]').value, '148.000');
  await ui.dialog.querySelector('[data-freq-up="1000"]').click();
  assert.equal(ui.dialog.querySelector('[data-frequency]').value, '148.001');
  await ui.dialog.querySelector('[data-freq-down="1000"]').click();
  await ui.dialog.querySelector('[data-frequency-edit]').click();
  await ui.dialog.querySelector('[data-start]').click(); await tick();
  assert.equal(ui.plugin.starts[0].mode, 'cw');
  assert.equal(ui.plugin.starts[0].band, 'wide');
  assert.equal(ui.plugin.starts[0].frequencyHz, 148000000);
});

test('CW reaches the receiver at both expanded VHF boundaries', async () => {
  for (const frequency of ['140.000', '174.000']) {
    const ui = setup(); ui.device.hasPermission = true;
    await ui.trigger.click(); await ui.button().click(); await tick();
    ui.dialog.querySelector('[data-frequency]').value = frequency;
    await ui.dialog.querySelector('[data-start]').click(); await tick();
    assert.equal(ui.plugin.starts[0].frequencyHz, Number(frequency) * 1e6);
    assert.equal(ui.plugin.starts[0].mode, 'cw');
  }
});




test('closing the settings dialog leaves an active background scan and USB connection intact', async () => {
  const ui=await scanningUi();
  ui.state.backgroundScanning=true; ui.emit();
  assert.equal(ui.trigger.dataset.status,'scanning');
  assert.equal(ui.trigger.dataset.statusLabel,'탐색 중');
  const history=structuredClone(ui.state.scan);
  await ui.dialog.querySelector('[data-close]').click(); await tick();
  assert.equal(ui.dialog.open,false);
  assert.equal(ui.trigger.dataset.status,'scanning');
  assert.equal(ui.state.state,'connected');
  assert.equal(ui.state.receptionState,'scanning');
  assert.deepEqual(ui.state.scan,history);
  ui.state.scan.cycle=2; ui.emit();
  assert.match(ui.trigger.title,/2회차/);
  await ui.trigger.click();
  assert.equal(ui.dialog.open,true);
  assert.equal(ui.dialog.querySelector('[data-candidates]').children[0].frequencyHz,103505000);
});

test('closing or stopping fixed reception keeps USB available for the next check', async () => {
  const ui = setup();
  ui.device.hasPermission = true;
  await ui.trigger.click();
  await ui.button().click();
  ui.state.receptionState = 'receiving';
  ui.state.backgroundReceiving = true;
  ui.emit();
  await ui.dialog.querySelector('[data-close]').click();
  assert.equal(ui.state.state, 'connected');
  assert.equal(ui.state.receptionState, 'receiving');
  await ui.trigger.click();
  await ui.dialog.querySelector('[data-stop]').click();
  assert.equal(ui.state.state, 'connected');
  assert.equal(ui.counts().openCount, 1);
});

test('recreated settings restore an active background fixed frequency', async () => {
  const ui = setup();
  ui.device.connected = true;
  ui.state.state = 'connected';
  ui.state.backgroundReceiving = true;
  ui.state.receptionState = 'receiving';
  ui.state.reception = { mode: 'cw', frequencyHz: 103500000, sampleRate: 1024000, gainDb: 7.1, ppm: 0 };
  await ui.trigger.click();
  assert.equal(ui.dialog.querySelector('[data-frequency]').value, '103.500');
  assert.equal(ui.dialog.querySelector('[data-audio-panel]').hidden, false);
});

test('recreated settings expose paused scan history and its reset action', async () => {
  const ui = setup();
  ui.device.connected = true;
  ui.state.state = 'connected';
  ui.state.scanResumeAvailable = true;
  ui.state.receptionState = 'idle';
  ui.state.scan = { band: 'wide', mode: 'cw', startHz: 103000000, endHz: 104000000,
    requestedSampleRate: 1024000, requestedGainTenthsDb: 100, ppm: 0,
    dwellMs: 5000, thresholdDb: 10, centerHz: 103300000, segment: 2,
    segments: 4, cycle: 3, cycleSeconds: 4.8, elapsedSeconds: 14, candidates: [] };
  await ui.trigger.click();
  assert.equal(ui.dialog.querySelector('[data-scan-results]').hidden, false);
  assert.equal(ui.dialog.querySelector('[data-stop]').textContent, '초기화');
  assert.equal(ui.dialog.querySelector('[data-stop]').disabled, false);
  assert.equal(ui.dialog.querySelector('[data-start]').textContent, '탐색 재개');
});

test('map SDR button changes state for pause, fixed reception and disconnect', async () => {
  const ui=await scanningUi();
  ui.state.backgroundScanning=true; ui.emit();
  assert.equal(ui.trigger.dataset.status,'scanning');
  ui.state.backgroundScanning=false; ui.state.receptionState='idle'; ui.emit();
  assert.equal(ui.trigger.dataset.status,'paused');
  ui.state.receptionState='receiving'; ui.emit();
  assert.equal(ui.trigger.dataset.status,'receiving');
  ui.state.receptionState='error'; ui.state.receptionError='USB read failed'; ui.emit();
  assert.equal(ui.trigger.dataset.status,'error');
  ui.state.receptionError=''; ui.state.receptionState='idle'; ui.state.scanResumeAvailable=false;
  ui.state.state='idle'; ui.emit();
  assert.equal(ui.trigger.dataset.status,undefined);
  assert.equal(ui.trigger.title,'탐색');
});

test('running scan is visible on the map after a WebView reload without opening settings', async () => {
  const ui=setup();
  ui.state.state='connected'; ui.state.backgroundScanning=true;
  ui.state.receptionState='scanning'; ui.state.scan={cycle:7};
  await tick(); ui.emit();
  assert.equal(ui.dialog.open,undefined);
  assert.equal(ui.trigger.dataset.status,'scanning');
  assert.match(ui.trigger.title,/7회차/);
});

test('a recreated screen restores the running scan settings from native state', async () => {
  const ui=setup();
  ui.device.hasPermission=true; ui.device.connected=true;
  ui.state.state='connected'; ui.state.receptionState='scanning';
  ui.state.backgroundScanning=true; ui.state.scanResumeAvailable=true;
  ui.state.scan={band:'wide',mode:'cw',startHz:103000000,endHz:104000000,centerHz:103300000,
    requestedSampleRate:1024000,requestedGainTenthsDb:100,ppm:0,dwellMs:5000,thresholdDb:10,
    segment:2,segments:4,cycle:3,cycleSeconds:4.8,elapsedSeconds:14,candidates:[]};
  await ui.trigger.click();
  assert.equal(ui.dialog.querySelector('[data-scan-start]').value,'103.000');
  assert.equal(ui.dialog.querySelector('[data-scan-end]').value,'104.000');
  assert.equal(ui.dialog.querySelector('[data-scan-results]').hidden,false);
  assert.equal(ui.dialog.querySelector('[data-start]').disabled,true);
});

test('band scan sends explicit options, stays silent, opens candidates and locks tuning', async () => {
  const ui = await scanningUi();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.plugin.scans[0])), {band:'wide',mode:'cw',startHz:103000000,endHz:104000000,
    sampleRate:1024000,gainTenthsDb:500,ppm:0,dwellMs:5000,thresholdDb:10});
  assert.equal(ui.plugin.starts.length,0); assert.equal(ui.plugin.audios.length,0);
  assert.equal(ui.dialog.querySelector('[data-audio-panel]').hidden,true);
  assert.equal(ui.dialog.querySelector('[data-task-fixed]').disabled,true);
  assert.equal(ui.dialog.querySelector('[data-candidate-heading]').textContent,'반복 펄스 후보');
  assert.match(ui.dialog.querySelector('[data-scan-progress]').textContent,/103.300 MHz.*\n.*2\/4/);
  const found = ui.dialog.querySelector('[data-candidates]'), button = found.children[0];
  ui.state.scan.candidates[0].frequencyHz = 103506000; ui.emit();
  assert.equal(found.children[0],button);
  assert.match(button.children[0].textContent,/103.506/);
});

test('candidate waits for native stop, then fixed CW can resume original scan settings', async () => {
  const ui = await scanningUi();
  const originalStop = ui.plugin.stopReception; let release;
  ui.plugin.stopReception = () => new Promise(resolve => { release=async()=>{await originalStop();resolve();}; });
  void ui.dialog.querySelector('[data-candidates]').children[0].click(); await tick();
  assert.equal(ui.plugin.starts.length,0);
  await release(); await tick();
  assert.equal(ui.plugin.starts[0].frequencyHz,103505000);
  assert.equal(ui.plugin.starts[0].mode,'cw');
  assert.equal(ui.dialog.querySelector('[data-scan-results]').hidden,true);
  assert.equal(ui.dialog.querySelector('[data-back]').hidden,false);
  ui.state.receptionState='receiving'; ui.state.reception=ui.plugin.starts[0]; ui.emit();
  ui.plugin.stopReception=originalStop;
  ui.dialog.querySelector('[data-gain]').value='30';
  await ui.dialog.querySelector('[data-back]').click(); await tick();
  assert.equal(ui.plugin.scans.length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(ui.plugin.scans[1])),JSON.parse(JSON.stringify({...ui.plugin.scans[0],resume:true})));
  assert.equal(ui.dialog.querySelector('[data-gain]').value,'50');
  assert.equal(ui.dialog.querySelector('[data-start]').textContent,'탐색 중');
});

test('manual fixed to scan to fixed switching has one footer action and no candidate return', async () => {
  const ui = setup(); ui.device.hasPermission = true;
  await ui.trigger.click(); await ui.button().click();
  await ui.dialog.querySelector('[data-start]').click();
  ui.state.receptionState = 'receiving'; ui.emit();
  await ui.dialog.querySelector('[data-stop]').click();
  await ui.dialog.querySelector('[data-task-scan]').click();
  await ui.dialog.querySelector('[data-start]').click();
  ui.state.receptionState = 'scanning'; ui.emit();
  await ui.dialog.querySelector('[data-stop]').click();
  await ui.dialog.querySelector('[data-task-fixed]').click();
  assert.equal(ui.dialog.querySelector('[data-start]').textContent, '수신 시작');
  assert.equal(ui.dialog.querySelector('[data-back]').hidden, true);
  assert.equal(ui.dialog.innerHTML.includes('data-resume'), false);
});

test('closing or disconnecting during candidate handoff prevents reception restart', async () => {
  for (const action of ['close','disconnect']) {
    const ui=await scanningUi(); let release;
    ui.plugin.stopReception=()=>new Promise(resolve=>{release=resolve;});
    void ui.dialog.querySelector('[data-candidates]').children[0].click(); await tick();
    if(action==='close') await ui.dialog.close();
    else await ui.dialog.querySelector('[data-disconnect]').click();
    release(); await tick();
    assert.equal(ui.plugin.starts.length,0);
  }
});


test('candidate bars and ranking follow noise contrast rather than absolute power', async () => {
  const ui=await scanningUi();
  ui.state.scan.candidates=[
    {id:1,frequencyHz:103100000,powerDbfs:-81,snrDb:12,lastSeenSeconds:1},
    {id:2,frequencyHz:103800000,powerDbfs:-55,snrDb:25,lastSeenSeconds:1.9}
  ]; ui.emit();
  const found=ui.dialog.querySelector('[data-candidates]');
  assert.equal(found.children[0].frequencyHz,103800000);
  assert.equal(found.children[0].signalIcon.dataset.level,'3');
  assert.equal(found.children[1].signalIcon.dataset.level,'1');
  assert.equal(ui.state.scan.candidates[0].id,1);
  ui.state.scan.candidates[0].powerDbfs=-45; ui.emit();
  assert.equal(found.children[0].frequencyHz,103800000);
  ui.state.scan.candidates[0].snrDb=28; ui.emit();
  assert.equal(found.children[0].frequencyHz,103100000);
  await found.children[0].click(); await tick();
  assert.equal(ui.plugin.starts[0].frequencyHz,103100000);
});

test('candidate bars can be empty for noise without hiding the detected candidate', async () => {
  const ui=await scanningUi();
  ui.state.scan.candidates=[{id:1,frequencyHz:148241000,powerDbfs:-35,snrDb:5,
    observations:2,lastSeenSeconds:1}];
  ui.emit();
  const button=ui.dialog.querySelector('[data-candidates]').children[0];
  assert.equal(button.signalIcon.dataset.level,'0');
  assert.equal(button.frequencyHz,148241000);
  ui.state.scan.candidates[0].snrDb=36; ui.emit();
  assert.equal(button.signalIcon.dataset.level,'4');
});

test('fresh candidates outrank old strong measurements without changing their power and can recover', async () => {
  const ui=await scanningUi();
  ui.state.scan.cycle=3; ui.state.scan.elapsedSeconds=20;
  ui.state.scan.candidates=[
    {id:1,frequencyHz:103100000,powerDbfs:-35,snrDb:35,lastSeenSeconds:1,lastSeenCycle:1},
    {id:2,frequencyHz:103800000,powerDbfs:-68,snrDb:12,lastSeenSeconds:18,lastSeenCycle:2,confirmedCycle:2}
  ]; ui.emit();
  const found=ui.dialog.querySelector('[data-candidates]');
  assert.equal(found.children[0].frequencyHz,103800000);
  assert.match(found.children[1].className,/stale/);
  assert.match(found.children[1].children[1].children[0].textContent,/-35.0/);
  assert.match(found.children[1].children[1].children[2].textContent,/최근 미감지/);
  assert.equal(ui.dialog.querySelector('[data-candidate-count]').textContent,'1/2개 최근 감지');
  ui.state.scan.candidates[0].lastSeenCycle=3; ui.state.scan.candidates[0].lastSeenSeconds=20; ui.emit();
  assert.equal(found.children[0].frequencyHz,103100000);
  assert.doesNotMatch(found.children[0].className,/stale/);
  await ui.dialog.querySelector('[data-stop]').click(); await tick();
  assert.match(found.children[0].className,/paused/);
  assert.match(found.children[0].children[1].children[2].textContent,/마지막 측정/);
  assert.equal(ui.plugin.starts.length,0);
});

test('a new signal in the configured range appears without changing receiver frequency automatically', async () => {
  const ui=await scanningUi();
  ui.state.scan.cycle=2; ui.state.scan.candidates[0].lastSeenCycle=1;
  ui.state.scan.candidates.push({id:2,frequencyHz:103900000,powerDbfs:-42,snrDb:30,
    lastSeenSeconds:2,lastSeenCycle:2,confirmedCycle:2}); ui.emit();
  const found=ui.dialog.querySelector('[data-candidates]');
  assert.equal(found.children[0].frequencyHz,103900000);
  assert.equal(found.children[0].children[1].children[3].hidden,false);
  assert.equal(ui.plugin.starts.length,0); assert.equal(ui.plugin.scans.length,1);
  ui.state.scan.cycle=3; ui.emit();
  assert.equal(found.children[0].children[1].children[3].hidden,true);
  assert.equal(found.children[0].frequencyHz,103900000);
  assert.equal(ui.plugin.starts.length,0);
});

test('pause and resume retain the current interval, pass and candidate list', async () => {
  const ui=await scanningUi();
  ui.state.scan.segment=3; ui.state.scan.cycle=4; ui.state.scan.totalBytes=12000000; ui.emit();
  assert.equal(ui.dialog.querySelector('[data-stop]').textContent,'일시정지');
  await ui.dialog.querySelector('[data-stop]').click(); await tick();
  assert.equal(ui.dialog.querySelector('[data-start]').textContent,'탐색 재개');
  assert.match(ui.dialog.querySelector('[data-scan-progress]').textContent,/탐색 일시정지.*\n.*3\/4.*4회차/);
  const history=structuredClone(ui.state.scan);
  await ui.dialog.querySelector('[data-start]').click(); await tick();
  assert.equal(ui.plugin.scans[1].resume,true);
  assert.deepEqual(ui.state.scan,history);
  assert.equal(ui.dialog.querySelector('[data-candidates]').children[0].frequencyHz,103505000);
});

test('paused scan history can be cleared after reopening without disconnecting USB', async () => {
  const ui = await scanningUi();
  const stop = ui.dialog.querySelector('[data-stop]');
  assert.equal(stop.textContent, '일시정지');
  await stop.click();
  await ui.dialog.querySelector('[data-close]').click();
  await ui.trigger.click();
  assert.equal(stop.textContent, '초기화');
  assert.equal(stop.disabled, false);
  await stop.click();
  assert.equal(ui.state.scanResumeAvailable, false);
  assert.deepEqual(ui.state.scan, {});
  assert.equal(ui.state.state, 'connected');
  assert.equal(ui.counts().openCount, 1);
  assert.equal(stop.disabled, true);
  assert.equal(ui.dialog.querySelector('[data-start]').textContent, '탐색 시작');
  await ui.dialog.querySelector('[data-start]').click();
  assert.equal(ui.plugin.scans[1].resume, undefined);
});

test('listening and stopping audio preserve the scan checkpoint for resumption', async () => {
  const ui=await scanningUi(); ui.state.scan.segment=3; ui.state.scan.cycle=5; ui.emit();
  const history=structuredClone(ui.state.scan);
  await ui.dialog.querySelector('[data-candidates]').children[0].click(); await tick();
  assert.deepEqual(ui.state.scan,history);
  ui.state.receptionState='receiving'; ui.state.reception=ui.plugin.starts[0]; ui.emit();
  assert.equal(ui.dialog.querySelector('[data-stop]').textContent,'정지');
  await ui.dialog.querySelector('[data-stop]').click(); await tick();
  await ui.dialog.querySelector('[data-back]').click(); await tick();
  assert.equal(ui.plugin.scans[1].resume,true); assert.deepEqual(ui.state.scan,history);
});

test('changed scan settings start a new session rather than reuse incompatible history', async () => {
  const ui=await scanningUi();
  await ui.dialog.querySelector('[data-stop]').click(); await tick();
  ui.dialog.querySelector('[data-threshold]').value='15'; ui.emit();
  assert.equal(ui.dialog.querySelector('[data-start]').textContent,'탐색 시작');
  await ui.dialog.querySelector('[data-start]').click(); await tick();
  assert.equal(ui.plugin.scans[1].resume,undefined); assert.equal(ui.plugin.scans[1].thresholdDb,15);
  assert.deepEqual(ui.state.scan,{});
});

test('closing or disconnecting while resuming cannot launch a new scan', async () => {
  for (const action of ['close','disconnect']) {
    const ui=await scanningUi();
    await ui.dialog.querySelector('[data-candidates]').children[0].click(); await tick();
    ui.state.receptionState='receiving'; ui.state.reception=ui.plugin.starts[0]; ui.emit();
    let release; ui.plugin.stopReception=()=>new Promise(resolve=>{release=resolve;});
    void ui.dialog.querySelector('[data-back]').click(); await tick();
    if(action==='close') await ui.dialog.close();
    else await ui.dialog.querySelector('[data-disconnect]').click();
    release(); await tick();
    assert.equal(ui.plugin.scans.length,1);
    assert.equal(ui.state.scanResumeAvailable,action==='close');
    if(action==='close') await ui.trigger.click();
    assert.equal(ui.dialog.querySelector('[data-back]').hidden,action!=='close');
  }
});

test('Android shared back handler resumes from listening without closing SDR or exiting the app', async () => {
  const ui=await scanningUi(); ui.state.scan.segment=3; ui.state.scan.cycle=4; ui.emit();
  const history=structuredClone(ui.state.scan);
  await ui.dialog.querySelector('[data-candidates]').children[0].click(); await tick();
  const mapSource=fs.readFileSync(require('node:path').join(__dirname,'../public/js/client-ol.js'),'utf8');
  const start=mapSource.indexOf('const listener = await appPlugin.addListener("backButton", function () {');
  const bodyStart=mapSource.indexOf('{',start)+1, bodyEnd=mapSource.indexOf('\n    });',bodyStart);
  let exits=0, overlays=0;
  const context={window:ui.window,lastBackPressAt:Date.now(),appPlugin:{exitApp(){exits++;}},
    closeTopBackClosableOverlay(){overlays++;return false;},observationPopupEl:null,obsListModule:null,gpsTrackUi:{isOpen:()=>false},
    analysisEstimateSource:null,BACK_EXIT_DOUBLE_PRESS_MS:1500,showBackExitToast(){},triggerHapticImpact(){},setTimeout,
    resetBackExitState(){context.lastBackPressAt=0;}};
  const handler='(function(){'+mapSource.slice(bodyStart,bodyEnd)+'})()';
  vm.runInNewContext(handler,context);
  vm.runInNewContext(handler,context); // A second press during handoff is consumed.
  await tick();
  assert.equal(ui.dialog.open,true); assert.equal(ui.plugin.scans.length,2);
  assert.equal(ui.plugin.scans[1].resume,true); assert.deepEqual(ui.state.scan,history);
  assert.equal(exits,0); assert.equal(overlays,2); assert.equal(context.lastBackPressAt,0);
});

function attachExitFlow(ui) {
  const mapSource=fs.readFileSync(require('node:path').join(__dirname,'../public/js/client-ol.js'),'utf8');
  const toastStart=mapSource.indexOf('  function showBackExitToast(message) {');
  const toastEnd=mapSource.indexOf('  // 상태 강조',toastStart);
  const listenerStart=mapSource.indexOf('const listener = await appPlugin.addListener("backButton", function () {');
  const bodyStart=mapSource.indexOf('{',listenerStart)+1, bodyEnd=mapSource.indexOf('\n    });',bodyStart);
  let now=10000, exits=0, nextId=0;
  const timers=new Map(), toasts=[];
  ui.window.setTimeout=(callback,delay)=>{const id=++nextId; timers.set(id,{callback,delay}); return id;};
  ui.window.clearTimeout=id=>timers.delete(id);
  const context=vm.createContext({window:ui.window,
    document:{createElement:()=>new Element(),body:{appendChild:element=>toasts.push(element)}},
    lastBackPressAt:0,backExitToastEl:null,backExitToastIconEl:null,backExitToastTextEl:null,backExitToastHideTimer:null,
    BACK_EXIT_DOUBLE_PRESS_MS:2000,Date:{now:()=>now},appPlugin:{exitApp(){exits++;}},
    closeTopBackClosableOverlay:()=>false,observationPopupEl:null,obsListModule:null,obsRegisterModule:null,analysisEstimateSource:null,gpsTrackUi:{isOpen:()=>false},
    triggerHapticImpact(){}});
  vm.runInContext(mapSource.slice(toastStart,toastEnd),context);
  return {context,toasts,timers,exits:()=>exits,
    back(){vm.runInContext('(function(){'+mapSource.slice(bodyStart,bodyEnd)+'})()',context);},
    advance(ms){now+=ms;}};
}

test('opening SDR cancels the map exit prompt; closing it requires two fresh map back presses', async () => {
  const ui=setup(), flow=attachExitFlow(ui);
  flow.back();
  assert.equal(flow.toasts[0].style.opacity,'1');
  assert.equal(flow.timers.size,1);
  await ui.trigger.click();
  assert.equal(flow.toasts[0].style.opacity,'0');
  assert.equal(flow.context.lastBackPressAt,0);
  assert.equal(flow.timers.size,0);
  flow.back(); await tick();
  assert.equal(ui.dialog.open,false);
  assert.equal(flow.exits(),0);
  flow.back();
  assert.equal(flow.toasts[0].style.opacity,'1');
  assert.equal(flow.exits(),0);
  flow.advance(100); flow.back();
  await tick();
  assert.equal(flow.exits(),1);
  assert.equal(flow.toasts[0].style.opacity,'0');
  assert.equal(flow.timers.size,0);
});

test('Android back presses during startup loading do not close background panels or arm app exit',async()=>{
  const ui=setup(),flow=attachExitFlow(ui);
  ui.window.BearStartupLoading=true;
  flow.back();flow.back();assert.equal(flow.exits(),0);assert.equal(flow.context.lastBackPressAt,0);
  ui.window.BearStartupLoading=false;
  flow.back();assert.equal(flow.exits(),0);
  flow.back();await tick();assert.equal(flow.exits(),1);
});

test('app exit cancellation leaves reception running and requires a new double back press',async()=>{
  const ui=setup(),flow=attachExitFlow(ui);let prompts=0;
  ui.state.receptionState='receiving';ui.state.backgroundReceiving=true;
  ui.plugin.prepareAppExit=async()=>{prompts++;return {confirmed:false};};
  flow.back();flow.advance(100);flow.back();await tick();
  assert.equal(prompts,1);assert.equal(flow.exits(),0);
  assert.equal(ui.state.receptionState,'receiving');assert.equal(ui.state.backgroundReceiving,true);
  assert.equal(flow.context.lastBackPressAt,0);
  flow.back();await tick();assert.equal(prompts,1);
  flow.advance(100);flow.back();await tick();assert.equal(prompts,2);assert.equal(flow.exits(),0);
});

test('confirmed app exit waits for native SDR cleanup and ignores repeated requests',async()=>{
  const ui=setup(),flow=attachExitFlow(ui);let release,prompts=0;
  ui.plugin.prepareAppExit=()=>{prompts++;return new Promise(resolve=>{release=()=>{ui.state.receptionState='idle';ui.state.backgroundReceiving=false;resolve({confirmed:true});};});};
  ui.state.receptionState='scanning';ui.state.backgroundScanning=true;
  flow.back();flow.advance(100);flow.back();await tick();
  assert.equal(prompts,1);assert.equal(flow.exits(),0);
  flow.back();flow.back();await tick();assert.equal(prompts,1);
  release();await tick();assert.equal(flow.exits(),1);
  assert.equal(ui.state.receptionState,'idle');
});

test('native exit cleanup failure prevents Activity exit and permits retry',async()=>{
  const ui=setup();let exits=0,notice='';ui.window.alert=text=>notice=text;
  ui.plugin.prepareAppExit=async()=>{throw Error('USB cleanup failed');};
  await ui.window.SdrDiagnostics.exitAppSafely(()=>exits++);
  assert.equal(exits,0);assert.match(notice,/USB cleanup failed/);
  ui.plugin.prepareAppExit=async()=>({confirmed:true});
  await ui.window.SdrDiagnostics.exitAppSafely(()=>exits++);assert.equal(exits,1);
});

test('older native bridges confirm active reception and close USB before app exit',async()=>{
  const ui=setup();let exits=0,closes=0;
  ui.state.receptionState='receiving';ui.state.backgroundReceiving=true;
  ui.plugin.closeDevice=async()=>{closes++;};ui.window.confirm=()=>false;
  await ui.window.SdrDiagnostics.exitAppSafely(()=>exits++);assert.equal(exits,0);assert.equal(closes,0);
  ui.window.confirm=()=>true;
  await ui.window.SdrDiagnostics.exitAppSafely(()=>{assert.equal(closes,1);exits++;});
  assert.equal(exits,1);
});

test('map exit eligibility lasts exactly as long as its visible prompt', () => {
  const flow=attachExitFlow(setup());
  flow.back();
  const timer=[...flow.timers.values()][0];
  assert.equal(timer.delay,flow.context.BACK_EXIT_DOUBLE_PRESS_MS);
  flow.advance(timer.delay); timer.callback();
  assert.equal(flow.toasts[0].style.opacity,'0');
  assert.equal(flow.context.lastBackPressAt,0);
  assert.equal(flow.timers.size,0);
  flow.back();
  assert.equal(flow.exits(),0);
  assert.equal(flow.toasts[0].style.opacity,'1');
});

test('header back arrow and dialog cancel resume the saved scan through the same path', async () => {
  for(const action of ['arrow','cancel']) {
    const ui=await scanningUi();
    await ui.dialog.querySelector('[data-candidates]').children[0].click(); await tick();
    assert.equal(ui.dialog.querySelector('[data-back]').hidden,false);
    if(action==='arrow') await ui.dialog.querySelector('[data-back]').click();
    else {
      let prevented=false;
      ui.dialog.events.cancel({preventDefault(){prevented=true;}});
      assert.equal(prevented,true);
    }
    await tick();
    assert.equal(ui.plugin.scans[1]?.resume,true, action); assert.equal(ui.dialog.open,true);
    assert.equal(ui.dialog.querySelector('[data-back]').hidden,true);
  }
});

test('back first leaves direct entry without committing invalid input or losing the scan', async () => {
  const ui=await scanningUi();
  await ui.dialog.querySelector('[data-candidates]').children[0].click(); await tick();
  await ui.dialog.querySelector('[data-stop]').click(); await tick();
  await ui.dialog.querySelector('[data-frequency-edit]').click();
  ui.dialog.querySelector('[data-frequency]').value='invalid';
  assert.equal(ui.window.SdrDiagnostics.handleBackNavigation(),true);
  assert.equal(ui.dialog.querySelector('[data-frequency-entry]').hidden,true);
  assert.equal(ui.dialog.querySelector('[data-frequency]').value,'103.505');
  assert.equal(ui.plugin.scans.length,1); assert.equal(ui.dialog.open,true);
  ui.window.SdrDiagnostics.handleBackNavigation(); await tick();
  assert.equal(ui.plugin.scans[1].resume,true);
});

test('back on the scan screen closes SDR and a closed dialog leaves shared navigation alone', async () => {
  const ui=await scanningUi();
  assert.equal(ui.window.SdrDiagnostics.handleBackNavigation(),true); await tick();
  assert.equal(ui.dialog.open,false); assert.equal(ui.state.scanResumeAvailable,true);
  assert.equal(ui.window.SdrDiagnostics.handleBackNavigation(),false);
});

test('dialog receives only actual system-bar overlap and follows the visible keyboard viewport', async () => {
  const ui=await scanningUi(); ui.window.innerHeight=800;
  ui.state.viewportInsets={top:24,bottom:48,left:0,right:0}; ui.emit();
  assert.equal(ui.dialog.style['--sdr-native-safe-top'],'24px');
  assert.equal(ui.dialog.style['--sdr-native-safe-bottom'],'48px');
  assert.equal(ui.dialog.style['--sdr-viewport-height'],'800px');
  ui.window.visualViewport={height:400,offsetTop:80}; ui.emit();
  assert.equal(ui.dialog.style['--sdr-viewport-height'],'400px');
  assert.equal(ui.dialog.style['--sdr-viewport-top'],'80px');
  ui.state.viewportInsets={top:-1,bottom:'bad'}; ui.emit();
  assert.equal(ui.dialog.style['--sdr-native-safe-top'],'0px');
  assert.equal(ui.dialog.style['--sdr-native-safe-bottom'],'0px');
});


test('five decimal digit tuning preserves 10 Hz steps through editing and CW reception', async () => {
  const ui=setup();ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();
  const frequency=ui.dialog.querySelector('[data-frequency]');frequency.value='148.24123';
  await ui.dialog.querySelector('[data-freq-up="10"]').click();
  assert.equal(frequency.value,'148.24124');
  await ui.dialog.querySelector('[data-freq-down="100"]').click();
  assert.equal(frequency.value,'148.24114');
  await ui.dialog.querySelector('[data-frequency-edit]').click();
  const last=ui.dialog.querySelector('[data-freq-digit="7"]');let blurs=0;last.blur=()=>{blurs++;};last.textContent='7';last.events.input();
  assert.equal(blurs,1);
  assert.equal(ui.dialog.querySelector('[data-frequency-edit]').textContent,'\uC9C1\uC811 \uC785\uB825');
  assert.equal(frequency.value,'148.24117');
  await ui.dialog.querySelector('[data-start]').click();
  assert.equal(ui.plugin.starts[0].frequencyHz,148241170);
  ui.state.receptionState='idle';ui.state.reception={mode:'cw',frequencyHz:148229170,listenFrequencyHz:148241170,sampleRate:1024000};
  ui.emit();
  assert.match(ui.dialog.querySelector('[data-frequency-readout]').textContent,/148\.24117 MHz/);
});


test('nearby tuning keeps explicit selection and range badges show overlapping codes without auto-selecting',async()=>{
  const catalog={formatHz:hz=>String(hz/1e6),load:async()=>({notice:'',items:[
    {id:'1',code:'KF-110',frequencies:[{slot:'A',hz:148241230},{slot:'B',hz:149125000}]},
    {id:'2',code:'KF-111',frequencies:[{slot:'A',hz:148241240}]},
    {id:'3',code:'KF-112',frequencies:[{slot:'A',hz:148241240}]}
  ]})};
  const ui=setup(true,'injected',false,catalog);ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  const list=ui.dialog.querySelector('[data-animal-list]'),label=ui.dialog.querySelector('[data-frequency-animal]');
  await list.children[0].children[2].children[0].click();assert.equal(label.textContent,'KF-110, KF-111, KF-112');assert.equal(label.hidden,false);
  await ui.dialog.querySelector('[data-animal-list]').children[0].children[2].children[1].click();
  assert.equal(ui.dialog.querySelector('[data-animal-clear]').disabled,false,'registered A/B changes keep explicit selection');
  await list.children[0].children[2].children[0].click();
  await ui.dialog.querySelector('[data-freq-up="10"]').click();
  assert.equal(label.textContent,'KF-110, KF-111, KF-112');assert.equal(label.hidden,false);
  assert.equal(ui.dialog.querySelector('[data-animal-clear]').disabled,false);
  assert.equal(ui.dialog.querySelector('[data-register-observation]').disabled,true);
  await ui.dialog.querySelector('[data-freq-up="10"]').click();
  assert.equal(label.hidden,false,'nearby frequencies must retain range badges');
  const frequency=ui.dialog.querySelector('[data-frequency]');
  frequency.value='149';frequency.events.input();
  assert.equal(ui.dialog.querySelector('[data-animal-clear]').disabled,true);
  frequency.value='148.24123';frequency.events.input();
  assert.equal(label.textContent,'KF-110, KF-111, KF-112');assert.equal(label.hidden,false);
  assert.equal(ui.dialog.querySelector('[data-animal-clear]').disabled,true,'matching labels must not silently select a subject');
  frequency.value='';frequency.events.input();assert.equal(label.hidden,true);
});

test('USB frequency badge includes both 900 Hz boundaries without requiring an explicit selection',async()=>{
  const catalog={formatHz:hz=>String(hz/1e6),load:async()=>({notice:'',items:[
    {code:'KF-110',frequencies:[{slot:'A',hz:148241000}]}
  ]})};
  const ui=setup(true,'injected',false,catalog);ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  for(const offset of [-901,-900,0,900,901]) {
    const frequency=ui.dialog.querySelector('[data-frequency]');
    frequency.value=String((148241000+offset)/1e6);frequency.events.input();
    const badge=ui.dialog.querySelector('[data-frequency-animal]');
    assert.equal(badge.hidden,Math.abs(offset)>900,`offset ${offset}`);
    assert.equal(badge.textContent,Math.abs(offset)<=900?'KF-110':'');
    assert.equal(ui.dialog.querySelector('[data-animal-clear]').disabled,true);
  }
});


test('search in a short viewport uses compact layout and Enter or IME submit releases focus', async () => {
  const ui=setup(true,'injected',false,animalCatalog());ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  ui.window.innerHeight=180;
  const search=ui.dialog.querySelector('[data-animal-search]');let blurs=0,prevented=0;
  search.blur=()=>{blurs++;};search.events.focus();
  assert.equal(ui.dialog.dataset.searchCompact,'true');
  search.events.keydown({key:'Enter',isComposing:true,preventDefault(){prevented++;}});
  assert.equal(ui.dialog.dataset.searchCompact,'true');assert.equal(blurs,0);
  search.events.keydown({key:'Enter',preventDefault(){prevented++;}});
  assert.equal(ui.dialog.dataset.searchCompact,'false');assert.equal(blurs,1);
  search.events.focus();
  ui.dialog.querySelector('[data-animal-search-form]').events.submit({preventDefault(){prevented++;}});
  assert.equal(ui.dialog.dataset.searchCompact,'false');assert.equal(blurs,2);assert.equal(prevented,2);
  search.events.focus();await ui.dialog.querySelector('[data-animal-list]').children[0].children[2].children[0].click();
  assert.equal(ui.dialog.dataset.searchCompact,'false');assert.equal(blurs,3);
});


test('card A/B/C stays available during reception and switches only after stopping the old stream', async () => {
  const ui=setup(true,'injected',false,animalCatalog());ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  const cards=()=>ui.dialog.querySelector('[data-animal-list]').children;
  const slot=i=>cards()[0].children[2].children[i];
  await slot(0).click();await ui.dialog.querySelector('[data-start]').click();
  ui.state.receptionState='receiving';ui.state.backgroundReceiving=true;
  ui.state.reception={mode:'cw',frequencyHz:148229500,listenFrequencyHz:148241500,hasSamples:true,powerDbfs:-56};ui.emit();
  assert.equal(ui.dialog.querySelector('[data-settings]').disabled,true);
  assert.equal(ui.dialog.querySelector('[data-animal-search]').disabled,false);assert.equal(slot(1).disabled,false);
  const order=[],originalStart=ui.plugin.startReception.bind(ui.plugin);
  ui.plugin.startReception=async o=>{order.push('start');await originalStart(o);};
  let release;ui.plugin.stopReception=()=>new Promise(resolve=>{order.push('stop');release=()=>{ui.state.receptionState='idle';ui.emit();resolve();};});
  const switching=slot(1).click();await tick();
  assert.equal(ui.plugin.starts.length,1);assert.equal(ui.dialog.querySelector('[data-register-observation]').disabled,true);
  release();await switching;
  assert.deepEqual(order,['stop','start']);assert.equal(ui.plugin.starts[1].frequencyHz,149125000);
  assert.equal(ui.plugin.starts[1].mode,'cw');assert.equal(ui.dialog.querySelector('[data-register-observation]').disabled,true);
  ui.state.receptionState='receiving';ui.state.reception={mode:'cw',frequencyHz:149113000,listenFrequencyHz:149125000,hasSamples:true,powerDbfs:-56};ui.emit();
  assert.equal(ui.dialog.querySelector('[data-register-observation]').hidden,false);
  await slot(1).click();assert.equal(ui.plugin.starts.length,2,'same-frequency selection must not restart audio');
});

test('disconnect while a live card switch is stopping prevents a new reception request', async () => {
  const ui=setup(true,'injected',false,animalCatalog());ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  const slots=()=>ui.dialog.querySelector('[data-animal-list]').children[0].children[2].children;
  await slots()[0].click();await ui.dialog.querySelector('[data-start]').click();
  ui.state.receptionState='receiving';ui.state.reception={mode:'cw',listenFrequencyHz:148241500};ui.emit();
  let release;ui.plugin.stopReception=()=>new Promise(resolve=>{release=resolve;});
  const switching=slots()[1].click();await tick();
  ui.state.state='idle';ui.state.receptionState='idle';ui.state.devices=[];ui.emit();release();await switching;
  assert.equal(ui.plugin.starts.length,1);
});


test('favorites persist by code on this device and combine with code search without changing reception', async () => {
  const saved=new Map(),storage={getItem:key=>saved.get(key)||null,setItem:(key,value)=>saved.set(key,value)};
  const ui=setup(true,'injected',false,animalCatalog(),storage);ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  const list=ui.dialog.querySelector('[data-animal-list]'),filter=ui.dialog.querySelector('[data-animal-favorites-filter]');
  await list.children[0].children[2].children[0].click();await ui.dialog.querySelector('[data-start]').click();
  ui.state.receptionState='receiving';ui.state.reception={listenFrequencyHz:148241500};ui.emit();
  const previousStarts=ui.plugin.starts.length;
  await list.children[0].children[3].click();
  assert.deepEqual(JSON.parse(saved.get('bearpoint.sdrAnimalFavorites.v1')),['KF-110']);
  assert.equal(list.children[0].children[3].textContent,'\u2605');
  await filter.click();assert.equal(list.children.length,1);assert.equal(list.children[0].children[0].textContent,'KF-110');
  const search=ui.dialog.querySelector('[data-animal-search]');search.value='112';search.events.input();
  assert.equal(list.children[0].children.length,0,'search must stay inside the favorite set');
  search.value='';search.events.input();await list.children[0].children[3].click();
  assert.equal(list.children[0].children.length,0,'removing the last favorite updates the filtered list');
  assert.equal(ui.plugin.starts.length,previousStarts);assert.equal(ui.state.receptionState,'receiving');
  await filter.click();await list.children[0].children[3].click();
  const changedCatalog={formatHz:hz=>String(hz/1e6),load:async()=>{const result=await animalCatalog().load();result.items[0].id='999';result.items[0].frequencies[0].hz=148900000;return result;}};
  const restored=setup(true,'injected',false,changedCatalog,storage);restored.device.hasPermission=true;
  await restored.trigger.click();await restored.button().click();await tick();
  assert.equal(restored.dialog.querySelector('[data-animal-list]').children[0].children[3].textContent,'\u2605');
  const other=setup(true,'injected',false,animalCatalog(),{getItem:()=>null,setItem(){}});other.device.hasPermission=true;
  await other.trigger.click();await other.button().click();await tick();
  assert.equal(other.dialog.querySelector('[data-animal-list]').children[0].children[3].textContent,'\u2606');
});

test('invalid favorite storage does not stop the receiver and failed writes do not claim a saved favorite', async () => {
  const ui=setup(true,'injected',false,animalCatalog(),{getItem:()=>'{broken',setItem(){throw Error('quota');}});ui.device.hasPermission=true;
  await ui.trigger.click();await ui.button().click();await tick();
  const star=ui.dialog.querySelector('[data-animal-list]').children[0].children[3];
  assert.equal(star.textContent,'\u2606');await star.click();assert.equal(star.textContent,'\u2606');
  assert.ok(ui.dialog.querySelector('.sdr-message').textContent);
  assert.equal(ui.state.state,'connected');assert.equal(ui.plugin.starts.length,0);
});


test('frequency Done, final Tab and Android line-break actions exit editing without advancing to tuning inputs', async () => {
  const ui=setup();ui.device.hasPermission=true;await ui.trigger.click();await ui.button().click();
  const edit=ui.dialog.querySelector('[data-frequency-edit]'),first=ui.dialog.querySelector('[data-freq-digit="0"]'),last=ui.dialog.querySelector('[data-freq-digit="7"]');
  let blurs=0,prevented=0,tuningFocus=0;last.blur=()=>{blurs++;};
  ui.dialog.querySelector('[data-gain]').focus=ui.dialog.querySelector('[data-ppm]').focus=()=>{tuningFocus++;};
  for(const action of ['Enter','Tab','lineBreak']){
    await edit.click();
    if(action==='lineBreak')first.events.beforeinput({inputType:'insertParagraph',preventDefault(){prevented++;}});
    else last.events.keydown({key:action,preventDefault(){prevented++;}});
    assert.equal(edit.textContent,'\uC9C1\uC811 \uC785\uB825');
  }
  assert.equal(blurs,3);assert.equal(prevented,3);assert.equal(tuningFocus,0);
  await edit.click();ui.dialog.querySelector('[data-frequency]').value='0';last.textContent='0';last.events.input();
  assert.equal(edit.textContent,'\uC644\uB8CC');assert.equal(blurs,3,'invalid frequency should remain editable');
});
