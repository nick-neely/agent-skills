import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// This fallback matches the version exercised by the native compatibility CI.
export const npxPackage = 'agent-browser@0.41.1';

// npm must not resolve a bin or package.json from the application under test.
// A package boundary also prevents walking up to another temporary project.
export function withNpxDirectory(run) {
  const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), 'uat-npx-')));
  try {
    writeFileSync(join(cwd, 'package.json'), '{"name":"uat-browser-runtime","private":true}\n', { flag: 'wx', mode: 0o600 });
    return run(cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
