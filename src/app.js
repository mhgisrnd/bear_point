const path = require("path");
const express = require("express");

const { createMbtilesStore } = require("./services/mbtilesStore");
const { createMbtilesRouter } = require("./routes/mbtilesRoutes");
const { createPostgresRouter } = require("./routes/postgresRoutes");
const { createRealtimeRouter } = require("./routes/realtimeRoutes");
const { createAdminAuthRouter } = require("./routes/adminAuthRoutes");

// 앱 공통 미들웨어와 라우터를 조립해 Express 인스턴스를 생성한다.
function createApp(rootDir) {
  const app = express();
  const mbtilesStore = createMbtilesStore(rootDir);

  app.use((req, res, next) => {
    res.setHeader("ngrok-skip-browser-warning", "true");
    next();
  });

  app.use(express.static(path.join(rootDir, "public")));
  app.use("/node_modules", express.static(path.join(rootDir, "node_modules")));
  app.use(express.json({ limit: "1mb" }));

  app.use(createMbtilesRouter(mbtilesStore));
  app.use("/api/db/postgres", createPostgresRouter());
  app.use("/api/realtime", createRealtimeRouter());
  app.use("/api/admin/auth", createAdminAuthRouter());

  app.get("/login", (req, res) => {
    res.sendFile(path.join(rootDir, "public", "pages", "login.html"));
  });

  app.get("/admin/login", (req, res) => {
    res.sendFile(path.join(rootDir, "public", "pages", "admin-login.html"));
  });

  app.get("/admin/dashboard", (req, res) => {
    res.sendFile(path.join(rootDir, "public", "pages", "admin-dashboard.html"));
  });

  return { app, mbtilesStore };
}

module.exports = {
  createApp,
};
