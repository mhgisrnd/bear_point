// public/js/obs/obsRegister.js
// 관측점 등록 팝업 모듈

window.createObsRegisterModule = function createObsRegisterModule({
  statusEl,
  updateRegistrationPreview,
  onClose,
  onObservationSaved,
  onGpsToggle   // GPS ON/OFF 토글 클릭 시 실제 GPS를 켜고 끄는 콜백
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
  var detectorNameOptionsEl = document.getElementById("detector-name-options");
  var chkRegHeadingLock = document.getElementById("chk-reg-heading-lock");
  var btnGpsToggle = document.getElementById("btn-gps-toggle");
  var registerHeaderEl = registerBoxEl ? registerBoxEl.querySelector(".obs-register-header") : null;
  var registerBodyEl = registerBoxEl ? registerBoxEl.querySelector(".obs-register-body") : null;

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

  var BEAR_LIST_URL = "json/bear-list.json";

  var DET_ROW_TEMPLATE =
    '<tr class="det-row">' +
      '<td>' +
        '<input class="obs-reg-input obs-reg-input--det" list="detector-name-options" placeholder="직접 입력" />' +
      '</td>' +
      '<td>' +
        '<input class="obs-reg-input obs-reg-input--det" list="detector-strength-options" placeholder="직접 입력" />' +
      '</td>' +
    '</tr>';

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

  // detector_catalog에서 읽은 발신기명을 datalist option으로 렌더링한다.
  function renderDetectorCatalogOptions(names) {
    if (!detectorNameOptionsEl) return;

    detectorNameOptionsEl.innerHTML = "";
    for (var i = 0; i < names.length; i += 1) {
      var name = String(names[i] || "").trim();
      if (!name) continue;
      var option = document.createElement("option");
      option.value = name;
      detectorNameOptionsEl.appendChild(option);
    }
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

  // 현재 입력된 감지기 행을 비어 있지 않은 값만 추려 배열로 반환한다.
  function collectDetectorRows() {
    if (!detListEl) return [];

    var rows = detListEl.querySelectorAll(".det-row");
    var detectors = [];
    for (var i = 0; i < rows.length; i += 1) {
      var cells = rows[i].querySelectorAll("input");
      var detectorName = cells[0] ? cells[0].value.trim() : "";
      var signalStrength = cells[1] ? cells[1].value.trim() : "";

      if (!detectorName && !signalStrength) continue;
      detectors.push({ detectorName: detectorName, signalStrength: signalStrength });
    }

    return detectors;
  }

  // 실시간 위치 상태와 폼 입력값을 검증해 저장용 payload를 만든다.
  function buildObservationPayload() {
    var place = regPlaceEl ? regPlaceEl.value.trim() : "";
    var owner = regOwnerEl ? regOwnerEl.value.trim() : "";
    var bearCode = regBearEl ? regBearEl.value.trim() : "";
    var lat = Number(latestLive.lat);
    var lng = Number(latestLive.lng);
    var heading = Number(isHeadingLocked ? lockedHeadingDeg : latestLive.heading);

    if (!latestLive.isGpsActive) {
      throw new Error("GPS를 활성화 해주세요.");
    }
    if (!place) {
      throw new Error("지명을 입력해야 합니다.");
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error("GPS 좌표를 확인할 수 없어 등록할 수 없습니다.");
    }
    if (!Number.isFinite(heading)) {
      throw new Error("GPS 방향각을 확인할 수 없어 등록할 수 없습니다.");
    }
    if (!bearCode) {
      throw new Error("곰 목록을 선택해주세요.");
    }

    return {
      id: generateObservationId(),
      place: place,
      bearCode: bearCode,
      owner: owner || "미지정",
      lat: lat,
      lng: lng,
      heading: Math.round(heading)
    };
  }

  // 제출 버튼 진입점으로, payload 생성부터 저장 후 콜백 호출까지 처리한다.
  async function submitObservation() {
    try {
      var observation = buildObservationPayload();
      var detectors = collectDetectorRows();
      await saveObservationToSQLite(observation, detectors);

      if (onObservationSaved) {
        await onObservationSaved({ observation: observation, detectors: detectors, source: "sqlite" });
      }

      statusEl.textContent = "✅ 관측점이 SQLite에 등록되었습니다.";
      hide(true);
    } catch (error) {
      statusEl.textContent = "⚠️ " + (error && error.message ? error.message : String(error));
    }
  }

  // 등록 폼을 기본 상태로 초기화하고 감지기 행을 1개로 되돌린다.
  function resetFormState() {
    if (obsRegFormEl) obsRegFormEl.reset();
    if (detListEl) detListEl.innerHTML = DET_ROW_TEMPLATE;
    isHeadingLocked = false;
    lockedHeadingDeg = null;
    if (chkRegHeadingLock) chkRegHeadingLock.checked = false;
    syncDetBtns();
    renderLiveFields();
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
    if (btnDetRemove) btnDetRemove.disabled = count <= 1;
  }

  // 감지기 행을 최대 개수(MAX_DET)까지 추가한다.
  function addDetRow() {
    if (!detListEl || getDetCount() >= MAX_DET) return;
    var temp = document.createElement("tbody");
    temp.innerHTML = DET_ROW_TEMPLATE;
    var newRow = temp.querySelector(".det-row");
    detListEl.appendChild(newRow);
    syncDetBtns();
  }

  // 마지막 감지기 행을 삭제한다(최소 1개 유지).
  function removeDetRow() {
    if (!detListEl || getDetCount() <= 1) return;
    var rows = detListEl.querySelectorAll(".det-row");
    if (rows.length > 0) rows[rows.length - 1].remove();
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
    var hasCoord = Number.isFinite(latestLive.lat) && Number.isFinite(latestLive.lng);
    var headingToShow = isHeadingLocked ? lockedHeadingDeg : latestLive.heading;

    if (regCoordEl) {
      if (!latestLive.isGpsActive || !hasCoord) {
        // GPS 비활성 또는 좌표 없음
        regCoordEl.value = "GPS 대기중";
      } else {
        // TM 좌표 표시 고정 (위도, 경도)
        regCoordEl.value = latestLive.lat.toFixed(6) + ", " + latestLive.lng.toFixed(6);
      }
    }

    if (regHeadingEl) {
      regHeadingEl.value = latestLive.isGpsActive && Number.isFinite(headingToShow)
        ? Math.round(headingToShow) + "°"
        : "방향각 대기중";
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
    if (registerBoxEl) registerBoxEl.classList.toggle("obs-register-popup--peek", isPeekMode);
    if (btnRegisterPeek) {
      btnRegisterPeek.textContent = isPeekMode ? "□" : "―";
      btnRegisterPeek.setAttribute("aria-label", isPeekMode ? "확장" : "최소화");
      btnRegisterPeek.setAttribute("title", isPeekMode ? "확장" : "최소화");
    }
  }

  // 드래그 시작 좌표와 팝업 오프셋을 기록한다.
  function startDrag(clientX, clientY) {
    if (!registerBoxEl) return;
    var rect = registerBoxEl.getBoundingClientRect();
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

    var viewportHeight = window.innerHeight;
    if (window.visualViewport && Number.isFinite(window.visualViewport.height)) {
      viewportHeight = Math.round(window.visualViewport.height);
    }

    var popupMaxHeight = Math.max(260, viewportHeight - 16);
    registerBoxEl.style.maxHeight = popupMaxHeight + "px";

    if (registerBodyEl) {
      var headerHeight = registerHeaderEl ? registerHeaderEl.offsetHeight : 0;
      var bodyMaxHeight = Math.max(120, popupMaxHeight - headerHeight - 12);
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
    if (Object.prototype.hasOwnProperty.call(payload, "lat")) latestLive.lat = payload.lat;
    if (Object.prototype.hasOwnProperty.call(payload, "lng")) latestLive.lng = payload.lng;
    if (Object.prototype.hasOwnProperty.call(payload, "heading")) latestLive.heading = payload.heading;
    if (Object.prototype.hasOwnProperty.call(payload, "isGpsActive")) {
      latestLive.isGpsActive = payload.isGpsActive;
      // 외부 GPS 상태 변화를 토글 버튼 UI에 즉시 반영
      syncGpsToggleUi(latestLive.isGpsActive);
    }
    renderLiveFields();
  }

  // 토글 버튼의 시각적 상태(aria-pressed, 라벨)를 isOn 값에 맞게 동기화한다.
  function syncGpsToggleUi(isOn) {
    if (!btnGpsToggle) return;
    btnGpsToggle.setAttribute("aria-pressed", String(!!isOn));
    var labelEl = btnGpsToggle.querySelector(".obs-reg-gps-toggle__label");
    if (labelEl) labelEl.textContent = isOn ? "GPS ON" : "GPS OFF";
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
    setPeekMode(false);
    clearInlinePosition();
    void loadDetectorCatalogOptions();
    applyMobileViewportSizing();
    keepPopupInViewport(true);
    if (updateRegistrationPreview) updateRegistrationPreview();
    renderLiveFields();
    statusEl.textContent = "🧭 관측점 등록(실시간 GPS를 켜주세요.)";
  }

  // 등록 팝업을 숨기고 필요 시 폼 상태를 초기화한다.
  function hide(shouldReset) {
    if (registerBoxEl) registerBoxEl.classList.add("hidden");
    if (shouldReset) resetFormState();
  }

  // 등록 팝업을 닫고 onClose 콜백을 실행한다.
  function close() {
    hide(true);
    if (onClose) onClose();
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

    var btnRegSubmit = document.getElementById("btn-reg-submit");
    var btnRegCancel = document.getElementById("btn-reg-cancel");

    if (btnRegSubmit) btnRegSubmit.addEventListener("click", function() {
      void submitObservation();
    });
    if (btnRegCancel) btnRegCancel.addEventListener("click", function() {
      close();
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

    if (chkRegHeadingLock) chkRegHeadingLock.addEventListener("change", function() {
      setHeadingLock(chkRegHeadingLock.checked);
    });

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
    syncDetBtns();
    renderLiveFields();
  }

  return {
    initialize,
    open,
    hide,
    isHeadingLocked: getHeadingLockState,
    getLockedHeading,
    updateLiveData
  };
};
