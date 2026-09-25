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
