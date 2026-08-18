#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { argValue, die, output, readJSON, runResult, runText, writeJSONAtomic } from "./lib.mjs";

const states = ["planned", "active", "review", "merge-eligible", "integrated", "qualified", "shipped", "blocked", "failed"];
const transitions = {
  planned: ["active", "blocked", "failed"],
  active: ["review", "blocked", "failed"],
  review: ["active", "merge-eligible", "blocked", "failed"],
  "merge-eligible": ["review", "integrated", "blocked", "failed"],
  integrated: ["qualified", "blocked", "failed"],
  qualified: ["shipped", "blocked", "failed"],
  shipped: [],
  blocked: ["planned", "active", "review", "merge-eligible", "failed"],
  failed: ["planned", "active", "review", "blocked"],
};

const args = process.argv.slice(2);
const command = args[0];
const runDirArg = argValue(args, "--run-dir");
if (!command || !runDirArg) usage();
const runDir = resolve(runDirArg);
const ledgerPath = join(runDir, "run.json");
const dashboardPath = join(runDir, "status.md");

if (command === "init") initialize();
else if (command === "set") setTicket();
else if (command === "evidence") recordEvidence();
else if (command === "profile") recordProfile();
else if (command === "render") renderCommand();
else if (command === "inspect") inspect();
else if (command === "reconcile") reconcile();
else usage();

function initialize() {
  const planPath = argValue(args, "--plan");
  if (!planPath) die("init requires --plan <plan.json>");
  if (existsSync(ledgerPath)) die(`ledger already exists: ${ledgerPath}`);
  const plan = readJSON(resolve(planPath));
  validatePlan(plan);
  mkdirSync(runDir, { recursive: true });
  const now = new Date().toISOString();
  const ledger = {
    version: 1,
    runId: plan.runId || basename(runDir),
    repository: plan.repository || null,
    parentSpec: plan.parentSpec,
    defaultBranch: plan.defaultBranch,
    baselineSha: plan.baselineSha,
    integrationBranch: plan.integrationBranch,
    umbrellaPr: plan.umbrellaPr || null,
    config: plan.config || {},
    nextTransition: plan.nextTransition || "create or reconcile the first frontier lanes",
    approvalActions: plan.approvalActions || [],
    acceptanceCriteria: plan.acceptanceCriteria || [],
    tickets: plan.tickets.map((ticket) => normalizeTicket(ticket)),
    events: [{ at: now, type: "initialized", detail: "program ledger initialized" }],
    createdAt: now,
    updatedAt: now,
  };
  atomicWrite(ledger);
  writeFileSync(dashboardPath, dashboard(ledger));
  output({ ledger: ledgerPath, dashboard: dashboardPath }, true);
}

function recordEvidence() {
  const criterionId = argValue(args, "--criterion");
  const evidence = {
    ticket: argValue(args, "--ticket"),
    pr: argValue(args, "--pr"),
    commit: argValue(args, "--commit"),
    review: argValue(args, "--review"),
    verification: argValue(args, "--verification"),
  };
  if (!criterionId || Object.values(evidence).some((value) => !value)) {
    die("evidence requires --criterion, --ticket, --pr, --commit, --review, and --verification");
  }
  const ledger = readLedger();
  const criterion = ledger.acceptanceCriteria.find((candidate) => String(candidate.id) === String(criterionId));
  if (!criterion) die(`acceptance criterion not found: ${criterionId}`);
  const serialized = new Set((criterion.evidence || []).map((item) => JSON.stringify(item)));
  if (!serialized.has(JSON.stringify(evidence))) criterion.evidence = [...(criterion.evidence || []), evidence];
  const now = new Date().toISOString();
  ledger.updatedAt = now;
  ledger.events.push({ at: now, type: "criterion-evidence", criterion: String(criterionId), evidence });
  atomicWrite(ledger);
  writeFileSync(dashboardPath, dashboard(ledger));
  output({ criterion: String(criterionId), evidence: criterion.evidence }, true);
}

