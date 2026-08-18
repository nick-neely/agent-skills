import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

export const SATISFIED_STATES = new Set(["integrated", "qualified", "shipped"]);

export function runResult(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: options.env || process.env,
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

export function runText(command, args = [], options = {}) {
  try {
    return execFileSync(command, args, {
      cwd: options.cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env || process.env,
    }).trim();
  } catch (error) {
    if (options.allowFail) return null;
    die(`${command} ${args.join(" ")} failed: ${String(error.stderr || error.message).trim()}`);
  }
}

export function readJSON(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    die(`could not read JSON from ${path}: ${error.message}`);
  }
}

export function writeJSONAtomic(path, value) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

export function loadTicketGraph(path) {
  const ledger = readJSON(path);
  const tickets = Array.isArray(ledger.tickets) ? ledger.tickets : [];
  return {
    ledger,
    tickets,
    byId: new Map(tickets.map((ticket) => [String(ticket.id), ticket])),
    satisfied: SATISFIED_STATES,
  };
}

export function hasCommand(name) {
  return runResult(name, ["--version"]).code === 0;
}

export function gitRoot(cwd = process.cwd()) {
  return runText("git", ["rev-parse", "--show-toplevel"], { cwd, allowFail: true });
}

export function activeGitOperation(root) {
  const markers = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"];
  return markers.find((marker) => {
    const path = runText("git", ["rev-parse", "--git-path", marker], { cwd: root, allowFail: true });
    return path && existsSync(path.startsWith("/") ? path : `${root}/${path}`);
  }) || null;
}

export function argValue(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || index === args.length - 1) return null;
  return args[index + 1];
}

export function output(value, json = false) {
  console.log(json ? JSON.stringify(value, null, 2) : String(value));
}

export function die(message) {
  console.error(`implement-program: ${message}`);
  process.exit(1);
}
