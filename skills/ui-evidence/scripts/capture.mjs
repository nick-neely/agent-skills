#!/usr/bin/env node
// Reach one recipe state in a named agent-browser session and capture it.
//
// Usage:
//   node capture.mjs --recipe recipe.json --capture <id> --base-url <url> \
//     --out-dir <evidence-dir> [--version after|before] [--session <name>] \
//     [--manifest <manifest.json>] [--source <checkout> | --baseline <create.json>]
//
// The recipe's agent-browser batch arrays run unchanged. This script owns only
// geometry, readiness and state checks, the capture command, and provenance.
// Servers, authentication, fixtures, and dependencies stay with the caller.

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { effectiveCapture, loadRecipe, recipeHash, RecipeError } from "./recipe.mjs";
import {
  ProvenanceError, checkoutRoot, insideCheckout, pngSize, readManifest, samePixels, sha256File, sleep, sourceIdentity,
  updateManifest,
} from "./provenance.mjs";

const HELP = `capture.mjs - capture one recipe state with provenance

  node capture.mjs --recipe <recipe.json> --capture <id> --base-url <url> --out-dir <dir>
                   [--version after|before] [--session <name>] [--manifest <manifest.json>]
                   [--source <checkout> | --baseline <create.json>] [--served-check <basis>]

  --recipe <path>        Capture recipe; see references/recipes.md
  --capture <id>         Capture ID from the recipe
  --version <name>       after (default) or before; applies that version's overrides
  --base-url <url>       Runtime http(s) or file URL the recipe route resolves against
  --session <name>       Named agent-browser session (default: AGENT_BROWSER_SESSION)
  --out-dir <path>       Evidence directory outside the source checkout
  --manifest <path>      Local provenance manifest to create or update
  --source <path>        Checkout that the server renders for this version
  --baseline <path>      Saved JSON from before-capture.mjs create; its checkout is the source
  --served-check <text>  How you verified that the server renders that checkout

A session that is not active when the capture starts is owned by this run and
closed afterwards; an active session is left open. A recapture whose pixels
match the recorded asset keeps that asset and its original provenance.
`;

const SESSION = /^[A-Za-z0-9._-]{1,64}$/;
const STATE_PROBE = `(() => ({
  href: location.href,
  viewport: { width: window.innerWidth, height: window.innerHeight },
  devicePixelRatio: window.devicePixelRatio,
  theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY) },
}))()`;

class CaptureError extends Error {}

function fail(message) {
  throw new CaptureError(message);
}

function parseArgs(argv) {
  const options = { version: "after" };
  const valued = {
    "--recipe": "recipe", "--capture": "capture", "--version": "version", "--base-url": "baseUrl",
    "--session": "session", "--out-dir": "outDir", "--manifest": "manifest", "--source": "source",
    "--baseline": "baseline", "--served-check": "servedCheck",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    }
    if (!Object.hasOwn(valued, arg)) fail(`unknown option ${arg}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`${arg} requires a value`);
    options[valued[arg]] = value;
    index += 1;
  }
  for (const required of ["recipe", "capture", "baseUrl", "outDir"]) {
    if (!options[required]) fail(`--${required.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`)} is required\n\n${HELP}`);
  }
  if (!["before", "after"].includes(options.version)) fail('--version must be "before" or "after"');
  if (options.source && options.baseline) fail("pass --source or --baseline, not both");
  if (options.baseline && options.version !== "before") fail("--baseline describes the before version; add --version before");
  options.session ??= process.env.AGENT_BROWSER_SESSION;
  if (!options.session) fail("pass --session or set AGENT_BROWSER_SESSION; the shared default session is never used");
  if (!SESSION.test(options.session)) fail("--session must be 1-64 letters, digits, '.', '_' or '-'");
  return options;
}

function baseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`--base-url is not a valid URL: ${value}`);
  }
  if (!["http:", "https:", "file:"].includes(url.protocol)) fail("--base-url must use http, https, or file");
  if (url.username || url.password) fail("--base-url must not contain credentials; authenticate in the session instead");
  return url;
}

function readBaseline(path) {
  let baseline;
  try {
    baseline = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`could not read --baseline ${path}: ${error.message}`);
  }
  if (typeof baseline?.path !== "string" || !/^[0-9a-f]{40,64}$/.test(baseline.mergeBase ?? "") ||
      typeof baseline.base !== "string" || typeof baseline.repoRoot !== "string") {
    fail("--baseline must be the JSON printed by before-capture.mjs create");
  }
  return baseline;
}

