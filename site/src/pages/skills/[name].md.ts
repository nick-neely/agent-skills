import type { APIRoute, GetStaticPaths } from "astro";

import { catalog, getSkill } from "../../lib/catalog.ts";
import { skillMarkdown } from "../../lib/agent-text.ts";

export const getStaticPaths: GetStaticPaths = () => catalog().skills.map((skill) => ({ params: { name: skill.name } }));

export const GET: APIRoute = ({ params }) =>
  new Response(skillMarkdown(getSkill(String(params.name))), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
