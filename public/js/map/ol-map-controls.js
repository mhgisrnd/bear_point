// public/js/map/ol-map-controls.js
// OpenLayers controls manager: base-layer switcher + right-bottom controls + distance measure.

window.createOlMapControlsManager = function createOlMapControlsManager(options) {
  const {
    ol,
    map,
    mapEl,
    view,
    statusEl,
    wgs84FromMapCoord,
    extentMap,
    offlineInitialCenterLatLng,
    mbtilesExtentMap,
    ngiiApiKey,
    mbtilesMinZoom,
    mbtilesMaxZoom,
    onlineMaxZoom,
    offlineInitialZoom,
    hillshadeBaseOpacity,
    hillshadeSafeMaxZoom,
    initialBaseLayerType,
    layers,
    measureSource,
    onToggleMyLocation,
    onCompassClick,
    onStopFollowing,
    onMeasureActivated,
    onLocateButtonReady
  } = options || {};

  let currentBaseLayerType = String(initialBaseLayerType || "mbtiles");
  let measureDistanceBtnEl = null;
  let measureAreaBtnEl = null;
  let measureCompleteBtnEl = null;
  let measureUndoBtnEl = null;
  let measureModeBadgeEl = null;
  let measureActionPanelEl = null;
  let measureToolsEl = null;
  let measureModeActive = false;
  let measureModeType = null;
  let measureDraftPoints = [];
  let measureDraftFeatures = [];
  let measureRecords = [];
  let nextMeasureId = 1;

  function getActiveMaxZoomForBaseLayer(baseLayerType) {
    return baseLayerType === "mbtiles" ? mbtilesMaxZoom : onlineMaxZoom;
  }

  function applyViewZoomBounds(baseLayerType) {
    const maxZoom = getActiveMaxZoomForBaseLayer(baseLayerType);
    view.setMinZoom(mbtilesMinZoom);
    view.setMaxZoom(maxZoom);
    const currentZoom = view.getZoom();
    if (typeof currentZoom === "number" && currentZoom > maxZoom) {
      view.setZoom(maxZoom);
    }
  }

  function isLikelyKoreaExtent(extent) {
    if (!extent || !Array.isArray(extent)) return false;
    const center = ol.extent.getCenter(extent);
    const coord = wgs84FromMapCoord(center);
    if (!coord) return false;
    const lon = coord.lng;
    const lat = coord.lat;
    return lon >= 120 && lon <= 132 && lat >= 30 && lat <= 40;
  }

  function fitMbtilesCoverage() {
    if (!mbtilesExtentMap) return false;
    if (!isLikelyKoreaExtent(mbtilesExtentMap)) return false;
    view.fit(mbtilesExtentMap, {
      padding: [20, 20, 20, 20],
      maxZoom: 14,
      duration: 500
    });
    return true;
  }

  function moveToOfflineInitialView(options) {
    const moveOptions = options || {};
    const duration = Number.isFinite(Number(moveOptions.duration)) ? Number(moveOptions.duration) : 0;

    if (Array.isArray(offlineInitialCenterLatLng) && offlineInitialCenterLatLng.length >= 2) {
      const lat = Number(offlineInitialCenterLatLng[0]);
      const lng = Number(offlineInitialCenterLatLng[1]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const coord = ol.proj.transform([lng, lat], "EPSG:4326", "EPSG:5179");
        view.animate({
          center: coord,
          zoom: Number.isFinite(offlineInitialZoom) ? offlineInitialZoom : 14,
          duration: duration
        });
        return true;
      }
    }

    if (!Array.isArray(extentMap) || extentMap.length !== 4) return false;
    view.fit(extentMap, {
      padding: [20, 20, 20, 20],
      maxZoom: 14,
      duration: duration
    });
    return true;
  }

  function setBaseLayer(type) {
    let nextType = type;
    const ONLINE_TYPES = ["osm", "english", "large", "satellite"];
    if (nextType !== "mbtiles" && !ONLINE_TYPES.includes(nextType)) {
      nextType = "mbtiles";
    }

    if (nextType !== "mbtiles" && !ngiiApiKey) {
      if (statusEl) statusEl.textContent = "🟠 NGII API 키가 없어 오프라인 지도로 전환합니다";
      nextType = "mbtiles";
    }

    if (nextType === currentBaseLayerType) return;

    applyViewZoomBounds(nextType);

    layers.osmBase.setVisible(nextType === "osm");
    layers.englishBase.setVisible(nextType === "english");
    layers.largeBase.setVisible(nextType === "large");
    layers.satelliteBase.setVisible(nextType === "satellite");
    layers.mbtilesLayer.setVisible(nextType === "mbtiles");

    if (nextType === "mbtiles") {
      const moved = moveToOfflineInitialView() || fitMbtilesCoverage();
      if (!moved && statusEl) {
        statusEl.textContent = "🟡 오프라인 범위 확인 실패, 기존 위치를 유지합니다";
      } else if (statusEl) {
        statusEl.textContent = "📦 오프라인 기본도 사용 중";
      }
    } else if (statusEl) {
      const labels = {
        osm: "🌐 국문지도",
        english: "🌐 영문지도",
        large: "🌐 큰 문자지도",
        satellite: "🛰️ 위성지도"
      };
      statusEl.textContent = labels[nextType] || "🌐 온라인 지도 사용 중";
    }

    currentBaseLayerType = nextType;
  }

  function syncHillshadeByZoom() {
    const zoom = view.getZoom();
    if (typeof zoom !== "number") return;
    layers.hillshadeOverlay.setOpacity(zoom > hillshadeSafeMaxZoom ? 0 : hillshadeBaseOpacity);
  }

  function formatMeasureDistanceText(distanceM) {
    if (!Number.isFinite(distanceM) || distanceM < 0) return "거리 -";
    if (distanceM >= 1000) return "거리 " + (distanceM / 1000).toFixed(2) + "km";
    return "거리 " + Math.round(distanceM) + "m";
  }

  function formatMeasureAreaText(areaM2) {
    if (!Number.isFinite(areaM2) || areaM2 < 0) return "면적 -";
    if (areaM2 >= 1000000) return "면적 " + (areaM2 / 1000000).toFixed(2) + "km²";
    if (areaM2 >= 10000) return "면적 " + Math.round(areaM2).toLocaleString() + "㎡";
    return "면적 " + Math.round(areaM2) + "㎡";
  }

  function isAreaMeasureMode() {
    return measureModeType === "area";
  }

  function getCurrentMeasureModeLabel() {
    return isAreaMeasureMode() ? "면적측정" : "거리측정";
  }

  function toClosedRing(points) {
    if (!Array.isArray(points) || !points.length) return [];
    const ring = points.slice();
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (!last || first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
    return ring;
  }

  function getDraftDistanceM() {
    if (!Array.isArray(measureDraftPoints) || measureDraftPoints.length < 2) return 0;
    return new ol.geom.LineString(measureDraftPoints).getLength();
  }

  function getDraftAreaM2() {
    if (!Array.isArray(measureDraftPoints) || measureDraftPoints.length < 3) return 0;
    const ring = toClosedRing(measureDraftPoints);
    return new ol.geom.Polygon([ring]).getArea();
  }

  function updateMeasureActionButtons() {
    const hasAnyPoint = measureDraftPoints.length >= 1;
    const canComplete = isAreaMeasureMode() ? measureDraftPoints.length >= 3 : measureDraftPoints.length >= 2;

    if (measureUndoBtnEl) {
      measureUndoBtnEl.disabled = !hasAnyPoint;
      measureUndoBtnEl.style.opacity = "1";
      measureUndoBtnEl.style.cursor = hasAnyPoint ? "pointer" : "default";
      measureUndoBtnEl.style.background = hasAnyPoint ? "#e2e8f0" : "#f8fafc";
      measureUndoBtnEl.style.color = hasAnyPoint ? "#334155" : "#94a3b8";
      measureUndoBtnEl.style.borderColor = hasAnyPoint ? "#94a3b8" : "#cbd5e1";
    }
    if (measureCompleteBtnEl) {
      measureCompleteBtnEl.disabled = !canComplete;
      measureCompleteBtnEl.style.opacity = "1";
      measureCompleteBtnEl.style.cursor = canComplete ? "pointer" : "default";
      measureCompleteBtnEl.style.background = canComplete ? "#16a34a" : "#f3f4f6";
      measureCompleteBtnEl.style.color = canComplete ? "#ffffff" : "#9ca3af";
      measureCompleteBtnEl.style.borderColor = canComplete ? "#15803d" : "#d1d5db";
    }
  }

  function updateMeasureModeBadge() {
    if (!measureModeBadgeEl) return;
    const isArea = isAreaMeasureMode();
    measureModeBadgeEl.textContent = isArea ? "면적 측정중" : "거리 측정중";
    measureModeBadgeEl.style.background = isArea ? "rgba(8,145,178,0.24)" : "rgba(239,68,68,0.22)";
    measureModeBadgeEl.style.color = isArea ? "#0c4a5a" : "#6b1111";
    measureModeBadgeEl.style.borderColor = isArea ? "rgba(8,145,178,0.72)" : "rgba(220,38,38,0.68)";
  }

  function setMeasureActionPanelVisible(visible) {
    if (!measureActionPanelEl) return;
    measureActionPanelEl.style.display = visible ? "flex" : "none";
  }

  function updateMeasureActionPanelPosition() {
    if (!measureActionPanelEl) return;
    if (!measureModeActive) {
      setMeasureActionPanelVisible(false);
      return;
    }
    setMeasureActionPanelVisible(true);
  }

  // 태블릿 가로에서 측정 액션 패널을 지도 우하단으로 띄울 조건을 판별한다.
  function isTabletLandscapeMeasureLayout() {
    return window.matchMedia(
      "(min-width: 900px) and (orientation: landscape)"
    ).matches;
  }

  // 측정 액션 패널을 태블릿에서는 지도 위로, 그 외에는 기존 패널 내부로 되돌린다.
  function syncMeasureActionPanelContainer() {
    if (!measureActionPanelEl) return;

    const isTablet = isTabletLandscapeMeasureLayout();
    const panelStackEl = document.querySelector(".panel-stack.panel-bottom-left");
    const panelTabsEl = document.querySelector(".panel-tabs.panel-tabs-floating");

    const mobileDock = !!window.BearMobileDock?.isMobile();
    if (isTablet || mobileDock) {
      if (measureActionPanelEl.parentElement !== mapEl) {
        mapEl.appendChild(measureActionPanelEl);
      }

      measureActionPanelEl.style.position = "absolute";
      measureActionPanelEl.style.right = "calc(64px + var(--safe-right))";
      measureActionPanelEl.style.bottom = mobileDock ? "calc(var(--mobile-dock-height) + 12px)" : "calc(20px + var(--safe-bottom))";
      measureActionPanelEl.style.left = "auto";
      measureActionPanelEl.style.top = "auto";
      measureActionPanelEl.style.marginBottom = "0";
      measureActionPanelEl.style.alignSelf = "auto";
      measureActionPanelEl.style.maxWidth = "min(240px, calc(100vw - 120px))";
      return;
    }

    if (panelStackEl && panelTabsEl && panelTabsEl.parentElement === panelStackEl) {
      if (measureActionPanelEl.parentElement !== panelStackEl) {
        panelStackEl.insertBefore(measureActionPanelEl, panelTabsEl);
      }
    } else if (panelStackEl) {
      if (measureActionPanelEl.parentElement !== panelStackEl) {
        panelStackEl.insertBefore(measureActionPanelEl, panelStackEl.firstChild || null);
      }
    } else if (measureActionPanelEl.parentElement !== mapEl) {
      mapEl.appendChild(measureActionPanelEl);
    }

    measureActionPanelEl.style.position = "static";
    measureActionPanelEl.style.right = "";
    measureActionPanelEl.style.bottom = "";
    measureActionPanelEl.style.left = "";
    measureActionPanelEl.style.top = "";
    measureActionPanelEl.style.marginBottom = "-2px";
    measureActionPanelEl.style.alignSelf = "flex-start";
    measureActionPanelEl.style.maxWidth = "78%";
  }

  function clearMeasureVisuals() {
    measureSource.clear();
    measureDraftPoints = [];
    measureDraftFeatures = [];
    for (let i = 0; i < measureRecords.length; i += 1) {
      const record = measureRecords[i];
      if (record && record.overlay) {
        map.removeOverlay(record.overlay);
      }
    }
    measureRecords = [];
    updateMeasureActionButtons();
    updateMeasureActionPanelPosition();
  }

  function clearDraftMeasureVisuals() {
    for (let i = 0; i < measureDraftFeatures.length; i += 1) {
      measureSource.removeFeature(measureDraftFeatures[i]);
    }
    measureDraftFeatures = [];
  }

  function createPointFeature(coord, kind) {
    const feature = new ol.Feature({ geometry: new ol.geom.Point(coord) });
    feature.set("kind", kind);
    return feature;
  }

  function createLineFeature(start, end, kind) {
    const isPath = Array.isArray(start) && start.length > 0 && Array.isArray(start[0]);
    const points = isPath ? start.slice() : [start, end];
    const feature = new ol.Feature({ geometry: new ol.geom.LineString(points) });
    feature.set("kind", kind || "measure-line");
    return feature;
  }

  function renderDraftMeasureVisuals() {
    clearDraftMeasureVisuals();
    if (!measureDraftPoints.length) return;

    const start = measureDraftPoints[0];
    const startFeature = createPointFeature(start, "measure-point-start");
    measureSource.addFeature(startFeature);
    measureDraftFeatures.push(startFeature);

    if (measureDraftPoints.length < 2) return;

    const end = measureDraftPoints[measureDraftPoints.length - 1];
    const endFeature = createPointFeature(end, "measure-point-end");
    const previewLineKind = isAreaMeasureMode() ? "measure-area-line-preview" : "measure-line-preview";
    const lineFeature = createLineFeature(measureDraftPoints, null, previewLineKind);
    measureSource.addFeature(endFeature);
    measureSource.addFeature(lineFeature);
    measureDraftFeatures.push(endFeature);
    measureDraftFeatures.push(lineFeature);

    if (isAreaMeasureMode() && measureDraftPoints.length >= 3) {
      const polygonFeature = new ol.Feature({ geometry: new ol.geom.Polygon([toClosedRing(measureDraftPoints)]) });
      polygonFeature.set("kind", "measure-area-fill-preview");
      measureSource.addFeature(polygonFeature);
      measureDraftFeatures.push(polygonFeature);
    }
  }

  function removeMeasureRecord(measureId) {
    const index = measureRecords.findIndex(function (record) {
      return record && record.id === measureId;
    });
    if (index < 0) return;

    const record = measureRecords[index];
    if (record && Array.isArray(record.features)) {
      for (let i = 0; i < record.features.length; i += 1) {
        measureSource.removeFeature(record.features[i]);
      }
    }
    if (record && record.overlay) {
      map.removeOverlay(record.overlay);
    }
    measureRecords.splice(index, 1);
  }

  function createMeasureOverlay(measureId, distanceText, position, modeType) {
    const isArea = modeType === "area";
    const labelBg = isArea ? "rgba(224,247,250,0.9)" : "rgba(255,244,214,0.9)";
    const labelText = isArea ? "#164e63" : "#7f1d1d";
    const labelBorder = isArea ? "rgba(8,145,178,0.95)" : "rgba(239,68,68,0.95)";
    const closeColor = isArea ? "rgba(22,78,99,0.78)" : "rgba(127,29,29,0.72)";

    const labelEl = document.createElement("div");
    labelEl.className = "ol-measure-label";
    labelEl.style.cssText = [
      "display:flex",
      "align-items:center",
      "gap:5px",
      "background:" + labelBg,
      "color:" + labelText,
      "font:700 12px/1 sans-serif",
      "padding:4px 8px",
      "border-radius:6px",
      "border:1px solid " + labelBorder,
      "white-space:nowrap",
      "pointer-events:auto",
      "user-select:none",
      "box-shadow:0 1px 6px rgba(15,23,42,0.18)",
      "position:relative",
      "z-index:10001"
    ].join(";");

    const textSpan = document.createElement("span");
    textSpan.textContent = distanceText;
    labelEl.appendChild(textSpan);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.title = "측정 삭제";
    closeBtn.setAttribute("aria-label", "측정 삭제");
    closeBtn.style.cssText = [
      "background:none",
      "border:none",
      "padding:0 0 0 2px",
      "margin:0",
      "cursor:pointer",
      "color:" + closeColor,
      "font-size:13px",
      "line-height:1",
      "display:flex",
      "align-items:center"
    ].join(";");
    closeBtn.innerHTML = '<span aria-hidden="true" style="display:block;width:10px;height:10px;background-color:currentColor;-webkit-mask:url(\'css/svg/control-close.svg\') center / contain no-repeat;mask:url(\'css/svg/control-close.svg\') center / contain no-repeat;"></span>';
    closeBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      removeMeasureRecord(measureId);
      if (statusEl) {
        statusEl.textContent = getCurrentMeasureModeLabel();
      }
    });
    labelEl.appendChild(closeBtn);

    return new ol.Overlay({
      element: labelEl,
      position: position,
      positioning: "bottom-center",
      offset: [0, -8],
      stopEvent: true
    });
  }

  function completeDraftMeasure() {
    if (isAreaMeasureMode() && measureDraftPoints.length < 3) return;
    if (!isAreaMeasureMode() && measureDraftPoints.length < 2) return;

    const points = measureDraftPoints.slice();
    const start = points[0];
    const end = points[points.length - 1];
    clearDraftMeasureVisuals();

    const startFeature = createPointFeature(start, "measure-point-start");
    const endFeature = createPointFeature(end, "measure-point-end");
    const finalLinePoints = isAreaMeasureMode() ? toClosedRing(points) : points;
    const completeLineKind = isAreaMeasureMode() ? "measure-area-line" : "measure-line";
    const lineFeature = createLineFeature(finalLinePoints, null, completeLineKind);
    measureSource.addFeature(startFeature);
    measureSource.addFeature(endFeature);
    measureSource.addFeature(lineFeature);

    let measureText = "";
    let labelPos = end;
    const storedFeatures = [startFeature, endFeature, lineFeature];

    if (isAreaMeasureMode()) {
      const ring = toClosedRing(points);
      const polygon = new ol.geom.Polygon([ring]);
      const areaFeature = new ol.Feature({ geometry: polygon });
      areaFeature.set("kind", "measure-area-fill");
      measureSource.addFeature(areaFeature);
      storedFeatures.push(areaFeature);
      measureText = formatMeasureAreaText(polygon.getArea());
      // 면적 레이블을 폴리곤 경계의 첫 번째 점으로 설정 (내부가 아닌 경계에)
      labelPos = ring.length > 0 ? ring[0] : polygon.getInteriorPoint().getCoordinates();
    } else {
      const distanceM = new ol.geom.LineString(points).getLength();
      measureText = formatMeasureDistanceText(distanceM);
      labelPos = end;
    }

    const measureId = nextMeasureId;
    nextMeasureId += 1;

    const overlay = createMeasureOverlay(measureId, measureText, labelPos, measureModeType);
    map.addOverlay(overlay);
    measureRecords.push({
      id: measureId,
      features: storedFeatures,
      overlay: overlay
    });

    measureDraftPoints = [];
    updateMeasureActionButtons();
    updateMeasureActionPanelPosition();
    if (statusEl) {
      statusEl.textContent = measureText;
    }
  }

  function renderMeasureVisuals() {
    renderDraftMeasureVisuals();
  }

  function handleMeasureMapClick(coord) {
    if (!measureModeActive || !Array.isArray(coord)) return false;

    measureDraftPoints.push(coord);
    renderMeasureVisuals();
    updateMeasureActionButtons();
    updateMeasureActionPanelPosition();

    if (statusEl) {
      if (measureDraftPoints.length < 2) {
        statusEl.textContent = getCurrentMeasureModeLabel();
      } else {
        const draftText = isAreaMeasureMode()
          ? formatMeasureAreaText(getDraftAreaM2())
          : formatMeasureDistanceText(getDraftDistanceM());
        statusEl.textContent = draftText;
      }
    }
    return true;
  }

  function undoLastDraftPoint() {
    if (!measureDraftPoints.length) return;
    measureDraftPoints.pop();
    renderMeasureVisuals();
    updateMeasureActionButtons();
    updateMeasureActionPanelPosition();

    if (!statusEl) return;
    if (measureDraftPoints.length === 0) {
      statusEl.textContent = getCurrentMeasureModeLabel();
      return;
    }
    if (measureDraftPoints.length === 1) {
      statusEl.textContent = getCurrentMeasureModeLabel();
      return;
    }
    const draftText = isAreaMeasureMode()
      ? formatMeasureAreaText(getDraftAreaM2())
      : formatMeasureDistanceText(getDraftDistanceM());
    statusEl.textContent = draftText;
  }

  function setMeasureButtonActive(active, modeType) {
    if (measureDistanceBtnEl) measureDistanceBtnEl.classList.toggle("is-active", !!active && modeType === "distance");
    if (measureAreaBtnEl) measureAreaBtnEl.classList.toggle("is-active", !!active && modeType === "area");
    if (measureToolsEl) measureToolsEl.classList.toggle("is-measuring", !!active);
  }

  function setMeasureMode(active, reason, modeType) {
    const next = !!active;
    const nextType = modeType || measureModeType || "distance";
    if (measureModeActive === next && (!next || measureModeType === nextType)) return;
    measureModeActive = next;
    measureModeType = next ? nextType : null;
    setMeasureButtonActive(next, measureModeType);
    if (next) {
      updateMeasureModeBadge();
    }

    if (!next) {
      clearMeasureVisuals();
      setMeasureActionPanelVisible(false);
      if (typeof window.__bpSetDefaultStatus === "function") {
        window.__bpSetDefaultStatus();
      } else if (statusEl) {
        statusEl.textContent = "반달가슴곰 위치추적분석";
      }
      return;
    }

    if (typeof onMeasureActivated === "function") {
      onMeasureActivated();
    }
    clearMeasureVisuals();
    setMeasureActionPanelVisible(false);
    updateMeasureActionButtons();
    updateMeasureActionPanelPosition();
    if (statusEl) {
      statusEl.textContent = getCurrentMeasureModeLabel();
    }
  }

  // 우하단: 지리산 · 나침반(지도 북쪽) · 내 위치, 그 아래 측정 도구 묶음. 확대/축소는 두 손가락으로 한다.
  function mountRightBottomControls() {
    const root = document.createElement("div");
    root.className = "map-right-controls";

    const mainControlGroup = document.createElement("div");
    mainControlGroup.className = "map-ctl-group";

    function createMaskIconMarkup(iconPath, sizePx) {
      return '<span aria-hidden="true" style="display:block;width:' + sizePx + 'px;height:' + sizePx + 'px;background-color:currentColor;-webkit-mask:url(\'' + iconPath + '\') center / contain no-repeat;mask:url(\'' + iconPath + '\') center / contain no-repeat;"></span>';
    }

    function makeBtn(className, title, innerHTML, onClick) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.title = title;
      btn.setAttribute("aria-label", title);
      btn.className = "map-ctl " + className;
      btn.innerHTML = innerHTML;
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        onClick();
      });
      return btn;
    }

    const btnJiri = makeBtn(
      "map-ctl-jiri",
      "지리산으로 이동 · 회전 초기화",
      createMaskIconMarkup("css/image/icon-jirisan-view.png?v=2", 26),
      function () {
        if (typeof onStopFollowing === "function") onStopFollowing();
        view.cancelAnimations();
        view.setRotation(0);
        if (!moveToOfflineInitialView({ duration: 450 })) {
          if (!fitMbtilesCoverage()) {
            view.fit(extentMap, { padding: [20, 20, 20, 20], maxZoom: 14, duration: 450 });
          }
        }
      }
    );

    // 바늘은 지도의 북쪽을 가리키고, 누르면 지도를 정북으로 되돌린다.
    const compassBtn = makeBtn(
      "map-ctl-compass",
      "북쪽을 위로",
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 16 12H8l4-9.5Z" fill="#e53935"/><path d="M8 12h8l-4 9.5L8 12Z" fill="#9aa5b1"/></svg>',
      function () {
        if (typeof onCompassClick === "function") {
          onCompassClick();
          return;
        }
        view.cancelAnimations();
        view.animate({ rotation: 0, duration: 300 });
      }
    );
    const compassNeedleEl = compassBtn.querySelector("svg");
    function syncCompassNeedle() {
      compassNeedleEl.style.transform = "rotate(" + view.getRotation() + "rad)";
    }
    view.on("change:rotation", syncCompassNeedle);
    syncCompassNeedle();

    // 꺼짐(회색 조준) → 따라가기(파란 조준) → 방향 모드(파란 화살표). data-mode는 client-ol.js가 바꾼다.
    const locateBtnEl = makeBtn(
      "map-ctl-locate",
      "내 위치 켜기",
      '<svg class="map-ctl-locate__target" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4" stroke="currentColor" stroke-width="2"/></svg>' +
        '<svg class="map-ctl-locate__arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5 19.5 21 12 16.8 4.5 21 12 2.5Z"/></svg>',
      function () {
        if (typeof onToggleMyLocation === "function") {
          onToggleMyLocation();
        }
      }
    );
    locateBtnEl.dataset.mode = "off";

    if (typeof onLocateButtonReady === "function") {
      onLocateButtonReady(locateBtnEl);
    }

    // 측정 도구: 도구 버튼을 누르면 거리·면적이 펼쳐지고, 접으면 진행 중인 측정도 끝낸다.
    measureToolsEl = document.createElement("div");
    measureToolsEl.className = "map-ctl-group map-ctl-tools";

    const measureItemsEl = document.createElement("div");
    measureItemsEl.className = "map-ctl-tools__items";
    measureItemsEl.id = "map-measure-tools";
    measureItemsEl.hidden = true;

    const toolsToggleBtn = makeBtn(
      "map-ctl-tools__toggle",
      "측정 도구",
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m3.5 16.5 13-13 4 4-13 13z"/><path d="m7.5 12.5 2 2m1-5 2 2m1-5 2 2"/></svg><span>도구</span>',
      function () {
        const open = measureItemsEl.hidden;
        measureItemsEl.hidden = !open;
        toolsToggleBtn.setAttribute("aria-expanded", String(open));
        measureToolsEl.classList.toggle("is-open", open);
        if (!open && measureModeActive) setMeasureMode(false, "toggle");
      }
    );
    toolsToggleBtn.setAttribute("aria-expanded", "false");
    toolsToggleBtn.setAttribute("aria-controls", measureItemsEl.id);

    measureDistanceBtnEl = makeBtn(
      "map-ctl-measure",
      "거리 측정",
      createMaskIconMarkup("css/svg/control-ruler.svg", 18) + "<span>거리</span>",
      function () {
        const nextActive = !(measureModeActive && measureModeType === "distance");
        setMeasureMode(nextActive, "toggle", "distance");
      }
    );

    measureAreaBtnEl = makeBtn(
      "map-ctl-measure",
      "면적 측정",
      createMaskIconMarkup("css/svg/control-area.svg", 18) + "<span>면적</span>",
      function () {
        const nextActive = !(measureModeActive && measureModeType === "area");
        setMeasureMode(nextActive, "toggle", "area");
      }
    );

    measureActionPanelEl = document.createElement("div");
    measureActionPanelEl.style.display = "none";
    measureActionPanelEl.style.width = "fit-content";
    measureActionPanelEl.style.maxWidth = "78%";
    measureActionPanelEl.style.alignSelf = "flex-start";
    measureActionPanelEl.style.zIndex = "10000";
    measureActionPanelEl.style.flexDirection = "column";
    measureActionPanelEl.style.gap = "4px";
    measureActionPanelEl.style.marginBottom = "-2px";
    measureActionPanelEl.style.padding = "6px";
    measureActionPanelEl.style.border = "1px solid rgba(185,28,28,0.35)";
    measureActionPanelEl.style.borderRadius = "10px";
    measureActionPanelEl.style.background = "rgba(250,204,21,0.14)";
    measureActionPanelEl.style.boxShadow = "0 4px 10px rgba(0,0,0,0.08)";
    measureActionPanelEl.style.pointerEvents = "auto";

    measureModeBadgeEl = document.createElement("span");
    measureModeBadgeEl.style.display = "inline-flex";
    measureModeBadgeEl.style.width = "auto";
    measureModeBadgeEl.style.alignItems = "center";
    measureModeBadgeEl.style.justifyContent = "center";
    measureModeBadgeEl.style.height = "26px";
    measureModeBadgeEl.style.padding = "0 8px";
    measureModeBadgeEl.style.border = "1px solid rgba(220,38,38,0.68)";
    measureModeBadgeEl.style.borderRadius = "8px";
    measureModeBadgeEl.style.font = "800 14px/1 sans-serif";
    measureModeBadgeEl.style.letterSpacing = "0.01em";
    measureModeBadgeEl.style.textShadow = "0 1px 0 rgba(255,255,255,0.28)";
    measureModeBadgeEl.style.whiteSpace = "nowrap";
    measureModeBadgeEl.style.boxShadow = "0 1px 4px rgba(15,23,42,0.12)";
    updateMeasureModeBadge();

    function makeActionBtn(text, onClick) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = text;
      btn.style.flex = "0 0 auto";
      btn.style.minWidth = "52px";
      btn.style.height = "31px";
      btn.style.padding = "0 9px";
      btn.style.border = "1px solid #c9c9c9";
      btn.style.borderRadius = "8px";
      btn.style.background = "#ffffff";
      btn.style.color = "#1f2937";
      btn.style.font = "600 12px/1 sans-serif";
      btn.style.boxShadow = "0 2px 6px rgba(0,0,0,0.1)";
      btn.style.transition = "background-color 120ms ease, color 120ms ease, border-color 120ms ease";
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        onClick();
      });
      return btn;
    }

    measureCompleteBtnEl = makeActionBtn("완료", function () {
      completeDraftMeasure();
    });
    measureUndoBtnEl = makeActionBtn("되돌리기", function () {
      undoLastDraftPoint();
    });

    const measureActionRowEl = document.createElement("div");
    measureActionRowEl.style.display = "flex";
    measureActionRowEl.style.gap = "6px";
    measureActionRowEl.style.width = "auto";

    measureActionPanelEl.appendChild(measureModeBadgeEl);
    measureActionRowEl.appendChild(measureCompleteBtnEl);
    measureActionRowEl.appendChild(measureUndoBtnEl);
    measureActionPanelEl.appendChild(measureActionRowEl);
    updateMeasureActionButtons();

    mainControlGroup.appendChild(btnJiri);
    mainControlGroup.appendChild(compassBtn);
    mainControlGroup.appendChild(locateBtnEl);

    measureItemsEl.appendChild(measureDistanceBtnEl);
    measureItemsEl.appendChild(measureAreaBtnEl);
    measureToolsEl.appendChild(measureItemsEl);
    measureToolsEl.appendChild(toolsToggleBtn);

    root.appendChild(mainControlGroup);
    root.appendChild(measureToolsEl);

    syncMeasureActionPanelContainer();

    root.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    root.addEventListener("touchstart", function (e) { e.stopPropagation(); }, { passive: true });
    root.addEventListener("wheel", function (e) { e.stopPropagation(); }, { passive: true });

    const measureLayoutMq = window.matchMedia("(min-width: 900px) and (orientation: landscape)");
    const onMeasureLayoutChange = function () {
      syncMeasureActionPanelContainer();
    };
    if (typeof measureLayoutMq.addEventListener === "function") {
      measureLayoutMq.addEventListener("change", onMeasureLayoutChange);
    } else if (typeof measureLayoutMq.addListener === "function") {
      measureLayoutMq.addListener(onMeasureLayoutChange);
    }
    window.addEventListener("resize", onMeasureLayoutChange);
    window.addEventListener("bearpoint:mobile-dock-layout", onMeasureLayoutChange);

    mapEl.appendChild(root);
  }

  // 지도 유형 패널: 네이버 지도처럼 미리보기 타일을 눌러 배경지도를 고르고, 겹쳐 보기는 스위치로 켠다.
  function mountLayerSwitcher() {
    const BASES = [
      { type: "osm", label: "국문", group: "online" },
      { type: "english", label: "영문", group: "online", needsKey: true },
      { type: "large", label: "큰 문자", group: "online", needsKey: true },
      { type: "satellite", label: "위성", group: "online", needsKey: true },
      { type: "mbtiles", label: "지리산", group: "offline" }
    ];

    const root = document.createElement("div");
    root.className = "map-layer-switcher";

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.id = "btn-map-layers";
    toggleBtn.className = "map-ctl";
    toggleBtn.title = "지도 유형";
    toggleBtn.setAttribute("aria-label", "지도 유형");
    toggleBtn.setAttribute("aria-controls", "map-layer-options");
    toggleBtn.setAttribute("aria-expanded", "false");
    toggleBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 8.5l10 5.5 10-5.5L12 3Zm-7.6 9.3L2 13.6 12 19l10-5.4-2.4-1.3L12 16.4l-7.6-4.1Z"/></svg>';

    function tileMarkup(base) {
      const disabled = base.needsKey && !ngiiApiKey;
      return '<button type="button" class="map-layer-tile" data-base="' + base.type + '"' +
        (disabled ? ' disabled title="NGII API 키가 필요합니다"' : "") + ' aria-pressed="false">' +
        '<span class="map-layer-thumb map-layer-thumb--' + base.type + '" aria-hidden="true" style="background-image:url(assets/map-previews/' + base.type + '.webp?v=3)">' +
        "</span>" +
        '<span class="map-layer-tile__label">' + base.label + "</span></button>";
    }
    function tilesOf(group) {
      return BASES.filter(function (base) { return base.group === group; }).map(tileMarkup).join("");
    }

    const panel = document.createElement("div");
    panel.id = "map-layer-options";
    panel.className = "map-layer-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "지도 유형");
    panel.hidden = true;
    panel.innerHTML =
      '<div class="map-layer-panel__head"><strong>지도 유형</strong>' +
        '<button type="button" class="map-layer-panel__close" aria-label="닫기">×</button></div>' +
      '<p class="map-layer-panel__title">온라인<small>인터넷 필요</small></p>' +
      '<div class="map-layer-grid">' + tilesOf("online") + "</div>" +
      '<p class="map-layer-panel__title">오프라인<small>기기에 저장된 지도</small></p>' +
      '<div class="map-layer-grid">' + tilesOf("offline") + "</div>" +
      '<p class="map-layer-panel__title">겹쳐 보기</p>' +
      '<label class="map-layer-switch"><span>음영기복도<small>인터넷 필요</small></span>' +
        '<input type="checkbox" role="switch" id="map-layer-hillshade"></label>' +
      (ngiiApiKey ? "" : '<p class="map-layer-panel__note">NGII API 키가 없어 온라인 지도는 사용할 수 없습니다.</p>');

    const hillshadeInput = panel.querySelector("#map-layer-hillshade");
    hillshadeInput.checked = !!layers.hillshadeOverlay.getVisible();
    hillshadeInput.addEventListener("change", function () {
      layers.hillshadeOverlay.setVisible(hillshadeInput.checked);
      syncHillshadeByZoom();
      if (statusEl) {
        statusEl.textContent = hillshadeInput.checked ? "🗻 음영기복도 켜짐(인터넷 필요)" : "🗻 음영기복도 꺼짐";
      }
    });

    // setBaseLayer가 키 부족 등으로 다른 지도로 바꿀 수 있으므로 실제 선택을 다시 그린다.
    function paintSelection() {
      panel.querySelectorAll("[data-base]").forEach(function (tile) {
        const on = tile.dataset.base === currentBaseLayerType;
        tile.classList.toggle("is-on", on);
        tile.setAttribute("aria-pressed", String(on));
      });
    }
    panel.addEventListener("click", function (e) {
      const tile = e.target.closest("[data-base]");
      if (!tile || tile.disabled) return;
      setBaseLayer(tile.dataset.base);
      paintSelection();
    });
    paintSelection();

    function setOpen(open) {
      panel.hidden = !open;
      toggleBtn.setAttribute("aria-expanded", String(open));
    }
    toggleBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      setOpen(panel.hidden);
    });
    panel.querySelector(".map-layer-panel__close").addEventListener("click", function () { setOpen(false); });
    document.addEventListener("pointerdown", function (e) {
      if (!panel.hidden && !root.contains(e.target)) setOpen(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !panel.hidden) setOpen(false);
    });

    root.appendChild(toggleBtn);
    root.appendChild(panel);
    mapEl.appendChild(root);
  }

  function bindAutoDeactivateOnMenu() {
    document.addEventListener("click", function (event) {
      if (!measureModeActive) return;
      const target = event && event.target ? event.target : null;
      if (!target) return;
      if (measureDistanceBtnEl && measureDistanceBtnEl.contains(target)) return;
      if (measureAreaBtnEl && measureAreaBtnEl.contains(target)) return;

      const shouldDeactivate = !!target.closest(
        "#btn-obs-add-inline, #btn-analysis, #btn-delete-selected, .obs-action-btn, #btn-panel-toggle"
      );
      if (shouldDeactivate) {
        setMeasureMode(false, "menu");
      }
    });
  }

  function initialize() {
    applyViewZoomBounds(currentBaseLayerType);
    view.on("change:resolution", syncHillshadeByZoom);
    syncHillshadeByZoom();
    mountLayerSwitcher();
    mountRightBottomControls();
    bindAutoDeactivateOnMenu();
  }

  return {
    initialize,
    consumeMapClick: handleMeasureMapClick,
    isMeasureModeActive: function () { return measureModeActive; },
    deactivateMeasure: function (reason) { setMeasureMode(false, reason || "menu"); },
    moveToOfflineInitialView,
    fitMbtilesCoverage
  };
};
