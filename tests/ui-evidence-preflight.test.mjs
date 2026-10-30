#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const preflight = join(repo, "skills", "ui-evidence", "scripts", "preflight.mjs");

function fixture(settings = {}) {
  const root = mkdtempSync(join(tmpdir(), "ui-evidence-preflight-test-"));
  const preload = join(root, "tool-boundary.mjs");
  writeFileSync(preload, String.raw`
    import cp from "node:child_process";
    import { appendFileSync } from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    const settings = JSON.parse(process.env.FAKE_SETTINGS);
    const ok = (stdout = "") => ({ status: 0, stdout, stderr: "" });
    const fail = () => ({ status: 1, stdout: "", stderr: "" });
    const missing = () => ({ status: null, stdout: null, stderr: null, error: { code: "ENOENT" } });
    cp.spawnSync = (name, args) => {
      appendFileSync(process.env.FAKE_TOOL_LOG, name + "\n");
      const override = settings.failures?.[name + " " + args.join(" ")] ?? settings.failures?.[name];
      if (override) return { status: override.status ?? null, stdout: override.stdout ?? "", stderr: "",
        ...(override.code ? { error: { code: override.code } } : {}) };
      if (name === "agent-browser" && !settings.browserMissing) {
        if (args[0] === "--version") return ok(settings.version ?? "agent-browser 0.38.1");
        if (args[0] === "doctor") return {
          status: settings.doctorStatus ?? 1,
          stdout: settings.doctor ?? JSON.stringify({ checks: [
            { id: "chrome.installed", status: "pass", message: "Chrome installed" },
            { id: "other", status: "fail", message: "unrelated failure" },
          ] }), stderr: "",
        };
      }
      if (settings.media && name === "ffmpeg") {
        if (args.includes("-encoders")) return ok(settings.encoders ?? " V....D libx264 H.264\n V..... gif GIF");
        if (args.includes("-filters")) return ok(settings.filters ?? " TS overlay  VV->V  Overlay a video\n .. pad  V->V  Pad the input");
        if (args.includes("-version")) return ok();
      }
      if (settings.media && !settings.captureOnly && ["ffprobe", "magick"].includes(name) && args.includes("-version")) return ok();
      if (name === "gh" && settings.gh) {
        if (args[0] === "--version") return ok("gh version 2.96.0");
        if (args[0] === "auth" && args[1] === "token") return settings.ghUnauthenticated ? fail() : ok("secret-token-never-report");
        if (args[0] === "pr" && args[1] === "edit" && args[2] === "--help") return ok("Usage: gh pr edit");
      }
      return missing();
    };
    syncBuiltinESMExports();
  `);
  return {
    run: (...args) => spawnSync(process.execPath, [preflight, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
        NODE_TEST_CONTEXT: "",
        FAKE_SETTINGS: JSON.stringify(settings),
        FAKE_TOOL_LOG: join(root, "calls.log"),
      },
    }),
    noCalls: () => !existsSync(join(root, "calls.log")),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("help returns before running dependency checks", () => {
  const tools = fixture();
  try {
    const result = tools.run("--help");
    assert.equal(result.status, 0);
    assert.match(result.stdout, /--prepare/);
    assert.match(result.stdout, /--annotations/);
    assert.equal(tools.noCalls(), true);
  } finally {
    tools.cleanup();
  }
});

test("a blocked browser launch reports EPERM without suggesting a reinstall", () => {
  const tools = fixture({ failures: { "agent-browser --version": { code: "EPERM", status: 0 } } });
  try {
    const result = tools.run("--json");
    assert.equal(result.status, 1);
    const browser = JSON.parse(result.stdout).checks.find((check) => check.name === "agent-browser");
    assert.equal(browser.ok, false);
    assert.match(browser.detail, /EPERM/);
    assert.equal(browser.fix, null);
  } finally {
    tools.cleanup();
  }
});

test("media preflight reports an EACCES launch failure without suggesting installation", () => {
  const tools = fixture({ media: true, failures: { "ffmpeg -version": { code: "EACCES" } } });
  try {
    const result = tools.run("--prepare", "--json");
    assert.equal(result.status, 1);
    const ffmpeg = JSON.parse(result.stdout).checks.find((check) => check.name === "ffmpeg");
    assert.match(ffmpeg.detail, /EACCES/);
    assert.equal(ffmpeg.fix, null);
  } finally {
    tools.cleanup();
  }
});

test("a blocked ImageMagick binary is not reported as missing when the fallback is absent", () => {
  const tools = fixture({ media: true, failures: { "magick -version": { code: "EPERM" } } });
  try {
    const result = tools.run("--annotate", "--json");
    assert.equal(result.status, 1);
    const magick = JSON.parse(result.stdout).checks.find((check) => check.name === "ImageMagick");
    assert.match(magick.detail, /EPERM/);
    assert.equal(magick.fix, null);
  } finally {
    tools.cleanup();
  }
});

test("a blocked montage probe is reported without suggesting ImageMagick installation", () => {
  const tools = fixture({ media: true, failures: { "magick montage -version": { code: "EACCES" } } });
  try {
    const result = tools.run("--prepare", "--json");
    assert.equal(result.status, 1);
    const montage = JSON.parse(result.stdout).checks.find((check) => check.name === "ImageMagick montage");
    assert.match(montage.detail, /EACCES/);
    assert.equal(montage.fix, null);
  } finally {
    tools.cleanup();
  }
});

test("an installed GitHub CLI that exits unsuccessfully is reported as broken, not missing", () => {
  const tools = fixture({ gh: true, failures: { "gh --version": { status: 19 } } });
  try {
    const result = tools.run("--publish", "--json");
    assert.equal(result.status, 1);
    const gh = JSON.parse(result.stdout).checks.find((check) => check.name === "gh CLI");
    assert.match(gh.detail, /exited with status 19/);
    assert.equal(gh.fix, null);
  } finally {
    tools.cleanup();
  }
});

test("a genuinely missing browser retains an installation hint", () => {
  const tools = fixture({ browserMissing: true });
  try {
    const result = tools.run("--json");
    assert.equal(result.status, 1);
    const browser = JSON.parse(result.stdout).checks.find((check) => check.name === "agent-browser");
    assert.match(browser.detail, /not found/);
    assert.match(browser.fix, /agent-browser/);
  } finally {
    tools.cleanup();
  }
});

test("missing media tools retain install hints", () => {
  const tools = fixture();
  try {
    const result = tools.run("--prepare", "--json");
    assert.equal(result.status, 1);
    const checks = JSON.parse(result.stdout).checks;
    for (const name of ["ffmpeg", "ffprobe", "ImageMagick montage"]) {
      const check = checks.find((item) => item.name === name);
      assert.match(check.detail, /not found/);
      assert.ok(check.fix, name);
    }
  } finally {
    tools.cleanup();
  }
});

test("a failed FFmpeg encoder diagnostic does not claim the encoder is missing", () => {
  const tools = fixture({ media: true, failures: { "ffmpeg -hide_banner -encoders": { status: 7 } } });
  try {
    const result = tools.run("--prepare", "--json");
    assert.equal(result.status, 1);
    const encoder = JSON.parse(result.stdout).checks.find((check) => check.name === "libx264");
    assert.match(encoder.detail, /exited with status 7/);
    assert.equal(encoder.fix, null);
  } finally {
    tools.cleanup();
  }
});

test("a doctor launch error reports its code even if the process result contains output", () => {
  const tools = fixture({ failures: { "agent-browser doctor --offline --quick --json": {
    code: "EACCES", status: 0,
    stdout: JSON.stringify({ checks: [{ id: "chrome.installed", status: "pass" }] }),
  } } });
  try {
    const result = tools.run("--json");
    assert.equal(result.status, 1);
    const chrome = JSON.parse(result.stdout).checks.find((check) => check.name === "Chrome");
    assert.match(chrome.detail, /EACCES/);
    assert.equal(chrome.fix, null);
  } finally {
    tools.cleanup();
  }
});

test("screenshot preflight accepts installed Chrome even if doctor finds an unrelated failure", () => {
  const tools = fixture();
  try {
    const result = tools.run("--json");
    assert.equal(result.status, 0, JSON.stringify(result));
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.find((check) => check.name === "Chrome").ok, true);
  } finally {
    tools.cleanup();
  }
});

