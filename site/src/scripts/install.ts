// Install controls: scope and agent choices rewrite the command in place, the
// copy buttons copy exactly what the command builder produces, and a long
// command breaks between flags only when one line does not fit (command-fit.js).

import { commandHTML, commandParts, commandText, installNote, type InstallTarget, type Scope } from "../lib/commands.ts";

declare global {
  interface Window {
    /** Defined inline in <head> by Base.astro from command-fit.js. */
    commandFit: { fit(pre: HTMLElement): void; fade(pre: HTMLElement): void };
    va?: (event: "event", payload: { name: string; data?: Record<string, string> }) => void;
  }
}

const CONFIRM_MS = 1200;

const target = (install: HTMLElement): InstallTarget => ({ name: install.dataset.name ?? "", packed: install.dataset.packed === "true" });
const scopeOf = (el: Element): Scope => (el.closest<HTMLElement>("[data-scope-root]")?.dataset.scope === "project" ? "project" : "global");
const agentsOf = (install: HTMLElement) => (install.dataset.agents ?? "").split(" ").filter(Boolean);

const { fit, fade } = window.commandFit;

const resize = "ResizeObserver" in window ? new ResizeObserver((entries) => entries.forEach((e) => fit(e.target as HTMLElement))) : undefined;

function render(install: HTMLElement) {
  const scope = scopeOf(install);
  const agents = agentsOf(install);
  const html = commandHTML(commandParts(target(install), scope, agents));
  install.querySelectorAll<HTMLElement>("[data-cmd]").forEach((pre) => {
    const code = pre.querySelector("code");
    if (code) code.innerHTML = html;
    fit(pre);
  });
  install.querySelectorAll("[data-note]").forEach((note) => {
    note.textContent = installNote(scope, agents);
  });
}

function installsIn(root: HTMLElement): HTMLElement[] {
  return [...(root.matches("[data-install]") ? [root] : []), ...root.querySelectorAll<HTMLElement>("[data-install]")];
}

function setScope(button: HTMLElement) {
  const root = button.closest<HTMLElement>("[data-scope-root]");
  const scope = button.dataset.scopeSet;
  if (!root || !scope || root.dataset.scope === scope) return;
  root.dataset.scope = scope;
  root.querySelectorAll<HTMLElement>("[data-scope-set]").forEach((b) => {
    if (b.closest("[data-scope-root]") === root) b.setAttribute("aria-pressed", String(b.dataset.scopeSet === scope));
  });
  installsIn(root).forEach(render);
}

function toggleAgent(chip: HTMLElement) {
  const install = chip.closest<HTMLElement>("[data-install]");
  if (!install) return;
  const on = chip.getAttribute("aria-pressed") !== "true";
  chip.setAttribute("aria-pressed", String(on));
  const chosen = [...install.querySelectorAll<HTMLElement>("[data-agent][aria-pressed='true']")].map((c) => c.dataset.agent);
  install.dataset.agents = chosen.join(" ");
  render(install);
}

let announceTimer: ReturnType<typeof setTimeout> | undefined;
function announce(message: string) {
  const region = document.querySelector("[data-announcer]");
  if (!region) return;
  // Cleared first so the same message is announced again on a repeat copy.
  region.textContent = "";
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    region.textContent = message;
  }, 50);
}

interface Copied {
  text: string;
  message: string;
  event: { name: string; data?: Record<string, string> };
}

/** What a copy button copies: its install control's command, or the text of its snippet. */
function copied(button: HTMLElement): Copied | undefined {
  const install = button.closest<HTMLElement>("[data-install]");
  if (install) {
    const scope = scopeOf(install);
    return {
      text: commandText(target(install), scope, agentsOf(install)),
      message: `Copied the install command for ${install.dataset.name}.`,
      event: { name: "Copy install", data: { skill: install.dataset.name ?? "", scope } },
    };
  }
  const snippet = button.closest<HTMLElement>("[data-snippet]");
  const text = snippet?.querySelector("[data-snippet-text]")?.textContent?.trim();
  if (!snippet || !text) return undefined;
  return { text, message: `Copied the ${snippet.dataset.snippet}.`, event: { name: snippet.dataset.snippetEvent ?? "Copy" } };
}

const timers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();
async function copy(button: HTMLElement) {
  const what = copied(button);
  if (!what) return;
  try {
    await navigator.clipboard.writeText(what.text);
  } catch {
    // A refused clipboard write is the browser's answer; the control simply does not confirm.
    return;
  }
  button.setAttribute("data-copied", "");
  clearTimeout(timers.get(button));
  timers.set(button, setTimeout(() => button.removeAttribute("data-copied"), CONFIRM_MS));
  announce(what.message);
  window.va?.("event", what.event);
}

function peek(button: HTMLElement) {
  const panel = document.getElementById(button.getAttribute("aria-controls") ?? "");
  if (!panel) return;
  const open = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(open));
  panel.hidden = !open;
  if (open) panel.querySelectorAll<HTMLElement>("[data-cmd]").forEach(fit);
}

document.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const control = event.target.closest<HTMLElement>("[data-scope-set],[data-agent],[data-copy],[data-peek]");
  if (!control) return;
  if (control.dataset.scopeSet) setScope(control);
  else if (control.dataset.agent) toggleAgent(control);
  else if (control.hasAttribute("data-copy")) void copy(control);
  else if (control.dataset.peek) peek(control);
});

if (!navigator.clipboard) document.documentElement.classList.add("no-clipboard");

const commands = document.querySelectorAll<HTMLElement>("[data-cmd]");
commands.forEach((pre) => {
  fit(pre);
  resize?.observe(pre);
  pre.addEventListener("scroll", () => fade(pre), { passive: true });
});
// The fallback face matches the mono font's advance, so this refit should change
// nothing; it keeps the breaks right if a browser substitutes another fallback.
void document.fonts?.ready.then(() => commands.forEach(fit));
