// Plain-text views of the catalog for agents: one Markdown page per skill, the
// home page as Markdown, the setup guide, the Markdown 404, llms.txt and
// llms-full.txt. All of
// them use the same catalog and command builder as the pages.

import { catalog, getSkill, installTarget, installedBy, kindLabel, skillMarkdownPath, skillPath, fileURL, REPOSITORY_URL, type Skill } from "./catalog.ts";
import { AGENTS, AGENT_NAMES, SITE_ORIGIN, commandText, siteInstall } from "./commands.ts";
import { list, plainText } from "./html.ts";
import { INFO_PAGES, infoMarkdownPath, infoPath } from "./info-pages.ts";
import { site } from "./site.ts";

const absolute = (path: string) => `${SITE_ORIGIN}${path}`;

export const SETUP_PATH = "/setup.md";
export const HOME_MARKDOWN_PATH = "/index.md";
export const LLMS_PATH = "/llms.txt";
export const LLMS_FULL_PATH = "/llms-full.txt";
export const NOT_FOUND_MARKDOWN_PATH = "/404.md";
export const ROOT_INDEX_PATH = "/.well-known/agent-skills/index.json";
/** The one workflow the home page offers first. */
export const FEATURED = "full-stop";

/** What a person pastes into their agent to be walked through choosing skills. */
export const SETUP_PROMPT = `Help me pick and install agent skills from ${site.owner}'s catalog. Read ${absolute(SETUP_PATH)} and follow it. Check with me before installing anything.`;

const agentNames = AGENTS.map((agent) => AGENT_NAMES[agent]);
const intro = `${site.owner}'s agent skills for coding agents such as ${list(agentNames)}, published as source. Workflows chain several skills into a delivery loop: state what a change must prove, build it test-first, review it, and open a pull request that shows it.`;

export function skillMarkdown(skill: Skill): string {
  const lines = [
    `# ${skill.name}`,
    "",
    `> ${skill.summary}`,
    "",
    `- Kind: ${kindLabel[skill.kind]}`,
    `- Page: ${absolute(skillPath(skill.name))}`,
    `- Source: ${fileURL(skill.name, "SKILL.md")}`,
  ];
  if (skill.compatibility) lines.push(`- Requirements: ${skill.compatibility}`);
  if (skill.requires.length) lines.push(`- Requires: ${skill.requires.join(", ")}`);
  if (skill.uses.length) lines.push(`- Uses on some paths: ${skill.uses.join(", ")}`);
  if (skill.pack) lines.push(`- Installs: ${skill.pack.members.map((m) => m.id).join(", ")}`);
  const installers = installedBy(skill.name);
  if (installers.length) lines.push(`- Installed by: ${installers.map((s) => s.name).join(", ")}`);
  lines.push(
    "",
    "## Install",
    "",
    "Global install, for your user in every project:",
    "",
    "```sh",
    commandText(installTarget(skill), "global"),
    "```",
    "",
    "Project install, run from the project root:",
    "",
    "```sh",
    commandText(installTarget(skill), "project"),
    "```",
    "",
    "Add `-a <agents>` (for example `-a claude-code codex`) to skip the CLI's agent prompt.",
    "",
    "## SKILL.md",
    "",
    "The file below is the skill exactly as committed.",
    "",
    fenced(skill.source),
    "",
  );
  return lines.join("\n");
}

function installSection(heading: string): string[] {
  return [
    heading,
    "",
    "Skills install with the Skills CLI. A workflow installs every skill it needs from its endpoint:",
    "",
    "```sh",
    commandText({ name: "<workflow>", packed: true }, "global"),
    "```",
    "",
    "A standalone skill installs from the GitHub source:",
    "",
    "```sh",
    commandText({ name: "<skill>", packed: false }, "global"),
    "```",
    "",
    `The site also serves a discovery index of every skill (${absolute(ROOT_INDEX_PATH)}), so any one skill installs alone from the site, without the skills a workflow would add:`,
    "",
    "```sh",
    siteInstall("<skill>"),
    "```",
    "",
    "Omit `--global` to install into the current project. Add `-a <agents>` to choose agents without the prompt.",
    "",
  ];
}

