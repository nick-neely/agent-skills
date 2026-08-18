#!/usr/bin/env node
import { argValue, die, loadTicketGraph, output, SATISFIED_STATES } from "./lib.mjs";

const args = process.argv.slice(2);
const path = argValue(args, "--ledger");
if (!path) die("usage: qualification.mjs --ledger <run.json> [--json]");
const { ledger, tickets } = loadTicketGraph(path);
const incompleteTickets = tickets.filter((ticket) => !SATISFIED_STATES.has(ticket.state)).map((ticket) => String(ticket.id));
const criteria = ledger.acceptanceCriteria || [];
const requiredEvidenceFields = ["ticket", "pr", "commit", "review", "verification"];
const missingEvidence = criteria.filter((criterion) =>
  !criterion.evidence?.length || criterion.evidence.some((evidence) => requiredEvidenceFields.some((field) => !evidence[field])),
).map((criterion) => String(criterion.id));
const observed = ledger.observed || null;
const observationFresh = observed?.at && Date.now() - new Date(observed.at).getTime() <= 60_000;
const umbrella = observed?.umbrellaPr;
const umbrellaValid = Boolean(
  umbrella?.queryComplete &&
  umbrella.state === "OPEN" &&
  umbrella.isDraft === true &&
  umbrella.baseRefName === ledger.defaultBranch &&
  umbrella.headRefName === ledger.integrationBranch &&
  umbrella.headRefOid === observed.integrationSha,
);
const liveTicketsValid = Boolean(observed?.tickets?.length === tickets.length && observed.tickets.every((ticket) =>
  ticket.issue?.queryComplete &&
  (!ticket.pr || ticket.pr.queryComplete) &&
  ticket.integrationCommitExists === true,
));
const result = {
  ready: tickets.length > 0 && criteria.length > 0 && incompleteTickets.length === 0 && missingEvidence.length === 0 && observationFresh && observed?.containsDefault && umbrellaValid && liveTicketsValid,
  incompleteTickets,
  acceptanceCriteria: criteria.length,
  missingEvidence,
  observationFresh: Boolean(observationFresh),
  containsCurrentDefault: Boolean(observed?.containsDefault),
  umbrellaValid,
  liveTicketsValid,
  approvalActions: ledger.approvalActions || [],
};
output(result, true);
process.exit(result.ready ? 0 : 1);
