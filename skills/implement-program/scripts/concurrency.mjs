#!/usr/bin/env node
import { argValue, die, loadTicketGraph, output } from "./lib.mjs";

const args = process.argv.slice(2);
const path = argValue(args, "--ledger");
if (!path) die("usage: concurrency.mjs --ledger <run.json> --capacity <total-subagent-capacity> [--json]");
const capacityArg = Number(argValue(args, "--capacity"));
if (!Number.isInteger(capacityArg) || capacityArg < 0) die("usage: concurrency.mjs --ledger <run.json> --capacity <total-subagent-capacity> [--json]");
const { ledger, tickets, byId, satisfied } = loadTicketGraph(path);
const active = tickets.filter((ticket) => ticket.assignment?.active);
const maximum = Math.min(ledger.config?.concurrency?.maxActiveSubagents ?? 5, capacityArg);
const capacity = Math.max(0, maximum - active.length);
const candidates = tickets
  .filter((ticket) => ticket.state === "planned")
  .filter((ticket) => (ticket.blockers || []).every((id) => satisfied.has(byId.get(String(id))?.state)))
  .sort((a, b) => (a.priority ?? 1000) - (b.priority ?? 1000));
const selected = [];
const deferred = [];

for (const ticket of candidates) {
  if (selected.length >= capacity) {
    deferred.push({ id: String(ticket.id), reason: "sub-agent capacity reached" });
    continue;
  }
  const peers = [...active, ...selected];
  const reason = peers.map((peer) => conflicts(ticket, peer)).find(Boolean);
  if (reason) deferred.push({ id: String(ticket.id), reason });
  else selected.push(ticket);
}

output({
  configuredMaximum: ledger.config?.concurrency?.maxActiveSubagents ?? 5,
  harnessCapacity: capacityArg,
  maximum,
  active: active.map((ticket) => String(ticket.id)),
  selected: selected.map((ticket) => String(ticket.id)),
  deferred,
}, args.includes("--json"));

function conflicts(left, right) {
  const a = left.anticipated || {};
  const b = right.anticipated || {};
  if (!a.known || !b.known) return `ownership isolation is unknown against ${right.id}`;
  if ((a.migration && !a.migrationIsolated) || (b.migration && !b.migrationIsolated)) {
    return `unisolated migration ownership conflicts with ${right.id}`;
  }
  const sharedResource = (a.resources || []).find((resource) => (b.resources || []).includes(resource));
  if (sharedResource) return `resource ${sharedResource} conflicts with ${right.id}`;
  const sharedPath = (a.paths || []).find((path) => (b.paths || []).some((other) => overlaps(path, other)));
  if (sharedPath) return `path ownership ${sharedPath} conflicts with ${right.id}`;
  return null;
}

function overlaps(left, right) {
  const a = String(left).replace(/\/$/, "");
  const b = String(right).replace(/\/$/, "");
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}