function recordProfile() {
  const id = argValue(args, "--ticket");
  const role = argValue(args, "--role");
  const resolved = {
    model: argValue(args, "--model"),
    reasoning: argValue(args, "--reasoning"),
    quality: argValue(args, "--quality") || "floor",
  };
  const reason = argValue(args, "--reason");
  if (!id || !role || !resolved.model || !resolved.reasoning || !reason) {
    die("profile requires --ticket, --role, --model, --reasoning, and --reason");
  }
  const ledger = readLedger();
  const ticket = ledger.tickets.find((candidate) => String(candidate.id) === String(id));
  if (!ticket) die(`ticket not found: ${id}`);
  const configured = ledger.config?.agents?.[role];
  if (!configured) die(`configured role not found: ${role}`);
  const changed = configured.model !== resolved.model || configured.reasoning !== resolved.reasoning;
  if (changed && resolved.quality !== "escalation") die("a profile override must be recorded as an escalation");
  ticket.assignment = { ...(ticket.assignment || {}), role, profile: { configured, resolved, reason } };
  const now = new Date().toISOString();
  ledger.updatedAt = now;
  ledger.events.push({ at: now, type: "profile-resolved", ticket: String(id), role, configured, resolved, reason });
  atomicWrite(ledger);
  writeFileSync(dashboardPath, dashboard(ledger));
  output({ ticket: String(id), role, configured, resolved, reason }, true);
}

function setTicket() {
  const id = argValue(args, "--ticket");
  const next = argValue(args, "--state");
  if (!id || !next) die("set requires --ticket <id> --state <state>");
  if (!states.includes(next)) die(`unknown ticket state: ${next}`);
  const ledger = readLedger();
  const ticket = ledger.tickets.find((candidate) => String(candidate.id) === String(id));
  if (!ticket) die(`ticket not found: ${id}`);
  if (!transitions[ticket.state]?.includes(next)) die(`invalid transition for ${id}: ${ticket.state} -> ${next}`);
  const previous = ticket.state;
  const patchPath = argValue(args, "--patch");
  const patch = patchPath ? readJSON(resolve(patchPath)) : {};
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) die("ticket patch must be a JSON object");
  for (const immutable of ["id", "blockers", "state"]) {
    if (immutable in patch) die(`ticket patch may not replace ${immutable}`);
  }
  Object.assign(ticket, patch, { state: next });
  const now = new Date().toISOString();
  ledger.updatedAt = now;
  ledger.events.push({ at: now, type: "ticket-transition", ticket: String(id), from: previous, to: next, detail: argValue(args, "--event") || null });
  atomicWrite(ledger);
  writeFileSync(dashboardPath, dashboard(ledger));
  output({ id: String(id), from: previous, to: next }, true);
}

function renderCommand() {
  const ledger = readLedger();
  const markdown = dashboard(ledger);
  writeFileSync(dashboardPath, markdown);
  if (args.includes("--stdout")) process.stdout.write(markdown);
  else output({ dashboard: dashboardPath }, true);
}

function inspect() {
  const ledger = readLedger();
  output(collectLiveState(ledger), true);
}

function reconcile() {
  const ledger = readLedger();
  const live = collectLiveState(ledger);
  const before = JSON.stringify(ledger.observed || null);
  const after = JSON.stringify(live);
  const now = new Date().toISOString();
  ledger.observed = live;
  ledger.updatedAt = now;
  if (before !== after) ledger.events.push({ at: now, type: "reconciled", detail: "live observations replaced stale ledger observations" });
  atomicWrite(ledger);
  writeFileSync(dashboardPath, dashboard(ledger));
  output({ changed: before !== after, observed: live }, true);
}

