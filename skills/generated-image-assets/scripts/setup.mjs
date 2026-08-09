#!/usr/bin/env node
// setup.mjs - create or update the shared venv for generated-image-assets scripts.
//
// Usage:
//   node setup.mjs [--tier chroma|full] [--yes] [--python /path/to/python3]
//
// Tiers:
//   chroma  Pillow + NumPy only. Enough for chroma-matte.py, inspect-alpha.py,
//           and finish.py. Default.
//   full    Adds rembg + onnxruntime + pymatting for segment.py. Downloads
//           roughly 500MB, so it requires --yes; without it, this prints what
//           it would do and exits.
//
// The venv lives at $XDG_CACHE_HOME/generated-image-assets/venv (or
// ~/.cache/... when XDG_CACHE_HOME is unset), so every script in this skill,
// Node or Python, agrees on one location. Re-running against an already
// correct venv skips pip entirely and is fast.
//
// The rembg model cache (~/.u2net by default, or $U2NET_HOME) is left where
// rembg puts it rather than relocated here: models are large, and moving them
// would force a redownload for anyone who already has them cached.
//
// Interpreter selection: a bare `python3` on PATH is not always able to run
// numpy's compiled extensions (Nix-provided interpreters are a known case:
// they run, but fail with a missing libstdc++.so.6 the moment numpy is
// imported). There is no cheap way to detect this ahead of time, so by
// default this script tries a short, deduplicated list of candidate
// interpreters, actually building and importing into each, until one works.
// Pass --python to skip that search and use exactly the interpreter given.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync, renameSync, rmSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)));
const CACHE_ROOT = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
const VENV_DIR = join(CACHE_ROOT, "generated-image-assets", "venv");
const MIN_PYTHON = [3, 11];
const MAX_ATTEMPTS = 3;

// Tried in order when --python is not given. `python3` on PATH goes first so
// the user's own environment wins when it works; /usr/bin/python3 is the
// most common "known good" system interpreter and a reasonable second guess;
// the versioned names catch interpreters that exist but are not on PATH
// under a bare `python3`.
const FALLBACK_CANDIDATES = ["python3", "/usr/bin/python3", "python3.12", "python3.13", "python3.11"];

const TIER_IMPORTS = {
  chroma: ["PIL", "numpy"],
  full: ["PIL", "numpy", "rembg", "onnxruntime", "pymatting"],
};

const HELP = `setup.mjs - create or update the generated-image-assets venv

  node setup.mjs [--tier chroma|full] [--yes] [--python /path/to/python3]

Tiers:
  chroma  Pillow + NumPy only. Enough for chroma-matte, inspect-alpha, and
          finish. Default.
  full    Adds rembg + onnxruntime + pymatting for segment.py. Downloads
          roughly 500MB and requires --yes.

Interpreter selection:
  --python /path/to/python3   Use exactly this interpreter. Never falls back;
                               a failure is reported and exits non-zero.
  (default)                   Tries python3 from PATH, then /usr/bin/python3,
                               then python3.12, python3.13, python3.11,
                               deduplicated by resolved path, stopping at the
                               first one that actually builds a working venv.
                               Up to ${MAX_ATTEMPTS} interpreters are tried.

Prints the venv's python path on success.
`;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function indent(text) {
  return text
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function venvPython(venvDir) {
  return platform() === "win32" ? join(venvDir, "Scripts", "python.exe") : join(venvDir, "bin", "python3");
}

function versionOk(version) {
  const [major, minor] = version;
  return major > MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor >= MIN_PYTHON[1]);
}

