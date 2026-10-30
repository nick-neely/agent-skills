// Pure geometry, layout, and Markdown rules for before/after comparisons.
//
// Nothing here touches the filesystem, a browser, or ImageMagick. Text sizes
// come from an injected `measure(text, pointsize, wrapWidth?)` function, so the
// placement rules can be tested with a fake measurer and rendered by
// compare.mjs with real font metrics.

// Dark enough for a white pin number on every entry. The same ID keeps the same
// colour in both panels, detail views, and the legend; the number still carries
// the meaning, never the colour alone.
export const PALETTE = ["#cf222e", "#0969da", "#1a7f37", "#9a6700", "#8250df", "#bf3989"];

// GitHub renders PR description images at roughly this width on desktop.
export const DEFAULT_DISPLAY_WIDTH = 880;
const MIN_CANVAS_WIDTH = 360;

export function rectFrom(value, what) {
  if (!Array.isArray(value) || value.length !== 4 ||
    !value.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new Error(`${what} must be [x, y, width, height] with finite numbers, got ${JSON.stringify(value)}`);
  }
  const [x, y, width, height] = value;
  if (width <= 0 || height <= 0) {
    throw new Error(`${what} must have a positive width and height, got ${width}x${height}`);
  }
  return { x, y, width, height };
}

export const asArray = (rect) => [rect.x, rect.y, rect.width, rect.height];
const right = (rect) => rect.x + rect.width;
const bottom = (rect) => rect.y + rect.height;

export function intersect(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(right(a), right(b)) - x;
  const height = Math.min(bottom(a), bottom(b)) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

export function union(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(right(a), right(b)) - x, height: Math.max(bottom(a), bottom(b)) - y };
}

export const expand = (rect, by) =>
  ({ x: rect.x - by, y: rect.y - by, width: rect.width + by * 2, height: rect.height + by * 2 });

export const contains = (outer, inner) =>
  inner.x >= outer.x && inner.y >= outer.y && right(inner) <= right(outer) && bottom(inner) <= bottom(outer);

// Snap outward so a fractional browser rectangle still covers every pixel the
// element touched.
export function snapOut(rect) {
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  return { x, y, width: Math.ceil(right(rect)) - x, height: Math.ceil(bottom(rect)) - y };
}

// The screenshot an anchor record expects, given how it was captured. A
// viewport capture covers the visible viewport; a full-page capture covers the
// scrollable document from its origin.
export function expectedScreenshotSize(capture) {
  const area = capture.mode === "full" ? capture.document : capture.viewport;
  return {
    width: Math.round(area.width * capture.devicePixelRatio),
    height: Math.round(area.height * capture.devicePixelRatio),
  };
}

// `rect` is getBoundingClientRect() at capture time: CSS pixels relative to the
// viewport. A full-page screenshot starts at the document origin, so add the
// scroll offset; then convert CSS pixels to screenshot pixels.
export function anchorToImageRect(rect, capture) {
  const dpr = capture.devicePixelRatio;
  if (!(dpr > 0)) throw new Error(`capture devicePixelRatio must be positive, got ${dpr}`);
  const offsetX = capture.mode === "full" ? capture.scroll.x : 0;
  const offsetY = capture.mode === "full" ? capture.scroll.y : 0;
  return snapOut({
    x: (rect.x + offsetX) * dpr,
    y: (rect.y + offsetY) * dpr,
    width: rect.width * dpr,
    height: rect.height * dpr,
  });
}

