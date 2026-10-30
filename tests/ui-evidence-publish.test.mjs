import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publish = join(repo, "skills", "ui-evidence", "scripts", "publish.mjs");
const temp = mkdtempSync(join(tmpdir(), "ui-evidence-publish-test-"));
const mock = join(temp, "github-boundary.mjs");
after(() => rmSync(temp, { recursive: true, force: true }));

// Fake the external GitHub boundary in the publisher process. State represents
// the saved GitHub body and comments, not internal publisher implementation.
writeFileSync(mock, String.raw`
import cp from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const statePath = process.env.UI_EVIDENCE_TEST_STATE;
const load = () => JSON.parse(readFileSync(statePath, "utf8"));
const save = (state) => writeFileSync(statePath, JSON.stringify(state));
function fail(message) { const error = new Error(message); error.stderr = Buffer.from(message); throw error; }
cp.execFileSync = (command, args, options = {}) => {
  if (command !== "gh") fail("unexpected command");
  const state = load();
  state.calls.push(args);
  const result = (value = "") => { save(state); return value; };
  const submittedBody = () => args.includes("--input") ? JSON.parse(String(options.input)).body : args.find((arg) => arg.startsWith("body=")).slice(5);
  if (args.includes("--help")) return result(state.oldGh ? "Usage: gh" : "Usage: gh\n  --attach string");
  if (args[0] === "auth" && args[1] === "token") return result("test-token\n");
  if (args[0] === "api") {
    const methodAt = args.indexOf("--method");
    const method = methodAt >= 0 ? args[methodAt + 1] : "GET";
    const path = args.find((item) => item === "user" || item.startsWith("repos/"));
    if (path === "user") return result(JSON.stringify({ login: "me" }));
    if (path === "repos/acme/demo") return result(JSON.stringify({ id: 42 }));
    if (/^repos\/acme\/demo\/(pulls|issues)\/123(?:\?.*)?$/.test(path)) {
      if (state.missingTarget) { save(state); fail("Not Found"); }
      if (method === "GET") {
        state.targetReads = (state.targetReads || 0) + 1;
        if (state.failReadback && state.targetReads > 1) { save(state); fail("Readback unavailable"); }
      }
      const isIssue = path.includes("/issues/");
      if (method === "PATCH") state.body = submittedBody();
      return result(JSON.stringify({ body: state.body, ...(isIssue && state.kind === "pr" ? { pull_request: {} } : {}) }));
    }
    if (/^repos\/acme\/demo\/issues\/123\/comments(?:\?.*)?$/.test(path)) {
      if (method === "POST") {
        const body = submittedBody();
        const comment = { id: state.nextId++, user: { login: "me" }, body };
        state.comments.push(comment);
        return result(JSON.stringify(comment));
      }
      return result(JSON.stringify([state.comments]));
    }
    const commentMatch = /^repos\/acme\/demo\/issues\/comments\/(\d+)$/.exec(path || "");
    if (commentMatch) {
      const comment = state.comments.find((item) => item.id === Number(commentMatch[1]));
      if (!comment) { save(state); fail("Not Found"); }
      if (method === "PATCH") comment.body = submittedBody();
      return result(JSON.stringify(comment));
    }
    fail("unexpected api " + JSON.stringify(args));
  }
  if ((args[0] === "pr" || args[0] === "issue") && (args[1] === "edit" || args[1] === "comment")) {
    let body = String(options.input ?? "");
    const files = [];
    args.forEach((arg, i) => { if (arg === "--attach") files.push(args[i + 1]); });
    for (const [index, file] of files.entries()) {
      if (state.nativeFailure && index > 0) break;
      const url = "https://github.com/user-attachments/assets/asset-" + (index + 1);
      const escaped = file.replace(/[.*+?^\u0024{}()|[\]\\]/g, "\\$&");
      const image = new RegExp("!\\[([^\\]]*)\\]\\((?:<" + escaped + ">|" + escaped + ")\\)", "g");
      if (!image.test(body)) body += "\n\n" + url + "\n";
      else {
        image.lastIndex = 0;
        body = body.replace(image, (_, alt) => /\.(mp4|mov|webm)$/i.test(file) ? url : "![" + alt + "](" + url + ")");
      }
    }
    if (args[1] === "edit") state.body = body;
    else state.comments.push({ id: state.nextId++, user: { login: "me" }, body });
    save(state);
    if (state.nativeFailure) fail("simulated native failure after write");
    return args[1] === "comment" ? "https://github.com/acme/demo/issues/123#issuecomment-" + (state.nextId - 1) : "https://github.com/acme/demo/pull/123";
  }
  fail("unexpected gh " + JSON.stringify(args));
};
syncBuiltinESMExports();
globalThis.fetch = async (url) => {
  const state = load();
  state.uploads.push(String(url));
  save(state);
  if (state.uploadFailure || state.uploadFailureAt === state.uploads.length) return { ok: false, status: 503 };
  return { ok: true, json: async () => ({ url: "https://github.com/user-attachments/assets/direct-" + state.uploads.length }) };
};
`);

