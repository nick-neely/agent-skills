// External boundaries for running the ui-evidence worked examples in tests.
// Loaded into every node process with NODE_OPTIONS=--import.
//
// GitHub is always faked: the state file holds the pull request's base and its
// saved body, and native attachment uploads return hosted URLs. agent-browser
// is faked when UI_EVIDENCE_FAKE_BROWSER=1: screenshots are PNGs whose colour
// derives from the served page and the clicks made on it, and a recording is a
// real MP4 whose colours change at each action on a virtual clock. Without that
// variable the real agent-browser runs.

import cp from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const realExec = cp.execFileSync;
const realSpawn = cp.spawnSync;
const stateDir = process.env.UI_EVIDENCE_EXAMPLE_STATE;
const fakeBrowser = process.env.UI_EVIDENCE_FAKE_BROWSER === "1";

class BoundaryFailure extends Error {
  constructor(message, stdout = "") {
    super(message);
    this.status = 1;
    this.stdout = stdout;
    this.stderr = message;
  }
}

const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);

// ---------------------------------------------------------------------------
// GitHub

function gh(args, options) {
  const path = join(stateDir, "github.json");
  const state = readJson(path, null);
  const save = () => writeFileSync(path, JSON.stringify(state, null, 2));
  state.calls.push(args);
  const done = (value) => { save(); return value; };
  if (args[0] === "--version") return done("gh version 2.99.0 (fake)\n");
  if (args[0] === "auth" && args[1] === "token") return done("test-token\n");
  if (args.includes("--help")) return done("Usage: gh pr edit\n  --attach string\n");
  const repo = args[args.indexOf("--repo") + 1];
  if (args[0] === "pr" && args[1] === "view") {
    if (repo !== state.repo || args[2] !== String(state.number)) { save(); throw new BoundaryFailure("Not Found"); }
    return done(JSON.stringify({ number: state.number, baseRefName: state.baseRefName, baseRefOid: state.baseRefOid, state: "OPEN" }));
  }
  if (args[0] === "api") {
    const method = args.includes("--method") ? args[args.indexOf("--method") + 1] : "GET";
    const target = args.find((item) => item === "user" || item.startsWith("repos/"));
    if (target === "user") return done(JSON.stringify({ login: "me" }));
    const match = /^repos\/([^/]+\/[^/]+)\/(pulls|issues)\/(\d+)$/.exec(target ?? "");
    if (!match || match[1] !== state.repo || Number(match[3]) !== state.number) { save(); throw new BoundaryFailure("Not Found"); }
    if (method === "PATCH") state.body = JSON.parse(String(options.input)).body;
    return done(JSON.stringify({ body: state.body, ...(match[2] === "issues" ? { pull_request: {} } : {}) }));
  }
  if (args[0] === "pr" && args[1] === "edit") {
    if (repo !== state.repo) { save(); throw new BoundaryFailure("Not Found"); }
    let body = String(options.input ?? "");
    args.forEach((arg, index) => {
      if (arg !== "--attach") return;
      const file = args[index + 1];
      const url = `https://github.com/user-attachments/assets/example-${state.uploads.push(file)}`;
      const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const image = new RegExp(`!\\[([^\\]]*)\\]\\((?:<${escaped}>|${escaped})\\)`, "g");
      body = body.replace(image, (_, alt) => (/\.(mp4|mov|webm)$/i.test(file) ? url : `![${alt}](${url})`));
    });
    state.body = body;
    return done(`https://github.com/${state.repo}/pull/${state.number}\n`);
  }
  save();
  throw new BoundaryFailure(`unexpected gh ${JSON.stringify(args)}`);
}

// ---------------------------------------------------------------------------
// agent-browser

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
    chunk("IDAT", deflateSync(Buffer.concat(Array(height).fill(row)))), chunk("IEND", Buffer.alloc(0))]);
}

// A light colour that changes with the served page and the clicks made on it.
function colour(state) {
  const url = new URL(state.url);
  const page = url.protocol === "file:" && existsSync(fileURLToPath(url)) ? readFileSync(fileURLToPath(url)) : Buffer.from(state.url);
  const digest = createHash("sha256").update(page).update(JSON.stringify(state.clicked)).digest();
  return [...digest.subarray(0, 3)].map((value) => 160 + (value % 90));
}

