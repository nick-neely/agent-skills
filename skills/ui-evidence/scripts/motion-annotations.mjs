// Timed reviewer annotations and storyboard checkpoints for prepare-motion.mjs.
//
// Pure planning: validation, the mapping from source time to output frames,
// coordinate transforms, and layout. prepare-motion.mjs measures text and
// renders with ImageMagick and FFmpeg. Times always refer to the source
// recording, the same timeline as `trim` and `--inspect`.

import { DEFAULT_DISPLAY_WIDTH, PALETTE, chromeFor, escapeAlt, escapeMarkdown } from "./comparison-layout.mjs";

export class AnnotationError extends Error {}

const EPSILON = 1e-9;
const MAX_CAPTION_LINES = 3;
const CAPTION_MODES = ["below", "overlay"];
// Outline colour for a mark without a step, distinct from every step colour.
const UNNUMBERED = "#59636e";

function fail(message) {
  throw new AnnotationError(message);
}

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${name} must be an object`);
  return value;
}

function onlyKeys(value, keys, name) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${name} has unknown field "${key}"`);
}

function seconds(value, name) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(`${name} must be a number of seconds, 0 or more`);
  return value;
}

function displayWidthOf(value, name) {
  const width = value ?? DEFAULT_DISPLAY_WIDTH;
  if (!Number.isInteger(width) || width < 200 || width > 4000) fail(`${name} must be an integer from 200 to 4000`);
  return width;
}

// Captions, keys, and steps without a marked control are shown in the caption
// area, so at most one such event may be visible on any frame.
export const usesCaptionArea = (event) => Boolean(event.caption || event.key || (event.step !== undefined && !event.region));

function text(value, name, max) {
  if (typeof value !== "string" || !value.trim()) fail(`${name} must be non-empty text`);
  const trimmed = value.replace(/\s+/g, " ").trim();
  if ([...trimmed].length > max) fail(`${name} is ${[...trimmed].length} characters; keep it to ${max} or fewer`);
  return trimmed;
}

export const formatTime = (value) => {
  const total = Math.max(0, value);
  const minutes = Math.floor(total / 60);
  return `${minutes}:${(total - minutes * 60).toFixed(1).padStart(4, "0")}`;
};

// FFmpeg's `scale=w=trunc(min(iw,W)/2)*2:h=-2`, computed here so overlays are
// drawn at the exact output size. h=-2 rounds iw*h/w to the nearest even value.
export function outputSize(crop, maxWidth) {
  const width = Math.floor(Math.min(crop.width, maxWidth) / 2) * 2;
  const height = Math.floor((width * crop.height + crop.width) / (2 * crop.width)) * 2;
  return { width, height };
}

// Frame bookkeeping for the prepared clip: a frozen start hold showing the
// source at trim.start, real-time frames at ticks startTick..endTick-1, and a
// frozen end hold showing the source just before trim.end.
export function outputTimeline({ trim, fps, startTick, endTick, startFrames, endFrames }) {
  const actionFrames = endTick - startTick;
  const total = startFrames + actionFrames + endFrames;
  const range = (first, count) => ({ frames: [first, first + count - 1], output: [first / fps, (first + count) / fps] });
  const segments = [];
  if (startFrames) segments.push({ kind: "presentation-hold", source: trim.start, ...range(0, startFrames) });
  segments.push({ kind: "real-time", source: [trim.start, trim.end], ...range(startFrames, actionFrames) });
  if (endFrames) segments.push({ kind: "presentation-hold", source: trim.end, ...range(startFrames + actionFrames, endFrames) });
  return { fps, total, startTick, endTick, startFrames, actionFrames, endFrames, trim, segments };
}

