(function () {
  "use strict";
  const trigger = document.getElementById("btn-sdr-diagnostics");
  if (!trigger) return;
  const dialog = document.createElement("dialog");
  dialog.className = "sdr-dialog";
  dialog.setAttribute("aria-labelledby", "sdr-title");
  dialog.innerHTML = `
    <div class="sdr-header"><h2 id="sdr-title">SDR USB 연결 확인</h2><button type="button" data-close>닫기</button></div>
    <p class="sdr-note">수신기를 이 휴대폰·태블릿의 OTG 어댑터 또는 USB 허브에 연결하세요.</p>
    <p class="sdr-status" role="status">연결 상태 확인 전</p>
    <div class="sdr-actions"><button type="button" data-refresh>장치 새로고침</button><button type="button" data-disconnect>연결 해제 / 요청 취소</button></div>
    <p class="sdr-message" role="alert"></p>
    <div data-devices></div>
    <p class="sdr-note">현재는 USB 접근만 확인합니다. 튜너 식별·신호 수신·수신음 재생은 아직 지원하지 않습니다. 창을 닫으면 진단 연결도 해제됩니다.</p>`;
  document.body.appendChild(dialog);
  const status = dialog.querySelector(".sdr-status");
  const message = dialog.querySelector(".sdr-message");
  const list = dialog.querySelector("[data-devices]");
  const refreshButton = dialog.querySelector("[data-refresh]");
  const disconnectButton = dialog.querySelector("[data-disconnect]");
  let plugin = null;
  let busy = false;
  let current = null;
  let listener = null;
  let sequence = 0;

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
    current = snapshot;
    const names = { unsupported: "이 기기는 USB Host를 지원하지 않습니다.", permissionPending: "USB 권한 승인 대기 중", connected: "USB 연결 확인 완료 · RF 수신 미검증", idle: "장치를 선택해 USB 접근을 확인하세요." };
    status.textContent = names[snapshot.state] || "상태 확인 필요";
    list.replaceChildren();
    const devices = snapshot.devices || [];
    if (!devices.length) {
      const empty = document.createElement("p");
      empty.textContent = "연결된 USB 장치가 없습니다. OTG 연결과 전원을 확인하세요.";
      list.appendChild(empty);
    }
    devices.forEach(function (device) {
      const card = document.createElement("div");
      card.className = "sdr-device";
      const title = document.createElement("strong");
      title.textContent = device.name;
      const detail = document.createElement("small");
      const hex = value => Number(value).toString(16).toUpperCase().padStart(4, "0");
      detail.textContent = `VID ${hex(device.vendorId)} / PID ${hex(device.productId)} · ${device.candidate ? "RTL-SDR 후보 · 튜너 미확인" : "현재 지원 목록에 없는 장치"} · ${device.hasPermission ? "권한 있음" : "권한 없음"}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sdr-primary";
      button.textContent = device.connected ? "USB 연결 확인됨" : device.hasPermission ? "USB 연결 확인" : "USB 권한 요청";
      button.disabled = busy || snapshot.state === "permissionPending" || device.connected || !device.candidate || !snapshot.hostSupported;
      button.addEventListener("click", () => run(async () => {
        if (!device.hasPermission) {
          await plugin.requestDevicePermission({ deviceId: device.deviceId });
          return "USB 권한을 받았습니다. ‘USB 연결 확인’을 눌러주세요.";
        }
        await plugin.openDevice({ deviceId: device.deviceId });
        return "USB 연결을 열었습니다. 실제 RF 수신은 다음 단계에서 확인합니다.";
      }));
      card.append(title, detail, button);
      list.appendChild(card);
    });
    refreshButton.disabled = busy;
    disconnectButton.disabled = !busy && snapshot.state !== "connected" && snapshot.state !== "permissionPending";
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
    try { message.textContent = (await action()) || ""; }
    catch (error) { message.textContent = error.message || String(error); }
    finally {
      busy = false;
      try { await refresh(); } catch (error) { message.textContent = error.message || String(error); }
    }
  }

  trigger.addEventListener("click", async function () {
    if (dialog.open) return;
    dialog.showModal();
    message.textContent = "";
    status.textContent = "USB 연결 상태 확인 중…";
    refreshButton.disabled = true;
    disconnectButton.disabled = true;
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
  // This action must remain available while a permission call is outstanding.
  disconnectButton.addEventListener("click", async function () {
    try { await plugin.closeDevice(); message.textContent = "USB 진단 연결을 해제했습니다."; await refresh(); }
    catch (error) { message.textContent = error.message || String(error); }
  });
  dialog.querySelector("[data-close]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", async function () {
    if (!plugin) return;
    try { await plugin.closeDevice(); } catch (error) { console.warn("SDR close:", error); }
  });
})();
