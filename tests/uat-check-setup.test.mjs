import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  checkSetup, envOverridesAction, findEnvOverrides, modeOverrideNames, runCommand,
} from '../skills/uat/scripts/check-setup.mjs';
import { main as npxMain, withNpxDirectory } from '../skills/uat/scripts/npx.mjs';

const available = (stdout = 'tool 1.2.3\n') => ({ status: 0, stdout, stderr: '' });
const missing = () => ({ status: null, error: { code: 'ENOENT' } });
const npxPrefix = ['--offline', '--no-install', '--logs-max=0', '--package=agent-browser@0.41.1', 'agent-browser'];

test('bootstrap accepts only fixed commands and uses a neutral cwd on each platform', () => {
  const prefix = ['--yes', '--package=agent-browser@0.41.1', 'agent-browser'];
  for (const platform of ['darwin', 'linux', 'win32']) {
    for (const args of [['--version'], ['install'], ['install', '--with-deps']]) {
      let cwd;
      const status = npxMain(args, { platform, spawn(exe, argv, options) {
        cwd = options.cwd;
        assert.notEqual(cwd, process.cwd());
        assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')), {
          name: 'uat-browser-runtime', private: true,
        });
        assert.equal(options.stdio, 'inherit');
        assert.equal(options.windowsHide, true);
        if (platform === 'win32') {
          assert.equal(exe, 'cmd.exe');
          assert.deepEqual(argv, ['/d', '/s', '/c', `"npx ${[...prefix, ...args].join(' ')}"`]);
          assert.equal(options.windowsVerbatimArguments, true);
        } else {
          assert.equal(exe, 'npx');
          assert.deepEqual(argv, [...prefix, ...args]);
          assert.equal(options.windowsVerbatimArguments, undefined);
        }
        return { status: 0 };
      } });
      assert.equal(status, 0);
      assert.equal(existsSync(cwd), false);
    }
  }
});

test('bootstrap rejects unsupported arguments and help performs no spawn', () => {
  const output = [];
  const options = { spawn() { assert.fail('unexpected spawn'); },
    stdout: (text) => output.push(text), stderr: (text) => output.push(text) };
  assert.equal(npxMain(['--help'], options), 0);
  for (const args of [[], ['--yes'], ['--version;touch marker'], ['install --with-deps'],
    ['install', '--with-deps', '&&', 'echo'], ['install', '--with-deps;echo'], ['install', '--help']]) {
    assert.equal(npxMain(args, options), 2, JSON.stringify(args));
  }
  assert.ok(output.every((line) => line.includes('Usage:')));
});

test('bootstrap propagates command failures and removes its neutral directory', () => {
  let cwd;
  let message = '';
  const status = npxMain(['--version'], { platform: 'linux', stderr: (text) => { message += text; },
    spawn(exe, args, options) { cwd = options.cwd; throw new Error('spawn failed'); } });
  assert.equal(status, 1);
  assert.match(message, /spawn failed/);
  assert.equal(existsSync(cwd), false);
  assert.equal(npxMain(['install'], { spawn: () => ({ status: 7 }) }), 7);
});

test('bootstrap entry point handles help and invalid arguments without a toolchain', () => {
  const script = fileURLToPath(new URL('../skills/uat/scripts/npx.mjs', import.meta.url));
  const env = { ...process.env, PATH: '' };
  const help = spawnSync(process.execPath, [script, '--help'], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage:/);
  const invalid = spawnSync(process.execPath, [script, '--version;unexpected'], { env, encoding: 'utf8', timeout: 5000 });
  assert.equal(invalid.status, 2, invalid.stderr);
  assert.match(invalid.stderr, /Usage:/);
});

test('only an empty Windows daemon working directory may outlive a call', () => {
  for (const platform of ['win32', 'linux']) {
    for (const filesRemain of [false, true]) {
      for (const code of ['EPERM', 'EBUSY', 'EACCES']) {
        let cwd;
        try {
          const invoke = () => withNpxDirectory((dir) => { cwd = dir; return 42; }, {
            platform,
            remove(dir) {
              if (dir !== cwd && !filesRemain) {
                rmSync(dir, { recursive: true, force: true });
                return;
              }
              throw Object.assign(new Error('locked directory'), { code });
            },
          });
          if (platform === 'win32' && !filesRemain && ['EPERM', 'EBUSY'].includes(code)) {
            assert.equal(invoke(), 42);
            assert.equal(existsSync(join(cwd, 'package.json')), false);
          } else {
            assert.throws(invoke, { code });
          }
        } finally {
          if (cwd) rmSync(cwd, { recursive: true, force: true });
        }
      }
    }
  }
});

