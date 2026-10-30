#!/usr/bin/env node
// Timed recording annotations and storyboards: pure planning, then decoded
// output frames from real FFmpeg and ImageMagick runs.

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import {
  AnnotationError, formatTime, layoutCaptions, layoutStoryboard, mapInstant, mapInterval, motionMarkdown, outputSize, outputTimeline, planEvents,
  planStoryboard, toOutput, usesCaptionArea,
} from "../skills/ui-evidence/scripts/motion-annotations.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const prepare = join(repo, "skills", "ui-evidence", "scripts", "prepare-motion.mjs");
const temp = mkdtempSync(join(tmpdir(), "ui-evidence-motion-annotations-test-"));
after(() => rmSync(temp, { recursive: true, force: true }));

// fps 10, trim 1.0-3.0, 0.5 s holds: frames 0-4 start hold, 5-24 real time
// (ticks 10-29), 25-29 end hold.
const timeline = outputTimeline({ trim: { start: 1, end: 3 }, fps: 10, startTick: 10, endTick: 30, startFrames: 5, endFrames: 5 });
const crop = { x: 0, y: 0, width: 320, height: 180, sourceWidth: 320, sourceHeight: 180 };
const size = outputSize(crop, 320);
const plan = (events, extra = {}) => planEvents({ events, ...extra }, { source: { duration: 4 }, crop, size, timeline });

test("source intervals map to output frames through trim and presentation holds", () => {
  assert.deepEqual(timeline.segments.map((segment) => [segment.kind, segment.frames, segment.source]), [
    ["presentation-hold", [0, 4], 1], ["real-time", [5, 24], [1, 3]], ["presentation-hold", [25, 29], 3],
  ]);
  assert.deepEqual(mapInterval(1.5, 2, timeline).frames, [10, 14]);
  assert.deepEqual(mapInterval(1.5, 2, timeline).output, { start: 1, end: 1.5 });
  const early = mapInterval(0.5, 1.5, timeline);
  assert.deepEqual(early.frames, [0, 9], "an event active at trim.start covers the start hold");
  assert.deepEqual(early.clipped, { start: true, end: false });
  assert.deepEqual(early.holds, { start: true, end: false });
  const late = mapInterval(2.5, 9, timeline);
  assert.deepEqual(late.frames, [20, 29], "an event still active at trim.end covers the end hold");
  assert.deepEqual(late.clipped, { start: false, end: true });
  assert.equal(mapInterval(2.5, 2.99, timeline).frames[1], 24, "ending before trim.end leaves the end hold clear");
  assert.equal(mapInterval(0.1, 0.9, timeline), null);
  assert.equal(mapInterval(1.51, 1.55, timeline), null, "shorter than one frame between ticks");
  const noHold = outputTimeline({ trim: { start: 1, end: 3 }, fps: 10, startTick: 10, endTick: 30, startFrames: 0, endFrames: 0 });
  assert.deepEqual(mapInterval(0, 1.2, noHold).frames, [0, 1]);
  assert.equal(noHold.segments.length, 1);
  assert.deepEqual(mapInstant(1, timeline), { frame: 5, output: 0.5 });
  assert.deepEqual(mapInstant(2.05, timeline), { frame: 15, output: 1.5 });
  assert.deepEqual(mapInstant(3, timeline), { frame: 24, output: 2.4 });
  assert.equal(mapInstant(3.2, timeline), null);
});

test("clip times round to tenths before splitting minutes", () => {
  assert.deepEqual([0, 0.04, 9.96, 59.94, 59.97, 61.25, 600].map(formatTime),
    ["0:00.0", "0:00.0", "0:10.0", "0:59.9", "1:00.0", "1:01.3", "10:00.0"]);
});

test("geometry maps through crop and scale and is validated against the source and crop", () => {
  const cropped = { x: 40, y: 20, width: 240, height: 140, sourceWidth: 320, sourceHeight: 180 };
  const scaled = outputSize(cropped, 120);
  assert.deepEqual(scaled, { width: 120, height: 70 });
  assert.deepEqual(toOutput([100, 60, 40, 30], cropped, scaled, "at"), { x: 30, y: 20, width: 20, height: 15, clipped: false });
  assert.equal(toOutput([20, 10, 60, 40], cropped, scaled, "at").clipped, true);
  assert.deepEqual(outputSize({ width: 281, height: 141 }, 1000), { width: 280, height: 140 });
  for (const [at, pattern] of [[[0, 0, 10, 10], /outside the crop/], [[300, 170, 40, 20], /exceeds the 320x180 source/],
    [[1.5, 0, 10, 10], /whole source pixels/], [[50, 50, 0, 10], /positive size/], [[50, 50, 10], /x, y, width, height/]]) {
    assert.throws(() => toOutput(at, cropped, scaled, "at"), pattern);
  }
});

