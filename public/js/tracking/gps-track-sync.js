(function(root){
  "use strict";
  function endpoint(win) {
    if(!win.Capacitor?.isNativePlatform?.()) return "api/app-realtime/movement-tracks";
    const config=win.BEAR_RUNTIME_CONFIG || {};
    return config.movementApiUrl || String(config.realtimeApiBase || win.BEAR_API_BASE || "https://bearmap.duckdns.org/api/realtime").replace(/\/$/,"")+"/movement-tracks";
  }
  function create({plugin,win=root,fetchImpl=win.fetch.bind(win)}) {
    let pending;
    const key=id=>'bearpoint.gps-uploaded.'+id;
    const acknowledged=id=>{try{return win.localStorage.getItem(key(id))==='1';}catch(_){return false;}};
    async function run() {
      let offset=0,uploaded=0,eligible=0,remaining=0,skipped=0;
      // status() also recovers interrupted native/web records before listing.
      await plugin.status();
      for(;;) {
        const {items=[]}=await plugin.list({offset});
        for(const track of items) {
          if(!['saved','interrupted'].includes(track.status))continue;
          if(!(Number(track.point_count)>0)){skipped++;continue;}
          eligible++;
          if(acknowledged(track.id))continue;
          const detail=await plugin.detail({id:track.id});
          if(!detail || !['saved','interrupted'].includes(detail.status))continue;
          if(!Array.isArray(detail.points)||!detail.points.length||Number(detail.point_count)!==detail.points.length){eligible--;skipped++;continue;}
          const payload={};
          for(const field of ['id','owner','team_id','team_name','team_color','color','interval_seconds','started_at','ended_at','status','distance','point_count','error']) payload[field]=detail[field] ?? null;
          payload.points=(detail.points || []).map(p=>({lat:p.lat,lng:p.lng,accuracy:p.accuracy,recorded_at:p.recorded_at}));
          const body=JSON.stringify(payload);
          if(new TextEncoder().encode(body).length>16*1024*1024) throw new Error('기록이 전송 한도(16MiB)를 초과했습니다. 기기 기록은 보존됩니다.');
          const controller=new AbortController(),timer=win.setTimeout(()=>controller.abort(),30000);
          try {
            const response=await fetchImpl(endpoint(win),{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},credentials:'omit',redirect:'error',signal:controller.signal,body});
            const result=await response.json().catch(()=>null);
            if(!response.ok || result?.ok!==true || String(result.id).toLowerCase()!==String(track.id).toLowerCase()) throw new Error(result?.message || '서버 전송을 완료하지 못했습니다.');
            try{win.localStorage.setItem(key(track.id),'1');}catch(_){/* A retry remains safe through the server UUID constraint. */}
            if(!acknowledged(track.id))remaining++;
            uploaded++;
          } catch(error) {
            throw new Error((error.name==='AbortError' ? '서버 응답 시간이 초과되었습니다.' : error.message)+' 기기 기록을 보존했습니다. 다시 전송해주세요.');
          } finally {win.clearTimeout(timer);}
        }
        if(items.length<30)break;
        offset+=items.length;
      }
      return {uploaded,eligible,remaining,skipped};
    }
    return {sync(){if(!pending)pending=run().finally(()=>{pending=null;});return pending;},acknowledged};
  }
  function notice(result,manual=false){
    if(result.remaining>0)return '서버 수신은 완료했지만 기기에 전송 완료 상태를 보관하지 못했습니다. 다시 전송해주세요.';
    if(result.uploaded>0)return result.uploaded+'건을 서버에 전송했습니다.';
    return manual?(result.eligible>0?'미전송 기록이 없습니다.':'전송할 이동 기록이 없습니다.'):'';
  }
  const api={create,endpoint,notice};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.BearGpsTrackSync=api;
})(typeof window==='object'?window:globalThis);
