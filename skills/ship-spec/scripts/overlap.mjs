#!/usr/bin/env node
// overlap.mjs [base] [branch...]
// Pre-merge conflict forecast for the parallel lanes. Uses `git merge-tree` for a
// REAL 3-way conflict check between lanes (git >= 2.38) - two lanes touching the
// same file only flag if they actually conflict. Falls back to filename overlap
// on older git. Reports conflict-free lanes and a fewest-conflicts-first order.
// Defaults: base = current branch, branches = all refs/heads/ship/*.
import { run, capture, die } from './lib.mjs';

let [base, ...branches] = process.argv.slice(2);
if (!run('git rev-parse --show-toplevel', { allowFail: true })) die('not inside a git repository');
if (!base) base = run('git rev-parse --abbrev-ref HEAD');
if (!branches.length) {
  const list = run("git for-each-ref --format='%(refname:short)' 'refs/heads/ship/issue-*'", { allowFail: true }) || '';
  branches = list.split('\n').filter(Boolean);
}
if (!branches.length) die('no branches to compare (pass them explicitly, or open ship/issue-* lanes)');

// Per-lane change size (informational).
const files = new Map();
for (const br of branches) {
  const out = run(`git diff --name-only ${base}...${br}`, { allowFail: true });
  files.set(br, out == null ? null : new Set(out.split('\n').filter(Boolean)));
}

console.log(`# Merge forecast vs ${base}`);
for (const br of branches) {
  const s = files.get(br);
  console.log(`- ${br}: ${s ? s.size + ' file(s) changed' : 'cannot diff'}`);
}

if (branches.length < 2) { console.log('\nOne lane only - nothing to compare; merge it directly.'); process.exit(0); }

// Probe merge-tree support: merging a branch with itself is always clean (exit 0);
// old git without --write-tree errors out (exit 128).
const supported = capture(`git merge-tree --write-tree --name-only ${branches[0]} ${branches[0]}`).code !== 128;

const conflicts = []; // { a, b, files: [] }
let realCheck = supported;
if (supported) {
  outer:
  for (let i = 0; i < branches.length; i++) {
    for (let j = i + 1; j < branches.length; j++) {
      const a = branches[i], b = branches[j];
      const r = capture(`git merge-tree --write-tree --name-only ${a} ${b}`);
      if (r.code === 0) continue;              // clean merge
      if (r.code === 1) {                      // conflict - files listed after the tree oid
        const cf = [];
        for (const line of r.out.split('\n').slice(1)) { if (!line.trim()) break; cf.push(line.trim()); }
        conflicts.push({ a, b, files: cf });
      } else { realCheck = false; break outer; } // unrelated histories etc. - fall back
    }
  }
}

if (realCheck) {
  const conflictCount = b => conflicts.filter(c => c.a === b || c.b === b).length;
  if (!conflicts.length) {
    console.log('\nAll lanes merge cleanly against each other (real 3-way check) - merge in any order.');
  } else {
    console.log('\n## Real conflicts (git merge-tree)');
    for (const c of conflicts) console.log(`- ${c.a} ⨯ ${c.b}: ${c.files.join(', ') || '(tree/rename conflict)'}`);
    const clean = branches.filter(b => conflictCount(b) === 0);
    if (clean.length) console.log(`\nConflict-free lanes (merge first, no resolution needed): ${clean.join(', ')}`);
    const order = [...branches].sort((x, y) => conflictCount(x) - conflictCount(y));
    console.log('\n## Suggested merge order (fewest conflicts first)');
    console.log(order.map((b, i) => `${i + 1}. ${b}${conflictCount(b) ? ` (conflicts with ${conflictCount(b)} lane(s))` : ' (clean)'}`).join('\n'));
    console.log('\nRun /resolving-merge-conflicts on the pairs above; you hold the cross-issue context.');
  }
} else {
  // Fallback: filename overlap (coarser - flags same-file edits even when disjoint).
  console.log('\n(merge-tree unavailable - filename-overlap fallback; may over-warn.)');
  const owners = new Map();
  for (const [br, set] of files) if (set) for (const f of set) (owners.get(f) || owners.set(f, []).get(f)).push(br);
  const shared = [...owners.entries()].filter(([, b]) => b.length > 1);
  if (!shared.length) { console.log('No shared files - lanes are disjoint; merge in any order.'); }
  else {
    console.log('## Shared files (possible conflict)');
    for (const [f, b] of shared.sort((a, b) => b[1].length - a[1].length)) console.log(`- ${f} - ${b.join(', ')}`);
    const entangle = br => files.get(br) ? [...files.get(br)].filter(f => (owners.get(f) || []).length > 1).length : 0;
    const order = [...branches].sort((a, b) => entangle(a) - entangle(b));
    console.log('\n## Suggested merge order (least-entangled first)');
    console.log(order.map((b, i) => `${i + 1}. ${b} (${entangle(b)} shared file(s))`).join('\n'));
  }
}
