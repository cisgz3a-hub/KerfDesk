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

### Amendment 1 (2026-10-07): retained controller incident evidence

The report also includes this window's bounded retained controller incidents under a separate
heading, newest last, independently of the existing last 100 console lines. Each entry keeps its
original ID, timestamp, direction, source, wire kind, raw and decoded text. Its **event-time
context** is separately labelled from the current Machine section: build, selected/detected
controller and command set, session/connection/baud/USB facts, qualification, bounded firmware
lines, last observed status/positions, and bounded run identity/progress/ACK/transport counts.
Connecting incidents' baud and USB facts describe the owned open attempt. Store writes and
current-epoch job refill writes are counted separately. The allowlist includes no project,
artwork, complete executable program, account information or private port path.

Capture uses immutable bounded copies before teardown; reconnect and asynchronous log reads
cannot rewrite earlier event facts. Entries without captured context say so rather than borrowing
current machine facts. Delimiters in raw/decoded/context text are escaped for the report. Licence
keys are redacted before cell escaping, then the complete report is redacted again, preserving
keys adjacent to escaped tabs/newlines. Saving is read-only: it does not clear history, acknowledge
SafetyNotice or issue machine commands. The picker remains first and cancellation gathers nothing.
The history is window-local, retained through Disconnect/Forget/reconnect, capped at 500, and
explicitly clearable under ADR-229. No persistence across reload or automatic upload is added.

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