test("invalid intervals, fields, and overlapping captions fail with actionable errors", () => {
  const cases = [
    [[{ start: 2, end: 2, caption: "x" }], /not after its start/],
    [[{ start: 4.5, end: 5, caption: "x" }], /after the 4.000s source ends/],
    [[{ start: 0.1, end: 0.5, caption: "x" }], /shows on no output frame/],
    [[{ start: -1, end: 2, caption: "x" }], /0 or more/],
    [[{ start: "1", end: 2, caption: "x" }], /number of seconds/],
    [[{ start: 1, end: 2 }], /caption, a step, a key, or an "at" region/],
    [[{ start: 1, end: 2, step: 0 }], /step must be an integer/],
    [[{ start: 1, end: 2, key: "Control+" }], /joined by "\+"/],
    [[{ start: 1, end: 2, caption: "x", colour: "red" }], /unknown field "colour"/],
    [[{ start: 1, end: 2, caption: "x".repeat(161) }], /160 or fewer/],
    [[{ start: 1, end: 2, caption: "one" }, { start: 1.85, end: 2.5, key: "Enter" }], /both show a caption at output frame 14/],
  ];
  for (const [events, pattern] of cases) assert.throws(() => plan(events), (error) => error instanceof AnnotationError && pattern.test(error.message));
  assert.throws(() => plan([{ start: 1, end: 2, caption: "x" }], { captions: "side" }), /"below" or "overlay"/);
  assert.throws(() => planEvents({ events: [] }, { source: { duration: 4 }, crop, size, timeline }), /at least one event/);
  const marks = plan([{ start: 1, end: 2, at: [10, 10, 20, 20], step: 1 }, { start: 1.5, end: 2.5, at: [50, 50, 20, 20], step: 2 }]);
  assert.equal(marks.events.length, 2, "marks without captions may overlap");
  const text = plan([{ start: 1, end: 2, caption: "  Ünïcödé ✓ 100%\n<b>&amp;</b> 'q' : [x] , ; \\ @file  " }]);
  assert.equal(text.events[0].caption, "Ünïcödé ✓ 100% <b>&amp;</b> 'q' : [x] , ; \\ @file");
});

test("the caption band is even and sized for the tallest wrapped caption", () => {
  // Odd text heights must still give an even band for H.264.
  const measure = (text, pointsize, wrap) => ({ width: Math.min(text.length * 9, wrap ?? Infinity),
    height: 19 * Math.max(1, Math.ceil((text.length * 9) / (wrap ?? Infinity))) });
  const layout = layoutCaptions(plan([{ start: 1, end: 1.5, caption: "Short" },
    { start: 1.5, end: 2, step: 2, key: "Control+K", caption: "A longer caption that wraps onto a second line here" }]), size, measure);
  // The pin and keycaps narrow the second caption to three 19px lines: 57 + 16 = 73, rounded up to 74.
  assert.equal(layout.layouts.get(1).text.height, 57);
  assert.equal(layout.band, 74);
  assert.throws(() => layoutCaptions(plan([{ start: 1, end: 2, caption: "word ".repeat(31) }]), size, measure), /needs \d+ lines/);
});

