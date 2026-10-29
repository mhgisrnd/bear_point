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
  const btnRefresh = document.getElementById("btn-obs-refresh");
  const btnSendSelected = document.getElementById("btn-obs-send-selected");
  const selectionActionsEl = document.getElementById("obs-selection-actions");
  const syncNoteEl = document.getElementById("obs-sync-note");
  let remoteError = "";
  function isShared(item) { return item && (item.shareState === "shared" || item.shareState === "sending" || item.shareState === "conflict" || Number(item.serverVersion) > 0 || !!item.sharedAt); }
  function buildShareStatus(item) {
    if (item.shareState === "shared") return '';
    if (item.shareState === "sending") return '<span class="obs-share-status" role="status" aria-busy="true">공유 중</span>';
    if (item.shareState === "conflict") return '<button class="obs-share-status obs-share-status--conflict" type="button" data-action="conflict" aria-label="충돌 내용 비교">충돌</button>';
    return '<span class="obs-sr-only">미공유</span>';
  }
  async function sendItems(items) {
    const targets = items.filter(item => !["shared", "sending", "conflict"].includes(item.shareState));
    if (!targets.length) { statusEl.textContent = "공유할 미공유 관측점을 선택해주세요."; return; }
    if (btnSendSelected) btnSendSelected.disabled = true;
    let success = 0, failed = 0, backups = 0;
    try {
      for (const item of targets) {
        const result = await window.BearObservationSync.upload(item.id);
        if (result.ok) success++; else failed++;
        if (result.backup) backups++;
      }
      await refreshObservationData({ localOnly: true });
      statusEl.textContent = `관측점 공유 완료 ${success}건 · 공유 안 됨 ${failed}건` + (backups ? ` · 미반영 수정 사본 ${backups}건 보관` : "");
    } catch (error) { statusEl.textContent = error.message; }
    finally { updateSelectionUI(); }
  }
  async function reviewConflict(id) {
    try {
      const local = await window.BearObservationSync.find(id);
      const remote = JSON.parse(local?.conflict_json || "null");
      if (!remote || local.share_state !== "conflict") { await refreshObservationData({ localOnly: true }); return; }
      if (document.querySelector(".obs-conflict-overlay")) return;
      const overlay = document.createElement("div");
      overlay.className = "obs-conflict-overlay";
      const detectors = value => {
        const rows = typeof value === "string" ? JSON.parse(value || "[]") : value || [];
        return rows.map(row => [row.detectorName, row.signalStrength].filter(Boolean).join(" · ")).join(", ") || "-";
      };
      const fields = [["코드", local.bear_code, remote.bear_code], ["명칭", local.place, remote.place],
        ["담당자", local.owner, remote.owner], ["위치", local.admin_region, remote.admin_region],
        ["위도", local.lat, remote.lat], ["경도", local.lng, remote.lng], ["방향각", local.heading, remote.heading],
        ["감지기", detectors(local.detectors_json), detectors(remote.detectors_json)]];
      overlay.innerHTML = `<section class="obs-conflict-dialog" role="dialog" aria-modal="true" aria-labelledby="obs-conflict-title">
        <header><h3 id="obs-conflict-title">관측점 수정 내용 비교</h3><button type="button" data-choice="close" aria-label="비교 닫기">×</button></header>
        <p>${remote.deleted ? '서버에서 삭제된 관측점입니다. 수정본을 서버에 덮어쓸 수 없습니다.' : '다른 수정 사항이 있습니다. 반영할 내용을 선택해주세요.'}</p>
        <div class="obs-conflict-scroll"><table><thead><tr><th>항목</th><th>내 수정본</th><th>서버 최신 값</th></tr></thead><tbody>${fields.map(([label, mine, server]) => `<tr${String(mine ?? '') !== String(server ?? '') ? ' class="is-different"' : ''}><th>${label}</th><td>${escapeHtml(String(mine ?? '-'))}</td><td>${escapeHtml(String(server ?? '-'))}</td></tr>`).join('')}</tbody></table></div>
        <div class="obs-conflict-message" role="status"></div>
        <footer>${remote.deleted ? '' : '<button type="button" data-choice="local">내 수정본 반영</button>'}<button type="button" data-choice="server">${remote.deleted ? '서버 삭제 상태 적용' : '서버 값 사용'}</button><button type="button" data-choice="close">나중에</button></footer>
      </section>`;
      const previousFocus = document.activeElement;
      const close = () => { overlay.remove(); document.removeEventListener("keydown", onKey); if (previousFocus?.isConnected) previousFocus.focus(); };
      const onKey = event => {
        if (event.key === "Escape") { event.stopPropagation(); if (!busy) close(); }
        if (event.key === "Tab") {
          const buttons = [...overlay.querySelectorAll("button:not(:disabled)")];
          if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
          else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
        }
      };
      let busy = false;
      overlay.addEventListener("click", async event => {
        const choice = event.target.closest("[data-choice]")?.dataset.choice;
        if (!choice || busy) return;
        if (choice === "close") { close(); return; }
        busy = true;
        overlay.querySelectorAll("button").forEach(button => { button.disabled = true; });
        try {
          const result = await window.BearObservationSync.resolveConflict(id, choice, remote.server_version, local.sync_mutation_id);
          close();
          await refreshObservationData({ localOnly: true });
          statusEl.textContent = result.ok ? (choice === "local" ? "관측점 수정 공유 완료" : "서버 최신 상태를 적용했습니다.") : result.message;
        } catch (error) {
          overlay.querySelector(".obs-conflict-message").textContent = error.message;
          busy = false;
          overlay.querySelectorAll("button").forEach(button => { button.disabled = false; });
        }
      });
      document.body.appendChild(overlay);
      document.addEventListener("keydown", onKey);
      overlay.querySelector("[data-choice='close']").focus();
    } catch (error) { statusEl.textContent = error.message; }
  }
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
  const btnFilterEl = document.getElementById("btn-obs-filter");
  const filterPanelEl = document.getElementById("obs-filter-panel");
  const ownerFilterEl = document.getElementById("obs-filter-owner");
  const periodFilterEl = document.getElementById("obs-filter-period");
  const dayFilterEl = document.getElementById("obs-filter-day");
  const monthFilterEl = document.getElementById("obs-filter-month");
  const yearFilterEl = document.getElementById("obs-filter-year");
  const btnMineFilterEl = document.getElementById("btn-obs-filter-mine");
  const btnFilterDoneEl = document.getElementById("btn-obs-filter-done");
  const filterSummaryEl = document.getElementById("obs-filter-summary");
  const filterErrorEl = document.getElementById("obs-filter-error");
  let ownerOptionsSignature = "";
  const chkAllEl = document.getElementById("chk-all");

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

  // 태블릿 가로에서는 관측점 목록을 사이드바 오른쪽 팝업으로 표시한다.
  var _tabletLandscapeMq = window.matchMedia(
    "(min-width: 900px) and (orientation: landscape)"
  );
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
      .filter(det => det && (det.detectorName || det.signalStrength)).slice(0, 3);
    if (!rows.length) return '<tr><th scope="row">감지기</th><td>-</td></tr>';
    return rows.map((det, index) => {
      const name = escapeHtml(det.detectorName || "-");
      const strength = escapeHtml(det.signalStrength || "-");
      const label = "감지기" + (rows.length > 1 ? " " + (index + 1) : "");
      return `<tr><th scope="row">${label}</th><td><div class="obs-detail-detector"><span class="obs-detail-value" title="${name}">${name}</span><span class="obs-detail-strength">감도 ${strength}</span></div></td></tr>`;
    }).join("");
  }

  function buildObservationPopupHtml(item) {
    const title = escapeHtml(getObservationLabel(item) || "관측점");
    const row = (label, value, mono = false) => {
      const text = escapeHtml(value == null || value === "" ? "-" : value);
      return `<tr><th scope="row">${label}</th><td><span class="obs-detail-value${mono ? ' obs-detail-value--mono' : ''}" title="${text}">${text}</span></td></tr>`;
    };
    return `
      <div class="obs-popup-card obs-popup-card--observation">
        <div class="obs-popup-card__eyebrow">${title}</div>
        <div class="obs-detail-frame">
          <table class="obs-detail-table" aria-label="관측점 상세 정보"><tbody>
            ${row("코드·방향", `${item && item.bearCode || '-'} · ${item && item.heading != null && item.heading !== '' ? item.heading : '-'}`)}
            ${row("담당자", item && item.owner)}
            ${row("위치", item && item.adminRegion)}
            ${row("위경도", `${formatCoordinate(item && item.lat)}, ${formatCoordinate(item && item.lng)}`, true)}
            ${buildDetectorRowsHtml(item && item.detectors)}
          </tbody></table>
        </div>
        <details class="obs-detail-more"><summary>등록정보</summary><div>등록일시 <span class="obs-detail-value">${escapeHtml(formatDateTimeSeconds(item && item.createdAt))}</span></div></details>
        ${item.shareState === "sending" ? '' : '<div class="obs-popup-card__actions"><button class="obs-popup-card__action-btn obs-popup-card__action-btn--edit" type="button" data-observation-action="edit">수정</button>' + (item.shareState === 'conflict' ? '' : '<button class="obs-popup-card__action-btn obs-popup-card__action-btn--delete" type="button" data-observation-action="delete">삭제</button>') + '</div>'}
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
      adminRegion: String(row.admin_region || row.adminRegion || "").trim(),
      shareState: row.share_state || row.shareState || "local",
      serverVersion: Number(row.server_version || 0),
      sharedAt: row.shared_at || null,
      syncError: row.sync_error || "",
      unsharedBackup: row.unshared_backup || null,
      bearCode,
      owner,
      lat,
      lng,
      heading,
      createdAt: row.created_at || row.createdAt || row.created || null,
      updatedAt: row.updated_at || row.updatedAt || null,
      detectors,
      _saveFlashUntil: hasActiveFlash ? cachedFlashUntil : 0,
      _saveFlashPreset: hasActiveFlash ? (cachedFlashPreset || "default") : "default",
      _obsKey: `${id}::${observationKeySeed++}`
    };
  }

  // Local data is available immediately, even while the server is unreachable.
  async function loadObservationSamples() {
    try {
      const rows = await window.BearObservationSync.all();
      observationSamples = rows.filter(row => !row.server_deleted).map(mapObservationRow).filter(Boolean);
      return { source: isNativePlatform() ? "sqlite" : "web" };
    } catch (error) {
      remoteError = error.message;
      return { source: "cached" };
    }
  }

  // 관측점 데이터 로드 이후 목록/마커/상태 문구를 한 번에 갱신한다.
  function updateObservationSummary() {
    if (!obsListStatusEl) return;

    const count = observationSamples.length;
    if (obsListCountEl) {
      const unshared = observationSamples.filter(item => !["shared", "sending", "conflict"].includes(item.shareState)).length;
      obsListCountEl.textContent = `${getFilteredItems().length}건`;
      if (syncNoteEl) {
        syncNoteEl.hidden = !remoteError && unshared < 1;
        syncNoteEl.textContent = remoteError ? "공유 상태를 확인하지 못했습니다. 기존 목록을 표시합니다." : `미공유 ${unshared}건 · 빨간 관측점을 체크한 뒤 ‘선택 공유’로 전송하세요.`;
        syncNoteEl.title = remoteError || "";
      }
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

  async function refreshObservationData(options = {}) {
    await loadObservationSamples();
    selectedObsIds.clear();
    applySearch();
    renderObservationMarkers(getFilteredItems());
    updateSelectionUI();

    updateObservationSummary();
    updateMainStatusForList();
    if (!options.localOnly) {
      remoteError = "";
      try { await window.BearObservationSync.pull(); }
      catch (error) { remoteError = error.message; }
      await refreshObservationData({ localOnly: true });
    }
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
    if (e.isPrimary === false || (e.button != null && e.button !== 0)) return;
    // 헤더 내부의 실제 조작 요소(닫기/최소화/버튼)를 누른 경우 드래그 시작을 막는다.
    const interactiveTarget = e.target && e.target.closest
      ? e.target.closest("button, input, select, textarea, a, label")
      : null;
    if (interactiveTarget) return;
    if (e.cancelable && typeof e.preventDefault === "function") e.preventDefault();

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

  function keepSheetInViewport() {
    if (!obsSheetEl || isDraggingSheet || obsSheetEl.classList.contains("hidden") || !obsSheetEl.style.left || !obsSheetEl.style.top) return;
    const rect = obsSheetEl.getBoundingClientRect();
    const left = Math.min(Math.max(0, rect.left), Math.max(0, window.innerWidth - rect.width));
    const top = Math.min(Math.max(0, rect.top), Math.max(0, window.innerHeight - rect.height));
    if (Math.abs(left - rect.left) > 0.5) obsSheetEl.style.left = `${Math.round(left)}px`;
    if (Math.abs(top - rect.top) > 0.5) obsSheetEl.style.top = `${Math.round(top)}px`;
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
      if (!["shared", "sending"].includes(item.shareState)) row.classList.add("obs-row--unshared");

      row.innerHTML = `
        <td class="col-chk"><input type="checkbox" class="obs-row-chk" data-id="${item._obsKey}" ${isChecked ? "checked" : ""} /></td>
        <td><div class="obs-name-cell"><span class="obs-name-cell__label" title="${escapeHtml(getObservationLabel(item) + (item.shareState === 'shared' ? '' : ' · ' + (item.syncError || '미공유')))}">${escapeHtml(getObservationLabel(item))}</span>${buildShareStatus(item)}</div></td>
        <td>${escapeHtml(item.bearCode)}</td>
        <td>${escapeHtml(item.owner)}</td>
        <td>
          <div class="obs-actions">
            ${item.shareState === 'sending' ? '' : '<button class="obs-action-btn edit" type="button" data-action="edit">수정</button>'}
            ${item.shareState === 'sending' ? '' : '<button class="obs-action-btn delete" type="button" data-action="delete"' + (item.shareState === 'conflict' ? ' disabled title="충돌 내용을 먼저 확인해주세요."' : '') + '>삭제</button>'}
            ${item.unsharedBackup ? '<button class="obs-action-btn" type="button" data-action="backup">수정 사본</button>' : ''}
          </div>
        </td>
      `;
      const chk = row.querySelector(".obs-row-chk");
      if (chk) chk.addEventListener("click", (e) => {
        e.stopPropagation();
        handleObsCheck(item._obsKey, chk.checked, row);
      });

      const editBtn = row.querySelector('[data-action="edit"]');
      const deleteBtn = row.querySelector('[data-action="delete"]');
      if (deleteBtn) deleteBtn.addEventListener("click", event => { event.stopPropagation(); void deleteObservations([item]); });
      const conflictBtn = row.querySelector('[data-action="conflict"]');
      if (conflictBtn) conflictBtn.addEventListener("click", event => { event.stopPropagation(); void reviewConflict(item.id); });
      const backupBtn = row.querySelector('[data-action="backup"]');
      if (backupBtn) backupBtn.addEventListener("click", event => {
        event.stopPropagation();
        const url = URL.createObjectURL(new Blob([item.unsharedBackup], { type: "application/json;charset=utf-8" }));
        const link = document.createElement("a"); link.href = url; link.download = "observation-backup-" + item.id + ".json";
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
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
    const editable = observationSamples.filter(item => selectedObsIds.has(item._obsKey) && !["sending", "conflict"].includes(item.shareState));
    const sendable = observationSamples.filter(item => selectedObsIds.has(item._obsKey) && !["shared", "sending", "conflict"].includes(item.shareState));
    if (selectionActionsEl) selectionActionsEl.hidden = count < 1;

    if (obsSelectedCountEl) {
      obsSelectedCountEl.textContent = `${count}개 선택`;
      obsSelectedCountEl.hidden = count < 1;
    }

    if (btnAnalysis) {
      const canAnalyze = count >= 2;
      btnAnalysis.hidden = !canAnalyze;
      btnAnalysis.disabled = !canAnalyze;
      btnAnalysis.style.opacity = canAnalyze ? "1" : "0.45";
      btnAnalysis.style.cursor = canAnalyze ? "pointer" : "not-allowed";
    }

    if (btnDeleteSelected) {
      btnDeleteSelected.hidden = editable.length < 1;
      btnDeleteSelected.disabled = editable.length < 1;
      btnDeleteSelected.textContent = `선택 삭제 ${editable.length}`;
      btnDeleteSelected.style.opacity = "1";
      btnDeleteSelected.style.cursor = "pointer";
    }
    if (btnSendSelected) {
      btnSendSelected.hidden = sendable.length < 1;
      btnSendSelected.disabled = sendable.length < 1;
      btnSendSelected.textContent = `선택 공유 ${sendable.length}`;
    }

    syncChkAll(getFilteredItems());
    syncObservationMarkerSelection();
  }

  // 단건/다건 삭제를 공용 처리하고, SQLite/메모리/UI 정리를 한 번에 수행한다.
  async function deleteObservations(items, options) {
    const targetItems = Array.isArray(items) ? items.filter(Boolean) : [];
    if (targetItems.some(item => ["sending", "conflict"].includes(item.shareState))) {
      statusEl.textContent = "전송 중이거나 충돌 확인이 필요한 관측점입니다.";
      return { confirmed: false, sqliteDeletedCount: 0, memoryDeletedCount: 0 };
    }
    const targetOptions = options || {};
    if (targetItems.length < 1) {
      return { confirmed: false, sqliteDeletedCount: 0, memoryDeletedCount: 0 };
    }

    const count = targetItems.length;
    const confirmed = await confirmWithStyledDialog({
      title: targetOptions.title || "삭제 확인",
      message: targetOptions.message || (count === 1 ? "이 관측점을 삭제하시겠습니까?" : `${count}개 관측점을 정말 삭제하시겠습니까?`),
      detail: targetOptions.detail || (targetItems.some(isShared) ? "공유된 관측점은 서버에서도 삭제되어 다른 사용자 목록에도 반영됩니다." : "이 작업은 되돌릴 수 없습니다."),
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
    try {
      for (const id of targetIds) await window.BearObservationSync.assertEditable(id);
      for (const id of targetIds) {
        const target = targetItems.find(item => String(item.id) === id);
        await window.BearObservationSync.remove(id, target.serverVersion || 0);
        sqliteDeletedCount++;
      }
    } catch (error) {
      await refreshObservationData({ localOnly: true });
      statusEl.textContent = error.message;
      return { confirmed: false, sqliteDeletedCount, memoryDeletedCount: 0 };
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
    renderObservationMarkers(getFilteredItems());
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
    const scoped = window.BearObservationFilters.filter(observationSamples, readObservationFilters());
    if (!query) return scoped;
    return scoped.filter((item) => {
      if (field === "bear") return item.bearCode.toLowerCase().includes(query);
      return item.id.toLowerCase().includes(query) || getObservationLabel(item).toLowerCase().includes(query);
    });
  }

  // 검색 결과를 테이블에 반영한다.
  function applySearch() {
    syncFilterControls();
    const filtered = getFilteredItems();
    const visibleKeys = new Set(filtered.map(item => item._obsKey));
    for (const key of selectedObsIds) if (!visibleKeys.has(key)) selectedObsIds.delete(key);
    renderObservationList(filtered);
    updateObservationSummary();
    if (currentTab === "list") renderObservationMarkers(filtered);
    updateSelectionUI();
    if (btnFilterDoneEl) btnFilterDoneEl.textContent = `${filtered.length}건 보기`;
  }

  function readObservationFilters() {
    return { owner: ownerFilterEl?.value || "", period: periodFilterEl?.value || "all",
      day: dayFilterEl?.value || "", month: monthFilterEl?.value || "", year: yearFilterEl?.value || "" };
  }
  function lastRegisteredOwner() {
    try { return String(window.localStorage.getItem("bearpoint.lastRegisteredOwner") || "").trim(); }
    catch (_) { return ""; }
  }
  function setFiltersOpen(open) {
    if (!filterPanelEl) return;
    filterPanelEl.hidden = !open;
    obsSheetEl?.classList.toggle("obs-sheet--filtering", !!open);
    btnFilterEl?.setAttribute("aria-expanded", String(!!open));
    filterSummaryEl?.setAttribute("aria-expanded", String(!!open));
    if (open) syncFilterControls();
  }
  function clearObservationFilters() {
    if (ownerFilterEl) ownerFilterEl.value = "";
    if (periodFilterEl) periodFilterEl.value = "all";
    const today = window.BearObservationFilters.dateKey(new Date());
    if (dayFilterEl) dayFilterEl.value = today;
    if (monthFilterEl) monthFilterEl.value = today.slice(0, 7);
    if (yearFilterEl) yearFilterEl.value = today.slice(0, 4);
  }
  function syncFilterControls() {
    if (!periodFilterEl || !ownerFilterEl) return;
    const savedOwner = lastRegisteredOwner();
    const selected = ownerFilterEl.value;
    const owners = [...new Set(observationSamples.map(item => String(item.owner || "").trim()).concat([savedOwner, selected]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
    const signature = JSON.stringify(owners);
    if (signature !== ownerOptionsSignature) {
      ownerFilterEl.innerHTML = '<option value="">전체 담당자</option>' + owners.map(owner => `<option value="${escapeHtml(owner)}">${escapeHtml(owner)}</option>`).join("");
      ownerFilterEl.value = selected;
      ownerOptionsSignature = signature;
    }
    if (btnMineFilterEl) {
      btnMineFilterEl.disabled = !savedOwner;
      btnMineFilterEl.title = savedOwner ? `마지막 등록 담당자: ${savedOwner}` : "이 기기에서 관측점을 등록할 때 입력한 담당자가 아직 없습니다.";
      btnMineFilterEl.setAttribute("aria-pressed", String(!!savedOwner && selected === savedOwner));
    }
    const filters = readObservationFilters();
    const today = window.BearObservationFilters.dateKey(new Date());
    for (const [element, mode, initial] of [[dayFilterEl, "day", today], [monthFilterEl, "month", today.slice(0, 7)], [yearFilterEl, "year", today.slice(0, 4)]]) {
      if (!element) continue;
      element.hidden = filters.period !== mode;
      if (!element.dataset.initialized) { element.value = initial; element.dataset.initialized = "true"; }
    }
    const current = readObservationFilters();
    const invalid = window.BearObservationFilters.periodKey(current) === null;
    if (filterErrorEl) {
      filterErrorEl.hidden = !invalid;
      filterErrorEl.textContent = invalid ? "조회할 날짜를 선택하거나 올바른 연도를 입력해주세요." : "";
    }
    if (btnFilterDoneEl) btnFilterDoneEl.disabled = invalid;
    const description = window.BearObservationFilters.summary(current);
    if (filterSummaryEl) { filterSummaryEl.hidden = !description; filterSummaryEl.textContent = description + " ▾"; filterSummaryEl.title = description; }
    const count = (current.owner ? 1 : 0) + (current.period !== "all" ? 1 : 0);
    if (btnFilterEl) { btnFilterEl.textContent = count ? `필터 ${count}` : "필터"; btnFilterEl.classList.toggle("is-active", count > 0); }
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
        #analysis-dialog-body input[type="number"] {
          appearance: textfield;
          -moz-appearance: textfield;
        }
        #analysis-dialog-body input[type="number"]::-webkit-inner-spin-button,
        #analysis-dialog-body input[type="number"]::-webkit-outer-spin-button {
          -webkit-appearance: none;
          margin: 0;
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
            height: 56px !important;
            padding: 0 8px !important;
            font-size: 13px !important;
          }
          .analysis-declination-control .analysis-input {
            padding-left: 43px !important;
          }
          #analysis-dialog-actions {
            gap: 6px !important;
            margin-top: 12px !important;
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
    distanceInput.style.height = "56px";
    distanceInput.style.border = "1px solid rgba(255,255,255,0.3)";
    distanceInput.style.borderRadius = "8px";
    distanceInput.style.background = "rgba(255,255,255,0.96)";
    distanceInput.style.padding = "0 10px";
    distanceInput.style.fontSize = "14px";
    distanceInput.style.boxSizing = "border-box";
    distanceInput.style.width = "100%";
    distanceWrap.appendChild(distanceInput);

    const declinationWrap = document.createElement("div");
    declinationWrap.className = "analysis-input-label";
    declinationWrap.style.display = "flex";
    declinationWrap.style.flexDirection = "column";
    declinationWrap.style.gap = "6px";
    declinationWrap.style.fontSize = "12px";
    declinationWrap.style.fontWeight = "700";
    declinationWrap.style.color = "rgba(255,255,255,0.94)";

    const declinationLabel = document.createElement("label");
    declinationLabel.htmlFor = "analysis-declination-input";
    declinationLabel.textContent = "편각 (도)";
    declinationWrap.appendChild(declinationLabel);

    const declinationInput = document.createElement("input");
    declinationInput.id = "analysis-declination-input";
    declinationInput.className = "analysis-input";
    declinationInput.type = "number";
    declinationInput.step = "any";
    declinationInput.inputMode = "decimal";
    declinationInput.setAttribute("autocapitalize", "off");
    declinationInput.setAttribute("autocomplete", "off");
    declinationInput.setAttribute("autocorrect", "off");
    declinationInput.setAttribute("spellcheck", "false");
    declinationInput.style.height = "56px";
    declinationInput.style.border = "1px solid rgba(255,255,255,0.3)";
    declinationInput.style.borderRadius = "8px";
    declinationInput.style.background = "rgba(255,255,255,0.96)";
    declinationInput.style.padding = "0 10px 0 43px";
    declinationInput.style.fontSize = "14px";
    declinationInput.style.boxSizing = "border-box";
    declinationInput.style.width = "100%";
    declinationInput.style.minWidth = "0";

    const declinationControl = document.createElement("div");
    declinationControl.className = "analysis-declination-control";
    declinationControl.style.display = "flex";
    declinationControl.style.alignItems = "center";
    declinationControl.style.gap = "4px";
    declinationControl.style.width = "100%";

    const declinationInputBox = document.createElement("div");
    declinationInputBox.style.position = "relative";
    declinationInputBox.style.flex = "1 1 auto";
    declinationInputBox.style.minWidth = "0";

    const declinationSignBtn = document.createElement("button");
    declinationSignBtn.type = "button";
    declinationSignBtn.textContent = "±";
    declinationSignBtn.setAttribute("aria-label", "편각 부호 전환");
    declinationSignBtn.style.position = "absolute";
    declinationSignBtn.style.left = "5px";
    declinationSignBtn.style.top = "50%";
    declinationSignBtn.style.transform = "translateY(-50%)";
    declinationSignBtn.style.width = "32px";
    declinationSignBtn.style.height = "36px";
    declinationSignBtn.style.padding = "0";
    declinationSignBtn.style.border = "1px solid #cbd5e1";
    declinationSignBtn.style.borderRadius = "5px";
    declinationSignBtn.style.background = "#f1f5f9";
    declinationSignBtn.style.color = "#0f172a";
    declinationSignBtn.style.fontSize = "18px";
    declinationSignBtn.style.fontWeight = "700";
    declinationSignBtn.style.cursor = "pointer";
    declinationInputBox.appendChild(declinationInput);
    declinationInputBox.appendChild(declinationSignBtn);

    const declinationSteps = document.createElement("div");
    declinationSteps.style.display = "flex";
    declinationSteps.style.flexDirection = "column";
    declinationSteps.style.gap = "2px";
    declinationSteps.style.flex = "0 0 34px";

    function createDeclinationStepButton(label, ariaLabel) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.setAttribute("aria-label", ariaLabel);
      button.style.width = "34px";
      button.style.height = "27px";
      button.style.padding = "0";
      button.style.border = "1px solid rgba(255,255,255,0.4)";
      button.style.borderRadius = "5px";
      button.style.background = "rgba(255,255,255,0.2)";
      button.style.color = "#ffffff";
      button.style.fontSize = "12px";
      button.style.fontWeight = "700";
      button.style.cursor = "pointer";
      return button;
    }

    const declinationUpBtn = createDeclinationStepButton("▲", "편각 1도 증가");
    const declinationDownBtn = createDeclinationStepButton("▼", "편각 1도 감소");
    declinationSteps.appendChild(declinationUpBtn);
    declinationSteps.appendChild(declinationDownBtn);
    declinationControl.appendChild(declinationInputBox);
    declinationControl.appendChild(declinationSteps);
    declinationWrap.appendChild(declinationControl);

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
    actions.style.marginTop = "12px";

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
      declinationSignBtn,
      declinationUpBtn,
      declinationDownBtn,
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

      function adjustDeclination(step) {
        const current = parseDeclinationValue(dialog.declinationInput.value);
        const value = current.ok ? current.value : 0;
        dialog.declinationInput.value = String(Number((value + step).toFixed(6)));
        dialog.declinationInput.blur();
        dialog.declinationInput.dispatchEvent(new Event("input", { bubbles: true }));
      }

      dialog.declinationUpBtn.onclick = function () { adjustDeclination(1); };
      dialog.declinationDownBtn.onclick = function () { adjustDeclination(-1); };
      dialog.declinationSignBtn.onclick = function () {
        const current = parseDeclinationValue(dialog.declinationInput.value);
        dialog.declinationInput.value = String(current.ok ? -current.value : 0);
        dialog.declinationInput.blur();
        dialog.declinationInput.dispatchEvent(new Event("input", { bubbles: true }));
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
          if (event.target === dialog.declinationSignBtn || event.target === dialog.declinationUpBtn || event.target === dialog.declinationDownBtn) return;
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
        declinationDeg: values.declinationDeg
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
          owner: item.owner || null,
          heading: item.heading,
          lat: item.lat,
          lng: item.lng,
          createdAt: item.createdAt || null,
          updatedAt: item.updatedAt || null,
          detectors: (Array.isArray(item.detectors) ? item.detectors : []).map((detector) => ({
            detectorName: detector.detectorName,
            signalStrength: detector.signalStrength
          }))
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
    setFiltersOpen(false);
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
    setFiltersOpen(false);
    if (obsSheetEl) obsSheetEl.classList.add("hidden");
    if (obsListPanelEl) obsListPanelEl.classList.add("hidden");
  }

  function isRegisterPopupOpen() {
    var registerBox = document.getElementById("register-box");
    return !!(registerBox && !registerBox.classList.contains("hidden"));
  }

  // 등록 팝업이 닫힌 후 목록 패널을 다시 표시한다 (currentTab 이 "list" 일 때만).
  function showPanel() {
    if (currentTab !== "list") return;
    _showListPanels();
  }

  // 목록 패널을 닫으면서 내부 상태를 초기화한다.
  function closeListPanel() {
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
    const onLayoutChange = () => {
      // A phone drag position must not override the tablet popup's CSS anchor.
      if (obsSheetEl) for (const property of ["left", "right", "top", "width"]) obsSheetEl.style.removeProperty(property);
      _setTabletPanelVisualState(currentTab === "list" && !!obsSheetEl && !obsSheetEl.classList.contains("hidden"));
    };
    if (_tabletLandscapeMq.addEventListener) _tabletLandscapeMq.addEventListener("change", onLayoutChange);
    else if (_tabletLandscapeMq.addListener) _tabletLandscapeMq.addListener(onLayoutChange);
    if (btnRefresh) btnRefresh.addEventListener("click", async () => {
      btnRefresh.disabled = true;
      try {
        await refreshObservationData();
        statusEl.textContent = remoteError ? "서버 조회 실패 · 저장된 로컬 자료를 표시합니다: " + remoteError : "공유 관측점을 새로고침했습니다.";
      } finally { btnRefresh.disabled = false; }
    });
    if (btnSendSelected) btnSendSelected.addEventListener("click", () => {
      void sendItems(observationSamples.filter(item => selectedObsIds.has(item._obsKey)));
    });
    window.addEventListener("observations-changed", () => { void refreshObservationData({ localOnly: true }); });
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
      const selectedItems = getSelectedObservations().filter(item => !["sending", "conflict"].includes(item.shareState));
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
      obsSheetHeaderEl.addEventListener("lostpointercapture", endSheetDrag);
    }

    window.addEventListener("resize", keepSheetInViewport);
    if (obsSheetEl && typeof ResizeObserver === "function") {
      // Bound only the independent popup; tracking list geometry is unaffected.
      const popupResizeObserver = new ResizeObserver(keepSheetInViewport);
      popupResizeObserver.observe(obsSheetEl);
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
    if (btnFilterEl) btnFilterEl.addEventListener("click", () => setFiltersOpen(filterPanelEl.hidden));
    if (filterSummaryEl) filterSummaryEl.addEventListener("click", () => setFiltersOpen(filterPanelEl.hidden));
    if (ownerFilterEl) ownerFilterEl.addEventListener("change", applySearch);
    if (periodFilterEl) periodFilterEl.addEventListener("change", applySearch);
    for (const element of [dayFilterEl, monthFilterEl, yearFilterEl]) if (element) element.addEventListener("input", applySearch);
    if (btnMineFilterEl) btnMineFilterEl.addEventListener("click", () => {
      syncFilterControls();
      const owner = lastRegisteredOwner();
      if (owner && ownerFilterEl) ownerFilterEl.value = owner;
      applySearch();
    });
    if (btnFilterDoneEl) btnFilterDoneEl.addEventListener("click", () => { setFiltersOpen(false); btnFilterEl?.focus(); });
    if (btnSearchClearEl) btnSearchClearEl.addEventListener("click", () => {
      if (searchQueryEl) searchQueryEl.value = "";
      if (searchFieldEl) searchFieldEl.value = "obs";
      clearObservationFilters();
      setFiltersOpen(false);
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
    syncFilterControls();
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
