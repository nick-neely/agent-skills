import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkSetup, envOverridesAction, findEnvOverrides, modeOverrideNames, runCommand,
} from '../skills/uat/scripts/check-setup.mjs';

const available = (stdout = 'tool 1.2.3\n') => ({ status: 0, stdout, stderr: '' });
const missing = () => ({ status: null, error: { code: 'ENOENT' } });

test('healthy setup needs only agent-browser and reports versions without raw CLI output', () => {
  const calls = [];
  const result = checkSetup({ run(command, args) {
    calls.push([command, ...args]);
    assert.equal(command, 'agent-browser');
    return available('tool 1.2.3\nsensitive output=private');
  } });
  assert.equal(result.ready, true);
  assert.equal(result.tools.agentBrowser.version, '1.2.3');
  assert.equal(result.runRoot, join(homedir(), '.uat', 'runs'));
  assert.doesNotMatch(JSON.stringify(result), /sensitive|private/);
  assert.deepEqual(calls, [
    ['agent-browser', '--version'],
    ['agent-browser', 'skills', 'get', 'core'],
  ]);
});

test('missing tools identify setup work without attempting auth or browser launch', () => {
  const calls = [];
  const result = checkSetup({ env: {}, run(command, args) {
    calls.push([command, ...args]);
    return missing();
  } });
  assert.equal(result.ready, false);
  assert.equal(result.tools.agentBrowser.state, 'missing');
  assert.equal(result.actions.length, 2);
  assert.deepEqual(calls, [
    ['agent-browser', '--version'], ['npm', '--version'],
  ]);
});

test('timeouts are execution failures rather than missing-tool installation requests', () => {
  const result = checkSetup({ run(command) {
    return command === 'agent-browser'
      ? { status: null, error: { code: 'ETIMEDOUT' }, signal: 'SIGTERM' }
      : available();
  } });
  assert.equal(result.ready, false);
  assert.equal(result.tools.agentBrowser.state, 'unavailable');
  assert.doesNotMatch(result.actions.join(' '), /Install agent-browser/);
});

test('older browser without bundled skills stays usable with installed help', () => {
  const result = checkSetup({ run(command, args) {
    return args[0] === 'skills' ? { status: 1 } : available();
  } });
  assert.equal(result.ready, true);
  assert.equal(result.tools.coreInstructions.state, 'unavailable');
  assert.match(result.actions.join(' '), /installed browser help/);
});

test('an existing broken browser does not create an unrelated npm installation requirement', () => {
  const calls = [];
  const result = checkSetup({ run(command, args) {
    calls.push(command);
    return { status: null, error: { code: 'ETIMEDOUT' } };
  } });
  assert.deepEqual(calls, ['agent-browser']);
  assert.equal(result.tools.npm.state, 'not-needed');
  assert.doesNotMatch(result.actions.join(' '), /Node\/npm/);
});

test('Windows checks PATH before invoking a missing npm shim or CLI', () => {
  const calls = [];
  const run = (command, args) => runCommand(command, args, {
    platform: 'win32',
    spawn(exe, argv) {
      calls.push([exe, ...argv]);
      assert.equal(exe, 'where.exe');
      return { status: 1, stdout: '', stderr: 'INFO: not found' };
    },
  });
  const result = checkSetup({ run });
  assert.equal(result.tools.agentBrowser.state, 'missing');
  assert.match(result.actions.join(' '), /Install agent-browser/);
  assert.deepEqual(calls, [
    ['where.exe', 'agent-browser'], ['where.exe', 'npm'],
  ]);
});

test('Windows invokes fixed probe names through cmd for npm .cmd shims in paths with spaces', () => {
  const calls = [];
  const result = runCommand('agent-browser', ['--version'], {
    platform: 'win32',
    spawn(exe, args, options) {
      calls.push({ exe, args, options });
      return exe === 'where.exe'
        ? available('C:\\Users\\Test User\\AppData\\Roaming\\npm\\agent-browser.cmd\r\n')
        : available('agent-browser 0.38.1');
    },
  });
  assert.equal(result.status, 0);
  assert.deepEqual(calls[1].args, ['/d', '/s', '/c', '"agent-browser --version"']);
  assert.equal(calls[1].exe, 'cmd.exe');
  assert.equal(calls[1].options.windowsVerbatimArguments, true);
  assert.equal(calls[1].options.shell, undefined);
});

test('macOS and Linux/WSL probes use executable resolution without a shell', () => {
  for (const platform of ['darwin', 'linux']) {
    runCommand('agent-browser', ['--version'], { platform, spawn(exe, args, options) {
      assert.equal(exe, 'agent-browser');
      assert.deepEqual(args, ['--version']);
      assert.equal(options.shell, undefined);
      return available();
    } });
  }
});

