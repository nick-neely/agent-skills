#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, execSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const beforeCapture = join(repo, "skills", "ui-evidence", "scripts", "before-capture.mjs");
const annotate = join(repo, "skills", "ui-evidence", "scripts", "annotate.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "ui-evidence-resources-test-"));
  const checkout = join(root, "project");
  const temporary = join(root, "temporary");
  mkdirSync(checkout);
  mkdirSync(temporary);
  const git = (...args) => execFileSync("git", args, { cwd: checkout, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init");
  git("symbolic-ref", "HEAD", "refs/heads/main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  writeFileSync(join(checkout, "app.txt"), "base\n");
  writeFileSync(join(checkout, ".gitignore"), "ignored-build/\n");
  git("add", "app.txt", ".gitignore");
  git("commit", "-m", "base");
  git("checkout", "-b", "feature");
  writeFileSync(join(checkout, "app.txt"), "after\n");
  git("commit", "-am", "after");
  const env = { ...process.env, TMPDIR: temporary, TEMP: temporary, TMP: temporary };
  const run = (...args) => spawnSync(process.execPath, [beforeCapture, ...args], {
    cwd: checkout, encoding: "utf8", env,
  });
  const runAsync = (...args) => new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [beforeCapture, ...args], {
      cwd: checkout, env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", reject);
    child.on("close", (status) => resolveResult({ status, stdout, stderr }));
  });
  return { root, checkout, temporary, git, run, runAsync, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("default creation prints an explicit cleanup command and can remove a clean worktree", () => {
  const project = fixture();
  try {
    const created = project.run("create");
    assert.equal(created.status, 0, created.stderr);
    const info = JSON.parse(created.stdout);
    assert.equal(info.base, "main");
    assert.equal(info.mergeBase, project.git("rev-parse", "main"));
    assert.match(info.removeCommand, /remove --dir /);
    assert.ok(info.removeCommand.includes(info.path));
    assert.ok(info.removeCommand.includes(info.owner));
    const canonical = realpathSync.native(info.path);
    const gitPath = project.git("-C", info.path, "rev-parse", "--show-toplevel");
    assert.equal(realpathSync.native(gitPath), canonical);
    const removed = project.run("remove", "--dir", info.path, "--owner", info.owner);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(JSON.parse(removed.stdout).removed, true);
    assert.equal(JSON.parse(removed.stdout).path, canonical);
  } finally {
    project.cleanup();
  }
});

test("annotations isolate concurrent sessions and close their own session after success or failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "ui-evidence-annotation-test-"));
  try {
    const sessions = join(root, "sessions");
    const log = join(root, "opens.log");
    const preload = join(root, "browser-boundary.mjs");
    mkdirSync(sessions);
    writeFileSync(join(sessions, "capture-session"), "keep this session");
    writeFileSync(preload, String.raw`
      import cp from "node:child_process";
      import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { syncBuiltinESMExports } from "node:module";
      import { fileURLToPath } from "node:url";
      cp.execFileSync = (binary, args) => {
        if (binary === "magick") {
          if (args.includes("identify")) return "40x20";
          if (args.includes("-version")) return "";
        }
        if (binary !== "agent-browser") throw new Error("unexpected command " + binary);
        if (args[0] === "--version") return "agent-browser 0.38.1";
        if (args[0] !== "--session") throw new Error("missing browser session");
        const session = join(process.env.FAKE_SESSIONS, args[1]);
        const command = args[2];
        if (command === "open") {
          writeFileSync(session, fileURLToPath(args[3]));
          appendFileSync(process.env.FAKE_OPENS, args[1] + "\n");
          const start = Date.now();
          const gate = new Int32Array(new SharedArrayBuffer(4));
          while (readFileSync(process.env.FAKE_OPENS, "utf8").trim().split("\n").length < 2) {
            if (Date.now() - start > 5000) throw new Error("timed out waiting for concurrent open");
            Atomics.wait(gate, 0, 0, 10);
          }
        } else if (command === "eval") return JSON.stringify({ data: { result: 20 } });
        else if (command === "set") { /* no-op */ }
        else if (command === "screenshot") {
          if (process.env.FAKE_FAIL_SHOT === "1") throw new Error("simulated screenshot failure");
          const html = readFileSync(readFileSync(session, "utf8"), "utf8");
          writeFileSync(args.at(-1), html);
        } else if (command === "close") rmSync(session, { force: true });
        else throw new Error("unexpected browser command " + command);
        return "";
      };
      syncBuiltinESMExports();
    `);
    writeFileSync(join(root, "image.png"), "fake image");
    const run = (label, failShot = false) => new Promise((resolveResult, reject) => {
      const spec = join(root, `${label}.json`);
      const out = join(root, `${label}.png`);
      writeFileSync(spec, JSON.stringify({ image: "image.png", annotations: [
        { type: "label", at: [20, 10], text: label },
      ] }));
      const child = spawn(process.execPath, [annotate, "--spec", spec, "--out", out], {
        env: { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, NODE_TEST_CONTEXT: "",
          FAKE_SESSIONS: sessions, FAKE_OPENS: log, FAKE_FAIL_SHOT: failShot ? "1" : "0" },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (data) => { stdout += data; });
      child.stderr.on("data", (data) => { stderr += data; });
      child.on("error", reject);
      child.on("close", (status) => resolveResult({ status, stdout, stderr, out }));
    });
    const results = await Promise.all([run("first-only"), run("second-only")]);
    for (const result of results) assert.equal(result.status, 0, result.stderr);
    assert.match(readFileSync(results[0].out, "utf8"), /first-only/);
    assert.doesNotMatch(readFileSync(results[0].out, "utf8"), /second-only/);
    assert.match(readFileSync(results[1].out, "utf8"), /second-only/);
    const opened = readFileSync(log, "utf8").trim().split("\n");
    assert.equal(new Set(opened).size, 2);
    assert.deepEqual(readdirSync(sessions), ["capture-session"]);
    const failed = await run("failing-shot", true);
    assert.notEqual(failed.status, 0);
    assert.deepEqual(readdirSync(sessions), ["capture-session"]);
    assert.equal(readFileSync(join(sessions, "capture-session"), "utf8"), "keep this session");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("concurrent default creations reserve distinct worktree paths", async () => {
  const project = fixture();
  try {
    const results = await Promise.all([project.runAsync("create"), project.runAsync("create")]);
    for (const result of results) assert.equal(result.status, 0, result.stderr);
    const created = results.map((result) => JSON.parse(result.stdout));
    assert.notEqual(created[0].path, created[1].path);
    for (const info of created) {
      assert.ok(existsSync(info.path));
      assert.equal(project.run("remove", "--dir", info.path, "--owner", info.owner).status, 0);
    }
  } finally {
    project.cleanup();
  }
});

test("explicit paths round-trip through the printed removal command", () => {
  const project = fixture();
  try {
    const path = join(project.root, "before path's checkout");
    const created = project.run("create", "--ref", "feature", "--dir", path);
    assert.equal(created.status, 0, created.stderr);
    const info = JSON.parse(created.stdout);
    assert.equal(info.path, path);
    assert.equal(info.mergeBase, project.git("rev-parse", "HEAD"));
    const realPath = realpathSync.native(path);
    const removed = execSync(info.removeCommand, {
      cwd: project.checkout, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    assert.equal(JSON.parse(removed).path, realPath);
    assert.equal(existsSync(path), false);
  } finally {
    project.cleanup();
  }
});

test("removal requires a path and refuses a worktree from another repository", () => {
  const project = fixture();
  const other = fixture();
  try {
    const foreign = JSON.parse(other.run("create").stdout);
    assert.equal(project.run("remove").status, 1);
    const removed = project.run("remove", "--dir", foreign.path, "--owner", foreign.owner);
    assert.equal(removed.status, 1);
    assert.match(removed.stderr, /not registered.*repository/i);
    assert.ok(existsSync(join(foreign.path, "app.txt")));
  } finally {
    project.cleanup();
    other.cleanup();
  }
});

test("create rejects an option whose path or ref is missing", () => {
  const project = fixture();
  try {
    for (const option of ["--dir", "--ref"]) {
      const result = project.run("create", option);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /requires a value/i);
    }
    assert.deepEqual(readdirSync(project.temporary), []);
  } finally {
    project.cleanup();
  }
});

test("removal refuses tracked changes and untracked files and leaves them intact", () => {
  const project = fixture();
  try {
    const created = JSON.parse(project.run("create").stdout);
    const note = join(created.path, "notes.txt");
    writeFileSync(note, "keep this\n");
    const removed = project.run("remove", "--dir", created.path, "--owner", created.owner);
    assert.equal(removed.status, 1);
    assert.match(removed.stderr, /modified or untracked/i);
    assert.equal(readFileSync(note, "utf8"), "keep this\n");
    assert.ok(existsSync(created.path));
    unlinkSync(note);
    writeFileSync(join(created.path, "app.txt"), "uncommitted\n");
    const dirty = project.run("remove", "--dir", created.path, "--owner", created.owner);
    assert.equal(dirty.status, 1);
    assert.match(dirty.stderr, /modified or untracked/i);
    assert.equal(readFileSync(join(created.path, "app.txt"), "utf8"), "uncommitted\n");
  } finally {
    project.cleanup();
  }
});

test("help explains that normal removal deletes ignored files in the selected checkout", () => {
  const project = fixture();
  try {
    assert.match(project.run("--help").stdout, /also removes ignored files/i);
    const created = JSON.parse(project.run("create").stdout);
    const ignored = join(created.path, "ignored-build");
    mkdirSync(ignored);
    writeFileSync(join(ignored, "artifact"), "generated output");
    const removed = project.run("remove", "--dir", created.path, "--owner", created.owner);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(existsSync(created.path), false);
  } finally {
    project.cleanup();
  }
});

test("removal refuses a path that is not registered to the current repository", () => {
  const project = fixture();
  try {
    const unrelated = join(project.root, "unrelated");
    mkdirSync(unrelated);
    writeFileSync(join(unrelated, "keep.txt"), "keep\n");
    const removed = project.run("remove", "--dir", unrelated, "--owner", "not-an-owner");
    assert.equal(removed.status, 1);
    assert.match(removed.stderr, /not registered.*repository/i);
    assert.equal(readFileSync(join(unrelated, "keep.txt"), "utf8"), "keep\n");
  } finally {
    project.cleanup();
  }
});

test("removal refuses a clean registered worktree created by another tool", () => {
  const project = fixture();
  try {
    const foreign = join(project.root, "external-worktree");
    project.git("worktree", "add", "--detach", foreign, "HEAD");
    const original = readFileSync(join(foreign, "app.txt"));
    const removed = project.run("remove", "--dir", foreign);
    assert.equal(removed.status, 1);
    assert.match(removed.stderr, /ownership record/i);
    assert.deepEqual(readFileSync(join(foreign, "app.txt")), original);
  } finally {
    project.cleanup();
  }
});

test("a different run's owner ID cannot remove a clean owned worktree", () => {
  const project = fixture();
  try {
    const first = JSON.parse(project.run("create").stdout);
    const second = JSON.parse(project.run("create").stdout);
    assert.notEqual(first.owner, second.owner);
    const removed = project.run("remove", "--dir", second.path, "--owner", first.owner);
    assert.equal(removed.status, 1);
    assert.match(removed.stderr, /ownership record does not match/i);
    assert.ok(existsSync(join(second.path, "app.txt")));
    assert.equal(project.run("remove", "--dir", first.path, "--owner", first.owner).status, 0);
    assert.equal(project.run("remove", "--dir", second.path, "--owner", second.owner).status, 0);
  } finally {
    project.cleanup();
  }
});

test("an equivalent older recorded path still identifies the owned checkout", () => {
  const project = fixture();
  try {
    const created = JSON.parse(project.run("create").stdout);
    const admin = project.git("-C", created.path, "rev-parse", "--absolute-git-dir");
    const recordPath = join(admin, "ui-evidence-before-capture.json");
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    assert.equal(record.path, realpathSync.native(created.path));
    record.path = `${created.path}${sep}..${sep}${basename(created.path)}`;
    writeFileSync(recordPath, JSON.stringify(record));
    const removed = project.run("remove", "--dir", created.path, "--owner", created.owner);
    assert.equal(removed.status, 0, removed.stderr);
    assert.equal(existsSync(created.path), false);
  } finally {
    project.cleanup();
  }
});

test("a worktree moved after creation is refused when its recorded path no longer matches", () => {
  const project = fixture();
  try {
    const created = JSON.parse(project.run("create").stdout);
    const moved = join(project.root, "moved-worktree");
    project.git("worktree", "move", created.path, moved);
    const removed = project.run("remove", "--dir", moved, "--owner", created.owner);
    assert.equal(removed.status, 1);
    assert.match(removed.stderr, /ownership record does not match/i);
    assert.ok(existsSync(join(moved, "app.txt")));
  } finally {
    project.cleanup();
  }
});

test("a partial ownership-record write leaves the created worktree intact", () => {
  const project = fixture();
  try {
    const preload = join(project.root, "fail-ownership-write.mjs");
    const path = join(project.root, "partial-worktree");
    writeFileSync(preload, String.raw`
      import fs from "node:fs";
      import { syncBuiltinESMExports } from "node:module";
      const write = fs.writeFileSync;
      fs.writeFileSync = (path) => {
        write(path, "{", { flag: "wx" });
        throw new Error("simulated interrupted write");
      };
      syncBuiltinESMExports();
    `);
    const result = spawnSync(process.execPath, [beforeCapture, "create", "--dir", path], {
      cwd: project.checkout, encoding: "utf8", env: {
        ...process.env, TMPDIR: project.temporary, TEMP: project.temporary, TMP: project.temporary,
        NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, NODE_TEST_CONTEXT: "",
      },
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /could not write the ownership record/i);
    assert.ok(existsSync(join(path, "app.txt")));
    assert.equal(realpathSync.native(project.git("-C", path, "rev-parse", "--show-toplevel")), realpathSync.native(path));
    const removed = project.run("remove", "--dir", path, "--owner", "unknown");
    assert.equal(removed.status, 1);
    assert.match(removed.stderr, /no valid ownership record/i);
    assert.ok(existsSync(join(path, "app.txt")));
  } finally {
    project.cleanup();
  }
});

test("a malformed ownership record is refused without removing the checkout", () => {
  const project = fixture();
  try {
    const created = JSON.parse(project.run("create").stdout);
    const admin = project.git("-C", created.path, "rev-parse", "--absolute-git-dir");
    writeFileSync(join(admin, "ui-evidence-before-capture.json"), "null\n");
    const removed = project.run("remove", "--dir", created.path, "--owner", created.owner);
    assert.equal(removed.status, 1);
    assert.match(removed.stderr, /ownership record/i);
    assert.ok(existsSync(join(created.path, "app.txt")));
  } finally {
    project.cleanup();
  }
});

// Fake only the GitHub CLI boundary; Git runs for real.
function withPullRequest(project, pr) {
  const preload = join(project.root, "fake-gh.mjs");
  writeFileSync(preload, String.raw`
    import cp from "node:child_process";
    import { appendFileSync } from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    const real = cp.execFileSync;
    cp.execFileSync = (binary, args, options) => {
      if (binary !== "gh") return real(binary, args, options);
      appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify(args) + "\n");
      if (process.env.FAKE_PR === "fail") {
        const error = new Error("gh failed");
        error.stderr = Buffer.from("HTTP 401: Bad credentials");
        throw error;
      }
      return process.env.FAKE_PR;
    };
    syncBuiltinESMExports();
  `);
  const log = join(project.root, "gh.log");
  return (...args) => {
    const result = spawnSync(process.execPath, [beforeCapture, ...args], {
      cwd: project.checkout, encoding: "utf8", env: {
        ...process.env, TMPDIR: project.temporary, TEMP: project.temporary, TMP: project.temporary,
        NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`, NODE_TEST_CONTEXT: "",
        FAKE_PR: typeof pr === "string" ? pr : JSON.stringify(pr), FAKE_GH_LOG: log,
      },
    });
    return { ...result, gh: existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [] };
  };
}

function releaseBranch(project) {
  project.git("branch", "release", "HEAD");
  project.git("remote", "add", "origin", "https://github.com/Acme/demo.git");
  const oid = project.git("rev-parse", "release");
  project.git("update-ref", "refs/remotes/origin/release", oid);
  return oid;
}

test("a pull request baseline uses the branch the pull request targets, not the default branch", () => {
  const project = fixture();
  try {
    const oid = releaseBranch(project);
    const run = withPullRequest(project, { number: 12, baseRefName: "release", baseRefOid: oid, state: "OPEN" });
    const created = run("create", "--pr", "12", "--repo", "acme/demo");
    assert.equal(created.status, 0, created.stderr);
    const info = JSON.parse(created.stdout);
    assert.deepEqual(created.gh[0].slice(0, 4), ["pr", "view", "12", "--repo"]);
    assert.equal(info.base, "origin/release");
    assert.equal(info.ref, "origin/release");
    assert.equal(info.baseSource, "pull-request");
    assert.equal(info.baseRevision, oid);
    assert.equal(info.mergeBase, project.git("merge-base", "HEAD", oid));
    assert.notEqual(info.mergeBase, project.git("merge-base", "HEAD", "main"), "the default branch would select another baseline");
    assert.deepEqual(info.pullRequest, { repo: "acme/demo", number: 12, baseRefName: "release", baseRefOid: oid, state: "OPEN" });
    assert.equal(realpathSync.native(info.repoRoot), realpathSync.native(project.checkout));
    assert.equal(project.git("-C", info.path, "rev-parse", "HEAD"), info.mergeBase);
    const refused = project.run("remove", "--dir", info.path, "--owner", "not-the-owner");
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /ownership record does not match/);
    assert.equal(project.run("remove", "--dir", info.path, "--owner", info.owner).status, 0);
  } finally {
    project.cleanup();
  }
});

test("a stale local copy of the pull request base uses the revision GitHub reports and says so", () => {
  const project = fixture();
  try {
    const oid = releaseBranch(project);
    project.git("update-ref", "refs/remotes/origin/release", project.git("rev-parse", "main"));
    const created = withPullRequest(project, { number: 12, baseRefName: "release", baseRefOid: oid })(
      "create", "--pr", "12", "--repo", "acme/demo");
    assert.equal(created.status, 0, created.stderr);
    const info = JSON.parse(created.stdout);
    assert.equal(info.base, "release");
    assert.equal(info.ref, null);
    assert.equal(info.baseRevision, oid);
    assert.match(info.warnings.join("\n"), /origin\/release is at .* but the pull request base is .*git fetch origin release/);
    assert.equal(project.run("remove", "--dir", info.path, "--owner", info.owner).status, 0);
  } finally {
    project.cleanup();
  }
});

test("an explicit --ref overrides the pull request base and records the difference", () => {
  const project = fixture();
  try {
    const oid = releaseBranch(project);
    const created = withPullRequest(project, { number: 12, baseRefName: "release", baseRefOid: oid })(
      "create", "--pr", "12", "--repo", "acme/demo", "--ref", "main");
    assert.equal(created.status, 0, created.stderr);
    const info = JSON.parse(created.stdout);
    assert.equal(info.base, "main");
    assert.equal(info.baseSource, "explicit");
    assert.equal(info.mergeBase, project.git("merge-base", "HEAD", "main"));
    assert.equal(info.pullRequest.baseRefName, "release");
    assert.match(info.warnings.join("\n"), /--ref main overrides pull request #12's target branch release/);
    const unreadable = withPullRequest(project, "fail")("create", "--pr", "12", "--repo", "acme/demo", "--ref", "main");
    assert.equal(unreadable.status, 0, unreadable.stderr);
    assert.match(JSON.parse(unreadable.stdout).warnings.join("\n"), /could not be read .*Bad credentials.*used --ref/);
    for (const item of [info, JSON.parse(unreadable.stdout)]) {
      assert.equal(project.run("remove", "--dir", item.path, "--owner", item.owner).status, 0);
    }
  } finally {
    project.cleanup();
  }
});

test("an unavailable pull request baseline is refused with the fetch that fixes it", () => {
  const project = fixture();
  try {
    releaseBranch(project);
    const missing = "1".repeat(40);
    const created = withPullRequest(project, { number: 12, baseRefName: "release", baseRefOid: missing })(
      "create", "--pr", "12", "--repo", "acme/demo");
    assert.equal(created.status, 1);
    assert.match(created.stderr, /baseline unavailable: pull request #12 targets "release" at 1111111111/);
    assert.match(created.stderr, /git fetch origin release/);
    assert.match(created.stderr, /after-only evidence/);
    assert.deepEqual(readdirSync(project.temporary), []);
    const unreadable = withPullRequest(project, "fail")("create", "--pr", "12", "--repo", "acme/demo");
    assert.equal(unreadable.status, 1);
    assert.match(unreadable.stderr, /could not read pull request #12 in acme\/demo: HTTP 401/);
    for (const args of [["--pr", "12"], ["--repo", "acme/demo"], ["--pr", "twelve", "--repo", "acme/demo"]]) {
      const invalid = project.run("create", ...args);
      assert.equal(invalid.status, 1);
      assert.match(invalid.stderr, /--pr and --repo must be passed together|pull request number/);
    }
    assert.deepEqual(readdirSync(project.temporary), []);
  } finally {
    project.cleanup();
  }
});

test("without a pull request or --ref the remote default branch is selected and reported", () => {
  const project = fixture();
  try {
    const info = JSON.parse(project.run("create").stdout);
    assert.equal(info.baseSource, "default");
    assert.equal(info.base, "main");
    assert.equal(info.baseRevision, project.git("rev-parse", "main"));
    assert.equal(info.pullRequest, undefined);
    assert.equal(project.run("remove", "--dir", info.path, "--owner", info.owner).status, 0);
  } finally {
    project.cleanup();
  }
});
