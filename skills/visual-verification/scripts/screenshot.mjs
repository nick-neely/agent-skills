#!/usr/bin/env node
// Headless-Chrome screenshot tool for visual verification of rendered pages.
//
// Runs on plain Node (>=18) so it works in CI and on any contributor machine -
// no npm dependency, no bun required. It drives the Chrome DevTools Protocol
// directly (global fetch + WebSocket) so it can wait for the load event, an
// optional CSS selector, and a settle delay before capturing. That makes it
// reliable for client-rendered / Next.js dev pages, where the naive
// `chrome --headless --screenshot` either captures too early or (with
// `--virtual-time-budget`) hangs forever on the dev server's HMR websocket.
//
// Usage:
//   node .agents/skills/visual-verification/scripts/screenshot.mjs <url> [options]
//
// Run with --help for the full option list.
//
// Auth is repo-configured through .agents/visual-verification.json. The runner
// consumes Playwright storage-state cookies and can run a repo-owned refresh
// command when the state is missing or stale.
//
// Browser resolution order:
//   1. $PUPPETEER_EXECUTABLE_PATH or $CHROME_PATH
//   2. puppeteer cache ($PUPPETEER_CACHE_DIR or ~/.cache/puppeteer) - prefers
//      chrome-headless-shell. Install one with:
//        npx --yes @puppeteer/browsers install chrome-headless-shell@stable
//      (or: bun run screenshot:setup)
//   3. A system Chrome/Chromium (Linux, macOS, or Windows via WSL /mnt/c).
//
// Exit codes: 0 ok, 1 usage/setup error, 2 navigation/timeout error.

import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ---- arg parsing -----------------------------------------------------------
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opts = {
  out: "/tmp/screenshot.png",
  width: 1280,
  height: 900,
  scale: 2,
  device: null,
  mobile: false,
  full: false,
  wait: null,
  scroll: null,
  match: 0,
  focus: null,
  hover: null,
  click: null,
  tap: null,
  type: null,
  key: null,
  waitText: null,
  waitGone: null,
  expectText: null,
  expectSelector: null,
  actions: [],
  clipSelector: null,
  clipPadding: 0,
  hoverSettle: 600,
  settle: 400,
  colorScheme: null,
  touch: false,
  reducedMotion: false,
  contrast: null,
  forcedColors: null,
  showConsole: false,
  failOnConsoleError: false,
  showNetworkFailures: false,
  failOnNetworkError: false,
  timeout: 30000,
  auth: null, // null = auto from protectedRoutes, true/false = forced
  authState: null,
  config: null,
};
let url = null;
const HELP = `Usage: node .agents/skills/visual-verification/scripts/screenshot.mjs <url> [options]

Capture:
  -o, --out <path>             Output PNG (default: /tmp/screenshot.png)
  --width <px>                 Viewport width (default: 1280)
  --height <px>                Viewport height (default: 900)
  --scale <n>                  Device scale factor / DPR (default: 2)
  --full                       Capture the full scrollable page
  --clip-selector <selector>   Capture one element instead of the viewport
  --clip-padding <px>          Padding around --clip-selector (default: 0)

Loading:
  --wait <selector>            Wait until this CSS selector exists
  --scroll <px|bottom|sel>     Scroll before interactions/capture
  --settle <ms>                Extra wait after load/selector (default: 400)
  --timeout <ms>               Navigation/wait timeout (default: 30000)

Interactions:
  --match <index>              Zero-based match for simple selector flags (default: 0)
  --hover <selector>           Hover an element
  --click <selector>           Click an element
  --focus <selector>           Focus an element
  --tap <selector>             Touch-tap an element
  --type <selector> <text>     Focus an element and type text
  --key <key>                  Press a key (Enter, Escape, ArrowDown, a, etc.)
  --wait-text <text>           Wait until page text contains text
  --wait-gone <selector>       Wait until selector has no matches
  --expect-text <text>         Fail unless page text contains text
  --expect-selector <selector> Fail unless selector exists
  --action <verb:payload>      Repeatable action queue. Verbs:
                               hover, click, focus, tap, type, key,
                               wait-selector, wait-text, wait-gone,
                               expect-selector, expect-text, sleep, stable.
                               Selector verbs support nth targeting:
                               click[2]:button.save
                               type:#name=Ada Lovelace
  --hover-settle <ms>          Extra wait after interactions (default: 600)

Environment:
  --device <name>              desktop, mobile, iphone, tablet
  --touch                      Enable touch emulation
  --reduced-motion             Emulate prefers-reduced-motion: reduce
  --contrast <value>           more, less, no-preference
  --forced-colors <value>      active, none
  --color-scheme <value>       light, dark
  --dark                       Alias for --color-scheme dark

Diagnostics:
  --show-console               Print browser console entries after capture
  --fail-on-console-error      Exit 2 if console error/page error is seen
  --show-network-failures      Print failed network requests after capture
  --fail-on-network-error      Exit 2 if a network request fails

Auth:
  --auth                       Force agent-admin auth
  --no-auth                    Disable auth
  --auth-state <path>          Storage-state JSON
  --config <path>              Visual verification config (default: .agents/visual-verification.json)`;

