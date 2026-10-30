// Load and validate capture recipes for capture.mjs and manifest.mjs.
//
// A recipe names each capture's relative route, geometry, theme, sanitized
// fixture identifier, readiness assertion, and the agent-browser batch arrays
// that reach the intended state. Base URLs and browser sessions stay runtime
// inputs. See references/recipes.md for the format.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export const VERSIONS = ["before", "after"];
const TOP_KEYS = new Set(["version", "id", "sources", "captures"]);
const CAPTURE_KEYS = new Set(["id", "claims", "kind", "route", "viewport", "theme", "scroll", "fixture", "inputs",
  "steps", "ready", "screenshot", "record", "actions", "expect", "versions"]);
const OVERRIDE_KEYS = new Set(["route", "steps", "ready", "scroll", "screenshot", "actions", "expect"]);
const SHARED_ACROSS_VERSIONS = new Set(["kind", "viewport", "theme", "fixture", "record"]);
// The runner owns geometry, output, recording, and the session lifecycle.
const RESERVED_COMMANDS = new Set(["close", "quit", "exit", "record", "connect", "screenshot", "session", "batch"]);
const RESERVED_SETTINGS = new Set(["viewport", "device", "media"]);
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FIXTURE = /^[A-Za-z0-9][A-Za-z0-9._:@/+-]{0,127}$/;

export class RecipeError extends Error {}

function fail(message) {
  throw new RecipeError(message);
}

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  return value;
}

function onlyKeys(value, allowed, name) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${name} has unknown field "${key}"`);
  }
}

function text(value, name, { optional = false } = {}) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || !value.trim()) fail(`${name} must be a non-empty string`);
  return value;
}

function integer(value, name, min, max) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${name} must be an integer from ${min} to ${max}`);
  return value;
}

function strings(value, name) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    fail(`${name} must be an array of non-empty strings`);
  }
  return value;
}

function globs(value, name) {
  const patterns = strings(value, name);
  for (const pattern of patterns) {
    if (pattern.startsWith("/") || pattern.includes("\\") || /^[A-Za-z]:/.test(pattern) ||
        pattern.split("/").includes("..")) {
      fail(`${name} entry "${pattern}" must be a repository-relative path or glob using "/"`);
    }
  }
  return patterns;
}

function route(value, name) {
  const result = text(value, name);
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(result) || result.startsWith("//") || /\s/.test(result)) {
    fail(`${name} must be a relative URL such as "/settings" or "pricing.html"; pass the origin with --base-url`);
  }
  return result;
}

function commands(value, name) {
  if (!Array.isArray(value)) fail(`${name} must be an array of agent-browser batch commands`);
  return value.map((command, index) => {
    const label = `${name}[${index}]`;
    if (!Array.isArray(command) || !command.length || command.some((part) => typeof part !== "string")) {
      fail(`${label} must be a non-empty array of strings, such as ["click", "#save"]`);
    }
    if (!command[0].trim()) fail(`${label} needs a command name`);
    if (RESERVED_COMMANDS.has(command[0])) {
      fail(`${label} uses "${command[0]}", which capture.mjs runs itself; remove it from the recipe`);
    }
    if (command[0] === "set" && RESERVED_SETTINGS.has(command[1])) {
      fail(`${label} sets ${command[1]}; use the capture's viewport and theme fields instead`);
    }
    return command;
  });
}

function scroll(value, name) {
  if (value === undefined) return undefined;
  object(value, name);
  onlyKeys(value, new Set(["x", "y"]), name);
  return { x: integer(value.x ?? 0, `${name}.x`, 0, 1_000_000), y: integer(value.y ?? 0, `${name}.y`, 0, 1_000_000) };
}

function screenshot(value, name) {
  if (value === undefined) return { full: false };
  object(value, name);
  onlyKeys(value, new Set(["full", "selector"]), name);
  if (value.full !== undefined && typeof value.full !== "boolean") fail(`${name}.full must be true or false`);
  const selector = text(value.selector, `${name}.selector`, { optional: true });
  if (selector && value.full) fail(`${name} cannot combine "selector" with "full"`);
  return { full: Boolean(value.full), ...(selector ? { selector } : {}) };
}

