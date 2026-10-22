# Controller audit v3 — D4 Spindle and machine hours

- **When:** 2026-10-22 20:20   **Tree:** origin/main @ `7cd526213` (audit worktree HEAD `b578de34c`;
  `git diff 7cd526213 HEAD -- src` is empty). `origin/main` moved to `8cbff4126` during the audit.
  On the audited paths that commit only changes `src/core/external-program/marlin-program-reader.ts`
  (Marlin). No finding below depends on it.
- **Scope:**
  - Spindle decision: `src/core/cnc/spindle-transition.ts`.
  - Emission: `src/core/output/cnc-grbl-{strategy,transitions,coolant}.ts`, `src/core/cnc/surfacing.ts`,
    `src/core/cnc/wrap/cnc-wrap-reference-program.ts`, the Pause-and-lift re-entry
    (`src/core/recovery/cnc-pause-reentry{,-program}.ts`, `src/ui/state/cnc-pause-{lift,lift-overrides,reentry-run,resume-policy}.ts`),
    CNC Pause/Resume (`src/ui/state/laser-job-pause-resume.ts`), Abort/reset cleanup
    (`laser-reset-cleanup.ts`, `laser-error-line.ts`), the external run (`src/ui/gcode-inspector/external-run.ts`,
    `src/core/external-program/external-program-review.ts`).
  - RPM mapping: `src/ui/machine/{SpindleScaleChoice.tsx,use-spindle-scale-choice.ts,cnc-detected-apply.ts}`,
    `src/ui/laser/device-setup/{device-setup-accept-detected,device-setup-firmware-diff}.ts`,
    `src/core/preflight/controller-readiness{,-messages}.ts`, `src/ui/state/cnc-controller-caps.ts`,
    `src/core/cnc/compile-cnc-helpers.ts` (`capSpindle`).
  - Machine hours: `src/ui/state/machine-hours{,-store,-persistence,-tracker}.ts`,
    `src/ui/app/use-machine-hours-tracking.ts`, `src/ui/laser/MachineHoursSection.tsx`, and the
    live-run lifecycle they read (`src/ui/state/live-canvas-run.ts`, `laser-post-job-settle.ts`).
  - Twins: `src/core/job/{estimate-duration,cnc-duration-overhead}.ts`, `src/core/invariants/cnc-motion.ts`,
    `src/core/preflight/standalone-cnc-preflight.ts`, Job Review time tile.
  - Governing documents: ADR-209 (spin-up), ADR-180 Amendments 2, 5 and 6, ADR-411 and Amendment 1,
    ADR-215, ADR-399, ADR-502, ADR-630 and Amendment 1, ADR-111/322 §6 (detected `$30`), PROJECT.md
    non-negotiable 21.
- **Primary sources fetched this session:**
  - GRBL v1.1 wiki: Configuration (`$30`, `$31`, `$32`) and Laser Mode.
  - gnea/grbl `gcode.c`, `protocol.c`, `spindle_control.c`, `motion_control.c` (`mc_dwell(float seconds)`).
  - grblHAL core `gcode.c`, `motion_control.c`, `spindle_control.c`, `settings.h` (`$340`, `$392`, `$394`, `$539`).
  - FluidNC `Spindles/Spindle.cpp`, `Spindles/Spindle.h`, `GCode.cpp`, `Protocol.cpp`, `Parking.cpp`.
  - OpenBuilds Fusion 360 GRBL post (`OpenbuildsFusion360PostGrbl.cps`) for the spin-up dwell convention.
  - The FluidNC wiki config page timed out, so FluidNC facts come from its source.
- **Lenses run:** L1, L2, L3, L4, L5 and L7 as separate passes. L6 was folded into Q3 (Abort,
  rejected line, alarm). L5 was limited to the persisted hours book and `.lf2` spindle parameters,
  because the external-file trust boundary belongs to area 26.
- **Counts:** 8 raised → refuter: confirmed 8 / plausible 0 / refuted 0 → P1 0 / P2 2 / P3 6
  (+7 KNOWN). Severity changes: none.

## Headline

KerfDesk's own CNC program brings the spindle to speed correctly. An independent spindle
oracle over five job shapes found what the emitter promises: every M3 at safe Z, the configured
`G4` after every start, and M5 before every hold and at the end. The shapes were one bit, an RPM
change on one bit, three bit changes with flood and a park height, a 0 s spin-up, and fractional RPM.
The time estimate's dwell matches the emitted `G4`s exactly. GRBL, grblHAL and FluidNC all read
`G4 P` as seconds.

The two P2s are both outside the emitter:

- **External CNC runs.** A CAM file run through **Run G-code file** in CNC mode never has the
  controller's `$32` or `$30` checked. A router left in laser mode runs the post's spin-up dwell
  with the spindle off, and plunges with the bit not at speed. The Run dialog says nothing, although
  the project's own CNC Start and the laser external run both check these settings.
- **FluidNC Pause.** On FluidNC a CNC Pause stays in the cut, because Pause and lift is not
  qualified there. The Resume advice then says the controller "waits a fixed spin-up delay".
  FluidNC's door restore waits only `spinup_ms`, which defaults to 0.

Machine hours count the right time. But Pause and lift splits one job into two, and editing the bed
size or controller kind moves the machine to an empty record, which restarts its maintenance
reminders.

## Spindle events → emitted lines per dialect

CNC output is GRBL-family only (ADR-399). Marlin and Smoothieware refuse CNC Start and Frame
(`start-job-readiness-policy.ts:32`), and a CNC export to them carries an advisory
(`cnc-export-controller-advisory.ts`). Unless a row says otherwise, the bytes are identical for
GRBL 1.1, grblHAL and FluidNC. The firmware column says what the controller adds on its own.

