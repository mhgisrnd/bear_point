const {test}=require('node:test');
const assert=require('node:assert/strict');
const {badge,single,hitIndex}=require('../public/js/realtime/estimate-history-markers');
test('overlap numbers have individual circles and current has its own label position',()=>{
  const marker=badge([0,3],0,3);
  assert.deepEqual(marker.shown,[0,3]);
  assert.equal((marker.svg.match(/<circle /g)||[]).length,2);
  assert.match(marker.svg,/>1<\/text>/);assert.match(marker.svg,/>4<\/text>/);
  assert.doesNotMatch(marker.svg,/1[·-]4/);
  assert.ok(marker.currentOffsetX>0);
});
test('large groups retain selected and current numbers and summarize the remainder',()=>{
  const marker=badge(Array.from({length:500},(_,index)=>index),498,499);
  assert.deepEqual(marker.shown,[0,498,499]);
  assert.match(marker.svg,/>499<\/text>/);assert.match(marker.svg,/>500<\/text>/);
  assert.match(marker.svg,/>\+497<\/text>/);assert.ok(marker.width<150);
});
test('each circle has an independent hit area and the gap opens the group rather than a wrong record',()=>{
  const marker=badge([0,3],0,3);
  assert.equal(hitIndex(marker,18,20),0);assert.equal(hitIndex(marker,50,20),3);
  assert.equal(hitIndex(marker,34,20),null);assert.equal(hitIndex(marker,18,42),null);
});
test('standalone, current and grouped circles share size, border width and typography',()=>{
  for(const marker of [single(0,0,3),single(1,0,3),single(3,0,3),badge([0,3],0,3)]){
    const circles=marker.svg.match(/<circle[^>]+>/g);
    for(const circle of circles){assert.match(circle,/r="11"/);assert.match(circle,/stroke-width="1.5"/);}
    assert.match(marker.svg,/font-family="system-ui, sans-serif" font-size="11" font-weight="700"/);
  }
});
test('current keeps its number and uses teal independently of the blue selected history',()=>{
  const current=single(3,3,3).svg,selected=single(0,0,3).svg;
  assert.match(current,/fill="#0f9f88"/);assert.match(current,/>4<\/text>/);
  assert.match(selected,/fill="#2563eb"/);
  const grouped=badge([0,3],0,3).svg;assert.match(grouped,/fill="#e7f7f2"/);assert.match(grouped,/stroke="#0f9f88"/);
});
