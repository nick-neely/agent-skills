#!/usr/bin/env node
// The worked examples run as written. Every bash block of each example runs in
// order in one shell, from an unrelated working directory, against a sanitized
// fixture app in a git repository. GitHub is a stub (see the boundary module);
// agent-browser is a stub too unless UI_EVIDENCE_BROWSER_TESTS=1, which drives
// the real browser.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillRoot = join(repo, "skills", "ui-evidence");
const fixtures = join(repo, "tests", "fixtures");
const boundary = join(fixtures, "ui-evidence-examples", "boundary.mjs");
const temp = mkdtempSync(join(tmpdir(), "ui-evidence-examples-test-"));
after(() => rmSync(temp, { recursive: true, force: true }));

const has = (binary, args = ["-version"]) => spawnSync(binary, args, { stdio: "ignore" }).status === 0;
const media = has("ffmpeg") && has("ffprobe") && (has("magick") || (has("convert") && has("montage"))) && has("bash", ["--version"]);
if (!media && process.env.UI_EVIDENCE_REQUIRE_MEDIA === "1") throw new Error("UI evidence media tools and bash are required");
const realBrowser = process.env.UI_EVIDENCE_BROWSER_TESTS === "1";
const skip = media ? false : "FFmpeg, ffprobe, ImageMagick, or bash is unavailable";

function git(cwd, ...args) {
  return execFileSync("git", ["-c", "user.name=Example", "-c", "user.email=example@example.invalid", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// A repository whose main branch holds `base` and whose feature branch adds `feature`.
function appRepository(name, base, feature = {}) {
  const root = mkdtempSync(join(temp, `${name}-`));
  const app = join(root, "app");
  mkdirSync(app);
  for (const [file, from] of Object.entries(base)) copyFileSync(from, join(app, file));
  git(app, "init", "-q");
  git(app, "symbolic-ref", "HEAD", "refs/heads/main");
  git(app, "add", ".");
  git(app, "commit", "-qm", "base");
  git(app, "checkout", "-qb", "feature");
  for (const [file, from] of Object.entries(feature)) copyFileSync(from, join(app, file));
  if (Object.keys(feature).length) git(app, "commit", "-qam", "feature");
  return { root, app, mainRevision: git(app, "rev-parse", "main") };
}

const read = (path) => readFileSync(path, "utf8");
const json = (path) => JSON.parse(read(path));

// The bash blocks in document order, and the variables named in a section's table.
function blocks(doc) {
  return [...doc.matchAll(/```bash\r?\n([\s\S]*?)\r?\n```/g)].map((match) => match[1]);
}

function section(doc, heading) {
  const start = doc.indexOf(`## ${heading}\n`);
  assert.ok(start >= 0, `the example has a "${heading}" section`);
  const end = doc.indexOf("\n## ", start + 1);
  return doc.slice(start, end < 0 ? undefined : end);
}

const tableCells = (text) => text.split("\n").filter((line) => /^\| `/.test(line)).map((line) => line.split("|")[1]);
const codeNames = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);

// Runs the example's commands in one shell and returns its evidence directory.
function runExample(doc, app, inputs) {
  const runtime = tableCells(section(doc, "Runtime inputs")).flatMap(codeNames);
  assert.deepEqual(runtime.sort(), Object.keys(inputs).sort(), "the runtime inputs table names exactly what the commands need");
  const script = ["set -euo pipefail", ...blocks(doc), 'printf "EVIDENCE_DIR=%s\\n" "$EVIDENCE_DIR"']
    .join("\n").replaceAll("<skill-root>", skillRoot);
  const workdir = mkdtempSync(join(app.root, "cwd-"));
  // Chrome keeps a socket under TMPDIR, so the path stays short.
  const tmp = mkdtempSync(join(tmpdir(), "uie-"));
  after(() => rmSync(tmp, { recursive: true, force: true }));
  const state = mkdtempSync(join(app.root, "state-"));
  writeFileSync(join(state, "github.json"), JSON.stringify({ repo: "acme/demo", number: 123, baseRefName: "main",
    baseRefOid: app.mainRevision, body: "Introduction.\n", calls: [], uploads: [] }));
  writeFileSync(join(workdir, "example.sh"), script);
  const result = spawnSync("bash", ["example.sh"], {
    cwd: workdir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, ...inputs, TMPDIR: tmp, NODE_TEST_CONTEXT: "", AGENT_BROWSER_SESSION: "",
      NODE_OPTIONS: `--import=${pathToFileURL(boundary).href}`, UI_EVIDENCE_EXAMPLE_STATE: state,
      UI_EVIDENCE_FAKE_BROWSER: realBrowser ? "0" : "1" },
  });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout.slice(-4000)}`);
  const evidence = /EVIDENCE_DIR=(.+)\n?$/.exec(result.stdout)?.[1];
  assert.ok(evidence && existsSync(evidence), "the example reports its evidence directory");
  assert.ok(evidence.startsWith(tmp), "evidence is written under TMPDIR, outside the checkout");
  return { evidence, github: json(join(state, "github.json")) };
}

// Every file the output table names exists.
function assertOutputs(doc, evidence) {
  const files = tableCells(section(doc, "Output files")).flatMap(codeNames);
  assert.ok(files.length >= 10);
  for (const file of files) assert.ok(existsSync(join(evidence, file)), `${file} was produced`);
}

const mediaRefs = (markdown) => [...markdown.matchAll(/!\[[^\]]*\]\(<?([^)>]+)>?\)/g)].map((match) => match[1]);

