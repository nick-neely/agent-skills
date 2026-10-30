#!/usr/bin/env node
// Prepare a recording as review-ready MP4 or GIF evidence.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CHROME, composer, imText, numberedPinArgs, textMeasurer } from "./magick-args.mjs";
import {
  AnnotationError, annotationReport, layoutCaptions, layoutStoryboard, motionMarkdown, outputSize, outputTimeline,
  planEvents, planStoryboard, storyboardReport,
} from "./motion-annotations.mjs";

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FONT_PATH = join(SKILL_ROOT, "assets", "DejaVuSans.ttf");
const MIB = 1024 * 1024;
const DEFAULT_MAX_BYTES = 9_500_000;
const MAX_BYTES = 100_000_000;

const HELP = `prepare-motion.mjs - prepare or inspect motion evidence

  node prepare-motion.mjs --spec <spec.json> --out <evidence.mp4|evidence.gif> --review-out <contact.png>
                         [--preview-out <preview.html>] [--storyboard-out <storyboard.png>]
                         [--markdown-out <section.md>] [--keep-temp]
  node prepare-motion.mjs --inspect <raw.webm|raw.mp4> --review-out <contact.png> [--preview-out <preview.html>] [--keep-temp]

  --spec <path>            Motion preparation spec
  --inspect <path>         Inspect a raw recording without encoding it
  --out <path>             Prepared MP4 or GIF output
  --review-out <path>      Local sampled-frame contact sheet; do not publish it
  --preview-out <path>     Local HTML preview; do not publish it
  --storyboard-out <path>  Labelled checkpoint PNG from the final output; needs spec.storyboard
  --markdown-out <path>    Publisher-compatible section for the output and storyboard
  --keep-temp              Keep intermediate encodes and sampled frames

  spec.annotations adds timed step numbers, captions, and key indicators;
  spec.storyboard selects checkpoints. Times refer to the source recording.
  Both need ImageMagick; run scripts/preflight.mjs --prepare --annotations.

  MP4 defaults: H.264 CRF 18, 30 fps and the full crop width (rounded to even dimensions).
  GIF defaults: 12 fps and at most 720px wide. Both default to a 9,500,000-byte
  exclusive ceiling; profile.maxBytes may be set up to 100,000,000 when supported. Holds
  default to 0.5s at the start and 1s at the end, with 0.5s review sampling.
`;

