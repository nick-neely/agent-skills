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
// Shown in the caption area on every inserted reading pause, so a frozen frame
// is never mistaken for the app's real timing.
export const PAUSE_LABEL = "Paused for reading";

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

// m:ss.s, rounded to tenths before splitting so 59.97 reads 1:00.0.
export const formatTime = (value) => {
  const tenths = Math.round(Math.max(0, value) * 10);
  const minutes = Math.floor(tenths / 600);
  return `${minutes}:${((tenths - minutes * 600) / 10).toFixed(1).padStart(4, "0")}`;
};

// FFmpeg's `scale=w=trunc(min(iw,W)/2)*2:h=-2`, computed here so overlays are
// drawn at the exact output size. h=-2 rounds iw*h/w to the nearest even value.
export function outputSize(crop, maxWidth) {
  const width = Math.floor(Math.min(crop.width, maxWidth) / 2) * 2;
  const height = Math.floor((width * crop.height + crop.width) / (2 * crop.width)) * 2;
  return { width, height };
}

// Frame bookkeeping for the prepared clip: a frozen start hold showing the
// source at trim.start, real-time frames at ticks startTick..endTick-1, any
// inserted reading pauses that freeze one tick, and a frozen end hold showing
// the source just before trim.end. Every hold is a labelled presentation hold.
export function outputTimeline({ trim, fps, startTick, endTick, startFrames, endFrames, pauses = [] }) {
  const segments = [];
  let frame = 0;
  const push = (segment, count) => {
    segments.push({ ...segment, frames: [frame, frame + count - 1], output: [frame / fps, (frame + count) / fps] });
    frame += count;
  };
  if (startFrames) push({ kind: "presentation-hold", boundary: "start", source: trim.start }, startFrames);
  let tick = startTick;
  const real = (to) => push({ kind: "real-time", ticks: [tick, to - 1],
    source: [tick === startTick ? trim.start : tick / fps, to === endTick ? trim.end : to / fps] }, to - tick);
  for (const pause of [...pauses].sort((a, b) => a.tick - b.tick)) {
    real(pause.tick + 1);
    push({ kind: "presentation-hold", inserted: true, tick: pause.tick, source: pause.tick / fps }, pause.frames);
    tick = pause.tick + 1;
  }
  if (tick < endTick) real(endTick);
  if (endFrames) push({ kind: "presentation-hold", boundary: "end", source: trim.end }, endFrames);
  const pauseFrames = pauses.reduce((sum, pause) => sum + pause.frames, 0);
  return { fps, total: frame, startTick, endTick, startFrames, actionFrames: endTick - startTick, endFrames, pauseFrames,
    trim, segments, lastRealFrame: segments.filter((segment) => segment.ticks).at(-1).frames[1] };
}

// Output frames that show any source instant in [start, end). A real-time or
// inserted-pause frame shows its tick; the start hold shows trim.start and the
// end hold shows the source just before trim.end.
export function mapInterval(start, end, timeline) {
  const { fps, trim } = timeline;
  const first = Math.ceil(start * fps - EPSILON);
  const stop = Math.ceil(end * fps - EPSILON);
  const startHold = timeline.startFrames > 0 && start <= trim.start + EPSILON && end > trim.start + EPSILON;
  const endHold = timeline.endFrames > 0 && start < trim.end - EPSILON && end >= trim.end - EPSILON;
  let from = null;
  let to = null;
  const add = (a, b) => {
    from = from === null ? a : Math.min(from, a);
    to = to === null ? b : Math.max(to, b);
  };
  for (const segment of timeline.segments) {
    if (segment.ticks) {
      const a = Math.max(segment.ticks[0], first);
      const b = Math.min(segment.ticks[1], stop - 1);
      if (b >= a) add(segment.frames[0] + a - segment.ticks[0], segment.frames[0] + b - segment.ticks[0]);
    } else if (segment.inserted ? segment.tick >= first && segment.tick < stop
      : segment.boundary === "start" ? startHold : endHold) add(...segment.frames);
  }
  if (from === null) return null;
  return {
    frames: [from, to], output: { start: from / fps, end: (to + 1) / fps },
    clipped: { start: start < trim.start - EPSILON, end: end > trim.end + EPSILON },
    holds: { start: startHold, end: endHold },
  };
}

