#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function findUp(start, name) {
  let current = resolve(start);
  while (true) {
    const candidate = join(current, name);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function listDirs(path) {
  try {
    return readdirSync(path)
      .filter((entry) => statSync(join(path, entry)).isDirectory())
      .sort();
  } catch {
    return [];
  }
}

function hasAny(paths) {
  return paths.some((path) => existsSync(path));
}

const packagePath = findUp(process.cwd(), "package.json");
const root = process.argv[2]
  ? resolve(process.argv[2])
  : packagePath
    ? dirname(packagePath)
    : process.cwd();
const packageJson = readJson(join(root, "package.json")) || {};
const deps = { ...(packageJson.dependencies || {}), ...(packageJson.devDependencies || {}) };
const scripts = packageJson.scripts || {};
const appDirs = [
  join(root, "app"),
  join(root, "src", "app"),
  join(root, "pages"),
  join(root, "src", "pages"),
  join(root, "routes"),
  join(root, "src", "routes"),
].filter((path) => existsSync(path));
const routeNames = [...new Set(appDirs.flatMap((dir) => listDirs(dir).map((name) => `/${name}`)))].sort();
const hasAdminRoute = hasAny([
  join(root, "app", "admin"),
  join(root, "src", "app", "admin"),
  join(root, "pages", "admin"),
  join(root, "src", "pages", "admin"),
  join(root, "routes", "admin"),
  join(root, "src", "routes", "admin"),
]);
const hasAuthGate = hasAny([
  join(root, "proxy.ts"),
  join(root, "middleware.ts"),
  join(root, "src", "proxy.ts"),
  join(root, "src", "middleware.ts"),
]);
const configExists = existsSync(join(root, ".agents", "visual-verification.json"));
const authScripts = Object.entries(scripts)
  .filter(([name]) => /auth|agent|login|admin/i.test(name))
  .map(([name, command]) => ({ name, command }));

function detectFramework() {
  if (deps.next) return "next";
  if (deps["@sveltejs/kit"]) return "sveltekit";
  if (deps.astro) return "astro";
  if (deps["@remix-run/node"] || deps["@remix-run/react"] || deps["@react-router/node"]) return "remix";
  if (deps.vite) return "vite";
  if (deps.react) return "react";
  return null;
}

function detectAuthProvider() {
  if (deps["better-auth"]) return "better-auth";
  if (deps["next-auth"]) return "next-auth";
  if (deps["@clerk/nextjs"] || deps["@clerk/clerk-react"]) return "clerk";
  if (hasAuthGate || authScripts.length) return "custom";
  return null;
}

const DEFAULT_PORTS = [3000, 3001, 3002, 3003, 5173, 5174, 4173, 8080];
const explicitBaseUrl = process.env.VISUAL_VERIFICATION_BASE_URL || null;

function scriptPort(command) {
  const match = command?.match(/(?:--port|-p)\s+(\d{2,5})|PORT=(\d{2,5})/);
  return match ? Number(match[1] || match[2]) : null;
}

function candidatePorts() {
  const ports = new Set(DEFAULT_PORTS);
  const fromDev = scriptPort(scripts.dev);
  if (fromDev) ports.add(fromDev);
  return [...ports];
}

async function probeUrl(baseUrl, paths) {
  const results = [];
  for (const path of paths) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 700);
    try {
      const response = await fetch(new URL(path, baseUrl), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      });
      results.push({ path, status: response.status });
    } catch {
      results.push({ path, status: null });
    } finally {
      clearTimeout(timeout);
    }
  }
  return results;
}

function scoreProbe(results) {
  let score = 0;
  for (const result of results) {
    if (result.status == null) continue;
    if (result.status >= 200 && result.status < 400) score += 4;
    else if ([401, 403].includes(result.status)) score += 3;
    else if (result.status === 404) score -= 1;
    else if (result.status >= 500) score -= 3;
  }
  return score;
}

async function detectBaseUrl() {
  if (explicitBaseUrl) {
    return {
      baseUrl: explicitBaseUrl,
      source: "VISUAL_VERIFICATION_BASE_URL",
      probes: [],
    };
  }

  const paths = ["/", ...routeNames.filter((route) => !route.includes(".")).slice(0, 4)];
  const probes = [];
  for (const port of candidatePorts()) {
    const baseUrl = `http://localhost:${port}`;
    const results = await probeUrl(baseUrl, paths);
    const score = scoreProbe(results);
    probes.push({ baseUrl, score, results });
  }

  const alive = probes
    .filter((probe) => probe.results.some((result) => result.status != null))
    .sort((a, b) => b.score - a.score);

  if (alive[0]?.score > 0) {
    return { baseUrl: alive[0].baseUrl, source: "running-server-probe", probes };
  }

  const fromDev = scriptPort(scripts.dev);
  if (fromDev) {
    return { baseUrl: `http://localhost:${fromDev}`, source: "package-script-port", probes };
  }

  const fallbackPort = deps.vite && !deps.next ? 5173 : 3000;
  return { baseUrl: `http://localhost:${fallbackPort}`, source: "framework-default", probes };
}

const detectedBaseUrl = await detectBaseUrl();
const framework = detectFramework();
const authProvider = detectAuthProvider();

const inferred = {
  baseUrl: detectedBaseUrl.baseUrl,
  baseUrlSource: detectedBaseUrl.source,
  baseUrlProbes: detectedBaseUrl.probes,
  protectedRoutes: hasAdminRoute ? ["/admin", "/admin/**"] : [],
  devServer: {
    checkUrl: detectedBaseUrl.baseUrl,
    startCommand: scripts.dev ? "bun run dev" : null,
  },
  auth: null,
};

if (authProvider === "better-auth") {
  inferred.auth = {
    mode: "command",
    storageState: ".auth/agent-admin-storage-state.json",
    refreshCommand: null,
    sessionCookieName: "better-auth.session_token",
    adapter: "better-auth",
    needsAdapterScript: true,
    candidateRefreshCommands: authScripts,
  };
} else if (authProvider === "next-auth" || authProvider === "clerk") {
  inferred.auth = {
    mode: "playwright-login",
    storageState: ".auth/agent-admin-storage-state.json",
    refreshCommand: null,
    adapter: authProvider,
    needsAdapterScript: true,
    candidateRefreshCommands: authScripts,
  };
} else if (authProvider === "custom") {
  inferred.auth = {
    mode: "custom-cookie",
    storageState: ".auth/agent-admin-storage-state.json",
    refreshCommand: null,
    adapter: "custom",
    needsAdapterScript: true,
    candidateRefreshCommands: authScripts,
  };
} else {
  inferred.auth = { mode: "none" };
}

console.log(
  JSON.stringify(
    {
      root,
      configExists,
      packageManager: packageJson.packageManager || null,
      framework,
      auth: {
        betterAuth: Boolean(deps["better-auth"]),
        nextAuth: Boolean(deps["next-auth"]),
        clerk: Boolean(deps["@clerk/nextjs"] || deps["@clerk/clerk-react"]),
        provider: authProvider,
        hasAuthGate,
        authScripts,
      },
      routes: routeNames,
      inferred,
    },
    null,
    2,
  ),
);