test("every event is visible: steps without a control use the caption area, stepless marks use a neutral colour", () => {
  const events = plan([{ start: 1, end: 1.5, step: 1 }, { start: 1.5, end: 2, at: [10, 10, 20, 20] },
    { start: 2, end: 2.5, step: 2, at: [40, 40, 20, 20] }]).events;
  assert.deepEqual(events.map(usesCaptionArea), [true, false, false]);
  assert.equal(events[1].color, "#59636e");
  assert.equal(events[2].color, "#0969da");
  assert.throws(() => plan([{ start: 1, end: 2, step: 1 }, { start: 1.5, end: 2.5, caption: "x" }]), /both show a caption/);
  const measure = (value, pointsize, wrap) => ({ width: Math.min(value.length * 9, wrap ?? Infinity), height: 19 });
  const layout = layoutCaptions(plan([{ start: 1, end: 1.5, step: 1 }, { start: 2, end: 2.5, step: 2, at: [40, 40, 20, 20] }]), size, measure);
  assert.deepEqual(layout.layouts.get(0).items.map((item) => item.type), ["pin"]);
  assert.equal(layout.layouts.get(1).items.length, 0);
  assert.deepEqual(layout.layouts.get(1).marks.outline, { x: 36, y: 36, width: 28, height: 28 });
  assert.ok(layout.band > 0);
  const covered = plan([{ start: 1, end: 2, step: 1, caption: "Low control", at: [20, 150, 60, 20] }], { captions: "overlay" });
  assert.throws(() => layoutCaptions(covered, size, measure), /under the overlay caption area while a caption shows; use "captions": "below"/);
  const sequential = plan([{ start: 1, end: 1.5, step: 1, at: [20, 150, 60, 20] }, { start: 2, end: 2.5, caption: "Later" }], { captions: "overlay" });
  assert.doesNotThrow(() => layoutCaptions(sequential, size, measure), "an outline and a later caption do not overlap in time");
  const below = plan([{ start: 1, end: 2, step: 1, caption: "Low control", at: [20, 150, 60, 20] }]);
  assert.equal(layoutCaptions(below, size, measure).band, 42);
  // A key-only event must fit too; keycaps never wrap.
  const narrowCrop = { x: 0, y: 0, width: 160, height: 90, sourceWidth: 320, sourceHeight: 180 };
  const narrow = outputSize(narrowCrop, 160);
  const keys = (key) => planEvents({ events: [{ start: 1, end: 2, key }] }, { source: { duration: 4 }, crop: narrowCrop, size: narrow, timeline });
  assert.throws(() => layoutCaptions(keys("Control+Shift+Alt+PageDown"), narrow, measure), /does not fit in the 160px output/);
  assert.equal(layoutCaptions(keys("Enter"), narrow, measure).layouts.get(0).items.length, 1);
});

test("reading pauses freeze one frame, shift later frames, and are labelled presentation holds", () => {
  const paused = outputTimeline({ ...timeline, pauses: [{ tick: 15, frames: 10 }] });
  assert.deepEqual(paused.segments.map((segment) => [segment.kind, segment.frames, segment.source]), [
    ["presentation-hold", [0, 4], 1], ["real-time", [5, 10], [1, 1.6]], ["presentation-hold", [11, 20], 1.5],
    ["real-time", [21, 34], [1.6, 3]], ["presentation-hold", [35, 39], 3],
  ]);
  assert.equal(paused.segments[2].inserted, true);
  assert.deepEqual([paused.total, paused.pauseFrames, paused.lastRealFrame], [40, 10, 34]);
  assert.deepEqual(mapInterval(1.5, 2, paused).frames, [10, 24], "an event from the paused tick covers the pause");
  assert.deepEqual(mapInterval(1, 1.5, paused).frames, [0, 9], "an event ending at the paused tick does not");
  assert.deepEqual(mapInstant(2, paused), { frame: 25, output: 2.5 });

  const held = plan([{ start: 1.5, end: 2, step: 1, caption: "Read me", hold: 1 }, { start: 2.5, end: 9, caption: "Later" }]);
  assert.deepEqual(held.events.map((event) => event.frames), [[10, 24], [30, 39]]);
  assert.deepEqual(held.events[0].hold, { seconds: 1, tick: 15, frames: 10 });
  assert.equal(held.timeline.total, 40);
  for (const [events, pattern] of [
    [[{ start: 1.5, end: 2, caption: "x", hold: 0.1 }], /0\.2 to 10 seconds/],
    [[{ start: 0.5, end: 2, caption: "x", hold: 1 }], /start inside the trim/],
    [[{ start: 1.5, end: 1.8, caption: "x", hold: 1 }, { start: 1.5, end: 2, at: [10, 10, 10, 10], hold: 1 }], /both hold the same frame/],
  ]) assert.throws(() => plan(events), pattern);

  const measure = (value, pointsize, wrap) => ({ width: Math.min(value.length * 9, wrap ?? Infinity), height: 19 });
  const layout = layoutCaptions(held, size, measure);
  assert.deepEqual(layout.badge.ranges, [[11, 20]]);
  assert.equal(layout.badge.x + layout.badge.width, size.width - layout.pad);
  assert.ok(layout.layouts.get(0).text.width < size.width - layout.badge.width, "captions leave room for the badge");
  const markdown = motionMarkdown({ video: "clip.mp4", events: held.events });
  assert.match(markdown, /\(Step 1, paused 1s for reading\): Read me/);
  assert.match(markdown, /Frames marked "Paused for reading" are added presentation holds/);
});

