// schema.org descriptions of the pages, as JSON-LD, built from the same catalog
// the pages render.

import { REPOSITORY_URL, catalog, skillPath, type Skill } from "./catalog.ts";
import { SITE_ORIGIN } from "./commands.ts";
import { plainText } from "./html.ts";
import { infoPath, type InfoPage } from "./info-pages.ts";
import { site } from "./site.ts";

const absolute = (path: string) => new URL(path, SITE_ORIGIN).href;
const siteName = `${site.name} - ${site.owner}`;
const author = {
  "@type": "Person",
  name: site.owner,
  url: site.home,
  description: "Software developer who publishes the agent skills he uses with coding agents.",
  sameAs: [site.home, site.github],
};
// Product terms for the home page. Each must also appear in the page's visible text.
export const HOME_KEYWORDS = ["agent skills", "coding agents"];
const website = { "@type": "WebSite", name: siteName, url: absolute("/") };
// The repository's LICENSE, which every skill here ships under.
const LICENSE = "https://opensource.org/licenses/MIT";

export function homeData(): Record<string, unknown>[] {
  const { skills } = catalog();
  return [
    { "@context": "https://schema.org", ...website, description: site.description, inLanguage: "en", keywords: HOME_KEYWORDS, author },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Catalog",
      numberOfItems: skills.length,
      itemListElement: skills.map((skill, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: skill.name,
        url: absolute(skillPath(skill.name)),
        description: plainText(skill.summary),
      })),
    },
  ];
}

export function skillData(skill: Skill): Record<string, unknown>[] {
  const url = absolute(skillPath(skill.name));
  return [
    {
      "@context": "https://schema.org",
      "@type": "SoftwareSourceCode",
      name: skill.name,
      description: plainText(skill.summary),
      url,
      codeRepository: `${REPOSITORY_URL}/tree/main/skills/${skill.name}`,
      programmingLanguage: "Markdown",
      license: LICENSE,
      author,
      isPartOf: website,
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: site.name, item: absolute("/") },
        { "@type": "ListItem", position: 2, name: skill.name, item: url },
      ],
    },
  ];
}

export function infoData(page: InfoPage): Record<string, unknown>[] {
  return [
    {
      "@context": "https://schema.org",
      "@type": page.type,
      name: page.title,
      url: absolute(infoPath(page.slug)),
      description: page.description,
      inLanguage: "en",
      ...(page.updated && { dateModified: page.updated }),
      isPartOf: website,
      ...(page.type === "AboutPage" ? { mainEntity: author } : { author }),
    },
  ];
}
