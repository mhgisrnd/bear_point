(function(root){
  "use strict";
  function endpoint(win) {
    if(!win.Capacitor?.isNativePlatform?.()) return "api/app-realtime/movement-tracks";
    const config=win.BEAR_RUNTIME_CONFIG || {};
    return config.movementApiUrl || String(config.realtimeApiBase || win.BEAR_API_BASE || "https://bearmap.duckdns.org/api/realtime").replace(/\/$/,"")+"/movement-tracks";
  }
  function create({plugin,win=root,fetchImpl=win.fetch.bind(win)}) {
    let pending;
    let sharedRows = new Map(), refreshing, hasSharedSnapshot = false;
    const deletedTracks = new Set(), checkedLegacyReceipts = new Set();
    const key=id=>'bearpoint.gps-uploaded.'+id;
    const receipt=id=>{try{return win.localStorage.getItem(key(id));}catch(_){return null;}};
    const acknowledged=id=>receipt(id)==='1';
    const isDeleted=id=>!sharedRows.has(id)&&(deletedTracks.has(id)||receipt(id)==='deleted');
    async function readShared(path = "", page) {
      const native = !!win.Capacitor?.isNativePlatform?.();
      const headers = {Accept:"application/json"};
      const response = await fetchImpl(endpoint(win) + path + (page ? "?page=" + page : ""), {
        credentials: native ? "omit" : "same-origin", redirect:"error", headers, signal:AbortSignal.timeout(12000)
      });
      if (!native && response.status === 401) {
        sharedRows = new Map();
        const result = await response.json().catch(() => ({}));
        throw Object.assign(new Error(result.message || "공유 이동 기록을 보려면 관리자 로그인이 필요합니다."), {loginUrl:result.loginUrl});
      }
      if (response.status === 403) {
        sharedRows = new Map();
        const body = await response.json().catch(() => null);
        if (body?.message === "허용되지 않은 모바일 API 요청입니다.") {
          throw new Error("서버에서 이동 기록 조회가 차단되었습니다. 서버 배포 상태를 확인해주세요.");
        }
        throw new Error(native ? "앱 인증으로 공유 이동 기록을 확인할 수 없습니다." : "공유 이동 기록에 접근할 수 없습니다.");
      }
      if (!response.ok) throw new Error("공유 이동 기록 조회에 실패했습니다. (HTTP " + response.status + ")");
      return response.json();
    }
    function refreshShared() {
      if (!refreshing) refreshing = (async () => {
        const next = new Map();
        for (let page = 1; ; page++) {
          const result = await readShared("", page);
          if (!result.ok || !Array.isArray(result.items) || !Number.isInteger(result.pageSize)
              || result.pageSize < 1 || !Number.isSafeInteger(result.total)) {
            throw new Error("공유 이동 기록 응답이 올바르지 않습니다.");
          }
          for (const row of result.items) next.set(String(row.id), row);
          if (page * result.pageSize >= result.total || !result.items.length) {
            hasSharedSnapshot = next.size === result.total;
            break;
          }
        }
        sharedRows = next;
        for (const id of next.keys()) checkedLegacyReceipts.delete(id);
      })().catch(error => { hasSharedSnapshot = false; throw error; }).finally(() => { refreshing = null; });
      return refreshing;
    }
    async function list(query, limit = 30) {
      const filters = win.BearGpsTrackFilters || (typeof require === "function" ? require("./gps-track-filters") : null);
      const rows = new Map([...sharedRows].map(([id, row]) => [id, {...row, sharedOnly:true}]));
      for (let offset = 0; ; ) {
        const {items = []} = await plugin.list({offset});
        for (const row of items) if (!isDeleted(String(row.id))) rows.set(String(row.id), row);
        if (items.length < 30) break;
        offset += items.length;
      }
      const all = [...rows.values()];
      const matches = filters.sortHistory(filters.filter(all, query));
      const offset = query.offset || 0;
      return {items:matches.slice(offset, offset + limit), total:matches.length, teams:filters.teams(all)};
    }
    async function run() {
      let offset=0,uploaded=0,eligible=0,remaining=0,skipped=0;
      let rejected=0, firstRejection="";
      function rejectTrack(message) {
        rejected++;
        if (!firstRejection) firstRejection=message;
      }
      // status() also recovers interrupted native/web records before listing.
      await plugin.status();
      for(;;) {
        const {items=[]}=await plugin.list({offset});
        for(const track of items) {
          if(!['saved','interrupted'].includes(track.status)||Number(track.local_archived)===1)continue;
          if(!(Number(track.point_count)>0)){skipped++;continue;}
          const id=String(track.id);
          if(isDeleted(id))continue;
          eligible++;
          if(sharedRows.has(id)||checkedLegacyReceipts.has(id)||(!hasSharedSnapshot&&acknowledged(id)))continue;
          const detail=await plugin.detail({id});
          if(!detail || !['saved','interrupted'].includes(detail.status)) {
            rejectTrack('기기에 저장된 기록 상세를 읽을 수 없습니다.');
            continue;
          }
          if(!Array.isArray(detail.points)||!detail.points.length) {
            rejectTrack('기기에 저장된 GPS 좌표를 찾을 수 없습니다.');
            continue;
          }
          const payload={};
          for(const field of ['id','owner','team_id','team_name','team_color','color','interval_seconds','started_at','ended_at','status','distance','point_count','error']) payload[field]=detail[field] ?? null;
          payload.points=(detail.points || []).map(p=>({lat:p.lat,lng:p.lng,accuracy:p.accuracy,recorded_at:p.recorded_at}));
          payload.point_count=payload.points.length;
          const body=JSON.stringify(payload);
          if(new TextEncoder().encode(body).length>16*1024*1024) {
            rejectTrack('기록이 전송 한도(16MiB)를 초과했습니다.');
            continue;
          }
          const controller=new AbortController(),timer=win.setTimeout(()=>controller.abort(),30000);
          try {
            const response=await fetchImpl(endpoint(win),{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},credentials:'omit',redirect:'error',signal:controller.signal,body});
            const result=await response.json().catch(()=>null);
            if([400,409,413,422].includes(response.status)) {
              rejectTrack(result?.message || '서버에서 기록을 거절했습니다.');
              continue;
            }
            if(!response.ok || result?.ok!==true || String(result.id).toLowerCase()!==String(track.id).toLowerCase()) throw new Error(result?.message || '서버 전송을 완료하지 못했습니다.');
            if(result.deleted===true) {
              sharedRows.delete(id);
              deletedTracks.add(id);
              try{win.localStorage.setItem(key(id),'deleted');}catch(_){/* Keep the receipt in memory for this session. */}
              continue;
            }
            if(result.deleted===false) sharedRows.set(id,track);
            else if(hasSharedSnapshot) checkedLegacyReceipts.add(id);
            try{win.localStorage.setItem(key(id),'1');}catch(_){/* A retry remains safe through the server UUID constraint. */}
            if(!acknowledged(id))remaining++;
            uploaded++;
          } catch(error) {
            throw new Error((error.name==='AbortError' ? '서버 응답 시간이 초과되었습니다.' : error.message)+' 기기 기록을 보존했습니다. 다시 전송해주세요.');
          } finally {win.clearTimeout(timer);}
        }
        if(items.length<30)break;
        offset+=items.length;
      }
      if(rejected) throw new Error((uploaded ? uploaded+'건 전송 완료 · ' : '')+rejected+'건 전송 실패: '+firstRejection+' 기기 기록은 보존했습니다.');
      return {uploaded,eligible,remaining,skipped};
    }
    async function cleanup(cutoff) {
      if(typeof plugin.archiveShared!=='function')return {tracks:0,points:0};
      if(pending)await pending;
      await refreshShared();
      if(!hasSharedSnapshot)throw new Error('서버 목록을 모두 확인하지 못해 기기 원본을 보존했습니다.');
      const candidates=[];
      for(let offset=0;;){
        const {items=[]}=await plugin.list({offset});
        candidates.push(...items.filter(row=>sharedRows.has(String(row.id))&&['saved','interrupted'].includes(row.status)&&Number(row.ended_at)>0&&Number(row.ended_at)<cutoff));
        if(items.length<30)break;offset+=items.length;
      }
      let tracks=0,points=0;
      for(const row of candidates){
        try {
        // A local upload receipt alone cannot prove the complete route still exists.
        const remote=await readShared('/'+encodeURIComponent(row.id));
        if(String(remote.id)!==String(row.id)||!Array.isArray(remote.points))throw new Error('서버 경로를 확인하지 못해 기기 원본을 보존했습니다.');
        const stamp=String(remote.uploaded_at||'').replace(' ','T');
        const uploaded=Date.parse(/Z$|[+-]\d\d:\d\d$/.test(stamp)?stamp:stamp+'Z');
        if(!Number.isFinite(uploaded)||uploaded>=cutoff)continue;
        const result=await plugin.archiveShared({remote,cutoff});
        if(result.removed){tracks++;points+=Number(result.points);try{win.localStorage.removeItem(key(row.id));}catch(_){}}
        } catch(error) {
          return {tracks,points,warning:'나머지 기기 경로는 보존했습니다. '+(error.message||String(error))};
        }
      }
      return {tracks,points};
    }
    return {sync(){if(!pending)pending=run().finally(()=>{pending=null;});return pending;},acknowledged,cleanup,
      refreshShared, list, sharedDetail:id=>readShared("/"+encodeURIComponent(id))};
  }
  function notice(result,manual=false){
    if(result.remaining>0)return '서버 수신은 완료했지만 기기에 전송 완료 상태를 보관하지 못했습니다. 다시 전송해주세요.';
    if(result.uploaded>0)return result.uploaded+'건을 서버에 전송했습니다.';
    return manual?(result.eligible>0?'미전송 기록이 없습니다.':'전송할 이동 기록이 없습니다.'):'';
  }
  const api={create,endpoint,notice};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.BearGpsTrackSync=api;
})(typeof window==='object'?window:globalThis);
