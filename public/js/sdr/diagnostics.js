(function () {
  "use strict";
  const trigger = document.getElementById("btn-sdr-diagnostics");
  if (!trigger) return;
  const dialog = document.createElement("dialog");
  dialog.className = "sdr-dialog";
  dialog.setAttribute("aria-labelledby", "sdr-title");
  dialog.innerHTML = `
    <div class="sdr-header"><h2 id="sdr-title">수신기 <span class="sdr-cw-label">CW</span></h2><button type="button" data-back hidden aria-label="탐색 재개">‹ 탐색</button><button type="button" data-close>닫기</button></div>
    <div class="sdr-body">
    <p class="sdr-status" role="status">연결 상태 확인 전</p>
    <p class="sdr-message" role="alert"></p>
    <section data-usb-section class="sdr-usb-section" data-connected="false" aria-label="USB 수신기"><h3 data-usb-heading>USB 수신기</h3><div data-devices></div><div class="sdr-usb-tools"><button type="button" data-refresh>새로고침</button><button type="button" data-disconnect hidden>연결 해제</button></div></section>
    <section data-settings-section class="sdr-section" hidden>
      <fieldset data-settings class="sdr-settings" disabled>
        <div class="sdr-operation" role="group" aria-label="수신 방식"><button type="button" data-task-scan aria-pressed="false">대역 탐색</button><button type="button" data-task-fixed aria-pressed="true">주파수 고정</button></div>
        <div class="sdr-fields">
        <div class="sdr-wide sdr-scan-fields" data-scan-fields hidden><label>시작 주파수 <span>MHz</span><input data-scan-start type="number" min="0.1" max="999.999" step="0.001" value="148.000" inputmode="decimal"></label><label>끝 주파수 <span>MHz</span><input data-scan-end type="number" min="0.1" max="999.999" step="0.001" value="174.000" inputmode="decimal"></label></div>
        <div class="sdr-wide sdr-frequency-field" data-frequency-field>
          <div class="sdr-frequency-heading"><div><strong>수신 주파수</strong><span data-frequency-range>MHz</span></div><button type="button" data-frequency-edit aria-expanded="false">직접 입력</button></div>
          <div data-frequency-digits class="sdr-frequency-digits" role="group" aria-label="주파수 자릿수 조정">${[100000000, 10000000, 1000000, 100000, 10000, 1000].map((step, index) => `${index === 3 ? '<span class="sdr-frequency-dot" aria-hidden="true">.</span>' : ''}<div class="sdr-digit"><button type="button" data-freq-up="${step}" aria-label="${step / 1e6} MHz 올리기">▲</button><strong data-freq-digit="${index}" aria-hidden="true">—</strong><button type="button" data-freq-down="${step}" aria-label="${step / 1e6} MHz 내리기">▼</button></div>`).join('')}</div>
          <label data-frequency-entry hidden>직접 입력<input data-frequency type="number" min="0.1" max="999.999" step="0.001" value="150.000" inputmode="decimal" aria-label="수신 주파수 MHz"></label>
        </div>
        </div>

        <div class="sdr-fields sdr-tuning-options">
        <label>감도 <span>Gain dB</span><input data-gain type="number" min="-10" max="50" step="0.1" value="10" inputmode="decimal"></label>
        <label>주파수 보정 <span>PPM</span><input data-ppm type="number" min="-100" max="100" step="1" value="0" inputmode="numeric"></label>
        <label data-threshold-field hidden>감지 기준 <span>주변 잡음 대비 dB</span><input data-threshold type="number" min="6" max="30" step="1" value="10" inputmode="numeric"></label>
        </div><input data-rate type="hidden" value="1024000"><input data-dwell type="hidden" value="5000"><p data-window class="sdr-note" hidden></p>
      </fieldset>
    </section>
    <section data-result class="sdr-section" hidden>
      <div data-scan-results hidden><p data-scan-progress class="sdr-scan-progress">탐색 대기</p><div class="sdr-candidate-heading"><strong data-candidate-heading>신호 후보</strong><span data-candidate-count>0개</span></div><div data-candidates></div></div>
      <div data-fixed-results>
      <div class="sdr-readout-row"><p class="sdr-frequency-readout" data-frequency-readout aria-live="polite">수신 주파수 —</p><div data-audio-panel><button type="button" data-audio disabled aria-pressed="false">소리 켜기</button></div></div><p data-audio-status class="sdr-note" hidden></p>
      <div class="sdr-strength"><div class="sdr-strength-heading"><strong>수신 신호 세기</strong><span data-strength-value>측정 대기</span></div><div class="sdr-strength-bars" data-strength-bars role="meter" aria-label="청취 주파수 상대 신호 세기" aria-valuemin="0" aria-valuemax="10" aria-valuenow="0">${Array.from({ length: 10 }, (_, i) => `<span data-strength-bar="${i}" style="height:${8 + i * 3}px"></span>`).join("")}</div><p class="sdr-note" data-strength-state>청취 주파수 주변의 상대 신호 세기</p></div>
      <div class="sdr-metrics"><div><span>수신 데이터</span><strong data-throughput>—</strong></div><div><span>대역 전력</span><strong data-power>—</strong></div></div>
      <figure class="sdr-spectrum"><figcaption><strong>스펙트럼</strong><span data-spectrum-tune hidden></span><button type="button" data-spectrum-reset hidden>되돌리기</button></figcaption>
        <canvas data-spectrum role="img" aria-label="수신 시작 후 주파수별 전력 그래프가 표시됩니다."></canvas>
        <p data-spectrum-summary class="sdr-note">수신 대기</p>
      </figure>
      <p data-spectrum-info class="sdr-note" hidden></p>
      </div>
    </section>

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
  const rate = dialog.querySelector("[data-rate]");
  const gain = dialog.querySelector("[data-gain]");
  const ppm = dialog.querySelector("[data-ppm]");
  const RECEIVE_MODE = "cw";
  const DEEMPHASIS_US = 75;
  const audioButton = dialog.querySelector("[data-audio]");
  const spectrumCanvas = dialog.querySelector("[data-spectrum]");
  const spectrumSummary = dialog.querySelector("[data-spectrum-summary]");
  const spectrumTune = dialog.querySelector("[data-spectrum-tune]");
  const spectrumReset = dialog.querySelector("[data-spectrum-reset]");
  let spectrumOriginalHz = null;
  const settingsSection = dialog.querySelector("[data-settings-section]");
  const footer = dialog.querySelector(".sdr-footer");
  const resultSection = dialog.querySelector("[data-result]");
  // Numeric bridge limits; the connected tuner determines actual RF coverage.
  const frequencyBounds = { min: .1, max: 999.999 };
  const sampleRates = [250000, 1024000, 1536000, 2048000, 2400000];
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
  dwell.value = "5000"; threshold.value = "10";

  function scanOptions() {
    return { band: "wide", mode: RECEIVE_MODE, startHz: Math.round(Number(scanStart.value) * 1e6),
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
    const showBack = task === "fixed" && candidateSelected &&
      !!(lastScan && current && current.scanResumeAvailable);
    dialog.querySelector("[data-back]").hidden = !showBack;
    dialog.querySelector("[data-close]").hidden = showBack;
  }

  function setTask(next, rerender = true) {
    task = next;
    scanButton.setAttribute("aria-pressed", String(next === "scan"));
    fixedButton.setAttribute("aria-pressed", String(next === "fixed"));
    dialog.querySelector("[data-scan-fields]").hidden = next !== "scan";
    dialog.querySelector("[data-frequency-field]").hidden = next === "scan";
    dialog.querySelector("[data-threshold-field]").hidden = next !== "scan";
    dialog.querySelector("[data-scan-results]").hidden = next !== "scan";
    dialog.querySelector("[data-fixed-results]").hidden = next === "scan";
    dialog.querySelector("[data-window]").hidden = next !== "scan";
    updateTaskControls();
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
    frequencyEditor.hidden = true;
    frequencyDigits.hidden = false;
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
      const bounds = frequencyBounds, value = Number(frequency.value);
      if (!frequency.value.trim() || !Number.isFinite(value) || value < bounds.min || value > bounds.max) return;
      const hz = Math.round(value * 1e6) + direction * step;
      if (hz < bounds.min * 1e6 || hz > bounds.max * 1e6) return;
      frequency.value = (hz / 1e6).toFixed(3);
      updateWindow();
    };
    up.addEventListener("click", () => adjust(1));
    down.addEventListener("click", () => adjust(-1));
    digit.setAttribute("inputmode", "numeric");
    digit.setAttribute("role", "textbox");
    digit.setAttribute("aria-label", `${index + 1}번째 주파수 숫자`);
    digit.setAttribute("aria-hidden", "false");
    digit.addEventListener("focus", () => {
      if (!editingFrequency || settings.disabled || !window.getSelection || !document.createRange) return;
      const range = document.createRange(); range.selectNodeContents(digit);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    digit.addEventListener("input", () => {
      if (!editingFrequency || settings.disabled) { updateFrequencyDigits(); return; }
      const typed = String(digit.textContent).replace(/\D/g, "").slice(-1);
      if (!typed) { updateFrequencyDigits(); return; }
      const digits = Number(frequency.value).toFixed(3).padStart(7, "0").replace(".", "").split("");
      digits[index] = typed;
      frequency.value = Number(`${digits.slice(0, 3).join("")}.${digits.slice(3).join("")}`).toFixed(3);
       updateWindow();
      digitControls[index + 1]?.digit.focus?.();
    });
    digit.addEventListener("keydown", event => {
      if (!editingFrequency || settings.disabled) return;
      if (event.key === "Enter") { event.preventDefault(); frequencyEditButton.click(); }
      if (event.key === "Escape") { event.preventDefault(); frequency.value = frequencyBeforeEditing;  setFrequencyEditing(false); }
    });
    return { step, up, down, digit };
  });

  function updateFrequencyDigits() {
    const bounds = frequencyBounds, value = Number(frequency.value);
    const valid = !!frequency.value.trim() && Number.isFinite(value) && value >= bounds.min && value <= bounds.max;
    const hz = Math.round(value * 1e6);
    const digits = frequency.value.trim() && Number.isFinite(value) && value >= 0 && value < 1000
      ? value.toFixed(3).padStart(7, "0").replace(".", "") : "------";
    digitControls.forEach(({ step, up, down, digit }, index) => {
      digit.textContent = digits[index];
      digit.setAttribute("contenteditable", String(editingFrequency && !settings.disabled));
      digit.setAttribute("tabindex", editingFrequency && !settings.disabled ? "0" : "-1");
      up.disabled = settings.disabled || !valid || hz + step > bounds.max * 1e6;
      down.disabled = settings.disabled || !valid || hz - step < bounds.min * 1e6;
    });
    frequencyDigits.setAttribute("aria-label", valid ? `수신 주파수 ${value.toFixed(3)} MHz` : "주파수 직접 입력 필요");
    frequencyEditButton.disabled = settings.disabled;
  }

  frequencyEditButton.addEventListener("click", () => {
    if (settings.disabled) return;
    if (editingFrequency) {

      const bounds = frequencyBounds, value = Number(frequency.value);
      if (!frequency.value.trim() || !Number.isFinite(value) || value < bounds.min || value > bounds.max) {
        message.textContent = `${bounds.min}–${bounds.max} MHz 범위를 확인하세요.`;
        digitControls[0].digit.focus?.();
        return;
      }
      frequency.value = value.toFixed(3);
      message.textContent = "";
    }
    if (!editingFrequency) frequencyBeforeEditing = frequency.value;
    setFrequencyEditing(!editingFrequency);
    if (editingFrequency) digitControls[0].digit.focus?.();
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
    const listenHz = state === "receiving" && ["wfm", "cw"].includes(rf.mode) ? rf.listenFrequencyHz : null;
    spectrumCanvas.classList.toggle("sdr-spectrum-tunable", canTune);
    spectrumTune.hidden = !canTune;
    if (canTune) spectrumTune.textContent = `선택 ${(selectedHz / 1e6).toFixed(3)} MHz · 드래그로 1 kHz씩 조정`;
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
    dialog.querySelector("[data-spectrum-info]").textContent = `${(data.startHz / 1e6).toFixed(3)}–${(data.endHz / 1e6).toFixed(3)} MHz · FFT ${data.binWidthHz.toFixed(0)} Hz${rf.spectrumPeakHold ? " · 순간 피크 유지" : ""}`;
    spectrumCanvas.setAttribute("aria-label", spectrumSummary.textContent);
  }

  let spectrumPointer = null;
  function canTuneSpectrum() {
    const rf = current?.reception || {};
    return task === "fixed" && !settings.disabled && current?.fixedResultAvailable &&
      ["idle", "error"].includes(current.receptionState) &&
      !!window.SdrSpectrumPlot?.describe(rf.spectrumDbfs, rf.frequencyHz, rf.sampleRate);
  }
  function tuneFromSpectrum(event) {
    if (!spectrumPointer || !canTuneSpectrum()) return;
    // Relative CSS pixels keep fine tuning independent of FFT width and sample rate.
    const steps = Math.round((event.clientX - spectrumPointer.x) / 12);
    const hz = spectrumPointer.hz + steps * 1000;
    const selected = Math.max(frequencyBounds.min * 1e6, Math.min(frequencyBounds.max * 1e6, hz));
    if (selected === Math.round(Number(frequency.value) * 1e6)) return;
    if (spectrumOriginalHz === null) spectrumOriginalHz = spectrumPointer.hz;
    frequency.value = (selected / 1e6).toFixed(3);
    updateWindow();
  }
  spectrumReset.addEventListener("click", () => {
    if (spectrumReset.hidden || spectrumOriginalHz === null || settings.disabled) return;
    frequency.value = (spectrumOriginalHz / 1e6).toFixed(3);
    spectrumOriginalHz = null;
    updateWindow();
  });
  spectrumCanvas.addEventListener("pointerdown", event => {
    if (spectrumPointer || !canTuneSpectrum() || (event.button != null && event.button !== 0)) return;
    const rect = spectrumCanvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = (event.clientY - rect.top) * 240 / rect.height;
    if (x < 48 || x > rect.width - 14 || y < 28 || y > 208) return;
    spectrumPointer = { id: event.pointerId, x: event.clientX, hz: Math.round(Number(frequency.value) * 1e6) };
    spectrumCanvas.setPointerCapture?.(event.pointerId);
    event.preventDefault?.();
  });
  spectrumCanvas.addEventListener("pointermove", event => {
    if (event.pointerId !== spectrumPointer?.id) return;
    tuneFromSpectrum(event);
    event.preventDefault?.();
  });
  for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
    spectrumCanvas.addEventListener(name, event => {
      if (event.pointerId === spectrumPointer?.id) spectrumPointer = null;
    });
  }



  function updateWindow() {
    updateRunButtons();
    updateFrequencyDigits();
    const center = Number(frequency.value), width = Number(rate.value) / 1e6;
    const bounds = frequencyBounds;
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
      : "수신 주파수를 확인하세요.";
    if (dialog.open) renderSpectrum(current);
  }

  frequency.addEventListener("input", updateWindow);
  rate.addEventListener("change", updateWindow);
  scanStart.addEventListener("input", updateWindow);
  scanEnd.addEventListener("input", updateWindow);
  dwell.addEventListener("change", updateWindow);
  for (const input of [gain, ppm, threshold]) input.addEventListener("input", updateWindow);
  function updateTaskControls() {
    const cwScan = task === "scan";
    if (cwScan) dwell.value = "5000";
    dwell.disabled = cwScan;
    dialog.querySelector("[data-audio-panel]").hidden = task !== "fixed";
    updateWindow();
  }
  updateTaskControls();

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
    settingsSection.hidden = resultSection.hidden = footer.hidden = true;
  }

  function render(snapshot) {
    renderMapStatus(snapshot);
    const connected = snapshot.state === "connected";
    dialog.querySelector("[data-usb-section]").dataset.connected = String(connected);
    dialog.querySelector("[data-usb-heading]").hidden = connected;
    status.hidden = connected;
    if (!connected && current?.state === "connected") resetDisconnectedUi();
    const running = ["starting", "receiving", "scanning", "stopping"].includes(snapshot.receptionState);
    settingsSection.hidden = !connected || running;
    resultSection.hidden = !connected || !(running || snapshot.scanResumeAvailable || snapshot.fixedResultAvailable || Object.keys(snapshot.reception || {}).length);
    footer.hidden = !connected;
    if (snapshot.scanResumeAvailable && snapshot.scan && snapshot.scan.startHz != null) {
      if (!lastScan) {
        const scan = snapshot.scan;
        lastScan = { band: scan.band, mode: RECEIVE_MODE, startHz: scan.startHz, endHz: scan.endHz,
          sampleRate: scan.requestedSampleRate, gainTenthsDb: scan.requestedGainTenthsDb,
          ppm: scan.ppm, dwellMs: scan.dwellMs, thresholdDb: scan.thresholdDb };
        restoreScanOptions(lastScan);
        if (!snapshot.backgroundReceiving && snapshot.receptionState !== "receiving") setTask("scan", false);
      }
    }
    if (snapshot.backgroundReceiving && !restoredFixed && snapshot.reception?.frequencyHz) {
      const rf = snapshot.reception;
      const bounds = frequencyBounds;
      frequency.min = String(bounds.min);
      frequency.max = String(bounds.max);
      dialog.querySelector("[data-frequency-range]").textContent = "MHz";
      frequency.value = ((rf.listenFrequencyHz || rf.frequencyHz) / 1e6).toFixed(3);
      if (rf.sampleRate) rate.value = String(rf.sampleRate);
      if (Number.isFinite(rf.gainDb)) gain.value = String(rf.gainDb);
      if (Number.isFinite(rf.ppm)) ppm.value = String(rf.ppm);
      restoredFixed = true;
      setTask("fixed", false);
    }
    const previousReception = current && current.receptionState;
    current = snapshot;
    updateDialogViewport(snapshot);
    updateRunButtons();
    const names = { unsupported: "USB Host 미지원", permissionPending: "USB 권한 대기 중", connected: "USB 연결됨", idle: "USB 연결 대기" };
    status.textContent = names[snapshot.state] || "상태 확인 필요";
    list.replaceChildren();
    const devices = (snapshot.devices || []).filter(device => device.candidate && (!connected || device.connected));
    if (!devices.length) {
      const empty = document.createElement("p");
      empty.textContent = "RTL-SDR 없음 · USB 연결 확인";
      list.appendChild(empty);
    }
    devices.forEach(function (device) {
      const card = document.createElement("div");
      card.className = "sdr-device";
      const title = document.createElement("strong");
      title.textContent = typeof device.name === "string" && device.name.trim() ? device.name.trim() : "RTL-SDR 수신기";
      title.setAttribute("title", title.textContent);
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
      button.textContent = snapshot.state === "permissionPending" ? "권한 대기" : "연결";
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
    refreshButton.hidden = connected;
    disconnectButton.hidden = !connected && snapshot.state !== "permissionPending";
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
    startButton.hidden = receiving;
    stopButton.hidden = !(receiving || canClearScan || canClearFixed);
    const rfNames = { idle: "수신 대기", starting: "튜너 초기화 중…", receiving: "IQ 수신 중", scanning: "대역 탐색 중", stopping: "수신 정지 중…", error: "수신 오류" };
    if (snapshot.receptionError) message.textContent = snapshot.receptionError;
    const rf = snapshot.reception || {};
    const strengthValid = rf.hasSamples && Number.isFinite(rf.signalDbfs);
    const cwStrength = rf.mode === "cw";
    const noiseReady = Number.isFinite(rf.noiseDbfs) && Number.isFinite(rf.signalExcessDb);
    // CW: fixed 3 dB steps above a 6 dB noise margin. WFM keeps its RF scale.
    const strengthLevel = strengthValid ? cwStrength
      ? noiseReady ? Math.max(0, Math.min(10, Math.ceil((rf.signalExcessDb - 6) / 3))) : 0
      : Math.max(0, Math.min(10, Math.ceil((rf.signalDbfs + 90) / 8))) : 0;
    const strengthBars = dialog.querySelector("[data-strength-bars]");
    strengthBars.setAttribute("aria-valuenow", String(strengthLevel));
    strengthBars.setAttribute("aria-valuetext", strengthValid ? cwStrength && noiseReady
      ? `${strengthLevel}/10 · 잡음 대비 ${rf.signalExcessDb.toFixed(1)} dB`
      : cwStrength ? "잡음 수준 측정 중" : `${strengthLevel}/10 · ${rf.signalDbfs.toFixed(1)} dBFS` : "측정 대기");
    strengthBars.dataset.state = snapshot.receptionState === "receiving" ? "live" : "stopped";
    for (let i = 0; i < 10; i++) dialog.querySelector(`[data-strength-bar="${i}"]`).classList.toggle("is-active", i < strengthLevel);
    dialog.querySelector("[data-strength-value]").textContent = strengthValid ? `${rf.signalDbfs.toFixed(1)} dBFS` : "—";
    dialog.querySelector("[data-strength-state]").textContent = strengthValid
      ? snapshot.receptionState === "receiving" ? rf.clippingPercent > 1 ? "입력 포화 · Gain을 낮춰 확인하세요."
        : cwStrength ? noiseReady
          ? `${strengthLevel ? "신호 상승" : "잡음 수준"} · 잡음 대비 +${rf.signalExcessDb.toFixed(1)} dB · 배경 ${rf.noiseDbfs.toFixed(1)} dBFS`
          : "배경 잡음 측정 중…" : "청취 주파수 주변 · 상대 신호 세기"
        : "수신 정지 · 마지막 측정값"
      : rf.mode === "iq" ? "CW 또는 WFM에서 신호 세기를 측정합니다." : "신호 세기 측정 대기";
    const receivedHz = rf.listenFrequencyHz || rf.frequencyHz;
    const receptionLabel = snapshot.receptionState === "receiving" ? "수신 중" :
      snapshot.receptionState === "stopping" ? "정지 중" : snapshot.receptionState === "error" ? "수신 오류" : "정지됨";
    dialog.querySelector("[data-frequency-readout]").textContent = Number.isFinite(receivedHz) && receivedHz > 0
      ? `${(receivedHz / 1e6).toFixed(3)} MHz · ${(rf.mode || "iq").toUpperCase()} · ${receptionLabel}`
      : snapshot.receptionState === "starting" ? "수신 주파수 · 초기화 중…" : "수신 주파수 —";
    dialog.querySelector("[data-throughput]").textContent = rf.totalBytes != null ? `${(rf.bytesPerSecond / 1e6).toFixed(2)} MB/s` : "—";
    dialog.querySelector("[data-power]").textContent = rf.hasSamples ? `${rf.powerDbfs.toFixed(1)} dBFS` : "—";
    if (receiving) status.textContent = rfNames[snapshot.receptionState];
    else if (task === "scan" && snapshot.scanResumeAvailable) status.textContent = "탐색 일시정지";
    if (["scanning", "receiving"].includes(snapshot.receptionState)) status.dataset.activity = snapshot.receptionState;
    else delete status.dataset.activity;
    const audio = snapshot.audio || {};
    dialog.querySelector("[data-audio-status]").hidden = !audio.notice;
    const wfm = ["wfm", "cw"].includes(rf.mode) && snapshot.receptionState === "receiving";
    audioButton.disabled = busy || !wfm || !plugin || typeof plugin.setAudio !== "function";
    audioButton.textContent = audio.enabled ? "음소거" : "소리 켜기";
    audioButton.setAttribute("aria-pressed", String(!!audio.enabled));
    dialog.querySelector("[data-audio-status]").textContent = audio.notice ||
      (audio.enabled ? `${audio.output || "Android 미디어 출력"}${audio.droppedBlocks ? ` · 오디오 누락 ${audio.droppedBlocks}회` : ""}` :
      wfm ? "음소거" : "재생 대기");
    if (wfm) {
      status.textContent = `${rf.mode.toUpperCase()} 수신 중 · ` + (audio.enabled ? "소리 재생" : "음소거");
    }
    renderSpectrum(snapshot);
    renderCandidates(snapshot);
    if (["receiving", "scanning"].includes(snapshot.receptionState) && !["receiving", "scanning"].includes(previousReception)) {
      resultSection.scrollIntoView?.({ block: "start", behavior: "smooth" });
    }
  }

  function renderCandidates(snapshot) {
    const scan = snapshot.scan || {};
    dialog.querySelector("[data-candidate-heading]").textContent = scan.mode === "cw" ? "반복 펄스 후보" : scan.mode === "wfm" || scan.band === "fm" ? "FM 방송 후보" : "신호 후보";
    const isRecent = candidate => Number.isInteger(candidate.lastSeenCycle) && Number.isInteger(scan.cycle)
      ? scan.cycle - candidate.lastSeenCycle <= 1
      : scan.elapsedSeconds - candidate.lastSeenSeconds <= Math.max(10, (scan.cycleSeconds || 5) * 2);
    const candidates = [...(scan.candidates || [])].sort((a, b) => Number(isRecent(b)) - Number(isRecent(a)) ||
      (b.snrDb ?? 0) - (a.snrDb ?? 0) || a.frequencyHz - b.frequencyHz);
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
      const level = Number.isFinite(candidate.snrDb) ? Math.max(0, Math.min(4, Math.ceil((candidate.snrDb - 6) / 7.5))) : 0;
      button.signalIcon.dataset.level = String(level);
      button.signalIcon.setAttribute("aria-label", `${recent ? measuring ? "최근 감지" : "마지막 측정" : "최근 미감지"} · 잡음 대비 세기 ${level}/4단계`);
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
    const bounds = frequencyBounds;
    for (const input of [frequency, scanStart, scanEnd]) { input.min = String(bounds.min); input.max = String(bounds.max); }
    dialog.querySelector("[data-frequency-range]").textContent = "MHz";
    scanStart.value = (options.startHz / 1e6).toFixed(3); scanEnd.value = (options.endHz / 1e6).toFixed(3);
    rate.value = String(options.sampleRate); gain.value = String(options.gainTenthsDb / 10); ppm.value = String(options.ppm);
    dwell.value = "5000"; threshold.value = String(options.thresholdDb);
  }

  async function selectCandidate(hz) {
    if (!lastScan || !Number.isFinite(hz)) return;
    const attempt = ++connectionAttempt;
    await plugin.stopReception();
    if (attempt !== connectionAttempt || !dialog.open || !current || current.state !== "connected") return;
    restoreScanOptions(lastScan);
    frequency.value = (hz / 1e6).toFixed(3);
    candidateSelected = true;
    setTask("fixed");
    await plugin.startReception({ band: lastScan.band, mode: RECEIVE_MODE, frequencyHz: Math.round(Number(frequency.value) * 1e6),
      listenFrequencyHz: Math.round(Number(frequency.value) * 1e6), sampleRate: lastScan.sampleRate,
      gainTenthsDb: lastScan.gainTenthsDb, ppm: lastScan.ppm, deemphasisUs: DEEMPHASIS_US });
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
    settingsSection.hidden = resultSection.hidden = footer.hidden = true;
    renderSpectrum(current);
    message.textContent = "";
    status.textContent = "USB 연결 상태 확인 중…";
    refreshButton.disabled = true;
    disconnectButton.disabled = true;
    startButton.disabled = true;
    stopButton.disabled = true;
    settings.disabled = true;
    list.replaceChildren();
    dialog.querySelector("[data-usb-section]").dataset.connected = "false";
    dialog.querySelector("[data-usb-section]").hidden = false;
    dialog.querySelector("[data-usb-heading]").hidden = false;
    status.hidden = false;
    refreshButton.hidden = false;
    disconnectButton.hidden = true;
    try {
      if (!plugin) plugin = getAndroidPlugin();
      if (!plugin) {
        status.textContent = "USB 연결 확인은 Android 앱에서 사용할 수 있습니다.";
        dialog.querySelector("[data-usb-section]").hidden = true;
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
    const bounds = frequencyBounds;
    if (task === "scan") {
      const start = Number(scanStart.value) * 1e6, end = Number(scanEnd.value) * 1e6;
      const dwellMs = Number(dwell.value), thresholdDb = Number(threshold.value);
      if (![scanStart, scanEnd, gain, ppm, threshold].every(input => String(input.value).trim() !== "") ||
          !bounds || !Number.isFinite(start) || !Number.isFinite(end) || start < bounds.min * 1e6 || end > bounds.max * 1e6 ||
          end - start < 100000 || !sampleRates.includes(sampleRate) || !Number.isFinite(gainDb) || gainDb < -10 || gainDb > 50 ||
          !Number.isInteger(correction) || Math.abs(correction) > 100 || ![500, 1000, 2000, 5000].includes(dwellMs) ||
          !Number.isFinite(thresholdDb) || thresholdDb < 6 || thresholdDb > 30) {
        throw new Error("탐색 범위는 0.1–999.999 MHz 안에 있어야 합니다. 최소 탐색 폭은 0.100 MHz이며, 고급 설정도 확인하세요.");
      }
      if (typeof plugin.startScan !== "function") throw new Error("대역 탐색을 지원하는 최신 APK를 설치하세요.");
      const options = { band: "wide", mode: RECEIVE_MODE, startHz: Math.round(start), endHz: Math.round(end), sampleRate,
        gainTenthsDb: Math.round(gainDb * 10), ppm: correction, dwellMs, thresholdDb };
      await plugin.startScan(canResumeScan(options) ? { ...options, resume: true } : options); lastScan = options;
      return;
    }
    if (![frequency, rate, gain, ppm].every(input => String(input.value).trim() !== "") ||
        !bounds || !Number.isFinite(hz) || hz < bounds.min * 1e6 || hz > bounds.max * 1e6 || !sampleRates.includes(sampleRate) ||
        !Number.isFinite(gainDb) || gainDb < -10 || gainDb > 50 || !Number.isInteger(correction) || Math.abs(correction) > 100) {
      throw new Error("주파수는 0.1–999.999 MHz 안에 입력하세요. 샘플레이트·Gain·PPM 설정 범위도 확인하세요.");
    }
    const listenHz = hz;
    const options = { band: "wide", mode: RECEIVE_MODE, frequencyHz: Math.round(hz), listenFrequencyHz: Math.round(listenHz), sampleRate,
      gainTenthsDb: Math.round(gainDb * 10), ppm: correction, deemphasisUs: DEEMPHASIS_US };
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
      if (!settings.disabled) { frequency.value = frequencyBeforeEditing;  }
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
