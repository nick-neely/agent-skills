import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  childEnv, main, reservedFlags, windowsScript,
} from '../skills/uat/scripts/browser.mjs';
import { modeOverrideNames } from '../skills/uat/scripts/check-setup.mjs';

const script = fileURLToPath(new URL('../skills/uat/scripts/browser.mjs', import.meta.url));
const posixOnly = process.platform === 'win32' ? 'POSIX stub executable' : false;
const windowsOnly = process.platform !== 'win32' ? 'Native Windows PowerShell' : false;
const url = 'https://localhost:4200/orders?a=1&b=two words';

function fixture(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'uat browser ')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const runDir = join(root, 'run dir');
  mkdirSync(runDir);
  const configPath = join(runDir, 'browser-config.json');
  writeFileSync(configPath, '{}\n');
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ configPath, session: 'uat-localhost-4200' }));
  const calls = [];
  let stderr = '';
  const run = (args, overrides = {}) => {
    stderr = '';
    const code = main([runDir, ...args], {
      env: {},
      platform: 'linux',
      exists: () => true,
      spawn: (command, argv, options) => { calls.push({ command, argv, options }); return { status: 0 }; },
      stderr: (text) => { stderr += text; },
      ...overrides,
    });
    return { code, stderr };
  };
  return { root, runDir, configPath, calls, run };
}

test('POSIX argv puts the run config and session first and passes user args intact', (t) => {
  const { configPath, calls, run } = fixture(t);
  assert.equal(run(['open', url]).code, 0);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'agent-browser');
  assert.deepEqual(calls[0].argv, ['--config', configPath, '--session', 'uat-localhost-4200', 'open', url]);
  assert.equal(calls[0].options.stdio, 'inherit');
});

test('mode overrides are removed but other agent-browser and unrelated variables stay', () => {
  const env = Object.fromEntries(modeOverrideNames.map((name) => [name, 'secret']));
  Object.assign(env, { AGENT_BROWSER_EXECUTABLE_PATH: '/opt/chrome', PATH: '/bin', agent_browser_session: 'x' });
  assert.deepEqual(childEnv(env, 'linux'), {
    AGENT_BROWSER_EXECUTABLE_PATH: '/opt/chrome', PATH: '/bin', agent_browser_session: 'x',
  });
  assert.deepEqual(childEnv(env, 'win32'), { AGENT_BROWSER_EXECUTABLE_PATH: '/opt/chrome', PATH: '/bin' });
});

test('the spawned environment is filtered and values are never printed', (t) => {
  const { calls, run } = fixture(t);
  const env = { AGENT_BROWSER_STATE: 'secret-state', Agent_Browser_Cdp: 'secret-cdp', HOME: '/home/u' };
  const { stderr } = run(['snapshot', '-i'], { env, platform: 'win32', exists: (path) => path.endsWith('browser-config.json') });
  assert.equal(calls[0].options.env.AGENT_BROWSER_STATE, undefined);
  assert.equal(calls[0].options.env.Agent_Browser_Cdp, undefined);
  assert.equal(calls[0].options.env.HOME, '/home/u');
  assert.doesNotMatch(stderr, /secret/);
});

test('Windows cmd-only fallback uses PowerShell with argv as JSON and prefers pwsh on PATH', (t) => {
  const { configPath, calls, run } = fixture(t);
  const pwsh = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
  const env = { Path: `C:\\Windows\\System32;"C:\\Program Files\\PowerShell\\7"` };
  run(['open', url], { platform: 'win32', env, exists: (path) => path === pwsh || path === configPath });
  const { command, argv, options } = calls[0];
  assert.equal(command, pwsh);
  assert.deepEqual(argv, ['-NoProfile', '-NonInteractive', '-Command', windowsScript]);
  const expected = ['--config', configPath, '--session', 'uat-localhost-4200', 'open', url];
  assert.deepEqual(JSON.parse(options.env.UAT_BROWSER_ARGS), expected);
  assert.equal(options.env.Path, env.Path);

  run(['snapshot'], { platform: 'win32', env, exists: (path) => path === configPath });
  assert.equal(calls[1].command, 'powershell.exe');
});

