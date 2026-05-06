// public/js/obs/obsList.js
//관측점 목록

window.createObsListModule = function createObsListModule({
  map,
  statusEl,
  flyToLatLng,
  observationMarkersLayer,
  onOpenList,
  onOpenRegister,
  onCloseRegister,
  onEditObservation
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

    return `
      <div class="obs-popup-card">
        <div class="obs-popup-card__eyebrow">${title}</div>
        <div class="obs-popup-card__grid">
          <div class="obs-popup-card__row">
            <span class="obs-popup-card__label">곰 코드</span>
            <span class="obs-popup-card__value">${bearCode}</span>
          </div>
          <div class="obs-popup-card__row">
            <span class="obs-popup-card__label">등록자</span>
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

    return { id, place, bearCode, owner, lat, lng, heading, detectors };
  }

  // 웹 미리보기에서는 observations.json을 관측점 소스로 사용한다.
  async function loadObservationSamplesFromDemoJson() {
    try {
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
          SELECT id, place, bear_code, owner, lat, lng, heading, detectors_json
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
  async function refreshObservationData() {
    const result = await loadObservationSamples();
    selectedObsIds.clear();
    applySearch();
    renderObservationMarkers(observationSamples);
    updateSelectionUI();

    if (statusEl) {
      if (result.source === "sqlite") {
        statusEl.textContent = `✅ 관측점 ${observationSamples.length}건 로드`;
      } else if (result.source === "demo") {
        statusEl.textContent = `🧪 웹 더미 관측점 ${observationSamples.length}건 로드`;
      } else {
        statusEl.textContent = "ℹ️ 관측점 데이터가 없습니다.";
      }
    }
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
      item.isSelected = selectedObsIds.has(item.id);
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
      marker.obsData.isSelected = selectedObsIds.has(marker.obsData.id);
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
      const isChecked = selectedObsIds.has(item.id);
      if (isChecked) row.classList.add("selected");

      row.innerHTML = `
        <td class="col-chk"><input type="checkbox" class="obs-row-chk" data-id="${item.id}" ${isChecked ? "checked" : ""} /></td>
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
        handleObsCheck(item.id, chk.checked, row);
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

    let badge = document.querySelector(".sel-count-badge");
    const header = document.querySelector(".obs-sheet-header h2");
    if (!badge && header) {
      badge = document.createElement("span");
      badge.className = "sel-count-badge";
      header.appendChild(badge);
    }
    if (badge) {
      badge.textContent = count > 0 ? `${count}개 선택` : "";
      badge.style.opacity = count > 0 ? "1" : "0";
    }

    if (btnAnalysis) {
      const canAnalyze = count === 2;
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
    const allChecked = items.length > 0 && items.every((it) => selectedObsIds.has(it.id));
    const someChecked = items.some((it) => selectedObsIds.has(it.id));
    chkAllEl.checked = allChecked;
    chkAllEl.indeterminate = !allChecked && someChecked;
  }

  // 검색 조건(관측점/곰 코드)에 맞는 데이터만 반환한다.
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

    if (btnBear) btnBear.addEventListener("click", () => {
      const willClose = currentTab === "list";

      if (willClose) {
        closeListPanel();
        return;
      }

      setActiveTab(btnBear);
      setTabLayout("list");
      if (onOpenList) onOpenList();
      if (onCloseRegister) onCloseRegister();
    });

    if (btnObsAdd) btnObsAdd.addEventListener("click", () => {
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
      if (onOpenRegister) onOpenRegister();
    });

    if (btnAnalysis) btnAnalysis.addEventListener("click", () => {
      if (selectedObsIds.size !== 2) {
        statusEl.textContent = "⚠️ 위치분석은 관측점 2개를 선택해야 합니다.";
        return;
      }
      // TODO: 위치분석 기능 미구현
      // const ids = [...selectedObsIds];
      // statusEl.textContent = `📐 위치분석: [${ids.join(", ")}] 분석 준비 중`;
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
      const selectedIds = Array.from(selectedObsIds);
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
        if (selectedIds.includes(observationSamples[i].id)) {
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
        filtered.forEach((it) => selectedObsIds.add(it.id));
      } else {
        filtered.forEach((it) => selectedObsIds.delete(it.id));
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
  }

  function openList() {
    setActiveTab(btnBear);
    setTabLayout("list");
    if (onOpenList) onOpenList();
    if (onCloseRegister) onCloseRegister();
  }

  return {
    initialize,
    openList,
    setTabLayout,
    deactivate: closeListPanel,
    getCurrentTab: () => currentTab,
    addObservation,
    updateObservation,
    renderObservationMarkers,
    refreshObservationList: refreshObservationData
  };
};
