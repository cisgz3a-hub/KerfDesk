## ADR-420 - Connect reuses the remembered port, and Machine Setup opens with Find my machine (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

Maintainer direction, 2026-09-26, with a screenshot of Machine Setup step 1: the setup "still
feels difficult and weird to navigate and handle. Even the connect button is weird", and it
should be redesigned "with auto assign and detect too".

This amends ADR-205 (detection never applies itself; the controller is chosen before connecting)
for a machine that has not been set up yet and for an explicit Find, and ADR-347 (the automatic
lane is folded into the Find card). ADR-240 #2 is unchanged: generic `$$` values never establish
hardware identity, so no catalog profile is picked automatically. ADR-366 is unchanged: the
desktop app still grants only the picked port, for the run. No new guard is added (ADR-228).

### Context

Eight senders and setup flows were compared (LightBurn Find My Laser, gSender, Carbide Motion,
UGS, xTool Creative Space, Snapmaker Luban, OpenBuilds CONTROL, CNCjs), with sources, in the
research page linked from the pull request. The patterns they share, and what KerfDesk did:

| Pattern | Others | KerfDesk before |
|---|---|---|
| Remember the last port and connect without asking | LightBurn, gSender (opt-in), CNCjs (on by default), UGS | Every Connect opened the browser picker |
| One primary connect button whose label is the state | gSender, Carbide Motion, xTool | `Connect…` beside a status dot, the profile in a separate block, Forget beside Disconnect |
| Detect the firmware and fill the setup from it | gSender dropped its firmware picker in 1.5.0 after users chose wrong; LightBurn pre-fills the device | Controller chosen first; detected values sat behind `Use detected values` |
| Recover from a silent port | LightBurn excludes Marlin for its baud; OpenBuilds escalates resets | A silent port read "No controller response was received at X baud", and nothing else |

KerfDesk already did most of the reading: connecting runs the handshake (banner, `$I`, `$$`,
`$G`), maps `$$` into a `Partial<DeviceProfile>`, and names the firmware from the banner. The
friction was that setup asked the operator to choose everything before connecting, then showed
the answer in a separate lane and a separate disclosure.

Platform limits that shape the design:

- `navigator.serial.getPorts()` returns granted, attached ports without a user gesture, and
  `open()` on them needs none. `requestPort()` needs a gesture.
- Chrome keeps a grant across restarts on Windows (device instance ID), and on macOS and Linux only
  for adapters with a USB serial number. A CH340 (most diode lasers) has none, so there it must be
  picked again after a replug or restart.
- `connect` and `disconnect` fire only for ports the origin already has permission for.
- `getInfo()` gives USB vendor and product IDs only; no port name or serial number.
- The desktop app installs no device permission handler (ADR-366), so a pick lasts for the run.

### Decision

1. **Connect reuses the remembered port.** A successful connect stores the port's USB vendor and
   product ID in local storage. The next Connect lists granted ports and opens, without the picker,
   the single attached one that matches; with nothing remembered it opens a lone granted port.
   Two matches, none, or a different adapter show the picker. **Use a different port…** always
   shows it. **Forget Controller** also forgets the remembered port.
2. **Connect automatically, on by default.** At start and on each granted-port `connect` or
   `disconnect` event, KerfDesk connects on its own when rule 1 picks a port without the picker. It
   never shows the picker, and never acts while connecting or connected, while a job, jog or
   controller operation is active, or for a file-only controller. The choice lives in the card's
   **⋯** menu and is remembered per browser.
3. **One connection card.** The rail's connection block becomes the **Machine connection** card:
   status, the machine profile it connects with (name, size, controller; the port's USB IDs and
   baud while connected), one button whose label is the state (**Connect**, **Connecting…**,
   **Disconnect**), and **Machine Setup**. Less frequent actions move to the **⋯** menu. A failed
   open that reads as a busy port says so and names the usual holders.
4. **Find my machine opens Machine Setup.** It is the first card on the Machine stage. It connects
   with the draft's controller contract and shows one heading per state: find, connecting,
   reading, found, didn't answer, couldn't connect, no answer at any common speed. When found it
   lists the reported travel, max speed, power range, laser mode and Z travel.
