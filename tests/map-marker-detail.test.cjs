const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');

test('map marker details do not reopen or change the previously viewed list',()=>{
  const source=fs.readFileSync('public/js/client-ol.js','utf8');
  for(const kind of ['observationData','bearEstimateData']){
    let listChanges=0,placed=null;
    const data={id:'record-1'},coordinate=[127,35];
    const feature={get:key=>key==='popupHtml'?'<div>detail</div>':key===kind?data:null,
      getGeometry:()=>({getCoordinates:()=>coordinate})};
    const context=vm.createContext({
      window:{BearMobileDock:{prepareDetail(){listChanges++;},select(){listChanges++;}}},
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
  }
});
