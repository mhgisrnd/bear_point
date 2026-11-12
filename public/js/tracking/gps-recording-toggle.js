(function(root){
  'use strict';
  root.BearGpsRecordingToggle={create({native,onChange}){
    const button=document.createElement('button');
    button.id='btn-gps-record-toggle';button.type='button';button.disabled=true;
    button.setAttribute('role','switch');button.setAttribute('aria-checked','false');
    button.dataset.preview=String(!native);
    button.dataset.pending=String(native);
    button.innerHTML='<span class="gps-record-label">이동 기록</span><span class="gps-record-control"><span class="gps-record-switch" aria-hidden="true"></span><span data-record-state aria-hidden="true">확인 중</span></span>';
    document.getElementById('map').append(button);
    let current=false;
    button.addEventListener('pointerdown',event=>event.stopPropagation());
    button.addEventListener('dblclick',event=>event.stopPropagation());
    button.addEventListener('click',event=>{event?.stopPropagation?.();if(!button.disabled)onChange(!current);});
    function render({active,busy,ready,pending=null}){
      if(!native){
        button.dataset.pending='false';
        button.disabled=true;button.setAttribute('aria-checked','false');button.setAttribute('aria-busy','false');
        button.querySelector('[data-record-state]').textContent='OFF';
        button.title='이동 기록은 앱에서 시작할 수 있습니다.';button.setAttribute('aria-label',button.title);
        return;
      }
      current=!!active;button.disabled=!!busy||!ready;
      button.dataset.pending=String(!!busy||!ready);
      button.setAttribute('aria-checked',String(current));
      button.setAttribute('aria-busy',String(!!busy));
      button.dataset.waiting=String(current&&!active.point_count);
      const text=!ready?'확인 중':busy?(pending===null?'확인 중':pending?'시작 중':'저장 중'):(current?'ON':'OFF');
      button.querySelector('[data-record-state]').textContent=text;
      const label='이동 기록 '+text+(current&&!active.point_count?' · GPS 수신 대기':'');
      button.title=label;button.setAttribute('aria-label',label+(busy||!ready?'':current?' · 누르면 종료·저장':' · 누르면 기록 시작'));
    }
    return {render};
  }};
})(window);
