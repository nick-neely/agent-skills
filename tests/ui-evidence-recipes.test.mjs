#!/usr/bin/env node
// Capture recipes, provenance, and freshness. A fake agent-browser stands in
// for the browser boundary: screenshots are real PNGs whose colour derives from
// the served file, so a content change is a visible change. Set
// UI_EVIDENCE_BROWSER_TESTS=1 to also run the flow in a real browser.

import assert from "node:assert/strict";
import { execFileSync, execSync, spawnSync } from "node:child_process";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { parseRecipe } from "../skills/ui-evidence/scripts/recipe.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = join(repo, "skills", "ui-evidence", "scripts");
const captureScript = join(scripts, "capture.mjs");
const manifestScript = join(scripts, "manifest.mjs");
const beforeCapture = join(scripts, "before-capture.mjs");
const fixtureApp = join(repo, "tests", "fixtures", "ui-evidence-recipe-app");
const temp = mkdtempSync(join(tmpdir(), "ui-evidence-recipes-test-"));
const fake = join(temp, "fake-browser.mjs");
after(() => rmSync(temp, { recursive: true, force: true }));

writeFileSync(fake, String.raw`
import cp from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
const real = cp.execFileSync;
const dir = process.env.FAKE_BROWSER_DIR;
function crc32(buffer) {
  let crc = ~0;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}
function png(width, height, rgb) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x += 1) Buffer.from(rgb).copy(row, 1 + x * 3);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(height).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
}
function content(state) {
  const url = new URL(state.url);
  const page = url.protocol === "file:" ? readFileSync(fileURLToPath(url)) : Buffer.from(state.url);
  return createHash("sha256").update(page).update(state.theme).update(JSON.stringify(state.clicked)).digest();
}
function failure(message, stdout = "") {
  const error = new Error(message);
  error.status = 1;
  error.stdout = stdout;
  error.stderr = message;
  throw error;
}
function run(state, command) {
  const [name, ...args] = command;
  if (name === "set" && args[0] === "viewport") state.viewport = args.slice(1).map(Number);
  else if (name === "set" && args[0] === "media") state.theme = args[1];
  else if (name === "open") Object.assign(state, { url: args[0], scroll: [0, 0], clicked: [] });
  else if (name === "click" && args[0].startsWith("a[href=")) {
    state.url = new URL(args[0].slice(7, -1), state.url).href;
    state.clicked = [];
  } else if (name === "click") state.clicked.push(args[0]);
  else if (name === "eval" && args[0].startsWith("window.scrollTo(")) {
    const [x, y] = args[0].slice(16, -1).split(",").map(Number);
    const max = Number(process.env.FAKE_MAX_SCROLL ?? 100000);
    state.scroll = [x, Math.min(y, max)];
  } else if (name === "eval" && args[0].includes("location.href")) {
    return { result: { href: state.url, viewport: { width: state.viewport[0], height: state.viewport[1] },
      devicePixelRatio: state.viewport[2], theme: state.theme, scroll: { x: state.scroll[0], y: state.scroll[1] } } };
  } else if (name === "wait" && args[0] === "--fn" && args[1].includes("neverReady")) throw new Error("Wait timed out after 25000ms");
  else if (name === "screenshot") {
    const path = args.at(-1);
    const [width, height, ratio] = state.viewport;
    writeFileSync(path, png(Math.round(width * ratio), Math.round(height * ratio) * (args.includes("--full") ? 2 : 1),
      [...content(state).subarray(0, 3)]));
  } else if (name === "record" && args[0] === "start") {
    if (state.recording) throw new Error("a recording is already in progress");
    state.recording = args[1];
    writeFileSync(args[1], "");
  } else if (name === "record" && args[0] === "stop") {
    writeFileSync(state.recording, Buffer.concat([Buffer.from("FAKE-MP4"), content(state)]));
    const path = state.recording;
    delete state.recording;
    return { path, frames: 30, capturedFrames: 12, fps: 30 };
  }
  return {};
}
cp.execFileSync = (binary, args, options = {}) => {
  if (binary !== "agent-browser") return real(binary, args, options);
  const [flag, session, ...rest] = args;
  if (flag !== "--session") failure("missing --session");
  const statePath = join(dir, session + ".json");
  const load = () => (existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : null);
  appendFileSync(join(dir, "calls.log"), JSON.stringify({ session, args: rest,
    commands: options.input ? JSON.parse(options.input) : undefined }) + "\n");
  if (rest[0] === "session") return JSON.stringify({ success: true, data: { session, active: Boolean(load()) } });
  if (rest[0] === "close") {
    rmSync(statePath, { force: true });
    return JSON.stringify({ success: true, data: { closed: true } });
  }
  const state = load() ?? { viewport: [1280, 720, 1], theme: "light", url: "about:blank", scroll: [0, 0], clicked: [] };
  if (rest[0] === "record" && rest[1] === "stop") {
    if (state.recording) run(state, ["record", "stop"]);
    writeFileSync(statePath, JSON.stringify(state));
    return "";
  }
  if (rest[0] !== "batch") failure("unexpected browser command " + rest[0]);
  const results = [];
  for (const command of JSON.parse(options.input)) {
    try {
      results.push({ command, success: true, error: null, result: run(state, command) });
    } catch (error) {
      results.push({ command, success: false, error: error.message, result: null });
      break;
    }
  }
  writeFileSync(statePath, JSON.stringify(state));
  const output = JSON.stringify(results);
  if (results.some((result) => !result.success)) failure("batch failed", output);
  return output;
};
syncBuiltinESMExports();
`);

