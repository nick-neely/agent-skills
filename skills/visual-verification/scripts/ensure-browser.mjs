#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const install = argv.includes("--install");
const smoke = argv.includes("--smoke");
const scriptsDir = dirname(fileURLToPath(import.meta.url));

function nodeMajor() {
  return Number(process.versions.node.split(".")[0]);
}

function fromPuppeteerCache() {
  const base = process.env.PUPPETEER_CACHE_DIR || join(homedir(), ".cache", "puppeteer");
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
    if (best) return { path: best, source: "puppeteer-cache" };
  }
  return null;
}

function fromSystem() {
  const candidates = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  return found ? { path: found, source: "system" } : null;
}

function installHeadlessShell() {
  const runners = [
    ["npx", ["--yes", "@puppeteer/browsers", "install", "chrome-headless-shell@stable"]],
    ["pnpm", ["dlx", "@puppeteer/browsers", "install", "chrome-headless-shell@stable"]],
    ["bunx", ["--bun", "@puppeteer/browsers", "install", "chrome-headless-shell@stable"]],
  ];
  for (const [cmd, args] of runners) {
    const probe = spawnSync(cmd, ["--version"], { stdio: "ignore" });
    if (probe.error || probe.status !== 0) continue;
    console.error(`Installing chrome-headless-shell with: ${cmd} ${args.join(" ")}`);
    const result = spawnSync(cmd, args, { stdio: "inherit" });
    if (!result.error && result.status === 0) return true;
  }
  return false;
}

function runSmoke() {
  const script = join(scriptsDir, "screenshot.mjs");
  const out = join(mkdtempSync(join(tmpdir(), "vv-smoke-")), "smoke.png");
  const result = spawnSync(
    process.execPath,
    [
      script,
      "data:text/html,<main style='font:20px sans-serif'>visual verification smoke ok</main>",
      "-o",
      out,
      "--wait",
      "main",
      "--expect-text",
      "visual verification smoke ok",
    ],
    { encoding: "utf8" },
  );
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  return result.status === 0 ? out : null;
}

const checks = {
  node: {
    version: process.version,
    ok: nodeMajor() >= 18,
  },
  browser: fromPuppeteerCache() || fromSystem(),
};

if (!checks.node.ok) {
  console.error(`Node ${process.version} is too old. Use Node 18 or newer.`);
  process.exit(1);
}

if (!checks.browser && install) {
  if (!installHeadlessShell()) {
    console.error("Could not install chrome-headless-shell. Install Chrome manually or set CHROME_PATH.");
    process.exit(1);
  }
  checks.browser = fromPuppeteerCache() || fromSystem();
}

if (!checks.browser) {
  console.error(
    [
      "No Chrome or chrome-headless-shell found.",
      "",
      "Recommended setup:",
      `  node ${JSON.stringify(join(scriptsDir, "ensure-browser.mjs"))} --install --smoke`,
      "",
      "Manual alternatives:",
      "  npx --yes @puppeteer/browsers install chrome-headless-shell@stable",
      `  CHROME_PATH=/path/to/chrome node ${JSON.stringify(join(scriptsDir, "screenshot.mjs"))} <url>`,
    ].join("\n"),
  );
  process.exit(1);
}

const output = {
  ok: true,
  node: checks.node,
  browser: checks.browser,
};

if (smoke) {
  const smokePath = runSmoke();
  if (!smokePath) process.exit(1);
  output.smokeScreenshot = smokePath;
}

console.log(JSON.stringify(output, null, 2));