5. **Auto-fill for a new machine or after Find.** When the device has not been through setup in
   this browser, or the operator pressed **Find my machine**, the draft adopts, as ordinary draft
   actions: the firmware the banner named (only a serial firmware), the baud that answered, the
   machine type from `$32` (a Laser + CNC draft keeps both), and the mapped `$$` values. The card
   lists every change as old → new with one **Undo** that restores the draft it started from.
   Nothing reaches the project before **Save machine setup**. A machine already set up, for
   either head, that the operator only opens setup for keeps its values and keeps the explicit
   **Use detected values** (ADR-347), so opening setup never rewrites a finished machine.
   The reported max rate (`$110`/`$111`) is the machine's ceiling, and each head keeps its own
   Max feed (ADR-416), so the fill and **Use detected values** write it to each head the setup
   includes: the device profile's Max feed for a laser, `CncMachineParams.maxFeedMmPerMin` for
   CNC. A CNC-only setup leaves the laser's untouched. The change list names them **Laser max
   feed** and **CNC max feed** on a Laser + CNC machine. Frame speed is not reported, so it is
   not filled.
6. **Adopting a firmware reconnects once.** When auto-fill adopted a firmware different from the
   one the connection used, Find reconnects once with it, so the matching driver reads the
   controller, once per Find press. Find owns only the connection it opened: the laser store's
   `connectionAttempt` revision moves on every connect and intentional disconnect, before the
   first await, and Find's claim is the revision its own connect took. Any other connect or
   disconnect ends the claim, so a connection made elsewhere, before setup or after Find, is
   never dropped by setup and does not refill a finished machine by itself. A new machine's
   draft may adopt the firmware by itself on open or on such a connection, but that leaves the
   connection as it is and offers **Reconnect using selected profile**.
