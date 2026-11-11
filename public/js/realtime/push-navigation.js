(function (root) {
  "use strict";
  function start({plugin, ready, open, onError}) {
    if (!plugin?.consumeNotificationOpen || !plugin?.addListener) return Promise.resolve();
    let version = 0;
    async function consume() {
      try {
        const {serverId} = await plugin.consumeNotificationOpen();
        if (!/^[1-9][0-9]{0,18}$/.test(String(serverId || ''))) return;
        const current = ++version;
        const isCurrent = () => current === version;
        await ready;
        if (isCurrent()) await open(String(serverId), isCurrent);
      } catch (error) { onError?.(error); }
    }
    // Register first so a tap during cold-start setup cannot get lost.
    return Promise.resolve(plugin.addListener('notificationOpened', consume)).then(consume).catch(error => onError?.(error));
  }
  root.BearPushNavigation = {start};
})(window);
