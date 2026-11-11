const {test}=require('node:test');
const assert=require('node:assert/strict');
const model=require('../public/js/realtime/estimate-history-model');
const filters=require('../public/js/obs/observation-filters');

test('history keeps inactive records, excludes deletions and invalid geometry, and orders by recorded time',()=>{
  const row={id:'current',lat:35,lng:127,created_at:'2026-11-11 00:10:00',estimation_method:'intersection'};
  const items=model.normalize([row,{...row,id:'past',active:false,created_at:'2026-11-10 23:00:00'},
    {...row,id:'deleted',use_yn:false},{...row,id:'bad',lng:999},{...row,id:'bad-time',created_at:'invalid'}]);
  assert.deepEqual(items.map(item=>item.id),['past','current']);
  assert.equal(items[1].iso,'2026-11-10T15:10:00.000Z');
  assert.equal(items[1].method,'intersection');
  assert.deepEqual(model.filter(items,{period:'day',day:'2026-11-11'},filters).map(item=>item.id),['current']);
});
test('period ranges are inclusive and a code with one point still has a valid detail',()=>{
  const items=model.normalize([{id:'one',lat:0,lng:0,created_at:'2026-11-01T12:00:00+09:00',estimation_method:'single'}]);
  assert.equal(items[0].method,'single');
  assert.equal(model.filter(items,{period:'range',start:'2026-11-01',end:'2026-11-01'},filters).length,1);
  assert.equal(model.filter(items,{period:'range',start:'2026-11-02',end:'2026-11-01'},filters).length,0);
});

test('coincident records stay together while nearby points separate as the map zooms in',()=>{
  const points=[[0,0],[5,0],[100,0],[0,0]];
  const coarse=model.groupPoints(points,1);
  assert.deepEqual(coarse.map(group=>group.indices).sort((a,b)=>a[0]-b[0]),[[0,1,3],[2]]);
  const fine=model.groupPoints(points,.1);
  assert.deepEqual(fine.map(group=>group.indices).sort((a,b)=>a[0]-b[0]),[[0,3],[1],[2]]);
  for(const group of coarse)assert.ok(points.includes(group.coordinate));
});
test('hundreds of identical positions are not lost or moved when grouped',()=>{
  const points=Array.from({length:500},()=>[127,35]);
  const groups=model.groupPoints(points,.00001);
  assert.equal(groups.length,1);assert.equal(groups[0].indices.length,500);
  assert.deepEqual(groups[0].coordinate,[127,35]);
  assert.deepEqual(groups[0].indices,Array.from({length:500},(_,index)=>index));
});