function die(message) {
  console.error(`prepare-motion: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { keepTemp: false };
  const valued = { "--spec": "spec", "--inspect": "inspect", "--out": "out",
    "--review-out": "reviewOut", "--preview-out": "previewOut", "--storyboard-out": "storyboardOut",
    "--markdown-out": "markdownOut" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (Object.hasOwn(valued, arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) die(`${arg} requires a value`);
      if (options[valued[arg]] !== undefined) die(`${arg} may only be specified once`);
      options[valued[arg]] = value;
      index += 1;
    } else if (arg === "--keep-temp") options.keepTemp = true;
    else die(`unknown option ${arg}`);
  }
  if (!options.reviewOut) die(`--review-out is required\n\n${HELP}`);
  if (options.inspect && (options.spec || options.out)) die("--inspect cannot be combined with --spec or --out");
  if (!options.inspect && !options.spec) die(`--spec or --inspect is required\n\n${HELP}`);
  if (!options.inspect && !options.out) die(`--out is required\n\n${HELP}`);
  if (options.out && !/\.(mp4|gif)$/i.test(options.out)) die("--out must end in .mp4 or .gif");
  if (options.inspect && !/\.(webm|mp4)$/i.test(options.inspect)) die("--inspect must end in .webm or .mp4");
  if (!/\.png$/i.test(options.reviewOut)) die("--review-out must end in .png");
  if (options.previewOut && !/\.html?$/i.test(options.previewOut)) die("--preview-out must end in .html or .htm");
  if (options.inspect && (options.storyboardOut || options.markdownOut)) die("--storyboard-out and --markdown-out need --spec");
  if (options.storyboardOut && !/\.png$/i.test(options.storyboardOut)) die("--storyboard-out must end in .png");
  if (options.markdownOut && !/\.md$/i.test(options.markdownOut)) die("--markdown-out must end in .md");
  return options;
}

function canonicalPath(path) {
  const absolute = resolve(path);
  let ancestor = absolute;
  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const canonical = resolve(realpathSync(ancestor), relative(ancestor, absolute));
  return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function ensureDistinct(paths) {
  const seen = [];
  for (const path of paths.filter(Boolean)) {
    const canonical = canonicalPath(path);
    const stat = existsSync(path) ? statSync(path) : null;
    if (seen.some((entry) => entry.canonical === canonical ||
      (stat?.ino && entry.stat?.ino && stat.ino === entry.stat.ino && stat.dev === entry.stat.dev))) {
      die("input, spec, and every output path must be distinct to avoid overwriting evidence");
    }
    seen.push({ canonical, stat });
  }
}

function probeCommand(binary, args = ["-version"]) {
  try {
    execFileSync(binary, args, { stdio: "ignore" });
    return { available: true };
  } catch (error) {
    return error.code === "ENOENT" ? { available: false } : { available: false, error };
  }
}

function failProbe(binary, error) {
  const detail = error.code ?? (Number.isInteger(error.status) ? `exit ${error.status}` : error.signal ?? error.message);
  die(`could not run ${binary} (${detail}); check the executable and its permissions`);
}

function requireBinary(binary) {
  const probe = probeCommand(binary);
  if (probe.error) failProbe(binary, probe.error);
  if (!probe.available) die(`${binary} not found. Run scripts/preflight.mjs --prepare.`);
}

function resolveMontage() {
  const magick = probeCommand("magick", ["montage", "-version"]);
  if (magick.available) return { binary: "magick", prefix: ["montage"] };
  const montage = probeCommand("montage");
  if (montage.available) return { binary: "montage", prefix: [] };
  if (magick.error) failProbe("magick", magick.error);
  if (montage.error) failProbe("montage", montage.error);
  die("ImageMagick montage not found. Run scripts/preflight.mjs --prepare.");
}

// ImageMagick for measuring and drawing annotations and storyboards. Like
// resolveMontage, try every candidate before reporting a failed probe.
let drawBinary;
function draw(args, label) {
  if (!drawBinary) {
    const candidates = process.platform === "win32" ? ["magick"] : ["magick", "convert"];
    const probes = candidates.map((binary) => ({ binary, probe: probeCommand(binary) }));
    drawBinary = probes.find((item) => item.probe.available)?.binary;
    if (!drawBinary) {
      const failed = probes.find((item) => item.probe.error);
      if (failed) failProbe(failed.binary, failed.probe.error);
      die("ImageMagick not found; annotations and storyboards need it. Run scripts/preflight.mjs --prepare --annotations.");
    }
  }
  return run(drawBinary, args, label);
}

const makeMeasure = () => textMeasurer((args) => draw(args, "ImageMagick text measurement"), FONT_PATH);

// One transparent overlay per event at the final output size: the planned
// outline and pin around a control, and the caption area's pin, keys, and text.
function renderEvent(event, layout, size, out) {
  const { chrome } = layout;
  const args = ["-size", `${size.width}x${size.height + layout.band}`, "xc:none"];
  const place = composer(args);
  const planned = layout.layouts.get(event.index);
  if (planned.marks) {
    const { outline: o, corner, pin } = planned.marks;
    args.push("-fill", "none", "-stroke", event.color, "-strokewidth", String(chrome.stroke),
      "-draw", `roundrectangle ${o.x},${o.y} ${o.x + o.width - 1},${o.y + o.height - 1} ${corner},${corner}`);
    if (pin) place(numberedPinArgs(event.step, event.color, chrome, FONT_PATH), pin.cx - chrome.radius, pin.cy - chrome.radius);
  }
  if (planned.items.length || planned.text) {
    const { y: top, height: boxHeight } = layout.box;
    if (!layout.band) args.push("-fill", CHROME.header, "-stroke", "none", "-draw", `rectangle 0,${top} ${size.width - 1},${top + boxHeight - 1}`);
    const middle = (itemHeight) => top + Math.floor((boxHeight - itemHeight) / 2);
    for (const item of planned.items) {
      if (item.type === "pin") place(numberedPinArgs(event.step, event.color, chrome, FONT_PATH), item.x, middle(item.size));
      else {
        const y = middle(item.height);
        args.push("-fill", CHROME.panel, "-stroke", CHROME.border, "-strokewidth", String(Math.max(1, chrome.ring)),
          "-draw", `roundrectangle ${item.x},${y} ${item.x + item.width - 1},${y + item.height - 1} 4,4`);
        place(["-background", "none", "-fill", CHROME.text, "-stroke", "none", "+size", "-font", FONT_PATH,
          "-pointsize", String(layout.keyFont), `label:${imText(item.text)}`], item.x + chrome.labelPad, y + chrome.labelPad);
      }
    }
    if (planned.text) {
      place(["-background", "none", "-fill", "#ffffff", "-stroke", "none", "-font", FONT_PATH,
        "-pointsize", String(layout.font), "-size", `${Math.floor(planned.text.width)}x`, `caption:${imText(event.caption)}`],
      planned.text.x, middle(planned.text.height));
    }
  }
  draw([...args, "-strip", `PNG32:${out}`], `ImageMagick annotation overlay ${event.index}`);
  return out;
}

function renderStoryboard(layout, frames, out) {
  const { chrome } = layout;
  const args = ["-size", `${layout.width}x${layout.height}`, "xc:#ffffff"];
  const place = composer(args);
  layout.panels.forEach((panel, index) => {
    const { image } = panel;
    place([frames[index], "-resize", `${image.width}x${image.height}!`], image.x, image.y);
    args.push("-fill", "none", "-stroke", CHROME.border, "-strokewidth", "2",
      "-draw", `rectangle ${image.x - 1},${image.y - 1} ${image.x + image.width},${image.y + image.height}`);
    // Neutral checkpoint pins, so checkpoint numbers are not read as step numbers.
    place(numberedPinArgs(panel.checkpoint.index, CHROME.muted, chrome, FONT_PATH), panel.pin.cx - chrome.radius, panel.pin.cy - chrome.radius);
    place(["-background", "none", "-fill", CHROME.text, "-stroke", "none", "-font", FONT_PATH,
      "-pointsize", String(chrome.legendFont), "-size", `${Math.floor(panel.text.width)}x`, `caption:${imText(panel.checkpoint.label)}`],
    panel.text.x, panel.text.y);
    place(["-background", "none", "-fill", CHROME.muted, "-stroke", "none", "-font", FONT_PATH,
      "-pointsize", String(chrome.labelFont), "-size", `${Math.floor(panel.text.width)}x`, `caption:${imText(panel.time)}`],
    panel.text.x, panel.timeY);
  });
  mkdirSync(dirname(out), { recursive: true });
  draw([...args, "-strip", out], "ImageMagick storyboard");
}

function run(binary, args, label) {
  try {
    return execFileSync(binary, args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    die(`${label} failed: ${detail}`);
  }
}

function inspect(path) {
  const raw = run(
    "ffprobe",
    [
      "-v", "error",
      "-count_frames",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,r_frame_rate,avg_frame_rate,nb_read_frames,duration",
      "-show_entries", "format=duration,size,start_time",
      "-of", "json",
      path,
    ],
    `ffprobe ${path}`,
  );
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    die(`ffprobe returned invalid JSON for ${path}`);
  }
  const stream = parsed.streams?.[0];
  const duration = Number(parsed.format?.duration);
  if (!stream || !Number.isFinite(duration)) die(`could not inspect video stream in ${path}`);
  const frames = Number(stream.nb_read_frames);
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    duration,
    streamDuration: Number.isFinite(Number(stream.duration)) && Number(stream.duration) > 0 ? Number(stream.duration) : null,
    startTime: Number.isFinite(Number(parsed.format?.start_time)) ? Number(parsed.format.start_time) : 0,
    size: Number(parsed.format?.size ?? statSync(path).size),
    frames: Number.isFinite(frames) ? frames : null,
  };
}

function sourceTimeline(path, source) {
  const raw = run("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "frame=best_effort_timestamp_time,pkt_duration_time,duration_time", "-of", "json", path],
  "ffprobe frame timestamps");
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    die("ffprobe returned invalid frame timestamp JSON");
  }
  const frames = (result.frames ?? []).map((frame) => ({
    timestamp: Number.parseFloat(frame.best_effort_timestamp_time),
    duration: [frame.duration_time, frame.pkt_duration_time].map(Number.parseFloat)
      .find((duration) => Number.isFinite(duration) && duration > 0),
  })).filter((frame) => Number.isFinite(frame.timestamp));
  if (!frames.length || frames.length !== source.frames) {
    die("could not determine each decoded source frame timestamp; inspect or re-record the source");
  }
  const origin = frames[0].timestamp;
  const final = frames.at(-1);
  const videoDuration = Number.isFinite(final.duration) && final.duration > 0
    ? final.timestamp - origin + final.duration
    : source.streamDuration ?? source.duration - (origin - source.startTime);
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) die("could not determine the source video duration");
  source.videoStartTime = origin;
  source.videoDuration = videoDuration;
  return frames;
}

function boundaryFrames(frames, source, trim) {
  let first = -1;
  let last = -1;
  for (const [index, frame] of frames.entries()) {
    const time = frame.timestamp - source.videoStartTime;
    if (time <= trim.start + 1e-9) first = index;
    if (time < trim.end - 1e-9) last = index;
  }
  if (first < 0 || last < 0) die("trim starts before the first source frame; adjust the trim or inspect the source");
  return { first, last };
}

function extractBoundary(path, index, output) {
  run("ffmpeg", ["-y", "-v", "error", "-i", path, "-vf", `select=eq(n\\,${index})`,
    "-frames:v", "1", output], `extract source frame ${index}`);
  if (!existsSync(output)) die(`could not extract source frame ${index}`);
}

function finite(value, name, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const number = value;
  if (typeof number !== "number" || !Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    die(`${name} must be ${integer ? "an integer" : "a number"} from ${min} to ${max}`);
  }
  return number;
}

function defaultValue(value, fallback) {
  return value === undefined ? fallback : value;
}

function requireObject(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) die(`${name} must be an object`);
}

function resolveInput(specPath, input) {
  if (!input || typeof input !== "string") die('spec needs an "input" path');
  return isAbsolute(input) ? resolve(input) : resolve(dirname(specPath), input);
}

function resolveCrop(raw, source) {
  if (raw === undefined) return { x: 0, y: 0, width: source.width, height: source.height, explicit: false };
  const crop = {
    x: finite(raw.x, "crop.x", { min: 0, integer: true }),
    y: finite(raw.y, "crop.y", { min: 0, integer: true }),
    width: finite(raw.width, "crop.width", { min: 1, integer: true }),
    height: finite(raw.height, "crop.height", { min: 1, integer: true }),
    explicit: true,
  };
  if (crop.x + crop.width > source.width || crop.y + crop.height > source.height) {
    die(`crop ${crop.x},${crop.y} ${crop.width}x${crop.height} exceeds ${source.width}x${source.height}`);
  }
  return crop;
}

const HEX_COLOUR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{6}[fF]{2})$/;

function resolveRedactions(raw, crop) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) die("redactions must be an array");
  return raw.flatMap((redaction, index) => {
    if (!redaction || !Array.isArray(redaction.at) || redaction.at.length !== 4) {
      die(`redactions[${index}].at must be [x, y, width, height]`);
    }
    const [x, y, width, height] = redaction.at.map((value, part) =>
      finite(value, `redactions[${index}].at[${part}]`, { min: 0, integer: true }),
    );
    if (width < 1 || height < 1) die(`redactions[${index}] needs positive width and height`);
    const color = defaultValue(redaction.color, "#111827");
    if (typeof color !== "string" || !HEX_COLOUR.test(color)) {
      die(`redactions[${index}].color must be opaque #RRGGBB or #RRGGBBFF`);
    }

    const left = Math.max(x, crop.x);
    const top = Math.max(y, crop.y);
    const right = Math.min(x + width, crop.x + crop.width);
    const bottom = Math.min(y + height, crop.y + crop.height);
    if (right <= left || bottom <= top) return [];
    return [{
      x: left - crop.x,
      y: top - crop.y,
      width: right - left,
      height: bottom - top,
      color,
    }];
  });
}

