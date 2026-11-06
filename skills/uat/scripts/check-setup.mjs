#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { homedir, release } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Windows npm .cmd shims require cmd.exe. Only these fixed probe commands may
// enter that shell; no ticket, page, path or other user text is interpolated.
const allowedProbes = new Set([
  'agent-browser --version', 'agent-browser skills get core',
  'npx --offline --no-install --logs-max=0 --package=agent-browser agent-browser --version',
  'npx --offline --no-install --logs-max=0 --package=agent-browser agent-browser skills get core',
  'npm --version',
]);

export function runCommand(command, args, { platform = process.platform, spawn = spawnSync } = {}) {
  const probeCommand = [command, ...args].join(' ');
  if (!allowedProbes.has(probeCommand)) throw new Error('Unsupported setup probe');
  const options = {
    encoding: 'utf8',
    timeout: 12000,
    maxBuffer: 256 * 1024,
    windowsHide: true,
  };
  if (platform !== 'win32') return spawn(command, args, options);

  // cmd.exe reports missing programs as an exit code, not ENOENT. Check PATH
  // first so absent .exe/.cmd programs are distinguishable from broken ones.
  const found = spawn('where.exe', [command], options);
  if (found.error || found.signal) return { ...found, error: { code: 'ESETUPHELPER' } };
  if (found.status === 1) return { status: null, error: { code: 'ENOENT' } };
  if (found.status !== 0) return found;
  const result = spawn('cmd.exe', ['/d', '/s', '/c', `"${probeCommand}"`], {
    ...options, windowsVerbatimArguments: true,
  });
  return result.error ? { ...result, error: { code: 'ESETUPHELPER' } } : result;
}

// Inherited variables that change which browser, profile, state or config a
// call uses. Only names are reported; values may be secret.
export const modeOverrideNames = Object.freeze([
  'AGENT_BROWSER_ARGS', 'AGENT_BROWSER_AUTO_CONNECT', 'AGENT_BROWSER_CDP',
  'AGENT_BROWSER_CDP_HEADERS', 'AGENT_BROWSER_CONFIG', 'AGENT_BROWSER_ENABLE',
  'AGENT_BROWSER_EXTENSIONS', 'AGENT_BROWSER_HEADED', 'AGENT_BROWSER_IDLE_TIMEOUT_MS',
  'AGENT_BROWSER_INIT_SCRIPTS', 'AGENT_BROWSER_NAMESPACE',
  'AGENT_BROWSER_PLUGINS', 'AGENT_BROWSER_PROFILE', 'AGENT_BROWSER_PROVIDER',
  'AGENT_BROWSER_RESTORE', 'AGENT_BROWSER_SESSION', 'AGENT_BROWSER_SESSION_NAME',
  'AGENT_BROWSER_STATE',
]);

export const envOverridesAction = 'Inherited agent-browser mode overrides are set; make every browser call through scripts/browser.mjs, which removes them, and record their names in the report.';

// Windows environment names are case-insensitive; POSIX names are exact.
export function findEnvOverrides(env = process.env, platform = process.platform) {
  const found = new Set();
  for (const [name, value] of Object.entries(env)) {
    const canonical = platform === 'win32' ? name.toUpperCase() : name;
    if (value && modeOverrideNames.includes(canonical)) found.add(canonical);
  }
  return [...found].sort();
}

function probe(run, command, args, { npxCache = false } = {}) {
  const result = run(command, args);
  if (result.error?.code === 'ENOENT') return { state: 'missing' };
  // npm distinguishes an offline cache miss or refused install from a broken
  // CLI. Do not expose stderr, which may contain local paths or config.
  const cacheMiss = /\b(?:ENOTCACHED|ECANCELED)\b|npx canceled due to missing packages/i.test(result.stderr ?? '');
  const missingCommand = result.status === 127
    && /agent-browser.*(?:not found|not recognized)/i.test(result.stderr ?? '');
  if (npxCache && !result.error && !result.signal && result.status !== 0 && (cacheMiss || missingCommand)) {
    return { state: 'missing' };
  }
  if (result.error || result.signal || result.status !== 0) return { state: 'unavailable' };
  const version = args.at(-1) === '--version'
    ? result.stdout?.match(/\b\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?\b/)?.[0]
    : undefined;
  return { state: 'available', ...(version ? { version } : {}) };
}

export function checkSetup({ run = runCommand, nodeVersion = process.versions.node, env = process.env } = {}) {
  let command = 'agent-browser';
  let prefix = [];
  let browser = probe(run, command, ['--version']);
  if (browser.state === 'missing') {
    command = 'npx';
    prefix = ['--offline', '--no-install', '--logs-max=0', '--package=agent-browser', 'agent-browser'];
    browser = probe(run, command, [...prefix, '--version'], { npxCache: true });
  }
  if (browser.state !== 'missing') browser = { ...browser, launcher: command };
  const core = browser.state === 'available'
    ? probe(run, command, [...prefix, 'skills', 'get', 'core'])
    : { state: 'not-checked' };
  const npm = browser.state === 'missing'
    ? probe(run, 'npm', ['--version'])
    : { state: 'not-needed' };
  const actions = [];
  if (browser.state === 'missing') actions.push('Install agent-browser or prime the npx cache, then install its browser using references/setup.md.');
  else if (browser.state !== 'available') actions.push(`Inspect the ${browser.launcher} execution failure before changing its installation.`);
  if (npm.state !== 'available' && browser.state === 'missing') actions.push('Resolve the approved Node/npm toolchain before browser installation.');
  if (browser.state === 'missing' && Number(nodeVersion.split('.')[0]) < 24) actions.push('Current agent-browser npm releases require Node 24+; verify the selected package engines before installation.');
  if (browser.state === 'available' && core.state !== 'available') actions.push('Inspect installed browser help; bundled core instructions are unavailable.');
  const envOverrides = findEnvOverrides(env);
  if (envOverrides.length) actions.push(envOverridesAction);
  const ready = browser.state === 'available';
  return {
    ready,
    node: nodeVersion,
    platform: process.platform,
    architecture: process.arch,
    wsl: process.platform === 'linux' && (/microsoft/i.test(release()) || Boolean(process.env.WSL_DISTRO_NAME)),
    runRoot: join(homedir(), '.uat', 'runs'),
    tools: { agentBrowser: browser, coreInstructions: core, npm },
    envOverrides,
    actions,
    browserLaunch: 'not-tested; verify during the actual run',
  };
}

export function main(args = process.argv.slice(2)) {
  if (args.length) {
    process.stderr.write('Usage: node check-setup.mjs\n');
    return 2;
  }
  const result = checkSetup();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.ready ? 0 : 1;
}

export function isEntryPoint(entry, moduleUrl = import.meta.url) {
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entry);
  } catch {
    return false;
  }
}

if (isEntryPoint(process.argv[1])) {
  process.exitCode = main();
}