function assertPublished(evidence, github, sectionPath, files) {
  const plan = json(join(evidence, "publish-plan.json"));
  assert.equal(plan.dryRun, true);
  assert.deepEqual([plan.repo, plan.target], ["acme/demo", "pr:123"]);
  assert.deepEqual(plan.assets.map((asset) => asset.refs[0]).sort(), files.map(([file]) => file).sort());
  assert.deepEqual(Object.fromEntries(plan.assets.map((asset) => [asset.refs[0], asset.media])), Object.fromEntries(files));
  assert.ok(plan.freshness.assets.every((item) => item.status === "fresh"), JSON.stringify(plan.freshness.assets));
  assert.equal(plan.blocked, undefined);
  assert.deepEqual(mediaRefs(read(sectionPath)).sort(), files.map(([file]) => file).sort(),
    "the section references exactly the produced media");
  assert.match(read(sectionPath), /\n\n<sub>Capture <code>/, "the capture reference is its own paragraph");
  const published = json(join(evidence, "publish-result.json"));
  assert.equal(published.readback.verified, true);
  assert.match(github.body, /^Introduction\.\n\n<!-- ui-evidence:start -->\n[\s\S]*<!-- ui-evidence:end -->\n?$/);
  assert.equal((github.body.match(/https:\/\/github\.com\/user-attachments\/assets\//g) ?? []).length, files.length);
  assert.doesNotMatch(github.body, new RegExp(evidence.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "no local path is published");
  const edits = github.calls.filter((call) => call[0] === "pr" && call[1] === "edit" && !call.includes("--help"));
  assert.equal(edits.length, 1, "only the authorized publication writes to the target");
}

function assertFresh(evidence, expected) {
  const status = json(join(evidence, "status.json"));
  const items = [...status.captures.map((item) => [`${item.capture}.${item.version}`, item.status]),
    ...status.assets.map((item) => [item.asset, item.status])];
  assert.deepEqual(Object.fromEntries(items), Object.fromEntries(expected.map((id) => [id, "fresh"])));
}

test("the static comparison example runs from capture to a verified publication", { skip }, () => {
  const doc = read(join(skillRoot, "references", "example-comparison.md"));
  const app = appRepository("comparison",
    { "settings.html": join(fixtures, "ui-evidence-app", "before.html") },
    { "settings.html": join(fixtures, "ui-evidence-app", "after.html") });
  const { evidence, github } = runExample(doc, app, {
    APP_DIR: app.app, AFTER_URL: `${pathToFileURL(app.app).href}/`,
    AFTER_CHECK: "opened as static files from the pull request checkout", REPO: "acme/demo", PR: "123",
  });
  assertOutputs(doc, evidence);
  const [afterCapture, beforeCapture] = ["capture-after.json", "capture-before.json"].map((file) => json(join(evidence, file)));
  assert.equal(afterCapture.source.branch, "feature");
  assert.equal(beforeCapture.source.head, app.mainRevision, "the before capture renders the pull request's base");
  for (const key of ["viewport", "devicePixelRatio", "theme", "scroll"]) {
    assert.deepEqual(beforeCapture.state[key], afterCapture.state[key], `both captures share ${key}`);
  }
  assert.equal(afterCapture.state.path, "settings.html");
  assertFresh(evidence, ["notification-toolbar.after", "notification-toolbar.before", "compare.comparison", "compare.detail-callout-1"]);
  const result = json(join(evidence, "compare", "result.json"));
  assert.deepEqual(result.calloutIds, [1, 2]);
  for (const callout of result.callouts) {
    assert.deepEqual([callout.outline, callout.label, callout.measure, callout.spotlight], [false, null, null, false],
      `callout ${callout.id} is pin-only`);
    for (const panel of Object.values(callout.panels).filter(Boolean)) {
      assert.ok(panel.pin, `callout ${callout.id} keeps its pin`);
      assert.deepEqual([panel.outline, panel.label, panel.bracket], [null, null, null], `callout ${callout.id} adds no box, tag, or bracket`);
    }
  }
  assertPublished(evidence, github, join(evidence, "compare", "section.md"),
    [["comparison.png", "image"], ["detail-callout-1.png", "image"]]);
  const baseline = json(join(evidence, "baseline.json"));
  assert.equal(baseline.baseSource, "pull-request");
  assert.equal(existsSync(baseline.path), false, "the baseline checkout is removed");
});

test("the recording example runs from a recorded take to a verified publication", { skip }, () => {
  const recipeApp = join(fixtures, "ui-evidence-recipe-app");
  const app = appRepository("recording", Object.fromEntries(["pricing.html", "settings.html", "styles.css"]
    .map((file) => [file, join(recipeApp, file)])));
  const doc = read(join(skillRoot, "references", "example-recording.md"));
  const { evidence, github } = runExample(doc, app, {
    APP_DIR: app.app, APP_URL: `${pathToFileURL(app.app).href}/`,
    APP_CHECK: "opened as static files from the pull request checkout", REPO: "acme/demo", PR: "123",
  });
  assertOutputs(doc, evidence);
  const capture = json(join(evidence, "capture.json"));
  assert.equal(capture.kind, "recording");
  assert.equal(capture.outcome, "captured");
  const report = json(join(evidence, "motion-report.json"));
  assert.deepEqual(report.annotations.events.map((event) => event.step ?? null), [1, 2, null, 3]);
  assert.equal(report.storyboard.checkpoints.length, 3);
  assert.ok(report.warnings.some((warning) => /Paused for reading/.test(warning)));
  assertFresh(evidence, ["pricing-toggle.after", "interaction", "interaction.storyboard"]);
  assertPublished(evidence, github, join(evidence, "section.md"), [["interaction.mp4", "video"], ["storyboard.png", "image"]]);
});

test("SKILL.md points to both worked examples", () => {
  const skill = read(join(skillRoot, "SKILL.md"));
  for (const file of ["example-comparison.md", "example-recording.md"]) {
    assert.match(skill, new RegExp(`\\(references/${file.replace(".", "\\.")}\\)`));
  }
});
