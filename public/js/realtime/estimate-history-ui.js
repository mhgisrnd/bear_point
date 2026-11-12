(function(root){
  'use strict';
  root.createEstimateHistoryUi=function({ol,projection,resolutions,getBaseLayers,loadItems,registerBack}){
    const dialog=document.createElement('dialog');dialog.className='estimate-history';
    dialog.setAttribute('aria-labelledby','estimate-history-title');
    dialog.innerHTML=`<header class="estimate-history-head"><button type="button" data-back aria-label="상세정보로 돌아가기"><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m12 4-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><h2 id="estimate-history-title"></h2></header>
      <form class="estimate-history-filter" aria-label="추정 위치 이력 기간 필터">
        <label for="estimate-history-period">등록 기간</label><select id="estimate-history-period" name="period"><option value="all" selected>전체 기간</option><option value="day">일별</option><option value="month">월별</option><option value="year">년별</option><option value="range">기간 지정</option></select>
        <input type="date" name="day" aria-label="조회 날짜" hidden><input type="month" name="month" aria-label="조회 월" hidden><input type="number" min="1900" max="9999" name="year" aria-label="조회 연도" hidden>
        <button type="button" class="list-search-reset" data-reset disabled>초기화</button>
        <div class="estimate-history-range" data-range hidden><input type="date" name="start" aria-label="조회 시작일"><span>~</span><input type="date" name="end" aria-label="조회 종료일"></div>
      </form>
      <p class="estimate-history-notice" role="status" aria-live="polite" hidden></p>
      <div class="estimate-history-workspace"><div class="estimate-history-map-wrap"><div class="estimate-history-map" aria-label="개체 추정 위치 이력 지도"></div><button class="estimate-history-fit" type="button" data-fit>전체 보기</button></div>
      <section class="estimate-history-panel" aria-label="추정 위치 이력"><div class="estimate-history-panel-head"><strong data-count>추정 위치 0건</strong><button type="button" data-clear-group hidden>전체 이력</button><button type="button" data-toggle aria-label="이력 목록 펼치기" title="이력 목록 펼치기" aria-expanded="false" aria-controls="estimate-history-list"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m7 14 5-5 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div><div class="estimate-history-card" data-card></div><div class="estimate-history-list" id="estimate-history-list" hidden></div></section></div>
      <p class="estimate-history-foot">추정 위치를 연결한 경과이며 실제 이동 경로와 다를 수 있습니다.</p>`;
    document.body.appendChild(dialog);
    const node=selector=>dialog.querySelector(selector),form=node('form'),notice=node('.estimate-history-notice');
    const list=node('.estimate-history-list'),card=node('[data-card]'),toggle=node('[data-toggle]'),mapTarget=node('.estimate-history-map');
    const filters=root.BearObservationFilters,model=root.BearEstimateHistoryModel;
    const today=filters.dateKey(new Date());
    form.elements.period.value='all';
    for(const [key,value]of Object.entries({day:today,month:today.slice(0,7),year:today.slice(0,4),start:today,end:today}))form.elements[key].value=value;
    let map=null,source=null,layers=[],records=[],visible=[],selected=null,seed=null,controller=null,version=0,unregister=null,showCount=30,loadNotice='';
    let overlapIds=null,currentId=null;
    let baseSources=[],tileNotice='';
    const wide=root.matchMedia('(min-width:900px) and (orientation:landscape)');
    const reducedMotion=root.matchMedia('(prefers-reduced-motion: reduce)');
    let animationFrame=null,animationStart=null,lastAnimationPaint=0,routeStroke=null,currentPulses=[];
    function stopAnimation(){
      if(animationFrame!==null)root.cancelAnimationFrame?.(animationFrame);
      animationFrame=null;animationStart=null;lastAnimationPaint=0;
    }
    function animateHistory(timestamp){
      animationFrame=null;
      if(!dialog.open||!map||document.hidden||reducedMotion.matches||!Number.isFinite(timestamp))return;
      if(animationStart===null)animationStart=timestamp;
      if(timestamp-lastAnimationPaint>=32){
        const elapsed=timestamp-animationStart,phase=(elapsed%1600)/1600;
        routeStroke?.setLineDashOffset(-(elapsed/1000*24)%13);
        for(const pulse of currentPulses){pulse.stroke.setColor('rgba(15,159,136,'+((1-phase)*.4)+')');pulse.image.setRadius(13+phase*8);}
        source?.changed();lastAnimationPaint=timestamp;
      }
      animationFrame=root.requestAnimationFrame(animateHistory);
    }
    function startAnimation(){
      if(animationFrame!==null||!dialog.open||!map||document.hidden||reducedMotion.matches||typeof root.cancelAnimationFrame!=='function'||(!routeStroke&&!currentPulses.length))return;
      animationFrame=root.requestAnimationFrame(animateHistory);
    }
    const date=value=>new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
    function period(){return Object.fromEntries(['period','day','month','year','start','end'].map(key=>[key,form.elements[key].value]));}
    function coords(row){return ol.proj.transform([row.lng,row.lat],'EPSG:4326',projection);}
    function method(row){const span=document.createElement('span');span.className='estimate-history-method';span.dataset.method=row.method;span.textContent=row.method==='single'?'단일 관측':row.method==='intersection'?'교차 분석':'방식 미상';return span;}
    function title(row,index){
      const line=document.createElement('div');line.className='estimate-history-item-title';
      const text=document.createElement('strong');text.textContent=(index+1)+' · '+date(row.time);line.appendChild(text);
      if(row.id===currentId){const badge=document.createElement('span');badge.className='estimate-history-current';badge.textContent='현재';line.appendChild(badge);}
      line.appendChild(method(row));return line;
    }
    function details(row){return (row.owner||'담당자 미지정')+' · '+(row.team_name||'팀 미지정');}
    function setExpanded(expanded,refit=true){
      dialog.classList.toggle('is-expanded',expanded);list.hidden=!expanded;card.hidden=expanded;
      const label=expanded?'이력 목록 접기':'이력 목록 펼치기';toggle.setAttribute('aria-label',label);toggle.title=label;toggle.setAttribute('aria-expanded',String(expanded));
      root.requestAnimationFrame(()=>{if(map){map.updateSize();if(refit)fit();}if(expanded)list.querySelector('[aria-pressed="true"]')?.scrollIntoView?.({block:'nearest'});});
    }
    function fit(){if(map&&source?.getFeatures().length)map.getView().fit(source.getExtent(),{padding:[45,45,45,45],maxZoom:16,duration:200});}
    function paintCard(){
      card.replaceChildren();
      const index=visible.findIndex(row=>row.id===selected),row=visible[index];
      if(!row){const text=document.createElement('p');text.textContent='선택한 기간에 추정 위치가 없습니다.';card.appendChild(text);return;}
      card.appendChild(title(row,index));
      for(const value of [details(row),row.admin_region||row.place||'위치 미지정']){const text=document.createElement('p');text.textContent=value;card.appendChild(text);}
    }
    function paintList(){
      list.replaceChildren();
      const rows=visible.filter(row=>!overlapIds||overlapIds.has(row.id)).reverse();
      for(const row of rows.slice(0,showCount)){
        const button=document.createElement('button');button.type='button';button.dataset.record=row.id;button.setAttribute('aria-pressed',String(row.id===selected));
        button.dataset.current=String(row.id===currentId);
        button.appendChild(title(row,visible.indexOf(row)));
        const text=document.createElement('small');text.textContent=details(row)+' · '+(row.admin_region||row.place||'위치 미지정');button.appendChild(text);
        button.addEventListener('click',()=>select(row.id,true));list.appendChild(button);
      }
      if(!rows.length){const empty=document.createElement('p');empty.className='estimate-history-empty';empty.textContent='조회 기간에 이력이 없습니다.';list.appendChild(empty);}
    }
    function select(id,move=false){
      selected=id;const scroll=list.scrollTop;
      paintCard();paintList();list.scrollTop=scroll;source?.changed();
      if(!list.hidden)list.querySelector('[aria-pressed="true"]')?.scrollIntoView?.({block:'nearest'});
      const row=visible.find(item=>item.id===id);
      if(move&&row){
        const currentMap=map;
        root.requestAnimationFrame(()=>{
          if(!map||map!==currentMap||selected!==id)return;
          map.updateSize();
          const view=map.getView();view.cancelAnimations?.();
          view.animate({center:coords(row),duration:220});
        });
      }
    }
    function paintCount(){
      node('[data-count]').textContent=overlapIds?'겹친 이력 '+overlapIds.size+'건':('추정 위치 '+visible.length+'건'+(period().period!=='all'?' (전체 '+records.length+'건)':''));
      node('[data-clear-group]').hidden=!overlapIds;
      node('[data-reset]').disabled=period().period==='all'&&!overlapIds;
    }
    function openGroup(ids){
      overlapIds=new Set(ids);showCount=Math.max(30,ids.length);
      if(!overlapIds.has(selected))selected=ids.at(-1);
      paintCount();setExpanded(true,false);select(selected,true);
    }
    function focusMarkerRecord(id){
      overlapIds=null;showCount=Math.max(showCount,visible.length-visible.findIndex(row=>row.id===id));
      paintCount();setExpanded(true,false);select(id,true);
      list.querySelector('[aria-pressed="true"]')?.focus?.({preventScroll:true});
    }
    function draw(){
      if(!source)return;stopAnimation();routeStroke=null;currentPulses=[];source.clear();
      const points=visible.map(coords);
      if(points.length>1){
        const line=new ol.Feature(new ol.geom.LineString(points));
        routeStroke=new ol.style.Stroke({color:'#2563eb',width:2.5,lineDash:[7,6]});
        line.setStyle(new ol.style.Style({stroke:routeStroke}));source.addFeature(line);
        const stride=Math.max(1,Math.ceil((points.length-1)/40));
        for(let i=1;i<points.length;i+=stride){
          const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1];if(Math.hypot(dx,dy)<1)continue;
          const arrow=new ol.Feature(new ol.geom.Point([(a[0]+b[0])/2,(a[1]+b[1])/2]));
          arrow.setStyle(new ol.style.Style({image:new ol.style.RegularShape({points:3,radius:6,rotation:Math.PI/2-Math.atan2(dy,dx),rotateWithView:true,fill:new ol.style.Fill({color:'#2563eb'})})}));source.addFeature(arrow);
        }
      }
      const resolution=map?.getView().getResolution?.()||1;
      model.groupPoints(points,resolution).forEach(group=>{
        const ids=group.indices.map(index=>visible[index].id),multiple=ids.length>1;
        const feature=new ol.Feature(new ol.geom.Point(group.coordinate));feature.set('recordIds',ids);
        feature.set('recordIndices',group.indices);
        const pulse=ids.includes(currentId)?{stroke:new ol.style.Stroke({color:'rgba(15,159,136,.25)',width:2})}:null;
        if(pulse){pulse.image=new ol.style.Circle({radius:13,stroke:pulse.stroke});currentPulses.push(pulse);}
        let cachedKey=null,cachedStyles=null;
        feature.setStyle(()=>{
          const key=selected+':'+currentId;
          if(cachedKey===key)return cachedStyles;
          const chosen=ids.includes(selected),latest=ids.includes(currentId),index=group.indices[0];
          const currentIndex=visible.findIndex(row=>row.id===currentId);
          const selectedIndex=visible.findIndex(row=>row.id===selected);
          const badge=multiple?root.BearEstimateHistoryMarkers.badge(group.indices,selectedIndex,currentIndex):null;
          feature.set('historyBadge',badge,true);
          const marker=badge||root.BearEstimateHistoryMarkers.single(index,selectedIndex,currentIndex);
          const image=new ol.style.Icon({src:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(marker.svg),anchor:badge?[.5,1]:[.5,.5]});
          const styles=[new ol.style.Style({zIndex:chosen?5:latest?4:2,image})];
          if(latest){
            styles.push(new ol.style.Style({zIndex:6,text:new ol.style.Text({text:'현재',offsetX:badge?.currentOffsetX||0,offsetY:badge?-badge.height-7:-24,font:'700 11px sans-serif',fill:new ol.style.Fill({color:'#087f6c'}),stroke:new ol.style.Stroke({color:'#fff',width:4})})}));
          }
          if(pulse){pulse.image.setDisplacement(badge?[badge.currentOffsetX,badge.height-20]:[0,0]);styles.push(new ol.style.Style({zIndex:1,image:pulse.image}));}
          cachedKey=key;cachedStyles=styles;return styles;
        });source.addFeature(feature);
      });
      node('[data-fit]').disabled=!points.length;
      startAnimation();
    }
    function render(){
      const selectedPeriod=period(),invalid=filters.periodKey(selectedPeriod)===null;
      visible=invalid?[]:model.filter(records,selectedPeriod,filters);
      if(!visible.some(row=>row.id===selected))selected=visible.at(-1)?.id||null;
      const selectedIndex=visible.findIndex(row=>row.id===selected);
      if(selectedIndex>=0)showCount=Math.max(showCount,visible.length-selectedIndex);
      notice.textContent=invalid?'조회 기간을 올바르게 입력해주세요.':[loadNotice,tileNotice].filter(Boolean).join(' ');notice.hidden=!notice.textContent;
      paintCount();
      paintCard();paintList();draw();root.requestAnimationFrame(()=>{map?.updateSize();fit();});
    }
    function periodFields(){
      const value=form.elements.period.value;
      for(const name of ['day','month','year']){form.elements[name].hidden=name!==value;form.elements[name].disabled=name!==value;}
      node('[data-range]').hidden=value!=='range';
      for(const name of ['start','end'])form.elements[name].disabled=value!=='range';
    }
    function createMap(){
      source=new ol.source.Vector();
      layers=root.BearEstimateHistoryTiles.clone(ol,getBaseLayers());
      baseSources=layers.map(layer=>layer.getSource());
      for(const tiles of baseSources)tiles.on('tileloaderror',()=>{
        if(!dialog.open||!map||!baseSources.includes(tiles))return;
        tileNotice='이력 지도의 일부를 불러오지 못했습니다. 네트워크 상태를 확인해주세요.';
        notice.textContent=[loadNotice,tileNotice].filter(Boolean).join(' ');notice.hidden=false;
      });
      const vector=new ol.layer.Vector({source});layers.push(vector);
      const initial=records.find(row=>row.id===String(seed.id))||records[0];
      const center=initial?coords(initial):ol.proj.transform([127.6,35.3],'EPSG:4326',projection);
      map=new ol.Map({target:mapTarget,layers,view:new ol.View({projection,resolutions,center,zoom:15,constrainRotation:false}),controls:ol.control.defaults.defaults({zoom:false,rotate:false})});
      map.on('singleclick',event=>{
        const feature=map.forEachFeatureAtPixel(event.pixel,feature=>feature.get('recordIds')?feature:undefined,{layerFilter:layer=>layer===vector,hitTolerance:8});
        if(!feature)return;
        const ids=feature.get('recordIds');
        if(ids.length===1){focusMarkerRecord(ids[0]);return;}
        const badge=feature.get('historyBadge')||root.BearEstimateHistoryMarkers.badge(feature.get('recordIndices'),visible.findIndex(row=>row.id===selected),visible.findIndex(row=>row.id===currentId));
        const anchor=map.getPixelFromCoordinate(feature.getGeometry().getCoordinates());
        const index=anchor?root.BearEstimateHistoryMarkers.hitIndex(badge,event.pixel[0]-anchor[0]+badge.width/2,event.pixel[1]-anchor[1]+badge.height):null;
        if(index!==null)focusMarkerRecord(visible[index].id);else openGroup(ids);
      });
      map.on('moveend',draw);
    }
    function close(){
      stopAnimation();routeStroke=null;currentPulses=[];
      version++;controller?.abort();controller=null;unregister?.();unregister=null;
      if(dialog.open)dialog.close();
      const ownedSources=baseSources;baseSources=[];
      map?.setTarget(undefined);map?.dispose();map=null;
      for(const layer of layers)layer.setSource(null);layers=[];source=null;
      for(const tiles of ownedSources)tiles.dispose();
    }
    async function open(item){
      if(dialog.open)close();seed=item;selected=String(item.id);currentId=String(item.id);showCount=30;overlapIds=null;tileNotice='';loadNotice='이력을 불러오는 중입니다.';
      records=model.normalize([item]);periodFields();dialog.querySelector('h2').textContent=item.bear_code||item.bearCode;
      dialog.showModal();unregister=registerBack?.(dialog,close);createMap();setExpanded(wide.matches);render();
      const current=++version;controller=new AbortController();
      try{
        const result=await loadItems(item,controller.signal);
        if(current!==version)return;
        records=model.normalize(result.items);loadNotice=result.notice||'';
        currentId=records.filter(row=>row.active===true).at(-1)?.id||String(seed.id);
        selected=String(seed.id);render();
      }catch(error){if(current!==version)return;records=[];loadNotice=(error.message||'이력을 불러오지 못했습니다.')+' 창을 닫고 다시 시도해주세요.';render();}
    }
    node('[data-back]').addEventListener('click',close);
    dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
    toggle.addEventListener('click',()=>setExpanded(!dialog.classList.contains('is-expanded')));node('[data-fit]').addEventListener('click',fit);
    node('[data-clear-group]').addEventListener('click',()=>{overlapIds=null;showCount=Math.max(30,visible.length-visible.findIndex(row=>row.id===selected));paintCount();paintList();});
    node('[data-reset]').addEventListener('click',()=>{
      const day=filters.dateKey(new Date());form.elements.period.value='all';
      for(const [key,value]of Object.entries({day,month:day.slice(0,7),year:day.slice(0,4),start:day,end:day}))form.elements[key].value=value;
      overlapIds=null;selected=String(seed.id);showCount=30;periodFields();render();
    });
    list.addEventListener('scroll',()=>{
      const total=visible.filter(row=>!overlapIds||overlapIds.has(row.id)).length;
      if(list.clientHeight>0&&showCount<total&&list.scrollHeight-list.clientHeight-list.scrollTop<100){const scroll=list.scrollTop;showCount+=30;paintList();list.scrollTop=scroll;}
    },{passive:true});
    form.addEventListener('submit',event=>{event.preventDefault();document.activeElement?.blur?.();});
    form.addEventListener('change',()=>{overlapIds=null;periodFields();showCount=30;render();});
    form.addEventListener('click',event=>{if(event.target.matches('input[type=date],input[type=month]'))try{event.target.showPicker?.();}catch(_){} });
    root.addEventListener('resize',()=>{if(dialog.open){if(wide.matches)setExpanded(true);map?.updateSize();fit();}});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAnimation();else startAnimation();});
    reducedMotion.addEventListener?.('change',()=>{
      stopAnimation();routeStroke?.setLineDashOffset(0);
      for(const pulse of currentPulses){pulse.stroke.setColor('rgba(15,159,136,.25)');pulse.image.setRadius(13);}
      source?.changed();startAnimation();
    });
    return {open,close,isOpen:()=>dialog.open};
  };
})(window);
