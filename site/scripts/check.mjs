// The site's whole check: types and Astro diagnostics, a build, then the tests
// against that build. `pnpm check` and ../scripts/validate both run this.

import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const site = fileURLToPath(new URL("../", import.meta.url));
const astro = fileURLToPath(new URL("../node_modules/astro/bin/astro.mjs", import.meta.url));
const run = (...args) => execFileSync(process.execPath, args, { cwd: site, stdio: "inherit" });

run(astro, "check");
run(astro, "build");
run("--test", ...readdirSync(new URL("../test/", import.meta.url)).filter((f) => f.endsWith(".test.mjs")).map((f) => `test/${f}`));