function recordSettings(value, name) {
  const settings = value === undefined ? {} : object(value, name);
  onlyKeys(settings, new Set(["fps", "cursor", "format"]), name);
  if (settings.cursor !== undefined && typeof settings.cursor !== "boolean") fail(`${name}.cursor must be true or false`);
  const format = settings.format ?? "mp4";
  if (!["mp4", "webm"].includes(format)) fail(`${name}.format must be "mp4" or "webm"`);
  return { fps: integer(settings.fps ?? 30, `${name}.fps`, 1, 60), cursor: Boolean(settings.cursor), format };
}

function captureFields(raw, name, kind) {
  const fields = {};
  if (raw.route !== undefined) fields.route = route(raw.route, `${name}.route`);
  if (raw.steps !== undefined) fields.steps = commands(raw.steps, `${name}.steps`);
  if (raw.ready !== undefined) fields.ready = text(raw.ready, `${name}.ready`);
  if (raw.scroll !== undefined) fields.scroll = scroll(raw.scroll, `${name}.scroll`);
  if (raw.screenshot !== undefined) {
    if (kind !== "screenshot") fail(`${name}.screenshot applies only to screenshot captures`);
    fields.screenshot = screenshot(raw.screenshot, `${name}.screenshot`);
  }
  for (const key of ["actions", "expect"]) {
    if (raw[key] !== undefined && kind !== "recording") fail(`${name}.${key} applies only to recording captures`);
  }
  if (raw.actions !== undefined) {
    fields.actions = commands(raw.actions, `${name}.actions`);
    if (!fields.actions.length) fail(`${name}.actions must contain the recorded interaction`);
  }
  if (raw.expect !== undefined) fields.expect = text(raw.expect, `${name}.expect`);
  return fields;
}

function parseCapture(raw, index) {
  const name = `captures[${index}]`;
  object(raw, name);
  onlyKeys(raw, CAPTURE_KEYS, name);
  if (typeof raw.id !== "string" || !ID.test(raw.id)) {
    fail(`${name}.id must be 1-64 letters, digits, "_" or "-", starting with a letter or digit`);
  }
  const label = `capture "${raw.id}"`;
  const kind = raw.kind ?? "screenshot";
  if (!["screenshot", "recording"].includes(kind)) fail(`${label} kind must be "screenshot" or "recording"`);
  const viewport = object(raw.viewport, `${label} viewport`);
  onlyKeys(viewport, new Set(["width", "height", "devicePixelRatio"]), `${label} viewport`);
  const ratio = viewport.devicePixelRatio ?? 1;
  if (typeof ratio !== "number" || !Number.isFinite(ratio) || ratio < 0.5 || ratio > 4) {
    fail(`${label} viewport.devicePixelRatio must be a number from 0.5 to 4`);
  }
  if (raw.theme !== undefined && !["light", "dark"].includes(raw.theme)) fail(`${label} theme must be "light" or "dark"`);
  if (raw.fixture !== undefined && (typeof raw.fixture !== "string" || !FIXTURE.test(raw.fixture))) {
    fail(`${label} fixture must be a sanitized identifier such as "seed:pricing-v2", not data or a credential`);
  }
  const capture = {
    id: raw.id,
    claims: strings(raw.claims, `${label} claims`),
    kind,
    viewport: {
      width: integer(viewport.width, `${label} viewport.width`, 1, 16384),
      height: integer(viewport.height, `${label} viewport.height`, 1, 16384),
      devicePixelRatio: ratio,
    },
    ...(raw.theme ? { theme: raw.theme } : {}),
    ...(raw.fixture ? { fixture: raw.fixture } : {}),
    inputs: globs(raw.inputs, `${label} inputs`),
    steps: [],
    ...captureFields(raw, label, kind),
    ...(kind === "recording" ? { record: recordSettings(raw.record, `${label} record`) } : {}),
    versions: {},
  };
  if (kind === "screenshot" && raw.record !== undefined) fail(`${label} record applies only to recording captures`);
  if (kind === "screenshot" && !capture.screenshot) capture.screenshot = { full: false };
  if (raw.versions !== undefined) {
    object(raw.versions, `${label} versions`);
    for (const [version, override] of Object.entries(raw.versions)) {
      if (!VERSIONS.includes(version)) fail(`${label} versions.${version} must be "before" or "after"`);
      const overrideName = `${label} versions.${version}`;
      object(override, overrideName);
      for (const key of Object.keys(override)) {
        if (SHARED_ACROSS_VERSIONS.has(key)) {
          fail(`${overrideName}.${key} cannot differ between versions; a truthful comparison keeps it matched`);
        }
      }
      onlyKeys(override, OVERRIDE_KEYS, overrideName);
      capture.versions[version] = captureFields(override, overrideName, kind);
    }
  }
  for (const version of VERSIONS) {
    const effective = { ...capture, ...capture.versions[version] };
    if (!effective.route) fail(`${label} needs a route${capture.versions[version] ? "" : ` for ${version}`}`);
    if (!effective.ready) fail(`${label} needs a ready assertion that proves the intended state`);
    if (kind === "recording" && (!effective.actions || !effective.expect)) {
      fail(`${label} is a recording and needs "actions" and an "expect" assertion of the result`);
    }
  }
  return capture;
}