function catalogLines(heading: (title: string) => string): string[] {
  const lines: string[] = [];
  for (const category of catalog().categories) {
    lines.push(heading(category.title), "");
    if (category.intro) lines.push(plainText(category.intro), "");
    for (const skill of category.skills) {
      lines.push(`- [${skill.name}](${absolute(skillPath(skill.name))}) (${kindLabel[skill.kind]}): ${plainText(skill.summary)} Markdown: ${absolute(skillMarkdownPath(skill.name))}`);
    }
    lines.push("");
  }
  return lines;
}

export function llmsText(): string {
  return [
    `# ${site.name} - ${site.owner}`,
    "",
    `> ${intro}`,
    "",
    `Source: ${REPOSITORY_URL}`,
    "",
    "## Start here",
    "",
    `- [Setup guide](${absolute(SETUP_PATH)}): step-by-step instructions for an agent helping a person choose and install skills from this catalog, with checkpoints for their approval. Read it first when asked to set up these skills.`,
    `- [Home page as Markdown](${absolute(HOME_MARKDOWN_PATH)}): the catalog with summaries. Every page here also returns Markdown when requested with \`Accept: text/markdown\`.`,
    `- [Full text](${absolute(LLMS_FULL_PATH)}): this file followed by every skill's complete SKILL.md.`,
    "",
    ...installSection("## Install"),
    ...catalogLines((title) => `## ${title}`),
    "## About this site",
    "",
    ...INFO_PAGES.map((page) => `- [${page.title}](${absolute(infoPath(page.slug))}): ${page.description} Markdown: ${absolute(infoMarkdownPath(page.slug))}`),
    "",
  ].join("\n");
}

/** The body of a 404 for a request that asked for Markdown. */
export function notFoundMarkdown(): string {
  return [
    "# Not found",
    "",
    `> There is no page at this address on ${new URL(SITE_ORIGIN).host}. The link may be mistyped, or the page may have moved.`,
    "",
    `Skill pages live at \`${absolute(skillPath("<name>"))}\`, and each has a Markdown version at \`${absolute(skillMarkdownPath("<name>"))}\`. To find what you were looking for:`,
    "",
    `- [llms.txt](${absolute(LLMS_PATH)}): every skill and workflow with its page and Markdown version.`,
    `- [Setup guide](${absolute(SETUP_PATH)}): instructions for an agent helping a person choose and install skills.`,
    `- [Catalog](${absolute("/")}): the home page, also as Markdown at ${absolute(HOME_MARKDOWN_PATH)}.`,
    `- [Contact](${absolute(infoPath("contact"))}): report a broken link.`,
    "",
  ].join("\n");
}

export function llmsFullText(): string {
  const lines = [llmsText().trimEnd(), "", "## Every SKILL.md", ""];
  for (const skill of catalog().skills) {
    lines.push(`### ${skill.name}`, "", `Page: ${absolute(skillPath(skill.name))}`, `Source: ${fileURL(skill.name, "SKILL.md")}`, "", fenced(skill.source), "");
  }
  return lines.join("\n");
}

