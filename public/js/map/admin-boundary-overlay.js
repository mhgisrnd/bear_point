(function () {
  "use strict";
  window.createAdminBoundaryOverlay = function ({ ol, map, insertBefore, onStatus }) {
    const source = new ol.source.Vector();
    const layer = new ol.layer.Vector({ source, visible: false, minZoom: 10.99,
      style: [new ol.style.Style({stroke:new ol.style.Stroke({color:"rgba(255,255,255,0.85)",width:3.5})}),
        new ol.style.Style({stroke:new ol.style.Stroke({color:"rgba(105,77,157,0.9)",width:1.4})})] });
    const layers = map.getLayers(), index = layers.getArray().indexOf(insertBefore);
    if (index >= 0) layers.insertAt(index, layer); else map.addLayer(layer);
    let enabled = false, generation = 0, running = false, dirty = false, lastMessage = "";
    const preferenceKey = "bearpoint.admin-boundary-visible";
    function tell(message) { if (message !== lastMessage && onStatus) onStatus(message); lastMessage = message; }
    async function refresh() {
      generation++; dirty = true;
      if (running) return;
      running = true;
      try {
        while (dirty) {
          dirty = false;
          const request = generation;
          if (!enabled) continue;
          const view = map.getView(), zoom = Math.floor(view.getZoom()), size = map.getSize();
          if (!size) continue;
          if (zoom < window.BearBoundaryGeometry.MIN_DISPLAY_ZOOM) {
            source.clear(); tell("행정경계망은 지도를 확대하면 표시됩니다."); continue;
          }
          try {
            const extent = ol.proj.transformExtent(view.calculateExtent(size), view.getProjection(), "EPSG:4326", 8);
            const bounds = [Math.max(-180,extent[0]),Math.max(-90,extent[1]),Math.min(180,extent[2]),Math.min(90,extent[3])];
            const data = await window.BearAdminBoundary.visible(bounds, zoom);
            if (request !== generation || !enabled) continue;
            const features = new ol.format.GeoJSON().readFeatures(data, { dataProjection: "EPSG:4326", featureProjection: view.getProjection() });
            source.clear(); source.addFeatures(features);
            tell(data.limited ? "경계가 많은 지역입니다. 지도를 더 확대해주세요." : features.length ? "읍·면·동 행정경계망 표시 중" : "현재 화면에 표시할 행정경계가 없습니다.");
          } catch (error) {
            if (request !== generation || !enabled) continue;
            source.clear(); tell("행정경계망을 불러오지 못했습니다. 다시 켜서 시도해주세요.");
            console.warn("[Boundary layer]", error.message);
          }
        }
      } finally { running = false; }
    }
    function setVisible(value) {
      enabled = !!value; layer.setVisible(enabled);
      try { window.localStorage.setItem(preferenceKey,String(enabled)); } catch (_) {}
      if (!enabled) { generation++; source.clear(); tell("행정경계망 꺼짐"); }
      else { lastMessage = ""; void refresh(); }
    }
    map.on("moveend", () => { if (enabled) void refresh(); });
    try { if (window.localStorage.getItem(preferenceKey) === "true") setVisible(true); } catch (_) {}
    return { setVisible, getVisible: () => enabled, layer };
  };
})();
