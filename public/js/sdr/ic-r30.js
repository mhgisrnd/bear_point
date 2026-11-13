(function (root) {
  "use strict";
  const MODES = ["LSB", "USB", "AM", "AM-N", "CW", "FM", "FM-N", "WFM", "CW-R", "P25", "D-STAR", "dPMR", "NXDN-VN", "NXDN-N", "DCR"];
  const formatHz = hz => root.BearSdrAnimals.formatHz(hz);
  function mount(dialog, options) {
    const selector = dialog.querySelector("[data-receiver-selector]");
    selector.innerHTML = `<button type="button" data-receiver-usb aria-pressed="true"><strong>USB</strong><span>RTL-SDR · 청취 · 탐색</span></button><button type="button" data-receiver-bt aria-pressed="false"><strong>Bluetooth</strong><span>IC-R30 · 제어 · S-Meter</span></button>`;
    const panel = dialog.querySelector("[data-bluetooth]");
    const footer = dialog.querySelector("[data-bt-footer]");
    footer.innerHTML = `<p data-bt-target class="sdr-footer-context" role="status"></p><button type="button" data-bt-register class="sdr-primary sdr-register-observation" disabled>수신 확인 · 관측점 등록</button>`;
    panel.innerHTML = `
      <p data-bt-error class="sdr-message" role="alert"></p>
      <section data-bt-connection class="sdr-connection" data-connected="false" aria-label="Bluetooth 수신기">
      <div class="sdr-connection-heading"><h3 data-bt-heading class="sdr-stage-heading"><span class="sdr-step" aria-hidden="true">1</span> 수신기 연결</h3><div class="sdr-connection-tools"><button type="button" data-bt-refresh>기기 새로고침</button><button type="button" data-bt-disconnect class="sdr-quiet" hidden>연결 해제</button></div></div>
      <p data-bt-status class="sdr-connection-status" role="status">Bluetooth 연결 대기</p>
      <div data-bt-connected class="sdr-connection-current" hidden><div class="sdr-device sdr-device-connected"><strong data-bt-connected-name></strong><span class="sdr-connected-badge">연결됨</span></div></div>
      <div data-bt-devices class="sdr-device-list"><p>페어링된 기기를 확인하려면 기기 새로고침을 누르세요.</p></div>
      <details data-bt-other-devices class="sdr-help" hidden><summary data-bt-other-devices-title>다른 페어링 기기 보기</summary><p>Android에 저장된 서비스 정보에서 SPP가 확인되지 않았거나 정보가 없는 기기입니다. 수신기가 기본 목록에 없다면 여기서 확인하세요.</p><div data-bt-other-device-list class="sdr-device-list"></div></details>
      <p data-bt-service-help class="sdr-note">기본 목록은 SPP 직렬 통신 서비스가 확인된 기기입니다. SPP 지원만으로 수신기 호환이 보장되지는 않습니다. 현재 제어는 IC-R30용입니다.</p>
      <details data-bt-pairing class="sdr-help"><summary>처음 연결하는 경우</summary><p>Android 설정에서 IC-R30을 먼저 페어링하세요. Serialport Function = CI-V (Echo Back OFF), CI-V 주소 9C를 사용합니다.</p><button type="button" data-bt-settings class="sdr-quiet">Android Bluetooth 설정 열기</button></details>
      </section>
      <section data-bt-controls hidden>
        <div class="sdr-section">
        <h3 class="sdr-stage-heading"><span class="sdr-step" aria-hidden="true">2</span> 개체 · 주파수 설정</h3>
        <div class="sdr-animal-picker">
        <div class="sdr-animal-heading"><strong>찾을 개체</strong><button type="button" data-bt-clear disabled>선택 해제</button><button type="button" data-bt-catalog-refresh>목록 새로고침</button></div>
        <form data-bt-search-form role="search"><input type="search" data-bt-search aria-label="IC-R30 개체 번호 검색" placeholder="개체 번호 검색" autocomplete="off" enterkeyhint="search"></form>
        <p data-bt-catalog-notice class="sdr-note" role="status"></p><div class="sdr-animal-list-tools"><p data-bt-animal-count class="sdr-note" role="status"></p><button type="button" data-bt-favorites-filter aria-pressed="false">☆ 즐겨찾기</button></div><div data-bt-animals class="sdr-animal-list" aria-label="IC-R30 개체 검색 결과"></div>
        </div>
        <fieldset data-bt-fields class="sdr-settings">
          <div class="sdr-frequency-field">
            <div class="sdr-frequency-heading"><div><strong>수신 주파수</strong><span>MHz · 0.1–3304.999</span><span data-bt-frequency-animal class="sdr-frequency-animal" aria-live="polite" hidden></span></div><button type="button" data-bt-frequency-edit aria-expanded="false">직접 입력</button></div>
            <div data-bt-frequency-digits class="sdr-frequency-digits sdr-frequency-four" role="group" aria-label="주파수 자릿수 조정">${root.BearSdrFrequency.markup("bt-", 4)}</div>
            <label data-bt-frequency-entry hidden>직접 입력<input data-bt-frequency type="number" min="0.1" max="3304.999" step="0.00001" inputmode="decimal" aria-label="IC-R30 수신 주파수 MHz"></label>
          </div>
          <details data-bt-advanced-settings class="sdr-advanced"><summary>상세 설정<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary>
          <div class="sdr-bt-mode"><label for="sdr-bt-mode">수신 모드</label><select id="sdr-bt-mode" data-bt-mode aria-label="IC-R30 수신 모드">${MODES.map(mode => `<option>${mode}</option>`).join("")}</select><button type="button" data-bt-apply-mode class="sdr-secondary">적용</button></div>
          <p class="sdr-note">USB의 Gain·PPM은 RTL-SDR 전용 설정이며 감지 기준은 I/Q 분석용입니다. IC-R30의 RF GAIN·ATT는 수신기에서 조정하세요. 현재 앱에서는 해당 제어를 제공하지 않습니다.</p>
          </details>
        </fieldset>
        </div>
        <div class="sdr-section" data-bt-signal>
        <h3 class="sdr-stage-heading"><span class="sdr-step" aria-hidden="true">3</span> 신호 확인</h3>
        <p data-bt-measurement-status class="sdr-note" role="status"></p>
        <p data-bt-readout class="sdr-frequency-readout" aria-live="polite">수신 주파수 —</p>
        <div class="sdr-strength"><div class="sdr-strength-heading"><strong>수신 신호 세기 · S-Meter</strong><span data-bt-strength>측정 대기</span></div>
          <div data-bt-meter class="sdr-strength-bars" role="meter" aria-label="IC-R30 S-Meter 원시값" aria-valuemin="0" aria-valuemax="255">${Array.from({ length: 10 }, (_, i) => `<span data-bt-bar="${i}" style="height:${8 + i * 3}px"></span>`).join("")}</div>
          <p class="sdr-note">0–255 원시값 · dBm, S1–S9 또는 USB 신호 세기와 직접 비교할 수 없습니다.</p>
        </div>
        <p class="sdr-note">소리는 IC-R30에서 직접 확인하세요. Bluetooth는 오디오·I/Q를 전달하지 않습니다.</p>
        </div>
      </section>
      <details class="sdr-reception-diagnostic sdr-bt-test" aria-label="Bluetooth 수신 진단 로그">
        <summary>수신 진단 · 저장된 로그</summary>
        <div class="sdr-log-actions"><button type="button" data-bt-test-start class="sdr-primary">10초 기록</button><button type="button" data-bt-test-share disabled>파일 공유</button><button type="button" data-bt-test-delete class="sdr-danger" disabled>선택 삭제</button></div>
        <div class="sdr-log-actions" data-bt-recording-tools hidden><button type="button" data-bt-test-mark disabled>삡 들림 표시</button><button type="button" data-bt-test-stop class="sdr-quiet" disabled>기록 종료</button></div>
        <p class="sdr-note">시작 설정을 확인한 뒤 S-Meter를 10초간 기록합니다. ZIP에 원본 CSV, 기록 시각·수신기 설정·통신 오류를 함께 담습니다. 저장된 로그는 연결 없이 공유·삭제할 수 있습니다. 오디오·I/Q나 자동 신호 판정은 포함하지 않습니다.</p>
        <select data-bt-test-record aria-label="저장된 Bluetooth 수신 진단 기록" hidden></select>
        <p data-bt-test-summary class="sdr-note" role="status">기록 대기</p>
        <svg class="sdr-bt-test-chart" viewBox="0 0 300 90" role="img" aria-label="최근 100개 S-Meter 측정값. 세로축은 원시값 변화에 맞춰 자동 확대됩니다."><polyline data-bt-test-line fill="none" stroke="currentColor" stroke-width="1.5"></polyline></svg>
        <p data-bt-test-range class="sdr-note"></p>
        <p class="sdr-note">R30에서 희미한 삡이 들릴 때 표시 버튼을 누르세요. 표시는 사람의 반응 지연이 포함된 참고 시점입니다. 수신기에서도 주파수·모드를 바꾸지 마세요. 홈 화면·화면 잠금 중에도 네이티브 기록을 계속하지만 앱 강제 종료는 보장하지 않습니다.</p>
      </details>
      <details class="sdr-help"><summary>연결 유지 · 지원 기능 안내</summary><p>SPP에는 오디오·I/Q가 없어 앱 청취, 스펙트럼, 자동 CW 검출, 대역 탐색은 지원하지 않습니다. 홈 화면·다른 앱·화면 잠금에서도 알림을 표시하며 연결을 유지합니다. 앱이나 알림의 연결 해제로 종료하세요.</p></details>`;
    const node = key => (key === "target" || key === "register" ? footer : panel).querySelector(`[data-bt-${key}]`);
    const usbButton = selector.querySelector("[data-receiver-usb]");
    const btButton = selector.querySelector("[data-receiver-bt]");
    let selected = false, plugin = null, listener = null, busy = false, loadingCatalog = false;
    let snapshot = { state: "idle", measurement: null, error: "" };
    let animals = [], target = null, deviceKey = "", animalKey = "", catalogNotice = "";
    let draftFrequency = false, draftMode = false, localError = "", recordsKey = "";
    let updating = false, lastReading = null, animalCards = [];
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
      onCancel: () => { if (validReading()) node("frequency").value = formatHz(snapshot.measurement.frequencyHz); },
      onError: text => { localError = text; node("error").textContent = text; }
    });
    const native = root.Capacitor?.getPlatform?.() === "android";
    function connected() { return snapshot.state === "connected"; }
    function testing() { return snapshot.test?.active === true; }
    function locked() { return busy || snapshot.state === "connecting" || connected(); }
    function updateUsb() {
      btButton.disabled = options.usbLocked();
      usbButton.disabled = locked();
      usbButton.setAttribute("aria-pressed", String(!selected));
      btButton.setAttribute("aria-pressed", String(selected));
      footer.hidden = !selected || !connected();
    }
    function validReading() {
      const value = snapshot.measurement;
      return connected() && !snapshot.error && value &&
        Number.isSafeInteger(value.frequencyHz) && value.frequencyHz >= 100000 && value.frequencyHz <= 3304999000 &&
        Number.isInteger(value.smeter) && value.smeter >= 0 && value.smeter <= 255 && MODES.includes(value.mode);
    }
    function applySnapshot(value) {
      snapshot = value;
      if (!connected() || snapshot.error) lastReading = null;
      else if (validReading()) lastReading = snapshot.measurement;
      if (target && (!connected() || (validReading() && !matchesFrequency(target.hz, snapshot.measurement.frequencyHz)))) target = null;
      render();
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
            node("signal").scrollIntoView?.({ block: "start" });
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
      panel.dataset.updating = String(updating);
      node("fields").setAttribute("aria-busy", String(updating));
      node("status").textContent = snapshot.state === "connecting" ? "IC-R30 연결 및 CI-V 응답 확인 중…"
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
      node("disconnect").disabled = false;
      node("devices").hidden = busy || connected() || snapshot.state === "connecting";
      node("other-devices").hidden = node("devices").hidden || !node("other-device-list").children.length;
      node("service-help").hidden = connected();
      node("controls").hidden = !connected();
      node("fields").disabled = busy || !connected() || testing();
      node("catalog-refresh").disabled = busy || loadingCatalog;
      node("clear").disabled = busy || !target || testing();
      node("catalog-notice").textContent = catalogNotice;
      const liveReading = validReading() ? snapshot.measurement : null;
      const reading = liveReading || (updating ? lastReading : null);
      if (liveReading && !draftFrequency) node("frequency").value = formatHz(liveReading.frequencyHz);
      const tunedHz = node("frequency").value.trim() ? Math.round(Number(node("frequency").value) * 1e6) : NaN;
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
      const bars = reading ? Math.ceil(reading.smeter * 10 / 255) : 0;
      for (let i = 0; i < 10; i++) panel.querySelector(`[data-bt-bar="${i}"]`).classList.toggle("is-active", i < bars);
      const canRegister = !busy && !testing() && !draftFrequency && !draftMode && !frequencyControls.editing() && !localError &&
        liveReading;
      node("measurement-status").textContent = updating ? "수신기 설정 적용 중 · 마지막 측정을 유지하며 새 응답을 기다립니다."
        : reading ? "자동 측정 중 · 연결하면 S-Meter 측정이 바로 시작됩니다. 소리는 IC-R30에서 확인하세요."
        : "측정값 대기 · 수신기 응답을 확인하고 있습니다.";
      const reason = updating ? "설정 적용 중 · 확인 후 등록할 수 있습니다."
        : testing() ? "로그 기록 종료 후 등록할 수 있습니다."
        : draftFrequency || frequencyControls.editing() ? "주파수 직접 입력을 완료하고 적용값을 확인하세요."
        : !reading || localError ? "수신기 측정값과 오류를 확인하세요." : "관측점 등록 가능";
      node("target").textContent = target ? `${target.code} · ${formatHz(reading?.frequencyHz || target.hz)} MHz${reading ? ` · ${reading.mode}` : ""} · ${reason}` : reason;
      node("register").disabled = !canRegister;
      frequencyControls.render();
      renderTest();
      renderAnimals();
    }
    function renderTest() {
      const test = snapshot.test || {};
      const records = test.records || [];
      const key = JSON.stringify(records);
      const select = node("test-record");
      if (key !== recordsKey) {
        const previous = select.value;
        select.replaceChildren();
        for (const record of records) {
          const option = document.createElement("option");
          option.value = record.id;
          option.textContent = `${new Date(record.createdAt).toLocaleString("ko-KR")} · ${(record.bytes / 1024).toFixed(1)} KB · ${record.id === "ic-r30-test.csv" ? "이전 기록 · ZIP 공유" : "S-Meter · ZIP 공유"}`;
          select.appendChild(option);
        }
        select.value = records.some(record => record.id === previous) ? previous : records[0]?.id || "";
        recordsKey = key;
      }
      select.hidden = !records.length;
      select.disabled = busy || testing();
      node("test-start").disabled = busy || test.preparing || !validReading() || testing() || draftFrequency || frequencyControls.editing();
      node("test-stop").disabled = busy || !testing();
      node("recording-tools").hidden = !testing();
      node("test-mark").disabled = busy || !testing();
      node("test-share").disabled = busy || testing() || !records.length;
      node("test-delete").disabled = busy || testing() || !records.length;
      const ending = { manual: "수동 종료", time_limit: "10초 기록 완료", disconnected: "연결 종료" }[test.reason] || "기록 대기";
      node("test-summary").textContent = test.error ? `로그 목록 조회 실패: ${test.error}` : `저장 ${records.length}개 · ${testing() ? "기록 중" : ending} · 최근 기록 ${Math.floor((test.durationMs || 0) / 1000)}초 · ${test.count || 0}개 · 값 변경 ${test.changes || 0}회 · 청취 표시 ${test.marks || 0}회 · 실제 평균 간격 ${test.meanIntervalMs || 0}ms / 최대 ${test.maxIntervalMs || 0}ms`;
      if (!test.error && !testing() && !test.reason && !test.count) {
        node("test-summary").textContent = records.length ? `저장된 기록 ${records.length}개 · 선택한 기록을 공유·삭제할 수 있습니다.` : "저장된 기록 없음 · 수신기를 연결한 뒤 기록하세요.";
      }
      if(test.preparing)node("test-summary").textContent="수신기 설정 확인 중 · 완료 후 10초 기록을 시작합니다.";
      const points = test.recent || [];
      if (!points.length) {
        node("test-line").setAttribute("points", "");
        node("test-range").textContent = "측정값 대기 · 그래프 자동 확대는 신호 검출을 의미하지 않습니다.";
        return;
      }
      const low = Math.min(...points.map(point => point[1])), high = Math.max(...points.map(point => point[1]));
      const span = Math.max(1, points.at(-1)[0] - points[0][0]);
      node("test-line").setAttribute("points", points.map(point =>
        `${(point[0] - points[0][0]) * 300 / span},${high === low ? 45 : 85 - (point[1] - low) * 80 / (high - low)}`).join(" "));
      node("test-range").textContent = `최근 그래프 범위 ${low}–${high} / 255 (자동 확대) · 전체 최소 ${test.min} / 최대 ${test.max}`;
    }
    async function init() {
      if (!native) throw new Error("Bluetooth 수신기 연결은 Android 앱에서 사용할 수 있습니다.");
      if (!plugin) {
        plugin = root.Capacitor.Plugins?.IcR30 || root.Capacitor.registerPlugin?.("IcR30");
        if (!plugin || ["getStatus", "listDevices", "connect", "disconnect", "setFrequency", "setMode", "addListener", "startTest", "stopTest", "markTest", "shareTest", "deleteTest"].some(name => typeof plugin[name] !== "function")) {
          plugin = null;
          throw new Error("IC-R30 네이티브 플러그인이 없습니다. 최신 APK를 설치하세요.");
        }
      }
      if (!listener) listener = await plugin.addListener("receiverStateChanged", applySnapshot);
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
      if (bluetooth ? options.usbLocked() : locked()) return;
      selected = bluetooth;
      dialog.dataset.transport = bluetooth ? "bluetooth" : "usb";
      panel.hidden = !bluetooth;
      updateUsb();
      options.onChange();
      if (bluetooth) {
        void run(async () => { applySnapshot(await plugin.getStatus()); });
        if (!animals.length) void loadAnimals();
      }
    }
    btButton.addEventListener("click", () => select(true));
    usbButton.addEventListener("click", () => select(false));
    node("refresh").addEventListener("click", () => run(refreshDevices));
    node("settings").addEventListener("click", () => run(() => plugin.openSettings()));
    node("disconnect").addEventListener("click", async () => {
      if (!plugin) return;
      try { applySnapshot(await plugin.disconnect()); localError = ""; }
      catch (error) { localError = error.message || String(error); }
      render();
    });
    node("search").addEventListener("input", renderAnimals);
    node("favorites-filter").addEventListener("click", () => { node("animals").scrollLeft = 0; options.favorites.toggleFilter(); renderAnimals(); });
    node("search-form").addEventListener("submit", event => { event.preventDefault(); node("search").blur?.(); });
    node("clear").addEventListener("click", () => { target = null; render(); });
    node("catalog-refresh").addEventListener("click", loadAnimals);
    for (const [button, method] of [["test-start", "startTest"], ["test-stop", "stopTest"], ["test-mark", "markTest"]]) {
      node(button).addEventListener("click", () => run(async () => { applySnapshot(await plugin[method]()); }));
    }
    node("test-share").addEventListener("click", () => run(() => plugin.shareTest({ id: node("test-record").value })));
    node("test-delete").addEventListener("click", () => {
      const id = node("test-record").value;
      if (!id || !root.confirm("선택한 Bluetooth 로그를 삭제할까요? 삭제한 기록은 복구할 수 없습니다.")) return;
      return run(async () => { applySnapshot(await plugin.deleteTest({ id })); });
    });
    node("frequency").addEventListener("input", () => { draftFrequency = true; render(); });
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
    node("register").addEventListener("click", () => run(async () => {
      applySnapshot(await plugin.getStatus());
      if (!validReading() || draftFrequency || draftMode || testing() || frequencyControls.editing()) throw new Error("수신기의 적용 주파수와 현재 수신을 확인하세요.");
      if (typeof root.BearSdrRegistration?.open !== "function") throw new Error("관측점 등록 화면을 준비하지 못했습니다.");
      const context = { bearCode: target?.code || "", frequencyHz: snapshot.measurement.frequencyHz, receiver: "IC-R30", mode: snapshot.measurement.mode };
      const back = () => { if (!dialog.open) dialog.showModal(); render(); };
      dialog.close();
      try {
        if (root.BearSdrRegistration.open(context, back) === false) throw new Error("관측점 저장 또는 수정을 완료한 뒤 다시 시도해주세요.");
      } catch (error) { back(); throw error; }
    }));
    render();
    return {
      updateUsb,
      refreshFavorites: renderAnimals,
      cancelFrequencyEditing() {
        if (!frequencyControls.editing()) return false;
        frequencyControls.cancel();
        draftFrequency = false; render();
        return true;
      },
      selected: () => selected,
      busy: () => busy,
      status: () => snapshot,
      onOpen() {
        if (selected) void run(async () => { applySnapshot(await plugin.getStatus()); });
      },
      async exit() {
        if (plugin) applySnapshot(await plugin.disconnect());
      }
    };
  }
  root.BearIcR30 = { mount };
})(window);