function parseNumber(value, label) {
  const n = Number(value);
  if (!Number.isFinite(n)) die(`Invalid ${label}: ${value}`, 1);
  return n;
}

function needValue(flag, value) {
  if (value == null || value.startsWith("-")) die(`${flag} requires a value.`, 1);
  return value;
}

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const next = () => argv[++i];
  if (a === "-o" || a === "--out") opts.out = next();
  else if (a === "--width") opts.width = parseNumber(needValue(a, next()), a);
  else if (a === "--height") opts.height = parseNumber(needValue(a, next()), a);
  else if (a === "--scale") opts.scale = parseNumber(needValue(a, next()), a);
  else if (a === "--device") opts.device = needValue(a, next());
  else if (a === "--full") opts.full = true;
  else if (a === "--wait") opts.wait = next();
  else if (a === "--scroll") opts.scroll = next();
  else if (a === "--match") opts.match = parseNumber(needValue(a, next()), a);
  else if (a === "--focus") opts.focus = next();
  else if (a === "--hover") opts.hover = next();
  else if (a === "--click") opts.click = next();
  else if (a === "--tap") opts.tap = next();
  else if (a === "--type")
    opts.type = { selector: needValue(a, next()), text: needValue(a, next()) };
  else if (a === "--key") opts.key = needValue(a, next());
  else if (a === "--wait-text") opts.waitText = needValue(a, next());
  else if (a === "--wait-gone") opts.waitGone = needValue(a, next());
  else if (a === "--expect-text") opts.expectText = needValue(a, next());
  else if (a === "--expect-selector") opts.expectSelector = needValue(a, next());
  else if (a === "--action") opts.actions.push(needValue(a, next()));
  else if (a === "--clip-selector") opts.clipSelector = needValue(a, next());
  else if (a === "--clip-padding") opts.clipPadding = parseNumber(needValue(a, next()), a);
  else if (a === "--hover-settle") opts.hoverSettle = parseNumber(needValue(a, next()), a);
  else if (a === "--settle") opts.settle = parseNumber(needValue(a, next()), a);
  else if (a === "--dark") opts.colorScheme = "dark";
  else if (a === "--color-scheme") opts.colorScheme = needValue(a, next());
  else if (a === "--touch") opts.touch = true;
  else if (a === "--reduced-motion") opts.reducedMotion = true;
  else if (a === "--contrast") opts.contrast = needValue(a, next());
  else if (a === "--forced-colors") opts.forcedColors = needValue(a, next());
  else if (a === "--show-console") opts.showConsole = true;
  else if (a === "--fail-on-console-error") opts.failOnConsoleError = true;
  else if (a === "--show-network-failures") opts.showNetworkFailures = true;
  else if (a === "--fail-on-network-error") opts.failOnNetworkError = true;
  else if (a === "--timeout") opts.timeout = parseNumber(needValue(a, next()), a);
  else if (a === "--auth") opts.auth = true;
  else if (a === "--no-auth") opts.auth = false;
  else if (a === "--auth-state") opts.authState = next();
  else if (a === "--config") opts.config = needValue(a, next());
  else if (a === "-h" || a === "--help") {
    console.log(HELP);
    process.exit(0);
  } else if (!a.startsWith("-")) url = a;
  else {
    console.error(`Unknown option: ${a}`);
    process.exit(1);
  }
}
if (!url) {
  console.error("Usage: node scripts/screenshot.mjs <url> [options]\nRun with --help for details.");
  process.exit(1);
}

