// public/js/client.js

// ---------- DOM ----------
const statusEl = document.getElementById("status");
const btnBear = document.getElementById("btn-obs-list"); // 관측점 목록 버튼
const btnObsAdd = document.getElementById("btn-obs-add"); // 관측점 등록 버튼
const btnAnalysis = document.getElementById("btn-analysis");
const btnMe = document.getElementById("btn-me");       // (있다면) 내 위치 토글 버튼
const btnJiri = document.getElementById("btn-jiri");   // (있다면) 지리산 버튼

const compassNeedleFixedEl = document.getElementById("compass-needle");

//panel
const obsSheetEl = document.getElementById("obs-sheet");
const panelEl = document.getElementById("panel");
const panelBodyEl = document.getElementById("panel-body");
const btnPanelToggle = document.getElementById("btn-panel-toggle");
const registerBoxEl = document.getElementById("register-box");
const obsListPanelEl = document.getElementById("obs-list-panel");
const obsListBodyEl = document.getElementById("obs-list-body");
const currentCoordEl = document.getElementById("obs-current-coord");
const currentHeadingEl = document.getElementById("obs-current-heading");
const currentXyEl = document.getElementById("obs-current-xy");

const btnBearsToggle = document.getElementById("btn-bears-toggle");
const bearsListEl = document.getElementById("bears-list");
const bearsHintEl = document.getElementById("bears-hint");

const HEADING_OFFSET = {
  ios: 0,
  android: 0,
  other: 0
};


// ---------- 지도 기본 ----------
const JIRISAN_BOUNDS = L.latLngBounds(
  [35.15, 127.40], // SW
  [35.50, 127.85]  // NE
);

// 테스트용: true면 실제 GPS 대신 지리산 고정 좌표를 사용
const TEST_USE_JIRISAN_LOCATION = false;
const TEST_JIRISAN_LOCATION = [35.315, 127.655];

const DATA_CRS = "WGS84";

const map = L.map("map", { minZoom: 3, maxZoom: 18, zoomControl: false });
L.control.zoom({ position: "bottomright" }).addTo(map);

const osmBase = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap"
});

const topoBase = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  maxNativeZoom: 17,
  attribution: "Map data: &copy; OpenStreetMap contributors, SRTM | Style: &copy; OpenTopoMap"
});

const hillshadeOverlay = L.tileLayer("https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}", {
  maxZoom: 18,
  maxNativeZoom: 14,
  opacity: 0.32,
  attribution: "Hillshade &copy; Esri"
});

// 기본값: 지형도 + 음영 레이어
topoBase.addTo(map);
hillshadeOverlay.addTo(map);

L.control.layers(
  {
    "일반지도": osmBase,
    "지형도(OpenTopoMap)": topoBase
  },
  {
    "음영(Hillshade)": hillshadeOverlay
  },
  { collapsed: true }
).addTo(map);

const HILLSHADE_SAFE_MAX_ZOOM = 18;
const HILLSHADE_BASE_OPACITY = 0.32;

function syncHillshadeByZoom() {
  const zoom = map.getZoom();
  if (!map.hasLayer(hillshadeOverlay)) return;

  // 레이어 체크 상태는 유지하고, 고줌에서만 시각적으로 숨긴다.
  hillshadeOverlay.setOpacity(zoom > HILLSHADE_SAFE_MAX_ZOOM ? 0 : HILLSHADE_BASE_OPACITY);
}

map.on("zoomend", syncHillshadeByZoom);
map.on("overlayadd", (e) => {
  if (e.layer === hillshadeOverlay) {
    syncHillshadeByZoom();
  }
});

// ✅ 첫 화면은 지리산
map.fitBounds(JIRISAN_BOUNDS, { padding: [20, 20], maxZoom: 14 });
//map.setView(JIRISAN_BOUNDS.getCenter(), 11); //처음 시작 시 확대

// ---------- 유틸 ----------
function flyToLatLng(latlng, zoom = 16) {
  map.flyTo(latlng, zoom, { duration: 0.7 });
}