| Event | Lines KerfDesk emits or sends | Firmware behaviour (GRBL / grblHAL / FluidNC) | Source |
|---|---|---|---|
| Job start | `G21` `G90` `G54` `G94` `G17`, `G0 Z<safe>`, `M3 S<round(min(rpm, spindleMaxRpm))>`, `G4 P<spinup>` (none at 0 s, ADR-209), `[M7\|M8]` | GRBL: M3 synchronises, then `mc_dwell` waits in seconds. grblHAL: M3 also waits for at-speed when `$340` > 0 and the spindle reports it, plus `$394`. FluidNC: M3 waits `spinup_ms` × ΔS/max (default 0), then G4 waits P × 1000 ms | `cnc-grbl-strategy.ts:116-138`; `cnc-grbl-transitions.ts:125-139`; `compile-cnc-helpers.ts:78-81` |
| RPM change, same bit | `G0 Z<group safe>`, `M3 S<new>`, `G4 P<spinup>` (the full delay) | as job start | `cnc-grbl-transitions.ts:79-82`; `spindle-transition.ts:11-17` |
| Bit change (multi-tool) | `G0 Z<park ≥ safe>`, `M5`, `[M9]`, `G0 X<park> Y<park>`, `; load …`, `M0` (held host-side, never sent), `G21 G90 G54 G94 G17`, `G0 Z<max safe>`, `M3 S`, `G4 P`, `[M7\|M8]` | M5: GRBL stops at once. grblHAL waits `$539` off delay. FluidNC waits `spindown_ms` (default 0) | `cnc-grbl-transitions.ts:90-120`; `cnc-pause-reentry-program.ts:110-111` |
| Job end | `G0 Z<park/safe>`, `M5`, `[M9]`, `G0 X Y` (no M2/M30) | as above | `cnc-grbl-strategy.ts:158-175` |
| Pause | realtime `0x84` (door) | Spindle and coolant stop once the hold completes. GRBL and grblHAL then get Pause and lift: a soft reset, then `G0 Z<highest rapid since last M0>`. FluidNC is not qualified, so the bit stays in the cut | `laser-job-pause-resume.ts:107-170`; `cnc-pause-reentry.ts:49,90-92` |
| Resume, door (not lifted) | `~` | GRBL restores the spindle and waits `SAFETY_DOOR_SPINDLE_DELAY` (4 s), but skips the wait at `$32=1`. grblHAL waits `$392`. FluidNC calls `restore_spindle()`, which waits only `spinup_ms` (default 0) | `protocol.c` (gnea); `Parking.cpp:147-186` (FluidNC); **P2-2** |
| Resume, lifted | `G21 G90 G54 G94 G17`, `G0 Z<lift>`, `M3\|M4 S<program S>`, `G4 P<program dwell, or 4 s when 0>`, `[M7][M8]`, `G0 X Y`, `G1 Z<stop> F<plunge>`, `G0\|G1 F<feed>`, then the stream replays. Overrides are restored before this | — | `cnc-pause-reentry.ts:157-169,282-306`; `cnc-pause-lift-overrides.ts` |
| Abort / disconnect | `0x18`, then after the banner `M5` plus the driver's stop lines (M5 is always added) | `mc_reset` stops the spindle | `laser-reset-cleanup.ts:71-75`; `laser-store-helpers.ts:226-245` |
| Rejected line (`error:N`) | KerfDesk's own reset, then the same cleanup | — | `laser-error-line.ts` (`plannedRejectionResetPatch`) |
| Alarm | none from KerfDesk | GRBL and grblHAL: `mc_reset` stops the spindle. FluidNC: `spindle->stop()` (`Protocol.cpp:751`, when `off_on_alarm`) | — |
| Supervised pass recovery | the ordinary emitter preamble (safe Z, M3, G4) on a new Job | — | `cnc-pass-resume-job.ts:8-10`; ADR-215 |
| Start from line / automatic resume | refused for CNC | — | `resume-program.ts:73-75`; `StartFromLineControl.tsx:42-43` |
| External CNC run | the file's bytes after the baseline `G17G21G90G94G0`; KerfDesk adds no spindle lines, and `M0` goes to the controller | firmware as above | ADR-630; **P2-1** |
| Surfacing (file only) | `G0 Z<safe>`, `M3 S`, `G4 P`, rows, `G0 Z<safe>`, `M5`, `G0 X0 Y0` | as above | `surfacing.ts:146-182` |

Post convention, for comparison: the OpenBuilds Fusion GRBL post dwells `spindleOnOffDelay`
(1.8 s) after the first M3, and half that after an RPM change. It writes no dwell after M5 (that
line is commented out). KerfDesk dwells the full time on every start and change, and also writes
none after M5.

## Findings

### P2-1 — An external CNC run never checks `$32` or `$30`, so a router left in laser mode runs a CAM program with the spindle off during its dwell and every plunge starting from a stopped bit

- **Where:**
  - `src/ui/gcode-inspector/external-run.ts:218-232`. Only the laser acknowledgement looks at
    controller settings. The CNC path gets the workholding attestation only.
  - `src/ui/laser/laser-mode-start-acknowledgement.ts:32` returns `undefined` for any non-laser
    project.
  - `src/core/external-program/external-program-review.ts:322-332`. The only CNC machine-mode
    warning is "never moves Z".
  - The review context carries no controller settings
    (`ExternalProgramContext`, `external-program-review.ts:32-40`).
- **Anchor:**
  - **Twin:** a project CNC Start runs `runControllerReadiness` and shows `laser-mode-enabled`
    (with **Send $32=0**) and `spindle-scale-mismatch` in Job Review
    (`controller-readiness.ts:117-121,171-187`; ADR-180 Amendments 5 and 6). The laser external run
    asks for a `$32`/`$30` acknowledgement (`external-run.ts:218-224`; ADR-630 "Review and Start").
  - **Ground truth:** GRBL Laser Mode wiki: switching back to a spindle you "**MUST** disable laser
    mode by sending Grbl a `$32=0` command". gnea `gcode.c` disables spindle output on non-G1/G2/G3
    motion in laser mode. `protocol.c`: "When in laser mode, ignore spindle spin-up delay".
