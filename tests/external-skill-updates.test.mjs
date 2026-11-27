import assert from "node:assert/strict";
import test from "node:test";
import { releaseInputs } from "../scripts/update-external-skills.mjs";

test("external pins follow changes to the packaged skill tree and licenses", () => {
  const snapshot = {
    truncated: false,
    tree: [
      { path: "skills/helper", type: "tree", sha: "skill" },
      { path: "skills/helper/SKILL.md", type: "blob", sha: "instructions" },
      { path: "LICENSE", type: "blob", sha: "license" },
      { path: "README.md", type: "blob", sha: "readme" },
      { path: "skills/LICENSE", type: "blob", sha: "collection" },
    ],
  };
  const original = releaseInputs(snapshot, "skills/helper");
  snapshot.tree[3].sha = "unrelated";
  assert.deepEqual(releaseInputs(snapshot, "skills/helper"), original);
  snapshot.tree[2].sha = "license-change";
  assert.notDeepEqual(releaseInputs(snapshot, "skills/helper"), original);
  snapshot.tree[2].sha = "license";
  snapshot.tree[4].sha = "collection-change";
  assert.notDeepEqual(releaseInputs(snapshot, "skills/helper"), original);
  snapshot.tree[4].sha = "collection";
  snapshot.tree[0].sha = "skill-change";
  assert.notDeepEqual(releaseInputs(snapshot, "skills/helper"), original);
  assert.throws(() => releaseInputs(snapshot, "skills/renamed"), /Missing upstream/);
  assert.throws(() => releaseInputs({ ...snapshot, truncated: true }, "skills/helper"), /incomplete/);
});
