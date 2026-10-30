#!/usr/bin/env node
// Inspect and extend the local evidence manifest that capture.mjs writes.
//
// Usage:
//   node manifest.mjs status --manifest <manifest.json> [--recipe <recipe.json>] [--capture <id>]...
//   node manifest.mjs verify --manifest <manifest.json> --capture <id> [--version after] --basis <text>
//   node manifest.mjs add --manifest <manifest.json> (--result <result.json> | --asset <file>) [--id <id>]
//                         [--from <asset-id>]... [--inputs <spec.json>]
//   node manifest.mjs reference --manifest <manifest.json> [--capture <id>]... [--json]

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { effectiveCapture, recipeHash, RecipeError } from "./recipe.mjs";
import {
  ProvenanceError, assessCapture, assessManifest, assetsByHash, baselineIdentity, loadRecipeFor, readManifest,
  referenceMarkdown, sha256File, sourceIdentity, updateManifest,
} from "./provenance.mjs";

const HELP = `manifest.mjs - report and extend local evidence provenance

  node manifest.mjs status --manifest <path> [--recipe <path>] [--capture <id>]...
  node manifest.mjs verify --manifest <path> --capture <id> [--version after|before] --basis <text>
  node manifest.mjs add --manifest <path> (--result <result.json> | --asset <file>) [--id <id>]
                        [--from <asset-id>]... [--inputs <spec.json>]
  node manifest.mjs reference --manifest <path> [--capture <id>]... [--json]

  status     Freshness of every capture and derived asset: fresh, stale, or review,
             with reasons and the next action
  verify     Record a focused check that clears review for one capture version,
             keeping its original provenance; stale evidence must be recaptured
  add        Record derived files: a compare.mjs result.json, a saved
             prepare-motion.mjs report, or any file with --asset
  reference  Compact capture reference Markdown for the evidence section; it
             contains revisions and IDs, never local paths or base URLs
`;

class UsageError extends Error {}

function fail(message) {
  throw new UsageError(message);
}

function parseArgs(argv) {
  const command = argv[0];
  if (!command || command === "--help" || command === "-h") {
    console.log(HELP);
    process.exit(command ? 0 : 1);
  }
  if (!["status", "verify", "add", "reference"].includes(command)) fail(`unknown command "${command}"\n\n${HELP}`);
  const options = { command, captures: [], from: [], json: false };
  const valued = { "--manifest": "manifest", "--recipe": "recipe", "--version": "version", "--basis": "basis",
    "--result": "result", "--asset": "asset", "--id": "id", "--inputs": "inputs" };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    const value = argv[index + 1];
    if (arg === "--capture" || arg === "--from" || Object.hasOwn(valued, arg)) {
      if (value === undefined || value.startsWith("--")) fail(`${arg} requires a value`);
      index += 1;
      if (arg === "--capture") options.captures.push(value);
      else if (arg === "--from") options.from.push(...value.split(",").filter(Boolean));
      else options[valued[arg]] = value;
    } else fail(`unknown option ${arg}`);
  }
  if (!options.manifest) fail("--manifest is required");
  options.manifest = resolve(options.manifest);
  return options;
}

function printable(report) {
  const { assess, ...rest } = report;
  return rest;
}

function status(options) {
  const manifest = readManifest(options.manifest);
  console.log(JSON.stringify(printable(assessManifest(manifest, { recipePath: options.recipe, captures: options.captures })), null, 2));
}

function verify(options) {
  if (options.captures.length !== 1) fail("verify needs exactly one --capture");
  if (!options.basis?.trim()) fail("verify needs --basis describing what you checked");
  const id = options.captures[0];
  const version = options.version ?? "after";
  const manifest = readManifest(options.manifest);
  const { recipe, limitation } = loadRecipeFor(manifest, options.recipe);
  if (!recipe) fail(`cannot verify without the recipe: ${limitation}`);
  const capture = recipe.captures.get(id);
  if (!capture) fail(`the recipe has no capture "${id}"`);
  const before = assessCapture(manifest, recipe, id, version);
  if (!before) fail(`no recorded ${version} capture for "${id}"`);
  const stale = before.reasons.filter((reason) => reason.level === "stale");
  if (stale.length) {
    fail(`cannot verify confirmed stale evidence (${stale.map((reason) => reason.text).join("; ")}); ${before.next}`);
  }
  const record = manifest.captures[id].versions[version];
  const current = record.verifications?.at(-1) ?? record;
  const effective = effectiveCapture(capture, version);
  const verification = {
    at: new Date().toISOString(), method: "manual", basis: options.basis.trim(),
    reviewed: before.reasons.map((reason) => reason.text), recipe: recipeHash(effective), fixture: effective.fixture,
    served: current.served, source: currentSource(current.source),
  };
  updateManifest(options.manifest, (stored) => {
    const target = stored.captures[id].versions[version];
    target.verifications ??= [];
    target.verifications.push(verification);
  }, { create: false });
  const after = assessCapture(readManifest(options.manifest), recipe, id, version);
  console.log(JSON.stringify({ capture: id, version, recorded: verification, status: after }, null, 2));
}

