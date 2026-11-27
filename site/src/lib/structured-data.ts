// schema.org descriptions of the pages, as JSON-LD, built from the same catalog
// the pages render.

import { REPOSITORY_URL, catalog, skillPath, type Skill } from "./catalog.ts";
import { SITE_ORIGIN } from "./commands.ts";
import { plainText } from "./html.ts";
import { site } from "./site.ts";

const absolute = (path: string) => new URL(path, SITE_ORIGIN).href;
const siteName = `${site.name} - ${site.owner}`;
const author = { "@type": "Person", name: site.owner, url: site.home };
// The repository's LICENSE, which every skill here ships under.
const LICENSE = "https://opensource.org/licenses/MIT";

export function homeData(): Record<string, unknown>[] {
  const { skills } = catalog();
  return [
    { "@context": "https://schema.org", "@type": "WebSite", name: siteName, url: absolute("/"), description: site.description, inLanguage: "en", author },
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
      isPartOf: { "@type": "WebSite", name: siteName, url: absolute("/") },
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
