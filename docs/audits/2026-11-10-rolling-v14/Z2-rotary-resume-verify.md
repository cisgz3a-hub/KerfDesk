# Rolling audit v14 — Z2 Rotary resume verify

- **When:** 2026-11-11 +0800. **Tree:** origin/main @ `7d28c8e0e`, which holds #1697 (`522a72c92`, merged with #1698 as `81041133f`, landed on main at `74191e0c7`). No commit after `74191e0c7` touches the files below (`git log 74191e0c7..7d28c8e0e` on them is empty), and no open PR touches them.
  - Repros ran on the scratchpad export `j24-main` (`7d28c8e0e`, `node_modules` a junction) and on a mutable copy, `zz-z2\mut` (its own junction). The copy's only source changes are in two simulator fixtures (`grbl-sim-lines.ts`, `grbl-sim-backpressure.ts`): a jog takes its length over its feed, as GRBL times it, instead of a flat 400 ms. Product code is untouched.
- **Scope:** ADR-695 Amendment 1 (#1697) against v13 Y5-P1-1, Y5-P1-2, Y5-P1-4, Y5-P3-1 and Y5-P3-2.
  - Code read: `src/ui/laser/{abort-rotary-turn,abort-alarm-recovery,unrestored-abort-origin,start-blocked-setup-offers,AbortStoppedCard,rotary-axis-start-warnings,start-machine-snapshot,start-job-resume-stream,laser-resume-program,laser-recovery-flow,recovery-artifact-binding,frame-status-wait,use-job-shortcuts}.ts(x)`, `src/ui/state/{laser-job-stop,job-stop-request,laser-job-actions,work-origin-state,laser-connection-actions,laser-line-handler,laser-jog-actions}.ts`, `src/core/controllers/grbl/{resume-rotary,resume-program,status-parser,parse-settings}.ts`, `src/core/output/{rotary-surface-feed,rotary-axis-output}.ts`, `src/ui/laser/job-review/{rotary-surface-speed-warnings,job-review-model,job-review-gate}.ts`, `src/ui/remote-control/machine-execution.ts`, `src/core/devices/{rotary-axis,rotary-presets}.ts`, the GRBL simulator fixtures, and the Amendment itself.
- **Lenses run:**
  - **L10:** every Y5 number re-measured.
  - **L3:** A vs Z vs Y port; GRBL, grblHAL, the A1 Pro, FluidNC; Abort → re-run, Abort → Frame offer, Absolute with no Restore on offer, Start from line, lost-link recovery, a power-up between Abort and re-run, the phone and keyboard Abort; window vs worker.
  - **L12:** #1697 × #1698 in the same files.
- **Method:**
  - **Own controller model** (`zz-z2\lib.mts`): per-axis G92, `G53` machine moves, G90/G91, `$J=` jogs (moved, never lit), a stop half way through a line, G92 kept (grblHAL) or cleared (stock GRBL, FluidNC) at the Abort's reset, and a *physical* turn kept apart from the machine count, so a power-up can zero the count without moving the part.
  - **Real code:** `emitGcode`, `prepareOutput`, `buildLaserResumeProgram` (with the turn `abortRotaryZero()` would hand it), `detectRotarySurfaceSpeedWarnings` with snapshots from the real `settingsMapToControllerSettings` over the repo's `$$` dumps, and the real store functions `unrestoredAbortOrigin`, `abortTurnOfferNote`, `rotaryTurnSinceAbort`, `rotaryAxisStartWarnings` and `abortRotaryZero`.
  - **Own planner model** for the axis rate: GRBL caps a block so no axis passes its `$11x` rate, degrees counted as mm (planner.c `limit_value_by_axis_maximum`, as the v13 refuter cited it at tag v1.1h.20190825).
  - No hardware, no browser, no network beyond `gh` reads of PR and CI state.
- **Memory gates:** free RAM sat at 0.02–0.7 GB for most of the session (other sessions' processes). Node scripts ran at 0.4–0.7 GB. Vitest ran only through a script that waited for 1.6 GB free (run 1 started at 2.10 GB), one worker each time.
- **Simulator runs:** `zz-z2/mut/src/zz-z2/z2-rotary.simulator.test.tsx` drives the real store, Frame, the Frame offer, Abort, Restore, Job Review and Start against the grblHAL four-axis and stock GRBL simulators. It reconnects through `connectSimulator` for a power cycle (as `abort-origin-after-restart.simulator.test.tsx` does), and maps every burn to the physical turn with its own tracker.
  - Run 1 (`out/sim-run1/`): 8 scenarios with the simulator's flat 400 ms jogs, as the PR's own test.
  - Run 2: with a fixture change in the mutable copy only, so a jog (and each planner block) takes its own time, length over feed.
  - Run 3: the Absolute and Z scenarios again, with the failure captured.
- **Counts:** 4 raised → refuter pending → P1 1 / P2 1 / P3 2 (+ 5 Y5 items re-checked).

## Headline

**#1697 fixes the Abort re-run and Start from line on A and Z, measured to 0.00 mm, and its axis-rate warning is exact. One route still spoils the glass: a power-up or reconnect between the Abort and the re-run.**

- **Fixed (Y5-P1-1).** After ABORT JOB and Restore saved origin, the part is turned back to the job's start turn and the re-run lands **0.00 mm** from the first burn. This holds on the A1 Pro (A), with Reverse, on a design over 1.5 turns, on the A1 Pro's Z fallback, on FluidNC (A) and on stock GRBL (Z). v13 measured 66–84 mm.
- **Fixed (Y5-P1-2).** Start from line now sends `G53 G0 A<start>`, `G92 A0` and `G0 A<line's turn> S0` before the X re-entry. The first resumed stroke and the whole tail land **0.00 mm** off, from the stopped line, the shape's start and the previous shape, with and without Restore, on firmware that keeps G92 and on firmware that clears it. v13: 22–174 mm. Lost-link recovery and a restart are refused with a clear message, as the Amendment says.
- **Fixed on GRBL and grblHAL (Y5-P1-4).** `$112`/`$113` are read, and Job Review warns with the right axis letter, setting and unit.
  - Its dose figure matches my planner model to the per cent: 107/215/430 % on the A1 Pro's Z fallback, 159 % on GRBL Z at `$112`=600, 119/239 % on A at `$113`=3600.
  - The speed it names burns at 100.0 %.
  - A 0° fill and the A1 Pro's own A (`$113`=36000) stay silent, correctly.
  - It is silent when `$$` was never read; FluidNC's rate is announced as not read.
- **Not fixed (Z2-P1-1).** If the controller powers up, or the link is reopened, between the Abort and the re-run, the stop request keeps the start turn in the *old* machine count.
  - With homing on, the Frame offer homes X/Y (never the rotary) and then "turns the part back" by the stale count. Start from line seeks the stale count with `G53`.
  - The re-run lands **68–240 mm** round the part from the first burn, and the offer says it turned the part back.
  - Without homing, Job Review tells the operator to turn the part the wrong way.
  - v13's figure for the same route was 66 mm. The X/Y twin already refuses a stale origin (ADR-341 Amd 13).
- **Smaller.**
  - The turn-back waits only 3 s for the rotary to finish (Z2-P2-1, READ). At the 1500 °/min turn-back feed, any turn-back over about 70° is reported as a failed Restore ("Check the part") while the jog finishes on its own.
  - The Restore button's tooltip and the Frame offer's OK line still say nothing moves (Z2-P3-1).
  - On a Z rotary the first Frame after the part turns is refused as "setup changed during Frame", by its own `G92 Z0`; Frame again works (Z2-P3-2, from #1671).

## Before and after

v13 figures are from Y5 and its refuter (`8493f590c` / `144e45d76`); "now" is `7d28c8e0e`. Ø60 part unless noted; "surface mm" is distance round the part.

| v13 measurement | v13 | Now (`7d28c8e0e`) | Source |
|---|---|---|---|
| Re-run after Abort + Restore, A1 Pro A | 84.00 mm (auditor, simulator), 66.00 mm (refuter) | **0.00 mm**. The turn-back jog is −93.6° to −344.0° across the cases, laser off, `$J=G91 G21 A… F1500` | `out/n1-resume.txt` |
| Same, FluidNC A / GRBL Z | 66.00 mm | **0.00 mm** (turn-back −126.1° / −14.0 mm of Z) | same |
| Same, Y port (control) | 0.00 mm | 0.00 mm; no start turn is recorded on Y | same |
| Start from line, A1 Pro A, first resumed stroke | 60.0 mm streak (auditor), 22.0 mm from the previous shape (refuter) | **0.00 mm** at start and end; tail 0.00 mm; from the stopped line, the shape's start and the previous shape | same |
| Start from line, FluidNC A / GRBL Z, whole tail | 19.37 / 174.36 mm | **0.00 mm**: the `G53` re-entry re-zeroes the turn after the reset cleared G92 | same |
| Lost-link recovery / restart on A or Z | resumed at the wrong turn | **refused**: "KerfDesk does not know the turn the job started from … Run the job again from its start." The Y port still resumes | same |
| Absolute placement, no Restore on offer | no warning | Job Review warns with the turn and the jog back (D3); text read from the real function | READ, `out/n3-powerup-state.txt` |
| `$112`=2000, A1 Pro Z fallback, line 1500 / line 3000 / fill 6000 | 107.4 / 214.9 / 429.7 %, no warning | same doses, **warned** "up to 107 / 215 / 430 %"; the named 1396 mm/min burns at 100.0 % | `out/n2-axisrate.txt` |
| Stock GRBL Z, `$112`=600, fill 90° at 6000 | (refuter: 191 % at `$112`=500) | 159.2 %, **warned** 159 %; the named 3769 mm/min → 100.1 % | same |
| grblHAL A, `$113`=3600, Max feed 6000, line 3000 / fill 90° 6000 | not measured | 119.4 / 238.7 %, **warned** 119 / 239 % ("A axis … $113=3600 °/min"); the named 2513 → 100.0 % | same |
| `$$` never read (settings null) | — | 430 % on the A1 Pro Z fallback, **no warning** | same |
| Y5-P3-1: "turns Y ×11.46 … mm/min of Y feed" on A; a 0° fill warned | yes | The Max-feed warning names no axis; a 0° fill gives no warning on A or Z | same |
| Y5-P3-2: A1 Pro note "3200-step" | 8.9 × 360 = 3,204 | The note now says 3204 steps and asks for a ten-turn seam check (`rotary-presets.ts:57`) | READ |
| Power-up between Abort and re-run (not in v13) | (implied 66.0 mm: no turn-back) | **68.4–240.4 mm** on my model; **135.4 mm** in the simulator through the real Frame offer, which says it turned the part back: Z2-P1-1 | `out/n1-resume.txt`, `out/n3-powerup-state.txt`, `out/sim-run1/z2-sim-A-powercycle-*.json` |
| Restore with a real-time turn-back (221.5°, 8.9 s at 1500 °/min) | — | reported **failed** after 3.26 s, "The rotary did not finish turning back. Check the part."; the jog then finished and the re-run zeroed the right turn: Z2-P2-1 | `out/z2-sim-A-restore.json` |
| Simulator re-run after Restore (card) or the Frame offer, A (real store) | 84.00 mm (v13 auditor) | both turn the part back 221.5° (`$J=G91 G21 A-221.544 F1500`); the re-run's `G92 A0` lands on machine 37.000°, the first run's own zero: 0.00 mm. Start from line's first six burns 0.00 mm. Y control: Restore puts Y back (`G92 X20.000 Y24.616`), no start turn recorded, resume 0.00 mm | `out/sim-run1/z2-sim-{A-restore,A-frame-offer,Y-restore}.json` |

## Findings

### Z2-P1-1 — After a power-up or reconnect between the Abort and the re-run, the held start turn is in the old machine count: the Frame offer turns the part to a wrong turn and says it turned it back, Start from line seeks the wrong turn, and Job Review advises the wrong jog. The re-run lands 68–240 mm round the part

- **Where (`7d28c8e0e`):**
  - `src/ui/state/laser-job-stop.ts:478-489` (`rotaryStartTurnAtStop`) records the start turn as a machine count, with no `machineZeroEpoch` beside it. The X/Y origin recorded next to it carries `originMachineZeroEpoch` (`:391`).
  - `src/ui/laser/unrestored-abort-origin.ts:61-67` passes `turn` whether or not `machineZeroMoved`.
  - `src/ui/laser/start-blocked-setup-offers.ts:77-79` then offers the restore whenever homing is on. `restoreAbortOriginFromIdle` (`abort-alarm-recovery.ts:51-59`) homes, restores X/Y, and calls `turnRotaryBackToJobStart` (`abort-rotary-turn.ts:71-90`) with the stale count. Homing never measures the rotary.
  - `src/ui/laser/unrestored-abort-origin.ts:174-184` (`abortTurnOfferNote`) and `src/ui/laser/rotary-axis-start-warnings.ts:54-73` (`abortTurnWarning`) compute "turned since" from the stale count.
  - `src/ui/laser/start-job-resume-stream.ts:166` hands `abortRotaryZero()` to the resume, and `src/core/controllers/grbl/resume-rotary.ts:43-47` writes `G53 G0 A<stale>`.
  - KerfDesk already knows machine zero may have moved: `laser-connection-actions.ts:233` (every connect) and `laser-line-handler.ts:439` (a banner KerfDesk did not cause) bump `machineZeroEpoch`.
- **Anchor:**
  - **Contract:** ADR-695 Amendment 1 D2: Restore and the Frame offer "jog the rotary back to that turn", so the re-run zeroes "the turn the first run used". The card says so: "so a re-run lands on the half-burned part" (`AbortStoppedCard.tsx:228-230`).
  - **Twin:** ADR-341 Amendment 13 (v12 X1-P1-1, P1). After machine zero may have moved, the saved X/Y origin is not put back without homing, and the prompt says why. The rotary is never homed, so by the same rule its turn cannot be put back at all.
  - The Amendment's own Consequence ("Where it is lost, the turn shown is wrong too, and the operator must line the part up by eye") never reaches the operator. Here the app says the opposite.
- **Scenario:** the A1 Pro with the A preset, an Ø60 glass, homing on. The job starts at machine turn 37°; ABORT JOB stops it at 163.05° (66 mm round the part burned).
  1. The operator switches the laser off and on, or unplugs and replugs USB on a board that resets when its port opens. KerfDesk reconnects; A now reads 0 where the part stopped.
  2. Frame → "needs a custom work origin" → the offer: "On the rotary, the part has turned −37.0° since the job started. OK also turns it back to where the job started."
  3. OK homes X/Y, restores X/Y and jogs A **+37°**. The part is now 200° from where the job began; it should have gone back 126°.
  4. The re-run's `G92 A0` zeroes there. Every burn lands **85.4 mm** round the glass from the first run. Nothing warns: Job Review sees "turned 0°".
  - Without homing, the offer is Set origin here (no jog), and Job Review says "the part has turned −37.0° … turn the part +37.0° with the rotary turn buttons first". Following that advice lands the re-run 163° (85.4 mm) off; ignoring it, 126° (66 mm) off.
  - Start from line after the power-up sends `G53 G0 A37.000`, `G92 A0`: the whole tail lands 85.4 mm off.
- **Evidence:**
  - **REPRO, real functions:** `zz-z2/n3-powerup-state.mts` → `out/n3-powerup-state.txt`. The store holds the Abort's stop request (start turn 37, `originMachineZeroEpoch` 0), `machineZeroEpoch` 1, and A reported at 0.
    - `unrestoredAbortOrigin` → `{"machineZeroMoved":true,"turn":{"axis":"A","machine":37}}`.
    - The offer note: "the part has turned −37.0° since the job started. OK also turns it back".
    - Job Review: "turn the part +37.0° with the rotary turn buttons first".
    - `abortRotaryZero()` → 37. The turn-back would jog +37.0°; the right jog is −126.1°.
  - **REPRO, real emit and resume, own controller model:** `zz-z2/n1-resume.mts` → `out/n1-resume.txt`, route R3 (power-up; Home X/Y; Restore with the held turn; then the re-run or Start from line):

    | Setup | Turn at stop (old count) | Re-run and Start from line: every burn off by | Same route without a turn-back (v13 behaviour) |
    |---|---|---|---|
    | A1 Pro A, 360° | 163.05° | **85.37 mm** | 66.0 mm |
    | A1 Pro A, Reverse | 130.58° | **68.37 mm** | 49.0 mm |
    | A1 Pro A, design over 1.5 turns | 380.97° | **199.47 mm** | 180.1 mm |
    | A1 Pro Z fallback, 360/turn | 163.05 | **85.37 mm** | 66.0 mm |
    | FluidNC A | 163.05° | **85.37 mm** | 66.0 mm |
    | Stock GRBL Z, 40/turn | 51.01 | **240.36 mm** | 66.0 mm |

    The error equals the old machine count at the stop, not the turn since the job began, so it is larger than v13's in every case.
  - **REPRO, real store, Frame offer and simulator** (`out/sim-run1/z2-sim-A-powercycle-homing.json` and `…-nohoming.json`). grblHAL four-axis, Ø60, the part clamped at machine 37°, ABORT JOB at 258.54°, then a power cycle (`yankCable`, then `connectSimulator`):
    - After the reconnect: `machineZeroMoved: true`, the start turn 37 still held, "turned since" −37°.
    - Homing on: Frame → the offer "… On the rotary, the part has turned −37.0° since the job started. OK also turns it back to where the job started." OK leaves the part at **295.54°**. The re-run's `G92 A0` lands there: **258.5° = 135.4 mm** round the glass from the first burn. Job Review shows no turn warning (it computes 0°). Start from line's first six burns are 135.4 mm off.
    - Homing off: the offer is Set origin here (no jog). Job Review says "the part has turned −37.0° … turn the part +37.0° with the rotary turn buttons first". As it stands the re-run lands 221.5° = 116.0 mm off; following the advice, 135.4 mm. Start from line: 136.8 mm.
- **Severity:** P1.
  - **For:** wrong position on the glass, with no warning. The offer and the card claim the part was turned back. METHOD §3 has no reach clause. The twin X1-P1-1 was P1 for the same trigger on X/Y. KerfDesk already knows that machine zero moved, and uses it for X/Y.
  - **Against:**
    - It needs a power cycle or a port reopen between the Abort and the re-run.
    - The route was also wrong before #1697, by a smaller amount, so this is a gap in the fix plus a false claim rather than new physical behaviour.
    - Whether a real board resets A's count when its USB port reopens depends on the board (ESP32-class boards reset; native-USB boards may not). A power cycle always does.
- **Announced?** Partly. Amd 1 Consequences say a lost machine position makes the turn wrong. Nothing reaches the operator, and in this case the app knows.
- **Novelty:** new. It is the #1697 × ADR-341 Amd 13 interaction. No test covers a rotary turn after `machineZeroEpoch` moves.
- **Fix direction:**
  - Stamp `rotaryStartTurn` with `machineZeroEpoch`, as `originMachineZeroEpoch` is.
  - When it has moved: never jog the rotary back, never `G53` it in a resume (refuse Start from line, as for a lost link), and replace the Job Review and offer text with "the controller restarted, so KerfDesk no longer knows the part's turn; line the part up with the first burn by eye before you run again".
  - Add the reconnect case to `rotary-axis-abort.simulator.test.tsx`.
- **Refuter:** PENDING.

### Z2-P2-1 — The turn-back waits only 3 s for the rotary to stop: a turn-back over about 70° on A (or 75 mm of Z at 1500 mm/min) is reported as a failed Restore, "Check the part", while the jog finishes by itself

- **Where (`7d28c8e0e`):**
  - `src/ui/laser/abort-rotary-turn.ts:80-89`: the jog goes out at `TURN_BACK_FEED` 1500 (`:16`). Then `waitForControllerStatus` must see Idle with no motion operation, or the function throws "The rotary did not finish turning back. Check the part."
  - `src/ui/laser/frame-status-wait.ts:13`: `STATUS_WAIT_TIMEOUT_MS = 3_000`. That helper was written for a WCO status burst, not for waiting out motion.
  - `src/ui/state/laser-jog-actions.ts:179-201`: `jog()` resolves once the line is written, not when the motion ends.
  - The card shows the throw as the Restore's failure (`AbortStoppedCard.tsx:58-64`). The Frame offer returns `repairFailed('Restore saved origin failed', …)` (`unrestored-abort-origin.ts:155-157`), so the Frame does not run.
- **Anchor:** ADR-695 Amd 1 D2 (Restore turns the part back); METHOD L6 (the failure path tells the user the truth).
- **Scenario:** A1 Pro, A, ABORT JOB 160° into the job. Restore saved origin.
  - The jog needs 6.4 s at 25 °/s, plus acceleration. After 3 s the card reports "The rotary did not finish turning back. Check the part."
  - The part keeps turning and ends at the right turn.
  - An operator who now "checks the part" and turns it with the turn buttons, or presses Set origin here, moves it off again. Job Review's D3 warning would then report any turn left over.
  - On a Z rotary the turn-back is also held by `$112` (500–2000 mm/min on the repo's dumps): half a turn of a 40 mm chuck at `$112`=500 takes 2.4 s, a whole turn 4.8 s.
  - The turn-backs in the measured routes of `n1-resume.txt` were 93.6°–344.0° on A (3.7–13.8 s at 1500 °/min), so most Abort re-runs on A meet this.
- **Evidence:** REPRO, simulator run 2 (jogs timed by length over feed): `out/z2-sim-A-restore.json` and `out/z2-sim-A-frame-offer.json`. ABORT JOB at 258.54°, start turn 37°.
  - Card route (`restoreOriginAfterAbort`): it sends `G54 G21 G92 X20.000 Y0.000` and `$J=G91 G21 A-221.544 F1500`, then **throws after 3.26 s**: "The rotary did not finish turning back. Check the part." The jog finished 6.25 s later at 37°, and the re-run zeroed the right turn.
  - Frame-offer route: the same jog, then the offer returns failed and the Frame does not run (`frameOutcome: false`).
  - In run 1 (the simulator's flat 400 ms jog, as in the PR's own test) the same Restore resolved after 0.72 s, so the PR's test cannot see this (`grbl-sim-lines.ts:255-257`, `grbl-sim-backpressure.ts` retire timer, on `7d28c8e0e`).
  - The turn-backs in `n1-resume.txt` were 93.6°–344.0° on A (3.7–13.8 s at 1500 °/min).
- **Severity:** P2. A misleading result that an ordinary user meets on most Abort re-runs on A, and it invites a manual turn. Not P1: the physical turn-back completes, and Job Review's D3 warning reports a later manual turn before Start.
- **Announced?** No. **Novelty:** new (#1697).
- **Fix direction:** wait for the jog's own settlement (its motion operation ending), with a deadline from the jog length and feed (or `$113`/`$112`), instead of the 3 s status burst. Or say "turning the part back, about N s" and keep the card busy until Idle.
- **Refuter:** PENDING.

### Z2-P3-1 — Wording: on A/Z the Restore button's tooltip and the Frame offer's OK line still say nothing moves; the routing comment still says nothing reports the rotary's position

- **Where (`7d28c8e0e`):**
  - `src/ui/laser/AbortStoppedCard.tsx:145`: "Send $X, then write the job's origin back with one G92. The head does not move." The same click now jogs the rotary.
  - `src/ui/laser/unrestored-abort-origin.ts` (`unrestoredOriginOfferPrompt`), OK line: "put the saved origin back with one G92 (the head does not move)". The appended note then says "OK also turns it back".
  - `src/ui/laser/unrestored-abort-origin.ts:174-184` (`abortTurnOfferNote`): in simulator run 1 the in-session offer read "On the rotary, KerfDesk cannot read the rotary's A axis right now. OK also turns it back to where the job started." OK then jogged `A-221.544` (`out/sim-run1/z2-sim-A-frame-offer.json`). The prompt is built before a fresh status report arrives, so the operator is not told how far the part will turn.
  - `src/core/output/rotary-axis-output.ts:10-12`: "Nothing reports where a dedicated rotary stands". Amd 1's Context calls that premise false.
- **Anchor:** ADR-695 Amd 1 Context and D2.
- **Severity:** P3 (wording and a stale comment). The card's paragraph and the offer's note do say the rotary turns.
- **Fix direction:** name the rotary turn in the tooltip and in the OK line on A/Z; update the comment.
- **Refuter:** PENDING.

### Z2-P3-2 — On a Z rotary the first Frame after the part's turn changes never issues a Start permit: its own `G92 Z0` changes the Z work offset, and the permit check calls that "setup changed during Frame". Frame again works. A is not affected

- **Where (`7d28c8e0e`):**
  - `src/ui/state/rotary-axis-frame.ts:67`: every Frame on A or Z sends `G92 A0` / `G92 Z0` first.
  - `src/ui/state/framed-run.ts:247-249` (`framedRunCompletionIssue`) refuses the permit when the controller setup differs before and after the Frame; `:318-326` and `:413-416` (`sameAxes`) compare the WCO's X, Y and **Z**, never A. So the Frame's own zero changes Z's offset on a Z rotary and is ignored on A.
- **Anchor:** twin consistency (the A route gets a permit from the same Frame); ADR-695 D5 (Frame zeroes the turn "as the job will be"); PROJECT.md non-negotiable 21's message should name a real change.
- **Scenario:** stock GRBL, Z chuck. The part is turned (by the Abort's turn-back on GRBL, where the reset also cleared G92, or by hand between jobs). Frame traces the job, then says "Controller or machine setup changed during Frame. No Start permit was issued; review the setup and Frame again." Nothing changed but KerfDesk's own zero. A second Frame, at the same zero, gets the permit.
- **Evidence:** REPRO, simulator run 3, `out/z2-sim-Z-restore.json` (stock GRBL, Z chuck 40/turn, Ø60; Z jogged 37, origin set): the first Frame refused with that message, WCO Z 0 → 37; `runFrameNow()` again → `true`. The same harness on A got its permit on the first Frame in all six A scenarios.
- **Severity:** P3. No wrong output and the retry works, but every Z-rotary job after a turn change needs two Frames and gets a misleading message. **For P2:** an ordinary Z user meets it on most jobs, and the message blames the machine.
- **Announced?** No. **Novelty:** new; from #1671 (ADR-695), not #1697. No repo test frames a Z rotary (`rotary-axis.simulator.test.tsx`, `use-frame-action.rotary.test.ts` use A or Y).
- **Fix direction:** compare the WCO before the Frame with the Frame's own declared zero applied (as ADR-375 already does for a first WCO equal to the placed zero), or exclude the rotary axis from `sameAxes` when the Frame zeroed it.
- **Refuter:** PENDING.

## KNOWN: status of each Y5 item on `7d28c8e0e`

| ID | Was | Status | Evidence |
|---|---|---|---|
| Y5-P1-1 | Re-run after Abort lands 66–84 mm round the part on A/Z | **FIXED within one controller session**: 0.00 mm after Restore on A1 Pro A, Reverse, 1.5 turns, Z fallback, FluidNC A and GRBL Z; Absolute warns in Job Review. **Still wrong after a power-up or reconnect: Z2-P1-1.** The turn-back reports false failures: Z2-P2-1 | `n1-resume.txt`, `n3-powerup-state.txt` |
| Y5-P1-2 | Start from line re-enters X only; the tail is off where G92 clears | **FIXED** (0.00 mm on every in-session route); lost link and restart refused as D4 says. After a power-up the held turn is stale: Z2-P1-1 | `n1-resume.txt` |
| Y5-P1-4 | `$112`/`$113` never read | **FIXED on GRBL and grblHAL when `$$` was read**: the warning matches the planner model, names the right axis, setting and unit, and its speed burns at 100.0 %. Still silent when `$$` is unread (430 % on the Z fallback). FluidNC's rate is announced as not read (D5) | `n2-axisrate.txt` |
| Y5-P3-1 | "Y ×… mm/min of Y feed" on A; a 0° fill warned | **FIXED**: the Max-feed text names no axis, and a 0° fill is silent on A and Z. The roller summary's "(Y not scaled)" on an A roller (`rotary-summary.ts:29`) is unchanged | `n2-axisrate.txt`, READ |
| Y5-P3-2 | A1 Pro "3200-step" arithmetic | **FIXED** (wording; the hardware step count is still unverified, D13) | READ `rotary-presets.ts:57` |

Y5-P1-3, Y5-P2-1 and Y5-P2-2 belong to Z3 (#1698) and were not re-measured here. #1697's merge layers the axis-rate check onto #1698's per-move walk. Both warnings appear together when both bite: on `$113`=3600 a fill 90° at 6000 gets the Max-feed warning ("143 %", name 4188 mm/min) and the axis warning ("239 %", name 2513 mm/min). Only the axis warning's speed gives an even burn; the pair reads oddly but the true figure is shown.

## Refuted

Candidates dropped before raising:
- **"The turn-back unwinds many turns the long way."** It jogs `start − now` in machine units (−344° on the 1.5-turn design). On a chuck a whole number of turns is the same angle, so this costs time only (and feeds Z2-P2-1), never position.
- **"The turn-back goes the wrong way when Reverse is on."** Reverse mirrors only the program's values; the start turn and the turn-back are machine counts. Reverse measured 0.00 mm.
- **"A Y-port rotary gets a turn-back or a `G92 A0`."** `rotaryStartTurnAtStop` returns null when `rotaryOutputAxis` is null (Y port). The Y program has no `G92`, and the Y resume is unchanged (`G0 X20 Y14.006 S0`).
- **"`G92 A0` reaches a controller without A."** Unchanged from v13: emit refuses A on GRBL and Marlin, and Start and Frame refuse 3 reported axes. The resume's `G53 G0 A` follows only a program whose first code line is `G92 A0`.
- **"A phone or keyboard Abort records no start turn."** `stopJob()` with no reason maps to `'operator'` (`laser-job-actions.ts:122`), so the phone (`machine-execution.ts:89`) and Ctrl+. (`use-job-shortcuts.ts:95`) record it too.
- **"Worker streaming drops the A value."** Status lines are parsed on the main thread for both hosts (`core/controllers/grbl/response.ts`), and the stop reads `wcoCache` there before the hosted refill is released (`laser-job-stop.ts:346-372`).
- **"A stale WCO at an early Abort records the wrong start turn."** GRBL and grblHAL send WCO in the next report after a G92 change, and a job after a Frame or an earlier job zeroes the same turn. At most a sub-second window at the start of a job, before any turn.
- **"The resume mis-reads relative A words."** No emitted rotary program has G91 (0 lines in every case), and the resume's turn scan reads absolute words.

## Verified clean

- **Re-run and Start from line within one controller session** (L10, L3): A1 Pro A, Reverse, 1.5 turns, A1 Pro Z fallback, FluidNC A, stock GRBL Z and the Y control. 0.00 mm for the re-run after Restore, and for Start from line from three lines with and without Restore (`n1-resume.txt`).
- **Preamble order:** `G21, G90, G54, G94, M5, G53 G0 A37.000, G92 A0, G0 A93.583 S0, G0 X20 S0, M4 S0, F…`. The beam is off before any turn, and the turn comes before the X re-entry.
- **Refusal:** with no start turn (lost-link recovery, `laser-recovery-flow.ts:98-103`, or a restart), every A/Z resume is refused with a message that says why. The Y port still resumes.
- **Axis-rate warning** (L10, L2): five setups × four layer cases. The dose and the suggested speed match an independent planner model. The axis letter, setting and unit are right for A and Z. There is no warning on the Y port (whose rate is the Max feed) or on 0° fills (`n2-axisrate.txt`).
- **Phone and keyboard Abort** reach the same stop record (READ).
- **L12:** #1697's final head `81041133f` passed every CI check (unit shards 1–4, typecheck, Browser smoke, packaging gates). The #1698 merge inside #1697 is covered by `rotary-axis-rate-warnings.test.ts`.

## Not verified

- **Absolute placement in the simulator:** after ABORT JOB and Unlock, the stop request held the start turn (37°), but the store withheld the position ("Cleared stale position … evidence"), so `rotaryTurnSinceAbort` gave "cannot read" and the harness's re-run Frame was refused for reasons unrelated to the rotary. Job Review's D3 warning was therefore not observed in the simulator; by READ it shows its "cannot read where the rotary's A axis is … turn the part back" variant while the position is withheld (`rotary-axis-start-warnings.ts:58-62`). Start from line in that state: 0.00 mm (`out/z2-sim-A-absolute.json`).
- **The Z rotary re-run in the simulator** stopped at Z2-P3-2's refused first Frame; the Z re-run and resume figures are from my model (n1).
- **The re-run's burn-by-burn comparison in the simulator:** my tracker paired no burns from the re-run's captured lines (`shiftSurfaceMm` null in every JSON), so the simulator shift is read from where the re-run's own `G92 A0` landed (the same program from the same zero burns the same place). The burn-by-burn 0.00 mm figures are from my model (n1).
- **No hardware.** Whether a real grblHAL or FluidNC keeps A's machine count through the Abort's ALARM:3 reset, and which boards reset when their USB port reopens.
- **FluidNC `$$`:** whether its legacy `$$` lists `$112`/`$113`. If not, the axis-rate warning never fires on FluidNC (announced, D5).
- **`$13=1` (report inches) with an A axis:** `currentMachineTurn` scales Z but not A. grblHAL converts an A value to inches unless the axis is marked rotary; not traced.
- **A rotary that homes** (`$H` including A on some grblHAL builds) would re-zero A during "Home, then restore origin". Same class as Z2-P1-1; not tested.
- **Stops that are not the operator's** (the fail-dark stop at `laser-job-actions.ts:116`, controller alarms, an E-stop) record no start turn. A re-run after them on A/Z gets neither a turn-back nor a warning, as before #1697. Not reproduced; Amd 1 D1 scopes the fix to ABORT JOB.

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-z2\`. Run the Node scripts with `node --no-experimental-webstorage --import ./register.mjs <file>` from that folder; the loader is copied from `zz-y5r` and pointed at `j24-main`. Nothing in the repo was touched except this report.

| File | What it does |
|---|---|
| `register.mjs`, `ts-resolve.mjs` | TS loader |
| `lib.mts` | Own controller model (per-axis G92, G53, jogs, a stop part way, a power-up with a separate physical turn) and scene builders |
| `n1-resume.mts` → `out/n1-resume.txt` | Y5-P1-1, Y5-P1-2 and Z2-P1-1: 7 setups × routes R1–R4, re-run and Start from line, real emit and resume |
| `n2-axisrate.mts` → `out/n2-axisrate.txt` | Y5-P1-4 and Y5-P3-1: Job Review warnings against my planner model; suggested speeds re-emitted and re-measured |
| `n3-powerup-state.mts` → `out/n3-powerup-state.txt` | Z2-P1-1: the real Amd 1 functions after a power-up |
| `mut/src/zz-z2/z2-rotary.simulator.test.tsx` → run 1 `out/sim-run1/*.json` + `vt-z2-sim.txt`; run 2 (timed jogs) `out/z2-sim-A-restore.json`, `z2-sim-A-frame-offer.json` + `vt-z2-sim2.txt`; run 3 `out/z2-sim-A-absolute.json`, `z2-sim-Z-restore.json` + `vt-z2-sim3.txt` | Real store, Frame, Frame offer, Abort, Restore, Job Review, Start and the GRBL simulators: Restore, Frame offer, Absolute, power cycle with and without homing, GRBL Z, Y control. Runs 2–3 use the timed-jog change in `mut/src/__fixtures__/controllers/grbl-sim-lines.ts` and `grbl-sim-backpressure.ts` (marked `Z2 MUTATION`). Run from `zz-z2\mut` with `node node_modules\vitest\vitest.mjs run src/zz-z2/z2-rotary.simulator.test.tsx --maxWorkers=1` and `NODE_OPTIONS=--no-experimental-webstorage`. `mut\node_modules` is a junction: remove it only with `cmd /c rmdir` |

No security finding was raised, so there is no `SECURITY-DETAILS.md`.

```json
[
  {"id":"Z2-P1-1","severity":"P1","area":"rotary-resume-verify","file":"src/ui/state/laser-job-stop.ts","line":478,"anchor":"Contract ADR-695 Amd 1 D2 (Restore and the Frame offer turn the part back so the re-run lands on the half-burned part); twin ADR-341 Amd 13 (machineZeroEpoch voids a saved origin)","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"After a power-up or reconnect between Abort and re-run, the held start turn is in the old machine count: the Frame offer (homing) jogs A +37° instead of -126°, Start from line G53-seeks the stale turn, Job Review advises the wrong jog; the re-run lands 68-240 mm off (85.4 mm on the A1 Pro) and the offer claims the part was turned back"},
  {"id":"Z2-P2-1","severity":"P2","area":"rotary-resume-verify","file":"src/ui/laser/abort-rotary-turn.ts","line":83,"anchor":"Contract ADR-695 Amd 1 D2; METHOD L6 truthful failure path","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"The turn-back waits only the 3 s status burst (frame-status-wait.ts:13) for Idle; at 1500 °/min any turn-back over about 70° (measured routes 94-344°) throws 'did not finish turning back. Check the part.' while the jog completes; the PR's simulator test passes on flat 400 ms jogs"},
  {"id":"Z2-P3-2","severity":"P3","area":"rotary-resume-verify","file":"src/ui/state/framed-run.ts","line":413,"anchor":"Twin: the A Frame gets a permit; ADR-695 D5 Frame zeroes the turn as the job will","evidence":"REPRO","verdict":"PENDING","known":false,"summary":"On a Z rotary the Frame's own G92 Z0 changes WCO Z, so the permit check refuses 'setup changed during Frame' on the first Frame after any turn change; Frame again works; A is not compared"},
  {"id":"Z2-P3-1","severity":"P3","area":"rotary-resume-verify","file":"src/ui/laser/AbortStoppedCard.tsx","line":145,"anchor":"ADR-695 Amd 1 Context and D2","evidence":"READ","verdict":"PENDING","known":false,"summary":"The Restore tooltip and the Frame offer's OK line say nothing moves while the rotary is jogged; rotary-axis-output.ts:10 still says nothing reports the rotary's position"}
]
```

Auditor counts: raised 4, P1 1, P2 1, P3 2, known 5

## Refuter (2026-11-11)

- **Tree:** the scratchpad export `j24-main` (origin/main @ `7d28c8e0e`), read only. No mutable copy and no simulator run were needed.
- **Harness:** my own, in `...\scratchpad\zz-z2r\`. Only the TS loader (`register.mjs`, `ts-resolve.mjs`) is copied from `zz-z2`; no `zz-z2` script, model or simulator test was reused.
  - **Method:**
    - r1 drives the real store's own status patch (`statusPositionPatch`) through a power-up in two firmware variants, then calls the real Amd 1 functions. It models the physical turn by arithmetic, with whole turns removed.
    - r2 runs the real `turnRotaryBackToJobStart` and `waitForControllerStatus` on the real clock, against a stub jog that takes length over feed.
    - r3 runs the real `framedRunCompletionIssue` on hand-built before and after snapshots.
    - r4 runs the real `buildLaserResumeProgram` as the recovery flow calls it and as manual Start from line calls it.
    - I also read the firmware source cached in the scratchpad (`grbl-src/main.c`, gnea GRBL 1.1).
- **Memory:** free RAM was 1.9 GB at the start. Each Node script used under 0.6 GB. Vitest and the browser were not used.

### Verdicts

**Z2-P1-1: CONFIRMED P1. Two corrections: the route that is actually reached on the A1 Pro, and the size of the error.**

- **The defect holds (REPRO r1, `out/r1-powerup.txt`).** After a power-up, the store still holds the stop request: start turn 37, `originMachineZeroEpoch` 0, `machineZeroEpoch` 1.
  - `unrestoredAbortOrigin` returns `machineZeroMoved: true` with the stale turn, and `rotaryTurnSinceAbort` gives −37°. The truth is +126.051°.
  - Job Review says "turn the part +37.0° with the rotary turn buttons first".
  - Start from line builds `G53 G0 A37.000`, `G92 A0`, `G0 A90.000 S0`.
  - `jobStopRequest` is written only at `laser-job-stop.ts:208/317/354` and is matched only by `streamerEpoch` (`job-stop-request.ts:43-49`). `connectingStatePatch` (`laser-connection-actions.ts:226-260`) bumps `machineZeroEpoch` and leaves the stop request alone, so the stale turn survives any reconnect until the next stream.
- **Firmware semantics (READ).** `grbl-src/main.c:47` clears `sys_position` only at power-up. The reset loop's `memset(&sys…)` at `:75` does not touch `sys_position`, which is a separate global (`:27`).
  - So stock GRBL keeps the Z count through the Abort's 0x18, as Amd 1 assumes. It loses the count at power-up, as the finding assumes.
  - grblHAL source is not cached here; see Not verified.
- **Correction 1: the route reached on the A1 Pro.** The auditor's simulator power cycle (`yankCable` and then a fresh `connectSimulator`, `z2-rotary.simulator.test.tsx:249-251`) boots with no stored offsets. That models stock GRBL, FluidNC or grblHAL with `$384=1`.
  - The A1 Pro dump says `$384=0` (`falcon-a1-pro-dump.ts:131`). grblHAL then restores G92 at power-up (`grbl-simulator.ts:94-96,321`; `laser-recovery-origin.ts` `SET_ORIGIN_LIFETIME`).
  - r1 V2: the first report after power-up, with WCO X20 Y30 A37, makes the real `statusPositionPatch` set `workOriginActive=true`. So Frame never says "needs a custom work origin", and **the Frame offer, with its homing and wrong +37° jog, does not appear**.
  - The routes actually reached are Job Review's wrong advice (+37°) and Start from line's `G53 G0 A37`. Both are wrong output, so the severity is unchanged.
  - The auditor's Frame-offer route (V1) is real on stock GRBL Z, on FluidNC A, and on grblHAL with `$384=1`.
- **Correction 2: the size of the error.** On a chuck, whole turns of the part do not show, which the auditor's own Refuted list says. The figures "68–240 mm", 199.47 mm, 240.36 mm and the simulator's 135.4 mm are unwrapped. The error the short way round, on Ø60 (r1 table):
  - A1 Pro A, stop at 163.05°: **85.4 mm** (the auditor's figure stands). The same holds for the Z fallback and for FluidNC.
  - Reverse, stop at 130.58°: 68.4 mm.
  - Design over 1.5 turns, stop at 380.97°: **11.0 mm**, not 199.5 mm.
  - Stock GRBL Z at 40 per turn, stop at Z 51.01: **51.9 mm**, not 240.4 mm.
  - The simulator stop at 258.54°: **53.1 mm**, not 135.4 mm. In that case, ignoring the advice gives 72.5 mm, not 116.0 mm.
  - So the range is about **11–94 mm**, and the error is **not** "larger than v13's in every case". On GRBL Z it is 51.9 mm against 66.0 mm, and at the simulator stop it is 53.1 mm against 72.5 mm.
  - The error is still a full stroke's width or more round the glass in every case but the multi-turn one.
- **Severity:** P1 stands.
  - The position is wrong.
  - The one message the operator sees is the wrong one: the offer's "OK also turns it back", or Job Review's "+37°".
  - METHOD §3 gives reach no say, and no message stops the operator first. The V1 offer even says "The controller has restarted since then" and then promises the turn-back anyway.
- **Real-world reach:** moderate. A power-up between an Abort and the re-run is plausible: switching the machine off to fix focus or check the glass, or clearing ALARM:3 by power-cycling. A USB replug or a Windows sleep resets ESP32 boards and Arduino-class boards. An operator who re-seats the glass moots the turn either way.

**Z2-P2-1: CONFIRMED P2 (REPRO r2, `out/r2-turnback-timing.txt`).** The real `turnRotaryBackToJobStart` against a jog that takes |Δ|/25 °/s (A1 Pro `$123=1000`):

| Turned since start | Result |
|---|---|
| 30°, 60°, 70° | resolves |
| 75° (3.02 s) | **throws** "The rotary did not finish turning back. Check the part." at 3.01 s |
| 80° | throws |
| 126.05° | throws |
| 221.54° | throws |

- In every case the part then ends at machine A 37.000. The threshold is about 74°, so the auditor's "over about 70°" holds.
- **Not P1:** the physical turn completes, and a later manual turn is caught by D3.
- **Not P3:** most aborted wraps are past 74°, and the message invites the operator to move a part that is already correct.

**Z2-P3-1: CONFIRMED P3 (READ).**
- `AbortStoppedCard.tsx:144-145`: both tooltips name only the head. `:235` says "without moving the head".
- `unrestored-abort-origin.ts:127-128`: the OK line says "(the head does not move)".
- `rotary-axis-output.ts:10-12` still says "Nothing reports where a dedicated rotary stands", which Amd 1's Context calls false.
- The card's paragraph does add `ROTARY_TURN_BACK_NOTE`, so P3.

**Z2-P3-2: CONFIRMED; severity changed P3 → P2 (REPRO r3, `out/r3-z-frame-permit.txt`).** The real `framedRunCompletionIssue` on the snapshots around a rotary Frame:

| Case | Result |
|---|---|
| Z rotary, part turned (offset 0 → 37) | "Controller or machine setup changed during Frame. No Start permit was issued…" |
| Z rotary, part turned 5 mm of Z with the buttons after an earlier Frame (37 → 42) | the same refusal |
| Z rotary, Frame again at the same turn | permit |
| A rotary, either case | permit |

- The cause is `sameAxes` comparing `z` (`framed-run.ts:413-416`) inside `sameControllerSetup` (`:282-300`).
- On a Z rotary the turn changes every time the operator aims the design with the turn buttons, and after any job that does not end at turn 0. So an ordinary Z-rotary user meets the refusal on most jobs. The refusal blames a setup change that was KerfDesk's own `G92 Z0`.
- That is METHOD's P2: wrong behaviour an ordinary user hits, with a misleading result. There is still no wrong output, so it is not P1.
- The origin is #1671 (ADR-695), not #1697, as the auditor says.

### KNOWN and "Verified clean"

| ID | Auditor | Refuter |
|---|---|---|
| Y5-P1-1 | FIXED within a session | **Agree.** r2: the turn-back jogs `{da: −Δ}` and the part ends at the start count. The finding stays open through Z2-P1-1 and Z2-P2-1 |
| Y5-P1-2 | FIXED | **Agree.** r4: manual Start from line gives `M5, G53 G0 A37.000, G92 A0, G0 A10.000 S0` before the X re-entry. See Z2-P3-3 for the recovery route, which refuses rather than misplaces |
| Y5-P1-4 | FIXED when `$$` was read | **Agree.** I re-derived the auditor's doses by hand: 360/(π·80) = 1.432 °/mm; 3000 × 1.432 / 3600 = 119.4 %; 6000 × 40/(π·80) / 600 = 159.2 %; 2513 × 1.432 = 3600. The figures imply an Ø80 part in `n2`, not Ø60. "`$$` unread" is rare, because the connect handshake queries settings (`laser-controller-handshake.ts:175-204`) |
| Y5-P3-1 | FIXED | **Agree** (READ). "(Y not scaled)" is still in `rotary-summary.ts:29`, as noted |
| Y5-P3-2 | FIXED | **Agree** (READ, `rotary-presets.ts:57`) |

- **Verified clean, phone and keyboard Abort:** agree.
  - `laser-job-actions.ts:122` maps a missing reason to `'operator'`.
  - Every GRBL-family Abort goes through `stopWithOwnedReset` (`laser-job-stop.ts:294`, then `:342-375`), which records `rotaryStartTurn`.
  - The `:208` and `:317` records carry no turn, but they are the no-reset and non-GRBL paths, which cannot drive A.
  - The phone's Frame runs with `interactiveSetup: false` (`machine-execution.ts:156`), so the phone never sees the Frame offer. The phone's Start goes through the same Job Review warnings.
- **Verified clean, the refusal:** agree that a lost-link or restart resume is refused. But the recovery route refuses even after ABORT JOB, while it still holds the turn (Z2-P3-3).
- **Not challenged:** the "Refuted" list. Reverse, the Y port and the multi-turn unwind were checked by READ, and r1 agrees: the error is independent of Reverse.

### New finding

#### Z2-P3-3: After ABORT JOB on A or Z, the interrupted job's Review recovery is a dead end that contradicts itself. Its Restore saved origin does not turn the part back, and its Start is refused with a message saying ABORT JOB keeps the turn

- **Where (`7d28c8e0e`):**
  - `src/ui/laser/laser-recovery-flow.ts:98-103` calls `buildLaserResumeProgram(…, LASER_RESUME_TRANSFORM_VERSION)` with no `rotaryZero`, so every A/Z recovery is refused (`resume-rotary.ts:39-41`). This happens even while `abortRotaryZero()` still returns the turn.
  - `src/ui/laser/CheckpointResumeBanner.tsx:150` → `LaserRecoveryPlacement.tsx:241-295`: the Review's Restore saved origin is `restoreWorkOrigin(saved)` only, with no `turn`. It has the same name as the card's Restore, which does turn the part.
  - `src/ui/laser/rotary-axis-start-warnings.ts:71`: D3 says "Use Restore saved origin, or turn the part …".
  - `abort-alarm-recovery.ts:19-22` and `laser-recovery-origin.ts:66` send the operator to "Restore saved origin in the interrupted job's Review".
- **Anchor:**
  - ADR-695 Amd 1 D4: Start from line re-enters the turn, and is refused only "without the start turn".
  - D2: Restore turns the part back.
  - Twin consistency: two buttons named "Restore saved origin" behave differently on A/Z.
  - METHOD L6: a failure path must say the truth.
- **Evidence:** REPRO r4 (`out/r4-recovery-route.txt`).
  - With the stop request holding `{axis A, machine 37}`, the recovery call returns `error`: "…KerfDesk keeps that turn when you stop a job with ABORT JOB; after a lost link or a restart it is gone. Run the job again from its start."
  - The same G-code through manual Start from line gives `ok` with `G53 G0 A37.000`.
  - READ for the Review's Restore.
- **Scenario:** grblHAL (A1 Pro), which keeps G92 through the Abort's reset.
  1. The card is shown. The operator presses `$X — Unlock`, or clears the alarm from the rail. The card goes, and the origin stays active, so Frame makes no offer.
  2. Job Review says "the part has turned +126.1° … Use Restore saved origin, or turn the part −126.1°".
  3. The only Restore saved origin left is in the job's Review recovery. It writes G92 X/Y and leaves the part where it is. Its Start from line is refused with the message above, which says the turn was kept.
- **Severity:** P3. There is no wrong output: D3 still warns after that Restore, because the turn is unchanged, and the recovery refuses rather than misplaces. The advice and the refusal text contradict what the app holds, and the working route (the turn buttons, or the manual Start from line) is not named.
- **Announced?** No. Amd 1 names only the card and the Frame offer for D2, and says the recovery refusal covers "lost-link recovery and a restart".
- **Novelty:** new (#1697).
- **Fix direction:**
  - Pass `abortRotaryZero()` into the recovery's `buildLaserResumeProgram` when the capsule's stop was this stream's operator Abort.
  - Give the Review's Restore the same turn-back as the card.
  - Or word D3's advice as "turn the part … with the rotary turn buttons", and drop "Use Restore saved origin" when no turn-back Restore is on offer.

### Not verified

- **grblHAL and FluidNC through the Abort's reset:** whether they keep A's machine count. grblHAL core and FluidNC sources are not cached in the scratchpad, and no download was allowed. Stock GRBL keeps it (READ above).
- **Lost steps:** a reset during motion kills the step pulses (ALARM:3). A heavy part may then overrun, so the kept count can differ from the physical turn by any lost steps. The X/Y origin has the same limit.
- **Simulator `$384=0` power-up:** the repo simulator persists G92 only as `SimVec3` (X/Y/Z), and boots `aAxis.g92` at 0 (`grbl-simulator.ts:315-335`). It cannot model a persisted A offset. V2 rests on the real `statusPositionPatch` with a hand-made first report.
- **`$376=0` on the A1 Pro** (`falcon-a1-pro-dump.ts:130`): A is not marked rotary. With `$13=1`, grblHAL may report A in inches. Not traced.
- **Homing that includes the rotary:** stock GRBL's default `HOMING_CYCLE_0` is Z. On a Z rotary with homing on, "Home, then restore origin" may turn the part, or alarm. This is the same class as the auditor's "A rotary that homes". Not tested.
- **Taper (#1670) and #1698 surface feed against the turn-back:** both act on emitted moves, and the turn-back is a machine-count jog, so no interaction is expected. Not run.

### Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-z2r\`. Run each from that folder with `node --no-experimental-webstorage --import ./register.mjs <file>`.

| File | What |
|---|---|
| `r1-powerup.mts` → `out/r1-powerup.txt` | Z2-P1-1: real `statusPositionPatch` power-up in V1 (G92 cleared) and V2 (grblHAL `$384=0`); real offer note, D3 text and Start from line preamble; mod-turn error table |
| `r2-turnback-timing.mts` → `out/r2-turnback-timing.txt` | Z2-P2-1: real turn-back against a timed stub jog, from 30° to 221.5° |
| `r3-z-frame-permit.mts` → `out/r3-z-frame-permit.txt` | Z2-P3-2: real `framedRunCompletionIssue`, Z against A |
| `r4-recovery-route.mts` → `out/r4-recovery-route.txt` | Z2-P3-3: recovery resume against manual Start from line with the turn held |

```json
[
  {"id":"Z2-P1-1","severity":"P1","verdict":"CONFIRMED","evidence":"REPRO+READ","note":"On the A1 Pro ($384=0) G92 incl. A is restored at power-up, so the Frame offer does not fire; the wrong D3 advice (+37°) and Start from line's G53 A37 are the routes reached. The offer route is real on stock GRBL Z, FluidNC and grblHAL $384=1. Errors mod one turn: 11–94 mm (85.4 mm A1 Pro case; 1.5 turns 11.0, GRBL Z 51.9, sim 53.1), not 68–240 mm, and not larger than v13 in every case"},
  {"id":"Z2-P2-1","severity":"P2","verdict":"CONFIRMED","evidence":"REPRO","note":"real turnRotaryBackToJobStart throws at 3.0 s for any turn-back ≥ 75° at F1500; the part still ends at the start turn"},
  {"id":"Z2-P3-1","severity":"P3","verdict":"CONFIRMED","evidence":"READ"},
  {"id":"Z2-P3-2","severity":"P2","verdict":"SEVERITY CHANGED P3->P2","evidence":"REPRO","note":"real framedRunCompletionIssue refuses every Z-rotary Frame after a turn change (manual aim or a job not ending at turn 0); A gets a permit; ordinary Z user, misleading message"},
  {"id":"Z2-P3-3","severity":"P3","area":"rotary-resume-verify","file":"src/ui/laser/laser-recovery-flow.ts","line":98,"anchor":"ADR-695 Amd 1 D2/D4; twin: two Restore saved origin buttons; METHOD L6","evidence":"REPRO","verdict":"NEW","known":false,"summary":"After ABORT JOB on A/Z the job's Review recovery refuses every resume with text saying ABORT JOB keeps the turn (it does; abortRotaryZero is set), and its Restore saved origin writes G92 X/Y without turning the part, though D3 tells the operator to use Restore saved origin"}
]
```

Refuter counts: raised 5, refuted 0, P1 1, P2 2, P3 2, known 5
