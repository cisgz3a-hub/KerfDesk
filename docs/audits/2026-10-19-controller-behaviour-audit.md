# Controller behaviour audit — connection, reconnect and notices

> **Status (2026-10-26, meta audit v1 M7):** F-1 to F-3 were fixed by #1294, and F-5 and F-9 by #1328. F-4, F-6, F-7, F-8 and F-10 are still open. See [the corrections](2026-10-23-meta-v1/M7-corrections-older-audits.md) for the current status of every item.

Status: read-only source audit, no hardware run. Nothing was changed.
Audited checkout: `claude/macos-linux-desktop` at `96ccab88f` (origin/main at `36cd85588`).
Prepared: 2026-10-19. Findings F-1, F-2 and F-3 are implemented in PR #1294.

Scope: how KerfDesk connects to a USB controller, what it does when the link drops or the
machine is power-cycled, every notice, toast, banner and dialog that path can show, what
raises errors that an operator would not expect, and how LightBurn handles the same cases.
The earlier controller audit (`docs/audits/2026-07-26-controller-systems-audit.md`) covered
protocol correctness; this one covers behaviour the operator sees.

## 1. How the connection works today

### Connect

1. `Connect` (rail button, menu, palette) runs `connectMachine`
   (`src/ui/laser/connect-machine.ts`). If the machine profile was never finished it also
   opens Machine Setup in the same click.
2. `runConnectAction` (`src/ui/state/laser-connect-action.ts`) closes any live connection
   first (`:127`), then resolves a port (`resolveSerialPort`, `:213`):
   - If a port the operator picked before is attached and matches the remembered USB
     vendor/product id, or is the only granted port, it opens without a picker
     (`chooseGrantedPort`, `src/ui/state/serial-port-memory.ts:29`).
   - Otherwise it calls `requestPort()`, which on the desktop shows the native
     "Select laser serial port" dialog (`electron/desktop-serial-chooser.ts`), or, with no
     port attached, the "No serial ports found" Retry/Cancel dialog
     (`electron/serial-port-wait.ts`).
3. The port opens at the profile baud (default 115200). GRBL-family profiles try the
   worker-hosted transport first (`serialOpenRequest`, `:260`) with a 2 s worker handshake
   (`src/platform/web/worker-serial-connection.ts:55`) and fall back to the main thread.
4. The handshake (`src/ui/state/laser-controller-handshake.ts`) listens passively for
   250 ms, sends `?` and waits 1.75 s more (`:42-43`), then waits up to 8 s for a fresh
   Idle, reads `$$`, `$I`, `$G`. Silence is not a fault for 10 s in all
   (`laser-controller-silence.ts`), matching LaserGRBL.
5. Status polling runs on a 250 ms tick, every 4th tick (1 s) when idle
   (`laser-connection-actions.ts:79-80`).

### Auto-connect (ADR-420)

`installAutoConnect` (`src/ui/app/use-auto-connect-controller.ts`) runs once at start and
again on every Web Serial `connect` and `disconnect` event (`src/platform/web/web-serial.ts:85-86`).
It connects only when exactly one granted port matches, never shows a picker, and skips
when anything is connected, connecting, moving or streaming (`autoConnectAllowed`, `:62`).
The preference is the "Connect automatically" check in the connection menu and is on by
default.

### Port memory

- Chrome and the Windows desktop app remember a pick across restarts (Windows: by device
  instance id, `electron/serial-port-grants.ts`). macOS and Linux remember only adapters
  with a USB serial number; most CH340 boards have none and are picked again after each
  start.
- The desktop app records a pick only when Electron reports a display name (`:97`),
  because Electron cannot persist a port without one.

### Disconnect and link loss

- `Disconnect` on a GRBL-family controller always sends Ctrl-X then `M5`/`M9`
  (`laser-disconnect-stop.ts:56`, `laser-disconnect-transaction.ts:158`), waits for the
  reboot banner, then closes the port. The same stop runs when `Connect` replaces a live
  connection.
- A cable pull or power-off fires `onClose`, logs
  `Controller connection closed unexpectedly` as an incident, and applies
  `buildPortClosePatch` (`laser-store-helpers.ts:413`). If a job, Fire, a jog/frame, or any
  controller operation other than the handshake was active, that patch raises the red
  Safety Notice banner (`:415-419`, `:471-472`).
