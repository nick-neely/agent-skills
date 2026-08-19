#!/usr/bin/env node
import { activeGitOperation, gitRoot, hasCommand, output, runGhResult, runResult, runText } from "./lib.mjs";

const args = process.argv.slice(2);
const live = args.includes("--live");
const json = args.includes("--json");
const checks = [];
const add = (name, ok, required, detail) => checks.push({ name, ok, required, detail });

add("Node.js", true, true, process.version);
add("git command", hasCommand("git"), true, "git must be available");
const root = gitRoot();
add("Git repository", Boolean(root), true, root || "not inside a Git worktree");

if (root) {
  const operation = activeGitOperation(root);
  add("Git operation", !operation, true, operation ? `${operation} is active` : "none active");
  const dirty = Boolean(runText("git", ["status", "--porcelain"], { cwd: root, allowFail: true }));
  add("worktree", !dirty, false, dirty ? "dirty; preserve and assign ownership before branching" : "clean");
  const remotes = (runText("git", ["remote"], { cwd: root, allowFail: true }) || "").split("\n").filter(Boolean);
  add("Git remote", remotes.length > 0, true, remotes.join(", ") || "none configured");
  const ignored = runResult("git", ["check-ignore", "-q", "--no-index", ".scratch/implement-program/probe"], { cwd: root }).code === 0;
  add("ledger ignore", ignored, true, ignored ? ".scratch/implement-program is ignored" : "add an ignore rule before initializing a ledger");
}

const gh = runGhResult(["--version"]).code === 0;
add("GitHub CLI", gh, true, gh ? "available" : "gh is not available");
if (live && gh) {
  const auth = runGhResult(["auth", "status"]);
  add("live GitHub authentication", auth.code === 0, true, auth.code === 0 ? "authenticated" : auth.stderr.trim() || "authentication failed");
  const repo = runGhResult(["repo", "view", "--json", "nameWithOwner,defaultBranchRef"]);
  add("live repository", repo.code === 0, true, repo.code === 0 ? repo.stdout.trim() : repo.stderr.trim() || "repository lookup failed");
}

const ok = checks.every((check) => check.ok || !check.required);
const result = { ok, root, live, checks };
if (json) output(result, true);
else for (const check of checks) console.log(`${check.ok ? "PASS" : check.required ? "FAIL" : "WARN"} ${check.name}: ${check.detail}`);
process.exit(ok ? 0 : 1);
