(function () {
  "use strict";
  const trigger = document.getElementById("btn-sdr-diagnostics");
  if (!trigger) return;
  const dialog = document.createElement("dialog");
  dialog.className = "sdr-dialog";
  dialog.setAttribute("aria-labelledby", "sdr-title");
  dialog.innerHTML = `
    <div class="sdr-header"><h2 id="sdr-title">수신기 <span class="sdr-cw-label">CW</span></h2><button type="button" data-back hidden aria-label="탐색 재개">‹ 탐색</button><button type="button" data-close aria-label="탐색 닫기">×</button></div>
    <div class="sdr-body">
    <p class="sdr-status" role="status">연결 상태 확인 전</p>
    <p class="sdr-message" role="alert"></p>
    <section data-usb-section class="sdr-usb-section" data-connected="false" aria-label="USB 수신기"><h3 data-usb-heading>USB 수신기</h3><div data-devices></div><div class="sdr-usb-tools"><button type="button" data-refresh>새로고침</button><button type="button" data-disconnect hidden>연결 해제</button></div></section>
    <section data-settings-section class="sdr-section" hidden>
        <div class="sdr-operation" role="group" aria-label="수신 방식"><button type="button" data-task-scan aria-pressed="false">대역 탐색</button><button type="button" data-task-fixed aria-pressed="true">개별 탐색</button></div>
        <div data-animal-picker class="sdr-animal-picker">
          <div class="sdr-animal-heading"><strong>찾을 개체</strong><button type="button" data-animal-clear disabled>선택 해제</button><button type="button" data-animal-refresh>목록 새로고침</button></div>
          <div data-animal-results>
          <form data-animal-search-form role="search"><input type="search" data-animal-search aria-label="개체 번호 검색" placeholder="개체 번호 검색" autocomplete="off" enterkeyhint="search"></form>
          <p data-animal-notice class="sdr-note" role="status"></p><div class="sdr-animal-list-tools"><p data-animal-count class="sdr-note" role="status"></p><button type="button" data-animal-favorites-filter aria-pressed="false">☆ 즐겨찾기</button></div><div data-animal-list class="sdr-animal-list" aria-label="개체 검색 결과"></div></div>
        </div>
      <fieldset data-settings class="sdr-settings" disabled>
        <div class="sdr-fields">
        <div class="sdr-wide sdr-scan-fields" data-scan-fields hidden><label>시작 주파수 <span>MHz</span><input data-scan-start type="number" min="0.1" max="999.999" step="0.001" value="148.000" inputmode="decimal"></label><label>끝 주파수 <span>MHz</span><input data-scan-end type="number" min="0.1" max="999.999" step="0.001" value="174.000" inputmode="decimal"></label></div>
        <div class="sdr-wide sdr-frequency-field" data-frequency-field>
          <div class="sdr-frequency-heading"><div><strong>수신 주파수</strong><span data-frequency-range>MHz</span><span data-frequency-animal class="sdr-frequency-animal" aria-live="polite" hidden></span></div><button type="button" data-frequency-edit aria-expanded="false">직접 입력</button></div>
          <div data-frequency-digits class="sdr-frequency-digits" role="group" aria-label="주파수 자릿수 조정">${[100000000, 10000000, 1000000, 100000, 10000, 1000, 100, 10].map((step, index) => `${index === 3 ? '<span class="sdr-frequency-dot" aria-hidden="true">.</span>' : ''}<div class="sdr-digit"><button type="button" data-freq-up="${step}" aria-label="${step / 1e6} MHz 올리기">▲</button><strong data-freq-digit="${index}" aria-hidden="true">—</strong><button type="button" data-freq-down="${step}" aria-label="${step / 1e6} MHz 내리기">▼</button></div>`).join('')}</div>
          <label data-frequency-entry hidden>직접 입력<input data-frequency type="number" min="0.1" max="999.99999" step="0.00001" value="150.000" inputmode="decimal" aria-label="수신 주파수 MHz"></label>
        </div>
        </div>

        <details class="sdr-advanced" data-advanced-settings><summary>상세 설정<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary>
        <div class="sdr-fields sdr-tuning-options">
        <label>감도 <span>Gain dB</span><input data-gain type="number" min="-10" max="50" step="0.1" value="50" inputmode="decimal"><small data-gain-info>기본 최대 요청 · 튜너 지원값으로 적용</small></label>
        <label>주파수 보정 <span>PPM</span><input data-ppm type="number" min="-100" max="100" step="1" value="0" inputmode="numeric"></label>
        <label data-threshold-field hidden>감지 기준 <span>주변 잡음 대비 dB</span><input data-threshold type="number" min="6" max="30" step="1" value="10" inputmode="numeric"></label>
        </div></details><input data-rate type="hidden" value="1024000"><input data-dwell type="hidden" value="5000"><p data-window class="sdr-note" hidden></p>
      </fieldset>
    </section>
    <section data-result class="sdr-section" hidden>
      <p data-animal-target class="sdr-animal-target" hidden></p>
      <div data-scan-results hidden><p data-scan-progress class="sdr-scan-progress">탐색 대기</p><div class="sdr-candidate-heading"><strong data-candidate-heading>신호 후보</strong><span data-candidate-count>0개</span></div><div data-candidates></div></div>
      <div data-fixed-results>
      <div class="sdr-readout-row"><p class="sdr-frequency-readout" data-frequency-readout aria-live="polite">수신 주파수 —</p><div data-audio-panel><button type="button" data-audio disabled aria-pressed="false">소리 켜기</button></div></div><label class="sdr-listening-level">청취 증폭<select data-audio-gain aria-label="CW 청취 증폭"><option value="-1">자동</option><option value="0">원음</option><option value="6">2배</option><option value="12">4배</option><option value="18">8배</option><option value="24">16배</option><option value="30">32배</option><option value="36">64배</option></select></label><p data-audio-status class="sdr-note" hidden></p>
      <div class="sdr-signal-panels">
      <div class="sdr-strength"><div class="sdr-strength-heading"><strong>수신 신호 세기</strong><span data-strength-value>측정 대기</span></div><div class="sdr-strength-bars" data-strength-bars role="meter" aria-label="청취 주파수 상대 신호 세기" aria-valuemin="0" aria-valuemax="10" aria-valuenow="0">${Array.from({ length: 10 }, (_, i) => `<span data-strength-bar="${i}" style="height:${8 + i * 3}px"></span>`).join("")}</div><p class="sdr-note" data-strength-state>청취 주파수 주변의 상대 신호 세기</p>
      <div class="sdr-metrics"><div><span>수신 데이터</span><strong data-throughput>—</strong></div><div><span>대역 전력</span><strong data-power>—</strong></div></div>
      </div>
      <figure class="sdr-spectrum"><figcaption><strong>스펙트럼</strong></figcaption>
        <canvas data-spectrum role="img" aria-label="수신 시작 후 주파수별 전력 그래프가 표시됩니다."></canvas>
        <p data-spectrum-summary class="sdr-note">수신 대기</p>
      </figure>
      </div>
      <p data-spectrum-info class="sdr-note" hidden></p>
      </div>
    </section>
    <section data-diagnostic-section class="sdr-section" hidden>
      <details class="sdr-reception-diagnostic"><summary>수신 진단</summary><div><button type="button" data-diagnostic-start>10초 기록</button><button type="button" data-diagnostic-share disabled>파일 공유</button><button type="button" data-diagnostic-delete disabled>선택 삭제</button></div><select data-diagnostic-record aria-label="저장된 수신 진단 기록" hidden></select><p data-diagnostic-status class="sdr-note">원본 I/Q와 청취 소리를 기기에만 기록합니다.</p></details>
    </section>

    </div>
    <div class="sdr-footer" hidden>
      <button type="button" class="sdr-primary sdr-register-observation" data-register-observation hidden>비프 확인 · 관측점 등록</button>
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
  const settingsSection = dialog.querySelector("[data-settings-section]");
  const footer = dialog.querySelector(".sdr-footer");
  const resultSection = dialog.querySelector("[data-result]");
  // Numeric bridge limits; the connected tuner determines actual RF coverage.
  const frequencyBounds = { min: .1, max: 999.99999 };
  const sampleRates = [250000, 1024000, 1536000, 2048000, 2400000];
  let plugin = null;
  let busy = false;
  let current = null;
  let listener = null;
  let listenerPromise = null;
  let sequence = 0;
  let connectionAttempt = 0;
  let task = "fixed", lastScan = null, restoredFixed = false, candidateSelected = false;
  let handledReceiverUiRequest = 0;
  let animalItems = [], selectedAnimal = null, selectedAnimalHz = null, catalogLoading = false, catalogLoaded = false;
  let animalCatalogRevision = 0, animalListRenderKey = "";
  const animalSearch = dialog.querySelector("[data-animal-search]");
  let animalSearchFocused = false;
  const animalList = dialog.querySelector("[data-animal-list]");
  const animalNotice = dialog.querySelector("[data-animal-notice]");
  const favoriteStorageKey = "bearpoint.sdrAnimalFavorites.v1";
  const favoriteCode = code => String(code).trim().toUpperCase();
  let favoriteCodes = new Set();
  let favoritesOnly = false, favoritesRevision = 0;
  try {
    const saved = JSON.parse(window.localStorage?.getItem(favoriteStorageKey) || "[]");
    if (Array.isArray(saved)) favoriteCodes = new Set(saved.filter(code => typeof code === "string" && code.trim()).map(favoriteCode));
  } catch (_) { /* A damaged or unavailable store must not prevent reception. */ }
  const favoritesFilter = dialog.querySelector("[data-animal-favorites-filter]");
  favoritesFilter.addEventListener("click", () => {
    favoritesOnly = !favoritesOnly; animalList.scrollLeft = 0; renderAnimalPicker();
  });
  function toggleFavorite(code) {
    const next = new Set(favoriteCodes), key = favoriteCode(code);
    if (next.has(key)) next.delete(key); else next.add(key);
    try {
      if (!window.localStorage) throw new Error("Storage unavailable");
      window.localStorage.setItem(favoriteStorageKey, JSON.stringify([...next].sort()));
      favoriteCodes = next; favoritesRevision++;
      finishAnimalSearch(); renderAnimalPicker();
    } catch (_) { message.textContent = "기기에 즐겨찾기를 저장하지 못했습니다."; }
  }
  const registerObservationButton = dialog.querySelector("[data-register-observation]");
  function animalFormat(hz) { return window.BearSdrAnimals?.formatHz(hz) || (hz / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.(\d{0,2})$/, (_, digits) => "." + digits.padEnd(3, "0")); }
  function animalMatchesFrequency() {
    return !!(selectedAnimal && selectedAnimalHz === Math.round(Number(frequency.value) * 1e6));
  }
  function animalPickerLocked() {
    return busy || current?.state !== "connected" || task !== "fixed" ||
      ["starting", "stopping", "scanning"].includes(current?.receptionState);
  }
  async function chooseAnimalFrequency(item, hz) {
    if (animalPickerLocked()) return;
    const live = current?.receptionState === "receiving";
    const receivedHz = current?.reception?.listenFrequencyHz || current?.reception?.frequencyHz;
    selectedAnimal = item; selectedAnimalHz = hz;
    finishAnimalSearch();
    frequency.value = String(hz / 1e6); setFrequencyEditing(false); updateWindow();
    if (!live || receivedHz === hz) return;
    restoredFixed = true;
    await run(async () => {
      const attempt = ++connectionAttempt;
      await plugin.stopReception();
      await refresh();
      if (attempt !== connectionAttempt || !dialog.open || current?.state !== "connected") {
        return;
      }
      await startFixedReception();
    });
  }
  function renderAnimalPicker() {
    // A changed tuning value must not retain the previous registration target.
    if (selectedAnimal && !animalMatchesFrequency()) {
      selectedAnimal = null; selectedAnimalHz = null;
    }
    const tunedHz = frequency.value.trim() ? Math.round(Number(frequency.value) * 1e6) : NaN;
    const matchingCodes = [...new Set(animalItems.filter(item =>
      item.frequencies.some(f => f.hz === tunedHz)).map(item => item.code))];
    const frequencyAnimal = dialog.querySelector("[data-frequency-animal]");
    frequencyAnimal.textContent = matchingCodes.join(", ");
    frequencyAnimal.hidden = task !== "fixed" || !matchingCodes.length;
    frequencyAnimal.setAttribute("aria-label", matchingCodes.length ? `등록 주파수 일치 개체 ${matchingCodes.join(", ")}` : "");
    const locked = animalPickerLocked();
    animalSearch.disabled = locked;
    dialog.querySelector("[data-animal-refresh]").disabled = locked || catalogLoading;
    const query = String(animalSearch.value || "").trim().toLowerCase();
    const filtered = animalItems.filter(item => item.code.toLowerCase().includes(query) &&
      (!favoritesOnly || favoriteCodes.has(favoriteCode(item.code))));
    dialog.querySelector("[data-animal-count]").textContent = catalogLoading ? "" :
      `${favoritesOnly ? query ? "즐겨찾기 검색" : "즐겨찾기" : query ? "검색 결과" : "전체"} ${filtered.length}개체`;
    favoritesFilter.setAttribute("aria-pressed", String(favoritesOnly));
    favoritesFilter.textContent = favoritesOnly ? "★ 즐겨찾기" : "☆ 즐겨찾기";
    const renderKey = JSON.stringify([animalCatalogRevision, query, selectedAnimal?.code, selectedAnimalHz, locked, catalogLoading, favoritesOnly, favoritesRevision]);
    // Preserve scroll position and avoid rebuilding a full catalog on every signal update.
    if (renderKey !== animalListRenderKey) {
      const oldScroll = animalList.scrollLeft || 0;
      animalListRenderKey = renderKey;
      animalList.replaceChildren();
      filtered.forEach(item => {
        const button = document.createElement("div"); button.className = "sdr-animal-option";
        const code = document.createElement("strong"), detail = document.createElement("span");
        code.textContent = item.code;
        detail.textContent = item.frequencies.length ? "" : "주파수 미등록";
        detail.hidden = !!item.frequencies.length;
        button.append(code, detail);
        button.dataset.selected = String(selectedAnimal?.id === item.id && selectedAnimal?.code === item.code);
        button.setAttribute("role", "group"); button.setAttribute("aria-label", item.code);
        button.disabled = locked || !item.frequencies.length;
        button.dataset.unavailable = String(!item.frequencies.length);
        const slots = document.createElement("div"); slots.className = "sdr-animal-slots";
        item.frequencies.forEach(f => {
          const slot = document.createElement("button"); slot.type = "button";
          const label = document.createElement("span"), value = document.createElement("span"), check = document.createElement("span");
          label.className = "sdr-slot-label"; label.textContent = f.slot;
          value.className = "sdr-slot-frequency"; value.textContent = animalFormat(f.hz);
          check.className = "sdr-slot-check"; check.textContent = "✓"; check.setAttribute("aria-hidden", "true");
          slot.append(label, value, check);
          slot.setAttribute("aria-label", `${item.code} ${f.slot} · ${animalFormat(f.hz)} MHz`);
          slot.title = `${animalFormat(f.hz)} MHz`;
          slot.setAttribute("aria-pressed", String(selectedAnimal?.code === item.code && selectedAnimalHz === f.hz));
          slot.disabled = locked;
          slot.addEventListener("click", () => chooseAnimalFrequency(item, f.hz));
          slots.appendChild(slot);
        });
        button.appendChild(slots);
        const favorite = document.createElement("button"); favorite.type = "button";
        const isFavorite = favoriteCodes.has(favoriteCode(item.code));
        favorite.className = "sdr-animal-favorite";
        favorite.setAttribute("data-animal-favorite", item.code);
        favorite.setAttribute("aria-label", `${item.code} 즐겨찾기 ${isFavorite ? "해제" : "추가"}`);
        favorite.setAttribute("aria-pressed", String(isFavorite));
        favorite.textContent = isFavorite ? "★" : "☆";
        favorite.addEventListener("click", () => toggleFavorite(item.code));
        button.appendChild(favorite);
        animalList.appendChild(button);
      });
      if (!filtered.length && !catalogLoading) {
        const empty = document.createElement("p"); empty.className = "sdr-note";
        empty.textContent = favoritesOnly && !query ? "즐겨찾기한 개체가 없습니다." : animalItems.length ? "검색 결과가 없습니다." : "개체 목록 없음"; animalList.appendChild(empty);
      }
      animalList.scrollLeft = oldScroll;
    }
    const selected = animalMatchesFrequency();
    dialog.querySelector("[data-animal-results]").hidden = false;
    dialog.querySelector("[data-animal-refresh]").hidden = false;
    dialog.querySelector("[data-animal-clear]").disabled = locked || !selectedAnimal;
    dialog.querySelector("[data-frequency-field]").hidden = task === "scan";
    dialog.querySelector("[data-animal-picker]").hidden = task !== "fixed";
    const rf = current?.reception || {};
    const receivedHz = rf.listenFrequencyHz || rf.frequencyHz;
    const canRegister = task === "fixed" && selected && current?.state === "connected" && current?.fixedResultAvailable &&
      rf.hasSamples && receivedHz === selectedAnimalHz && ["receiving", "idle"].includes(current?.receptionState);
    registerObservationButton.hidden = !canRegister;
    registerObservationButton.disabled = busy || !canRegister;
    const target = dialog.querySelector("[data-animal-target]");
    target.hidden = task !== "fixed" || !selected || receivedHz !== selectedAnimalHz;
    target.textContent = selected ? `찾는 개체 ${selectedAnimal.code} · ${animalFormat(selectedAnimalHz)} MHz` : "";
  }
  async function loadAnimals() {
    if (catalogLoading || !window.BearSdrAnimals) return;
    catalogLoading = true; animalNotice.textContent = "개체 목록 불러오는 중…";
    dialog.querySelector("[data-animal-refresh]").disabled = true;
    try {
      const result = await window.BearSdrAnimals.load(); animalItems = result.items; catalogLoaded = true; animalCatalogRevision++;
      animalNotice.textContent = result.notice;
      // A refreshed frequency must never retune a running receiver implicitly.
      if (selectedAnimal && !animalItems.some(a => a.code === selectedAnimal.code && a.frequencies.some(f => f.hz === selectedAnimalHz))) {
        selectedAnimal = null; selectedAnimalHz = null;
      }
    } catch (_) { animalNotice.textContent = "개체 목록을 불러오지 못했습니다. 다시 시도해주세요."; }
    finally { catalogLoading = false; dialog.querySelector("[data-animal-refresh]").disabled = false; renderAnimalPicker(); }
  }
  animalSearch.addEventListener("input", () => { animalList.scrollLeft = 0; renderAnimalPicker(); });
  function finishAnimalSearch() {
    animalSearchFocused = false;
    animalSearch.blur?.();
    updateDialogViewport();
  }
  function keepAnimalSearchVisible() {
    if (animalSearchFocused && dialog.open) animalSearch.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }
  animalSearch.addEventListener("focus", () => {
    animalSearchFocused = true; updateDialogViewport(); keepAnimalSearchVisible();
  });
  animalSearch.addEventListener("blur", event => {
    // Keep the clicked card in place until its click handler consumes the selection.
    if (event.relatedTarget?.closest?.(".sdr-animal-option")) return;
    animalSearchFocused = false; updateDialogViewport();
  });
  animalSearch.addEventListener("keydown", event => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault(); finishAnimalSearch();
  });
  dialog.querySelector("[data-animal-search-form]").addEventListener("submit", event => {
    event.preventDefault(); finishAnimalSearch();
  });
  dialog.querySelector("[data-animal-refresh]").addEventListener("click", () => { if (!animalPickerLocked()) void loadAnimals(); });
  dialog.querySelector("[data-animal-clear]").addEventListener("click", () => {
    if (animalPickerLocked()) return;
    selectedAnimal = null; selectedAnimalHz = null;
    frequency.value = animalFormat(Math.round(Number(frequency.value) * 1e6)); updateWindow();
  });
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
    const label = `탐색${state ? ` · ${labels[state]}${cycle}` : ""}`;
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
      handleReceiverUiRequest(snapshot);
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
    if (!enabled) {
      digitControls.forEach(({ digit }) => digit.blur?.());
      frequency.blur?.();
    }
    frequencyEditor.hidden = true;
    frequencyDigits.hidden = false;
    frequencyEditButton.textContent = enabled ? "완료" : "직접 입력";
    frequencyEditButton.setAttribute("aria-expanded", String(enabled));
    updateWindow();
  }
  function completeFrequencyEditing() {
    if (settings.disabled) return false;
    const bounds = frequencyBounds, value = Number(frequency.value);
    if (!frequency.value.trim() || !Number.isFinite(value) || value < bounds.min || value > bounds.max) {
      message.textContent = `${bounds.min}–${bounds.max} MHz 범위를 확인하세요.`;
      digitControls[0].digit.focus?.();
      return false;
    }
    frequency.value = animalFormat(Math.round(value * 1e6));
    message.textContent = "";
    setFrequencyEditing(false);
    return true;
  }
  const digitControls = [100000000, 10000000, 1000000, 100000, 10000, 1000, 100, 10].map((step, index) => {
    const up = dialog.querySelector(`[data-freq-up="${step}"]`);
    const down = dialog.querySelector(`[data-freq-down="${step}"]`);
    const digit = dialog.querySelector(`[data-freq-digit="${index}"]`);
    const adjust = direction => {
      if (settings.disabled) return;
      const bounds = frequencyBounds, value = Number(frequency.value);
      if (!frequency.value.trim() || !Number.isFinite(value) || value < bounds.min || value > bounds.max) return;
      const hz = Math.round(value * 1e6) + direction * step;
      if (hz < bounds.min * 1e6 || hz > bounds.max * 1e6) return;
      frequency.value = animalFormat(hz);
      updateWindow();
    };
    up.addEventListener("click", () => adjust(1));
    down.addEventListener("click", () => adjust(-1));
    digit.setAttribute("inputmode", "numeric");
    digit.setAttribute("enterkeyhint", "done");
    digit.setAttribute("role", "textbox");
    digit.setAttribute("aria-label", `${index + 1}번째 주파수 숫자`);
    digit.setAttribute("aria-hidden", "false");
    digit.addEventListener("focus", () => {
      if (!editingFrequency || settings.disabled || !window.getSelection || !document.createRange) return;
      const range = document.createRange(); range.selectNodeContents(digit);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    });
    digit.addEventListener("input", (event = {}) => {
      if (event.isComposing) return;
      if (!editingFrequency || settings.disabled) { updateFrequencyDigits(); return; }
      const typed = String(digit.textContent).replace(/\D/g, "").slice(-1);
      if (!typed) { updateFrequencyDigits(); return; }
      const digits = Number(frequency.value).toFixed(5).padStart(9, "0").replace(".", "").split("");
      digits[index] = typed;
      frequency.value = animalFormat(Math.round(Number(`${digits.slice(0, 3).join("")}.${digits.slice(3).join("")}`) * 1e6));
      updateWindow();
      if (index === digitControls.length - 1) completeFrequencyEditing();
      else digitControls[index + 1].digit.focus?.();
    });
    digit.addEventListener("beforeinput", event => {
      if (!editingFrequency || event.isComposing) return;
      if (["insertParagraph", "insertLineBreak"].includes(event.inputType)) {
        event.preventDefault(); completeFrequencyEditing();
      }
    });
    digit.addEventListener("keydown", event => {
      if (!editingFrequency || settings.disabled || event.isComposing) return;
      if (event.key === "Enter" || event.keyCode === 13 || (event.key === "Tab" && !event.shiftKey && index === digitControls.length - 1)) {
        event.preventDefault(); completeFrequencyEditing();
      }
      if (event.key === "Escape") { event.preventDefault(); frequency.value = frequencyBeforeEditing;  setFrequencyEditing(false); }
    });
    return { step, up, down, digit };
  });

  function updateFrequencyDigits() {
    const bounds = frequencyBounds, value = Number(frequency.value);
    const valid = !!frequency.value.trim() && Number.isFinite(value) && value >= bounds.min && value <= bounds.max;
    const hz = Math.round(value * 1e6);
    const digits = frequency.value.trim() && Number.isFinite(value) && value >= 0 && value < 1000
      ? value.toFixed(5).padStart(9, "0").replace(".", "") : "--------";
    digitControls.forEach(({ step, up, down, digit }, index) => {
      digit.textContent = digits[index];
      digit.setAttribute("contenteditable", String(editingFrequency && !settings.disabled));
      digit.setAttribute("tabindex", editingFrequency && !settings.disabled ? "0" : "-1");
      up.disabled = settings.disabled || !valid || hz + step > bounds.max * 1e6;
      down.disabled = settings.disabled || !valid || hz - step < bounds.min * 1e6;
    });
    frequencyDigits.setAttribute("aria-label", valid ? `수신 주파수 ${animalFormat(hz)} MHz` : "주파수 직접 입력 필요");
    frequencyEditButton.disabled = settings.disabled;
  }

  frequencyEditButton.addEventListener("click", () => {
    if (settings.disabled) return;
    if (editingFrequency) { completeFrequencyEditing(); return; }
    frequencyBeforeEditing = frequency.value;
    setFrequencyEditing(true);
    digitControls[0].digit.focus?.();
  });
  frequency.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); if (editingFrequency) frequencyEditButton.click(); }
  });

  function renderSpectrum(snapshot) {
    const plot = window.SdrSpectrumPlot;
    if (!plot) return;
    const rf = snapshot && snapshot.reception || {};
    const narrow = Number.isFinite(rf.spectrumCenterHz) && rf.spectrumSpanHz === 6000;
    const centerHz = narrow ? rf.spectrumCenterHz : Number.isFinite(rf.frequencyHz) ? rf.frequencyHz : Number(frequency.value) * 1e6;
    const rateHz = narrow ? rf.spectrumSpanHz : Number.isFinite(rf.sampleRate) ? rf.sampleRate : Number(rate.value);
    const data = plot.describe(rf.spectrumDbfs, centerHz, rateHz, { narrow });
    const state = snapshot && snapshot.receptionState;
    const listenHz = narrow ? rf.spectrumCenterHz : state === "receiving" && ["wfm", "cw"].includes(rf.mode) ? rf.listenFrequencyHz : null;
    const candidateHz = rf.cwCandidateTracked && Number.isFinite(rf.cwCandidateHz) ? rf.cwCandidateHz : null;
    plot.draw(spectrumCanvas, data, centerHz, rateHz, state, listenHz, candidateHz);
    if (!data) {
      spectrumSummary.textContent = state === "receiving" ? "스펙트럼 대기 중" : "수신 대기";
      dialog.querySelector("[data-spectrum-info]").textContent = "";
      spectrumCanvas.setAttribute("aria-label", spectrumSummary.textContent);
      return;
    }
    const prefix = state === "receiving" ? "수신 중" : state === "error" ? "수신 오류 · 마지막 측정" : "정지됨 · 마지막 측정";
    spectrumSummary.textContent = `${prefix} · ${narrow ? "대상 주변 최대" : "최대"} ${(data.peakHz / 1e6).toFixed(narrow ? 5 : 3)} MHz · ${data.peakDbfs.toFixed(1)} dBFS/bin`;
    if (Number.isFinite(candidateHz)) spectrumSummary.textContent = `${prefix} · CW 후보 ${(candidateHz / 1e6).toFixed(5)} MHz`;
    dialog.querySelector("[data-spectrum-info]").textContent = `${(data.startHz / 1e6).toFixed(narrow ? 5 : 3)}–${(data.endHz / 1e6).toFixed(narrow ? 5 : 3)} MHz · FFT ${data.binWidthHz.toFixed(0)} Hz${rf.spectrumPeakHold ? " · 순간 피크 유지" : ""}`;
    spectrumCanvas.setAttribute("aria-label", spectrumSummary.textContent);
  }

  function updateWindow() {
    updateRunButtons();
    updateFrequencyDigits();
    renderAnimalPicker();
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
    gain.value = "50";
    lastScan = null;
    restoredFixed = false;
    candidateSelected = false;
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
    settingsSection.hidden = !connected || (running && task !== "fixed");
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
      const restoredHz = rf.listenFrequencyHz || rf.frequencyHz;
      frequency.value = selectedAnimalHz === restoredHz ? String(restoredHz / 1e6) : animalFormat(restoredHz);
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
    // Current APKs supply the channel meter's curve and short peak hold. Keep legacy snapshots readable.
    const strengthLevel = strengthValid ? cwStrength
      ? Number.isInteger(rf.signalLevel) ? Math.max(0, Math.min(10, rf.signalLevel))
        : noiseReady ? Math.max(0, Math.min(10, Math.ceil((rf.signalExcessDb - 6) / 3))) : 0
      : Math.max(0, Math.min(10, Math.ceil((rf.signalDbfs + 90) / 8))) : 0;
    const peakHeld = cwStrength && !!rf.signalLevelHeld && snapshot.receptionState === "receiving";
    const strengthBars = dialog.querySelector("[data-strength-bars]");
    strengthBars.setAttribute("aria-valuenow", String(strengthLevel));
    strengthBars.setAttribute("aria-valuetext", strengthValid ? cwStrength && noiseReady
      ? `${strengthLevel}/10 · ${peakHeld ? "최근 피크 유지" : `잡음 대비 ${rf.signalExcessDb.toFixed(1)} dB`}`
      : cwStrength ? "잡음 수준 측정 중" : `${strengthLevel}/10 · ${rf.signalDbfs.toFixed(1)} dBFS` : "측정 대기");
    strengthBars.dataset.state = snapshot.receptionState === "receiving" ? "live" : "stopped";
    for (let i = 0; i < 10; i++) dialog.querySelector(`[data-strength-bar="${i}"]`).classList.toggle("is-active", i < strengthLevel);
    dialog.querySelector("[data-strength-value]").textContent = strengthValid ? `${rf.signalDbfs.toFixed(1)} dBFS` : "—";
    dialog.querySelector("[data-strength-state]").textContent = strengthValid
      ? snapshot.receptionState === "receiving" ? rf.clippingPercent > 1 ? "입력 포화 · Gain을 낮춰 확인하세요."
        : cwStrength ? noiseReady
          ? `${peakHeld ? "최근 피크 유지" : strengthLevel ? "신호 상승" : "잡음 수준"} · 잡음 대비 +${rf.signalExcessDb.toFixed(1)} dB · 배경 ${rf.noiseDbfs.toFixed(1)} dBFS`
          : "배경 잡음 측정 중…" : "청취 주파수 주변 · 상대 신호 세기"
        : "수신 정지 · 마지막 측정값"
      : rf.mode === "iq" ? "CW 또는 WFM에서 신호 세기를 측정합니다." : "신호 세기 측정 대기";
    if (cwStrength && rf.cwDetectorRevision) {
      const measured = Number.isFinite(rf.cwDirectionDbfs) && rf.cwPulseCount > 0 &&
        (rf.cwCandidateTracked || snapshot.receptionState !== "receiving");
      const level = rf.hasSamples && Number.isInteger(rf.cwDirectionLevel) ? Math.max(0, Math.min(10, rf.cwDirectionLevel)) : 0;
      const live = snapshot.receptionState === "receiving";
      strengthBars.setAttribute("aria-valuenow", String(level));
      strengthBars.setAttribute("aria-label", "CW 후보의 상대 신호 전력");
      strengthBars.setAttribute("aria-valuetext", `${level}/10 · CW 후보 전력 · IC-R30 보정값 아님`);
      for (let i = 0; i < 10; i++) dialog.querySelector(`[data-strength-bar="${i}"]`).classList.toggle("is-active", i < level);
      dialog.querySelector("[data-strength-value]").textContent = measured ? `${rf.cwDirectionDbfs.toFixed(1)} dBFS` : "—";
      dialog.querySelector("[data-strength-state]").textContent = !live ? "수신 정지 · 마지막 CW 측정값"
        : rf.clippingPercent > 1 ? "입력 포화 · Gain을 낮춰 확인하세요."
        : !rf.cwDetectorReady ? "CW 배경 잡음 측정 중…"
        : rf.cwCandidateTracked ? `${rf.cwPulseRecent ? rf.cwConfidence >= 2 ? "반복 CW 후보" : "CW 후보" : "최근 CW 후보"} · SNR ${Number.isFinite(rf.cwSnrDb) ? rf.cwSnrDb.toFixed(1) : "—"} dB`
        : "CW 후보 탐색 중";
    }
    const receivedHz = rf.listenFrequencyHz || rf.frequencyHz;
    const receptionLabel = snapshot.receptionState === "receiving" ? "수신 중" :
      snapshot.receptionState === "stopping" ? "정지 중" : snapshot.receptionState === "error" ? "수신 오류" : "정지됨";
    dialog.querySelector("[data-frequency-readout]").textContent = Number.isFinite(receivedHz) && receivedHz > 0
      ? `${animalFormat(receivedHz)} MHz · ${(rf.mode || "iq").toUpperCase()} · ${receptionLabel}`
      : snapshot.receptionState === "starting" ? "수신 주파수 · 초기화 중…" : "수신 주파수 —";
    dialog.querySelector("[data-throughput]").textContent = rf.totalBytes != null ? `${(rf.bytesPerSecond / 1e6).toFixed(2)} MB/s` : "—";
    dialog.querySelector("[data-power]").textContent = rf.hasSamples ? `${rf.powerDbfs.toFixed(1)} dBFS` : "—";
    if (receiving) status.textContent = rfNames[snapshot.receptionState];
    else if (task === "scan" && snapshot.scanResumeAvailable) status.textContent = "탐색 일시정지";
    if (["scanning", "receiving"].includes(snapshot.receptionState)) status.dataset.activity = snapshot.receptionState;
    else delete status.dataset.activity;
    const audio = snapshot.audio || {};
    const diagnostic = snapshot.diagnostic || {};
    const capturing = ["waiting", "recording", "packaging"].includes(diagnostic.state);
    const records = Array.isArray(diagnostic.records) ? diagnostic.records : [];
    const recordSelect = dialog.querySelector("[data-diagnostic-record]");
    const recordKeys = records.map(record => record.id).join(",");
    if (recordSelect.dataset.keys !== recordKeys) {
      const previous = recordSelect.value;recordSelect.replaceChildren();
      for (const record of records) {
        const option = document.createElement("option");option.value = record.id;
        option.textContent = `${new Date(record.time).toLocaleString("ko-KR")} · ${(record.sizeBytes / 1e6).toFixed(1)} MB`;
        recordSelect.append(option);
      }
      recordSelect.value = diagnostic.state === "ready" || !records.some(record => record.id === previous) ? records[0]?.id || "" : previous;
      recordSelect.dataset.keys = recordKeys;
    }
    recordSelect.hidden = !records.length;recordSelect.disabled = capturing || busy;
    dialog.querySelector("[data-diagnostic-section]").hidden = !connected && !capturing && !records.length && diagnostic.state !== "ready";
    const audioGain = dialog.querySelector("[data-audio-gain]");
    if (Number.isInteger(audio.gainDb)) audioGain.value = String(audio.gainDb);
    audioGain.disabled = busy || capturing || typeof plugin?.setAudio !== "function" || snapshot.receptionState === "stopping";
    dialog.querySelector(".sdr-listening-level").hidden = task !== "fixed";
    dialog.querySelector("[data-diagnostic-start]").disabled = busy || capturing || snapshot.receptionState !== "receiving" || rf.mode !== "cw" || typeof plugin?.startDiagnostic !== "function";
    dialog.querySelector("[data-diagnostic-share]").disabled = busy || capturing || (!records.length && diagnostic.state !== "ready") || typeof plugin?.shareDiagnostic !== "function";
    dialog.querySelector("[data-diagnostic-delete]").disabled = busy || capturing || !records.length || typeof plugin?.deleteDiagnostic !== "function";
    dialog.querySelector("[data-diagnostic-status]").textContent = diagnostic.state === "error" ? `진단 기록 실패: ${diagnostic.error}`
      : diagnostic.state === "ready" ? diagnostic.writerDroppedBlocks > 0 ? "저장 지연으로 일부만 기록됨 · 파일 공유 가능" : "기록 완료 · 파일을 공유해 수신 상태를 비교할 수 있습니다."
      : diagnostic.state === "packaging" ? "진단 파일 준비 중…"
      : capturing ? `원본 수신 기록 중 · ${(Number(diagnostic.iqBytes || 0) / 1e6).toFixed(1)} MB`
      : records.length ? `저장된 기록 ${records.length}개 · 선택한 기록을 공유할 수 있습니다.` : "원본 I/Q와 청취 소리를 기기에만 기록합니다.";
    const tunerMetrics = task === "scan" && snapshot.scan?.tuner ? snapshot.scan : rf;
    dialog.querySelector("[data-gain-info]").textContent = tunerMetrics?.tuner && Number.isFinite(tunerMetrics.gainDb)
      ? `${tunerMetrics.tuner} · 적용 ${tunerMetrics.gainDb.toFixed(1)} dB` +
        (Number.isFinite(tunerMetrics.gainMaxDb) ? ` · 최대 ${tunerMetrics.gainMaxDb.toFixed(1)} dB` : "")
      : "기본 최대 요청 · 튜너 지원값으로 적용";
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
    renderAnimalPicker();
    if (snapshot.receptionState === "scanning" && previousReception !== "scanning") {
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
      button.children[0].textContent = `${animalFormat(candidate.frequencyHz)} MHz`;
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
    frequency.value = animalFormat(hz);
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
      handleReceiverUiRequest(snapshot);
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

  function handleReceiverUiRequest(snapshot) {
    const requestId = Number(snapshot.receiverUiRequestId);
    if (!Number.isSafeInteger(requestId) || requestId <= handledReceiverUiRequest) return;
    handledReceiverUiRequest = requestId;
    restoredFixed = false; candidateSelected = false;
    const scan = snapshot.backgroundScanning || snapshot.receptionState === "scanning" ||
      (snapshot.scanResumeAvailable && !snapshot.fixedResultAvailable);
    setTask(scan ? "scan" : "fixed", false);
    void openReceiver().then(async () => {
      if (!dialog.open) return;
      if (current) render(current);
      if (typeof plugin?.acknowledgeReceiverUi === "function") await plugin.acknowledgeReceiverUi({ requestId });
    }).catch(error => { message.textContent = error.message || String(error); });
  }

  async function openReceiver() {
    if (dialog.open) return;
    dialog.querySelector("[data-advanced-settings]").open = false;
    if (typeof window.__bpResetBackExit === "function") window.__bpResetBackExit();
    dialog.showModal();
    if (!catalogLoaded) void loadAnimals();
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
  }
  trigger.addEventListener("click", openReceiver);
  refreshButton.addEventListener("click", () => run(refresh));
  async function startFixedReception() {
    const hz = Number(frequency.value) * 1e6, sampleRate = Number(rate.value);
    const gainDb = Number(gain.value), correction = Number(ppm.value), bounds = frequencyBounds;
    if (![frequency, rate, gain, ppm].every(input => String(input.value).trim() !== "") ||
        !bounds || !Number.isFinite(hz) || hz < bounds.min * 1e6 || hz > bounds.max * 1e6 || !sampleRates.includes(sampleRate) ||
        !Number.isFinite(gainDb) || gainDb < -10 || gainDb > 50 || !Number.isInteger(correction) || Math.abs(correction) > 100) {
      throw new Error("주파수는 0.1–999.999 MHz 안에 입력하세요. 샘플레이트·Gain·PPM 설정 범위도 확인하세요.");
    }
    const listenHz = hz;
    const options = { band: "wide", mode: RECEIVE_MODE, frequencyHz: Math.round(hz), listenFrequencyHz: Math.round(listenHz), sampleRate,
      gainTenthsDb: Math.round(gainDb * 10), ppm: correction, deemphasisUs: DEEMPHASIS_US };
    await plugin.startReception(options);
  }
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
    await startFixedReception();

  }));
  audioButton.addEventListener("click", () => run(() => plugin.setAudio({ enabled: !(current && current.audio && current.audio.enabled), volume: 1 })));
  dialog.querySelector("[data-audio-gain]").addEventListener("change", () => {
    const gainDb = Number(dialog.querySelector("[data-audio-gain]").value);
    return run(() => plugin.setAudio({ gainDb }));
  });
  dialog.querySelector("[data-diagnostic-start]").addEventListener("click", () => run(() => plugin.startDiagnostic()));
  dialog.querySelector("[data-diagnostic-share]").addEventListener("click", () => {
    const id = dialog.querySelector("[data-diagnostic-record]").value;
    return run(() => plugin.shareDiagnostic(id ? { id } : {}));
  });
  dialog.querySelector("[data-diagnostic-delete]").addEventListener("click", () => {
    const select = dialog.querySelector("[data-diagnostic-record]");
    const id = select.value;
    if (!id || typeof plugin?.deleteDiagnostic !== "function") return;
    const label = [...select.children].find(option => option.value === id)?.textContent || "";
    if (!window.confirm(`선택한 수신 진단 기록을 삭제할까요?\n${label}\n삭제한 기록은 복구할 수 없습니다.`)) return;
    return run(() => plugin.deleteDiagnostic({ id }));
  });
  registerObservationButton.addEventListener("click", () => run(async () => {
    if (registerObservationButton.hidden || !animalMatchesFrequency() || !current?.reception?.hasSamples) return;
    if (typeof window.BearSdrRegistration?.open !== "function") throw new Error("관측점 등록 화면을 준비하지 못했습니다. 앱을 다시 열어주세요.");
    const context = { bearCode: selectedAnimal.code, frequencyHz: selectedAnimalHz };
    const attempt = ++connectionAttempt;
    await plugin.stopReception();
    await refresh();
    if (attempt !== connectionAttempt || !dialog.open || current?.state !== "connected") return;
    const returnToReceiver = () => {
      if (dialog.open) return;
      dialog.showModal();
      if (current) render(current);
      void refresh().catch(error => { message.textContent = error.message || String(error); });
    };
    // Native dialog modality must be released before the existing map form opens.
    dialog.close();
    try {
      if (window.BearSdrRegistration.open(context, returnToReceiver) === false) throw new Error("관측점 저장 또는 수정을 완료한 뒤 다시 시도해주세요.");
    } catch (error) { returnToReceiver(); throw error; }
  }));
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
    dialog.dataset.searchCompact = String(animalSearchFocused && Number.isFinite(height) && height < 480);
    dialog.dataset.searchTight = String(animalSearchFocused && Number.isFinite(height) && height < 220);
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
    finishAnimalSearch();
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
      keepAnimalSearchVisible();
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
