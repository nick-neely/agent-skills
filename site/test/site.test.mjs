// Checks the built site against the repository it is built from. Run after
// `astro build`: `pnpm check` does both.

import assert from "node:assert/strict";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const site = fileURLToPath(new URL("../", import.meta.url));
const root = join(site, "..");
const dist = join(site, "dist");
const read = (path) => readFileSync(path, "utf8");
const catalog = JSON.parse(read(join(root, "catalog.json")));
const names = catalog.categories.flatMap((c) => c.skills.map((s) => s.name));
const origin = "https://skills.nickneely.dev";
const info = ["about", "privacy", "contact"];

test("the build exists", () => {
  assert.ok(existsSync(join(dist, "index.html")), "run astro build first");
});

test("every catalog skill has a page and a Markdown alternate", () => {
  for (const name of names) {
    const page = read(join(dist, "skills", name, "index.html"));
    assert.match(page, new RegExp(`<title>${name} - Agent skills - Nick Neely</title>`));
    assert.ok(page.includes(`<link rel="canonical" href="${origin}/skills/${name}">`), `${name} canonical`);
    assert.ok(page.includes(`<link rel="alternate" type="text/markdown" href="/skills/${name}.md"`), `${name} alternate`);
    const markdown = read(join(dist, "skills", `${name}.md`));
    const source = read(join(root, "skills", name, "SKILL.md")).trimEnd();
    assert.ok(markdown.includes(source), `${name}.md carries SKILL.md verbatim`);
  }
});

test("llms.txt lists every skill with its page and Markdown", () => {
  const llms = read(join(dist, "llms.txt"));
  for (const name of names) {
    assert.ok(llms.includes(`[${name}](${origin}/skills/${name})`), `${name} page`);
    assert.ok(llms.includes(`${origin}/skills/${name}.md`), `${name} Markdown`);
  }
});

test("the home page shows real counts and one command per row", () => {
  const home = read(join(dist, "index.html"));
  const packs = names.filter((n) => existsSync(join(root, "packs", `${n}.json`)));
  const shared = catalog.categories.find((c) => c.title === "Shared methods")?.skills.length ?? 0;
  assert.ok(home.includes(`${names.length} skills, ${packs.length - shared} of them workflows`));
  const fullStop = JSON.parse(read(join(root, "packs", "full-stop.json")));
  const count = Object.values(fullStop.members).flat().length;
  assert.ok(home.includes(`Installs all ${count} skills it needs.`));
  for (const name of names) assert.ok(home.includes(`data-peek="${name}"`), `${name} row`);
  assert.ok(!home.includes("demo slot"));
  assert.ok(!home.includes("<wbr>"));
});