- **Scenario:**
  1. A router, or a laser+router machine, still has `$32=1` from a laser session. KerfDesk is in
     CNC mode.
  2. The operator runs a VCarve or Fusion program (`M3 S18000`, `G4 P3`, `G0`, `G1 Z-2 …`) through
     **Run G-code file**.
  3. The Run dialog lists no warning. The attestation names only workholding and access.
  4. GRBL runs the post's dwell with the spindle at 0, because the modal G0 disables it. It stops
     the spindle at every `G0` retract and only powers it as each `G1` plunge begins, so the bit
     enters the stock not at speed.
  5. A CNC Pause→Resume restarts motion with no spin-up.
  6. With `$30=1000` left from the laser, `S18000` also saturates silently.

  The same controller state on a project CNC Start produces both warnings.
- **Evidence:** REPRO (`d4-repros/src_ui_gcode-inspector_zz-d4-external.test.ts`):
  `{"cncReviewWarnings":[],"confirmCalls":0,"attestationMentions32":false,"projectReadinessCodes":["spindle-scale-mismatch","laser-mode-enabled"]}`.
  `confirmLaserModeStartEvidence` returned `undefined` for the CNC project.
  - **Novelty:** 26-gcode-viewers notes "There is no Job Review or preflight for an external run",
    but raises nothing about `$32`/`$30`. JR-1 and MC-1 (2026-09-24) predate ADR-630.
  - No open PR touches this. #1380 and #1384 change `external-program-review.ts`, but not for this.
- **Refuter:** CONFIRMED (P2 kept).
  - **SOURCE, fetched by the refuter:**
    - The GRBL wiki's Laser Mode page: "a `G0` rapid motion mode … will never turn on and always
      disable the laser", and `G0 M3 S1000` "will not turn on the laser".
    - gnea `gcode.c`: any non-G1/G2/G3 block sets `GC_PARSER_LASER_DISABLE`, so `M3 S18000` under
      modal `G0` runs `spindle_sync(M3, 0)`, and each `G1` block carries S.
    - `protocol.c`: the door restore skips `delay_sec(SAFETY_DOOR_SPINDLE_DELAY)` in laser mode.
    - So with a PWM-driven spindle, the post's `G4` runs at 0, every `G0` stops the spindle, and
      each `G1` plunge starts it from rest.
  - **READ:**
    - `startExternalProgram` only adds `$32` evidence for laser projects
      (`laser-mode-start-acknowledgement.ts:32`).
    - The review context that `RunGcodeFileDialog.tsx:94-104` builds carries no controller
      settings.
    - The store-level start assertions (`laser-start-program-assertions.ts:55`) check laser only.
    - `laser-mode-enabled` is produced only by `runControllerReadiness`. Only the project Start
      path and the export advisories call it.
  - **REPRO, the refuter's own end-to-end store test:** a connected GRBL in CNC mode with
    `$32=1`, `$30=1000`, through `startExternalProgram`. Output:
    `{"result":true,"streamer":"streaming","liveCanvasRun":null,"sentM3":true,"promptMentions32":false,"projectReadiness":["spindle-scale-mismatch","laser-mode-enabled"]}`.
    The only prompt was the workholding attestation.
  - **Corrections:**
    - Step 5 is overstated. During a paused external CNC run, `cncResumeAdvisoryNotice` already
      shows the laser-mode Resume warning, and Pause and lift refuses at `$32≠0`.
    - A relay router wired to a separate enable pin may keep running, because stock GRBL does not
      drop enable at PWM 0 (`spindle_control.c`). The hazard is for PWM-speed spindles, which the
      project path's own warning also assumes.
    - ADR-630 Decision lists only the attestation for CNC. It does not exclude a `$32` check, so
      the omission is not a decision.
  - **Severity:** P1 is arguable, since the result is silent and physical. P2 is kept because the
    fault needs a non-default leftover controller setting, and KerfDesk sends the file's own
    bytes unchanged. The twin's remedy is an advisory, not a gate, so the gap is a missing
    warning with a clear failure scenario.
- **Fix direction:**
  - For an external CNC run, feed `runControllerReadiness`'s laser-mode and spindle-scale findings
    into the Run dialog's warnings, and offer the same Send `$32=0`.
  - Optionally require the same acknowledgement the laser external run requires.

### P2-2 — On FluidNC a CNC Pause leaves the bit in the cut, and the Resume advice promises a spin-up wait that FluidNC's default configuration does not make

- **Where:**
  - `src/ui/state/cnc-pause-resume-policy.ts:10-13,54-74`. The advice branches on `$32` only, never
    on the firmware.
  - `src/core/recovery/cnc-pause-reentry.ts:49,90-92`. Pause and lift is qualified on `grbl-v1.1`
    and `grblhal` only (`controllerKind: driver.kind`, `cnc-pause-lift.ts:128`).
  - `src/ui/state/laser-job-pause-resume.ts:107-113`. Every GRBL-family driver gets the door byte
    for a CNC Pause, and `fluidnc/driver.ts:85` spreads `grblDriver`.
- **Anchor:**
  - **Ground truth:** FluidNC `Spindles/Spindle.h:182-188`: `spinup_ms` is "@default 0", the
    "Time given for the spindle to reach the commanded RPM". `Spindle.cpp:273-282` scales that
    delay by the speed change. `Parking.cpp:147-158,185-186`: the door restore runs
    `restore_spindle()` → `spindle->setState(saved_spindle, saved_spindle_speed)` and adds no
    other delay, unlike GRBL's `SAFETY_DOOR_SPINDLE_DELAY` and grblHAL's `$392`.
  - **Contract:** ADR-180 Amendment 5, decision 2, words the advice around GRBL's fixed delay.
    ADR-411 Amendment 1 exists so that Resume does not restart the spindle in the wood.
- **Scenario:**
  1. A FluidNC router at `$32=0`, for example a relay-switched trim router with `spinup_ms` left
     at 0, is paused mid-pass.
  2. Lift is refused ("Pause and lift is not qualified on fluidnc."). The bit stays in the kerf.
  3. The panel says Resume "restarts the spindle, waits a fixed spin-up delay (4 s in stock GRBL),
     then continues".
  4. FluidNC switches the spindle on and continues the line at cutting feed at once. The bit is
     dragged through the cut while it accelerates: the MC-1 hazard, with advice that says the
     opposite.
