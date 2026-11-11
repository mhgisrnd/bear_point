(function (root) {
  'use strict';
  const phone = root.matchMedia('(max-width: 899px), (orientation: portrait)');
  let stage = null, cancelStage = null, saveSheet = null, saveHome = null, blockedDock = null, dockWasInert = false;
  let layoutKey = '';
  function sync() {
    const viewport = root.visualViewport;
    const height = viewport ? viewport.height : root.innerHeight;
    const bottom = viewport ? Math.max(0, root.innerHeight - viewport.offsetTop - height) : 0;
    document.documentElement.style.setProperty('--analysis-keyboard-bottom', bottom + 'px');
    document.documentElement.style.setProperty('--analysis-visible-height', height + 'px');
    const active = phone.matches && !!stage;
    document.body.classList.toggle('analysis-mobile-active', active);
    document.body.classList.toggle('analysis-mobile-keyboard', active && bottom > 100);
    if (saveSheet && saveHome) {
      if (phone.matches && saveSheet.parentNode !== document.body) document.body.appendChild(saveSheet);
      else if (!phone.matches && saveSheet.parentNode !== saveHome) saveHome.appendChild(saveSheet);
    }
    const dock = document.getElementById('mobile-map-dock');
    if (active && dock && !blockedDock) {
      blockedDock = dock; dockWasInert = dock.hasAttribute('inert'); dock.setAttribute('inert', '');
    } else if (!active && blockedDock) {
      if (!dockWasInert && !document.body.classList.contains('bp-sidebar-collapsed')) blockedDock.removeAttribute('inert');
      blockedDock = null;
    }
    const sheet = stage === 'save' ? saveSheet : document.getElementById('analysis-dialog-overlay');
    const key = [stage, phone.matches, height, bottom, sheet?.getBoundingClientRect().top].join(':');
    if (key !== layoutKey) {
      layoutKey = key;
      if (root.dispatchEvent) root.dispatchEvent(new root.Event('bearpoint:analysis-sheet-layout'));
    }
  }
  root.BearAnalysisSheet = {
    registerSave(element) { saveSheet = element; saveHome = element.parentNode; sync(); },
    setStage(value, onCancel) { stage = value; cancelStage = onCancel || null; sync(); },
    closeStage(value) { if (stage === value) { stage = null; cancelStage = null; sync(); } },
    handleBack() {
      if (!stage || !cancelStage) return false;
      cancelStage();
      return true;
    },
    getMapPadding() {
      if (!phone.matches || !stage) return null;
      const sheet = stage === 'save' ? saveSheet : document.getElementById('analysis-dialog-overlay');
      const top = sheet?.getBoundingClientRect().top ?? root.innerHeight;
      return [70, 70, Math.max(30, root.innerHeight - top + 16), 18];
    },
    isPhone: () => phone.matches
  };
  root.addEventListener('resize', sync);
  phone.addEventListener('change', sync);
  root.visualViewport?.addEventListener('resize', sync);
  root.visualViewport?.addEventListener('scroll', sync);
  if (root.ResizeObserver) {
    const observer = new root.ResizeObserver(sync);
    const originalRegister = root.BearAnalysisSheet.registerSave;
    root.BearAnalysisSheet.registerSave = element => { originalRegister(element); observer.observe(element); };
    document.addEventListener('toggle', event => {
      if (event.target.closest?.('#analysis-dialog-desc')) sync();
    }, true);
  }
  document.addEventListener('keydown', event => {
    if (!phone.matches || !stage || event.key !== 'Tab') return;
    const sheet = stage === 'save' ? saveSheet : document.getElementById('analysis-dialog-panel');
    const items = [...(sheet?.querySelectorAll('input, textarea, button, summary, select') || [])]
      .filter(node => !node.disabled && node.tabIndex !== -1 && node.getClientRects().length);
    if (!items.length) return;
    const index = items.indexOf(document.activeElement);
    if (index < 0 || (!event.shiftKey && index === items.length - 1) || (event.shiftKey && index === 0)) {
      event.preventDefault(); (event.shiftKey ? items.at(-1) : items[0]).focus();
    }
  });
  document.addEventListener('focusin', event => {
    if (!phone.matches || !stage || !event.target.matches?.('input, textarea, select')) return;
    const sheet = stage === 'save' ? saveSheet : document.getElementById('analysis-dialog-panel');
    if (sheet && !sheet.contains(event.target)) event.target.blur();
  });
})(window);
