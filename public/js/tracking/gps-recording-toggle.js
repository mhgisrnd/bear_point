(function(root){
  'use strict';
  root.BearGpsRecordingToggle={create({native,onChange}){
    const button=document.createElement('button');
    button.id='btn-gps-record-toggle';button.type='button';button.disabled=true;
    button.setAttribute('aria-pressed','false');
    button.dataset.preview=String(!native);
    button.dataset.pending=String(native);
    button.innerHTML='<span data-record-state>확인 중</span>';
    document.getElementById('map').append(button);
    let current=false;
    button.addEventListener('pointerdown',event=>event.stopPropagation());
    button.addEventListener('dblclick',event=>event.stopPropagation());
    button.addEventListener('click',event=>{event?.stopPropagation?.();if(!button.disabled)onChange(!current);});
    function render({active,busy,ready,pending=null}){
      if(!native){
        button.dataset.pending='false';
        button.disabled=true;button.setAttribute('aria-pressed','false');button.setAttribute('aria-busy','false');
        button.querySelector('[data-record-state]').textContent='기록 ON';
        button.title='이동 기록은 앱에서 시작할 수 있습니다.';button.setAttribute('aria-label',button.title);
        return;
      }
      current=!!active;button.disabled=!!busy||!ready;
      // History loading also locks actions, but does not change recording state.
      const recordingBusy=!!busy&&pending!==null;
      button.dataset.pending=String(recordingBusy||!ready);
      button.setAttribute('aria-pressed',String(current));
      button.setAttribute('aria-busy',String(recordingBusy||!ready));
      button.dataset.waiting=String(current&&!active.point_count);
      const text=!ready?'확인 중':recordingBusy?(pending==='confirm'?'종료 확인':pending?'시작 중':'종료 중'):(current?'기록 OFF':'기록 ON');
      button.querySelector('[data-record-state]').textContent=text;
      const label='이동 '+text+(current&&!active.point_count?' · GPS 수신 대기':'');
      button.title=label;button.setAttribute('aria-label',label+(busy||!ready?'':current?' · 기록 중 · 누르면 종료 방법 선택':' · 누르면 기록 시작'));
    }
    return {render};
  }};
})(window);
