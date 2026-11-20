const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

test('map marker details do not reopen or change the previously viewed list',()=>{
  const source=fs.readFileSync('public/js/client-ol.js','utf8');
  for(const kind of ['observationData','bearEstimateData']){
    let listChanges=0,placed=null,revealed=null;
    const data={id:'record-1'},coordinate=[127,35];
    const feature={get:key=>key==='popupHtml'?'<div>detail</div>':key===kind?data:null,
      getGeometry:()=>({getCoordinates:()=>coordinate})};
    const context=vm.createContext({
      window:{BearMobileDock:{prepareDetail(){listChanges++;},select(){listChanges++;}}},
      obsListModule:{revealItem:id=>{revealed=id;}},bearListPages:{reveal:id=>{revealed=id;}},
      observationPopupEl:{style:{}},observationPopupContentEl:{innerHTML:'',querySelector:()=>null},observationPopupTitleEl:{},
      observationPopupHistoryEl:{hidden:true},
      focusedObservationId:null,observationMarkerSource:{changed(){}},
      observationPopupOverlay:{setPosition:value=>placed=value},syncObservationPopupPlacement(){}
    });
    vm.runInContext(source.slice(source.indexOf('  function openObservationPopup('),source.indexOf('  let bearListFocusVersion')),context);
    context.openObservationPopup(feature);
    assert.equal(listChanges,0);
    assert.equal(context.observationPopupEl.style.visibility,'visible');
    assert.equal(context.observationPopupContentEl.innerHTML,'<div>detail</div>');
    assert.equal(placed,coordinate);
    assert.equal(revealed,'record-1');
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
