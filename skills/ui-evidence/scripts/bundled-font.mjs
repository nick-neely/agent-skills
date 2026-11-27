import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Pack-hosted installs transport text files only. Verify the decoded bytes so
// a truncated payload fails before any renderer uses it.
const encodedFont = new URL("../assets/DejaVuSans.ttf.base64.txt", import.meta.url);
const fontHash = "58568c88a01b80dfc056daca3eeafd434a0380df1a48dda53f0de0d716109bbd";

export function readBundledFont() {
  let text;
  try {
    text = readFileSync(encodedFont, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") throw new Error("bundled font missing from the skill");
    throw error;
  }
  const font = Buffer.from(text, "base64");
  if (createHash("sha256").update(font).digest("hex") !== fontHash) {
    throw new Error("bundled font failed its integrity check");
  }
  return font;
}

export function writeBundledFont(directory) {
  const path = join(directory, "DejaVuSans.ttf");
  writeFileSync(path, readBundledFont());
  return path;
}
