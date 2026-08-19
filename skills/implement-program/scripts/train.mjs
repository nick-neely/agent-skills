#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { argValue, die, gitRoot, output, runGhResult, runResult, runText } from "./lib.mjs";

const args = process.argv.slice(2);
const command = args[0];
const branch = argValue(args, "--branch");
const base = argValue(args, "--base");
const remote = argValue(args, "--remote") || "origin";
const root = gitRoot();
if (!root) die("run inside the target Git repository");
if (!command || !branch) usage();

if (command === "init") {
  const title = argValue(args, "--title");
  const bodyFile = argValue(args, "--body-file");
  if (!base || !title || !bodyFile) die("init requires --branch, --base, --title, and --body-file");
  const fetch = runResult("git", ["fetch", remote, base], { cwd: root });
  if (fetch.code !== 0) die(fetch.stderr.trim() || "could not fetch the default branch");
  const baselineRef = `refs/remotes/${remote}/${base}`;
  const baselineSha = runText("git", ["rev-parse", baselineRef], { cwd: root });
  validateBody(resolve(bodyFile));
  const localExists = runResult("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: root }).code === 0;
  if (!localExists) {
    const created = runResult("git", ["branch", branch, baselineSha], { cwd: root });
    if (created.code !== 0) die(created.stderr.trim() || "could not create integration branch");
  }
  const containsBaseline = runResult("git", ["merge-base", "--is-ancestor", baselineSha, branch], { cwd: root }).code === 0;
  if (!containsBaseline) die(`existing integration branch does not contain baseline ${baselineSha}`);
  const pushed = runResult("git", ["push", "-u", remote, branch], { cwd: root });
  if (pushed.code !== 0) die(pushed.stderr.trim() || "could not push integration branch");
  const existing = inspect(branch);
  if (existing) {
    if (existing.state !== "OPEN" || existing.baseRefName !== base || existing.headRefName !== branch) {
      die("existing umbrella pull request has the wrong state, base, or head");
    }
    validateBodyContent(existing.body || "");
    output({ baselineSha, branch, base, remote, pullRequest: existing, state: "existing" }, true);
    process.exit(0);
  }
  const created = runGhResult(["pr", "create", "--draft", "--base", base, "--head", branch, "--title", title, "--body-file", resolve(bodyFile)]);
  if (created.code !== 0) die(created.stderr.trim() || "could not create draft umbrella pull request");
  output({ baselineSha, branch, base, remote, pullRequest: { url: created.stdout.trim() }, state: "created" }, true);
} else if (command === "inspect") {
  const pullRequest = inspect(branch);
  if (!pullRequest) die(`no pull request found for ${branch}`);
  output({ branch, pullRequest }, true);
} else usage();

function inspect(head) {
  const result = runGhResult(["pr", "view", head, "--json", "number,url,state,isDraft,baseRefName,headRefName,body"]);
  if (result.code !== 0) return null;
  try { return JSON.parse(result.stdout); } catch { die("GitHub returned malformed pull request JSON"); }
}

function validateBody(path) {
  let body;
  try { body = readFileSync(path, "utf8"); } catch (error) { die(`could not read umbrella body: ${error.message}`); }
  validateBodyContent(body);
}

function validateBodyContent(body) {
  for (const marker of [
    "<!-- implement-program:human:start -->",
    "<!-- implement-program:human:end -->",
    "<!-- implement-program:generated:start -->",
    "<!-- implement-program:generated:end -->",
  ]) {
    if (!body.includes(marker)) die(`umbrella body is missing ${marker}`);
  }
}

function usage() {
  die("usage: train.mjs <init|inspect> --branch <branch> [--base <base> --remote <remote> --title <title> --body-file <path>]");
}
