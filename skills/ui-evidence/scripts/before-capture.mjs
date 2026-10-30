#!/usr/bin/env node
// Manage the git worktree that serves the "before" state.
//
// Usage:
//   node before-capture.mjs create [--pr <number> --repo <owner/name>] [--ref main] [--dir <path>]
//   node before-capture.mjs remove --dir <path> --owner <id>
//
// This owns the worktree only. Installing dependencies and starting a dev
// server inside it stays with the caller, which knows the project's commands.

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, writeFileSync, writeSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HELP = `before-capture.mjs - create or remove the base-ref worktree

  node before-capture.mjs create [--pr <number> --repo <owner/name>] [--ref <branch>] [--dir <path>]
  node before-capture.mjs remove --dir <path> --owner <id>

  --pr <number>       Use that pull request's target branch (requires --repo and gh)
  --repo <owner/name> Repository of the pull request; never inferred
  --ref <branch>      Explicit comparison branch; overrides --pr (default: remote default branch)
  --dir <path>        Worktree location (create defaults to a unique temporary directory)
  --owner <id>        Ownership identifier printed by create

The checkout is the merge base of HEAD with the selected branch. A pull request
base must be present locally at the revision GitHub reports; fetch it first.

Removal requires matching ownership, a registered clean worktree, and uses normal Git removal.
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

function ownershipPath(worktree) {
  return join(git(["-C", worktree, "rev-parse", "--absolute-git-dir"]), "ui-evidence-before-capture.json");
}

function parseArgs(argv) {
  const options = {};
  const command = argv[0];
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (["--ref", "--dir", "--owner", "--pr", "--repo"].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) die(`${arg} requires a value`);
      options[arg.slice(2)] = value;
    }
    else die(`unknown option ${arg}`);
  }
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(command ? 0 : 1);
  }
  if (!["create", "remove"].includes(command)) die(`unknown command "${command}"\n\n${HELP}`);
  if (command === "remove" && (options.ref || options.pr || options.repo)) die("--ref, --pr, and --repo are only valid for create");
  if (command === "create" && options.owner) die("--owner is only valid for remove");
  if (options.pr !== undefined && !/^[1-9]\d*$/.test(options.pr)) die("--pr must be a pull request number");
  if (options.repo !== undefined && !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo)) die("--repo must be an explicit owner/name");
  if (Boolean(options.pr) !== Boolean(options.repo)) die("--pr and --repo must be passed together");
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

function revision(ref) {
  try {
    return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  } catch {
    return null;
  }
}

// Remotes whose URL names the pull request's repository, origin first.
function matchingRemotes(repo) {
  const [owner, name] = repo.toLowerCase().split("/");
  const pattern = new RegExp(`[/:]${owner.replace(/[.]/g, "\\.")}/${name.replace(/[.]/g, "\\.")}(?:\\.git)?/?$`);
  let listing = "";
  try {
    listing = git(["remote", "-v"]);
  } catch {
    return [];
  }
  const remotes = [...new Set(listing.split("\n")
    .map((line) => line.split(/\s+/))
    .filter(([remote, url, kind]) => remote && kind === "(fetch)" && pattern.test(url.toLowerCase()))
    .map(([remote]) => remote))];
  return remotes.sort((a, b) => (a === "origin" ? -1 : b === "origin" ? 1 : 0));
}

function pullRequestBase(repo, number) {
  let raw;
  try {
    raw = execFileSync("gh", ["pr", "view", number, "--repo", repo, "--json", "number,baseRefName,baseRefOid,state"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("gh not found; install and authenticate gh, or pass --ref explicitly");
    throw new Error(error.stderr?.toString().trim() || error.message);
  }
  const pr = JSON.parse(raw);
  if (typeof pr.baseRefName !== "string" || !pr.baseRefName || !/^[0-9a-f]{40,64}$/.test(pr.baseRefOid ?? "")) {
    throw new Error("gh did not report the pull request's base branch and revision");
  }
  return { repo, number: Number(number), baseRefName: pr.baseRefName, baseRefOid: pr.baseRefOid, state: pr.state ?? null };
}

// Resolve the branch the pull request actually targets to a local revision.
// The baseline must match the revision GitHub reports, so a missing or stale
// local copy is refused with the fetch that fixes it.
function selectPullRequestBase(pr) {
  const remotes = matchingRemotes(pr.repo);
  const remote = remotes[0] ?? "origin";
  const tracking = remotes.map((name) => `${name}/${pr.baseRefName}`).find((ref) => revision(ref));
  const local = revision(pr.baseRefOid);
  const fetch = `git fetch ${remote} ${pr.baseRefName}`;
  if (!local) {
    die(`baseline unavailable: pull request #${pr.number} targets "${pr.baseRefName}" at ${pr.baseRefOid.slice(0, 10)}, ` +
      `which is not in this clone. Run ${fetch} and retry, or publish after-only evidence and state the limitation.`);
  }
  const warnings = [];
  if (!tracking) warnings.push(`no local remote-tracking branch for ${pr.baseRefName}; used the revision GitHub reports`);
  else if (revision(tracking) !== pr.baseRefOid) {
    warnings.push(`${tracking} is at ${revision(tracking).slice(0, 10)} but the pull request base is ` +
      `${pr.baseRefOid.slice(0, 10)}; used the pull request base. Run ${fetch} to update it.`);
  }
  const current = tracking && revision(tracking) === pr.baseRefOid;
  return { base: current ? tracking : pr.baseRefName, ref: current ? tracking : null, revision: pr.baseRefOid, warnings };
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
  // The native resolver expands Windows short names, so Git's long path and
  // a TEMP path like RUNNER~1 identify the same registered checkout.
  worktreeDir = realpathSync.native(worktreeDir);
  const worktrees = gitOrDie(["worktree", "list", "--porcelain", "-z"])
    .split("\0").filter((entry) => entry.startsWith("worktree "))
    .map((entry) => {
      const path = entry.slice("worktree ".length);
      try { return realpathSync.native(path); } catch { return null; }
    });
  if (!worktrees.includes(worktreeDir)) {
    die(`path is not registered as a worktree of this repository: ${worktreeDir}`);
  }
  let ownership;
  try {
    ownership = JSON.parse(readFileSync(ownershipPath(worktreeDir), "utf8"));
  } catch {
    die(`no valid ownership record for ${worktreeDir}. The worktree was left untouched.`);
  }
  if (!options.owner) die("remove requires the explicit --owner printed by create");
  let recordedPath;
  try {
    if (typeof ownership?.path === "string") recordedPath = realpathSync.native(ownership.path);
  } catch {
    // A missing or unresolvable recorded path cannot establish ownership.
  }
  if (!ownership || typeof ownership !== "object" || ownership.version !== 1 || recordedPath !== worktreeDir ||
      typeof ownership.owner !== "string" || !ownership.owner || ownership.owner !== options.owner) {
    die(`ownership record does not match this path and owner: ${worktreeDir}. The worktree was left untouched.`);
  }
  const status = gitOrDie(["-C", worktreeDir, "status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none"]);
  if (status) die(`worktree has modified or untracked files: ${worktreeDir}. Preserve or remove them before retrying.`);
  gitOrDie(["worktree", "remove", worktreeDir]);
  writeSync(1, `${JSON.stringify({ removed: true, path: worktreeDir })}\n`);
  process.exit(0);
}

