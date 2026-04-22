// server.js
const path = require("path");
const express = require("express");

const app = express();
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


app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Server running: http://localhost:${PORT}`);
});