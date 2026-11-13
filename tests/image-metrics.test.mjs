import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { argumentBatches, textMeasurer } from "../skills/ui-evidence/scripts/magick-args.mjs";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const font = join(repo, "skills/ui-evidence/assets/DejaVuSans.ttf");
const binary = (process.platform === "win32" ? ["magick"] : ["magick", "convert"])
  .find((name) => spawnSync(name, ["-version"], { stdio: "ignore" }).status === 0);
if (!binary && process.env.UI_EVIDENCE_REQUIRE_MEDIA === "1") throw new Error("ImageMagick is required for text metric tests");
const media = { skip: binary ? false : "ImageMagick is unavailable" };
const requests = [["Before", 18], ["After (2x)", 36], ["Wrapped caption with several words", 18, 64],
  ["@literal %w %h \\ Unicode café", 20], ["After caption", 12], ["Before", 18]];

test("batched text metrics preserve independent font sizes, wrapping, and literal text", media, () => {
  const run = (args) => execFileSync(binary, args, { encoding: "utf8" });
  const serial = textMeasurer(run, font);
  const expected = requests.map((request) => serial(...request));
  const batched = textMeasurer(run, font);
  batched.prime(requests);
  assert.deepEqual(requests.map((request) => batched(...request)), expected);
});

test("primed text metrics are reused without another native invocation", media, () => {
  let calls = 0;
  const measure = textMeasurer((args) => {
    calls += 1;
    return execFileSync(binary, args, { encoding: "utf8" });
  }, font);
  measure.prime(requests);
  assert.equal(calls, 1);
  for (const request of requests) measure(...request);
  measure.prime(requests);
  assert.equal(calls, 1);
});

test("large argument lists split into ordered batches without losing an oversized job", () => {
  const entries = ["one", "two", "three", "x".repeat(100), "last"];
  const batches = [...argumentBatches(entries, (value) => [value], 30)];
  assert.deepEqual(batches.flat(), entries);
  assert.ok(batches.every((batch) => batch.length > 0));
  assert.deepEqual(batches.find((batch) => batch.includes(entries[3])), [entries[3]]);
  assert.deepEqual([...argumentBatches([], (value) => [value])], []);
});