// Pre-launch failures can't use fail() (it kills a not-yet-spawned Chrome).
function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}

// ---- project config --------------------------------------------------------
const scriptDir = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_RELATIVE = ".agents/visual-verification.json";
const LOCAL_CONFIG_RELATIVE = ".agents/visual-verification.local.json";

function resolveFrom(base, value) {
  if (!value) return null;
  return isAbsolute(value) ? value : resolve(base, value);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
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

function findUp(start, relativePath) {
  let current = resolve(start);
  while (true) {
    const candidate = join(current, relativePath);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function findProjectRoot() {
  if (process.env.VISUAL_VERIFICATION_ROOT) return resolve(process.env.VISUAL_VERIFICATION_ROOT);
  const configured = findUp(process.cwd(), DEFAULT_CONFIG_RELATIVE);
  if (configured) return dirname(dirname(configured));
  for (const marker of ["package.json", ".git"]) {
    const found = findUp(process.cwd(), marker);
    if (found) return marker === ".git" ? dirname(found) : dirname(found);
  }
  return process.cwd();
}

const projectRoot = findProjectRoot();
const configPath = opts.config
  ? resolveFrom(projectRoot, opts.config)
  : findUp(projectRoot, DEFAULT_CONFIG_RELATIVE) || join(projectRoot, DEFAULT_CONFIG_RELATIVE);
const localConfigPath = findUp(projectRoot, LOCAL_CONFIG_RELATIVE) || join(projectRoot, LOCAL_CONFIG_RELATIVE);
const config = mergeConfig(readJson(configPath) || {}, readJson(localConfigPath) || {});
const authConfig = config.auth || {};
const protectedRoutes = Array.isArray(config.protectedRoutes) ? config.protectedRoutes : ["/admin/**"];
const DEFAULT_AUTH_STATE = resolveFrom(projectRoot, authConfig.storageState) ||
  join(projectRoot, ".auth", "agent-admin-storage-state.json");
const SESSION_COOKIE = authConfig.sessionCookieName || "better-auth.session_token";

if (configPath && existsSync(configPath)) {
  console.error(`Using visual verification config: ${configPath}`);
}
if (localConfigPath && existsSync(localConfigPath)) {
  console.error(`Using visual verification local config: ${localConfigPath}`);
}

const DEVICE_PRESETS = {
  desktop: { width: 1280, height: 900, scale: 2, touch: false, mobile: false },
  mobile: { width: 390, height: 844, scale: 3, touch: true, mobile: true },
  iphone: { width: 393, height: 852, scale: 3, touch: true, mobile: true },
  tablet: { width: 820, height: 1180, scale: 2, touch: true, mobile: true },
};

function validateOpts() {
  if (opts.device) {
    const preset = DEVICE_PRESETS[opts.device];
    if (!preset)
      die(`Invalid --device "${opts.device}". Use desktop, mobile, iphone, or tablet.`, 2);
    if (!argv.includes("--width")) opts.width = preset.width;
    if (!argv.includes("--height")) opts.height = preset.height;
    if (!argv.includes("--scale")) opts.scale = preset.scale;
    if (!argv.includes("--touch")) opts.touch = preset.touch;
    opts.mobile = preset.mobile;
  }
  if (opts.full && opts.clipSelector) die("--full cannot be combined with --clip-selector.", 2);
  if (!Number.isInteger(opts.match) || opts.match < 0)
    die("--match must be a zero-based integer.", 2);
  if (opts.clipPadding < 0) die("--clip-padding must be zero or greater.", 2);
  if (opts.colorScheme && !["light", "dark"].includes(opts.colorScheme)) {
    die("--color-scheme must be light or dark.", 2);
  }
  if (opts.contrast && !["more", "less", "no-preference"].includes(opts.contrast)) {
    die("--contrast must be more, less, or no-preference.", 2);
  }
  if (opts.forcedColors && !["active", "none"].includes(opts.forcedColors)) {
    die("--forced-colors must be active or none.", 2);
  }
}

validateOpts();

function globToRegExp(pattern) {
  if (pattern.endsWith("/**")) {
    const base = pattern.slice(0, -3).replace(/[.+^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${base}(?:/.*)?$`);
  }
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "__DOUBLE_STAR__")
    .replace(/\*/g, "[^/]*")
    .replace(/__DOUBLE_STAR__/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function routeIsProtected(pathname) {
  return protectedRoutes.some((pattern) => globToRegExp(pattern).test(pathname));
}

// Auth is on when forced, or (auto) for a local protected route.
function authRequested() {
  if (opts.auth === true) return true;
  if (opts.auth === false) return false;
  try {
    const u = new URL(url);
    const local = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname);
    return local && routeIsProtected(u.pathname);
  } catch {
    return false;
  }
}

// Stale when the session cookie is absent or within a minute of expiry.
function storageStateStale(state) {
  const cookie = state?.cookies?.find((c) => c.name === SESSION_COOKIE) ?? state?.cookies?.[0];
  if (!cookie) return true;
  if (!cookie.expires || cookie.expires < 0) return false; // session-only cookie
  return cookie.expires * 1000 <= Date.now() + 60_000;
}

function regenerateStorageState() {
  if (authConfig.mode === "none") {
    die("Auth was requested, but config auth.mode is 'none'. Pass --no-auth or configure an auth adapter.");
  }
  if (!authConfig.refreshCommand) {
    die(
      "Auth storage state is missing/expired and no auth.refreshCommand is configured.\n" +
        `Add one to ${configPath}, or pass --auth-state with a fresh Playwright storage state.`,
    );
  }
  console.error(`Refreshing auth state: ${authConfig.refreshCommand}`);
  const res = spawnSync(authConfig.refreshCommand, [], {
    cwd: projectRoot,
    shell: true,
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (res.error || res.status !== 0) {
    die(
      "Could not refresh auth storage state.\n" +
        "Check the repo-owned auth.refreshCommand and its local env/database prerequisites.",
    );
  }
}

// Playwright storage-state cookie -> CDP Network.setCookies shape.
function toCdpCookies(state) {
  return (state.cookies ?? []).map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || "/",
    secure: Boolean(c.secure),
    httpOnly: Boolean(c.httpOnly),
    sameSite: c.sameSite ?? "Lax",
    ...(c.expires && c.expires > 0 ? { expires: c.expires } : {}),
  }));
}

function loadAuthCookies() {
  const statePath = opts.authState || DEFAULT_AUTH_STATE;
  let state = readJson(statePath);
  if (!state || storageStateStale(state)) {
    if (authConfig.mode === "storage-state") {
      die(`Auth storage state is missing/expired and auth.mode is storage-state: ${statePath}`);
    }
    regenerateStorageState();
    state = readJson(statePath);
  }
  if (!state) die(`No auth storage state at ${statePath} after refresh.`);
  const cookies = toCdpCookies(state);
  if (!cookies.length) die(`Auth storage state has no cookies: ${statePath}`);
  return cookies;
}

const authCookies = authRequested() ? loadAuthCookies() : [];
if (authCookies.length) console.error(`Using configured auth (${authCookies.length} cookie(s)).`);

// ---- locate a working Chrome (cross-platform) ------------------------------
function fromPuppeteerCache() {
  const base = process.env.PUPPETEER_CACHE_DIR || join(homedir(), ".cache/puppeteer");
  // Prefer chrome-headless-shell (purpose-built for headless capture), then chrome.
  for (const product of ["chrome-headless-shell", "chrome"]) {
    const dir = join(base, product);
    let best = null;
    let bestVer = "";
    try {
      for (const ver of readdirSync(dir)) {
        for (const sub of readdirSync(join(dir, ver))) {
          for (const exe of [product, `${product}.exe`, "chrome", "chrome.exe"]) {
            const p = join(dir, ver, sub, exe);
            try {
              if (statSync(p).isFile() && ver > bestVer) {
                best = p;
                bestVer = ver;
              }
            } catch {}
          }
        }
      }
    } catch {}
    if (best) return best;
  }
  return null;
}

function fromSystem() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    // Linux
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    // macOS
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    // WSL -> Windows
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

const bin = fromPuppeteerCache() ?? fromSystem();
if (!bin) {
  console.error(
    "No Chrome found. Install a headless shell with:\n" +
      `  node ${JSON.stringify(join(scriptsDir, "ensure-browser.mjs"))} --install --smoke\n` +
      "or:\n" +
      "  npx --yes @puppeteer/browsers install chrome-headless-shell@stable\n" +
      "or set $CHROME_PATH / $PUPPETEER_EXECUTABLE_PATH to a Chrome binary.",
  );
  process.exit(1);
}
// chrome-headless-shell is already headless; full Chrome/Chromium needs the flag.
const isHeadlessShell = /headless[-_]shell/i.test(bin);

// ---- launch ----------------------------------------------------------------
const port = 9333 + Math.floor(Math.random() * 4000);
const userDataDir = mkdtempSync(join(tmpdir(), "cdp-shot-"));
const flags = [
  ...(isHeadlessShell ? [] : ["--headless=new"]),
  "--no-sandbox",
  "--disable-gpu",
  "--hide-scrollbars",
  "--disable-dev-shm-usage",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  `--force-device-scale-factor=${opts.scale}`,
  `--window-size=${opts.width},${opts.height}`,
  "about:blank",
];
const chrome = spawn(bin, flags, { stdio: ["ignore", "ignore", "pipe"] });
let chromeErr = "";
chrome.stderr.on("data", (d) => {
  chromeErr += d.toString();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg, code = 2) => {
  console.error(msg);
  if (chromeErr.trim()) console.error(chromeErr.trim().split("\n").slice(-3).join("\n"));
  try {
    chrome.kill("SIGKILL");
  } catch {}
  process.exit(code);
};

async function openTarget() {
  // Open a blank tab and navigate explicitly later, so cookies + media
  // emulation are in place before the target URL loads.
  // Newer Chrome requires PUT for /json/new; older accepts GET. Try PUT first.
  const path = `/json/new?${encodeURIComponent("about:blank")}`;
  try {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: "PUT" });
    return await r.json();
  } catch {
    const r = await fetch(`http://127.0.0.1:${port}${path}`);
    return await r.json();
  }
}

async function main() {
  // Wait for the debugging endpoint to come up.
  let up = false;
  for (let i = 0; i < 100; i++) {
    try {
      await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      up = true;
      break;
    } catch {
      await sleep(100);
    }
  }
  if (!up) fail("Chrome DevTools endpoint never came up.");

  const target = await openTarget();
  const wsUrl = target.webSocketDebuggerUrl;
  if (!wsUrl) fail(`Could not open target: ${JSON.stringify(target)}`);

  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const loadWaiters = [];
  const consoleEntries = [];
  const networkFailures = [];
  const requestUrls = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    } else if (msg.method === "Page.loadEventFired") {
      for (const r of loadWaiters.splice(0)) r();
    } else if (msg.method === "Runtime.consoleAPICalled") {
      consoleEntries.push({
        type: msg.params.type,
        text: msg.params.args?.map((arg) => arg.value ?? arg.description ?? "").join(" "),
      });
    } else if (msg.method === "Runtime.exceptionThrown") {
      consoleEntries.push({
        type: "error",
        text: msg.params.exceptionDetails?.text ?? "Uncaught exception",
      });
    } else if (msg.method === "Network.loadingFailed") {
      networkFailures.push({
        url: requestUrls.get(msg.params.requestId) ?? msg.params.requestId,
        errorText: msg.params.errorText,
        blockedReason: msg.params.blockedReason,
      });
    } else if (msg.method === "Network.requestWillBeSent") {
      requestUrls.set(msg.params.requestId, msg.params.request?.url ?? msg.params.requestId);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", () => rej(new Error("ws connection error")), { once: true });
  });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: opts.width,
    height: opts.height,
    deviceScaleFactor: opts.scale,
    mobile: opts.mobile,
  });
  if (opts.touch) {
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  }
  const mediaFeatures = [];
  if (opts.colorScheme)
    mediaFeatures.push({ name: "prefers-color-scheme", value: opts.colorScheme });
  if (opts.reducedMotion) mediaFeatures.push({ name: "prefers-reduced-motion", value: "reduce" });
  if (opts.contrast) mediaFeatures.push({ name: "prefers-contrast", value: opts.contrast });
  if (opts.forcedColors) mediaFeatures.push({ name: "forced-colors", value: opts.forcedColors });
  if (mediaFeatures.length) await send("Emulation.setEmulatedMedia", { features: mediaFeatures });
  if (authCookies.length) await send("Network.setCookies", { cookies: authCookies });

  // Navigate now that cookies + emulation are set. Wait for load, bounded by timeout.
  const loaded = new Promise((r) => loadWaiters.push(r));
  await send("Page.navigate", { url });
  await Promise.race([loaded, sleep(opts.timeout)]);

  if (opts.wait) {
    const deadline = Date.now() + opts.timeout;
    let ok = false;
    while (Date.now() < deadline) {
      const { result } = await send("Runtime.evaluate", {
        expression: `!!document.querySelector(${JSON.stringify(opts.wait)})`,
        returnByValue: true,
      });
      if (result.value) {
        ok = true;
        break;
      }
      await sleep(150);
    }
    if (!ok) fail(`Selector never appeared: ${opts.wait}`);
  }

  if (opts.settle > 0) await sleep(opts.settle);

  // Optional: scroll before capturing (verify sticky/fixed elements stay put).
  if (opts.scroll != null) {
    const target = opts.scroll;
    let expr;
    if (/^\d+$/.test(target)) {
      expr = `window.scrollTo({ top: ${Number(target)}, behavior: "instant" })`;
    } else if (target === "bottom") {
      expr = `window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })`;
    } else {
      expr = `document.querySelector(${JSON.stringify(target)})?.scrollIntoView({ block: "center", behavior: "instant" })`;
    }
    await send("Runtime.evaluate", { expression: expr });
    await sleep(Math.min(opts.settle, 500) || 300);
  }

  const resolveElement = async (selector, match = 0) => {
    const { result } = await send("Runtime.evaluate", {
      expression: `(() => {
        const nodes = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
        const el = nodes[${Number(match)}];
        if (!el) return null;
        el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height, count: nodes.length };
      })()`,
      returnByValue: true,
    });
    return result.value;
  };

  const centerOf = async (selector, match = 0) => {
    const box = await resolveElement(selector, match);
    return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
  };

  const requireCenter = async (selector, match, label) => {
    const center = await centerOf(selector, match);
    if (!center) fail(`${label} selector did not match at index ${match}: ${selector}`);
    return center;
  };

  const focusElement = async (selector, match = 0) => {
    const { result } = await send("Runtime.evaluate", {
      expression: `(() => {
        const el = Array.from(document.querySelectorAll(${JSON.stringify(selector)}))[${Number(match)}];
        if (!el) return false;
        el.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
        el.focus();
        return document.activeElement === el || el.matches(":focus");
      })()`,
      returnByValue: true,
    });
    return result.value;
  };

  const hoverElement = async (selector, match = 0) => {
    const center = await requireCenter(selector, match, "hover");
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 0, y: 0 });
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: center.x, y: center.y });
  };

  const clickElement = async (selector, match = 0) => {
    const center = await requireCenter(selector, match, "click");
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: center.x, y: center.y });
    const event = { x: center.x, y: center.y, button: "left", clickCount: 1 };
    await send("Input.dispatchMouseEvent", { type: "mousePressed", ...event });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...event });
  };

  const tapElement = async (selector, match = 0) => {
    const center = await requireCenter(selector, match, "tap");
    const touchPoint = { x: center.x, y: center.y, radiusX: 1, radiusY: 1, force: 1, id: 1 };
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint] });
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };

  const typeText = async (selector, text, match = 0) => {
    const focused = await focusElement(selector, match);
    if (!focused)
      fail(`type selector did not match or could not be focused at index ${match}: ${selector}`);
    for (const char of [...text]) {
      await send("Input.dispatchKeyEvent", { type: "char", text: char, unmodifiedText: char });
    }
  };

  const pressKey = async (key) => {
    const code = {
      Enter: 13,
      Escape: 27,
      Tab: 9,
      Backspace: 8,
      Delete: 46,
      ArrowDown: 40,
      ArrowUp: 38,
      ArrowLeft: 37,
      ArrowRight: 39,
    }[key];
    await send("Input.dispatchKeyEvent", {
      type: "keyDown",
      key,
      windowsVirtualKeyCode: code ?? key.toUpperCase().charCodeAt(0),
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp",
      key,
      windowsVirtualKeyCode: code ?? key.toUpperCase().charCodeAt(0),
    });
  };

  const textExists = async (text) => {
    const { result } = await send("Runtime.evaluate", {
      expression: `document.body?.innerText?.includes(${JSON.stringify(text)}) ?? false`,
      returnByValue: true,
    });
    return result.value;
  };

  const selectorExists = async (selector, match = 0) =>
    Boolean(await resolveElement(selector, match));

  const waitForText = async (text) => {
    const deadline = Date.now() + opts.timeout;
    while (Date.now() < deadline) {
      if (await textExists(text)) return;
      await sleep(150);
    }
    fail(`Text never appeared: ${text}`);
  };

  const waitForGone = async (selector) => {
    const deadline = Date.now() + opts.timeout;
    while (Date.now() < deadline) {
      const { result } = await send("Runtime.evaluate", {
        expression: `document.querySelector(${JSON.stringify(selector)}) == null`,
        returnByValue: true,
      });
      if (result.value) return;
      await sleep(150);
    }
    fail(`Selector did not disappear: ${selector}`);
  };

  const expectText = async (text) => {
    if (!(await textExists(text))) fail(`Expected text not found: ${text}`);
  };

  const expectSelector = async (selector, match = 0) => {
    if (!(await selectorExists(selector, match))) {
      fail(`Expected selector not found at index ${match}: ${selector}`);
    }
  };

  const waitForStability = async () => {
    let previous = "";
    let stableCount = 0;
    const deadline = Date.now() + opts.timeout;
    while (Date.now() < deadline) {
      const { result } = await send("Runtime.evaluate", {
        expression: `JSON.stringify({
          w: document.documentElement.scrollWidth,
          h: document.documentElement.scrollHeight,
          y: window.scrollY,
          active: document.activeElement?.outerHTML?.slice(0, 120) ?? ""
        })`,
        returnByValue: true,
      });
      if (result.value === previous) stableCount++;
      else stableCount = 0;
      if (stableCount >= 2) return;
      previous = result.value;
      await sleep(100);
    }
    fail("Page did not become layout-stable before timeout.");
  };

  const parseAction = (raw) => {
    const colon = raw.indexOf(":");
    if (colon < 1) fail(`Invalid --action syntax "${raw}". Expected verb:payload.`, 2);
    const left = raw.slice(0, colon);
    const payload = raw.slice(colon + 1);
    const match = left.match(/^([a-z-]+)(?:\[(\d+)])?$/);
    if (!match) fail(`Invalid --action target "${left}". Use verb or verb[index].`, 2);
    return { verb: match[1], match: match[2] == null ? 0 : Number(match[2]), payload };
  };

  const runAction = async (action) => {
    switch (action.verb) {
      case "hover":
        return hoverElement(action.payload, action.match);
      case "click":
        return clickElement(action.payload, action.match);
      case "focus":
        if (!(await focusElement(action.payload, action.match))) {
          fail(
            `focus selector did not match or could not be focused at index ${action.match}: ${action.payload}`,
          );
        }
        return;
      case "tap":
        return tapElement(action.payload, action.match);
      case "type": {
        const eq = action.payload.indexOf("=");
        if (eq < 1) fail(`Invalid type action "${action.payload}". Expected selector=text.`, 2);
        return typeText(action.payload.slice(0, eq), action.payload.slice(eq + 1), action.match);
      }
      case "key":
        return pressKey(action.payload);
      case "wait-selector":
        return waitForSelector(action.payload, action.match);
      case "wait-text":
        return waitForText(action.payload);
      case "wait-gone":
        return waitForGone(action.payload);
      case "expect-selector":
        return expectSelector(action.payload, action.match);
      case "expect-text":
        return expectText(action.payload);
      case "sleep":
        if (!Number.isFinite(Number(action.payload))) {
          fail(`Invalid sleep action "${action.payload}". Expected milliseconds.`, 2);
        }
        return sleep(Number(action.payload));
      case "stable":
        return waitForStability();
      default:
        fail(`Unsupported --action verb "${action.verb}". Run --help for supported verbs.`, 2);
    }
  };

  const waitForSelector = async (selector, match = 0) => {
    const deadline = Date.now() + opts.timeout;
    while (Date.now() < deadline) {
      if (await selectorExists(selector, match)) return;
      await sleep(150);
    }
    fail(`Selector never appeared at index ${match}: ${selector}`);
  };

  const actions = [];
  if (opts.hover) actions.push({ verb: "hover", payload: opts.hover, match: opts.match });
  if (opts.click) actions.push({ verb: "click", payload: opts.click, match: opts.match });
  if (opts.focus) actions.push({ verb: "focus", payload: opts.focus, match: opts.match });
  if (opts.tap) actions.push({ verb: "tap", payload: opts.tap, match: opts.match });
  if (opts.type) actions.push({ verb: "type-simple", ...opts.type, match: opts.match });
  if (opts.key) actions.push({ verb: "key", payload: opts.key, match: 0 });
  if (opts.waitText) actions.push({ verb: "wait-text", payload: opts.waitText, match: 0 });
  if (opts.waitGone) actions.push({ verb: "wait-gone", payload: opts.waitGone, match: 0 });
  for (const raw of opts.actions) actions.push(parseAction(raw));

  for (const action of actions) {
    if (action.verb === "type-simple") await typeText(action.selector, action.text, action.match);
    else await runAction(action);
  }

  if (actions.length) await sleep(opts.hoverSettle);
  if (opts.expectSelector) await expectSelector(opts.expectSelector, opts.match);
  if (opts.expectText) await expectText(opts.expectText);

  const clipForSelector = async (selector) => {
    const box = await resolveElement(selector, opts.match);
    if (!box) fail(`--clip-selector did not match at index ${opts.match}: ${selector}`);
    const { result } = await send("Runtime.evaluate", {
      expression: `({ w: window.innerWidth, h: window.innerHeight })`,
      returnByValue: true,
    });
    const pad = opts.clipPadding;
    const viewport = result.value;
    const x = Math.max(0, box.x - pad);
    const y = Math.max(0, box.y - pad);
    return {
      x,
      y,
      width: Math.min(viewport.w - x, box.width + pad * 2),
      height: Math.min(viewport.h - y, box.height + pad * 2),
      scale: 1,
    };
  };

  let clip;
  if (opts.clipSelector) {
    clip = await clipForSelector(opts.clipSelector);
  } else if (opts.full) {
    const { cssContentSize, contentSize } = await send("Page.getLayoutMetrics");
    const size = cssContentSize ?? contentSize;
    clip = { x: 0, y: 0, width: size.width, height: size.height, scale: 1 };
  }

  const { data } = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: !!opts.full,
    ...(clip ? { clip } : {}),
  });
  writeFileSync(opts.out, Buffer.from(data, "base64"));
  const consoleErrors = consoleEntries.filter(
    (entry) => entry.type === "error" || entry.type === "assert",
  );
  const shouldShowConsole = opts.showConsole || opts.failOnConsoleError;
  const shouldShowNetwork = opts.showNetworkFailures || opts.failOnNetworkError;
  if (shouldShowConsole && consoleEntries.length) {
    console.error("Browser console:");
    for (const entry of consoleEntries) console.error(`  [${entry.type}] ${entry.text}`);
  }
  if (shouldShowNetwork && networkFailures.length) {
    console.error("Network failures:");
    for (const failure of networkFailures) {
      console.error(
        `  ${failure.url}: ${failure.errorText}${failure.blockedReason ? ` (${failure.blockedReason})` : ""}`,
      );
    }
  }
  if (opts.failOnConsoleError && consoleErrors.length) {
    fail(`Console error(s) detected: ${consoleErrors.length}`, 2);
  }
  if (opts.failOnNetworkError && networkFailures.length) {
    fail(`Network failure(s) detected: ${networkFailures.length}`, 2);
  }
  ws.close();
  chrome.kill("SIGKILL");
  console.log(
    `Wrote ${opts.out} (${opts.width}x${opts.height} @${opts.scale}x` +
      `${opts.full ? ", full page" : ""}${opts.clipSelector ? ", clipped" : ""}` +
      `${opts.colorScheme ? `, ${opts.colorScheme}` : ""})`,
  );
  process.exit(0);
}

main().catch((e) => fail(`Screenshot failed: ${e.message}`));
