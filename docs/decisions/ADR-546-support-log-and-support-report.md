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

### Amendment 2 (2026-10-22): controller passwords and sign-ins stay out

Rolling audit v2 finding 27-P2-3 found that the report copied grblHAL's Wi-Fi, access point and
MQTT passwords from `$$`, under a header that said it held no password. grblHAL prints a
`Format_Password` setting's stored value unless its WebUI is connected (core `settings.c`
`setting_get_value`), and its ESP32 driver registers `$75`, `$77` and `$533` that way. Core
`settings.h` also numbers the WebUI admin and user passwords `$330` and `$331`. FluidNC names its
passwords `$Sta/Password` and `$AP/Password`, also set with `[ESP101]` and `[ESP106]`.

Item 2 now covers these. `support-report-redaction.ts` runs before cell escaping and again over the
whole report, as the licence-key rule did, so the `$$` rows, console lines, incident text,
problems and desktop log are all covered. It removes:

- the value of grblHAL `$75`, `$77`, `$330`, `$331` and `$533`, of any `$…Password` setting, and
  of `[ESP101]` and `[ESP106]`, each to the end of its line;
- the sign-in written into an address, such as a camera's `rtsp://user:pass@host`;
- `Bearer` tokens, and the value of a key=value or JSON field whose name ends in password, passwd,
  pwd, token, secret or API key.

The setting codes stay, so support still sees which settings exist. A second pass leaves a value
already removed alone, so an escaped incident cell keeps the text after its line break. The header
no longer promises "no password". It says KerfDesk removed licence keys and the passwords and
sign-ins it recognises, that the report holds no payment details, and still asks the customer to
read the file before sending it.

### Amendment 3 (2026-10-27): the crash screen keeps the safety notice and reports its Abort

Rolling audit v5 finding J2-P2-3 found that after a workspace render crash no machine-safety notice
showed. The link-lost and failed-stop notices float over the canvas (ADR-634), and the crash took
the canvas with them. The crash screen's ABORT caught its own failure and dropped it, so a refused
Abort changed nothing on screen. Rolling v4 finding H2-P3-1 found that a crash-screen host that
threw went past its boundary: to the root boundary, which unmounts the job protections, or with
none left, to a blank window.

1. **The crash screen shows the safety notice** (`SafetyNoticeBanner`) beside the close notice, the
   Save dialog and toasts, under both the root and the workspace boundary. Acknowledge and Reset
   work there. Reconnect does not: it needs the workspace's platform and recovery card, and the
   root boundary sits outside both.
2. **ABORT shows its own failure** under the crash screen's buttons: "ABORT failed: <reason>. Use
   the physical E-stop or power cutoff now if the machine may still be moving or the laser on." It
   stays offered, so pressing it again is the retry, and a success clears the message. The click
   still calls the stop at once, so it is written before anything else runs.
3. **Each crash-screen host has its own boundary** (`CrashHostBoundary`), and the crash screen
   wraps the hosts it is given in one more. A host that throws renders nothing and is kept for
   Save Support Report as a crash; the crash screen and the other hosts stay.
4. ABORT also appears for a laser the controller reports on at Idle, and sends `M5` for it
   (ADR-375 Amendment 9).

`src/ui/app/App.crash-safety-notice.test.tsx` checks all four on the real App and stores, and
`src/ui/common/ErrorBoundary.test.tsx` checks a refusal thrown before any write and a host that
throws.

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
