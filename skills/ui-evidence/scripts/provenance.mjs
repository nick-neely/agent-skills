// Local evidence provenance: source identity, the versioned manifest, and
// freshness decisions shared by capture.mjs, manifest.mjs, and publish.mjs.
//
// The manifest is a local runtime record. It may hold absolute paths, so it
// stays outside the source checkout and is never published. Markdown produced
// from it (referenceMarkdown) carries only revisions, IDs, and relative paths.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, renameSync, unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { effectiveCapture, globMatcher, loadRecipe, recipeHash } from "./recipe.mjs";

export const MANIFEST_VERSION = 1;
export const SOURCE_SCOPE = "tracked and untracked files; ignored files and submodule contents are not fingerprinted";
const RANK = { fresh: 0, review: 1, stale: 2 };
const SHOWN_PATHS = 8;

export class ProvenanceError extends Error {}

function fail(message) {
  throw new ProvenanceError(message);
}

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function sha256File(path) {
  return sha256(readFileSync(path));
}

export function short(oid) {
  return typeof oid === "string" ? oid.slice(0, 10) : null;
}

export function inside(path, root) {
  const rel = relative(root, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function canonicalPath(path) {
  const absolute = resolve(path);
  let ancestor = absolute;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  return resolve(realpathSync.native(ancestor), relative(ancestor, absolute));
}

export function insideCheckout(path, root) {
  return inside(canonicalPath(path), canonicalPath(root));
}

// PNG width and height from the IHDR chunk, or null for other media.
export function pngSize(path) {
  const header = Buffer.alloc(24);
  const fd = openSync(path, "r");
  try {
    if (readSync(fd, header, 0, 24, 0) < 24) return null;
  } finally {
    closeSync(fd);
  }
  if (!header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return null;
  return [header.readUInt32BE(16), header.readUInt32BE(20)];
}

let magick;
function pixelSignature(path) {
  if (magick === undefined) {
    magick = null;
    const candidates = process.platform === "win32" ? [["magick", ["identify"]]] : [["magick", ["identify"]], ["identify", []]];
    for (const [binary, prefix] of candidates) {
      try {
        execFileSync(binary, [...prefix, "-version"], { stdio: "ignore" });
        magick = { binary, prefix };
        break;
      } catch {
        // try the next candidate
      }
    }
  }
  if (!magick) return null;
  try {
    return execFileSync(magick.binary, [...magick.prefix, "-format", "%w %h %#", path],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// Identical bytes, or for images identical decoded pixels when ImageMagick can
// decode both. Anything else counts as different.
export function samePixels(first, second) {
  const a = readFileSync(first);
  const b = readFileSync(second);
  if (a.equals(b)) return { same: true, method: "bytes" };
  if (!pngSize(first) || !pngSize(second)) return { same: false, method: "bytes" };
  const left = pixelSignature(first);
  const right = left && pixelSignature(second);
  if (!left || !right) return { same: false, method: "bytes" };
  return { same: left === right, method: "pixels" };
}

function git(root, args, input) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", maxBuffer: 256 * 1024 * 1024, input, stdio: ["pipe", "pipe", "pipe"],
  });
}

function gitError(error) {
  return error.stderr?.toString().trim().split("\n")[0] || error.message;
}

// HEAD plus a content fingerprint of every changed, added, deleted, or
// untracked (non-ignored) file. A dirty flag alone cannot tell two dirty trees
// apart; the per-path blob IDs can, and they let freshness name what changed.
export function sourceIdentity(path) {
  let root;
  let head;
  try {
    root = realpathSync.native(git(path, ["rev-parse", "--show-toplevel"]).trim());
    head = git(root, ["rev-parse", "--verify", "HEAD"]).trim();
  } catch (error) {
    return { available: false, reason: `not a git checkout with a commit: ${gitError(error)}` };
  }
  let branch = null;
  try {
    branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]).trim() || null;
  } catch {
    // Detached HEAD has no branch name; the revision still identifies it.
  }
  const status = git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames",
    "--ignore-submodules=all"]);
  const paths = [...new Set(status.split("\0").filter(Boolean).map((entry) => entry.slice(3)))].sort();
  const changes = {};
  const files = [];
  for (const path of paths) {
    const absolute = join(root, path);
    let stat;
    try { stat = lstatSync(absolute); } catch { stat = null; }
    if (!stat) changes[path] = "absent";
    else if (stat.isDirectory()) changes[path] = "directory";
    else files.push(path);
  }
  if (files.some((path) => path.includes("\n"))) {
    return { available: false, reason: "a changed path contains a newline, so its content cannot be fingerprinted" };
  }
  if (files.length) {
    const ids = git(root, ["hash-object", "--stdin-paths"], `${files.join("\n")}\n`).trim().split("\n");
    files.forEach((path, index) => { changes[path] = ids[index]; });
  }
  const sorted = Object.fromEntries(Object.entries(changes).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return {
    available: true, kind: "checkout", root, head, branch, dirty: paths.length > 0,
    fingerprint: sha256(JSON.stringify([head, Object.entries(sorted)])), changes: sorted, scope: SOURCE_SCOPE,
  };
}