// The real-time output frame that shows source instant `at`.
export function mapInstant(at, timeline) {
  const { fps, trim, startTick, endTick } = timeline;
  if (at < trim.start - EPSILON || at > trim.end + EPSILON) return null;
  const tick = Math.min(Math.max(Math.floor(at * fps + EPSILON), startTick), endTick - 1);
  const segment = timeline.segments.find((item) => item.ticks && tick >= item.ticks[0] && tick <= item.ticks[1]);
  const frame = segment.frames[0] + tick - segment.ticks[0];
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
// `timing` is the timeline without pauses; reading pauses come from event holds.
export function planEvents(raw, { source, crop, size, timeline: timing }) {
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
    onlyKeys(item, ["start", "end", "step", "caption", "key", "at", "hold"], name);
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
    let hold = null;
    if (item.hold !== undefined) {
      if (typeof item.hold !== "number" || !Number.isFinite(item.hold) || item.hold < 0.2 || item.hold > 10) {
        fail(`${name}.hold must be 0.2 to 10 seconds of added reading time`);
      }
      // The pause freezes the first frame that shows the event.
      const tick = Math.ceil(start * timing.fps - EPSILON);
      if (tick < timing.startTick || tick >= timing.endTick) {
        fail(`${name}.hold needs the event to start inside the trim ${timing.trim.start}-${timing.trim.end}s`);
      }
      hold = { seconds: item.hold, tick, frames: Math.max(1, Math.round(item.hold * timing.fps)) };
    }
    return {
      index, start, end, ...(hold ? { hold } : {}),
      ...(item.step !== undefined ? { step: item.step } : {}),
      ...(item.caption !== undefined ? { caption: text(item.caption, `${name}.caption`, 160) } : {}),
      ...(item.key !== undefined ? { key: keycaps(item.key, `${name}.key`) } : {}),
      ...(item.at !== undefined ? { at: item.at, region: toOutput(item.at, crop, size, `${name}.at`) } : {}),
      color: item.step === undefined ? UNNUMBERED : PALETTE[(item.step - 1) % PALETTE.length],
    };
  });
  const pauses = events.filter((event) => event.hold).map((event) => ({ tick: event.hold.tick, frames: event.hold.frames, index: event.index }));
  for (let index = 1; index < pauses.length; index += 1) {
    const clash = pauses.slice(0, index).find((pause) => pause.tick === pauses[index].tick);
    if (clash) fail(`annotations.events[${clash.index}] and [${pauses[index].index}] both hold the same frame; keep one hold`);
  }
  const timeline = outputTimeline({ ...timing, pauses });
  for (const event of events) {
    const mapped = mapInterval(event.start, event.end, timeline);
    if (!mapped) {
      fail(`annotations.events[${event.index}] (${event.start}-${event.end}s) shows on no output frame: it lies outside the trim ` +
        `${timing.trim.start}-${timing.trim.end}s or is shorter than one frame at ${timing.fps} fps`);
    }
    Object.assign(event, mapped);
  }
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
  return { captions, displayWidth, events, timeline };
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
  const pauses = plan.timeline.segments.filter((segment) => segment.inserted);
  let badge = null;
  if (pauses.length) {
    const measured = measure(PAUSE_LABEL, keyFont);
    badge = { text: PAUSE_LABEL, width: measured.width + chrome.labelPad * 2, height: measured.height + chrome.labelPad * 2,
      ranges: pauses.map((segment) => segment.frames) };
    badge.x = size.width - pad - badge.width;
  }
  // Captions leave room for the pause badge at the right of the caption area.
  const right = badge ? badge.width + chrome.gap * 2 : 0;
  let tallest = badge ? Math.max(badge.height, chrome.radius * 2) : 0;
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
      // Keycaps never wrap, so the row itself must fit, with or without a caption.
      if (x - chrome.gap > size.width - pad - right) {
        fail(`annotations.events[${event.index}].key "${event.key.join("+")}" does not fit in the ${size.width}px output; ` +
          "shorten it or widen the output");
      }
      if (event.key) x += chrome.gap;
      if (event.caption) {
        const wrap = size.width - x - pad - right;
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
    // A box taller than the frame would start above it and clip its own text.
    if (band > size.height) {
      fail(`annotations.captions "overlay" needs a ${band}px caption area, taller than the ${size.width}x${size.height} ` +
        `output frame${badge ? " (including the pause badge)" : ""}; use "captions": "below" or a taller crop`);
    }
    // The overlay box shows only while a caption-area event or a pause is on screen.
    const covered = [...plan.events.filter(usesCaptionArea).map((event) => event.frames), ...(badge?.ranges ?? [])];
    for (const event of plan.events) {
      const mark = layouts.get(event.index).marks;
      if (mark && mark.outline.y + mark.outline.height > box.y &&
          covered.some(([a, b]) => a <= event.frames[1] && event.frames[0] <= b)) {
        fail(`annotations.events[${event.index}].at lies under the overlay caption area while a caption shows; ` +
          'use "captions": "below" so the caption does not cover the control');
      }
    }
  }
  return { chrome, pad, font, keyFont, band: plan.captions === "below" ? band : 0, box, layouts, badge };
}

