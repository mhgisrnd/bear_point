(function (root) {
  "use strict";
  root.createMobileMapDock = function ({ observations, gps, onBeforeOpen, expandBears, setSidebarCollapsed }) {
    const tablet = root.matchMedia('(min-width: 900px) and (orientation: landscape)');
    const obs = document.getElementById('obs-sheet'), bears = document.getElementById('panel'), track = gps.panel;
    const oldObs = document.getElementById('btn-obs-list'), oldGps = document.getElementById('btn-gps-tracking');
    const registration = document.getElementById('register-box');
    const dock = document.createElement('section'); dock.setAttribute('id','mobile-map-dock'); dock.hidden=true; dock.setAttribute('aria-label','지도 메뉴');
    const icon = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    dock.innerHTML=`<div class="mobile-dock-head"><button type="button" class="mobile-dock-fold" aria-controls="mobile-dock-content" aria-expanded="false"><span class="mobile-dock-grip" aria-hidden="true"></span><strong></strong><span class="mobile-dock-chevron" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 14 5-5 5 5"/></svg></span></button><div class="mobile-dock-actions"></div></div>
      <p class="mobile-dock-notice" role="status" aria-live="polite" hidden></p>
      <div class="mobile-dock-content" id="mobile-dock-content" hidden></div>
      <nav class="mobile-dock-nav" aria-label="지도 기능">
        <button type="button" data-menu="observations">${icon('<path d="m7 21 5-17 5 17M9 14h6M8 18h8M5 5a10 10 0 0 0 0 8m14-8a10 10 0 0 1 0 8M8 7a6 6 0 0 0 0 4m8-4a6 6 0 0 1 0 4"/>')}<span>관측점</span></button>
        <button type="button" data-menu="bears">${icon('<circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M4 12a8 8 0 0 1 16 0v2a8 8 0 0 1-16 0z"/><path d="M9 11h.01M15 11h.01m-5 4 2 2 2-2"/>')}<span>개체 추적</span></button>
        <button type="button" data-menu="tracking">${icon('<circle cx="5" cy="18" r="3"/><circle cx="19" cy="6" r="3"/><path d="M5 15v-3a4 4 0 0 1 4-4h6m4 1v3a4 4 0 0 1-4 4h-4"/>')}<span>이동 기록</span><i class="mobile-recording-dot" hidden aria-label="기록 중"></i></button>
      </nav>`;
    document.body.append(dock);
    const content=dock.querySelector('.mobile-dock-content'),fold=dock.querySelector('.mobile-dock-fold');
    const actions=dock.querySelector('.mobile-dock-actions'),title=fold.querySelector('strong');
    const notice=dock.querySelector('.mobile-dock-notice'),status=document.getElementById('status');
    const nav=[...dock.querySelectorAll('[data-menu]')];
    const panels={observations:obs,bears,tracking:track};
    const names={observations:'관측점',bears:'개체 추적',tracking:'이동 기록'};
    const obsActions=obs.querySelector('.obs-header-actions'),bearRefresh=document.getElementById('btn-bears-refresh');
    const trackActions=track.querySelector('.gps-track-header-actions');
    const homes=new Map();
    for(const element of [obs,bears,track,obsActions,bearRefresh,trackActions].filter(Boolean)) {
      const marker=document.createComment('mobile dock home');element.before(marker);homes.set(element,marker);
    }
    let active='bears',expanded=false,full=false,filtering=false,mobile=null,restoring=false,registrationWasOpen=false,restoreExpanded=false,restoreFull=false;
    function restore(element){const marker=homes.get(element);marker.parentNode.insertBefore(element,marker.nextSibling);}
    function measure(){
      if(!mobile)return;
      document.body.style.setProperty('--mobile-dock-height',Math.ceil(dock.getBoundingClientRect().height)+'px');
      const controls=document.querySelector('.map-right-controls');
      if(controls)document.body.style.setProperty('--mobile-controls-height',Math.ceil(controls.getBoundingClientRect().height)+'px');
    }
    let showObservationsOnSave=false;
    function paint(){
      if(mobile===null)return;
      if(!mobile)expanded=true;
      dock.dataset.menu=active;dock.classList.toggle('is-expanded',expanded);content.hidden=!expanded;
      dock.classList.toggle('is-full',expanded&&full);
      dock.classList.toggle('is-filtering',expanded&&active==='tracking'&&filtering);
      observations.setMapVisible(registrationWasOpen||(active==='observations'&&expanded&&(!tablet.matches||!document.body.classList.contains('bp-sidebar-collapsed'))));
      gps.setMapVisible?.(active==='tracking'&&!registrationWasOpen);
      fold.disabled=!mobile;
      fold.setAttribute('aria-expanded',String(expanded));fold.setAttribute('aria-label',names[active]+(expanded?' 접기':' 펼치기'));
      title.textContent=names[active];
      if(active==='observations'&&!expanded)title.textContent+=' '+(document.getElementById('obs-list-count').textContent||'');
      if(active==='tracking'&&oldGps.classList.contains('is-recording'))title.textContent=oldGps.textContent;
      nav.forEach(button=>{
        const selected=button.dataset.menu===active;button.classList.toggle('is-active',selected);
        if(selected)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
      });
      for(const [name,element]of Object.entries(panels))element.classList.toggle('mobile-dock-inactive',name!==active);
      restore(obsActions);restore(bearRefresh);
      if(trackActions)restore(trackActions);
      if(active==='observations')actions.append(obsActions);
      if(active==='bears')actions.append(bearRefresh);
      if(active==='tracking'&&trackActions)actions.append(trackActions);
      const recording=oldGps.classList.contains('is-recording');
      dock.querySelector('.mobile-recording-dot').hidden=!recording;
      dock.querySelector('[data-menu="tracking"]').setAttribute('aria-label',recording?'이동 기록 · 기록 중':'이동 기록');
      paintStatus();
      root.requestAnimationFrame(measure);
    }
    function paintStatus(){
      const text=String(status?.textContent||'').trim();
      bears.classList.toggle('has-transient-status',!!text&&text!=='반달가슴곰 위치추적분석');
      notice.hidden=active==='bears'||!text||text==='반달가슴곰 위치추적분석';
      notice.textContent=notice.hidden?'':text;
    }
    function select(name,{activate=true,open=true}={}){
      if(mobile===null||!panels[name])return;
      if(registration&&!registration.classList.contains('hidden'))return;
      if(active!==name||!expanded)full=false;
      if(active!==name)filtering=false;
      active=name;expanded=open;
      if(!mobile)setSidebarCollapsed?.(false);
      onBeforeOpen?.();
      if(name!=='tracking')gps.close();
      if(activate){
        if(name==='observations'){
          if(observations.getCurrentTab()==='list')observations.showPanel();else observations.openList();
        }else if(name==='tracking')gps.open();
        else expandBears();
      }
      paint();
    }
    function collapse(){
      if(mobile===null||!expanded)return false;
      if(!mobile){if(document.body.classList.contains('bp-sidebar-collapsed'))return false;setSidebarCollapsed?.(true);return true;}
      expanded=false;paint();return true;
    }
    nav.forEach(button=>button.addEventListener('click',()=>{
      if(mobile&&active===button.dataset.menu&&expanded){collapse();return;}
      select(button.dataset.menu);
    }));
    let drag=null,suppressClickUntil=0;
    fold.addEventListener('click',event=>{
      if(Date.now()<suppressClickUntil&&event.detail!==0){event.preventDefault();return;}
      if(expanded)collapse();else select(active);
    });
    fold.addEventListener('pointerdown',event=>{
      if(!mobile||registrationWasOpen||event.isPrimary===false||(event.button!=null&&event.button!==0))return;
      drag={id:event.pointerId,y:event.clientY,initial:expanded,full:expanded&&full,height:expanded?content.getBoundingClientRect().height:0,moved:false,delta:0};
      fold.setPointerCapture?.(event.pointerId);
    });
    fold.addEventListener('pointermove',event=>{
      if(!drag||event.pointerId!==drag.id)return;
      const delta=drag.y-event.clientY;
      if(!drag.moved&&Math.abs(delta)<8)return;
      if(!drag.initial&&delta<0)return;
      if(!drag.moved){drag.moved=true;if(!expanded)select(active);dock.classList.add('is-dragging');}
      drag.delta=delta;
      const max=Math.max(60,root.innerHeight-140);
      const height=Math.max(0,Math.min(max,drag.height+delta));
      dock.style.setProperty('--dock-drag-content-height',height+'px');
      content.hidden=false;
      if(event.cancelable)event.preventDefault();
      measure();
    });
    function finishDrag(event,cancel=false){
      if(!drag||(event&&event.pointerId!==drag.id))return;
      const previous=drag;drag=null;
      dock.classList.remove('is-dragging');dock.style.removeProperty('--dock-drag-content-height');
      if(previous.moved){
        const half=Math.max(60,Math.min(root.innerHeight*.36,340)-48);
        if(cancel){expanded=previous.initial;full=previous.full;}
        else if(previous.delta>24){expanded=true;full=previous.full||previous.initial||previous.height+previous.delta>half+60;}
        else if(previous.delta< -24){
          expanded=previous.full&&previous.height+previous.delta>half*.5;full=false;
        }else{expanded=previous.initial;full=previous.full;}
        suppressClickUntil=Date.now()+400;paint();
      }
      if(fold.hasPointerCapture?.(previous.id))fold.releasePointerCapture(previous.id);
    }
    fold.addEventListener('pointerup',event=>finishDrag(event));
    fold.addEventListener('pointercancel',event=>finishDrag(event,true));
    fold.addEventListener('lostpointercapture',event=>finishDrag(event,true));
    root.addEventListener('blur',()=>finishDrag(null,true));
    for(const [element,name]of [[oldObs,'observations'],[oldGps,'tracking']])element.addEventListener('click',event=>{
      if(mobile===null)return;event.preventDefault();event.stopImmediatePropagation();
      if(active===name&&expanded)collapse();else select(name);
    },true);
    dock.addEventListener('keydown',event=>{if(event.key==='Escape'&&collapse()){event.preventDefault();event.stopPropagation();fold.focus();}});
    function layout(){
      const next=!tablet.matches;if(next===mobile)return;
      finishDrag(null,true);
      restoring=true;mobile=next;
      document.body.classList.add('bp-map-dock');document.body.classList.toggle('bp-mobile-dock',mobile);document.body.classList.toggle('bp-tablet-dock',!mobile);dock.hidden=false;
      content.append(obs,bears,track);obs.classList.remove('obs-sheet--peek');
      for(const property of ['left','right','top','width'])obs.style.removeProperty(property);
      if(!mobile){expanded=true;full=false;document.body.style.removeProperty('--mobile-dock-height');document.body.style.removeProperty('--mobile-controls-height');}
      paint();
      restoring=false;
      root.dispatchEvent?.(new Event('bearpoint:mobile-dock-layout'));
    }
    const recordObserver=new MutationObserver(()=>{if(mobile!==null&&!restoring)paint();});
    recordObserver.observe(oldGps,{attributes:true,attributeFilter:['class'],childList:true,subtree:true});
    const countObserver=new MutationObserver(()=>{if(mobile&&active==='observations'&&!expanded)paint();});
    countObserver.observe(document.getElementById('obs-list-count'),{childList:true,subtree:true,characterData:true});
    const statusObserver=new MutationObserver(()=>{if(mobile!==null)paintStatus();});
    if(status)statusObserver.observe(status,{childList:true,subtree:true,characterData:true});
    const registrationObserver=new MutationObserver(()=>{
      const open=!registration.classList.contains('hidden');
      const previous=registrationWasOpen;registrationWasOpen=open;
      if(open&&!previous){restoreExpanded=expanded;restoreFull=full;collapse();dock.classList.add('is-registering');paint();void observations.prepareRegistrationMap?.();}
      else if(!open&&previous){
        dock.classList.remove('is-registering');expanded=restoreExpanded;full=restoreFull;
        if(showObservationsOnSave){showObservationsOnSave=false;select('observations',{activate:false});}else paint();
      }
    });registrationObserver.observe(registration,{attributes:true,attributeFilter:['class']});
    const size=new ResizeObserver(measure);size.observe(dock);
    const controls=document.querySelector('.map-right-controls');if(controls)size.observe(controls);
    const sidebarObserver=new MutationObserver(()=>{if(!mobile&&!restoring)paint();});sidebarObserver.observe(document.body,{attributes:true,attributeFilter:['class']});
    tablet.addEventListener('change',layout);root.addEventListener('resize',()=>{finishDrag(null,true);measure();});
    root.BearMobileDock={select,collapse,isMobile:()=>!!mobile,isDocked:()=>true,getActive:()=>active,handleBack:collapse,
      showObservationsAfterSave(){
        if(registrationWasOpen||(registration&&!registration.classList.contains('hidden')))showObservationsOnSave=true;
        else select('observations',{activate:false});
      },
      setFiltersOpen(value){if(active!=='tracking')return;filtering=!!value;paint();}};
    layout();return root.BearMobileDock;
  };
})(window);
