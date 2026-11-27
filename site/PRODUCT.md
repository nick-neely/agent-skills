# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro, generated statically at build time, in this `site/` package with its own
dependencies. It deploys in the same Vercel project as the workflow install
endpoints and writes into the same `dist/`. No backend, no auth, no database.

## Users

Developers who reach the site from a shared link: Nick's teammates, peers and
coworkers first, then developers who don't know Nick and arrive from a post or
a repository link. Most already use a coding agent (Claude Code, Codex, Cursor,
OpenCode, Pi, Antigravity) and are deciding whether one of these skills is
worth installing.

A visitor should understand what a skill or workflow does and leave with an
install command copied in under a minute. Peers who already know what they
want should find it faster than in the GitHub README.

## Product Purpose

`skills.nickneely.dev` is the front door for the skills Nick publishes in
`nick-neely/agent-skills`: how he works with coding agents, packaged so others
can install it. It is a nicer front for the repository, not a replacement for
it. Every page links back to the source on GitHub.

Success means a visitor installs a workflow or skill, or reads the
instructions and understands how a workflow fits together.

## Positioning

These are one developer's working, opinionated skills, published as source and
modified from upstream where noted: not a marketplace and not a complete list
of what Nick runs. Workflows such as `full-send` and `full-stop` chain several
skills into a delivery loop (spec, tickets, implement, prove, review, file,
babysit, merge), and the site can show that loop and each skill's real
dependencies because the repository declares them.

## Operating Context

- Skills install through the Skills CLI (`npx skills add ...`). Workflow
  installs use `https://skills.nickneely.dev/workflows/<name>`, which serves
  `/.well-known/agent-skills/index.json` to the CLI. Those paths are a public
  contract and must not change.
- Standalone skills install from the GitHub source:
  `npx skills add nick-neely/agent-skills --global --skill <name>`.
- Commands default to `--global`; project installs omit it. The CLI's
  `-a, --agent <agents>` flag selects agents without the interactive prompt.
- Catalog data lives in the repository: `catalog.json` (categories, order,
  human summaries, featured flag), `skills/*/SKILL.md` (instructions,
  `metadata.requires` and `metadata.uses` dependency edges, `compatibility`
  requirements), `packs/*.json` (workflow members, external sources, omitted
  skills with reasons) and `external-skills.json` (pinned upstream skills).

## Capabilities and Constraints

- One page per skill at `/skills/<name>`. A skill with a pack is a workflow:
  its page adds what it installs, a dependency graph, and the workflow install
  command. The bare `/workflows/<name>` path redirects to that page.
- Skill pages render the full `SKILL.md` as readable prose under "The
  instructions", with a link to the source on GitHub.
- External skills appear only as credited members of a workflow, with source
  and license links, never as catalog entries of their own.
- Install controls: a global/project scope toggle and copy, with optional agent
  chips that add `-a`. No agent selected keeps the CLI's own prompt.
- Agent-readable: raw Markdown for each page (also on `Accept: text/markdown`),
  `llms.txt` and `llms-full.txt` at root, a `/setup.md` guide that walks an
  agent through choosing and installing skills with the reader's approval, and
  a root discovery index so any one skill installs from the site URL.
- Analytics: Vercel Web Analytics page views, a copy-command event if the plan
  supports custom events, and install counts from workflow endpoint requests.
  No cookies or personal identifiers.
- About 20 skills, 9 of them workflows. Workflow sizes range from 2 to about 14
  installed skills.

## Brand Commitments

A sibling of `nickneely.dev`: same person, same visual system (see
`DESIGN.md`), its own catalog-first layout, and a clear link back to the main
site. The voice is personal, direct and opinionated: "this is how I work",
not a product launch. Not corporate, no marketplace language, no claims of
popularity.

## Evidence on Hand

- The skills themselves, their instructions and their dependency metadata.
- Workflow packs, including the reasons a workflow omits a skill.
- No install counts, stars, testimonials or users to quote yet. Do not invent
  any.

## Product Principles

1. The install command is the primary action on every page.
2. Show the real thing: the actual instructions, the actual dependency graph.
3. Honest about scope: one person's working set, credited where it came from.
4. The repository is the source of truth; the site never drifts from it.
5. Readable by people and their agents alike.

## Accessibility & Inclusion

Keyboard navigation, visible focus, WCAG AA contrast in both themes, reduced
motion respected, and no information carried only by colour or by a graph
(every graph has a list equivalent).
