let dashboardInitialized = false;
let realtimeMarkerAnimationFrameId = 0;
let realtimeMarkerAnimationRunning = false;
let realtimeMarkerAnimationStartTs = 0;
let realtimeBearMarkerPulse = 0;

const JIRISAN_CENTER_LONLAT = [127.72, 35.33];
const REALTIME_BEAR_PULSE_COLOR = "rgba(52, 199, 89, 0.92)";
const REALTIME_BEAR_LABEL_COLOR = "rgba(22, 163, 74, 0.94)";

function stopRealtimeMarkerAnimation(mapLayer) {
  realtimeMarkerAnimationRunning = false;
  realtimeMarkerAnimationStartTs = 0;
  realtimeBearMarkerPulse = 0;

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
    intersectionCount: item.intersections_count != null && Number.isFinite(Number(item.intersections_count))
      ? Number(item.intersections_count) : null,
    sourceObservations: Array.isArray(item.source_observations)
      ? item.source_observations
      : Array.isArray(item.payload && item.payload.source_observations) ? item.payload.source_observations : [],
    analysisOptions: item.analysis_options || (item.payload && item.payload.analysis_options) || null,
    analysisRays: Array.isArray(item.analysis_rays)
      ? item.analysis_rays
      : Array.isArray(item.payload && item.payload.analysis_rays) ? item.payload.analysis_rays : [],
    analysisIntersections: Array.isArray(item.analysis_intersections)
      ? item.analysis_intersections
      : Array.isArray(item.payload && item.payload.analysis_intersections) ? item.payload.analysis_intersections : [],
  };
}

function renderRealtimeAnalysisInfo(item, container) {
  if (!container) return;
  const options = item.analysisOptions || {};
  const distance = options.distanceLimitM == null ? NaN : Number(options.distanceLimitM);
  const declination = options.declinationDeg == null ? NaN : Number(options.declinationDeg);
  const observations = item.sourceObservations || [];
  const distanceLabel = Number.isFinite(distance) && distance > 0 ? distance.toLocaleString("ko-KR") + "m" : "기록 없음";
  const declinationLabel = Number.isFinite(declination) ? declination + "°" : "기록 없음";
  container.innerHTML = [
    '<button class="admin-analysis-close" type="button" aria-label="분석 정보 닫기">×</button>',
    '<strong>' + escapeHtml(item.bearCode) + ' 위치분석</strong>',
    '<div class="admin-analysis-conditions">거리 제한 ' + escapeHtml(distanceLabel) + ' · 편각 ' + escapeHtml(declinationLabel) + '</div>',
    observations.length
      ? '<ul>' + observations.map(function (obs, index) {
          const name = obs.place || obs.id || "관측점 " + (index + 1);
          const heading = obs.heading == null ? "" : " · " + String(obs.heading);
          const identity = obs.id ? '<div>ID: ' + escapeHtml(obs.id) + '</div>' : '';
          const coordinates = Number.isFinite(Number(obs.lat)) && Number.isFinite(Number(obs.lng))
            ? '<div>좌표: ' + escapeHtml(Number(obs.lat).toFixed(6) + ', ' + Number(obs.lng).toFixed(6)) + '</div>' : '';
          const owner = obs.owner ? '<div>등록자: ' + escapeHtml(obs.owner) + '</div>' : '';
          const createdAt = obs.createdAt ? '<div>등록: ' + escapeHtml(obs.createdAt) + '</div>' : '';
          const updatedAt = obs.updatedAt ? '<div>수정: ' + escapeHtml(obs.updatedAt) + '</div>' : '';
          const detectors = Array.isArray(obs.detectors) && obs.detectors.length
            ? '<div>감지기: ' + obs.detectors.map(function (detector) {
                return escapeHtml([detector.detectorName, detector.signalStrength].filter(Boolean).join(' · '));
              }).join(', ') + '</div>'
            : '';
          return '<li><span>' + escapeHtml(name + heading) + '</span>' + identity + coordinates + owner + createdAt + updatedAt + detectors + '</li>';
        }).join("") + '</ul>'
      : '<p>저장된 관측점 정보가 없습니다.</p>',
    item.analysisIntersections.length
      ? '<small>유효 교차점 ' + item.analysisIntersections.length + '개</small>'
      : '<small>교차점 좌표 기록 없음' + (item.intersectionCount == null ? '' : ' · 당시 교차점 ' + item.intersectionCount + '개') + '</small>'
  ].join("");
  container.hidden = false;
}

