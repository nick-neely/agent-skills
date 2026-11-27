import type { APIRoute } from "astro";

import { llmsFullText } from "../lib/agent-text.ts";

export const GET: APIRoute = () => new Response(llmsFullText(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
