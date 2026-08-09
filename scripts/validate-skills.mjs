#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const root = resolve(process.argv[2] || process.cwd());
const skillsRoot = join(root, "skills");
const noticesPath = join(root, "THIRD_PARTY_NOTICES.md");
const notices = existsSync(noticesPath) ? readFileSync(noticesPath, "utf8") : "";
const errors = [];
const fail = (message) => errors.push(message);

const FRONTMATTER_KEYS = [
  "name",
  "description",
  "compatibility",
  "license",
  "disable-model-invocation",
  "argument-hint",
  "allowed-tools",
  "model",
];
const BOOLEAN_FRONTMATTER_KEYS = ["disable-model-invocation"];
const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const ALLOWED_SKILL_SUBDIRS = ["scripts", "references", "assets", "agents"];
const SKILL_INSTALL_PATH = /~\/\.(claude|codex|cursor|agents)\/skills\//;
const ROOT_DOCS = ["README.md", "AGENTS.md", "THIRD_PARTY_NOTICES.md", "CONTRIBUTING.md", "SECURITY.md"];

function contained(path, parent) {
  const rel = relative(parent, path);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== "..");
}

function walk(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const target = join(path, entry.name);
    if (entry.isSymbolicLink()) {
      const real = realpathSync(target);
      if (!contained(real, root)) fail(`Symlink escapes repository: ${target}`);
      return [];
    }
    if (entry.isDirectory()) return walk(target);
    return [target];
  });
}

function parseFrontmatter(path) {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    fail(`Missing YAML frontmatter: ${path}`);
    return { text, fields: {} };
  }
  const end = lines.indexOf("---", 1);
  if (end < 0) {
    fail(`Unterminated YAML frontmatter: ${path}`);
    return { text, fields: {} };
  }
  const fields = {};
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^([a-z][a-z0-9-]*):\s*(.+)$/);
    if (!match) {
      fail(`Malformed YAML frontmatter line in ${path}: ${line}`);
      continue;
    }
    if (fields[match[1]] !== undefined) fail(`Duplicate frontmatter key ${match[1]}: ${path}`);
    fields[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return { text, fields };
}

// Code holds examples, not links. Scanning it reports every documented
// `![alt](path)` snippet as a broken local link.
function stripCode(text) {
  const kept = [];
  let fence = null;
  for (const line of text.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (marker && marker[1].startsWith(fence)) fence = null;
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    kept.push(line);
  }
  // Inline spans may be delimited by any run of backticks, so a doubled span
  // like ``![alt](x)`` has to be matched by its own opening run.
  return kept.join("\n").replace(/(`+)[^\n]*?\1/g, "");
}

function checkLinks(path, text, skillRoot) {
  for (const match of stripCode(text).matchAll(/!?\[[^\]]*]\(([^)]+)\)/g)) {
    const raw = match[1].trim().split(/\s+["']/)[0];
    if (/^(https?:|mailto:|#)/.test(raw)) continue;
    const target = resolve(dirname(path), decodeURIComponent(raw.split("#")[0]));
    if (!contained(target, skillRoot)) fail(`Local link escapes skill directory: ${path} -> ${raw}`);
    else if (!existsSync(target)) fail(`Broken local link: ${path} -> ${raw}`);
  }
}

function checkFrontmatterSchema(fields, path) {
  for (const key of Object.keys(fields)) {
    if (!FRONTMATTER_KEYS.includes(key)) fail(`Unknown frontmatter key ${key}: ${path}`);
  }
  if (fields.name !== undefined) {
    if (!SKILL_NAME_PATTERN.test(fields.name)) fail(`Malformed frontmatter name: ${path}`);
    if (fields.name.length > 64) fail(`Frontmatter name exceeds 64 characters: ${path}`);
  }
  if (fields.description !== undefined && fields.description.length > 1024) {
    fail(`Frontmatter description exceeds 1024 characters: ${path}`);
  }
  for (const key of BOOLEAN_FRONTMATTER_KEYS) {
    if (fields[key] !== undefined && !["true", "false"].includes(fields[key])) {
      fail(`Frontmatter ${key} must be true or false: ${path}`);
    }
  }
}

function checkSkillSubdirectories(skillRoot) {
  for (const entry of readdirSync(skillRoot, { withFileTypes: true })) {
    if (entry.isDirectory() && !ALLOWED_SKILL_SUBDIRS.includes(entry.name)) {
      fail(`Unexpected skill subdirectory: ${join(skillRoot, entry.name)}`);
    }
  }
}

// stripCode() removes fenced blocks before link checking, so a script path
// like `node "<skill-root>/scripts/annotate.mjs"` inside a ```bash``` fence is
// never verified to exist. Check it separately, on the raw text.
function checkSkillRootReferences(path, text, skillRoot) {
  for (const match of text.matchAll(/<skill-root>\/(\S+)/g)) {
    const raw = match[1].replace(/^[`"']+|[`"']+$/g, "");
    const target = resolve(skillRoot, raw);
    if (!existsSync(target)) fail(`Broken <skill-root> reference: ${path} -> ${raw}`);
  }
}

function checkNoEmDash(path) {
  const lines = readFileSync(path, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.includes("\u2014")) fail(`Em dash found: ${path}:${index + 1}`);
  });
}

