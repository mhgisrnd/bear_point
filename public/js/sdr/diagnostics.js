(function () {
  "use strict";
  const trigger = document.getElementById("btn-sdr-diagnostics");
  if (!trigger) return;
  const dialog = document.createElement("dialog");
  dialog.className = "sdr-dialog";
  dialog.setAttribute("aria-labelledby", "sdr-title");
  dialog.innerHTML = `
    <div class="sdr-header"><div class="sdr-title-group"><button type="button" data-back hidden aria-label="탐색 재개">‹ 탐색</button><div><span class="sdr-eyebrow">SDR · 수신 테스트</span><h2 id="sdr-title">수신기 설정</h2></div></div><button type="button" data-close>닫기</button></div>
    <div class="sdr-body">
    <p class="sdr-status" role="status">연결 상태 확인 전</p>
    <p class="sdr-message" role="alert"></p>
    <details data-usb-section class="sdr-section sdr-usb-section" open><summary><span>USB 장치</span><span class="sdr-chevron" aria-hidden="true">⌄</span></summary><div data-devices></div><div class="sdr-actions sdr-usb-tools"><button type="button" data-refresh>목록 새로고침</button><button type="button" data-disconnect>연결 해제 / 취소</button></div></details>
    <details data-settings-section class="sdr-section" open hidden><summary>수신 설정</summary>
      <fieldset data-settings class="sdr-settings" disabled>
        <div class="sdr-operation" role="group" aria-label="수신 방식"><button type="button" data-task-scan aria-pressed="false">대역 탐색</button><button type="button" data-task-fixed aria-pressed="true">주파수 고정</button></div>
        <div class="sdr-fields">
        <label class="sdr-wide">수신 대역<select data-band><option value="vhf">현장 VHF · 148–174 MHz</option><option value="fm">FM 방송 · 88–108 MHz</option></select></label>
        <label class="sdr-wide" data-mode-field>수신 모드<select data-mode><option value="iq">IQ · 신호 분석</option><option value="wfm">WFM · FM 방송</option></select></label>
        <div class="sdr-wide sdr-scan-fields" data-scan-fields hidden><label>시작 주파수 <span>MHz</span><input data-scan-start type="number" min="148" max="174" step="0.001" value="148.000" inputmode="decimal"></label><label>끝 주파수 <span>MHz</span><input data-scan-end type="number" min="148" max="174" step="0.001" value="174.000" inputmode="decimal"></label></div>
        <div class="sdr-wide sdr-frequency-field" data-frequency-field>
          <div class="sdr-frequency-heading"><div><strong>수신 주파수</strong><span data-frequency-range>MHz · 148–174</span></div><button type="button" data-frequency-edit aria-expanded="false">직접 입력</button></div>
          <div data-frequency-digits class="sdr-frequency-digits" role="group" aria-label="주파수 자릿수 조정">${[100000000, 10000000, 1000000, 100000, 10000, 1000].map((step, index) => `${index === 3 ? '<span class="sdr-frequency-dot" aria-hidden="true">.</span>' : ''}<div class="sdr-digit"><button type="button" data-freq-up="${step}" aria-label="${step / 1e6} MHz 올리기">▲</button><strong data-freq-digit="${index}" aria-hidden="true">—</strong><button type="button" data-freq-down="${step}" aria-label="${step / 1e6} MHz 내리기">▼</button></div>`).join('')}</div>
          <label data-frequency-entry hidden>직접 입력<input data-frequency type="number" min="148" max="174" step="0.001" value="150.000" inputmode="decimal" aria-label="수신 주파수 MHz"></label>
        </div>
        </div>

        <details class="sdr-help"><summary>고급 설정</summary><div class="sdr-fields">
        <label>샘플레이트 <span>MS/s</span><select data-rate><option value="250000">0.250 · 좁은 구간</option><option value="1024000" selected>1.024 · 기본</option><option value="1536000">1.536</option><option value="2048000">2.048</option><option value="2400000">2.400 · 넓은 구간</option></select></label>
        <label>수동 Gain <span>dB · −10–50</span><input data-gain type="number" min="-10" max="50" step="0.1" value="10" inputmode="decimal"></label>
        <label>주파수 보정 <span>PPM · −100–100</span><input data-ppm type="number" min="-100" max="100" step="1" value="0" inputmode="numeric"></label>
        <label data-deemphasis-field hidden>FM 음색 보정 <span>디엠퍼시스</span><select data-deemphasis><option value="75">75 µs · 기본</option><option value="50">50 µs</option></select></label>
        <label data-dwell-field hidden>구간 체류 <span>초</span><select data-dwell><option value="500">0.5</option><option value="1000" selected>1.0 · 기본</option><option value="2000">2.0</option><option value="5000">5.0</option></select></label>
        <label data-threshold-field hidden>감지 기준 <span>주변 잡음 대비 dB</span><input data-threshold type="number" min="6" max="30" step="1" value="10" inputmode="numeric"></label>
        </div><p data-window class="sdr-note"></p></details>
      </fieldset>
    </details>
    <details data-result class="sdr-section" hidden><summary data-result-heading>수신 결과</summary>
      <div data-scan-results hidden><p data-scan-progress class="sdr-scan-progress">탐색 대기</p><div class="sdr-candidate-heading"><strong data-candidate-heading>신호 후보</strong><span data-candidate-count>0개</span></div><div data-candidates></div></div>
      <div data-fixed-results>
      <div class="sdr-metrics"><div><span>수신 데이터</span><strong data-throughput>—</strong></div><div><span>대역 전력</span><strong data-power>—</strong></div></div>
      <div class="sdr-audio" data-audio-panel hidden><div class="sdr-audio-head"><div><strong>수신음</strong></div><button type="button" data-audio disabled aria-pressed="false">소리 켜기</button></div><p data-audio-status class="sdr-note">음소거</p></div>
      <figure class="sdr-spectrum"><figcaption><strong>스펙트럼</strong><span data-spectrum-tune hidden></span><button type="button" data-spectrum-reset hidden>되돌리기</button></figcaption>
        <canvas data-spectrum role="img" aria-label="수신 시작 후 주파수별 전력 그래프가 표시됩니다."></canvas>
        <p data-spectrum-summary class="sdr-note">수신 대기</p>
      </figure>
      <details class="sdr-help"><summary>측정 정보</summary><p data-applied class="sdr-note"></p><p data-quality class="sdr-note"></p><p data-spectrum-info class="sdr-note"></p></details>
      </div>
    </details>
    <details data-general-help class="sdr-help" hidden><summary>도움말</summary>
      <p>IQ는 신호 분석, WFM은 FM 방송 재생입니다. 음량은 휴대폰 미디어 볼륨으로 조절합니다.</p>
      <p>샘플레이트는 수신 폭, Gain은 증폭, PPM은 주파수 오차 보정입니다. 세기 비교 시 설정을 유지하세요.</p>
      <p>전력은 상대값이며 비콘·거리·방향을 판정하지 않습니다. 중심 DC와 가장자리는 최대 지점에서 제외합니다. 창을 닫거나 앱을 벗어나면 수신이 정지합니다.</p>
      <p>FM 후보는 시간 평균·신호 폭·지속성으로 잡음을 억제한 결과입니다. 방송 확인은 청취로 진행합니다. VHF 후보는 전파 감지이며 비콘 판정은 아닙니다. 후보를 선택하면 고정 수신합니다.</p>
    </details>
    </div>
    <div class="sdr-footer" hidden>
      <div class="sdr-actions sdr-run"><button type="button" class="sdr-primary" data-start disabled>수신 시작</button><button type="button" data-stop disabled>정지</button></div>
    </div>`;
  document.body.appendChild(dialog);
  const status = dialog.querySelector(".sdr-status");
  const message = dialog.querySelector(".sdr-message");
  const list = dialog.querySelector("[data-devices]");
  const refreshButton = dialog.querySelector("[data-refresh]");
  const disconnectButton = dialog.querySelector("[data-disconnect]");
  const startButton = dialog.querySelector("[data-start]");
  const stopButton = dialog.querySelector("[data-stop]");
  const settings = dialog.querySelector("[data-settings]");
  const frequency = dialog.querySelector("[data-frequency]");
  const band = dialog.querySelector("[data-band]");
  const rate = dialog.querySelector("[data-rate]");
  const gain = dialog.querySelector("[data-gain]");
  const ppm = dialog.querySelector("[data-ppm]");
  const mode = dialog.querySelector("[data-mode]");
  const deemphasis = dialog.querySelector("[data-deemphasis]");
  const audioButton = dialog.querySelector("[data-audio]");
  mode.value = "iq"; deemphasis.value = "75";
  const spectrumCanvas = dialog.querySelector("[data-spectrum]");
  const spectrumSummary = dialog.querySelector("[data-spectrum-summary]");
  const spectrumTune = dialog.querySelector("[data-spectrum-tune]");
  const spectrumReset = dialog.querySelector("[data-spectrum-reset]");
  let spectrumOriginalHz = null;
  const settingsSection = dialog.querySelector("[data-settings-section]");
  const footer = dialog.querySelector(".sdr-footer");
  const resultSection = dialog.querySelector("[data-result]");
  const generalHelp = dialog.querySelector("[data-general-help]");
  resultSection.addEventListener("toggle", () => {
    if (resultSection.open) renderSpectrum(current);
  });
  const bands = {
    vhf: { min: 148, max: 174 },
    fm: { min: 88, max: 108 }
  };
  const sampleRates = [250000, 1024000, 1536000, 2048000, 2400000];
  const rememberedFrequency = { vhf: "150.000", fm: "103.500" };
  let selectedBand = "vhf";
  let plugin = null;
  let busy = false;
  let current = null;
  let listener = null;
  let listenerPromise = null;
  let sequence = 0;
  let connectionAttempt = 0;
  let task = "fixed", lastScan = null, restoredFixed = false, candidateSelected = false;
  const scanStart = dialog.querySelector("[data-scan-start]");
  const scanEnd = dialog.querySelector("[data-scan-end]");
  const dwell = dialog.querySelector("[data-dwell]");
  const threshold = dialog.querySelector("[data-threshold]");
  const scanButton = dialog.querySelector("[data-task-scan]");
  const fixedButton = dialog.querySelector("[data-task-fixed]");
  const rememberedRange = { vhf: ["148.000", "174.000"], fm: ["88.000", "108.000"] };
  function renderMapStatus(snapshot) {
    const reception = snapshot && snapshot.receptionState;
    const state = snapshot && snapshot.receptionError ? "error" :
      snapshot && snapshot.backgroundScanning && ["starting", "scanning"].includes(reception) ? "scanning" :
      reception === "receiving" ? "receiving" :
      snapshot && snapshot.scanResumeAvailable && snapshot.state === "connected" && reception === "idle" ? "paused" : "";
    const labels = { scanning: "탐색 중", receiving: "수신 중", paused: "일시정지", error: "수신 오류" };
    if (state) {
      trigger.dataset.status = state;
      trigger.dataset.statusLabel = labels[state];
    } else {
      delete trigger.dataset.status;
      delete trigger.dataset.statusLabel;
    }
    const cycle = state === "scanning" && Number.isInteger(snapshot.scan?.cycle) ? ` · ${snapshot.scan.cycle}회차` : "";
    const label = `SDR 설정${state ? ` · ${labels[state]}${cycle}` : ""}`;
    trigger.setAttribute("aria-label", label);
    trigger.title = label;
  }

  async function attachListener() {
    if (listener) return;
    if (!listenerPromise) listenerPromise = Promise.resolve().then(() => plugin.addListener("usbStateChanged", snapshot => {
      ++sequence;
      if (dialog.open) render(snapshot);
      else {
        if (snapshot.state !== "connected" && current?.state === "connected") resetDisconnectedUi();
        current = snapshot; renderMapStatus(snapshot);
      }
    })).then(value => { listener = value; }).catch(error => { listenerPromise = null; throw error; });
    await listenerPromise;
  }
  // Assign defaults explicitly for native and test runtimes alike.
  scanStart.value = "148.000"; scanEnd.value = "174.000";
  dwell.value = "1000"; threshold.value = "10";

  function scanOptions() {
    return { band: band.value, startHz: Math.round(Number(scanStart.value) * 1e6),
      endHz: Math.round(Number(scanEnd.value) * 1e6), sampleRate: Number(rate.value),
      gainTenthsDb: Math.round(Number(gain.value) * 10), ppm: Number(ppm.value),
      dwellMs: Number(dwell.value), thresholdDb: Number(threshold.value) };
  }

  function canResumeScan(options = scanOptions()) {
    return !!(lastScan && current && current.scanResumeAvailable &&
      Object.keys(lastScan).every(key => lastScan[key] === options[key]));
  }

  function updateRunButtons() {
    const scanning = current && ["starting", "scanning"].includes(current.receptionState);
    const fixedReceiving = current && ["starting", "receiving"].includes(current.receptionState);
    startButton.textContent = task === "scan" ? scanning ? "탐색 중" : canResumeScan() ? "탐색 재개" : "탐색 시작" : "수신 시작";
    stopButton.textContent = task === "scan" ? scanning ? "일시정지" : "초기화" : fixedReceiving ? "정지" : "초기화";
    dialog.querySelector("[data-back]").hidden = task !== "fixed" || !candidateSelected ||
      !lastScan || !current || !current.scanResumeAvailable;
  }

  function setTask(next, rerender = true) {
    task = next;
    scanButton.setAttribute("aria-pressed", String(next === "scan"));
    fixedButton.setAttribute("aria-pressed", String(next === "fixed"));
    dialog.querySelector("[data-scan-fields]").hidden = next !== "scan";
    dialog.querySelector("[data-frequency-field]").hidden = next === "scan";
    dialog.querySelector("[data-mode-field]").hidden = next === "scan";
    dialog.querySelector("[data-dwell-field]").hidden = next !== "scan";
    dialog.querySelector("[data-threshold-field]").hidden = next !== "scan";
    dialog.querySelector("[data-scan-results]").hidden = next !== "scan";
    dialog.querySelector("[data-fixed-results]").hidden = next === "scan";
    dialog.querySelector("[data-result-heading]").textContent = next === "scan" ? "탐색 결과" : "수신 결과";
    updateMode();
    if (current && rerender) render(current);
  }
  scanButton.addEventListener("click", () => { if (!settings.disabled) { candidateSelected = false; setTask("scan"); } });
  fixedButton.addEventListener("click", () => { if (!settings.disabled) { candidateSelected = false; setTask("fixed"); } });
  const frequencyEditor = dialog.querySelector("[data-frequency-entry]");
  const frequencyDigits = dialog.querySelector("[data-frequency-digits]");
  const frequencyEditButton = dialog.querySelector("[data-frequency-edit]");
  let editingFrequency = false;
  let frequencyBeforeEditing = "";
  function setFrequencyEditing(enabled) {
    editingFrequency = enabled;
    frequencyEditor.hidden = !enabled;
    frequencyDigits.hidden = enabled;
    frequencyEditButton.textContent = enabled ? "완료" : "직접 입력";
    frequencyEditButton.setAttribute("aria-expanded", String(enabled));
    updateWindow();
  }
  const digitControls = [100000000, 10000000, 1000000, 100000, 10000, 1000].map((step, index) => {
    const up = dialog.querySelector(`[data-freq-up="${step}"]`);
    const down = dialog.querySelector(`[data-freq-down="${step}"]`);
    const digit = dialog.querySelector(`[data-freq-digit="${index}"]`);
    const adjust = direction => {
      if (settings.disabled) return;
      const bounds = bands[selectedBand], value = Number(frequency.value);
      if (!frequency.value.trim() || !Number.isFinite(value) || value < bounds.min || value > bounds.max) return;
      const hz = Math.round(value * 1e6) + direction * step;
      if (hz < bounds.min * 1e6 || hz > bounds.max * 1e6) return;
      frequency.value = (hz / 1e6).toFixed(3);
      updateWindow();
    };
    up.addEventListener("click", () => adjust(1));
    down.addEventListener("click", () => adjust(-1));
    return { step, up, down, digit };
  });

  function updateFrequencyDigits() {
    const bounds = bands[selectedBand], value = Number(frequency.value);
    const valid = !!frequency.value.trim() && Number.isFinite(value) && value >= bounds.min && value <= bounds.max;
    const hz = Math.round(value * 1e6);
    const digits = valid ? value.toFixed(3).padStart(7, "0").replace(".", "") : "------";
    digitControls.forEach(({ step, up, down, digit }, index) => {
      digit.textContent = digits[index];
      up.disabled = settings.disabled || !valid || hz + step > bounds.max * 1e6;
      down.disabled = settings.disabled || !valid || hz - step < bounds.min * 1e6;
    });
    frequencyDigits.setAttribute("aria-label", valid ? `수신 주파수 ${value.toFixed(3)} MHz` : "주파수 직접 입력 필요");
    frequencyEditButton.disabled = settings.disabled;
  }

  frequencyEditButton.addEventListener("click", () => {
    if (settings.disabled) return;
    if (editingFrequency) {
      const bounds = bands[selectedBand], value = Number(frequency.value);
      if (!frequency.value.trim() || !Number.isFinite(value) || value < bounds.min || value > bounds.max) {
        message.textContent = `${bounds.min}–${bounds.max} MHz 범위를 확인하세요.`;
        frequency.focus?.();
        return;
      }
      frequency.value = value.toFixed(3);
      message.textContent = "";
    }
    if (!editingFrequency) frequencyBeforeEditing = frequency.value;
    setFrequencyEditing(!editingFrequency);
    if (editingFrequency) { frequency.focus?.(); frequency.select?.(); }
    updateWindow();
  });
  frequency.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); if (editingFrequency) frequencyEditButton.click(); }
  });

  function renderSpectrum(snapshot) {
    const plot = window.SdrSpectrumPlot;
    if (!plot) return;
    const rf = snapshot && snapshot.reception || {};
    const centerHz = Number.isFinite(rf.frequencyHz) ? rf.frequencyHz : Number(frequency.value) * 1e6;
    const rateHz = Number.isFinite(rf.sampleRate) ? rf.sampleRate : Number(rate.value);
    const data = plot.describe(rf.spectrumDbfs, centerHz, rateHz);
    const state = snapshot && snapshot.receptionState;
    if (["starting", "receiving"].includes(state) || !data) spectrumOriginalHz = null;
    const canTune = task === "fixed" && !settings.disabled && !!data &&
      ["idle", "error"].includes(state) && snapshot?.fixedResultAvailable;
    const selectedHz = canTune ? Number(frequency.value) * 1e6 : null;
    const listenHz = state === "receiving" && rf.mode === "wfm" ? rf.listenFrequencyHz : null;
    spectrumCanvas.classList.toggle("sdr-spectrum-tunable", canTune);
    spectrumTune.hidden = !canTune;
    if (canTune) spectrumTune.textContent = `선택 ${(selectedHz / 1e6).toFixed(3)} MHz · 드래그하여 변경`;
    spectrumReset.hidden = !canTune || spectrumOriginalHz === null ||
      Math.round(selectedHz / 1000) === Math.round(spectrumOriginalHz / 1000);
    plot.draw(spectrumCanvas, data, centerHz, rateHz, state, listenHz, selectedHz);
    if (!data) {
      spectrumSummary.textContent = state === "receiving" ? "스펙트럼 대기 중" : "수신 대기";
      dialog.querySelector("[data-spectrum-info]").textContent = "";
      spectrumCanvas.setAttribute("aria-label", spectrumSummary.textContent);
      return;
    }
    const prefix = state === "receiving" ? "수신 중" : state === "error" ? "수신 오류 · 마지막 측정" : "정지됨 · 마지막 측정";
    spectrumSummary.textContent = `${prefix} · 최대 ${(data.peakHz / 1e6).toFixed(3)} MHz · ${data.peakDbfs.toFixed(1)} dBFS/bin`;
    dialog.querySelector("[data-spectrum-info]").textContent = `${(data.startHz / 1e6).toFixed(3)}–${(data.endHz / 1e6).toFixed(3)} MHz · FFT ${data.binWidthHz.toFixed(0)} Hz`;
    spectrumCanvas.setAttribute("aria-label", spectrumSummary.textContent);
  }

  let spectrumPointer = null;
  function tuneFromSpectrum(event) {
    const rf = current?.reception || {};
    const data = window.SdrSpectrumPlot?.describe(rf.spectrumDbfs, rf.frequencyHz, rf.sampleRate);
    if (task !== "fixed" || settings.disabled || !current?.fixedResultAvailable ||
        !["idle", "error"].includes(current.receptionState) || !data) return false;
    const rect = spectrumCanvas.getBoundingClientRect();
    const width = spectrumCanvas.clientWidth || rect.width;
    const bounds = bands[selectedBand];
    const hz = window.SdrSpectrumPlot.frequencyAtX(event.clientX - rect.left, width, rf.frequencyHz, rf.sampleRate);
    if (hz === null) return false;
    if (spectrumOriginalHz === null) spectrumOriginalHz = Math.round(Number(frequency.value) * 1e6);
    const selected = Math.max(bounds.min * 1e6, Math.min(bounds.max * 1e6, Math.round(hz / 1000) * 1000));
    frequency.value = (selected / 1e6).toFixed(3);
    updateWindow();
    return true;
  }
  spectrumReset.addEventListener("click", () => {
    if (spectrumReset.hidden || spectrumOriginalHz === null || settings.disabled) return;
    frequency.value = (spectrumOriginalHz / 1e6).toFixed(3);
    spectrumOriginalHz = null;
    updateWindow();
  });
  spectrumCanvas.addEventListener("pointerdown", event => {
    const rect = spectrumCanvas.getBoundingClientRect();
    const y = event.clientY - rect.top;
    if (y < 28 || y > 208 || !tuneFromSpectrum(event)) return;
    spectrumPointer = event.pointerId;
    spectrumCanvas.setPointerCapture?.(event.pointerId);
    event.preventDefault?.();
  });
  spectrumCanvas.addEventListener("pointermove", event => {
    if (event.pointerId !== spectrumPointer) return;
    tuneFromSpectrum(event);
    event.preventDefault?.();
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
    spectrumCanvas.addEventListener(name, event => {
      if (event.pointerId === spectrumPointer) spectrumPointer = null;
    });
  }

  function updateWindow() {
    updateRunButtons();
    updateFrequencyDigits();
    const center = Number(frequency.value), width = Number(rate.value) / 1e6;
    const bounds = bands[selectedBand];
    if (task === "scan") {
      const span = Number(scanEnd.value) - Number(scanStart.value), sampleRate = Number(rate.value);
      const segments = Math.ceil(span * 1e6 / (sampleRate * .35)) + 1;
      dialog.querySelector("[data-window]").textContent = span >= .1 && sampleRates.includes(sampleRate)
        ? `약 ${segments}구간 · 한 바퀴 약 ${Math.ceil(segments * (Number(dwell.value) + 200) / 1000)}초`
        : "최소 탐색 폭 0.100 MHz";
      return;
    }
    dialog.querySelector("[data-window]").textContent = frequency.value.trim() !== "" &&
        Number.isFinite(center) && center >= bounds.min && center <= bounds.max && sampleRates.includes(Number(rate.value))
      ? `수신 폭 ${(center - width / 2).toFixed(3)}–${(center + width / 2).toFixed(3)} MHz · ${(width * 2).toFixed(3)} MB/s`
      : "선택한 대역 안의 수신 주파수를 입력하세요.";
    if (dialog.open) renderSpectrum(current);
  }

  band.addEventListener("change", function () {
    if (settings.disabled) return;
    const next = bands[band.value];
    if (!next) return;
    const old = bands[selectedBand], previous = Number(frequency.value);
    if (frequency.value.trim() !== "" && Number.isFinite(previous) && previous >= old.min && previous <= old.max) {
      rememberedFrequency[selectedBand] = frequency.value;
    }
    rememberedRange[selectedBand] = [scanStart.value, scanEnd.value];
    selectedBand = band.value;
    [scanStart.value, scanEnd.value] = rememberedRange[selectedBand];
    for (const input of [scanStart, scanEnd]) { input.min = String(next.min); input.max = String(next.max); }
    frequency.min = String(next.min); frequency.max = String(next.max);
    frequency.value = rememberedFrequency[selectedBand];
    dialog.querySelector("[data-frequency-range]").textContent = `MHz · ${next.min}–${next.max}`;
    if (selectedBand !== "fm") mode.value = "iq";
    updateMode();
  });
  frequency.addEventListener("input", updateWindow);
  rate.addEventListener("change", updateWindow);
  scanStart.addEventListener("input", updateWindow);
  scanEnd.addEventListener("input", updateWindow);
  dwell.addEventListener("change", updateWindow);
  for (const input of [gain, ppm, threshold]) input.addEventListener("input", updateWindow);
  function updateMode() {
    const wfm = mode.value === "wfm" && task === "fixed";
    dialog.querySelector("[data-deemphasis-field]").hidden = !wfm;
    dialog.querySelector("[data-audio-panel]").hidden = !wfm;
    updateWindow();
  }
  mode.addEventListener("change", () => {
    if (mode.value === "wfm" && selectedBand !== "fm") {
      rememberedRange[selectedBand] = [scanStart.value, scanEnd.value];
      band.value = "fm"; selectedBand = "fm"; frequency.value = "103.500";
      [scanStart.value, scanEnd.value] = rememberedRange.fm;
      for (const input of [scanStart, scanEnd]) { input.min = "88"; input.max = "108"; }
      frequency.min = "88"; frequency.max = "108";
      dialog.querySelector("[data-frequency-range]").textContent = "MHz · 88–108";
    }
    updateMode();
  });
  updateMode();

  function getAndroidPlugin() {
    const capacitor = window.Capacitor;
    if (!capacitor || typeof capacitor.getPlatform !== "function" || capacitor.getPlatform() !== "android") return null;
    // Plain HTML builds receive Plugins from Android's JSExport. registerPlugin
    // is only available when the separate Capacitor JS runtime supplies it.
    const injected = capacitor.Plugins && capacitor.Plugins.RtlSdr;
    const resolved = injected || (typeof capacitor.registerPlugin === "function" ? capacitor.registerPlugin("RtlSdr") : null);
    const methods = ["getStatus", "requestDevicePermission", "openDevice", "closeDevice", "addListener"];
    if (!resolved || methods.some(method => typeof resolved[method] !== "function")) {
      throw new Error("RtlSdr 네이티브 플러그인이 없습니다. 최신 APK를 설치하세요.");
    }
    return resolved;
  }

  function resetDisconnectedUi() {
    lastScan = null;
    restoredFixed = false;
    candidateSelected = false;
    spectrumOriginalHz = null;
    setTask("fixed", false);
    settingsSection.open = true;
    resultSection.open = false;
    settingsSection.hidden = resultSection.hidden = footer.hidden = generalHelp.hidden = true;
  }

  function render(snapshot) {
    renderMapStatus(snapshot);
    const connected = snapshot.state === "connected";
    if (!connected && current?.state === "connected") resetDisconnectedUi();
    settingsSection.hidden = resultSection.hidden = footer.hidden = generalHelp.hidden = !connected;
    if (snapshot.scanResumeAvailable && snapshot.scan && snapshot.scan.startHz != null) {
      if (!lastScan) {
        const scan = snapshot.scan;
        lastScan = { band: scan.band, startHz: scan.startHz, endHz: scan.endHz,
          sampleRate: scan.requestedSampleRate, gainTenthsDb: scan.requestedGainTenthsDb,
          ppm: scan.ppm, dwellMs: scan.dwellMs, thresholdDb: scan.thresholdDb };
        restoreScanOptions(lastScan);
        if (!snapshot.backgroundReceiving && snapshot.receptionState !== "receiving") setTask("scan", false);
      }
    }
    if (snapshot.backgroundReceiving && !restoredFixed && snapshot.reception?.frequencyHz) {
      const rf = snapshot.reception;
      band.value = rf.mode === "wfm" ? "fm" : "vhf";
      selectedBand = band.value;
      const bounds = bands[selectedBand];
      frequency.min = String(bounds.min);
      frequency.max = String(bounds.max);
      dialog.querySelector("[data-frequency-range]").textContent = `MHz · ${bounds.min}–${bounds.max}`;
      mode.value = rf.mode || "iq";
      frequency.value = (rf.frequencyHz / 1e6).toFixed(3);
      if (rf.sampleRate) rate.value = String(rf.sampleRate);
      if (Number.isFinite(rf.gainDb)) gain.value = String(rf.gainDb);
      if (Number.isFinite(rf.ppm)) ppm.value = String(rf.ppm);
      restoredFixed = true;
      setTask("fixed", false);
    }
    if (snapshot.state === "connected" && (!current || current.state !== "connected")) {
      dialog.querySelector("[data-usb-section]").open = false;
    } else if (snapshot.state !== "connected") {
      dialog.querySelector("[data-usb-section]").open = true;
    }
    const previousReception = current && current.receptionState;
    current = snapshot;
    updateDialogViewport(snapshot);
    updateRunButtons();
    const names = { unsupported: "USB Host 미지원", permissionPending: "USB 권한 대기 중", connected: "USB 연결됨", idle: "USB 연결 대기" };
    status.textContent = names[snapshot.state] || "상태 확인 필요";
    list.replaceChildren();
    const devices = (snapshot.devices || []).filter(device => device.candidate);
    if (!devices.length) {
      const empty = document.createElement("p");
      empty.textContent = "RTL-SDR 없음 · USB 연결 확인";
      list.appendChild(empty);
    }
    devices.forEach(function (device) {
      const card = document.createElement("div");
      card.className = "sdr-device";
      const title = document.createElement("strong");
      title.textContent = device.name;
      const detail = document.createElement("small");
      const hex = value => Number(value).toString(16).toUpperCase().padStart(4, "0");
      detail.textContent = `VID ${hex(device.vendorId)} / PID ${hex(device.productId)}`;
      if (device.connected) {
        const badge = document.createElement("span");
        badge.className = "sdr-connected-badge";
        badge.textContent = "연결됨";
        card.className += " sdr-device-connected";
        card.append(title, detail, badge);
        list.appendChild(card);
        return;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sdr-primary";
      button.textContent = device.hasPermission ? "연결" : "권한 허용 및 연결";
      button.disabled = busy || snapshot.state === "permissionPending" || !device.candidate || !snapshot.hostSupported;
      button.addEventListener("click", () => run(async () => {
        const attempt = ++connectionAttempt;
        if (!device.hasPermission) {
          await plugin.requestDevicePermission({ deviceId: device.deviceId });
        }
        if (attempt !== connectionAttempt || !dialog.open) return;
        await plugin.openDevice({ deviceId: device.deviceId });
        if (attempt !== connectionAttempt || !dialog.open) return;

      }));
      card.append(title, detail, button);
      list.appendChild(card);
    });
    refreshButton.disabled = busy;
    disconnectButton.disabled = !busy && snapshot.state !== "connected" && snapshot.state !== "permissionPending";
    const receiving = ["starting", "receiving", "scanning", "stopping"].includes(snapshot.receptionState);
    settings.disabled = busy || receiving || snapshot.state === "unsupported";
    scanButton.disabled = fixedButton.disabled = settings.disabled;
    dialog.querySelector("[data-back]").disabled = busy || snapshot.state !== "connected" ||
      snapshot.receptionState === "stopping";
    updateFrequencyDigits();
    startButton.disabled = settings.disabled || snapshot.state !== "connected" || !plugin || typeof plugin.startReception !== "function";
    const canClearScan = task === "scan" && snapshot.receptionState === "idle" &&
      snapshot.scanResumeAvailable && typeof plugin?.clearScanHistory === "function";
    const canClearFixed = task === "fixed" && ["idle", "error"].includes(snapshot.receptionState) &&
      snapshot.fixedResultAvailable && typeof plugin?.clearReceptionResult === "function";
    stopButton.disabled = busy || snapshot.receptionState === "stopping" || !(receiving || canClearScan || canClearFixed);
    const rfNames = { idle: "수신 대기", starting: "튜너 초기화 중…", receiving: "IQ 수신 중", scanning: "대역 탐색 중", stopping: "수신 정지 중…", error: "수신 오류" };
    if (snapshot.receptionError) message.textContent = snapshot.receptionError;
    const rf = snapshot.reception || {};
    dialog.querySelector("[data-throughput]").textContent = rf.totalBytes != null ? `${(rf.bytesPerSecond / 1e6).toFixed(2)} MB/s` : "—";
    dialog.querySelector("[data-power]").textContent = rf.hasSamples ? `${rf.powerDbfs.toFixed(1)} dBFS` : "—";
    dialog.querySelector("[data-applied]").textContent = rf.tuner ? `${rf.tuner} · ${(rf.frequencyHz / 1e6).toFixed(3)} MHz · ${(rf.sampleRate / 1e6).toFixed(3)} MS/s · Gain ${rf.gainDb} dB · ${rf.ppm} PPM` : "";
    dialog.querySelector("[data-quality]").textContent = rf.totalBytes != null ? `누적 ${(rf.totalBytes / 1e6).toFixed(1)} MB · ${rf.elapsedSeconds.toFixed(1)}초 · 포화 샘플 ${rf.clippingPercent.toFixed(2)}%${rf.clippingPercent > 1 ? " · Gain을 낮춰 확인하세요." : ""}` : "";
    if (receiving) status.textContent = rfNames[snapshot.receptionState];
    else if (task === "scan" && snapshot.scanResumeAvailable) status.textContent = "탐색 일시정지";
    if (["scanning", "receiving"].includes(snapshot.receptionState)) status.dataset.activity = snapshot.receptionState;
    else delete status.dataset.activity;
    const audio = snapshot.audio || {};
    const wfm = rf.mode === "wfm" && snapshot.receptionState === "receiving";
    audioButton.disabled = busy || !wfm || !plugin || typeof plugin.setAudio !== "function";
    audioButton.textContent = audio.enabled ? "음소거" : "소리 켜기";
    audioButton.setAttribute("aria-pressed", String(!!audio.enabled));
    dialog.querySelector("[data-audio-status]").textContent = audio.notice ||
      (audio.enabled ? `${audio.output || "Android 미디어 출력"}${audio.droppedBlocks ? ` · 오디오 누락 ${audio.droppedBlocks}회` : ""}` :
      wfm ? "음소거" : "재생 대기");
    if (wfm) {
      status.textContent = "WFM 수신 중 · " + (audio.enabled ? "소리 재생" : "음소거");
    }
    renderSpectrum(snapshot);
    renderCandidates(snapshot);
    if (["receiving", "scanning"].includes(snapshot.receptionState) && !["receiving", "scanning"].includes(previousReception)) {
      resultSection.open = true;
      dialog.querySelector("[data-settings-section]").open = false;
      resultSection.scrollIntoView?.({ block: "start", behavior: "smooth" });
    }
  }

  function renderCandidates(snapshot) {
    const scan = snapshot.scan || {};
    dialog.querySelector("[data-candidate-heading]").textContent = scan.band === "fm" ? "FM 방송 후보" : "신호 후보";
    const isRecent = candidate => Number.isInteger(candidate.lastSeenCycle) && Number.isInteger(scan.cycle)
      ? scan.cycle - candidate.lastSeenCycle <= 1
      : scan.elapsedSeconds - candidate.lastSeenSeconds <= Math.max(10, (scan.cycleSeconds || 5) * 2);
    const candidates = [...(scan.candidates || [])].sort((a, b) => Number(isRecent(b)) - Number(isRecent(a)) ||
      b.powerDbfs - a.powerDbfs || a.frequencyHz - b.frequencyHz);
    const progress = dialog.querySelector("[data-scan-progress]");
    progress.textContent = scan.centerHz != null
      ? `${snapshot.receptionState === "scanning" ? "탐색 중" : snapshot.scanResumeAvailable ? "탐색 일시정지" : "마지막 탐색"} · ${(scan.centerHz / 1e6).toFixed(3)} MHz\n구간 ${scan.segment}/${scan.segments} · ${scan.cycle}회차 · 한 바퀴 약 ${Math.ceil(scan.cycleSeconds)}초`
      : "탐색 대기";
    const found = dialog.querySelector("[data-candidates]");
    // Reuse buttons when the candidate order is unchanged.
    const keys = candidates.map((c, index) => c.id ?? index).join(",");
    if (found.dataset?.keys !== keys || !found.children.length) {
      found.replaceChildren();
      candidates.forEach(() => {
        const button = document.createElement("button"); button.type = "button"; button.className = "sdr-candidate";
        const title = document.createElement("strong"), detail = document.createElement("small");
        const signal = document.createElement("span"); signal.className = "sdr-signal";
        signal.setAttribute("role", "img");
        signal.innerHTML = '<svg viewBox="0 0 28 24" aria-hidden="true"><path class="sdr-signal-outer" d="M2 7 Q14 -3 26 7"/><path class="sdr-signal-middle" d="M6 11 Q14 4 22 11"/><path class="sdr-signal-inner" d="M10 15 Q14 11 18 15"/><circle cx="14" cy="20" r="2"/></svg>';
        button.signalIcon = signal;
        detail.className = "sdr-candidate-details";
        const newBadge = document.createElement("span"); newBadge.className = "sdr-candidate-new";
        newBadge.textContent = "새 신호";
        detail.append(document.createElement("span"), document.createElement("span"), document.createElement("span"), newBadge);
        button.append(title, detail);
        button.addEventListener("click", () => run(() => selectCandidate(button.frequencyHz)));
        found.appendChild(button);
      });
      if (found.dataset) found.dataset.keys = keys;
    }
    candidates.forEach((candidate, index) => {
      const button = found.children[index];
      const recent = isRecent(candidate);
      const measuring = snapshot.receptionState === "scanning";
      button.className = `sdr-candidate${recent ? "" : " sdr-candidate-stale"}${measuring ? "" : " sdr-candidate-paused"}`;
      button.frequencyHz = candidate.frequencyHz;
      button.children[0].textContent = `${(candidate.frequencyHz / 1e6).toFixed(3)} MHz`;
      button.children[0].appendChild(button.signalIcon);
      const level = candidate.powerDbfs >= -40 ? 4 : candidate.powerDbfs >= -55 ? 3 : candidate.powerDbfs >= -70 ? 2 : 1;
      button.signalIcon.dataset.level = String(level);
      button.signalIcon.setAttribute("aria-label", `${recent ? measuring ? "최근 감지" : "마지막 측정" : "최근 미감지"} · 상대 신호 세기 ${level}/4단계`);
      const detail = button.children[1];
      detail.children[0].textContent = `${candidate.powerDbfs.toFixed(1)} dBFS/bin`;
      detail.children[1].textContent = `잡음 대비 +${candidate.snrDb.toFixed(1)} dB`;
      const age = Math.max(0, Math.floor(scan.elapsedSeconds - candidate.lastSeenSeconds));
      detail.children[2].textContent = `${recent ? measuring ? "최근 감지" : "마지막 측정" : "최근 미감지"} · ${age}초 전`;
      detail.children[3].hidden = !measuring || candidate.confirmedCycle !== scan.cycle;
      button.disabled = busy || snapshot.state !== "connected" || ["starting", "stopping"].includes(snapshot.receptionState);
    });
    const recentCount = candidates.filter(isRecent).length;
    dialog.querySelector("[data-candidate-count]").textContent = `${recentCount}/${candidates.length}개 최근 감지`;
    if (!candidates.length) {
      const empty = document.createElement("p"); empty.className = "sdr-note"; empty.textContent = "감지된 후보 없음";
      found.replaceChildren(empty);
    }
  }

  function restoreScanOptions(options) {
    band.value = selectedBand = options.band;
    const bounds = bands[selectedBand];
    for (const input of [frequency, scanStart, scanEnd]) { input.min = String(bounds.min); input.max = String(bounds.max); }
    dialog.querySelector("[data-frequency-range]").textContent = `MHz · ${bounds.min}–${bounds.max}`;
    scanStart.value = (options.startHz / 1e6).toFixed(3); scanEnd.value = (options.endHz / 1e6).toFixed(3);
    rate.value = String(options.sampleRate); gain.value = String(options.gainTenthsDb / 10); ppm.value = String(options.ppm);
    dwell.value = String(options.dwellMs); threshold.value = String(options.thresholdDb);
  }

  async function selectCandidate(hz) {
    if (!lastScan || !Number.isFinite(hz)) return;
    const attempt = ++connectionAttempt;
    await plugin.stopReception();
    if (attempt !== connectionAttempt || !dialog.open || !current || current.state !== "connected") return;
    restoreScanOptions(lastScan);
    frequency.value = (hz / 1e6).toFixed(3);
    mode.value = lastScan.band === "fm" ? "wfm" : "iq";
    candidateSelected = true;
    setTask("fixed");
    await plugin.startReception({ band: lastScan.band, mode: mode.value, frequencyHz: Math.round(Number(frequency.value) * 1e6),
      listenFrequencyHz: Math.round(Number(frequency.value) * 1e6), sampleRate: lastScan.sampleRate,
      gainTenthsDb: lastScan.gainTenthsDb, ppm: lastScan.ppm, deemphasisUs: Number(deemphasis.value) });
  }

  async function refresh() {
    if (!plugin) return;
    const request = ++sequence;
    const snapshot = await plugin.getStatus();
    if (request === sequence) {
      if (dialog.open) render(snapshot);
      else { current = snapshot; renderMapStatus(snapshot); }
    }
  }

  async function run(action) {
    if (busy) return;
    busy = true;
    message.textContent = "";
    if (current) render(current);
    try { const result = await action(); message.textContent = typeof result === "string" ? result : ""; }
    catch (error) { message.textContent = error.message || String(error); }
    finally {
      busy = false;
      try { await refresh(); } catch (error) { message.textContent = error.message || String(error); }
    }
  }

  trigger.addEventListener("click", async function () {
    if (dialog.open) return;
    if (typeof window.__bpResetBackExit === "function") window.__bpResetBackExit();
    dialog.showModal();
    settingsSection.hidden = resultSection.hidden = footer.hidden = generalHelp.hidden = true;
    renderSpectrum(current);
    message.textContent = "";
    status.textContent = "USB 연결 상태 확인 중…";
    refreshButton.disabled = true;
    disconnectButton.disabled = true;
    startButton.disabled = true;
    stopButton.disabled = true;
    settings.disabled = true;
    list.replaceChildren();
    try {
      if (!plugin) plugin = getAndroidPlugin();
      if (!plugin) {
        status.textContent = "USB 연결 확인은 Android 앱에서 사용할 수 있습니다.";
        return;
      }
      await attachListener();
      await refresh();
    } catch (error) {
      status.textContent = "USB 연결 기능을 초기화하지 못했습니다.";
      message.textContent = error.message || String(error);
    }
  });
  refreshButton.addEventListener("click", () => run(refresh));
  startButton.addEventListener("click", () => run(async () => {
    const hz = Number(frequency.value) * 1e6, sampleRate = Number(rate.value);
    const gainDb = Number(gain.value), correction = Number(ppm.value);
    const bounds = bands[band.value];
    if (task === "scan") {
      const start = Number(scanStart.value) * 1e6, end = Number(scanEnd.value) * 1e6;
      const dwellMs = Number(dwell.value), thresholdDb = Number(threshold.value);
      if (![scanStart, scanEnd, gain, ppm, threshold].every(input => String(input.value).trim() !== "") ||
          !bounds || !Number.isFinite(start) || !Number.isFinite(end) || start < bounds.min * 1e6 || end > bounds.max * 1e6 ||
          end - start < 100000 || !sampleRates.includes(sampleRate) || !Number.isFinite(gainDb) || gainDb < -10 || gainDb > 50 ||
          !Number.isInteger(correction) || Math.abs(correction) > 100 || ![500, 1000, 2000, 5000].includes(dwellMs) ||
          !Number.isFinite(thresholdDb) || thresholdDb < 6 || thresholdDb > 30) {
        throw new Error("탐색 범위·고급 설정을 확인하세요. 최소 탐색 폭은 0.100 MHz입니다.");
      }
      if (typeof plugin.startScan !== "function") throw new Error("대역 탐색을 지원하는 최신 APK를 설치하세요.");
      const options = { band: band.value, startHz: Math.round(start), endHz: Math.round(end), sampleRate,
        gainTenthsDb: Math.round(gainDb * 10), ppm: correction, dwellMs, thresholdDb };
      await plugin.startScan(canResumeScan(options) ? { ...options, resume: true } : options); lastScan = options;
      return;
    }
    if (![frequency, rate, gain, ppm].every(input => String(input.value).trim() !== "") ||
        !bounds || !Number.isFinite(hz) || hz < bounds.min * 1e6 || hz > bounds.max * 1e6 || !sampleRates.includes(sampleRate) ||
        !Number.isFinite(gainDb) || gainDb < -10 || gainDb > 50 || !Number.isInteger(correction) || Math.abs(correction) > 100) {
      throw new Error("주파수·샘플레이트·Gain·PPM 설정 범위를 확인하세요.");
    }
    const listenHz = hz;
    if (!["iq", "wfm"].includes(mode.value) || (mode.value === "wfm" &&
        (band.value !== "fm" ||
         Math.abs(listenHz - hz) + 100000 > sampleRate * .45 || ![50, 75].includes(Number(deemphasis.value))))) {
      throw new Error("WFM은 FM 방송 대역에서 사용할 수 있습니다. 수신 모드와 고급 설정을 확인하세요.");
    }
    const options = { band: band.value, mode: mode.value, frequencyHz: Math.round(hz), listenFrequencyHz: Math.round(listenHz), sampleRate,
      gainTenthsDb: Math.round(gainDb * 10), ppm: correction, deemphasisUs: Number(deemphasis.value) };
    await plugin.startReception(options);

  }));
  audioButton.addEventListener("click", () => run(() => plugin.setAudio({ enabled: !(current && current.audio && current.audio.enabled), volume: 1 })));
  stopButton.addEventListener("click", () => run(async () => {
    if (task === "scan" && current?.receptionState === "idle" && current.scanResumeAvailable) {
      await plugin.clearScanHistory();
      lastScan = null;
      candidateSelected = false;
      await refresh();
    } else if (task === "fixed" && ["idle", "error"].includes(current?.receptionState) && current.fixedResultAvailable) {
      await plugin.clearReceptionResult();
      await refresh();
    } else {
      await plugin.stopReception();
    }
  }));
  async function resumeLastScan() {
    if (!lastScan || !current || !current.scanResumeAvailable) return;
    const attempt = ++connectionAttempt;
    await plugin.stopReception();
    if (attempt !== connectionAttempt || !dialog.open || !current || current.state !== "connected") return;
    restoreScanOptions(lastScan); setTask("scan");
    await plugin.startScan({ ...lastScan, resume: true });
    candidateSelected = false;
  }
  dialog.querySelector("[data-back]").addEventListener("click", () => run(resumeLastScan));

  function handleBackNavigation() {
    if (!dialog.open) return false;
    if (busy) return true;
    if (editingFrequency) {
      if (!settings.disabled) frequency.value = frequencyBeforeEditing;
      setFrequencyEditing(false);
    } else if (task === "fixed" && candidateSelected && lastScan && current && current.scanResumeAvailable) {
      void run(resumeLastScan);
    } else {
      dialog.close();
    }
    return true;
  }
  window.SdrDiagnostics = { handleBackNavigation };
  dialog.addEventListener("cancel", event => { event.preventDefault(); handleBackNavigation(); });

  function updateDialogViewport(snapshot = current) {
    const insets = snapshot && snapshot.viewportInsets || {};
    for (const side of ["top", "right", "bottom", "left"]) {
      const value = Number(insets[side]);
      dialog.style?.setProperty(`--sdr-native-safe-${side}`, `${Number.isFinite(value) ? Math.max(0, value) : 0}px`);
    }
    const viewport = window.visualViewport;
    const height = viewport ? viewport.height : window.innerHeight;
    if (Number.isFinite(height) && height > 0) dialog.style?.setProperty("--sdr-viewport-height", `${height}px`);
    dialog.style?.setProperty("--sdr-viewport-top", `${viewport && Number.isFinite(viewport.offsetTop) ? viewport.offsetTop : 0}px`);
  }
  // This action must remain available while a permission call is outstanding.
  disconnectButton.addEventListener("click", async function () {
    ++connectionAttempt;
    try { await plugin.closeDevice(); message.textContent = ""; await refresh(); }
    catch (error) { message.textContent = error.message || String(error); }
  });
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", async function () {
    ++connectionAttempt;
    // Cancel an outstanding Android permission prompt, but keep an opened USB receiver.
    if (plugin && current && current.state === "permissionPending") {
      try { await plugin.closeDevice(); } catch (error) { console.warn("SDR permission cancel:", error); }
    }
  });
  if (typeof window.addEventListener === "function") {
    const resize = () => {
      if (!dialog.open) return;
      updateDialogViewport(); renderSpectrum(current);
      if (plugin) void refresh().catch(() => {});
    };
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", () => { if (dialog.open) updateDialogViewport(); });
  }
  if (window.Capacitor?.getPlatform?.() === "android") {
    try {
      plugin = getAndroidPlugin();
      if (plugin) void attachListener().then(refresh).catch(() => {});
    } catch (_) { /* The settings dialog reports bridge errors when opened. */ }
  }
})();
