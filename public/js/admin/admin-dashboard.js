let dashboardInitialized = false;
let realtimeMarkerAnimationFrameId = 0;
let realtimeMarkerAnimationRunning = false;
let realtimeMarkerAnimationStartTs = 0;
let realtimeBearMarkerPulse = 0;
let realtimeBearMarkerScale = 1;

const JIRISAN_CENTER_LONLAT = [127.72, 35.33];
const REALTIME_BEAR_PULSE_COLOR = "rgba(52, 199, 89, 0.92)";
const REALTIME_BEAR_LABEL_COLOR = "rgba(22, 163, 74, 0.94)";

function stopRealtimeMarkerAnimation(mapLayer) {
  realtimeMarkerAnimationRunning = false;
  realtimeMarkerAnimationStartTs = 0;
  realtimeBearMarkerPulse = 0;
  realtimeBearMarkerScale = 1;

  if (realtimeMarkerAnimationFrameId) {
    window.cancelAnimationFrame(realtimeMarkerAnimationFrameId);
    realtimeMarkerAnimationFrameId = 0;
  }

  if (mapLayer) {
    mapLayer.changed();
  }
}

function animateRealtimeMarkers(timestamp, mapLayer) {
  if (!realtimeMarkerAnimationRunning) {
    return;
  }

  if (!realtimeMarkerAnimationStartTs) {
    realtimeMarkerAnimationStartTs = timestamp;
  }

  const elapsedSec = (timestamp - realtimeMarkerAnimationStartTs) / 1000;
  realtimeBearMarkerPulse = (Math.sin(elapsedSec * Math.PI * 1.9) + 1) / 2;
  realtimeBearMarkerScale = 1 + Math.sin(elapsedSec * Math.PI * 2.2) * 0.035;

  if (mapLayer) {
    mapLayer.changed();
  }

  realtimeMarkerAnimationFrameId = window.requestAnimationFrame(function (nextTimestamp) {
    animateRealtimeMarkers(nextTimestamp, mapLayer);
  });
}

function startRealtimeMarkerAnimation(mapLayer) {
  if (realtimeMarkerAnimationRunning) {
    return;
  }

  realtimeMarkerAnimationRunning = true;
  realtimeMarkerAnimationFrameId = window.requestAnimationFrame(function (timestamp) {
    animateRealtimeMarkers(timestamp, mapLayer);
  });
}

function normalizeRealtimeItem(rawItem) {
  const item = rawItem || {};
  const lat = Number(item.lat);
  const lng = Number(item.lng != null ? item.lng : item.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }

  return {
    id: item.id != null ? String(item.id) : "",
    bearCode: String(item.bear_code || item.bearCode || "-").trim() || "-",
    owner: String(item.owner || "미지정").trim() || "미지정",
    place: String(item.place || "미지정").trim() || "미지정",
    uploadedAt: String(item.uploaded_at || item.timestamp || "-").trim() || "-",
    lat,
    lng,
  };
}

function createRealtimeBearStyle(item) {
  return function (styledFeature) {
    const data = styledFeature && styledFeature.get ? (styledFeature.get("bearEstimateData") || item || {}) : (item || {});
    const markerText = String(data.bearCode || data.bear_code || data.id || "-");
    const styles = [];

    styles.push(new ol.style.Style({
      image: new ol.style.Circle({
        radius: 17 + realtimeBearMarkerPulse * 8,
        fill: new ol.style.Fill({ color: `rgba(52, 199, 89, ${0.08 + realtimeBearMarkerPulse * 0.16})` }),
        stroke: new ol.style.Stroke({ color: `rgba(52, 199, 89, ${0.32 + realtimeBearMarkerPulse * 0.28})`, width: 2 })
      })
    }));

    styles.push(new ol.style.Style({
      image: new ol.style.Circle({
        radius: 12,
        fill: new ol.style.Fill({ color: "rgba(255,255,255,0.18)" }),
        stroke: new ol.style.Stroke({ color: REALTIME_BEAR_PULSE_COLOR, width: 2.5 })
      })
    }));

    styles.push(new ol.style.Style({
      image: new ol.style.Icon({
        src: "/css/svg/bear_marker_point.svg",
        anchor: [0.5, 1],
        width: 34,
        height: 34,
      }),
      text: new ol.style.Text({
        text: markerText,
        offsetY: 14,
        font: "600 11px sans-serif",
        fill: new ol.style.Fill({ color: "#ffffff" }),
        backgroundFill: new ol.style.Fill({ color: REALTIME_BEAR_LABEL_COLOR }),
        padding: [2, 5, 2, 5]
      })
    }));

    return styles;
  };
}

