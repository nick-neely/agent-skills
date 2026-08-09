#!/usr/bin/env node
// worktree.mjs <open|list|close> [--no-install | --link-modules] [issue#...]
// Lane lifecycle for the parallel path: one git worktree + `ship/issue-<n>`
// branch per issue, in a sibling `<repo>-worktrees/` dir. On `open`, each lane is
// seeded so it can actually run: gitignored env files (`.env*`) are copied from
// the main checkout, then dependencies are made available. Deps modes:
//   default          install with the detected package manager (correct, isolated)
//   --link-modules   hardlink every node_modules tree from main (fast; falls back
//                    to install if main has none; re-install if a lane changes deps)
//   --no-install     do nothing; each builder installs as its first step
import { run, capture, die } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const noInstall = argv.includes('--no-install');
const linkMode = argv.includes('--link-modules');
const flags = new Set(['--no-install', '--link-modules']);
const [cmd, ...rest] = argv.filter(a => !flags.has(a));

const root = run('git rev-parse --show-toplevel', { allowFail: true });
if (!root) die('not inside a git repository');

const wtBase = path.join(path.dirname(root), `${path.basename(root)}-worktrees`);
const clean = n => String(n).replace(/^#/, '');
const branchOf = n => `ship/issue-${n}`;
const dirOf = n => path.join(wtBase, `issue-${n}`);

// Copy gitignored env files (.env, .env.local, apps/*/.env, …) into the lane.
// Worktrees only check out tracked files, so these local-only files are missing
// and the app/tests can't run without them.
function copyEnvFiles(dir) {
  const listed = run('git ls-files --others --ignored --exclude-standard', { allowFail: true, cwd: root }) || '';
  const envRe = /(^|\/)\.env(\.[^/]+)?$/;
  const skipRe = /\.(example|sample|template|dist)$/;
  const copied = [];
  for (const rel of listed.split('\n').filter(Boolean)) {
    if (!envRe.test(rel) || skipRe.test(rel)) continue;
    try {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.copyFileSync(path.join(root, rel), path.join(dir, rel));
      copied.push(rel);
    } catch { /* skip unreadable */ }
  }
  return copied;
}

// Hardlink every node_modules tree (root + workspace packages) from the main
// checkout into the lane. Fast and low-space; safe because tools rewrite files
// (breaking the hardlink) rather than mutating shared inodes in place.
function linkFromMain(dir) {
  const found = capture(`find ${JSON.stringify(root)} -type d -name node_modules -prune`).out;
  const trees = found.split('\n').map(s => s.trim()).filter(Boolean);
  let linked = 0;
  for (const src of trees) {
    const dst = path.join(dir, path.relative(root, src));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    let r = capture(`cp -al ${JSON.stringify(src)} ${JSON.stringify(dst)}`); // hardlink
    if (r.code !== 0) r = capture(`cp -a ${JSON.stringify(src)} ${JSON.stringify(dst)}`); // fallback: full copy
    if (r.code === 0) linked++;
  }
  return { ok: linked > 0, linked };
}

function detectInstall() {
  const has = f => fs.existsSync(path.join(root, f));
  if (!has('package.json')) return null; // not a JS project - nothing to install
  if (has('pnpm-lock.yaml')) return { pm: 'pnpm', cmd: 'pnpm install' };
  if (has('yarn.lock')) return { pm: 'yarn', cmd: 'yarn install' };
  if (has('bun.lockb') || has('bun.lock')) return { pm: 'bun', cmd: 'bun install' };
  return { pm: 'npm', cmd: 'npm install' };
}

function seed(dir) {
  const env = copyEnvFiles(dir);
  console.log(`   env: copied ${env.length}${env.length ? ' (' + env.join(', ') + ')' : ''}`);
  if (noInstall) { console.log('   deps: skipped (--no-install)'); return; }
  if (linkMode) {
    const res = linkFromMain(dir);
    if (res.ok) {
      console.log(`   deps: hardlinked ${res.linked} node_modules tree(s) from main (re-install if this lane changes deps)`);
      return;
    }
    console.log('   deps: no node_modules in main to link - installing instead');
  }
  const inst = detectInstall();
  if (!inst) { console.log('   deps: no package.json - nothing to install'); return; }
  console.log(`   deps: ${inst.cmd} … (may take a while)`);
  const r = capture(inst.cmd, { cwd: dir });
  if (r.code === 0) {
    console.log(`   deps: installed (${inst.pm})`);
  } else {
    console.log(`   deps: ${inst.pm} install failed (exit ${r.code}) - finish it manually in ${dir}`);
    if (r.stderr) console.log(r.stderr.split('\n').slice(-8).map(l => '     ' + l).join('\n'));
  }
}

if (cmd === 'open') {
  if (!rest.length) die('usage: worktree.mjs open [--no-install | --link-modules] <issue#> [<issue#>...]');
  const base = run('git rev-parse --abbrev-ref HEAD');
  const existing = run('git worktree list --porcelain', { allowFail: true }) || '';
  for (const raw of rest) {
    const n = clean(raw), br = branchOf(n), dir = dirOf(n);
    if (existing.includes(dir)) { console.log(`#${n}: already open at ${dir} (${br})`); continue; }
    const hasBranch = run(`git rev-parse --verify --quiet ${br}`, { allowFail: true });
    run(hasBranch
      ? `git worktree add ${JSON.stringify(dir)} ${br}`
      : `git worktree add -b ${br} ${JSON.stringify(dir)} ${base}`);
    console.log(`#${n}: ${dir}  (branch ${br} off ${base})`);
    seed(dir);
  }
} else if (cmd === 'list') {
  console.log(run('git worktree list'));
} else if (cmd === 'close') {
  if (!rest.length) die('usage: worktree.mjs close <issue#> [<issue#>...]');
  for (const raw of rest) {
    const n = clean(raw), dir = dirOf(n);
    const res = run(`git worktree remove ${JSON.stringify(dir)}`, { allowFail: true });
    console.log(res === null
      ? `#${n}: no worktree at ${dir}, or it has uncommitted changes (remove manually with --force)`
      : `#${n}: removed ${dir}`);
  }
} else {
  die('usage: worktree.mjs <open|list|close> [--no-install | --link-modules] [issue#...]');
}