- The safety banner is deliberately not cleared by a reconnect
  (`connectedControllerStatePatch`, `laser-connection-actions.ts:282`); the operator must
  click "I made the machine safe".

## 2. Inventory of pop-ups and where they come from

| What the operator sees | Kind | Trigger | Goes away |
| --- | --- | --- | --- |
| "Select laser serial port" | native modal | `Connect`/"Use a different port…"/Find my machine when no granted port matches | pick or Cancel |
| "No serial ports found" Retry/Cancel | native modal | same, with no port enumerated | Retry finds one or Cancel |
| "Couldn't connect" + red reason line (`ConnectionBar.tsx:111`) | inline alert | any failed open, **including a silent auto-connect** | next connect |
| Toolbar ⓘ notice: "Waiting for controller response…", "Reading controller settings…", "Controller information unavailable", "Controller connection needs recovery" (`ControllerToolbarNotice.tsx`) | 6 s toolbar notice | every qualification phase change (`controller-notice.tsx:24`) | 6 s or hover |
| Controller info popover with Retry / Reconnect | popover | only when the operator clicks ⓘ or the menu | Close |
| "Machine settings detected: …" (`DetectedSettingsToast.tsx:19-22`) | 8 s info toast | every successful `$$` read, so every connect | 8 s |
| Red Safety Notice banner "Connection lost mid-job" etc. (`SafetyNoticeBanner.tsx`) | persistent banner with "Reconnect controller…" | port closed while a job, Fire, jog/frame or any non-handshake controller operation was active | "I made the machine safe" only |
| `Connect: …`, `Reconnect: …` error toasts (`report-controller-action-failure.ts`) | 8 s error toast | a clicked action rejected | 8 s |
| Alarm banner with Unlock/Home | banner | controller reports Alarm (normal on a homing-enabled GRBL after power-on or after Ctrl-X) | Unlock/Home |

Nothing in the connection path opens a browser-style modal on its own except the two native
dialogs, and those only follow a click. So "reconnect pop-ups" in practice are one or more
of: the red failure line after a background auto-connect, the repeating toolbar notices and
settings toast on every reconnect, the native port dialog when the grant was lost, and the
red safety banner after a drop.

## 3. Findings

Ordered by operator impact. "Verify" marks a point to confirm on hardware before changing.

### F-1 — Auto-connect failures look like operator errors (High)

`installAutoConnect` swallows the rejection, but `reportConnectionFailure`
(`laser-connect-action.ts:170`) has already set `connection: failed` and the rail renders
the red "Couldn't connect … port is busy" alert. Auto-connect runs at launch and on every
USB connect/disconnect event, so with LightBurn or LaserGRBL holding the port, or a board
that re-enumerates when the machine powers on, KerfDesk shows a red error nobody asked for,
every time. Each attempt also writes an incident to the transcript.