7. **Try other speeds.** When the port opened but nothing answered, **Try other speeds**
   reconnects at 115200, 230400, 250000, 921600, 57600, 38400, 19200 and 9600 baud in turn (the
   one already tried is skipped), waits up to 4 s for an answer at each, and stops at the first
   that answers. **Stop** ends it. It only listens and reads. Stop, a new scan, another
   connection action in setup, closing setup, or a connect or disconnect the scan did not make
   (auto-connect after a replug, even while the scan's own open is pending) each retire the
   running scan, which then closes nothing: the open connection is no longer the scan's. The
   scan owns a connection by the same `connectionAttempt` revision. A scan started from Find's
   own connection keeps Find's claim on each speed it opens.
8. **The catalog is not auto-picked.** `$130`/`$131` are the controller's travel limits, not the
   bed: a Creality Falcon A1 Pro reports 400 × 400 mm for a 358 × 268 mm bed. Detected matches stay
   prioritised with "Possible match" as the ceiling (ADR-240 #2).
9. **Connection options** (controller family, baud, output dialect, streaming, command contract)
   move under the Find card, closed unless the `connect` deep link opened setup. The old
   **Connect and detect** disclosure, **Set up automatically** lane and the footer's offline note
   are removed; **Set up without connecting** is a button on the Find card.

### Consequences

#### Amendment 1 - Make saving a selected profile visible (2026-09-27)

After auto-connect, choosing a profile changed only the setup draft, while the final Save was
hidden behind **Check essentials** and **Review setup**. The Machine stage now offers a primary
**Review & save** shortcut beside **Check essentials**, and the catalog explains the route.
The shortcut opens the existing Review stage; the final Save keeps its validation, atomic project
update and explicitly queued firmware-write behavior. The live connection stays in place.

#### Amendment 2 - Compact connection toolbar and anchored jog controls (2026-10-08)

The maintainer approved the compact top-bar preview: the connection group moves beside the
numeric transforms, and the jog controls occupy its former position at the top of the machine
rail. The toolbar keeps the machine name, status, Connect/Disconnect, Machine Setup and the
connection-options menu visible. Its machine-name dropdown contains the full profile, fitted
Laser module selector and supported FluidNC network connection form. Native Tab navigation
remains inside the form until focus leaves it; Escape returns focus to the machine name. Input
inside the dropdown does not dispatch workspace or machine shortcuts, except the existing Abort
shortcut. Connection failures, qualification notices and recovery remain visible outside that
dropdown. A narrow window wraps the connection group onto a second top row. Detected-settings
notifications belong to the always-mounted toolbar and remain active when the rail is collapsed.

The rail keeps its heading, existing jog controls and current status above an independently
scrolling lower tools region. The upper region can also scroll, retaining access to conditional
Focus/Z and recovery controls. If the measured machine body is at most 192 px high, one whole-rail
scroller replaces the two regions so the controls remain reachable. The existing Frame/Start
dock stays outside those scrollers. Connection actions, jog cancellation, ordinary workspace
shortcuts, qualification, output and the ADR-565 Frame/Start contract are unchanged.

#### Amendment 3 - Explicit first Connect opens Machine Setup (2026-10-09)

The maintainer requested that pressing Connect open Machine Setup for a machine
that has not been set up yet. Explicit toolbar, menu and network Connect actions
read the existing saved completion record for the current profile and selected
Laser/CNC head. An unfinished profile opens the global Machine stage immediately,
and the same click starts the normal connection with the current profile's
controller, baud and streaming options. Connection is not deferred to an effect
or to saving setup, so a USB port request retains the original user gesture.

Only Save machine setup records completion. Cancelling setup or cancelling or
failing a connection leaves the next explicit Connect eligible to open setup.
Saved completion survives restart and is separate for Laser and CNC; a different
profile, bed size or controller uses its own existing signature. The record is
logical profile history, not a physical USB serial identity. An already-open
setup draft is retained rather than replaced by another Connect action.
Opening first-time setup from the FluidNC details form dismisses that popover;
closing setup returns keyboard focus to its stable machine-name trigger.

Automatic connection, replug, recovery Reconnect and setup's Find continue using
their existing transport paths. They do not launch or reset a setup dialog. No
controller setting is written by opening setup or connecting, and the existing
draft Save, explicit firmware-write consent and Frame/Start contracts remain.

#### Existing consequences

- On Windows, and for adapters with a USB serial number elsewhere, a machine set up once connects
  when KerfDesk opens or when it is plugged in, with no click. A CH340 on macOS or Linux needs one
  click on Connect after a replug or browser restart; that is Chrome's grant rule, not a choice.
- In the desktop app, Connect is one click within a run and shows the picker after a restart.
  Installing a device permission handler that grants the remembered adapter across runs would
  lift that, and is left for a decision that amends ADR-366 (amended by ADR-552: the Windows
  desktop app remembers picks as Chrome does; macOS and Linux still ask after a restart).
- A first-time Connect opens Machine Setup: pick the port once, check the filled
  values or select a catalog profile, then save. Opening Machine Setup directly
  retains Find my machine and the offline capability cards and catalog.
- `DeviceSetupAutoDetect` is deleted; its readback list and apply action live in
  `DeviceSetupFoundMachine`. The controller contract fields move from `DeviceSetupIdentifyStep` to
  `DeviceSetupConnectionOptions`, unchanged.
- The laser store records `connectedBaudRate`, reset wherever `serialPortInfo` is, and
  `connectionAttempt`, the revision of the latest connect attempt or intentional disconnect.
- `device-setup-accept-detected.ts` holds the accept rule and the per-head change rows;
  `device-setup-accept-detected.test.ts` pins the laser, CNC and Laser + CNC cases.
- The rail's detected-settings apply outside setup follows the head in use too: in CNC mode the
  reported rate goes to CNC's own Max feed (#945, ADR-416).
- Locators change: `Connect…` is `Connect`; Forget Controller is in the **More connection options**
  menu; `Connect and detect` and `Set up automatically` are gone; `Run read-only checks` is
  `Read again`; `Controller and connection settings` is `Connection options`.
- Follow-ups not done here: label ports by bridge chip from a VID/PID table; `$I+` for grblHAL at a
  compatibility level; writing the chosen profile into `$I=` so the next connect names the machine
  (it writes a controller setting, so it needs its own consent flow).
