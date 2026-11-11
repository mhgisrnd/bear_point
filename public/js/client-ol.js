// public/js/client-ol.js
// OpenLayers mode using existing obs modules

(function initOpenLayersMode() {
  const statusEl = document.getElementById("status");
  const mapEl = document.getElementById("map");
  // 관측점 등록 중에만 보이는 기기 방향 다이얼(지도 나침반과 별개).
  const headingDialEl = document.getElementById("heading-dial");
  const headingDialRingEl = document.getElementById("heading-dial-ring");
  const headingDialDegEl = document.getElementById("heading-dial-deg");
  const headingDialDirEl = document.getElementById("heading-dial-dir");
  // 갤럭시 엣지 나침반처럼 카드(132×200)보다 넓은 눈금판(중심 66,100 · 반지름 94)이 돌고, 좌우는 잘려 위아래 호만 보인다.
  const DIAL_CENTER = "66 100";
  if (headingDialRingEl) {
    let dialMarkup = "";
    for (let deg = 0; deg < 360; deg += 2) {
      const cardinal = deg % 90 === 0, major = deg % 30 === 0;
      const cls = cardinal ? "is-cardinal" : major ? "is-major" : "";
      dialMarkup += '<line x1="66" y1="6" x2="66" y2="' + (cardinal ? 19 : major ? 15 : 11) + '" transform="rotate(' + deg + " " + DIAL_CENTER + ')"' + (cls ? ' class="' + cls + '"' : "") + "/>";
      if (major) dialMarkup += '<text x="66" y="25" transform="rotate(' + deg + " " + DIAL_CENTER + ')">' + deg + "</text>";
    }
    [["N", 0, "is-north"], ["E", 90, ""], ["S", 180, "is-south"], ["W", 270, ""]].forEach(function (c) {
      dialMarkup += '<text x="66" y="37" transform="rotate(' + c[1] + " " + DIAL_CENTER + ')" class="is-letter ' + c[2] + '">' + c[0] + "</text>";
    });
    headingDialRingEl.innerHTML = dialMarkup;
  }
  const panelEl = document.getElementById("panel");
  const btnPanelToggle = document.getElementById("btn-panel-toggle");
  const btnObsList = document.getElementById("btn-obs-list");
  const btnSidebarToggle = document.getElementById("btn-sidebar-toggle");
  const bearsListEl = document.getElementById("bears-list");
  const bearListPages = window.BearProgressiveList.create({ scroller: bearsListEl, key: item => String(item.id) });
    if (bearsListEl) {
      // 빈 상태 카드의 버튼을 눌렀을 때 기존 관측점 버튼 동작을 그대로 재사용한다.
      bearsListEl.addEventListener("click", function (event) {
        const actionButton = event && event.target && typeof event.target.closest === "function"
          ? event.target.closest(".bears-empty__action")
          : null;
        if (!actionButton) return;

        event.preventDefault();
        event.stopPropagation();
        // 이미 관측점 목록이 열려 있으면 닫지 않고 무시한다 (open-only)
        const obsSheet = document.getElementById("obs-sheet");
        if (obsSheet && !obsSheet.classList.contains("hidden")) return;
        if (btnObsList && typeof btnObsList.click === "function") {
          btnObsList.click();
        }
      });
    }

  const bearsToolbarEl = document.getElementById("bears-toolbar");
  const bearsToolbarSummaryEl = document.getElementById("bears-toolbar-summary");
  const bearsSelectAllEl = document.getElementById("bears-select-all");
  const bearsSelectionCountEl = document.getElementById("bears-selection-count");
  const btnBearsDownloadAllXlsEl = document.getElementById("btn-bears-download-all-xls");
  const btnBearsUploadSelectedEl = document.getElementById("btn-bears-upload-selected");
  const btnBearsDeleteUnsharedEl = document.getElementById("btn-bears-delete-unshared");
  const bearCodeSearchFormEl = document.getElementById("bear-code-search-form");
  const btnBearMineEl = document.getElementById("btn-bear-filter-mine");
  const bearCodeSearchEl = document.getElementById("bear-code-query");
  const btnBearCodeClearEl = document.getElementById("btn-bear-code-clear");
  const btnBearFilterEl = document.getElementById("btn-bear-filter");
  const bearFilterPanelEl = document.getElementById("bear-filter-panel");
  const bearFilterCountEl = document.getElementById("bear-filter-count");
  const bearTeamFilterEl = document.getElementById("bear-filter-team");
  const bearPeriodFilterEl = document.getElementById("bear-filter-period");
  const bearDayFilterEl = document.getElementById("bear-filter-day");
  const bearMonthFilterEl = document.getElementById("bear-filter-month");
  const bearYearFilterEl = document.getElementById("bear-filter-year");
  const bearRangeFilterEl = document.getElementById("bear-filter-range");
  const bearStartFilterEl = document.getElementById("bear-filter-start");
  const bearEndFilterEl = document.getElementById("bear-filter-end");
  const bearFilterErrorEl = document.getElementById("bear-filter-error");
  const currentCoordEl = document.getElementById("obs-current-coord");
  const currentHeadingEl = document.getElementById("obs-current-heading");
  const searchParams = new URLSearchParams(window.location.search);
  const defaultTabParam = String(searchParams.get("defaultTab") || "").trim().toLowerCase();
  let removeBackButtonListener = null;
  let lastBackPressAt = 0;
  const BACK_EXIT_DOUBLE_PRESS_MS = 2000;
  let startupOverlayEl = null;
  let startupOverlayTextEl = null;
  let startupOverlayRetryBtn = null;
  let startupOverlayShowTimer = null;
  let startupOverlayVisibleAt = 0;
  let resolveStartupReady;
  window.BearStartupReady = new Promise(function (resolve) { resolveStartupReady = resolve; });
  const STARTUP_OVERLAY_DELAY_MS = 140;
  const STARTUP_OVERLAY_MIN_VISIBLE_MS = 320;
  let currentBearEstimateItems = [];
  let localBearEstimateItems = [];
  let bearPanelReady = false;
  const unifiedBearStore = window.BearEstimateStore.createStore(window);
  const localEstimateStore = window.BearEstimateStore.createLocalStore(window);
  const pendingBearUploads = new Set();
  const pendingBearDeletions = new Set();
  let currentBearEstimateFallbackMode = false;
  let remoteSharedEstimateIds = new Set();
  let sharedStatusSyncInProgress = false;
  let reconcileSharedBearEstimates = function () { return Promise.resolve(); };
  const overlayBackCloseStack = [];
  const selectedBearEstimateIds = new Set();
  let statusBlinkResetTimer = null;
  let backExitToastEl = null;
  let backExitToastIconEl = null;
  let backExitToastTextEl = null;
  let backExitToastHideTimer = null;
  let realtimeTxtExporter = null;
  let realtimeXlsExporter = null;
  let realtimeBulkXlsExporter = null;

  function mapBearMarkerItems(items, isRealtime) {
    return (Array.isArray(items) ? items : []).map(function (it) {
      return {
        id: it && it.id,
        isRealtime: !!isRealtime || !!(it && it.remoteOnly),
        shared_at: it && it.shared_at,
        source_observations: it && it.source_observations,
        bear_code: isRealtime ? (it && (it.bearCode || it.bear_code)) : (it && (it.bear_code || it.bearCode)),
        owner: it && it.owner,
        team_id: it && it.team_id,
        team_name: it && it.team_name,
        team_color: it && it.team_color,
        place: it && it.place,
        admin_region: it && (it.admin_region || it.adminRegion),
        lat: Number(it && it.lat),
        lng: Number(it && (it.lng != null ? it.lng : it.lon)),
        lat_dms: it && (it.lat_dms || it.latDms),
        lng_dms: it && (it.lng_dms || it.lon_dms || it.lonDms),
        created_at: it && (it.created_at || it.source_created_at || it.timestamp || it.ts)
      };
    }).filter(function (it) {
      return Number.isFinite(it.lat) && Number.isFinite(it.lng);
    });
  }

  function readBearPeriodFilter() {
    return { period: bearPeriodFilterEl?.value || "all", start: bearStartFilterEl?.value || "", end: bearEndFilterEl?.value || "", day: bearDayFilterEl?.value || "", month: bearMonthFilterEl?.value || "", year: bearYearFilterEl?.value || "" };
  }
  function getFilteredBearEstimates(items = currentBearEstimateItems) {
    const query = String(bearCodeSearchEl?.value || "").trim().toLowerCase();
    const team = bearTeamFilterEl?.value || "";
    const period = window.BearObservationFilters.periodKey(readBearPeriodFilter());
    if (period === null) return [];
    if (!query && !team && !period) return items;
    return items.filter(item => (!query || (String(item.bear_code || item.bearCode || "").toLowerCase().includes(query) || String(item.owner || "미지정").toLowerCase().includes(query)))
      && (!team || String(item.team_id || item.team_name || "미지정") === team)
      && (!period || window.BearObservationFilters.matchesPeriod(item.created_at || item.source_created_at || item.timestamp || item.ts, readBearPeriodFilter())));
  }

  function syncBearMarkersForActiveTab(realtimeItemsOverride) {
    renderBearMarkers(mapBearMarkerItems(getFilteredBearEstimates(), false));
  }

  function repaintUnifiedBearList() {
    if (!bearPanelReady) return;
    currentBearEstimateItems = unifiedBearStore.merge(localBearEstimateItems);
    syncBearFilterControls();
    renderBears(currentBearEstimateItems, false);
    syncBearMarkersForActiveTab();
  }

  const realtimeListModule = window.createRealtimeListModule ? window.createRealtimeListModule({
    unified: true,
    onDownloadTxt: function (item) {
      if (!realtimeTxtExporter) throw new Error("TXT 저장 기능이 준비되지 않았습니다.");
      return realtimeTxtExporter(mapBearMarkerItems([item], true)[0], false);
    },
    onDownloadXls: function (items) {
      if (!realtimeXlsExporter) throw new Error("XLS 저장 기능이 준비되지 않았습니다.");
      const mapped = mapBearMarkerItems(items, true);
      if (mapped.length === 1) return realtimeXlsExporter(mapped[0], false);
      if (!realtimeBulkXlsExporter) throw new Error("일괄 XLS 저장 기능이 준비되지 않았습니다.");
      return realtimeBulkXlsExporter(mapped);
    },
    onStatus: function (message) {
      if (statusEl) statusEl.textContent = String(message || "");
    },
    onTabActivated: function () {
      closeObservationPopup();
      if (window.BearMobileDock?.isDocked()) window.BearMobileDock.select("bears");
      else ensureBearEstimatePanelVisible();
      syncBearMarkersForActiveTab();
    },
    onItemsChanged: function (items, activeTab) {
      repaintUnifiedBearList();
    },
    onRemoteEstimatesLoaded: async function (remoteItems, metadata) {
      await unifiedBearStore.accept(remoteItems || [], metadata);
      remoteSharedEstimateIds = new Set(unifiedBearStore.raw().map(window.BearEstimateStore.originId).filter(Boolean));
      await reconcileSharedBearEstimates();
      repaintUnifiedBearList();
    },
    onFocusItem: function (item) {
      const lat = Number(item && item.lat);
      const lng = Number(item && item.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      focusBearListItem(item.id, true, [lat, lng]);
    }
  }) : null;

  // navigator.vibrate() 폴백용 ms값 (브라우저 환경 전용)
  // 실제 앱에서는 @capacitor/haptics 가 사용되므로 이 값은 무시된다.
  // haptics 미지원 환경(PC 브라우저 등)에서만 적용된다.
  // window.__bpVibrateConfig = {
  //   FEEDBACK: 30,  // 입력 오류, 위치분석 실패 등
  //   SHORT: 25      // 뒤로가기 알림
  // };

  function ensureStatusBlinkStyle() {
    if (!document || document.getElementById("bp-status-blink-style")) return;
    const styleEl = document.createElement("style");
    styleEl.id = "bp-status-blink-style";
    styleEl.textContent = [
      "@keyframes bpStatusBlinkPulse {",
      "  0% { background-color: rgba(250, 204, 21, 0); color: inherit; opacity: 1; text-shadow: 0 0 0 rgba(0,0,0,0); }",
      "  18% { background-color: rgba(250, 204, 21, 0.38); color: #111827; opacity: 1; text-shadow: 0 0 6px rgba(250, 204, 21, 0.35); }",
      "  40% { background-color: rgba(250, 204, 21, 0.14); color: #111827; opacity: 0.9; text-shadow: 0 0 2px rgba(250, 204, 21, 0.2); }",
      "  62% { background-color: rgba(250, 204, 21, 0.3); color: #111827; opacity: 1; text-shadow: 0 0 4px rgba(250, 204, 21, 0.26); }",
      "  82% { background-color: rgba(250, 204, 21, 0.1); color: inherit; opacity: 0.95; text-shadow: 0 0 0 rgba(0,0,0,0); }",
      "  100% { background-color: rgba(250, 204, 21, 0); color: inherit; opacity: 1; text-shadow: 0 0 0 rgba(0,0,0,0); }",
      "}",
      "#status.bp-status-blink-highlight {",
      "  border-radius: 8px;",
      "  padding: 2px 6px;",
      "  animation: bpStatusBlinkPulse 2s cubic-bezier(0.22, 0.61, 0.36, 1) 1;",
      "  will-change: opacity, background-color;",
      "}"
    ].join("\n");
    document.head.appendChild(styleEl);
  }

  function triggerStatusBlinkHighlight() {
    if (!statusEl) return;
    const nextText = String(statusEl.textContent || "").trim();
    if (!nextText) return;

    statusEl.classList.remove("bp-status-blink-highlight");
    void statusEl.offsetWidth;
    statusEl.classList.add("bp-status-blink-highlight");

    if (statusBlinkResetTimer) {
      window.clearTimeout(statusBlinkResetTimer);
      statusBlinkResetTimer = null;
    }

    statusBlinkResetTimer = window.setTimeout(function () {
      statusEl.classList.remove("bp-status-blink-highlight");
      statusBlinkResetTimer = null;
    }, 2000);
  }

  // 안드로이드 뒤로가기 종료 안내를 하단 토스트로 표시한다.
  function showBackExitToast(message, durationMs = BACK_EXIT_DOUBLE_PRESS_MS) {
    const text = String(message || "한번 더 뒤로가면 앱이 꺼져요.").trim();
    if (!text) return;

    if (!backExitToastEl) {
      const toast = document.createElement("div");
      toast.setAttribute("role", "status");
      toast.setAttribute("aria-live", "polite");
      toast.style.position = "fixed";
      toast.style.left = "50%";
      toast.style.bottom = "calc(var(--safe-bottom, 0px) + 72px)";
      toast.style.transform = "translate(-50%, 14px)";
      toast.style.maxWidth = "calc(100vw - 28px)";
      toast.style.padding = "10px 14px";
      toast.style.borderRadius = "999px";
      toast.style.background = "rgba(30, 41, 59, 0.94)";
      toast.style.color = "#f8fafc";
      toast.style.fontSize = "14px";
      toast.style.fontWeight = "700";
      toast.style.lineHeight = "1.2";
      toast.style.display = "inline-flex";
      toast.style.alignItems = "center";
      toast.style.gap = "8px";
      toast.style.textAlign = "center";
      toast.style.whiteSpace = "normal";
      toast.style.boxSizing = "border-box";
      toast.style.overflow = "hidden";
      toast.style.textOverflow = "ellipsis";
      toast.style.boxShadow = "0 12px 28px rgba(2,6,23,0.36)";
      toast.style.opacity = "0";
      toast.style.pointerEvents = "none";
      toast.style.zIndex = "23150";
      toast.style.transition = "opacity 160ms ease, transform 160ms ease";

      const icon = document.createElement("img");
      icon.src = "css/image/check.png";
      icon.alt = "";
      icon.style.width = "18px";
      icon.style.height = "18px";
      icon.style.flex = "0 0 18px";
      icon.style.objectFit = "contain";

      const textEl = document.createElement("span");
      textEl.style.display = "block";
      textEl.style.minWidth = "0";
      textEl.style.whiteSpace = "normal";
      textEl.style.overflowWrap = "anywhere";
      textEl.style.overflow = "hidden";
      textEl.style.textOverflow = "ellipsis";

      toast.appendChild(icon);
      toast.appendChild(textEl);
      document.body.appendChild(toast);
      backExitToastEl = toast;
      backExitToastIconEl = icon;
      backExitToastTextEl = textEl;
    }

    if (backExitToastIconEl) {
      // 측정 안내는 체크 대신 해당 도구 아이콘을 흰색으로 보여 준다.
      const measureIcon = /^거리(측정| )/.test(text) ? "css/svg/control-ruler.svg" : /^면적(측정| )/.test(text) ? "css/svg/control-area.svg" : "";
      backExitToastIconEl.src = measureIcon || "css/image/check.png";
      backExitToastIconEl.style.filter = measureIcon ? "brightness(0) invert(1)" : "";
    }
    if (backExitToastTextEl) {
      backExitToastTextEl.textContent = text;
    } else {
      backExitToastEl.textContent = text;
    }
    backExitToastEl.style.opacity = "1";
    backExitToastEl.style.transform = "translate(-50%, 0)";

    if (backExitToastHideTimer) {
      window.clearTimeout(backExitToastHideTimer);
      backExitToastHideTimer = null;
    }

    backExitToastHideTimer = window.setTimeout(resetBackExitState, durationMs);
  }

  window.__bpShowToast = message => showBackExitToast(message, 3000);

  function resetBackExitState() {
    lastBackPressAt = 0;
    if (backExitToastHideTimer !== null) {
      window.clearTimeout(backExitToastHideTimer);
      backExitToastHideTimer = null;
    }
    if (backExitToastEl) {
      backExitToastEl.style.opacity = "0";
      backExitToastEl.style.transform = "translate(-50%, 14px)";
    }
  }

  window.__bpResetBackExit = resetBackExitState;

  // 상태 강조는 필요한 상황(메뉴 진입/예외 처리)에서만 수동 호출한다.
  window.__bpTriggerStatusHighlight = triggerStatusBlinkHighlight;
  // 햅틱 피드백을 obsList/obsRegister 등 외부 모듈에서도 쓸 수 있게 전역으로 노출한다.
  window.__bpTriggerHapticImpact = triggerHapticImpact;

  function setDefaultStatusWithIcon() {
    if (!statusEl) return;
    statusEl.style.color = "";
    statusEl.innerHTML = '<img src="css/image/helloHiking.png" style="height:1.2em;vertical-align:middle;margin-top:-8px;"> 반달가슴곰 위치추적분석';
  }

  function installStatusAutoReset() {
    if (!statusEl || typeof MutationObserver !== "function") return;
    let resetTimer = null;
    const observer = new MutationObserver(function () {
      if (resetTimer !== null) window.clearTimeout(resetTimer);
      resetTimer = null;
      const message = String(statusEl.textContent || "").trim();
      if (!message || message === "반달가슴곰 위치추적분석") return;
      resetTimer = window.setTimeout(function () {
        resetTimer = null;
        if (String(statusEl.textContent || "").trim() === message) setDefaultStatusWithIcon();
      }, 5000);
    });
    observer.observe(statusEl, { childList: true, characterData: true, subtree: true });
  }
  installStatusAutoReset();

  // 다른 모듈(목록/등록)에서도 동일한 기본 상태를 재사용하도록 전역으로 노출한다.
  window.__bpSetDefaultStatus = setDefaultStatusWithIcon;

  try {
  ensureStatusBlinkStyle();

  if (!window.ol || !mapEl) {
    if (statusEl) statusEl.textContent = "OpenLayers 로딩 실패";
    return;
  }

  // 저장 함수는 이 try 블록 안에 선언된다. 목록 콜백에 같은 함수를 연결한다.
  realtimeTxtExporter = downloadBearEstimateTxt;
  realtimeXlsExporter = downloadBearEstimateXls;
  realtimeBulkXlsExporter = downloadAllBearEstimatesXls;

  // 앱 시작 시 SQLite 준비가 끝날 때까지 화면 입력을 잠그는 오버레이를 표시한다.
  function ensureStartupOverlay() {
    if (startupOverlayEl) return;

    const overlay = document.createElement("dialog");
    overlay.id = "app-startup-loading";
    overlay.setAttribute("aria-label", "앱 데이터 준비");
    overlay.setAttribute("aria-busy", "true");
    overlay.addEventListener("cancel", function (event) { event.preventDefault(); });
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "2147483646";
    overlay.style.width = "100%";
    overlay.style.height = "100%";
    overlay.style.maxWidth = "none";
    overlay.style.maxHeight = "none";
    overlay.style.margin = "0";
    overlay.style.padding = "0";
    overlay.style.border = "0";
    overlay.style.boxSizing = "border-box";
    overlay.style.display = "none";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.background = "rgba(13,18,30,0.74)";
    overlay.style.backdropFilter = "blur(2px)";

    const card = document.createElement("div");
    card.style.width = "min(78vw, 320px)";
    card.style.background = "rgba(16,26,45,0.96)";
    card.style.border = "1px solid rgba(255,255,255,0.22)";
    card.style.borderRadius = "14px";
    card.style.padding = "16px 16px 14px";
    card.style.boxShadow = "0 16px 36px rgba(0,0,0,0.34)";

    const title = document.createElement("div");
    title.textContent = "잠시만 기다려 주세요";
    title.style.color = "#ffffff";
    title.style.fontWeight = "700";
    title.style.fontSize = "15px";
    title.style.marginBottom = "8px";

    const text = document.createElement("div");
    text.textContent = "데이터를 불러오는 중입니다...";
    text.style.color = "rgba(255,255,255,0.88)";
    text.style.fontSize = "13px";
    text.style.marginBottom = "10px";

    const barTrack = document.createElement("div");
    barTrack.style.height = "6px";
    barTrack.style.width = "100%";
    barTrack.style.background = "rgba(255,255,255,0.16)";
    barTrack.style.borderRadius = "999px";
    barTrack.style.overflow = "hidden";

    const bar = document.createElement("div");
    bar.style.height = "100%";
    bar.style.width = "42%";
    bar.style.borderRadius = "999px";
    bar.style.background = "linear-gradient(90deg, #3ea2ff, #7bd6ff)";
    bar.style.animation = "bpStartLoading 1.05s ease-in-out infinite";

    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.textContent = "다시 시도";
    retryBtn.style.display = "none";
    retryBtn.style.marginTop = "12px";
    retryBtn.style.width = "100%";
    retryBtn.style.height = "36px";
    retryBtn.style.border = "1px solid rgba(255,255,255,0.35)";
    retryBtn.style.borderRadius = "9px";
    retryBtn.style.background = "#0b72c7";
    retryBtn.style.color = "#ffffff";
    retryBtn.style.fontWeight = "700";
    retryBtn.style.cursor = "pointer";

    barTrack.appendChild(bar);
    card.appendChild(title);
    card.appendChild(text);
    card.appendChild(barTrack);
    card.appendChild(retryBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const styleEl = document.createElement("style");
    styleEl.textContent = "#app-startup-loading::backdrop { background: transparent; } @keyframes bpStartLoading { 0% { transform: translateX(-115%); } 100% { transform: translateX(250%); } }";
    document.head.appendChild(styleEl);

    startupOverlayEl = overlay;
    startupOverlayTextEl = text;
    startupOverlayRetryBtn = retryBtn;
  }

  function showStartupOverlay(message, allowRetry, forceImmediate) {
    ensureStartupOverlay();
    window.BearStartupLoading = !allowRetry;
    startupOverlayEl.setAttribute("aria-busy", String(!allowRetry));
    if (startupOverlayTextEl && typeof message === "string" && message) {
      startupOverlayTextEl.textContent = message;
    }
    if (startupOverlayRetryBtn) {
      startupOverlayRetryBtn.style.display = allowRetry ? "block" : "none";
    }

    const revealOverlay = function () {
      if (!startupOverlayEl) return;
      startupOverlayEl.style.display = "flex";
      if (!startupOverlayEl.open) startupOverlayEl.showModal();
      startupOverlayVisibleAt = Date.now();
    };

    if (startupOverlayShowTimer) {
      window.clearTimeout(startupOverlayShowTimer);
      startupOverlayShowTimer = null;
    }

    if (forceImmediate) {
      revealOverlay();
      return;
    }

    startupOverlayShowTimer = window.setTimeout(function () {
      startupOverlayShowTimer = null;
      revealOverlay();
    }, STARTUP_OVERLAY_DELAY_MS);
  }

  async function hideStartupOverlay() {
    await window.BearAppUpdates?.prepareStartup?.();
    await new Promise(function (resolve) {
      if (startupOverlayShowTimer) {
        window.clearTimeout(startupOverlayShowTimer);
        startupOverlayShowTimer = null;
      }

      if (!startupOverlayEl || startupOverlayEl.style.display === "none") {
        startupOverlayVisibleAt = 0;
        resolve();
        return;
      }

      const elapsedMs = startupOverlayVisibleAt > 0 ? (Date.now() - startupOverlayVisibleAt) : 0;
      const waitMs = Math.max(0, STARTUP_OVERLAY_MIN_VISIBLE_MS - elapsedMs);

      window.setTimeout(function () {
        if (startupOverlayEl) {
          if (startupOverlayEl.open) startupOverlayEl.close();
          startupOverlayEl.style.display = "none";
        }
        startupOverlayVisibleAt = 0;
        resolve();
      }, waitMs);
    });
    await window.BearAppUpdates?.waitForStartupOffer?.();
    window.BearStartupLoading = false;
    resolveStartupReady();
  }

  async function bootWithSQLiteGate() {
    showStartupOverlay("데이터를 불러오는 중입니다...", false, true);
    let bootPhase = "sqlite-init";

    try {
      const initState = await initializeEmbeddedDatabase();
      if (!initState || !initState.ready) {
        const reason = initState && initState.reason ? String(initState.reason) : "not-ready";
        // 웹(non-native)에서는 JSON 폴백 목록을 렌더링한 뒤 화면을 연다.
        if (reason === "non-native-platform") {
          await refreshBearEstimatePanel();
          applyInitialTabFromQuery();
          await hideStartupOverlay();
          setDefaultStatusWithIcon();
          return;
        }
        throw new Error(reason);
      }

      bootPhase = "panel-render";
      await refreshBearEstimatePanel();
      applyInitialTabFromQuery();
      await hideStartupOverlay();
      setDefaultStatusWithIcon();
    } catch (error) {
      const isSqlitePhase = bootPhase === "sqlite-init";
      console.error(isSqlitePhase ? "SQLite 초기화 오류:" : "초기 화면 렌더링 오류:", error);
      if (statusEl) {
        statusEl.innerHTML =
          (isSqlitePhase ? "🔴 SQLite 초기화 실패: " : "🔴 초기 화면 렌더링 실패: ") +
          (error && error.message ? error.message : String(error));
      }
      showStartupOverlay(
        isSqlitePhase ? "SQLite 준비 실패. 다시 시도해 주세요." : "초기 화면 구성 중 오류가 발생했습니다. 다시 시도해 주세요.",
        true,
        true
      );
    }
  }

  // URL 파라미터로 전달된 기본 탭 요청(defaultTab=realtime)을 적용한다.
  function applyInitialTabFromQuery() {
    if (defaultTabParam !== "realtime") return;
    if (!realtimeListModule || typeof realtimeListModule.openRealtimeTab !== "function") return;
    realtimeListModule.openRealtimeTab();
  }

  // URL 쿼리 파라미터를 숫자로 읽고 범위를 벗어나면 기본값으로 되돌린다.
  function getNumericParam(name, fallback, min, max) {
    const raw = searchParams.get(name);
    if (raw === null) return fallback;
    const num = Number(raw);
    if (!Number.isFinite(num)) return fallback;
    if (typeof min === "number" && num < min) return fallback;
    if (typeof max === "number" && num > max) return fallback;
    return num;
  }

  const JIRISAN_BOUNDS_WGS84 = [127.4, 35.15, 127.85, 35.5];
  const MAP_PROJECTION_CODE = "EPSG:5179";
  // 구형 TM 비교 출력용(중부원점 계열) 좌표계. 지도 내부 계산은 계속 EPSG:5179를 사용한다.
  const LEGACY_TM_PROJECTION_CODE = "EPSG:5181";
  const WGS84_CODE = "EPSG:4326";
  const TILE_SIZE = 256;
  const NGII_RESOLUTION_BASE_ZOOM = 5;
  const MBTILES_MIN_ZOOM = 7;
  const MBTILES_MAX_ZOOM = 17;
  const MBTILES_DB_NAME = "korea-selection2-z7-z17-webp";
  const MBTILES_MIME_TYPE = "image/webp";
  // NGII 키 우선순위: URL 파라미터 > 전역 변수(window.NGII_API_KEY) > 기본 키.
  const NGII_DEFAULT_API_KEY = "956C9092B0E5DEDA2C6E61D92348A1FB53B88399E1";
  const NGII_API_KEY = String(searchParams.get("ngiiApiKey") || window.NGII_API_KEY || NGII_DEFAULT_API_KEY || "").trim();
  const NGII_BASE_LAYER_ID = "korean_map"; //기본 국문 타일
  const DEFAULT_BASE_LAYER_TYPE = NGII_API_KEY ? "osm" : "mbtiles";
  const OFFLINE_INITIAL_ZOOM = 9.92;
  const NATIVE_MBTILES_TILE_CACHE_LIMIT = 180;
  const LOCK_EMPTY_AREA_PAN = true;
  const PAN_LIMIT_EXTENT = [931819,1594792,1074823,1803720];//제한 extent (5179 좌표계, 지리산 주변)
  const GRID_ORIGIN = [-200000, 4000000];
  const GRID_RESOLUTIONS = [
    2088.96,
    1044.48,
    522.24,
    261.12,
    130.56,
    65.28,
    32.64,
    16.32,
    8.16,
    4.08,
    2.04,
    1.02,
    0.51,
    0.255
  ];
  const HILLSHADE_BASE_OPACITY = 0.32;
  const HILLSHADE_HARD_MAX_ZOOM = 15;
  const PARAM_MAX_ZOOM_LIMIT = 30;
  const VIEW_MAX_ZOOM = getNumericParam("olMaxZoom", 18, 3, PARAM_MAX_ZOOM_LIMIT);
  const ONLINE_MAX_ZOOM = VIEW_MAX_ZOOM;
  const BEAR_LABEL_OFFSET_Y = 12;
  const ESTIMATE_LABEL_OFFSET_Y = 18;
  // 힐셰이드는 성능/정합 이슈로 15까지만 지원한다.
  const HILLSHADE_MAX_ZOOM = Math.min(getNumericParam("olHillshadeMaxZoom", HILLSHADE_HARD_MAX_ZOOM, 3, PARAM_MAX_ZOOM_LIMIT), HILLSHADE_HARD_MAX_ZOOM);
  const HILLSHADE_SAFE_MAX_ZOOM = Math.min(getNumericParam("olHillshadeSafeMaxZoom", HILLSHADE_HARD_MAX_ZOOM, 3, PARAM_MAX_ZOOM_LIMIT), HILLSHADE_HARD_MAX_ZOOM);
  const HEADING_OFFSET = {
    ios: 0,
    android: 0,
    other: 0
  };
  // 회전 저항: 이 각도 이상 비틀어야 지도가 돈다. 너무 예민하면 올리고, 둔하면 내린다.
  const PINCH_ROTATE_THRESHOLD_DEG = 30;
  const COMPASS_CFG = {
    smoothAlpha: 0.25,
    useGpsHeadingWhenMoving: true,
    gpsMinSpeedMps: 0.8,
    gpsHeadingMaxAgeMs: 2500,
    gpsBlendAlphaMin: 0.58,
    gpsBlendAlphaMax: 0.88,  
    gpsBlendSpeedMaxMps: 8,
    jumpThresholdDeg: 70,
    unstableWindowMs: 2500,
    unstableCount: 6,
    freezeOnUnstable: true
  };

  if (!window.proj4 || !ol.proj || !ol.proj.proj4 || typeof ol.proj.proj4.register !== "function") {
    if (statusEl) statusEl.textContent = "proj4 로딩 실패";
    return;
  }

  window.proj4.defs(
    MAP_PROJECTION_CODE,
    "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs +type=crs"
  );
  // 주의: EPSG:5181은 Bessel 경위도(BL)가 아니라 TM 평면좌표계다.
  // BL(베셀 경위도) 직접 표기가 필요하면 별도 타원체/datum 변환 단계를 추가해야 한다.
  window.proj4.defs(
    LEGACY_TM_PROJECTION_CODE,
    "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs +type=crs"
  );
  ol.proj.proj4.register(window.proj4);

  // WGS84(위경도) -> EPSG:5179(미터 좌표) 변환.
  function mapCoordFromWgs84(lat, lng) {
    return ol.proj.transform([lng, lat], WGS84_CODE, MAP_PROJECTION_CODE);
  }

  // 비교 출력용: WGS84(위경도) -> EPSG:5181(TM) 변환.
  function legacyTmCoordFromWgs84(lat, lng) {
    return ol.proj.transform([lng, lat], WGS84_CODE, LEGACY_TM_PROJECTION_CODE);
  }

  // EPSG:5179(미터 좌표) -> WGS84(위경도) 변환.
  function wgs84FromMapCoord(coord) {
    if (!Array.isArray(coord) || coord.length < 2) return null;
    const lonLat = ol.proj.transform(coord, MAP_PROJECTION_CODE, WGS84_CODE);
    return { lat: lonLat[1], lng: lonLat[0] };
  }

  // MBTiles 줌 범위에 맞는 5179 해상도 배열을 잘라서 만든다.
  function buildNgiiResolutions(minZoom, maxZoom) {
    const start = minZoom - NGII_RESOLUTION_BASE_ZOOM;
    const end = maxZoom - NGII_RESOLUTION_BASE_ZOOM + 1;
    if (start < 0 || end > GRID_RESOLUTIONS.length) {
      return null;
    }
    return GRID_RESOLUTIONS.slice(start, end);
  }

  function build5179ViewResolutions(minZoom, maxZoom, minZoomResolution) {
    const result = [];
    for (let z = 0; z <= maxZoom; z += 1) {
      result.push(minZoomResolution * Math.pow(2, minZoom - z));
    }
    return result;
  }

  const mbtilesResolutions = buildNgiiResolutions(MBTILES_MIN_ZOOM, MBTILES_MAX_ZOOM);
  if (!mbtilesResolutions) {
    if (statusEl) statusEl.textContent = "MBTiles 해상도 범위 오류";
    return;
  }
  const NGII_GRID_MAX_ZOOM = NGII_RESOLUTION_BASE_ZOOM + GRID_RESOLUTIONS.length - 1;
  const NGII_ONLINE_MAX_ZOOM = Math.min(ONLINE_MAX_ZOOM, NGII_GRID_MAX_ZOOM);
  const ngiiOnlineResolutions = buildNgiiResolutions(MBTILES_MIN_ZOOM, NGII_ONLINE_MAX_ZOOM);
  if (!ngiiOnlineResolutions) {
    if (statusEl) statusEl.textContent = "NGII 해상도 범위 오류";
    return;
  }

  let locateBtnEl = null;
  let watchId = null;
  let myLocationGeneration = 0;
  let myLocationStarting = false;
  let isMyVisible = false;
  let didMoveToMe = false;
  let lastLatLng = null;
  let lastTrackedLatLng = null;
  let lastGpsTimestamp = null;
  let bearsDataCache = []; // 웹 폴백용 곰 추정위치 JSON 캐시
  let compassEnabled = false;
  let compassHandler = null;
  let compassEventName = null;
  let headingSmoothed = null;
  let lastHeadingDeg = null;
  let lastTrackedHeadingDeg = null;
  let lastAbsoluteSampleTs = 0;
  let lastGpsHeadingDeg = null;
  let lastGpsSpeedMps = null;
  let lastGpsHeadingTs = 0;
  let lastGpsSampleLatLng = null;
  let lastGpsSampleTs = 0;
  let unstableHits = [];
  let lastStableDeg = null;
  // 나침반 센서가 준 실제 바라보는 방향(각 고정과 무관). 방향 모드의 지도 회전에 쓴다.
  let lastSensorHeadingDeg = null;
  // 내 위치 버튼 상태: off(꺼짐) | on(켜짐, 지도 자유) | follow(따라가기) | heading(바라보는 방향이 위)
  let trackMode = "off";
  let headingTurnFrame = 0;

  const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
  let mbtilesSelection = null;
  let mbtilesExtentMap = null;
  let mbtilesNativeReady = false;
  let mbtilesNativeInitPromise = null;
  let mbtilesNativeFailureReason = null;
  const mbtilesNativeTileCache = new Map();

  // OpenLayers 내부 y(-1, -2...)를 XYZ 타일 y(0+)로 정규화한다.
  function normalizeXyzY(rawY) {
    return rawY < 0 ? -rawY - 1 : rawY;
  }

  // TileGrid 내부 줌(0..N)을 실제 MBTiles 줌(7..17)으로 매핑한다.
  function resolveManifestZoom(rawZoom) {
    if (!Number.isFinite(rawZoom)) return rawZoom;
    // TileGrid zoom(0..N)은 MBTiles 실제 zoom(MBTILES_MIN_ZOOM..MBTILES_MAX_ZOOM)에 오프셋을 더해 매핑한다.
    return rawZoom + MBTILES_MIN_ZOOM;
  }

  function buildExtentFromLevel5179(level, zoom) {
    const resolutionIndex = zoom - NGII_RESOLUTION_BASE_ZOOM;
    if (resolutionIndex < 0 || resolutionIndex >= GRID_RESOLUTIONS.length) return null;
    const resolution = GRID_RESOLUTIONS[resolutionIndex];
    const tileSpan = TILE_SIZE * resolution;
    return [
      GRID_ORIGIN[0] + level.minX * tileSpan,
      GRID_ORIGIN[1] - (level.maxY + 1) * tileSpan,
      GRID_ORIGIN[0] + (level.maxX + 1) * tileSpan,
      GRID_ORIGIN[1] - level.minY * tileSpan
    ];
  }

  // selection 레벨 정보에서 최대 줌 범위를 뽑아 지도의 실제 커버리지를 계산한다.
  function buildMbtilesExtent(selection) {
    if (!selection || !selection.levels) return null;
    const highest = selection.levels[String(MBTILES_MAX_ZOOM)] || selection.levels[String(Number(selection.maxZoom || MBTILES_MAX_ZOOM))];
    if (!highest) return null;
    return buildExtentFromLevel5179(highest, MBTILES_MAX_ZOOM);
  }
  // “타일 경계 가드 + 커버리지 기준 화면 맞춤”
  fetch("json/selection.json", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (sel) {
      mbtilesSelection = sel;
      mbtilesExtentMap = buildMbtilesExtent(sel);
      // fitMbtilesCoverage() 자동 호출 제거 (초기 fit과 충돌)
    })
    .catch(function () { console.warn("[MBTiles] selection.json 로드 실패"); });

  function isNativeCapacitorPlatform() {
    const capacitor = window.Capacitor;
    if (!capacitor) return false;
    if (typeof capacitor.isNativePlatform === "function") {
      return capacitor.isNativePlatform();
    }
    return typeof capacitor.getPlatform === "function" && capacitor.getPlatform() !== "web";
  }

  function getCapacitorSQLitePlugin() {
    const capacitor = window.Capacitor;
    if (!capacitor || !capacitor.Plugins) return null;
    return capacitor.Plugins.CapacitorSQLite || null;
  }

  function getCapacitorFilesystemPlugin() {
    const capacitor = window.Capacitor;
    if (!capacitor || !capacitor.Plugins) return null;
    return capacitor.Plugins.Filesystem || null;
  }

  function getCapacitorSharePlugin() {
    const capacitor = window.Capacitor;
    if (!capacitor || !capacitor.Plugins) return null;
    return capacitor.Plugins.Share || null;
  }

  function getCapacitorNativeTxtSharePlugin() {
    const capacitor = window.Capacitor;
    if (!capacitor) return null;
    // Capacitor v6+ 는 registerPlugin()으로 JS 측에도 등록해야 플러그인 접근 가능
    if (typeof capacitor.registerPlugin === "function") {
      try {
        const plugin = capacitor.registerPlugin("NativeTxtShare");
        if (plugin && typeof plugin.shareTxtFile === "function") return plugin;
      } catch (e) { /* ignore */ }
    }
    // 구버전 fallback
    if (capacitor.Plugins) return capacitor.Plugins.NativeTxtShare || null;
    return null;
  }

  function getCapacitorNativeFileOpenPlugin() {
    // NativeTxtShare 플러그인에 openFile 메서드를 함께 확장해 재사용한다.
    const plugin = getCapacitorNativeTxtSharePlugin();
    if (plugin && typeof plugin.openFile === "function") return plugin;
    return null;
  }

  async function openSavedFileLink(uriValue, options) {
    if (!uriValue) return false;

    const fileName = options && options.fileName ? String(options.fileName) : "파일";
    const filesystemDirectory = options && options.directory ? String(options.directory) : "DOCUMENTS";
    const filesystem = getCapacitorFilesystemPlugin();
    const nativeFileOpenPlugin = getCapacitorNativeFileOpenPlugin();
    const capacitor = window.Capacitor;
    let targetUri = String(uriValue).trim();

    // 상대 경로(BearMap/...)가 전달된 경우 실제 URI로 먼저 변환한다.
    if (!/^(file:|content:|https?:|blob:|data:)/i.test(targetUri)) {
      if (filesystem && typeof filesystem.getUri === "function") {
        try {
          const uriRes = await filesystem.getUri({
            path: targetUri,
            directory: filesystemDirectory
          });
          if (uriRes && uriRes.uri) {
            targetUri = String(uriRes.uri);
          }
        } catch (uriError) {
          console.warn("열기 대상 URI 변환 실패:", uriError);
        }
      }
    }

    // 네이티브 openFile 메서드가 있으면 가장 먼저 사용한다.
    if (
      isNativeCapacitorPlatform() &&
      nativeFileOpenPlugin &&
      typeof nativeFileOpenPlugin.openFile === "function" &&
      /^(file:|content:)/i.test(targetUri)
    ) {
      try {
        await nativeFileOpenPlugin.openFile({
          uri: targetUri,
          fileName: fileName,
          dialogTitle: "파일 열기"
        });
        return true;
      } catch (nativeOpenError) {
        console.warn("네이티브 파일 열기 실패:", nativeOpenError);
      }
    }

    // 사용자가 '열기'를 눌렀을 때는 공유 시트로 우회하지 않고 실패를 명확히 반환한다.
    if (isNativeCapacitorPlatform() && /^(file:|content:)/i.test(targetUri)) {
      return false;
    }

    if (/^content:/i.test(targetUri)) {
      return false;
    }

    try {
      const link = (/^file:/i.test(targetUri) && capacitor && typeof capacitor.convertFileSrc === "function")
        ? capacitor.convertFileSrc(targetUri)
        : targetUri;

      if (!/^(https?:|file:|blob:|data:)/i.test(link)) {
        return false;
      }

      const a = document.createElement("a");
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    } catch (error) {
      console.warn("저장 파일 링크 열기 실패:", error);
      return false;
    }
  }

  // 저장 완료 후 '열기/닫기'를 선택하는 공용 다이얼로그.
  function showSavedFileOpenDialog(options) {
    return new Promise(function (resolve) {
      const filePathText = options && options.filePathText ? String(options.filePathText) : "Documents/BearMap";
      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "23100";
      overlay.style.background = "rgba(15,23,42,0.45)";
      overlay.style.display = "flex";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.padding = "18px";

      const card = document.createElement("div");
      card.style.width = "min(92vw, 360px)";
      card.style.background = "#ffffff";
      card.style.color = "#0f172a";
      card.style.border = "1px solid rgba(15,23,42,0.12)";
      card.style.borderRadius = "14px";
      card.style.boxShadow = "0 16px 36px rgba(2,6,23,0.3)";
      card.style.overflow = "hidden";

      const body = document.createElement("div");
      body.style.padding = "16px 16px 12px";

      const title = document.createElement("div");
      title.textContent = "저장되었습니다.";
      title.style.fontSize = "20px";
      title.style.fontWeight = "700";
      title.style.marginBottom = "10px";

      const pathLabel = document.createElement("div");
      pathLabel.textContent = "경로: " + filePathText;
      pathLabel.style.fontSize = "14px";
      pathLabel.style.lineHeight = "1.5";
      pathLabel.style.color = "#334155";
      pathLabel.style.wordBreak = "break-all";

      const footer = document.createElement("div");
      footer.style.display = "grid";
      footer.style.gridTemplateColumns = "1fr 1fr";
      footer.style.gap = "8px";
      footer.style.padding = "12px 16px 16px";

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.textContent = "열기";
      openBtn.style.height = "40px";
      openBtn.style.border = "1px solid #0ea5e9";
      openBtn.style.borderRadius = "10px";
      openBtn.style.background = "#f0f9ff";
      openBtn.style.color = "#075985";
      openBtn.style.fontWeight = "700";
      openBtn.style.cursor = "pointer";

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "닫기";
      closeBtn.style.height = "40px";
      closeBtn.style.border = "1px solid rgba(148,163,184,0.3)";
      closeBtn.style.borderRadius = "10px";
      closeBtn.style.background = "#f8fafc";
      closeBtn.style.color = "#334155";
      closeBtn.style.fontWeight = "700";
      closeBtn.style.cursor = "pointer";

      let isClosed = false;
      let unregisterOverlayBackClose = function () {};

      function closeWith(action) {
        if (isClosed) return;
        isClosed = true;
        unregisterOverlayBackClose();
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(action || "close");
      }

      unregisterOverlayBackClose = registerBackClosableOverlay(overlay, function () {
        closeWith("close");
      });

      overlay.addEventListener("click", function (event) {
        if (event.target === overlay) closeWith("close");
      });
      closeBtn.addEventListener("click", function () { closeWith("close"); });
      openBtn.addEventListener("click", function () { closeWith("open"); });

      body.appendChild(title);
      body.appendChild(pathLabel);
      footer.appendChild(openBtn);
      footer.appendChild(closeBtn);
      card.appendChild(body);
      card.appendChild(footer);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    });
  }

  // 공용 확인 팝업: 기본 confirm 대화상자 대신 디자인된 확인 UI를 제공한다.
  let styledConfirmPending = false;
  function showStyledConfirmDialog(options) {
    // Never share a positive answer with a second caller: each action needs its own confirmation.
    if (styledConfirmPending) return Promise.resolve(false);
    styledConfirmPending = true;
    return new Promise(function (resolve) {
      const previousFocus = document.activeElement;
      const titleText = options && options.title ? String(options.title) : "확인";
      const messageText = options && options.message ? String(options.message) : "계속 진행할까요?";
      const detailText = options && options.detail ? String(options.detail) : "";
      const confirmText = options && options.confirmText ? String(options.confirmText) : "확인";
      const cancelText = options && options.cancelText ? String(options.cancelText) : "취소";
      const isDanger = !!(options && options.tone === "danger");

      const overlay = document.createElement("dialog");
      overlay.className = "bp-confirm-dialog";
      overlay.setAttribute("role", "alertdialog");
      overlay.setAttribute("aria-labelledby", "bp-confirm-title");
      overlay.setAttribute("aria-describedby", "bp-confirm-message");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.margin = "0";
      overlay.style.width = "100vw";
      overlay.style.height = "100dvh";
      overlay.style.maxWidth = "none";
      overlay.style.maxHeight = "none";
      overlay.style.border = "0";
      overlay.style.boxSizing = "border-box";
      overlay.style.zIndex = "23110";
      overlay.style.background = "rgba(15,23,42,0.45)";
      overlay.style.display = "flex";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.padding = "18px";

      const card = document.createElement("div");
      card.style.width = "min(92vw, 368px)";
      card.style.background = "#ffffff";
      card.style.color = "#0f172a";
      card.style.border = "1px solid rgba(15,23,42,0.12)";
      card.style.borderRadius = "14px";
      card.style.boxShadow = "0 16px 36px rgba(2,6,23,0.3)";
      card.style.overflow = "hidden";
      card.style.maxHeight = "calc(100dvh - 36px)";
      card.style.overflowY = "auto";

      const body = document.createElement("div");
      body.style.padding = "16px 16px 12px";

      const title = document.createElement("div");
      title.id = "bp-confirm-title";
      title.textContent = titleText;
      title.style.fontSize = "20px";
      title.style.fontWeight = "700";
      title.style.marginBottom = "8px";

      const message = document.createElement("div");
      message.id = "bp-confirm-message";
      message.textContent = messageText;
      message.style.fontSize = "15px";
      message.style.lineHeight = "1.55";
      message.style.color = "#334155";
      message.style.whiteSpace = "pre-line";

      body.appendChild(title);
      body.appendChild(message);

      if (detailText) {
        const detail = document.createElement("div");
        detail.textContent = detailText;
        detail.style.marginTop = "8px";
        detail.style.fontSize = "13px";
        detail.style.lineHeight = "1.45";
        detail.style.color = "#64748b";
        detail.style.whiteSpace = "pre-line";
        body.appendChild(detail);
      }

      const footer = document.createElement("div");
      footer.style.display = "grid";
      footer.style.gridTemplateColumns = "1fr 1fr";
      footer.style.gap = "8px";
      footer.style.padding = "12px 16px 16px";

      const cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.textContent = cancelText;
      cancelBtn.style.height = "40px";
      cancelBtn.style.border = "1px solid rgba(148,163,184,0.34)";
      cancelBtn.style.borderRadius = "10px";
      cancelBtn.style.background = "#f8fafc";
      cancelBtn.style.color = "#334155";
      cancelBtn.style.fontWeight = "700";
      cancelBtn.style.cursor = "pointer";

      const confirmBtn = document.createElement("button");
      confirmBtn.type = "button";
      confirmBtn.textContent = confirmText;
      confirmBtn.style.height = "40px";
      confirmBtn.style.border = isDanger ? "1px solid #ef4444" : "1px solid #0ea5e9";
      confirmBtn.style.borderRadius = "10px";
      confirmBtn.style.background = isDanger ? "#fee2e2" : "#f0f9ff";
      confirmBtn.style.color = isDanger ? "#991b1b" : "#075985";
      confirmBtn.style.fontWeight = "700";
      confirmBtn.style.cursor = "pointer";

      let isClosed = false;
      let unregisterOverlayBackClose = function () {};

      function closeWith(confirmed) {
        if (isClosed) return;
        isClosed = true;
        unregisterOverlayBackClose();
        overlay.close();
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        if (previousFocus && previousFocus.isConnected && typeof previousFocus.focus === "function") previousFocus.focus();
        resolve(!!confirmed);
      }

      unregisterOverlayBackClose = registerBackClosableOverlay(overlay, function () {
        closeWith(false);
      });

      overlay.addEventListener("click", function (event) {
        if (event.target === overlay) closeWith(false);
      });
      overlay.addEventListener("cancel", function (event) { event.preventDefault(); closeWith(false); });
      cancelBtn.addEventListener("click", function () { closeWith(false); });
      confirmBtn.addEventListener("click", function () { closeWith(true); });

      card.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeWith(false);
          return;
        }
      });

      footer.appendChild(cancelBtn);
      footer.appendChild(confirmBtn);
      card.appendChild(body);
      card.appendChild(footer);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
      overlay.showModal();
      cancelBtn.focus();
    }).finally(function () { styledConfirmPending = false; });
  }

  window.__bpShowConfirmDialog = showStyledConfirmDialog;

  async function ensureFileUriForShare(fileName, uriCandidate, txtContent) {
    if (uriCandidate && /^file:/i.test(String(uriCandidate))) {
      return String(uriCandidate);
    }

    const filesystem = getCapacitorFilesystemPlugin();
    if (!filesystem || typeof filesystem.writeFile !== "function") {
      return uriCandidate || null;
    }

    try {
      const cachePath = "BearMapShare/" + fileName;
      await filesystem.writeFile({
        path: cachePath,
        data: txtContent || "",
        directory: "CACHE",
        encoding: "utf8",
        recursive: true
      });

      if (typeof filesystem.getUri === "function") {
        const uriRes = await filesystem.getUri({ path: cachePath, directory: "CACHE" });
        const cacheUri = uriRes && uriRes.uri ? String(uriRes.uri) : null;
        if (cacheUri && /^file:/i.test(cacheUri)) {
          return cacheUri;
        }
      }
    } catch (cacheError) {
      console.warn("공유용 캐시 파일 준비 실패:", cacheError);
    }

    return uriCandidate || null;
  }

  async function shareSavedTxtFile(fileName, savedUri, txtContent) {
    const nativeTxtShare = getCapacitorNativeTxtSharePlugin();
    const sharePlugin = getCapacitorSharePlugin();

    // 네이티브 플러그인이 있으면 파일 내용을 직접 넘긴다.
    // Java가 Cache에 직접 쓰고 FileProvider content:// URI로 공유하므로 경로 해석 실패 없음.
    if (nativeTxtShare && typeof nativeTxtShare.shareTxtFile === "function") {
      try {
        await nativeTxtShare.shareTxtFile({
          fileName: fileName,
          txtContent: txtContent || "",
          dialogTitle: "TXT 공유"
        });
        if (statusEl) statusEl.textContent = "✅ 공유 창을 열었습니다: " + fileName;
        return true;
      } catch (shareError) {
        if (shareError && /cancel/i.test(shareError.message || "")) { return false; }
        console.warn("TXT 공유 실패:", shareError);
        if (statusEl) {
          statusEl.textContent = "🔴 공유 실패: " + (shareError && shareError.message ? shareError.message : String(shareError));
        }
        return false;
      }
    }

    // fallback: @capacitor/share (웹/데스크톱)
    if (!sharePlugin || typeof sharePlugin.share !== "function") {
      if (statusEl) statusEl.textContent = "⚠️ 공유 플러그인이 없습니다.";
      return false;
    }
    const fileUri = await ensureFileUriForShare(fileName, savedUri, txtContent);
    if (!fileUri || !/^file:/i.test(String(fileUri))) {
      if (statusEl) statusEl.textContent = "⚠️ 공유할 파일 경로를 찾지 못했습니다.";
      return false;
    }
    try {
      await sharePlugin.share({ title: fileName, files: [fileUri], dialogTitle: "TXT 공유" });
      if (statusEl) statusEl.textContent = "✅ 공유 창을 열었습니다: " + fileName;
      return true;
    } catch (shareError) {
      if (shareError && /cancel/i.test(shareError.message || "")) { return false; }
      console.warn("TXT 공유 실패:", shareError);
      if (statusEl) {
        statusEl.textContent = "🔴 공유 실패: " + (shareError && shareError.message ? shareError.message : String(shareError));
      }
      return false;
    }
  }

  async function saveTxtToNativeDocuments(fileName, txtContent) {
    const filesystem = getCapacitorFilesystemPlugin();
    if (!filesystem || typeof filesystem.writeFile !== "function") {
      if (statusEl) statusEl.textContent = "⚠️ TXT 저장 플러그인이 없습니다. 앱을 다시 빌드해 주세요.";
      return null;
    }

    const relativePath = "BearMap/" + fileName;
    await filesystem.writeFile({
      path: relativePath,
      data: txtContent,
      directory: "DOCUMENTS",
      encoding: "utf8",
      recursive: true
    });

    let savedUri = null;
    if (typeof filesystem.getUri === "function") {
      try {
        const uriRes = await filesystem.getUri({ path: relativePath, directory: "DOCUMENTS" });
        savedUri = uriRes && uriRes.uri ? uriRes.uri : null;
      } catch (uriError) {
        console.warn("저장 파일 URI 조회 실패:", uriError);
      }
    }

    if (statusEl) statusEl.textContent = "✅ TXT 저장 완료: Documents/BearMap/" + fileName;

    return {
      relativePath: relativePath,
      savedUri: savedUri
    };
  }

  async function getNativeTxtUriIfExists(fileName) {
    const filesystem = getCapacitorFilesystemPlugin();
    if (!filesystem || typeof filesystem.stat !== "function") return null;

    const relativePath = "BearMap/" + fileName;

    try {
      await filesystem.stat({
        path: relativePath,
        directory: "DOCUMENTS"
      });

      let savedUri = null;
      if (typeof filesystem.getUri === "function") {
        try {
          const uriRes = await filesystem.getUri({ path: relativePath, directory: "DOCUMENTS" });
          savedUri = uriRes && uriRes.uri ? uriRes.uri : null;
        } catch (uriError) {
          console.warn("기존 파일 URI 조회 실패:", uriError);
        }
      }

      return {
        relativePath: relativePath,
        savedUri: savedUri
      };
    } catch (error) {
      return null;
    }
  }

  // 저장 완료 후 동작을 선택하는 미니 팝업 (미리보기 / 공유하기 / 닫기)
  function showSavedFileActionPopup(fileName) {
    return new Promise(function (resolve) {
      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "23050";
      overlay.style.background = "rgba(15,23,42,0.35)";
      overlay.style.display = "flex";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.pointerEvents = "auto";

      const card = document.createElement("div");
      card.style.position = "relative";
      card.style.zIndex = "1";
      card.style.width = "min(86vw, 320px)";
      card.style.background = "#ffffff";
      card.style.border = "1px solid rgba(15,23,42,0.12)";
      card.style.borderRadius = "12px";
      card.style.boxShadow = "0 14px 34px rgba(15,23,42,0.28)";
      card.style.padding = "12px";

      const header = document.createElement("div");
      header.style.display = "flex";
      header.style.alignItems = "center";
      header.style.justifyContent = "space-between";
      header.style.marginBottom = "8px";

      const title = document.createElement("div");
      title.textContent = "TXT 저장 완료";
      title.style.fontSize = "14px";
      title.style.fontWeight = "700";
      title.style.color = "#0f172a";

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "×";
      closeBtn.style.width = "28px";
      closeBtn.style.height = "28px";
      closeBtn.style.border = "1px solid rgba(15,23,42,0.18)";
      closeBtn.style.borderRadius = "8px";
      closeBtn.style.background = "#ffffff";
      closeBtn.style.fontSize = "18px";
      closeBtn.style.lineHeight = "1";
      closeBtn.style.cursor = "pointer";

      const nameText = document.createElement("div");
      nameText.textContent = fileName || "bear_estimate.txt";
      nameText.style.fontSize = "11px";
      nameText.style.color = "#64748b";
      nameText.style.marginBottom = "10px";
      nameText.style.whiteSpace = "nowrap";
      nameText.style.overflow = "hidden";
      nameText.style.textOverflow = "ellipsis";

      const btnRow = document.createElement("div");
      btnRow.style.display = "grid";
      btnRow.style.gridTemplateColumns = "1fr 1fr";
      btnRow.style.gap = "8px";

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.textContent = "미리보기";
      openBtn.style.height = "36px";
      openBtn.style.border = "1px solid #0ea5e9";
      openBtn.style.borderRadius = "9px";
      openBtn.style.background = "#f0f9ff";
      openBtn.style.color = "#0369a1";
      openBtn.style.fontWeight = "700";
      openBtn.style.cursor = "pointer";

      const shareBtn = document.createElement("button");
      shareBtn.type = "button";
      shareBtn.textContent = "공유하기";
      shareBtn.style.height = "36px";
      shareBtn.style.border = "1px solid #16a34a";
      shareBtn.style.borderRadius = "9px";
      shareBtn.style.background = "#f0fdf4";
      shareBtn.style.color = "#166534";
      shareBtn.style.fontWeight = "700";
      shareBtn.style.cursor = "pointer";

      let isClosed = false;
      let unregisterOverlayBackClose = function () {};

      function closeWith(action) {
        if (isClosed) return;
        isClosed = true;
        unregisterOverlayBackClose();
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(action || null);
      }

      unregisterOverlayBackClose = registerBackClosableOverlay(overlay, function () {
        closeWith(null);
      });

      closeBtn.addEventListener("click", function () { closeWith(null); });
      openBtn.addEventListener("click", function () { closeWith("open"); });
      shareBtn.addEventListener("click", function () { closeWith("share"); });

      header.appendChild(title);
      header.appendChild(closeBtn);
      btnRow.appendChild(openBtn);
      btnRow.appendChild(shareBtn);
      card.appendChild(header);
      card.appendChild(nameText);
      card.appendChild(btnRow);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    });
  }

  async function copyTextToClipboard(text) {
    const value = typeof text === "string" ? text : String(text == null ? "" : text);

    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(value);
      return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "readonly");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } finally {
      if (textarea.parentNode) textarea.parentNode.removeChild(textarea);
    }

    if (!copied) {
      throw new Error("클립보드 복사에 실패했습니다.");
    }

    return true;
  }

  // 문자 앱을 sms: 링크로 열고 TXT 본문을 미리 채우려던 보조 기능.
  // 현재는 별도 문자 버튼을 숨기기로 해서 구현만 주석으로 보관한다.
  // function openSmsComposer(text) {
  //   const value = typeof text === "string" ? text : String(text == null ? "" : text);
  //   if (!value.trim()) {
  //     throw new Error("문자에 넣을 내용이 없습니다.");
  //   }

  //   const anchor = document.createElement("a");
  //   anchor.href = "sms:?body=" + encodeURIComponent(value);
  //   anchor.style.display = "none";
  //   document.body.appendChild(anchor);
  //   anchor.click();
  //   document.body.removeChild(anchor);
  //   return true;
  // }

  function showSavedTxtPreviewPopup(options) {
    closeObservationPopup();
    return new Promise(function (resolve) {
      const fileName = options && options.fileName ? options.fileName : "bear_estimate.txt";
      const txtContent = options && typeof options.txtContent === "string" ? options.txtContent : "";
      const savedUri = options && options.savedUri ? options.savedUri : null;
      const onSave = options && typeof options.onSave === "function" ? options.onSave : null;
      const onShare = options && typeof options.onShare === "function" ? options.onShare : null;
      // 문자 버튼을 다시 쓸 경우 외부에서 문자 앱 실행 로직을 주입할 수 있도록 두었던 콜백.
      // const onSms = options && typeof options.onSms === "function" ? options.onSms : null;

      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "23060";
      overlay.style.background = "rgba(15,23,42,0.45)";
      overlay.style.display = "flex";
      //overlay.style.alignItems = "center";
      overlay.style.alignItems = "flex-start";
      overlay.style.justifyContent = "center";
      overlay.style.padding = "calc(env(safe-area-inset-top, 0px) + 18px) 18px calc(env(safe-area-inset-bottom, 0px) + 18px)";

      const card = document.createElement("div");
      card.style.width = "min(92vw, 520px)";
      card.style.maxHeight = "calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 36px)";
      card.style.display = "flex";
      card.style.flexDirection = "column";
      card.style.background = "#0f172a";
      card.style.color = "#e2e8f0";
      card.style.borderRadius = "16px";
      card.style.boxShadow = "0 18px 40px rgba(2,6,23,0.45)";
      card.style.overflow = "hidden";
      card.style.border = "1px solid rgba(148,163,184,0.22)";

      const header = document.createElement("div");
      header.style.display = "flex";
      header.style.alignItems = "center";
      header.style.justifyContent = "space-between";
      header.style.padding = "14px 14px 10px";
      header.style.borderBottom = "1px solid rgba(148,163,184,0.14)";

      const titleWrap = document.createElement("div");
      titleWrap.style.minWidth = "0";

      const title = document.createElement("div");
      title.textContent = "TXT 미리보기";
      title.style.fontSize = "15px";
      title.style.fontWeight = "700";
      title.style.color = "#f8fafc";

      const subtitle = document.createElement("div");
      subtitle.textContent = fileName;
      subtitle.style.fontSize = "11px";
      subtitle.style.color = "#94a3b8";
      subtitle.style.marginTop = "3px";
      subtitle.style.whiteSpace = "nowrap";
      subtitle.style.overflow = "hidden";
      subtitle.style.textOverflow = "ellipsis";

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "×";
      closeBtn.style.width = "32px";
      closeBtn.style.height = "32px";
      closeBtn.style.border = "1px solid rgba(148,163,184,0.24)";
      closeBtn.style.borderRadius = "10px";
      closeBtn.style.background = "rgba(255,255,255,0.06)";
      closeBtn.style.color = "#f8fafc";
      closeBtn.style.fontSize = "20px";
      closeBtn.style.cursor = "pointer";

      const body = document.createElement("pre");
      body.textContent = txtContent;
      body.style.margin = "0";
      body.style.padding = "10px";
      body.style.flex = "1 1 auto";
      body.style.overflow = "auto";
      body.style.background = "#020617";
      body.style.color = "#e2e8f0";
      body.style.fontSize = "12px";
      body.style.lineHeight = "1.55";
      body.style.fontFamily = "Consolas, 'Courier New', monospace";
      body.style.whiteSpace = "pre-wrap";
      body.style.wordBreak = "break-word";

      const footer = document.createElement("div");
      footer.style.display = "grid";
      footer.style.gridTemplateColumns = "repeat(4, minmax(0, 1fr))";
      footer.style.gap = "8px";
      footer.style.padding = "12px 14px 14px";
      footer.style.borderTop = "1px solid rgba(148,163,184,0.14)";
      footer.style.background = "#0b1220";

      const previewSaveBtn = document.createElement("button");
      previewSaveBtn.type = "button";
      previewSaveBtn.textContent = "저장하기";
      previewSaveBtn.style.height = "38px";
      previewSaveBtn.style.border = "1px solid #f59e0b";
      previewSaveBtn.style.borderRadius = "10px";
      previewSaveBtn.style.background = "#fef3c7";
      previewSaveBtn.style.color = "#92400e";
      previewSaveBtn.style.fontWeight = "700";
      previewSaveBtn.style.cursor = "pointer";

      const previewShareBtn = document.createElement("button");
      previewShareBtn.type = "button";
      previewShareBtn.textContent = "공유하기";
      previewShareBtn.style.height = "38px";
      previewShareBtn.style.border = "1px solid #16a34a";
      previewShareBtn.style.borderRadius = "10px";
      previewShareBtn.style.background = "#dcfce7";
      previewShareBtn.style.color = "#166534";
      previewShareBtn.style.fontWeight = "700";
      previewShareBtn.style.cursor = "pointer";

      const previewCopyBtn = document.createElement("button");
      previewCopyBtn.type = "button";
      previewCopyBtn.textContent = "복사하기";
      previewCopyBtn.style.height = "38px";
      previewCopyBtn.style.border = "1px solid #7c3aed";
      previewCopyBtn.style.borderRadius = "10px";
      previewCopyBtn.style.background = "#f3e8ff";
      previewCopyBtn.style.color = "#6d28d9";
      previewCopyBtn.style.fontWeight = "700";
      previewCopyBtn.style.cursor = "pointer";

      // 문자 메시지 앱으로 직접 보내는 전용 버튼 UI.
      // 공유하기가 파일 첨부 중심이라 문자 앱에서 TXT를 못 받는 경우를 우회하려고 추가했었다.
      // const previewSmsBtn = document.createElement("button");
      // previewSmsBtn.type = "button";
      // previewSmsBtn.textContent = "문자 보내기";
      // previewSmsBtn.style.height = "38px";
      // previewSmsBtn.style.border = "1px solid #f97316";
      // previewSmsBtn.style.borderRadius = "10px";
      // previewSmsBtn.style.background = "#ffedd5";
      // previewSmsBtn.style.color = "#c2410c";
      // previewSmsBtn.style.fontWeight = "700";
      // previewSmsBtn.style.cursor = "pointer";

      const doneBtn = document.createElement("button");
      doneBtn.type = "button";
      doneBtn.textContent = "닫기";
      doneBtn.style.height = "38px";
      doneBtn.style.border = "1px solid rgba(148,163,184,0.28)";
      doneBtn.style.borderRadius = "10px";
      doneBtn.style.background = "rgba(255,255,255,0.06)";
      doneBtn.style.color = "#e2e8f0";
      doneBtn.style.fontWeight = "700";
      doneBtn.style.cursor = "pointer";

      let isClosed = false;
      let unregisterOverlayBackClose = function () {};

      function closeWith(action) {
        if (isClosed) return;
        isClosed = true;
        unregisterOverlayBackClose();
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(action || null);
      }

      unregisterOverlayBackClose = registerBackClosableOverlay(overlay, function () {
        closeWith(null);
      });

      overlay.addEventListener("click", function (event) {
        if (event.target === overlay) closeWith(null);
      });
      closeBtn.addEventListener("click", function () { closeWith(null); });
      doneBtn.addEventListener("click", function () { closeWith(null); });
      previewSaveBtn.addEventListener("click", async function () {
        previewSaveBtn.disabled = true;
        if (onSave) {
          try {
            const saveResult = await onSave();
            if (!isNativeCapacitorPlatform()) {
              closeWith("saved");
              return;
            }
            const savePath = saveResult && saveResult.relativePath
              ? saveResult.relativePath
              : ("BearMap/" + fileName);
            const nextAction = await showSavedFileOpenDialog({
              filePathText: "Documents/" + savePath
            });
            if (nextAction === "open") {
              const opened = await openSavedFileLink(
                saveResult && saveResult.savedUri ? saveResult.savedUri : (saveResult && saveResult.relativePath ? saveResult.relativePath : null),
                { fileName: fileName, directory: "DOCUMENTS" }
              );
              if (!opened) {
                window.alert("파일을 열지 못했습니다. 파일 관리자에서 직접 열어주세요.\n경로: Documents/" + savePath);
              }
            }
            closeWith("saved");
          } finally {
            previewSaveBtn.disabled = false;
          }
          return;
        }
        previewSaveBtn.disabled = false;
      });
      previewShareBtn.addEventListener("click", async function () {
        if (onShare) {
          await onShare();
          return;
        }
        await shareSavedTxtFile(fileName, savedUri, txtContent);
      });
      previewCopyBtn.addEventListener("click", async function () {
        previewCopyBtn.disabled = true;
        const originalText = previewCopyBtn.textContent;
        try {
          await copyTextToClipboard(txtContent);
          previewCopyBtn.textContent = "복사 완료";
          if (statusEl) statusEl.textContent = "✅ TXT 내용을 복사했습니다.";
        } catch (copyError) {
          console.warn("TXT 복사 실패:", copyError);
          if (statusEl) {
            statusEl.textContent = "🔴 TXT 복사 실패: " + (copyError && copyError.message ? copyError.message : String(copyError));
          }
          window.alert("복사에 실패했습니다. 다른 앱 공유를 사용해 주세요.");
        } finally {
          window.setTimeout(function () {
            previewCopyBtn.textContent = originalText;
            previewCopyBtn.disabled = false;
          }, 1200);
        }
      });
      // 문자 버튼 클릭 시 sms: 링크 또는 외부 onSms 콜백으로 문자 앱을 열던 처리.
      // 본문 자동 입력이 안 되는 기기에서는 복사하기 버튼을 함께 쓰는 흐름을 의도했다.
      // previewSmsBtn.addEventListener("click", async function () {
      //   previewSmsBtn.disabled = true;
      //   try {
      //     if (onSms) {
      //       await onSms();
      //     } else {
      //       openSmsComposer(txtContent);
      //     }
      //     if (statusEl) statusEl.textContent = "✅ 문자 앱을 열었습니다. 본문이 자동 입력되지 않으면 복사하기를 사용해 주세요.";
      //   } catch (smsError) {
      //     console.warn("문자 앱 열기 실패:", smsError);
      //     if (statusEl) {
      //       statusEl.textContent = "🔴 문자 앱 열기 실패: " + (smsError && smsError.message ? smsError.message : String(smsError));
      //     }
      //     window.alert("문자 앱을 열지 못했습니다. 복사하기로 붙여넣어 주세요.");
      //   } finally {
      //     previewSmsBtn.disabled = false;
      //   }
      // });

      titleWrap.appendChild(title);
      titleWrap.appendChild(subtitle);
      header.appendChild(titleWrap);
      header.appendChild(closeBtn);
      footer.appendChild(previewSaveBtn);
      footer.appendChild(previewShareBtn);
      footer.appendChild(previewCopyBtn);
      // 현재 팝업 버튼 구성은 저장하기, 공유하기, 복사하기, 닫기만 유지한다.
      // footer.appendChild(previewSmsBtn);
      footer.appendChild(doneBtn);
      card.appendChild(header);
      card.appendChild(body);
      card.appendChild(footer);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    });
  }

  // XLS 파일 미리보기 팝업 (저장하기, 공유하기, 닫기 3개 버튼만 지원)
  function showSavedXlsPreviewPopup(options) {
    closeObservationPopup();
    return new Promise(function (resolve) {
      const fileName = options && options.fileName ? options.fileName : "bear_estimate.xlsx";
      const previewHtml = options && typeof options.previewHtml === "string" ? options.previewHtml : "";
      const onSave = options && typeof options.onSave === "function" ? options.onSave : null;
      const onShare = options && typeof options.onShare === "function" ? options.onShare : null;

      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "23060";
      overlay.style.background = "rgba(15,23,42,0.45)";
      overlay.style.display = "flex";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.padding = "calc(env(safe-area-inset-top, 0px) + 18px) 18px calc(env(safe-area-inset-bottom, 0px) + 18px)";

      const card = document.createElement("div");
      card.style.width = "min(92vw, 520px)";
      card.style.maxHeight = "calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 36px)";
      card.style.display = "flex";
      card.style.flexDirection = "column";
      card.style.background = "#0f172a";
      card.style.color = "#e2e8f0";
      card.style.borderRadius = "16px";
      card.style.boxShadow = "0 18px 40px rgba(2,6,23,0.45)";
      card.style.overflow = "hidden";
      card.style.border = "1px solid rgba(148,163,184,0.22)";

      const header = document.createElement("div");
      header.style.display = "flex";
      header.style.alignItems = "center";
      header.style.justifyContent = "space-between";
      header.style.padding = "14px 14px 10px";
      header.style.borderBottom = "1px solid rgba(148,163,184,0.14)";

      const titleWrap = document.createElement("div");
      titleWrap.style.minWidth = "0";

      const title = document.createElement("div");
      title.textContent = "XLS 미리보기";
      title.style.fontSize = "15px";
      title.style.fontWeight = "700";
      title.style.color = "#f8fafc";

      const subtitle = document.createElement("div");
      subtitle.textContent = fileName;
      subtitle.style.fontSize = "11px";
      subtitle.style.color = "#94a3b8";
      subtitle.style.marginTop = "3px";
      subtitle.style.whiteSpace = "nowrap";
      subtitle.style.overflow = "hidden";
      subtitle.style.textOverflow = "ellipsis";

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "×";
      closeBtn.style.width = "32px";
      closeBtn.style.height = "32px";
      closeBtn.style.border = "1px solid rgba(148,163,184,0.24)";
      closeBtn.style.borderRadius = "10px";
      closeBtn.style.background = "rgba(255,255,255,0.06)";
      closeBtn.style.color = "#f8fafc";
      closeBtn.style.fontSize = "20px";
      closeBtn.style.cursor = "pointer";

      const body = document.createElement("div");
      body.innerHTML = previewHtml;
      body.style.margin = "0";
      body.style.padding = "14px";
      body.style.flex = "1 1 auto";
      body.style.overflow = "auto";
      body.style.background = "#020617";
      body.style.color = "#e2e8f0";
      body.style.fontSize = "12px";
      body.style.lineHeight = "1.55";
      body.style.fontFamily = "Consolas, 'Courier New', monospace";

      const footer = document.createElement("div");
      footer.style.display = "grid";
      footer.style.gridTemplateColumns = onShare ? "repeat(3, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))";
      footer.style.gap = "8px";
      footer.style.padding = "12px 14px 14px";
      footer.style.borderTop = "1px solid rgba(148,163,184,0.14)";
      footer.style.background = "#0b1220";

      const previewSaveBtn = document.createElement("button");
      previewSaveBtn.type = "button";
      previewSaveBtn.textContent = "저장하기";
      previewSaveBtn.style.height = "38px";
      previewSaveBtn.style.border = "1px solid #f59e0b";
      previewSaveBtn.style.borderRadius = "10px";
      previewSaveBtn.style.background = "#fef3c7";
      previewSaveBtn.style.color = "#92400e";
      previewSaveBtn.style.fontWeight = "700";
      previewSaveBtn.style.cursor = "pointer";

      const previewShareBtn = document.createElement("button");
      previewShareBtn.type = "button";
      previewShareBtn.textContent = "공유하기";
      previewShareBtn.style.height = "38px";
      previewShareBtn.style.border = "1px solid #16a34a";
      previewShareBtn.style.borderRadius = "10px";
      previewShareBtn.style.background = "#dcfce7";
      previewShareBtn.style.color = "#166534";
      previewShareBtn.style.fontWeight = "700";
      previewShareBtn.style.cursor = "pointer";

      const doneBtn = document.createElement("button");
      doneBtn.type = "button";
      doneBtn.textContent = "닫기";
      doneBtn.style.height = "38px";
      doneBtn.style.border = "1px solid rgba(148,163,184,0.28)";
      doneBtn.style.borderRadius = "10px";
      doneBtn.style.background = "rgba(255,255,255,0.06)";
      doneBtn.style.color = "#e2e8f0";
      doneBtn.style.fontWeight = "700";
      doneBtn.style.cursor = "pointer";

      let isClosed = false;
      let unregisterOverlayBackClose = function () {};

      function closeWith(action) {
        if (isClosed) return;
        isClosed = true;
        unregisterOverlayBackClose();
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(action || null);
      }

      unregisterOverlayBackClose = registerBackClosableOverlay(overlay, function () {
        closeWith(null);
      });

      overlay.addEventListener("click", function (event) {
        if (event.target === overlay) closeWith(null);
      });
      closeBtn.addEventListener("click", function () { closeWith(null); });
      doneBtn.addEventListener("click", function () { closeWith(null); });
      previewSaveBtn.addEventListener("click", async function () {
        previewSaveBtn.disabled = true;
        if (onSave) {
          try {
            const saveResult = await onSave();
            if (!isNativeCapacitorPlatform()) {
              closeWith("saved");
              return;
            }
            const savePath = saveResult && saveResult.relativePath
              ? saveResult.relativePath
              : ("BearMap/" + fileName);
            const nextAction = await showSavedFileOpenDialog({
              filePathText: "Documents/" + savePath
            });
            if (nextAction === "open") {
              const opened = await openSavedFileLink(
                saveResult && saveResult.savedUri ? saveResult.savedUri : (saveResult && saveResult.relativePath ? saveResult.relativePath : null),
                { fileName: fileName, directory: "DOCUMENTS" }
              );
              if (!opened) {
                window.alert("파일을 열지 못했습니다. 파일 관리자에서 직접 열어주세요.\n경로: Documents/" + savePath);
              }
            }
            closeWith("saved");
          } finally {
            previewSaveBtn.disabled = false;
          }
          return;
        }
        previewSaveBtn.disabled = false;
      });
      previewShareBtn.addEventListener("click", async function () {
        if (!onShare) return;
        previewShareBtn.disabled = true;
        try {
          await onShare();
        } catch (shareError) {
          console.warn("XLS 공유 처리 실패:", shareError);
          if (statusEl) {
            statusEl.textContent = "🔴 XLS 공유 실패: " + (shareError && shareError.message ? shareError.message : String(shareError));
          }
          window.alert("XLS 공유에 실패했습니다. 다시 시도해 주세요.");
        } finally {
          previewShareBtn.disabled = false;
        }
      });

      titleWrap.appendChild(title);
      titleWrap.appendChild(subtitle);
      header.appendChild(titleWrap);
      header.appendChild(closeBtn);
      footer.appendChild(previewSaveBtn);
      if (onShare) footer.appendChild(previewShareBtn);
      footer.appendChild(doneBtn);
      card.appendChild(header);
      card.appendChild(body);
      card.appendChild(footer);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    });
  }

  function rememberNativeTileUrl(cacheKey, dataUrl) {
    if (mbtilesNativeTileCache.has(cacheKey)) {
      mbtilesNativeTileCache.delete(cacheKey);
    }
    mbtilesNativeTileCache.set(cacheKey, dataUrl);
    if (mbtilesNativeTileCache.size > NATIVE_MBTILES_TILE_CACHE_LIMIT) {
      const oldestKey = mbtilesNativeTileCache.keys().next().value;
      if (oldestKey !== undefined) {
        mbtilesNativeTileCache.delete(oldestKey);
      }
    }
    return dataUrl;
  }

  function hexToBase64(hexText) {
    if (typeof hexText !== "string" || hexText.length === 0 || hexText.length % 2 !== 0) {
      return null;
    }

    const bytes = new Uint8Array(hexText.length / 2);
    for (let index = 0; index < hexText.length; index += 2) {
      const byteValue = parseInt(hexText.slice(index, index + 2), 16);
      if (!Number.isFinite(byteValue)) return null;
      bytes[index / 2] = byteValue;
    }

    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return window.btoa(binary);
  }

  async function ensureNativeMbtilesDatabase() {
    if (!isNativeCapacitorPlatform()) return false;
    if (mbtilesNativeReady) return true;
    if (mbtilesNativeInitPromise) return mbtilesNativeInitPromise;

    mbtilesNativeInitPromise = (async function () {
      const sqlite = getCapacitorSQLitePlugin();
      if (!sqlite) {
        mbtilesNativeFailureReason = "sqlite-plugin-not-found";
        return false;
      }

      try {
        await sqlite.copyFromAssets({ overwrite: false });
      } catch (copyError) {
        console.info("[MBTiles][native] copyFromAssets skipped:", copyError);
      }

      let dbExists = true;
      try {
        const existsResult = await sqlite.isDBExists({ database: MBTILES_DB_NAME, readonly: true });
        dbExists = !!(existsResult && existsResult.result);
      } catch (existsError) {
        console.warn("[MBTiles][native] isDBExists check skipped:", existsError);
      }

      if (!dbExists) {
        mbtilesNativeFailureReason = "mbtiles-db-not-found";
        if (statusEl) statusEl.textContent = "🟠 MBTiles 앱 자산이 없습니다";
        console.warn("[MBTiles][native] asset DB not found:", MBTILES_DB_NAME);
        return false;
      }

      try {
        await sqlite.createConnection({
          database: MBTILES_DB_NAME,
          version: 1,
          encrypted: false,
          mode: "no-encryption",
          readonly: true
        });
      } catch (connectionError) {
        const message = String(connectionError && connectionError.message ? connectionError.message : connectionError);
        if (!/already exists|Connection .* already exists/i.test(message)) {
          throw connectionError;
        }
      }

      try {
        await sqlite.open({ database: MBTILES_DB_NAME, readonly: true });
      } catch (openError) {
        const message = String(openError && openError.message ? openError.message : openError);
        if (!/already open|already opened|database .* is already open/i.test(message)) {
          throw openError;
        }
      }

      mbtilesNativeReady = true;
      mbtilesNativeFailureReason = null;
      return true;
    })().catch(function (error) {
      mbtilesNativeFailureReason = error && error.message ? error.message : String(error);
      console.error("[MBTiles][native] initialization failed:", error);
      if (statusEl) statusEl.textContent = "🟠 MBTiles 앱 로드 실패";
      return false;
    }).finally(function () {
      mbtilesNativeInitPromise = null;
    });

    return mbtilesNativeInitPromise;
  }

  async function getNativeMbtilesTileDataUrl(z, x, y) {
    const cacheKey = z + "/" + x + "/" + y;
    if (mbtilesNativeTileCache.has(cacheKey)) {
      return rememberNativeTileUrl(cacheKey, mbtilesNativeTileCache.get(cacheKey));
    }

    const ready = await ensureNativeMbtilesDatabase();
    if (!ready) return null;

    const sqlite = getCapacitorSQLitePlugin();
    if (!sqlite) return null;

    const tmsRow = (Math.pow(2, z) - 1) - y;
    const queryResult = await sqlite.query({
      database: MBTILES_DB_NAME,
      statement: "SELECT hex(tile_data) AS tile_hex FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=? LIMIT 1",
      values: [z, x, tmsRow],
      readonly: true
    });

    const firstRow = queryResult && Array.isArray(queryResult.values) ? queryResult.values[0] : null;
    const tileHex = firstRow && typeof firstRow === "object"
      ? (firstRow.tile_hex || firstRow.TILE_HEX || null)
      : (Array.isArray(firstRow) ? firstRow[0] : firstRow);
    if (!tileHex) return null;

    const tileBase64 = hexToBase64(tileHex);
    if (!tileBase64) return null;
    return rememberNativeTileUrl(cacheKey, "data:" + MBTILES_MIME_TYPE + ";base64," + tileBase64);
  }

  function mbtilesTileLoadFn(tile, src) {
    const image = tile.getImage();
    if (!image) return;

    const nativeMatch = /^native-mbtiles:\/\/(\d+)\/(\d+)\/(\d+)$/.exec(src || "");
    if (!nativeMatch) {
      image.src = src;
      return;
    }

    getNativeMbtilesTileDataUrl(
      Number(nativeMatch[1]),
      Number(nativeMatch[2]),
      Number(nativeMatch[3])
    ).then(function (dataUrl) {
      image.src = dataUrl || TRANSPARENT_PIXEL;
    }).catch(function (error) {
      console.error("[MBTiles][native] tile load failed:", error, src, mbtilesNativeFailureReason);
      image.src = TRANSPARENT_PIXEL;
    });
  }

  // 요청 타일이 selection 경계 안에 있을 때만 MBTiles URL을 반환한다.
  function mbtilesUrlFn(tileCoord) {
    if (!tileCoord) return TRANSPARENT_PIXEL;
    const rawZoom = tileCoord[0];
    const z = resolveManifestZoom(rawZoom);
    const x = tileCoord[1];
    const y = normalizeXyzY(tileCoord[2]);
    if (mbtilesSelection) {
      const level = mbtilesSelection.levels[String(z)];
      if (!level) return TRANSPARENT_PIXEL;
      if (x < level.minX || x > level.maxX || y < level.minY || y > level.maxY) return TRANSPARENT_PIXEL;
    }
    if (isNativeCapacitorPlatform()) {
      return "native-mbtiles://" + z + "/" + x + "/" + y;
    }
    return "/mbtiles/" + z + "/" + x + "/" + y + ".tile";
  }

  const mbtilesTileGrid = new ol.tilegrid.TileGrid({
    origin: GRID_ORIGIN,
    resolutions: mbtilesResolutions,
    tileSize: TILE_SIZE,
    minZoom: 0
  });

  const ngiiOnlineTileGrid = new ol.tilegrid.TileGrid({
    origin: GRID_ORIGIN,
    resolutions: ngiiOnlineResolutions,
    tileSize: TILE_SIZE,
    minZoom: 0
  });

  const mbtilesSource = new ol.source.XYZ({
    projection: MAP_PROJECTION_CODE,
    tileGrid: mbtilesTileGrid,
    minZoom: 0,
    maxZoom: MBTILES_MAX_ZOOM,
    wrapX: false,
    transition: 0,
    tilePixelRatio: 1,
    tileUrlFunction: mbtilesUrlFn,
    tileLoadFunction: mbtilesTileLoadFn,
    // attributions: "지리산 오프라인 타일"
  });
  mbtilesSource.on("tileloaderror", function (event) {
    event.tile.getImage().src = TRANSPARENT_PIXEL;
  });

  const mbtilesLayer = new ol.layer.Tile({
    source: mbtilesSource,
    visible: DEFAULT_BASE_LAYER_TYPE === "mbtiles"
  });

  // 내부 TileGrid 줌(0..N)을 NGII WMTS 타일매트릭스 코드(L07..L17)로 맞춘다.
  function toNgiiTileMatrix(rawZoom) {
    const level = Number(rawZoom) + MBTILES_MIN_ZOOM;
    return "L" + String(level).padStart(2, "0");
  }

  // NGII GetTile URL 생성: layerId를 파라미터로 받아 공통으로 사용한다.
  function ngiiTileUrlFnFor(layerId) {
    return function (tileCoord) {
      if (!tileCoord || !NGII_API_KEY) return TRANSPARENT_PIXEL;
      const rawZoom = tileCoord[0];
      const x = tileCoord[1];
      const y = normalizeXyzY(tileCoord[2]);
      return "https://map.ngii.go.kr/openapi/Gettile.do?apikey=" + encodeURIComponent(NGII_API_KEY) +
        "&service=WMTS&request=GetTile&version=1.0.0" +
        "&layer=" + layerId +
        "&style=korean&format=image/png&tilematrixset=korean" +
        "&tilematrix=" + toNgiiTileMatrix(rawZoom) +
        "&tilerow=" + y + "&tilecol=" + x;
    };
  }

  // 기존 NGII 기본도 URL 함수 (korean_map)
  const ngiiBaseTileUrlFn = ngiiTileUrlFnFor(NGII_BASE_LAYER_ID);
  // NGII 위성지도 URL 함수 (satellite_map)
  const ngiiSatelliteTileUrlFn = ngiiTileUrlFnFor("satellite_map");

  // '인터넷 기본도' 라디오에 연결되는 실제 온라인 베이스레이어(NGII).
  const osmBase = new ol.layer.Tile({
    source: new ol.source.XYZ({
      projection: MAP_PROJECTION_CODE,
      tileGrid: ngiiOnlineTileGrid,
      minZoom: 0,
      maxZoom: NGII_ONLINE_MAX_ZOOM,
      wrapX: false,
      transition: 0,
      tilePixelRatio: 1,
      tileUrlFunction: ngiiBaseTileUrlFn
    }),
    visible: DEFAULT_BASE_LAYER_TYPE === "osm"
  });

  // 영문지도 레이어(NGII english_map).
  const englishBase = new ol.layer.Tile({
    source: new ol.source.XYZ({
      projection: MAP_PROJECTION_CODE,
      tileGrid: ngiiOnlineTileGrid,
      minZoom: 0,
      maxZoom: NGII_ONLINE_MAX_ZOOM,
      wrapX: false,
      transition: 0,
      tilePixelRatio: 1,
      tileUrlFunction: ngiiTileUrlFnFor("english_map")
    }),
    visible: false
  });

  // 큰글씨지도 레이어(NGII lowV_map).
  const largeBase = new ol.layer.Tile({
    source: new ol.source.XYZ({
      projection: MAP_PROJECTION_CODE,
      tileGrid: ngiiOnlineTileGrid,
      minZoom: 0,
      maxZoom: NGII_ONLINE_MAX_ZOOM,
      wrapX: false,
      transition: 0,
      tilePixelRatio: 1,
      tileUrlFunction: ngiiTileUrlFnFor("lowV_map")
    }),
    visible: false
  });

  // 위성지도 레이어(NGII satellite_map).
  const satelliteBase = new ol.layer.Tile({
    source: new ol.source.XYZ({
      projection: MAP_PROJECTION_CODE,
      tileGrid: ngiiOnlineTileGrid,
      minZoom: 0,
      maxZoom: NGII_ONLINE_MAX_ZOOM,
      wrapX: false,
      transition: 0,
      tilePixelRatio: 1,
      tileUrlFunction: ngiiSatelliteTileUrlFn
    }),
    visible: false
  });

  const hillshadeOverlay = new ol.layer.Tile({
    source: new ol.source.XYZ({
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
      //attributions: "Hillshade Esri",
      maxZoom: HILLSHADE_MAX_ZOOM
    }),
    opacity: HILLSHADE_BASE_OPACITY,
    visible: false
  });

  let tileLoadSuccessCount = 0;
  let tileLoadErrorCount = 0;

  function bindTileErrorStatus(source, layerName) {
    if (!source || typeof source.on !== "function") return;
    source.on("tileloadend", function () {
      tileLoadSuccessCount += 1;
    });
    source.on("tileloaderror", function () {
      tileLoadErrorCount += 1;
      console.error("Tile load failed:", layerName);
      if (statusEl) {
        statusEl.textContent = "🟠 " + layerName + " 타일 로드 실패 (네트워크 또는 URL 확인)";
      }
    });
  }

  bindTileErrorStatus(osmBase.getSource(), "NGII 인터넷 기본도");
  bindTileErrorStatus(hillshadeOverlay.getSource(), "Hillshade");

  function createHeadingIconDataUri(svgSize, color, circleRadius) {
    const center = svgSize / 2;
    const fillColor = color || "#2b7cff";
    const dotRadius = Number.isFinite(circleRadius) ? circleRadius : 6;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + svgSize + '" height="' + svgSize + '" viewBox="0 0 ' + svgSize + ' ' + svgSize + '">' +
        '<path d="M ' + center + ' 4 L ' + (center + 9) + ' ' + (center - 2) + ' L ' + center + ' ' + (center - 6) + ' L ' + (center - 9) + ' ' + (center - 2) + ' Z" fill="' + fillColor + '"/>' +
        '<circle cx="' + center + '" cy="' + (center + 3) + '" r="' + dotRadius + '" fill="' + fillColor + '"/>' +
      '</svg>';

    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function createMyLocationIconDataUri(svgSize) {
    const c = svgSize / 2;
    const pointY = c + 11;
    const arrow = 'M ' + c + ' 4 L ' + (c + 9) + ' ' + (c - 2) + ' L ' + c + ' ' + (c - 6) + ' L ' + (c - 9) + ' ' + (c - 2) + ' Z';
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + svgSize + '" height="' + svgSize + '" viewBox="0 0 ' + svgSize + ' ' + svgSize + '">' +
      '<defs><filter id="location-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="#0f172a" flood-opacity="0.5"/></filter></defs>' +
      '<g stroke-linejoin="round" filter="url(#location-shadow)">' +
        '<circle cx="' + c + '" cy="' + pointY + '" r="9.5" fill="#ffffff" stroke="#15355d" stroke-width="0.8"/>' +
        '<path d="' + arrow + '" fill="#0e5be9" stroke="#15355d" stroke-width="4.5"/>' +
        '<path d="' + arrow + '" fill="#0e5be9" stroke="#ffffff" stroke-width="2.5"/>' +
        '<circle cx="' + c + '" cy="' + pointY + '" r="6" fill="#0e5be9"/>' +
      '</g>' +
      '</svg>';
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  const myLocationSource = new ol.source.Vector();
  let myLocationFeature = null;
  let editOriginFeature = null;
  let editOriginPulseStartTs = 0;
  let editOriginPulseFrameId = null;
  let editOriginPulseRunning = false;
  let editOriginMoveFrameId = null;
  let observationSaveFlashFrameId = null;
  let observationSaveFlashRunning = false;
  const OBS_SAVE_FLASH_DURATION_MS = 4600;
  const EDIT_ORIGIN_MOVE_DURATION_MS = 520;
  const EDIT_ORIGIN_MOVE_LAG_MS = 110;
  const MY_HEADING_ICON_SIZE = 48;
  const myHeadingIconSrc = createMyLocationIconDataUri(MY_HEADING_ICON_SIZE);
  const OBSERVATION_HEADING_ICON_SIZE = 40;
  const observationHeadingIconSrc = createHeadingIconDataUri(OBSERVATION_HEADING_ICON_SIZE, "#ea580c", 5.5);
  const observationHeadingEditIconSrc = createHeadingIconDataUri(OBSERVATION_HEADING_ICON_SIZE, "#16a34a", 5.5);
  let currentEditingObservationId = null;
  let focusedObservationId = null;
  const MAP_HEADING_HANDLE_LENGTH_PX = 60;
  const MAP_HEADING_HANDLE_RADIUS_PX = 10;

  function setCurrentEditingObservationId(nextId) {
    const normalized = String(nextId == null ? "" : nextId).trim();
    const value = normalized || null;
    if (currentEditingObservationId === value) return;
    currentEditingObservationId = value;
    if (observationMarkerLayer && typeof observationMarkerLayer.changed === "function") {
      observationMarkerLayer.changed();
    }
  }

  // 좌표 드래그 인터랙션 활성 시 스타일에 추가되는 하이라이트 반경 정의
  const COORD_DRAG_HALO_RADIUS_PX = 38;
  const COORD_DRAG_RING_RADIUS_PX = 30;

  function clamp01(value) {
    if (value < 0) return 0;
    if (value > 1) return 1;
    return value;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function stopEditOriginPulseAnimation() {
    editOriginPulseRunning = false;
    if (editOriginPulseFrameId !== null) {
      window.cancelAnimationFrame(editOriginPulseFrameId);
      editOriginPulseFrameId = null;
    }
  }

  function stopEditOriginMoveAnimation() {
    if (editOriginMoveFrameId !== null) {
      window.cancelAnimationFrame(editOriginMoveFrameId);
      editOriginMoveFrameId = null;
    }
  }

  function hasActiveObservationSaveFlash() {
    const now = Date.now();
    const features = observationMarkerSource && typeof observationMarkerSource.getFeatures === "function"
      ? observationMarkerSource.getFeatures()
      : [];
    for (let i = 0; i < features.length; i += 1) {
      const flashUntil = Number(features[i] && features[i].get ? features[i].get("saveFlashUntil") : 0);
      if (Number.isFinite(flashUntil) && flashUntil > now) {
        return true;
      }
    }
    return false;
  }

  function stopObservationSaveFlashAnimation() {
    observationSaveFlashRunning = false;
    if (observationSaveFlashFrameId !== null) {
      window.cancelAnimationFrame(observationSaveFlashFrameId);
      observationSaveFlashFrameId = null;
    }
  }

  function startObservationSaveFlashAnimation() {
    if (observationSaveFlashRunning) return;
    if (!hasActiveObservationSaveFlash()) return;
    observationSaveFlashRunning = true;

    function tick() {
      if (!observationSaveFlashRunning) return;
      if (!hasActiveObservationSaveFlash()) {
        stopObservationSaveFlashAnimation();
        return;
      }
      if (observationMarkerLayer && typeof observationMarkerLayer.changed === "function") {
        observationMarkerLayer.changed();
      }
      observationSaveFlashFrameId = window.requestAnimationFrame(tick);
    }

    observationSaveFlashFrameId = window.requestAnimationFrame(tick);
  }

  // 등록/수정 때 쓰는 기존 플래시 모양을 관측점 이동 강조에도 그대로 재사용한다.
  function triggerObservationSaveFlash(feature, layer, durationMs, preset) {
    if (!feature || typeof feature.set !== "function" || typeof feature.changed !== "function") return;

    const flashDurationMs = Number.isFinite(Number(durationMs)) && Number(durationMs) > 0
      ? Number(durationMs)
      : OBS_SAVE_FLASH_DURATION_MS;
    const flashUntil = Date.now() + flashDurationMs;
    feature.set("saveFlashUntil", flashUntil);
    feature.set("saveFlashDurationMs", flashDurationMs);
    feature.set("saveFlashPreset", preset || "default");

    if (layer && typeof layer.changed === "function") {
      layer.changed();
    }

    const tick = function () {
      if (!feature || typeof feature.changed !== "function") return;
      if (Date.now() >= flashUntil) {
        feature.changed();
        return;
      }
      feature.changed();
      window.requestAnimationFrame(tick);
    };

    window.requestAnimationFrame(tick);
  }

  // obsList.js에서 관측점 이동 강조를 호출할 수 있도록 전역으로 노출한다.
  window.__bpTriggerObservationSaveFlash = triggerObservationSaveFlash;

  function animateEditOriginTo(targetCoord) {
    if (!editOriginFeature || !Array.isArray(targetCoord)) return;
    const geometry = editOriginFeature.getGeometry();
    const startCoord = geometry && geometry.getCoordinates ? geometry.getCoordinates() : null;

    if (!Array.isArray(startCoord)) {
      editOriginFeature.setGeometry(new ol.geom.Point(targetCoord));
      editOriginFeature.changed();
      return;
    }

    const dx = targetCoord[0] - startCoord[0];
    const dy = targetCoord[1] - startCoord[1];
    if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) {
      editOriginFeature.setGeometry(new ol.geom.Point(targetCoord));
      editOriginFeature.changed();
      return;
    }

    stopEditOriginMoveAnimation();
    const startedAt = Date.now();

    function tick() {
      if (!editOriginFeature) {
        stopEditOriginMoveAnimation();
        return;
      }

      const elapsed = Date.now() - startedAt - EDIT_ORIGIN_MOVE_LAG_MS;
      if (elapsed < 0) {
        editOriginMoveFrameId = window.requestAnimationFrame(tick);
        return;
      }
      const progress = clamp01(elapsed / EDIT_ORIGIN_MOVE_DURATION_MS);
      const eased = progress < 0.5
        ? 4 * progress * progress * progress
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      const currentCoord = [
        lerp(startCoord[0], targetCoord[0], eased),
        lerp(startCoord[1], targetCoord[1], eased)
      ];

      editOriginFeature.setGeometry(new ol.geom.Point(currentCoord));
      editOriginFeature.changed();

      if (progress >= 1) {
        stopEditOriginMoveAnimation();
        return;
      }

      editOriginMoveFrameId = window.requestAnimationFrame(tick);
    }

    editOriginMoveFrameId = window.requestAnimationFrame(tick);
  }

  function startEditOriginPulseAnimation() {
    if (editOriginPulseRunning) return;
    editOriginPulseRunning = true;
    if (!editOriginPulseStartTs) editOriginPulseStartTs = Date.now();

    function tick() {
      if (!editOriginPulseRunning) return;
      if (!editOriginFeature) {
        stopEditOriginPulseAnimation();
        return;
      }
      myLocationLayer.changed();
      editOriginPulseFrameId = window.requestAnimationFrame(tick);
    }

    editOriginPulseFrameId = window.requestAnimationFrame(tick);
  }

  function getHeadingHandleCoordinate(centerCoord, headingDeg) {
    const resolution = Number(view && view.getResolution && view.getResolution()) || 1;
    const lengthMapUnits = MAP_HEADING_HANDLE_LENGTH_PX * resolution;
    const headingRad = (headingDeg * Math.PI) / 180;
    return [
      centerCoord[0] + Math.sin(headingRad) * lengthMapUnits,
      centerCoord[1] + Math.cos(headingRad) * lengthMapUnits
    ];
  }

  const myLocationLayer = new ol.layer.Vector({
    source: myLocationSource,
    zIndex: 1000,
    style: function (feature) {
      const markerKind = feature ? feature.get("markerKind") : "";
      const centerCoord = feature && feature.getGeometry() ? feature.getGeometry().getCoordinates() : null;

      if (markerKind === "edit-origin" && Array.isArray(centerCoord)) {
        const elapsed = Date.now() - (editOriginPulseStartTs || Date.now());
        const introProgress = clamp01(elapsed / 450);
        const introEase = 1 - Math.pow(1 - introProgress, 3);
        const phase = ((elapsed % 1800) / 1800) * Math.PI * 2;
        const ease = (1 - Math.cos(phase)) / 2;
        const pulseGain = 0.35 + introEase * 0.65;
        const outerRadius = lerp(10, 18, introEase) + ease * (10 * pulseGain);
        const innerRadius = lerp(7, 13, introEase) + ease * (6 * pulseGain);
        const outerAlpha = lerp(0.00, 0.26, introEase) - ease * (0.16 * pulseGain);
        const innerAlpha = lerp(0.00, 0.18, introEase) - ease * (0.12 * pulseGain);

        return [
          new ol.style.Style({
            image: new ol.style.Circle({
              radius: outerRadius,
              fill: new ol.style.Fill({ color: "rgba(34,197,94," + outerAlpha.toFixed(3) + ")" }),
              stroke: new ol.style.Stroke({ color: "rgba(22,163,74,0.92)", width: lerp(1.2, 2.6, introEase) })
            })
          }),
          new ol.style.Style({
            image: new ol.style.Circle({
              radius: innerRadius,
              fill: new ol.style.Fill({ color: "rgba(74,222,128," + innerAlpha.toFixed(3) + ")" }),
              stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.86)", width: lerp(1.0, 1.8, introEase) })
            })
          })
        ];
      }

      const headingDeg = feature ? feature.get("headingDeg") : null;
      const rotation = Number.isFinite(headingDeg) ? (headingDeg * Math.PI) / 180 : 0;
      const showHeadingHandle = !!(feature && feature.get("showHeadingHandle"));
      const styles = [];

      if (showHeadingHandle && Number.isFinite(headingDeg) && Array.isArray(centerCoord)) {
        const handleCoord = getHeadingHandleCoordinate(centerCoord, headingDeg);

        styles.push(new ol.style.Style({
          geometry: new ol.geom.LineString([centerCoord, handleCoord]),
          stroke: new ol.style.Stroke({
            color: "rgba(37,99,235,0.95)",
            width: 5,
            lineCap: "round"
          })
        }));

        styles.push(new ol.style.Style({
          geometry: new ol.geom.Point(handleCoord),
          image: new ol.style.Circle({
            radius: MAP_HEADING_HANDLE_RADIUS_PX,
            fill: new ol.style.Fill({ color: "rgba(255,255,255,0.97)" }),
            stroke: new ol.style.Stroke({ color: "rgba(37,99,235,0.98)", width: 3 })
          })
        }));
      }

      if (feature && feature.get("isCoordinateDragActive") && Array.isArray(centerCoord)) {
        styles.push(new ol.style.Style({
          geometry: new ol.geom.Point(centerCoord),
          image: new ol.style.Circle({
            radius: COORD_DRAG_HALO_RADIUS_PX,
            fill: new ol.style.Fill({ color: "rgba(251,191,36,0.18)" }),
            stroke: new ol.style.Stroke({ color: "rgba(245,158,11,0.76)", width: 3 })
          })
        }));

        styles.push(new ol.style.Style({
          geometry: new ol.geom.Point(centerCoord),
          image: new ol.style.Circle({
            radius: COORD_DRAG_RING_RADIUS_PX,
            fill: new ol.style.Fill({ color: "rgba(37,99,235,0.16)" }),
            stroke: new ol.style.Stroke({ color: "rgba(37,99,235,0.98)", width: 4 })
          })
        }));

      }

      styles.push(new ol.style.Style({
        image: new ol.style.Icon({
          src: myHeadingIconSrc,
          width: MY_HEADING_ICON_SIZE,
          height: MY_HEADING_ICON_SIZE,
          anchor: [0.5, (MY_HEADING_ICON_SIZE / 2 + 11) / MY_HEADING_ICON_SIZE],
          anchorXUnits: "fraction",
          anchorYUnits: "fraction",
          rotateWithView: true,
          rotation: rotation
        })
      }));

      return styles;
    }
  });

  const bearMarkerSource = new ol.source.Vector();
  const bearMarkerLayer = new ol.layer.Vector({ source: bearMarkerSource });
  let bearMarkerAnimationFrameId = 0;
  let bearMarkerAnimationRunning = false;
  let bearMarkerAnimationStartTs = 0;
  let realtimeBearMarkerPulse = 0;
  let realtimeBearMarkerScale = 1;

  function stopBearMarkerAnimation() {
    bearMarkerAnimationRunning = false;
    bearMarkerAnimationStartTs = 0;
    realtimeBearMarkerPulse = 0;
    realtimeBearMarkerScale = 1;
    if (bearMarkerAnimationFrameId) {
      window.cancelAnimationFrame(bearMarkerAnimationFrameId);
      bearMarkerAnimationFrameId = 0;
    }
    bearMarkerLayer.changed();
  }

  function animateBearMarkers(timestamp) {
    if (!bearMarkerAnimationRunning) return;
    if (!bearMarkerAnimationStartTs) bearMarkerAnimationStartTs = timestamp;

    const elapsedSec = (timestamp - bearMarkerAnimationStartTs) / 1000;
    realtimeBearMarkerPulse = (Math.sin(elapsedSec * Math.PI * 1.9) + 1) / 2;
    realtimeBearMarkerScale = 1 + Math.sin(elapsedSec * Math.PI * 2.2) * 0.035;

    bearMarkerLayer.changed();
    bearMarkerAnimationFrameId = window.requestAnimationFrame(animateBearMarkers);
  }

  function startBearMarkerAnimation() {
    if (bearMarkerAnimationRunning) return;
    bearMarkerAnimationRunning = true;
    bearMarkerAnimationStartTs = 0;
    bearMarkerAnimationFrameId = window.requestAnimationFrame(animateBearMarkers);
  }

  const analysisPreviewSource = new ol.source.Vector();
  let previewDashOffset = 0;
  let previewArrowPulse = 0;
  let previewRayAnimationActive = false;
  const analysisPreviewLayer = new ol.layer.Vector({
    source: analysisPreviewSource,
    style: function (feature) {
      const kind = feature ? feature.get("kind") : "";

      if (kind === "preview-radius") {
        return new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: "rgba(37,99,235,0.68)",
            width: 2,
            lineDash: [7, 8]
          }),
          fill: new ol.style.Fill({ color: "rgba(37,99,235,0.07)" })
        });
      }

      if (kind === "preview-ray") {
        return new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: "rgba(37,99,235,0.84)",
            width: 2.4,
            lineDash: [10, 10],
            lineDashOffset: previewDashOffset,
            lineCap: "round"
          })
        });
      }

      if (kind === "preview-arrow") {
        const angleRad = Number(feature.get("angleRad")) || 0;
        return new ol.style.Style({
          image: new ol.style.RegularShape({
            points: 3,
            radius: 7 + previewArrowPulse * 1.8,
            rotation: angleRad,
            fill: new ol.style.Fill({ color: "rgba(37,99,235,0.96)" }),
            stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.96)", width: 1.4 })
          })
        });
      }

      if (kind === "preview-intersection") {
        return new ol.style.Style({
          image: new ol.style.Circle({
            radius: 8,
            fill: new ol.style.Fill({ color: "rgba(34,197,94,0.96)" }),
            stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.96)", width: 2 })
          })
        });
      }

      return null;
    }
  });

  const analysisGuideSource = new ol.source.Vector();
  let analysisDashOffset = 0;
  let analysisPulseStrength = 0;
  let analysisAnimationStartTs = 0;
  let analysisAnimationFrameId = null;
  let analysisAnimationRunning = false;
  let analysisActionBarEl = null;
  let analysisActionOverlay = null;
  let analysisOwnerInputEl = null;
  let analysisTeamInputEl = null;
  let analysisPlaceInputEl = null;
  let analysisRegionField = null;
  let analysisRealtimeShareInputEl = null;
  let currentAnalysisPoint = null; // 위치분석 최근 결과 (저장 버튼용)
  let analysisActionAnchorCoord = null;
  let analysisActionLayoutBound = false;
  let analysisActionLayoutRafId = null;
  let analysisActionObsSheetObserver = null;

  function normalizeOwnerName(value) {
    return String(value == null ? "" : value).trim();
  }

  function normalizePlaceName(value) {
    return String(value == null ? "" : value).trim();
  }

  function buildUniqueOwnerList(values) {
    const seen = new Set();
    return (Array.isArray(values) ? values : []).reduce(function (result, value) {
      const owner = normalizeOwnerName(value);
      if (!owner || seen.has(owner)) return result;
      seen.add(owner);
      result.push(owner);
      return result;
    }, []);
  }

  function resolveDefaultAnalysisOwner(point) {
    return window.BearAppSettings?.getProfile()?.owner || "";
  }

  function syncAnalysisOwnerInput(point) {
    if (!analysisOwnerInputEl) return;
    analysisOwnerInputEl.value = resolveDefaultAnalysisOwner(point);
    const profile = window.BearAppSettings?.getProfile();
    const team = (window.BearAppSettings?.store?.snapshot()?.items || []).find(item => item.id === profile?.team_id);
    if (analysisTeamInputEl) {
      analysisTeamInputEl.value = team?.name || profile?.team_name || "";
      const badge = analysisTeamInputEl.closest(".obs-reg-team-badge");
      const color = team?.color || profile?.team_color;
      const hex = /^#[0-9A-Fa-f]{6}$/.test(color || "") ? color : "#7E90A2";
      badge.style.setProperty("--team-color", hex);
      badge.style.setProperty("--team-background", hex + "18");
      badge.style.setProperty("--team-border", hex + "55");
    }
    resizeAnalysisOwner();
  }
  function resizeAnalysisOwner() {
    if (!analysisOwnerInputEl || !analysisOwnerInputEl.getClientRects().length) return;
    analysisOwnerInputEl.style.height = "auto";
    analysisOwnerInputEl.style.height = Math.max(22, analysisOwnerInputEl.scrollHeight) + "px";
  }
  window.addEventListener("bearpoint:profile-changed", () => syncAnalysisOwnerInput(currentAnalysisPoint));
  window.addEventListener("bearpoint:teams-changed", () => syncAnalysisOwnerInput(currentAnalysisPoint));
  window.addEventListener("resize", resizeAnalysisOwner);

  function resolveDefaultAnalysisPlace(point) {
    return "";
  }

  function syncAnalysisPlaceInput(point) {
    if (!analysisPlaceInputEl) return;
    analysisPlaceInputEl.value = resolveDefaultAnalysisPlace(point);
  }

  // 십진수 위경도를 도분초(DMS) 문자열로 변환한다.
  function decimalToDMS(deg, isLng) {
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const minFloat = (abs - d) * 60;
    const m = Math.floor(minFloat);
    const s = ((minFloat - m) * 60).toFixed(1);
    const dir = isLng ? (deg >= 0 ? "E" : "W") : (deg >= 0 ? "N" : "S");
    return d + "\u00b0" + m + "'" + s + '"' + dir;
  }

  // SQLite 저장용 한국시간(KST) ISO 문자열을 생성한다. (YYYY-MM-DDTHH:mm:ss+09:00)
  function getKstSqliteTimestamp() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).formatToParts(new Date());

    const map = {};
    parts.forEach(function (p) {
      if (p && p.type && p.type !== "literal") map[p.type] = p.value;
    });

    return [map.year, map.month, map.day].join("-") + "T" + [map.hour, map.minute, map.second].join(":") + "+09:00";
  }

  function parseSavedDateTime(value) {
    if (!value) return "-";

    let parsed = null;
    if (typeof value === "number") {
      parsed = new Date(value);
    } else {
      const text = String(value).trim();
      if (!text) return "-";

      // 신형: ISO 문자열(+09:00, Z 포함) 저장
      if (/T.*([zZ]|[+-]\d{2}:\d{2})$/.test(text)) {
        parsed = new Date(text);
      } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
        // 구형: SQLite datetime('now') 텍스트는 UTC 기준으로 저장된 이력이라 Z를 붙여 보정한다.
        parsed = new Date(text.replace(" ", "T") + "Z");
      } else {
        parsed = new Date(text);
      }
    }

    if (!(parsed instanceof Date) || !Number.isFinite(parsed.getTime())) return null;
    return parsed;
  }

  // 저장 시각 문자열을 한국시간으로 안전하게 표시한다.
  function formatKstTimeLabel(value) {
    if (!value) return "-";
    const parsed = parseSavedDateTime(value);
    if (!parsed) return "-";

    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }).format(parsed);
  }

  // 목록용 날짜 라벨(YYYY-MM-DD)
  function formatKstDateLabel(value) {
    if (!value) return "-";
    const parsed = parseSavedDateTime(value);
    if (!parsed) return "-";

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(parsed);

    const map = {};
    parts.forEach(function (p) {
      if (p && p.type && p.type !== "literal") map[p.type] = p.value;
    });

    if (!map.year || !map.month || !map.day) return "-";
    return [map.year, map.month, map.day].join("-");
  }

  // 파일 출력용 날짜/시간 라벨(YYYY-MM-DD HH:mm:ss)
  function formatKstDateTimeLabel(value) {
    if (!value) return "-";
    const parsed = parseSavedDateTime(value);
    if (!parsed) return "-";

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).formatToParts(parsed);

    const map = {};
    parts.forEach(function (p) {
      if (p && p.type && p.type !== "literal") map[p.type] = p.value;
    });

    if (!map.year || !map.month || !map.day || !map.hour || !map.minute || !map.second) return "-";
    return [map.year, map.month, map.day].join("-") + " " + [map.hour, map.minute, map.second].join(":");
  }

  // 팝업 HTML에 삽입할 텍스트를 이스케이프해 XSS와 마크업 깨짐을 방지한다.
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // 팝업 표시용 위경도를 소수점 7자리 고정 문자열로 변환한다.
  function formatPopupCoordinate(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(7) : "-";
  }

  // 곰 추정위치 마커/분석 결과 마커에 공통으로 사용하는 상세 팝업 카드 HTML을 만든다.
  function buildBearEstimatePopupHtml(item) {
    const lat = Number(item && item.lat);
    const lng = Number(item && item.lng);
    const placeName = normalizePlaceName(item && item.place) || "미지정";
    const ownerName = normalizeOwnerName(item && item.owner) || "미지정";
    const teamName = String(item && item.team_name || "팀 미지정");
    const rawTeamColor = item && item.team_color;
    const teamColor = /^#[0-9A-Fa-f]{6}$/.test(rawTeamColor || "") ? rawTeamColor : "#7E90A2";
    const bearCode = String(item && (item.bear_code || item.bearCode || item.id || "-"));
    const latDms = item && item.lat_dms ? item.lat_dms : (Number.isFinite(lat) ? decimalToDMS(lat, false) : "-");
    const lngDms = item && item.lng_dms ? item.lng_dms : (Number.isFinite(lng) ? decimalToDMS(lng, true) : "-");
    const tmCoord = (Number.isFinite(lat) && Number.isFinite(lng)) ? legacyTmCoordFromWgs84(lat, lng) : null;
    const mapX = Array.isArray(tmCoord) && Number.isFinite(tmCoord[0]) ? tmCoord[0].toFixed(3) : "-";
    const mapY = Array.isArray(tmCoord) && Number.isFinite(tmCoord[1]) ? tmCoord[1].toFixed(3) : "-";
    const createdAt = formatKstDateTimeLabel(item && (item.created_at || item.createdAt || item.ts));

    const row = (label, value, mono = false) => {
      const text = escapeHtml(value == null || value === "" ? "-" : value);
      return `<tr><th scope="row">${label}</th><td><span class="obs-detail-value${mono ? ' obs-detail-value--mono' : ''}" title="${text}">${text}</span></td></tr>`;
    };
    const unsaved = !!(item && item._unsaved);
    return `
      <div class="obs-popup-card obs-popup-card--estimate">
        <div class="obs-popup-card__eyebrow">${escapeHtml(bearCode)}</div>
        <div class="obs-detail-frame">
          <table class="obs-detail-table" aria-label="개체 추적위치 상세 정보"><tbody>
            ${row("지명", placeName)}
            <tr><th scope="row">추정 방식</th><td>${buildEstimationMethodHtml(item)}</td></tr>
            <tr><th scope="row">등록자</th><td><div class="obs-detail-registrar"><span class="obs-detail-registrar-name">${escapeHtml(ownerName)}</span><span class="obs-detail-team-badge" title="${escapeHtml(teamName)}" aria-label="소속 팀 ${escapeHtml(teamName)}" style="--team-color:${teamColor};--team-background:${teamColor}18;--team-border:${teamColor}55"><i aria-hidden="true"></i><span>${escapeHtml(teamName)}</span></span></div></td></tr>
            ${row("위치", item && (item.admin_region || item.adminRegion) || "미지정")}
          </tbody></table>
        </div>
        <details class="obs-detail-more">
          <summary>좌표·등록정보</summary>
          <div class="obs-detail-frame">
            <table class="obs-detail-table" aria-label="추가 좌표 및 등록정보"><tbody>
              ${row("위경도", `${formatPopupCoordinate(lat)}, ${formatPopupCoordinate(lng)}`, true)}
              ${row("도분초", `${latDms}, ${lngDms}`, true)}
              ${row("TM 좌표", `X ${mapX}, Y ${mapY}`, true)}
              ${row("등록시간", createdAt)}
            </tbody></table>
          </div>
        </details>
        <div class="obs-popup-card__actions">
          <button type="button" class="obs-popup-card__action-btn obs-popup-card__action-btn--file" data-bear-action="txt">TXT</button>
          ${!unsaved ? '<button type="button" class="obs-popup-card__action-btn obs-popup-card__action-btn--xls" data-bear-action="xls">XLS</button>' : ''}
        </div>
      </div>
    `;
  }

  const analysisGuideLayer = new ol.layer.Vector({
    source: analysisGuideSource,
    style: function (feature) {
      const kind = feature ? feature.get("kind") : "";
      if (kind === "ray") {
        return new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: "rgba(220,38,38,0.92)",
            width: 3,
            lineDash: [14, 10],
            lineDashOffset: analysisDashOffset,
            lineCap: "round"
          })
        });
      }

      if (kind === "pulse") {
        const pulseRadius = 16 + analysisPulseStrength * 8;
        const pulseOpacity = 0.5 - analysisPulseStrength * 0.28;
        return [
          new ol.style.Style({
            image: new ol.style.Circle({
              radius: pulseRadius,
              fill: new ol.style.Fill({ color: `rgba(239,68,68,${Math.max(0.08, pulseOpacity).toFixed(3)})` }),
              stroke: new ol.style.Stroke({ color: "rgba(220,38,38,0.95)", width: 2 })
            })
          }),
          new ol.style.Style({
            image: new ol.style.Circle({
              radius: 6,
              fill: new ol.style.Fill({ color: "rgba(255,255,255,0.96)" }),
              stroke: new ol.style.Stroke({ color: "rgba(220,38,38,1)", width: 2 })
            })
          })
        ];
      }

      return null;
    }
  });

  const analysisEstimateSource = new ol.source.Vector();
  const analysisEstimateLayer = new ol.layer.Vector({ source: analysisEstimateSource });
  // 거리 측정 전용 레이어: 시작점/끝점/선/거리라벨을 여기서만 관리한다.
  const measureSource = new ol.source.Vector();
  const measureLayer = new ol.layer.Vector({
    source: measureSource,
    style: function (feature) {
      const kind = feature ? feature.get("kind") : "";

      if (kind === "measure-line" || kind === "measure-line-preview") {
        const isPreview = kind === "measure-line-preview";
        return new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: isPreview ? "rgba(239,68,68,0.85)" : "rgba(239,68,68,0.96)",
            width: 3,
            lineDash: isPreview ? [8, 6] : undefined,
            lineCap: "round"
          })
        });
      }

      if (kind === "measure-area-line" || kind === "measure-area-line-preview") {
        const isPreview = kind === "measure-area-line-preview";
        return new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: isPreview ? "rgba(6,182,212,0.82)" : "rgba(6,182,212,0.96)",
            width: 3,
            lineDash: isPreview ? [8, 6] : undefined,
            lineCap: "round"
          })
        });
      }

      if (kind === "measure-point-start" || kind === "measure-point-end") {
        const isStart = kind === "measure-point-start";
        return new ol.style.Style({
          image: new ol.style.Circle({
            radius: 6,
            fill: new ol.style.Fill({ color: isStart ? "rgba(14,165,233,0.95)" : "rgba(239,68,68,0.95)" }),
            stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.96)", width: 2 })
          })
        });
      }

      if (kind === "measure-area-fill" || kind === "measure-area-fill-preview") {
        const isPreview = kind === "measure-area-fill-preview";
        return new ol.style.Style({
          fill: new ol.style.Fill({ color: isPreview ? "rgba(6,182,212,0.2)" : "rgba(6,182,212,0.3)" })
        });
      }

      return null;
    }
  });

  const observationMarkerSource = new ol.source.Vector();

  const baseCenterMap = mapCoordFromWgs84(35.315, 127.655);
  //const extentMap = ol.proj.transformExtent(JIRISAN_BOUNDS_WGS84, WGS84_CODE, MAP_PROJECTION_CODE);
  const extentMap = [991351,1650474,1033184,1742203];
  const viewResolutions = build5179ViewResolutions(
    MBTILES_MIN_ZOOM,
    ONLINE_MAX_ZOOM,
    mbtilesResolutions[0]
  );

  const view = new ol.View({
    projection: MAP_PROJECTION_CODE,
    center: baseCenterMap,
    minZoom: MBTILES_MIN_ZOOM,
    maxZoom: ONLINE_MAX_ZOOM,
    resolutions: viewResolutions,
    // 기본 정북 붙임(±5°)은 방향 모드에서도 걸려 북쪽 근처가 달라붙으므로 끄고, 아래 moveend에서 방향 모드가 아닐 때만 직접 붙인다.
    constrainRotation: false,
    //extent: LOCK_EMPTY_AREA_PAN ? PAN_LIMIT_EXTENT : undefined // 이 한 줄을 주석 처리하면 빈공간 이동 제한 해제
  });

  //맵 기능
  const map = new ol.Map({
    target: "map",
    // 지도 타일은 256px 이미지라 배율 3으로 그려도 더 선명해지지 않는다. 2로 제한해 회전·이동 때 그리는 양을 줄인다.
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    layers: [osmBase, englishBase, largeBase, satelliteBase, mbtilesLayer, hillshadeOverlay, bearMarkerLayer, analysisPreviewLayer, analysisGuideLayer, analysisEstimateLayer, measureLayer, myLocationLayer],
    view: view,
    // 두 손가락 회전은 확실히 30° 이상 비틀었을 때만 시작한다(winter_crop_app의 20°보다 둔하게). 확대·축소 중 손가락이 조금 돌아가는 건 무시.
    interactions: ol.interaction.defaults.defaults({
      pinchRotate: false,
      altShiftDragRotate: true
    }).extend([new ol.interaction.PinchRotate({ threshold: PINCH_ROTATE_THRESHOLD_DEG * Math.PI / 180 })]),
    controls: ol.control.defaults.defaults({
      zoom: false,
      rotate: false,
      attribution: true
    })
  });

  window.__olMap = map;
  window.__olView = view;

  // 태블릿 가로 사이드바 진입/이탈 시 맵 크기 재계산
  (function () {
    var _sidebarMq = window.matchMedia(
      "(min-width: 900px) and (orientation: landscape)"
    );
    function _onSidebarMqChange() {
      // CSS transition 완료 후 updateSize (약 80ms 여유)
      setTimeout(function () {
        if (window.__olMap) window.__olMap.updateSize();
      }, 80);
    }
    if (_sidebarMq.addEventListener) {
      _sidebarMq.addEventListener("change", _onSidebarMqChange);
    } else if (_sidebarMq.addListener) {
      _sidebarMq.addListener(_onSidebarMqChange);
    }
    // 초기 진입 시도 적용
    _onSidebarMqChange();
  })();

  const gpsTrackUi = window.createGpsTrackUi({ ol, map, project: mapCoordFromWgs84, insertBefore: bearMarkerLayer });
  window.BearGpsTrackUi = gpsTrackUi;
  const controlsManager = window.createOlMapControlsManager ? window.createOlMapControlsManager({
    ol: ol,
    map: map,
    mapEl: mapEl,
    view: view,
    statusEl: statusEl,
    wgs84FromMapCoord: wgs84FromMapCoord,
    extentMap: extentMap,
    offlineInitialCenterLatLng: [35.32634, 127.63770],
    mbtilesExtentMap: mbtilesExtentMap,
    ngiiApiKey: NGII_API_KEY,
    mbtilesMinZoom: MBTILES_MIN_ZOOM,
    mbtilesMaxZoom: MBTILES_MAX_ZOOM,
    onlineMaxZoom: ONLINE_MAX_ZOOM,
    offlineInitialZoom: OFFLINE_INITIAL_ZOOM,
    hillshadeBaseOpacity: HILLSHADE_BASE_OPACITY,
    hillshadeSafeMaxZoom: HILLSHADE_SAFE_MAX_ZOOM,
    initialBaseLayerType: DEFAULT_BASE_LAYER_TYPE,
    layers: {
      osmBase: osmBase,
      englishBase: englishBase,
      largeBase: largeBase,
      satelliteBase: satelliteBase,
      mbtilesLayer: mbtilesLayer,
      hillshadeOverlay: hillshadeOverlay
    },
    measureSource: measureSource,
    onToggleMyLocation: cycleMyLocation,
    onCompassClick: function () {
      if (trackMode === "heading") {
        setTrackMode("follow");
        return;
      }
      view.cancelAnimations();
      view.animate({ rotation: 0, duration: 300 });
    },
    onStopFollowing: stopFollowing,
    onMeasureActivated: function () {
      window.BearMobileDock?.collapse();
      stopManualMapGesture();
      clearAnalysisEstimateVisuals();
      closeObservationPopup();
      if (isCompactPhoneMeasureLayout() && obsListModule && typeof obsListModule.deactivate === "function") {
        obsListModule.deactivate();
      }
      if (isCompactPhoneMeasureLayout() && obsListModule && typeof obsListModule.deactivate === "function") {
        obsListModule.deactivate();
      }
      if (obsRegisterModule) {
        obsRegisterModule.hide(true);
      }
      clearManualRegistrationPreview();
      if (statusEl) {
        statusEl.textContent = "📏 측정 모드 활성화 (등록/수정 기능 일시 종료)";
      }
    },
    onLocateButtonReady: function (buttonEl) {
      locateBtnEl = buttonEl || null;
    }
  }) : null;

  if (controlsManager && typeof controlsManager.initialize === "function") {
    controlsManager.initialize();
  }

  // 한 손가락으로 끌면 따라가기를 멈춘다. 두 손가락 확대는 따라가기를 유지하고, 방향 모드에서 손으로 돌리면 북쪽 고정 따라가기로 바뀐다.
  function stopFollowingOnDrag(event) {
    if (trackMode !== "follow" && trackMode !== "heading") return;
    const pointers = Array.isArray(event.activePointers) ? event.activePointers.length : 1;
    if (pointers > 1) {
      if (trackMode === "heading") setTrackMode("follow", false);
      return;
    }
    setTrackMode("on", false);
  }
  map.on("pointerdrag", stopFollowingOnDrag);

  // 손으로 돌리다 정북 ±5° 안에서 멈추면 0°로 맞춘다(OpenLayers 기본 동작과 같음). 방향 모드에서는 바라보는 방향 그대로 둔다.
  const NORTH_SNAP_DEG = 5;
  map.on("moveend", function () {
    if (trackMode === "heading") return;
    const deg = Math.abs(angleDelta(-view.getRotation() * 180 / Math.PI, 0));
    // moveend는 그리는 도중에 오므로 애니메이션은 다음 프레임에 시작해야 실제로 진행된다.
    if (deg > 0 && deg < NORTH_SNAP_DEG) window.requestAnimationFrame(function () {
      if (trackMode !== "heading" && !view.getInteracting()) view.animate({ rotation: 0, duration: 150 });
    });
  });

  if (isNativeCapacitorPlatform()) {
    ensureNativeMbtilesDatabase();
  }

  // 초기 위치: fit() 호출 (한 번만 실행)
  if (controlsManager && typeof controlsManager.moveToOfflineInitialView === "function") {
    controlsManager.moveToOfflineInitialView();
  }
  window.__initialFitDone = true;

  // 디버깅용: 현재 줌/중심/extent를 콘솔에 기록한다.
  function logViewState(reason) {
    const zoom = view.getZoom();
    const center = view.getCenter();
    const size = map.getSize();
    const extent = size ? view.calculateExtent(size) : null;
    const centerWgs84 = wgs84FromMapCoord(center);
    const zoomText = Number.isFinite(zoom) ? zoom.toFixed(2) : String(zoom);
    const latText = centerWgs84 && Number.isFinite(centerWgs84.lat) ? centerWgs84.lat.toFixed(6) : "n/a";
    const lngText = centerWgs84 && Number.isFinite(centerWgs84.lng) ? centerWgs84.lng.toFixed(6) : "n/a";
    const extentText = extent ? "[" + extent.map(v => v.toFixed(0)).join(",") + "]" : "n/a";
    console.log("[Map] " + reason + " | zoom=" + zoomText + " | lat=" + latText + " lng=" + lngText + " | extent=" + extentText);
  }

  map.on("moveend", function () {
    logViewState("moveend");
  });

  // 내부 SQLite 초기화. 실패해도 지도 기능은 계속 동작하도록 설계한다.
  async function initializeEmbeddedDatabase() {
    // sqlite-init.js가 로드되지 않았더라도 지도 기능은 계속 동작하도록 한다.
    if (!window.BearSQLite || typeof window.BearSQLite.initialize !== "function") {
      return { ready: false, reason: "sqlite-module-not-loaded" };
    }

    const result = await window.BearSQLite.initialize();

    if (result && result.reason === "db-not-found") {
      console.info("[SQLite] DB file not found. Place BearPointData.db under public/assets/databases.");
    }

    if (result && result.ready) {
      console.info("[SQLite] internal database connection is ready.");
    }

    return result;
  }

  function flyToLatLng(latlng, zoom, onComplete) {
    if (!Array.isArray(latlng) || latlng.length < 2) return;
    stopFollowing();
    const target = mapCoordFromWgs84(latlng[0], latlng[1]);
    const animation = {
      center: target,
      zoom: typeof zoom === "number" ? zoom : (view.getZoom() || 11),
      duration: 700
    };
    if (typeof onComplete === "function") {
      view.animate(animation, onComplete);
    } else {
      view.animate(animation);
    }
  }

  // latlngList: [{lat, lng}, ...] 배열을 모두 포함하는 extent로 fit
  function fitToPoints(latlngList, options) {
    if (!latlngList || latlngList.length === 0) return;
    const opts = options || {};
    const padding = opts.padding !== undefined ? opts.padding : 80;
    const maxZoom = opts.maxZoom !== undefined ? opts.maxZoom : 17;

    if (latlngList.length === 1) {
      flyToLatLng([latlngList[0].lat, latlngList[0].lng], 15);
      return;
    }

    const coords = latlngList.map(function (p) { return mapCoordFromWgs84(p.lat, p.lng); });
    const xs = coords.map(function (c) { return c[0]; });
    const ys = coords.map(function (c) { return c[1]; });
    const extent = [Math.min.apply(null, xs), Math.min.apply(null, ys),
                    Math.max.apply(null, xs), Math.max.apply(null, ys)];
    stopFollowing();

    view.fit(extent, {
      padding: [padding, padding, padding, padding],
      maxZoom: maxZoom,
      duration: 700
    });
  }

  function updateRegistrationPreview() {
    const baseLatLng = lastLatLng || [35.326459, 127.637712];
    const previewHeading = Math.round(lastHeadingDeg !== null ? lastHeadingDeg : 0) + "°";

    if (currentCoordEl) {
      currentCoordEl.textContent = baseLatLng[0].toFixed(6) + ", " + baseLatLng[1].toFixed(6);
    }
    if (currentHeadingEl) {
      currentHeadingEl.textContent = previewHeading;
    }
  }

  function clearManualRegistrationPreview() {
    if (isMyVisible) {
      const fallbackLatLng = lastTrackedLatLng || [35.326459, 127.637712];
      const fallbackHeading = Number.isFinite(lastTrackedHeadingDeg) ? lastTrackedHeadingDeg : 0;
      const fallbackCoord = mapCoordFromWgs84(fallbackLatLng[0], fallbackLatLng[1]);

      lastLatLng = [fallbackLatLng[0], fallbackLatLng[1]];
      lastHeadingDeg = fallbackHeading;

      const previewFeature = ensureMyLocationFeature(fallbackCoord);
      if (previewFeature) {
        previewFeature.set("headingDeg", lastHeadingDeg);
        previewFeature.set("showHeadingHandle", false);
        previewFeature.changed();
      }
    } else {
      lastLatLng = null;
      lastHeadingDeg = 0;
      myLocationSource.clear();
      myLocationFeature = null;
    }

    updateRegistrationPreview();
  }

  function setEditOriginMarker(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      clearEditOriginMarker();
      return;
    }

    const coord = mapCoordFromWgs84(lat, lng);
    if (!editOriginFeature) {
      editOriginFeature = new ol.Feature(new ol.geom.Point(coord));
      editOriginFeature.set("markerKind", "edit-origin");
      myLocationSource.addFeature(editOriginFeature);
      editOriginPulseStartTs = Date.now();
      startEditOriginPulseAnimation();
      return;
    }

    animateEditOriginTo(coord);
    startEditOriginPulseAnimation();
  }

  function clearEditOriginMarker() {
    if (!editOriginFeature) return;
    stopEditOriginMoveAnimation();
    myLocationSource.removeFeature(editOriginFeature);
    editOriginFeature = null;
    stopEditOriginPulseAnimation();
    editOriginPulseStartTs = 0;
  }

  function ensureMyLocationFeature(coord) {
    if (!myLocationFeature) {
      myLocationFeature = new ol.Feature(new ol.geom.Point(coord));
      myLocationFeature.set("headingDeg", null);
      myLocationSource.addFeature(myLocationFeature);
      return myLocationFeature;
    }

    myLocationFeature.setGeometry(new ol.geom.Point(coord));
    return myLocationFeature;
  }

  function norm360(deg) {
    return (deg % 360 + 360) % 360;
  }

  function angleDelta(a, b) {
    let delta = norm360(a - b);
    if (delta > 180) delta -= 360;
    return delta;
  }

  function getScreenAngle() {
    const screenAngle = screen && screen.orientation ? screen.orientation.angle : undefined;
    if (typeof screenAngle === "number") return screenAngle;
    const orientation = window.orientation;
    if (typeof orientation === "number") return orientation;
    return 0;
  }

  function pickClosestHeading(candidates, referenceDeg) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    if (!Number.isFinite(referenceDeg)) return candidates[0];

    let best = candidates[0];
    let bestDiff = Math.abs(angleDelta(candidates[0], referenceDeg));
    for (let index = 1; index < candidates.length; index += 1) {
      const diff = Math.abs(angleDelta(candidates[index], referenceDeg));
      if (diff < bestDiff) {
        best = candidates[index];
        bestDiff = diff;
      }
    }
    return best;
  }

  function getPlatform() {
    const ua = navigator.userAgent || "";
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    if (isIOS) return "ios";
    if (isAndroid) return "android";
    return "other";
  }

  function getCapacitorAppPlugin() {
    const capacitor = window.Capacitor;
    if (!capacitor || !capacitor.Plugins) return null;

    const appPlugin = capacitor.Plugins.App;
    if (!appPlugin) return null;
    if (typeof appPlugin.addListener !== "function") return null;
    if (typeof appPlugin.exitApp !== "function") return null;

    return appPlugin;
  }

  // Capacitor Haptics 플러그인 인스턴스를 반환한다.
  // @capacitor/haptics 는 WebView가 아닌 네이티브 레이어에서 진동을 처리하기 때문에
  // navigator.vibrate() 와 달리 사용자 터치 없이도 (앱 시작 직후 포함) 항상 동작한다.
  function getCapacitorHapticsPlugin() {
    const capacitor = window.Capacitor;
    if (!capacitor || !capacitor.Plugins) return null;
    return capacitor.Plugins.Haptics || null;
  }

  // 햅틱(진동) 피드백을 울린다.
  // ─ 우선순위 1: Capacitor Haptics (네이티브 API, 터치 없이도 동작)
  //   style 값: "LIGHT" | "MEDIUM" | "HEAVY"
  //   LIGHT  → 짧고 가벼운 진동 (뒤로가기 알림 등 단순 안내)
  //   MEDIUM → 중간 세기 (확인/완료 피드백)
  //   HEAVY  → 강한 진동 (오류, 경고)
  // ─ 우선순위 2 (폴백): navigator.vibrate()
  //   WebView 보안 정책상 사용자가 한 번 이상 터치한 후에만 작동한다.
  //   앱 시작 직후 하드웨어 뒤로가기처럼 터치 없이 호출되면 무시될 수 있다.
  function triggerHapticImpact(style) {
    const haptics = getCapacitorHapticsPlugin();
    if (haptics && typeof haptics.impact === "function") {
      haptics.impact({ style: style || "LIGHT" }).catch(function () {});
      return;
    }
    // Haptics 플러그인을 쓸 수 없는 환경(브라우저 등)에서는 navigator.vibrate 로 대체한다.
    if (typeof window.navigator !== "undefined" && window.navigator && typeof window.navigator.vibrate === "function") {
      try {
        const vibrateMs = (window.__bpVibrateConfig && window.__bpVibrateConfig.SHORT) || 18;
        window.navigator.vibrate(vibrateMs);
      } catch (e) {}
    }
  }

  function registerBackClosableOverlay(overlayEl, onBackClose) {
    if (!overlayEl || typeof onBackClose !== "function") {
      return function () {};
    }

    const entry = {
      overlayEl: overlayEl,
      onBackClose: onBackClose
    };
    overlayBackCloseStack.push(entry);

    let removed = false;
    return function unregisterOverlay() {
      if (removed) return;
      removed = true;
      const index = overlayBackCloseStack.indexOf(entry);
      if (index >= 0) overlayBackCloseStack.splice(index, 1);
    };
  }

  function closeTopBackClosableOverlay() {
    for (let index = overlayBackCloseStack.length - 1; index >= 0; index -= 1) {
      const entry = overlayBackCloseStack[index];
      if (!entry || !entry.overlayEl || !entry.overlayEl.parentNode) {
        overlayBackCloseStack.splice(index, 1);
        continue;
      }

      try {
        entry.onBackClose();
      } catch (error) {
        console.warn("팝업 뒤로가기 닫기 실패:", error);
      }
      return true;
    }
    return false;
  }

  // 안드로이드 하단 뒤로가기(하드웨어 back) 공통 처리.
  // 우선순위: 관측점 팝업 닫기 -> 목록/등록/분석 UI 닫기 -> 분석 결과 표시 취소 -> 2회 입력으로 앱 종료.
  async function setupAndroidBackButtonExit() {
    if (getPlatform() !== "android") return;

    const appPlugin = getCapacitorAppPlugin();
    if (!appPlugin || removeBackButtonListener) return;

    const listener = await appPlugin.addListener("backButton", function () {
      if (window.BearStartupLoading) { resetBackExitState(); return; }
      // Confirmation/preview overlays take precedence over the panels underneath.
      if (closeTopBackClosableOverlay()) {
        resetBackExitState();
        return;
      }
      if (window.BearAppSettings?.isOpen()) {
        window.BearAppSettings.close();
        resetBackExitState();
        return;
      }
      if (gpsTrackUi.isOpen() && !window.BearMobileDock?.isDocked()) {
        gpsTrackUi.close(); resetBackExitState(); return;
      }
      if (window.SdrDiagnostics && window.SdrDiagnostics.handleBackNavigation()) {
        resetBackExitState();
        return;
      }

      // 1) 지도 위 관측점 상세 팝업이 열려 있으면 먼저 닫는다.
      if (observationPopupEl && observationPopupEl.style.display !== "none") {
        closeObservationPopup();
        resetBackExitState();
        return;
      }

      if (obsRegisterModule && typeof obsRegisterModule.handleBackNavigation === "function" &&
          obsRegisterModule.handleBackNavigation()) {
        resetBackExitState();
        return;
      }

      // 2) 목록/등록/분석 다이얼로그 등 메뉴성 UI는 obsList 모듈에서 우선 닫는다.
      if (window.BearMobileDock?.handleBack()) { resetBackExitState(); return; }
      if (!window.BearMobileDock?.isDocked() && obsListModule && typeof obsListModule.handleBackNavigation === "function") {
        const handled = obsListModule.handleBackNavigation();
        if (handled) { resetBackExitState(); return; }
      }

      // 3) 메뉴가 없다면 지도 위 분석 결과(추정 위치 표시)만 취소한다.
      if (analysisEstimateSource && typeof analysisEstimateSource.getFeatures === "function") {
        const estimateFeatures = analysisEstimateSource.getFeatures();
        if (Array.isArray(estimateFeatures) && estimateFeatures.length > 0) {
          clearAnalysisEstimateVisuals();
          setDefaultStatusWithIcon();
          resetBackExitState();
          return;
        }
      }

      // 4) 더 닫을 UI가 없을 때는 짧은 시간 내 2회 뒤로가기 시 앱을 종료한다.
      const now = Date.now();
      if (lastBackPressAt > 0 && now - lastBackPressAt <= BACK_EXIT_DOUBLE_PRESS_MS) {
        resetBackExitState();
        if (typeof window.SdrDiagnostics?.exitAppSafely === "function") {
          void window.SdrDiagnostics.exitAppSafely(() => appPlugin.exitApp());
        } else appPlugin.exitApp();
        return;
      }

      lastBackPressAt = now;
      showBackExitToast("한번 더 뒤로가면 앱이 꺼져요.");
      triggerHapticImpact("LIGHT");
    });

    if (listener && typeof listener.remove === "function") {
      removeBackButtonListener = function () {
        listener.remove();
        removeBackButtonListener = null;
      };

      window.addEventListener("beforeunload", function cleanupBackButtonListener() {
        if (removeBackButtonListener) {
          removeBackButtonListener();
        }
      }, { once: true });
    }
  }

  function applyHeadingOffset(deg, platform) {
    const key = platform || getPlatform();
    let offset = HEADING_OFFSET[key];
    if (offset === null || offset === undefined) {
      offset = HEADING_OFFSET.other;
    }
    if (offset === null || offset === undefined) {
      offset = 0;
    }
    return norm360(deg + offset);
  }

  // GPS 샘플에서 속도/방향을 추정해 나침반 보정에 활용한다.
  function updateGpsHeadingSample(coords) {
    if (!coords) return;

    const now = Date.now();
    const nextLatLng = [coords.latitude, coords.longitude];

    const speed = coords.speed;
    if (typeof speed === "number" && Number.isFinite(speed) && speed >= 0) {
      lastGpsSpeedMps = speed;
    } else {
      lastGpsSpeedMps = null;
    }

    const heading = coords.heading;
    if (typeof heading === "number" && Number.isFinite(heading) && heading >= 0) {
      lastGpsHeadingDeg = norm360(heading);
      lastGpsHeadingTs = now;
    } else if (lastGpsSampleLatLng && lastGpsSampleTs > 0) {
      const derivedSpeed = computeGpsSpeedMps(lastGpsSampleLatLng, nextLatLng, lastGpsSampleTs, now);
      if (!Number.isFinite(lastGpsSpeedMps) && Number.isFinite(derivedSpeed)) {
        lastGpsSpeedMps = derivedSpeed;
      }

      const derivedHeading = computeBearingFromLatLng(lastGpsSampleLatLng, nextLatLng);
      if (
        Number.isFinite(derivedHeading) &&
        Number.isFinite(derivedSpeed) &&
        derivedSpeed >= COMPASS_CFG.gpsMinSpeedMps
      ) {
        lastGpsHeadingDeg = derivedHeading;
        lastGpsHeadingTs = now;
      }
    }

    lastGpsSampleLatLng = nextLatLng;
    lastGpsSampleTs = now;

    if (Number.isFinite(lastGpsSpeedMps) && lastGpsSpeedMps < COMPASS_CFG.gpsMinSpeedMps) {
      lastGpsHeadingDeg = null;
      lastGpsHeadingTs = 0;
    }
  }

  function toRadians(deg) {
    return deg * Math.PI / 180;
  }

  function toDegrees(rad) {
    return rad * 180 / Math.PI;
  }

  function computeDistanceMeters(fromLatLng, toLatLng) {
    if (!Array.isArray(fromLatLng) || !Array.isArray(toLatLng)) return null;

    const earthRadius = 6371000;
    const lat1 = toRadians(fromLatLng[0]);
    const lat2 = toRadians(toLatLng[0]);
    const deltaLat = toRadians(toLatLng[0] - fromLatLng[0]);
    const deltaLng = toRadians(toLatLng[1] - fromLatLng[1]);

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadius * c;
  }

  function computeBearingFromLatLng(fromLatLng, toLatLng) {
    if (!Array.isArray(fromLatLng) || !Array.isArray(toLatLng)) return null;

    const distanceMeters = computeDistanceMeters(fromLatLng, toLatLng);
    if (!Number.isFinite(distanceMeters) || distanceMeters < 2) return null;

    const lat1 = toRadians(fromLatLng[0]);
    const lat2 = toRadians(toLatLng[0]);
    const deltaLng = toRadians(toLatLng[1] - fromLatLng[1]);
    const y = Math.sin(deltaLng) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);

    return norm360(toDegrees(Math.atan2(y, x)));
  }

  function computeGpsSpeedMps(fromLatLng, toLatLng, fromTs, toTs) {
    const distanceMeters = computeDistanceMeters(fromLatLng, toLatLng);
    const deltaSeconds = (toTs - fromTs) / 1000;
    if (!Number.isFinite(distanceMeters) || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return null;
    }
    return distanceMeters / deltaSeconds;
  }

  function canUseGpsHeading() {
    if (!COMPASS_CFG.useGpsHeadingWhenMoving) return false;
    if (!Number.isFinite(lastGpsHeadingDeg)) return false;
    if (!Number.isFinite(lastGpsSpeedMps)) return false;
    if (lastGpsSpeedMps < COMPASS_CFG.gpsMinSpeedMps) return false;
    if (!lastGpsHeadingTs) return false;
    if (Date.now() - lastGpsHeadingTs > COMPASS_CFG.gpsHeadingMaxAgeMs) return false;
    return true;
  }

  function getAdaptiveGpsBlendAlpha() {
    const minAlpha = COMPASS_CFG.gpsBlendAlphaMin;
    const maxAlpha = COMPASS_CFG.gpsBlendAlphaMax;
    const maxSpeed = COMPASS_CFG.gpsBlendSpeedMaxMps;

    if (!Number.isFinite(lastGpsSpeedMps) || !Number.isFinite(maxSpeed) || maxSpeed <= 0) {
      return minAlpha;
    }

    const clampedSpeed = Math.max(0, Math.min(lastGpsSpeedMps, maxSpeed));
    const ratio = clampedSpeed / maxSpeed;
    return minAlpha + (maxAlpha - minAlpha) * ratio;
  }

  function fuseHeadingWithGps(sensorDeg) {
    if (!Number.isFinite(sensorDeg)) return sensorDeg;
    if (!canUseGpsHeading()) return sensorDeg;

    const gpsDeg = norm360(lastGpsHeadingDeg);
    const delta = angleDelta(gpsDeg, sensorDeg);
    return norm360(sensorDeg + delta * getAdaptiveGpsBlendAlpha());
  }

  function computeHeadingFromEvent(event) {
    const screenAngle = getScreenAngle();

    if (typeof event.webkitCompassHeading === "number") {
      return norm360(event.webkitCompassHeading);
    }

    if (event.absolute === true && typeof event.alpha === "number") {
      const raw = norm360(360 - event.alpha);
      return pickClosestHeading([
        raw,
        norm360(raw + screenAngle),
        norm360(raw - screenAngle)
      ], headingSmoothed);
    }

    if (typeof event.alpha === "number") {
      const raw = norm360(360 - event.alpha);
      return pickClosestHeading([
        raw,
        norm360(raw + screenAngle),
        norm360(raw - screenAngle)
      ], headingSmoothed);
    }

    return null;
  }

  // 급격한 방향 점프를 완화해 시각적으로 안정적인 헤딩을 만든다.
  function filterHeading(nextDeg) {
    if (headingSmoothed === null) {
      headingSmoothed = nextDeg;
      lastStableDeg = nextDeg;
      return nextDeg;
    }

    const delta = angleDelta(nextDeg, headingSmoothed);
    const absDelta = Math.abs(delta);

    if (absDelta >= COMPASS_CFG.jumpThresholdDeg) {
      unstableHits.push(Date.now());
      const cutoff = Date.now() - COMPASS_CFG.unstableWindowMs;
      unstableHits = unstableHits.filter(function (timestamp) {
        return timestamp >= cutoff;
      });

      if (unstableHits.length >= COMPASS_CFG.unstableCount) {
        if (COMPASS_CFG.freezeOnUnstable && lastStableDeg !== null) {
          return lastStableDeg;
        }
        headingSmoothed = norm360(headingSmoothed + delta * 0.08);
        return headingSmoothed;
      }

      headingSmoothed = norm360(headingSmoothed + delta * 0.12);
      return headingSmoothed;
    }

    headingSmoothed = norm360(headingSmoothed + delta * COMPASS_CFG.smoothAlpha);
    lastStableDeg = headingSmoothed;
    return headingSmoothed;
  }

  function setHeading(deg) {
    if (!Number.isFinite(deg)) return;

    let effectiveDeg = deg;
    if (obsRegisterModule && obsRegisterModule.isHeadingLocked && obsRegisterModule.isHeadingLocked()) {
      const lockedHeading = obsRegisterModule.getLockedHeading ? obsRegisterModule.getLockedHeading() : null;
      if (Number.isFinite(lockedHeading)) {
        effectiveDeg = lockedHeading;
      }
    }

    lastHeadingDeg = effectiveDeg;
    if (isMyVisible || watchId !== null) {
      lastTrackedHeadingDeg = effectiveDeg;
    }

    if (myLocationFeature) {
      myLocationFeature.set("headingDeg", effectiveDeg);
      myLocationFeature.changed();
    }

    if (obsRegisterModule) {
      obsRegisterModule.updateLiveData({
        heading: deg,
        timestamp: lastGpsTimestamp || Date.now(),
        isGpsActive: isMyVisible || watchId !== null
      });
    }

    if (headingDialRingEl) {
      headingDialRingEl.setAttribute("transform", "rotate(" + (-effectiveDeg).toFixed(1) + " " + DIAL_CENTER + ")");
      headingDialDegEl.textContent = Math.round(norm360(effectiveDeg)) % 360 + "°";
      headingDialDirEl.textContent = headingDirectionLabel(effectiveDeg);
      headingDialEl.classList.toggle("is-locked", effectiveDeg !== deg);
      headingDialEl.classList.add("is-live");
    }

    updateRegistrationPreview();
  }

  function headingDirectionLabel(deg) {
    return ["북", "북동", "동", "남동", "남", "남서", "서", "북서"][Math.round(norm360(deg) / 45) % 8];
  }

  // 방향 모드에서 바라보는 방향이 화면 위가 되도록 지도를 돌린다. 센서는 초당 수십 번 오므로 프레임당 한 번, 1° 미만 흔들림은 무시.
  // 방향 모드: 매 프레임 목표(바라보는 방향·GPS 위치)로 일정 비율씩 다가가 부드럽게 따라간다.
  // 회전과 위치 이동을 한 루프에서 처리해 GPS 이동 애니메이션이 회전을 멈추게 하지 않는다.
  const HEADING_FOLLOW_RATIO = 0.18; // 프레임당 남은 차이의 비율. 올리면 빠르게, 내리면 더 부드럽게 따라간다.
  let headingTargetCenter = null;
  function scheduleHeadingTurn() {
    if (trackMode !== "heading" || headingTurnFrame) return;
    headingTurnFrame = window.requestAnimationFrame(stepHeadingTurn);
  }
  function stepHeadingTurn() {
    headingTurnFrame = 0;
    if (trackMode !== "heading" || !Number.isFinite(lastSensorHeadingDeg) || view.getInteracting()) return;
    if (view.getAnimating()) { // 방향 모드에 들어갈 때의 짧은 애니메이션이 끝나면 이어서 따라간다.
      headingTurnFrame = window.requestAnimationFrame(stepHeadingTurn);
      return;
    }
    const next = nextHeadingView(-view.getRotation() * 180 / Math.PI, lastSensorHeadingDeg, view.getCenter(), headingTargetCenter, HEADING_FOLLOW_RATIO);
    if (next.rotationDeg !== null) view.setRotation(-next.rotationDeg * Math.PI / 180);
    if (next.center) view.setCenter(next.center);
    else headingTargetCenter = null;
    if (next.rotationDeg !== null || next.center) headingTurnFrame = window.requestAnimationFrame(stepHeadingTurn);
  }
  // 한 프레임 이동량 계산. 회전은 359°→1°처럼 0°를 지날 때도 짧은 쪽으로 돈다. 다 왔으면 null.
  function nextHeadingView(shownDeg, targetDeg, center, targetCenter, ratio) {
    const diff = angleDelta(targetDeg, shownDeg);
    const rotationDeg = Math.abs(diff) > 0.1 ? shownDeg + diff * ratio : null;
    let nextCenter = null;
    if (Array.isArray(center) && Array.isArray(targetCenter)) {
      const dx = targetCenter[0] - center[0], dy = targetCenter[1] - center[1];
      if (Math.hypot(dx, dy) > 0.2) nextCenter = [center[0] + dx * ratio, center[1] + dy * ratio];
    }
    return { rotationDeg: rotationDeg, center: nextCenter };
  }

  const TRACK_MODE_TITLES = {
    off: "내 위치 켜기",
    on: "내 위치로 이동",
    follow: "내 위치 따라가는 중 · 누르면 바라보는 방향으로 회전",
    heading: "바라보는 방향 모드 · 누르면 내 위치 끄기"
  };

  // 네이버 지도처럼: 따라가기 → 바라보는 방향 → 끄기. 지도를 끌면 따라가기만 멈춘다(on).
  function setTrackMode(mode, move) {
    if (mode === "heading" && !Number.isFinite(lastSensorHeadingDeg)) {
      if (statusEl) statusEl.textContent = "🧭 방향 센서 값을 아직 받지 못해 지도를 돌릴 수 없습니다.";
      mode = "follow";
    }
    const was = trackMode;
    trackMode = mode;
    headingTargetCenter = null;
    if (locateBtnEl) {
      locateBtnEl.dataset.mode = mode;
      locateBtnEl.title = TRACK_MODE_TITLES[mode];
      locateBtnEl.setAttribute("aria-label", TRACK_MODE_TITLES[mode]);
    }
    if (move === false) return;

    const animation = { duration: 450 };
    if ((mode === "follow" || mode === "heading") && lastTrackedLatLng) {
      animation.center = mapCoordFromWgs84(lastTrackedLatLng[0], lastTrackedLatLng[1]);
    }
    if (mode === "heading") animation.rotation = -lastSensorHeadingDeg * Math.PI / 180;
    else if (was === "heading") animation.rotation = 0;
    if (!animation.center && animation.rotation === undefined) return;
    view.cancelAnimations();
    view.animate(animation);
  }

  // 목록 선택·지리산 이동 등 앱이 지도를 옮길 때는 따라가기를 멈춘다.
  function stopFollowing() {
    if (trackMode === "follow" || trackMode === "heading") setTrackMode("on", false);
  }

  async function cycleMyLocation() {
    if (!isMyVisible) {
      await toggleMyLocation(); // 꺼짐 → 켜기, 수신 대기 중 → 취소
      return;
    }
    if (trackMode === "follow") setTrackMode("heading");
    else if (trackMode === "heading") stopMyLocationTracking(true);
    else setTrackMode("follow");
  }

  // 디바이스 방향 이벤트를 구독해 헤딩을 계산/보정/적용한다.
  async function startCompass() {
    if (compassEnabled) return;

    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") {
        if (statusEl) statusEl.textContent = "🟠 나침반 권한 거부됨";
        return;
      }
    }

    compassHandler = function (event) {
      if (event.type === "deviceorientationabsolute") {
        lastAbsoluteSampleTs = Date.now();
      }

      if (
        event.type === "deviceorientation" &&
        lastAbsoluteSampleTs > 0 &&
        Date.now() - lastAbsoluteSampleTs < 1500
      ) {
        return;
      }

      const heading = computeHeadingFromEvent(event);
      if (!Number.isFinite(heading)) return;

      const corrected = applyHeadingOffset(heading);
      const smoothed = filterHeading(corrected);
      const fused = fuseHeadingWithGps(smoothed);
      lastSensorHeadingDeg = fused;
      setHeading(fused);
      scheduleHeadingTurn();
    };

    const hasAbsoluteEvent = "ondeviceorientationabsolute" in window;
    compassEventName = hasAbsoluteEvent ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(compassEventName, compassHandler, true);
    if (hasAbsoluteEvent) {
      window.addEventListener("deviceorientation", compassHandler, true);
    }

    compassEnabled = true;
  }

  function stopCompass() {
    if (!compassEnabled) return;
    if (compassEventName) {
      window.removeEventListener(compassEventName, compassHandler, true);
    }
    window.removeEventListener("deviceorientation", compassHandler, true);
    compassHandler = null;
    compassEnabled = false;
    compassEventName = null;
    headingSmoothed = null;
    unstableHits = [];
    lastStableDeg = null;
    lastAbsoluteSampleTs = 0;
    lastSensorHeadingDeg = null;

    if (headingDialEl) {
      headingDialEl.classList.remove("is-live");
      headingDialRingEl.setAttribute("transform", "rotate(0 " + DIAL_CENTER + ")");
      headingDialEl.classList.remove("is-locked");
      headingDialDegEl.textContent = "--°";
      headingDialDirEl.textContent = "";
    }
  }

  function getObservationLabelFromData(obsData) {
    if (!obsData) return "관측점";
    const place = String(obsData.place || "").trim();
    const id = String(obsData.id || "").trim();
    return place || id || "관측점";
  }

  function getObservationMarkerText(obsData) {
    const label = getObservationLabelFromData(obsData);
    return label.length > 10 ? label.slice(0, 10) + "..." : label;
  }

  function getObservationHeadingDeg(obsData) {
    if (!obsData) return null;

    const rawHeading = typeof obsData.heading === "string"
      ? obsData.heading.replace(/[^0-9.-]/g, "")
      : obsData.heading;
    const headingDeg = Number(rawHeading);
    return Number.isFinite(headingDeg) ? headingDeg : null;
  }

  function createObservationStyleFromMarker(marker) {
    const obsData = marker && marker.obsData ? marker.obsData : null;
    const labelText = getObservationMarkerText(obsData);
    const teamColor = /^#[0-9a-f]{6}$/i.test(String(obsData?.team_color || "")) ? obsData.team_color : null;
    const headingIconSrc = teamColor
      ? createHeadingIconDataUri(OBSERVATION_HEADING_ICON_SIZE, teamColor, 5.5)
      : observationHeadingIconSrc;

    return function() {
      const headingDeg = getObservationHeadingDeg(obsData);
      const isSelected = !!(obsData && obsData.isSelected);
      const obsId = String(obsData && obsData.id ? obsData.id : "").trim();
      const isFocused = !!(obsId && obsId === focusedObservationId);
      const isEditingTarget = !!(obsId && currentEditingObservationId && obsId === currentEditingObservationId);
      const suppressSelectedHalo = !!editOriginFeature;
      const flashUntil = Number(marker && marker._feature && marker._feature.get ? marker._feature.get("saveFlashUntil") : 0);
      const flashDurationMs = Number(marker && marker._feature && marker._feature.get ? marker._feature.get("saveFlashDurationMs") : 0) || OBS_SAVE_FLASH_DURATION_MS;
      const flashRemainingMs = Number.isFinite(flashUntil) ? flashUntil - Date.now() : 0;
      const isSaveFlashActive = flashRemainingMs > 0;
      const flashElapsedMs = isSaveFlashActive ? (flashDurationMs - flashRemainingMs) : 0;
      const flashProgress = isSaveFlashActive ? clamp01(flashElapsedMs / flashDurationMs) : 1;
      const rotation = Number.isFinite(headingDeg) ? (headingDeg * Math.PI) / 180 : 0;

      const styles = [];

      if (isFocused) {
        styles.push(new ol.style.Style({ image: new ol.style.Circle({
          radius: 17, stroke: new ol.style.Stroke({ color: "rgba(15,23,42,0.8)", width: 6 })
        }) }));
        styles.push(new ol.style.Style({ image: new ol.style.Circle({
          radius: 17, stroke: new ol.style.Stroke({ color: "#ffffff", width: 3 })
        }) }));
      }

      if (isSaveFlashActive) {
        // Two expanding outlined rings distinguish focus from every team color.
        const phase = (flashProgress * 2) % 1;
        const opacity = Math.sin(phase * Math.PI) * clamp01((1 - flashProgress) * 4);
        const radius = 14 + 20 * phase;
        styles.push(new ol.style.Style({ image: new ol.style.Circle({
          radius, stroke: new ol.style.Stroke({ color: `rgba(15,23,42,${opacity * 0.65})`, width: 5 })
        }) }));
        styles.push(new ol.style.Style({ image: new ol.style.Circle({
          radius, stroke: new ol.style.Stroke({ color: `rgba(255,255,255,${opacity})`, width: 2.5 })
        }) }));
      }

      if (isEditingTarget) {
        styles.push(new ol.style.Style({
          image: new ol.style.Circle({
            radius: 18,
            fill: new ol.style.Fill({ color: "rgba(34,197,94,0.16)" }),
            stroke: new ol.style.Stroke({ color: "rgba(22,163,74,0.94)", width: 3.2 })
          })
        }));
      }

      if (isSelected && !suppressSelectedHalo) {
        styles.push(new ol.style.Style({
          image: new ol.style.Circle({
            radius: 16,
            fill: new ol.style.Fill({ color: "rgba(59,130,246,0.10)" }),
            stroke: new ol.style.Stroke({ color: "rgba(59,130,246,0.86)", width: 3 })
          })
        }));
      }

      
      const baseHeadingIconSrc = isEditingTarget ? observationHeadingEditIconSrc : headingIconSrc;
      styles.push(new ol.style.Style({
          image: new ol.style.Icon({
            src: baseHeadingIconSrc,
            width: OBSERVATION_HEADING_ICON_SIZE,
            height: OBSERVATION_HEADING_ICON_SIZE,
            anchor: [0.5, 0.5],
            anchorXUnits: "fraction",
            anchorYUnits: "fraction",
            rotateWithView: true,
            rotation: rotation,
            opacity: 1
          }),
          text: new ol.style.Text({
            text: labelText,
            offsetY: -22,
            padding: [4, 8, 4, 8],
            font: "700 11px sans-serif",
            fill: new ol.style.Fill({ color: "rgba(255,255,255,0.95)" }),
            backgroundFill: new ol.style.Fill({
              color: isEditingTarget
                ? "rgba(22,163,74,0.9)"
                : (teamColor ? teamColor + (isSelected ? "e6" : "c7") : (isSelected ? "rgba(194,65,12,0.84)" : "rgba(194,65,12,0.58)"))
            }),
            backgroundStroke: new ol.style.Stroke({
              color: isSelected ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)",
              width: isFocused ? 2.5 : isSelected ? 1.6 : 1.25
            })
          })
        }));


      return styles;
    };
  }

  const observationPopupEl = document.createElement("div");
  observationPopupEl.className = "map-detail-popup";
  observationPopupEl.style.position = "relative";
  observationPopupEl.style.minWidth = "180px";
  observationPopupEl.style.maxWidth = "240px";
  observationPopupEl.style.padding = "12px 14px";
  observationPopupEl.style.borderRadius = "14px";
  observationPopupEl.style.background = "rgba(255,255,255,0.97)";
  observationPopupEl.style.boxShadow = "0 12px 28px rgba(15,23,42,0.22)";
  observationPopupEl.style.border = "1px solid rgba(148,163,184,0.3)";
  observationPopupEl.style.color = "#1f2937";
  observationPopupEl.style.fontSize = "13px";
  observationPopupEl.style.lineHeight = "1.5";
  observationPopupEl.style.pointerEvents = "auto";
  observationPopupEl.style.display = "none";
  observationPopupEl.style.zIndex = "10030";

  const observationPopupCloseEl = document.createElement("button");
  observationPopupCloseEl.type = "button";
  observationPopupCloseEl.textContent = "X";
  observationPopupCloseEl.setAttribute("aria-label", "관측점 정보 닫기");
  observationPopupCloseEl.style.position = "absolute";
  observationPopupCloseEl.style.top = "6px";
  observationPopupCloseEl.style.right = "8px";
  observationPopupCloseEl.style.border = "0";
  observationPopupCloseEl.style.background = "transparent";
  observationPopupCloseEl.style.color = "#64748b";
  observationPopupCloseEl.style.fontSize = "18px";
  observationPopupCloseEl.style.lineHeight = "1";
  observationPopupCloseEl.style.cursor = "pointer";
  observationPopupCloseEl.style.zIndex = "3";

  const observationPopupContentEl = document.createElement("div");
  observationPopupContentEl.className = "map-detail-popup-content";
  //observationPopupContentEl.style.paddingRight = "16px";

  observationPopupEl.appendChild(observationPopupCloseEl);
  observationPopupEl.appendChild(observationPopupContentEl);

  // 상세 팝업의 관측점 수정 및 개체 추적 파일 버튼을 처리한다.
  observationPopupContentEl.addEventListener("click", function (event) {
    const obsActionButton = event && event.target && typeof event.target.closest === "function"
      ? event.target.closest("[data-observation-action]")
      : null;
    const bearActionButton = event && event.target && typeof event.target.closest === "function"
      ? event.target.closest("[data-bear-action]")
      : null;
    if (!obsActionButton && !bearActionButton) return;

    event.preventDefault();
    event.stopPropagation();

    // ── 관측점 수정 / 삭제 ──
    if (obsActionButton) {
      const action = String(obsActionButton.getAttribute("data-observation-action") || "").trim();
      const obsData = observationPopupEl._observationData || null;
      if (!action || !obsData) return;

      if (action === "edit") {
        openObservationEdit(obsData);
        return;
      }
      return;
    }

    // ── 곰 추정위치 파일 저장 ──
    if (bearActionButton) {
      const action = String(bearActionButton.getAttribute("data-bear-action") || "").trim();
      const bearData = observationPopupEl._bearEstimateData || null;
      if (!action || !bearData) return;

      if (action === "txt") {
        closeObservationPopup();
        void downloadBearEstimateTxt(bearData, currentBearEstimateFallbackMode);
        return;
      }
      if (action === "xls" && !bearData._unsaved) {
        closeObservationPopup();
        void downloadAllBearEstimatesXls([bearData]);
        return;
      }
    }
  });

  const observationPopupOverlay = new ol.Overlay({
    element: observationPopupEl,
    positioning: "bottom-center",
    offset: [0, -18],
    stopEvent: true
  });
  map.addOverlay(observationPopupOverlay);

  // 화면 하단/상단 여유 공간을 기준으로 상세 팝업이 잘리지 않게 배치한다.
  function syncObservationPopupPlacement(coordinate) {
    coordinate = coordinate || observationPopupOverlay.getPosition();
    if (!coordinate) return;
    const rect = map.getViewport().getBoundingClientRect();
    const pixel = map.getPixelFromCoordinate(coordinate);
    if (!pixel) return;
    const visual = window.visualViewport;
    const safe = window.getComputedStyle(document.documentElement);
    const screenLeft = Math.max(parseCssPx(safe.getPropertyValue("--safe-left")), (visual ? visual.offsetLeft : 0) - rect.left);
    const screenRight = Math.min(rect.width - parseCssPx(safe.getPropertyValue("--safe-right")), (visual ? visual.offsetLeft + visual.width : window.innerWidth) - rect.left);
    let left = Math.max(0, screenLeft) + 18;
    let right = screenRight - 74;
    let top = Math.max(0, parseCssPx(safe.getPropertyValue("--safe-top")), (visual ? visual.offsetTop : 0) - rect.top) + 18;
    let bottom = Math.min(rect.height - parseCssPx(safe.getPropertyValue("--safe-bottom")), (visual ? visual.offsetTop + visual.height : window.innerHeight) - rect.top) - 18;
    // Reserve the actual control bounds rather than guessing their width.
    for (const control of document.querySelectorAll?.('#btn-sdr-diagnostics, #btn-app-settings, #btn-map-layers, .map-right-controls, #compass') || []) {
      if (!control.getClientRects().length) continue;
      const bounds = control.getBoundingClientRect();
      if (!bounds.width || !bounds.height) continue;
      if (control.matches('.map-right-controls, #compass')) {
        right = Math.min(right, bounds.left - rect.left - 12);
      } else {
        top = Math.max(top, bounds.bottom - rect.top + 12);
      }
    }
    if (right <= left || bottom <= top) return;
    const visible = { left, right, top, bottom };
    const isCompactDetail = !!observationPopupContentEl.querySelector(".obs-popup-card--observation, .obs-popup-card--estimate");
    const popupWidth = isCompactDetail ? 300 : 240;
    const panel = window.BearMobileDock?.isDocked() ? document.getElementById('mobile-map-dock') : document.querySelector(".panel-bottom-left");
    if (panel && panel.getClientRects().length) {
      const panelRect = panel.getBoundingClientRect();
      const panelLeft = (panelRect.left ?? panelRect.right - panelRect.width) - rect.left;
      const panelRight = panelRect.right - rect.left;
      const panelTop = panelRect.top - rect.top;
      const panelBottom = panelTop + panelRect.height;
      if (panelRect.width > 0 && panelRect.height > 0 && panelLeft < right && panelRight > left && panelTop < bottom && panelBottom > top) {
        const spaces = [
          { ...visible, bottom: Math.min(bottom, panelTop - 18) },
          { ...visible, left: Math.max(left, panelRight + 18) },
          { ...visible, right: Math.min(right, panelLeft - 18) },
          { ...visible, top: Math.max(top, panelBottom + 18) }
        ].filter(space => space.right - space.left >= Math.min(180, visible.right - visible.left) &&
          space.bottom - space.top >= Math.min(160, visible.bottom - visible.top));
        spaces.sort((a, b) => Math.min(popupWidth, b.right - b.left) * (b.bottom - b.top) -
          Math.min(popupWidth, a.right - a.left) * (a.bottom - a.top));
        // A full-height/transitioning panel must never turn the popup into a zero-height strip.
        // When no readable space remains beside it, use the visible map and scroll the popup body.
        if (spaces.length) ({ left, right, top, bottom } = spaces[0]);
      }
    }
    observationPopupEl.style.boxSizing = "border-box";
    observationPopupEl.style.padding = isCompactDetail ? "9px 10px" : "12px 14px";
    observationPopupEl.style.width = `${Math.min(popupWidth, Math.max(0, right - left))}px`;
    observationPopupEl.style.minWidth = "0";
    observationPopupEl.style.maxWidth = `${popupWidth}px`;
    observationPopupEl.style.maxHeight = `${Math.max(0, bottom - top)}px`;
    const card = observationPopupEl.getBoundingClientRect();
    const clamp = (value, min, max) => Math.max(min, Math.min(value, Math.max(min, max)));
    const sideY = clamp(pixel[1] - card.height / 2, top, bottom - card.height);
    const centerX = clamp(pixel[0] - card.width / 2, left, right - card.width);
    const candidates = [
      [pixel[0] + 44, sideY],
      [pixel[0] - card.width - 44, sideY],
      [centerX, pixel[1] - card.height - 58],
      [centerX, pixel[1] + 38]
    ];
    let position = candidates.find(([x, y]) => x >= left && x + card.width <= right &&
      y >= top && y + card.height <= bottom);
    if (!position) {
      observationPopupEl.style.maxHeight = `${Math.max(0, bottom - top)}px`;
      position = [clamp(pixel[0] + 44, left, right - card.width), top];
    }
    observationPopupOverlay.setPositioning("top-left");
    observationPopupOverlay.setOffset([position[0] - pixel[0], position[1] - pixel[1]]);
    observationPopupEl.style.overflow = "hidden";
    observationPopupEl.style.overscrollBehavior = "contain";
  }

  observationPopupContentEl.addEventListener("toggle", function () {
    if (observationPopupEl.style.display !== "none") syncObservationPopupPlacement();
  }, true);

  function openObservationPopup(feature) {
    const popupHtml = feature && feature.get("popupHtml");
    const coordinate = feature && feature.getGeometry() ? feature.getGeometry().getCoordinates() : null;
    if (!popupHtml || !coordinate) return;

    observationPopupEl._observationData = feature ? (feature.get("observationData") || feature.get("obsData") || null) : null;
    focusedObservationId = observationPopupEl._observationData?.id != null ? String(observationPopupEl._observationData.id) : null;
    observationMarkerSource.changed();
    observationPopupEl._bearEstimateData = feature ? (feature.get("bearEstimateData") || null) : null;
    observationPopupContentEl.innerHTML = popupHtml;
    observationPopupEl.style.visibility = "hidden";
    observationPopupEl.style.display = "flex";
    // Make the overlay parent visible before measuring its contents.
    observationPopupOverlay.setPosition(coordinate);
    syncObservationPopupPlacement(coordinate);
    observationPopupEl.style.visibility = "visible";
  }

  let bearListFocusVersion = 0;

  function closeObservationPopup() {
    bearListFocusVersion += 1;
    focusedObservationId = null;
    observationMarkerSource.changed();
    observationPopupEl.style.display = "none";
    observationPopupOverlay.setPosition(undefined);
    observationPopupEl._observationData = null;
    observationPopupEl._bearEstimateData = null;
  }

  // Let the whole date field open the native calendar when supported.
  document.addEventListener("click", function openListDatePicker(event) {
    const input = event.target;
    if (!input?.matches?.('.list-filter-dates input[type="date"], .list-filter-dates input[type="month"]') || input.disabled || input.readOnly) return;
    // Keep the platform picker; unsupported WebViews retain their default input behavior.
    try { input.showPicker?.(); } catch (_) { /* Native input behavior remains available. */ }
  });

  // Close details before external map tools act, including keyboard clicks.
  document.addEventListener("click", function dismissDetailForMapTool(event) {
    const target = event.target;
    if (!target?.closest || target.closest('.map-detail-popup')) return;
    if (target.closest('#btn-sdr-diagnostics, #btn-app-settings, #btn-map-layers, #map-layer-options, .map-right-controls, #compass, #btn-sidebar-toggle')) {
      closeObservationPopup();
    }
  }, true);

  function focusBearListItem(id, isRealtime, latlng) {
    closeObservationPopup();
    const focusVersion = bearListFocusVersion;
    view.cancelAnimations();
    flyToLatLng(latlng, 16, function (completed) {
      if (completed && focusVersion === bearListFocusVersion) {
        openBearListItemPopup(id, isRealtime);
      }
    });
  }

  function openBearListItemPopup(id, isRealtime) {
    const feature = bearMarkerSource.getFeatures().find(function (candidate) {
      const data = candidate.get("bearEstimateData");
      return data && String(data.id) === String(id) && !!data.isRealtime === isRealtime;
    });
    if (feature) openObservationPopup(feature);
  }

  map.on("moveend", function () {
    if (observationPopupEl.style.display !== "none") syncObservationPopupPlacement();
  });
  map.on("postrender", function () {
    if (observationPopupEl.style.display !== "none") syncObservationPopupPlacement();
  });
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(function () {
      if (observationPopupEl.style.display !== "none") syncObservationPopupPlacement();
    }).observe(observationPopupContentEl);
  }

  observationPopupCloseEl.addEventListener("click", function () {
    closeObservationPopup();
  });

  window.addEventListener("resize", function () {
    syncObservationPopupPlacement();
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", function () {
      syncObservationPopupPlacement();
    });
    window.visualViewport.addEventListener("scroll", function () { syncObservationPopupPlacement(); });
  }

  let mapGesturePointerId = null;
  let mapGestureMode = null; // null | coord-drag | heading-drag
  let mapGestureDidMove = false;
  let suppressManualPreviewAutoCenterUntil = 0;
  let suppressManualMapClickUntil = 0;
  const MAP_COORD_DRAG_HIT_RADIUS_PX = 46;
  const MAP_HEADING_DRAG_HIT_HANDLE_RADIUS_PX = 34;
  const MAP_HEADING_DRAG_HIT_LINE_HALF_WIDTH_PX = 18;

  function setMapDragPanEnabled(enabled) {
    if (!map || typeof map.getInteractions !== "function") return;
    if (!ol || !ol.interaction || !ol.interaction.DragPan) return;

    map.getInteractions().forEach(function (interaction) {
      if (interaction instanceof ol.interaction.DragPan) {
        interaction.setActive(!!enabled);
      }
    });
  }

  function getManualMarkerCenterPixel() {
    if (!Array.isArray(lastLatLng) || !Number.isFinite(lastLatLng[0]) || !Number.isFinite(lastLatLng[1])) return null;
    const centerCoord = mapCoordFromWgs84(lastLatLng[0], lastLatLng[1]);
    const centerPixel = map.getPixelFromCoordinate(centerCoord);
    return Array.isArray(centerPixel) ? centerPixel : null;
  }

  function pointToSegmentDistancePx(point, segStart, segEnd) {
    const vx = segEnd[0] - segStart[0];
    const vy = segEnd[1] - segStart[1];
    const wx = point[0] - segStart[0];
    const wy = point[1] - segStart[1];
    const c1 = vx * wx + vy * wy;
    if (c1 <= 0) {
      const dxStart = point[0] - segStart[0];
      const dyStart = point[1] - segStart[1];
      return Math.sqrt(dxStart * dxStart + dyStart * dyStart);
    }

    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) {
      const dxEnd = point[0] - segEnd[0];
      const dyEnd = point[1] - segEnd[1];
      return Math.sqrt(dxEnd * dxEnd + dyEnd * dyEnd);
    }

    const t = c1 / c2;
    const projX = segStart[0] + t * vx;
    const projY = segStart[1] + t * vy;
    const dx = point[0] - projX;
    const dy = point[1] - projY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function getManualHitType(event) {
    if (!obsRegisterModule) return false;
    if (controlsManager && typeof controlsManager.isMeasureModeActive === "function" && controlsManager.isMeasureModeActive()) return false;
    if (typeof obsRegisterModule.isManualMapControlEnabled !== "function") return false;
    if (!obsRegisterModule.isManualMapControlEnabled()) return false;
    if (!event || !Array.isArray(event.pixel)) return false;

    const centerPixel = getManualMarkerCenterPixel();
    if (!Array.isArray(centerPixel)) return false;
    const dx = event.pixel[0] - centerPixel[0];
    const dy = event.pixel[1] - centerPixel[1];
    const centerDistance = Math.sqrt(dx * dx + dy * dy);
    if (centerDistance <= MAP_COORD_DRAG_HIT_RADIUS_PX) return "center";

    const headingDeg = Number.isFinite(lastHeadingDeg) ? lastHeadingDeg : 0;
    const centerCoord = mapCoordFromWgs84(lastLatLng[0], lastLatLng[1]);
    const handlePixel = map.getPixelFromCoordinate(getHeadingHandleCoordinate(centerCoord, headingDeg));
    if (!Array.isArray(handlePixel)) return null;

    const dxHandle = event.pixel[0] - handlePixel[0];
    const dyHandle = event.pixel[1] - handlePixel[1];
    const handleDistance = Math.sqrt(dxHandle * dxHandle + dyHandle * dyHandle);
    if (handleDistance <= MAP_HEADING_DRAG_HIT_HANDLE_RADIUS_PX) return "heading";

    const lineDistance = pointToSegmentDistancePx(event.pixel, centerPixel, handlePixel);
    if (lineDistance <= MAP_HEADING_DRAG_HIT_LINE_HALF_WIDTH_PX) return "heading";

    return null;
  }

  function setCoordinateDragHighlight(active) {
    if (!myLocationFeature) return;
    myLocationFeature.set("isCoordinateDragActive", !!active);
    myLocationFeature.changed();
  }

  function stopManualMapGesture() {
    const hadActiveGesture = !!mapGestureMode;
    const movedDuringGesture = mapGestureDidMove;
    mapGesturePointerId = null;
    mapGestureMode = null;
    mapGestureDidMove = false;
    setCoordinateDragHighlight(false);
    setMapDragPanEnabled(true);

    if (hadActiveGesture && movedDuringGesture) {
      const now = Date.now();
      suppressManualPreviewAutoCenterUntil = now + 280;
      suppressManualMapClickUntil = now + 280;
    }
  }

  map.on("pointerdown", function (event) {
    stopManualMapGesture();
    if (event.activePointers?.length > 1 || (event.originalEvent?.altKey && event.originalEvent?.shiftKey)) return;
    const hitType = getManualHitType(event);
    if (!hitType) return;

    mapGesturePointerId = Number.isFinite(event.pointerId) ? event.pointerId : null;
    mapGestureDidMove = false;

    // 마커 조작 시작 시점부터 지도 팬을 잠가 충돌을 방지한다.
    setMapDragPanEnabled(false);

    if (hitType === "heading") {
      mapGestureMode = "heading-drag";
      if (event.originalEvent && typeof event.originalEvent.preventDefault === "function") {
        event.originalEvent.preventDefault();
      }
      return;
    }

    mapGestureMode = "coord-drag";
    setCoordinateDragHighlight(true);
    if (statusEl) statusEl.textContent = "🧲 드래그 또는 지도 위 터치하여 좌표 이동";
    if (event.originalEvent && typeof event.originalEvent.preventDefault === "function") {
      event.originalEvent.preventDefault();
    }
  });

  map.on("pointerdrag", function (event) {
    if (event.activePointers?.length > 1 || (event.originalEvent?.altKey && event.originalEvent?.shiftKey)) {
      stopManualMapGesture(); return;
    }
    if (mapGesturePointerId !== null && Number.isFinite(event.pointerId) && event.pointerId !== mapGesturePointerId) return;
    if (!mapGestureMode) return;

    if (!obsRegisterModule) {
      stopManualMapGesture();
      return;
    }

    const dragWgs84 = wgs84FromMapCoord(event.coordinate);
    if (!dragWgs84 || !Number.isFinite(dragWgs84.lat) || !Number.isFinite(dragWgs84.lng)) return;

    let applied = false;
    if (mapGestureMode === "heading-drag") {
      if (typeof obsRegisterModule.applyMapHeadingDegrees !== "function") {
        stopManualMapGesture();
        return;
      }
      if (!Array.isArray(lastLatLng) || !Number.isFinite(lastLatLng[0]) || !Number.isFinite(lastLatLng[1])) {
        stopManualMapGesture();
        return;
      }
      const headingDeg = computeBearingFromLatLng(lastLatLng, [dragWgs84.lat, dragWgs84.lng]);
      if (!Number.isFinite(headingDeg)) return;
      applied = obsRegisterModule.applyMapHeadingDegrees(headingDeg);
    } else if (mapGestureMode === "coord-drag") {
      if (typeof obsRegisterModule.applyMapClickCoordinate !== "function") {
        stopManualMapGesture();
        return;
      }
      applied = obsRegisterModule.applyMapClickCoordinate(dragWgs84.lat, dragWgs84.lng);
    }

    if (!applied) {
      stopManualMapGesture();
      return;
    }

    mapGestureDidMove = true;

    if (event.originalEvent && typeof event.originalEvent.preventDefault === "function") {
      event.originalEvent.preventDefault();
    }
  });

  map.on("pointerup", function () {
    stopManualMapGesture();
  });

  map.on("pointercancel", function () {
    stopManualMapGesture();
  });

  function forceResetManualMapGestureOnInterrupt() {
    if (!mapGestureMode && mapGesturePointerId === null) return;
    stopManualMapGesture();
  }

  // 푸시 알림/앱 전환 등으로 포인터 종료 이벤트가 누락될 수 있어 인터럽트 시 제스처 상태를 강제 해제한다.
  window.addEventListener("blur", function () {
    forceResetManualMapGestureOnInterrupt();
  });

  window.addEventListener("pagehide", function () {
    forceResetManualMapGestureOnInterrupt();
  });

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden") {
      forceResetManualMapGestureOnInterrupt();
    }
  });

  if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App && typeof window.Capacitor.Plugins.App.addListener === "function") {
    window.Capacitor.Plugins.App.addListener("appStateChange", function (state) {
      if (state && state.isActive === false) {
        forceResetManualMapGestureOnInterrupt();
      }
    });
  }

  map.on("singleclick", function (event) {
    if (Date.now() < suppressManualMapClickUntil) {
      return;
    }

    // 측정 모드가 클릭을 소비하면 관측점 팝업 클릭 로직은 실행하지 않는다.
    if (controlsManager && typeof controlsManager.consumeMapClick === "function" && controlsManager.consumeMapClick(event.coordinate)) {
      return;
    }

    let clickedPopupFeature = false;

    map.forEachFeatureAtPixel(event.pixel, function (feature, layer) {
      if (layer !== observationMarkerLayer && layer !== bearMarkerLayer && layer !== analysisEstimateLayer) {
        return undefined;
      }
      clickedPopupFeature = true;
      openObservationPopup(feature);
      return feature;
    }, {
      hitTolerance: 8
    });

    if (!clickedPopupFeature) {
      closeObservationPopup();
    }
  });

  // 왼쪽 클릭 좌표 로깅
  map.on("singleclick", function (event) {
    const coord = event.coordinate;
    const coordWgs84 = wgs84FromMapCoord(coord);
    const xText = Number.isFinite(coord[0]) ? coord[0].toFixed(2) : String(coord[0]);
    const yText = Number.isFinite(coord[1]) ? coord[1].toFixed(2) : String(coord[1]);
    const latText = coordWgs84 && Number.isFinite(coordWgs84.lat) ? coordWgs84.lat.toFixed(6) : "n/a";
    const lngText = coordWgs84 && Number.isFinite(coordWgs84.lng) ? coordWgs84.lng.toFixed(6) : "n/a";
    console.log("[Left Click] x=" + xText + " y=" + yText + " | lat=" + latText + " lng=" + lngText);
  });

  // 등록 팝업이 열려있고 GPS OFF 모드일 때 맵 클릭으로 좌표 입력
  map.on("singleclick", function (event) {
    if (controlsManager && typeof controlsManager.isMeasureModeActive === "function" && controlsManager.isMeasureModeActive()) {
      return;
    }

    if (!obsRegisterModule) return;
    if (typeof obsRegisterModule.applyMapClickCoordinate !== "function") return;

    const coordWgs84 = wgs84FromMapCoord(event.coordinate);
    if (!coordWgs84 || !Number.isFinite(coordWgs84.lat) || !Number.isFinite(coordWgs84.lng)) return;

    // GPS OFF 모드일 때만 작동 (applyMapClickCoordinate 내에서 검증)
    const applied = obsRegisterModule.applyMapClickCoordinate(coordWgs84.lat, coordWgs84.lng);
    if (applied) {
      console.log("[Map Click] 좌표 입력: lat=" + coordWgs84.lat.toFixed(6) + " lng=" + coordWgs84.lng.toFixed(6));
    }
  });


  // obsList.js 재사용을 위한 최소 Leaflet 호환 어댑터
  if (!window.L) window.L = {};
  if (!window.L.divIcon) {
    window.L.divIcon = function (options) {
      return { options: options || {} };
    };
  }
  if (!window.L.marker) {
    window.L.marker = function (latlng, options) {
      return {
        _latlng: latlng,
        _icon: options && options.icon ? options.icon : null,
        _feature: null,
        _popupHtml: "",
        obsData: null,
        bindPopup: function (html) {
          this._popupHtml = typeof html === "string" ? html : "";
          if (this._feature) {
            this._feature.set("popupHtml", this._popupHtml);
          }
          return this;
        },
        openPopup: function () {
          if (this._feature) {
            openObservationPopup(this._feature);
          }
          return this;
        },
        closePopup: function () {
          closeObservationPopup();
          return this;
        },
        setIcon: function (icon) {
          this._icon = icon;
          if (this._feature) {
            this._feature.setStyle(createObservationStyleFromMarker(this));
          }
        }
      };
    };
  }

  const olMapAdapter = {
    getZoom: function () {
      return view.getZoom() || 11;
    },
    on: function (eventName, handler) {
      if (eventName === "zoomend") {
        view.on("change:resolution", function () {
          handler();
        });
      }
    },
    closePopup: function () {
      closeObservationPopup();
    }
  };

  const observationMarkersLayer = {
    setVisible: function (visible) {
      observationMarkerLayer.setVisible(!!visible);
      if (!visible && observationPopupEl._observationData) closeObservationPopup();
    },
    animateMarkerToCoordinate: function (feature, fromLatLng, toLatLng) {
      if (!feature || !Array.isArray(fromLatLng) || !Array.isArray(toLatLng)) return;
      if (!Number.isFinite(Number(fromLatLng[0])) || !Number.isFinite(Number(fromLatLng[1]))) return;
      if (!Number.isFinite(Number(toLatLng[0])) || !Number.isFinite(Number(toLatLng[1]))) return;

      const fromCoord = mapCoordFromWgs84(Number(fromLatLng[0]), Number(fromLatLng[1]));
      const toCoord = mapCoordFromWgs84(Number(toLatLng[0]), Number(toLatLng[1]));
      const startTs = Date.now();
      const durationMs = 560;
      const lagMs = 90;

      feature.setGeometry(new ol.geom.Point(fromCoord));

      function tick() {
        if (!feature || !feature.getGeometry || !feature.getGeometry()) return;
        const elapsed = Date.now() - startTs - lagMs;
        if (elapsed < 0) {
          window.requestAnimationFrame(tick);
          return;
        }
        const progress = Math.max(0, Math.min(1, elapsed / durationMs));
        const eased = progress < 0.5
          ? 4 * progress * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 3) / 2;

        const currentCoord = [
          fromCoord[0] + (toCoord[0] - fromCoord[0]) * eased,
          fromCoord[1] + (toCoord[1] - fromCoord[1]) * eased
        ];

        feature.setGeometry(new ol.geom.Point(currentCoord));
        feature.changed();

        if (progress >= 1) return;
        window.requestAnimationFrame(tick);
      }

      window.requestAnimationFrame(tick);
    },
    clearLayers: function () {
      stopObservationSaveFlashAnimation();
      observationMarkerSource.clear();
    },
    addLayer: function (marker) {
      if (!marker || !Array.isArray(marker._latlng)) return;

      const coord = mapCoordFromWgs84(marker._latlng[0], marker._latlng[1]);
      const feature = new ol.Feature({ geometry: new ol.geom.Point(coord) });
      marker._feature = feature;
      feature.set("popupHtml", marker._popupHtml || "");
      feature.set("observationData", marker.obsData || null);
      feature.set("obsData", marker.obsData || null);
      const saveFlashUntil = Number(marker && marker.obsData ? marker.obsData._saveFlashUntil : marker._saveFlashUntil);
      const saveFlashPreset = String(marker && marker.obsData ? marker.obsData._saveFlashPreset : marker._saveFlashPreset || "").trim();
      feature.set("saveFlashUntil", Number.isFinite(saveFlashUntil) ? saveFlashUntil : 0);
      feature.set("saveFlashDurationMs", OBS_SAVE_FLASH_DURATION_MS);
      feature.set("saveFlashPreset", saveFlashPreset || "default");
      feature.setStyle(createObservationStyleFromMarker(marker));
      observationMarkerSource.addFeature(feature);

      if (Number(feature.get("saveFlashUntil")) > Date.now()) {
        startObservationSaveFlashAnimation();
      }

      if (Array.isArray(marker._animateFromLatLng)) {
        this.animateMarkerToCoordinate(feature, marker._animateFromLatLng, marker._latlng);
      }
    }
  };

  const observationMarkerLayer = new ol.layer.Vector({ source: observationMarkerSource });
  map.addLayer(observationMarkerLayer);

  function collapseBearEstimatePanel() {
    if (!panelEl || !btnPanelToggle) return;
    if (panelEl.classList.contains("collapsed")) return;

    panelEl.classList.add("collapsed");
    btnPanelToggle.textContent = "▲";
    btnPanelToggle.setAttribute("aria-expanded", "false");
  }

  function expandBearEstimatePanel() {
    if (!panelEl || !btnPanelToggle) return;
    panelEl.classList.remove("collapsed");
    btnPanelToggle.textContent = "▼";
    btnPanelToggle.setAttribute("aria-expanded", "true");
  }

  function ensureBearEstimatePanelVisible() {
    if (typeof expandBearEstimatePanel === "function") {
      expandBearEstimatePanel();
      return;
    }

    if (!panelEl || !btnPanelToggle) return;
    panelEl.classList.remove("collapsed");
    btnPanelToggle.textContent = "▼";
    btnPanelToggle.setAttribute("aria-expanded", "true");
  }

  // 큰 가로 화면에서는 공통 메뉴를 좌측 사이드바에 배치한다.
  function isTabletLandscapeSidebarMode() {
    return window.matchMedia(
      "(min-width: 900px) and (orientation: landscape)"
    ).matches;
  }

  // 태블릿 전용 레이아웃이 아닌, 소형 기기용 측정/목록 상호배타 규칙 대상을 판별한다.
  function isCompactPhoneMeasureLayout() {
    return !isTabletLandscapeSidebarMode() && window.matchMedia("(max-width: 899px)").matches;
  }

  // 태블릿 가로에서만 좌측 사이드바의 접힘 상태와 토글 버튼 표시를 동기화한다.
  function setTabletSidebarCollapsed(collapsed) {
    if (!document || !document.body) return;

    const isTablet = isTabletLandscapeSidebarMode();
    if (!isTablet) {
      document.body.classList.remove("bp-sidebar-collapsed");
    } else {
      document.body.classList.toggle("bp-sidebar-collapsed", !!collapsed);
    }

    if (btnSidebarToggle) {
      const isCollapsed = !!(document.body && document.body.classList.contains("bp-sidebar-collapsed"));
      btnSidebarToggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m14 7-5 5 5 5"/></svg>';
      btnSidebarToggle.setAttribute("aria-expanded", isCollapsed ? "false" : "true");
      btnSidebarToggle.setAttribute("aria-label", isCollapsed ? "사이드바 펼치기" : "사이드바 접기");
      btnSidebarToggle.setAttribute("title", isCollapsed ? "사이드바 펼치기" : "사이드바 접기");
    }

    // 사이드바 전환 중/완료 시점에 지도 크기를 재계산해 끊김을 줄인다.
    if (map && typeof map.updateSize === "function") {
      window.requestAnimationFrame(function () {
        map.updateSize();
      });
      window.setTimeout(function () {
        map.updateSize();
      }, 280);
    }
  }

  function setLocateButtonActive(active) {
    if (!locateBtnEl) return;
    locateBtnEl.setAttribute("aria-busy", "false");
    locateBtnEl.setAttribute("aria-pressed", String(!!active));
    if (!active) setTrackMode("off");
    else if (trackMode === "off") setTrackMode("follow", false);
  }

  // 목록과 팝업에서 공통으로 쓰는 관측점 수정 진입 경로를 묶는다.
  function openObservationEdit(item) {
    if (item && item.shareState === "sending") {
      statusEl.textContent = "전송 중인 관측점입니다.";
      return;
    }
    if (controlsManager && typeof controlsManager.deactivateMeasure === "function") {
      controlsManager.deactivateMeasure("menu");
    }
    setCurrentEditingObservationId(item && item.id ? item.id : null);
    closeObservationPopup();
    if (isTabletLandscapeSidebarMode()) {
      setTabletSidebarCollapsed(true);
      expandBearEstimatePanel();
    } else {
      collapseBearEstimatePanel();
    }
    if (item && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lng))) {
      setEditOriginMarker(Number(item.lat), Number(item.lng));
    } else {
      clearEditOriginMarker();
    }
    if (obsListModule && typeof obsListModule.hidePanel === "function") obsListModule.hidePanel();
    if (obsRegisterModule && typeof obsRegisterModule.openForEdit === "function") {
      obsRegisterModule.openForEdit(item);
    }
  }

  let obsListModule = null;
  const obsRegisterModule = window.createObsRegisterModule ? window.createObsRegisterModule({
    statusEl: statusEl,
    updateRegistrationPreview: updateRegistrationPreview,
    onGpsToggle: function() { toggleMyLocation(); }, // 등록 폼 GPS 토글 ↔ 하단 내위치 버튼 동기화
    onDefaultManualCoordinate: function () {
      var size = map.getSize();
      var extent = Array.isArray(size) && size.length >= 2 ? view.calculateExtent(size) : null;
      var targetCoord = Array.isArray(extent) && extent.length >= 4
        ? ol.extent.getCenter(extent)
        : view.getCenter();
      var targetWgs84 = wgs84FromMapCoord(targetCoord);

      if (!targetWgs84 || !Number.isFinite(targetWgs84.lat) || !Number.isFinite(targetWgs84.lng)) {
        return null;
      }

      return {
        lat: targetWgs84.lat,
        lng: targetWgs84.lng
      };
    },
    onManualPreview: function (payload) {
      if (!payload) {
        clearManualRegistrationPreview();
        return;
      }
      if (!payload || !Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) return;

      lastLatLng = [payload.lat, payload.lng];
      lastHeadingDeg = Number.isFinite(payload.heading) ? payload.heading : null;
      updateRegistrationPreview();

      const centerCoord = mapCoordFromWgs84(payload.lat, payload.lng);
      const manualFeature = ensureMyLocationFeature(centerCoord);
      if (manualFeature) {
        manualFeature.set("headingDeg", Number.isFinite(lastHeadingDeg) ? lastHeadingDeg : null);
        manualFeature.set("showHeadingHandle", true);
        manualFeature.changed();
      }

      if (payload.mode === "edit") {
        setEditOriginMarker(payload.lat, payload.lng);
      }

      if (payload.shouldFocus) {
        stopFollowing();
        view.setCenter(centerCoord);
      }
    },
    onObservationSaved: async function (payload) {
      if (!obsListModule || !payload || !payload.observation) return;
      // SQLite 재조회로 렌더 데이터가 교체되어도 저장 직후 하이라이트가 유지되도록 먼저 기록한다.
      if (typeof obsListModule.markObservationFlash === "function") {
        obsListModule.markObservationFlash(payload.observation.id);
      }
      window.BearMobileDock?.showObservationsAfterSave();

      if (payload.mode === "edit") {
        setCurrentEditingObservationId(null);
        clearEditOriginMarker();
        if (typeof obsListModule.updateObservation === "function") {
          obsListModule.updateObservation(payload.observation);
        }
        if (payload.source === "sqlite") {
          await obsListModule.refreshObservationList({localOnly:true});
        }
        setTabletSidebarCollapsed(false);
        // 수정 완료 후 목록 패널 복원
        if (typeof obsListModule.showPanel === "function") obsListModule.showPanel();
        return;
      }

      // 등록 완료 후 목록 패널 복원 및 새 데이터 반영
      setTabletSidebarCollapsed(false);
      obsListModule.openList();
      if (payload.source === "sqlite") {
        await obsListModule.refreshObservationList({localOnly:true});
      } else {
        obsListModule.addObservation(payload.observation);
      }
    },
    onClose: function () {
      setCurrentEditingObservationId(null);
      clearEditOriginMarker();
      setTabletSidebarCollapsed(false);
      // X 버튼 및 취소 시 목록 패널 복원
      if (obsListModule && typeof obsListModule.showPanel === "function") obsListModule.showPanel();
    }
  }) : null;

  // 내 위치 피처를 갱신하고 최초 1회만 현재 위치로 카메라를 이동한다.
  function updateMyLocation(lat, lng) {
    const coord = mapCoordFromWgs84(lat, lng);
    lastLatLng = [lat, lng];
    lastTrackedLatLng = [lat, lng];
    lastGpsTimestamp = Date.now();
    const feature = ensureMyLocationFeature(coord);
    if (feature) {
      feature.set("showHeadingHandle", false);
    }

    updateRegistrationPreview();

    if (lastHeadingDeg !== null) {
      setHeading(lastHeadingDeg);
    } else if (canUseGpsHeading()) {
      setHeading(lastGpsHeadingDeg);
    }

    if (obsRegisterModule) {
      obsRegisterModule.updateLiveData({
        lat: lat,
        lng: lng,
        heading: lastHeadingDeg,
        timestamp: lastGpsTimestamp,
        isGpsActive: true
      });
    }

    if (!didMoveToMe) {
      didMoveToMe = true;
      view.animate({ center: coord, zoom: Math.max(16, view.getZoom() || 11), duration: 650 });
    } else if (trackMode === "heading") {
      headingTargetCenter = coord; // 회전 루프가 위치도 함께 부드럽게 옮긴다.
      scheduleHeadingTurn();
    } else if (trackMode === "follow" && !view.getAnimating() && !view.getInteracting()) {
      view.animate({ center: coord, duration: 300 });
    }
  }

  function stopMyLocationTracking(showStatus) {
    myLocationGeneration += 1;
    myLocationStarting = false;
    stopCompass();
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    myLocationSource.clear();
    myLocationFeature = null;
    isMyVisible = false;
    didMoveToMe = false;
    lastLatLng = null;
    lastTrackedLatLng = null;
    lastGpsTimestamp = null;
    lastHeadingDeg = null;
    lastTrackedHeadingDeg = null;
    lastGpsHeadingDeg = null;
    lastGpsSpeedMps = null;
    lastGpsHeadingTs = 0;
    lastGpsSampleLatLng = null;
    lastGpsSampleTs = 0;
    setLocateButtonActive(false);
    updateRegistrationPreview();

    if (obsRegisterModule) {
      obsRegisterModule.updateLiveData({
        lat: null,
        lng: null,
        heading: null,
        timestamp: null,
        isGpsActive: false
      });
    }

  }

  // 캡처/시연용 고정 위치 모드.
  // true 로 바꾸면 "실시간 위치" 버튼이 GPS 대신 아래 좌표를 사용한다.
  const USE_CAPTURE_MOCK_LOCATION = false;
  const CAPTURE_MOCK_LAT_LNG = [35.323541, 127.636556]; // 지리산 샘플 좌표

  // 위치 추적 시작: 빠른 1회 획득 + watchPosition 지속 추적.
  async function startMyLocationTracking() {
    const generation = ++myLocationGeneration;
    myLocationStarting = true;
    if (USE_CAPTURE_MOCK_LOCATION) {
      isMyVisible = true;
      updateMyLocation(CAPTURE_MOCK_LAT_LNG[0], CAPTURE_MOCK_LAT_LNG[1]);
      myLocationStarting = false;
      setLocateButtonActive(true);
      return;
    }

    if (!navigator.geolocation) {
      myLocationStarting = false;
      if (statusEl) statusEl.textContent = "🔴 위치 기능 미지원 브라우저";
      return;
    }

    // A failed orientation sensor must not prevent acquiring a GPS position.
    void startCompass().then(function () {
      if (generation !== myLocationGeneration && !myLocationStarting && watchId === null) stopCompass();
    }).catch(function (error) { console.warn("나침반 시작 실패:", error); });
    if (locateBtnEl) {
      locateBtnEl.setAttribute("aria-busy", "true");
      locateBtnEl.title = "현재 위치 수신 중 · 다시 누르면 취소";
    }

    const optsFast = { enableHighAccuracy: false, timeout: 30000, maximumAge: 15000 };
    const optsWatch = { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 };

    const onPosition = function (pos) {
      if (generation !== myLocationGeneration) return;
      if (!Number.isFinite(pos?.coords?.latitude) || !Number.isFinite(pos?.coords?.longitude)) return;
      isMyVisible = true;
      myLocationStarting = false;
      updateGpsHeadingSample(pos.coords);
      updateMyLocation(pos.coords.latitude, pos.coords.longitude);
      setLocateButtonActive(true);
    };
    try {
      navigator.geolocation.getCurrentPosition(onPosition, function () {
        // The continuous request can recover when the initial fix fails.
      }, optsFast);
      watchId = navigator.geolocation.watchPosition(onPosition, function (err) {
        if (generation !== myLocationGeneration) return;
        if (err.code === 1) {
          stopMyLocationTracking(false);
          if (statusEl) statusEl.textContent = "위치 권한이 없습니다. 기기 설정에서 BearMap의 위치 권한을 허용해주세요.";
          return;
        }
        // TIMEOUT/POSITION_UNAVAILABLE can be temporary. Keep the watch and last fix.
        if (locateBtnEl) {
          locateBtnEl.setAttribute("aria-busy", "true");
          locateBtnEl.title = "위치 수신 대기 · 기기의 위치 기능을 확인해주세요";
        }
        const text = "위치 수신 대기 중입니다. 기기의 위치 기능과 GPS 수신 상태를 확인해주세요.";
        if (statusEl && statusEl.textContent !== text) statusEl.textContent = text;
      }, optsWatch);
    } catch (error) {
      if (generation !== myLocationGeneration) return;
      stopMyLocationTracking(false);
      if (statusEl) statusEl.textContent = "위치를 시작하지 못했습니다: " + error.message;
    }
  }

  async function toggleMyLocation() {
    if (myLocationStarting || isMyVisible || watchId !== null) {
      stopMyLocationTracking(true);
      return;
    }
    await startMyLocationTracking();
  }

  // 웹 환경(SQLite 미지원)에서는 bear_estimates와 유사한 JSON 행 구조를 폴백으로 사용한다.
  async function loadBearsData() {
    try {
      const res = await fetch("json/bears.json", { cache: "no-store" });
      const data = await res.json();
      bearsDataCache = Array.isArray(data) ? data : [];
    } catch (e) {
      console.error("bears.json 로드 실패:", e);
      bearsDataCache = [];
    }
  }

  function parseBearEstimateJson(value, expectedType) {
    try {
      const parsed = typeof value === "string" ? JSON.parse(value) : value;
      if (expectedType === "array") return Array.isArray(parsed) ? parsed : null;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  // 기존 자료는 원본 관측 개수로 판별한다.
  function getEstimationMethodLabel(item) {
    if (item?.estimation_method === "single") return "\uB2E8\uC77C \uAD00\uCE21";
    if (item?.estimation_method === "intersection") return "\uAD50\uCC28 \uBD84\uC11D";
    const options = normalizeAnalysisOptions(item && (item.analysis_options || item.analysis_options_json || item.analysisOptions || item.options));
    if (options?.estimationMethod === "single") return "단일 관측";
    if (options?.estimationMethod === "intersection") return "교차 분석";
    const sources = parseBearEstimateJson(item && (item.source_observations || item.source_observations_json || item.sourceObservations), "array");
    if (sources?.length === 1) return "단일 관측";
    if (sources?.length > 1 || Number(item?.intersections_count) > 0) return "교차 분석";
    return "미기록";
  }

  function buildEstimationMethodHtml(item) {
    const label = getEstimationMethodLabel(item);
    const method = label === "단일 관측" ? "single" : label === "교차 분석" ? "intersection" : "unknown";
    return '<span class="estimate-method estimate-method--' + method + '">' + label + '</span>';
  }

  function normalizeAnalysisOptions(value) {
    const options = parseBearEstimateJson(value, "object");
    if (!options) return null;
    const { spreadToleranceM, ...activeOptions } = options;
    return activeOptions;
  }

  // 웹 환경에서 bears.json 더미 데이터를 곰 추적위치 목록 형식으로 정규화한다.
  function getWebFallbackBearEstimates() {
    if (!Array.isArray(bearsDataCache) || !bearsDataCache.length) return [];

    return bearsDataCache.filter(function (row) {
      return row && Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lng));
    }).map(function (row, index) {
      return {
        id: row.id || ("web-bear-" + index),
        bear_code: String(row.bear_code || row.bearCode || "-").trim() || "-",
        owner: normalizeOwnerName(row.owner) || "미지정",
        place: normalizePlaceName(row.place) || "미지정",
        admin_region: row.admin_region || row.adminRegion || null,
        lat: Number(row.lat),
        lng: Number(row.lng),
        lat_dms: row.lat_dms || null,
        lng_dms: row.lng_dms || null,
        intersections_count: Number.isFinite(Number(row.intersections_count)) ? Number(row.intersections_count) : null,
        created_at: row.created_at || null,
        source_observation_ids: row.source_observation_ids || null,
        source_observations: parseBearEstimateJson(row.source_observations, "array"),
        analysis_options: normalizeAnalysisOptions(row.analysis_options),
        analysis_rays: parseBearEstimateJson(row.analysis_rays, "array"),
        analysis_intersections: parseBearEstimateJson(row.analysis_intersections, "array")
      };
    });
  }

  // 현재 목록에 없는 선택 ID를 정리한다.
  function syncSelectedBearEstimateIds(items) {
    const validIds = new Set((items || []).map(function (it) { return String(it.id); }));
    Array.from(selectedBearEstimateIds).forEach(function (id) {
      if (!validIds.has(String(id))) selectedBearEstimateIds.delete(String(id));
    });
  }

  // 곰 추적위치 목록 개수와 선택 개수에 맞춰 상단 툴바 상태를 갱신한다.
  function updateBearEstimateToolbar(items) {
    const list = Array.isArray(items) ? items : [];
    const totalCount = list.length;
    const selectedCount = list.reduce(function (count, it) {
      return count + (selectedBearEstimateIds.has(String(it.id)) ? 1 : 0);
    }, 0);

    if (bearsToolbarEl) {
      bearsToolbarEl.classList.toggle("is-idle", selectedCount === 0);
    }

    if (bearsSelectionCountEl) {
      bearsSelectionCountEl.textContent = selectedCount + " / " + totalCount + " 선택";
    }

    if (bearsSelectAllEl) {
      bearsSelectAllEl.disabled = totalCount === 0;
      bearsSelectAllEl.checked = totalCount > 0 && selectedCount === totalCount;
      bearsSelectAllEl.indeterminate = selectedCount > 0 && selectedCount < totalCount;
    }

    if (btnBearsDownloadAllXlsEl) {
      btnBearsDownloadAllXlsEl.disabled = totalCount === 0;
    }

    const eligible = list.filter(it => selectedBearEstimateIds.has(String(it.id)) && canModifyUnsharedBearEstimate(it)).length;
    if (btnBearsUploadSelectedEl) {
      btnBearsUploadSelectedEl.disabled = eligible === 0;
      btnBearsUploadSelectedEl.hidden = eligible === 0;
      btnBearsUploadSelectedEl.title = "미공유 " + eligible + "건 공유";
    }
    if (btnBearsDeleteUnsharedEl) {
      btnBearsDeleteUnsharedEl.hidden = eligible === 0;
      btnBearsDeleteUnsharedEl.disabled = eligible === 0;
      btnBearsDeleteUnsharedEl.textContent = "선택 삭제 " + eligible + "건";
    }
  }

  async function confirmRealtimeUpload(message, detail) {
    const ok = await showStyledConfirmDialog({
      title: "실시간 목록 업로드",
      message: String(message || "실시간 목록에 업로드 하시겠습니까?"),
      detail: String(detail || ""),
      confirmText: "업로드",
      cancelText: "취소"
    });

    return !!ok;
  }

  async function markBearEstimatesShared(ids) {
    const idSet = new Set((Array.isArray(ids) ? ids : []).filter(Boolean).map(String));
    if (!idSet.size) return;
    const sharedAt = getKstSqliteTimestamp();
    await localEstimateStore.markShared([...idSet], sharedAt);
    for (const item of localBearEstimateItems) {
      if (idSet.has(String(item.id))) {
        item.shared_at ||= sharedAt;
        item.share_pending = 0;
      }
    }
    repaintUnifiedBearList();
  }

  reconcileSharedBearEstimates = async function () {
    if (sharedStatusSyncInProgress || !remoteSharedEstimateIds.size || !localBearEstimateItems.length) return;
    const missingIds = localBearEstimateItems.filter(function (item) {
      return !item.shared_at && remoteSharedEstimateIds.has(String(item.id));
    }).map(function (item) { return String(item.id); });
    if (!missingIds.length) return;
    sharedStatusSyncInProgress = true;
    try {
      await markBearEstimatesShared(missingIds);
    } catch (error) {
      console.warn("[bear_estimates] 공유 이력 동기화 실패:", error);
    } finally {
      sharedStatusSyncInProgress = false;
    }
  };

  function canModifyUnsharedBearEstimate(item) {
    const id = String(item.id);
    return !item.shared_at && !item.remoteOnly && !item.isRealtime
      && !remoteSharedEstimateIds.has(id) && !pendingBearUploads.has(id) && !pendingBearDeletions.has(id);
  }

  async function uploadUnsharedBearEstimates(targets, { automatic = false } = {}) {
    if (!realtimeListModule) return;
    const eligible = targets.filter(item => canModifyUnsharedBearEstimate(item) && (!automatic || Number(item.share_pending) === 1));
    if (!eligible.length) return;
    if (!automatic && !await confirmRealtimeUpload("미공유 추적위치 " + eligible.length + "건을 공유할까요?", "")) return;
    const requestedIds = new Set(eligible.map(item => String(item.id)));
    const reserved = currentBearEstimateItems.filter(it => requestedIds.has(String(it.id)) && canModifyUnsharedBearEstimate(it));
    if (!reserved.length) return;
    if (automatic) reserved.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    reserved.forEach(it => pendingBearUploads.add(String(it.id)));
    repaintUnifiedBearList();
    let count = 0, failed = 0;
    try {
      // Check previous receipts before retrying an upload whose response may have been lost.
      if (!automatic) {
        const refreshed = await realtimeListModule.refresh({ silent: true });
        if (!refreshed.ok) throw new Error(refreshed.message);
      }
      for (const item of reserved) {
        const latest = currentBearEstimateItems.find(row => String(row.id) === String(item.id));
        if (!latest || latest.shared_at || remoteSharedEstimateIds.has(String(item.id))) continue;
        const { share_pending, ...payload } = latest;
        const result = await realtimeListModule.sendEstimate(payload, { silent: automatic });
        if (result && result.ok) {
          count++;
          await markBearEstimatesShared([item.id]);
        } else failed++;
      }
      if (!automatic && statusEl) statusEl.textContent = count + "건 공유 완료" + (failed ? ", " + failed + "건 공유 실패 (다시 시도 가능)" : "");
    } catch (error) {
      if (!automatic && statusEl) statusEl.textContent = "공유하지 못했습니다. 다시 시도해주세요: " + (error.message || error);
    } finally {
      reserved.forEach(it => pendingBearUploads.delete(String(it.id)));
      repaintUnifiedBearList();
    }
  }

  async function handleUploadSelectedBearEstimates() {
    await uploadUnsharedBearEstimates(currentBearEstimateItems.filter(it => selectedBearEstimateIds.has(String(it.id))));
  }

  async function deleteSelectedUnsharedBearEstimates() {
    const requestedIds = new Set(currentBearEstimateItems
      .filter(it => selectedBearEstimateIds.has(String(it.id)) && canModifyUnsharedBearEstimate(it))
      .map(it => String(it.id)));
    if (!requestedIds.size) return;

    const confirmed = await showStyledConfirmDialog({
      title: "미공유 추적위치 삭제",
      message: "선택한 미공유 추적위치 " + requestedIds.size + "건을 이 기기에서 삭제할까요?",
      detail: "이 작업은 되돌릴 수 없습니다.",
      confirmText: "삭제",
      cancelText: "취소",
      tone: "danger"
    });
    if (!confirmed) return;

    const ids = currentBearEstimateItems
      .filter(it => requestedIds.has(String(it.id)) && canModifyUnsharedBearEstimate(it))
      .map(it => String(it.id));
    if (!ids.length) return;
    ids.forEach(id => pendingBearDeletions.add(id));
    try {
      const removed = await localEstimateStore.removeUnshared(ids);
      ids.forEach(id => selectedBearEstimateIds.delete(id));
      await refreshBearEstimatePanel();
      if (statusEl) statusEl.textContent = "미공유 추적위치 " + removed + "건을 삭제했습니다.";
    } catch (error) {
      if (statusEl) statusEl.textContent = "미공유 추적위치 삭제에 실패했습니다: " + (error.message || error);
    } finally {
      ids.forEach(id => pendingBearDeletions.delete(id));
      repaintUnifiedBearList();
    }
  }

  async function downloadAllBearEstimatesXls(items) {
    const list = (Array.isArray(items) ? items : []).filter(function (it) {
      return it && Number.isFinite(Number(it.lat)) && Number.isFinite(Number(it.lng));
    });

    if (!list.length) {
      if (statusEl) statusEl.textContent = "🟠 다운로드할 곰 추적위치 목록이 없습니다";
      return;
    }

    const xlsRows = [["등록일자", "지명", "위치", "위치추적담당자", "X좌표(TM)", "Y좌표(TM)", "추적위치(위도 DMS)", "추적위치(경도 DMS)", "추적위치(위도)", "추적위치(경도)"]];

    list.forEach(function (it) {
      const lat = Number(it.lat);
      const lng = Number(it.lng);
      const latDms = it.lat_dms || decimalToDMS(lat, false);
      const lngDms = it.lng_dms || decimalToDMS(lng, true);
      const legacyProjected = legacyTmCoordFromWgs84(lat, lng);
      const mapX = Array.isArray(legacyProjected) && Number.isFinite(legacyProjected[0]) ? legacyProjected[0].toFixed(3) : "-";
      const mapY = Array.isArray(legacyProjected) && Number.isFinite(legacyProjected[1]) ? legacyProjected[1].toFixed(3) : "-";
      const timeLabel = formatKstDateTimeLabel(it.created_at || it.ts);
      const ownerName = normalizeOwnerName(it.owner) || "미지정";
      const placeName = normalizePlaceName(it.place) || "미지정";

      xlsRows.push([timeLabel, placeName, it.admin_region || it.adminRegion || "", ownerName, mapX, mapY, latDms, lngDms, lat, lng]);
    });

    const nowParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).formatToParts(new Date());
    const timeMap = {};
    nowParts.forEach(function (p) {
      if (p && p.type && p.type !== "literal") timeMap[p.type] = p.value;
    });
    const safeTime = [timeMap.year, timeMap.month, timeMap.day].join("-") + "_" + [timeMap.hour, timeMap.minute, timeMap.second].join("-");
    const fileName = "bear_estimates_all_" + safeTime + ".xlsx";

    if (isNativeCapacitorPlatform()) {
      let savedFile = null;

      async function ensureSavedFile() {
        if (savedFile) return savedFile;
        savedFile = await saveXlsToNativeDocuments(fileName, xlsRows);
        return savedFile;
      }

      try {
        await showSavedXlsPreviewPopup({
          fileName: fileName,
          previewHtml: buildXlsPreviewHtml(xlsRows),
          onSave: async function () {
            const saved = await ensureSavedFile();
            return saved;
          },
          onShare: async function () {
            const saved = await saveXlsToNativeDocuments(fileName, xlsRows);
            if (!saved) return;
            await shareSavedXlsFile(fileName, saved && saved.savedUri ? saved.savedUri : undefined, xlsRows);
          }
        });
      } catch (error) {
        console.error("일괄 XLS 저장/공유 오류:", error);
        if (statusEl) {
          statusEl.textContent = "🔴 일괄 XLS 처리 실패: " + (error && error.message ? error.message : String(error));
        }
      }
      return;
    }

    async function saveWebXls() {
      const XLSX = await loadSheetJS();
      const workbook = buildXlsWorkbook(XLSX, xlsRows, "곰추정위치목록");
      const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      if (statusEl) statusEl.textContent = "✅ 일괄 XLS 다운로드 시작: " + fileName;
    }

    try {
      await showSavedXlsPreviewPopup({
        fileName: fileName,
        previewHtml: buildXlsPreviewHtml(xlsRows),
        onSave: saveWebXls
      });
    } catch (error) {
      console.error("일괄 XLS 생성 오류:", error);
      if (statusEl) {
        statusEl.textContent = "🔴 일괄 XLS 생성 실패: " + (error && error.message ? error.message : String(error));
      }
    }
  }

  if (bearsSelectAllEl) {
    bearsSelectAllEl.addEventListener("change", function () {
      selectedBearEstimateIds.clear();
      if (bearsSelectAllEl.checked) {
        getFilteredBearEstimates().forEach(function (it) {
          selectedBearEstimateIds.add(String(it.id));
        });
      }
      renderBears(currentBearEstimateItems, currentBearEstimateFallbackMode);
    });
  }

  function bearMyOwner() {
    const owner = window.BearAppSettings?.getProfile?.()?.owner;
    if (owner) return String(owner).trim();
    try { return String(window.localStorage.getItem('bearpoint.lastRegisteredOwner') || '').trim(); }
    catch (_) { return ''; }
  }
  function syncBearMineShortcut() {
    if (!btnBearMineEl) return;
    const owner = bearMyOwner();
    btnBearMineEl.disabled = !owner;
    btnBearMineEl.setAttribute('aria-pressed', String(!!owner && String(bearCodeSearchEl?.value || '').trim() === owner));
    btnBearMineEl.title = owner ? '내 담당자: ' + owner : '담당자를 설정하거나 관측점을 등록해주세요.';
  }
  btnBearMineEl?.addEventListener('click', function () {
    const owner = bearMyOwner();
    if (!owner || !bearCodeSearchEl) return;
    bearCodeSearchEl.value = bearCodeSearchEl.value.trim() === owner ? '' : owner;
    applyBearCodeSearch();
  });
  window.addEventListener('bearpoint:profile-changed', syncBearMineShortcut);

  function applyBearCodeSearch() {
    repaintUnifiedBearList();
  }
  function syncBearFilterControls() {
    syncBearMineShortcut();
    const teams = new Map();
    for (const item of currentBearEstimateItems) {
      teams.set(String(item.team_id || item.team_name || "미지정"), String(item.team_name || item.team_id || "미지정"));
    }
    for (const [select, options, label] of [[bearTeamFilterEl, teams, "전체 팀"]]) {
      if (!select) continue;
      const selected = select.value;
      if (selected && !options.has(selected)) options.set(selected, select.selectedOptions[0]?.textContent || selected);
      const entries = [...options].sort((a, b) => a[1].localeCompare(b[1], "ko"));
      const signature = JSON.stringify(entries);
      if (select.dataset.options !== signature) {
        select.innerHTML = '<option value="">' + label + '</option>' +
          entries.map(([value, name]) => '<option value="' + escapeHtml(value) + '">' + escapeHtml(name) + '</option>').join("");
        select.value = selected;
        select.dataset.options = signature;
      }
    }
    const today = window.BearObservationFilters.dateKey(new Date());
    const period = bearPeriodFilterEl?.value || "all";
    const datesRow = document.getElementById("bear-filter-dates");
    if (bearRangeFilterEl) bearRangeFilterEl.hidden = period !== "range";
    if (datesRow) datesRow.hidden = !["day", "month", "year", "range"].includes(period);
    for (const [element, mode, initial] of [[bearDayFilterEl, "day", today], [bearMonthFilterEl, "month", today.slice(0, 7)], [bearYearFilterEl, "year", today.slice(0, 4)], [bearStartFilterEl, "range", today], [bearEndFilterEl, "range", today]]) {
      if (!element) continue;
      element.hidden = period !== mode;
      if (!element.dataset.initialized) { element.value = initial; element.dataset.initialized = "true"; }
    }
    const invalid = window.BearObservationFilters.periodKey(readBearPeriodFilter()) === null;
    if (bearFilterErrorEl) {
      bearFilterErrorEl.hidden = !invalid;
      bearFilterErrorEl.textContent = invalid ? (period === "range" ? "시작일과 종료일을 올바른 순서로 선택해주세요." : "조회할 날짜를 선택하거나 올바른 연도를 입력해주세요.") : "";
    }
    const count = Number(!!bearTeamFilterEl?.value) + Number(period !== "all");
    btnBearFilterEl?.classList.toggle("has-filters", count > 0);
    if (bearFilterCountEl) { bearFilterCountEl.hidden = count === 0; bearFilterCountEl.textContent = String(count); }
    if (btnBearCodeClearEl) btnBearCodeClearEl.disabled = !String(bearCodeSearchEl?.value || "").trim() && count === 0;
  }
  if (btnBearFilterEl) btnBearFilterEl.addEventListener("click", () => {
    bearFilterPanelEl.hidden = !bearFilterPanelEl.hidden;
    btnBearFilterEl.setAttribute("aria-expanded", String(!bearFilterPanelEl.hidden));
  });
  for (const select of [bearTeamFilterEl, bearPeriodFilterEl]) select?.addEventListener("change", applyBearCodeSearch);
  for (const input of [bearDayFilterEl, bearMonthFilterEl, bearYearFilterEl, bearStartFilterEl, bearEndFilterEl]) input?.addEventListener("input", applyBearCodeSearch);
  if (bearCodeSearchEl) bearCodeSearchEl.addEventListener("input", applyBearCodeSearch);
  if (bearCodeSearchFormEl) bearCodeSearchFormEl.addEventListener("submit", function (event) {
    event.preventDefault();
    applyBearCodeSearch();
    bearCodeSearchEl?.blur();
  });
  if (btnBearCodeClearEl) btnBearCodeClearEl.addEventListener("click", function () {
    bearCodeSearchEl.value = "";
    if (bearTeamFilterEl) bearTeamFilterEl.value = "";
    if (bearPeriodFilterEl) bearPeriodFilterEl.value = "all";
    const today = window.BearObservationFilters.dateKey(new Date());
    if (bearDayFilterEl) bearDayFilterEl.value = today;
    if (bearMonthFilterEl) bearMonthFilterEl.value = today.slice(0, 7);
    if (bearYearFilterEl) bearYearFilterEl.value = today.slice(0, 4);
    if (bearFilterPanelEl) bearFilterPanelEl.hidden = true;
    btnBearFilterEl?.setAttribute("aria-expanded", "false");
    applyBearCodeSearch();
    bearCodeSearchEl.focus();
  });

  const btnBearsRefresh = document.getElementById("btn-bears-refresh");
  let bearRefreshInProgress = false, lastBearRetry = 0;
  async function refreshUnifiedBearList(options) {
    if (bearRefreshInProgress) return;
    const retry = options?.retry !== false;
    if (retry) lastBearRetry = Date.now();
    bearRefreshInProgress = true;
    if (btnBearsRefresh) btnBearsRefresh.disabled = true;
    try {
      await refreshBearEstimatePanel();
      if (realtimeListModule && navigator.onLine !== false) {
        const result = await realtimeListModule.refresh({ silent: !!options?.silent });
        if (result.ok && retry) {
          await uploadUnsharedBearEstimates(currentBearEstimateItems, { automatic: true });
        }
      }
    } catch (error) {
      console.warn("[bear_estimates] refresh failed", error);
    } finally {
      bearRefreshInProgress = false;
      if (btnBearsRefresh) btnBearsRefresh.disabled = false;
    }
  }
  if (btnBearsRefresh) btnBearsRefresh.addEventListener("click", () => refreshUnifiedBearList({ retry: false }));
  function refreshVisibleBearList(forceRetry = false) {
    if (document.hidden || navigator.onLine === false) return;
    const retry = forceRetry || Date.now() - lastBearRetry >= 30000;
    const dock = window.BearMobileDock;
    const listVisible = panelEl?.getClientRects().length && !panelEl.classList.contains("collapsed") &&
      (!dock?.isDocked() || dock.getActive() === "bears");
    const hasPending = currentBearEstimateItems.some(item => Number(item.share_pending) === 1);
    if (listVisible || (retry && (forceRetry || hasPending))) void refreshUnifiedBearList({ silent: true, retry });
  }
  window.addEventListener("online", () => refreshVisibleBearList(true));
  document.addEventListener("visibilitychange", () => refreshVisibleBearList(true));
  window.setInterval(refreshVisibleBearList, 15000);

  if (btnBearsDownloadAllXlsEl) {
    btnBearsDownloadAllXlsEl.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      downloadAllBearEstimatesXls(getFilteredBearEstimates());
    });
  }

  if (btnBearsUploadSelectedEl) {
    btnBearsUploadSelectedEl.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      handleUploadSelectedBearEstimates();
    });
  }

  if (btnBearsDeleteUnsharedEl) {
    btnBearsDeleteUnsharedEl.addEventListener("click", () => { void deleteSelectedUnsharedBearEstimates(); });
  }

  function bearTeamColor(item) {
    return /^#[0-9a-f]{6}$/i.test(String(item?.team_color || "")) ? item.team_color : "#7e90a2";
  }
  function bearTeamTint(color, opacity) {
    return `rgba(${parseInt(color.slice(1,3),16)},${parseInt(color.slice(3,5),16)},${parseInt(color.slice(5,7),16)},${opacity})`;
  }
  // 저장된 곰 추적위치 목록을 지도 마커로 렌더링하고, 클릭용 상세 팝업 HTML도 함께 싣는다.
  function renderBearMarkers(items) {
    bearMarkerSource.clear();
    if (!items || !items.length) {
      stopBearMarkerAnimation();
      return;
    }

    let hasAnimatedMarker = false;

    items.slice().reverse().forEach(function (it) {
      const isRealtimeMarker = !!(it && it.isRealtime);
      const shouldAnimate = isRealtimeMarker || !!(it && it.shared_at);
      if (shouldAnimate) hasAnimatedMarker = true;
      const markerText = String(it && (it.bear_code || it.bearCode || it.id) || "-");
      const teamColor = bearTeamColor(it);
      const labelColor = bearTeamTint(teamColor,0.95);

      const feature = new ol.Feature({
        geometry: new ol.geom.Point(mapCoordFromWgs84(it.lat, it.lng))
      });
      feature.set("popupHtml", buildBearEstimatePopupHtml(it));
      feature.set("bearEstimateData", it);
      feature.set("isRealtimeMarker", isRealtimeMarker);

      const markerIconStyle = new ol.style.Style({
        image: new ol.style.Icon({
          src: "css/svg/bear_marker_point.svg",
          anchor: [0.5, 1],
          width: 34,
          height: 34
        }),
        text: new ol.style.Text({
          text: markerText,
          offsetY: BEAR_LABEL_OFFSET_Y,
          font: "600 11px sans-serif",
          fill: new ol.style.Fill({ color: "#ffffff" }),
          backgroundFill: new ol.style.Fill({ color: labelColor }),
          padding: [2, 5, 2, 5]
        })
      });

      if (shouldAnimate) {
        const pulseOuterStyle = new ol.style.Style({
          image: new ol.style.Circle({
            radius: 17,
            fill: new ol.style.Fill({ color: bearTeamTint(teamColor,0.08) }),
            stroke: new ol.style.Stroke({ color: bearTeamTint(teamColor,0.32), width: 2 })
          })
        });

        const pulseInnerStyle = new ol.style.Style({
          image: new ol.style.Circle({
            radius: 12,
            fill: new ol.style.Fill({ color: "rgba(255,255,255,0.18)" }),
            stroke: new ol.style.Stroke({ color: bearTeamTint(teamColor,0.8), width: 2.5 })
          })
        });

        feature.setStyle(function () {
          pulseOuterStyle.setImage(new ol.style.Circle({
            radius: 17 + realtimeBearMarkerPulse * 8,
            fill: new ol.style.Fill({ color: bearTeamTint(teamColor,0.08 + realtimeBearMarkerPulse * 0.16) }),
            stroke: new ol.style.Stroke({ color: bearTeamTint(teamColor,0.32 + realtimeBearMarkerPulse * 0.28), width: 2 })
          }));

          return [pulseOuterStyle, pulseInnerStyle, markerIconStyle];
        });
      } else {
        feature.setStyle(markerIconStyle);
      }

      bearMarkerSource.addFeature(feature);
    });

    if (hasAnimatedMarker) startBearMarkerAnimation();
    else stopBearMarkerAnimation();
  }

  // CAPTURE_MOCK_LAT_LNGheading 문자열/숫자를 프리뷰 계산용 각도로 정규화한다.
  function parseHeadingDegForPreview(value) {
    const analyzer = window.BearPositionAnalysis;
    if (analyzer && typeof analyzer.parseHeadingDegrees === "function") {
      return analyzer.parseHeadingDegrees(value);
    }

    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return null;
    const parsed = Number(value.replace(/[^0-9+-.]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  // 실시간 입력 프리뷰(반경/방향선/화살표)를 비운다.
  function clearAnalysisInputPreview() {
    analysisPreviewSource.clear();
    previewRayAnimationActive = false;
  }

  // 위치분석 입력값 변화에 따라 반경과 방향 화살표 프리뷰를 갱신한다.
  function renderAnalysisInputPreview(previewPayload) {
    clearAnalysisInputPreview();

    if (!previewPayload || !Array.isArray(previewPayload.sourceObservations)) return;

    const distanceLimitM = Number(previewPayload.distanceLimitM);
    const declinationDeg = Number(previewPayload.declinationDeg);
    if (!Number.isFinite(distanceLimitM) || distanceLimitM <= 0) return;
    const canDrawRay = Number.isFinite(declinationDeg);
    let hasRayFeature = false;

    const rayEndPoints = []; // 교차점 계산용 광선 끝점

    previewPayload.sourceObservations.forEach(function (obs) {
      if (!obs || !Number.isFinite(obs.lat) || !Number.isFinite(obs.lng)) return;

      const origin = mapCoordFromWgs84(obs.lat, obs.lng);

      const radiusFeature = new ol.Feature({
        geometry: new ol.geom.Circle(origin, distanceLimitM)
      });
      radiusFeature.set("kind", "preview-radius");
      analysisPreviewSource.addFeature(radiusFeature);

      if (!canDrawRay) return;

      const headingDeg = parseHeadingDegForPreview(obs.heading);
      if (!Number.isFinite(headingDeg)) return;

      const adjustedDeg = ((headingDeg + declinationDeg) % 360 + 360) % 360;
      const rad = adjustedDeg * Math.PI / 180;
      const end = [
        origin[0] + Math.sin(rad) * distanceLimitM,
        origin[1] + Math.cos(rad) * distanceLimitM
      ];

      rayEndPoints.push({ origin, end, rad });

      const rayFeature = new ol.Feature({
        geometry: new ol.geom.LineString([origin, end])
      });
      rayFeature.set("kind", "preview-ray");
      analysisPreviewSource.addFeature(rayFeature);

      const arrowFeature = new ol.Feature({
        geometry: new ol.geom.Point(end)
      });
      arrowFeature.set("kind", "preview-arrow");
      arrowFeature.set("angleRad", rad);
      analysisPreviewSource.addFeature(arrowFeature);
      hasRayFeature = true;
    });

    // 교차점 계산 및 표시 (2개 이상의 광선이 있을 때)
    if (rayEndPoints.length >= 2) {
      for (let i = 0; i < rayEndPoints.length - 1; i++) {
        for (let j = i + 1; j < rayEndPoints.length; j++) {
          const line1 = rayEndPoints[i];
          const line2 = rayEndPoints[j];

          const intersection = lineIntersection(
            line1.origin, line1.end,
            line2.origin, line2.end
          );

          if (intersection) {
            const intersectFeature = new ol.Feature({
              geometry: new ol.geom.Point(intersection)
            });
            intersectFeature.set("kind", "preview-intersection");
            analysisPreviewSource.addFeature(intersectFeature);
          }
        }
      }
    }

    previewRayAnimationActive = hasRayFeature;
    if (previewRayAnimationActive) {
      startAnalysisVisualAnimation();
    } else if (analysisGuideSource.getFeatures().length === 0) {
      stopAnalysisVisualAnimation();
    }
  }

  // 선-선 교차점 계산 (로컬 좌표계)
  function lineIntersection(p1, p2, p3, p4) {
    const x1 = p1[0], y1 = p1[1];
    const x2 = p2[0], y2 = p2[1];
    const x3 = p3[0], y3 = p3[1];
    const x4 = p4[0], y4 = p4[1];

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return null;

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    if (t < 0 || t > 1) return null;

    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
    if (u < 0 || u > 1) return null;

    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  }

  // 추정 결과 액션바(저장/취소)를 숨기고 오버레이 앵커를 해제한다.
  function hideAnalysisActionBar() {
    if (!analysisActionBarEl || !analysisActionOverlay) return;
    analysisActionBarEl.style.display = "none";
    analysisActionOverlay.setPosition(undefined);
    analysisActionAnchorCoord = null;
    document.body.classList.remove("analysis-action-active");
  }

  // 추정 좌표에 맞춰 액션바 오버레이를 표시한다.
  function showAnalysisActionBar(anchorCoord) {
    if (!analysisActionBarEl || !analysisActionOverlay || !Array.isArray(anchorCoord)) return;
    analysisActionBarEl.style.display = "flex";
    document.body.classList.add("analysis-action-active");
    analysisActionAnchorCoord = [anchorCoord[0], anchorCoord[1]];
    analysisActionOverlay.setPosition(analysisActionAnchorCoord);
    window.requestAnimationFrame(function () { resizeAnalysisOwner(); scheduleAnalysisActionBarLayoutUpdate(); });
    scheduleAnalysisActionBarLayoutUpdate();
  }

  function parseCssPx(value) {
    const num = Number.parseFloat(String(value || "0").replace("px", ""));
    return Number.isFinite(num) ? num : 0;
  }

  // 지도 앵커를 유지한 상태로 상단 패널/화면 경계와 겹치지 않도록 오프셋을 동적으로 조정한다.
  function updateAnalysisActionBarLayout() {
    if (!analysisActionBarEl || !analysisActionOverlay || analysisActionBarEl.style.display === "none") return;
    if (!map || !Array.isArray(analysisActionAnchorCoord)) return;

    const anchorPixel = map.getPixelFromCoordinate(analysisActionAnchorCoord);
    if (!Array.isArray(anchorPixel) || anchorPixel.length < 2) return;

    const rootStyles = window.getComputedStyle(document.documentElement);
    const safeTop = parseCssPx(rootStyles.getPropertyValue("--safe-top"));
    const safeBottom = parseCssPx(rootStyles.getPropertyValue("--safe-bottom"));
    const safeLeft = parseCssPx(rootStyles.getPropertyValue("--safe-left"));
    const safeRight = parseCssPx(rootStyles.getPropertyValue("--safe-right"));
    const edgeGap = 10;
    const baseOffsetY = 35;

    const rootRect = analysisActionBarEl.getBoundingClientRect();
    const overlayWidth = rootRect.width || 260;
    const overlayHeight = rootRect.height || 186;
    const halfWidth = overlayWidth / 2;

    const minTop = safeTop + edgeGap;
    const maxTop = Math.max(minTop, window.innerHeight - safeBottom - overlayHeight - edgeGap);
    const top = Math.min(Math.max(anchorPixel[1] + baseOffsetY, minTop), maxTop);

    const minCenterX = safeLeft + halfWidth + edgeGap;
    const maxCenterX = window.innerWidth - safeRight - halfWidth - edgeGap;
    const centerX = Math.min(Math.max(anchorPixel[0], minCenterX), maxCenterX);

    const offsetX = Math.round(centerX - anchorPixel[0]);
    const offsetY = Math.round(top - anchorPixel[1]);
    analysisActionOverlay.setOffset([offsetX, offsetY]);
    analysisActionOverlay.setPosition(analysisActionAnchorCoord);
  }

  function scheduleAnalysisActionBarLayoutUpdate() {
    if (analysisActionLayoutRafId !== null) return;
    analysisActionLayoutRafId = window.requestAnimationFrame(function () {
      analysisActionLayoutRafId = null;
      updateAnalysisActionBarLayout();
    });
  }

  function bindAnalysisActionBarLayoutListeners() {
    if (analysisActionLayoutBound) return;

    window.addEventListener("resize", scheduleAnalysisActionBarLayoutUpdate, { passive: true });
    window.addEventListener("orientationchange", scheduleAnalysisActionBarLayoutUpdate, { passive: true });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") scheduleAnalysisActionBarLayoutUpdate();
    });

    map.on("moveend", scheduleAnalysisActionBarLayoutUpdate);
    view.on("change:center", scheduleAnalysisActionBarLayoutUpdate);
    view.on("change:resolution", scheduleAnalysisActionBarLayoutUpdate);

    const obsSheetEl = document.getElementById("obs-sheet");
    if (obsSheetEl && typeof MutationObserver === "function") {
      analysisActionObsSheetObserver = new MutationObserver(function () {
        scheduleAnalysisActionBarLayoutUpdate();
      });
      analysisActionObsSheetObserver.observe(obsSheetEl, {
        attributes: true,
        attributeFilter: ["class", "style"]
      });
    }

    analysisActionLayoutBound = true;
  }

  // 위치분석 관련 requestAnimationFrame 루프를 중지한다.
  function stopAnalysisVisualAnimation() {
    analysisAnimationRunning = false;
    if (analysisAnimationFrameId !== null) {
      window.cancelAnimationFrame(analysisAnimationFrameId);
      analysisAnimationFrameId = null;
    }
  }

  // 프리뷰/최종분석/액션바 상태를 한 번에 초기화한다.
  function clearAnalysisEstimateVisuals() {
    stopAnalysisVisualAnimation();
    analysisDashOffset = 0;
    analysisPulseStrength = 0;
    analysisAnimationStartTs = 0;
    previewDashOffset = 0;
    previewArrowPulse = 0;
    clearAnalysisInputPreview();
    analysisGuideSource.clear();
    analysisEstimateSource.clear();
    analysisGuideLayer.changed();
    analysisPreviewLayer.changed();
    hideAnalysisActionBar();
    if (analysisOwnerInputEl) analysisOwnerInputEl.value = "";
    if (analysisPlaceInputEl) analysisPlaceInputEl.value = "";
    if (analysisRegionField) analysisRegionField.reset();
    if (analysisRealtimeShareInputEl) analysisRealtimeShareInputEl.checked = true;
    currentAnalysisPoint = null;
  }

  // 추정 위치 근처에 뜨는 저장/취소 액션바 오버레이를 1회 생성한다.
  function mountAnalysisActionBar() {
    if (analysisActionBarEl) return;

    const root = document.createElement("div");
    root.style.display = "none";
    root.style.flexDirection = "column";
    root.style.alignItems = "center";
    root.style.gap = "8px";
    root.style.width = "min(90vw, 300px)";
    root.style.position = "relative";
    root.style.zIndex = "11060";
    root.style.pointerEvents = "auto";

    const inputCard = document.createElement("div");
    inputCard.style.display = "flex";
    inputCard.style.flexDirection = "column";
    inputCard.style.gap = "0";
    inputCard.style.width = "100%";
    inputCard.style.padding = "0";
    inputCard.style.background = "rgba(15,23,42,0.92)";
    inputCard.style.border = "1px solid rgba(255,255,255,0.2)";
    inputCard.style.borderRadius = "10px";
    inputCard.style.boxShadow = "0 10px 24px rgba(15,23,42,0.3)";
    inputCard.style.overflow = "hidden";

    const fieldGrid = document.createElement("div");
    fieldGrid.style.display = "grid";
    fieldGrid.style.gridTemplateColumns = "1fr";
    fieldGrid.style.gap = "8px";

    const ownerField = document.createElement("div");
    ownerField.className = "obs-reg-identity analysis-registration-identity";
    ownerField.setAttribute("role", "group");
    ownerField.setAttribute("aria-label", "설정된 담당자와 팀");
    ownerField.title = "담당자·팀은 상단 설정에서 변경할 수 있습니다";

    const ownerLabel = document.createElement("label");
    ownerLabel.textContent = "담당자";
    ownerLabel.className = "obs-reg-identity-label";
    ownerLabel.htmlFor = "analysis-owner";

    const ownerInput = document.createElement("textarea");
    ownerInput.id = "analysis-owner";
    ownerInput.className = "obs-reg-identity-owner";
    ownerInput.rows = 1;
    ownerInput.readOnly = true;
    ownerInput.placeholder = "설정에서 담당자를 지정해주세요";
    ownerInput.autocomplete = "off";

    const placeField = document.createElement("div");
    placeField.style.display = "flex";
    placeField.style.flexDirection = "column";
    placeField.style.gap = "4px";

    const placeLabel = document.createElement("label");
    placeLabel.textContent = "지명";
    placeLabel.style.color = "#ffffff";
    placeLabel.style.fontSize = "12px";
    placeLabel.style.fontWeight = "700";

    const placeInput = document.createElement("input");
    placeInput.type = "text";
    placeInput.placeholder = "입력 또는 미지정";
    placeInput.autocomplete = "off";
    placeInput.style.height = "32px";
    placeInput.style.padding = "0 10px";
    placeInput.style.border = "1px solid rgba(148,163,184,0.65)";
    placeInput.style.borderRadius = "6px";
    placeInput.style.background = "rgba(255,255,255,0.96)";
    placeInput.style.color = "#0f172a";
    placeInput.style.fontSize = "14px";
    placeInput.style.outline = "none";

    const regionField = document.createElement("div");
    regionField.style.cssText = placeField.style.cssText;
    const regionLabel = document.createElement("label");
    regionLabel.textContent = "위치";
    regionLabel.htmlFor = "analysis-admin-region";
    regionLabel.style.cssText = placeLabel.style.cssText;
    const regionInput = document.createElement("input");
    regionInput.id = "analysis-admin-region";
    regionInput.type = "text";
    regionInput.autocomplete = "off";
    regionInput.placeholder = "자동 조회 · 직접 수정 가능";
    regionInput.style.cssText = placeInput.style.cssText;
    regionField.appendChild(regionLabel);
    regionField.appendChild(regionInput);
    const teamField = document.createElement("div");
    teamField.className = "obs-reg-identity-team";
    const teamLabel = document.createElement("label");
    teamLabel.textContent = "팀"; teamLabel.htmlFor = "analysis-team"; teamLabel.className = "obs-reg-identity-label";
    const teamInput = document.createElement("input");
    teamInput.id = "analysis-team"; teamInput.className = "obs-reg-identity-team-input"; teamInput.readOnly = true; teamInput.placeholder = "팀 선택";
    const teamBadge = document.createElement("div"); teamBadge.className = "obs-reg-team-badge";
    const teamDot = document.createElement("span"); teamDot.className = "obs-reg-team-dot"; teamDot.setAttribute("aria-hidden", "true");
    teamBadge.append(teamDot, teamInput);
    teamField.append(teamLabel, teamBadge);

    const realtimeShareLabel = document.createElement("label");
    realtimeShareLabel.style.display = "flex";
    realtimeShareLabel.style.alignItems = "center";
    realtimeShareLabel.style.gap = "8px";
    realtimeShareLabel.style.color = "#ffffff";
    realtimeShareLabel.style.fontSize = "12px";
    realtimeShareLabel.style.fontWeight = "700";
    realtimeShareLabel.style.cursor = "pointer";

    const realtimeShareInput = document.createElement("input");
    realtimeShareInput.type = "checkbox";
    realtimeShareInput.checked = true;
    realtimeShareInput.style.width = "16px";
    realtimeShareInput.style.height = "16px";
    realtimeShareInput.style.margin = "0";
    realtimeShareInput.style.accentColor = "#0b72c7";
    realtimeShareLabel.appendChild(realtimeShareInput);
    realtimeShareLabel.appendChild(document.createTextNode("실시간 공유"));

    const buttonRow = document.createElement("div");
    buttonRow.style.display = "flex";
    buttonRow.style.alignItems = "center";
    buttonRow.style.justifyContent = "center";
    buttonRow.style.gap = "8px";
    buttonRow.style.width = "100%";
    buttonRow.style.boxSizing = "border-box";
    buttonRow.style.padding = "8px 10px 10px";
    buttonRow.style.borderTop = "1px solid rgba(255,255,255,0.15)";
    buttonRow.style.background = "rgba(255,255,255,0.025)";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "저장";
    saveBtn.style.height = "34px";
    saveBtn.style.flex = "1";
    saveBtn.style.minWidth = "78px";
    saveBtn.style.padding = "0 14px";
    saveBtn.style.border = "1px solid rgba(255,255,255,0.62)";
    saveBtn.style.borderRadius = "6px";
    saveBtn.style.background = "#0b72c7";
    saveBtn.style.color = "#ffffff";
    saveBtn.style.fontSize = "16px";
    saveBtn.style.fontWeight = "700";
    saveBtn.style.cursor = "pointer";
    saveBtn.style.boxShadow = "none";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "취소";
    cancelBtn.style.height = "34px";
    cancelBtn.style.flex = "1";
    cancelBtn.style.minWidth = "78px";
    cancelBtn.style.padding = "0 14px";
    cancelBtn.style.border = "1px solid rgba(255,255,255,0.62)";
    cancelBtn.style.borderRadius = "6px";
    cancelBtn.style.background = "#8a3b00";
    cancelBtn.style.color = "#ffffff";
    cancelBtn.style.fontSize = "16px";
    cancelBtn.style.fontWeight = "700";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.style.boxShadow = "none";

    saveBtn.addEventListener("click", async function () {
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      let identity;
      try { identity = await window.BearAppSettings.requireIdentity(); }
      catch (error) { if (statusEl) statusEl.textContent = error.message; saveBtn.disabled = false; return; }
      const point = currentAnalysisPoint;
      const ownerName = identity.owner;
      const placeName = normalizePlaceName(analysisPlaceInputEl ? analysisPlaceInputEl.value : "");
      if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
        if (statusEl) statusEl.textContent = "⚠️ 저장할 분석 결과가 없습니다.";
        saveBtn.disabled = false;
        return;
      }

      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const bearCode = String(point.bearCode || "").trim();
      const sourceIds = Array.isArray(point.sourceObservationIds)
        ? JSON.stringify(point.sourceObservationIds)
        : null;
      const intersectionsCount = Number.isFinite(point.intersectionsCount)
        ? point.intersectionsCount
        : null;
      const latDms = decimalToDMS(point.lat, false);
      const lngDms = decimalToDMS(point.lng, true);
      const createdAtKst = getKstSqliteTimestamp();
      const sourceObservationsJson = JSON.stringify((Array.isArray(point.sourceObservations) ? point.sourceObservations : []).map(function (obs) {
        const projected = mapCoordFromWgs84(Number(obs.lat), Number(obs.lng));
        return {
          id: obs.id || null,
          team_id: obs.team_id || null,
          team_name: obs.team_name || null,
          team_color: obs.team_color || null,
          place: obs.place || null,
          adminRegion: obs.adminRegion || obs.admin_region || null,
          bearCode: obs.bearCode || null,
          owner: obs.owner || null,
          heading: obs.heading ?? null,
          lat: Number(obs.lat),
          lng: Number(obs.lng),
          createdAt: obs.createdAt || null,
          updatedAt: obs.updatedAt || null,
          detectors: (Array.isArray(obs.detectors) ? obs.detectors : []).map(function (detector) {
            return {
              detectorName: detector.detectorName || null,
              signalStrength: detector.signalStrength || null
            };
          }),
          mapX: Array.isArray(projected) && Number.isFinite(projected[0]) ? projected[0] : null,
          mapY: Array.isArray(projected) && Number.isFinite(projected[1]) ? projected[1] : null
        };
      }));
      const analysisRaysJson = JSON.stringify((point.analysisDetails && Array.isArray(point.analysisDetails.rays) ? point.analysisDetails.rays : []).map(function (ray) {
        const sourceObs = Array.isArray(point.sourceObservations)
          ? point.sourceObservations.find(function (obs) { return obs && obs.id === ray.id; })
          : null;
        const projected = sourceObs ? mapCoordFromWgs84(Number(sourceObs.lat), Number(sourceObs.lng)) : null;
        return {
          id: ray.id || null,
          headingDeg: Number.isFinite(Number(ray.headingDeg)) ? Number(ray.headingDeg) : null,
          adjustedBearing: Number.isFinite(Number(ray.adjustedBearing)) ? Number(ray.adjustedBearing) : null,
          localX: Array.isArray(ray.point) && Number.isFinite(Number(ray.point[0])) ? Number(ray.point[0]) : null,
          localY: Array.isArray(ray.point) && Number.isFinite(Number(ray.point[1])) ? Number(ray.point[1]) : null,
          directionX: Array.isArray(ray.direction) && Number.isFinite(Number(ray.direction[0])) ? Number(ray.direction[0]) : null,
          directionY: Array.isArray(ray.direction) && Number.isFinite(Number(ray.direction[1])) ? Number(ray.direction[1]) : null,
          mapX: Array.isArray(projected) && Number.isFinite(projected[0]) ? projected[0] : null,
          mapY: Array.isArray(projected) && Number.isFinite(projected[1]) ? projected[1] : null
        };
      }));
      const intersectionsJson = JSON.stringify((point.analysisDetails && Array.isArray(point.analysisDetails.intersections) ? point.analysisDetails.intersections : []).map(function (item, index) {
        const projected = mapCoordFromWgs84(Number(item.lat), Number(item.lng));
        return {
          index: index + 1,
          lat: Number(item.lat),
          lng: Number(item.lng),
          localX: Array.isArray(item.point) && Number.isFinite(Number(item.point[0])) ? Number(item.point[0]) : null,
          localY: Array.isArray(item.point) && Number.isFinite(Number(item.point[1])) ? Number(item.point[1]) : null,
          mapX: Array.isArray(projected) && Number.isFinite(projected[0]) ? projected[0] : null,
          mapY: Array.isArray(projected) && Number.isFinite(projected[1]) ? projected[1] : null
        };
      }));
      const analysisOptionsJson = JSON.stringify(normalizeAnalysisOptions(point.analysisOptions || point.options));
      const analysisDiagnosticsJson = JSON.stringify(point.analysisDiagnostics || null);
      const shareRealtime = realtimeShareInput.checked;

      let localSaved = false;
      try {
        saveBtn.disabled = true;
        const adminRegion = await analysisRegionField.resolve(point.lat, point.lng);
        if (currentAnalysisPoint !== point) return;
        await localEstimateStore.insert({ id, bear_code: bearCode, ...identity, place: placeName || null,
          admin_region: adminRegion, lat: point.lat, lng: point.lng, lat_dms: latDms, lng_dms: lngDms,
          estimation_method: point.analysisOptions?.estimationMethod || point.options?.estimationMethod || null,
          intersections_count: intersectionsCount, source_observation_ids: sourceIds, source_observations_json: sourceObservationsJson,
          analysis_rays_json: analysisRaysJson, intersections_json: intersectionsJson, analysis_options_json: analysisOptionsJson,
          analysis_diagnostics_json: analysisDiagnosticsJson, created_at: createdAtKst, share_pending: shareRealtime });
        localSaved = true;
        if (shareRealtime) pendingBearUploads.add(String(id));
        clearAnalysisEstimateVisuals();
        realtimeListModule?.openRealtimeTab();
        if (statusEl) statusEl.textContent = `✅ 곰 추정위치(${bearCode}) 저장 완료`;
        await refreshBearEstimatePanel();
        if (shareRealtime && navigator.onLine === false) {
          if (statusEl) statusEl.textContent = "기기에 저장했습니다. 연결되면 공유합니다.";
        } else if (shareRealtime) {
          if (!realtimeListModule || typeof realtimeListModule.sendEstimate !== "function") {
            if (statusEl) statusEl.textContent = "⚠️ 로컬에만 저장되었습니다. 실시간 공유 기능을 사용할 수 없습니다.";
          } else {
            const sendResult = await realtimeListModule.sendEstimate({
              id,
              bear_code: bearCode,
              owner: ownerName || null,
              team_id: identity.team_id,
              team_name: identity.team_name,
              team_color: identity.team_color,
              place: placeName || null,
              admin_region: adminRegion,
              lat: point.lat,
              lng: point.lng,
              lat_dms: latDms,
              lng_dms: lngDms,
              estimation_method: point.analysisOptions?.estimationMethod || point.options?.estimationMethod || null,
              intersections_count: intersectionsCount,
              source_observations: JSON.parse(sourceObservationsJson),
              analysis_options: JSON.parse(analysisOptionsJson),
              analysis_rays: JSON.parse(analysisRaysJson),
              analysis_intersections: JSON.parse(intersectionsJson),
              created_at: createdAtKst
            });
            if (sendResult && sendResult.ok) {
              await markBearEstimatesShared([id]);
            } else if (statusEl) {
              const reason = sendResult && sendResult.reason === "network-error"
                ? "인터넷 또는 서버 연결을 확인해 주세요."
                : (sendResult && sendResult.message ? sendResult.message : "다시 시도해 주세요.");
              statusEl.textContent = "⚠️ 로컬에만 저장되었습니다. 실시간 공유 실패: " + reason;
            }
          }
        }
      } catch (saveError) {
        console.error(localSaved ? "[bear_estimates] 실시간 공유 처리 실패:" : "[bear_estimates] 저장 실패:", saveError);
        if (statusEl) statusEl.textContent = (localSaved
          ? "⚠️ 로컬에만 저장되었습니다. 실시간 공유 처리 실패: "
          : "🔴 저장 실패: ") + (saveError && saveError.message ? saveError.message : String(saveError));
      } finally {
        pendingBearUploads.delete(String(id));
        repaintUnifiedBearList();
        saveBtn.disabled = false;
      }
    });

    cancelBtn.addEventListener("click", function () {
      clearAnalysisEstimateVisuals();
      setDefaultStatusWithIcon();
    });

    root.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    root.addEventListener("touchstart", function (e) { e.stopPropagation(); }, { passive: true });

    ownerField.appendChild(ownerLabel);
    ownerField.appendChild(ownerInput);
    ownerField.appendChild(teamField);
    placeField.appendChild(placeLabel);
    placeField.appendChild(placeInput);
    fieldGrid.appendChild(ownerField);
    fieldGrid.appendChild(placeField);
    fieldGrid.appendChild(regionField);

    const headerText = document.createElement("div");
    headerText.textContent = "추가정보 입력";
    headerText.style.color = "#ffffff";
    headerText.style.fontSize = "13px";
    headerText.style.fontWeight = "700";
    headerText.style.textAlign = "center";
    headerText.style.padding = "9px 12px";
    headerText.style.borderBottom = "1px solid rgba(255,255,255,0.15)";
    headerText.style.letterSpacing = "0.03em";

    const fieldWrap = document.createElement("div");
    fieldWrap.style.padding = "10px";
    fieldWrap.style.display = "flex";
    fieldWrap.style.flexDirection = "column";
    fieldWrap.style.gap = "8px";
    fieldWrap.appendChild(fieldGrid);
    fieldWrap.appendChild(realtimeShareLabel);

    inputCard.appendChild(headerText);
    inputCard.appendChild(fieldWrap);
    buttonRow.appendChild(saveBtn);
    buttonRow.appendChild(cancelBtn);
    inputCard.appendChild(buttonRow);

    root.appendChild(inputCard);

    // 분석 결과 입력 UI는 지도 좌표에 앵커링된 오버레이로 유지한다.
    analysisActionOverlay = new ol.Overlay({
      element: root,
      className: "analysis-action-overlay",
      positioning: "top-center",
      offset: [0, 35],
      stopEvent: true,
      autoPan: {
        animation: { duration: 180 },
        margin: 24
      }
    });
    map.addOverlay(analysisActionOverlay);

    const overlayContainerEl = root.parentElement;
    if (overlayContainerEl) {
      overlayContainerEl.classList.add("analysis-action-overlay-container");
      overlayContainerEl.style.zIndex = "2147483000";
    }

    const mapTargetEl = typeof map.getTargetElement === "function" ? map.getTargetElement() : null;
    const stopEventContainerEl = mapTargetEl ? mapTargetEl.querySelector(".ol-overlaycontainer-stopevent") : null;
    if (stopEventContainerEl) {
      stopEventContainerEl.style.zIndex = "2147483000";
    }

    bindAnalysisActionBarLayoutListeners();

    analysisActionBarEl = root;
    analysisOwnerInputEl = ownerInput;
    analysisTeamInputEl = teamInput;
    analysisPlaceInputEl = placeInput;
    analysisRegionField = window.createEditableRegionField(regionInput);
    analysisRealtimeShareInputEl = realtimeShareInput;
  }

  // 방금 계산한 분석 결과를 임시 추정점으로 지도에 렌더링하고 저장 액션바와 연결한다.
  function renderAnalysisEstimatePoint(point) {
    clearAnalysisEstimateVisuals();
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
    currentAnalysisPoint = point; // clearAnalysisEstimateVisuals 이후에 재설정해야 null이 안 됨

    const estimateCoord = mapCoordFromWgs84(point.lat, point.lng);

    // 관측점 -> 추정점 점선 가이드
    if (Array.isArray(point.sourceObservations)) {
      point.sourceObservations.forEach(function (obs) {
        if (!obs || !Number.isFinite(obs.lat) || !Number.isFinite(obs.lng)) return;
        const obsCoord = mapCoordFromWgs84(obs.lat, obs.lng);
        const lineFeature = new ol.Feature({
          geometry: new ol.geom.LineString([obsCoord, estimateCoord])
        });
        lineFeature.set("kind", "ray");
        analysisGuideSource.addFeature(lineFeature);
      });
    }

    const pulseFeature = new ol.Feature({
      geometry: new ol.geom.Point(estimateCoord)
    });
    pulseFeature.set("kind", "pulse");
    analysisGuideSource.addFeature(pulseFeature);

    const feature = new ol.Feature({
      geometry: new ol.geom.Point(estimateCoord)
    });
    const analysisProfile = window.BearAppSettings?.getProfile();
    const analysisTeam = window.BearAppSettings?.store?.snapshot()?.items?.find(team => team.id === analysisProfile?.team_id);
    const _analysisItem = {
      id: point.bearCode || "추정",
      bearCode: point.bearCode || "추정",
      owner: resolveDefaultAnalysisOwner(point),
      team_id: analysisProfile?.team_id || null,
      team_name: analysisTeam?.name || analysisProfile?.team_name || null,
      team_color: analysisTeam?.color || analysisProfile?.team_color || null,
      place: resolveDefaultAnalysisPlace(point),
      lat: point.lat,
      lng: point.lng,
      created_at: null,
      _unsaved: true
    };
    feature.set("popupHtml", buildBearEstimatePopupHtml(_analysisItem));
    feature.set("bearEstimateData", _analysisItem);

    feature.setStyle(new ol.style.Style({
      image: new ol.style.Icon({
        src: "css/svg/bear_marker_point.svg",
        anchor: [0.5, 1],
        width: 40,
        height: 40
      }),
      text: new ol.style.Text({
        text: String(point.bearCode || "추정"),
        offsetY: ESTIMATE_LABEL_OFFSET_Y,
        font: "700 12px sans-serif",
        fill: new ol.style.Fill({ color: "#ffffff" }),
        backgroundFill: new ol.style.Fill({ color: bearTeamTint(bearTeamColor(_analysisItem),0.96) }),
        padding: [3, 6, 3, 6]
      })
    }));

    analysisEstimateSource.addFeature(feature);
    syncAnalysisOwnerInput(point);
    syncAnalysisPlaceInput(point);
    if (analysisRegionField) analysisRegionField.update(point.lat, point.lng);
    showAnalysisActionBar(estimateCoord);
    startAnalysisVisualAnimation();
  }

  // 점선 이동, 펄스, 화살표 크기 변화를 매 프레임 갱신한다.
  function animateAnalysisVisuals(timestamp) {
    if (!analysisAnimationRunning) return;
    if (!analysisAnimationStartTs) analysisAnimationStartTs = timestamp;

    const elapsedSec = (timestamp - analysisAnimationStartTs) / 1000;
    analysisDashOffset = -elapsedSec * 28;
    analysisPulseStrength = (Math.sin(elapsedSec * Math.PI * 1.35) + 1) / 2;
    previewDashOffset = -elapsedSec * 22;
    previewArrowPulse = (Math.sin(elapsedSec * Math.PI * 1.5) + 1) / 2;

    analysisGuideLayer.changed();
    if (previewRayAnimationActive) {
      analysisPreviewLayer.changed();
    }

    if (!previewRayAnimationActive && analysisGuideSource.getFeatures().length === 0) {
      stopAnalysisVisualAnimation();
      return;
    }

    analysisAnimationFrameId = window.requestAnimationFrame(animateAnalysisVisuals);
  }

  // 위치분석 시각효과 애니메이션 루프를 시작한다.
  function startAnalysisVisualAnimation() {
    if (analysisAnimationRunning) return;
    analysisAnimationRunning = true;
    analysisAnimationStartTs = 0;
    analysisAnimationFrameId = window.requestAnimationFrame(animateAnalysisVisuals);
  }

  window.addEventListener("beforeunload", function () {
    stopAnalysisVisualAnimation();
  });

  // TXT 파일 생성 및 다운로드 (앱: DB 조회, 웹: 더미 포함)
  async function downloadBearEstimateTxt(it, isFallback) {
    const lat = Number(it.lat);
    const lng = Number(it.lng);
    const bearCode = it.bear_code || it.bearCode || "-";
    const ownerName = normalizeOwnerName(it.owner) || "미지정";
    const placeName = normalizePlaceName(it.place) || "미지정";
    const timeLabel = formatKstDateTimeLabel(it.created_at || it.ts);
    const latDms = it.lat_dms || decimalToDMS(lat, false);
    const lngDms = it.lng_dms || decimalToDMS(lng, true);
    // const projected = mapCoordFromWgs84(lat, lng); // EPSG:5179 출력(기존)
    // const mapX = Array.isArray(projected) && Number.isFinite(projected[0]) ? projected[0].toFixed(3) : "-";
    // const mapY = Array.isArray(projected) && Number.isFinite(projected[1]) ? projected[1].toFixed(3) : "-";
    const legacyProjected = legacyTmCoordFromWgs84(lat, lng);
    const mapX = Array.isArray(legacyProjected) && Number.isFinite(legacyProjected[0]) ? legacyProjected[0].toFixed(3) : "-";
    const mapY = Array.isArray(legacyProjected) && Number.isFinite(legacyProjected[1]) ? legacyProjected[1].toFixed(3) : "-";

    let sourceObservations = Array.isArray(it.source_observations) ? it.source_observations : [];

    if (!sourceObservations.length && !it.isRealtime && !isFallback) {
      // DB에서 상세 JSON 조회
      try {
        const sqlite = getCapacitorSQLitePlugin();
        const dbName = window.BearSQLiteConfig && window.BearSQLiteConfig.dbName
          ? window.BearSQLiteConfig.dbName : "BearPointData";
        const res = await sqlite.query({
          database: dbName,
          statement: "SELECT source_observations_json FROM bear_estimates WHERE id = ?",
          values: [it.id]
        });
        const row = res && res.values && res.values[0];
        if (row) {
          try { sourceObservations = JSON.parse(row.source_observations_json || "[]"); } catch (e) { sourceObservations = []; }
        }
      } catch (e) {
        console.warn("TXT 다운로드 DB 조회 오류:", e);
      }
    } else if (!sourceObservations.length && !it.isRealtime && isFallback) {
      // 웹 더미 데이터: source_observation_ids를 파싱해 가상 관측점 생성
      let obsIds = [];
      try { obsIds = JSON.parse(it.source_observation_ids || "[]"); } catch (e) { obsIds = []; }
      sourceObservations = obsIds.map(function (obsId, idx) {
        return {
          id: obsId,
          place: "관측지점 " + (idx + 1),
          bearCode: bearCode,
          lat: lat + (idx % 2 === 0 ? -0.01 : 0.01) * (idx + 1) * 0.5,
          lng: lng + (idx % 2 === 0 ? 0.01 : -0.01) * (idx + 1) * 0.5,
          heading: 180 + idx * 45
        };
      });
    }

    // TXT 내용 조립

    function formatHeadingDegree(value) {
      if (value == null || value === "") return "-";
      const raw = String(value).trim();
      const numericText = raw.replace(/[^0-9+\-.]/g, "");
      const numeric = Number(numericText);
      if (Number.isFinite(numeric)) {
        return numeric.toFixed(1).replace(/\.0$/, "") + "°";
      }
      return raw.replace(/°+/g, "").trim() + "°";
    }

    function formatCoord7(value) {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(7) : "-";
    }

    let lines = [];
    lines.push("========================================");
    lines.push("  곰 추적위치 결과");
    lines.push("========================================");
    lines.push("코드     : " + bearCode);
    lines.push("추정 방식 : " + getEstimationMethodLabel(it));
    lines.push("등록자   : " + ownerName);
    lines.push("지명     : " + placeName);
    lines.push("위치     : " + (it.admin_region || it.adminRegion || "미지정"));
    lines.push("저장 일시   : " + timeLabel);
    lines.push("");
    lines.push("[ 사용된 관측점 목록 (" + sourceObservations.length + "개) ]");
    sourceObservations.forEach(function (obs, idx) {
      const label = (obs && (obs.place || obs.name || obs.id)) ? String(obs.place || obs.name || obs.id) : null;
      lines.push("  관측점 " + (idx + 1) + (label ? " (" + label + ")" : ""));
      lines.push("    위도   : " + formatCoord7(obs && obs.lat));
      lines.push("    경도   : " + formatCoord7(obs && obs.lng));
      lines.push("    방향각 : " + formatHeadingDegree(obs && obs.heading));
      if (idx < sourceObservations.length - 1) lines.push("    ------------------------------");
    });
    lines.push("");
    lines.push("[ 추정 위치 ]");
    lines.push("  위도(DMS) : " + latDms);
    lines.push("  경도(DMS) : " + lngDms);
    lines.push("  X (TM:EPSG:5181) : " + mapX);
    lines.push("  Y (TM:EPSG:5181) : " + mapY);
    lines.push("========================================");
    if (isFallback && !it.isRealtime) lines.push("* 웹 환경: 관측점 목록은 더미 데이터입니다.");

    const txtContent = lines.join("\r\n");
    const safeCode = bearCode.replace(/[^\w가-힣]/g, "_");
    const fileDate = parseSavedDateTime(it.created_at || it.ts);
    let safeTime = "unknown_time";
    if (fileDate) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }).formatToParts(fileDate);

      const map = {};
      parts.forEach(function (p) {
        if (p && p.type && p.type !== "literal") map[p.type] = p.value;
      });

      safeTime = [map.year, map.month, map.day].join("-") + "_" + [map.hour, map.minute, map.second].join("-");
    }
    const fileName = "bear_estimate_" + safeCode + "_" + safeTime + ".txt";

    // 네이티브 앱은 먼저 인앱 미리보기를 띄우고, 저장/공유/열기는 그 안에서 실행한다.
    if (isNativeCapacitorPlatform()) {
      let savedFile = null;

      async function ensureSavedFile() {
        if (savedFile) return savedFile;

        const existing = await getNativeTxtUriIfExists(fileName);
        if (existing) {
          savedFile = existing;
          if (statusEl) statusEl.textContent = "ℹ️ 기존 저장 파일을 사용합니다: Documents/" + existing.relativePath;
          return savedFile;
        }

        savedFile = await saveTxtToNativeDocuments(fileName, txtContent);
        return savedFile;
      }

      try {
        await showSavedTxtPreviewPopup({
          fileName: fileName,
          txtContent: txtContent,
          onSave: async function () {
            const saved = await ensureSavedFile();
            return saved;
          },
          onShare: async function () {
            const saved = await ensureSavedFile();
            if (!saved) return;
            await shareSavedTxtFile(fileName, saved && saved.savedUri ? saved.savedUri : undefined, txtContent);
          },
          onOpen: async function () {
            const saved = await ensureSavedFile();
            if (!saved) return;
            const opened = await openSavedFileLink(
              saved && saved.savedUri ? saved.savedUri : (saved && saved.relativePath ? saved.relativePath : null),
              { fileName: fileName, directory: "DOCUMENTS" }
            );
            if (statusEl) {
              statusEl.textContent = opened
                ? "✅ 저장 파일 링크 열기 시도: " + fileName
                : "⚠️ 링크 열기에 실패했습니다. 공유하기를 사용해 주세요.";
            }
          }
        });
      } catch (error) {
        console.warn("TXT Filesystem 저장 오류:", error);
        if (statusEl) {
          statusEl.textContent = "🔴 TXT 저장 실패: " + (error && error.message ? error.message : String(error));
        }
      }
      return;
    }

    await showSavedTxtPreviewPopup({
      fileName: fileName,
      txtContent: txtContent,
      onSave: async function () {
        const blob = new Blob([txtContent], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
        if (statusEl) statusEl.textContent = "✅ TXT 다운로드 시작: " + fileName;
      }
    });
  }

  // SheetJS 라이브러리를 동적으로 로드
  function loadSheetJS() {
    return new Promise(function (resolve, reject) {
      if (typeof XLSX !== "undefined") {
        resolve(XLSX);
        return;
      }
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
      script.onload = function () {
        if (typeof XLSX !== "undefined") {
          resolve(XLSX);
        } else {
          reject(new Error("XLSX 라이브러리 로드 실패"));
        }
      };
      script.onerror = function () {
        reject(new Error("XLSX 라이브러리 다운로드 실패"));
      };
      document.head.appendChild(script);
    });
  }

  async function downloadBearEstimateXls(it, isFallback) {
    const lat = Number(it.lat);
    const lng = Number(it.lng);
    const bearCode = it.bear_code || it.bearCode || "-";
    const ownerName = normalizeOwnerName(it.owner) || "미지정";
    const placeName = normalizePlaceName(it.place) || "미지정";
    const timeLabel = formatKstDateTimeLabel(it.created_at || it.ts);
    const legacyProjected = legacyTmCoordFromWgs84(lat, lng);
    const mapX = Array.isArray(legacyProjected) && Number.isFinite(legacyProjected[0]) ? legacyProjected[0].toFixed(3) : "-";
    const mapY = Array.isArray(legacyProjected) && Number.isFinite(legacyProjected[1]) ? legacyProjected[1].toFixed(3) : "-";

    const safeCode = bearCode.replace(/[^\w가-힣]/g, "_");
    const fileDate = parseSavedDateTime(it.created_at || it.ts);
    let safeTime = "unknown_time";
    if (fileDate) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }).formatToParts(fileDate);

      const map = {};
      parts.forEach(function (p) {
        if (p && p.type && p.type !== "literal") map[p.type] = p.value;
      });

      safeTime = [map.year, map.month, map.day].join("-") + "_" + [map.hour, map.minute, map.second].join("-");
    }
    const fileName = "bear_estimate_" + safeCode + "_" + safeTime + ".xlsx";

    // 데이터 준비 (첫 번째 시트의 데이터)
    const latDms = it.lat_dms || decimalToDMS(lat, false);
    const lngDms = it.lng_dms || decimalToDMS(lng, true);

    const xlsData = [
      ["등록일자", "지명", "위치", "위치추적담당자", "X좌표(TM)", "Y좌표(TM)", "추정위치(위도 DMS)", "추정위치(경도 DMS)", "추정위치(위도)", "추정위치(경도)"],
      [timeLabel, placeName, it.admin_region || it.adminRegion || "", ownerName, mapX, mapY, latDms, lngDms, lat, lng]
    ];

    const previewHtml = buildXlsPreviewHtml(xlsData);

    if (isNativeCapacitorPlatform()) {
      let savedFile = null;

      async function ensureSavedFile() {
        if (savedFile) return savedFile;
        savedFile = await saveXlsToNativeDocuments(fileName, xlsData);
        return savedFile;
      }

      try {
        await showSavedXlsPreviewPopup({
          fileName: fileName,
          previewHtml: previewHtml,
          onSave: async function () {
            const saved = await ensureSavedFile();
            return saved;
          },
          onShare: async function () {
            const saved = await saveXlsToNativeDocuments(fileName, xlsData);
            if (!saved) return;
            await shareSavedXlsFile(fileName, saved && saved.savedUri ? saved.savedUri : undefined, xlsData);
          }
        });
      } catch (error) {
        console.warn("XLS Filesystem 저장 오류:", error);
        if (statusEl) {
          statusEl.textContent = "🔴 XLS 저장 실패: " + (error && error.message ? error.message : String(error));
        }
      }
      return;
    }

    async function saveWebXls() {
      const XLSX = await loadSheetJS();
      const workbook = buildXlsWorkbook(XLSX, xlsData, "추정위치");

      const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      if (statusEl) statusEl.textContent = "✅ XLS 다운로드 시작: " + fileName;
    }

    try {
      await showSavedXlsPreviewPopup({
        fileName: fileName,
        previewHtml: previewHtml,
        onSave: saveWebXls
      });
    } catch (error) {
      console.error("XLS 생성 오류:", error);
      if (statusEl) {
        statusEl.textContent = "🔴 XLS 생성 실패: " + (error && error.message ? error.message : String(error));
      }
    }
  }

    function buildXlsPreviewHtml(xlsData) {
      const rows = Array.isArray(xlsData) ? xlsData : [];
      const headers = Array.isArray(rows[0]) ? rows[0] : [];
      const bodyRows = rows.slice(1).filter(function (row) { return Array.isArray(row); });

      function getVisualTextLength(value) {
        const text = String(value == null ? "" : value);
        let length = 0;
        for (let i = 0; i < text.length; i += 1) {
          const code = text.charCodeAt(i);
          length += code > 255 ? 2 : 1;
        }
        return length;
      }

      const colWidths = headers.map(function (header, index) {
        const headerLen = getVisualTextLength(header);
        const maxBodyLen = bodyRows.reduce(function (maxLen, row) {
          return Math.max(maxLen, getVisualTextLength(row[index]));
        }, 0);
        const widthCh = Math.max(headerLen, maxBodyLen) + 2;
        return Math.max(8, Math.min(40, widthCh));
      });

      let previewHtml = '<table style="width:max-content; min-width:100%; border-collapse:collapse; font-size:11px; table-layout:auto; white-space:nowrap;">';
      previewHtml += '<colgroup>';
      colWidths.forEach(function (widthCh) {
        previewHtml += '<col style="width:' + widthCh + 'ch;">';
      });
      previewHtml += '</colgroup>';
      previewHtml += '<thead style="background:#1e293b;"><tr>';
      headers.forEach(function (header) {
        previewHtml += '<th style="border:1px solid #475569; padding:3px; text-align:left; color:#cbd5e1;">' + header + '</th>';
      });
      previewHtml += '</tr></thead>';
      previewHtml += '<tbody>';
      bodyRows.forEach(function (row) {
        previewHtml += '<tr>';
        headers.forEach(function (_, colIdx) {
          previewHtml += '<td style="border:1px solid #475569; padding:3px; color:#e2e8f0;">' + String(row[colIdx] == null ? "" : row[colIdx]) + '</td>';
        });
        previewHtml += '</tr>';
      });
      previewHtml += '</tbody>';
      previewHtml += '</table>';

      return previewHtml;
    }

    function buildXlsWorkbook(XLSX, xlsData, sheetName) {
      const rows = Array.isArray(xlsData) ? xlsData : [];
      const worksheet = XLSX.utils.aoa_to_sheet(rows);

      function getVisualTextLength(value) {
        const text = String(value == null ? "" : value);
        let length = 0;
        for (let i = 0; i < text.length; i += 1) {
          const code = text.charCodeAt(i);
          length += code > 255 ? 2 : 1;
        }
        return length;
      }

      const colCount = rows.reduce(function (maxCount, row) {
        return Math.max(maxCount, Array.isArray(row) ? row.length : 0);
      }, 0);

      if (colCount > 0) {
        // 현재 컬럼 순서:
        // 0 등록일자, 1 지명, 2 위치추적담당자, 3 X좌표, 4 Y좌표, 5 위도 DMS, 6 경도 DMS, 7 위도, 8 경도
        const minWidthByColumn = [22, 16, 16, 14, 14, 20, 20, 16, 16];
        const fixedWidthByColumn = [23, null, null, null, null, null, null, null, null];

        worksheet["!cols"] = Array.from({ length: colCount }, function (_, colIndex) {
          const maxVisualLength = rows.reduce(function (acc, row) {
            if (!Array.isArray(row)) return acc;
            return Math.max(acc, getVisualTextLength(row[colIndex]));
          }, 0);

          const minWidth = Number.isFinite(minWidthByColumn[colIndex])
            ? minWidthByColumn[colIndex]
            : 10;
          const fixedWidth = Number.isFinite(fixedWidthByColumn[colIndex])
            ? fixedWidthByColumn[colIndex]
            : null;
          const widthCh = Number.isFinite(fixedWidth)
            ? fixedWidth
            : Math.max(minWidth, Math.min(64, maxVisualLength + 4));

          return {
            // 일부 모바일 오피스 뷰어는 wch만으로는 폭을 무시해 wpx도 함께 지정한다.
            wch: widthCh,
            wpx: Math.round(widthCh * 8)
          };
        });
      }

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, sheetName || "추정위치");
      return workbook;
    }

    function bytesToBase64(bytes) {
      if (!(bytes instanceof Uint8Array)) return "";
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode.apply(null, Array.from(chunk));
      }
      return btoa(binary);
    }

    async function ensureXlsFileUriForShare(fileName, uriCandidate, xlsData) {
      if (uriCandidate && /^(file:|content:)/i.test(String(uriCandidate))) {
        return String(uriCandidate);
      }

      const filesystem = getCapacitorFilesystemPlugin();
      if (!filesystem || typeof filesystem.writeFile !== "function") {
        return uriCandidate || null;
      }

      try {
        const XLSX = await loadSheetJS();
        const workbook = buildXlsWorkbook(XLSX, xlsData || [], "곰추정위치");
        const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
        const base64Data = bytesToBase64(new Uint8Array(buffer));

        const cachePath = "BearMapShare/" + fileName;
        await filesystem.writeFile({
          path: cachePath,
          data: base64Data,
          directory: "CACHE",
          recursive: true
        });

        if (typeof filesystem.getUri === "function") {
          const uriRes = await filesystem.getUri({ path: cachePath, directory: "CACHE" });
          const cacheUri = uriRes && uriRes.uri ? String(uriRes.uri) : null;
          if (cacheUri && /^(file:|content:)/i.test(cacheUri)) {
            return cacheUri;
          }
        }
      } catch (cacheError) {
        console.warn("XLS 공유용 캐시 파일 준비 실패:", cacheError);
      }

      return uriCandidate || null;
    }

    async function saveXlsToNativeDocuments(fileName, xlsData) {
      const filesystem = getCapacitorFilesystemPlugin();
      if (!filesystem || typeof filesystem.writeFile !== "function") {
        if (statusEl) statusEl.textContent = "⚠️ XLS 저장 플러그인이 없습니다.";
        return null;
      }

      const XLSX = await loadSheetJS();
      const workbook = buildXlsWorkbook(XLSX, xlsData, "곰추정위치");

      const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
      const base64Data = bytesToBase64(new Uint8Array(buffer));

      const relativePath = "BearMap/" + fileName;
      await filesystem.writeFile({
        path: relativePath,
        data: base64Data,
        directory: "DOCUMENTS",
        recursive: true
      });

      let savedUri = null;
      if (typeof filesystem.getUri === "function") {
        try {
          const uriRes = await filesystem.getUri({ path: relativePath, directory: "DOCUMENTS" });
          savedUri = uriRes && uriRes.uri ? uriRes.uri : null;
        } catch (uriError) {
          console.warn("XLS 저장 파일 URI 조회 실패:", uriError);
        }
      }

      return {
        fileName: fileName,
        relativePath: relativePath,
        savedUri: savedUri
      };
    }

    async function shareSavedXlsFile(fileName, savedUri, xlsData) {
      const sharePlugin = getCapacitorSharePlugin();

      if (!sharePlugin || typeof sharePlugin.share !== "function") {
        if (statusEl) statusEl.textContent = "⚠️ 공유 플러그인이 없습니다.";
        return false;
      }

      const fileUri = await ensureXlsFileUriForShare(fileName, savedUri, xlsData);
      if (!fileUri || !/^(file:|content:)/i.test(String(fileUri))) {
        if (statusEl) statusEl.textContent = "⚠️ XLS 공유 파일 경로를 찾지 못했습니다.";
        return false;
      }

      try {
        await sharePlugin.share({
          title: fileName,
          files: [fileUri],
          dialogTitle: "XLS 공유"
        });
        if (statusEl) statusEl.textContent = "✅ 공유 창을 열었습니다: " + fileName;
        return true;
      } catch (shareError) {
        if (shareError && /cancel/i.test(shareError.message || "")) { return false; }
        console.warn("XLS 공유 실패:", shareError);
        if (statusEl) {
          statusEl.textContent = "🔴 공유 실패: " + (shareError && shareError.message ? shareError.message : String(shareError));
        }
        return false;
      }
    }

  function renderBears(items, isFallback) {
    if (!bearsListEl) return;
    items = getFilteredBearEstimates(Array.isArray(items) ? items : []);
    const searching = !!String(bearCodeSearchEl?.value || "").trim() || !!bearTeamFilterEl?.value || readBearPeriodFilter().period !== "all";
    syncSelectedBearEstimateIds(items);
    if (realtimeListModule && typeof realtimeListModule.bindEstimateItems === "function") {
      realtimeListModule.bindEstimateItems(items);
    }
    bearListPages.beforeClear();
    bearsListEl.innerHTML = "";

    if (!items || items.length === 0) {
      bearListPages.render([], () => {});
      bearsListEl.innerHTML = searching ? '<div class="bears-search-empty" role="status">조건에 맞는 개체 추적 기록이 없습니다.<small>검색어나 필터를 바꾸거나 초기화해주세요.</small></div>' : [
        '<div class="bears-empty" role="status" aria-live="polite">',
        '  <div class="bears-empty__icon" aria-hidden="true">🐻</div>',
        '  <div class="bears-empty__title">곰 추적위치 목록이 비어 있습니다</div>',
        '  <div class="bears-empty__desc">관측점 위치분석 결과를 저장하면 목록이 표시됩니다.</div>',
        '  <div class="bears-empty__hint">관측점 목록에서 1개 이상 선택 후 위치분석을 실행해보세요.</div>',
        '  <button class="bears-empty__action" type="button">관측점 목록 열기</button>',
        '</div>'
      ].join('');
      if (bearsToolbarSummaryEl) {
        bearsToolbarSummaryEl.hidden = !searching;
        bearsToolbarSummaryEl.textContent = searching ? "0 / " + currentBearEstimateItems.length + "건" : "";
      }
      updateBearEstimateToolbar([]);
      return;
    }

    if (bearsToolbarSummaryEl) {
      bearsToolbarSummaryEl.innerHTML = '<img src="css/image/icon_bear.png" style="height:16px;vertical-align:middle;margin-right:4px;" alt="곰"/> ' + items.length + (searching ? ' / ' + currentBearEstimateItems.length + '건' : '건 표시됨') + (isFallback ? ' <span style="font-size:11px;opacity:.6">(샘플)</span>' : '');
      bearsToolbarSummaryEl.hidden = false;
    }

    bearListPages.render(items, function (it) {
      const itemId = String(it.id);
      const isSelected = selectedBearEstimateIds.has(itemId);
      const el = document.createElement("div");
      el.className = "bears-item bears-item--unified" + (isSelected ? " is-selected" : "");
      const bearCode = it.bear_code || it.bearCode || "-";
      const ownerName = normalizeOwnerName(it.owner) || "미지정";
      const regionName = it.admin_region || "미지정";
      const teamName = String(it.team_name || "팀 미지정");
      const teamColor = /^#[0-9a-f]{6}$/i.test(String(it.team_color || "")) ? it.team_color : "#7e90a2";
      const isShared = !!it.shared_at;
      el.innerHTML =
        '<div class="bears-item__select">' +
          '<input class="bears-item__checkbox" type="checkbox" aria-label="곰 추정위치 선택" ' + (isSelected ? 'checked' : '') + ' />' +
        '</div>' +
        '<div class="bears-item__main">' +
          '<div class="bears-item__code"><b>' + escapeHtml(bearCode) + '</b>' + (isShared ? '<span class="bears-item__shared-badge" role="status">공유완료</span>' : '') + '</div>' +
        '</div>' +
        '<div class="bears-item__meta bears-item__meta--send">' +
          '<div class="bears-item__buttons">' +
            '<button class="bears-txt-dl-btn" type="button" aria-label="TXT 다운로드" title="TXT 다운로드"><svg class="bears-download-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M12 11v7m-3-3 3 3 3-3"/></svg><span class="bears-txt-dl-btn__label">TXT</span></button>' +
            '<button class="bears-xls-dl-btn" type="button" aria-label="XLS 다운로드" title="XLS 다운로드"><svg class="bears-download-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M8 12h8v6H8zM8 15h8m-4-3v6"/></svg><span class="bears-xls-dl-btn__label">XLS</span></button>' +
          '</div>' +
            (isShared ? '' : pendingBearUploads.has(itemId)
                ? '<span class="bear-share-control bear-share-control--sending">공유 중</span>'
                : '<button class="bear-share-control bear-share-control--needed" type="button">공유 필요</button>') +
        '</div>' +
        '<div class="bears-item__detail-frame"><table class="bears-item__detail-table" aria-label="개체 추적위치 정보"><tbody>' +
          '<tr><th scope="row">등록자</th><td><div class="bears-item__registrar"><span class="bears-item__detail-value" title="' + escapeHtml(ownerName) + '">' + escapeHtml(ownerName) + '</span><span class="bears-item__team" style="--team-color:' + teamColor + '" title="' + escapeHtml(teamName) + '" aria-label="소속 팀 ' + escapeHtml(teamName) + '"><i aria-hidden="true"></i><span>' + escapeHtml(teamName) + '</span></span></div></td></tr>' +
          '<tr><th scope="row">추정 방식</th><td>' + buildEstimationMethodHtml(it) + '</td></tr>' +
          '<tr><th scope="row">위치</th><td><span class="bears-item__detail-value" title="' + escapeHtml(regionName) + '">' + escapeHtml(regionName) + '</span></td></tr>' +
        '</tbody></table></div>';

      el.addEventListener("click", function () {
        focusBearListItem(it.id, !!it.remoteOnly, [it.lat, it.lng]);
        if (statusEl) {
          statusEl.textContent = bearCode !== "-"
            ? `[${bearCode}] 개체의 추적 위치로 이동했습니다.`
            : "선택한 개체의 추적 위치로 이동했습니다.";
          statusEl.style.color = "#0a6f30";
        }
      });

      const dlBtn = el.querySelector(".bears-txt-dl-btn");
      if (dlBtn) {
        dlBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          downloadBearEstimateTxt(it, !!isFallback);
        });
      }

      const xlsBtn = el.querySelector(".bears-xls-dl-btn");
      if (xlsBtn) {
        xlsBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          downloadBearEstimateXls(it, !!isFallback);
        });
      }

      const sendBtn = el.querySelector(".bear-share-control--needed");
      if (sendBtn) sendBtn.addEventListener("click", async function (event) {
        event.stopPropagation();
        await uploadUnsharedBearEstimates([it]);
      });

      const checkboxEl = el.querySelector(".bears-item__checkbox");
      if (checkboxEl) {
        checkboxEl.addEventListener("click", function (e) {
          e.stopPropagation();
        });
        checkboxEl.addEventListener("change", function (e) {
          if (e.target.checked) selectedBearEstimateIds.add(itemId);
          else selectedBearEstimateIds.delete(itemId);
          renderBears(currentBearEstimateItems, currentBearEstimateFallbackMode);
        });
      }

      bearsListEl.appendChild(el);
    });

    updateBearEstimateToolbar(items);
  }

  // 곰 목록 패널/마커를 동기화한다. 초기 시점 보존을 위해 자동 fit은 하지 않는다.
  async function refreshBearEstimatePanel() {
    const initState = await initializeEmbeddedDatabase();
    const isWebFallbackMode = !!(initState && initState.reason === "non-native-platform");

    if (!isWebFallbackMode && (!initState || !initState.ready)) {
      if (statusEl) statusEl.textContent = "🟠 SQLite 연결 대기 중입니다";
      currentBearEstimateItems = [];
      currentBearEstimateFallbackMode = false;
      renderBears([], false);
      renderBearMarkers([]);
      return;
    }

    const sqlite = getCapacitorSQLitePlugin();
    const dbName = window.BearSQLiteConfig && window.BearSQLiteConfig.dbName
      ? window.BearSQLiteConfig.dbName
      : "BearPointData";

    let items = [];
    let usedFallback = false;
    let hasQueryError = false;

    async function queryBearEstimatesRows() {
      let result = null;
      try {
        // 최신 스키마(lat_dms/lng_dms 컬럼 포함) 우선 조회
        result = await sqlite.query({
          database: dbName,
          statement: "SELECT * FROM bear_estimates ORDER BY created_at DESC",
          values: [],
          readonly: false
        });
      } catch (primaryQueryError) {
        const message = String(primaryQueryError && primaryQueryError.message ? primaryQueryError.message : primaryQueryError);
        if (/no such column: owner|no such column: place|no such column: admin_region|no such column: lat_dms|no such column: lng_dms|no such column: source_observations_json|no such column: analysis_options_json|no such column: analysis_rays_json|no such column: intersections_json|no such column: shared_at/i.test(message)) {
          // 구버전 DB(도분초 컬럼 미생성)에서도 목록이 보이도록 하위호환 조회
          result = await sqlite.query({
            database: dbName,
            statement: "SELECT id, bear_code, lat, lng, intersections_count, created_at FROM bear_estimates ORDER BY created_at DESC",
            values: [],
            readonly: false
          });
        } else {
          throw primaryQueryError;
        }
      }

      return result;
    }

    if (sqlite) {
      try {
        let result = await queryBearEstimatesRows();

        // 앱 첫 진입 타이밍에 연결 핸들이 늦게 준비되는 단말 대응: 1회 재초기화 후 재조회.
        if (!result || !Array.isArray(result.values)) {
          const retryState = await initializeEmbeddedDatabase();
          if (retryState && retryState.ready) {
            result = await queryBearEstimatesRows();
          }
        }

        if (result && Array.isArray(result.values)) {
          items = result.values.filter(function (row) {
            return row && typeof row === "object" && Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lng));
          }).map(function (row) {
            return {
              id: row.id,
              bear_code: String(row.bear_code || "-"),
              owner: normalizeOwnerName(row.owner) || "미지정",
              team_id: row.team_id || null,
              team_name: row.team_name || null,
              team_color: row.team_color || null,
              place: normalizePlaceName(row.place) || "미지정",
              admin_region: row.admin_region || null,
              lat: Number(row.lat),
              lng: Number(row.lng),
              lat_dms: row.lat_dms || null,
              lng_dms: row.lng_dms || null,
              estimation_method: row.estimation_method || null,
              intersections_count: row.intersections_count,
              source_observations: parseBearEstimateJson(row.source_observations_json, "array"),
              analysis_options: normalizeAnalysisOptions(row.analysis_options_json),
              analysis_rays: parseBearEstimateJson(row.analysis_rays_json, "array"),
              analysis_intersections: parseBearEstimateJson(row.intersections_json, "array"),
              shared_at: row.shared_at || null,
              share_pending: row.share_pending,
              created_at: row.created_at
            };
          });
        }
      } catch (queryError) {
        const message = String(queryError && queryError.message ? queryError.message : queryError);
        const isConnectionNotReady = /No available connection for database/i.test(message);

        if (isConnectionNotReady) {
          // 시작 직후 일시적 연결 지연은 오류 대신 대기 상태로 안내한다.
          if (statusEl) statusEl.textContent = "🟠 SQLite 연결 대기 중입니다";
        } else {
          hasQueryError = true;
          console.warn("[bear_estimates] 조회 실패:", queryError);
          if (statusEl) {
            statusEl.textContent = "🔴 곰 추정위치 조회 실패: " + message;
          }
        }
      }
    }

    if (isWebFallbackMode) {
      try {
        items = (await localEstimateStore.list()).map(row => ({ ...row,
          lat: Number(row.lat), lng: Number(row.lng),
          source_observations: parseBearEstimateJson(row.source_observations_json, "array"),
          analysis_options: normalizeAnalysisOptions(row.analysis_options_json),
          analysis_rays: parseBearEstimateJson(row.analysis_rays_json, "array"),
          analysis_intersections: parseBearEstimateJson(row.intersections_json, "array") }));
      } catch (error) { hasQueryError = true; if (statusEl) statusEl.textContent = "개체 위치 자료를 읽지 못했습니다: " + error.message; }
    }
    if (!hasQueryError) localBearEstimateItems = items.slice();
    currentBearEstimateFallbackMode = false;
    try {
      await unifiedBearStore.load();
      remoteSharedEstimateIds = new Set(unifiedBearStore.raw().map(window.BearEstimateStore.originId).filter(Boolean));
    } catch (error) { console.warn("[bear_estimates] cache load failed", error); }
    bearPanelReady = true;
    await reconcileSharedBearEstimates();
    repaintUnifiedBearList();

    if (!currentBearEstimateItems.length) {
      if (!hasQueryError && statusEl) statusEl.textContent = "🟠 표시할 곰 추정위치가 없습니다";
      return;
    }
  }

  mountAnalysisActionBar();

  if (btnPanelToggle && panelEl) {
    btnPanelToggle.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();

      const collapsed = panelEl.classList.toggle("collapsed");
      btnPanelToggle.textContent = collapsed ? "▲" : "▼";
      btnPanelToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
  }

  if (panelEl) panelEl.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
  if (panelEl) panelEl.addEventListener("touchstart", function (e) { e.stopPropagation(); }, { passive: true });
  if (panelEl) panelEl.addEventListener("wheel", function (e) { e.stopPropagation(); }, { passive: true });

  if (btnSidebarToggle) {
    btnSidebarToggle.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (!isTabletLandscapeSidebarMode()) return;
      const isCollapsed = document.body && document.body.classList.contains("bp-sidebar-collapsed");
      setTabletSidebarCollapsed(!isCollapsed);
    });
  }

  // 화면 폭/회전이 바뀔 때 태블릿 사이드바와 패널 상태를 현재 UI에 맞게 재정렬한다.
  var tabletSidebarMq = window.matchMedia("(min-width: 900px) and (orientation: landscape)");
  var onTabletSidebarMqChange = function () {
    var isTablet = !!tabletSidebarMq.matches;
    var registerBox = document.getElementById("register-box");
    var isRegisterOpen = !!(registerBox && !registerBox.classList.contains("hidden"));

    if (isTablet) {
      // 폰에서 접힌 상태로 넘어오면 태블릿에서 목록 패널이 통째로 안 보일 수 있어 강제 확장한다.
      expandBearEstimatePanel();
      // 등록/수정이 열려 있으면 접힘 유지, 아니면 펼침 복귀.
      setTabletSidebarCollapsed(isRegisterOpen);

      // 목록 탭 상태인데 이전에 숨김 처리되어 있었다면 태블릿 진입 시 복원한다.
      if (!isRegisterOpen && !window.BearMobileDock?.isDocked() && obsListModule && typeof obsListModule.showPanel === "function") {
        obsListModule.showPanel();
      }
    } else {
      // 태블릿 범위를 벗어나면 사이드바 접힘 상태를 정리한다.
      setTabletSidebarCollapsed(false);
      if (obsListModule && obsListModule.getCurrentTab() === "list") collapseBearEstimatePanel();
    }

    if (map && typeof map.updateSize === "function") {
      map.updateSize();
    }
  };
  if (typeof tabletSidebarMq.addEventListener === "function") {
    tabletSidebarMq.addEventListener("change", onTabletSidebarMqChange);
  } else if (typeof tabletSidebarMq.addListener === "function") {
    tabletSidebarMq.addListener(onTabletSidebarMqChange);
  }
  setTabletSidebarCollapsed(false);

  obsListModule = window.createObsListModule ? window.createObsListModule({
    map: olMapAdapter,
    statusEl: statusEl,
    flyToLatLng: flyToLatLng,
    fitToPoints: fitToPoints,
    observationMarkersLayer: observationMarkersLayer,
    onOpenList: function () {
      if (isCompactPhoneMeasureLayout() && controlsManager && typeof controlsManager.deactivateMeasure === "function") {
        controlsManager.deactivateMeasure("menu");
      }
      closeObservationPopup();
      setTabletSidebarCollapsed(false);
      // 큰 화면의 개체 목록은 관측점 팝업을 열어도 그대로 유지한다.
      if (!isTabletLandscapeSidebarMode()) collapseBearEstimatePanel();
    },
    onOpenRegister: function () { openObservationRegistration(); },
    onEditObservation: function (item) {
      openObservationEdit(item);
    },
    onCloseRegister: function () {
      setCurrentEditingObservationId(null);
      clearEditOriginMarker();
      setTabletSidebarCollapsed(false);
      if (obsRegisterModule) obsRegisterModule.hide(true);
    },
    onAnalysisResult: function (analysisPoint) {
      if (controlsManager && typeof controlsManager.deactivateMeasure === "function") {
        controlsManager.deactivateMeasure("analysis");
      }
      renderAnalysisEstimatePoint(analysisPoint); // 내부에서 currentAnalysisPoint 설정
    },
    onAnalysisPreview: function (previewPayload) {
      if (previewPayload && controlsManager && typeof controlsManager.deactivateMeasure === "function") {
        controlsManager.deactivateMeasure("analysis");
      }
      renderAnalysisInputPreview(previewPayload);
    },
    onClearAnalysisEstimate: function () {
      clearAnalysisEstimateVisuals();
    }
  }) : null;

  function openObservationRegistration(sdrContext, onCancel) {
      if (!obsRegisterModule) return false;
      if (sdrContext && obsRegisterModule.isOpen()) return obsRegisterModule.openFromSdr(sdrContext, onCancel);
      if (controlsManager && typeof controlsManager.deactivateMeasure === "function") {
        controlsManager.deactivateMeasure("menu");
      }
      setCurrentEditingObservationId(null);
      closeObservationPopup();
      if (isTabletLandscapeSidebarMode()) {
        setTabletSidebarCollapsed(true);
        expandBearEstimatePanel();
      } else {
        collapseBearEstimatePanel();
      }
      clearEditOriginMarker();
      // 등록 팝업이 열리는 동안 목록 패널을 숨긴다.
      if (obsListModule && typeof obsListModule.hidePanel === "function") obsListModule.hidePanel();
      if (sdrContext) return obsRegisterModule.openFromSdr(sdrContext, onCancel);
      obsRegisterModule.open();
      return true;
  }
  window.BearSdrRegistration = { open: openObservationRegistration };

  if (obsRegisterModule) {
    obsRegisterModule.initialize();
    obsRegisterModule.updateLiveData({
      lat: null,
      lng: null,
      heading: null,
      timestamp: null,
      isGpsActive: false
    });
  }
  updateRegistrationPreview();
  if (obsListModule) obsListModule.initialize();
  window.createMobileMapDock({ observations: obsListModule, gps: gpsTrackUi, expandBears: expandBearEstimatePanel, setSidebarCollapsed: setTabletSidebarCollapsed,
    onBeforeOpen: function () { closeObservationPopup(); controlsManager?.deactivateMeasure?.('menu'); } });
  ensureStartupOverlay();
  if (startupOverlayRetryBtn && startupOverlayRetryBtn.dataset.bound !== "1") {
    startupOverlayRetryBtn.dataset.bound = "1";
    startupOverlayRetryBtn.addEventListener("click", function () {
      bootWithSQLiteGate();
    });
  }
  bootWithSQLiteGate();
  void window.BearStartupReady.then(() => refreshUnifiedBearList({ silent: true }));
  if (isNativeCapacitorPlatform()) {
    void window.BearPushNavigation?.start({
      plugin: window.Capacitor?.Plugins?.BearPush,
      ready: window.BearStartupReady,
      open: async function (serverId, isCurrent) {
        // Notification links identify a specific shared record, never just an animal code.
        await refreshBearEstimatePanel();
        const response = await realtimeListModule?.refresh({silent: true});
        if (!isCurrent()) return;
        const item = currentBearEstimateItems.find(row => String(row.server_id) === serverId);
        if (bearCodeSearchEl) bearCodeSearchEl.value = '';
        if (bearTeamFilterEl) bearTeamFilterEl.value = '';
        if (bearPeriodFilterEl) bearPeriodFilterEl.value = 'all';
        if (bearFilterPanelEl) bearFilterPanelEl.hidden = true;
        btnBearFilterEl?.setAttribute('aria-expanded', 'false');
        if (window.BearMobileDock?.isDocked()) window.BearMobileDock.select('bears');
        else ensureBearEstimatePanelVisible();
        repaintUnifiedBearList();
        if (!item) {
          window.__bpShowToast(response?.ok === false
            ? '알림의 위치를 불러오지 못했습니다. 인터넷 연결을 확인하고 목록을 새로고침해주세요.'
            : '해당 추적 위치가 삭제되었거나 더 이상 조회되지 않습니다.');
          return;
        }
        focusBearListItem(item.id, !!item.remoteOnly, [Number(item.lat), Number(item.lng)]);
      },
      onError: function () { window.__bpShowToast('알림의 추적 위치를 열지 못했습니다. 개체 추적 목록에서 다시 확인해주세요.'); }
    });
  }
  setupAndroidBackButtonExit().catch(function (error) {
    console.error("안드로이드 뒤로가기 초기화 오류:", error);
  });

  setTimeout(function () {
    if (!statusEl) return;
    if (tileLoadSuccessCount === 0 && tileLoadErrorCount === 0) {
      //statusEl.textContent = "🟠 타일 요청 없음 (지도 초기화/레이어 설정 확인)";
      statusEl.textContent = "🟠 타일 요청 없음";
      return;
    }
    if (tileLoadSuccessCount === 0 && tileLoadErrorCount > 0) {
      //statusEl.textContent = "🟠 타일 요청 실패 " + tileLoadErrorCount + "건";
      statusEl.textContent = "🟠 타일 요청 실패 ";
    }
  }, 5000);
  } catch (error) {
    console.error("client-ol.js 초기화 오류:", error);
    if (statusEl) {
      statusEl.textContent = "🔴 오류: " + (error && error.message ? error.message : String(error));
    }
  }
})();