function gitIn(cwd, ...args) {
  return execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

let projects = 0;
function project({ recipe } = {}) {
  const root = join(temp, `project-${projects += 1}`);
  const app = join(root, "app");
  const evidence = join(root, "evidence");
  const browserDir = join(root, "browser");
  mkdirSync(browserDir, { recursive: true });
  cpSync(fixtureApp, app, { recursive: true });
  if (recipe) writeFileSync(join(app, "recipe.json"), JSON.stringify(recipe(JSON.parse(readFileSync(join(app, "recipe.json"), "utf8")))));
  gitIn(app, "init", "-q");
  gitIn(app, "symbolic-ref", "HEAD", "refs/heads/main");
  gitIn(app, "add", ".");
  gitIn(app, "commit", "-qm", "base");
  const env = { ...process.env, NODE_TEST_CONTEXT: "", NODE_OPTIONS: `--import=${pathToFileURL(fake).href}`,
    FAKE_BROWSER_DIR: browserDir, AGENT_BROWSER_SESSION: "" };
  const manifestPath = join(evidence, "manifest.json");
  const p = {
    root, app, evidence, browserDir, manifestPath,
    baseUrl: `${pathToFileURL(app).href}/`,
    capture(args, extra = {}) {
      const result = spawnSync(process.execPath, [captureScript, "--recipe", join(app, "recipe.json"),
        "--base-url", extra.baseUrl ?? p.baseUrl, "--out-dir", evidence, "--manifest", manifestPath,
        "--session", extra.session ?? "uie-test", ...(extra.noSource ? [] : extra.source === false ? [] : ["--source", app]),
        ...args], { encoding: "utf8", env: { ...env, ...extra.env } });
      return { ...result, json: result.status === 0 ? JSON.parse(result.stdout) : null };
    },
    manifest(...args) {
      const result = spawnSync(process.execPath, [manifestScript, ...args, "--manifest", manifestPath], { encoding: "utf8", env });
      return { ...result, json: result.status === 0 && !args.includes("reference") ? JSON.parse(result.stdout) : null };
    },
    status() {
      const result = p.manifest("status");
      assert.equal(result.status, 0, result.stderr);
      return Object.fromEntries([...result.json.captures, ...result.json.assets]
        .map((item) => [item.capture ? `${item.capture}.${item.version}` : item.asset, item]));
    },
    calls() {
      const log = join(browserDir, "calls.log");
      return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
    },
    stored: () => JSON.parse(readFileSync(manifestPath, "utf8")),
    write: (name, text) => writeFileSync(join(app, name), text),
    edit: (name, from, to) => writeFileSync(join(app, name), readFileSync(join(app, name), "utf8").replace(from, to)),
    git: (...args) => gitIn(app, ...args),
  };
  return p;
}

function captured(p, ...ids) {
  for (const id of ids) {
    const result = p.capture(["--capture", id]);
    assert.equal(result.status, 0, result.stderr);
  }
}

function reasons(item) {
  return item.reasons.map((reason) => reason.text).join(" | ");
}

test("invalid recipes and runtime inputs fail before any browser command", () => {
  const cases = [
    [(r) => { r.captures[0].steps = [["close"]]; return r; }, /runs itself/],
    [(r) => { r.captures[0].steps = [["set", "viewport", "10", "10"]]; return r; }, /viewport and theme fields/],
    [(r) => { r.captures[0].route = "https://example.com/settings"; return r; }, /relative URL/],
    [(r) => { r.captures[0].versions = { before: { viewport: { width: 1, height: 1 } } }; return r; }, /cannot differ between versions/],
    [(r) => { r.captures[0].extra = true; return r; }, /unknown field "extra"/],
    [(r) => { delete r.captures[2].expect; return r; }, /needs "actions" and an "expect"/],
    [(r) => { r.captures[0].fixture = "token=abc def"; return r; }, /sanitized identifier/],
    [(r) => { r.captures[0].steps = [["click", 3]]; return r; }, /array of strings/],
    [(r) => { r.captures[0].inputs = ["../outside"]; return r; }, /repository-relative/],
  ];
  for (const [mutate, pattern] of cases) {
    const p = project({ recipe: mutate });
    const result = p.capture(["--capture", "settings-profile"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, pattern);
    assert.deepEqual(p.calls(), []);
    assert.equal(existsSync(p.evidence), false);
  }
  const p = project();
  for (const [args, extra, pattern] of [
    [["--capture", "missing"], {}, /no capture "missing"/],
    [["--capture", "settings-profile"], { baseUrl: "http://user:secret@localhost:3000/" }, /credentials/],
    [["--capture", "settings-profile"], { baseUrl: "ftp://example.com/" }, /http, https, or file/],
    [["--capture", "settings-profile", "--out-dir", join(p.app, "evidence")], {}, /outside the source checkout/],
    [["--capture", "settings-profile", "--version", "during"], {}, /before" or "after/],
  ]) {
    const result = p.capture(args, extra);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, pattern);
  }
  const inside = spawnSync(process.execPath, [captureScript, "--recipe", "recipe.json", "--capture", "settings-profile",
    "--base-url", p.baseUrl, "--out-dir", "evidence", "--session", "uie-test"], {
    cwd: p.app, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(fake).href}`, FAKE_BROWSER_DIR: p.browserDir },
  });
  assert.notEqual(inside.status, 0);
  assert.match(inside.stderr, /--out-dir must be outside the source checkout/);
  const noSession = spawnSync(process.execPath, [captureScript, "--recipe", join(p.app, "recipe.json"), "--capture",
    "settings-profile", "--base-url", p.baseUrl, "--out-dir", p.evidence], {
    encoding: "utf8", env: { ...process.env, AGENT_BROWSER_SESSION: "" },
  });
  assert.notEqual(noSession.status, 0);
  assert.match(noSession.stderr, /--session/);
  assert.deepEqual(p.calls(), []);
});

test("one recipe drives before, after, and a follow-up capture with explicit version differences", () => {
  const p = project({ recipe: (r) => {
    r.captures[1].versions = { before: { steps: [["click", "label:has(#annual)"]],
      ready: "document.querySelector('#annual').checked" } };
    return r;
  } });
  const created = spawnSync(process.execPath, [beforeCapture, "create", "--ref", "main"], { cwd: p.app, encoding: "utf8" });
  assert.equal(created.status, 0, created.stderr);
  const baseline = JSON.parse(created.stdout);
  writeFileSync(join(p.root, "baseline.json"), created.stdout);
  p.git("checkout", "-qb", "feature");
  p.edit("pricing.html", "$120 / year", "$108 / year");
  p.git("commit", "-qam", "yearly discount");

  const before = p.capture(["--capture", "pricing-yearly", "--version", "before", "--baseline", join(p.root, "baseline.json")],
    { baseUrl: `${pathToFileURL(baseline.path).href}/`, noSource: true });
  assert.equal(before.status, 0, before.stderr);
  const afterRun = p.capture(["--capture", "pricing-yearly"]);
  assert.equal(afterRun.status, 0, afterRun.stderr);
  assert.notEqual(before.json.asset.sha256, afterRun.json.asset.sha256);
  assert.equal(before.json.source.head, baseline.mergeBase);
  assert.equal(before.json.source.kind, "baseline");
  assert.deepEqual(before.json.served, { verified: true, basis: "file URL inside the source checkout" });

  const batches = p.calls().filter((call) => call.args[0] === "batch").map((call) => call.commands);
  const [beforeBatch, afterBatch] = batches.filter((commands) => commands[0][0] === "set");
  for (const commands of [beforeBatch, afterBatch]) {
    assert.deepEqual(commands[0], ["set", "viewport", "640", "360", "1"]);
    assert.deepEqual(commands[1], ["set", "media", "light"]);
    assert.match(commands[2][1], /pricing\.html$/);
  }
  assert.deepEqual(beforeBatch[3], ["click", "label:has(#annual)"], "per-version steps replace the base steps");
  assert.ok(!beforeBatch.some((command) => command[1] === "label:has(#yearly)"));
  assert.ok(beforeBatch.some((command) => command[0] === "wait" && command[2] === "document.querySelector('#annual').checked"));
  assert.deepEqual(afterBatch.slice(3, 6), JSON.parse(readFileSync(join(p.app, "recipe.json"), "utf8")).captures[1].steps,
    "recipe steps run verbatim as batch commands");
  assert.ok(afterBatch.at(-2)[2].includes("#yearly"), "the ready assertion runs last before the state probe");

  p.edit("pricing.html", "$108 / year", "$96 / year");
  p.git("commit", "-qam", "deeper discount");
  const followUp = p.capture(["--capture", "pricing-yearly"]);
  assert.equal(followUp.status, 0, followUp.stderr);
  assert.equal(followUp.json.outcome, "updated");
  assert.equal(followUp.json.asset.path, afterRun.json.asset.path);
  const stored = p.stored();
  assert.equal(stored.captures["pricing-yearly"].versions.before.source.base.mergeBase, baseline.mergeBase);
  assert.equal(stored.captures["pricing-yearly"].versions.after.source.head, p.git("rev-parse", "HEAD"));
  assert.equal(stored.captures["pricing-yearly"].versions.after.source.branch, "feature");
  const status = p.status();
  assert.equal(status["pricing-yearly.before"].status, "fresh", reasons(status["pricing-yearly.before"]));
  assert.equal(status["pricing-yearly.after"].status, "fresh", reasons(status["pricing-yearly.after"]));
  const removed = spawnSync(process.execPath, [beforeCapture, "remove", "--dir", baseline.path, "--owner", "someone-else"],
    { cwd: p.app, encoding: "utf8" });
  assert.equal(removed.status, 1);
  assert.match(removed.stderr, /ownership record does not match/);
  execSync(baseline.removeCommand, { cwd: p.app, stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(existsSync(baseline.path), false);
});

test("failed readiness writes nothing and closes only a session this run owns", () => {
  const p = project({ recipe: (r) => { r.captures[0].ready = "window.neverReady === true"; return r; } });
  const owned = p.capture(["--capture", "settings-profile"], { session: "owned-run" });
  assert.notEqual(owned.status, 0);
  assert.match(owned.stderr, /ready assertion did not become true/);
  assert.equal(existsSync(p.manifestPath), false);
  assert.deepEqual(readdirSync(p.evidence), []);
  assert.ok(p.calls().some((call) => call.session === "owned-run" && call.args[0] === "close"));
  assert.equal(existsSync(join(p.browserDir, "owned-run.json")), false);

  writeFileSync(join(p.browserDir, "caller.json"), JSON.stringify({ viewport: [800, 600, 1], theme: "light",
    url: "about:blank", scroll: [0, 0], clicked: [], signedIn: true }));
  const callers = p.capture(["--capture", "settings-profile"], { session: "caller" });
  assert.notEqual(callers.status, 0);
  assert.ok(!p.calls().some((call) => call.session === "caller" && call.args[0] === "close"));
  assert.equal(JSON.parse(readFileSync(join(p.browserDir, "caller.json"), "utf8")).signedIn, true);

  const scrolled = project({ recipe: (r) => { r.captures[0].scroll = { x: 0, y: 200 }; return r; } });
  const short = scrolled.capture(["--capture", "settings-profile"], { env: { FAKE_MAX_SCROLL: "40" } });
  assert.notEqual(short.status, 0);
  assert.match(short.stderr, /did not reach the recipe state: scroll is 0,40, expected 0,200/);
  assert.equal(existsSync(scrolled.manifestPath), false);
});

test("steps may navigate and the observed route is recorded relative to the base URL", () => {
  const p = project({ recipe: (r) => {
    r.captures[0].steps = [["click", "a[href=pricing.html]"]];
    r.captures[0].screenshot = { full: true };
    return r;
  } });
  const result = p.capture(["--capture", "settings-profile"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.state.path, "pricing.html");
  assert.deepEqual(result.json.asset.size, [640, 720]);
  assert.ok(!JSON.stringify(result.json.state).includes(p.root));
  assert.ok(p.calls().some((call) => call.commands?.[0]?.[0] === "screenshot" && call.commands[0].includes("--full")));
});

test("recordings run setup, actions, and the result assertion in one take and reject failed takes", () => {
  const p = project();
  const take = p.capture(["--capture", "pricing-toggle"]);
  assert.equal(take.status, 0, take.stderr);
  assert.equal(take.json.kind, "recording");
  assert.match(take.json.asset.path, /pricing-toggle\.after\.mp4$/);
  assert.equal(take.json.recording.capturedFrames, 12);
  assert.equal(take.json.recording.path, undefined);
  const recorded = p.calls().filter((call) => call.commands?.[0]?.[0] === "record")[0].commands;
  assert.deepEqual(recorded[0].slice(0, 2), ["record", "start"]);
  assert.ok(recorded[0].includes("--cursor"));
  assert.deepEqual(recorded.at(-2), ["wait", "--fn", JSON.parse(readFileSync(join(p.app, "recipe.json"), "utf8")).captures[2].expect]);
  assert.deepEqual(recorded.at(-1), ["record", "stop"]);
  assert.equal(p.stored().assets["pricing-toggle.after"].media, "video");

  const failing = project({ recipe: (r) => { r.captures[2].expect = "window.neverReady"; return r; } });
  const rejected = failing.capture(["--capture", "pricing-toggle"]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /rejected take is kept for inspection/);
  assert.ok(existsSync(join(failing.evidence, "pricing-toggle.after.rejected.mp4")));
  assert.equal(existsSync(failing.manifestPath), false);
  assert.ok(failing.calls().some((call) => call.args[0] === "record" && call.args[1] === "stop"));
  assert.ok(!readdirSync(failing.evidence).some((name) => name.startsWith(".")), "temporary files are removed");

  writeFileSync(join(p.browserDir, "recording-caller.json"), JSON.stringify({ viewport: [640, 360, 1], theme: "light",
    url: "about:blank", scroll: [0, 0], clicked: [], recording: join(p.root, "caller-take.mp4") }));
  const busy = p.capture(["--capture", "pricing-toggle"], { session: "recording-caller" });
  assert.notEqual(busy.status, 0);
  assert.match(busy.stderr, /already in progress/);
  assert.ok(!p.calls().some((call) => call.session === "recording-caller" && call.args[0] === "record"),
    "a take this run did not start is never stopped");
  assert.equal(JSON.parse(readFileSync(join(p.browserDir, "recording-caller.json"), "utf8")).recording, join(p.root, "caller-take.mp4"));
});

test("freshness separates committed, dirty, and unrelated changes without trusting HEAD alone", () => {
  const p = project();
  captured(p, "settings-profile", "pricing-yearly");
  let status = p.status();
  assert.equal(status["settings-profile.after"].status, "fresh");
  assert.equal(status["pricing-yearly.after"].next, "reuse");

  p.write("NOTES.md", "Release notes.\n");
  p.git("add", "NOTES.md");
  p.git("commit", "-qm", "notes only");
  status = p.status();
  assert.equal(status["settings-profile.after"].status, "fresh", "a changed HEAD that touches only ignored paths stays fresh");

  p.edit("settings.html", "Sample User", "Example Person");
  status = p.status();
  assert.equal(status["settings-profile.after"].status, "stale");
  assert.match(reasons(status["settings-profile.after"]), /capture input changed: settings\.html/);
  assert.equal(status["pricing-yearly.after"].status, "review");
  assert.match(reasons(status["pricing-yearly.after"]), /outside this capture's declared inputs.*settings\.html/);

  captured(p, "settings-profile");
  const dirty = p.stored().captures["settings-profile"].versions.after.source;
  assert.equal(dirty.dirty, true);
  assert.equal(dirty.head, p.git("rev-parse", "HEAD"));
  assert.equal(p.status()["settings-profile.after"].status, "fresh");
  p.edit("settings.html", "Example Person", "Another Person");
  status = p.status();
  assert.equal(status["settings-profile.after"].status, "stale", "same HEAD but different dirty content is detected");
  p.edit("settings.html", "Another Person", "Example Person");
  assert.equal(p.status()["settings-profile.after"].status, "fresh", "restoring the captured dirty content is fresh again");

  p.git("commit", "-qam", "commit the captured edit");
  assert.equal(p.status()["settings-profile.after"].status, "fresh", "committing identical content changes HEAD, not the render");

  p.write("styles.css", `${readFileSync(join(p.app, "styles.css"), "utf8")}\nmain { gap: 16px; }\n`);
  status = p.status();
  for (const key of ["settings-profile.after", "pricing-yearly.after"]) {
    assert.equal(status[key].status, "review");
    assert.match(reasons(status[key]), /shared input changed: styles\.css/);
  }
  p.git("checkout", "-q", "styles.css");
  p.write("widget.js", "export const unused = true;\n");
  status = p.status();
  assert.equal(status["settings-profile.after"].status, "review");
  assert.match(reasons(status["settings-profile.after"]), /impact unknown: widget\.js/);
});

test("recipe, fixture, and asset integrity changes are confirmed stale", () => {
  const p = project();
  captured(p, "settings-profile", "pricing-yearly");
  const recipePath = join(p.app, "recipe.json");
  const original = readFileSync(recipePath, "utf8");
  const recipe = JSON.parse(original);
  recipe.captures[0].ready = "document.querySelector('[data-testid=profile]') !== null";
  recipe.captures[1].fixture = "seed:pricing-v2";
  writeFileSync(recipePath, JSON.stringify(recipe));
  let status = p.status();
  assert.equal(status["settings-profile.after"].status, "stale");
  assert.match(reasons(status["settings-profile.after"]), /recipe setup changed/);
  assert.match(reasons(status["pricing-yearly.after"]), /fixture changed from seed:pricing-v1 to seed:pricing-v2/);
  recipe.captures[0].claims = ["Reworded claim"];
  recipe.captures[0].inputs = ["settings.html", "profile/**"];
  recipe.captures[0].ready = JSON.parse(original).captures[0].ready;
  writeFileSync(recipePath, JSON.stringify(recipe));
  assert.equal(p.status()["settings-profile.after"].status, "fresh", "claims and input declarations do not change the render");
  writeFileSync(recipePath, original);

  const settings = p.stored().assets["settings-profile.after"].path;
  writeFileSync(settings, Buffer.concat([readFileSync(settings), Buffer.from("tamper")]));
  status = p.status();
  assert.match(reasons(status["settings-profile.after"]), /changed after it was recorded/);
  rmSync(p.stored().assets["pricing-yearly.after"].path);
  status = p.status();
  assert.equal(status["pricing-yearly.after"].status, "stale");
  assert.match(reasons(status["pricing-yearly.after"]), /asset file is missing/);
  assert.match(status["pricing-yearly.after"].next, /recapture with capture\.mjs --capture pricing-yearly/);
});

test("unavailable or unverified source identity needs review instead of passing as fresh", () => {
  const p = project();
  const anonymous = p.capture(["--capture", "settings-profile"], { noSource: true });
  assert.equal(anonymous.status, 0, anonymous.stderr);
  assert.ok(anonymous.json.warnings.some((warning) => /no --source/.test(warning)));
  let status = p.status();
  assert.equal(status["settings-profile.after"].status, "review");
  assert.match(reasons(status["settings-profile.after"]), /source identity was not recorded/);

  const served = p.capture(["--capture", "pricing-yearly"], { baseUrl: "http://localhost:4321/" });
  assert.equal(served.status, 0, served.stderr);
  status = p.status();
  assert.match(reasons(status["pricing-yearly.after"]), /served checkout was not verified/);
  assert.match(status["pricing-yearly.after"].next, /--served-check/);
  const unverifiable = p.manifest("verify", "--capture", "pricing-yearly", "--basis", "looks right");
  assert.notEqual(unverifiable.status, 0);
  assert.match(unverifiable.stderr, /cannot establish where this capture came from.*--served-check/);
  const checked = p.capture(["--capture", "pricing-yearly", "--served-check", "dev server cwd is the app checkout"],
    { baseUrl: "http://localhost:4321/" });
  assert.equal(checked.json.outcome, "unchanged");
  assert.equal(p.status()["pricing-yearly.after"].status, "fresh");

  const stored = p.stored();
  stored.captures["pricing-yearly"].versions.after.verifications.at(-1).source.head = "0".repeat(40);
  writeFileSync(p.manifestPath, JSON.stringify(stored));
  status = p.status();
  assert.equal(status["pricing-yearly.after"].status, "review");
  assert.match(reasons(status["pricing-yearly.after"]), /no longer available/);

  renameSync(p.app, `${p.app}-moved`);
  status = p.status();
  assert.match(reasons(status["pricing-yearly.after"]), /current source identity is unavailable|recipe is unavailable/);
  assert.notEqual(status["pricing-yearly.after"].status, "fresh");
});

test("a follow-up refreshes the affected capture and keeps a verified unaffected asset with its original provenance", () => {
  const p = project();
  captured(p, "settings-profile", "pricing-yearly");
  const original = p.stored();
  const settingsRecord = original.captures["settings-profile"].versions.after;
  const comparisonFile = join(p.evidence, "comparison.png");
  cpSync(original.assets["pricing-yearly.after"].path, comparisonFile);
  const added = p.manifest("add", "--asset", comparisonFile, "--id", "pricing-comparison", "--from", "pricing-yearly.after,settings-profile.after");
  assert.equal(added.status, 0, added.stderr);
  assert.deepEqual(added.json.recorded[0].derivedFrom.map((item) => item.id), ["pricing-yearly.after", "settings-profile.after"]);
  assert.equal(added.json.freshness[0].status, "fresh");

  p.edit("pricing.html", "$120 / year", "$108 / year");
  let status = p.status();
  assert.equal(status["pricing-yearly.after"].status, "stale");
  assert.equal(status["settings-profile.after"].status, "review");
  assert.equal(status["pricing-comparison"].status, "stale");

  const refreshed = p.capture(["--capture", "pricing-yearly"]);
  assert.equal(refreshed.json.outcome, "updated");
  status = p.status();
  assert.equal(status["pricing-yearly.after"].status, "fresh");
  assert.equal(status["settings-profile.after"].status, "review", "unresolved impact stays visible until checked");
  assert.match(reasons(status["pricing-comparison"]), /pricing-yearly\.after was refreshed after this was derived/);

  const verified = p.capture(["--capture", "settings-profile"]);
  assert.equal(verified.json.outcome, "unchanged");
  assert.equal(verified.json.asset.path, original.assets["settings-profile.after"].path);
  const after = p.stored().captures["settings-profile"].versions.after;
  assert.equal(after.capturedAt, settingsRecord.capturedAt);
  assert.deepEqual(after.source, settingsRecord.source, "the original capture provenance is preserved");
  assert.equal(after.source.dirty, false);
  assert.equal(after.verifications.length, 1);
  assert.equal(after.verifications[0].method, "recapture");
  assert.equal(after.verifications[0].source.dirty, true);
  assert.ok(after.verifications[0].source.changes["pricing.html"]);
  status = p.status();
  assert.equal(status["settings-profile.after"].status, "fresh");
  assert.match(status["settings-profile.after"].verifiedBy, /match the recorded asset/);
  assert.equal(p.stored().assets["settings-profile.after"].sha256, original.assets["settings-profile.after"].sha256);
});

test("a manual focused check clears review but never stale evidence", () => {
  const p = project();
  captured(p, "settings-profile", "pricing-yearly");
  p.edit("pricing.html", "$120 / year", "$108 / year");
  const refused = p.manifest("verify", "--capture", "pricing-yearly", "--basis", "looked fine");
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /cannot verify confirmed stale evidence/);
  const missingBasis = p.manifest("verify", "--capture", "settings-profile");
  assert.notEqual(missingBasis.status, 0);
  const verified = p.manifest("verify", "--capture", "settings-profile",
    "--basis", "pricing.html is a separate page; the settings route does not load it");
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(verified.json.status.status, "fresh");
  assert.deepEqual(verified.json.recorded.reviewed, ["changed outside this capture's declared inputs, impact unknown: pricing.html"]);
  p.edit("settings.html", "Sample User", "Example Person");
  assert.equal(p.status()["settings-profile.after"].status, "stale", "later changes are compared with the verified source");
});

test("derived outputs from compare and motion reports link to their recorded sources", () => {
  const p = project();
  captured(p, "settings-profile", "pricing-yearly", "pricing-toggle");
  const stored = p.stored();
  const outDir = join(p.evidence, "compare");
  mkdirSync(outDir);
  const comparison = join(outDir, "comparison.png");
  const detail = join(outDir, "detail-1.png");
  cpSync(stored.assets["settings-profile.after"].path, comparison);
  cpSync(stored.assets["pricing-yearly.after"].path, detail);
  const spec = join(p.evidence, "compare.json");
  writeFileSync(spec, "{}\n");
  writeFileSync(join(outDir, "result.json"), JSON.stringify({
    outputs: { comparison, details: [detail], flip: null, onion: null, markdown: join(outDir, "section.md") },
    inputs: { before: { image: stored.assets["settings-profile.after"].path }, after: { image: stored.assets["pricing-yearly.after"].path } },
    details: [{ id: "1", path: detail }], limitations: ["Detail 1 is a 1x crop"],
  }));
  const compared = p.manifest("add", "--result", join(outDir, "result.json"), "--inputs", spec);
  assert.equal(compared.status, 0, compared.stderr);
  assert.deepEqual(compared.json.recorded.map((item) => item.id), ["compare.comparison", "compare.detail-1"]);
  assert.deepEqual(compared.json.recorded[0].derivedFrom.map((item) => item.id).sort(), ["pricing-yearly.after", "settings-profile.after"]);
  assert.deepEqual(compared.json.limitations, ["Detail 1 is a 1x crop"]);

  const prepared = join(p.evidence, "interaction.mp4");
  writeFileSync(prepared, "prepared video");
  const report = join(p.evidence, "motion-report.json");
  writeFileSync(report, JSON.stringify({ input: stored.assets["pricing-toggle.after"].path, out: prepared,
    prepared: { duration: 3 }, warnings: [] }));
  const motion = p.manifest("add", "--result", report, "--id", "interaction");
  assert.equal(motion.status, 0, motion.stderr);
  assert.deepEqual(motion.json.recorded[0].derivedFrom.map((item) => item.id), ["pricing-toggle.after"]);
  assert.equal(p.stored().assets.interaction.media, "video");

  writeFileSync(spec, "{\"title\":\"changed\"}\n");
  const status = p.status();
  assert.match(reasons(status["compare.comparison"]), /preparation inputs changed/);
  assert.equal(status.interaction.status, "fresh");
  const clash = p.manifest("add", "--asset", prepared, "--id", "pricing-toggle.after");
  assert.notEqual(clash.status, 0);
  assert.match(clash.stderr, /belongs to a capture/);

  // A diamond: two prepared assets share one derived intermediate.
  for (const [id, from] of [["shared", "settings-profile.after"], ["left", "shared"], ["right", "shared"], ["final", "left,right"]]) {
    const file = join(p.evidence, `${id}.png`);
    writeFileSync(file, id);
    const added = p.manifest("add", "--asset", file, "--id", id, "--from", from);
    assert.equal(added.status, 0, added.stderr);
  }
  assert.equal(p.status().final.status, "fresh", reasons(p.status().final));
  const cyclic = p.stored();
  cyclic.assets.shared.derivedFrom = [{ id: "final", sha256: cyclic.assets.final.sha256 }];
  writeFileSync(p.manifestPath, JSON.stringify(cyclic));
  assert.match(reasons(p.status().final), /derivation cycle/);
});

test("capture references are compact Markdown without local paths, URLs, or sessions", () => {
  const p = project();
  captured(p, "settings-profile");
  const served = p.capture(["--capture", "pricing-yearly"], { baseUrl: "http://localhost:4321/", session: "private-session" });
  assert.equal(served.status, 0, served.stderr);
  const result = p.manifest("reference");
  assert.equal(result.status, 0, result.stderr);
  const markdown = result.stdout;
  const head = p.git("rev-parse", "HEAD");
  assert.ok(markdown.includes(`<code>${head.slice(0, 10)}</code>`));
  assert.match(markdown, /Capture <code>settings-profile<\/code>: after captured at .* on <code>main<\/code>, clean/);
  assert.match(markdown, /Limitations: pricing-yearly after \(review\): the served checkout was not verified/);
  for (const secret of [p.root, p.app, "localhost", "private-session", "file:", tmpdir()]) {
    assert.ok(!markdown.includes(secret), `reference leaked ${secret}`);
  }
  assert.doesNotMatch(markdown, /!\[|\]\(/);
  const json = p.manifest("reference", "--json");
  const parsed = JSON.parse(json.stdout);
  assert.equal(parsed.captures.length, 2);
  assert.equal(parsed.captures[0].versions[0].revision, head);

  const recipe = join(p.root, "recipe.json");
  cpSync(join(p.app, "recipe.json"), recipe);
  rmSync(p.app, { recursive: true, force: true });
  const gone = p.manifest("reference", "--recipe", recipe);
  assert.equal(gone.status, 0, gone.stderr);
  assert.match(gone.stdout, /current source identity is unavailable: the checkout is missing or has no commit/);
  for (const secret of [p.root, p.app, "fatal", "cannot change"]) assert.ok(!gone.stdout.includes(secret), `reference leaked ${secret}`);
});

test("status lists recipe captures that have no recorded evidence yet", () => {
  const p = project();
  captured(p, "settings-profile");
  const result = p.manifest("status");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.summary.uncaptured, 2);
  assert.deepEqual(result.json.uncaptured.map((item) => item.capture), ["pricing-yearly", "pricing-toggle"]);
  assert.match(result.json.uncaptured[0].next, /capture\.mjs --capture pricing-yearly/);
  const selected = p.manifest("status", "--capture", "pricing-toggle");
  assert.deepEqual(selected.json.captures, []);
  assert.deepEqual(selected.json.uncaptured.map((item) => item.capture), ["pricing-toggle"]);
});

test("the documented recipe example and the fixture recipe validate", () => {
  const doc = readFileSync(join(repo, "skills", "ui-evidence", "references", "recipes.md"), "utf8");
  const example = /```json\n([\s\S]*?)\n```/.exec(doc);
  assert.ok(example, "recipes.md has a JSON recipe example");
  const recipe = parseRecipe(JSON.parse(example[1]));
  assert.ok(recipe.captures.size >= 2);
  assert.ok([...recipe.captures.values()].some((capture) => capture.kind === "recording"));
  parseRecipe(JSON.parse(readFileSync(join(fixtureApp, "recipe.json"), "utf8")));
});

// Real browser: the documented capture-to-refresh flow on the fixture app.
const browserTests = process.env.UI_EVIDENCE_BROWSER_TESTS === "1";
test("real browser captures refresh only the affected state", { skip: browserTests ? false : "set UI_EVIDENCE_BROWSER_TESTS=1" }, () => {
  const root = join(temp, "real");
  const app = join(root, "app");
  const evidence = join(root, "evidence");
  cpSync(fixtureApp, app, { recursive: true });
  gitIn(app, "init", "-q");
  gitIn(app, "add", ".");
  gitIn(app, "commit", "-qm", "base");
  const session = `uie-recipe-${process.pid}`;
  const run = (id) => {
    const result = spawnSync(process.execPath, [captureScript, "--recipe", join(app, "recipe.json"), "--capture", id,
      "--base-url", `${pathToFileURL(app).href}/`, "--session", session, "--out-dir", evidence,
      "--manifest", join(evidence, "manifest.json"), "--source", app], { encoding: "utf8", timeout: 90_000 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  assert.equal(run("settings-profile").outcome, "captured");
  const first = run("pricing-yearly");
  assert.deepEqual(first.asset.size, [640, 360]);
  const take = run("pricing-toggle");
  assert.ok(take.recording.frames > 30, `recording had ${take.recording.frames} frames`);
  writeFileSync(join(app, "pricing.html"), readFileSync(join(app, "pricing.html"), "utf8").replace("$120 / year", "$108 / year"));
  const status = JSON.parse(execFileSync(process.execPath, [manifestScript, "status", "--manifest", join(evidence, "manifest.json")], { encoding: "utf8" }));
  const byId = Object.fromEntries(status.captures.map((item) => [item.capture, item.status]));
  assert.deepEqual(byId, { "settings-profile": "review", "pricing-yearly": "stale", "pricing-toggle": "stale" });
  assert.equal(run("pricing-yearly").outcome, "updated");
  assert.equal(run("settings-profile").outcome, "unchanged");
});
