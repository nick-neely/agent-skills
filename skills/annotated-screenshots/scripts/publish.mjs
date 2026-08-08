#!/usr/bin/env node
// Upload local images referenced by a markdown section, then splice that
// section into a pull request or issue.
//
// Usage:
//   node publish.mjs --target pr:123 --section section.md
//   node publish.mjs --target issue:45 --section section.md --mode comment
//
// Re-running replaces the managed section instead of appending a second copy.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import { createHash } from "node:crypto";

const START = "<!-- annotated-screenshots:start -->";
const END = "<!-- annotated-screenshots:end -->";
const FALLBACK_TAG = "annotated-screenshots-assets";

const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const HELP = `publish.mjs - upload images and splice a section into a PR or issue

  node publish.mjs --target <pr:N|issue:N> --section <file.md> [options]

  --target <pr:N|issue:N>  Where to publish
  --section <path>         Markdown containing local image references
  --repo <owner/name>      Defaults to the current repository
  --mode <body|comment>    Edit the description, or manage a single comment (default body)
  --dry-run                Upload nothing, print the resolved plan
`;

function die(message) {
  console.error(`publish: ${message}`);
  process.exit(1);
}

function gh(args, options = {}) {
  try {
    return execFileSync("gh", args, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      ...options,
    }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message;
    die(`gh ${args.slice(0, 2).join(" ")} failed: ${detail}`);
  }
}

function parseArgs(argv) {
  const options = { mode: "body", dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(HELP);
      process.exit(0);
    } else if (arg === "--target") options.target = argv[++i];
    else if (arg === "--section") options.section = argv[++i];
    else if (arg === "--repo") options.repo = argv[++i];
    else if (arg === "--mode") options.mode = argv[++i];
    else if (arg === "--dry-run") options.dryRun = true;
    else die(`unknown option ${arg}`);
  }
  if (!options.target) die(`--target is required\n\n${HELP}`);
  if (!options.section) die(`--section is required\n\n${HELP}`);
  if (!["body", "comment"].includes(options.mode)) die("--mode must be body or comment");

  const match = /^(pr|issue):(\d+)$/.exec(options.target);
  if (!match) die('--target must look like "pr:123" or "issue:45"');
  options.kind = match[1];
  options.number = match[2];
  return options;
}

// Matches markdown images and HTML <img> tags, capturing the source path.
const IMAGE_REFS = [
  /!\[[^\]]*\]\(\s*([^)\s]+)/g,
  /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi,
];

function localImagePaths(markdown, baseDir) {
  const found = new Map();
  for (const pattern of IMAGE_REFS) {
    for (const match of markdown.matchAll(pattern)) {
      const ref = match[1];
      if (/^(https?:)?\/\//i.test(ref) || ref.startsWith("data:")) continue;
      const absolute = isAbsolute(ref) ? ref : resolve(baseDir, ref);
      found.set(ref, absolute);
    }
  }
  return found;
}

async function uploadAttachment(file, repositoryId, token) {
  const extension = extname(file).toLowerCase();
  const contentType = CONTENT_TYPES[extension];
  if (!contentType) die(`unsupported image type "${extension}" for ${file}`);

  // Collisions across runs are avoided by prefixing the content hash.
  const bytes = readFileSync(file);
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
  const name = `${digest}-${basename(file)}`;

  const url =
    "https://uploads.github.com/user-attachments/assets" +
    `?name=${encodeURIComponent(name)}` +
    `&content_type=${encodeURIComponent(contentType)}` +
    `&repository_id=${repositoryId}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": contentType,
    },
    body: bytes,
  });

  if (!response.ok) {
    throw new Error(`attachment upload returned HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (!payload?.url) throw new Error("attachment upload returned no url");
  return payload.url;
}

// The attachment endpoint is undocumented. Release assets are documented and
// stable, so they carry the load when it is unavailable.
function uploadReleaseAsset(file, repo) {
  const releases = gh(["release", "list", "--repo", repo, "--limit", "100"]);
  if (!releases.split("\n").some((line) => line.includes(FALLBACK_TAG))) {
    gh([
      "release", "create", FALLBACK_TAG,
      "--repo", repo,
      "--prerelease",
      "--title", "Annotated screenshot assets",
      "--notes", "Image assets referenced by pull request and issue descriptions.",
    ]);
  }
  const bytes = readFileSync(file);
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 8);
  const name = `${digest}-${basename(file)}`;
  gh(["release", "upload", FALLBACK_TAG, `${file}#${name}`, "--repo", repo, "--clobber"]);
  return `https://github.com/${repo}/releases/download/${FALLBACK_TAG}/${encodeURIComponent(name)}`;
}

