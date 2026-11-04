#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync,
} from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { findEnvOverrides, isEntryPoint } from './check-setup.mjs';

const usage = 'Usage: node new-run.mjs --label <ticket-or-feature> --mode fresh|persistent'
  + ' [--project <name>] [--output <absolute-dir>]'
  + ' [--target <url>] [--role <suffix>] [--headless]';
const markerName = '.uat-profile';
const windowsReserved = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;

// Exit 1: the agent must stop and bring this to the operator.
class Decision extends Error {}
class UsageError extends Error {}

const spawnOptions = { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true };
const runIcacls = (args) => spawnSync('icacls', args, spawnOptions);

export function defaultDeps() {
  return {
    home: homedir(),
    env: process.env,
    platform: process.platform,
    icacls: runIcacls,
    now: () => new Date(),
    random: () => randomBytes(3).toString('hex'),
    skillDir: fileURLToPath(new URL('..', import.meta.url)),
    write: (text) => process.stdout.write(text),
  };
}

// Lowercase [a-z0-9] runs joined by '-', at most 40 characters: no
// separators or traversal survive.
function slug(text) {
  const clean = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return clean.slice(0, 40).replace(/-+$/, '');
}

// Reserved device names are harmless here because the run ID always starts
// with a timestamp.
export const sanitizeLabel = (label) => slug(label) || 'uat';

// The project is a folder name on its own, so Windows device names such as
// con or lpt1 are prefixed.
export function sanitizeProject(project = '') {
  const clean = slug(project) || 'general';
  return windowsReserved.test(clean) ? `project-${clean}` : clean;
}

// Hostname plus non-default port, e.g. localhost-4200 or devone.example.com.
export function targetKey(target, role) {
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new UsageError('--target must be an absolute URL');
  }
  // Keep IPv6 hosts distinct ([::1] -> ipv6---1) instead of collapsing to "1".
  const hostname = url.hostname.startsWith('[')
    ? `ipv6-${url.hostname.slice(1, -1).replace(/:/g, '-')}` : url.hostname;
  const host = url.port ? `${hostname}-${url.port}` : hostname;
  let key = host.toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^[.-]+|[.-]+$/g, '');
  if (!key || key === '.' || key === '..') throw new UsageError('--target has no usable hostname');
  // Windows rejects device names such as con or aux.corp as folder names.
  if (windowsReserved.test(key.split('.')[0])) key = `host-${key}`;
  if (role === undefined) return key;
  const suffix = role.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  if (!suffix) throw new UsageError('--role has no usable characters');
  return `${key}-${suffix}`;
}

