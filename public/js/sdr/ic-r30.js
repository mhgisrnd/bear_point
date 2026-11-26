(function (root) {
  "use strict";
  const MODES = ["LSB", "USB", "AM", "AM-N", "CW", "FM", "FM-N", "WFM", "CW-R", "P25", "D-STAR", "dPMR", "NXDN-VN", "NXDN-N", "DCR"];
  const formatHz = hz => root.BearSdrAnimals.formatHz(hz);
  function mount(dialog, options) {
    const { revealSignal = section => section.scrollIntoView?.({ block: "start" }) } = options;
    const selector = dialog.querySelector("[data-receiver-selector]");
    selector.innerHTML = `<button type="button" data-receiver-bt aria-pressed="true"><strong>Bluetooth</strong><span>IC-R30 · 제어 · S-Meter</span></button><button type="button" data-receiver-usb aria-pressed="false"><strong>USB</strong><span>RTL-SDR · 청취 · 탐색</span></button>`;
    const panel = dialog.querySelector("[data-bluetooth]");
    const footer = dialog.querySelector("[data-bt-footer]");
    footer.innerHTML = `<p data-bt-target class="sdr-footer-context" role="status"></p><button type="button" data-bt-view class="sdr-primary sdr-stage-action" disabled>수신 보기</button><button type="button" data-bt-register class="sdr-primary sdr-register-observation sdr-stage-action" disabled>관측점 등록</button>`;
    panel.innerHTML = `
      <p data-bt-error class="sdr-message sdr-workflow-error" role="alert"></p>
      <div class="sdr-connection-pane">
      <section data-bt-connection class="sdr-connection" data-connected="false" aria-label="Bluetooth 수신기">
      <div class="sdr-connection-heading"><h3 data-bt-heading class="sdr-stage-heading"><span class="sdr-step" aria-hidden="true">1</span> 수신기 연결</h3><div class="sdr-connection-tools"><button type="button" data-bt-refresh>기기 새로고침</button><button type="button" data-bt-disconnect class="sdr-quiet" hidden>연결 해제</button></div></div>
      <p data-bt-status class="sdr-connection-status" role="status">Bluetooth 연결 대기</p>
      <div data-bt-connected class="sdr-connection-current" hidden><div class="sdr-device sdr-device-connected"><strong data-bt-connected-name></strong><span class="sdr-connected-badge">연결됨</span></div></div>
      <div data-bt-devices class="sdr-device-list"><p>페어링된 기기를 확인하려면 기기 새로고침을 누르세요.</p></div>
      <details data-bt-other-devices class="sdr-help" hidden><summary data-bt-other-devices-title>다른 페어링 기기 보기</summary><p>Android에 저장된 서비스 정보에서 SPP가 확인되지 않았거나 정보가 없는 기기입니다. 수신기가 기본 목록에 없다면 여기서 확인하세요.</p><div data-bt-other-device-list class="sdr-device-list"></div></details>
      <p data-bt-service-help class="sdr-note">기본 목록은 SPP 직렬 통신 서비스가 확인된 기기입니다. SPP 지원만으로 수신기 호환이 보장되지는 않습니다. 현재 제어는 IC-R30용입니다.</p>
      <details data-bt-pairing class="sdr-help"><summary>처음 연결하는 경우</summary><p>Android 설정에서 IC-R30을 먼저 페어링하세요. Serialport Function = CI-V (Echo Back OFF), CI-V 주소 9C를 사용합니다.</p><button type="button" data-bt-settings class="sdr-quiet">Android Bluetooth 설정 열기</button></details>
      </section>
      </div>
      <section data-bt-controls class="sdr-section" hidden>
        <div class="sdr-animals-pane">
        <h3 class="sdr-stage-heading"><span class="sdr-step" aria-hidden="true">2</span> 개체 · 주파수 설정</h3>
        <div class="sdr-animal-picker">
        <div class="sdr-animal-heading"><strong>찾을 개체</strong><button type="button" data-bt-clear disabled>선택 해제</button><button type="button" data-bt-catalog-refresh>목록 새로고침</button></div>
        <div class="sdr-catalog-results">
        <form data-bt-search-form role="search"><input type="search" data-bt-search aria-label="IC-R30 개체 번호 검색" placeholder="개체 번호 검색" autocomplete="off" enterkeyhint="search"></form>
        <p data-bt-catalog-notice class="sdr-note" role="status"></p><div class="sdr-animal-list-tools"><p data-bt-animal-count class="sdr-note" role="status"></p><button type="button" data-bt-favorites-filter aria-pressed="false">☆ 즐겨찾기</button></div><div data-bt-animals class="sdr-animal-list" aria-label="IC-R30 개체 검색 결과"></div>
        </div>
        </div>
        </div>
        <div data-bt-tuning class="sdr-tuning-pane">
        <fieldset data-bt-fields class="sdr-settings">
          <div class="sdr-frequency-field">
            <div class="sdr-frequency-heading"><div><strong>수신 주파수</strong><span>MHz · 0.1–3304.999</span><span data-bt-frequency-animal class="sdr-frequency-animal" aria-live="polite" hidden></span></div><button type="button" data-bt-frequency-edit aria-expanded="false">직접 입력</button></div>
            <div data-bt-frequency-entry class="sdr-frequency-entry" hidden><input data-bt-frequency-draft type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" aria-label="IC-R30 수신 주파수 MHz" aria-describedby="sdr-bt-frequency-error" placeholder="148.24130" /><span data-bt-frequency-error id="sdr-bt-frequency-error" role="status" hidden></span></div>
            <div data-bt-frequency-digits class="sdr-frequency-digits sdr-frequency-four" role="group" aria-label="주파수 자릿수 조정">${root.BearSdrFrequency.markup("bt-", 4)}</div>
            <input data-bt-frequency type="hidden" />
          </div>
        </fieldset>
          <div data-bt-volume-settings hidden>
            <div class="sdr-bt-volume" role="group" aria-labelledby="sdr-bt-volume-label">
              <span id="sdr-bt-volume-label">R30 볼륨</span>
              <button type="button" data-bt-volume-down class="sdr-secondary" aria-label="R30 볼륨 줄이기">−</button>
              <output data-bt-volume aria-label="R30 볼륨 단계">—</output>
              <button type="button" data-bt-volume-up class="sdr-secondary" aria-label="R30 볼륨 높이기">+</button>
            </div>
            <p class="sdr-note sdr-bt-volume-status" data-bt-volume-status role="status" hidden></p>
          </div>
          <details data-bt-advanced-settings class="sdr-advanced"><summary>상세 설정<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary>
          <fieldset data-bt-mode-fields class="sdr-settings">
          <div class="sdr-bt-mode"><label for="sdr-bt-mode">수신 모드</label><select id="sdr-bt-mode" data-bt-mode aria-label="IC-R30 수신 모드">${MODES.map(mode => `<option>${mode}</option>`).join("")}</select><button type="button" data-bt-apply-mode class="sdr-secondary">적용</button></div>
          </fieldset>
          <p class="sdr-note">USB의 Gain·PPM은 RTL-SDR 전용 설정이며 감지 기준은 I/Q 분석용입니다. IC-R30의 RF GAIN·ATT는 수신기에서 조정하세요. 현재 앱에서는 해당 제어를 제공하지 않습니다.</p>
          </details>
        </div>
      </section>
        <div class="sdr-section sdr-signal-pane" data-bt-signal hidden>
        <div class="sdr-bt-signal-summary">
          <h3 class="sdr-stage-heading"><span class="sdr-step" aria-hidden="true">3</span> 신호 확인</h3>
          <p data-bt-readout class="sdr-frequency-readout" aria-live="polite">수신 주파수 —</p>
          <p data-bt-measurement-status class="sdr-note" role="status" hidden></p>
        </div>
        <div class="sdr-strength sdr-bt-meter"><div class="sdr-strength-heading"><strong>S-Meter</strong><span data-bt-strength>측정 대기</span></div>
          <div data-bt-meter class="sdr-strength-bars" role="meter" aria-label="IC-R30 S-Meter 원시값" aria-valuemin="0" aria-valuemax="255">${Array.from({ length: 10 }, (_, i) => `<span data-bt-bar="${i}" style="height:${8 + i * 3}px"></span>`).join("")}</div>
        </div>
        <div class="sdr-strength sdr-bt-audio">
          <div class="sdr-audio-head"><strong>USB 오디오 입력</strong>
            <button type="button" data-bt-audio-permission class="sdr-secondary" hidden>마이크 권한 허용</button>
          <div data-bt-audio-playback class="sdr-listening-controls" hidden>
            <label>청취 필터 <select data-bt-audio-filter>
              <option value="0">원음</option><option value="1">약</option><option value="2">중</option><option value="3">강</option>
            </select></label>
            <button type="button" data-bt-audio-mute aria-pressed="false" class="sdr-secondary">음소거</button>
          </div>
          </div>
          <p data-bt-audio-status class="sdr-note" role="status">USB 오디오 연결 대기 중</p>
          <p data-bt-audio-speaker-notice class="sdr-note" role="status" hidden></p>
          <figure class="sdr-spectrum">
            <figcaption>오디오 스펙트럼</figcaption>
            <canvas data-bt-audio-spectrum role="img" aria-label="오디오 입력 대기"></canvas>
            <p data-bt-audio-peak class="sdr-note">USB 오디오가 연결되면 주파수별 피크가 표시됩니다.</p>
          </figure>
          <p data-bt-audio-silent class="sdr-message sdr-workflow-error" role="alert" hidden>오디오 신호 없음 · 잡음도 들어오지 않습니다. IH389 전원·R30 연결, 3.5mm 잭, R30 스퀠치 열림을 확인하세요.</p>
          <p data-bt-audio-level class="sdr-note" hidden></p>
          <p data-bt-audio-tone class="sdr-note" role="status" hidden></p>
        </div>
        </div>
      <div class="sdr-diagnostics-pane">
      <section class="sdr-reception-diagnostic sdr-bt-test">
        <h3>수신 진단</h3>
        <div class="sdr-log-actions"><button type="button" data-bt-test-start class="sdr-primary" disabled>10초 기록</button><button type="button" data-bt-test-stop disabled>기록 종료</button></div>
        <button type="button" data-bt-test-audio-permission class="sdr-secondary" hidden>마이크 권한 허용</button>
        <p data-bt-test-audio-status class="sdr-note" role="status" hidden></p>
        <p class="sdr-note">USB 오디오로 들어오는 수신음과 S-Meter를 10초간 기록합니다. ZIP에서 수신음 WAV와 측정값 CSV를 확인할 수 있습니다.</p>
        <p data-bt-test-summary class="sdr-note" role="status">기록 대기</p>
        ${root.BearSdrDiagnosticTrace.markup("bt-test")}
        <p class="sdr-note">기록 중에는 수신기에서 주파수와 모드를 유지하세요.</p>
      </section>
      <section class="sdr-reception-diagnostic sdr-saved-log-list">
        <h3>Bluetooth 저장된 로그</h3>
        <p data-bt-saved-status class="sdr-note" role="status">저장된 기록 없음</p>
        <div class="sdr-log-actions"><button type="button" data-bt-test-save disabled>파일 저장</button><button type="button" data-bt-test-share disabled>파일 공유</button><button type="button" data-bt-test-delete class="sdr-danger" disabled>선택 삭제</button></div>
        ${root.BearSdrLogs.markup("bt-test", "저장된 Bluetooth 수신 진단 기록")}
        <audio data-bt-test-player controls preload="none" aria-label="저장된 Bluetooth 수신음" hidden></audio>
      </section>
      </div>
      <details class="sdr-help sdr-monitor-help"><summary>연결 유지 · 지원 기능 안내</summary><p>SPP는 주파수·모드 제어와 S-Meter 조회에 사용합니다. 연결된 USB 오디오의 재생과 필터는 화면을 꺼도 유지됩니다. 알림에서 소리를 끄거나 Bluetooth 연결을 해제할 수 있습니다.</p></details>`;
    const node = key => (["target", "register", "view"].includes(key) ? footer : panel).querySelector(`[data-bt-${key}]`);
    const renderDiagnosticAudio = root.BearSdrDiagnosticTrace.mount(panel, "bt-test");
    const logs = root.BearSdrLogs.mount({
      scroll: node("test-log-scroll"), selectAll: node("test-select-all"),
      list: node("test-record"), status: node("saved-status"), player: node("test-player"),
      save: node("test-save"), share: node("test-share"), remove: node("test-delete"), run,
      describe: record => ({
        title: new Date(record.createdAt).toLocaleString("ko-KR"),
        detail: `${record.hasAudio ? "수신음 · S-Meter" : "S-Meter"} · ${(record.bytes / 1024).toFixed(1)} KB`
      }),
      loadAudio: id => plugin.getTestAudio({ id }),
      saveLogs: options => plugin.saveTest(options),
      shareLogs: options => plugin.shareTest(options),
      deleteLog: async id => applySnapshot(await plugin.deleteTest({ id }))
    });
    const meterBars = Array.from({ length: 10 }, (_, i) => panel.querySelector(`[data-bt-bar="${i}"]`));
    const usbButton = selector.querySelector("[data-receiver-usb]");
    const btButton = selector.querySelector("[data-receiver-bt]");
    let selected = true, plugin = null, listener = null, busy = false, loadingCatalog = false, disconnecting = false;
    let diagnosticSelection = null;
    let snapshot = { state: "idle", measurement: null, error: "" };
    let animals = [], target = null, deviceKey = "", animalKey = "", catalogNotice = "";
    let draftFrequency = false, draftMode = false, localError = "";
    let requestedVolume = null, volumeError = "";
    let updating = false, lastReading = null, animalCards = [];
    let audioSession = 0, audioTimer, audioState = { state: "idle" }, audioWatching = false, playbackPending = false;
    // Field-measured spectrum peaks (R30 vol 20): Nexi card alone or IH389 off ≤ −100 dBFS/bin,
    // IH389 linked with only receiver noise ≈ −40s, beep up to −10. −70 splits them with 30 dB margin.
    const SILENT_DBFS = -70, SILENT_FRAMES = 40; // below −70 dBFS/bin for ~5 s of 125 ms frames
    let silentFrames = 0;
    const matchesFrequency = root.BearSdrFrequency.matchesAnimalFrequency;
    const frequencyControls = root.BearSdrFrequency.mount(panel, {
      prefix: "bt-", wholeDigits: 4, frequency: node("frequency"),
      disabled: () => busy || !connected() || testing(),
      bounds: () => ({ min: 0.1, max: 3304.999 }), format: formatHz,
      onChange: () => {
        draftFrequency = frequencyControls.editing() || Math.round(Number(node("frequency").value) * 1e6) !== snapshot.measurement?.frequencyHz;
        render();
      },
      onCommit: () => run(() => tune(Math.round(Number(node("frequency").value) * 1e6)), true),
      onCancel: () => { if (validReading()) node("frequency").value = formatHz(snapshot.measurement.frequencyHz); }
    });
    const native = root.Capacitor?.getPlatform?.() === "android";
    function connected() { return snapshot.state === "connected"; }
    function testing() { return snapshot.test?.active === true; }
    function locked() { return busy || snapshot.state === "connecting" || connected(); }
    function updateUsb(usbActive = false) {
      if (usbActive && selected && !connected() && snapshot.state !== "connecting") selected = false;
      const showingDiagnostics = diagnosticSelection !== null;
      const showingBluetooth = diagnosticSelection ?? selected;
      dialog.dataset.transport = showingBluetooth ? "bluetooth" : "usb";
      panel.hidden = !showingBluetooth;
      selector.setAttribute("aria-label", showingDiagnostics ? "수신 진단 기록 종류" : "수신기 연결 방식");
      btButton.disabled = !showingDiagnostics && (usbActive || options.usbLocked());
      usbButton.disabled = !showingDiagnostics && locked();
      usbButton.setAttribute("aria-pressed", String(!showingBluetooth));
      btButton.setAttribute("aria-pressed", String(showingBluetooth));
      footer.hidden = !selected || !connected();
    }
    function showDiagnostics(enabled) {
      if (enabled !== (diagnosticSelection !== null)) {
        diagnosticSelection = enabled ? selected : null;
        updateUsb();
      }
      return dialog.dataset.transport;
    }
    function validReading() {
      const value = snapshot.measurement;
      return connected() && !snapshot.error && value &&
        Number.isSafeInteger(value.frequencyHz) && value.frequencyHz >= 100000 && value.frequencyHz <= 3304999000 &&
        Number.isInteger(value.smeter) && value.smeter >= 0 && value.smeter <= 255 && MODES.includes(value.mode);
    }
    function applySnapshot(value) {
      const wasConnected = connected();
      snapshot = value;
      if (!connected() || snapshot.error) lastReading = null;
      else if (validReading()) lastReading = snapshot.measurement;
      // An auto-reconnect passes through "connecting"; only a real disconnect drops the selected animal.
      if (target && (snapshot.state === "idle" || (validReading() && !matchesFrequency(target.hz, snapshot.measurement.frequencyHz)))) target = null;
      render();
      if (connected() && !wasConnected) renderAudioSpectrum();
      syncAudio();
      options.onChange();
    }
    function renderAnimalStates() {
      for (const { card, item, slots } of animalCards) {
        card.dataset.selected = String(target?.code === item.code);
        for (const { button, frequency, check } of slots) {
          const chosen = target?.code === item.code && target.hz === frequency.hz;
          button.disabled = busy || loadingCatalog || !connected() || testing();
          button.setAttribute("aria-pressed", String(chosen));
          check.textContent = chosen ? "✓" : "";
        }
      }
    }
    function renderAnimals() {
      const favoritesOnly = options.favorites.only();
      const query = node("search").value.trim().toLowerCase();
      const filtered = animals.filter(item => item.code.toLowerCase().includes(query) &&
        (!favoritesOnly || options.favorites.has(item.code)));
      node("animal-count").textContent = loadingCatalog ? "" :
        `${favoritesOnly ? query ? "즐겨찾기 검색" : "즐겨찾기" : query ? "검색 결과" : "전체"} ${filtered.length}개체`;
      node("favorites-filter").setAttribute("aria-pressed", String(favoritesOnly));
      node("favorites-filter").textContent = favoritesOnly ? "★ 즐겨찾기" : "☆ 즐겨찾기";
      const key = JSON.stringify([animals, query, loadingCatalog, favoritesOnly, options.favorites.revision()]);
      if (key === animalKey) { renderAnimalStates(); return; }
      animalKey = key;
      const list = node("animals");
      const oldScroll = list.scrollLeft || 0;
      list.replaceChildren();
      animalCards = [];
      filtered.forEach(item => {
        const card = document.createElement("div");
        card.className = "sdr-animal-option";
        card.dataset.selected = String(target?.code === item.code);
        card.setAttribute("role", "group");
        card.setAttribute("aria-label", item.code);
        const title = document.createElement("strong");
        title.textContent = item.code;
        const slots = document.createElement("div");
        slots.className = "sdr-animal-slots";
        const slotControls = [];
        for (const frequency of item.frequencies) {
          const button = document.createElement("button");
          button.type = "button";
          const label = document.createElement("span"), value = document.createElement("span"), check = document.createElement("span");
          label.className = "sdr-slot-label";
          value.className = "sdr-slot-frequency";
          check.className = "sdr-slot-check";
          label.textContent = frequency.slot;
          value.textContent = formatHz(frequency.hz);
          check.textContent = target?.code === item.code && target.hz === frequency.hz ? "✓" : "";
          button.append(label, value, check);
          button.disabled = busy || loadingCatalog || !connected() || testing();
          button.setAttribute("aria-pressed", String(target?.code === item.code && target.hz === frequency.hz));
          button.setAttribute("aria-label", `${item.code} ${frequency.slot} · ${formatHz(frequency.hz)} MHz`);
          button.title = `${formatHz(frequency.hz)} MHz`;
          button.addEventListener("click", () => run(async () => {
            target = null;
            applySnapshot(await plugin.setFrequency({ frequencyHz: frequency.hz }));
            if (!validReading() || snapshot.measurement.frequencyHz !== frequency.hz) throw new Error("수신기의 적용 주파수가 다릅니다. 지역 제한과 수신기 설정을 확인하세요.");
            target = { code: item.code, hz: frequency.hz };
            draftFrequency = false;
            frequencyControls.setEditing(false);
            node("search").blur?.();
            render();
            options.onTuned?.();
            revealSignal(node("signal"));
          }, true));
          slotControls.push({ button, frequency, check });
          slots.appendChild(button);
        }
        if (!item.frequencies.length) {
          const empty = document.createElement("span");
          empty.textContent = "주파수 미등록";
          slots.appendChild(empty);
        }
        const favorite = document.createElement("button");
        favorite.type = "button";
        favorite.className = "sdr-animal-favorite";
        const isFavorite = options.favorites.has(item.code);
        favorite.textContent = isFavorite ? "★" : "☆";
        favorite.setAttribute("aria-label", `${item.code} 즐겨찾기 ${isFavorite ? "해제" : "추가"}`);
        favorite.setAttribute("aria-pressed", String(isFavorite));
        favorite.addEventListener("click", () => {
          if (!options.favorites.toggle(item.code)) {
            localError = "기기에 즐겨찾기를 저장하지 못했습니다.";
            node("error").textContent = localError;
          }
          renderAnimals();
        });
        card.append(title, slots, favorite);
        animalCards.push({ card, item, slots: slotControls });
        list.appendChild(card);
      });
      if (!list.children.length && !loadingCatalog) {
        const empty = document.createElement("p");
        empty.className = "sdr-note";
        empty.textContent = favoritesOnly && !query ? "즐겨찾기한 개체가 없습니다." : animals.length ? "검색 결과가 없습니다." : "개체 목록 없음";
        list.appendChild(empty);
      }
      list.scrollLeft = oldScroll;
      renderAnimalStates();
    }
    function render() {
      updateUsb();
      renderAudio();
      renderVolume();
      panel.dataset.updating = String(updating);
      node("fields").setAttribute("aria-busy", String(updating));
      node("status").textContent = snapshot.state === "connecting" ? snapshot.connectionProgress || "IC-R30 연결 및 CI-V 응답 확인 중…"
        : connected() ? `${snapshot.deviceName || "IC-R30"} · Bluetooth 연결됨` : "Bluetooth 연결 대기";
      node("error").textContent = localError || snapshot.error || "";
      node("connection").dataset.connected = String(connected());
      node("heading").hidden = connected();
      node("status").hidden = connected();
      node("connected").hidden = !connected();
      node("connected-name").textContent = snapshot.deviceName || "IC-R30";
      node("status").dataset.state = snapshot.state;
      node("refresh").disabled = locked() || !native;
      node("settings").disabled = locked() || !native;
      node("pairing").hidden = node("refresh").hidden = node("settings").hidden = connected();
      node("disconnect").hidden = !connected() && snapshot.state !== "connecting";
      node("disconnect").disabled = disconnecting;
      node("devices").hidden = busy || connected() || snapshot.state === "connecting";
      node("other-devices").hidden = node("devices").hidden || !node("other-device-list").children.length;
      node("service-help").hidden = connected();
      node("controls").hidden = node("signal").hidden = !connected();
      node("fields").disabled = node("mode-fields").disabled = busy || !connected() || testing();
      node("catalog-refresh").disabled = busy || loadingCatalog;
      node("clear").disabled = busy || !target || testing();
      node("catalog-notice").textContent = catalogNotice;
      const liveReading = validReading() ? snapshot.measurement : null;
      const reading = liveReading || (updating ? lastReading : null);
      if (liveReading && !draftFrequency) node("frequency").value = formatHz(liveReading.frequencyHz);
      const tunedHz = frequencyControls.previewHz();
      const matchingCodes = root.BearSdrFrequency.matchingAnimalCodes(animals, tunedHz);
      node("frequency-animal").textContent = matchingCodes.join(", ");
      node("frequency-animal").hidden = !matchingCodes.length;
      node("frequency-animal").setAttribute("aria-label", matchingCodes.length ? `등록 주파수 ±900 Hz 범위 개체 ${matchingCodes.join(", ")}` : "");
      if (reading && !draftMode) node("mode").value = reading.mode;
      node("readout").textContent = reading ? `${formatHz(reading.frequencyHz)} MHz · ${reading.mode}` : "수신 주파수 —";
      node("strength").textContent = reading ? `${reading.smeter} / 255${updating ? " · 마지막 측정" : ""}` : "측정 대기";
      node("meter").setAttribute("aria-valuenow", reading ? String(reading.smeter) : "0");
      node("meter").setAttribute("aria-valuetext", reading ? `${reading.smeter} / 255 · ${updating ? "설정 중 · 마지막 측정" : "원시값"}` : "측정 대기");
      node("meter").dataset.state = updating ? "updating" : reading ? "live" : "stopped";
      const filledBars = (reading?.smeter ?? 0) * meterBars.length / 255;
      meterBars.forEach((bar, index) => {
        const fill = Math.max(0, Math.min(1, filledBars - index));
        bar.style.setProperty("--sdr-meter-fill", `${fill * 100}%`);
      });
      const canRegister = !busy && !testing() && !draftFrequency && !draftMode && !frequencyControls.editing() && !localError &&
        liveReading;
      const measurementStatus = node("measurement-status");
      measurementStatus.textContent = updating ? "수신기 설정 적용 중…"
        : reading ? "" : "측정값 대기";
      measurementStatus.hidden = !measurementStatus.textContent;
      const reason = updating ? "설정 적용 중 · 확인 후 등록할 수 있습니다."
        : testing() ? "로그 기록 종료 후 등록할 수 있습니다."
        : draftFrequency || frequencyControls.editing() ? "주파수 직접 입력을 완료하고 적용값을 확인하세요."
        : !reading || localError ? "수신기 측정값과 오류를 확인하세요." : "관측점 등록 가능";
      node("target").textContent = target ? `${target.code} · ${formatHz(reading?.frequencyHz || target.hz)} MHz${reading ? ` · ${reading.mode}` : ""} · ${reason}` : reason;
      node("register").disabled = !canRegister;
      node("view").disabled = !canRegister;
      frequencyControls.render();
      renderTest();
      renderAnimals();
    }

    function renderVolume() {
      const volume = connected() ? snapshot.volume : null;
      node("volume-settings").hidden = !volume;
      if (!volume) { requestedVolume = null; volumeError = ""; return; }
      const level = requestedVolume ?? volume.current;
      node("volume").textContent = level >= 0 ? String(level) : "—";
      const disabled = (busy && requestedVolume === null) || testing();
      node("volume-down").disabled = disabled || level === 0;
      node("volume-up").disabled = disabled || level === 39;
      const message = requestedVolume === null ? volumeError || volume.notice || "" : "";
      const status = node("volume-status");
      status.hidden = !message;
      if (status.textContent !== message) status.textContent = message;
    }

    function adjustVolume(step) {
      const volume = snapshot.volume;
      if (!connected() || !volume || testing() || (busy && requestedVolume === null)) return;
      const pending = requestedVolume !== null;
      const level = requestedVolume ?? (volume.current >= 0 ? volume.current : volume.default);
      const next = Math.max(0, Math.min(39, level + step));
      if (next === level) return;
      requestedVolume = next;
      volumeError = "";
      renderVolume();
      if (pending) return;
      const deviceId = snapshot.deviceId;
      return run(async () => {
        try {
          while (requestedVolume !== null && connected() && snapshot.deviceId === deviceId) {
            const sent = requestedVolume;
            const result = await plugin.setVolume({ level: sent });
            if (result.volume?.current !== sent || result.volume?.notice || requestedVolume === sent) requestedVolume = null;
            applySnapshot(result);
          }
        } catch (error) {
          volumeError = error.message || String(error);
        }
      }).finally(() => { requestedVolume = null; renderVolume(); });
    }
    function renderTestStart() {
      const audioReady = audioState.state === "active";
      node("test-start").disabled = busy || snapshot.test?.preparing || !validReading() || testing() ||
        !audioReady || draftFrequency || frequencyControls.editing();
      node("test-audio-permission").hidden = !connected() || audioState.state !== "permission";
      const status = node("test-audio-status");
      status.hidden = !connected() || audioReady || testing();
      status.textContent = status.hidden ? "" : audioState.message || "수신음 기록에는 USB 오디오 입력이 필요합니다.";
    }
    function renderTest() {
      const test = snapshot.test || {};
      const records = test.records || [];
      logs.render(records, {
        locked: busy || testing(),
        canSave: typeof plugin?.saveTest === "function",
        canShare: typeof plugin?.shareTest === "function",
        canDelete: typeof plugin?.deleteTest === "function",
        canPreview: typeof plugin?.getTestAudio === "function",
        error: test.error && `로그 목록 조회 실패: ${test.error}`
      });
      renderTestStart();
      node("test-stop").disabled = busy || !testing();
      const ending = { manual: "수동 종료", time_limit: "10초 기록 완료", disconnected: "연결 종료" }[test.reason] || "기록 대기";
      node("test-summary").textContent = testing() || test.reason || test.count
        ? `${testing() ? "기록 중" : ending} · 최근 기록 ${Math.floor((test.durationMs || 0) / 1000)}초 · ${test.count || 0}개 · 값 변경 ${test.changes || 0}회 · 실제 평균 간격 ${test.meanIntervalMs || 0}ms / 최대 ${test.maxIntervalMs || 0}ms`
        : ending;
      if(test.preparing)node("test-summary").textContent="수신기 설정 확인 중 · 완료 후 10초 기록을 시작합니다.";
      else if (test.audioNotice) node("test-summary").textContent += ` · ${test.audioNotice}`;
      renderTestTrace();
    }
    function renderTestTrace() {
      const saved = snapshot.test?.audioTrace || {};
      const live = audioState.diagnosticTrace;
      const useLive = testing() && live?.id && live.id === saved.id && live.recordedElapsedMs >= saved.recordedElapsedMs;
      renderDiagnosticAudio(useLive ? live : saved, testing());
    }
    async function init() {
      if (!native) throw new Error("Bluetooth 수신기 연결은 Android 앱에서 사용할 수 있습니다.");
      if (!plugin) {
        plugin = root.Capacitor.Plugins?.IcR30 || root.Capacitor.registerPlugin?.("IcR30");
        if (!plugin || ["getStatus", "listDevices", "connect", "disconnect", "setFrequency", "setMode", "addListener", "startTest", "stopTest", "shareTest", "deleteTest"].some(name => typeof plugin[name] !== "function")) {
          plugin = null;
          throw new Error("IC-R30 네이티브 플러그인이 없습니다. 최신 APK를 설치하세요.");
        }
      }
      if (!listener) listener = await plugin.addListener("receiverStateChanged", applySnapshot);
    }
    function audioRunning() { return audioState.state === "active" || audioState.state === "starting"; }
    function renderAudio() {
      const active = audioState.state === "active";
      node("audio-permission").hidden = audioState.state !== "permission";
      node("audio-playback").hidden = !active || typeof plugin?.setUsbAudioPlayback !== "function";
      const mute = node("audio-mute");
      const playing = audioState.speakerEnabled === true;
      const label = playing ? "음소거" : "소리 켜기";
      if (mute.textContent !== label) mute.textContent = label;
      mute.setAttribute("aria-pressed", String(!playing));
      mute.disabled = node("audio-filter").disabled = playbackPending;
      if (!playbackPending) node("audio-filter").value = String(audioState.filterLevel ?? 0);
      const notice = node("audio-speaker-notice");
      const speakerNotice = audioState.speakerNotice || "";
      if (notice.textContent !== speakerNotice) notice.textContent = speakerNotice;
      notice.hidden = !active || !speakerNotice;
      const status = node("audio-status");
      const message = active ? "입력 중 · " + audioState.message + (playing ? ` · ${audioState.playbackOutput || "소리 재생"}` : "")
        : audioState.message || "USB 오디오 연결 대기 중";
      if (status.textContent !== message) status.textContent = message;
      node("audio-level").hidden = node("audio-tone").hidden = !active;
    }
    function renderAudioSpectrum() {
      const plot = root.SdrSpectrumPlot;
      if (!plot) return;
      const { state, spectrumDbfs, spectrumCenterHz, spectrumSpanHz, tracked, toneHz } = audioState;
      const canvas = node("audio-spectrum");
      const data = plot.describe(spectrumDbfs, spectrumCenterHz, spectrumSpanHz, { audio: true });
      const candidate = tracked && Number.isFinite(toneHz) ? toneHz : null;
      plot.draw(canvas, data, spectrumCenterHz, spectrumSpanHz, state, null, candidate, { audio: true });
      let summary = "USB 오디오가 연결되면 주파수별 피크가 표시됩니다.";
      if (data) summary = data.peakDbfs > -120
        ? "최대 피크 " + Math.round(data.peakHz) + " Hz · " + data.peakDbfs.toFixed(1) + " dBFS/bin"
        : "입력 신호 없음";
      else if (audioRunning()) summary = "오디오 분석 준비 중…";
      if (candidate !== null) summary += " · CW 후보 " + candidate + " Hz";
      node("audio-peak").textContent = summary;
      canvas.setAttribute("aria-label", summary);
    }
    function showAudio(value) {
      const changed = value.state !== audioState.state || value.message !== audioState.message;
      audioState = value;
      renderAudio();
      if (value.diagnosticTrace && testing()) renderTestTrace();
      if (changed) renderTestStart();
      renderAudioSpectrum();
      const active = value.state === "active";
      const spectrum = Array.isArray(value.spectrumDbfs) ? value.spectrumDbfs : [];
      // Digital zero shows as -Infinity bins, which also counts as silent.
      silentFrames = active && spectrum.length && Math.max(...spectrum) < SILENT_DBFS ? silentFrames + 1 : 0;
      node("audio-silent").hidden = silentFrames < SILENT_FRAMES;
      if (!active) return;
      const peak = value.peakSample;
      node("audio-level").textContent = peak ? "입력 피크 " + (20 * Math.log10(peak / 32768)).toFixed(1) + " dBFS" : "입력 신호 없음";
      const tone = node("audio-tone");
      let detection = "CW 후보 대기 · 감지 " + value.count + "회";
      if (!value.ready) detection = "CW 배경 잡음 측정 중…";
      else if (value.tracked) {
        const label = value.confidence >= 2 ? "반복 CW 후보" : "CW 후보";
        detection = label + " · " + value.toneHz + " Hz · SNR " + value.snrDb.toFixed(1) + " dB · " + value.count + "회";
      }
      if (tone.textContent !== detection) tone.textContent = detection;
    }
    async function pollAudio(session, requestPermission = false) {
      try {
        const value = await plugin.getUsbAudioStatus({ requestPermission });
        if (audioSession !== session) return;
        showAudio(value);
        options.onAudioFrame?.(value);
      } catch (error) {
        if (audioSession === session) {
          showAudio({ state: "error", message: error.message || String(error) });
          options.onAudioFrame?.(audioState);
        }
      }
      if (audioSession === session) audioTimer = root.setTimeout(() => pollAudio(session), audioRunning() ? 125 : 750);
    }
    function stopAudio() {
      if (!audioWatching) return;
      audioWatching = false;
      ++audioSession;
      root.clearTimeout(audioTimer);
      audioTimer = undefined;
      showAudio({ state: "idle" });
    }
    function syncAudio() {
      if (!dialog.open || !selected || !connected()) { stopAudio(); return; }
      if (audioWatching || typeof plugin?.getUsbAudioStatus !== "function") return;
      audioWatching = true;
      void pollAudio(++audioSession);
    }
    async function setAudioPlayback(settings) {
      if (audioState.state !== "active" || playbackPending) return;
      const session = audioSession;
      playbackPending = true;
      renderAudio();
      try {
        const value = await plugin.setUsbAudioPlayback(settings);
        if (session === audioSession) showAudio(value);
      } catch (error) {
        if (session === audioSession) showAudio({ ...audioState, speakerNotice: error.message || String(error) });
      } finally {
        playbackPending = false;
        renderAudio();
      }
    }
    async function run(action, setting = false) {
      if (busy) return;
      busy = true;
      updating = setting;
      localError = "";
      render();
      try { await init(); await action(); }
      catch (error) { localError = error.message || String(error); }
      finally { busy = false; updating = false; render(); options.onChange(); }
    }
    function renderDevices(devices) {
      const key = JSON.stringify(devices);
      if (deviceKey === key) return;
      deviceKey = key;
      node("devices").replaceChildren();
      node("other-device-list").replaceChildren();
      const isCandidate = device => device.sppSupported === true;
      if (!devices.some(isCandidate)) {
        const empty = document.createElement("p");
        empty.className = "sdr-note";
        empty.textContent = devices.length
          ? "SPP 서비스가 확인된 기기가 없습니다. ‘다른 페어링 기기 보기’에서 수신기를 확인하세요."
          : "페어링된 기기가 없습니다. Android Bluetooth 설정에서 IC-R30을 페어링하세요.";
        node("devices").appendChild(empty);
      }
      devices.forEach(device => {
        const card = document.createElement("div");
        card.className = "sdr-device";
        const name = document.createElement("strong"), detail = document.createElement("small");
        name.textContent = device.name;
        const service = isCandidate(device) ? "SPP 지원 확인" : device.serviceInfoAvailable === true ? "SPP 미확인" : "서비스 정보 없음";
        const classes = { 0: "기타", 256: "컴퓨터", 512: "전화", 768: "네트워크", 1024: "오디오·영상", 1280: "주변기기", 1536: "이미징", 1792: "웨어러블", 2048: "장난감", 2304: "건강기기", 7936: "미분류" };
        const deviceClass = classes[device.majorDeviceClass] || "분류 정보 없음";
        detail.textContent = `${service} · ${deviceClass} · ${device.deviceId}`;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sdr-primary";
        button.textContent = "연결";
        button.addEventListener("click", () => run(async () => {
          if (options.usbLocked()) throw new Error("USB 수신기 연결을 먼저 해제하세요.");
          applySnapshot(await plugin.connect({ deviceId: device.deviceId }));
          draftFrequency = draftMode = false;
        }));
        card.append(name, detail, button);
        node(isCandidate(device) ? "devices" : "other-device-list").appendChild(card);
      });
      node("other-devices-title").textContent = `다른 페어링 기기 보기 · ${node("other-device-list").children.length}개`;
    }
    async function refreshDevices() {
      const result = await plugin.listDevices();
      applySnapshot(result);
      renderDevices(result.devices || []);
    }
    async function loadAnimals() {
      if (loadingCatalog) return;
      loadingCatalog = true; render();
      try {
        const result = await root.BearSdrAnimals.load();
        animals = result.items;
        catalogNotice = result.notice;
        if (target && !animals.some(item => item.code === target.code && item.frequencies.some(f => f.hz === target.hz))) target = null;
      } catch (error) { catalogNotice = `개체 목록 조회 실패: ${error.message || String(error)}`; }
      finally { loadingCatalog = false; render(); }
    }
    function select(bluetooth) {
      if (diagnosticSelection !== null) {
        if (diagnosticSelection === bluetooth) return;
        diagnosticSelection = bluetooth;
        updateUsb();
        options.onChange();
        if (bluetooth) refreshBluetoothView(false);
        return;
      }
      if (bluetooth ? options.usbLocked() : locked()) return;
      selected = bluetooth;
      updateUsb();
      options.onChange();
      if (bluetooth) refreshBluetoothView();
    }
    function refreshBluetoothView(loadReceiverControls = true) {
      void run(async () => {
        applySnapshot(await plugin.getStatus());
        if (loadReceiverControls) renderAudioSpectrum();
      });
      if (loadReceiverControls && !animals.length) void loadAnimals();
    }
    btButton.addEventListener("click", () => select(true));
    usbButton.addEventListener("click", () => select(false));
    function requestAudioPermission() {
      if (!audioWatching || audioState.state !== "permission") return;
      root.clearTimeout(audioTimer);
      showAudio({ state: "starting", message: "Android 마이크 권한 확인 중…" });
      return pollAudio(++audioSession, true);
    }
    node("audio-permission").addEventListener("click", requestAudioPermission);
    node("test-audio-permission").addEventListener("click", requestAudioPermission);
    node("audio-mute").addEventListener("click", () => setAudioPlayback({ muted: audioState.speakerEnabled === true }));
    node("audio-filter").addEventListener("change", () => setAudioPlayback({ filterLevel: Number(node("audio-filter").value) }));
    node("volume-down").addEventListener("click", () => adjustVolume(-1));
    node("volume-up").addEventListener("click", () => adjustVolume(1));
    dialog.addEventListener("close", () => { if (!dialog.open) stopAudio(); });
    root.addEventListener?.("resize", () => {
      if (dialog.open && selected && connected()) renderAudioSpectrum();
    });
    node("refresh").addEventListener("click", () => run(refreshDevices));
    node("settings").addEventListener("click", () => run(() => plugin.openSettings()));
    async function disconnect() {
      if (!plugin || disconnecting) return;
      disconnecting = true;
      node("disconnect").disabled = true;
      options.onChange();
      try {
        const value = await plugin.disconnect();
        localError = "";
        applySnapshot(value);
      }
      catch (error) { localError = error.message || String(error); }
      finally { disconnecting = false; render(); options.onChange(); }
    }
    node("disconnect").addEventListener("click", disconnect);
    node("search").addEventListener("input", renderAnimals);
    node("favorites-filter").addEventListener("click", () => { node("animals").scrollLeft = 0; options.favorites.toggleFilter(); renderAnimals(); });
    node("search-form").addEventListener("submit", event => { event.preventDefault(); node("search").blur?.(); });
    node("clear").addEventListener("click", () => { target = null; render(); });
    node("catalog-refresh").addEventListener("click", loadAnimals);
    for (const [button, method] of [["test-start", "startTest"], ["test-stop", "stopTest"]]) {
      node(button).addEventListener("click", () => run(async () => { applySnapshot(await plugin[method]()); }));
    }
    node("mode").addEventListener("change", () => { draftMode = true; });
    async function tune(hz) {
      if (!Number.isSafeInteger(hz) || hz < 100000 || hz > 3304999000) throw new Error("주파수는 0.1–3304.999 MHz 범위여야 합니다.");
      applySnapshot(await plugin.setFrequency({ frequencyHz: hz }));
      if (!validReading() || snapshot.measurement.frequencyHz !== hz) throw new Error("수신기의 적용 주파수가 다릅니다. 지역 제한과 수신기 설정을 확인하세요.");
      draftFrequency = false;
    }
    node("apply-mode").addEventListener("click", () => run(async () => {
      applySnapshot(await plugin.setMode({ mode: node("mode").value }));
      draftMode = false;
    }, true));
    node("view").addEventListener("click", () => options.onTuned?.());
    node("register").addEventListener("click", () => run(async () => {
      applySnapshot(await plugin.getStatus());
      if (!validReading() || draftFrequency || draftMode || testing() || frequencyControls.editing()) throw new Error("수신기의 적용 주파수와 현재 수신을 확인하세요.");
      if (typeof root.BearSdrRegistration?.open !== "function") throw new Error("관측점 등록 화면을 준비하지 못했습니다.");
      const context = { bearCode: target?.code || "", frequencyHz: snapshot.measurement.frequencyHz, receiver: "IC-R30", mode: snapshot.measurement.mode };
      const back = () => { if (!dialog.open) dialog.showModal(); render(); syncAudio(); };
      dialog.close();
      try {
        if (root.BearSdrRegistration.open(context, back) === false) throw new Error("관측점 저장 또는 수정을 완료한 뒤 다시 시도해주세요.");
      } catch (error) { back(); throw error; }
    }));
    render();
    return {
      updateUsb,
      showDiagnostics,
      refreshFavorites: renderAnimals,
      canMonitor: () => validReading() || !!lastReading,
      audioActive: () => audioState.state === "active",
      resetAudioPreview: logs.resetPreview,
      cancelFrequencyEditing() {
        if (!frequencyControls.editing()) return false;
        frequencyControls.cancel();
        draftFrequency = false; render();
        return true;
      },
      selected: () => selected,
      busy: () => busy,
      disconnect,
      disconnecting: () => disconnecting,
      status: () => snapshot,
      onOpen() {
        if (selected) refreshBluetoothView();
      },
      async exit() {
        if (plugin) applySnapshot(await plugin.disconnect());
      }
    };
  }
  root.BearIcR30 = { mount };
})(window);
