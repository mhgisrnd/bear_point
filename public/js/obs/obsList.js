// public/js/obs/obsList.js
//관측점 목록

window.createObsListModule = function createObsListModule({
  map,
  statusEl,
  flyToLatLng,
  observationMarkersLayer,
  onOpenList,
  onOpenRegister,
  onCloseRegister
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

  const selectedObsIds = new Set();
  const observationMarkers = [];
  const observationSamples = [
    { id: "p1", bearCode: "001", owner: "1팀", lat: 35.3112, lng: 127.6551, heading: "124°" },
    { id: "p2", bearCode: "001", owner: "2팀", lat: 35.3131, lng: 127.6624, heading: "82°" },
    { id: "p3", bearCode: "002", owner: "3팀", lat: 35.3157, lng: 127.6493, heading: "301°" },
    { id: "p4", bearCode: "001", owner: "1팀", lat: 35.3112, lng: 127.6551, heading: "124°" },
    { id: "p5", bearCode: "001", owner: "2팀", lat: 35.3131, lng: 127.6624, heading: "82°" },
    { id: "p6", bearCode: "002", owner: "3팀", lat: 35.3157, lng: 127.6493, heading: "301°" },
    { id: "p7", bearCode: "001", owner: "1팀", lat: 35.3112, lng: 127.6551, heading: "124°" },
    { id: "p8", bearCode: "001", owner: "2팀", lat: 35.3131, lng: 127.6624, heading: "82°" },
    { id: "p9", bearCode: "002", owner: "3팀", lat: 35.3157, lng: 127.6493, heading: "301°" },
    { id: "p10", bearCode: "001", owner: "1팀", lat: 35.3112, lng: 127.6551, heading: "124°" },
    { id: "p11", bearCode: "001", owner: "2팀", lat: 35.3131, lng: 127.6624, heading: "82°" },
    { id: "p12", bearCode: "002", owner: "3팀", lat: 35.3157, lng: 127.6493, heading: "301°" },
    { id: "p13", bearCode: "001", owner: "1팀", lat: 35.3112, lng: 127.6551, heading: "124°" },
    { id: "p14", bearCode: "001", owner: "2팀", lat: 35.3131, lng: 127.6624, heading: "82°" },
    { id: "p15", bearCode: "002", owner: "3팀", lat: 35.3157, lng: 127.6493, heading: "301°" }
  ];

  let currentTab = "none";
  let isPeekMode = false;

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
    const scale = Math.min(1.05, Math.max(0.65, rawScale));

    const wrapperSize = Math.round(52 * scale);
    const circleSize = Math.round(30 * scale);
    const fontSize = Math.max(9, Math.round(12 * scale));
    const pointerLeft = Math.round(6 * scale);
    const pointerSide = Math.max(6, Math.round(12 * scale));
    const pointerHeight = Math.max(10, Math.round(18 * scale));
    const iconAnchorX = Math.round(wrapperSize / 2);
    const iconAnchorY = Math.round(wrapperSize * 0.77);

    return L.divIcon({
      className: "observation-pin-icon",
      html: `
        <div style="position:relative;width:${wrapperSize}px;height:${wrapperSize}px;display:flex;align-items:flex-end;justify-content:center;">
          <div style="position:absolute;top:0;left:${pointerLeft}px;width:0;height:0;border-left:${pointerSide}px solid transparent;border-right:${pointerSide}px solid transparent;border-bottom:${pointerHeight}px solid #3b82f6;transform:rotate(-18deg);"></div>
          <div style="width:${circleSize}px;height:${circleSize}px;border-radius:50%;background:#4c6fd3;color:#fff;font-weight:800;font-size:${fontSize}px;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 18px rgba(37,99,235,0.32);">${item.id}</div>
        </div>
      `,
      iconSize: [wrapperSize, wrapperSize],
      iconAnchor: [iconAnchorX, iconAnchorY]
    });
  }

  // 현재 필터링된 관측점 목록을 지도 마커 레이어에 렌더링한다.
  function renderObservationMarkers(items) {
    observationMarkersLayer.clearLayers();
    observationMarkers.length = 0;
    const zoom = map.getZoom();

    for (const item of items) {
      const marker = L.marker([item.lat, item.lng], { icon: createObservationIcon(item, zoom) });
      marker.obsData = item;
      marker.bindPopup(
        `관측점 ${item.id}<br/>` +
        `곰 코드 ${item.bearCode}<br/>` +
        `등록자 ${item.owner}<br/>` +
        `위경도 ${item.lat.toFixed(6)}, ${item.lng.toFixed(6)}`
      );
      observationMarkersLayer.addLayer(marker);
      observationMarkers.push(marker);
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

    for (const item of items) {
      const row = document.createElement("tr");
      const isChecked = selectedObsIds.has(item.id);
      if (isChecked) row.classList.add("selected");

      row.innerHTML = `
        <td class="col-chk"><input type="checkbox" class="obs-row-chk" data-id="${item.id}" ${isChecked ? "checked" : ""} /></td>
        <td>${item.id}</td>
        <td>${item.bearCode}</td>
        <td>${item.owner}</td>
        <td>
          <div class="obs-actions">
            <button class="obs-action-btn edit" type="button" data-action="edit">수정</button>
            <button class="obs-action-btn delete" type="button" data-action="delete">삭제</button>
          </div>
        </td>
      `;

      const chk = row.querySelector(".obs-row-chk");
      if (chk) chk.addEventListener("click", (e) => {
        e.stopPropagation();
        handleObsCheck(item.id, chk.checked, row);
      });

      const editBtn = row.querySelector('[data-action="edit"]');
      const deleteBtn = row.querySelector('[data-action="delete"]');

      if (editBtn) editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        statusEl.textContent = `✏️ ${item.id} 수정 UI 준비 중`;
      });

      if (deleteBtn) deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        statusEl.textContent = `🗑️ ${item.id} 삭제 UI 준비 중`;
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
      return item.id.toLowerCase().includes(query);
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
      applySearch();
      renderObservationMarkers(observationSamples);
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
      const ids = [...selectedObsIds];
      statusEl.textContent = `📐 위치분석: [${ids.join(", ")}] 분석 준비 중`;
    });

    if (btnDeleteSelected) btnDeleteSelected.addEventListener("click", () => {
      if (selectedObsIds.size < 1) return;

      const selectedIds = new Set(selectedObsIds);
      let deletedCount = 0;

      for (let i = observationSamples.length - 1; i >= 0; i -= 1) {
        if (selectedIds.has(observationSamples[i].id)) {
          observationSamples.splice(i, 1);
          deletedCount += 1;
        }
      }

      selectedObsIds.clear();
      applySearch();
      if (currentTab === "list") {
        renderObservationMarkers(observationSamples);
      }
      updateSelectionUI();

      statusEl.textContent = deletedCount > 0
        ? `🗑️ ${deletedCount}개 관측점을 선택 삭제했습니다.`
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

  return {
    initialize,
    setTabLayout,
    deactivate: closeListPanel,
    getCurrentTab: () => currentTab,
    renderObservationMarkers,
    refreshObservationList: applySearch
  };
};