function ffmpegColor(hex) {
  return `0x${hex.slice(1)}`;
}

function buildFilter({ crop, redactions, holds, profile, format, firstThrough, lastFrom, startTick, endTick,
  size, band = 0, overlays = [] }) {
  const chain = [
    "setpts=PTS-STARTPTS",
    `fps=${profile.fps}:round=up`,
    `trim=start_pts=${startTick}:end_pts=${endTick}`,
    "setpts=PTS-STARTPTS",
    `tpad=start_mode=clone:start_duration=${holds.start}` +
      `:stop_mode=clone:stop_duration=${holds.end}`,
  ];
  const finish = [];
  if (crop.explicit) finish.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}:exact=1`);
  for (const redaction of redactions) {
    finish.push(
      `drawbox=x=${redaction.x}:y=${redaction.y}:w=${redaction.width}:h=${redaction.height}` +
        `:color=${ffmpegColor(redaction.color)}:t=fill`,
    );
  }
  finish.push(
    `scale=w=trunc(min(iw\\,${profile.width})/2)*2:h=-2:flags=lanczos`,
  );
  // A caption band below the video keeps captions off the UI under test.
  if (band) finish.push(`pad=w=${size.width}:h=${size.height + band}:x=0:y=0:color=0x${CHROME.header.slice(1)}`);
  let annotated = `[bounded]${finish.join(",")}`;
  overlays.forEach((overlay, index) => {
    annotated += `[a${index}];[a${index}][${3 + index}:v]overlay=0:0:format=auto:shortest=1:` +
      `enable='between(n\\,${overlay.frames[0]}\\,${overlay.frames[1]})'`;
  });
  const boundaries = `[0:v]${chain.join(",")}[timed];` +
    `[timed][1:v]overlay=0:0:format=auto:shortest=1:enable='lt(n\\,${firstThrough})'[begin];` +
    `[begin][2:v]overlay=0:0:format=auto:shortest=1:enable='gte(n\\,${lastFrom})'[bounded];`;
  if (format === "mp4") return `${boundaries}${annotated}[out]`;
  return (
    `${boundaries}${annotated},split=2[frames][palette_source];` +
    "[palette_source]palettegen=stats_mode=full[palette];" +
    "[frames][palette]paletteuse=dither=sierra2_4a:diff_mode=rectangle[out]"
  );
}

function encode(input, output, settings) {
  const filter = buildFilter(settings);
  const encoding = settings.format === "mp4"
    ? ["-an", "-c:v", "libx264", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart"]
    : ["-loop", "0"];
  run(
    "ffmpeg",
    [
      "-y", "-v", "error", "-i", input,
      "-loop", "1", "-framerate", String(settings.profile.fps), "-i", settings.firstImage,
      "-loop", "1", "-framerate", String(settings.profile.fps), "-i", settings.lastImage,
      ...(settings.overlays ?? []).flatMap((overlay) => ["-loop", "1", "-framerate", String(settings.profile.fps), "-i", overlay.path]),
      "-filter_complex", filter,
      "-map", "[out]",
      ...encoding,
      output,
    ],
    `ffmpeg encode ${settings.profile.width}px ${settings.profile.fps}fps`,
  );
  if (!existsSync(output)) die(`ffmpeg reported success but produced no file: ${output}`);
  return statSync(output).size;
}

function sampleTimes(duration, interval) {
  const times = [];
  for (let time = 0; time < duration; time += interval) times.push(Number(time.toFixed(3)));
  return times;
}

function buildReviewSheet(input, output, temp, media, interval) {
  const montage = resolveMontage();
  const times = sampleTimes(media.duration, interval);
  if (!Number.isInteger(media.frames) || media.frames < 1) die("could not count decoded frames for the contact sheet");
  const samples = [...times.map((time) => ({ time })), { last: true }];
  const frames = samples.map(({ time, last }, index) => {
    const frame = join(temp, `review-${String(index).padStart(3, "0")}.png`);
    const filter = last ? `select=eq(n\\,${media.frames - 1})`
      : `setpts=PTS-STARTPTS,fps=60,tpad=stop_mode=clone:stop_duration=${media.duration},select=gte(t\\,${time})`;
    const label = last ? "last frame" : `${time.toFixed(1)}s`;
    run(
      "ffmpeg",
      ["-y", "-v", "error", "-i", input, "-vf", filter, "-frames:v", "1", frame],
      `extract review frame ${label}`,
    );
    if (!existsSync(frame)) die(`ffmpeg produced no review frame ${label}`);
    return { frame, label };
  });

  mkdirSync(dirname(output), { recursive: true });
  const args = [
    ...montage.prefix,
    "-background", "white",
    "-fill", "#111827",
    "-font", FONT_PATH,
    "-pointsize", "18",
    "-tile", "4x",
    "-geometry", "360x+8+8",
  ];
  for (const { frame, label } of frames) args.push("-label", label, frame);
  args.push(output);
  run(montage.binary, args, "ImageMagick contact sheet");
  if (!existsSync(output)) die(`ImageMagick produced no contact sheet: ${output}`);
  return times;
}

function escapeHtml(value) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function buildPreview(previewPath, input, output) {
  const sourceUrl = escapeHtml(pathToFileURL(input).href);
  const result = output && /\.gif$/i.test(output)
    ? `<h2>Prepared GIF</h2><img src="${escapeHtml(pathToFileURL(output).href)}" alt="Prepared GIF">`
    : output
      ? `<h2>Prepared output</h2><video controls playsinline preload="metadata" src="${escapeHtml(pathToFileURL(output).href)}"></video>`
      : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Motion evidence review</title><style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem}video,img{display:block;max-width:100%;max-height:75vh}p{line-height:1.5}</style></head><body><h1>Motion evidence review</h1><p>Local preview. Watch the complete prepared output and review the sampled frames before publication. Raw footage can contain unredacted data.</p><h2>Raw recording</h2><video controls playsinline preload="metadata" src="${sourceUrl}"></video>${result}</body></html>`;
  mkdirSync(dirname(previewPath), { recursive: true });
  writeFileSync(previewPath, html);
}

