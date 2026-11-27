import type { APIRoute } from "astro";

import { setupMarkdown } from "../lib/agent-text.ts";

export const GET: APIRoute = () => new Response(setupMarkdown(), { headers: { "Content-Type": "text/markdown; charset=utf-8" } });
