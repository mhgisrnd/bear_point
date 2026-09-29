(function () {
  "use strict";
  const floor = -120;

  function describe(bins, centerHz, rateHz) {
    if (!Array.isArray(bins) || bins.length !== 1024 || !bins.every(Number.isFinite) ||
        !Number.isFinite(centerHz) || !Number.isFinite(rateHz) || rateHz <= 0) return null;
    const edge = Math.ceil(bins.length * 0.05), middle = bins.length / 2;
    let peak = -1;
    for (let i = edge; i < bins.length - edge; i++) {
      // Avoid labelling the hardware's DC spike or filter edges as the largest feature.
      if (Math.abs(i - middle) <= 3) continue;
      if (peak < 0 || bins[i] > bins[peak]) peak = i;
    }
    return { bins, centerHz, rateHz, startHz: centerHz - rateHz / 2, endHz: centerHz + rateHz / 2,
      binWidthHz: rateHz / bins.length, peakIndex: peak,
      peakHz: centerHz + (peak - middle) * rateHz / bins.length, peakDbfs: bins[peak] };
  }

  function draw(canvas, data, centerHz, rateHz, state, listenHz) {
    const ctx = typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
    if (!ctx) return;
    const width = Math.max(240, canvas.clientWidth || 500), height = 240;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#f8fafc"; ctx.fillRect(0, 0, width, height);
    const left = 48, right = width - 14, top = 28, bottom = height - 32;
    const span = right - left, y = db => top + Math.max(0, Math.min(120, -db)) / 120 * (bottom - top);
    ctx.font = "11px system-ui, sans-serif";
    ctx.fillStyle = "#526477"; ctx.textAlign = "left"; ctx.fillText("dBFS/bin", 6, 15);
    ctx.lineWidth = 1;
    for (let db = 0; db >= floor; db -= 30) {
      ctx.strokeStyle = "#dbe4ea"; ctx.beginPath(); ctx.moveTo(left, y(db)); ctx.lineTo(right, y(db)); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(String(db), left - 7, y(db) + 4);
    }
    const ticks = width < 420 ? 2 : 4;
    for (let i = 0; i <= ticks; i++) {
      const x = left + span * i / ticks;
      ctx.strokeStyle = "#e5ebef"; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      if (Number.isFinite(centerHz) && Number.isFinite(rateHz) && rateHz > 0) {
        ctx.textAlign = i === 0 ? "left" : i === ticks ? "right" : "center";
        ctx.fillText(((centerHz - rateHz / 2 + rateHz * i / ticks) / 1e6).toFixed(3), x, bottom + 19);
      }
    }
    ctx.textAlign = "right"; ctx.fillText("MHz", right, height - 1);
    ctx.setLineDash([4, 4]); ctx.strokeStyle = "#9aaab7";
    ctx.beginPath(); ctx.moveTo(left + span / 2, top); ctx.lineTo(left + span / 2, bottom); ctx.stroke(); ctx.setLineDash([]);
    if (Number.isFinite(listenHz) && rateHz > 0 && Math.abs(listenHz - centerHz) < rateHz / 2) {
      const x = left + span * (.5 + (listenHz - centerHz) / rateHz);
      ctx.strokeStyle = "#7c3aed"; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke();
      ctx.fillStyle = "#7c3aed"; ctx.textAlign = "center";
      ctx.fillText("듣기", Math.max(left + 18, Math.min(right - 18, x)), top - 8);
    }
    if (!data) {
      ctx.fillStyle = "#526477"; ctx.textAlign = "center";
      ctx.fillText(state === "starting" ? "수신 준비 중" : "수신 대기", left + span / 2, (top + bottom) / 2);
      return;
    }
    ctx.beginPath();
    data.bins.forEach((db, i) => {
      const x = left + span * i / data.bins.length;
      if (i === 0) ctx.moveTo(x, y(db)); else ctx.lineTo(x, y(db));
    });
    ctx.strokeStyle = "#087b91"; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.lineTo(right, bottom); ctx.lineTo(left, bottom); ctx.closePath();
    ctx.fillStyle = "#087b9118"; ctx.fill();
    const peakX = left + span * data.peakIndex / data.bins.length;
    ctx.beginPath(); ctx.arc(peakX, y(data.peakDbfs), 3, 0, Math.PI * 2); ctx.fillStyle = "#b45309"; ctx.fill();
  }

  window.SdrSpectrumPlot = { describe, draw };
})();
