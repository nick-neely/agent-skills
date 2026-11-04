import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  realpathSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, sanitizeLabel, sanitizeProject, skillHash, targetKey } from '../skills/uat/scripts/new-run.mjs';

const script = fileURLToPath(new URL('../skills/uat/scripts/new-run.mjs', import.meta.url));
const skillDir = fileURLToPath(new URL('../skills/uat/', import.meta.url));
const posixOnly = process.platform === 'win32' ? 'POSIX symlink/mode fixture' : false;

// Temp fake home; nothing is written outside it unless a test passes --output.
function setup(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'uat-new-run-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, 'home');
  mkdirSync(home);
  let counter = 0;
  const run = (args, overrides = {}) => {
    let output = '';
    const code = main(args, {
      home,
      env: {},
      now: () => new Date(2026, 10, 3, 14, 30, 0),
      random: () => (counter++).toString(16).padStart(6, 'a'),
      icacls: () => ({ status: 0 }),
      write: (text) => { output += text; },
      ...overrides,
    });
    return { code, json: JSON.parse(output), output };
  };
  return { root, home, run };
}

const fresh = (...extra) => ['--label', 'PRT-1', '--mode', 'fresh', ...extra];

test('runs default to the general project under the home run root', (t) => {
  const { home, run } = setup(t);
  const { code, json } = run(fresh());
  assert.equal(code, 0);
  assert.equal(json.evidenceLocation, 'home');
  assert.equal(json.project, 'general');
  assert.equal(dirname(json.runDir), join(home, '.uat', 'runs', 'general'));
  assert.equal(run(fresh('--project', ' / ')).json.project, 'general');
  if (process.platform !== 'win32') {
    for (const dir of [join(home, '.uat'), join(home, '.uat', 'runs'), dirname(json.runDir), json.runDir]) {
      assert.equal(statSync(dir).mode & 0o777, 0o700, dir);
    }
  }
});

test('projects are sanitized into a single safe path segment', (t) => {
  const { home, run } = setup(t);
  const { code, json } = run(fresh('--project', 'My Repo/../x'));
  assert.equal(code, 0);
  assert.equal(json.project, 'my-repo-x');
  assert.equal(dirname(json.runDir), join(home, '.uat', 'runs', 'my-repo-x'));
  assert.deepEqual(readdirSync(join(home, '.uat', 'runs')), ['my-repo-x']);
  assert.equal(sanitizeProject(), 'general');
  assert.equal(sanitizeProject('..'), 'general');
  assert.equal(sanitizeProject('Web_App.v2'), 'web-app-v2');
  assert.equal(sanitizeProject('CON'), 'project-con');
  assert.equal(sanitizeProject('lpt1'), 'project-lpt1');
  assert.equal(sanitizeProject('console'), 'console');
  assert.equal(sanitizeProject(`${'a'.repeat(39)}-${'b'.repeat(10)}`), 'a'.repeat(39));
});

test('two projects keep their runs in separate folders', (t) => {
  const { home, run } = setup(t);
  const alpha = run(fresh('--project', 'alpha')).json;
  const beta = run(fresh('--project', 'beta')).json;
  const again = run(fresh('--project', 'alpha')).json;
  assert.equal(dirname(alpha.runDir), join(home, '.uat', 'runs', 'alpha'));
  assert.equal(dirname(beta.runDir), join(home, '.uat', 'runs', 'beta'));
  assert.equal(dirname(again.runDir), dirname(alpha.runDir));
  assert.deepEqual(readdirSync(join(home, '.uat', 'runs')).sort(), ['alpha', 'beta']);
  assert.deepEqual(readdirSync(join(home, '.uat', 'runs', 'alpha')).sort(), [alpha.runId, again.runId].sort());
});

test('a symlinked home run root needs an operator decision', { skip: posixOnly }, (t) => {
  const { root, home, run } = setup(t);
  const elsewhere = join(root, 'elsewhere');
  mkdirSync(elsewhere);
  symlinkSync(elsewhere, join(home, '.uat'));
  const { code, json } = run(fresh());
  assert.equal(code, 1);
  assert.match(json.decision, /symlink/);
  assert.deepEqual(readdirSync(elsewhere), []);
});