test("preparing an existing MP4 needs media tools and review sheet support, but no browser or GitHub", () => {
  const tools = fixture({ media: true, browserMissing: true });
  try {
    const result = tools.run("--prepare", "--json");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.find((check) => check.name === "libx264").ok, true);
    assert.equal(report.checks.find((check) => check.name === "ImageMagick montage").ok, true);
    assert.equal(report.checks.some((check) => check.name === "agent-browser"), false);
  } finally {
    tools.cleanup();
  }
});

test("GIF preparation requires the GIF encoder without requiring libx264", () => {
  const tools = fixture({ media: true, browserMissing: true, encoders: " V..... gif GIF" });
  try {
    const result = tools.run("--prepare", "--format", "gif", "--json");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.find((check) => check.name === "GIF encoder").ok, true);
    assert.equal(report.checks.some((check) => check.name === "libx264"), false);
  } finally {
    tools.cleanup();
  }
});

test("GIF motion capture checks its WebM encoder without requiring review tools", () => {
  const tools = fixture({ media: true, captureOnly: true, encoders: " V....D libvpx VP8" });
  try {
    const result = tools.run("--motion", "--format", "gif", "--json");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.find((check) => check.name === "libvpx").ok, true);
    assert.equal(report.checks.some((check) => check.name === "ImageMagick montage"), false);
  } finally {
    tools.cleanup();
  }
});

