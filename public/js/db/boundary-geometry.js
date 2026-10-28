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

  const api = { contains };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.BearBoundaryGeometry = api;
})(typeof window !== "undefined" ? window : globalThis);