// SHA-256 over every file in the skill (except .DS_Store), sorted by
// forward-slash relative path. Each file contributes "<path>\0<size>\0<bytes>".
export function skillHash(skillDir) {
  const files = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.DS_Store') continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else if (entry.isFile()) files.push(rel);
    }
  };
  walk(skillDir, '');
  const hash = createHash('sha256');
  for (const rel of files.sort()) {
    const bytes = readFileSync(join(skillDir, ...rel.split('/')));
    hash.update(`${rel}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest('hex');
}

export function runTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function parseCli(args) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      options: {
        label: { type: 'string' },
        mode: { type: 'string' },
        project: { type: 'string' },
        output: { type: 'string' },
        target: { type: 'string' },
        role: { type: 'string' },
        headless: { type: 'boolean' },
      },
    }));
  } catch (error) {
    throw new UsageError(error.message);
  }
  if (!values.label) throw new UsageError('--label is required');
  if (values.mode !== 'fresh' && values.mode !== 'persistent') throw new UsageError('--mode must be fresh or persistent');
  if (values.output !== undefined && !isAbsolute(values.output)) throw new UsageError('--output must be an absolute path');
  if (values.mode === 'persistent' && !values.target) throw new UsageError('--mode persistent requires --target <url>');
  return {
    label: sanitizeLabel(values.label),
    mode: values.mode,
    project: sanitizeProject(values.project),
    output: values.output === undefined ? undefined : resolve(values.output),
    profileKey: values.mode === 'persistent' ? targetKey(values.target, values.role) : null,
    headless: Boolean(values.headless),
  };
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

// Every existing component of anchor/parts must be a real directory (not a
// symlink or junction) whose realpath stays under realpath(anchor)/parts[0].
function isSafeChain(anchor, parts) {
  const top = join(realpathSync.native(anchor), parts[0]);
  let current = anchor;
  for (const part of parts) {
    current = join(current, part);
    let stat;
    try {
      stat = lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT') return true;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
    if (!isInside(top, realpathSync.native(current))) return false;
  }
  return true;
}

// Runs never go inside the tested repository: ~/.uat/runs/<project>/ by
// default, or an operator-authorized --output directory used as given.
function selectBase(deps, options) {
  if (options.output) return { base: options.output, parts: null, evidenceLocation: 'override', project: null };
  const parts = ['.uat', 'runs', options.project];
  if (!isSafeChain(deps.home, parts)) {
    throw new Decision(`~/.uat, ~/.uat/runs or ~/.uat/runs/${options.project} is a symlink, junction or non-directory; ask the operator where evidence may be written`);
  }
  return { base: join(deps.home, ...parts), parts, evidenceLocation: 'home', project: options.project };
}

// The final directory is created non-recursively, so an existing run is
// never reused or overwritten.
function createRunDir(deps, selection, makeRunId) {
  mkdirSync(selection.base, { recursive: true, mode: 0o700 });
  if (selection.parts && !isSafeChain(deps.home, selection.parts)) {
    throw new Decision('the run directory base became a symlink or junction; ask the operator');
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const runId = makeRunId();
    const runDir = join(selection.base, runId);
    try {
      mkdirSync(runDir, { mode: 0o700 });
      return { runId, runDir };
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('could not create a unique run directory');
}

function inspectProfile(deps, key) {
  if (!isSafeChain(deps.home, ['.uat', 'profiles', key])) {
    throw new Decision('~/.uat, ~/.uat/profiles or the profile directory is a symlink, junction or non-directory; ask the operator before using it');
  }
  const path = join(deps.home, '.uat', 'profiles', key);
  if (!existsSync(path)) return { path, state: 'missing' };
  const marker = lstatSafe(join(path, markerName));
  return { path, state: marker?.isFile() ? 'existing' : 'unverified' };
}

function lstatSafe(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// Chrome leaves SingletonLock (POSIX, a symlink) or lockfile (Windows) while
// running. Informational only; a crash can leave a stale lock.
function profileInUse(path) {
  try {
    return ['SingletonLock', 'lockfile'].some((name) => lstatSafe(join(path, name)) !== null);
  } catch {
    return 'unknown';
  }
}

function restrictWindowsAcl(deps, path) {
  let user = deps.env.USERNAME;
  try {
    user ||= userInfo().username;
  } catch {
    return 'failed';
  }
  if (!user) return 'failed';
  const result = deps.icacls([path, '/inheritance:r', '/grant:r', `${user}:(OI)(CI)F`]);
  return !result.error && result.status === 0 ? 'applied' : 'failed';
}

function createProfile(deps, path, key) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  if (!isSafeChain(deps.home, ['.uat', 'profiles'])) {
    throw new Decision('~/.uat/profiles became a symlink or junction; ask the operator');
  }
  mkdirSync(path, { mode: 0o700 });
  const acl = deps.platform === 'win32' ? restrictWindowsAcl(deps, path) : 'posix-mode';
  if (acl === 'failed') {
    throw new Decision('could not restrict the new profile permissions; the directory is unmarked and must be secured before use');
  }
  const marker = { createdBy: 'uat skill', createdAt: deps.now().toISOString(), target: key };
  writeFileSync(join(path, markerName), `${JSON.stringify(marker)}\n`, { flag: 'wx', mode: 0o600 });
  return acl;
}

// Local wall-clock time plus the IANA zone when known, e.g.
// 2026-11-03 14:01 (America/Chicago).
function startedText(date) {
  const pad = (n) => String(n).padStart(2, '0');
  const text = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + ` ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  let zone;
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    zone = undefined;
  }
  return zone ? `${text} (${zone})` : text;
}

