// The one install-command builder. Server rendering, the copy buttons, the
// Markdown pages and llms.txt all read from here, so what a reader sees, copies
// and an agent reads can never disagree.

import { escapeHTML } from "./html.ts";

export const SITE_ORIGIN = "https://skills.nickneely.dev";
export const REPOSITORY = "nick-neely/agent-skills";

export const AGENTS = ["claude-code", "codex", "cursor", "opencode", "pi", "antigravity"] as const;
export type Agent = (typeof AGENTS)[number];
/** How each agent is named in prose; the CLI takes the ids above. */
export const AGENT_NAMES: Record<Agent, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  opencode: "OpenCode",
  pi: "Pi",
  antigravity: "Antigravity",
};
/** The site itself serves a discovery index of every skill here, each installable alone. */
export const siteInstall = (name: string) => `npx skills add ${SITE_ORIGIN} --skill ${name}`;
export type Scope = "global" | "project";

export interface InstallTarget {
  name: string;
  /** A skill with a Pack installs through its workflow endpoint, with everything it needs. */
  packed: boolean;
}

/**
 * The command split at flag boundaries. Joined with spaces it is the command;
 * the parts are only where a long command may break onto a continuation line.
 */
export function commandParts(target: InstallTarget, scope: Scope, agents: readonly string[] = []): string[] {
  const parts = ["npx skills add", target.packed ? `${SITE_ORIGIN}/workflows/${target.name}` : REPOSITORY];
  if (scope === "global") parts.push("--global");
  parts.push(target.packed ? "--skill '*'" : `--skill ${target.name}`);
  // Agent order follows the list, not the order the reader clicked, so the same
  // choice always reads as the same command.
  const chosen = AGENTS.filter((agent) => agents.includes(agent));
  if (chosen.length) parts.push(`-a ${chosen.join(" ")}`);
  return parts;
}

export function commandText(target: InstallTarget, scope: Scope, agents: readonly string[] = []): string {
  return commandParts(target, scope, agents).join(" ");
}

export function installNote(scope: Scope, agents: readonly string[] = []): string {
  const where = scope === "project" ? "Installs into this project only; run it from the project root." : "Installs for your user, in every project.";
  return agents.length ? where : `${where} With no agent chosen, the CLI asks which agents to install for.`;
}

/**
 * Markup for a command block. Every part after the first carries a hidden
 * ` \` continuation that the block turns on only where a line would not fit,
 * so a command breaks between arguments and never inside one, and text
 * selected by hand stays a valid shell command in any layout.
 */
export function commandHTML(parts: readonly string[]): string {
  const [first = "", ...rest] = parts;
  const tail = rest
    .map((part) => `<span class="cmd-sp"> </span><span class="cmd-br" aria-hidden="true">\\\n    </span><span class="cmd-flag">${escapeHTML(part)}</span>`)
    .join("");
  return `<span class="cmd-p" aria-hidden="true">$ </span><span class="cmd-head">${escapeHTML(first)}</span>${tail}`;
}
