const { createHash } = require("node:crypto");
const { createRemoteJWKSet, jwtVerify } = require("jose");
const { pgQuery, pgTransaction } = require("../db/postgres");

const appCheckIssuer = "https://firebaseappcheck.googleapis.com/";
const appCheckKeys = createRemoteJWKSet(new URL(appCheckIssuer + "v1/jwks"));
const channelId = "bear_tracking_updates";
const installationPattern = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const tokenPattern = /^[\w:-]{20,4096}$/;

function pushEnabled() {
  return Boolean(process.env.FCM_PROJECT_ID);
}

function credentialDigest(authorization) {
  const code = /^Bearer ([a-f0-9]{64})$/i.exec(authorization || "")?.[1];
  return code ? createHash("sha256").update(code.toLowerCase()).digest("hex") : null;
}

async function verifiesAppCheck(token) {
  const project = process.env.BEAR_PUSH_APP_CHECK_PROJECT_NUMBER;
  const appId = process.env.BEAR_PUSH_APP_CHECK_APP_ID;
  if (!project || !appId || typeof token !== "string" || !token || token.length > 8192) return false;
  try {
    await jwtVerify(token, appCheckKeys, {
      algorithms: ["RS256"],
      typ: "JWT",
      issuer: appCheckIssuer + project,
      audience: "projects/" + project,
      subject: appId,
      requiredClaims: ["exp"],
    });
    return true;
  } catch (_) {
    return false;
  }
}

function formatEstimateNotification(item) {
  const text = (value, limit) => typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, limit) : "";
  const code = text(item.bear_code, 40);
  const owner = text(item.owner, 60);
  const team = text(item.payload?.team_name, 60);
  const author = [team, owner].filter(Boolean).join(" ");
  return {
    title: code && code !== "-" ? `개체 추적 등록 · ${code}` : "개체 추적 등록",
    body: author ? `${author} 담당자가 위치를 공유했습니다.` : "새 위치를 공유했습니다.",
  };
}

