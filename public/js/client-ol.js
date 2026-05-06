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

  // URL 쿼리 파라미터를 숫자로 읽고 범위를 벗어나면 기본값으로 되돌린다.
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
  const MAP_PROJECTION_CODE = "EPSG:5179";
  const WGS84_CODE = "EPSG:4326";
  const TILE_SIZE = 256;
  const NGII_RESOLUTION_BASE_ZOOM = 5;
  const MBTILES_MIN_ZOOM = 7;
  const MBTILES_MAX_ZOOM = 17;
  const MBTILES_DB_NAME = "korea-selection2-z7-z17-webp";
  const MBTILES_MIME_TYPE = "image/webp";
  const NATIVE_MBTILES_TILE_CACHE_LIMIT = 180;
  const LOCK_EMPTY_AREA_PAN = true;
  const PAN_LIMIT_EXTENT = [931819,1594792,1074823,1803720];//제한 extent (5179 좌표계, 지리산 주변)
  const GRID_ORIGIN = [-200000, 4000000];
  const GRID_RESOLUTIONS = [
    2088.96,
    1044.48,
    522.24,
    261.12,
    130.56,
    65.28,
    32.64,
    16.32,
    8.16,
    4.08,
    2.04,
    1.02,
    0.51,
    0.255
  ];
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

  if (!window.proj4 || !ol.proj || !ol.proj.proj4 || typeof ol.proj.proj4.register !== "function") {
    if (statusEl) statusEl.textContent = "proj4 로딩 실패";
    return;
  }

  window.proj4.defs(
    MAP_PROJECTION_CODE,
    "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs +type=crs"
  );
  ol.proj.proj4.register(window.proj4);

  // WGS84(위경도) -> EPSG:5179(미터 좌표) 변환.
  function mapCoordFromWgs84(lat, lng) {
    return ol.proj.transform([lng, lat], WGS84_CODE, MAP_PROJECTION_CODE);
  }

  // EPSG:5179(미터 좌표) -> WGS84(위경도) 변환.
  function wgs84FromMapCoord(coord) {
    if (!Array.isArray(coord) || coord.length < 2) return null;
    const lonLat = ol.proj.transform(coord, MAP_PROJECTION_CODE, WGS84_CODE);
    return { lat: lonLat[1], lng: lonLat[0] };
  }

  // MBTiles 줌 범위에 맞는 5179 해상도 배열을 잘라서 만든다.
  function buildNgiiResolutions(minZoom, maxZoom) {
    const start = minZoom - NGII_RESOLUTION_BASE_ZOOM;
    const end = maxZoom - NGII_RESOLUTION_BASE_ZOOM + 1;
    if (start < 0 || end > GRID_RESOLUTIONS.length) {
      return null;
    }
    return GRID_RESOLUTIONS.slice(start, end);
  }

  function build5179ViewResolutions(minZoom, maxZoom, minZoomResolution) {
    const result = [];
    for (let z = 0; z <= maxZoom; z += 1) {
      result.push(minZoomResolution * Math.pow(2, minZoom - z));
    }
    return result;
  }

  const mbtilesResolutions = buildNgiiResolutions(MBTILES_MIN_ZOOM, MBTILES_MAX_ZOOM);
  if (!mbtilesResolutions) {
    if (statusEl) statusEl.textContent = "MBTiles 해상도 범위 오류";
    return;
  }

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

  const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
  let mbtilesSelection = null;
  let mbtilesExtentMap = null;
  let mbtilesNativeReady = false;
  let mbtilesNativeInitPromise = null;
  let mbtilesNativeFailureReason = null;
  const mbtilesNativeTileCache = new Map();

  // OpenLayers 내부 y(-1, -2...)를 XYZ 타일 y(0+)로 정규화한다.
  function normalizeXyzY(rawY) {
    return rawY < 0 ? -rawY - 1 : rawY;
  }

  // TileGrid 내부 줌(0..N)을 실제 MBTiles 줌(7..17)으로 매핑한다.
  function resolveManifestZoom(rawZoom) {
    if (!Number.isFinite(rawZoom)) return rawZoom;
    // TileGrid zoom(0..N)은 MBTiles 실제 zoom(MBTILES_MIN_ZOOM..MBTILES_MAX_ZOOM)에 오프셋을 더해 매핑한다.
    return rawZoom + MBTILES_MIN_ZOOM;
  }

  function buildExtentFromLevel5179(level, zoom) {
    const resolutionIndex = zoom - NGII_RESOLUTION_BASE_ZOOM;
    if (resolutionIndex < 0 || resolutionIndex >= GRID_RESOLUTIONS.length) return null;
    const resolution = GRID_RESOLUTIONS[resolutionIndex];
    const tileSpan = TILE_SIZE * resolution;
    return [
      GRID_ORIGIN[0] + level.minX * tileSpan,
      GRID_ORIGIN[1] - (level.maxY + 1) * tileSpan,
      GRID_ORIGIN[0] + (level.maxX + 1) * tileSpan,
      GRID_ORIGIN[1] - level.minY * tileSpan
    ];
  }

  // selection 레벨 정보에서 최대 줌 범위를 뽑아 지도의 실제 커버리지를 계산한다.
  function buildMbtilesExtent(selection) {
    if (!selection || !selection.levels) return null;
    const highest = selection.levels[String(MBTILES_MAX_ZOOM)] || selection.levels[String(Number(selection.maxZoom || MBTILES_MAX_ZOOM))];
    if (!highest) return null;
    return buildExtentFromLevel5179(highest, MBTILES_MAX_ZOOM);
  }
  // “타일 경계 가드 + 커버리지 기준 화면 맞춤”
  fetch("json/selection.json", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (sel) {
      mbtilesSelection = sel;
      mbtilesExtentMap = buildMbtilesExtent(sel);
      // fitMbtilesCoverage() 자동 호출 제거 (초기 fit과 충돌)
    })
    .catch(function () { console.warn("[MBTiles] selection.json 로드 실패"); });

  function isNativeCapacitorPlatform() {
    const capacitor = window.Capacitor;
    if (!capacitor) return false;
    if (typeof capacitor.isNativePlatform === "function") {
      return capacitor.isNativePlatform();
    }
    return typeof capacitor.getPlatform === "function" && capacitor.getPlatform() !== "web";
  }

  function getCapacitorSQLitePlugin() {
    const capacitor = window.Capacitor;
    if (!capacitor || !capacitor.Plugins) return null;
    return capacitor.Plugins.CapacitorSQLite || null;
  }

  function rememberNativeTileUrl(cacheKey, dataUrl) {
    if (mbtilesNativeTileCache.has(cacheKey)) {
      mbtilesNativeTileCache.delete(cacheKey);
    }
    mbtilesNativeTileCache.set(cacheKey, dataUrl);
    if (mbtilesNativeTileCache.size > NATIVE_MBTILES_TILE_CACHE_LIMIT) {
      const oldestKey = mbtilesNativeTileCache.keys().next().value;
      if (oldestKey !== undefined) {
        mbtilesNativeTileCache.delete(oldestKey);
      }
    }
    return dataUrl;
  }

  function hexToBase64(hexText) {
    if (typeof hexText !== "string" || hexText.length === 0 || hexText.length % 2 !== 0) {
      return null;
    }

    const bytes = new Uint8Array(hexText.length / 2);
    for (let index = 0; index < hexText.length; index += 2) {
      const byteValue = parseInt(hexText.slice(index, index + 2), 16);
      if (!Number.isFinite(byteValue)) return null;
      bytes[index / 2] = byteValue;
    }

    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    return window.btoa(binary);
  }

  async function ensureNativeMbtilesDatabase() {
    if (!isNativeCapacitorPlatform()) return false;
    if (mbtilesNativeReady) return true;
    if (mbtilesNativeInitPromise) return mbtilesNativeInitPromise;

    mbtilesNativeInitPromise = (async function () {
      const sqlite = getCapacitorSQLitePlugin();
      if (!sqlite) {
        mbtilesNativeFailureReason = "sqlite-plugin-not-found";
        return false;
      }

      try {
        await sqlite.copyFromAssets({ overwrite: false });
      } catch (copyError) {
        console.info("[MBTiles][native] copyFromAssets skipped:", copyError);
      }

      let dbExists = true;
      try {
        const existsResult = await sqlite.isDBExists({ database: MBTILES_DB_NAME, readonly: true });
        dbExists = !!(existsResult && existsResult.result);
      } catch (existsError) {
        console.warn("[MBTiles][native] isDBExists check skipped:", existsError);
      }

      if (!dbExists) {
        mbtilesNativeFailureReason = "mbtiles-db-not-found";
        if (statusEl) statusEl.textContent = "🟠 MBTiles 앱 자산이 없습니다";
        console.warn("[MBTiles][native] asset DB not found:", MBTILES_DB_NAME);
        return false;
      }

      try {
        await sqlite.createConnection({
          database: MBTILES_DB_NAME,
          version: 1,
          encrypted: false,
          mode: "no-encryption",
          readonly: true
        });
      } catch (connectionError) {
        const message = String(connectionError && connectionError.message ? connectionError.message : connectionError);
        if (!/already exists|Connection .* already exists/i.test(message)) {
          throw connectionError;
        }
      }

      try {
        await sqlite.open({ database: MBTILES_DB_NAME, readonly: true });
      } catch (openError) {
        const message = String(openError && openError.message ? openError.message : openError);
        if (!/already open|already opened|database .* is already open/i.test(message)) {
          throw openError;
        }
      }

      mbtilesNativeReady = true;
      mbtilesNativeFailureReason = null;
      return true;
    })().catch(function (error) {
      mbtilesNativeFailureReason = error && error.message ? error.message : String(error);
      console.error("[MBTiles][native] initialization failed:", error);
      if (statusEl) statusEl.textContent = "🟠 MBTiles 앱 로드 실패";
      return false;
    }).finally(function () {
      mbtilesNativeInitPromise = null;
    });

    return mbtilesNativeInitPromise;
  }

  async function getNativeMbtilesTileDataUrl(z, x, y) {
    const cacheKey = z + "/" + x + "/" + y;
    if (mbtilesNativeTileCache.has(cacheKey)) {
      return rememberNativeTileUrl(cacheKey, mbtilesNativeTileCache.get(cacheKey));
    }

    const ready = await ensureNativeMbtilesDatabase();
    if (!ready) return null;

    const sqlite = getCapacitorSQLitePlugin();
    if (!sqlite) return null;

    const tmsRow = (Math.pow(2, z) - 1) - y;
    const queryResult = await sqlite.query({
      database: MBTILES_DB_NAME,
      statement: "SELECT hex(tile_data) AS tile_hex FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=? LIMIT 1",
      values: [z, x, tmsRow],
      readonly: true
    });

    const firstRow = queryResult && Array.isArray(queryResult.values) ? queryResult.values[0] : null;
    const tileHex = firstRow && typeof firstRow === "object"
      ? (firstRow.tile_hex || firstRow.TILE_HEX || null)
      : (Array.isArray(firstRow) ? firstRow[0] : firstRow);
    if (!tileHex) return null;

    const tileBase64 = hexToBase64(tileHex);
    if (!tileBase64) return null;
    return rememberNativeTileUrl(cacheKey, "data:" + MBTILES_MIME_TYPE + ";base64," + tileBase64);
  }

  function mbtilesTileLoadFn(tile, src) {
    const image = tile.getImage();
    if (!image) return;

    const nativeMatch = /^native-mbtiles:\/\/(\d+)\/(\d+)\/(\d+)$/.exec(src || "");
    if (!nativeMatch) {
      image.src = src;
      return;
    }

    getNativeMbtilesTileDataUrl(
      Number(nativeMatch[1]),
      Number(nativeMatch[2]),
      Number(nativeMatch[3])
    ).then(function (dataUrl) {
      image.src = dataUrl || TRANSPARENT_PIXEL;
    }).catch(function (error) {
      console.error("[MBTiles][native] tile load failed:", error, src, mbtilesNativeFailureReason);
      image.src = TRANSPARENT_PIXEL;
    });
  }

  // 요청 타일이 selection 경계 안에 있을 때만 MBTiles URL을 반환한다.
  function mbtilesUrlFn(tileCoord) {
    if (!tileCoord) return TRANSPARENT_PIXEL;
    const rawZoom = tileCoord[0];
    const z = resolveManifestZoom(rawZoom);
    const x = tileCoord[1];
    const y = normalizeXyzY(tileCoord[2]);
    if (mbtilesSelection) {
      const level = mbtilesSelection.levels[String(z)];
      if (!level) return TRANSPARENT_PIXEL;
      if (x < level.minX || x > level.maxX || y < level.minY || y > level.maxY) return TRANSPARENT_PIXEL;
    }
    if (isNativeCapacitorPlatform()) {
      return "native-mbtiles://" + z + "/" + x + "/" + y;
    }
    return "/mbtiles/" + z + "/" + x + "/" + y + ".tile";
  }

  const mbtilesTileGrid = new ol.tilegrid.TileGrid({
    origin: GRID_ORIGIN,
    resolutions: mbtilesResolutions,
    tileSize: TILE_SIZE,
    minZoom: 0
  });

  const mbtilesSource = new ol.source.XYZ({
    projection: MAP_PROJECTION_CODE,
    tileGrid: mbtilesTileGrid,
    minZoom: 0,
    maxZoom: MBTILES_MAX_ZOOM,
    wrapX: false,
    transition: 0,
    tilePixelRatio: 1,
    tileUrlFunction: mbtilesUrlFn,
    tileLoadFunction: mbtilesTileLoadFn,
    attributions: "지리산 오프라인 타일"
  });
  mbtilesSource.on("tileloaderror", function (event) {
    event.tile.getImage().src = TRANSPARENT_PIXEL;
  });

  const mbtilesLayer = new ol.layer.Tile({
    source: mbtilesSource,
    visible: true
  });

  const osmBase = new ol.layer.Tile({
    source: new ol.source.OSM(),
    visible: false
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
    visible: false
  });

  let tileLoadSuccessCount = 0;
  let tileLoadErrorCount = 0;
  let currentBaseLayerType = "mbtiles";
  let lastOnlineViewState = null;

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

  function createHeadingIconDataUri(svgSize, color, circleRadius) {
    const center = svgSize / 2;
    const fillColor = color || "#2b7cff";
    const dotRadius = Number.isFinite(circleRadius) ? circleRadius : 6;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="' + svgSize + '" height="' + svgSize + '" viewBox="0 0 ' + svgSize + ' ' + svgSize + '">' +
        '<path d="M ' + center + ' 4 L ' + (center + 9) + ' ' + (center - 2) + ' L ' + center + ' ' + (center - 6) + ' L ' + (center - 9) + ' ' + (center - 2) + ' Z" fill="' + fillColor + '"/>' +
        '<circle cx="' + center + '" cy="' + (center + 3) + '" r="' + dotRadius + '" fill="' + fillColor + '"/>' +
      '</svg>';

    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  const myLocationSource = new ol.source.Vector();
  let myLocationFeature = null;
  const MY_HEADING_ICON_SIZE = 48;
  const myHeadingIconSrc = createHeadingIconDataUri(MY_HEADING_ICON_SIZE, "#2b7cff", 6);
  const OBSERVATION_HEADING_ICON_SIZE = 40;
  const observationHeadingIconSrc = createHeadingIconDataUri(OBSERVATION_HEADING_ICON_SIZE, "#ea580c", 5.5);
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

  const baseCenterMap = mapCoordFromWgs84(35.315, 127.655);
  //const extentMap = ol.proj.transformExtent(JIRISAN_BOUNDS_WGS84, WGS84_CODE, MAP_PROJECTION_CODE);
  const extentMap = [944865,1669988,1077349,1732849];
  const viewResolutions = build5179ViewResolutions(
    MBTILES_MIN_ZOOM,
    MBTILES_MAX_ZOOM,
    mbtilesResolutions[0]
  );

  const view = new ol.View({
    projection: MAP_PROJECTION_CODE,
    center: baseCenterMap,
    minZoom: MBTILES_MIN_ZOOM,
    maxZoom: MBTILES_MAX_ZOOM,
    resolutions: viewResolutions,
    extent: LOCK_EMPTY_AREA_PAN ? PAN_LIMIT_EXTENT : undefined // 이 한 줄을 주석 처리하면 빈공간 이동 제한 해제
  });

  const map = new ol.Map({
    target: "map",
    layers: [osmBase, topoBase, mbtilesLayer, hillshadeOverlay, bearMarkerLayer, myLocationLayer],
    view: view,
    controls: ol.control.defaults.defaults({
      zoom: false,
      rotate: false,
      attribution: true
    })
  });

  window.__olMap = map;
  window.__olView = view;

  if (isNativeCapacitorPlatform()) {
    ensureNativeMbtilesDatabase();
  }

  // 초기 위치: fit() 호출 (한 번만 실행)
  view.fit(extentMap, {
    padding: [20, 20, 20, 20],
    maxZoom: 14,
    duration: 500
  });
  view.setZoom(9.92);
  window.__initialFitDone = true;

  // 고줌에서 음영이 지저분해지는 것을 막기 위해 확대 시 음영 투명도를 낮춘다.
  function syncHillshadeByZoom() {
    const zoom = view.getZoom();
    if (typeof zoom !== "number") return;
    hillshadeOverlay.setOpacity(zoom >= HILLSHADE_SAFE_MAX_ZOOM ? 0 : HILLSHADE_BASE_OPACITY);
  }

  view.on("change:resolution", syncHillshadeByZoom);
  syncHillshadeByZoom();

  // 디버깅용: 현재 줌/중심/extent를 콘솔에 기록한다.
  function logViewState(reason) {
    const zoom = view.getZoom();
    const center = view.getCenter();
    const size = map.getSize();
    const extent = size ? view.calculateExtent(size) : null;
    const centerWgs84 = wgs84FromMapCoord(center);
    const zoomText = Number.isFinite(zoom) ? zoom.toFixed(2) : String(zoom);
    const latText = centerWgs84 && Number.isFinite(centerWgs84.lat) ? centerWgs84.lat.toFixed(6) : "n/a";
    const lngText = centerWgs84 && Number.isFinite(centerWgs84.lng) ? centerWgs84.lng.toFixed(6) : "n/a";
    const extentText = extent ? "[" + extent.map(v => v.toFixed(0)).join(",") + "]" : "n/a";
    console.log("[Map] " + reason + " | zoom=" + zoomText + " | lat=" + latText + " lng=" + lngText + " | extent=" + extentText);
  }

  map.on("moveend", function () {
    logViewState("moveend");
  });

  function captureCurrentViewState() {
    return {
      center: view.getCenter(),
      zoom: view.getZoom()
    };
  }

  function restoreViewState(state) {
    if (!state || !Array.isArray(state.center)) return false;
    view.animate({
      center: state.center,
      zoom: typeof state.zoom === "number" ? state.zoom : (view.getZoom() || 11),
      duration: 400
    });
    return true;
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

  // MBTiles 커버리지 범위로 뷰를 맞춘다(범위가 비정상일 때는 무시).
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

  // 현재는 오프라인 MBTiles만 허용하고, 필요 시 커버리지 범위로 재정렬한다.
  function setBaseLayer(type) {
    if (type !== "mbtiles") {
      if (statusEl) statusEl.textContent = "ℹ️ 현재는 오프라인 지도만 사용합니다";
      type = "mbtiles";
    }
    if (type === currentBaseLayerType) return;

    if (type === "mbtiles") {
      lastOnlineViewState = captureCurrentViewState();
    }

    osmBase.setVisible(false);
    topoBase.setVisible(false);
    hillshadeOverlay.setVisible(false);
    mbtilesLayer.setVisible(true);

    const moved = fitMbtilesCoverage();
    if (!moved && statusEl) {
      statusEl.textContent = "🟡 오프라인 범위 확인 실패, 기존 위치를 유지합니다";
    }

    currentBaseLayerType = type;
  }

  // 내부 SQLite 초기화. 실패해도 지도 기능은 계속 동작하도록 설계한다.
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
    const target = mapCoordFromWgs84(latlng[0], latlng[1]);
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

  // GPS 샘플에서 속도/방향을 추정해 나침반 보정에 활용한다.
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

  // 급격한 방향 점프를 완화해 시각적으로 안정적인 헤딩을 만든다.
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

  // 디바이스 방향 이벤트를 구독해 헤딩을 계산/보정/적용한다.
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

  function getObservationLabelFromData(obsData) {
    if (!obsData) return "관측점";
    const place = String(obsData.place || "").trim();
    const id = String(obsData.id || "").trim();
    return place || id || "관측점";
  }

  function getObservationMarkerText(obsData) {
    const label = getObservationLabelFromData(obsData);
    return label.length > 10 ? label.slice(0, 10) + "..." : label;
  }

  function getObservationHeadingDeg(obsData) {
    if (!obsData) return null;

    const rawHeading = typeof obsData.heading === "string"
      ? obsData.heading.replace(/[^0-9.-]/g, "")
      : obsData.heading;
    const headingDeg = Number(rawHeading);
    return Number.isFinite(headingDeg) ? headingDeg : null;
  }

  function createObservationStyleFromMarker(marker) {
    const obsData = marker && marker.obsData ? marker.obsData : null;
    const labelText = getObservationMarkerText(obsData);

    return function() {
      const headingDeg = getObservationHeadingDeg(obsData);
      const isSelected = !!(obsData && obsData.isSelected);
      const rotation = Number.isFinite(headingDeg) ? (headingDeg * Math.PI) / 180 : 0;

      const styles = [];

      if (isSelected) {
        styles.push(new ol.style.Style({
          image: new ol.style.Circle({
            radius: 16,
            fill: new ol.style.Fill({ color: "rgba(59,130,246,0.10)" }),
            stroke: new ol.style.Stroke({ color: "rgba(59,130,246,0.86)", width: 3 })
          })
        }));
      }

      styles.push(new ol.style.Style({
          image: new ol.style.Icon({
            src: observationHeadingIconSrc,
            width: OBSERVATION_HEADING_ICON_SIZE,
            height: OBSERVATION_HEADING_ICON_SIZE,
            anchor: [0.5, 0.5],
            anchorXUnits: "fraction",
            anchorYUnits: "fraction",
            rotateWithView: true,
            rotation: rotation
          }),
          text: new ol.style.Text({
            text: labelText,
            offsetY: -18,
            padding: [4, 8, 4, 8],
            font: "700 11px sans-serif",
            fill: new ol.style.Fill({ color: "rgba(255,255,255,0.95)" }),
            backgroundFill: new ol.style.Fill({ color: isSelected ? "rgba(194,65,12,0.84)" : "rgba(194,65,12,0.58)" }),
            backgroundStroke: new ol.style.Stroke({ color: isSelected ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)", width: isSelected ? 1.6 : 1.25 })
          })
        }));

      return styles;
    };
  }

  const observationPopupEl = document.createElement("div");
  observationPopupEl.style.position = "relative";
  observationPopupEl.style.minWidth = "180px";
  observationPopupEl.style.maxWidth = "240px";
  observationPopupEl.style.padding = "12px 14px";
  observationPopupEl.style.borderRadius = "14px";
  observationPopupEl.style.background = "rgba(255,255,255,0.97)";
  observationPopupEl.style.boxShadow = "0 12px 28px rgba(15,23,42,0.22)";
  observationPopupEl.style.border = "1px solid rgba(194,65,12,0.18)";
  observationPopupEl.style.color = "#1f2937";
  observationPopupEl.style.fontSize = "13px";
  observationPopupEl.style.lineHeight = "1.5";
  observationPopupEl.style.pointerEvents = "auto";
  observationPopupEl.style.display = "none";
  observationPopupEl.style.zIndex = "10030";

  const observationPopupCloseEl = document.createElement("button");
  observationPopupCloseEl.type = "button";
  observationPopupCloseEl.textContent = "X";
  observationPopupCloseEl.setAttribute("aria-label", "관측점 정보 닫기");
  observationPopupCloseEl.style.position = "absolute";
  observationPopupCloseEl.style.top = "6px";
  observationPopupCloseEl.style.right = "8px";
  observationPopupCloseEl.style.border = "0";
  observationPopupCloseEl.style.background = "transparent";
  observationPopupCloseEl.style.color = "#9a3412";
  observationPopupCloseEl.style.fontSize = "18px";
  observationPopupCloseEl.style.lineHeight = "1";
  observationPopupCloseEl.style.cursor = "pointer";

  const observationPopupContentEl = document.createElement("div");
  //observationPopupContentEl.style.paddingRight = "16px";

  observationPopupEl.appendChild(observationPopupCloseEl);
  observationPopupEl.appendChild(observationPopupContentEl);

  const observationPopupOverlay = new ol.Overlay({
    element: observationPopupEl,
    positioning: "bottom-center",
    offset: [0, -18],
    stopEvent: true
  });
  map.addOverlay(observationPopupOverlay);

  function syncObservationPopupPlacement() {
    const obsSheet = document.getElementById("obs-sheet");
    const isMobile = window.matchMedia && window.matchMedia("(max-width: 820px)").matches;
    const isListVisible = !!(obsSheet && !obsSheet.classList.contains("hidden"));

    if (isMobile && isListVisible) {
      observationPopupOverlay.setPositioning("top-center");
      observationPopupOverlay.setOffset([0, 18]);
      observationPopupEl.style.maxWidth = "220px";
      return;
    }

    observationPopupOverlay.setPositioning("bottom-center");
    observationPopupOverlay.setOffset([0, -18]);
    observationPopupEl.style.maxWidth = "240px";
  }

  function openObservationPopup(feature) {
    const popupHtml = feature && feature.get("popupHtml");
    const coordinate = feature && feature.getGeometry() ? feature.getGeometry().getCoordinates() : null;
    if (!popupHtml || !coordinate) return;

    syncObservationPopupPlacement();
    observationPopupContentEl.innerHTML = popupHtml;
    observationPopupEl.style.display = "block";
    observationPopupOverlay.setPosition(coordinate);
  }

  function closeObservationPopup() {
    observationPopupEl.style.display = "none";
    observationPopupOverlay.setPosition(undefined);
  }

  observationPopupCloseEl.addEventListener("click", function () {
    closeObservationPopup();
  });

  window.addEventListener("resize", function () {
    syncObservationPopupPlacement();
  });

  map.on("singleclick", function (event) {
    let clickedObservation = false;

    map.forEachFeatureAtPixel(event.pixel, function (feature, layer) {
      if (layer !== observationMarkerLayer) return undefined;
      clickedObservation = true;
      openObservationPopup(feature);
      return feature;
    }, {
      hitTolerance: 8
    });

    if (!clickedObservation) {
      closeObservationPopup();
    }
  });

  // 왼쪽 클릭 좌표 로깅
  map.on("singleclick", function (event) {
    const coord = event.coordinate;
    const coordWgs84 = wgs84FromMapCoord(coord);
    const xText = Number.isFinite(coord[0]) ? coord[0].toFixed(2) : String(coord[0]);
    const yText = Number.isFinite(coord[1]) ? coord[1].toFixed(2) : String(coord[1]);
    const latText = coordWgs84 && Number.isFinite(coordWgs84.lat) ? coordWgs84.lat.toFixed(6) : "n/a";
    const lngText = coordWgs84 && Number.isFinite(coordWgs84.lng) ? coordWgs84.lng.toFixed(6) : "n/a";
    console.log("[Left Click] x=" + xText + " y=" + yText + " | lat=" + latText + " lng=" + lngText);
  });


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
        _popupHtml: "",
        obsData: null,
        bindPopup: function (html) {
          this._popupHtml = typeof html === "string" ? html : "";
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
      closeObservationPopup();
    }
  };

  const observationMarkersLayer = {
    clearLayers: function () {
      observationMarkerSource.clear();
    },
    addLayer: function (marker) {
      if (!marker || !Array.isArray(marker._latlng)) return;

      const coord = mapCoordFromWgs84(marker._latlng[0], marker._latlng[1]);
      const feature = new ol.Feature({ geometry: new ol.geom.Point(coord) });
      marker._feature = feature;
      feature.set("popupHtml", marker._popupHtml || "");
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
    onGpsToggle: function() { toggleMyLocation(); }, // 등록 폼 GPS 토글 ↔ 하단 내위치 버튼 동기화
    onObservationSaved: async function (payload) {
      if (!obsListModule || !payload || !payload.observation) return;

      obsListModule.openList();
      if (payload.source === "sqlite") {
        await obsListModule.refreshObservationList();
      } else {
        obsListModule.addObservation(payload.observation);
      }
    },
    onClose: function () {
      if (obsListModule) obsListModule.deactivate();
    }
  }) : null;

  // 내 위치 피처를 갱신하고 최초 1회만 현재 위치로 카메라를 이동한다.
  function updateMyLocation(lat, lng) {
    const coord = mapCoordFromWgs84(lat, lng);
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

  // 위치 추적 시작: 빠른 1회 획득 + watchPosition 지속 추적.
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

  // 우하단 컨트롤(지리산 이동, 내 위치, 줌) UI를 동적으로 마운트한다.
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
        if (!fitMbtilesCoverage()) {
          view.fit(extentMap, { padding: [20, 20, 20, 20], maxZoom: 14, duration: 450 });
        }
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
      const next = Math.min(MBTILES_MAX_ZOOM, current + 1);
      view.animate({ zoom: next, duration: 180 });
    });
    btnZoomIn.style.fontSize = "19px";
    btnZoomIn.style.fontWeight = "700";

    const btnZoomOut = makeBtn("ol-zoom-out-btn", "축소", "-", function () {
      const current = view.getZoom() || 0;
      const next = Math.max(MBTILES_MIN_ZOOM, current - 1);
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

  // 우상단 레이어 패널 UI를 구성한다(현재는 오프라인 지도 선택만 활성).
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
    radioOsm.disabled = true;

    const labelOsm = document.createElement("label");
    labelOsm.style.cursor = "pointer";
    labelOsm.textContent = "인터넷 기본도(준비중)";
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
    radioTopo.disabled = true;

    const labelTopo = document.createElement("label");
    //labelTopo.style.cursor = "pointer";
    //labelTopo.textContent = "지형도(준비중)";
    //rowTopo.appendChild(radioTopo);
    //rowTopo.appendChild(labelTopo);

    const rowMbtiles = document.createElement("div");
    rowMbtiles.style.display = "flex";
    rowMbtiles.style.alignItems = "center";
    rowMbtiles.style.gap = "8px";
    rowMbtiles.style.marginBottom = "2px";

    const radioMbtiles = document.createElement("input");
    radioMbtiles.type = "radio";
    radioMbtiles.name = "ol-base-layer";
    radioMbtiles.value = "mbtiles";
    radioMbtiles.checked = true;

    const labelMbtiles = document.createElement("label");
    labelMbtiles.style.cursor = "pointer";
    labelMbtiles.textContent = "오프라인 기본도(5179)";
    rowMbtiles.appendChild(radioMbtiles);
    rowMbtiles.appendChild(labelMbtiles);

    function syncBaseByRadio() {
      if (radioTopo.checked) return setBaseLayer("topo");
      if (radioMbtiles.checked) return setBaseLayer("mbtiles");
      setBaseLayer("osm");
    }

    radioOsm.addEventListener("change", syncBaseByRadio);
    radioTopo.addEventListener("change", syncBaseByRadio);
    radioMbtiles.addEventListener("change", syncBaseByRadio);
    labelOsm.addEventListener("click", function () { radioOsm.checked = true; syncBaseByRadio(); });
    labelTopo.addEventListener("click", function () { radioTopo.checked = true; syncBaseByRadio(); });
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
      hillshadeOverlay.setVisible(chk.checked);
    });

    // const txt = document.createElement("span");
    // txt.textContent = "음영(Hillshade, 준비중)";
    // row2.appendChild(chk);
    // row2.appendChild(txt);

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

    //토글 버튼 활성/비활성 시 주석처리
    //root.appendChild(toggleBtn);

    panel.appendChild(rowMbtiles);
    panel.appendChild(row1);
    panel.appendChild(rowTopo);
    panel.appendChild(row2);
    root.appendChild(panel);
    mapEl.appendChild(root);
  }

  // 샘플 곰 데이터 JSON을 비캐시 모드로 로드한다.
  async function loadBearsData() {
    try {
      const res = await fetch("json/bears.json", { cache: "no-store" });
      bearsDataCache = await res.json();
    } catch (e) {
      console.error("bears.json 로드 실패:", e);
      bearsDataCache = [];
    }
  }

  // 곰 데이터의 basePoints 주변으로 샘플 추정 좌표를 생성한다.
  function makeBearEstimateSamples() {
    if (!bearsDataCache.length) return [];
    const picked = bearsDataCache.slice().sort(function () {
      return Math.random() - 0.5;
    });

    return picked.map(function (bearRecord) {
      const basePoint = bearRecord.basePoints[Math.floor(Math.random() * bearRecord.basePoints.length)];
      const bearCode = bearRecord.bear_code || bearRecord.id || "-";
      return {
        bearCode: bearCode,
        name: bearRecord.name,
        lat: +(basePoint.lat + (Math.random() - 0.5) * 0.008).toFixed(6),
        lng: +(basePoint.lng + (Math.random() - 0.5) * 0.008).toFixed(6),
        ts: Date.now()
      };
    });
  }

  // 추정 좌표를 지도 마커 레이어로 렌더링한다.
  function renderBearMarkers(items) {
    bearMarkerSource.clear();
    if (!items || !items.length) return;

    items.forEach(function (it) {
      const feature = new ol.Feature({
        geometry: new ol.geom.Point(mapCoordFromWgs84(it.lat, it.lng))
      });

      feature.setStyle(new ol.style.Style({
        image: new ol.style.Icon({
          src: "assets/icons/icon_bear.png",
          anchor: [0.5, 1],
          width: 34,
          height: 34
        }),
        text: new ol.style.Text({
          text: String(it.bearCode || it.id || "-"),
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
          '<div><b>' + (it.bearCode || it.id || "-") + '</b></div>' +
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

  // 곰 목록 패널/마커를 동기화한다. 초기 시점 보존을 위해 자동 fit은 하지 않는다.
  async function refreshBearEstimatePanel() {
    if (statusEl) statusEl.textContent = "🐻 곰 추정위치 계산중…";

    await loadBearsData();
    const items = makeBearEstimateSamples();
    renderBears(items);
    renderBearMarkers(items);

    if (!items.length) {
      if (statusEl) statusEl.textContent = "🟠 표시할 곰 추정위치가 없습니다";
      return;
    }

    // 초기 진입 시 사용자 시점을 보존하기 위해 자동 fit은 비활성화한다.

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
  refreshBearEstimatePanel();

  setTimeout(function () {
    if (!statusEl) return;
    if (tileLoadSuccessCount === 0 && tileLoadErrorCount === 0) {
      //statusEl.textContent = "🟠 타일 요청 없음 (지도 초기화/레이어 설정 확인)";
      statusEl.textContent = "🟠 타일 요청 없음";
      return;
    }
    if (tileLoadSuccessCount === 0 && tileLoadErrorCount > 0) {
      //statusEl.textContent = "🟠 타일 요청 실패 " + tileLoadErrorCount + "건";
      statusEl.textContent = "🟠 타일 요청 실패 ";
    }
  }, 5000);
  } catch (error) {
    console.error("client-ol.js 초기화 오류:", error);
    if (statusEl) {
      statusEl.textContent = "🔴 오류: " + (error && error.message ? error.message : String(error));
    }
  }
})();