test("storyboard checkpoints keep their order, labels, and resolved times", () => {
  const storyboard = planStoryboard({ checkpoints: [{ at: 1.2, label: "Before" }, { at: 2.6, label: "After" }] }, timeline, { duration: 4 });
  assert.deepEqual(storyboard.checkpoints.map((item) => [item.index, item.label, item.at, item.frame, item.output]),
    [[1, "Before", 1.2, 7, 0.7], [2, "After", 2.6, 21, 2.1]]);
  for (const [raw, pattern] of [
    [{ checkpoints: [{ at: 2, label: "b" }, { at: 1.5, label: "a" }] }, /must come after/],
    [{ checkpoints: [{ at: 0.2, label: "early" }] }, /outside the trim/],
    [{ checkpoints: [{ at: 2 }] }, /label must be non-empty/],
    [{ checkpoints: Array.from({ length: 9 }, (_, index) => ({ at: 1 + index * 0.1, label: "x" })) }, /1 to 8/],
    [{ checkpoints: [{ at: 2, label: "x" }], columns: 5 }, /columns/],
    [{ checkpoints: [{ at: 2, label: "x" }], columns: 4, displayWidth: 200 }, /leaves no room for labels at displayWidth 200; use at most 1 column,/],
  ]) assert.throws(() => planStoryboard(raw, timeline, { duration: 4 }), pattern);
  // Automatic columns never exceed what keeps labels readable, even for a tiny capture.
  const tiny = planStoryboard({ displayWidth: 200, checkpoints: [1.2, 1.6, 2, 2.4].map((at) => ({ at, label: "x" })) },
    timeline, { duration: 4 });
  const measure = (value, pointsize, wrap) => {
    assert.ok(wrap === undefined || wrap > 0, `label wrap width must be positive, got ${wrap}`);
    return { width: Math.min(value.length * 9, wrap ?? Infinity), height: 19 };
  };
  assert.equal(layoutStoryboard(tiny, { width: 32, height: 18 }, measure).columns, 1);
  assert.equal(layoutStoryboard({ ...tiny, displayWidth: 880, maxColumns: 4 }, { width: 32, height: 18 }, measure).columns, 4);
  const inherited = planStoryboard({ checkpoints: [{ at: 2, label: "x" }] }, timeline, { duration: 4 }, 600);
  assert.equal(inherited.displayWidth, 600, "the storyboard follows annotations.displayWidth");
  assert.equal(planStoryboard({ checkpoints: [{ at: 2, label: "x" }], displayWidth: 1000 }, timeline, { duration: 4 }, 600).displayWidth, 1000);
});

test("generated Markdown is publisher-compatible and keeps caption markup as text", () => {
  const events = plan([{ start: 1, end: 2, step: 1, caption: "Click ![x](leak.png) <img src=x>" }, { start: 2, end: 2.5, key: "Control+R" }]).events;
  const markdown = motionMarkdown({ title: "Clip", summary: "Selecting Yearly updates the price.", video: "clip.mp4", events,
    storyboard: { file: "storyboard.png", checkpoints: [{ index: 1, at: 1.2, output: 0.7, label: "Before [draft]" }] } });
  assert.match(markdown, /\n\n!\[\]\(clip\.mp4\)\n\n/);
  assert.match(markdown, /- \*\*0:00\.0-0:01\.5\*\* \(Step 1\): Click/, "an event from trim.start covers the start hold");
  assert.match(markdown, /\(Key Control\+R\)/);
  assert.equal((markdown.match(/!\[/g) ?? []).length, 2, "only the video and storyboard are media references");
  assert.doesNotMatch(markdown, /<img|!\[x\]/, "caption markup stays escaped text");
  assert.match(markdown, /!\[Storyboard of 1 moment from the clip: 1 Before \(draft\)\]\(storyboard\.png\)/);
  assert.match(markdown, /1\. \*\*0:00\.7\*\* \(source 1\.20s\): Before/);
  const spaced = motionMarkdown({ summary: "Clip with spaces.", video: "pub dir/my clip.mp4",
    storyboard: { file: "story (1).png", checkpoints: [{ index: 1, at: 1.2, output: 0.7, label: "One" }] } });
  assert.match(spaced, /\n!\[\]\(<pub dir\/my clip\.mp4>\)\n/);
  assert.match(spaced, /\]\(<story \(1\)\.png>\)/);
  const gif = motionMarkdown({ summary: "The menu opens.", video: "menu.gif" });
  assert.match(gif, /!\[Animated recording: The menu opens\.\]\(menu\.gif\)/);
});

