(function (root) {
  'use strict';
  root.BearAnalysisViewport = {
    extent(origins, endpoints, intersections, distance) {
      if (!origins.length) return null;
      if (origins.length === 1) {
        const [x, y] = origins[0];
        return [x - distance, y - distance, x + distance, y + distance];
      }
      const points = intersections.length ? origins.concat(intersections) : origins.concat(endpoints);
      if (!points.length) return null;
      const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
      if (!intersections.length) return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      const cx = intersections.reduce((sum, point) => sum + point[0], 0) / intersections.length;
      const cy = intersections.reduce((sum, point) => sum + point[1], 0) / intersections.length;
      const rx = Math.max(...xs.map(x => Math.abs(x - cx)), 1);
      const ry = Math.max(...ys.map(y => Math.abs(y - cy)), 1);
      return [cx - rx, cy - ry, cx + rx, cy + ry];
    }
  };
})(window);
