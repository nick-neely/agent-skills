#!/usr/bin/env node
// Verify the local and live prerequisites for implementing a GitHub PR stack.
// This script diagnoses only. It never installs tools or changes Git config.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const HELP = `preflight.mjs - verify implement-stack prerequisites

  node preflight.mjs [--live] [--json]

--live verifies GitHub authentication. Run that mode through the harness's
host or escalated path when network access is sandboxed.
`;

const knownArguments = new Set(["--live", "--json", "--help", "-h"]);
const unknown = process.argv.slice(2).filter((argument) => !knownArguments.has(argument));
if (unknown.length > 0) {
  console.error(`Unknown argument(s): ${unknown.join(", ")}`);
  console.error(HELP);
  process.exit(2);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(HELP);
  process.exit(0);
}

const live = process.argv.includes("--live");
const json = process.argv.includes("--json");
const checks = [];

function add(name, ok, detail, fix = null, required = true) {
  checks.push({ name, ok, detail, fix, required });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    found: result.error?.code !== "ENOENT",
    status: result.status,
    stdout: result.stdout?.trim() || "",
    stderr: result.stderr?.trim() || "",
  };
}

function reason(result, fallback) {
  return result.stderr.split("\n")[0] || result.stdout.split("\n")[0] || fallback;
}

const gitVersion = run("git", ["--version"]);
const hasGit = gitVersion.found && gitVersion.status === 0;
add("git", hasGit, hasGit ? gitVersion.stdout : "not found", "install git");

const ghVersion = run("gh", ["--version"]);
const hasGh = ghVersion.found && ghVersion.status === 0;
add("gh CLI", hasGh, hasGh ? ghVersion.stdout.split("\n")[0] : "not found", "install GitHub CLI");

let inRepository = false;
if (hasGit) {
  const repository = run("git", ["rev-parse", "--is-inside-work-tree"]);
  inRepository = repository.status === 0 && repository.stdout === "true";
  add("Git worktree", inRepository, inRepository ? "present" : "current directory is not a Git worktree");
} else {
  add("Git worktree", false, "cannot check without git");
}

if (inRepository) {
  const activeOperations = [];
  for (const [name, marker] of [
    ["merge", "MERGE_HEAD"],
    ["rebase", "rebase-merge"],
    ["rebase", "rebase-apply"],
    ["cherry-pick", "CHERRY_PICK_HEAD"],
  ]) {
    const path = run("git", ["rev-parse", "--git-path", marker]);
    if (path.status !== 0) continue;
    const absolutePath = isAbsolute(path.stdout) ? path.stdout : resolve(process.cwd(), path.stdout);
    if (existsSync(absolutePath) && !activeOperations.includes(name)) activeOperations.push(name);
  }
  add(
    "Git operation",
    activeOperations.length === 0,
    activeOperations.length === 0 ? "none in progress" : `${activeOperations.join(" and ")} in progress`,
    activeOperations.length === 0 ? null : "finish or abort the active Git operation",
  );

  const worktree = run("git", ["status", "--porcelain"]);
  const changedEntries = worktree.stdout ? worktree.stdout.split("\n").length : 0;
  add(
    "worktree",
    worktree.status === 0 && changedEntries === 0,
    changedEntries === 0 ? "clean" : `${changedEntries} changed or untracked entr${changedEntries === 1 ? "y" : "ies"}`,
    changedEntries === 0 ? null : "inspect ownership before creating or changing stack branches",
    false,
  );

  const remoteResult = run("git", ["remote"]);
  const remotes = remoteResult.stdout ? remoteResult.stdout.split("\n").filter(Boolean) : [];
  add(
    "Git remote",
    remoteResult.status === 0 && remotes.length > 0,
    remotes.length > 0 ? remotes.join(", ") : "none configured",
    remotes.length > 0 ? null : "add the GitHub remote for this repository",
  );

  const pushDefault = run("git", ["config", "--get", "remote.pushDefault"]);
  const needsPushDefault = remotes.length > 1;
  add(
    "remote.pushDefault",
    !needsPushDefault || pushDefault.status === 0,
    needsPushDefault
      ? pushDefault.status === 0
        ? pushDefault.stdout
        : `required because ${remotes.length} remotes are configured`
      : "not required with zero or one remote",
    needsPushDefault && pushDefault.status !== 0
      ? "set remote.pushDefault to the intended push remote"
      : null,
  );

  const rerere = run("git", ["config", "--bool", "--get", "rerere.enabled"]);
  const rerereEnabled = rerere.status === 0 && rerere.stdout === "true";
  add(
    "rerere",
    rerereEnabled,
    rerereEnabled ? "enabled" : "disabled; conflict resolutions will not be remembered",
    rerereEnabled ? null : "git config rerere.enabled true",
    false,
  );
}

if (hasGh) {
  const credential = run("gh", ["auth", "token"]);
  add(
    "GitHub credential",
    credential.status === 0,
    credential.status === 0 ? "configured" : "no configured token",
    credential.status === 0 ? null : "gh auth login",
  );

  if (live) {
    const authentication = run("gh", ["auth", "status"]);
    add(
      "live GitHub authentication",
      authentication.status === 0,
      authentication.status === 0
        ? "authenticated"
        : reason(authentication, "authentication check failed"),
      authentication.status === 0 ? null : "retry through the host path, then run gh auth login if it still fails",
    );
  }

  const stackCommand = run("gh", ["stack", "--help"]);
  const hasStack = stackCommand.status === 0;
  add(
    "gh stack",
    hasStack,
    hasStack ? "available" : reason(stackCommand, "command unavailable"),
    hasStack ? null : "install or update GitHub CLI with gh stack support",
  );

  if (hasStack && inRepository) {
    const stack = run("gh", ["stack", "view", "--json"]);
    if (stack.status === 0) {
      add("stack state", true, "current branch belongs to a local stack");
    } else if (stack.status === 2) {
      add("stack state", true, "not currently in a stack; repository availability is confirmed by gh stack init");
    } else if (stack.status === 9) {
      add("stack state", false, "stacked pull requests are unavailable for this repository");
    } else {
      add(
        "stack state",
        false,
        reason(stack, `gh stack view exited ${stack.status}`),
        "follow the gh-stack recovery for this exit code",
      );
    }
  }
} else {
  add("GitHub credential", false, "cannot check without gh", "install GitHub CLI");
  if (live) add("live GitHub authentication", false, "cannot check without gh", "install GitHub CLI");
  add("gh stack", false, "cannot check without gh", "install GitHub CLI with gh stack support");
}

const failed = checks.filter((check) => check.required && !check.ok);
const result = { ok: failed.length === 0, live, checks };

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  for (const check of checks) {
    const mark = check.ok ? "  ok " : check.required ? "MISS " : "WARN ";
    console.log(`${mark} ${check.name.padEnd(28)} ${check.detail}`);
  }
  if (failed.length > 0) {
    console.log("\nRequired preflight checks failed:\n");
    for (const check of failed) {
      if (check.fix) console.log(`  ${check.name}: ${check.fix}`);
    }
  }
}

process.exit(result.ok ? 0 : 1);