test("the selected encoder is required for capture and preparation", () => {
  const tools = fixture({ media: true, encoders: " V....D libvpx VP8" });
  try {
    for (const [args, expected] of [[[], "libx264"], [["--format", "gif"], "GIF encoder"]]) {
      const mode = expected === "libx264" ? "--motion" : "--prepare";
      const result = tools.run(mode, ...args, "--json");
      assert.equal(result.status, 1);
      assert.equal(JSON.parse(result.stdout).checks.find((check) => check.name === expected).ok, false);
    }
  } finally {
    tools.cleanup();
  }
});

test("publishing works with the existing uploader when native attachments are unavailable", () => {
  const tools = fixture({ gh: true, browserMissing: true });
  try {
    const result = tools.run("--publish", "--json");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.doesNotMatch(result.stdout + result.stderr, /secret-token-never-report/);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.find((check) => check.name === "gh authentication").ok, true);
    const native = report.checks.find((check) => check.name === "gh native attachments");
    assert.equal(native.ok, false);
    assert.equal(native.required, false);
  } finally {
    tools.cleanup();
  }
});

test("missing GitHub authentication suggests login without suggesting a global install", () => {
  const tools = fixture({ gh: true, ghUnauthenticated: true });
  try {
    const result = tools.run("--publish");
    assert.equal(result.status, 1);
    assert.match(result.stdout, /gh auth login/);
    assert.doesNotMatch(result.stdout, /Ask before installing/);
  } finally {
    tools.cleanup();
  }
});

test("annotation preflight requires ImageMagick and the bundled font", () => {
  const tools = fixture({ media: true });
  try {
    const result = tools.run("--annotate", "--json");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.checks.find((check) => check.name === "ImageMagick").ok, true);
    assert.equal(report.checks.find((check) => check.name === "bundled font").ok, true);
    assert.equal(report.checks.some((check) => check.name === "gh authentication"), false);
  } finally {
    tools.cleanup();
  }
});

test("a blocked doctor is reported as a diagnostic failure without a Chrome install recommendation", () => {
  const tools = fixture({ doctor: "", doctorStatus: 1 });
  try {
    const result = tools.run("--json");
    assert.equal(result.status, 1);
    const chrome = JSON.parse(result.stdout).checks.find((check) => check.name === "Chrome");
    assert.match(chrome.detail, /doctor failed/i);
    assert.equal(chrome.fix, null);
  } finally {
    tools.cleanup();
  }
});

