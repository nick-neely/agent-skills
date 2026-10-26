#!/usr/bin/env node
// Manage the git worktree that serves the "before" state.
//
// Usage:
//   node before-capture.mjs create [--ref main] [--dir <path>]
//   node before-capture.mjs remove --dir <path>
//
// This owns the worktree only. Installing dependencies and starting a dev
// server inside it stays with the caller, which knows the project's commands.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, rmdirSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HELP = `before-capture.mjs - create or remove the base-ref worktree

  node before-capture.mjs create [--ref <branch>] [--dir <path>]
  node before-capture.mjs remove --dir <path>

  --ref <branch>  Compare against its merge base with HEAD (default: remote default branch)
  --dir <path>    Worktree location (create defaults to a unique temporary directory)

Removal requires a registered, clean worktree and uses normal Git removal.
Git also removes ignored files, such as dependencies and build output, from
that worktree. Inspect those files before removal if they need to be retained.
`;

function die(message) {
  writeSync(2, `before-capture: ${message}\n`);
  process.exit(1);
}

function git(args, options = {}) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...options }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    throw new Error(detail);
  }
}

function gitOrDie(args) {
  try {
    return git(args);
  } catch (error) {
    die(`git ${args[0]} failed: ${error.message}`);
  }
}

function parseArgs(argv) {
  const options = {};
  const command = argv[0];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--ref" || arg === "--dir") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) die(`${arg} requires a value`);
      if (arg === "--ref") options.ref = value;
      else options.dir = value;
    }
    else die(`unknown option ${arg}`);
  }
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(command ? 0 : 1);
  }
  if (!["create", "remove"].includes(command)) die(`unknown command "${command}"\n\n${HELP}`);
  if (command === "remove" && options.ref) die("--ref is only valid for create");
  return { command, options };
}

// Prefer the remote's own default branch; fall back to whichever conventional
// name exists locally.
function defaultBase() {
  try {
    const head = git(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
    if (head) return head.replace("refs/remotes/", "");
  } catch {
    // no origin/HEAD configured
  }
  for (const candidate of ["origin/main", "origin/master", "main", "master"]) {
    try {
      git(["rev-parse", "--verify", "--quiet", candidate]);
      return candidate;
    } catch {
      // try the next candidate
    }
  }
  die("could not determine a base branch. Pass --ref explicitly.");
}

const { command, options } = parseArgs(process.argv.slice(2));

try {
  git(["rev-parse", "--git-dir"], { stdio: ["ignore", "pipe", "ignore"] });
} catch {
  die("not inside a git repository");
}

const repoRoot = gitOrDie(["rev-parse", "--show-toplevel"]);
const slug = repoRoot.split(/[/\\]/).filter(Boolean).pop() ?? "repo";

if (command === "remove") {
  if (!options.dir) die("remove requires the explicit --dir printed by create");
  let worktreeDir = resolve(options.dir);
  if (!existsSync(worktreeDir)) {
    die(`worktree path does not exist: ${worktreeDir}`);
  }
  worktreeDir = realpathSync(worktreeDir);
  const worktrees = gitOrDie(["worktree", "list", "--porcelain", "-z"])
    .split("\0").filter((entry) => entry.startsWith("worktree "))
    .map((entry) => {
      const path = entry.slice("worktree ".length);
      try { return realpathSync(path); } catch { return resolve(path); }
    });
  if (!worktrees.includes(worktreeDir)) {
    die(`path is not registered as a worktree of this repository: ${worktreeDir}`);
  }
  const status = gitOrDie(["-C", worktreeDir, "status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none"]);
  if (status) die(`worktree has modified or untracked files: ${worktreeDir}. Preserve or remove them before retrying.`);
  gitOrDie(["worktree", "remove", worktreeDir]);
  writeSync(1, `${JSON.stringify({ removed: true, path: worktreeDir })}\n`);
  process.exit(0);
}

const base = options.ref ?? defaultBase();
let mergeBase;
try {
  mergeBase = git(["merge-base", "HEAD", base]);
} catch {
  die(`could not find a merge base between HEAD and "${base}". Fetch the base branch and retry.`);
}

const worktreeDir = options.dir
  ? resolve(options.dir)
  : mkdtempSync(join(tmpdir(), `ui-evidence-before-${slug}-`));
if (options.dir && existsSync(worktreeDir)) {
  die(`worktree path already exists: ${worktreeDir}. Pass a different --dir.`);
}
try {
  git(["worktree", "add", "--detach", worktreeDir, mergeBase]);
} catch (error) {
  if (!options.dir) {
    try { rmdirSync(worktreeDir); } catch { /* Preserve any files Git may have created. */ }
  }
  die(`git worktree failed: ${error.message}\nInspect ${worktreeDir} if a partial checkout remains.`);
}

function shellQuote(value) {
  return process.platform === "win32"
    ? `"${value.replaceAll('"', '\\"')}"`
    : `'${value.replaceAll("'", "'\\''")}'`;
}
const removeCommand = `node ${shellQuote(fileURLToPath(import.meta.url))} remove --dir ${shellQuote(worktreeDir)}`;

console.log(
  JSON.stringify(
    {
      path: worktreeDir,
      base,
      mergeBase,
      removeCommand,
      next: [
        "Install dependencies inside the worktree using this project's own command.",
        "Start its dev server on a free port and verify the intended route, fixture, and authenticated state.",
        `Capture the before screenshots, then run: ${removeCommand}`,
      ],
    },
    null,
    2,
  ),
);