function collectLiveState(ledger) {
  const root = runText("git", ["rev-parse", "--show-toplevel"], { allowFail: true });
  const worktrees = root ? parseWorktrees(runResult("git", ["worktree", "list", "--porcelain"], { cwd: root }).stdout) : [];
  const leasesPath = join(runDir, "leases.json");
  const leases = existsSync(leasesPath) ? readJSON(leasesPath).leases || [] : [];
  const tickets = ledger.tickets.map((ticket) => {
    const branchExists = root && ticket.branch
      ? runResult("git", ["show-ref", "--verify", "--quiet", `refs/heads/${ticket.branch}`], { cwd: root }).code === 0
      : null;
    const worktree = ticket.worktree ? worktrees.find((candidate) => resolve(candidate.path) === resolve(ticket.worktree)) : null;
    const dirty = worktree ? Boolean(runText("git", ["status", "--porcelain"], { cwd: worktree.path, allowFail: true })) : null;
    const issueResult = runResult("gh", ["issue", "view", String(ticket.id), "--json", "state"]);
    const pr = ticket.pr ? inspectPr(ticket.pr) : null;
    const integrationCommitExists = root && ticket.integrationCommit
      ? runResult("git", ["cat-file", "-e", `${ticket.integrationCommit}^{commit}`], { cwd: root }).code === 0
      : null;
    const processAlive = ticket.assignment?.pid ? isProcessAlive(ticket.assignment.pid) : null;
    return {
      id: String(ticket.id),
      recordedState: ticket.state,
      branchExists,
      worktreeOpen: Boolean(worktree),
      dirty,
      processAlive,
      issue: issueResult.code === 0 ? { queryComplete: true, ...parseJSON(issueResult.stdout) } : { queryComplete: false, error: issueResult.stderr.trim() || "issue lookup failed" },
      pr,
      leases: leases.filter((lease) => String(lease.owner) === String(ticket.id)),
      integrationCommitExists,
    };
  });
  const defaultSha = root ? runText("git", ["rev-parse", `refs/remotes/origin/${ledger.defaultBranch}`], { cwd: root, allowFail: true }) : null;
  const integrationSha = root ? runText("git", ["rev-parse", ledger.integrationBranch], { cwd: root, allowFail: true }) : null;
  const containsDefault = root && defaultSha && integrationSha
    ? runResult("git", ["merge-base", "--is-ancestor", defaultSha, ledger.integrationBranch], { cwd: root }).code === 0
    : false;
  return {
    at: new Date().toISOString(),
    root,
    defaultBranch: ledger.defaultBranch,
    defaultSha,
    integrationBranch: ledger.integrationBranch,
    integrationSha,
    containsDefault,
    umbrellaPr: ledger.umbrellaPr ? inspectPr(ledger.umbrellaPr) : null,
    tickets,
  };
}

function validatePlan(plan) {
  for (const key of ["parentSpec", "defaultBranch", "baselineSha", "integrationBranch", "tickets", "acceptanceCriteria"]) {
    if (!plan[key]) die(`plan is missing ${key}`);
  }
  if (!Array.isArray(plan.tickets) || !plan.tickets.length) die("plan.tickets must be a non-empty array");
  if (!Array.isArray(plan.acceptanceCriteria) || !plan.acceptanceCriteria.length) die("plan.acceptanceCriteria must be a non-empty array");
  const ids = new Set(plan.tickets.map((ticket) => String(ticket.id)));
  if (ids.size !== plan.tickets.length) die("ticket ids must be unique");
  for (const ticket of plan.tickets) {
    if (ticket.state && !states.includes(ticket.state)) die(`ticket ${ticket.id} has unknown state ${ticket.state}`);
    const missing = (ticket.blockers || []).map(String).filter((id) => !ids.has(id));
    if (missing.length) die(`ticket ${ticket.id} names unknown blocker(s): ${missing.join(", ")}`);
  }
  assertAcyclic(plan.tickets);
  const criterionIds = new Set();
  for (const criterion of plan.acceptanceCriteria || []) {
    if (!criterion.id || !criterion.text) die("each acceptance criterion requires id and text");
    if (criterionIds.has(String(criterion.id))) die(`duplicate acceptance criterion: ${criterion.id}`);
    criterionIds.add(String(criterion.id));
  }
}