// ---------- 내 위치 마커(방향 화살표) ----------
function createHeadingIcon(wrapSize = 64, svgSize = 48) {
  const c = svgSize / 2;

  return L.divIcon({
    className: "my-heading-icon",
    html: `
      <div class="dot" style="width:${wrapSize}px;height:${wrapSize}px;display:flex;align-items:center;justify-content:center;">
        <svg class="dir" width="${svgSize}" height="${svgSize}" viewBox="0 0 ${svgSize} ${svgSize}" aria-hidden="true">
          <path d="M ${c} 4 L ${c + 9} ${c - 2} L ${c} ${c - 6} L ${c - 9} ${c - 2} Z" fill="#2b7cff"/>
          <circle cx="${c}" cy="${c+3}" r="6" fill="#2b7cff"/>
        </svg>
      </div>
    `,
    iconSize: [wrapSize, wrapSize],
    iconAnchor: [wrapSize / 2, wrapSize / 2]
  });
}

// ✅ 내 위치 마커(처음엔 지도에 올리지 않음)
const myMarker = L.marker([0, 0], { icon: createHeadingIcon(48) });
let isMyVisible = false;
let watchId = null;
let didMoveToMe = false;

// ---------- 방향 센서(나침반) ----------

const COMPASS_CFG = {
  // heading 스무딩 정도(0~1). 낮을수록 부드럽지만 늦게 따라옴
  smoothAlpha: 0.25,

  // 갑자기 이 각도 이상 튀면(outlier) 강하게 완화
  jumpThresholdDeg: 70,

  // 튐(outlier)이 연속으로 많이 나오면 "불안정" 판정
  unstableWindowMs: 2500,
  unstableCount: 6,

  // unstable이면 표시를 잠깐 멈추거나(선택) 마지막 안정값 유지
  freezeOnUnstable: true,

  // 디버그(필요하면 true)
  debug: false
};


let compassEnabled = false;
let compassHandler = null;
let compassEventName = null;
let headingSmoothed = null;
let lastHeadingDeg = null;
let lastAbsoluteSampleTs = 0;

let unstableHits = []; // timestamp list
let lastStableDeg = null;

function norm360(deg) {
  return (deg % 360 + 360) % 360;
}

// a-b를 -180~180 범위로
function angleDelta(a, b) {
  let d = norm360(a - b);
  if (d > 180) d -= 360;
  return d;
}

function getScreenAngle() {
  const a = screen?.orientation?.angle;
  if (typeof a === "number") return a; // 0/90/180/270
  const o = window.orientation;
  if (typeof o === "number") return o;
  return 0;
}

