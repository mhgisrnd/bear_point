(function (root) {
  "use strict";
  function mount(panel, dialog) {
    const toggle = panel.querySelector('.app-settings-notification-enabled');
    const message = panel.querySelector('.app-settings-notification-message');
    const system = panel.querySelector('.app-settings-notification-system');
    const native = !!root.Capacitor?.isNativePlatform?.();
    const plugin = native ? root.Capacitor.Plugins?.BearPush : null;
    let busy = false, state;
    const supported = !!plugin?.getNotificationSettings && !!plugin?.setNotificationsEnabled;
    function paint() {
      toggle.disabled = busy || !supported;
      toggle.checked = !!(state?.enabled && state?.permissionGranted);
      system.hidden = !supported || state?.permissionGranted !== false;
      system.disabled = busy;
    }
    async function refresh() {
      if (!supported || busy) return;
      try {
        state = await plugin.getNotificationSettings();
        message.textContent = !state.permissionGranted ? '휴대폰에서 알림이 차단되어 있습니다. ON을 눌러 권한을 허용해주세요.'
          : state.enabled ? '개체 추적 공유 알림을 받습니다.' : '개체 추적 공유 알림을 받지 않습니다.';
      } catch (error) { message.textContent = error.message; }
      paint();
    }
    async function register() {
      const result = await root.BearPushRegistrationStatus?.retry?.();
      if (result?.message) message.textContent = result.message;
    }
    async function enableWithPermission() {
      let settings = await plugin.getNotificationSettings();
      if (!settings.permissionGranted) {
        message.textContent = '공유 알림을 받으려면 휴대폰의 알림 허용이 필요합니다.';
        const permission = await plugin.requestNotificationPermission();
        if (!permission.permissionGranted && permission.needsSettings) {
          const options = { title: '알림 허용 필요', message: '휴대폰 설정에서 이 앱의 알림을 허용해주세요.', confirmText: '설정 열기', cancelText: '나중에' };
          const accepted = root.__bpShowConfirmDialog ? await root.__bpShowConfirmDialog(options) : root.confirm(options.message);
          if (accepted) await plugin.openNotificationSettings();
        }
        settings = await plugin.getNotificationSettings();
      }
      if (settings.permissionGranted) {
        await plugin.setNotificationsEnabled({enabled: true});
        await register();
      } else message.textContent = '휴대폰에서 알림을 허용한 후 ON으로 설정해주세요.';
    }
    toggle.addEventListener('change', async () => {
      if (busy) return;
      const enabled = toggle.checked;
      busy = true; paint();
      let errorMessage;
      try {
        if (enabled) await enableWithPermission();
        else {
          try { await plugin.setNotificationsEnabled({enabled: false}); }
          finally { await register(); }
        }
      } catch (error) { errorMessage = error.message; }
      finally {
        busy = false; await refresh();
        if (errorMessage) message.textContent = errorMessage;
      }
    });
    system.addEventListener('click', async () => {
      if (busy) return;
      busy = true; paint();
      let errorMessage;
      try {
        await plugin.openNotificationSettings();
        if ((await plugin.getNotificationSettings()).permissionGranted) {
          await plugin.setNotificationsEnabled({enabled: true});
          await register();
        }
      }
      catch (error) { errorMessage = error.message; }
      finally { busy = false; await refresh(); if (errorMessage) message.textContent = errorMessage; }
    });
    root.document.addEventListener('visibilitychange', () => { if (!root.document.hidden) void refresh(); });
    if (typeof root.MutationObserver === 'function') new root.MutationObserver(() => { if (dialog.open) void refresh(); }).observe(dialog, {attributes: true, attributeFilter: ['open']});
    if (!supported) message.textContent = native ? '알림 설정을 사용하려면 앱을 최신 버전으로 업데이트해주세요.' : '공유 알림 수신 설정은 Android 앱에서 사용할 수 있습니다.';
    async function initialize() {
      if (!supported || !plugin.initializeNotifications) { await refresh(); return; }
      busy = true; paint();
      let errorMessage;
      try {
        if (root.BearStartupReady) await root.BearStartupReady;
        state = await plugin.initializeNotifications();
        await register();
      } catch (error) { errorMessage = error.message; }
      finally { busy = false; await refresh(); if (errorMessage) message.textContent = errorMessage; }
    }
    paint(); const ready = initialize();
    return {refresh, ready};
  }
  root.BearNotificationSettings = {mount};
})(window);