function commitExists(root, oid) {
  try {
    git(root, ["cat-file", "-e", `${oid}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

function treeBlobs(root, commit, paths) {
  const blobs = new Map();
  for (let index = 0; index < paths.length; index += 200) {
    const chunk = paths.slice(index, index + 200);
    const listing = git(root, ["--literal-pathspecs", "ls-tree", "-r", "-z", "--full-tree", commit, "--", ...chunk]);
    for (const entry of listing.split("\0").filter(Boolean)) {
      const tab = entry.indexOf("\t");
      blobs.set(entry.slice(tab + 1), entry.slice(0, tab).split(" ")[2]);
    }
  }
  return blobs;
}

// Paths whose content differs between two identities of the same repository.
export function changedPaths(then, now) {
  const root = now.root;
  const candidates = new Set([...Object.keys(then.changes ?? {}), ...Object.keys(now.changes ?? {})]);
  if (then.head !== now.head) {
    if (!commitExists(root, then.head)) fail(`captured revision ${short(then.head)} is no longer available in this repository`);
    const diff = git(root, ["diff", "--name-only", "-z", "--no-renames", then.head, now.head]);
    for (const path of diff.split("\0").filter(Boolean)) candidates.add(path);
  }
  const paths = [...candidates].sort();
  const before = treeBlobs(root, then.head, paths);
  const after = then.head === now.head ? before : treeBlobs(root, now.head, paths);
  const content = (identity, blobs, path) => identity.changes?.[path] ?? blobs.get(path) ?? "absent";
  return paths.filter((path) => content(then, before, path) !== content(now, after, path));
}

// Baselines come from a temporary worktree at a merge base. Their current
// identity is the merge base the same base ref would select now.
export function baselineIdentity(base) {
  if (!base?.repoRoot || !existsSync(base.repoRoot)) {
    return { available: false, reason: "the repository that selected this baseline is unavailable" };
  }
  try {
    const head = git(base.repoRoot, ["merge-base", "HEAD", base.ref ?? base.revision]).trim();
    return { available: true, kind: "baseline", root: base.repoRoot, head, dirty: false, changes: {} };
  } catch (error) {
    return { available: false, reason: `could not resolve the merge base with ${base.ref ?? short(base.revision)}: ${gitError(error)}` };
  }
}

export function emptyManifest() {
  return { version: MANIFEST_VERSION, recipe: null, captures: {}, assets: {}, publications: [] };
}

export function readManifest(path) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`could not read manifest ${path}: ${error.message}`);
  }
  if (!manifest || typeof manifest !== "object" || manifest.version !== MANIFEST_VERSION ||
      typeof manifest.captures !== "object" || typeof manifest.assets !== "object" || !Array.isArray(manifest.publications)) {
    fail(`${path} is not a version ${MANIFEST_VERSION} ui-evidence manifest`);
  }
  return manifest;
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

// Read-modify-write under an exclusive lock file, replacing the manifest
// atomically so a concurrent before/after capture cannot lose an entry.
export function updateManifest(path, mutate, { create = true } = {}) {
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  const started = Date.now();
  let fd;
  for (;;) {
    try {
      fd = openSync(lock, "wx");
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() - started > 15_000) {
        fail(`manifest is locked by ${lock}; if no capture is running, remove that lock file and retry`);
      }
      sleep(50);
    }
  }
  try {
    const manifest = existsSync(path) ? readManifest(path) : create ? emptyManifest() : fail(`no manifest at ${path}`);
    const result = mutate(manifest);
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(temporary, path);
    return result;
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

function worst(levels) {
  return levels.reduce((current, level) => (RANK[level] > RANK[current] ? level : current), "fresh");
}

function listPaths(paths) {
  const shown = paths.slice(0, SHOWN_PATHS).join(", ");
  return paths.length > SHOWN_PATHS ? `${shown}, and ${paths.length - SHOWN_PATHS} more` : shown;
}

function assetIntegrity(asset) {
  if (!asset) return [{ level: "stale", text: "asset record is missing from the manifest" }];
  if (!existsSync(asset.path)) return [{ level: "stale", text: "asset file is missing" }];
  if (sha256File(asset.path) !== asset.sha256) {
    return [{ level: "stale", text: "asset file changed after it was recorded (overwritten or tampered)" }];
  }
  return [];
}

// The record that currently vouches for a capture: its newest verification,
// or the capture itself. Verifications keep the original capture provenance.
export function currentBasis(record) {
  return record.verifications?.at(-1) ?? record;
}

function sourceReasons(basis, recipe, capture, cache) {
  const reasons = [];
  if (!basis.served?.verified) {
    reasons.push({ level: "review", text: "the served checkout was not verified for this capture" });
  }
  if (!basis.source) return [...reasons, { level: "review", text: "source identity was not recorded at capture" }];
  const key = basis.source.kind === "baseline" ? `baseline:${JSON.stringify(basis.source.base)}` : `checkout:${basis.source.root}`;
  if (!cache.has(key)) {
    cache.set(key, basis.source.kind === "baseline" ? baselineIdentity(basis.source.base) : sourceIdentity(basis.source.root));
  }
  const now = cache.get(key);
  if (!now.available) return [...reasons, { level: "review", text: `current source identity is unavailable: ${now.reason}` }];
  let changed;
  try {
    changed = changedPaths(basis.source, now);
  } catch (error) {
    return [...reasons, { level: "review", text: error.message }];
  }
  const direct = globMatcher(capture.inputs);
  const shared = globMatcher(recipe.sources.shared);
  const ignored = globMatcher(recipe.sources.ignore);
  const groups = { direct: [], shared: [], unknown: [] };
  for (const path of changed) {
    if (direct(path)) groups.direct.push(path);
    else if (ignored(path)) continue;
    else if (shared(path)) groups.shared.push(path);
    else groups.unknown.push(path);
  }
  if (groups.direct.length) reasons.push({ level: "stale", text: `capture input changed: ${listPaths(groups.direct)}`, paths: groups.direct });
  if (groups.shared.length) reasons.push({ level: "review", text: `shared input changed: ${listPaths(groups.shared)}`, paths: groups.shared });
  if (groups.unknown.length) {
    reasons.push({
      level: "review",
      text: `changed outside this capture's declared inputs, impact unknown: ${listPaths(groups.unknown)}`,
      paths: groups.unknown,
    });
  }
  return reasons;
}