test('a symlinked project folder needs a decision and writes nothing', { skip: posixOnly }, (t) => {
  const { root, home, run } = setup(t);
  const elsewhere = join(root, 'elsewhere');
  mkdirSync(elsewhere);
  const runs = join(home, '.uat', 'runs');
  mkdirSync(runs, { recursive: true });
  symlinkSync(elsewhere, join(runs, 'my-app'));
  const { code, json } = run(fresh('--project', 'my-app'));
  assert.equal(code, 1);
  assert.match(json.decision, /~\/\.uat\/runs\/my-app is a symlink/);
  assert.deepEqual(readdirSync(elsewhere), []);
  assert.deepEqual(readdirSync(runs), ['my-app']);
});

test('a project path that is a file needs a decision', (t) => {
  const { home, run } = setup(t);
  const runs = join(home, '.uat', 'runs');
  mkdirSync(runs, { recursive: true });
  writeFileSync(join(runs, 'general'), 'not a directory');
  const { code, json } = run(fresh());
  assert.equal(code, 1);
  assert.match(json.decision, /non-directory/);
  assert.equal(readFileSync(join(runs, 'general'), 'utf8'), 'not a directory');
});

test('--output is used as given, with no project folder and no git checks', (t) => {
  const { root, home, run } = setup(t);
  const app = join(root, 'app');
  mkdirSync(app);
  assert.equal(spawnSync('git', ['init', '-q', app], { encoding: 'utf8' }).status, 0);
  const output = join(app, 'evidence', 'nested');
  const { code, json } = run(fresh('--output', output, '--project', 'ignored'));
  assert.equal(code, 0, JSON.stringify(json));
  assert.equal(json.evidenceLocation, 'override');
  assert.equal(json.project, null);
  assert.equal(dirname(json.runDir), output);
  assert.deepEqual(readdirSync(app).sort(), ['.git', 'evidence']);
  assert.equal(existsSync(join(home, '.uat')), false);
});

test('labels are sanitized into a single safe path segment', (t) => {
  const { home, run } = setup(t);
  const { json } = run(['--label', '../PRT 123/..', '--mode', 'fresh']);
  assert.match(json.runId, /^2026-11-03T143000-prt-123-[0-9a-f]{6}$/);
  assert.equal(dirname(json.runDir), join(home, '.uat', 'runs', 'general'));
  assert.equal(sanitizeLabel('!!!'), 'uat');
  assert.equal(sanitizeLabel('CON'), 'con');
  assert.equal(sanitizeLabel(`${'a'.repeat(39)}-${'b'.repeat(10)}`), 'a'.repeat(39));
});

test('an existing run directory is never reused or overwritten', (t) => {
  const { run } = setup(t);
  const suffixes = ['abc123', 'abc123', 'def456'];
  const random = () => suffixes.shift();
  const first = run(fresh(), { random });
  writeFileSync(join(first.json.runDir, 'evidence.txt'), 'keep');
  const second = run(fresh(), { random });
  assert.equal(second.code, 0);
  assert.notEqual(second.json.runDir, first.json.runDir);
  assert.match(second.json.runId, /-def456$/);
  assert.equal(readFileSync(join(first.json.runDir, 'evidence.txt'), 'utf8'), 'keep');
});

test('report is prefilled from the template and fresh config is headed', (t) => {
  const { run } = setup(t);
  const { json } = run(fresh());
  assert.equal(json.reportPath, join(json.runDir, 'report.md'));
  const report = readFileSync(json.reportPath, 'utf8').replace(/\r\n/g, '\n');
  assert.doesNotMatch(report, /\{\{/);
  assert.match(report, new RegExp(`- Run ID: ${json.runId}\n`));
  assert.match(report, new RegExp(`- Skill version: ${json.skillVersion}\n`));
  assert.match(report, /- Started: 2026-11-03 14:30( \([^)]+\))?; ended:\n/);
  assert.ok(report.includes(`- Evidence location: ~/.uat/runs/general/${json.runId}/\n`));
  assert.match(report, new RegExp(`- Browser: fresh, session ${json.session}; desktop viewport:`));
  assert.equal(json.mode, 'fresh');
  assert.equal(json.headed, true);
  assert.equal(json.profile, null);
  assert.equal(json.configPath, join(json.runDir, 'browser-config.json'));
  assert.deepEqual(JSON.parse(readFileSync(json.configPath, 'utf8')), { headed: true, autoConnect: false });
  assert.equal(json.session, `uat-${json.runId.slice(-6)}`);
  assert.equal(run(fresh('--headless')).json.headed, false);
});

test('persistent mode creates a private marked profile and runs headed', (t) => {
  const { home, run } = setup(t);
  const { code, json } = run(['--label', 'x', '--mode', 'persistent', '--target', 'https://localhost:4200/x?y']);
  assert.equal(code, 0);
  const key = targetKey('https://localhost:4200');
  const path = join(home, '.uat', 'profiles', key);
  assert.deepEqual(json.profile, {
    path, relative: `~/.uat/profiles/${key}`, state: 'created', inUse: false,
    acl: process.platform === 'win32' ? 'applied' : 'posix-mode',
  });
  assert.equal(json.headed, true);
  assert.deepEqual(JSON.parse(readFileSync(json.configPath, 'utf8')),
    { headed: true, autoConnect: false, profile: path, idleTimeout: '0' });
  assert.equal(json.session, `uat-${key.slice(-16)}`);
  const marker = JSON.parse(readFileSync(join(path, '.uat-profile'), 'utf8'));
  assert.deepEqual(Object.keys(marker), ['createdBy', 'createdAt', 'target']);
  assert.equal(marker.target, key);
  if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o700);
});

