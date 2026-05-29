(function (window) {
  "use strict";

  function createRealtimeListModule(options) {
    const listEl =
      options.realtimeListEl || document.getElementById("realtime-list");
    const tabButton = options.tabButton || document.getElementById("btn-realtime-list");
    const estimateTabButton =
      options.estimateTabButton ||
      document.getElementById("btn-obs-list") ||
      document.getElementById("btn-bear-estimate");
    const titleLabelEl =
      options.titleLabelEl ||
      document.getElementById("realtime-title-label") ||
      document.getElementById("realtime-title");
    const realtimeBoxEl =
      options.realtimeBoxEl || document.getElementById("realtime-box");
    const bearsBoxEl = options.bearsBoxEl || document.getElementById("bears-box");
    const realtimeToolbarEl =
      options.realtimeToolbarEl || document.getElementById("realtime-toolbar");
    const realtimeToolbarSummaryEl =
      options.realtimeToolbarSummaryEl || document.getElementById("realtime-toolbar-summary");
    const realtimeToolbarActionsEl =
      options.realtimeToolbarActionsEl || document.getElementById("realtime-toolbar-actions");
    const realtimeSelectionCountEl =
      options.realtimeSelectionCountEl || document.getElementById("realtime-selection-count");
    const statusEl = options.statusEl || document.getElementById("status");
    const onCenterMap =
      typeof options.onCenterMap === "function"
        ? options.onCenterMap
        : typeof options.onFocusItem === "function"
          ? options.onFocusItem
          : null;
    const onStatus =
      typeof options.onStatus === "function" ? options.onStatus : null;
    const onTabActivated =
      typeof options.onTabActivated === "function" ? options.onTabActivated : null;
    const onItemsChanged =
      typeof options.onItemsChanged === "function" ? options.onItemsChanged : null;

    if (!listEl || !tabButton || !titleLabelEl) {
      return null;
    }

    const API_BASE =
      typeof options.apiBase === "string" && options.apiBase.trim()
        ? options.apiBase.trim().replace(/\/$/, "")
        : "/api/realtime";
    const MAX_ITEMS = 200;

    let items = [];
    let isLoading = false;
    const selectedItemIds = new Set();
    const realtimeSelectAllEl =
      options.realtimeSelectAllEl || document.getElementById("realtime-select-all");
    const realtimeBulkXlsBtnEl =
      options.realtimeBulkXlsBtnEl || document.getElementById("btn-realtime-download-selected-xls");
    let activeTab = "estimate";
    let suppressNotify = true;

    function setStatus(message, kind) {
      if (!statusEl || !message) return;
      statusEl.textContent = message;
      if (onStatus) {
        try {
          onStatus(message, kind);
        } catch (_) {
          // noop
        }
      }
      if (kind === "ok") {
        statusEl.style.color = "#0a6f30";
      } else if (kind === "warn") {
        statusEl.style.color = "#8a4d00";
      } else if (kind === "error") {
        statusEl.style.color = "#a4001e";
      } else {
        statusEl.style.color = "";
      }
    }

    function notifyTabActivated(tab) {
      if (typeof onTabActivated !== "function") return;
      onTabActivated(tab);
    }

    function notifyItemsChanged() {
      if (typeof onItemsChanged !== "function") return;
      onItemsChanged(items.slice(), activeTab);
    }

    function normalizeItem(item) {
      if (!item || typeof item !== "object") return null;
      const id =
        item.id != null && String(item.id).trim()
          ? String(item.id)
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const timestamp =
        item.timestamp != null
          ? Number(item.timestamp)
          : item.ts != null
            ? Number(item.ts)
            : item.uploaded_at != null
              ? new Date(item.uploaded_at).getTime()
              : item.source_created_at != null
                ? new Date(item.source_created_at).getTime()
            : Date.now();
      const lat = Number(item.lat);
      const lon = Number(item.lon != null ? item.lon : item.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        id,
        lat,
        lon,
        timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
        bearCode:
          item.bearCode != null
            ? String(item.bearCode)
            : item.bear_code != null
              ? String(item.bear_code)
              : "-",
        owner:
          item.owner != null && String(item.owner).trim()
            ? String(item.owner).trim()
            : "미지정",
        place:
          item.place != null && String(item.place).trim()
            ? String(item.place).trim()
            : "미지정",
        latDms:
          item.latDms != null && String(item.latDms).trim()
            ? String(item.latDms).trim()
            : item.lat_dms != null && String(item.lat_dms).trim()
              ? String(item.lat_dms).trim()
              : decimalToDms(lat, false),
        lonDms:
          item.lonDms != null && String(item.lonDms).trim()
            ? String(item.lonDms).trim()
            : item.lng_dms != null && String(item.lng_dms).trim()
              ? String(item.lng_dms).trim()
              : item.lon_dms != null && String(item.lon_dms).trim()
                ? String(item.lon_dms).trim()
                : decimalToDms(lon, true),
        label:
          typeof item.label === "string" && item.label.trim()
            ? item.label.trim()
            : "실시간 위치",
      };
    }

    function buildApiUrl(pathname) {
      return API_BASE + pathname;
    }

    async function requestJson(pathname, requestOptions) {
      const response = await fetch(buildApiUrl(pathname), requestOptions || {});
      let data = null;
      try {
        data = await response.json();
      } catch (_) {
        data = null;
      }

      if (!response.ok || !data || data.ok === false) {
        const message = data && data.message ? data.message : "실시간 목록 요청에 실패했습니다.";
        const error = new Error(message);
        error.statusCode = response.status;
        error.detail = data && data.detail ? data.detail : undefined;
        throw error;
      }

      return data;
    }

    async function fetchRealtimeItems(options) {
      const opts = options && typeof options === "object" ? options : {};
      const silent = !!opts.silent;

      isLoading = true;
      renderRealtimeList();

      try {
        const data = await requestJson("/bear-estimates?limit=" + encodeURIComponent(String(MAX_ITEMS)), {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        });
        items = Array.isArray(data.items)
          ? data.items.map(normalizeItem).filter(Boolean).slice(0, MAX_ITEMS)
          : [];
        notifyItemsChanged();
        if (!silent) {
          setStatus(items.length ? "실시간 목록을 불러왔습니다." : "아직 업로드된 실시간 위치가 없습니다.", items.length ? "ok" : "warn");
        }
      } catch (error) {
        items = [];
        notifyItemsChanged();
        if (!silent) {
          setStatus(error && error.message ? error.message : "실시간 목록 조회에 실패했습니다.", "error");
        }
        return {
          ok: false,
          items: [],
          message: error && error.message ? error.message : "실시간 목록 조회 실패",
        };
      } finally {
        isLoading = false;
        renderRealtimeList();
      }

      return {
        ok: true,
        items: items.slice(),
      };
    }

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function formatTs(ts) {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return "-";
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const hh = String(d.getHours()).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
    }

    function formatDateLabel(ts) {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return "-";
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    }

    function formatTimeLabel(ts) {
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return "-";
      const ampm = d.getHours() < 12 ? "오전" : "오후";
      const hour12 = d.getHours() % 12 || 12;
      const hh = String(hour12).padStart(2, "0");
      const mi = String(d.getMinutes()).padStart(2, "0");
      const ss = String(d.getSeconds()).padStart(2, "0");
      return `${ampm} ${hh}:${mi}:${ss}`;
    }

    function decimalToDms(value, isLon) {
      const num = Number(value);
      if (!Number.isFinite(num)) return "-";
      const abs = Math.abs(num);
      const deg = Math.floor(abs);
      const minFloat = (abs - deg) * 60;
      const min = Math.floor(minFloat);
      const sec = ((minFloat - min) * 60).toFixed(2);
      const hemi = isLon ? (num >= 0 ? "E" : "W") : (num >= 0 ? "N" : "S");
      return `${deg}\u00B0${min}'${sec}\"${hemi}`;
    }

    function buildShareText(item) {
      const lines = [
        `[${item.bearCode || "-"}] 실시간 위치`,
        `지명: ${item.place || "미지정"}`,
        `등록자: ${item.owner || "미지정"}`,
        `위도: ${Number(item.lat).toFixed(6)}`,
        `경도: ${Number(item.lon).toFixed(6)}`,
        `시각: ${formatTs(item.timestamp)}`,
      ];
      return lines.join("\n");
    }

    function sanitizeFileNamePart(value) {
      return String(value || "")
        .replace(/[\\/:*?"<>|]/g, "-")
        .replace(/\s+/g, "_")
        .slice(0, 40);
    }

    function downloadTextFile(fileName, text) {
      const blob = new Blob(["\uFEFF", text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    function downloadRealtimeTxt(item) {
      const stamp = formatDateLabel(item.timestamp).replace(/-/g, "") + "_" + formatTimeLabel(item.timestamp).replace(/[^0-9]/g, "");
      const code = sanitizeFileNamePart(item.bearCode || "realtime");
      const fileName = `realtime_${code}_${stamp}.txt`;
      downloadTextFile(fileName, buildShareText(item));
      setStatus("실시간 항목 TXT를 저장했습니다.", "ok");
    }

    function downloadRealtimeXls(item) {
      const stamp = formatDateLabel(item.timestamp).replace(/-/g, "") + "_" + formatTimeLabel(item.timestamp).replace(/[^0-9]/g, "");
      const code = sanitizeFileNamePart(item.bearCode || "realtime");
      const fileName = `realtime_${code}_${stamp}.xls`;
      const rows = [
        ["구분", "값"],
        ["곰 코드", item.bearCode || "-"],
        ["지명", item.place || "미지정"],
        ["등록자", item.owner || "미지정"],
        ["위도", Number(item.lat).toFixed(6)],
        ["경도", Number(item.lon).toFixed(6)],
        ["위도(DMS)", item.latDms || "-"],
        ["경도(DMS)", item.lonDms || "-"],
        ["일자", formatDateLabel(item.timestamp)],
        ["시각", formatTimeLabel(item.timestamp)],
      ];
      const tsv = rows
        .map((row) => row.map((cell) => String(cell).replace(/\t/g, " ")).join("\t"))
        .join("\r\n");
      const blob = new Blob(["\uFEFF", tsv], { type: "application/vnd.ms-excel;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus("실시간 항목 XLS를 저장했습니다.", "ok");
    }

    function downloadRealtimeXlsMany(targets) {
      const list = (Array.isArray(targets) ? targets : []).filter(function (it) {
        return it && Number.isFinite(Number(it.lat)) && Number.isFinite(Number(it.lon));
      });

      if (!list.length) {
        setStatus("선택된 실시간 항목이 없습니다.", "warn");
        return;
      }

      const rows = [["일자", "시각", "곰 코드", "지명", "등록자", "위도(DMS)", "경도(DMS)", "위도", "경도"]];
      list.forEach(function (item) {
        rows.push([
          formatDateLabel(item.timestamp),
          formatTimeLabel(item.timestamp),
          item.bearCode || "-",
          item.place || "미지정",
          item.owner || "미지정",
          item.latDms || decimalToDms(item.lat, false),
          item.lonDms || decimalToDms(item.lon, true),
          Number(item.lat).toFixed(6),
          Number(item.lon).toFixed(6),
        ]);
      });

      const tsv = rows
        .map((row) => row.map((cell) => String(cell).replace(/\t/g, " ")).join("\t"))
        .join("\r\n");
      const stamp = formatDateLabel(Date.now()).replace(/-/g, "") + "_" + formatTimeLabel(Date.now()).replace(/[^0-9]/g, "");
      const fileName = `realtime_selected_${stamp}.xls`;
      const blob = new Blob(["\uFEFF", tsv], { type: "application/vnd.ms-excel;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus(`선택한 ${list.length}건을 엑셀로 저장했습니다.`, "ok");
    }

    function bindRealtimeActionControls() {
      if (realtimeSelectAllEl && !realtimeSelectAllEl.dataset.bound) {
        realtimeSelectAllEl.dataset.bound = "1";
        realtimeSelectAllEl.addEventListener("change", function (event) {
          const checked = !!(event && event.target && event.target.checked);
          selectedItemIds.clear();
          if (checked) {
            items.forEach(function (item) {
              selectedItemIds.add(String(item.id));
            });
          }
          renderRealtimeList();
        });
      }

      if (realtimeBulkXlsBtnEl && !realtimeBulkXlsBtnEl.dataset.bound) {
        realtimeBulkXlsBtnEl.dataset.bound = "1";
        realtimeBulkXlsBtnEl.addEventListener("click", function () {
          const targets = items.filter(function (item) {
            return selectedItemIds.has(String(item.id));
          });
          downloadRealtimeXlsMany(targets);
        });
      }
    }

    function updateRealtimeSelectionControls() {
      const totalCount = items.length;
      const selectedCount = selectedItemIds.size;

      if (realtimeToolbarSummaryEl) {
        realtimeToolbarSummaryEl.innerHTML =
          '<img src="css/image/icon_bear.png" style="height:16px;vertical-align:middle;margin-right:4px;" alt="곰"/> ' +
          totalCount +
          '건 표시됨';
        realtimeToolbarSummaryEl.hidden = false;
      }

      if (realtimeSelectionCountEl) {
        realtimeSelectionCountEl.textContent = selectedCount + "개 선택";
      }

      if (realtimeToolbarEl) {
        if (selectedCount === 0) realtimeToolbarEl.classList.add("is-idle");
        else realtimeToolbarEl.classList.remove("is-idle");
      }

      if (realtimeSelectAllEl) {
        realtimeSelectAllEl.disabled = totalCount === 0;
        if (totalCount === 0) {
          realtimeSelectAllEl.checked = false;
          realtimeSelectAllEl.indeterminate = false;
        } else {
          realtimeSelectAllEl.checked = selectedCount > 0 && selectedCount === totalCount;
          realtimeSelectAllEl.indeterminate = selectedCount > 0 && selectedCount < totalCount;
        }
      }

      if (realtimeBulkXlsBtnEl) {
        realtimeBulkXlsBtnEl.disabled = selectedCount === 0;
      }
    }

    async function shareRealtimeItem(item) {
      const text = buildShareText(item);
      if (navigator.share) {
        try {
          await navigator.share({
            title: "실시간 위치",
            text,
          });
          setStatus("실시간 항목을 공유했습니다.", "ok");
          return;
        } catch (_) {
          // 공유 취소/실패 시 클립보드 폴백 시도
        }
      }

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
          setStatus("공유 텍스트를 클립보드에 복사했습니다.", "ok");
          return;
        }
      } catch (_) {
        // ignore and fallback below
      }

      setStatus("공유를 지원하지 않는 환경입니다.", "warn");
    }

    function renderRealtimeList() {
      if (!listEl) return;
      const liveIdSet = new Set(items.map(function (item) {
        return String(item.id);
      }));
      Array.from(selectedItemIds).forEach(function (id) {
        if (!liveIdSet.has(id)) selectedItemIds.delete(id);
      });

      updateRealtimeSelectionControls();

      if (isLoading) {
        listEl.innerHTML =
          '<div class="realtime-empty" role="status" aria-live="polite">실시간 목록을 불러오는 중입니다.</div>';
        return;
      }

      if (!items.length) {
        listEl.innerHTML =
          '<div class="realtime-empty">아직 업로드된 실시간 위치가 없습니다.</div>';
        return;
      }

      const rows = items
        .map((item) => {
          const itemId = String(item.id);
          const isSelected = selectedItemIds.has(itemId);
          const dateLabel = formatDateLabel(item.timestamp);
          const timeLabel = formatTimeLabel(item.timestamp);
          return [
            '<div class="bears-item bears-item--realtime' + (isSelected ? ' is-selected' : '') + '" data-id="' + escapeHtml(item.id) + '">',
            '  <div class="bears-item__select">',
            '    <input class="bears-item__checkbox realtime-row-checkbox" type="checkbox" aria-label="실시간 항목 선택" ' + (isSelected ? 'checked' : '') + ' />',
            "  </div>",
            '  <div class="bears-item__main">',
            '    <div class="bears-item__code"><b>' + escapeHtml(item.bearCode || "-") + "</b></div>",
            '    <div class="bears-item__line">지명: ' + escapeHtml(item.place || "미지정") + "</div>",
            '    <div class="bears-item__line">등록자: ' + escapeHtml(item.owner || "미지정") + "</div>",
            '    <div class="bears-item__line bears-item__line--sub">' + escapeHtml(item.latDms || decimalToDms(item.lat, false)) + ' ' + escapeHtml(item.lonDms || decimalToDms(item.lon, true)) + "</div>",
            '    <div class="bears-item__line bears-item__line--sub">위도 ' + escapeHtml(Number(item.lat).toFixed(6)) + ' / 경도 ' + escapeHtml(Number(item.lon).toFixed(6)) + "</div>",
            "  </div>",
            '  <div class="bears-item__meta bears-item__meta--send">',
            '    <div class="bears-item__buttons bears-item__buttons--triple">',
            '      <button class="bears-txt-dl-btn realtime-row-txt-btn" type="button" aria-label="TXT 저장"><span class="bears-txt-dl-btn__label">TXT 저장</span></button>',
            '      <button class="bears-xls-dl-btn realtime-row-xls-btn" type="button" aria-label="XLS 저장"><span class="bears-xls-dl-btn__label">XLS 저장</span></button>',
            '      <button class="bears-send-btn realtime-row-share-btn" type="button" aria-label="공유"><span class="bears-send-btn__label">공유</span></button>',
            "    </div>",
            '    <div class="bears-item__date">' + escapeHtml(dateLabel) + "</div>",
            '    <div class="bears-item__time">' + escapeHtml(timeLabel) + "</div>",
            "  </div>",
            "</div>",
          ].join("\n");
        })
        .join("\n");

      listEl.innerHTML = rows;
    }

    function findItemById(id) {
      const found = items.find((entry) => entry.id === id);
      if (found) return found;
      return null;
    }

    function setTab(tab, opts) {
      const nextTab = tab === "realtime" ? "realtime" : "estimate";
      const optionsObj = opts && typeof opts === "object" ? opts : {};
      const silent = !!optionsObj.silent;
      if (activeTab === nextTab && !silent) return;

      const prevTab = activeTab;
      activeTab = nextTab;

      if (activeTab === "realtime") {
        document.body.classList.add("show-realtime-list");
        if (realtimeBoxEl) realtimeBoxEl.classList.remove("hidden");
        if (bearsBoxEl) bearsBoxEl.classList.add("hidden");
        tabButton.classList.add("active");
        tabButton.classList.add("tab-active");
        tabButton.classList.add("list-toggle--realtime");
        tabButton.classList.remove("list-toggle--local");
        tabButton.setAttribute("aria-pressed", "true");
        tabButton.setAttribute("aria-label", "실시간 목록에서 로컬 목록으로 전환");
        titleLabelEl.textContent = "실시간 목록";
        renderRealtimeList();
        fetchRealtimeItems({ silent });
      } else {
        document.body.classList.remove("show-realtime-list");
        if (realtimeBoxEl) realtimeBoxEl.classList.add("hidden");
        if (bearsBoxEl) bearsBoxEl.classList.remove("hidden");
        tabButton.classList.remove("active");
        tabButton.classList.remove("tab-active");
        tabButton.classList.remove("list-toggle--realtime");
        tabButton.classList.add("list-toggle--local");
        tabButton.setAttribute("aria-pressed", "false");
        tabButton.setAttribute("aria-label", "로컬 목록에서 실시간 목록으로 전환");
      }

      if (activeTab !== prevTab && !silent && !suppressNotify) {
        if (activeTab === "realtime") {
          setStatus("실시간 목록을 확인합니다.", "ok");
        } else {
          setStatus("로컬 곰 추정위치 목록으로 돌아왔습니다.", "ok");
        }
      }

      if (activeTab !== prevTab && !silent) {
        notifyTabActivated(activeTab);
      }
    }

    function activateRealtime() {
      setTab("realtime");
    }

    function activateEstimate() {
      setTab("estimate");
    }

    async function uploadEstimate(payload) {
      const response = await requestJson("/bear-estimates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload || {}),
      });

      return normalizeItem(Object.assign({}, payload || {}, response.item || {}));
    }

    async function sendEstimate(payload) {
      const normalized = normalizeItem(payload);
      if (!normalized) {
        return {
          ok: false,
          reason: "invalid-payload",
          message: "실시간 업로드 데이터가 올바르지 않습니다.",
        };
      }

      try {
        const savedItem = await uploadEstimate(payload);
        items = [savedItem].concat(items.filter((item) => item.id !== savedItem.id));
        if (items.length > MAX_ITEMS) {
          items = items.slice(0, MAX_ITEMS);
        }
        if (activeTab === "realtime") {
          renderRealtimeList();
        }

        notifyItemsChanged();
        setStatus("실시간 목록에 업로드했습니다.", "ok");
        return {
          ok: true,
          item: savedItem,
        };
      } catch (error) {
        setStatus(error && error.message ? error.message : "실시간 업로드에 실패했습니다.", "error");
        return {
          ok: false,
          reason: "request-failed",
          message: error && error.message ? error.message : "실시간 업로드 실패",
        };
      }
    }

    async function sendEstimates(payloadList) {
      if (!Array.isArray(payloadList) || !payloadList.length) {
        return {
          ok: false,
          count: 0,
          message: "업로드할 데이터가 없습니다.",
        };
      }

      const normalizedList = payloadList.map(normalizeItem).filter(Boolean);
      if (!normalizedList.length) {
        return {
          ok: false,
          count: 0,
          message: "업로드 가능한 데이터가 없습니다.",
        };
      }

      const savedItems = [];
      try {
        for (const item of normalizedList) {
          const savedItem = await uploadEstimate(item);
          if (savedItem) savedItems.push(savedItem);
        }
      } catch (error) {
        setStatus(error && error.message ? error.message : "실시간 업로드에 실패했습니다.", "error");
        return {
          ok: false,
          count: savedItems.length,
          message: error && error.message ? error.message : "실시간 업로드 실패",
        };
      }

      const idSet = new Set(savedItems.map(function (item) {
        return item.id;
      }));
      items = savedItems.concat(items.filter(function (item) {
        return !idSet.has(item.id);
      })).slice(0, MAX_ITEMS);

      if (activeTab === "realtime") {
        renderRealtimeList();
      }

      notifyItemsChanged();
      setStatus("선택한 항목을 실시간 목록에 업로드했습니다.", "ok");

      return {
        ok: true,
        count: savedItems.length,
      };
    }

    function clear() {
      items = [];
      renderRealtimeList();
      notifyItemsChanged();
      return { ok: true };
    }

    function getItems() {
      return items.slice();
    }

    bindRealtimeActionControls();
    renderRealtimeList();
    fetchRealtimeItems({ silent: true });
    suppressNotify = true;
    setTab("estimate", { silent: true });
    suppressNotify = false;

    tabButton.addEventListener("click", function () {
      if (activeTab === "realtime") {
        activateEstimate();
      } else {
        activateRealtime();
      }
    });

    listEl.addEventListener("click", function (event) {
      const checkboxEl = event.target && event.target.closest
        ? event.target.closest(".realtime-row-checkbox")
        : null;
      if (checkboxEl) {
        event.stopPropagation();
        return;
      }

      const txtBtn = event.target && event.target.closest
        ? event.target.closest(".realtime-row-txt-btn")
        : null;
      if (txtBtn) {
        const rowForTxt = txtBtn.closest(".bears-item[data-id]");
        if (!rowForTxt) return;
        const txtId = rowForTxt.getAttribute("data-id");
        const txtItem = findItemById(txtId);
        if (!txtItem) return;
        event.stopPropagation();
        downloadRealtimeTxt(txtItem);
        return;
      }

      const xlsBtn = event.target && event.target.closest
        ? event.target.closest(".realtime-row-xls-btn")
        : null;
      if (xlsBtn) {
        const rowForXls = xlsBtn.closest(".bears-item[data-id]");
        if (!rowForXls) return;
        const xlsId = rowForXls.getAttribute("data-id");
        const xlsItem = findItemById(xlsId);
        if (!xlsItem) return;
        event.stopPropagation();
        downloadRealtimeXls(xlsItem);
        return;
      }

      const shareBtn = event.target && event.target.closest
        ? event.target.closest(".realtime-row-share-btn")
        : null;
      if (shareBtn) {
        const rowForShare = shareBtn.closest(".bears-item[data-id]");
        if (!rowForShare) return;
        const shareId = rowForShare.getAttribute("data-id");
        const shareItem = findItemById(shareId);
        if (!shareItem) return;
        event.stopPropagation();
        shareRealtimeItem(shareItem);
        return;
      }

      const row = event.target && event.target.closest
        ? event.target.closest(".bears-item[data-id]")
        : null;
      if (!row) return;

      const id = row.getAttribute("data-id");
      const item = findItemById(id);
      if (!item) return;

      if (onCenterMap) {
        onCenterMap({
          id: item.id,
          lat: item.lat,
          lon: item.lon,
          lng: item.lon,
          timestamp: item.timestamp,
          label: item.label,
        });
      }

      setStatus(
        `실시간 위치를 지도 중심으로 이동했습니다. (${item.lat.toFixed(5)}, ${item.lon.toFixed(5)})`,
        "ok"
      );
    });

    listEl.addEventListener("change", function (event) {
      const checkboxEl = event.target && event.target.closest
        ? event.target.closest(".realtime-row-checkbox")
        : null;
      if (!checkboxEl) return;

      const row = checkboxEl.closest(".bears-item[data-id]");
      if (!row) return;
      const id = String(row.getAttribute("data-id") || "");
      if (!id) return;

      if (checkboxEl.checked) selectedItemIds.add(id);
      else selectedItemIds.delete(id);
      renderRealtimeList();
    });

    return {
      sendEstimate,
      sendEstimates,
      openRealtimeTab: activateRealtime,
      openEstimateTab: activateEstimate,
      getItems,
      clear,
      getActiveTab: function () {
        return activeTab;
      },
      refresh: fetchRealtimeItems,
    };
  }

  window.createRealtimeListModule = createRealtimeListModule;
})(window);