const has = (binary, args = ["-version"]) => spawnSync(binary, args, { stdio: "ignore" }).status === 0;
const media = has("ffmpeg") && has("ffprobe") && (has("magick") || (has("convert") && has("montage")));
if (!media && process.env.UI_EVIDENCE_REQUIRE_MEDIA === "1") throw new Error("UI evidence media tools are required");
const skipMedia = media ? false : "FFmpeg, ffprobe, or ImageMagick is unavailable";

function ffmpeg(args, cwd = temp) {
  return execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { cwd, maxBuffer: 64 * 1024 * 1024 });
}

// RGB pixels of one decoded output frame.
function frame(path, index) {
  const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=width,height", "-of", "json", path], { encoding: "utf8" })).streams[0];
  const data = ffmpeg(["-i", path, "-vf", `select=eq(n\\,${index})`, "-frames:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]);
  const at = (x, y) => [...data.subarray((y * probe.width + x) * 3, (y * probe.width + x) * 3 + 3)];
  const count = (x0, y0, x1, y1, match) => {
    let total = 0;
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) if (match(at(x, y))) total += 1;
    return total;
  };
  return { width: probe.width, height: probe.height, at, count };
}

function png(path) {
  const info = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "json", path], { encoding: "utf8" });
  const { width, height } = JSON.parse(info).streams[0];
  const data = ffmpeg(["-i", path, "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]);
  return { width, height, at: (x, y) => [...data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)], data };
}

const bright = ([r, g, b]) => r > 200 && g > 200 && b > 200;
const reddish = ([r, g, b]) => r > g + 60 && r > b + 40;

function source(name, segments, extra = []) {
  const inputs = segments.flatMap(([colour, duration]) => ["-f", "lavfi", "-i", `color=c=${colour}:s=320x180:r=10:d=${duration}`]);
  const out = join(temp, name);
  ffmpeg([...inputs, ...extra, "-filter_complex", `${segments.map((_, index) => `[${index}:v]`).join("")}concat=n=${segments.length}:v=1[v]`,
    "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", out]);
  return out;
}

function runPrepare(spec, outputs) {
  const specPath = join(temp, `${outputs.name}.json`);
  writeFileSync(specPath, JSON.stringify(spec));
  const args = [prepare, "--spec", specPath, "--out", join(temp, `${outputs.name}.${outputs.ext ?? "mp4"}`),
    "--review-out", join(temp, `${outputs.name}-review.png`)];
  if (outputs.storyboard) args.push("--storyboard-out", join(temp, `${outputs.name}-storyboard.png`));
  if (outputs.markdown) args.push("--markdown-out", join(temp, `${outputs.name}.md`));
  const result = spawnSync(process.execPath, args, { encoding: "utf8", cwd: outputs.cwd });
  return { ...result, json: result.status === 0 ? JSON.parse(result.stdout) : null };
}

