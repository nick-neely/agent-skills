#!/usr/bin/env node
import { argValue, die, loadTicketGraph, output } from "./lib.mjs";

const args = process.argv.slice(2);
const path = argValue(args, "--ledger");
if (!path) die("usage: frontier.mjs --ledger <run.json> [--json]");
const { tickets, byId, satisfied } = loadTicketGraph(path);
const frontier = [];
const blocked = [];

for (const ticket of tickets) {
  if (ticket.state !== "planned") continue;
  const blockers = (ticket.blockers || []).map(String);
  const missing = blockers.filter((id) => !byId.has(id));
  if (missing.length) die(`ticket ${ticket.id} names unknown blocker(s): ${missing.join(", ")}`);
  const waiting = blockers.filter((id) => !satisfied.has(byId.get(id).state));
  if (waiting.length) blocked.push({ id: String(ticket.id), waiting });
  else frontier.push(String(ticket.id));
}

output({ frontier, blocked }, args.includes("--json"));
