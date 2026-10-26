# Controller protocol audit — how controllers work, and how KerfDesk talks to them

> **Status (2026-10-26, meta audit v1 M7):** P-1, P-5 and P-6 were fixed by #1315. CS-05 was fixed by #923 on 2026-09-26. See [the corrections](2026-10-23-meta-v1/M7-corrections-older-audits.md) for the current status of every item.

Status: research plus read-only source audit, no hardware run. Nothing was changed.
Audited: origin/main at `73025a10e`, plus open PR #1287 (`claude/market-fixes`) for the external
G-code run feature. Prepared: 2026-10-20.

This is the second controller audit of 2026-10. The first
(`docs/audits/2026-10-19-controller-behaviour-audit.md`) covered connecting, reconnecting and the
notices an operator sees. This one starts from primary sources on how GRBL, grblHAL, FluidNC,
Marlin and Smoothieware behave, and how established senders (LaserGRBL, CNCjs, Universal G-code
Sender, LightBurn) drive them, then checks KerfDesk's streaming, status, error, alarm, jog and
settings handling against those facts.

## 1. How the controllers work (research)

### 1.1 GRBL 1.1 (gnea/grbl)

**Lines and replies.** A line ends at either `\n` or `\r`. Every line gets exactly one reply:
`ok` or `error:N`. An empty line or comment-only line still gets `ok` "for syncing purposes"
(`protocol.c` lines 93-95), so sending `\r\n` to stock GRBL produces two `ok`s. Lines longer
than `LINE_BUFFER_SIZE` (80, so 79 characters) are answered `error:11`. While in Alarm or Jog,
every non-`$` line is answered `error:9` (`protocol.c` lines 99-101).

**Push messages.** `ALARM:N`, `[MSG:…]`, settings lines, `[GC:…]`, `[VER:]`/`[OPT:]`, `$#`
blocks, and startup-block results `>G54G20:ok` arrive without answering a line. The `:ok` inside
a startup-block result must not be counted as a stream acknowledgement.

**Streaming.** Two methods are documented. Send-response waits for each reply. Character counting
tracks unacknowledged bytes against the 128-byte serial RX ring (127 usable); newlines count. The
documented reservation: lines already in the RX buffer after a rejected line still run.

**EEPROM rule.** EEPROM writes disable the serial RX interrupt, so "only send-response is safe"
for them. Writes: `G10 L2`, `G10 L20`, `G28.1`, `G30.1`, `$x=`, `$I=`, `$Nx=`, `$RST=`. Reads:
`G54`-`G59`, `G28`, `G30`, `$$`, `$I`, `$N`, `$#`. `config.h` also forces a planner sync during
EEPROM writes and WCO changes (`FORCE_BUFFER_SYNC_DURING_EEPROM_WRITE`,
`FORCE_BUFFER_SYNC_DURING_WCO_CHANGE`).

**Status reports.** `?` is answered within about 5-20 ms; the recommended rate is no more than
5 Hz. `WCO:` appears in the first report after a reset, after any change, and otherwise every 10
reports when idle or 30 when busy. `Ov:` every 10 or 20. `A:` only alongside `Ov:` and only
when an accessory is on. `Pn:` only when a pin is active. `Bf:` only when enabled in `$10`.
No report is guaranteed during homing, or while a hard or soft limit alarm is active.

**Realtime bytes.** `?` `~` `!` and Ctrl-X, plus 0x84 safety door, 0x85 jog cancel, 0x90-0x9D
overrides, 0x9E spindle stop, 0xA0/0xA1 coolant. They never enter the RX buffer. `!` runs only
in Idle, Run or Jog; sent after a jog has ended it can leave GRBL in Hold. Soft reset during
motion raises an alarm; when stationary, position is kept.

**Alarms.** Hard and soft limit alarms print `[MSG:Reset to continue]`; only a reset clears
them. `$X` unlocks other alarms without restoring position. `$SLP` exits only by reset, into
Alarm. With `HOMING_INIT_LOCK` (default) a homing-enabled machine boots into Alarm.

**Jogging.** `$J=` needs an axis word and `F` every time. It is accepted only in Idle or Jog, so
jogs can be queued behind a running jog. A soft-limit violation is an `error`, not an alarm.
Cancel with 0x85, never with `!`. GRBL's low-latency continuous jog recipe keeps short increments
queued against a 15-block planner and sends 0x85 on release.

