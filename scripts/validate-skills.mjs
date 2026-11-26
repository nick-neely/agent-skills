#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const args = process.argv.slice(2);
// Rewrites the README's generated install table instead of checking it.
const writeInstall = args.includes("--write-install");
const root = resolve(args.find((arg) => !arg.startsWith("--")) || process.cwd());
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
  "metadata",
];
const BOOLEAN_FRONTMATTER_KEYS = ["disable-model-invocation"];
// `requires` lists skills a skill cannot work without and `uses` the ones only
// some paths reach, each a space-separated list.
const METADATA_KEYS = ["requires", "uses"];
const EXTERNAL_SKILL = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const INSTALL_START = "<!-- install-commands:start -->";
const INSTALL_END = "<!-- install-commands:end -->";
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

function trackedExecutable(path) {
  const repositoryPath = relative(root, path).split(sep).join("/");
  try {
    const entry = execFileSync(
      "git",
      ["-C", root, "ls-files", "--stage", "--", repositoryPath],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    const mode = entry.match(/^(\d{6})\s/);
    if (mode) return mode[1] === "100755";
  } catch {
    // A temporary validation fixture may not be a repository. Fall back to
    // the filesystem there; published repository files use the Git index.
  }
  return (statSync(path).mode & 0o111) !== 0;
}

function parseFrontmatter(path) {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    fail(`Missing YAML frontmatter: ${path}`);
    return { text, fields: {}, metadata: {} };
  }
  const end = lines.indexOf("---", 1);
  if (end < 0) {
    fail(`Unterminated YAML frontmatter: ${path}`);
    return { text, fields: {}, metadata: {} };
  }
  const fields = {};
  const metadata = {};
  for (let index = 1; index < end; index += 1) {
    const line = lines[index];
    if (line === "metadata:") {
      if (fields.metadata !== undefined) fail(`Duplicate frontmatter key metadata: ${path}`);
      fields.metadata = "";
      while (index + 1 < end && /^ {2}\S/.test(lines[index + 1])) {
        // YAML needs an ASCII space after the colon; without one, or with a
        // lookalike such as a nonbreaking space, the line is a scalar.
        const entry = lines[++index].match(/^ {2}([a-z][a-z0-9-]*): +(\S.*)$/);
        if (!entry) fail(`Malformed metadata line in ${path}: ${lines[index]}`);
        else if (metadata[entry[1]] !== undefined) fail(`Duplicate metadata key ${entry[1]}: ${path}`);
        else metadata[entry[1]] = entry[2];
      }
      if (!Object.keys(metadata).length) fail(`Metadata block is empty: ${path}`);
      continue;
    }
    const match = line.match(/^([a-z][a-z0-9-]*):\s*(.+)$/);
    if (match?.[1] === "metadata") {
      fail(`Metadata must be a block of indented keys: ${path}`);
      continue;
    }
    if (!match) {
      fail(`Malformed YAML frontmatter line in ${path}: ${line}`);
      continue;
    }
    if (fields[match[1]] !== undefined) fail(`Duplicate frontmatter key ${match[1]}: ${path}`);
    let value = match[2];
    // Accept folded descriptions without changing the skill's YAML. Keep the
    // parsed value so the existing length and duplicate-key checks still apply.
    const foldedDescription = match[1] === "description" && /^>-?$/.test(value);
    if (foldedDescription) {
      const folded = [];
      while (index + 1 < end && /^ {2}\S/.test(lines[index + 1])) {
        folded.push(lines[++index].slice(2));
      }
      value = folded.join(" ") + (value === ">" && folded.length ? "\n" : "");
      if (!folded.length) fail(`Folded description requires indented content: ${path}`);
    }
    fields[match[1]] = foldedDescription ? value : value.replace(/^["']|["']$/g, "");
  }
  return { text, fields, metadata };
}

function stripFences(text) {
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
  return kept.join("\n");
}

// Code holds examples, not links. Scanning it reports every documented
// `![alt](path)` snippet as a broken local link.
function stripCode(text) {
  // Inline spans may be delimited by any run of backticks, so a doubled span
  // like ``![alt](x)`` has to be matched by its own opening run.
  return stripFences(text).replace(/(`+)[^\n]*?\1/g, "");
}

// The call forms CONTRIBUTING.md documents. The verb form needs its backticks,
// so these read text with only fences removed.
// A call may wrap onto the next line but never spans a blank one, which ends
// the paragraph.
const GAP = String.raw`(?:[ \t]+|[ \t]*\r?\n[ \t]*)`;
const NAME = String.raw`([a-z0-9]+(?:-[a-z0-9]+)*)`;
const QUOTED_CALLS = [
  new RegExp(`Skill${GAP}tool${GAP}with${GAP}"${NAME}"`, "g"),
  new RegExp(String.raw`\bcall${GAP}"${NAME}"`, "gi"),
  new RegExp(
    String.raw`\b(?:call|use|follow|run|load|read|invoke)${GAP}(?:the${GAP})?` +
      "`" + NAME + "`" + GAP + String.raw`skill\b`,
    "gi",
  ),
];
// A `$name` inside an inline span is shell, so this one reads text with all
// code removed.
const DOLLAR_CALL = /\$([a-z0-9]+(?:-[a-z0-9]+)*)(?![A-Za-z0-9_-])/g;

function quotedCallTargets(text) {
  const prose = stripFences(text);
  return QUOTED_CALLS.flatMap((form) => [...prose.matchAll(form)]).map((match) => match[1]);
}

function dollarCallTargets(text) {
  return [...stripCode(text).matchAll(DOLLAR_CALL)].map((match) => match[1]);
}

// An agent cannot reach a user-invoked skill, so a skill that calls one stops
// there. A shared method belongs in a model-invoked skill.
function checkNoCallsToUserInvokedSkills(path, text, userInvoked) {
  for (const target of new Set([...quotedCallTargets(text), ...dollarCallTargets(text)])) {
    if (userInvoked.has(target)) {
      fail(`Skill calls user-invoked skill ${target}: ${path}`);
    }
  }
}

const dependencyName = (token) => EXTERNAL_SKILL.exec(token)?.[1] ?? token;
const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The exact ways prose names a skill, besides a $name call: `name` or `/name`
// in backticks, "name" in double quotes, and for an outside skill its full
// `owner/repo@name`. Anything looser would read ordinary words such as
// `name()` as a dependency.
function names(prose, token) {
  const name = escapeRegExp(dependencyName(token));
  const forms = [`\`/?${name}\``, `"${name}"`];
  if (EXTERNAL_SKILL.test(token)) forms.push(`\`${escapeRegExp(token)}\``);
  return new RegExp(forms.join("|")).test(prose);
}

// A skill's own prose: frontmatter and fenced examples name nothing, and each
// file is stripped on its own so an unclosed fence hides only that file.
function skillProse(skill) {
  return skill.files.map((file) => {
    const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    const body = file === skill.path ? text.replace(/^---\n[\s\S]*?\n---\n/, "") : text;
    return { body, prose: stripFences(body) };
  });
}

// Someone installing one skill learns what else it needs only from its
// declarations, so every skill it names must be declared and every
// declaration real.
function checkDependencies(skills) {
  for (const [name, skill] of skills) {
    const declared = new Map();
    for (const token of [...skill.requires, ...skill.uses]) {
      if (!SKILL_NAME_PATTERN.test(token) && !EXTERNAL_SKILL.test(token)) {
        fail(`Malformed dependency ${token}: ${skill.path}`);
        continue;
      }
      const target = dependencyName(token);
      if (declared.has(target)) fail(`Dependency ${target} is declared twice: ${skill.path}`);
      declared.set(target, token);
      if (EXTERNAL_SKILL.test(token)) {
        if (skills.has(target)) fail(`External dependency ${token} names a skill in this repository: ${skill.path}`);
      } else if (!skills.has(token)) {
        fail(`Unknown skill dependency ${token}: ${skill.path}`);
      } else if (token === name) {
        fail(`Skill depends on itself: ${skill.path}`);
      }
    }
    const files = skillProse(skill);
    const prose = files.map((file) => file.prose).join("\n");
    const dollarCalls = new Set(files.flatMap((file) => dollarCallTargets(file.body)));
    const named = new Set([
      ...[...skills.keys()].filter((other) => names(prose, other)),
      ...files.flatMap((file) => quotedCallTargets(file.body)),
      // A `$word` calls a skill wherever it comes from, so an outside one must
      // be declared too. A leading letter keeps a price such as $5 out.
      ...[...dollarCalls].filter((target) => /^[a-z]/.test(target)),
    ]);
    named.delete(name);
    for (const target of named) {
      if (!declared.has(target)) fail(`Skill names undeclared skill ${target}: ${skill.path}`);
    }
    const declaredTokens = new Set(declared.values());
    for (const [, token] of prose.matchAll(/`([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[a-z0-9]+(?:-[a-z0-9]+)*)`/g)) {
      if (!declaredTokens.has(token)) fail(`Skill names undeclared skill ${token}: ${skill.path}`);
    }
    for (const [target, token] of declared) {
      if (!names(prose, token) && !dollarCalls.has(target)) {
        fail(`Declared dependency ${target} is never named: ${skill.path}`);
      }
    }
  }
  const reported = new Set();
  for (const start of skills.keys()) {
    const visit = (name, trail) => {
      for (const next of skills.get(name)?.requires ?? []) {
        if (next === start) {
          const key = [...trail].sort().join(" ");
          if (!reported.has(key)) fail(`Required skills form a cycle: ${[...trail, next].join(" -> ")}`);
          reported.add(key);
        } else if (skills.has(next) && !trail.includes(next)) {
          visit(next, [...trail, next]);
        }
      }
    };
    visit(start, [start]);
  }
}

// What one skill reaches. `needs` follows requires alone, itself first, and
// `sometimes` is everything else reachable; each holds repository skills in
// `local` and other repositories' in `outside`. Declaration order keeps the
// output stable.
function installSets(name, skills) {
  const reach = (start, keys) => {
    const local = [...start];
    const outside = [];
    for (let index = 0; index < local.length; index += 1) {
      for (const token of keys.flatMap((key) => skills.get(local[index])[key])) {
        if (EXTERNAL_SKILL.test(token)) {
          if (!outside.includes(token)) outside.push(token);
        } else if (skills.has(token) && !local.includes(token)) {
          local.push(token);
        }
      }
    }
    return { local, outside };
  };
  const needs = reach([name], ["requires"]);
  const all = reach(needs.local, ["requires", "uses"]);
  return {
    needs,
    sometimes: {
      local: all.local.slice(needs.local.length),
      outside: all.outside.filter((token) => !needs.outside.includes(token)),
    },
  };
}

function installTable(skills) {
  const cell = (list) => (list.length ? `\`${list.join(" ")}\`` : "-");
  const rows = [...skills.keys()]
    .sort()
    .filter((name) => skills.get(name).requires.length || skills.get(name).uses.length)
    .map((name) => {
      const { needs, sometimes } = installSets(name, skills);
      const outside = [
        ...needs.outside.map((token) => `\`${token}\` (required)`),
        ...sometimes.outside.map((token) => `\`${token}\``),
      ];
      return `| \`${name}\` | ${cell(needs.local)} | ${cell(sometimes.local)} | ${outside.join(", ") || "-"} |`;
    });
  if (!rows.length) return "";
  return [
    "| Skill | Install | Add for the paths that use them | From other repositories |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

// The README is where someone installing by hand looks, so its table is
// generated from the declarations and a stale copy fails. It is written only
// from declarations that passed every other check, and only between its
// markers.
function checkInstallTable(readmePath, skills) {
  if (!existsSync(readmePath)) return;
  // Bytes, so a rewrite leaves everything outside the markers exactly as it
  // was, whatever its encoding.
  const readme = readFileSync(readmePath);
  const count = (marker) => readme.toString("latin1").split(marker).length - 1;
  const table = installTable(skills);
  if (count(INSTALL_START) > 1 || count(INSTALL_END) > 1) {
    fail(`README has more than one install table: ${readmePath}`);
    return;
  }
  const start = readme.indexOf(INSTALL_START);
  const end = readme.indexOf(INSTALL_END);
  if (start < 0 || end < start) {
    if (table) fail(`README lacks the generated install table between ${INSTALL_START} and ${INSTALL_END}: ${readmePath}`);
    return;
  }
  const current = readme.subarray(start, end).toString("utf8");
  const expected = `${INSTALL_START}\n${table}`;
  if (current.replace(/\r\n/g, "\n") === expected) return;
  if (!writeInstall) {
    fail(`README install table is stale; run scripts/validate-skills.mjs --write-install: ${readmePath}`);
  } else if (errors.length) {
    fail(`README install table was not written; fix the errors above first: ${readmePath}`);
  } else {
    const eol = current.includes("\r\n") ? "\r\n" : "\n";
    writeFileSync(
      readmePath,
      Buffer.concat([readme.subarray(0, start), Buffer.from(expected.replace(/\n/g, eol)), readme.subarray(end)]),
    );
  }
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

// Filled only from skills whose layout passed, so a malformed one is never read.
const userInvoked = new Set();
const validated = new Map();
// Split on ASCII spaces alone, as YAML does, so a lookalike space stays in
// its token and fails as malformed.
const tokens = (value) => (value ? value.replace(/^ +| +$/g, "").split(/ +/) : []);

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
  const { text, fields, metadata } = parseFrontmatter(skillPath);
  if (fields["disable-model-invocation"] === "true") userInvoked.add(entry.name);
  for (const key of Object.keys(metadata)) {
    if (!METADATA_KEYS.includes(key)) fail(`Unknown metadata key ${key}: ${skillPath}`);
  }
  validated.set(entry.name, {
    path: skillPath,
    files: walk(skillRoot).filter((path) => path.endsWith(".md")),
    requires: tokens(metadata.requires),
    uses: tokens(metadata.uses),
  });
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
      if (readFileSync(file, "utf8").startsWith("#!") && !trackedExecutable(file)) {
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

for (const { files } of validated.values()) {
  for (const file of files) {
    checkNoCallsToUserInvokedSkills(file, readFileSync(file, "utf8"), userInvoked);
  }
}
checkDependencies(validated);
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

checkInstallTable(join(root, "README.md"), validated);

if (errors.length) {
  for (const error of errors) process.stderr.write(`${error}\n`);
  process.exit(1);
}
process.stdout.write(`Validated ${entries.length} skill(s).\n`);
