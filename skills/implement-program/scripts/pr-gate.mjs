#!/usr/bin/env node
import { argValue, die, output, readJSON, runResult } from "./lib.mjs";

const args = process.argv.slice(2);
const snapshotPath = argValue(args, "--snapshot");
const pr = argValue(args, "--pr");
const readyAtArg = argValue(args, "--ready-at");
const observationSeconds = Number(argValue(args, "--observation-seconds") ?? 120);
const bots = (argValue(args, "--bots") || "").split(",").map((bot) => bot.trim().toLowerCase()).filter(Boolean);
const requiredCheckNames = repeatedValues(args, "--required-check");
const expectedBase = argValue(args, "--expected-base");
const expectedBaseSha = argValue(args, "--expected-base-sha");
const expectedHead = argValue(args, "--expected-head");
const findingsCleared = args.includes("--findings-cleared");
const now = new Date(argValue(args, "--now") || Date.now());
if (!Number.isFinite(observationSeconds) || observationSeconds < 0) die("observation seconds must be non-negative");
if (!snapshotPath && !pr) die("usage: pr-gate.mjs (--pr <number> | --snapshot <file>) --ready-at <iso> --expected-base <branch> --expected-base-sha <sha> --expected-head <branch> --findings-cleared");
if (!expectedBase || !expectedBaseSha || !expectedHead) die("expected base branch, base SHA, and head branch are required");

const snapshot = snapshotPath ? readJSON(snapshotPath) : liveSnapshot(pr);
if (!readyAtArg && !snapshot.readyAt) die("ready-at is required");
const readyAt = new Date(readyAtArg || snapshot.readyAt || 0);
if (Number.isNaN(readyAt.getTime())) die("ready-at must be an ISO timestamp");
const pushedAt = new Date(snapshot.latestPushAt || 0);
const observedFrom = new Date(Math.max(readyAt.getTime(), pushedAt.getTime()));
const observationElapsed = now.getTime() - observedFrom.getTime() >= observationSeconds * 1000;
const checks = snapshot.requiredChecks || [];
const missingChecks = requiredCheckNames.filter((name) => !checks.some((check) => check.name === name));
const failingChecks = checks.filter((check) => !isGreen(check));
const actors = [...(snapshot.reviews || []), ...(snapshot.comments || [])]
  .map((item) => String(item.author || item.login || "").toLowerCase());
const respondedBots = bots.filter((bot) => actors.some((actor) => actor.includes(bot)));
const unresolvedThreads = Number(snapshot.unresolvedThreads || 0);
const reviewByActor = new Map();
const orderedReviews = [...(snapshot.reviews || [])].sort((left, right) => String(left.submittedAt || "").localeCompare(String(right.submittedAt || "")));
for (const review of orderedReviews) reviewByActor.set(String(review.author || review.login || "unknown").toLowerCase(), review);
const changesRequested = [...reviewByActor.values()].filter((review) => String(review.state || "").toUpperCase() === "CHANGES_REQUESTED");
const queryComplete = snapshot.queryComplete !== false && snapshot.threadsQueryComplete !== false;
const currentParent = snapshot.baseRefName === expectedBase && snapshot.baseRefOid === expectedBaseSha;
const currentHead = snapshot.headRefName === expectedHead;
const open = String(snapshot.state || "").toUpperCase() === "OPEN";
const result = {
  pr: snapshot.number || pr || null,
  isDraft: Boolean(snapshot.isDraft),
  observedFrom: observedFrom.toISOString(),
  observationSeconds,
  observationElapsed,
  queryComplete,
  checksGreen: failingChecks.length === 0 && missingChecks.length === 0,
  failingChecks,
  missingChecks,
  unresolvedThreads,
  changesRequested: changesRequested.map((review) => review.author || review.login || "unknown"),
  open,
  currentParent,
  currentHead,
  findingsCleared,
  respondedBots,
  missingBots: bots.filter((bot) => !respondedBots.includes(bot)),
  candidate: queryComplete && open && currentParent && currentHead && findingsCleared && !snapshot.isDraft && observationElapsed && failingChecks.length === 0 && missingChecks.length === 0 && unresolvedThreads === 0 && changesRequested.length === 0,
  note: "Candidate status still requires semantic disposition of every review finding and a current integration parent.",
};
output(result, true);
process.exit(result.candidate ? 0 : 1);

function isGreen(check) {
  const status = String(check.status || "").toUpperCase();
  const conclusion = String(check.conclusion || "").toUpperCase();
  return status === "COMPLETED" && ["SUCCESS", "NEUTRAL", "SKIPPED"].includes(conclusion);
}

function liveSnapshot(number) {
  const view = runResult("gh", ["pr", "view", String(number), "--json", "number,state,isDraft,baseRefName,baseRefOid,headRefName,headRefOid,commits,reviews,comments,statusCheckRollup"]);
  if (view.code !== 0) die(view.stderr.trim() || `could not read pull request ${number}`);
  const data = JSON.parse(view.stdout);
  const slug = runResult("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
  let unresolvedThreads = 0;
  let threadsQueryComplete = false;
  if (slug.code === 0) {
    const [owner, name] = slug.stdout.trim().split("/");
    const query = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){nodes{isResolved}}}}}";
    const threads = runResult("gh", ["api", "graphql", "-f", `query=${query}`, "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `number=${number}`]);
    if (threads.code === 0) {
      const parsed = JSON.parse(threads.stdout);
      unresolvedThreads = parsed.data.repository.pullRequest.reviewThreads.nodes.filter((thread) => !thread.isResolved).length;
      threadsQueryComplete = true;
    }
  }
  const commits = data.commits || [];
  return {
    number: data.number,
    state: data.state,
    isDraft: data.isDraft,
    baseRefName: data.baseRefName,
    baseRefOid: data.baseRefOid,
    headRefName: data.headRefName,
    headRefOid: data.headRefOid,
    latestPushAt: commits.at(-1)?.committedDate || commits.at(-1)?.authoredDate || null,
    reviews: (data.reviews || []).map((review) => ({ author: review.author?.login, state: review.state, submittedAt: review.submittedAt })),
    comments: (data.comments || []).map((comment) => ({ author: comment.author?.login })),
    requiredChecks: (data.statusCheckRollup || []).map((check) => ({
      name: check.name || check.context || "unknown",
      status: check.status || (check.state ? "COMPLETED" : ""),
      conclusion: check.conclusion || check.state || "",
    })),
    unresolvedThreads,
    queryComplete: true,
    threadsQueryComplete,
  };
}

function repeatedValues(values, name) {
  const found = [];
  for (let index = 0; index < values.length; index++) {
    if (values[index] === name && values[index + 1]) found.push(values[++index]);
  }
  return [...new Set(found)];
}