export function parseRecipe(raw, label = "recipe") {
  object(raw, label);
  onlyKeys(raw, TOP_KEYS, label);
  if (raw.version !== 1) fail(`${label} version must be 1`);
  if (raw.id !== undefined && (typeof raw.id !== "string" || !ID.test(raw.id))) fail(`${label} id must be a short identifier`);
  const sources = raw.sources === undefined ? {} : object(raw.sources, `${label} sources`);
  onlyKeys(sources, new Set(["shared", "ignore"]), `${label} sources`);
  if (!Array.isArray(raw.captures) || !raw.captures.length) fail(`${label} needs at least one capture`);
  const captures = new Map();
  raw.captures.forEach((item, index) => {
    const capture = parseCapture(item, index);
    if (captures.has(capture.id)) fail(`${label} defines capture "${capture.id}" twice`);
    captures.set(capture.id, capture);
  });
  return {
    id: raw.id ?? null,
    sources: { shared: globs(sources.shared, `${label} sources.shared`), ignore: globs(sources.ignore, `${label} sources.ignore`) },
    captures,
  };
}

export function loadRecipe(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    fail(`could not read recipe ${path}: ${error.message}`);
  }
  return parseRecipe(raw, "recipe");
}

// The fields that decide what the browser renders for one version. Claims and
// dependency declarations do not change pixels, so they stay out of identity.
export function effectiveCapture(capture, version) {
  if (!VERSIONS.includes(version)) fail(`version must be "before" or "after"`);
  const merged = { ...capture, ...capture.versions[version] };
  return {
    kind: merged.kind,
    route: merged.route,
    viewport: merged.viewport,
    theme: merged.theme ?? null,
    scroll: merged.scroll ?? null,
    fixture: merged.fixture ?? null,
    steps: merged.steps ?? [],
    ready: merged.ready,
    ...(merged.kind === "screenshot" ? { screenshot: merged.screenshot } : {
      record: merged.record, actions: merged.actions, expect: merged.expect,
    }),
  };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// Identity of the setup that produced a capture. The fixture is compared on its
// own so a report can say which input changed.
export function recipeHash(effective) {
  const { fixture, ...setup } = effective;
  return createHash("sha256").update(canonical(setup)).digest("hex");
}

// Shell-style globs over repository-relative paths: "*" and "?" stay within one
// path segment, "**" crosses segments, and a pattern without wildcards matches
// that file or anything below that directory.
export function globMatcher(patterns) {
  const expressions = patterns.map((pattern) => {
    const trimmed = pattern.replace(/\/+$/, "");
    let source = "";
    for (let index = 0; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (char === "*" && trimmed[index + 1] === "*") {
        if (trimmed[index + 2] === "/") {
          source += "(?:.*/)?";
          index += 2;
        } else {
          source += ".*";
          index += 1;
        }
      } else if (char === "*") source += "[^/]*";
      else if (char === "?") source += "[^/]";
      else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
    return new RegExp(`^${source}(?:/.*)?$`);
  });
  return (path) => expressions.some((expression) => expression.test(path));
}
