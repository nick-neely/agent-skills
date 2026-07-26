#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const root = process.argv[2] ? resolve(process.argv[2]) : process.cwd();
const configPath = join(root, ".agents", "visual-verification.json");
const localConfigPath = join(root, ".agents", "visual-verification.local.json");

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function resolveFrom(base, value) {
  if (!value) return null;
  return isAbsolute(value) ? value : resolve(base, value);
}

function mergeConfig(base, override) {
  if (!override || typeof override !== "object") return base || {};
  const merged = { ...(base || {}) };
  for (const [key, value] of Object.entries(override)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      merged[key] &&
      typeof merged[key] === "object" &&
      !Array.isArray(merged[key])
    ) {
      merged[key] = mergeConfig(merged[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

function staleStorageState(state, cookieName) {
  const cookie = state?.cookies?.find((item) => item.name === cookieName) ?? state?.cookies?.[0];
  if (!cookie) return true;
  if (!cookie.expires || cookie.expires < 0) return false;
  return cookie.expires * 1000 <= Date.now() + 60_000;
}

const config = mergeConfig(readJson(configPath), readJson(localConfigPath));
if (!config) {
  console.error(`No visual verification config found: ${configPath}`);
  process.exit(1);
}

const auth = config.auth || { mode: "none" };
if (auth.mode === "none") {
  console.log("Auth disabled by config.");
  process.exit(0);
}

const statePath = resolveFrom(root, auth.storageState);
if (!statePath) {
  console.error("auth.storageState is required for configured auth.");
  process.exit(1);
}

const cookieName = auth.sessionCookieName || "better-auth.session_token";
const state = readJson(statePath);
if (state && !staleStorageState(state, cookieName)) {
  console.log(`Auth storage state is fresh: ${statePath}`);
  process.exit(0);
}

if (!auth.refreshCommand) {
  console.error(`Auth storage state is missing/expired and auth.refreshCommand is not configured: ${statePath}`);
  process.exit(1);
}

console.log(`Refreshing auth state: ${auth.refreshCommand}`);
const result = spawnSync(auth.refreshCommand, [], {
  cwd: root,
  shell: true,
  stdio: "inherit",
});
if (result.error || result.status !== 0) {
  process.exit(result.status || 1);
}

if (!existsSync(statePath)) {
  console.error(`Refresh command did not create storage state: ${statePath}`);
  process.exit(1);
}

console.log(`Auth storage state ready: ${statePath}`);