// Runs the candidate interpreter for real (not just `--version`) so a bare
// name gets resolved through PATH the same way it will be when we later
// invoke it for venv creation, and so the resolved realpath can be used to
// dedup interpreters that are the same binary under different names.
function probeCandidate(binary) {
  let out;
  try {
    out = execFileSync(
      binary,
      ["-c", "import sys; print('%d.%d.%d' % sys.version_info[:3]); print(sys.executable)"],
      { encoding: "utf8" },
    );
  } catch (err) {
    return { ok: false, error: err.stderr ? err.stderr.toString().trim() : err.message };
  }
  const [versionLine, executableLine] = out.trim().split("\n");
  const match = versionLine && versionLine.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return { ok: false, error: `could not parse a python version from: ${versionLine}` };
  }
  const version = [Number(match[1]), Number(match[2]), Number(match[3])];
  let resolvedPath;
  try {
    resolvedPath = realpathSync(executableLine || binary);
  } catch {
    resolvedPath = executableLine || binary;
  }
  return { ok: true, binary, version, resolvedPath };
}

function probeAndCheckVersion(binary) {
  const probe = probeCandidate(binary);
  if (!probe.ok) return probe;
  if (!versionOk(probe.version)) {
    return { ok: false, error: `found Python ${probe.version.join(".")}, need ${MIN_PYTHON.join(".")}+` };
  }
  return probe;
}

function buildCandidates() {
  const seen = new Set();
  const result = [];
  for (const name of FALLBACK_CANDIDATES) {
    const probe = probeAndCheckVersion(name);
    if (!probe.ok) continue;
    if (seen.has(probe.resolvedPath)) continue;
    seen.add(probe.resolvedPath);
    result.push(probe);
  }
  return result;
}

