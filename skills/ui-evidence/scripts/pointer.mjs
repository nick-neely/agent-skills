#!/usr/bin/env node
// Install, inspect, or remove the recording-only interaction pointer.

import { execFileSync } from "node:child_process";

const HELP = `pointer.mjs - control the synthetic pointer in an agent-browser session

  node pointer.mjs <install|status|remove> --session <name>

Run install after \`agent-browser record start\`. Full navigation invalidates the
fixed recording target, so stop and discard that take instead of reinjecting.
The pointer is page instrumentation. It is not a native operating-system cursor.
`;

function die(message) {
  console.error(`pointer: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "--session") options.session = argv[++index];
    else if (!options.action) options.action = arg;
    else die(`unknown option ${arg}`);
  }
  if (!options.action) die(`an action is required\n\n${HELP}`);
  if (!options.session) die("--session is required");
  if (!["install", "status", "remove"].includes(options.action)) {
    die("action must be install, status, or remove");
  }
  return options;
}

function runBrowser(session, script) {
  try {
    const encoded = Buffer.from(script, "utf8").toString("base64");
    return execFileSync(
      "agent-browser",
      ["--session", session, "eval", "--base64", encoded, "--json"],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    die(`agent-browser evaluation failed: ${detail}`);
  }
}

function installPointer() {
  const KEY = "__uiEvidencePointer";
  const VERSION = 1;

  function install(targetWindow) {
    if (targetWindow[KEY]?.version === VERSION) {
      targetWindow[KEY].refresh();
      return targetWindow[KEY];
    }

    const document = targetWindow.document;
    const host = document.createElement("div");
    host.id = "ui-evidence-pointer-host";
    host.setAttribute("aria-hidden", "true");
    Object.assign(host.style, {
      position: "fixed",
      inset: "0",
      zIndex: "2147483647",
      pointerEvents: "none",
      overflow: "visible",
    });
    document.documentElement.append(host);

    const root = host.attachShadow({ mode: "closed" });
    root.innerHTML = `<style>
      :host { all: initial; }
      #pointer {
        position: fixed; left: 0; top: 0; width: 22px; height: 28px;
        transform: translate3d(-80px, -80px, 0);
        filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .55));
      }
      #pointer svg { display: block; width: 100%; height: 100%; }
      .ripple {
        position: fixed; width: 12px; height: 12px; margin: -6px 0 0 -6px;
        border: 3px solid #ff3b5c; border-radius: 50%;
        animation: ui-evidence-ripple 420ms ease-out forwards;
      }
      @keyframes ui-evidence-ripple {
        from { opacity: 1; transform: scale(.45); }
        to { opacity: 0; transform: scale(2.6); }
      }
    </style>
    <div id="pointer"><svg viewBox="0 0 22 28" xmlns="http://www.w3.org/2000/svg">
      <path d="M2 2v20l5.7-5.1 3.8 8.4 4.3-2-3.8-8.1H20L2 2Z"
        fill="white" stroke="#111827" stroke-width="2" stroke-linejoin="round"/>
    </svg></div>`;

    const pointer = root.querySelector("#pointer");
    const stats = { moves: 0, dragMoves: 0, downs: 0, clicks: 0, x: null, y: null };
    let sameOriginFrames = [];
    let blockedFrames = [];

    const move = (event) => {
      stats.moves += 1;
      stats.x = event.clientX;
      stats.y = event.clientY;
      pointer.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
    };
    const dragMove = (event) => {
      stats.dragMoves += 1;
      move(event);
    };
    const down = (event) => {
      stats.downs += 1;
      move(event);
    };
    const click = (event) => {
      stats.clicks += 1;
      move(event);
      const ripple = document.createElement("div");
      ripple.className = "ripple";
      ripple.style.left = `${event.clientX}px`;
      ripple.style.top = `${event.clientY}px`;
      root.append(ripple);
      targetWindow.setTimeout(() => ripple.remove(), 500);
    };

    document.addEventListener("mousemove", move, true);
    document.addEventListener("dragover", dragMove, true);
    document.addEventListener("mousedown", down, true);
    document.addEventListener("click", click, true);

    const api = {
      version: VERSION,
      refresh() {
        sameOriginFrames = [];
        blockedFrames = [];
        for (const [index, frame] of [...document.querySelectorAll("iframe")].entries()) {
          try {
            const childWindow = frame.contentWindow;
            if (!childWindow?.document) throw new Error("frame document unavailable");
            sameOriginFrames.push(install(childWindow));
          } catch {
            blockedFrames.push({ index, src: frame.getAttribute("src") || "about:blank" });
          }
        }
      },
      report() {
        api.refresh();
        return {
          installed: host.isConnected,
          version: VERSION,
          stats: { ...stats },
          sameOriginFrames: sameOriginFrames.map((child) => child.report()),
          blockedFrames: [...blockedFrames],
        };
      },
      remove() {
        for (const child of sameOriginFrames) child.remove();
        document.removeEventListener("mousemove", move, true);
        document.removeEventListener("dragover", dragMove, true);
        document.removeEventListener("mousedown", down, true);
        document.removeEventListener("click", click, true);
        host.remove();
        delete targetWindow[KEY];
      },
    };

    targetWindow[KEY] = api;
    api.refresh();
    return api;
  }

  return install(window).report();
}

const INSTALL_SCRIPT = `(${installPointer.toString()})()`;

const STATUS_SCRIPT = `(() => window.__uiEvidencePointer?.report() ?? {
  installed: false, version: null, stats: null, sameOriginFrames: [], blockedFrames: []
})()`;
const REMOVE_SCRIPT = `(() => {
  const current = window.__uiEvidencePointer;
  if (!current) return { removed: false };
  current.remove();
  return { removed: true };
})()`;

const options = parseArgs(process.argv.slice(2));
const scripts = { install: INSTALL_SCRIPT, status: STATUS_SCRIPT, remove: REMOVE_SCRIPT };
const raw = runBrowser(options.session, scripts[options.action]);

let result;
try {
  const envelope = JSON.parse(raw);
  result = envelope?.data?.result ?? envelope?.result ?? envelope;
} catch {
  die(`agent-browser returned invalid JSON: ${raw.trim()}`);
}

console.log(JSON.stringify(result, null, 2));
if (options.action === "status" && !result?.installed) process.exit(1);
