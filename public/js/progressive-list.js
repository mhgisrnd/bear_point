(function (root) {
  "use strict";
  function scrollRow(row, boundary) {
    if (!row?.getBoundingClientRect || !boundary || !row.getClientRects?.().length) return false;
    let container = row.parentElement;
    while (container) {
      const overflow = root.getComputedStyle?.(container).overflowY;
      if (container.clientHeight > 0 && container.scrollHeight > container.clientHeight &&
          (!overflow || /auto|scroll/.test(overflow))) {
        const bounds = container.getBoundingClientRect(), rect = row.getBoundingClientRect();
        const viewportTop = bounds.top + (container.clientTop || 0);
        const header = container.querySelector?.('thead th')?.getBoundingClientRect();
        const top = header && header.top <= viewportTop + 1 && header.bottom > viewportTop ? header.bottom : viewportTop;
        const bottom = viewportTop + container.clientHeight;
        if (rect.top < top) container.scrollTop += rect.top - top;
        else if (rect.bottom > bottom) container.scrollTop += rect.bottom - bottom;
        return true;
      }
      if (container === boundary) break;
      container = container.parentElement;
    }
    return boundary.clientHeight > 0;
  }
  // Only list rows are batched; filtering, markers and bulk actions retain all items.
  function create({ scroller, key, scope, batchSize = 30 }) {
    let items = [], append, signature = "", count = 0, savedScroll = 0;
    let scopeSignature;
    const nodes = new Map();
    let pendingKey = null;
    function revealPending() {
      if (pendingKey !== null && scrollRow(nodes.get(pendingKey), scroller)) pendingKey = null;
    }
    if (scroller && typeof root.ResizeObserver === "function") new root.ResizeObserver(revealPending).observe(scroller);
    function add(end) {
      const start = count;
      count = Math.min(end, items.length);
      for (let index = start; index < count; index++) nodes.set(String(key(items[index])), append(items[index]));
    }
    function onScroll() {
      if (!scroller || scroller.clientHeight <= 0 || count >= items.length) return;
      if (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 100) add(count + batchSize);
    }
    if (scroller) scroller.addEventListener("scroll", onScroll, { passive: true });
    return {
      reveal(id) {
        const target = String(id), index = items.findIndex(item => String(key(item)) === target);
        if (index < 0) return false;
        if (index >= count) add(index + 1);
        pendingKey = target;
        revealPending();
        return true;
      },
      beforeClear() { savedScroll = scroller ? scroller.scrollTop : 0; },
      // The caller clears the rows before rendering. Keep the loaded range and scroll
      // position on selection/refresh; a changed result set starts at the top.
      render(next, renderItem) {
        const nextSignature = JSON.stringify(next.map(key));
        const nextScope = scope?.();
        const oldKeys = new Set(items.map(key));
        const same = nextSignature === signature;
        const preserve = scope ? nextScope === scopeSignature && (same || next.some(item => oldKeys.has(key(item)))) : same;
        const target = preserve ? Math.max(batchSize, count + Math.max(0, next.length - items.length)) : batchSize;
        const scrollTop = preserve ? savedScroll : 0;
        scopeSignature = nextScope;
        items = next; append = renderItem; signature = nextSignature; count = 0; nodes.clear();
        if (pendingKey !== null && !next.some(item => String(key(item)) === pendingKey)) pendingKey = null;
        add(target);
        if (scroller) scroller.scrollTop = scrollTop;
        revealPending();
      }
    };
  }
  root.BearProgressiveList = { create, scrollRow };
  if (typeof module === "object" && module.exports) module.exports = { create, scrollRow };
})(typeof window === "object" ? window : globalThis);