function fixture(section, overrides = {}) {
  const dir = mkdtempSync(join(temp, "case-"));
  const statePath = join(dir, "github.json");
  const sectionPath = join(dir, "section.md");
  writeFileSync(sectionPath, section);
  writeFileSync(statePath, JSON.stringify({ body: "Introduction.\n", kind: "pr", comments: [], nextId: 300, calls: [], uploads: [], ...overrides }));
  return { dir, sectionPath, statePath };
}

function run(fixture, extra = [], omitRepo = false) {
  const result = spawnSync(process.execPath, [publish, ...(omitRepo ? [] : ["--repo", "acme/demo"]), "--target", "pr:123", "--section", fixture.sectionPath, ...extra], {
    encoding: "utf8",
    env: { ...process.env, NODE_TEST_CONTEXT: "", NODE_OPTIONS: `--import=${pathToFileURL(mock).href}`, UI_EVIDENCE_TEST_STATE: fixture.statePath },
  });
  return { ...result, github: JSON.parse(readFileSync(fixture.statePath, "utf8")) };
}

test("publishes a screenshot and playable video in the managed block", () => {
  const f = fixture("The finished screen:\n\n![Finished](screen.png)\n\nThe menu opens and closes.\n\n![](flow.mp4)\n");
  writeFileSync(join(f.dir, "screen.png"), "screenshot");
  writeFileSync(join(f.dir, "flow.mp4"), "video");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.github.body, /^Introduction\.\n\n<!-- ui-evidence:start -->/);
  assert.match(result.github.body, /!\[Finished\]\(https:\/\/github\.com\/user-attachments\/assets\/asset-1\)/);
  assert.match(result.github.body, /\n\nhttps:\/\/github\.com\/user-attachments\/assets\/asset-2\n\n<!-- ui-evidence:end -->/);
  assert.equal(JSON.parse(result.stdout).transport, "native-gh");
});

test("replaces one managed block and preserves prose on both sides", () => {
  const f = fixture("![A](a.png)\n\n![B](b.png)\n\n![A again](a.png)\n", {
    body: "Before.\n\n<!-- ui-evidence:start -->\nOld.\n<!-- ui-evidence:end -->\n\nAfter.\n",
  });
  writeFileSync(join(f.dir, "a.png"), "A");
  writeFileSync(join(f.dir, "b.png"), "B");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.github.body, /^Before\.\n\n<!-- ui-evidence:start -->/);
  assert.match(result.github.body, /<!-- ui-evidence:end -->\n\nAfter\.\n$/);
  assert.doesNotMatch(result.github.body, /Old\./);
  assert.equal((result.github.body.match(/<!-- ui-evidence:start -->/g) || []).length, 1);
  assert.match(result.github.body, /!\[A again\]\(https:\/\/github\.com\/user-attachments\/assets\/asset-1\)/);
  assert.equal(JSON.parse(result.stdout).readback.verified, true);
});

test("updates the older managed comment by ID and preserves unrelated comments and prose", () => {
  const f = fixture("![Updated](updated.png)\n", { comments: [
    { id: 1, user: { login: "me" }, body: "Keep before.\n\n<!-- ui-evidence:start -->\nOld.\n<!-- ui-evidence:end -->\n\nKeep after." },
    { id: 2, user: { login: "me" }, body: "A newer unrelated comment." },
  ] });
  writeFileSync(join(f.dir, "updated.png"), "image");
  const result = run(f, ["--mode", "comment"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.github.comments[1].body, "A newer unrelated comment.");
  assert.match(result.github.comments[0].body, /^Keep before\.\n\n<!-- ui-evidence:start -->/);
  assert.match(result.github.comments[0].body, /<!-- ui-evidence:end -->\n\nKeep after\.$/);
  assert.match(result.github.comments[0].body, /!\[Updated\]\(https:\/\/github\.com\/user-attachments\/assets\/direct-1\)/);
  const output = JSON.parse(result.stdout);
  assert.equal(output.commentId, 1);
  assert.equal(output.transport, "direct-attachment");
  assert.equal(output.readback.verified, true);
});

test("publishes HTML image tables and standalone video using direct attachments", () => {
  const f = fixture('<table><tr><td><img src="left.png" width="480"></td><td><img src="right.png"></td></tr></table>\n\nThe panel animates.\n\n![](flow.mov)\n');
  writeFileSync(join(f.dir, "left.png"), "left");
  writeFileSync(join(f.dir, "right.png"), "right");
  writeFileSync(join(f.dir, "flow.mov"), "video");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.github.body, /<img src="https:\/\/github\.com\/user-attachments\/assets\/direct-1" width="480">/);
  assert.match(result.github.body, /<img src="https:\/\/github\.com\/user-attachments\/assets\/direct-2">/);
  assert.match(result.github.body, /\n\nhttps:\/\/github\.com\/user-attachments\/assets\/direct-3\n\n/);
  const output = JSON.parse(result.stdout);
  assert.equal(output.transport, "direct-attachment");
  assert.deepEqual(output.readback.savedReferences, output.uploads.map((upload) => upload.url));
});

