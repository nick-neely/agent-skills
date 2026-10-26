#!/usr/bin/env node
// Publish a reviewed Markdown section to an explicitly named GitHub target.
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";

const START = "<!-- ui-evidence:start -->";
const END = "<!-- ui-evidence:end -->";
const DEFAULT_LIMIT = 9_500_000;
const VIDEO_MAX = 100_000_000;
const TYPES = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm",
};
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".webm"]);
const HELP = `publish.mjs - publish visual evidence to a PR or issue

  node publish.mjs --repo <owner/name> --target <pr:N|issue:N> --section <file.md> [options]

  --repo <owner/name>      Required GitHub repository
  --target <pr:N|issue:N>  Required PR or issue
  --section <path>         Markdown containing reviewed media references
  --mode <body|comment>    Manage the description or one comment (default body)
  --image-root <path>      Directory assets must live under (default section directory)
  --max-video-bytes <N>    Exclusive video byte limit, up to 100000000; using a higher
                           limit asserts paid-plan upload eligibility
  --dry-run                Validate target and local files, print plan, upload nothing

Images and videos must be smaller than 9500000 bytes by default.
`;

function fail(message) { throw new Error(message); }
function gh(args, options = {}) {
  try {
    return execFileSync("gh", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GH_HOST: "github.com" }, ...options });
  } catch (error) {
    throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${error.stderr?.toString().trim() || error.message}`);
  }
}
function ghJson(args) {
  const output = gh(args);
  try { return JSON.parse(output); } catch { fail(`gh returned invalid JSON for ${args.join(" ")}`); }
}
function parseArgs(argv) {
  const options = { mode: "body", dryRun: false, videoLimit: DEFAULT_LIMIT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") { console.log(HELP); process.exit(0); }
    if (arg === "--dry-run") { options.dryRun = true; continue; }
    const fields = { "--repo": "repo", "--target": "target", "--section": "section", "--mode": "mode", "--image-root": "imageRoot", "--max-video-bytes": "videoLimit" };
    if (!fields[arg]) fail(`unknown option ${arg}`);
    if (!argv[i + 1] || argv[i + 1].startsWith("--")) fail(`${arg} requires a value`);
    options[fields[arg]] = argv[++i];
  }
  if (!options.repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(options.repo)) fail("--repo must be an explicit owner/name");
  if (!options.section) fail("--section is required");
  const match = /^(pr|issue):([1-9]\d*)$/.exec(options.target ?? "");
  if (!match) fail('--target must look like "pr:123" or "issue:45"');
  if (!["body", "comment"].includes(options.mode)) fail("--mode must be body or comment");
  if (!/^\d+$/.test(String(options.videoLimit)) || Number(options.videoLimit) < 1 || Number(options.videoLimit) > VIDEO_MAX) {
    fail(`--max-video-bytes must be an integer between 1 and ${VIDEO_MAX}`);
  }
  options.videoLimit = Number(options.videoLimit);
  [options.kind, options.number] = match.slice(1);
  return options;
}

// Keep prose outside a managed block exactly as it was. Refuse ambiguous markers.
function blockLocation(body) {
  const starts = [...body.matchAll(/<!-- ui-evidence:start -->/g)];
  const ends = [...body.matchAll(/<!-- ui-evidence:end -->/g)];
  if (starts.length === 0 && ends.length === 0) return null;
  if (starts.length !== 1 || ends.length !== 1 || starts[0].index >= ends[0].index) {
    fail("malformed or repeated ui-evidence markers; repair the target before publishing");
  }
  return { start: starts[0].index, end: ends[0].index + END.length };
}
function spliceSection(body, section) {
  const content = section.replace(/^(?:[ \t]*\r?\n)+/, "").replace(/(?:\r?\n[ \t]*)+$/, "");
  const managed = `${START}\n\n${content}\n\n${END}`;
  const location = blockLocation(body);
  if (location) return body.slice(0, location.start) + managed + body.slice(location.end);
  if (!body) return `${managed}\n`;
  const separator = body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
  return `${body}${separator}${managed}\n`;
}
function block(body) {
  const location = blockLocation(body);
  return location ? body.slice(location.start, location.end) : "";
}

// Identify code in the common paragraph, quote and list forms used for
// evidence. Paragraph continuations are not indented code blocks.
function maskCode(markdown) {
  const width = (spaces) => [...spaces].reduce((columns, char) => columns + (char === "\t" ? 4 - columns % 4 : 1), 0);
  const stripColumns = (text, wanted) => {
    let columns = 0;
    let index = 0;
    while (columns < wanted && (text[index] === " " || text[index] === "\t")) {
      columns += text[index] === "\t" ? 4 - columns % 4 : 1;
      index += 1;
    }
    return " ".repeat(Math.max(0, columns - wanted)) + text.slice(index);
  };
  const masked = (line) => line.replace(/[^\n]/g, " ");
  const lines = [];
  let fence = null;
  let paragraph = false;
  let indented = false;
  let quoteDepth = 0;
  let listIndents = [];
  let segment = 0;
  for (const line of markdown.split(/(?<=\n)/)) {
    let content = line;
    let depth = 0;
    for (;;) {
      const quote = /^ {0,3}>[ \t]?/.exec(content);
      if (!quote) break;
      depth += 1;
      content = content.slice(quote[0].length);
    }
    const blank = /^\s*$/.test(content);
    const leading = /^[ \t]*/.exec(content)[0];
    const columns = width(leading);
    if (fence) {
      if (depth < fence.depth || (!blank && depth === fence.depth && columns < fence.base)) {
        fence = null;
        paragraph = false;
        indented = false;
      } else {
        const relativeFence = stripColumns(content, fence.base);
        const closing = /^ {0,3}(`{3,}|~{3,})/.exec(relativeFence);
        if (depth === fence.depth && closing && closing[1][0] === fence.marker[0] && closing[1].length >= fence.marker.length && /^\s*$/.test(relativeFence.slice(closing[0].length))) fence = null;
        lines.push({ text: masked(line), segment: null });
        continue;
      }
    }
    if (depth !== quoteDepth && (depth > 0 || !paragraph)) {
      paragraph = false;
      indented = false;
      listIndents = [];
    }
    quoteDepth = depth;
    if (blank) {
      paragraph = false;
      lines.push({ text: line, segment: null });
      continue;
    }
    while (listIndents.length && columns < listIndents.at(-1)) listIndents.pop();
    const base = listIndents.at(-1) ?? 0;
    let relative = stripColumns(content, base);
    const list = /^ {0,3}([-+*]|\d{1,9}[.)])([ \t]+|(?=\r?\n|$))/.exec(relative);
    let newItem = false;
    if (list) {
      const markerWidth = list[1].length;
      const padding = width(list[2]);
      const usedPadding = padding >= 1 && padding <= 4 ? padding : 1;
      const markerIndent = width(/^ */.exec(list[0])[0]);
      listIndents.push(base + markerIndent + markerWidth + usedPadding);
      relative = " ".repeat(Math.max(0, padding - usedPadding)) + relative.slice(list[0].length);
      paragraph = false;
      indented = false;
      newItem = true;
    }
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(relative);
    const indentation = width(/^[ \t]*/.exec(relative)[0]);
    if (indentation >= 4 && (indented || !paragraph)) {
      indented = true;
      paragraph = false;
      lines.push({ text: masked(line), segment: null });
      continue;
    }
    indented = false;
    if (marker) {
      fence = { marker: marker[1], depth, base: listIndents.at(-1) ?? 0 };
      paragraph = false;
      lines.push({ text: masked(line), segment: null });
      continue;
    }
    const standalone = /^ {0,3}(?:#{1,6}(?:\s|$)|(?:[-*_]\s*){3,}$|(?:=+|-+)\s*$)/.test(relative.trimEnd());
    const tableRow = /^ {0,3}\|.*\|\s*$/.test(relative.trimEnd());
    if (!paragraph || newItem || tableRow || standalone) segment += 1;
    lines.push({ text: line, segment });
    paragraph = !standalone && !tableRow;
  }
  // A code span can cross a line break within the same paragraph. Masking each
  // paragraph separately prevents an unmatched backtick from hiding later media.
  const maskInline = (group) => {
    const runs = [...group.matchAll(/`+/g)];
    const nextMatching = [];
    const following = new Map();
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      nextMatching[index] = following.get(runs[index][0].length) ?? -1;
      following.set(runs[index][0].length, index);
    }
    let output = "";
    let cursor = 0;
    for (let index = 0; index < runs.length; index += 1) {
      const start = runs[index].index;
      let slashes = 0;
      while (start - slashes - 1 >= 0 && group[start - slashes - 1] === "\\") slashes += 1;
      if (slashes % 2) continue;
      const close = nextMatching[index];
      if (close < 0) continue;
      const end = runs[close].index + runs[close][0].length;
      output += group.slice(cursor, start) + masked(group.slice(start, end));
      cursor = end;
      index = close;
    }
    return output + group.slice(cursor);
  };
  let output = "";
  for (let index = 0; index < lines.length;) {
    const current = lines[index].segment;
    let group = lines[index++].text;
    while (current !== null && index < lines.length && lines[index].segment === current) group += lines[index++].text;
    if (current !== null) group = maskInline(group);
    output += group;
  }
  return output;
}
const IMAGE = /!\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^\s)]+))\s*\)/g;
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi;
const LINK = /(?<!!)\[[^\]\n]*\]\(([^)\n]*)\)/g;
const REFERENCE = /^\s*\[[^\]\n]+\]:\s*(?:<([^>\n]+)>|([^\s]+))/gm;
const HTML_MEDIA = /<(?:video|source)\b[^>]*?\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi;
const remote = (ref) => /^(?:https?:)?\/\//i.test(ref) || /^data:/i.test(ref);
const anyVideo = (ref) => {
  try { return /\.(?:mp4|mov|webm|avi|mkv|m4v|wmv|mpeg|mpg|ogv)(?=$|[?#\s>])/i.test(decodeURIComponent(ref)); }
  catch { fail(`invalid escaped media reference: ${ref}`); }
};
function localPath(ref, root) {
  if (/[?#\0\r\n]/.test(ref)) fail(`unsupported local asset path: ${ref}`);
  let decoded;
  try { decoded = decodeURIComponent(ref); } catch { fail(`invalid escaped asset path: ${ref}`); }
  if (/[?#\0\r\n]/.test(decoded)) fail(`unsupported local asset path: ${ref}`);
  const absolute = isAbsolute(decoded) ? resolve(decoded) : resolve(root, decoded);
  let real;
  try { real = realpathSync(absolute); } catch { fail(`missing asset: ${ref}`); }
  const withinRoot = relative(root, real);
  if (withinRoot === ".." || withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot)) fail(`asset escapes the image root: ${ref}`);
  if (!statSync(real).isFile()) fail(`asset is not a regular file: ${ref}`);
  return real;
}
function collectAssets(markdown, root, videoLimit) {
  const visible = maskCode(markdown).replace(/<!--[\s\S]*?-->/g, (value) => value.replace(/[^\n]/g, " "));
  const occurrences = [];
  const assets = new Map();
  const add = (ref, start, end, style, alt = "") => {
    if (remote(ref)) return;
    const file = localPath(ref, root);
    const ext = extname(file).toLowerCase();
    const type = TYPES[ext];
    if (!type) fail(`unsupported asset type "${ext}" for ${ref}`);
    const video = VIDEO_EXTENSIONS.has(ext);
    if (video && style !== "markdown") fail(`video must use a standalone ![](path) paragraph: ${ref}`);
    if (video) {
      const before = visible.slice(0, start);
      const after = visible.slice(end);
      if (alt || !/(?:^|\n\s*\n)$/.test(before) || !/^(?:\s*\n\s*\n|\s*$)/.test(after)) {
        fail(`video must use a standalone ![](path) paragraph with adjacent prose: ${ref}`);
      }
    }
    const size = statSync(file).size;
    const limit = video ? videoLimit : DEFAULT_LIMIT;
    if (size >= limit) fail(`${video ? "video" : "image"} must be smaller than ${limit} bytes: ${ref}`);
    let asset = assets.get(file);
    if (!asset) { asset = { file, ext, type, video, size, refs: [] }; assets.set(file, asset); }
    asset.refs.push(ref);
    occurrences.push({ ref, start, end, style, alt, asset });
  };
  const simpleImages = [...visible.matchAll(IMAGE)];
  for (const m of simpleImages) add(m[2] ?? m[3], m.index, m.index + m[0].length, "markdown", m[1]);
  const handledImages = new Set(simpleImages.map((item) => item.index));
  for (const m of visible.matchAll(/!\[[^\]\n]*\]\(([^)\n]*)\)/g)) {
    if (!handledImages.has(m.index) && !remote(m[1].trim().replace(/^</, ""))) {
      fail(`unsupported media reference; use ![alt](path) or ![alt](<path with spaces>): ${m[0]}`);
    }
  }
  for (const m of visible.matchAll(HTML_IMAGE)) add(m[2], m.index, m.index + m[0].length, "html");
  for (const tag of visible.matchAll(/<(?:img|video|source)\b[^>]*>/gi)) {
    const source = /\bsrc\s*=\s*(?:(["'])([^"']*)\1|([^\s>]+))/i.exec(tag[0]);
    if (!source) continue;
    const ref = source[2] ?? source[3];
    if (!remote(ref) && (/^<(?:video|source)\b/i.test(tag[0]) || !source[1])) {
      fail(`unsupported local media reference: ${ref}`);
    }
  }
  for (const m of visible.matchAll(LINK)) {
    const ref = m[1].trim().replace(/^</, "");
    if (!remote(ref) && anyVideo(ref)) fail(`local video must use a standalone ![](path) paragraph: ${ref}`);
  }
  for (const m of visible.matchAll(REFERENCE)) {
    const ref = m[1] ?? m[2];
    if (!remote(ref) && (anyVideo(ref) || /\.(?:png|jpe?g|gif|webp|svg)$/i.test(ref))) fail(`use inline media references instead of reference definitions: ${ref}`);
  }
  for (const m of visible.matchAll(HTML_MEDIA)) if (!remote(m[2])) fail(`local video must use a standalone ![](path) paragraph: ${m[2]}`);
  occurrences.sort((a, b) => a.start - b.start);
  return { assets: [...new Set(occurrences.map((item) => item.asset))], occurrences };
}
function makeSection(markdown, occurrences, refFor, videoAsUrl = false) {
  let output = "";
  let cursor = 0;
  for (const item of occurrences) {
    output += markdown.slice(cursor, item.start);
    const target = refFor(item.asset);
    if (item.style === "html") {
      const original = markdown.slice(item.start, item.end);
      output += original.replace(/(\bsrc\s*=\s*["'])[^"']+(["'])/i, `$1${target}$2`);
    } else if (item.asset.video && videoAsUrl) output += target;
    else output += `![${item.alt}](${target})`;
    cursor = item.end;
  }
  return output + markdown.slice(cursor);
}
function listComments(path) {
  const pages = ghJson(["api", `${path}/comments?per_page=100`, "--paginate", "--slurp"]);
  if (!Array.isArray(pages)) fail("unexpected comments response");
  return pages.flat();
}
function attachmentUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && url.pathname.startsWith("/user-attachments/assets/");
  } catch { return false; }
}
function verify(body, expected, assets, prefix) {
  const values = [];
  const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let pattern = "";
  let cursor = 0;
  const tokens = new RegExp(`${prefix}(\\d+)END`, "g");
  for (const item of expected.matchAll(tokens)) {
    const index = Number(item[1]);
    if (!assets[index]) return { verified: false, urls: [] };
    pattern += escape(expected.slice(cursor, item.index)) + "([^\\s<>()]+)";
    values.push(index);
    cursor = item.index + item[0].length;
  }
  pattern += escape(expected.slice(cursor));
  const match = new RegExp(`^${pattern}$`, "s").exec(body);
  if (!match) return { verified: false, urls: [] };
  const urls = new Map();
  for (let i = 0; i < values.length; i += 1) {
    const url = match[i + 1];
    if (!attachmentUrl(url) || (urls.has(values[i]) && urls.get(values[i]) !== url)) return { verified: false, urls: [] };
    urls.set(values[i], url);
  }
  return { verified: urls.size === assets.length, urls: assets.map((asset) => urls.get(asset.index)) };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const sectionPath = resolve(options.section);
  const markdown = readFileSync(sectionPath, "utf8");
  if (markdown.includes(START) || markdown.includes(END)) fail("section must not contain managed markers");
  const root = realpathSync(resolve(options.imageRoot ?? dirname(sectionPath)));
  if (!statSync(root).isDirectory()) fail("image root must be a directory");
  const { assets, occurrences } = collectAssets(markdown, root, options.videoLimit);
  assets.forEach((asset, index) => { asset.index = index; });
  const issuesPath = `repos/${options.repo}/issues/${options.number}`;
  const targetPath = options.kind === "pr" ? `repos/${options.repo}/pulls/${options.number}` : issuesPath;
  const target = ghJson(["api", targetPath]);
  if (options.kind === "issue" && target.pull_request) fail("target is a pull request, not an issue");
  let current = target.body ?? "";
  let existing;
  let login;
  let comments = [];
  if (options.mode === "comment") {
    login = ghJson(["api", "user"]).login;
    comments = listComments(issuesPath);
    const managed = comments.filter((comment) => comment.user?.login === login && blockLocation(comment.body ?? ""));
    if (managed.length > 1) fail("multiple managed comments found; resolve ambiguity before publishing");
    existing = managed[0];
    current = existing?.body ?? "";
  }
  blockLocation(current);
  const transport = !assets.length ? "none" : existing || occurrences.some((item) => item.style === "html") ? "direct-attachment" : "native-gh";
  const plan = { repo: options.repo, target: options.target, mode: options.mode, transport, commentId: existing?.id, assets: assets.map((asset) => ({ refs: asset.refs, bytes: asset.size, media: asset.video ? "video" : "image" })) };
  if (options.dryRun) { console.log(JSON.stringify({ ...plan, dryRun: true }, null, 2)); return; }
  if (transport === "native-gh" && !gh([options.kind, options.mode === "body" ? "edit" : "comment", "--help"]).includes("--attach")) {
    fail("installed gh lacks --attach; upgrade to gh 2.99.0 or newer");
  }
  let staging;
  let writeError;
  let writeAttempted = false;
  let expected;
  let commentId = existing?.id;
  let uploads = [];
  const tokenPrefix = `UIEVIDENCE${randomBytes(16).toString("hex")}ASSET`;
  try {
    if (transport === "native-gh") {
      staging = mkdtempSync(join(tmpdir(), "ui-evidence-"));
      const suffix = randomBytes(8).toString("hex");
      for (const asset of assets) {
        const bytes = readFileSync(asset.file);
        asset.staged = `${createHash("sha256").update(bytes).digest("hex")}-${suffix}${asset.ext}`;
        writeFileSync(join(staging, asset.staged), bytes);
      }
      const nativeSection = makeSection(markdown, occurrences, (asset) => asset.staged);
      const template = makeSection(markdown, occurrences, (asset) => `${tokenPrefix}${asset.index}END`, true);
      expected = spliceSection(current, template);
      const next = spliceSection(current, nativeSection);
      const args = [options.kind, options.mode === "body" ? "edit" : "comment", options.number, "--repo", options.repo, "--body-file", "-"];
      const attachments = [...new Set(assets.map((asset) => asset.staged))];
      const previousBlock = blockLocation(current);
      const outside = previousBlock ? current.slice(0, previousBlock.start) + current.slice(previousBlock.end) : current;
      if (attachments.some((name) => outside.includes(name))) fail("an unrelated reference outside the managed block matches a staged asset name");
      if (attachments.length > 50) fail("native gh supports at most 50 attachments per command");
      for (const name of attachments) args.push("--attach", name);
      try {
        writeAttempted = true;
        const result = gh(args, { cwd: staging, input: next });
        if (options.mode === "comment") commentId = Number(/#issuecomment-(\d+)/.exec(result)?.[1]) || undefined;
      } catch (error) { writeError = error.message; }
    } else if (transport === "direct-attachment") {
      try {
        const repositoryId = ghJson(["api", `repos/${options.repo}`]).id;
        const token = gh(["auth", "token"]).trim();
        for (const asset of assets) {
          const bytes = readFileSync(asset.file);
          const name = `${createHash("sha256").update(bytes).digest("hex")}${asset.ext}`;
          const url = `https://uploads.github.com/user-attachments/assets?name=${encodeURIComponent(name)}&content_type=${encodeURIComponent(asset.type)}&repository_id=${encodeURIComponent(repositoryId)}`;
          const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/octet-stream" }, body: bytes });
          if (!response.ok) fail(`attachment upload returned HTTP ${response.status}`);
          const uploaded = (await response.json()).url;
          if (!attachmentUrl(uploaded)) fail("attachment upload returned an invalid URL");
          asset.url = uploaded;
          uploads.push({ refs: asset.refs, url: uploaded });
        }
        const uploadedSection = makeSection(markdown, occurrences, (asset) => asset.url, true);
        expected = spliceSection(current, uploadedSection);
      } catch (error) { writeError = error.message; }
    } else expected = spliceSection(current, markdown);
    if (transport !== "native-gh" && !writeError) {
      try {
        const input = JSON.stringify({ body: expected });
        writeAttempted = true;
        if (options.mode === "body") gh(["api", "--method", "PATCH", targetPath, "--input", "-"], { input });
        else if (existing) gh(["api", "--method", "PATCH", `repos/${options.repo}/issues/comments/${existing.id}`, "--input", "-"], { input });
        else {
          const created = gh(["api", "--method", "POST", `${issuesPath}/comments`, "--input", "-"], { input });
          commentId = JSON.parse(created).id;
        }
      } catch (error) { writeError = error.message; }
    }
    let saved;
    let readError;
    try {
      if (options.mode === "body") saved = ghJson(["api", targetPath]).body ?? "";
      else {
        if (!commentId) {
          const previousIds = new Set(comments.map((comment) => comment.id));
          const added = listComments(issuesPath).filter((comment) => !previousIds.has(comment.id) && comment.user?.login === login && blockLocation(comment.body ?? ""));
          if (added.length === 1) commentId = added[0].id;
        }
        if (commentId) saved = ghJson(["api", `repos/${options.repo}/issues/comments/${commentId}`]).body ?? "";
      }
    } catch (error) { readError = error.message; }
    let savedBlock = "";
    try { if (saved !== undefined) savedBlock = block(saved); }
    catch (error) { readError = error.message; }
    const verification = saved === undefined || readError ? { verified: false, urls: [] } : transport === "native-gh" ? verify(saved, expected, assets, tokenPrefix) : { verified: saved === expected, urls: uploads.map((item) => item.url) };
    const savedReferences = [...savedBlock.matchAll(/https:\/\/github\.com\/user-attachments\/assets\/[^\s<>()]+/g)].map((match) => match[0]);
    const unresolved = assets.filter((asset) => asset.staged && savedBlock.includes(asset.staged)).flatMap((asset) => asset.refs);
    const result = { ...plan, commentId, uploads, readback: { verified: verification.verified, changed: saved === undefined ? (writeAttempted ? null : false) : saved !== current, savedReferences, unresolved, error: readError } };
    if (transport === "native-gh" && verification.verified) result.uploads = assets.map((asset) => ({ refs: asset.refs, url: verification.urls[asset.index] }));
    if (writeError || !verification.verified) {
      result.error = writeError || readError || "saved target did not match the expected managed block and asset references";
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(result, null, 2));
  } finally { if (staging) rmSync(staging, { recursive: true, force: true }); }
}

main().catch((error) => { console.error(`publish: ${error.message}`); process.exitCode = 1; });
