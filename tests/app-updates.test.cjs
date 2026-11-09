const {test}=require('node:test');
const assert=require('node:assert/strict');
const {endpoint,createController}=require('../public/js/settings/app-updates');
const url='https://example.test/api/app-updates/latest';
const update={versionCode:7,versionName:'26.0.1',fileSha256:'a'.repeat(64),fileSize:1024};

test('update endpoint preserves server context and rejects insecure or credentialed URLs',()=>{
  assert.equal(endpoint({realtimeApiBase:'https://example.test/context/api/realtime'}),'https://example.test/context/api/app-updates/latest');
  assert.equal(endpoint({appUpdateApiUrl:url}),url);
  for(const value of ['http://example.test/api/app-updates/latest','https://user:pass@example.test/api/app-updates/latest',url+'?x=1','https://example.test/api/realtime'])assert.throws(()=>endpoint({appUpdateApiUrl:value}));
});

test('checking never downloads without consent; verified download carries the selected hash and permission retry retains it',async()=>{
  const calls=[];
  const plugin={getInfo:async()=>({versionName:'26.0.0.1',versionCode:6}),check:async()=>({versionCode:6,update}),
    download:async input=>calls.push(input),install:async()=>({permissionRequired:true})};
  const controller=createController(plugin,url);
  await controller.initialize();assert.equal(await controller.check(),true);assert.equal(calls.length,0);
  assert.equal(await controller.download(),true);assert.deepEqual(calls,[{apiUrl:url,sha256:update.fileSha256}]);
  await controller.install();assert.equal(controller.snapshot().phase,'ready');
  assert.match(controller.snapshot().message,/허용/);
  plugin.install=async()=>({installerOpened:true});await controller.install();assert.match(controller.snapshot().message,/설치 화면/);
  plugin.check=async()=>({versionCode:6,update:{...update,fileSha256:'b'.repeat(64)}});
  await controller.check();assert.equal(controller.snapshot().readyHash,null);assert.equal(controller.snapshot().phase,'idle');
});

test('download errors, cancellation and duplicate actions do not trigger installation or claim success',async()=>{
  let rejectDownload,downloads=0,cancels=0,installs=0;
  const plugin={check:async()=>({update}),download:()=>{downloads++;return new Promise((_,reject)=>{rejectDownload=reject;});},
    cancelDownload:async()=>{cancels++;rejectDownload(new Error('다운로드를 취소했습니다.'));},install:async()=>{installs++;}};
  const controller=createController(plugin,url);await controller.check();
  const pending=controller.download();controller.progress({received:500,total:1024});
  assert.equal(controller.snapshot().received,500);assert.equal(await controller.download(),false);
  assert.equal(await controller.check(),false);await controller.install();assert.equal(installs,0);
  await controller.cancel();assert.equal(await pending,false);assert.equal(downloads,1);assert.equal(cancels,1);
  assert.equal(controller.snapshot().phase,'idle');assert.match(controller.snapshot().message,/취소/);
});

test('offline checks and no-update responses allow manual retry without retaining an old offer',async()=>{
  const plugin={check:async()=>({update})};const controller=createController(plugin,url);
  await controller.check();plugin.check=async()=>{throw new Error('offline');};
  assert.equal(await controller.check(),false);assert.equal(controller.snapshot().update,null);
  plugin.check=async()=>({versionCode:7,update:null});assert.equal(await controller.check(),false);
  assert.match(controller.snapshot().message,/새 업데이트가 없습니다/);
});