// A verification vouches for the source as it is now. Later freshness checks
// compare against this identity while the original capture record stays intact.
function currentSource(source) {
  if (!source) return null;
  if (source.kind === "baseline") {
    const now = baselineIdentity(source.base);
    if (!now.available) fail(`cannot identify the current baseline: ${now.reason}`);
    return { ...source, head: now.head, changes: {}, dirty: false };
  }
  const now = sourceIdentity(source.root);
  if (!now.available) fail(`cannot identify the current source: ${now.reason}`);
  return now;
}

function slug(value) {
  return value.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "") || "asset";
}

// Outputs listed by a compare.mjs result.json or a prepare-motion.mjs report,
// and the source files they were prepared from.
function resultOutputs(path, prefix) {
  let result;
  try {
    result = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`could not read --result ${path}: ${error.message}`);
  }
  if (result?.outputs?.comparison) {
    const outputs = [["comparison", result.outputs.comparison],
      ...(result.details ?? []).map((detail) => [`detail-${detail.id}`, detail.path]),
      ["flip", result.outputs.flip], ["onion", result.outputs.onion]].filter(([, file]) => file);
    return {
      kind: "comparison",
      outputs: outputs.map(([name, file]) => ({ id: `${prefix}.${name}`, file })),
      sources: [result.inputs?.before?.image, result.inputs?.after?.image].filter(Boolean),
      limitations: result.limitations ?? [],
    };
  }
  if (typeof result?.out === "string" && result?.prepared && typeof result.input === "string") {
    return { kind: "motion", outputs: [{ id: prefix, file: result.out }], sources: [result.input], limitations: result.warnings ?? [] };
  }
  fail("--result must be a compare.mjs result.json or a saved prepare-motion.mjs JSON report");
}

function add(options) {
  if (Boolean(options.result) === Boolean(options.asset)) fail("add needs exactly one of --result or --asset");
  const manifest = readManifest(options.manifest);
  const byHash = assetsByHash(manifest);
  const file = resolve(options.result ?? options.asset);
  const prefix = slug(options.id ?? basename(options.result ? resolve(file, "..") : file, extname(file)));
  const plan = options.result ? resultOutputs(file, prefix)
    : { kind: "asset", outputs: [{ id: prefix, file }], sources: [], limitations: [] };
  const from = new Map();
  const unmatched = [];
  for (const source of plan.sources) {
    if (!existsSync(source)) {
      unmatched.push(source);
      continue;
    }
    const ids = byHash.get(sha256File(source)) ?? [];
    if (!ids.length) unmatched.push(source);
    for (const id of ids) from.set(id, manifest.assets[id].sha256);
  }
  for (const id of options.from) {
    if (!manifest.assets[id]) fail(`--from ${id} is not a recorded asset`);
    from.set(id, manifest.assets[id].sha256);
  }
  const inputs = options.inputs ? { path: resolve(options.inputs), sha256: sha256File(resolve(options.inputs)) } : null;
  const createdAt = new Date().toISOString();
  const records = plan.outputs.map(({ id, file: output }) => {
    if (!existsSync(output)) fail(`output ${output} does not exist`);
    if (manifest.assets[id]?.capture) fail(`asset ID ${id} belongs to a capture; pass a different --id`);
    return [id, {
      path: resolve(output), sha256: sha256File(output), bytes: statSync(output).size,
      media: /\.(mp4|mov|webm)$/i.test(output) ? "video" : "image",
      derivedFrom: [...from].map(([source, sha]) => ({ id: source, sha256: sha })),
      ...(inputs ? { inputs } : {}), kind: plan.kind, createdAt,
    }];
  });
  updateManifest(options.manifest, (stored) => {
    for (const [id, record] of records) stored.assets[id] = record;
  }, { create: false });
  const report = assessManifest(readManifest(options.manifest));
  console.log(JSON.stringify({
    recorded: records.map(([id, record]) => ({ id, path: record.path, sha256: record.sha256, derivedFrom: record.derivedFrom })),
    unmatchedSources: unmatched,
    freshness: records.map(([id]) => report.assess(id)),
    limitations: plan.limitations,
  }, null, 2));
}

function reference(options) {
  const result = referenceMarkdown(readManifest(options.manifest), { recipePath: options.recipe, captures: options.captures });
  if (options.json) console.log(JSON.stringify(result, null, 2));
  else process.stdout.write(result.markdown);
}

try {
  const options = parseArgs(process.argv.slice(2));
  ({ status, verify, add, reference })[options.command](options);
} catch (error) {
  if (error instanceof UsageError || error instanceof ProvenanceError || error instanceof RecipeError) {
    console.error(`manifest: ${error.message}`);
  } else {
    console.error(`manifest: ${error.stack ?? error.message}`);
  }
  process.exitCode = 1;
}
