import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  activeMarker, childEnv, main, refusedFlag, reservedFlags, windowsScript,
} from '../skills/uat/scripts/browser.mjs';
import { modeOverrideNames } from '../skills/uat/scripts/check-setup.mjs';

const script = fileURLToPath(new URL('../skills/uat/scripts/browser.mjs', import.meta.url));
const posixOnly = process.platform === 'win32' ? 'POSIX stub executable' : false;
const windowsOnly = process.platform !== 'win32' ? 'Native Windows PowerShell' : false;
const url = 'https://localhost:4200/orders?a=1&b=two words';
const fileMode = (path) => statSync(path).mode & 0o777;
const checkModes = process.platform !== 'win32';

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

// A --mode headless run: real files, so the wrapper sees the state file and marker.
function headlessFixture(t) {
  const base = fixture(t);
  const headlessConfigPath = join(base.runDir, 'browser-config.headless.json');
  const statePath = join(base.runDir, 'auth-state.json');
  writeFileSync(headlessConfigPath, '{}\n');
  writeFileSync(join(base.runDir, 'run.json'), JSON.stringify({
    configPath: base.configPath, headlessConfigPath, statePath, session: 'uat-abc123',
  }));
  const run = (args, overrides = {}) => base.run(args, { exists: existsSync, ...overrides });
  const saveState = () => writeFileSync(statePath, '{"cookies":[{"value":"secret-token"}]}', { mode: 0o644 });
  return { ...base, run, headlessConfigPath, statePath, saveState, marker: join(base.runDir, activeMarker) };
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
  assert.match(missing.stderr, /agent-browser and npx were not found on PATH/);
});

test('POSIX falls back to npx with the same argv and environment when agent-browser is missing', (t) => {
  const { configPath, calls, run } = fixture(t);
  const spawn = (command, argv, options) => {
    calls.push({ command, argv, options });
    return command === 'agent-browser' ? { status: null, error: { code: 'ENOENT' } } : { status: 4 };
  };
  const result = run(['open', url], { spawn, env: { AGENT_BROWSER_SESSION: 'leaked', HOME: '/home/u' } });
  assert.equal(result.code, 4);
  assert.equal(result.stderr, '');
  assert.deepEqual(calls.map((call) => call.command), ['agent-browser', 'npx']);
  assert.deepEqual(calls[1].argv, ['--yes', 'agent-browser', '--config', configPath, '--session', 'uat-localhost-4200', 'open', url]);
  assert.deepEqual(calls[1].options, calls[0].options);
  assert.deepEqual(calls[1].options.env, { HOME: '/home/u' });
  const failed = run(['snapshot'], { spawn: (command) => (command === 'npx' ? { error: { code: 'EACCES', message: 'denied' } } : { error: { code: 'ENOENT' } }) });
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /could not run npx: denied/);
});

test('Windows never falls back to npx outside the PowerShell script', (t) => {
  const { calls, run } = fixture(t);
  const missing = run(['snapshot'], { platform: 'win32', spawn: (command, argv) => { calls.push({ command, argv }); return { error: { code: 'ENOENT' } }; } });
  assert.equal(missing.code, 127);
  assert.equal(calls.length, 1);
  assert.match(missing.stderr, /^powershell\.exe was not found on PATH/);
});

