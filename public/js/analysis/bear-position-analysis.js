// public/js/analysis/bear-position-analysis.js
// 위치분석 계산 전용 모듈
//
// ── 위치분석 로직 순서도 ──────────────────────────────────────────────────
//
//  [입력] observations: 관측점 배열 (lat, lng, heading, bearCode)
//         options: distanceLimitM, declinationDeg, spreadToleranceM
//
//   ① 유효성 검사 (validateObservations)
//      - 관측점 2개 미만 → 실패 (NEED_MIN_TWO)
//      - bearCode 없음   → 실패 (BEAR_CODE_REQUIRED)
//      - bearCode 불일치 → 실패 (MISMATCH_BEAR_CODE)
//      - 좌표/방위각 오류 → 실패 (INVALID_COORDINATE / INVALID_HEADING)
//
//   ② 좌표 변환
//      - 모든 관측점의 위경도 → 로컬 XY 평면 좌표(미터)로 변환 (toLocalXY)
//      - 방위각 + 자기편각(declinationDeg) 보정 → 방향 단위벡터 (bearingToUnitVector)
//
//   ③ 교차점 계산 (관측점 쌍 조합 순회)
//      - 관측점 n개 → 최대 n*(n-1)/2 쌍
//      - 각 쌍마다 lineIntersection 호출:
//        ┌ 평행(det ≈ 0)          → parallelCount++, 해당 쌍 건너뜀
//        ├ 역방향(t1<0 or t2<0)   → backwardCount++, 해당 쌍 건너뜀
//        ├ 거리초과(t > 제한거리)  → outOfRangeCount++, 해당 쌍 건너뜀
//        └ 정상                   → intersections 배열에 교차점 추가
//
//   ④ 교차점 없음 판정
//      - intersections가 비어 있으면 → 실패 (NO_INTERSECTION / OUT_OF_RANGE)
//
//   ⑤ 엄격 판정 (현재 활성)
//      - 전체 쌍 중 이상 쌍(평행·역방향·거리초과)이 1개라도 있으면 → 실패 (INCONSISTENT_INTERSECTIONS)
//      - 이유: 이상 쌍이 섞이면 나머지 교차점 평균도 신뢰하기 어렵다는 판단
//      ※ 완화 시: 이상 쌍만 건너뛰고 유효 교차점만으로 평균 계산 가능
//
//   ⑥ 퍼짐 판정 (현재 비활성 — 주석 처리됨)
//      - 유효 교차점 중 중심에서 가장 먼 거리(spreadM) > spreadToleranceM 이면 → 실패
//      - 적정 기준치가 현장마다 달라 사용자 판단에 맡김
//      - spreadM 값은 결과 diagnostics에 포함되어 확인 가능
//
//   ⑦ 결과 계산
//      - 유효 교차점들의 산술평균 (averagePoint)
//      - 로컬 XY → 위경도 역변환 (toLatLng)
//      - 반환: { ok: true, result: { lat, lng, spreadM, intersectionsCount, ... } }
//
// ─────────────────────────────────────────────────────────────────────────

