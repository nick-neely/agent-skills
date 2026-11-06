#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { join, resolve, win32 } from 'node:path';
import { isEntryPoint, modeOverrideNames } from './check-setup.mjs';

const usage = 'Usage: node browser.mjs <run-dir> <agent-browser args...>';

// A call without the run's --config can silently relaunch the running browser,
// and these flags would select a different browser, profile or state.
export const reservedFlags = Object.freeze([
  '--config', '--session', '--profile', '--cdp', '--auto-connect', '--state',
  '--restore', '--namespace', '--headed', '--idle-timeout',
  '--session-name', '--provider', '-p', '--extension', '--init-script',
  '--enable', '--args',
]);

// Fallback for an incomplete installation that has only the npm .cmd shim,
// or for no installation, through npx.cmd. Both run through cmd.exe. Normal
// Windows calls use the native executable directly, with Node quoting argv
// rather than sending URLs or JavaScript through a command interpreter.
export const windowsScript = `$app = Get-Command -Name 'agent-browser.cmd' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$npx = $null
if (-not $app) {
  $npx = Get-Command -Name 'npx.cmd' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $app -and -not $npx) {
  [Console]::Error.WriteLine('agent-browser.cmd, agent-browser.exe and npx.cmd were not found on PATH.')
  exit 127
}
$parsed = ConvertFrom-Json -InputObject $env:UAT_BROWSER_ARGS
$uatArgs = @($parsed)
$unsafe = @($uatArgs | Where-Object { $_ -match '[&|<>^%\\x22\\r\\n]' }).Count -gt 0
if ($npx) {
  if ($unsafe) {
    [Console]::Error.WriteLine('agent-browser is not installed and npx.cmd runs through cmd.exe; arguments containing & | < > ^ % or double quotes cannot pass through it safely. Install agent-browser globally (npm install -g agent-browser) so its native binary is used.')
    exit 2
  }
  $target = $npx.Path
  & $target '--yes' 'agent-browser' @uatArgs
  exit $LASTEXITCODE
}
if ($unsafe) {
  [Console]::Error.WriteLine('agent-browser resolves to a cmd shim without its native binary; arguments containing & | < > ^ % or double quotes cannot pass through cmd.exe safely. Reinstall agent-browser so its native binary is present.')
  exit 2
}
$target = $app.Path
& $target @uatArgs
exit $LASTEXITCODE
`;

// Headless runs (new-run.mjs --mode headless) sign in headed, save the state
// with `state save <statePath>`, then test headless. While the state file
// exists, the next navigation uses the headless config plus --state; a successful
// open launches the browser with it and deletes the file. The marker then
// keeps every later call on the headless config, because a call whose launch
// settings differ relaunches the running browser and loses its sign-in.
export const activeMarker = '.headless-active';
const launchCommands = ['open', 'goto', 'navigate'];

// Global options that consume a value in agent-browser 0.41.1. Locate the
// command without mistaking an option value (for example input-mode human)
// for it. Browser-selection options are rejected before this scan.
const valueFlags = new Set([
  '--restore-save', '--restore-check-url', '--restore-check-text', '--restore-check-fn',
  '--headers', '--executable-path', '--cdp-headers', '--proxy', '--proxy-bypass',
  '--user-agent', '--device', '--color-scheme', '--download-path', '--max-output',
  '--allowed-domains', '--action-policy', '--confirm-actions', '--engine',
  '--input-mode', '--screenshot-dir', '--screenshot-quality', '--screenshot-format',
  '--ca-cert', '--model',
]);

function commandArgs(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--') return args.slice(index + 1);
    if (!arg.startsWith('-')) return args.slice(index);
    if (!arg.includes('=') && (valueFlags.has(arg) || ['true', 'false'].includes(args[index + 1]))) index += 1;
  }
  return [];
}

class UsageError extends Error {}

export function defaultDeps() {
  return {
    env: process.env,
    platform: process.platform,
    spawn: spawnSync,
    exists: existsSync,
    chmod: chmodSync,
    stderr: (text) => process.stderr.write(text),
  };
}

export function readRun(runDir) {
  let run;
  try {
    run = JSON.parse(readFileSync(join(runDir, 'run.json'), 'utf8'));
  } catch (error) {
    throw new UsageError(`cannot read run.json in ${runDir} (${error.code ?? error.message}); create the run with new-run.mjs first`);
  }
  if (typeof run?.configPath !== 'string' || typeof run?.session !== 'string' || !run.session) {
    throw new UsageError(`run.json in ${runDir} has no configPath or session; create the run with new-run.mjs`);
  }
  return run;
}

export function refusedFlag(args) {
  return args.find((arg) => reservedFlags.some((flag) => arg === flag || arg.startsWith(`${flag}=`)));
}

// Removes inherited mode overrides; other variables, including
// AGENT_BROWSER_EXECUTABLE_PATH, pass through unchanged.
export function childEnv(env, platform) {
  const result = { ...env };
  for (const name of Object.keys(result)) {
    if (modeOverrideNames.includes(platform === 'win32' ? name.toUpperCase() : name)) delete result[name];
  }
  return result;
}