test("reads back a partial native failure and reports unresolved evidence without retrying", () => {
  const f = fixture("![One](one.png)\n\n![Two](two.png)\n", { nativeFailure: true });
  writeFileSync(join(f.dir, "one.png"), "first");
  writeFileSync(join(f.dir, "two.png"), "second");
  const result = run(f);
  assert.notEqual(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.readback.verified, false);
  assert.equal(output.readback.changed, true);
  assert.deepEqual(output.readback.savedReferences, ["https://github.com/user-attachments/assets/asset-1"]);
  assert.deepEqual(output.readback.unresolved, ["two.png"]);
  assert.match(output.error, /simulated native failure/);
  assert.equal(result.github.calls.filter((call) => call[0] === "pr" && call[1] === "edit" && !call.includes("--help")).length, 1);
  assert.equal(result.github.calls.filter((call) => call[0] === "release").length, 0);
});

test("reports a direct upload failure without changing the target or creating a release", () => {
  const f = fixture('<img src="one.png"><img src="two.png">', { uploadFailureAt: 2 });
  writeFileSync(join(f.dir, "one.png"), "first");
  writeFileSync(join(f.dir, "two.png"), "second");
  const result = run(f);
  assert.notEqual(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.match(output.error, /HTTP 503/);
  assert.equal(output.uploads.length, 1);
  assert.equal(output.readback.changed, false);
  assert.equal(result.github.body, "Introduction.\n");
  assert.equal(result.github.calls.filter((call) => call[0] === "release").length, 0);
  assert.ok(result.github.calls.filter((call) => call[0] === "api" && call.includes("repos/acme/demo/pulls/123")).length >= 2);
});

test("validates the target before attempting any upload", () => {
  const f = fixture("![Ready](screen.png)", { missingTarget: true });
  writeFileSync(join(f.dir, "screen.png"), "image");
  const result = run(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Not Found/);
  assert.deepEqual(result.github.uploads, []);
  assert.equal(result.github.calls.some((call) => call.includes("--attach")), false);
});

test("dry run validates target and local files without credentials or writes", () => {
  const f = fixture("![Ready](screen.png)");
  writeFileSync(join(f.dir, "screen.png"), "image");
  const result = run(f, ["--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.transport, "native-gh");
  assert.deepEqual(plan.assets[0].refs, ["screen.png"]);
  assert.equal(plan.dryRun, true);
  assert.deepEqual(result.github.uploads, []);
  assert.equal(result.github.calls.some((call) => call[0] === "auth"), false);
  assert.equal(result.github.calls.some((call) => call.includes("--method")), false);
});

test("requires an explicit repository instead of inferring it from the working directory", () => {
  const f = fixture("A text-only section.");
  const result = run(f, [], true);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--repo/);
  assert.deepEqual(result.github.calls, []);
});

test("refuses malformed target markers before uploading", () => {
  const f = fixture("![Ready](screen.png)", { body: "Keep this.\n<!-- ui-evidence:start -->\nOther text." });
  writeFileSync(join(f.dir, "screen.png"), "image");
  const result = run(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /malformed/i);
  assert.equal(result.github.body, "Keep this.\n<!-- ui-evidence:start -->\nOther text.");
  assert.equal(result.github.calls.some((call) => call.includes("--attach")), false);
});

test("rejects missing media and assets reached through an escaping symlink", (t) => {
  const missing = fixture("![Missing](missing.png)");
  const missingResult = run(missing, ["--dry-run"]);
  assert.notEqual(missingResult.status, 0);
  assert.match(missingResult.stderr, /missing asset/i);
  assert.deepEqual(missingResult.github.calls, []);

  const linked = fixture("![Secret](escape.png)");
  const outside = join(temp, "outside.png");
  writeFileSync(outside, "outside");
  try { symlinkSync(outside, join(linked.dir, "escape.png")); }
  catch (error) {
    if (process.platform === "win32" && ["EPERM", "EACCES"].includes(error.code)) { t.skip("symlink creation requires Windows privileges"); return; }
    throw error;
  }
  const linkedResult = run(linked, ["--dry-run"]);
  assert.notEqual(linkedResult.status, 0);
  assert.match(linkedResult.stderr, /escapes the image root/);
  assert.deepEqual(linkedResult.github.calls, []);
});

test("rejects video syntax that would leave local links in the published block", () => {
  for (const section of ["[Watch](clip.avi)", "[Watch](clip%2Emp4)", "[Watch](clip with spaces.webm)", "![](clip with spaces.mp4)", "<video src=clip.mp4></video>"]) {
    const f = fixture(section);
    const result = run(f, ["--dry-run"]);
    assert.notEqual(result.status, 0, section);
    assert.match(result.stderr, /video|media|reference/i, section);
    assert.equal(result.github.calls.some((call) => call.includes("--method")), false);
  }
});

test("creates a managed comment with an ID and updates that same comment on the next run", () => {
  const f = fixture("The menu opens.\n\n![](flow.webm)\n", { comments: [{ id: 10, user: { login: "me" }, body: "Unrelated." }] });
  writeFileSync(join(f.dir, "flow.webm"), "video");
  const first = run(f, ["--mode", "comment"]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  assert.equal(JSON.parse(first.stdout).commentId, 300);
  assert.equal(first.github.comments.length, 2);
  writeFileSync(f.sectionPath, "The menu closes.\n\n![](flow.webm)\n");
  const second = run(f, ["--mode", "comment"]);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(JSON.parse(second.stdout).commentId, 300);
  assert.equal(second.github.comments.length, 2);
  assert.equal(second.github.comments[0].body, "Unrelated.");
  assert.match(second.github.comments[1].body, /The menu closes\./);
  assert.doesNotMatch(second.github.comments[1].body, /The menu opens\./);
});

test("publishes text and existing remote references without requesting an upload token", () => {
  const f = fixture("![External](https://example.com/screen.png)");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.github.body, /!\[External\]\(https:\/\/example\.com\/screen\.png\)/);
  assert.equal(JSON.parse(result.stdout).transport, "none");
  assert.equal(result.github.calls.some((call) => call[0] === "auth"), false);
});

test("enforces conservative image and video limits unless paid video eligibility is explicit", () => {
  const f = fixture("The menu opens.\n\n![](flow.mp4)\n");
  writeFileSync(join(f.dir, "flow.mp4"), "");
  truncateSync(join(f.dir, "flow.mp4"), 9_500_000);
  const defaultResult = run(f, ["--dry-run"]);
  assert.notEqual(defaultResult.status, 0);
  assert.match(defaultResult.stderr, /smaller than 9500000 bytes/);
  const paidResult = run(f, ["--dry-run", "--max-video-bytes", "20000000"]);
  assert.equal(paidResult.status, 0, paidResult.stderr);
  assert.equal(JSON.parse(paidResult.stdout).assets[0].bytes, 9_500_000);
  const invalidResult = run(f, ["--dry-run", "--max-video-bytes", "100000001"]);
  assert.notEqual(invalidResult.status, 0);
  assert.match(invalidResult.stderr, /--max-video-bytes/);

  writeFileSync(f.sectionPath, "![Oversized](image.png)");
  writeFileSync(join(f.dir, "image.png"), "");
  truncateSync(join(f.dir, "image.png"), 9_500_000);
  const imageResult = run(f, ["--dry-run", "--max-video-bytes", "20000000"]);
  assert.notEqual(imageResult.status, 0);
  assert.match(imageResult.stderr, /image must be smaller than 9500000 bytes/);
});

test("reports an actionable error when native attachment support is unavailable", () => {
  const f = fixture("![Ready](screen.png)", { oldGh: true });
  writeFileSync(join(f.dir, "screen.png"), "image");
  const result = run(f);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /gh 2\.99\.0 or newer/);
  assert.equal(result.github.body, "Introduction.\n");
  assert.equal(result.github.calls.some((call) => call[0] === "release"), false);
});

test("handles identical media files without submitting the same native attachment twice", () => {
  const f = fixture("![First](one.png)\n\n![Second](two.png)");
  writeFileSync(join(f.dir, "one.png"), "identical");
  writeFileSync(join(f.dir, "two.png"), "identical");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.github.body, /!\[First\]\(https:\/\/github\.com\/user-attachments\/assets\/asset-1\)/);
  assert.match(result.github.body, /!\[Second\]\(https:\/\/github\.com\/user-attachments\/assets\/asset-1\)/);
});