test("captions, step pins, and key indicators appear only during their intervals, including across holds", { skip: skipMedia }, () => {
  const input = source("steps-source.mp4", [["gray", 1], ["white", 1], ["black", 1]]);
  const result = runPrepare({
    input, trim: { start: 0.5, end: 2.5 }, holds: { start: 0.5, end: 0.5 }, profile: { fps: 10 },
    annotations: { events: [
      { start: 0.2, end: 0.8, step: 1, caption: "Ünïcödé ✓ 100% <b>&amp;</b> 'q' : [x] , ; \\ @file", at: [20, 20, 60, 40] },
      { start: 1.2, end: 1.6, key: "Control+R", caption: "Reload" },
      { start: 2.2, end: 9, step: 2, caption: "Done", at: [200, 100, 80, 50] },
    ] },
  }, { name: "steps" });
  assert.equal(result.status, 0, result.stderr);
  const report = result.json;
  const band = report.annotations.band;
  assert.ok(band > 20, `caption band was ${band}px`);
  assert.equal(report.prepared.height, 180 + band);
  assert.deepEqual(report.annotations.events.map((event) => event.frames), [[0, 7], [12, 15], [22, 29]]);
  assert.deepEqual(report.annotations.events[0].holds, { start: true, end: false });
  assert.deepEqual(report.annotations.events[2].clipped, { start: false, end: true });
  assert.deepEqual(report.timeline.map((segment) => segment.kind), ["presentation-hold", "real-time", "presentation-hold"]);
  assert.ok(Math.abs(report.prepared.duration - 3) < 0.15, "annotations add no time");
  const out = join(temp, "steps.mp4");
  const textIn = (index) => frame(out, index).count(0, 180, 320, 180 + band, bright);
  for (const index of [0, 3, 7, 12, 15, 22, 27, 29]) assert.ok(textIn(index) > 40, `caption text expected in frame ${index}`);
  for (const index of [8, 11, 16, 21]) assert.equal(textIn(index), 0, `no caption expected in frame ${index}`);
  const outline = (index) => frame(out, index).count(14, 30, 19, 50, reddish);
  assert.ok(outline(3) > 10, "step 1 outline during the start hold");
  assert.equal(outline(9), 0, "step 1 outline gone after its interval");
  // The step pin, keycap, and outline are each checked on their own frames.
  const keycap = ([r, g, b]) => r > 230 && g > 230 && b > 230;
  const keyIn = (index) => frame(out, index).count(10, 180, 40, 180 + band, keycap);
  assert.ok(keyIn(13) > 40, "keycap drawn in the caption band");
  for (const index of [11, 16]) assert.equal(keyIn(index), 0, `no keycap expected in frame ${index}`);
  const bandPin = (index) => frame(out, index).count(8, 180, 34, 180 + band, reddish);
  for (const index of [0, 7]) assert.ok(bandPin(index) > 40, `step 1 pin expected in the band in frame ${index}`);
  for (const index of [8, 13]) assert.equal(bandPin(index), 0, `no step 1 pin expected in frame ${index}`);
  assert.ok(reddish(frame(out, 0).at(16, 40)) && !reddish(frame(out, 9).at(16, 40)));
});

test("a reading pause freezes the frame, shows the pause badge, and adds exactly its frames", { skip: skipMedia }, () => {
  const input = source("pause-source.mp4", [["gray", 1], ["white", 1], ["black", 1]]);
  const result = runPrepare({
    input, trim: { start: 0.5, end: 2.5 }, holds: { start: 0, end: 0 }, profile: { fps: 10 },
    annotations: { events: [{ start: 1.2, end: 1.6, step: 1, caption: "Read the white state", hold: 1 }] },
  }, { name: "pause" });
  assert.equal(result.status, 0, result.stderr);
  const report = result.json;
  assert.equal(report.prepared.frames, 30, "20 real-time frames plus 10 paused frames");
  assert.ok(Math.abs(report.prepared.duration - 3) < 0.15);
  const inserted = report.timeline.find((segment) => segment.inserted);
  assert.deepEqual([inserted.kind, inserted.frames, inserted.source], ["presentation-hold", [8, 17], 1.2]);
  // Tick 12 is frame 7, its pause is frames 8-17, and ticks 13-15 follow as frames 18-20.
  assert.deepEqual(report.annotations.events[0].frames, [7, 20]);
  assert.equal(report.annotations.events[0].hold, 1);
  assert.ok(report.warnings.some((warning) => /reading pause add 1\.0s.*Paused for reading/.test(warning)));
  const out = join(temp, "pause.mp4");
  const band = report.annotations.band;
  const amber = ([r, g, b]) => r > 120 && g > 80 && g < 140 && b < 60;
  const badge = (index) => frame(out, index).count(200, 180, 320, 180 + band, amber);
  for (const index of [8, 12, 17]) assert.ok(badge(index) > 40, `pause badge expected in frame ${index}`);
  for (const index of [7, 18]) assert.equal(badge(index), 0, `no pause badge in frame ${index}`);
  const video = (index) => frame(out, index).at(160, 90);
  assert.ok(video(12)[0] > 230, "the paused frame shows the white state");
  assert.deepEqual(video(8), video(17), "the paused frames are frozen");
  assert.ok(frame(out, 29).at(160, 90)[0] < 40, "real time continues to the black state after the pause");
});

