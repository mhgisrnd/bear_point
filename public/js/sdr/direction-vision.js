(function (root) {
  "use strict";
  const SIZE = 128, PATCH = 3, SEARCH = 9;
  const normalize = angle => ((angle % 360) + 360) % 360;
  const difference = (to, from) => normalize(to - from + 180) - 180;

  function findFeatures(pixels, width, height) {
    const margin = SEARCH + PATCH + 2;
    const points = [];
    for (let top = margin; top < height - margin; top += 19) {
      for (let left = margin; left < width - margin; left += 19) {
        let best = 180, point;
        for (let y = top; y < Math.min(top + 19, height - margin); y += 2) {
          for (let x = left; x < Math.min(left + 19, width - margin); x += 2) {
            let xx = 0, xy = 0, yy = 0;
            for (let row = -1; row <= 1; row++) {
              for (let col = -1; col <= 1; col++) {
                const i = (y + row) * width + x + col;
                const gx = pixels[i + 1] - pixels[i - 1], gy = pixels[i + width] - pixels[i - width];
                xx += gx * gx; xy += gx * gy; yy += gy * gy;
              }
            }
            const score = (xx + yy - Math.hypot(xx - yy, 2 * xy)) / 2;
            if (score > best) { best = score; point = { x, y }; }
          }
        }
        if (point) points.push(point);
      }
    }
    return points;
  }

  function patchError(before, after, width, x, y, dx, dy) {
    let sum = 0, squares = 0;
    for (let row = -PATCH; row <= PATCH; row++) {
      const pos = (y + row) * width + x;
      const shift = dy * width + dx;
      for (let col = -PATCH; col <= PATCH; col++) {
        const error = before[pos + col] - after[pos + col + shift];
        sum += error;
        squares += error * error;
      }
    }
    const count = (2 * PATCH + 1) ** 2;
    return squares / count - (sum / count) ** 2;
  }

  function matchFeature(before, after, width, point) {
    const { x, y } = point;
    const candidates = [];
    let best = { error: Infinity };
    for (let dy = -SEARCH; dy <= SEARCH; dy++) {
      for (let dx = -SEARCH; dx <= SEARCH; dx++) {
        const match = { dx, dy, error: patchError(before, after, width, x, y, dx, dy) };
        if (match.error < best.error) best = match;
        candidates.push(match);
      }
    }
    const rival = candidates.reduce((min, item) => Math.max(Math.abs(item.dx - best.dx), Math.abs(item.dy - best.dy)) > 2
      ? Math.min(min, item.error) : min, Infinity);
    return best.error < 360 && best.error < rival * 0.72 ? { x, y, u: x + best.dx, v: y + best.dy } : null;
  }

  function fitRotation(matches) {
    if (matches.length < 7) return null;
    let best = [];
    for (let i = 0; i < matches.length - 1; i++) {
      const a = matches[i];
      for (let j = i + 1; j < matches.length; j++) {
        const b = matches[j];
        const x = b.x - a.x, y = b.y - a.y, u = b.u - a.u, v = b.v - a.v;
        const squared = x * x + y * y;
        if (squared < 25 ** 2) continue;
        const cos = (x * u + y * v) / squared, sin = (x * v - y * u) / squared;
        const scale = Math.hypot(cos, sin);
        if (scale < 0.90 || scale > 1.10 || Math.abs(Math.atan2(sin, cos)) > 0.12) continue;
        const inliers = matches.filter(p => {
          const dx = p.x - a.x, dy = p.y - a.y;
          return Math.hypot(a.u + cos * dx - sin * dy - p.u, a.v + sin * dx + cos * dy - p.v) <= 1.6;
        });
        if (inliers.length > best.length) best = inliers;
      }
    }
    if (best.length < 7 || best.length < matches.length * 0.65) return null;
    const center = ["x", "y", "u", "v"].map(axis => best.reduce((sum, point) => sum + point[axis], 0) / best.length);
    let dot = 0, cross = 0;
    for (const p of best) {
      const x = p.x - center[0], y = p.y - center[1], u = p.u - center[2], v = p.v - center[3];
      dot += x * u + y * v;
      cross += x * v - y * u;
    }
    return Math.atan2(cross, dot) * 180 / Math.PI;
  }

  function imageRotation(before, after, width, height) {
    const features = findFeatures(before, width, height);
    return fitRotation(features.map(point => matchFeature(before, after, width, point)).filter(Boolean));
  }

  function createHeadingFusion() {
    let compass = null, heading = null, lastVisual = null;
    return {
      compass(angle, time, level = true) {
        const previous = compass;
        compass = angle;
        if (!level) lastVisual = null;
        if (previous === null || lastVisual === null) return heading = angle;
        if (time - lastVisual <= 320) return null;
        heading = normalize(heading + difference(angle, previous));
        heading = normalize(heading + difference(angle, heading) * 0.06);
        return heading;
      },
      vision(imageAngle, time) {
        if (compass === null) return null;
        const continuous = lastVisual !== null && time - lastVisual <= 320;
        lastVisual = time;
        if (continuous) {
          const predicted = normalize(heading - imageAngle);
          const error = difference(compass, predicted);
          heading = normalize(predicted + (Math.abs(error) <= 12 ? error * 0.04 : 0));
        }
        return heading;
      }
    };
  }

  function camera(video, update) {
    const canvas = video.ownerDocument.createElement("canvas");
    canvas.width = canvas.height = SIZE;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    let stream, timer, epoch = 0, previous = null, previousTime = 0, previousVideoTime = -1;

    function stop() {
      epoch++;
      root.clearInterval(timer);
      if (stream) stream.getTracks().forEach(track => track.stop());
      stream = null;
      video.srcObject = null;
      previous = null;
      previousVideoTime = -1;
    }

    function sample() {
      const side = Math.min(video.videoWidth, video.videoHeight);
      if (!side || video.readyState < 2 || video.currentTime === previousVideoTime) return;
      previousVideoTime = video.currentTime;
      const time = root.performance.now();
      context.drawImage(video, (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side, 0, 0, SIZE, SIZE);
      const data = context.getImageData(0, 0, SIZE, SIZE).data;
      const frame = new Uint8Array(SIZE * SIZE);
      for (let i = 0; i < frame.length; i++) frame[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8;
      const rotation = previous && time - previousTime <= 300 ? imageRotation(previous, frame, SIZE, SIZE) : null;
      previous = frame;
      previousTime = time;
      update(rotation, time);
    }

    return {
      stop,
      async start() {
        const token = ++epoch;
        const input = await root.navigator.mediaDevices.getUserMedia({ audio: false,
          video: { facingMode: { exact: "environment" }, width: { ideal: 320 }, height: { ideal: 240 } } });
        if (token !== epoch) { input.getTracks().forEach(track => track.stop()); return false; }
        stream = input;
        video.srcObject = input;
        try { await video.play(); }
        catch (error) { if (token === epoch) stop(); throw error; }
        if (token !== epoch) return false;
        timer = root.setInterval(sample, 125);
        return true;
      }
    };
  }

  root.BearDirectionVision = { camera, createHeadingFusion, fitRotation, imageRotation };
})(window);
