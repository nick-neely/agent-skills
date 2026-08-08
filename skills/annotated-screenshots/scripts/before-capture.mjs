#!/usr/bin/env node
// Manage the git worktree that serves the "before" state.
//
// Usage:
//   node before-capture.mjs create [--ref main] [--dir <path>]
//   node before-capture.mjs remove [--dir <path>]
//
// This owns the worktree only. Installing dependencies and starting a dev
// server inside it stays with the caller, which knows the project's commands.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const HELP = `before-capture.mjs - create or remove the base-ref worktree

  node before-capture.mjs create [--ref <branch>] [--dir <path>]
  node before-capture.mjs remove [--dir <path>]

  --ref <branch>  Base to compare against (default: the remote default branch)
  --dir <path>    Worktree location (default: a temporary directory)
`;

function die(message) {
  console.error(`before-capture: ${message}`);
  process.exit(1);
}

function git(args, options = {}) {
  try {
    return execFileSync("git", args, { encoding: "utf8", ...options }).trim();
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
    if (arg === "--ref") options.ref = argv[++i];
    else if (arg === "--dir") options.dir = argv[++i];
    else die(`unknown option ${arg}`);
  }
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(command ? 0 : 1);
  }
  if (!["create", "remove"].includes(command)) die(`unknown command "${command}"\n\n${HELP}`);
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
const worktreeDir = resolve(options.dir ?? join(tmpdir(), `annotated-screenshots-before-${slug}`));

if (command === "remove") {
  if (!existsSync(worktreeDir)) {
    console.log(JSON.stringify({ removed: false, reason: "not present", path: worktreeDir }));
    process.exit(0);
  }
  gitOrDie(["worktree", "remove", "--force", worktreeDir]);
  gitOrDie(["worktree", "prune"]);
  console.log(JSON.stringify({ removed: true, path: worktreeDir }));
  process.exit(0);
}

if (existsSync(worktreeDir)) {
  die(
    `worktree path already exists: ${worktreeDir}\n` +
      `Run \`node before-capture.mjs remove\` first, or pass a different --dir.`,
  );
}

const base = options.ref ?? defaultBase();
let mergeBase;
try {
  mergeBase = git(["merge-base", "HEAD", base]);
} catch {
  die(`could not find a merge base between HEAD and "${base}". Fetch the base branch and retry.`);
}

gitOrDie(["worktree", "add", "--detach", worktreeDir, mergeBase]);

console.log(
  JSON.stringify(
    {
      path: worktreeDir,
      base,
      mergeBase,
      next: [
        "Install dependencies inside the worktree using this project's own command.",
        "Start its dev server on a free port, or on the same port as the after-server if the surface needs authentication.",
        "Capture the before screenshots, then run `before-capture.mjs remove`.",
      ],
    },
    null,
    2,
  ),
);
