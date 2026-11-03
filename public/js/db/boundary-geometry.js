(function (root) {
  "use strict";

  // SHP Polygon record: all rings use even/odd containment, including holes
  // and disconnected islands. Points on an edge are included.
  function contains(bytes, x, y) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getInt32(0, true) !== 5) throw new Error("Unsupported boundary geometry");
    const parts = view.getInt32(36, true);
    const count = view.getInt32(40, true);
    const offset = 44 + parts * 4;
    let inside = false;
    for (let part = 0; part < parts; part++) {
      const start = view.getInt32(44 + part * 4, true);
      const end = part + 1 < parts ? view.getInt32(48 + part * 4, true) : count;
      for (let i = start, j = end - 1; i < end; j = i++) {
        const ax = view.getFloat64(offset + j * 16, true);
        const ay = view.getFloat64(offset + j * 16 + 8, true);
        const bx = view.getFloat64(offset + i * 16, true);
        const by = view.getFloat64(offset + i * 16 + 8, true);
        const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
        if (Math.abs(cross) <= 1e-12 * Math.max(Math.abs(bx - ax), Math.abs(by - ay)) &&
            x >= Math.min(ax, bx) && x <= Math.max(ax, bx) &&
            y >= Math.min(ay, by) && y <= Math.max(ay, by)) return true;
        if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
      }
    }
    return inside;
  }

  const MIN_DISPLAY_ZOOM = 11;
  const DISPLAY_LIMIT = 80;
  function displayOptions(bounds, zoom) {
    if (!Array.isArray(bounds) || bounds.length !== 4 || bounds.some(n => typeof n !== "number" || !Number.isFinite(n))
      || bounds[0] < -180 || bounds[2] > 180 || bounds[1] < -90 || bounds[3] > 90 || bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) throw new Error("지도 범위를 확인해주세요.");
    if (!Number.isInteger(zoom) || zoom < 0 || zoom > 24) throw new Error("지도 확대 수준을 확인해주세요.");
    return { bounds, zoom, minZoom: MIN_DISPLAY_ZOOM, limit: DISPLAY_LIMIT };
  }
  // Iterative Douglas-Peucker is for display only; containment always uses original bytes.
  function simplify(points, tolerance) {
    if (points.length < 5 || !tolerance) return points;
    const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
    const stack = [0, points.length - 1], threshold = tolerance * tolerance;
    while (stack.length) {
      const end = stack.pop(), start = stack.pop(), a = points[start], b = points[end];
      const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
      let greatest = threshold, chosen = -1;
      for (let i = start + 1; i < end; i++) {
        const p = points[i], t = length ? Math.max(0, Math.min(1, ((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)) : 0;
        const x = p[0]-a[0]-t*dx, y = p[1]-a[1]-t*dy, distance = x*x+y*y;
        if (distance > greatest) { greatest = distance; chosen = i; }
      }
      if (chosen >= 0) { keep[chosen] = 1; stack.push(start, chosen, chosen, end); }
    }
    return points.filter((_, i) => keep[i]);
  }
  function displayFeature(row, bytes, zoom) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.byteLength < 44 || view.getInt32(0, true) !== 5) throw new Error("Unsupported boundary geometry");
    const parts = view.getInt32(36, true), count = view.getInt32(40, true), offset = 44 + parts * 4;
    if (parts < 1 || count < 0 || offset + count * 16 > view.byteLength) throw new Error("Invalid boundary geometry");
    const coordinates = [], tolerance = Math.min(0.0003, 540 / (256 * 2 ** zoom));
    for (let part = 0; part < parts; part++) {
      const start = view.getInt32(44 + part * 4, true), end = part + 1 < parts ? view.getInt32(48 + part * 4, true) : count;
      if (start < 0 || end > count || end < start) throw new Error("Invalid boundary ring");
      const ring = [];
      for (let i = start; i < end; i++) ring.push([view.getFloat64(offset + i * 16, true), view.getFloat64(offset + i * 16 + 8, true)]);
      const line = simplify(ring, tolerance);
      if (line.length >= 4) coordinates.push(line);
    }
    return { type: "Feature", id: row.id, properties: { name: row.display_name, code: row.emd_code }, geometry: { type: "MultiLineString", coordinates } };
  }
  const api = { contains, displayOptions, displayFeature, MIN_DISPLAY_ZOOM, DISPLAY_LIMIT };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BearBoundaryGeometry = api;
})(typeof window !== "undefined" ? window : globalThis);
