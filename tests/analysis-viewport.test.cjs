const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const context={window:{}};
vm.runInNewContext(fs.readFileSync('public/js/analysis/analysis-viewport.js','utf8'),context);
const extent=(...args)=>Array.from(context.window.BearAnalysisViewport.extent(...args)||[]);

test('single observation shows the whole configured distance area, including the ray endpoint',()=>{
  assert.deepEqual(extent([[100,200]],[[8100,200]],[],8000),[-7900,-7800,8100,8200]);
  assert.deepEqual(extent([[100,200]],[[1100,200]],[],1000),[-900,-800,1100,1200]);
});
test('intersection stays centered while all observation points remain inside the frame',()=>{
  const bounds=extent([[0,0],[100,0]],[[8000,0],[0,8000]],[[30,40]],8000);
  assert.deepEqual(bounds,[-40,0,100,80]);
  assert.equal((bounds[0]+bounds[2])/2,30);
  assert.equal((bounds[1]+bounds[3])/2,40);
});
test('multiple intersections use their average and no intersection shows the candidate rays',()=>{
  assert.deepEqual(extent([[0,0],[100,0]],[],[[20,40],[40,60]],8000),[-40,0,100,100]);
  assert.deepEqual(extent([[0,0],[100,0]],[[1000,0],[100,1000]],[],1000),[0,0,1000,1000]);
  assert.deepEqual(extent([],[],[],1000),[]);
});
