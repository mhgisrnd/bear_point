// public/js/client-ol.js
// OpenLayers mode using existing obs modules

(function initOpenLayersMode() {
  const statusEl = document.getElementById("status");
  const mapEl = document.getElementById("map");
  const compassNeedleFixedEl = document.getElementById("compass-needle");
  const panelEl = document.getElementById("panel");
  const btnPanelToggle = document.getElementById("btn-panel-toggle");
  const bearsListEl = document.getElementById("bears-list");
  const bearsToolbarEl = document.getElementById("bears-toolbar");
  const bearsSelectAllEl = document.getElementById("bears-select-all");
  const bearsSelectionCountEl = document.getElementById("bears-selection-count");
  const btnBearsDeleteSelectedEl = document.getElementById("btn-bears-delete-selected");
  const currentCoordEl = document.getElementById("obs-current-coord");
  const currentHeadingEl = document.getElementById("obs-current-heading");
  const searchParams = new URLSearchParams(window.location.search);
  let removeBackButtonListener = null;
  let exitConfirmOpen = false;
  let startupOverlayEl = null;
  let startupOverlayTextEl = null;
  let startupOverlayRetryBtn = null;
  let currentBearEstimateItems = [];
  let currentBearEstimateFallbackMode = false;
  const selectedBearEstimateIds = new Set();

  try {

  if (!window.ol || !mapEl) {
    if (statusEl) statusEl.textContent = "OpenLayers 로딩 실패";
    return;
  }

  // 앱 시작 시 SQLite 준비가 끝날 때까지 화면 입력을 잠그는 오버레이를 표시한다.
  function ensureStartupOverlay() {
    if (startupOverlayEl) return;

    const overlay = document.createElement("div");
    overlay.style.position = "fixed";
    overlay.style.inset = "0";
    overlay.style.zIndex = "5000";
    overlay.style.display = "none";
    overlay.style.alignItems = "center";
    overlay.style.justifyContent = "center";
    overlay.style.background = "rgba(13,18,30,0.74)";
    overlay.style.backdropFilter = "blur(2px)";

    const card = document.createElement("div");
    card.style.width = "min(78vw, 320px)";
    card.style.background = "rgba(16,26,45,0.96)";
    card.style.border = "1px solid rgba(255,255,255,0.22)";
    card.style.borderRadius = "14px";
    card.style.padding = "16px 16px 14px";
    card.style.boxShadow = "0 16px 36px rgba(0,0,0,0.34)";

    const title = document.createElement("div");
    title.textContent = "앱 준비 중";
    title.style.color = "#ffffff";
    title.style.fontWeight = "700";
    title.style.fontSize = "15px";
    title.style.marginBottom = "8px";

    const text = document.createElement("div");
    text.textContent = "SQLite 연결 준비 중...";
    text.style.color = "rgba(255,255,255,0.88)";
    text.style.fontSize = "13px";
    text.style.marginBottom = "10px";

    const barTrack = document.createElement("div");
    barTrack.style.height = "6px";
    barTrack.style.width = "100%";
    barTrack.style.background = "rgba(255,255,255,0.16)";
    barTrack.style.borderRadius = "999px";
    barTrack.style.overflow = "hidden";

    const bar = document.createElement("div");
    bar.style.height = "100%";
    bar.style.width = "42%";
    bar.style.borderRadius = "999px";
    bar.style.background = "linear-gradient(90deg, #3ea2ff, #7bd6ff)";
    bar.style.animation = "bpStartLoading 1.05s ease-in-out infinite";

    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.textContent = "다시 시도";
    retryBtn.style.display = "none";
    retryBtn.style.marginTop = "12px";
    retryBtn.style.width = "100%";
    retryBtn.style.height = "36px";
    retryBtn.style.border = "1px solid rgba(255,255,255,0.35)";
    retryBtn.style.borderRadius = "9px";
    retryBtn.style.background = "#0b72c7";
    retryBtn.style.color = "#ffffff";
    retryBtn.style.fontWeight = "700";
    retryBtn.style.cursor = "pointer";

    barTrack.appendChild(bar);
    card.appendChild(title);
    card.appendChild(text);
    card.appendChild(barTrack);
    card.appendChild(retryBtn);
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const styleEl = document.createElement("style");
    styleEl.textContent = "@keyframes bpStartLoading { 0% { transform: translateX(-115%); } 100% { transform: translateX(250%); } }";
    document.head.appendChild(styleEl);

    startupOverlayEl = overlay;
    startupOverlayTextEl = text;
    startupOverlayRetryBtn = retryBtn;
  }

  function showStartupOverlay(message, allowRetry) {
    ensureStartupOverlay();
    if (startupOverlayTextEl && typeof message === "string" && message) {
      startupOverlayTextEl.textContent = message;
    }
    if (startupOverlayRetryBtn) {
      startupOverlayRetryBtn.style.display = allowRetry ? "block" : "none";
    }
    if (startupOverlayEl) startupOverlayEl.style.display = "flex";
  }

  function hideStartupOverlay() {
    if (!startupOverlayEl) return;
    startupOverlayEl.style.display = "none";
  }

  async function bootWithSQLiteGate() {
    showStartupOverlay("SQLite 연결 준비 중...", false);

    try {
      const initState = await initializeEmbeddedDatabase();
      if (!initState || !initState.ready) {
        const reason = initState && initState.reason ? String(initState.reason) : "not-ready";
        // 웹(non-native)에서는 JSON 폴백 목록을 렌더링한 뒤 화면을 연다.
        if (reason === "non-native-platform") {
          await refreshBearEstimatePanel();
          hideStartupOverlay();
          return;
        }
        throw new Error(reason);
      }

      await refreshBearEstimatePanel();
      hideStartupOverlay();
    } catch (error) {
      console.error("SQLite 초기화 오류:", error);
      if (statusEl) {
        statusEl.textContent = "🔴 SQLite 초기화 실패: " + (error && error.message ? error.message : String(error));
      }
      showStartupOverlay("SQLite 준비 실패. 다시 시도해 주세요.", true);
    }
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
  // 구형 TM 비교 출력용(중부원점 계열) 좌표계. 지도 내부 계산은 계속 EPSG:5179를 사용한다.
  const LEGACY_TM_PROJECTION_CODE = "EPSG:5181";
  const WGS84_CODE = "EPSG:4326";
  const TILE_SIZE = 256;
  const NGII_RESOLUTION_BASE_ZOOM = 5;
  const MBTILES_MIN_ZOOM = 7;
  const MBTILES_MAX_ZOOM = 17;
  const MBTILES_DB_NAME = "korea-selection2-z7-z17-webp";
  const MBTILES_MIME_TYPE = "image/webp";
  // NGII 키 우선순위: URL 파라미터 > 전역 변수(window.NGII_API_KEY) > 기본 키.
  const NGII_DEFAULT_API_KEY = "956C9092B0E5DEDA2C6E61D92348A1FB53B88399E1";
  const NGII_API_KEY = String(searchParams.get("ngiiApiKey") || window.NGII_API_KEY || NGII_DEFAULT_API_KEY || "").trim();
  const NGII_BASE_LAYER_ID = "korean_map"; //기본 국문 타일
  const DEFAULT_BASE_LAYER_TYPE = NGII_API_KEY ? "osm" : "mbtiles";
  const OFFLINE_INITIAL_ZOOM = 9.92;
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
  const ONLINE_MAX_ZOOM = VIEW_MAX_ZOOM;
  const BEAR_LABEL_OFFSET_Y = 12;
  const ESTIMATE_LABEL_OFFSET_Y = 18;
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
  // 주의: EPSG:5181은 Bessel 경위도(BL)가 아니라 TM 평면좌표계다.
  // BL(베셀 경위도) 직접 표기가 필요하면 별도 타원체/datum 변환 단계를 추가해야 한다.
  window.proj4.defs(
    LEGACY_TM_PROJECTION_CODE,
    "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs +type=crs"
  );
  ol.proj.proj4.register(window.proj4);

  // WGS84(위경도) -> EPSG:5179(미터 좌표) 변환.
  function mapCoordFromWgs84(lat, lng) {
    return ol.proj.transform([lng, lat], WGS84_CODE, MAP_PROJECTION_CODE);
  }

  // 비교 출력용: WGS84(위경도) -> EPSG:5181(TM) 변환.
  function legacyTmCoordFromWgs84(lat, lng) {
    return ol.proj.transform([lng, lat], WGS84_CODE, LEGACY_TM_PROJECTION_CODE);
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
  const NGII_GRID_MAX_ZOOM = NGII_RESOLUTION_BASE_ZOOM + GRID_RESOLUTIONS.length - 1;
  const NGII_ONLINE_MAX_ZOOM = Math.min(ONLINE_MAX_ZOOM, NGII_GRID_MAX_ZOOM);
  const ngiiOnlineResolutions = buildNgiiResolutions(MBTILES_MIN_ZOOM, NGII_ONLINE_MAX_ZOOM);
  if (!ngiiOnlineResolutions) {
    if (statusEl) statusEl.textContent = "NGII 해상도 범위 오류";
    return;
  }

  let locateBtnEl = null;
  let watchId = null;
  let isMyVisible = false;
  let didMoveToMe = false;
  let lastLatLng = null;
  let lastTrackedLatLng = null;
  let lastGpsTimestamp = null;
  let bearsDataCache = []; // 웹 폴백용 곰 추정위치 JSON 캐시
  let compassEnabled = false;
  let compassHandler = null;
  let compassEventName = null;
  let headingSmoothed = null;
  let lastHeadingDeg = null;
  let lastTrackedHeadingDeg = null;
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

  function getCapacitorFilesystemPlugin() {
    const capacitor = window.Capacitor;
    if (!capacitor || !capacitor.Plugins) return null;
    return capacitor.Plugins.Filesystem || null;
  }

  function getCapacitorSharePlugin() {
    const capacitor = window.Capacitor;
    if (!capacitor || !capacitor.Plugins) return null;
    return capacitor.Plugins.Share || null;
  }

  function getCapacitorNativeTxtSharePlugin() {
    const capacitor = window.Capacitor;
    if (!capacitor) return null;
    // Capacitor v6+ 는 registerPlugin()으로 JS 측에도 등록해야 플러그인 접근 가능
    if (typeof capacitor.registerPlugin === "function") {
      try {
        const plugin = capacitor.registerPlugin("NativeTxtShare");
        if (plugin && typeof plugin.shareTxtFile === "function") return plugin;
      } catch (e) { /* ignore */ }
    }
    // 구버전 fallback
    if (capacitor.Plugins) return capacitor.Plugins.NativeTxtShare || null;
    return null;
  }

  function openSavedFileLink(uriValue) {
    if (!uriValue) return false;
    try {
      const capacitor = window.Capacitor;
      const link = (capacitor && typeof capacitor.convertFileSrc === "function")
        ? capacitor.convertFileSrc(uriValue)
        : uriValue;
      const a = document.createElement("a");
      a.href = link;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    } catch (error) {
      console.warn("저장 파일 링크 열기 실패:", error);
      return false;
    }
  }

  async function ensureFileUriForShare(fileName, uriCandidate, txtContent) {
    if (uriCandidate && /^file:/i.test(String(uriCandidate))) {
      return String(uriCandidate);
    }

    const filesystem = getCapacitorFilesystemPlugin();
    if (!filesystem || typeof filesystem.writeFile !== "function") {
      return uriCandidate || null;
    }

    try {
      const cachePath = "BearMapShare/" + fileName;
      await filesystem.writeFile({
        path: cachePath,
        data: txtContent || "",
        directory: "CACHE",
        encoding: "utf8",
        recursive: true
      });

      if (typeof filesystem.getUri === "function") {
        const uriRes = await filesystem.getUri({ path: cachePath, directory: "CACHE" });
        const cacheUri = uriRes && uriRes.uri ? String(uriRes.uri) : null;
        if (cacheUri && /^file:/i.test(cacheUri)) {
          return cacheUri;
        }
      }
    } catch (cacheError) {
      console.warn("공유용 캐시 파일 준비 실패:", cacheError);
    }

    return uriCandidate || null;
  }

  async function shareSavedTxtFile(fileName, savedUri, txtContent) {
    const nativeTxtShare = getCapacitorNativeTxtSharePlugin();
    const sharePlugin = getCapacitorSharePlugin();

    // 네이티브 플러그인이 있으면 파일 내용을 직접 넘긴다.
    // Java가 Cache에 직접 쓰고 FileProvider content:// URI로 공유하므로 경로 해석 실패 없음.
    if (nativeTxtShare && typeof nativeTxtShare.shareTxtFile === "function") {
      try {
        await nativeTxtShare.shareTxtFile({
          fileName: fileName,
          txtContent: txtContent || "",
          dialogTitle: "TXT 공유"
        });
        if (statusEl) statusEl.textContent = "✅ 공유 창을 열었습니다: " + fileName;
        return true;
      } catch (shareError) {
        console.warn("TXT 공유 실패:", shareError);
        if (statusEl) {
          statusEl.textContent = "🔴 공유 실패: " + (shareError && shareError.message ? shareError.message : String(shareError));
        }
        return false;
      }
    }

    // fallback: @capacitor/share (웹/데스크톱)
    if (!sharePlugin || typeof sharePlugin.share !== "function") {
      if (statusEl) statusEl.textContent = "⚠️ 공유 플러그인이 없습니다.";
      return false;
    }
    const fileUri = await ensureFileUriForShare(fileName, savedUri, txtContent);
    if (!fileUri || !/^file:/i.test(String(fileUri))) {
      if (statusEl) statusEl.textContent = "⚠️ 공유할 파일 경로를 찾지 못했습니다.";
      return false;
    }
    try {
      await sharePlugin.share({ title: fileName, files: [fileUri], dialogTitle: "TXT 공유" });
      if (statusEl) statusEl.textContent = "✅ 공유 창을 열었습니다: " + fileName;
      return true;
    } catch (shareError) {
      console.warn("TXT 공유 실패:", shareError);
      if (statusEl) {
        statusEl.textContent = "🔴 공유 실패: " + (shareError && shareError.message ? shareError.message : String(shareError));
      }
      return false;
    }
  }

  async function saveTxtToNativeDocuments(fileName, txtContent) {
    const filesystem = getCapacitorFilesystemPlugin();
    if (!filesystem || typeof filesystem.writeFile !== "function") {
      if (statusEl) statusEl.textContent = "⚠️ TXT 저장 플러그인이 없습니다. 앱을 다시 빌드해 주세요.";
      return null;
    }

    const relativePath = "BearMap/" + fileName;
    await filesystem.writeFile({
      path: relativePath,
      data: txtContent,
      directory: "DOCUMENTS",
      encoding: "utf8",
      recursive: true
    });

    let savedUri = null;
    if (typeof filesystem.getUri === "function") {
      try {
        const uriRes = await filesystem.getUri({ path: relativePath, directory: "DOCUMENTS" });
        savedUri = uriRes && uriRes.uri ? uriRes.uri : null;
      } catch (uriError) {
        console.warn("저장 파일 URI 조회 실패:", uriError);
      }
    }

    if (statusEl) statusEl.textContent = "✅ TXT 저장 완료: Documents/BearMap/" + fileName;

    return {
      relativePath: relativePath,
      savedUri: savedUri
    };
  }

  async function getNativeTxtUriIfExists(fileName) {
    const filesystem = getCapacitorFilesystemPlugin();
    if (!filesystem || typeof filesystem.stat !== "function") return null;

    const relativePath = "BearMap/" + fileName;

    try {
      await filesystem.stat({
        path: relativePath,
        directory: "DOCUMENTS"
      });

      let savedUri = null;
      if (typeof filesystem.getUri === "function") {
        try {
          const uriRes = await filesystem.getUri({ path: relativePath, directory: "DOCUMENTS" });
          savedUri = uriRes && uriRes.uri ? uriRes.uri : null;
        } catch (uriError) {
          console.warn("기존 파일 URI 조회 실패:", uriError);
        }
      }

      return {
        relativePath: relativePath,
        savedUri: savedUri
      };
    } catch (error) {
      return null;
    }
  }

  // 저장 완료 후 동작을 선택하는 미니 팝업 (미리보기 / 공유하기 / 닫기)
  function showSavedFileActionPopup(fileName) {
    return new Promise(function (resolve) {
      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "23050";
      overlay.style.background = "rgba(15,23,42,0.35)";
      overlay.style.display = "flex";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.pointerEvents = "auto";

      const card = document.createElement("div");
      card.style.position = "relative";
      card.style.zIndex = "1";
      card.style.width = "min(86vw, 320px)";
      card.style.background = "#ffffff";
      card.style.border = "1px solid rgba(15,23,42,0.12)";
      card.style.borderRadius = "12px";
      card.style.boxShadow = "0 14px 34px rgba(15,23,42,0.28)";
      card.style.padding = "12px";

      const header = document.createElement("div");
      header.style.display = "flex";
      header.style.alignItems = "center";
      header.style.justifyContent = "space-between";
      header.style.marginBottom = "8px";

      const title = document.createElement("div");
      title.textContent = "TXT 저장 완료";
      title.style.fontSize = "14px";
      title.style.fontWeight = "700";
      title.style.color = "#0f172a";

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "×";
      closeBtn.style.width = "28px";
      closeBtn.style.height = "28px";
      closeBtn.style.border = "1px solid rgba(15,23,42,0.18)";
      closeBtn.style.borderRadius = "8px";
      closeBtn.style.background = "#ffffff";
      closeBtn.style.fontSize = "18px";
      closeBtn.style.lineHeight = "1";
      closeBtn.style.cursor = "pointer";

      const nameText = document.createElement("div");
      nameText.textContent = fileName || "bear_estimate.txt";
      nameText.style.fontSize = "11px";
      nameText.style.color = "#64748b";
      nameText.style.marginBottom = "10px";
      nameText.style.whiteSpace = "nowrap";
      nameText.style.overflow = "hidden";
      nameText.style.textOverflow = "ellipsis";

      const btnRow = document.createElement("div");
      btnRow.style.display = "grid";
      btnRow.style.gridTemplateColumns = "1fr 1fr";
      btnRow.style.gap = "8px";

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.textContent = "미리보기";
      openBtn.style.height = "36px";
      openBtn.style.border = "1px solid #0ea5e9";
      openBtn.style.borderRadius = "9px";
      openBtn.style.background = "#f0f9ff";
      openBtn.style.color = "#0369a1";
      openBtn.style.fontWeight = "700";
      openBtn.style.cursor = "pointer";

      const shareBtn = document.createElement("button");
      shareBtn.type = "button";
      shareBtn.textContent = "공유하기";
      shareBtn.style.height = "36px";
      shareBtn.style.border = "1px solid #16a34a";
      shareBtn.style.borderRadius = "9px";
      shareBtn.style.background = "#f0fdf4";
      shareBtn.style.color = "#166534";
      shareBtn.style.fontWeight = "700";
      shareBtn.style.cursor = "pointer";

      function closeWith(action) {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(action || null);
      }

      closeBtn.addEventListener("click", function () { closeWith(null); });
      openBtn.addEventListener("click", function () { closeWith("open"); });
      shareBtn.addEventListener("click", function () { closeWith("share"); });

      header.appendChild(title);
      header.appendChild(closeBtn);
      btnRow.appendChild(openBtn);
      btnRow.appendChild(shareBtn);
      card.appendChild(header);
      card.appendChild(nameText);
      card.appendChild(btnRow);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    });
  }

  function showSavedTxtPreviewPopup(options) {
    return new Promise(function (resolve) {
      const fileName = options && options.fileName ? options.fileName : "bear_estimate.txt";
      const txtContent = options && typeof options.txtContent === "string" ? options.txtContent : "";
      const savedUri = options && options.savedUri ? options.savedUri : null;
      const onSave = options && typeof options.onSave === "function" ? options.onSave : null;
      const onShare = options && typeof options.onShare === "function" ? options.onShare : null;

      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.zIndex = "23060";
      overlay.style.background = "rgba(15,23,42,0.45)";
      overlay.style.display = "flex";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.padding = "calc(env(safe-area-inset-top, 0px) + 18px) 18px calc(env(safe-area-inset-bottom, 0px) + 18px)";

      const card = document.createElement("div");
      card.style.width = "min(92vw, 520px)";
      card.style.maxHeight = "calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 36px)";
      card.style.display = "flex";
      card.style.flexDirection = "column";
      card.style.background = "#0f172a";
      card.style.color = "#e2e8f0";
      card.style.borderRadius = "16px";
      card.style.boxShadow = "0 18px 40px rgba(2,6,23,0.45)";
      card.style.overflow = "hidden";
      card.style.border = "1px solid rgba(148,163,184,0.22)";

      const header = document.createElement("div");
      header.style.display = "flex";
      header.style.alignItems = "center";
      header.style.justifyContent = "space-between";
      header.style.padding = "14px 14px 10px";
      header.style.borderBottom = "1px solid rgba(148,163,184,0.14)";

      const titleWrap = document.createElement("div");
      titleWrap.style.minWidth = "0";

      const title = document.createElement("div");
      title.textContent = "TXT 미리보기";
      title.style.fontSize = "15px";
      title.style.fontWeight = "700";
      title.style.color = "#f8fafc";

      const subtitle = document.createElement("div");
      subtitle.textContent = fileName;
      subtitle.style.fontSize = "11px";
      subtitle.style.color = "#94a3b8";
      subtitle.style.marginTop = "3px";
      subtitle.style.whiteSpace = "nowrap";
      subtitle.style.overflow = "hidden";
      subtitle.style.textOverflow = "ellipsis";

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.textContent = "×";
      closeBtn.style.width = "32px";
      closeBtn.style.height = "32px";
      closeBtn.style.border = "1px solid rgba(148,163,184,0.24)";
      closeBtn.style.borderRadius = "10px";
      closeBtn.style.background = "rgba(255,255,255,0.06)";
      closeBtn.style.color = "#f8fafc";
      closeBtn.style.fontSize = "20px";
      closeBtn.style.cursor = "pointer";

      const body = document.createElement("pre");
      body.textContent = txtContent;
      body.style.margin = "0";
      body.style.padding = "14px";
      body.style.flex = "1 1 auto";
      body.style.overflow = "auto";
      body.style.background = "#020617";
      body.style.color = "#e2e8f0";
      body.style.fontSize = "12px";
      body.style.lineHeight = "1.55";
      body.style.fontFamily = "Consolas, 'Courier New', monospace";
      body.style.whiteSpace = "pre-wrap";
      body.style.wordBreak = "break-word";

      const footer = document.createElement("div");
      footer.style.display = "grid";
      footer.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
      footer.style.gap = "8px";
      footer.style.padding = "12px 14px 14px";
      footer.style.borderTop = "1px solid rgba(148,163,184,0.14)";
      footer.style.background = "#0b1220";

      const previewSaveBtn = document.createElement("button");
      previewSaveBtn.type = "button";
      previewSaveBtn.textContent = "저장하기";
      previewSaveBtn.style.height = "38px";
      previewSaveBtn.style.border = "1px solid #f59e0b";
      previewSaveBtn.style.borderRadius = "10px";
      previewSaveBtn.style.background = "#fef3c7";
      previewSaveBtn.style.color = "#92400e";
      previewSaveBtn.style.fontWeight = "700";
      previewSaveBtn.style.cursor = "pointer";

      const previewShareBtn = document.createElement("button");
      previewShareBtn.type = "button";
      previewShareBtn.textContent = "공유하기";
      previewShareBtn.style.height = "38px";
      previewShareBtn.style.border = "1px solid #16a34a";
      previewShareBtn.style.borderRadius = "10px";
      previewShareBtn.style.background = "#dcfce7";
      previewShareBtn.style.color = "#166534";
      previewShareBtn.style.fontWeight = "700";
      previewShareBtn.style.cursor = "pointer";

      const doneBtn = document.createElement("button");
      doneBtn.type = "button";
      doneBtn.textContent = "닫기";
      doneBtn.style.height = "38px";
      doneBtn.style.border = "1px solid rgba(148,163,184,0.28)";
      doneBtn.style.borderRadius = "10px";
      doneBtn.style.background = "rgba(255,255,255,0.06)";
      doneBtn.style.color = "#e2e8f0";
      doneBtn.style.fontWeight = "700";
      doneBtn.style.cursor = "pointer";

      function closeWith(action) {
        if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(action || null);
      }

      overlay.addEventListener("click", function (event) {
        if (event.target === overlay) closeWith(null);
      });
      closeBtn.addEventListener("click", function () { closeWith(null); });
      doneBtn.addEventListener("click", function () { closeWith(null); });
      previewSaveBtn.addEventListener("click", async function () {
        previewSaveBtn.disabled = true;
        if (onSave) {
          try {
            const saveResult = await onSave();
            const savePath = saveResult && saveResult.relativePath
              ? saveResult.relativePath
              : ("BearMap/" + fileName);
            window.alert("저장되었습니다.\n경로: Documents/" + savePath);
            closeWith("saved");
          } finally {
            previewSaveBtn.disabled = false;
          }
          return;
        }
        previewSaveBtn.disabled = false;
      });
      previewShareBtn.addEventListener("click", async function () {
        if (onShare) {
          await onShare();
          return;
        }
        await shareSavedTxtFile(fileName, savedUri, txtContent);
      });

      titleWrap.appendChild(title);
      titleWrap.appendChild(subtitle);
      header.appendChild(titleWrap);
      header.appendChild(closeBtn);
      footer.appendChild(previewSaveBtn);
      footer.appendChild(previewShareBtn);
      footer.appendChild(doneBtn);
      card.appendChild(header);
      card.appendChild(body);
      card.appendChild(footer);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    });
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

  const ngiiOnlineTileGrid = new ol.tilegrid.TileGrid({
    origin: GRID_ORIGIN,
    resolutions: ngiiOnlineResolutions,
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
    visible: DEFAULT_BASE_LAYER_TYPE === "mbtiles"
  });

  // 내부 TileGrid 줌(0..N)을 NGII WMTS 타일매트릭스 코드(L07..L17)로 맞춘다.
  function toNgiiTileMatrix(rawZoom) {
    const level = Number(rawZoom) + MBTILES_MIN_ZOOM;
    return "L" + String(level).padStart(2, "0");
  }

  // NGII GetTile URL 생성: layerId를 파라미터로 받아 공통으로 사용한다.
  function ngiiTileUrlFnFor(layerId) {
    return function (tileCoord) {
      if (!tileCoord || !NGII_API_KEY) return TRANSPARENT_PIXEL;
      const rawZoom = tileCoord[0];
      const x = tileCoord[1];
      const y = normalizeXyzY(tileCoord[2]);
      return "https://map.ngii.go.kr/openapi/Gettile.do?apikey=" + encodeURIComponent(NGII_API_KEY) +
        "&service=WMTS&request=GetTile&version=1.0.0" +
        "&layer=" + layerId +
        "&style=korean&format=image/png&tilematrixset=korean" +
        "&tilematrix=" + toNgiiTileMatrix(rawZoom) +
        "&tilerow=" + y + "&tilecol=" + x;
    };
  }

  // 기존 NGII 기본도 URL 함수 (korean_map)
  const ngiiBaseTileUrlFn = ngiiTileUrlFnFor(NGII_BASE_LAYER_ID);
  // NGII 야간지도 URL 함수 (night_map)
  const ngiiNightTileUrlFn = ngiiTileUrlFnFor("night_map");

  // '인터넷 기본도' 라디오에 연결되는 실제 온라인 베이스레이어(NGII).
  const osmBase = new ol.layer.Tile({
    source: new ol.source.XYZ({
      projection: MAP_PROJECTION_CODE,
      tileGrid: ngiiOnlineTileGrid,
      minZoom: 0,
      maxZoom: NGII_ONLINE_MAX_ZOOM,
      wrapX: false,
      transition: 0,
      tilePixelRatio: 1,
      tileUrlFunction: ngiiBaseTileUrlFn
    }),
    visible: DEFAULT_BASE_LAYER_TYPE === "osm"
  });

  // 영문지도 레이어(NGII english_map).
  const englishBase = new ol.layer.Tile({
    source: new ol.source.XYZ({
      projection: MAP_PROJECTION_CODE,
      tileGrid: ngiiOnlineTileGrid,
      minZoom: 0,
      maxZoom: NGII_ONLINE_MAX_ZOOM,
      wrapX: false,
      transition: 0,
      tilePixelRatio: 1,
      tileUrlFunction: ngiiTileUrlFnFor("english_map")
    }),
    visible: false
  });

  // 큰글씨지도 레이어(NGII lowV_map).
  const largeBase = new ol.layer.Tile({
    source: new ol.source.XYZ({
      projection: MAP_PROJECTION_CODE,
      tileGrid: ngiiOnlineTileGrid,
      minZoom: 0,
      maxZoom: NGII_ONLINE_MAX_ZOOM,
      wrapX: false,
      transition: 0,
      tilePixelRatio: 1,
      tileUrlFunction: ngiiTileUrlFnFor("lowV_map")
    }),
    visible: false
  });

  // 야간지도 레이어(NGII night_map).
  const nightBase = new ol.layer.Tile({
    source: new ol.source.XYZ({
      projection: MAP_PROJECTION_CODE,
      tileGrid: ngiiOnlineTileGrid,
      minZoom: 0,
      maxZoom: NGII_ONLINE_MAX_ZOOM,
      wrapX: false,
      transition: 0,
      tilePixelRatio: 1,
      tileUrlFunction: ngiiNightTileUrlFn
    }),
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

  bindTileErrorStatus(osmBase.getSource(), "NGII 인터넷 기본도");
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

  const analysisPreviewSource = new ol.source.Vector();
  let previewDashOffset = 0;
  let previewArrowPulse = 0;
  let previewRayAnimationActive = false;
  const analysisPreviewLayer = new ol.layer.Vector({
    source: analysisPreviewSource,
    style: function (feature) {
      const kind = feature ? feature.get("kind") : "";

      if (kind === "preview-radius") {
        return new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: "rgba(37,99,235,0.68)",
            width: 2,
            lineDash: [7, 8]
          }),
          fill: new ol.style.Fill({ color: "rgba(37,99,235,0.07)" })
        });
      }

      if (kind === "preview-ray") {
        return new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: "rgba(37,99,235,0.84)",
            width: 2.4,
            lineDash: [10, 10],
            lineDashOffset: previewDashOffset,
            lineCap: "round"
          })
        });
      }

      if (kind === "preview-arrow") {
        const angleRad = Number(feature.get("angleRad")) || 0;
        return new ol.style.Style({
          image: new ol.style.RegularShape({
            points: 3,
            radius: 7 + previewArrowPulse * 1.8,
            rotation: angleRad,
            fill: new ol.style.Fill({ color: "rgba(37,99,235,0.96)" }),
            stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.96)", width: 1.4 })
          })
        });
      }

      if (kind === "preview-intersection") {
        return new ol.style.Style({
          image: new ol.style.Circle({
            radius: 8,
            fill: new ol.style.Fill({ color: "rgba(34,197,94,0.96)" }),
            stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.96)", width: 2 })
          })
        });
      }

      return null;
    }
  });

  const analysisGuideSource = new ol.source.Vector();
  let analysisDashOffset = 0;
  let analysisPulseStrength = 0;
  let analysisAnimationStartTs = 0;
  let analysisAnimationFrameId = null;
  let analysisAnimationRunning = false;
  let analysisActionBarEl = null;
  let analysisActionOverlay = null;
  let currentAnalysisPoint = null; // 위치분석 최근 결과 (저장 버튼용)

  // 십진수 위경도를 도분초(DMS) 문자열로 변환한다.
  function decimalToDMS(deg, isLng) {
    const abs = Math.abs(deg);
    const d = Math.floor(abs);
    const minFloat = (abs - d) * 60;
    const m = Math.floor(minFloat);
    const s = ((minFloat - m) * 60).toFixed(1);
    const dir = isLng ? (deg >= 0 ? "E" : "W") : (deg >= 0 ? "N" : "S");
    return d + "\u00b0" + m + "'" + s + '"' + dir;
  }

  // SQLite 저장용 한국시간(KST) ISO 문자열을 생성한다. (YYYY-MM-DDTHH:mm:ss+09:00)
  function getKstSqliteTimestamp() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).formatToParts(new Date());

    const map = {};
    parts.forEach(function (p) {
      if (p && p.type && p.type !== "literal") map[p.type] = p.value;
    });

    return [map.year, map.month, map.day].join("-") + "T" + [map.hour, map.minute, map.second].join(":") + "+09:00";
  }

  function parseSavedDateTime(value) {
    if (!value) return "-";

    let parsed = null;
    if (typeof value === "number") {
      parsed = new Date(value);
    } else {
      const text = String(value).trim();
      if (!text) return "-";

      // 신형: ISO 문자열(+09:00, Z 포함) 저장
      if (/T.*([zZ]|[+-]\d{2}:\d{2})$/.test(text)) {
        parsed = new Date(text);
      } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
        // 구형: SQLite datetime('now') 텍스트는 UTC 기준으로 저장된 이력이라 Z를 붙여 보정한다.
        parsed = new Date(text.replace(" ", "T") + "Z");
      } else {
        parsed = new Date(text);
      }
    }

    if (!(parsed instanceof Date) || !Number.isFinite(parsed.getTime())) return null;
    return parsed;
  }

  // 저장 시각 문자열을 한국시간으로 안전하게 표시한다.
  function formatKstTimeLabel(value) {
    const parsed = parseSavedDateTime(value);
    if (!parsed) return "-";

    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    }).format(parsed);
  }

  // 목록용 날짜 라벨(YYYY-MM-DD)
  function formatKstDateLabel(value) {
    const parsed = parseSavedDateTime(value);
    if (!parsed) return "-";

    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(parsed);

    const map = {};
    parts.forEach(function (p) {
      if (p && p.type && p.type !== "literal") map[p.type] = p.value;
    });

    if (!map.year || !map.month || !map.day) return "-";
    return [map.year, map.month, map.day].join("-");
  }

  const analysisGuideLayer = new ol.layer.Vector({
    source: analysisGuideSource,
    style: function (feature) {
      const kind = feature ? feature.get("kind") : "";
      if (kind === "ray") {
        return new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: "rgba(220,38,38,0.92)",
            width: 3,
            lineDash: [14, 10],
            lineDashOffset: analysisDashOffset,
            lineCap: "round"
          })
        });
      }

      if (kind === "pulse") {
        const pulseRadius = 16 + analysisPulseStrength * 8;
        const pulseOpacity = 0.5 - analysisPulseStrength * 0.28;
        return [
          new ol.style.Style({
            image: new ol.style.Circle({
              radius: pulseRadius,
              fill: new ol.style.Fill({ color: `rgba(239,68,68,${Math.max(0.08, pulseOpacity).toFixed(3)})` }),
              stroke: new ol.style.Stroke({ color: "rgba(220,38,38,0.95)", width: 2 })
            })
          }),
          new ol.style.Style({
            image: new ol.style.Circle({
              radius: 6,
              fill: new ol.style.Fill({ color: "rgba(255,255,255,0.96)" }),
              stroke: new ol.style.Stroke({ color: "rgba(220,38,38,1)", width: 2 })
            })
          })
        ];
      }

      return null;
    }
  });

  const analysisEstimateSource = new ol.source.Vector();
  const analysisEstimateLayer = new ol.layer.Vector({ source: analysisEstimateSource });
  // 거리 측정 전용 레이어: 시작점/끝점/선/거리라벨을 여기서만 관리한다.
  const measureSource = new ol.source.Vector();
  const measureLayer = new ol.layer.Vector({
    source: measureSource,
    style: function (feature) {
      const kind = feature ? feature.get("kind") : "";

      if (kind === "measure-line" || kind === "measure-line-preview") {
        const isPreview = kind === "measure-line-preview";
        return new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: isPreview ? "rgba(239,68,68,0.85)" : "rgba(239,68,68,0.96)",
            width: 3,
            lineDash: isPreview ? [8, 6] : undefined,
            lineCap: "round"
          })
        });
      }

      if (kind === "measure-area-line" || kind === "measure-area-line-preview") {
        const isPreview = kind === "measure-area-line-preview";
        return new ol.style.Style({
          stroke: new ol.style.Stroke({
            color: isPreview ? "rgba(6,182,212,0.82)" : "rgba(6,182,212,0.96)",
            width: 3,
            lineDash: isPreview ? [8, 6] : undefined,
            lineCap: "round"
          })
        });
      }

      if (kind === "measure-point-start" || kind === "measure-point-end") {
        const isStart = kind === "measure-point-start";
        return new ol.style.Style({
          image: new ol.style.Circle({
            radius: 6,
            fill: new ol.style.Fill({ color: isStart ? "rgba(14,165,233,0.95)" : "rgba(239,68,68,0.95)" }),
            stroke: new ol.style.Stroke({ color: "rgba(255,255,255,0.96)", width: 2 })
          })
        });
      }

      if (kind === "measure-area-fill" || kind === "measure-area-fill-preview") {
        const isPreview = kind === "measure-area-fill-preview";
        return new ol.style.Style({
          fill: new ol.style.Fill({ color: isPreview ? "rgba(6,182,212,0.2)" : "rgba(6,182,212,0.3)" })
        });
      }

      return null;
    }
  });

  const observationMarkerSource = new ol.source.Vector();

  const baseCenterMap = mapCoordFromWgs84(35.315, 127.655);
  //const extentMap = ol.proj.transformExtent(JIRISAN_BOUNDS_WGS84, WGS84_CODE, MAP_PROJECTION_CODE);
  const extentMap = [944865,1669988,1077349,1732849];
  const viewResolutions = build5179ViewResolutions(
    MBTILES_MIN_ZOOM,
    ONLINE_MAX_ZOOM,
    mbtilesResolutions[0]
  );

  const view = new ol.View({
    projection: MAP_PROJECTION_CODE,
    center: baseCenterMap,
    minZoom: MBTILES_MIN_ZOOM,
    maxZoom: ONLINE_MAX_ZOOM,
    resolutions: viewResolutions,
    //extent: LOCK_EMPTY_AREA_PAN ? PAN_LIMIT_EXTENT : undefined // 이 한 줄을 주석 처리하면 빈공간 이동 제한 해제
  });

  //맵 기능
  const map = new ol.Map({
    target: "map",
    layers: [osmBase, englishBase, largeBase, nightBase, topoBase, mbtilesLayer, hillshadeOverlay, bearMarkerLayer, analysisPreviewLayer, analysisGuideLayer, analysisEstimateLayer, measureLayer, myLocationLayer],
    view: view,
    interactions: ol.interaction.defaults.defaults({
      pinchRotate: false // 이 한 줄을 주석 처리하면 손가락 회전(핀치 회전) 활성
    }),
    controls: ol.control.defaults.defaults({
      zoom: false,
      rotate: false,
      attribution: true
    })
  });

  window.__olMap = map;
  window.__olView = view;

  const controlsManager = window.createOlMapControlsManager ? window.createOlMapControlsManager({
    ol: ol,
    map: map,
    mapEl: mapEl,
    view: view,
    statusEl: statusEl,
    wgs84FromMapCoord: wgs84FromMapCoord,
    extentMap: extentMap,
    mbtilesExtentMap: mbtilesExtentMap,
    ngiiApiKey: NGII_API_KEY,
    mbtilesMinZoom: MBTILES_MIN_ZOOM,
    mbtilesMaxZoom: MBTILES_MAX_ZOOM,
    onlineMaxZoom: ONLINE_MAX_ZOOM,
    offlineInitialZoom: OFFLINE_INITIAL_ZOOM,
    hillshadeBaseOpacity: HILLSHADE_BASE_OPACITY,
    hillshadeSafeMaxZoom: HILLSHADE_SAFE_MAX_ZOOM,
    initialBaseLayerType: DEFAULT_BASE_LAYER_TYPE,
    layers: {
      osmBase: osmBase,
      englishBase: englishBase,
      largeBase: largeBase,
      nightBase: nightBase,
      topoBase: topoBase,
      mbtilesLayer: mbtilesLayer,
      hillshadeOverlay: hillshadeOverlay
    },
    measureSource: measureSource,
    onToggleMyLocation: toggleMyLocation,
    onMeasureActivated: function () {
      clearAnalysisEstimateVisuals();
      closeObservationPopup();
    },
    onLocateButtonReady: function (buttonEl) {
      locateBtnEl = buttonEl || null;
    }
  }) : null;

  if (controlsManager && typeof controlsManager.initialize === "function") {
    controlsManager.initialize();
  }

  if (isNativeCapacitorPlatform()) {
    ensureNativeMbtilesDatabase();
  }

  // 초기 위치: fit() 호출 (한 번만 실행)
  if (controlsManager && typeof controlsManager.moveToOfflineInitialView === "function") {
    controlsManager.moveToOfflineInitialView();
  }
  window.__initialFitDone = true;

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

  // latlngList: [{lat, lng}, ...] 배열을 모두 포함하는 extent로 fit
  function fitToPoints(latlngList, options) {
    if (!latlngList || latlngList.length === 0) return;
    const opts = options || {};
    const padding = opts.padding !== undefined ? opts.padding : 80;
    const maxZoom = opts.maxZoom !== undefined ? opts.maxZoom : 17;

    if (latlngList.length === 1) {
      flyToLatLng([latlngList[0].lat, latlngList[0].lng], 15);
      return;
    }

    const coords = latlngList.map(function (p) { return mapCoordFromWgs84(p.lat, p.lng); });
    const xs = coords.map(function (c) { return c[0]; });
    const ys = coords.map(function (c) { return c[1]; });
    const extent = [Math.min.apply(null, xs), Math.min.apply(null, ys),
                    Math.max.apply(null, xs), Math.max.apply(null, ys)];

    view.fit(extent, {
      padding: [padding, padding, padding, padding],
      maxZoom: maxZoom,
      duration: 700
    });
  }

  function updateRegistrationPreview() {
    const baseLatLng = lastLatLng || [35.326459, 127.637712];
    const previewHeading = Math.round(lastHeadingDeg !== null ? lastHeadingDeg : 0) + "°";

    if (currentCoordEl) {
      currentCoordEl.textContent = baseLatLng[0].toFixed(6) + ", " + baseLatLng[1].toFixed(6);
    }
    if (currentHeadingEl) {
      currentHeadingEl.textContent = previewHeading;
    }
  }

  function clearManualRegistrationPreview() {
    if (isMyVisible) {
      const fallbackLatLng = lastTrackedLatLng || [35.326459, 127.637712];
      const fallbackHeading = Number.isFinite(lastTrackedHeadingDeg) ? lastTrackedHeadingDeg : 0;
      const fallbackCoord = mapCoordFromWgs84(fallbackLatLng[0], fallbackLatLng[1]);

      lastLatLng = [fallbackLatLng[0], fallbackLatLng[1]];
      lastHeadingDeg = fallbackHeading;

      const previewFeature = ensureMyLocationFeature(fallbackCoord);
      if (previewFeature) {
        previewFeature.set("headingDeg", lastHeadingDeg);
        previewFeature.changed();
      }
    } else {
      lastLatLng = null;
      lastHeadingDeg = 0;
      myLocationSource.clear();
      myLocationFeature = null;
    }

    updateRegistrationPreview();
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

  // 안드로이드 하단 뒤로가기(하드웨어 back) 공통 처리.
  // 우선순위: 관측점 팝업 닫기 -> 목록/등록/분석 UI 닫기 -> 분석 결과 표시 취소 -> 앱 종료 확인.
  async function setupAndroidBackButtonExit() {
    if (getPlatform() !== "android") return;

    const appPlugin = getCapacitorAppPlugin();
    if (!appPlugin || removeBackButtonListener) return;

    const listener = await appPlugin.addListener("backButton", function () {
      // 1) 지도 위 관측점 상세 팝업이 열려 있으면 먼저 닫는다.
      if (observationPopupEl && observationPopupEl.style.display !== "none") {
        closeObservationPopup();
        return;
      }

      // 2) 목록/등록/분석 다이얼로그 등 메뉴성 UI는 obsList 모듈에서 우선 닫는다.
      if (obsListModule && typeof obsListModule.handleBackNavigation === "function") {
        const handled = obsListModule.handleBackNavigation();
        if (handled) return;
      }

      // 3) 메뉴가 없다면 지도 위 분석 결과(추정 위치 표시)만 취소한다.
      if (analysisEstimateSource && typeof analysisEstimateSource.getFeatures === "function") {
        const estimateFeatures = analysisEstimateSource.getFeatures();
        if (Array.isArray(estimateFeatures) && estimateFeatures.length > 0) {
          clearAnalysisEstimateVisuals();
          if (statusEl) statusEl.textContent = "ℹ️ 위치분석 표시를 취소했습니다.";
          return;
        }
      }

      // 4) 더 닫을 UI가 없을 때만 앱 종료를 물어본다.
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
    if (isMyVisible || watchId !== null) {
      lastTrackedHeadingDeg = effectiveDeg;
    }

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
            offsetY: -22,
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
    // 측정 모드가 클릭을 소비하면 관측점 팝업 클릭 로직은 실행하지 않는다.
    if (controlsManager && typeof controlsManager.consumeMapClick === "function" && controlsManager.consumeMapClick(event.coordinate)) {
      return;
    }

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
          if (this._feature) {
            this._feature.set("popupHtml", this._popupHtml);
          }
          return this;
        },
        openPopup: function () {
          if (this._feature) {
            openObservationPopup(this._feature);
          }
          return this;
        },
        closePopup: function () {
          closeObservationPopup();
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
    onManualPreview: function (payload) {
      if (!payload) {
        clearManualRegistrationPreview();
        return;
      }
      if (!payload || !Number.isFinite(payload.lat) || !Number.isFinite(payload.lng)) return;

      lastLatLng = [payload.lat, payload.lng];
      lastHeadingDeg = Number.isFinite(payload.heading) ? payload.heading : null;
      updateRegistrationPreview();

      const centerCoord = mapCoordFromWgs84(payload.lat, payload.lng);
      const manualFeature = ensureMyLocationFeature(centerCoord);
      if (manualFeature) {
        manualFeature.set("headingDeg", Number.isFinite(lastHeadingDeg) ? lastHeadingDeg : null);
        manualFeature.changed();
      }

      view.setCenter(centerCoord);
      if ((view.getZoom() || 0) < 15) {
        view.setZoom(15);
      }
    },
    onObservationSaved: async function (payload) {
      if (!obsListModule || !payload || !payload.observation) return;

      if (payload.mode === "edit") {
        if (payload.source === "sqlite") {
          await obsListModule.refreshObservationList();
        } else {
          obsListModule.updateObservation(payload.observation);
        }
        return;
      }

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
    lastTrackedLatLng = [lat, lng];
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
    lastTrackedLatLng = null;
    lastGpsTimestamp = null;
    lastHeadingDeg = null;
    lastTrackedHeadingDeg = null;
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

  // 웹 환경(SQLite 미지원)에서는 bear_estimates와 유사한 JSON 행 구조를 폴백으로 사용한다.
  async function loadBearsData() {
    try {
      const res = await fetch("json/bears.json", { cache: "no-store" });
      const data = await res.json();
      bearsDataCache = Array.isArray(data) ? data : [];
    } catch (e) {
      console.error("bears.json 로드 실패:", e);
      bearsDataCache = [];
    }
  }

  function getWebFallbackBearEstimates() {
    if (!Array.isArray(bearsDataCache) || !bearsDataCache.length) return [];

    return bearsDataCache.filter(function (row) {
      return row && Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lng));
    }).map(function (row, index) {
      return {
        id: row.id || ("web-bear-" + index),
        bear_code: String(row.bear_code || row.bearCode || "-").trim() || "-",
        lat: Number(row.lat),
        lng: Number(row.lng),
        lat_dms: row.lat_dms || null,
        lng_dms: row.lng_dms || null,
        intersections_count: Number.isFinite(Number(row.intersections_count)) ? Number(row.intersections_count) : null,
        created_at: row.created_at || null,
        source_observation_ids: row.source_observation_ids || null
      };
    });
  }

  function syncSelectedBearEstimateIds(items) {
    const validIds = new Set((items || []).map(function (it) { return String(it.id); }));
    Array.from(selectedBearEstimateIds).forEach(function (id) {
      if (!validIds.has(String(id))) selectedBearEstimateIds.delete(String(id));
    });
  }

  function updateBearEstimateToolbar(items) {
    const list = Array.isArray(items) ? items : [];
    const totalCount = list.length;
    const selectedCount = list.reduce(function (count, it) {
      return count + (selectedBearEstimateIds.has(String(it.id)) ? 1 : 0);
    }, 0);

    if (bearsToolbarEl) {
      bearsToolbarEl.classList.toggle("is-idle", selectedCount === 0);
    }

    if (bearsSelectionCountEl) {
      bearsSelectionCountEl.textContent = selectedCount + " / " + totalCount + " 선택";
    }

    if (bearsSelectAllEl) {
      bearsSelectAllEl.disabled = totalCount === 0;
      bearsSelectAllEl.checked = totalCount > 0 && selectedCount === totalCount;
      bearsSelectAllEl.indeterminate = selectedCount > 0 && selectedCount < totalCount;
    }

    if (btnBearsDeleteSelectedEl) btnBearsDeleteSelectedEl.disabled = selectedCount === 0;
  }

  async function deleteBearEstimateRows(ids, isFallback, deleteAll) {
    if (isFallback) {
      if (deleteAll) {
        bearsDataCache = [];
        return;
      }

      const idSet = new Set((ids || []).map(function (id) { return String(id); }));
      bearsDataCache = bearsDataCache.filter(function (row, index) {
        const fallbackId = row && row.id ? String(row.id) : ("web-bear-" + index);
        return !idSet.has(fallbackId);
      });
      return;
    }

    const sqlite = getCapacitorSQLitePlugin();
    if (!sqlite) throw new Error("SQLite 플러그인을 찾지 못했습니다.");

    const dbName = window.BearSQLiteConfig && window.BearSQLiteConfig.dbName
      ? window.BearSQLiteConfig.dbName
      : "BearPointData";

    let statements = "DELETE FROM bear_estimates";
    if (!deleteAll) {
      const safeIds = (ids || []).map(function (id) {
        return "'" + String(id).replace(/'/g, "''") + "'";
      });
      if (!safeIds.length) return;
      statements = "DELETE FROM bear_estimates WHERE id IN (" + safeIds.join(", ") + ")";
    }

    await sqlite.execute({
      database: dbName,
      statements: statements,
      transaction: true,
      readonly: false
    });
  }

  async function handleDeleteSelectedBearEstimates() {
    const targetIds = currentBearEstimateItems.filter(function (it) {
      return selectedBearEstimateIds.has(String(it.id));
    }).map(function (it) {
      return String(it.id);
    });

    if (!targetIds.length) return;

    const ok = window.confirm("선택한 곰 추정위치 " + targetIds.length + "건을 삭제할까요?");
    if (!ok) return;

    try {
      await deleteBearEstimateRows(targetIds, currentBearEstimateFallbackMode, false);
      selectedBearEstimateIds.clear();
      await refreshBearEstimatePanel();
      if (statusEl) statusEl.textContent = "🗑️ 선택한 곰 추정위치 " + targetIds.length + "건을 삭제했습니다";
    } catch (error) {
      console.warn("[bear_estimates] 선택 삭제 실패:", error);
      if (statusEl) statusEl.textContent = "🔴 선택 삭제 실패: " + (error && error.message ? error.message : String(error));
    }
  }

  if (bearsSelectAllEl) {
    bearsSelectAllEl.addEventListener("change", function () {
      selectedBearEstimateIds.clear();
      if (bearsSelectAllEl.checked) {
        currentBearEstimateItems.forEach(function (it) {
          selectedBearEstimateIds.add(String(it.id));
        });
      }
      renderBears(currentBearEstimateItems, currentBearEstimateFallbackMode);
    });
  }

  if (btnBearsDeleteSelectedEl) {
    btnBearsDeleteSelectedEl.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      handleDeleteSelectedBearEstimates();
    });
  }

  // 곰 추정 좌표를 지도 마커 레이어로 렌더링한다.
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
          offsetY: BEAR_LABEL_OFFSET_Y,
          font: "600 11px sans-serif",
          fill: new ol.style.Fill({ color: "#ffffff" }),
          backgroundFill: new ol.style.Fill({ color: "rgba(43,124,255,0.95)" }),
          padding: [2, 5, 2, 5]
        })
      }));

      bearMarkerSource.addFeature(feature);
    });
  }

  // 관측점 heading 문자열/숫자를 프리뷰 계산용 각도로 정규화한다.
  function parseHeadingDegForPreview(value) {
    const analyzer = window.BearPositionAnalysis;
    if (analyzer && typeof analyzer.parseHeadingDegrees === "function") {
      return analyzer.parseHeadingDegrees(value);
    }

    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string") return null;
    const parsed = Number(value.replace(/[^0-9+-.]/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  // 실시간 입력 프리뷰(반경/방향선/화살표)를 비운다.
  function clearAnalysisInputPreview() {
    analysisPreviewSource.clear();
    previewRayAnimationActive = false;
  }

  // 위치분석 입력값 변화에 따라 반경과 방향 화살표 프리뷰를 갱신한다.
  function renderAnalysisInputPreview(previewPayload) {
    clearAnalysisInputPreview();

    if (!previewPayload || !Array.isArray(previewPayload.sourceObservations)) return;

    const distanceLimitM = Number(previewPayload.distanceLimitM);
    const declinationDeg = Number(previewPayload.declinationDeg);
    if (!Number.isFinite(distanceLimitM) || distanceLimitM <= 0) return;
    const canDrawRay = Number.isFinite(declinationDeg);
    let hasRayFeature = false;

    const rayEndPoints = []; // 교차점 계산용 광선 끝점

    previewPayload.sourceObservations.forEach(function (obs) {
      if (!obs || !Number.isFinite(obs.lat) || !Number.isFinite(obs.lng)) return;

      const origin = mapCoordFromWgs84(obs.lat, obs.lng);

      const radiusFeature = new ol.Feature({
        geometry: new ol.geom.Circle(origin, distanceLimitM)
      });
      radiusFeature.set("kind", "preview-radius");
      analysisPreviewSource.addFeature(radiusFeature);

      if (!canDrawRay) return;

      const headingDeg = parseHeadingDegForPreview(obs.heading);
      if (!Number.isFinite(headingDeg)) return;

      const adjustedDeg = ((headingDeg + declinationDeg) % 360 + 360) % 360;
      const rad = adjustedDeg * Math.PI / 180;
      const end = [
        origin[0] + Math.sin(rad) * distanceLimitM,
        origin[1] + Math.cos(rad) * distanceLimitM
      ];

      rayEndPoints.push({ origin, end, rad });

      const rayFeature = new ol.Feature({
        geometry: new ol.geom.LineString([origin, end])
      });
      rayFeature.set("kind", "preview-ray");
      analysisPreviewSource.addFeature(rayFeature);

      const arrowFeature = new ol.Feature({
        geometry: new ol.geom.Point(end)
      });
      arrowFeature.set("kind", "preview-arrow");
      arrowFeature.set("angleRad", rad);
      analysisPreviewSource.addFeature(arrowFeature);
      hasRayFeature = true;
    });

    // 교차점 계산 및 표시 (2개 이상의 광선이 있을 때)
    if (rayEndPoints.length >= 2) {
      for (let i = 0; i < rayEndPoints.length - 1; i++) {
        for (let j = i + 1; j < rayEndPoints.length; j++) {
          const line1 = rayEndPoints[i];
          const line2 = rayEndPoints[j];

          const intersection = lineIntersection(
            line1.origin, line1.end,
            line2.origin, line2.end
          );

          if (intersection) {
            const intersectFeature = new ol.Feature({
              geometry: new ol.geom.Point(intersection)
            });
            intersectFeature.set("kind", "preview-intersection");
            analysisPreviewSource.addFeature(intersectFeature);
          }
        }
      }
    }

    previewRayAnimationActive = hasRayFeature;
    if (previewRayAnimationActive) {
      startAnalysisVisualAnimation();
    } else if (analysisGuideSource.getFeatures().length === 0) {
      stopAnalysisVisualAnimation();
    }
  }

  // 선-선 교차점 계산 (로컬 좌표계)
  function lineIntersection(p1, p2, p3, p4) {
    const x1 = p1[0], y1 = p1[1];
    const x2 = p2[0], y2 = p2[1];
    const x3 = p3[0], y3 = p3[1];
    const x4 = p4[0], y4 = p4[1];

    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return null;

    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    if (t < 0 || t > 1) return null;

    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
    if (u < 0 || u > 1) return null;

    return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
  }

  // 추정 결과 액션바(저장/취소)를 숨기고 오버레이 앵커를 해제한다.
  function hideAnalysisActionBar() {
    if (!analysisActionBarEl || !analysisActionOverlay) return;
    analysisActionBarEl.style.display = "none";
    analysisActionOverlay.setPosition(undefined);
  }

  // 추정 좌표에 맞춰 액션바 오버레이를 표시한다.
  function showAnalysisActionBar(anchorCoord) {
    if (!analysisActionBarEl || !analysisActionOverlay || !Array.isArray(anchorCoord)) return;
    analysisActionBarEl.style.display = "flex";
    analysisActionOverlay.setPosition(anchorCoord);
  }

  // 위치분석 관련 requestAnimationFrame 루프를 중지한다.
  function stopAnalysisVisualAnimation() {
    analysisAnimationRunning = false;
    if (analysisAnimationFrameId !== null) {
      window.cancelAnimationFrame(analysisAnimationFrameId);
      analysisAnimationFrameId = null;
    }
  }

  // 프리뷰/최종분석/액션바 상태를 한 번에 초기화한다.
  function clearAnalysisEstimateVisuals() {
    stopAnalysisVisualAnimation();
    analysisDashOffset = 0;
    analysisPulseStrength = 0;
    analysisAnimationStartTs = 0;
    previewDashOffset = 0;
    previewArrowPulse = 0;
    clearAnalysisInputPreview();
    analysisGuideSource.clear();
    analysisEstimateSource.clear();
    analysisGuideLayer.changed();
    analysisPreviewLayer.changed();
    hideAnalysisActionBar();
    currentAnalysisPoint = null;
  }

  // 추정 위치 근처에 뜨는 저장/취소 액션바 오버레이를 1회 생성한다.
  function mountAnalysisActionBar() {
    if (analysisActionBarEl) return;

    const root = document.createElement("div");
    root.style.display = "none";
    root.style.alignItems = "center";
    root.style.gap = "8px";
    root.style.zIndex = "1600";
    root.style.pointerEvents = "auto";

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.textContent = "저장";
    saveBtn.style.height = "30px";
    saveBtn.style.minWidth = "78px";
    saveBtn.style.padding = "0 14px";
    saveBtn.style.border = "1px solid rgba(255,255,255,0.62)";
    saveBtn.style.borderRadius = "0";
    saveBtn.style.background = "#0b72c7";
    saveBtn.style.color = "#ffffff";
    saveBtn.style.fontSize = "16px";
    saveBtn.style.fontWeight = "700";
    saveBtn.style.cursor = "pointer";
    saveBtn.style.boxShadow = "0 8px 20px rgba(11,114,199,0.35)";

    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.textContent = "취소";
    cancelBtn.style.height = "30px";
    cancelBtn.style.minWidth = "78px";
    cancelBtn.style.padding = "0 14px";
    cancelBtn.style.border = "1px solid rgba(255,255,255,0.62)";
    cancelBtn.style.borderRadius = "0";
    cancelBtn.style.background = "#8a3b00";
    cancelBtn.style.color = "#ffffff";
    cancelBtn.style.fontSize = "16px";
    cancelBtn.style.fontWeight = "700";
    cancelBtn.style.cursor = "pointer";
    cancelBtn.style.boxShadow = "0 8px 20px rgba(138,59,0,0.34)";

    saveBtn.addEventListener("click", async function () {
      const point = currentAnalysisPoint;
      if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
        if (statusEl) statusEl.textContent = "⚠️ 저장할 분석 결과가 없습니다.";
        return;
      }

      const initState = await initializeEmbeddedDatabase();
      if (!initState || !initState.ready) {
        if (statusEl) statusEl.textContent = "⚠️ SQLite 연결이 준비되지 않았습니다.";
        return;
      }

      const sqlite = getCapacitorSQLitePlugin();
      const dbName = window.BearSQLiteConfig && window.BearSQLiteConfig.dbName
        ? window.BearSQLiteConfig.dbName
        : "BearPointData";

      if (!sqlite) {
        if (statusEl) statusEl.textContent = "⚠️ SQLite를 사용할 수 없습니다.";
        return;
      }

      const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const bearCode = String(point.bearCode || "").trim();
      const sourceIds = Array.isArray(point.sourceObservationIds)
        ? JSON.stringify(point.sourceObservationIds)
        : null;
      const intersectionsCount = Number.isFinite(point.intersectionsCount)
        ? point.intersectionsCount
        : null;
      const latDms = decimalToDMS(point.lat, false);
      const lngDms = decimalToDMS(point.lng, true);
      const createdAtKst = getKstSqliteTimestamp();
      const sourceObservationsJson = JSON.stringify((Array.isArray(point.sourceObservations) ? point.sourceObservations : []).map(function (obs) {
        const projected = mapCoordFromWgs84(Number(obs.lat), Number(obs.lng));
        return {
          id: obs.id || null,
          place: obs.place || null,
          bearCode: obs.bearCode || null,
          heading: obs.heading ?? null,
          lat: Number(obs.lat),
          lng: Number(obs.lng),
          mapX: Array.isArray(projected) && Number.isFinite(projected[0]) ? projected[0] : null,
          mapY: Array.isArray(projected) && Number.isFinite(projected[1]) ? projected[1] : null
        };
      }));
      const analysisRaysJson = JSON.stringify((point.analysisDetails && Array.isArray(point.analysisDetails.rays) ? point.analysisDetails.rays : []).map(function (ray) {
        const sourceObs = Array.isArray(point.sourceObservations)
          ? point.sourceObservations.find(function (obs) { return obs && obs.id === ray.id; })
          : null;
        const projected = sourceObs ? mapCoordFromWgs84(Number(sourceObs.lat), Number(sourceObs.lng)) : null;
        return {
          id: ray.id || null,
          headingDeg: Number.isFinite(Number(ray.headingDeg)) ? Number(ray.headingDeg) : null,
          adjustedBearing: Number.isFinite(Number(ray.adjustedBearing)) ? Number(ray.adjustedBearing) : null,
          localX: Array.isArray(ray.point) && Number.isFinite(Number(ray.point[0])) ? Number(ray.point[0]) : null,
          localY: Array.isArray(ray.point) && Number.isFinite(Number(ray.point[1])) ? Number(ray.point[1]) : null,
          directionX: Array.isArray(ray.direction) && Number.isFinite(Number(ray.direction[0])) ? Number(ray.direction[0]) : null,
          directionY: Array.isArray(ray.direction) && Number.isFinite(Number(ray.direction[1])) ? Number(ray.direction[1]) : null,
          mapX: Array.isArray(projected) && Number.isFinite(projected[0]) ? projected[0] : null,
          mapY: Array.isArray(projected) && Number.isFinite(projected[1]) ? projected[1] : null
        };
      }));
      const intersectionsJson = JSON.stringify((point.analysisDetails && Array.isArray(point.analysisDetails.intersections) ? point.analysisDetails.intersections : []).map(function (item, index) {
        const projected = mapCoordFromWgs84(Number(item.lat), Number(item.lng));
        return {
          index: index + 1,
          lat: Number(item.lat),
          lng: Number(item.lng),
          localX: Array.isArray(item.point) && Number.isFinite(Number(item.point[0])) ? Number(item.point[0]) : null,
          localY: Array.isArray(item.point) && Number.isFinite(Number(item.point[1])) ? Number(item.point[1]) : null,
          mapX: Array.isArray(projected) && Number.isFinite(projected[0]) ? projected[0] : null,
          mapY: Array.isArray(projected) && Number.isFinite(projected[1]) ? projected[1] : null
        };
      }));
      const analysisOptionsJson = JSON.stringify(point.analysisOptions || point.options || null);
      const analysisDiagnosticsJson = JSON.stringify(point.analysisDiagnostics || null);

      try {
        saveBtn.disabled = true;
        await sqlite.run({
          database: dbName,
          statement: "INSERT INTO bear_estimates (id, bear_code, lat, lng, lat_dms, lng_dms, intersections_count, source_observation_ids, source_observations_json, analysis_rays_json, intersections_json, analysis_options_json, analysis_diagnostics_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          values: [id, bearCode, point.lat, point.lng, latDms, lngDms, intersectionsCount, sourceIds, sourceObservationsJson, analysisRaysJson, intersectionsJson, analysisOptionsJson, analysisDiagnosticsJson, createdAtKst],
          transaction: true,
          readonly: false
        });
        clearAnalysisEstimateVisuals();
        if (statusEl) statusEl.textContent = `✅ 곰 추정위치(${bearCode}) 저장 완료`;
        await refreshBearEstimatePanel();
      } catch (saveError) {
        console.error("[bear_estimates] 저장 실패:", saveError);
        if (statusEl) statusEl.textContent = "🔴 저장 실패: " + (saveError && saveError.message ? saveError.message : String(saveError));
      } finally {
        saveBtn.disabled = false;
      }
    });

    cancelBtn.addEventListener("click", function () {
      clearAnalysisEstimateVisuals();
      if (statusEl) statusEl.textContent = "ℹ️ 위치분석 표시를 취소했습니다.";
    });

    root.addEventListener("pointerdown", function (e) { e.stopPropagation(); });
    root.addEventListener("touchstart", function (e) { e.stopPropagation(); }, { passive: true });

    root.appendChild(saveBtn);
    root.appendChild(cancelBtn);

    //분석 시 저장, 취소 버튼 위치 지정
    analysisActionOverlay = new ol.Overlay({
      element: root,
      positioning: "top-center",
      offset: [0, 35],
      stopEvent: true,
      autoPan: {
        animation: { duration: 180 },
        margin: 24
      }
    });
    map.addOverlay(analysisActionOverlay);

    analysisActionBarEl = root;
  }

  // 분석 완료 결과(추정점/가이드선/액션바)를 지도에 렌더링한다.
  function renderAnalysisEstimatePoint(point) {
    clearAnalysisEstimateVisuals();
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
    currentAnalysisPoint = point; // clearAnalysisEstimateVisuals 이후에 재설정해야 null이 안 됨

    const estimateCoord = mapCoordFromWgs84(point.lat, point.lng);

    // 관측점 -> 추정점 점선 가이드
    if (Array.isArray(point.sourceObservations)) {
      point.sourceObservations.forEach(function (obs) {
        if (!obs || !Number.isFinite(obs.lat) || !Number.isFinite(obs.lng)) return;
        const obsCoord = mapCoordFromWgs84(obs.lat, obs.lng);
        const lineFeature = new ol.Feature({
          geometry: new ol.geom.LineString([obsCoord, estimateCoord])
        });
        lineFeature.set("kind", "ray");
        analysisGuideSource.addFeature(lineFeature);
      });
    }

    const pulseFeature = new ol.Feature({
      geometry: new ol.geom.Point(estimateCoord)
    });
    pulseFeature.set("kind", "pulse");
    analysisGuideSource.addFeature(pulseFeature);

    const feature = new ol.Feature({
      geometry: new ol.geom.Point(estimateCoord)
    });

    feature.setStyle(new ol.style.Style({
      image: new ol.style.Icon({
        src: "assets/icons/icon_bear.png",
        anchor: [0.5, 1],
        width: 40,
        height: 40
      }),
      text: new ol.style.Text({
        text: String(point.bearCode || "추정"),
        offsetY: ESTIMATE_LABEL_OFFSET_Y,
        font: "700 12px sans-serif",
        fill: new ol.style.Fill({ color: "#ffffff" }),
        backgroundFill: new ol.style.Fill({ color: "rgba(16,185,129,0.96)" }),
        padding: [3, 6, 3, 6]
      })
    }));

    analysisEstimateSource.addFeature(feature);
    showAnalysisActionBar(estimateCoord);
    startAnalysisVisualAnimation();
  }

  // 점선 이동, 펄스, 화살표 크기 변화를 매 프레임 갱신한다.
  function animateAnalysisVisuals(timestamp) {
    if (!analysisAnimationRunning) return;
    if (!analysisAnimationStartTs) analysisAnimationStartTs = timestamp;

    const elapsedSec = (timestamp - analysisAnimationStartTs) / 1000;
    analysisDashOffset = -elapsedSec * 28;
    analysisPulseStrength = (Math.sin(elapsedSec * Math.PI * 1.35) + 1) / 2;
    previewDashOffset = -elapsedSec * 22;
    previewArrowPulse = (Math.sin(elapsedSec * Math.PI * 1.5) + 1) / 2;

    analysisGuideLayer.changed();
    if (previewRayAnimationActive) {
      analysisPreviewLayer.changed();
    }

    if (!previewRayAnimationActive && analysisGuideSource.getFeatures().length === 0) {
      stopAnalysisVisualAnimation();
      return;
    }

    analysisAnimationFrameId = window.requestAnimationFrame(animateAnalysisVisuals);
  }

  // 위치분석 시각효과 애니메이션 루프를 시작한다.
  function startAnalysisVisualAnimation() {
    if (analysisAnimationRunning) return;
    analysisAnimationRunning = true;
    analysisAnimationStartTs = 0;
    analysisAnimationFrameId = window.requestAnimationFrame(animateAnalysisVisuals);
  }

  window.addEventListener("beforeunload", function () {
    stopAnalysisVisualAnimation();
  });

  // TXT 파일 생성 및 다운로드 (앱: DB 조회, 웹: 더미 포함)
  async function downloadBearEstimateTxt(it, isFallback) {
    const lat = Number(it.lat);
    const lng = Number(it.lng);
    const bearCode = it.bear_code || it.bearCode || "-";
    const timeLabel = it.created_at || it.ts || "-";
    const latDms = it.lat_dms || decimalToDMS(lat, false);
    const lngDms = it.lng_dms || decimalToDMS(lng, true);
    // const projected = mapCoordFromWgs84(lat, lng); // EPSG:5179 출력(기존)
    // const mapX = Array.isArray(projected) && Number.isFinite(projected[0]) ? projected[0].toFixed(3) : "-";
    // const mapY = Array.isArray(projected) && Number.isFinite(projected[1]) ? projected[1].toFixed(3) : "-";
    const legacyProjected = legacyTmCoordFromWgs84(lat, lng);
    const mapX = Array.isArray(legacyProjected) && Number.isFinite(legacyProjected[0]) ? legacyProjected[0].toFixed(3) : "-";
    const mapY = Array.isArray(legacyProjected) && Number.isFinite(legacyProjected[1]) ? legacyProjected[1].toFixed(3) : "-";

    let sourceObservations = [];

    if (!isFallback) {
      // DB에서 상세 JSON 조회
      try {
        const sqlite = getCapacitorSQLitePlugin();
        const dbName = window.BearSQLiteConfig && window.BearSQLiteConfig.dbName
          ? window.BearSQLiteConfig.dbName : "BearPointData";
        const res = await sqlite.query({
          database: dbName,
          statement: "SELECT source_observations_json FROM bear_estimates WHERE id = ?",
          values: [it.id]
        });
        const row = res && res.values && res.values[0];
        if (row) {
          try { sourceObservations = JSON.parse(row.source_observations_json || "[]"); } catch (e) { sourceObservations = []; }
        }
      } catch (e) {
        console.warn("TXT 다운로드 DB 조회 오류:", e);
      }
    } else {
      // 웹 더미 데이터: source_observation_ids를 파싱해 가상 관측점 생성
      let obsIds = [];
      try { obsIds = JSON.parse(it.source_observation_ids || "[]"); } catch (e) { obsIds = []; }
      sourceObservations = obsIds.map(function (obsId, idx) {
        return {
          id: obsId,
          place: "관측지점 " + (idx + 1),
          bearCode: bearCode,
          lat: lat + (idx % 2 === 0 ? -0.01 : 0.01) * (idx + 1) * 0.5,
          lng: lng + (idx % 2 === 0 ? 0.01 : -0.01) * (idx + 1) * 0.5,
          heading: 180 + idx * 45
        };
      });
    }

    // TXT 내용 조립

    function formatHeadingDegree(value) {
      if (value == null || value === "") return "-";
      const raw = String(value).trim();
      const numericText = raw.replace(/[^0-9+\-.]/g, "");
      const numeric = Number(numericText);
      if (Number.isFinite(numeric)) {
        return numeric.toFixed(1).replace(/\.0$/, "") + "°";
      }
      return raw.replace(/°+/g, "").trim() + "°";
    }

    function formatCoord7(value) {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(7) : "-";
    }

    let lines = [];
    lines.push("========================================");
    lines.push("  곰 추적위치 결과");
    lines.push("========================================");
    lines.push("코드     : " + bearCode);
    lines.push("저장 일시   : " + timeLabel);
    lines.push("");
    lines.push("[ 사용된 관측점 목록 (" + sourceObservations.length + "개) ]");
    sourceObservations.forEach(function (obs, idx) {
      const label = (obs && (obs.place || obs.name || obs.id)) ? String(obs.place || obs.name || obs.id) : null;
      lines.push("  관측점 " + (idx + 1) + (label ? " (" + label + ")" : ""));
      lines.push("    위도   : " + formatCoord7(obs && obs.lat));
      lines.push("    경도   : " + formatCoord7(obs && obs.lng));
      lines.push("    방향각 : " + formatHeadingDegree(obs && obs.heading));
      if (idx < sourceObservations.length - 1) lines.push("    ------------------------------");
    });
    lines.push("");
    lines.push("[ 추정 위치 ]");
    lines.push("  위도(DMS) : " + latDms);
    lines.push("  경도(DMS) : " + lngDms);
    lines.push("  X (TM:EPSG:5181) : " + mapX);
    lines.push("  Y (TM:EPSG:5181) : " + mapY);
    lines.push("");
    lines.push("========================================");
    if (isFallback) lines.push("* 웹 환경: 관측점 목록은 더미 데이터입니다.");

    const txtContent = lines.join("\r\n");
    const safeCode = bearCode.replace(/[^\w가-힣]/g, "_");
    const fileDate = parseSavedDateTime(it.created_at || it.ts);
    let safeTime = "unknown_time";
    if (fileDate) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Seoul",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }).formatToParts(fileDate);

      const map = {};
      parts.forEach(function (p) {
        if (p && p.type && p.type !== "literal") map[p.type] = p.value;
      });

      safeTime = [map.year, map.month, map.day].join("-") + "_" + [map.hour, map.minute, map.second].join("-");
    }
    const fileName = "bear_estimate_" + safeCode + "_" + safeTime + ".txt";

    // 네이티브 앱은 먼저 인앱 미리보기를 띄우고, 저장/공유/열기는 그 안에서 실행한다.
    if (isNativeCapacitorPlatform()) {
      let savedFile = null;

      async function ensureSavedFile() {
        if (savedFile) return savedFile;

        const existing = await getNativeTxtUriIfExists(fileName);
        if (existing) {
          savedFile = existing;
          if (statusEl) statusEl.textContent = "ℹ️ 기존 저장 파일을 사용합니다: Documents/" + existing.relativePath;
          return savedFile;
        }

        savedFile = await saveTxtToNativeDocuments(fileName, txtContent);
        return savedFile;
      }

      try {
        await showSavedTxtPreviewPopup({
          fileName: fileName,
          txtContent: txtContent,
          onSave: async function () {
            const saved = await ensureSavedFile();
            return saved;
          },
          onShare: async function () {
            const saved = await ensureSavedFile();
            if (!saved) return;
            await shareSavedTxtFile(fileName, saved && saved.savedUri ? saved.savedUri : undefined, txtContent);
          },
          onOpen: async function () {
            const saved = await ensureSavedFile();
            if (!saved) return;
            const opened = openSavedFileLink(saved && saved.savedUri ? saved.savedUri : (saved && saved.relativePath ? saved.relativePath : null));
            if (statusEl) {
              statusEl.textContent = opened
                ? "✅ 저장 파일 링크 열기 시도: " + fileName
                : "⚠️ 링크 열기에 실패했습니다. 공유하기를 사용해 주세요.";
            }
          }
        });
      } catch (error) {
        console.warn("TXT Filesystem 저장 오류:", error);
        if (statusEl) {
          statusEl.textContent = "🔴 TXT 저장 실패: " + (error && error.message ? error.message : String(error));
        }
      }
      return;
    }

    const blob = new Blob([txtContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 1000);
    if (statusEl) statusEl.textContent = "✅ TXT 다운로드 시작: " + fileName;
  }

  function renderBears(items, isFallback) {
    if (!bearsListEl) return;
    syncSelectedBearEstimateIds(items);
    bearsListEl.innerHTML = "";

    if (!items || items.length === 0) {
      bearsListEl.innerHTML = '<div class="bears-empty">아직 목록이 없습니다.</div>';
      updateBearEstimateToolbar([]);
      return;
    }

    items.forEach(function (it) {
      const itemId = String(it.id);
      const isSelected = selectedBearEstimateIds.has(itemId);
      const el = document.createElement("div");
      el.className = "bears-item" + (isSelected ? " is-selected" : "");
      const lat = Number(it.lat);
      const lng = Number(it.lng);
      const timeLabel = formatKstTimeLabel(it.created_at || it.ts);
      const dateLabel = formatKstDateLabel(it.created_at || it.ts);
      const bearCode = it.bear_code || it.bearCode || "-";
      const latDms = it.lat_dms || decimalToDMS(lat, false);
      const lngDms = it.lng_dms || decimalToDMS(lng, true);
      // const projected = mapCoordFromWgs84(lat, lng); // EPSG:5179 목록표시(기존)
      const projected = legacyTmCoordFromWgs84(lat, lng);
      const mapX = Array.isArray(projected) && Number.isFinite(projected[0]) ? projected[0].toFixed(3) : "-";
      const mapY = Array.isArray(projected) && Number.isFinite(projected[1]) ? projected[1].toFixed(3) : "-";
      // 목록은 DMS와 X/Y를 우선 노출하고, lat/lng 줄은 요청에 따라 잠시 숨긴다.
      el.innerHTML =
        '<div class="bears-item__select">' +
          '<input class="bears-item__checkbox" type="checkbox" aria-label="곰 추정위치 선택" ' + (isSelected ? 'checked' : '') + ' />' +
        '</div>' +
        '<div class="bears-item__main">' +
          '<div><b>' + bearCode + '</b></div>' +
          '<div style="font-size:11px;opacity:.55">' + latDms + ' ' + lngDms + '</div>' +
          '<div style="font-size:11px;opacity:.6">X: ' + mapX + ' / Y: ' + mapY + '</div>' +
        '</div>' +
        '<div class="bears-item__meta">' +
          '<button class="bears-txt-dl-btn" type="button" aria-label="TXT 다운로드"><span class="bears-txt-dl-btn__label">TXT 다운로드</span></button>' +
          '<div class="bears-item__date">' + dateLabel + '</div>' +
          '<div class="bears-item__time">' + timeLabel + '</div>' +
        '</div>';

      el.addEventListener("click", function () {
        flyToLatLng([it.lat, it.lng], 16);
      });

      const dlBtn = el.querySelector(".bears-txt-dl-btn");
      if (dlBtn) {
        dlBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          downloadBearEstimateTxt(it, !!isFallback);
        });
      }

      const checkboxEl = el.querySelector(".bears-item__checkbox");
      if (checkboxEl) {
        checkboxEl.addEventListener("click", function (e) {
          e.stopPropagation();
        });
        checkboxEl.addEventListener("change", function (e) {
          if (e.target.checked) selectedBearEstimateIds.add(itemId);
          else selectedBearEstimateIds.delete(itemId);
          renderBears(currentBearEstimateItems, currentBearEstimateFallbackMode);
        });
      }

      bearsListEl.appendChild(el);
    });

    updateBearEstimateToolbar(items);
  }

  // 곰 목록 패널/마커를 동기화한다. 초기 시점 보존을 위해 자동 fit은 하지 않는다.
  async function refreshBearEstimatePanel() {
    const initState = await initializeEmbeddedDatabase();
    const isWebFallbackMode = !!(initState && initState.reason === "non-native-platform");

    if (!isWebFallbackMode && (!initState || !initState.ready)) {
      if (statusEl) statusEl.textContent = "🟠 SQLite 연결 대기 중입니다";
      currentBearEstimateItems = [];
      currentBearEstimateFallbackMode = false;
      renderBears([], false);
      renderBearMarkers([]);
      return;
    }

    const sqlite = getCapacitorSQLitePlugin();
    const dbName = window.BearSQLiteConfig && window.BearSQLiteConfig.dbName
      ? window.BearSQLiteConfig.dbName
      : "BearPointData";

    let items = [];
    let usedFallback = false;
    let hasQueryError = false;

    async function queryBearEstimatesRows() {
      let result = null;
      try {
        // 최신 스키마(lat_dms/lng_dms 컬럼 포함) 우선 조회
        result = await sqlite.query({
          database: dbName,
          statement: "SELECT id, bear_code, lat, lng, lat_dms, lng_dms, intersections_count, created_at FROM bear_estimates ORDER BY created_at DESC LIMIT 100",
          values: [],
          readonly: false
        });
      } catch (primaryQueryError) {
        const message = String(primaryQueryError && primaryQueryError.message ? primaryQueryError.message : primaryQueryError);
        if (/no such column: lat_dms|no such column: lng_dms/i.test(message)) {
          // 구버전 DB(도분초 컬럼 미생성)에서도 목록이 보이도록 하위호환 조회
          result = await sqlite.query({
            database: dbName,
            statement: "SELECT id, bear_code, lat, lng, intersections_count, created_at FROM bear_estimates ORDER BY created_at DESC LIMIT 100",
            values: [],
            readonly: false
          });
        } else {
          throw primaryQueryError;
        }
      }

      return result;
    }

    if (sqlite) {
      try {
        let result = await queryBearEstimatesRows();

        // 앱 첫 진입 타이밍에 연결 핸들이 늦게 준비되는 단말 대응: 1회 재초기화 후 재조회.
        if (!result || !Array.isArray(result.values)) {
          const retryState = await initializeEmbeddedDatabase();
          if (retryState && retryState.ready) {
            result = await queryBearEstimatesRows();
          }
        }

        if (result && Array.isArray(result.values)) {
          items = result.values.filter(function (row) {
            return row && typeof row === "object" && Number.isFinite(Number(row.lat)) && Number.isFinite(Number(row.lng));
          }).map(function (row) {
            return {
              id: row.id,
              bear_code: String(row.bear_code || "-"),
              lat: Number(row.lat),
              lng: Number(row.lng),
              lat_dms: row.lat_dms || null,
              lng_dms: row.lng_dms || null,
              intersections_count: row.intersections_count,
              created_at: row.created_at
            };
          });
        }
      } catch (queryError) {
        const message = String(queryError && queryError.message ? queryError.message : queryError);
        const isConnectionNotReady = /No available connection for database/i.test(message);

        if (isConnectionNotReady) {
          // 시작 직후 일시적 연결 지연은 오류 대신 대기 상태로 안내한다.
          if (statusEl) statusEl.textContent = "🟠 SQLite 연결 대기 중입니다";
        } else {
          hasQueryError = true;
          console.warn("[bear_estimates] 조회 실패:", queryError);
          if (statusEl) {
            statusEl.textContent = "🔴 곰 추정위치 조회 실패: " + message;
          }
        }
      }
    } else {
      await loadBearsData();
      items = getWebFallbackBearEstimates();
      usedFallback = true;
    }

    currentBearEstimateItems = items.slice();
    currentBearEstimateFallbackMode = usedFallback;

    renderBears(items, usedFallback);

    // renderBearMarkers는 bear_code/bearCode 모두 지원하는 구조로 변환해 전달한다.
    renderBearMarkers(items.map(function (it) {
      return { bearCode: it.bear_code || it.bearCode, lat: it.lat, lng: it.lng };
    }));

    if (!items.length) {
      if (!hasQueryError && statusEl) statusEl.textContent = "🟠 표시할 곰 추정위치가 없습니다";
      return;
    }

    if (statusEl) {
      statusEl.innerHTML = '<img src="assets/icons/icon_bear.png" style="height:18px;vertical-align:middle;margin-right:4px;" alt="곰"/> ' + items.length + '건 표시됨' + (usedFallback ? ' <span style="font-size:11px;opacity:.6">(샘플)</span>' : '');
    }
  }

  mountAnalysisActionBar();

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
    fitToPoints: fitToPoints,
    observationMarkersLayer: observationMarkersLayer,
    onOpenList: function () {
      if (controlsManager && typeof controlsManager.deactivateMeasure === "function") {
        controlsManager.deactivateMeasure("menu");
      }
      collapseBearEstimatePanel();
    },
    onOpenRegister: function () {
      if (controlsManager && typeof controlsManager.deactivateMeasure === "function") {
        controlsManager.deactivateMeasure("menu");
      }
      collapseBearEstimatePanel();
      if (obsRegisterModule) obsRegisterModule.open();
    },
    onEditObservation: function (item) {
      collapseBearEstimatePanel();
      if (obsRegisterModule && typeof obsRegisterModule.openForEdit === "function") {
        obsRegisterModule.openForEdit(item);
      }
    },
    onCloseRegister: function () {
      if (obsRegisterModule) obsRegisterModule.hide(true);
    },
    onAnalysisResult: function (analysisPoint) {
      if (controlsManager && typeof controlsManager.deactivateMeasure === "function") {
        controlsManager.deactivateMeasure("analysis");
      }
      renderAnalysisEstimatePoint(analysisPoint); // 내부에서 currentAnalysisPoint 설정
    },
    onAnalysisPreview: function (previewPayload) {
      if (previewPayload && controlsManager && typeof controlsManager.deactivateMeasure === "function") {
        controlsManager.deactivateMeasure("analysis");
      }
      renderAnalysisInputPreview(previewPayload);
    },
    onClearAnalysisEstimate: function () {
      clearAnalysisEstimateVisuals();
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
  ensureStartupOverlay();
  if (startupOverlayRetryBtn && startupOverlayRetryBtn.dataset.bound !== "1") {
    startupOverlayRetryBtn.dataset.bound = "1";
    startupOverlayRetryBtn.addEventListener("click", function () {
      bootWithSQLiteGate();
    });
  }
  bootWithSQLiteGate();
  setupAndroidBackButtonExit().catch(function (error) {
    console.error("안드로이드 뒤로가기 초기화 오류:", error);
  });

  if (statusEl && statusEl.textContent === "연결됨") {
    statusEl.textContent = "✅ 지도 초기화 완료";
  }

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
