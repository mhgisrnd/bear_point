// public/js/mapBase.js

// ---------- 지도 기본 ----------
const JIRISAN_BOUNDS = L.latLngBounds(
  [35.15, 127.40], // SW
  [35.50, 127.85]  // NE
);

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

// 내보내기
window.mapBase = {
  map,
  JIRISAN_BOUNDS,
  DATA_CRS,
  flyToLatLng,
  osmBase,
  topoBase,
  hillshadeOverlay
};