test('the PowerShell script falls back to npx.cmd and refuses cmd metacharacters there too', () => {
  const lines = windowsScript.split('\n');
  const at = (pattern) => lines.findIndex((line) => pattern.test(line));
  const npxLookup = at(/\$npx = Get-Command -Name 'npx\.cmd' -CommandType Application/);
  assert.ok(npxLookup > at(/-Name 'agent-browser\.cmd'/), 'npx.cmd is looked up after agent-browser.cmd');
  assert.ok(at(/^if \(-not \$app\) \{$/) < npxLookup, 'npx.cmd is only looked up without agent-browser.cmd');
  assert.ok(at(/exit 127/) > npxLookup);
  assert.match(windowsScript, /agent-browser\.cmd, agent-browser\.exe and npx\.cmd were not found on PATH/);
  const npxBranch = windowsScript.slice(windowsScript.indexOf('if ($npx) {'), windowsScript.indexOf('exit $LASTEXITCODE'));
  assert.match(npxBranch, /if \(\$unsafe\) \{\n.*npx\.cmd runs through cmd\.exe.*npm install -g agent-browser.*\n\s+exit 2\n/);
  assert.match(npxBranch, /& \$target '--yes' 'agent-browser' @uatArgs\n/);
  assert.ok(npxBranch.indexOf('exit 2') < npxBranch.indexOf('& $target'), 'refusal precedes the npx call');
  assert.match(windowsScript, /\$unsafe = @\(\$uatArgs \| Where-Object \{ \$_ -match '\[&\|<>\^%\\x22\\r\\n\]' \}\)\.Count -gt 0/);
  assert.equal(windowsScript.match(/exit \$LASTEXITCODE/g).length, 2);
});

test('headless runs sign in with the sign-in config, then load the state once and stay headless', (t) => {
  const { configPath, headlessConfigPath, statePath, saveState, marker, calls, run } = headlessFixture(t);
  const prefix = (config) => ['--config', config, '--session', 'uat-abc123'];
  assert.equal(run(['open', url]).code, 0);
  assert.deepEqual(calls[0].argv, [...prefix(configPath), 'open', url]);

  saveState();
  // close and other non-launching calls must not consume the tokens.
  assert.equal(run(['close']).code, 0);
  assert.deepEqual(calls[1].argv, [...prefix(configPath), 'close']);
  assert.ok(existsSync(statePath));
  if (checkModes) assert.equal(fileMode(statePath), 0o600);

  assert.equal(run(['open', url]).code, 0);
  assert.deepEqual(calls[2].argv, [...prefix(headlessConfigPath), '--state', statePath, 'open', url]);
  assert.equal(existsSync(statePath), false);
  assert.ok(existsSync(marker));

  // A headed config would relaunch the running headless browser and lose the sign-in.
  assert.equal(run(['snapshot', '-i']).code, 0);
  assert.deepEqual(calls[3].argv, [...prefix(headlessConfigPath), 'snapshot', '-i']);
  assert.equal(run(['--json', 'goto', url]).code, 0);
  assert.deepEqual(calls[4].argv, [...prefix(headlessConfigPath), '--json', 'goto', url]);
});

test('headless navigation retains canonical executable, proxy, CA and policy settings', (t) => {
  const { configPath, headlessConfigPath, saveState, statePath, calls, run } = headlessFixture(t);
  const config = { headed: true, autoConnect: false, executablePath: '/approved/chromium',
    allowedDomains: ['example.test'], actionPolicy: '/approved/policy.json',
    proxy: 'http://127.0.0.1:8080', caCert: '/approved/ca.pem' };
  writeFileSync(configPath, JSON.stringify(config));
  saveState();
  assert.equal(run(['close']).code, 0);
  assert.equal(calls[0].argv.includes('--state'), false);
  assert.equal(run(['open', url]).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(headlessConfigPath, 'utf8')),
    { ...config, headed: false, autoConnect: false });
  assert.equal(existsSync(statePath), false);
  assert.equal(run(['snapshot']).code, 0);
  assert.deepEqual(JSON.parse(readFileSync(headlessConfigPath, 'utf8')),
    { ...config, headed: false, autoConnect: false });
});

test('unreadable or invalid canonical config cannot silently drop headless restrictions', (t) => {
  const { configPath, saveState, statePath, calls, run } = headlessFixture(t);
  saveState();
  for (const content of ['{secret-invalid-config', 'null', '[]']) {
    writeFileSync(configPath, content);
    const result = run(['open', url]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /canonical browser config/);
    assert.doesNotMatch(result.stderr, /secret-invalid-config/);
    assert.equal(calls.length, 0);
    assert.ok(existsSync(statePath));
  }
  rmSync(configPath);
  assert.equal(run(['open', url]).code, 2);
  assert.equal(calls.length, 0);
});

test('a failed load keeps the state file and says so without printing its contents', (t) => {
  const { statePath, saveState, marker, run } = headlessFixture(t);
  saveState();
  const failed = run(['open', url], { spawn: () => ({ status: 1 }) });
  assert.equal(failed.code, 1);
  assert.ok(existsSync(statePath));
  assert.equal(existsSync(marker), false);
  assert.equal(failed.stderr, `${statePath} still exists and holds sign-in tokens; it is deleted after the next successful open\n`);
  assert.doesNotMatch(failed.stderr, /secret-token/);
  const missing = run(['open', url], { spawn: () => ({ error: { code: 'ENOENT' } }) });
  assert.equal(missing.code, 127);
  assert.match(missing.stderr, /still exists and holds sign-in tokens/);
  assert.equal(run(['navigate', url]).code, 0);
  assert.equal(existsSync(statePath), false);
});

test('state save to the state path is allowed, keeps the current config and makes the file private', (t) => {
  const { configPath, headlessConfigPath, statePath, marker, calls, run } = headlessFixture(t);
  assert.equal(refusedFlag(['state', 'save', statePath]), undefined);
  const save = (command, argv) => {
    calls.push({ command, argv });
    writeFileSync(statePath, '{}', { mode: 0o644 });
    return { status: 0 };
  };
  assert.equal(run(['state', 'save', statePath], { spawn: save }).code, 0);
  assert.deepEqual(calls[0].argv, ['--config', configPath, '--session', 'uat-abc123', 'state', 'save', statePath]);
  assert.ok(existsSync(statePath));
  if (checkModes) assert.equal(fileMode(statePath), 0o600);

  // Saving again over an existing file must not switch to the headless config,
  // which would relaunch the signed-in headed browser.
  chmodSync(statePath, 0o644);
  assert.equal(run(['state', 'save', relative(process.cwd(), statePath)], { spawn: save }).code, 0);
  assert.equal(calls[1].argv[1], configPath);
  assert.equal(calls[1].argv.includes('--state'), false);
  if (checkModes) assert.equal(fileMode(statePath), 0o600);

  rmSync(statePath);
  writeFileSync(marker, '');
  assert.equal(run(['state', 'save', statePath], { spawn: save }).code, 0);
  assert.equal(calls[2].argv[1], headlessConfigPath);
  assert.ok(existsSync(statePath));
});

test('Windows headless runs skip chmod', (t) => {
  const { statePath, saveState, calls, run } = headlessFixture(t);
  saveState();
  const chmod = () => assert.fail('chmod on Windows');
  assert.equal(run(['open', url], { platform: 'win32', chmod }).code, 0);
  assert.equal(calls[0].command, 'powershell.exe');
  assert.ok(JSON.parse(calls[0].options.env.UAT_BROWSER_ARGS).includes(statePath));
  assert.equal(existsSync(statePath), false);
});

test('POSIX wrapper falls back to a real npx on PATH with filtered env', { skip: posixOnly }, (t) => {
  const { root, runDir, configPath } = fixture(t);
  const bin = join(root, 'npx only');
  mkdirSync(bin);
  const out = join(root, 'received');
  writeFileSync(join(bin, 'npx'), [
    '#!/bin/sh',
    'printf "%s\\0" "$@" > "$UAT_STUB_OUT.args"',
    '/usr/bin/env > "$UAT_STUB_OUT.env"',
    'exit 5',
  ].join('\n'));
  chmodSync(join(bin, 'npx'), 0o755);
  const env = {
    ...process.env, PATH: bin, UAT_STUB_OUT: out,
    AGENT_BROWSER_SESSION: 'leaked-session', AGENT_BROWSER_STATE: '/leaked-state.json', UAT_UNRELATED: 'kept',
  };
  const result = spawnSync(process.execPath, [script, runDir, 'open', url], { encoding: 'utf8', env, timeout: 10000 });
  assert.equal(result.status, 5, result.stderr);
  assert.deepEqual(readFileSync(`${out}.args`, 'utf8').split('\0').slice(0, -1), [
    '--yes', 'agent-browser', '--config', configPath, '--session', 'uat-localhost-4200', 'open', url,
  ]);
  const received = readFileSync(`${out}.env`, 'utf8');
  assert.match(received, /^UAT_UNRELATED=kept$/m);
  assert.doesNotMatch(received, /AGENT_BROWSER_SESSION|AGENT_BROWSER_STATE|leaked/);
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

test('powershell.exe falls back to an npx.cmd shim with safe args and refuses cmd metacharacters', { skip: windowsOnly }, (t) => {
  const { root, runDir, configPath } = fixture(t);
  const bin = join(root, 'npx only');
  mkdirSync(bin);
  const out = join(root, 'received.json');
  writeFileSync(join(bin, 'echo.cjs'),
    "require('fs').writeFileSync(process.env.UAT_STUB_OUT, JSON.stringify(process.argv.slice(2))); process.exit(7);");
  writeFileSync(join(bin, 'npx.cmd'), '@"%UAT_NODE%" "%~dp0echo.cjs" %*\r\n');
  // Only the stub and Windows itself on PATH, so no installed agent-browser is found.
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PATH'));
  const system = join(process.env.SystemRoot, 'System32');
  env.Path = [bin, system, join(system, 'WindowsPowerShell', 'v1.0')].join(';');
  Object.assign(env, { UAT_NODE: process.execPath, UAT_STUB_OUT: out });
  const opts = { env, stderr: () => {} };
  assert.equal(main([runDir, 'snapshot', 'two words', '-i'], opts), 7);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')),
    ['--yes', 'agent-browser', '--config', configPath, '--session', 'uat-localhost-4200', 'snapshot', 'two words', '-i']);
  rmSync(out);
  assert.equal(main([runDir, 'open', url], opts), 2);
  assert.equal(existsSync(out), false);
});