// Output frames that show any source instant in [start, end). A hold shows its
// boundary instant, so an event active at trim.start covers the start hold and
// one still active at trim.end covers the end hold.
export function mapInterval(start, end, timeline) {
  const { fps, trim, startTick, endTick, startFrames, actionFrames, endFrames, total } = timeline;
  const first = Math.max(Math.ceil(start * fps - EPSILON), startTick);
  const stop = Math.min(Math.ceil(end * fps - EPSILON), endTick);
  let from = stop > first ? startFrames + first - startTick : null;
  let to = stop > first ? startFrames + stop - 1 - startTick : null;
  const startHold = startFrames > 0 && start <= trim.start + EPSILON && end > trim.start + EPSILON;
  const endHold = endFrames > 0 && start < trim.end - EPSILON && end >= trim.end - EPSILON;
  if (startHold) {
    from = 0;
    to ??= startFrames - 1;
  }
  if (endHold) {
    to = total - 1;
    from ??= startFrames + actionFrames;
  }
  if (from === null) return null;
  return {
    frames: [from, to], output: { start: from / fps, end: (to + 1) / fps },
    clipped: { start: start < trim.start - EPSILON, end: end > trim.end + EPSILON },
    holds: { start: startHold, end: endHold },
  };
}

// The output frame that shows source instant `at`.
export function mapInstant(at, timeline) {
  const { fps, trim, startTick, endTick, startFrames, actionFrames } = timeline;
  if (at < trim.start - EPSILON || at > trim.end + EPSILON) return null;
  const tick = Math.floor(at * fps + EPSILON);
  const frame = tick < startTick ? startFrames : tick >= endTick ? startFrames + actionFrames - 1
    : startFrames + tick - startTick;
  return { frame, output: frame / fps };
}

// Source rectangle -> output pixels: clip to the crop, translate, and scale.
export function toOutput(at, crop, size, name) {
  if (!Array.isArray(at) || at.length !== 4 || at.some((value) => !Number.isInteger(value))) {
    fail(`${name} must be [x, y, width, height] in whole source pixels`);
  }
  const [x, y, width, height] = at;
  if (x < 0 || y < 0 || width < 1 || height < 1) fail(`${name} needs a non-negative origin and a positive size`);
  if (x + width > crop.sourceWidth || y + height > crop.sourceHeight) {
    fail(`${name} ${at.join(",")} exceeds the ${crop.sourceWidth}x${crop.sourceHeight} source frame`);
  }
  const left = Math.max(x, crop.x);
  const top = Math.max(y, crop.y);
  const right = Math.min(x + width, crop.x + crop.width);
  const bottom = Math.min(y + height, crop.y + crop.height);
  if (right <= left || bottom <= top) fail(`${name} ${at.join(",")} lies outside the crop`);
  const scale = size.width / crop.width;
  const ox = Math.round((left - crop.x) * scale);
  const oy = Math.round((top - crop.y) * scale);
  return {
    x: ox, y: oy,
    width: Math.max(1, Math.round((right - crop.x) * scale) - ox),
    height: Math.max(1, Math.round((bottom - crop.y) * scale) - oy),
    clipped: left !== x || top !== y || right !== x + width || bottom !== y + height,
  };
}

function keycaps(value, name) {
  const key = text(value, name, 40);
  const parts = key.split("+").map((part) => part.trim());
  if (parts.some((part) => !part)) fail(`${name} must name keys joined by "+", such as "Control+R"`);
  return parts;
}

