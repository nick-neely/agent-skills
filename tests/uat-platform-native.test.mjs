import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync,
  rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSetup, runCommand } from '../skills/uat/scripts/check-setup.mjs';
import { main, targetKey } from '../skills/uat/scripts/new-run.mjs';

const windowsOnly = process.platform !== 'win32' ? 'Native Windows integration' : false;
const skillDir = fileURLToPath(new URL('../skills/uat/', import.meta.url));

function fixture(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'uat native paths with spaces ')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'operator home');
  mkdirSync(home);
  let output = '';
  const run = (args, overrides = {}) => {
    output = '';
    const code = main(args, { home, env: process.env, write: (text) => { output += text; }, ...overrides });
    return { code, json: JSON.parse(output) };
  };
  return { root, home, run };
}

test('home and override run folders and reports support paths containing spaces', (t) => {
  const { root, home, run } = fixture(t);
  const result = run(['--label', 'native paths', '--mode', 'fresh', '--project', 'app checkout']);
  assert.equal(result.code, 0, JSON.stringify(result.json));
  assert.equal(result.json.evidenceLocation, 'home');
  assert.equal(dirname(result.json.runDir), join(home, '.uat', 'runs', 'app-checkout'));
  assert.ok(existsSync(result.json.reportPath));
  const output = join(root, 'custom evidence');
  const override = run(['--label', 'native paths', '--mode', 'fresh', '--output', output]);
  assert.equal(override.code, 0, JSON.stringify(override.json));
  assert.equal(dirname(override.json.runDir), output);
  assert.ok(existsSync(override.json.reportPath));
});

test('actual Windows cmd shims are resolved through a PATH directory with spaces', { skip: windowsOnly }, (t) => {
  const { root } = fixture(t);
  const shims = join(root, 'npm global shims');
  mkdirSync(shims);
  writeFileSync(join(shims, 'agent-browser.cmd'), '@echo off\r\necho agent-browser 9.8.7\r\n');
  const env = { ...process.env };
  const pathName = Object.keys(env).find((name) => name.toUpperCase() === 'PATH');
  const originalPath = env[pathName] ?? '';
  for (const name of Object.keys(env)) if (name.toUpperCase() === 'PATH') delete env[name];
  env.Path = `${shims};${originalPath}`;
  const result = checkSetup({ env: {}, run(command, args) {
    return runCommand(command, args, {
      spawn: (exe, argv, options) => spawnSync(exe, argv, { ...options, env }),
    });
  } });
  assert.equal(result.ready, true, JSON.stringify(result));
  assert.equal(result.tools.agentBrowser.version, '9.8.7');
  assert.equal(result.tools.coreInstructions.state, 'available');
});

test('actual Windows PATH lookup distinguishes a missing browser from npm availability', { skip: windowsOnly }, (t) => {
  const { root } = fixture(t);
  const shims = join(root, 'npm only shims');
  mkdirSync(shims);
  writeFileSync(join(shims, 'npm.cmd'), '@echo off\r\necho 10.9.3\r\n');
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PATH'));
  env.Path = `${shims};${join(process.env.SystemRoot, 'System32')}`;
  const result = checkSetup({ env: {}, run(command, args) {
    return runCommand(command, args, { spawn: (exe, argv, options) => spawnSync(exe, argv, { ...options, env }) });
  } });
  assert.equal(result.ready, false);
  assert.equal(result.tools.agentBrowser.state, 'missing');
  assert.equal(result.tools.npm.state, 'available');
});

test('Windows home run root tolerates alternate path casing', { skip: windowsOnly }, (t) => {
  const { home, run } = fixture(t);
  mkdirSync(join(home, '.uat', 'runs', 'general'), { recursive: true });
  const result = run(['--label', 'casing', '--mode', 'fresh'], { home: home.toUpperCase() });
  assert.equal(result.code, 0, JSON.stringify(result.json));
  assert.equal(result.json.evidenceLocation, 'home');
  assert.ok(existsSync(result.json.reportPath));
});

for (const location of ['home', 'project', 'profile']) {
  test(`Windows ${location} junction is refused without writing through it`, { skip: windowsOnly }, (t) => {
    const { root, home, run } = fixture(t);
    const elsewhere = join(root, 'unrelated directory');
    mkdirSync(elsewhere);
    let args = ['--label', 'junction', '--mode', 'fresh'];
    if (location === 'home') {
      symlinkSync(elsewhere, join(home, '.uat'), 'junction');
    } else if (location === 'project') {
      mkdirSync(join(home, '.uat', 'runs'), { recursive: true });
      symlinkSync(elsewhere, join(home, '.uat', 'runs', 'general'), 'junction');
    } else {
      mkdirSync(join(home, '.uat', 'profiles'), { recursive: true });
      symlinkSync(elsewhere, join(home, '.uat', 'profiles', targetKey('http://localhost:4200')), 'junction');
      args = ['--label', 'junction', '--mode', 'persistent', '--target', 'http://localhost:4200'];
    }
    const result = run(args);
    assert.equal(result.code, 1, JSON.stringify(result.json));
    assert.match(result.json.decision, /symlink|junction/);
    assert.deepEqual(readdirSync(elsewhere), []);
  });
}