function pickClosestHeading(candidates, referenceDeg) {
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  if (!Number.isFinite(referenceDeg)) return candidates[0];

  let best = candidates[0];
  let bestDiff = Math.abs(angleDelta(candidates[0], referenceDeg));

  for (let i = 1; i < candidates.length; i += 1) {
    const diff = Math.abs(angleDelta(candidates[i], referenceDeg));
    if (diff < bestDiff) {
      best = candidates[i];
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

// 플랫폼별 미세 보정(필요할 때만 숫자 조금)
function applyHeadingOffset(deg, platform = getPlatform()) {
  const off = HEADING_OFFSET[platform] ?? HEADING_OFFSET.other ?? 0;
  return norm360(deg + off);
}

// --- 핵심: 이벤트 -> 북 기준 heading(best effort) ---
function computeHeadingFromEvent(e) {
  const screenAngle = getScreenAngle(); // 0/90/180/270

  // 1) iOS: webkitCompassHeading (북 기준)
  if (typeof e.webkitCompassHeading === "number") {
    // 보통 iOS는 screenAngle 보정 불필요(필요하면 +screenAngle)
    return norm360(e.webkitCompassHeading);
  }

  // 2) absolute가 true인 경우(일부 Android / Chrome)
  // 기기/브라우저마다 screenAngle 포함 여부가 달라 90도 오차가 날 수 있어
  // 후보식을 만들고 이전 heading과 가장 가까운 값을 선택
  if (e.absolute === true && typeof e.alpha === "number") {
    const raw = norm360(360 - e.alpha);
    const candidates = [
      raw,
      norm360(raw + screenAngle),
      norm360(raw - screenAngle)
    ];
    return pickClosestHeading(candidates, headingSmoothed);
  }

  // 3) fallback: 일반 deviceorientation alpha
  // (상대방위일 수 있음)
  if (typeof e.alpha === "number") {
    const raw = norm360(360 - e.alpha);
    const candidates = [
      raw,
      norm360(raw + screenAngle),
      norm360(raw - screenAngle)
    ];
    return pickClosestHeading(candidates, headingSmoothed);
  }

  return null;
}

// --- 스무딩 + 점프 완화 ---
function filterHeading(nextDeg) {
  // 첫 값
  if (headingSmoothed === null) {
    headingSmoothed = nextDeg;
    lastStableDeg = nextDeg;
    return nextDeg;
  }

  // 현재값과 차이
  const d = angleDelta(nextDeg, headingSmoothed);
  const absD = Math.abs(d);

  // 점프(45/180 등)로 추정되는 큰 튐: outlier 기록
  if (absD >= COMPASS_CFG.jumpThresholdDeg) {
    unstableHits.push(Date.now());
    // 오래된 기록 제거
    const cut = Date.now() - COMPASS_CFG.unstableWindowMs;
    unstableHits = unstableHits.filter(t => t >= cut);

    // unstable 판정
    if (unstableHits.length >= COMPASS_CFG.unstableCount) {
      if (COMPASS_CFG.freezeOnUnstable && lastStableDeg !== null) {
        // 마지막 안정값 유지
        return lastStableDeg;
      }
      // freeze 안 하면 그래도 천천히 따라가게
      headingSmoothed = norm360(headingSmoothed + d * 0.08);
      return headingSmoothed;
    }

    // 아직 unstable까진 아니면 "강하게 완화"해서 조금만 이동
    headingSmoothed = norm360(headingSmoothed + d * 0.12);
    return headingSmoothed;
  }

  // 정상 범위: 저역통과 필터
  headingSmoothed = norm360(headingSmoothed + d * COMPASS_CFG.smoothAlpha);
  lastStableDeg = headingSmoothed;
  return headingSmoothed;
}


function setHeading(deg) {
  if (!Number.isFinite(deg)) return;
  lastHeadingDeg = deg;

  // ✅ (1) 나침반 바늘은 반대로 (진짜 나침반 느낌)
  if (compassNeedleFixedEl) {
    compassNeedleFixedEl.style.transform = `rotate(${-deg}deg)`;
  }

  // ✅ (2) 내 위치 마커(화살표)는 그대로 deg
  const el = myMarker.getElement?.();
  if (!el) return;

  const dot = el.querySelector(".dot");
  if (!dot) return;

  dot.style.transform = `rotate(${deg}deg)`;
}

async function startCompass() {
  if (compassEnabled) return;

  // iOS 권한 요청(버튼 클릭 흐름 안에서 호출되어야 안정적)
  if (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof DeviceOrientationEvent.requestPermission === "function"
  ) {
    const perm = await DeviceOrientationEvent.requestPermission();
    if (perm !== "granted") {
      statusEl.textContent = "🟠 나침반 권한 거부됨";
      return;
    }
  }

  compassHandler = (e) => {
    if (e.type === "deviceorientationabsolute") {
      lastAbsoluteSampleTs = Date.now();
    }

    // absolute 샘플이 최근에 들어온 경우, 상대 샘플은 무시
    if (
      e.type === "deviceorientation" &&
      lastAbsoluteSampleTs > 0 &&
      Date.now() - lastAbsoluteSampleTs < 1500
    ) {
      return;
    }

    const heading = computeHeadingFromEvent(e);
    if (!Number.isFinite(heading)) return;

    const corrected = applyHeadingOffset(heading);
    const smoothed = filterHeading(corrected);
    setHeading(smoothed);
  };

  const hasAbsoluteEvent = "ondeviceorientationabsolute" in window;
  compassEventName = hasAbsoluteEvent ? "deviceorientationabsolute" : "deviceorientation";
  window.addEventListener(compassEventName, compassHandler, true);

  // absolute 이벤트가 없거나 동작하지 않는 브라우저 대비 폴백
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

  if (compassNeedleFixedEl) compassNeedleFixedEl.style.transform = "rotate(0deg)";
}

// ---------- 우하단 내 위치(조준) 버튼 ----------
let locateBtnEl = null;

const LocateButtonControl = L.Control.extend({
  options: { position: "bottomright" },
  onAdd: function () {
    const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
    const btn = L.DomUtil.create("a", "leaflet-control-locate-btn", container);

    locateBtnEl = btn;

    btn.href = "#";
    btn.title = "내 위치 토글";
    btn.setAttribute("role", "button");
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M12 19v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M2 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <path d="M19 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="2"/>
        <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
      </svg>
    `;

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.on(btn, "click", async (e) => {
      L.DomEvent.preventDefault(e);
      await toggleMyLocation();
    });

    return container;
  }
});

// ---------- 우하단 지리산(산) 버튼 ----------
const JirisanButtonControl = L.Control.extend({
  options: { position: "bottomright" },
  onAdd: function () {
    const container = L.DomUtil.create("div", "leaflet-bar leaflet-control");
    const btn = L.DomUtil.create("a", "leaflet-control-jiri-btn", container);

    btn.href = "#";
    btn.title = "지리산으로 이동";
    btn.setAttribute("role", "button");
    btn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 19l6.5-11L16 19H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        <path d="M10.5 19l4.5-8 6 8h-10.5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
        <path d="M9.5 8l1.2 2 1.3-2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    `;

    L.DomEvent.disableClickPropagation(container);
    L.DomEvent.on(btn, "click", (e) => {
      L.DomEvent.preventDefault(e);
      map.fitBounds(JIRISAN_BOUNDS, { padding: [20, 20] });
    });

    return container;
  }
});

// ✅ 쌓이는 순서: 산(위) -> 조준(아래) -> +/-
map.addControl(new JirisanButtonControl());
map.addControl(new LocateButtonControl());

// ---------- 내 위치 토글(ON/OFF) + GPS/나침반 연동 ----------
async function toggleMyLocation() {
  // ON -> OFF
  if (isMyVisible || watchId !== null) {
    stopCompass();
    locateBtnEl?.classList.remove("is-active");

    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (map.hasLayer(myMarker)) map.removeLayer(myMarker);

    isMyVisible = false;
    didMoveToMe = false;

    statusEl.textContent = "⚪ 내 위치 OFF";
    return;
  }

  // OFF -> ON
  if (!navigator.geolocation) {
    locateBtnEl?.classList.remove("is-active");
    statusEl.textContent = "🔴 이 브라우저는 위치 기능을 지원하지 않음";
    return;
  }

  await startCompass();

  if (TEST_USE_JIRISAN_LOCATION) {
    const latlng = TEST_JIRISAN_LOCATION;

    myMarker.setLatLng(latlng);
    if (!isMyVisible) {
      myMarker.addTo(map);
      isMyVisible = true;
      locateBtnEl?.classList.add("is-active");
    }

    if (!didMoveToMe) {
      didMoveToMe = true;
      flyToLatLng(latlng, 16);
    }

    if (lastHeadingDeg !== null) setHeading(lastHeadingDeg);
    statusEl.textContent = "🧪 테스트 위치 ON (지리산 기준)";

    // 실제 GPS는 테스트 중 비활성화
    // navigator.geolocation.getCurrentPosition(...)
    // watchId = navigator.geolocation.watchPosition(...)
    return;
  }

statusEl.textContent = "📍 내 위치 잡는 중…(최초는 10~30초 소요 가능)";
didMoveToMe = false;

const optsFast  = { enableHighAccuracy: false, timeout: 30000, maximumAge: 15000 };
const optsWatch = { enableHighAccuracy: true,  timeout: 30000, maximumAge: 5000 };

// 1) 먼저 한번 잡기(빠르게)
navigator.geolocation.getCurrentPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const latlng = [lat, lng];

      myMarker.setLatLng(latlng);
      if (!isMyVisible) {
        myMarker.addTo(map);
        isMyVisible = true;
        locateBtnEl?.classList.add("is-active");
      }
      if (!didMoveToMe) {
        didMoveToMe = true;
        flyToLatLng(latlng, 16);
      }
      if (lastHeadingDeg !== null) setHeading(lastHeadingDeg);

      //statusEl.textContent = `✅ 내 위치 ON: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
      statusEl.textContent = `✅ 내 위치 ON`;
    },
    (err) => {
      // 최초 1회 실패해도 watch로 계속 시도하니 치명적 아님
      console.log("getCurrentPosition failed:", err);
    },
    optsFast
  );

  // 2) 그 다음 추적(실시간)
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const latlng = [lat, lng];

      myMarker.setLatLng(latlng);

      if (!isMyVisible) {
        myMarker.addTo(map);
        isMyVisible = true;
        locateBtnEl?.classList.add("is-active");
      }
      if (lastHeadingDeg !== null) setHeading(lastHeadingDeg);

      statusEl.textContent = `✅ 내 위치 ON: ${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    },
    (err) => {
      console.log(err);

      // watch가 진짜 실패하면 OFF로 롤백
      if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
      }
      stopCompass();

      if (map.hasLayer(myMarker)) map.removeLayer(myMarker);
      isMyVisible = false;
      didMoveToMe = false;
      locateBtnEl?.classList.remove("is-active");

      statusEl.textContent = `🔴 위치 오류: ${err.message}`;
    },
    optsWatch
  );
}

// 좌측 내 위치 버튼이 있다면 동일 토글로 연결
btnMe?.addEventListener("click", async () => {
  await toggleMyLocation();
});

// 좌측 지리산 버튼이 있다면 연결
btnJiri?.addEventListener("click", () => {
  map.fitBounds(JIRISAN_BOUNDS, { padding: [20, 20] });
});

// ---------- 곰 위치(더미) : 버튼 클릭 시 목록/마커 갱신 ----------
const bearIcon = L.icon({
  iconUrl: "/assets/icons/icon_bear.png",
  iconSize: [34, 34],
  iconAnchor: [17, 30],
  popupAnchor: [0, -26]
});

const bearMarkersLayer = L.layerGroup().addTo(map);
const observationMarkersLayer = L.layerGroup().addTo(map);
const observationMarkers = [];

const observationSamples = [
  { id: "p1", bearCode: "001", owner: "1팀", lat: 35.3112, lng: 127.6551, x: "312451.22", y: "248913.88", heading: "124°" },
  { id: "p2", bearCode: "001", owner: "2팀", lat: 35.3131, lng: 127.6624, x: "313126.70", y: "249085.20", heading: "82°" },
  { id: "p3", bearCode: "002", owner: "3팀", lat: 35.3157, lng: 127.6493, x: "311878.54", y: "249362.14", heading: "301°" }
];

let currentTab = "none";

let bearsDataCache = [];

async function loadBearsData() {
  try {
    const res = await fetch("/json/bears.json", { cache: "no-store" });
    bearsDataCache = await res.json();
  } catch (e) {
    console.error("bears.json 로드 실패:", e);
    bearsDataCache = [];
  }
}

function makeDummyBearsNearJirisan() {
  if (!bearsDataCache.length) return [];

  // 모든 곰을 선택 (스크롤 테스트용)
  const picked = [...bearsDataCache]
    .sort(() => Math.random() - 0.5);

  return picked.map((bearRecord) => {
    const basePoint = bearRecord.basePoints[
      Math.floor(Math.random() * bearRecord.basePoints.length)
    ];

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
  bearMarkersLayer.clearLayers();

  for (const it of items) {
    const marker = L.marker([it.lat, it.lng], { icon: bearIcon });
    marker.bindPopup(`🐻 ${it.id}<br/>${it.lat.toFixed(6)}, ${it.lng.toFixed(6)}`, {
      className: 'bear-popup'
    });
    marker.bindTooltip(it.id, { 
      permanent: true, 
      direction: 'top', 
      offset: [0, -25],
      className: 'bear-label'
    });
    bearMarkersLayer.addLayer(marker);
  }
}

function renderBears(items) {
  bearsListEl.innerHTML = "";

  if (!items || items.length === 0) {
    bearsListEl.innerHTML = `<div class="bears-empty">아직 목록이 없습니다.</div>`;
    return;
  }

  for (const it of items) {
    const el = document.createElement("div");
    el.className = "bears-item";
    el.innerHTML = `
      <div>
        <div><b>${it.id ?? "-"}</b></div>
        <div style="font-size:12px;opacity:.7">${it.lat.toFixed(6)}, ${it.lng.toFixed(6)}</div>
      </div>
      <div style="font-size:12px;opacity:.7;align-self:center">
        ${new Date(it.ts ?? Date.now()).toLocaleTimeString()}
      </div>
    `;

    el.addEventListener("click", () => {
      flyToLatLng([it.lat, it.lng], 16);
    });

    bearsListEl.appendChild(el);
  }
}

function createObservationIcon(item, zoom = map.getZoom()) {
  // 줌 14를 기준으로 아이콘 배율을 계산하고, 과도한 확대/축소는 clamp로 제한한다.
  const baseZoom = 14;
  const rawScale = Math.pow(2, (zoom - baseZoom) * 0.16);
  const scale = Math.min(1.05, Math.max(0.65, rawScale));

  // 배율(scale)을 아이콘 구성요소 크기(원, 꼬리, 텍스트, 앵커)로 분해한다.
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
    marker.bindPopup(`관측점 ${item.id}<br/>곰 코드 ${item.bearCode}<br/>등록자 ${item.owner}`);
    observationMarkersLayer.addLayer(marker);
    observationMarkers.push(marker);
  }
}

function updateObservationMarkerScale() {
  const zoom = map.getZoom();

  for (const marker of observationMarkers) {
    if (!marker?.obsData) continue;
    marker.setIcon(createObservationIcon(marker.obsData, zoom));
  }
}

map.on("zoomend", () => {
  if (currentTab === "list") {
    updateObservationMarkerScale();
  }
});

function renderObservationList(items) {
  if (!obsListBodyEl) return;

  obsListBodyEl.innerHTML = "";

  for (const item of items) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${item.id}</td>
      <td>${item.x}, ${item.y}</td>
      <td>${item.bearCode}</td>
      <td>${item.owner}</td>
      <td>
        <div class="obs-actions">
          <button class="obs-action-btn edit" type="button" data-action="edit">수정</button>
          <button class="obs-action-btn delete" type="button" data-action="delete">삭제</button>
        </div>
      </td>
    `;

    // 행 클릭은 위치 이동 용도이고, 버튼 클릭은 별도 액션으로 분리한다.
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
      flyToLatLng([item.lat, item.lng], 17);
    });

    obsListBodyEl.appendChild(row);
  }
}