function captureNext(status, captureId, version) {
  if (status === "fresh") return "reuse";
  const recapture = `capture.mjs --capture ${captureId} --version ${version}`;
  if (status === "stale") return `recapture with ${recapture}`;
  return `recapture with ${recapture} (identical pixels keep the original), or record a focused check with ` +
    `manifest.mjs verify --capture ${captureId} --version ${version} --basis "<what you checked>"`;
}

export function assessCapture(manifest, recipe, captureId, version, cache = new Map()) {
  const record = manifest.captures[captureId]?.versions?.[version];
  if (!record) return null;
  const reasons = [...assetIntegrity(manifest.assets[record.asset])];
  const capture = recipe?.captures.get(captureId);
  const basis = currentBasis(record);
  if (!recipe) reasons.push({ level: "review", text: "the recipe is unavailable, so recipe identity cannot be checked" });
  else if (!capture) reasons.push({ level: "review", text: "the capture is no longer in the recipe" });
  else {
    const effective = effectiveCapture(capture, version);
    if (recipeHash(effective) !== basis.recipe) reasons.push({ level: "stale", text: "recipe setup changed for this capture" });
    if ((effective.fixture ?? null) !== (basis.fixture ?? null)) {
      reasons.push({ level: "stale", text: `fixture changed from ${basis.fixture ?? "none"} to ${effective.fixture ?? "none"}` });
    }
    reasons.push(...sourceReasons(basis, recipe, capture, cache));
  }
  const status = worst(reasons.map((reason) => reason.level));
  return {
    capture: captureId, version, asset: record.asset, status, reasons,
    verifiedBy: record.verifications?.length ? basis.basis : null, next: captureNext(status, captureId, version),
  };
}

