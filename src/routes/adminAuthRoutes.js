const express = require("express");
const bcrypt = require("bcryptjs");
const { pgQuery } = require("../db/postgres");

// 관리자 인증용 라우터를 생성한다.
function createAdminAuthRouter({ adminSessionStore } = {}) {
  const router = express.Router();

  if (!adminSessionStore) {
    throw new Error("adminSessionStore is required for admin auth routes.");
  }

  // 관리자 아이디와 비밀번호를 검증해 로그인 세션을 발급한다.
  router.post("/login", async (req, res) => {
    const adminId = String(req.body?.adminId || "").trim();
    const password = String(req.body?.adminPassword || "").trim();

    if (!adminId || !password) {
      return res.status(400).json({
        ok: false,
        message: "관리자 아이디와 비밀번호를 입력해 주세요.",
      });
    }

    try {
      const result = await pgQuery(
        `
          SELECT
            id,
            user_id,
            password,
            user_name,
            role_code,
            is_active
          FROM public.admin_accounts
          WHERE user_id = $1
          LIMIT 1
        `,
        [adminId]
      );

      const account = result.rows[0];

      if (!account || account.is_active === false) {
        return res.status(401).json({
          ok: false,
          message: "아이디 또는 비밀번호가 올바르지 않습니다.",
        });
      }

      const isPasswordValid = await bcrypt.compare(password, account.password);

      if (!isPasswordValid) {
        return res.status(401).json({
          ok: false,
          message: "아이디 또는 비밀번호가 올바르지 않습니다.",
        });
      }

      await pgQuery(
        `
          UPDATE public.admin_accounts
          SET last_login_at = NOW(), updated_at = NOW()
          WHERE id = $1
        `,
        [account.id]
      );

      const adminSession = adminSessionStore.createSession({
        id: account.id,
        userId: account.user_id,
        userName: account.user_name,
        roleCode: account.role_code,
      });

      res.setHeader("Set-Cookie", adminSessionStore.buildCookieHeader(adminSession.cookieValue));

      return res.json({
        ok: true,
        admin: {
          id: account.id,
          userId: account.user_id,
          userName: account.user_name,
          roleCode: account.role_code,
        },
      });
    } catch (error) {
      console.error("[admin-auth] login failed", error);
      return res.status(500).json({
        ok: false,
        message: "로그인 처리 중 오류가 발생했습니다.",
      });
    }
  });

  // 현재 세션의 관리자 정보를 반환한다.
  router.get("/me", (req, res) => {
    if (!req.adminSession) {
      return res.status(401).json({
        ok: false,
        message: "로그인이 필요합니다.",
      });
    }

    return res.json({
      ok: true,
      admin: req.adminSession.adminAccount,
      expiresAt: req.adminSession.expiresAt,
    });
  });

  // 로그인 세션을 삭제하고 쿠키를 만료시킨다.
  router.post("/logout", (req, res) => {
    const cookieHeader = String(req.headers?.cookie || "");
    const cookieMatch = cookieHeader.match(/(?:^|;\s*)admin_session=([^;]+)/);

    if (cookieMatch) {
      adminSessionStore.destroySession(decodeURIComponent(cookieMatch[1]));
    }

    res.setHeader("Set-Cookie", adminSessionStore.buildClearCookieHeader());

    return res.json({
      ok: true,
    });
  });

  return router;
}

module.exports = {
  createAdminAuthRouter,
};