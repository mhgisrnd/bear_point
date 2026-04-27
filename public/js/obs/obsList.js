// public/js/obs/obsList.js

window.createObsListModule = function createObsListModule({
  map,
  statusEl,
  flyToLatLng,
  observationMarkersLayer,
  updateRegistrationPreview
}) {
  const btnBear = document.getElementById("btn-obs-list");
  const btnObsAdd = document.getElementById("btn-obs-add");
  const btnAnalysis = document.getElementById("btn-analysis");
  const btnDeleteSelected = document.getElementById("btn-delete-selected");

  const obsSheetEl = document.getElementById("obs-sheet");
  const registerBoxEl = document.getElementById("register-box");
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

  function moveToObservation(item) {
    if (!item) return;
    flyToLatLng([item.lat, item.lng], 17);
  }

  function updateObservationMarkerScale() {
    const zoom = map.getZoom();

    for (const marker of observationMarkers) {
      if (!marker?.obsData) continue;
      marker.setIcon(createObservationIcon(marker.obsData, zoom));
    }
  }

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
      chk?.addEventListener("click", (e) => {
        e.stopPropagation();
        handleObsCheck(item.id, chk.checked, row);
      });

      const editBtn = row.querySelector('[data-action="edit"]');
      const deleteBtn = row.querySelector('[data-action="delete"]');

      editBtn?.addEventListener("click", (e) => {
        e.stopPropagation();
        statusEl.textContent = `✏️ ${item.id} 수정 UI 준비 중`;
      });

      deleteBtn?.addEventListener("click", (e) => {
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

  function syncChkAll(items) {
    if (!chkAllEl) return;
    const allChecked = items.length > 0 && items.every((it) => selectedObsIds.has(it.id));
    const someChecked = items.some((it) => selectedObsIds.has(it.id));
    chkAllEl.checked = allChecked;
    chkAllEl.indeterminate = !allChecked && someChecked;
  }

  function getFilteredItems() {
    const field = searchFieldEl?.value ?? "obs";
    const query = (searchQueryEl?.value ?? "").trim().toLowerCase();
    if (!query) return observationSamples;
    return observationSamples.filter((item) => {
      if (field === "bear") return item.bearCode.toLowerCase().includes(query);
      return item.id.toLowerCase().includes(query);
    });
  }

  function applySearch() {
    const filtered = getFilteredItems();
    renderObservationList(filtered);
  }

  function setActiveTab(activeBtn) {
    [btnBear, btnObsAdd].forEach((button) => button?.classList.remove("tab-active"));
    activeBtn?.classList.add("tab-active");
  }

  function setTabLayout(tab) {
    currentTab = tab;
    const isList = tab === "list";

    if (!isList) {
      map.closePopup();
    }

    obsSheetEl?.classList.toggle("hidden", !isList);
    registerBoxEl?.classList.toggle("hidden", isList);
    obsListPanelEl?.classList.toggle("hidden", !isList);
    observationMarkersLayer.clearLayers();

    if (isList) {
      applySearch();
      renderObservationMarkers(observationSamples);
    }
  }

  function bindEvents() {
    map.on("zoomend", () => {
      if (currentTab === "list") {
        updateObservationMarkerScale();
      }
    });

    btnBear?.addEventListener("click", () => {
      const willClose = currentTab === "list";

      if (willClose) {
        setActiveTab(null);
        setTabLayout("none");
        return;
      }

      setActiveTab(btnBear);
      setTabLayout("list");
    });

    btnObsAdd?.addEventListener("click", () => {
      setActiveTab(btnObsAdd);
      setTabLayout("add");
      updateRegistrationPreview?.();
      statusEl.textContent = "🧭 현재 위치와 방향각으로 관측점 등록 준비";
    });

    btnAnalysis?.addEventListener("click", () => {
      if (selectedObsIds.size !== 2) {
        statusEl.textContent = "⚠️ 위치분석은 관측점 2개를 선택해야 합니다.";
        return;
      }
      const ids = [...selectedObsIds];
      statusEl.textContent = `📐 위치분석: [${ids.join(", ")}] 분석 준비 중`;
    });

    btnDeleteSelected?.addEventListener("click", () => {
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

    obsSheetEl?.addEventListener("pointerdown", (e) => e.stopPropagation());
    obsSheetEl?.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
    obsSheetEl?.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    obsTableWrapEl?.addEventListener("touchmove", (e) => e.stopPropagation(), { passive: true });
    obsTableWrapEl?.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });
    obsTableBodyScrollableEl?.addEventListener("touchmove", (e) => e.stopPropagation(), { passive: true });
    obsTableBodyScrollableEl?.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

    searchQueryEl?.addEventListener("input", applySearch);
    searchFieldEl?.addEventListener("change", applySearch);
    btnSearchClearEl?.addEventListener("click", () => {
      if (searchQueryEl) searchQueryEl.value = "";
      applySearch();
    });

    chkAllEl?.addEventListener("change", () => {
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

  function initialize() {
    bindEvents();
    updateSelectionUI();
    setTabLayout(currentTab);
    setActiveTab(currentTab === "list" ? btnBear : null);
  }

  return {
    initialize,
    setTabLayout,
    getCurrentTab: () => currentTab,
    renderObservationMarkers,
    refreshObservationList: applySearch
  };
};