/** SKILL.md in a fence longer than any backtick run inside, so its own fences stay inside the block. */
function fenced(source: string): string {
  const fence = "`".repeat(Math.max(3, ...[...source.matchAll(/`+/g)].map((m) => m[0].length)) + 1);
  return [`${fence}markdown`, source.trimEnd(), fence].join("\n");
}

export function homeMarkdown(): string {
  const { skills } = catalog();
  const featured = getSkill(FEATURED);
  const workflows = skills.filter((s) => s.kind === "workflow").length;
  return [
    `# ${site.name} - ${site.owner}`,
    "",
    `> ${intro}`,
    "",
    `- Page: ${absolute("/")}`,
    `- Source: ${REPOSITORY_URL}`,
    `- Setup guide for agents: ${absolute(SETUP_PATH)}`,
    `- llms.txt: ${absolute(LLMS_PATH)}`,
    "",
    "## Set up with your agent",
    "",
    "Not sure where to start? Paste this prompt into your coding agent:",
    "",
    "```text",
    SETUP_PROMPT,
    "```",
    "",
    "## Start here",
    "",
    `[${featured.name}](${absolute(skillPath(featured.name))}) (${kindLabel[featured.kind]}): ${plainText(featured.summary)}`,
    "",
    "```sh",
    commandText(installTarget(featured), "global"),
    "```",
    "",
    ...installSection("## Install").slice(1),
    `## Catalog`,
    "",
    `${skills.length} skills, ${workflows} of them workflows that install everything they need in one command.`,
    "",
    ...catalogLines((title) => `### ${title}`),
  ].join("\n");
}

export function setupMarkdown(): string {
  const { categories, skills } = catalog();
  const areas = categories.filter((c) => c.skills.some((s) => s.kind !== "shared-method")).map((c) => c.title);
  const byName = skills.filter((s) => s.userInvoked).map((s) => `\`${s.name}\``);
  const needsGh = skills.filter((s) => s.compatibility?.includes("GitHub CLI")).map((s) => `\`${s.name}\``);
  const example = getSkill(FEATURED);
  return [
    `# Set up ${site.owner}'s agent skills`,
    "",
    `You are a coding agent helping a person choose and install agent skills from ${absolute("/")}. Follow these steps in order. At each checkpoint, stop and wait for the person's answer. Install nothing they have not approved, and change nothing in their project beyond what the install commands write.`,
    "",
    "## 1. Read the catalog",
    "",
    `Fetch ${absolute(LLMS_PATH)}. It lists every skill and workflow with a one-line summary, its page and a Markdown version with the details. A workflow installs several skills with one command.`,
    "",
    "## 2. Learn how they work",
    "",
    "Check what you can yourself first: which agent you are, whether `npx` works, and whether the GitHub CLI is installed and signed in (`gh auth status`). Then ask the person, in one short message:",
    "",
    `- Which coding agents they use (for example ${list(agentNames, "or")}).`,
    `- What they want help with. The catalog groups its skills as ${areas.map((a) => `"${a}"`).join(", ")}.`,
    "- Whether they want the skills in every project (global) or only the current one (project).",
    "",
    "**Checkpoint:** wait for their answers.",
    "",
    "## 3. Recommend",
    "",
    `Read the Markdown page of each candidate (\`${absolute(skillMarkdownPath("<name>"))}\`) before recommending it. Recommend the fewest skills or workflows that cover what they asked for, with one line each on why. Prefer one workflow over several separate skills when it covers the same ground. Name any requirement they are missing, from each page's Requirements line${needsGh.length ? `; for example ${list(needsGh.slice(0, 3))} need an authenticated GitHub CLI` : ""}.`,
    "",
    "**Checkpoint:** show the list and ask them to confirm, remove or add items.",
    "",
    "## 4. Install",
    "",
    "Use the commands from each skill's Markdown page, under Install: a workflow installs from its endpoint with every skill it needs, a standalone skill from the GitHub source. Use the global command for a global install and the project command, run from the project root, for a project install. For example:",
    "",
    "```sh",
    commandText(installTarget(example), "global"),
    "```",
    "",
    `Add \`-a\` with the agents they named so the CLI does not prompt. The agent ids are: ${AGENTS.map((a) => `\`${a}\``).join(", ")}.`,
    "",
    `To install a single skill on its own, without the skills its workflow would add, the site's discovery index also works: \`${siteInstall("<name>")}\`.`,
    "",
    "**Checkpoint:** show the exact commands, ask them to approve, then run them.",
    "",
    "## 5. Confirm and hand off",
    "",
    "Run `npx skills list` (add `--global` after a global install) and confirm each skill installed. Then tell them how to start each one: most start on their own when the task fits, and some start only when called by name" + (byName.length ? ` (${list(byName)})` : "") + `. Point them to ${absolute("/")} for the instructions behind each skill.`,
    "",
  ].join("\n");
}
