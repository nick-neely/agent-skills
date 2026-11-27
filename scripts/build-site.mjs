// Builds the Astro site in site/ and merges it into dist/, beside the workflow
// endpoints that scripts/build-workflows.mjs writes there. That script replaces
// dist/ wholesale, so it runs first; this one only adds files, and refuses any
// path both builds produce rather than let one overwrite the other.

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const site = join(root, "site");
const siteOutput = join(site, "dist");
const output = join(root, "dist");

if (!existsSync(join(output, "workflows"))) {
  throw new Error("dist/workflows is missing; run node scripts/build-workflows.mjs first");
}
const astro = join(site, "node_modules", "astro", "bin", "astro.mjs");
if (!existsSync(astro)) {
  throw new Error("Site dependencies are not installed; run pnpm --dir site install --frozen-lockfile");
}

execFileSync(process.execPath, [astro, "build"], { cwd: site, stdio: "inherit" });

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}

const built = files(siteOutput);
const collisions = built.map((path) => relative(siteOutput, path)).filter((path) => {
  const target = join(output, path);
  return existsSync(target) || hasFileAncestor(path);
});

// A site directory must not land where the workflow build wrote a file.
function hasFileAncestor(path) {
  const parts = path.split(/[\\/]/).slice(0, -1);
  for (let i = 1; i <= parts.length; i++) {
    const ancestor = join(output, ...parts.slice(0, i));
    if (existsSync(ancestor) && !lstatSync(ancestor).isDirectory()) return true;
  }
  return false;
}

if (collisions.length) {
  throw new Error(`The site and the workflow build both write these paths:\n${collisions.map((p) => `  ${p}`).join("\n")}`);
}
for (const path of built) cpSync(path, join(output, relative(siteOutput, path)));
console.log(`Merged ${built.length} site files into dist/`);
