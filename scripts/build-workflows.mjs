import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const localSource = "nick-neely/agent-skills";
const skillName = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const repositoryName = /^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const licenseName = /^(?:licen[cs]es?|copying)(?:[._-].*)?$/i;
const noticeName = /^notices?(?:[._-].*)?$/i;

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function checkName(name) {
  if (typeof name !== "string" || name.length > 64 || !skillName.test(name)) {
    throw new Error(`Invalid skill name: ${name}`);
  }
}

function safePath(path) {
  return typeof path === "string" && !path.includes("..") &&
    path.split("/").every((part) => /^[A-Za-z0-9_.-]+$/.test(part) && part !== "." && part.toLowerCase() !== ".git");
}

function localFiles(directory) {
  if (!lstatSync(directory).isDirectory()) throw new Error(`Not a skill directory: ${directory}`);
  const files = new Map();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if ([".DS_Store", "node_modules", "__pycache__"].includes(entry.name) || entry.name.endsWith(".pyc")) continue;
    const path = join(directory, entry.name);
    if (!safePath(entry.name)) throw new Error(`Unsupported package filename: ${path}`);
    if (entry.isDirectory()) {
      for (const [name, content] of localFiles(path)) files.set(`${entry.name}/${name}`, content);
    } else if (entry.isFile()) {
      files.set(entry.name, readFileSync(path));
    } else {
      throw new Error(`Expected a regular package file: ${path}`);
    }
  }
  return files;
}

function git(directory, ...args) {
  return execFileSync("git", ["-C", directory, "-c", "credential.helper=", ...args], {
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 120_000,
  });
}

function gitTree(directory, tree, ...options) {
  return git(directory, "ls-tree", "-z", ...options, tree).toString("utf8").split("\0").filter(Boolean).map((record) => {
    const tab = record.indexOf("\t");
    const [mode, , id] = record.slice(0, tab).split(" ");
    return { mode, id, path: record.slice(tab + 1) };
  });
}

function blob(directory, entry) {
  if (!safePath(entry.path) || !["100644", "100755"].includes(entry.mode)) {
    throw new Error(`Expected a regular package file with a URL-safe path: ${entry.path}`);
  }
  return git(directory, "cat-file", "blob", entry.id);
}

function addNotice(files, path, content) {
  if (files.has(path)) throw new Error(`Reserved license filename already exists: ${path}`);
  if (!content.toString("utf8").trim()) throw new Error(`Empty license or notice: ${path}`);
  files.set(path, content);
}

function addUpstreamLicense(files, directory, commit, skillPath) {
  if ([...files].some(([path, content]) => !path.includes("/") && licenseName.test(path) && content.toString("utf8").trim())) return;

  // A skill can inherit a license from a collection directory or the repository.
  for (let ancestor = posix.dirname(skillPath); ; ancestor = posix.dirname(ancestor)) {
    const entries = gitTree(directory, ancestor === "." ? commit : `${commit}:${ancestor}`);
    if (entries.some(({ path }) => licenseName.test(path))) {
      for (const entry of entries.filter(({ path }) => licenseName.test(path) || noticeName.test(path))) {
        addNotice(files, `UPSTREAM-${entry.path}`, blob(directory, entry));
      }
      return;
    }
    if (ancestor === ".") throw new Error(`No upstream license found for ${skillPath} at ${commit}`);
  }
}

function externalFiles(source, name, pins, checkout) {
  const key = `${source}@${name}`;
  const pin = pins[key];
  if (!pin || typeof pin.commit !== "string" || !/^[a-f0-9]{40}$/.test(pin.commit) || !safePath(pin.path)) {
    throw new Error(`Expected an exact commit and skill path in external-skills.json for ${key}`);
  }
  const { commit, path } = pin;
  try {
    const directory = checkout(source, commit);
    const files = new Map(gitTree(directory, `${commit}:${path}`, "-r").map((entry) => [entry.path, blob(directory, entry)]));
    addUpstreamLicense(files, directory, commit, path);
    return files;
  } catch (error) {
    throw new Error(`Cannot package ${key} at ${commit}: ${error.message}`, { cause: error });
  }
}

