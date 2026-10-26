import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { options, api, snapshot, changed, acquireLock, watch } from "../skills/babysit-pr/scripts/pr-wait.mjs";

const config = options(["https://github.example/team/repo/pull/42"]);
assert.equal(config.host, "github.example");
assert.equal(config.repo, "team/repo");
assert.equal(options(["42", "--repo", "team/repo"]).target, "42");
assert.throws(() => options(["https://github.example/team/repo/pull/42", "--repo", "other/repo"]));
assert.throws(() => options(["42", "--repo", "team/repo", "--interval", "1"]));
assert.throws(() => options(["0", "--repo", "team/repo"]));

// All collection pages are consumed, including a finding beyond the first 100.
const pages = [Array.from({ length: 100 }, (_, id) => ({ id })), [{ id: 101 }]];
const entries = api(config.host, "repos/team/repo/pulls/42/reviews?per_page=100", ".", (command, args) => {
  assert.equal(command, "gh");
  assert.ok(args.includes("--paginate"));
  assert.ok(args.includes("--slurp"));
  assert.ok(!args.includes("--jq"));
  return { status: 0, stdout: JSON.stringify(pages) };
});
assert.equal(entries.length, 101);
assert.deepEqual(api(config.host, "checks", ".check_runs", () => ({
  status: 0, stdout: JSON.stringify([{ check_runs: [{ id: 1 }] }, { check_runs: [{ id: 2 }] }]),
})), [{ id: 1 }, { id: 2 }]);
assert.throws(() => api(config.host, "x", undefined, () => ({ status: 1, stderr: "rate limit exhausted" })), /rate limit exhausted/);

let head = "head-1";
let reviewBody = "finding";
let base = "base-1";
function read(host, endpoint, field) {
  assert.equal(host, config.host);
  if (endpoint.endsWith("/pulls/42")) return {
    head: { sha: head }, base: { sha: base, ref: "release" },
    state: "open", merged: false, draft: false, mergeable: true, mergeable_state: "clean",
  };
  assert.ok(endpoint.includes("per_page=100"));
  assert.ok(field);
  if (endpoint.includes("/reviews?")) return [...entries, { id: 102, body: reviewBody }];
  return [];
}
const first = snapshot(config, read);
assert.deepEqual(changed(first, snapshot(config, read)), []);
reviewBody = "edited finding";
assert.deepEqual(changed(first, snapshot(config, read)), ["reviews"]);
head = "head-2";
assert.ok(changed(first, snapshot(config, read)).includes("head"));
base = "base-2";
assert.ok(changed(first, snapshot(config, read)).includes("base"));
let calls = 0;
assert.equal(snapshot(config, (host, endpoint, field) => {
  if (endpoint.endsWith("/pulls/42") && ++calls === 2) head = "raced-head";
  return read(host, endpoint, field);
}), null);

const directory = mkdtempSync(join(tmpdir(), "pr-wait-test-"));
try {
  const path = join(directory, "lock");
  const release = acquireLock(path);
  assert.throws(() => acquireLock(path), error => error.exitCode === 3);
  release();
  acquireLock(path)();
  writeFileSync(path, "12345");
  assert.throws(() => acquireLock(path), /12345/);
  rmSync(path);

  // Persisted observations survive restarts; unchanged state times out, never
  // declaring readiness. A subsequent push produces a new event.
  const bounded = { ...config, timeout: 0.005 };
  assert.equal(await watch(bounded, directory, read), 0);
  assert.equal(await watch(bounded, directory, read), 1);
  head = "pushed-head";
  assert.equal(await watch(bounded, directory, read), 0);
  await assert.rejects(() => watch(bounded, directory, () => { throw new Error("unavailable"); }), /unavailable/);
} finally {
  rmSync(directory, { recursive: true, force: true });
}
process.stdout.write("PR waiter behavior tests passed.\n");