let pullRequest = null;
let prError = null;
if (options.pr) {
  try {
    pullRequest = pullRequestBase(options.repo, options.pr);
  } catch (error) {
    if (!options.ref) die(`could not read pull request #${options.pr} in ${options.repo}: ${error.message}`);
    prError = error.message;
  }
}
const warnings = [];
let selection;
if (options.ref) {
  const resolved = revision(options.ref);
  if (!resolved) die(`could not resolve --ref "${options.ref}". Fetch the base branch and retry.`);
  selection = { base: options.ref, ref: options.ref, revision: resolved, source: "explicit" };
  if (pullRequest && pullRequest.baseRefName !== options.ref && !options.ref.endsWith(`/${pullRequest.baseRefName}`)) {
    warnings.push(`--ref ${options.ref} overrides pull request #${pullRequest.number}'s target branch ${pullRequest.baseRefName}`);
  }
  if (prError) warnings.push(`pull request #${options.pr} could not be read (${prError}); used --ref`);
} else if (pullRequest) {
  const selected = selectPullRequestBase(pullRequest);
  warnings.push(...selected.warnings);
  selection = { ...selected, source: "pull-request" };
} else {
  const base = defaultBase();
  selection = { base, ref: base, revision: revision(base), source: "default" };
}
const base = selection.base;
let mergeBase;
try {
  mergeBase = git(["merge-base", "HEAD", selection.revision ?? base]);
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
const owner = randomUUID();
try {
  const ownership = { version: 1, path: realpathSync.native(worktreeDir), owner };
  writeFileSync(ownershipPath(worktreeDir), `${JSON.stringify(ownership)}\n`, { flag: "wx", mode: 0o600 });
} catch (error) {
  die(`could not write the ownership record: ${error.message}\nThe worktree was left at ${worktreeDir}; inspect it before removing it manually.`);
}

function shellQuote(value) {
  return process.platform === "win32"
    ? `"${value.replaceAll('"', '\\"')}"`
    : `'${value.replaceAll("'", "'\\''")}'`;
}
const removeCommand = `node ${shellQuote(fileURLToPath(import.meta.url))} remove --dir ${shellQuote(worktreeDir)} --owner ${shellQuote(owner)}`;

console.log(
  JSON.stringify(
    {
      path: worktreeDir,
      owner,
      base,
      baseSource: selection.source,
      ref: selection.ref,
      baseRevision: selection.revision,
      mergeBase,
      repoRoot,
      ...(pullRequest ? { pullRequest } : {}),
      warnings,
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
