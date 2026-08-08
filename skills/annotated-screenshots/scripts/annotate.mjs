#!/usr/bin/env node
// Draw reviewer-facing annotations onto a screenshot.
//
// Usage:
//   node annotate.mjs --spec spec.json --out annotated.png
//
// The spec is JSON. See references/annotation-spec.md for the full shape.
// Geometry is drawn as SVG and text is laid out as HTML, so the browser
// handles font metrics, text wrapping, and label sizing.

import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FONT_PATH = join(SKILL_ROOT, "assets", "DejaVuSans.ttf");
const SESSION = "annotated-screenshots";

// One accent reads as deliberate. Rotating only kicks in when a single image
// carries enough annotations that one colour stops disambiguating them.
const ACCENTS = ["#e5484d", "#0090ff", "#30a46c", "#ffb224", "#8e4ec6"];
const ROTATE_FROM = 3;

const HELP = `annotate.mjs - draw annotations onto a screenshot

  node annotate.mjs --spec <spec.json> --out <annotated.png>

  --spec <path>   Annotation spec (JSON)
  --out <path>    Output PNG
  --keep-temp     Leave the intermediate HTML and crops on disk for debugging

Run scripts/preflight.mjs to verify dependencies before starting work.
`;

function die(message) {
  console.error(`annotate: ${message}`);
  process.exit(1);
}

function resolveMagick() {
  for (const binary of ["magick", "convert"]) {
    try {
      execFileSync(binary, ["-version"], { stdio: "ignore" });
      return binary;
    } catch {
      // try the next candidate
    }
  }
  die("ImageMagick not found. Install ImageMagick and retry.");
}

function requireAgentBrowser() {
  try {
    execFileSync("agent-browser", ["--version"], { stdio: "ignore" });
  } catch {
    die("agent-browser not found. Install it with `npm i -g agent-browser && agent-browser install`.");
  }
}

