const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const expectedVersion=fs.readFileSync('android/app/build.gradle','utf8').match(/versionName "([^"]+)"/)[1];
function fixture(){
  const events={},documentEvents={},copied=[];
  let document;
  class Element{
    constructor(){this.children=[];this.dataset={};this.style={};this.events={};}
    setAttribute(){} append(...items){this.children.push(...items);} appendChild(item){this.append(item);}
    addEventListener(name,fn){this.events[name]=fn;}
    querySelector(){return this.children.find(e=>Object.hasOwn(e.dataset,'errorDetail'));}
    remove(){document.body.children=document.body.children.filter(e=>e!==this);}
  }
  document={body:null,createElement:()=>new Element(),getElementById:id=>document.body?.children.find(e=>e.id===id),addEventListener:(n,f)=>{documentEvents[n]=f;}};
  const window={location:{href:'https://localhost/'},navigator:{clipboard:{writeText:async text=>copied.push(text)}},addEventListener:(n,f)=>{events[n]=f;}};
  vm.runInNewContext(fs.readFileSync('public/js/startup-diagnostics.js','utf8'),{window,document,URL});
  return {window,document,events,copied,ready(){document.body=new Element();documentEvents.DOMContentLoaded();}};
}
test('healthy startup stays unobstructed and exposes an identifiable build',()=>{
  const f=fixture();f.ready();assert.equal(f.window.BEAR_BUILD_VERSION,expectedVersion);
  assert.equal(f.document.body.children.length,0);
});
test('an early native bridge error is shown after body creation with script location but no URL query',async()=>{
  const f=fixture();
  const event={message:'Capacitor.registerPlugin is not a function',filename:'https://localhost/js/tracking/gps-track-ui.js?secret=omit',lineno:5,colno:30};
  f.events.error(event);f.events.error(event);f.ready();
  const box=f.document.getElementById('app-startup-error');
  assert.equal(f.document.body.children.length,1);
  const text=box.querySelector().textContent;
  assert.match(text,/registerPlugin is not a function/);assert.match(text,/gps-track-ui.js:5:30/);
  assert.doesNotMatch(text,/secret|https:/);
  await box.children[2].events.click();assert.ok(f.copied[0].includes(expectedVersion));
  assert.equal(f.copied[0].match(/registerPlugin/g).length,1);
});
test('unhandled rejections preserve error stack location and resource failures do not create blank alerts',()=>{
  const f=fixture();f.ready();f.events.error({});assert.equal(f.document.body.children.length,0);
  f.events.unhandledrejection({reason:{message:'Bridge failed',stack:'Error: Bridge failed\n at start (https://localhost/js/example.js:42:17)'}});
  assert.match(f.document.getElementById('app-startup-error').querySelector().textContent,/example.js:42:17/);
});
