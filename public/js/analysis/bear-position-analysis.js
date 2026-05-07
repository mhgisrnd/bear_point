// public/js/analysis/bear-position-analysis.js
// 위치분석 계산 전용 모듈

(function initBearPositionAnalysisModule() {
  const EARTH_RADIUS_M = 6378137;

  function toRadians(deg) {
    return (deg * Math.PI) / 180;
  }

  function toDegrees(rad) {
    return (rad * 180) / Math.PI;
  }

  function norm360(value) {
    const normalized = value % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  }

  function parseHeadingDegrees(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return norm360(value);
    }
    if (typeof value !== "string") return null;

    const cleaned = value.replace(/[^0-9+-.]/g, "");
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed)) return null;
    return norm360(parsed);
  }

  function toLocalXY(lat, lng, originLat) {
    const latRad = toRadians(lat);
    const lngRad = toRadians(lng);
    const originLatRad = toRadians(originLat);
    const x = EARTH_RADIUS_M * lngRad * Math.cos(originLatRad);
    const y = EARTH_RADIUS_M * latRad;
    return [x, y];
  }

  function toLatLng(x, y, originLat) {
    const originLatRad = toRadians(originLat);
    const latRad = y / EARTH_RADIUS_M;
    const lngRad = x / (EARTH_RADIUS_M * Math.cos(originLatRad));
    return {
      lat: toDegrees(latRad),
      lng: toDegrees(lngRad)
    };
  }

  // 북쪽(0도) 기준 시계방향 방위각을 XY 벡터(동,북)로 변환한다.
  function bearingToUnitVector(bearingDeg) {
    const rad = toRadians(norm360(bearingDeg));
    const dx = Math.sin(rad);
    const dy = Math.cos(rad);
    return [dx, dy];
  }

  function lineIntersection(rayA, rayB) {
    const [x1, y1] = rayA.point;
    const [vx1, vy1] = rayA.direction;
    const [x2, y2] = rayB.point;
    const [vx2, vy2] = rayB.direction;

    const det = vx1 * vy2 - vy1 * vx2;
    if (Math.abs(det) < 1e-9) {
      return { kind: "parallel" };
    }

    const rx = x2 - x1;
    const ry = y2 - y1;
    const t1 = (rx * vy2 - ry * vx2) / det;
    const t2 = (rx * vy1 - ry * vx1) / det;

    return {
      kind: "ok",
      t1,
      t2,
      point: [x1 + t1 * vx1, y1 + t1 * vy1]
    };
  }

  function averagePoint(points) {
    if (!Array.isArray(points) || points.length === 0) return null;
    let sx = 0;
    let sy = 0;
    for (const p of points) {
      sx += p[0];
      sy += p[1];
    }
    return [sx / points.length, sy / points.length];
  }

  function maxDistanceFrom(points, center) {
    if (!Array.isArray(points) || points.length === 0 || !center) return null;
    let maxDist = 0;
    for (const p of points) {
      const dx = p[0] - center[0];
      const dy = p[1] - center[1];
      const dist = Math.hypot(dx, dy);
      if (dist > maxDist) maxDist = dist;
    }
    return maxDist;
  }

  function validateObservations(observations) {
    if (!Array.isArray(observations) || observations.length < 2) {
      return { ok: false, code: "NEED_MIN_TWO", message: "관측점은 2개 이상 필요합니다." };
    }

    const bearCode = String(observations[0].bearCode || "").trim();
    if (!bearCode) {
      return { ok: false, code: "BEAR_CODE_REQUIRED", message: "곰 코드가 없는 관측점은 분석할 수 없습니다." };
    }

    for (const obs of observations) {
      if (String(obs.bearCode || "").trim() !== bearCode) {
        return { ok: false, code: "MISMATCH_BEAR_CODE", message: "동일한 곰 코드 관측점만 함께 분석할 수 있습니다." };
      }

      if (!Number.isFinite(Number(obs.lat)) || !Number.isFinite(Number(obs.lng))) {
        return { ok: false, code: "INVALID_COORDINATE", message: "좌표가 올바르지 않은 관측점이 있습니다." };
      }

      const headingDeg = parseHeadingDegrees(obs.heading);
      if (!Number.isFinite(headingDeg)) {
        return { ok: false, code: "INVALID_HEADING", message: "방향각(heading) 값이 없는 관측점이 있습니다." };
      }
    }

    return { ok: true, bearCode };
  }

  function analyzePosition(observations, options) {
    const opts = options || {};
    const validation = validateObservations(observations);
    if (!validation.ok) {
      return {
        ok: false,
        code: validation.code,
        message: validation.message,
        diagnostics: null
      };
    }

    const distanceLimitM = Number(opts.distanceLimitM);
    const maxDistanceM = Number.isFinite(distanceLimitM) && distanceLimitM > 0 ? distanceLimitM : Infinity;
    const declinationDeg = Number.isFinite(Number(opts.declinationDeg)) ? Number(opts.declinationDeg) : 0;
    const spreadToleranceM = Number.isFinite(Number(opts.spreadToleranceM)) && Number(opts.spreadToleranceM) > 0
      ? Number(opts.spreadToleranceM)
      : 180;

    const originLat = observations.reduce((sum, obs) => sum + Number(obs.lat), 0) / observations.length;
    const rays = observations.map((obs) => {
      const headingDeg = parseHeadingDegrees(obs.heading);
      const adjustedBearing = norm360(headingDeg + declinationDeg);
      return {
        id: obs.id,
        bearCode: obs.bearCode,
        point: toLocalXY(Number(obs.lat), Number(obs.lng), originLat),
        direction: bearingToUnitVector(adjustedBearing),
        headingDeg,
        adjustedBearing
      };
    });

    const intersections = [];
    let parallelCount = 0;
    let backwardCount = 0;
    let outOfRangeCount = 0;

    for (let i = 0; i < rays.length - 1; i += 1) {
      for (let j = i + 1; j < rays.length; j += 1) {
        const inter = lineIntersection(rays[i], rays[j]);
        if (inter.kind !== "ok") {
          parallelCount += 1;
          continue;
        }

        if (inter.t1 < 0 || inter.t2 < 0) {
          backwardCount += 1;
          continue;
        }

        if (inter.t1 > maxDistanceM || inter.t2 > maxDistanceM) {
          outOfRangeCount += 1;
          continue;
        }

        intersections.push(inter.point);
      }
    }

    if (intersections.length === 0) {
      let message = "잘못된 관측입니다. -> 교차점 없음";
      let code = "NO_INTERSECTION";

      if (outOfRangeCount > 0) {
        message = "잘못된 관측입니다. -> 거리범위 환경 벗어남";
        code = "OUT_OF_RANGE";
      } else if (backwardCount > 0 && parallelCount === 0) {
        message = "잘못된 관측입니다. -> 교차점 없음";
        code = "NO_FORWARD_INTERSECTION";
      }

      return {
        ok: false,
        code,
        message,
        diagnostics: {
          intersectionsCount: 0,
          parallelCount,
          backwardCount,
          outOfRangeCount
        }
      };
    }

    const center = averagePoint(intersections);
    const spreadM = maxDistanceFrom(intersections, center);

    if (Number.isFinite(spreadM) && spreadM > spreadToleranceM) {
      return {
        ok: false,
        code: "INCONSISTENT_INTERSECTIONS",
        message: "잘못된 관측입니다. -> 교차점 불일치",
        diagnostics: {
          intersectionsCount: intersections.length,
          spreadM,
          spreadToleranceM,
          parallelCount,
          backwardCount,
          outOfRangeCount
        }
      };
    }

    const estimatedLatLng = toLatLng(center[0], center[1], originLat);
    return {
      ok: true,
      code: "OK",
      message: "곰 위치 추정 완료",
      result: {
        bearCode: validation.bearCode,
        lat: estimatedLatLng.lat,
        lng: estimatedLatLng.lng,
        intersectionsCount: intersections.length,
        spreadM: Number.isFinite(spreadM) ? spreadM : 0,
        options: {
          distanceLimitM: Number.isFinite(maxDistanceM) ? maxDistanceM : null,
          declinationDeg,
          spreadToleranceM
        }
      },
      diagnostics: {
        parallelCount,
        backwardCount,
        outOfRangeCount
      }
    };
  }

  window.BearPositionAnalysis = {
    analyzePosition,
    parseHeadingDegrees
  };
})();