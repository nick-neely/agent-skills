#!/usr/bin/env node
// Event waiter inspired by t3dotgg/tstack. Readiness remains an agent decision.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, openSync, closeSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export function options(args) {
  const result = { interval: 60, timeout: 600, host: process.env.GH_HOST || "github.com" };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--repo", "--interval", "--timeout"].includes(arg)) {
      const value = args[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      result[arg.slice(2)] = arg === "--repo" ? value : Number(value);
    } else if (!result.target && !arg.startsWith("-")) result.target = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (result.target?.startsWith("https://")) {
    const url = new URL(result.target);
    const match = url.pathname.match(/^\/([^/]+\/[^/]+)\/pull\/(\d+)\/?$/);
    if (!match || url.username || url.password || (result.repo && result.repo !== match[1])) {
      throw new Error("Expected a PR URL matching --repo, if supplied");
    }
    result.host = url.host;
    result.repo = match[1];
    result.target = match[2];
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(result.repo || "") || !/^[1-9]\d*$/.test(result.target || "")) {
    throw new Error("Usage: pr-wait.mjs <pr-url | number --repo owner/name> [--interval seconds] [--timeout seconds]");
  }
  if (!Number.isFinite(result.interval) || result.interval < 30 || !Number.isFinite(result.timeout) || result.timeout <= 0) {
    throw new Error("Interval must be at least 30 seconds and timeout must be positive");
  }
  return result;
}

export function api(host, endpoint, field, run = spawnSync) {
  const args = ["api", "--hostname", host, endpoint];
  if (field !== undefined) args.push("--paginate", "--slurp");
  const result = run("gh", args, { encoding: "utf8", timeout: 30000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`GitHub read failed (${endpoint}): ${result.error?.message || result.stderr.trim()}`);
  }
  const data = JSON.parse(result.stdout);
  if (field === undefined) return data;
  return data.flatMap(page => {
    const rows = field === "." ? page : page[field.slice(1)];
    if (!Array.isArray(rows)) throw new Error(`Unexpected paginated response from ${endpoint}`);
    return rows;
  });
}

export function snapshot(config, read = api) {
  const root = `repos/${config.repo}`;
  const pr = read(config.host, `${root}/pulls/${config.target}`);
  const head = pr.head.sha;
  const state = {
    pr: {
      state: pr.state, merged: pr.merged, draft: pr.draft,
      head, base: pr.base.sha, baseRef: pr.base.ref,
      mergeable: pr.mergeable, mergeState: pr.mergeable_state,
    },
    checks: read(config.host, `${root}/commits/${head}/check-runs?per_page=100`, ".check_runs"),
    statuses: read(config.host, `${root}/commits/${head}/statuses?per_page=100`, "."),
    reviews: read(config.host, `${root}/pulls/${config.target}/reviews?per_page=100`, "."),
    comments: read(config.host, `${root}/issues/${config.target}/comments?per_page=100`, "."),
    replies: read(config.host, `${root}/pulls/${config.target}/comments?per_page=100`, "."),
  };
  // A push during the snapshot can mix old checks with a new head. Retry later.
  const current = read(config.host, `${root}/pulls/${config.target}`);
  if (current.head.sha !== head || current.base.sha !== pr.base.sha) return null;
  return Object.fromEntries(Object.entries(state).map(([key, value]) => [
    key, createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  ]).concat([["head", head], ["base", pr.base.sha], ["state", pr.merged ? "merged" : pr.state]]));
}

export function changed(previous, current) {
  return Object.keys(current).filter(key => previous?.[key] !== current[key]);
}

export function acquireLock(path) {
  let fd;
  try { fd = openSync(path, "wx", 0o600); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const holder = readFileSync(path, "utf8").trim();
    throw Object.assign(new Error(`Existing watcher lock ${path} (PID ${holder}); inspect its owner before removing a stale lock`), { exitCode: 3 });
  }
  writeFileSync(fd, String(process.pid));
  return () => { closeSync(fd); unlinkSync(path); };
}

export async function watch(config, directory, read = api) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const key = createHash("sha256").update(`${config.host}/${config.repo}/${config.target}`).digest("hex");
  const path = join(directory, `${key}.json`);
  const release = acquireLock(join(directory, `${key}.lock`));
  const onSignal = () => { release(); process.exit(130); };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    let previous;
    try { previous = JSON.parse(readFileSync(path, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    const deadline = Date.now() + config.timeout * 1000;
    while (Date.now() < deadline) {
      const current = snapshot(config, read);
      if (current) {
        const fields = changed(previous, current);
        if (fields.length) {
          const temp = `${path}.${process.pid}.tmp`;
          writeFileSync(temp, JSON.stringify(current), { mode: 0o600 });
          renameSync(temp, path);
          process.stdout.write(`${JSON.stringify({ event: previous ? "changed" : "initial", fields, head: current.head, base: current.base, state: current.state })}\n`);
          return 0;
        }
      }
      const remaining = deadline - Date.now();
      if (remaining > 0) await new Promise(resolve => setTimeout(resolve, Math.min(config.interval * 1000, remaining)));
    }
    return 1;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    release();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = options(process.argv.slice(2));
    process.exitCode = await watch(config, join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "pr-wait"));
  } catch (error) {
    process.stderr.write(`pr-wait: ${error.message}\n`);
    process.exitCode = error.exitCode || 2;
  }
}