- **Evidence:**
  - SOURCE as above.
  - REPRO (`d4-repros/src_ui_state_zz-d4-door.test.ts`): `planCncPauseReentry` gives
    `{"fluidnc":"no-lift","reason":"Pause and lift is not qualified on fluidnc.","grbl":"plan"}`,
    and `cncResumeAdvisoryNotice('cnc', false, null, reason)` gives "… If it still cannot: Resume
    restarts the spindle, waits a fixed spin-up delay (4 s in stock GRBL), then continues …".
  - **Novelty:** no audit or ADR mentions FluidNC `spinup_ms` or its door restore. C6 checked only
    that FluidNC honours `0x84`.
- **Refuter:** CONFIRMED (P2 kept).
  - **The hold-versus-door question:**
    - A FluidNC feed hold `!` would keep the spindle on. `protocol_manage_spindle` only spins down
      on a spindle-stop override.
    - But KerfDesk does not send `!` here. `fluidncDriver` spreads `grblDriver.realtime`, so CNC
      Pause sends `0x84`. The refuter's repro: `pauseByte` `84`.
    - FluidNC `RealtimeCmd.cpp` maps `0x84` to `safetyDoorEvent`.
    - In `Protocol.cpp`, `protocol_exec_rt_suspend` runs `Parking::park()`. That calls
      `spindle->spinDown()` in both the parking and the "Spin down only" branch, so the spindle
      does stop.
  - **SOURCE, fetched by the refuter (bdring/FluidNC main):**
    - `Parking::unpark()` calls `restore_spindle()`, which is `spindle->setState(saved…)`.
      `Protocol.cpp` then at once sets Idle and sends `cycleStartEvent`. No other delay is added.
    - The only wait is in `Spindle.cpp`'s `spinDelay`: `_spinup_ms * up / maxSpeed()`.
    - `Spindle.h` `groupDelaySettings`: `spinup_ms` "@default 0".
  - **REPRO, the refuter's own test:** `planCncPauseReentry` gives
    `{"fluidnc":"no-lift","grbl":"plan"}`. `cncResumeAdvisoryNotice('cnc', false, null, reason)`
    returns "… If it still cannot: Resume restarts the spindle, waits a fixed spin-up delay (4 s in
    stock GRBL), then continues …".
  - **FluidNC's `$32` proxy:** it is `spindle->isRateAdjusted()`
    (`fluidnc-read-only-settings.ts:8`), so a router reports `$32=0` and gets this advice. The
    "unconfirmed" variant would have been accurate.
  - **Scope narrowing:**
    - The defect needs an OnOff, PWM or relay spindle (or H-bridge), or a VFD without speed
      feedback, with `spinup_ms` left at 0.
    - A FluidNC Modbus VFD with speed feedback polls until it is at speed (`VFDSpindle.cpp`
      `setState`, the `_syncing` loop). It is not affected.
    - The advice text already says the bit spins up engaged. What is wrong is the promised wait
      before motion.
- **Fix direction:**
  - Make the advice firmware-aware. On FluidNC, say it waits only its configured `spinup_ms`
    (0 by default), and recommend Abort with pass recovery, or setting `spinup_ms`.
  - Alternatively, qualify Pause and lift on FluidNC.

### P3-1 — Pause and lift replaces the live run's plan object, so machine hours count one job as two

- **Where:**
  - `src/ui/state/cnc-pause-reentry-run.ts:138-143` writes
    `plan: { ...state.liveCanvasRun.plan, positionEpoch: … }`.
  - `src/ui/state/machine-hours-tracker.ts:36-58` treats a different plan object as a new run: it
    ends the old one (`jobEnded: true`) and opens a new clock.
  - `src/ui/app/use-machine-hours-tracking.ts:33-35` also re-captures the machine at that moment.
- **Anchor:** Contract: ADR-502 Decision 1 says "The job ends at its first stop, disconnect, error
  or finish". A resumed pause is none of those.
- **Scenario:** a CNC job paused once with Pause and lift, resumed, and finished shows **2 jobs**
  in Machine hours. Every lifted pause adds one more. The hours themselves stay correct.
  - The same plan swap drops the run out of the plan-keyed program registry
    (`canvas-program-source.ts:6-13`), so the G-code Inspector's live progress
    (`use-inspector-live-progress.ts:33-35`) loses its source after a lifted resume. That is READ
    only, and outside D4.
- **Evidence:** REPRO (`d4-repros/src_ui_laser_zz-d4-hours.test.tsx`, which drives the real hook
  and stores): `pause-lift record {"runMs":240000,"jobs":2}`.
