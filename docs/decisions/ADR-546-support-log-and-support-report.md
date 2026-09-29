## ADR-546 - A local support log and Help > Save Support Report (2026-09-29)

**Status:** Accepted | **Date:** 2026-09-29

### Context

The desktop gap audit of 2026-09-29 found that a customer had nothing useful to
send when something went wrong. The packaged desktop app has no console, so the
main process's warnings and every window's console errors were lost. The support
page asked customers to type their version, operating system, machine and
controller by hand. Most "it's still broken" reports so far could not be settled
until the owner's build, machine state and console were known.

KerfDesk has no telemetry and uploads nothing on its own (PROJECT.md "External
services"), and the desktop privacy notice promises that the only thing the app
sends is its licence check. The fix has to stay inside that.

### Decision

1. **The desktop app keeps a local log.** `electron/support-log.ts` writes
   `<userData>/logs/kerfdesk.log` (on Windows `%APPDATA%\laserforge\logs`) and
   keeps one older file, `kerfdesk.1.log`, rotating at 1 MiB. It records a startup
   line (version, build kind, operating system, Electron, Chrome and Node), the
   main process's console, its uncaught exceptions, every window's console
   warnings and errors, windows that fail to load, stop responding or end, child
   processes that end, and the quit. Observing never changes behaviour: it uses
   `uncaughtExceptionMonitor`, not a handler, and every file error is swallowed.
   A repeated line is folded into a count, and more than 200 lines a minute are
   left out with a note, so an error loop cannot push everything else out. Only
   the primary instance writes; a second launch that hands a file over does not.
2. **Nothing secret goes in.** Licence keys (`KD1.<id>.<secret>`) are replaced
   before a line is written, and the account's home folder is written as `~`, in
   either slash style and any case. The report applies the key rule again.
3. **The report is a file the customer sends.** Help > Save Support Report asks
   where to save a `.txt` file, then writes: the version, commit and build time;
   web or desktop app; the edition in the Licence panel's words (never the key or
   payment order); the browser, languages, screen and online state; the machine
   profile, connection, controller check, state, alarm, last error, positions,
   work origin, homing and `$I` firmware lines; the `$$` settings last read; the
   last 100 machine console lines; the window's last 50 uncaught errors,
   unhandled rejections and crashes; and in the desktop app the newest 256 KiB of
   the log. The customer reads it and attaches it themselves. Nothing is uploaded.
4. **Only the app's own window can read the log.** The main process serves it at
   `app://app/api/support/log` to a same-origin `GET` carrying
   `X-KerfDesk-Support: 1`, with the licensing routes' checks
   (`electron/support-routes.ts`). The renderer reaches it through the optional
   `PlatformAdapter.readSupportLog`, which only the desktop adapter has.
5. **The file picker opens first.** The report is gathered after the save
   location is chosen, so the browser still sees the menu click as the gesture
   that opened the picker.

### Consequences

- The support page tells customers to attach the report, which covers most of
  what it asked them to type.
- The packaged native smoke fails unless the installed app recorded its own
  launch in the smoke profile's log, so a broken log shows up in the Linux
  package check on every pull request.
- The web app keeps no log; its report has the window's problems, the machine
  state and the console only.
- A report can include file names from error messages and the machine console.
  The report's first lines ask the customer to read it and remove anything they
  would rather not share.
- The privacy notice says the log exists and never leaves the computer unless
  the customer sends it.
- This decision operates no machine and changes no output.