// Validate events against the source and crop, then map them to output frames.
export function planEvents(raw, { source, crop, size, timeline }) {
  if (raw === undefined) return null;
  const spec = object(raw, "annotations");
  onlyKeys(spec, ["captions", "displayWidth", "events"], "annotations");
  const captions = spec.captions ?? "below";
  if (!CAPTION_MODES.includes(captions)) fail(`annotations.captions must be "below" or "overlay"`);
  const displayWidth = displayWidthOf(spec.displayWidth, "annotations.displayWidth");
  if (!Array.isArray(spec.events) || !spec.events.length) fail("annotations.events must list at least one event");
  const events = spec.events.map((item, index) => {
    const name = `annotations.events[${index}]`;
    object(item, name);
    onlyKeys(item, ["start", "end", "step", "caption", "key", "at"], name);
    const start = seconds(item.start, `${name}.start`);
    const end = seconds(item.end, `${name}.end`);
    if (end <= start) fail(`${name} ends at ${end}s, not after its start at ${start}s`);
    if (start >= source.duration) fail(`${name} starts at ${start}s, after the ${source.duration.toFixed(3)}s source ends`);
    if (item.step !== undefined && (!Number.isInteger(item.step) || item.step < 1 || item.step > 99)) {
      fail(`${name}.step must be an integer from 1 to 99`);
    }
    if (item.caption === undefined && item.step === undefined && item.key === undefined && item.at === undefined) {
      fail(`${name} needs a caption, a step, a key, or an "at" region to outline`);
    }
    const mapped = mapInterval(start, end, timeline);
    if (!mapped) {
      fail(`${name} (${start}-${end}s) shows on no output frame: it lies outside the trim ` +
        `${timeline.trim.start}-${timeline.trim.end}s or is shorter than one frame at ${timeline.fps} fps`);
    }
    return {
      index, start, end,
      ...(item.step !== undefined ? { step: item.step } : {}),
      ...(item.caption !== undefined ? { caption: text(item.caption, `${name}.caption`, 160) } : {}),
      ...(item.key !== undefined ? { key: keycaps(item.key, `${name}.key`) } : {}),
      ...(item.at !== undefined ? { at: item.at, region: toOutput(item.at, crop, size, `${name}.at`) } : {}),
      color: item.step === undefined ? UNNUMBERED : PALETTE[(item.step - 1) % PALETTE.length],
      ...mapped,
    };
  });
  const captioned = events.filter(usesCaptionArea);
  for (let a = 0; a < captioned.length; a += 1) {
    for (let b = a + 1; b < captioned.length; b += 1) {
      const [x, y] = [captioned[a], captioned[b]];
      if (x.frames[0] <= y.frames[1] && y.frames[0] <= x.frames[1]) {
        fail(`annotations.events[${x.index}] and [${y.index}] both show a caption at output frame ` +
          `${Math.max(x.frames[0], y.frames[0])}; give captions separate intervals`);
      }
    }
  }
  return { captions, displayWidth, events };
}

// Layout at the output size: each marked control's outline and pin, and each
// caption-area event's pin, keycaps, and wrapped text. measure(text,
// pointsize, wrapWidth) returns rendered { width, height }.
export function layoutCaptions(plan, size, measure) {
  const chrome = chromeFor(size.width, plan.displayWidth);
  const pad = chrome.headerPad;
  const font = chrome.legendFont;
  const line = measure("Ag", font).height;
  const keyFont = chrome.labelFont;
  const layouts = new Map();
  let tallest = 0;
  for (const event of plan.events) {
    const layout = { marks: null, items: [], text: null, height: 0 };
    if (event.region) {
      // The outline sits just outside the control so it never covers it.
      const gap = Math.ceil(chrome.stroke / 2) + 2;
      const left = Math.max(0, event.region.x - gap);
      const top = Math.max(0, event.region.y - gap);
      const outline = { x: left, y: top,
        width: Math.min(size.width, event.region.x + event.region.width + gap) - left,
        height: Math.min(size.height, event.region.y + event.region.height + gap) - top };
      const pin = event.step === undefined ? null : {
        cx: Math.min(Math.max(outline.x, chrome.radius), size.width - chrome.radius),
        cy: Math.min(Math.max(outline.y, chrome.radius), size.height - chrome.radius),
      };
      layout.marks = { outline, corner: Math.max(3, chrome.radius / 3), pin };
    }
    if (usesCaptionArea(event)) {
      let x = pad;
      if (event.step !== undefined) {
        layout.items.push({ type: "pin", x, size: chrome.radius * 2 });
        x += chrome.radius * 2 + chrome.gap * 2;
      }
      for (const part of event.key ?? []) {
        const measured = measure(part, keyFont);
        const width = measured.width + chrome.labelPad * 2;
        layout.items.push({ type: "key", x, text: part, width, height: measured.height + chrome.labelPad * 2 });
        x += width + chrome.gap;
      }
      if (event.key) x += chrome.gap;
      if (event.caption) {
        const wrap = size.width - x - pad;
        if (wrap < font * 4) fail(`annotations.events[${event.index}] leaves no room for its caption at ${size.width}px; shorten the key or widen the output`);
        const measured = measure(event.caption, font, wrap);
        const lines = Math.round(measured.height / line);
        if (lines > MAX_CAPTION_LINES) {
          fail(`annotations.events[${event.index}].caption needs ${lines} lines at the ${plan.displayWidth}px display width; ` +
            `shorten it to ${MAX_CAPTION_LINES} lines or fewer`);
        }
        layout.text = { x, width: wrap, height: measured.height };
      }
      layout.height = Math.max(chrome.radius * 2, layout.text?.height ?? 0, ...layout.items.map((item) => item.height ?? 0));
      tallest = Math.max(tallest, layout.height);
    }
    layouts.set(event.index, layout);
  }
  // Even, because H.264 with yuv420p needs even frame dimensions.
  const band = tallest ? Math.ceil((tallest + pad * 2) / 2) * 2 : 0;
  const box = tallest ? { y: plan.captions === "below" ? size.height : size.height - band, height: band } : null;
  if (box && plan.captions === "overlay") {
    for (const event of plan.events) {
      const mark = layouts.get(event.index).marks;
      if (mark && mark.outline.y + mark.outline.height > box.y) {
        fail(`annotations.events[${event.index}].at lies under the overlay caption area; ` +
          'use "captions": "below" so the caption does not cover the control');
      }
    }
  }
  return { chrome, pad, font, keyFont, band: plan.captions === "below" ? band : 0, box, layouts };
}

