# Repair browser setup

Read when `check-setup.mjs` reports `ready: false` or a launch reports a missing browser. Supported hosts: macOS, Linux, WSL and native Windows. Repair only what is missing, keep working tool versions, and use existing authorization and organization policy; the operator supplies only interactive login, missing privilege or an unresolved policy decision.

## Identify the host

Use the shell and OS where the agent actually runs. WSL is the Linux branch with Linux tools and the WSL home; native Windows uses Windows tools and the Windows home. Keep the two toolchains apart: no Windows `node.exe` or `npm.cmd` with Linux paths, no Windows installs as a WSL repair. If the reported platform conflicts with the session, inspect the shell.

The checker probes only agent-browser, its bundled core reference and, when agent-browser is missing, npm. It installs nothing and launches no browser, so rerun it after repairs. If agent-browser exists outside PATH, fix command discovery rather than installing a second copy.

## Node and npm

Node is required: the skill's scripts (`check-setup.mjs`, `new-run.mjs`, `browser.mjs`) run on it, even when agent-browser itself is a native install. For a new npm install of agent-browser, check the package's `engines.node`; the researched current release needs Node 24+, and an approved pinned release may differ. A working native agent-browser needs no Node upgrade beyond what the scripts need (any current LTS). Install through the existing approved runtime manager or package manager (an existing Homebrew or WinGet is fine) or the [official Node download](https://nodejs.org/en/download): native Node on Windows, Linux Node inside WSL. If Node is missing and no authorized install path exists, report that blocker and continue discovery.

## agent-browser

Install only if missing, using the team's approved version if one is specified:

```text
npm install --global agent-browser
```

If the global install fails on permissions, use a user-owned prefix instead of sudo:

- macOS, Linux, WSL: `npm install --global --prefix "$HOME/.local" agent-browser`; shims land in `$HOME/.local/bin`.
- PowerShell: `npm.cmd install --global --prefix "$HOME/.uat/npm" agent-browser`; shims land directly in `$HOME/.uat/npm`.

A PATH change in one tool call may not reach the next, so pass the needed PATH explicitly on each call until normal discovery works. In PowerShell, call `npm.cmd` and `agent-browser.cmd` explicitly if `.ps1` execution is blocked, leaving execution policy as it is.

## Browser by platform

Pick the branch before running any browser installer; the npm package does not imply Chrome for Testing is available on the host.

- **Linux/WSL x64:** `agent-browser install`; if browser libraries are missing, `agent-browser install --with-deps`, which may need sudo through the distro package manager (ask only for missing privilege). Keep the Chrome sandbox enabled.
- **Linux/WSL ARM64:** Chrome for Testing has no Linux ARM64 build, so skip the installer. Install an approved native Chromium package for the distro and add its absolute path to each run's `browser-config.json` as `"executablePath"` before the first launch; verify that browser launches.
- **macOS 13+:** `agent-browser install`. On older macOS, use an approved compatible existing browser executable or report the host constraint.
- **Native Windows:** `agent-browser install`. On ARM64 the x64 binary runs under emulation; verify an actual launch.

A version string is not readiness; a launch is. Keep other launch errors for diagnosis. `doctor` can delete stale session files even without `--fix`, so it is not a read-only check. Video tooling is optional; see [recording](evidence.md#record-an-interactive-reproduction).

## Visible window for sign-in

A headed browser is not necessarily visible to a person. On WSL and Linux, confirm a working desktop, WSLg or display before asking the operator to sign in ([WSLg requirements](https://learn.microsoft.com/en-us/windows/wsl/tutorials/gui-apps)). On a headless-only host, use an existing approved authentication method or ask for that specific interactive-access decision; personal profiles and remote debugging stay off the table.
