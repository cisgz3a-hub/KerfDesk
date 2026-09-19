# Windows installer qualification

The credential-free **Desktop Packaging Dry Run** workflow accepts an optional
`qualify_installer` input. It builds two unsigned versions from the same source
commit, then exercises the actual per-user NSIS installer on a disposable
GitHub-hosted Windows VM. It does not publish a desktop release or update feed.
The installer exercise runs before the full release check for earlier native
failure feedback; both must pass for the workflow to succeed. Ordinary packaging
dry runs retain their existing verification-before-packaging order.

Candidates use the existing `electron-builder.yml` Windows NSIS configuration
with signing disabled, preview channel metadata and updater trust disabled.
They are separate test binaries from the `electron-builder.preview.yml` output;
results apply to the recorded candidate hashes, not a different preview build.

The runner must have no existing KerfDesk/LaserForge registration, profile,
shortcuts or processes. Installers and evidence stay in the checkout; installed
files and project fixtures stay in a new directory under `RUNNER_TEMP`. The
application uses its normal `%APPDATA%\laserforge` profile on that disposable VM.
The script refuses local and self-hosted execution because an NSIS install with
the same app identity can replace an existing installation even with a custom
destination directory.

The qualification checks these transitions:

1. Install N into a custom directory containing spaces. Verify per-user registry
   version, app identity, shortcuts and equality of installed/packaged ASAR bytes.
2. Launch the installed executable normally. Import a known SVG through a real
   Windows file dialog and save a `.lf2` project through a real Save As dialog.
   Read the resulting disk bytes and verify geometry, source and project schema.
3. Restart N, reopen the saved file and save a second copy. Compare persisted
   scene, workspace and job setup.
4. Install N+1 over N. Verify the new package/version, saved project and profile
   marker, then repeat the actual reopen/save test.
5. Reinstall N+1 and repeat persistence checks.
6. Uninstall, verify files/registration/shortcuts are removed and user data is
   retained, then reinstall and reopen the retained project. Finally uninstall
   again and retain project/profile evidence.

The external harness uses loopback CDP for renderer interaction and bounded
Windows control messages for native file dialogs. It does not enable the application's smoke
mode, replace file picker APIs, simulate file writes or issue machine commands.
Missing CDP access, a noninteractive runner desktop or native-dialog failure
fails qualification; it must not be reported as a product pass.

`qualification.json`, phase receipts, screenshots, process logs and persisted
project evidence are uploaded even when a test fails. The receipt identifies
the source SHA, actual candidate hashes, versions, runner OS, elevation and each
completed transition. Review those artifacts before claiming a result.

The harness also records both native-helper and renderer-click outcomes, trusted
click/user-activation evidence and transient notification text. A dialog timeout
must not hide an independently failed click or an already-dismissed app error.
Windows common dialogs may run in a Chromium utility child. The helper admits
only the launched app and descendants with the same installed executable,
desktop session and valid creation-time ancestry. It rechecks process and
owner-window ancestry before changing a filename or confirming a dialog, and
refuses multiple matching dialogs. The [shipped Windows chooser factory](https://github.com/chromium/chromium/blob/148.0.7778.280/chrome/browser/win/chrome_select_file_dialog_factory.cc)
passes the app's owner window to a separate utility service.

Some runner UI Automation providers expose the filename edit and accept button
as generic panes. The helper therefore enumerates native child handles only
inside that verified dialog. It requires one visible, enabled `Edit` inside the
filename combo (native ID 1148) and one `Button` with native ID 1. Process, parent,
class and control identity are revalidated before each action; the filename is
read back exactly before accepting. [Windows message timeouts](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendmessagetimeoutw)
bound each call. A returned message alone never proves success: the dialog must
close and the renderer/disk assertions must independently pass.

Electron 42 checks existing File System Access grants with a null frame and
WebContents. The permission policy therefore accepts the exact `fileSystem`
check for a trusted requesting/embedding origin when no window is supplied.
An existing empty or untrusted window URL still fails, as do all other
permissions without a window. Main-frame request rules remain unchanged.
This matches the [shipped Electron implementation](https://github.com/electron/electron/blob/v42.11.5/shell/browser/file_system_access/file_system_access_permission_context.cc)
and preserves the origin checks without rejecting legitimate file grants.

This is an unsigned **manual installer** upgrade between versions of the same
source. Signed automatic updates, historical schema/profile migration, standard
user UAC, SmartScreen, consumer Windows versions, accessibility, macOS and
hardware qualification still require separate evidence. A green runner result
does not authorize a public desktop release.

Primary references: [GitHub-hosted VM lifecycle](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners)
and [electron-builder NSIS configuration](https://www.electron.build/v26/docs/nsis/).
The uninstall harness follows NSIS's [exit-code capture recipe](https://nsis.sourceforge.io/Docs/AppendixD.html#D.1)
and [command-line argument rules](https://nsis.sourceforge.io/Docs/Chapter3.html#3.2.2).