const options = parseArgs(process.argv.slice(2));
requireBinary("ffmpeg");
requireBinary("ffprobe");
if (!existsSync(FONT_PATH)) die(`bundled font missing at ${FONT_PATH}`);
const temp = mkdtempSync(join(tmpdir(), "ui-evidence-motion-"));
const cleanup = () => {
  if (!options.keepTemp) rmSync(temp, { recursive: true, force: true });
};
process.once("exit", cleanup);
if (options.inspect) {
  const input = resolve(options.inspect);
  if (!existsSync(input)) die(`no such input: ${input}`);
  const source = inspect(input);
  sourceTimeline(input, source);
  const reviewOut = resolve(options.reviewOut);
  const previewOut = options.previewOut ? resolve(options.previewOut) : null;
  ensureDistinct([input, reviewOut, previewOut]);
  const reviewTimes = buildReviewSheet(input, reviewOut, temp, { ...source, duration: source.videoDuration }, 0.5);
  if (previewOut) buildPreview(previewOut, input, null);
  console.log(JSON.stringify({ input, source, reviewOut, previewOut, reviewTimes, reviewLastFrame: true,
    warnings: ["Frame count alone does not prove smooth capture. Review the complete recording."],
    ...(options.keepTemp ? { temp } : {}) }, null, 2));
  process.exit(0);
}
const format = options.out.toLowerCase().endsWith(".mp4") ? "mp4" : "gif";
const specPath = resolve(options.spec);
if (!existsSync(specPath)) die(`no such spec: ${specPath}`);

