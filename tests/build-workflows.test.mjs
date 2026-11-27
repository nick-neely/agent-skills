import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const source = "fixture/upstream";
const local = "nick-neely/agent-skills";
const binary = Buffer.from([0, 0x89, 0x50, 0x4e, 0x47, 0xff]);
const pinnedHelper = '---\nname: "helper"\ndescription: >-\n  Pinned upstream\n  description.\n---\nPinned instructions.\n';

function fixture(t) {
  const temporary = mkdtempSync(join(tmpdir(), "workflow-build-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const repo = join(temporary, "repo");
  const upstream = join(temporary, "upstream");

  function put(directory, path, value) {
    const target = join(directory, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, value);
  }

  function git(...args) {
    return execFileSync("git", ["-C", upstream, "-c", "user.email=fixture@example.test", "-c", "user.name=Fixture", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }

  function commit(message) {
    git("add", ".");
    git("-c", "commit.gpgsign=false", "commit", "-qm", message);
    return git("rev-parse", "HEAD");
  }

  mkdirSync(upstream);
  git("init", "-q", "--object-format=sha1");
  git("config", "core.autocrlf", "false");
  put(upstream, "LICENSE", "Repository license.\n");
  put(upstream, "vendor/LICENSE.txt", "Collection license.\n");
  put(upstream, "vendor/NOTICE", "Collection notice.\n");
  put(upstream, "vendor/helper/SKILL.md", pinnedHelper);
  put(upstream, "vendor/helper/assets/sample.png", binary);
  put(upstream, "vendor/other/SKILL.md", "---\nname: other\ndescription: Other helper.\n---\nOther instructions.\n");
  put(upstream, "vendor/other/LICENSE.md", "Skill-specific license.\n");
  const pinnedCommit = commit("Pinned revision");
  put(upstream, "vendor/helper/SKILL.md", pinnedHelper.replace("Pinned instructions.", "Unreviewed instructions."));
  put(upstream, "vendor/LICENSE.txt", "Changed collection license.\n");
  commit("Unreviewed revision");

  const pins = {
    [`${source}@helper`]: { commit: pinnedCommit, path: "vendor/helper" },
    [`${source}@other`]: { commit: pinnedCommit, path: "vendor/other" },
  };
  const write = (path, value) => put(repo, path, value);
  const json = (path, value) => write(path, JSON.stringify(value));
  for (const name of ["alpha", "beta", "standalone"]) {
    write(`skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: ${name} description.\n---\n${name} instructions.\n`);
  }
  write("LICENSE", "Local repository license.\n");
  write("skills/alpha/LICENSE", "Local skill attribution.\n");
  write("skills/alpha/assets/sample.bin", binary);
  json("packs/alpha.json", { members: { [local]: ["alpha"], [source]: ["helper", "other"] } });
  json("packs/beta.json", { members: { [local]: ["beta"], [source]: ["helper"] } });
  json("external-skills.json", pins);

  const script = join(repo, "scripts", "build-workflows.mjs");
  mkdirSync(dirname(script));
  copyFileSync(new URL("../scripts/build-workflows.mjs", import.meta.url), script);
  copyFileSync(new URL("../scripts/archive-workflow-skill.py", import.meta.url), join(repo, "scripts/archive-workflow-skill.py"));
  const run = () => spawnSync(process.execPath, [script], {
    cwd: temporary,
    encoding: "utf8",
    env: {
      ...process.env,
      VERCEL_URL: "fixture-deployment.vercel.app",
      GIT_ALLOW_PROTOCOL: "file",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: `url.${pathToFileURL(upstream).href}.insteadOf`,
      GIT_CONFIG_VALUE_0: `https://github.com/${source}.git`,
    },
  });
  const workflow = (name, ...paths) => join(repo, "dist", "workflows", name, ".well-known", "agent-skills", ...paths);
  return { repo, upstream, git, commit, pinnedCommit, run, workflow, json, pins };
}

test("publishes exact workflow membership, pinned assets and applicable licenses", (t) => {
  const { repo, run, workflow } = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const alpha = JSON.parse(readFileSync(workflow("alpha", "index.json"), "utf8"));
  const beta = JSON.parse(readFileSync(workflow("beta", "index.json"), "utf8"));
  assert.deepEqual(alpha.skills.map(({ name }) => name), ["alpha", "helper", "other"]);
  assert.deepEqual(beta.skills.map(({ name }) => name), ["beta", "helper"]);
  assert.deepEqual(beta.skills[1], alpha.skills[1]);
  assert.equal(alpha.skills[1].description, "Pinned upstream description.");
  function archiveFile(index, entry, path) {
    const url = new URL(index.skills[entry].url);
    assert.equal(url.hostname, "fixture-deployment.vercel.app");
    return execFileSync("python3", ["-c", "import sys,zipfile; sys.stdout.buffer.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]))",
      join(repo, "dist", url.pathname), path]);
  }
  assert.deepEqual(archiveFile(alpha, 0, "assets/sample.bin"), binary);
  assert.deepEqual(archiveFile(alpha, 1, "assets/sample.png"), binary);
  assert.equal(archiveFile(alpha, 1, "SKILL.md").toString(), pinnedHelper);
  assert.equal(archiveFile(alpha, 1, "UPSTREAM-LICENSE.txt").toString(), "Collection license.\n");
  assert.equal(archiveFile(alpha, 1, "UPSTREAM-NOTICE").toString(), "Collection notice.\n");
  assert.equal(archiveFile(alpha, 0, "REPOSITORY-LICENSE.txt").toString(), "Local repository license.\n");
  assert.equal(archiveFile(alpha, 2, "LICENSE.md").toString(), "Skill-specific license.\n");

  rmSync(join(repo, "packs", "beta.json"));
  const rebuild = run();
  assert.equal(rebuild.status, 0, rebuild.stderr);
  assert.equal(existsSync(workflow("beta", "index.json")), false);
});

test("refuses a moving external revision and keeps the prior output", (t) => {
  const { run, workflow, pins, json } = fixture(t);
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  const previous = readFileSync(workflow("alpha", "index.json"));

  pins[`${source}@helper`].commit = "main";
  json("external-skills.json", pins);
  const rejected = run();
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /Expected an exact commit and skill path in external-skills\.json for fixture\/upstream@helper/);
  assert.deepEqual(readFileSync(workflow("alpha", "index.json")), previous);
});

test("refuses to publish an external skill without a license", (t) => {
  const { upstream, commit, pins, json, run, workflow } = fixture(t);
  rmSync(join(upstream, "LICENSE"));
  rmSync(join(upstream, "vendor", "LICENSE.txt"));
  pins[`${source}@helper`].commit = commit("Missing license");
  json("external-skills.json", pins);
  const result = run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No upstream license found for vendor\/helper/);
  assert.equal(existsSync(workflow("alpha", "index.json")), false);
});
