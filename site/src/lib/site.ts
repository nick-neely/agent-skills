import { REPOSITORY_URL } from "./catalog.ts";
import { site as theme } from "./site-theme.ts";

export const site = {
  name: "Agent skills",
  owner: "Nick Neely",
  home: "https://nickneely.dev",
  github: "https://github.com/nick-neely",
  repository: REPOSITORY_URL,
  description:
    "Nick Neely's agent skills for Claude Code, Codex and other coding agents: strict workflows that start with what a change must prove and end with a pull request that shows it.",
  ...theme,
} as const;

export const pageTitle = (title?: string) => (title ? `${title} - ${site.name} - ${site.owner}` : `${site.name} - ${site.owner}`);

/** The Open Graph image in public/, shared by every page. */
export const socialCard = {
  path: "/social-card.png",
  width: 1200,
  height: 630,
  alt: "Agent skills, with opinions. Nick Neely's agent skills at skills.nickneely.dev.",
} as const;

/** JSON for a <script type="application/ld+json">, with "<" escaped so no value can close the script. */
export const jsonLd = (data: unknown) => JSON.stringify(data).replace(/</g, "\\u003c");