function updateRegistrationPreview() {
  const baseLatLng = TEST_USE_JIRISAN_LOCATION ? TEST_JIRISAN_LOCATION : [35.315, 127.655];
  const previewHeading = lastHeadingDeg !== null ? `${Math.round(lastHeadingDeg)}°` : "124°";

  if (currentCoordEl) {
    currentCoordEl.textContent = `${baseLatLng[0].toFixed(6)}, ${baseLatLng[1].toFixed(6)}`;
  }
  if (currentHeadingEl) {
    currentHeadingEl.textContent = previewHeading;
  }
  if (currentXyEl) {
    currentXyEl.textContent = "312451.22, 248913.88";
  }
}

function setTabLayout(tab) {
  currentTab = tab;
  const isList = tab === "list";

  // 목록 탭을 해제하면 열려 있던 팝업을 닫아 화면을 정리한다.
  if (!isList) {
    map.closePopup();
  }

  obsSheetEl?.classList.toggle("hidden", !isList);
  registerBoxEl?.classList.toggle("hidden", isList);
  obsListPanelEl?.classList.toggle("hidden", !isList);
  observationMarkersLayer.clearLayers();

  if (isList) {
    renderObservationList(observationSamples);
    renderObservationMarkers(observationSamples);
  }
}

async function refreshDummyBearsAndFocus() {
  statusEl.textContent = "🐻 곰 더미 위치 생성중…";

  await loadBearsData();
  const items = makeDummyBearsNearJirisan();
  renderBears(items);
  renderBearMarkers(items);

  if (!items.length) {
    statusEl.textContent = "🟠 표시할 곰 더미 데이터가 없습니다";
    return;
  }

  const bounds = L.latLngBounds(items.map((it) => [it.lat, it.lng]));
  map.fitBounds(bounds.pad(0.1), { padding: [20, 20], maxZoom: 14 });
  statusEl.innerHTML = `<img src="/assets/icons/icon_bear.png" style="height:18px;vertical-align:middle;margin-right:4px;" alt="곰"/> ${items.length}마리 표시됨`;
}

