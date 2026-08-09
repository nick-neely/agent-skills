#!/usr/bin/env node
// Check every dependency the generated-image-assets scripts need, before any
// work begins.
//
// Usage:
//   node preflight.mjs [--json]
//
// Exits non-zero only when the chroma tier (chroma-matte, inspect-alpha,
// finish) is unusable. The full tier (segment.py) is legitimately optional,
// so its absence is reported but does not fail the check. Reports what to
// run, but installs nothing: venv creation and package downloads are the
// user's decision, not this script's.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)));
const SETUP_SCRIPT = join(SCRIPTS_DIR, "setup.mjs");
const CACHE_ROOT = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
const VENV_DIR = join(CACHE_ROOT, "generated-image-assets", "venv");
const MIN_PYTHON = [3, 11];

// Matches rembg's own default: $U2NET_HOME, else $XDG_DATA_HOME/.u2net, else
// ~/.u2net. Left at this default on purpose (see setup.mjs) rather than
// relocated under our own cache root.
const U2NET_HOME = resolve(
  (process.env.U2NET_HOME || join(process.env.XDG_DATA_HOME || homedir(), ".u2net")).replace(/^~/, homedir()),
);
const MODELS = ["isnet-general-use", "birefnet-general-lite", "u2net", "u2netp"];

const HELP = `preflight.mjs - verify the generated-image-assets scripts' dependencies

  node preflight.mjs [--json]

Exits 0 when the chroma tier is usable, 1 otherwise. The full tier is
reported but optional.
`;

function venvPython(venvDir) {
  return platform() === "win32" ? join(venvDir, "Scripts", "python.exe") : join(venvDir, "bin", "python3");
}

