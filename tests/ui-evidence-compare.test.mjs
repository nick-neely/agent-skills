#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, test } from "node:test";
import {
  anchorToImageRect, chooseLayout, detailWindows, expectedScreenshotSize, pixelSurface, planComparison, sectionMarkdown,
  segmentCrosses, suggestCrops,
} from "../skills/ui-evidence/scripts/comparison-layout.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scripts = join(repo, "skills", "ui-evidence", "scripts");
const compareScript = join(scripts, "compare.mjs");
const anchorsScript = join(scripts, "anchors.mjs");
const regionsScript = join(scripts, "regions.mjs");
const reference = join(repo, "skills", "ui-evidence", "references", "comparisons.md");
const font = join(repo, "skills", "ui-evidence", "assets", "DejaVuSans.ttf");
const temp = mkdtempSync(join(tmpdir(), "ui-evidence-compare-test-"));
after(() => rmSync(temp, { recursive: true, force: true }));

const MAGICK = (process.platform === "win32" ? ["magick"] : ["magick", "convert"])
  .find((binary) => spawnSync(binary, ["-version"], { stdio: "ignore" }).status === 0);
if (!MAGICK && process.env.UI_EVIDENCE_REQUIRE_MEDIA === "1") throw new Error("ImageMagick is required for comparison tests");
const media = { skip: MAGICK ? false : "ImageMagick is unavailable" };

const HEADER = [0x24, 0x29, 0x2f];
const RED = [255, 0, 0];
const BLUE = [0, 0, 255];
const WHITE = [255, 255, 255];

// A deterministic fake text measurer: 0.6em per character, wrapped by width.
function fakeMeasure(text, pointsize, wrapWidth) {
  const width = String(text).length * pointsize * 0.6;
  const lines = wrapWidth ? Math.max(1, Math.ceil(width / wrapWidth)) : 1;
  return { width: wrapWidth ? Math.min(width, wrapWidth) : width, height: Math.ceil(lines * pointsize * 1.3) };
}

const overlaps = (a, b) =>
  Math.min(a.x + a.width, b.x + b.width) > Math.max(a.x, b.x) &&
  Math.min(a.y + a.height, b.y + b.height) > Math.max(a.y, b.y);
const pinRect = (pin) => ({ x: pin.cx - pin.radius, y: pin.cy - pin.radius, width: pin.radius * 2, height: pin.radius * 2 });

// Panel pixels for layout tests: white, with optional filled rectangles. A
// rectangle with `text` gets dark vertical strokes, like a rendered label.
function paint(width, height, shapes = []) {
  const data = Buffer.alloc(width * height * 3, 255);
  const set = (x, y, [r, g, b]) => data.set([r, g, b], (y * width + x) * 3);
  for (const { rect: [x0, y0, w, h], color, text } of shapes) {
    for (let y = y0; y < y0 + h; y += 1) {
      for (let x = x0; x < x0 + w; x += 1) {
        const stroke = text && x >= x0 + 8 && x < x0 + w - 8 && y >= y0 + 10 && y < y0 + h - 10 && (x - x0) % 4 < 2;
        set(x, y, stroke ? [0x1f, 0x23, 0x28] : color);
      }
    }
  }
  return pixelSurface({ width, height, data });
}
const blankPanels = (width, height) => ["before", "after"].map((key) =>
  ({ key, label: key === "before" ? "Before" : "After", width, height, surface: paint(width, height) }));

function caseDir() {
  return mkdtempSync(join(temp, "case-"));
}

function image(path, width, height, shapes = [], extra = []) {
  const args = ["-size", `${width}x${height}`, "xc:white"];
  for (const { color, rect } of shapes) {
    const [x, y, w, h] = rect;
    args.push("-fill", color, "-draw", `rectangle ${x},${y} ${x + w - 1},${y + h - 1}`);
  }
  execFileSync(MAGICK, [...args, ...extra, path]);
  return path;
}

function rgb(path, x, y) {
  return [...execFileSync(MAGICK, [path, "+repage", "-crop", `1x1+${x}+${y}`, "+repage", "-depth", "8", "rgb:-"])];
}

function assertColor(actual, expected, tolerance = 14, where = "") {
  assert.equal(actual.length, 3, `pixel ${where} must exist`);
  actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) <= tolerance,
    `expected ${expected} at ${where}, got ${actual}`));
}

function greenPixels(path) {
  const raw = execFileSync(MAGICK, [path, "-depth", "8", "rgb:-"], { maxBuffer: 256 * 1024 * 1024 });
  let count = 0;
  for (let index = 0; index < raw.length; index += 3) {
    const [r, g, b] = [raw[index], raw[index + 1], raw[index + 2]];
    if (g > 150 && g > r * 2 && g > b * 2) count += 1;
  }
  return count;
}

function frames(gif) {
  return execFileSync(MAGICK, [gif, "-format", "%T\n", "info:"], { encoding: "utf8" }).trim().split(/\r?\n/);
}

const sha = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

function compare(dir, spec) {
  const specPath = join(dir, "spec.json");
  writeFileSync(specPath, JSON.stringify(spec, null, 2));
  const out = join(dir, "out");
  const result = spawnSync(process.execPath, [compareScript, "--spec", specPath, "--out-dir", out], { encoding: "utf8" });
  return { ...result, out, result: result.status === 0 ? JSON.parse(result.stdout) : null };
}

// Shared before/after pair: a 60x40 card moves 30px right between captures.
function cardPair(dir, size = [300, 200]) {
  image(join(dir, "before.png"), ...size, [{ color: "#ff0000", rect: [40, 30, 60, 40] }]);
  image(join(dir, "after.png"), ...size, [{ color: "#0000ff", rect: [70, 30, 60, 40] }]);
}

// ---------------------------------------------------------------------------
// Pure geometry and layout rules

test("anchor rectangles map viewport and full-page captures at non-unit pixel ratios", () => {
  const rect = { x: 20.25, y: -130, width: 40, height: 20.5 };
  const full = { mode: "full", scroll: { x: 5, y: 150 }, devicePixelRatio: 1.5,
    viewport: { width: 200, height: 100 }, document: { width: 205, height: 300 } };
  assert.deepEqual(anchorToImageRect(rect, full), { x: 37, y: 30, width: 61, height: 31 });
  assert.deepEqual(expectedScreenshotSize(full), { width: 308, height: 450 });
  const viewport = { ...full, mode: "viewport", devicePixelRatio: 2 };
  assert.deepEqual(anchorToImageRect({ x: 10, y: 20, width: 30, height: 5 }, viewport), { x: 20, y: 40, width: 60, height: 10 });
  assert.deepEqual(expectedScreenshotSize(viewport), { width: 400, height: 200 });
  assert.throws(() => anchorToImageRect(rect, { ...viewport, devicePixelRatio: 0 }), /devicePixelRatio/);
});

test("layout keeps matched scale and stacks wide captures but pairs tall ones", () => {
  assert.equal(chooseLayout("auto", { width: 1280, height: 800 }), "stacked");
  assert.equal(chooseLayout("auto", { width: 390, height: 844 }), "side-by-side");
  assert.equal(chooseLayout("side-by-side", { width: 1280, height: 800 }), "side-by-side");
  assert.throws(() => chooseLayout("grid", { width: 1, height: 1 }), /layout must be/);
  for (const [layout, size] of [["side-by-side", [390, 844]], ["stacked", [1280, 800]]]) {
    const plan = planComparison({
      panels: [{ key: "before", label: "Before", width: size[0], height: size[1] },
        { key: "after", label: "After", width: size[0], height: size[1] }],
      measure: fakeMeasure,
    });
    assert.equal(plan.layout, layout);
    const [before, afterPanel] = plan.panels;
    assert.deepEqual([before.width, before.height], size);
    assert.deepEqual([afterPanel.width, afterPanel.height], size);
    if (layout === "side-by-side") assert.equal(before.y, afterPanel.y);
    else assert.equal(before.x, afterPanel.x);
    assert.ok(!overlaps(before, afterPanel));
    assert.ok(plan.canvas.width >= afterPanel.x + afterPanel.width);
  }
});