Fix: pass the selection kind through so an `automatic` attempt that fails lands in
`disconnected` with a one-line log entry and a muted hint ("Port in use by another
program"), and reserve the red alert and incident for a clicked Connect.

### F-2 — An explicit Disconnect is undone by the next USB event (High)

`autoConnectAllowed` checks only live state, not intent. After the operator clicks
Disconnect to hand the machine to another program, the next `connect` event (machine
power-cycled, cable reseated, Windows re-enumerating a hub) reconnects KerfDesk and takes
the port back. On boards whose USB bridge is powered from the machine supply this happens
on every power cycle.

Fix: an explicit Disconnect or Forget sets a session flag that suspends auto-connect until
the next explicit Connect; show "Connect automatically (paused until you connect)" in the
menu while it is set. Keep auto-connect for the unplug-and-replug case when the operator did
not disconnect.

### F-3 — "Connection lost mid-job" raised with no job running (High, false alarm)

`isUnsafeControllerOperation` (`laser-controller-operation.ts:156`) treats every controller
operation except the handshake as unsafe. A manual settings read, `$I` build info, a
console exchange owned as an interactive command, or a recovery wait is an
`interactive-command`/`recovery` operation, so powering the machine off during one raises
the persistent red banner titled "Connection lost mid-job" with E-stop wording, and the
operator has to click "I made the machine safe" for a settings read.

Fix: raise `disconnect-during-job` only for `isActiveJob`, `fireActive`, a motion
operation, autofocus and probe. For other operations log the incident and show the ordinary
"Not connected" state. Also give a jog/frame its own title ("Connection lost while
moving"), since the current title names a job.

### F-4 — Settings are never read automatically while the controller is in Alarm (Medium)

GRBL with homing enabled (`$22=1`) boots locked in Alarm and answers `$$` in that state.
The manual read allows Alarm (`machine-settings-read-readiness.ts`), but the automatic
qualification path requires Idle (`automaticSettingsReadBlockReason`, `:50-56`). So the
common first connect sits at "Waiting to read controller settings…" and the controller info
popover says "Controller reset detected. Waiting to read controller settings…"
(`controller-notice.tsx:215`) even though nothing reset: `resumeQualificationInSession`
reuses the `reset-cleanup` phase for an in-session Alarm (`laser-controller-qualification.ts:212`).
LightBurn and LaserGRBL read settings on connect regardless of Alarm.

Fix: let the scheduler read `$$` when the fresh report is Alarm (communication is proven,
`$` commands are accepted), and add a `waiting-idle` phase or message for the Alarm case so
the copy does not claim a reset. Verify on a board that boots in Alarm.

### F-5 — Every reconnect shows the same three or four notices (Medium, noise)

Each qualification phase is a new notice key (`controller-notice.tsx:24`), so one connect
shows "Waiting for controller response…", then "Reading controller settings…", then the
"Machine settings detected…" toast, each for 6 to 8 s. With auto-connect on and a machine
power-cycled per job these repeat every time, even when the `$$` read found nothing new.
The maintainer already asked for fewer lingering toasts on 2026-09-19 (`toast-store.ts`).

Fix: show progress phases only in the status text next to the dot ("Connecting…",
"Reading settings…"), keep the toolbar notice for failures and recovery, and emit the
"Machine settings detected" toast only when `patch` is non-empty or the review items
changed since the last read for this port.

### F-6 — Disconnect always soft-resets GRBL-family controllers (Medium, verify intent)

`stopBeforeDisconnect` runs the Ctrl-X transaction for every GRBL-family Disconnect and
for the implicit close before a replacement connect, whether or not anything was running.
On a board that does not reset when the port opens (grblHAL, FluidNC, 32-bit boards, CH340
boards with DTR not wired to reset) that means: every Disconnect/Connect cycle clears `G92`
and the modal state, bumps the machine back into Alarm when homing is enabled, and forces
Unlock or Home again. LightBurn's "right-click Devices to reconnect" closes and reopens the
port without a reset as far as its documentation describes.

The reset is a fail-dark choice (ADR-212) and is right when a job, Fire, motion or an
unknown beam state exists. When the store can prove Idle with no job, no Fire and `M5`
already sent, sending only `M5`/`M9` and waiting for their `ok` (the path the non-GRBL
drivers already use) would keep the machine state across a quick reconnect. Record the
decision as an ADR-212 amendment either way.

### F-7 — One lost acknowledgement turns into "needs recovery" (Medium)

`controllerReconnectRecommended` returns true whenever qualification failed and
`pendingUntrackedAcks > 0` (`controller-recovery-status.ts:41`), and the qualification
scheduler fences every automatic refresh while an ack is owed. A single `ok` lost to a UART
line error, or a console line the controller never answered, therefore degrades a healthy,
polling link to "Controller connection needs recovery" with "Reconnect controller" as the
offered fix. The ledger is correct to be cautious, but reconnect is a heavy answer.

Fix: when fresh status reports keep arriving and no job is active, offer a "Resync"
action that sends a settle marker (`G4 P0.01`) and, on its `ok`, zeroes the untracked
ledger, instead of recommending a port close. Keep Reconnect for the silent case.

### F-8 — Windows: a different USB socket means the picker again (Low)

Windows identifies a CH340 by device instance id, which encodes the hub path for adapters
without a serial number. Plugging the same machine into another socket is a new id, so the
desktop grant does not match and Connect shows the port dialog. `chooseGrantedPort`
already matches by vendor/product id on the renderer side, but the Electron device
permission handler must allow the port first.

Fix: in `SerialPortGrants.allows`, also allow a port whose vendor/product id matches a
remembered grant when it is the only attached port with that id. Record it as a new grant
on first successful open.

### F-9 — "Controller information unavailable" is unreadable to operators (Low, copy)

The failure notice title names an internal concept (qualification). Operators read it as
"the laser is broken". The detail messages are good; the title is not.

Fix: "Couldn't read machine settings" with the same detail, and "Machine stopped
answering" for the silence case.

### F-10 — The hosted-transport worker handshake is 2 s (Low, verify)

`WORKER_HANDSHAKE_TIMEOUT_MS = 2000` covers the native `port.open` inside the worker. A
slow CH340 driver on a cold Windows start can take over a second to open. A timeout after
`native-open` was sent is a hard connect failure, not a fallback. No report of this yet;
worth a log line with the measured open time so it can be confirmed or ruled out.

### What is already right

- Connect into Alarm no longer leaves the app deaf; polling starts regardless (connect-2).
- Silence is tolerated for 10 s before it is called a fault, with baud-rate advice only when
  the bytes were undecodable.
- A throwing line handler or a UART line error never masquerades as a dropped cable.
- The port is closed when the read side ends on its own, so another program can open it.
- The recovery popover never opens by itself; the toolbar notice is the only automatic
  surface, and it stays inside the toolbar.
- Forget revokes the browser grant; a cable yank keeps it so a replug needs no picker.
- The stale-port sweep before `requestPort` prevents "port already open" after a crash.

## 4. How LightBurn does it (sourced)

From LightBurn's documentation and forum, checked 2026-10-19:

- **Port selection.** The Laser window has a serial-port dropdown. LightBurn "will attempt
  to automatically select the correct serial port and connect"; the dropdown shows
  "(Choose)" when it cannot, and the operator picks a COM port. Right-clicking **Devices**
  refreshes the port list and "closes and reopens the connection to the selected device".
- **Reconnect.** The docs say it reconnects on restart as long as the laser stays on the
  same port; after a reboot or a different USB socket the port may need re-picking. There is
  no modal on connection loss: the status text goes to "Disconnected" and the console shows
  "Waiting for connection…" until the controller's startup text arrives.
- **Status text.** "Disconnected", "Ready", "Busy" (with a progress bar while streaming).
  Alarms appear in the Console as `ALARM:n`; forum threads show "Busy" sticking after an
  alarm or feed hold, because LightBurn does not send `?` while it believes the stream is
  busy. KerfDesk's realtime polling during Hold/Door/Alarm is better here.
- **Settings read.** "Fetch Settings on Connect" is an opt-in device setting that reads the
  firmware settings on every connection. "Check For Workpiece Offsets on Connect" is a
  separate opt-in. KerfDesk always reads `$$`, `$I` and `$G`, which is the right default
  for its auto-fill, but see F-5 for the notices that follow.
- **DTR.** "Enable DTR signal" is a per-device toggle because asserting DTR resets
  Arduino-based boards while native-USB boards (RP2040, some ESP32) need it to talk at all.
  Web Serial always asserts DTR on open, so KerfDesk cannot offer this toggle; it is the
  reason stock GRBL boards reboot on every KerfDesk connect and print a banner, and why
  F-6 matters more for boards that do not.

Net: LightBurn is quieter (status text and console only, no toasts, no safety banner) and
gives the operator a visible port dropdown and a one-gesture "reset connection". KerfDesk
is more careful (fail-dark reset, uncertainty banners, line-error reporting) but pays for it
in notices. The fixes above keep the care and remove the noise.

## 5. Suggested order

1. F-1 and F-2 (auto-connect intent and quiet background failure): one small change set
   around `use-auto-connect-controller.ts`, `laser-connect-action.ts`, `ConnectionBar.tsx`.
2. F-3 (false "mid-job" banner): one predicate change plus a title, with tests in
   `laser-store-helpers` and `SafetyNoticeBanner.test.tsx`.
3. F-5 and F-9 (notice volume and copy): UI only.
4. F-4 (read `$$` in Alarm) and F-7 (resync instead of reconnect): store changes, hardware
   verify on a homing-enabled board.
5. F-6 (idle Disconnect without Ctrl-X): needs an ADR-212 amendment and hardware verify.
6. F-8 and F-10: desktop-only follow-ups.

## Sources

- https://docs.lightburnsoftware.com/2.1/Reference/LaserWindow/
- https://docs.lightburnsoftware.com/2.0/GetStarted/ConnectingToLaser/
- https://docs.lightburnsoftware.com/2.1/Reference/DeviceSettings/GCode/
- https://forum.lightburnsoftware.com/t/lightburn-doesnt-seem-to-handle-unresponsive-grbl-interface-when-on-hold-or-door/62623
- https://forum.lightburnsoftware.com/t/update-to-0-9-18-causing-communication-issue/26305
- https://github.com/grblHAL/RP2040/issues/13
