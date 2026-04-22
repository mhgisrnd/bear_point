// public/socketIO.js
function createAppSocket({
  statusEl,
  onRxUpdate,
  onServerPos,
  pollLatestUrl = "/api/latest",
  pollMs = 5000
}) {
  const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 3000,
    transports: ["websocket", "polling"]
  });

  let pollTimer = null;

  async function pollOnce() {
    try {
      // 최신 수신좌표
      const r1 = await fetch(pollLatestUrl, { cache: "no-store" });
      const latest = await r1.json();
      if (latest && typeof latest.lat === "number" && typeof latest.lng === "number") {
        onRxUpdate?.(latest, { via: "poll" });
      }
    } catch (e) {
      // 완전 단절이면 조용히 무시
    }
  }

  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(pollOnce, pollMs);
    pollOnce();
  }

  function stopPolling() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  socket.on("connect", () => {
    statusEl && (statusEl.textContent = "🟢 연결됨");
    stopPolling();
  });

  socket.on("disconnect", (reason) => {
    statusEl && (statusEl.textContent = `🟠 끊김 (${reason}) - 폴백 모드…`);
    startPolling();
  });

  socket.on("rx_update", (data) => onRxUpdate?.(data, { via: "ws" }));
  socket.on("server_pos", (data) => onServerPos?.(data, { via: "ws" }));

  return {
    socket,
    startPolling,
    stopPolling,
    pollOnce
  };
}