function createRealtimeBearStyle(item) {
  const data = item || {};
  const markerText = String(data.bearCode || data.bear_code || data.id || "-");

  const pulseOuterStyle = new ol.style.Style({
    image: new ol.style.Circle({
      radius: 17,
      fill: new ol.style.Fill({ color: "rgba(52, 199, 89, 0.08)" }),
      stroke: new ol.style.Stroke({ color: "rgba(52, 199, 89, 0.32)", width: 2 })
    })
  });

  const pulseInnerStyle = new ol.style.Style({
    image: new ol.style.Circle({
      radius: 12,
      fill: new ol.style.Fill({ color: "rgba(255,255,255,0.18)" }),
      stroke: new ol.style.Stroke({ color: REALTIME_BEAR_PULSE_COLOR, width: 2.5 })
    })
  });

  // 아이콘/라벨은 고정 스타일로 재사용해 프레임별 깜빡임을 줄인다.
  const markerIconStyle = new ol.style.Style({
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
  });

  return function () {
    pulseOuterStyle.setImage(new ol.style.Circle({
      radius: 17 + realtimeBearMarkerPulse * 8,
      fill: new ol.style.Fill({ color: `rgba(52, 199, 89, ${0.08 + realtimeBearMarkerPulse * 0.16})` }),
      stroke: new ol.style.Stroke({ color: `rgba(52, 199, 89, ${0.32 + realtimeBearMarkerPulse * 0.28})`, width: 2 })
    }));

    return [pulseOuterStyle, pulseInnerStyle, markerIconStyle];
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
    registrationListEl.innerHTML = [
      '<li class="recent-registration-head" aria-hidden="true">',
      '  <span>코드</span>',
      '  <span>담당자</span>',
      '  <span>명칭</span>',
      '  <span>시간</span>',
      '</li>',
      '<li class="recent-registration-empty"><span>최근 등록 데이터 없음</span></li>',
    ].join("\n");
    return;
  }

  registrationListEl.innerHTML = [
    '<li class="recent-registration-head" aria-hidden="true">',
    '  <span>코드</span>',
    '  <span>담당자</span>',
    '  <span>명칭</span>',
    '  <span>시간</span>',
    '</li>',
    topTen
      .map(function (item, index) {
        return [
          '<li class="recent-registration-row" data-row-index="' + String(index) + '" tabindex="0" role="button" aria-label="' + item.bearCode + ' 위치로 이동">',
          '  <span class="col-code">' + escapeHtml(item.bearCode) + '</span>',
          '  <span class="col-owner">' + escapeHtml(item.owner) + '</span>',
          '  <span class="col-place">' + escapeHtml(item.place) + '</span>',
          '  <span class="col-time">' + escapeHtml(item.uploadedAt) + '</span>',
          '</li>',
        ].join("\n");
      })
      .join("\n"),
  ].join("\n");

  registrationListEl.querySelectorAll(".recent-registration-row[data-row-index]").forEach(function (rowEl) {
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
  const analysisInfoEl = document.getElementById("adminRealtimeAnalysisInfo");
  const refreshButton = document.getElementById("btnDashboardRealtimeRefresh");
  const registrationListEl = document.getElementById("recentRegistrationList");

  if (!mapContainer || !refreshButton || !registrationListEl || !window.ol) {
    return;
  }

  const markerSource = new ol.source.Vector();
  const markerLayer = new ol.layer.Vector({ source: markerSource });
  const analysisSource = new ol.source.Vector();
  const analysisStyles = {
    radius: new ol.style.Style({
      fill: new ol.style.Fill({ color: "rgba(37, 99, 235, 0.05)" }),
      stroke: new ol.style.Stroke({ color: "rgba(37, 99, 235, 0.55)", width: 1.5, lineDash: [6, 4] })
    }),
    ray: new ol.style.Style({ stroke: new ol.style.Stroke({ color: "#2563eb", width: 2 }) }),
    observation: new ol.style.Style({
      image: new ol.style.Circle({ radius: 6, fill: new ol.style.Fill({ color: "#ffffff" }), stroke: new ol.style.Stroke({ color: "#1d4ed8", width: 2.5 }) })
    }),
    intersection: new ol.style.Style({
      image: new ol.style.Circle({ radius: 4, fill: new ol.style.Fill({ color: "#f59e0b" }), stroke: new ol.style.Stroke({ color: "#78350f", width: 1 }) })
    })
  };
  const analysisLayer = new ol.layer.Vector({
    source: analysisSource,
    style: function (feature) { return analysisStyles[feature.get("analysisKind")]; }
  });
  let isLoadingRealtimeData = false;

  const map = new ol.Map({
    target: mapContainer,
    layers: [
      new ol.layer.Tile({ source: new ol.source.OSM() }),
      analysisLayer,
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

  function closeAnalysis() {
    analysisSource.clear();
    if (analysisInfoEl) analysisInfoEl.hidden = true;
  }

  function showAnalysis(item) {
    closeAnalysis();
    if (!item) return;
    renderRealtimeAnalysisInfo(item, analysisInfoEl);

    const options = item.analysisOptions || {};
    const limit = options.distanceLimitM == null ? NaN : Number(options.distanceLimitM);
    const declination = options.declinationDeg == null ? NaN : Number(options.declinationDeg);
    const observations = item.sourceObservations || [];
    const rays = item.analysisRays || [];

    observations.forEach(function (obs) {
      const lat = Number(obs.lat);
      const lng = Number(obs.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const origin = ol.proj.fromLonLat([lng, lat]);
      const marker = new ol.Feature({ geometry: new ol.geom.Point(origin) });
      marker.set("analysisKind", "observation");
      analysisSource.addFeature(marker);

      if (!Number.isFinite(limit) || limit <= 0) return;
      const projectedLimit = limit / Math.cos(lat * Math.PI / 180);
      const radius = new ol.Feature({ geometry: new ol.geom.Circle(origin, projectedLimit) });
      radius.set("analysisKind", "radius");
      analysisSource.addFeature(radius);

      const ray = rays.find(function (candidate) { return String(candidate.id) === String(obs.id); });
      const storedBearing = ray && ray.adjustedBearing != null ? Number(ray.adjustedBearing) : NaN;
      const heading = obs.heading == null ? NaN : parseFloat(String(obs.heading));
      const bearing = Number.isFinite(storedBearing)
        ? storedBearing
        : Number.isFinite(heading) && Number.isFinite(declination) ? heading + declination : NaN;
      if (!Number.isFinite(bearing)) return;
      const radians = bearing * Math.PI / 180;
      const end = [origin[0] + Math.sin(radians) * projectedLimit, origin[1] + Math.cos(radians) * projectedLimit];
      const line = new ol.Feature({ geometry: new ol.geom.LineString([origin, end]) });
      line.set("analysisKind", "ray");
      analysisSource.addFeature(line);
    });

    item.analysisIntersections.forEach(function (point) {
      const lat = Number(point.lat);
      const lng = Number(point.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const feature = new ol.Feature({ geometry: new ol.geom.Point(ol.proj.fromLonLat([lng, lat])) });
      feature.set("analysisKind", "intersection");
      analysisSource.addFeature(feature);
    });

    if (analysisSource.getFeatures().length) {
      map.getView().fit(analysisSource.getExtent(), {
        padding: [35, 45, 150, 45],
        maxZoom: 12,
        duration: 300
      });
    } else {
      map.getView().animate({ center: ol.proj.fromLonLat([item.lng, item.lat]), zoom: 11, duration: 260 });
    }
  }

  map.on("singleclick", function (event) {
    const marker = map.forEachFeatureAtPixel(event.pixel, function (feature) {
      return feature.get("isRealtimeMarker") ? feature : null;
    });
    if (marker) showAnalysis(marker.get("bearEstimateData"));
  });

  if (analysisInfoEl) {
    analysisInfoEl.addEventListener("click", function (event) {
      if (event.target.closest(".admin-analysis-close")) closeAnalysis();
    });
  }

  async function loadRealtimeMapData() {
    if (isLoadingRealtimeData) return;
    isLoadingRealtimeData = true;
    refreshButton.disabled = true;

    try {
      const items = await fetchRealtimeItems();

      markerSource.clear();
      closeAnalysis();

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
        showAnalysis(targetItem);
      });
    } catch (error) {
      console.error("[admin-dashboard] realtime map load failed", error);
      markerSource.clear();
      closeAnalysis();
      if (mapEmptyEl) {
        mapEmptyEl.hidden = false;
        mapEmptyEl.textContent = error && error.message ? error.message : "실시간 목록을 불러오지 못했습니다.";
      }
      renderRecentRegistrationList([], registrationListEl, function () {});
    } finally {
      refreshButton.disabled = false;
      isLoadingRealtimeData = false;
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
