#!/usr/bin/env node
// Report where two screenshots differ, as bounding boxes.
//
// Usage:
//   node regions.mjs <before.png> <after.png> [--threshold 8] [--min-area 200] [--text]
//
// Prints JSON: { dimensions, changedPixels, changedFraction, union, regions[] }
// Each region is { x, y, width, height, area, centroid: [x, y] }, largest first.

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const HELP = `regions.mjs - locate the changed areas between two screenshots

  node regions.mjs <before.png> <after.png> [options]

  --threshold <pct>   Per-pixel difference required to count as changed (default 8)
  --min-area <px>     Discard regions smaller than this many pixels (default 200)
  --text              Human-readable output instead of JSON
`;

function die(message) {
  console.error(`regions: ${message}`);
  process.exit(1);
}

// ImageMagick 7 ships `magick`; ImageMagick 6 ships `convert`.
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

function parseArgs(argv) {
  const positional = [];
  const options = { threshold: 8, minArea: 200, text: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "--threshold") {
      options.threshold = Number(argv[++i]);
    } else if (arg === "--min-area") {
      options.minArea = Number(argv[++i]);
    } else if (arg === "--text") {
      options.text = true;
    } else if (arg.startsWith("-")) {
      die(`unknown option ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length !== 2) die(`expected two image paths\n\n${HELP}`);
  if (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 100) {
    die("--threshold must be a percentage between 0 and 100");
  }
  if (!Number.isFinite(options.minArea) || options.minArea < 0) {
    die("--min-area must be a non-negative number");
  }
  return { before: positional[0], after: positional[1], options };
}

function dimensionsOf(magick, path) {
  const out = execFileSync(magick, ["identify", "-format", "%wx%h", path], {
    encoding: "utf8",
  }).trim();
  const [width, height] = out.split("x").map(Number);
  return { width, height };
}

// `-connected-components` prints one line per region:
//   41: 768x18+256+131 638.0,139.5 13467 gray(255)
// gray(255) marks changed pixels; gray(0) is the unchanged background blob.
const REGION_LINE =
  /^\s*\d+:\s+(\d+)x(\d+)\+(-?\d+)\+(-?\d+)\s+([\d.-]+),([\d.-]+)\s+(\d+)\s+(\S+)/;

function findRegions(magick, before, after, { threshold, minArea }) {
  const raw = execFileSync(
    magick,
    [
      before,
      after,
      "-compose",
      "difference",
      "-composite",
      "-colorspace",
      "Gray",
      "-threshold",
      `${threshold}%`,
      "-define",
      "connected-components:verbose=true",
      "-define",
      `connected-components:area-threshold=${minArea}`,
      "-connected-components",
      "8",
      "null:",
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );

  return raw
    .split("\n")
    .map((line) => line.match(REGION_LINE))
    .filter(Boolean)
    .filter((match) => match[8] === "gray(255)")
    .map((match) => ({
      x: Number(match[3]),
      y: Number(match[4]),
      width: Number(match[1]),
      height: Number(match[2]),
      centroid: [Number(match[5]), Number(match[6])],
      area: Number(match[7]),
    }))
    .sort((a, b) => b.area - a.area);
}

function unionOf(regions) {
  if (regions.length === 0) return null;
  const left = Math.min(...regions.map((r) => r.x));
  const top = Math.min(...regions.map((r) => r.y));
  const right = Math.max(...regions.map((r) => r.x + r.width));
  const bottom = Math.max(...regions.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const { before, after, options } = parseArgs(process.argv.slice(2));
for (const path of [before, after]) {
  if (!existsSync(path)) die(`no such file: ${path}`);
}

const magick = resolveMagick();
const beforeSize = dimensionsOf(magick, before);
const afterSize = dimensionsOf(magick, after);

// Different dimensions make a per-pixel diff meaningless, and silently
// comparing them would report the whole frame as changed.
if (beforeSize.width !== afterSize.width || beforeSize.height !== afterSize.height) {
  die(
    `dimension mismatch: before is ${beforeSize.width}x${beforeSize.height}, ` +
      `after is ${afterSize.width}x${afterSize.height}. ` +
      `Recapture both at the same viewport and device pixel ratio.`,
  );
}

const regions = findRegions(magick, before, after, options);
const changedPixels = regions.reduce((total, region) => total + region.area, 0);
const totalPixels = afterSize.width * afterSize.height;

const result = {
  dimensions: afterSize,
  changedPixels,
  changedFraction: Number((changedPixels / totalPixels).toFixed(6)),
  union: unionOf(regions),
  regions,
};

if (options.text) {
  if (regions.length === 0) {
    console.log("No changed regions above the threshold.");
  } else {
    console.log(`${regions.length} changed region(s) in ${afterSize.width}x${afterSize.height}:`);
    for (const r of regions) {
      console.log(`  ${r.width}x${r.height} at (${r.x}, ${r.y})  area ${r.area}`);
    }
  }
} else {
  console.log(JSON.stringify(result, null, 2));
}