function browser(session, args, input) {
  try {
    return { ok: true, stdout: execFileSync("agent-browser", ["--session", session, ...args], {
      encoding: "utf8", input, maxBuffer: 64 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
    }) };
  } catch (error) {
    if (error.code === "ENOENT") fail("agent-browser not found; run scripts/preflight.mjs for the fix");
    return { ok: false, stdout: String(error.stdout ?? ""), stderr: String(error.stderr ?? error.message) };
  }
}

function sessionActive(session) {
  const result = browser(session, ["session", "info", "--json"]);
  try {
    return JSON.parse(result.stdout)?.data?.active !== false;
  } catch {
    // Unknown state: treat it as the caller's session and leave it open.
    return true;
  }
}

// Close a session this run owns and wait for its daemon to exit, so an
// immediate next capture with the same name starts from a clean session.
function closeOwned(session) {
  if (!browser(session, ["close"]).ok) return false;
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (!sessionActive(session)) return true;
    sleep(100);
  }
  return false;
}

// Run batch commands with --bail and return each command's result. A failure
// names the command, its position, and agent-browser's error.
function batch(session, commands, phase) {
  const result = browser(session, ["batch", "--bail", "--json"], JSON.stringify(commands));
  let entries;
  try {
    entries = JSON.parse(result.stdout);
  } catch {
    fail(`${phase} failed: agent-browser batch returned no JSON${result.stderr ? `: ${result.stderr.trim()}` : ""}`);
  }
  if (!Array.isArray(entries)) fail(`${phase} failed: unexpected agent-browser batch output`);
  const failed = entries.findIndex((entry) => !entry?.success);
  if (failed >= 0 || !result.ok || entries.length !== commands.length) {
    const index = failed >= 0 ? failed : entries.length;
    const error = new CaptureError(`${phase} failed at ${JSON.stringify(commands[index] ?? [])}: ` +
      `${entries[index]?.error ?? result.stderr?.trim() ?? "the command did not run"}`);
    error.command = commands[index];
    throw error;
  }
  return entries;
}

function readinessCommands(effective, url) {
  const commands = [
    ["set", "viewport", String(effective.viewport.width), String(effective.viewport.height),
      String(effective.viewport.devicePixelRatio)],
  ];
  if (effective.theme) commands.push(["set", "media", effective.theme]);
  commands.push(["open", url], ...effective.steps);
  if (effective.scroll) commands.push(["eval", `window.scrollTo(${effective.scroll.x}, ${effective.scroll.y})`]);
  commands.push(["wait", "--fn", "!document.fonts || document.fonts.status === 'loaded'"]);
  commands.push(["wait", "--fn", effective.ready]);
  commands.push(["eval", STATE_PROBE]);
  return commands;
}

function relativeHref(href, base) {
  try {
    const url = new URL(href);
    if (url.protocol !== "file:" && url.origin === base.origin) return `${url.pathname}${url.search}${url.hash}`;
    if (url.protocol === "file:" && url.href.startsWith(base.href)) return url.href.slice(base.href.length) || ".";
  } catch {
    // An unparsable location is reported as unknown.
  }
  return null;
}

function checkState(observed, effective, base) {
  const problems = [];
  const { width, height, devicePixelRatio } = effective.viewport;
  if (observed.viewport?.width !== width || observed.viewport?.height !== height) {
    problems.push(`viewport is ${observed.viewport?.width}x${observed.viewport?.height}, expected ${width}x${height}`);
  }
  if (Math.abs((observed.devicePixelRatio ?? 0) - devicePixelRatio) > 0.01) {
    problems.push(`device pixel ratio is ${observed.devicePixelRatio}, expected ${devicePixelRatio}`);
  }
  if (effective.theme && observed.theme !== effective.theme) problems.push(`theme is ${observed.theme}, expected ${effective.theme}`);
  if (effective.scroll && (Math.abs(observed.scroll?.x - effective.scroll.x) > 1 || Math.abs(observed.scroll?.y - effective.scroll.y) > 1)) {
    problems.push(`scroll is ${observed.scroll?.x},${observed.scroll?.y}, expected ${effective.scroll.x},${effective.scroll.y}; ` +
      "the page may be too short or still loading");
  }
  if (problems.length) fail(`the page did not reach the recipe state: ${problems.join("; ")}`);
  return {
    path: relativeHref(observed.href, base),
    viewport: observed.viewport,
    devicePixelRatio: observed.devicePixelRatio,
    theme: observed.theme,
    scroll: observed.scroll,
  };
}

