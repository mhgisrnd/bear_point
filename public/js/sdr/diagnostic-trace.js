(function (root) {
  "use strict";

  function markup(prefix) {
    return `<div data-${prefix}-audio-trace>
      <svg class="sdr-diagnostic-chart" viewBox="0 0 300 90" role="img" aria-label="0초부터 10초까지의 수신음 크기">
        <polyline data-${prefix}-audio-line fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></polyline>
      </svg>
      <progress class="sdr-diagnostic-progress" data-${prefix}-progress value="0" max="10000" aria-label="수신음 기록 진행률" hidden></progress>
      <p data-${prefix}-audio-level class="sdr-note">수신음 기록 대기</p>
    </div>`;
  }

  function mount(panel, prefix) {
    const trace = panel.querySelector(`[data-${prefix}-audio-trace]`);
    const progress = panel.querySelector(`[data-${prefix}-progress]`);
    const line = panel.querySelector(`[data-${prefix}-audio-line]`);
    const label = panel.querySelector(`[data-${prefix}-audio-level]`);
    return (data, recording, hidden = false) => {
      trace.hidden = hidden;
      if (hidden) return;
      const duration = data.recordingDurationMs || 10000;
      const elapsed = Math.min(duration, data.recordedElapsedMs || 0);
      progress.max = duration;
      progress.value = elapsed;
      progress.hidden = !recording;
      const points = [];
      let latest = -1;
      for (const [index, peak] of (data.audioPeaks || []).entries()) {
        if (peak < 0) continue;
        latest = peak;
        const dbfs = peak ? Math.max(-60, 20 * Math.log10(peak / 32768)) : -60;
        const x = Math.min(300, index * data.audioIntervalMs * 300 / duration);
        points.push(`${x},${85 - (dbfs + 60) * 80 / 60}`);
      }
      line.setAttribute("points", points.join(" "));
      const level = latest > 0 ? `수신음 피크 ${(20 * Math.log10(latest / 32768)).toFixed(1)} dBFS`
        : latest === 0 ? "수신음 피크 · 무음" : "수신음 기록 대기";
      label.textContent = recording ? `${(elapsed / 1000).toFixed(1)} / ${duration / 1000}초 · ${level}` : level;
    };
  }

  root.BearSdrDiagnosticTrace = { markup, mount };
})(window);