async function fetchRealtimeItems() {
  const response = await fetch("/api/realtime/bear-estimates?limit=200", {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result || result.ok === false) {
    throw new Error(result && result.message ? result.message : "실시간 목록 조회에 실패했습니다.");
  }

  return Array.isArray(result.items)
    ? result.items.map(normalizeRealtimeItem).filter(Boolean)
    : [];
}

function renderRecentRegistrationList(items, registrationListEl, onRowClick) {
  if (!registrationListEl) return;

  const topTen = items.slice(0, 10);

  if (!topTen.length) {
    registrationListEl.innerHTML = '<li><span>최근 등록 데이터 없음</span><strong>-</strong></li>';
    return;
  }

  registrationListEl.innerHTML = topTen
    .map(function (item, index) {
      return [
        '<li data-row-index="' + String(index) + '" tabindex="0" role="button" aria-label="' + item.bearCode + ' 위치로 이동">',
        '  <span>' + escapeHtml(item.bearCode) + ' 등록</span>',
        '  <strong>' + escapeHtml(item.uploadedAt) + '</strong>',
        '</li>',
      ].join("\n");
    })
    .join("\n");

  registrationListEl.querySelectorAll("li[data-row-index]").forEach(function (rowEl) {
    const index = Number(rowEl.getAttribute("data-row-index"));
    if (!Number.isFinite(index) || !topTen[index]) return;

    const item = topTen[index];
    rowEl.addEventListener("click", function () {
      onRowClick(item);
    });
    rowEl.addEventListener("keydown", function (event) {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onRowClick(item);
      }
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function initializeDashboardRealtimeMap() {
  if (dashboardInitialized) return;

  const mapContainer = document.getElementById("adminRealtimeMap");
  const mapEmptyEl = document.getElementById("adminRealtimeMapEmpty");
  const refreshButton = document.getElementById("btnDashboardRealtimeRefresh");
  const registrationListEl = document.getElementById("recentRegistrationList");

  if (!mapContainer || !refreshButton || !registrationListEl || !window.ol) {
    return;
  }

  const markerSource = new ol.source.Vector();
  const markerLayer = new ol.layer.Vector({ source: markerSource });

  const map = new ol.Map({
    target: mapContainer,
    layers: [
      new ol.layer.Tile({ source: new ol.source.OSM() }),
      markerLayer,
    ],
    view: new ol.View({
      center: ol.proj.fromLonLat(JIRISAN_CENTER_LONLAT),
      zoom: 8.7,
      minZoom: 7,
      maxZoom: 18,
    }),
    controls: ol.control.defaults.defaults({
      attribution: false,
      rotate: false,
    }),
  });

  async function loadRealtimeMapData() {
    refreshButton.disabled = true;

    try {
      const items = await fetchRealtimeItems();

      markerSource.clear();

      items.forEach(function (item) {
        const feature = new ol.Feature({
          geometry: new ol.geom.Point(ol.proj.fromLonLat([item.lng, item.lat])),
          item,
        });
        feature.set("bearEstimateData", item);
        feature.set("isRealtimeMarker", true);
        feature.setStyle(createRealtimeBearStyle(item));
        markerSource.addFeature(feature);
      });

      if (mapEmptyEl) {
        mapEmptyEl.hidden = items.length > 0;
      }

      if (items.length > 0) {
        const extent = markerSource.getExtent();
        map.getView().fit(extent, {
          padding: [180, 220, 180, 220],
          maxZoom: 9.4,
          duration: 280,
        });
      } else {
        map.getView().animate({
          center: ol.proj.fromLonLat(JIRISAN_CENTER_LONLAT),
          zoom: 8.7,
          duration: 220,
        });
      }

      renderRecentRegistrationList(items, registrationListEl, function (targetItem) {
        map.getView().animate({
          center: ol.proj.fromLonLat([targetItem.lng, targetItem.lat]),
          zoom: Math.max(map.getView().getZoom() || 9, 10),
          duration: 260,
        });
      });
    } catch (error) {
      console.error("[admin-dashboard] realtime map load failed", error);
      markerSource.clear();
      if (mapEmptyEl) {
        mapEmptyEl.hidden = false;
        mapEmptyEl.textContent = error && error.message ? error.message : "실시간 목록을 불러오지 못했습니다.";
      }
      renderRecentRegistrationList([], registrationListEl, function () {});
    } finally {
      refreshButton.disabled = false;
    }
  }

  refreshButton.addEventListener("click", function () {
    loadRealtimeMapData();
  });

  startRealtimeMarkerAnimation(markerLayer);
  window.addEventListener("beforeunload", function () {
    stopRealtimeMarkerAnimation(markerLayer);
  });

  loadRealtimeMapData();
  dashboardInitialized = true;
}

document.addEventListener("admin-layout:ready", initializeDashboardRealtimeMap);
document.addEventListener("DOMContentLoaded", initializeDashboardRealtimeMap);