test("crowded edge callouts keep every pin in bounds, apart, and off every changed region", () => {
  const rects = [[0, 0, 8, 8], [10, 0, 8, 8], [0, 10, 8, 8], [20, 0, 8, 8], [0, 20, 8, 8], [72, 52, 8, 8], [36, 26, 8, 8]];
  const callouts = rects.map(([x, y, width, height], index) => ({
    id: index + 1, color: "#cf222e", text: `change ${index + 1}`,
    marks: { before: { rect: { x, y, width, height } }, after: { rect: { x, y, width, height } } },
  }));
  const plan = planComparison({ panels: blankPanels(80, 60), callouts, measure: fakeMeasure });
  assert.ok(plan.canvas.width >= 360, "a small canvas keeps a readable minimum width");
  for (const panel of plan.panels) {
    const marks = plan.marks.filter((mark) => mark.panel === panel.key);
    assert.equal(marks.length, rects.length);
    for (const mark of marks) {
      const pin = pinRect(mark.pin);
      assert.ok(pin.x >= 0 && pin.y >= panel.y && pin.x + pin.width <= plan.canvas.width && pin.y + pin.height <= plan.canvas.height);
      assert.notEqual(mark.pin.placement, "overlap");
      for (const other of marks) {
        assert.ok(!overlaps(pin, other.rect), `pin ${mark.id} covers region ${other.id}`);
        if (other !== mark) assert.ok(!overlaps(pin, pinRect(other.pin)), `pins ${mark.id} and ${other.id} overlap`);
      }
      if (mark.pin.placement === "margin") {
        // The connector stops just outside its region, not on it.
        const { x2, y2 } = mark.pin.connector;
        const reach = plan.chrome.stroke + 1;
        assert.ok(x2 >= mark.rect.x - reach && x2 <= mark.rect.x + mark.rect.width + reach);
        assert.ok(y2 >= mark.rect.y - reach && y2 <= mark.rect.y + mark.rect.height + reach);
        assert.ok(!overlaps({ x: x2, y: y2, width: 1, height: 1 }, mark.rect), `connector ${mark.id} ends on its target`);
        if (mark.pin.crossing) {
          assert.match(plan.limitations.join("\n"), new RegExp(`Callout ${mark.id} connector in ${panel.label} crosses`));
        } else {
          for (const other of marks.filter((item) => item !== mark)) {
            assert.ok(!segmentCrosses(mark.pin.connector, pinRect(other.pin)), `connector ${mark.id} crosses pin ${other.id}`);
            assert.ok(!segmentCrosses(mark.pin.connector, other.rect), `connector ${mark.id} crosses region ${other.id}`);
          }
        }
      }
    }
    assert.ok(marks.some((mark) => mark.pin.placement === "margin"), "crowding falls back to the reserved margin");
    assert.ok(marks.some((mark) => mark.pin.placement === "margin" && !mark.pin.crossing), "most connectors find a clear path");
  }
});

test("a callout outlines its region only on request and places the same marks either way", () => {
  const rects = [{ x: 40, y: 30, width: 60, height: 40 }, { x: 180, y: 120, width: 30, height: 14 }];
  const plan = (outline) => planComparison({
    panels: blankPanels(300, 200),
    callouts: rects.map((rect, index) => ({ id: index + 1, color: "#cf222e", text: `change ${index + 1}`,
      outline: outline && index === 1, marks: { after: { rect } } })),
    measure: fakeMeasure,
  });
  const quiet = plan(false);
  const emphasised = plan(true);
  assert.deepEqual(quiet.marks.map((mark) => mark.outline), [null, null], "a region alone requests no box");
  assert.equal(emphasised.marks[0].outline, null);
  const [, outlined] = emphasised.marks;
  assert.ok(outlined.outline.x < outlined.rect.x && outlined.outline.width > outlined.rect.width, "the outline sits outside its region");
  assert.deepEqual(emphasised.marks.map((mark) => mark.pin), quiet.marks.map((mark) => mark.pin), "pins do not move");
  assert.deepEqual(emphasised.legend, quiet.legend);
});

test("crowded edge callouts over busy or unknown UI widen the gutters instead of covering it", () => {
  const rects = [[0, 0, 8, 8], [10, 0, 8, 8], [0, 10, 8, 8], [20, 0, 8, 8], [0, 20, 8, 8], [72, 52, 8, 8], [36, 26, 8, 8]];
  const callouts = rects.map(([x, y, width, height], index) => ({
    id: index + 1, color: "#cf222e", text: `change ${index + 1}`, label: `label ${index + 1}`,
    marks: { before: { rect: { x, y, width, height } }, after: { rect: { x, y, width, height } } },
  }));
  // Text strokes fill the panel's interior; only a thin frame at its edges is blank.
  const busy = paint(80, 60, [{ rect: [0, 0, 80, 60], color: [255, 255, 255], text: true }]);
  const crowded = (surface) => planComparison({
    panels: ["before", "after"].map((key) => ({ key, label: key, width: 80, height: 60, surface })), callouts, measure: fakeMeasure });
  const standard = planComparison({ panels: blankPanels(80, 60), callouts, measure: fakeMeasure });
  for (const [name, surface] of [["busy", busy], ["unknown", undefined]]) {
    const plan = crowded(surface);
    for (const mark of plan.marks) {
      const panel = plan.panels.find((item) => item.key === mark.panel);
      const coversUi = (box) => {
        const x = Math.max(box.x, panel.x);
        const y = Math.max(box.y, panel.y);
        const width = Math.min(box.x + box.width, panel.x + panel.width) - x;
        const height = Math.min(box.y + box.height, panel.y + panel.height) - y;
        return width > 0 && height > 0 && !(surface?.blank({ x: x - panel.x, y: y - panel.y, width, height }) ?? false);
      };
      assert.notEqual(mark.pin.placement, "overlap", `${name}: pin ${mark.id} fell back to covering in ${mark.panel}`);
      assert.ok(!coversUi(pinRect(mark.pin)), `${name}: pin ${mark.id} covers UI in ${mark.panel}`);
      if (mark.label) assert.ok(!coversUi(mark.label), `${name}: label ${mark.id} covers UI in ${mark.panel}`);
      for (const other of plan.marks.filter((item) => item.panel === mark.panel && item !== mark)) {
        assert.ok(!overlaps(pinRect(mark.pin), pinRect(other.pin)), `${name}: pins ${mark.id} and ${other.id} overlap`);
      }
    }
    assert.ok(plan.panels[1].y > standard.panels[1].y, `${name}: the gutters widen to hold the extra pins`);
  }
});

test("dozens of callouts on a small busy panel still keep every pin off its pixels", () => {
  // 48 disjoint regions on an 80x60 checkerboard, so no screenshot pixel is blank.
  const data = Buffer.alloc(80 * 60 * 3, 255);
  for (let y = 0; y < 60; y += 1) for (let x = 0; x < 80; x += 1) if ((x + y) % 2) data.set([0, 0, 0], (y * 80 + x) * 3);
  const checker = pixelSurface({ width: 80, height: 60, data });
  const callouts = Array.from({ length: 48 }, (_, index) => {
    const rect = { x: 5 + (index % 8) * 8, y: 5 + Math.floor(index / 8) * 8, width: 4, height: 4 };
    return { id: index + 1, color: "#cf222e", text: `change ${index + 1}`, marks: { before: { rect }, after: { rect } } };
  });
  for (const surface of [checker, undefined]) {
    const plan = planComparison({ panels: ["before", "after"].map((key) => ({ key, label: key, width: 80, height: 60, surface })),
      callouts, measure: fakeMeasure });
    for (const mark of plan.marks) {
      const panel = plan.panels.find((item) => item.key === mark.panel);
      assert.ok(!overlaps(pinRect(mark.pin), panel), `pin ${mark.id} covers screenshot pixels in ${mark.panel}`);
      for (const other of plan.marks.filter((item) => item.panel === mark.panel && item.id > mark.id)) {
        assert.ok(!overlaps(pinRect(mark.pin), pinRect(other.pin)), `pins ${mark.id} and ${other.id} overlap`);
      }
    }
    assert.equal(plan.marks.length, 96);
  }
});

test("a region nested inside another callout keeps its pin beside it", () => {
  const row = { x: 20, y: 100, width: 500, height: 40 };
  const badge = { x: 200, y: 110, width: 40, height: 20 };
  const plan = planComparison({
    panels: blankPanels(600, 400),
    callouts: [
      { id: 1, color: "#cf222e", text: "row", marks: { after: { rect: row } } },
      { id: 2, color: "#0969da", text: "badge", marks: { after: { rect: badge } } },
    ],
    measure: fakeMeasure,
  });
  const [outer, inner] = plan.marks;
  assert.equal(inner.pin.placement, "adjacent");
  assert.equal(inner.pin.connector, null);
  assert.ok(!overlaps(pinRect(inner.pin), inner.rect), "the pin never covers its own region");
  assert.ok(!overlaps(pinRect(outer.pin), outer.rect));
  assert.ok(!overlaps(pinRect(outer.pin), pinRect(inner.pin)));
});