// Vercel's route compiler turns vercel.json into the ordered route list the
// platform runs, split into phases by \`handle\` entries. This walks that list
// the way the platform does: before it looks at files, a matching route adds
// its headers, a status ends routing and a destination rewrites the path,
// ending the phase unless it continues. When no file answers, the error phase
// picks the 404 response.
function routePhases() {
  const require = createRequire(import.meta.url);
  const { getTransformedRoutes } = require("@vercel/routing-utils");
  const { routes, error } = getTransformedRoutes(JSON.parse(read(join(root, "vercel.json"))));
  assert.equal(error, null);
  const phases = { main: [] };
  let phase = "main";
  for (const route of routes) {
    if (route.handle) phases[(phase = route.handle)] = [];
    else phases[phase].push(route);
  }
  return phases;
}
const phases = routePhases();
const lowerKeys = (headers) => Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
function matches(route, path, lower) {
  const match = new RegExp(route.src).exec(path);
  const ok = match && (route.has ?? []).every((c) => c.type === "header" && lower[c.key] !== undefined && new RegExp(`^${c.value}$`).test(lower[c.key]));
  return ok ? match : undefined;
}
/** The main phase alone: redirects, Markdown negotiation and headers, before any file is looked up. */
function request(path, headers = {}) {
  const lower = lowerKeys(headers);
  const response = { path, headers: {} };
  for (const route of phases.main) {
    const match = matches(route, response.path, lower);
    if (!match) continue;
    const fill = (value) => value.replace(/\$(\d)/g, (_, i) => match[Number(i)] ?? "");
    for (const [key, value] of Object.entries(route.headers ?? {})) response.headers[key] = fill(value);
    if (route.status) return { ...response, status: route.status, location: response.headers.Location };
    if (route.dest) {
      response.path = fill(route.dest);
      if (!route.continue) break;
    }
  }
  return { ...response, status: 200 };
}
/** The whole request: the main phase, then the file system, then the error phase when no file answers. */
function respond(path, headers = {}, exists = (p) => served(p) !== undefined) {
  const result = request(path, headers);
  if (result.status !== 200 || exists(result.path)) return result;
  const lower = lowerKeys(headers);
  const route = (phases.error ?? []).find((r) => matches(r, result.path, lower));
  if (!route) return { ...result, status: 404 };
  return { path: route.dest, status: route.status, headers: { ...result.headers, ...route.headers } };
}
/** The built file a path serves from, as Vercel's static file system resolves it. */
function served(path) {
  const file = join(dist, path);
  if (existsSync(file) && !lstatSync(file).isDirectory()) return file;
  return existsSync(join(file, "index.html")) ? join(file, "index.html") : undefined;
}
const markdown = { Accept: "text/markdown, text/html;q=0.9" };
const browser = { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };

test("bare workflow paths redirect to the skill page in one hop and install paths do not", () => {
  for (const name of names.filter((n) => existsSync(join(root, "packs", `${n}.json`)))) {
    for (const path of [`/workflows/${name}`, `/workflows/${name}/`]) {
      const result = request(path);
      assert.equal(result.status, 308, path);
      assert.equal(result.location, `/skills/${name}`, path);
    }
    for (const path of [".well-known/agent-skills/index.json", ".well-known/skills/index.json"]) {
      assert.equal(request(`/workflows/${name}/${path}`).status, 200, `/workflows/${name}/${path}`);
    }
  }
  assert.equal(request("/archives/abc.zip").status, 200);
  assert.equal(request("/.well-known/agent-skills/index.json").status, 200);
});

test("a trailing slash redirects once to the slash-free canonical path", () => {
  assert.deepEqual([request("/").status, request("/skills/tdd").status], [200, 200]);
  for (const [from, to] of [["/skills/tdd/", "/skills/tdd"], ["/skills/", "/skills"], ["/nope/", "/nope"]]) {
    const result = request(from, markdown);
    assert.equal(result.status, 308, from);
    assert.equal(result.location, to, from);
    assert.equal(request(to, markdown).status, 200, `${to} answers without a second redirect`);
  }
});

test("pages return Markdown when asked for it and HTML otherwise, varying on Accept", () => {
  const pages = [
    ["/", "/index.md", "index.html"],
    ...names.map((n) => [`/skills/${n}`, `/skills/${n}.md`, `skills/${n}/index.html`]),
    ...info.map((p) => [`/${p}`, `/${p}.md`, `${p}/index.html`]),
  ];
  for (const [path, md, html] of pages) {
    for (const accept of [markdown, { accept: "text/markdown" }]) {
      const result = request(path, accept);
      assert.equal(result.path, md, path);
      assert.ok(served(result.path), `${md} is built`);
      assert.equal(result.headers["Content-Type"], "text/markdown; charset=utf-8", path);
      assert.equal(result.headers.Vary, "Accept", path);
      assert.equal(result.headers.Link, `<${origin}${path}>; rel="canonical"`, path);
    }
    for (const accept of [browser, {}]) {
      const result = request(path, accept);
      assert.equal(result.path, path, path);
      assert.equal(served(result.path), join(dist, html), path);
      assert.equal(result.headers.Vary, "Accept", path);
      assert.equal(result.headers.Link, `<${md}>; rel="alternate"; type="text/markdown"`, path);
    }
  }
  // An unknown skill finds no Markdown file either way, so it gets the 404 page.
  assert.equal(served(request("/skills/not-a-skill", markdown).path), undefined);
  assert.equal(served(request("/skills/not-a-skill.md").path), undefined);
  assert.ok(existsSync(join(dist, "404.html")));
});

