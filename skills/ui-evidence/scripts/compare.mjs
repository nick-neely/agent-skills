#!/usr/bin/env node
// Compose before/after screenshots into one labelled comparison image, plus
// optional enlarged detail comparisons, a screenshot flip GIF, an onion skin,
// a publisher-compatible Markdown section, and a structured result.
//
// Usage:
//   node compare.mjs --spec compare.json --out-dir <evidence-dir>
//
// See references/comparisons.md for the spec. Layout rules live in
// comparison-layout.mjs; this file resolves the spec and renders with
// ImageMagick and the bundled font.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DISPLAY_WIDTH, PALETTE, anchorToImageRect, asArray, chooseLayout, chromeFor, contains,
  detailWindows, intersect, pixelSurface, planComparison, rectFrom, sectionMarkdown, snapOut,
} from "./comparison-layout.mjs";
import { CHROME, geometry, imText, numberedPinArgs, textMeasurer } from "./magick-args.mjs";

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FONT_PATH = join(SKILL_ROOT, "assets", "DejaVuSans.ttf");

const HELP = `compare.mjs - compose a readable before/after comparison

  node compare.mjs --spec <compare.json> --out-dir <directory>

  --spec <path>      Comparison spec (JSON); see references/comparisons.md
  --out-dir <path>   Directory for comparison.png, detail-*.png, flip.gif,
                     onion.png, section.md, and result.json
  --keep-temp        Leave intermediate crops on disk for debugging

Prints the structured result as JSON. Run scripts/preflight.mjs --compare to
verify dependencies first.
`;

const HEADER_BACKGROUND = CHROME.header;
const LEGEND_BACKGROUND = CHROME.panel;
const PANEL_BORDER = CHROME.border;
const TEXT = CHROME.text;
const REDACTION_BLOCK = "#111827";

function die(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = { keepTemp: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "--spec" || arg === "--out-dir") {
      const value = argv[++i];
      if (!value || value.startsWith("--")) die(`${arg} requires a value`);
      options[arg === "--spec" ? "spec" : "outDir"] = value;
    } else if (arg === "--keep-temp") options.keepTemp = true;
    else die(`unknown option ${arg}`);
  }
  if (!options.spec) die(`--spec is required\n\n${HELP}`);
  if (!options.outDir) die(`--out-dir is required\n\n${HELP}`);
  return options;
}

let magickBinary;

function resolveMagick() {
  const candidates = process.platform === "win32" ? ["magick"] : ["magick", "convert"];
  for (const binary of candidates) {
    try {
      execFileSync(binary, ["-version"], { stdio: "ignore" });
      return binary;
    } catch {
      // try the next candidate
    }
  }
  die("ImageMagick not found. Install ImageMagick and retry; scripts/preflight.mjs --compare reports the fix.");
}

