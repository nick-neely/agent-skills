# Site

The landing page and catalog for `skills.nickneely.dev`. It ships in the same
Vercel deployment as the workflow install endpoints under `/workflows/`.

- [`PRODUCT.md`](PRODUCT.md) - audience, purpose and constraints.
- [`DESIGN.md`](DESIGN.md) - the visual system, shared with nickneely.dev.

## Commands

The site is a static Astro build with its own dependencies. Run these from
this directory with Node 22.23.4 or newer:

```sh
pnpm install
pnpm dev        # local server with reload
pnpm build      # static output in site/dist/
pnpm preview    # serve site/dist/
pnpm check      # astro check, a build, then the tests in test/
```

`../scripts/validate` runs `pnpm check`'s steps too whenever
`site/node_modules` exists, and skips them with a message when it does not.

## The deployment build

Vercel runs, from the repository root:

```sh
npx --yes pnpm@11.25.0 --dir site install --frozen-lockfile
node scripts/build-workflows.mjs && node scripts/build-site.mjs
```

`build-workflows.mjs` replaces `dist/` with the workflow endpoints and
archives. `build-site.mjs` then builds this site and copies it into `dist/`,
and fails without copying anything if the two builds would write the same
path. Start from the first command each time: the second refuses to run
twice over the same `dist/`.

`build-workflows.mjs` also writes a root discovery index at
`/.well-known/agent-skills/index.json` listing every local skill, so
`npx skills add https://skills.nickneely.dev --skill <name>` installs one
skill on its own. The install buttons keep their workflow and GitHub commands.

`vercel.json` routes requests before Vercel looks for files, because a
rewrite in `rewrites` never applies to a path that has a file:

- `/workflows/<name>`, with or without a trailing slash, redirects to
  `/skills/<name>` with a 308. The rule matches one path segment only, so
  `/workflows/<name>/.well-known/...`, which the Skills CLI fetches, keeps
  serving files.
- Any other trailing slash redirects once to the path without it. Canonical
  URLs, links and the sitemap never end in a slash, and `astro.config.mjs`
  sets `trailingSlash: "never"` to match.
- `/`, `/skills/<name>`, `/about`, `/privacy` and `/contact` answer a request
  whose `Accept` header mentions `text/markdown` with their `.md` twin
  (`/index.md` for the home page). Both forms send `Vary: Accept`, and the
  HTML sends a `Link` to its Markdown twin.
- The `hit` phase adds the canonical `Link` to skill Markdown after Vercel
  resolves an existing file. Direct `.md` requests get it too.
- Response headers live in `routes` as `continue` rules, not in `headers`:
  Vercel appends `headers` after every route, which would put them in the
  error phase below.
- After `{ "handle": "filesystem" }`, the `{ "handle": "error" }` phase runs
  only when no file answered. A request that accepts `text/markdown` gets
  `/404.md` with a 404 status and a Markdown content type; any other request
  gets `404.html` with a 404 status. Both send `Vary: Accept`.

`test/site.test.mjs` checks these rules against Vercel's own route compiler.

## Data

Nothing about the skills is written down in the site. `src/lib/catalog.ts`
reads the repository at build time:

- `catalog.json` - categories, order, summaries.
- `skills/*/SKILL.md` - instructions, `metadata.requires` and
  `metadata.uses` edges, `compatibility`, `disable-model-invocation`, and the
  file list from the skill directory.
- `packs/*.json` - what each workflow installs and omits, with reasons.
- `external-skills.json` - the commit each upstream skill is pinned to.

Install commands come from one builder, `src/lib/commands.ts`, shared by the
pages, the copy buttons, `/skills/<name>.md` and `/llms.txt`.

## Pages

- `/` - hero, featured workflow and the catalog.
- `/skills/<name>` - install control, requirements, what a workflow installs
  (a build-time SVG graph with a list equivalent), connections, files and
  the rendered `SKILL.md`.
- `/index.md`, `/skills/<name>.md`, `/llms.txt` and `/llms-full.txt` (llms.txt
  plus every `SKILL.md`) - the same content for agents.
- `/setup.md` - the guide the hero's setup prompt sends an agent to: read
  the catalog, ask, recommend, install and confirm, with a checkpoint for the
  reader's approval before each consequential step. It names agents and
  skills from the same data as the pages.
- `/about`, `/privacy` and `/contact`, linked from the footer. Each is written
  once as Markdown in `src/lib/info-pages.ts`, rendered for the page and
  served as is at `/<page>.md`.
- `/404`, its Markdown form `/404.md`, `/sitemap.xml`, `/robots.txt`.

Every page carries Open Graph and Twitter card tags with `/social-card.png`,
and JSON-LD: the home page a `WebSite` and an `ItemList` of the catalog, each
skill page a `SoftwareSourceCode` and a `BreadcrumbList`, and the About,
Privacy and Contact pages an `AboutPage`, `WebPage` and `ContactPage`.

Interactive parts are small scripts in `src/scripts/`. Every page reads
correctly without them; controls that need a script stay hidden until it runs.
One is inlined instead of bundled: `command-fit.js` breaks long commands onto
lines, and each install control calls it right after its command so the
lines are set before the first paint. The fonts are preloaded, and each has a
metric-matched local fallback in `site.css`, so the swap moves nothing.

## The hero demo

The hero's demo of a `full-stop` session has two layers, kept to the
contract in `DESIGN.md`:

- `src/components/HeroDemo.astro` renders the static final frame. It is what
  shows without JavaScript and under `prefers-reduced-motion`, and it always
  sets the figure's size, so hydrating the demo moves nothing.
- `src/components/HeroDemoLive.tsx` is a React island (`@astrojs/react`,
  `client:visible`) built on the Stageshow kit's `Stage`. Once it has
  measured the static body it draws the same lines, with the same classes,
  exactly over it, marks the figure `data-live` to hide the static copy, and
  plays the session: it holds the finished frame, clears the output around
  the request, then writes what the change must prove and ticks each check
  in, ending on "Ready for you to merge." About 14 seconds a loop. Phones
  (600px and under, the same breakpoint as the short static frame) keep the
  heading as the anchor and roll one status line through the checks.

Both read their words from `src/lib/hero-demo.ts`, so they cannot disagree.
The island renders nothing under reduced motion, so the static frame is all
there is and no pause control shows. Otherwise a Pause button in the frame's
title bar stops the loop on the finished frame and remembers the choice for
the session. The stage stops and resets while the figure is off screen or
the tab is hidden, and restarts from the finished frame when it returns.

`src/kit/` is the subset of the Stageshow kit the island uses, copied
unchanged under its MIT license; see its README before touching it.

## Analytics

Page views use Vercel Web Analytics' plain script, loaded only on deployed
hosts. Each successful copy sends a `Copy install` event with the skill and
scope, or a `Copy setup prompt` event. No cookies. The Pro plan's custom events
allow two properties, so the event sends no more than that; the skill's kind
follows from its name.

## Design tooling

Site design work uses two local skills that are not part of the published
collection: [Impeccable](https://impeccable.style/) for design direction and
review, and [Stageshow](https://benji.org/stageshow) for the hero's faux-UI
demo. Both install at the repository root, and the repository's `.gitignore`
keeps everything they write out of version control. Install them from the
repository root:

```sh
npx impeccable install --project --providers=claude,codex,antigravity
mkdir -p .impeccable && printf '{\n  "projectRoots": ["site"]\n}\n' > .impeccable/config.json
npx skills add benjitaylor/skills --skill stageshow -a claude-code codex antigravity
```

`projectRoots` points Impeccable at this directory's `PRODUCT.md` and
`DESIGN.md`.
