#!/usr/bin/env node
// Check every dependency this skill needs, before any work begins.
//
// Usage:
//   node preflight.mjs [--json]
//
// Exits non-zero when a required dependency is missing. Reports what to run,
// but installs nothing: system packages, global npm writes, and browser
// downloads are the user's decision, not this script's.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FONT_PATH = join(SKILL_ROOT, "assets", "DejaVuSans.ttf");

const HELP = `preflight.mjs - verify this skill's dependencies

  node preflight.mjs [--json]

Exits 0 when everything needed is present, 1 otherwise.
`;

// Install hints differ enough per platform that a single generic line is
// useless. Pick the one that matches the host, and fall back to the project's
// own documentation rather than guessing.
const INSTALL = {
  imagemagick: {
    darwin: "brew install imagemagick",
    linux: "sudo apt install imagemagick   (or: dnf install ImageMagick)",
    win32: "winget install ImageMagick.ImageMagick",
  },
  "agent-browser": {
    darwin: "npm i -g agent-browser   (or: brew install agent-browser)",
    linux: "npm i -g agent-browser",
    win32: "npm i -g agent-browser",
  },
  gh: {
    darwin: "brew install gh",
    linux: "sudo apt install gh",
    win32: "winget install GitHub.cli",
  },
  git: {
    darwin: "xcode-select --install",
    linux: "sudo apt install git",
    win32: "winget install Git.Git",
  },
};

function hint(tool) {
  const table = INSTALL[tool];
  if (!table) return null;
  return table[process.platform] ?? table.linux;
}

function has(binary, args = ["--version"]) {
  try {
    execFileSync(binary, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const checks = [];
const add = (name, ok, detail, fix = null, required = true) =>
  checks.push({ name, ok, detail, fix, required });

// ImageMagick 7 ships `magick`; ImageMagick 6 ships `convert`.
const magick = ["magick", "convert"].find((binary) => has(binary));
add(
  "ImageMagick",
  Boolean(magick),
  magick ? `found as \`${magick}\`` : "not found",
  hint("imagemagick"),
);

const hasBrowser = has("agent-browser", ["--version"]);
add(
  "agent-browser",
  hasBrowser,
  hasBrowser ? "installed" : "not found",
  hint("agent-browser"),
);

// A present CLI does not mean a usable browser. `agent-browser --version`
// succeeds with no Chrome installed, and capture then fails at the first
// screenshot, which is far too late to find out.
if (hasBrowser) {
  let chrome = { ok: false, detail: "could not run `agent-browser doctor`" };
  try {
    const raw = execFileSync("agent-browser", ["doctor", "--json"], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    const found = JSON.parse(raw).checks?.find((c) => c.id === "chrome.installed");
    if (found) {
      chrome = {
        ok: found.status === "pass",
        detail: found.status === "pass" ? "installed" : found.message || found.status,
      };
    }
  } catch {
    // fall through to the default failure
  }
  add("Chrome", chrome.ok, chrome.detail, "agent-browser install");
} else {
  add("Chrome", false, "cannot check without agent-browser", "agent-browser install");
}

const hasGh = has("gh");
add("gh CLI", hasGh, hasGh ? "installed" : "not found", hint("gh"));

// Publishing dies without a token. Finding that out after capture, worktree,
// and annotation wastes all of it.
if (hasGh) {
  const authed = has("gh", ["auth", "token"]);
  add(
    "gh authentication",
    authed,
    authed ? "authenticated" : "no token for this host",
    "gh auth login",
  );
} else {
  add("gh authentication", false, "cannot check without gh", "gh auth login");
}

const hasGit = has("git");
add("git", hasGit, hasGit ? "installed" : "not found", hint("git"));

add(
  "bundled font",
  existsSync(FONT_PATH),
  existsSync(FONT_PATH) ? "present" : `missing at ${FONT_PATH}`,
  "reinstall the skill; the font ships with it",
);

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const failed = checks.filter((check) => check.required && !check.ok);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
} else {
  for (const check of checks) {
    console.log(`${check.ok ? "  ok " : "MISS "} ${check.name.padEnd(18)} ${check.detail}`);
  }
  if (failed.length > 0) {
    console.log("\nMissing dependencies. Run these, or ask the user to:\n");
    for (const check of failed) {
      if (check.fix) console.log(`  ${check.name}: ${check.fix}`);
    }
    console.log(
      "\nInstalling system packages, writing global npm modules, and downloading" +
        "\na browser are the user's call. Ask before running any of the above.",
    );
  }
}

process.exit(failed.length === 0 ? 0 : 1);
