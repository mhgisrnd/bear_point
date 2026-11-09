(function(root){
  'use strict';
  function endpoint(config){
    const base=new URL(config.appUpdateApiUrl||config.realtimeApiBase);
    if(!config.appUpdateApiUrl)base.pathname=base.pathname.replace(/\/api\/realtime\/?$/,'/api/app-updates/latest');
    if(base.protocol!=='https:'||base.username||base.password||base.search||base.hash||!base.pathname.endsWith('/api/app-updates/latest'))throw new Error('업데이트 서버 주소를 확인해주세요.');
    return base.href;
  }
  function createController(plugin,apiUrl,onChange=()=>{}){
    let state={phase:'idle',current:null,update:null,message:'업데이트를 확인해주세요.',received:0,total:0,readyHash:null};
    let confirmedHash; // Undefined until a successful server check; null means no published offer.
    const paint=patch=>{state={...state,...patch};onChange({...state});};
    const busy=()=>['checking','downloading','installing'].includes(state.phase);
    return {
      snapshot:()=>({...state}),
      async initialize(){return this.recover();},
      async recover(){
        if(busy())return false;
        const current=await plugin.getInfo();
        if(current.downloadReady&&current.update&&(confirmedHash===undefined||confirmedHash===current.update.fileSha256)){
          paint({current,update:current.update,phase:'ready',readyHash:current.update.fileSha256,message:'다운로드한 APK가 준비되어 있습니다. 설치를 계속할 수 있습니다.'});
          return true;
        }
        if(current.downloadReady===false&&state.phase==='ready')paint({current,phase:'idle',readyHash:null,message:'APK 파일을 다시 다운로드해주세요.'});
        else paint({current});
        return false;
      },
      async check(){
        if(busy())return false;
        const previous={...state};
        paint({phase:'checking',message:'최신 버전을 확인하고 있습니다.'});
        try{
          const result=await plugin.check({apiUrl});
          const update=result.update||null;
          confirmedHash=update?.fileSha256||null;
          const ready=!!update&&(typeof result.downloadReady==='boolean'?result.downloadReady:state.readyHash===update.fileSha256);
          paint({phase:ready?'ready':'idle',current:result,update,readyHash:ready?update.fileSha256:null,
            message:ready?'다운로드한 APK가 준비되어 있습니다. 설치를 계속할 수 있습니다.':update?'새 버전을 다운로드할 수 있습니다.':'현재 제공 중인 새 업데이트가 없습니다.'});
          return !!update;
        }catch(error){
          if(previous.readyHash&&previous.update){paint({...previous,message:'최신 버전 확인에 실패했습니다. 다운로드한 APK는 설치를 계속할 수 있습니다.'});return true;}
          paint({phase:'idle',update:null,readyHash:null,message:error.message||'업데이트를 확인하지 못했습니다.'});return false;
        }
      },
      progress(value){if(state.phase==='downloading')paint({received:Number(value.received)||0,total:Number(value.total)||0});},
      async download(){
        if(busy()||!state.update)return false;
        const sha256=state.update.fileSha256;
        paint({phase:'downloading',received:0,total:state.update.fileSize,readyHash:null,message:'APK를 다운로드하고 검증하고 있습니다.'});
        try{await plugin.download({apiUrl,sha256});paint({phase:'ready',readyHash:sha256,message:'다운로드와 검증이 완료되었습니다.'});return true;}
        catch(error){paint({phase:'idle',readyHash:null,message:error.message||'다운로드하지 못했습니다. 다시 시도해주세요.'});return false;}
      },
      async cancel(){if(state.phase==='downloading')await plugin.cancelDownload();},
      async install(){
        if(state.phase!=='ready')return;
        paint({phase:'installing',message:'설치 파일을 확인하고 있습니다.'});
        try{
          const result=await plugin.install();
          paint({phase:result.installed?'idle':'ready',message:result.installed?'설치가 완료되었습니다.':result.permissionRequired?'이 출처의 앱 설치가 허용되지 않았습니다. 설치 계속을 눌러 권한을 허용해주세요.':result.cancelled?'설치를 취소했습니다. 다시 설치할 수 있습니다.':'설치 화면을 열었습니다. 설치를 취소했다면 다시 진행할 수 있습니다.'});
        }catch(error){paint({phase:error.code==='APK_MISSING'?'idle':'ready',readyHash:error.code==='APK_MISSING'?null:state.readyHash,message:error.message||'설치 화면을 열지 못했습니다.'});}
      }
    };
  }
  if(typeof module==='object'&&module.exports){module.exports={endpoint,createController};return;}
  const native=root.Capacitor?.isNativePlatform?.();
  let plugin;
  if(native){try{plugin=root.Capacitor.registerPlugin('AppUpdate');}catch(_){}}
  const mounts=[];
  let controller,dialog,manualUsed=false;
  const size=value=>(Number(value||0)/1024/1024).toFixed(1)+' MB';
  function paint(state){
    const busy=['checking','downloading','installing'].includes(state.phase);
    for(const container of mounts){
      const current=container.querySelector('[data-current]');if(current)current.textContent=state.current?state.current.versionName:'확인 중';
      container.querySelector('[data-latest]').textContent=state.update?state.update.versionName:'—';
      container.querySelector('[data-notes]').textContent=state.update?.releaseNotes||'';
      container.querySelector('[data-message]').textContent=state.message;
      const check=container.querySelector('[data-check]');if(check)check.disabled=busy;
      const action=container.querySelector('[data-update]');
      action.hidden=!state.update;action.disabled=busy;action.textContent=state.phase==='ready'?'설치 계속':'APK 다운로드';
      const progress=container.querySelector('progress');progress.hidden=state.phase!=='downloading';progress.max=state.total||1;progress.value=state.received;
      container.querySelector('[data-progress]').textContent=state.phase==='downloading'?`${size(state.received)} / ${size(state.total)}`:'';
      const close=container.querySelector('[data-dismiss]');if(close){close.disabled=state.phase==='installing';close.textContent=state.phase==='downloading'?'다운로드 취소':'나중에';}
      const x=container.querySelector('[data-close]');if(x)x.disabled=busy;
    }
  }
  function content(withCheck){return `<div class="app-settings-body app-update-body">
    <dl class="app-update-versions">${withCheck?'<div><dt>현재 버전</dt><dd data-current>확인 중</dd></div>':''}<div><dt>배포 버전</dt><dd data-latest>—</dd></div></dl>
    <p class="app-update-notes" data-notes tabindex="0" role="region" aria-label="업데이트 변경 내용"></p><p class="app-update-message" data-message role="status" aria-live="polite"></p>
    <progress aria-label="APK 다운로드 진행률" hidden></progress><p class="app-settings-help" data-progress></p>
    <div class="app-settings-actions">${withCheck?'<button type="button" data-check>업데이트 확인</button>':''}<button type="button" class="app-settings-save" data-update hidden>APK 다운로드</button></div>
    ${withCheck?'':'<button type="button" class="app-update-dismiss" data-dismiss>닫기</button>'}</div>`;}
  function showOffer(){
    if(!controller?.snapshot().update)return;
    if(!dialog){
      dialog=document.createElement('dialog');dialog.className='app-settings-dialog app-update-dialog';
      dialog.setAttribute('aria-labelledby','app-update-title');
      dialog.innerHTML='<div class="app-settings-head"><h2 id="app-update-title">앱 업데이트</h2><button type="button" class="app-settings-close" data-close aria-label="업데이트 닫기">×</button></div>'+content(false);
      document.body.append(dialog);bind(dialog);mounts.push(dialog);
      dialog.addEventListener('cancel',event=>{if(['downloading','installing'].includes(controller.snapshot().phase))event.preventDefault();});
      dialog.querySelector('[data-close]').addEventListener('click',()=>dialog.close());
      dialog.querySelector('[data-dismiss]').addEventListener('click',async()=>{
        if(controller.snapshot().phase==='downloading'){try{await controller.cancel();}catch(_){}return;}
        dialog.close();
      });
    }
    paint(controller.snapshot());if(!dialog.open)dialog.showModal();
  }
  function bind(container){
    container.querySelector('[data-check]')?.addEventListener('click',async()=>{manualUsed=true;if(await controller.check())showOffer();});
    container.querySelector('[data-update]').addEventListener('click',async()=>{
      if(container!==dialog){manualUsed=true;showOffer();return;}
      if(controller.snapshot().phase==='ready'){await controller.install();return;}
      if(await controller.download())await controller.install();
    });
  }
  root.BearAppUpdates={mount(container){
    if(!plugin||!controller){container.innerHTML='<div class="app-settings-body"><p class="app-settings-intro">APK 업데이트는 Android 앱에서 사용할 수 있습니다.</p></div>';return;}
    container.innerHTML=content(true);mounts.push(container);bind(container);paint(controller.snapshot());
  }};
  if(!plugin)return;
  try{controller=createController(plugin,endpoint(root.BEAR_RUNTIME_CONFIG||{}),paint);}catch(_){return;}
  const initialized=controller.initialize().catch(()=>{});
  Promise.resolve(plugin.addListener('progress',value=>controller.progress(value))).catch(()=>{});
  async function autoCheck(){
    await initialized;await root.BearStartupReady;
    if(manualUsed)return;
    if(!await controller.check())return;
    // Do not cover startup registration or another open modal. No download occurs here.
    const timer=setInterval(()=>{
      if(manualUsed){clearInterval(timer);return;}
      if(document.hidden||document.querySelector('dialog[open]'))return;
      clearInterval(timer);showOffer();
    },1000);
  }
  async function restoreOnResume(){
    if(document.hidden)return;
    try{if(await controller.recover())showOffer();}catch(_){}
  }
  document.addEventListener('visibilitychange',()=>void restoreOnResume());
  root.addEventListener('focus',()=>void restoreOnResume());
  if(document.readyState==='complete')void autoCheck();else root.addEventListener('load',()=>void autoCheck(),{once:true});
})(typeof window==='object'?window:globalThis);