// Group nearby changed regions into crop suggestions. The agent still decides
// which suggestion, if any, proves a claim.
export function suggestCrops(regions, bounds, { gap = 24, context = 24 } = {}) {
  const parent = regions.map((_, index) => index);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < regions.length; i += 1) {
    for (let j = i + 1; j < regions.length; j += 1) {
      if (intersect(expand(regions[i], gap / 2), expand(regions[j], gap / 2))) parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  regions.forEach((region, index) => {
    const root = find(index);
    const group = groups.get(root) ?? { region, members: [] };
    group.region = group.members.length ? union(group.region, region) : region;
    group.members.push(index);
    groups.set(root, group);
  });
  return [...groups.values()]
    .map((group) => ({
      region: asArray(group.region),
      window: asArray(fitWindow(expand(group.region, context), bounds)),
      members: group.members,
    }))
    .sort((a, b) => b.region[2] * b.region[3] - a.region[2] * a.region[3]);
}

// Keep a window's size where possible and shift it inside the image, so both
// panels of a detail view stay the same size and edge regions keep context on
// the far side instead of being truncated.
export function fitWindow(rect, bounds) {
  const width = Math.min(Math.round(rect.width), bounds.width);
  const height = Math.min(Math.round(rect.height), bounds.height);
  const x = Math.min(Math.max(0, Math.round(rect.x)), bounds.width - width);
  const y = Math.min(Math.max(0, Math.round(rect.y)), bounds.height - height);
  return { x, y, width, height };
}

// Shared mode uses the same source coordinates for both panels, so movement
// stays visible. With padded sizes the window may extend past the smaller
// screenshot; the renderer fills that area rather than moving the window. Separate mode centres an equal-size window on each panel's own
// region, for elements that moved too far for one window to show both.
export function detailWindows({ before, after, sizes, context, separate = false }) {
  if (!separate || !before || !after) {
    const region = before && after ? union(before, after) : before ?? after;
    const window = fitWindow(expand(region, context), {
      width: Math.max(sizes.before.width, sizes.after.width),
      height: Math.max(sizes.before.height, sizes.after.height),
    });
    return { mode: "shared", before: window, after: window };
  }
  const bounds = {
    width: Math.min(sizes.before.width, sizes.after.width),
    height: Math.min(sizes.before.height, sizes.after.height),
  };
  const width = Math.min(Math.max(before.width, after.width) + context * 2, bounds.width);
  const height = Math.min(Math.max(before.height, after.height) + context * 2, bounds.height);
  const centred = (region, size) => fitWindow({
    x: region.x + region.width / 2 - width / 2,
    y: region.y + region.height / 2 - height / 2,
    width, height,
  }, size);
  return { mode: "separate", before: centred(before, sizes.before), after: centred(after, sizes.after) };
}

// Wide captures stack so each panel keeps the full rendered width; tall or
// square captures sit side by side so both stay on screen together.
export function chooseLayout(requested, size) {
  if (requested === "side-by-side" || requested === "stacked") return requested;
  if (requested !== undefined && requested !== "auto") {
    throw new Error(`layout must be "auto", "side-by-side", or "stacked", got ${JSON.stringify(requested)}`);
  }
  return size.width <= size.height * 1.25 ? "side-by-side" : "stacked";
}

// Chrome scales with the canvas so it reads at the width GitHub renders the
// image, not only when the image is opened at full size.
export function chromeFor(contentWidth, displayWidth = DEFAULT_DISPLAY_WIDTH) {
  const unit = Math.max(1, Math.round((contentWidth / displayWidth) * 100) / 100);
  const size = (value, minimum = 1) => Math.max(minimum, Math.round(value * unit));
  const radius = size(13);
  const gap = size(6);
  return {
    unit,
    radius,
    gap,
    gutter: radius * 2 + gap * 2,
    stroke: size(3, 2),
    ring: size(2, 1),
    pinFont: size(15),
    headerFont: size(18),
    headerPad: size(8),
    labelFont: size(14),
    labelPad: size(5),
    legendFont: size(16),
  };
}

// label:, caption:, and -annotate expand `%` escapes, and a leading `@` reads
// a file. Spec text is data, so neutralize both.
export function imText(text) {
  const escaped = String(text).replace(/\\/g, "\\\\").replace(/%/g, "%%");
  return escaped.startsWith("@") ? `\\${escaped}` : escaped;
}

// ImageMagick arguments for a numbered pin: a filled circle with a white ring
// and a centred number, on a transparent square of the pin's diameter.
export function numberedPinArgs(id, color, chrome, font) {
  const d = chrome.radius * 2;
  const c = (d - 1) / 2;
  const digits = String(id).length;
  const pointsize = Math.max(6, Math.round(chrome.pinFont * (digits >= 3 ? 0.62 : digits === 2 ? 0.8 : 1)));
  return ["-size", `${d}x${d}`, "xc:none", "-fill", color, "-stroke", "#ffffff", "-strokewidth", String(chrome.ring),
    "-draw", `circle ${c},${c} ${c},${chrome.ring / 2}`, "-stroke", "none", "-fill", "#ffffff",
    "-font", font, "-pointsize", String(pointsize), "-gravity", "center", "-annotate", "+0+0", String(id),
    "-gravity", "NorthWest"];
}

// Liang-Barsky clipping: does the segment pass through the rectangle's interior?
export function segmentCrosses(segment, rect) {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  let low = 0;
  let high = 1;
  for (const [p, q] of [[-dx, segment.x1 - rect.x], [dx, right(rect) - segment.x1],
    [-dy, segment.y1 - rect.y], [dy, bottom(rect) - segment.y1]]) {
    if (p === 0) {
      if (q <= 0) return false;
    } else {
      const t = q / p;
      if (p < 0) low = Math.max(low, t);
      else high = Math.min(high, t);
      if (low >= high) return false;
    }
  }
  return true;
}

function nearestPoint(rect, x, y) {
  return {
    x: Math.min(Math.max(x, rect.x), right(rect)),
    y: Math.min(Math.max(y, rect.y), bottom(rect)),
  };
}

// Places marks for one panel. Every mark must stay inside `bounds` (the panel
// plus its side and bottom gutters) and avoid `obstacles` (other marks and
// every changed region, so nothing hides the change it explains).
class PanelPlacer {
  constructor(panel, bounds, chrome) {
    this.panel = panel;
    this.bounds = bounds;
    this.chrome = chrome;
    this.obstacles = [];
    this.connectors = [];
    // Changed regions block marks, except a region that encloses the one being
    // marked: a badge inside a highlighted row still gets a pin beside it.
    this.regions = [];
    this.owner = null;
    // Outlines sit just outside their region; marks keep clear of the stroke.
    this.outlineBy = Math.ceil(chrome.stroke / 2) + 1;
    this.clearance = this.outlineBy + chrome.stroke;
  }

  blocking() {
    const owner = this.owner;
    const enclosing = (rect) => owner && rect !== owner && contains(rect, owner) &&
      (rect.width > owner.width || rect.height > owner.height);
    return [...this.obstacles, ...this.regions.filter((region) => !enclosing(region.rect)).map((region) => region.box)];
  }

  fits(box) {
    return contains(this.bounds, box) && !this.blocking().some((other) => intersect(other, box)) &&
      !this.connectors.some((segment) => segmentCrosses(segment, box));
  }

  // A connector may end on its own region but must not cross other marks.
  connectorClear(segment) {
    const own = this.regions.find((region) => region.rect === this.owner)?.box;
    return !this.blocking().some((other) => other !== own && segmentCrosses(segment, other));
  }

  connectorFor(box, rect) {
    const cx = box.x + this.chrome.radius;
    const cy = box.y + this.chrome.radius;
    const to = nearestPoint(expand(rect, this.outlineBy), cx, cy);
    return { x1: cx, y1: cy, x2: Math.round(to.x), y2: Math.round(to.y) };
  }

  // Overlap is a last resort for an impossibly crowded panel. Choose the
  // in-bounds candidate covering the least area, first one on ties.
  leastOverlap(candidates) {
    let best = null;
    for (const candidate of candidates) {
      if (!contains(this.bounds, candidate.box)) continue;
      const cost = this.blocking().reduce((total, other) => {
        const hit = intersect(other, candidate.box);
        return total + (hit ? hit.width * hit.height : 0);
      }, 0);
      if (!best || cost < best.cost) best = { ...candidate, cost };
    }
    return best;
  }

  placeBracket(rect, axis, text, measure) {
    const { gap, labelFont, labelPad } = this.chrome;
    const size = measure(text, labelFont);
    const label = { width: Math.ceil(size.width) + labelPad * 2, height: Math.ceil(size.height) + labelPad * 2 };
    const tick = gap;
    const away = this.clearance + gap;
    const sides = axis === "width" ? ["above", "below"] : ["left", "right"];
    const candidates = sides.map((side) => {
      let line;
      let labelBox;
      if (side === "above" || side === "below") {
        const y = side === "above" ? rect.y - away : bottom(rect) + away;
        line = { x1: rect.x, y1: y, x2: right(rect), y2: y, tickTo: side === "above" ? y + tick : y - tick };
        const labelY = side === "above" ? y - gap / 2 - label.height : y + gap / 2;
        labelBox = { x: Math.round(rect.x + rect.width / 2 - label.width / 2), y: Math.round(labelY), ...label };
      } else {
        const x = side === "left" ? rect.x - away : right(rect) + away;
        line = { x1: x, y1: rect.y, x2: x, y2: bottom(rect), tickTo: side === "left" ? x + tick : x - tick };
        const labelX = side === "left" ? x - gap / 2 - label.width : x + gap / 2;
        labelBox = { x: Math.round(labelX), y: Math.round(rect.y + rect.height / 2 - label.height / 2), ...label };
      }
      const xs = axis === "width" ? [line.x1, line.x2] : [line.x1, line.tickTo];
      const ys = axis === "width" ? [line.y1, line.tickTo] : [line.y1, line.y2];
      const lineBox = {
        x: Math.min(...xs), y: Math.min(...ys),
        width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
        height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
      };
      return { side, line, label: { ...labelBox, text }, box: union(lineBox, labelBox) };
    });
    let chosen = candidates.find((candidate) => this.fits(candidate.box));
    let placement = "clear";
    if (!chosen) {
      chosen = this.leastOverlap(candidates);
      placement = "overlap";
    }
    if (!chosen) return null;
    this.obstacles.push(chosen.box);
    return { side: chosen.side, line: chosen.line, label: chosen.label, placement };
  }

  placePin(rect) {
    const { radius, gap } = this.chrome;
    const d = radius * 2;
    const c = this.clearance;
    const at = (x, y) => ({ box: { x: Math.round(x), y: Math.round(y), width: d, height: d } });
    // Corners first: a pin touching a corner reads as belonging to that box.
    const adjacent = [
      at(rect.x, rect.y - c - d),
      at(right(rect) - d, rect.y - c - d),
      at(rect.x - c - d, rect.y),
      at(right(rect) + c, rect.y),
      at(rect.x, bottom(rect) + c),
      at(right(rect) - d, bottom(rect) + c),
      at(rect.x - c - d, bottom(rect) - d),
      at(right(rect) + c, bottom(rect) - d),
    ];
    const clear = adjacent.find((candidate) => this.fits(candidate.box));
    if (clear) return this.commitPin(clear.box, "adjacent", rect);

    // Reserved margins: walk along the nearest gutter from the region's
    // centre, alternating directions, until a free slot appears.
    const { panel, bounds } = this;
    const centreX = rect.x + rect.width / 2;
    const centreY = rect.y + rect.height / 2;
    const sides = [
      { side: "left", distance: rect.x - panel.x },
      { side: "right", distance: right(panel) - right(rect) },
      { side: "bottom", distance: bottom(panel) - bottom(rect) },
    ].sort((a, b) => a.distance - b.distance);
    const step = d + gap;
    let crossing = null;
    for (const { side } of sides) {
      const vertical = side !== "bottom";
      const fixed = side === "left" ? bounds.x + gap : side === "right" ? right(panel) + gap : bottom(panel) + gap;
      const start = vertical ? centreY - radius : centreX - radius;
      const limit = vertical ? bounds.height : bounds.width;
      for (let k = 0; k <= Math.ceil(limit / step) * 2; k += 1) {
        const offset = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * step;
        const box = vertical
          ? { x: Math.round(fixed), y: Math.round(start + offset), width: d, height: d }
          : { x: Math.round(start + offset), y: Math.round(fixed), width: d, height: d };
        if (!this.fits(box)) continue;
        if (this.connectorClear(this.connectorFor(box, rect))) return this.commitPin(box, "margin", rect);
        crossing ??= box;
      }
    }
    if (crossing) return this.commitPin(crossing, "margin-crossing", rect);
    const fallback = this.leastOverlap(adjacent) ??
      { box: fitWindow({ x: rect.x, y: rect.y, width: d, height: d }, { width: right(bounds), height: bottom(bounds) }) };
    return this.commitPin(fallback.box, "overlap", rect);
  }

  commitPin(box, placement, rect) {
    this.obstacles.push(box);
    const cx = box.x + this.chrome.radius;
    const cy = box.y + this.chrome.radius;
    let connector = null;
    if (placement.startsWith("margin")) {
      connector = this.connectorFor(box, rect);
      this.connectors.push(connector);
    }
    return { cx, cy, radius: this.chrome.radius, placement: placement === "margin-crossing" ? "margin" : placement,
      connector, crossing: placement === "margin-crossing" };
  }

  placeLabel(pin, text, measure) {
    const { gap, labelFont, labelPad } = this.chrome;
    const size = measure(text, labelFont);
    const width = Math.ceil(size.width) + labelPad * 2;
    const height = Math.ceil(size.height) + labelPad * 2;
    const r = pin.radius;
    const candidates = [
      { x: pin.cx + r + gap / 2, y: pin.cy - height / 2 },
      { x: pin.cx - r - gap / 2 - width, y: pin.cy - height / 2 },
      { x: pin.cx - width / 2, y: pin.cy + r + gap / 2 },
      { x: pin.cx - width / 2, y: pin.cy - r - gap / 2 - height },
    ].map((point) => ({ x: Math.round(point.x), y: Math.round(point.y), width, height }));
    const box = candidates.find((candidate) => this.fits(candidate));
    if (!box) return null;
    this.obstacles.push(box);
    return { ...box, text };
  }
}

// Plan one comparison image: panel slots, headers, marks, and legend, all in
// final canvas pixels. `panels` carry their output size; callout marks carry
// rectangles in panel-local output pixels.
export function planComparison({ panels, callouts = [], layout = "auto", displayWidth = DEFAULT_DISPLAY_WIDTH, measure }) {
  if (typeof measure !== "function") throw new Error("planComparison needs a measure function");
  const maxWidth = Math.max(...panels.map((panel) => panel.width));
  const maxHeight = Math.max(...panels.map((panel) => panel.height));
  const chosen = chooseLayout(layout, { width: maxWidth, height: maxHeight });
  const contentWidth = chosen === "side-by-side" ? maxWidth * panels.length : maxWidth;
  const chrome = chromeFor(contentWidth, displayWidth);
  const { gutter, headerPad, headerFont, gap } = chrome;
  const limitations = [];

  const headerSizes = panels.map((panel) => measure(panel.label, headerFont));
  const headerHeight = Math.ceil(Math.max(...headerSizes.map((size) => size.height))) + headerPad * 2;
  const innerWidth = Math.max(maxWidth, ...headerSizes.map((size) => Math.ceil(size.width) + headerPad * 2));
  const slotWidth = innerWidth + gutter * 2;
  const top = gap * 2;
  const slotHeight = headerHeight + maxHeight + gutter;
  const slotsWidth = chosen === "side-by-side" ? slotWidth * panels.length : slotWidth;
  const canvasWidth = Math.max(slotsWidth, MIN_CANVAS_WIDTH);
  const offsetX = Math.floor((canvasWidth - slotsWidth) / 2);

  const planned = panels.map((panel, index) => {
    const slotX = offsetX + (chosen === "side-by-side" ? slotWidth * index : 0);
    const slotY = top + (chosen === "stacked" ? slotHeight * index : 0);
    const x = slotX + gutter;
    const y = slotY + headerHeight;
    return {
      key: panel.key,
      label: panel.label,
      x, y, width: panel.width, height: panel.height,
      header: {
        x, y: slotY, width: innerWidth, height: headerHeight,
        text: { x: x + headerPad, y: slotY + headerPad, pointsize: headerFont, value: panel.label },
      },
      bounds: { x: slotX + gap, y, width: slotWidth - gap * 2, height: maxHeight + gutter - gap },
    };
  });
  const slotsBottom = top + (chosen === "stacked" ? slotHeight * panels.length : slotHeight);

  const sorted = [...callouts].sort((a, b) => a.id - b.id);
  const marks = [];
  const spotlights = [];
  for (const panel of planned) {
    const placer = new PanelPlacer(panel, panel.bounds, chrome);
    const local = sorted
      .map((callout) => ({ callout, mark: callout.marks?.[panel.key] }))
      .filter(({ mark }) => mark)
      .map(({ callout, mark }) => ({
        callout,
        mark,
        rect: { x: panel.x + mark.rect.x, y: panel.y + mark.rect.y, width: mark.rect.width, height: mark.rect.height },
      }));
    placer.regions = local.map((item) => ({ rect: item.rect, box: expand(item.rect, placer.clearance) }));
    const entries = local.map((item) => ({
      id: item.callout.id,
      color: item.callout.color,
      panel: panel.key,
      rect: item.rect,
      outline: expand(item.rect, placer.outlineBy),
      bracket: null,
      pin: null,
      label: null,
    }));
    local.forEach((item, index) => {
      placer.owner = item.rect;
      if (item.callout.measure && item.mark.measureText) {
        entries[index].bracket = placer.placeBracket(item.rect, item.callout.measure, item.mark.measureText, measure);
        if (!entries[index].bracket) {
          limitations.push(`Callout ${item.callout.id} measurement bracket did not fit in ${panel.label}; the legend carries its value.`);
        } else if (entries[index].bracket.placement === "overlap") {
          limitations.push(`Callout ${item.callout.id} measurement in ${panel.label} overlaps another mark.`);
        }
      }
    });
    local.forEach((item, index) => {
      placer.owner = item.rect;
      entries[index].pin = placer.placePin(item.rect);
      if (entries[index].pin.placement === "overlap") {
        limitations.push(`Callout ${item.callout.id} pin in ${panel.label} overlaps another mark; the panel is too crowded.`);
      } else if (entries[index].pin.crossing) {
        limitations.push(`Callout ${item.callout.id} connector in ${panel.label} crosses another mark; the panel is too crowded.`);
      }
    });
    local.forEach((item, index) => {
      if (!item.callout.label) return;
      placer.owner = item.rect;
      entries[index].label = placer.placeLabel(entries[index].pin, item.callout.label, measure);
      if (!entries[index].label) {
        limitations.push(`Callout ${item.callout.id} label did not fit in ${panel.label}; the legend carries its text.`);
      }
    });
    const holes = local.filter((item) => item.callout.spotlight).map((item) => expand(item.rect, gap));
    if (holes.length) spotlights.push({ panel: panel.key, rect: { x: panel.x, y: panel.y, width: panel.width, height: panel.height }, holes });
    marks.push(...entries);
  }

  let legend = null;
  let height = slotsBottom;
  if (sorted.length) {
    const { radius, legendFont } = chrome;
    const x = gutter;
    const width = canvasWidth - gutter * 2;
    const textX = x + radius * 2 + gap * 2;
    const textWidth = width - (textX - x);
    let y = slotsBottom + gap;
    const items = sorted.map((callout) => {
      const text = callout.legend ?? callout.text;
      const size = measure(text, legendFont, textWidth);
      const itemHeight = Math.max(radius * 2, Math.ceil(size.height));
      const item = {
        id: callout.id,
        color: callout.color,
        pin: { cx: x + radius, cy: y + radius, radius },
        text: { x: textX, y, width: textWidth, height: Math.ceil(size.height), value: text, pointsize: legendFont },
      };
      y += itemHeight + gap;
      return item;
    });
    legend = { x, y: slotsBottom, width, height: y - slotsBottom, items };
    height = y;
  }

  return {
    layout: chosen,
    canvas: { width: canvasWidth, height: height + gutter / 2 },
    chrome,
    panels: planned.map(({ bounds, ...panel }) => panel),
    marks,
    spotlights,
    legend,
    limitations,
  };
}

const MARKDOWN_SPECIAL = /[\\`*_[\]<>|!#&]/g;
const ENTITIES = { "<": "&lt;", ">": "&gt;", "&": "&amp;" };

export function escapeMarkdown(text) {
  return String(text).replace(/\s+/g, " ").trim().replace(MARKDOWN_SPECIAL, (char) => ENTITIES[char] ?? `\\${char}`);
}

// The publisher reads `![alt](path)` and HTML `img` tags; brackets, newlines,
// or markup in alt text would end it or add a reference.
export function escapeAlt(text) {
  return String(text).replace(/\s+/g, " ").trim().replace(/\[/g, "(").replace(/\]/g, ")")
    .replace(/[&<>]/g, (char) => ENTITIES[char]);
}

// Publisher-compatible section. Every image uses a relative path under the
// output directory and descriptive alt text.
export function sectionMarkdown({ title, comparison, callouts = [], details = [], flip = null, onion = null }) {
  const lines = [];
  if (title) lines.push(`#### ${escapeMarkdown(title)}`, "");
  lines.push(`![${escapeAlt(comparison.alt)}](${comparison.file})`, "");
  if (callouts.length) {
    for (const callout of callouts) lines.push(`- **${callout.id}**: ${escapeMarkdown(callout.legend ?? callout.text)}`);
    lines.push("");
  }
  for (const detail of details) lines.push(`![${escapeAlt(detail.alt)}](${detail.file})`, "");
  if (flip || onion) {
    lines.push("<details><summary>Screenshot comparison aids</summary>", "");
    if (flip) lines.push(`![${escapeAlt(flip.alt)}](${flip.file})`, "");
    if (onion) lines.push(`![${escapeAlt(onion.alt)}](${onion.file})`, "");
    lines.push("</details>", "");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