// Runs on raw text: the install-path mistake shows up inside fenced example
// commands, which stripCode() would otherwise hide from this check.
function checkNoHardcodedInstallPath(path, text) {
  text.split(/\r?\n/).forEach((line, index) => {
    if (SKILL_INSTALL_PATH.test(line)) fail(`Hardcoded skill-install path: ${path}:${index + 1}`);
  });
}

function checkReadmeSkillList(root, skillNames) {
  const readmePath = join(root, "README.md");
  if (!existsSync(readmePath)) {
    fail(`Missing README.md: ${readmePath}`);
    return;
  }
  const lines = readFileSync(readmePath, "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => /^## Skills\s*$/.test(line));
  if (start < 0) {
    fail(`README.md missing "## Skills" section: ${readmePath}`);
    return;
  }
  let end = lines.findIndex((line, index) => index > start && /^## /.test(line));
  if (end < 0) end = lines.length;

  const listed = new Set();
  const namePattern = /^-\s*\[`([a-z0-9-]+)`\]\(skills\/([a-z0-9-]+)\/\)/;
  for (const line of lines.slice(start + 1, end)) {
    const match = line.match(namePattern);
    if (match) listed.add(match[2]);
  }
  for (const name of skillNames) {
    if (!listed.has(name)) fail(`README Skills section missing skill ${name}: ${readmePath}`);
  }
  for (const name of listed) {
    if (!skillNames.includes(name)) fail(`README Skills section lists unknown skill ${name}: ${readmePath}`);
  }
}

if (!existsSync(skillsRoot)) fail(`Missing skills directory: ${skillsRoot}`);
const entries = existsSync(skillsRoot)
  ? readdirSync(skillsRoot, { withFileTypes: true })
  : [];
for (const entry of entries) {
  const skillRoot = join(skillsRoot, entry.name);
  if (!entry.isDirectory()) {
    fail(`Malformed skill layout, expected directory: ${skillRoot}`);
    continue;
  }
  checkSkillSubdirectories(skillRoot);
  const skillPath = join(skillRoot, "SKILL.md");
  const skillFiles = walk(skillRoot).filter((path) => path.endsWith(`${sep}SKILL.md`));
  if (skillFiles.length !== 1 || skillFiles[0] !== skillPath) {
    fail(`Expected exactly one immediate SKILL.md: ${skillRoot}`);
    continue;
  }
  const { text, fields } = parseFrontmatter(skillPath);
  if (fields.name !== entry.name) fail(`Skill name must match directory ${entry.name}: ${skillPath}`);
  if (!fields.description) fail(`Missing frontmatter description: ${skillPath}`);
  checkFrontmatterSchema(fields, skillPath);
  checkLinks(skillPath, text, skillRoot);

  const openai = join(skillRoot, "agents", "openai.yaml");
  if (!existsSync(openai)) fail(`Missing OpenAI metadata: ${openai}`);
  else {
    const yaml = readFileSync(openai, "utf8");
    if (!/^interface:\s*$/m.test(yaml)) fail(`OpenAI metadata lacks interface: ${openai}`);
    if (!/^\s{2}display_name:\s*".+"\s*$/m.test(yaml)) fail(`OpenAI display_name is invalid: ${openai}`);
    if (!/^\s{2}short_description:\s*".+"\s*$/m.test(yaml)) fail(`OpenAI short_description is invalid: ${openai}`);
    const invocation = yaml.match(/allow_implicit_invocation:\s*(\S+)/);
    if (invocation && !["true", "false"].includes(invocation[1])) {
      fail(`OpenAI invocation policy must be boolean: ${openai}`);
    }
  }

  const isThirdParty = notices.includes(`\`skills/${entry.name}\``);
  if (isThirdParty && !existsSync(join(skillRoot, "LICENSE"))) {
    fail(`Third-party skill lacks local license: ${skillRoot}`);
  }

  for (const file of walk(skillRoot)) {
    if (file.endsWith(".md")) {
      const content = readFileSync(file, "utf8");
      checkLinks(file, content, skillRoot);
      checkSkillRootReferences(file, content, skillRoot);
      checkNoHardcodedInstallPath(file, content);
    }
    if (/\.(mjs|py)$/.test(file)) {
      const mode = statSync(file).mode & 0o777;
      if (readFileSync(file, "utf8").startsWith("#!") && (mode & 0o111) === 0) {
        fail(`Executable script lacks executable mode: ${file}`);
      }
    }
    // The writing convention (see THIRD_PARTY_NOTICES.md) is plain hyphens;
    // assets (fonts, binaries) are exempt since they are not prose or code.
    const inAssets = relative(skillRoot, file).split(sep)[0] === "assets";
    if (!inAssets && /\.(md|mjs|yaml|py)$/.test(file)) checkNoEmDash(file);
  }
}

const skillNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
checkReadmeSkillList(root, skillNames);
for (const name of ROOT_DOCS) {
  const path = join(root, name);
  if (existsSync(path)) checkNoEmDash(path);
}

const absolutePattern = /(?:\/home\/[^/\s]+|\/Users\/[^/\s]+|[A-Za-z]:\\Users\\[^\\\s]+)/;
for (const file of existsSync(skillsRoot) ? walk(skillsRoot) : []) {
  if (lstatSync(file).isFile() && absolutePattern.test(readFileSync(file, "utf8"))) {
    fail(`Machine-specific absolute path detected: ${file}`);
  }
}

if (errors.length) {
  for (const error of errors) process.stderr.write(`${error}\n`);
  process.exit(1);
}
process.stdout.write(`Validated ${entries.length} skill(s).\n`);
