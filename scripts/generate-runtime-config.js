"use strict";

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");
const { getRuntimeConfig } = require("../src/config/runtime-config");

const ROOT_DIR = path.resolve(__dirname, "..");
const ENV_PATH = path.join(ROOT_DIR, ".env");
const OUTPUT_PATH = path.join(ROOT_DIR, "public", "runtime-config.js");

dotenv.config({ path: ENV_PATH });
const { appApiEnv, realtimeApiBase } = getRuntimeConfig(process.env);

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
