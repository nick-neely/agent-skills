import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { posix } from "node:path";
import { pathToFileURL } from "node:url";

function api(route) {
  return JSON.parse(execFileSync("gh", ["api", route], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
}

export function releaseInputs(tree, path) {
  if (tree.truncated) throw new Error("GitHub returned an incomplete upstream tree");
  const files = tree.tree.filter(({ path: name }) =>
    name === path || ((posix.dirname(name) === "." || path.startsWith(posix.dirname(name) + "/")) &&
      /^(?:licen[cs]es?|copying|notices?)(?:[._-].*)?$/i.test(posix.basename(name)))
  );
  if (!files.some((entry) => entry.path === path && entry.type === "tree") ||
      !tree.tree.some((entry) => entry.path === path + "/SKILL.md" && entry.type === "blob")) {
    throw new Error("Missing upstream skill: " + path);
  }
  return files.map(({ path: name, sha, mode }) => [name, sha, mode]).sort(([a], [b]) => a.localeCompare(b));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lockFile = new URL("../external-skills.json", import.meta.url);
  const pins = JSON.parse(readFileSync(lockFile, "utf8"));
  let changed = false;
  for (const [member, pin] of Object.entries(pins)) {
    const repo = member.split("@")[0];
    const latest = api("repos/" + repo + "/commits/HEAD").sha;
    if (latest === pin.commit) continue;
    const inputs = (commit) => releaseInputs(api("repos/" + repo + "/git/trees/" + commit + "?recursive=1"), pin.path);
    if (JSON.stringify(inputs(latest)) === JSON.stringify(inputs(pin.commit))) continue;
    console.log(member + ": " + pin.commit + " -> " + latest);
    pin.commit = latest;
    changed = true;
  }
  if (changed) writeFileSync(lockFile, JSON.stringify(pins, null, 2) + "\n");
}