test("marks keep unannotated neighbouring UI readable in both layouts and use gutters when pixels are unknown", () => {
  // A toolbar: Save between unannotated account text and a Cancel button, and
  // a badge just below an unannotated heading.
  const account = { x: 100, y: 26, width: 86, height: 24 };
  const cancel = { x: 300, y: 20, width: 80, height: 36 };
  const heading = { x: 20, y: 70, width: 60, height: 22 };
  const save = { x: 196, y: 20, width: 92, height: 36 };
  const badge = { x: 24, y: 100, width: 30, height: 14 };
  const shapes = [{ rect: [cancel.x, cancel.y, cancel.width, cancel.height], color: [0xea, 0xee, 0xf2], text: true },
    { rect: [account.x, account.y, account.width, account.height], color: [255, 255, 255], text: true },
    { rect: [heading.x, heading.y, heading.width, heading.height], color: [255, 255, 255], text: true },
    { rect: [save.x, save.y, save.width, save.height], color: [0x1f, 0x6f, 0xeb] },
    { rect: [badge.x, badge.y, badge.width, badge.height], color: [0xdd, 0xf4, 0xff] }];
  const callouts = [
    { id: 1, color: "#cf222e", text: "Save widened.", label: "Save action", measure: "width",
      marks: { before: { rect: save, measureText: "92 px" }, after: { rect: save, measureText: "92 px" } } },
    { id: 2, color: "#0969da", text: "New badge.", label: "A rather long label for the new badge", marks: { after: { rect: badge } } },
  ];
  const panelsWith = (surface) => ["before", "after"].map((key) => ({ key, label: key, width: 400, height: 130, surface }));
  for (const layout of ["stacked", "side-by-side"]) {
    const plan = planComparison({ panels: panelsWith(paint(400, 130, shapes)), callouts, layout, measure: fakeMeasure });
    assert.equal(plan.layout, layout);
    for (const panel of plan.panels) {
      const neighbours = [account, cancel, heading].map((rect) => ({ ...rect, x: rect.x + panel.x, y: rect.y + panel.y }));
      for (const mark of plan.marks.filter((item) => item.panel === panel.key)) {
        const boxes = [pinRect(mark.pin), mark.label, mark.bracket?.label].filter(Boolean);
        for (const box of boxes) {
          for (const neighbour of neighbours) {
            assert.ok(!overlaps(box, neighbour), `${layout} callout ${mark.id} mark covers unannotated UI in ${panel.key}`);
          }
        }
        if (mark.pin.connector) {
          for (const neighbour of neighbours) assert.ok(!segmentCrosses(mark.pin.connector, neighbour), `${layout} connector ${mark.id} crosses UI`);
        }
      }
    }
    assert.ok(plan.marks.every((mark) => mark.pin.placement !== "overlap"));
    const badgeMark = plan.marks.find((mark) => mark.id === 2);
    assert.equal(badgeMark.label, null, "a label that would cover the heading or leave the panel moves to the legend");
    assert.match(plan.limitations.join("\n"), /Callout 2 label did not fit in after; the legend carries its text/);
    assert.deepEqual(plan.legend.items.map((item) => item.id), [1, 2], "stable IDs stay in the legend");
  }

  // Without pixels, no screenshot pixel is known to be safe: every mark sits in a gutter.
  const unknown = planComparison({ panels: panelsWith(undefined), callouts, measure: fakeMeasure });
  for (const mark of unknown.marks) {
    const panel = unknown.panels.find((item) => item.key === mark.panel);
    for (const box of [pinRect(mark.pin), mark.label, mark.bracket?.label].filter(Boolean)) {
      assert.ok(!overlaps(box, panel), `callout ${mark.id} covers unverified screenshot pixels in ${mark.panel}`);
    }
    assert.equal(mark.pin.placement, "margin");
  }
  // Blank pixels around a region still take an adjacent pin, label, and bracket.
  const open = planComparison({ panels: blankPanels(400, 130), callouts: [callouts[0]], measure: fakeMeasure });
  for (const mark of open.marks) {
    assert.equal(mark.pin.placement, "adjacent");
    assert.ok(mark.label && mark.bracket, "blank surroundings keep the optional label and bracket");
  }
  assert.deepEqual(open.limitations, []);
});

test("pixel surfaces treat flat colour as blank and edges, text, or unknown pixels as occupied", () => {
  const surface = paint(40, 40, [{ rect: [20, 0, 20, 40], color: [0xf6, 0xf8, 0xfa] }, { rect: [0, 14, 24, 26], color: [255, 255, 255], text: true }]);
  assert.equal(surface.blank({ x: 0, y: 0, width: 20, height: 12 }), true);
  assert.equal(surface.blank({ x: 15, y: 0, width: 10, height: 10 }), true, "white beside #f6f8fa is within tolerance");
  assert.equal(surface.blank({ x: 0, y: 25, width: 20, height: 10 }), false, "strokes are occupied");
  assert.equal(surface.blank({ x: 30, y: 30, width: 20, height: 5 }), false, "pixels past the edge are unknown");
  const edge = paint(10, 10, [{ rect: [5, 0, 5, 10], color: [0xd0, 0xd7, 0xde] }]);
  assert.equal(edge.blank({ x: 0, y: 0, width: 10, height: 10 }), false, "a border line is occupied");
});

test("a measurement bracket that cannot fit is reported instead of silently dropped", () => {
  const plan = planComparison({
    panels: [{ key: "before", label: "Before", width: 400, height: 300 }, { key: "after", label: "After", width: 400, height: 300 }],
    callouts: [{ id: 1, color: "#cf222e", text: "full width", measure: "height",
      marks: { after: { rect: { x: 0, y: 0, width: 400, height: 300 }, measureText: "150 px" } } }],
    measure: fakeMeasure,
  });
  assert.equal(plan.marks[0].bracket, null);
  assert.match(plan.limitations.join("\n"), /Callout 1 measurement bracket did not fit in After/);
});

test("connector clipping detects crossings and ignores segments that only pass nearby", () => {
  const rect = { x: 10, y: 10, width: 10, height: 10 };
  assert.equal(segmentCrosses({ x1: 0, y1: 15, x2: 30, y2: 15 }, rect), true);
  assert.equal(segmentCrosses({ x1: 0, y1: 0, x2: 30, y2: 5 }, rect), false);
  assert.equal(segmentCrosses({ x1: 15, y1: 0, x2: 15, y2: 9 }, rect), false);
});

test("long labels fall back to the legend and long explanations wrap inside the canvas", () => {
  const long = "A long explanation that should never be squeezed onto the screenshot itself. ".repeat(4);
  const plan = planComparison({
    panels: blankPanels(120, 80),
    callouts: [
      { id: 1, color: "#cf222e", text: long, label: "far too long for a label inside a tiny panel",
        marks: { after: { rect: { x: 40, y: 30, width: 20, height: 10 } } } },
      { id: 2, color: "#0969da", text: "short", label: "ok", marks: { before: { rect: { x: 10, y: 50, width: 10, height: 10 } } } },
    ],
    measure: fakeMeasure,
  });
  assert.equal(plan.marks.find((mark) => mark.id === 1).label, null);
  assert.match(plan.limitations.join("\n"), /Callout 1 label did not fit/);
  const fitted = plan.marks.find((mark) => mark.id === 2).label;
  assert.ok(fitted && fitted.text === "ok");
  assert.ok(!plan.marks.some((mark) => mark.panel === "after" && mark.id === 2), "one-sided callouts stay one-sided");
  const [first, second] = plan.legend.items;
  assert.equal(first.text.value, long);
  assert.ok(first.text.height > plan.chrome.legendFont * 2, "long legend text wraps to several lines");
  assert.ok(second.pin.cy - second.pin.radius >= first.text.y + first.text.height, "legend items never overlap");
  assert.ok(first.text.x + first.text.width <= plan.canvas.width);
  assert.ok(plan.legend.y + plan.legend.height <= plan.canvas.height);
});

test("detail windows share coordinates by default and stay equal-sized at image edges", () => {
  const sizes = { before: { width: 300, height: 200 }, after: { width: 300, height: 200 } };
  const shared = detailWindows({ before: { x: 40, y: 30, width: 60, height: 40 }, after: { x: 70, y: 30, width: 60, height: 40 }, sizes, context: 10 });
  assert.equal(shared.mode, "shared");
  assert.deepEqual(shared.before, { x: 30, y: 20, width: 110, height: 60 });
  assert.deepEqual(shared.after, shared.before);
  const edge = detailWindows({ before: { x: 0, y: 0, width: 10, height: 10 }, after: null, sizes, context: 20 });
  assert.deepEqual(edge.before, { x: 0, y: 0, width: 50, height: 50 });
  const padded = detailWindows({ before: null, after: { x: 100, y: 500, width: 50, height: 30 },
    sizes: { before: { width: 300, height: 200 }, after: { width: 300, height: 600 } }, context: 10 });
  assert.deepEqual(padded.after, { x: 90, y: 490, width: 70, height: 50 }, "padded sizes keep the requested region");
  assert.deepEqual(padded.before, padded.after);
  const separate = detailWindows({ before: { x: 10, y: 10, width: 20, height: 20 }, after: { x: 250, y: 150, width: 30, height: 20 }, sizes, context: 5, separate: true });
  assert.equal(separate.mode, "separate");
  assert.deepEqual([separate.before.width, separate.before.height], [separate.after.width, separate.after.height]);
  assert.ok(separate.after.x + separate.after.width <= 300 && separate.after.y + separate.after.height <= 200);
});

