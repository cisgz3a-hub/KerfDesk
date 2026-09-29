## ADR-555 - The installer and uninstaller never close a running KerfDesk (2026-09-29)

**Status:** Accepted. Built into a Windows installer with makensis on Linux; not yet run on
Windows. | **Date:** 2026-09-29 |
**Builds on:** ADR-545 (the assisted per-user installer), ADR-548 (a job cut off mid-stream)

### Context

The desktop gap audit of 2026-09-29 (B7) found that electron-builder's own "is the app running"
check, which every KerfDesk installer and uninstaller runs, ends a running KerfDesk. A hand-run
installer shows "KerfDesk is running. Click OK to close it", with OK as the default and as the
automatic answer of a silent install, and then ends the process with `Stop-Process`, or
`taskkill` followed by `taskkill /F` a second later. That skips the job's Abort handoff and the
unsaved-changes question (ADR-549). ADR-548 records what a stream cut off mid-job can do: the
controller runs its buffered moves, and a spindle or a constant-power laser can stay on.

The risky cases are a new version downloaded from kerfdesk.com, the commercial installer run over
a Preview, a repair, and an uninstall, each while a job runs. An update at quit is not one of
them: KerfDesk starts the updater only after its close guard ran, so the app is already on its
way out.

### Decision

`scripts/nsis-file-associations.nsh`, which every KerfDesk installer includes, defines
`customCheckAppRunning`. electron-builder then uses it in place of its own check in both the
installer and the uninstaller. It only looks for a running KerfDesk (electron-builder's read-only
`FIND_PROCESS`) and never ends one:

1. **An update at quit waits.** With `--updated`, it checks once a second for up to a minute for
   KerfDesk to finish closing. If it is still open, the installer stops with error level 1 and
   the update is tried again the next time KerfDesk closes.
2. **Anything else asks.** A hand-run installer or uninstaller shows Retry or Cancel: "KerfDesk is
   open. Close it yourself first: closing KerfDesk stops a running job and asks about unsaved
   work. Then click Retry." Cancel stops with error level 1. A silent or managed install answers
   Cancel, so it fails rather than closing KerfDesk.

### Consequences

- An installer can no longer end a job, and a managed deployment sees a failed install instead of
  a closed app.
- Installing over an idle KerfDesk takes one more step: the operator closes it.
- A hung KerfDesk that never finishes closing leaves the update waiting; closing it (or Task
  Manager, the operator's choice) lets the next close install it.

### Tests

`electron/desktop-installer-running-app.test.ts` pins the hook (no process ending, Retry/Cancel
with a Cancel silent answer, the bounded update wait and the error levels) and checks that the
installed electron-builder uses `customCheckAppRunning` in place of its own check, with the
helpers the hook uses still defined. On 2026-09-29 the Windows installer and uninstaller were
built with electron-builder 26.16.1 and makensis (warnings as errors) on Linux; a deliberately
invalid line in the hook failed that build inside `CHECK_APP_RUNNING`, so the hook is compiled
into both. Running it on Windows is still to do: add a "KerfDesk running" case to
`scripts/qualify-windows-installer.ps1` when the Windows lane next runs.
