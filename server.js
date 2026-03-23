// server.js
const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: true, credentials: true } });

const PORT = process.env.PORT || 3000;

// ✅ 곰 최신값: 처음엔 없음
let latest = null;

// ✅ 서버 위치: 처음엔 없음
let serverPos = { lat: null, lng: null, ts: null };

// ✅ (추가) ngrok 브라우저 경고 페이지 스킵 헤더
app.use((req, res, next) => {
  res.setHeader("ngrok-skip-browser-warning", "true");
  next();
});

app.use(express.static(path.join(__dirname, "public")));

app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pages", "login.html"));
});

app.get("/admin/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "pages", "admin-login.html"));
});

// ✅ 곰 위치는 요청할 때만 가져가게 API로만 제공
app.get("/api/latest", (req, res) => res.json(latest ?? {}));
app.get("/api/serverpos", (req, res) => res.json(serverPos));

io.on("connection", (socket) => {
  console.log("[socket] connected:", socket.id);

  // ✅ 초기 접속 시 곰 위치 push 안 함
  // socket.emit("rx_update", latest);  <-- 제거

  // 서버 위치는 참고용으로만 (필요하면 유지)
  socket.emit("server_pos", serverPos);

  socket.on("server_pos_update", (pos) => {
    if (!pos || typeof pos.lat !== "number" || typeof pos.lng !== "number") return;
    serverPos = { lat: pos.lat, lng: pos.lng, ts: Date.now() };
    io.emit("server_pos", serverPos);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running: http://localhost:${PORT}`);
});