test("identifies a partially created comment after native gh exits with an error", () => {
  const f = fixture("![One](one.png)\n\n![Two](two.png)", { nativeFailure: true });
  writeFileSync(join(f.dir, "one.png"), "first");
  writeFileSync(join(f.dir, "two.png"), "second");
  const result = run(f, ["--mode", "comment"]);
  assert.notEqual(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.commentId, 300);
  assert.equal(output.readback.changed, true);
  assert.equal(output.readback.verified, false);
  assert.deepEqual(output.readback.unresolved, ["two.png"]);
  assert.equal(result.github.comments.length, 1);
});

test("rejects a pull request supplied as an issue before uploading", () => {
  const f = fixture("![Ready](screen.png)");
  writeFileSync(join(f.dir, "screen.png"), "image");
  const result = run(f, ["--target", "issue:123"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /pull request, not an issue/);
  assert.deepEqual(result.github.uploads, []);
  assert.equal(result.github.calls.some((call) => call.includes("--attach")), false);
});

test("reports an unknown write outcome when readback is unavailable", () => {
  const f = fixture("![Ready](screen.png)", { failReadback: true });
  writeFileSync(join(f.dir, "screen.png"), "image");
  const result = run(f);
  assert.notEqual(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.readback.verified, false);
  assert.equal(output.readback.changed, null);
  assert.match(output.readback.error, /Readback unavailable/);
});

test("leaves code examples and HTML comments untouched instead of treating them as media", () => {
  const f = fixture("Example:\n\n```md\n![](example.mp4)\n```\n\n<!-- ![Draft](draft.png) -->\n\n![Final](final.png)");
  writeFileSync(join(f.dir, "final.png"), "image");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.github.body, /!\[\]\(example\.mp4\)/);
  assert.match(result.github.body, /<!-- !\[Draft\]\(draft\.png\) -->/);
  assert.match(result.github.body, /!\[Final\]\(https:\/\/github\.com\/user-attachments\/assets\/asset-1\)/);
  assert.equal(JSON.parse(result.stdout).assets.length, 1);
});

