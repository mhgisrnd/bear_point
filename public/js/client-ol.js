// public/js/client-ol.js
// OpenLayers mode using existing obs modules

(function initOpenLayersMode() {
  const statusEl = document.getElementById("status");
  const mapEl = document.getElementById("map");
  const compassNeedleFixedEl = document.getElementById("compass-needle");
  const panelEl = document.getElementById("panel");
  const btnPanelToggle = document.getElementById("btn-panel-toggle");
  const bearsListEl = document.getElementById("bears-list");
  const currentCoordEl = document.getElementById("obs-current-coord");
  const currentHeadingEl = document.getElementById("obs-current-heading");
  const searchParams = new URLSearchParams(window.location.search);
  let removeBackButtonListener = null;
  let exitConfirmOpen = false;

  try {

  if (!window.ol || !mapEl) {
    if (statusEl) statusEl.textContent = "OpenLayers 로딩 실패";
    return;
  }

  function getNumericParam(name, fallback, min, max) {
    const raw = searchParams.get(name);
    if (raw === null) return fallback;
    const num = Number(raw);
    if (!Number.isFinite(num)) return fallback;
    if (typeof min === "number" && num < min) return fallback;
    if (typeof max === "number" && num > max) return fallback;
    return num;
  }

  const JIRISAN_BOUNDS_WGS84 = [127.4, 35.15, 127.85, 35.5];
  const HILLSHADE_BASE_OPACITY = 0.32;
  const PARAM_MAX_ZOOM_LIMIT = 30;
  const VIEW_MAX_ZOOM = getNumericParam("olMaxZoom", 18, 3, PARAM_MAX_ZOOM_LIMIT);
  const TOPO_MAX_ZOOM = getNumericParam("olTopoMaxZoom", 18, 3, PARAM_MAX_ZOOM_LIMIT);
  const HILLSHADE_MAX_ZOOM = getNumericParam("olHillshadeMaxZoom", 18, 3, PARAM_MAX_ZOOM_LIMIT);
  const HILLSHADE_SAFE_MAX_ZOOM = getNumericParam("olHillshadeSafeMaxZoom", 16, 3, PARAM_MAX_ZOOM_LIMIT);
  const HEADING_OFFSET = {
    ios: 0,
    android: 0,
    other: 0
  };
  const COMPASS_CFG = {
    smoothAlpha: 0.25,
    useGpsHeadingWhenMoving: true,
    gpsMinSpeedMps: 0.8,
    gpsHeadingMaxAgeMs: 2500,
    gpsBlendAlphaMin: 0.58,
    gpsBlendAlphaMax: 0.88,  
    gpsBlendSpeedMaxMps: 8,
    jumpThresholdDeg: 70,
    unstableWindowMs: 2500,
    unstableCount: 6,
    freezeOnUnstable: true
  };

  let locateBtnEl = null;
  let watchId = null;
  let isMyVisible = false;
  let didMoveToMe = false;
  let lastLatLng = null;
  let lastGpsTimestamp = null;
  let bearsDataCache = [];
  let compassEnabled = false;
  let compassHandler = null;
  let compassEventName = null;
  let headingSmoothed = null;
  let lastHeadingDeg = null;
  let lastAbsoluteSampleTs = 0;
  let lastGpsHeadingDeg = null;
  let lastGpsSpeedMps = null;
  let lastGpsHeadingTs = 0;
  let lastGpsSampleLatLng = null;
  let lastGpsSampleTs = 0;
  let unstableHits = [];
  let lastStableDeg = null;

  const osmBase = new ol.layer.Tile({
    source: new ol.source.OSM(),
    visible: true
  });

  const topoBase = new ol.layer.Tile({
    source: new ol.source.XYZ({
      url: "https://{a-c}.tile.opentopomap.org/{z}/{x}/{y}.png",
      attributions: "Map data: OpenStreetMap contributors, SRTM | Style: OpenTopoMap",
      maxZoom: TOPO_MAX_ZOOM
    }),
    visible: false
  });

  const hillshadeOverlay = new ol.layer.Tile({
    source: new ol.source.XYZ({
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
      attributions: "Hillshade Esri",
      maxZoom: HILLSHADE_MAX_ZOOM
    }),
    opacity: HILLSHADE_BASE_OPACITY,
    visible: true
  });

  let tileLoadSuccessCount = 0;
  let tileLoadErrorCount = 0;

  function bindTileErrorStatus(source, layerName) {
    if (!source || typeof source.on !== "function") return;
    source.on("tileloadend", function () {
      tileLoadSuccessCount += 1;
    });
    source.on("tileloaderror", function () {
      tileLoadErrorCount += 1;
      console.error("Tile load failed:", layerName);
      if (statusEl) {
        statusEl.textContent = "🟠 " + layerName + " 타일 로드 실패 (네트워크 또는 URL 확인)";
      }
    });
  }

  bindTileErrorStatus(osmBase.getSource(), "OSM");
  bindTileErrorStatus(topoBase.getSource(), "OpenTopoMap");
  bindTileErrorStatus(hillshadeOverlay.getSource(), "Hillshade");

  function createHeadingIconDataUri(svgSize) {
    const center = svgSize / 2;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + svgSize + '" height="' + svgSize + '" viewBox="0 0 ' + svgSize + ' ' + svgSize + '">' +
        '<path d="M ' + center + ' 4 L ' + (center + 9) + ' ' + (center - 2) + ' L ' + center + ' ' + (center - 6) + ' L ' + (center - 9) + ' ' + (center - 2) + ' Z" fill="#2b7cff"/>' +
        '<circle cx="' + center + '" cy="' + (center + 3) + '" r="6" fill="#2b7cff"/>' +
      '</svg>';

    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  const myLocationSource = new ol.source.Vector();
  let myLocationFeature = null;
  const MY_HEADING_ICON_SIZE = 48;
  const myHeadingIconSrc = createHeadingIconDataUri(MY_HEADING_ICON_SIZE);
  const myLocationLayer = new ol.layer.Vector({
    source: myLocationSource,
    style: function (feature) {
      const headingDeg = feature ? feature.get("headingDeg") : null;
      const rotation = Number.isFinite(headingDeg) ? (headingDeg * Math.PI) / 180 : 0;

      return [
        new ol.style.Style({
          image: new ol.style.Icon({
            src: myHeadingIconSrc,
            width: MY_HEADING_ICON_SIZE,
            height: MY_HEADING_ICON_SIZE,
            anchor: [0.5, 0.5],
            anchorXUnits: "fraction",
            anchorYUnits: "fraction",
            rotateWithView: true,
            rotation: rotation
          })
        })
      ];
    }
  });

  const bearMarkerSource = new ol.source.Vector();
  const bearMarkerLayer = new ol.layer.Vector({ source: bearMarkerSource });

  const observationMarkerSource = new ol.source.Vector();

  const view = new ol.View({
    center: ol.proj.fromLonLat([127.655, 35.315]),
    zoom: 11,
    minZoom: 3,
    maxZoom: VIEW_MAX_ZOOM
  });

  const map = new ol.Map({
    target: "map",
    layers: [osmBase, topoBase, hillshadeOverlay, bearMarkerLayer, myLocationLayer],
    view: view,
    controls: ol.control.defaults.defaults({
      zoom: false,
      rotate: false,
      attribution: true
    })
  });

  window.__olMap = map;
  window.__olView = view;

  const extent3857 = ol.proj.transformExtent(JIRISAN_BOUNDS_WGS84, "EPSG:4326", "EPSG:3857");
  view.fit(extent3857, {
    padding: [20, 20, 20, 20],
    maxZoom: 14,
    duration: 500
  });

  function syncHillshadeByZoom() {
    const zoom = view.getZoom();
    if (typeof zoom !== "number") return;
    hillshadeOverlay.setOpacity(zoom >= HILLSHADE_SAFE_MAX_ZOOM ? 0 : HILLSHADE_BASE_OPACITY);
  }

  view.on("change:resolution", syncHillshadeByZoom);
  syncHillshadeByZoom();

  function setBaseLayer(type) {
    osmBase.setVisible(type === "osm");
    topoBase.setVisible(type === "topo");
  }

  async function initializeEmbeddedDatabase() {
    // sqlite-init.js가 로드되지 않았더라도 지도 기능은 계속 동작하도록 한다.
    if (!window.BearSQLite || typeof window.BearSQLite.initialize !== "function") {
      return { ready: false, reason: "sqlite-module-not-loaded" };
    }

    const result = await window.BearSQLite.initialize();

    if (result && result.reason === "db-not-found") {
      console.info("[SQLite] DB file not found. Place BearPointData.db under public/assets/databases.");
    }

    if (result && result.ready) {
      console.info("[SQLite] internal database connection is ready.");
    }

    return result;
  }

  function flyToLatLng(latlng, zoom) {
    if (!Array.isArray(latlng) || latlng.length < 2) return;
    const target = ol.proj.fromLonLat([latlng[1], latlng[0]]);
    view.animate({
      center: target,
      zoom: typeof zoom === "number" ? zoom : (view.getZoom() || 11),
      duration: 700
    });
  }

  function updateRegistrationPreview() {
    const baseLatLng = lastLatLng || [35.315, 127.655];
    const previewHeading = lastHeadingDeg !== null ? Math.round(lastHeadingDeg) + "°" : "대기중";

    if (currentCoordEl) {
      currentCoordEl.textContent = baseLatLng[0].toFixed(6) + ", " + baseLatLng[1].toFixed(6);
    }
    if (currentHeadingEl) {
      currentHeadingEl.textContent = previewHeading;
    }
  }

  function ensureMyLocationFeature(coord) {
    if (!myLocationFeature) {
      myLocationFeature = new ol.Feature(new ol.geom.Point(coord));
      myLocationFeature.set("headingDeg", null);
      myLocationSource.addFeature(myLocationFeature);
      return myLocationFeature;
    }

    myLocationFeature.setGeometry(new ol.geom.Point(coord));
    return myLocationFeature;
  }

  function norm360(deg) {
    return (deg % 360 + 360) % 360;
  }

  function angleDelta(a, b) {
    let delta = norm360(a - b);
    if (delta > 180) delta -= 360;
    return delta;
  }

  function getScreenAngle() {
    const screenAngle = screen && screen.orientation ? screen.orientation.angle : undefined;
    if (typeof screenAngle === "number") return screenAngle;
    const orientation = window.orientation;
    if (typeof orientation === "number") return orientation;
    return 0;
  }

  function pickClosestHeading(candidates, referenceDeg) {
    if (!Array.isArray(candidates) || candidates.length === 0) return null;
    if (!Number.isFinite(referenceDeg)) return candidates[0];

    let best = candidates[0];
    let bestDiff = Math.abs(angleDelta(candidates[0], referenceDeg));
    for (let index = 1; index < candidates.length; index += 1) {
      const diff = Math.abs(angleDelta(candidates[index], referenceDeg));
      if (diff < bestDiff) {
        best = candidates[index];
        bestDiff = diff;
      }
    }
    return best;
  }

  function getPlatform() {
    const ua = navigator.userAgent || "";
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    if (isIOS) return "ios";
    if (isAndroid) return "android";
    return "other";
  }

  function getCapacitorAppPlugin() {
    const capacitor = window.Capacitor;
    if (!capacitor || !capacitor.Plugins) return null;

    const appPlugin = capacitor.Plugins.App;
    if (!appPlugin) return null;
    if (typeof appPlugin.addListener !== "function") return null;
    if (typeof appPlugin.exitApp !== "function") return null;

    return appPlugin;
  }

  async function setupAndroidBackButtonExit() {
    if (getPlatform() !== "android") return;

    const appPlugin = getCapacitorAppPlugin();
    if (!appPlugin || removeBackButtonListener) return;

    const listener = await appPlugin.addListener("backButton", function () {
      if (exitConfirmOpen) return;

      exitConfirmOpen = true;
      const shouldExit = window.confirm("앱을 종료하시겠습니까?");
      exitConfirmOpen = false;

      if (shouldExit) {
        appPlugin.exitApp();
      }
    });

    if (listener && typeof listener.remove === "function") {
      removeBackButtonListener = function () {
        listener.remove();
        removeBackButtonListener = null;
      };

      window.addEventListener("beforeunload", function cleanupBackButtonListener() {
        if (removeBackButtonListener) {
          removeBackButtonListener();
        }
      }, { once: true });
    }
  }

  function applyHeadingOffset(deg, platform) {
    const key = platform || getPlatform();
    let offset = HEADING_OFFSET[key];
    if (offset === null || offset === undefined) {
      offset = HEADING_OFFSET.other;
    }
    if (offset === null || offset === undefined) {
      offset = 0;
    }
    return norm360(deg + offset);
  }

  function updateGpsHeadingSample(coords) {
    if (!coords) return;

    const now = Date.now();
    const nextLatLng = [coords.latitude, coords.longitude];

    const speed = coords.speed;
    if (typeof speed === "number" && Number.isFinite(speed) && speed >= 0) {
      lastGpsSpeedMps = speed;
    } else {
      lastGpsSpeedMps = null;
    }

    const heading = coords.heading;
    if (typeof heading === "number" && Number.isFinite(heading) && heading >= 0) {
      lastGpsHeadingDeg = norm360(heading);
      lastGpsHeadingTs = now;
    } else if (lastGpsSampleLatLng && lastGpsSampleTs > 0) {
      const derivedSpeed = computeGpsSpeedMps(lastGpsSampleLatLng, nextLatLng, lastGpsSampleTs, now);
      if (!Number.isFinite(lastGpsSpeedMps) && Number.isFinite(derivedSpeed)) {
        lastGpsSpeedMps = derivedSpeed;
      }

      const derivedHeading = computeBearingFromLatLng(lastGpsSampleLatLng, nextLatLng);
      if (
        Number.isFinite(derivedHeading) &&
        Number.isFinite(derivedSpeed) &&
        derivedSpeed >= COMPASS_CFG.gpsMinSpeedMps
      ) {
        lastGpsHeadingDeg = derivedHeading;
        lastGpsHeadingTs = now;
      }
    }

    lastGpsSampleLatLng = nextLatLng;
    lastGpsSampleTs = now;

    if (Number.isFinite(lastGpsSpeedMps) && lastGpsSpeedMps < COMPASS_CFG.gpsMinSpeedMps) {
      lastGpsHeadingDeg = null;
      lastGpsHeadingTs = 0;
    }
  }

  function toRadians(deg) {
    return deg * Math.PI / 180;
  }

  function toDegrees(rad) {
    return rad * 180 / Math.PI;
  }

  function computeDistanceMeters(fromLatLng, toLatLng) {
    if (!Array.isArray(fromLatLng) || !Array.isArray(toLatLng)) return null;

    const earthRadius = 6371000;
    const lat1 = toRadians(fromLatLng[0]);
    const lat2 = toRadians(toLatLng[0]);
    const deltaLat = toRadians(toLatLng[0] - fromLatLng[0]);
    const deltaLng = toRadians(toLatLng[1] - fromLatLng[1]);

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadius * c;
  }

  function computeBearingFromLatLng(fromLatLng, toLatLng) {
    if (!Array.isArray(fromLatLng) || !Array.isArray(toLatLng)) return null;

    const distanceMeters = computeDistanceMeters(fromLatLng, toLatLng);
    if (!Number.isFinite(distanceMeters) || distanceMeters < 2) return null;

    const lat1 = toRadians(fromLatLng[0]);
    const lat2 = toRadians(toLatLng[0]);
    const deltaLng = toRadians(toLatLng[1] - fromLatLng[1]);
    const y = Math.sin(deltaLng) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLng);

    return norm360(toDegrees(Math.atan2(y, x)));
  }

  function computeGpsSpeedMps(fromLatLng, toLatLng, fromTs, toTs) {
    const distanceMeters = computeDistanceMeters(fromLatLng, toLatLng);
    const deltaSeconds = (toTs - fromTs) / 1000;
    if (!Number.isFinite(distanceMeters) || !Number.isFinite(deltaSeconds) || deltaSeconds <= 0) {
      return null;
    }
    return distanceMeters / deltaSeconds;
  }

  function canUseGpsHeading() {
    if (!COMPASS_CFG.useGpsHeadingWhenMoving) return false;
    if (!Number.isFinite(lastGpsHeadingDeg)) return false;
    if (!Number.isFinite(lastGpsSpeedMps)) return false;
    if (lastGpsSpeedMps < COMPASS_CFG.gpsMinSpeedMps) return false;
    if (!lastGpsHeadingTs) return false;
    if (Date.now() - lastGpsHeadingTs > COMPASS_CFG.gpsHeadingMaxAgeMs) return false;
    return true;
  }

  function getAdaptiveGpsBlendAlpha() {
    const minAlpha = COMPASS_CFG.gpsBlendAlphaMin;
    const maxAlpha = COMPASS_CFG.gpsBlendAlphaMax;
    const maxSpeed = COMPASS_CFG.gpsBlendSpeedMaxMps;

    if (!Number.isFinite(lastGpsSpeedMps) || !Number.isFinite(maxSpeed) || maxSpeed <= 0) {
      return minAlpha;
    }

    const clampedSpeed = Math.max(0, Math.min(lastGpsSpeedMps, maxSpeed));
    const ratio = clampedSpeed / maxSpeed;
    return minAlpha + (maxAlpha - minAlpha) * ratio;
  }

  function fuseHeadingWithGps(sensorDeg) {
    if (!Number.isFinite(sensorDeg)) return sensorDeg;
    if (!canUseGpsHeading()) return sensorDeg;

    const gpsDeg = norm360(lastGpsHeadingDeg);
    const delta = angleDelta(gpsDeg, sensorDeg);
    return norm360(sensorDeg + delta * getAdaptiveGpsBlendAlpha());
  }

  function computeHeadingFromEvent(event) {
    const screenAngle = getScreenAngle();

    if (typeof event.webkitCompassHeading === "number") {
      return norm360(event.webkitCompassHeading);
    }

    if (event.absolute === true && typeof event.alpha === "number") {
      const raw = norm360(360 - event.alpha);
      return pickClosestHeading([
        raw,
        norm360(raw + screenAngle),
        norm360(raw - screenAngle)
      ], headingSmoothed);
    }

    if (typeof event.alpha === "number") {
      const raw = norm360(360 - event.alpha);
      return pickClosestHeading([
        raw,
        norm360(raw + screenAngle),
        norm360(raw - screenAngle)
      ], headingSmoothed);
    }

    return null;
  }

  function filterHeading(nextDeg) {
    if (headingSmoothed === null) {
      headingSmoothed = nextDeg;
      lastStableDeg = nextDeg;
      return nextDeg;
    }

    const delta = angleDelta(nextDeg, headingSmoothed);
    const absDelta = Math.abs(delta);

    if (absDelta >= COMPASS_CFG.jumpThresholdDeg) {
      unstableHits.push(Date.now());
      const cutoff = Date.now() - COMPASS_CFG.unstableWindowMs;
      unstableHits = unstableHits.filter(function (timestamp) {
        return timestamp >= cutoff;
      });

      if (unstableHits.length >= COMPASS_CFG.unstableCount) {
        if (COMPASS_CFG.freezeOnUnstable && lastStableDeg !== null) {
          return lastStableDeg;
        }
        headingSmoothed = norm360(headingSmoothed + delta * 0.08);
        return headingSmoothed;
      }

      headingSmoothed = norm360(headingSmoothed + delta * 0.12);
      return headingSmoothed;
    }

    headingSmoothed = norm360(headingSmoothed + delta * COMPASS_CFG.smoothAlpha);
    lastStableDeg = headingSmoothed;
    return headingSmoothed;
  }

  function setHeading(deg) {
    if (!Number.isFinite(deg)) return;

    let effectiveDeg = deg;
    if (obsRegisterModule && obsRegisterModule.isHeadingLocked && obsRegisterModule.isHeadingLocked()) {
      const lockedHeading = obsRegisterModule.getLockedHeading ? obsRegisterModule.getLockedHeading() : null;
      if (Number.isFinite(lockedHeading)) {
        effectiveDeg = lockedHeading;
      }
    }

    lastHeadingDeg = effectiveDeg;

    if (myLocationFeature) {
      myLocationFeature.set("headingDeg", effectiveDeg);
      myLocationFeature.changed();
    }

    if (obsRegisterModule) {
      obsRegisterModule.updateLiveData({
        heading: deg,
        timestamp: lastGpsTimestamp || Date.now(),
        isGpsActive: isMyVisible || watchId !== null
      });
    }

    if (compassNeedleFixedEl) {
      compassNeedleFixedEl.style.transform = "rotate(" + (-effectiveDeg) + "deg)";
    }

    updateRegistrationPreview();
  }

  async function startCompass() {
    if (compassEnabled) return;

    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission !== "granted") {
        if (statusEl) statusEl.textContent = "🟠 나침반 권한 거부됨";
        return;
      }
    }

    compassHandler = function (event) {
      if (event.type === "deviceorientationabsolute") {
        lastAbsoluteSampleTs = Date.now();
      }

      if (
        event.type === "deviceorientation" &&
        lastAbsoluteSampleTs > 0 &&
        Date.now() - lastAbsoluteSampleTs < 1500
      ) {
        return;
      }

      const heading = computeHeadingFromEvent(event);
      if (!Number.isFinite(heading)) return;

      const corrected = applyHeadingOffset(heading);
      const smoothed = filterHeading(corrected);
      const fused = fuseHeadingWithGps(smoothed);
      setHeading(fused);
    };

    const hasAbsoluteEvent = "ondeviceorientationabsolute" in window;
    compassEventName = hasAbsoluteEvent ? "deviceorientationabsolute" : "deviceorientation";
    window.addEventListener(compassEventName, compassHandler, true);
    if (hasAbsoluteEvent) {
      window.addEventListener("deviceorientation", compassHandler, true);
    }

    compassEnabled = true;
  }

  function stopCompass() {
    if (!compassEnabled) return;
    if (compassEventName) {
      window.removeEventListener(compassEventName, compassHandler, true);
    }
    window.removeEventListener("deviceorientation", compassHandler, true);
    compassHandler = null;
    compassEnabled = false;
    compassEventName = null;
    headingSmoothed = null;
    unstableHits = [];
    lastStableDeg = null;
    lastAbsoluteSampleTs = 0;

    if (compassNeedleFixedEl) {
      compassNeedleFixedEl.style.transform = "rotate(0deg)";
    }
  }

  function createObservationStyleFromMarker(marker) {
    const obsData = marker && marker.obsData ? marker.obsData : null;
    const idText = obsData ? String(obsData.id || "-") : "-";

    return new ol.style.Style({
      image: new ol.style.Circle({
        radius: 13,
        fill: new ol.style.Fill({ color: "#4c6fd3" }),
        stroke: new ol.style.Stroke({ color: "#ffffff", width: 2 })
      }),
      text: new ol.style.Text({
        text: idText,
        font: "700 11px sans-serif",
        fill: new ol.style.Fill({ color: "#ffffff" })
      })
    });
  }

  // obsList.js 재사용을 위한 최소 Leaflet 호환 어댑터
  if (!window.L) window.L = {};
  if (!window.L.divIcon) {
    window.L.divIcon = function (options) {
      return { options: options || {} };
    };
  }
  if (!window.L.marker) {
    window.L.marker = function (latlng, options) {
      return {
        _latlng: latlng,
        _icon: options && options.icon ? options.icon : null,
        _feature: null,
        obsData: null,
        bindPopup: function () {
          return this;
        },
        setIcon: function (icon) {
          this._icon = icon;
          if (this._feature) {
            this._feature.setStyle(createObservationStyleFromMarker(this));
          }
        }
      };
    };
  }

  const olMapAdapter = {
    getZoom: function () {
      return view.getZoom() || 11;
    },
    on: function (eventName, handler) {
      if (eventName === "zoomend") {
        view.on("change:resolution", function () {
          handler();
        });
      }
    },
    closePopup: function () {
      // OpenLayers 모드에서는 팝업 미사용
    }
  };

  const observationMarkersLayer = {
    clearLayers: function () {
      observationMarkerSource.clear();
    },
    addLayer: function (marker) {
      if (!marker || !Array.isArray(marker._latlng)) return;

      const coord = ol.proj.fromLonLat([marker._latlng[1], marker._latlng[0]]);
      const feature = new ol.Feature({ geometry: new ol.geom.Point(coord) });
      marker._feature = feature;
      feature.setStyle(createObservationStyleFromMarker(marker));
      observationMarkerSource.addFeature(feature);
    }
  };

  const observationMarkerLayer = new ol.layer.Vector({ source: observationMarkerSource });
  map.addLayer(observationMarkerLayer);

  function collapseBearEstimatePanel() {
    if (!panelEl || !btnPanelToggle) return;
    if (panelEl.classList.contains("collapsed")) return;

    panelEl.classList.add("collapsed");
    btnPanelToggle.textContent = "▲";
    btnPanelToggle.setAttribute("aria-expanded", "false");
  }

  function setLocateButtonActive(active) {
    if (!locateBtnEl) return;
    if (active) {
      locateBtnEl.classList.add("is-active");
      locateBtnEl.style.background = "#2b7cff";
      locateBtnEl.style.color = "#fff";
    } else {
      locateBtnEl.classList.remove("is-active");
      locateBtnEl.style.background = "#fff";
      locateBtnEl.style.color = "#2f2f2f";
    }
  }

  let obsListModule = null;
  const obsRegisterModule = window.createObsRegisterModule ? window.createObsRegisterModule({
    statusEl: statusEl,
    updateRegistrationPreview: updateRegistrationPreview,
    onClose: function () {
      if (obsListModule) obsListModule.deactivate();
    }
  }) : null;

  function updateMyLocation(lat, lng) {
    const coord = ol.proj.fromLonLat([lng, lat]);
    lastLatLng = [lat, lng];
    lastGpsTimestamp = Date.now();
    ensureMyLocationFeature(coord);

    updateRegistrationPreview();

    if (lastHeadingDeg !== null) {
      setHeading(lastHeadingDeg);
    } else if (canUseGpsHeading()) {
      setHeading(lastGpsHeadingDeg);
    }

    if (obsRegisterModule) {
      obsRegisterModule.updateLiveData({
        lat: lat,
        lng: lng,
        heading: lastHeadingDeg,
        timestamp: lastGpsTimestamp,
        isGpsActive: true
      });
    }

    if (!didMoveToMe) {
      didMoveToMe = true;
      view.animate({ center: coord, zoom: Math.max(16, view.getZoom() || 11), duration: 650 });
    }
  }

  function stopMyLocationTracking(showStatus) {
    stopCompass();
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    myLocationSource.clear();
    myLocationFeature = null;
    isMyVisible = false;
    didMoveToMe = false;
    lastLatLng = null;
    lastGpsTimestamp = null;
    lastHeadingDeg = null;
    lastGpsHeadingDeg = null;
    lastGpsSpeedMps = null;
    lastGpsHeadingTs = 0;
    lastGpsSampleLatLng = null;
    lastGpsSampleTs = 0;
    setLocateButtonActive(false);
    updateRegistrationPreview();

    if (obsRegisterModule) {
      obsRegisterModule.updateLiveData({
        lat: null,
        lng: null,
        heading: null,
        timestamp: null,
        isGpsActive: false
      });
    }

    if (showStatus && statusEl) {
      statusEl.textContent = "⚪ 내 위치 OFF";
    }
  }

  async function startMyLocationTracking() {
    if (!navigator.geolocation) {
      if (statusEl) statusEl.textContent = "🔴 위치 기능 미지원 브라우저";
      return;
    }

    await startCompass();

    if (statusEl) statusEl.textContent = "📍 내 위치 잡는 중…";

    const optsFast = { enableHighAccuracy: false, timeout: 30000, maximumAge: 15000 };
    const optsWatch = { enableHighAccuracy: true, timeout: 30000, maximumAge: 5000 };

    navigator.geolocation.getCurrentPosition(function (pos) {
      updateGpsHeadingSample(pos.coords);
      updateMyLocation(pos.coords.latitude, pos.coords.longitude);
      isMyVisible = true;
      setLocateButtonActive(true);
      if (statusEl) statusEl.textContent = "✅ 내 위치 ON";
    }, function () {
      // 최초 실패는 watch에서 재시도
    }, optsFast);

    watchId = navigator.geolocation.watchPosition(function (pos) {
      updateGpsHeadingSample(pos.coords);
      updateMyLocation(pos.coords.latitude, pos.coords.longitude);
      isMyVisible = true;
      setLocateButtonActive(true);
      if (statusEl) statusEl.textContent = "✅ 내 위치 ON";
    }, function (err) {
      stopMyLocationTracking(false);
      if (statusEl) statusEl.textContent = "🔴 위치 오류: " + err.message;
    }, optsWatch);
  }

  async function toggleMyLocation() {
    if (isMyVisible || watchId !== null) {
      stopMyLocationTracking(true);
      return;
    }
    await startMyLocationTracking();
  }

  function mountRightBottomControls() {
    const root = document.createElement("div");
    root.style.position = "absolute";
    root.style.right = "calc(8px + var(--safe-right))";
    root.style.bottom = "calc(14px + var(--safe-bottom))";
    root.style.zIndex = "1400";
    root.style.display = "flex";
    root.style.flexDirection = "column";
    root.style.gap = "6px";

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
      "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M3 19l6.5-11L16 19H3z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linejoin=\"round\"/><path d=\"M10.5 19l4.5-8 6 8h-10.5z\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linejoin=\"round\"/><path d=\"M9.5 8l1.2 2 1.3-2\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>",
      function () {
        view.fit(extent3857, { padding: [20, 20, 20, 20], maxZoom: 14, duration: 450 });
      }
    );

    locateBtnEl = makeBtn(
      "leaflet-control-locate-btn",
      "내 위치 토글",
      "<svg width=\"18\" height=\"18\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 2v3\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><path d=\"M12 19v3\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><path d=\"M2 12h3\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><path d=\"M19 12h3\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/><circle cx=\"12\" cy=\"12\" r=\"6\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\"/><circle cx=\"12\" cy=\"12\" r=\"1.5\" fill=\"currentColor\"/></svg>",
      function () {
        toggleMyLocation();
      }
    );

    const btnZoomIn = makeBtn("ol-zoom-in-btn", "확대", "+", function () {
      const current = view.getZoom() || 0;
      const next = Math.min(VIEW_MAX_ZOOM, current + 1);
      view.animate({ zoom: next, duration: 180 });
    });
    btnZoomIn.style.fontSize = "19px";
    btnZoomIn.style.fontWeight = "700";

    const btnZoomOut = makeBtn("ol-zoom-out-btn", "축소", "-", function () {
      const current = view.getZoom() || 0;
      const next = Math.max(3, current - 1);
      view.animate({ zoom: next, duration: 180 });
    });
    btnZoomOut.style.fontSize = "20px";
    btnZoomOut.style.fontWeight = "700";

    root.appendChild(btnJiri);
    root.appendChild(locateBtnEl);
    root.appendChild(btnZoomIn);
    root.appendChild(btnZoomOut);

    root.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    root.addEventListener("touchstart", function (e) { e.stopPropagation(); }, { passive: true });
    root.addEventListener("wheel", function (e) { e.stopPropagation(); }, { passive: true });

    mapEl.appendChild(root);
  }

  function mountLayerSwitcher() {
    const root = document.createElement("div");
    root.style.position = "absolute";
    root.style.top = "calc(12px + var(--safe-top))";
    root.style.right = "calc(12px + var(--safe-right))";
    root.style.zIndex = "1500";

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
    toggleBtn.innerHTML = "<svg width=\"22\" height=\"22\" viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M12 3L2 8l10 5 10-5-10-5z\" fill=\"#d7dbe0\" stroke=\"#9aa3ad\" stroke-width=\"0.8\"/><path d=\"M2 12l10 5 10-5\" fill=\"none\" stroke=\"#9aa3ad\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/><path d=\"M2 16l10 5 10-5\" fill=\"none\" stroke=\"#9aa3ad\" stroke-width=\"1.4\" stroke-linecap=\"round\" stroke-linejoin=\"round\"/></svg>";

    const panel = document.createElement("div");
    panel.style.display = "none";
    panel.style.position = "absolute";
    panel.style.top = "46px";
    panel.style.right = "0";
    panel.style.background = "#f6f6f6";
    panel.style.border = "1px solid #8e8e8e";
    panel.style.borderRadius = "4px";
    panel.style.padding = "8px 10px";
    panel.style.fontSize = "13px";
    panel.style.lineHeight = "1.5";
    panel.style.minWidth = "210px";

    const row1 = document.createElement("div");
    row1.style.display = "flex";
    row1.style.alignItems = "center";
    row1.style.gap = "8px";
    row1.style.marginBottom = "2px";

    const radioOsm = document.createElement("input");
    radioOsm.type = "radio";
    radioOsm.name = "ol-base-layer";
    radioOsm.value = "osm";
    radioOsm.checked = true;

    const labelOsm = document.createElement("label");
    labelOsm.style.cursor = "pointer";
    labelOsm.textContent = "일반지도";
    row1.appendChild(radioOsm);
    row1.appendChild(labelOsm);

    const rowTopo = document.createElement("div");
    rowTopo.style.display = "flex";
    rowTopo.style.alignItems = "center";
    rowTopo.style.gap = "8px";
    rowTopo.style.marginBottom = "2px";

    const radioTopo = document.createElement("input");
    radioTopo.type = "radio";
    radioTopo.name = "ol-base-layer";
    radioTopo.value = "topo";

    const labelTopo = document.createElement("label");
    labelTopo.style.cursor = "pointer";
    labelTopo.textContent = "지형도(OpenTopoMap)";
    rowTopo.appendChild(radioTopo);
    rowTopo.appendChild(labelTopo);

    function syncBaseByRadio() {
      const selected = radioTopo.checked ? "topo" : "osm";
      setBaseLayer(selected);
    }

    radioOsm.addEventListener("change", syncBaseByRadio);
    radioTopo.addEventListener("change", syncBaseByRadio);
    labelOsm.addEventListener("click", function () { radioOsm.checked = true; syncBaseByRadio(); });
    labelTopo.addEventListener("click", function () { radioTopo.checked = true; syncBaseByRadio(); });

    const row2 = document.createElement("label");
    row2.style.display = "flex";
    row2.style.alignItems = "center";
    row2.style.gap = "8px";
    row2.style.marginTop = "4px";
    row2.style.cursor = "pointer";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = true;
    chk.addEventListener("change", function () {
      hillshadeOverlay.setVisible(chk.checked);
    });

    const txt = document.createElement("span");
    txt.textContent = "음영(Hillshade)";
    row2.appendChild(chk);
    row2.appendChild(txt);

    let hideTimer = null;
    let isPinned = false;
    const preferHover = !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);

    function openPanel() {
      if (hideTimer) {
        clearTimeout(hideTimer);
        hideTimer = null;
      }
      panel.style.display = "block";
      toggleBtn.setAttribute("aria-expanded", "true");
    }

    function closePanel(delayMs, forceClose) {
      if (!forceClose && isPinned) return;
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        panel.style.display = "none";
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
      if (panel.style.display === "block" && isPinned) {
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
    panel.appendChild(row1);
    panel.appendChild(rowTopo);
    panel.appendChild(row2);
    root.appendChild(panel);
    mapEl.appendChild(root);
  }

  async function loadBearsData() {
    try {
      const res = await fetch("json/bears.json", { cache: "no-store" });
      bearsDataCache = await res.json();
    } catch (e) {
      console.error("bears.json 로드 실패:", e);
      bearsDataCache = [];
    }
  }

  function makeDummyBearsNearJirisan() {
    if (!bearsDataCache.length) return [];
    const picked = bearsDataCache.slice().sort(function () {
      return Math.random() - 0.5;
    });

    return picked.map(function (bearRecord) {
      const basePoint = bearRecord.basePoints[Math.floor(Math.random() * bearRecord.basePoints.length)];
      return {
        id: bearRecord.id,
        name: bearRecord.name,
        lat: +(basePoint.lat + (Math.random() - 0.5) * 0.008).toFixed(6),
        lng: +(basePoint.lng + (Math.random() - 0.5) * 0.008).toFixed(6),
        ts: Date.now()
      };
    });
  }

  function renderBearMarkers(items) {
    bearMarkerSource.clear();
    if (!items || !items.length) return;

    items.forEach(function (it) {
      const feature = new ol.Feature({
        geometry: new ol.geom.Point(ol.proj.fromLonLat([it.lng, it.lat]))
      });

      feature.setStyle(new ol.style.Style({
        image: new ol.style.Icon({
          src: "assets/icons/icon_bear.png",
          anchor: [0.5, 1],
          width: 34,
          height: 34
        }),
        text: new ol.style.Text({
          text: String(it.id || "-"),
          offsetY: 22,
          font: "600 11px sans-serif",
          fill: new ol.style.Fill({ color: "#ffffff" }),
          backgroundFill: new ol.style.Fill({ color: "rgba(43,124,255,0.95)" }),
          padding: [2, 5, 2, 5]
        })
      }));

      bearMarkerSource.addFeature(feature);
    });
  }

  function renderBears(items) {
    if (!bearsListEl) return;
    bearsListEl.innerHTML = "";

    if (!items || items.length === 0) {
      bearsListEl.innerHTML = '<div class="bears-empty">아직 목록이 없습니다.</div>';
      return;
    }

    items.forEach(function (it) {
      const el = document.createElement("div");
      el.className = "bears-item";
      el.innerHTML =
        '<div>' +
          '<div><b>' + (it.id || "-") + '</b></div>' +
          '<div style="font-size:12px;opacity:.7">' + it.lat.toFixed(6) + ", " + it.lng.toFixed(6) + '</div>' +
        '</div>' +
        '<div style="font-size:12px;opacity:.7;align-self:center">' +
          new Date(it.ts || Date.now()).toLocaleTimeString() +
        '</div>';

      el.addEventListener("click", function () {
        flyToLatLng([it.lat, it.lng], 16);
      });

      bearsListEl.appendChild(el);
    });
  }

  async function refreshDummyBearsAndFocus() {
    if (statusEl) statusEl.textContent = "🐻 곰 더미 위치 생성중…";

    await loadBearsData();
    const items = makeDummyBearsNearJirisan();
    renderBears(items);
    renderBearMarkers(items);

    if (!items.length) {
      if (statusEl) statusEl.textContent = "🟠 표시할 곰 더미 데이터가 없습니다";
      return;
    }

    const extent = ol.extent.createEmpty();
    items.forEach(function (it) {
      const c = ol.proj.fromLonLat([it.lng, it.lat]);
      ol.extent.extend(extent, [c[0], c[1], c[0], c[1]]);
    });

    if (!ol.extent.isEmpty(extent)) {
      view.fit(extent, { padding: [20, 20, 20, 20], maxZoom: 14, duration: 450 });
    }

    if (statusEl) {
      statusEl.innerHTML = '<img src="assets/icons/icon_bear.png" style="height:18px;vertical-align:middle;margin-right:4px;" alt="곰"/> ' + items.length + '마리 표시됨';
    }
  }

  mountLayerSwitcher();
  mountRightBottomControls();

  if (btnPanelToggle && panelEl) {
    btnPanelToggle.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();

      const collapsed = panelEl.classList.toggle("collapsed");
      btnPanelToggle.textContent = collapsed ? "▲" : "▼";
      btnPanelToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
  }

  if (panelEl) panelEl.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
  if (panelEl) panelEl.addEventListener("touchstart", function (e) { e.stopPropagation(); }, { passive: true });
  if (panelEl) panelEl.addEventListener("wheel", function (e) { e.stopPropagation(); }, { passive: true });

  obsListModule = window.createObsListModule ? window.createObsListModule({
    map: olMapAdapter,
    statusEl: statusEl,
    flyToLatLng: flyToLatLng,
    observationMarkersLayer: observationMarkersLayer,
    onOpenList: function () {
      collapseBearEstimatePanel();
    },
    onOpenRegister: function () {
      collapseBearEstimatePanel();
      if (obsRegisterModule) obsRegisterModule.open();
    },
    onCloseRegister: function () {
      if (obsRegisterModule) obsRegisterModule.hide(true);
    }
  }) : null;

  if (obsRegisterModule) {
    obsRegisterModule.initialize();
    obsRegisterModule.updateLiveData({
      lat: null,
      lng: null,
      heading: null,
      timestamp: null,
      isGpsActive: false
    });
  }
  updateRegistrationPreview();
  if (obsListModule) obsListModule.initialize();
  // 앱 시작 시 자산 DB 복사/연결 열기를 선행해 이후 CRUD 연결 준비를 끝낸다.
  initializeEmbeddedDatabase().catch(function (error) {
    console.error("SQLite 초기화 오류:", error);
  });
  setupAndroidBackButtonExit().catch(function (error) {
    console.error("안드로이드 뒤로가기 초기화 오류:", error);
  });

  if (statusEl && statusEl.textContent === "연결됨") {
    statusEl.textContent = "✅ 지도 초기화 완료";
  }
  refreshDummyBearsAndFocus();

  setTimeout(function () {
    if (!statusEl) return;
    if (tileLoadSuccessCount === 0 && tileLoadErrorCount === 0) {
      statusEl.textContent = "🟠 타일 요청 없음 (지도 초기화/레이어 설정 확인)";
      return;
    }
    if (tileLoadSuccessCount === 0 && tileLoadErrorCount > 0) {
      statusEl.textContent = "🟠 타일 요청 실패 " + tileLoadErrorCount + "건";
    }
  }, 5000);
  } catch (error) {
    console.error("client-ol.js 초기화 오류:", error);
    if (statusEl) {
      statusEl.textContent = "🔴 JS 오류: " + (error && error.message ? error.message : String(error));
    }
  }
})();
