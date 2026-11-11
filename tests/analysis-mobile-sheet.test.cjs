const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

function setup(){
  function element(){
    const attributes=new Set(),classes=new Set();
    return {parentNode:null,children:[],style:{setProperty(key,value){this[key]=value;}},
      classList:{contains:key=>classes.has(key),toggle(key,value){value?classes.add(key):classes.delete(key);}},
      hasAttribute:key=>attributes.has(key),setAttribute:key=>attributes.add(key),removeAttribute:key=>attributes.delete(key),
      appendChild(node){node.parentNode=this;this.children.push(node);},
      contains(node){return this.children.includes(node);},getBoundingClientRect:()=>({top:500}),querySelectorAll(){return this.children;}};
  }
  const body=element(),dock=element(),panel=element(),overlay=element(),home=element(),save=element(),html=element();
  home.appendChild(save);
  const events={},viewportEvents={},documentEvents={};
  const media={matches:true,addEventListener(type,fn){this.change=fn;}};
  const root={innerHeight:800,matchMedia:()=>media,addEventListener(type,fn){events[type]=fn;},
    visualViewport:{height:800,offsetTop:0,addEventListener(type,fn){viewportEvents[type]=fn;}}};
  const document={body,documentElement:html,activeElement:null,
    getElementById:id=>({'mobile-map-dock':dock,'analysis-dialog-panel':panel,'analysis-dialog-overlay':overlay}[id]),
    addEventListener(type,fn){documentEvents[type]=fn;}};
  vm.runInNewContext(fs.readFileSync('public/js/analysis-mobile-sheet.js','utf8'),{window:root,document});
  return {root,document,body,dock,panel,save,home,html,media,viewportEvents,documentEvents};
}

test('phone sheets track the keyboard, block the list, and restore the tablet overlay parent',()=>{
  const e=setup(),api=e.root.BearAnalysisSheet;
  api.registerSave(e.save);
  assert.equal(e.save.parentNode,e.body);
  api.setStage('analysis');
  assert.equal(e.body.classList.contains('analysis-mobile-active'),true);
  assert.equal(e.dock.hasAttribute('inert'),true);
  e.root.visualViewport.height=480;e.viewportEvents.resize();
  assert.equal(e.html.style['--analysis-keyboard-bottom'],'320px');
  assert.equal(e.html.style['--analysis-visible-height'],'480px');
  api.setStage('save');api.closeStage('analysis');
  assert.equal(e.body.classList.contains('analysis-mobile-active'),true);
  e.media.matches=false;e.media.change();
  assert.equal(e.save.parentNode,e.home);
  assert.equal(e.body.classList.contains('analysis-mobile-active'),false);
  assert.equal(e.dock.hasAttribute('inert'),false);
  e.media.matches=true;e.media.change();api.closeStage('save');
  assert.equal(e.body.classList.contains('analysis-mobile-active'),false);
});

test('background inputs lose focus and Tab remains inside the active phone sheet',()=>{
  const e=setup();let blurred=0,focused=0,prevented=0;
  const field={disabled:false,tabIndex:0,getClientRects:()=>[{}],focus(){focused++;}};
  e.panel.children.push(field);e.root.BearAnalysisSheet.setStage('analysis');
  e.documentEvents.focusin({target:{matches:()=>true,blur(){blurred++;}}});
  assert.equal(blurred,1);
  e.document.activeElement=field;
  e.documentEvents.keydown({key:'Tab',preventDefault(){prevented++;}});
  assert.equal(prevented,1);assert.equal(focused,1);
});

test('a previously inert list stays inert when the analysis sheet closes',()=>{
  const e=setup();e.dock.setAttribute('inert','');
  e.root.BearAnalysisSheet.setStage('analysis');e.root.BearAnalysisSheet.closeStage('analysis');
  assert.equal(e.dock.hasAttribute('inert'),true);
});

test('back cancels the active analysis or save stage once instead of falling through to app exit',()=>{
  const e=setup(),api=e.root.BearAnalysisSheet;
  assert.equal(api.handleBack(),false);
  for(const stage of ['analysis','save']){
    let cancelled=0;
    api.setStage(stage,()=>{cancelled++;api.closeStage(stage);});
    assert.equal(api.handleBack(),true);
    assert.equal(cancelled,1);
    assert.equal(api.handleBack(),false);
    assert.equal(e.body.classList.contains('analysis-mobile-active'),false);
  }
});
