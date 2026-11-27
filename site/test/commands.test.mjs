import assert from "node:assert/strict";
import { test } from "node:test";

import { commandHTML, commandParts, commandText } from "../src/lib/commands.ts";

test("workflows install from their endpoint and skills from the repository", () => {
  assert.equal(commandText({ name: "full-stop", packed: true }, "global"), "npx skills add https://skills.nickneely.dev/workflows/full-stop --global --skill '*'");
  assert.equal(commandText({ name: "tdd", packed: false }, "project"), "npx skills add nick-neely/agent-skills --skill tdd");
});

test("agents follow the list order, whatever order they were chosen in", () => {
  assert.equal(commandText({ name: "tdd", packed: false }, "global", ["codex", "claude-code"]), "npx skills add nick-neely/agent-skills --global --skill tdd -a claude-code codex");
});

test("the rendered command reads as the copied command with every break off", () => {
  const parts = commandParts({ name: "full-stop", packed: true }, "global", ["pi"]);
  const visible = commandHTML(parts)
    .replace(/<span class="cmd-br"[^>]*>[^<]*<\/span>/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&#39;/g, "'");
  assert.equal(visible, `$ ${parts.join(" ")}`);
  // Breaks sit only between arguments, never inside a flag.
  for (const part of parts) assert.ok(commandHTML(parts).includes(part.replace(/'/g, "&#39;")));
});
