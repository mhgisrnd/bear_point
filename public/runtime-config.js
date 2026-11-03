(function (window) {
  "use strict";

  window.BEAR_RUNTIME_CONFIG = Object.freeze({
    env: "dev",
    realtimeApiBase: "https://bearmap.duckdns.org/api/realtime",
    movementApiUrl: "https://bearmap.duckdns.org/api/realtime/movement-tracks"
  });

  window.BEAR_API_BASE = window.BEAR_RUNTIME_CONFIG.realtimeApiBase;
})(window);
