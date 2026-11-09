(function (root) {
  "use strict";
  const RECORDING_CONFIG = Object.freeze({
    minDistanceMeters: 10, // 마지막 저장 위치에서 필요한 이동 거리(m).
    maxAccuracyMeters: 100,
    maxLocationAgeMs: 60000,
    maxSpeedMetersPerSecond: 60
  });
  const copy = value => JSON.parse(JSON.stringify(value));
  function distance(a, b) {
    const rad = Math.PI / 180, lat = (b.lat-a.lat)*rad, lng = (b.lng-a.lng)*rad;
    const h = Math.sin(lat/2)**2 + Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(lng/2)**2;
    return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function sample(last, position, interval, now = Date.now()) {
    const c = position.coords || {};
    const point = { lat: c.latitude, lng: c.longitude, accuracy: c.accuracy, recorded_at: position.timestamp };
    if (![point.lat,point.lng,point.accuracy,point.recorded_at].every(Number.isFinite) || Math.abs(point.lat)>90 || Math.abs(point.lng)>180 || point.accuracy<0 || point.accuracy>RECORDING_CONFIG.maxAccuracyMeters || Math.abs(now-point.recorded_at)>RECORDING_CONFIG.maxLocationAgeMs) return null;
    let meters = 0;
    if (last) {
      const seconds = (point.recorded_at-last.recorded_at)/1000;
      if (seconds<interval) return null;
      meters = distance(last,point);
      if (meters/seconds>RECORDING_CONFIG.maxSpeedMetersPerSecond) return null;
      if (meters<RECORDING_CONFIG.minDistanceMeters) return null;
    }
    return { point, meters };
  }
  function repository(win) {
    const opened = new Promise((resolve,reject) => {
      const request = win.indexedDB.open('bearpoint.gps-tracks',1);
      request.onupgradeneeded = () => {
        const db=request.result; db.createObjectStore('tracks',{keyPath:'id'});
        db.createObjectStore('points',{keyPath:['track_id','seq']}).createIndex('track_id','track_id');
      };
      request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error);
    });
    async function transaction(stores,write,operation) {
      const db=await opened;
      return new Promise((resolve,reject)=>{
        const tx=db.transaction(stores,write?'readwrite':'readonly'); let value;
        tx.oncomplete=()=>resolve(value); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error || new Error('기록 저장이 취소되었습니다.'));
        operation(tx,result=>{value=result;});
      });
    }
    return {
      list: async()=>transaction(['tracks'],false,(tx,done)=>{const request=tx.objectStore('tracks').getAll(); request.onsuccess=()=>done(request.result.sort((a,b)=>b.started_at-a.started_at||String(b.id).localeCompare(String(a.id))));}),
      put: track=>transaction(['tracks'],true,tx=>tx.objectStore('tracks').put(track)),
      append: (track,point)=>transaction(['tracks','points'],true,tx=>{
        tx.objectStore('tracks').put(track); tx.objectStore('points').add({...point,track_id:track.id,seq:track.point_count-1});
      }),
      detail: id=>transaction(['tracks','points'],false,(tx,done)=>{
        let track,points;
        const finish=()=>{if(track!==undefined && points!==undefined) done(track ? {...track,points} : null);};
        const a=tx.objectStore('tracks').get(id), b=tx.objectStore('points').index('track_id').getAll(id);
        a.onsuccess=()=>{track=a.result || null;finish();}; b.onsuccess=()=>{points=b.result.sort((x,y)=>x.seq-y.seq);finish();};
      })
    };
  }
  function createWebRecorder(win, repo=repository(win)) {
    let active=null,last=null,watch=null,queue=Promise.resolve(),failure='',owns=false;
    const enqueue=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
    const stopWatch=()=>{if(watch!==null)win.navigator.geolocation.clearWatch(watch);watch=null;};
    let release;
    const released=new Promise(done=>{release=done;});
    const ready = new Promise((resolve,reject)=>{
      if (!win.navigator.locks) { reject(new Error('이 브라우저에서는 이동 기록을 지원하지 않습니다. 앱 또는 최신 브라우저를 사용해주세요.')); return; }
      win.navigator.locks.request('bearpoint.gps-recorder',{ifAvailable:true},async lock=>{
        if (!lock) {resolve();return;}
        owns=true;
        try {
          for(const track of await repo.list()) if(track.status==='recording') {
            const detail=await repo.detail(track.id),end=detail.points.at(-1)?.recorded_at || track.started_at;
            await repo.put({...track,status:track.point_count>0?'interrupted':'discarded',ended_at:end,error:track.point_count>0?'웹 페이지가 종료되어 기록이 중단되었습니다.':'GPS 위치가 수신되지 않아 기록을 저장하지 않았습니다.'});
          }
          resolve(); await released;
        } catch(error) {reject(error);}
      }).catch(reject);
    });
    win.addEventListener('pagehide',()=>{stopWatch();owns=false;release?.();});
    async function end(status='saved',error=null) {
      stopWatch();
      return enqueue(async()=>{
        if(!active)return {};
        const empty=!active.point_count;
        const ended={...active,status:empty?'discarded':status,ended_at:Date.now(),error:empty?(error?error+' ':'')+'GPS 위치가 수신되지 않아 기록을 저장하지 않았습니다.':error};
        await repo.put(ended);active=null;last=null;failure=ended.error||'';return copy(ended);
      });
    }
    return {
      async start(options) {
        await ready;
        if(!owns)throw new Error('다른 창에서 이동 기록을 사용 중입니다. 해당 창에서 조작해주세요.');
        if(!win.navigator.geolocation)throw new Error('GPS 위치 기능을 사용할 수 없습니다.');
        return enqueue(async()=>{
          if(active)throw new Error('이미 이동 기록 중입니다.');
          const track={...options,color:/^#[0-9a-f]{6}$/i.test(options.team_color||'')?options.team_color:'#2563EB',id:win.crypto.randomUUID(),started_at:Date.now(),ended_at:null,status:'recording',distance:0,point_count:0};
          await repo.put(track);active=track;last=null;failure='';
          try {
            watch=win.navigator.geolocation.watchPosition(position=>{
              void enqueue(async()=>{
                if(!active)return;
                const next=sample(last,position,active.interval_seconds);if(!next)return;
                const updated={...active,distance:active.distance+next.meters,point_count:active.point_count+1};
                await repo.append(updated,next.point);active=updated;last=next.point;
              }).catch(error=>{failure='위치 저장 실패: '+error.message;void end('interrupted',failure).catch(()=>{});});
            }, error=>{
              failure=error.code===1?'위치 권한을 허용해주세요.':'GPS 수신 대기: '+error.message;
              if(error.code===1)void end('interrupted',failure).catch(()=>{});
            },{enableHighAccuracy:true,maximumAge:0,timeout:30000});
          } catch(error) { active=null;await repo.put({...track,status:'discarded',ended_at:Date.now(),error:error.message});throw error; }
          return copy(track);
        });
      },
      stop:()=>end(),
      async updateInterval({interval_seconds}) {
        const interval=Number(interval_seconds);
        if(![5,10,30,60].includes(interval))throw new Error('기록 간격을 확인해주세요.');
        await ready;
        if(!owns)throw new Error('기록 중인 웹 창에서 간격을 변경해주세요.');
        return enqueue(async()=>{
          if(!active)return {active:null};
          const updated={...active,interval_seconds:interval};
          await repo.put(updated);active=updated;
          return {active:copy(active)};
        });
      },
      async status(){await ready;await queue;return {active:active?copy(active):null,error:failure,other_tab:!owns};},
      async list(query={}){
        await ready;const rows=(await repo.list()).filter(track=>Number(track.point_count)>0&&track.status!=='discarded');
        const filters=win.BearGpsTrackFilters || (typeof require==='function'?require('./gps-track-filters.js'):null);
        const matches=filters.sortHistory(filters.filter(rows,query)),offset=Math.max(0,Number(query.offset)||0);
        return {items:matches.slice(offset,offset+30),total:matches.length,teams:filters.teams(rows)};
      },
      async detail({id}){await ready;return repo.detail(id);}
    };
  }
  const api={RECORDING_CONFIG,distance,sample,repository,createWebRecorder};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.BearGpsTracks=api;
})(typeof window==='object'?window:globalThis);