function skillDescription(name, files) {
  const frontmatter = files.get("SKILL.md")?.toString("utf8").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  const declaredName = frontmatter?.match(/^name: +(.*)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
  if (declaredName !== name) throw new Error(`Expected SKILL.md with frontmatter name ${name}`);
  const field = frontmatter.match(/^description: *(.*)(\r?\n[ \t]+[^\r\n]+)*/m);
  let description = field?.[1].trim();
  if (/^[>|][+-]?$/.test(description)) description = field[0].split(/\r?\n/).slice(1).map((line) => line.trim()).join(" ");
  description = description?.replace(/^["']|["']$/g, "").trim();
  if (!description) throw new Error(`Missing SKILL.md description for ${name}`);
  return description;
}

function publishWorkflows(scratch) {
  const site = join(scratch, "site");
  const archives = join(site, "archives");
  mkdirSync(archives, { recursive: true });
  const pins = readJson("external-skills.json");
  const localRoot = join(root, "skills");
  if (!lstatSync(localRoot).isDirectory()) throw new Error("Expected a local skills directory");
  const localLicense = readFileSync(join(root, "LICENSE"));
  const packages = new Map();
  const checkouts = new Map();
  function checkout(source, commit) {
    const key = `${source}@${commit}`;
    if (!checkouts.has(key)) {
      const directory = mkdtempSync(join(scratch, "upstream-"));
      git(directory, "init", "--quiet", "--object-format=sha1");
      git(directory, "fetch", "--quiet", "--depth=1", "--no-tags", `https://github.com/${source}.git`, commit);
      if (git(directory, "rev-parse", "FETCH_HEAD^{commit}").toString().trim() !== commit) {
        throw new Error(`Upstream did not return the pinned commit ${commit}`);
      }
      checkouts.set(key, directory);
    }
    return checkouts.get(key);
  }

  const origin = process.env.VERCEL_URL ? "https://" + process.env.VERCEL_URL : "";
  // Each skill is archived once, however many indexes list it.
  function pack(source, name) {
    const key = `${source}@${name}`;
    if (!packages.has(key)) {
      const files = source === localSource ? localFiles(join(localRoot, name)) : externalFiles(source, name, pins, checkout);
      if (source === localSource) addNotice(files, "REPOSITORY-LICENSE.txt", localLicense);
      const directory = mkdtempSync(join(scratch, "skill-"));
      for (const [path, bytes] of files) {
        const target = join(directory, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, bytes);
      }
      const zip = directory + ".zip";
      execFileSync("python3", [join(root, "scripts", "archive-workflow-skill.py"), directory, zip]);
      const digest = createHash("sha256").update(readFileSync(zip)).digest("hex");
      renameSync(zip, join(archives, digest + ".zip"));
      packages.set(key, { name, description: skillDescription(name, files), type: "archive",
        url: origin + "/archives/" + digest + ".zip", digest: "sha256:" + digest });
    }
    return packages.get(key);
  }
  function writeIndex(directory, skills) {
    const discovery = join(directory, ".well-known", "agent-skills");
    mkdirSync(discovery, { recursive: true });
    const index = { $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json", skills };
    writeFileSync(join(discovery, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
  }

  const manifests = readdirSync(join(root, "packs")).filter((file) => file.endsWith(".json")).sort();
  if (!manifests.length) throw new Error("No workflow manifests found in packs/");
  for (const file of manifests) {
    const workflow = file.slice(0, -".json".length);
    checkName(workflow);
    const { members } = readJson(`packs/${file}`);
    if (!Array.isArray(members?.[localSource]) || !members[localSource].includes(workflow)) {
      throw new Error(`Workflow ${workflow} must include its entry skill`);
    }
    const skills = [];
    const names = new Set();
    for (const [source, list] of Object.entries(members)) {
      if (!repositoryName.test(source) || !Array.isArray(list) || !list.length) {
        throw new Error(`Invalid member list for ${source} in workflow ${workflow}`);
      }
      for (const name of list) {
        checkName(name);
        if (names.has(name)) throw new Error(`Duplicate install name ${name} in workflow ${workflow}`);
        names.add(name);
        skills.push(pack(source, name));
      }
    }
    writeIndex(join(site, "workflows", workflow), skills);
  }

  // The site root indexes every local skill on its own, so
  // `npx skills add <site> --skill <name>` installs any one of them.
  const local = readdirSync(localRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map(({ name }) => name).sort();
  local.forEach(checkName);
  writeIndex(site, local.map((name) => pack(localSource, name)));

  const output = join(root, "dist");
  rmSync(output, { recursive: true, force: true });
  renameSync(site, output);
  console.log(`Built ${manifests.length} workflow indexes in dist/workflows/ and a root index of ${local.length} skills`);
}

const scratch = mkdtempSync(join(root, ".workflow-build-"));
try {
  publishWorkflows(scratch);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
