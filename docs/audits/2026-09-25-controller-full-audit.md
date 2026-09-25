# KerfDesk controller audit (2026-09-25)

Every controller KerfDesk talks to, checked against that firmware's own source. Every finding names the KerfDesk code and the upstream line that proves it, and was reproduced or traced. Every one is fixed, with a regression test.

- **Checked:** main at 39d7f96, 25 Sep 2026
- **Controllers:** GRBL 1.1h, grblHAL, FluidNC v4.0.3, the Creality Falcon A1 Pro command set, Marlin 2.1.2.8, Smoothieware edge, and the Ruida `.rd` export
- **Upstream source:** gnea/grbl `bfb67f0c`, grblHAL core `d7aaee3d`, FluidNC `25ae119b` (v4.0.3), Marlin `1cd56c4c` (2.1.2.8), Smoothieware `38e2cc08`, and meerk40t `7e82652f` as the Ruida reference
- **Fixes:** PR from `claude/focused-tesla-kb5if0`; decisions in ADR-393 to ADR-400

## Verdict

On GRBL-family controllers KerfDesk streams correctly: character counting, the RX window, realtime bytes and the status grammar all match the firmware. The trouble was in the moments around the stream, and on firmware that only looks like GRBL.

- **Marlin** was treated as GRBL without a reset byte. Abort sent `M5`, which waits behind every queued move while the laser keeps burning. Pause left the beam lit over a stopped head.
- **Smoothieware** was assumed to have every module and to reboot on a reset. KerfDesk forgot the origin the board still applied, confirmed Homes that moved nothing, and stalled on a `fire off` that nothing answered.
- **GRBL-family firmware** was treated the same way in every state. After a limit alarm the firmware accepts only a reset, but KerfDesk offered Unlock and Home, and their unanswered lines then blocked every command. After one refused line grblHAL refuses every later line, so KerfDesk's own actions failed.
- **Constant-power (M3) output**, the Neotronics 4040's default, stopped the machine with the beam lit at every pass seam, and held it lit through an air on-delay.
- **Ruida `.rd` files** carried no per-layer speed or power.

All of it is fixed in the PR, each item with a regression test. Eight ADRs record the choices that change behaviour, and none adds a Start guard: a clean Frame stays the only Start gate.

Findings: 2 critical, 10 high, 32 medium, 29 low. Two more merged into others (GP-7 into ST-4, CG-8 into HF-5), and one was dropped as a duplicate of SM-4 and MA-11 (CG-6).

## What mattered most on a running machine

**1. Marlin could not be stopped (MA-7, MA-1).** ABORT JOB and ABORT MOTION sent `M5` and `M107`. `M5` waits for the planner, so every queued move ran with the laser on first. Stream-side Pause left the last power applied over the stopped head. Abort now sends `M410`, which Marlin acts on the moment it reads it, and Pause switches the beam off behind the accepted moves (ADR-395).

**2. A lit, stopped beam in M3 jobs (OR-1).** Every multi-pass constant-power cut stopped at each pass seam with the beam on: a dot on stock GRBL, and on grblHAL or FluidNC with an air delay, a stationary lit beam for the whole delay. The output no longer drains the planner with an M3 beam lit (ADR-398). This changes the 4040's G-code.

**3. Recovery commands a controller could not take (GP-2, HF-2, HF-3, HF-7).** After a limit alarm KerfDesk offered Unlock and Home. Stock GRBL answers nothing, and the owed answer blocked every later command. One refused line on grblHAL made Set origin, Zero Z, air and jog fail with a stale error. The Alarm banner now offers Reset (ADR-393), and KerfDesk clears grblHAL's latched error the firmware's own way (ADR-400).

**4. Stop keys and tool changes (CG-12, ST-1).** Ctrl+. did nothing during a Frame or jog on Marlin, Smoothieware and the Falcon. Tool-change Continue could start the next section while the operator's jog was still moving. Both are fixed.

**5. Origins the controller kept but KerfDesk forgot (SM-1, CG-1, CG-2, MA-2, CG-11).** A Smoothieware G92 survives a reconnect; Absolute jobs ran displaced by it. The Frame's G54 step dropped the operator's origin. On Marlin, User Origin, Current Position and Absolute stopped resolving after Set origin, and Reset origin on a stock build did nothing (ADR-396).

## Decisions to review

Each is recorded in an ADR and can be revisited.

1. **ADR-398, the 4040's G-code changes.** M3 output gains laser-off moves and loses the between-pass re-arm. Air-cut one multi-pass constant-power job on the 4040 before production.
2. **ADR-395, Marlin Abort quick-stops.** `M410` halts the motors without deceleration, so the position may slip. KerfDesk says to re-home or re-check the origin.
3. **ADR-398, restarts may repeat work.** After a stop that discards the planner, the automatic restart steps back over the whole planner (15 blocks on GRBL and Marlin, 100 on grblHAL) unless a status report showed the backlog. Repeating a few moves is preferred to skipping some.
4. **ADR-397, Smoothieware without its Laser module.** A laser job runs with the laser off and Job Review says so. It is not refused, per the Frame-first rule. Home is confirmed only when `G28.6` reports X and Y homed.
5. **ADR-400, Disconnect and Home timing.** Disconnect on Marlin or Smoothieware waits up to 1 s for the stop lines to be answered. A Home on stock GRBL or grblHAL is bounded by the controller's own `$$` settings, with a 30-minute backstop when `$$` was not read.
6. **ADR-398 and ADR-399, left as they are with a note.** The xTool D1 Pro profiles keep `$J=` jog and Frame, and their evidence note says xTool's own file turns `$J` off. A tiled CNC export on the Ruida profile still writes GRBL tiles, now with a warning.
7. **ADR-396, Marlin origins.** KerfDesk records the G92 shift it writes itself. A shift set before KerfDesk connected is invisible to it until a restart or Home.

Next step: on hardware, check items 1, 2 and 4, and the Falcon's per-axis Home (HF-1), which could only be traced.

## GRBL protocol

What GRBL-family controllers answer, and whether KerfDesk reads it right.

### GP-1: After Home, GRBL runs its startup lines, but KerfDesk kept the old coordinate system, so Frame and job could land in different places

**High** · New · Reproduced and traced

A machine with homing enabled starts in Alarm, so GRBL skips its `$N` startup lines at power-up. If one of them is `G55`, the controller is still in G54 when KerfDesk reads it at connect. After a full `$H`, GRBL runs the startup lines, switches to G55 and prints `>G55:ok`. KerfDesk dropped that line as unknown and went on believing G54 was active.

Frame then skipped its G54 selection and traced the outline in G55. Start sent the program, which selects G54, so the job cut away from the traced outline, shifted by the difference between the two offsets. Nothing warned.

**Fix.** A completed Home and a Console `$H` now read the coordinate system again with `$G`, so Frame selects G54 when a startup line chose another one (`5eb2835`, ADR-396).

**Evidence.**

- `activeWcs` changes only on a `[GC:` line (`laser-line-handler.ts:194-200`). `>G55:ok` classifies as unknown (`grbl/response.ts:55-61`), goes to banner detection and is dropped (`laser-line-handler.ts:89-93,303-306,319`). Home never touches `activeWcs` (`laser-home-action.ts:100-122`); only connect and a settings re-read set it (`laser-controller-handshake.ts:218`, `grbl-settings-actions.ts:139`).
- Frame returns early when the cached value is G54 (`frame-controller-readiness.ts:44-47`). A `$J=` line cannot carry G54 (`gcode.c:856`, error:16), and the program preamble selects G54 (`grbl-strategy.ts:86`).
- GRBL boots into Alarm when homing is enabled and runs the startup lines only outside Alarm (`main.c:65-67`, `protocol.c:52-63`). It runs them after a full `$H` (`system.c:195-199`) and echoes each one as `>line:ok` (`report.c:361-367`).
- Reproduction: `startup-lines-after-home.test.ts` failed on the audited code: `activeWcs` stayed G54 and the Frame wrote no G54.
- Regression tests: `laser-home-startup-wcs.test.ts`, `laser-lifecycle-falcon.simulator.test.ts`.

**Sources.**

- [gnea/grbl system.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L195-L199): "Execute startup scripts after successful homing."
- [GRBL wiki: Interface](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface): "A reset or re-homing Grbl is highly recommended as soon as possible, where any startup lines will be properly executed."

### GP-2: After a limit alarm GRBL accepts only a reset, but KerfDesk offered Home and Unlock, and an unanswered Unlock blocked everything else

**High** · New · Reproduced and traced

A hard limit (ALARM:1) or a soft limit (ALARM:2) is a critical event. GRBL prints `[MSG:Reset to continue]` and then waits for Ctrl-X: it runs no line and answers no status query. KerfDesk ignored that message. The Alarm banner said "Re-home the machine ($H) after clearing the obstruction." and offered Home and `$X — Unlock`. The only Reset button was in the Sleep banner, and the Console refuses control characters.

Unlock sent `$X`, got no answer and reported "Unlock (clear alarm) timed out." after 8 s. The unanswered line stayed owed, so Home, Jog and Frame were refused from then on. The only ways out were Disconnect, which happens to send Ctrl-X, or a power cycle. grblHAL (error:79 to Unlock and Home) and FluidNC (`ok` to `$X` while it stays locked) have the same lock; they are HF-3 and HF-2, fixed by the same change.

**Fix.** KerfDesk now latches "reset required" when the controller prints its "Reset to continue" message. While it is latched, the Alarm banner offers a single Reset (Ctrl-X) button, and Unlock, Home and every Console line except `?` refuse with a message that names the reset. The ALARM:1 and ALARM:2 texts say the reset comes first (`c7b83f5`, texts `be7d8c6`, ADR-393).

**Evidence.**

- The Alarm banner offers Home and Unlock only (`AlarmRecoveryActions.tsx:20-54`, `LaserWindow.tsx:273-312`); Wake (Ctrl-X) exists only in the Sleep banner (`LaserWindow.tsx:258-271`, `SafetyNoticeBanner.tsx:39`). No code at 39d7f96 reads "Reset to continue", and the ALARM:1 and 2 advice names no reset (`alarm-codes.ts:60,67`).
- Unlock is an owned `$X` with the default 8 s timeout (`laser-autofocus-actions.ts:28-45`, `laser-interactive-command.ts:106`). An owed answer blocks Home (`laser-home-action.ts:59-63`) and jogs (`laser-jog-actions.ts:262-268`).
- GRBL `protocol.c:224-236`: after ALARM:1 or 2 it prints the critical-event message, clears the reset flag and spins in an empty loop that tests only for a new reset, so no `?` is answered. `limits.c:126-127` and `limits.c:425-426` raise the two alarms.
- Reproduction: `limit-alarm-requires-reset.test.ts` failed: it wrote `$X`, timed out and left one owed answer.
- Regression tests: `controller-reset-required.test.ts`, `AlarmBanner.test.tsx`, `start-blocked-fix-offers.test.ts`, `response-presentation.test.ts`.

**Sources.**

- [gnea/grbl protocol.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L225-L235): "Halt everything upon a critical event flag. Currently hard and soft limits flag this."
- [GRBL wiki: Interface](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface): "[MSG:Reset to continue] - Critical event message. Reset is required before Grbl accepts any other commands."

### GP-3: A `!` in a Console line or macro held GRBL, so the line never finished and Jog, Frame and Home stayed blocked

**Medium** · New · Reproduced and traced

GRBL takes `?`, `~` and `!` out of the incoming bytes wherever they appear, even inside a comment, and acts on them at once; `!` is feed hold. The Console allowed every printable character and sent them inside the line. So a lone `!`, or a macro line like `M8 (air on!)`, put an Idle GRBL into Hold before the line ran. The line then waited in GRBL's hold loop, and its `ok` never came. The auto-focus command in the machine profile had the same gap.

The owed answer blocked Jog, Frame and Home, and the Console refused `~`, the byte that releases a hold, with "Manual motion requires a fresh Idle report; the controller reported Hold." Only Disconnect, which sends Ctrl-X, got out. ADR-362 item 1 had blocked only bytes above 0x7F.

**Fix.** A Console or auto-focus line that contains `!`, `~` or `?` is refused with the character's realtime meaning, and a lone `~` is sent as the cycle-start byte (`b0e0ae4`, ADR-400).

**Evidence.**

- `console-text.ts:65-72` allows every character from 0x20 to 0x7E. `grbl/console-command.ts:58-60,83-86` treats only a lone `?` as realtime and queues anything else with a newline, which owes an answer (`console-command-transport.ts:85`). `autofocus-action.ts:78-88` checks the auto-focus command only for empty and multi-line text.
- GRBL `serial.c:148-154` picks the three characters out in the receive interrupt. From Idle, `protocol.c:273,287` completes the feed hold at once and sets Hold. The line's end-of-line check point (`protocol.c:81`, `protocol.c:207-208`) then waits in `while (sys.suspend)` (`protocol.c:546`) until a `~`.
- Reproduction: `console-realtime-chars.test.ts` failed: `!` was queued as a line, one answer stayed owed, and `~` was refused.
- Regression tests: `console-command.test.ts`, `laser-store-console-realtime.test.ts`, `autofocus-action.test.ts`.

**Sources.**