function spliceSection(body, section) {
  const managed = `${START}\n${section.trim()}\n${END}`;
  const startAt = body.indexOf(START);
  const endAt = body.indexOf(END);
  if (startAt !== -1 && endAt !== -1 && endAt > startAt) {
    return body.slice(0, startAt) + managed + body.slice(endAt + END.length);
  }
  return body.trim().length > 0 ? `${body.trimEnd()}\n\n${managed}\n` : `${managed}\n`;
}

const options = parseArgs(process.argv.slice(2));

const sectionPath = resolve(options.section);
if (!existsSync(sectionPath)) die(`no such section file: ${sectionPath}`);
let markdown = readFileSync(sectionPath, "utf8");

const repo = options.repo ?? gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]);
const repositoryId = gh(["api", `repos/${repo}`, "--jq", ".id"]);
const token = gh(["auth", "token"]);

const images = localImagePaths(markdown, dirname(sectionPath));
for (const [ref, absolute] of images) {
  if (!existsSync(absolute)) die(`section references a missing image: ${ref} (${absolute})`);
}

if (options.dryRun) {
  console.log(
    JSON.stringify(
      {
        repo,
        repositoryId,
        target: `${options.kind}:${options.number}`,
        mode: options.mode,
        images: [...images.keys()],
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const uploads = [];
// Replace longer references first. Otherwise rewriting "a.png" would also
// corrupt an unrelated "hero-a.png" that has not been uploaded yet.
const ordered = [...images].sort(([a], [b]) => b.length - a.length);
for (const [ref, absolute] of ordered) {
  let url;
  let tier = "attachment";
  try {
    url = await uploadAttachment(absolute, repositoryId, token);
  } catch (error) {
    console.error(`publish: attachment upload failed (${error.message}); using release assets`);
    url = uploadReleaseAsset(absolute, repo);
    tier = "release-asset";
  }
  // Replace every occurrence of this reference, in markdown and HTML alike.
  markdown = markdown.split(ref).join(url);
  uploads.push({ ref, url, tier });
}

const issuesPath = `repos/${repo}/issues/${options.number}`;
const bodyPath = options.kind === "pr" ? `repos/${repo}/pulls/${options.number}` : issuesPath;

let result;
if (options.mode === "body") {
  const current = gh(["api", bodyPath, "--jq", ".body // \"\""]);
  const next = spliceSection(current, markdown);
  gh(["api", "--method", "PATCH", bodyPath, "-f", `body=${next}`, "--silent"]);
  result = { action: "updated-body", target: bodyPath };
} else {
  const login = gh(["api", "user", "--jq", ".login"]);
  const existing = gh([
    "api", `${issuesPath}/comments`, "--paginate",
    "--jq", `[.[] | select(.user.login == "${login}") | select(.body | contains("${START}")) | .id] | first // ""`,
  ]);
  if (existing) {
    gh([
      "api", "--method", "PATCH", `repos/${repo}/issues/comments/${existing}`,
      "-f", `body=${spliceSection("", markdown)}`, "--silent",
    ]);
    result = { action: "updated-comment", commentId: existing };
  } else {
    gh([
      "api", "--method", "POST", `${issuesPath}/comments`,
      "-f", `body=${spliceSection("", markdown)}`, "--silent",
    ]);
    result = { action: "created-comment", target: issuesPath };
  }
}

console.log(JSON.stringify({ repo, ...result, uploads }, null, 2));
