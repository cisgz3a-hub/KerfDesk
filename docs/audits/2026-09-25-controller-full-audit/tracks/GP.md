# Track GP — GRBL 1.1 protocol core (final track report, not yet verified by the lead)

8 findings: 2 high, 2 medium, 4 low. Repro tests in `src/__audit_repro__/GP/` (5 files, 8 tests),
all failing on the audited code. GRBL citations: gnea/grbl 1.1h at bfb67f0c,
`https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/FILE#Lnn`.

## GP-1 (high, CONFIRMED) — After `$H`, GRBL re-runs `$N` startup lines; the store keeps the pre-Home WCS, so Frame skips re-selecting G54

Homing machine boots in ALARM (HOMING_INIT_LOCK) so startup lines have not run; `$N0=G55` stored.
Connect reads `$G` → `activeWcs='G54'`. `$H` homes, runs `G55`, prints `>G55:ok` then `ok`.
Frame's `normalizeFrameWorkCoordinateSystem` sees cached `'G54'` and sends nothing, so the `$J=G90`
perimeter is traced in G55; the job preamble selects G54 and runs offset by (G54 − G55) with no
warning. Evidence: `src/ui/laser/frame-controller-readiness.ts:46-47`;
`src/ui/state/laser-line-handler.ts:89-93,303-306` (`>G55:ok` dropped as unknown); `activeWcs` only
read at connect (`laser-controller-handshake.ts:218`) and settings re-read
(`grbl-settings-actions.ts:139`); `laser-home-action.ts:137-178` never clears it;
`grbl-strategy.ts:86` preamble G54; `$J=` cannot carry G54 (gcode.c:856 error:16). Upstream:
system.c:195-199 (`system_execute_startup(line)` after homing), report.c:361-367 (`>line:ok`),
Interface wiki `[MSG:Caution: Unlocked]` ("re-homing … where any startup lines will be properly
executed"). Repro: `startup-lines-after-home.test.ts`. Fix (local): `activeWcs: null` after any
`$H` (rail, Console, Alarm banner) or re-read `$G`; optionally parse `>…:ok` G54–G59 words.

## GP-2 (high, CONFIRMED) — After ALARM:1/2 GRBL accepts only Ctrl-X; KerfDesk offers `$H`/`$X`, and Unlock leaves an owed ack that blocks everything

GRBL prints `ALARM:1|2` + `[MSG:Reset to continue]` and loops until reset (parses no lines,
answers no `?`). Banner offers Home and `$X`; ALARM:1 advice says re-home. Unlock writes `$X`,
times out after 8 s, `pendingUntrackedAcks` stays 1; Home refused, Jog/Frame fenced; no Ctrl-X
control outside Sleep; Console refuses control chars. Evidence: `src/ui/laser/AlarmRecoveryActions.tsx:20-54`;
`SafetyNoticeBanner.tsx:39` (`resetAvailable` only for Sleep); `LaserWindow.tsx:258-271`;
`laser-autofocus-actions.ts:28-45` (unlockAlarm); `laser-home-action.ts:59-62`;
`grbl/alarm-codes.ts:60,67`; no code reads `[MSG:…]`. Upstream: protocol.c:218-237 (critical
event loop `do { } while (bit_isfalse(sys_rt_exec_state,EXEC_RESET))`), limits.c:123-143,411-426;
Interface wiki "`[MSG:Reset to continue]` - Critical event message. Reset is required before Grbl
accepts any other commands." Repro: `limit-alarm-requires-reset.test.ts`. Fix (local): latch
"reset required" on `[MSG:Reset to continue]`; banner offers Reset (Ctrl-X) via `wakeController`
and holds Unlock/Home until the reboot banner; correct ALARM:1/2 text.

## GP-3 (medium, CONFIRMED) — Console/macros send `!`, `~`, `?` as plain text; `!` holds GRBL and wedges the exchange

`!` alone or inside `M8 (air on!)` executes as feed hold in the serial ISR; from Idle GRBL enters
Hold:0 and never parses the line; the owed ack fences Jog/Frame/Home; `~` is refused outside a job.
Auto-focus command has the same exposure. Evidence: `console-text.ts:65-71` (0x20–0x7E allowed);
`grbl/console-command.ts:58-60,86`; `console-command-transport.ts:85`; `autofocus-action.ts:78-85`.
Upstream: serial.c:151-154 (`case CMD_FEED_HOLD`), config.h:51-54, protocol.c:273,287,546.
Same class as ADR-362 item 1 (only ≥0x80 covered). Repro: `console-realtime-chars.test.ts`. Fix
(local, GRBL console only): send a lone `!`/`~` as realtime like `?`; refuse `!`/`~`/`?` inside
longer lines and in the auto-focus command, naming the realtime meaning.

## GP-4 (medium, CONFIRMED) — Console can enter `$C` check mode but refuses the `$C` that exits it

`$C` from Idle → Check; second `$C` refused ("requires a fresh Idle report; … reported Check").
Also Console `$H`/`$SLP` refused in Alarm though GRBL accepts them. Evidence:
`grbl/console-command.ts:83-86`, `console-command-readiness.ts:33-37`. Upstream: system.c:151-157
(`$C` in check mode → `mc_reset()`), system.c:173 (default branch accepts IDLE or ALARM). Repro:
`console-check-mode.test.ts`. Fix (local): own kind for `$C` allowed in Idle or Check; allow
Console `$H`/`$SLP` in Alarm.

## GP-5 (low, CONFIRMED) — Guarded `$x=` writes accept values GRBL truncates/rounds, then report failure after GRBL applied a different value

`$11=0.0105` stored, `$$` prints `0.011` → "did not report … after re-read"; `$26=300` (8-bit)
stored as 44 on AVR. Evidence: `grbl-settings-actions.ts:381-392` (validation), `:284-299`
(exact compare). Upstream: settings.c:229 (`uint8_t int_value = trunc(value)`), report.c:94-103,
config.h:146-147. Repro: `settings-write-precision.test.ts`. Fix (local): validate by setting
type before sending (8-bit ints 0–255, `$0` ≥ 3, floats ≤ 3 decimals, `$30/$31` ints) or compare
at GRBL's printed precision.

## GP-6 (low, traced) — Work-Z recovery stores `$#` G54 Z in inches when `$13=1` and labels it mm

`work-z-recovery-actions.ts:67`, `WorkZRecoveryControl.tsx:48,144-146`. Upstream: report.c:261,
print.c:175-181 (`printFloat_CoordValue` converts to inches). Fix: ×25.4 when reporting inches.

## GP-7 (low, traced) — Home's 120 s budget assumes `<Home|…>` replies, but GRBL answers no `?` while homing

`laser-home-action.ts:43-50,150-160`. Upstream: limits.c:320 ("No time to run
protocol_execute_realtime() in this loop"), motion_control.c:239; Interface wiki ("it will
immediately (exception: while homing) respond"). Fix: derive budget from `$130–132`, `$24/$25`.

## GP-8 (low, traced) — Error/alarm text contradicts upstream

ALARM:4 wording wrong for G38.4/.5; error:7 also means a WCS/G28/G30 slot read failed and was
re-zeroed (gcode.c:45-47,509,543; settings.c:166-170), so advise `$#`, not only `$$`; error:11
limit is 79 chars after stripping (protocol.c:141); error:14 never emitted by 1.1h.
`alarm-codes.ts:76-82`, `error-codes.ts:41-45,60-65,73`. Fix: reword.

## Checked and correct

Status fields/substates (report.c:466-654) incl. omitted WCO/Ov caching (report.c:602-649) and
`$13` conversion; ok/error/ALARM classification (alarm acks no line); `[…]` messages, `$N=`,
`$N0=` and `>line:ok` not counted as acks; banner = new session (main.c:88-102); failed probe
ALARM:4/5 + `[PRB:…:0]` + trailing ok harmless; `$J=` construction and Idle gating (gcode.c:853-857);
G10 L20 P0 unaffected by G91; EEPROM writes are owned exchanges and no job emits G10/G28.1/G30.1;
`$I` OPT order and RX 128 → 120-byte window; >0x7F refused on queued lines; comment stripping
matches protocol.c:113-148; tables otherwise match the CSVs.

## Notes

The repo GRBL simulator cannot catch GP-1/2/3 (treats `!` in Idle as no-op, no critical-event
loop, no startup lines after `$H`); repros use small fakes that follow the cited source.
