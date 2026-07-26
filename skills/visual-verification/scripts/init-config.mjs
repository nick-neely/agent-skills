#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const printOnly = argv.includes("--print");
const targetArg = argv.find((arg) => !arg.startsWith("--"));
const root = targetArg ? resolve(targetArg) : process.cwd();
const scriptDir = dirname(fileURLToPath(import.meta.url));
const detectPath = join(scriptDir, "detect-project.mjs");
const configPath = join(root, ".agents", "visual-verification.json");
const localConfigPath = join(root, ".agents", "visual-verification.local.json");
const gitignorePath = join(root, ".gitignore");

function die(message) {
  console.error(message);
  process.exit(1);
}

const detected = spawnSync(process.execPath, [detectPath, root], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (detected.error || detected.status !== 0) {
  die(detected.stderr || detected.error?.message || "detect-project.mjs failed");
}

const info = JSON.parse(detected.stdout);
const config = {
  $schema: "https://agents.local/visual-verification.schema.json",
  protectedRoutes: info.inferred.protectedRoutes,
  devServer: {
    startCommand: info.inferred.devServer.startCommand,
  },
  auth: info.inferred.auth,
};
const localConfig = {
  baseUrl: info.inferred.baseUrl,
  baseUrlSource: info.inferred.baseUrlSource,
  devServer: {
    checkUrl: info.inferred.devServer.checkUrl,
  },
};

if (config.auth?.needsAdapterScript) {
  config.auth.refreshCommand = null;
  config.notes = [
    "Auth was detected, but the global initializer does not assume a refresh command name.",
    "Inspect candidateRefreshCommands and the app auth/schema before wiring or generating a repo-local auth adapter.",
  ];
}

if (existsSync(configPath) && !force && !printOnly) {
  die(`Config already exists: ${configPath}\nPass --force to overwrite or --print to preview.`);
}

const serialized = `${JSON.stringify(config, null, 2)}\n`;
const localSerialized = `${JSON.stringify(localConfig, null, 2)}\n`;
if (printOnly) {
  process.stdout.write(serialized);
  process.stdout.write(`\n--- .agents/visual-verification.local.json ---\n${localSerialized}`);
} else {
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, serialized, { mode: 0o644 });
  writeFileSync(localConfigPath, localSerialized, { mode: 0o644 });
  ensureGitignore(root);
  console.log(`Wrote ${configPath}`);
  console.log(`Wrote ${localConfigPath}`);
}

function ensureGitignore(repoRoot) {
  const entries = [".agents/visual-verification.local.json", ".auth/"];
  let current = "";
  try {
    current = readFileSync(gitignorePath, "utf8");
  } catch {}

  const lines = current.split(/\r?\n/);
  const missing = entries.filter((entry) => !lines.includes(entry));
  if (!missing.length) return;

  const prefix = current && !current.endsWith("\n") ? "\n" : "";
  const block = `${prefix}\n# visual verification local state\n${missing.join("\n")}\n`;
  writeFileSync(gitignorePath, `${current}${block}`, { mode: 0o644 });
}