test("keeps unrelated references even when they contain the asset content hash", () => {
  const hash = createHash("sha256").update("image").digest("hex");
  const original = `Unrelated: ![Other](${hash}.png)\n`;
  const f = fixture("![Ready](screen.png)", { body: original });
  writeFileSync(join(f.dir, "screen.png"), "image");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.ok(result.github.body.startsWith(original));
  assert.match(result.github.body, /!\[Ready\]\(https:\/\/github\.com\/user-attachments\/assets\/asset-1\)/);
});

test("accepts an explicitly selected filesystem root as the media root", () => {
  const f = fixture("placeholder");
  const imagePath = join(f.dir, "screen.png");
  writeFileSync(imagePath, "image");
  writeFileSync(f.sectionPath, `![Ready](<${imagePath}>)`);
  const result = run(f, ["--dry-run", "--image-root", parse(f.dir).root]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).assets.length, 1);
});

test("does not upload an existing image named only in an indented code example", () => {
  const f = fixture("Usage:\n\n    ![Example](example.png)\n\nThe finished screen:\n\n![Result](result.png)");
  writeFileSync(join(f.dir, "example.png"), "local example");
  writeFileSync(join(f.dir, "result.png"), "result");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.assets.map((asset) => asset.refs), [["result.png"]]);
  assert.match(result.github.body, /    !\[Example\]\(example\.png\)/);
  assert.match(result.github.body, /!\[Result\]\(https:\/\/github\.com\/user-attachments\/assets\/asset-1\)/);
});

test("publishes an indented paragraph continuation as evidence", () => {
  const f = fixture("The finished screen:\n    ![Result](result.png)");
  writeFileSync(join(f.dir, "result.png"), "result");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).assets.map((asset) => asset.refs), [["result.png"]]);
  assert.match(result.github.body, /    !\[Result\]\(https:\/\/github\.com\/user-attachments\/assets\/asset-1\)/);
});

