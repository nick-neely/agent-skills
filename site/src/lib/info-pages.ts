// The About, Privacy and Contact pages. Each is written once as Markdown: the
// HTML page renders the body, and its Markdown twin is the same text.

import { REPOSITORY_URL, catalog, ref, workflowCount } from "./catalog.ts";
import { SITE_ORIGIN } from "./commands.ts";
import { list, plural } from "./html.ts";
import { site } from "./site.ts";

export interface InfoPage {
  slug: "about" | "privacy" | "contact";
  title: string;
  description: string;
  /** The schema.org type of the page. */
  type: "AboutPage" | "WebPage" | "ContactPage";
  /** ISO date the content last changed, shown on pages whose terms it dates. */
  updated?: string;
  body: () => string;
}

export const infoPath = (slug: InfoPage["slug"]) => `/${slug}`;
export const infoMarkdownPath = (slug: InfoPage["slug"]) => `/${slug}.md`;

const repo = (path: string) => `${REPOSITORY_URL}/blob/main/${path}`;
const ISSUES_URL = `${REPOSITORY_URL}/issues`;
const PRIVATE_REPORT_URL = `${REPOSITORY_URL}/security/advisories/new`;
const CONTACT_URL = `${site.home}/contact`;

function about(): string {
  const { skills, external } = catalog();
  const upstream = Object.keys(external).map(ref).sort((a, b) => a.name.localeCompare(b.name));
  const pinned = upstream.map((r) => `\`${r.name}\` from [${r.repo}](https://github.com/${r.repo})`);
  return `This site is the front door to [nick-neely/agent-skills](${REPOSITORY_URL}), the repository where I publish the agent skills I give my own coding agents. I'm ${site.owner}, a software developer, and these skills are how I work with Claude Code, Codex and the other agents I use. They are one developer's working set, opinionated and published as source. It is not a marketplace, and it is not a complete list of everything I run.

## What is here

The catalog has ${plural(skills.length, "skill")}, ${workflowCount()} of them workflows. A skill is a \`SKILL.md\` file of instructions for an agent, plus any scripts and reference documents it calls. A workflow chains several skills into a delivery loop: write the spec, split it into tickets, implement each one with proof, get it reviewed, then open the pull request and see it through its checks. \`full-send\` goes on to merge; \`full-stop\` stops so you can. A workflow installs every skill it needs with one Skills CLI command.

Each skill page shows the real instructions, exactly as committed, and the skills it depends on. Those connections come from what each skill declares in the repository, so the dependency graphs are not drawn by hand.

## Where it comes from

Some skills adapt other people's work, and the repository credits each one. The delivery workflows build on [t3dotgg/tstack](https://github.com/t3dotgg/tstack), and \`to-spec\` and \`to-tickets\` on [mattpocock/skills](https://github.com/mattpocock/skills). Workflow downloads also include ${plural(upstream.length, "upstream skill")} at pinned revisions, each with its own license: ${list(pinned)}. The full credits are in [THIRD_PARTY_NOTICES.md](${repo("THIRD_PARTY_NOTICES.md")}).

## License

The skills are released under the [MIT License](${repo("LICENSE")}). Upstream skills keep their own licenses, which ship alongside them.

## How it is maintained

Everything on this site is built from the repository each time it deploys: the catalog, the summaries, the instructions and the install commands. Nothing about a skill is written separately for the site, so the two cannot drift apart. Changes reach the repository through pull requests on GitHub. It is a curated collection rather than an open catalog, and the [contributing guide](${repo("CONTRIBUTING.md")}) explains what fits.

## Elsewhere

My own site is [nickneely.dev](${site.home}), and my other public work is on [GitHub](${site.github}).
`;
}

function privacy(): string {
  return `The short version: this site has no accounts, no forms and no cookies, and it collects no personal data of its own. It counts page views and copy clicks without identifying you.

## What the site is

Every page is a static file, built ahead of time from the repository. There is no backend, no database, no sign-in and nothing to submit.

## Analytics

Page views are counted with [Vercel Web Analytics](https://vercel.com/docs/analytics/privacy-policy), which uses no cookies. Vercel records each view with the page address, the referring site, an approximate location, and the browser, operating system and device type, and it tells one visit from another with a hash of the request that it discards after 24 hours.

The site also sends two events when a copy succeeds:

- \`Copy install\`, with the skill's name and the scope you chose (global or project).
- \`Copy setup prompt\`, with no other data.

The copied text itself is never sent. Analytics loads only on the deployed site, never on a local copy.

## Hosting

The site runs on Vercel. Like any web host, Vercel receives the standard details of each request, such as your IP address and browser, and may keep them in its request logs. When the Skills CLI installs a workflow from this site, those requests reach Vercel in the same way, and I may count them as installs. Vercel's handling of that data is covered by the [Vercel privacy policy](https://vercel.com/legal/privacy-policy).

## Stored in your browser

Two settings stay in your own browser and are never sent anywhere:

- Your light or dark theme choice, in \`localStorage\` under \`theme\`.
- Whether you paused the demo on the home page, in \`sessionStorage\` under \`hero-demo-paused\`, which your browser clears when the tab closes.

## Other sites

Pages link to GitHub, nickneely.dev and the sites of upstream projects. Those sites have their own privacy policies.

## Questions

For anything about privacy here, see the [contact page](${infoPath("contact")}).
`;
}

function contact(): string {
  return `How to reach me depends on what it is about.

## Bugs and requests for a skill

Open an issue on [GitHub](${ISSUES_URL}). Bug reports, portability problems and corrections to an existing skill are welcome without asking first. If you want to build something large, such as a new skill, open an issue first so neither of us wastes the effort. The [contributing guide](${repo("CONTRIBUTING.md")}) covers what fits the collection.

## Security vulnerabilities

Do not open a public issue. Report vulnerabilities through [GitHub private vulnerability reporting](${PRIVATE_REPORT_URL}), as the [security policy](${repo("SECURITY.md")}) describes. These skills run on your machine with your shell and your tokens, so the policy treats anything that widens that reach as a vulnerability. I aim to acknowledge a report within a week.

## Everything else

For anything else, including questions about this site or its privacy, use the contact page on my own site: [nickneely.dev/contact](${CONTACT_URL}).
`;
}

export const INFO_PAGES: readonly InfoPage[] = [
  {
    slug: "about",
    title: "About",
    description: `What this site is: ${site.owner}'s working set of agent skills, published as source under the MIT License, with credit to the upstream skills it builds on.`,
    type: "AboutPage",
    body: about,
  },
  {
    slug: "privacy",
    title: "Privacy",
    description: "What this site collects: cookieless page views and copy events through Vercel Web Analytics. No accounts, no forms and no cookies.",
    type: "WebPage",
    updated: "2026-11-27",
    body: privacy,
  },
  {
    slug: "contact",
    title: "Contact",
    description: "How to reach Nick Neely about these agent skills: GitHub issues for bugs and requests, private reporting for vulnerabilities, and nickneely.dev for everything else.",
    type: "ContactPage",
    body: contact,
  },
];

/** "27 November 2026" for an ISO date. */
export const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function infoMarkdown(page: InfoPage): string {
  return [
    `# ${page.title}`,
    "",
    `> ${page.description}`,
    "",
    `- Page: ${SITE_ORIGIN}${infoPath(page.slug)}`,
    ...(page.updated ? [`- Last updated: ${longDate(page.updated)}`] : []),
    "",
    page.body().trimEnd(),
    "",
  ].join("\n");
}