let spec;
try {
  spec = JSON.parse(readFileSync(specPath, "utf8"));
} catch (error) {
  die(`spec is not valid JSON: ${error.message}`);
}
requireObject(spec, "spec");
for (const field of ["trim", "crop", "holds", "profile", "limits", "review", "annotations", "storyboard"]) {
  if (spec[field] !== undefined) requireObject(spec[field], field);
}
for (const field of ["title", "summary"]) {
  if (spec[field] !== undefined && (typeof spec[field] !== "string" || !spec[field].trim())) die(`${field} must be non-empty text`);
}
if (spec.storyboard !== undefined && !options.storyboardOut) die("spec.storyboard needs --storyboard-out <storyboard.png>");
if (options.storyboardOut && spec.storyboard === undefined) die("--storyboard-out needs spec.storyboard with checkpoints");

const input = resolveInput(specPath, spec.input);
if (!existsSync(input)) die(`no such input: ${input}`);
ensureDistinct([specPath, input, options.out, options.reviewOut, options.previewOut, options.storyboardOut, options.markdownOut]);
const source = inspect(input);
const frames = sourceTimeline(input, source);
const crop = resolveCrop(spec.crop, source);
if (crop.width < 2 || crop.height < 2) die("crop must be at least 2x2 pixels");
const trim = {
  start: finite(defaultValue(spec.trim?.start, 0), "trim.start", { min: 0, max: source.videoDuration }),
  end: finite(defaultValue(spec.trim?.end, source.videoDuration), "trim.end", { min: 0 }),
};
if (trim.end <= trim.start) die("trim.end must be greater than trim.start");
if (trim.end > source.videoDuration + 1e-6) {
  die(`duration mismatch: trim.end ${trim.end}s exceeds the ${source.videoDuration.toFixed(3)}s video timeline; inspect the source and trim`);
}

