#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { argValue, die, gitRoot, output, runResult, runText } from "./lib.mjs";

const args = process.argv.slice(2);
const command = args[0];
const root = gitRoot();
if (!root) die("run inside the target Git repository");
const pathArg = argValue(args, "--path");
if (!command || !pathArg) usage();
const path = resolve(pathArg);

if (command === "open") {
  const ticket = argValue(args, "--ticket");
  const branch = argValue(args, "--branch");
  const base = argValue(args, "--base");
  if (!ticket || !branch || !base) die("open requires --ticket, --branch, --base, and --path");
  const worktrees = runResult("git", ["worktree", "list", "--porcelain"], { cwd: root }).stdout;
  if (listedWorktrees(worktrees).some((listed) => samePath(listed, path))) {
    output({ ticket, branch, path, state: "already-open" }, true);
    process.exit(0);
  }
  if (existsSync(path)) die(`target path already exists outside Git worktree state: ${path}`);
  const branchExists = runResult("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: root }).code === 0;
  const commandArgs = branchExists
    ? ["worktree", "add", path, branch]
    : ["worktree", "add", "-b", branch, path, base];
  const result = runResult("git", commandArgs, { cwd: root });
  if (result.code !== 0) die(result.stderr.trim() || "git worktree add failed");
  output({ ticket, branch, base, path, state: "open" }, true);
} else if (command === "close") {
  const listed = runResult("git", ["worktree", "list", "--porcelain"], { cwd: root }).stdout;
  if (!listedWorktrees(listed).some((worktree) => samePath(worktree, path))) die(`worktree is not open: ${path}`);
  if (runText("git", ["status", "--porcelain"], { cwd: path, allowFail: true })) die(`worktree is dirty: ${path}`);
  const result = runResult("git", ["worktree", "remove", path], { cwd: root });
  if (result.code !== 0) die(result.stderr.trim() || "git worktree remove failed");
  output({ path, state: "closed" }, true);
} else usage();

function usage() {
  die("usage: worktree.mjs <open|close> --path <path> [--ticket <id> --branch <branch> --base <base>]");
}

function listedWorktrees(output) {
  return output
    .split("\n")
    .filter((line) => line.startsWith("worktree "))
    .map((line) => line.slice("worktree ".length));
}

function samePath(left, right) {
  const canonical = (value) => {
    const absolute = resolve(value);
    const normalized = existsSync(absolute) ? realpathSync.native(absolute) : absolute;
    return process.platform === "win32" ? normalized.toLowerCase() : normalized;
  };
  return canonical(left) === canonical(right);
}
