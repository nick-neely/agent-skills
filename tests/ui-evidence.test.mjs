#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(repo, "skills", "ui-evidence");
const pointer = join(skill, "scripts", "pointer.mjs");
const prepare = join(skill, "scripts", "prepare-gif.mjs");
const temporary = mkdtempSync(join(tmpdir(), "ui-evidence-test-"));

function has(binary, args = ["-version"]) {
  return spawnSync(binary, args, { stdio: "ignore" }).status === 0;
}

function run(binary, args) {
  return execFileSync(binary, args, {
    cwd: repo,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

try {
  assert.match(run(process.execPath, [pointer, "--help"]), /synthetic pointer/);
  const missingSession = spawnSync(process.execPath, [pointer, "status"], {
    cwd: repo,
    encoding: "utf8",
  });
  assert.notEqual(missingSession.status, 0);
  assert.match(missingSession.stderr, /--session is required/);

  const hasMontage = has("magick") || has("montage");
  if (!has("ffmpeg") || !has("ffprobe") || !hasMontage) {
    console.log("UI evidence GIF smoke skipped: FFmpeg, ffprobe, or ImageMagick montage is unavailable.");
    rmSync(temporary, { recursive: true, force: true });
    process.exit(0);
  }

  const source = join(temporary, "source.webm");
  run("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi",
    "-i", "testsrc2=size=640x360:rate=8:duration=1.5",
    "-c:v", "libvpx",
    "-pix_fmt", "yuv420p",
    source,
  ]);

  const spec = join(temporary, "motion.json");
  writeFileSync(spec, JSON.stringify({
    input: "source.webm",
    trim: { start: 0.125, end: 1.375 },
    crop: { x: 16, y: 12, width: 608, height: 336 },
    redactions: [{ at: [32, 28, 80, 32], color: "#111827" }],
    profile: { maxWidth: 608, fps: 8 },
  }));

  const gif = join(temporary, "evidence.gif");
  const review = join(temporary, "review.png");
  const result = JSON.parse(run(process.execPath, [
    prepare,
    "--spec", spec,
    "--out", gif,
    "--review-out", review,
  ]));

  assert.equal(result.redactions, 1);
  assert.equal(result.selectedProfile.width, 608);
  assert.equal(result.selectedProfile.fps, 8);
  assert.deepEqual(result.reviewTimes, [...result.reviewTimes].sort((a, b) => a - b));
  assert.ok(existsSync(gif));
  assert.ok(existsSync(review));
  assert.match(readFileSync(gif).subarray(0, 6).toString("ascii"), /^GIF8[79]a$/);
  assert.deepEqual([...readFileSync(review).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(statSync(gif).size < 10 * 1024 * 1024);

  writeFileSync(spec, JSON.stringify({
    input: "source.webm",
    trim: { start: 0, end: 1.5 },
    holds: { start: 0, end: 0 },
    limits: { maxDuration: 1 },
  }));
  const tooLong = spawnSync(process.execPath, [
    prepare,
    "--spec", spec,
    "--out", gif,
    "--review-out", review,
  ], { cwd: repo, encoding: "utf8" });
  assert.notEqual(tooLong.status, 0);
  assert.match(tooLong.stderr, /prepared duration would be/);

  const oneFrame = join(temporary, "one-frame.webm");
  run("ffmpeg", [
    "-y", "-v", "error",
    "-f", "lavfi",
    "-i", "color=size=320x180:rate=10:duration=0.1",
    "-frames:v", "1",
    "-c:v", "libvpx",
    oneFrame,
  ]);
  writeFileSync(spec, JSON.stringify({ input: "one-frame.webm" }));
  const collapsed = spawnSync(process.execPath, [
    prepare,
    "--spec", spec,
    "--out", gif,
    "--review-out", review,
  ], { cwd: repo, encoding: "utf8" });
  assert.notEqual(collapsed.status, 0);
  assert.match(collapsed.stderr, /source has only 1 frame/);

  console.log("UI evidence GIF behavior passed.");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
