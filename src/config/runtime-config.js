"use strict";

function normalizeContextRoot(value = "/") {
  if (typeof value !== "string") return "/";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "/") return "/";

  let normalized = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  normalized = normalized.replace(/\/+$/, "");
  return normalized || "/";
}

function normalizeBase(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\/$/, "");
}

function toRealtimeApiBase(value) {
  const base = normalizeBase(value);
  if (!base) return "";

  if (/\/api\/realtime$/i.test(base)) return base;
  if (/\/api$/i.test(base)) return `${base}/realtime`;
  return `${base}/api/realtime`;
}

function toDisplayHost(host) {
  if (!host || host === "0.0.0.0" || host === "::") return "localhost";
  return host;
}

function resolveRealtimeApiBase(envName, env, baseWithContextRoot) {
  const localBase = toRealtimeApiBase(env.REALTIME_API_BASE_LOCAL);
  const devBase = toRealtimeApiBase(env.REALTIME_API_BASE_DEV);
  const prodBase = toRealtimeApiBase(env.REALTIME_API_BASE_PROD);
  const sharedBase = toRealtimeApiBase(env.REALTIME_API_BASE);
  const apiUrlBase = toRealtimeApiBase(env.API_URL);
  const defaultBase = `${baseWithContextRoot}/api/realtime`;

  if (envName === "prod") {
    return prodBase || sharedBase || apiUrlBase || defaultBase;
  }

  if (envName === "dev") {
    return devBase || sharedBase || apiUrlBase || defaultBase;
  }

  return localBase || sharedBase || apiUrlBase || defaultBase;
}

function getRuntimeConfig(env = process.env) {
  const port = Number(env.PORT || 3000);
  const host = env.HOST || "0.0.0.0";
  const contextRoot = normalizeContextRoot(env.CONTEXT_ROOT || "/");
  const rawAppApiEnv = (env.APP_API_ENV || "local").trim().toLowerCase();
  const appApiEnv = ["local", "dev", "prod"].includes(rawAppApiEnv)
    ? rawAppApiEnv
    : "local";

  const defaultOrigin = `http://${toDisplayHost(host)}:${port}`;
  const publicOrigin = normalizeBase(env.PUBLIC_ORIGIN) || defaultOrigin;

  const baseWithContextRoot =
    contextRoot === "/" ? publicOrigin : `${publicOrigin}${contextRoot}`;

  const realtimeApiBase = resolveRealtimeApiBase(appApiEnv, env, baseWithContextRoot);
  const serverUrl = baseWithContextRoot;

  return {
    port,
    host,
    contextRoot,
    publicOrigin,
    appApiEnv,
    realtimeApiBase,
    serverUrl,
  };
}

module.exports = {
  getRuntimeConfig,
  normalizeContextRoot,
  toRealtimeApiBase,
  resolveRealtimeApiBase,
};
