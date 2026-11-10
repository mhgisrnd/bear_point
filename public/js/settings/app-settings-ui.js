(function () {
  "use strict";
  const store = window.BearAppSettingsStore.createStore(window);
  const trigger = document.getElementById("btn-app-settings");
  const dialog = document.createElement("dialog");
  dialog.className = "app-settings-dialog app-settings-dialog--tabs";
  dialog.setAttribute("aria-labelledby", "app-settings-title");
  dialog.innerHTML = `<div class="app-settings-head"><h2 id="app-settings-title">설정</h2><button type="button" class="app-settings-close" aria-label="설정 닫기">×</button></div>
    <div class="app-settings-tabs" role="tablist" aria-label="설정 메뉴">
      <button type="button" class="app-settings-tab" id="app-settings-profile-tab" role="tab" aria-selected="true" aria-controls="app-settings-profile-panel" tabindex="0">담당자·팀</button>
      <button type="button" class="app-settings-tab" id="app-settings-tracking-tab" role="tab" aria-selected="false" aria-controls="app-settings-tracking-panel" tabindex="-1">이동 기록</button>
      <button type="button" class="app-settings-tab" id="app-settings-version-tab" role="tab" aria-selected="false" aria-controls="app-settings-version-panel" tabindex="-1">앱 버전</button>
    </div>
    <div class="app-settings-scroll"><section id="app-settings-profile-panel" role="tabpanel" aria-labelledby="app-settings-profile-tab">
    <form class="app-settings-form"><div class="app-settings-body app-settings-fields"><p class="app-settings-intro">담당자 이름과 소속 팀을 설정해주세요.</p>
      <label class="app-settings-field">담당자<input name="owner" required maxlength="100" autocomplete="name" placeholder="이름을 입력해주세요" /></label>
      <fieldset class="app-settings-teams"><legend>소속 팀</legend><div class="app-settings-team-grid"></div></fieldset>
      <div class="app-settings-catalog-row"><p class="app-settings-catalog-note"></p><button type="button" class="app-settings-refresh">새로고침</button></div>
      <p class="app-settings-status" role="status" aria-live="polite"></p>
    <section class="app-settings-push" aria-label="개체 추적 공유 알림" hidden>
      <strong>개체 추적 공유 알림</strong>
      <div class="app-settings-catalog-row">
        <p class="app-settings-help app-settings-push-status" role="status" aria-live="polite"></p>
        <button type="button" class="app-settings-refresh app-settings-push-retry">다시 확인</button>
      </div>
    </section></div>
      <div class="app-settings-actions app-settings-footer"><button type="submit" class="app-settings-save">저장하고 시작</button><button type="button" class="app-settings-cancel">취소</button></div>
    </form></section>
    <section id="app-settings-tracking-panel" role="tabpanel" aria-labelledby="app-settings-tracking-tab" hidden>
      <form class="app-settings-form app-settings-tracking-form"><div class="app-settings-body app-settings-fields">
        <p class="app-settings-intro">기록 간격은 저장하면 진행 중인 기록에도 적용됩니다. 경로는 팀 색상으로 표시됩니다.</p>
        <label class="app-settings-field">기록 간격<select name="interval"><option value="5">5초</option><option value="10">10초</option><option value="30">30초</option><option value="60">1분</option></select></label>
        <p class="app-settings-help">GPS 수신 상태에 따라 실제 기록 간격은 길어질 수 있습니다.</p>
        <p class="app-settings-help">앱은 화면이 꺼져도 기록하며, 알림에서 종료·저장할 수 있습니다. 웹에서는 페이지가 열려 있을 때 기록합니다.</p>
        <p class="app-settings-tracking-status" role="status" aria-live="polite"></p>
        </div><div class="app-settings-actions app-settings-footer"><button type="submit" class="app-settings-save">저장</button><button type="button" class="app-settings-cancel">취소</button></div>
      </form>
    </section><section id="app-settings-version-panel" role="tabpanel" aria-labelledby="app-settings-version-tab" hidden></section></div>`;
  document.body.append(dialog);
  window.BearAppUpdates?.mount(dialog.querySelector('#app-settings-version-panel'));
  const pushRegistration = window.BearPushRegistrationStatus;
  if (pushRegistration) {
    const pushSection = dialog.querySelector(".app-settings-push");
    const pushMessage = pushSection.querySelector(".app-settings-push-status");
    const pushRetry = pushSection.querySelector(".app-settings-push-retry");
    pushSection.hidden = false;
    function paintPushRegistration() {
      const status = pushRegistration.snapshot();
      pushMessage.textContent = status.message;
      pushRetry.disabled = status.busy || !pushRegistration.retry;
    }
    paintPushRegistration();
    window.addEventListener("bearpoint:push-registration-changed", paintPushRegistration);
    pushRetry.addEventListener("click", () => { void pushRegistration.retry?.(); });
  }
  const tabs = [...dialog.querySelectorAll('[role="tab"]')];
  function selectTab(tab, focus = false) {
    if (tab.disabled) return;
    tabs.forEach(item => {
      const active = item === tab;
      item.setAttribute("aria-selected", String(active));
      item.tabIndex = active ? 0 : -1;
      dialog.querySelector("#" + item.getAttribute("aria-controls")).hidden = !active;
    });
    const fields = dialog.querySelector("#" + tab.getAttribute("aria-controls") + " .app-settings-fields");
    if (fields) fields.scrollTop = 0;
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab));
    tab.addEventListener("keydown", event => {
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;
      event.preventDefault();
      if (!tabs[next].disabled) selectTab(tabs[next], true);
    });
  });
  const form = dialog.querySelector("form"), grid = dialog.querySelector(".app-settings-team-grid");
  const message = dialog.querySelector(".app-settings-status"), note = dialog.querySelector(".app-settings-catalog-note");
  const refreshButton = dialog.querySelector(".app-settings-refresh"), saveButton = dialog.querySelector(".app-settings-save");
  const closeButtons = [...dialog.querySelectorAll(".app-settings-close,.app-settings-cancel")];
  const trackingForm = dialog.querySelector(".app-settings-tracking-form");
  const trackingMessage = dialog.querySelector(".app-settings-tracking-status");
  function paintTracking() {
    const options = store.snapshot().tracking;
    trackingForm.elements.interval.value = String(options.interval_seconds);
    trackingMessage.textContent = "";
    tabs[1].disabled = !loaded;
  }
  let loaded = false, required = true, saving = false, refreshing = false, selection = "", closing = false, deferred = false;
  function paintCloseButtons() {
    closeButtons.forEach(button => { button.hidden = required && !button.classList.contains("app-settings-close"); });
  }
  function paintTeams() {
    const state = store.snapshot();
    grid.replaceChildren(...state.items.map(team => {
      const label = document.createElement("label"); label.className = "app-settings-team"; label.style.setProperty("--team-color", team.color);
      const input = document.createElement("input"); input.type = "radio"; input.name = "team"; input.value = team.id; input.required = true; input.checked = selection === team.id;
      const dot = document.createElement("i"); dot.className = "app-settings-team-dot"; dot.setAttribute("aria-hidden", "true");
      const name = document.createElement("span"); name.textContent = team.name;
      label.append(input, dot, name); return label;
    }));
    note.textContent = state.source === "builtin" ? "기본 팀 목록" : state.source === "server" ? "최신 팀 목록" : "이 기기에 보관된 팀 목록";
    if (!state.items.length) message.textContent = "현재 선택할 수 있는 팀이 없습니다. 관리자에게 확인해주세요.";
    else if (selection && !state.items.some(team => team.id === selection)) message.textContent = "이전에 선택한 팀이 사용 중지되었거나 목록에서 제외되었습니다. 팀을 다시 선택해주세요.";
    saveButton.disabled = !loaded || saving || !state.items.length;
  }
  async function close() {
    if (saving || closing || !dialog.open) return false;
    closing = true;
    try {
      if (required) {
        const options = { title: "시작 설정", message: "담당자와 소속 팀을 나중에 설정하시겠습니까?", detail: "관측점 등록 시 담당자를 입력하고 팀을 선택할 수 있습니다.", confirmText: "나중에 설정", cancelText: "계속 설정" };
        const accepted = window.__bpShowConfirmDialog ? await window.__bpShowConfirmDialog(options) : window.confirm(options.message);
        if (!accepted) return false;
        deferred = true;
      }
      dialog.close(); trigger.focus(); return true;
    } finally { closing = false; }
  }
  async function open() {
    if (window.BearStartupReady) await window.BearStartupReady;
    if (dialog.open) return;
    message.textContent = "";
    required = !store.snapshot().profile;
    paintCloseButtons();
    dialog.querySelector("h2").textContent = required ? "시작 설정" : "설정";
    selectTab(tabs[0]);
    saveButton.textContent = required ? "저장하고 시작" : "저장";
    const profile = store.snapshot().profile;
    form.elements.owner.value = profile?.owner || "";
    selection = profile?.team_id || "";
    paintTeams();
    paintTracking();
    dialog.showModal();
    if (!loaded) await initialize();
    else void refresh();
  }
  async function refresh() {
    if (refreshing || saving) return;
    if (!loaded) { await initialize(); return; }
    refreshing = true; refreshButton.disabled = true; message.textContent = ""; paintTeams();
    try { await store.refresh(); window.dispatchEvent(new Event("bearpoint:teams-changed")); }
    catch (_) { message.textContent = "팀 목록을 갱신하지 못했습니다. 보관된 목록으로 설정할 수 있습니다."; }
    finally { refreshing = false; refreshButton.disabled = saving; if (!saving) paintTeams(); }
  }
  async function initialize() {
    try {
      await store.load(); loaded = true;
      refreshButton.textContent = "새로고침";
      const state = store.snapshot();
      required = !state.profile;
      paintTracking();
      paintCloseButtons();
      dialog.querySelector("h2").textContent = required ? "시작 설정" : "설정";
      saveButton.textContent = required ? "저장하고 시작" : "저장";
      trigger.dataset.required = String(!state.profile);
      trigger.title = state.profile ? `${state.profile.owner} · ${state.profile.team_name} 설정` : "담당자·팀 설정";
      if (state.profile) window.dispatchEvent(new CustomEvent("bearpoint:profile-changed", { detail: state.profile }));
      if (!state.profile) {
        if (!dialog.open && !deferred) await open();
        else paintTeams();
      } else if (dialog.open) {
        required = false; paintCloseButtons();
        form.elements.owner.value = state.profile.owner; selection = state.profile.team_id; paintTeams();
      }
      // Network refresh never delays reading the local profile or opening the app.
      void refresh();
    } catch (error) {
      loaded = false; trigger.dataset.required = "true";
      if (window.BearStartupReady) await window.BearStartupReady;
      required = true; paintCloseButtons();
      if (!dialog.open && !deferred) dialog.showModal();
      saveButton.disabled = true; message.textContent = error.message;
      refreshButton.textContent = "저장소 다시 연결";
    }
  }
  form.addEventListener("change", event => { if (event.target.name === "team") selection = event.target.value; });
  trackingForm.addEventListener("submit", async event => {
    event.preventDefault(); if (!loaded || saving) return;
    saving = true; const button = trackingForm.querySelector('[type="submit"]'); button.disabled = true;
    let saved = false;
    try {
      const next = await store.saveTracking({ interval_seconds: trackingForm.elements.interval.value });
      saved = true;
      await window.BearGpsTrackUi?.updateInterval(next.interval_seconds);
      dialog.close(); trigger.focus();
    } catch (error) { trackingMessage.textContent = (saved ? "기본 설정은 저장했지만 현재 기록에 간격을 적용하지 못했습니다. 다시 저장해주세요. " : "설정을 저장하지 못했습니다. ") + error.message; }
    finally { saving = false; button.disabled = false; }
  });
  form.addEventListener("submit", async event => {
    event.preventDefault(); if (!loaded || saving) return;
    saving = true; saveButton.disabled = true; refreshButton.disabled = true; message.textContent = "저장 중…";
    form.querySelectorAll("input").forEach(input => { input.disabled = true; });
    try {
      const profile = await store.save(form.elements.owner.value, selection);
      required = false; trigger.dataset.required = "false"; trigger.title = `${profile.owner} · ${profile.team_name} 설정`;
      window.dispatchEvent(new CustomEvent("bearpoint:profile-changed", { detail: profile }));
      dialog.close(); trigger.focus();
    } catch (error) { message.textContent = "설정을 저장하지 못했습니다. " + error.message; }
    finally { saving = false; refreshButton.disabled = false; form.querySelectorAll("input").forEach(input => { input.disabled = false; }); paintTeams(); }
  });
  closeButtons.forEach(button => button.addEventListener("click", close));
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  trigger.addEventListener("click", open);
  refreshButton.addEventListener("click", refresh);
  window.addEventListener("online", () => { if (dialog.open) void refresh(); });
  window.BearAppSettings = { store, open, close, isOpen: () => dialog.open, getProfile: () => store.snapshot().profile,
    requireIdentity: async () => { try { return await store.identity(); } catch (error) { void open(); throw error; } } };
  void initialize();
})();
