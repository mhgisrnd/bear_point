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
  const btnObsAdd = document.getElementById("btn-obs-add");
  const btnAnalysis = document.getElementById("btn-analysis");
  const btnDeleteSelected = document.getElementById("btn-delete-selected");
  const btnObsListPeek = document.getElementById("btn-obs-list-peek");
  const btnObsListClose = document.getElementById("btn-obs-list-close");

  const obsSheetEl = document.getElementById("obs-sheet");
  const obsListPanelEl = document.getElementById("obs-list-panel");
  const obsListBodyEl = document.getElementById("obs-list-body");
  const obsTableWrapEl = document.querySelector(".obs-table-wrap");
  const obsTableBodyScrollableEl = document.querySelector(".obs-table tbody");
  const obsListStatusEl = document.getElementById("obs-list-status");
  const searchFieldEl = document.getElementById("search-field");
  const searchQueryEl = document.getElementById("search-query");
  const btnSearchClearEl = document.getElementById("btn-search-clear");
  const chkAllEl = document.getElementById("chk-all");
  const OBSERVATION_DEMO_URL = "json/observations.json"; //웹 더미 데이터 URL

  const selectedObsIds = new Set();
  const observationMarkers = [];
  let observationSamples = [];
  let currentTab = "none";
  let isPeekMode = false;
  let observationKeySeed = 0;
  let analysisOptionsDialogState = null;
  let analysisCloseSilently = false;

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
    obsListStatusEl.textContent = `${count}건`;
    obsListStatusEl.hidden = false;
  }

  async function refreshObservationData() {
    const result = await loadObservationSamples();
    selectedObsIds.clear();
    applySearch();
    renderObservationMarkers(observationSamples);
    updateSelectionUI();

    updateObservationSummary();
  }

  // 목록 패널 최소화/복원 상태를 토글하고 아이콘 상태를 동기화한다.
  function setPeekMode(nextState) {
    isPeekMode = !!nextState;
    if (obsSheetEl) obsSheetEl.classList.toggle("obs-sheet--peek", isPeekMode);
    if (btnObsListPeek) {
      btnObsListPeek.textContent = isPeekMode ? "□" : "―";
      btnObsListPeek.setAttribute("aria-label", isPeekMode ? "확장" : "최소화");
      btnObsListPeek.setAttribute("title", isPeekMode ? "확장" : "최소화");
    }
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
  function moveToObservation(item) {
    if (!item) return;
    flyToLatLng([item.lat, item.lng], 17);
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
        moveToObservation(item);
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

    // 배지를 obs-header-actions 안에 배치한다.
    const headerActions = document.querySelector(".obs-header-actions");
    let badge = document.querySelector(".sel-count-badge");
    
    if (!badge && headerActions) {
      badge = document.createElement("span");
      badge.className = "sel-count-badge";
      headerActions.insertBefore(badge, headerActions.firstChild);
    }
    
    if (badge) {
      badge.textContent = count > 0 ? `${count}개 선택` : "";
      badge.style.opacity = count > 0 ? "1" : "0";
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
      return;
    }

    const selectedItems = getSelectedObservations();
    if (selectedItems.length < 2) {
      statusEl.textContent = "⚠️ 위치분석은 관측점 2개 이상을 선택해야 합니다.";
      return;
    }

    const bearCodes = new Set(selectedItems.map((item) => String(item.bearCode || "").trim()));
    if (bearCodes.size !== 1 || !Array.from(bearCodes)[0]) {
      statusEl.textContent = "⚠️ 동일한 코드의 관측점을 선택해주세요.";
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
    [btnBear, btnObsAdd].forEach((button) => { if (button) button.classList.remove("tab-active"); });
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

  // 목록 패널을 닫으면서 내부 상태를 초기화한다.
  function closeListPanel() {
    resetList();
    setPeekMode(false);
    setActiveTab(null);
    setTabLayout("none");
    if (typeof onClearAnalysisEstimate === "function") onClearAnalysisEstimate();
  }

  // 현재 탭 상태(list/add/none)에 맞게 레이아웃과 마커를 제어한다.
  function setTabLayout(tab) {
    currentTab = tab;
    const isList = tab === "list";

    if (!isList) {
      map.closePopup();
      observationMarkersLayer.clearLayers();
    }

    if (obsSheetEl) obsSheetEl.classList.toggle("hidden", !isList);
    if (obsListPanelEl) obsListPanelEl.classList.toggle("hidden", !isList);

    if (isList) {
      setPeekMode(false);
      void refreshObservationData();
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
      const willClose = currentTab === "list";

      if (willClose) {
        const ok = await confirmAndEscapeAnalysis();
        if (!ok) return;
        closeListPanel();
        return;
      }

      setActiveTab(btnBear);
      setTabLayout("list");
      if (onOpenList) onOpenList();
      if (onCloseRegister) onCloseRegister();
    });

    if (btnObsAdd) btnObsAdd.addEventListener("click", async () => {
      // 위치분석 탭이 떠 있을 때 등록으로 전환하면 확인 후 종료한다.
      const analysisOk = await confirmAndEscapeAnalysis("위치분석이 진행 중입니다. 등록 화면으로 이동하시겠습니까?");
      if (!analysisOk) return;

      const willClose = currentTab === "add";

      if (willClose) {
        setActiveTab(null);
        setTabLayout("none");
        if (onCloseRegister) onCloseRegister();
        return;
      }

      resetList();
      setActiveTab(btnObsAdd);
      setTabLayout("add");
      if (typeof onClearAnalysisEstimate === "function") onClearAnalysisEstimate();
      if (onOpenRegister) onOpenRegister();
    });

    if (btnAnalysis) btnAnalysis.addEventListener("click", () => {
      void runPositionAnalysis();
    });

    // 선택된 관측점 삭제 버튼 핸들러
    if (btnDeleteSelected) btnDeleteSelected.addEventListener("click", async () => {
      if (selectedObsIds.size < 1) return;

      // Step 1: 사용자 확인 대화
      // 사용자가 실수로 삭제하지 않도록 재확인 요청
      const count = selectedObsIds.size;
      const confirmed = window.confirm(`${count}개 관측점을 정말 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`);
      if (!confirmed) {
        statusEl.textContent = "⚠️ 삭제 취소됨";
        return;
      }

      // Step 2: SQLite 데이터베이스에서 삭제
      // 네이티브 환경(모바일 앱)에서만 SQLite 삭제 수행
      const selectedItems = getSelectedObservations();
      const selectedIds = selectedItems.map((item) => item.id);
      const selectedKeys = new Set(selectedItems.map((item) => item._obsKey));
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

            // 각 선택된 ID마다 DELETE 쿼리 실행
            // SQL 인젝션 방지: 싱글 쿼트를 이중 쿼트로 이스케이프
            for (const id of selectedIds) {
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

      // Step 3: 메모리 배열에서 삭제
      // UI 상태를 최신으로 유지하기 위해 observationSamples 배열에서도 제거
      const initialLength = observationSamples.length;
      for (let i = observationSamples.length - 1; i >= 0; i -= 1) {
        if (selectedKeys.has(observationSamples[i]._obsKey)) {
          observationSamples.splice(i, 1);
        }
      }

      // Step 4: UI 상태 초기화
      // 선택된 ID 집합 초기화, 검색 재적용, 마커/테이블 갱신
      selectedObsIds.clear();
      applySearch();
      if (currentTab === "list") {
        renderObservationMarkers(observationSamples);
      }
      updateSelectionUI();

      // Step 5: 사용자에게 결과 메시지 표시
      const memoryDeletedCount = initialLength - observationSamples.length;
      statusEl.textContent = memoryDeletedCount > 0
        ? `🗑️ ${memoryDeletedCount}개 관측점을 삭제했습니다.`
        : "🟠 삭제할 관측점이 없습니다.";

      updateObservationSummary();

    });

    if (btnObsListPeek) btnObsListPeek.addEventListener("click", () => {
      setPeekMode(!isPeekMode);
    });

    if (btnObsListClose) btnObsListClose.addEventListener("click", () => {
      closeListPanel();
    });

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
    setActiveTab(btnBear);
    setTabLayout("list");
    if (onOpenList) onOpenList();
    if (onCloseRegister) onCloseRegister();
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
    setTabLayout,
    deactivate: closeListPanel,
    getCurrentTab: () => currentTab,
    handleBackNavigation,
    addObservation,
    updateObservation,
    renderObservationMarkers,
    refreshObservationList: refreshObservationData
  };
};