function assertAcyclic(tickets) {
  const byId = new Map(tickets.map((ticket) => [String(ticket.id), ticket]));
  const visiting = new Set();
  const visited = new Set();
  const visit = (id) => {
    if (visiting.has(id)) die(`ticket dependency cycle includes ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const blocker of byId.get(id).blockers || []) visit(String(blocker));
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
}

function normalizeTicket(ticket) {
  return {
    id: String(ticket.id),
    title: ticket.title || "",
    blockers: (ticket.blockers || []).map(String),
    priority: ticket.priority ?? 1000,
    state: ticket.state || "planned",
    branch: ticket.branch || null,
    worktree: ticket.worktree || null,
    assignment: ticket.assignment || null,
    anticipated: ticket.anticipated || { known: false, paths: [], resources: [], migration: false, migrationIsolated: false },
    resources: ticket.resources || [],
    pr: ticket.pr || null,
    checks: ticket.checks || "pending",
    reviews: ticket.reviews || "pending",
    integrationCommit: ticket.integrationCommit || null,
    evidence: ticket.evidence || [],
    lastError: ticket.lastError || null,
  };
}

function dashboard(ledger) {
  const counts = Object.fromEntries(states.map((state) => [state, ledger.tickets.filter((ticket) => ticket.state === state).length]).filter(([, count]) => count));
  const active = ledger.tickets.filter((ticket) => ticket.assignment?.active).map((ticket) => `#${ticket.id}`);
  const failures = ledger.tickets.filter((ticket) => ["failed", "blocked"].includes(ticket.state)).map((ticket) => `#${ticket.id}`);
  const lines = [
    "<!-- implement-program:generated:start -->",
    "## Program status",
    "",
    `- Run: \`${escapeCell(ledger.runId)}\``,
    `- Baseline: \`${escapeCell(ledger.baselineSha)}\``,
    `- Integration branch: \`${escapeCell(ledger.integrationBranch)}\``,
    `- States: ${Object.entries(counts).map(([state, count]) => `${state} ${count}`).join(", ") || "none"}`,
    `- Active: ${active.join(", ") || "none"}`,
    `- Blocked or failed: ${failures.join(", ") || "none"}`,
    `- Acceptance evidence: ${(ledger.acceptanceCriteria || []).filter((criterion) => criterion.evidence?.length).length}/${(ledger.acceptanceCriteria || []).length}`,
    `- Next: ${ledger.nextTransition || "reconcile and compute frontier"}`,
    "",
    "| Ticket | Blockers | State | Branch | Worktree | Agent | Resources | PR | Checks | Reviews | Integrated |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const ticket of ledger.tickets) {
    lines.push(`| #${escapeCell(ticket.id)} ${escapeCell(ticket.title)} | ${formatList(ticket.blockers, "#")} | ${escapeCell(ticket.state)} | ${escapeCell(ticket.branch)} | ${escapeCell(ticket.worktree)} | ${escapeCell(ticket.assignment?.role)} | ${formatList(ticket.resources)} | ${escapeCell(ticket.pr)} | ${escapeCell(ticket.checks)} | ${escapeCell(ticket.reviews)} | ${escapeCell(ticket.integrationCommit)} |`);
  }
  lines.push("", "<!-- implement-program:generated:end -->", "");
  return lines.join("\n");
}

function formatList(values, prefix = "") {
  return values?.length ? values.map((value) => `${prefix}${escapeCell(value)}`).join(", ") : "-";
}

function escapeCell(value) {
  if (value == null || value === "") return "-";
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function parseWorktrees(text) {
  return text.trim().split("\n\n").filter(Boolean).map((block) => {
    const lines = block.split("\n");
    return { path: lines.find((line) => line.startsWith("worktree "))?.slice(9), branch: lines.find((line) => line.startsWith("branch "))?.slice(7) || null };
  });
}

function inspectPr(number) {
  const result = runResult("gh", ["pr", "view", String(number), "--json", "number,state,isDraft,headRefName,baseRefName,headRefOid,baseRefOid,statusCheckRollup,reviews"]);
  return result.code === 0 ? { queryComplete: true, ...parseJSON(result.stdout) } : { queryComplete: false, error: result.stderr.trim() || "pull request lookup failed" };
}

function parseJSON(value) {
  try { return JSON.parse(value); } catch { return null; }
}

function isProcessAlive(pid) {
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

function atomicWrite(ledger) {
  writeJSONAtomic(ledgerPath, ledger);
}

function readLedger() {
  if (!existsSync(ledgerPath)) die(`ledger not found: ${ledgerPath}`);
  return JSON.parse(readFileSync(ledgerPath, "utf8"));
}

function usage() {
  die("usage: ledger.mjs <init|set|evidence|profile|render|inspect|reconcile> --run-dir <dir> [options]");
}
