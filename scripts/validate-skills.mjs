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
  const skillPath = join(skillRoot, "SKILL.md");
  const skillFiles = walk(skillRoot).filter((path) => path.endsWith(`${sep}SKILL.md`));
  if (skillFiles.length !== 1 || skillFiles[0] !== skillPath) {
    fail(`Expected exactly one immediate SKILL.md: ${skillRoot}`);
    continue;
  }
  const { text, fields } = parseFrontmatter(skillPath);
  if (fields.name !== entry.name) fail(`Skill name must match directory ${entry.name}: ${skillPath}`);
  if (!fields.description) fail(`Missing frontmatter description: ${skillPath}`);
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
    if (file.endsWith(".md")) checkLinks(file, readFileSync(file, "utf8"), skillRoot);
    if (file.endsWith(".mjs")) {
      const mode = statSync(file).mode & 0o777;
      if (readFileSync(file, "utf8").startsWith("#!") && (mode & 0o111) === 0) {
        fail(`Executable script lacks executable mode: ${file}`);
      }
    }
  }
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
