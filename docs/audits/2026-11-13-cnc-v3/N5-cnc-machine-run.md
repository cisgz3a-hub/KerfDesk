# N5 — CNC machine run (CNC audit v3, `cnc-machine-run`)

**Question.** When a real compiled CNC job runs on the GRBL simulator with the kinematic clock (#1863), does the machine do what the program and the operator expect, and is the operator told the truth when it does not? The checks cover:
- a full run: the streamed program against the saved one, spindle on before the first cut and off at the end, park and final position;
- bit-change holds: what stops, what the operator is told, Z re-zero by hand or touch plate, Continue, the spindle and the Z of the next bit, Abort at the hold;
- Abort mid-cut (mid-straight, mid-arc, during a plunge, during a rapid), the UI state, then pass recovery: spindle, units, modal state, safe Z, re-entry, skipped or repeated work;
- Pause (CNC "Pause and lift", ADR-411) and Resume mid-cut;
- rapids into uncut stock across each job;
- the Job Review ETA against simulated time;
- a write failure and a cable pull mid-job;
- touch-plate probing at a hold: success, ALARM:5, a closed probe input.

**Tree.** `origin/main` @ `9a0b1a80b` (read-only export `j38-main`, includes #1863).
- main is now `0163a852b`. `git diff --stat 9a0b1a80b 0163a852b -- src/core/controllers src/ui/state src/ui/laser src/core/cnc src/core/recovery src/core/output src/__fixtures__` lists 11 files: relief (`compile-cnc-relief*`, two relief warning files) and convert-to-path (`convert-to-path-mutation.ts`, `path-from-cut-actions.ts`, `vector-path-actions.ts`). None is on the run, hold, pause, abort or recovery path. Every file cited below is unchanged.

**Method.**
- **The real app.** Vitest suites in `zz-n5/mut`, run against the `j38-main` tree with its own `vitest.config.ts` (`zz-n5/vitest.n5.config.mts`), one file at a time. Each run:
  - renders the Machine rail and Live Motion bar (`cnc-bit-change-testing.tsx`);
  - Zeroes Z or probes on the rail;
  - Frames, opens Job Review and Starts through `recovery-stress-testing.tsx` (`startFramedJob`, the real store, checkpoint tracker and recovery repository);
  - works each hold on the rendered rail (Jog Z−, Zero Z, Run probe, Continue);
  - calls the store's own `stopJob`, `pauseJob`, `resumeJob`, `unlockAlarm` and `jog`;
  - recovers through `cncPassRecoveryDefaultPoint` and `runCncPassRecoveryFlow`, as the wizard does.
- **The simulator.** `createGrblSimulator({ kinematic: true })`: `$32=0`, `$30=12000`, G0 at 6000 mm/min. Three additions, each needed for fidelity:
  1. **Ack throttle (`n5-sim.ts`).** The kinematic mode cannot be combined with `plannerBlocks`, and without it every line is acked at once, so the whole program would be queued. The wrapper holds each `ok` while more than 15 moves are queued and drops held acks at a soft reset. Validation: the run time minus holds matches my own kinematic replay of the saved program to within 0.1 s (184.06 against 184.05 s).
  2. **Clock frozen in a hold (`n5-clock.ts`, S3–S5 only).** The stock kinematic clock keeps moving through a feed hold or door. Mine stops the moment `!` or `0x84` is written (no deceleration).
  3. **Main-thread compile.** jsdom has no Worker, so `outputPreparationPrefersWorker` returns false. The worker runs the same prepare.
- **Dialogs.**
  - `appConfirm` (in-app) always says yes.
  - `jobAwareConfirm` is faithful in S4–S5: it returns false while any job is active, holds included. In S1–S3 it was always true, and no job-time confirm was asked there.
- **My own reader and stock model (`n5-analyze.ts`).** It shares no code with the app.
  - It reads modal G0–G3, G90/G91, G20/G21, F, S, M3/M4/M5, G4 and M0, and tracks the section each line belongs to.
  - The stock is a 0.1 mm top-Z height map in work coordinates: flat end mills cut their disc, the 60° V-bit cuts its cone.
  - Every cut checks the spindle and whether a G4 ran since M3. Every G0 checks intrusion into standing material.
  - Self-check (`zz-n5/selfcheck.ts`): a G0 across the pocket at Z−1 is flagged, and so is a G1 after M5.
- **Executed prefix of an interrupted run.** My replay of the sent lines with the clock's rules: each move starts when it was written or when the previous move ends, whichever is later. It agrees with the simulator's stop position to within 0.0005 mm on cuts and 0.01 mm on a rapid.
- **Job.** Three operations from the real compile (the Save path and Start agree byte for byte):
  1. helical-entry pocket Ø16 × 3 mm, 1/8" end mill (G2/G3 helix);
  2. V-carve star, 60° V-bit (bit change);
  3. outside profile 60 × 30 mm through 6.35 mm stock with tabs, back on the 1/8" end mill (bit change). In variant `s1b` it runs on the 1/4" end mill instead.
- **Not used:** a browser, hardware, pnpm, live services. One Vitest process at a time (≥ 1.5 GB free).

## Headline

**The ordinary run, holds, Abort, pass recovery and Pause and lift are sound on the kinematic simulator.**
- **Programs.** Both multi-tool programs stream byte-identical to the saved program: 2,103 of 2,105 sendable lines, plus the two M0s held host-side.
- **Spindle and stock.** Every section starts the spindle at safe Z and dwells before its first cut. There are 0 rapids into stock and 0 cuts with the spindle off.
- **Holds.** Each hold parks with the spindle off. Continue is blocked until the new bit has a Z zero, and Continue restates G21 G90 G54 G94 G17 before lifting and spinning up.
- **Abort mid-cut** stops the head where the clock says, to within 0.0005 mm on cuts, and stops the spindle. Pass recovery re-enters at safe Z and plunges at the plunge feed.
- **Pause and lift.** All 9 points (straight, helix, plunge, V-carve slope, profile wall, tab ramp, with G92 and G54 offsets) re-enter in their own kerf. In all 13 interrupted runs (4 Abort, 9 Pause) the final stock equals the uninterrupted program's: 0 cells left uncut, 0 cut deeper.
- **ETA.** Job Review says 3m 15s and 3m 19s against 3m 04s and 3m 08s of acceleration-free simulated motion (1.06×). It states that tool-change time is extra.

**One P1, one P2 and four P3s are new.**
1. **N5-P1-1. After a mid-job bit change zeroed with Zero Z (G92), an Abort at Idle lets pass recovery run on the first bit's Z zero, under "retained position".**
   - **Why the checks pass:**
     - The Abort's soft reset drops the hold's G92, so the work offset returns to the value archived at Start, and the retained-position check passes.
     - The Abort also clears the Work Z record, so the H3-P1-1 start-bit check (`cnc-recovery-start-bit.ts:53`) returns early.
     - The only line the operator sees is the generic "No work zero is set" among six warnings.
   - **What gets cut** (V-bit 2 mm longer than the end mill; Start zero by touch plate, which writes G54):

   | Abort | Recovery default | What streams | Physical result |
   |---|---|---|---|
   | At the V-bit's hold, after Zero Z with the V-bit (or before zeroing) | **operation 1 (pocket, 1/8" end mill), pass 22** | 112 lines of pocket at Z−3 with the V-bit in the spindle, WCO = the end mill's | pocket floor gouged **2.25 mm** deep over **159.5 mm²** |
   | After Pause and lift in the V-carve | operation 2, pass 1 (V-bit, right bit) | the V-carve at WCO −13 (the end mill's zero) instead of −11 | every V groove **2 mm deeper** and **2.3 mm wider** |

2. **N5-P2-1.** At a bit-change hold, the default recovery point rewinds across the M0 into the previous bit's operation, against `cnc-resume-point.ts`'s own rule ("A tool-change M0 caps that rewind"). The cap reads only an acknowledged M0, and a held M0 is never sent.
3. **N5-P3-1.** Job Review's window-stream warning tells a router operator their job "burns with constant power … a burn-through and fire risk" and to switch to Dynamic (M4) or GRBL Dynamic.
4. **N5-P3-2.** Every operator Pause logs "KerfDesk did not request this pause."
5. **N5-P3-3.** A mid-job write failure ends with a notice about the failed *disconnect* command. The facts that matter, that the reset stopped the job and the spindle, are only in the log.
6. **N5-P3-4.** The kinematic simulator keeps moving through holds, cannot model the planner, and does not restore the spindle at a door resume, so no repo test can exercise Pause and lift against moving motion.

## Results

### S1. Run to completion (two multi-tool programs, holds worked on the rendered rail)

| Program | Sendable lines | Streamed = saved | Host-only lines | Rapids into stock | Cuts, spindle off / no dwell | Cutting / rapid mm | ETA (Review) | Simulated (excl. holds) | Replay of saved |
|---|---|---|---|---|---|---|---|---|---|
| s1a pocket → V-carve → profile (1/8"); holds: Zero Z, then touch plate | 2,105 (2 M0) | **yes, 0 diffs** | 3 × `G4 P0.01` fences; hold lines only inside holds | 0 | 0 / 0 | 1,942 / 2,320 | 3m 15s ("plus manual tool-change time") | 184.06 s | 184.05 s |
| s1b same, profile on 1/4"; holds: Zero Z twice | 2,105 (2 M0) | **yes, 0 diffs** | same | 0 | 0 / 0 | 2,013 / 2,336 | 3m 19s | 188.31 s | 188.45 s |

- **Before Start:**
  - Frame: `M5`, `M9`, a `$J` lift to Z3.81, then the outline at F6000.
  - The sections: M3 S12000 at Z3.810 → G4 P3.000 → XY rapid → plunge at F300, in all three.
  - Job Review warned that the park point (X0 Y0) is outside the Frame.
- **End:** `G0 Z3.810` (the highest safe Z), `M5`, `G0 X0 Y0`. The simulator is Idle at X0 Y0, spindle 0. No alarm, error or notice.
- **At each hold:**
  - The simulator is Idle at the park (X0 Y0, safe Z) with FS 0,0, and M5 was sent before the park.
  - Rail: "This job is waiting for 60° V-bit — 6.35 mm (1/4") cut. Zero Z and the probe now record Work Z for it." The "Bit in the spindle" selector shows the new bit.
  - Continue is aria-disabled with "Load the new bit and establish its Z zero on the stock top (jog, then Zero Z, or probe) before continuing."
  - After Zero Z (`G54 G92 Z0`) or the probe (`M5 M9 G54 G21 G94 G91 G38.2 Z-25 F150 / G0 Z2 / G38.2 Z-3 F25 / G10 L20 P0 Z15 / G0 Z5 / G90`), Continue sends: `G21 G90 G54 G94 G17`, `G0 Z3.810`, `M3 S12000`, `G4 P3.000`, `G0 X… Y…`, `G1 Z… F300`. The new bit lifts before the spindle starts and is at speed before it cuts.
- **ETA.** The simulator has no acceleration and runs G0 Z at `$110`, so it is a lower bound. Job Review is 1.06× it on both programs and never under it. It lists spindle dwell (9 s) separately.

### S2. Abort mid-cut in the pocket, then pass recovery (re-zeroed)

| Abort in | Line | Head stopped (work) | Replay vs simulator | Spindle after | Stopped in pass | Default pass | Recovery: rapids into stock / cuts without dwell | Final vs uninterrupted: uncut / deeper cells |
|---|---|---|---|---|---|---|---|---|
| mid-straight | `G1 X29.996 Y366.166 Z-1.500 F300` | 30.615, 366.022, −1.500 | 0.0005 mm | 0 | 7 | 6 | 0 / 0 | 0 / 0 |
| mid-arc (helix) | `G3 X40.677 Y363.247 Z-1.875 I2.867 J-0.882` | 36.926, 361.262, −1.687 (on the helix) | 0.0005 mm | 0 | 11 | 10 | 0 / 0 | 0 / 0 |
| during a plunge | `G1 Z-1.500 F300` | 34.943, 365.011, +1.156 | 0.0005 mm | 0 | 11 | 10 | 0 / 0 | 0 / 0 |
| during a rapid | `G0 X34.943 Y365.011` | 31.903, 365.719, 3.810 | 0.010 mm | 0 | 11 | 10 | 0 / 0 | 0 / 0 |

- **On Abort:** one `0x18`, then `M5`, `M9` (both answered `error:9` in Alarm) and `$G`. No motion line is sent. The store ends `cancelled` with ALARM:3 and clears the Work Z record.
- **Retained position** is refused: "The machine was stopped while it may still have been moving…"
- **After the operator re-zeroes Z**, recovery confirms "Boundary: operation 1, pass 7 (11) … 12000 rpm with 3 s spin-up dwell". It streams `G21 G90 G54 G94 G17`, `G0 Z3.810`, `M3 S12000`, `G4 P3.000`, an XY rapid, then `G1 Z-1.500 F300` at the pass start, which is already cleared.
- **Duplicates:** by design, one pass is recut. Nothing is skipped.
- **Completion:** both later holds were worked and the job completed (1,654–1,854 lines).

### S3. Pause and lift, then Resume (clock frozen at the hold)

| Pause in | Line | Stop (work) | Lift | Re-entry | Final: uncut / deeper |
|---|---|---|---|---|---|
| pocket straight | `G1 X29.996 Y366.166 Z-1.500 F300` | 30.615, 366.022, −1.5 | door, reset, `G21 G90 G54 G94 G17`, `G0 Z3.810` | M3, G4 P3 at Z3.81, rapid to the stop point, `G1 Z-1.500 F300`, `G1 F1000`, replay from line 357 | 0 / 0 |
| helix | G3 … Z-1.875 | 36.926, 361.263, −1.687 | yes | at the **arc start** (34.943, 365.011, −1.5), then the whole G3 | 0 / 0 |
| plunge | `G1 Z-1.500` | Z +1.157 (air) | yes | `G1 Z1.156`, then the plunge | 0 / 0 |
| rapid at safe Z | G0 X… | 31.893, 365.722, 3.81 | **no lift**: "The bit already stopped at or above safe height" | `~` (plain door resume) | 0 / 0 |
| V-carve slope (after a Zero Z hold) | `X60.825Y363.382Z-3.000` | 60.531, 362.977, −2.365 | yes, G92 restored (Δ ≤ 0.0005 mm) | at the stop, then the slope | 0 / 0 |
| profile wall | `G1 X18.413 Y381.588 Z-4.400` | 18.413, 365.003, −4.4 | yes | at the stop | 0 / 0 |
| tab ramp | `G1 X69.501 Y381.588 Z-4.350 F300` | Z −5.352 on the rise | yes | `G1 Z-5.351 F300`, then the rise | 0 / 0 |
| profile wall and tab ramp, Start zero G92 + hold-2 probe (G54) | — | — | `G92 X… Y… Z…` restores WCO −9.38 exactly | — | 0 / 0 |

- The spindle is 0 after every lift. The resumed job completed with its remaining holds.
- In the no-lift case my reader shows cuts with the spindle off after `~`. That is the simulator, not the app: GRBL restores the spindle at a door resume (`SAFETY_DOOR_SPINDLE_DELAY`), and the simulator's `reduceCycleStart` does not. See N5-P3-4.

### S4. Faults

| Event (mid-pocket) | What the app sent | Simulator after | Store | Operator told |
|---|---|---|---|---|
| Line writes fail, port open | `0x18` within 1 ms (it went through), then `M5`/`M9` (failed); the app then disconnects | ALARM, **spindle 0**, head stopped | `cancelled`, disconnected | notice: "The **disconnect** command was not written to the controller; the machine may not have responded. Use physical E-stop…" (the job-level line is only in the log) → N5-P3-3 |
| Write fails and closes the port | nothing more can be sent | Idle at the end of its buffer, **spindle 12000** (GRBL keeps M3 on) | `disconnected` | "USB connection was lost during the job … with the laser or spindle still on. If it does not stop, use the physical E-stop…" |
| Cable pull | — | same | same | same |
| Probe at the hold, ALARM:5 (no contact) | the probe block | Alarm, spindle 0, G91 left by the failed probe | hold kept (`tool-change`), Continue: "Waiting for the machine…" | toast: "Probe never touched the plate within the travel limit (ALARM:5)… $X to unlock and retry." After `$X` and Zero Z, Continue restates G90 and the job goes on |
| Probe input already closed | nothing | Idle | hold kept | Run probe disabled: "The probe input is closed. Take the touch plate away from the bit…" |
| Abort at the hold | `0x18`, `M5`, `M9`, `$G` | Idle at the park, spindle 0 | `cancelled`, no alarm | — (see N5-P1-1 and N5-P2-1) |

## Findings

### N5-P1-1 — After a bit change zeroed with Zero Z, an Abort at Idle lets pass recovery run on the first bit's Z zero under "retained position"

- **Where:**
  - `src/ui/laser/cnc-pass-recovery-review.ts:57-90` (`retainedPositionIssue`): the live WCO is compared with `capsule.artifact.archivedControllerObservation.wco`, which is taken at Start.
  - `src/ui/laser/cnc-recovery-start-bit.ts:47-54` (`cncRecoveryStartBitIssue`): `if (evidence === null …) return null`.
  - `src/ui/laser/cnc-pass-recovery-flow.ts:60-89,136-140`: the retained path runs no Work Z check.
  - The rail's Zero Z writes `G54 G92 Z0` (toast "Work Z0 set at the current bit height (G92 Z0)"). Stock GRBL's soft reset clears G92 (simulator: `reduceSoftReset`, `g92: null`).
- **Anchor:**
  - *Contract:* `cnc-recovery-start-bit.ts:1-15` (rolling v4 H3-P1-1, ADR-215 Amd 2): recovery "refuses unless Work Z was set for the recovery program's own first bit". Retained position (ADR-215 decision 2) means "the live work offset matches the archived observation".
  - *What breaks it:* a mid-job hold legitimately moves Z0. The archived observation is the Start-time offset, and a reset restores exactly that offset by wiping the hold's G92.
  - *Twin:* the same Abort mid-motion is refused retained position (`positionLost`), and the re-zeroed path runs the start-bit check.
- **Evidence:** REPRO (`s5-holdabort.n5.test.ts`; `out/s5-hold-abort-manual.json`, `-none.json`, `s5b-lifted-abort-vcarve.json`) and READ.
  - **Common setup:** Start zero by touch plate (`G10 L20 P0 Z15` → G54 z −13, no G92). At the V-bit hold the operator jogs onto the stock with a V-bit 2 mm longer and presses Zero Z (G92 z +2), then:
  - **(a) Aborts at the hold.**
    - After the reset: G92 null, WCO −13, the same as the archived value. `workZZeroEvidence` is null, and the rail still declares the V-bit.
    - `cncPassRecoveryDefaultPoint` gives group 0 (pocket, 1/8" end mill), pass 21 (N5-P2-1).
    - `runCncPassRecoveryFlow(…, { position: { kind: 'retained-confirmed' } })` → **started: true**, no alert. The only Work Z line among the six confirm bullets is "No work zero is set — … Touch the bit to the stock top and press Zero Z…". The plan confirm does not name a bit.
    - Streamed: `G21 G90 G54 G94 G17`, `G0 Z3.810`, `M3 S12000`, `G4 P3.000`, `G0 X28.758 Y366.452`, `G1 Z-3.000 F300` … 112 lines of pocket, then the V-bit hold. The WCO during recovery is −13.
    - Swept with the V-bit's cone 2 mm low: **159.5 mm² of the pocket floor cut up to 2.25 mm below the floor.**
    - Without Zero Z at the hold (V-bit loaded, Abort): identical.
  - **(b) Continue, Pause and lift in the V-carve, then Abort.** The lift restored G92 +2, and the Abort's reset wiped it again (WCO −13 = archived). The default is operation 2, pass 1 (V-bit). Retained → **started: true**, and the V-carve streams with Z0 at machine −13 instead of −11: every V groove 2 mm deeper, 2 × 2 × tan 30° = 2.3 mm wider.
- **Scenario:** A maker zeroes the first bit with the touch plate, swaps to a V-bit at the hold and taps Zero Z. They Pause and lift to clear chips, then Abort to fix a clamp. In the recovery wizard they keep "Retained position", since nothing moved, and tick "The required tool is installed … and Z-zeroed". The V-carve recuts 2 mm deep and the lettering is ruined. In case (a) the pocket floor is gouged instead.
- **Severity: P1.** It silently produces a wrong depth. The one warning is generic: "No work zero is set" does not name the mismatch, and the retained-position choice contradicts it. METHOD §3 (2026-10-27) allows lowering only when the specific mismatch is told. The app knows that mismatch: the rail-declared bit is the V-bit and the zero was last set mid-job.
- **Announced?** Only the generic "No work zero is set" line.
- **Novelty:** new. H3-P1-1 fixed the start-bit check for the re-zeroed path. This is the retained path after an Idle Abort, where Abort's reset both wipes the hold's G92 and clears the Work Z record.
- **Fix direction:** archive the WCO, and the bit it belongs to, at every hold Continue (or each Work Z change), and compare retained position with the last one. Or refuse retained position whenever the run crossed a bit change or the reset dropped a non-zero G92. Run the start-bit check against the rail-declared bit when the Work Z record is null. Name the recovery's first bit in the plan confirm.

### N5-P2-1 — Abort at a bit-change hold: the default recovery point rewinds across the held M0 into the previous bit's operation

- **Where:** `src/core/recovery/cnc-resume-point.ts:120` (`proven = max(0, acked − reserve, lastAcknowledgedToolChange(…))`), `:136-147`.
- **Anchor:**
  - *Contract:* the file's own header (`:17-21`): "A tool-change M0 caps that rewind … rewinding across it would preselect the previous bit's pass while the next bit is in the spindle (controller audit cnc-controller-2)".
  - *Why it fails:* the cap reads only an M0 inside the acknowledged lines. The host never sends a tool-change M0 (`streamer.ts:41-47`), and it counts as complete only at Continue. At a hold `acked` stops one line short of the M0 (1,108; M0 is sendable line 1,109), so the cap never applies.
  - *Twin:* the hold is entered only after a drained, fresh Idle (`toolChangeReady`). Everything before the M0 has provably run, yet the capsule records `plannerBacklog: { queuedBlocks: 15 }`.
- **Evidence:** REPRO (`s4-abort-at-hold.json`, `s5-*.json`): default `{ groupIndex: 0, passIndex: 21, firstUnprovenRawLine: 1087 }` against the M0 at raw line 1121. 32 lines are rewound into the pocket. READ: `lastAcknowledgedToolChange` (`:138-147`).
- **Scenario:** Abort while waiting at a bit change (wrong bit fetched, a clamp to fix). The wizard preselects "Operation 1 (pocket · 1/8" end mill) · pass 22". With the start-bit check working (re-zeroed with the V-bit), recovery refuses until the operator loads the end mill again. They then recut 112 lines that are already finished and stop at the same bit change again. With retained position it becomes N5-P1-1 (a).
- **Severity: P2.** A broken contract with a clear failure scenario: a needless bit change and a misleading default. The harm path is N5-P1-1.
- **Announced?** No.
- **Novelty:** new.
- **Fix direction:** treat a hold reached at a fresh Idle as proving every line before its M0: record the hold in the checkpoint, or count the held M0 as acknowledged for recovery. Default to the next bit's first pass.

### N5-P3-1 — Job Review's window-stream warning uses laser wording and laser remedies for a CNC job

- **Where:** `src/ui/laser/job-review/window-stream-lit-stop-warnings.ts:41-58,104-107`. `detectWindowStreamLitStopWarnings` never checks the machine kind; `findStoppedHeadPower` flags the CNC `M3 S12000`.
- **Evidence:** REPRO (`out/s1a.json` review warnings), and READ. Job Review for the CNC job, streamed from the window (a transport with no worker: Background streaming off, a non-unique adapter or a failed worker), opens with: "This job burns with constant power (M3, from line 20) … a burn-through and fire risk. Dynamic power (M4) goes dark when the head stops; set the operations' Power mode to Dynamic (M4) or choose GRBL Dynamic in Machine Setup."
- **Severity: P3.** CNC layers have no power mode, the CNC emitter always writes M3, and M4 on a router means reverse rotation. The real CNC risk is a spindle turning in a stalled cut, and the warning does not name it.
- **Announced?** n/a.
- **Novelty:** new. This is N6 territory (Job Review truth); raised here because it appears on the run.
- **Fix direction:** a CNC variant: the spindle keeps turning over the stopped bit, so it rubs and burns. Remedy: Background streaming, keep a hand on the E-stop, no edits while it runs. Drop the M4 advice.

### N5-P3-2 — Every operator Pause logs "KerfDesk did not request this pause"

- **Where:** `src/ui/state/laser-status-line.ts:198-215` (`controllerHoldLogPatch`). It logs at any transition to Hold or Door while `isActiveJob`, which includes `paused`, and does not check whether KerfDesk sent the door byte (`pauseResumeTransition`).
- **Evidence:** REPRO: in all four section-1 S3 pauses, the console reads "[lf2] Controller entered Door during the job. Motion is stopped until the machine's own cycle start releases it; KerfDesk did not request this pause." immediately after the operator's Pause.
- **Severity: P3.** Console text only, but it contradicts what happened: KerfDesk sent the door byte, and the lift resumes without the machine's own cycle start.
- **Announced?** n/a.
- **Novelty:** new. The ADR-333 test covers only an uncommanded hold.
- **Fix direction:** skip the line while a KerfDesk pause transition owns the hold, or log "Paused by KerfDesk" instead.

### N5-P3-3 — A mid-job write failure on an open port ends with a notice about the disconnect command, not the job

- **Where:**
  - `src/ui/state/laser-safety-notice.ts:476-478` (generic `writeFailedMessage`, action `disconnect`).
  - The containment path logs "[lf2] Active job transport write failed: A mid-job send failed, so the stream was stopped…" (`laser-stream-heartbeat-containment.ts:223`). The later disconnect failure then replaces it as the safety notice.
- **Evidence:** REPRO (`s4-write-fail-open.json`). The reset was written and worked (ALARM:3, spindle 0, head stopped). The banner reads only "The disconnect command was not written to the controller; the machine may not have responded. Use physical E-stop…".
- **Severity: P3.** It is conservative but names the wrong failure and hides that the job and spindle were stopped.
- **Announced?** n/a.
- **Novelty:** new.
- **Fix direction:** keep the job-level notice and add the disconnect failure to it, or say "the job was stopped (reset sent); the disconnect that followed could not be written".

### N5-P3-4 — The kinematic GRBL simulator cannot run Pause and lift, the planner, or a door resume faithfully

- **Where:**
  - `src/__fixtures__/controllers/grbl-sim-kinematics.ts:10-11` ("A feed hold does not pause this clock").
  - `grbl-simulator.ts:368-376` (`kinematicClockFor`): kinematic and `plannerBlocks` are mutually exclusive.
  - `grbl-sim-machine.ts` `reduceCycleStart`: the spindle is not restored after a door. M3/M5 are not planner-synced in non-laser mode. G0 Z runs at the XY rate.
- **Evidence:** REPRO and READ. With the stock clock, a Pause lets the head run on through the door state. Without an ack throttle, the whole program is acknowledged at once, so recovery and re-entry would be computed against the wrong acknowledged line. Both needed my stand-ins (`n5-clock.ts`, `n5-sim.ts`).
- **Severity: P3.** A test-infrastructure gap. The code behind it measured correct here.
- **Announced?** The clock's limits are in its own header.
- **Novelty:** new.
- **Fix direction:**
  - freeze the clock in Hold and Door, with optional deceleration;
  - combine the clock with the planner's ack hold;
  - restore the spindle with `SAFETY_DOOR_SPINDLE_DELAY` at a door resume;
  - time G0 Z by `$112`.

## KNOWN status

| Item | Status on the tree |
|---|---|
| 2026-07-13 interpreter/restart audit §4.3 (prologue missing G17/G54) | **fixed:** preamble and every Continue and recovery restate `G21 G90 G54 G94 G17` |
| §4.4 (resume and tool change start the spindle before the retract) | **fixed:** Start, Continue, pass recovery and pause re-entry all `G0 Z<safe>` → `M3` → `G4` before any XY move or plunge |
| §4.5 (narrow resume shadow state, plunge to the old depth at one XY) | **replaced:** pass recovery re-emits a full program at a pass boundary; pause re-entry plunges at the stop point (its own kerf) or at an arc's start |
| §4.13 (ETA omits dwell and tool change) | **fixed:** Review lists spindle dwell and says "plus manual tool-change time"; 1.06× the simulated lower bound |
| PR #1769 / ADR-416 Amd 4 (bit-change Continue) | **holds:** Continue is gated on a fresh Idle and Work Z for the declared bit; Zero Z and the probe both unlock it |
| Controller audit streaming-3 (G91 left by a failed probe) | **holds:** after ALARM:5 left G91, Continue restated G90 |
| C2 D3-P3-7 (kinematic clock) | used; its limits are N5-P3-4 |
| CNC v1 F8-P2-1 (setup-package M0 single file) | not retested (export path, not a project Start) |

## Verified clean

- **Stream fidelity:** streamed = saved on 2 × 2,105 lines; only Start/settle fences and operator hold lines are added, and those only inside holds.
- **Spindle discipline:** 0 cuts without a preceding `M3` + `G4` across both full programs, 4 recoveries and 9 resumed pauses. M5 before every hold park and at the end.
- **Rapids:** 0 G0 moves into standing material in both full programs, every recovery and every resumed pause. That covers the pocket's G0 descents to its air floor (ADR-489).
- **Abort:** the head stops on the move it was on (straight, helix, plunge, rapid). The spindle stops. No motion line follows the reset. The UI ends `cancelled` with ALARM:3 and clears Work Z, and retained position is refused after motion.
- **Pass recovery (re-zeroed):** it re-enters at a pass boundary from safe Z with the spindle at speed and plunges at the plunge feed into cleared kerf. Nothing is skipped (0 uncut cells); one pass is recut.
- **Pause and lift:** stop point = the simulator's position (≤ 0.002 mm). Lift straight up with the spindle off. G92 is restored after the reset (also with a probe-written G54 underneath). Re-entry is in its own kerf, with a modal restate and the line's feed. The tab ramp, V-carve slope and helix all resume correctly.
- **Probe:** a closed probe input disables Run probe with the reason. ALARM:5 keeps the hold and says how to recover. A manual zero after `$X` continues the job.
- **Cable pull:** the notice names the spindle as still on and points to the E-stop. GRBL keeps M3 on, and nothing can be sent.

## Not verified

- **Simulator limits:** acceleration and deceleration (Hold:1 distance); GRBL's door-resume spindle restore and 4 s delay (no-lift Pause); M3/M5 planner sync (judged by program order); a real probe's travel (the simulator touches at once); G0 Z at `$112`.
- **Planner model:** my ack throttle stands in for the 15-block planner, approximately: lines still in RX were already parsed.
- **Compile thread:** main thread, not the worker.
- **Dialogs and UI:** `jobAwareConfirm` was always-yes in S1–S3 (no job-time confirms were asked). The rendered Job Review dialog and the `CncPassRecoveryWizard` were not rendered: the flow functions were called with the wizard's default pass.
- **Not run:** grblHAL and FluidNC; relief, drill, tiled and rotary CNC jobs; supervised mid-pass runway recovery; a late pass pick; coolant; an RPM-only change between groups.
- **Untimed:** the live in-job ETA countdown.

## Repro files

All under `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-n5\`:

- **Config:** `vitest.n5.config.mts`. Run from `j38-main` as `N5_FILE='**/<suite>' node node_modules/vitest/vitest.mjs run --config ../zz-n5/vitest.n5.config.mts`; `N5_KINDS` and `N5_HOLDS` select cases.
- **Harness:**
  - `mut/n5-sim.ts`: ack throttle, event log, hold-aware clock hooks.
  - `mut/n5-clock.ts`: kinematic clock frozen in holds.
  - `mut/n5-analyze.ts`: reader, stock model, audit.
  - `mut/n5-run.ts`: hold worker, timeline, executed prefix.
  - `mut/n5-common.ts`: project and logs.
- **Suites:**
  - `mut/s1-complete.n5.test.ts`: S1.
  - `mut/s2-abort.n5.test.ts`: S2.
  - `mut/s3-pause.n5.test.ts`: S3.
  - `mut/s4-faults.n5.test.ts`: faults, probe, Abort at the hold.
  - `mut/s5-holdabort.n5.test.ts`: **N5-P1-1 / N5-P2-1**.
- **Checks:** `selfcheck.ts` (stock-model self-test).
- **Outputs (`out/`):** `s1a*.{json,nc,txt}`, `s1b*`, `s2-*.json`, `s3-*.json`, `s4-*.json`, `s5-hold-abort-{manual,none}.json`, `s5b-lifted-abort-vcarve.json`, plus run logs.

## Counts

Raised **6**, P1 **1**, P2 **1**, P3 **4**; known **8** (7 re-observed, 6 of them fixed or holding; 1 not retested).

## Refuter (2026-11-13)

**Tree and harness.** Same read-only export `j38-main` (`origin/main` @ `9a0b1a80b`). `origin/main` is now `7333f3c39`. `git diff --stat 9a0b1a80b origin/main -- src/core/controllers src/ui/state src/ui/laser src/core/job src/__fixtures__ src/core/recovery src/core/cnc` lists the same 11 relief and convert-to-path files the auditor named, and no file name in the whole diff matches recover, hold, abort, pause, tool-change, wizard, stream or grbl. Every result below stands on current main.

My files are in `zz-n5r\`. I read the auditor's `s5-holdabort.n5.test.ts`, `vitest.n5.config.mts` and one output JSON for API shape only. Nothing imports a `zz-n5` file.
- **Different simulator.** I used the repo's stock simulator with planner back-pressure (`plannerBlocks: 15`, `motionMs: 25`, as `recovery-stress-testing.tsx` builds it): **not** the kinematic clock, and no ack throttle or frozen clock. Settings were `$32=0` and `$30=12000`.
- **Different job.** Three On-path profiles with tabs off:
  - a 60 × 30 rectangle, 3 mm deep in 0.5 mm passes, 1/8" end mill;
  - a 20 × 20 square, 1 mm, 1/8";
  - a 40 × 20 rectangle, 2 mm in 0.5 mm passes, **1/4" end mill**.
  - The compiler groups the two 1/8" operations first, so the job has one hold, at raw line 81.
- **Setup.** The Start zero is the rendered touch-plate probe (`G10 L20 P0 Z15` → G54 z −13; no XY origin; Start from Absolute, which is `DEFAULT_JOB_PLACEMENT`). Then Frame, Job Review and Start go through `startFramedJob`.
- **At the hold.** I pressed the rendered rail's "Jog Z- 1 mm" twice, then Zero Z, giving `G54 G92 Z0` and G92 z **+1.81**. That makes the 1/4" bit 1.81 mm longer than the 1/8". Then I called the store's `stopJob` / `pauseJob`.
- **The wizard. This is the main difference from the auditor.** I drove the **real rendered `CncPassRecoveryWizard`**, not `runCncPassRecoveryFlow` called directly:
  - tick its four boxes, take the first **enabled** position radio, and click "Start pass recovery";
  - the only stand-in: the wizard passes no repository (the app singleton), so a one-line wrapper hands the flow the harness's repository;
  - `jobAwareConfirm` is faithful (`!anyMachineJobActive()`) and records every text.
- **Own measures.** A modal Z reader over the bytes on the wire (`workZTrace`). Physical depth = (stock-top machine Z for the loaded bit) − (deepest commanded work Z + live WCO z).
- **Runs.** Vitest only, one process at a time, ≥ 2.3 GB free throughout. No browser, no hardware, no pnpm.

### Verdicts

| Finding | Verdict | Severity | Evidence (own) |
| --- | --- | --- | --- |
| N5-P1-1 | **CONFIRMED and wider.** It reproduces through the rendered wizard, on a different simulator and job. It also occurs after a plain Pause at safe Z (no lift) followed by Abort. A probe-zeroed hold gets past through the re-zeroed path too, which runs the old bit's passes with the new bit. The only warning is a false positive in the safe twin (control case C), so it cannot lower the rating | **P1** | `r-holdabort.r.test.tsx` → `out/A-*.json`, `B-*.json`, `C-*.json`, `E-*.json` |
| N5-P2-1 | **CONFIRMED, plus one facet.** The default rewinds 43 raw lines across the held M0. The upper bound also runs past the M0, so the wizard marks the never-sent 1/4" pass "?" | P2 | `out/A-abort-at-hold-manual.json`; READ `cnc-resume-point.ts:120,138-147` |
| N5-P3-1 | **CONFIRMED (READ).** No harm path from following the M4 advice: the CNC emitter always writes `M3` (`cnc-grbl-transitions.ts:114`), "GRBL Dynamic" is a laser dialect (`gcode-dialects.ts:88`), and CNC layers have no Power mode. P3 stands | P3 | READ `window-stream-lit-stop-warnings.ts:41-58,104-107` |
| N5-P3-2 | **CONFIRMED (READ).** `controllerHoldLogPatch` checks only `isActiveJob`, never who requested the hold | P3 | READ `laser-status-line.ts:198-215` |
| N5-P3-3 | **Not reproduced.** The READ is consistent: the generic `writeFailedMessage(action)` names the failed action, and containment logs the job line | P3 | READ `laser-safety-notice.ts:476-478`, `laser-stream-heartbeat-containment.ts:223` |
| N5-P3-4 | **CONFIRMED (READ),** and the stock back-pressure simulator has its own limit: it reports each move's end at once, so a Pause always settled at a move end in my runs | P3 | READ `grbl-simulator.ts:368-376`; my B and C pauses |

**N5-P1-1: CONFIRMED and wider; P1.**

| Case | Live WCO z after Abort / archived | Work Z record | Rail bit | Retained radio | Default (wizard ▶) | Streamed | Physical result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A**: Abort at the 1/4" hold after Zero Z | −13 / −13 (G92 +1.81 wiped) | null | 1/4" | **enabled** | Op 1 (1/8") pass 3 of 6 | 1/8" passes 3–6 at Z−1.5…−3, then the 1/8" square, then the hold again (43 lines) | 1/4" bit cuts the 1/8" profiles **4.81 mm** below the stock top (designed 3.00) and 3.175 mm wider |
| **B**: Continue, Pause (settled at safe Z, no lift), Abort | −13 / −13 | null | 1/4" | **enabled** | Op 3 (1/4") pass 1 of 4 (right bit) | the whole 1/4" profile | **3.81 mm** below the top (designed 2.00): 1.81 mm too deep |
| **C (control)**: single bit, Pause then Abort, no bit change | −13 / −13 | null | — | enabled | Op 1 pass 1 | the job | 3.00 mm: correct |
| **E**: hold zeroed with the **probe** (G10 L20, G54 −24.19) | −24.19 / −13 | null | 1/4" | **refused** ("live work offset differs") | Op 1 (1/8") pass 3 | **with "re-zeroed" chosen it still streams**: the 1/8" passes with the 1/4" bit | depth right for the loaded bit (G54 is its zero), kerf 3.175 mm wider |
| **A0**: Abort at the hold, no zero (run alone) | −13 / −13 | null | 1/4" | enabled | Op 1 pass 3 | as A | — |

- **What the operator sees before motion, in order.** These are the wizard's text and the recorded dialogs.
  1. **The wizard.** Guidance "The job was stopped from the app…", the pass map with "▶ Operation 1 (profile-on-path · 3.175 mm (1/8") end mill) · pass 3 of 6", four checkboxes ("The required tool is installed, intact, and Z-zeroed for this job"), and the position fieldset. Position starts **unselected**: retained is not pre-picked, but it is enabled and labelled "the work offset matches the interrupted run".
  2. **"Controller warning".** Four bullets: the homing-off bed note, the override observation, the accessory observation, and "**No work zero is set** — … press Zero Z, or run a touch-plate probe". B adds two more (N5r-P3-1).
  3. **"START CNC PASS RECOVERY? Boundary: operation 1, pass 3"**: no bit named.
  4. **The CNC setup attestation.**
  5. **What names a bit.** No step compares the rail's bit with the recovery's first bit. The only place a bit appears is the pass label, which is a visible result, not a warning (METHOD §3, G6).
- **Why the one warning cannot lower it.** Control case C shows **the same four bullets, including "No work zero is set"**. In C the G54 zero is correct and the recovery is right, because every Abort clears the Work Z record (`originUnknownAfterControllerReset`, `laser-status-line.ts:415-436`). So the line appears in every retained recovery after an Abort, safe or not. It does not name the mismatch, and it contradicts the enabled radio. ADR-215 also promised "Multi-tool jobs become recoverable with an explicit load-tool/re-zero wizard step". The wizard has only the generic tool checkbox.
- **G92 on reset, from repo sources only.**
  - Stock GRBL 1.1 clears G92 on every soft reset: `gc_init()` (CO-5, `2026-09-24-cnc-full-audit.md:859-863`, quoting GRBL `interface.md`: "clears G92's by G-code standard").
  - grblHAL keeps it (`$384`, HF.md:650).
  - The simulator models exactly that (`grbl-sim-machine.ts:341-344`: `g92: opts.firmware === 'grblhal' ? state.g92 : null`).
  - The app assumes the same (`laser-status-line.ts:411-414`: "stock GRBL and FluidNC have dropped G92, while grblHAL keeps it").
  - The prompt's alternative, that GRBL keeps G92 across a soft reset, is not supported by the repo.
- **Scope.** The finding needs all of the following:
  - a stock GRBL or FluidNC controller;
  - a Start Z zero held in G54 (the app's own touch plate);
  - an XY zero that is not a G92 (Absolute, the default, or the persistent origin or XYZ corner probe);
  - a hold zeroed with Zero Z.

  It does not occur when:
  - the Start XY zero came from Set origin here: the reset wipes that G92 too, the live WCO differs and retained is refused;
  - the controller is grblHAL: the hold's G92 survives and retained is refused.
- **Extension E (same root).** After an Abort at a hold zeroed by probe, the operator truthfully picks "I re-established the XY/Z zero" (they did, at the hold). `cncRecoveryStartBitIssue` still returns early on the null record (`cnc-recovery-start-bit.ts:53`), so the previous bit's passes stream with the new bit. Fold this into N5-P1-1's fix: when the record is null, check against the rail-declared bit, and name the recovery's first bit.

**N5-P2-1: CONFIRMED, P2, one facet added.**
- **Repro.** `ackedLines` 59, the held M0 at raw line 81, default `{ group 0, pass 2, firstUnprovenRawLine 38 }`. The rewind covers 1/8" passes 3–6 and the whole 1/8" square, all completed and drained before the hold (the hold only arms after a fresh Idle with nothing in flight).
- **New facet.** `lastPossiblyExecutedRawLine` is 101, past the M0, because the RX-buffer walk ignores that the host never sends a held M0. So the wizard marks "? Operation 3 (… 1/4" end mill) · pass 1 of 4", which was never sent, as uncertain.
- **Why P2 stands.** On the re-zeroed path with a real re-zero after the Abort, the start-bit check refuses the 1/8" default with the 1/4" zeroed, and loading the 1/8" bit only recuts cleared kerf. The harm route is N5-P1-1.

**N5-P3-1 to N5-P3-4: CONFIRMED P3, as in the table.** On P3-1 specifically, I found no path where taking the advice reverses a router spindle, so it does not rise above P3.

### Challenges to "Verified clean"

- **Holds park spindle-off and block Continue until re-zero: holds.** At the hold the simulator is Idle at work Z 3.81 with spindle 0. Continue is aria-disabled with "Load the new bit and establish its Z zero on the stock top (jog, then Zero Z, or probe) before continuing." After Zero Z the block is null.
- **Abort stops with a reset and no motion: holds.**
  - At a hold: `0x18`, `M5`, `M9`, `$G`, and nothing more (A, G).
  - After a Pause: the earlier `0x84`, then the same four.
  - During the park move (H): ALARM:3 with `positionLost: true`, so retained is refused, and recovery is refused while in Alarm ("Controller is in Alarm…").
- **Recovery re-entry: holds** on every recovery I streamed (A, B, C, D, D2): `G21`, `G90`, `G54`, `G94`, `G17` (each on its own line in recovery), `G0 Z3.810`, `M3 S12000`, `G4 P3.000`, `G0 X… Y…`, then `G1 Z… F300`. The spindle is at speed at safe Z before the plunge, at the plunge feed. This is clean in the work frame only; N5r-P1-1 shows the work frame itself can be wrong.
- **Not re-measured:**
  - streamed = saved;
  - ETA 1.06×;
  - Pause and lift with an actual lift and its G92 restore (both my pauses settled at safe Z, so no lift ran);
  - no rapid into uncut stock on the full programs.

### New findings

**N5r-P1-1: After a cable pull, a board that resets when its port reopens (or is power-cycled) has re-zeroed machine position, yet CNC pass recovery still offers "Position retained", and the recovery runs shifted by where the head stood.**
- **Where:**
  - `src/ui/laser/cnc-pass-recovery-review.ts:57-86`: `retainedPositionIssue` refuses only `kind === 'controller-reboot'` and `positionLost`, then compares the WCO;
  - `src/ui/app/link-loss-restart-tracking.ts:99`: `if (evidence === null || capsule?.artifact.machineKind !== 'laser') return;`, so a CNC capsule never takes the reconnect verdict and stays `disconnect` with `plannerBacklogIfRestarted`.
- **Anchor:**
  - ADR-215: retained position requires "no controller reboot observed".
  - ADR-398 Amd 3 records that an Uno "resets each time a connection is made to it from software", that Chromium asserts DTR on open, and that a Uno on a CNC shield takes its logic power from USB, so pulling the cable stops it at once. Without homing, GRBL boots with MPos 0 wherever the head is. G54 survives in EEPROM, so the live WCO equals the archived one.
  - **Twin:** a banner while connected is recorded as `controller-reboot`, and retained is refused.
- **Evidence:** REPRO, `r-reconnect.r.test.tsx`. I yanked the cable, waited 4 s while the controller ran out its buffer, then reconnected the store to a **fresh** simulator with `storedOffsets: { g54 }`. That models a board reset with MPos re-zeroed where the head stands. The repo's own reboot test (`recovery-origin-after-reboot.simulator.test.tsx`) puts the new machine zero at the old one, which hides this.
  - **D2: single bit, pull mid-cut.**
    - Old MPos at reset (10, 360, −13.5), spindle 12000. After the reconnect: G54 z −13, G92 none, MPos 0.
    - The capsule is still `disconnect` with `plannerBacklogIfRestarted` unsettled. `retainedPositionIssue` is null, the retained radio is enabled, and the wizard starts.
    - The wire: `G0 Z3.810` is new MPos −9.19, physically a **9.19 mm rapid downward**, ending 9.69 mm inside the stock with the spindle off. Then `M3` starts the spindle in material.
    - `G0 X10 Y390` goes to physical (20, 750) on a 400 mm bed.
    - The deepest `G1 Z-3` is **16.5 mm below the stock top** (designed 3).
  - **D: at the 1/4" hold after Zero Z.** The same mechanism gives 16.0 mm below the top. The recovery also defaults to the 1/8" operation (N5-P2-1).
- **Scenario.** A 3018 owner's USB cable is knocked out mid-cut. The board, powered by USB, dies; replugging powers it up. They reconnect. Nothing was moved and the controller "kept power" as far as they know. In the wizard they pick "Position retained", the option the app has enabled, and press Start. The bit rapids into the stock, the spindle starts buried, and the job runs offset by the head's whole machine position.
- **Severity: P1.** Wrong position and depth, a rapid into stock, and a spindle start in material.
- **Announced?** Only generic text:
  - the safety notice shown on every USB loss, including boards that kept running: "…Then reconnect and check the origin (Home, if the machine has homing) before running the job again". With homing off nothing can be homed, and the wizard's enabled retained option asserts the opposite;
  - the disconnect guidance (`cnc-pass-recovery-guidance.ts:34-41`), which says nothing about position;
  - the homing-off bed bullet, which appears on every job.

  None of these names the reset (G6).
- **Novelty:** new. It is a sibling of X1-P1-1 (rolling v12, the laser Frame's origin restore after a hard reset, fixed by #1647). ADR-398 Amd 3 skipped CNC for the backlog only ("CNC pass recovery keeps its own planner reserve and reads no backlog"). Position was never considered.
- **Fix direction:**
  - Let CNC capsules take the reconnect verdict.
  - Refuse retained position for a `disconnect` whose verdict is a boot banner, an Alarm or unknown, and for any stop followed by a controller session change or machine-zero epoch change without a Home.
  - On a homing-off machine, refuse retained after every lost link unless the first status showed Run or Hold.
  - Say why in the wizard.
  - Model the reboot in the simulator test with MPos re-zeroed where the head stands.

**N5r-P3-1: Pass recovery's warning dialog tells the operator that every omitted operation's layer "produced no toolpaths — usually the bit is too wide … Fix the layer or disable its Output."**
- **Where:** `cnc-pass-recovery-flow.ts:141-157` emits the resume job through `emitPreparedGcode` with full source-geometry checks. `resumeEmitOptions` sets no `sourceGeometryChecks`, so `cnc-preflight.ts:118-133` (`findDroppedCncLayers`) compares the project's layers with a job that deliberately omits them.
- **Evidence:** REPRO, case B. The "Controller warning" lists "Layer op-0: its shapes produced no toolpaths…" and "Layer op-2: …" (both 1/8" operations, already cut) beside the generic "No work zero is set".
- **Severity: P3.** False advice in a confirm dialog. It invites an edit and buries N5-P1-1's only bullet.
- **Announced?** n/a. **Novelty:** new (no audit pairs `cnc-layer-empty` with recovery).
- **Fix direction:** emit recovery with `sourceGeometryChecks: 'compiled-evidence-only'` (`emit-gcode.ts:73`), or drop `cnc-layer-empty` for layers outside the resume job.

### Probes with no gap (new-gap search)

- **Abort during the first plunge or the park move (H).** The reset raises ALARM:3 with `positionLost`, retained is refused, and recovery waits for the alarm to be cleared. Clean.
- **Two consecutive Aborts (G).** The second sends another `0x18 M5 M9 $G`. The capsule and default are unchanged, and nothing moves. Clean apart from N5-P1-1 itself.
- **Recovery with a different bit than the rail shows.** This is N5-P1-1 (A, E). With a real re-zero after the Abort, the start-bit check refuses correctly.
- **Recovery after changing the job's stock or zero.** A re-zero by probe after the hold makes the live WCO differ, and retained is refused (E). The re-zeroed path then depends on the Work Z record (E's extension). I did not edit stock.
- **Disconnect at a hold.** This is N5r-P1-1 (D).
- **Odd run.** In one combined run, A0, executed after five other cases, recorded `positionLost: true`; run alone it did not (`preAbort`: Idle, no transition, `streamReset.positionMayBeLost: false`). I attribute this to harness state across cases. Not investigated further.

### Not verified

- The recovery card or banner before the wizard (`CheckpointResumeBanner`) was not rendered.
- Full-program fidelity (streamed = saved), the ETA, a Pause and lift that actually lifts, write failures (N5-P3-3), and the probe's ALARM:5: not re-run.
- grblHAL and FluidNC: READ only, not simulated.
- The **laser** twin of N5r-P1-1 (Absolute laser recovery after a reconnect reset): not checked.
- Physical hardware: none. All depths are computed from the wire and the simulator's offsets.

### Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-n5r\`. Run from `j38-main` as `R_CASES=<cases> node node_modules/vitest/vitest.mjs run --config ../zz-n5r/vitest.r.config.mts` (add `R_FILE='**/r-reconnect.r.test.tsx'` for D and D2). Nothing in the repo or in `j38-main` was touched.

| File | Covers | Output |
| --- | --- | --- |
| `vitest.r.config.mts` | Own config: root `j38-main`, one worker | — |
| `mut/r-common.tsx` | Own project builder, wire splitter, modal Z reader, the rendered wizard | — |
| `mut/r-holdabort.r.test.tsx` | Cases A, A0, B, C, E, G, H | `out/<case>.json`, `out/run-*.log` |
| `mut/r-reconnect.r.test.tsx` | D (pull at a hold), D2 (pull mid-cut), each followed by a board reset on reopen | `out/D-pull-at-hold.json`, `out/D2-pull-midcut.json` |

```json
{
  "area": "N5",
  "role": "refuter",
  "tree": "9a0b1a80b (origin/main 7333f3c39 differs only in relief and convert-to-path files)",
  "verdicts": [
    {"id": "N5-P1-1", "verdict": "CONFIRMED and wider (rendered wizard; plain Pause+Abort; probe-zeroed hold via re-zeroed path)", "severity": "P1", "evidence": "REPRO A: retained enabled, op1 1/8\" passes streamed with 1/4\" at WCO -13, 4.81 mm vs 3.00; B: 3.81 vs 2.00; control C shows the identical 'No work zero is set' bullet"},
    {"id": "N5-P2-1", "verdict": "CONFIRMED + upper bound runs past the held M0", "severity": "P2", "evidence": "REPRO acked 59, M0 raw 81, default raw 38; lastPossiblyExecuted 101"},
    {"id": "N5-P3-1", "verdict": "CONFIRMED (READ); no harm path (CNC emitter hard-codes M3)", "severity": "P3"},
    {"id": "N5-P3-2", "verdict": "CONFIRMED (READ)", "severity": "P3"},
    {"id": "N5-P3-3", "verdict": "not reproduced; READ consistent", "severity": "P3"},
    {"id": "N5-P3-4", "verdict": "CONFIRMED (READ)", "severity": "P3"}
  ],
  "new": [
    {"id": "N5r-P1-1", "severity": "P1", "summary": "cable pull + board reset on reopen: retained position still offered; recovery rapids 9.19 mm down into stock, starts the spindle buried, cuts 16.5 mm deep and 350 mm off in Y"},
    {"id": "N5r-P3-1", "severity": "P3", "summary": "pass recovery warns every omitted layer 'produced no toolpaths ... bit too wide'"}
  ],
  "counts": {"raised": 8, "refuted": 0, "P1": 2, "P2": 1, "P3": 5, "known": 9}
}
```

Refuter counts: raised 8, refuted 0, P1 2, P2 1, P3 5, known 9. That is the auditor's 6 plus 2 new: N5r-P1-1 and N5r-P3-1. Known: the auditor's 8, plus CO-5 (2026-09-24: the default part zero is a G92 that every Abort clears), the precondition of N5-P1-1.