test("distinguishes an indented list code example from list and table evidence", () => {
  const f = fixture("- Instructions\n\n      ![Example](example.png)\n\n  ![In list](list.png)\n\n| View |\n| --- |\n| ![In table](table.png) |");
  for (const name of ["example.png", "list.png", "table.png"]) writeFileSync(join(f.dir, name), name);
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).assets.map((asset) => asset.refs), [["list.png"], ["table.png"]]);
  assert.match(result.github.body, /      !\[Example\]\(example\.png\)/);
});

test("keeps indented code examples inside block quotes out of the upload plan", () => {
  const f = fixture("> Instructions\n>\n>     ![Example](example.png)\n>\n> ![Result](result.png)");
  writeFileSync(join(f.dir, "example.png"), "example");
  writeFileSync(join(f.dir, "result.png"), "result");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).assets.map((asset) => asset.refs), [["result.png"]]);
  assert.match(result.github.body, />     !\[Example\]\(example\.png\)/);
});

test("keeps fenced code inside block quotes out of the upload plan", () => {
  const f = fixture("> Example:\n>\n> ```md\n> ![Example](example.png)\n> ```\n>\n> ![Result](result.png)");
  writeFileSync(join(f.dir, "example.png"), "example");
  writeFileSync(join(f.dir, "result.png"), "result");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).assets.map((asset) => asset.refs), [["result.png"]]);
  assert.match(result.github.body, /> !\[Example\]\(example\.png\)/);
});

test("does not upload an image inside a multiline inline code span", () => {
  const f = fixture("The example `spans a line\n![Example](example.png)` and stays literal.\n\n![Result](result.png)");
  writeFileSync(join(f.dir, "example.png"), "example");
  writeFileSync(join(f.dir, "result.png"), "result");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).assets.map((asset) => asset.refs), [["result.png"]]);
  assert.match(result.github.body, /!\[Example\]\(example\.png\)/);
});

test("treats list indentation relative to the list marker", () => {
  const f = fixture("10. Instructions\n\n    ![Result](result.png)\n\n        ![Example](example.png)");
  writeFileSync(join(f.dir, "example.png"), "example");
  writeFileSync(join(f.dir, "result.png"), "result");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).assets.map((asset) => asset.refs), [["result.png"]]);
  assert.match(result.github.body, /        !\[Example\]\(example\.png\)/);
});

test("resumes finding evidence when an unclosed quoted fence ends with its quote", () => {
  const f = fixture("> ```md\n> ![Example](example.png)\n\n![Result](result.png)");
  writeFileSync(join(f.dir, "example.png"), "example");
  writeFileSync(join(f.dir, "result.png"), "result");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).assets.map((asset) => asset.refs), [["result.png"]]);
});

test("does not let an unmatched backtick hide evidence in a later paragraph", () => {
  const f = fixture("This ` remains open.\n\n![Result](result.png) followed by `another open marker.");
  writeFileSync(join(f.dir, "result.png"), "result");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).assets.map((asset) => asset.refs), [["result.png"]]);
});

test("treats escaped backticks as literal punctuation near real evidence", () => {
  const f = fixture("Literal \\` marks ![Result](result.png) with another \\` mark.");
  writeFileSync(join(f.dir, "result.png"), "result");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).assets.map((asset) => asset.refs), [["result.png"]]);
});

test("handles a fenced example and evidence within a list", () => {
  const f = fixture("- Instructions\n\n  ```md\n  ![Example](example.png)\n  ```\n\n  ![Result](result.png)");
  writeFileSync(join(f.dir, "example.png"), "example");
  writeFileSync(join(f.dir, "result.png"), "result");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).assets.map((asset) => asset.refs), [["result.png"]]);
});

test("keeps an indented code block that starts a list item out of uploads", () => {
  const f = fixture("-     ![Example](example.png)\n\n![Result](result.png)");
  writeFileSync(join(f.dir, "example.png"), "example");
  writeFileSync(join(f.dir, "result.png"), "result");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout).assets.map((asset) => asset.refs), [["result.png"]]);
});

test("publishes an indented example without uploading its existing image file", () => {
  const f = fixture("    ![Example](example.png)\n");
  writeFileSync(join(f.dir, "example.png"), "local example");
  const result = run(f);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.assets, []);
  assert.equal(output.transport, "none");
  assert.match(result.github.body, /    !\[Example\]\(example\.png\)/);
  assert.deepEqual(result.github.uploads, []);
  assert.equal(result.github.calls.some((call) => call.includes("--attach")), false);
});