- [gnea/grbl serial.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/serial.c#L148-L154): "Pick off realtime command characters directly from the serial stream. These characters are not passed into the main buffer, but these set system state flag bits for realtime execution."
- [gnea/grbl protocol.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L272-L273): "If IDLE, Grbl is not in motion. Simply indicate suspend state and hold is complete."

### GP-4: The Console could enter check mode with `$C` but refused the `$C` that leaves it

**Medium** · New · Reproduced and traced

`$C` from Idle puts GRBL in check mode, where it parses lines but moves nothing. The only way out is a second `$C`, which also soft-resets GRBL. KerfDesk treated `$C` as G-code that needs Idle, so the second `$C` was refused with "Manual motion requires a fresh Idle report; the controller reported Check." Jog, Frame and Start need Idle too, so the operator had to disconnect or power-cycle.

The same rule refused a Console `$H` or `$SLP` in Alarm, which GRBL accepts. The Alarm banner's Home still worked.

**Fix.** `$C` is accepted in Idle or Check mode, and a Console `$H` or `$SLP` in Alarm (`b0e0ae4`, ADR-400).

**Evidence.**

- `grbl/console-command.ts:83-86` classifies `$C` as `gcode` with `requiresIdle`. `console-command-readiness.ts:33-37,53-55` and `manual-motion-fresh-idle.ts:66-70` refuse it in any other state.
- GRBL `system.c:147-158`: in check mode, `$C` calls `mc_reset()` and prints `[MSG:Disabled]`. `system.c:172-173` lets `$H` and `$SLP` run in Idle or Alarm.
- Reproduction: `console-check-mode.test.ts` failed on the audited code.
- Regression tests: `console-command.test.ts`, `laser-store-console-realtime.test.ts`.

**Sources.**

- [gnea/grbl system.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L147-L158): "Perform reset when toggling off."
- [GRBL wiki: Commands](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands): "When toggled off, Grbl will perform an automatic soft-reset (^X)."

### GP-5: Settings that GRBL rounds or cannot store were reported as failed writes after GRBL had changed them

**Low** · New · Reproduced and traced

Machine Settings sent whatever number the operator typed. GRBL 1.1h keeps its integer settings in one byte and prints decimal settings to three places, and it answers `ok` either way. KerfDesk then re-read `$$` and required the exact typed number. `$11=0.0105` is stored but printed as `0.011`. `$26=300` does not fit in a byte, so GRBL keeps a different number (44 on an AVR board). KerfDesk reported "Controller did not report $11=0.0105 after re-read." and marked qualification failed, although the controller had changed.

**Fix.** Stock GRBL integer and on/off values that GRBL cannot store are refused before sending. The re-read is compared at the precision GRBL prints, and a difference names the stored value (`2fa1ac0`, ADR-400).

**Evidence.**

- `grbl-settings-actions.ts:381-392` checks only that the value is numeric, plus `$30`, `$31` and `$32`. `grbl-settings-actions.ts:285-287` and `:295-299` require the exact number after `$$`, and `:316` marks qualification failed.
- GRBL `settings.c:229` stores non-axis settings through `uint8_t int_value = trunc(value);`, `$26` included (`settings.c:285`). `report.c:193` prints `$11` with `N_DECIMAL_SETTINGVALUE`, 3 places (`config.h:146`); GRBL's single-precision `printFloat` (`print.c:133-146`) turns 0.0105 into `0.011`.
- Reproduction: `settings-write-precision.test.ts` failed: the value was sent, then "did not report".
- Regression tests: `grbl-setting-storage.test.ts`, `grbl-settings-write-precision.test.ts`.

**Sources.**

- [gnea/grbl settings.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/settings.c#L227-L229): "Store non-axis Grbl settings" and "uint8_t int_value = trunc(value);"
- [gnea/grbl config.h](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/config.h#L146): "Decimals for floating point setting values"

### GP-6: With `$13=1`, Work-Z recovery showed an offset read in inches as millimetres

**Low** · New · Traced

With `$13=1` (report in inches) GRBL prints every `$#` offset in inches. Work-Z recovery stored the G54 Z it read as millimetres and showed it that way, so a -20 mm offset read "-0.787 mm". The value is used only for that text, so nothing moved wrongly, but the operator was shown the wrong number to check.

**Fix.** A `$#` read under `$13=1` is converted to millimetres (`be7d8c6`, ADR-400).

**Evidence.**

- `work-z-recovery-actions.ts:67` stores `offsetZMm: after.offset.z` unscaled; `WorkZRecoveryControl.tsx:48,144-146` shows it with "mm".
- GRBL `report.c:261` prints the offsets through `report_util_axis_values` and `printFloat_CoordValue` (`report.c:39-45`), which converts to inches under `$13=1` (`print.c:175-181`).
- Regression test: `work-z-controller-recovery.test.ts`.

**Sources.**

- [gnea/grbl print.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/print.c#L173-L181): "CoordValue: Handles all position or coordinate values in inches or mm reporting."

### GP-8: Three error and alarm texts contradicted GRBL's own meaning

**Low** · New · Traced

ALARM:4 said the probe was already triggered when the cycle started. That is right for G38.2 and G38.3; for G38.4 and G38.5 it means the probe was not triggered. error:7 said settings were reset and to check `$$`. GRBL 1.1h also sends it when a G54-G59, G28 or G30 slot fails to read, and then rewrites that slot as zeros, so the work offset changed: `$#` shows that, `$$` does not. error:11 gave the line limit as 80 characters; GRBL allows 79, counted after it drops spaces and comments.

**Fix.** ALARM:4 names both probe directions, error:7 points at `$#` as well as `$$`, and error:11 gives the 79-character limit (`be7d8c6`, ADR-400).

**Evidence.**

- `alarm-codes.ts:76-82` (ALARM:4), `error-codes.ts:41-45` (error:7), `error-codes.ts:60-65` (error:11).
- GRBL `settings.c:166-170` zeroes a slot that fails to read, and `gcode.c:509,543,614-616` and `report.c:250-251` answer error:7 for it. `protocol.c:141` flags an overflow at `LINE_BUFFER_SIZE-1`, 79 of the 80 bytes (`protocol.h:32`).
- Regression test: `response-presentation.test.ts`.

**Sources.**

- [gnea/grbl alarm_codes_en_US.csv](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/csv/alarm_codes_en_US.csv#L5): "Probe fail. Probe is not in the expected initial state before starting probe cycle when G38.2 and G38.3 is not triggered and G38.4 and G38.5 is triggered."
- [gnea/grbl settings.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/settings.c#L162-L171): "Reset with default zero vector"

## GRBL streaming

How a job is fed to a GRBL-family controller, how its answers are counted, and how control passes between the job and the operator.

### ST-1: Continue at a tool change sent the job while the operator's jog was still moving, so GRBL refused it and KerfDesk reset a moving machine

**High** · New · Reproduced and traced

At a CNC tool change the operator touches off the new bit, sets Zero Z and usually jogs Z up. Continue checked the drained hold with one fresh Idle since it began, the new Z zero, the probe plate and the bit. It did not check that the jog had stopped. Pressed while the jog was still running, Continue sent the next job lines. GRBL refuses G-code during a jog with error:9, KerfDesk treated that as a failed job and sent its automatic soft reset, and a reset during a jog kills the steppers mid-move: ALARM:3, position lost, and the job lost at the tool change.

Continue also ignored an operator command still waiting for its `ok`, such as a second Zero Z or the settle marker KerfDesk sends after a jog. KerfDesk booked that `ok` to the job. It then either believed GRBL had room for a line it did not have, so the next refill could overrun GRBL's 128-byte receive buffer, or it kept one answer owed for good, so after the job Start, Jog, Frame and Home were refused until a reconnect.

**Fix.** Continue now also waits until no motion or controller operation is running, no answer is owed and the latest status report is Idle. These are handoff facts, not a Start rule (`239b615`, ADR-400).

**Evidence.**

- `toolChangeContinueBlockMessage` checks the pendant, the drained hold, Work Z, the probe plate and the bit only (`laser-store-helpers.ts:110-134`); its Idle latches once per hold (`laser-status-line.ts:307-316`). `laser-job-actions.ts:450-469` then writes the next lines, and `LiveMotionBar.tsx:130-137` enables Continue whenever that check passes.
- While a job streams, every `ok` and `error` belongs to the job (`laser-stream-ack.ts:70-71`, `laser-store-helpers.ts:142-151`), and a job `error:N` triggers the soft reset (`laser-error-line.ts:110-152`).
- GRBL answers G-code in Jog with error:9 (`protocol.c:99-101`) and raises ALARM:3 and kills the steppers on a reset during a jog (`motion_control.c:380-385`). grblHAL (`protocol.c:256-263`) and FluidNC v4.0.3 (`ProcessSettings.cpp:1241-1243`) refuse G-code in Jog the same way.
- Reproduction: `tool-change-continue-during-jog.test.ts` failed (lines written in Jog, stream errored, 0x18 sent, ALARM:3). `tool-change-continue-owed-ack.test.ts` failed in 2 cases: an owed answer stuck after the job, and a jog marker's `ok` taken by the job (in-flight lines 6 to 5).
- Regression tests: both tests, now beside the code, plus `setup-blocking-gate.test.ts`, `LiveMotionBar.test.tsx` and `laser-hosted-refill-tool-change.test.ts`.

**Sources.**

- [gnea/grbl protocol.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L99-L101): "Everything else is gcode. Block if in alarm or jog mode."
- [gnea/grbl motion_control.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L380-L385): "Force kill steppers. Position has likely been lost."

### ST-4: On stock GRBL and grblHAL a Home longer than 120 s was reported as rejected while the machine went on homing

**Medium** · New · Reproduced and traced

Stock GRBL answers no status query while it homes, and neither does grblHAL at its default settings. KerfDesk gave each Home line 120 s and restarted that clock only on a status report, on the belief that GRBL answers `<Home|…>` throughout. Large or slow machines take longer: at the default `$25=500`, a 1000 mm axis homed from the far end needs 120 s for the XY search alone, before Z and the slower locate passes. At 120 s KerfDesk showed "Controller rejected a command" with "home timed out.", set homing to unknown and released the controls while the machine was still homing.

GP-7 merged here.

**Fix.** On stock GRBL and grblHAL each Home line now waits for the longest cycle its `$$` settings allow. Per axis on stock GRBL that is a search of 1.5 times the travel at `$25`, two `$27` pull-offs at `$25`, a locate of 5 times `$27` at `$24` and a `$26` debounce per move. grblHAL locates at 10 times `$27`, `$43` times, with a pull-off before and after each locate. The sum is multiplied by 1.5, plus 30 s, never under 120 s, and 30 minutes when `$$` was never read. The firmware itself raises ALARM:8 or 9 when a switch is not found. A Home that ends without the controller's answer now says "Home did not finish"; only an `error:N` is shown as a rejection. FluidNC homes from its main loop, keeps answering, and keeps the 120 s status budget (`388afa3`, grblHAL `9f19d3c`, ADR-400).

**Evidence.**

- `laser-home-action.ts:43-50` sets `HOME_COMMAND_TIMEOUT_MS = 120_000` and says "<Home|...> poll replies keep the command alive". `laser-home-action.ts:152-160` uses `non-idle-status-activity`, and `laser-interactive-command.ts:387-398` restarts the clock only on a non-Idle report.
- The timeout became a `controller-error` notice titled "Controller rejected a command" (`laser-home-action.ts:217`, `SafetyNoticeBanner.tsx:18`).
- GRBL runs no realtime work inside its homing loop (`limits.c:320`), so `?` goes unanswered until the cycle ends; `limits.c:328-330` raise ALARM:8 and 9. The default `$25` is 500 mm/min (`defaults.h:63`).
- grblHAL serves a status request inside its homing loop only with "report when homing" (bit 12 of `$10`) on (`machine_limits.c:336-337`, `:445-447`), and it is off by default (`config.h:751-753`). Its locate is 10 times `$27` (`config.h:434`), repeated `$43` times (`machine_limits.c:272`, `:517`).
- Reproduction: `grbl-home-without-status.test.ts` failed: homing `unknown` and the timeout notice at 130 s with no status replies.
- Regression tests: `laser-home-silent-grbl.test.ts`, `laser-home-silent-grblhal.simulator.test.ts`, `grbl-homing-duration.test.ts`, `grbl-family-drivers.test.ts`.

**Sources.**

- [gnea/grbl limits.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L320): "Exit routines: No time to run protocol_execute_realtime() in this loop."
- [GRBL wiki: Interface](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface): "it will immediately (exception: while homing) respond"
- [grblHAL machine_limits.c](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/machine_limits.c#L336-L337): "if(settings.status_report.when_homing)"

### ST-2: The in-repo GRBL simulator was more forgiving than GRBL 1.1h, so tests passed that real GRBL would fail

**Medium** · New · Reproduced and traced

The store and lifecycle tests run against a GRBL simulator, and it differed from GRBL 1.1h in eight ways the audit reproduced. It accepted G-code during a jog, where GRBL answers error:9; this is how ST-1 got through. It answered a status query after ALARM:1 or 2, where GRBL answers nothing. It ended lines only on LF, where GRBL also ends a line on CR. It answered M0 and G4 at once, where GRBL first drains the planner, then holds or dwells. It answered lines during a completed feed hold, where GRBL parses none. It reported a software door as Door:1 yet resumed it on `~`. It modelled 16 planner blocks where GRBL uses 15. It also answered `<Home|…>` while homing, which hid ST-4.

**Fix.** The simulator now follows GRBL 1.1h, with gnea/grbl line citations: error:9 in Jog, CR and LF each end a line, no line parsed inside G4, M0, a completed hold, homing or a critical alarm, no status while homing or after ALARM:1 or 2, Door:0 for a software door, 15 planner blocks and a 128-byte receive ring. A grblHAL mode keeps grblHAL's differences, and stays silent while homing at grblHAL's default settings (`3f807b4`, `ac571e5`, ADR-400).

**Evidence.**

- `grbl-sim-machine.ts:147-156` (Hold:0 and Door:1 labels), `:166-196` (realtime bytes), `:366-367` (G-code refused only when locked); `grbl-simulator.ts:30` (six realtime bytes), `:67-80` (only LF ends a line); `grbl-sim-planner.ts:30-31` (16 blocks).
- GRBL: `protocol.c:79` (CR or LF ends a line), `protocol.c:99-101` (Jog lock-out), `protocol.c:226-236` (critical loop); `motion_control.c:195-200` (G4 drains, then dwells); `gcode.c:1084-1090` (M0 drains, then holds); `system.c:87-93` with `report.c:490-500` (Door:0 without a door input); `planner.c:498-502` (15 usable blocks); `serial.c:24` (128-byte ring); `limits.c:320` (no status while homing).
- Reproduction and regression test: `grbl-simulator-fidelity.test.ts`, 8 cases, all failed on the audited simulator. It now sits beside the simulator with `grbl-sim-rx-window.test.ts` and `grbl-sim-planner.test.ts`.

**Sources.**

- [gnea/grbl protocol.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L79): "if ((c == '\n') || (c == '\r')) { // End of line reached"
- [gnea/grbl planner.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/planner.c#L497-L502): "return((BLOCK_BUFFER_SIZE-1)-(block_buffer_head-block_buffer_tail));"

### ST-3: Every Alarm status report cancelled the operator's Unlock, although GRBL still runs lines in Alarm

**Low** · New · Reproduced and traced

KerfDesk treated every `<Alarm|…>` report as a new alarm: it dropped owed answers and failed the command in progress with "Controller entered Alarm.". GRBL answers a pending status query at the end of each line, just before it runs that line. So the report that answers a `?` sent as the operator pressed Unlock can still read Alarm, and KerfDesk rejected an Unlock that GRBL then carried out, printing `[MSG:Caution: Unlocked]` and `ok`. The operator saw a failed Unlock on a machine that had unlocked; the next Idle report put the display right. Home already allowed for this late reply; Unlock did not.

**Fix.** Only the report that enters Alarm or Sleep voids owned commands, owed answers and position evidence. A repeated Alarm report updates the display and still fails a wait for Idle (`eece3db`, ADR-400).

**Evidence.**

- `laser-status-line.ts:53-56` sends every Alarm or Sleep report to `handleInvalidatingStatus` (`laser-status-line.ts:252-294`), which advances the write epoch, sets `pendingUntrackedAcks: 0` and cancels the command with "Controller entered Alarm.". Only Home has a late-reply window (`laser-home-alarm-reply.ts:27-37`); Unlock is an owned `$X` (`laser-autofocus-actions.ts:28-45`).
- GRBL runs its realtime check point at the end of a line (`protocol.c:81`) and then the `$` line (`protocol.c:96-98`); `$X` unlocks from Alarm (`system.c:160-168`); the receive buffer is cleared only on a reset (`main.c:88`).
- Reproduction: `alarm-report-drops-owed-ack.test.ts` failed: outcome "Controller entered Alarm.", alarm code 1 kept.
- Regression test: `laser-alarm-report-repeat.test.ts`.

**Sources.**

- [gnea/grbl protocol.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L79-L98): "protocol_execute_realtime(); // Runtime command check point."
- [GRBL wiki: Interface](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface): "[MSG:Caution: Unlocked] - Appears as an alarm unlock $X acknowledgement. An 'ok' still appears immediately after to denote the $X was parsed and executed."

### ST-5: A spindle spin-up dwell was announced as "CONTROLLER HOLDING PROGRAM"

**Low** · New · Reproduced and traced

Every CNC job start and tool-change Continue sends `M3 S…` and then `G4 P<spin-up>`. GRBL drains the planner, dwells, and only then answers the G4; meanwhile it reports Idle. With a spin-up of 3 s or more (the default is 3 s) the live bar switched to "CONTROLLER HOLDING PROGRAM" ("The controller reports Idle and has not acknowledged the last N sent lines…"), and the log recorded "Controller holding program … KerfDesk is connected and waiting", while the controller was simply running the program. Same family as MA-9.

**Fix.** When the oldest unanswered line is a `G4 P<s>` dwell, the bar shows "DWELLING (SPINDLE SPIN-UP)" for its programmed time plus 2 s, with no hold notice (`d1928d3`, ADR-395).

**Evidence.**

- `laser-stream-hold.ts:48` (`STREAM_HOLD_VISIBLE_MS = 3_000`) and `laser-stream-hold.ts:66-82` (`streamHoldFromProbe` never looks at which line is waiting); the bar heading is `LiveMotionBar.tsx:247` and the log line `laser-stream-hold.ts:139-145`.
- `cnc-grbl-transitions.ts:116-129` writes `G4 P<spinupSec>` after every `M3`, and `machine.ts:274` defaults the spin-up to 3 s.
- GRBL `motion_control.c:195-200`: `mc_dwell` syncs the planner, then calls `delay_sec`, which serves status queries every 50 ms (`nuts_bolts.c:112-126`, `config.h:414`).
- Reproduction: `stream-hold-during-dwell.test.ts` failed: a hold was reported 4 s into a 5 s dwell.
- Regression tests: `laser-stream-hold.test.ts`, `LiveMotionBar.hold.test.tsx`.

**Sources.**

- [gnea/grbl motion_control.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L194-L200): "protocol_buffer_synchronize();" then "delay_sec(seconds, DELAY_MODE_DWELL);"

## Serial connection

Opening, qualifying and closing the serial port, in the browser and desktop transports.

### TC-1: The connect handshake asked for status once, so a controller still busy at connect failed qualification

**Medium** · New · Reproduced and traced

After the port opened, KerfDesk sent one `?` and waited up to 8 s for an Idle report. GRBL reports status only when asked, and the regular 4 Hz poll starts only after the handshake. A controller still busy when the port opened answered that one `?` with Run, Jog, Home, Hold or Door and was never asked again. That happens when a board that does not reset on open is still draining motion, jogging, homing or held. After 8 s the connection showed "Timed out waiting for fresh Idle.", qualification was marked failed, and nothing retried when the machine reached Idle seconds later.

A second trigger is plausible on real hardware: a board that reboots on open and prints boot text before its banner, such as FluidNC, can lose the one `?` during start-up. In the reproduction that held the handshake for about 8.5 s. ADR-362 had fixed this wait only for Alarm and Sleep.

**Fix.** The handshake repeats `?` every 250 ms while it waits for Idle. After 8 s it hands a busy controller to the qualification scheduler instead of failing; the scheduler keeps waiting while fresh non-Idle reports arrive and qualifies on the first Idle. The same change fixed a controller that connected in Alarm, whose reports the scheduler never counted as fresh (`47d291e`, `ae8f5f5`, ADR-400).

**Evidence.**

- `laser-controller-handshake.ts:341-379` (`waitForHandshakeIdle`) writes one `?` and waits. `laser-interactive-command.ts:285-296,345-348` time out after 8 s without a status report. `laser-connection-actions.ts:170-202` starts the poll only in `.finally` and marks qualification failed in `.catch`. `laser-controller-qualification.ts:207-212` keeps waiting only for Alarm or Sleep.
- GRBL prints a status report only when a `?` has set its flag (`protocol.c:249-253`). FluidNC v4.0.3 logs `[MSG:INFO: FluidNC …]` during setup (`Main.cpp:53`), clears its receive buffer before the banner (`Protocol.cpp:396-397`) and reads input only from its main loop (`Protocol.cpp:240-242`).
- Reproduction: `tc-1-handshake-one-shot-idle-probe.test.ts`, both cases failed. Busy: queries at 250 ms, 555 ms, then 9,560 ms, and qualification still failed at 20 s although the machine was Idle from 3 s. Boot text: qualified only at 9,750 ms.
- Regression tests: `laser-controller-handshake-busy.test.ts`, `laser-controller-qualification-alarm-wait.test.ts`.

**Sources.**

- [gnea/grbl protocol.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L249-L253): "Execute and serial print status"
- [FluidNC Protocol.cpp](https://github.com/bdring/FluidNC/blob/25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f/FluidNC/src/Protocol.cpp#L396-L397): "allChannels.flushRx();"

### TC-2: The serial transport's comments described UTF-8 writes that the code does not do

**Low** · New · Traced

The browser transport's header said "Write pipeline: string → UTF-8 → port.writable", and the connection type said "Write a string (UTF-8)". The code writes one byte per character, so a realtime command such as jog cancel (0x85) leaves as the single byte GRBL acts on. It reads with a streaming TextDecoder, not the TextDecoderStream the header names. Nothing misbehaved; the comments would mislead the next person who changes the wire code.

**Fix.** The three comments now describe what the code does (`9ee73d9`, ADR-400).

**Evidence.**

- `web-serial.ts:7-8` and `platform/types.ts:132`. The code uses `encodeWireBytes`, one byte per character (`serial-wire.ts:19-25`), and `new TextDecoder('utf-8')` with `{ stream: true }` (`serial-read-loop.ts:67,75`).
- GRBL treats every byte above 0x7F as a realtime command, acts on the ones it knows, discards the rest, and never puts one in the line buffer (`serial.c:156-186`).

**Sources.**

- [gnea/grbl serial.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/serial.c#L156): "Real-time control characters are extended ACSII only."

### TC-3: Disconnect closed the port in the same moment it sent M5 and M9, without waiting for the controller to take them

**Low** · New · Reproduced (plausible on real hardware)

On a controller that gets no realtime reset at Disconnect, KerfDesk writes its stop lines and then closes the port. On Smoothieware, idle with Manual Air on, it wrote `M5` and `M9` and closed the port in the same millisecond, without waiting for the two `ok`s it already owed. Closing drops DTR, and Smoothieware's USB code empties its receive buffer when DTR drops. An `M9` lost that way would leave the air running while KerfDesk showed Disconnected. With a job running KerfDesk sends Ctrl-X first, and Smoothieware's halt sets its switch outputs to their halt values, so only the idle Manual Air case is exposed.

The same Smoothieware loop marks the port attached again whenever unread bytes are waiting, before it checks for the detach. So a buffered `M9` is lost only if DTR drops between those two checks. The window is narrow; waiting for the answers closes it at a cost of at most 1 s.

**Fix.** Disconnect without a realtime reset now waits up to 1 s for the stop lines' answers before closing the port, except while a job stream owns the answers. If the time runs out, it logs that the stop was not acknowledged and closes as before (`68939cc`, ADR-400).

**Evidence.**

- `laser-connection-actions.ts:345-369` (`stopBeforeDisconnect`) awaits only the transport write on controllers outside the GRBL family, and `laser-connection-actions.ts:316-324` then closes. Idle with Manual Air on, the stop lines are `M5` and `M9` (`laser-store-helpers.ts:207`, `smoothieware/commands.ts:31`).
- Smoothieware `USBCDC.cpp:183-189` calls `on_detach()` when DTR drops, and `USBSerial.cpp:338-343` then flushes the receive buffer before the next line is dispatched (`USBSerial.cpp:350-366`). `USBSerial.cpp:324-326` re-attaches while bytes are available, which keeps buffered lines in the ordinary case. `Switch.cpp:62-76` sets switch outputs to their halt value on a halt.
- Reproduction: `tc-3-smoothie-disconnect-cleanup-before-detach.test.ts` failed: `M5`, `M9` and the close at 3,000 ms, the two `ok`s at 3,020 ms.
- Regression tests: `laser-disconnect-stop.test.ts`, `laser-lifecycle-marlin.simulator.test.ts`.

**Sources.**

- [Smoothieware USBSerial.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/USBDevice/USBSerial/USBSerial.cpp#L322-L345): "apparently some OSes don't assert DTR when a program opens the port" and "rxbuf.flush();"

### TC-4: When the read side ended on its own, the browser transport never closed the port

**Low** · New · Reproduced

An UnknownError read, or eight line errors in a row with no data between them, ends the browser-thread session, and KerfDesk shows Disconnected. It never called `port.close()`. The page kept the port open, with DTR asserted, until the next Connect's stale-port sweep or a page reload, which can stop another program from opening the controller. Because the session was already marked closed, a later Disconnect or Forget skipped the close too. The desktop worker transport already closes its port on the same events (ADR-354 decision 6).

**Fix.** When the read side ends on its own, the transport closes the port once the streams are released, unless a Disconnect already owns that close (`9ee73d9`, ADR-400).

**Evidence.**

- `web-serial.ts:194-198` (`handleDroppedConnection`) removes the listener, closes the streams and reports the close; it is also the read loop's end handler (`web-serial.ts:201`, `serial-read-loop.ts:48-51`). Only `closeConnection` and `forgetConnection` call `port.close()` (`web-serial.ts:203-241`), and both skip it once the session is marked closed (`web-serial.ts:204,219-220`).
- UnknownError is never recovered, and eight recoveries without data end the session (`serial-read-recovery.ts:18-26,35-39`).
- The worker closes on the same events: `native-serial-worker-runtime.ts:47-55,223-241`.
- Reproduction: `tc-4-main-thread-port-left-open.test.ts`, both cases failed: `port.opened` stayed true.
- Regression tests: `web-serial-line-errors.test.ts`, `web-serial.test.ts`.

## grblHAL, FluidNC and the Falcon

grblHAL, FluidNC and the Creality Falcon A1 Pro command set, where each one differs from stock GRBL.

### HF-7: After one refused line grblHAL refuses every later G-code line, so KerfDesk's own actions failed and a refused jog stayed stuck

**High** · Incomplete fix of ADR-361 · Reproduced and traced (plausible on real hardware for the Falcon)

grblHAL, at its default compatibility level, remembers the error of a refused line and answers every later G-code line with that same error without running it. Only an empty line, a `$` line, a jog-cancel or a reset clears it. Stock GRBL and FluidNC judge each line on its own, and KerfDesk treated grblHAL the same way.

One Console typo, such as `G1 X10` with no feed rate (`error:22`), then made Set origin here, Zero Z, Manual Air and the Frame's opening `M5` fail with the stale error; Manual Air OFF showed OFF while the pump kept running. A jog past the soft limits (`error:15`) was worse. ADR-361's automatic release sends `G4 P0.01`, which is G-code, so both attempts failed and the jog stayed stuck: Jog, Frame, Home and Start refused as busy on an Idle machine, Disconnect was disabled, and only ABORT MOTION, or Ctrl+. on generic grblHAL, got out.

On the Falcon contract every jog and Frame is a plain `G1`, Ctrl+. sends nothing, and a refused Release motors (HF-4) is enough to start it. That holds for a Falcon that prints a "GrblHAL" banner; one that prints "Grbl 1.1f" has HF-8 instead.

**Fix.** After an `error:N` to a line outside a job stream, drivers with the new `stickyLineError` capability (grblHAL, and the Falcon contract on it) send one empty line once every line in flight has its reply. grblHAL answers `ok` and forgets the error. Stock GRBL and FluidNC get nothing extra (`ceb89af`, ADR-400).

**Evidence.**

- `laser-motion-cancel.ts:270-282` releases a stopped jog or Frame with the driver's settle line, `G4 P0.01` (`grbl/driver.ts:33`), and `laser-motion-release.ts:31,45` stops after two attempts.
- `laser-error-line.ts:46` only records a non-stream `error:N`, and `grblhal/driver.ts:12-21` is the GRBL driver with one command changed, so nothing cleared the error.
- A refused Set origin marks the origin unknown (`laser-origin-transaction.ts:130-141`); Manual Air sets the rail after the write, whatever the reply (`laser-store.ts:409,418-422`); Disconnect is disabled while a jog or Frame is owned (`ControllerConnectionControls.tsx:67-69,113`).
- grblHAL `protocol.c:247-248` (an empty line clears the error), `:265-266` (at level 0 G-code runs only when the last error is OK), `:286` (the old code is sent again), `:214-217,896-899` (a jog-cancel inserts a CAN, which clears it); `config.h:96-98` (level 0 is the default). Triggers: `motion_control.c:834-835`, `system.c:574-575`, `gcode.c:3485-3486`.
- Audit repro on a grblHAL line-loop model: the refused jog stayed stuck with `refused: ['G4 P0.01','G4 P0.01']`; after a typo, Set origin and Zero Z got `error:22`. At level 1 the same jog was released.
- Regression tests: `laser-parser-rearm.test.ts`, `grbl-family-drivers.test.ts`.

**Sources.**

- [grblHAL protocol.c](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L265-L266): "else if(gc_state.last_error == Status_OK || gc_state.last_error == Status_GcodeToolChangePending) { // Parse and execute g-code block."
- [grblHAL protocol.c](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L247-L248): "else if(*line.data == '\0') // Empty line. For syncing purposes."

### HF-3: After a limit alarm grblHAL accepts only a reset, but KerfDesk offered Home and Unlock, which failed with an unexplained error:79

**Medium** · New · Reproduced and traced

grblHAL treats a hard limit, soft limit, E-stop, motor fault or expander fault as a critical event. After a limit it prints `[MSG:Reset to continue]`, and in every case it then refuses `$X`, `$H`, `$HX` and `$SLP` with `error:79` and all G-code with `error:9` until a soft reset (Ctrl-X). It still answers `?`, so KerfDesk keeps seeing Alarm.

KerfDesk's banner said "Re-home the machine ($H) after clearing the obstruction." for ALARM:1 and "Check the design fits the bed; re-import or shrink." for ALARM:2, and offered Home and `$X — Unlock`. Both failed with a raw `error:79` that KerfDesk could not describe. The banner had no reset: "Reset controller" appeared only in Sleep. The only way out was Disconnect, which sends Ctrl-X. On the Falcon contract a jog past the soft limits is a `G1`, so it raises this critical ALARM:2 where `$J=` would only get `error:15`.

GP-2 is the same defect on stock GRBL and HF-2 on FluidNC. One fix covers all three.

**Fix.** KerfDesk latches "reset required" when the controller prints "Reset to continue". While latched, Unlock, Home and every Console line except `?` are refused with a message naming Reset (Ctrl-X), and the Alarm banner offers a single Reset (Ctrl-X) button. A reboot banner or Disconnect clears the latch. The ALARM:1 and ALARM:2 texts now say the reset comes first, and grblHAL codes above 38 are described in grblHAL's words, `error:79` with what to do next (`c7b83f5`, texts `be7d8c6`, ADR-393).

**Evidence.**

- `alarm-codes.ts:60,67` (the ALARM:1/2 actions), although the file's own header says limit alarms "first need a soft reset" (`:11-12`); `error-codes.ts:150,155-157` ends at 38, so `describeError(79)` is null.
- `AlarmRecoveryActions.tsx:22-52` offers Home and Unlock only; `SafetyNoticeBanner.tsx:39` offers Reset only in Sleep.
- grblHAL `alarms.h:73-80` (`alarm_is_critical`), `protocol.c:468-509` (the message, then a loop that serves only `?` and `$` lines), `system.c:1179-1181` (`error:79` for any command without `allow_blocking`; `X`, `H` and `HX` at `:990-992` have none), `errors.h:113`, `messages.c:28`; `machine_limits.c:647-648` (a `G1` past the soft limits raises critical ALARM:2).
- Audit repro: the grblHAL ALARM:1 and ALARM:2 actions did not mention a reset, and `presentError('grblhal', 79)` was null.
- Regression tests: `controller-reset-required.test.ts`, `AlarmBanner.test.tsx`, `response-presentation.test.ts`.

**Sources.**

- [grblHAL protocol.c](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/protocol.c#L497-L498): "Block everything, except reset and status reports, until user issues reset or power cycles."
- [grblHAL errors.c](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/errors.c#L101): "Not allowed while critical event is active."

### HF-2: In its Critical state FluidNC answers Unlock with ok but stays locked, and KerfDesk recorded the alarm as cleared

**Medium** · New · Reproduced and traced

After a hard limit, soft limit or hard stop, FluidNC enters its Critical state, prints the alarm and `[MSG:ERR: Reset to continue]`, and still reports "Alarm". Its `$X` unlocks only the ordinary Alarm state. In Critical it changes nothing and answers `ok`, and v4.0.3 even runs the `after_unlock` macro.

KerfDesk took that `ok` as proof. It cleared the alarm code and logged "Controller unlocked.", and the fix offered when Frame or Start was blocked said "Alarm cleared. Jog the head…". The next Alarm report did not bring the code back, so the banner fell back to "GRBL has locked jog, frame, and start until the machine is homed or unlocked." and offered `$X` again. FluidNC's alarms had no action text, so nothing said a reset was needed. Every motion control still refused on the reported Alarm, so nothing moved on the false record. The way out was Disconnect (Ctrl-X), or Home, which FluidNC allows in Critical.

**Fix.** FluidNC's message latches "reset required" as in HF-3, and the banner offers Reset (Ctrl-X). An acknowledged `$X` no longer clears the alarm code; the next status report that is not Alarm does. FluidNC alarms 1, 2 and 13 now say the reset comes first (`c7b83f5`, ADR-393).

**Evidence.**

- `laser-autofocus-actions.ts:36-44`: Unlock sends an owned `$X` and applies `controllerUnlockedPatch`, which sets `alarmCode: null` (`laser-console-completion.ts:82`); an Alarm report keeps the null (`laser-status-line.ts:269`).
- `start-blocked-alarm-offers.ts:27-29,83` (the "Alarm cleared" toast); `LaserWindow.tsx:298-302,314-320` (generic text with no code; a FluidNC code gets no action); `response-presentation.ts:113-131` (FluidNC alarms have titles only).
- FluidNC v4.0.3 `ProcessSettings.cpp:269-286` (only `State::Alarm` is unlocked, then `return Error::Ok;`), `Protocol.cpp:458-470` (limits and hard stop set `State::Critical`), `Report.cpp:104,136` and `Logging.h:78` (`[MSG:ERR: Reset to continue]`), `Report.cpp:436-439` (Critical reports "Alarm"), `Protocol.cpp:1152-1157` (only a reset leaves Critical).
- Audit repro: `$X` in Critical resolved and left `alarmCode: null`.
- Regression tests: `laser-unlock-alarm.test.ts`, `laser-console-completion.test.ts`, `controller-reset-required.test.ts`, `laser-lifecycle.simulator.test.ts`.

**Sources.**

- [FluidNC ProcessSettings.cpp](https://github.com/bdring/FluidNC/blob/25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f/FluidNC/src/ProcessSettings.cpp#L283-L285): "Run the after_unlock macro even if no unlock was necessary"
- [FluidNC Report.cpp](https://github.com/bdring/FluidNC/blob/25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f/FluidNC/src/Report.cpp#L104): "{ Message::CriticalEvent, "Reset to continue" },"

### HF-1: On the Falcon, a status report between `$HX` and `$HY` failed a Home that went on to succeed

**Medium** · New · Reproduced and traced (plausible on real hardware)

The Falcon A1 Pro homes with two lines, `$HX` then `$HY`. On grblHAL with the homing lock on, `$HX` finishes with Y still unhomed, so grblHAL puts itself back into Alarm, without printing an `ALARM:` line, and answers `ok`. A status query that arrives before `$HY` starts is answered `<Alarm|…>`.

KerfDesk read that report as a new alarm. It dropped the Home, rejected the pending `$HY` with "Controller entered Alarm." and set homing to unknown. The machine then homed Y and went Idle, but the toast said "Home: Controller entered Alarm." Retrying worked. The gap is about one host round trip and KerfDesk polls every 250 ms during Home, so it hits some Homes, not every Home. Whether the A1 Pro has the homing lock is unknown; Creality's own Home macro, `$HX` then `$HY`, shows single-axis homing is on.

**Fix.** Before each further line of a multi-line Home, KerfDesk re-opens the window in which an Alarm report may predate the line. A real failure still arrives as `ALARM:N` or `error:N` on the owned line (`eece3db`, ADR-400).

**Evidence.**

- `falcon-command-contract.ts:24` (`home: '$HX\n$HY'`); `laser-home-action.ts:150-162` sends one owned line at a time.
- `laser-home-alarm-reply.ts:27-36,55-70`: the stale-Alarm window exists only until the Home's first non-Alarm report, and only for a Home started from Alarm (`laser-home-action.ts:279`). `$HX`'s `<Home|…>` report closes it.
- `laser-status-line.ts:53-55,252-293`: any other Alarm report ends the operation, sets `homingState: 'unknown'` and fails the owned line with "Controller entered Alarm.".
- grblHAL `system.c:494-505` (`go_home` sets Alarm after a partial home while homing is required), `machine_limits.c:668-673` (`limits_homing_required`), `protocol.c:145-153` (power-up ALARM:11 with the lock).
- Audit repro: from ALARM:11 and from Idle after `$X`, `{ outcome: 'Controller entered Alarm.', homingState: 'unknown' }`; with no report between the lines the Home passed.
- Regression test: `laser-home-falcon-relock.test.ts`.

**Sources.**

- [grblHAL system.c](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/system.c#L501-L503): "Keep alarm state active if homing is required and not all axes homed."

### HF-6: FluidNC's long command names got past the Console's `$RST=` block, so `$Settings/Restore=#` could erase every offset

**Low** · Incomplete fix of ADR-362 · Reproduced and traced

FluidNC registers each `$` command under a short Grbl name and a long name, and accepts either in any case. `$Settings/Restore=#` is `$RST=#`: it resets every G54–G59, G28 and G30 offset (`=$` resets the settings, `=*` both). `$NVX` and `$Settings/Erase` erase the stored settings and offsets. The Console blocked only the spelling `$RST=`, so it sent the long forms as ordinary commands, with no confirmation, and KerfDesk kept its record of an origin the controller had just erased.

Milder: `$Home`, `$Home/X` and `$H=XY` were not treated as homing, so the homing state and origin were not reset, and `$Alarm/Disable` was not treated as Unlock. The operator has to type these, and a Frame still shows the real outline, so this is low.

**Fix.** The FluidNC Console rewrites a long name to its Grbl name, in any case, before the shared checks run, so `$Settings/Restore=` is blocked like `$RST=` and `$Alarm/Disable` is read as `$X`. It also blocks `$NVX` and `$Settings/Erase`, and treats `$H`, `$HX` to `$HW` and `$H=…` as homing, allowed in Idle or Alarm (`f8b826a`, ADR-400).

**Evidence.**

- `grbl/console-command.ts:55-57,144-146` blocks only `/^\$RST=/`; `:83-85` treats only `$H` and `$HX`… as homing; `fluidnc/driver.ts:38-53` special-cases read-only reports only.
- `laser-console-actions.ts:315-316`: the resulting `machine-state` effect keeps the recorded origin.
- FluidNC v4.0.3 `ProcessSettings.cpp:1034` (`NVX`, `Settings/Erase`), `:1067` (`RST`, `Settings/Restore`), `:1100-1101` (either name, any case), `:540-556` (`#`/`gcode`, `$`/`settings`, `*`/`all`), `:157-162` (every coordinate slot reset), `Settings.h:136-139` (`nvs.erase_all()`); authentication is compiled out (`Config.h:29`).
- Audit repro: `$Settings/Restore=#`, `$settings/restore=gcode`, `$Settings/Restore=*`, `$NVX` and `$Settings/Erase` were all prepared to send; `$RST=#` was blocked.
- Regression test: `fluidnc-console-command.test.ts`.

**Sources.**

- [FluidNC ProcessSettings.cpp](https://github.com/bdring/FluidNC/blob/25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f/FluidNC/src/ProcessSettings.cpp#L1067): "new UserCommand("RST", "Settings/Restore", restore_settings, notIdleOrAlarm, WA);"
- [FluidNC ProcessSettings.cpp](https://github.com/bdring/FluidNC/blob/25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f/FluidNC/src/ProcessSettings.cpp#L1034): "new UserCommand("NVX", "Settings/Erase", Setting::eraseNVS, notIdleOrAlarm, WA);"

### HF-4: On the Falcon, a refused Release motors told the operator to set `$62=1`, which the Falcon profile cannot write

**Low** · New · Reproduced

The Falcon profile has homing off, so its default flow is the Position job guide, whose first step is Release motors (`$SLP`). grblHAL answers `$SLP` with `error:3` whenever sleep is disabled, which is its default. KerfDesk then said "Sleep ($SLP) is disabled in this grblHAL build ($62=0). Set $62=1 in the controller settings to release the motors from KerfDesk."

That advice could not be followed from KerfDesk. The Falcon Console refuses `$62=1` (it writes only `$150` to `$152`), the contract has no settings panel, and `$62=0` was never read because the contract sends no `$$`. On builds without a sleep timer `$62` does not exist at all. On a default grblHAL board the refused `$SLP` also leaves `error:3` latched, so the next jog fails too (HF-7).

**Fix.** The refusal names `$62=1` only where the driver writes numeric settings, and says "($62=0)" only when `$$` reported it. Otherwise it says the firmware refused `$SLP` (sleep disabled or not supported) and that the motors are still energized. The disabled-control reason follows the same rule (`7e456a8`, ADR-400).

**Evidence.**

- `controller-sleep.ts:15-16,30-38`: `sleepRefusalMessage` checks only that the driver is grblHAL; `laser-origin-actions.ts:296-300` shows it.
- `falcon-command-contract.ts:14-20` (`settings: 'none'`, `firmwareSetupPanel: 'none'`), `:25` (`settingsQuery: null`), `:45-46,54-58` (only `$150` to `$152`); `console-setting-writes.ts:21-37` refuses every other numeric write.
- `device-profile.ts:365` (`homing: { enabled: false, … }`), which the Falcon A1 Pro profile inherits; `NoHomingPositionGuide.tsx:133-140` (Release motors is the guide's first action).
- grblHAL `system.c:574-575` (`error:3` with sleep off), `config.h:841-843` (sleep off by default), `settings.c:2141-2142` (`$62` exists only when `SLEEP_DURATION > 0`).
- Audit repro: the refusal text named `$62=1` while the Falcon Console refused `$62=1`.
- Regression test: `controller-sleep.test.ts`.

**Sources.**

- [grblHAL config.h](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/config.h#L842): "#define DEFAULT_SLEEP_ENABLE Off"
- [grblHAL settings.c](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L2141-L2142): "case Setting_SleepEnable: available = SLEEP_DURATION > 0.0f;"

### HF-8: grblHAL built to call itself Grbl prints "Grbl 1.1f", and KerfDesk flagged it as the wrong firmware

**Low** · New · Reproduced and traced (plausible on real hardware for the Falcon)

grblHAL built at compatibility level 1 or higher, the documented option for "reporting itself as Grbl", prints the stock banner `Grbl 1.1f ['$' for help]`. Its version is "1.1f" at every level, and at these levels `$I` does not name grblHAL either. KerfDesk read the banner as stock GRBL.

On a grblHAL profile, such as the Falcon A1 Pro's, every connect logged "Controller banner looks like grbl-v1.1, but the profile selected grblhal", and every Job Review warned that "the firmware banner identifies GRBL v1.1". Reconnecting could not clear it. Machine Setup offered "Use detected GRBL v1.1 in draft", which on the Falcon profile cuts the 1024-byte window to 120 bytes and drops the vendor bed frame for good. Even without that, a homed Falcon lost its vendor bed frame on this banner. The Falcon's own banner is not recorded anywhere; a Falcon on grblHAL has either this finding or HF-7, never both.

**Fix.** Banner detection now takes the active driver: "Grbl 1.1f" on the grblHAL driver identifies grblHAL, so no notice, warning or "Use detected" button appears. Any other version, such as "Grbl 1.1h", keeps the mismatch, as does "Grbl 1.1f" on any other driver. With the Falcon command set the vendor bed frame also accepts a "Grbl …" banner (`19e8b09`, ADR-400).

**Evidence.**

- `detect-controller.ts:16-17`: `/^GrblHAL [\d.]+/i` → grblHAL, then `/^Grbl [\d.]+/i` → `grbl-v1.1`.
- `laser-line-handler.ts:331-338` (the connect notice); `controller-identity-warnings.ts:35-40` (the Job Review warning); `DeviceSetupConnectStep.tsx:48-52,159-170` (the mismatch and "Use detected"); `controller-profile-compatibility.ts:119-130` (1024 to 120 bytes when leaving grblHAL).
- `native-bed-frame.ts:98-107`: the vendor bed frame needs the detected kind to be null or grblHAL.
- grblHAL `report.c:311-315` (banner by level), `config.h:89`, `grbl.h:40-44` (`GRBL_VERSION "1.1f"` at every level), `report.c:918-920,1111` (`[FIRMWARE:grblHAL]` only in the level-0 extended `$I`).
- Audit repro: the Job Review warning, the connect notice and the withdrawn vendor bed frame all failed; a "Grbl 1.1h" banner was still flagged.
- Regression tests: `detect-controller.test.ts`, `laser-banner-identity.test.ts`, `controller-identity-warnings.test.ts`, `native-bed-frame.test.ts`.

**Sources.**

- [grblHAL config.h](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/config.h#L89): "Set to `1` to disable some extensions, and for reporting itself as "Grbl"."
- [grblHAL report.c](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/report.c#L313-L314): "write(ASCII_EOL "Grbl " GRBL_VERSION " ['$' for help]" ASCII_EOL);"

### HF-5: Wake from Sleep was reported as failed, although GRBL, grblHAL and FluidNC wake into Alarm by design

**Low** · New · Reproduced

Release motors (`$SLP`) puts the controller to sleep. Wake (Ctrl-X), or "Reset controller" in the Sleep notice, sends a soft reset. All three firmwares then come back locked in Alarm on purpose, because the motors were off and the position cannot be trusted. Stock GRBL and grblHAL re-enter Alarm and print `[MSG:'$H'|'$X' to unlock]`; FluidNC raises `ALARM:3` before its banner.

KerfDesk waited for Idle, and the Sleep banner even says Wake "waits for the controller to report Idle again". The Alarm report, or FluidNC's `ALARM:3`, failed that wait. The log said "Controller recovery failed" and the toast "Wake: Controller entered Alarm." (or "Wake: ALARM:3"), although the wake had worked. The Position job guide already expected the Alarm; the Sleep banner path did not. CG-8, the same on stock GRBL, is merged here.

**Fix.** Wake now completes as "alarm" when the controller reports Alarm after the reset and logs it, and the Alarm banner offers Unlock or Home; the Position job guide goes to its Unlock step (`1d94901`, ADR-393, ADR-400).

**Evidence.**

- `laser-controller-recovery-actions.ts:88-90` waits for a fresh Idle after the reset and `:105` logs the failure; `laser-interactive-command.ts:337-339` fails that wait on any Alarm or Sleep report; `LaserWindow.tsx:263-264` (the banner text).
- The repo's GRBL simulator woke to Idle (`grbl-sim-machine.ts:225-228`), which none of the three firmwares does, so no test caught it.
- gnea/grbl `protocol.c:49-54`, with the state kept across the reset (`main.c:74-76`); grblHAL `protocol.c:167-174`, with the state kept because the reset clears only `sys` (`state_machine.c:55`, `grbllib.c:458-461`); FluidNC v4.0.3 `Protocol.cpp:1158-1159` (Sleep becomes an AbortCycle alarm), `:228-232` (`ALARM:3`), `:397` (then the banner).
- Audit repro: grblHAL `'Controller entered Alarm.'`, FluidNC `'ALARM:3'`, stock GRBL `'Controller entered Alarm.'`.
- Regression tests: `laser-wake-into-alarm.test.ts`, `laser-wake-into-alarm-grbl.test.ts`.

**Sources.**

- [gnea/grbl protocol.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/protocol.c#L50-L51): "NOTE: Sleep mode disables the stepper drivers and position can't be guaranteed. Re-initialize the sleep state as an ALARM mode to ensure user homes or acknowledges."
- [FluidNC Protocol.cpp](https://github.com/bdring/FluidNC/blob/25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f/FluidNC/src/Protocol.cpp#L1158-L1159): "} else if (state_is(State::Sleep)) { protocol_do_alarm((void*)ExecAlarm::AbortCycle);"

## Controls across controllers

Each machine control checked against what every controller can do: Abort, origins, Frame, auto-focus, alarms, air and settings.

### CG-12: Ctrl+. did not stop a Frame or jog on Smoothieware, Marlin or the Falcon, so the head kept moving

**High** · New · Reproduced and traced

The keyboard Abort, Ctrl/Cmd+., is meant to stop whatever the Live Motion bar would stop. For a jog or Frame it sent GRBL's jog-cancel byte. Smoothieware, Marlin and the Falcon contract have none, so there it wrote nothing and then waited for the motion to finish. The head traced the rest of the Frame perimeter, and the operator got no error. The bar's ABORT MOTION for the same motion sends Abort, which on Smoothieware and the Falcon is Ctrl-X and does stop.

The beam is off during Frame and jog, and the motion ends at the perimeter or the jog step, so this is high rather than critical. Ctrl+. is the Abort that stays reachable when a dialog covers the bar (PROJECT.md non-negotiable 9).

**Fix.** Where the driver has no jog-cancel byte, Ctrl+. now sends the same Abort as ABORT MOTION. On Marlin that Abort now quick-stops with `M410` (MA-7) (`b2dfad8`, ADR-400).

**Evidence.**

- `use-job-shortcuts.ts:66` maps a jog or Frame to `cancelJog()`; `laser-motion-cancel.ts:120-121` returns without writing when `jogCancel` is null, and settlement then waits for the motion (`:52-54`).
- `jogCancel: null` in `smoothieware/driver.ts:60`, `marlin/driver.ts:59` and `falcon-command-contract.ts:21`.
- `LiveMotionBar.tsx:64`: ABORT MOTION calls `stopJob`. The rotary test already fell back to Abort without jog-cancel (`rotary-test-rotation.ts:135-137`).
- gnea/grbl `serial.c:159-162`: jog-cancel acts only on `$J=` jogs, so leaving it out for the Falcon's `G1` Frame is right; the gap was the shortcut. Smoothieware stops queued moves only by halting on Ctrl-X (`USBSerial.cpp:204-208,302-311`), and Marlin has no jog-cancel byte.
- Audit repro on a Smoothieware board model: after Ctrl+., `{ resetSent: false, stillMoving: true }`; ABORT MOTION stopped it.
- Regression test: `use-job-shortcuts.test.ts`.

**Sources.**

- [gnea/grbl serial.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/serial.c#L159-L161): "if (sys.state & STATE_JOG) { // Block all other states from invoking motion cancel."
- [Smoothieware USBSerial.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/USBDevice/USBSerial/USBSerial.cpp#L204-L206): "if(b == 'X' - 'A' + 1) { // ^X"

### CG-1: After Set origin here, origin placements could not Frame on Marlin and Smoothieware

**High** on Marlin, **Medium** on Smoothieware · New · Reproduced and traced

KerfDesk learned where a work origin is only from GRBL's `WCO:` status field. Smoothieware and Marlin never send one.

On Smoothieware, after Set origin here a User Origin Frame was refused for good: "The work origin is set, but the controller has not reported where it is yet." It said to wait and try again, or to reset and set the origin again; neither helped. User Origin is the no-homing default, and Set origin here switches Absolute to it. Go to work zero stayed disabled too. Yet every Smoothieware report carries MPos and WPos, whose difference is the whole offset, and KerfDesk's Current Position already used it.

Marlin was worse. `M114` prints the work position, with the `G92` shift applied, and KerfDesk filed it as the machine position. After Set origin here, User Origin, Absolute and Current Position were refused, and a Verified Origin Frame refused with "The controller did not report a usable work position." No placement could Frame, so nothing could Start. SM-1 and MA-2 share this root cause.

**Fix.** Smoothieware: when a report carries MPos and WPos and no `WCO:`, the work offset is MPos − WPos. Marlin: `M114` is read as the work position, KerfDesk records the `G92` shift it writes, Reset origin writes a `G92` back to the machine position, and Home clears the recorded shift (`ff6d06f`, `66f549e`, ADR-396).

**Evidence.**

- `job-placement.ts:251-270` refuses User Origin with no known offset, and `:208-219` refuses Absolute with a custom origin and no known offset; `:323-326` reads the offset only from a `WCO:` report or its cache, while `:305-310` already derives MPos − WPos for Current Position.
- `laser-status-position.ts:51-53` stores a report without `WCO:` as it is; `laser-origin-actions.ts:153-157` skips the offset wait on these drivers.
- `marlin/response.ts:49-57` files `M114` as `mPos` with `wco: null`; `canvas-motion-plan.ts:373-374` then gives no work position, and `use-frame-action.ts:292-295` refuses the Frame.
- Smoothieware `Kernel.cpp:217,234,271,287` (`|MPos:` and `|WPos:`, never `WCO:`), `Robot.cpp:448-456` (work = machine − WCS offset + `G92` offset − tool offset); Marlin 2.1.2.8 `motion.cpp:191-193` (`M114` reports the logical position).
- Audit repro: the Smoothieware User Origin Frame was refused and its Absolute Frame resolved with no offset; on Marlin, Absolute, Current and User were refused and Verified had no work position.
- Regression tests: `laser-status-smoothie-offset.test.ts`, `g92-only-origin-frame.test.ts`, `marlin-origin-model.test.ts`, `marlin-origin-placement.simulator.test.ts`.

**Sources.**

- [Smoothieware Robot.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L448): "converts current last milestone (machine position without compensation transform) to work coordinate system (inverse transform)"
- [Marlin motion.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/motion.cpp#L191-L193): "Report the logical position for a given machine position"

### CG-2: The Frame's G54 selection made KerfDesk forget, or erase, the operator's G92 origin

**Medium** · New · Reproduced and traced

The prepared program runs in G54, so a Frame sent `G54` first whenever KerfDesk did not know the active work coordinate system. That was every session on the Falcon contract, Marlin and Smoothieware, which never read it. KerfDesk then treated the `G54` like a Console coordinate command and dropped its record of the `G92` origin, the offset and work Z, before resolving the placement. But `G92` is independent of G54–G59, so the controller kept the origin.

On the Falcon, User and Verified Origin were then refused as needing a custom origin, and the one-click fix set a new origin wherever the head now was. Current Position placed the job off by the `G92` offset. On stock Marlin, `G54` is an unknown command answered `ok`, and an Absolute Frame that was rightly refused before now ran with no offset, displaced by the shift Marlin kept. With `CNC_COORDINATE_SYSTEMS`, `G54` replaced Marlin's shift and erased the origin on the controller. On Smoothieware, Absolute also ran with no offset. Homed GRBL-family Absolute Frames were safe, because they wait for a fresh offset. The Frame traces the displaced path, so a watching operator can catch it.

**Fix.** The Frame selects G54 only where the controller can report its WCS (`$G`). It reads an unknown WCS first, writes `G54` only when another WCS is active, and keeps the origin record. The Falcon handshake now reads `$G`, and Marlin gets no `G54` (`5eb2835`). Smoothieware now uses `$G` as its modal-state query (`2b561e3`). ADR-396.

**Evidence.**

- `frame-controller-readiness.ts:44-51` selects G54 whenever `activeWcs` is not `G54`, null included, and `use-frame-action.ts:192-215` does so before the placement. Only homed GRBL-family drivers then wait for a fresh offset (`frame-position-readiness.ts:45-55`).
- `laser-console-actions.ts:128-168` applies the `coordinates-all` effect (`:335-340`), which clears the origin flags, work Z and the cached offset (`:387-394`).
- The Falcon never read `$G`: the handshake stops before the readback when `settingsQuery` is null (`laser-controller-handshake.ts:171-176,218`; `falcon-command-contract.ts:25`). KerfDesk's own Marlin output strips `G54` (`marlin-inline-transform.ts:27-31`).
- gnea/grbl `gcode.c:995-999` and grblHAL `gcode.c:2990,4483-4487` report a fresh WCO only when the WCS changes; Marlin 2.1.2.8 `gcode.cpp:442-450,478,1122` (`G54` exists only with `CNC_COORDINATE_SYSTEMS`), `G53-G59.cpp:34-46`; Smoothieware `Robot.cpp:612-619` (`G54` leaves `G92` alone), `SimpleShell.cpp:218-222,879-882` (`$G` answers `[GC:…]` and `ok`).
- Audit repro: Falcon Current Position `{"x":100,"y":50}` instead of `{0,0}`; stock Marlin Absolute resolved while the controller kept a `-100,-50` shift; Smoothieware Absolute resolved with no offset while the board reported MPos `110,60`, WPos `0,0`.
- Regression tests: `frame-wcs-normalization-falcon.test.ts`, `g92-only-origin-frame.test.ts`, `marlin-origin-model.test.ts`, `laser-lifecycle-falcon.simulator.test.ts`.

**Sources.**

- [gnea/grbl gcode.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/gcode.c#L995-L999): "if (gc_state.modal.coord_select != gc_block.modal.coord_select) {"
- [Marlin G53-G59.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/geometry/G53-G59.cpp#L42): "position_shift[i] = new_offset[i];"
- [Smoothieware SimpleShell.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/utils/simpleshell/SimpleShell.cpp#L880-L881): "also $G and $I [GC:G0 G55 G17 G21 G90 G94 M0 M5 M9 T1 F4000.0000 S0.8000]"

### CG-11: Reset origin on stock Marlin did nothing, and KerfDesk recorded the origin as cleared

**Medium** · New · Reproduced and traced

Reset origin sent `G92.1`. Marlin compiles `G92.1` only with `CNC_COORDINATE_SYSTEMS`, which stock Marlin leaves off. Without it Marlin ignores the line, keeps its `G92` shift and still answers `ok`.

KerfDesk took the `ok` as done. It cleared its origin record and showed "Temporary work offsets cleared (G92.1); saved G54 is unchanged." An Absolute placement then resolved with no offset: with the origin set at native X100 Y50, a bed point at (10, 10) was driven to native (110, 60). The position display shows Marlin's shifted position, so the canvas looked right while the head was off by the old origin. The profile note names the build option, but nothing checked it, and KerfDesk's own CG-1 message told operators to "Reset origin and set it again".

**Fix.** KerfDesk records the machine position where its `G92` was written, and Reset origin writes a `G92` back to that position, which restores machine coordinates on every build. With no known position it refuses (`66f549e`, ADR-396).

**Evidence.**

- `marlin/driver.ts:40-43` calls the option "a documented build requirement, not detected firmware evidence", and `:74` sets `clearOrigin: 'G92.1'`; `profile-catalog.ts:111`: "Origin reset requires CNC_COORDINATE_SYSTEMS and a non-SCARA build."
- `laser-origin-actions.ts:207-227` applies `clearedOriginPatch()` (`:379-390`) on the `ok`; `OriginRow.tsx:263` shows the toast; `job-placement.ts:214` then accepts Absolute with no offset.
- Marlin 2.1.2.8 `Configuration_adv.h:3600` (off; the same in bugfix-2.1.x), `G92.cpp:61-71` (`case 1:` only with the option, otherwise `default: return;`), `Conditionals_post.h:3177-3180` (without it the `.1` is not even parsed), `gcode.cpp:1122` (the `ok`).
- Audit repro on a stock-Marlin model: after Reset origin `workOriginSource: "none"` and Absolute `{ok: true}`, while the controller shift stayed `-100,-50`.
- Regression tests: `marlin-origin-model.test.ts`, `marlin-origin-placement.simulator.test.ts`.

**Sources.**

- [Marlin Configuration_adv.h](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/Configuration_adv.h#L3597-L3600): "Enables G53 and G54-G59.3 commands to select coordinate systems and G92.1 to reset the workspace to native machine space."
- [Marlin G92.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/geometry/G92.cpp#L62): "Ignore unknown G92.x"

### CG-9: Auto-focus skipped the Console's checks, so a Smoothieware shell command wedged the controller

**Medium** · New · Reproduced and traced

Auto-focus sends one operator-configured line and waits for its reply. It checked only that the line was single and not empty. On Smoothieware a lowercase line goes to the shell, and most shell commands print text but never `ok`. The Console refuses exactly those lines on Smoothieware; auto-focus did not ask it.

With an auto-focus command such as `switch focus on`, the board printed `switch focus set to: on` and no `ok`. After 15 s KerfDesk reported "Auto-focus timed out after 15s…", but the reply stayed owed. Jog then refused with "Wait for the previous controller write and acknowledgement to settle before jogging.", and Frame, Home, origin changes and Start refused too, until Abort or a reconnect.

The only auto-focus preset, the Falcon's `$HZ1`, was offered for every controller. Smoothieware runs any `$H…` line as a full homing cycle and answers `ok`. Stock GRBL 1.1h with homing on answers `error:3` but is left in its Home state until a reset (traced, not reproduced).

**Fix.** Auto-focus runs the command through the driver's Console checks and refuses with their reason, and the `$HZ1` preset is offered only for the Falcon command set (`4dc7f67`, ADR-400).

**Evidence.**

- `autofocus-action.ts:74-89` (the only preflight checks), `:56-67` (sent as an owned command); each newline owes one reply (`laser-safe-write.ts:294-299`, reserved at `:99`).
- `smoothieware/console-command.ts:89-108` refuses the shell lines that print no `ok`.
- The owed reply blocks Home (`laser-home-action.ts:59`), origin changes (`laser-origin-actions.ts:71-77`), auto-focus (`laser-autofocus-actions.ts:96-103`) and Start (`laser-start-queue-fence.ts:12-13`).
- `AutofocusEditor.tsx:14-24` lists only `$HZ1`, shown for every controller (`DeviceSetupOptionsStep.tsx:110-118`).
- Smoothieware `GcodeDispatch.cpp:75-82` (`$` and lowercase lines go to the shell), `SimpleShell.cpp:268-296` (no `ok` on the general path), `:1011` (the switch reply), `:241-252` (`$H…` homes, then `ok`); gnea/grbl `system.c:180-194` (Home state set before `$HZ1` is refused).
- Audit repro: `pendingUntrackedAcks: 1` after the timeout and Jog refused; a comment-only line was answered and Marlin refused at preflight (controls).
- Regression tests: `laser-autofocus-console-policy.test.ts`, `AutofocusEditor.test.tsx`.

**Sources.**

- [Smoothieware GcodeDispatch.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/communication/GcodeDispatch.cpp#L79-L80): "ignore all lowercase as they are simpleshell commands"
- [Smoothieware SimpleShell.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/utils/simpleshell/SimpleShell.cpp#L1011): "stream->printf("switch %s set to: %s\n", type.c_str(), value.c_str());"

### CG-3: After Abort on Smoothieware, qualification waited for the rest of the session, so recovery was refused

**Medium** · New · Reproduced and traced

Abort sends Ctrl-X and marks the controller as needing fresh qualification. On GRBL-family firmware the reset reboots the board, and its welcome banner restarts qualification. Smoothieware does not reboot: it halts, prints "HALTED, M999 or $X to exit HALT state" (or "ALARM: Abort during cycle" in grbl mode) and prints no banner. Nothing restarted qualification.

After Abort and M999 the board sat Idle, but the connection bar kept showing "Controller reset detected. Waiting for fresh Idle before reading settings…" with no Retry. Supervised recovery, the laser resume that ADR-364 allows on Smoothieware, refused because qualification was "still in progress", exactly when recovery is wanted, until a reconnect. Ordinary Start was not affected. The stream-error stop did the same. The only way out in the session was an accident: "Read ($$)" marked it qualified (CG-7).

**Fix.** A new capability, `softResetReboots`, is false for Smoothieware. After Abort or the stream-error stop on such a driver, KerfDesk re-arms qualification itself. It runs on the first Idle after an Alarm report, so a report printed before the reset landed cannot start it (`5085702`, ADR-397).

**Evidence.**

- `laser-job-actions.ts:293-294` and `laser-error-line.ts:132` apply `invalidateControllerSessionEvidence`, which sets qualification to `reset-cleanup` (`laser-controller-evidence.ts:15`).
- The only re-arm is `scheduleControllerQualification` in the banner handler (`laser-line-handler.ts:390`).
- `ConnectionBar.tsx:112-117,157-158` (the status line); `start-job-source.ts:312-325` and `recovery-start-authorization.ts:10-26` (the recovery refusals); `laser-controller-qualification.ts:73-77` (ordinary Start does not check it).
- Smoothieware `USBSerial.cpp:204-208,302-311` and `SerialConsole.cpp:205-207,233-245` (Ctrl-X halts and prints the halt message); the `Smoothie` greeting comes only on USB attach (`USBSerial.cpp:332`).
- Audit repro: after Abort, M999 and Idle, qualification stayed `{ kind: 'qualifying', phase: 'reset-cleanup' }`.
- Regression tests: `laser-job-stop.smoothie.simulator.test.ts`, `laser-controller-qualification-alarm-wait.test.ts`.

**Sources.**

- [Smoothieware USBSerial.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/USBDevice/USBSerial/USBSerial.cpp#L302-L311): "puts("HALTED, M999 or $X to exit HALT state\r\n");"

### CG-4: On a halted Smoothieware board the alarm fix offered Home, which a halted board always refuses

**Low** · New · Reproduced

A halted Smoothieware board, after Abort or a limit, answers every G-code line except a few M-codes with `!!` until `M999`. KerfDesk's Smoothieware Home starts with `M400` on purpose, so a halted board rejects it. But when an alarm blocked Frame or Start, the fix offered was Home whenever homing was on. The Home failed on its first line, raised a "Controller rejected a command" notice and left the board halted. `M999` was never offered there, although the banner's Unlock next to it would have worked.

**Fix.** A new capability, `homeFromAlarm`, is false for Smoothieware. There the Alarm banner and the Start fix offer lead with Unlock (`M999`), with the hint "Unlock first: this controller cannot home while halted." (`c7b83f5`, ADR-393).

**Evidence.**

- `start-blocked-alarm-offers.ts:52-53` offers Home whenever homing is on; `AlarmRecoveryActions.tsx:22-29` shows Home in Alarm too.
- `smoothieware/driver.ts:63-67`: Home starts with `M400` "so a halted board rejects it"; `laser-home-action.ts:217` raises the notice.
- Smoothieware `GcodeDispatch.cpp:34` (the halted allow-list has no `M400`), `:158-180` (everything else gets `!!`, or `error:Alarm lock` in grbl mode; only `M999` clears the halt).
- Audit repro: `M400` was sent and the board stayed halted.
- Regression tests: `AlarmBanner.test.tsx`, `start-blocked-fix-offers.test.ts`.

**Sources.**

- [Smoothieware GcodeDispatch.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/communication/GcodeDispatch.cpp#L159): "we ignore all commands until M999, unless it is in the exceptions list (like M105 get temp)"

### CG-10: Marlin Abort and Disconnect left air assist on, and Abort showed Manual Air as OFF

**Low** · New · Reproduced

On Marlin only `M9` switches air assist off; `M5` and `M107` do not touch it. KerfDesk's Marlin stop lines were `M5 I` and `M107`. After Manual Air ON, or a job with an air layer, Abort left the pump running while setting Manual Air to OFF, and Disconnect left it running after the port closed. Air left on is not a hazard, but the rail was wrong and the stop incomplete.

**Fix.** Abort and Disconnect send `M9` when Manual Air is on or the job's program uses `M7` or `M8`, and clear Manual Air only when that line went out. Abort now also quick-stops with `M410` (MA-7) (`d1928d3`, ADR-395).

**Evidence.**

- `marlin/commands.ts:17` (`['M5 I', 'M107']`); Abort writes them (`laser-job-actions.ts:314-328`) and then sets `airAssistOn: false` (`:335`).
- Disconnect with only Manual Air on sends the same lines (`laser-store-helpers.ts:207`, used at `laser-connection-actions.ts:345-368`).
- Marlin 2.1.2.8 `M7-M9.cpp:61-75`: only `M9` calls `cutter.air_assist_disable()`, its sole caller; `gcode.cpp:499-505` dispatches `M8` and `M9` only on builds with the air or coolant options.
- Audit repro with the repo's Marlin simulator: Abort sent `M8`, `M5 I`, `M107`, `M114` and set `airAssistOn: false`; Disconnect sent `M114`, `M8`, `M5 I`, `M107`.
- Regression test: `laser-quick-stop.test.ts`.

**Sources.**

- [Marlin M7-M9.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/control/M7-M9.cpp#L61-L75): "M9: Coolant / Air Assist OFF"

### CG-5: Smoothieware jog, Frame and Home switched the air off, but Manual Air still showed ON

**Low** · New · Traced

On Smoothieware every jog, Frame and Home starts with tool-off lines that end in `M9`. With Manual Air ON through a switch bound to `M8`/`M9`, the first jog switched the air off, but the rail still showed ON. KerfDesk corrects Manual Air only from GRBL's `A:` and `Ov:` status fields, and Smoothieware reports no accessory field. The next click sent `M9` again, so getting air back took two clicks.

**Fix.** Manual Air now clears once the transport accepts a jog, Frame or Home write that contains an `M9` line. GRBL's Frame (`M5`, `M9`) now clears it at once too, instead of at the next `A:` report (`ef83ce7`, ADR-397).

**Evidence.**

- `smoothieware/commands.ts:37-43` (`fire off`, `M400`, `M221 S0`, `M5`, `M9`), used by the jog (`:66-73`), the Frame (`smoothieware/driver.ts:76`) and Home (`:67`).
- `laser-status-position.ts:106-113`: Manual Air is corrected only from `A:` or `Ov:`.
- Smoothieware `Kernel.cpp:177-334`: a status report carries the state, `MPos`, `WPos`, `F`, `L`/`S` and temperatures, and no accessory field.
- Regression test: `laser-tool-off-air.simulator.test.ts`.

**Sources.**

- [Smoothieware Kernel.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/Kernel.cpp#L287-L292): "n = snprintf(buf, sizeof(buf), "|F:%1.1f,%1.1f", fr, fro);"

### CG-7: "Read ($$)" was offered on controllers that have no settings query

**Low** · New · Traced

Marlin, Smoothieware and the Falcon contract have no settings query. Yet Machine Settings in the Super Console showed "Read ($$)", said it "Reads live controller settings with `$$`", toasted "Reading machine settings ($$)..." and auto-read once per session. Nothing was read: the call only marked qualification as not required, which is also how it hid CG-3. Machine Setup's firmware step was not affected.

**Fix.** "Read ($$)" and the auto-read appear only when the driver has a settings query, and the panel says the controller has none instead of describing `$$` (`de06589`, ADR-397).

**Evidence.**

- `MachineSettingsPanel.tsx:42-46` (the toast), `:98-106` (the button), `:124-128` (the `$$` text); `SuperConsoleSettingsPane.tsx:25,65` (always mounted, auto-read).
- `grbl-settings-actions.ts:80-90`: with no settings query the read only sets qualification to `not-required`.
- `settingsQuery: null` in `marlin/driver.ts:65`, `smoothieware/driver.ts:70` and `falcon-command-contract.ts:25`. Smoothieware's shell would answer `$$` with `error:Invalid statement` (`SimpleShell.cpp:263-264`).
- Regression test: `SuperConsoleSettingsPane.test.tsx`.

**Sources.**

- [Smoothieware SimpleShell.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/utils/simpleshell/SimpleShell.cpp#L263-L264): "new_message.stream->printf("error:Invalid statement\n");"

## Marlin

What stock Marlin 2.1.2.8 does with KerfDesk's stream, Pause, Abort, origin and replies. The laser findings assume `LASER_FEATURE` (inline dialect) or a fan-header laser (fan dialect).

### MA-1: Pause on Marlin only stopped sending, so the laser stayed lit over the stopped head

**Critical** · New · Reproduced

Marlin has no realtime pause, so Pause only stopped sending: KerfDesk wrote nothing to the controller. Marlin ran the moves it had already accepted and then stood still with the laser output as the last burn left it. With a fan-header laser (`M106`), Marlin drives the fan output from the current fan speed whenever its planner is empty, so the laser burned a spot in place, with no timeout, until Resume or ABORT JOB. It made no difference where in a burn Pause landed. With inline power (`M3 I`), continuous mode does not blank the output when the planner runs dry: the last power stayed on for about 1 s, until the stock `LASER_SAFETY_TIMEOUT_MS` (1000 ms) cut it, or for good on a build without that timeout. The Pause text said only that buffered motion may finish.

**Fix.** A Marlin Pause now queues a beam-off line behind the accepted moves: `M107` in the fan dialect, `M5 I` for inline power. Resume is refused until they are answered; it then writes `M106 S<held>` before the next move, or re-arms with `M3 I S0` (or `M4 I S0`) and restates the held S on the next burn move. The Pause and Resume text says so. (`d1928d3`, ADR-395)

**Evidence.**

- `src/ui/state/laser-job-pause-resume.ts:108-111`: with no pause byte, Pause calls `freezeStreamer` (`:208-218`), which only marks the stream paused, and posts the notice at `:63-64`. `src/ui/laser/job-control-copy.ts:6-7`: "Pause stops sending; buffered firmware motion may finish."
- `src/core/output/marlin-fan-transform.ts:54-56,61` writes `M106 S<n>` before each burn move. `src/core/controllers/marlin/driver.ts:34,55`: `realtimePause: false`, `hold: null`.
- Marlin `planner.cpp:1388-1399`: with no block queued, the fan follows the current speed, `thermalManager.scaledFanSpeed(i)`. This runs at 10 Hz from `idle()` (`MarlinCore.cpp:738-742`), and `M106_M107.cpp:91` sets that speed at once. There is no fan timeout.
- Marlin `stepper.cpp:2341-2346`: with no current block, only dynamic mode blanks the cutter. `temperature.cpp:3516-3521` cuts the output after `LASER_SAFETY_TIMEOUT_MS` (1000 in stock `Configuration_adv.h:3432`), a clock refreshed only while blocks are queued (`MarlinCore.cpp:428-429`).
- Reproduction: on the repo simulator the fan power was still 128 with no moves pending, 8 s after Pause; the inline power model still output 128 with the planner empty.
- Regression tests: `laser-stream-pause-beam.test.ts`, `stream-pause-beam.test.ts`.

**Sources.**

- [MarlinFirmware/Marlin planner.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/planner.cpp#L1388-L1399): "const uint8_t spd = thermalManager.scaledFanSpeed(i);"
- [MarlinFirmware/Marlin stepper.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/stepper.cpp#L2341-L2346): "No movement in dynamic mode so turn Laser off"
- [MarlinFirmware/Marlin temperature.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/temperature.cpp#L3516-L3521): "// Shut down the laser if steppers are inactive for > LASER_SAFETY_TIMEOUT_MS ms"

### MA-7: Abort on Marlin queued M5 behind every accepted move, so the laser kept burning and a jog or Frame kept moving

**Critical** · New · Reproduced and traced

Marlin sends `ok` as soon as it has planned a move, so with one line per `ok` its planner holds up to 15 moves. ABORT JOB sent `M5 I` and `M107`. `M5` waits for the planner to empty before it switches the laser off, so the laser kept burning through every queued move: for 200 s after ABORT JOB in the audit's model of a slow 300 mm/min cut. In the fan dialect each queued move keeps the fan speed it was planned with, so `M107` did not help either. ABORT MOTION in the Live Motion bar is the same stop, so a jog or Frame ran to its end (38 s of a 40 s jog in the test), and no notice appeared, because the notice was set only for a running job. The job notice said KerfDesk "could only stop sending and queue beam-off commands". Marlin has `M410`: stock builds act on it as soon as the line is read, drop every planned move and stop the move in progress.

**Fix.** ABORT JOB, ABORT MOTION, the stop after a stream error, and Disconnect while anything may still run now send `M107`, `M410`, `M5 I`, then `M9` when air assist may be on (CG-10). `M107` goes first, so a fan laser is dark as soon as the planner is dropped, and the laser is off within about a second. A quick stop halts the motors without slowing down, so homing and position become unverified, and the notice says to re-home or re-check the origin; the G92 origin is kept. The Ctrl+. shortcut now sends the same stop (CG-12). The automatic restart after it steps back over the 15 moves `M410` may have dropped (OR-3). (`d1928d3`, restart `d038b10`, ADR-395)

**Evidence.**

- `src/ui/state/laser-job-actions.ts:314-327`: with no reset byte, Abort sets the notice only for an active job, then writes the driver's stop lines. `src/core/controllers/marlin/commands.ts:14-17`: `['M5 I', 'M107']`, "Both are queued commands, not an emergency stop." The Frame uses the same lines (`driver.ts:70-71`).
- `src/ui/laser/LiveMotionBar.tsx:64`: ABORT MOTION calls `stopJob`. `src/ui/state/laser-safety-notice.ts:134-138`: the "could only stop sending" text.
- Marlin `queue.cpp:538-545`: without `EMERGENCY_PARSER` (the stock setting), `M410` runs `quickstop_stepper()` when the line is read. Lines are read even while a move waits for a planner slot (`planner.h:777`, `MarlinCore.cpp:408-410`).
- Marlin `planner.cpp:1678-1705`: `quick_stop()` drops every block and refuses new moves for one second (`:1697-1698`, `:1827-1830`). `M3-M5.cpp:142-145`: `M5` calls `planner.synchronize()` first. The planner has 16 blocks, one always kept free (`Configuration_adv.h:2393-2399`, `planner.h:762-765`).
- Reproduction (the audit's model of Marlin's 4-line buffer and planner): the beam stayed on 200,069 ms after ABORT JOB, and a 40 s jog kept moving for 38,000 ms. The control run with `M410` had the beam off at 1,000 ms.
- Regression tests: `laser-job-stop.marlin.test.ts`, `laser-quick-stop.test.ts`, `marlin-driver.test.ts`.

**Sources.**

- [MarlinFirmware/Marlin queue.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/queue.cpp#L538-L545): "case '0': if (command[1] == '4' && command[2] == '1') quickstop_stepper(); break;"
- [MarlinFirmware/Marlin M3-M5.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/control/M3-M5.cpp#L132-L145): "M5 - Cutter OFF (when moves are complete)"
- [MarlinFirmware/Marlin M108_M112_M410.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/control/M108_M112_M410.cpp#L46-L54): "M410: Quickstop - Abort all planned moves"

### MA-4: Marlin answers the post-job M400 only after its moves run, but KerfDesk gave up after 30 s and ignored Marlin's busy lines

**Medium** · New · Reproduced

After the last `ok` of a job, KerfDesk sends `M400` and waits for its answer before it calls the run complete. Marlin answers `M400` only after every buffered move has run, and prints `echo:busy: processing` every 2 s meanwhile. KerfDesk dropped busy lines and polls no `M114` while `M400` is owed, so nothing restarted its 30 s timer. When the buffered tail took longer than 30 s, the run ended with "Post-job controller settle failed: post-job settle marker timed out." and a controller-error notice. The usual cause was KerfDesk's own closing park, `G0 X0 Y0 S0`, which ran at the cut feed (MA-8): 328 mm at 300 mm/min is 66 s. The run then did not count as clean: variables did not advance, and the recovery ledger recorded it as interrupted.

**Fix.** A busy line now keeps an activity-timed owned command alive, the `M400` settle and a `G28` Home included. MA-8's fix also shortens the park. (`d1928d3`, ADR-395)

**Evidence.**

- `src/ui/state/laser-post-job-settle.ts:26,68-76` sends `M400` with a 30 s activity timeout; `:111-121` records the failure, the log line and "controller completion settlement could not be confirmed". `src/ui/state/post-job-clean-settle.ts:1-7`: only a clean settle counts as a completed run.
- `src/ui/state/laser-interactive-command.ts:392-393` re-arms the timer only on a non-Idle status report, and `src/core/controllers/marlin/response.ts:50` files every Marlin report as Idle. `src/ui/state/laser-status-polling-policy.ts:28` polls nothing while a command is owed, and `src/ui/state/laser-line-handler.ts:139` drops busy lines.
- Marlin `M400.cpp:29-33` calls `planner.synchronize()`, which idles until the planner is empty (`planner.cpp:1803`). While a handler runs, `host_keepalive()` prints the busy line (`gcode.cpp:1204-1229`, called from `MarlinCore.cpp:836`), every 2 s in stock `Configuration.h:2228-2229`.
- Reproduction: a 72 s final move on the repo simulator with busy keepalives logged "Post-job controller settle failed"; KerfDesk's own program on the audit's Marlin model got the same notice.
- Regression tests: `laser-interactive-command.busy.test.ts`.

**Sources.**

- [MarlinFirmware/Marlin M400.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/motion/M400.cpp#L26-L33): "M400: Finish all moves"
- [MarlinFirmware/Marlin Configuration.h](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/Configuration.h#L2228-L2229): "#define DEFAULT_KEEPALIVE_INTERVAL 2  // Number of seconds between "busy" messages. Set with M113."

### MA-9: An ordinary M5 I drain on Marlin was shown as a held controller and then raised a false stall notice

**Medium** · New · Reproduced

KerfDesk's inline program ends every pass and layer with `M5 I`; `M3 I S0`, `M8` and `M9` also wait for the planner. With one line per `ok`, up to 15 moves are queued when `M5 I` is sent, so its `ok` comes only after they have run: 122 s for 610 mm at 300 mm/min in the audit's test. Marlin prints `echo:busy: processing` every 2 s meanwhile, but KerfDesk ignored it and polls no `M114` while a stream line is owed. After 3 s the Live Motion bar read "The controller reports Idle and has not acknowledged …", using the stale Idle from before the job. After 90 s a stream-stalled notice said the controller was "still answering status queries (reporting Idle)", which Marlin was never asked, told the operator to abort the job, and offered Reconnect. Following that advice ruins a healthy job, and on a board that resets when its port opens, reconnecting also resets Marlin mid-job. The bar appeared at every pass or layer boundary whose buffered tail ran over 3 s, and the notice on slow cuts, for example one 150 mm edge at 100 mm/min.

**Fix.** On controllers polled with a queued command, a busy line now restarts the stall clock as an acknowledgement does. A hold names a controller state only when a status report arrived during the wait. The 90 s notice still covers silence with neither acknowledgements nor busy lines. The same change fixed ST-5. (`d1928d3`, ADR-395)

**Evidence.**

- `src/ui/state/laser-line-handler.ts:139` drops busy lines; `src/ui/state/laser-status-polling-policy.ts:26` polls nothing while stream lines are owed.
- `src/ui/state/laser-stream-hold.ts:48,50`: the bar after 3 s, the notice after 90 s (`laser-stream-stall.ts:19`). `:80` takes the state from the last report; `:158` and `:171` write "while still answering status queries" and "The controller reports ${state}". `src/ui/laser/SafetyNoticeBanner.tsx:40-43` recommends Reconnect for this notice.
- `src/core/output/marlin-inline-transform.ts:11-24` writes `M5 I` at each boundary.
- Marlin `M3-M5.cpp:142-145` (`M5` synchronizes), `:80-81` and `:111` (inline `M3` synchronizes without `LASER_POWER_SYNC`, which is off in stock), `M7-M9.cpp:35,50,65` (`M7`, `M8`, `M9` synchronize); busy lines as in MA-4.
- Reproduction (the audit's Marlin model): at 100 s, with `M5 I` in flight and busy lines in the log, the safety notice was `stream-stalled`.
- Regression tests: `laser-stream-hold.marlin.test.ts`, `laser-stream-hold.test.ts`.

**Sources.**

- [MarlinFirmware/Marlin M7-M9.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/control/M7-M9.cpp#L64-L75): "Wait for move to arrive"
- [MarlinFirmware/Marlin gcode.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/gcode.cpp#L1204-L1229): "SERIAL_ECHO_MSG(STR_BUSY_PROCESSING);"

### MA-12: Marlin skips a command its build lacks and still answers ok, and KerfDesk took that as success

**Medium** · New · Reproduced and traced

A Marlin build compiles only the commands its options enable. A profile that uses `M8` for air assist, on a build without `AIR_ASSIST` or `COOLANT_FLOOD` (both off in stock), gets `echo:Unknown command: "M8"` and then an ordinary `ok`. KerfDesk filed the echo as a plain message, moved on at the `ok` and finished the job cleanly with no notice, while the air stayed off. A build without `LASER_FEATURE` runs an inline program dark the same way. On GRBL the same mismatch is `error:20`, which stops the job. The repo's own test modelled the reply as a terminal `Error:Unknown command` with no `ok`, a reply Marlin never sends (MA-11). The echo did reach the Laser Log, and it takes a profile that does not match the firmware build.

**Fix.** "Unknown command" is now its own event, naming the build option the command needs (for `M8`, `AIR_ASSIST` or `COOLANT_FLOOD`). During a job the `ok` after it counts as an error, as GRBL's `error:20` does: the stream stops, the quick stop is sent, and the notice names the command and the missing option. An owned command is refused with the same text. (`d1928d3`, ADR-395)

**Evidence.**

- `src/core/controllers/marlin/response.ts:16,32-33` files any `echo:` line as a message, and `src/ui/state/laser-line-handler.ts:156` acts on `ok` only. At 39d7f96 nothing in `src/ui` or `src/core` handled "Unknown command"; a grep finds one comment.
- `src/ui/state/laser-lifecycle-marlin.simulator.test.ts:311-324` modelled "Unknown command" as a terminal `Error:`.
- Marlin `gcode.cpp:489-505` compiles `M3` to `M5` only `#if HAS_CUTTER`, `M8` only with `AIR_ASSIST` or `COOLANT_FLOOD`, and `M9` only with `AIR_ASSIST` or `COOLANT_CONTROL`. Anything else reaches `parser.unknown_command_warning()` (`:1101`, `:1119`) and then `queue.ok_to_send()` (`:1122`). `parser.cpp:390-392` prints the warning with `SERIAL_ECHO_MSG`, which starts with `echo:` (`serial.h:286`, `serial.cpp:76`). Stock `Configuration_adv.h:3334,3353,3513` leave `LASER_FEATURE`, `AIR_ASSIST` and `COOLANT_CONTROL` off.
- Reproduction: the echo was in the log, `G1 X20 S200` was sent after the skipped `M8`, and no notice was raised.
- Regression tests: `laser-unknown-command.test.ts`, `laser-lifecycle-marlin.simulator.test.ts`, `marlin-driver.test.ts`.

**Sources.**

- [MarlinFirmware/Marlin gcode.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/gcode.cpp#L499-L501): "#if ANY(AIR_ASSIST, COOLANT_FLOOD)"
- [MarlinFirmware/Marlin gcode.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/gcode.cpp#L1114-L1122): "if (!no_ok) queue.ok_to_send();"

### MA-3: Abort on Marlin recorded no origin while Marlin kept its G92 shift, so Absolute jobs ran displaced

**Medium** · New · Reproduced and traced

After Set origin here (`G92 X0 Y0`), ABORT JOB applied the origin reset written for GRBL's soft reset and recorded the origin as gone. Marlin was not reset: it keeps its G92 shift until homing, a working `G92.1` or a reboot. Absolute Coordinates then resolved with no offset while Marlin ran every coordinate in the shifted frame, so the next Frame and job ran displaced by the old origin. The Frame shows the displaced path, so frame-first review can catch it.

Reset origin left the same wrong record on stock builds, where `G92.1` is acknowledged and does nothing. That half is CG-11, which has its own entry.

**Fix.** Only a stop that sent a reset byte now forgets the origin, so a Marlin Abort keeps the G92 record (`d1928d3`, ADR-395). Reset origin now writes a `G92` to the recorded machine position, which restores machine coordinates on every build (CG-11: `66f549e`, ADR-396).

**Evidence.**

- `src/ui/state/laser-job-actions.ts:339` applies `originUnknownAfterControllerReset` on every Abort, including the no-reset branch at `:314`. `src/ui/state/laser-status-line.ts:337-342` turns a `g92` origin into `workOriginSource: 'none'`. With no origin recorded, Absolute returns `{ ok: true }` with no offset (`src/ui/job-placement.ts:212-214`).
- Marlin `G92.cpp:95-98` adds to `position_shift`. Only `G92.1` built with `CNC_COORDINATE_SYSTEMS` (`:64-70`, off in stock `Configuration_adv.h:3600`), homing (`motion.cpp:2346-2349`) or a reboot clear it. `M5` and `M107` do not touch it (`M3-M5.cpp:142-154`, `M106_M107.cpp:102-115`).
- Reproduction: after ABORT JOB, with no reset byte and no `G92.1` sent, `workOriginSource` was `'none'`.
- Regression tests: `laser-job-stop.marlin.test.ts`; for Reset origin, `marlin-origin-model.test.ts`.

**Sources.**

- [MarlinFirmware/Marlin G92.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/geometry/G92.cpp#L95-L98): "position_shift[i] += d;"
- [MarlinFirmware/Marlin motion.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/motion.cpp#L2346-L2349): "position_shift[axis] = 0;"

### MA-2: After Set origin here on Marlin, User Origin, Current Position and Absolute were refused for good

**Medium** · New · Reproduced

Homing is off on the Generic Marlin profile, so the default placement is User Origin. The operator jogs, clicks Set origin here (`G92 X0 Y0`) and Frames. The Frame waited for a work offset and then refused: "The work origin is set, but the controller has not reported where it is yet." Marlin never reports one. `M114` prints the logical position, which already includes the G92 shift, and KerfDesk filed it as the machine position. Current Position and Absolute Coordinates refused too, and on a homing profile Set origin here switches Absolute to User Origin, which then refused. The refusal's advice, "Wait a moment and try again, or Reset origin and set it again", could not work. Only Verified Origin resolved. It failed closed: nothing moved or burned wrongly.

**Fix.** Marlin now uses a work offset KerfDesk records itself. `M114` is read as the work position. KerfDesk keeps the shift it writes: none at connect and after Home (Marlin's homing clears it), while Set origin here and Zero Z record the machine position their `G92` is written at. The stored report carries machine = work + shift, so every placement mode resolves. A shift set before KerfDesk connected stays invisible to it. (`66f549e`, ADR-396)

**Evidence.**

- `src/core/controllers/marlin/response.ts:49-57` files `M114` as `mPos`, with `wPos: null` and `wco: null`; `src/ui/state/laser-origin-actions.ts:343-344` then leaves the offset unknown.
- `src/ui/job-placement.ts:262-263` refuses User Origin with the message at `:247-249`; `:221-233` refuses Current Position; `:208-219` refuses Absolute while an origin is set; `:37` defaults a profile without homing to User Origin.
- `src/ui/laser/OriginRow.tsx:234-237` switches Absolute to User Origin after Set origin here; `src/ui/laser/frame-position-readiness.ts:45-55` makes the Frame wait, then refuse.
- Marlin `motion.cpp:191-212` prints `rpos.asLogical()` for `M114` (through `report_current_position_projected()`, `:243-246`, `M114.cpp:147`). `G92.cpp:41-43`: `G92` shifts the workspace so the reported position shows the given value.
- Reproduction: User Origin was refused with the "has not reported where it is yet" message after 10 s of `M114` polls.
- Regression tests: `marlin-origin-model.test.ts`, `marlin-origin-placement.simulator.test.ts`, `marlin-position-report.test.ts`.

**Sources.**

- [MarlinFirmware/Marlin motion.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/motion.cpp#L191-L193): "// Report the logical position for a given machine position"
- [MarlinFirmware/Marlin G92.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/geometry/G92.cpp#L41-L43): "Modify Workspace Offsets so the reported position shows the given X"

### MA-8: Marlin runs G0 at the last cut feed, but KerfDesk timed it as a rapid, so travel crawled and estimates fell short

**Medium** · New · Reproduced and traced

Stock Marlin has no separate rapid rate: `G0_FEEDRATE` is commented out, so a `G0` moves at the one modal feed that any F sets. KerfDesk wrote Marlin travel and the closing park as `G0 X.. Y.. S0` with no F. After the first cut every travel and the park ran at the cut feed, for example 300 mm/min; the first travel ran at whatever feed was modal, a Frame's or jog's F, or 4000 mm/min after power-on. The estimator timed each `G0` at the profile's maximum feed. In the audit's example Job Review estimated 18.5 s and the job took 82 s, and the slow park caused the settle timeout in MA-4.

**Fix.** Every `G0` in Marlin output, inline and fan dialects, now carries `F<profile max feed>`, the rate the estimator uses for rapids, and the first feed move after it without an F gets the cut feed restated. The example now runs in about 19 s on the audit's Marlin model. Output for the other controllers is unchanged. (`926d863`, ADR-398)

**Evidence.**

- `src/core/output/grbl-strategy.ts:55-56` writes travel as `G0 X.. Y..` plus `S0`, with no F, and the Marlin transforms pass it through. `src/core/gcode-time/segment-blocks.ts:35-36` times a rapid at `maxFeedMmPerMin`, and `src/core/job/estimate-duration.ts:70-84` gives Job Review that timeline.
- Marlin `Configuration_adv.h:3721` has `//#define G0_FEEDRATE 3000`; `G0_G1.cpp:52-73` keeps every G0-only feed under `#ifdef G0_FEEDRATE`; `gcode.cpp:213-214` sets the shared feed from any move's F; `motion.cpp:131-134` starts at `DEFAULT_FEEDRATE_MM_M 4000`.
- Reproduction: `estimateJobDuration` on the Generic Marlin profile gave about 18.5 s; the same program streamed by KerfDesk into the audit's Marlin model took 82 s.
- Regression tests: `marlin-travel-feed.test.ts`, `marlin-strategy.test.ts`, `controller-native-modes.test.ts`.

**Sources.**

- [MarlinFirmware/Marlin Configuration_adv.h](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/Configuration_adv.h#L3721): "//#define G0_FEEDRATE 3000 // (mm/min)"
- [MarlinFirmware/Marlin gcode.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/gcode.cpp#L213-L217): "feedrate_mm_s = parser.value_feedrate();"

### MA-5: Marlin never answers a comment-only line, so one typed in the Console wedged the session

**Medium** · New · Reproduced

Marlin drops a line that holds only a comment, `; note` (or `(note)` on a `PAREN_COMMENTS` build), without replying. The Marlin Console accepted `; note` and wrote it as a command that owes one `ok`. KerfDesk never expires an owed acknowledgement (ADR-362 Amendment 1, decision 4), so status polls, the Console, Jog, Frame and Start were refused until Disconnect. The job streamer already skipped `;` lines; the Console did not. It is the same class of defect as ADR-361 decision 2: a line that owes a reply the controller never sends. The trigger is narrow: typing a comment in the Console.

**Fix.** The Marlin Console refuses a line that is empty once `;` and `(...)` comments are removed. (`d1928d3`, ADR-395)

**Evidence.**

- `src/core/controllers/marlin/console-command.ts:31-48` refuses only empty input, multiple lines, non-ASCII text and `M500`/`M502`, so `; note` reaches `command('gcode', …)` at `:48`. `src/ui/state/console-command-transport.ts:85` writes it with one owed acknowledgement. The job streamer never sends `;` lines (`src/core/controllers/grbl/streamer.ts:139-142`).
- Marlin `queue.cpp:369-372` starts an end-of-line comment at `;` and stores nothing, `process_line_done` reports the line as empty (`:396-405`), and the reader moves on without queuing or answering it (`:466-468`). Stock `Configuration_adv.h:3717` leaves `PAREN_COMMENTS` off.
- Reproduction (a fake that follows `queue.cpp`): `; note` was accepted, one acknowledgement stayed owed, and `M105` was refused.
- Regression tests: `laser-console-marlin.simulator.test.ts`, `marlin-driver.test.ts`.

**Sources.**

- [MarlinFirmware/Marlin queue.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/queue.cpp#L464-L468): "// Reset our state, continue if the line was empty"
- [MarlinFirmware/Marlin queue.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/queue.cpp#L369-L372): "// Start end-of-line comment"

### MA-6: KerfDesk could not read M114 from a Marlin build without Z, so it reported the board as not answering

**Medium** · New · Reproduced

An XY-only Marlin build (no Z driver, so two axes) answers `M114` with `X:10.00 Y:5.00 Count X:800 Y:400`, adding `E:` only when extruders are configured. KerfDesk's position pattern required `Z:`, so every poll's position line was ignored, although each poll was answered with `ok`. In a probe run for the audit, qualification failed with "No controller response was received at 250000 baud. Check the cable and controller profile, then retry.", the log read "No controller response within 8 s. Check baud rate (250000) and that the device is Marlin.", and Jog was refused because "Controller status is not known yet". It failed closed, but an XY-only Marlin laser could not be used, and the message sent the operator to the cable and the baud rate.

**Fix.** `M114` is parsed with `Z:` optional. (`66f549e`, ADR-396)

**Evidence.**

- `src/core/controllers/marlin/response.ts:15`: `POSITION_RE` requires `Z:`, and `:43-48` return no report without a match. `src/ui/state/laser-controller-silence.ts:50,57` are the two silence messages.
- Marlin `Conditionals_LCD.h:233-253` sets `NUM_AXES 2` when Y is the highest axis with a driver (`:247-248`). `motion.cpp:194-211` prints one label per axis, and E only with extruders; `stepper.cpp:3260-3274` does the same for the counts. `SanityCheck.h:1020-1023` forbids only leveling and `CNC_WORKSPACE_PLANES` without Z.
- Reproduction: both XY-only lines classified as unknown.
- Regression tests: `marlin-position-report.test.ts`.

**Sources.**

- [MarlinFirmware/Marlin motion.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/motion.cpp#L192-L212): "LIST_N(DOUBLE(NUM_AXES),"

### MA-10: After M112 or a firmware halt Marlin needs a reset or power cycle, but KerfDesk said to reconnect or wait for Idle

**Low** · New · Reproduced and traced (plausible on real hardware)

The Console's `M112` quick command said "halts firmware; reconnect required". After `Error:Printer halted. kill() called!`, the generic notice said "Check the Laser Log, wait for Idle, and home before continuing". After `kill()` Marlin switches off interrupts and waits for its RESET button, its KILL button or a power cycle; it never reports Idle again. The next `M114` poll went unanswered, so its owed acknowledgement blocked every command until Disconnect. Reopening the port resets only boards whose USB-serial chip pulses reset on open; a native-USB board stays halted. The same notice followed a failed Home on a stock build, where `VALIDATE_HOMING_ENDSTOPS` kills on a missed endstop (traced, not reproduced). The stop itself works; only the advice was wrong.

**Fix.** The `M112` hint and a new halted-controller notice say to press the controller's reset button or power-cycle it, then reconnect. No stop lines are written after `kill()`, and Abort or Disconnect keep that advice. (`d1928d3`, ADR-395)

**Evidence.**

- `src/core/controllers/marlin/driver.ts:92-96`: "EMERGENCY STOP (halts firmware; reconnect required)". `src/ui/state/laser-safety-notice.ts:231-248`: the controller-error notice ends "wait for Idle, and home before continuing if position is uncertain."
- `src/__fixtures__/controllers/marlin-simulator.ts:158-162` cleared the halt when the port reopened (MA-11).
- Marlin `MarlinCore.cpp:889-917`: `kill()` prints `Error:Printer halted. kill() called!` (`:909-910`); `minkill()` then calls `cli()` (`:924`) and loops until reset or power-cycle (`:956`), or, on a build with a kill button, reboots only after that button is pressed (`:941-952`). `endstops.cpp:453-458` kills when a homing move misses its endstop, a check stock `Configuration.h:2136` enables.
- Reproduction: the hint mentioned neither reset nor power, and the notice said "wait for Idle".
- Regression tests: `laser-error-line.marlin.test.ts`, `marlin-driver.test.ts`.

**Sources.**

- [MarlinFirmware/Marlin MarlinCore.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/MarlinCore.cpp#L889-L893): "After this the machine will need to be reset."
- [MarlinFirmware/Marlin MarlinCore.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/MarlinCore.cpp#L956): "// Wait for RESET button or power-cycle"

### MA-11: The Marlin simulator answered in ways Marlin never does, so the Marlin store tests passed on false behaviour

**Low** · New · Reproduced

The repo's Marlin simulator hid MA-4, MA-5, MA-7, MA-9 and MA-12. It answered `; note` and empty lines with `ok`; Marlin drops them without a reply. It answered a later `M114` while an `M400` or `M5` was still waiting; Marlin runs lines in order. It ended each move a fixed time after queuing it, so moves overlapped, and it had no 16-block planner, so an `ok` was never delayed. Its rejections sent `Error:` with no `ok`, which one test used to model "Unknown command". It never printed `echo:busy: processing`, although its header promised busy lines, and it cleared an `M112` halt when the port reopened. ADR-364's burn oracle was not affected: its power model depends on order, not time.

**Fix.** The simulator now models Marlin's 4-line command buffer and its 16-block planner, which holds 15 moves because one slot stays free, busy lines every 2 s while a command waits, silent comment and empty lines, `Error:` followed by `ok`, "Unknown command" plus `ok` per build option, `M410`, `M112`, and `G92` with its position echo. (`d1928d3`, 15 moves `d6b1b29`, ADR-395)

**Evidence.**

- `src/__fixtures__/controllers/marlin-simulator.ts`: `:114-117` answer an empty line with `ok`, and a comment line falls through to `handleMotion` (`:155`), which always answers `ok` (`:104`); `:134-140` answer `M114` ahead of a waiting `M400` or `M5`; `:101-102` end each move `motionMs` after queuing; `:109-112` send `Error:` without `ok`; `:2-3` promise busy lines; `:158-162` clear the halt on open. `src/ui/state/laser-lifecycle-marlin.simulator.test.ts:311-324` relied on the `Error:` reply.
- Marlin `queue.cpp:396-405,466-468` (no reply to empty or comment lines); `M400.cpp:29-33`, `M3-M5.cpp:142-145` and `planner.h:774-777` (commands wait in order for the planner, which holds `BLOCK_BUFFER_SIZE - 1` moves, `planner.h:765`); `gcode.cpp:1122` (`ok` also after a handler error, such as `G2_G3.cpp:487`); `gcode.cpp:1204-1229` (busy lines); `MarlinCore.cpp:956` (halted until reset).
- Reproduction: five tests failed on the old simulator. It answered a comment line, answered `M114` behind a waiting `M400`, ran two 1 s moves in 1 s, sent `Error:` without `ok`, and printed no busy line in 4.5 s of `M400`.
- Regression tests: `marlin-simulator.test.ts`.

**Sources.**

- [MarlinFirmware/Marlin queue.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/queue.cpp#L392-L405): "Handle a line being completed. For an empty line"
- [MarlinFirmware/Marlin planner.h](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/module/planner.h#L774-L777): "// Wait until there are enough slots free"

## Smoothieware

What Smoothieware (edge 38e2cc08) does with KerfDesk's origin, power words, Home, Frame and replies.

### SM-1: Smoothieware keeps its G92 origin through a reconnect, halt or Home, but KerfDesk forgot it, so Absolute jobs ran displaced

**High** · New · Reproduced

Smoothieware applies a G92 origin until a G92 command changes it. A halt, `M999`, `$X`, Home and a USB reconnect all leave it in place, and a board can boot with one (`set_g92` in its config, or `save_g92` and an earlier `M500`). KerfDesk learned a work offset only from GRBL's `WCO:` field, which Smoothieware never prints. For a G92 origin it recorded "no origin" on every connect, Alarm report, Abort and Unlock, and a later Home did not bring it back. Absolute Coordinates, the default on a homing profile, then resolved with no offset. KerfDesk sent the Frame and the job in bed coordinates and the board added the stale G92: after Set origin here at machine X110 Y60, everything landed 110 mm and 60 mm away. The canvas uses WPos, so the screen looked right; only the Frame traced in the wrong place. The bounds check assumed no offset, so the job could also run past the travel limits. CG-1 has the same cause.

**Fix.** When a report carries MPos and WPos and no `WCO:`, KerfDesk takes MPos minus WPos from that report as the work offset, the same quantity GRBL's `WCO:` carries. The offset is relearned on the first report after any reconnect, halt, `M999` or Home. (`ff6d06f`, ADR-396)

**Evidence.**

- `src/ui/state/laser-status-position.ts:51-53` learns no offset when `report.wco` is null. `src/ui/state/laser-status-line.ts:337-342` turns a `g92` origin into `'none'` on every Alarm or Sleep report (`:279`) and on Abort (`src/ui/state/laser-job-actions.ts:339`). Every connect starts at `'none'` (`src/ui/state/laser-connection-actions.ts:236-237`), Unlock applies `controllerUnlockedPatch`, which does the same to a `g92` origin (`src/ui/state/laser-autofocus-actions.ts:44`, `src/ui/state/laser-console-completion.ts:78-90`), and Home keeps only an origin still on record (`src/ui/state/laser-home-action.ts:110-114`).
- `src/ui/job-placement.ts:212-214` resolves Absolute with no offset when no origin is recorded, `:154-172` then gives the bounds check a zero offset, and `:37` makes Absolute the default when homing is on. `src/ui/state/canvas-motion-plan.ts:367` draws the head from WPos.
- Smoothieware `Robot.cpp:624-661`: only G92 commands change `g92_offset`. Robot registers only `ON_GCODE_RECEIVED` (`:131-133`), and a halt only resyncs positions (`Kernel.cpp:358-380`). Homing resets positions, not offsets (`Endstops.cpp:962-971`). A USB attach prints `Smoothie` and `ok` and resets nothing (`USBSerial.cpp:328-333`). `Robot.cpp:199-205` and `:985-991` load and save a G92 for boot.
- Smoothieware `Kernel.cpp:207-234` (running) and `:262-288` (idle): each report prints MPos and WPos from one sample, WPos from `mcs2wcs` (`Robot.cpp:448-456`), and never WCO.
- Reproduction: on a board reporting MPos 110,60 and WPos 0,0, both after a reconnect and after Set origin here, halt, Unlock and Home, Absolute resolved `{"ok":true}` with no offset instead of X110 Y60.
- Regression tests: `laser-status-smoothie-offset.test.ts`.

**Sources.**

- [Smoothieware Robot.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L624-L661): "// standard setting of the g92 offsets, making current WCS position whatever the coordinate arguments are"
- [Smoothieware Robot.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L131-L133): "this->register_for_event(ON_GCODE_RECEIVED);"
- [Smoothieware Kernel.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/Kernel.cpp#L283-L287): "Robot::wcs_t pos = robot->mcs2wcs(mpos);"

### SM-7: Smoothieware stores S in 12 bits, so a Full-power S of 2 or more fired far below the requested power

**Medium** · New · Reproduced and traced

Smoothieware keeps each move's S in a 12-bit field as 1.11 fixed point: it stores `round(S × 2048)` and keeps the low 12 bits, so only S below 2 reaches the laser intact. The laser fires at the stored value / 2048 / M, where M is `laser_module_maximum_s_value`, so every burn requested at 2/M or more fires far below it, never above. With M = 255, 50 % (S127.5) fires at 0.59 % and 100 % (S255) at 0.39 %; with M = 100, S50 fires at 0 % and S75 at 1 %. KerfDesk's output, Job Review and the board's own `S:` report all show the requested value, so nothing points at the cause. The default Full-power S of 1 in the setup wizard and the catalog is exact. But Machine Setup said "Match laser_module_maximum_s_value to the profile", Smoothieware's documentation offers 100 and 255, ADR-322 §3 made matching the rule, and the Full-power S field accepted any whole number up to 100000. Every build since the 12-bit field arrived in July 2016 does this, including the shipped `firmware.bin`.

**Fix.** Machine Setup holds a Smoothieware profile's Full-power S at 1 and says why. A saved profile with another value keeps it and gets an explicit "Set to 1", never a silent change (ADR-322 §6). Job Review and Save G-code warn for a Full-power S of 2 or more, and the setup guide and profile note say to set `laser_module_maximum_s_value 1.0`. (`1599a71`, ADR-397)

**Evidence.**

- `src/core/output/smoothieware-strategy.ts:36` writes each burn S as a fraction of the profile's `maxPowerS`. `src/ui/laser/DeviceProfilePowerFields.tsx:37-41` accepts whole numbers from 1 to `MAX_POWER_S`, and `src/core/devices/profile-catalog.ts:250` only requires a positive value.
- `src/ui/laser/device-setup/machine-setup-controller-guide.ts:99` and `src/core/devices/profile-catalog.ts:137` tell the operator to match `laser_module_maximum_s_value` to the profile; `DECISIONS.md:20243-20245` (ADR-322 §3): "The profile must match `laser_module_maximum_s_value`".
- Smoothieware `Block.h:81` declares `uint16_t s_value:12`; `Planner.cpp:81` stores `roundf(s_value*(1<<11))`; `Robot.cpp:1034` and `:1466` pass the raw G-code S to the planner; `Laser.cpp:246` divides by 2048 and by `laser_maximum_s_value` (read at `:109`).
- The shipped `FirmwareBin/firmware.bin` (md5 `ded5f86a99235c483e7f7bcc683dcf84`) stores the field at 0x113e0 to 0x11408 with a multiply by 2048.0, `roundf`, a float-to-unsigned conversion and `bfi r3, r0, #0, #12`: rechecked with `arm-none-eabi-objdump`. The 12-bit field replaced `float s_value;` in 5c749b4a (2016-07-31).
- Reproduction (the real strategy plus the firmware arithmetic): S50 on M = 100 fired at 0 instead of 0.5, and S127.5 on M = 255 at 0.0059; the M = 1 control passed. The old test oracle divided the float S and could not see this (`smoothie-laser-power-model.ts:10`, SM-4).
- Regression tests: `smoothie-power-scale.test.ts`, `smoothie-full-power-s.test.tsx`.

**Sources.**

- [Smoothieware Planner.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Planner.cpp#L81): "block->s_value = roundf(s_value*(1<<11)); // 1.11 fixed point"
- [Smoothieware Laser.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp#L246): "float requested_power = ((float)block->s_value / (1 << 11)) / this->laser_maximum_s_value; // s_value is 1.11 Fixed point"
- [Smoothieware docs: Laser module options](https://github.com/Smoothieware/smoothieware-website-v1/blob/ab8f6dc196603dd9dfd28e4e2e1af11d7c22e1bb/docs/modules/laser/laser-options-for-include.md#L83-L94): "S0-S255 range (common in laser software)"

### SM-6: Smoothieware answers $H with ok even when nothing homed, and KerfDesk confirmed that Home

**Medium** · New · Reproduced

The Home button appears only when the profile has homing enabled. If the board cannot home X and Y, because no endstop pins are configured (the Endstops module then deletes itself) or X or Y has no homing pin, `$H` homes nothing, or only one axis, and may print `WARNING: Nothing to home`. SimpleShell then prints `ok` whatever happened. KerfDesk sent `M400`, the tool-off lines and `$H`, waited for each answer, the `M400` marker and one Idle report, and logged "Homing confirmed after fresh Idle." The false proof had effects: the camera overlay said "Machine position is trusted from Home.", the jog bounds and no-go zone checks were switched off, and Absolute Coordinates, the default on a homing profile, ran relative to wherever the head was at power-on. GRBL refuses `$H` with `error:5` when homing is disabled; Smoothieware gives no such answer. It needs a board whose homing is not set up while the profile says it is, and the Frame still traces the real position before Start.

**Fix.** After `$H` settles, KerfDesk sends `G28.6`, which lists each axis that has a homing pin and whether it homed. The Home is confirmed only when the reply lists `X:1` and `Y:1`; otherwise it ends with "Home was not confirmed." and the reason: no homing switches, or an axis the cycle did not home. (`2b561e3`, ADR-397)

**Evidence.**

- `src/core/controllers/smoothieware/driver.ts:67`: Home is `M400`, the tool-off lines and `$H`. `src/ui/state/laser-home-action.ts:150-176` waits for each answer, the `M400` marker and one fresh Idle, then `confirmHome` (`:187-198`) records the Home. Nothing asks the board what homed, and `src/core/controllers/smoothieware/response.ts:48` files `WARNING: Nothing to home` as unknown text.
- `src/ui/state/laser-jog-warnings.ts:62` skips the bounds and no-go comparison once Home is confirmed; `src/ui/camera/OverlayControls.tsx:195` shows "Machine position is trusted from Home."; `src/ui/job-placement.ts:37` defaults to Absolute when homing is on.
- Smoothieware `SimpleShell.cpp:241-252`: `$H` dispatches `G28` (`G28.2` in grbl mode), then prints `ok`. `Endstops.cpp:114-129` deletes the module when no pins are defined (`:206`, `:339`), and `:849-852` print `WARNING: Nothing to home` and return. `Kernel.cpp:181-182` reports no homing state without the module.
- `Endstops.cpp:1114-1120`: `G28.6` prints `<axis>:<homed>` for each axis with a homing pin (since fdfa00d2, 2016-10-01). The flag stays set until a reset (`:957-958`), and a failed cycle clears it (`:902`). GRBL `system.c:179-180` answers `$H` with `STATUS_SETTING_DISABLED` (error 5) when homing is off.
- Reproduction: on a simulated board without the Endstops module, `$H` got `ok` at once and nothing moved, yet Home was confirmed with the head still at the jogged X40 Y25.
- Regression tests: `home-verification.test.ts`, `laser-home-smoothie-verification.simulator.test.ts`.

**Sources.**

- [Smoothieware SimpleShell.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/utils/simpleshell/SimpleShell.cpp#L241-L252): "new_message.stream->printf("ok\n");"
- [Smoothieware Endstops.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/endstops/Endstops.cpp#L849-L852): "THEKERNEL->streams->printf("WARNING: Nothing to home\n");"
- [Smoothieware Endstops.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/endstops/Endstops.cpp#L1114-L1120): "G28.6 is a smoothie special it shows the homing status of each axis"
- [gnea/grbl system.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L179-L180): "if (bit_isfalse(settings.flags,BITFLAG_HOMING_ENABLE)) {return(STATUS_SETTING_DISABLED); }"

### SM-3: Without the Laser module nothing answers fire off, so Jog, Frame, Home and Start wedged

**Medium** · New · Reproduced

Smoothieware's Laser module deletes itself at boot unless `laser_module_enable` is true (the default is false) and the laser pin is a hardware-PWM pin. Without it nothing on the board answers the `fire` shell command: SimpleShell leaves `fire` to the Laser module, and GcodeDispatch ignores lowercase lines. KerfDesk began every jog, Frame, Home and job with `fire off` and waited for its reply. A jog's eleven lines got ten answers, so one acknowledgement stayed owed, and Jog, Frame, Home and Start were refused on an Idle machine: "Home is blocked until the previous controller write and terminal acknowledgement settle." Home on its own stalled on `fire off`, never sent `$H`, and failed after 120 s with "home timed out." A job stalled on its first line. Abort and Unlock cleared the debt only until the next jog, Frame or Home, and nothing told the operator why.

**Fix.** At each qualification KerfDesk sends one `M221` with no argument; the Laser module prints a `Laser power` report before the `ok`, and a bare `ok` means no module. Without it, Jog, Frame and Home leave out `fire off`, and so does the streamed job program. Fire and the Console `fire` are refused, because nothing would answer them. A laser job's Frame and Start are not refused: the program runs with the laser off, and Job Review warns "This job will not burn: …" with the config fix. (`6fc5b06`, `8c78a17`, ADR-397)

**Evidence.**

- `src/core/controllers/smoothieware/commands.ts:35-43` puts `fire off` first in the tool-off lines, which start every jog (`:66-73`) and Home (`driver.ts:67`); the job program's first line is `fire off` (`src/core/output/smoothieware-strategy.ts:28`).
- `src/core/controllers/smoothieware/response.ts:27`: the only completion is the Laser module's own "turning laser off and returning to auto mode". `src/ui/state/laser-safe-write.ts:294-299` owes one acknowledgement per line and nothing expires it; `src/ui/state/laser-home-action.ts:50` gives Home 120 s.
- Smoothieware `Laser.cpp:53-57` deletes the module unless `laser_module_enable` is true, and `:69-74` when the pin has no hardware PWM. `SimpleShell.cpp:286-288` does nothing for `fire`, and `GcodeDispatch.cpp:79-82` ignores lowercase lines.
- Reproduction (the simulator with nothing answering `fire off`): after a jog one acknowledgement stayed owed and Home was refused; Home alone ended "home timed out." with no homing cycle and one acknowledgement owed.
- Regression tests: `laser-module.test.ts`, `laser-module-readiness.test.ts`, `start-laser-module-readiness.test.ts`, `laser-module-probe.simulator.test.ts`.

**Sources.**

- [Smoothieware Laser.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp#L51-L57): "if( !THEKERNEL->config->value( laser_module_enable_checksum )->by_default(false)->as_bool() ) {"
- [Smoothieware SimpleShell.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/utils/simpleshell/SimpleShell.cpp#L286-L288): "// these are handled by Laser module"
- [Smoothieware GcodeDispatch.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/communication/GcodeDispatch.cpp#L79-L82): "// ignore all lowercase as they are simpleshell commands"

### SM-2: Smoothieware built before June 2021 ignores M221 P, so constant-power layers ran speed-proportional

**Medium** · New · Traced

For Smoothieware, KerfDesk writes a constant-power layer's `M3` as `M400` and `M221 S100 P1`. P1 switches off Smoothieware's speed-proportional power, but only builds from edge 971eb8cf (15 June 2021) read P. Older builds ignore it and always scale power by the speed ratio, so a constant-power layer burns lighter at corners and on short segments. They had no config route to constant power either: `laser_module_proportional_power` arrived four days later. Only constant-power output is affected, from the GRBL Compatible dialect or a per-layer constant-power override; the default GRBL Dynamic dialect writes `P0`, which old builds already do. KerfDesk never read the build and named no minimum build.

**Fix.** The qualification `M221` probe (SM-3) tells the builds apart: current builds print `Laser power: …, disable auto power: …`, older ones `Laser power scale at …`. On an older build Job Review warns that constant-power layers run speed-proportional. The profile note names the minimum build, edge 971eb8cf (2021-06-15). (`6fc5b06`, `1599a71`, ADR-397)

**Evidence.**

- `src/core/output/smoothieware-strategy.ts:53-55` maps `M3` to `M221 S100 P1` and `M4` to `P0`, each after `M400`. `src/core/devices/gcode-dialects.ts:109-116`: GRBL Compatible is constant power. `src/core/devices/profile-catalog.ts:137` names no minimum build.
- Smoothieware `Laser.cpp:206-208` reads P into `disable_auto_power`, and `:248-250` apply the speed ratio unless it is set.
- History, checked in a full clone: 971eb8cf (2021-06-15) added `disable_auto_power` and the P word, and replaced both the `Laser power scale at %6.2f %%` report and the unconditional `float ratio = current_speed_ratio(block);`. 0565b132 (2021-06-19) added `laser_module_proportional_power`.
- Reproduction: traced only; the simulator modelled the current firmware.
- Regression tests: `laser-module.test.ts`, `laser-module-readiness.test.ts`, `laser-module-probe.simulator.test.ts`.

**Sources.**

- [Smoothieware Laser.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp#L206-L208): "this->disable_auto_power= gcode->get_uint('P') > 0;"
- [Smoothieware Laser.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp#L248-L250): "if(!disable_auto_power) { // true to disable auto power"
- [Smoothieware commit 971eb8cf](https://github.com/Smoothieware/Smoothieware/commit/971eb8cf281c978cd31f2f9563a7992effb5e5e9): "finish up changimg PWM frequency for laser"

### SM-5: A stopped Frame left its framing feed as Smoothieware's travel speed for later jobs

**Low** · Incomplete fix of ADR-361 · Reproduced

Smoothieware takes the F on a `G0` line as its seek rate, the speed of every later bare `G0`. ADR-361 item 6 kept a jog's or Frame's feed from leaking by wrapping them in `M120` (save state) and `M121` (restore state). But KerfDesk sends a Frame one line per completed leg, so `M121` goes out only after the last leg. Stop motion (Ctrl/Cmd+.), ABORT MOTION followed by Unlock, a kill, limit or soft-endstop halt, or a rejected leg ended the Frame before its `M121`, and Robot has no halt handler to restore the state. Every later job's bare `G0` travel then ran at the framing feed until the board rebooted: the 6000 mm/min default framing feed instead of the configured seek rate (4000 in the config sample), or a slow framing feed that made every travel crawl. `G0` never fires the laser, so no burn was wrong; only the travel speed changed.

**Fix.** KerfDesk counts each Frame `M120` the board accepted, and a completed Frame pops its own. Each push left over gets one `M121` at the next Idle report with nothing else owning the controller, so only once the board is unhalted. `M121` on an empty stack does nothing. (`6fc5b06`, ADR-397)

**Evidence.**

- `src/core/controllers/smoothieware/commands.ts:75-81` wraps the Frame's `G0 X.. Y.. F<frame>` legs (`src/core/controllers/relative-jog-commands.ts:45`) in `M120` and `M121`. `src/ui/state/laser-frame-status.ts:43-49` sends the next line only after the previous leg completes, and `src/ui/state/laser-motion-operation.ts:272-277` sends nothing more once the Frame is cancelled, `M121` included.
- `src/ui/laser/use-job-shortcuts.ts:66`: Ctrl/Cmd+. during a Frame called `cancelJog`. Job travel carries no F (`src/core/output/grbl-strategy.ts:55-56`).
- Smoothieware `Robot.cpp:1144-1149` sets `seek_rate` from F on a `G0`; `:777-783` and `:331-352` push and pop the feed, seek rate, modes and WCS; Robot registers only `ON_GCODE_RECEIVED` (`:131-133`). The config sample's `default_seek_rate` is 4000 (`ConfigSamples/Smoothieboard/config:7`).
- Reproduction (the simulator with the seek/feed split and `M120`/`M121`): after Ctrl/Cmd+. in the first leg, a two-travel job ran both travels at 1500 mm/min instead of 4000; after ABORT MOTION and Unlock, 1500 instead of 4000.
- Regression tests: `laser-frame-modal-restore.simulator.test.ts`.

**Sources.**

- [Smoothieware Robot.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L1144-L1149): "this->seek_rate = this->to_millimeters( gcode->get_value('F') );"
- [Smoothieware Robot.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L777-L783): "case 121: // pop state"

### SM-8: Smoothieware's own ALARM lines were booked as the rejection of an innocent job line

**Low** · New · Reproduced

Smoothieware prints `ALARM:` lines on its own when it halts: a hard limit, the kill button, or Ctrl-X in grbl mode. After a homing or probe failure it prints one before the command's own `ok`. None of them answers a line. KerfDesk treated every `ALARM`, `error:` and `!!` line as a terminal error and booked it as the reply of whichever line was owed, usually the job's line in flight. A hard limit mid-job therefore read "The controller rejected a command (unrecognized controller error response: ALARM: Hard limit +X) during the job … Rejected line: G1 X30 Y1 F600 S0.5", naming a G1 the board never ran. Stopping the job was right, and the acknowledgement count recovered, because the Alarm report after every halt resets it; only the text was wrong. ADR-362 §5 had already made GRBL's `ALARM:N` settle no line, but the Smoothieware classifier was not changed.

**Fix.** Smoothieware `ALARM:` lines are now an alarm event without a code, which settles no line. Like `ALARM:N` it stops a running stream and logs "Controller alarm: <text>", and the Alarm status that follows drives the banner. `!!`, `error:Alarm lock` and GcodeDispatch's `error:` replies stay terminal, because they are real replies. (`340b036`, ADR-397)

**Evidence.**

- `src/core/controllers/smoothieware/response.ts:16,33-35` turns any line starting `ALARM` into `{ kind: 'error' }`, and `src/ui/state/laser-stream-ack.ts:56` treats every error as a terminal acknowledgement. `src/ui/state/laser-error-line.ts:28-31` names the stream's line in flight as rejected, `:43` builds the notice, and `:47-48` stop the stream. The alarm event needed a number (`src/core/controllers/controller-event.ts:12`).
- Smoothieware prints these unasked: hard limit `Endstops.cpp:420-430`, kill button `KillButton.cpp:53-64`, Ctrl-X in grbl mode `USBSerial.cpp:302-314`. Homing and probe failures print `ALARM:` before the command's `ok` (`Endstops.cpp:895-902` with `SimpleShell.cpp:251`; `ZProbe.cpp:493-496`).
- `docs/decisions/ADR-362-controller-audit-follow-up.md:42`: "`ALARM:N` acknowledges no line."
- Reproduction: `ALARM: Hard limit +X` during a one-line-per-`ok` job on the simulator gave `rejectedLine: 'G1 X30 Y1 F600 S0.5'` instead of none.
- Regression tests: `laser-alarm-line.smoothie.simulator.test.ts`, `smoothieware-driver.test.ts`.

**Sources.**

- [Smoothieware Endstops.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/endstops/Endstops.cpp#L420-L430): "THEKERNEL->streams->printf("ALARM: Hard limit %c%c\n", d, a);"
- [Smoothieware KillButton.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/utils/killbutton/KillButton.cpp#L53-L64): "ALARM: Kill button pressed - reset, $X or M999 to clear HALT"

### SM-9: The status row showed Smoothieware's requested feed as a live feed, and S as 0

**Low** · New · Traced

At rest Smoothieware reports `F:<requested>,<override>`; while running it reports `F:<current>,<requested>,<override>`, then `L:<power>` and `S:<s>`. KerfDesk took the first `F:` value as the live feed, so a standing machine showed `F: 4000 mm/min`, where GRBL shows 0. `S:` always showed 0, because KerfDesk read spindle only from GRBL's `FS:` field. With a G92 origin set, the Origin row showed "machine 0,0" in the red custom-origin style, because no offset was known (SM-1). No control logic reads this feed, and the canvas badge shows it only while running, when the first value is the real feed. Only the display misled.

**Fix.** For Smoothieware the parser drops the feed unless the state is Run or Home, reads S from `S:` and the live laser power from `L:`, and the status row shows `L: n%` beside S. SM-1's derived offset fixes the Origin row. (`340b036`, ADR-397)

**Evidence.**

- `src/core/controllers/grbl/status-parser.ts:173` takes `feed` from the first `F:` value, and `:319-331` read spindle only from `FS:`.
- `src/ui/laser/StatusDisplay.tsx:26,48-51` print `F: … mm/min S: {report.spindle ?? 0}`, and `:42-46` print "machine 0,0" when no offset is known. `src/ui/workspace/canvas-motion-badge.tsx:163` shows the feed only while running.
- Smoothieware `Kernel.cpp:236-253`: the running form is `|F:%1.1f,%1.1f,%1.1f` (current, requested, override), then `|L:` and `|S:`. `:289-294`: the resting form is `|F:%1.1f,%1.1f`, the requested feed and the override.
- Reproduction: traced; parsing `<Idle|…|F:4000.0,100.0>` gives `feed: 4000, spindle: null`.
- Regression tests: `StatusDisplay.smoothie.test.tsx`, `smoothieware-driver.test.ts`.

**Sources.**

- [Smoothieware Kernel.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/Kernel.cpp#L289-L294): "// requested framerate, and override"
- [Smoothieware Kernel.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/Kernel.cpp#L236-L242): "// current feedrate and requested fr and override"

### SM-4: The Smoothieware simulator was more forgiving than the firmware, so the store tests hid these defects

**Low** · New · Traced

The repo's Smoothieware simulator hid SM-1, SM-3, SM-6, SM-7, SM-8 and CG-3. On Ctrl-X it printed a `Smoothie` banner, which KerfDesk takes for a reboot, and halted only when moving; the firmware always halts, prints `ALARM: Abort during cycle` (grbl mode) or `HALTED, M999 or $X to exit HALT state`, and flushes its input. `G92 X0 Y0` ran as a move, and WPos always equalled MPos. While halted it answered `!!` to everything but `M999`, where the firmware still runs `M2`, `M5`, `M9`, `M114` and ten other M-codes. `fire off` was always answered and `$H` always homed. Every report had the resting form, the power model divided the float S, and it never printed unsolicited `ALARM:` lines. It opened with the network shell's greeting, `Smoothie command shell`, instead of USB's `Smoothie` and `ok`. CG-6 was dropped as a duplicate of this finding.

**Fix.** The simulator now follows edge 38e2cc08 on each point, with the Laser module (current, pre-2021 or absent) and the Endstops module as options, `G28.6` and `M221` reports, and S stored in 12 bits. (`b42de29`, ADR-397)

**Evidence.**

- `src/__fixtures__/controllers/smoothie-simulator.ts`: `:157-164` (Ctrl-X), `:132` (WPos equals MPos, one report form), `:294-298` (halted replies), `:307-310` (`fire off`), `:276-279` (`$H`), `:337` (open banner). `src/__fixtures__/controllers/smoothie-laser-power-model.ts:10` divides the float S.
- Smoothieware `USBSerial.cpp:302-314` (Ctrl-X halts, prints and flushes), `GcodeDispatch.cpp:33-34` (the M-codes allowed while halted), `USBSerial.cpp:328-333` (USB attach), `src/libs/Network/uip/telnetd/shell.cpp:236` (network greeting).
- Regression tests: `smoothie-simulator.test.ts`.

**Sources.**

- [Smoothieware USBSerial.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/USBDevice/USBSerial/USBSerial.cpp#L302-L314): "puts("HALTED, M999 or $X to exit HALT state\r\n");"
- [Smoothieware GcodeDispatch.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/communication/GcodeDispatch.cpp#L33-L34): "// goes in Flash, list of Mxxx codes that are allowed when in Halted state"

## Ruida .rd export

The `.rd` file KerfDesk exports for Ruida CO2 controllers, checked command by command against meerk40t's writer and parser, and the Ruida profile's Connect and export checks.

### RU-1: Layers in the .rd file never set their own speed or power, so meerk40t reads every layer at the last layer's speed

**High** · New · Reproduced (plausible on real hardware)

KerfDesk put each layer's speed and power only in the file's header table (`C9 04`, `C6 31`, `C6 32`). Each layer's own section held just a layer select (`CA 02 n`) and its moves. meerk40t writes the header table too, but after each `CA 02` it also sets the speed and power that layer's cuts use (`C9 02`, `C6 01`, `C6 02`, `C6 21`, `C6 22`).

In meerk40t's parser the header commands only store values; only `C6 01` and `C6 02` set the power a cut runs at. A two-layer job, 50 mm/s at 20 % then 5 mm/s at 80 %, decodes as both layers at 5 mm/s with no power set. No public source says what a Ruida controller does with such a file; if it reads it as meerk40t does, every layer runs at the last layer's speed. The repository's test decoder knew only the header forms, so the round-trip tests could not see the gap.

**Fix.** Every layer now writes meerk40t's settings block after `CA 02 p`: `CA 01 10`, air on or off, `C9 02` speed, `C6 12`/`C6 13` delays of 0, `C6 01`/`C6 02`/`C6 21`/`C6 22` power, then `CA 03 01`. The header table stays. meerk40t's unmodified parser reads the new file with no unknown command and the right speed and power (`1e41e08`, ADR-394).

**Evidence.**

- `rd-encoder.ts:90-95` writes the header table for every layer; `:96-103` writes each layer as `selectLayer` plus its segments. `rd-commands.ts` has no `C9 02`, `C6 01` or `C6 02` builder.
- The test decoder understood only `C9 04` and `C6 31`/`C6 32` (`ruida-decoder.ts:66-70,86`).
- meerk40t `write_settings` (`rdjob.py:1517-1548`) writes `layer_number_part`, `speed_laser_1`, `min_power_1`, `max_power_1`, `min_power_2`, `max_power_2` and `en_laser_tube_start(1)` for each layer. Its parser sets the cut power only for `C6 01`/`C6 02` (`:853-865`); `C6 31`/`C6 32` store part values (`:904-911`).
- meerk40t's own `RDJob.process`, re-run for this report on the audit's byte dumps (`tracks/RU-oracle/`): KerfDesk's two-layer file plots both layers with `{'speed': 5.0, 'power': None}`; meerk40t's encoding of the same job plots 50 mm/s at power 200 and 5 mm/s at 800 (of 1000).
- Reproduction: `ruida-rd-layer-settings.test.ts` failed.
- Regression tests: `rd-encoder.test.ts`, `rd-encoder-golden.test.ts`.

**Sources.**

- [meerk40t rdjob.py](https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/rdjob.py#L1517-L1548): "self.speed_laser_1(speed)"
- [meerk40t rdjob.py](https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/rdjob.py#L853-L865): "self.power = power * 10  # 1000 / 100"

### RU-2: Every .rd file declared the Current Position reference point, whatever placement the export used

**High** · New · Reproduced (plausible on real hardware)

Every file began with `D8 12`, which the code called a "start-of-stream marker". meerk40t names it "Ref Point Mode 0, Current Position". So an Absolute export, whose coordinates count from machine zero, told the controller to place the job wherever the head stood. The generic Ruida profile has homing off, so its default placement is User Origin, and that file said Current Position too. No file carried Start Process (`D8 00`).

meerk40t, whose Ruida code was tested on an RDC6442S, starts every file with `D8 10` (Machine Zero/Absolute), Set Absolute, Ref Point Set, `F1 02 00` and Start Process. No public source says how a controller applies each mode.

**Fix.** The first command now follows the export placement: no placement or Absolute writes `D8 10`, User Origin and Verified Origin write `D8 11` (the anchor point set on the controller), and Current Position writes `D8 12`. meerk40t's preamble follows, with Start Process. The User Origin mapping is a decision, not a sourced fact, and the ADR says so (`1e41e08`, ADR-394).

**Evidence.**

- `rd-commands.ts:82-85`: `streamStart()`, "start-of-stream marker (upload begin)", returns `[0xd8, 0x12]`; `rd-encoder.ts:88` writes it first in every file.
- `job-placement.ts:28-39`: a profile with homing off defaults to User Origin. The generic Ruida profile keeps the default `homing: { enabled: false … }` (`device-profile.ts:365`, `profile-catalog.ts:142-154`).
- meerk40t `rdjob.py:135-137` names the three modes; `write_header` (`:1409-1414`) writes `ref_point_2()`, `set_absolute()`, `ref_point_set()`, `enable_block_cutting(0)` and `start_process()` (`D8 00`, `:131`).
- meerk40t's parser decodes KerfDesk's Absolute export as `d812 (Ref Point Mode 0, Current Position)` (oracle re-run).
- Reproduction: `ruida-rd-reference-mode.test.ts` failed.
- Regression tests: `rd-encoder.test.ts`, `emit-rd.test.ts`, `output-preparation-rd.test.ts`.

**Sources.**

- [meerk40t rdjob.py](https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/rdjob.py#L135-L137): `REF_POINT_0 = b"\xD8\x12"  # CURRENT_POSITION`
- [meerk40t ruida README](https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/README.md#L6-L7): "The latest revision has been tested on Fedora Linux using a Ruida RDC6442S controller and a monport MP-570 CO2 laser."

### RU-7: The .rd export skipped Save G-code's checks, so no-go zones and bed limits were never checked for a Ruida job

**Medium** · New · Reproduced

A Ruida profile has no Frame and no Start: the `.rd` export is its only output. Save G-code runs a check over the finished program for bed bounds, No-go zones and laser-on travel. The `.rd` export skipped it, as its own comment said. The generic Ruida profile offers No-go zones, and Machine Setup promises that enabled zones "warn in the Start-time Job Review after a clean Frame and after a successful G-code save". A Ruida job that crossed a clamp zone or ran off the bed was exported without a word.

The `.rd` format has no keep-out command; its header carries only the job's bounds. The check in KerfDesk is the only protection.

**Fix.** The export now runs the same check over the moves the file commands: each travel as `G0 X Y S0` and each cut as `G1 X Y S<power>`, in the frame Save G-code would use, with the rotary wrap limit. "Line N:" becomes "Layer <id>:". Every finding is a warning; the export is never refused. A Ruida profile has no homing evidence, so an enabled zone gets "No-go zones cannot be checked from this hand-set origin…" instead of silence (`0db7769`, ADR-394).

**Evidence.**

- `emit-rd.ts:19-22`: "The .rd path runs no post-compile preflight, so this is the ONLY channel…". `runPreflight` (`preflight.ts:119`, zones at `:155`) has one caller, the G-code emitter (`emit-gcode.ts:263`).
- The Ruida profile has the `'no-go-zones'` capability (`profile-catalog.ts:154`); the promise is `MachineSetupSafetyZones.tsx:35-36`.
- meerk40t's `write_header` writes the job's corners (`rdjob.py:1417-1422`) and nothing about areas to avoid; its Ruida code has no keep-out command.
- Reproduction: `ruida-rd-no-go-zones.test.ts`: the G-code control reported the zone, the `.rd` export did not.
- Regression tests: `rd-preflight.test.ts`, `save-rd-action.test.ts`, `output-preparation-rd.test.ts`.

**Sources.**

- [meerk40t rdjob.py](https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/rdjob.py#L1417-L1422): "self.process_top_left(max_x, min_y)"

### RU-3: Every .rd file ended with an unpaired Array End instead of meerk40t's block and layer ends

**Medium** · New · Reproduced (plausible on real hardware)

Every file ended `EB D7`. The code called `EB` "end of block / flush", but meerk40t reads it as Array End, the partner of an Array Start (`EA`) that KerfDesk never wrote. The real Block End (`E7 00`) and End Layer (`CA 01 00`) were missing. So were the per-layer header records meerk40t writes (`CA 41`, `E7 52`, `E7 53`, `E7 61`, `E7 62`) and `CA 22`. No public source says how a controller reacts to an unpaired Array End.

**Fix.** Each layer now ends `E7 00`, `CA 01 00`, `CA 01 30`, as meerk40t's `write_layer_end` does. The file ends with the file sum (`E5 05`) and `D7`, and the header writes meerk40t's array records after `EA 00`. No `EB` is written, as in meerk40t (`1e41e08`, ADR-394).

**Evidence.**

- `rd-commands.ts:87-90`: `blockEnd()` returns `[0xeb]`, "end of block / flush"; `rd-encoder.ts:104-105` ends every file with it and `D7`.
- meerk40t `rdjob.py:175` (`BLOCK_END`, `E7 00`), `:205-206` (`ARRAY_START`, `EA`; `ARRAY_END`, `EB`), `:102` (`LAYER_END`, `CA 01 00`). `write_header` opens the array (`:1496`); `write_layer_end` (`:1511-1515`) and `write_tail` (`:1550-1554`) close each layer and the file.
- meerk40t's parser reads KerfDesk's file end as `eb (Array End)`, `d7 (End Of File)`; its own file ends `e700 (Block End)`, `ca0100 (End Layer)`, `ca0130`, `e505… (Set File Sum …)`, `d7` (oracle re-run).
- Reproduction: `ruida-rd-block-structure.test.ts` failed.
- Regression tests: `rd-encoder.test.ts`.

**Sources.**

- [meerk40t rdjob.py](https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/rdjob.py#L205-L206): `ARRAY_END = b"\xEB"`
- [meerk40t rdjob.py](https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/rdjob.py#L1511-L1515): "# End layer and cut information."

### RU-5: A layer's Air assist setting never reached the .rd file

**Medium** · New · Reproduced (plausible on real hardware)

The encoder never read a layer's Air assist. The same job exported with air on and with air off gave identical bytes, so the controller ran it with whatever air state it already had. meerk40t writes Air Assist On (`CA 01 13`) or Off (`CA 01 12`) in each layer's settings. The operator's choice never reached the controller.

**Fix.** Each layer now writes `CA 01 13` or `CA 01 12` from its Air assist setting. Air off is written explicitly, unlike meerk40t, so one layer's air cannot carry into the next (`1e41e08`, ADR-394).

**Evidence.**

- Every cut group carries `airAssist` (`job.ts:67`); nothing in `rd-encoder.ts` or `rd-commands.ts` reads it.
- meerk40t `rdjob.py:111-112` (`AIR_ASSIST_OFF`, `CA 01 12`; `AIR_ASSIST_ON`, `CA 01 13`); `write_settings` writes one of them per layer when the layer has an air setting (`:1533-1536`).
- Reproduction: `ruida-rd-air-assist.test.ts` failed: air on and air off exported the same bytes.
- Regression tests: `rd-encoder.test.ts`, `rd-encoder-golden.test.ts`.

**Sources.**

- [meerk40t rdjob.py](https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/rdjob.py#L1533-L1536): "self.air_assist_on()"

### RU-6: The Laser menu's Connect opened a serial port for the file-only Ruida profile

**Medium** · New · Reproduced

ADR-097 says the file-only profile "disables Connect and all live controls". The connection bar did, but the Laser menu's Connect and the command palette were enabled whenever the browser supports serial. They asked for a port and opened it with the Ruida driver, which has no serial protocol. KerfDesk showed the machine as connected, then reported "No controller response". The connection bar stays disabled for file-only profiles, so only the menu could disconnect. No bytes were written, and Frame and Start stayed unavailable.

A Ruida controller takes swizzled binary commands, not text lines, so a GRBL-style serial session with it can never qualify.

**Fix.** The Connect action now refuses a file-only driver before the port picker: "This machine profile exports .rd files only; it has no live connection." Menu and palette Connect are disabled with the same text. This refuses a transport that does not exist; it is not a new gate (`405aafb`, ADR-394).

**Evidence.**

- `laser-command-family.ts:11-20` enables Connect on `ctx.serialSupported && !ctx.connected`; `use-app-commands.ts:194` takes `serialSupported` from the platform alone, and `:282-283` calls `laser.connect`.
- `laser-connect-action.ts:67-89` selects the driver, requests a port, opens it and attaches the connection with no transport check, although the Ruida driver declares `transport: 'file-only'` (`ruida/driver.ts:17`). The connection bar is disabled for file-only profiles (`ControllerConnectionControls.tsx:67-71`).
- ADR-097 decision 3 (`DECISIONS.md:4171`).
- meerk40t swizzles every byte it sends a Ruida and adds a checksum for UDP (`ruidasession.py:197-202`, `rdjob.py:434-440`).
- Reproduction: `ruida-file-only-connect.test.ts` failed (`requestPort` called once).
- Regression tests: `laser-connect-file-only.test.ts`, `laser-command-family.test.ts`, `connect-options.test.ts`.

**Sources.**

- [meerk40t ruidasession.py](https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/ruidasession.py#L197-L202): `return struct.pack(">H", sum(_data) & 0xFFFF) + _data`

### RU-4: Every closed contour in the .rd file ended with a cut that does not move

**Low** · New · Reproduced (plausible on real hardware)

A closed segment's outline already ends on its first point. The encoder added one more cut back to that point, so every closed contour ended with a cut of zero length. The G-code path never writes such a stationary burn. If a controller fires the laser for it, the seam gets a dot; no source says whether a Ruida does.

**Fix.** A travel or cut to the head's own position is now skipped, as meerk40t's `jump` and `mark` skip a zero move. A job whose every segment collapses to a point is refused as empty instead of producing zero-length cuts (`1e41e08`, ADR-394).

**Evidence.**

- `rd-encoder.ts:159`: `if (closed) push(cutAbsolute(mmToUm(first.x), mmToUm(first.y)));`, while `job.ts:35-36` says "For a closed segment, the last point equals the first by construction."
- The G-code emitter skips a burn to the head's own position (`grbl-strategy.ts:139-142`).
- meerk40t `mark` returns on a zero move (`rdjob.py:1577-1580`), and `jump` does after the first move (`:1563-1565`).
- Reproduction: `ruida-rd-stationary-cut.test.ts` failed.
- Regression tests: `rd-encoder.test.ts`.

**Sources.**

- [meerk40t rdjob.py](https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/rdjob.py#L1577-L1580): "# We are not moving."

### RU-8: The unused Ruida UDP session split commands across datagrams and waited forever for a lost reply

**Low** · New · Traced

Nothing outside tests creates a Ruida UDP session yet, so no one was affected. The session cut the job every 1470 bytes wherever that fell, so one command could straddle two datagrams. It also had no timeout: a lost reply left it waiting for an ACK forever. meerk40t sends whole commands, starting a new chunk once about 1000 bytes are queued, and gives up with a communication failure when no reply comes.

**Fix.** Fixed before any socket is wired. Datagrams are cut only between commands, at most 1470 bytes; a command longer than one datagram fails the session. No ACK or NAK within 1 s fails it without a resend, because UDP carries no sequence number and a resend after a lost ACK would run the same commands twice. The host reply port 40200 is named beside the controller's 50200, as in meerk40t (`ae0696e`, ADR-394).

**Evidence.**

- `ruida-udp-session.ts:19,58-60` slices the job every `MAX_PAYLOAD_BYTES` (1470). Only a reply (`onRuidaResponse`, `:81-106`) moves a session out of `awaiting-ack`; `stepRuidaSession` sends nothing while it waits (`:71-76`).
- The session is only re-exported (`ruida/index.ts:19-22`); no other code calls it.
- meerk40t `controller.py:83-94` chunks at command boundaries; `ruidasession.py:352-369` ends the ACK wait after its tries ("Comms failure"); `udp_transport.py:16-18` fixes send port 50200 and listen port 40200.
- Regression tests: `ruida-udp-session.test.ts`.

**Sources.**

- [meerk40t ruidasession.py](https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/ruidasession.py#L352-L369): "Handle a receive timeout. This may be the result of a loss of sync or the controller is no longer responding."
- [meerk40t udp_transport.py](https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/udp_transport.py#L16-L18): "These are defined by the Ruida controller and NOT configurable."

## Output, profiles and recovery

What the laser G-code dialects send, what the machine profiles assume, and where a restart picks up after a stop.

### OR-1: Constant-power (M3) output stopped the head with the beam still lit, so pass seams got burn dots

**High** · New · Reproduced and traced

Under M3 the beam keeps its programmed power whether the head moves or not. Several lines KerfDesk wrote right after an M3 burn make the controller finish every queued move first: the `M3 S0` re-arm between passes, an air change (`M8`, `M9`), a power-mode change (`M5` then `M4 S0`, or an image layer's opening `M5`), a laser-off seek to where the head already was, and a zero-length raster row close. The head stops at the end of the burn with the beam at full power.

On stock GRBL 1.1h the stepper routine then holds for the `$1` idle-lock time, 25 ms by default, before the next line can switch the beam off: a burn dot at every pass seam of a multi-pass cut. After an air change the beam stays lit until the next move starts. Where an air on-delay is set (grblHAL `$673`, 0.5 to 20 s; FluidNC `coolant/delay_ms`, up to 10 s), that includes the whole delay: burn-through and a fire risk. The Neotronics 4040 profile cuts in M3 by default, and GRBL Compatible uses M3 for everything. The default M4 output goes dark whenever the head stops.

**Fix.** No re-arm between the passes of one group, since the power word cannot change there. Under M3 a laser-off seek to the current position is not written. After an M3 burn, a group's mode and air changes wait until after its first laser-off seek; where the next group starts exactly where the last burn ended, a 1 mm laser-off move along its first edge and back takes the stop dark. M3 raster writes no zero-length row close. The job end (`M9`/`M5` after the last burn) is inherent to M3 and unchanged. This changes the 4040's qualified bytes, which the ADR records (`308a24c`, test `09edd64`, ADR-398).

**Evidence.**

- Re-arm every pass: `grbl-strategy.ts:195`. A seek with no head check (`:172`), where the burn loop has one (`:142`). Mode and air changes straight after the last burn: `:477-491`. The image layer's opening `M5`: `emit-raster.ts:113-116`. The zero-length row close at overscan 0: `emit-raster.ts:301-307,338-340`.
- M3 users: `gcode-dialects.ts:145` (Neotronics 4040 Safe cuts `'constant'`), `:115-117` (GRBL Compatible cut, fill and raster `'constant'`).
- GRBL 1.1h waits for an empty planner on an S or spindle change (`gcode.c:917-923,946`; `spindle_control.c:280`), on an air change (`gcode.c:955`; `coolant_control.c:124`) and on a zero-length move in M3 laser mode (`motion_control.c:68-74`). At an empty buffer it dwells `$1` ms (`stepper.c:259-262`; default 25, `defaults.h:49`) and turns the PWM off only for M4 blocks (`stepper.c:394-397`).
- grblHAL adds the air on-delay after the sync (`coolant_control.c:49-50,62`; `$673` is 0.5 to 20 s, `settings.c:2505`). FluidNC v4.0.3 does the same (`CoolantControl.cpp:78-79`; `delay_ms` 0 to 10000, `:90`).
- Reproduction: `m3-lit-planner-drain.test.ts` failed 5 of 5, e.g. `line 13 "M3 S0" drains with M3 S800 lit` (4040, two passes) and `line 16 "M5" drains with M3 S800 lit` (constant cut, then an image layer).
- Regression tests: `grbl-strategy-m3-lit-drain.test.ts`, `emit-gcode-m3-lit-drain.test.ts`.

**Sources.**

- [GRBL wiki: Laser Mode](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Laser-Mode): "Constant laser power mode simply keeps the laser power as programmed, regardless if the machine is moving, accelerating, or stopped."
- [GRBL wiki: Laser Mode](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Laser-Mode): "When using `M3` constant laser power mode, try to avoid force-sync conditions during a job whenever possible."
- [gnea/grbl stepper.c](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/stepper.c#L392-L398): "if (st.exec_block->is_pwm_rate_adjusted) { spindle_set_speed(SPINDLE_PWM_OFF_VALUE); }"
- [grblHAL coolant_control.c](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/coolant_control.c#L45-L53): "delay_sec((float)settings.coolant.on_delay / 1000.0f, DelayMode_Dwell);"

### OR-2: CNC job recovery marked passes as proven complete that may never have run, on controllers with a large planner

**Medium** · New · Reproduced

A controller answers `ok` when a line is queued, not when it has moved. After a stop, CNC job recovery took a fixed reserve off the acknowledged lines (256 on grblHAL, 64 on FluidNC) and ticked every pass before that point as proven complete. grblHAL's planner can hold up to 1000 blocks (`$398`) and FluidNC's up to 120 (`planner_blocks`), so with a larger planner those passes may never have run. The dialog preselected the next pass as the "computed safe boundary", and its warning said acknowledgements "prove execution up to" that pass.

Starting there plunges a deeper pass into stock the skipped passes never cleared. The reserve's own comment calls the operator's "everything before the boundary is complete" confirmation the load-bearing check, but the checklist has no such item. The planner size KerfDesk had measured (idle `Bf`, `$I`) was not used.

**Fix.** A pass counts as proven only below the rewind bound. With no recorded planner size the bound is the firmware maximum plus its segment buffer: 1010 lines on grblHAL, 140 on FluidNC, 32 on stock GRBL. A run now records its idle `Bf` planner size; with it, or a same-session `$I`, the bound follows the measured planner (`29fb8a7`, ADR-398).

**Evidence.**

- `cnc-resume-point.ts:38-45` (`grblhal: 256`, `fluidnc: 64`), `:82-83` (`proven = Math.max(0, acked - reserve, …)`), `:93` (every pass before that counts as proven); the comment at `:34-36`.
- `cnc-pass-recovery-model.ts:151` marks them `'proven-complete'`, shown with a tick (`CncPassRecoveryWizard.tsx:219`); the warning is `cnc-pass-recovery-review.ts:103`. The checklist (`CncPassRecoveryChecklist.tsx:22-41`) has no completeness item, and `cncPassRecoveryDefaultPoint` passes no planner evidence (`cnc-pass-recovery-model.ts:46-59`).
- grblHAL "Planner buffer blocks" takes 30 to 1000 (`settings.c:2485`; `$398`, `settings.h:273`). FluidNC v4.0.3 `planner_blocks` takes 10 to 120 (`Machine/MachineConfig.cpp:89`). GRBL answers once the line is in the planner (`motion_control.c:60-68`, `protocol.c:104`).
- Reproduction: `cnc-resume-planner-reserve.test.ts` failed: with 400 grblHAL blocks passes 3, 4 and 5 were marked proven; with 120 FluidNC blocks, pass 10.
- Regression tests: `cnc-resume-point-planner-reserve.test.ts`, `cnc-pass-recovery-model.test.ts`.

**Sources.**

- [grblHAL settings.c](https://github.com/grblHAL/core/blob/d7aaee3d84b1e7010f075d395206afff038d7379/settings.c#L2485): `{ Setting_PlannerBlocks, Group_General, "Planner buffer blocks", NULL, Format_Int16, "####0", "30", "1000",`
- [FluidNC MachineConfig.cpp](https://github.com/bdring/FluidNC/blob/25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f/FluidNC/src/Machine/MachineConfig.cpp#L89): `handler.item("planner_blocks", _planner_blocks, 10, 120);`

### OR-3: The automatic laser restart skipped moves a stop had thrown away when no status report showed the backlog

**Medium** · Incomplete fix of ADR-362 · Reproduced

Abort, the automatic stop after a rejected line, and a reboot all empty the controller's planner, including moves it had already acknowledged. ADR-362 stepped the automatic restart back by the backlog a status report showed in its `Bf:` field. Stock GRBL 1.1h and stock FluidNC do not report `Bf` (`$10=1`), and Smoothieware never does, so there the restart kept the acknowledged count. It skipped up to 15 moves on GRBL or FluidNC, and up to about 32 on Smoothieware, whose Abort (`^X`) flushes a 32-block queue. A last report that happened to show an empty planner was also read as "no backlog", so every move acknowledged after it was skipped.

The skipped moves never burned, and Review interrupted laser job only said acknowledged progress "can be ahead of the physical cut".

**Fix.** A stop with no report of its backlog now steps back over the controller's whole planner: `$I` or the idle `Bf` when seen, else 15 blocks on GRBL, 100 on grblHAL, 15 on FluidNC and 32 on Smoothieware. Marlin reports no planner either, and since MA-7 its Abort sends `M410`, which drops the planner, so it steps back 15 blocks too. A report that showed an empty planner is a frontier: the restart begins at the first move acknowledged after it. The hint names the bound it used. A restart may burn up to a planner's worth of moves twice; that is preferred to skipping moves that never ran (`29fb8a7`, test `9d725d8`, Marlin `d038b10`, ADR-398).

**Evidence.**

- No idle `Bf`, no snapshot (`laser-rx-capacity-evidence.ts:144-145,165-166`); an empty-planner report counts as no backlog (`checkpoint-interruption.ts:62`); no backlog, no step back (`automatic-restart-line.ts:75-76`). The hint: `laser-recovery-automatic-restart.ts:27`.
- Smoothieware's Abort writes `^X` (`smoothieware/driver.ts:59`, `laser-job-actions.ts:309`).
- GRBL: `$10` defaults to 1 (`defaults.h:50`) and `Bf` is printed only with the buffer bit (`report.c:532-533`); 16 planner blocks, 15 usable (`planner.h:31`, `planner.c:500`), cleared by a reset (`main.c:94`). FluidNC: `$10` defaults to 1 (`SettingsDefinitions.cpp:101`; `Report.cpp:512-513`) and `planner_blocks` to 16 (`Machine/MachineConfig.h:98`). Smoothieware: a 32-block queue (`Conveyor.cpp:77`) flushed on halt (`:89-93`); `^X` halts (`USBSerial.cpp:204-206,304-306`). Marlin: 16 planner blocks, one kept free (`Configuration_adv.h:2393-2399`, `planner.h:765`), all dropped by `M410` (`planner.cpp:1688-1689`).
- Reproduction: `abort-restart-without-bf.test.ts` failed 3 of 3: stock GRBL with no `Bf` restarted at line 36, expected 21 or earlier; an empty-planner report at 20 acknowledged lines, then Abort at 35, restarted at 36; Smoothieware restarted at 43, expected 11 or earlier.
- Regression tests: `planner-backlog-restart.test.ts`, `checkpoint-interruption-planner-size.test.ts`, `laser-planner-capacity-recovery.test.ts`, `recovery-deep-audit.stress.test.tsx`.

**Sources.**

- [GRBL wiki: Configuration](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Configuration): "For example, the default report with machine position and no buffer data reports setting is `$10=1`."
- [Smoothieware Conveyor.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Conveyor.cpp#L89-L96): "// marks queue to be flushed next time get_next_block() is called"

### OR-4: The xTool D1 Pro profiles jog and Frame with $J=, which xTool's own device file turns off

**Medium** · New · Traced (plausible on real hardware)

xTool's LightBurn device file for the D1 Pro sets `"EnableGrblJCommand": false`, and KerfDesk's profile note repeated it ("disables $J jogging; confirm jogging on your firmware"). But the profiles used the plain GRBL driver, whose Jog and Frame are built from `$J=` lines. If the closed xTool firmware rejects `$J=`, no Frame can finish, so Start never unlocks, and Jog fails too. Nothing moves. The Falcon profile honours the same vendor setting with relative `G1` jogs and a `G1` Frame.

Whether the firmware accepts `$J=` is not public, and xTool's and LightBurn's sites were blocked from this audit.

**Fix.** Decided: keep `$J=` Jog and Frame, since nothing public settles the firmware's behaviour. The D1 Pro evidence note, shown under Profile details, now states `EnableGrblJCommand: false` and that a Jog or Frame error on this firmware means it does not accept `$J=` jogging. One hardware check would settle it (`8e16be3`, ADR-398).

**Evidence.**

- `brand-laser-profiles.ts:65-69` records the vendor file and its `"EnableGrblJCommand": false`; the note is `:83`. The profile sets no command set, so `select-controller-driver.ts:26-29` returns `grblDriver`, whose Jog and Frame builders write `$J=` (`grbl/driver.ts:85-86`).
- The Falcon contract swaps both for the same vendor field (`falcon-command-contract.ts:5-8,16,34-35`).
- A community copy of the D1 Pro device file has `"EnableGrblJCommand": false,` at line 74 (re-fetched for this report, sha256 `22cf5a7c…`). It is a derivative, so it repeats xTool's setting rather than proving firmware behaviour. xTool's own file was read by the first OR session and could not be fetched again.
- Reproduction: traced only.
- Regression tests: `brand-laser-profiles.test.ts`.

**Sources.**

- [xTool-Connect xTool-D1-Pro.lbdev](https://github.com/1RandomDev/xTool-Connect/blob/940df33985b3336472b74fec152976538793aaf5/xTool-D1-Pro.lbdev#L74): `"EnableGrblJCommand": false,`

### OR-5: Import LightBurn .lbdev rejected real device files, which are JSON, as missing a bed size

**Low** · New · Reproduced

Machine Setup's Import LightBurn .lbdev looked only for XML tags, some of them invented (`<SMax>`, `<Origin>`). Real LightBurn device files are JSON: `{"DeviceList": [{ … "Width": 430, "Height": 400, "MirrorY": true, "Settings": {"S_Scale": 1000, "BaudRate": 230400, …}}]}`. xTool's D1 Pro file and Creality's Falcon file both failed with "missing bed width or height". The import failed closed, with the wrong reason, and its tests used an invented XML sample.

**Fix.** The importer now reads the JSON form. The first `DeviceList` entry maps Width and Height to the bed, `S_Scale` to Max S, `BaudRate` to the baud rate, MirrorX/MirrorY to the origin corner and `AirAssistM7` to the air command. Anything else, including `EnableGrblJCommand: false`, is listed for review. The XML path and the review step are unchanged (`5b27d27`, ADR-398).

**Evidence.**

- `lbdev-import.ts:74-81` returns `'missing bed width or height'` when no XML tag matches; `:228` is the XML-only pattern. The test sample is invented XML (`lbdev-import.test.ts:4-16`). The button is wired at `MachineSetupImportExport.tsx:70-79`.
- Real files: the community D1 Pro file (`"DeviceList"` at line 2, `"Height": 400` at 13, `"Width": 430` at 143), and Creality's Falcon bundle as recorded in the repository (`falcon-vendor-configuration.json:9-16`: `"Width": 358`, `"Height": 268`, `"S_Scale": 1000`).
- Reproduction: `lbdev-json-import.test.ts` failed (`expected 'invalid' to be 'review'`).
- Regression tests: `lbdev-import.test.ts`.

**Sources.**

- [xTool-Connect xTool-D1-Pro.lbdev](https://github.com/1RandomDev/xTool-Connect/blob/940df33985b3336472b74fec152976538793aaf5/xTool-D1-Pro.lbdev#L1-L2): `"DeviceList": [`

### OR-6: On FluidNC, KerfDesk told the operator to set $32 and $30, which FluidNC does not let you write

**Low** · New · Traced

FluidNC's `$32` and `$30` are read-only views of its YAML config: `$32` is 1 only for a `Laser` spindle, and `$30` is the top of the spindle's `speed_map`. With a PWM spindle FluidNC reports `$32=0`, and Job Review said "Enable GRBL laser mode ($32=1) before starting from KerfDesk." That write fails. The job itself stops at the preamble's `M4 S0`, before any motion: FluidNC answers `error:20` to `M4` on a spindle that has no direction pin and is not a laser. The real remedies, a `Laser` spindle in the YAML or a constant-power dialect, were never named. The router texts ("Set $32=0 for spindle work", "Set $30=…") were just as unactionable there.

A comment also claimed Start "treats this reported contradiction as a refusal", while Start turns every readiness error into a Job Review warning.

**Fix.** On FluidNC the `$32` and `$30` findings now say to configure the spindle as `Laser` in the YAML config or choose GRBL Compatible (constant power), and to change `speed_map` or the machine profile, instead of writing a setting. GRBL and grblHAL wording is unchanged, and the comment is corrected (`cd336a5`, ADR-398).

**Evidence.**

- `controller-readiness.ts:231-236` (the laser `$32=0` text), `:178-183` and `:156-160` (the router `$32` and `$30` texts); the comment at `:121-122`, against `start-job-controller-policy.ts:26-30`.
- The default preamble ends `M4 S0` (`grbl-strategy.ts:86`). KerfDesk's own FluidNC driver notes that `$N=value` writes "are legacy-mapped or ignored by FluidNC" (`fluidnc/driver.ts:1-5`).
- FluidNC v4.0.3: `$32` and `$30` are `INT_PROXY` views of the spindle (`SettingsDefinitions.cpp:146,148`; `$30` is the last `speed_map` entry, `Spindles/Spindle.cpp:150-156`), and a proxy write returns `ReadOnlySetting` (`Settings.h:229`). `M4` needs a reversible or laser spindle, else `GcodeUnsupportedCommand` (`GCode.cpp:654-658`), error 20 (`Error.h:33`). A PWM spindle is reversible only with a direction pin (`Spindles/PWMSpindle.cpp:20`); a Laser always rate-adjusts (`Spindles/LaserSpindle.cpp:16-17`).
- Reproduction: traced only.
- Regression tests: `controller-readiness.test.ts`.

**Sources.**

- [FluidNC SettingsDefinitions.cpp](https://github.com/bdring/FluidNC/blob/25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f/FluidNC/src/SettingsDefinitions.cpp#L146-L148): `INT_PROXY("32", "Grbl/LaserMode", spindle->isRateAdjusted())`
- [FluidNC GCode.cpp](https://github.com/bdring/FluidNC/blob/25ae119b1fcb691dcbe1e6f9cbb7fbf3e74fd04f/FluidNC/src/GCode.cpp#L654-L659): "case 4:  // Supported if the spindle can be reversed or laser mode is on."

## CNC on other controllers

What a CNC project gets when the profile's controller is not GRBL, grblHAL or FluidNC.

### CN-1: CNC exports wrote a GRBL-only file for Marlin, Smoothieware and Ruida profiles without saying so

**Medium** · New · Reproduced

KerfDesk writes every CNC program in one dialect, for GRBL: `M3 S<rpm>` then `G4 P3.000` for a 3-second spin-up, and `M0` to pause for each tool change. The emitter ignores the profile's controller. On a Marlin or Smoothieware profile a CNC project cannot Frame or Start (CN-2), so the operator's route is Save G-code, a tiled Save or Save surfacing G-code, run from the board's SD card or another sender. Marlin reads `G4 P3.000` as 3 ms, so where M3 switches the router, the bit plunges before it is at speed. Smoothieware ignores `M0`, so the next section is cut with the previous bit; Marlin skips it too on builds without an LCD or `EMERGENCY_PARSER`.

None of these exports said the file was GRBL-only. The only controller text was the `$`-settings advisory, shown only while connected to a board without `$` settings; the "assumes GRBL" note was laser-only. On the Ruida profile a tiled Save wrote GRBL `.nc` tiles, also without a word (CN-3).

**Fix.** When the profile's controller cannot run KerfDesk CNC jobs, Save G-code of a CNC project, a tiled Save and Save surfacing G-code each show one warning. It says the file is written for a GRBL-family controller (`G4 P` in seconds, `M0` pauses for each tool change), names the profile's controller, says what a spin-up read as milliseconds or a skipped `M0` would do, and asks the operator to check the file before running it. It appears whether or not a controller is connected. Bytes, saves and routing are unchanged (`9fb2004`, ADR-399).

**Evidence.**

- One dialect: `emit-gcode.ts:140-151` ("CNC router projects always emit through the Z-aware GRBL strategy"); `cnc-grbl-strategy.ts:97-100` ignores the device (`_device: DeviceProfile`); `cnc-grbl-transitions.ts:92` (`M0`), `:124` (`M3 S…`), `:128` (`G4 P…`). Tiles use `cncGrblStrategy.emit` (`tile-emission.ts:62`); surfacing writes its own `M3` and `G4 P` (`surfacing.ts:125-127`).
- No warning: `handleSaveGcode` (`file-actions.ts:172-224`) has no `cncJobs` check, and none exists under `src/ui/app`. The only controller text before the picker is `controllerReadinessAdvisories` (`:235-241`); the "assumes GRBL" note is laser-only (`:302`). The tiled Save (`save-tiled-gcode.ts:87-95`) and surfacing (`save-surfacing-program.ts:54-61`) are the same. The Start text that says it (`start-job-readiness-policy.ts:20-28`) is never reached.
- Marlin 2.1.2.8 reads `G4 P` as whole milliseconds (`G4.cpp:33`, `parser.h:277,280`) and has `M0` only with `HAS_RESUME_CONTINUE` (`gcode.cpp:484-487`, `Conditionals_adv.h:882-883`). Smoothieware reads `P` as seconds only in `grbl_mode` (`Robot.cpp:500-511`), on by default only in the CNC build (`Kernel.cpp:113-117`), and its `M0` is commented out (`Robot.cpp:694-696`).
- Reproduction: `cnc-export-non-grbl-controller.test.ts` (Save on Marlin and Smoothieware) and `cnc-other-exports-non-grbl.test.ts` (tiled and surfacing Save on Marlin, tiled Save on Ruida) failed: no toast named the GRBL requirement.
- Regression tests: `cnc-export-controller-advisory.test.ts`, `cnc-export-controller-advisory-exports.test.ts`.

**Sources.**

- [Marlin G4.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/motion/G4.cpp#L33): "if (parser.seenval('P')) dwell_ms = parser.value_millis(); // milliseconds to wait"
- [Smoothieware Robot.cpp](https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/robot/Robot.cpp#L694-L696): "// case 0: // M0 feed hold, (M0.1 is release feed hold, except we are in feed hold)"

### CN-2: On Marlin or Smoothieware the CNC Frame had the operator zero Z, wrote G92 Z0, then refused for the wrong reason

**Low** · New · Reproduced and traced

A CNC project on a connected Marlin or Smoothieware board can never Frame: those drivers cannot build the safe-Z retract. But Frame job first selected G54, asked the operator to set Work Z zero and sent `G92 Z0`, and only then refused with "CNC Frame is unavailable because this controller cannot build the required safe-Z retract." Start stays grey until a clean Frame (ADR-372), so the Start text that names the real reason ("CNC jobs require a GRBL-family controller …") was never shown. The operator was sent to zero Z for a Frame that could not be built, and never told that KerfDesk CNC needs a GRBL-family controller.

The Laser/CNC toggle warns only when the profile's capability label excludes CNC, so an unlabelled or imported Marlin profile got no word at all.

**Fix.** Frame now checks the connected driver's `cncJobs` capability right after the controller-queue check, before it selects G54 or asks for Work Z zero, and the CNC Frame plan checks it first too. Both refuse with "CNC Frame is unavailable: KerfDesk CNC jobs require a GRBL-family controller (GRBL, grblHAL, FluidNC), and the connected controller cannot run them. Connect a GRBL-family controller, or switch the project to Laser mode." It is the same refusal, earlier and in the right words, not a new gate, and it no longer writes `G92 Z0` (`29fdbfa`). The Laser/CNC toggle now gives the same reason whenever the profile's controller cannot run KerfDesk CNC jobs, whatever its capability label says, and Machine Setup's controller list marks those controllers "— laser only" when the setup includes CNC (`50969b0`, ADR-399).

**Evidence.**

- `use-frame-action.ts:192-212`: queue check, G54 normalization, the absolute-offset wait, then `prepareFrameLaser`, which asks for Work Z zero and awaits `laser.zeroZHere()` (`:368-378`); that writes `G92 Z0` (`grbl/commands.ts:87`, `origin-actions.ts:68`).
- `cnc-frame-lines.ts:51-59` checks Work Z evidence and position before `buildRetract === undefined` returns the retract message (`:27-28`). Marlin and Smoothieware define no `buildFrameRetract` and set `cncJobs: false` (`marlin/driver.ts:49`, `smoothieware/driver.ts:46`). The plan is built in `laser-frame-motion-plan.ts:43-60` and thrown at `laser-jog-actions.ts:187-190`.
- Start is disabled until a clean Frame (`JobActionControls.tsx:106-112`); the GRBL-family reason lives only on the Start path (`start-job-readiness-policy.ts:20-28`, `laser-start-program-assertions.ts:74-82`).
- The toggle checks only the label (`MachineModeToggle.tsx:18`; text `machine-capability-messages.ts:5`).
- The refusal itself is right: Marlin reads `G4 P` as milliseconds (`G4.cpp:33`) and Smoothieware has no `M0` (`Robot.cpp:694-696`), so a GRBL CNC program is unsafe there.
- Reproduction: `cnc-frame-non-grbl-reason.test.ts` failed 2 of 6: the Work Z prompt came first, and the retract message came instead of the GRBL-family reason.
- Regression tests: `use-frame-action.cnc-controller.test.ts`, `cnc-frame-lines.test.ts`, `MachineModeToggle.hybrid.test.tsx`, `DeviceSetupWizard.cnc.test.tsx`.

**Sources.**

- [Marlin G4.cpp](https://github.com/MarlinFirmware/Marlin/blob/1cd56c4ccd483045eb5a92c99e3ad3b5ab1bea6d/Marlin/src/gcode/motion/G4.cpp#L28-L34): "G4: Dwell S<seconds> or P<milliseconds>"

### CN-3: A CNC project on the Ruida profile was refused as a Fill/Image raster layer, and a tiled Save wrote GRBL tiles

**Low** · New · Reproduced

A CNC project can sit on the generic Ruida profile through the Laser/CNC toggle. Save G-code then said: "Layer L1 uses Fill/Image raster output, which the experimental .rd encoder does not support yet. Use Line mode layers for Ruida export." A CNC layer has no Line mode; the real reason is that a router job cannot be a Ruida laser file. With tiling on, the same Save never reached the `.rd` route and wrote GRBL `.nc` tiles for a controller that runs `.rd` files, with no word.

**Fix.** An untiled CNC Save on the Ruida profile now says: "A CNC router job cannot be exported as a Ruida .rd laser file. Switch the project to Laser mode, or choose a GRBL-family machine profile for router jobs." (`ff6d06f`). A tiled Save still writes GRBL tiles, now with the CN-1 warning: refusing would take a working file from an operator whose tile cutter runs GRBL (`9fb2004`, ADR-399).

**Evidence.**

- `rd-encoder.ts:69-70` refuses any group whose kind is not `'cut'` as `raster-unsupported`, which catches `kind: 'cnc'` groups (`job.ts:239`); `emit-rd.ts:57-58` is the raster text.
- `file-actions.ts:176-196` (the tiled route) runs before the file-only route at `:212-222`.
- The refusal is factual: the `.rd` layer model is laser speed and power (meerk40t `write_settings`, `rdjob.py:1517-1548`), meerk40t's Ruida code has no spindle, router or RPM concept (grep of `meerk40t/ruida/*.py`), and its reference machine is a CO2 laser (`ruida/README.md:6-7`).
- Reproduction: `cnc-ruida-save-reason.test.ts` failed (the raster message); `cnc-other-exports-non-grbl.test.ts` showed the tiled `.nc` write with no advisory.
- Regression tests: `emit-rd-cnc-refusal.test.ts`, `cnc-export-controller-advisory-exports.test.ts`.

**Sources.**

- [meerk40t ruida README](https://github.com/meerk40t/meerk40t/blob/7e82652f75dcab39413492e60ed5b60e5c0ad7b6/meerk40t/ruida/README.md#L6-L7): "The latest revision has been tested on Fedora Linux using a Ruida RDC6442S controller and a monport MP-570 CO2 laser."

### CN-4: Machine Setup's Output dialect looked like it set CNC output, but it changes only laser output

**Low** · New · Reproduced and traced

In a CNC or hybrid Machine Setup, such as the Neotronics 4040 profile, Controller and connection settings shows Output dialect, titled "Choose the output syntax expected by the selected controller firmware." It lists laser dialects only: GRBL Dynamic, GRBL Compatible, GRBL Raster and Neotronics 4040 Safe, or Marlin Inline and Marlin Fan-mosfet on Marlin. A CNC user could reasonably think GRBL Compatible or Neotronics 4040 Safe shapes the router program. It does not: CNC output is byte-identical for every choice.

**Fix.** When the setup includes CNC, the row is labelled "Laser output dialect" with the hint "CNC programs always use KerfDesk's GRBL CNC dialect." Laser-only setups are unchanged (`af5ff85`, test `9a587ed`, ADR-399).

**Evidence.**

- `DeviceSetupIdentifyStep.tsx:82` picks the laser dialect list, and the row is shown for every serial controller whatever the machine kind (`:108-128`, title `:112`).
- The dialect descriptions are laser terms (`gcode-dialects.ts:87,111,129,144`, e.g. "dynamic-power cuts, fill and raster sweeps").
- `cnc-grbl-strategy.ts:97-100` ignores the device, so the choice cannot reach CNC bytes.
- No firmware is involved; the defect is the label. GRBL, grblHAL and FluidNC all accept the one CNC dialect (see "CNC controllers").
- Reproduction: `cnc-output-dialect-ignored.test.ts` passed on the audited code, pinning that all four GRBL dialect choices give byte-identical CNC output.
- Regression tests: `emit-gcode-cnc-dialect-independence.test.ts`, `DeviceSetupWizard.cnc.test.tsx`.

## CNC controllers

Which controllers hobby CNC routers ship with, what KerfDesk can drive, and what its CNC file means on the rest. No machine here was hardware-tested; each row rests on the source it cites.

### Short answer

Hobby CNC routers ship with three kinds of controller.

1. **GRBL and its successors, grblHAL and FluidNC.** Most desktop routers: Genmitsu (SainSmart), Sienci LongMill and AltMill, Carbide 3D Shapeoko and Nomad, Inventables X-Carve and Carvey, OpenBuilds BlackBox, V1 Engineering's Jackpot board, FoxAlien and Two Trees. KerfDesk runs these live: Frame, Start, probing and tool-change pauses.
2. **3D-printer firmware.** Marlin (older V1 Engineering MPCNC and LowRider boards, Snapmaker), Smoothieware (Makera Carvera) and RepRapFirmware (Ooznest WorkBee on a Duet 2). KerfDesk connects to Marlin and Smoothieware boards only as lasers and refuses CNC jobs on them. It cannot connect to RepRapFirmware at all.
3. **PC or stand-alone controllers.** Mach3 and Mach4 (typical Chinese 6040s, older Avid), Centroid (Avid), UCCNC (Stepcraft), MASSO and Redline (Onefinity Elite), Buildbotics (original Onefinity) and DDCSV panels. KerfDesk cannot connect to any of them.

For groups 2 and 3 the only route is Save G-code, and the file is always written for GRBL. Two lines in it mean something else elsewhere:

- **The spin-up wait, `G4 P3.000`.** GRBL waits 3 seconds. Marlin, MASSO, UCCNC and RepRapFirmware wait 3 milliseconds, so the bit can plunge before the spindle is at speed.
- **The tool-change pause, `M0`.** Smoothieware and the Carvera ignore it, so the next section is cut with the wrong bit. RepRapFirmware ends the job.

Since the fixes, Save G-code, a tiled Save and Save surfacing G-code warn that the file is written for a GRBL-family controller whenever the profile's controller is Marlin, Smoothieware or Ruida, and a CNC Frame on Marlin or Smoothieware refuses first with that reason (ADR-399). KerfDesk cannot tell a PC or stand-alone controller from GRBL: its owner would pick a GRBL profile, so no warning appears, and only the file header's `; assumes: GRBL $30=…` line says what the file expects.

### What KerfDesk supports for CNC

| Controller | Live CNC jobs | What a CNC project gets |
|---|---|---|
| GRBL 1.1 (also the default when a profile names none) | Yes | Frame, Start, probing, `M0` tool-change pauses |
| grblHAL, FluidNC | Yes (GRBL's capabilities) | The same |
| Falcon A1 Pro command set | Flag inherited | A laser machine, with relative `G1` jog and Frame |
| Marlin, Smoothieware | No | Laser only. A CNC Frame refuses first with the GRBL-family reason, and every CNC export warns |
| Ruida (`.rd` export) | No | An untiled CNC Save is refused: "A CNC router job cannot be exported as a Ruida .rd laser file." A tiled Save writes GRBL tiles, with the warning |
| RepRapFirmware, Mach3/4, Centroid, UCCNC, MASSO, Redline, Buildbotics, DDCSV | No driver | Save G-code only, in the GRBL dialect |

- The flag is `capabilities.cncJobs`: true in the GRBL driver, which grblHAL, FluidNC and the Falcon wrapper inherit, and false in the Marlin, Smoothieware and Ruida drivers.
- There is one CNC dialect, and the emitter ignores the profile's controller. Every program, tile and surfacing file uses `;` comments, `G21 G90 G54 G94 G17`, G0 and G1, G2 and G3 with incremental I/J, `M3 S<rpm>` then `G4 P<seconds>`, `M5`, M7/M8/M9 only with coolant, and for a tool change a retract, `M5`, park and `M0`. No T or M6, no canned cycles, no M30. Machine Setup now labels its dialect select "Laser output dialect" when the setup includes CNC (CN-4).
- Only the Neotronics 4040 profile is labelled for CNC output. The generic GRBL, grblHAL and FluidNC profiles allow both modes; the generic Marlin, Smoothieware and Ruida profiles are labelled laser-only.
- Machine Setup will not save a CNC setup on a controller that cannot run CNC jobs, and when the setup includes CNC its controller list marks those controllers "— laser only". The Laser/CNC toggle warns when the profile's controller cannot run CNC jobs (CN-2).
- The CNC machine catalog holds 9 geometry and spindle presets. Loading one never changes the controller, and the preset says so.

### Machine table

"KerfDesk" is what KerfDesk's driver of that kind supports. No machine in the table is hardware-qualified, and vendor GRBL forks are compatible by their vendor's description, not by test.

- **T**: read from a primary source during the audit (GitHub source at a pinned commit, the pinned upstream trees, or SainSmart's PDF on S3). For this report the GitHub files and the PDF were fetched again and match.
- **†**: quoted from the vendor's page by the first CN session on 25 September 2026. Vendor sites were blocked in the later sessions, so these could not be read again.

| Machine | Controller / firmware | Family | KerfDesk | Source |
|---|---|---|---|---|
| Genmitsu 3018-PRO (also 3018, 1810-PRO) | SainSmart board, Grbl v1.1f on ATmega328P | GRBL | Live CNC | **T** [SainSmart Genmitsu Controller Board manual V1.0](https://s3.amazonaws.com/s3.image.smart/download/101-60-284/Controller_Board_User_Manual-English-V1.0-20200612.pdf): p.1 "This controller board is designed for the Genmitsu 1810-PRO, 3018 and 3018-PRO CNC milling/engraving machines."; p.15 "Grbl v1.1f comes preinstalled on the control module."; p.11 "a bootloader is already preinstalled on the ATMEGA328P at the factory". **†** [product page](https://www.sainsmart.com/products/sainsmart-genmitsu-cnc-router-3018-pro-diy-kit): "It's built on Arduino and Grbl (both open source)" |
| Genmitsu 3020-PRO MAX V2 | GRBL V1.1 | GRBL | Live CNC | **†** [sainsmart.com](https://www.sainsmart.com/products/3020-pro-max-v2): "While remaining based on open-source Grbl V1.1, the 3020-PRO MAX V2 CNC router has been upgraded with high-powered Toshiba TB6S109 drivers featuring 32-bit chips" |
| Genmitsu 4040-PRO / 4040-PRO MAX | GRBL, 32-bit MCU | GRBL | Live CNC | **†** [4040-PRO](https://www.sainsmart.com/products/genmitsu-4040-pro-semi-assembly-desktop-cnc-machine-for-carving-and-cutting): "Control: GRBL", "MCU: 32bits"; [4040-PRO MAX](https://www.sainsmart.com/products/4040-pro-max): "a comprehensive control system with GRBL firmware-compatible software (such as Candle, LaserGRBL, and LightBurn)" |
| Genmitsu PROVerXL 4030 V2 | GRBL 1.1h | GRBL | Live CNC | **†** [sainsmart.com](https://www.sainsmart.com/products/proverxl-4030-v2): "Control Board Compatibility: GRBL 1.1h" |
| Sienci LongMill MK1 | GRBL | GRBL | Live CNC | **T** Sienci's gSender @14c7084c `defaultMachineProfiles.ts:186`: `eepromSettings: longMillGrblEEPROM.LONGMILL_MK1_30x30,` (the GRBL `$` set in `MachineDefaults/grbl/longmill.js:56`). Inferred from vendor code, not a spec sheet |
| Sienci LongMill MK2, LongBoard | grbl v1.1h on Arduino Uno | GRBL | Live CNC | **†** [Sienci specs](https://resources.sienci.com/view/lmk2-mk2-specs/?print=print): "The LongBoard uses an Arduino Uno running grbl v1.1h powering four 4A TB6600 motor drivers." **T** gSender `defaultMachineProfiles.ts:130`: `eepromSettings: longMillGrblEEPROM.LONGMILL_MK2_30x30,` |
| Sienci LongMill MK2, SuperLongBoard | grblHAL on STM32F412 | grblHAL | Live CNC | **†** same page: "SuperLongBoard 5xHAL uses an STM32F412 chip running grblHAL powering four TMC2660C motor drivers." **T** grblHAL/STM32F4xx @f331441a `driver.json:558-562`: `"name": "SuperLongBoard (SLB)"`, `"MAP": "boards/longboard32_map.h"` |
| Sienci LongMill MK3 | grblHAL | grblHAL | Live CNC | **T** gSender `defaultMachineProfiles.ts:86`: `eepromSettings: longMillGrblHALEEPROM.LONGMILL_MK3_30x30,` (MK3 has no GRBL defaults). Inferred from vendor code |
| Sienci AltMill | SLB-EXT, grblHAL | grblHAL | Live CNC | **†** [Sienci](https://resources.sienci.com/view/am-about-your-altmill/): "32-bit SLB-Ext controller running grblHAL firmware, with signal outputs to integrated driver stepper motors." **T** grblHAL/STM32F4xx `driver.json:597-601`: `"name": "SuperLongBoard External (SLB EXT)"` |
| Carbide 3D Shapeoko 3 | Carbide Motion board, GRBL 1.1 | GRBL (vendor build) | Live CNC; not qualified | **†** [assembly guide](https://my.carbide3d.com/pdf/shapeoko3_assembly.pdf) p.2: "The Shapeoko 3 Carbide Motion board ships with GRBL 1.1 firmware, which must be used with Carbide Motion 5." |
| Carbide 3D Shapeoko XXL | GRBL 1.1 | GRBL | Live CNC | **†** [assembly guide](https://my.carbide3d.com/pdf/shapeoko3_xxl_assembly.pdf) p.3: "The Shapeoko XXL controller unit ships with GRBL 1.1 firmware, which must be used with Carbide Motion 5." |
| Carbide 3D Shapeoko 4 | GRBL 1.1 | GRBL | Live CNC | **†** [assembly guide](https://my.carbide3d.com/pdf/shapeoko4_xxl_assembly_guide_v1-1.pdf) p.2: "The Shapeoko 4 controller ships with GRBL 1.1 firmware, which must be used with Carbide Motion 5." |
| Carbide 3D Shapeoko Pro | GRBL 1.1 | GRBL | Live CNC | **†** [assembly guide](https://my.carbide3d.com/pdf/Shapeoko_Pro_assembly_guide_02-05-2021_v1_web.pdf) p.2: "The Shapeoko Pro controller ships with GRBL 1.1 firmware, which must be used with Carbide Motion 5." |
| Carbide 3D Shapeoko 5 Pro | New Carbide electronics, "new GRBL" (version not stated) | GRBL (vendor build) | Probably live; version unverified | **†** [Carbide 3D blog](https://carbide3d.com/blog/introducing-shapeoko-5-pro/): "new electronics, new motors, new GRBL, new everything." |
| Carbide 3D Nomad | Carbide Motion board, Atmel 328 running GRBL | GRBL | Live CNC | **†** [Carbide 3D shop](https://shop.carbide3d.com/products/nomad-carbide-motion-board): "Atmel 328 running GRBL". The page does not name the Nomad 3 |
| Inventables X-Carve (X-Controller) | grbl | GRBL | Live CNC | **†** [X-Carve instructions](https://x-carve-instructions.inventables.com/upgrade/step4/): "If you're using an X-Controller, you'll will already have the correct grbl firmware installed on your controller board." **T** gnea/grbl wiki `Using-Grbl.md:146`: "Easel is a web based project developed by Inventables specifically for use with X-Carve, Carvey + Grbl." |
| Inventables X-Carve Pro | Grbl 1.1h fork, ATmega2560 | GRBL (vendor fork) | Probably live; not qualified | **T** inventables/grbl-xcp @acbb1d28 `README.md:3`: "Grbl 1.1h fork for the X-Carve Pro machine." |
| Inventables Carvey | Grbl 1.1e fork, Arduino Mega 2560 | GRBL (vendor fork) | Probably live; not qualified | **T** inventables/gCarvin @9954a26d `README.md:2`: "Grbl 1.1e fork for the Carvey machine"; README: 'Make sure to have the "Board" type set as "Arduino Mega 2560".' |
| OpenBuilds BlackBox 4X | Grbl, ATmega328p | GRBL | Live CNC | **T** OpenBuilds-CONTROL @1adcc121 `app/wizards/flashingtool2/flashingtool.js:251-254`: `if (selectedControllerType == "blackbox4x") {` … `var filename = "grbl-3axes-nodoor.hex";`, flashed with `socket.emit('flashGrbl', data)` (`:280`) |
| OpenBuilds BlackBox X32 | grblHAL | grblHAL | Live CNC | **T** same file `:297-300`: `} else if (selectedControllerType == "blackboxx32") {` … `var filename = "grblhal-grbl3axis.bin";`, `socket.emit('flashGrblHal', data)` (`:329`) |
| V1 Engineering Jackpot (V1, 2, 3) | FluidNC on ESP32 | FluidNC | Live CNC | **T** V1EngineeringInc/FluidNC_Configs @fadbfe2e `README.md:2`: "Configuration and support files for the FluidNC boards typically used with the V1 Engineering CNC machines." **†** [V1E docs](https://docs.v1e.com/electronics/jackpot/): "The Jackpot CNC Control board runs FluidNC which is fully GRBL compatible with extended features" |
| V1 Engineering MPCNC / LowRider on SKR Pro (older kits) | Marlin, V1E MarlinBuilder config | Marlin | Laser only; CNC Frame refused with the reason; exports warn | **T** V1EngineeringInc/MarlinBuilder @75debb5 `src/configs/V1CNC_SkrPro_2209:9-15` applies `common/cnc-config`, `accessories/TFT35_e3_v3_CNC` and `accessories/laser`; `accessories/laser:9-12` enables `LASER_FEATURE`; `TFT35_e3_v3_CNC:9,12` enables `EMERGENCY_PARSER` and `REPRAP_DISCOUNT_FULL_GRAPHIC_SMART_CONTROLLER`. **†** [V1E docs](https://docs.v1e.com/electronics/skrpro/): "V1 Engineering pre-configured firmware" |
| Makera Carvera | Smoothieware branch | Smoothieware | Laser only; CNC refused; exports warn | **T** MakeraInc/CarveraFirmware @83c66915 `README.md:2`: "This is a branch of the Smoothieware firmware for the Makera Carvera CNC Machine." **†** [Makera wiki](https://wiki.makera.com/en/supported-codes): "G4 Dwell P<seconds>", "M6 Auto tool change", "M600 Pauses the machine and waits for a resume command to continue" |
| Snapmaker 2.0 | Marlin-based Snapmaker2-Controller | Marlin (vendor fork) | Not a KerfDesk CNC target | **T** Snapmaker/Snapmaker2-Controller @314c167b `README.md:3`: "Snapmaker2-Controller is the firmware for Snapmaker 2.0 3-in-1 3D Printers. It's based on the popular Marlin firmware with optimized FreeRTOS support." |
| Ooznest WorkBee | Duet 2, RepRapFirmware (version not verified) | RepRapFirmware | No driver; Save G-code only | **†** [Ooznest](https://ooznest.co.uk/product/original-workbee-replacement-duet/): "Replacement Duet 2 Controller for the WorkBee CNC Machine". **T** Duet3D/RepRapFirmware @5862b26 `src/Config/Pins_DuetNG.h:8`: "// Pins definition file for Duet 2 WiFi/Ethernet" |
| Onefinity Original / PRO series (BB controller) | Buildbotics-derived stand-alone web controller, LinuxCNC-style G-code | Stand-alone | Save G-code only | **†** [Onefinity](https://www.onefinitycnc.com/product-page/onefinity-controller): "Onefinity BB (Buildbotics) Controller"; [Buildbotics manual](https://buildbotics.com/manual-v1-0/): "It is a stand-alone device that acts as a web server." **T** OneFinityCNC/onefinity-firmware @44b85bad `setup.py:12`: `description = 'Buildbotics Machine Controller'`; buildbotics/bbctrl-firmware @41e98e31 `src/pug/templates/docs-gcode.pug:29`: "// Modified from https://linuxcnc.org/docs/html/gcode.html" |
| Onefinity Elite Gen 1 | MASSO G3 Touch (or Redline upgrade) | Stand-alone | Save G-code only | **†** [Onefinity](https://www.onefinitycnc.com/post/gen-1-elite-series-vs-gen-2-elite-series-which-onefinity-cnc-is-right-for-you): "Masso G3 Touch (Gen 1): This is a proven, standalone industrial controller" |
| Onefinity Elite Gen 2 | Redline HMI + RealTime Motion Controller | Stand-alone | Save G-code only; dialect unverified | **†** same page: "the Gen 2 utilizes the Redline HMI paired with the RealTime Motion Controller" |
| Avid CNC (current EX controls) | Centroid CNC12 | PC control | Save G-code only | **†** [Avid support](https://www.avidcnc.com/support/instructions/): "Systems with EX Controllers (Centroid CNC12)" |
| Avid CNC (legacy Plug & Play) | Mach4 + Ethernet SmoothStepper | PC control | Save G-code only | **†** [Avid](https://www.avidcnc.com/mach4-cnc-control-software-p-165.html): "We have provided a version of Mach4 with a custom user interface for extremely easy setup and operation of all Avid CNC machines." |
| Stepcraft | UCCNC | PC control | Save G-code only | **†** [Stepcraft](https://stepcraft.us/uccncinstall/): "On this drive is the UCCNC machine control software installer." (the EU WinPC-NC option is unverified) |
| Chinese 6040 / 3040 (VEVOR example) | Mach3 over USB, plus an offline controller | PC / stand-alone | Save G-code only | **†** [VEVOR](https://www.vevor.com/wood-engraving-machine-c_11142/4-axis-cnc-router-6040-machine-4-rotating-axis-milling-1605-ball-screw-us-stock-p_010438919514): "This cutting machine has an independent offline controller. … 5. Supported software: Mach 3." |
| DDCSV3.1 stand-alone (common on 6040s) | Digital Dream DDCS V3.1 | Stand-alone | Save G-code only | **†** [DDCSV3.1 manual](https://motioninc.co.za/Content/Images/uploaded/cnc%20-%20plasma/machine%20interface/DS_DDCSV3.1.pdf) p.43: G/M list G0-G3, G17-19, G28, G31, G54-59, G81-83, G90/91, G98/99, M3, M5, M8-M11 (no G4, G21, G94, M0 or M7) |
| Two Trees TTC450 (Pro / Ultra) | GRBL | GRBL | Live CNC; board build not qualified | **†** [Two Trees](https://twotrees3d.com/products/twotrees-ttc450-ultra-cnc-router-machine): "Firmware type: GRBL open source, supports both CNC and laser (no firmware flash required)" |
| FoxAlien Masuter | GRBL | GRBL | Live CNC | **†** [FoxAlien](https://www.foxalien.com/en-de/collections/cnc-router/products/cnc-router-machine-masuter): "The machine is compatible with Grbl software." (the Masuter Pro page does not name its firmware) |
| **Neotronics 4040 Max (your machine)** | "offline controller"; firmware not named | Unverified | The profile assumes GRBL 1.1 ("firmware builds unconfirmed", `PROJECT.md`) | **†** [Neotronics](https://neotronics.co.za/index.php?product_id=1018&route=product%2Fproduct): "It also comes with an offline controller, Z-Probe, and limit switches, pre-assembled." / "New controller - We mixed the 4040pro controller and the board into a new controller." |

**Your 4040.** Neotronics names an offline controller but not its firmware. SainSmart lists the 4040-PRO's control as GRBL, and Neotronics says its controller mixes in the 4040-PRO's, so GRBL is plausible, not verified. Send the Console output of `$I` and the connect banner: `Grbl 1.1…` confirms the profile's GRBL 1.1; anything else names the kind to choose.

**Evidence limits.** The egress proxy blocked every vendor site tried: sainsmart.com, docs.sainsmart.com, resources.sienci.com, carbide3d.com, docs.v1e.com, wiki.makera.com, docs.masso.com.au, marlinfw.org, linuxcnc.org, bobscnc.com and others. Six of them were tried again for this report and are still blocked. GitHub, raw.githubusercontent.com and SainSmart's PDF on S3 were reachable. Search-engine summaries were not used as evidence: one attributed "Grbl v1.1f comes preinstalled" to the PROVerXL 6050, but the PDF it came from covers the 3018/3018-PRO/1810-PRO board. Left out as unverified: Genmitsu 3018-PROVer V2, PROVerXL 6050 and 6050 Plus, Shapeoko HDM, BobsCNC E3/E4, Vevor 3018, Ortur and Atomstack CNC kits, CNC4Newbie and MASSO retrofits, MillRight and YoraHome. Sienci's gSender ships size presets for several of these; that shows they are used with GRBL-family senders, not what their stock controller is.

### What the GRBL CNC file means on other controllers

KerfDesk writes `M3 S12000` then `G4 P3.000` (a 3 s spin-up), `M0` for a tool change, `;` comments and incremental I/J arcs.

| Controller | `G4 P3.000` | Tool-change `M0` | Other | Source |
|---|---|---|---|---|
| GRBL 1.1h | 3 s | Pauses | `;` comments; I/J incremental only, `G91.1` a no-op | **T** `grbl/motion_control.c:195` `void mc_dwell(float seconds)`, `gcode.c:969`; `gcode.c:250` "Program pause"; `protocol.c:131-132`; `gcode.c:192,514` |
| grblHAL | 3 s | Pauses | `G91.1` accepted, `G90.1` rejected | **T** `motion_control.c:853`, `gcode.c:4449`; `gcode.c:1815`; `protocol.c:114`; `gcode.c:1626-1630` |
| FluidNC v4.0.3 | 3 s | Pauses | `G91.1` accepted | **T** `GCode.cpp:1804` `mc_dwell(int32_t(gc_block.values.p * 1000.0f))`; `:630`; `:184-185`; `:505-515` |
| Marlin 2.1.2.8 | **3 ms** | Pauses only on builds with `HAS_RESUME_CONTINUE` (an LCD, `EMERGENCY_PARSER` …); V1E's TFT35 CNC build has it | The seconds form is `G4 S`. `G91.1` would be read as `G91`, relative mode. The default `CUTTER_POWER_UNIT PWM255` clamps S12000 to full output | **T** `gcode/motion/G4.cpp:33` "milliseconds to wait", `parser.h:277,280`; `gcode.cpp:484-487`, `inc/Conditionals_adv.h:882-883`; `gcode.cpp:466`; `Configuration_adv.h:3372`, `feature/spindle_laser.h:164-171` |
| Smoothieware edge | 3 s only in `grbl_mode` (on by default only in the CNC build), otherwise **3 ms** | **Ignored** (`M0` is commented out; no other handler) | The 3D build leaves out `tools/spindle`, so M3 does nothing. `G91.1` would be read as `G91` | **T** `Robot.cpp:500-511` "in reprap P is milliseconds"; `libs/Kernel.cpp:113-117`; `src/makefile:73-79`; `Robot.cpp:694-696`; `Robot.cpp:622` |
| Makera Carvera | Seconds (vendor wiki; the same `grbl_mode` switch in code) | **Ignored**; its pause is `M600`, its tool change `M6` | — | **T** CarveraFirmware @83c66915 `src/modules/robot/Robot.cpp:539-550`, `:800-802`; `src/modules/utils/player/Player.cpp:257`. **†** Makera wiki |
| RepRapFirmware 3.7.0-rc.1 | **3 ms** (integer part read) | **Ends the job** when read from a file | — | **T** Duet3D/RepRapFirmware @5862b26 `src/GCodes/GCodes.cpp:3908-3909` "P value are in milliseconds"; `GCodeBuffer/StringParser.cpp:2039-2052`; `GCodes2.cpp:760-777` "Stopping a job because of a command in the file" |
| LinuxCNC (the reference Buildbotics documents) | 3 s | Pauses | `( )` and `;` comments | **T** LinuxCNC @f218ffbf `docs/src/gcode/g-code.adoc:520` "The P number is the time in seconds that all axes will remain unmoving."; `m-code.adoc:43` "'M0' - pause a running program temporarily."; `overview.adoc:160` |
| Buildbotics / Onefinity BB | Likely 3 s (its docs link G4 to LinuxCNC) | Likely pauses (its docs link M0 to LinuxCNC) | — | **T** bbctrl-firmware @41e98e31 `docs-gcode.pug:29,62-64,237` (links only; the planner was not read) |
| Centroid CNC12 | Seconds | Not checked | — | **†** "The P parameter is used to specify the time in seconds" |
| Mach4 v1.1 | Seconds if a decimal point is used | Not checked | — | **†** "If a decimal point is used, then P or X specifies seconds" |
| Mach3 | Configurable | Not checked | The 1.84 manual documents only `( )`, `%` and `//` comments; "IJ mode" is configurable (Inc or Absolute) | **†** "G04 Dwell param in Milliseconds, if checked then the command G4 5000 will give a Dwell in running of 5 seconds" |
| MASSO | **Milliseconds** | Not checked | — | **†** "The value is specified in milliseconds" (docs.masso.com.au G04 page) |
| UCCNC | **Milliseconds** by default | Not checked | The manual documents `( )` comments and uses `;` as an argument separator | **†** "By default the time for dwell is measured in milliseconds" |
| DDCSV3.1 | G4 not listed | M0 not listed | G21, G94 and M7 not listed either | **†** DDCSV3.1 manual p.43 |

No other CNC dialect was built, because no single form is portable. Dwell is seconds on the GRBL family, LinuxCNC, Centroid and Mach4 (with a decimal point), milliseconds on Marlin, MASSO, UCCNC and RepRapFirmware, and configurable on Mach3. `M0` pauses, is ignored or ends the job, depending on the controller. Each named post-processor would need its own vendor-backed tests and an air cut before it is offered.

## Checked and correct

### GRBL protocol

- KerfDesk reads every status field GRBL 1.1h prints (`report.c:466-654`). GRBL sends WCO and Ov only every 10 to 30 reports (`config.h:285-288`), so KerfDesk keeps them from the last report that had them, and reads Ov without `A:` as spindle and coolant off (`report.c:627-648`). Positions are scaled under `$13=1`; `$$` values stay in mm (`report.c:183-225`).
- `ok`, `error:N` and `ALARM:N` are told apart, and an alarm answers no sent line. Bracketed messages, `$N=` rows, `$N0=` listings and `>G54:ok` startup echoes are never counted as answers. A banner starts a new session, because GRBL clears its receive buffer and re-initialises before printing it (`main.c:88-102`).
- A failed probe prints ALARM:4 or 5, `[PRB:…:0]` and then `ok` (`motion_control.c:273-317`); that `ok` lands on an empty ledger and does nothing.
- KerfDesk builds `$J=` from G90 or G91, G21, X, Y, Z and F only, all allowed by `gcode.c:853-857`, and sends it only after a fresh Idle or inside the Frame's own jog.
- `G10 L20 P0` takes its values as given whatever G90 or G91 says (`gcode.c:549-552`). Settings and offset writes (`$x=`, `G10 L2/L20`) are owned exchanges, and no job program contains G10, G28.1 or G30.1.
- `$I` options are read in the order GRBL prints them (`report.c:375-446`), and an RX size of 128 gives a 120-byte window.
- Comment stripping matches `protocol.c:113-148`, bytes above 0x7F are refused in queued lines (`serial.c:156`), and the other error and alarm texts match GRBL's CSV tables.

### GRBL streaming

- GRBL's receive ring holds 128 bytes (`serial.c:24,37-42`). KerfDesk streams in 120 bytes, or the reported `Bf:` free bytes minus 8 (`grbl-streaming.ts:1,16,48-52`). It counts the `\n`, never sends `\r`, leaves realtime bytes out of the count, and refuses at Start a line longer than the receive buffer.
- grblHAL reports its driver ring's free bytes in `Bf:` (`report.c:1342-1346`; 1024 bytes by default, `stream.h:52-53`). KerfDesk reads it only with nothing in flight and never streams past it.
- After a job `error:N`, GRBL goes on parsing the lines already buffered; KerfDesk stops the job, soft-resets at once and absorbs the trailing answers. grblHAL repeats the error for later G-code lines at its default compatibility level (`protocol.c:265-286`), and that is absorbed the same way.
- ALARM:1 and 2 hold GRBL until a reset, and the receive buffer is cleared at re-init (`protocol.c:226-236`, `main.c:88`). Every soft-reset path (Abort, the error stop, Disconnect, probe recovery, Wake) ends in the banner handler, which zeroes owed answers (`laser-line-handler.ts:362`) and drops the lines in flight.
- Pause sends 0x84, which GRBL honours with no door switch (`serial.c:158`, `system.c:87-93`). Resume sends `~` only after a completed hold, the only time GRBL acts on it (`protocol.c:348-349`).
- G4, M3, M5, M8 and M9 wait for the planner to drain (`motion_control.c:195-200`, `spindle_control.c:277-280`, `coolant_control.c:121-124`). A G4 `ok` does not prove an M3 laser is off, since only M4 blocks go dark at an empty buffer (`stepper.c:397`); KerfDesk relies on M5 and the `A:` field instead.
- GRBL answers `?` every 50 ms during a dwell (`nuts_bolts.c:112-126`, `config.h:414`), so the 2 s stream heartbeat holds, and the 250 ms poll (4 Hz) is under the wiki's 5 Hz advice. Jog cancel (0x85) acts only in Jog (`serial.c:159-163`), and KerfDesk resends it only after a fresh Jog report (`laser-motion-cancel.ts:224`).

### Serial connection

- Both transports split lines on LF or CRLF across chunks, cap an unterminated record at 64 KiB (`serial-wire.ts:32`) and decode UTF-8 as a stream, so a stray high byte spoils only its own line. Every firmware ends its lines with LF or CRLF: GRBL `report.c:34`, grblHAL `stream.h:50`, FluidNC `Channel.cpp:283-288`, Marlin `serial.h:172`.
- A status report never lands inside another line: GRBL's `serial_write` does no realtime work while it waits for buffer space (`serial.c:86-103`).
- Line errors (break, framing, parity, overrun) resume on a fresh reader in both transports, with a budget of 8 recoveries without data (`serial-read-recovery.ts:21-26,39`); an UnknownError ends the session.
- Each session has one writer, and writes go out in call order, each a whole line or one realtime byte, so a realtime byte never splits a line. The owed answer is reserved before the write starts (`laser-safe-write.ts:99-108`).
- Disconnect on the GRBL family sends Ctrl-X, then M5 and M9, and drains the writer before it closes the port. The reset itself stops spindle and coolant (GRBL `motion_control.c:372-374`, FluidNC `Protocol.cpp:874-878`).
- A reset banner later than the 2 s handshake window (`laser-controller-handshake.ts:36-38`) still ends qualified; GRBL prints its banner after clearing its receive buffer (`main.c:88,102`). grblHAL prints its welcome 200 ms after DTR without rebooting (`stream.c:328-333`), and Smoothieware prints `Smoothie` and `ok` on attach (`USBSerial.cpp:328-332`); the first-banner handling copes with both.
- An unplug mid-job ends the session through the disconnect event or the failed read, marks the stream disconnected and shows Disconnected (`laser-store-helpers.ts:354-365`).

### grblHAL, FluidNC and the Falcon

- Banner detection names each default banner correctly: grblHAL at level 0 prints `GrblHAL 1.1f` (report.c:311-312), FluidNC's default start message is `Grbl \V [FluidNC \B (\X) \H]` (SettingsDefinitions.cpp:107-108), and `detect-controller.ts:14-17` maps them, and stock GRBL's `Grbl 1.1h`, to grblHAL, FluidNC and GRBL 1.1.
- The Falcon command set pairs only with the GRBL and grblHAL drivers; FluidNC, Marlin, Smoothieware and Ruida get their plain drivers (`select-controller-driver.ts:22-40`), and Machine Setup drops the command set when another family is chosen (`device-setup-controller-selection.ts:13-21`).
- The streaming window at Start comes from the active driver and the live `Bf:` report, not from the banner (`laser-job-effective-stream-options.ts:60-99`). grblHAL's receive buffer is 1024 bytes (stream.h:52-54), and its `Bf:` gives free planner blocks and free receive bytes (report.c:1342-1347).
- Only grblHAL latches a refused line's error. FluidNC checks each line on its own (ProcessSettings.cpp:1224-1253) and stock GRBL answers an empty line `ok` (protocol.c:93-95). A soft reset clears grblHAL's latched error (gcode.c:787 clears the parser state up to `g92_offset`, and `last_error` sits before it, gcode.h:719-724), so Stop, Abort, Disconnect and Wake all end it.
- On generic grblHAL, Release motors is disabled when `$$` reports `$62=0` (`controller-sleep.ts:20-27`), which matches grblHAL's `error:3` for `$SLP` with sleep off (system.c:574-575). Only the Falcon, which reads no `$$`, met HF-4.
- grblHAL keeps answering `?` inside its critical-event loop (protocol.c:503-506), so KerfDesk sees Alarm there, never a stale Idle.
- FluidNC allows `$H` in its Critical state (`allowConfigStates`, Settings.cpp:58-60, checked at Settings.cpp:407-410), so Home is a valid way out of it.
- Alarm tables match upstream: grblHAL alarms 1 to 22, with 10 as E-stop (alarms.h:29-53), match `alarm-codes.ts`, and FluidNC alarms 1 to 18 (Alarm.h:4-24) match `response-presentation.ts:113-131`.
- FluidNC reports its Critical and ConfigAlarm states as "Alarm" (Report.cpp:436-439) and always reports at least three axes (Machine/Axes.cpp:188-191).
- The Falcon contract sends no `$J=`, `$$`, `$I` or jog-cancel byte, frames with `M5` and no `M9`, and allows only `$150` to `$152` writes of 0 to 100 (`falcon-command-contract.ts:14-58`).

### Controls across controllers

- GRBL's realtime and override bytes match gnea/grbl exactly: Ctrl-X 0x18, `?`, `~`, `!`, door 0x84, jog-cancel 0x85, feed 0x90 to 0x94, rapid 0x95 to 0x97, spindle 0x99 to 0x9D (`grbl/commands.ts:16-30,142,150-162`; config.h:51-54,64-65,67-80). FluidNC v4.0.3 uses the same bytes (RealtimeCmd.h:19-42).
- GRBL's jog-cancel acts only on `$J=` jogs (serial.c:159-162), so leaving it out for the Falcon's `G1` jog and Frame is right; CG-12 was in the shortcut, not the driver.
- Smoothieware: `!` and `~` work only with feed hold enabled (USBSerial.cpp:220), so KerfDesk sends neither; a halted board still accepts `M5` and `M9` (GcodeDispatch.cpp:34), so Abort's clean-up lines are answered; `M999` clears the halt and answers `ok` (GcodeDispatch.cpp:160-167).
- Smoothieware's `$H` homes in both dialects and answers `ok` after the cycle (SimpleShell.cpp:241-252). The Console lets through only the shell lines that print a completion, `$G`, `$#`, `$H`, `version` and `fire off` (`smoothieware/console-command.ts:38-108`), as SimpleShell.cpp:205-297 and Laser.cpp:154 print them.
- A stream-side Pause on Smoothieware cannot leave the beam on: every millisecond the laser is switched off when no G1 to G3 block is running (Laser.cpp:259-287).
- Smoothieware Reset origin works: `G92.1` clears the `G92` offset (Robot.cpp:624-627).
- Marlin's Manual Air commands are right on builds with `AIR_ASSIST`: `M8` switches air on and `M9` off (M7-M9.cpp:49-75).
- GRBL `M7` needs `ENABLE_M7` (config.h:169; otherwise `error:20`, gcode.c:263-283), and KerfDesk warns from `$I` (`m7-air-assist-readiness.ts:9-10`).
- Fire sends `G1 F<feed> M3 S<n>` (`laser-fire-actions.ts:37-40`), which GRBL laser mode powers, because it passes power only for G1 to G3 blocks (gcode.c:869-873,931-934). Fire is refused where the driver does not support it (`laser-fire-actions.ts:141`).
- Controls are hidden or refused by capability at each call site: overrides (`JobRunControls.tsx:28`, `JobControls.tsx:85`), Probe (`ProbeControls.tsx:50`), CNC Start (`laser-start-program-assertions.ts:78`), Console input (`use-console-command-deck-model.ts:128`), setting writes (`grbl-settings-actions.ts:211-217`), the Unlock offer (`start-blocked-alarm-offers.ts:76`) and board-capture moves without jog-cancel (`CircleCenterConfirmation.tsx:49`).
- Release motors is refused when the driver has no sleep command (`controller-sleep.ts:20-27`), and the Position job guide shows the same reason (`NoHomingPositionGuide.tsx:48`).
- Disconnect on GRBL-family controllers sends Ctrl-X, waits for the reboot banner, then sends `M5` and `M9` (`laser-disconnect-transaction.ts:70-119`); on Marlin and Smoothieware it sends the stop lines, plus a reset where the driver has one (`laser-store-helpers.ts:191-211`). The Marlin air gap was CG-10.
- The Falcon's `$HX` and `$HY` are separately owned lines, each waiting for its own reply (`laser-home-action.ts:150-162`), and stock GRBL ends a single-axis home in Idle (system.c:195-197). grblHAL's relock between them was HF-1.
- Marlin and Smoothieware pause and stop on the host side: no Hold or realtime wait is attempted (`realtimePause: false`; `LiveMotionBar.tsx:96`).
- GRBL and grblHAL send a fresh `WCO:` only after a WCS change, `G92`, `G10` or `G43.1` (gcode.c:991-1121; grblHAL gcode.c:2990,4483-4487), which is why a `G54` that changed nothing left the offset unknown (CG-2).

### Marlin

- Inline power is bracketed correctly: `M5 I` ends inline mode and zeroes the output once the planner drains, and `M3 I S0` re-enters continuous mode at power 0 (`M3-M5.cpp:84-88,142-154`). Plain `M3` would not re-enable the output.
- Inline power runs S0 to S255 with stock `CUTTER_POWER_UNIT PWM255` (`Configuration_adv.h:3372`), set by each G1's S (`gcode.cpp:233-241`); the Generic Marlin profile uses 255. A G0 zeroes inline power (`gcode.cpp:243-250`), and the program restates S on the first G1 after every G0.
- `M7`, `M8` and `M9` wait for the planner (`M7-M9.cpp:34-75`), so the program's `M9` before its final `M5 I` does not cut the air during the last buffered burns.
- Fan-dialect timing while moving is right: `M106` sets the speed at once, each planned block captures it (`planner.cpp:2252-2254`), and the running block drives the fan (`planner.cpp:1355-1362`). `M106 S<n>` before a burn and `M107` before travel switch with the moves.
- `M114` on a 3-axis build parses correctly (`motion.cpp:192-212`, `stepper.cpp:3260-3274`). It is the planned position (`M114.cpp:146-147`), and KerfDesk trusts it only after an owned `M400` (`response.ts:37-41`). `M400` is the right settle marker (`M400.cpp:29-33`); only its timeout was wrong (MA-4).
- `G21` is a silent no-op on stock builds (`gcode.cpp:392`). `G28 X Y` homes only X and Y (`G28.cpp:376-398`) and reports the position when done (`:619`).
- The boot lines `start` (`MarlinCore.cpp:1185`) and `Marlin 2.1.2.8` (`:1285`) both count as a welcome (`response.ts:27-29`).
- A jog (`G21`, `G91`, `G0 X.. F..`, `G90`) runs at the requested feed, because an F on `G0` sets the shared feed (`gcode.cpp:213-214`). Press-and-hold jog is off on Marlin (`JogPad.tsx:45`, `jogCancel: false`), which is right: Marlin has no jog cancel.
- One line per `ok` (`profile-catalog.ts:99`) fits Marlin's 4-command buffer (`Configuration_adv.h:2405`). Lines without numbers are accepted, because only a line that starts with `N` is checked (`queue.cpp:472-473`).
- Resume matches Marlin for the modes KerfDesk writes: `M5 I` off, `G0 X Y S0` re-entry (G0 zeroes inline power), `M3 I S0` re-arm, `G1 F<feed>` (a bare F is not a command without `GCODE_MOTION_MODES`, `parser.cpp:266`), the held S restated on the first burn move, and in the fan dialect `M107` before re-entry and `M106 S<held>` before the first move. The resume oracle tests (`resume-program.native-oracle.test.ts`, `resume-program.native.test.ts`) pass.
- Stock builds act on `M410` and `M112` when the line is read (`queue.cpp:538-545`), which MA-7's fix relies on.

### Smoothieware

- `ok` and `ok <text>` both count as acknowledgements (`/^ok\b/i`, `response.ts:13,24`). GcodeDispatch answers an empty line with `ok` (`GcodeDispatch.cpp:64-67`) and prints `ok %s` for trailing text (`:410-411`).
- While halted, `!!` (normal mode) and `error:Alarm lock` (grbl mode) are the terminal replies, and both read as errors (`GcodeDispatch.cpp:158-180`). `M999` clears the halt and answers `ok` (`:160-166`).
- `$X` answers only while halted (`SimpleShell.cpp:229-234`), so the Console refuses it (`console-command.ts:33-34,93`) and Unlock sends `M999`.
- `$G` and `$#` print `ok` (`SimpleShell.cpp:218-222,236-239`), other `$` letters get `error:Invalid statement` (`:263-264`), and unknown shell commands `error:Unsupported command - …` (`:293-294`). The Console's shell allow-list matches.
- `$H` homes in both dialects and prints `ok` after the blocking cycle (`SimpleShell.cpp:241-252`), while `G28` parks in grbl mode and `G28.2` parks otherwise (`Endstops.cpp:1046-1071`), so `$H` is the right Home command.
- Home's leading `M400` is refused while halted, because 400 is not in `allowed_mcodes` (`GcodeDispatch.cpp:34`), so `$H` never clears a halt behind the operator's back (`driver.ts:63-67`).
- `fire off` completes with exactly "turning laser off and returning to auto mode" and no `ok` (`Laser.cpp:152-154`), matched exactly (`response.ts:27`). The Laser module ignores `fire` while halted (`Laser.cpp:126`).
- `version` prints its `Build version: …` line first and no `ok` (`SimpleShell.cpp:661-666`), and KerfDesk uses that line as the completion (`response.ts:32`). `M115` prints `FIRMWARE_NAME:Smoothieware…` then `ok` (`GcodeDispatch.cpp:269-291`) and is read as a message, not a reboot (`response.ts:46`).
- On USB the boot banner `Smoothie Running @%ldMHz` (`main.cpp:103`) and the attach line `Smoothie` (`USBSerial.cpp:332`) are the only lines that start with `Smoothie`, and both count as welcome banners. The `ok` after an attach reaches an acknowledgement count the banner just reset (`laser-line-handler.ts:362`), so it is dropped harmlessly.
- `?` is answered at any time, during `M400` and homing too (`USBSerial.cpp:215-218`, answered at `:316-319`). `!` and `~` work only with feed hold enabled (`:220-230`), so the driver rightly claims neither (`driver.ts:52-58`). Ctrl-X sets the halt flag (`:204-207`).
- After a halt `Laser::on_halt` switches the beam off and ends manual fire (`Laser.cpp:308-314`). Abort's cleanup `M5` and `M9` go out on the 500 ms fallback (`laser-reset-cleanup.ts:18,47-49`), since Ctrl-X prints no banner, and both run while halted (`GcodeDispatch.cpp:34`).
- The status grammar parses with the extra `L:`, `S:`, `T:`, `B:` and `SD:` fields ignored, the second `F:` value is never read as spindle (`status-parser.ts:319-331`), and the older comma grammar `<Idle,MPos:…,WPos:…>` regroups correctly (`comma-status-report.ts`), checked against `Kernel.cpp:177-334`.
- A completed jog or Frame leaves the seek rate alone: `M120` and `M121` push and pop the feed, seek rate, absolute and inch modes and the WCS (`Robot.cpp:331-352,777-783`), and a jog is one write, so its `M121` always runs. SM-5 covers the stopped Frame.
- `M221` applies at once (`Laser.cpp:196-213`), so the `M400` before every `M221` is needed. `M221 S` is a percentage and is never rescaled, because the S rescale runs before the `M221` lines are added (`smoothieware-strategy.ts:28`). On current builds P above 0 disables proportional power (`Laser.cpp:206-208`); SM-2 covers older builds.
- The default Full-power S of 1 is exact: S up to 1 fits the 1.11 field (`S1` stores 2048, below 4096).
- S is modal on `G0` to `G3` (`Robot.cpp:1032-1034`), and a `G0` block never fires (`Laser.cpp:245`).
- `M400` waits for the queue to empty before its `ok` (`Robot.cpp:920-922`).
- `G92 X0 Y0` makes the current WPos zero (`Robot.cpp:644-661`), and `G92.1` clears the offset (`:624-627`).
- GcodeDispatch ignores lowercase lines (`GcodeDispatch.cpp:79-82`), so the Console rightly refuses lowercase G-code (`console-command.ts:98`) and `config-set`/`config-load` (`:65-67`).

### Ruida .rd export

- Swizzle and unswizzle equal meerk40t's `swizzle_byte` and `unswizzle_byte` for all 256 keys and all 256 bytes (`rdjob.py:434-449`; `swizzle-meerk40t.test.ts` checks digests taken from meerk40t's own functions). The default key 0x88 is meerk40t's default too (`encode_bytes(data, magic=0x88)`, `rdjob.py:493`).
- Numbers are encoded as meerk40t encodes them: absolute coordinates in µm as five 7-bit bytes, most significant first (`encode32`, `rdjob.py:281-291`); speed in µm/s in the same five bytes (`encode_speed`, `:321-323`); power on a 14-bit scale where 16383 is 100 % (`encode_power`, `:316-318`). KerfDesk rounds where meerk40t truncates, at most one unit apart.
- meerk40t's own parser reads every KerfDesk dump with no unknown command: 78 commands across four files, each named (re-run for this report).
- UDP framing matches meerk40t's `_package`: a 16-bit big-endian sum of the swizzled payload, sent before it (`ruidasession.py:197-202`). Replies are unswizzled before they are read; ACK advances, NAK resends, ENQ changes nothing (`:370-385`).
- The rear-right origin writes x = bed width − scene x and y = scene y (`origin-transform.ts:63-65`), the mapping meerk40t's tested RDC6442S needs with "Flip X" on (`ruida/README.md:9-10`).
- Frame and Start cannot be reached on the Ruida profile (the file-only driver, `ruida/driver.ts:16-17`, builds no Frame lines, `:60`). Every save shows the EXPERIMENTAL warning (`save-rd-action.ts:24-25,107`), and Fill and Image layers are refused, not guessed (`rd-encoder.ts:69-70`).

### Output, profiles and recovery

- The default GRBL Dynamic (M4) output is safe from OR-1: GRBL scales M4 power by the current speed (`stepper.c:962`) and switches it off at an empty buffer (`stepper.c:397`), as do grblHAL (`stepper.c:570`) and FluidNC (`Stepper.cpp:238`). The zero-length-move sync applies to M3 only (`motion_control.c:72`). The old between-pass `M4 S0` cost only time.
- Every GRBL-family catalog profile's program (a cut with air, two passes, an image layer at full S) uses only G0, G1, G21, G54, G90, G94, M3, M4, M5, M8 and M9. The longest line is 31 characters against GRBL's 80 (`protocol.h:32`), the largest S equals the profile's S maximum, every G0 carries S0, and the 4040 uses no G0 at all.
- The GRBL-family resume preamble stops dark: `M5` comes before the air words and the re-entry move (`resume-program.ts:257-261`), so the planner syncs and any air on-delay run with the beam off.
- After the `G0` re-entry, the resume tail names the program's motion mode on the first line that relies on it (`laser-resume-reentry.ts:70-99`), so a compact raster tail does not run as G0.
- grblHAL reports `Bf` by default (`config.h:627-628`), so OR-3 did not affect stock grblHAL; with a backlog reported, the step-back is right to within the segment buffer.
- CNC dwell is seconds on GRBL (`motion_control.c:195`), grblHAL (`motion_control.c:853`) and FluidNC (`GCode.cpp:1804`), matching the CNC emitter's `G4 P<seconds>` (`cnc-grbl-transitions.ts:128`).
- The stock GRBL CNC recovery reserve of 32 lines (`cnc-resume-point.ts:39`) covers the 15 usable planner blocks (`planner.c:500`) plus the 6-segment buffer (`stepper.h:26`).
- No new CNC emitter defects beyond the 2026-09-24 CNC audit: modal state restated after M0, spindle start after a safe-Z retract, coolant after spin-up, G17 before arcs and `G4` in seconds hold on GRBL, grblHAL and FluidNC.
- The generic profiles' stock values match the source: Marlin S 0 to 255 and 250000 baud (`profile-catalog.ts:96,104`; Marlin `CUTTER_POWER_UNIT PWM255`, `Configuration_adv.h:3372`, and `BAUDRATE 250000`, `Configuration.h:117`); FluidNC S 0 to 255 (`profile-catalog.ts:76`; the default laser `speed_map` is 0 to 255, `LaserSpindle.cpp:27-28`).

### CNC on other controllers

- GRBL 1.1h reads `G4 P` in seconds (`motion_control.c:195`, `gcode.c:969`), pauses on `M0` (`gcode.c:250`), accepts `;` comments (`protocol.c:131-132`) and takes I/J as incremental (`gcode.c:192`). KerfDesk's CNC output uses exactly these.
- grblHAL and FluidNC v4.0.3 agree: dwell in seconds (`motion_control.c:853`; FluidNC multiplies P by 1000 into ms, `GCode.cpp:1804`), `M0` pause (`gcode.c:1815`; `GCode.cpp:630`), `;` comments (`protocol.c:114`; `GCode.cpp:184-185`).
- `cncJobs` is true for exactly the GRBL-family drivers, the Falcon wrapper included (`grbl/driver.ts:57`), and false for Marlin (`marlin/driver.ts:49`), Smoothieware (`smoothieware/driver.ts:46`) and Ruida (`ruida/driver.ts:31`).
- Machine Setup will not save a CNC setup on a controller that cannot run CNC jobs: "… cannot run KerfDesk CNC jobs. Choose a GRBL-family controller." (`device-setup-flow.ts:391-393`; Save disabled at `DeviceSetupShell.tsx:122,149`). This is a factual check, not a policy gate.
- The Start refusal (`assertActiveDriverAcceptsMachineKind`, `laser-start-program-assertions.ts:74-82`, called at `laser-job-actions.ts:220`) stays as defence in depth.
- The CNC Frame refusal on Marlin and Smoothieware was right in substance, since neither driver can build the retract; only its order and wording were wrong (CN-2).
- No CNC catalog preset makes a controller claim a source contradicts. Genmitsu 3018 (GRBL, the SainSmart manual), Genmitsu 4040 (GRBL), Shapeoko 3 and XXL (GRBL 1.1, the assembly guides) and LongMill MK2 (GRBL 1.1h or grblHAL: Sienci's specs, gSender and the grblHAL board list) match their sources. The Neotronics 4040 Max and both Onefinity presets are correctly `unqualified` (onefinity-firmware `setup.py:12`: "Buildbotics Machine Controller"). The X-Carve preset's GRBL claim is plausible, but its two sources cover work area and router use, not the controller.
- Loading a preset never changes the controller, and the preset says so (`DeviceSetupCncPreset.tsx:18-31,94-95`).

## How this was checked

Ten tracks each took one part of the controller layer: the GRBL protocol, GRBL streaming, grblHAL/FluidNC/Falcon, Marlin, Smoothieware, Ruida, the serial connection, controls across controllers, output and recovery, and CNC controllers. Each track read the KerfDesk code path and the firmware's own source at a pinned revision, and wrote a reproduction test for every defect it could reproduce. Each of those tests failed on the audited code; the one exception is CN-4's, which pins a fact rather than a defect. The brief and evidence bar are in `docs/audits/2026-09-25-controller-full-audit/method.md`, and the tracks' raw reports are in `docs/audits/2026-09-25-controller-full-audit/tracks/`.

I then re-checked every finding against the code and the upstream line myself, and dropped or merged what did not hold (`verification.md`). KerfDesk file and line numbers in the entries are at the audited commit, 39d7f96; upstream lines are at the pinned revisions above. The repository's controller simulators were part of the problem: each was more forgiving than its firmware and hid defects. The GRBL, Smoothieware and Marlin simulators now follow the firmware's source, with citations.

Checking the fixes against the source again for this report found gaps in four of them, and each entry includes the follow-up fix: grblHAL homes as silently as stock GRBL at its default settings (ST-4, ST-2), Marlin's new quick stop drops the planner a restart must step back over (OR-3), the Laser/CNC toggle and controller list still said nothing (CN-2), and the Marlin simulator planned one move too many (MA-11). grblHAL's error codes 18 and 19, which stock GRBL does not define, now get grblHAL's own text as well (`5dbbac0`).

Each fix landed with a regression test beside the code it covers. The reproduction tests were moved there or deleted, so none remains under `src/__audit_repro__/`. The full suite passes (__TEST_FILES__ files, __TESTS__ tests), and so does `pnpm release:check`.

### Limits

- No hardware was used. Every behaviour comes from firmware source, the simulators and code traces, not from a machine.
- Items marked plausible (HF-1, HF-7 and HF-8 on the Falcon; OR-4 on the xTool; RU-2's placement effect) depend on closed or vendor builds whose source is not public.
- The Ruida findings follow meerk40t's writer. No Ruida controller was available, and RU-2's User Origin mapping is not confirmed upstream.
- Smoothieware builds before `fdfa00d2` (1 Oct 2016) have no `G28.6`, so a Home on them is never confirmed. Builds before `971eb8cf` (15 Jun 2021) have no constant-power mode, and Job Review says so.
- The CNC research could not reach most vendor websites through the session's network proxy. The machine table marks which rows were read in the session and which were quoted by an earlier session.
- Two leads were not followed up. grblHAL keeps a G92 offset through a reset and a power cycle by default (`$384`, `config.h:882-894`; `gcode.h:722-726`), while KerfDesk assumes a reset clears it. Placement compensates any offset the controller reports, so the likely effect is an origin shown as unknown when grblHAL still holds it. And the CNC track's neutral note on every CNC export, for the PC and stand-alone controllers KerfDesk cannot detect, was not built.
