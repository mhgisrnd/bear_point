(function (root) {
  'use strict';
  root.BearPressRepeat = {
    bind(button, onStep) {
      let pointer = null, timer = null, suppressClick = false;
      const listeners = [];
      function listen(target, type, handler) {
        target.addEventListener(type, handler);
        listeners.push(() => target.removeEventListener(type, handler));
      }
      function stop() {
        if (timer !== null) root.clearTimeout(timer);
        timer = null;
        const previous = pointer; pointer = null;
        if (previous !== null && button.hasPointerCapture?.(previous)) button.releasePointerCapture(previous);
      }
      function repeat() {
        if (pointer === null || button.disabled || !button.isConnected || document.hidden) { stop(); return; }
        onStep(); timer = root.setTimeout(repeat, 100);
      }
      listen(button, 'pointerdown', event => {
        if (button.disabled || event.isPrimary === false || event.button !== 0 || pointer !== null) return;
        event.preventDefault();
        suppressClick = true; pointer = event.pointerId;
        button.setPointerCapture?.(pointer);
        onStep(); timer = root.setTimeout(repeat, 450);
      });
      listen(button, 'pointermove', event => {
        if (event.pointerId !== pointer) return;
        const bounds = button.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) stop();
      });
      const end = event => { if (event.pointerId === pointer) stop(); };
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave']) listen(button, type, end);
      listen(button, 'click', event => {
        event.preventDefault();
        if (!button.disabled && (event.detail === 0 || !suppressClick)) onStep();
        suppressClick = false;
      });
      listen(button, 'contextmenu', event => event.preventDefault());
      listen(root, 'pointerup', end);
      listen(root, 'pointercancel', end);
      listen(root, 'blur', stop);
      listen(root, 'resize', stop);
      listen(document, 'visibilitychange', stop);
      return () => { stop(); listeners.forEach(remove => remove()); };
    }
  };
})(window);