test("crop suggestions group nearby changed regions and leave distant ones apart", () => {
  const regions = [{ x: 10, y: 10, width: 20, height: 10 }, { x: 40, y: 12, width: 10, height: 10 }, { x: 200, y: 150, width: 30, height: 30 }];
  const crops = suggestCrops(regions, { width: 300, height: 200 }, { gap: 24, context: 8 });
  assert.equal(crops.length, 2);
  const grouped = crops.find((crop) => crop.members.length === 2);
  assert.deepEqual(grouped.region, [10, 10, 40, 12]);
  assert.deepEqual(grouped.window, [2, 2, 56, 28]);
});

test("generated Markdown neutralizes media syntax in explanations and keeps alt text intact", () => {
  const markdown = sectionMarkdown({
    title: "Header <script> & &lt;b&gt;",
    comparison: { file: "comparison.png", alt: "Before [left] and after <img src=\"x.png\">" },
    callouts: [{ id: 4, text: "Shows ![x](secret.png) and <img src=\"a.png\">\nwrapped" }],
    details: [{ file: "detail-callout-4.png", alt: "Detail" }],
    flip: { file: "flip.gif", alt: "Screenshot flip" },
  });
  assert.match(markdown, /^#### Header &lt;script&gt; &amp; &amp;lt;b&amp;gt;/);
  assert.match(markdown, /!\[Before \(left\) and after &lt;img src="x\.png"&gt;\]\(comparison\.png\)/);
  assert.match(markdown, /- \*\*4\*\*: Shows \\!\\\[x\\\]\(secret\.png\) and &lt;img src="a\.png"&gt; wrapped/);
  const references = [...markdown.matchAll(/!\[[^\]\n]*\]\(([^)\s]+)\)/g)].map((match) => match[1]);
  assert.deepEqual(references, ["comparison.png", "detail-callout-4.png", "flip.gif"]);
  assert.match(markdown, /<details><summary>Screenshot comparison aids<\/summary>/);
});

// ---------------------------------------------------------------------------
// Rendered comparisons

test("the combined image keeps labelled panels at one scale with exact crop transforms", media, () => {
  const dir = caseDir();
  cardPair(dir);
  const before = join(dir, "before.png");
  const afterImage = join(dir, "after.png");
  const hashes = [sha(before), sha(afterImage)];
  const run = compare(dir, {
    before: { image: "before.png", label: "Main" },
    after: { image: "after.png", label: "Branch" },
    layout: "side-by-side",
    crop: [20, 10, 200, 120],
    callouts: [{ id: 3, text: "The card moved 30 px right.", before: [40, 30, 60, 40], after: [70, 30, 60, 40] }],
  });
  assert.equal(run.status, 0, run.stderr);
  const { comparison } = run.result;
  assert.equal(comparison.layout, "side-by-side");
  const panels = comparison.panels;
  assert.deepEqual([panels.before.label, panels.after.label], ["Main", "Branch"]);
  for (const panel of [panels.before, panels.after]) {
    assert.deepEqual(panel.source, [20, 10, 200, 120]);
    assert.deepEqual(panel.canvas.slice(2), [200, 120], "panels keep the source aspect ratio at scale 1");
    assert.equal(panel.scale, 1);
  }
  assert.equal(panels.before.canvas[1], panels.after.canvas[1]);
  const at = (panel, x, y) => rgb(run.result.outputs.comparison, panel.canvas[0] + x - 20, panel.canvas[1] + y - 10);
  assertColor(at(panels.before, 45, 65), RED, 14, "before card");
  assertColor(at(panels.after, 45, 65), WHITE, 14, "after vacated area");
  assertColor(at(panels.after, 100, 40), BLUE, 14, "after card");
  assertColor(at(panels.before, 200, 120), WHITE, 14, "before background");
  // Header bars carry the panel identity as rendered text.
  for (const panel of [panels.before, panels.after]) {
    assertColor(rgb(run.result.outputs.comparison, panel.canvas[0] + 1, panel.canvas[1] - 2), HEADER, 6, "header");
    const strip = execFileSync(MAGICK, [run.result.outputs.comparison, "-crop", `120x${Math.floor(panel.canvas[1] - 14)}+${panel.canvas[0]}+12`,
      "+repage", "-depth", "8", "rgb:-"]);
    assert.ok(strip.some((value, index) => index % 3 === 0 && value > 200 && strip[index + 1] > 200), "header text is drawn");
  }
  assert.deepEqual(run.result.calloutIds, [3]);
  assert.match(readFileSync(run.result.outputs.markdown, "utf8"), /- \*\*3\*\*: The card moved 30 px right\./);
  assert.deepEqual([sha(before), sha(afterImage)], hashes, "inputs are never modified");
});

test("detail crops enlarge matching windows that preserve movement", media, () => {
  const dir = caseDir();
  cardPair(dir);
  const run = compare(dir, {
    before: { image: "before.png" },
    after: { image: "after.png" },
    callouts: [{ id: 1, text: "Card moved.", before: [40, 30, 60, 40], after: [70, 30, 60, 40] }],
    details: [
      { callout: 1, zoom: 2, context: 10, layout: "side-by-side" },
      { id: "moved", before: [40, 30, 60, 40], after: [70, 30, 60, 40], separate: true, context: 5, zoom: 1 },
    ],
  });
  assert.equal(run.status, 0, run.stderr);
  const [shared, separate] = run.result.details;
  assert.equal(shared.mode, "shared");
  assert.deepEqual(shared.panels.before.source, [30, 20, 110, 60]);
  assert.deepEqual(shared.panels.after.source, [30, 20, 110, 60]);
  for (const panel of Object.values(shared.panels)) assert.deepEqual(panel.canvas.slice(2), [220, 120]);
  const at = (panel, x, y) => rgb(shared.path, panel.canvas[0] + (x - 30) * 2, panel.canvas[1] + (y - 20) * 2);
  assertColor(at(shared.panels.before, 45, 40), RED, 14, "detail before card");
  assertColor(at(shared.panels.after, 45, 40), WHITE, 14, "detail after vacated");
  assertColor(at(shared.panels.after, 125, 40), BLUE, 14, "detail after card");
  assert.deepEqual(shared.callouts, [1]);
  assert.match(shared.alt, /Enlarged detail at 2x/);

  assert.equal(separate.mode, "separate");
  assert.deepEqual(separate.panels.before.source, [35, 25, 70, 50]);
  assert.deepEqual(separate.panels.after.source, [65, 25, 70, 50]);
  assert.match(run.result.limitations.join("\n"), /Detail moved centres separate windows/);
  const markdown = readFileSync(run.result.outputs.markdown, "utf8");
  assert.match(markdown, /\(detail-callout-1\.png\)/);
  assert.match(markdown, /\(detail-moved\.png\)/);
});

test("incompatible or invalid geometry fails with an actionable message before rendering", media, () => {
  const dir = caseDir();
  cardPair(dir);
  image(join(dir, "wide.png"), 320, 200, [{ color: "#0000ff", rect: [70, 30, 60, 40] }]);
  const base = { before: { image: "before.png" }, after: { image: "after.png" } };
  const cases = [
    [{ ...base, after: { image: "wide.png" } }, /dimension mismatch: before is 300x200 and after is 320x200/],
    [{ ...base, after: { image: "wide.png" }, sizeMismatch: "pad", flip: true }, /identical dimensions/],
    [{ ...base, before: { image: "before.png", devicePixelRatio: 2 } }, /device pixel ratio 2 and after at 1/],
    [{ ...base, callouts: [{ text: "x", region: [-5, 0, 10, 10] }] }, /extends outside the 300x200 before image/],
    [{ ...base, callouts: [{ text: "x", region: [5, 0, 0, 10] }] }, /positive width and height/],
    [{ ...base, callouts: [{ text: "x", region: [5, 0, "10", 10] }] }, /finite numbers/],
    [{ ...base, crop: [250, 0, 100, 100] }, /crop .* extends outside/],
    [{ ...base, crop: [0, 0, 30, 30], callouts: [{ text: "x", region: [200, 100, 10, 10] }] }, /outside the crop/],
    [{ ...base, callouts: [{ text: "x", region: { anchor: "save" } }] }, /no "anchors" file/],
    [{ ...base, callouts: [{ id: 1, text: "x", region: [1, 1, 5, 5] }, { id: 1, text: "y", region: [9, 9, 5, 5] }] }, /used twice/],
    [{ ...base, details: [{ callout: 9 }] }, /callout 9, which does not exist/],
    [{ ...base, flip: { holdMs: 100 } }, /holdMs/],
    [{ ...base, onion: { opacity: 1 } }, /opacity/],
    [{ ...base, flip: "yes" }, /"flip" must be true, false, or an options object/],
  ];
  for (const [spec, pattern] of cases) {
    const run = compare(dir, spec);
    assert.notEqual(run.status, 0, `expected failure for ${JSON.stringify(spec)}`);
    assert.match(run.stderr, pattern);
    assert.equal(existsSync(join(run.out, "comparison.png")), false);
  }
  const padded = compare(dir, { ...base, after: { image: "wide.png" }, sizeMismatch: "pad", layout: "stacked" });
  assert.equal(padded.status, 0, padded.stderr);
  assert.deepEqual(padded.result.comparison.panels.before.canvas.slice(2), [300, 200]);
  assert.deepEqual(padded.result.comparison.panels.after.canvas.slice(2), [320, 200]);
  assert.match(padded.result.limitations.join("\n"), /no stretching/);

  image(join(dir, "tall.png"), 300, 600, [{ color: "#0000ff", rect: [100, 500, 50, 30] }]);
  const tall = compare(dir, { ...base, after: { image: "tall.png" }, sizeMismatch: "pad",
    callouts: [{ id: 1, text: "A footer action appears.", after: [100, 500, 50, 30] }],
    details: [{ callout: 1, zoom: 2, context: 10 }] });
  assert.equal(tall.status, 0, tall.stderr);
  const detail = tall.result.details[0];
  assert.deepEqual(detail.panels.after.source, [90, 490, 70, 50]);
  assert.deepEqual(detail.callouts, [1]);
  const afterPanel = detail.panels.after;
  assertColor(rgb(detail.path, afterPanel.canvas[0] + 40, afterPanel.canvas[1] + 40), BLUE, 14, "padded detail shows the change");
  assertColor(rgb(detail.path, detail.panels.before.canvas[0] + 40, detail.panels.before.canvas[1] + 40), WHITE, 2, "blank fill");
  assert.match(tall.result.limitations.join("\n"), /Detail callout-1 extends past the Before screenshot/);
});