test("overlay captions and geometry follow crop and scale in the final output", { skip: skipMedia }, () => {
  const input = source("scaled-source.mp4", [["gray", 2]], []);
  const result = runPrepare({
    input, crop: { x: 40, y: 20, width: 240, height: 140 }, holds: { start: 0, end: 0 }, profile: { fps: 10, maxWidth: 160 },
    annotations: { captions: "overlay", events: [{ start: 0.5, end: 1.5, step: 1, at: [100, 60, 40, 30], caption: "Here" },
      { start: 0.5, end: 1.5, at: [20, 10, 60, 40] }] },
  }, { name: "scaled", ext: "gif" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.json.prepared.width, 160);
  assert.equal(result.json.prepared.height, 94, "overlay captions add no band");
  // Source [100, 60, 40, 30] - crop origin (40, 20), scaled by 160/240.
  assert.deepEqual(result.json.annotations.events[0].region, [40, 27, 27, 20]);
  assert.equal(result.json.annotations.events[0].regionClipped, false);
  assert.deepEqual(result.json.annotations.events[1].region, [0, 0, 27, 20]);
  assert.equal(result.json.annotations.events[1].regionClipped, true);
  assert.ok(result.json.warnings.some((warning) => /events\[1\]\.at was clipped/.test(warning)));
  const during = frame(join(temp, "scaled.gif"), 10);
  assert.ok(reddish(during.at(36, 45)), `outline expected left of the transformed region, got ${during.at(36, 45)}`);
  assert.ok(!reddish(frame(join(temp, "scaled.gif"), 2).at(36, 45)));
  assert.ok(during.count(0, 60, 160, 94, ([r, g, b]) => r < 60 && g < 60 && b < 70) > 400, "overlay caption box at the bottom");
  assert.equal(frame(join(temp, "scaled.gif"), 2).count(0, 60, 160, 94, ([r, g, b]) => r < 60 && g < 60 && b < 70), 0);
});

test("redactions hold in the annotated video and every storyboard panel, which keep order and timestamps", { skip: skipMedia }, () => {
  const input = join(temp, "private-source.mp4");
  ffmpeg(["-f", "lavfi", "-i", "color=c=gray:s=320x180:r=10:d=1", "-f", "lavfi", "-i", "color=c=white:s=320x180:r=10:d=1",
    "-f", "lavfi", "-i", "color=c=black:s=320x180:r=10:d=1", "-filter_complex",
    "[0:v][1:v][2:v]concat=n=3:v=1,drawbox=x=90:y=70:w=80:h=40:color=lime:t=fill[v]", "-map", "[v]", "-c:v", "libx264",
    "-pix_fmt", "yuv420p", input]);
  const long = "After the change, a long reviewer label wraps across several lines at the storyboard's display width " +
    "without spilling outside its panel.";
  const result = runPrepare({
    input, title: "Private flow", summary: "The masked value never appears.", holds: { start: 0.5, end: 0.5 }, profile: { fps: 10 },
    redactions: [{ at: [80, 60, 100, 60], color: "#000000" }],
    annotations: { events: [{ start: 0.2, end: 1.4, step: 1, caption: "Start", at: [20, 20, 40, 30] }] },
    storyboard: { checkpoints: [{ at: 0.5, label: "Gray start" }, { at: 1.5, label: long }, { at: 2.5, label: "Black end" }] },
  }, { name: "private", storyboard: true, markdown: true });
  assert.equal(result.status, 0, result.stderr);
  const noGreen = ([r, g, b]) => !(g > 150 && g > r * 2 && g > b * 2);
  const video = png(join(temp, "private-review.png"));
  for (let index = 0; index < video.data.length; index += 3) assert.ok(noGreen([...video.data.subarray(index, index + 3)]));
  for (const index of [0, 10, 20, 35]) {
    const decoded = frame(join(temp, "private.mp4"), index);
    assert.equal(decoded.count(0, 0, decoded.width, decoded.height, (pixel) => !noGreen(pixel)), 0, `green in frame ${index}`);
  }
  const board = png(join(temp, "private-storyboard.png"));
  for (let index = 0; index < board.data.length; index += 3) assert.ok(noGreen([...board.data.subarray(index, index + 3)]), "storyboard leaks the redacted region");
  const { checkpoints, panels } = result.json.storyboard;
  assert.deepEqual(checkpoints.map((item) => [item.index, item.label === long ? "long" : item.label, item.source, item.frame]),
    [[1, "Gray start", 0.5, 10], [2, "long", 1.5, 20], [3, "Black end", 2.5, 30]]);
  assert.deepEqual(checkpoints.map((item) => item.time), ["0:01.0", "0:02.0", "0:03.0"]);
  // Sample away from the step pin, outline, and redaction.
  const centre = (panel) => board.at(panel.image[0] + Math.round(panel.image[2] * 0.75), panel.image[1] + Math.round(panel.image[3] * 0.35));
  const [gray, white, black] = panels.map(centre);
  assert.ok(gray[0] > 100 && gray[0] < 160, `gray panel was ${gray}`);
  assert.ok(white[0] > 230, `white panel was ${white}`);
  assert.ok(black[0] < 40, `black panel was ${black}`);
  assert.ok(panels[1].labelHeight > panels[0].labelHeight * 2, "the long label wraps");
  assert.ok(panels.every((panel) => panel.text[0] + panel.text[2] <= board.width), "labels stay inside the storyboard");
  assert.equal(result.json.storyboard.size[0], 1760, "drawn at twice the 880px display width");
  const markdown = readFileSync(join(temp, "private.md"), "utf8");
  assert.match(markdown, /^#### Private flow\n\nThe masked value never appears\.\n\n!\[\]\(private\.mp4\)\n\n/);
  assert.match(markdown, /!\[Storyboard of 3 moments[^\]]*\]\(private-storyboard\.png\)/);
  assert.doesNotMatch(markdown, /-review\.png|\.html/, "diagnostic artifacts stay out of the published section");
});

test("caption text starting with @ is drawn literally, never read from a file", { skip: skipMedia }, () => {
  const input = source("literal-source.mp4", [["gray", 1]]);
  // If ImageMagick read this file, the caption would need far more than three lines.
  writeFileSync(join(temp, "secret-caption.txt"), "W".repeat(400));
  const result = runPrepare({ input, holds: { start: 0, end: 0 }, profile: { fps: 10 },
    annotations: { events: [{ start: 0.2, end: 0.8, caption: "@secret-caption.txt 100% done" }] } },
  { name: "literal", cwd: temp });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.json.annotations.band < 50, `a one-line caption band, got ${result.json.annotations.band}px`);
});