test('unrecognized probes cannot carry page/ticket text into a shell', () => {
  assert.throws(() => runCommand('agent-browser', ['--version', '&', 'something'], {
    platform: 'win32', spawn() { assert.fail('must not spawn'); },
  }), /Unsupported setup probe/);
});

test('symlinked skill paths execute the checker rather than silently succeeding', {
  skip: process.platform === 'win32' ? 'POSIX symlink process fixture; Windows uses the same realpath guard' : false,
}, () => {
  const temp = mkdtempSync(join(tmpdir(), 'uat-symlink-'));
  try {
    const script = fileURLToPath(new URL('../skills/uat/scripts/check-setup.mjs', import.meta.url));
    const linked = join(temp, 'linked checker.mjs');
    symlinkSync(script, linked);
    writeFileSync(join(temp, 'agent-browser'), '#!/bin/sh\nprintf "agent-browser 0.38.1\\n"\n', { mode: 0o755 });
    const result = spawnSync(process.execPath, [linked], {
      encoding: 'utf8', env: { ...process.env, PATH: temp }, timeout: 5000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).ready, true);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('missing Windows adapter helpers are not misclassified as missing target tools', () => {
  for (const failedHelper of ['where.exe', 'cmd.exe']) {
    const result = checkSetup({ run(command, args) {
      return runCommand(command, args, { platform: 'win32', spawn(exe) {
        return exe === failedHelper ? missing() : available('C:\\tools\\tool.cmd');
      } });
    } });
    assert.equal(result.tools.agentBrowser.state, 'unavailable');
    assert.doesNotMatch(result.actions.join(' '), /Install agent-browser/);
  }
});

test('importing from stdin is safe and does not accidentally run probes', () => {
  const moduleUrl = new URL('../skills/uat/scripts/check-setup.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    input: `await import(${JSON.stringify(moduleUrl)}); process.stdout.write('imported');`,
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'imported');
});

test('npm installation of a missing browser requires Node 24+, not an old working toolchain', () => {
  const result = checkSetup({ nodeVersion: '20.19.0', run(command) {
    return command === 'agent-browser' ? missing() : available();
  } });
  assert.match(result.actions.join(' '), /Node 24\+/);
  const installed = checkSetup({ nodeVersion: '20.19.0', run: () => available() });
  assert.equal(installed.ready, true);
  assert.doesNotMatch(installed.actions.join(' '), /Node 24\+/);
});

test('no inherited mode overrides reports an empty list and no action', () => {
  const result = checkSetup({ env: { PATH: '/bin', AGENT_BROWSER_EXECUTABLE_PATH: '/approved/chrome' }, run: () => available() });
  assert.deepEqual(result.envOverrides, []);
  assert.doesNotMatch(result.actions.join(' '), /overrides/);
});

test('inherited mode overrides report sorted names only, never values', () => {
  const env = {
    AGENT_BROWSER_STATE: '/private/state-value.json',
    AGENT_BROWSER_CDP_HEADERS: '{"Authorization":"Bearer secret-token"}',
    AGENT_BROWSER_PROFILE: 'profile-value',
    AGENT_BROWSER_HEADED: '1',
    AGENT_BROWSER_IDLE_TIMEOUT_MS: '1000',
    AGENT_BROWSER_SESSION: '',
    AGENT_BROWSER_DEBUG: 'debug-value',
  };
  const result = checkSetup({ env, run: () => available() });
  assert.deepEqual(result.envOverrides, [
    'AGENT_BROWSER_CDP_HEADERS', 'AGENT_BROWSER_HEADED', 'AGENT_BROWSER_IDLE_TIMEOUT_MS',
    'AGENT_BROWSER_PROFILE', 'AGENT_BROWSER_STATE',
  ]);
  assert.equal(result.ready, true);
  assert.ok(result.actions.includes(envOverridesAction));
  const json = JSON.stringify(result);
  for (const value of Object.values(env).filter((value) => value.length > 4)) assert.equal(json.includes(value), false);
  assert.doesNotMatch(json, /secret-token|state-value|profile-value|debug-value/);
});

test('empty override values are ignored and Windows names match case-insensitively', () => {
  assert.deepEqual(findEnvOverrides({ AGENT_BROWSER_CDP: '', AGENT_BROWSER_CONFIG: '' }, 'linux'), []);
  assert.deepEqual(findEnvOverrides({ agent_browser_cdp: '9222' }, 'linux'), []);
  assert.deepEqual(findEnvOverrides({ Agent_Browser_Cdp: '9222', AGENT_BROWSER_CDP: '9222' }, 'win32'), ['AGENT_BROWSER_CDP']);
  assert.equal(modeOverrideNames.length, 18);
  assert.deepEqual([...modeOverrideNames].sort(), [...modeOverrideNames]);
});
