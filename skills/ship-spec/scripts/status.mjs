#!/usr/bin/env node
// status.mjs <issue#...>
// Deterministic ground-truth for resuming a run: for each planned issue, its
// gh open/closed state, whether a ship/issue-<n> lane branch exists, whether its
// worktree is open and dirty, plus the integration branch head. On resume the
// context is gone - trust this over any remembered "in-flight" note.
import { run, runJSON, die } from './lib.mjs';
import fs from 'node:fs';
import path from 'node:path';

const issues = process.argv.slice(2).map(s => s.replace(/^#/, '')).filter(s => /^\d+$/.test(s));
if (!issues.length) die('usage: status.mjs <issue#> [<issue#>...]');
const root = run('git rev-parse --show-toplevel', { allowFail: true });
if (!root) die('not inside a git repository');
const wtBase = path.join(path.dirname(root), `${path.basename(root)}-worktrees`);

console.log('# ship-spec status');
console.log(`integration: ${run('git rev-parse --abbrev-ref HEAD', { allowFail: true })} @ ${run('git rev-parse --short HEAD', { allowFail: true })}\n`);
console.log('| issue | gh state | lane branch | worktree | dirty |');
console.log('|---|---|---|---|---|');
for (const n of issues) {
  const it = runJSON(`gh issue view ${n} --json state`, { allowFail: true });
  const hasBr = run(`git rev-parse --verify --quiet ship/issue-${n}`, { allowFail: true }) ? 'yes' : '-';
  const dir = path.join(wtBase, `issue-${n}`);
  const open = fs.existsSync(dir);
  const dirty = open ? (run(`git -C ${JSON.stringify(dir)} status --porcelain`, { allowFail: true }) ? 'DIRTY' : 'clean') : '-';
  console.log(`| #${n} | ${it ? it.state : '??'} | ${hasBr} | ${open ? 'open' : '-'} | ${dirty} |`);
}
console.log('\nCLOSED = done. OPEN + lane branch = implemented (check review/merge state).');
console.log('OPEN worktree DIRTY = a builder was cut off mid-implementation - resume that one first.');