test('persistent mode reuses a marked profile headed with the same keep-alive session', (t) => {
  const { run } = setup(t);
  const args = ['--label', 'x', '--mode', 'persistent', '--target', 'https://devone.example.com'];
  const first = run(args);
  const reused = run(args);
  assert.equal(reused.json.profile.state, 'existing');
  assert.equal(reused.json.profile.acl, 'not-changed');
  assert.equal(reused.json.headed, true);
  assert.equal(reused.json.session, first.json.session);
  assert.equal(reused.json.session, `uat-${targetKey('https://devone.example.com').slice(-16)}`);
  assert.equal(JSON.parse(readFileSync(reused.json.configPath, 'utf8')).idleTimeout, '0');
  assert.equal(run([...args, '--headless']).json.headed, false);
});

test('an unmarked existing profile is unverified and left untouched', (t) => {
  const { home, run } = setup(t);
  const path = join(home, '.uat', 'profiles', targetKey('https://devone.example.com', 'Admin'));
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'Local State'), '{}');
  if (process.platform !== 'win32') symlinkSync('host-123', join(path, 'SingletonLock'));
  const { code, json } = run(['--label', 'x', '--mode', 'persistent',
    '--target', 'https://devone.example.com/app', '--role', 'Admin']);
  assert.equal(code, 0);
  assert.equal(json.profile.state, 'unverified');
  assert.equal(json.profile.path, path);
  assert.equal(json.profile.inUse, process.platform !== 'win32');
  assert.equal(json.headed, true);
  assert.deepEqual(readdirSync(path).sort(), process.platform === 'win32' ? ['Local State'] : ['Local State', 'SingletonLock']);
});

test('a symlinked profile directory needs a decision and writes nothing', { skip: posixOnly }, (t) => {
  const { root, home, run } = setup(t);
  const elsewhere = join(root, 'real-chrome-profile');
  mkdirSync(elsewhere);
  mkdirSync(join(home, '.uat', 'profiles'), { recursive: true });
  symlinkSync(elsewhere, join(home, '.uat', 'profiles', targetKey('http://localhost:4200')));
  const { code, json } = run(['--label', 'x', '--mode', 'persistent', '--target', 'http://localhost:4200']);
  assert.equal(code, 1);
  assert.match(json.decision, /symlink/);
  assert.deepEqual(readdirSync(elsewhere), []);
  assert.equal(existsSync(join(home, '.uat', 'runs')), false);
});

test('Windows profile creation restricts the ACL and reports icacls failure', (t) => {
  const { home, run } = setup(t);
  const calls = [];
  const args = (target) => ['--label', 'x', '--mode', 'persistent', '--target', target];
  const applied = run(args('http://localhost:3000'), {
    platform: 'win32', env: { USERNAME: 'Test User' },
    icacls: (argv) => { calls.push(argv); return { status: 0 }; },
  });
  assert.equal(applied.json.profile.acl, 'applied');
  assert.deepEqual(calls, [[join(home, '.uat', 'profiles', targetKey('http://localhost:3000')),
    '/inheritance:r', '/grant:r', 'Test User:(OI)(CI)F']]);
  const failed = run(args('http://localhost:3001'), {
    platform: 'win32', env: { USERNAME: 'Test User' }, icacls: () => ({ status: 5 }),
  });
  assert.equal(failed.code, 1);
  assert.match(failed.json.decision, /could not restrict.*permissions/);
  const failedPath = join(home, '.uat', 'profiles', targetKey('http://localhost:3001'));
  assert.equal(existsSync(join(failedPath, '.uat-profile')), false);
  const retry = run(args('http://localhost:3001'));
  assert.equal(retry.json.profile.state, 'unverified');
  assert.equal(retry.json.headed, true);
});