function assessAsset(manifest, id, captureStatus, seen = new Set()) {
  const asset = manifest.assets[id];
  if (!asset) return { asset: id, status: "stale", reasons: [{ level: "stale", text: "asset record is missing" }] };
  if (asset.capture) {
    const result = captureStatus(asset.capture, asset.version);
    return result ?? { asset: id, status: "review", reasons: [{ level: "review", text: "its capture record is missing" }] };
  }
  const reasons = [...assetIntegrity(asset)];
  if (!asset.derivedFrom?.length) {
    reasons.push({ level: "review", text: "recorded without capture provenance; inspect it before reuse" });
  }
  if (seen.has(id)) return { asset: id, status: "review", reasons: [{ level: "review", text: "derivation cycle" }] };
  seen.add(id);
  for (const source of asset.derivedFrom ?? []) {
    const current = manifest.assets[source.id];
    if (!current) {
      reasons.push({ level: "stale", text: `source asset ${source.id} is no longer recorded` });
      continue;
    }
    if (current.sha256 !== source.sha256) {
      reasons.push({ level: "stale", text: `source asset ${source.id} was refreshed after this was derived; regenerate it` });
      continue;
    }
    const upstream = assessAsset(manifest, source.id, captureStatus, seen);
    if (upstream.status !== "fresh") {
      reasons.push({ level: upstream.status, text: `source asset ${source.id} is ${upstream.status}` });
    }
  }
  if (asset.inputs) {
    if (!existsSync(asset.inputs.path)) reasons.push({ level: "review", text: "its preparation inputs file is missing" });
    else if (sha256File(asset.inputs.path) !== asset.inputs.sha256) {
      reasons.push({ level: "stale", text: "its preparation inputs changed; regenerate it" });
    }
  }
  const status = worst(reasons.map((reason) => reason.level));
  return {
    asset: id, status, reasons,
    next: status === "fresh" ? "reuse" : "refresh its sources, regenerate it, and record it again with manifest.mjs add",
  };
}

export function loadRecipeFor(manifest, recipePath) {
  const path = recipePath ?? manifest.recipe?.path;
  if (!path) return { recipe: null, limitation: "no recipe is recorded; pass --recipe" };
  try {
    return { recipe: loadRecipe(path), path };
  } catch (error) {
    return { recipe: null, path, limitation: error.message };
  }
}

// Batch freshness for every recorded capture and derived asset.
export function assessManifest(manifest, { recipePath, captures } = {}) {
  const { recipe, path, limitation } = loadRecipeFor(manifest, recipePath);
  const cache = new Map();
  const memo = new Map();
  const captureStatus = (id, version) => {
    const key = `${id}\0${version}`;
    if (!memo.has(key)) memo.set(key, assessCapture(manifest, recipe, id, version, cache));
    return memo.get(key);
  };
  const selected = captures?.length ? captures : Object.keys(manifest.captures);
  const results = [];
  for (const id of selected) {
    const versions = manifest.captures[id]?.versions;
    if (!versions) {
      results.push({ capture: id, status: "review", reasons: [{ level: "review", text: "no recorded capture" }], next: "capture it" });
      continue;
    }
    for (const version of Object.keys(versions)) results.push(captureStatus(id, version));
  }
  const derived = captures?.length ? [] : Object.keys(manifest.assets)
    .filter((id) => !manifest.assets[id].capture)
    .map((id) => assessAsset(manifest, id, captureStatus));
  const all = [...results, ...derived];
  const summary = { fresh: 0, review: 0, stale: 0 };
  for (const item of all) summary[item.status] += 1;
  return {
    recipe: path ?? null,
    summary,
    captures: results,
    assets: derived,
    limitations: [
      ...(limitation ? [limitation] : []),
      `Source fingerprints cover ${SOURCE_SCOPE}.`,
      "Impact is decided from declared inputs and paths, not rendered output; review results need inspection.",
    ],
    assess: (id) => assessAsset(manifest, id, captureStatus),
  };
}

export function assetsByHash(manifest) {
  const byHash = new Map();
  for (const [id, asset] of Object.entries(manifest.assets)) {
    if (!byHash.has(asset.sha256)) byHash.set(asset.sha256, []);
    byHash.get(asset.sha256).push(id);
  }
  return byHash;
}