(function initBearPositionAnalysisModule() {
  const EARTH_RADIUS_M = 6378137;

  // 도(degree) → 라디안 변환. 삼각함수 계산에 필요.
  function toRadians(deg) {
    return (deg * Math.PI) / 180;
  }

  // 라디안 → 도(degree) 변환. 계산 결과를 사람이 읽을 수 있는 각도로 되돌릴 때 사용.
  function toDegrees(rad) {
    return (rad * 180) / Math.PI;
  }

  // 임의의 각도를 0~360° 범위로 정규화한다. 예: -10° → 350°, 370° → 10°.
  function norm360(value) {
    const normalized = value % 360;
    return normalized < 0 ? normalized + 360 : normalized;
  }

  // 방위각 입력값을 숫자로 파싱하고 0~360° 범위로 정규화한다.
  // 숫자/문자열 모두 허용. 파싱 실패 시 null 반환.
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

  // 위경도(WGS84)를 로컬 평면 XY 좌표(미터)로 변환한다.
  // 원점(originLat)을 기준으로 등장방형 투영법 적용.
  // 교차점 계산은 평면 기하학으로 하기 위해 이 변환을 먼저 수행.
  function toLocalXY(lat, lng, originLat) {
    const latRad = toRadians(lat);
    const lngRad = toRadians(lng);
    const originLatRad = toRadians(originLat);
    const x = EARTH_RADIUS_M * lngRad * Math.cos(originLatRad);
    const y = EARTH_RADIUS_M * latRad;
    return [x, y];
  }

  // 로컬 평면 XY 좌표(미터)를 위경도(WGS84)로 역변환한다.
  // 교차점 계산 결과를 지도에 표시할 수 있는 좌표로 되돌릴 때 사용.
  function toLatLng(x, y, originLat) {
    const originLatRad = toRadians(originLat);
    const latRad = y / EARTH_RADIUS_M;
    const lngRad = x / (EARTH_RADIUS_M * Math.cos(originLatRad));
    return {
      lat: toDegrees(latRad),
      lng: toDegrees(lngRad)
    };
  }

  // 북쪽(0°) 기준 시계방향 방위각을 XY 단위벡터(동=x, 북=y)로 변환한다.
  // 예: 0° → [0,1](북), 90° → [1,0](동), 180° → [0,-1](남)
  // lineIntersection에서 방위선의 방향 벡터로 사용.
  function bearingToUnitVector(bearingDeg) {
    const rad = toRadians(norm360(bearingDeg));
    const dx = Math.sin(rad);
    const dy = Math.cos(rad);
    return [dx, dy];
  }

  // 두 관측점에서 출발하는 방위선(반직선)의 교차점을 구한다.
  // 크래머 공식으로 연립방정식 풀이:
  //   P1 + t1*V1 = P2 + t2*V2
  // det = 두 방향벡터의 외적(행렬식). 0에 가까우면 두 선이 평행.
  // t1, t2 = 각 관측점에서 교차점까지의 거리(m).
  //   t < 0 이면 교차점이 관측자 뒤쪽 → 역방향 오입력 의심.
  // 반환: { kind: "parallel" } 또는 { kind: "ok", t1, t2, point: [x, y] }
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

  // XY 좌표 배열의 산술평균 중심점을 구한다.
  // 유효한 교차점들의 추정 위치 계산에 사용.
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

  // 중심점(center)에서 각 XY 좌표까지의 거리 중 최댓값을 반환한다(단위: m).
  // 교차점들이 얼마나 퍼져 있는지(spreadM) 측정할 때 사용.
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

  // 관측 데이터 배열의 유효성을 검사한다.
  // 검사 항목: 2개 이상 여부, 곰 코드 일치, 위경도/방위각 값 존재 여부.
  // 반환: { ok: true, bearCode } 또는 { ok: false, code, message }
  function validateObservations(observations) {
    if (!Array.isArray(observations) || observations.length < 2) {
      return { ok: false, code: "NEED_MIN_TWO", message: "관측점은 2개 이상 필요합니다." };
    }

    const bearCode = String(observations[0].bearCode || "").trim();
    if (!bearCode) {
      return { ok: false, code: "BEAR_CODE_REQUIRED", message: "코드가 없는 관측점은 분석할 수 없습니다." };
    }

    for (const obs of observations) {
      if (String(obs.bearCode || "").trim() !== bearCode) {
        return { ok: false, code: "MISMATCH_BEAR_CODE", message: "동일한 코드 관측점만 함께 분석할 수 있습니다." };
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

    // 거리 제한(m): 교차점이 관측자로부터 이 거리를 초과하면 유효 교차점에서 제외.
    // opts.distanceLimitM 미지정 또는 0 이하이면 무제한(Infinity).
    const distanceLimitM = Number(opts.distanceLimitM);
    const maxDistanceM = Number.isFinite(distanceLimitM) && distanceLimitM > 0 ? distanceLimitM : Infinity;

    // 자기 편각(도): 나침반 방위각과 진북 사이의 보정값. 한국 기준 약 -8~-9°.
    // opts.declinationDeg 미지정이면 0(보정 없음).
    const declinationDeg = Number.isFinite(Number(opts.declinationDeg)) ? Number(opts.declinationDeg) : 0;

    // 교차점 퍼짐 허용 반경(m): 모든 교차점의 산술평균 중심에서 가장 먼 교차점까지의 거리가
    // 이 값을 초과하면 "교차점 불일치"로 실패 처리. 기본값 180m.
    // 관측 오차 허용 범위를 크게 잡으려면 이 값을 늘리면 됨(예: 300~500).
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
    let parallelCount = 0;   // 두 방위선이 평행하여 교차점을 구할 수 없는 쌍의 수
    let backwardCount = 0;   // 교차점이 관측자 뒤쪽(t<0)에 생기는 쌍의 수 → 방위각 오입력 의심
    let outOfRangeCount = 0; // 교차점이 거리 제한(maxDistanceM) 밖에 위치하는 쌍의 수
    const totalPairCount = (rays.length * (rays.length - 1)) / 2; // 관측점 간 가능한 쌍 조합 수

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

    // 엄격 판정: 전체 쌍 중 단 한 쌍이라도 평행·역방향·거리초과 징후가 있으면 실패 처리.
    // 교차점이 일부 생겼더라도 나머지 쌍이 이상하면 평균값 자체를 신뢰할 수 없기 때문.
    if (parallelCount > 0 || backwardCount > 0 || outOfRangeCount > 0) {
      return {
        ok: false,
        code: "INCONSISTENT_INTERSECTIONS",
        message: "잘못된 관측입니다. -> 교차점 불일치",
        diagnostics: {
          intersectionsCount: intersections.length,
          totalPairCount,
          parallelCount,
          backwardCount,
          outOfRangeCount,
          strictRejected: true
        }
      };
    }

    const center = averagePoint(intersections);
    const spreadM = maxDistanceFrom(intersections, center);

    // 퍼짐 판정: 교차점 분산이 spreadToleranceM을 초과하면 실패.
    // → 적정 기준치가 현장 운용에 따라 달라지므로 현재 비활성화.
    //   spreadM 값은 결과 diagnostics에 포함되므로 사용자가 직접 판단.
    // if (Number.isFinite(spreadM) && spreadM > spreadToleranceM) {
    //   return {
    //     ok: false,
    //     code: "INCONSISTENT_INTERSECTIONS",
    //     message: "잘못된 관측입니다. -> 교차점 불일치",
    //     diagnostics: {
    //       intersectionsCount: intersections.length,
    //       spreadM,
    //       spreadToleranceM,
    //       parallelCount,
    //       backwardCount,
    //       outOfRangeCount
    //     }
    //   };
    // }

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
        totalPairCount,
        spreadM: Number.isFinite(spreadM) ? spreadM : 0,
        options: {
          distanceLimitM: Number.isFinite(maxDistanceM) ? maxDistanceM : null,
          declinationDeg,
          spreadToleranceM
        },
        analysisDetails: {
          originLat,
          rays: rays.map(function (ray) {
            return {
              id: ray.id,
              bearCode: ray.bearCode,
              point: [ray.point[0], ray.point[1]],
              headingDeg: ray.headingDeg,
              adjustedBearing: ray.adjustedBearing,
              direction: [ray.direction[0], ray.direction[1]]
            };
          }),
          intersections: intersections.map(function (pointXY) {
            const latLng = toLatLng(pointXY[0], pointXY[1], originLat);
            return {
              point: [pointXY[0], pointXY[1]],
              lat: latLng.lat,
              lng: latLng.lng
            };
          })
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