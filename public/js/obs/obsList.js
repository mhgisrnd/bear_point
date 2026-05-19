// public/js/obs/obsList.js
//관측점 목록

window.createObsListModule = function createObsListModule({
  map,
  statusEl,
  flyToLatLng,
  fitToPoints,
  observationMarkersLayer,
  onOpenList,
  onOpenRegister,
  onCloseRegister,
  onEditObservation,
  onAnalysisResult,
  onAnalysisPreview,
  onClearAnalysisEstimate
}) {
  const btnBear = document.getElementById("btn-obs-list");
  const btnObsAdd = document.getElementById("btn-obs-add-inline");
  const btnAnalysis = document.getElementById("btn-analysis");
  const btnDeleteSelected = document.getElementById("btn-delete-selected");
  const btnObsListPeek = document.getElementById("btn-obs-list-peek");
  const btnObsListClose = document.getElementById("btn-obs-list-close");

  const obsSheetEl = document.getElementById("obs-sheet");
  const obsSheetHeaderEl = obsSheetEl ? obsSheetEl.querySelector(".obs-sheet-header") : null;
  const obsListPanelEl = document.getElementById("obs-list-panel");
  const obsListBodyEl = document.getElementById("obs-list-body");
  const obsTableWrapEl = document.querySelector(".obs-table-wrap");
  const obsTableBodyScrollableEl = document.querySelector(".obs-table tbody");
  const obsListStatusEl = document.getElementById("obs-list-status");
  const obsListCountEl = document.getElementById("obs-list-count");
  const obsSelectedCountEl = document.getElementById("obs-selected-count");
  const searchFieldEl = document.getElementById("search-field");
  const searchQueryEl = document.getElementById("search-query");
  const btnSearchClearEl = document.getElementById("btn-search-clear");
  const chkAllEl = document.getElementById("chk-all");
  const OBSERVATION_DEMO_URL = "json/observations.json"; //웹 더미 데이터 URL

  const selectedObsIds = new Set();
  const observationMarkers = [];
  let observationSamples = [];
  // 앱(SQLite) 경로는 저장 직후 재조회가 일어나므로, ID별 플래시 만료시각을 별도로 보관한다.
  const observationFlashUntilById = new Map();
  const observationFlashPresetById = new Map();
  let currentTab = "none";
  let isPeekMode = false;
  let observationKeySeed = 0;
  const OBS_SAVE_FLASH_DURATION_MS = 4600;
  let analysisOptionsDialogState = null;
  let analysisCloseSilently = false;
  // 목록 패널 드래그 상태(헤더 포인터 기반)
  let isDraggingSheet = false;
  let dragPointerId = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  // 태블릿 가로에서 obs-sheet 실제 높이를 CSS 변수로 동기화하는 ResizeObserver
  var _tabletLandscapeMq = window.matchMedia(
    "(min-width: 900px) and (orientation: landscape)"
  );
  var _obsSheetResizeObserver = null;
  var _tabletPanelHideTimer = null;
  var TABLET_PANEL_TRANSITION_MS = 190;

  function _isTabletLandscape() {
    return !!(_tabletLandscapeMq && _tabletLandscapeMq.matches);
  }

  function _clearTabletPanelHideTimer() {
    if (_tabletPanelHideTimer) {
      window.clearTimeout(_tabletPanelHideTimer);
      _tabletPanelHideTimer = null;
    }
  }

  function _setTabletPanelVisualState(isOpen) {
    const targets = [obsSheetEl, obsListPanelEl].filter(Boolean);
    if (targets.length < 1) return;

    if (!_isTabletLandscape()) {
      targets.forEach((el) => {
        el.classList.remove("bp-tablet-panel-open");
        el.classList.remove("bp-tablet-panel-closing");
      });
      return;
    }

    targets.forEach((el) => {
      el.classList.remove("bp-tablet-panel-closing");
      if (isOpen) {
        el.classList.add("bp-tablet-panel-open");
      } else {
        el.classList.remove("bp-tablet-panel-open");
      }
    });
  }

  function _showListPanels() {
    _clearTabletPanelHideTimer();
    if (obsSheetEl) obsSheetEl.classList.remove("hidden");
    if (obsListPanelEl) obsListPanelEl.classList.remove("hidden");

    if (!_isTabletLandscape()) return;

    _setTabletPanelVisualState(false);
    window.requestAnimationFrame(function () {
      _setTabletPanelVisualState(true);
    });
  }

  function _hideListPanels() {
    _clearTabletPanelHideTimer();

    if (!_isTabletLandscape()) {
      if (obsSheetEl) obsSheetEl.classList.add("hidden");
      if (obsListPanelEl) obsListPanelEl.classList.add("hidden");
      _setTabletPanelVisualState(false);
      return;
    }

    const targets = [obsSheetEl, obsListPanelEl].filter(Boolean);
    if (targets.length < 1) return;

    targets.forEach((el) => {
      el.classList.add("bp-tablet-panel-closing");
      el.classList.remove("bp-tablet-panel-open");
    });

    _tabletPanelHideTimer = window.setTimeout(function () {
      if (obsSheetEl) obsSheetEl.classList.add("hidden");
      if (obsListPanelEl) obsListPanelEl.classList.add("hidden");
      targets.forEach((el) => {
        el.classList.remove("bp-tablet-panel-closing");
      });
      _tabletPanelHideTimer = null;
    }, TABLET_PANEL_TRANSITION_MS);
  }

  // 태블릿 가로에서 관측점 목록 실제 높이를 읽어 하단 패널 배치용 CSS 변수로 반영한다.
  function _startObsSheetResize() {
    if (!obsSheetEl || typeof ResizeObserver === "undefined") return;
    if (_obsSheetResizeObserver) _obsSheetResizeObserver.disconnect();
    _obsSheetResizeObserver = new ResizeObserver(function (entries) {
      if (!_tabletLandscapeMq.matches) return;
      var entry = entries[0];
      if (!entry) return;
      var h = Math.round(
        entry.borderBoxSize ? entry.borderBoxSize[0].blockSize : entry.contentRect.height
      );
      document.documentElement.style.setProperty("--bp-obs-sheet-actual-h", h + "px");
    });
    _obsSheetResizeObserver.observe(obsSheetEl);
  }

  // 태블릿 높이 동기화를 중단하고, 관련 CSS 변수를 정리한다.
  function _stopObsSheetResize() {
    if (_obsSheetResizeObserver) {
      _obsSheetResizeObserver.disconnect();
      _obsSheetResizeObserver = null;
    }
    document.documentElement.style.removeProperty("--bp-obs-sheet-actual-h");
  }

  function highlightStatusOnce() {
    if (typeof window.__bpTriggerStatusHighlight === "function") {
      window.__bpTriggerStatusHighlight();
    }
  }

  function triggerLightErrorVibration() {
    // client-ol.js에서 전역로 노출한 Haptics 함수를 사용한다.
    // 부재 시 navigator.vibrate 폴백 (Haptics는 터치 없이도 동작하지만
    // 이 오류는 반드시 버튼 탭 후 발생하므로 폴백도 정상 동작한다)
    if (typeof window.__bpTriggerHapticImpact === "function") {
      window.__bpTriggerHapticImpact("LIGHT");
      return;
    }
    // 최종 폴백: Haptics 노출 전 또는 브라우저 환경
    if (typeof window.navigator !== "undefined" && window.navigator && typeof window.navigator.vibrate === "function") {
      try {
        const vibrateMs = (window.__bpVibrateConfig && window.__bpVibrateConfig.FEEDBACK) || 22;
        window.navigator.vibrate(vibrateMs);
      } catch (error) {}
    }
  }

  async function confirmWithStyledDialog(options) {
    const opts = options || {};
    if (typeof window.__bpShowConfirmDialog === "function") {
      try {
        return await window.__bpShowConfirmDialog(opts);
      } catch (error) {
        console.warn("[OBS] styled confirm fallback:", error);
      }
    }

    const fallbackMessage = String(opts.message || "계속 진행할까요?");
    const fallbackDetail = opts.detail ? "\n\n" + String(opts.detail) : "";
    return window.confirm(fallbackMessage + fallbackDetail);
  }

  function cleanupObservationFlashCache(nowTs) {
    const now = Number.isFinite(nowTs) ? nowTs : Date.now();
    observationFlashUntilById.forEach(function (untilTs, obsId) {
      if (!Number.isFinite(untilTs) || untilTs <= now) {
        observationFlashUntilById.delete(obsId);
        observationFlashPresetById.delete(obsId);
      }
    });
  }

  // 저장/수정 직후 해당 관측점 ID에 2초 하이라이트 타이머를 기록한다.
  function markObservationFlashById(obsId, preset) {
    const id = String(obsId == null ? "" : obsId).trim();
    if (!id) return 0;
    const untilTs = Date.now() + OBS_SAVE_FLASH_DURATION_MS;
    observationFlashUntilById.set(id, untilTs);
    observationFlashPresetById.set(id, String(preset || "default").trim() || "default");
    return untilTs;
  }

  function getObservationLabel(item) {
    if (!item) return "";
    return item.place ? String(item.place).trim() : item.id;
  }

  function getObservationMarkerText(item) {
    const label = getObservationLabel(item);
    if (!label) return "관측점";
    return label.length > 10 ? `${label.slice(0, 10)}...` : label;
  }

  function isNativePlatform() {
    return !!(
      window.Capacitor &&
      typeof window.Capacitor.isNativePlatform === "function" &&
      window.Capacitor.isNativePlatform()
    );
  }

  function toHeadingText(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "";
    return `${numeric}°`;
  }

  function formatCoordinate(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric.toFixed(6) : "-";
  }

  function formatDateTimeSeconds(value) {
    if (value == null || value === "") return "-";

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const yyyy = value.getFullYear();
      const mm = String(value.getMonth() + 1).padStart(2, "0");
      const dd = String(value.getDate()).padStart(2, "0");
      const hh = String(value.getHours()).padStart(2, "0");
      const mi = String(value.getMinutes()).padStart(2, "0");
      const ss = String(value.getSeconds()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
    }

    const text = String(value).trim();
    if (!text) return "-";

    // ISO 문자열은 소수초/타임존을 제거해 초 단위까지만 표시한다.
    if (text.includes("T")) {
      return text.replace("T", " ").replace(/\.\d+/, "").replace(/Z$/, "").replace(/[+-]\d{2}:\d{2}$/, "");
    }

    return text.replace(/\.\d+/, "");
  }

  // 팝업 HTML에 들어갈 문자열을 기본적인 엔티티로 이스케이프한다.
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // 감지기 목록을 2열 표(감지기명/감도세기) HTML로 만든다.
  function buildDetectorRowsHtml(detectors) {
    const rows = (Array.isArray(detectors) ? detectors : [])
      .map((det) => {
        const name = String(det && det.detectorName ? det.detectorName : "").trim();
        const strength = String(det && det.signalStrength ? det.signalStrength : "").trim();
        return { name, strength };
      })
      .filter((row) => row.name || row.strength)
      .slice(0, 3);

    const bodyRows = rows.length > 0
      ? rows
        .map((row) => `
          <div class="obs-popup-det-table__row">
            <span class="obs-popup-det-table__cell">${escapeHtml(row.name || "-")}</span>
            <span class="obs-popup-det-table__cell">${escapeHtml(row.strength || "-")}</span>
          </div>
        `)
        .join("")
      : `
        <div class="obs-popup-det-table__row">
          <span class="obs-popup-det-table__cell">-</span>
          <span class="obs-popup-det-table__cell">-</span>
        </div>
      `;

    return `
      <div class="obs-popup-det-table__head">
        <span class="obs-popup-det-table__head-cell">감지기명</span>
        <span class="obs-popup-det-table__head-cell">감도세기</span>
      </div>
      ${bodyRows}
    `;
  }

  // Leaflet/OpenLayers 양쪽에서 재사용하는 관측점 정보 카드 마크업을 만든다.
  function buildObservationPopupHtml(item) {
    const title = escapeHtml(getObservationLabel(item) || "관측점");
    const bearCode = escapeHtml(item && item.bearCode ? item.bearCode : "-");
    const owner = escapeHtml(item && item.owner ? item.owner : "-");
    const xCoord = formatCoordinate(item && item.lat);
    const yCoord = formatCoordinate(item && item.lng);
    const heading = escapeHtml(item && item.heading ? item.heading : "-");
    const detectorRowsHtml = buildDetectorRowsHtml(item && item.detectors);
    const createdAt = escapeHtml(formatDateTimeSeconds(item && item.createdAt));

    return `
      <div class="obs-popup-card">
        <div class="obs-popup-card__eyebrow">${title}</div>
        <div class="obs-popup-card__grid">
          <div class="obs-popup-card__row">
            <span class="obs-popup-card__label">코드</span>
            <span class="obs-popup-card__value">${bearCode}</span>
          </div>
          <div class="obs-popup-card__row">
            <span class="obs-popup-card__label">담당자</span>
            <span class="obs-popup-card__value">${owner}</span>
          </div>
          <div class="obs-popup-card__row">
            <span class="obs-popup-card__label">위경도</span>
            <div class="obs-popup-card__value obs-popup-card__value--coord">
              <span>X: ${escapeHtml(xCoord)}</span>
              <span>Y: ${escapeHtml(yCoord)}</span>
            </div>
          </div>
          <div class="obs-popup-card__row">
            <span class="obs-popup-card__label">방향각</span>
            <span class="obs-popup-card__value">${heading}</span>
          </div>
          <div class="obs-popup-card__row obs-popup-card__row--wide">
            <span class="obs-popup-card__label">감지기</span>
            <div class="obs-popup-det-table">${detectorRowsHtml}</div>
          </div>
          <div class="obs-popup-card__row obs-popup-card__row--wide">
            <span class="obs-popup-card__label">최초 등록일시</span>
            <span class="obs-popup-card__value">${createdAt}</span>
          </div>
          <div class="obs-popup-card__row obs-popup-card__row--wide obs-popup-card__actions">
            <button class="obs-popup-card__action-btn obs-popup-card__action-btn--edit" type="button" data-observation-action="edit">수정</button>
            <button class="obs-popup-card__action-btn obs-popup-card__action-btn--delete" type="button" data-observation-action="delete">삭제</button>
          </div>
        </div>
      </div>
    `;
  }

  // SQLite row/더미 JSON row를 공통 관측점 모델 형태로 정규화한다.
  function mapObservationRow(row) {
    if (!row) return null;

    const id = String(row.id || "").trim();
    const bearCode = String(row.bear_code || row.bearCode || "").trim();
    const owner = String(row.owner || "").trim();
    const place = String(row.place || row.name || "").trim();
    const lat = Number(row.lat);
    const lng = Number(row.lng);
    const heading = toHeadingText(row.heading);
    let detectors = [];

    if (Array.isArray(row.detectors)) {
      detectors = row.detectors;
    } else if (typeof row.detectors_json === "string" && row.detectors_json.trim()) {
      try {
        const parsed = JSON.parse(row.detectors_json);
        detectors = Array.isArray(parsed) ? parsed : [];
      } catch (error) {
        detectors = [];
      }
    }

    detectors = (Array.isArray(detectors) ? detectors : [])
      .map((det) => {
        const detectorName = String(
          det && (det.detectorName || det.detector_name || det.name)
            ? (det.detectorName || det.detector_name || det.name)
            : ""
        ).trim();
        const signalStrength = String(
          det && (det.signalStrength || det.signal_strength || det.strength)
            ? (det.signalStrength || det.signal_strength || det.strength)
            : ""
        ).trim();
        return { detectorName, signalStrength };
      })
      .filter((det) => det.detectorName || det.signalStrength);

    if (!id || !bearCode || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }

    const now = Date.now();
    cleanupObservationFlashCache(now);
    const cachedFlashUntil = Number(observationFlashUntilById.get(id));
    const cachedFlashPreset = String(observationFlashPresetById.get(id) || "").trim();
    const hasActiveFlash = Number.isFinite(cachedFlashUntil) && cachedFlashUntil > now;

    return {
      id,
      place,
      bearCode,
      owner,
      lat,
      lng,
      heading,
      createdAt: row.created_at || row.createdAt || row.created || null,
      detectors,
      _saveFlashUntil: hasActiveFlash ? cachedFlashUntil : 0,
      _saveFlashPreset: hasActiveFlash ? (cachedFlashPreset || "default") : "default",
      _obsKey: `${id}::${observationKeySeed++}`
    };
  }

  // 웹 미리보기에서는 observations.json을 관측점 소스로 사용한다.
  async function loadObservationSamplesFromDemoJson() {
    try {
      observationKeySeed = 0;
      const response = await fetch(OBSERVATION_DEMO_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const rows = await response.json();
      const items = Array.isArray(rows) ? rows : [];
      observationSamples = items
        .map(mapObservationRow)
        .filter((item) => item !== null)
        .map((item, index) => {
          if (item.place) return item;
          return {
            ...item,
            place: `관측점 ${index + 1}`
          };
        });

      return { source: "demo" };
    } catch (error) {
      console.warn("[OBS] failed to load demo observations:", error);
      observationSamples = [];
      return { source: "empty" };
    }
  }

  // 실행 환경에 따라 웹 더미 JSON 또는 SQLite에서 관측점 목록을 읽어온다.
  async function loadObservationSamples() {
    if (!isNativePlatform()) {
      return loadObservationSamplesFromDemoJson();
    }

    const sqliteModule = window.BearSQLite;
    if (!sqliteModule || typeof sqliteModule.initialize !== "function") {
      observationSamples = [];
      return { source: "empty" };
    }

    try {
      observationKeySeed = 0;
      const initState = await sqliteModule.initialize();
      if (!initState || !initState.ready) {
        observationSamples = [];
        return { source: "empty" };
      }

      const sqlite = window.Capacitor && window.Capacitor.Plugins
        ? window.Capacitor.Plugins.CapacitorSQLite
        : null;
      if (!sqlite || typeof sqlite.query !== "function") {
        observationSamples = [];
        return { source: "empty" };
      }

      const dbName = window.BearSQLiteConfig && window.BearSQLiteConfig.dbName
        ? String(window.BearSQLiteConfig.dbName)
        : "BearPointData";

      const queryResult = await sqlite.query({
        database: dbName,
        statement: `
          SELECT id, place, bear_code, owner, lat, lng, heading, created_at, detectors_json
          FROM observations
          ORDER BY created_at DESC, id ASC
        `,
        values: [],
        readonly: false
      });

      const rows = Array.isArray(queryResult && queryResult.values) ? queryResult.values : [];
      const mappedRows = rows.map(mapObservationRow).filter((item) => item !== null);

      observationSamples = mappedRows;
      return { source: "sqlite" };
    } catch (error) {
      console.warn("[OBS] failed to load observations from sqlite:", error);
      observationSamples = [];
      return { source: "empty" };
    }
  }

  // 관측점 데이터 로드 이후 목록/마커/상태 문구를 한 번에 갱신한다.
  function updateObservationSummary() {
    if (!obsListStatusEl) return;

    const count = observationSamples.length;
    if (obsListCountEl) {
      obsListCountEl.textContent = `${count}건`;
    } else {
      obsListStatusEl.textContent = `${count}건`;
    }
    obsListStatusEl.hidden = false;
  }

  function updateMainStatusForList() {
    if (!statusEl || currentTab !== "list") return;
    if (typeof window.__bpSetDefaultStatus === "function") {
      window.__bpSetDefaultStatus();
    } else {
      statusEl.textContent = "반달가슴곰 위치추적분석";
    }
  }

  async function refreshObservationData() {
    await loadObservationSamples();
    selectedObsIds.clear();
    applySearch();
    renderObservationMarkers(observationSamples);
    updateSelectionUI();

    updateObservationSummary();
    updateMainStatusForList();
  }

  // 목록 패널 최소화/복원 상태를 토글하고 아이콘 상태를 동기화한다.
  function setPeekMode(nextState) {
    isPeekMode = !!nextState;
    if (obsSheetEl) obsSheetEl.classList.toggle("obs-sheet--peek", isPeekMode);
    if (btnObsListPeek) {
      btnObsListPeek.innerHTML = isPeekMode
        ? '<img src="css/svg/peek-expand-white.svg" alt="" aria-hidden="true" />'
        : '<img src="css/svg/peek-collapse-white.svg" alt="" aria-hidden="true" />';
      btnObsListPeek.setAttribute("aria-label", isPeekMode ? "확장" : "최소화");
      btnObsListPeek.setAttribute("title", isPeekMode ? "확장" : "최소화");
    }
  }

  // 헤더에서 드래그를 시작해 목록 패널의 절대 위치를 고정한다.
  function startSheetDrag(e) {
    if (!obsSheetEl || !obsSheetHeaderEl) return;
    if (!e || typeof e.clientX !== "number" || typeof e.clientY !== "number") return;
    // 헤더 내부의 실제 조작 요소(닫기/최소화/버튼)를 누른 경우 드래그 시작을 막는다.
    const interactiveTarget = e.target && e.target.closest
      ? e.target.closest("button, input, select, textarea, a, label")
      : null;
    if (interactiveTarget) return;

    const rect = obsSheetEl.getBoundingClientRect();
    isDraggingSheet = true;
    dragPointerId = e.pointerId;
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;

    // left/right 고정 레이아웃에서 드래그 시 폭이 튀지 않도록 현재 폭을 고정한다.
    obsSheetEl.style.width = `${Math.round(rect.width)}px`;
    obsSheetEl.style.right = "auto";
    obsSheetEl.style.left = `${Math.round(rect.left)}px`;
    obsSheetEl.style.top = `${Math.round(rect.top)}px`;

    if (obsSheetHeaderEl.setPointerCapture && typeof dragPointerId === "number") {
      obsSheetHeaderEl.setPointerCapture(dragPointerId);
    }
  }

  // 포인터 이동에 맞춰 목록 패널을 화면 경계 안에서 이동시킨다.
  function moveSheetDrag(e) {
    if (!isDraggingSheet || !obsSheetEl) return;
    if (!e || typeof e.clientX !== "number" || typeof e.clientY !== "number") return;
    if (dragPointerId != null && e.pointerId != null && e.pointerId !== dragPointerId) return;

    const maxLeft = Math.max(0, window.innerWidth - obsSheetEl.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - obsSheetEl.offsetHeight);
    let nextLeft = e.clientX - dragOffsetX;
    let nextTop = e.clientY - dragOffsetY;

    if (nextLeft < 0) nextLeft = 0;
    if (nextTop < 0) nextTop = 0;
    if (nextLeft > maxLeft) nextLeft = maxLeft;
    if (nextTop > maxTop) nextTop = maxTop;

    obsSheetEl.style.left = `${Math.round(nextLeft)}px`;
    obsSheetEl.style.top = `${Math.round(nextTop)}px`;
  }

  // 드래그 상태와 pointer capture를 정리한다.
  function endSheetDrag(e) {
    if (!isDraggingSheet) return;
    if (dragPointerId != null && e && e.pointerId != null && e.pointerId !== dragPointerId) return;

    if (obsSheetHeaderEl && obsSheetHeaderEl.releasePointerCapture && typeof dragPointerId === "number") {
      try {
        obsSheetHeaderEl.releasePointerCapture(dragPointerId);
      } catch (_) {
        // pointer capture 해제가 불필요한 브라우저를 허용한다.
      }
    }

    isDraggingSheet = false;
    dragPointerId = null;
  }

  // 줌 레벨에 따라 크기가 변하는 관측점 아이콘을 생성한다.
  function createObservationIcon(item, zoom = map.getZoom()) {
    const baseZoom = 14;
    const rawScale = Math.pow(2, (zoom - baseZoom) * 0.16);
    const isSelected = !!(item && item.isSelected);
    const scale = Math.min(isSelected ? 1.12 : 1.05, Math.max(0.65, rawScale));

    const labelText = getObservationMarkerText(item);
    const wrapperWidth = Math.round(72 * scale);
    const wrapperHeight = Math.round(42 * scale);
    const pillHeight = Math.round(22 * scale);
    const pillMinWidth = Math.round(38 * scale);
    const horizontalPadding = Math.round(8 * scale);
    const fontSize = Math.max(8, Math.round(10 * scale));
    const pointerSide = Math.max(5, Math.round(8 * scale));
    const pointerHeight = Math.max(8, Math.round(10 * scale));
    const iconAnchorX = Math.round(wrapperWidth / 2);
    const iconAnchorY = Math.round(wrapperHeight * 0.9);
    const badgeBorder = isSelected ? "3px solid rgba(255,255,255,0.98)" : "2px solid rgba(255,255,255,0.92)";
    const badgeShadow = isSelected
      ? "0 0 0 4px rgba(59,130,246,0.26), 0 10px 24px rgba(194,65,12,0.38)"
      : "0 10px 24px rgba(194,65,12,0.32)";

    return L.divIcon({
      className: "observation-pin-icon",
      html: `
        <div style="position:relative;width:${wrapperWidth}px;height:${wrapperHeight}px;display:flex;align-items:flex-start;justify-content:center;">
          <div style="position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:0;height:0;border-left:${pointerSide}px solid transparent;border-right:${pointerSide}px solid transparent;border-top:${pointerHeight}px solid #c2410c;"></div>
          <div style="min-width:${pillMinWidth}px;max-width:${wrapperWidth}px;height:${pillHeight}px;padding:0 ${horizontalPadding}px;border-radius:${Math.round(999 * scale)}px;background:linear-gradient(180deg,#f97316 0%,#dc2626 100%);border:${badgeBorder};color:#fff;font-weight:800;font-size:${fontSize}px;line-height:${pillHeight - 4}px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:${badgeShadow};">${labelText}</div>
        </div>
      `,
      iconSize: [wrapperWidth, wrapperHeight],
      iconAnchor: [iconAnchorX, iconAnchorY]
    });
  }

  // 현재 필터링된 관측점 목록을 지도 마커 레이어에 렌더링한다.
  function renderObservationMarkers(items) {
    observationMarkersLayer.clearLayers();
    observationMarkers.length = 0;
    const zoom = map.getZoom();

    for (const item of items) {
      item.isSelected = selectedObsIds.has(item._obsKey);
      const marker = L.marker([item.lat, item.lng], { icon: createObservationIcon(item, zoom) });
      marker.obsData = item;
      marker.bindPopup(buildObservationPopupHtml(item));
      observationMarkersLayer.addLayer(marker);
      observationMarkers.push(marker);
    }
  }

  // 체크박스 선택 상태를 기존 마커 아이콘에도 즉시 반영한다.
  function syncObservationMarkerSelection() {
    const zoom = map.getZoom();

    for (const marker of observationMarkers) {
      if (!marker || !marker.obsData) continue;
      marker.obsData.isSelected = selectedObsIds.has(marker.obsData._obsKey);
      marker.setIcon(createObservationIcon(marker.obsData, zoom));
    }
  }

  // 관측점 행 클릭 시 해당 좌표로 지도를 이동한다.
  function moveToObservation(item, row) {
    if (!item) return;
    const currentZoom = map && typeof map.getZoom === "function" ? map.getZoom() : undefined;
    flyToLatLng([item.lat, item.lng], currentZoom);

    if (row && row.classList) {
      row.classList.remove("is-flashing");
      void row.offsetWidth;
      row.classList.add("is-flashing");
      window.setTimeout(function () {
        row.classList.remove("is-flashing");
      }, 900);
    }

    const marker = observationMarkers.find(function (entry) {
      return entry && entry.obsData && String(entry.obsData._obsKey) === String(item._obsKey);
    });
    const feature = marker && marker._feature;
    // 기존 등록/수정 플래시를 그대로 재사용해 선택된 점만 부드럽게 강조한다.
    const triggerFlash = window.__bpTriggerObservationSaveFlash;
    if (typeof triggerFlash === "function") {
      window.setTimeout(function () {
        triggerFlash(feature, observationMarkersLayer, 2400, "move-double");
      }, 720);
    }

  }

  // 지도 줌 변경 시 기존 마커 아이콘 스케일을 재계산해 갱신한다.
  function updateObservationMarkerScale() {
    const zoom = map.getZoom();

    for (const marker of observationMarkers) {
      if (!marker || !marker.obsData) continue;
      marker.setIcon(createObservationIcon(marker.obsData, zoom));
    }
  }

  // 관측점 테이블 행을 다시 만들고 각 행 이벤트를 연결한다.
  function renderObservationList(items) {
    if (!obsListBodyEl) return;

    obsListBodyEl.innerHTML = "";

    if (items.length === 0) {
      const emptyRow = document.createElement("tr");
      emptyRow.className = "obs-empty-row";
      emptyRow.innerHTML = '<td colspan="5" class="obs-empty-cell">데이터가 없습니다.</td>';
      obsListBodyEl.appendChild(emptyRow);
      syncChkAll(items);
      return;
    }

    for (const item of items) {
      const row = document.createElement("tr");
      const isChecked = selectedObsIds.has(item._obsKey);
      if (isChecked) row.classList.add("selected");

      row.innerHTML = `
        <td class="col-chk"><input type="checkbox" class="obs-row-chk" data-id="${item._obsKey}" ${isChecked ? "checked" : ""} /></td>
        <td>${getObservationLabel(item)}</td>
        <td>${item.bearCode}</td>
        <td>${item.owner}</td>
        <td>
          <div class="obs-actions">
            <button class="obs-action-btn edit" type="button" data-action="edit">수정</button>
          </div>
        </td>
      `;
      const chk = row.querySelector(".obs-row-chk");
      if (chk) chk.addEventListener("click", (e) => {
        e.stopPropagation();
        handleObsCheck(item._obsKey, chk.checked, row);
      });

      const editBtn = row.querySelector('[data-action="edit"]');
      if (editBtn) editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (typeof onEditObservation === "function") {
          onEditObservation(item);
        } else if (statusEl) {
          statusEl.textContent = "⚠️ 수정 UI를 열 수 없습니다.";
        }
      });

      row.addEventListener("click", () => {
        moveToObservation(item, row);
      });

      obsListBodyEl.appendChild(row);
    }

    syncChkAll(items);
  }

  // 개별 관측점 체크박스 선택 상태를 관리한다.
  function handleObsCheck(id, checked, row) {
    if (checked) {
      selectedObsIds.add(id);
      row.classList.add("selected");
    } else {
      selectedObsIds.delete(id);
      row.classList.remove("selected");
    }
    syncObservationMarkerSelection();
    updateSelectionUI();
  }

  // 선택 개수/버튼 활성화/전체선택 상태를 한 번에 갱신한다.
  function updateSelectionUI() {
    const count = selectedObsIds.size;

    if (obsSelectedCountEl) {
      obsSelectedCountEl.textContent = `${count}개 선택`;
      obsSelectedCountEl.hidden = count < 1;
    }

    if (btnAnalysis) {
      const canAnalyze = count >= 2;
      btnAnalysis.disabled = !canAnalyze;
      btnAnalysis.style.opacity = canAnalyze ? "1" : "0.45";
      btnAnalysis.style.cursor = canAnalyze ? "pointer" : "not-allowed";
    }

    if (btnDeleteSelected) {
      btnDeleteSelected.disabled = count < 1;
      btnDeleteSelected.style.opacity = count < 1 ? "0.45" : "1";
      btnDeleteSelected.style.cursor = count < 1 ? "not-allowed" : "pointer";
    }

    syncChkAll(getFilteredItems());
    syncObservationMarkerSelection();
  }

  // 단건/다건 삭제를 공용 처리하고, SQLite/메모리/UI 정리를 한 번에 수행한다.
  async function deleteObservations(items, options) {
    const targetItems = Array.isArray(items) ? items.filter(Boolean) : [];
    const targetOptions = options || {};
    if (targetItems.length < 1) {
      return { confirmed: false, sqliteDeletedCount: 0, memoryDeletedCount: 0 };
    }

    const count = targetItems.length;
    const confirmed = await confirmWithStyledDialog({
      title: targetOptions.title || "삭제 확인",
      message: targetOptions.message || (count === 1 ? "이 관측점을 삭제하시겠습니까?" : `${count}개 관측점을 정말 삭제하시겠습니까?`),
      detail: targetOptions.detail || "이 작업은 되돌릴 수 없습니다.",
      confirmText: targetOptions.confirmText || "삭제",
      cancelText: targetOptions.cancelText || "취소",
      tone: targetOptions.tone || "danger"
    });

    if (!confirmed) {
      if (!targetOptions.silentCancel && statusEl) {
        statusEl.textContent = "⚠️ 삭제 취소됨";
      }
      return { confirmed: false, sqliteDeletedCount: 0, memoryDeletedCount: 0 };
    }

    const targetIds = targetItems
      .map((item) => String(item && item.id ? item.id : "").trim())
      .filter(Boolean);
    const targetKeys = new Set(
      targetItems
        .map((item) => String(item && item._obsKey ? item._obsKey : "").trim())
        .filter(Boolean)
    );

    let sqliteDeletedCount = 0;
    if (isNativePlatform()) {
      try {
        const sqlite = window.Capacitor && window.Capacitor.Plugins
          ? window.Capacitor.Plugins.CapacitorSQLite
          : null;
        if (sqlite && typeof sqlite.execute === "function") {
          const dbName = window.BearSQLiteConfig && window.BearSQLiteConfig.dbName
            ? String(window.BearSQLiteConfig.dbName)
            : "BearPointData";

          for (const id of targetIds) {
            try {
              await sqlite.execute({
                database: dbName,
                statements: `DELETE FROM observations WHERE id = '${id.replace(/'/g, "''")}'`,
                readonly: false
              });
              sqliteDeletedCount += 1;
            } catch (err) {
              console.warn(`[OBS] failed to delete observation ${id}:`, err);
            }
          }
        }
      } catch (error) {
        console.warn("[OBS] SQLite deletion failed:", error);
      }
    }

    const initialLength = observationSamples.length;
    for (let i = observationSamples.length - 1; i >= 0; i -= 1) {
      const current = observationSamples[i];
      if (targetKeys.has(current._obsKey) || targetIds.includes(current.id)) {
        observationSamples.splice(i, 1);
      }
    }

    targetKeys.forEach((key) => selectedObsIds.delete(key));

    if (map && typeof map.closePopup === "function") {
      map.closePopup();
    }

    applySearch();
    renderObservationMarkers(observationSamples);
    updateSelectionUI();
    updateObservationSummary();
    updateMainStatusForList();

    const memoryDeletedCount = initialLength - observationSamples.length;
    if (!targetOptions.suppressStatus && statusEl) {
      statusEl.textContent = memoryDeletedCount > 0
        ? (count === 1 ? "🗑️ 관측점 1개를 삭제했습니다." : `🗑️ ${memoryDeletedCount}개 관측점을 삭제했습니다.`)
        : "🟠 삭제할 관측점이 없습니다.";
    }

    return {
      confirmed: true,
      sqliteDeletedCount,
      memoryDeletedCount
    };
  }

  // 현재 필터 대상 기준으로 전체선택 체크박스 상태를 동기화한다.
  function syncChkAll(items) {
    if (!chkAllEl) return;
    const allChecked = items.length > 0 && items.every((it) => selectedObsIds.has(it._obsKey));
    const someChecked = items.some((it) => selectedObsIds.has(it._obsKey));
    chkAllEl.checked = allChecked;
    chkAllEl.indeterminate = !allChecked && someChecked;
  }

  // 검색 조건(관측점/코드)에 맞는 데이터만 반환한다.
  function getFilteredItems() {
    const field = searchFieldEl ? searchFieldEl.value : "obs";
    const query = (searchQueryEl ? searchQueryEl.value : "").trim().toLowerCase();
    if (!query) return observationSamples;
    return observationSamples.filter((item) => {
      if (field === "bear") return item.bearCode.toLowerCase().includes(query);
      return item.id.toLowerCase().includes(query) || getObservationLabel(item).toLowerCase().includes(query);
    });
  }

  // 검색 결과를 테이블에 반영한다.
  function applySearch() {
    const filtered = getFilteredItems();
    renderObservationList(filtered);
  }

  function ensureAnalysisOptionsDialog() {
    if (analysisOptionsDialogState) return analysisOptionsDialogState;

    // 반응형 스타일 주입: 작은 화면에서 텍스트 짤림 방지
    const styleId = "analysis-dialog-responsive-styles";
    if (!document.getElementById(styleId)) {
      const style = document.createElement("style");
      style.id = styleId;
      style.textContent = `
        /* 기본: 모든 텍스트 요소에 생략 기호 처리 추가 */
        #analysis-dialog-title,
        #analysis-dialog-desc,
        #analysis-dialog-error,
        .analysis-input-label,
        .analysis-btn-action {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        @media (max-width: 640px) {
          #analysis-dialog-overlay {
            width: calc(100vw - 16px) !important;
            left: 8px !important;
            transform: none !important;
          }
        }
        @media (max-width: 480px) {
          #analysis-dialog-overlay {
            width: calc(100vw - 12px) !important;
            left: 6px !important;
          }
          #analysis-dialog-panel {
            padding: 8px !important;
          }
          #analysis-dialog-title {
            font-size: 13px !important;
          }
          #analysis-dialog-desc {
            font-size: 11px !important;
            margin-bottom: 2px !important;
          }
          #analysis-dialog-body {
            grid-template-columns: repeat(2, minmax(0, 1fr)) !important;
            gap: 6px !important;
          }
          .analysis-input-label {
            font-size: 11px !important;
            gap: 4px !important;
          }
          .analysis-input {
            height: 32px !important;
            padding: 0 8px !important;
            font-size: 13px !important;
          }
          #analysis-dialog-actions {
            gap: 6px !important;
            margin-top: 2px !important;
          }
          .analysis-btn-action {
            height: 32px !important;
            min-width: 60px !important;
            padding: 0 10px !important;
            font-size: 12px !important;
          }
          #analysis-dialog-error {
            font-size: 11px !important;
            min-height: 14px !important;
          }
        }
      `;
      document.head.appendChild(style);
    }

    // 지도는 계속 보이게 두고, 상단 입력 탭만 고정으로 띄운다.
    const overlay = document.createElement("div");
    overlay.id = "analysis-dialog-overlay";
    overlay.style.position = "fixed";
    overlay.style.top = "calc(8px + var(--safe-top))";
    overlay.style.left = "50%";
    overlay.style.transform = "translateX(-50%)";
    overlay.style.width = "min(640px, calc(100vw - 20px))";
    overlay.style.zIndex = "22000";
    overlay.style.display = "none";
    overlay.style.pointerEvents = "none";

    // 탭 본체: 다크 반투명 배경으로 지도 위에서도 대비를 유지한다.
    const panel = document.createElement("div");
    panel.id = "analysis-dialog-panel";
    panel.style.width = "100%";
    panel.style.pointerEvents = "auto";
    panel.style.background = "rgba(15,23,42,0.9)";
    panel.style.backdropFilter = "blur(4px)";
    panel.style.border = "1px solid rgba(255,255,255,0.18)";
    panel.style.borderRadius = "12px";
    panel.style.boxShadow = "0 12px 28px rgba(15,23,42,0.3)";
    panel.style.padding = "10px";
    panel.style.display = "flex";
    panel.style.flexDirection = "column";
    panel.style.gap = "8px";

    // 헤더는 제목만 표시한다(접기 기능 제거).
    const header = document.createElement("div");
    header.style.display = "flex";
    header.style.alignItems = "center";
    header.style.justifyContent = "flex-start";

    const title = document.createElement("div");
    title.id = "analysis-dialog-title";
    title.textContent = "위치분석 탭";
    title.style.fontSize = "14px";
    title.style.fontWeight = "800";
    title.style.color = "#ffffff";

    header.appendChild(title);

    // 본문은 2열 입력 + 하단 버튼행으로 구성해 모바일에서도 버튼 줄바꿈을 방지한다.
    const body = document.createElement("div");
    body.id = "analysis-dialog-body";
    body.style.display = "grid";
    body.style.gridTemplateColumns = "repeat(2, minmax(0, 1fr))";
    body.style.gap = "8px";
    body.style.alignItems = "end";

    const desc = document.createElement("div");
    desc.id = "analysis-dialog-desc";
    desc.textContent = "입력값 변경 시 지도 프리뷰가 즉시 반영됩니다.\n\n３점이상 교차점이면 산술평균 중심점을 사용하며, \n한 쌍이라도 불일치 징후가 있으면 실패 처리됩니다.";
    desc.style.fontSize = "12px";
    desc.style.color = "rgba(255,255,255,0.85)";
    desc.style.whiteSpace = "pre-line";

    const distanceWrap = document.createElement("label");
    distanceWrap.className = "analysis-input-label";
    distanceWrap.style.display = "flex";
    distanceWrap.style.flexDirection = "column";
    distanceWrap.style.gap = "6px";
    distanceWrap.style.fontSize = "12px";
    distanceWrap.style.fontWeight = "700";
    distanceWrap.style.color = "rgba(255,255,255,0.94)";
    distanceWrap.textContent = "거리 제한 (m)";

    const distanceInput = document.createElement("input");
    distanceInput.className = "analysis-input";
    distanceInput.type = "number";
    distanceInput.step = "1";
    distanceInput.min = "1";
    distanceInput.inputMode = "decimal";
    distanceInput.style.height = "34px";
    distanceInput.style.border = "1px solid rgba(255,255,255,0.3)";
    distanceInput.style.borderRadius = "8px";
    distanceInput.style.background = "rgba(255,255,255,0.96)";
    distanceInput.style.padding = "0 10px";
    distanceInput.style.fontSize = "14px";
    distanceInput.style.boxSizing = "border-box";
    distanceInput.style.width = "100%";
    distanceWrap.appendChild(distanceInput);

    const declinationWrap = document.createElement("label");
    declinationWrap.className = "analysis-input-label";
    declinationWrap.style.display = "flex";
    declinationWrap.style.flexDirection = "column";
    declinationWrap.style.gap = "6px";
    declinationWrap.style.fontSize = "12px";
    declinationWrap.style.fontWeight = "700";
    declinationWrap.style.color = "rgba(255,255,255,0.94)";
    declinationWrap.textContent = "편각 (도)";

    const declinationInput = document.createElement("input");
    declinationInput.className = "analysis-input";
    declinationInput.type = "text";
    declinationInput.inputMode = "text";
    declinationInput.setAttribute("autocapitalize", "off");
    declinationInput.setAttribute("autocomplete", "off");
    declinationInput.setAttribute("autocorrect", "off");
    declinationInput.setAttribute("spellcheck", "false");
    declinationInput.style.height = "34px";
    declinationInput.style.border = "1px solid rgba(255,255,255,0.3)";
    declinationInput.style.borderRadius = "8px";
    declinationInput.style.background = "rgba(255,255,255,0.96)";
    declinationInput.style.padding = "0 10px";
    declinationInput.style.fontSize = "14px";
    declinationInput.style.boxSizing = "border-box";
    declinationInput.style.width = "100%";
    declinationWrap.appendChild(declinationInput);

    const errorEl = document.createElement("div");
    errorEl.id = "analysis-dialog-error";
    errorEl.style.minHeight = "16px";
    errorEl.style.fontSize = "12px";
    errorEl.style.fontWeight = "700";
    errorEl.style.color = "#fecaca";

    const actions = document.createElement("div");
    actions.id = "analysis-dialog-actions";
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    actions.style.alignItems = "center";
    actions.style.gridColumn = "1 / -1";
    actions.style.flexWrap = "nowrap";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "analysis-btn-action";
    cancelBtn.type = "button";
    cancelBtn.textContent = "취소";
    cancelBtn.style.height = "34px";
    cancelBtn.style.minWidth = "74px";
    cancelBtn.style.padding = "0 14px";
    cancelBtn.style.border = "1px solid rgba(255,255,255,0.38)";
    cancelBtn.style.borderRadius = "8px";
    cancelBtn.style.background = "rgba(255,255,255,0.16)";
    cancelBtn.style.color = "#ffffff";
    cancelBtn.style.fontWeight = "700";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.style.boxSizing = "border-box";

    const applyBtn = document.createElement("button");
    applyBtn.className = "analysis-btn-action";
    applyBtn.type = "button";
    applyBtn.textContent = "분석";
    applyBtn.style.height = "34px";
    applyBtn.style.minWidth = "74px";
    applyBtn.style.padding = "0 14px";
    applyBtn.style.border = "0";
    applyBtn.style.borderRadius = "8px";
    applyBtn.style.background = "#2563eb";
    applyBtn.style.color = "#ffffff";
    applyBtn.style.fontWeight = "700";
    applyBtn.style.cursor = "pointer";
    applyBtn.style.boxSizing = "border-box";

    // 요청에 맞춰 버튼 순서를 분석 -> 취소로 배치한다.
    actions.appendChild(applyBtn);
    actions.appendChild(cancelBtn);

    body.appendChild(distanceWrap);
    body.appendChild(declinationWrap);
    body.appendChild(actions);

    panel.appendChild(header);
    panel.appendChild(desc);
    panel.appendChild(errorEl);
    panel.appendChild(body);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    analysisOptionsDialogState = {
      overlay,
      panel,
      body,
      desc,
      distanceInput,
      declinationInput,
      errorEl,
      cancelBtn,
      applyBtn,
      resolve: null
    };

    return analysisOptionsDialogState;
  }

  function emitAnalysisPreview(payload) {
    if (typeof onAnalysisPreview === "function") {
      onAnalysisPreview(payload || null);
    }
  }

  function setObservationListDisabled(disabled) {
    if (!obsSheetEl) return;
    if (disabled) {
      obsSheetEl.style.pointerEvents = "none";
      obsSheetEl.style.opacity = "0.85";
      return;
    }
    obsSheetEl.style.pointerEvents = "";
    obsSheetEl.style.opacity = "";
  }

  function closeAnalysisOptionsDialog(value, opts) {
    const options = opts || {};
    const dialog = analysisOptionsDialogState;
    if (!dialog || !dialog.resolve) return;

    const resolver = dialog.resolve;
    dialog.resolve = null;
    dialog.overlay.style.display = "none";
    setObservationListDisabled(false);
    setPeekMode(false);
    emitAnalysisPreview(null);

    if (options.silent) {
      analysisCloseSilently = true;
    }

    resolver(value);
  }

  function escapeAnalysisOptionsDialog() {
    closeAnalysisOptionsDialog(null, { silent: true });
  }

  function isAnalysisDialogOpen() {
    return !!(analysisOptionsDialogState && analysisOptionsDialogState.resolve);
  }

  async function confirmAndEscapeAnalysis(message) {
    if (!isAnalysisDialogOpen()) return true;
    const msg = message || "위치분석이 진행 중입니다. 종료하시겠습니까?";
    const ok = window.confirm(msg);
    if (ok) escapeAnalysisOptionsDialog();
    return ok;
  }

  function openAnalysisOptionsDialog(defaultValues, selectedItems, onApplyAnalysis) {
    // 이전 분석 결과(추정 위치 마커/원)를 클리어한다.
    if (typeof onClearAnalysisEstimate === "function") onClearAnalysisEstimate();

    const dialog = ensureAnalysisOptionsDialog();
    const defaults = defaultValues || {};
    const previewItems = Array.isArray(selectedItems) ? selectedItems : [];

    function parseDistanceValue(rawValue) {
      const raw = String(rawValue == null ? "" : rawValue).trim();
      if (!raw) {
        return { ok: false, code: "EMPTY", message: "거리 제한(m)을 입력하세요." };
      }
      if (!/^\d+(?:\.\d+)?$/.test(raw)) {
        return { ok: false, code: "INVALID_FORMAT", message: "거리 제한(m)은 숫자만 입력하세요." };
      }

      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return { ok: false, code: "OUT_OF_RANGE", message: "거리 제한(m)은 0보다 큰 숫자여야 합니다." };
      }

      return { ok: true, value: parsed };
    }

    function parseDeclinationValue(rawValue) {
      const raw = String(rawValue == null ? "" : rawValue).trim();
      if (!raw) {
        return { ok: false, code: "EMPTY", message: "편각을 입력하세요." };
      }

      const signCount = (raw.match(/[+-]/g) || []).length;
      if (signCount > 1 || (signCount === 1 && !/^[+-]/.test(raw))) {
        return { ok: false, code: "SIGN_TYPO", message: "편각의 부호(+/-) 위치가 올바르지 않습니다." };
      }

      if (/[a-zA-Z가-힣]/.test(raw)) {
        return { ok: false, code: "TEXT_INPUT", message: "편각은 숫자만 입력하세요." };
      }

      if (!/^[+-]?\d+(?:\.\d+)?$/.test(raw)) {
        return { ok: false, code: "INVALID_FORMAT", message: "편각 형식이 올바르지 않습니다." };
      }

      const parsed = Number(raw);
      if (!Number.isFinite(parsed)) {
        return { ok: false, code: "NAN", message: "편각은 유효한 숫자여야 합니다." };
      }

      return { ok: true, value: parsed };
    }

    function buildPreviewPayload() {
      // 프리뷰는 거리만 유효해도 반경을 유지하고, 편각이 유효할 때만 방향선을 표시한다.
      const distanceValidation = parseDistanceValue(dialog.distanceInput.value);
      const declinationValidation = parseDeclinationValue(dialog.declinationInput.value);
      if (!distanceValidation.ok) return null;

      const distanceLimitM = distanceValidation.value;
      const declinationDeg = declinationValidation.ok ? declinationValidation.value : null;

      return {
        distanceLimitM,
        declinationDeg,
        sourceObservations: previewItems.map((item) => ({
          id: item.id,
          place: getObservationLabel(item),
          bearCode: item.bearCode,
          lat: item.lat,
          lng: item.lng,
          heading: item.heading
        }))
      };
    }

    dialog.distanceInput.value = String(defaults.distanceLimitM ?? 3000);//반경 기본값 설정
    dialog.declinationInput.value = String(defaults.declinationDeg ?? 0);//편각 기본값 설정
    dialog.errorEl.textContent = "";
    dialog.body.style.setProperty("grid-template-columns", "repeat(2, minmax(0, 1fr))", "important");
    dialog.overlay.style.display = "flex";
    setObservationListDisabled(true);
    setPeekMode(true);

    // 탭 열릴 때 선택된 점들로 지도 포커싱
    if (typeof fitToPoints === "function" && previewItems.length > 0) {
      fitToPoints(previewItems.map(function (it) { return { lat: it.lat, lng: it.lng }; }), { padding: 80, maxZoom: 17 });
    }

    emitAnalysisPreview(buildPreviewPayload());

    return new Promise((resolve) => {
      dialog.resolve = resolve;

      function closeWith(value) {
        closeAnalysisOptionsDialog(value);
      }

      dialog.distanceInput.oninput = function () {
        dialog.errorEl.textContent = "";
        emitAnalysisPreview(buildPreviewPayload());
      };

      dialog.declinationInput.oninput = function () {
        dialog.errorEl.textContent = "";
        emitAnalysisPreview(buildPreviewPayload());
      };

      dialog.cancelBtn.onclick = function () {
        closeWith(null);
      };

      dialog.applyBtn.onclick = function () {
        const distanceValidation = parseDistanceValue(dialog.distanceInput.value);
        if (!distanceValidation.ok) {
          dialog.errorEl.textContent = distanceValidation.message;
          dialog.distanceInput.focus();
          return;
        }

        const declinationValidation = parseDeclinationValue(dialog.declinationInput.value);
        if (!declinationValidation.ok) {
          dialog.errorEl.textContent = declinationValidation.message;
          dialog.declinationInput.focus();
          return;
        }

        const distanceLimitM = distanceValidation.value;
        const declinationDeg = declinationValidation.value;
        let analysisResult = null;
        if (typeof onApplyAnalysis === "function") {
          analysisResult = onApplyAnalysis({ distanceLimitM, declinationDeg });
          if (!analysisResult || !analysisResult.ok) {
            dialog.errorEl.textContent = analysisResult && analysisResult.message
              ? `⚠️ ${analysisResult.message}`
              : "⚠️ 위치분석 실패";
            triggerLightErrorVibration();
            return;
          }
        }

        closeWith({ distanceLimitM, declinationDeg, analysisResult });
      };

      dialog.overlay.onclick = function (event) {
        if (event.target === dialog.overlay) {
          event.preventDefault();
        }
      };

      dialog.panel.onkeydown = function (event) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeWith(null);
          return;
        }
        if (event.key === "Enter") {
          event.preventDefault();
          if (event.target === dialog.distanceInput) {
            dialog.declinationInput.focus();
            dialog.declinationInput.select();
            return;
          }
          dialog.applyBtn.click();
        }
      };

      window.requestAnimationFrame(() => {
        dialog.distanceInput.focus();
        dialog.distanceInput.select();
      });
    });
  }

  function getSelectedObservations() {
    if (selectedObsIds.size < 1) return [];
    return observationSamples.filter((item) => selectedObsIds.has(item._obsKey));
  }

  async function runPositionAnalysis() {
    const analysisModule = window.BearPositionAnalysis;
    if (!analysisModule || typeof analysisModule.analyzePosition !== "function") {
      statusEl.textContent = "⚠️ 위치분석 모듈을 찾을 수 없습니다.";
      highlightStatusOnce();
      return;
    }

    const selectedItems = getSelectedObservations();
    if (selectedItems.length < 2) {
      statusEl.textContent = "⚠️ 위치분석은 관측점 2개 이상을 선택해야 합니다.";
      highlightStatusOnce();
      return;
    }

    const bearCodes = new Set(selectedItems.map((item) => String(item.bearCode || "").trim()));
    if (bearCodes.size !== 1 || !Array.from(bearCodes)[0]) {
      statusEl.textContent = "⚠️ 동일한 코드의 관측점을 선택해주세요.";
      highlightStatusOnce();
      return;
    }

    const optionInput = await openAnalysisOptionsDialog({
      distanceLimitM: 8000, //거리 제한 기본값
      declinationDeg: -7 //편각 기본값
    }, selectedItems, function (values) {
      return analysisModule.analyzePosition(selectedItems, {
        distanceLimitM: values.distanceLimitM,
        declinationDeg: values.declinationDeg,
        spreadToleranceM: 180
      });
    });
    if (!optionInput) {
      if (analysisCloseSilently) {
        analysisCloseSilently = false;
        return;
      }
      statusEl.textContent = "ℹ️ 위치분석이 취소되었습니다.";
      return;
    }
    const analysisResult = optionInput.analysisResult;

    const point = analysisResult.result;
    statusEl.textContent = `📍 추정 위치 계산 완료 (${point.bearCode}) 교차 ${point.intersectionsCount}건`;
    flyToLatLng([point.lat, point.lng], 16);

    if (typeof onAnalysisResult === "function") {
      onAnalysisResult({
        ...point,
        analysisDetails: point.analysisDetails || null,
        analysisOptions: point.options || null,
        analysisDiagnostics: analysisResult.diagnostics || null,
        sourceObservationIds: selectedItems.map((item) => item.id),
        sourceObservations: selectedItems.map((item) => ({
          id: item.id,
          place: getObservationLabel(item),
          bearCode: item.bearCode,
          heading: item.heading,
          lat: item.lat,
          lng: item.lng
        }))
      });
    }
  }

  // 상단 탭 버튼의 active 클래스를 갱신한다.
  function setActiveTab(activeBtn) {
    [btnBear].forEach((button) => { if (button) button.classList.remove("tab-active"); });
    if (activeBtn) activeBtn.classList.add("tab-active");
  }

  // 목록의 검색/선택/렌더 상태를 초기값으로 되돌린다.
  function resetList() {
    if (searchQueryEl) searchQueryEl.value = "";
    if (searchFieldEl) searchFieldEl.value = "obs";
    selectedObsIds.clear();
    observationMarkersLayer.clearLayers();
    observationMarkers.length = 0;
    if (obsListBodyEl) obsListBodyEl.innerHTML = "";
    updateSelectionUI();
  }

  // 등록 팝업이 열리는 동안 목록 패널을 일시적으로 숨긴다 (currentTab 유지).
  function hidePanel() {
    if (obsSheetEl) obsSheetEl.classList.add("hidden");
    if (obsListPanelEl) obsListPanelEl.classList.add("hidden");
    _stopObsSheetResize();
  }

  function isRegisterPopupOpen() {
    var registerBox = document.getElementById("register-box");
    return !!(registerBox && !registerBox.classList.contains("hidden"));
  }

  // 등록 팝업이 닫힌 후 목록 패널을 다시 표시한다 (currentTab 이 "list" 일 때만).
  function showPanel() {
    if (currentTab !== "list") return;
    _showListPanels();
    if (_tabletLandscapeMq.matches) _startObsSheetResize();
  }

  // 목록 패널을 닫으면서 내부 상태를 초기화한다.
  function closeListPanel() {
    _stopObsSheetResize();
    if (map && typeof map.closePopup === "function") map.closePopup();
    resetList();
    setPeekMode(false);
    setActiveTab(null);
    setTabLayout("none");
    if (typeof onClearAnalysisEstimate === "function") onClearAnalysisEstimate();
    // 등록 팝업이 실제로 열려 있을 때만 종료 콜백을 호출한다.
    if (isRegisterPopupOpen() && typeof onCloseRegister === "function") onCloseRegister();
  }

  // 현재 탭 상태(list/add/none)에 맞게 레이아웃과 마커를 제어한다.
  function setTabLayout(tab) {
    currentTab = tab;
    const isList = tab === "list";

    if (!isList) {
      map.closePopup();
      observationMarkersLayer.clearLayers();
    }

    if (isList) {
      _showListPanels();
    } else {
      _hideListPanels();
    }

    if (isList && _tabletLandscapeMq.matches) {
      // 태블릿에서 obs-sheet가 보일 때 ResizeObserver 시작
      _startObsSheetResize();
    } else if (!isList) {
      _stopObsSheetResize();
    }

    if (isList) {
      setPeekMode(false);
      if (statusEl) {
        statusEl.textContent = "📋 관측점 목록을 불러오는 중...";
      }
      void refreshObservationData();
      return;
    }

    // 메뉴를 완전히 닫을 때(목록/등록 탭 탈출) 상태 표시를 기본값으로 정리한다.
    if (tab === "none" && statusEl) {
      if (typeof window.__bpSetDefaultStatus === "function") {
        window.__bpSetDefaultStatus();
      } else {
        statusEl.textContent = "반달가슴곰 위치추적분석";
      }
    }
  }

  // UI 이벤트(탭/검색/선택/삭제/스크롤 차단)를 바인딩한다.
  function bindEvents() {
    map.on("zoomend", () => {
      if (currentTab === "list") {
        updateObservationMarkerScale();
      }
    });

    if (btnBear) btnBear.addEventListener("click", async () => {
      const isListVisible = !!(
        obsSheetEl &&
        !obsSheetEl.classList.contains("hidden") &&
        !obsSheetEl.classList.contains("bp-tablet-panel-closing")
      );
      const willClose = currentTab === "list" && isListVisible;

      if (willClose) {
        const ok = await confirmAndEscapeAnalysis();
        if (!ok) return;
        closeListPanel();
        return;
      }

      if (map && typeof map.closePopup === "function") map.closePopup();
      if (onOpenList) onOpenList();
      setActiveTab(btnBear);
      setTabLayout("list");
      if (isRegisterPopupOpen() && onCloseRegister) onCloseRegister();
    });

    if (btnObsAdd) btnObsAdd.addEventListener("click", async () => {
      // 등록 화면에서는 목록이 가림 이슈를 만들기 쉬워, 열기 직전에 목록 패널을 숨긴다.
      const analysisOk = await confirmAndEscapeAnalysis("위치분석이 진행 중입니다. 등록 화면을 여시겠습니까?");
      if (!analysisOk) return;

      if (map && typeof map.closePopup === "function") map.closePopup();
      if (typeof onClearAnalysisEstimate === "function") onClearAnalysisEstimate();
      if (onOpenRegister) onOpenRegister();
    });

    if (btnAnalysis) btnAnalysis.addEventListener("click", () => {
      if (map && typeof map.closePopup === "function") map.closePopup();
      void runPositionAnalysis();
    });

    // 선택된 관측점 삭제 버튼 핸들러
    if (btnDeleteSelected) btnDeleteSelected.addEventListener("click", async () => {
      if (selectedObsIds.size < 1) return;
      const selectedItems = getSelectedObservations();
      await deleteObservations(selectedItems, {
        title: "삭제 확인",
        message: `${selectedItems.length}개 관측점을 정말 삭제하시겠습니까?`
      });

    });

    if (btnObsListPeek) btnObsListPeek.addEventListener("click", () => {
      setPeekMode(!isPeekMode);
    });

    if (btnObsListClose) btnObsListClose.addEventListener("click", () => {
      closeListPanel();
    });

    if (obsSheetHeaderEl) {
      // 목록 패널은 헤더 영역에서만 드래그 가능하게 제한한다.
      obsSheetHeaderEl.addEventListener("pointerdown", (e) => {
        startSheetDrag(e);
      });
      obsSheetHeaderEl.addEventListener("pointermove", (e) => {
        moveSheetDrag(e);
      });
      obsSheetHeaderEl.addEventListener("pointerup", (e) => {
        endSheetDrag(e);
      });
      obsSheetHeaderEl.addEventListener("pointercancel", (e) => {
        endSheetDrag(e);
      });
    }

    if (obsSheetEl) {
      obsSheetEl.addEventListener("pointerdown", (e) => e.stopPropagation());
      obsSheetEl.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
      obsSheetEl.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    }

    if (obsTableWrapEl) {
      obsTableWrapEl.addEventListener("touchmove", (e) => e.stopPropagation(), { passive: true });
      obsTableWrapEl.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    }
    if (obsTableBodyScrollableEl) {
      obsTableBodyScrollableEl.addEventListener("touchmove", (e) => e.stopPropagation(), { passive: true });
      obsTableBodyScrollableEl.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    }

    if (searchQueryEl) searchQueryEl.addEventListener("input", applySearch);
    if (searchFieldEl) searchFieldEl.addEventListener("change", applySearch);
    if (btnSearchClearEl) btnSearchClearEl.addEventListener("click", () => {
      if (searchQueryEl) searchQueryEl.value = "";
      applySearch();
    });

    if (chkAllEl) chkAllEl.addEventListener("change", () => {
      const filtered = getFilteredItems();
      if (chkAllEl.checked) {
        filtered.forEach((it) => selectedObsIds.add(it._obsKey));
      } else {
        filtered.forEach((it) => selectedObsIds.delete(it._obsKey));
      }
      applySearch();
      updateSelectionUI();
    });
  }

  // 모듈 초기 진입 시 이벤트와 기본 UI 상태를 세팅한다.
  function initialize() {
    bindEvents();
    setPeekMode(false);
    updateSelectionUI();
    setTabLayout(currentTab);
    setActiveTab(currentTab === "list" ? btnBear : null);
  }

  function addObservation(item) {
    const mapped = mapObservationRow(item);
    if (!mapped) return;
    // 등록 직후 즉시 하이라이트가 보이도록 플래시 타이머를 선반영한다.
    mapped._saveFlashUntil = markObservationFlashById(mapped.id, "register");
    mapped._saveFlashPreset = "register";

    observationSamples = [mapped].concat(observationSamples.filter((existing) => existing.id !== mapped.id));
    applySearch();
    if (currentTab === "list") {
      renderObservationMarkers(getFilteredItems());
    }
    updateSelectionUI();
    updateObservationSummary();
  }

  function updateObservation(item) {
    const mapped = mapObservationRow(item);
    if (!mapped) return;
    // 수정 직후 좌표 이동 애니메이션과 함께 동일하게 플래시를 보여준다.
    mapped._saveFlashUntil = markObservationFlashById(mapped.id, "default");
    mapped._saveFlashPreset = "default";

    var previous = observationSamples.find(function (existing) {
      return existing && existing.id === mapped.id;
    });
    var hasPreviousCoord = !!(previous && Number.isFinite(Number(previous.lat)) && Number.isFinite(Number(previous.lng)));
    var hasNextCoord = Number.isFinite(Number(mapped.lat)) && Number.isFinite(Number(mapped.lng));

    if (hasPreviousCoord && hasNextCoord) {
      mapped._animateFromLatLng = [Number(previous.lat), Number(previous.lng)];
    }

    observationSamples = observationSamples.map((existing) => {
      if (existing.id !== mapped.id) return existing;
      return {
        ...existing,
        ...mapped
      };
    });

    applySearch();
    if (currentTab === "list") {
      renderObservationMarkers(getFilteredItems());
    }
    updateSelectionUI();
    updateObservationSummary();
  }

  function openList() {
    if (map && typeof map.closePopup === "function") map.closePopup();
    setActiveTab(btnBear);
    setTabLayout("list");
    if (onOpenList) onOpenList();
    if (isRegisterPopupOpen() && onCloseRegister) onCloseRegister();
  }

  // 안드로이드 하드웨어 뒤로가기 시, 앱 종료 전에 닫아야 할 UI를 우선 정리한다.
  // true 반환: 여기서 처리 완료(상위에서 종료 확인으로 가지 않음)
  // false 반환: 닫을 UI 없음(상위에서 앱 종료 확인 진행)
  function handleBackNavigation() {
    // 1순위: 위치분석 옵션 다이얼로그 닫기
    if (isAnalysisDialogOpen()) {
      escapeAnalysisOptionsDialog();
      return true;
    }

    // 2순위: 등록 탭 닫기
    if (currentTab === "add") {
      setActiveTab(null);
      setTabLayout("none");
      if (onCloseRegister) onCloseRegister();
      return true;
    }

    // 3순위: 목록 탭 닫기
    if (currentTab === "list") {
      closeListPanel();
      return true;
    }

    return false;
  }

  return {
    initialize,
    openList,
    hidePanel,
    showPanel,
    setTabLayout,
    deactivate: closeListPanel,
    getCurrentTab: () => currentTab,
    // client-ol 저장 콜백에서 앱/웹 공통으로 플래시를 강제 트리거할 수 있게 노출한다.
    markObservationFlash: markObservationFlashById,
    handleBackNavigation,
    addObservation,
    updateObservation,
    deleteObservation: function (item) {
      return deleteObservations([item], {
        title: "삭제 확인",
        message: "이 관측점을 삭제하시겠습니까?"
      });
    },
    renderObservationMarkers,
    refreshObservationList: refreshObservationData
  };
};
