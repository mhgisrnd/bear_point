(function () {
  "use strict";

  const audioScales = new WeakMap();

  function geometry(width, height) {
    return { left: 48, right: width - 14, top: 24, bottom: height - 36 };
  }

  function describe(bins, centerHz, rateHz, options = {}) {
    const audio = options.audio === true;
    const narrow = audio || options.narrow === true;
    if (!Array.isArray(bins) || (audio ? bins.length < 2 : bins.length !== (narrow ? 128 : 1024)) || !bins.every(Number.isFinite) ||
        !Number.isFinite(centerHz) || !Number.isFinite(rateHz) || rateHz <= 0) return null;
    const edge = audio ? 0 : Math.ceil(bins.length * 0.05), middle = bins.length / 2;
    let peak = -1;
    for (let i = edge; i < bins.length - edge; i++) {
      // Avoid labelling the hardware's DC spike or filter edges as the largest feature.
      if (!narrow && Math.abs(i - middle) <= 3) continue;
      if (peak < 0 || bins[i] > bins[peak]) peak = i;
    }
    return { bins, centerHz, rateHz, narrow, startHz: centerHz - rateHz / 2, endHz: centerHz + rateHz / 2,
      binWidthHz: rateHz / bins.length, peakIndex: peak,
      peakHz: centerHz + (peak - middle) * rateHz / bins.length, peakDbfs: bins[peak] };
  }

  function audioRange(canvas, data) {
    if (!data) {
      audioScales.delete(canvas);
      return 80;
    }
    const sorted = [...data.bins].sort((a, b) => a - b);
    const backgroundDb = sorted[Math.floor(sorted.length * .75)];
    const target = Math.max(80, Math.min(120, Math.ceil((20 - backgroundDb) / 20) * 20));
    const now = performance.now();
    let scale = audioScales.get(canvas);
    if (!scale) {
      scale = { range: 80, target, since: now };
      audioScales.set(canvas, scale);
    }
    if (target !== scale.target) {
      scale.target = target;
      scale.since = now;
    }
    // Wait for a sustained background change before rescaling.
    if (now - scale.since >= 1500) scale.range = target;
    return scale.range;
  }

  function draw(canvas, data, centerHz, rateHz, state, listenHz, candidateHz, { audio = false } = {}) {
    const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    if (!ctx) return;
    const width = Math.max(240, canvas.clientWidth || 500), height = Math.max(120, canvas.clientHeight || 240);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#f8fafc"; ctx.fillRect(0, 0, width, height);
    const { left, right, top, bottom } = geometry(width, height);
    const narrow = audio || !!data?.narrow;
    // Audio keeps the full-scale ceiling and adjusts its floor from the background.
    const topDb = narrow && !audio ? Math.min(0, Math.max(-60, Math.ceil(((data?.peakDbfs ?? -120) + 10) / 10) * 10)) : 0;
    const rangeDb = audio ? audioRange(canvas, data) : narrow ? 60 : 120, bottomDb = topDb - rangeDb;
    const span = right - left, y = db => top + Math.max(0, Math.min(rangeDb, topDb - db)) / rangeDb * (bottom - top);
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = "#526477"; ctx.textAlign = "left"; ctx.fillText("dBFS/bin", 6, 15);
    ctx.lineWidth = 1;
    for (let db = topDb; db >= bottomDb; db -= narrow ? 20 : 30) {
      ctx.strokeStyle = "#dbe4ea"; ctx.beginPath(); ctx.moveTo(left, y(db)); ctx.lineTo(right, y(db)); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(String(db), left - 7, y(db) + 4);
    }
    const ticks = narrow || width < 420 ? 2 : 4;
    for (let i = 0; i <= ticks; i++) {
      const x = left + span * i / ticks;
      ctx.strokeStyle = "#e5ebef"; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      if (Number.isFinite(centerHz) && Number.isFinite(rateHz) && rateHz > 0) {
        ctx.textAlign = i === 0 ? "left" : i === ticks ? "right" : "center";
        const hz = centerHz - rateHz / 2 + rateHz * i / ticks;
        const label = audio ? String(Math.round(hz))
          : narrow ? (hz / 1e6).toFixed(5).replace(/0+$/, "").replace(/\.$/, "") : (hz / 1e6).toFixed(3);
        ctx.fillText(label, x, bottom + 19);
      }
    }
    ctx.textAlign = "right"; ctx.fillText(audio ? "Hz" : "MHz", right, height - 1);
    if (!narrow) {
      ctx.setLineDash([4, 4]); ctx.strokeStyle = "#9aaab7";
      ctx.beginPath(); ctx.moveTo(left + span / 2, top); ctx.lineTo(left + span / 2, bottom); ctx.stroke(); ctx.setLineDash([]);
    }
    if (Number.isFinite(listenHz) && rateHz > 0 && Math.abs(listenHz - centerHz) < rateHz / 2) {
      const x = left + span * (.5 + (listenHz - centerHz) / rateHz);
      ctx.strokeStyle = "#7c3aed"; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.fillStyle = "#7c3aed"; ctx.textAlign = "center";
      ctx.fillText(narrow ? "대상" : "듣기", Math.max(left + 18, Math.min(right - 18, x)), top - 8);
    }
    if (!data) {
      ctx.fillStyle = "#526477"; ctx.textAlign = "center";
      const waiting = audio ? (state === "active" || state === "starting" ? "오디오 분석 준비 중" : "오디오 입력 대기")
        : state === "starting" ? "수신 준비 중" : "수신 대기";
      ctx.fillText(waiting, left + span / 2, (top + bottom) / 2);
      return;
    }
    ctx.beginPath();
    data.bins.forEach((db, index) => {
      const x = left + span * index / data.bins.length;
      if (index === 0) ctx.moveTo(x, y(db)); else ctx.lineTo(x, y(db));
    });
    ctx.strokeStyle = "#087b91"; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.lineTo(right, bottom); ctx.lineTo(left, bottom); ctx.closePath();
    ctx.fillStyle = "#087b9118"; ctx.fill();
    const peakX = left + span * data.peakIndex / data.bins.length;
    if (!audio || data.peakDbfs > -120) {
      ctx.beginPath(); ctx.arc(peakX, y(data.peakDbfs), 3, 0, Math.PI * 2); ctx.fillStyle = "#b45309"; ctx.fill();
    }
    if (Number.isFinite(candidateHz) && Math.abs(candidateHz - centerHz) < rateHz / 2) {
      const x = left + span * (.5 + (candidateHz - centerHz) / rateHz);
      ctx.setLineDash([3, 3]); ctx.strokeStyle = "#15803d";
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#15803d"; ctx.textAlign = "center";
      ctx.fillText("CW", Math.max(left + 12, Math.min(right - 12, x)), top + 13);
    }

  }

  window.SdrSpectrumPlot = { describe, draw };
})();
