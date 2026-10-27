# Rolling audit v4 — Laser burn journey

- **When:** 2026-10-27   **Tree:** origin/main @ `a59f74ff9` (the audit worktree's `src` was identical).
  Every file cited below is also unchanged on `main` after #1460–#1463 merged: GitHub's latest commit
  for `transient-camera-job.ts` is `c9c9331f1` (2026-10-22), `gcode-command-actions.ts` `166b04713`,
  `RunGcodeFileDialog.tsx` `4f1c4bcec`, `native-bed-frame.ts` `96bff5fb1` and
  `connected-laser-power-scale.ts` `4790965d7`. #1463 touches `calibration-actions.ts` and
  `nudge-actions.ts` only in comments and the nudge result, not the transient compile.
- **Scope:** every way to produce a laser burn of one design, and the checks each one runs.
  - **Start:** `src/ui/laser/start-job-flow.ts`, `start-job-source.ts`, `start-job-readiness.ts`,
    `start-job-readiness-async.ts`, `start-machine-snapshot.ts`, `start-job-transmission.ts`,
    `output-preparation.ts`.
  - **Save G-code and its views:** `src/ui/app/save-gcode-emission.ts`, `GcodeSaveDialog.tsx`,
    `transactional-gcode-save.ts`, `file-actions.ts`, `save-rd-action.ts`,
    `src/ui/commands/gcode-command-actions.ts`, `src/ui/gcode-inspector/use-current-gcode.ts`.
  - **Run G-code file:** `src/ui/gcode-inspector/external-run.ts`, `external-run-readiness.ts`,
    `RunGcodeFileDialog.tsx`, `src/core/external-program/*`.
  - **Other entries:** Run again (`RunAgainControl.tsx`), second pass (`second-pass-execution.ts`),
    phone and MCP Start (`remote-control/machine-execution.ts:157-184`), the camera target and nudge
    ring (`camera/calibrate/transient-camera-job.ts`, `calibration-actions.ts`, `nudge-actions.ts`),
    and the Material and Interval tests (`commands/CalibrationGridDialogs.tsx`).
  - **Placement and power:** `src/ui/job-placement.ts`, `src/ui/state/native-bed-frame.ts`,
    `src/ui/laser/connected-laser-power-scale.ts`.
  - **Governing:** ADR-567, ADR-630 (Amendments 1 and 4), ADR-440 Amendment 1, ADR-441 Amendment 5,
    ADR-416 Amendment 2, ADR-228.
- **Lenses run:**
  - L9 entry-point parity (main lens): emitted G-code diffed with an independent G-code reader, and
    the checks diffed per path;
  - L3 twins;
  - L2, for the GRBL behaviour H1-P1-1 depends on (pinned source below);
  - L7, for the tests that claim parity.
  - L1 was used only for the ADR clauses cited. L4, L5 and L6 were not run: H2 covers interruption
    and recovery, and H8 covers the remote trust boundary.
- **Counts:** 4 raised → 0 refuted → P1 1 / P2 0 / P3 3 (+2 KNOWN).
- **Refuter (2026-10-27, fresh context):** 4 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED. No severity changes.
  - **Own repro.** One temporary Vitest file, `src/ui/camera/calibrate/zz-h1r-transient.test.ts`, since deleted. It was run with `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run <file> --reporter=verbose`.
    - **What it ran for real:** `engraveCalibrationTarget`, `engraveNudgeRing`, `runTransientCameraJob`, `addCalibrationTargetToCanvas`, `prepareCurrentStartJob`, `saveGcodeContext`, `emitSaveGcode` and `reviewExternalProgram`.
    - **What it mocked:** only `prepareTransientFrameController`, `dispatchTransientReviewedFrame` and the dialogs.
    - **How it read the output:** with its own G-code reader, which tracks the modal motion mode.
  - **Ground truth.** The GRBL source was fetched at the pinned SHA and re-read; the cited lines say what the report says.
  - **ADR quotes.** Each ADR quote was checked verbatim in `docs/decisions` at this tree.
  - **#1463.** It merged after the audit (`6b3227e27`). `git diff a59f74ff9 origin/main` shows that `transient-camera-job.ts` is untouched. In `calibration-actions.ts` the change is a comment only, and in `nudge-actions.ts` it touches only the photo and apply steps.

## Headline

Start and Save G-code produce byte-identical programs: the only difference is the Save header. The
repro covered GRBL, grblHAL, FluidNC, Marlin and Smoothieware, and Absolute, Current Position and
User Origin.

The camera calibration's **Engrave target** and nudge ring are the exception. They compile through a
hand-built machine snapshot that drops the connection flag and the settings observation. On a homed
stock GRBL with a negative native envelope, the target and its Frame therefore go to X70–330
Y115–285, which is 400 mm outside the controller's [-400, 0] travel on both axes. The same rings
added to the canvas and Started land at X-330 to -70. The wizard's own advice (home first) is what
makes the two paths differ, and only a generic, false "mapping is unverified" warning appears (P1).

The live-canvas Inspector shows S words in the profile range while Start streams the connected
`$30` range. The Run review judges S words against the profile, not `$30`. And the parity tests use
neither real context builder (P3s).

## Entry-point parity (L9)

Output, from the repro (profile S1000, controller `$30=255`, independent reader):

| Path | Bytes vs Start | S range | Native bed frame | Notes |
|---|---|---|---|---|
| Start (toolbar, Ctrl+Return, Run again, phone and MCP all use `runFramedPermitStart` → `transmitPreparedStart`) | — | `$30` (S77/S128 for 30%/50%) | yes | phone and MCP review parity is H8's |
| Save G-code (dialog, Ctrl+Shift+E) | identical, header only | `$30` | yes | all 5 families, 3 placement modes |
| Inspector and canvas G-code view (`saveGcodeContext`) | S words differ | **profile** (S300/S500) | yes | H1-P3-1 |
| Run G-code file of a saved file | file bytes, normalised | file's own | own envelope check | review's S max is the profile (H1-P3-2) |
| Camera Engrave target and nudge ring | **400 mm shift, S differs** | **profile** (S350 vs S89) | **dropped** | H1-P1-1 |
| Second pass and recovery | frozen archive bytes | archived (ADR-567, by design) | archived | H2-P1-1 KNOWN for Start from line |
| Material, Interval and Focus tests | ordinary Start | `$30` | yes | generators only replace the scene |
| `.rd` export (Ruida) | own encoder | n/a | n/a | registration and variables ride the snapshot |

Checks:

| Check | Start | Run again | Camera target | Run G-code file | Save G-code |
|---|---|---|---|---|---|
| Frame first | permit | permit + receipt signature | own Frame | own Frame of this program | n/a |
| Review | Job Review | Job Review | confirm of review warnings | Run review | toasts |
| `$30`/`$32` | readiness + acknowledgement | same | same | readiness + acknowledgement (ADR-630 Amd 4) | advisories |
| Bed bounds and no-go zones | preflight through the native frame | same | **size-only** (frame dropped) | envelope vs bed and zones (`external-run-bed.ts:37-42`) | preflight through the frame |
| Alarm, door, active job | `findMachineStartIssues` + store `assertStartAllowed` | same | same | Frame needs Idle + store | n/a |
| Job machine lock | store setter (ADR-416 Amd 2) | same | same | same | n/a |

## Findings

### H1-P1-1 — Engrave target and the nudge ring compile without the controller evidence ordinary Start uses: on a homed stock GRBL the rings and their Frame go 400 mm outside the machine's travel, at the profile's S range

- **Where:** `src/ui/camera/calibrate/transient-camera-job.ts:122-153` (`transientMachineSnapshot`)
  feeds `prepareStartJobSnapshot` at `:56-63`. It is reached from `engraveCalibrationTarget`
  (`calibration-actions.ts:94-113`, button at `CalibrationSetupStep.tsx:124`) and from the nudge ring
  (`nudge-actions.ts:41-45`).
  - **What the snapshot leaves out.** Compared with `machineSnapshot` (`start-machine-snapshot.ts:21-61`),
    it omits `connected`, `controllerSettingsObservation`, `activeControllerCommandSet` and
    `laserModuleReport`.
  - **Why the position changes.** `hasCurrentStockEvidence` needs
    `controllerSettingsObservation?.sessionEpoch === epoch` (`native-bed-frame.ts:134-143`), so
    `resolveNativeBedFrame` returns null (`:110`). `runtimeCoordinatePreparationOptions` then emits
    no `absoluteProgramOffset` (`job-placement.ts:199-211` against `:222-223`).
  - **Why the power changes.** `currentPowerObservation` needs `connected === true`
    (`connected-laser-power-scale.ts:20-31`), so `laserPowerPreparationOptions(project, machine)`
    (`start-job-readiness.ts:271`) uses the profile S maximum.
- **Anchor:**
  - **Twin.** The same rings through **Add target to canvas** and ordinary Start
    (`calibration-actions.ts:154-165`; `machineSnapshot`).
  - **Contract, ADR-440 Amendment 1, Context.** The rings' bed places include "when the controller
    proved it, the native bed frame's offset (`runtimeCoordinatePreparationOptions`)".
  - **Contract, ADR-440 Amendment 1, Decision 1.** "For **Engrave target** it is the frame at
    engraving". `engraveCalibrationTarget` records that frame with its native offset
    (`calibration-actions.ts:100`), but the program was not compiled in it.
  - **Contract, ADR-567, Decision.** "Fresh laser output uses a positive finite $30 from a connected
    GRBL v1.1, grblHAL or FluidNC session".
  - **Contract, ADR-441 Amendment 5, Decision 1.** The target step "says to home first", so following
    the advice is what produces the shifted program.
  - **Ground truth (gnea/grbl `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e`).**
    - **Negative workspace.** After homing, stock GRBL sets position from `settings.max_travel` (a
      negative number) and `homing_pulloff`, so travel is negative unless `HOMING_FORCE_SET_ORIGIN`
      is built in (`grbl/limits.c#L377-L382`).
    - **No jog travel check by default.** A `$J` target is checked against travel only under
      `BITFLAG_SOFT_LIMIT_ENABLE` (`grbl/jog.c#L35-L36`), and `DEFAULT_SOFT_LIMIT_ENABLE 0`
      (`grbl/defaults.h#L56`). KerfDesk's GRBL Frame is `$J=G90 G21 X… Y…` lines
      (`src/core/controllers/grbl/frame-lines.ts:9-15`).
- **Scenario:**
  - **Setup.** A stock GRBL v1.1 laser with homing on, homed this session, with `$$` and `$I` read
    (normal qualification). It uses a 400 × 400 front-left profile, its controller envelope is
    X[-400, 0] Y[-400, 0], and the ring power is 35% (the default).
  - **Engrave target.** Camera calibration → target step (home first, as advised) → **Engrave target**.
    The operator sees one confirm, "Controller warning: The controller-to-bed coordinate mapping is
    unverified…", and the mapping it calls unverified is the one this session has verified.
  - **The Frame.** It jogs to X70–330 Y115–285, outside the travel on both axes.
    - With `$20=0` (the GRBL default), GRBL accepts the jogs. The head is driven into the far end of
      each axis and loses position.
    - The Frame then completes as far as GRBL knows, and Start fires the rings wherever the head
      physically stopped.
    - With `$20=1`, the first jog is refused (error:15) and the target cannot be engraved at all.
  - **The canvas path.** The same rings, added to the canvas and Started, burn at X-330 to -70,
    Y-285 to -115.
  - **Power.** With `$30=255` and a profile of S1000, the transient rings burn at S350, which
    saturates to full power, against S89 through Start. Here the confirm does name the `$30`
    mismatch.
  - **Which machines.** The 400 mm shift needs a nonzero native-to-bed offset: a stock build
    (negative workspace), or a force-origin build homing to a corner other than the bed origin. A
    force-origin machine homing at the bed origin shows only the power difference.
  - **Further READ effects of the same snapshot:**
    - every transient compile shows the false "no current controller power range was verified"
      warning;
    - bed-bounds and no-go checks fall back to size-only, because no frame is known;
    - on a Smoothieware board without its Laser module, `laserModuleReport` is missing, so
      `programForLaserModule` keeps the `fire off` lines (`laser-module-readiness.ts:49-58`) and the
      "will not burn" warning is not given.
- **Evidence:** REPRO.
  - **Setup.** A temporary Vitest file (`src/ui/laser/zz-h1-parity.test.tsx`, since deleted).
    - It captured the exact project `engraveCalibrationTarget` passes to its job runner.
    - It ran the real `runTransientCameraJob`, mocking only `prepareTransientFrameController` (to
      return the live laser state) and `dispatchTransientReviewedFrame` (to capture
      `review.bundle.prepared`).
    - It put the same project on the canvas and ran the real `prepareCurrentStartJob`.
    - Laser state came from `stockNativeEvidence` (`native-bed-frame.test-support.ts`), and an
      independent G-code reader in the test compared the two programs.
  - **Negative workspace, `$30=255`.**
    - Native bounds were `{"minX":-400,"maxX":0,"minY":-400,"maxY":0}`.
    - Transient: `{"burns":2707,"sValues":[350],"bounds":[75,115.2,325,284.8]}`, Frame
      `{"minX":70,"minY":115.2,"maxX":330,"maxY":284.8}`.
    - Canvas: `{"burns":2707,"sValues":[89],"bounds":[-325,-284.8,-75,-115.2]}`, Frame
      `{"minX":-330,…,"maxX":-70,…}`.
    - First differing line: `G0 X326.382 Y115.200 S0` against `G0 X-73.618 Y-284.800 S0`.
  - **Negative workspace, `$30=1000`.** Same bounds, S350 on both paths.
  - **Force origin, homing back-right.** Native [-400, 0]. Same 400 mm shift.
  - **Force origin, homing front-left.** Native [0, 400]. Byte-identical.
  - **Warnings.** The transient review carried "The controller-to-bed coordinate mapping is
    unverified…"; the canvas Start's did not.
  - **Existing test coverage.** `transient-camera-job.test.ts:24-26` mocks `prepareStartJobSnapshot`,
    so no test compiles the target.
- **Refuter:** CONFIRMED (own REPRO and pinned GRBL source). P1 stays.
  - **What would make it false:**
    - a guard that stops an off-travel Frame;
    - a negative-workspace GRBL that cannot be reached;
    - S350 at `$30=255` not meaning full power;
    - a warning that names this specific mismatch before motion.
  - **REPRO: target.** Setup: the default 400 × 400 front-left profile with homing on, `$30=255`, and `stockNativeEvidence` with `$23=0` and with `$23=3`.
    - **Transient:** `burns 2707`, `sValues [350]`, bounds `[75,115.2,325,284.8]`. Frame `{minX:70,minY:115.2,maxX:330,maxY:284.8}`, first lines `$J=G90 G21 X70.000 Y115.200 F6000` and `$J=G90 G21 X330.000 Y115.200 F6000`.
    - **Canvas, through the real `prepareCurrentStartJob`:** `sValues [89]`, bounds `[-325,-284.8,-75,-115.2]`, Frame X-330 to -70.
    - **Force origin with `$23=0`:** the same shift.
    - **Force origin with `$23=3`:** native [0, 400], so the positions match, but the S range still differs (S350 against S89).
    - **`$30=1000` control:** S350 on both paths, and the 400 mm shift is unchanged.
  - **REPRO: nudge ring.** The same machine gives a Frame of X190–210 Y195.2–204.8, also past the travel's 0 end.
  - **No guard stops it.**
    - `dispatchPreparedFrame`, `resolveFrameCandidate` and `runFrame` → `buildFrameDispatchPlan` have no envelope check. Only no-go zones are checked, and those warn only.
    - `resolveManualMotionLimits` covers hold-jog and Move laser here, not Frame.
    - The preflight runs size-only (`'relative-origin'`), because `motionOffset` is undefined.
    - `reviewedFrameIsCurrent` compares the bundle's full laser state with itself, so the Frame does dispatch.
  - **Ground truth (re-fetched at gnea/grbl `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e`).**
    - `limits.c` L376-383: "settings.max_travel[] is stored as a negative value".
    - `jog.c` L35-36: the travel check is made only under `BITFLAG_SOFT_LIMIT_ENABLE`.
    - `defaults.h` L56-57: soft and hard limits are both 0 by default.
    - `spindle_control.c` L197-200: `rpm >= settings.rpm_max` gives `SPINDLE_PWM_MAX_VALUE`, so S350 at `$30=255` is full power.
  - **Reach.**
    - The stock evidence in the repro is what a homed GRBL 1.1 gives when its `$22=1` and `$130`/`$131` equal the bed. Both paths need that to get a frame at all, and canvas Start uses it for real.
    - With `$23=3` the head homes front-left and the Frame drives about 470 mm toward the far end. A build with switches only at the homing end has none there, so even `$21=1` cannot stop it.
  - **The warning does not lower it (METHOD §3, 2026-10-27).**
    - The only position text is the generic `UNKNOWN_NATIVE_BED_MESSAGE`. It never names the off-travel target, and it is false here, because the session has verified the mapping.
    - The Frame motion itself is the unexpected move, so P1 stays.
    - The power side is warned specifically. The confirm lists "Controller $30 is 255 but this project is set to max S 1000". On its own, that side would not be P1.
  - **Wording correction (no severity effect).** The program is shifted by 400 mm. Its Frame lies 70–330 mm (X) and 115–285 mm (Y) beyond the travel's 0 end, not "400 mm outside".
  - **Novelty.**
    - Not in `docs/audits`. Rolling v2 12-P2-2 assumed the transient rings went through the native bed frame.
    - G6-P3-3's refuter kept that finding below P1 because the unverified-mapping warning reaches the ring burn. On this path that warning shows even after Home, so the coordinator may want to revisit that argument.
    - No open PR touches `transient-camera-job.ts`.
- **Fix direction:** Build the transient snapshot from `machineSnapshot(project, laser, camera)`,
  overriding only `cameraPlacementActive: true`, so the camera target compiles with the evidence
  Start uses. Add a test that compiles the real target through both the transient path and canvas
  Start on a negative-workspace stock GRBL, and requires identical bytes.

### H1-P3-1 — The live-canvas Inspector and G-code view render S words in the profile range while Start and Save stream the connected `$30` range

- **Where:** `src/ui/commands/gcode-command-actions.ts:62-86`. The `machine` object (`:72-80`) has no
  `connected` field.
  - It is used by **Inspect current G-code** (`:45-53`, `inspect-current-gcode-action.ts:48`) and the
    main-canvas G-code view (`src/ui/gcode-inspector/use-current-gcode.ts:259`).
  - The Save dialog's own builder sets `connected` (`src/ui/app/GcodeSaveDialog.tsx:96`).
- **Anchor:**
  - **Twin.** The builder's own header says Save and Inspect share it "so the Inspector renders
    exactly what Save/Start would emit" (`gcode-command-actions.ts:1-5`, a code comment). They don't
    share it: the Save dialog builds its own context.
  - **Contract, ADR-567, Decision.** "Save, Preview, ETA, Frame preparation and ordinary Start use
    that same range".
- **Scenario:**
  - **Setup.** Profile S1000; connected GRBL, grblHAL or FluidNC reporting `$30=255`.
  - **What Start sends.** A 50% Line and a 30% Fill stream as S128 and S77.
  - **What the Inspector shows.** The source pane and Program Health show S500 and S300, and Save
    writes S128 and S77.
  - **Who is misled.** An operator who checks S words in the Inspector before a burn reads a
    different program from the one Start sends. Display only.
- **Evidence:** REPRO (the same temporary file). On all three families, Start and the Save dialog
  read `sValues [77,128]` and the Inspector read `[300,500]`. First difference on GRBL:
  `G1 X-350.000 Y-20.000 F1200 S128` against `… S500`. Marlin and Smoothieware (non-GRBL ranges) were
  identical.
- **KNOWN relation:** controller v4 **E1-P3-1** (Inspector shading divides by the profile S max)
  assumed these bytes carried the connected `$30` (its "Anchor" cites `save-gcode-emission.ts:60`).
  They do not.
  - Today the shading is consistent with the shown bytes, and both differ from Start.
  - Applying E1-P3-1's fix direction alone (divide by `$30`) would make the shading wrong as well.
- **Refuter:** CONFIRMED (own REPRO). P3 stays.
  - **What would make it false:** `saveGcodeContext` carrying `connected` some other way, or Save G-code also using it.
  - **REPRO.** Ring target on the canvas, `$30=255`, profile S1000:
    - `saveGcodeContext(...).machine.connected` is absent;
    - `emitSaveGcode` with it gives `sValues [350]`;
    - the same context with `connected: true`, as the Save dialog builds it, gives `[89]`;
    - real Start gives `[89]`.
  - **Save itself is not affected.**
    - The Save G-code command opens the dialog (`file-command-context.ts:117`).
    - `saveGcodeAction` has no caller in `src` or `electron`.
    - Only Inspect current G-code (`file-command-context.ts:132`) and the canvas G-code view (`use-current-gcode.ts:259`) use `saveGcodeContext`.
  - **The E1-P3-1 correction holds.** At E1's own SHA `71ff820ce`, `saveGcodeContext` already lacked `connected`, and `currentPowerObservation` already required `connected === true`.
  - **Severity.** It stays P3: display only, with no effect on the output.
- **Fix direction:** Add `connected: laser.connection.kind === 'connected'` to `saveGcodeContext`,
  or have the Save dialog and the Inspector call one builder. Fix E1-P3-1's divisor in the same
  change.

### H1-P3-2 — The Run G-code file review compares a program's S with the profile S max, not the connected `$30` that KerfDesk's own Save wrote it for

- **Where:**
  - `src/ui/gcode-inspector/RunGcodeFileDialog.tsx:103` passes
    `laserMaxPowerS: project.device.maxPowerS`;
  - `src/core/external-program/external-program-review.ts:387-392` warns when
    `powerMax > context.laserMaxPowerS`.
- **Anchor:** Twin with Save, which scales to the connected `$30` (`save-gcode-emission.ts:60`;
  ADR-567, Decision, "Fresh laser output uses a positive finite $30 from a connected … session").
- **Scenario:**
  - **Profile S255, `$30=1000`.** The operator saves G-code while connected; 100% is written as
    S1000. Opening that file in **Run G-code file** gives: "The program asks for S1000, above this
    laser's S max of 255. It may be a router program; KerfDesk is in Laser mode." This false alarm
    is about KerfDesk's own output.
  - **The reverse (profile S1000, `$30=255`).** A file at S1000 gets no S warning. Only the separate
    `$30` mismatch advisory appears.
- **Evidence:** READ. The two lines above are the whole data path.
- **Refuter:** CONFIRMED (own REPRO). P3 stays.
  - **What would make it false:** the Run review using the connected `$30`, or `external-run-readiness.ts` comparing the program's S with `$30`. It does neither: it only re-runs `runControllerReadiness`, which compares profile with controller.
  - **REPRO.** Setup: profile S255, connected `$30=1000`, the ring target on the canvas, and the Save-dialog context (`connected: true`).
    - `emitSaveGcode` writes `sValues [350]` for 35%.
    - The bytes then go through `normalizeExternalProgram`, `buildGcodeRenderModel` and `reviewExternalProgram`, with `laserMaxPowerS: project.device.maxPowerS` as `RunGcodeFileDialog.tsx:103` passes it.
    - The review returns "The program asks for S350, above this laser's S max of 255. It may be a router program; KerfDesk is in Laser mode."
  - **Severity.** It stays P3. It is a warning, not a refusal. The file burns its own S words as written, and the Run review also lists the `$30` mismatch advisory.
- **Fix direction:** Pass `resolveLaserPowerScale(project.device, { ...laser evidence, connected }).maxPowerS`
  as `laserMaxPowerS`, so the review uses the range Save and Start use.

### H1-P3-3 — (L7) The tests that claim Save/Start and camera parity build neither real context, so H1-P1-1 and H1-P3-1 pass them

- **Where:**
  - **The power-scale parity test.** `src/ui/laser/connected-laser-power-scale.audit.test.tsx:364-381`
    ("uses one range for connected Save, Start, Preview/ETA…") builds the Save context's `machine`
    with Start's own `machineSnapshot` (`:367`). It never calls `GcodeSaveDialog`'s `saveContext` or
    `saveGcodeContext`.
  - **The camera target test.** `src/ui/camera/calibrate/transient-camera-job.test.ts:24-26` mocks
    `prepareStartJobSnapshot`, and its fixture returns fixed G-code (`:72-80`).
- **Anchor:** Contract, ADR-567, "Verification required": "connected Save, Preview and Start parity".
  The test asserts it with one input source shared across all three paths.
- **Scenario:** A context builder that drops one evidence field still passes every test. That is the
  state of the Inspector builder (H1-P3-1) and the camera snapshot (H1-P1-1).
- **Evidence:** READ (lines above). The H1-P1-1 and H1-P3-1 repros are the missing tests.
- **Refuter:** CONFIRMED (READ plus the refuter's repros). P3 stays.
  - **The parity test.** `connected-laser-power-scale.audit.test.tsx:367` builds Save's `machine` with `machineSnapshot`.
  - **No camera test compiles the rings.**
    - `transient-camera-job.test.ts:24-26` mocks `prepareStartJobSnapshot`.
    - `calibration-actions.test.ts:190-209` passes a stub job runner.
    - `CameraCalibrationWizard.test.tsx:23` and `NudgeFix.test.tsx:29` mock the actions.
  - **No Inspector test checks S words.** No test that drives `saveGcodeContext` or `handleInspectCurrentGcode` asserts `maxPowerS` or `controllerSettingsObservation`.
  - **The gaps are real.** The two dropped-field defects reproduced above pass every existing test.
- **Fix direction:** Drive the parity test through the real builders (`saveContext`,
  `saveGcodeContext`, `transientMachineSnapshot`, or one shared builder they all call), and compile
  the camera target for real in at least one transient test.

## KNOWN (cited, not re-raised)

- **H2-P1-1.** Start from line and Choose restart point drop the Print-and-Cut registration. It is
  the one manual restart in the parity table. Start, Save, Frame, Preview, Run again and the
  Inspector all pass `currentPrintCutOutputRegistration` (READ: `start-job-source.ts:84`,
  `save-gcode-emission.ts:46`, `frame-spatial-identity.ts:37`, `RunAgainControl.tsx:50`).
- **E1-P3-1 (controller v4).** The Inspector's shading divisor. Its premise is corrected under
  H1-P3-1.
- **Refuter check.**
  - **H2-P1-1.** The four call sites cited do pass `currentPrintCutOutputRegistration`
    (`frame-spatial-identity.ts:37` and `RunAgainControl.tsx:50` re-read). It stays KNOWN.
  - **E1-P3-1.** The source is `docs/audits/2026-10-22-controller-v4/E1-ctl-power-mapping.md`, P3-1. Its
    premise ("current-canvas bytes come from `emitSaveGcode` with the connected `$30`") was already
    wrong at its own SHA. The correction stands.

## Refuted

Candidates the auditor dropped:

- **Save G-code emits a different program from Start.** The REPRO showed the two programs identical
  apart from the Save provenance header.
  - **Families:** GRBL v1.1, grblHAL, FluidNC, Marlin and Smoothieware (5/5).
  - **Placements on GRBL:** Current Position (bounds -200…-140), User Origin with WCO (0…60) and
    Absolute with WCO (-80…-20) (3/3).
  - **Reader comparison:** each pair had 104 burns, the same S set, the same bounds and 0 lit
    rapids.
- **Run G-code file skips bed-bound and no-go checks.** It has them as warnings
  (`external-run-bed.ts:37-42`), as Start does. Start's are warnings too (ADR-232); only
  compile-integrity codes block (`blocking-codes.ts:32-48`).
- **Material Test, Interval Test or Focus Test bypass Start.** The generators only replace the scene
  (`CalibrationGridDialogs.tsx:19-21`, `:42-44`). The burn is an ordinary Start.
- **`.rd` export loses the registration or variable text.** `captureProjectOutputSnapshot` carries
  both, and any snapshot routes to the worker with it (`save-rd-action.ts:33-47`).
- **Only Start strips Smoothieware's `fire off`.** This is intentional for the stream
  (`laser-module-readiness.ts:47-58`). A board without its Laser module cannot burn either way.
- **The job machine lock covers only project Start.** It sits on the store setter and applies to
  every `startJob` caller (`job-machine-lock.ts:1-11`).
- **Second pass and recovery are not rescaled to the current `$30`.** This is by design: ADR-567,
  Decision, "Frozen recovery and second-pass bytes are never silently rescaled".

## Verified clean

- **Start and Save G-code parity** (REPRO, above). The worker paths (`output-preparation.ts:110-186`)
  pass the same `laserPowerPreparationOptions` and `runtimeCoordinatePreparationOptions` as the
  main-thread paths (`start-job-readiness.ts:204-211, 271-279`, `start-job-readiness-async.ts:42-51`,
  `save-gcode-emission.ts:55-67`).
- **One transmission path.** Run again, second pass and phone/MCP Start all go through
  `runFramedPermitStart` → `streamFramedRun` → `transmitPreparedStart` (`start-job-flow.ts:107-205`,
  `second-pass-execution.ts:130-136`, `machine-execution.ts:168`). That gives one review, one
  authorization and one variable-advance arming (`start-job-transmission.ts:70-74`).
- **Run again** needs a clean Frame whose candidate signature equals the receipt's, and the receipt
  signature binds the registration (`start-job-flow.ts:96-105`, `RunAgainControl.tsx:50-53`).
- **The external run.** Each of these guards was read:
  - Frame first, and Frame and handoff bound to the controller kind, session, origin, position and
    machine mode (`external-run.ts:180-210, 260-267`);
  - the `$30`/`$32` readiness and acknowledgement (`external-run-readiness.ts:26-66`);
  - the lit-rapid naming (#1390);
  - the retirement of the project's recovery card, Run again and second pass
    (`startUntrackedRun`, `external-run.ts:243`), which closes rolling-v2 05-P3-1.
- **Controller families.** Start, Save and Frame build their power and frame evidence identically for
  all five; only the transient camera path differs (H1-P1-1).

## Not verified

- **Hardware.** No machine ran. The H1-P1-1 crash depends on the GRBL source cited and `$20=0`;
  the `$20=1` refusal path was not driven either.
- **Phone and MCP Start review parity.** That is H8's area. Only the shared transmission path was
  read.
- **The Falcon A1 Pro vendor-contract variant of H1-P1-1.** The missing `activeControllerCommandSet`
  would also drop the vendor frame. The shipped profile inherits homing off, however, so neither path
  had a frame in the repro, and no difference was shown.
- **Offline against connected Save on a negative-workspace stock GRBL.** A file saved offline in
  Absolute uses bed coordinates; saved connected and homed, it carries the native shift. Whether a
  profile-level negative-workspace setting (LightBurn has one) is needed is a design question, not
  raised.
- **Second pass on a serial-number job.** The pass arms variable advancement with the archived
  prepared project (`start-job-transmission.ts:70`). Its `variables` object is unlikely to be the
  live one, so a false "not advanced" toast, or a double advance, may follow. Not run.
- **Print-and-Cut and rotary output parity between Start and Save.** Read only. Both pass the same
  registration and `jobOrigin`; G1 covered the rotary anchor in the emitter.

```json
[
  {"id":"H1-P1-1","severity":"P1","area":"laser-burn-journey","file":"src/ui/camera/calibrate/transient-camera-job.ts","line":122,"anchor":"Twin: machineSnapshot (start-machine-snapshot.ts:21-61) via Add target to canvas + Start; Contract: ADR-440 Amd 1 Decision 1, ADR-567 Decision, ADR-441 Amd 5 Decision 1; Ground truth: gnea/grbl bfb67f0 limits.c L377-382, jog.c L35-36, defaults.h L56","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO (zz-h1r-transient, real engraveCalibrationTarget/engraveNudgeRing/runTransientCameraJob vs real addCalibrationTargetToCanvas+prepareCurrentStartJob; stock $23=0 and $23=3 and force-origin $23=0: transient S350 bounds [75,115.2,325,284.8], Frame $J X70..330 Y115.2..284.8; canvas S89 bounds [-325,-284.8,-75,-115.2]; nudge Frame X190-210; force-origin $23=3 positions equal). No Frame envelope check (dispatchPreparedFrame/runFrame/buildFrameDispatchPlan; manual-motion-limits covers jogs only). GRBL bfb67f0 limits.c L376-383, jog.c L35-36, defaults.h L56-57, spindle_control.c L197-200 re-fetched. P1 kept: only position text is the generic, here false, unverified-mapping warning; the $30 mismatch is named so power alone would not be P1. Wording: the shift is 400 mm; the Frame lies 70-330 / 115-285 mm past the travel's 0 end","known":false,"summary":"Engrave target and the nudge ring compile through transientMachineSnapshot, which drops connected, controllerSettingsObservation, activeControllerCommandSet and laserModuleReport; on a homed stock GRBL with native envelope [-400,0] the rings and their $J Frame go to X70-330 Y115-285 (400 mm outside travel; with default $20=0 GRBL accepts the jogs), while the same rings via Add target to canvas + Start burn at X-330..-70; power uses the profile range (S350 vs S89 at $30=255); only a false 'mapping is unverified' warning is shown"},
  {"id":"H1-P3-1","severity":"P3","area":"laser-burn-journey","file":"src/ui/commands/gcode-command-actions.ts","line":72,"anchor":"Twin: GcodeSaveDialog.tsx:96 and Start's machineSnapshot set connected; ADR-567 Decision 'Save, Preview, ETA, Frame preparation and ordinary Start use that same range'","evidence":"REPRO","verdict":"CONFIRMED","refuter":"REPRO (saveGcodeContext machine.connected absent; emitSaveGcode with it S350, with connected:true S89, Start S89 at $30=255/profile S1000). Save G-code opens the dialog (file-command-context.ts:117); saveGcodeAction has no caller. E1's SHA 71ff820ce had the same builder, so E1-P3-1's premise was wrong there too. P3 kept: display only","known":false,"summary":"saveGcodeContext has no connected field, so Inspect current G-code and the canvas G-code view render S500/S300 (profile S1000) where Start and Save stream S128/S77 ($30=255) on GRBL, grblHAL and FluidNC; corrects controller v4 E1-P3-1's premise that these bytes use the connected $30"},
  {"id":"H1-P3-2","severity":"P3","area":"laser-burn-journey","file":"src/ui/gcode-inspector/RunGcodeFileDialog.tsx","line":103,"anchor":"Twin: Save scales to the connected $30 (save-gcode-emission.ts:60, ADR-567 Decision)","evidence":"READ","verdict":"CONFIRMED","refuter":"REPRO (profile S255, connected $30=1000: Save-dialog context writes S350 for 35%; normalizeExternalProgram + buildGcodeRenderModel + reviewExternalProgram with laserMaxPowerS=project.device.maxPowerS returns 'The program asks for S350, above this laser's S max of 255. It may be a router program'). external-run-readiness only reruns runControllerReadiness. P3 kept: warning only, file burns its own S, $30 mismatch advisory also listed","known":false,"summary":"The Run G-code file review checks program S against the profile S max, so KerfDesk's own connected Save output (profile S255, $30=1000) is flagged 'above this laser's S max ... may be a router program', and the reverse mismatch gets no S warning"},
  {"id":"H1-P3-3","severity":"P3","area":"laser-burn-journey","file":"src/ui/laser/connected-laser-power-scale.audit.test.tsx","line":364,"anchor":"Contract: ADR-567 Verification required 'connected Save, Preview and Start parity'","evidence":"READ","verdict":"CONFIRMED","refuter":"READ (audit.test.tsx:367 uses machineSnapshot for Save; transient-camera-job.test.ts:24-26 mocks prepareStartJobSnapshot; calibration-actions.test.ts:190-209 stubs the job runner; wizard and nudge tests mock the actions; no Inspector test asserts S words) + the refuter's H1-P1-1/H1-P3-1 repros pass every existing test. P3 kept","known":false,"summary":"The Save/Start parity test feeds Save with Start's own machineSnapshot instead of either real Save context builder, and transient-camera-job.test.ts mocks prepareStartJobSnapshot, so the dropped evidence fields behind H1-P1-1 and H1-P3-1 pass every test"}
]
```
