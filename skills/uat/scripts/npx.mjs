import { spawnSync } from 'node:child_process';
import { lstatSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// This fallback matches the version exercised by the native compatibility CI.
export const npxPackage = 'agent-browser@0.41.1';

// npm must not resolve a bin or package.json from the application under test.
// A package boundary also prevents walking up to another temporary project.
export function withNpxDirectory(run, { platform = process.platform, remove = rmSync } = {}) {
  const cwd = realpathSync.native(mkdtempSync(join(tmpdir(), 'uat-npx-')));
  try {
    writeFileSync(join(cwd, 'package.json'), '{"name":"uat-browser-runtime","private":true}\n', { flag: 'wx', mode: 0o600 });
    return run(cwd);
  } finally {
    // Windows can reject removing a locked cwd before recursive rm visits its
    // children. Scrub them explicitly before attempting the directory itself.
    for (const name of readdirSync(cwd)) remove(join(cwd, name), { recursive: true, force: true });
    try {
      remove(cwd, { recursive: true, force: true });
    } catch (error) {
      // A Windows daemon inherits this cwd and locks the directory until close.
      // Only an empty directory may remain; never hide files or other failures.
      if (platform !== 'win32' || !['EPERM', 'EBUSY'].includes(error.code)
        || !lstatSync(cwd).isDirectory() || readdirSync(cwd).length !== 0) throw error;
    }
  }
}

const usage = 'Usage: node npx.mjs --version | install [--with-deps]';

// Only fixed bootstrap commands enter cmd.exe on Windows.
export function main(args = process.argv.slice(2), {
  platform = process.platform, spawn = spawnSync,
  stdout = (text) => process.stdout.write(text), stderr = (text) => process.stderr.write(text),
} = {}) {
  if (args.length === 1 && args[0] === '--help') {
    stdout(`${usage}\n`);
    return 0;
  }
  const allowed = (args.length === 1 && ['--version', 'install'].includes(args[0]))
    || (args.length === 2 && args[0] === 'install' && args[1] === '--with-deps');
  if (!allowed) {
    stderr(`${usage}\n`);
    return 2;
  }
  const npxArgs = ['--yes', `--package=${npxPackage}`, 'agent-browser', ...args];
  const command = platform === 'win32' ? 'cmd.exe' : 'npx';
  const argv = platform === 'win32'
    ? ['/d', '/s', '/c', `"npx ${npxArgs.join(' ')}"`]
    : npxArgs;
  try {
    const result = withNpxDirectory((cwd) => spawn(command, argv, {
      cwd, stdio: 'inherit', windowsHide: true,
      ...(platform === 'win32' ? { windowsVerbatimArguments: true } : {}),
    }));
    if (result.error) {
      stderr(`could not run ${command}: ${result.error.message}\n`);
      return 1;
    }
    return result.status ?? 1;
  } catch (error) {
    stderr(`could not run npx: ${error.message}\n`);
    return 1;
  }
}

function isEntryPoint(entry) {
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint(process.argv[1])) process.exitCode = main();
