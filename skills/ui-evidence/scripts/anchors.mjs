#!/usr/bin/env node
// Resolve CSS selectors to saved screenshot geometry in the caller's browser
// session, so comparisons can be rendered later without a live DOM.
//
// Usage:
//   node anchors.mjs --session <name> --anchor save='[data-testid="save"]' \
//     --screenshot /abs/after.png [--full] --out /abs/after-anchors.json
//
// Only `eval` and, when requested, `screenshot` run in the named session. The
// helper never opens, navigates, resizes, or closes it.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { anchorToImageRect, asArray, expectedScreenshotSize, intersect } from "./comparison-layout.mjs";

const HELP = `anchors.mjs - save selector geometry for a screenshot

  node anchors.mjs --session <name> --anchor <name>=<selector> [...] --out <anchors.json>
                   (--screenshot <path.png> | --image <path.png>) [--full]

  --session <name>       Existing agent-browser session that shows the page; required
  --anchor name=selector Selector that must match exactly one rendered element; repeatable
  --screenshot <path>    Capture the screenshot now, in the same session, and verify the
                         page did not move between measuring and capturing
  --image <path>         Describe an existing PNG captured from the current page state
  --full                 The screenshot is a full-page capture rather than the viewport
  --out <path>           Anchor file for compare.mjs

Rectangles are stored as viewport CSS pixels with the scroll offset, viewport,
document size, device pixel ratio, and screenshot dimensions needed to map them
into screenshot pixels.
`;

function die(message) {
  throw new Error(message);
}

function parseArgs(argv) {
  const options = { anchors: [], full: false };
  const value = (arg, index) => {
    const next = argv[index];
    if (next === undefined || next.startsWith("--")) die(`${arg} requires a value`);
    return next;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "--session") options.session = value(arg, ++i);
    else if (arg === "--out") options.out = value(arg, ++i);
    else if (arg === "--screenshot") options.screenshot = value(arg, ++i);
    else if (arg === "--image") options.image = value(arg, ++i);
    else if (arg === "--full") options.full = true;
    else if (arg === "--anchor") {
      const raw = value(arg, ++i);
      const split = raw.indexOf("=");
      const name = split > 0 ? raw.slice(0, split) : "";
      const selector = split > 0 ? raw.slice(split + 1).trim() : "";
      if (!/^[A-Za-z0-9_-]+$/.test(name) || !selector) {
        die(`--anchor expects name=selector with a name of letters, digits, "_" or "-", got ${JSON.stringify(raw)}`);
      }
      if (options.anchors.some((anchor) => anchor.name === name)) die(`anchor "${name}" is defined twice`);
      options.anchors.push({ name, selector });
    } else die(`unknown option ${arg}`);
  }
  if (!options.session) die("--session is required; pass the named agent-browser session that shows the page");
  if (!options.anchors.length) die("at least one --anchor name=selector is required");
  if (!options.out) die("--out is required");
  if (Boolean(options.screenshot) === Boolean(options.image)) die("pass exactly one of --screenshot or --image");
  return options;
}