test("the flip GIF alternates labelled before and after frames with readable holds", media, () => {
  const dir = caseDir();
  cardPair(dir);
  const run = compare(dir, { before: { image: "before.png" }, after: { image: "after.png" }, flip: { holdMs: 800 } });
  assert.equal(run.status, 0, run.stderr);
  const { flip } = run.result;
  assert.deepEqual(frames(flip.path), ["80", "80"]);
  assert.equal(flip.holdMs, 800);
  assert.deepEqual(flip.frames, ["Before", "After"]);
  const banner = flip.banner;
  assertColor(rgb(`${flip.path}[0]`, 50, banner + 40), RED, 24, "frame 0 is before");
  assertColor(rgb(`${flip.path}[1]`, 50, banner + 40), WHITE, 24, "frame 1 is after");
  assertColor(rgb(`${flip.path}[1]`, 100, banner + 40), BLUE, 24, "frame 1 card");
  const bannerText = (frame) => {
    const raw = execFileSync(MAGICK, [`${flip.path}[${frame}]`, "+repage", "-crop", `120x${banner}+0+0`, "+repage", "-depth", "8", "rgb:-"]);
    assertColor([raw[0], raw[1], raw[2]], HEADER, 24, `frame ${frame} banner`);
    return raw.filter((value, index) => index % 3 === 0 && value > 200).length;
  };
  assert.ok(bannerText(0) > 0 && bannerText(1) > 0, "both frames keep their label");
  assert.match(readFileSync(run.result.outputs.markdown, "utf8"), /Screenshot flip comparison[^\]]*not a recording of motion\]\(flip\.gif\)/);
});

test("the onion skin blends after over before at the requested opacity in registration", media, () => {
  const dir = caseDir();
  cardPair(dir);
  const run = compare(dir, { before: { image: "before.png" }, after: { image: "after.png" }, onion: { opacity: 0.25 } });
  assert.equal(run.status, 0, run.stderr);
  const { onion } = run.result;
  assert.equal(onion.opacity, 0.25);
  const [x0, y0, width, height] = onion.image;
  assert.deepEqual([width, height], [300, 200]);
  const at = (x, y) => rgb(onion.path, x0 + x, y0 + y);
  assertColor(at(50, 40), [255, 64, 64], 4, "before only");
  assertColor(at(110, 40), [191, 191, 255], 4, "after only");
  assertColor(at(80, 40), [191, 0, 64], 4, "overlap");
  assertColor(at(200, 150), WHITE, 2, "unchanged");
  assertColor(at(39, 40), WHITE, 2, "left edge stays registered");
  assertColor(at(40, 40), [255, 64, 64], 4, "card edge stays registered");
});

test("redaction reaches every derived comparison, crop, zoom, flip frame, and overlay", media, () => {
  for (const style of ["pixelate", "block"]) {
    const dir = caseDir();
    const secret = ["-fill", "#00ff00", "-font", font, "-pointsize", "22", "-annotate", "+202+172", "SECRET"];
    image(join(dir, "before.png"), 300, 200, [{ color: "#ff0000", rect: [40, 30, 60, 40] }], secret);
    image(join(dir, "after.png"), 300, 200, [{ color: "#0000ff", rect: [70, 30, 60, 40] }], secret);
    assert.ok(greenPixels(join(dir, "before.png")) > 50, "the fixture carries a visible secret");
    const spec = {
      before: { image: "before.png" }, after: { image: "after.png" },
      callouts: [{ id: 1, text: "Card moved.", before: [40, 30, 60, 40], after: [70, 30, 60, 40] }],
      details: [{ id: "secret-area", region: [190, 140, 100, 50], zoom: 3 }],
      flip: true, onion: true,
    };
    const control = compare(dir, spec);
    assert.equal(control.status, 0, control.stderr);
    assert.ok(greenPixels(control.result.details[0].path) > 50, "without redaction the detail would leak");
    const run = compare(dir, { ...spec, redact: [{ at: [198, 150, 96, 30], style }] });
    assert.equal(run.status, 0, run.stderr);
    const outputs = [run.result.outputs.comparison, ...run.result.outputs.details, run.result.outputs.onion,
      `${run.result.outputs.flip}[0]`, `${run.result.outputs.flip}[1]`];
    for (const output of outputs) assert.equal(greenPixels(output), 0, `${style} redaction leaked into ${output}`);
    assert.deepEqual(run.result.inputs.before.redactions, [{ at: [198, 150, 96, 30], style }]);
  }
});

test("saved anchors resolve through capture metadata without a live page", media, () => {
  const dir = caseDir();
  const capture = { mode: "full", viewport: { width: 200, height: 100 }, scroll: { x: 0, y: 150 },
    document: { width: 200, height: 300 }, devicePixelRatio: 1.5, screenshot: { width: 300, height: 450 } };
  const record = (rect) => ({ version: 1, capture, anchors: { card: { selector: "#card", rect } } });
  writeFileSync(join(dir, "before-anchors.json"), JSON.stringify(record({ x: 20, y: -130, width: 40, height: 20 })));
  writeFileSync(join(dir, "after-anchors.json"), JSON.stringify(record({ x: 40, y: -130, width: 40, height: 20 })));
  image(join(dir, "before.png"), 300, 450, [{ color: "#ff0000", rect: [30, 30, 60, 30] }]);
  image(join(dir, "after.png"), 300, 450, [{ color: "#0000ff", rect: [60, 30, 60, 30] }]);
  const spec = {
    before: { image: "before.png", anchors: "before-anchors.json" },
    after: { image: "after.png", anchors: "after-anchors.json" },
    layout: "side-by-side",
    callouts: [{ id: 1, text: "Card moved.", region: { anchor: "card" }, measure: "width" }],
  };
  const run = compare(dir, spec);
  assert.equal(run.status, 0, run.stderr);
  const callout = run.result.callouts[0];
  assert.deepEqual(callout.panels.before.source, [30, 30, 60, 30]);
  assert.deepEqual(callout.panels.after.source, [60, 30, 60, 30]);
  assert.equal(run.result.inputs.before.devicePixelRatio, 1.5);
  assert.match(callout.legend, /Measured width: Before 40 px, After 40 px\./);
  const panel = run.result.comparison.panels.after;
  assertColor(rgb(run.result.outputs.comparison, panel.canvas[0] + 90, panel.canvas[1] + 45), BLUE, 14, "anchored card");
  assert.ok(callout.panels.before.bracket, "measurement brackets render for a fully visible span");

  writeFileSync(join(dir, "after-anchors.json"), JSON.stringify({ ...record({ x: 1, y: 1, width: 1, height: 1 }),
    capture: { ...capture, screenshot: { width: 600, height: 900 } } }));
  const mismatched = compare(dir, spec);
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /recorded for a 600x900 screenshot/);
});

