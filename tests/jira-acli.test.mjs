import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repo = fileURLToPath(new URL('..', import.meta.url));

test('Jira conversion, backups, description replacement, and link behavior', (t) => {
  // Run from a copy laid out like the repo so any bytecode it writes is visible
  // here: validate rejects the absolute paths that .pyc files embed.
  const root = mkdtempSync(join(tmpdir(), 'jira-acli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  cpSync(join(repo, 'tests', 'jira-acli.py'), join(root, 'tests', 'jira-acli.py'));
  cpSync(join(repo, 'skills', 'jira-acli', 'scripts'), join(root, 'skills', 'jira-acli', 'scripts'), {
    recursive: true,
    filter: (source) => basename(source) !== '__pycache__' && !source.endsWith('.pyc'),
  });

  const result = spawnSync('python3', ['-I', join(root, 'tests', 'jira-acli.py')], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`);

  const bytecode = readdirSync(join(root, 'skills'), { recursive: true })
    .filter((entry) => entry.includes('__pycache__') || entry.endsWith('.pyc'));
  assert.deepEqual(bytecode, [], 'the test left bytecode beside the skill scripts');
});
