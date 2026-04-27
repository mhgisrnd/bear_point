// public/js/obs/obsRegister.js
// 관측점 등록 팝업 모듈

window.createObsRegisterModule = function createObsRegisterModule({
  statusEl,
  updateRegistrationPreview,
  onClose
}) {
  var registerBoxEl = document.getElementById("register-box");
  var btnRegisterClose = document.getElementById("btn-register-close");
  var btnRegisterPeek = document.getElementById("btn-register-peek");
  var btnDetAdd = document.getElementById("btn-det-add");
  var btnDetRemove = document.getElementById("btn-det-remove");
  var detListEl = document.getElementById("det-list");
  var obsRegFormEl = document.getElementById("obs-reg-form");
  var regCoordEl = document.getElementById("reg-coord");
  var regHeadingEl = document.getElementById("reg-heading");
  var chkRegHeadingLock = document.getElementById("chk-reg-heading-lock");
  var coordTypeEls = document.querySelectorAll('input[name="coord-type"]');
  var registerHeaderEl = registerBoxEl ? registerBoxEl.querySelector(".obs-register-header") : null;

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
    timestamp: null,
    isGpsActive: false
  };

  var DET_ROW_TEMPLATE =
    '<tr class="det-row">' +
      '<td>' +
        '<select class="obs-reg-select obs-reg-select--det">' +
          '<option value="">-- 선택 --</option>' +
          '<option value="A">A발신기</option>' +
          '<option value="B">B발신기</option>' +
          '<option value="C">C발신기</option>' +
        '</select>' +
      '</td>' +
      '<td>' +
        '<select class="obs-reg-select obs-reg-select--det">' +
          '<option value="">-- 선택 --</option>' +
          '<option value="weak">미약</option>' +
          '<option value="s1">감1</option>' +
          '<option value="s2">감2</option>' +
          '<option value="s3">감3</option>' +
          '<option value="p1">P1</option>' +
          '<option value="p2">P2</option>' +
          '<option value="p3">P3</option>' +
          '<option value="p4">P4</option>' +
          '<option value="p5">P5</option>' +
          '<option value="p6">P6</option>' +
          '<option value="p7">P7</option>' +
          '<option value="p8">P8</option>' +
          '<option value="p9">P9</option>' +
          '<option value="p10">P10</option>' +
        '</select>' +
      '</td>' +
    '</tr>';

  function resetFormState() {
    if (obsRegFormEl) obsRegFormEl.reset();
    if (detListEl) detListEl.innerHTML = DET_ROW_TEMPLATE;
    isHeadingLocked = false;
    lockedHeadingDeg = null;
    if (chkRegHeadingLock) chkRegHeadingLock.checked = false;
    syncDetBtns();
    renderLiveFields();
  }

  function getDetCount() {
    if (!detListEl) return 0;
    return detListEl.querySelectorAll(".det-row").length;
  }

  function syncDetBtns() {
    var count = getDetCount();
    if (btnDetAdd) btnDetAdd.disabled = count >= MAX_DET;
    if (btnDetRemove) btnDetRemove.disabled = count <= 1;
  }

  function addDetRow() {
    if (!detListEl || getDetCount() >= MAX_DET) return;
    var temp = document.createElement("tbody");
    temp.innerHTML = DET_ROW_TEMPLATE;
    var newRow = temp.querySelector(".det-row");
    detListEl.appendChild(newRow);
    syncDetBtns();
  }

  function removeDetRow() {
    if (!detListEl || getDetCount() <= 1) return;
    var rows = detListEl.querySelectorAll(".det-row");
    if (rows.length > 0) rows[rows.length - 1].remove();
    syncDetBtns();
  }

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

  function getSelectedCoordType() {
    if (!coordTypeEls || coordTypeEls.length === 0) return "tm";
    for (var i = 0; i < coordTypeEls.length; i += 1) {
      if (coordTypeEls[i].checked) return coordTypeEls[i].value;
    }
    return "tm";
  }

  function renderLiveFields() {
    var hasCoord = Number.isFinite(latestLive.lat) && Number.isFinite(latestLive.lng);
    var hasHeading = Number.isFinite(latestLive.heading);
    var headingToShow = isHeadingLocked ? lockedHeadingDeg : latestLive.heading;

    if (regCoordEl) {
      if (!latestLive.isGpsActive || !hasCoord) {
        regCoordEl.value = "GPS 대기중";
      } else if (getSelectedCoordType() === "dms") {
        regCoordEl.value =
          toDmsString(latestLive.lat, "N", "S") + ", " +
          toDmsString(latestLive.lng, "E", "W");
      } else {
        regCoordEl.value = latestLive.lat.toFixed(6) + ", " + latestLive.lng.toFixed(6);
      }
    }

    if (regHeadingEl) {
      regHeadingEl.value = latestLive.isGpsActive && Number.isFinite(headingToShow)
        ? Math.round(headingToShow) + "°"
        : "방향각 대기중";
    }
  }

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

  function setPeekMode(nextState) {
    isPeekMode = !!nextState;
    if (registerBoxEl) registerBoxEl.classList.toggle("obs-register-popup--peek", isPeekMode);
    if (btnRegisterPeek) {
      btnRegisterPeek.textContent = isPeekMode ? "□" : "―";
      btnRegisterPeek.setAttribute("aria-label", isPeekMode ? "확장" : "최소화");
      btnRegisterPeek.setAttribute("title", isPeekMode ? "확장" : "최소화");
    }
  }

  function startDrag(clientX, clientY) {
    if (!registerBoxEl) return;
    var rect = registerBoxEl.getBoundingClientRect();
    isDragging = true;
    dragOffsetX = clientX - rect.left;
    dragOffsetY = clientY - rect.top;
  }

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

  function endDrag() {
    isDragging = false;
  }

  function clearInlinePosition() {
    if (!registerBoxEl) return;
    registerBoxEl.style.left = "";
    registerBoxEl.style.top = "";
    registerBoxEl.style.right = "";
  }

  function keepPopupInViewport(resetOnMobile) {
    if (!registerBoxEl) return;

    var isMobile = window.matchMedia && window.matchMedia("(max-width: 820px)").matches;
    if (isMobile && resetOnMobile) {
      // 모바일 기본 위치는 CSS를 따르도록 inline 좌표 제거
      clearInlinePosition();
      return;
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

  function updateLiveData(payload) {
    if (!payload) return;
    if (Object.prototype.hasOwnProperty.call(payload, "lat")) latestLive.lat = payload.lat;
    if (Object.prototype.hasOwnProperty.call(payload, "lng")) latestLive.lng = payload.lng;
    if (Object.prototype.hasOwnProperty.call(payload, "heading")) latestLive.heading = payload.heading;
    if (Object.prototype.hasOwnProperty.call(payload, "timestamp")) latestLive.timestamp = payload.timestamp;
    if (Object.prototype.hasOwnProperty.call(payload, "isGpsActive")) latestLive.isGpsActive = payload.isGpsActive;
    renderLiveFields();
  }

  function getLockedHeading() {
    return lockedHeadingDeg;
  }

  function getHeadingLockState() {
    return isHeadingLocked;
  }

  function open() {
    if (registerBoxEl) registerBoxEl.classList.remove("hidden");
    setPeekMode(false);
    clearInlinePosition();
    keepPopupInViewport(true);
    if (updateRegistrationPreview) updateRegistrationPreview();
    renderLiveFields();
    statusEl.textContent = "🧭 현재 위치와 방향각으로 관측점 등록 준비";
  }

  function hide(shouldReset) {
    if (registerBoxEl) registerBoxEl.classList.add("hidden");
    if (shouldReset) resetFormState();
  }

  function close() {
    hide(true);
    if (onClose) onClose();
  }

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
      statusEl.textContent = "✅ 관측점 등록 처리 준비 중 (미구현)";
    });
    if (btnRegCancel) btnRegCancel.addEventListener("click", function() {
      close();
    });

    if (coordTypeEls && coordTypeEls.length > 0) {
      for (var i = 0; i < coordTypeEls.length; i += 1) {
        coordTypeEls[i].addEventListener("change", function() {
          renderLiveFields();
        });
      }
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
      keepPopupInViewport(false);
    });
  }

  function initialize() {
    bindEvents();
    syncDetBtns();
    renderLiveFields();
  }

  return {
    initialize,
    open,
    hide,
    close,
    reset: resetFormState,
    isHeadingLocked: getHeadingLockState,
    getLockedHeading,
    updateLiveData
  };
};