test("publishes a generated comparison section and replaces it on the next run", (t) => {
  const magick = (process.platform === "win32" ? ["magick"] : ["magick", "convert"])
    .find((binary) => spawnSync(binary, ["-version"], { stdio: "ignore" }).status === 0);
  if (!magick) {
    if (process.env.UI_EVIDENCE_REQUIRE_MEDIA === "1") throw new Error("ImageMagick is required for comparison publishing");
    t.skip("ImageMagick is unavailable");
    return;
  }
  const dir = mkdtempSync(join(temp, "compare-"));
  for (const [name, x] of [["before", 40], ["after", 70]]) {
    spawnSync(magick, ["-size", "300x200", "xc:white", "-fill", "#0969da", "-draw", `rectangle ${x},30 ${x + 59},69`, join(dir, `${name}.png`)]);
  }
  const specPath = join(dir, "compare.json");
  writeFileSync(specPath, JSON.stringify({
    title: "Card position",
    before: { image: "before.png" }, after: { image: "after.png" },
    callouts: [{ id: 1, text: "The card moved 30 px right.", before: [40, 30, 60, 40], after: [70, 30, 60, 40] },
      // Markup in an explanation reaches alt text and the legend but must never become an upload.
      { id: 2, text: 'The <img src="avatar.png"> slot and ![x](avatar.png) stay text.', after: [200, 120, 20, 20] }],
    details: [{ callout: 1 }], flip: true, onion: true,
  }));
  const out = join(dir, "evidence");
  const compare = join(repo, "skills", "ui-evidence", "scripts", "compare.mjs");
  const generated = spawnSync(process.execPath, [compare, "--spec", specPath, "--out-dir", out], { encoding: "utf8" });
  assert.equal(generated.status, 0, generated.stderr);
  const statePath = join(dir, "github.json");
  writeFileSync(statePath, JSON.stringify({ body: "Introduction.\n", kind: "pr", comments: [], nextId: 300, calls: [], uploads: [] }));
  const f = { dir: out, sectionPath: join(out, "section.md"), statePath };

  const dryRun = run(f, ["--dry-run"]);
  assert.equal(dryRun.status, 0, dryRun.stderr);
  const plan = JSON.parse(dryRun.stdout);
  assert.deepEqual(plan.assets.map((asset) => asset.refs[0]).sort(),
    ["comparison.png", "detail-callout-1.png", "flip.gif", "onion.png"]);

  const published = run(f);
  assert.equal(published.status, 0, published.stderr || published.stdout);
  const output = JSON.parse(published.stdout);
  assert.equal(output.readback.verified, true);
  const body = published.github.body;
  assert.match(body, /^Introduction\.\n\n<!-- ui-evidence:start -->\n\n#### Card position/);
  assert.match(body, /- \*\*1\*\*: The card moved 30 px right\./);
  assert.match(body, /<details><summary>Screenshot comparison aids<\/summary>/);
  assert.equal((body.match(/\]\(https:\/\/github\.com\/user-attachments\/assets\/[^)]+\)/g) ?? []).length, 4);
  assert.doesNotMatch(body, /\]\((?:comparison|detail-callout-1|onion)\.png\)|\]\(flip\.gif\)/);

  const again = run(f);
  assert.equal(again.status, 0, again.stderr || again.stdout);
  assert.equal((again.github.body.match(/<!-- ui-evidence:start -->/g) ?? []).length, 1);
});

// A local manifest as manifest.mjs writes it: "screen" has no capture
// provenance (review), and "stale" was derived from a since-refreshed source.
function manifestFor(f, assets) {
  const path = join(f.dir, "manifest.json");
  const hash = (file) => createHash("sha256").update(readFileSync(join(f.dir, file))).digest("hex");
  const records = {};
  for (const [id, { file, derivedFrom }] of Object.entries(assets)) {
    records[id] = { path: join(f.dir, file), sha256: hash(file), media: "image", ...(derivedFrom ? { derivedFrom } : {}) };
  }
  writeFileSync(path, JSON.stringify({ version: 1, recipe: null, captures: {}, assets: records, publications: [] }));
  return path;
}

