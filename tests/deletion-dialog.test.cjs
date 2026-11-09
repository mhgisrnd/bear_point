const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const client=fs.readFileSync('public/js/client-ol.js','utf8');
const observations=fs.readFileSync('public/js/obs/obsList.js','utf8');

function dialogFixture() {
  let registered=0,unregistered=0;
  const buttons=[];
  const document={activeElement:null};
  function element(tag) {
    return {tag,style:{},children:[],listeners:{},attributes:{},parentNode:null,
      setAttribute(key,value){this.attributes[key]=value;},
      appendChild(child){this.children.push(child);child.parentNode=this;},
      removeChild(child){this.children.splice(this.children.indexOf(child),1);child.parentNode=null;},
      addEventListener(type,listener){this.listeners[type]=listener;},
      showModal(){assert.equal(this.tag,'dialog');this.open=true;this.topLayer=true;},
      close(){this.open=false;},focus(){document.activeElement=this;}
    };
  }
  document.body=element('body');
  document.createElement=tag=>{const node=element(tag);if(tag==='button')buttons.push(node);return node;};
  const trigger=element('button');trigger.isConnected=true;document.activeElement=trigger;
  const context=vm.createContext({document,Promise,registerBackClosableOverlay:()=>{registered++;return ()=>{unregistered++;};}});
  const start=client.indexOf('  let styledConfirmPending'),end=client.indexOf('  window.__bpShowConfirmDialog',start);
  vm.runInContext(client.slice(start,end),context);
  return {context,document,buttons,trigger,counts:()=>({registered,unregistered})};
}
test('confirmation uses native top layer and rejects repeated opens without confirming another action',async()=>{
  const f=dialogFixture(),c=f.context;
  const first=c.showStyledConfirmDialog({title:'삭제 확인',confirmText:'삭제'});
  const dialog=f.document.body.children[0];
  assert.equal(dialog.tag,'dialog');assert.equal(dialog.topLayer,true);assert.equal(dialog.attributes.role,'alertdialog');
  assert.equal(f.document.activeElement.textContent,'취소');
  assert.equal(await c.showStyledConfirmDialog({title:'Other delete'}),false);
  assert.equal(f.document.body.children.length,1);
  f.buttons[1].listeners.click();f.buttons[1].listeners.click();
  assert.equal(await first,true);assert.equal(f.document.body.children.length,0);
  assert.equal(f.document.activeElement,f.trigger);assert.deepEqual(f.counts(),{registered:1,unregistered:1});
  const next=c.showStyledConfirmDialog({});
  const nextDialog=f.document.body.children[0];let prevented=false;
  nextDialog.listeners.cancel({preventDefault(){prevented=true;}});
  assert.equal(await next,false);assert.equal(prevented,true);assert.equal(f.document.body.children.length,0);
});
test('Enter on the cancel button is not overridden into destructive confirmation',async()=>{
  const f=dialogFixture();let settled=false;
  const result=f.context.showStyledConfirmDialog({}).then(value=>{settled=true;return value;});
  const card=f.document.body.children[0].children[0];
  card.listeners.keydown({key:'Enter',preventDefault(){throw new Error('Native button activation should handle Enter');}});
  await Promise.resolve();assert.equal(settled,false);
  f.buttons[0].listeners.click();assert.equal(await result,false);
});

function extractFunction(source,name) {
  const start=source.indexOf('  async function '+name+'(');
  return source.slice(start,source.indexOf('\n  }',start)+4);
}
test('observation deletion locks popup, row and bulk requests through confirmation and pending server removal',async()=>{
  let answer,finishRemoval,removalBegan;
  const started=new Promise(resolve=>{removalBegan=resolve;});
  const network=new Promise(resolve=>{finishRemoval=resolve;});
  const item={id:'obs',_obsKey:'key',shareState:'local'};
  let confirmations=0,removals=0,closed=0;
  const noop=()=>{};
  const c=vm.createContext({statusEl:{},observationSamples:[item],selectedObsIds:new Set(['key']),
    isShared:()=>false,confirmWithStyledDialog:()=>{confirmations++;return new Promise(resolve=>{answer=resolve;});},
    window:{BearObservationSync:{assertEditable:async()=>{},remove:async()=>{removals++;removalBegan();await network;}}},
    map:{closePopup(){closed++;}},applySearch:noop,renderObservationMarkers:noop,getFilteredItems:()=>[],
    updateSelectionUI:noop,updateObservationSummary:noop,updateMainStatusForList:noop,refreshObservationData:async()=>{}});
  vm.runInContext('let observationDeletionPending=false;'+extractFunction(observations,'deleteObservations')+extractFunction(observations,'performObservationDeletion'),c);
  const first=c.deleteObservations([item]);
  assert.equal((await c.deleteObservations([item])).confirmed,false);assert.equal(confirmations,1);
  answer(true);await started;
  assert.equal((await c.deleteObservations([item])).confirmed,false);assert.equal(confirmations,1);assert.equal(removals,1);
  finishRemoval();assert.equal((await first).confirmed,true);assert.equal(closed,1);assert.equal(c.observationSamples.length,0);
  const retry=c.deleteObservations([item]);answer(false);assert.equal((await retry).confirmed,false);assert.equal(confirmations,2);
});
test('tracking deletion is available through the selection toolbar only',()=>{
  const html=fs.readFileSync('public/index.html','utf8');
  assert.match(html,/id="btn-delete-selected"/);
  assert.match(html,/id="btn-bears-delete-unshared" type="button" hidden disabled/);
  assert.doesNotMatch(client,/data-bear-action="delete"|DELETE FROM bear_estimates/);
});
test('tracking deletion protects shared, remote and uploading rows even when sharing changes during confirmation',async()=>{
  const rows=[{id:'draft'},{id:'shared',shared_at:'now'},{id:'remote',remoteOnly:true},
    {id:'receipt'},{id:'uploading'},{id:'changed'}];
  const removed=[];
  const context=vm.createContext({
    currentBearEstimateItems:rows,selectedBearEstimateIds:new Set(rows.map(row=>row.id)),
    remoteSharedEstimateIds:new Set(['receipt']),pendingBearUploads:new Set(['uploading']),
    pendingBearDeletions:new Set(),statusEl:{},
    showStyledConfirmDialog:async({message})=>{
      assert.match(message,/2건/);
      rows.find(row=>row.id==='changed').shared_at='just shared';
      return true;
    },
    localEstimateStore:{async removeUnshared(ids){removed.push(...ids);return ids.length;}},
    async refreshBearEstimatePanel(){},repaintUnifiedBearList(){}
  });
  const start=client.indexOf('  function canModifyUnsharedBearEstimate(');
  vm.runInContext(client.slice(start,client.indexOf('  async function downloadAllBearEstimatesXls(',start)),context);
  await context.deleteSelectedUnsharedBearEstimates();
  assert.deepEqual(removed,['draft']);
  assert.equal(context.selectedBearEstimateIds.has('shared'),true);
  assert.equal(context.pendingBearDeletions.size,0);
  assert.match(context.statusEl.textContent,/1건/);
});
