import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preflight = join(
  repositoryRoot,
  "skills",
  "implement-stack",
  "scripts",
  "preflight.mjs",
);
const temporary = mkdtempSync(join(tmpdir(), "implement-stack-test-"));
const fakeBin = join(temporary, "bin");

mkdirSync(fakeBin, { recursive: true });
writeFakeGh(fakeBin);

try {
  const readyRepo = createRepository("ready");
  const ready = runPreflight(readyRepo, ["--json"]);
  assert.equal(ready.status, 0, ready.stderr);
  assert.equal(ready.json.ok, true);
  assert.match(check(ready, "stack state").detail, /not currently in a stack/);
  assert.equal(check(ready, "worktree").ok, true);

  const liveAuth = runPreflight(readyRepo, ["--live", "--json"], {
    FAKE_GH_AUTH_STATUS: "fail",
  });
  assert.equal(liveAuth.status, 1);
  assert.equal(check(liveAuth, "live GitHub authentication").ok, false);

  const dirtyRepo = createRepository("dirty");
  writeFileSync(join(dirtyRepo, "work-in-progress.txt"), "uncommitted\n");
  const dirty = runPreflight(dirtyRepo, ["--json"]);
  assert.equal(dirty.status, 0, dirty.stderr);
  assert.equal(check(dirty, "worktree").ok, false);
  assert.equal(check(dirty, "worktree").required, false);

  const multiRemoteRepo = createRepository("multiple-remotes");
  git(multiRemoteRepo, ["remote", "add", "upstream", "git@github.com:example/upstream.git"]);
  const multiRemote = runPreflight(multiRemoteRepo, ["--json"]);
  assert.equal(multiRemote.status, 1);
  assert.equal(check(multiRemote, "remote.pushDefault").ok, false);

  const unavailableRepo = createRepository("unavailable");
  const unavailable = runPreflight(unavailableRepo, ["--json"], {
    FAKE_GH_STACK_VIEW: "9",
  });
  assert.equal(unavailable.status, 1);
  assert.equal(check(unavailable, "stack state").ok, false);
  assert.match(check(unavailable, "stack state").detail, /unavailable/);

  const mergingRepo = createRepository("merging");
  const mergeHead = git(mergingRepo, ["rev-parse", "--git-path", "MERGE_HEAD"]);
  writeFileSync(resolve(mergingRepo, mergeHead), "0000000000000000000000000000000000000000\n");
  const merging = runPreflight(mergingRepo, ["--json"]);
  assert.equal(merging.status, 1);
  assert.equal(check(merging, "Git operation").ok, false);

  console.log("Implement stack preflight behavior passed.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

function createRepository(name) {
  const directory = join(temporary, name);
  mkdirSync(directory, { recursive: true });
  git(directory, ["init", "-q"]);
  git(directory, ["remote", "add", "origin", "git@github.com:example/project.git"]);
  return directory;
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function runPreflight(cwd, args, environment = {}) {
  const result = spawnSync(process.execPath, [preflight, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
      FAKE_GH_AUTH_STATUS: "ok",
      FAKE_GH_AUTH_TOKEN: "ok",
      FAKE_GH_STACK_VIEW: "2",
      ...environment,
    },
  });
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {}
  return { ...result, json };
}

function check(result, name) {
  assert.ok(result.json, `Expected JSON output, received:\n${result.stdout}\n${result.stderr}`);
  const found = result.json.checks.find((candidate) => candidate.name === name);
  assert.ok(found, `Missing check: ${name}`);
  return found;
}

function writeFakeGh(directory) {
  const fakeGh = join(directory, "fake-gh.mjs");
  writeFileSync(
    fakeGh,
    `const args = process.argv.slice(2).join(" ");
if (args === "--version") {
  console.log("gh version test");
  process.exit(0);
}
if (args === "auth token") {
  process.exit(process.env.FAKE_GH_AUTH_TOKEN === "fail" ? 1 : 0);
}
if (args === "auth status") {
  process.exit(process.env.FAKE_GH_AUTH_STATUS === "fail" ? 1 : 0);
}
if (args === "stack --help") {
  process.exit(0);
}
if (args === "stack view --json") {
  const status = Number(process.env.FAKE_GH_STACK_VIEW || "2");
  if (status === 0) console.log('{"trunk":"main","branches":[]}');
  if (status === 2) console.error("not part of a stack");
  if (status === 9) console.error("stacked PRs unavailable");
  process.exit(status);
}
console.error(\`unexpected gh invocation: \${args}\`);
process.exit(5);
`,
  );

  if (process.platform === "win32") {
    writeFileSync(
      join(directory, "gh.cmd"),
      `@echo off\r\n"${process.execPath}" "%~dp0\\fake-gh.mjs" %*\r\n`,
    );
  } else {
    const executable = join(directory, "gh");
    writeFileSync(
      executable,
      `#!/usr/bin/env sh\nexec "${process.execPath}" "${fakeGh}" "$@"\n`,
    );
    chmodSync(executable, 0o755);
  }
}