function has(binary, args = ["--version"]) {
  try {
    execFileSync(binary, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function findPython() {
  for (const candidate of ["python3", "python"]) {
    let out;
    try {
      out = execFileSync(candidate, ["--version"], { encoding: "utf8" });
    } catch {
      continue;
    }
    const match = out.match(/Python (\d+)\.(\d+)\.(\d+)/);
    if (!match) continue;
    return { binary: candidate, version: [Number(match[1]), Number(match[2]), Number(match[3])] };
  }
  return null;
}

function versionOk(version) {
  const [major, minor] = version;
  return major > MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor >= MIN_PYTHON[1]);
}

function indent(text) {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

// Actually imports the modules and captures the real error rather than just
// reporting a pass/fail, so a broken venv (packages installed but unable to
// load, e.g. a Nix-provided interpreter missing libstdc++.so.6) shows why,
// not just that the tier is unavailable.
function importCheck(python, modules) {
  if (!existsSync(python)) return { ok: false, error: null };
  try {
    execFileSync(python, ["-c", `import ${modules.join("; import ")}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.stderr ? err.stderr.toString().trim() : err.message };
  }
}

// Reads pyvenv.cfg to report which interpreter actually built the venv, the
// thing a user needs to know to debug a venv that exists but fails to
// import: it tells them what to pass to `setup.mjs --python`.
function venvBuiltFrom(venvDir) {
  const cfgPath = join(venvDir, "pyvenv.cfg");
  if (!existsSync(cfgPath)) return null;
  let text;
  try {
    text = readFileSync(cfgPath, "utf8");
  } catch {
    return null;
  }
  const info = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([\w.]+)\s*=\s*(.*)$/);
    if (match) info[match[1]] = match[2].trim();
  }
  return info.executable || info.home || null;
}

const checks = [];
const add = (name, ok, detail, fix = null, required = true) => {
  const check = { name, ok, detail, fix, required };
  checks.push(check);
  return check;
};

// Informational, not required. It matters only for BUILDING a venv, so an
// unusable python3 on PATH must not fail preflight when the venv already
// works. setup.mjs falls back to other interpreters anyway. The venv import
// check below is what decides whether the chroma tier is usable.
const python = findPython();
if (python) {
  const ok = versionOk(python.version);
  add(
    "python3",
    ok,
    `${python.binary} ${python.version.join(".")}${ok ? "" : ` (need ${MIN_PYTHON.join(".")}+ to build a venv)`}`,
    ok ? null : `install Python ${MIN_PYTHON.join(".")}+ if you need to rebuild the venv`,
    false,
  );
} else {
  add("python3", false, "not found", `install Python ${MIN_PYTHON.join(".")}+`, false);
}

const venvPy = venvPython(VENV_DIR);
const builtFrom = venvBuiltFrom(VENV_DIR);
const builtFromNote = builtFrom ? ` (built from ${builtFrom})` : "";

const chromaResult = importCheck(venvPy, ["PIL", "numpy"]);
const chromaOk = chromaResult.ok;
let chromaDetail;
if (chromaOk) {
  chromaDetail = `ready: ${venvPy}${builtFromNote}`;
} else if (!existsSync(venvPy)) {
  chromaDetail = `not ready at ${VENV_DIR}`;
} else {
  chromaDetail = `import failed using ${venvPy}${builtFromNote}:\n${indent(chromaResult.error)}`;
}
add(
  "venv (chroma tier)",
  chromaOk,
  chromaDetail,
  chromaOk
    ? null
    : existsSync(venvPy)
      ? `node "${SETUP_SCRIPT}"   (retries with fallback interpreters; add --python /path/to/python3 if that still fails)`
      : `node "${SETUP_SCRIPT}"`,
);

let fullOk = false;
let fullDetail;
if (!chromaOk) {
  fullDetail = "not installed (optional, needed only for segment.py)";
} else {
  const fullResult = importCheck(venvPy, ["rembg", "onnxruntime", "pymatting"]);
  fullOk = fullResult.ok;
  fullDetail = fullOk ? `ready: ${venvPy}` : `not ready: ${fullResult.error}`;
}
add(
  "venv (full tier)",
  fullOk,
  fullDetail,
  `node "${SETUP_SCRIPT}" --tier full --yes`,
  false,
);

const modelsPresent = existsSync(U2NET_HOME) ? new Set(readdirSync(U2NET_HOME)) : new Set();
for (const model of MODELS) {
  const cached = modelsPresent.has(`${model}.onnx`);
  add(
    `model: ${model}`,
    cached,
    cached ? `cached at ${U2NET_HOME}` : "not cached (segment.py downloads it on first use, ~170-220MB)",
    null,
    false,
  );
}

const hasFfmpeg = has("ffmpeg", ["-version"]);
add(
  "ffmpeg",
  hasFfmpeg,
  hasFfmpeg ? "available (format conversion only, not a matte-quality background remover)" : "not found (optional)",
  null,
  false,
);

let hasSharp = false;
try {
  execFileSync(process.execPath, ["-e", "require.resolve('sharp')"], { stdio: "ignore", cwd: process.cwd() });
  hasSharp = true;
} catch {
  hasSharp = false;
}
add(
  "sharp (in current project)",
  hasSharp,
  hasSharp ? "available, prefer it for trim/resize/pad after matting" : "not found in this project (optional; finish.py is the fallback)",
  null,
  false,
);

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const failed = checks.filter((check) => check.required && !check.ok);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ok: failed.length === 0, venvDir: VENV_DIR, u2netHome: U2NET_HOME, checks }, null, 2));
} else {
  for (const check of checks) {
    console.log(`${check.ok ? "  ok " : "MISS "} ${check.name.padEnd(26)} ${check.detail}`);
  }
  console.log(`\nrembg model cache: ${U2NET_HOME} (set $U2NET_HOME to use a different location)`);
  if (failed.length > 0) {
    console.log("\nMissing required dependencies. Run these, or ask the user to:\n");
    for (const check of failed) {
      if (check.fix) console.log(`  ${check.name}: ${check.fix}`);
    }
  }
  const optionalMissing = checks.filter((check) => !check.required && !check.ok && check.fix);
  if (optionalMissing.length > 0) {
    console.log("\nOptional, only needed for segment.py's model-based path:\n");
    for (const check of optionalMissing) {
      console.log(`  ${check.name}: ${check.fix}`);
    }
  }
}

process.exit(failed.length === 0 ? 0 : 1);
