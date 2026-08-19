import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = join(repositoryRoot, "skills", "implement-program", "scripts");
const temporary = mkdtempSync(join(tmpdir(), "implement-program-test-"));

try {
  testConfiguration();
  testLedgerFrontierAndConcurrency();
  testLeasesAndWorktrees();
  testTrainInitialization();
  testPullRequestGate();
  testPreflight();
  console.log("Implement program behavior passed.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function testConfiguration() {
  const repo = createRepository("config");
  const resolved = runJSON("config.mjs", ["--json"], repo);
  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(resolved.json.config.agents.implementation.model, "gpt-5.6-luna");
  assert.equal(resolved.json.config.agents.implementation.reasoning, "max");
  assert.deepEqual(resolved.json.config.concurrency, {
    maxActiveSubagents: 5,
    implementation: 4,
    review: 2,
    research: 2,
  });

  mkdirSync(join(repo, ".agents"));
  writeFileSync(join(repo, ".agents", "implement-program.json"), JSON.stringify({
    agents: { implementation: { reasoning: "high" } },
  }));
  const invalid = runJSON("config.mjs", ["--json"], repo);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /floor profile must use/);
}

function testLedgerFrontierAndConcurrency() {
  const repo = createRepository("ledger");
  const runDir = join(repo, ".scratch", "implement-program", "example");
  const planPath = join(repo, "plan.json");
  writeFileSync(planPath, JSON.stringify({
    runId: "example",
    parentSpec: "#100",
    defaultBranch: git(repo, ["branch", "--show-current"]),
    baselineSha: "abc123",
    integrationBranch: "program/100",
    acceptanceCriteria: [{ id: "AC1", text: "Program qualifies", evidence: [] }],
    config: {
      agents: { implementation: { model: "gpt-5.6-luna", reasoning: "max", quality: "floor", availability: "prefer" } },
      concurrency: { maxActiveSubagents: 3 },
    },
    tickets: [
      { id: "1", title: "foundation", blockers: [], priority: 1, anticipated: { known: true, paths: ["src/a"], resources: [], migration: false } },
      { id: "2", title: "consumer", blockers: ["1"], priority: 2, anticipated: { known: true, paths: ["src/b"], resources: [], migration: false } },
      { id: "3", title: "parallel", blockers: [], priority: 3, anticipated: { known: true, paths: ["src/c"], resources: [], migration: false } },
      { id: "4", title: "overlap", blockers: [], priority: 4, anticipated: { known: true, paths: ["src/a/child"], resources: [], migration: false } },
    ],
  }));
  const initialized = runJSON("ledger.mjs", ["init", "--plan", planPath, "--run-dir", runDir], repo);
  assert.equal(initialized.status, 0, initialized.stderr);
  const dashboard = readFileSync(join(runDir, "status.md"), "utf8");
  assert.match(dashboard, /\| #1 foundation \|/);
  assert.match(dashboard, /planned 4/);

  const ledgerPath = join(runDir, "run.json");
  const frontier = runJSON("frontier.mjs", ["--ledger", ledgerPath, "--json"], repo);
  assert.deepEqual(frontier.json.frontier, ["1", "3", "4"]);
  const concurrent = runJSON("concurrency.mjs", ["--ledger", ledgerPath, "--capacity", "3", "--json"], repo);
  assert.equal(concurrent.json.configuredMaximum, 3);
  assert.equal(concurrent.json.harnessCapacity, 3);
  assert.equal(concurrent.json.maximum, 3);
  assert.deepEqual(concurrent.json.selected, ["1", "3"]);
  assert.match(concurrent.json.deferred.find((ticket) => ticket.id === "4").reason, /path ownership/);

  const ledger = JSON.parse(readFileSync(ledgerPath, "utf8"));
  ledger.config.concurrency.maxActiveSubagents = 5;
  writeFileSync(ledgerPath, JSON.stringify(ledger));
  const roomy = runJSON("concurrency.mjs", ["--ledger", ledgerPath, "--capacity", "8", "--json"], repo);
  assert.equal(roomy.json.configuredMaximum, 5);
  assert.equal(roomy.json.harnessCapacity, 8);
  assert.equal(roomy.json.maximum, 5);

  for (const state of ["active", "review", "merge-eligible", "integrated"]) {
    const changed = runJSON("ledger.mjs", ["set", "--run-dir", runDir, "--ticket", "1", "--state", state], repo);
    assert.equal(changed.status, 0, changed.stderr);
  }
  const advanced = runJSON("frontier.mjs", ["--ledger", ledgerPath, "--json"], repo);
  assert.deepEqual(advanced.json.frontier, ["2", "3", "4"]);
  const invalid = runJSON("ledger.mjs", ["set", "--run-dir", runDir, "--ticket", "1", "--state", "active"], repo);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /invalid transition/);
  const profile = runJSON("ledger.mjs", ["profile", "--run-dir", runDir, "--ticket", "2", "--role", "implementation", "--model", "gpt-5.6-luna", "--reasoning", "max", "--reason", "configured default"], repo);
  assert.equal(profile.status, 0, profile.stderr);
  assert.equal(profile.json.resolved.model, "gpt-5.6-luna");
  const evidence = runJSON("ledger.mjs", [
    "evidence", "--run-dir", runDir, "--criterion", "AC1",
    "--ticket", "1", "--pr", "https://example.test/pr/1", "--commit", "abc123",
    "--review", "review:1", "--verification", "check:1",
  ], repo);
  assert.equal(evidence.status, 0, evidence.stderr);
  assert.equal(evidence.json.evidence[0].ticket, "1");
  const qualification = runJSON("qualification.mjs", ["--ledger", ledgerPath, "--json"], repo);
  assert.equal(qualification.status, 1);
  assert.deepEqual(qualification.json.incompleteTickets, ["2", "3", "4"]);
}