**Laser mode (`$32=1`).** The laser fires only in G1/G2/G3; G0 always turns it off. M4 power
scales with speed and is off when stopped. Laser mode removes the stop on S changes; spindle
state changes still stop. `DISABLE_LASER_DURING_HOLD` is on by default.

### 1.2 grblHAL

- Same protocol as GRBL 1.1, with a larger RX ring (core default 1024) reported in `[OPT:…,blocks,rx]`.
- `\r\n` and `\n\r` count as one terminator, unlike stock GRBL.
- New status state `Tool` (manual tool change), substates such as `Alarm:n`, and new fields:
  `WCS:`, `MPG:`, `H:` (homed), `D:`, `Sc:`, `TLR:`, `FW:`, `In:`, `SD:`. New `Pn:` letters
  include `E` (E-stop), `M` (motor warning) and `F` (motor fault). Senders must ignore unknown
  fields and must not assume field order.
- New realtime bytes: 0x87 asks for a complete report with every element, 0x19 stop (keeps more
  state than reset), 0x8B MPG toggle, 0x8C auto-report toggle, 0xA3 tool-change acknowledge.
- Alarms 10 (E-stop) and 11 (homing required) are new; at default compatibility level a refused
  line's error stays latched until an empty line.
- Status requests are queued, not answered, during homing; a `Home` report is pushed first.

### 1.3 FluidNC

- Its channel contract requires an `ok` before the next line (`Serial.cpp`, v4.0.3 header
  comment), so character counting is not part of its protocol.
- It keeps answering `?` while homing (reporting `Home`), and ignores feed hold during homing.
- Alarm numbering differs from GRBL above 9: 10 Spindle Control, 11 Input Pin Initially On,
  12 Ambiguous Switch, 13 Hard Stop, 14 Unhomed, 15 Init, 16 Expander Reset, 17 GCode Error,
  18 Probe Hard Limit (`Alarm.h`). Each alarm prints `[MSG:INFO: ALARM: <name>]` then `ALARM:N`.
- A machine with homing configured boots into `ALARM:14` Unhomed.
- `$Report/Interval` turns on automatic status reports; `$Start/Message` and `$GS` exist for
  senders that need a GRBL-style banner.

### 1.4 Marlin

- One `ok` per line; with `ADVANCED_OK` it adds `P<planner free> B<buffer free>`.
- Line numbers and checksums are optional. A line starting with `N` must carry a `*` checksum
  and follow the last number, or Marlin asks for `Resend:`.
- While blocked longer than about 2 s it prints `echo:busy:` keepalives.
- `M114` reports the projected position, not proof that motion has finished; `M400` waits for
  the planner to drain. `M410` quickstops without deceleration and loses position.

### 1.5 Smoothieware

`?` and Ctrl-X are understood in `grbl_mode`; a soft reset halts rather than reboots and needs
`M999`. The earlier controller systems audit (2026-07-26, CS-03) covers the dialect question.

### 1.6 How established senders behave

| Behaviour | LaserGRBL | CNCjs | UGS | LightBurn (documented) | KerfDesk |
| --- | --- | --- | --- | --- | --- |
| Stream window | 127 bytes, raised to 128 when `Bf:` shows it | 128 − 8 = 120, grows from `Bf:` | Buffered communicator | Not documented | 120, bounded by `Bf:`/`[OPT:]` evidence; one line at a time on FluidNC, Marlin, Smoothieware |
| Status poll | 200 ms to 2 s by user setting | 250 ms, re-queries after 5 s without a reply | User setting | Not documented | 250 ms busy, 1 s idle |
| `error:N` during a job | Counts it and keeps streaming; optional retry mode | Pauses the job, with an "ignore errors" option | Stops sending and reports "paused on error" | Not documented | Stops the job and soft-resets the controller |
| Lost `ok` | Fakes the missing `ok`s when `Bf:` shows an empty buffer and nothing moved for 10 s | Re-queries status | — | — | Freezes, resets and raises a safety notice after the hold watchdog |
| Silent controller mid-job | Flags "stopped responding" after 10 polls and 5 s | — | — | — | Heartbeat loss after 2 s of active polling (with host-stall grace), then reset |

## 2. Findings

Ordered by impact. "Verify" marks a point that needs hardware before a change ships.

### P-1 — EEPROM-writing lines are streamed in a full window (Medium, live once PR #1287 merges)

