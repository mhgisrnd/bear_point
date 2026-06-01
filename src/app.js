const path = require("path");
const express = require("express");

const { createMbtilesStore } = require("./services/mbtilesStore");
const { createMbtilesRouter } = require("./routes/mbtilesRoutes");
const { createPostgresRouter } = require("./routes/postgresRoutes");
const { createRealtimeRouter } = require("./routes/realtimeRoutes");
const { createAdminAuthRouter } = require("./routes/adminAuthRoutes");
const { createAdminSessionStore } = require("./services/adminSessionStore");

// 앱 공통 미들웨어와 라우터를 조립해 Express 인스턴스를 생성한다.
function createApp(rootDir) {
  const app = express();
  const mbtilesStore = createMbtilesStore(rootDir);
  const adminSessionStore = createAdminSessionStore();

  app.use((req, res, next) => {
    res.setHeader("ngrok-skip-browser-warning", "true");
    next();
  });

  app.use(express.static(path.join(rootDir, "public")));
  app.use("/node_modules", express.static(path.join(rootDir, "node_modules")));
  app.use(express.json({ limit: "1mb" }));

  // 관리자 페이지 공통 세션을 요청 단위로 읽어 둔다.
  app.use((req, res, next) => {
    req.adminSession = adminSessionStore.getSessionFromRequest(req);
    res.locals.adminSession = req.adminSession;
    next();
  });

  app.use(createMbtilesRouter(mbtilesStore));
  app.use("/api/db/postgres", createPostgresRouter());
  app.use("/api/realtime", createRealtimeRouter());
  app.use("/api/admin/auth", createAdminAuthRouter({ adminSessionStore }));

  app.get("/login", (req, res) => {
    res.sendFile(path.join(rootDir, "public", "pages", "login.html"));
  });

  app.get("/admin/login", (req, res) => {
    if (req.adminSession) {
      return res.redirect("/admin/dashboard");
    }

    res.sendFile(path.join(rootDir, "public", "pages", "admin-login.html"));
  });

  app.get("/admin/dashboard", (req, res) => {
    if (!req.adminSession) {
      return res.redirect("/admin/login");
    }

    res.sendFile(path.join(rootDir, "public", "pages", "admin-dashboard.html"));
  });

  return { app, mbtilesStore };
}

module.exports = {
  createApp,
};
