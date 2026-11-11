const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('date fields open platform pickers and unsupported or disabled controls retain their normal behavior',()=>{
  const source=fs.readFileSync('public/js/client-ol.js','utf8');
  const start=source.indexOf('  document.addEventListener("click", function openListDatePicker');
  const end=source.indexOf('\n  // Close details',start);
  let click,count=0;
  vm.runInNewContext(source.slice(start,end),{document:{addEventListener(_type,fn){click=fn;}}});
  click({target:{matches:()=>true,showPicker(){count++;}}});assert.equal(count,1);
  click({target:{matches:()=>true,disabled:true,showPicker(){count++;}}});assert.equal(count,1);
  click({target:{matches:()=>false,showPicker(){count++;}}});assert.equal(count,1);
  assert.doesNotThrow(()=>click({target:{matches:()=>true}}));
  assert.doesNotThrow(()=>click({target:{matches:()=>true,showPicker(){throw new Error('unsupported');}}}));
});