// The report's view of planned events: what shows, when, and where.
export function annotationReport(plan, layout) {
  return {
    captions: plan.captions, band: layout.band, displayWidth: plan.displayWidth,
    events: plan.events.map((event) => ({
      index: event.index, ...(event.step !== undefined ? { step: event.step } : {}),
      ...(event.key ? { key: event.key.join("+") } : {}), ...(event.caption ? { caption: event.caption } : {}),
      source: { start: event.start, end: event.end }, output: event.output, frames: event.frames,
      clipped: event.clipped, holds: event.holds,
      ...(event.region ? { region: [event.region.x, event.region.y, event.region.width, event.region.height],
        regionClipped: event.region.clipped } : {}),
    })),
  };
}

// Storyboard checkpoints in source time, strictly ordered.
// Without its own displayWidth, the storyboard uses the annotations' width.
export function planStoryboard(raw, timeline, source, defaultWidth = DEFAULT_DISPLAY_WIDTH) {
  if (raw === undefined) return null;
  const spec = object(raw, "storyboard");
  onlyKeys(spec, ["checkpoints", "columns", "displayWidth"], "storyboard");
  if (!Array.isArray(spec.checkpoints) || !spec.checkpoints.length || spec.checkpoints.length > 8) {
    fail("storyboard.checkpoints must list 1 to 8 meaningful moments");
  }
  const displayWidth = displayWidthOf(spec.displayWidth ?? defaultWidth, "storyboard.displayWidth");
  if (spec.columns !== undefined && (!Number.isInteger(spec.columns) || spec.columns < 1 || spec.columns > 4)) {
    fail("storyboard.columns must be an integer from 1 to 4");
  }
  let previous = -Infinity;
  const checkpoints = spec.checkpoints.map((item, index) => {
    const name = `storyboard.checkpoints[${index}]`;
    object(item, name);
    onlyKeys(item, ["at", "label"], name);
    const at = seconds(item.at, `${name}.at`);
    if (at > source.duration + 1e-6) fail(`${name}.at ${at}s is after the ${source.duration.toFixed(3)}s source`);
    if (at <= previous) fail(`${name}.at ${at}s must come after the previous checkpoint at ${previous}s`);
    previous = at;
    const mapped = mapInstant(at, timeline);
    if (!mapped) fail(`${name}.at ${at}s is outside the trim ${timeline.trim.start}-${timeline.trim.end}s`);
    return { index: index + 1, at, label: text(item.label, `${name}.label`, 160), ...mapped };
  });
  return { checkpoints, displayWidth, columns: spec.columns ?? null };
}

