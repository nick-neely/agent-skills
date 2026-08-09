import { execSync, spawnSync } from 'node:child_process';

// Run a command and capture its result without throwing on failure. Returns the
// exit code plus stdout (trimmed and raw) and stderr - for commands whose exit
// code IS the signal (e.g. git merge-tree: 0 clean, 1 conflict).
export function capture(cmd, { cwd } = {}) {
  const r = spawnSync('/bin/sh', ['-c', cmd], { encoding: 'utf8', cwd });
  return {
    code: r.status == null ? 1 : r.status,
    out: r.stdout || '',
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

// Run a shell command, return trimmed stdout. On failure: return null if
// allowFail, otherwise print a ship-spec error and exit 1.
export function run(cmd, { allowFail = false, cwd } = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], cwd }).trim();
  } catch (err) {
    if (allowFail) return null;
    const stderr = err.stderr ? String(err.stderr).trim() : '';
    die(`command failed: ${cmd}\n${stderr || err.message}`);
  }
}

export function runJSON(cmd, opts) {
  const out = run(cmd, opts);
  if (out == null) return null;
  try { return JSON.parse(out); } catch { return null; }
}

export function hasCmd(name) {
  return run(`command -v ${name}`, { allowFail: true }) != null;
}

// owner/repo of the target GitHub repo, or null. Honors GH_REPO (works outside a
// checkout), else derives from the current git repo.
export function repoSlug() {
  const env = process.env.GH_REPO;
  if (env && env.includes('/')) return env;
  return run('gh repo view --json nameWithOwner -q .nameWithOwner', { allowFail: true }) || null;
}

export function die(msg) {
  console.error(`ship-spec: ${msg}`);
  process.exit(1);
}