const holds = {
  start: finite(defaultValue(spec.holds?.start, 0.5), "holds.start", { min: 0 }),
  end: finite(defaultValue(spec.holds?.end, 1), "holds.end", { min: 0 }),
};
const maxDuration = spec.limits?.maxDuration === undefined
  ? null : finite(spec.limits.maxDuration, "limits.maxDuration", { min: Number.MIN_VALUE });
const expectedDuration = trim.end - trim.start + holds.start + holds.end;
if (maxDuration !== null && expectedDuration > maxDuration + 1e-9) {
  die(
    `prepared duration would be ${expectedDuration.toFixed(2)}s, above ${maxDuration}s; ` +
      "tighten trim.start or trim.end",
  );
}

const profile = {
  maxWidth: finite(defaultValue(spec.profile?.maxWidth, format === "mp4" ? crop.width : 720), "profile.maxWidth", {
    min: 2,
    integer: true,
  }),
  fps: finite(defaultValue(spec.profile?.fps, format === "mp4" ? 30 : 12), "profile.fps", { min: 1, max: 60, integer: true }),
  targetBytes: spec.profile?.targetBytes === undefined ? null : finite(spec.profile.targetBytes, "profile.targetBytes", {
    min: 1, max: MAX_BYTES, integer: true,
  }),
  maxBytes: finite(defaultValue(spec.profile?.maxBytes, DEFAULT_MAX_BYTES), "profile.maxBytes", {
    min: 1,
    max: MAX_BYTES,
    integer: true,
  }),
};
if (profile.targetBytes !== null && profile.targetBytes > profile.maxBytes) die("profile.targetBytes cannot exceed profile.maxBytes");