test("a path with no file answers Markdown with a Markdown 404 and browsers with the 404 page", () => {
  const body = read(join(dist, "404.md"));
  assert.ok(body.length >= 20);
  for (const link of [`${origin}/llms.txt`, `${origin}/setup.md`, `(${origin}/)`, `${origin}/contact`]) assert.ok(body.includes(link), `404.md links ${link}`);
  for (const path of ["/__ora-404-probe-k8pkdnbk", "/skills/not-a-skill", "/nope.md", "/about/more", "/workflows/full-stop/nope"]) {
    for (const accept of [markdown, { accept: "text/markdown" }]) {
      const result = respond(path, accept);
      assert.equal(result.status, 404, path);
      assert.equal(result.path, "/404.md", path);
      assert.ok(served(result.path), "404.md is built");
      assert.equal(result.headers["Content-Type"], "text/markdown; charset=utf-8", path);
      assert.equal(result.headers.Vary, "Accept", path);
    }
    for (const accept of [browser, {}]) {
      const result = respond(path, accept);
      assert.equal(result.status, 404, path);
      assert.equal(served(result.path), join(dist, "404.html"), path);
      assert.equal(result.headers.Vary, "Accept", path);
    }
  }
  // A trailing slash still redirects first; the slash-free path then gets the 404.
  assert.deepEqual([respond("/nope/", markdown).status, respond("/nope", markdown).status], [308, 404]);
});

test("files and pages that exist still answer 200 whatever the request accepts", () => {
  // The workflow build writes these into the same deployment, so they stand in for its files here.
  const workflowFiles = new Set(["/.well-known/agent-skills/index.json", "/workflows/full-stop/.well-known/agent-skills/index.json", "/archives/full-stop.zip"]);
  const exists = (p) => workflowFiles.has(p) || served(p) !== undefined;
  const files = ["/setup.md", "/index.md", "/404.md", "/skills/tdd.md", "/llms.txt", "/llms-full.txt", "/sitemap.xml", "/robots.txt", "/social-card.png", ...info.map((p) => `/${p}.md`), ...workflowFiles];
  for (const path of files) {
    for (const accept of [markdown, browser, {}]) {
      const result = respond(path, accept, exists);
      assert.equal(result.status, 200, path);
      assert.equal(result.path, path, path);
    }
  }
  for (const path of ["/", "/skills/tdd", ...info.map((p) => `/${p}`)]) {
    assert.equal(respond(path, markdown).status, 200, path);
    assert.equal(respond(path, browser).status, 200, path);
  }
  assert.deepEqual(respond("/workflows/full-stop", markdown), request("/workflows/full-stop", markdown));
});

test("text responses declare their types", () => {
  const type = (path) => request(path).headers["Content-Type"];
  for (const path of ["/setup.md", "/index.md", "/skills/tdd.md", "/404.md", ...info.map((p) => `/${p}.md`)]) assert.equal(type(path), "text/markdown; charset=utf-8", path);
  for (const path of ["/llms.txt", "/llms-full.txt"]) assert.equal(type(path), "text/plain; charset=utf-8", path);
});

