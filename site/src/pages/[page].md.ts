import type { APIRoute, GetStaticPaths } from "astro";

import { INFO_PAGES, infoMarkdown } from "../lib/info-pages.ts";

export const getStaticPaths: GetStaticPaths = () => INFO_PAGES.map((page) => ({ params: { page: page.slug } }));

export const GET: APIRoute = ({ params }) => {
  const page = INFO_PAGES.find((p) => p.slug === params.page);
  if (!page) throw new Error(`No page named ${params.page}`);
  return new Response(infoMarkdown(page), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
};