// ---------- 탭 전환 ----------
function setActiveTab(activeBtn) {
  [btnBear, btnObsAdd].forEach(b => b?.classList.remove("tab-active"));
  activeBtn?.classList.add("tab-active");
}

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
  updateRegistrationPreview();
  statusEl.textContent = "🧭 현재 위치와 방향각으로 관측점 등록 준비";
});

btnAnalysis?.addEventListener("click", () => {
  statusEl.textContent = "📐 위치분석 UI 준비 중";
});


btnPanelToggle?.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();

  const collapsed = panelEl.classList.toggle("collapsed");
  btnPanelToggle.textContent = collapsed ? "▲" : "▼";
  btnPanelToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
});

// 패널 위에서 지도 드래그/클릭 방지(모바일에서 특히 유용)
panelEl?.addEventListener("pointerdown", (e) => e.stopPropagation());
panelEl?.addEventListener("touchstart", (e) => e.stopPropagation(), { passive: true });
panelEl?.addEventListener("wheel", (e) => e.stopPropagation(), { passive: true });

// ---------- 초기화 ----------
(async function initializeUI() {
  updateRegistrationPreview();
  setTabLayout(currentTab);
  setActiveTab(currentTab === "list" ? btnBear : null);

  // 임시: bears.json 데이터를 로드해서 곰 추정위치 목록에 표시
  await refreshDummyBearsAndFocus();
})();