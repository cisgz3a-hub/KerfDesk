## ADR-545 Amendment 1 - A copy already installed for everyone is updated where it is (2026-09-29)

**Status:** Accepted. Compiled with makensis; not yet run on Windows. | **Date:** 2026-09-29 |
**Amends:** ADR-545

### Context

ADR-545 forced every assisted install to the current user. Earlier KerfDesk installers offered
"Anyone who uses this computer", so some computers have KerfDesk in Program Files with its entry
under `HKLM`. A re-audit before the desktop app merged found that the forced mode ignored such a
copy: running a new installer by hand put a second KerfDesk under `%LOCALAPPDATA%\Programs` and
left the Program Files copy, and its Start menu entry and uninstall record, on the old version.
Both copies share one data folder, and the old copy keeps looking for updates.

electron-builder already finds existing installs before its install-mode page
(`initMultiUser` in `templates/nsis/assistedInstaller.nsh` reads `InstallLocation` from `HKLM`
and `HKCU`). A silent update, such as an update installed on quit, never shows the page, so it
already updates an all-users copy where it is.

### Decision

1. `customInstallMode` in `scripts/nsis-file-associations.nsh` asks for the all-users mode when
   there is an all-users copy and no copy for this user. electron-builder then asks for
   administrator approval, as the original install did, and updates that copy in place.
   Otherwise, including a computer with both copies, it installs for the current user as before.
2. The uninstaller no longer forces a mode. electron-builder removes the one copy there is, and
   asks which to remove when there are both, where ADR-545 always chose this user's copy.

### Consequences

- Updating an all-users copy by hand needs administrator approval, as it always did. New installs
  never offer that mode.
- `electron/desktop-install-mode.test.ts` pins the hook and the builder code it relies on: the
  registry reads before the page, the all-users check before the current-user one, and the
  uninstaller's own choice. The hook compiles in both the installer and the uninstaller with
  makensis 3.09. Running it on Windows over an all-users copy remains the proof, in the Windows
  package check by hand (ADR-522 Amendment 1).
- This changes no machine output and nothing a licence gates.
