#!/usr/bin/env node
// Turn an agent-browser WebM recording into review-ready GIF evidence.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const SKILL_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FONT_PATH = join(SKILL_ROOT, "assets", "DejaVuSans.ttf");
const MIB = 1024 * 1024;
const GITHUB_GIF_LIMIT = 10 * MIB;

const HELP = `prepare-gif.mjs - prepare motion evidence for GitHub

  node prepare-gif.mjs --spec <spec.json> --out <evidence.gif> --review-out <contact.png>

  --spec <path>         Motion preparation spec
  --out <path>          Optimized GIF output
  --review-out <path>   Local sampled-frame contact sheet; do not publish it
  --keep-temp           Keep intermediate encodes and sampled frames
`;

function die(message) {
  console.error(`prepare-gif: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = { keepTemp: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "--spec") options.spec = argv[++index];
    else if (arg === "--out") options.out = argv[++index];
    else if (arg === "--review-out") options.reviewOut = argv[++index];
    else if (arg === "--keep-temp") options.keepTemp = true;
    else die(`unknown option ${arg}`);
  }
  if (!options.spec) die(`--spec is required\n\n${HELP}`);
  if (!options.out) die(`--out is required\n\n${HELP}`);
  if (!options.reviewOut) die(`--review-out is required\n\n${HELP}`);
  return options;
}

function commandExists(binary, args = ["-version"]) {
  try {
    execFileSync(binary, args, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function requireBinary(binary) {
  if (!commandExists(binary)) die(`${binary} not found. Run scripts/preflight.mjs --motion.`);
}

function resolveMontage() {
  if (commandExists("magick")) return { binary: "magick", prefix: ["montage"] };
  if (commandExists("montage")) return { binary: "montage", prefix: [] };
  die("ImageMagick montage not found. Run scripts/preflight.mjs --motion.");
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
      "-show_entries", "stream=width,height,r_frame_rate,avg_frame_rate,nb_read_frames",
      "-show_entries", "format=duration,size",
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
    size: Number(parsed.format?.size ?? statSync(path).size),
    frames: Number.isFinite(frames) ? frames : null,
  };
}

function finite(value, name, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    die(`${name} must be ${integer ? "an integer" : "a number"} from ${min} to ${max}`);
  }
  return number;
}

function resolveInput(specPath, input) {
  if (!input || typeof input !== "string") die('spec needs an "input" path');
  return isAbsolute(input) ? resolve(input) : resolve(dirname(specPath), input);
}

function resolveCrop(raw, source) {
  if (!raw) return { x: 0, y: 0, width: source.width, height: source.height, explicit: false };
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

const HEX_COLOUR = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

function resolveRedactions(raw, crop) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) die("redactions must be an array");
  return raw.flatMap((redaction, index) => {
    if (!Array.isArray(redaction.at) || redaction.at.length !== 4) {
      die(`redactions[${index}].at must be [x, y, width, height]`);
    }
    const [x, y, width, height] = redaction.at.map((value, part) =>
      finite(value, `redactions[${index}].at[${part}]`, { min: 0, integer: true }),
    );
    if (width < 1 || height < 1) die(`redactions[${index}] needs positive width and height`);
    const color = redaction.color ?? "#111827";
    if (!HEX_COLOUR.test(color)) die(`redactions[${index}].color must be a six- or eight-digit hex value`);

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

function uniqueProfiles(profiles) {
  const seen = new Set();
  return profiles.filter((profile) => {
    const key = `${profile.width}x${profile.fps}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function buildProfiles(profile, crop) {
  const initialWidth = Math.min(profile.maxWidth, crop.width);
  const floorWidth = Math.min(640, initialWidth);
  return uniqueProfiles([
    { width: initialWidth, fps: profile.fps },
    { width: initialWidth, fps: Math.min(10, profile.fps) },
    { width: floorWidth, fps: Math.min(10, profile.fps) },
    { width: floorWidth, fps: 8 },
  ]);
}

function ffmpegColor(hex) {
  return `0x${hex.slice(1)}`;
}

function buildFilter({ trim, crop, redactions, holds, profile }) {
  const chain = [
    `trim=start=${trim.start}:end=${trim.end}`,
    "setpts=PTS-STARTPTS",
  ];
  if (crop.explicit) chain.push(`crop=${crop.width}:${crop.height}:${crop.x}:${crop.y}`);
  for (const redaction of redactions) {
    chain.push(
      `drawbox=x=${redaction.x}:y=${redaction.y}:w=${redaction.width}:h=${redaction.height}` +
        `:color=${ffmpegColor(redaction.color)}:t=fill`,
    );
  }
  chain.push(
    `scale=w=trunc(min(iw\\,${profile.width})/2)*2:h=-2:flags=lanczos`,
    `fps=${profile.fps}`,
    `tpad=start_mode=clone:start_duration=${holds.start}` +
      `:stop_mode=clone:stop_duration=${holds.end}`,
  );
  return (
    `[0:v]${chain.join(",")},split=2[frames][palette_source];` +
    "[palette_source]palettegen=stats_mode=diff[palette];" +
    "[frames][palette]paletteuse=dither=sierra2_4a:diff_mode=rectangle[out]"
  );
}

function encode(input, output, settings) {
  const filter = buildFilter(settings);
  run(
    "ffmpeg",
    [
      "-y", "-v", "error", "-i", input,
      "-filter_complex", filter,
      "-map", "[out]",
      "-loop", "0",
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
  // Seeking to the exact container duration can land after the final decodable
  // GIF frame while ffmpeg still exits successfully with no output.
  const last = Math.max(0, duration - Math.min(0.25, interval / 2));
  if (times.length === 0 || last > times.at(-1) + 0.05) times.push(last);
  return times;
}

function buildReviewSheet(gif, output, temp, duration, interval) {
  const montage = resolveMontage();
  const times = sampleTimes(duration, interval);
  const frames = times.map((time, index) => {
    const frame = join(temp, `review-${String(index).padStart(3, "0")}.png`);
    run(
      "ffmpeg",
      ["-y", "-v", "error", "-ss", String(time), "-i", gif, "-frames:v", "1", frame],
      `extract review frame at ${time.toFixed(1)}s`,
    );
    if (!existsSync(frame)) die(`ffmpeg produced no review frame at ${time.toFixed(1)}s`);
    return { frame, time };
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
  for (const { frame, time } of frames) args.push("-label", `${time.toFixed(1)}s`, frame);
  args.push(output);
  run(montage.binary, args, "ImageMagick contact sheet");
  if (!existsSync(output)) die(`ImageMagick produced no contact sheet: ${output}`);
  return times;
}

requireBinary("ffmpeg");
requireBinary("ffprobe");
if (!existsSync(FONT_PATH)) die(`bundled font missing at ${FONT_PATH}`);

const options = parseArgs(process.argv.slice(2));
const specPath = resolve(options.spec);
if (!existsSync(specPath)) die(`no such spec: ${specPath}`);

let spec;
try {
  spec = JSON.parse(readFileSync(specPath, "utf8"));
} catch (error) {
  die(`spec is not valid JSON: ${error.message}`);
}

const input = resolveInput(specPath, spec.input);
if (!existsSync(input)) die(`no such input: ${input}`);
const source = inspect(input);
if (source.frames !== null && source.frames < 2) {
  die(
    `source has only ${source.frames} frame; agent-browser recording likely lost its page target. ` +
      "Do not run open, reload, or set viewport after record start",
  );
}
if (source.duration < 0.2) {
  die(
    `source duration is only ${source.duration.toFixed(2)}s; agent-browser recording likely lost its page target. ` +
      "Do not run open, reload, or set viewport after record start",
  );
}
const crop = resolveCrop(spec.crop, source);
const trim = {
  start: finite(spec.trim?.start ?? 0, "trim.start", { min: 0, max: source.duration }),
  end: finite(spec.trim?.end ?? source.duration, "trim.end", { min: 0, max: source.duration }),
};
if (trim.end <= trim.start) die("trim.end must be greater than trim.start");

const holds = {
  start: finite(spec.holds?.start ?? 0.5, "holds.start", { min: 0, max: 3 }),
  end: finite(spec.holds?.end ?? 1, "holds.end", { min: 0, max: 3 }),
};
const maxDuration = finite(spec.limits?.maxDuration ?? 8, "limits.maxDuration", { min: 1, max: 12 });
const expectedDuration = trim.end - trim.start + holds.start + holds.end;
if (expectedDuration > maxDuration + 0.01) {
  die(
    `prepared duration would be ${expectedDuration.toFixed(2)}s, above ${maxDuration}s; ` +
      "tighten trim.start or trim.end",
  );
}

const profile = {
  maxWidth: finite(spec.profile?.maxWidth ?? 720, "profile.maxWidth", {
    min: Math.min(640, crop.width),
    max: 1920,
    integer: true,
  }),
  fps: finite(spec.profile?.fps ?? 12, "profile.fps", { min: 8, max: 30, integer: true }),
  targetBytes: finite(spec.profile?.targetBytes ?? 5 * MIB, "profile.targetBytes", {
    min: 100 * 1024,
    max: GITHUB_GIF_LIMIT,
    integer: true,
  }),
  maxBytes: finite(spec.profile?.maxBytes ?? GITHUB_GIF_LIMIT, "profile.maxBytes", {
    min: 100 * 1024,
    max: GITHUB_GIF_LIMIT,
    integer: true,
  }),
};
if (profile.targetBytes > profile.maxBytes) die("profile.targetBytes cannot exceed profile.maxBytes");

const redactions = resolveRedactions(spec.redactions, crop);
const reviewInterval = finite(spec.review?.interval ?? 0.5, "review.interval", { min: 0.25, max: 2 });
const profiles = buildProfiles(profile, crop);
const temp = mkdtempSync(join(tmpdir(), "ui-evidence-gif-"));
const cleanup = () => {
  if (!options.keepTemp) rmSync(temp, { recursive: true, force: true });
};
process.once("exit", cleanup);

try {
  const attempts = [];
  let selected = null;
  for (const [index, candidate] of profiles.entries()) {
    const path = join(temp, `attempt-${index}.gif`);
    const size = encode(input, path, { trim, crop, redactions, holds, profile: candidate });
    const attempt = { ...candidate, size, path };
    attempts.push(attempt);
    if (!selected || size < selected.size) selected = attempt;
    if (size <= profile.targetBytes) {
      selected = attempt;
      break;
    }
  }

  if (!selected || selected.size > profile.maxBytes) {
    const smallest = selected ? `${(selected.size / MIB).toFixed(2)} MiB` : "no output";
    die(`smallest bounded profile is ${smallest}, above the ${(profile.maxBytes / MIB).toFixed(2)} MiB limit`);
  }

  const out = resolve(options.out);
  const reviewOut = resolve(options.reviewOut);
  mkdirSync(dirname(out), { recursive: true });
  copyFileSync(selected.path, out);

  const prepared = inspect(out);
  const reviewTimes = buildReviewSheet(out, reviewOut, temp, prepared.duration, reviewInterval);
  const warning = selected.size > profile.targetBytes
    ? `output is below the hard limit but above the ${(profile.targetBytes / MIB).toFixed(2)} MiB target`
    : null;

  console.log(JSON.stringify({
    out,
    reviewOut,
    source,
    prepared,
    trim,
    crop,
    redactions: redactions.length,
    holds,
    selectedProfile: { width: selected.width, fps: selected.fps, size: selected.size },
    attempts: attempts.map(({ width, fps, size }) => ({ width, fps, size })),
    reviewTimes,
    warning,
  }, null, 2));
} finally {
  cleanup();
}