test('healthy setup needs only agent-browser and reports versions without raw CLI output', () => {
  const calls = [];
  const result = checkSetup({ run(command, args) {
    calls.push([command, ...args]);
    assert.equal(command, 'agent-browser');
    return available('tool 1.2.3\nsensitive output=private');
  } });
  assert.equal(result.ready, true);
  assert.equal(result.tools.agentBrowser.version, '1.2.3');
  assert.equal(result.tools.agentBrowser.launcher, 'agent-browser');
  assert.equal(result.runRoot, join(homedir(), '.uat', 'runs'));
  assert.doesNotMatch(JSON.stringify(result), /sensitive|private/);
  assert.deepEqual(calls, [
    ['agent-browser', '--version'],
    ['agent-browser', 'skills', 'get', 'core'],
  ]);
});

test('missing tools identify setup work without attempting auth or browser launch', () => {
  const calls = [];
  const result = checkSetup({ nodeVersion: '24.0.0', env: {}, run(command, args) {
    calls.push([command, ...args]);
    return missing();
  } });
  assert.equal(result.ready, false);
  assert.equal(result.tools.agentBrowser.state, 'missing');
  assert.equal(result.actions.length, 2);
  assert.deepEqual(calls, [
    ['agent-browser', '--version'], ['npx', ...npxPrefix, '--version'], ['npm', '--version'],
  ]);
});

test('a cached npx CLI is ready and uses the same offline launcher for core guidance', () => {
  const calls = [];
  const result = checkSetup({ env: {}, run(command, args) {
    calls.push([command, ...args]);
    return command === 'agent-browser' ? missing() : available('agent-browser 2.3.4\n');
  } });
  assert.equal(result.ready, true);
  assert.deepEqual(result.tools.agentBrowser, { state: 'available', version: '2.3.4', launcher: 'npx' });
  assert.equal(result.tools.coreInstructions.state, 'available');
  assert.equal(result.tools.npm.state, 'not-needed');
  assert.deepEqual(calls, [
    ['agent-browser', '--version'],
    ['npx', ...npxPrefix, '--version'],
    ['npx', ...npxPrefix, 'skills', 'get', 'core'],
  ]);
});

test('offline cache misses and refused installations stay missing without installing', () => {
  for (const failure of [
    { status: 1, stderr: 'npm error code ENOTCACHED' },
    { status: 1, stderr: 'npm error code ECANCELED' },
    { status: 1, stderr: 'npx canceled due to missing packages and no YES option' },
    { status: 127, stderr: 'sh: line 1: agent-browser: command not found' },
  ]) {
    const calls = [];
    const result = checkSetup({ env: {}, nodeVersion: '24.0.0', run(command, args) {
      calls.push([command, ...args]);
      if (command === 'agent-browser') return missing();
      if (command === 'npx') return failure;
      return available();
    } });
    assert.equal(result.ready, false);
    assert.equal(result.tools.agentBrowser.state, 'missing');
    assert.equal(result.tools.coreInstructions.state, 'not-checked');
    assert.match(result.actions.join(' '), /prime the npx cache/);
    assert.deepEqual(calls, [
      ['agent-browser', '--version'], ['npx', ...npxPrefix, '--version'], ['npm', '--version'],
    ]);
  }
});

test('a broken npx launcher is unavailable, not a request to install', () => {
  for (const failure of [{ status: 1, stderr: 'broken executable' }, { status: null, error: { code: 'EACCES' } }]) {
    const calls = [];
    const result = checkSetup({ env: {}, run(command, args) {
      calls.push([command, ...args]);
      return command === 'agent-browser' ? missing() : failure;
    } });
    assert.equal(result.ready, false);
    assert.deepEqual(result.tools.agentBrowser, { state: 'unavailable', launcher: 'npx' });
    assert.equal(result.tools.npm.state, 'not-needed');
    assert.match(result.actions.join(' '), /Inspect the npx execution failure/);
    assert.doesNotMatch(result.actions.join(' '), /Install agent-browser/);
    assert.deepEqual(calls, [['agent-browser', '--version'], ['npx', ...npxPrefix, '--version']]);
  }
});

