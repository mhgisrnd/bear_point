const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

test('detail actions stay outside the scroll body and are replaced when the selection changes',()=>{
  const source=fs.readFileSync('public/js/client-ol.js','utf8');
  const start=source.indexOf('  function syncObservationPopupFooter()');
  let actions={kind:'downloads'};
  const footer={hidden:true,children:[],replaceChildren(...children){this.children=children;}};
  const context=vm.createContext({
    observationPopupContentEl:{querySelector:()=>actions},observationPopupFooterEl:footer
  });
  vm.runInContext(source.slice(start,source.indexOf('  const observationPopupHistoryEl',start)),context);
  context.syncObservationPopupFooter();
  assert.equal(footer.hidden,false);
  assert.equal(footer.children[0],actions);
  actions={kind:'edit'};
  context.syncObservationPopupFooter();
  assert.equal(footer.children.length,1);
  assert.equal(footer.children[0],actions);
  actions=null;
  context.syncObservationPopupFooter();
  assert.equal(footer.hidden,true);
  assert.equal(footer.children.length,0);
});

test('landscape keeps details only for folding the same menu and closes them when switching lists',()=>{
  const source=fs.readFileSync('public/js/client-ol.js','utf8');
  const start=source.indexOf('    onBeforeOpen: function (navigation = {}) {');
  const end=source.indexOf('    } });',start)+'    }'.length;
  let closed=0;
  const context={window:{innerWidth:1180,innerHeight:820},view:{cancelAnimations(){}},closeObservationPopup(){closed++;},controlsManager:{deactivateMeasure(){}}};
  const callback=vm.runInNewContext('({'+source.slice(start,end)+'}).onBeforeOpen',context);
  callback({previousMenu:'bears',menu:'bears'});assert.equal(closed,0);
  callback();assert.equal(closed,0);
  for(const menu of ['observations','tracking','settings'])callback({previousMenu:'bears',menu});
  assert.equal(closed,3);
  context.window.innerWidth=390;context.window.innerHeight=844;
  callback({previousMenu:'bears',menu:'bears'});assert.equal(closed,4);
});

test('map marker details do not reopen or change the previously viewed list',()=>{
  const source=fs.readFileSync('public/js/client-ol.js','utf8');
  for(const kind of ['observationData','bearEstimateData']){
    let listChanges=0,placed=null,revealed=null,highlighted=null;
    const data={id:'record-1'},coordinate=[127,35];
    const feature={get:key=>key==='popupHtml'?'<div>detail</div>':key===kind?data:null,
      getGeometry:()=>({getCoordinates:()=>coordinate})};
    const context=vm.createContext({
      window:{BearMobileDock:{prepareDetail(){listChanges++;},select(){listChanges++;}}},
      obsListModule:{revealItem:id=>{revealed=id;}},bearListPages:{reveal:id=>{revealed=id;}},
      highlightBearEstimate:id=>{highlighted=id;},
      observationPopupEl:{style:{}},observationPopupContentEl:{innerHTML:'',querySelector:()=>null},observationPopupTitleEl:{},
      observationPopupHistoryEl:{hidden:true},
      focusedObservationId:null,observationMarkerSource:{changed(){}},
      observationPopupOverlay:{setPosition:value=>placed=value},syncObservationPopupPlacement(){},syncObservationPopupFooter(){}
    });
    vm.runInContext(source.slice(source.indexOf('  function openObservationPopup('),source.indexOf('  let bearListFocusVersion')),context);
    context.openObservationPopup(feature);
    assert.equal(listChanges,0);
    assert.equal(context.observationPopupEl.style.visibility,'visible');
    assert.equal(context.observationPopupContentEl.innerHTML,'<div>detail</div>');
    assert.equal(placed,coordinate);
    assert.equal(revealed,'record-1');
    assert.equal(highlighted,kind==='bearEstimateData'?'record-1':null);
  }
});

test('movement path selection scrolls its matching history row without reloading or changing filters',()=>{
  const source=fs.readFileSync('public/js/tracking/gps-track-ui.js','utf8');
  const feature={},row={dataset:{trackId:'route'}},frame={};let revealed=0;
  const context=vm.createContext({root:{BearProgressiveList:{scrollRow:(target,boundary)=>{assert.equal(target,row);assert.equal(boundary,frame);revealed++;return true;}}},
    history:{querySelectorAll:()=>[row]},panel:{querySelector:()=>frame},displayed:{id:'route'},source:{hasFeature:value=>value===feature}});
  const start=source.indexOf('    let pendingHistoryRow=');
  vm.runInContext(source.slice(start,source.indexOf('    function draw(',start)),context);
  assert.equal(context.revealFeature({}),false);assert.equal(revealed,0);
  assert.equal(context.revealFeature(feature),true);assert.equal(revealed,1);
  assert.equal(context.displayed.id,'route');
});
