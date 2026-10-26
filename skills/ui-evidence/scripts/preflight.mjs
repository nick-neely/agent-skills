#!/usr/bin/env node
// Report dependencies for the requested operation without changing the machine.

import { spawnSync } from "node:child_process";
import { existsSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FONT_PATH = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "assets", "DejaVuSans.ttf");

const HELP = `preflight.mjs - verify dependencies for the requested UI evidence operation

  node preflight.mjs [--motion|--prepare|--publish|--annotate] [--format mp4|gif] [--json]

Default: screenshot capture. --motion checks video capture. --prepare checks
existing-media preparation. --publish checks publishing. --annotate checks
screenshot annotation. Motion capture for GIF uses a WebM recording.
`;

const INSTALL = {
  "agent-browser": {
    darwin: "npm i -g agent-browser   (or: brew install agent-browser)",
    linux: "npm i -g agent-browser",
    win32: "npm i -g agent-browser",
  },
  imagemagick: {
    darwin: "brew install imagemagick",
    linux: "sudo apt install imagemagick   (or: dnf install ImageMagick)",
    win32: "winget install ImageMagick.ImageMagick",
  },
  ffmpeg: {
    darwin: "brew install ffmpeg",
    linux: "sudo apt install ffmpeg   (or: dnf install ffmpeg)",
    win32: "winget install Gyan.FFmpeg",
  },
  gh: {
    darwin: "brew install gh",
    linux: "sudo apt install gh",
    win32: "winget install GitHub.cli",
  },
};

function hint(tool) {
  const table = INSTALL[tool];
  return table ? table[process.platform] ?? table.linux : null;
}