function magick(args) {
  try {
    return execFileSync(magickBinary, args, {
      encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    die(`ImageMagick failed: ${String(error.stderr || error.message).trim()}`);
  }
}

// Raw 8-bit RGB pixels of a rendered panel, so marks can avoid covering its UI.
function surfaceOf(path) {
  const { width, height } = imageSize(path);
  try {
    const data = execFileSync(magickBinary, [`${path}[0]`, "-alpha", "off", "-depth", "8", "rgb:-"], {
      maxBuffer: width * height * 3 + 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
    return pixelSurface({ width, height, data });
  } catch (error) {
    die(`ImageMagick failed: ${String(error.stderr || error.message).trim()}`);
  }
}

function imageSize(path) {
  const [width, height] = magick([`${path}[0]`, "-format", "%w %h", "info:"]).trim().split(/\s+/).map(Number);
  return { width, height };
}

const makeMeasure = () => textMeasurer(magick, FONT_PATH);
const sameSize = (a, b) => a.width === b.width && a.height === b.height;
const formatPx = (value) => `${Math.round(value * 10) / 10} px`;

function readJson(path, what) {
  if (!existsSync(path)) die(`no such ${what}: ${path}`);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    die(`${what} is not valid JSON: ${path}: ${error.message}`);
  }
}

function loadPanel(spec, key, specDir) {
  const entry = spec[key];
  if (!entry || typeof entry !== "object" || typeof entry.image !== "string") {
    die(`spec needs "${key}": { "image": "<path>" }`);
  }
  const at = (path) => (isAbsolute(path) ? path : resolve(specDir, path));
  const image = at(entry.image);
  if (!existsSync(image)) die(`no such ${key} image: ${image}`);
  const size = imageSize(image);
  const label = entry.label ?? (key === "before" ? "Before" : "After");
  if (typeof label !== "string" || !label.trim()) die(`${key} label must be non-empty text`);

  let anchors = null;
  if (entry.anchors !== undefined) {
    anchors = readJson(at(entry.anchors), `${key} anchors file`);
    const shot = anchors?.capture?.screenshot;
    if (!anchors?.capture || !anchors.anchors || !shot) die(`${key} anchors file lacks capture metadata; regenerate it with anchors.mjs`);
    if (!sameSize(shot, size)) {
      die(`${key} anchors were recorded for a ${shot.width}x${shot.height} screenshot, but ${image} is ` +
        `${size.width}x${size.height}. Capture the screenshot and anchors together with anchors.mjs --screenshot.`);
    }
  }
  const recorded = anchors?.capture?.devicePixelRatio;
  if (entry.devicePixelRatio !== undefined && !(Number(entry.devicePixelRatio) > 0)) {
    die(`${key} devicePixelRatio must be a positive number`);
  }
  if (entry.devicePixelRatio !== undefined && recorded !== undefined && Number(entry.devicePixelRatio) !== recorded) {
    die(`${key} devicePixelRatio ${entry.devicePixelRatio} contradicts its anchors file (${recorded})`);
  }
  const dpr = Number(entry.devicePixelRatio ?? recorded ?? 1);
  return { key, label: label.trim(), image, size, anchors, dpr, bounds: { x: 0, y: 0, ...size } };
}

// A region is a literal [x, y, width, height] in source screenshot pixels or a
// saved anchor, transformed with that screenshot's capture metadata.
function resolveRegion(value, panel, what) {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) {
    const rect = snapOut(rectFrom(value, what));
    if (!contains(panel.bounds, rect)) {
      die(`${what} ${JSON.stringify(value)} extends outside the ${panel.size.width}x${panel.size.height} ${panel.key} image`);
    }
    return rect;
  }
  if (value && typeof value === "object" && typeof value.anchor === "string") {
    if (!panel.anchors) die(`${what} uses anchor "${value.anchor}", but ${panel.key} has no "anchors" file`);
    const anchor = panel.anchors.anchors[value.anchor];
    if (!anchor) {
      die(`${what} names anchor "${value.anchor}", which the ${panel.key} anchors file lacks. ` +
        `Available: ${Object.keys(panel.anchors.anchors).join(", ") || "none"}`);
    }
    const rect = intersect(anchorToImageRect(anchor.rect, panel.anchors.capture), panel.bounds);
    if (!rect) die(`${what} anchor "${value.anchor}" lies outside the ${panel.key} screenshot`);
    return rect;
  }
  die(`${what} must be [x, y, width, height] or { "anchor": "<name>" }`);
}

function regionPair(raw, panels, what) {
  const pick = (key) => (raw[key] !== undefined ? raw[key] : raw.region);
  return {
    before: resolveRegion(pick("before"), panels.before, `${what} before region`),
    after: resolveRegion(pick("after"), panels.after, `${what} after region`),
  };
}

// Redaction destroys pixels in the source copy, before any crop, zoom, flip,
// or overlay is derived from it.
function redact(panel, rects, temp) {
  if (!rects.length) return panel.image;
  const out = join(temp, `${panel.key}-redacted.png`);
  const args = [panel.image];
  for (const { rect, style } of rects) {
    const { x, y, width, height } = rect;
    if (style === "block") {
      args.push("-fill", REDACTION_BLOCK, "-stroke", "none", "-draw", `rectangle ${x},${y} ${x + width - 1},${y + height - 1}`);
    } else {
      args.push("(", "-clone", "0", "-crop", `${width}x${height}+${x}+${y}`, "+repage",
        "-resize", "6%", "-resize", `${width}x${height}!`, ")",
        "-gravity", "NorthWest", "-compose", "Over", "-geometry", geometry(x, y), "-composite");
    }
  }
  magick([...args, out]);
  return out;
}

// A shared detail window can extend past a smaller padded screenshot; fill the
// missing area so both panels keep the same source coordinates.
function extract(panel, window, zoom, out) {
  const visible = intersect(window, panel.bounds);
  const args = visible
    ? [panel.source, "-crop", `${visible.width}x${visible.height}+${visible.x}+${visible.y}`, "+repage",
      "-background", "#ffffff", "-gravity", "NorthWest", "-extent", `${window.width}x${window.height}`]
    : ["-size", `${window.width}x${window.height}`, "xc:#ffffff"];
  if (zoom !== 1) {
    args.push(Number.isInteger(zoom) ? "-sample" : "-resize",
      `${Math.round(window.width * zoom)}x${Math.round(window.height * zoom)}!`);
  }
  magick([...args, out]);
  return out;
}

const pinArgs = (id, color, chrome) => numberedPinArgs(id, color, chrome, FONT_PATH);

const labelArgs = (text, pointsize, background, color) =>
  ["-background", background, "-fill", color, "-stroke", "none", "+size", "-font", FONT_PATH,
    "-pointsize", String(pointsize), `label:${imText(text)}`];

const pillArgs = (text, color, chrome) =>
  [...labelArgs(text, chrome.labelFont, color, "#ffffff"), "-bordercolor", color, "-border", `${chrome.labelPad}x${chrome.labelPad}`];

function drawPlan(plan, images, out) {
  const { chrome } = plan;
  const args = ["-size", `${plan.canvas.width}x${plan.canvas.height}`, "xc:#ffffff"];
  const place = (sub, x, y) =>
    args.push("(", ...sub, ")", "-gravity", "NorthWest", "-compose", "Over", "-geometry", geometry(x, y), "-composite");
  const rectangle = (r) => `rectangle ${r.x},${r.y} ${r.x + r.width - 1},${r.y + r.height - 1}`;

  for (const panel of plan.panels) place([images[panel.key]], panel.x, panel.y);
  for (const spot of plan.spotlights) {
    const size = `${spot.rect.width}x${spot.rect.height}`;
    const holes = spot.holes.flatMap((hole) =>
      ["-draw", rectangle({ ...hole, x: hole.x - spot.rect.x, y: hole.y - spot.rect.y })]);
    place(["-size", size, "xc:#000000", "(", "-size", size, "xc:gray50", "-fill", "black", "-stroke", "none",
      ...holes, ")", "-alpha", "off", "-compose", "CopyOpacity", "-composite"], spot.rect.x, spot.rect.y);
  }
  for (const panel of plan.panels) {
    args.push("-fill", "none", "-stroke", PANEL_BORDER, "-strokewidth", "1",
      "-draw", rectangle({ x: panel.x - 1, y: panel.y - 1, width: panel.width + 2, height: panel.height + 2 }));
    args.push("-fill", HEADER_BACKGROUND, "-stroke", "none", "-draw", rectangle(panel.header));
    place(labelArgs(panel.header.text.value, panel.header.text.pointsize, HEADER_BACKGROUND, "#ffffff"),
      panel.header.text.x, panel.header.text.y);
  }
  const corner = Math.max(3, chrome.radius / 3);
  for (const mark of plan.marks) {
    const o = mark.outline;
    args.push("-fill", "none", "-stroke", mark.color, "-strokewidth", String(chrome.stroke),
      "-draw", `roundrectangle ${o.x},${o.y} ${o.x + o.width - 1},${o.y + o.height - 1} ${corner},${corner}`);
  }
  const thin = String(Math.max(2, Math.round(chrome.stroke * 0.7)));
  for (const mark of plan.marks) {
    const connector = mark.pin.connector;
    if (connector) {
      args.push("-fill", "none", "-stroke", mark.color, "-strokewidth", thin,
        "-draw", `line ${connector.x1},${connector.y1} ${connector.x2},${connector.y2}`);
    }
    const bracket = mark.bracket;
    if (bracket) {
      const { line } = bracket;
      const horizontal = line.y1 === line.y2;
      args.push("-fill", "none", "-stroke", mark.color, "-strokewidth", thin,
        "-draw", `line ${line.x1},${line.y1} ${line.x2},${line.y2}`,
        "-draw", horizontal ? `line ${line.x1},${line.y1} ${line.x1},${line.tickTo}` : `line ${line.x1},${line.y1} ${line.tickTo},${line.y1}`,
        "-draw", horizontal ? `line ${line.x2},${line.y2} ${line.x2},${line.tickTo}` : `line ${line.x2},${line.y2} ${line.tickTo},${line.y2}`);
      place(pillArgs(bracket.label.text, mark.color, chrome), bracket.label.x, bracket.label.y);
    }
  }
  for (const mark of plan.marks) {
    place(pinArgs(mark.id, mark.color, chrome), mark.pin.cx - mark.pin.radius, mark.pin.cy - mark.pin.radius);
    if (mark.label) {
      place(pillArgs(mark.label.text, mark.color, chrome), mark.label.x, mark.label.y);
    }
  }
  if (plan.legend) {
    const legend = plan.legend;
    args.push("-fill", LEGEND_BACKGROUND, "-stroke", "none",
      "-draw", rectangle({ x: 0, y: legend.y, width: plan.canvas.width, height: plan.canvas.height - legend.y }),
      "-fill", "none", "-stroke", PANEL_BORDER, "-strokewidth", "1", "-draw", `line 0,${legend.y} ${plan.canvas.width},${legend.y}`);
    for (const item of legend.items) {
      place(pinArgs(item.id, item.color, chrome), item.pin.cx - item.pin.radius, item.pin.cy - item.pin.radius);
      place(["-background", LEGEND_BACKGROUND, "-fill", TEXT, "-stroke", "none", "-font", FONT_PATH,
        "-pointsize", String(item.text.pointsize), "-size", `${item.text.width}x`, `caption:${imText(item.text.value)}`],
      item.text.x, item.text.y);
    }
  }
  magick([...args, "-strip", out]);
}

// A labelled banner above a screenshot, for flip frames and the onion skin.
function bannered(image, text, bannerHeight, frameWidth, chrome, out) {
  const size = imageSize(image);
  magick(["-size", `${frameWidth}x${bannerHeight}`, `xc:${HEADER_BACKGROUND}`,
    "(", ...labelArgs(text, chrome.headerFont, HEADER_BACKGROUND, "#ffffff"), ")",
    "-gravity", "NorthWest", "-compose", "Over", "-geometry", geometry(chrome.headerPad, chrome.headerPad), "-composite",
    "(", "-size", `${frameWidth}x${size.height}`, "xc:#ffffff", image, "-gravity", "NorthWest", "-composite", ")",
    "-append", "-strip", out]);
  return out;
}

function validateCallouts(spec, panels) {
  if (spec.callouts !== undefined && !Array.isArray(spec.callouts)) die('"callouts" must be an array');
  const seen = new Set();
  const callouts = (spec.callouts ?? []).map((raw, index) => {
    if (!raw || typeof raw !== "object") die(`callout ${index + 1} must be an object`);
    const id = raw.id ?? index + 1;
    if (!Number.isInteger(id) || id < 1) die(`callout id must be a positive integer, got ${JSON.stringify(id)}`);
    if (seen.has(id)) die(`callout id ${id} is used twice; reuse one ID for both panels instead`);
    seen.add(id);
    if (typeof raw.text !== "string" || !raw.text.trim()) die(`callout ${id} needs "text" explaining the change`);
    if (raw.label !== undefined && (typeof raw.label !== "string" || !raw.label.trim())) die(`callout ${id} label must be short text`);
    if (raw.measure !== undefined && !["width", "height"].includes(raw.measure)) {
      die(`callout ${id} measure must be "width" or "height"`);
    }
    const regions = regionPair(raw, panels, `callout ${id}`);
    if (!regions.before && !regions.after) die(`callout ${id} needs a region in at least one panel`);
    return {
      id, text: raw.text.trim(), label: raw.label?.trim(), measure: raw.measure,
      spotlight: raw.spotlight === true, regions,
    };
  }).sort((a, b) => a.id - b.id);
  callouts.forEach((callout, index) => {
    callout.color = PALETTE[index % PALETTE.length];
    const parts = [];
    if (callout.measure) {
      for (const panel of [panels.before, panels.after]) {
        const rect = callout.regions[panel.key];
        if (rect) parts.push(`${panel.label} ${formatPx(rect[callout.measure] / panel.dpr)}`);
      }
    }
    callout.legend = parts.length ? `${callout.text} Measured ${callout.measure}: ${parts.join(", ")}.` : callout.text;
  });
  return callouts;
}

// Map source-pixel callouts into one view's panel-local output pixels. A
// measurement bracket appears only when the whole measured span is visible.
function viewCallouts(callouts, views) {
  return callouts.map((callout) => {
    const marks = {};
    for (const view of views) {
      const rect = callout.regions[view.panel.key];
      const visible = rect && intersect(rect, view.window);
      if (!visible) continue;
      marks[view.panel.key] = {
        rect: {
          x: Math.round((visible.x - view.window.x) * view.zoom),
          y: Math.round((visible.y - view.window.y) * view.zoom),
          width: Math.max(1, Math.round(visible.width * view.zoom)),
          height: Math.max(1, Math.round(visible.height * view.zoom)),
        },
        measureText: callout.measure && contains(view.window, rect)
          ? formatPx(rect[callout.measure] / view.panel.dpr) : undefined,
      };
    }
    return { ...callout, marks };
  }).filter((callout) => Object.keys(callout.marks).length);
}

function renderView({ name, views, layout, displayWidth, callouts, measure, temp, out }) {
  const images = {};
  for (const view of views) {
    images[view.panel.key] = extract(view.panel, view.window, view.zoom, join(temp, `${name}-${view.panel.key}.png`));
  }
  const visible = viewCallouts(callouts, views);
  const plan = planComparison({
    panels: views.map((view) => ({
      key: view.panel.key, label: view.label, surface: surfaceOf(images[view.panel.key]),
      width: Math.round(view.window.width * view.zoom), height: Math.round(view.window.height * view.zoom),
    })),
    callouts: visible, layout, displayWidth, measure,
  });
  drawPlan(plan, images, out);
  return { plan, images, visible };
}

function placementPhrase(layout, panels) {
  return layout === "side-by-side"
    ? `side by side, ${panels.before.label} on the left`
    : `stacked, ${panels.before.label} on top`;
}

function viewGeometry(plan, views) {
  return Object.fromEntries(plan.panels.map((panel) => {
    const view = views.find((item) => item.panel.key === panel.key);
    return [panel.key, {
      label: panel.label,
      canvas: [panel.x, panel.y, panel.width, panel.height],
      source: asArray(view.window),
      scale: view.zoom,
    }];
  }));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const specPath = resolve(options.spec);
  const spec = readJson(specPath, "spec");
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) die("spec must be a JSON object");
  const specDir = dirname(specPath);

  magickBinary = resolveMagick();
  if (!existsSync(FONT_PATH)) die(`bundled font missing: ${FONT_PATH}`);

  const panels = { before: loadPanel(spec, "before", specDir), after: loadPanel(spec, "after", specDir) };
  const displayWidth = spec.displayWidth ?? DEFAULT_DISPLAY_WIDTH;
  if (!Number.isFinite(displayWidth) || displayWidth < 320) die("displayWidth must be a number of at least 320");
  const limitations = [];

  if (panels.before.dpr !== panels.after.dpr) {
    die(`before was captured at device pixel ratio ${panels.before.dpr} and after at ${panels.after.dpr}. ` +
      "Recapture both at the same ratio so the panels share one scale.");
  }
  const mismatch = spec.sizeMismatch ?? "reject";
  if (!["reject", "pad"].includes(mismatch)) die('sizeMismatch must be "reject" or "pad"');
  const matched = sameSize(panels.before.size, panels.after.size);
  const describe = (panel) => `${panel.size.width}x${panel.size.height}`;
  const aid = (name) => {
    const value = spec[name];
    if (value === undefined || value === false) return null;
    if (value === true) return {};
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    die(`"${name}" must be true, false, or an options object`);
  };
  const flipSpec = aid("flip");
  const onionSpec = aid("onion");
  if (!matched) {
    if (mismatch !== "pad") {
      die(`dimension mismatch: before is ${describe(panels.before)} and after is ${describe(panels.after)}. ` +
        'Recapture both at the same viewport, or set "sizeMismatch": "pad" to align them at the top-left corner ' +
        "at one scale without stretching.");
    }
    if (flipSpec || onionSpec) {
      die(`flip and onion skin need identical dimensions to register the screenshots; before is ` +
        `${describe(panels.before)} and after is ${describe(panels.after)}`);
    }
    limitations.push(`Before is ${describe(panels.before)} and after is ${describe(panels.after)}; ` +
      "the panels share one scale and align at the top-left corner, with no stretching.");
  }

  let crop = null;
  if (spec.crop !== undefined) {
    crop = snapOut(rectFrom(spec.crop, "crop"));
    for (const panel of Object.values(panels)) {
      if (!contains(panel.bounds, crop)) die(`crop ${JSON.stringify(spec.crop)} extends outside the ${describe(panel)} ${panel.key} image`);
    }
  }

  const callouts = validateCallouts(spec, panels);
  for (const callout of callouts) {
    for (const panel of Object.values(panels)) {
      const rect = callout.regions[panel.key];
      if (rect && crop && !intersect(rect, crop)) die(`callout ${callout.id} ${panel.key} region lies outside the crop`);
    }
  }

  if (spec.redact !== undefined && !Array.isArray(spec.redact)) die('"redact" must be an array');
  const redactions = { before: [], after: [] };
  (spec.redact ?? []).forEach((raw, index) => {
    const what = `redaction ${index + 1}`;
    if (!raw || typeof raw !== "object") die(`${what} must be an object`);
    const target = raw.panel ?? "both";
    if (!["both", "before", "after"].includes(target)) die(`${what} panel must be "both", "before", or "after"`);
    const style = raw.style ?? "pixelate";
    if (!["pixelate", "block"].includes(style)) die(`${what} style must be "pixelate" or "block"`);
    const value = raw.at ?? (raw.anchor !== undefined ? { anchor: raw.anchor } : undefined);
    if (value === undefined) die(`${what} needs "at": [x, y, width, height] or "anchor"`);
    for (const key of target === "both" ? ["before", "after"] : [target]) {
      redactions[key].push({ rect: resolveRegion(value, panels[key], what), style });
    }
  });

  // Validate every requested output before writing any of them.
  if (spec.details !== undefined && !Array.isArray(spec.details)) die('"details" must be an array');
  const usedSlugs = new Set();
  const detailSpecs = (spec.details ?? []).map((raw, index) => {
    if (!raw || typeof raw !== "object") die(`detail ${index + 1} must be an object`);
    let regions;
    let name;
    if (raw.callout !== undefined) {
      const callout = callouts.find((item) => item.id === raw.callout);
      if (!callout) die(`detail ${index + 1} references callout ${raw.callout}, which does not exist`);
      regions = callout.regions;
      name = `callout-${callout.id}`;
    } else if (raw.region !== undefined || raw.before !== undefined || raw.after !== undefined) {
      regions = regionPair(raw, panels, `detail ${index + 1}`);
      if (!regions.before && !regions.after) die(`detail ${index + 1} needs a region`);
      name = `detail-${index + 1}`;
    } else {
      die(`detail ${index + 1} needs "callout", "region", or "before"/"after" regions`);
    }
    const slug = String(raw.id ?? name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!slug || usedSlugs.has(slug)) die(`detail ${index + 1} needs a unique id`);
    usedSlugs.add(slug);
    if (raw.separate === true && !(regions.before && regions.after)) {
      die(`detail ${slug} uses separate windows, which need a region in both panels`);
    }
    const largest = [regions.before, regions.after].filter(Boolean)
      .reduce((size, rect) => Math.max(size, rect.width, rect.height), 0);
    const context = raw.context ?? Math.max(Math.round(24 * panels.after.dpr), Math.round(largest * 0.25));
    if (!Number.isFinite(context) || context < 0) die(`detail ${slug} context must be a non-negative number`);
    const windows = detailWindows({
      before: regions.before, after: regions.after, context, separate: raw.separate === true,
      sizes: { before: panels.before.size, after: panels.after.size },
    });
    const layout = chooseLayout(raw.layout ?? "auto", windows.before);
    let zoom = raw.zoom ?? "auto";
    if (zoom === "auto") {
      const target = layout === "side-by-side" ? displayWidth / 2 : displayWidth;
      zoom = Math.min(4, Math.max(1, Math.floor(target / windows.before.width)));
    } else if (!Number.isFinite(zoom) || zoom < 1 || zoom > 8) {
      die(`detail ${slug} zoom must be "auto" or a number from 1 to 8`);
    }
    return { slug, label: raw.label ?? null, context, windows, layout, zoom };
  });
  const holdMs = flipSpec?.holdMs ?? 1500;
  if (flipSpec && (!Number.isFinite(holdMs) || holdMs < 500 || holdMs > 10000)) die("flip holdMs must be from 500 to 10000");
  const opacity = onionSpec?.opacity ?? 0.5;
  if (onionSpec && !(Number.isFinite(opacity) && opacity > 0 && opacity < 1)) {
    die("onion opacity must be a number between 0 and 1, exclusive");
  }

  const outDir = resolve(options.outDir);
  mkdirSync(outDir, { recursive: true });
  const temp = mkdtempSync(join(tmpdir(), "ui-evidence-compare-"));
  const measure = makeMeasure();
  try {
    for (const panel of Object.values(panels)) panel.source = redact(panel, redactions[panel.key], temp);

    const mainViews = Object.values(panels).map((panel) =>
      ({ panel, label: panel.label, window: crop ?? panel.bounds, zoom: 1 }));
    const comparisonPath = join(outDir, "comparison.png");
    const overview = renderView({
      name: "main", views: mainViews, layout: spec.layout ?? "auto", displayWidth, callouts, measure, temp,
      out: comparisonPath,
    });
    limitations.push(...overview.plan.limitations);

    const details = detailSpecs.map(({ slug, label, context, windows, layout, zoom }) => {
      const suffix = `${label ? ` - ${label}` : ""}${zoom !== 1 ? ` (${zoom}x)` : ""}`;
      const views = Object.values(panels).map((panel) =>
        ({ panel, label: `${panel.label}${suffix}`, window: windows[panel.key], zoom }));
      const path = join(outDir, `detail-${slug}.png`);
      const view = renderView({ name: `detail-${slug}`, views, layout, displayWidth, callouts, measure, temp, out: path });
      limitations.push(...view.plan.limitations.map((text) => `Detail ${slug}: ${text}`));
      for (const panel of Object.values(panels)) {
        if (!contains(panel.bounds, windows[panel.key])) {
          limitations.push(`Detail ${slug} extends past the ${panel.label} screenshot; the missing area is blank.`);
        }
      }
      if (zoom === 1) {
        limitations.push(`Detail ${slug} is a 1x crop; its window is wider than the readable target, so set "zoom" to enlarge it.`);
      }
      if (windows.mode === "separate") {
        limitations.push(`Detail ${slug} centres separate windows on each panel's region; ` +
          "positions inside its two panels are not directly comparable.");
      }
      const ids = view.visible.map((callout) => callout.id);
      return {
        id: slug, path, label, zoom, layout: view.plan.layout, mode: windows.mode,
        context, canvas: view.plan.canvas, panels: viewGeometry(view.plan, views), callouts: ids,
        alt: `Enlarged detail${label ? ` of ${label}` : ""}${zoom !== 1 ? ` at ${zoom}x` : ""}: ` +
          `${panels.before.label} and ${panels.after.label} ${placementPhrase(view.plan.layout, panels)}` +
          (ids.length ? `, showing callout${ids.length > 1 ? "s" : ""} ${ids.join(", ")}` : ""),
      };
    });

    let flip = null;
    let onion = null;
    if (flipSpec || onionSpec) {
      const width = imageSize(overview.images.before).width;
      const frameChrome = chromeFor(width, displayWidth);
      const pct = Math.round(opacity * 100);
      const onionText = `Onion skin: ${panels.after.label} at ${pct}% over ${panels.before.label}`;
      const texts = [panels.before.label, panels.after.label, ...(onionSpec ? [onionText] : [])];
      const sizes = texts.map((text) => measure(text, frameChrome.headerFont));
      const bannerHeight = Math.ceil(Math.max(...sizes.map((size) => size.height))) + frameChrome.headerPad * 2;
      const frameWidth = Math.max(width, ...sizes.map((size) => Math.ceil(size.width) + frameChrome.headerPad * 2));

      if (flipSpec) {
        const centiseconds = Math.round(holdMs / 10);
        const frames = Object.values(panels).map((panel) =>
          bannered(overview.images[panel.key], panel.label, bannerHeight, frameWidth, frameChrome, join(temp, `flip-${panel.key}.png`)));
        const path = join(outDir, "flip.gif");
        magick(["-delay", String(centiseconds), frames[0], "-delay", String(centiseconds), frames[1], "-loop", "0", path]);
        flip = {
          path, holdMs: centiseconds * 10, frames: [panels.before.label, panels.after.label], banner: bannerHeight,
          size: imageSize(path),
          alt: `Screenshot flip comparison alternating between the ${panels.before.label} and ${panels.after.label} ` +
            `screenshots every ${centiseconds / 100} seconds; screenshots only, not a recording of motion`,
        };
      }
      if (onionSpec) {
        const blended = join(temp, "onion-blend.png");
        magick([overview.images.before, "(", overview.images.after, "-alpha", "set", "-channel", "A",
          "-evaluate", "set", `${pct}%`, "+channel", ")", "-compose", "Over", "-composite", "-alpha", "off", blended]);
        const path = join(outDir, "onion.png");
        bannered(blended, onionText, bannerHeight, frameWidth, frameChrome, path);
        onion = {
          path, opacity: pct / 100, image: [0, bannerHeight, width, imageSize(blended).height],
          alt: `Onion skin overlay: the ${panels.after.label} screenshot at ${pct}% opacity over the ` +
            `${panels.before.label} screenshot, showing position shifts`,
        };
      }
    }

    const ids = callouts.map((callout) => callout.id);
    const comparisonAlt = spec.alt ?? `${spec.title ? `${spec.title}: ` : ""}${panels.before.label} and ` +
      `${panels.after.label} screenshots ${placementPhrase(overview.plan.layout, panels)}` +
      (callouts.length ? `, with numbered callouts: ${callouts.map((c) => `${c.id} ${c.text}`).join("; ")}` : "");
    const relative = (path) => path.slice(outDir.length + 1).split("\\").join("/");
    const markdown = sectionMarkdown({
      title: spec.title,
      comparison: { file: relative(comparisonPath), alt: comparisonAlt },
      callouts,
      details: details.map((detail) => ({ file: relative(detail.path), alt: detail.alt })),
      flip: flip && { file: relative(flip.path), alt: flip.alt },
      onion: onion && { file: relative(onion.path), alt: onion.alt },
    });
    const markdownPath = join(outDir, "section.md");
    writeFileSync(markdownPath, markdown);

    const resultPath = join(outDir, "result.json");
    const result = {
      outputs: {
        comparison: comparisonPath,
        details: details.map((detail) => detail.path),
        flip: flip?.path ?? null,
        onion: onion?.path ?? null,
        markdown: markdownPath,
        result: resultPath,
      },
      comparison: {
        layout: overview.plan.layout,
        canvas: overview.plan.canvas,
        displayWidth,
        panels: viewGeometry(overview.plan, mainViews),
        legend: overview.plan.legend && [overview.plan.legend.x, overview.plan.legend.y, overview.plan.legend.width, overview.plan.legend.height],
        alt: comparisonAlt,
      },
      inputs: Object.fromEntries(Object.values(panels).map((panel) => [panel.key, {
        image: panel.image, size: panel.size, devicePixelRatio: panel.dpr, anchors: Boolean(panel.anchors),
        redactions: redactions[panel.key].map((item) => ({ at: asArray(item.rect), style: item.style })),
      }])),
      callouts: callouts.map((callout) => ({
        id: callout.id, text: callout.text, legend: callout.legend, label: callout.label ?? null, color: callout.color,
        measure: callout.measure ?? null, spotlight: callout.spotlight,
        panels: Object.fromEntries(Object.keys(panels).map((key) => {
          const mark = overview.plan.marks.find((item) => item.id === callout.id && item.panel === key);
          const source = callout.regions[key];
          return [key, source ? {
            source: asArray(source),
            canvas: mark ? asArray(mark.rect) : null,
            pin: mark ? { center: [mark.pin.cx, mark.pin.cy], radius: mark.pin.radius, placement: mark.pin.placement } : null,
            label: mark?.label ? asArray(mark.label) : null,
            bracket: mark?.bracket ? { side: mark.bracket.side, label: asArray(mark.bracket.label) } : null,
          } : null];
        })),
      })),
      calloutIds: ids,
      details,
      flip,
      onion,
      limitations,
    };
    writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (!options.keepTemp) rmSync(temp, { recursive: true, force: true });
    else console.error(`compare: kept intermediate files in ${temp}`);
  }
}

try {
  main();
} catch (error) {
  console.error(`compare: ${error.message}`);
  process.exitCode = 1;
}