const redactions = resolveRedactions(spec.redactions, crop);
const reviewInterval = finite(defaultValue(spec.review?.interval, 0.5), "review.interval", { min: 0.1 });

try {
  const selected = { width: Math.min(profile.maxWidth, crop.width), fps: profile.fps,
    path: join(temp, `prepared.${format}`) };
  const boundary = boundaryFrames(frames, source, trim);
  const startTick = Math.ceil(trim.start * profile.fps - 1e-9);
  const endTick = Math.ceil(trim.end * profile.fps - 1e-9);
  const actionFrames = endTick - startTick;
  const startFrames = Math.round(holds.start * profile.fps);
  const endFrames = Math.round(holds.end * profile.fps);
  if (actionFrames < 1) {
    die("trim is too short to represent at the requested frame rate; increase profile.fps or widen the trim");
  }
  // Validate and lay out annotations and checkpoints before any encoding.
  const size = outputSize(crop, selected.width);
  const timeline = outputTimeline({ trim, fps: profile.fps, startTick, endTick, startFrames, endFrames });
  const sourceBounds = { duration: source.videoDuration };
  let annotations;
  let storyboard;
  let measure = null;
  let captionLayout = null;
  try {
    annotations = planEvents(spec.annotations, { source: sourceBounds, size, timeline,
      crop: { ...crop, sourceWidth: source.width, sourceHeight: source.height } });
    storyboard = planStoryboard(spec.storyboard, timeline, sourceBounds, annotations?.displayWidth);
    measure = annotations || storyboard ? makeMeasure() : null;
    captionLayout = annotations ? layoutCaptions(annotations, size, measure) : null;
  } catch (error) {
    if (error instanceof AnnotationError) die(error.message);
    throw error;
  }
  const markdownOut = options.markdownOut ? resolve(options.markdownOut) : null;
  const linkFrom = (file) => {
    const link = relative(dirname(markdownOut), file);
    if (!link || link.startsWith("..") || isAbsolute(link)) {
      die(`--markdown-out must be in a directory that contains ${file}, so the publisher can resolve it`);
    }
    return link.split(sep).join("/");
  };
  if (markdownOut) {
    linkFrom(resolve(options.out));
    if (options.storyboardOut) linkFrom(resolve(options.storyboardOut));
  }
  const overlays = annotations ? annotations.events.map((event) => ({
    frames: event.frames, path: renderEvent(event, captionLayout, size, join(temp, `event-${event.index}.png`)),
  })) : [];
  const band = captionLayout?.band ?? 0;
  const firstImage = join(temp, "first-boundary.png");
  const lastImage = boundary.first === boundary.last ? firstImage : join(temp, "last-boundary.png");
  extractBoundary(input, boundary.first, firstImage);
  if (lastImage !== firstImage) extractBoundary(input, boundary.last, lastImage);
  const differentBoundaries = lastImage !== firstImage && !readFileSync(firstImage).equals(readFileSync(lastImage));
  // CFR quantizes event times. Retain the exact source states at both trim
  // boundaries even when neither one lands on the output frame grid.
  let firstThrough = startFrames + 1;
  let lastFrom = startFrames + actionFrames - 1;
  if (actionFrames === 1 && differentBoundaries) {
    if (startFrames > 0) firstThrough = startFrames;
    else if (endFrames > 0) lastFrom = 1;
    else die("trim contains distinct boundary states but only one output frame; increase profile.fps, widen the trim, or add a hold");
  }
  selected.size = encode(input, selected.path, { trim, crop, redactions, holds, profile: selected, format,
    firstImage, lastImage, firstThrough, lastFrom, startTick, endTick, size, band, overlays });
  if (selected.size >= profile.maxBytes) {
    die(`output is ${selected.size} bytes, at or above the exclusive ${profile.maxBytes} byte limit; crop more tightly, reduce duration only if it preserves the claim, or set an allowed higher profile.maxBytes`);
  }

  const prepared = inspect(selected.path);
  if (prepared.width !== size.width || prepared.height !== size.height + band) {
    die(`encoded ${prepared.width}x${prepared.height}, expected ${size.width}x${size.height + band}; annotations would be misplaced`);
  }
  if (prepared.frames !== startFrames + actionFrames + endFrames) {
    die(`duration mismatch: expected ${startFrames + actionFrames + endFrames} normalized frames, encoded ${prepared.frames}; inspect the source and trim`);
  }
  const tolerance = 1.5 / profile.fps + 0.02;
  if (Math.abs(prepared.duration - expectedDuration) > tolerance) {
    die(`duration mismatch: expected ${expectedDuration.toFixed(2)}s, encoded ${prepared.duration.toFixed(2)}s (tolerance ${tolerance.toFixed(2)}s); inspect the source and trim`);
  }

  const out = resolve(options.out);
  const reviewOut = resolve(options.reviewOut);
  mkdirSync(dirname(out), { recursive: true });
  const reviewTimes = buildReviewSheet(selected.path, reviewOut, temp, prepared, reviewInterval);
  copyFileSync(selected.path, out);
  const previewOut = options.previewOut ? resolve(options.previewOut) : null;
  if (previewOut) buildPreview(previewOut, input, out);
  // Storyboard panels come from the final prepared output, so they carry its
  // redactions and annotations.
  const storyboardOut = options.storyboardOut ? resolve(options.storyboardOut) : null;
  let storyboardLayout = null;
  if (storyboard) {
    const stills = storyboard.checkpoints.map((checkpoint) => {
      const still = join(temp, `checkpoint-${checkpoint.index}.png`);
      run("ffmpeg", ["-y", "-v", "error", "-i", selected.path, "-vf", `select=eq(n\\,${checkpoint.frame})`,
        "-frames:v", "1", still], `extract checkpoint ${checkpoint.index}`);
      if (!existsSync(still)) die(`could not extract checkpoint ${checkpoint.index} at frame ${checkpoint.frame}`);
      return still;
    });
    storyboardLayout = layoutStoryboard(storyboard, { width: prepared.width, height: prepared.height }, measure);
    renderStoryboard(storyboardLayout, stills, storyboardOut);
  }
  if (markdownOut) {
    mkdirSync(dirname(markdownOut), { recursive: true });
    writeFileSync(markdownOut, motionMarkdown({
      title: spec.title, summary: spec.summary, video: linkFrom(out), events: annotations?.events,
      storyboard: storyboard && { file: linkFrom(storyboardOut), checkpoints: storyboard.checkpoints },
    }));
  }
  const warnings = ["Frame count alone does not prove smooth capture. Review the complete output.",
    `Output timing is quantized to ${profile.fps} fps; brief intermediate states can be missed.`];
  if (expectedDuration > 20) warnings.push("This clip is longer than 20 seconds; keep it focused on the claim.");
  if (profile.targetBytes !== null && selected.size > profile.targetBytes) {
    warnings.push(`output is below the limit but above the ${(profile.targetBytes / MIB).toFixed(2)} MiB target`);
  }
  for (const event of annotations?.events ?? []) {
    if (event.region?.clipped) warnings.push(`annotations.events[${event.index}].at was clipped to the crop; check that the outline still marks the control`);
  }

  console.log(JSON.stringify({
    input,
    out,
    reviewOut,
    previewOut,
    source,
    prepared,
    trim,
    crop,
    redactions: redactions.length,
    holds,
    boundaryFrames: boundary,
    selectedProfile: { width: prepared.width, fps: selected.fps, size: selected.size, maxBytes: profile.maxBytes },
    timeline: timeline.segments,
    ...(annotations ? { annotations: annotationReport(annotations, captionLayout) } : {}),
    ...(storyboard ? { storyboard: storyboardReport(storyboard, storyboardLayout, storyboardOut) } : {}),
    ...(markdownOut ? { markdownOut } : {}),
    reviewTimes,
    reviewLastFrame: true,
    warnings,
    ...(spec.provenance === undefined ? {} : { provenance: spec.provenance }),
    ...(options.keepTemp ? { temp } : {}),
  }, null, 2));
} finally {
  cleanup();
}