function run(binary, args) {
  return spawnSync(binary, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

let mode = "capture";
let format = "mp4";
let formatSpecified = false;
let selected = false;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (["--motion", "--prepare", "--publish", "--annotate"].includes(arg)) {
    if (selected) {
      writeSync(2, "preflight: select only one operation\n");
      process.exit(2);
    }
    mode = arg.slice(2);
    selected = true;
  } else if (arg === "--format") {
    format = args[++index];
    formatSpecified = true;
    if (!["mp4", "gif"].includes(format)) {
      writeSync(2, "preflight: --format must be mp4 or gif\n");
      process.exit(2);
    }
  } else if (arg !== "--json") {
    writeSync(2, `preflight: unknown option ${arg}\n`);
    process.exit(2);
  }
}
if (formatSpecified && !["motion", "prepare"].includes(mode)) {
  writeSync(2, "preflight: --format requires --motion or --prepare\n");
  process.exit(2);
}

const checks = [];
const add = (name, ok, detail, fix = null, required = true) =>
  checks.push({ name, ok, detail, fix, required });

if (["capture", "motion", "annotate"].includes(mode)) {
  const version = run("agent-browser", ["--version"]);
  const hasBrowser = version.status === 0;
  const versionMatch = version.stdout?.match(/\b(\d+)\.(\d+)\.(\d+)(-[\w.-]+)?/);
  const meetsMotionVersion = Boolean(versionMatch) && (
    Number(versionMatch[1]) > 0 || Number(versionMatch[2]) > 38 ||
    (Number(versionMatch[2]) === 38 && Number(versionMatch[3]) > 1) ||
    (Number(versionMatch[2]) === 38 && Number(versionMatch[3]) === 1 && !versionMatch[4])
  );
  const motion = mode === "motion";
  if (!hasBrowser) {
    add("agent-browser", false, "not found", hint("agent-browser"));
  } else if (motion && !meetsMotionVersion) {
    add("agent-browser", false, `${version.stdout.trim() || "version unknown"}; motion requires 0.38.1 or newer`,
      "upgrade agent-browser to 0.38.1 or newer using its existing installation method");
  } else {
    add("agent-browser", true, version.stdout.trim() || "installed");
  }

  if (hasBrowser) {
    const doctor = run("agent-browser", ["doctor", "--offline", "--quick", "--json"]);
    let chrome;
    let diagnostic = "agent-browser doctor did not report Chrome availability; inspect its diagnostic output";
    try {
      chrome = JSON.parse(doctor.stdout).checks?.find((check) => check.id === "chrome.installed");
    } catch {
      diagnostic = doctor.stdout?.trim()
        ? "agent-browser doctor returned invalid JSON; inspect its diagnostic output"
        : "agent-browser doctor failed to produce a diagnostic; inspect the environment and retry";
    }
    if (chrome?.status === "pass") {
      add("Chrome", true, "installed");
    } else if (chrome?.status === "fail") {
      add("Chrome", false, chrome.message || "not installed", "agent-browser install");
    } else {
      add("Chrome", false, diagnostic);
    }
  } else {
    add("Chrome", false, "cannot check without agent-browser");
  }
}

if (["motion", "prepare"].includes(mode)) {
  const ffmpeg = run("ffmpeg", ["-version"]).status === 0;
  add("ffmpeg", ffmpeg, ffmpeg ? "installed" : "not found", ffmpeg ? null : hint("ffmpeg"));
  if (ffmpeg) {
    const encoders = run("ffmpeg", ["-hide_banner", "-encoders"]);
    const encoder = format === "gif" ? (mode === "motion" ? "libvpx" : "gif") : "libx264";
    const found = encoders.status === 0 && new RegExp(`^\\s*[A-Z.]{6}\\s+${encoder}(?:\\s|$)`, "m").test(encoders.stdout);
    add(encoder === "gif" ? "GIF encoder" : encoder, found,
      found ? "available" : `FFmpeg lacks the ${encoder} encoder`,
      found ? null : `use an FFmpeg build with ${encoder} support`);
  }
}
if (mode === "prepare") {
  const ffprobe = run("ffprobe", ["-version"]).status === 0;
  add("ffprobe", ffprobe, ffprobe ? "installed" : "not found", ffprobe ? null : hint("ffmpeg"));
  const montage = run("magick", ["montage", "-version"]).status === 0 ||
    run("montage", ["-version"]).status === 0;
  add("ImageMagick montage", montage, montage ? "installed" : "not found",
    montage ? null : hint("imagemagick"));
}
if (mode === "annotate") {
  const candidates = process.platform === "win32" ? ["magick"] : ["magick", "convert"];
  const binary = candidates.find((candidate) => run(candidate, ["-version"]).status === 0);
  add("ImageMagick", Boolean(binary), binary ? `found as ${binary}` : "not found",
    binary ? null : hint("imagemagick"));
}
if (["prepare", "annotate"].includes(mode)) {
  const font = existsSync(FONT_PATH);
  add("bundled font", font, font ? "present" : "missing from the skill",
    font ? null : "reinstall the skill; the font ships with it");
}

if (mode === "publish") {
  const gh = run("gh", ["--version"]);
  const installed = gh.status === 0;
  add("gh CLI", installed, installed ? gh.stdout.split("\n")[0] : "not found",
    installed ? null : hint("gh"));
  if (installed) {
    const auth = run("gh", ["auth", "token"]);
    const authenticated = auth.status === 0 && Boolean(auth.stdout?.trim());
    add("gh authentication", authenticated, authenticated ? "authenticated" : "no token for this host",
      authenticated ? null : "gh auth login");
    const help = run("gh", ["pr", "edit", "--help"]);
    const native = help.status === 0 && /(?:^|\s)--attach(?:[=\s,]|$)/m.test(help.stdout);
    add("gh native attachments", native,
      native ? "available" : "unavailable or could not inspect; standard body/new-comment uploads need gh 2.99.0 or newer; some layouts use direct attachments",
      null, false);
  }
}

const failed = checks.filter((check) => check.required && !check.ok);
if (args.includes("--json")) {
  console.log(JSON.stringify({ ok: failed.length === 0, mode, ...(["motion", "prepare"].includes(mode) ? { format } : {}), checks }, null, 2));
} else {
  for (const check of checks) {
    const mark = check.ok ? "  ok " : check.required ? "MISS " : " opt ";
    console.log(`${mark} ${check.name.padEnd(18)} ${check.detail}`);
  }
  if (failed.length > 0) {
    for (const check of failed) if (check.fix) console.log(`  ${check.name}: ${check.fix}`);
    if (failed.some((check) => check.fix && /(?:brew install|sudo apt install|winget install|npm i -g|agent-browser install)/.test(check.fix))) {
      console.log("Ask before installing system packages, global npm modules, or Chrome.");
    }
  }
}
process.exitCode = failed.length === 0 ? 0 : 1;
