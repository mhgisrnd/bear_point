const express = require("express");
const { listAdminAccounts } = require("../services/adminUserStore");

function createAdminUserRouter() {
  const router = express.Router();

  router.get("/", async (req, res) => {
    if (!req.adminSession) {
      return res.status(401).json({
        ok: false,
        message: "로그인이 필요합니다.",
      });
    }

    try {
      const result = await listAdminAccounts({
        page: req.query.page,
        pageSize: req.query.pageSize,
        q: req.query.q,
      });

      const items = Array.isArray(result.items) ? result.items : [];
      return res.json({
        ok: true,
        items,
        total: Number(result.total || items.length),
        page: Number(result.page || 1),
        pageSize: Number(result.pageSize || items.length),
      });
    } catch (error) {
      return res.status(500).json({
        ok: false,
        message: "사용자 목록 조회 실패",
        detail: error.message,
      });
    }
  });

  return router;
}

module.exports = {
  createAdminUserRouter,
};
