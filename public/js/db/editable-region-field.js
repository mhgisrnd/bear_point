(function () {
  "use strict";
  // Manual text wins over pending lookups. GPS jitter preserves an override;
  // explicitly selecting a new coordinate starts automatic lookup again.
  window.createEditableRegionField = function (input) {
    let key = "";
    let dirty = false;
    let revision = 0;
    let timer;
    const lookup = (lat, lng) => window.BearAdminBoundary.lookup(lat, lng);
    if (input) input.addEventListener("input", function () {
      dirty = true;
      revision++;
      clearTimeout(timer);
    });
    function reset(value, lat, lng) {
      revision++;
      clearTimeout(timer);
      key = Number.isFinite(lat) && Number.isFinite(lng) ? lat + "," + lng : "";
      dirty = value != null;
      if (input) {
        input.value = value == null ? "" : String(value);
        input.placeholder = "좌표 선택 시 자동 조회 · 직접 수정 가능";
      }
    }
    function update(lat, lng, options = {}) {
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) { reset(); return; }
      const nextKey = lat + "," + lng;
      if (key === nextKey) return;
      key = nextKey;
      revision++;
      clearTimeout(timer);
      if (dirty && options.preserveManual) return;
      dirty = false;
      const request = revision;
      if (input) { input.value = ""; input.placeholder = "행정구역 조회 중 · 직접 입력 가능"; }
      timer = setTimeout(async function () {
        try {
          const region = await lookup(lat, lng);
          if (revision !== request || dirty) return;
          if (input) {
            input.value = region ? region.name : "";
            input.placeholder = region ? "직접 수정 가능" : "행정구역 없음 · 직접 입력 가능";
          }
        } catch (error) {
          if (revision !== request || dirty) return;
          if (input) input.placeholder = "자동 조회 실패 · 직접 입력 가능";
        }
      }, 250);
    }
    async function resolve(lat, lng) {
      // Snapshot user text before awaiting, so saving never replaces a manual
      // override with a fresh automatic response.
      if (dirty) return input ? input.value.trim() || null : null;
      const region = await lookup(lat, lng);
      return region ? region.name : null;
    }
    return { reset, update, resolve };
  };
})();
