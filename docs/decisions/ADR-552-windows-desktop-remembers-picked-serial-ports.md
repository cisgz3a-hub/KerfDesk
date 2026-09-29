## ADR-552 - The Windows desktop app remembers the serial ports the operator picked (2026-09-29)

**Status:** Accepted. Unit-tested and checked against the Electron 44.4.5 source; not yet tried
on Windows with a machine attached. | **Date:** 2026-09-29 | **Amends:** ADR-366 decision 1 on
Windows, and ADR-420's desktop consequence

### Context

The desktop gap audit of 2026-09-29 (item 7) found that after every start the desktop app shows
the port list again, so **Connect automatically** (ADR-420) cannot connect when KerfDesk opens,
although it does in Chrome. Chrome keeps a Web Serial pick across restarts, on Windows matched by
the port's device instance ID. The desktop app kept picks in Electron's memory only, because
ADR-366 removed the device permission handler that had granted every attached adapter. ADR-420
left lifting this "for a decision that amends ADR-366", and the desktop audit of 2026-09-27 (D1)
proposed it.

The Electron 44.4.5 source (`shell/browser/serial/serial_chooser_context.cc`,
`shell/browser/electron_permission_manager.cc`) confirms ADR-366's reading and adds what a
handler must do:

- For a port Electron can remember (on Windows, one with a display name and a device instance
  ID), both the picker's grant and every later permission check go through the permission
  manager. With a device permission handler installed, the grant is dropped and the check asks
  the handler, passing `{ name, device_instance_id }`.
- A port it cannot remember is kept in a per-run list that never reaches the handler.
- `port.forget()` still emits the session's `serial-port-revoked` event with the port, which
  Electron documents for keeping handler-backed grants.

### Decision

1. **On Windows, main records each pick and grants only those.** When the operator picks a port in
   the Select dialog, main records its device instance ID before Chromium hears the answer, and
   saves it in `serial-port-grants.json` in the app's data folder. The device permission handler
   says yes only to a serial check from the trusted renderer origin for a port in that record.
   HID and USB checks, other origins and every other port get no. A Bluetooth port Chromium
   enumerates itself has no device instance ID; its pick is granted by its address for the run
   only, as before.
2. **Forget Controller removes the port.** The `serial-port-revoked` event deletes the port from
   the record and the file.
3. **The record is bounded.** It keeps the 16 most recent picks and reads only an exact,
   current-format file of at most 64 KiB; anything else remembers nothing. It is read once before
   the window loads, so the first **Connect automatically** at start can see the ports.
4. **The dialog preselects the port picked last** when it is in the list.
5. **macOS and Linux are unchanged.** There is no handler, so Electron keeps each pick for the run
   (ADR-366). The renderer learns which rule applies from the platform adapter's
   `serial.picksEndOnRestart`, set from the user agent, and the Connect tooltips and the Machine
   setup tutorial say so.

ADR-354's rules are unchanged: exactly one VID/PID match in both the window and the worker, a
second check before open, the exact picked window port as the fallback, and never a second
owner.

### Consequences

- On Windows a machine set up once connects when KerfDesk opens and when it is plugged in, as in
  Chrome. Moving a CH340 to another USB socket changes its device instance ID, so that adapter is
  picked once more, as in Chrome.
- Picks of two identical adapters now persist until Forget Controller. While both are attached,
  Connect shows the picker (ADR-420 rule 1) and background streaming uses the window port
  (ADR-354), which keeps sending while the desktop window is minimised.
- A compromised page still cannot reach a port the operator never picked, since the picker needs
  the operator and the handler answers only from those picks.

### Tests

`electron/serial-port-grants.test.ts` covers the record: an identical twin is not granted, IDs
match without regard to case, Forget, the 16-pick bound, Bluetooth for the run, the file format
and the ordered writes. `electron/desktop-serial-ports.test.ts` drives the Select dialog through
a fake session: no handler off Windows, only the picked port granted on Windows, nothing on
Cancel, a pick kept across a restart until Forget, and the preselected port.
`electron/trusted-renderer-policy.test.ts` pins that main installs no handler of its own, and
`src/platform/electron/desktop-serial.test.ts` covers the renderer's flag.