// Whether the capture is known to come from the identified checkout.
function servedEvidence(identity, base, servedCheck) {
  if (servedCheck) return { verified: true, basis: servedCheck };
  if (identity?.available && base.protocol === "file:" && insideCheckout(fileURLToPath(base), identity.root)) {
    return { verified: true, basis: "file URL inside the source checkout" };
  }
  return { verified: false, basis: null };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const recipePath = resolve(options.recipe);
  const recipe = loadRecipe(recipePath);
  const capture = recipe.captures.get(options.capture);
  if (!capture) fail(`recipe has no capture "${options.capture}"; available: ${[...recipe.captures.keys()].join(", ")}`);
  const effective = effectiveCapture(capture, options.version);
  const base = baseUrl(options.baseUrl);
  const url = new URL(effective.route, base).href;
  const outDir = resolve(options.outDir);
  const manifestPath = options.manifest ? resolve(options.manifest) : null;
  const baseline = options.baseline ? readBaseline(resolve(options.baseline)) : null;
  const sourcePath = baseline?.path ?? options.source;
  let identity = null;
  if (sourcePath) {
    identity = sourceIdentity(resolve(sourcePath));
    if (!identity.available) {
      fail(`${baseline ? "--baseline path" : "--source"} cannot be identified: ${identity.reason} (${identity.detail})`);
    }
    if (baseline && identity.head !== baseline.mergeBase) {
      fail(`the baseline checkout is at ${identity.head.slice(0, 10)}, not the recorded merge base ${baseline.mergeBase.slice(0, 10)}`);
    }
  }
  // Runtime records hold local paths, so they never go inside a checkout:
  // the source, the baseline's repository, or the one this runs from.
  for (const root of [identity?.root, baseline?.repoRoot, checkoutRoot(process.cwd())].filter(Boolean)) {
    for (const [label, path] of [["--out-dir", outDir], ["--manifest", manifestPath]]) {
      if (path && insideCheckout(path, root)) fail(`${label} must be outside the source checkout`);
    }
  }
  const servedBy = servedEvidence(identity, base, options.servedCheck);
  const extension = effective.kind === "screenshot" ? "png" : effective.record.format;
  const assetId = `${capture.id}.${options.version}`;
  const target = resolve(outDir, `${assetId}.${extension}`);
  const manifest = manifestPath && existsSync(manifestPath) ? readManifest(manifestPath) : null;
  if (manifest?.recipe?.path && manifest.recipe.path !== recipePath && !(recipe.id && manifest.recipe.id === recipe.id)) {
    fail(`the manifest belongs to recipe ${manifest.recipe.path}; use a separate manifest for this recipe`);
  }
  const previousId = manifest?.captures[capture.id]?.versions?.[options.version]?.asset;
  const previous = previousId ? manifest.assets[previousId] : null;
  if (existsSync(target) && previous?.path !== target) {
    fail(`${target} already exists and is not this capture's recorded asset; choose another --out-dir`);
  }
  mkdirSync(outDir, { recursive: true });

  const session = options.session;
  const owned = !sessionActive(session);
  const temporary = resolve(outDir, `.${assetId}.${randomBytes(6).toString("hex")}.${extension}`);
  try {
    return captureAndRecord({ options, recipe, recipePath, capture, effective, base, url, manifestPath, baseline,
      identity, servedBy, assetId, target, previousId, previous, session, owned, temporary });
  } finally {
    rmSync(temporary, { force: true });
  }
}