test('an npx CLI without core guidance remains usable', () => {
  const result = checkSetup({ env: {}, run(command, args) {
    if (command === 'agent-browser') return missing();
    return args.at(-1) === '--version' ? available() : { status: 1 };
  } });
  assert.equal(result.ready, true);
  assert.equal(result.tools.agentBrowser.launcher, 'npx');
  assert.equal(result.tools.coreInstructions.state, 'unavailable');
  assert.match(result.actions.join(' '), /installed browser help/);
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
    ['where.exe', 'agent-browser'], ['where.exe', 'npx'], ['where.exe', 'npm'],
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

test('Windows invokes only fixed offline npx probes through cmd', () => {
  for (const suffix of [['--version'], ['skills', 'get', 'core']]) {
    const calls = [];
    const result = runCommand('npx', [...npxPrefix, ...suffix], {
      platform: 'win32',
      spawn(exe, args, options) {
        calls.push({ exe, args, options });
        return available();
      },
    });
    assert.equal(result.status, 0);
    assert.deepEqual(calls[0].args, ['npx']);
    assert.deepEqual(calls[1].args, ['/d', '/s', '/c', `"npx ${[...npxPrefix, ...suffix].join(' ')}"`]);
    assert.equal(calls[1].options.windowsVerbatimArguments, true);
    assert.equal(calls[1].options.shell, undefined);
    assert.ok(calls[0].options.cwd);
    assert.equal(calls[1].options.cwd, calls[0].options.cwd);
    assert.notEqual(calls[0].options.cwd, process.cwd());
    assert.equal(existsSync(calls[0].options.cwd), false);
  }
});

test('POSIX npx probes run in a private neutral package and remove it afterwards', () => {
  for (const suffix of [['--version'], ['skills', 'get', 'core']]) {
    let cwd;
    const result = runCommand('npx', [...npxPrefix, ...suffix], {
      platform: 'linux',
      spawn(exe, args, options) {
        cwd = options.cwd;
        assert.notEqual(cwd, process.cwd());
        assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')), {
          name: 'uat-browser-runtime', private: true,
        });
        assert.equal(exe, 'npx');
        assert.deepEqual(args, [...npxPrefix, ...suffix]);
        return available();
      },
    });
    assert.equal(result.status, 0);
    assert.equal(existsSync(cwd), false);
  }
});

test('macOS and Linux/WSL probes use executable resolution without a shell', () => {
  for (const platform of ['darwin', 'linux']) {
    runCommand('agent-browser', ['--version'], { platform, spawn(exe, args, options) {
      assert.equal(exe, 'agent-browser');
      assert.deepEqual(args, ['--version']);
      assert.equal(options.shell, undefined);
      assert.equal(options.cwd, undefined);
      return available();
    } });
  }
});

test('offline npx probes neither execute a project bin nor install its package', {
  skip: process.platform === 'win32' ? 'POSIX npm process fixture; Windows uses the same fixed probe' : false,
}, (t) => {
  const found = spawnSync('which', ['npx'], { encoding: 'utf8' });
  if (found.status !== 0) return t.skip('npm/npx is not installed');
  const root = mkdtempSync(join(tmpdir(), 'uat-npx-no-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, 'node'));
  symlinkSync(found.stdout.trim(), join(bin, 'npx'));
  const marker = join(root, 'local-bin-ran');
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toLowerCase().startsWith('npm_config_')));
  Object.assign(env, {
    HOME: root,
    PATH: `${bin}:/usr/bin:/bin`,
    UAT_PROBE_MARKER: marker,
    npm_config_cache: join(root, 'cache'),
    npm_config_prefix: join(root, 'prefix'),
    npm_config_update_notifier: 'false',
  });
  const malicious = '#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.UAT_PROBE_MARKER, "ran");\nconsole.log("agent-browser 0.41.1");\n';
  for (const name of ['example', 'agent-browser']) {
    const project = join(root, name);
    const localPackage = join(project, 'node_modules', 'agent-browser');
    const localBin = join(project, 'node_modules', '.bin');
    mkdirSync(localPackage, { recursive: true });
    mkdirSync(localBin);
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name, version: '0.41.1', bin: { 'agent-browser': './cli.cjs' } }));
    writeFileSync(join(project, 'cli.cjs'), malicious, { mode: 0o755 });
    writeFileSync(join(localPackage, 'package.json'), JSON.stringify({ name: 'agent-browser', version: '0.41.1', bin: { 'agent-browser': './cli.cjs' } }));
    writeFileSync(join(localPackage, 'cli.cjs'), malicious, { mode: 0o755 });
    symlinkSync('../agent-browser/cli.cjs', join(localBin, 'agent-browser'));
    for (const suffix of [['--version'], ['skills', 'get', 'core']]) {
      const result = runCommand('npx', [...npxPrefix, ...suffix], {
        // Simulate calling from the project unless runCommand supplies a safe cwd.
        spawn: (exe, args, options) => spawnSync(exe, args, { ...options, cwd: options.cwd ?? project, env }),
      });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /ENOTCACHED|ECANCELED|npx canceled due to missing packages/i);
      assert.equal(existsSync(marker), false, `${name} executed its local bin`);
      assert.equal(existsSync(join(root, 'cache', '_npx')), false, `${name} was installed into the npx cache`);
    }
  }
});

test('unrecognized probes cannot carry page/ticket text into a shell', () => {
  for (const [command, args] of [
    ['agent-browser', ['--version', '&', 'something']],
    ['npx', [...npxPrefix, '--version', '&', 'something']],
  ]) {
    assert.throws(() => runCommand(command, args, {
      platform: 'win32', spawn() { assert.fail('must not spawn'); },
    }), /Unsupported setup probe/);
  }
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
    return command === 'npm' ? available() : missing();
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