const hex = (rgb) => `0x${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;

// Advance the recording's virtual clock and note the colour shown from then on.
function tick(state, seconds) {
  if (!state.take) return;
  state.take.clock += seconds;
  state.take.segments.push({ at: state.take.clock, rgb: colour(state) });
}

function writeTake(state) {
  const { path, fps, segments, clock } = state.take;
  const [width, height, ratio] = state.viewport;
  const size = `${Math.round(width * ratio)}x${Math.round(height * ratio)}`;
  const spans = segments.map((segment, index) => ({ rgb: segment.rgb, duration: (segments[index + 1]?.at ?? clock + 0.4) - segment.at }))
    .filter((span) => span.duration > 0.001);
  const inputs = spans.flatMap((span) => ["-f", "lavfi", "-i", `color=c=${hex(span.rgb)}:s=${size}:r=${fps}:d=${span.duration.toFixed(3)}`]);
  realExec("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex",
    `${spans.map((_, index) => `[${index}:v]`).join("")}concat=n=${spans.length}:v=1[v]`, "-map", "[v]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", path]);
  const frames = Math.round((clock + 0.4) * fps);
  return { path, frames, capturedFrames: spans.length, fps };
}

function command(state, [name, ...args]) {
  if (name === "set" && args[0] === "viewport") state.viewport = args.slice(1).map(Number);
  else if (name === "set" && args[0] === "media") state.theme = args[1];
  else if (name === "open") Object.assign(state, { url: args[0], clicked: [], scroll: [0, 0] });
  else if (name === "click") {
    state.clicked.push(args[0]);
    tick(state, 0.1);
  } else if (name === "press") {
    state.clicked.push(`key:${args[0]}`);
    tick(state, 0.1);
  } else if (name === "reload") {
    // Fixture pages persist their last choice, so a reload keeps the state.
    tick(state, 0.3);
  } else if (name === "wait") {
    tick(state, args[0] === "--fn" ? 0.2 : Number(args[0]) / 1000);
  } else if (name === "eval" && args[0] === "location.href") return { result: state.url };
  else if (name === "eval" && args[0].includes("location.href")) {
    return { result: { href: state.url, viewport: { width: state.viewport[0], height: state.viewport[1] },
      devicePixelRatio: state.viewport[2], theme: state.theme, scroll: { x: state.scroll[0], y: state.scroll[1] } } };
  } else if (name === "eval" && args[0].startsWith("window.scrollTo(")) {
    state.scroll = args[0].slice(16, -1).split(",").map(Number);
  } else if (name === "screenshot") {
    const [width, height, ratio] = state.viewport;
    writeFileSync(args.at(-1), png(Math.round(width * ratio), Math.round(height * ratio), colour(state)));
  } else if (name === "record" && args[0] === "start") {
    state.take = { path: args[1], fps: Number(args[args.indexOf("--fps") + 1] ?? 30), clock: 0, segments: [{ at: 0, rgb: colour(state) }] };
  } else if (name === "record" && args[0] === "stop") {
    const stopped = writeTake(state);
    delete state.take;
    return stopped;
  }
  return {};
}

function browser(args, options) {
  const [flag, session, ...rest] = args;
  if (flag === "--version") return "agent-browser 0.39.0 (fake)\n";
  if (flag === "doctor") return JSON.stringify({ checks: [{ id: "chrome.installed", status: "pass" }] });
  if (flag !== "--session") throw new BoundaryFailure(`unexpected agent-browser ${JSON.stringify(args)}`);
  const path = join(stateDir, `browser-${session}.json`);
  const state = readJson(path, null);
  if (rest[0] === "session") return JSON.stringify({ success: true, data: { session, active: Boolean(state) } });
  if (rest[0] === "close") {
    rmSync(path, { force: true });
    return JSON.stringify({ success: true, data: { closed: true } });
  }
  const current = state ?? { viewport: [1280, 720, 1], theme: "light", url: "about:blank", clicked: [], scroll: [0, 0] };
  if (rest[0] !== "batch") throw new BoundaryFailure(`unexpected agent-browser ${rest[0]}`);
  const results = [];
  for (const item of JSON.parse(options.input)) {
    try {
      results.push({ command: item, success: true, error: null, result: command(current, item) });
    } catch (error) {
      results.push({ command: item, success: false, error: error.message, result: null });
      break;
    }
  }
  writeFileSync(path, JSON.stringify(current));
  return JSON.stringify(results);
}

// ---------------------------------------------------------------------------

function fake(binary, args, options = {}) {
  if (binary === "gh") return gh(args, options);
  return browser(args, options);
}

const faked = (binary) => binary === "gh" || (fakeBrowser && binary === "agent-browser");

cp.execFileSync = (binary, args = [], options = {}) => {
  if (!faked(binary)) return realExec(binary, args, options);
  const output = fake(binary, args, options);
  return options.encoding ? output : Buffer.from(output);
};

cp.spawnSync = (binary, args = [], options = {}) => {
  if (!faked(binary)) return realSpawn(binary, args, options);
  try {
    const output = fake(binary, args, options);
    return { status: 0, signal: null, stdout: output, stderr: "", error: undefined };
  } catch (error) {
    return { status: 1, signal: null, stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? error.message), error: undefined };
  }
};

syncBuiltinESMExports();