function browser(args) {
  return execFileSync("agent-browser", ["--session", SESSION, ...args], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

// `scrollHeight` never reports less than the current viewport, so measure the
// content wrapper instead. Otherwise the previous run's viewport leaks into
// this one's output as trailing whitespace.
function measureContentHeight(fallback) {
  try {
    const raw = browser([
      "eval",
      "document.getElementById('root').getBoundingClientRect().height",
      "--json",
    ]);
    const height = Math.ceil(JSON.parse(raw)?.data?.result);
    return Number.isFinite(height) && height > 0 ? height : fallback;
  } catch {
    return fallback;
  }
}

function magickRun(magick, args) {
  execFileSync(magick, args, { stdio: ["ignore", "ignore", "pipe"] });
}

function parseArgs(argv) {
  const options = { keepTemp: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "--spec") options.spec = argv[++i];
    else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--keep-temp") options.keepTemp = true;
    else die(`unknown option ${arg}`);
  }
  return options;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function box(annotation) {
  const at = annotation.at;
  if (!Array.isArray(at) || at.length !== 4) {
    die(`annotation of type "${annotation.type}" needs "at": [x, y, width, height]`);
  }
  const [x, y, width, height] = at.map(Number);
  return { x, y, width, height };
}

function point(value, name, type) {
  if (!Array.isArray(value) || value.length !== 2) {
    die(`annotation of type "${type}" needs "${name}": [x, y]`);
  }
  return { x: Number(value[0]), y: Number(value[1]) };
}

// An arrow with no explicit tail gets one placed up and to the left, flipped
// toward whichever side has room so the tail never lands off-canvas.
function deriveTail(head, canvas) {
  const reach = Math.round(110 * canvas.scale);
  const dx = head.x > canvas.width / 2 ? -reach : reach;
  const dy = head.y > canvas.height / 2 ? -reach : reach;
  return { x: head.x + dx, y: head.y + dy };
}

function accentFor(index, total) {
  return total >= ROTATE_FROM ? ACCENTS[index % ACCENTS.length] : ACCENTS[0];
}

// Weights tuned on a full-width screenshot overwhelm a small crop: a 4px stroke
// on a 352px canvas reads as thicker than the thing it points at. Scale with
// the canvas, and clamp so large images do not grow absurd strokes.
function scaleFor(width) {
  return Math.min(1.15, Math.max(0.55, width / 1280));
}

const px = (value, scale, minimum = 1) => Math.max(minimum, Math.round(value * scale));

// Colours land inside SVG attributes and inline styles. Anything other than a
// plain hex value could close the attribute and inject markup into the page
// the renderer then opens.
const HEX_COLOUR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function colourOf(annotation, index, total) {
  if (annotation.color === undefined) return accentFor(index, total);
  if (!HEX_COLOUR.test(String(annotation.color))) {
    die(`"color" must be a hex value such as #0090ff, got: ${annotation.color}`);
  }
  return annotation.color;
}

// Labels are HTML rather than SVG text so the browser sizes the pill for us.
function labelHtml(text, x, y, colour, anchor = "center") {
  const transforms = {
    center: "translate(-50%, -50%)",
    above: "translate(-50%, -115%)",
    below: "translate(-50%, 15%)",
  };
  return `<div class="label" style="left:${x}px; top:${y}px; background:${colour};
    transform:${transforms[anchor] ?? transforms.center}">${escapeHtml(text)}</div>`;
}

function renderAnnotation(annotation, index, total, canvas) {
  const colour = colourOf(annotation, index, total);
  const type = annotation.type;
  const scale = canvas.scale;
  const stroke = px(4, scale, 2);
  let svg = "";
  let html = "";

  if (type === "arrow") {
    const head = point(annotation.to, "to", type);
    const tail = annotation.from ? point(annotation.from, "from", type) : deriveTail(head, canvas);
    const id = `head${index}`;
    svg += `<defs><marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5"
      markerWidth="5" markerHeight="5" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="${colour}"/></marker></defs>`;
    svg += `<line x1="${tail.x}" y1="${tail.y}" x2="${head.x}" y2="${head.y}"
      stroke="${colour}" stroke-width="${stroke}" stroke-linecap="round" marker-end="url(#${id})"/>`;
    if (annotation.label) html += labelHtml(annotation.label, tail.x, tail.y, colour, "above");
  } else if (type === "box") {
    const b = box(annotation);
    svg += `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}"
      rx="${px(6, scale, 3)}" fill="none" stroke="${colour}" stroke-width="${stroke}"/>`;
    if (annotation.label) {
      html += labelHtml(annotation.label, b.x + b.width / 2, b.y, colour, "above");
    }
  } else if (type === "circle") {
    const b = box(annotation);
    const margin = px(10, scale, 4);
    svg += `<ellipse cx="${b.x + b.width / 2}" cy="${b.y + b.height / 2}"
      rx="${b.width / 2 + margin}" ry="${b.height / 2 + margin}"
      fill="none" stroke="${colour}" stroke-width="${stroke}"
      stroke-dasharray="${px(10, scale, 4)} ${px(7, scale, 3)}"/>`;
    if (annotation.label) {
      html += labelHtml(annotation.label, b.x + b.width / 2, b.y - margin, colour, "above");
    }
  } else if (type === "label") {
    const p = point(annotation.at, "at", type);
    if (!annotation.text) die('annotation of type "label" needs "text"');
    html += labelHtml(annotation.text, p.x, p.y, colour, annotation.anchor ?? "center");
  } else if (type === "redact" || type === "inset") {
    // Both are burned into the pixels before this stage runs.
    return { svg: "", html: "" };
  } else {
    die(`unknown annotation type "${type}"`);
  }

  return { svg, html };
}

// Redaction destroys the pixels rather than covering them, so the original
// content cannot survive in the output under any circumstance.
function applyRedactions(magick, source, target, redactions) {
  let current = source;
  redactions.forEach((annotation, index) => {
    const b = box(annotation);
    const geometry = `${b.width}x${b.height}+${b.x}+${b.y}`;
    const next = index === redactions.length - 1 ? target : `${target}.${index}.png`;
    if (annotation.style === "block") {
      magickRun(magick, [
        current,
        "-fill", annotation.color === undefined ? "#111827" : colourOf(annotation, 0, 1),
        "-draw", `rectangle ${b.x},${b.y} ${b.x + b.width},${b.y + b.height}`,
        next,
      ]);
    } else {
      // Pixelate by downsampling and scaling back up: visibly redacted and
      // genuinely unrecoverable.
      magickRun(magick, [
        current,
        "(", "-clone", "0", "-crop", geometry, "+repage",
        "-resize", "6%", "-resize", `${b.width}x${b.height}!`, ")",
        "-geometry", `+${b.x}+${b.y}`, "-composite",
        next,
      ]);
    }
    current = next;
  });
  return current;
}

const options = parseArgs(process.argv.slice(2));

if (!options.spec) die(`--spec is required\n\n${HELP}`);
if (!options.out) die(`--out is required\n\n${HELP}`);

const specPath = resolve(options.spec);
if (!existsSync(specPath)) die(`no such spec: ${specPath}`);

let spec;
try {
  spec = JSON.parse(await readFile(specPath, "utf8"));
} catch (error) {
  die(`spec is not valid JSON: ${error.message}`);
}

if (!spec.image) die('spec needs an "image" path');
const specDir = dirname(specPath);
const imagePath = isAbsolute(spec.image) ? spec.image : resolve(specDir, spec.image);
if (!existsSync(imagePath)) die(`no such image: ${imagePath}`);

const magick = resolveMagick();
requireAgentBrowser();
if (!existsSync(FONT_PATH)) die(`bundled font missing: ${FONT_PATH}`);

const temp = mkdtempSync(join(tmpdir(), "annotated-screenshots-"));
const cleanup = () => {
  if (!options.keepTemp) rmSync(temp, { recursive: true, force: true });
};

try {
  const annotations = Array.isArray(spec.annotations) ? spec.annotations : [];
  const crop = spec.crop ? { ...spec.crop, pad: spec.crop.pad ?? 0 } : null;

  // Coordinates in the spec always refer to the original screenshot. Cropping
  // shifts the origin, so translate everything once here and let the rest of
  // the pipeline work in canvas space.
  // Clamp before translating, so padding at the top or left edge of the image
  // does not shift annotations off by the amount the crop was truncated.
  const offset = crop
    ? { x: Math.max(0, crop.x - crop.pad), y: Math.max(0, crop.y - crop.pad) }
    : { x: 0, y: 0 };
  const shift = (annotation) => {
    const copy = { ...annotation };
    if (Array.isArray(copy.at)) {
      copy.at = copy.at.length === 4
        ? [copy.at[0] - offset.x, copy.at[1] - offset.y, copy.at[2], copy.at[3]]
        : [copy.at[0] - offset.x, copy.at[1] - offset.y];
    }
    if (Array.isArray(copy.to)) copy.to = [copy.to[0] - offset.x, copy.to[1] - offset.y];
    if (Array.isArray(copy.from)) copy.from = [copy.from[0] - offset.x, copy.from[1] - offset.y];
    return copy;
  };

  let working = imagePath;

  if (crop) {
    const width = crop.width + crop.pad * 2;
    const height = crop.height + crop.pad * 2;
    const cropped = join(temp, "cropped.png");
    magickRun(magick, [
      imagePath,
      "-crop", `${width}x${height}+${offset.x}+${offset.y}`,
      "+repage",
      cropped,
    ]);
    working = cropped;
  }

  const shifted = annotations.map(shift);

  const redactions = shifted.filter((a) => a.type === "redact");
  if (redactions.length > 0) {
    working = applyRedactions(magick, working, join(temp, "redacted.png"), redactions);
  }

  const size = execFileSync(magick, ["identify", "-format", "%wx%h", working], {
    encoding: "utf8",
  }).trim();
  const [canvasWidth, canvasHeight] = size.split("x").map(Number);
  const scale = scaleFor(canvasWidth);
  const canvas = { width: canvasWidth, height: canvasHeight, scale };

  // Zoom insets are cropped from the already-redacted canvas so a redacted
  // area cannot reappear magnified in the corner.
  const insets = shifted.filter((a) => a.type === "inset");
  const insetHtml = insets.map((annotation, index) => {
    const b = box(annotation);
    const zoom = Number(annotation.zoom ?? 2);
    const file = join(temp, `inset-${index}.png`);
    magickRun(magick, [
      working,
      "-crop", `${b.width}x${b.height}+${b.x}+${b.y}`,
      "+repage",
      "-resize", `${Math.round(b.width * zoom)}x${Math.round(b.height * zoom)}!`,
      file,
    ]);
    const colour = colourOf(annotation, index, shifted.length);
    const place = annotation.place ?? "bottom-right";
    const [vertical, horizontal] = place.split("-");
    const style = [
      `${vertical === "top" ? "top" : "bottom"}: 16px`,
      `${horizontal === "left" ? "left" : "right"}: 16px`,
      `border-color:${colour}`,
    ].join("; ");
    const caption = annotation.label
      ? `<div class="inset-caption" style="background:${colour}">${escapeHtml(annotation.label)}</div>`
      : "";
    return `<div class="inset" style="${style}">
      <img src="${pathToFileURL(file).href}" alt="">${caption}</div>`;
  });

  // Insets and redactions are already burned in; only geometry remains.
  const drawable = shifted.filter((a) => a.type !== "redact" && a.type !== "inset");
  const rendered = drawable.map((annotation, index) =>
    renderAnnotation(annotation, index, drawable.length, canvas),
  );

  const captionHtml = spec.caption
    ? `<div class="caption">${escapeHtml(spec.caption)}</div>`
    : "";

  const html = `<meta charset="utf-8">
<style>
  @font-face {
    font-family: "Bundled";
    src: url("${pathToFileURL(FONT_PATH).href}") format("truetype");
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #ffffff; }
  .frame { position: relative; width: ${canvasWidth}px; }
  .frame > img { display: block; width: ${canvasWidth}px; height: ${canvasHeight}px; }
  svg.overlay { position: absolute; inset: 0; width: ${canvasWidth}px; height: ${canvasHeight}px; }
  .label {
    position: absolute;
    font-family: "Bundled", sans-serif;
    font-size: ${px(15, scale, 10)}px;
    line-height: 1.3;
    color: #ffffff;
    padding: ${px(5, scale, 2)}px ${px(10, scale, 5)}px;
    border-radius: ${px(6, scale, 3)}px;
    white-space: pre-wrap;
    max-width: ${Math.max(140, Math.round(canvasWidth * 0.45))}px;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
  }
  .inset {
    position: absolute;
    border: ${px(3, scale, 2)}px solid;
    border-radius: ${px(8, scale, 4)}px;
    overflow: hidden;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4);
    background: #ffffff;
  }
  .inset > img { display: block; }
  .inset-caption {
    font-family: "Bundled", sans-serif;
    font-size: ${px(13, scale, 9)}px;
    color: #ffffff;
    padding: ${px(3, scale, 2)}px ${px(8, scale, 4)}px;
  }
  .caption {
    font-family: "Bundled", sans-serif;
    font-size: ${px(15, scale, 11)}px;
    line-height: 1.45;
    color: #1f2933;
    padding: ${px(12, scale, 7)}px ${px(14, scale, 8)}px;
    width: ${canvasWidth}px;
    background: #f3f4f6;
    border-top: 1px solid #d9dde3;
  }
</style>
<div id="root">
  <div class="frame">
    <img src="${pathToFileURL(working).href}" alt="">
    <svg class="overlay" viewBox="0 0 ${canvasWidth} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
      ${rendered.map((r) => r.svg).join("\n      ")}
    </svg>
    ${rendered.map((r) => r.html).join("\n    ")}
    ${insetHtml.join("\n    ")}
  </div>
  ${captionHtml}
</div>
`;

  const htmlPath = join(temp, "render.html");
  writeFileSync(htmlPath, html, "utf8");

  const outPath = resolve(options.out);
  mkdirSync(dirname(outPath), { recursive: true });

  browser(["open", pathToFileURL(htmlPath).href]);
  // A caption wraps to an unpredictable height, so size the viewport to the
  // measured content rather than guessing and trimming later.
  const contentHeight = measureContentHeight(canvasHeight);
  browser(["set", "viewport", String(canvasWidth), String(contentHeight)]);
  browser(["screenshot", "--full", outPath]);

  if (!existsSync(outPath)) die("agent-browser reported success but produced no file");

  const finalSize = execFileSync(magick, ["identify", "-format", "%wx%h", outPath], {
    encoding: "utf8",
  }).trim();
  console.log(JSON.stringify({ out: outPath, size: finalSize, annotations: annotations.length }));
} finally {
  cleanup();
}