function verifyImports(python, tier) {
  const imports = TIER_IMPORTS[tier].join("; import ");
  try {
    execFileSync(python, ["-c", `import ${imports}`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.stderr ? err.stderr.toString().trim() : err.message };
  }
}

function satisfiesTier(python, tier) {
  if (!existsSync(python)) return false;
  return verifyImports(python, tier).ok;
}

// Creates a fresh venv with `candidate`, installs the tier's requirements,
// and verifies the imports for real. Always starts from a clean venv
// directory so a previous candidate's partial install cannot leak into this
// attempt or be mistaken for this candidate's result.
function attemptBuild(candidate, tier) {
  if (existsSync(VENV_DIR)) {
    rmSync(VENV_DIR, { recursive: true, force: true });
  }
  mkdirSync(dirname(VENV_DIR), { recursive: true });
  console.log(`creating venv at ${VENV_DIR} with ${candidate.binary} (${candidate.version.join(".")})`);
  try {
    execFileSync(candidate.binary, ["-m", "venv", VENV_DIR], { stdio: "inherit" });
  } catch (err) {
    return { ok: false, stage: "venv creation", error: err.message };
  }

  const venvPy = venvPython(VENV_DIR);
  const requirements = join(SCRIPTS_DIR, `requirements-${tier}.txt`);
  console.log(`installing ${tier} tier from ${requirements}`);
  try {
    execFileSync(venvPy, ["-m", "pip", "install", "-r", requirements], { stdio: "inherit" });
  } catch (err) {
    return { ok: false, stage: "pip install", error: err.message };
  }

  const verify = verifyImports(venvPy, tier);
  if (!verify.ok) {
    return { ok: false, stage: "import verification", error: verify.error };
  }
  return { ok: true };
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const tierIndex = args.indexOf("--tier");
const tier = tierIndex >= 0 ? args[tierIndex + 1] : "chroma";
if (!["chroma", "full"].includes(tier)) {
  fail(`error: --tier must be chroma or full, got: ${tier}`);
}
const yes = args.includes("--yes");

const pythonIndex = args.indexOf("--python");
let explicitPython = null;
if (pythonIndex >= 0) {
  explicitPython = args[pythonIndex + 1];
  if (!explicitPython) fail("error: --python requires a path argument.");
}

const python = venvPython(VENV_DIR);

if (satisfiesTier(python, tier)) {
  console.log(`ok: venv already satisfies the ${tier} tier: ${python}`);
  process.exit(0);
}

if (tier === "full" && !yes) {
  console.log(`The full tier is not yet installed at ${VENV_DIR}.`);
  console.log("Installing it downloads roughly 500MB (rembg, onnxruntime, pymatting and their dependencies).");
  console.log("Re-run with --yes to proceed:");
  console.log(`  node "${join(SCRIPTS_DIR, "setup.mjs")}" --tier full --yes`);
  process.exit(0);
}

let candidates;
if (explicitPython) {
  const probe = probeAndCheckVersion(explicitPython);
  if (!probe.ok) {
    fail(`error: --python ${explicitPython} is not usable: ${probe.error}`);
  }
  candidates = [probe];
} else {
  candidates = buildCandidates();
  if (candidates.length === 0) {
    fail(
      "error: no usable python3 found on PATH or in the default fallback locations.\n" +
        `install Python ${MIN_PYTHON.join(".")}+ and re-run, or pass --python /path/to/python3.`,
    );
  }
}

const attemptCandidates = explicitPython ? candidates : candidates.slice(0, MAX_ATTEMPTS);

// Hold any existing venv aside rather than destroying it up front, so a
// failed rebuild (a full-tier upgrade that cannot resolve, say) leaves the
// working environment intact instead of no environment at all. Moving it back
// restores it to the path it was created for, which matters because a venv
// bakes its own absolute path into the scripts in bin/.
const BACKUP_DIR = `${VENV_DIR}.previous-${process.pid}`;
let backedUp = false;
if (existsSync(VENV_DIR)) {
  rmSync(BACKUP_DIR, { recursive: true, force: true });
  renameSync(VENV_DIR, BACKUP_DIR);
  backedUp = true;
}
const discardBackup = () => {
  if (backedUp) rmSync(BACKUP_DIR, { recursive: true, force: true });
  backedUp = false;
};
const restoreBackup = () => {
  if (!backedUp) return;
  rmSync(VENV_DIR, { recursive: true, force: true });
  renameSync(BACKUP_DIR, VENV_DIR);
  backedUp = false;
  console.error(`kept the previous venv at ${VENV_DIR}.`);
};

const failures = [];
let chosen = null;

for (const candidate of attemptCandidates) {
  console.log(`trying ${candidate.binary} (resolved: ${candidate.resolvedPath})`);
  const result = attemptBuild(candidate, tier);
  if (result.ok) {
    chosen = candidate;
    break;
  }
  console.error(`  failed at ${result.stage}`);
  failures.push({ candidate, stage: result.stage, error: result.error });
}

if (!chosen) {
  rmSync(VENV_DIR, { recursive: true, force: true });
  restoreBackup();

  let message;
  if (explicitPython) {
    const { stage, error } = failures[0];
    message =
      `error: --python ${explicitPython} failed at ${stage}:\n\n` +
      `${indent(error)}\n\n` +
      "This interpreter cannot build a working venv for the " +
      `${tier} tier. Pass a different --python pointing at a working interpreter ` +
      "(a system python3, such as /usr/bin/python3 if present, is a reasonable place to start).";
  } else {
    const tried = failures
      .map(({ candidate, stage, error }) => `  ${candidate.binary} (resolved: ${candidate.resolvedPath})\n` +
        `    failed at ${stage}:\n${indent(error)}`)
      .join("\n\n");
    message =
      `error: could not build a working venv for the ${tier} tier after trying ${failures.length} interpreter(s):\n\n` +
      `${tried}\n\n` +
      "Next step: rerun with --python /path/to/python3 pointing at a known-good interpreter.";
  }
  fail(message);
}

discardBackup();

if (failures.length > 0) {
  console.log("");
  console.log("The following interpreter(s) did not work:");
  for (const { candidate, stage, error } of failures) {
    console.log(`  ${candidate.binary} (resolved: ${candidate.resolvedPath}) failed at ${stage}:`);
    console.log(indent(error));
  }
  console.log(`\nusing ${chosen.binary} instead: your default python3 is not suitable for this venv.`);
}

console.log(venvPython(VENV_DIR));
