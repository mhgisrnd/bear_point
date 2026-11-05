(function () {
  "use strict";

  function geometry(width, height) {
    return { left: 48, right: width - 14, top: 24, bottom: height - 36 };
  }

  function describe(bins, centerHz, rateHz, options = {}) {
    const narrow = options.narrow === true;
    if (!Array.isArray(bins) || bins.length !== (narrow ? 128 : 1024) || !bins.every(Number.isFinite) ||
        !Number.isFinite(centerHz) || !Number.isFinite(rateHz) || rateHz <= 0) return null;
    const edge = Math.ceil(bins.length * 0.05), middle = bins.length / 2;
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

  function draw(canvas, data, centerHz, rateHz, state, listenHz) {
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
    const narrow = !!data?.narrow;
    // Stable 10 dB scale steps keep weak local features readable without inventing gain.
    const topDb = narrow ? Math.min(0, Math.max(-60, Math.ceil((data.peakDbfs + 10) / 10) * 10)) : 0;
    const rangeDb = narrow ? 60 : 120, bottomDb = topDb - rangeDb;
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
        const label = narrow ? (hz / 1e6).toFixed(5).replace(/0+$/, "").replace(/\.$/, "") : (hz / 1e6).toFixed(3);
        ctx.fillText(label, x, bottom + 19);
      }
    }
    ctx.textAlign = "right"; ctx.fillText("MHz", right, height - 1);
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
      ctx.fillText(state === "starting" ? "수신 준비 중" : "수신 대기", left + span / 2, (top + bottom) / 2);
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
    ctx.beginPath(); ctx.arc(peakX, y(data.peakDbfs), 3, 0, Math.PI * 2); ctx.fillStyle = "#b45309"; ctx.fill();

  }

  window.SdrSpectrumPlot = { describe, draw };
})();
