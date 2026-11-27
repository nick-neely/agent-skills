// The site's one view of the repository, read from the files at build time:
// catalog.json for order, categories and summaries; skills/*/SKILL.md for
// instructions, dependency edges and requirements; packs/*.json for what each
// workflow installs; external-skills.json for upstream pins. Nothing here is
// copied into the site, so the site cannot drift from the repository.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import { REPOSITORY, type InstallTarget } from "./commands.ts";

export const REPOSITORY_URL = `https://github.com/${REPOSITORY}`;
/** The catalog category whose skills are methods other skills follow, as CONTRIBUTING.md defines it. */
const SHARED_METHODS = "Shared methods";

export type Kind = "workflow" | "skill" | "shared-method";
export type EdgeKind = "requires" | "uses";

/** A skill as a dependency names it: bare for this repository, `owner/repo@name` for another. */
export interface SkillRef {
  id: string;
  name: string;
  repo: string;
  local: boolean;
}

export interface ExternalPin {
  commit: string;
  path: string;
}

export interface Pack {
  members: SkillRef[];
  omitted: (SkillRef & { reason: string })[];
}

export interface Category {
  title: string;
  slug: string;
  number: number;
  intro?: string;
  skills: Skill[];
}

export interface Skill {
  name: string;
  summary: string;
  featured: boolean;
  category: Category;
  kind: Kind;
  /** `disable-model-invocation`: the reader calls it by name; an agent never picks it up alone. */
  userInvoked: boolean;
  compatibility?: string;
  requires: string[];
  uses: string[];
  /** SKILL.md exactly as committed. */
  source: string;
  /** SKILL.md without its frontmatter. */
  body: string;
  /** Every other file in the skill directory, relative to it, sorted. */
  files: string[];
  pack?: Pack;
}

export interface Catalog {
  categories: Category[];
  /** Every skill in catalog order. */
  skills: Skill[];
  external: Record<string, ExternalPin>;
}

export function findRepositoryRoot(start = process.cwd()): string {
  for (let dir = resolve(start); ; dir = dirname(dir)) {
    if (existsSync(join(dir, "catalog.json")) && existsSync(join(dir, "skills"))) return dir;
    if (dirname(dir) === dir) throw new Error(`No repository root with catalog.json above ${start}`);
  }
}

export function ref(id: string): SkillRef {
  const at = id.indexOf("@");
  if (at < 0) return { id, name: id, repo: REPOSITORY, local: true };
  return { id, name: id.slice(at + 1), repo: id.slice(0, at), local: false };
}

const IGNORED = new Set([".DS_Store", "node_modules", "__pycache__"]);

function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name) || entry.name.endsWith(".pyc")) continue;
    const path = prefix + entry.name;
    if (entry.isDirectory()) out.push(...listFiles(join(dir, entry.name), `${path}/`));
    else if (entry.isFile()) out.push(path);
  }
  return out.sort();
}

function splitFrontmatter(source: string, file: string): { data: Record<string, unknown>; body: string } {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`Missing frontmatter: ${file}`);
  return { data: parseYaml(match[1]) ?? {}, body: source.slice(match[0].length) };
}

const words = (value: unknown) => (typeof value === "string" ? value.split(/\s+/).filter(Boolean) : []);

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

interface CatalogFile {
  categories: { title: string; intro?: string; skills: { name: string; summary: string; featured: boolean }[] }[];
}

export function loadCatalog(root = findRepositoryRoot()): Catalog {
  const file = readJson<CatalogFile>(join(root, "catalog.json"));
  const external = readJson<Record<string, ExternalPin>>(join(root, "external-skills.json"));
  const packsDir = join(root, "packs");
  const packs = new Map<string, Pack>();
  for (const name of readdirSync(packsDir).filter((f) => f.endsWith(".json"))) {
    const manifest = readJson<{ members: Record<string, string[]>; omit?: Record<string, string> }>(join(packsDir, name));
    const members = Object.entries(manifest.members).flatMap(([repo, list]) =>
      list.map((member) => ref(repo === REPOSITORY ? member : `${repo}@${member}`)),
    );
    const omitted = Object.entries(manifest.omit ?? {}).map(([id, reason]) => ({ ...ref(id), reason }));
    packs.set(name.slice(0, -".json".length), { members, omitted });
  }

  const categories: Category[] = [];
  const skills: Skill[] = [];
  file.categories.forEach((entry, index) => {
    const category: Category = { title: entry.title, slug: slugify(entry.title), number: index + 1, skills: [] };
    if (entry.intro) category.intro = entry.intro;
    for (const item of entry.skills) {
      const path = join(root, "skills", item.name, "SKILL.md");
      const source = readFileSync(path, "utf8");
      const { data, body } = splitFrontmatter(source, path);
      const metadata = (data.metadata ?? {}) as Record<string, unknown>;
      const pack = packs.get(item.name);
      const skill: Skill = {
        name: item.name,
        summary: item.summary,
        featured: item.featured,
        category,
        kind: entry.title === SHARED_METHODS ? "shared-method" : pack ? "workflow" : "skill",
        userInvoked: data["disable-model-invocation"] === true,
        requires: words(metadata.requires),
        uses: words(metadata.uses),
        source,
        body,
        files: listFiles(join(root, "skills", item.name)).filter((f) => f !== "SKILL.md"),
      };
      if (typeof data.compatibility === "string" && data.compatibility.trim()) skill.compatibility = data.compatibility.trim();
      if (pack) skill.pack = pack;
      category.skills.push(skill);
      skills.push(skill);
    }
    categories.push(category);
  });
  return { categories, skills, external };
}

let cached: Catalog | undefined;
/** The catalog for this build, read once. */
export function catalog(): Catalog {
  cached ??= loadCatalog();
  return cached;
}

export function getSkill(name: string): Skill {
  const skill = catalog().skills.find((s) => s.name === name);
  if (!skill) throw new Error(`Unknown skill ${name}`);
  return skill;
}

export const installTarget = (skill: Skill): InstallTarget => ({ name: skill.name, packed: Boolean(skill.pack) });

export const skillPath = (name: string) => `/skills/${name}`;
export const skillMarkdownPath = (name: string) => `/skills/${name}.md`;
export const fileURL = (name: string, path: string) => `${REPOSITORY_URL}/blob/main/skills/${name}/${path}`;

/** Where an upstream skill lives at the exact commit a workflow installs. */
export function externalURL(id: string): string {
  const { repo } = ref(id);
  const pin = catalog().external[id];
  return pin ? `https://github.com/${repo}/tree/${pin.commit}/${pin.path}` : `https://github.com/${repo}`;
}

export interface Connection {
  ref: SkillRef;
  kind: EdgeKind;
}

/** Skills here that name this one, with the stronger edge when both apply. */
export function usedBy(name: string): Connection[] {
  return catalog().skills.flatMap((s): Connection[] => {
    if (s.requires.includes(name)) return [{ ref: ref(s.name), kind: "requires" }];
    if (s.uses.includes(name)) return [{ ref: ref(s.name), kind: "uses" }];
    return [];
  });
}

/** Workflows, other than its own, whose single install command includes this skill. */
export function installedBy(name: string): Skill[] {
  return catalog().skills.filter((s) => s.name !== name && s.pack?.members.some((m) => m.local && m.name === name));
}

export const workflowCount = () => catalog().skills.filter((s) => s.kind === "workflow").length;

export const kindLabel: Record<Kind, string> = { workflow: "workflow", skill: "skill", "shared-method": "shared method" };