function testLeasesAndWorktrees() {
  const repo = createRepository("lanes");
  const runDir = join(repo, ".scratch", "implement-program", "lanes");
  const acquired = runJSON("leases.mjs", ["acquire", "--run-dir", runDir, "--owner", "1", "--resource", "port:4101", "--resource", "database:one"], repo);
  assert.equal(acquired.status, 0, acquired.stderr);
  assert.equal(acquired.json.leases.length, 2);
  const conflict = runJSON("leases.mjs", ["acquire", "--run-dir", runDir, "--owner", "2", "--resource", "port:4101"], repo);
  assert.equal(conflict.status, 1);
  assert.match(conflict.stderr, /held by 1/);
  const released = runJSON("leases.mjs", ["release", "--run-dir", runDir, "--owner", "1", "--resource", "port:4101"], repo);
  assert.equal(released.status, 0, released.stderr);
  assert.deepEqual(released.json.leases.map((lease) => lease.resource), ["database:one"]);
  const reacquired = runJSON("leases.mjs", ["acquire", "--run-dir", runDir, "--owner", "2", "--resource", "port:4101"], repo);
  assert.equal(reacquired.status, 0, reacquired.stderr);
  const staleLock = join(runDir, "leases.lock");
  writeFileSync(staleLock, JSON.stringify({ pid: 99999999 }));
  const recovered = runJSON("leases.mjs", ["acquire", "--run-dir", runDir, "--owner", "3", "--resource", "port:4102"], repo);
  assert.equal(recovered.status, 0, recovered.stderr);

  const lane = join(temporary, "lane-worktree");
  const opened = runJSON("worktree.mjs", ["open", "--ticket", "1", "--branch", "program/issue-1", "--base", "HEAD", "--path", lane], repo);
  assert.equal(opened.status, 0, opened.stderr);
  assert.equal(opened.json.state, "open");
  const closed = runJSON("worktree.mjs", ["close", "--path", lane], repo);
  assert.equal(closed.status, 0, closed.stderr);
  assert.equal(closed.json.state, "closed");
}

function testPullRequestGate() {
  const repo = createRepository("pr-gate");
  const snapshot = join(repo, "pr.json");
  writeFileSync(snapshot, JSON.stringify({
    number: 42,
    state: "OPEN",
    isDraft: false,
    baseRefName: "program/spec-1",
    baseRefOid: "base123",
    headRefName: "program/issue-1",
    latestPushAt: "2026-08-17T12:00:00.000Z",
    requiredChecks: [{ name: "test", status: "COMPLETED", conclusion: "SUCCESS" }],
    reviews: [{ author: "coderabbitai" }],
    comments: [],
    unresolvedThreads: 0,
    queryComplete: true,
    threadsQueryComplete: true,
  }));
  const ready = runJSON("pr-gate.mjs", [
    "--snapshot", snapshot,
    "--ready-at", "2026-08-17T12:00:00.000Z",
    "--now", "2026-08-17T12:02:01.000Z",
    "--expected-base", "program/spec-1",
    "--expected-base-sha", "base123",
    "--expected-head", "program/issue-1",
    "--findings-cleared",
    "--bots", "coderabbit,greptile",
  ], repo);
  assert.equal(ready.status, 0, ready.stderr);
  assert.equal(ready.json.candidate, true);
  assert.deepEqual(ready.json.respondedBots, ["coderabbit"]);
  assert.deepEqual(ready.json.missingBots, ["greptile"]);

  const waiting = runJSON("pr-gate.mjs", [
    "--snapshot", snapshot,
    "--ready-at", "2026-08-17T12:00:00.000Z",
    "--now", "2026-08-17T12:00:30.000Z",
    "--expected-base", "program/spec-1",
    "--expected-base-sha", "base123",
    "--expected-head", "program/issue-1",
    "--findings-cleared",
  ], repo);
  assert.equal(waiting.status, 1);
  assert.equal(waiting.json.observationElapsed, false);

  writeFileSync(snapshot, JSON.stringify({
    number: 42,
    state: "OPEN",
    isDraft: false,
    baseRefName: "program/spec-1",
    baseRefOid: "base123",
    headRefName: "program/issue-1",
    latestPushAt: "2026-08-17T12:00:00.000Z",
    requiredChecks: [],
    reviews: [{ author: "reviewer", state: "CHANGES_REQUESTED" }],
    unresolvedThreads: 0,
    queryComplete: true,
    threadsQueryComplete: false,
  }));
  const unsafe = runJSON("pr-gate.mjs", [
    "--snapshot", snapshot,
    "--ready-at", "2026-08-17T12:00:00.000Z",
    "--now", "2026-08-17T12:03:00.000Z",
    "--expected-base", "program/spec-1",
    "--expected-base-sha", "base123",
    "--expected-head", "program/issue-1",
    "--findings-cleared",
  ], repo);
  assert.equal(unsafe.status, 1);
  assert.equal(unsafe.json.queryComplete, false);
  assert.deepEqual(unsafe.json.changesRequested, ["reviewer"]);
}

