#!/usr/bin/env node
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { argValue, die, gitRoot, output, readJSON } from "./lib.mjs";

export const defaults = {
  version: 1,
  agents: {
    implementation: { model: "gpt-5.6-luna", reasoning: "max", quality: "floor", availability: "prefer" },
    review: { model: "gpt-5.6-luna", reasoning: "max", quality: "floor", availability: "prefer" },
    research: { model: "gpt-5.6-luna", reasoning: "max", quality: "floor", availability: "prefer" },
  },
  concurrency: { maxActiveSubagents: 3, implementation: 3, review: 1, research: 1 },
  review: { observationSeconds: 120, botResponsesRequired: false, bots: [] },
  scheduling: { policy: "adaptive-frontier", requireIsolationPreflight: true },
};

const args = process.argv.slice(2);
const root = gitRoot() || process.cwd();
const configPath = resolve(argValue(args, "--config") || `${root}/.agents/implement-program.json`);
const overridePath = argValue(args, "--overrides");
let resolved = structuredClone(defaults);
const sources = [{ kind: "defaults", path: null }];

if (existsSync(configPath)) {
  resolved = mergeKnown(resolved, readJSON(configPath));
  sources.push({ kind: "repository", path: configPath });
}
if (overridePath) {
  const path = resolve(overridePath);
  resolved = mergeKnown(resolved, readJSON(path));
  sources.push({ kind: "run", path });
}
validate(resolved);
output({ config: resolved, sources }, args.includes("--json"));

function mergeKnown(base, incoming, trail = "") {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    die(`configuration at ${trail || "root"} must be an object`);
  }
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(incoming)) {
    if (!(key in base)) die(`unknown configuration key: ${trail}${key}`);
    if (isObject(base[key])) result[key] = mergeKnown(base[key], value, `${trail}${key}.`);
    else result[key] = value;
  }
  return result;
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function validate(config) {
  if (config.version !== 1) die("configuration version must be 1");
  for (const [role, profile] of Object.entries(config.agents)) {
    if (typeof profile.model !== "string" || !profile.model) die(`${role}.model must be a string`);
    if (typeof profile.reasoning !== "string" || !profile.reasoning) die(`${role}.reasoning must be a string`);
    if (!["floor", "escalation"].includes(profile.quality)) die(`${role}.quality must be floor or escalation`);
    if (!["prefer", "require"].includes(profile.availability)) die(`${role}.availability must be prefer or require`);
    if (profile.quality === "floor" && (profile.model !== "gpt-5.6-luna" || profile.reasoning !== "max")) {
      die(`${role} floor profile must use the default Luna model at max reasoning; mark a portable replacement as an escalation`);
    }
  }
  for (const [key, value] of Object.entries(config.concurrency)) {
    if (!Number.isInteger(value) || value < 1) die(`concurrency.${key} must be a positive integer`);
  }
  if (!Number.isInteger(config.review.observationSeconds) || config.review.observationSeconds < 0) {
    die("review.observationSeconds must be a non-negative integer");
  }
  if (!Array.isArray(config.review.bots) || config.review.bots.some((bot) => typeof bot !== "string")) {
    die("review.bots must be an array of strings");
  }
}