function browser(session, args) {
  try {
    return execFileSync("agent-browser", ["--session", session, ...args], {
      encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    if (error.code === "ENOENT") die("agent-browser not found; run scripts/preflight.mjs for the fix");
    const detail = String(error.stdout || "").trim() || String(error.stderr || error.message).trim();
    die(`agent-browser ${args[0]} failed in session "${session}": ${detail}`);
  }
}

// Runs in the page. Describes every candidate so a failure says what matched.
function measureScript(anchors) {
  return `(() => {
  const anchors = ${JSON.stringify(anchors)};
  const describe = (node) => {
    const id = node.id ? "#" + node.id : "";
    const classes = typeof node.className === "string" && node.className.trim()
      ? "." + node.className.trim().split(/\\s+/).slice(0, 3).join(".") : "";
    const text = (node.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 40);
    return node.tagName.toLowerCase() + id + classes + (text ? " " + JSON.stringify(text) : "");
  };
  const root = document.scrollingElement || document.documentElement;
  const result = {
    url: location.origin + location.pathname,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: { x: window.scrollX, y: window.scrollY },
    document: { width: root.scrollWidth, height: root.scrollHeight },
    devicePixelRatio: window.devicePixelRatio,
    anchors: {},
    problems: [],
  };
  for (const { name, selector } of anchors) {
    let nodes;
    try {
      nodes = [...document.querySelectorAll(selector)];
    } catch (error) {
      result.problems.push({ name, selector, problem: "invalid", detail: String(error.message || error) });
      continue;
    }
    if (nodes.length === 0) {
      result.problems.push({ name, selector, problem: "missing" });
    } else if (nodes.length > 1) {
      result.problems.push({ name, selector, problem: "ambiguous", count: nodes.length,
        candidates: nodes.slice(0, 5).map(describe) });
    } else {
      const box = nodes[0].getBoundingClientRect();
      if (box.width <= 0 || box.height <= 0) {
        result.problems.push({ name, selector, problem: "empty", candidates: [describe(nodes[0])] });
      } else {
        result.anchors[name] = { selector, element: describe(nodes[0]),
          rect: { x: box.x, y: box.y, width: box.width, height: box.height } };
      }
    }
  }
  return result;
})()`;
}

function measure(session, anchors) {
  const script = Buffer.from(measureScript(anchors), "utf8").toString("base64");
  const raw = browser(session, ["eval", "-b", script, "--json"]);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    die(`agent-browser eval returned unexpected output: ${raw.slice(0, 200)}`);
  }
  const result = parsed?.data?.result;
  if (!parsed?.success || !result || typeof result !== "object") {
    die(`could not measure anchors in session "${session}": ${parsed?.error ?? "no result"}`);
  }
  return result;
}

function explain(problem, url) {
  const where = `on ${url}`;
  if (problem.problem === "invalid") {
    return `anchor "${problem.name}": ${JSON.stringify(problem.selector)} is not a valid selector (${problem.detail})`;
  }
  if (problem.problem === "missing") {
    return `anchor "${problem.name}": ${JSON.stringify(problem.selector)} matched no element ${where}. ` +
      "Confirm the route and state, wait for the element, or take a selector from `agent-browser snapshot`.";
  }
  if (problem.problem === "ambiguous") {
    return `anchor "${problem.name}": ${JSON.stringify(problem.selector)} matched ${problem.count} elements ${where}; ` +
      `make it unique, for example with a data-testid or a parent scope. Candidates: ${problem.candidates.join("; ")}`;
  }
  return `anchor "${problem.name}": ${JSON.stringify(problem.selector)} matched ${problem.candidates[0]}, ` +
    "which has no rendered box (hidden or zero size). Choose a visible element.";
}

// Reads the IHDR chunk directly so this helper needs no image toolkit.
function pngSize(path) {
  if (!existsSync(path)) die(`no such image: ${path}`);
  const bytes = readFileSync(path);
  const signature = "89504e470d0a1a0a";
  if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== signature || bytes.toString("latin1", 12, 16) !== "IHDR") {
    die(`not a PNG screenshot: ${path}`);
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const moved = (a, b) => Math.abs(a - b) > 0.5;

function main() {
  const options = parseArgs(process.argv.slice(2));
  const session = options.session;
  const first = measure(session, options.anchors);
  if (first.problems.length) die(first.problems.map((problem) => explain(problem, first.url)).join("\n"));

  let imagePath;
  if (options.screenshot) {
    imagePath = resolve(options.screenshot);
    mkdirSync(dirname(imagePath), { recursive: true });
    browser(session, ["screenshot", ...(options.full ? ["--full"] : []), imagePath]);
    const second = measure(session, options.anchors);
    const changed = second.problems.length ||
      moved(first.scroll.x, second.scroll.x) || moved(first.scroll.y, second.scroll.y) ||
      first.viewport.width !== second.viewport.width || first.viewport.height !== second.viewport.height ||
      options.anchors.some(({ name }) => ["x", "y", "width", "height"].some((key) =>
        moved(first.anchors[name].rect[key], second.anchors[name]?.rect[key])));
    if (changed) {
      die("the page moved while capturing (scroll, viewport, or anchor geometry changed). " +
        "Wait for animation and loading to settle, then capture again.");
    }
  } else {
    imagePath = resolve(options.image);
  }

  const screenshot = pngSize(imagePath);
  const capture = {
    mode: options.full ? "full" : "viewport",
    viewport: first.viewport,
    scroll: first.scroll,
    document: first.document,
    devicePixelRatio: first.devicePixelRatio,
    screenshot,
  };
  const expected = expectedScreenshotSize(capture);
  if (Math.abs(expected.width - screenshot.width) > 1 || Math.abs(expected.height - screenshot.height) > 1) {
    const area = options.full ? `document ${first.document.width}x${first.document.height}` :
      `viewport ${first.viewport.width}x${first.viewport.height}`;
    die(`screenshot is ${screenshot.width}x${screenshot.height}, but the ${area} at device pixel ratio ` +
      `${first.devicePixelRatio} implies ${expected.width}x${expected.height}. ` +
      `${options.full ? "Use a full-page capture" : "Use a viewport capture or pass --full"} that matches the current page, ` +
      "or capture together with --screenshot.");
  }

  const bounds = { x: 0, y: 0, ...screenshot };
  const warnings = [];
  const anchors = {};
  for (const { name } of options.anchors) {
    const anchor = first.anchors[name];
    const pixels = anchorToImageRect(anchor.rect, capture);
    const visible = intersect(pixels, bounds);
    if (!visible) {
      die(`anchor "${name}" lies outside the captured ${capture.mode === "full" ? "page" : "viewport"} ` +
        `(screenshot pixels ${JSON.stringify(asArray(pixels))}). Scroll it into view or capture with --full.`);
    }
    const clipped = visible.width !== pixels.width || visible.height !== pixels.height;
    if (clipped) warnings.push(`anchor "${name}" is partly outside the screenshot; its rectangle was clipped`);
    anchors[name] = { ...anchor, image: asArray(visible), clipped };
  }

  const record = { version: 1, url: first.url, capture: { ...capture, image: imagePath }, anchors, warnings };
  const out = resolve(options.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  console.log(JSON.stringify({ out, screenshot: imagePath, ...record }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`anchors: ${error.message}`);
  process.exitCode = 1;
}