// Grid for the storyboard PNG, drawn at twice the display width so text and
// panels stay sharp when GitHub scales the image down.
export function layoutStoryboard(plan, frameSize, measure) {
  const scale = 2;
  const width = plan.displayWidth * scale;
  const chrome = chromeFor(width, width / scale);
  const gap = chrome.gap * 3;
  const fit = Math.floor((plan.displayWidth + gap / scale) / (Math.min(frameSize.width, 360) + gap / scale));
  const columns = plan.columns ?? Math.max(1, Math.min(plan.checkpoints.length, 4, fit));
  const panelWidth = Math.floor((width - gap * (columns + 1)) / columns);
  const imageScale = Math.min(panelWidth / frameSize.width, scale * 2);
  const image = { width: Math.round(frameSize.width * imageScale), height: Math.round(frameSize.height * imageScale) };
  const textX = chrome.radius * 2 + chrome.gap * 2;
  const panels = plan.checkpoints.map((checkpoint) => {
    const caption = measure(checkpoint.label, chrome.legendFont, panelWidth - textX);
    const time = `${formatTime(checkpoint.output)} in the clip, source ${checkpoint.at.toFixed(2)}s`;
    const timing = measure(time, chrome.labelFont, panelWidth - textX);
    return { checkpoint, caption, time, timing };
  });
  const rows = [];
  for (let index = 0; index < panels.length; index += columns) rows.push(panels.slice(index, index + columns));
  let y = gap;
  const placed = [];
  for (const row of rows) {
    const textHeight = Math.max(...row.map((panel) => panel.caption.height + chrome.gap + panel.timing.height), chrome.radius * 2);
    row.forEach((panel, column) => {
      const x = gap + column * (panelWidth + gap);
      const textY = y + image.height + chrome.gap * 2;
      placed.push({ ...panel, x, y, image: { ...image, x: x + Math.floor((panelWidth - image.width) / 2), y },
        text: { x: x + textX, y: textY, width: panelWidth - textX,
          height: panel.caption.height + chrome.gap + panel.timing.height },
        timeY: textY + panel.caption.height + chrome.gap,
        pin: { cx: x + chrome.radius, cy: textY + chrome.radius } });
    });
    y += image.height + chrome.gap * 2 + textHeight + gap;
  }
  return { width, height: y, columns, chrome, panels: placed, scale };
}

export function storyboardReport(plan, layout, out) {
  return {
    out, columns: layout.columns, displayWidth: plan.displayWidth, size: [layout.width, layout.height],
    checkpoints: plan.checkpoints.map((checkpoint) => ({ index: checkpoint.index, label: checkpoint.label,
      source: checkpoint.at, output: checkpoint.output, frame: checkpoint.frame, time: formatTime(checkpoint.output) })),
    panels: layout.panels.map((panel) => ({ index: panel.checkpoint.index,
      image: [panel.image.x, panel.image.y, panel.image.width, panel.image.height],
      text: [panel.text.x, panel.text.y, panel.text.width, panel.text.height], labelHeight: panel.caption.height })),
  };
}

// The publisher reads `![alt](path)`; a path with spaces or parentheses needs
// the angle-bracket form.
const link = (path) => (/[\s()<>]/.test(path) ? `<${path}>` : path);

// Publisher-compatible Markdown for the prepared clip: optional heading and
// prose, the standalone video, the timed steps, and the optional storyboard.
export function motionMarkdown({ title, summary, video, events, storyboard }) {
  const lines = [];
  if (title) lines.push(`#### ${escapeMarkdown(title)}`, "");
  if (summary) lines.push(escapeMarkdown(summary), "");
  // A video is a standalone empty-alt reference; a GIF is an image and needs
  // descriptive alt text.
  const alt = /\.gif$/i.test(video) ? escapeAlt(`Animated recording: ${summary ?? title ?? "the interaction"}`) : "";
  lines.push(`![${alt}](${link(video)})`, "");
  const captioned = (events ?? []).filter(usesCaptionArea);
  if (captioned.length) {
    for (const event of captioned) {
      const label = [event.step !== undefined ? `Step ${event.step}` : null, event.key ? `Key ${event.key.join("+")}` : null]
        .filter(Boolean).join(", ");
      lines.push(`- **${formatTime(event.output.start)}-${formatTime(event.output.end)}**` +
        `${label ? ` (${escapeMarkdown(label)})` : ""}${event.caption ? `: ${escapeMarkdown(event.caption)}` : ""}`);
    }
    lines.push("");
  }
  if (storyboard) {
    const count = storyboard.checkpoints.length;
    const boardAlt = `Storyboard of ${count} moment${count === 1 ? "" : "s"} from the clip: ` +
      storyboard.checkpoints.map((checkpoint) => `${checkpoint.index} ${checkpoint.label}`).join("; ");
    lines.push(`![${escapeAlt(boardAlt)}](${link(storyboard.file)})`, "");
    for (const checkpoint of storyboard.checkpoints) {
      lines.push(`${checkpoint.index}. **${formatTime(checkpoint.output)}** (source ${checkpoint.at.toFixed(2)}s): ` +
        escapeMarkdown(checkpoint.label));
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
