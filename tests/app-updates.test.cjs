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

test('recreated webview restores a verified APK and continues installation without another download',async()=>{
  let downloads=0,installs=0;
  const plugin={getInfo:async()=>({versionCode:6,versionName:'26.0.0.1',update,downloadReady:true}),
    check:async()=>({versionCode:6,update,downloadReady:true}),download:async()=>{downloads++;},install:async()=>{installs++;return {cancelled:true};}};
  const controller=createController(plugin,url);
  assert.equal(await controller.initialize(),true);assert.equal(controller.snapshot().phase,'ready');
  assert.equal(controller.snapshot().readyHash,update.fileSha256);
  await controller.install();assert.equal(downloads,0);assert.equal(installs,1);
  assert.match(controller.snapshot().message,/취소/);
  const recreated=createController(plugin,url);await recreated.check();
  assert.equal(recreated.snapshot().phase,'ready');await recreated.install();assert.equal(installs,2);
  plugin.check=async()=>({versionCode:6,update,downloadReady:false});await recreated.check();
  assert.equal(recreated.snapshot().phase,'idle');assert.equal(recreated.snapshot().readyHash,null);
});

test('resume does not interfere with a pending Android activity result and missing cache enables download retry',async()=>{
  let finishInstall,infoCalls=0;
  const plugin={getInfo:async()=>{infoCalls++;return {update,downloadReady:true};},
    install:()=>new Promise(resolve=>finishInstall=resolve)};
  const controller=createController(plugin,url);await controller.initialize();
  const pending=controller.install();assert.equal(await controller.recover(),false);assert.equal(infoCalls,1);
  finishInstall({permissionRequired:true});await pending;assert.equal(controller.snapshot().phase,'ready');
  plugin.install=async()=>{throw {code:'APK_MISSING',message:'APK 파일이 없습니다.'};};
  await controller.install();assert.equal(controller.snapshot().phase,'idle');assert.equal(controller.snapshot().readyHash,null);
});

test('restored APK supports offline retry but cannot replace a newer or withdrawn server offer on resume',async()=>{
  const plugin={getInfo:async()=>({update,downloadReady:true}),check:async()=>{throw new Error('offline');}};
  const controller=createController(plugin,url);await controller.initialize();
  assert.equal(await controller.check(),true);assert.equal(controller.snapshot().phase,'ready');
  const newer={...update,versionCode:8,fileSha256:'b'.repeat(64)};
  plugin.check=async()=>({update:newer,downloadReady:false});await controller.check();
  assert.equal(await controller.recover(),false);assert.equal(controller.snapshot().update.versionCode,8);
  plugin.check=async()=>({update:null,downloadReady:false});await controller.check();
  assert.equal(await controller.recover(),false);assert.equal(controller.snapshot().update,null);
});