- **Refuter:** CONFIRMED (READ, plus the auditor's REPRO).
  - `cnc-pause-reentry-run.ts:137-143` spreads a new `plan` object.
  - `advanceRunClock` tests `clock.plan === run.plan`. On a mismatch it calls `endRun`, which
    returns `jobEnded: true`.
  - `addRunTime` then adds `jobs + 1` (`machine-hours.ts:86`), and the new clock adds another job
    later.
  - ADR-502 Decision 1 lists no resumed pause among the job's end points.
- **Fix direction:**
  - Keep the plan's identity, for example by holding `positionEpoch` outside `plan`.
  - Or key the run clock on `startedAtMs` plus the streamer epoch instead of the plan object.

### P3-2 — Editing the bed size or controller kind moves the machine to an empty hours record and restarts its maintenance reminders

- **Where:**
  - `src/ui/laser/device-setup/device-setup-nudge.ts:19-26`. The key is
    `${profileId ?? name}:${bedWidth}x${bedHeight}:${controllerKind}`.
  - It is used for hours by `use-machine-hours-tracking.ts:14-21` and `MachineHoursSection.tsx:24-29`.
  - `machine-hours.ts:61-68` makes a fresh record for an unknown key.
- **Anchor:** Contract: ADR-502 Decision 2 says hours "belong to the machine the job started on".
  Its Consequences list only the shared generic profile, not a re-key on edit.
- **Scenario:**
  1. The lens reminder is 0.5 h from due (19.5 h run).
  2. The operator corrects the bed width in Machine Setup, or switches the firmware row, for
     example from GRBL to grblHAL (C7-P2-2).
  3. The rail now shows 0.0 h over 0 jobs, and the lens is due in 20 h.
  4. The old record stays in storage, unreachable.
- **Evidence:** REPRO (same file):
  `{"before":"generic-grbl-400x400:400x400:grbl-v1.1","after":"generic-grbl-400x400:410x400:grbl-v1.1","runMsBefore":70200000,"runMsAfter":0,"lensDueInBefore":0.5,"lensDueInAfter":20,"orphanStillStored":70200000}`.
- **Refuter:** CONFIRMED as behaviour, at P3. The contract anchor is wrong and is re-anchored.
  - The code matches the contract: the same sentence of ADR-502 Decision 2 names the key
    ("`deviceProfileSignature`: profile, bed and controller, with CNC apart from laser"), and the
    code uses exactly that key (`device-setup-nudge.ts:19-25`).
  - What stands is doc drift plus polish. A bed or controller correction strands the record and
    restarts the reminders, and ADR-502's Consequences do not say so.
- **Fix direction:**
  - Key hours on a stable machine identity (the profile id plus the machine kind), or carry the
    record across a signature change in Machine Setup's save.
  - Otherwise record the reset in ADR-502's Consequences.

### P3-3 — Jobs run through "Run G-code file" never count toward machine hours or jobs

- **Where:**
  - `src/ui/gcode-inspector/external-run.ts:235-258` passes no `canvasPlan`.
  - `src/ui/state/live-canvas-run.ts:172-180` returns `{}` without one.
  - `src/ui/state/laser-job-actions.ts:419-426`.
  - The tracker reads only `liveCanvasRun` (`use-machine-hours-tracking.ts:30`).
- **Anchor:**
  - Contract: ADR-502's Context says the hours are to be "how long a machine had run", and the
    panel copy says "Measured while jobs run" (`MachineHoursSection.tsx:39`).
  - Twin: the camera transient job, recovery runs and the second pass all pass a canvas plan and
    are counted.
- **Scenario:** a router owner who cuts mostly VCarve files through Run G-code file (ADR-630's
  stated audience) sees 0 h and no maintenance reminders, however long the machine runs.
- **Evidence:** READ (the chain above). Before an external run, `liveCanvasRun` is either null or
  the previous run's terminal record, and terminal runs are never reopened
  (`machine-hours-tracker.ts:47-49`).
- **Refuter:** CONFIRMED (REPRO plus READ).
  - The refuter's end-to-end external CNC Start left `liveCanvasRun: null` while the streamer was
    `streaming`.
  - `liveCanvasStartPatch(undefined)` returns `{}`.
  - The live-run update never touches a terminal run (`live-canvas-run.ts:44-49`).
  - ADR-502 predates ADR-630, so external runs were never weighed.
- **Fix direction:**
  - Give the external run a minimal live-run identity that the hours clock can follow.
  - Or have the tracker also follow the streamer's own run (start, held, terminal).

### P3-4 — The Machine hours panel never refreshes from another window

- **Where:**
  - `src/ui/state/machine-hours-store.ts:50-68`. `reload` exists, but only tests call it.
  - There is no `storage` listener.
  - Twin: `src/ui/app/use-material-library-persistence.ts:72-87` and the user-macro library do
    listen ("The browser sends 'storage' only to the other windows of the app").
- **Anchor:** Twin, as above. ADR-502 Decision 2 limits only the cross-window *write* guarantee.
- **Scenario:**
  1. In the browser build, tab A runs the jobs and tab B shows the machine rail.
  2. Tab B keeps showing "Clean the lens · due in 0.5 h" and no "1 due" heading after tab A's job
     makes it due, until tab B itself writes or reloads.
  3. A **Done** in tab B still merges correctly, because `change` re-reads storage.
- **Evidence:** READ.
- **Refuter:** CONFIRMED (READ plus twin).
  - `src` has no `'storage'` listener for `kerfdesk.machine-hours.v1`.
  - Only `MachineHoursSection.test.tsx` calls `reload`.
  - The twins listen: `use-material-library-persistence.ts:84` and
    `use-user-macro-library.ts:37`.
  - The scenario is niche, because Web Serial allows one connected tab. P3 is right.
- **Fix direction:** subscribe the store to `storage` events for `kerfdesk.machine-hours.v1` and
  call `reload`.

### P3-5 — Neither CNC motion invariant knows that a bit-change `M0` loses Z, so an `M3` or XY rapid straight after a tool-change stop passes both

- **Where:**
  - `src/core/invariants/cnc-motion.ts:101-135` (`findSpindleStartClearanceIssues`) keeps the
    pre-`M0` modal Z.
  - `findPlungedTravelIssues` behaves the same way.
- **Anchor:** Twin with the emitter's own invariant (`cnc-grbl-transitions.ts:85-89,108-116`):
  "Touch-off leaves the new bit at Z0 … void all three". It is also the "tool-change touch-off:
  prove … retract-before-spindle" requirement of the 2026-07-13 spindle audit §9.17.
- **Scenario:** a generator that writes `G0 Z5`, `M5`, `M0`, `M3 S10000`, `G4 P2`, `G0 X12 Y0`
  (the shape of 09-P3-2's wrap program) passes both checks.
  - Latent today: the main emitter lifts after every `M0`, and the only caller of the spindle check
    is surfacing, which has no `M0` (`standalone-cnc-preflight.ts:128`).
  - `emitStandaloneCncGcode` has no production caller.
  - This leaves the touch-off case with no post-emit guard if the emitter regresses.
- **Evidence:** REPRO (`d4-repros/src_core_output_zz-d4-spindle.test.ts`):
  `M0 no-lift issues []` and `M0 no-lift plunged-travel []`.
- **Refuter:** CONFIRMED (READ plus the auditor's REPRO).
  - `cnc-motion.ts` has no `M0` or `M1` handling at all.
  - The spindle check's only callers are the standalone/surfacing paths: `standalone-cnc-gcode.ts`
    (whose `emitStandaloneCncGcode` has no production caller) and `surfacing-worker-runtime.ts`.
  - Novelty note: this is the still-open tool-change bullet of 2026-07-13 §9.17 ("tool-change
    touch-off: prove … retract-before-spindle"). The coordinator may class it KNOWN-residual.
- **Fix direction:**
  - Reset modal Z to unknown at a tool-change `M0` in both scanners.
  - Run the spindle-start check on the main CNC preflight as well.

### P3-6 — `spindle-transition.ts` says its decision drives "deterministic dwell timing", but that consumer (`cnc-duration-overhead.ts`) is dead code tested only by a fixture

- **Where:**
  - `src/core/cnc/spindle-transition.ts:9-10`.
  - `src/core/job/cnc-duration-overhead.ts:14-62` has no production import. Its only user is
    `src/__fixtures__/cnc-repair/drilling.test.ts:39-40`.
  - The shipped estimate times the emitted `G4` lines (`estimate-duration.ts:57-87`).
- **Anchor:** Twin, documented versus actual. METHOD L7: the drilling test asserts
  `retractSeconds` from a function no estimate uses, and that function prices retracts at the
  laser's `device.maxFeed` (the 09-P2-1 pattern).
- **Scenario:** a maintainer who changes the transition rule, or reads the comment, believes the
  estimate follows through this function. The estimate is right only because it parses the output.
  The fixture assertion gives no evidence about the shipped time.
- **Evidence:**
  - READ, plus `grep -rn "cnc-duration-overhead\|cncDurationOverhead" src`, which shows the
    definition and one fixture test only.
  - The oracle repro confirms that the shipped twin agrees: emitted dwell equals the estimate's
    `dwellSeconds` in all five cases (3/3, 6/6, 9/9, 0/0, 6/6 s).
- **Refuter:** CONFIRMED (READ).
  - A grep for `cncDurationOverhead` or `cnc-duration-overhead` in `src` finds only the
    definition and `__fixtures__/cnc-repair/drilling.test.ts`. No barrel re-exports it.
  - The comment at `spindle-transition.ts:9-10` is as quoted.
- **Fix direction:**
  - Delete `cnc-duration-overhead.ts` and its fixture assertion, and correct the comment.
  - Or wire it in deliberately and test it against the emitted program.

## KNOWN (re-observed, not raised)

- **K-1, JR-8 (2026-09-24 CNC full audit, "still open" on 2026-09-29).** RPM below `$31` runs at
  `$31`.
  - Re-observed: `cncReadiness` ignores `$31` entirely (`controller-readiness.ts:149-189`), and
    the firmware diff leaves `$31` out for CNC (`device-setup-firmware-diff.ts:116-129`).
  - So a non-zero `$31` also shifts every S between `$31` and `$30`
    (gnea `spindle_control.c:197-213`: `(rpm-settings.rpm_min)*pwm_gradient`), and `$30 ≤ $31`
    gives full output for any S.
  - Same root. Not re-raised.
- **K-2, JR-6.** The Job Review operation card shows the stored layer RPM
  (`JobReviewCncOperationCard.tsx:69`), not the capped S the program sends
  (`job-review-effective-operations.ts:217`).
- **K-3, 2026-07-13 spindle architecture audit §2.5, §9.5, §9.9.**
  - Spin-up is time-only, with no at-speed evidence.
  - No zero-speed or coast-down wait follows M5 at the bit-change hold, at Abort or at job end.
    Stock GRBL has none; grblHAL `$539` and FluidNC `spindown_ms` can add one.
  - The OpenBuilds post likewise writes no dwell after M5.
- **K-4, 09-P3-2.** The wrap reference program starts the spindle after `M0` with no Z lift. It
  also writes `G4 P0` for a 0 s spin-up and repeats `M3`/`G4` for every path.
- **K-5, GC-3 (2026-09-24, partly fixed).** A spin-up between 0 and 0.0005 s writes `G4 P0.000`.
  The estimate uses the same representation, so the twin holds.
- **K-6, C5-K-5 / 2026-07-13 §9.14 and the ADR-373 residual (C8).** Console `M3`/`M4` at Idle,
  and an Idle spindle-override press re-energising a modal M3 (gnea `protocol.c`:
  `spindle_set_state(gc_state.modal.spindle, …)` at Idle).
- **K-7, 09 Refuted.** `G4 P` read as milliseconds by Marlin or Smoothieware CNC: by design
  (ADR-399). Start and Frame refuse there, and export warns.

## Refuted

The refuter refuted no raised finding. It rejected one anchor: P3-2's contract-break reading,
because ADR-502 Decision 2 names the bed and controller key. The finding stays as doc drift.

The refuter spot-checked these "Verified clean" claims against fetched sources, and all hold:

- FluidNC `G4`: `GCode.cpp:2035` `mc_dwell(int32_t(p * 1000))`, so P is in seconds.
- FluidNC door: `0x84` → `park()` → `spinDown()`.
- GRBL door restore: waits 4 s, and skips the wait at `$32=1`.
- Reset cleanup: `resetCleanupLines` always adds `M5`.
- Live caps: `cncLiveCapsFromController` passes only `$110`–`$112`.

Candidates the auditor dropped:

- *A 0 s spin-up writes no dwell, so the plunge follows M3 at once.* Decided: ADR-209 says "zero
  emits no `G4` dwell". Pause and lift falls back to 4 s by its own amendment (ADR-411 Amd 1).
- *A layer at 0 RPM emits `M3 S0` and cuts with a stopped bit, because `cnc-settings-invalid` is
  advisory.* Not reachable:
  - the RPM field minimum is 1000 (`CncLayerAdvancedFields.tsx:168`);
  - project load keeps a positive value (`normalize-layer.ts:116`);
  - surfacing requires a positive value.

  Note, unraised: the comment at `cnc-preflight.ts:260` calls a non-positive RPM a
  compile-integrity failure, but `cnc-settings-invalid` is not in `COMPILE_INTEGRITY_PREFLIGHT_CODES`.
- *Auto-seeded feeds use the controller's `$30` as an RPM cap.* No.
  `cncLiveCapsFromController` passes only `$110`–`$112` (`cnc-controller-caps.ts:12-19`). The
  `controller.$30` candidate in `resolve-cnc-machine-starter.ts:107-110` never receives a value.
- *A spindle left running after a rejected line.* No. `laser-error-line.ts` runs a planned reset,
  and its cleanup includes M5.
- *Fractional RPMs (11999.6, then 12000.2) re-issue `M3 S12000` plus a full `G4` for the same
  spindle speed.* Reproduced, but it costs only time, and the RPM field steps by 500. Dropped.
- *The firmware's own spin-up and spin-down delays (FluidNC `spinup_ms`, grblHAL `$394`/`$539`)
  are missing from the time estimate.* Configuration-dependent and 0 by default on FluidNC. Dropped.

## Verified clean

- **Q1, spin-up before plunge, emitter.** The independent oracle checked five cases: one bit; an
  RPM change on one bit; t1/t2/t1 with flood and park Z 30; a 0 s spin-up; fractional RPM. It
  tracked M3/M5, dwell after the last M3, and modal Z, treated as unknown after `M0`.
  - Every feed move ran with the spindle on, S > 0 and the configured `G4` after the latest M3.
  - Every M3 was at Z ≥ safe Z, including after both `M0`s.
  - M5 preceded every `M0` and the end.
  - The S sequence matched the expected RPMs: 12000/8000, 12000/18000/12000, 12000/9000.
  - Results: `problems: []` in all five cases. The Pause-and-lift re-entry spins up above the
    cut before its XY move and plunge, and restores overrides first. CNC pass recovery reuses the
    emitter preamble. Start from line and automatic resume are refused for CNC.
- **G4 units.** Seconds on all three GRBL-family firmwares:
  - gnea `motion_control.c:195` `mc_dwell(float seconds)`;
  - grblHAL `motion_control.c:828`;
  - FluidNC `GCode.cpp:2035` `mc_dwell(int32_t(gc_block.values.p * 1000.0f))`.
- **Q2, RPM mapping.**
  - S = `Math.round(min(rpm, spindleMaxRpm))`.
  - Readiness compares `$30` with Spindle maximum exactly, and a mismatch is a Job Review warning
    with the fix ("Set `$30=…`", or FluidNC `speed_map`).
  - `SpindleScaleChoice` appears only for CNC with `$32=0` reported and `$30 > 0`. It copies `$30`
    only on an explicit tick, bound to this session and this exact value.
  - Live caps never treat `$30` as RPM.
  - On the project path, laser mode on a router is detected (`laser-mode-enabled`, Send `$32=0`,
    the router `$32≠0` write refusal), and Pause and lift requires a confirmed `$32=0`
    (`cnc-pause-lift.ts:180`).
- **Q3, spindle off.**
  - M5 at job end and before the bit-change hold.
  - The door byte stops the spindle on Pause, on all three firmwares.
  - Abort and reset cleanup always include M5.
  - A firmware alarm resets the spindle.
  - Resume restores direction and RPM: the firmware on a door resume, the program's modal
    `M3`/`M4` and S on a lifted re-entry.
- **Q4, machine hours.**
  - Only `running` counts. `paused` and `tool-change` stop the clock, and the door, Hold:0 and
    the M0 hold all map to `paused`.
  - A stopped, disconnected or errored job counts the time it ran.
  - A flush happens about every 60 s, so a crash loses under a minute.
  - Remounting on a terminal run counts nothing.
  - Storage reads validate every field. Failed writes keep pending updates, which are re-applied
    on the next re-read without double counting.
  - Each newly-due reminder is announced once, to the machine the job started on.
- **Q5, twin.** The time estimate parses the emitted program, so the spindle dwell in the Job
  Review time tile ("spindle dwell") equals the emitted `G4`s (oracle: 3/3, 6/6, 9/9, 0/0, 6/6 s).

## Not verified

- **No hardware.** Real spin-up and coast-down times, grblHAL at-speed behaviour, and FluidNC door
  timing on a real board were not measured.
- **Post conventions.** The Vectric and Carbide Create GRBL posts were not fetched. Only the
  OpenBuilds Fusion post was.
- **Unexpected link loss.** What the spindle does after a mid-job link loss (the controller keeps
  executing its buffer with M3 commanded) was left to the reconnect and recovery audits (18-P2-1,
  2026-10-16).
- **Orphaned live runs.** No exhaustive search was made for a path that leaves `liveCanvasRun` in
  `running` after the job ends, which would make the hours clock keep adding wall time. The
  settle, release-at-Idle, disconnect and cancel paths that were read all terminalise it.
- **Wall clock.** The hours clock uses `Date.now()`, so a system clock jump or a sleep during a
  running job would be counted. Not tested.
- **Preview.** The preview and 3D views' handling of spindle state ("cut before spindle", WA-5)
  was not re-run.

```json
[
  {"id":"D4-P2-1","severity":"P2","area":"ctl-spindle-hours","file":"src/ui/gcode-inspector/external-run.ts","line":218,"anchor":"Twin: project CNC Start readiness laser-mode-enabled/spindle-scale-mismatch (controller-readiness.ts:117-187, ADR-180 Amd 5/6) and the laser external run's $32/$30 acknowledgement; Ground truth: GRBL Laser Mode wiki 'MUST disable laser mode ... $32=0', gcode.c laser disable on non-G1/2/3, protocol.c door delay skipped in laser mode","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Run G-code file in CNC mode never checks $32/$30: a router left at $32=1 runs the CAM dwell with the spindle off and plunges from a stopped bit, with no warning, while project CNC Start flags both"},
  {"id":"D4-P2-2","severity":"P2","area":"ctl-spindle-hours","file":"src/ui/state/cnc-pause-resume-policy.ts","line":10,"anchor":"Ground truth: FluidNC Spindle.h spinup_ms @default 0, Parking.cpp restore_spindle() with no separate delay; Contract: ADR-180 Amd 5 D2, ADR-411 Amd 1","evidence":"SOURCE+REPRO","verdict":"CONFIRMED","known":false,"summary":"On FluidNC, CNC Pause is a door pause left in the cut (lift not qualified) and Resume advice claims a fixed spin-up delay; FluidNC's door restore waits only spinup_ms (default 0), so motion resumes as the spindle starts"},
  {"id":"D4-P3-1","severity":"P3","area":"ctl-spindle-hours","file":"src/ui/state/cnc-pause-reentry-run.ts","line":142,"anchor":"Contract: ADR-502 D1 (job ends at first stop/disconnect/error/finish)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Pause-and-lift re-entry replaces liveCanvasRun.plan, so the hours tracker ends the job and opens another: one job counted as two (also drops Inspector live progress)"},
  {"id":"D4-P3-2","severity":"P3","area":"ctl-spindle-hours","file":"src/ui/laser/device-setup/device-setup-nudge.ts","line":24,"anchor":"Doc drift: ADR-502 D2 names the bed+controller key (refuter: contract-break reading refuted); Consequences list only the generic-profile share, not a re-key on edit","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Hours key includes bed size and controller kind: editing either moves the machine to an empty record (19.5 h -> 0 h, lens due 0.5 h -> 20 h), old record stranded"},
  {"id":"D4-P3-3","severity":"P3","area":"ctl-spindle-hours","file":"src/ui/gcode-inspector/external-run.ts","line":235,"anchor":"Contract: ADR-502 Context and panel copy 'Measured while jobs run'; Twin: camera/recovery/second-pass runs carry a canvas plan and count","evidence":"READ+REPRO(refuter)","verdict":"CONFIRMED","known":false,"summary":"Run G-code file jobs create no live run, so they never count toward machine hours or jobs"},
  {"id":"D4-P3-4","severity":"P3","area":"ctl-spindle-hours","file":"src/ui/state/machine-hours-store.ts","line":68,"anchor":"Twin: material library and macro stores listen to 'storage' events","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Machine hours panel in a second window never refreshes (reload unused, no storage listener); due reminders stay hidden there"},
  {"id":"D4-P3-5","severity":"P3","area":"ctl-spindle-hours","file":"src/core/invariants/cnc-motion.ts","line":101,"anchor":"Twin: emitter invariant cnc-grbl-transitions.ts:85-116 (touch-off leaves bit at Z0, void Z after M0); 2026-07-13 spindle audit §9.17","evidence":"REPRO","verdict":"CONFIRMED","known":"residual of 2026-07-13 spindle audit §9.17 tool-change bullet (refuter note)","summary":"Spindle-start clearance and plunged-travel scanners keep the pre-M0 Z, so M3 or an XY rapid right after a tool-change M0 passes both (latent)"},
  {"id":"D4-P3-6","severity":"P3","area":"ctl-spindle-hours","file":"src/core/job/cnc-duration-overhead.ts","line":14,"anchor":"Twin: spindle-transition.ts:9-10 claims a timing consumer; METHOD L7","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"cncDurationOverhead (the documented dwell-timing twin) is dead in production and tested only by a fixture; shipped timing parses emitted G4 (which agrees)"},
  {"id":"D4-K-1","severity":"P3","area":"ctl-spindle-hours","file":"src/core/preflight/controller-readiness.ts","line":149,"anchor":"Ground truth: gnea spindle_control.c rpm_min mapping; GRBL wiki $31","evidence":"SOURCE","verdict":"KNOWN","known":"2026-09-24 CNC full audit JR-8 (open 2026-09-29)","summary":"CNC readiness ignores $31; S below $31 runs at $31 and a nonzero $31 shifts the S-to-PWM map"},
  {"id":"D4-K-2","severity":"P3","area":"ctl-spindle-hours","file":"src/ui/laser/job-review/JobReviewCncOperationCard.tsx","line":69,"anchor":"Twin: emitted capped S","evidence":"READ","verdict":"KNOWN","known":"2026-09-24 CNC full audit JR-6","summary":"Job Review card shows stored layer RPM, not the capped S sent"},
  {"id":"D4-K-3","severity":"P3","area":"ctl-spindle-hours","file":"src/core/output/cnc-grbl-transitions.ts","line":92,"anchor":"2026-07-13 spindle audit §2.5/§9.5/§9.9","evidence":"READ","verdict":"KNOWN","known":"2026-07-13 spindle architecture audit","summary":"Time-only spin-up; no coast-down wait after M5 at bit change, Abort or end"},
  {"id":"D4-K-4","severity":"P3","area":"ctl-spindle-hours","file":"src/core/cnc/wrap/cnc-wrap-reference-program.ts","line":30,"anchor":"Twin: emitter post-M0 lift","evidence":"READ","verdict":"KNOWN","known":"rolling-v2 09-P3-2","summary":"Wrap reference program M3 after M0 without Z lift; G4 P0 at 0 s"},
  {"id":"D4-K-5","severity":"P3","area":"ctl-spindle-hours","file":"src/core/output/cnc-grbl-transitions.ts","line":138,"anchor":"GRBL harmless zero dwell","evidence":"READ","verdict":"KNOWN","known":"2026-09-24 CNC full audit GC-3","summary":"Sub-0.0005 s spin-up writes G4 P0.000"},
  {"id":"D4-K-6","severity":"P3","area":"ctl-spindle-hours","file":"src/core/controllers/console-state-effect.ts","line":97,"anchor":"gnea protocol.c Idle spindle override","evidence":"READ","verdict":"KNOWN","known":"C5-K-5, 2026-07-13 §9.14, ADR-373 residual (C8)","summary":"Console M3 at Idle; Idle spindle override re-energises modal M3"},
  {"id":"D4-K-7","severity":"P3","area":"ctl-spindle-hours","file":"src/ui/app/cnc-export-controller-advisory.ts","line":10,"anchor":"ADR-399","evidence":"READ","verdict":"KNOWN","known":"rolling-v2 09 Refuted","summary":"G4 P milliseconds on Marlin/Smoothieware CNC: by design, Start/Frame refused, export warns"}
]
```