export function browserPhase(run, runDir, args, exists) {
  if (typeof run.statePath !== 'string' || typeof run.headlessConfigPath !== 'string') {
    return { configPath: run.configPath, stateArgs: [], pending: false, loads: false, saves: false };
  }
  const [name, sub, path] = commandArgs(args);
  const saves = name === 'state' && sub === 'save' && typeof path === 'string'
    && resolve(path) === resolve(run.statePath);
  const pending = !saves && exists(run.statePath);
  const loads = pending && launchCommands.includes(name);
  const headless = loads || exists(join(runDir, activeMarker));
  return {
    configPath: headless ? run.headlessConfigPath : run.configPath,
    stateArgs: loads ? ['--state', run.statePath] : [],
    pending,
    loads,
    saves,
  };
}

// The sign-in config is the single source of approved launch settings. Derive
// the headless phase after the operator/agent has added restrictions or an
// executable path, instead of silently replacing them with an empty config.
function deriveHeadlessConfig(run) {
  let config;
  try {
    config = JSON.parse(readFileSync(run.configPath, 'utf8'));
  } catch {
    throw new UsageError('cannot read the canonical browser config; preserve its restrictions before continuing');
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new UsageError('canonical browser config must be an object; preserve its restrictions before continuing');
  }
  writeFileSync(run.headlessConfigPath, `${JSON.stringify({ ...config, headed: false, autoConnect: false }, null, 2)}\n`);
}

function findOnPath(name, env, exists) {
  const pathName = Object.keys(env).find((key) => key.toUpperCase() === 'PATH');
  const dirs = (pathName ? env[pathName] : '').split(';').map((dir) => dir.replace(/"/g, '').trim());
  return dirs.filter(Boolean).map((dir) => win32.join(dir, name)).find((path) => exists(path)) ?? null;
}

export function browserCommand(argv, deps) {
  const env = childEnv(deps.env, deps.platform);
  // Without a global install, npx fetches agent-browser into the npm cache.
  if (deps.platform !== 'win32') {
    return { command: 'agent-browser', args: argv, env, fallback: { command: 'npx', args: ['--yes', 'agent-browser', ...argv] } };
  }
  const shim = findOnPath('agent-browser.cmd', env, deps.exists);
  const packagedNative = shim && win32.join(win32.dirname(shim), 'node_modules', 'agent-browser', 'bin', 'agent-browser-win32-x64.exe');
  const native = shim
    ? (deps.exists(packagedNative) ? packagedNative : null)
    : findOnPath('agent-browser.exe', env, deps.exists);
  if (native) return { command: native, args: argv, env };
  const shell = findOnPath('pwsh.exe', env, deps.exists) ?? 'powershell.exe';
  return {
    command: shell,
    args: ['-NoProfile', '-NonInteractive', '-Command', windowsScript],
    env: {
      ...env,
      UAT_BROWSER_ARGS: JSON.stringify(argv),
    },
  };
}

function spawnBrowser(argv, deps) {
  const { command, args, env, fallback } = browserCommand(argv, deps);
  const options = { stdio: 'inherit', env, windowsHide: true };
  let ran = command;
  let result = deps.spawn(command, args, options);
  if (result.error?.code === 'ENOENT' && fallback) {
    ran = fallback.command;
    result = deps.spawn(fallback.command, fallback.args, options);
  }
  if (result.error?.code === 'ENOENT') {
    const missing = fallback ? `${command} and ${fallback.command} were` : `${command} was`;
    deps.stderr(`${missing} not found on PATH; see references/setup.md\n`);
    return 127;
  }
  if (result.error) {
    deps.stderr(`could not run ${ran}: ${result.error.message}\n`);
    return 1;
  }
  return result.status ?? 1;
}

export function main(args = process.argv.slice(2), overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  try {
    const [runDir, ...rest] = args;
    if (!runDir || !rest.length) throw new UsageError(usage);
    const flag = refusedFlag(rest);
    if (flag) throw new UsageError(`${flag.split('=')[0]} is not allowed: the run config and session are supplied by browser.mjs`);
    const run = readRun(runDir);
    const phase = browserPhase(run, runDir, rest, deps.exists);
    if (phase.configPath === run.headlessConfigPath) deriveHeadlessConfig(run);
    if (!deps.exists(phase.configPath)) throw new UsageError(`browser config ${phase.configPath} is missing; create a new run with new-run.mjs`);
    // The state file holds sign-in tokens; new-run.mjs secures Windows headless run folders.
    const restrict = () => { if (deps.platform !== 'win32') deps.chmod(run.statePath, 0o600); };
    if (phase.pending) restrict();
    const argv = ['--config', phase.configPath, '--session', run.session, ...phase.stateArgs, ...rest];
    const code = spawnBrowser(argv, deps);
    if (code === 0 && phase.saves && deps.exists(run.statePath)) restrict();
    if (code === 0 && phase.loads) {
      writeFileSync(join(runDir, activeMarker), '');
      rmSync(run.statePath, { force: true });
    } else if (code !== 0 && phase.pending) {
      deps.stderr(`${run.statePath} still exists and holds sign-in tokens; it is deleted after the next successful open\n`);
    }
    return code;
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    deps.stderr(`${error.message}\n`);
    return 2;
  }
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  process.exitCode = main();
}
