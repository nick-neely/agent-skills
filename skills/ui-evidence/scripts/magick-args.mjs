// ImageMagick argument builders shared by compare.mjs and prepare-motion.mjs.
//
// Nothing here runs ImageMagick. Callers pass the arguments to their own
// runner, so both renderers use the same colours, text escaping, pins, and
// measurement.

export const CHROME = {
  header: "#24292f",
  panel: "#f6f8fa",
  border: "#d0d7de",
  text: "#1f2328",
  muted: "#59636e",
};

// label:, caption:, and -annotate expand `%` escapes, and a leading `@` reads
// a file. Spec text is data, so neutralize both.
export function imText(text) {
  const escaped = String(text).replace(/\\/g, "\\\\").replace(/%/g, "%%");
  return escaped.startsWith("@") ? `\\${escaped}` : escaped;
}

export const geometry = (x, y) =>
  `${x < 0 ? "-" : "+"}${Math.abs(Math.round(x))}${y < 0 ? "-" : "+"}${Math.abs(Math.round(y))}`;

// A function that composites a sub-image built from `sub` arguments at (x, y)
// onto the canvas whose arguments are being collected in `args`.
export const composer = (args) => (sub, x, y) =>
  args.push("(", ...sub, ")", "-gravity", "NorthWest", "-compose", "Over", "-geometry", geometry(x, y), "-composite");

// A numbered pin: a filled circle with a white ring and a centred number, on a
// transparent square of the pin's diameter.
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

// measure(text, pointsize, wrapWidth?) -> rendered { width, height }, cached.
// `run(args)` executes ImageMagick and returns its standard output.
export function textMeasurer(run, font) {
  const cache = new Map();
  return (text, pointsize, wrapWidth) => {
    const key = JSON.stringify([text, pointsize, wrapWidth ?? null]);
    if (!cache.has(key)) {
      const args = ["-font", font, "-pointsize", String(pointsize)];
      if (wrapWidth) args.push("-size", `${Math.floor(wrapWidth)}x`, `caption:${imText(text)}`);
      else args.push(`label:${imText(text)}`);
      const [width, height] = String(run([...args, "-format", "%w %h", "info:"])).trim().split(/\s+/).map(Number);
      cache.set(key, { width, height });
    }
    return cache.get(key);
  };
}
