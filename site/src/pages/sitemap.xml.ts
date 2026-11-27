import type { APIRoute } from "astro";

import { SETUP_PATH } from "../lib/agent-text.ts";
import { catalog, skillPath } from "../lib/catalog.ts";
import { SITE_ORIGIN } from "../lib/commands.ts";
import { INFO_PAGES, infoPath } from "../lib/info-pages.ts";

export const GET: APIRoute = () => {
  // The HTML pages and the setup guide, which has no HTML twin. The other
  // Markdown views are alternates of these pages, linked from each one.
  const paths = ["/", ...catalog().skills.map((s) => skillPath(s.name)), ...INFO_PAGES.map((p) => infoPath(p.slug)), SETUP_PATH];
  const urls = paths.map((p) => `  <url><loc>${SITE_ORIGIN}${p}</loc></url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
