#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prepare = join(repo, "skills", "ui-evidence", "scripts", "prepare-motion.mjs");
const legacy = join(repo, "skills", "ui-evidence", "scripts", "prepare-gif.mjs");
const temporary = mkdtempSync(join(tmpdir(), "ui-evidence-test-"));

function has(binary) {
  return spawnSync(binary, ["-version"], { stdio: "ignore" }).status === 0;
}

function run(binary, args, options = {}) {
  return execFileSync(binary, args, {
    cwd: options.cwd ?? repo,
    encoding: options.binary ? null : "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

function pixel(path, time) {
  return [...run("ffmpeg", [
    "-v", "error", "-ss", String(time), "-i", path, "-frames:v", "1",
    "-vf", "scale=1:1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
  ], { binary: true })];
}

function pixelAt(path, x, y) {
  return [...run("ffmpeg", ["-v", "error", "-i", path, "-frames:v", "1",
    "-vf", `crop=1:1:${x}:${y}:exact=1,format=rgb24`, "-f", "rawvideo", "pipe:1"], { binary: true })];
}

function framePixel(path, index) {
  return [...run("ffmpeg", ["-v", "error", "-i", path,
    "-vf", `select=eq(n\\,${index}),scale=1:1`, "-frames:v", "1", "-pix_fmt", "rgb24",
    "-f", "rawvideo", "pipe:1"], { binary: true })];
}

function assertColor(actual, expected) {
  assert.equal(actual.length, 3, "a decoded frame must exist");
  for (let index = 0; index < 3; index += 1) {
    assert.ok(Math.abs(actual[index] - expected[index]) < 35, `expected ${expected}, got ${actual}`);
  }
}

function assertNoGreen(path) {
  const rgb = run("ffmpeg", ["-v", "error", "-i", path, "-pix_fmt", "rgb24",
    "-f", "rawvideo", "pipe:1"], { binary: true });
  assert.ok(rgb.length > 0);
  for (let index = 0; index < rgb.length; index += 3) {
    assert.ok(!(rgb[index + 1] > 150 && rgb[index + 1] > rgb[index] * 2 && rgb[index + 1] > rgb[index + 2] * 2),
      `unredacted green pixel in ${path}`);
  }
}

function failure(args, pattern) {
  const result = spawnSync(process.execPath, [prepare, ...args], { cwd: repo, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, pattern);
}

try {
  const help = run(process.execPath, [prepare, "--help"]);
  assert.match(help, /--inspect/);
  assert.match(help, /--preview-out/);
  assert.match(run(process.execPath, [legacy, "--help"]), /--inspect/);
  const helpWithoutTools = spawnSync(process.execPath, [prepare, "--help"], {
    cwd: repo, encoding: "utf8", env: { ...process.env, PATH: "" },
  });
  assert.equal(helpWithoutTools.status, 0);
  const dependencyPreload = join(temporary, "dependency-preload.mjs");
  writeFileSync(dependencyPreload, `
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const realExecFileSync = childProcess.execFileSync;
    childProcess.execFileSync = (binary, args, options) => {
      if (binary === "ffmpeg" && args[0] === "-version") {
        const error = new Error("simulated dependency failure");
        if (process.env.UI_EVIDENCE_FAKE_DEPENDENCY === "NONZERO") error.status = 73;
        else error.code = process.env.UI_EVIDENCE_FAKE_DEPENDENCY;
        throw error;
      }
      return realExecFileSync(binary, args, options);
    };
    syncBuiltinESMExports();
  `);
  for (const [condition, expected] of [["ENOENT", /ffmpeg not found/], ["EACCES", /could not run ffmpeg.*EACCES/],
    ["EPERM", /could not run ffmpeg.*EPERM/], ["NONZERO", /could not run ffmpeg.*exit 73/]]) {
    const dependency = spawnSync(process.execPath, [prepare, "--spec", "spec.json", "--out", "out.mp4",
      "--review-out", "review.png"], {
      cwd: repo, encoding: "utf8", env: { ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(dependencyPreload).href}`.trim(),
        UI_EVIDENCE_FAKE_DEPENDENCY: condition },
    });
    assert.notEqual(dependency.status, 0);
    assert.match(dependency.stderr, expected);
    if (condition !== "ENOENT") assert.doesNotMatch(dependency.stderr, /not found|install|preflight/i);
  }
  const montagePreload = join(temporary, "montage-preload.mjs");
  writeFileSync(montagePreload, `
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const realExecFileSync = childProcess.execFileSync;
    function rejectProbe(condition) {
      const error = new Error("simulated montage probe failure");
      if (condition === "NONZERO") error.status = 73;
      else error.code = condition;
      throw error;
    }
    childProcess.execFileSync = (binary, args, options) => {
      if (binary === "magick" && args[0] === "-version") return "";
      if (binary === "magick" && args[0] === "montage") rejectProbe(process.env.UI_EVIDENCE_FAKE_MAGICK);
      if (binary === "montage" && args[0] === "-version" && process.env.UI_EVIDENCE_FAKE_MONTAGE) {
        rejectProbe(process.env.UI_EVIDENCE_FAKE_MONTAGE);
      }
      if (process.env.UI_EVIDENCE_STUB_MEDIA === "1") {
        if ((binary === "ffmpeg" || binary === "ffprobe") && args[0] === "-version") return "";
        if (binary === "ffprobe" && args.includes("-count_frames")) {
          return JSON.stringify({ streams: [{ width: 2, height: 2, nb_read_frames: "1" }],
            format: { duration: "1", size: "1", start_time: "0" } });
        }
        if (binary === "ffprobe") {
          return JSON.stringify({ frames: [{ best_effort_timestamp_time: "0", duration_time: "1" }] });
        }
      }
      return realExecFileSync(binary, args, options);
    };
    syncBuiltinESMExports();
  `);
  const fakeRaw = join(temporary, "fake-source.webm");
  writeFileSync(fakeRaw, "x");
  for (const [magick, montage, expected] of [["NONZERO", "ENOENT", /could not run magick.*exit 73/],
    ["EACCES", "EPERM", /could not run magick.*EACCES/], ["ENOENT", "EACCES", /could not run montage.*EACCES/],
    ["ENOENT", "ENOENT", /ImageMagick montage not found/]]) {
    const noMontage = spawnSync(process.execPath, [prepare, "--inspect", fakeRaw,
      "--review-out", join(temporary, "fake-review.png")], {
      cwd: repo, encoding: "utf8", env: { ...process.env,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(montagePreload).href}`.trim(),
        UI_EVIDENCE_FAKE_MAGICK: magick, UI_EVIDENCE_FAKE_MONTAGE: montage, UI_EVIDENCE_STUB_MEDIA: "1" },
    });
    assert.notEqual(noMontage.status, 0);
    assert.match(noMontage.stderr, expected);
    if (magick !== "ENOENT" || montage !== "ENOENT") assert.doesNotMatch(noMontage.stderr, /not found|install|preflight/i);
  }
  failure(["--unknown"], /unknown option/);
  failure(["--spec", "--out", "x.mp4", "--review-out", "x.png"], /--spec requires a value/);
  failure(["--inspect", "raw.webm", "--spec", "spec.json", "--review-out", "x.png"], /cannot.*--inspect|--inspect.*cannot/);
  failure(["--inspect", "raw.webm"], /--review-out is required/);
  failure(["--spec", "spec.json", "--out", "x.mov", "--review-out", "x.png"], /\.mp4.*\.gif/);
  failure(["--inspect", "raw.webm", "--review-out", "x.jpg"], /\.png/);
  failure(["--inspect", "raw.webm", "--review-out", "x.png", "--preview-out", "x.txt"], /\.html/);
  const toolsAvailable = has("ffmpeg") && has("ffprobe") && (has("magick") || has("montage"));
  const encoders = toolsAvailable ? run("ffmpeg", ["-hide_banner", "-encoders"]) : "";
  const mediaAvailable = toolsAvailable && /\blibx264\b/.test(encoders) && /\blibvpx\b/.test(encoders) && /\blibopus\b/.test(encoders);
  if (!mediaAvailable) {
    if (process.env.UI_EVIDENCE_REQUIRE_MEDIA === "1") throw new Error("UI evidence media tools are required");
    console.log("UI evidence encoding tests skipped: FFmpeg, ffprobe, ImageMagick montage, or a required test encoder is unavailable.");
  } else {
    for (const [name, rgb] of [["red", [255, 0, 0]], ["green", [0, 255, 0]], ["blue", [0, 0, 255]]]) {
      const header = Buffer.from("P6\n64 64\n255\n");
      const data = Buffer.alloc(64 * 64 * 3);
      for (let index = 0; index < data.length; index += 3) Buffer.from(rgb).copy(data, index);
      writeFileSync(join(temporary, `${name}.ppm`), Buffer.concat([header, data]));
    }
    writeFileSync(join(temporary, "list.txt"),
      "file 'red.ppm'\nduration 0.3\nfile 'green.ppm'\nduration 2.5\nfile 'blue.ppm'\nduration 0.2\nfile 'blue.ppm'\n");
    run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", "list.txt",
      "-vsync", "vfr", "-c:v", "libvpx", "-pix_fmt", "yuv420p", "sparse.webm"], { cwd: temporary });
    if (has("montage")) {
      for (const condition of ["NONZERO", "EACCES"]) {
        const fallbackReview = join(temporary, `fallback-${condition}.png`);
        const fallback = spawnSync(process.execPath, [prepare, "--inspect", join(temporary, "sparse.webm"),
          "--review-out", fallbackReview], { cwd: repo, encoding: "utf8", env: { ...process.env,
          NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --import=${pathToFileURL(montagePreload).href}`.trim(),
          UI_EVIDENCE_FAKE_MAGICK: condition } });
        assert.equal(fallback.status, 0, fallback.stderr);
        assert.ok(existsSync(fallbackReview), "working standalone montage must produce a review sheet");
      }
    }
    const spec = join(temporary, "motion.json");
    writeFileSync(spec, JSON.stringify({
      input: "sparse.webm", trim: { start: 0.1, end: 2.9 },
      holds: { start: 0.5, end: 0.5 }, profile: { fps: 10 },
    }));
    const output = join(temporary, "sparse.gif");
    const report = JSON.parse(run(process.execPath, [prepare, "--spec", spec, "--out", output,
      "--review-out", join(temporary, "review.png")]));
    assert.ok(Math.abs(report.prepared.duration - 3.8) < 0.12, `duration was ${report.prepared.duration}`);
    assertColor(pixel(output, 0.2), [255, 0, 0]);
    assertColor(pixel(output, 1.8), [0, 255, 0]);
    assertColor(pixel(output, 3.6), [0, 0, 255]);
    writeFileSync(join(temporary, "boundary-list.txt"),
      "file 'red.ppm'\nduration 0.28\nfile 'green.ppm'\nduration 1\nfile 'blue.ppm'\nduration 0.28\nfile 'blue.ppm'\n");
    run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", "boundary-list.txt",
      "-vsync", "vfr", "-c:v", "libvpx", "-pix_fmt", "yuv420p", "boundary.webm"], { cwd: temporary });
    for (const [extension, fps, start] of [["mp4", 30, 0.265], ["gif", 12, 0.24]]) {
      const boundaryOut = join(temporary, `boundary.${extension}`);
      writeFileSync(spec, JSON.stringify({ input: "boundary.webm", trim: { start, end: 1.4 },
        holds: { start: 0.5, end: 0.5 }, profile: { fps }, review: { interval: 2 } }));
      const boundaryReport = JSON.parse(run(process.execPath, [prepare, "--spec", spec, "--out", boundaryOut,
        "--review-out", join(temporary, "boundary.png")]));
      assert.ok(Math.abs(boundaryReport.prepared.duration - (1.4 - start + 1)) < 2 / fps);
      assertColor(pixel(boundaryOut, 0.1), [255, 0, 0]);
      assertColor(pixel(boundaryOut, 0.7), [0, 255, 0]);
      assertColor(pixel(boundaryOut, boundaryReport.prepared.duration - 0.2), [0, 0, 255]);

      writeFileSync(spec, JSON.stringify({ input: "boundary.webm", trim: { start: 0, end: 0.281 },
        holds: { start: 0.5, end: 0.5 }, profile: { fps }, review: { interval: 2 } }));
      const shortReport = JSON.parse(run(process.execPath, [prepare, "--spec", spec, "--out", boundaryOut,
        "--review-out", join(temporary, "boundary.png")]));
      assertColor(pixel(boundaryOut, 0.1), [255, 0, 0]);
      assertColor(pixel(boundaryOut, shortReport.prepared.duration - 0.2), [0, 255, 0]);

      writeFileSync(spec, JSON.stringify({ input: "boundary.webm", trim: { start: 0, end: 0.281 },
        holds: { start: 0, end: 0 }, profile: { fps }, review: { interval: 2 } }));
      const noHoldReport = JSON.parse(run(process.execPath, [prepare, "--spec", spec, "--out", boundaryOut,
        "--review-out", join(temporary, "boundary.png")]));
      assertColor(framePixel(boundaryOut, 0), [255, 0, 0]);
      assertColor(framePixel(boundaryOut, noHoldReport.prepared.frames - 1), [0, 255, 0]);
      assert.ok(Math.abs(noHoldReport.prepared.duration - 0.281) < 1 / fps);

      writeFileSync(spec, JSON.stringify({ input: "boundary.webm", trim: { start, end: 1.4 },
        holds: { start: 0, end: 0 }, profile: { fps }, review: { interval: 2 } }));
      const noHoldBoundary = JSON.parse(run(process.execPath, [prepare, "--spec", spec, "--out", boundaryOut,
        "--review-out", join(temporary, "boundary.png")]));
      assertColor(framePixel(boundaryOut, 0), [255, 0, 0]);
      assertColor(framePixel(boundaryOut, noHoldBoundary.prepared.frames - 1), [0, 0, 255]);

      writeFileSync(spec, JSON.stringify({ input: "boundary.webm", trim: { start: 0.28, end: 1.4 },
        holds: { start: 0, end: 0 }, profile: { fps }, review: { interval: 2 } }));
      run(process.execPath, [prepare, "--spec", spec, "--out", boundaryOut,
        "--review-out", join(temporary, "boundary.png")]);
      assertColor(framePixel(boundaryOut, 0), [0, 255, 0]);
      writeFileSync(spec, JSON.stringify({ input: "boundary.webm", trim: { start: 0, end: 0.28 },
        holds: { start: 0, end: 0 }, profile: { fps }, review: { interval: 2 } }));
      const exclusiveEnd = JSON.parse(run(process.execPath, [prepare, "--spec", spec, "--out", boundaryOut,
        "--review-out", join(temporary, "boundary.png")]));
      assertColor(framePixel(boundaryOut, exclusiveEnd.prepared.frames - 1), [255, 0, 0]);

      writeFileSync(spec, JSON.stringify({ input: "boundary.webm", trim: { start: 0, end: 1.4 },
        holds: { start: 0, end: 0 }, profile: { fps }, review: { interval: 2 } }));
      run(process.execPath, [prepare, "--spec", spec, "--out", boundaryOut,
        "--review-out", join(temporary, "boundary.png")]);
      assertColor(framePixel(boundaryOut, Math.floor(0.28 * fps)), [255, 0, 0]);
      assertColor(framePixel(boundaryOut, Math.ceil(0.28 * fps)), [0, 255, 0]);

      writeFileSync(spec, JSON.stringify({ input: "boundary.webm", trim: { start, end: 0.29 },
        holds: { start: 0, end: 0 }, profile: { fps } }));
      failure(["--spec", spec, "--out", join(temporary, `unrepresentable.${extension}`),
        "--review-out", join(temporary, "boundary.png")], /too short|distinct boundary states/);
    }
    run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
      "-itsoffset", "0.4", "-i", "boundary.webm", "-map", "1:v:0", "-map", "0:a:0",
      "-c:v", "copy", "-c:a", "libopus", "-shortest", "offset-video.webm"], { cwd: temporary });
    writeFileSync(spec, JSON.stringify({ input: "offset-video.webm", holds: { start: 0, end: 0 },
      review: { interval: 2 } }));
    const offsetOut = join(temporary, "offset.mp4");
    const offsetReport = JSON.parse(run(process.execPath, [prepare, "--spec", spec, "--out", offsetOut,
      "--review-out", join(temporary, "offset.png")]));
    assert.ok(Math.abs(offsetReport.prepared.duration - 1.6) < 0.04);
    assertColor(framePixel(offsetOut, 0), [255, 0, 0]);
    assertColor(framePixel(offsetOut, 9), [0, 255, 0]);
    assertColor(framePixel(offsetOut, offsetReport.prepared.frames - 1), [0, 0, 255]);
    assert.equal(JSON.parse(run("ffprobe", ["-v", "error", "-show_streams", "-of", "json", offsetOut])).streams.length, 1);
    run("ffmpeg", ["-y", "-v", "error", "-i", "sparse.webm", "-f", "lavfi", "-i",
      "sine=frequency=440:duration=3.04", "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "copy", "-c:a", "libopus", "-shortest", "with-audio.webm"], { cwd: temporary });
    writeFileSync(spec, JSON.stringify({
      input: "with-audio.webm", trim: { start: 1, end: 2 }, holds: { start: 0.5, end: 0.5 },
    }));
    const mp4 = join(temporary, "held.mp4");
    const mp4Report = JSON.parse(run(process.execPath, [prepare, "--spec", spec, "--out", mp4,
      "--review-out", join(temporary, "held-review.png")]));
    const media = JSON.parse(run("ffprobe", ["-v", "error", "-show_streams", "-of", "json", mp4]));
    assert.equal(media.streams.length, 1, "prepared MP4 must not contain source audio");
    assert.equal(media.streams[0].codec_name, "h264");
    assert.equal(media.streams[0].pix_fmt, "yuv420p");
    assert.equal(media.streams[0].avg_frame_rate, "30/1");
    assert.ok(Math.abs(mp4Report.prepared.duration - 2) < 0.06);
    assertColor(pixel(mp4, 0.1), [0, 255, 0]);
    assertColor(pixel(mp4, 1.8), [0, 255, 0]);
    writeFileSync(spec, JSON.stringify({ input: "with-audio.webm", trim: { start: 1, end: 2 },
      holds: { start: 0.5, end: 0.5 }, profile: { maxBytes: mp4Report.prepared.size } }));
    failure(["--spec", spec, "--out", join(temporary, "exact-ceiling.mp4"),
      "--review-out", join(temporary, "held-review.png")], /at or above.*limit/);
    writeFileSync(spec, JSON.stringify({ input: "sparse.webm", trim: { start: 1, end: 2 },
      holds: { start: 0.5, end: 0.5 }, profile: { fps: 10 } }));
    const heldGif = join(temporary, "held.gif");
    const heldReport = JSON.parse(run(process.execPath, [legacy, "--spec", spec, "--out", heldGif,
      "--review-out", join(temporary, "held-gif-review.png")]));
    assert.ok(Math.abs(heldReport.prepared.duration - 2) < 0.06);
    assertColor(pixel(heldGif, 0.1), [0, 255, 0]);
    assertColor(pixel(heldGif, 1.8), [0, 255, 0]);
    writeFileSync(join(temporary, "end-list.txt"),
      "file 'red.ppm'\nduration 0.8\nfile 'blue.ppm'\nduration 0.2\nfile 'blue.ppm'\n");
    run("ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", "end-list.txt",
      "-vsync", "vfr", "-c:v", "libvpx", "end.webm"], { cwd: temporary });
    writeFileSync(spec, JSON.stringify({ input: "end.webm", trim: { start: 0, end: 1 },
      holds: { start: 0, end: 0 }, profile: { fps: 10 }, review: { interval: 2 } }));
    const endSheet = join(temporary, "end-sheet.png");
    run(process.execPath, [prepare, "--spec", spec, "--out", join(temporary, "end.gif"), "--review-out", endSheet]);
    const endDimensions = JSON.parse(run("ffprobe", ["-v", "error", "-show_streams", "-of", "json", endSheet])).streams[0];
    assertColor(pixelAt(endSheet, Math.floor(endDimensions.width * 3 / 8), Math.floor(endDimensions.height / 2)), [0, 0, 255]);
    const rawReview = join(temporary, "raw review.png");
    const rawPreview = join(temporary, "raw preview.html");
    const rawReport = JSON.parse(run(process.execPath, [prepare, "--inspect", join(temporary, "sparse.webm"),
      "--review-out", rawReview, "--preview-out", rawPreview]));
    assert.equal(rawReport.source.frames, 4);
    assert.equal(rawReport.reviewOut, rawReview);
    assert.equal(rawReport.previewOut, rawPreview);
    assert.ok(existsSync(rawReview));
    const rawHtml = readFileSync(rawPreview, "utf8");
    assert.match(rawHtml, /<video[^>]*controls/);
    assert.ok(rawHtml.includes(pathToFileURL(join(temporary, "sparse.webm")).href));
    assert.match(rawHtml, /raw/i);
    const rawSheet = JSON.parse(run("ffprobe", ["-v", "error", "-show_streams", "-of", "json", rawReview])).streams[0];
    assertColor(pixelAt(rawReview, Math.floor(rawSheet.width * 3 / 8), Math.floor(rawSheet.height / 4)), [0, 255, 0]);
    assertColor(pixelAt(rawReview, Math.floor(rawSheet.width * 5 / 8), Math.floor(rawSheet.height * 3 / 4)), [0, 0, 255]);
    run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=red:size=320x180:rate=10:duration=1",
      "-vf", "drawbox=x=90:y=70:w=80:h=40:color=lime:t=fill", "-c:v", "libvpx", "private.webm"], { cwd: temporary });
    const privacy = {
      input: "private.webm", crop: { x: 20, y: 20, width: 280, height: 140 },
      redactions: [{ at: [80, 60, 100, 60], color: "#000000" }],
      holds: { start: 0, end: 0 }, review: { interval: 1 }, limits: { maxDuration: 30 },
      profile: { maxBytes: 100_000_000, targetBytes: 1 },
    };
    writeFileSync(spec, JSON.stringify(privacy));
    for (const extension of ["mp4", "gif"]) {
      const sanitized = join(temporary, `sanitized.${extension}`);
      const sheet = join(temporary, `sanitized-${extension}.png`);
      const result = JSON.parse(run(process.execPath, [prepare, "--spec", spec, "--out", sanitized, "--review-out", sheet]));
      assert.equal(result.prepared.width, 280);
      assert.equal(result.prepared.height, 140);
      assert.equal(result.selectedProfile.maxBytes, 100_000_000);
      assert.ok(result.warnings.some((warning) => /above.*target/.test(warning)));
      assertNoGreen(sanitized);
      assertNoGreen(sheet);
    }
    writeFileSync(spec, JSON.stringify({ ...privacy, crop: { x: 21, y: 20, width: 280, height: 140 },
      redactions: [{ at: [90, 70, 80, 40], color: "#000000" }] }));
    const oddCrop = join(temporary, "odd-crop.gif");
    run(process.execPath, [prepare, "--spec", spec, "--out", oddCrop, "--review-out", rawReview]);
    assertNoGreen(oddCrop);
    assertNoGreen(rawReview);
    writeFileSync(spec, JSON.stringify({ ...privacy, redactions: [{ at: [80, 60, 100, 60], color: "#00000080" }] }));
    failure(["--spec", spec, "--out", join(temporary, "invalid.mp4"), "--review-out", rawReview], /opaque/);
    writeFileSync(spec, JSON.stringify({ input: "private.webm", holds: { start: 0, end: 0 }, profile: { maxBytes: 1 } }));
    const oversized = join(temporary, "oversized.mp4");
    failure(["--spec", spec, "--out", oversized, "--review-out", rawReview], /above.*limit/);
    assert.ok(!existsSync(oversized), "a size failure must not leave a publishable output");
    writeFileSync(spec, JSON.stringify({ input: "private.webm", holds: { start: 0, end: 0 }, limits: { maxDuration: 0.8 } }));
    failure(["--spec", spec, "--out", oversized, "--review-out", rawReview], /prepared duration would be/);
    writeFileSync(spec, JSON.stringify({ input: "private.webm", profile: { maxBytes: 100_000_001 } }));
    failure(["--spec", spec, "--out", oversized, "--review-out", rawReview], /profile\.maxBytes/);
    writeFileSync(spec, JSON.stringify({ input: "private.webm", trim: "unexpected" }));
    failure(["--spec", spec, "--out", oversized, "--review-out", rawReview], /trim must be an object/);
    writeFileSync(spec, JSON.stringify({ input: "private.webm", profile: { fps: null } }));
    failure(["--spec", spec, "--out", oversized, "--review-out", rawReview], /profile\.fps/);
    writeFileSync(spec, "null");
    failure(["--spec", spec, "--out", oversized, "--review-out", rawReview], /spec must be an object/);
    run("ffmpeg", ["-y", "-v", "error", "-i", "sparse.webm", "-f", "lavfi", "-i",
      "sine=frequency=440:duration=5", "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "libopus",
      "long-audio.webm"], { cwd: temporary });
    writeFileSync(spec, JSON.stringify({ input: "long-audio.webm", trim: { start: 1, end: 4.5 }, holds: { start: 0, end: 0 } }));
    failure(["--spec", spec, "--out", oversized, "--review-out", rawReview], /duration.*mismatch/i);
    assert.ok(!existsSync(oversized), "a duration mismatch must not leave a publishable output");
    run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=blue:size=32x32:rate=5:duration=21",
      "-c:v", "libvpx", "long.webm"], { cwd: temporary });
    writeFileSync(spec, JSON.stringify({ input: "long.webm", holds: { start: 0, end: 0 }, review: { interval: 2 } }));
    const longReport = JSON.parse(run(process.execPath, [prepare, "--spec", spec, "--out", join(temporary, "long.mp4"),
      "--review-out", rawReview]));
    assert.ok(Math.abs(longReport.prepared.duration - 21) < 0.07);
    assert.ok(longReport.warnings.some((warning) => /long|20 seconds/i.test(warning)));
    run("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=red:size=1280x720:rate=5:duration=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "source & #.mp4"], { cwd: temporary });
    const specialInput = join(temporary, "source & #.mp4");
    const specialOutput = join(temporary, "result & #.mp4");
    const preview = join(temporary, "preview.html");
    const provenance = { capture: "fixture", reference: "example" };
    writeFileSync(spec, JSON.stringify({ input: "source & #.mp4", holds: { start: 0, end: 0 },
      profile: { fps: 60 }, provenance }));
    const largeReport = JSON.parse(run(process.execPath, [prepare, "--spec", spec, "--out", specialOutput,
      "--review-out", rawReview, "--preview-out", preview]));
    const largeStream = JSON.parse(run("ffprobe", ["-v", "error", "-show_streams", "-of", "json", specialOutput])).streams[0];
    assert.equal(largeStream.width, 1280);
    assert.equal(largeStream.height, 720);
    assert.equal(largeStream.avg_frame_rate, "60/1");
    assert.equal(largeReport.selectedProfile.maxBytes, 9_500_000);
    assert.deepEqual(largeReport.provenance, provenance);
    const videoBytes = readFileSync(specialOutput);
    assert.ok(videoBytes.indexOf("moov") > 0 && videoBytes.indexOf("moov") < videoBytes.indexOf("mdat"), "MP4 must support fast start");
    const html = readFileSync(preview, "utf8");
    assert.equal((html.match(/<video[^>]*controls/g) ?? []).length, 2);
    for (const path of [specialInput, specialOutput]) {
      assert.ok(html.includes(pathToFileURL(path).href.replaceAll("&", "&amp;")));
    }
    assert.ok(!html.includes("source & #.mp4"));
    const before = readFileSync(specialInput);
    failure(["--spec", spec, "--out", specialInput, "--review-out", rawReview], /same|distinct|overwrit/i);
    assert.deepEqual(readFileSync(specialInput), before, "the source must not be overwritten");
    console.log("UI evidence motion behavior passed.");
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