test("crowded edge callouts on a small canvas render with a legend for text that cannot fit", media, () => {
  const dir = caseDir();
  image(join(dir, "before.png"), 80, 60, [{ color: "#ff0000", rect: [0, 0, 8, 8] }]);
  image(join(dir, "after.png"), 80, 60, [{ color: "#0000ff", rect: [0, 0, 8, 8] }]);
  const text = "The explanation is long enough to wrap across several legend lines at this width. ".repeat(3);
  const rects = [[0, 0, 8, 8], [10, 0, 8, 8], [0, 10, 8, 8], [72, 0, 8, 8], [72, 52, 8, 8], [36, 26, 8, 8]];
  const run = compare(dir, {
    before: { image: "before.png" }, after: { image: "after.png" },
    callouts: rects.map((region, index) => ({ id: index + 1, text, label: "this label cannot fit beside a tiny panel", region })),
  });
  assert.equal(run.status, 0, run.stderr);
  const { canvas } = run.result.comparison;
  for (const callout of run.result.callouts) {
    for (const panel of Object.values(callout.panels)) {
      const [cx, cy] = panel.pin.center;
      assert.ok(cx - panel.pin.radius >= 0 && cx + panel.pin.radius <= canvas.width);
      assert.ok(cy - panel.pin.radius >= 0 && cy + panel.pin.radius <= canvas.height);
      assert.notEqual(panel.pin.placement, "overlap");
    }
  }
  assert.match(run.result.limitations.join("\n"), /label did not fit/);
  const legend = run.result.comparison.legend;
  assert.ok(legend[3] > rects.length * 3 * 16, "wrapped legend grows with its text");
  assert.ok(legend[1] + legend[3] <= canvas.height);
});

// Raw RGB pixels of a whole image.
function pixels(path) {
  const [width, height] = execFileSync(MAGICK, [path, "-format", "%w %h", "info:"], { encoding: "utf8" }).trim().split(" ").map(Number);
  const data = execFileSync(MAGICK, [path, "-alpha", "off", "-depth", "8", "rgb:-"], { maxBuffer: 256 * 1024 * 1024 });
  return { width, height, at: (x, y) => [...data.subarray((y * width + x) * 3, (y * width + x) * 3 + 3)] };
}

// The bounding box of non-white pixels inside a search window.
function inkBox(image, [x0, y0, width, height]) {
  let box = null;
  for (let y = y0; y < y0 + height; y += 1) {
    for (let x = x0; x < x0 + width; x += 1) {
      if (image.at(x, y).every((value) => value > 245)) continue;
      box = box ? { x0: Math.min(box.x0, x), y0: Math.min(box.y0, y), x1: Math.max(box.x1, x), y1: Math.max(box.y1, y) } : { x0: x, y0: y, x1: x, y1: y };
    }
  }
  return [box.x0, box.y0, box.x1 - box.x0 + 1, box.y1 - box.y0 + 1];
}

// Output pixels of a source rectangle, mapped through one rendered view panel.
function viewRect(panel, [x, y, width, height]) {
  const [cx, cy] = panel.canvas;
  const [wx, wy] = panel.source;
  return { x: cx + (x - wx) * panel.scale, y: cy + (y - wy) * panel.scale, width: width * panel.scale, height: height * panel.scale };
}

// The output pixels `by` pixels outside a canvas rectangle, as [x, y] pairs.
function ring(rect, by) {
  const x0 = Math.round(rect.x) - by;
  const y0 = Math.round(rect.y) - by;
  const x1 = Math.round(rect.x + rect.width) - 1 + by;
  const y1 = Math.round(rect.y + rect.height) - 1 + by;
  const points = [];
  for (let x = x0; x <= x1; x += 1) points.push([x, y0], [x, y1]);
  for (let y = y0 + 1; y < y1; y += 1) points.push([x0, y], [x1, y]);
  return points;
}

const hex = (color) => [1, 3, 5].map((index) => parseInt(color.slice(index, index + 2), 16));

test("clean, pin-only, and emphasised comparisons keep targets, neighbours, and redaction intact in both layouts", media, () => {
  const dir = caseDir();
  // A settings toolbar: account text, Save, and an unannotated Cancel button,
  // then an unannotated heading with a new badge just below it in the after
  // state, and a secret in an unrelated corner that must be redacted.
  const draw = (name, saveWidth, withBadge) => {
    const save = [380 - 16 - saveWidth, 12, saveWidth, 34];
    execFileSync(MAGICK, ["-size", "480x150", "xc:#f6f8fa", "-fill", "#ffffff", "-draw", "rectangle 0,0 479,57",
      "-fill", "#d0d7de", "-draw", "line 0,58 479,58",
      "-fill", "#eaeef2", "-draw", "roundrectangle 384,12 463,45 6,6",
      "-fill", "#1f6feb", "-draw", `roundrectangle ${save[0]},12 ${save[0] + saveWidth - 1},45 6,6`,
      "-font", font, "-pointsize", "14", "-fill", "#1f2328", "-annotate", "+400+34", "Cancel",
      "-fill", "#59636e", "-annotate", "+96+34", "ada@example.com",
      "-fill", "#ffffff", "-annotate", `+${save[0] + 12}+34`, saveWidth > 80 ? "Save changes" : "Save",
      "-fill", "#ffffff", "-draw", "rectangle 16,72 300,140",
      "-fill", "#1f2328", "-pointsize", "15", "-annotate", "+28+94", "Email",
      ...(withBadge ? ["-fill", "#ddf4ff", "-draw", "roundrectangle 28,104 64,119 7,7"] : []),
      "-fill", "#00ff00", "-pointsize", "14", "-annotate", "+330+128", "SECRET",
      join(dir, name)]);
    return save;
  };
  const saveBefore = draw("before.png", 64, false);
  const saveAfter = draw("after.png", 120, true);
  const badge = [28, 104, 37, 16];
  assert.ok(greenPixels(join(dir, "before.png")) > 50, "the fixture carries a visible secret");
  const source = { before: pixels(join(dir, "before.png")), after: pixels(join(dir, "after.png")) };
  const neighbours = {
    cancel: [384, 12, 80, 34],
    account: inkBox(source.after, [90, 14, 150, 30]),
    heading: inkBox(source.after, [20, 76, 120, 22]),
  };
  const targets = { before: { save: saveBefore }, after: { save: saveAfter, badge } };
  const modes = {
    clean: [],
    pins: [
      { id: 1, text: "Save reads Save changes and moved left.", before: saveBefore, after: saveAfter },
      { id: 2, text: "Weekly summary gains a New badge.", after: badge },
    ],
    emphasis: [
      { id: 1, text: "Save reads Save changes and widened.", label: "Save action", measure: "width", outline: true,
        before: saveBefore, after: saveAfter },
      { id: 2, text: "The badge is easy to miss at PR width.", outline: true, after: badge },
    ],
  };
  for (const [mode, callouts] of Object.entries(modes)) {
    for (const layout of ["stacked", "side-by-side"]) {
      const where = `${mode} ${layout}`;
      const run = compare(caseDir(), {
        before: { image: join(dir, "before.png") }, after: { image: join(dir, "after.png") }, layout, callouts,
        redact: [{ at: [326, 112, 70, 22], style: "block" }],
        details: [{ id: "save", before: saveBefore, after: saveAfter }, { id: "badge", region: badge }],
      });
      assert.equal(run.status, 0, run.stderr);
      const result = run.result;
      assert.equal(result.comparison.layout, layout);
      const outputs = [result.outputs.comparison, ...result.outputs.details];
      for (const output of outputs) assert.equal(greenPixels(output), 0, `${where}: redaction leaked into ${output}`);

      const views = [{ path: result.outputs.comparison, panels: result.comparison.panels },
        ...result.details.map((detail) => ({ path: detail.path, panels: detail.panels }))];
      for (const view of views) {
        const name = `${where} ${view.path.split(/[\\/]/).pop()}`;
        const output = pixels(view.path);
        for (const [key, panel] of Object.entries(view.panels)) {
          const [cx, cy, cw, ch] = panel.canvas;
          const [wx, wy] = panel.source;
          const sourceAt = (x, y) => source[key].at(wx + Math.floor((x - cx) / panel.scale), wy + Math.floor((y - cy) / panel.scale));
          // Each output pixel inside a neighbour's or target's visible part
          // matches its source pixel, except the panel border's antialiased
          // outer ring. A clean comparison leaves the whole panel untouched.
          const kept = mode === "clean" ? { panel: [wx, wy, cw / panel.scale, ch / panel.scale] }
            : { ...neighbours, ...targets[key] };
          // An explicit outline's rounded, antialiased corners may tint the
          // outermost corner pixels of its target's box; compare inside them.
          const outlined = new Set(callouts.filter((item) => item.outline && item[key]).map((item) => item[key]));
          for (const [part, rect] of Object.entries(kept)) {
            const inset = outlined.has(rect) ? 1 : 0;
            const [nx, ny, nw, nh] = [rect[0] + inset, rect[1] + inset, rect[2] - inset * 2, rect[3] - inset * 2];
            let compared = 0;
            for (let y = cy + 1; y < cy + ch - 1; y += 1) {
              for (let x = cx + 1; x < cx + cw - 1; x += 1) {
                const sx = wx + Math.floor((x - cx) / panel.scale);
                const sy = wy + Math.floor((y - cy) / panel.scale);
                if (sx < nx || sx >= nx + nw || sy < ny || sy >= ny + nh) continue;
                if (sx >= 326 && sx < 396 && sy >= 112 && sy < 134) continue; // redacted
                assert.deepEqual(output.at(x, y), sourceAt(x, y), `${name} ${key}: ${part} pixel ${sx},${sy} was covered`);
                compared += 1;
              }
            }
            if (view.path === result.outputs.comparison && part in neighbours) assert.ok(compared > 100, `${part} is visible in the overview`);
          }
          // An outline is drawn only on request: just outside an emphasised
          // target in its callout colour, never around a pin-only target.
          for (const [part, rect] of Object.entries(targets[key])) {
            const canvasRect = viewRect(panel, rect);
            if (canvasRect.x < cx || canvasRect.y < cy || canvasRect.x + canvasRect.width > cx + cw ||
              canvasRect.y + canvasRect.height > cy + ch) continue;
            const points = [2, 3, 4].flatMap((by) => ring(canvasRect, by));
            const callout = callouts.find((item) => item[key] === rect);
            const color = callout && hex(result.callouts.find((item) => item.id === callout.id).color);
            const near = (a, b) => a.every((value, index) => Math.abs(value - b[index]) <= 40);
            if (callout?.outline) {
              const drawn = points.filter(([x, y]) => near(output.at(x, y), color)).length;
              assert.ok(drawn > points.length * 0.25, `${name} ${key}: ${part} outline drawn on ${drawn}/${points.length} ring pixels`);
            } else {
              const changed = points.filter(([x, y]) => !near(output.at(x, y), sourceAt(x, y))).length;
              assert.ok(changed < points.length * 0.06, `${name} ${key}: ${part} looks boxed, ${changed}/${points.length} ring pixels changed`);
            }
          }
        }
      }

      assert.deepEqual(result.calloutIds, callouts.map((callout) => callout.id));
      const markdown = readFileSync(result.outputs.markdown, "utf8");
      if (mode === "clean") {
        assert.equal(result.comparison.legend, null, `${where}: no empty legend`);
        assert.doesNotMatch(markdown, /^- /m, `${where}: no empty callout list`);
        assert.deepEqual(result.limitations, []);
        continue;
      }
      assert.ok(result.comparison.legend, `${where}: callouts keep their legend`);
      assert.ok(result.callouts.every((callout) => Object.values(callout.panels).every((panel) => !panel || panel.pin)), "every region keeps its pin");
      for (const callout of result.callouts) {
        const requested = callouts.find((item) => item.id === callout.id);
        assert.equal(callout.outline, requested.outline === true);
        for (const [key, panel] of Object.entries(callout.panels)) {
          if (!panel) continue;
          assert.equal(Boolean(panel.outline), requested.outline === true, `${where}: callout ${callout.id} outline in ${key}`);
          if (requested.label && !panel.label) {
            assert.match(result.limitations.join("\n"), new RegExp(`Callout ${callout.id} label did not fit in ${key === "before" ? "Before" : "After"}`));
          }
          if (!requested.label) assert.equal(panel.label, null);
          if (!requested.measure) assert.equal(panel.bracket, null);
        }
      }
      if (mode === "emphasis") {
        assert.match(markdown, /- \*\*1\*\*: Save reads Save changes and widened\. Measured width: Before 64 px, After 120 px\./);
      } else {
        assert.match(markdown, /- \*\*2\*\*: Weekly summary gains a New badge\./);
      }
    }
  }
});