function testTrainInitialization() {
  const repo = createRepository("train");
  const bare = join(temporary, "train-origin.git");
  git(temporary, ["init", "--bare", "-q", bare]);
  git(repo, ["remote", "set-url", "origin", bare]);
  const base = git(repo, ["branch", "--show-current"]);
  git(repo, ["push", "-u", "origin", `${base}:${base}`]);
  const body = join(repo, "umbrella.md");
  writeFileSync(body, [
    "<!-- implement-program:human:start -->",
    "Program notes",
    "<!-- implement-program:human:end -->",
    "<!-- implement-program:generated:start -->",
    "Program dashboard",
    "<!-- implement-program:generated:end -->",
    "",
  ].join("\n"));
  const fakeBin = join(temporary, "train-bin");
  mkdirSync(fakeBin, { recursive: true });
  const fakeGhEnvironment = writeFakeGh(fakeBin, `const command = process.argv.slice(2, 4).join(" ");
if (command === "pr view") process.exit(1);
if (command === "pr create") {
  console.log("https://github.com/example/project/pull/1");
  process.exit(0);
}
process.exit(2);
`);
  const initialized = runJSON("train.mjs", [
    "init", "--branch", "program/spec-1", "--base", base,
    "--title", "Program spec 1", "--body-file", body,
  ], repo, fakeGhEnvironment);
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.equal(initialized.json.state, "created");
  assert.equal(initialized.json.pullRequest.url, "https://github.com/example/project/pull/1");
  assert.equal(git(repo, ["show-ref", "--verify", "--quiet", "refs/remotes/origin/program/spec-1"]), "");
}

function testPreflight() {
  const repo = createRepository("preflight");
  writeFileSync(join(repo, ".gitignore"), ".scratch/\n");
  const fakeBin = join(temporary, "bin");
  mkdirSync(fakeBin, { recursive: true });
  const fakeGhEnvironment = writeFakeGh(fakeBin, `if (process.argv[2] === "--version") {
  console.log("gh test");
  process.exit(0);
}
process.exit(1);
`);
  const result = runJSON("preflight.mjs", ["--json"], repo, fakeGhEnvironment);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.ok, true);
  assert.equal(result.json.checks.find((check) => check.name === "ledger ignore").ok, true);
}

function createRepository(name) {
  const directory = join(temporary, name);
  mkdirSync(directory, { recursive: true });
  git(directory, ["init", "-q"]);
  git(directory, ["config", "user.email", "test@example.com"]);
  git(directory, ["config", "user.name", "Test User"]);
  writeFileSync(join(directory, "README.md"), `${name}\n`);
  git(directory, ["add", "README.md"]);
  git(directory, ["commit", "-qm", "initial"]);
  git(directory, ["remote", "add", "origin", "git@github.com:example/project.git"]);
  return directory;
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function writeFakeGh(directory, source) {
  const script = join(directory, "fake-gh.mjs");
  writeFileSync(script, source);
  return {
    GH_BIN: process.execPath,
    GH_BIN_ARGS: JSON.stringify([script]),
  };
}

function runJSON(script, args, cwd, environment = {}) {
  const result = spawnSync(process.execPath, [join(scripts, script), ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
  let json = null;
  try { json = JSON.parse(result.stdout); } catch {}
  return { ...result, json };
}
