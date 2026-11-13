const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('public/js/tracking/gps-track-ui.js','utf8');
test('tracking status uses the shared toast without permanent list rows or repeated polling notices',()=>{
  const notices=[],context=vm.createContext({root:{__bpShowToast:text=>notices.push(text)}});
  const start=source.indexOf('    function createNoticeChannel()');
  vm.runInContext(source.slice(start,source.indexOf('    const message=',start)),context);
  const channel=context.createNoticeChannel();
  channel.textContent='이동 기록을 저장하지 않고 종료했습니다.';
  channel.textContent='이동 기록을 저장하지 않고 종료했습니다.';
  assert.equal(notices.length,1);
  channel.textContent='';assert.equal(notices.length,1);
  channel.textContent='GPS 수신 대기';assert.equal(notices.length,2);
  assert.doesNotMatch(source,/class="gps-track-(?:sync-)?message"/);
});