// Everything after validation: drive the browser, then record the result.
function captureAndRecord(plan) {
  const { options, recipe, recipePath, capture, effective, base, url, manifestPath, baseline, identity, servedBy,
    assetId, target, previousId, previous, session, owned, temporary } = plan;
  const warnings = [];
  let state;
  let recording = null;
  let closed = false;
  try {
    const readiness = readinessCommands(effective, url);
    let ready;
    try {
      ready = batch(session, readiness, "readiness");
    } catch (error) {
      if (error.command === readiness.at(-2)) error.message = `ready assertion did not become true: ${error.message}`;
      throw error;
    }
    state = checkState(ready.at(-1).result?.result ?? {}, effective, base);
    if (effective.kind === "screenshot") {
      const shot = ["screenshot", ...(effective.screenshot.full ? ["--full"] : []),
        ...(effective.screenshot.selector ? [effective.screenshot.selector] : []), temporary];
      batch(session, [shot], "screenshot");
    } else {
      const start = ["record", "start", temporary, "--fps", String(effective.record.fps),
        ...(effective.record.cursor ? ["--cursor"] : [])];
      // One batch keeps the take free of process gaps between planned actions.
      try {
        const results = batch(session, [start, ...effective.actions, ["wait", "--fn", effective.expect],
          ["record", "stop"]], "recording");
        const { lifecycle, path: _path, ...stopped } = results.at(-1).result ?? {};
        recording = stopped;
      } catch (error) {
        // Stop only a take this run started; a caller's recording stays intact.
        if (error.command !== start) browser(session, ["record", "stop"]);
        if (existsSync(temporary)) {
          const rejected = resolve(dirname(target), `${assetId}.rejected.${effective.record.format}`);
          rmSync(rejected, { force: true });
          renameSync(temporary, rejected);
          error.message += `; the rejected take is kept for inspection at ${rejected} and was not recorded`;
        }
        throw error;
      }
    }
    if (!existsSync(temporary) || !statSync(temporary).size) fail(`agent-browser wrote no ${effective.kind} to ${temporary}`);
  } finally {
    if (owned) closed = closeOwned(session);
  }

  const size = pngSize(temporary);
  if (effective.kind === "screenshot" && !size) fail("agent-browser did not write a PNG screenshot");
  if (size && !effective.screenshot.full && !effective.screenshot.selector) {
    const expected = [Math.round(effective.viewport.width * effective.viewport.devicePixelRatio),
      Math.round(effective.viewport.height * effective.viewport.devicePixelRatio)];
    if (size[0] !== expected[0] || size[1] !== expected[1]) {
      warnings.push(`screenshot is ${size.join("x")} pixels, expected ${expected.join("x")} for the viewport and pixel ratio`);
    }
  }
  const createdAt = new Date().toISOString();
  const asset = {
    path: target, sha256: sha256File(temporary), bytes: statSync(temporary).size,
    media: effective.kind === "screenshot" ? "image" : "video", ...(size ? { size } : {}),
    capture: capture.id, version: options.version, createdAt,
  };
  const sourceRecord = identity && (baseline ? {
    ...identity, kind: "baseline",
    base: { ref: baseline.ref ?? null, label: baseline.base, source: baseline.baseSource ?? null,
      revision: baseline.baseRevision ?? null, mergeBase: baseline.mergeBase, repoRoot: baseline.repoRoot,
      pullRequest: baseline.pullRequest ?? null },
  } : identity);
  const provenance = { recipe: recipeHash(effective), fixture: effective.fixture, source: sourceRecord ?? null, served: servedBy };

  // A recapture that matches the recorded asset keeps it, with its original
  // provenance, and adds this run as a verification.
  const intact = previous && existsSync(previous.path) && sha256File(previous.path) === previous.sha256;
  const comparison = intact ? samePixels(previous.path, temporary) : { same: false };
  let outcome = previousId ? "updated" : "captured";
  let kept = { id: assetId, ...asset };
  if (comparison.same) {
    outcome = "unchanged";
    kept = { id: previousId, ...previous };
    updateManifest(manifestPath, (current) => {
      const record = current.captures[capture.id].versions[options.version];
      record.verifications ??= [];
      record.verifications.push({ at: createdAt, method: "recapture",
        basis: `recaptured ${comparison.method} match the recorded asset`, ...provenance, state });
    }, { create: false });
  } else {
    renameSync(temporary, target);
    if (manifestPath) {
      updateManifest(manifestPath, (current) => {
        current.recipe = { path: recipePath, id: recipe.id };
        const entry = current.captures[capture.id] ??= { claims: [], versions: {} };
        entry.claims = capture.claims;
        entry.versions[options.version] = {
          asset: assetId, kind: effective.kind, capturedAt: createdAt, route: effective.route, state, ...provenance,
          ...(recording ? { recording } : {}), verifications: [],
        };
        current.assets[assetId] = asset;
      });
    }
  }

  console.log(JSON.stringify({
    capture: capture.id, version: options.version, kind: effective.kind, outcome,
    asset: { id: kept.id, path: kept.path, sha256: kept.sha256, bytes: kept.bytes, ...(kept.size ? { size: kept.size } : {}) },
    route: effective.route, state, recipe: provenance.recipe, fixture: effective.fixture,
    source: sourceRecord ? { kind: sourceRecord.kind, head: sourceRecord.head, branch: sourceRecord.branch ?? null,
      dirty: sourceRecord.dirty, fingerprint: sourceRecord.fingerprint } : null,
    served: servedBy, session: { name: session, owned, closed }, manifest: manifestPath,
    ...(recording ? { recording } : {}),
    warnings: [...warnings, ...(servedBy.verified ? [] : ["served checkout not verified; pass --served-check after confirming it"]),
      ...(sourceRecord ? [] : ["no --source recorded; freshness cannot be verified for this capture"])],
  }, null, 2));
}

try {
  main();
} catch (error) {
  if (error instanceof CaptureError || error instanceof RecipeError || error instanceof ProvenanceError) {
    console.error(`capture: ${error.message}`);
  } else {
    console.error(`capture: ${error.stack ?? error.message}`);
  }
  process.exitCode = 1;
}