test("reports manifest freshness in the plan and refuses stale evidence before uploading", () => {
  const f = fixture("![Finished](screen.png)\n\nThe flow:\n\n![](flow.mp4)\n");
  writeFileSync(join(f.dir, "screen.png"), "screenshot");
  writeFileSync(join(f.dir, "flow.mp4"), "video");
  writeFileSync(join(f.dir, "raw.png"), "refreshed raw");
  const manifest = manifestFor(f, { screen: { file: "screen.png" } });
  const dry = run(f, ["--manifest", manifest, "--dry-run"]);
  assert.equal(dry.status, 0, dry.stderr);
  const plan = JSON.parse(dry.stdout);
  assert.deepEqual(plan.freshness.summary, { fresh: 0, review: 1, stale: 0, untracked: 1 });
  assert.deepEqual(plan.freshness.assets.map((item) => [item.refs, item.assets, item.status]),
    [[["screen.png"], ["screen"], "review"], [["flow.mp4"], [], "untracked"]]);
  assert.match(plan.freshness.assets[0].reasons.join(" "), /without capture provenance/);

  const stale = manifestFor(f, { raw: { file: "raw.png" },
    screen: { file: "screen.png", derivedFrom: [{ id: "raw", sha256: "0".repeat(64) }] } });
  const staleDry = run(f, ["--manifest", stale, "--dry-run"]);
  assert.notEqual(staleDry.status, 0);
  const blockedPlan = JSON.parse(staleDry.stdout);
  assert.match(blockedPlan.blocked, /stale evidence: screen\.png \(source asset raw was refreshed/);
  assert.equal(blockedPlan.freshness.assets[0].status, "stale");
  const refused = run(f, ["--manifest", stale]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /stale evidence: screen\.png \(source asset raw was refreshed/);
  assert.equal(refused.github.body, "Introduction.\n");
  assert.deepEqual(refused.github.uploads, []);
  assert.equal(refused.github.calls.length, staleDry.github.calls.length, "stale evidence is refused before reading or writing the target");
  assert.deepEqual(JSON.parse(readFileSync(stale, "utf8")).publications, []);

  // A recorded path identifies its asset; a modified copy with the original's
  // content hash does not make the intact original stale.
  writeFileSync(join(f.dir, "copy.png"), "screenshot");
  const copies = manifestFor(f, { screen: { file: "screen.png" }, copy: { file: "copy.png" } });
  writeFileSync(join(f.dir, "copy.png"), "modified copy");
  const intact = run(f, ["--manifest", copies, "--dry-run"]);
  assert.equal(intact.status, 0, intact.stderr);
  assert.deepEqual(JSON.parse(intact.stdout).freshness.assets[0].assets, ["screen"]);

  // A recorded file overwritten in place is the same asset, now tampered.
  const recorded = manifestFor(f, { screen: { file: "screen.png" } });
  writeFileSync(join(f.dir, "screen.png"), "overwritten screenshot");
  const overwritten = run(f, ["--manifest", recorded]);
  assert.notEqual(overwritten.status, 0);
  assert.match(overwritten.stderr, /stale evidence: screen\.png \(asset file changed after it was recorded/);
  assert.deepEqual(overwritten.github.uploads, []);
});

test("records hosted references after readback and reports partial publication failure in the manifest", () => {
  const f = fixture("![Finished](screen.png)\n\nThe flow:\n\n![](flow.mp4)\n");
  writeFileSync(join(f.dir, "screen.png"), "screenshot");
  writeFileSync(join(f.dir, "flow.mp4"), "video");
  const manifest = manifestFor(f, { screen: { file: "screen.png" } });
  const published = run(f, ["--manifest", manifest]);
  assert.equal(published.status, 0, published.stderr);
  assert.deepEqual(JSON.parse(published.stdout).manifest, { recorded: true });
  let record = JSON.parse(readFileSync(manifest, "utf8")).publications.at(-1);
  assert.equal(record.verified, true);
  assert.equal(record.target, "pr:123");
  assert.equal(record.repo, "acme/demo");
  assert.deepEqual(record.assets.map((item) => [item.ids, item.refs, item.status, item.url]), [
    [["screen"], ["screen.png"], "review", "https://github.com/user-attachments/assets/asset-1"],
    [[], ["flow.mp4"], "untracked", "https://github.com/user-attachments/assets/asset-2"],
  ]);
  assert.ok(!JSON.stringify(published.github.body).includes(f.dir), "no local path reaches the published body");

  const partial = fixture("![Finished](screen.png)\n\n![Second](second.png)\n", { nativeFailure: true });
  writeFileSync(join(partial.dir, "screen.png"), "screenshot");
  writeFileSync(join(partial.dir, "second.png"), "second");
  const partialManifest = manifestFor(partial, { screen: { file: "screen.png" }, second: { file: "second.png" } });
  const failed = run(partial, ["--manifest", partialManifest]);
  assert.notEqual(failed.status, 0);
  record = JSON.parse(readFileSync(partialManifest, "utf8")).publications.at(-1);
  assert.equal(record.verified, false);
  assert.equal(record.changed, true);
  assert.match(record.error, /simulated native failure/);
  assert.deepEqual(record.unresolved, ["second.png"]);
  assert.deepEqual(record.assets.map((item) => item.url), [null, null], "unverified readback maps no hosted references");
});
