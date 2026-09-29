## ADR-545 - The Windows installer always installs for the current user (2026-09-29)

**Status:** Accepted | **Date:** 2026-09-29

### Context

`electron-builder.yml` and `electron-builder.preview.yml` use the assisted NSIS
installer (`oneClick: false`, `perMachine: false`). With those settings
electron-builder shows an install-mode page offering "Only for me" or "Anyone who
uses this computer". Every qualification so far (the pilot checklist, the Windows
package check and the installed-app scripts) covers the per-user install. A
per-machine install puts KerfDesk in Program Files, where the install-on-quit
update (ADR-523) needs administrator approval that shop accounts often lack. The
desktop gap audit of 2026-09-29 flagged the untested choice before selling.

### Decision

The shared NSIS hook `scripts/nsis-file-associations.nsh` defines
`customInstallMode` and sets `$isForceCurrentInstall` to `1`. electron-builder
runs that macro before its install-mode page, then installs per user and skips
the page. Both the Preview and the commercial builds use the hook.

### Consequences

- Each Windows account that wants KerfDesk installs it for itself. A licence is
  bound to the Windows installation (ADR-523), so two accounts on one computer
  still use one of the licence's three devices.
- Updates install on quit without an administrator prompt.
- `electron/desktop-install-mode.test.ts` pins the hook, the builder settings and
  the installed electron-builder template that calls the hook. NSIS matches macro
  names without regard to case, so the template's `!ifmacrodef customInstallmode`
  finds `customInstallMode`; this was checked with makensis 3.09 on a stub script.
  Installing on Windows remains the proof: run the Windows package check by hand
  (ADR-522 Amendment 1) before merging.
- This decision operates no machine and changes no output.
