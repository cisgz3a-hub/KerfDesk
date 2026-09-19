# Windows installer qualification

The credential-free **Desktop Packaging Dry Run** workflow accepts an optional
`qualify_installer` input. It builds two unsigned versions from the same source
commit, then exercises the actual per-user NSIS installer on a disposable
GitHub-hosted Windows VM. It does not publish a desktop release or update feed.

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

The external harness uses loopback CDP for renderer interaction and Windows
UIAutomation for native file dialogs. It does not enable the application's smoke
mode, replace file picker APIs, simulate file writes or issue machine commands.
Missing CDP access, a noninteractive runner desktop or native-dialog failure
fails qualification; it must not be reported as a product pass.

`qualification.json`, phase receipts, screenshots, process logs and persisted
project evidence are uploaded even when a test fails. The receipt identifies
the source SHA, actual candidate hashes, versions, runner OS, elevation and each
completed transition. Review those artifacts before claiming a result.

This is an unsigned **manual installer** upgrade between versions of the same
source. Signed automatic updates, historical schema/profile migration, standard
user UAC, SmartScreen, consumer Windows versions, accessibility, macOS and
hardware qualification still require separate evidence. A green runner result
does not authorize a public desktop release.

Primary references: [GitHub-hosted VM lifecycle](https://docs.github.com/en/actions/concepts/runners/github-hosted-runners)
and [electron-builder NSIS configuration](https://www.electron.build/v26/docs/nsis/).
The uninstall harness follows NSIS's [exit-code capture recipe](https://nsis.sourceforge.io/Docs/AppendixD.html#D.1)
and [command-line argument rules](https://nsis.sourceforge.io/Docs/Chapter3.html#3.2.2).