test('run.json records the printed result with creation time and skill version', (t) => {
  const { run } = setup(t);
  const { json } = run(fresh());
  assert.deepEqual(Object.keys(json), [
    'runId', 'createdAt', 'skillVersion', 'runDir', 'reportPath', 'configPath',
    'evidenceLocation', 'project', 'mode', 'session', 'headed', 'profile', 'envOverrides',
  ]);
  assert.equal(json.createdAt, new Date(2026, 10, 3, 14, 30, 0).toISOString());
  assert.equal(json.skillVersion, skillHash(skillDir).slice(0, 12));
  assert.match(json.skillVersion, /^[0-9a-f]{12}$/);
  assert.deepEqual(JSON.parse(readFileSync(join(json.runDir, 'run.json'), 'utf8')), json);
});

test('report evidence and browser lines describe the chosen location and profile', (t) => {
  const { root, run } = setup(t);
  const report = (json) => readFileSync(json.reportPath, 'utf8').replace(/\r\n/g, '\n');
  const home = run(fresh('--project', 'Shop Web')).json;
  assert.ok(report(home).includes(`- Evidence location: ~/.uat/runs/shop-web/${home.runId}/\n`));
  // `$&` would be a replacement pattern if values were passed as strings.
  const override = run(fresh('--output', join(root, 'out $& here'))).json;
  assert.ok(report(override).includes(`- Evidence location: override ${override.runDir}\n`));
  const persistent = run(['--label', 'x', '--mode', 'persistent', '--target', 'http://localhost:4200']).json;
  assert.ok(report(persistent).includes(`- Browser: persistent, session ${persistent.session}, profile ${persistent.profile.relative} (created); desktop`));
  assert.doesNotMatch(report(persistent), /\{\{/);
});

test('skill hash covers paths and bytes, ignores .DS_Store, and is order independent', (t) => {
  const { root } = setup(t);
  const dir = join(root, 'skill');
  mkdirSync(join(dir, 'b'), { recursive: true });
  writeFileSync(join(dir, 'a.md'), 'one');
  writeFileSync(join(dir, 'b', 'c.md'), 'two');
  const first = skillHash(dir);
  assert.match(first, /^[0-9a-f]{64}$/);
  writeFileSync(join(dir, '.DS_Store'), 'finder');
  writeFileSync(join(dir, 'b', '.DS_Store'), 'finder');
  assert.equal(skillHash(dir), first);
  writeFileSync(join(dir, 'b', 'c.md'), 'tw0');
  assert.notEqual(skillHash(dir), first);
  writeFileSync(join(dir, 'b', 'c.md'), 'two');
  rmSync(join(dir, 'b'), { recursive: true });
  writeFileSync(join(dir, 'bc.md'), 'two');
  assert.notEqual(skillHash(dir), first);
});

test('target keys canonicalize origin and keep a safe readable prefix', () => {
  assert.match(targetKey('https://localhost:4200/x?y'), /^localhost-4200-[a-f0-9]{16}$/);
  assert.match(targetKey('https://devone.example.com'), /^devone\.example\.c-[a-f0-9]{16}$/);
  assert.equal(targetKey('http://LOCALHOST:80/'), targetKey('http://localhost'));
  assert.equal(targetKey('https://app:443/path?query#fragment'), targetKey('https://app'));
  assert.equal(targetKey('https://user:pw@app.example.com:8443/#t'), targetKey('https://app.example.com:8443'));
  assert.match(targetKey('https://app.example.com', 'QA Admin/../x'), /^app\.example\.com-[a-f0-9]{16}$/);
  assert.throws(() => targetKey('not a url'), /absolute URL/);
  assert.throws(() => targetKey('file:///etc/passwd'), /hostname/);
  assert.throws(() => targetKey('https://app.example.com', '..'), /--role/);
  assert.match(targetKey('http://[::1]:3000/'), /^ipv6---1-3000-[a-f0-9]{16}$/);
  assert.match(targetKey('https://con'), /^host-con-[a-f0-9]{16}$/);
  assert.match(targetKey('https://aux.corp:8443'), /^host-aux\.corp-84-[a-f0-9]{16}$/);
});

test('origin and exact role stay distinct when their readable prefixes collide', () => {
  const cases = [
    ['http://app-4200'], ['http://app:4200'],
    ['http://app-admin'], ['http://app', 'admin'],
    ['http://app', 'QA Admin'], ['http://app', 'QA/Admin'],
    ['http://app', 'Admin'], ['https://app'], ['http://app'],
    ['http://app', 'x'.repeat(40) + 'a'], ['http://app', 'x'.repeat(40) + 'b'],
  ];
  const keys = cases.map(([url, role]) => targetKey(url, role));
  assert.equal(new Set(keys).size, cases.length);
  assert.ok(keys.every((key) => key.length <= 33 && /^[a-z0-9.-]+$/.test(key)));
});

test('formerly colliding targets create separate profiles and sessions and reattach only to their own', (t) => {
  const { run } = setup(t);
  const cases = [['http://app-4200'], ['http://app:4200'], ['http://app-admin'],
    ['http://app', 'admin'], ['http://app', 'QA Admin'], ['http://app', 'QA/Admin'],
    ['http://app'], ['https://app']];
  const runs = cases.map(([url, role]) => {
    const args = ['--label', 'isolation', '--mode', 'persistent', '--target', url];
    if (role !== undefined) args.push('--role', role);
    const created = run(args);
    assert.equal(created.code, 0, JSON.stringify(created.json));
    assert.equal(created.json.profile.state, 'created');
    assert.match(created.json.session, /^uat-[a-f0-9]{16}$/);
    const equivalent = new URL('/another-page?query=value#fragment', url);
    if (equivalent.protocol === 'http:' && !equivalent.port) equivalent.port = '80';
    if (equivalent.protocol === 'https:' && !equivalent.port) equivalent.port = '443';
    const reuseArgs = [...args];
    reuseArgs[reuseArgs.indexOf('--target') + 1] = equivalent.href;
    const reused = run(reuseArgs);
    assert.equal(reused.json.profile.state, 'existing');
    assert.equal(reused.json.profile.path, created.json.profile.path);
    assert.equal(reused.json.session, created.json.session);
    return created.json;
  });
  assert.equal(new Set(runs.map((item) => item.profile.path)).size, cases.length);
  assert.equal(new Set(runs.map((item) => item.session)).size, cases.length);
});

test('new identity keys leave legacy ambiguous profiles untouched', (t) => {
  const { home, run } = setup(t);
  const legacy = join(home, '.uat', 'profiles', 'app-4200');
  mkdirSync(legacy, { recursive: true });
  writeFileSync(join(legacy, 'operator-data'), 'keep');
  const created = run(['--label', 'isolation', '--mode', 'persistent', '--target', 'http://app:4200']);
  assert.equal(created.code, 0);
  assert.equal(created.json.profile.state, 'created');
  assert.notEqual(created.json.profile.path, legacy);
  assert.deepEqual(readdirSync(legacy), ['operator-data']);
  assert.equal(readFileSync(join(legacy, 'operator-data'), 'utf8'), 'keep');
});

test('usage errors exit 2 without creating anything', (t) => {
  const { home, run } = setup(t);
  for (const args of [
    [], ['--label', 'x'], ['--label', 'x', '--mode', 'other'],
    ['--label', 'x', '--mode', 'persistent'],
    fresh('--output', 'relative/dir'), fresh('--unknown'), fresh('positional'),
    fresh('--repo', '.'), fresh('--no-ignore-edit'), fresh('--project'),
  ]) {
    const { code, json } = run(args);
    assert.equal(code, 2, JSON.stringify(args));
    assert.ok(json.error && json.usage);
  }
  assert.equal(existsSync(join(home, '.uat')), false);
});

test('output and config report override names but never their values', (t) => {
  const { run } = setup(t);
  const env = {
    AGENT_BROWSER_STATE: '/secret/state-value.json',
    AGENT_BROWSER_CDP_HEADERS: '{"Authorization":"Bearer secret-token"}',
    AGENT_BROWSER_SESSION: '',
  };
  const { json, output } = run(['--label', 'x', '--mode', 'persistent', '--target', 'http://localhost:5173'], { env });
  assert.deepEqual(json.envOverrides, ['AGENT_BROWSER_CDP_HEADERS', 'AGENT_BROWSER_STATE']);
  const config = readFileSync(json.configPath, 'utf8');
  for (const text of [output, config]) assert.doesNotMatch(text, /secret-token|state-value|Bearer/);
});

test('the script runs as a CLI entry point', (t) => {
  const { root } = setup(t);
  const output = join(root, 'cli-out');
  const result = spawnSync(process.execPath, [script, ...fresh('--output', output)], {
    encoding: 'utf8', cwd: root, timeout: 10000,
  });
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(result.stdout);
  assert.equal(dirname(json.runDir), output);
  assert.ok(existsSync(json.reportPath));
});