test("doctor distinguishes missing Chrome from malformed diagnostic JSON", () => {
  const missing = fixture({ doctor: JSON.stringify({ checks: [
    { id: "chrome.installed", status: "fail", message: "Chrome is not installed" },
  ] }) });
  const invalid = fixture({ doctor: "not JSON" });
  try {
    const missingCheck = JSON.parse(missing.run("--json").stdout).checks.find((check) => check.name === "Chrome");
    assert.equal(missingCheck.ok, false);
    assert.equal(missingCheck.fix, "agent-browser install");
    const invalidCheck = JSON.parse(invalid.run("--json").stdout).checks.find((check) => check.name === "Chrome");
    assert.match(invalidCheck.detail, /invalid JSON/i);
    assert.equal(invalidCheck.fix, null);
  } finally {
    missing.cleanup();
    invalid.cleanup();
  }
});

test("invalid or conflicting operation flags are rejected before checks", () => {
  const tools = fixture();
  try {
    for (const args of [["--motion", "--publish"], ["--prepare", "--format", "webm"], ["--format", "gif"],
      ["--annotations"], ["--compare", "--annotations"], ["--motion", "--annotations"]]) {
      const result = tools.run(...args);
      assert.equal(result.status, 2);
    }
    assert.equal(tools.noCalls(), true);
  } finally {
    tools.cleanup();
  }
});

test("motion capture reports an actionable minimum recorder version", () => {
  const tools = fixture({ version: "agent-browser 0.37.1" });
  try {
    const result = tools.run("--motion", "--json");
    assert.equal(result.status, 1);
    const browser = JSON.parse(result.stdout).checks.find((check) => check.name === "agent-browser");
    assert.equal(browser.ok, false);
    assert.match(`${browser.detail} ${browser.fix}`, /0\.38\.1/);
  } finally {
    tools.cleanup();
  }
});

test("comparison preflight checks only ImageMagick and the bundled font", () => {
  const tools = fixture({ media: true });
  const missing = fixture({});
  try {
    const result = tools.run("--compare", "--json");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.mode, "compare");
    assert.deepEqual(report.checks.map((check) => check.name), ["ImageMagick", "bundled font"]);
    const failed = missing.run("--compare", "--json");
    assert.equal(failed.status, 1);
    assert.equal(JSON.parse(failed.stdout).checks.find((check) => check.name === "ImageMagick").ok, false);
  } finally {
    tools.cleanup();
    missing.cleanup();
  }
});

test("annotated preparation adds only ImageMagick drawing and the FFmpeg overlay and pad filters", () => {
  const tools = fixture({ media: true, browserMissing: true });
  try {
    const plain = JSON.parse(tools.run("--prepare", "--json").stdout);
    assert.equal(plain.checks.some((check) => check.name === "FFmpeg overlay/pad"), false);
    assert.equal(plain.checks.some((check) => check.name === "ImageMagick"), false);
    const result = tools.run("--prepare", "--annotations", "--json");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.annotations, true);
    assert.equal(report.checks.find((check) => check.name === "FFmpeg overlay/pad").ok, true);
    assert.equal(report.checks.find((check) => check.name === "ImageMagick").ok, true);
    assert.equal(report.checks.some((check) => check.name === "agent-browser" || check.name === "gh CLI"), false);
  } finally {
    tools.cleanup();
  }
  const limited = fixture({ media: true, browserMissing: true, filters: " TS overlay  VV->V  Overlay a video" });
  try {
    const result = limited.run("--prepare", "--annotations", "--json");
    assert.equal(result.status, 1);
    const check = JSON.parse(result.stdout).checks.find((item) => item.name === "FFmpeg overlay/pad");
    assert.equal(check.ok, false);
    assert.match(check.detail, /lacks the pad filter/);
  } finally {
    limited.cleanup();
  }
});