test("explicit measurements and outlines render in matched detail crops", media, () => {
  const dir = caseDir();
  // A 60x40 card widens to 90 px on blank space, so a bracket fits beside it.
  image(join(dir, "before.png"), 300, 200, [{ color: "#1f6feb", rect: [100, 80, 60, 40] }]);
  image(join(dir, "after.png"), 300, 200, [{ color: "#1f6feb", rect: [100, 80, 90, 40] }]);
  const run = compare(dir, {
    before: { image: "before.png" }, after: { image: "after.png" },
    callouts: [{ id: 1, text: "The card widens.", before: [100, 80, 60, 40], after: [100, 80, 90, 40], measure: "width", outline: true }],
    details: [{ callout: 1, context: 40, zoom: 2 }],
  });
  assert.equal(run.status, 0, run.stderr);
  const [detail] = run.result.details;
  assert.equal(detail.zoom, 2);
  assert.deepEqual(run.result.limitations, [], "blank space keeps every bracket");
  for (const [key, width] of [["before", 60], ["after", 90]]) {
    const panel = run.result.callouts[0].panels[key];
    assert.ok(panel.outline && panel.bracket, `the overview ${key} panel keeps its outline and bracket`);
    // The detail view draws its own marks around the enlarged target.
    const view = detail.panels[key];
    const target = viewRect(view, [100, 80, width, 40]);
    const output = pixels(detail.path);
    const red = hex(run.result.callouts[0].color);
    const outlined = ring(target, 3).filter(([x, y]) => output.at(x, y).every((value, index) => Math.abs(value - red[index]) <= 40));
    assert.ok(outlined.length > ring(target, 3).length * 0.5, `the detail ${key} panel outlines the target`);
  }
  assert.match(run.result.callouts[0].legend, /Measured width: Before 60 px, After 90 px\./);
});

test("callout outlines must be true or false", media, () => {
  const dir = caseDir();
  cardPair(dir);
  const run = compare(dir, {
    before: { image: "before.png" }, after: { image: "after.png" },
    callouts: [{ id: 1, text: "Card moved.", before: [40, 30, 60, 40], after: [70, 30, 60, 40], outline: "yes" }],
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /callout 1 outline must be true or false/);
});

test("text with ImageMagick escapes and file prefixes renders literally", media, () => {
  const dir = caseDir();
  cardPair(dir);
  const run = compare(dir, {
    before: { image: "before.png", label: "@before 100%" }, after: { image: "after.png", label: "after \\n %w" },
    callouts: [{ text: "@/etc/hostname keeps 100% literal %[pixel:p{0,0}]", label: "@x", region: [150, 100, 20, 20] }],
  });
  assert.equal(run.status, 0, run.stderr);
  assert.match(readFileSync(run.result.outputs.markdown, "utf8"), /@\/etc\/hostname keeps 100% literal/);
});

test("the documented example prepares every asset and Markdown in one invocation", media, () => {
  const text = readFileSync(reference, "utf8");
  // Windows checkouts may convert the reference to CRLF line endings.
  const example = /```json\r?\n([\s\S]*?)\r?\n```/.exec(text);
  assert.ok(example, "comparisons.md carries a JSON example");
  const spec = JSON.parse(example[1]);
  const dir = caseDir();
  for (const key of ["before", "after"]) {
    const shapes = spec.callouts.filter((callout) => !callout.measure).map((callout) => callout[key] ?? callout.region)
      .filter(Boolean).map((rect) => ({ color: "#1f6feb", rect }));
    image(join(dir, spec[key].image), 1280, 800, shapes);
  }
  const run = compare(dir, spec);
  assert.equal(run.status, 0, run.stderr);
  // The example walks the annotation hierarchy: a pin-only note, an outlined
  // subtle target, and a measured gap, each only as emphatic as requested.
  const [note, subtle, gap] = run.result.callouts;
  for (const panel of Object.values(note.panels)) assert.deepEqual([panel.outline, panel.label, panel.bracket], [null, null, null]);
  assert.ok(Object.values(subtle.panels).every((panel) => panel.outline), "the subtle target is outlined in both panels");
  assert.equal(gap.measure, "width");
  assert.match(gap.legend, /Measured width: Before \(main\) 16 px, After \(this PR\) 8 px\./);
  const { outputs } = run.result;
  for (const path of [outputs.comparison, ...outputs.details, outputs.flip, outputs.onion, outputs.markdown, outputs.result]) {
    if (path) assert.ok(existsSync(path), `${path} exists`);
  }
  assert.equal(outputs.details.length, spec.details.length);
  const markdown = readFileSync(outputs.markdown, "utf8");
  for (const callout of spec.callouts) assert.match(markdown, new RegExp(`- \\*\\*${callout.id}\\*\\*: `));
  const references = [...markdown.matchAll(/!\[[^\]\n]+\]\(([^)\s]+)\)/g)].map((match) => match[1]);
  const files = [outputs.comparison, ...outputs.details, outputs.flip, outputs.onion].filter(Boolean)
    .map((path) => path.slice(run.out.length + 1));
  assert.deepEqual(references.sort(), files.sort());
});

