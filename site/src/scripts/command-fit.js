// Packs a command into as few lines as fit, breaking only between arguments.
// Base.astro inlines this file in <head> as a classic script, and each install
// control calls it right after its command, so a command is broken into lines
// before the first paint instead of reflowing the page once the bundled
// scripts arrive. install.ts refits through the same function on changes.
window.commandFit = (() => {
  function fade(pre) {
    pre.toggleAttribute("data-fade", pre.scrollWidth - pre.clientWidth - pre.scrollLeft > 1);
  }
  // The text is monospace, so line widths are character counts.
  function fit(pre) {
    if (!pre || !pre.clientWidth) return;
    const breaks = [...pre.querySelectorAll(".cmd-br")];
    breaks.forEach((br) => br.removeAttribute("data-on"));
    const style = getComputedStyle(pre);
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const room = pre.clientWidth - padding;
    const head = pre.querySelector(".cmd-head")?.textContent ?? "";
    const parts = breaks.map((br) => br.nextElementSibling?.textContent ?? "");
    // With every break off the block is one line: the prompt, the head and each " part".
    const length = 2 + head.length + parts.reduce((sum, part) => sum + 1 + part.length, 0);
    const charWidth = (pre.scrollWidth - padding) / length;
    if (pre.scrollWidth > pre.clientWidth + 1 && charWidth > 0) {
      const columns = Math.floor(room / charWidth);
      let line = 2 + head.length;
      breaks.forEach((br, i) => {
        const part = parts[i] ?? "";
        // Room for " part" plus the " \" this line would need if the next part breaks.
        if (line + 1 + part.length + 2 > columns) {
          br.setAttribute("data-on", "");
          line = 4 + part.length;
        } else {
          line += 1 + part.length;
        }
      });
    }
    fade(pre);
  }
  return { fit, fade };
})();
