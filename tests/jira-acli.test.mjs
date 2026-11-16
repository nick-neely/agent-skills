import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

test('Jira conversion, backups, description replacement, and link behavior', () => {
  const result = spawnSync('python3', ['-I', fileURLToPath(new URL('./jira-acli.py', import.meta.url))], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);
});