PR #1287 (ADR-630, "Run an external G-code file") refuses `$` lines but only warns about `G10 L2`,
`G10 L20`, `G28.1` and `G30.1`, then streams the file with the ordinary character-counting
streamer. `fillBuffer` in `src/core/controllers/grbl/streamer.ts` packs lines into the window
with no special case for these commands. GRBL's documentation says EEPROM writes disable the
serial receive interrupt and that only send-response is safe for them. Bytes arriving during the
write can be lost or corrupted. The likely outcomes are a lost `ok`, which ends in the stall
watchdog's reset and a safety notice, or a damaged following line.

KerfDesk's own commands are not affected. Origin writes, probe lines (`G10 L20` included) and
`$x=` settings writes are already sent one at a time, each waiting for its reply.

Fix: in `fillBuffer`, treat an EEPROM-writing line as a sync point in `char-counted` mode. Send it
only when nothing is in flight, send it alone, and send nothing more until its reply arrives.
Use the shared G-code word scanner from ADR-630 so `G10L20`, `G 10 L 2` and `G28.1` are all
recognised. Applies to stock GRBL; grblHAL stores settings differently, so verify whether it
needs the same rule before narrowing it.

### P-2 — Any `error:N` during a job resets the controller (Medium, policy choice)

`handleErrorLine` (`src/ui/state/laser-error-line.ts`) marks the stream errored and, on
GRBL-family controllers, sends Ctrl-X. That ends the job and, if the machine was moving, loses
position. This is deliberate (P0-1, ADR-215) and is the strictest of the senders compared:
LaserGRBL keeps streaming, while CNCjs and UGS stop sending and wait for the operator.