test('Windows CLI entry points execute through a junction containing spaces', { skip: windowsOnly }, (t) => {
  const { root } = fixture(t);
  const copy = join(root, 'copied package');
  cpSync(skillDir, copy, { recursive: true });
  const linked = join(root, 'installed skill junction');
  symlinkSync(copy, linked, 'junction');
  const setup = spawnSync(process.execPath, [join(linked, 'scripts', 'check-setup.mjs')], { encoding: 'utf8', timeout: 30000 });
  assert.ok([0, 1].includes(setup.status), setup.stderr);
  assert.equal(JSON.parse(setup.stdout).platform, 'win32');
  const run = spawnSync(process.execPath, [join(linked, 'scripts', 'new-run.mjs'),
    '--label', 'cli', '--mode', 'fresh', '--output', join(root, 'run output')], { encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  assert.ok(existsSync(JSON.parse(run.stdout).reportPath));
});

function assertPrivateWindowsAcl(path) {
  const command = `
    $ErrorActionPreference = 'Stop'
    $a = Get-Acl -LiteralPath $env:UAT_ACL_TEST_PATH
    $u = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    @{ protected = $a.AreAccessRulesProtected; current = $u; rules = @($a.Access | ForEach-Object {
      @{ sid = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value;
         inherited = $_.IsInherited; rights = $_.FileSystemRights.ToString();
         type = $_.AccessControlType.ToString(); inheritance = $_.InheritanceFlags.ToString() }
    }) } | ConvertTo-Json -Depth 5 -Compress
  `;
  const acl = spawnSync('pwsh.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8', env: { ...process.env, UAT_ACL_TEST_PATH: path }, timeout: 15000,
  });
  assert.equal(acl.status, 0, acl.stderr);
  const actual = JSON.parse(acl.stdout);
  assert.equal(actual.protected, true, acl.stdout);
  const allowed = actual.rules.filter((rule) => rule.type === 'Allow');
  // Windows may retain explicit OS-privileged grants; ordinary users/groups
  // must not gain access to the private profile.
  const privateSids = new Set([actual.current, 'S-1-5-18', 'S-1-5-32-544']);
  assert.ok(allowed.length > 0, acl.stdout);
  assert.ok(allowed.every((rule) => privateSids.has(rule.sid) && !rule.inherited), acl.stdout);
  assert.ok(allowed.some((rule) => rule.sid === actual.current && rule.rights.includes('FullControl')
    && rule.inheritance.includes('ObjectInherit') && rule.inheritance.includes('ContainerInherit')), acl.stdout);
}

test('real Windows icacls produces a protected profile ACL for the current SID', { skip: windowsOnly }, (t) => {
  const { run } = fixture(t);
  const result = run(['--label', 'permissions', '--mode', 'persistent', '--target', 'http://localhost:45123']);
  assert.equal(result.code, 0, JSON.stringify(result.json));
  assert.equal(result.json.profile.acl, 'applied');
  assertPrivateWindowsAcl(result.json.profile.path);
});

test('real Windows headless run ACL protects auth state even under a custom output folder', { skip: windowsOnly }, (t) => {
  const { root, run } = fixture(t);
  const result = run(['--label', 'headless permissions', '--mode', 'headless', '--output', join(root, 'custom output')]);
  assert.equal(result.code, 0, JSON.stringify(result.json));
  assertPrivateWindowsAcl(result.json.runDir);
  assert.equal(existsSync(result.json.statePath), false);
});

test('a real Windows ACL failure cannot create a trusted reusable profile', { skip: windowsOnly }, (t) => {
  const { run } = fixture(t);
  const args = ['--label', 'permissions', '--mode', 'persistent', '--target', 'http://localhost:45124'];
  const result = run(args, { env: { ...process.env, USERNAME: `uat-missing-${Date.now()}` } });
  assert.equal(result.code, 1, JSON.stringify(result.json));
  const retry = run(args);
  assert.equal(retry.json.profile.state, 'unverified');
  assert.equal(retry.json.headed, true);
  assert.equal(existsSync(join(retry.json.profile.path, '.uat-profile')), false);
});
