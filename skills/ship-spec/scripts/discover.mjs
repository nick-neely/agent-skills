#!/usr/bin/env node
// discover.mjs <spec #>
// Deterministic ENUMERATION only — no judgment. Resolves a spec to every issue it
// tracks (trying all three linkage mechanisms so none are missed) and dumps each
// one's raw title, labels, state, and full body. An `assistant` reads this dump
// and supplies the scope / UI classification / dependency order the script can't.
// Run from inside the project's git checkout (gh needs the repo context).
import { run, runJSON, hasCmd, repoSlug, die } from './lib.mjs';

const spec = (process.argv[2] || '').replace(/^#/, '');
if (!/^\d+$/.test(spec)) die('usage: discover.mjs <spec issue number>');
if (!hasCmd('gh')) die('gh CLI not found on PATH');

const slug = repoSlug();
if (!slug) die('run from inside the project git checkout (gh repo view failed)');

const specIssue = runJSON(`gh issue view ${spec} --json number,title,body,state`);
if (!specIssue) die(`could not read spec #${spec}`);

const candidates = new Map(); // number -> how it was found
const counts = { sub: 0, body: 0, reverse: 0 };

// 1) native GitHub sub-issues
const subs = runJSON(`gh api repos/${slug}/issues/${spec}/sub_issues`, { allowFail: true });
if (Array.isArray(subs)) for (const s of subs) { if (!candidates.has(s.number)) { candidates.set(s.number, 'sub-issue'); counts.sub++; } }

// 2) #refs listed in the spec body (tracking checklist)
for (const m of (specIssue.body || '').matchAll(/#(\d+)/g)) {
  const n = Number(m[1]);
  if (n !== Number(spec) && !candidates.has(n)) { candidates.set(n, 'spec body ref'); counts.body++; }
}

// 3) issues whose body references the spec number (catches `## Parent\n#<spec>`)
const refs = runJSON(
  `gh issue list --state all --search "${spec} in:body" --json number --limit 100`,
  { allowFail: true },
);
if (Array.isArray(refs)) for (const r of refs) {
  if (r.number !== Number(spec) && !candidates.has(r.number)) { candidates.set(r.number, 'reverse body search'); counts.reverse++; }
}

const CAP = 8000; // full bodies, but guard against a runaway
const issues = [];
for (const [n, via] of candidates) {
  const it = runJSON(`gh issue view ${n} --json number,title,state,labels,body`, { allowFail: true });
  if (!it) continue;
  issues.push({
    number: n,
    title: it.title,
    state: it.state,
    labels: (it.labels || []).map(l => l.name),
    via,
    body: (it.body || '').length > CAP ? (it.body.slice(0, CAP) + '\n…[truncated]') : (it.body || ''),
  });
}
issues.sort((a, b) => a.number - b.number);

console.log(`# spec #${spec}: ${specIssue.title}  (${specIssue.state})`);
console.log(`repo: ${slug} · ${issues.length} tracked issue(s)`);
console.log(`linkage found via — sub-issues: ${counts.sub}, spec-body refs: ${counts.body}, reverse search: ${counts.reverse}`);

if (!issues.length) {
  console.log('\nNo tracked issues found automatically. The spec may link its issues in a way none of the');
  console.log('three mechanisms caught — read the spec body and identify the implementation issues manually.');
  process.exit(0);
}

console.log('\n## Index');
console.log('| # | state | labels | title |');
console.log('|---|---|---|---|');
for (const it of issues) {
  console.log(`| ${it.number} | ${it.state} | ${it.labels.join(', ')} | ${it.title.replace(/\|/g, '\\|')} |`);
}

console.log('\n## Full issues (raw — read these to plan)');
for (const it of issues) {
  console.log(`\n### #${it.number} — ${it.title}  [${it.state}${it.labels.length ? ' · ' + it.labels.join(', ') : ''}]  (via ${it.via})`);
  console.log(it.body || '(no body)');
  console.log('\n---');
}