test("regions suggests detail crops without choosing one", media, () => {
  const dir = caseDir();
  image(join(dir, "before.png"), 300, 200);
  image(join(dir, "after.png"), 300, 200, [{ color: "#000000", rect: [10, 10, 20, 20] },
    { color: "#000000", rect: [45, 10, 20, 20] }, { color: "#000000", rect: [240, 150, 20, 20] }]);
  const result = spawnSync(process.execPath, [regionsScript, join(dir, "before.png"), join(dir, "after.png"), "--crops"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.regions.length, 3);
  assert.equal(report.crops.length, 2);
  assert.deepEqual(report.crops[0].region, [10, 10, 55, 20], "nearby regions join into one suggestion");
  assert.deepEqual(report.crops[1].region, [240, 150, 20, 20]);
});

// ---------------------------------------------------------------------------
// Anchor capture against a fake browser boundary

const browserBoundary = join(temp, "browser-boundary.mjs");
writeFileSync(browserBoundary, String.raw`
import cp from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const settings = JSON.parse(process.env.FAKE_BROWSER);
let evals = 0;
function png(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from("89504e470d0a1a0a", "hex").copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
cp.execFileSync = (binary, args) => {
  appendFileSync(process.env.FAKE_BROWSER_LOG, JSON.stringify([binary, ...args]) + "\n");
  if (binary !== "agent-browser") throw new Error("unexpected binary " + binary);
  const command = args[2];
  if (command === "eval") {
    const result = settings.measurements[Math.min(evals, settings.measurements.length - 1)];
    evals += 1;
    return JSON.stringify({ success: true, data: { result } });
  }
  if (command === "screenshot") {
    writeFileSync(args.at(-1), png(settings.png.width, settings.png.height));
    return "saved";
  }
  throw new Error("unexpected browser command " + command);
};
syncBuiltinESMExports();
`);

function page(overrides = {}) {
  return {
    url: "http://localhost:3000/settings",
    viewport: { width: 400, height: 300 }, scroll: { x: 0, y: 200 }, document: { width: 400, height: 900 },
    devicePixelRatio: 2, problems: [],
    anchors: { save: { selector: "#save", element: "button#save \"Save\"", rect: { x: 10.5, y: -150, width: 80, height: 24 } } },
    ...overrides,
  };
}

function anchors(args, settings, env = {}) {
  const dir = caseDir();
  const log = join(dir, "browser.log");
  const result = spawnSync(process.execPath, [anchorsScript, ...args.map((arg) => arg.replaceAll("$DIR", dir))], {
    encoding: "utf8",
    env: { ...process.env, ...env, NODE_TEST_CONTEXT: "", NODE_OPTIONS: `--import=${pathToFileURL(browserBoundary).href}`,
      FAKE_BROWSER: JSON.stringify(settings), FAKE_BROWSER_LOG: log },
  });
  const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  return { ...result, dir, calls };
}

test("anchor capture stays inside the named session and records transform metadata", () => {
  const run = anchors(["--session", "after-run", "--anchor", "save=#save", "--screenshot", "$DIR/after.png", "--full", "--out", "$DIR/anchors.json"],
    { measurements: [page(), page()], png: { width: 800, height: 1800 } });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.calls.map((call) => call.slice(0, 4)), [
    ["agent-browser", "--session", "after-run", "eval"],
    ["agent-browser", "--session", "after-run", "screenshot"],
    ["agent-browser", "--session", "after-run", "eval"],
  ]);
  assert.ok(run.calls[1].includes("--full"));
  const record = JSON.parse(readFileSync(join(run.dir, "anchors.json"), "utf8"));
  assert.equal(record.capture.mode, "full");
  assert.deepEqual(record.capture.screenshot, { width: 800, height: 1800 });
  assert.deepEqual(record.capture.scroll, { x: 0, y: 200 });
  assert.equal(record.capture.devicePixelRatio, 2);
  assert.deepEqual(record.anchors.save.image, [21, 100, 160, 48]);
  assert.equal(record.url, "http://localhost:3000/settings");
});

test("anchor capture rejects missing, ambiguous, invalid, and hidden targets with diagnostics", () => {
  const problems = [
    { name: "save", selector: "#save", problem: "missing" },
    { name: "row", selector: ".row", problem: "ambiguous", count: 3, candidates: ["li.row \"One\"", "li.row \"Two\"", "li.row \"Three\""] },
    { name: "bad", selector: "p[", problem: "invalid", detail: "not a valid selector" },
    { name: "menu", selector: "#menu", problem: "empty", candidates: ["div#menu"] },
  ];
  const run = anchors(["--session", "s", "--anchor", "save=#save", "--image", "$DIR/x.png", "--out", "$DIR/anchors.json"],
    { measurements: [page({ problems, anchors: {} })], png: { width: 1, height: 1 } });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /"#save" matched no element on http:\/\/localhost:3000\/settings/);
  assert.match(run.stderr, /matched 3 elements.*Candidates: li\.row "One"; li\.row "Two"/);
  assert.match(run.stderr, /"p\[" is not a valid selector/);
  assert.match(run.stderr, /no rendered box/);
  assert.equal(existsSync(join(run.dir, "anchors.json")), false);
});

test("anchor capture requires an explicit session and refuses moving or mismatched captures", () => {
  const missingSession = anchors(["--anchor", "save=#save", "--image", "$DIR/x.png", "--out", "$DIR/a.json"],
    { measurements: [page()], png: { width: 800, height: 600 } }, { AGENT_BROWSER_SESSION: "someone-else" });
  assert.equal(missingSession.status, 1);
  assert.match(missingSession.stderr, /--session is required/);
  assert.deepEqual(missingSession.calls, []);

  const scrolled = anchors(["--session", "s", "--anchor", "save=#save", "--screenshot", "$DIR/x.png", "--out", "$DIR/a.json"],
    { measurements: [page(), page({ scroll: { x: 0, y: 260 } })], png: { width: 800, height: 600 } });
  assert.equal(scrolled.status, 1);
  assert.match(scrolled.stderr, /page moved while capturing/);

  const wrongSize = anchors(["--session", "s", "--anchor", "save=#save", "--screenshot", "$DIR/x.png", "--out", "$DIR/a.json"],
    { measurements: [page(), page()], png: { width: 400, height: 300 } });
  assert.equal(wrongSize.status, 1);
  assert.match(wrongSize.stderr, /screenshot is 400x300, but the viewport 400x300 at device pixel ratio 2 implies 800x600/);

  const outside = anchors(["--session", "s", "--anchor", "save=#save", "--screenshot", "$DIR/x.png", "--out", "$DIR/a.json"],
    { measurements: [page(), page()], png: { width: 800, height: 600 } });
  assert.equal(outside.status, 1);
  assert.match(outside.stderr, /lies outside the captured viewport.*--full/);
});

// ---------------------------------------------------------------------------
// Optional real-browser check of the whole capture path. Set
// UI_EVIDENCE_BROWSER_TESTS=1 where agent-browser and Chrome are installed.

const browserTests = process.env.UI_EVIDENCE_BROWSER_TESTS === "1" && MAGICK;
test("real captures at a non-unit pixel ratio map anchors onto the rendered pixels", { skip: browserTests ? false : "set UI_EVIDENCE_BROWSER_TESTS=1" }, () => {
  const dir = caseDir();
  const fixture = (name) => pathToFileURL(join(repo, "tests", "fixtures", "ui-evidence-app", name)).href;
  const session = `uie-compare-test-${process.pid}`;
  const browser = (...args) => execFileSync("agent-browser", ["--session", session, ...args], { encoding: "utf8" });
  try {
    const capture = (name, full) => {
      browser("open", fixture(`${name}.html`));
      browser("set", "viewport", "640", "400", "2");
      // A scrolled full-page capture exercises the scroll offset; the viewport
      // capture stays at the top where the toolbar is visible.
      browser("eval", `window.scrollTo(0, ${full ? 120 : 0})`);
      const run = spawnSync(process.execPath, [anchorsScript, "--session", session, "--anchor", "save=[data-testid=save]",
        "--anchor", "email=[data-testid=email]", "--screenshot", join(dir, `${name}.png`), ...(full ? ["--full"] : []),
        "--out", join(dir, `${name}-anchors.json`)], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      return JSON.parse(run.stdout);
    };
    for (const full of [false, true]) {
      const beforeRecord = capture("before", full);
      capture("after", full);
      const [x, y, width] = beforeRecord.anchors.save.image;
      assertColor(rgb(join(dir, "before.png"), x + Math.floor(width / 2), y + 2), [0x1f, 0x6f, 0xeb], 20, "anchored button");
      const out = join(dir, full ? "full" : "viewport");
      mkdirSync(out, { recursive: true });
      const specPath = join(dir, "spec.json");
      writeFileSync(specPath, JSON.stringify({
        before: { image: "before.png", anchors: "before-anchors.json" },
        after: { image: "after.png", anchors: "after-anchors.json" },
        // The after page is taller, so full-page captures differ in height.
        sizeMismatch: "pad",
        redact: [{ anchor: "email", style: "block" }],
        callouts: [{ id: 1, text: "Save moved into the toolbar.", region: { anchor: "save" } }],
        details: [{ callout: 1 }],
      }));
      const run = spawnSync(process.execPath, [compareScript, "--spec", specPath, "--out-dir", out], { encoding: "utf8" });
      assert.equal(run.status, 0, run.stderr);
      assert.equal(JSON.parse(run.stdout).inputs.before.devicePixelRatio, 2);
    }
  } finally {
    try { browser("close"); } catch { /* the session may not have started */ }
  }
});
