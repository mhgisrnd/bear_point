const path = require("path");
const express = require("express");

const { createMbtilesStore } = require("./services/mbtilesStore");
const { createMbtilesRouter } = require("./routes/mbtilesRoutes");
const { createPostgresRouter } = require("./routes/postgresRoutes");
const { createRealtimeRouter } = require("./routes/realtimeRoutes");
const { createAdminAuthRouter } = require("./routes/adminAuthRoutes");
const { createAdminUserRouter } = require("./routes/adminUserRoutes");
const { createAdminSessionStore } = require("./services/adminSessionStore");
const { normalizeContextRoot } = require("./config/runtime-config");

// 앱 공통 미들웨어와 라우터를 조립해 Express 인스턴스를 생성한다.
function createApp(rootDir, options = {}) {
  const app = express();
  const contextRoot = normalizeContextRoot(options.contextRoot || "/");
  const rootRouter = express.Router();
  const mbtilesStore = createMbtilesStore(rootDir);
  const adminSessionStore = createAdminSessionStore();

  function withBase(urlPath) {
    return contextRoot === "/" ? urlPath : `${contextRoot}${urlPath}`;
  }

  function applyApiCors(req, res, next) {
    const requestOrigin = req.headers.origin;

    if (requestOrigin) {
      res.setHeader("Access-Control-Allow-Origin", requestOrigin);
      res.setHeader("Vary", "Origin");
    } else {
      res.setHeader("Access-Control-Allow-Origin", "*");
    }

    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept, Authorization");
    res.setHeader("Access-Control-Max-Age", "600");

    if (req.method === "OPTIONS") {
      return res.status(204).end();
    }

    next();
  }

  rootRouter.use((req, res, next) => {
    res.setHeader("ngrok-skip-browser-warning", "true");
    next();
  });

  rootRouter.use(express.static(path.join(rootDir, "public")));
  rootRouter.use("/node_modules", express.static(path.join(rootDir, "node_modules")));
  rootRouter.use(express.json({ limit: "1mb" }));
  rootRouter.use("/api", applyApiCors);

  // 관리자 페이지 공통 세션을 요청 단위로 읽어 둔다.
  rootRouter.use((req, res, next) => {
    req.adminSession = adminSessionStore.getSessionFromRequest(req);
    res.locals.adminSession = req.adminSession;
    next();
  });

  rootRouter.use(createMbtilesRouter(mbtilesStore));
  rootRouter.use("/api/db/postgres", createPostgresRouter());
  rootRouter.use("/api/realtime", createRealtimeRouter());
  rootRouter.use("/api/admin/auth", createAdminAuthRouter({ adminSessionStore }));
  rootRouter.use("/api/admin/users", createAdminUserRouter());

  rootRouter.get("/login", (req, res) => {
    res.sendFile(path.join(rootDir, "public", "pages", "login.html"));
  });

  rootRouter.get("/admin/login", (req, res) => {
    if (req.adminSession) {
      return res.redirect(withBase("/admin/dashboard"));
    }

    res.sendFile(path.join(rootDir, "public", "pages", "admin-login.html"));
  });

  rootRouter.get("/admin/dashboard", (req, res) => {
    if (!req.adminSession) {
      return res.redirect(withBase("/admin/login"));
    }

    res.sendFile(path.join(rootDir, "public", "pages", "admin-dashboard.html"));
  });

  rootRouter.get("/admin/tracking", (req, res) => {
    if (!req.adminSession) {
      return res.redirect(withBase("/admin/login"));
    }

    res.sendFile(path.join(rootDir, "public", "pages", "admin-tracking.html"));
  });

  rootRouter.get("/admin/users", (req, res) => {
    if (!req.adminSession) {
      return res.redirect(withBase("/admin/login"));
    }

    res.sendFile(path.join(rootDir, "public", "pages", "admin-users.html"));
  });

  if (contextRoot === "/") {
    app.use(rootRouter);
  } else {
    app.use(contextRoot, rootRouter);
  }

  return { app, mbtilesStore };
}

module.exports = {
  createApp,
};
