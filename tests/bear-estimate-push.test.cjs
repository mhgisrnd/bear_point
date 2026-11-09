const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { generateKeyPair, SignJWT, jwtVerify } = require("jose");
const { enqueueEstimatePush, formatEstimateNotification } = require("../src/services/bearEstimatePush");

test("automatic registration requires a signed App Check token for the configured app", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  const { privateKey: otherKey } = await generateKeyPair("RS256");
  const env = {
    BEAR_PUSH_APP_CHECK_PROJECT_NUMBER: "123456",
    BEAR_PUSH_APP_CHECK_APP_ID: "1:123456:android:bear",
  };
  const claims = {
    iss: "https://firebaseappcheck.googleapis.com/123456",
    aud: ["projects/123456"],
    sub: env.BEAR_PUSH_APP_CHECK_APP_ID,
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  const signed = (overrides, key = privateKey) => new SignJWT({ ...claims, ...overrides })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" }).sign(key);
  let bindings = 0;
  const database = {
    pgQuery: async () => ({}),
    pgTransaction: work => work(async (sql) => {
      if (sql.includes("INSERT INTO public.bear_push_credentials")) bindings++;
      return { rowCount: 1 };
    }),
  };
  const context = {
    module: { exports: {} }, URL, process: { env },
    require: name => name === "jose" ? { createRemoteJWKSet: () => publicKey, jwtVerify }
      : name === "../db/postgres" ? database : require(name),
  };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/services/bearEstimatePush"), "utf8"), context);
  const { registerPushDevice } = context.module.exports;
  const installationId = "ab128ce8-a00c-4e0f-8dd2-f3618355d023";
  const authorization = "Bearer " + "a".repeat(64);
  for (const token of [undefined, await signed({ sub: "another-app" }), await signed({ aud: "projects/other" }),
    await signed({ exp: 1 }), await signed({}, otherKey)]) {
    await assert.rejects(registerPushDevice(installationId, null, authorization, token), { statusCode: 401 });
  }
  assert.equal(bindings, 0);
  await registerPushDevice(installationId, null, authorization, await signed({}));
  assert.equal(bindings, 1);
});

test("push contains the approved title and body without the estimated coordinates", async () => {
  const item = {
    id: 23,
    bear_code: "MH-001",
    owner: "김정민",
    lat: 35,
    lng: 127,
    payload: { team_name: "광역팀" },
  };
  const expected = {
    title: "개체 추적 등록 · MH-001",
    body: "광역팀 김정민 담당자가 위치를 공유했습니다.",
  };
  assert.deepEqual(formatEstimateNotification(item), expected);
  const sender = "ab128ce8-a00c-4e0f-8dd2-f3618355d023";
  await enqueueEstimatePush(async (sql, values) => {
    assert.match(sql, /installation_id::text IS DISTINCT FROM \$4/);
    assert.deepEqual(values, ["23", expected.title, expected.body, sender]);
  }, item, sender);
});

test("only the first registration of the source estimate queues a notification", async () => {
  let stored;
  const queued = [];
  const statements = [];
  const query = async (sql, values) => {
    statements.push(sql);
    if (sql.includes("pg_advisory_xact_lock")) return {};
    if (sql.includes("WHERE bear_estimate_id")) return { rows: stored ? [stored] : [] };
    if (sql.includes("INSERT INTO bear_estimates_realtime")) {
      stored = { id: 23, bear_estimate_id: values[0] };
      return { rows: [stored] };
    }
    throw new Error("Unexpected query");
  };
  const database = { pgQuery: query, pgTransaction: work => work(query) };
  const context = { module: { exports: {} }, require: () => database };
  const source = fs.readFileSync(require.resolve("../src/services/realtimeStore"), "utf8");
  vm.runInNewContext(source, context);
  const { insertRealtimeBearEstimate } = context.module.exports;
  const payload = { id: "source-1", lat: 35, lng: 127 };
  const options = { onInsert: (transactionQuery, item) => {
    assert.equal(transactionQuery, query);
    queued.push(item);
  } };
  assert.equal(await insertRealtimeBearEstimate(payload, options), stored);
  assert.equal(await insertRealtimeBearEstimate(payload, options), stored);
  assert.equal(queued.length, 1);
  assert.equal(statements.filter(sql => sql.includes("INSERT INTO bear_estimates_realtime")).length, 1);
});
