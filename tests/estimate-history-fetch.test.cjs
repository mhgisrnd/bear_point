const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('public/js/realtime/realtimeList.js','utf8');
const method=source.slice(source.indexOf('      async fetchHistory('),source.indexOf('      sendEstimates,',source.indexOf('      async fetchHistory(')));
function setup(requestJson){return vm.runInNewContext('({'+method+'})',{requestJson,URLSearchParams}).fetchHistory;}

test('history fetch collects several hundred archived positions without the main list limit',async()=>{
  const requested=[];
  const fetchHistory=setup(async url=>{
    const params=new URL(url,'https://example.test').searchParams;
    const page=Number(params.get('page'));requested.push(page);
    assert.equal(params.get('bearCode'),'MH-001');
    return {total:240,items:Array.from({length:page===3?40:100},(_,i)=>({id:String((page-1)*100+i),active:false}))};
  });
  const rows=await fetchHistory('MH-001',new AbortController().signal);
  assert.equal(rows.length,240);assert.deepEqual(requested,[1,2,3]);
});
test('incomplete pagination and cancelled requests do not silently report a complete history',async()=>{
  let requests=0;
  const fetchHistory=setup(async()=>{requests++;return {total:2,items:[{id:'one'}]};});
  await assert.rejects(()=>fetchHistory('MH-001'),/완료되지/);assert.equal(requests,2);
  const controller=new AbortController();controller.abort();
  await assert.rejects(()=>fetchHistory('MH-001',controller.signal),/취소/);assert.equal(requests,2);
});
