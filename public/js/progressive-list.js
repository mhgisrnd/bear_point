(function (root) {
  "use strict";
  // Only list rows are batched; filtering, markers and bulk actions retain all items.
  function create({ scroller, key, batchSize = 30 }) {
    let items = [], append, signature = "", count = 0, savedScroll = 0;
    function add(end) {
      const start = count;
      count = Math.min(end, items.length);
      for (let index = start; index < count; index++) append(items[index]);
    }
    function onScroll() {
      if (!scroller || scroller.clientHeight <= 0 || count >= items.length) return;
      if (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 100) add(count + batchSize);
    }
    if (scroller) scroller.addEventListener("scroll", onScroll, { passive: true });
    return {
      beforeClear() { savedScroll = scroller ? scroller.scrollTop : 0; },
      // The caller clears the rows before rendering. Keep the loaded range and scroll
      // position on selection/refresh; a changed result set starts at the top.
      render(next, renderItem) {
        const nextSignature = JSON.stringify(next.map(key));
        const same = nextSignature === signature;
        const target = same ? Math.max(batchSize, count) : batchSize;
        const scrollTop = same ? savedScroll : 0;
        items = next; append = renderItem; signature = nextSignature; count = 0;
        add(target);
        if (scroller) scroller.scrollTop = scrollTop;
      }
    };
  }
  root.BearProgressiveList = { create };
  if (typeof module === "object" && module.exports) module.exports = { create };
})(typeof window === "object" ? window : globalThis);