// Freshness for the files a publication references, keyed by content.
export function publicationFreshness(manifest, files, options = {}) {
  const report = assessManifest(manifest, options);
  const byHash = assetsByHash(manifest);
  const items = files.map(({ file, refs }) => {
    const hash = sha256File(file);
    const ids = byHash.get(hash) ?? [];
    if (!ids.length) {
      return { refs, assets: [], sha256: hash, status: "untracked", reasons: ["not recorded in the manifest"] };
    }
    const results = ids.map((id) => report.assess(id));
    const status = worst(results.map((result) => result.status));
    return {
      refs, assets: ids, sha256: hash, status,
      reasons: results.flatMap((result) => result.reasons.filter((reason) => reason.level !== "fresh").map((reason) => reason.text)),
    };
  });
  const summary = { fresh: 0, review: 0, stale: 0, untracked: 0 };
  for (const item of items) summary[item.status] += 1;
  return { summary, assets: items, limitations: report.limitations };
}

export function recordPublication(path, entry) {
  updateManifest(path, (manifest) => {
    manifest.publications.push({ at: new Date().toISOString(), ...entry });
  }, { create: false });
}

function escapeMarkdown(value) {
  return String(value).replace(/[&<>"'`[\]!|*_\\]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function code(value) {
  return `<code>${escapeMarkdown(value)}</code>`;
}

function describeSource(source) {
  if (!source) return "an unrecorded source";
  if (source.kind === "baseline") {
    const origin = { "pull-request": "pull request target", explicit: "explicit base", default: "default branch" }[source.base?.source];
    const label = source.base?.ref ?? source.base?.label;
    const via = label ? `, the merge base with ${code(label)}${origin ? ` (${origin})` : ""}` : "";
    return `${code(short(source.head))}${via}${source.dirty ? ` with local changes ${code(short(source.fingerprint))}` : ""}`;
  }
  const branch = source.branch ? ` on ${code(source.branch)}` : "";
  const state = source.dirty ? ` with uncommitted changes (fingerprint ${code(short(source.fingerprint))})` : ", clean";
  return `${code(short(source.head))}${branch}${state}`;
}

// The original capture source, then the newest recheck when one vouches for it.
function describeVersion(version, record) {
  const captured = `${version} captured at ${describeSource(record.source)}`;
  const latest = record.verifications?.at(-1);
  if (!latest) return captured;
  const how = latest.method === "recapture" ? "rechecked by recapture" : "rechecked manually";
  return `${captured}; ${how} at ${describeSource(latest.source)}`;
}

// A compact capture reference for the evidence Markdown. Only revisions,
// identifiers, and repository-relative paths appear; never local paths, base
// URLs, or session names.
export function referenceMarkdown(manifest, options = {}) {
  const report = assessManifest(manifest, options);
  const ids = options.captures?.length ? options.captures : Object.keys(manifest.captures);
  const lines = [];
  const limitations = [];
  const captures = [];
  for (const id of ids) {
    const versions = manifest.captures[id]?.versions;
    if (!versions) fail(`no recorded capture "${id}"`);
    const parts = [];
    const fixtures = new Set();
    const recipes = new Set();
    const states = [];
    for (const [version, record] of Object.entries(versions)) {
      parts.push(describeVersion(version, record));
      const basis = currentBasis(record);
      if (basis.fixture) fixtures.add(basis.fixture);
      recipes.add(short(basis.recipe));
      const assessed = report.captures.find((item) => item.capture === id && item.version === version);
      states.push({ version, status: assessed.status, verifiedBy: assessed.verifiedBy,
        revision: basis.source?.head ?? null, dirty: basis.source?.dirty ?? null, fingerprint: basis.source?.fingerprint ?? null });
      for (const reason of assessed.reasons) limitations.push(`${id} ${version} (${assessed.status}): ${reason.text}`);
    }
    const freshness = states.map((state) => `${state.version} ${state.status}${state.verifiedBy ? " (verified)" : ""}`).join(", ");
    lines.push(`<sub>Capture ${code(id)}: ${parts.join("; ")}. Recipe ${[...recipes].map(code).join(", ")}` +
      `${fixtures.size ? `; fixture ${[...fixtures].map(code).join(", ")}` : ""}. Freshness: ${freshness}.</sub>`);
    captures.push({ id, versions: states });
  }
  if (limitations.length) lines.push(`<sub>Limitations: ${limitations.map(escapeMarkdown).join("; ")}.</sub>`);
  return { markdown: `${lines.join("\n\n")}\n`, captures, limitations };
}