const pages = () => [["index.html", "/"], ...names.map((n) => [`skills/${n}/index.html`, `/skills/${n}`]), ...info.map((p) => [`${p}/index.html`, `/${p}`])];
const meta = (html, attr, key) => html.match(new RegExp(`<meta ${attr}="${key}" content="([^"]*)"`))?.[1];
/** The text a reader sees in a page's body or a fragment of it: no scripts, styles or tags. */
const visibleText = (html) =>
  html
    .slice(Math.max(0, html.indexOf("<body")))
    .replace(/<(script|style)[\s\S]*?<\/\1>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#39;/g, "'")
    .replace(/&[a-z]+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const structured = (html) => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

test("every page declares its language, canonical URL, site type and social card", () => {
  for (const [file, path] of [...pages(), ["404.html", undefined]]) {
    const html = read(join(dist, file));
    assert.match(html, /<html lang="en"/, file);
    assert.equal(meta(html, "name", "is-agentic-site-type"), "content", file);
    assert.equal(meta(html, "property", "og:image"), `${origin}/social-card.png`, file);
    assert.equal(meta(html, "property", "og:image:width"), "1200", file);
    assert.equal(meta(html, "property", "og:image:height"), "630", file);
    assert.equal(meta(html, "property", "og:image:alt"), "Agent skills, with opinions. Nick Neely's agent skills at skills.nickneely.dev.", file);
    assert.equal(meta(html, "name", "twitter:card"), "summary_large_image", file);
    for (const key of ["og:type", "og:title", "og:description", "og:site_name"]) assert.ok(meta(html, "property", key), `${file} ${key}`);
    if (path) {
      assert.ok(html.includes(`<link rel="canonical" href="${origin}${path}">`), `${file} canonical`);
      assert.equal(meta(html, "property", "og:url"), `${origin}${path}`, file);
      assert.ok(html.includes(`<link rel="alternate" type="text/markdown" href="${path === "/" ? "/index.md" : `${path}.md`}"`), `${file} alternate`);
    } else {
      assert.ok(!html.includes('rel="canonical"'), "the 404 has no canonical");
      assert.equal(meta(html, "name", "robots"), "noindex", "the 404 is not indexed");
    }
    // Internal links never carry the trailing slash the server redirects away.
    for (const [, href] of html.matchAll(/href="(\/[^"#]*)"/g)) assert.ok(href === "/" || !href.endsWith("/"), `${file} links ${href}`);
  }
  const { size } = statSync(join(dist, "social-card.png"));
  assert.ok(size < 300_000, `social card is ${size} bytes`);
});

test("structured data describes the catalog and each skill", () => {
  const [site, list] = structured(read(join(dist, "index.html")));
  assert.equal(site["@type"], "WebSite");
  assert.equal(site.url, `${origin}/`);
  assert.deepEqual(site.author, {
    "@type": "Person",
    name: "Nick Neely",
    url: "https://nickneely.dev",
    description: "Software developer who publishes the agent skills he uses with coding agents.",
    sameAs: ["https://nickneely.dev", "https://github.com/nick-neely"],
  });
  assert.ok(site.keywords.length > 0);
  const text = visibleText(read(join(dist, "index.html"))).toLowerCase();
  for (const keyword of site.keywords) assert.ok(text.includes(keyword.toLowerCase()), `the home page shows "${keyword}"`);
  assert.equal(list["@type"], "ItemList");
  assert.deepEqual(list.itemListElement.map((i) => i.url), names.map((n) => `${origin}/skills/${n}`));
  assert.ok(list.itemListElement.every((i) => i.name && i.description));
  for (const name of names) {
    const [code, crumbs] = structured(read(join(dist, "skills", name, "index.html")));
    assert.equal(code["@type"], "SoftwareSourceCode");
    assert.equal(code.name, name);
    assert.equal(code.codeRepository, `https://github.com/nick-neely/agent-skills/tree/main/skills/${name}`);
    assert.equal(code.programmingLanguage, "Markdown");
    assert.equal(code.license, "https://opensource.org/licenses/MIT");
    assert.ok(code.description);
    assert.equal(crumbs["@type"], "BreadcrumbList");
    assert.deepEqual(crumbs.itemListElement.map((i) => i.item), [`${origin}/`, `${origin}/skills/${name}`]);
  }
  assert.match(read(join(root, "LICENSE")), /^MIT License/);
});

test("the setup guide walks an agent through five steps and three checkpoints", async () => {
  const { AGENTS } = await import("../src/lib/commands.ts");
  const setup = read(join(dist, "setup.md"));
  assert.deepEqual([...setup.matchAll(/^## (\d)\. /gm)].map((m) => m[1]), ["1", "2", "3", "4", "5"]);
  assert.equal([...setup.matchAll(/\*\*Checkpoint:\*\*/g)].length, 3);
  assert.ok(setup.includes(`${origin}/llms.txt`));
  assert.ok(setup.includes(`npx skills add ${origin} --skill <name>`), "names the root index install");
  assert.ok(setup.includes("npx skills add https://skills.nickneely.dev/workflows/full-stop --global --skill '*'"), "shows a real command");
  assert.ok(setup.includes(`The agent ids are: ${AGENTS.map((a) => `\`${a}\``).join(", ")}.`), "agents match the install control");
  const chips = [...read(join(dist, "skills", "tdd", "index.html")).matchAll(/data-agent="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(chips, [...AGENTS]);
  assert.ok(!/\u2014/.test(setup), "plain hyphens only");
});

test("the hero offers the setup prompt as visible text with a copy button", () => {
  const home = read(join(dist, "index.html"));
  const prompt = "Help me pick and install agent skills from Nick Neely's catalog. Read https://skills.nickneely.dev/setup.md and follow it. Check with me before installing anything.";
  const block = home.slice(home.indexOf('data-snippet="setup prompt"'), home.indexOf("</main>"));
  assert.ok(block.includes(`data-snippet-text>${prompt.replace(/'/g, "&#39;")}</p>`) || block.includes(`data-snippet-text>${prompt}</p>`), "prompt text");
  assert.ok(block.includes('data-snippet-event="Copy setup prompt"'));
  assert.match(block, /<button type="button" class="copy-btn js-only[^"]*" data-copy aria-label="Copy setup prompt">/);
  assert.ok(home.indexOf('data-snippet="setup prompt"') > home.indexOf("data-install"), "after the featured install");
  assert.ok(read(join(dist, "index.md")).includes(prompt));
});

test("llms.txt leads with the setup guide and llms-full.txt carries every SKILL.md", () => {
  const llms = read(join(dist, "llms.txt"));
  const setupLine = llms.indexOf(`${origin}/setup.md`);
  assert.ok(setupLine > 0 && setupLine < llms.indexOf("## Install"), "setup.md is listed before the catalog");
  assert.ok(llms.includes(`npx skills add ${origin} --skill <skill>`), "root index install");
  const full = read(join(dist, "llms-full.txt"));
  assert.ok(full.startsWith(llms.trimEnd()));
  for (const name of names) assert.ok(full.includes(read(join(root, "skills", name, "SKILL.md")).trimEnd()), name);
});

test("the home page has a Markdown twin listing the catalog", () => {
  const md = read(join(dist, "index.md"));
  for (const name of names) assert.ok(md.includes(`[${name}](${origin}/skills/${name})`), name);
  assert.ok(md.includes(`${origin}/setup.md`));
});

test("robots.txt welcomes crawlers and agents and the sitemap lists every page", () => {
  const robots = read(join(dist, "robots.txt"));
  assert.ok(!/Disallow:\s*\S/.test(robots), "nothing is disallowed");
  for (const agent of ["GPTBot", "ClaudeBot", "Claude-User", "PerplexityBot", "Google-Extended"]) assert.match(robots, new RegExp(`^User-agent: ${agent}$`, "m"));
  assert.match(robots, /^Sitemap: https:\/\/skills\.nickneely\.dev\/sitemap\.xml$/m);
  const sitemap = read(join(dist, "sitemap.xml"));
  const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.deepEqual(locs, [`${origin}/`, ...names.map((n) => `${origin}/skills/${n}`), ...info.map((p) => `${origin}/${p}`), `${origin}/setup.md`]);
});

test("the about, privacy and contact pages carry real content, metadata and Markdown twins", () => {
  const types = { about: "AboutPage", privacy: "WebPage", contact: "ContactPage" };
  const llms = read(join(dist, "llms.txt"));
  for (const page of info) {
    const html = read(join(dist, page, "index.html"));
    const title = page[0].toUpperCase() + page.slice(1);
    assert.match(html, new RegExp(`<title>${title} - Agent skills - Nick Neely</title>`));
    assert.ok(meta(html, "name", "description"), `${page} description`);
    const main = html.slice(html.indexOf('<main'), html.indexOf("</main>"));
    const text = visibleText(main);
    assert.ok(text.length >= 500, `${page} has ${text.length} characters of text`);
    assert.ok(!/\u2014/.test(html), `${page} uses plain hyphens`);
    const [data] = structured(html);
    assert.equal(data["@type"], types[page], page);
    assert.equal(data.url, `${origin}/${page}`, page);
    assert.equal(data.name, title, page);
    assert.ok(data.description, page);
    assert.equal(data.isPartOf.url, `${origin}/`, page);
    const md = read(join(dist, `${page}.md`));
    assert.ok(md.startsWith(`# ${title}\n`), `${page}.md heading`);
    assert.ok(md.includes(`${origin}/${page}`), `${page}.md links its page`);
    // The Markdown twin carries the same body the page renders.
    for (const [, heading] of md.matchAll(/^## (.+)$/gm)) assert.ok(main.includes(`>${heading}</h2>`), `${page} renders "${heading}"`);
    assert.ok(llms.includes(`[${title}](${origin}/${page})`) && llms.includes(`${origin}/${page}.md`), `llms.txt lists ${page}`);
  }
  const privacy = read(join(dist, "privacy.md"));
  assert.ok(privacy.includes("Last updated: 27 November 2026"));
  for (const key of ["`theme`", "`hero-demo-paused`", "`Copy install`", "`Copy setup prompt`", "https://vercel.com/legal/privacy-policy"]) assert.ok(privacy.includes(key), `privacy names ${key}`);
  // The page must name every key the site's scripts store in the browser.
  const sources = ["src/lib/site-theme.ts", "src/scripts/theme.ts", "src/components/HeroDemoLive.tsx"].map((f) => read(join(site, f))).join("\n");
  assert.ok(sources.includes('localStorage.getItem("theme")') && sources.includes('PAUSED_KEY = "hero-demo-paused"'));
  const contact = read(join(dist, "contact.md"));
  for (const link of ["https://github.com/nick-neely/agent-skills/issues", "https://github.com/nick-neely/agent-skills/blob/main/SECURITY.md", "https://nickneely.dev/contact"]) assert.ok(contact.includes(link), `contact links ${link}`);
  assert.ok(!/@[a-z0-9-]+\.[a-z]/i.test(contact), "contact publishes no email address");
});

test("the footer links the about, privacy and contact pages on every page and the header does not", () => {
  for (const [file] of [...pages(), ["404.html"]]) {
    const html = read(join(dist, file));
    const footer = html.slice(html.indexOf('<footer class="site-foot"'), html.indexOf("</footer>"));
    const header = html.slice(html.indexOf('<header class="site-head"'), html.indexOf("</header>"));
    for (const page of info) {
      assert.ok(footer.includes(`href="/${page}"`), `${file} footer links /${page}`);
      assert.ok(!header.includes(`href="/${page}"`), `${file} header leaves out /${page}`);
    }
  }
  assert.ok(read(join(dist, "404.html")).includes('href="/contact"'));
});
