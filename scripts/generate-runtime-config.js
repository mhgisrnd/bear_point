"use strict";

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT_DIR, ".env");
const OUTPUT_PATH = path.join(ROOT_DIR, "public", "runtime-config.js");

dotenv.config({ path: ENV_PATH });

function normalizeBase(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/$/, "");
}

function toRealtimeApiBase(value) {
  const base = normalizeBase(value);
  if (!base) return "";

  if (/\/api\/realtime$/i.test(base)) return base;
  if (/\/api$/i.test(base)) return base + "/realtime";
  return base + "/api/realtime";
}

const appApiEnv = (process.env.APP_API_ENV || "local").trim().toLowerCase();
const localBase =
  toRealtimeApiBase(process.env.REALTIME_API_BASE_LOCAL) ||
  toRealtimeApiBase(process.env.API_URL) ||
  "http://localhost:3000/api/realtime";
const devBase =
  toRealtimeApiBase(process.env.REALTIME_API_BASE_DEV) ||
  "https://bearmap.duckdns.org/api/realtime";

const realtimeApiBase = appApiEnv === "dev" ? devBase : localBase;

const output = [
  "(function (window) {",
  '  "use strict";',
  "",
  "  window.BEAR_RUNTIME_CONFIG = Object.freeze({",
  `    env: ${JSON.stringify(appApiEnv)},`,
  `    realtimeApiBase: ${JSON.stringify(realtimeApiBase)}`,
  "  });",
  "",
  "  window.BEAR_API_BASE = window.BEAR_RUNTIME_CONFIG.realtimeApiBase;",
  "})(window);",
  "",
].join("\n");

fs.writeFileSync(OUTPUT_PATH, output, "utf8");

console.log(
  "[runtime-config] generated:",
  path.relative(ROOT_DIR, OUTPUT_PATH),
  "env=", appApiEnv,
  "apiBase=", realtimeApiBase
);
