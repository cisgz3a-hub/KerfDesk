# Lead verification log (2026-09-25, continuation session)

Each finding re-traced by the lead against the KerfDesk code at the branch head (main fa8939b
merged) and the upstream source at the pinned revisions (re-cloned into this session's scratchpad).
Repro results are from `pnpm vitest run src/__audit_repro__` on the merged head: 93 failing,
22 passing, 1 skipped before any fix.

Verdicts: **confirmed** (code path and upstream line both hold), **plausible** (code holds,
firmware or hardware behaviour not settled by source), **dropped** (does not hold; reason given),
**merged** (duplicate of another id).

## GP — GRBL 1.1 protocol

| id | verdict | lead notes |
|---|---|---|
| GP-1 | confirmed | system.c:195-199 runs `system_execute_startup` after a full `$H`. `activeWcs` only changes on `[GC:` lines (laser-line-handler.ts:194-200), Console WCS writes and banners; Home (laser-home-action.ts:100-122) never touches it. Fix together with CG-2: re-read `$G` after a successful Home instead of nulling `activeWcs`. |
| GP-2 | confirmed | protocol.c:224-236: ALARM:1/2 print `[MSG:Reset to continue]`, clear EXEC_RESET and spin until a new reset; the loop services no `?` (only the reset flag is tested). The Alarm banner offers Home/Unlock only (AlarmRecoveryActions.tsx, LaserWindow.tsx:273-312); Reset exists only in the Sleep banner. Merged with HF-3 (grblHAL) and HF-2 (FluidNC Critical). |
| GP-3 | confirmed | serial.c:150-154 picks `?`, `~`, `!` out of the byte stream anywhere, comments included. From Idle `!` sets `SUSPEND_HOLD_COMPLETE` and Hold; the line waits in the suspend loop until `~`. Console allows 0x20-0x7E (console-text.ts:65-72) and queues `!` lines as G-code (console-command.ts:83-86). |
| GP-4 | confirmed | system.c:147-157 (`$C` in Check mode resets). console-command.ts classifies `$C` as `gcode` with `requiresIdle`; console-command-readiness.ts:33-37 refuses it in Check. `$H`/`$SLP` in Alarm: system.c default branch accepts IDLE or ALARM; Console refuses (low, the banner offers Home). |
| GP-5 | confirmed | settings.c:229 `uint8_t int_value = trunc(value)`; report.c prints floats with N_DECIMAL_SETTINGVALUE 3 (config.h:146) and RPM with 0. |
| GP-6 | confirmed (low) | print.c:174-180 converts `$#` to inches under `$13=1`; work-z-recovery-actions.ts:67 stores it as mm. Only the WorkZRecoveryControl text uses `offsetZMm`. |
| GP-7 | merged into ST-4 | limits.c:319 "No time to run protocol_execute_realtime() in this loop". |
| GP-8 | confirmed (low), trimmed | ALARM:4 text wrong for G38.4/5 (alarm CSV row 4); error:7 also covers a coordinate-slot read (gcode.c:509,543,614-616; report.c:251) so `$#` is the check, not only `$$`; error:11 limit is 79 characters after spaces/comments (protocol.c). Dropped the error:14 item: 1.1h never emits it (grep), and the text matches the official CSV meaning, so nothing misleads. |

## ST — GRBL-family streaming

| id | verdict | lead notes |
|---|---|---|
| ST-1 | confirmed | `toolChangeContinueBlockMessage` (laser-store-helpers.ts:110-134) checks MPG, drained-hold readiness, Work-Z evidence, plate and tool only. GRBL answers G-code in Jog with error:9 (protocol.c:99-101). Once Continue writes, `hasUnsettledStreamAcks` is true for `streaming`, so a still-owed operator `ok` is booked to the stream. The fix adds handoff facts (motion/controller operation, owed ack, current Idle), not a Start policy gate. |
| ST-2 | confirmed (test fidelity) | 8 simulator cases fail against the cited GRBL lines. Fix in fixtures only; keep grblHAL-only behaviour (status during homing) behind a flag. |
| ST-3 | confirmed (low) | `handleStatusLine` runs `handleInvalidatingStatus` for every Alarm/Sleep report, not only on entry (laser-status-line.ts:53-56, 252-294), zeroing owed acks and cancelling the owned `$X`. |
| ST-4 | confirmed | limits.c:319 (no realtime service while homing): `?` is not answered, and `keepCommandAliveFromStatus` only refreshes on a report. GP-7 merged here. |
| ST-5 | confirmed (low) | `streamHoldFromProbe` (laser-stream-hold.ts:66-82) ignores the head line; GRBL reports Idle through `G4` (motion_control.c:195-200 sync, then delay_sec). Same family as MA-9. |

## TC — serial transport and connection lifecycle

| id | verdict | lead notes |
|---|---|---|
| TC-1 | confirmed (busy at connect); plausible (boot text) | `waitForHandshakeIdle` writes one `?` (laser-controller-handshake.ts:341-379); the poll starts only after the handshake. |
| TC-2 | confirmed (low) | web-serial.ts:7-8 and types.ts:132 still say UTF-8; the code writes one byte per character. |
| TC-3 | plausible (low) | Smoothieware USBSerial::on_main_loop handles detach before dispatching the next line and dispatches one line per loop (USBSerial.cpp:322-366), so an unparsed `M9` can be flushed. Whether the OS drops DTR on close is platform-dependent. Cheap fix: wait briefly for the owed acks before closing. |
| TC-4 | confirmed (low) | `handleDroppedConnection` (web-serial.ts:194-198) never calls `port.close()`; the worker path does. |

## RU — Ruida `.rd` export

Re-read meerk40t rdjob.py at 7e82652f: `write_header` 1401-1504, `write_layer_end` 1511-1515,
`write_settings` 1516-1546, `write_tail`, `mark` (returns on dx == dy == 0), opcode table
(`D8 10/11/12`, `D8 00`, `E7 00`, `EA`/`EB`, `CA 01 00`, `CA 01 12/13`, `C9 02`).

| id | verdict | lead notes |
|---|---|---|
| RU-1 | confirmed (bytes); plausible (controller effect) | rd-encoder.ts:90-103 writes only the part table and `CA 02 n` per layer; meerk40t's `write_settings` sets `C9 02` speed and `C6 01/02/21/22` power after `CA 02`. |
| RU-2 | confirmed (bytes); plausible (placement effect) | `streamStart()` is `D8 12` (rd-commands.ts:82-85), meerk40t's REF_POINT_0 "CURRENT_POSITION". No `D8 00`. |
| RU-3 | confirmed (bytes); plausible (effect) | `EB` without `EA`; no `E7 00` / `CA 01 00` layer end. |
| RU-4 | confirmed (low) | job.ts:35-36 closed polylines already end on their first point; rd-encoder.ts:159 adds another `A8` to it. |
| RU-5 | confirmed (bytes) | `airAssist` never read by the encoder; meerk40t writes `CA 01 13/12` per layer. |
| RU-6 | confirmed | laser-command-family.ts:11-20 enables Connect on `serialSupported && !connected`; laser-connect-action.ts opens the port without a transport check. |
| RU-7 | confirmed | emit-rd.ts: advisories are only the pre-emit ones; the post-compile zone/bounds checks run only for G-code saves. |
| RU-8 | confirmed (latent, low) | No caller outside tests. Fix before wiring a socket; out of scope for live behaviour. |

## HF — grblHAL, FluidNC, Falcon

Lead re-read: grblHAL protocol.c:205-280 (sticky `last_error`, cleared by an empty line, a
successful `$` line, ASCII_CAN or reset), config.h:96 (`COMPATIBILITY_LEVEL 0`), alarms.h:73-80,
system.c:1175-1183 and 490-505, protocol.c:160-176, report.c:305-315, grbl.h:38-43; FluidNC v4.0.3
ProcessSettings.cpp:269-286 and Protocol.cpp:455-475.

| id | verdict | lead notes |
|---|---|---|
| HF-7 | confirmed (grblHAL default); plausible (Falcon) | `else if(gc_state.last_error == Status_OK …)` gates every G-code line at level 0. KerfDesk's own `G4 P0.01` release marker is G-code, so ADR-361's automatic release fails twice after a refused `$J=`. |
| HF-3 | confirmed; merged with GP-2 | `alarm_is_critical` + `Status_NotAllowedCriticalEvent` (79) for `$X`/`$H`. Text half fixed with GP-2/GP-8. |
| HF-2 | confirmed; merged with GP-2 | FluidNC `$X` unlocks only `State::Alarm`; Critical returns `Error::Ok`. |
| HF-1 | plausible | grblHAL `go_home` re-enters Alarm while axes are unhomed (system.c:500-503). Race window as described. |
| HF-6 | confirmed (low) | FluidNC long names (`Settings/Restore`, `Settings/Erase`, `NVX`) are matched case-insensitively upstream; KerfDesk blocks only `$RST=`. |
| HF-4 | confirmed (low) | Falcon cannot write `$62`. |
| HF-8 | confirmed (mechanism); plausible (Falcon) | grblHAL prints `Grbl 1.1f` at level ≥ 1 (report.c:310-314); detection maps it to stock GRBL. |
| HF-5 | confirmed (low); merged with CG-8 | grblHAL protocol.c:167-173 and FluidNC Protocol.cpp:1158 re-enter Alarm after a reset from Sleep; gnea/grbl protocol.c:49-54 does the same. |

## MA — Marlin

Lead re-read: Marlin 2.1.2.8 queue.cpp:537-545 (M410/M112 early, EMERGENCY_PARSER off in stock),
planner.cpp:1385-1399 and 1676-1706, M3-M5.cpp:140-156, gcode.cpp:1114-1122, parser.cpp:388-393,
G92.cpp:60-72, Configuration.h:2228-2229, Configuration_adv.h (LASER_FEATURE, AIR_ASSIST,
CNC_COORDINATE_SYSTEMS commented out; LASER_SAFETY_TIMEOUT_MS 1000).

| id | verdict | lead notes |
|---|---|---|
| MA-1 | confirmed (critical) | Fan dialect: `check_axes_activity` drives the fan from the current speed with an empty planner. Inline: only dynamic mode blanks. |
| MA-7 | confirmed (critical) | `M5` synchronizes; `M410` is acted on when read and drops the planner. Product decision: Abort sends M410 (ADR). |
| MA-4 | confirmed | `M400` answers after the drain; busy keepalives every 2 s are dropped. |
| MA-9 | confirmed | Same family as ST-5: the hold copy names a status report never polled. |
| MA-12 | confirmed | `echo:Unknown command` then `ok`. Product decision (ADR). |
| MA-3 | confirmed | Abort applies the GRBL reset patch without a reset. Reset-origin half = CG-11. |
| MA-2 | confirmed (medium) | Marlin origin model decision (ADR) with CG-1, CG-11. |
| MA-8 | confirmed | No G0_FEEDRATE in stock; G0 runs at the modal F. |
| MA-5 | confirmed | queue.cpp drops comment-only lines without a reply. |
| MA-6 | confirmed | M114 prints one label per configured axis. |
| MA-10 | confirmed (low); reconnect effect plausible | M112/kill needs a reset or power cycle. |
| MA-11 | confirmed (test fidelity) | Simulator is not FIFO and answers comment lines. |

## SM — Smoothieware

Lead re-read: Block.h:81, Planner.cpp:81, Robot.cpp:1034/1466, Laser.cpp:50-58/246,
SimpleShell.cpp:214-253 and 872-885 (`$G` answers `[GC:…]` + `ok`), Endstops.cpp:847-853 and
1110-1122 (G28.6), Kernel.cpp:284-295 (idle `F:` is the requested feed).

| id | verdict | lead notes |
|---|---|---|
| SM-1 | confirmed (high) | Same root cause as CG-1: derive the offset from MPos − WPos. |
| SM-7 | confirmed | `roundf(S*2048)` into a 12-bit field; the track's disassembly of the shipped binary agrees. Only S < 2 works. |
| SM-6 | confirmed | `$H` prints `ok` unconditionally; G28.6 reports per-axis homed flags. |
| SM-3 | confirmed | Laser module deletes itself when disabled; nothing answers `fire off`. |
| SM-2 | confirmed (traced, history) | `M221 P` exists only since 971eb8cf. |
| SM-5 | confirmed (low) | Needs a small decision (ADR): explicit feed on travel after a stopped Frame. |
| SM-8 | confirmed (low) | Unsolicited `ALARM:` lines booked as terminal replies. |
| SM-9 | confirmed (low, display) | Idle `F:` is the requested feed. |
| SM-4 | confirmed (test fidelity) | |

## CG — cross-firmware gating

| id | verdict | lead notes |
|---|---|---|
| CG-12 | confirmed (high) | use-job-shortcuts.ts called `cancelJog()` without a jog-cancel byte. Fixed. |
| CG-1 | confirmed | Smoothieware half with SM-1; Marlin half with the Marlin origin ADR. |
| CG-2 | confirmed | Fix before GP-1 as the track orders it. Smoothieware `$G` verified in SimpleShell.cpp. |
| CG-11 | confirmed | G92.cpp:62-70: `G92.1` exists only with CNC_COORDINATE_SYSTEMS (off in stock). |
| CG-9 | confirmed | Fixed: auto-focus runs the driver's Console policy; `$HZ1` preset is Falcon-only. |
| CG-3 | confirmed | Smoothieware halt prints no banner, so nothing re-arms qualification. |
| CG-4 | confirmed (low) | |
| CG-10 | confirmed (low) | Only M9 turns Marlin air assist off (M7-M9.cpp). |
| CG-5 | confirmed (low, traced) | |
| CG-7 | confirmed (low, traced) | |
| CG-8 | merged into HF-5 | |

## OR — output, profiles, recovery

Lead re-read: gnea/grbl stepper.c:388-400 (only `is_pwm_rate_adjusted` blocks go dark at an
empty buffer), gcode.c:914-930, motion_control.c:64-76 (coincident move sync in M3).

| id | verdict | lead notes |
|---|---|---|
| OR-1 | confirmed (high) | Output change needs an ADR (it changes the 4040's qualified bytes). |
| OR-2 | confirmed | Fixed reserves below the firmware maxima. |
| OR-3 | confirmed | Incomplete fix of ADR-362 item 8. |
| OR-4 | plausible | Closed firmware; nothing public settles `$J=`. Product decision recorded in the ADR. |
| OR-5 | confirmed (low) | |
| OR-6 | confirmed (low, traced) | FluidNC `$30`/`$32` are read-only proxies. |

## CN — CNC controllers

| id | verdict | lead notes |
|---|---|---|
| CN-1 | confirmed | Export paths say nothing about the GRBL-only CNC dialect. |
| CN-2 | confirmed (low) | |
| CN-3 | confirmed (low) | |
| CN-4 | confirmed (low, wording) | |

Nothing was dropped at lead level beyond the GP-8 error:14 item and the merges above. The
tracks themselves dropped: the partial's "M5 before M9" OR-1 fix idea, CG-6 (duplicate of SM-4
and MA-11), and the Marlin comment-only auto-focus case (unreachable).
