(function () {
  "use strict";
  const trigger = document.getElementById("btn-sdr-diagnostics");
  if (!trigger) return;
  const dialog = document.createElement("dialog");
  dialog.className = "sdr-dialog";
  dialog.setAttribute("aria-labelledby", "sdr-title");
  dialog.innerHTML = `
    <div class="sdr-header"><div><span class="sdr-eyebrow">SDR · 수신 테스트</span><h2 id="sdr-title">수신기 설정</h2></div><button type="button" data-close>닫기</button></div>
    <div class="sdr-body">
    <p class="sdr-status" role="status">연결 상태 확인 전</p>
    <p class="sdr-message" role="alert"></p>
    <details data-usb-section class="sdr-section sdr-usb-section" open><summary><span>USB 장치</span><span class="sdr-chevron" aria-hidden="true">⌄</span></summary><div data-devices></div><div class="sdr-actions sdr-usb-tools"><button type="button" data-refresh>장치 새로고침</button><button type="button" data-disconnect>연결 해제 / 취소</button></div></details>
    <details data-settings-section class="sdr-section" open><summary>수신 설정</summary>
      <fieldset data-settings class="sdr-settings" disabled>
        <div class="sdr-fields">
        <label class="sdr-wide">수신 대역<select data-band><option value="vhf">현장 VHF · 148–174 MHz</option><option value="fm">FM 방송 · 88–108 MHz</option></select></label>
        <label class="sdr-wide">수신 모드<select data-mode><option value="iq">IQ · 신호 분석</option><option value="wfm">WFM · FM 방송</option></select></label>
        <div class="sdr-wide sdr-frequency-field">
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
        </div><p data-window class="sdr-note"></p></details>
      </fieldset>
    </details>
    <details data-result class="sdr-section"><summary>수신 결과</summary>
      <div class="sdr-metrics"><div><span>수신 데이터</span><strong data-throughput>—</strong></div><div><span>대역 전력</span><strong data-power>—</strong></div></div>
      <div class="sdr-audio" data-audio-panel hidden><div class="sdr-audio-head"><div><strong>수신음</strong></div><button type="button" data-audio disabled aria-pressed="false">소리 켜기</button></div><p data-audio-status class="sdr-note">음소거</p></div>
      <figure class="sdr-spectrum"><figcaption>스펙트럼</figcaption>
        <canvas data-spectrum role="img" aria-label="수신 시작 후 주파수별 전력 그래프가 표시됩니다."></canvas>
        <p data-spectrum-summary class="sdr-note">수신 대기</p>
      </figure>
      <details class="sdr-help"><summary>측정 정보</summary><p data-applied class="sdr-note"></p><p data-quality class="sdr-note"></p><p data-spectrum-info class="sdr-note"></p></details>
    </details>
    <details class="sdr-help"><summary>도움말</summary>
      <p>IQ는 신호 분석, WFM은 FM 방송 재생입니다. 음량은 휴대폰 미디어 볼륨으로 조절합니다.</p>
      <p>샘플레이트는 수신 폭, Gain은 증폭, PPM은 주파수 오차 보정입니다. 세기 비교 시 설정을 유지하세요.</p>
      <p>전력은 상대값이며 비콘·거리·방향을 판정하지 않습니다. 중심 DC와 가장자리는 최대 지점에서 제외합니다. 창을 닫거나 앱을 벗어나면 수신이 정지합니다.</p>
    </details>
    </div>
    <div class="sdr-footer">
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
  const resultSection = dialog.querySelector("[data-result]");
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
  let sequence = 0;
  let connectionAttempt = 0;
  const frequencyEditor = dialog.querySelector("[data-frequency-entry]");
  const frequencyDigits = dialog.querySelector("[data-frequency-digits]");
  const frequencyEditButton = dialog.querySelector("[data-frequency-edit]");
  let editingFrequency = false;
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
    editingFrequency = !editingFrequency;
    frequencyEditor.hidden = !editingFrequency;
    frequencyDigits.hidden = editingFrequency;
    frequencyEditButton.textContent = editingFrequency ? "완료" : "직접 입력";
    frequencyEditButton.setAttribute("aria-expanded", String(editingFrequency));
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
    plot.draw(spectrumCanvas, data, centerHz, rateHz, state, rf.mode === "wfm" ? rf.listenFrequencyHz : mode.value === "wfm" ? Number(frequency.value) * 1e6 : null);
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

  function updateWindow() {
    updateFrequencyDigits();
    const center = Number(frequency.value), width = Number(rate.value) / 1e6;
    const bounds = bands[selectedBand];
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
    selectedBand = band.value;
    frequency.min = String(next.min); frequency.max = String(next.max);
    frequency.value = rememberedFrequency[selectedBand];
    dialog.querySelector("[data-frequency-range]").textContent = `MHz · ${next.min}–${next.max}`;
    if (selectedBand !== "fm") mode.value = "iq";
    updateMode();
  });
  frequency.addEventListener("input", updateWindow);
  rate.addEventListener("change", updateWindow);
  function updateMode() {
    const wfm = mode.value === "wfm";
    dialog.querySelector("[data-deemphasis-field]").hidden = !wfm;
    dialog.querySelector("[data-audio-panel]").hidden = !wfm;
    updateWindow();
  }
  mode.addEventListener("change", () => {
    if (mode.value === "wfm" && selectedBand !== "fm") {
      band.value = "fm"; selectedBand = "fm"; frequency.value = "103.500";
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

  function render(snapshot) {
    if (snapshot.state === "connected" && (!current || current.state !== "connected")) {
      dialog.querySelector("[data-usb-section]").open = false;
    } else if (snapshot.state !== "connected") {
      dialog.querySelector("[data-usb-section]").open = true;
    }
    const previousReception = current && current.receptionState;
    current = snapshot;
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
    const receiving = ["starting", "receiving", "stopping"].includes(snapshot.receptionState);
    settings.disabled = busy || receiving || snapshot.state === "unsupported";
    updateFrequencyDigits();
    startButton.disabled = settings.disabled || snapshot.state !== "connected" || !plugin || typeof plugin.startReception !== "function";
    stopButton.disabled = busy || !receiving || snapshot.receptionState === "stopping";
    const rfNames = { idle: "수신 대기", starting: "튜너 초기화 중…", receiving: "IQ 수신 중", stopping: "수신 정지 중…", error: "수신 오류" };
    if (snapshot.receptionError) message.textContent = snapshot.receptionError;
    const rf = snapshot.reception || {};
    dialog.querySelector("[data-throughput]").textContent = rf.totalBytes != null ? `${(rf.bytesPerSecond / 1e6).toFixed(2)} MB/s` : "—";
    dialog.querySelector("[data-power]").textContent = rf.hasSamples ? `${rf.powerDbfs.toFixed(1)} dBFS` : "—";
    dialog.querySelector("[data-applied]").textContent = rf.tuner ? `${rf.tuner} · ${(rf.frequencyHz / 1e6).toFixed(3)} MHz · ${(rf.sampleRate / 1e6).toFixed(3)} MS/s · Gain ${rf.gainDb} dB · ${rf.ppm} PPM` : "";
    dialog.querySelector("[data-quality]").textContent = rf.totalBytes != null ? `누적 ${(rf.totalBytes / 1e6).toFixed(1)} MB · ${rf.elapsedSeconds.toFixed(1)}초 · 포화 샘플 ${rf.clippingPercent.toFixed(2)}%${rf.clippingPercent > 1 ? " · Gain을 낮춰 확인하세요." : ""}` : "";
    if (receiving) status.textContent = rfNames[snapshot.receptionState];
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
    if (snapshot.receptionState === "receiving" && previousReception !== "receiving") {
      resultSection.open = true;
      dialog.querySelector("[data-settings-section]").open = false;
      resultSection.scrollIntoView?.({ block: "start", behavior: "smooth" });
    }
  }

  async function refresh() {
    if (!plugin) return;
    const request = ++sequence;
    const snapshot = await plugin.getStatus();
    if (request === sequence) render(snapshot);
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
    dialog.showModal();
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
      if (!listener) listener = await plugin.addListener("usbStateChanged", function (snapshot) {
        ++sequence;
        if (dialog.open) render(snapshot);
      });
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
  stopButton.addEventListener("click", () => run(() => plugin.stopReception()));
  // This action must remain available while a permission call is outstanding.
  disconnectButton.addEventListener("click", async function () {
    ++connectionAttempt;
    try { await plugin.closeDevice(); message.textContent = ""; await refresh(); }
    catch (error) { message.textContent = error.message || String(error); }
  });
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", async function () {
    ++connectionAttempt;
    if (!plugin) return;
    try { await plugin.closeDevice(); } catch (error) { console.warn("SDR close:", error); }
  });
  if (typeof window.addEventListener === "function") {
    window.addEventListener("resize", () => { if (dialog.open) renderSpectrum(current); });
  }
})();
