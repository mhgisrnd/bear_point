const crypto = require("crypto");

// 관리자 로그인 세션을 메모리와 서명 쿠키로 관리한다.
function createAdminSessionStore(options = {}) {
  const sessions = new Map();
  const cookieName = options.cookieName || "admin_session";
  const ttlMs = Number(options.ttlMs || 8 * 60 * 60 * 1000); //로그인 세션 만료시간(8시간)
  const secret = options.secret || process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET || "bear_point_admin_session_secret";

  // 무작위 세션 ID를 생성한다.
  function createSessionId() {
    return crypto.randomBytes(32).toString("hex");
  }

  // 세션 ID를 HMAC으로 서명해 쿠키 위변조를 막는다.
  function signSessionId(sessionId) {
    return crypto.createHmac("sha256", secret).update(sessionId).digest("hex");
  }

  // 세션 쿠키 값을 생성한다.
  function createCookieValue(sessionId) {
    return `${sessionId}.${signSessionId(sessionId)}`;
  }

  // 쿠키의 세션 값을 검증하고 세션 ID를 복원한다.
  function verifyCookieValue(cookieValue) {
    const rawValue = String(cookieValue || "").trim();
    const [sessionId, signature] = rawValue.split(".");

    if (!sessionId || !signature) {
      return null;
    }

    if (!/^[0-9a-f]{64}$/i.test(sessionId) || !/^[0-9a-f]{64}$/i.test(signature)) {
      return null;
    }

    const expectedSignature = signSessionId(sessionId);
    const expectedBuffer = Buffer.from(expectedSignature, "hex");
    const providedBuffer = Buffer.from(signature, "hex");

    if (expectedBuffer.length !== providedBuffer.length) {
      return null;
    }

    if (!crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
      return null;
    }

    return sessionId;
  }

  // 현재 시각을 기준으로 만료 여부를 판단한다.
  function isExpired(sessionRecord) {
    return !sessionRecord || sessionRecord.expiresAt <= Date.now();
  }

  // 로그인 성공 시 새 세션을 생성한다.
  function createSession(adminAccount) {
    const sessionId = createSessionId();
    const expiresAt = Date.now() + ttlMs;

    sessions.set(sessionId, {
      adminAccount,
      createdAt: Date.now(),
      expiresAt,
    });

    return {
      cookieValue: createCookieValue(sessionId),
      expiresAt,
    };
  }

  // 요청 쿠키에서 로그인 세션을 조회한다.
  function getSessionFromRequest(req) {
    const cookieHeader = String(req?.headers?.cookie || "");
    const cookieValue = parseCookieHeader(cookieHeader, cookieName);
    const sessionId = verifyCookieValue(cookieValue);

    if (!sessionId) {
      return null;
    }

    const sessionRecord = sessions.get(sessionId);

    if (isExpired(sessionRecord)) {
      sessions.delete(sessionId);
      return null;
    }

    return {
      sessionId,
      expiresAt: sessionRecord.expiresAt,
      adminAccount: sessionRecord.adminAccount,
    };
  }

  // 로그인 세션을 삭제한다.
  function destroySession(cookieValue) {
    const sessionId = verifyCookieValue(cookieValue);

    if (!sessionId) {
      return false;
    }

    return sessions.delete(sessionId);
  }

  // 응답에 넣을 세션 쿠키 문자열을 만든다.
  function buildCookieHeader(cookieValue) {
    const maxAgeSeconds = Math.max(Math.floor(ttlMs / 1000), 1);
    const shouldUseSecureCookie = process.env.ADMIN_SESSION_SECURE === "true" || process.env.NODE_ENV === "production";
    const cookieParts = [
      `${cookieName}=${encodeURIComponent(cookieValue)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${maxAgeSeconds}`,
    ];

    if (shouldUseSecureCookie) {
      cookieParts.push("Secure");
    }

    return cookieParts.join("; ");
  }

  // 로그아웃 응답용 쿠키 삭제 문자열을 만든다.
  function buildClearCookieHeader() {
    return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  return {
    cookieName,
    ttlMs,
    createSession,
    getSessionFromRequest,
    destroySession,
    buildCookieHeader,
    buildClearCookieHeader,
  };
}

// 요청 헤더에서 지정한 쿠키를 읽는다.
function parseCookieHeader(cookieHeader, cookieName) {
  const cookiePairs = String(cookieHeader || "").split(";");

  for (const pair of cookiePairs) {
    const [rawName, ...rest] = pair.trim().split("=");

    if (!rawName || rest.length === 0) {
      continue;
    }

    if (rawName === cookieName) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return "";
}

module.exports = {
  createAdminSessionStore,
};