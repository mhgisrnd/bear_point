// public/js/obs/obsRegister.js
// 관측점 등록 팝업 모듈

window.createObsRegisterModule = function createObsRegisterModule({
  statusEl,
  updateRegistrationPreview,
  onClose,
  onObservationSaved,
  onGpsToggle,   // GPS ON/OFF 토글 클릭 시 실제 GPS를 켜고 끄는 콜백
  onManualPreview, // 수동 좌표 입력 시 지도 프리뷰를 갱신하는 콜백
  onMapCoordinate, // 맵 클릭으로 좌표 선택 시 호출되는 콜백
  onDefaultManualCoordinate // 등록 폼 기본 좌표를 계산하는 콜백
}) {
  var registerBoxEl = document.getElementById("register-box");
  var btnRegisterClose = document.getElementById("btn-register-close");
  var btnRegisterPeek = document.getElementById("btn-register-peek");
  var btnDetAdd = document.getElementById("btn-det-add");
  var btnDetRemove = document.getElementById("btn-det-remove");
  var detListEl = document.getElementById("det-list");
  var obsRegFormEl = document.getElementById("obs-reg-form");
  var regPlaceEl = document.getElementById("reg-place");
  var regOwnerEl = document.getElementById("reg-owner");
  var regCoordEl = document.getElementById("reg-coord");
  var regHeadingEl = document.getElementById("reg-heading");
  var regBearEl = document.getElementById("reg-bear");
  var chkRegHeadingLock = document.getElementById("chk-reg-heading-lock");
  var btnGpsToggle = document.getElementById("btn-gps-toggle");
  var gpsToggleRowEl = btnGpsToggle ? btnGpsToggle.closest(".obs-reg-gps-toggle-row") : null;
  var registerHeaderEl = registerBoxEl ? registerBoxEl.querySelector(".obs-register-header") : null;
  var registerBodyEl = registerBoxEl ? registerBoxEl.querySelector(".obs-register-body") : null;
  var registerTitleEl = registerHeaderEl ? registerHeaderEl.querySelector("h2") : null;
  var btnRegSubmit = document.getElementById("btn-reg-submit");
  var btnRegCancel = document.getElementById("btn-reg-cancel");

  var MAX_DET = 3;
  var isPeekMode = false;
  var isDragging = false;
  var dragOffsetX = 0;
  var dragOffsetY = 0;
  var isHeadingLocked = false;
  var lockedHeadingDeg = null;
  var latestLive = {
    lat: null,
    lng: null,
    heading: null,
    isGpsActive: false
  };
  var formMode = "create";
  var editingObservationId = null;
  var suppressCloseCallback = false;
  var DETECTOR_STRENGTH_OPTIONS = ["미약", "감1", "감2", "감3", "P1", "P2", "P3", "P4", "P5", "P6", "P7", "P8", "P9", "P10"];
  var DEFAULT_MANUAL_LAT = 35.326459;
  var DEFAULT_MANUAL_LNG = 127.637712;
  var DEFAULT_MANUAL_HEADING = 0;
  var LAST_OWNER_STORAGE_KEY = "bearpoint.lastRegisteredOwner";

  var BEAR_LIST_URL = "json/bear-list.json";

  var DET_ROW_TEMPLATE =
    '<tr class="det-row">' +
      '<td>' +
        '<input class="obs-reg-input obs-reg-input--det det-name-input" type="text" placeholder="직접 입력" />' +
      '</td>' +
      '<td>' +
        '<select class="obs-reg-select obs-reg-select--det det-strength-select">' +
          '<option value="">-- 선택 --</option>' +
        '</select>' +
      '</td>' +
    '</tr>';

  var DET_EMPTY_ROW_TEMPLATE =
    '<tr class="det-row-empty">' +
      '<td colspan="2">감지기가 없습니다. + 버튼으로 추가하세요.</td>' +
    '</tr>';

  function highlightStatusOnce() {
    if (typeof window.__bpTriggerStatusHighlight === "function") {
      window.__bpTriggerStatusHighlight();
    }
  }

  function triggerLightErrorVibration() {
    if (typeof window.navigator !== "undefined" && window.navigator && typeof window.navigator.vibrate === "function") {
      try {
        // 입력 누락/형식 오류 등 예외 알림에 짧은 햅틱 피드백
        window.navigator.vibrate(22);
      } catch (error) {
        // 일부 WebView/브라우저에서 막히는 경우가 있어 무시한다.
      }
    }
  }

  function syncGpsToggleModeUi() {
    if (gpsToggleRowEl) {
      gpsToggleRowEl.style.display = "";
    }
  }

  // 감지기 select 옵션을 렌더링하고 기존 선택값을 유지한다.
  function fillSelectOptions(selectEl, options, preferredValue) {
    if (!selectEl) return;

    var selectedValue = String(
      preferredValue != null ? preferredValue : (selectEl.value || "")
    ).trim();

    var optionValues = Array.isArray(options) ? options : [];
    var seen = Object.create(null);
    var uniqueValues = [];

    for (var i = 0; i < optionValues.length; i += 1) {
      var value = String(optionValues[i] || "").trim();
      if (!value || seen[value]) continue;
      seen[value] = true;
      uniqueValues.push(value);
    }

    selectEl.innerHTML = '<option value="">-- 선택 --</option>';
    for (var j = 0; j < uniqueValues.length; j += 1) {
      var option = document.createElement("option");
      option.value = uniqueValues[j];
      option.textContent = uniqueValues[j];
      selectEl.appendChild(option);
    }

    if (selectedValue && !seen[selectedValue]) {
      var legacyOption = document.createElement("option");
      legacyOption.value = selectedValue;
      legacyOption.textContent = selectedValue;
      selectEl.appendChild(legacyOption);
    }

    selectEl.value = selectedValue;
  }

  // 감지기 입력행의 select 옵션 연결을 항상 유지한다.
  function ensureDetectorRowAutocomplete() {
    if (!detListEl) return;
    var rows = detListEl.querySelectorAll(".det-row");
    for (var i = 0; i < rows.length; i += 1) {
      var strengthSelect = rows[i].querySelector(".det-strength-select");
      var presetStrength = strengthSelect ? strengthSelect.getAttribute("data-value") : "";

      fillSelectOptions(strengthSelect, DETECTOR_STRENGTH_OPTIONS, presetStrength);

      if (strengthSelect) strengthSelect.removeAttribute("data-value");
    }
  }

  function renderEmptyDetectorState() {
    if (!detListEl) return;
    detListEl.innerHTML = DET_EMPTY_ROW_TEMPLATE;
  }

  function clearEmptyDetectorState() {
    if (!detListEl) return;
    var emptyRow = detListEl.querySelector(".det-row-empty");
    if (emptyRow) emptyRow.remove();
  }

  function clearDetectorFieldError(fieldEl) {
    if (!fieldEl) return;
    fieldEl.classList.remove("obs-reg-select--error");
    fieldEl.classList.remove("obs-reg-input--error");
    fieldEl.removeAttribute("aria-invalid");
    fieldEl.removeAttribute("title");
  }

  function markDetectorFieldError(fieldEl) {
    if (!fieldEl) return;
    var tag = String(fieldEl.tagName || "").toLowerCase();
    if (tag === "select") {
      fieldEl.classList.add("obs-reg-select--error");
    } else {
      fieldEl.classList.add("obs-reg-input--error");
    }
    fieldEl.setAttribute("aria-invalid", "true");
    fieldEl.setAttribute("title", "필수 입력 항목입니다.");
  }

  function clearCoreFieldError(fieldEl) {
    if (!fieldEl) return;
    fieldEl.classList.remove("obs-reg-select--error");
    fieldEl.classList.remove("obs-reg-input--error");
    fieldEl.removeAttribute("aria-invalid");
    fieldEl.removeAttribute("title");
  }

  function markCoreFieldError(fieldEl, message) {
    if (!fieldEl) return;
    var tag = String(fieldEl.tagName || "").toLowerCase();
    if (tag === "select") {
      fieldEl.classList.add("obs-reg-select--error");
    } else {
      fieldEl.classList.add("obs-reg-input--error");
    }
    fieldEl.setAttribute("aria-invalid", "true");
    fieldEl.setAttribute("title", String(message || "입력값을 확인해주세요."));
  }

  function clearCoreFieldErrors() {
    clearCoreFieldError(regOwnerEl);
    clearCoreFieldError(regPlaceEl);
    clearCoreFieldError(regCoordEl);
    clearCoreFieldError(regHeadingEl);
    clearCoreFieldError(regBearEl);
  }

  function clearAllValidationErrors() {
    clearCoreFieldErrors();
    clearDetectorRowErrors();
  }

  function clearDetectorRowErrors() {
    if (!detListEl) return;
    var fields = detListEl.querySelectorAll(".det-name-input, .det-strength-select");
    for (var i = 0; i < fields.length; i += 1) {
      clearDetectorFieldError(fields[i]);
    }
  }

  function syncDetectorRowErrorState(rowEl) {
    if (!rowEl) return;
    var nameInput = rowEl.querySelector(".det-name-input");
    var strengthSelect = rowEl.querySelector(".det-strength-select");
    var hasName = !!(nameInput && String(nameInput.value || "").trim());
    var hasStrength = !!(strengthSelect && String(strengthSelect.value || "").trim());

    if ((hasName && hasStrength) || (!hasName && !hasStrength)) {
      clearDetectorFieldError(nameInput);
      clearDetectorFieldError(strengthSelect);
      return;
    }

    if (!hasName) {
      markDetectorFieldError(nameInput);
    } else {
      clearDetectorFieldError(nameInput);
    }

    if (!hasStrength) {
      markDetectorFieldError(strengthSelect);
    } else {
      clearDetectorFieldError(strengthSelect);
    }
  }

  // SQLite PK로 쓸 관측점 식별자를 클라이언트에서 먼저 생성한다.
  function generateObservationId() {
    return "obs-" + Date.now();
  }

  // 등록 폼의 곰 선택 목록을 더미 JSON에서 읽어 select option으로 채운다.
  async function loadBearListOptions() {
    if (!regBearEl) return;

    try {
      var response = await fetch(BEAR_LIST_URL, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      var rows = await response.json();
      var items = Array.isArray(rows) ? rows : [];
      regBearEl.innerHTML = '<option value="">-- 선택 --</option>';

      for (var i = 0; i < items.length; i += 1) {
        var item = items[i] || {};
        var code = String(item.bear_code || item.id || item.code || "").trim();
        var name = String(item.name || "").trim();
        if (!code) continue;

        var option = document.createElement("option");
        option.value = code;
        option.textContent = name ? code + "-" + name : code;
        regBearEl.appendChild(option);
      }
    } catch (error) {
      console.warn("[OBS] bear-list.json 로드 실패:", error);
    }
  }

  // Capacitor SQLite 플러그인 참조를 안전하게 꺼낸다.
  function getSQLitePlugin() {
    return window.Capacitor && window.Capacitor.Plugins
      ? window.Capacitor.Plugins.CapacitorSQLite
      : null;
  }

  // 설정이 없을 때도 동일한 DB 이름을 쓰도록 기본값을 고정한다.
  function getDbName() {
    return window.BearSQLiteConfig && window.BearSQLiteConfig.dbName
      ? String(window.BearSQLiteConfig.dbName)
      : "BearPointData";
  }

  // detector_catalog 로딩은 유지하되, 감지기명은 직접 입력 정책이므로 현재는 사용하지 않는다.
  function renderDetectorCatalogOptions(names) {
    ensureDetectorRowAutocomplete();
  }

  // 최근 사용 발신기명을 SQLite에서 읽어 자동완성 목록으로 노출한다.
  async function loadDetectorCatalogOptions() {
    var sqliteModule = window.BearSQLite;
    if (!sqliteModule || typeof sqliteModule.initialize !== "function") {
      return;
    }

    var initState = await sqliteModule.initialize();
    if (!initState || !initState.ready) {
      return;
    }

    var sqlite = getSQLitePlugin();
    if (!sqlite || typeof sqlite.query !== "function") {
      return;
    }

    try {
      var queryResult = await sqlite.query({
        database: getDbName(),
        statement: "SELECT detector_name FROM detector_catalog ORDER BY last_used_at DESC, detector_name ASC LIMIT 100",
        values: [],
        readonly: false
      });

      var rows = Array.isArray(queryResult && queryResult.values) ? queryResult.values : [];
      var names = [];
      for (var i = 0; i < rows.length; i += 1) {
        var row = rows[i] || {};
        var name = String(row.detector_name || "").trim();
        if (!name) continue;
        names.push(name);
      }

      renderDetectorCatalogOptions(names);
    } catch (error) {
      console.warn("[OBS] detector catalog 로드 실패:", error);
    }
  }

  // 관측점 본문과 감지기 배열을 한 row로 직렬화해 observations 테이블에 저장한다.
  async function saveObservationToSQLite(observation, detectors) {
    var sqliteModule = window.BearSQLite;
    if (!sqliteModule || typeof sqliteModule.initialize !== "function") {
      throw new Error("SQLite 모듈이 로드되지 않았습니다.");
    }

    var initState = await sqliteModule.initialize();
    if (!initState || !initState.ready) {
      throw new Error("SQLite 연결이 준비되지 않았습니다.");
    }

    var sqlite = getSQLitePlugin();
    if (!sqlite || typeof sqlite.run !== "function") {
      throw new Error("SQLite run API를 사용할 수 없습니다.");
    }

    var dbName = getDbName();

    var normalizedDetectors = Array.isArray(detectors)
      ? detectors.slice(0, MAX_DET).map(function(item) {
          return {
            detectorName: String(item && item.detectorName ? item.detectorName : "").trim(),
            signalStrength: String(item && item.signalStrength ? item.signalStrength : "").trim()
          };
        }).filter(function(item) {
          return !!(item.detectorName || item.signalStrength);
        })
      : [];

    await sqlite.run({
      database: dbName,
      statement: [
        "INSERT INTO observations (id, bear_code, owner, lat, lng, heading, place, detectors_json)",
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ].join(" "),
      values: [
        observation.id,
        observation.bearCode,
        observation.owner,
        observation.lat,
        observation.lng,
        observation.heading,
        observation.place,
        JSON.stringify(normalizedDetectors)
      ],
      transaction: true,
      readonly: false
    });
  }

  // 관측점 수정 시 핵심 필드(명칭/등록자/곰코드/좌표/방향각/감지기)를 SQLite에 반영한다.
  async function updateObservationInSQLite(observationId, payload, detectors) {
    var sqliteModule = window.BearSQLite;
    if (!sqliteModule || typeof sqliteModule.initialize !== "function") {
      throw new Error("SQLite 모듈이 로드되지 않았습니다.");
    }

    var initState = await sqliteModule.initialize();
    if (!initState || !initState.ready) {
      throw new Error("SQLite 연결이 준비되지 않았습니다.");
    }

    var sqlite = getSQLitePlugin();
    if (!sqlite || typeof sqlite.run !== "function") {
      throw new Error("SQLite run API를 사용할 수 없습니다.");
    }

    var normalizedDetectors = Array.isArray(detectors)
      ? detectors.slice(0, MAX_DET).map(function(item) {
          return {
            detectorName: String(item && item.detectorName ? item.detectorName : "").trim(),
            signalStrength: String(item && item.signalStrength ? item.signalStrength : "").trim()
          };
        }).filter(function(item) {
          return !!(item.detectorName || item.signalStrength);
        })
      : [];

    await sqlite.run({
      database: getDbName(),
      statement: [
        "UPDATE observations",
        "SET bear_code = ?, owner = ?, place = ?, lat = ?, lng = ?, heading = ?, detectors_json = ?, updated_at = datetime('now')",
        "WHERE id = ?"
      ].join(" "),
      values: [
        payload.bearCode,
        payload.owner,
        payload.place,
        payload.lat,
        payload.lng,
        payload.heading,
        JSON.stringify(normalizedDetectors),
        observationId
      ],
      transaction: true,
      readonly: false
    });
  }

  // 감지기 행을 수집한다. 한쪽만 선택된 행이 있으면 저장을 막고 빈 칸을 표시한다.
  function collectDetectorRows() {
    if (!detListEl) return [];

    clearDetectorRowErrors();

    var rows = detListEl.querySelectorAll(".det-row");
    var detectors = [];
    var invalidRows = [];

    for (var i = 0; i < rows.length; i += 1) {
      var nameInput = rows[i].querySelector(".det-name-input");
      var strengthSelect = rows[i].querySelector(".det-strength-select");
      var detectorName = nameInput ? nameInput.value.trim() : "";
      var signalStrength = strengthSelect ? strengthSelect.value.trim() : "";
      var hasName = !!detectorName;
      var hasStrength = !!signalStrength;

      if (!hasName && !hasStrength) {
        syncDetectorRowErrorState(rows[i]);
        continue;
      }

      if (hasName !== hasStrength) {
        syncDetectorRowErrorState(rows[i]);
        invalidRows.push(i + 1);
        continue;
      }

      detectors.push({ detectorName: detectorName, signalStrength: signalStrength });
    }

    if (invalidRows.length > 0) {
      throw new Error("감지기 " + invalidRows.join(", ") + "행은 발신기명과 감도세기를 모두 선택해야 합니다.");
    }

    return detectors;
  }

  // heading 값(예: 123 또는 "123°")을 숫자 각도로 정규화한다.
  function parseHeadingNumber(value) {
    var numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;

    var text = String(value == null ? "" : value).trim();
    var match = text.match(/-?\d+(?:\.\d+)?/);
    if (!match) return NaN;
    var parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function parseFiniteNumber(value) {
    if (value === null || value === undefined || value === "") return NaN;
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function resolveDefaultManualCoordinate() {
    var fallback = {
      lat: DEFAULT_MANUAL_LAT,
      lng: DEFAULT_MANUAL_LNG
    };

    if (typeof onDefaultManualCoordinate !== "function") {
      return fallback;
    }

    try {
      var candidate = onDefaultManualCoordinate();
      var lat = parseFiniteNumber(candidate && candidate.lat);
      var lng = parseFiniteNumber(candidate && candidate.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return fallback;
      }
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        return fallback;
      }
      return { lat: lat, lng: lng };
    } catch (error) {
      return fallback;
    }
  }

  function loadLastOwner() {
    try {
      var raw = window.localStorage ? window.localStorage.getItem(LAST_OWNER_STORAGE_KEY) : "";
      return String(raw || "").trim();
    } catch (error) {
      return "";
    }
  }

  function saveLastOwner(value) {
    var owner = String(value || "").trim();
    if (!owner || owner === "미지정") return;

    try {
      if (window.localStorage) {
        window.localStorage.setItem(LAST_OWNER_STORAGE_KEY, owner);
      }
    } catch (error) {
      // localStorage 사용 불가 환경에서는 무시한다.
    }
  }

  function applyLastOwnerDefault() {
    if (!regOwnerEl) return;
    if (formMode !== "create") return;

    var current = String(regOwnerEl.value || "").trim();
    if (current) return;

    var lastOwner = loadLastOwner();
    if (!lastOwner) return;
    regOwnerEl.value = lastOwner;
  }

  // GPS가 꺼져 있으면(등록/수정 공통) 수동 입력을 허용한다.
  function isManualEntryEnabled() {
    return !latestLive.isGpsActive;
  }

  // 수정 모드에서 사용할 payload를 만든다. (좌표/방향각은 기존값 유지)
  function buildObservationEditPayload(baseObservation) {
    var place = regPlaceEl ? regPlaceEl.value.trim() : "";
    var owner = regOwnerEl ? regOwnerEl.value.trim() : "";
    var bearCode = regBearEl ? regBearEl.value.trim() : "";
    var coordParsed = parseManualCoordInput(regCoordEl ? regCoordEl.value : "");
    var headingParsed = parseManualHeadingInput(regHeadingEl ? regHeadingEl.value : "");

    if (!baseObservation || !String(baseObservation.id || "").trim()) {
      throw new Error("수정 대상 관측점을 찾을 수 없습니다.");
    }
    if (!owner) {
      markCoreFieldError(regOwnerEl, "담당자를 입력해주세요.");
      throw new Error("담당자를 입력해야 합니다.");
    }
    if (!place) {
      markCoreFieldError(regPlaceEl, "명칭을 입력해주세요.");
      throw new Error("명칭을 입력해야 합니다.");
    }
    if (!bearCode) {
      markCoreFieldError(regBearEl, "곰 코드를 선택해주세요.");
      throw new Error("곰 코드를 선택해주세요.");
    }
    if (!coordParsed) {
      markCoreFieldError(regCoordEl, "좌표 형식이 올바르지 않습니다. 예: 35.326459, 127.637712");
      throw new Error("좌표를 입력해야 합니다. (예: 35.326459, 127.637712)");
    }
    if (!Number.isFinite(headingParsed)) {
      markCoreFieldError(regHeadingEl, "방향각 형식이 올바르지 않습니다. 예: 270");
      throw new Error("방향각을 입력해야 합니다. (예: 270)");
    }

    return {
      id: String(baseObservation.id).trim(),
      place: place,
      bearCode: bearCode,
      owner: owner,
      lat: coordParsed.lat,
      lng: coordParsed.lng,
      heading: Math.round(headingParsed)
    };
  }

  // 실시간 위치 상태와 폼 입력값을 검증해 저장용 payload를 만든다.
  function buildObservationPayload() {
    var place = regPlaceEl ? regPlaceEl.value.trim() : "";
    var owner = regOwnerEl ? regOwnerEl.value.trim() : "";
    var bearCode = regBearEl ? regBearEl.value.trim() : "";
    var lat = parseFiniteNumber(latestLive.lat);
    var lng = parseFiniteNumber(latestLive.lng);
    var heading = parseHeadingNumber(isHeadingLocked ? lockedHeadingDeg : latestLive.heading);

    if (!owner) {
      markCoreFieldError(regOwnerEl, "담당자를 입력해주세요.");
      throw new Error("담당자를 입력해야 합니다.");
    }
    if (!place) {
      markCoreFieldError(regPlaceEl, "명칭을 입력해주세요.");
      throw new Error("명칭을 입력해야 합니다.");
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      markCoreFieldError(regCoordEl, "좌표 형식이 올바르지 않습니다. 예: 35.326459, 127.637712");
      throw new Error(isManualEntryEnabled() ? "수동 좌표 형식이 올바르지 않습니다. (예: 35.326459, 127.637712)" : "GPS 좌표를 확인할 수 없어 등록할 수 없습니다.");
    }
    if (!Number.isFinite(heading)) {
      markCoreFieldError(regHeadingEl, "방향각 형식이 올바르지 않습니다. 예: 270");
      throw new Error(isManualEntryEnabled() ? "수동 방향각을 입력하세요. (예: 270)" : "GPS 방향각을 확인할 수 없어 등록할 수 없습니다.");
    }
    if (!bearCode) {
      markCoreFieldError(regBearEl, "곰 코드를 선택해주세요.");
      throw new Error("곰 코드를 선택해주세요.");
    }

    return {
      id: generateObservationId(),
      place: place,
      bearCode: bearCode,
      owner: owner,
      lat: lat,
      lng: lng,
      heading: Math.round(heading)
    };
  }

  // 제출 버튼 진입점으로, payload 생성부터 저장 후 콜백 호출까지 처리한다.
  async function submitObservation() {
    try {
      clearAllValidationErrors();
      var observation = buildObservationPayload();
      var detectors = collectDetectorRows();
      await saveObservationToSQLite(observation, detectors);
      saveLastOwner(observation.owner);

      if (onObservationSaved) {
        await onObservationSaved({ observation: observation, detectors: detectors, source: "sqlite" });
      }

      statusEl.textContent = "✅ 관측점 등록 완료";
      hide(true);
    } catch (error) {
      statusEl.textContent = "⚠️ " + (error && error.message ? error.message : String(error));
      triggerLightErrorVibration();
      highlightStatusOnce();
    }
  }

  // 수정 모드 제출: 확인 후 앱(SQLite) 업데이트 또는 웹 더미 메모리 업데이트를 수행한다.
  async function submitObservationEdit() {
    try {
      clearAllValidationErrors();
      if (!editingObservationId) {
        throw new Error("수정 대상 관측점이 없습니다.");
      }

      var baseObservation = {
        id: editingObservationId,
        lat: latestLive.lat,
        lng: latestLive.lng,
        heading: latestLive.heading
      };
      var editedObservation = buildObservationEditPayload(baseObservation);
      var detectors = collectDetectorRows();

      var confirmed = window.confirm("수정 내용을 저장하시겠습니까?");
      if (!confirmed) {
        statusEl.textContent = "⚠️ 수정 저장이 취소되었습니다.";
        return;
      }

      var source = "demo";

      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform()) {
        await updateObservationInSQLite(editingObservationId, editedObservation, detectors);
        source = "sqlite";
      }
      if (onObservationSaved) {
        await onObservationSaved({
          observation: editedObservation,
          detectors: detectors,
          source: source,
          mode: "edit"
        });
      }

      statusEl.textContent = source === "sqlite"
        ? "✅ 관측점이 수정되었습니다."
        : "✅ 웹 더미 관측점이 수정되었습니다.";
      hide(true);
    } catch (error) {
      statusEl.textContent = "⚠️ " + (error && error.message ? error.message : String(error));
      triggerLightErrorVibration();
      highlightStatusOnce();
    }
  }

  // 등록 폼을 기본 상태로 초기화하고 감지기 섹션을 빈 상태 안내문으로 되돌린다.
  function resetFormState() {
    clearManualPreview();
    if (obsRegFormEl) obsRegFormEl.reset();
    applyLastOwnerDefault();
    clearAllValidationErrors();
    renderEmptyDetectorState();
    if (!latestLive.isGpsActive) {
      latestLive.lat = null;
      latestLive.lng = null;
      latestLive.heading = DEFAULT_MANUAL_HEADING;
    }
    isHeadingLocked = false;
    lockedHeadingDeg = null;
    formMode = "create";
    syncGpsToggleModeUi();
    editingObservationId = null;
    suppressCloseCallback = false;
    if (chkRegHeadingLock) chkRegHeadingLock.checked = false;
    if (registerTitleEl) registerTitleEl.textContent = "등록";
    if (btnRegSubmit) btnRegSubmit.textContent = "등록";
    if (btnRegCancel) btnRegCancel.textContent = "취소";
    if (btnGpsToggle) btnGpsToggle.disabled = false;
    if (chkRegHeadingLock) chkRegHeadingLock.disabled = false;
    clearDetectorRowErrors();
    syncDetBtns();
    renderLiveFields();
  }

  // 주어진 감지기 배열로 감지기 입력 행을 재구성한다.
  function setDetectorRows(detectors) {
    if (!detListEl) return;

    var normalized = Array.isArray(detectors)
      ? detectors.slice(0, MAX_DET).map(function(item) {
          return {
            detectorName: String(
              item && (item.detectorName || item.detector_name || item.name)
                ? (item.detectorName || item.detector_name || item.name)
                : ""
            ).trim(),
            signalStrength: String(
              item && (item.signalStrength || item.signal_strength || item.strength)
                ? (item.signalStrength || item.signal_strength || item.strength)
                : ""
            ).trim()
          };
        }).filter(function(item) {
          return !!(item.detectorName || item.signalStrength);
        })
      : [];

    if (normalized.length === 0) {
      renderEmptyDetectorState();
      syncDetBtns();
      return;
    }

    detListEl.innerHTML = "";
    for (var i = 0; i < normalized.length; i += 1) {
      var temp = document.createElement("tbody");
      temp.innerHTML = DET_ROW_TEMPLATE;
      var newRow = temp.querySelector(".det-row");
      if (!newRow) continue;

      var nameInput = newRow.querySelector(".det-name-input");
      var strengthSelect = newRow.querySelector(".det-strength-select");
      if (nameInput) nameInput.value = normalized[i].detectorName;
      if (strengthSelect) strengthSelect.setAttribute("data-value", normalized[i].signalStrength);
      detListEl.appendChild(newRow);
    }
    ensureDetectorRowAutocomplete();
    syncDetBtns();
  }

  // 현재 감지기 행 개수를 반환한다.
  function getDetCount() {
    if (!detListEl) return 0;
    return detListEl.querySelectorAll(".det-row").length;
  }

  // 감지기 추가/삭제 버튼 활성화를 현재 행 개수에 맞춰 갱신한다.
  function syncDetBtns() {
    var count = getDetCount();
    if (btnDetAdd) btnDetAdd.disabled = count >= MAX_DET;
    if (btnDetRemove) btnDetRemove.disabled = count <= 0;
  }

  // 감지기 행을 최대 개수(MAX_DET)까지 추가한다.
  function addDetRow() {
    if (!detListEl || getDetCount() >= MAX_DET) return;
    clearEmptyDetectorState();
    var temp = document.createElement("tbody");
    temp.innerHTML = DET_ROW_TEMPLATE;
    var newRow = temp.querySelector(".det-row");
    detListEl.appendChild(newRow);
    ensureDetectorRowAutocomplete();
    syncDetBtns();
  }

  // 마지막 감지기 행을 삭제한다. 모두 삭제되면 빈 상태 안내문을 표시한다.
  function removeDetRow() {
    if (!detListEl || getDetCount() <= 0) return;
    var rows = detListEl.querySelectorAll(".det-row");
    if (rows.length > 0) rows[rows.length - 1].remove();
    if (getDetCount() === 0) {
      renderEmptyDetectorState();
    }
    syncDetBtns();
  }

  // 십진 좌표를 도분초 문자열로 변환한다.
  function toDmsString(value, positiveLabel, negativeLabel) {
    if (!Number.isFinite(value)) return "-";
    var abs = Math.abs(value);
    var deg = Math.floor(abs);
    var minFloat = (abs - deg) * 60;
    var min = Math.floor(minFloat);
    var sec = (minFloat - min) * 60;
    var dir = value >= 0 ? positiveLabel : negativeLabel;
    return deg + "°" + min + "'" + sec.toFixed(2) + '" ' + dir;
  }

  // 실시간 좌표/방향각 데이터를 입력 필드에 반영한다. (TM 고정 표시)
  function renderLiveFields() {
    var isManualInputMode = isManualEntryEnabled();
    var latValue = parseFiniteNumber(latestLive.lat);
    var lngValue = parseFiniteNumber(latestLive.lng);
    var hasCoord = Number.isFinite(latValue) && Number.isFinite(lngValue);
    var headingToShow = isHeadingLocked ? lockedHeadingDeg : latestLive.heading;

    if (isManualInputMode && !hasCoord) {
      var defaultCoord = resolveDefaultManualCoordinate();
      latestLive.lat = defaultCoord.lat;
      latestLive.lng = defaultCoord.lng;
      latValue = defaultCoord.lat;
      lngValue = defaultCoord.lng;
      hasCoord = true;
    }

    if (isManualInputMode && !Number.isFinite(parseFiniteNumber(headingToShow))) {
      latestLive.heading = DEFAULT_MANUAL_HEADING;
      headingToShow = DEFAULT_MANUAL_HEADING;
    }

    if (regCoordEl) {
      if (isManualInputMode) {
        regCoordEl.readOnly = false;
        regCoordEl.classList.remove("obs-reg-input--gps");
        regCoordEl.placeholder = "예: 35.326459, 127.637712";
        if (hasCoord) {
          var coordText = latValue.toFixed(5) + ", " + lngValue.toFixed(5);
          if (!String(regCoordEl.value || "").trim() || /대기중/.test(String(regCoordEl.value))) {
            regCoordEl.value = coordText;
          }
        }
      } else {
        regCoordEl.readOnly = true;
        regCoordEl.classList.add("obs-reg-input--gps");
        regCoordEl.placeholder = "GPS 대기중";
        if (!latestLive.isGpsActive || !hasCoord) {
          regCoordEl.value = "GPS 대기중";
        } else {
          regCoordEl.value = latValue.toFixed(5) + ", " + lngValue.toFixed(5);
        }
      }
    }

    if (regHeadingEl) {
      if (isManualInputMode) {
        regHeadingEl.readOnly = false;
        regHeadingEl.classList.remove("obs-reg-input--gps");
        regHeadingEl.placeholder = "예: 270";
        var headingText = String(regHeadingEl.value || "").trim();
        if (/대기중/.test(headingText)) {
          headingText = "";
          regHeadingEl.value = "";
        }
        if (!headingText && Number.isFinite(headingToShow)) {
          regHeadingEl.value = String(Math.round(headingToShow));
        }
      } else {
        regHeadingEl.readOnly = true;
        regHeadingEl.classList.add("obs-reg-input--gps");
        regHeadingEl.placeholder = "방향각 대기중";
        regHeadingEl.value = latestLive.isGpsActive && Number.isFinite(headingToShow)
          ? Math.round(headingToShow) + "°"
          : "방향각 대기중";
      }
    }
  }

  // 방향각 고정 체크 상태를 반영하고 고정 기준 각도를 관리한다.
  function setHeadingLock(nextState) {
    isHeadingLocked = !!nextState;
    if (isHeadingLocked) {
      if (Number.isFinite(latestLive.heading)) {
        lockedHeadingDeg = latestLive.heading;
      }
    } else {
      lockedHeadingDeg = null;
    }
    renderLiveFields();
  }

  // 등록 팝업 최소화/복원 상태를 토글하고 아이콘 상태를 동기화한다.
  function setPeekMode(nextState) {
    isPeekMode = !!nextState;
    if (registerBoxEl) {
      registerBoxEl.classList.toggle("obs-register-popup--peek", isPeekMode);
      // 드래그 중 고정된 inline width가 최소화 폭으로 남아 복원 시 폭이 줄어드는 현상을 방지한다.
      registerBoxEl.style.width = "";
    }
    if (btnRegisterPeek) {
      btnRegisterPeek.innerHTML = isPeekMode
        ? '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
        : '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 12h12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      btnRegisterPeek.setAttribute("aria-label", isPeekMode ? "확장" : "최소화");
      btnRegisterPeek.setAttribute("title", isPeekMode ? "확장" : "최소화");
    }
  }

  // 드래그 시작 좌표와 팝업 오프셋을 기록한다.
  function startDrag(clientX, clientY) {
    if (!registerBoxEl) return;
    var rect = registerBoxEl.getBoundingClientRect();
    // 드래그 중 width:auto 재계산으로 폭이 바뀌지 않도록 현재 폭을 고정한다.
    registerBoxEl.style.width = Math.round(rect.width) + "px";
    isDragging = true;
    dragOffsetX = clientX - rect.left;
    dragOffsetY = clientY - rect.top;
  }

  // 포인터 이동에 따라 팝업을 화면 경계 안에서 이동시킨다.
  function moveDrag(clientX, clientY) {
    if (!registerBoxEl || !isDragging) return;

    var nextLeft = clientX - dragOffsetX;
    var nextTop = clientY - dragOffsetY;

    var maxLeft = Math.max(0, window.innerWidth - registerBoxEl.offsetWidth);
    var maxTop = Math.max(0, window.innerHeight - registerBoxEl.offsetHeight);

    if (nextLeft < 0) nextLeft = 0;
    if (nextTop < 0) nextTop = 0;
    if (nextLeft > maxLeft) nextLeft = maxLeft;
    if (nextTop > maxTop) nextTop = maxTop;

    registerBoxEl.style.right = "auto";
    registerBoxEl.style.left = nextLeft + "px";
    registerBoxEl.style.top = nextTop + "px";
  }

  // 드래그 상태를 종료한다.
  function endDrag() {
    isDragging = false;
  }

  // 드래그로 생긴 inline 좌표를 제거해 CSS 기본 위치로 복귀한다.
  function clearInlinePosition() {
    if (!registerBoxEl) return;
    registerBoxEl.style.left = "";
    registerBoxEl.style.top = "";
    registerBoxEl.style.right = "";
    registerBoxEl.style.width = "";
  }

  // 모바일에서 키보드 표시 시 visualViewport 기준으로 팝업/본문 높이를 보정한다.
  function applyMobileViewportSizing() {
    if (!registerBoxEl) return;
    var isMobile = window.matchMedia && window.matchMedia("(max-width: 820px)").matches;

    if (!isMobile) {
      registerBoxEl.style.maxHeight = "";
      if (registerBodyEl) registerBodyEl.style.maxHeight = "";
      return;
    }

    var layoutViewportHeight = window.innerHeight;
    var visualViewportHeight = null;
    if (window.visualViewport && Number.isFinite(window.visualViewport.height)) {
      visualViewportHeight = Math.round(window.visualViewport.height);
    }

    var viewportHeight = Number.isFinite(visualViewportHeight) ? visualViewportHeight : layoutViewportHeight;
    var keyboardLikelyOpen = Number.isFinite(visualViewportHeight) && visualViewportHeight < (layoutViewportHeight - 110);
    var reservedBottomSpace = keyboardLikelyOpen ? 18 : 122;

    var popupMaxHeight = Math.max(250, viewportHeight - reservedBottomSpace);
    registerBoxEl.style.maxHeight = popupMaxHeight + "px";

    if (registerBodyEl) {
      var headerHeight = registerHeaderEl ? registerHeaderEl.offsetHeight : 0;
      var bodyMaxHeight = Math.max(108, popupMaxHeight - headerHeight - 10);
      registerBodyEl.style.maxHeight = bodyMaxHeight + "px";
    }
  }

  // 팝업이 화면 밖으로 나가지 않도록 위치를 보정한다.
  function keepPopupInViewport(resetOnMobile) {
    if (!registerBoxEl) return;

    var isMobile = window.matchMedia && window.matchMedia("(max-width: 820px)").matches;
    if (isMobile) {
      // 모바일 기본 위치는 CSS를 따르도록 inline 좌표 제거
      clearInlinePosition();
      applyMobileViewportSizing();
      return;
    }

    if (resetOnMobile) {
      clearInlinePosition();
    }

    var rect = registerBoxEl.getBoundingClientRect();
    var margin = 8;

    var nextLeft = rect.left;
    var nextTop = rect.top;

    var maxLeft = window.innerWidth - rect.width - margin;
    var maxTop = window.innerHeight - rect.height - margin;

    if (nextLeft < margin) nextLeft = margin;
    if (nextTop < margin) nextTop = margin;
    if (nextLeft > maxLeft) nextLeft = Math.max(margin, maxLeft);
    if (nextTop > maxTop) nextTop = Math.max(margin, maxTop);

    registerBoxEl.style.right = "auto";
    registerBoxEl.style.left = Math.round(nextLeft) + "px";
    registerBoxEl.style.top = Math.round(nextTop) + "px";
  }

  // 외부(client)에서 전달된 실시간 데이터를 내부 상태로 갱신한다.
  function updateLiveData(payload) {
    if (!payload) return;
    var hasGpsActiveFlag = Object.prototype.hasOwnProperty.call(payload, "isGpsActive");
    var nextGpsActive = hasGpsActiveFlag ? !!payload.isGpsActive : latestLive.isGpsActive;
    var hasLatValue = Object.prototype.hasOwnProperty.call(payload, "lat") && payload.lat !== null && payload.lat !== "";
    var hasLngValue = Object.prototype.hasOwnProperty.call(payload, "lng") && payload.lng !== null && payload.lng !== "";
    var hasHeadingValue = Object.prototype.hasOwnProperty.call(payload, "heading") && payload.heading !== null && payload.heading !== "";

    if (nextGpsActive) {
      if (Object.prototype.hasOwnProperty.call(payload, "lat")) latestLive.lat = payload.lat;
      if (Object.prototype.hasOwnProperty.call(payload, "lng")) latestLive.lng = payload.lng;
      if (Object.prototype.hasOwnProperty.call(payload, "heading")) latestLive.heading = payload.heading;
    } else {
      // GPS OFF 전환 시 payload 값이 비어 있으면 기존 수동/마지막 좌표를 유지한다.
      if (Object.prototype.hasOwnProperty.call(payload, "lat") && hasLatValue && Number.isFinite(Number(payload.lat))) latestLive.lat = Number(payload.lat);
      if (Object.prototype.hasOwnProperty.call(payload, "lng") && hasLngValue && Number.isFinite(Number(payload.lng))) latestLive.lng = Number(payload.lng);
      if (Object.prototype.hasOwnProperty.call(payload, "heading") && hasHeadingValue && Number.isFinite(Number(payload.heading))) latestLive.heading = Number(payload.heading);
    }

    if (hasGpsActiveFlag) {
      latestLive.isGpsActive = payload.isGpsActive;
      // 외부 GPS 상태 변화를 토글 버튼 UI에 즉시 반영
      syncGpsToggleUi(latestLive.isGpsActive);
      if (!latestLive.isGpsActive) {
        isHeadingLocked = false;
        lockedHeadingDeg = null;
        if (chkRegHeadingLock) chkRegHeadingLock.checked = false;
      }
    }

    if (chkRegHeadingLock) chkRegHeadingLock.disabled = isManualEntryEnabled();
    renderLiveFields();
    if (!latestLive.isGpsActive) {
      emitManualPreview();
    }
  }

  // 토글 버튼의 시각적 상태(aria-pressed, 라벨)를 isOn 값에 맞게 동기화한다.
  function syncGpsToggleUi(isOn) {
    if (!btnGpsToggle) return;
    btnGpsToggle.setAttribute("aria-pressed", String(!!isOn));
    var labelEl = btnGpsToggle.querySelector(".obs-reg-gps-toggle__label");
    if (labelEl) labelEl.textContent = isOn ? "내위치 ON" : "내위치 OFF";
  }

  function isRegisterPopupVisible() {
    return !!(registerBoxEl && !registerBoxEl.classList.contains("hidden"));
  }

  function parseManualCoordInput(raw) {
    var text = String(raw == null ? "" : raw).trim();
    var parts = text.split(",");
    if (parts.length !== 2) return null;

    var lat = Number(parts[0].trim());
    var lng = Number(parts[1].trim());
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;

    return { lat: lat, lng: lng };
  }

  function parseManualHeadingInput(raw) {
    var parsed = parseHeadingNumber(raw);
    if (!Number.isFinite(parsed)) return null;
    return (parsed % 360 + 360) % 360;
  }

  function emitManualPreview(options) {
    if (!isManualEntryEnabled() || typeof onManualPreview !== "function") return;
    if (!isRegisterPopupVisible()) return;
    if (!Number.isFinite(latestLive.lat) || !Number.isFinite(latestLive.lng)) return;

    var previewOptions = options || {};

    onManualPreview({
      lat: latestLive.lat,
      lng: latestLive.lng,
      heading: Number.isFinite(latestLive.heading) ? latestLive.heading : null,
      isManual: true,
      shouldFocus: !!previewOptions.shouldFocus
    });
  }

  function clearManualPreview() {
    if (typeof onManualPreview === "function") {
      onManualPreview(null);
    }
  }

  function isManualMapControlEnabled() {
    return isManualEntryEnabled() && isRegisterPopupVisible();
  }

  // 맵 클릭으로 전달된 좌표를 수동 입력 필드에 적용한다. (GPS OFF 모드일 때만)
  function applyMapClickCoordinate(lat, lng) {
    if (!isManualMapControlEnabled()) return false;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return false;

    latestLive.lat = lat;
    latestLive.lng = lng;
    
    if (regCoordEl) {
      regCoordEl.value = lat.toFixed(5) + ", " + lng.toFixed(5);
    }
    
    renderLiveFields();
    emitManualPreview();
    
    return true;
  }

  // 맵 드래그 회전으로 계산된 방향각을 수동 입력값으로 적용한다.
  function applyMapHeadingDegrees(headingDeg) {
    if (!isManualMapControlEnabled()) return false;
    if (isHeadingLocked) return false;

    var parsedHeading = parseManualHeadingInput(headingDeg);
    if (!Number.isFinite(parsedHeading)) return false;

    latestLive.heading = parsedHeading;
    if (regHeadingEl) {
      regHeadingEl.value = String(Math.round(parsedHeading));
    }

    renderLiveFields();
    emitManualPreview();
    return true;
  }

  function applyManualInputValues() {
    if (!isManualEntryEnabled()) return;

    var coordParsed = parseManualCoordInput(regCoordEl ? regCoordEl.value : "");
    var headingParsed = parseManualHeadingInput(regHeadingEl ? regHeadingEl.value : "");

    if (coordParsed) {
      latestLive.lat = coordParsed.lat;
      latestLive.lng = coordParsed.lng;
    }

    if (Number.isFinite(headingParsed) && !isHeadingLocked) {
      latestLive.heading = headingParsed;
    }

    emitManualPreview();
  }

  // 현재 고정된 방향각 값을 반환한다.
  function getLockedHeading() {
    return lockedHeadingDeg;
  }

  // 방향각 고정 여부를 반환한다.
  function getHeadingLockState() {
    return isHeadingLocked;
  }

  // 등록 팝업을 열고 위치/UI 상태를 초기 표시로 맞춘다.
  function open() {
    if (registerBoxEl) registerBoxEl.classList.remove("hidden");
    formMode = "create";
    syncGpsToggleModeUi();
    clearAllValidationErrors();
    if (!latestLive.isGpsActive) {
      // 등록창을 다시 열 때마다 현재 화면 기준 기본 좌표를 다시 계산한다.
      latestLive.lat = null;
      latestLive.lng = null;
    }
    applyLastOwnerDefault();
    setPeekMode(false);
    clearInlinePosition();
    void loadDetectorCatalogOptions();
    ensureDetectorRowAutocomplete();
    applyMobileViewportSizing();
    keepPopupInViewport(true);
    if (updateRegistrationPreview) updateRegistrationPreview();
    if (chkRegHeadingLock) chkRegHeadingLock.disabled = isManualEntryEnabled();
    renderLiveFields();
    emitManualPreview({ shouldFocus: true });
    statusEl.textContent = "🧭 관측점 등록(GPS ON 시 위치 자동 갱신)";
    highlightStatusOnce();
  }

  // 관측점 수정 모드로 팝업을 열고 기존 데이터를 폼에 채운다.
  function openForEdit(observation) {
    var target = observation || {};
    var targetId = String(target.id || "").trim();
    if (!targetId) {
      statusEl.textContent = "⚠️ 수정할 관측점 정보가 올바르지 않습니다.";
      triggerLightErrorVibration();
      return;
    }

    if (registerBoxEl) registerBoxEl.classList.remove("hidden");
    clearAllValidationErrors();
    setPeekMode(false);
    clearInlinePosition();
    void loadDetectorCatalogOptions();
    applyMobileViewportSizing();
    keepPopupInViewport(true);

    formMode = "edit";
    syncGpsToggleModeUi();
    editingObservationId = targetId;
    // 수정 팝업을 닫을 때(onClose) 목록 패널 복원 콜백이 실행되도록 suppress를 끈다.
    suppressCloseCallback = false;
    if (registerTitleEl) registerTitleEl.textContent = "관측점 수정";
    if (btnRegSubmit) btnRegSubmit.textContent = "수정";
    if (btnRegCancel) btnRegCancel.textContent = "취소";

    if (regPlaceEl) regPlaceEl.value = String(target.place || target.name || "").trim();
    if (regOwnerEl) regOwnerEl.value = String(target.owner || "").trim();
    if (regBearEl) regBearEl.value = String(target.bearCode || target.bear_code || "").trim();

    latestLive.lat = Number(target.lat);
    latestLive.lng = Number(target.lng);
    latestLive.heading = parseHeadingNumber(target.heading);
    latestLive.isGpsActive = false;

    if (chkRegHeadingLock) {
      chkRegHeadingLock.checked = false;
      chkRegHeadingLock.disabled = isManualEntryEnabled();
    }
    isHeadingLocked = false;
    lockedHeadingDeg = null;

    if (btnGpsToggle) {
      btnGpsToggle.disabled = false;
      syncGpsToggleUi(false);
    }

    setDetectorRows(target.detectors);
    ensureDetectorRowAutocomplete();

    // 수정 팝업 진입 시 좌표/방향각 입력값을 현재 관측점 값으로 강제 동기화한다.
    // (manual 모드 렌더는 기존 입력값이 남아 있으면 덮어쓰지 않기 때문에 여기서 명시적으로 세팅)
    if (regCoordEl && Number.isFinite(latestLive.lat) && Number.isFinite(latestLive.lng)) {
      regCoordEl.value = latestLive.lat.toFixed(5) + ", " + latestLive.lng.toFixed(5);
    } else if (regCoordEl) {
      regCoordEl.value = "";
    }
    if (regHeadingEl && Number.isFinite(latestLive.heading)) {
      regHeadingEl.value = String(Math.round(latestLive.heading));
    } else if (regHeadingEl) {
      regHeadingEl.value = "";
    }

    renderLiveFields();
    emitManualPreview({ shouldFocus: true });
    statusEl.textContent = "✏️ 관측점 정보를 수정하세요.";
  }

  // 등록 팝업을 숨기고 필요 시 폼 상태를 초기화한다.
  function hide(shouldReset) {
    if (registerBoxEl) registerBoxEl.classList.add("hidden");
    if (shouldReset) resetFormState();
  }

  // 등록 팝업을 닫고 onClose 콜백을 실행한다.
  function close() {
    var shouldSuppressClose = suppressCloseCallback;
    hide(true);
    if (typeof window.__bpSetDefaultStatus === "function") {
      window.__bpSetDefaultStatus();
    } else {
      statusEl.textContent = "반달가슴곰 위치추적분석";
    }
    if (!shouldSuppressClose && onClose) onClose();
  }

  // 등록 팝업 관련 DOM 이벤트를 한 번에 바인딩한다.
  function bindEvents() {
    if (btnRegisterClose) btnRegisterClose.addEventListener("click", function() {
      close();
    });
    if (btnRegisterPeek) btnRegisterPeek.addEventListener("click", function() {
      setPeekMode(!isPeekMode);
    });
    if (btnDetAdd) btnDetAdd.addEventListener("click", function() {
      addDetRow();
    });
    if (btnDetRemove) btnDetRemove.addEventListener("click", function() {
      removeDetRow();
    });

    if (btnRegSubmit) btnRegSubmit.addEventListener("click", function() {
      if (formMode === "edit") {
        void submitObservationEdit();
        return;
      }
      void submitObservation();
    });
    if (btnRegCancel) btnRegCancel.addEventListener("click", function() {
      close();
    });

    if (detListEl) detListEl.addEventListener("change", function(e) {
      var target = e.target;
      if (!target) return;
      var row = target.closest(".det-row");
      syncDetectorRowErrorState(row);
    });

    if (detListEl) detListEl.addEventListener("input", function(e) {
      var target = e.target;
      if (!target) return;
      var row = target.closest(".det-row");
      syncDetectorRowErrorState(row);
    });

    // GPS ON/OFF 토글 버튼 클릭 이벤트
    // 클릭 시 client-ol의 toggleMyLocation()을 호출하여 실제 GPS를 켜고/끈다.
    // 상태 반영은 updateLiveData({ isGpsActive }) 콜백을 통해 수동으로 처리한다.
    if (btnGpsToggle) {
      btnGpsToggle.addEventListener("click", function() {
        if (typeof onGpsToggle === "function") {
          onGpsToggle();
        }
      });
    }

    if (regCoordEl) {
      regCoordEl.addEventListener("input", function() {
        clearCoreFieldError(regCoordEl);
        applyManualInputValues();
      });
      regCoordEl.addEventListener("blur", function() {
        if (!isManualEntryEnabled()) return;
        var parsed = parseManualCoordInput(regCoordEl.value);
        if (!parsed) return;
        regCoordEl.value = parsed.lat.toFixed(5) + ", " + parsed.lng.toFixed(5);
      });
    }

    if (regHeadingEl) {
      regHeadingEl.addEventListener("input", function() {
        clearCoreFieldError(regHeadingEl);
        applyManualInputValues();
      });
      regHeadingEl.addEventListener("blur", function() {
        if (!isManualEntryEnabled()) return;
        var parsed = parseManualHeadingInput(regHeadingEl.value);
        if (!Number.isFinite(parsed)) return;
        regHeadingEl.value = String(Math.round(parsed));
      });
    }

    if (chkRegHeadingLock) chkRegHeadingLock.addEventListener("change", function() {
      setHeadingLock(chkRegHeadingLock.checked);
    });

    if (regOwnerEl) {
      regOwnerEl.addEventListener("input", function() {
        clearCoreFieldError(regOwnerEl);
      });
    }

    if (regPlaceEl) {
      regPlaceEl.addEventListener("input", function() {
        clearCoreFieldError(regPlaceEl);
      });
    }

    if (regBearEl) {
      regBearEl.addEventListener("change", function() {
        clearCoreFieldError(regBearEl);
      });
    }

    if (registerHeaderEl) {
      registerHeaderEl.addEventListener("mousedown", function(e) {
        if (e.target && e.target.closest("button")) return;
        e.preventDefault();
        startDrag(e.clientX, e.clientY);
      });

      registerHeaderEl.addEventListener("touchstart", function(e) {
        if (!e.touches || e.touches.length === 0) return;
        if (e.target && e.target.closest("button")) return;
        startDrag(e.touches[0].clientX, e.touches[0].clientY);
      }, { passive: true });
    }

    window.addEventListener("mousemove", function(e) {
      moveDrag(e.clientX, e.clientY);
    });

    window.addEventListener("touchmove", function(e) {
      if (!e.touches || e.touches.length === 0) return;
      moveDrag(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    window.addEventListener("mouseup", function() {
      endDrag();
    });

    window.addEventListener("touchend", function() {
      endDrag();
    });

    window.addEventListener("resize", function() {
      applyMobileViewportSizing();
      keepPopupInViewport(false);
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", function() {
        applyMobileViewportSizing();
        keepPopupInViewport(false);
      });

      window.visualViewport.addEventListener("scroll", function() {
        applyMobileViewportSizing();
        keepPopupInViewport(false);
      });
    }
  }

  // 모듈 초기 진입 시 이벤트/초기 UI를 세팅한다.
  function initialize() {
    bindEvents();
    void loadBearListOptions();
    renderEmptyDetectorState();
    syncDetBtns();
    renderLiveFields();
  }

  return {
    initialize,
    open,
    openForEdit,
    hide,
    isHeadingLocked: getHeadingLockState,
    getLockedHeading,
    updateLiveData,
    applyMapClickCoordinate,
    applyMapHeadingDegrees,
    isManualMapControlEnabled
  };
};
