(function(root){
  'use strict';
  const DAY=86400000,RETENTION=7*DAY,key='bearpoint.storage-cleanup.v3';
  const handlers=new Map();let pending,lastAttempt=0;
  const cutoff=()=>Date.now()-RETENTION;
  function older(value,before=cutoff()){
    if(value==null||value==='')return false;
    const text=String(value);
    const date=typeof value==='number'?value:Date.parse(/Z$|[+-]\d\d:\d\d$/.test(text)?text:text.replace(' ','T')+'Z');
    return Number.isFinite(date)&&date>0&&date<before;
  }
  const formatError=error=>/SQLITE_FULL|database or disk is full|disk full|ENOSPC|QuotaExceeded|quota.*exceed/i.test(String(error?.message||error))
    ?'기기 저장 공간이 부족합니다. 설정의 저장 공간에서 정리하거나 기기의 여유 공간을 확보한 뒤 다시 시도해주세요.'
    :String(error?.message||error);
  function read(){try{return JSON.parse(root.localStorage.getItem(key)||'null');}catch(_){return null;}}
  function run({manual=false}={}){
    if(pending)return pending;
    if(handlers.size<3)return Promise.resolve({deferred:true});
    if(root.navigator.onLine===false)return manual?Promise.reject(new Error('인터넷 연결 후 정리할 수 있습니다. 서버 보관 여부를 먼저 확인합니다.')):Promise.resolve({deferred:true});
    if(!manual&&(Date.now()-lastAttempt<DAY||Date.now()-Number(read()?.completedAt||0)<DAY))return Promise.resolve({deferred:true});
    lastAttempt=Date.now();
    pending=(async()=>{
      const result={completedAt:Date.now(),tracks:0,points:0,observations:0,estimates:0,cache:0},errors=[];
      for(const [name,handler]of handlers){
        try{const counts=await handler(cutoff());for(const field of ['tracks','points','observations','estimates','cache'])result[field]+=Number(counts?.[field]||0);if(counts?.warning)errors.push(name+': '+counts.warning);}
        catch(error){errors.push(name+': '+formatError(error));}
      }
      if(errors.length)result.warning='확인하지 못한 자료는 보존했습니다. '+errors.join(' / ');
      else root.localStorage.setItem(key,JSON.stringify(result));
      root.dispatchEvent?.(new Event('bearpoint:storage-cleaned'));
      return result;
    })().finally(()=>{pending=null;});
    return pending;
  }
  function register(name,handler){handlers.set(name,handler);}
  function mount(section){
    section.innerHTML=`<div class="app-settings-body app-settings-fields">
      <strong>공유 완료 자료 7일 보관</strong>
      <p class="app-settings-help">관측점·개체 추적·이동 기록 모두 공유 완료일부터 7일이 지나면, 서버 보관을 확인한 뒤 기기 사본을 삭제합니다. 목록과 상세정보는 인터넷 연결 시 서버에서 조회합니다.</p>
      <p class="app-settings-help">미공유·전송 실패·충돌·수정 백업·진행 중인 기록은 보관합니다. 나중에 공유가 완료되면 그때부터 7일을 계산합니다.</p>
      <p class="app-settings-help">서버 원본은 삭제하지 않습니다. 정리된 자료는 앱을 다시 열었을 때 오프라인에서는 조회할 수 없습니다.</p>
      <p data-storage-info class="app-settings-help"></p>
      <p data-storage-result class="app-settings-status" role="status" aria-live="polite"></p>
      <button type="button" class="app-settings-refresh" data-storage-clean>지금 정리</button>
    </div>`;
    const button=section.querySelector('[data-storage-clean]'),message=section.querySelector('[data-storage-result]');
    const describe=result=>`이동 경로 ${result.tracks}건(좌표 ${result.points}개), 중복 추적 ${result.estimates}건, 삭제 자료·캐시 ${result.observations+result.cache}건 정리`;
    async function refresh(){
      const last=read();if(last&&!pending)message.textContent='최근 정리: '+new Date(last.completedAt).toLocaleString('ko-KR')+' · '+describe(last);
      const plugin=root.Capacitor?.Plugins?.GpsTracking;
      if(typeof plugin?.storageInfo==='function')try{
        const info=await plugin.storageInfo();
        section.querySelector('[data-storage-info]').textContent=`기기 여유 공간 ${(Number(info.availableBytes)/1048576).toFixed(0)} MB · 이동 기록 DB ${(Number(info.databaseBytes)/1048576).toFixed(1)} MB`;
      }catch(_){/* Cleanup remains available if capacity inspection is unsupported. */}
    }
    button.addEventListener('click',async()=>{
      button.disabled=true;message.textContent='서버 보관 여부를 확인하고 있습니다…';
      try{const result=await run({manual:true});message.textContent=result.deferred?'자료가 준비된 후 다시 시도해주세요.':describe(result)+(result.warning?' · '+result.warning:'');}
      catch(error){message.textContent=formatError(error);}
      finally{button.disabled=false;void refreshCapacity();}
    });
    async function refreshCapacity(){const text=message.textContent;await refresh();message.textContent=text;}
    root.addEventListener('bearpoint:storage-cleaned',()=>void refreshCapacity());
    section.addEventListener('storage-refresh',()=>void refresh());
    void refresh();
  }
  root.BearStorageCleanup={register,run,older,cutoff,formatError,mount};
  const auto=()=>{if(!root.document.hidden&&root.Capacitor?.isNativePlatform?.())void run().catch(()=>{});};
  root.addEventListener('online',auto);root.document.addEventListener('visibilitychange',auto);
  root.setTimeout(auto,15000);
  // Daily check while the app stays open; no background task or GPS start is required.
  const timer=root.setInterval(auto,60*60*1000);root.addEventListener('pagehide',()=>root.clearInterval(timer),{once:true});
})(window);
