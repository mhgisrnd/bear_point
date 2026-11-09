(function (root) {
  "use strict";
  function getNativeGpsPlugin() {
    const injected = root.Capacitor?.Plugins?.GpsTracking;
    if (injected) return injected;
    if (typeof root.Capacitor?.registerPlugin === 'function') {
      try { return root.Capacitor.registerPlugin('GpsTracking'); } catch (_) {}
    }
    // A missing optional recorder must not prevent map controls and the rest of the app from mounting.
    const unavailable = async () => { throw new Error('이동 기록을 지원하는 최신 APK를 설치해주세요.'); };
    return {status:async()=>({active:null}),start:unavailable,stop:unavailable,list:unavailable,detail:unavailable};
  }
  root.createGpsTrackUi = function ({ ol, map, project, insertBefore }) {
    const native = !!root.Capacitor?.isNativePlatform?.();
    const plugin = native ? getNativeGpsPlugin() : root.BearGpsTracks.createWebRecorder(root);
    const button = document.getElementById('btn-gps-tracking');
    const panel = document.createElement('section');
    panel.className='gps-track-panel'; panel.hidden=true; panel.setAttribute('aria-label','이동 기록');
    panel.innerHTML=`<header><strong>이동 기록</strong><div class="gps-track-header-actions"><button type="button" data-start>기록 시작</button><button type="button" data-stop hidden>종료·저장</button><button type="button" class="list-refresh-button" data-refresh aria-label="기록 이력 새로고침" title="기록 이력 새로고침">↻</button></div><button type="button" data-close aria-label="이동 기록 닫기">×</button></header>
      <div class="gps-track-content"><p class="gps-track-summary">기록을 시작하면 이동 경로가 지도에 표시됩니다.</p>
      <div class="gps-track-actions"><button type="button" data-hide hidden>경로 숨기기</button></div>
      <p class="gps-track-message" role="status" aria-live="polite"></p><div class="gps-track-actions"><button type="button" data-sync hidden>미전송 기록 전송</button></div><p class="gps-track-sync-message" role="status" aria-live="polite" hidden></p>
      <form class="gps-history-search" role="search" aria-label="이동 기록 검색"><div class="gps-history-search-row"><input type="search" name="owner" placeholder="담당자 검색" aria-label="담당자 검색" autocomplete="off"><button type="submit">조회</button><button class="list-filter-button" type="button" data-filter aria-expanded="false" aria-controls="gps-history-filters">필터</button><button type="button" data-reset>초기화</button></div>
      <div class="gps-history-filters" id="gps-history-filters" hidden><div class="gps-history-filter-row"><span class="gps-history-filter-label" id="gps-period-label">기간</span><div class="gps-history-chips" role="group" aria-labelledby="gps-period-label"><button type="button" data-period="all" aria-pressed="true">전체</button><button type="button" data-period="today" aria-pressed="false">오늘</button><button type="button" data-period="day" aria-pressed="false">일별</button><button type="button" data-period="month" aria-pressed="false">월별</button><button type="button" data-period="year" aria-pressed="false">년별</button></div></div><div class="gps-history-date-row" hidden><input type="date" name="day" aria-label="조회 날짜" hidden><input type="month" name="month" aria-label="조회 월" hidden><input type="number" name="year" min="1900" max="9999" step="1" inputmode="numeric" placeholder="연도" aria-label="조회 연도" hidden></div><div class="gps-history-filter-row"><span class="gps-history-filter-label" id="gps-team-label">팀</span><div class="gps-history-chips gps-history-team-chips" role="group" aria-labelledby="gps-team-label"><button type="button" data-team="" aria-pressed="true">전체</button></div></div></div></form>
      <section class="gps-track-history" aria-label="기록 이력"><div class="gps-history-overview"><strong>기록 이력</strong><span data-history-count>0건</span></div><div class="gps-track-history-frame"><table class="gps-track-history-table" aria-label="이동 기록 이력"><colgroup><col style="width:25%"><col style="width:18%"><col style="width:22%"><col style="width:15%"><col style="width:20%"></colgroup><thead><tr><th scope="col">기록일시</th><th scope="col">담당자</th><th scope="col">팀명</th><th scope="col">시간</th><th scope="col">거리<span class="gps-history-unit">(km)</span></th></tr></thead><tbody class="gps-track-history-items"></tbody></table></div><button type="button" data-more hidden>더 보기</button></section></div>`;
    document.body.append(panel);
    const start=panel.querySelector('[data-start]'),stop=panel.querySelector('[data-stop]'),hide=panel.querySelector('[data-hide]');
    const message=panel.querySelector('.gps-track-message'),summary=panel.querySelector('.gps-track-summary');
    const history=panel.querySelector('.gps-track-history-items'),more=panel.querySelector('[data-more]');
    const search=panel.querySelector('.gps-history-search'),filterButton=panel.querySelector('[data-filter]'),filterPanel=panel.querySelector('.gps-history-filters');
    const filterBadge=document.createElement('span');filterBadge.className='list-filter-count';filterBadge.hidden=true;filterButton.append(filterBadge);
    const refreshButton=panel.querySelector('[data-refresh]'),count=panel.querySelector('[data-history-count]');
    const filters=root.BearGpsTrackFilters;
    let appliedQuery=filters.buildQuery(),historyLoaded=false,period='all',teamId='';
    function paintFilterState(){
      const amount=Number(!!appliedQuery.team_id)+Number(appliedQuery.from!=null);
      filterButton.classList.toggle('has-filters',amount>0);filterBadge.hidden=!amount;filterBadge.textContent=String(amount);
      filterButton.title=(filterPanel.hidden?'필터 펼치기':'필터 접기')+(amount?' · '+amount+'개 조건 적용 중':'');
    }
    function setFilterPanelOpen(open){
      filterPanel.hidden=!open;filterButton.setAttribute('aria-expanded',String(open));paintFilterState();
      root.BearMobileDock?.setFiltersOpen(open);place();
    }
    const teamChips=panel.querySelector('.gps-history-team-chips'),dateRow=panel.querySelector('.gps-history-date-row');
    const today=filters.today();search.elements.day.value=today;search.elements.month.value=today.slice(0,7);search.elements.year.value=today.slice(0,4);
    function periodFields(){
      dateRow.hidden=!['day','month','year'].includes(period);
      for(const name of ['day','month','year']){const inactive=period!==name;search.elements[name].hidden=inactive;search.elements[name].disabled=inactive;}
      filterPanel.querySelectorAll('[data-period]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.period===period)));
    }
    periodFields();
    function paintTeams(items){
      const teams=new Map((items||[]).map(team=>[team.id,team]));
      for(const team of root.BearAppSettings?.store?.snapshot()?.items||[])if(!teams.has(team.id))teams.set(team.id,team);
      if(teamId&&!teams.has(teamId))teams.set(teamId,{id:teamId,name:[...teamChips.querySelectorAll('[data-team]')].find(button=>button.dataset.team===teamId)?.textContent||teamId});
      teamChips.replaceChildren();
      for(const team of [{id:'',name:'전체'},...teams.values()]){
        const option=document.createElement('button');option.type='button';option.dataset.team=team.id;option.textContent=team.name;option.setAttribute('aria-pressed',String(team.id===teamId));option.disabled=busy;
        if(/^#[0-9a-f]{6}$/i.test(team.color||'')){const dot=document.createElement('i');dot.style.background=team.color;dot.setAttribute('aria-hidden','true');option.prepend(dot);}
        teamChips.append(option);
      }
    }
    const syncButton=panel.querySelector('[data-sync]'),syncMessage=panel.querySelector('.gps-track-sync-message');
    const syncClient=root.BearGpsTrackSync.create({plugin});
    let syncing=false,lastSync=0;
    async function syncRecords(manual=false,force=manual) {
      if(syncing || (!force && Date.now()-lastSync<60000))return;
      syncing=true;lastSync=Date.now();syncButton.disabled=true;
      if(manual){syncMessage.hidden=false;syncMessage.textContent='저장된 기록을 서버에 전송하는 중입니다.';}
      try {
        const result=await syncClient.sync();
        syncMessage.textContent=root.BearGpsTrackSync.notice(result,manual);
        syncMessage.hidden=!syncMessage.textContent;syncButton.hidden=result.remaining===0;
      } catch(error) {syncMessage.hidden=false;syncMessage.textContent=error.message;syncButton.hidden=false;}
      finally {syncing=false;syncButton.disabled=false;place();}
    }
    syncButton.addEventListener('click',()=>void syncRecords(true));
    root.addEventListener('online',()=>void syncRecords(false,true));
    let active=null,displayed=null,busy=false,polling=false,historyOffset=0,historyVersion=0,viewVersion=0,initial=true;
    const source=new ol.source.Vector();
    const layer=new ol.layer.Vector({source});
    layer.setVisible(false);
    const index=map.getLayers().getArray().indexOf(insertBefore);
    if(index>=0)map.getLayers().insertAt(index,layer);else map.addLayer(layer);
    const km=value=>(Number(value||0)/1000).toFixed(2)+' km';
    const elapsed=track=>Math.max(0,Math.floor(((track.ended_at || Date.now())-track.started_at)/60000))+'분';
    const date=value=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
    function place() {
      if(panel.hidden)return;
      const r=button.getBoundingClientRect();
      panel.style.left=Math.max(8,Math.min(r.left,innerWidth-panel.offsetWidth-8))+'px';
      panel.style.top=Math.max(8,Math.min(r.top-panel.offsetHeight-8,innerHeight-panel.offsetHeight-8))+'px';
    }
    function paint() {
      button.classList.toggle('is-recording',!!active);
      button.textContent=active?'● 기록 중 · '+elapsed(active):'이동 기록';
      button.setAttribute('aria-expanded',String(!panel.hidden));
      start.hidden=!!active;stop.hidden=!active;
      start.disabled=busy;stop.disabled=busy;hide.hidden=!displayed || !!active;
      refreshButton.disabled=busy;summary.hidden=!active&&!displayed;
      filterPanel.querySelectorAll('[data-period],[data-team]').forEach(button=>{button.disabled=busy;});
      for(const name of ['day','month','year'])search.elements[name].disabled=busy||search.elements[name].hidden;
      if(active) summary.textContent=`${active.owner} · ${active.team_name} / ${elapsed(active)} · ${km(active.distance)}${active.point_count ? '' : ' · GPS 수신 대기'}`;
      else if(displayed) summary.textContent=`${date(displayed.started_at)} · ${elapsed(displayed)} · ${km(displayed.distance)}${displayed.status==='interrupted'?' · 중단된 기록':''}`;
      else summary.textContent='기록을 시작하면 이동 경로가 지도에 표시됩니다.';
      place();
    }
    function draw(track,fit) {
      displayed=track; source.clear();
      history.querySelectorAll('[data-track-id]').forEach(row=>row.classList.toggle('is-selected',row.dataset.trackId===String(track.id)));
      const points=(track.points||[]).map(point=>project(point.lat,point.lng));
      const team=root.BearAppSettings?.store.snapshot().items.find(item=>item.id===track.team_id);
      const teamColor=team?.color||track.team_color;
      const color=/^#[0-9a-f]{6}$/i.test(teamColor||'')?teamColor:'#2563EB';
      if(points.length>1){
        const line=new ol.Feature(new ol.geom.LineString(points));
        line.setStyle([new ol.style.Style({stroke:new ol.style.Stroke({color:'#ffffff',width:6})}),new ol.style.Style({stroke:new ol.style.Stroke({color,width:3})})]); source.addFeature(line);
      }
      (points.length===1?[0]:[0,points.length-1]).forEach((index,i)=>{
        if(index<0 || !points.length)return;
        const point=new ol.Feature(new ol.geom.Point(points[index]));
        point.setStyle(new ol.style.Style({image:new ol.style.Circle({radius:6,fill:new ol.style.Fill({color:i?color:'#ffffff'}),stroke:new ol.style.Stroke({color:i?'#ffffff':color,width:2.5})}),
          text:new ol.style.Text({text:points.length===1?'기록 위치':i?(track.status==='recording'?'현재':'종료'):'시작',offsetY:i?17:-17,font:'700 11px sans-serif',fill:new ol.style.Fill({color:'#243c56'}),stroke:new ol.style.Stroke({color:'#ffffff',width:3})})}));source.addFeature(point);
      });
      if(fit&&points.length)map.getView().fit(source.getExtent(),{padding:[70,70,100,70],maxZoom:16,duration:450});
      paint();
    }
    async function show(id,fit,sharedOnly=false) {
      const version=++viewVersion;
      const track=await (sharedOnly ? syncClient.sharedDetail(id) : plugin.detail({id}));
      if(version!==viewVersion)return;
      if(!track)throw new Error('기록을 찾을 수 없습니다.');
      draw(track,fit);
      if(track.error)message.textContent=track.error;
      else if(!track.point_count)message.textContent=active?.id===track.id?'GPS 수신 대기 중입니다. 정확한 위치를 받으면 자동으로 기록합니다.':'저장된 GPS 지점이 없습니다.';
    }
    let historyRows=[];
    async function loadHistory(reset=true, limit=30) {
      const version=++historyVersion;
      more.disabled=true;
      try {
        const result=await syncClient.list({...appliedQuery,offset:reset?0:historyOffset},limit);if(version!==historyVersion)return;
        if(reset){historyOffset=0;historyRows=[];}
        const rows=result.items||[];
        const byId=new Map(historyRows.map(track=>[String(track.id),track]));
        rows.forEach(track=>byId.set(String(track.id),track));
        historyRows=filters.sortHistory([...byId.values()]);
        history.replaceChildren();
        historyLoaded=true;count.textContent=Number(result.total||0)+'건';if(reset)paintTeams(result.teams);
        if(reset&&!rows.length){const empty=document.createElement('tr'),cell=document.createElement('td');cell.colSpan=5;cell.className='gps-history-empty';cell.textContent=appliedQuery.owner||appliedQuery.team_id||appliedQuery.from!=null?'검색 결과가 없습니다.':'저장된 기록이 없습니다.';empty.append(cell);history.append(empty);}
        historyRows.forEach(track=>{
          const row=document.createElement('tr');row.dataset.trackId=String(track.id);
          row.classList.toggle('is-selected',String(displayed?.id)===String(track.id));
          function cell(text,className=''){
            const td=document.createElement('td');td.className=className;
            const span=document.createElement('span');span.textContent=text;span.title=text;td.append(span);row.append(td);return td;
          }
          const when=new Date(track.started_at),dateCell=document.createElement('td'),open=document.createElement('button');
          open.type='button';open.className='gps-history-open';open.setAttribute('aria-label',date(track.started_at)+' '+(track.owner||'미지정')+' 이동 경로 보기');
          const day=document.createElement('span');day.textContent=when.toLocaleDateString('ko-KR',{timeZone:'Asia/Seoul',year:'2-digit',month:'2-digit',day:'2-digit'}).replace(/\.\s*/g,'.').replace(/\.$/,'');
          const time=document.createElement('small');time.textContent=when.toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
          if(track.status==='recording'||track.status==='interrupted'){
            const state=document.createElement('i');state.className='gps-history-state '+(track.status==='recording'?'is-recording':'is-interrupted');state.title=track.status==='recording'?'기록 중':'중단된 기록';state.setAttribute('aria-label',state.title);time.prepend(state);
          }
          open.append(day,time);open.title=date(track.started_at);dateCell.append(open);row.append(dateCell);
          cell(track.owner||'미지정');
          const team=cell(track.team_name||'미지정','gps-history-team');
          const dot=document.createElement('i');dot.setAttribute('aria-hidden','true');dot.style.background=/^#[0-9a-f]{6}$/i.test(track.team_color||'')?track.team_color:'#7e90a2';team.prepend(dot);
          cell(elapsed(track),'gps-history-number');cell((Number(track.distance||0)/1000).toFixed(2),'gps-history-number');
          row.addEventListener('click',()=>void action(async()=>{message.textContent='';await show(track.id,true,track.sharedOnly);}));history.append(row);
        });
        historyOffset+=rows.length;more.hidden=historyOffset>=Number(result.total||0);
      } finally {if(version===historyVersion){more.disabled=false;place();}}
    }
    let refreshingShared=false,lastSharedRefresh=0;
    async function refreshSharedHistory(force=false) {
      if(panel.hidden||document.hidden||refreshingShared||(!force&&Date.now()-lastSharedRefresh<15000))return;
      refreshingShared=true;lastSharedRefresh=Date.now();
      try {
        await syncClient.refreshShared();
        count.removeAttribute('title');
        if(!panel.hidden&&!busy)await loadHistory(true,Math.max(30,historyOffset));
      } catch (_) {
        if(!panel.hidden&&!busy) {
          await loadHistory(true,Math.max(30,historyOffset)).catch(()=>{});
          const empty=history.querySelector('.gps-history-empty');
          if(empty)empty.textContent='기록을 불러오지 못했습니다.';
        }
      } finally {refreshingShared=false;}
    }
    async function action(fn) {
      if(busy)return;busy=true;paint();
      try{await fn();}catch(error){message.textContent=error.message||String(error);}
      finally{busy=false;paint();}
    }
    async function poll() {
      if(polling||document.hidden||busy)return;polling=true;
      try{
        const result=await plugin.status();if(busy)return;const previous=active;active=result.active||null;
        if(result.other_tab)message.textContent='다른 웹 창에서 이동 기록을 사용 중입니다.';
        else if(result.error)message.textContent=result.error;
        if(active && (initial || displayed?.id===active.id || !displayed)) {
          if(displayed?.id!==active.id||displayed?.point_count!==active.point_count)await show(active.id,false);
          if(result.location_warning)message.textContent=result.location_warning;
          else if(!result.error)message.textContent=active.point_count?'':'GPS 수신 대기 중입니다. 정확한 위치를 받으면 자동으로 기록합니다.';
        } else if(previous&&!active){
          ++viewVersion;source.clear();displayed=null;
          const finished=await plugin.detail({id:previous.id});
          message.textContent=finished?.error || '이동 기록을 저장했습니다.';
          void syncRecords(false,true);
          if(historyLoaded)await loadHistory();
        }
      initial=false;paint();void syncRecords();void refreshSharedHistory();
      }catch(error){message.textContent=error.message||String(error);}
      finally{polling=false;}
    }
    start.addEventListener('click',()=>void action(async()=>{
      const identity=await root.BearAppSettings.requireIdentity();
      await root.BearAppSettings.store.load();
      const options=root.BearAppSettings.store.snapshot().tracking;
      active=await plugin.start({...identity,...options});displayed=null;++viewVersion;source.clear();
      message.textContent=native?'GPS 수신을 기다리고 있습니다.':'웹은 화면이 꺼지거나 페이지를 닫으면 기록이 중단될 수 있습니다.';
      await show(active.id,false);
      await loadHistory();
    }));
    stop.addEventListener('click',()=>void action(async()=>{
      const activeId=active?.id;
      let result=await plugin.stop();
      if(!result.id&&activeId)result=await plugin.detail({id:activeId});
      if(result.status==='recording')throw new Error('기록 종료를 완료하지 못했습니다. 다시 시도해주세요.');
      active=null;displayed=null;++viewVersion;source.clear();message.textContent=result.status==='discarded'?(result.error||'GPS 위치가 수신되지 않아 기록을 저장하지 않았습니다.'):'이동 기록을 저장했습니다.';
      void syncRecords(false,true);
      await loadHistory();
    }));
    hide.addEventListener('click',()=>{++viewVersion;source.clear();displayed=null;message.textContent='';paint();});
    function close(){layer.setVisible(false);setFilterPanelOpen(false);panel.hidden=true;button.setAttribute('aria-expanded','false');if(root.BearMobileDock?.isMobile()&&root.BearMobileDock.getActive()==='tracking')root.BearMobileDock.collapse();}
    function open(){panel.hidden=false;layer.setVisible(true);displayed=null;++viewVersion;source.clear();root.BearMobileDock?.select('tracking',{activate:false});setFilterPanelOpen(false);paint();void action(()=>loadHistory()).then(()=>refreshSharedHistory(true)).then(()=>poll());}
    button.addEventListener('click',()=>{if(panel.hidden){open();(active?stop:start).focus();}else close();});
    panel.querySelector('[data-close]').addEventListener('click',close);
    refreshButton.addEventListener('click',()=>void action(()=>loadHistory()).then(()=>refreshSharedHistory(true)));
    filterButton.addEventListener('click',()=>setFilterPanelOpen(filterPanel.hidden));
    async function applyFilters(close=false){
      const next=filters.buildQuery({owner:search.elements.owner.value,team_id:teamId,period,day:search.elements.day.value,month:search.elements.month.value,year:search.elements.year.value});
      appliedQuery=next;message.textContent='';paintFilterState();
      await loadHistory();if(close)setFilterPanelOpen(false);
    }
    filterPanel.addEventListener('click',event=>{
      const button=event.target.closest('[data-period],[data-team]');if(!button||busy)return;
      if(button.hasAttribute('data-period')){period=button.dataset.period;periodFields();}
      else{teamId=button.dataset.team;teamChips.querySelectorAll('[data-team]').forEach(item=>item.setAttribute('aria-pressed',String(item.dataset.team===teamId)));}
      void action(()=>applyFilters());
    });
    for(const name of ['day','month','year'])search.elements[name].addEventListener('change',()=>void action(()=>applyFilters()));
    search.addEventListener('submit',event=>{event.preventDefault();void action(()=>applyFilters(true));});
    panel.querySelector('[data-reset]').addEventListener('click',()=>void action(async()=>{
      search.elements.owner.value='';teamId='';period='all';periodFields();
      appliedQuery=filters.buildQuery();message.textContent='';setFilterPanelOpen(false);await loadHistory();
    }));
    more.addEventListener('click',()=>void action(()=>loadHistory(false)));
    panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.stopPropagation();close();button.focus();}});
    root.addEventListener('resize',place);root.addEventListener('pageshow',event=>{if(event.persisted){root.location.reload();return;}void poll();});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)void poll();});
    const timer=setInterval(()=>void poll(),3000);root.addEventListener('pagehide',()=>clearInterval(timer),{once:true});
    async function updateInterval(interval_seconds) {
      if(busy)throw new Error('이동 기록 작업을 마친 후 다시 저장해주세요.');
      busy=true;paint();
      try {
        const result=await plugin.updateInterval({interval_seconds});
        active=result.active||null;
        if(active && displayed?.id===active.id)displayed={...displayed,interval_seconds:active.interval_seconds};
      } finally {busy=false;paint();}
    }
    void poll();return {open,close,panel,refreshPlacement:paint,isOpen:()=>!panel.hidden,updateInterval,setMapVisible:visible=>layer.setVisible(visible)};
  };
})(window);
