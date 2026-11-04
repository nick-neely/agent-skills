#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, win32 } from 'node:path';
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

// Fallback for an incomplete installation that has only the npm .cmd shim.
// Normal Windows calls use the native executable directly, with Node quoting
// argv rather than sending URLs or JavaScript through a command interpreter.
export const windowsScript = `$app = Get-Command -Name 'agent-browser.cmd' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $app) {
  [Console]::Error.WriteLine('agent-browser.cmd or agent-browser.exe was not found on PATH.')
  exit 127
}
$target = $app.Path
$parsed = ConvertFrom-Json -InputObject $env:UAT_BROWSER_ARGS
$uatArgs = @($parsed)
if (@($uatArgs | Where-Object { $_ -match '[&|<>^%\\x22\\r\\n]' }).Count -gt 0) {
  [Console]::Error.WriteLine('agent-browser resolves to a cmd shim without its native binary; arguments containing & | < > ^ % or double quotes cannot pass through cmd.exe safely. Reinstall agent-browser so its native binary is present.')
  exit 2
}
& $target @uatArgs
exit $LASTEXITCODE
`;

class UsageError extends Error {}

export function defaultDeps() {
  return {
    env: process.env,
    platform: process.platform,
    spawn: spawnSync,
    exists: existsSync,
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

function findOnPath(name, env, exists) {
  const pathName = Object.keys(env).find((key) => key.toUpperCase() === 'PATH');
  const dirs = (pathName ? env[pathName] : '').split(';').map((dir) => dir.replace(/"/g, '').trim());
  return dirs.filter(Boolean).map((dir) => win32.join(dir, name)).find((path) => exists(path)) ?? null;
}

export function browserCommand(argv, deps) {
  const env = childEnv(deps.env, deps.platform);
  if (deps.platform !== 'win32') return { command: 'agent-browser', args: argv, env };
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

export function main(args = process.argv.slice(2), overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  try {
    const [runDir, ...rest] = args;
    if (!runDir || !rest.length) throw new UsageError(usage);
    const flag = refusedFlag(rest);
    if (flag) throw new UsageError(`${flag.split('=')[0]} is not allowed: the run config and session are supplied by browser.mjs`);
    const run = readRun(runDir);
    if (!deps.exists(run.configPath)) throw new UsageError(`browser config ${run.configPath} is missing; create a new run with new-run.mjs`);
    const argv = ['--config', run.configPath, '--session', run.session, ...rest];
    const { command, args: commandArgs, env } = browserCommand(argv, deps);
    const result = deps.spawn(command, commandArgs, { stdio: 'inherit', env, windowsHide: true });
    if (result.error?.code === 'ENOENT') {
      deps.stderr(`${command} was not found on PATH; see references/setup.md\n`);
      return 127;
    }
    if (result.error) {
      deps.stderr(`could not run ${command}: ${result.error.message}\n`);
      return 1;
    }
    return result.status ?? 1;
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    deps.stderr(`${error.message}\n`);
    return 2;
  }
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  process.exitCode = main();
}