test("annotation errors stop before encoding and legacy specs produce the same output", { skip: skipMedia }, () => {
  const input = source("legacy-source.mp4", [["gray", 1], ["white", 1]]);
  const outside = runPrepare({ input, trim: { start: 0.5, end: 1.5 }, annotations: { events: [{ start: 0, end: 0.3, caption: "x" }] } },
    { name: "outside" });
  assert.notEqual(outside.status, 0);
  assert.match(outside.stderr, /shows on no output frame/);
  assert.equal(existsSync(join(temp, "outside.mp4")), false);
  const tooLong = runPrepare({ input, profile: { maxWidth: 200 }, annotations: { events: [{ start: 0.5, end: 1, caption: "word ".repeat(30) }] } },
    { name: "toolong" });
  assert.notEqual(tooLong.status, 0);
  assert.match(tooLong.stderr, /needs \d+ lines .*shorten it/);
  const misplaced = runPrepare({ input }, { name: "misplaced", markdown: true, storyboard: true });
  assert.notEqual(misplaced.status, 0);
  assert.match(misplaced.stderr, /--storyboard-out needs spec\.storyboard/);
  const legacy = runPrepare({ input, holds: { start: 0.5, end: 0.5 } }, { name: "legacy" });
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.equal(legacy.json.annotations, undefined);
  assert.equal(legacy.json.prepared.height, 180);
  assert.deepEqual(legacy.json.timeline.map((segment) => segment.kind), ["presentation-hold", "real-time", "presentation-hold"]);
});

test("the documented annotation example validates against its own trim and holds", () => {
  const doc = readFileSync(join(repo, "skills", "ui-evidence", "references", "motion.md"), "utf8");
  const block = [...doc.matchAll(/```json\r?\n([\s\S]*?)\r?\n```/g)].map((match) => match[1]).find((json) => json.includes('"annotations"'));
  assert.ok(block, "motion.md documents an annotated spec");
  const spec = JSON.parse(block);
  const fps = 30;
  const startTick = Math.ceil(spec.trim.start * fps - 1e-9);
  const endTick = Math.ceil(spec.trim.end * fps - 1e-9);
  const documented = outputTimeline({ trim: spec.trim, fps, startTick, endTick,
    startFrames: Math.round(spec.holds.start * fps), endFrames: Math.round(spec.holds.end * fps) });
  const frameCrop = { x: 0, y: 0, width: 640, height: 360, sourceWidth: 640, sourceHeight: 360 };
  const events = planEvents(spec.annotations, { source: { duration: 5 }, crop: frameCrop, size: outputSize(frameCrop, 640), timeline: documented });
  assert.equal(events.events.length, 4);
  assert.equal(events.events.at(-1).holds.end, true, "the final caption stays through the end hold");
  assert.deepEqual(events.events[0].key, ["ArrowRight"]);
  const storyboard = planStoryboard(spec.storyboard, documented, { duration: 5 });
  assert.deepEqual(storyboard.checkpoints.map((item) => item.index), [1, 2, 3]);
});