// The report's view of planned events: what shows, when, and where.
export function annotationReport(plan, layout) {
  return {
    captions: plan.captions, band: layout.band, displayWidth: plan.displayWidth,
    events: plan.events.map((event) => ({
      index: event.index, ...(event.step !== undefined ? { step: event.step } : {}),
      ...(event.key ? { key: event.key.join("+") } : {}), ...(event.caption ? { caption: event.caption } : {}),
      source: { start: event.start, end: event.end }, output: event.output, frames: event.frames,
      clipped: event.clipped, holds: event.holds, ...(event.hold ? { hold: event.hold.seconds } : {}),
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
  const maxColumns = fittingColumns(displayWidth);
  if (spec.columns !== undefined && spec.columns > maxColumns) {
    fail(`storyboard.columns ${spec.columns} leaves no room for labels at displayWidth ${displayWidth}; ` +
      `use at most ${maxColumns} column${maxColumns === 1 ? "" : "s"}, or a wider displayWidth`);
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
  return { checkpoints, displayWidth, columns: spec.columns ?? null, maxColumns };
}

// Panel and label widths for a storyboard drawn at twice the display width.
function storyboardGrid(displayWidth, columns) {
  const scale = 2;
  const width = displayWidth * scale;
  const chrome = chromeFor(width, width / scale);
  const gap = chrome.gap * 3;
  const panelWidth = Math.floor((width - gap * (columns + 1)) / columns);
  const textX = chrome.radius * 2 + chrome.gap * 2;
  return { scale, width, chrome, gap, panelWidth, textX, textWidth: panelWidth - textX };
}

// The most columns (up to 4) whose labels keep room for six legend characters.
function fittingColumns(displayWidth) {
  const minimum = storyboardGrid(displayWidth, 1).chrome.legendFont * 6;
  let columns = 4;
  while (columns > 1 && storyboardGrid(displayWidth, columns).textWidth < minimum) columns -= 1;
  return columns;
}

// Grid for the storyboard PNG, drawn at twice the display width so text and
// panels stay sharp when GitHub scales the image down.
export function layoutStoryboard(plan, frameSize, measure) {
  const base = storyboardGrid(plan.displayWidth, 1);
  const fit = Math.floor((plan.displayWidth + base.gap / base.scale) / (Math.min(frameSize.width, 360) + base.gap / base.scale));
  const columns = plan.columns ?? Math.max(1, Math.min(plan.checkpoints.length, plan.maxColumns, fit));
  const { scale, width, chrome, gap, panelWidth } = storyboardGrid(plan.displayWidth, columns);
  const imageScale = Math.min(panelWidth / frameSize.width, scale * 2);
  const image = { width: Math.round(frameSize.width * imageScale), height: Math.round(frameSize.height * imageScale) };
  const { textX } = storyboardGrid(plan.displayWidth, columns);
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
      const label = [event.step !== undefined ? `Step ${event.step}` : null, event.key ? `Key ${event.key.join("+")}` : null,
        event.hold ? `paused ${event.hold.seconds}s for reading` : null].filter(Boolean).join(", ");
      lines.push(`- **${formatTime(event.output.start)}-${formatTime(event.output.end)}**` +
        `${label ? ` (${escapeMarkdown(label)})` : ""}${event.caption ? `: ${escapeMarkdown(event.caption)}` : ""}`);
    }
    lines.push("");
    if ((events ?? []).some((event) => event.hold)) {
      lines.push(`Frames marked "${PAUSE_LABEL}" are added presentation holds; the rest of the clip runs in real time.`, "");
    }
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