For KerfDesk's own jobs an error means the compiler emitted something the controller rejects, so
stopping is right. For external programs (PR #1287) a harmless rejection, such as `error:20` on
an M-code the firmware lacks, now costs the job and the position.

Proposal, needing an ADR: on a stream rejection, send feed hold or the door byte first (motion and
laser stop at once), then offer **Abort** (today's reset) or **Resume** (skip the rejected line).
Keep Abort as the default for KerfDesk-compiled jobs. GRBL's documented reservation still
applies: lines already in the receive buffer after the rejected one will run on Resume, so the
dialog has to say so.

### P-3 — Jog steps cannot be queued (Low-Medium, convenience)

Every jog first proves a fresh Idle report (`confirmFreshManualMotionIdle`), and the jog pad is
disabled while any motion operation runs (`isJogPadDisabled`). GRBL accepts `$J=` in the Jog
state and queues it, and the docs recommend exactly that for responsive jogging. Today, tapping
an arrow three times quickly moves one step; the other taps land on a disabled button.

Fix: while a KerfDesk-owned jog is running on a GRBL-family controller, let further step jogs in
the same session append to that motion operation instead of starting a new one. Keep the
fresh-Idle check for the first step, and keep the queue short (for example three steps) so a
release or Cancel's 0x85 stops quickly.

### P-4 — grblHAL's complete status request is not used (Low)

After connecting to a board that does not reset on open, and after an origin change, KerfDesk
waits for `WCO:` by bursting `?` queries (`waitForUnreportedFrameWorkOffset`,
`waitForOriginWcoFrame`). GRBL includes `WCO:` only every 10 idle reports, so the wait can take
seconds. grblHAL answers 0x87 with every element at once: `WCO:`, `Ov:`, `A:`, `H:`, `WCS:`.

Fix: on grblHAL, send 0x87 once after the handshake and at the start of those waits, when `$I+`
reports `RT+` (or the driver is grblHAL). Optional: on FluidNC, offer `$Report/Interval` to cut
polling traffic.

### P-5 — FluidNC alarm 13 is not treated as losing position (Low)

`runStopMayHaveLostPosition` (`src/ui/app/checkpoint-interruption.ts`) checks the stock GRBL and
grblHAL alarm tables only. FluidNC's 13 is "Hard Stop", which loses position; grblHAL's 13 is
probe protection with `positionLost: false`, and stock GRBL has no 13. The interrupted-job checkpoint can
therefore record a FluidNC hard stop as keeping position (`job-checkpoint-repository.ts`). (FluidNC's 10
is over-reported as position-lost through GRBL's table, which is harmless.)

Fix: pass the controller kind and use `presentAlarm`'s FluidNC table, with a `positionLost`
flag per FluidNC code (1, 2, 3, 6-9, 13 and 18 at least).

### P-6 — grblHAL E-stop and motor-fault pins are not decoded (Low, copy)

`pickPins` decodes X, Y, Z, P and D only. grblHAL's `E` (E-stop asserted), `M` (motor warning)
and `F` (motor fault) are dropped. Alarm 10 already explains an E-stop, but a pressed E-stop
before an alarm, or a motor warning, shows nothing.

Fix: decode `E`, `M` and `F` for grblHAL and show them in the machine status line.

### Carried over from the 2026-07-26 controller systems audit, still open on main

- **CS-02 — startup blocks are not read.** The handshake still sends no `$N`, so a reset-based
  Abort or Disconnect can run startup motion KerfDesk never inspected.
- **CS-04 — Marlin `M114` is still recorded as Idle** (`src/core/controllers/marlin/response.ts`).
- **CS-05 — Marlin `G92.1` is still offered unconditionally** (`marlin/driver.ts:81`), though it
  needs `CNC_COORDINATE_SYSTEMS`.

## 3. Checked and correct

Each of these was compared against the research above and needs no change.

- Lines end with `\n` only, so stock GRBL never sees a second empty line.
- Line length is capped per firmware: 79 characters for GRBL, 256 for grblHAL (`line-buffer-limit.ts`).
- Startup-block results like `>G54:ok` classify as unknown and are never counted as an `ok`.
- The status parser accepts `Tool` and numeric substates, keeps extra axes, and ignores fields it
  does not know, as grblHAL asks.
- The stream window is 120 bytes and grows only from `Bf:` or `[OPT:]` evidence, matching CNCjs.
- FluidNC, Marlin and Smoothieware stream one line at a time (ADR-456). FluidNC's own source
  requires this.
- `$x=` writes, origin writes and probe lines are owned commands, each waiting for its reply.
- Jogs cancel with 0x85, never `!`; press-and-hold sends one long jog and cancels on release.
- Status polling runs at 4 Hz busy and 1 Hz idle, within GRBL's 5 Hz guidance.
- Status is not expected during GRBL or grblHAL homing, and is expected during FluidNC homing.
- `ALARM:N` wipes the in-flight lines and is not counted as an acknowledgement.
- Realtime bytes above 0x7F go out as single bytes, not UTF-8 (`encodeWireBytes`).
- Marlin lines carry no `N` or checksum, which Marlin accepts; a `Resend:` ends the stream
  rather than replaying motion.
- Pause sends the safety-door byte where available, so the laser and spindle are switched off
  and resume restores them.

## 4. Suggested order

1. P-1 before or together with PR #1287, because that PR makes it reachable.
2. P-5 and P-6: small, self-contained, testable without hardware.
3. P-3: jog queueing, with a simulator test and a hardware check.
4. P-4: grblHAL 0x87, hardware check on a grblHAL board.
5. P-2 needs a maintainer decision and an ADR before any code.
6. CS-02, CS-04 and CS-05 remain from July.

## Sources

- GRBL interface: https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md
- GRBL commands: https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md
- GRBL jogging: https://github.com/gnea/grbl/blob/master/doc/markdown/jogging.md
- GRBL laser mode: https://github.com/gnea/grbl/blob/master/doc/markdown/laser_mode.md
- GRBL source: `grbl/protocol.c`, `grbl/serial.c`, `grbl/config.h` at https://github.com/gnea/grbl
- grblHAL sender notes: https://github.com/grblHAL/core/wiki/For-sender-developers
- grblHAL report extensions: https://github.com/grblHAL/core/wiki/Report-extensions
- grblHAL realtime bytes: https://github.com/grblHAL/core/blob/master/grbl.h
- FluidNC: `FluidNC/src/Serial.cpp` (v4.0.3), `Protocol.cpp`, `Report.cpp`, `Alarm.h` at https://github.com/bdring/FluidNC
- Marlin: https://marlinfw.org/docs/gcode/M110.html, https://marlinfw.org/docs/gcode/M114.html,
  https://marlinfw.org/docs/gcode/M410.html, and `Marlin/src/gcode/queue.cpp` (bugfix-2.1.x)
- LaserGRBL: `LaserGRBL/Core/GrblCore.cs` at https://github.com/arkypita/LaserGRBL
- CNCjs: `src/server/controllers/Grbl/GrblController.js` and `src/server/lib/Sender.js` at https://github.com/cncjs/cncjs
- Universal G-code Sender: `GrblController.java` at https://github.com/winder/Universal-G-Code-Sender
- LightBurn: https://docs.lightburnsoftware.com/2.1/Reference/LaserWindow/ and
  https://docs.lightburnsoftware.com/2.1/Reference/DeviceSettings/GCode/