test('the PowerShell script is 5.1 compatible and never routes through the .ps1 shim', () => {
  assert.match(windowsScript, /-Name 'agent-browser\.cmd'/);
  assert.match(windowsScript, /-CommandType Application/);
  assert.match(windowsScript, /\$parsed = ConvertFrom-Json -InputObject \$env:UAT_BROWSER_ARGS\n\$uatArgs = @\(\$parsed\)/);
  assert.match(windowsScript, /exit \$LASTEXITCODE/);
  assert.doesNotMatch(windowsScript, /\.ps1|cmd\.exe \/c|\?\?|\?\.|-AsHashtable|"/);
});

test('Windows native executable receives argv directly, preserving spaces and metacharacters', (t) => {
  const { configPath, calls, run } = fixture(t);
  const prefix = 'C:\\npm with spaces';
  const shim = `${prefix}\\agent-browser.cmd`;
  const packaged = `${prefix}\\node_modules\\agent-browser\\bin\\agent-browser-win32-x64.exe`;
  const payload = ['open', url, 'eval', 'document.querySelector("#a") && "two words"', '', 'C:\\run dir\\'];
  run(payload, { platform: 'win32', env: { Path: prefix }, exists: (path) => [configPath, shim, packaged].includes(path) });
  assert.equal(calls[0].command, packaged);
  assert.deepEqual(calls[0].argv, ['--config', configPath, '--session', 'uat-localhost-4200', ...payload]);
  assert.equal(calls[0].options.shell, undefined);
  assert.equal(calls[0].options.windowsVerbatimArguments, undefined);
  const standalone = `${prefix}\\agent-browser.exe`;
  run(payload, { platform: 'win32', env: { Path: prefix }, exists: (path) => [configPath, standalone].includes(path) });
  assert.equal(calls[1].command, standalone);
  assert.deepEqual(calls[1].argv, calls[0].argv);
});

test('Windows keeps the selected cmd-only installation instead of switching to another executable', (t) => {
  const { configPath, calls, run } = fixture(t);
  const first = 'C:\\approved\\agent-browser.cmd';
  const later = 'C:\\other\\agent-browser.exe';
  run(['snapshot'], { platform: 'win32', env: { Path: 'C:\\approved;C:\\other' },
    exists: (path) => [configPath, first, later].includes(path) });
  assert.equal(calls[0].command, 'powershell.exe');
  assert.deepEqual(JSON.parse(calls[0].options.env.UAT_BROWSER_ARGS),
    ['--config', configPath, '--session', 'uat-localhost-4200', 'snapshot']);
});

test('run config, session and browser-selection flags are refused in both forms', (t) => {
  const { calls, run } = fixture(t);
  for (const flag of reservedFlags) {
    for (const args of [['open', 'x', flag, 'v'], ['open', `${flag}=v`]]) {
      const result = run(args);
      assert.equal(result.code, 2, args.join(' '));
      assert.match(result.stderr, new RegExp(`${flag} is not allowed: the run config and session are supplied by browser.mjs`));
    }
  }
  assert.ok(['--config', '--session', '--profile', '--cdp', '--auto-connect', '--state', '--restore',
    '--session-name', '--provider', '-p', '--extension', '--init-script', '--enable', '--args']
    .every((flag) => reservedFlags.includes(flag)));
  assert.equal(calls.length, 0);
  assert.equal(run(['fill', '#name', '--sessions']).code, 0);
});

test('missing or invalid run.json and missing config exit 2 without running', (t) => {
  const { root, runDir, calls, run } = fixture(t);
  const missing = main([join(root, 'nope'), 'snapshot'], { stderr: () => {}, spawn: () => assert.fail('spawned') });
  assert.equal(missing, 2);
  writeFileSync(join(runDir, 'run.json'), '{"configPath": 1}');
  assert.match(run(['snapshot']).stderr, /no configPath or session/);
  writeFileSync(join(runDir, 'run.json'), 'not json');
  assert.equal(run(['snapshot']).code, 2);
  writeFileSync(join(runDir, 'run.json'), JSON.stringify({ configPath: join(runDir, 'gone.json'), session: 's' }));
  const result = run(['snapshot'], { exists: () => false });
  assert.equal(result.code, 2);
  assert.match(result.stderr, /is missing/);
  assert.equal(run([]).code, 2);
  assert.equal(calls.length, 0);
});

test('exit codes, signals and a missing CLI are reported', (t) => {
  const { run } = fixture(t);
  assert.equal(run(['snapshot'], { spawn: () => ({ status: 7 }) }).code, 7);
  assert.equal(run(['snapshot'], { spawn: () => ({ status: null, signal: 'SIGTERM' }) }).code, 1);
  const missing = run(['snapshot'], { spawn: () => ({ status: null, error: { code: 'ENOENT' } }) });
  assert.equal(missing.code, 127);
  assert.match(missing.stderr, /agent-browser was not found/);
});

test('POSIX wrapper runs a real agent-browser on PATH with filtered env', { skip: posixOnly }, (t) => {
  const { root, runDir, configPath } = fixture(t);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const out = join(root, 'received');
  writeFileSync(join(bin, 'agent-browser'), [
    '#!/bin/sh',
    'printf "%s\\0" "$@" > "$UAT_STUB_OUT.args"',
    'env > "$UAT_STUB_OUT.env"',
    'exit 7',
  ].join('\n'));
  chmodSync(join(bin, 'agent-browser'), 0o755);
  const env = {
    ...process.env, PATH: `${bin}${delimiter}${process.env.PATH}`, UAT_STUB_OUT: out,
    AGENT_BROWSER_SESSION: 'leaked-session', AGENT_BROWSER_CONFIG: '/leaked.json',
    AGENT_BROWSER_EXECUTABLE_PATH: '/opt/chrome', UAT_UNRELATED: 'kept',
  };
  const result = spawnSync(process.execPath, [script, runDir, 'eval', 'document.querySelector("#a") && 1', 'open', url], {
    encoding: 'utf8', env, timeout: 10000,
  });
  assert.equal(result.status, 7, result.stderr);
  assert.deepEqual(readFileSync(`${out}.args`, 'utf8').split('\0').slice(0, -1), [
    '--config', configPath, '--session', 'uat-localhost-4200',
    'eval', 'document.querySelector("#a") && 1', 'open', url,
  ]);
  const received = readFileSync(`${out}.env`, 'utf8');
  assert.match(received, /^AGENT_BROWSER_EXECUTABLE_PATH=\/opt\/chrome$/m);
  assert.match(received, /^UAT_UNRELATED=kept$/m);
  assert.doesNotMatch(received, /AGENT_BROWSER_SESSION|AGENT_BROWSER_CONFIG|leaked/);
});

for (const shell of ['powershell.exe', 'pwsh.exe']) {
  test(`${shell} runs a .cmd shim with safe args and refuses cmd metacharacters`, { skip: windowsOnly }, (t) => {
    const { root, runDir, configPath } = fixture(t);
    const bin = join(root, 'npm shims');
    mkdirSync(bin);
    const out = join(root, 'received.json');
    writeFileSync(join(bin, 'echo.cjs'),
      "require('fs').writeFileSync(process.env.UAT_STUB_OUT, JSON.stringify(process.argv.slice(2))); process.exit(7);");
    writeFileSync(join(bin, 'agent-browser.cmd'), '@"%UAT_NODE%" "%~dp0echo.cjs" %*\r\n');
    const env = { ...process.env, UAT_NODE: process.execPath, UAT_STUB_OUT: out };
    const pathName = Object.keys(env).find((name) => name.toUpperCase() === 'PATH');
    env[pathName] = `${bin};${env[pathName]}`;
    const exists = (path) => existsSync(path) && (shell === 'pwsh.exe' || !/pwsh\.exe$/i.test(path));
    if (shell === 'pwsh.exe' && spawnSync('where.exe', ['pwsh.exe']).status !== 0) {
      t.skip('pwsh.exe is not installed');
      return;
    }
    const opts = { env, exists, stderr: () => {} };
    assert.equal(main([runDir, 'snapshot', 'two words', '-i'], opts), 7);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')),
      ['--config', configPath, '--session', 'uat-localhost-4200', 'snapshot', 'two words', '-i']);
    rmSync(out);
    assert.equal(main([runDir, 'open', url], opts), 2);
    assert.equal(existsSync(out), false);
  });
}