function evidenceText(selection, runId, runDir) {
  if (selection.evidenceLocation === 'override') return `override ${runDir}`;
  return `~/.uat/runs/${selection.project}/${runId}/`;
}

export function newRun(options, deps) {
  const envOverrides = findEnvOverrides(deps.env, deps.platform);
  const makeRunId = () => `${runTimestamp(deps.now())}-${options.label}-${deps.random()}`;
  const started = deps.now();
  const skillVersion = skillHash(deps.skillDir).slice(0, 12);
  // Check the profile before writing anything so a decision leaves no trace.
  const profile = options.profileKey ? inspectProfile(deps, options.profileKey) : null;
  const selection = selectBase(deps, options);
  const { runId, runDir } = createRunDir(deps, selection, makeRunId);

  // Headed by default: the operator signs in through a visible window.
  const headed = !options.headless;
  let profileResult = null;
  let session = `uat-${runId.slice(-6)}`;
  const config = { headed, autoConnect: false };
  if (profile) {
    let acl = 'not-changed';
    let inUse = false;
    if (profile.state === 'missing') {
      acl = createProfile(deps, profile.path, options.profileKey);
      profile.state = 'created';
    } else {
      inUse = profileInUse(profile.path);
    }
    // Keep-alive: one stable session per target that stays running between
    // runs, so session-storage logins (and IdP session cookies) survive.
    session = `uat-${options.profileKey}`;
    Object.assign(config, { profile: profile.path, idleTimeout: '0' });
    profileResult = {
      path: profile.path,
      relative: `~/.uat/profiles/${options.profileKey}`,
      state: profile.state,
      inUse,
      acl,
    };
  }
  const configPath = join(runDir, 'browser-config.json');
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx' });

  const reportPath = join(runDir, 'report.md');
  const fields = {
    run_id: runId,
    skill_version: skillVersion,
    started: startedText(started),
    evidence: evidenceText(selection, runId, runDir),
    browser: profileResult
      ? `${options.mode}, session ${session}, profile ${profileResult.relative} (${profileResult.state})`
      : `${options.mode}, session ${session}`,
  };
  const template = readFileSync(join(deps.skillDir, 'assets', 'report.md'), 'utf8');
  const report = template.replace(/\{\{(run_id|skill_version|started|evidence|browser)\}\}/g, (_, name) => fields[name]);
  writeFileSync(reportPath, report, { flag: 'wx' });

  const result = {
    runId, createdAt: started.toISOString(), skillVersion, runDir, reportPath, configPath,
    evidenceLocation: selection.evidenceLocation,
    project: selection.project,
    mode: options.mode,
    session,
    headed,
    profile: profileResult,
    envOverrides,
  };
  // Written last: browser.mjs reads the config path and session from here.
  writeFileSync(join(runDir, 'run.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  return result;
}

export function main(args = process.argv.slice(2), overrides = {}) {
  const deps = { ...defaultDeps(), ...overrides };
  const print = (value) => deps.write(`${JSON.stringify(value, null, 2)}\n`);
  let options;
  try {
    options = parseCli(args);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    print({ error: error.message, usage });
    return 2;
  }
  try {
    print(newRun(options, deps));
    return 0;
  } catch (error) {
    if (error instanceof Decision) print({ decision: error.message });
    else print({ error: error.message });
    return 1;
  }
}

if (isEntryPoint(process.argv[1], import.meta.url)) {
  process.exitCode = main();
}
