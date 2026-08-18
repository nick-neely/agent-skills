#!/usr/bin/env node
import { closeSync, existsSync, mkdirSync, openSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { argValue, die, output, readJSON, writeJSONAtomic } from "./lib.mjs";

const args = process.argv.slice(2);
const command = args[0];
const runDirArg = argValue(args, "--run-dir");
if (!command || !runDirArg) usage();
const runDir = resolve(runDirArg);
const path = join(runDir, "leases.json");
const lockPath = join(runDir, "leases.lock");
const owner = argValue(args, "--owner");
const resources = repeatedValues(args, "--resource");
let ledger;
if (!["acquire", "release", "list"].includes(command)) usage();
if (command === "acquire" && (!owner || !resources.length)) die("acquire requires --owner and at least one --resource");
if (command === "release" && !owner) die("release requires --owner");

if (command === "list") {
  ledger = existsSync(path) ? readJSON(path) : { version: 1, leases: [] };
} else {
  acquireLock();
  let failure = null;
  try {
    ledger = existsSync(path) ? readJSON(path) : { version: 1, leases: [] };
    if (command === "acquire") {
      const conflicts = ledger.leases.filter((lease) => resources.includes(lease.resource) && lease.owner !== owner);
      if (conflicts.length) throw new Error(`resource conflict: ${conflicts.map((lease) => `${lease.resource} held by ${lease.owner}`).join(", ")}`);
      const now = new Date().toISOString();
      for (const resource of resources) {
        if (!ledger.leases.some((lease) => lease.owner === owner && lease.resource === resource)) {
          ledger.leases.push({ owner, resource, acquiredAt: now });
        }
      }
    } else if (command === "release") {
      ledger.leases = ledger.leases.filter((lease) => lease.owner !== owner || (resources.length && !resources.includes(lease.resource)));
    }
    writeJSONAtomic(path, ledger);
  } catch (error) {
    failure = error;
  } finally {
    unlinkSync(lockPath);
  }
  if (failure) die(failure.message);
}

output(ledger, true);

function acquireLock() {
  mkdirSync(runDir, { recursive: true });
  try {
    createLock();
  } catch {
    const lockOwner = existsSync(lockPath) ? readJSON(lockPath) : null;
    if (lockOwner?.pid && !isProcessAlive(lockOwner.pid)) {
      unlinkSync(lockPath);
      createLock();
      return;
    }
    die(`lease ledger is locked: ${lockPath}`);
  }
}

function createLock() {
  const descriptor = openSync(lockPath, "wx");
  try {
    writeFileSync(descriptor, `${JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })}\n`);
  } finally {
    closeSync(descriptor);
  }
}

function isProcessAlive(pid) {
  try { process.kill(Number(pid), 0); return true; } catch { return false; }
}

function repeatedValues(values, name) {
  const found = [];
  for (let index = 0; index < values.length; index++) {
    if (values[index] === name && values[index + 1]) found.push(values[++index]);
  }
  return [...new Set(found)];
}

function usage() {
  die("usage: leases.mjs <acquire|release|list> --run-dir <dir> [--owner <id>] [--resource <kind:value>]...");
}