let schemaReady;
function preparePushSchema() {
  if (!schemaReady) {
    schemaReady = pgQuery(`
      CREATE TABLE IF NOT EXISTS public.bear_push_devices (
        installation_id UUID PRIMARY KEY,
        token TEXT,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS public.bear_push_credentials (
        digest CHAR(64) PRIMARY KEY,
        installation_id UUID UNIQUE,
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
      );
      ALTER TABLE public.bear_push_credentials
        ADD COLUMN IF NOT EXISTS app_check_verified BOOLEAN NOT NULL DEFAULT FALSE;
      CREATE TABLE IF NOT EXISTS public.bear_push_outbox (
        estimate_id TEXT NOT NULL,
        installation_id UUID NOT NULL REFERENCES public.bear_push_devices(installation_id),
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour',
        attempts INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (estimate_id, installation_id)
      );
      CREATE INDEX IF NOT EXISTS bear_push_outbox_due ON public.bear_push_outbox (next_attempt_at);
    `).catch(error => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function registerPushDevice(installationId, token, authorization, appCheckToken) {
  const digest = credentialDigest(authorization);
  if (!digest || !(await verifiesAppCheck(appCheckToken))) {
    throw Object.assign(new Error("기기 인증이 필요합니다."), { statusCode: 401 });
  }
  if (typeof installationId !== "string" || !installationPattern.test(installationId)
      || (token !== null && (typeof token !== "string" || !tokenPattern.test(token)))) {
    throw Object.assign(new Error("알림 기기 등록 정보가 올바르지 않습니다."), { statusCode: 400 });
  }
  await preparePushSchema();
  await pgTransaction(async query => {
    await query("SELECT pg_advisory_xact_lock(hashtext('bear_push_device'), hashtext($1::uuid::text))", [installationId]);
    const { rowCount } = await query(`
      INSERT INTO public.bear_push_credentials AS credential (digest, installation_id, app_check_verified)
      SELECT $1, $2, TRUE
      WHERE NOT EXISTS (SELECT 1 FROM public.bear_push_credentials WHERE installation_id = $2 AND digest <> $1)
      ON CONFLICT (digest) DO UPDATE SET app_check_verified = TRUE, installation_id = EXCLUDED.installation_id
      WHERE credential.installation_id IS NULL OR credential.installation_id = EXCLUDED.installation_id
    `, [digest, installationId]);
    if (!rowCount) throw Object.assign(new Error("이 기기의 인증 정보가 일치하지 않습니다."), { statusCode: 401 });
    await query(`
      INSERT INTO public.bear_push_devices (installation_id, token) VALUES ($1, $2)
      ON CONFLICT (installation_id) DO UPDATE SET token = EXCLUDED.token, updated_at = NOW()
    `, [installationId, token]);
  });
}

async function authenticatedPushSender(installationId, authorization) {
  const digest = credentialDigest(authorization);
  if (!digest || typeof installationId !== "string" || !installationPattern.test(installationId)) return null;
  await preparePushSchema();
  const { rows } = await pgQuery("SELECT installation_id FROM public.bear_push_credentials WHERE digest = $1 AND installation_id = $2 AND app_check_verified", [digest, installationId]);
  return rows[0]?.installation_id || null;
}

async function enqueueEstimatePush(query, item, senderInstallationId) {
  const { title, body } = formatEstimateNotification(item);
  await query(`
    INSERT INTO public.bear_push_outbox (estimate_id, installation_id, title, body)
    SELECT $1, recipient.installation_id, $2, $3
    FROM (
      SELECT DISTINCT ON (token) installation_id
      FROM public.bear_push_devices
      WHERE token IS NOT NULL AND updated_at > NOW() - INTERVAL '60 days'
        AND EXISTS (SELECT 1 FROM public.bear_push_credentials AS credential WHERE credential.installation_id = bear_push_devices.installation_id AND credential.app_check_verified)
        AND installation_id::text IS DISTINCT FROM $4
        AND token IS DISTINCT FROM (SELECT token FROM public.bear_push_devices WHERE installation_id::text = $4)
      ORDER BY token, updated_at DESC
    ) recipient
    ON CONFLICT DO NOTHING
  `, [String(item.id), title, body, typeof senderInstallationId === "string" ? senderInstallationId.toLowerCase() : null]);
}

function startPushWorker() {
  if (!pushEnabled()) return;
  const { GoogleAuth } = require("google-auth-library");
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/firebase.messaging"] });
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(process.env.FCM_PROJECT_ID)}/messages:send`;
  let running = false;

  async function deliver(row) {
    let retryDelay = 0;
    try {
      if (row.token) {
        const client = await auth.getClient();
        await client.request({
          url,
          method: "POST",
          timeout: 15000,
          retry: false,
          data: { message: {
            token: row.token,
            notification: { title: row.title, body: row.body },
            android: { ttl: "3600s", notification: { channel_id: channelId, tag: `bear-estimate-${row.estimate_id}`, visibility: "PRIVATE" } },
          } },
        });
      }
    } catch (error) {
      const response = error.response;
      const details = response?.data?.error?.details;
      const unregistered = Array.isArray(details) && details.some(detail => detail.errorCode === "UNREGISTERED");
      if (unregistered) {
        await pgQuery("UPDATE public.bear_push_devices SET token = NULL WHERE installation_id = $1 AND token = $2", [row.installation_id, row.token]);
      } else {
        if (!response?.status || [401, 403, 429].includes(response.status) || response.status >= 500) {
          const retryAfter = response?.headers?.get?.("retry-after");
          const seconds = Number(retryAfter) || (Date.parse(retryAfter) - Date.now()) / 1000 || 0;
          retryDelay = Math.max(seconds, Math.min(900, 60 * 2 ** Math.min(row.attempts - 1, 4)));
        }
        console.warn("[bear-push] FCM send failed", response?.status || "network");
      }
    }
    if (retryDelay) {
      await pgQuery(`
        UPDATE public.bear_push_outbox
        SET next_attempt_at = NOW() + $4::double precision * INTERVAL '1 second'
        WHERE estimate_id = $1 AND installation_id = $2 AND attempts = $3
      `, [row.estimate_id, row.installation_id, row.attempts, retryDelay]);
    } else {
      await pgQuery("DELETE FROM public.bear_push_outbox WHERE estimate_id = $1 AND installation_id = $2 AND attempts = $3", [row.estimate_id, row.installation_id, row.attempts]);
    }
  }

  async function tick() {
    if (running) return;
    running = true;
    try {
      await preparePushSchema();
      await pgQuery("DELETE FROM public.bear_push_outbox WHERE expires_at <= NOW()");
      const { rows } = await pgQuery(`
        WITH due AS (
          SELECT estimate_id, installation_id
          FROM public.bear_push_outbox
          WHERE next_attempt_at <= NOW() AND expires_at > NOW()
          ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED
        )
        UPDATE public.bear_push_outbox AS outbox
        SET next_attempt_at = NOW() + INTERVAL '5 minutes', attempts = attempts + 1
        FROM due, public.bear_push_devices AS device
        WHERE outbox.estimate_id = due.estimate_id AND outbox.installation_id = due.installation_id
          AND device.installation_id = due.installation_id
        RETURNING outbox.*, CASE WHEN EXISTS (
          SELECT 1 FROM public.bear_push_credentials AS credential WHERE credential.installation_id = device.installation_id AND credential.app_check_verified
        ) THEN device.token END AS token
      `);
      await Promise.allSettled(rows.map(deliver));
    } catch (error) {
      console.warn("[bear-push] outbox processing failed", error.code || error.name);
    } finally {
      running = false;
    }
  }

  void tick();
  setInterval(tick, 5000).unref();
}

module.exports = { pushEnabled, preparePushSchema, registerPushDevice, authenticatedPushSender, enqueueEstimatePush, startPushWorker, formatEstimateNotification };
