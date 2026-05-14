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
    const ONLINE_TYPES = ["osm", "english", "large", "satellite", "topo"];
    if (nextType !== "mbtiles" && !ONLINE_TYPES.includes(nextType)) {
      nextType = "mbtiles";
    }

    if (nextType !== "mbtiles" && nextType !== "topo" && !ngiiApiKey) {
      if (statusEl) statusEl.textContent = "🟠 NGII API 키가 없어 오프라인 지도로 전환합니다";
      nextType = "mbtiles";
    }

    if (nextType === currentBaseLayerType) return;

    applyViewZoomBounds(nextType);

    layers.osmBase.setVisible(nextType === "osm");
    layers.englishBase.setVisible(nextType === "english");
    layers.largeBase.setVisible(nextType === "large");
    layers.satelliteBase.setVisible(nextType === "satellite");
    layers.topoBase.setVisible(nextType === "topo");
    layers.mbtilesLayer.setVisible(nextType === "mbtiles");
    if (nextType !== "topo") {
      layers.hillshadeOverlay.setVisible(false);
    }

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
        satellite: "🛰️ 위성지도",
        topo: "🌐 OpenTopoMap"
      };
      statusEl.textContent = labels[nextType] || "🌐 온라인 지도 사용 중";
    }

    currentBaseLayerType = nextType;
  }

  function syncHillshadeByZoom() {
    const zoom = view.getZoom();
    if (typeof zoom !== "number") return;
    layers.hillshadeOverlay.setOpacity(zoom >= hillshadeSafeMaxZoom ? 0 : hillshadeBaseOpacity);
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
    return isAreaMeasureMode() ? "면적 측정" : "거리 측정";
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
        statusEl.textContent = "📏 " + getCurrentMeasureModeLabel() + ": 점을 추가하고 완료를 누르세요.";
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
      statusEl.textContent = "✅ " + measureText + " (X로 삭제, 새 점으로 다음 측정 시작)";
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
        statusEl.textContent = "📏 " + getCurrentMeasureModeLabel() + ": 중간점을 계속 추가하고 완료를 누르세요.";
      } else {
        const draftText = isAreaMeasureMode()
          ? formatMeasureAreaText(getDraftAreaM2())
          : formatMeasureDistanceText(getDraftDistanceM());
        statusEl.textContent = "📏 " + draftText + " (점 추가/되돌리기/완료 가능)";
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
      statusEl.textContent = "📏 " + getCurrentMeasureModeLabel() + ": 시작점을 누르세요.";
      return;
    }
    if (measureDraftPoints.length === 1) {
      statusEl.textContent = "📏 " + getCurrentMeasureModeLabel() + ": 중간점을 계속 추가하고 완료를 누르세요.";
      return;
    }
    const draftText = isAreaMeasureMode()
      ? formatMeasureAreaText(getDraftAreaM2())
      : formatMeasureDistanceText(getDraftDistanceM());
    statusEl.textContent = "📏 " + draftText + " (점 추가/되돌리기/완료 가능)";
  }

  function setMeasureButtonActive(active, modeType) {
    function applyButtonState(btn, on) {
      if (!btn) return;
      if (on) {
        btn.style.background = "#16a34a";
        btn.style.color = "#ffffff";
      } else {
        btn.style.background = "#ffffff";
        btn.style.color = "#2f2f2f";
      }
    }

    applyButtonState(measureDistanceBtnEl, !!active && modeType === "distance");
    applyButtonState(measureAreaBtnEl, !!active && modeType === "area");
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
      if (reason === "menu" && statusEl) {
        statusEl.textContent = "ℹ️ 측정을 종료했습니다.";
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
      statusEl.textContent = "📏 " + getCurrentMeasureModeLabel() + ": 중간점을 여러 개 추가한 뒤 완료를 누르세요.";
    }
  }

  function mountRightBottomControls() {
    const root = document.createElement("div");
    root.style.position = "absolute";
    root.style.right = "calc(8px + var(--safe-right))";
    root.style.bottom = "calc(20px + var(--safe-bottom))";
    root.style.zIndex = "1400";
    root.style.display = "flex";
    root.style.flexDirection = "column";
    root.style.gap = "0px";

    const mainControlGroup = document.createElement("div");
    mainControlGroup.style.display = "flex";
    mainControlGroup.style.flexDirection = "column";
    mainControlGroup.style.gap = "6px";

    const measureControlGroup = document.createElement("div");
    measureControlGroup.style.display = "flex";
    measureControlGroup.style.flexDirection = "column";
    measureControlGroup.style.gap = "6px";
    measureControlGroup.style.marginTop = "25px";

    function createMaskIconMarkup(iconPath, sizePx) {
      return '<span aria-hidden="true" style="display:block;width:' + sizePx + 'px;height:' + sizePx + 'px;background-color:currentColor;-webkit-mask:url(\'' + iconPath + '\') center / contain no-repeat;mask:url(\'' + iconPath + '\') center / contain no-repeat;"></span>';
    }

    function createImageIconMarkup(iconPath, widthPx, heightPx) {
      return '<img src="' + iconPath + '" alt="" aria-hidden="true" style="display:block;width:' + widthPx + 'px;height:' + heightPx + 'px;" />';
    }

    function makeBtn(className, title, innerHTML, onClick) {
      const btn = document.createElement("a");
      btn.href = "#";
      btn.title = title;
      btn.className = className;
      btn.style.width = "30px";
      btn.style.height = "30px";
      btn.style.display = "flex";
      btn.style.alignItems = "center";
      btn.style.justifyContent = "center";
      btn.style.border = "1px solid #c9c9c9";
      btn.style.borderRadius = "4px";
      btn.style.background = "#fff";
      btn.style.color = "#2f2f2f";
      btn.style.textDecoration = "none";
      btn.style.boxShadow = "0 2px 8px rgba(0,0,0,0.16)";
      btn.innerHTML = innerHTML;
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        onClick();
      });
      return btn;
    }

    const btnJiri = makeBtn(
      "leaflet-control-jiri-btn",
      "지리산으로 이동",
      createMaskIconMarkup("css/svg/control-jiri.svg", 18),
      function () {
        if (!moveToOfflineInitialView({ duration: 450 })) {
          if (!fitMbtilesCoverage()) {
            view.fit(extentMap, { padding: [20, 20, 20, 20], maxZoom: 14, duration: 450 });
          }
        }
      }
    );

    const locateBtnEl = makeBtn(
      "leaflet-control-locate-btn",
      "내 위치 토글",
      createMaskIconMarkup("css/svg/control-locate.svg", 18),
      function () {
        if (typeof onToggleMyLocation === "function") {
          onToggleMyLocation();
        }
      }
    );

    if (typeof onLocateButtonReady === "function") {
      onLocateButtonReady(locateBtnEl);
    }

    const btnZoomIn = makeBtn("ol-zoom-in-btn", "확대", "+", function () {
      const current = view.getZoom() || 0;
      const next = Math.min(getActiveMaxZoomForBaseLayer(currentBaseLayerType), current + 1);
      view.animate({ zoom: next, duration: 180 });
    });
    btnZoomIn.style.fontSize = "19px";
    btnZoomIn.style.fontWeight = "700";

    const btnZoomOut = makeBtn("ol-zoom-out-btn", "축소", "-", function () {
      const current = view.getZoom() || 0;
      const next = Math.max(mbtilesMinZoom, current - 1);
      view.animate({ zoom: next, duration: 180 });
    });
    btnZoomOut.style.fontSize = "20px";
    btnZoomOut.style.fontWeight = "700";

    measureDistanceBtnEl = makeBtn(
      "ol-measure-btn",
      "거리 측정",
      createMaskIconMarkup("css/svg/control-ruler.svg", 16),
      function () {
        const nextActive = !(measureModeActive && measureModeType === "distance");
        setMeasureMode(nextActive, "toggle", "distance");
      }
    );
    measureDistanceBtnEl.style.fontSize = "14px";
    measureDistanceBtnEl.style.fontWeight = "700";

    measureAreaBtnEl = makeBtn(
      "ol-measure-area-btn",
      "면적 측정",
      createMaskIconMarkup("css/svg/control-area.svg", 16),
      function () {
        const nextActive = !(measureModeActive && measureModeType === "area");
        setMeasureMode(nextActive, "toggle", "area");
      }
    );
    measureAreaBtnEl.style.fontSize = "14px";
    measureAreaBtnEl.style.fontWeight = "700";

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
    mainControlGroup.appendChild(locateBtnEl);
    mainControlGroup.appendChild(btnZoomIn);
    mainControlGroup.appendChild(btnZoomOut);

    measureControlGroup.appendChild(measureDistanceBtnEl);
    measureControlGroup.appendChild(measureAreaBtnEl);

    root.appendChild(mainControlGroup);
    root.appendChild(measureControlGroup);

    const panelStackEl = document.querySelector(".panel-stack.panel-bottom-left");
    const panelTabsEl = document.querySelector(".panel-tabs.panel-tabs-floating");
    if (panelStackEl && panelTabsEl && panelTabsEl.parentElement === panelStackEl) {
      panelStackEl.insertBefore(measureActionPanelEl, panelTabsEl);
    } else if (panelStackEl) {
      panelStackEl.insertBefore(measureActionPanelEl, panelStackEl.firstChild || null);
    } else {
      mapEl.appendChild(measureActionPanelEl);
    }

    root.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    root.addEventListener("touchstart", function (e) { e.stopPropagation(); }, { passive: true });
    root.addEventListener("wheel", function (e) { e.stopPropagation(); }, { passive: true });

    mapEl.appendChild(root);
  }

  function mountLayerSwitcher() {
    function createImageIconMarkup(iconPath, widthPx, heightPx) {
      return '<img src="' + iconPath + '" alt="" aria-hidden="true" style="display:block;width:' + widthPx + 'px;height:' + heightPx + 'px;" />';
    }

    const root = document.createElement("div");
    root.style.position = "absolute";
    root.style.top = "calc(12px + var(--safe-top))";
    root.style.right = "calc(12px + var(--safe-right))";
    root.style.zIndex = "9990";

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.title = "레이어 선택";
    toggleBtn.setAttribute("aria-label", "레이어 선택");
    toggleBtn.setAttribute("aria-expanded", "false");
    toggleBtn.style.width = "42px";
    toggleBtn.style.height = "42px";
    toggleBtn.style.border = "1px solid #c9c9c9";
    toggleBtn.style.borderRadius = "6px";
    toggleBtn.style.background = "#ffffff";
    toggleBtn.style.boxShadow = "0 2px 8px rgba(0,0,0,0.16)";
    toggleBtn.style.cursor = "pointer";
    toggleBtn.style.display = "flex";
    toggleBtn.style.alignItems = "center";
    toggleBtn.style.justifyContent = "center";
    toggleBtn.innerHTML = createImageIconMarkup("css/svg/layer-stack.svg", 22, 22);

    const panel = document.createElement("div");
    panel.style.position = "absolute";
    panel.style.top = "46px";
    panel.style.right = "0";
    panel.style.background = "#f6f6f6";
    panel.style.border = "1px solid #8e8e8e";
    panel.style.borderRadius = "4px";
    panel.style.padding = "6px 10px";
    panel.style.fontSize = "13px";
    panel.style.lineHeight = "1.5";
    panel.style.width = "min(150px, calc(100vw - 24px - var(--safe-right)))";
    panel.style.minWidth = "150px";
    panel.style.maxWidth = "calc(100vw - 24px - var(--safe-right))";
    panel.style.overflow = "hidden";
    panel.style.opacity = "0";
    panel.style.visibility = "hidden";
    panel.style.pointerEvents = "none";
    panel.style.transform = "translateY(-8px) scale(0.98)";
    panel.style.transformOrigin = "top right";
    panel.style.maxHeight = "0";
    panel.style.boxShadow = "0 10px 24px rgba(15, 23, 42, 0.16)";
    panel.style.transition = "opacity 180ms ease, transform 180ms ease, max-height 220ms ease";
    panel.dataset.open = "false";

    function tuneLayerOptionRow(rowEl, labelEl) {
      rowEl.style.width = "100%";
      rowEl.style.flexWrap = "nowrap";
      rowEl.style.minWidth = "0";
      labelEl.style.whiteSpace = "nowrap";
      labelEl.style.display = "block";
      labelEl.style.flex = "1 1 auto";
      labelEl.style.minWidth = "0";
      labelEl.style.overflow = "hidden";
      labelEl.style.textOverflow = "ellipsis";
    }

    function createSectionTitle(text, marginTop) {
      const title = document.createElement("div");
      title.textContent = text;
      title.style.fontSize = "11px";
      title.style.fontWeight = "700";
      title.style.letterSpacing = "0.02em";
      title.style.color = "#666";
      title.style.marginTop = marginTop;
      title.style.marginBottom = "4px";
      return title;
    }

    const onlineTitle = createSectionTitle("온라인", "0");
    const offlineTitle = createSectionTitle("오프라인", "6px");
    offlineTitle.style.paddingTop = "6px";
    offlineTitle.style.borderTop = "1px solid #c8c8c8";

    const row1 = document.createElement("div");
    row1.style.display = "flex";
    row1.style.alignItems = "center";
    row1.style.gap = "8px";
    row1.style.marginBottom = "2px";

    const radioOsm = document.createElement("input");
    radioOsm.type = "radio";
    radioOsm.name = "ol-base-layer";
    radioOsm.value = "osm";
    radioOsm.disabled = false;
    radioOsm.style.flex = "0 0 auto";

    const labelOsm = document.createElement("label");
    labelOsm.style.cursor = "pointer";
    labelOsm.textContent = "국문";
    tuneLayerOptionRow(row1, labelOsm);
    row1.appendChild(radioOsm);
    row1.appendChild(labelOsm);

    const rowEnglish = document.createElement("div");
    rowEnglish.style.display = "flex";
    rowEnglish.style.alignItems = "center";
    rowEnglish.style.gap = "8px";
    rowEnglish.style.marginBottom = "2px";

    const radioEnglish = document.createElement("input");
    radioEnglish.type = "radio";
    radioEnglish.name = "ol-base-layer";
    radioEnglish.value = "english";
    radioEnglish.disabled = !ngiiApiKey;
    radioEnglish.checked = currentBaseLayerType === "english";
    radioEnglish.style.flex = "0 0 auto";

    const labelEnglish = document.createElement("label");
    labelEnglish.style.cursor = ngiiApiKey ? "pointer" : "default";
    labelEnglish.textContent = "영문";
    tuneLayerOptionRow(rowEnglish, labelEnglish);
    rowEnglish.appendChild(radioEnglish);
    rowEnglish.appendChild(labelEnglish);

    const rowLarge = document.createElement("div");
    rowLarge.style.display = "flex";
    rowLarge.style.alignItems = "center";
    rowLarge.style.gap = "8px";
    rowLarge.style.marginBottom = "2px";

    const radioLarge = document.createElement("input");
    radioLarge.type = "radio";
    radioLarge.name = "ol-base-layer";
    radioLarge.value = "large";
    radioLarge.disabled = !ngiiApiKey;
    radioLarge.checked = currentBaseLayerType === "large";
    radioLarge.style.flex = "0 0 auto";

    const labelLarge = document.createElement("label");
    labelLarge.style.cursor = ngiiApiKey ? "pointer" : "default";
    labelLarge.textContent = "큰 문자";
    tuneLayerOptionRow(rowLarge, labelLarge);
    rowLarge.appendChild(radioLarge);
    rowLarge.appendChild(labelLarge);

    const rowSatellite = document.createElement("div");
    rowSatellite.style.display = "flex";
    rowSatellite.style.alignItems = "center";
    rowSatellite.style.gap = "8px";
    rowSatellite.style.marginBottom = "2px";

    const radioSatellite = document.createElement("input");
    radioSatellite.type = "radio";
    radioSatellite.name = "ol-base-layer";
    radioSatellite.value = "satellite";
    radioSatellite.disabled = !ngiiApiKey;
    radioSatellite.checked = currentBaseLayerType === "satellite";
    radioSatellite.style.flex = "0 0 auto";

    const labelSatellite = document.createElement("label");
    labelSatellite.style.cursor = ngiiApiKey ? "pointer" : "default";
    labelSatellite.textContent = "위성";
    tuneLayerOptionRow(rowSatellite, labelSatellite);
    rowSatellite.appendChild(radioSatellite);
    rowSatellite.appendChild(labelSatellite);

    const rowMbtiles = document.createElement("div");
    rowMbtiles.style.display = "flex";
    rowMbtiles.style.alignItems = "center";
    rowMbtiles.style.gap = "8px";
    rowMbtiles.style.marginBottom = "2px";

    const radioMbtiles = document.createElement("input");
    radioMbtiles.type = "radio";
    radioMbtiles.name = "ol-base-layer";
    radioMbtiles.value = "mbtiles";
    radioMbtiles.checked = currentBaseLayerType === "mbtiles";
    radioMbtiles.style.flex = "0 0 auto";

    const labelMbtiles = document.createElement("label");
    labelMbtiles.style.cursor = "pointer";
    labelMbtiles.textContent = "국문(지리산 일대)";
    tuneLayerOptionRow(rowMbtiles, labelMbtiles);
    rowMbtiles.appendChild(radioMbtiles);
    rowMbtiles.appendChild(labelMbtiles);

    radioOsm.checked = currentBaseLayerType === "osm";

    function syncBaseByRadio() {
      if (radioMbtiles.checked) return setBaseLayer("mbtiles");
      if (radioSatellite.checked) return setBaseLayer("satellite");
      if (radioEnglish.checked) return setBaseLayer("english");
      if (radioLarge.checked) return setBaseLayer("large");
      setBaseLayer("osm");
    }

    radioOsm.addEventListener("change", syncBaseByRadio);
    radioEnglish.addEventListener("change", syncBaseByRadio);
    radioLarge.addEventListener("change", syncBaseByRadio);
    radioSatellite.addEventListener("change", syncBaseByRadio);
    radioMbtiles.addEventListener("change", syncBaseByRadio);
    labelOsm.addEventListener("click", function () { radioOsm.checked = true; syncBaseByRadio(); });
    labelEnglish.addEventListener("click", function () { if (!radioEnglish.disabled) { radioEnglish.checked = true; syncBaseByRadio(); } });
    labelLarge.addEventListener("click", function () { if (!radioLarge.disabled) { radioLarge.checked = true; syncBaseByRadio(); } });
    labelSatellite.addEventListener("click", function () { if (!radioSatellite.disabled) { radioSatellite.checked = true; syncBaseByRadio(); } });
    labelMbtiles.addEventListener("click", function () { radioMbtiles.checked = true; syncBaseByRadio(); });

    const row2 = document.createElement("label");
    row2.style.display = "flex";
    row2.style.alignItems = "center";
    row2.style.gap = "8px";
    row2.style.marginTop = "4px";
    row2.style.cursor = "pointer";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = false;
    chk.disabled = true;
    chk.addEventListener("change", function () {
      layers.hillshadeOverlay.setVisible(chk.checked);
    });

    let hideTimer = null;
    let isPinned = false;
    const preferHover = !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);

    function isPanelOpen() {
      return panel.dataset.open === "true";
    }

    function openPanel() {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      panel.dataset.open = "true";
      panel.style.visibility = "visible";
      panel.style.pointerEvents = "auto";
      panel.style.maxHeight = panel.scrollHeight + 20 + "px";
      window.requestAnimationFrame(function () {
        panel.style.opacity = "1";
        panel.style.transform = "translateY(0) scale(1)";
      });
      toggleBtn.setAttribute("aria-expanded", "true");
    }

    function closePanel(delayMs, forceClose) {
      if (!forceClose && isPinned) return;
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        panel.dataset.open = "false";
        panel.style.opacity = "0";
        panel.style.transform = "translateY(-8px) scale(0.98)";
        panel.style.maxHeight = "0";
        panel.style.pointerEvents = "none";
        window.setTimeout(function () {
          if (isPanelOpen()) return;
          panel.style.visibility = "hidden";
        }, 180);
        toggleBtn.setAttribute("aria-expanded", "false");
      }, delayMs);
    }

    root.addEventListener("mouseenter", function () {
      if (!preferHover || isPinned) return;
      openPanel();
    });
    root.addEventListener("mouseleave", function () {
      if (!preferHover || isPinned) return;
      closePanel(140, false);
    });

    toggleBtn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (isPanelOpen() && isPinned) {
        isPinned = false;
        closePanel(0, true);
      } else {
        isPinned = true;
        openPanel();
      }
    });

    document.addEventListener("pointerdown", function (e) {
      if (!root.contains(e.target)) {
        isPinned = false;
        closePanel(0, true);
      }
    });

    root.appendChild(toggleBtn);
    panel.appendChild(onlineTitle);
    panel.appendChild(row1);
    panel.appendChild(rowEnglish);
    panel.appendChild(rowLarge);
    panel.appendChild(rowSatellite);
    panel.appendChild(offlineTitle);
    panel.appendChild(rowMbtiles);
    panel.appendChild(row2);
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
        "#btn-obs-add-inline, #btn-obs-list, #btn-analysis, #btn-delete-selected, #btn-obs-list-close, #btn-obs-list-peek, .obs-action-btn, #btn-panel-toggle"
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