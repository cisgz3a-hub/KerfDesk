# Controller audit v3 — D3 Rotary (`ctl-rotary`)

- **When:** 2026-10-22 evening   **Tree:** origin/main @ `7cd526213`. `origin/main` moved to
  `07b9ff462` during the audit. None of the scope files, or the files the findings cite, changed
  (`git log 7cd526213..origin/main` on that list is empty).
- **Scope:**
  - Model and math: `src/core/devices/{rotary,rotary-presets}.ts`.
  - Transform and job: `src/core/job/{rotary-job,rotary-transform,rotary-calibration-pattern,laser-lead-rotary}.ts`.
  - UI: `src/ui/laser/Rotary*.tsx`, `src/ui/laser/rotary-*.ts`, `src/ui/laser/use-rotary-test-rotation.ts`, `src/ui/laser/device-setup/DeviceSetupRotaryFields.tsx`, `src/ui/laser/job-review/rotary-raster-qualification-warnings.ts`, `src/ui/commands/rotary-command-family.ts`.
  - Fixture: `src/__fixtures__/rotary-raster-save-project.ts`.
  - Every consumer of `machineSpaceJob` / `rotaryAppliesTo` / `isRotaryActive` / `rotaryYLimitMm`:
    - emit: `emit-gcode.ts`, `emit-rd.ts`;
    - preflight: `preflight.ts`, `rd-preflight.ts`;
    - Frame: `frame-bounds-preview.ts`, `required-frame-readiness.ts`, `canvas-frame-perimeter.ts`, `canvas-motion-plan.ts`;
    - estimates: `live-job-estimate.ts`, `prepared-job-metrics.ts`;
    - `laser-jog-warnings.ts`, `head-move-dispatch.ts`;
    - G-code inspector: `gcode-inspection-source.ts`, `burn-grid.ts`, `scene-burn.ts`;
    - raster compile: `compile-job-raster.ts`;
    - `laser-arc-moves.ts`, `laser-finish.ts`, `second-pass-eligibility.ts`.
  - Home and alarm offers: `start-blocked-alarm-offers.ts`, `laser-home-action.ts`, `AlarmRecoveryActions.tsx`.
- **Governing:**
  - ADR-127 (machine-space job), ADR-160 and ADR-161 (superseded by ADR-315).
  - ADR-315 (rotary output independent of Labs; one raster disclosure).
  - ADR-373 (roller diameter, linked circumference, Test rotation, Rotary switch).
  - ADR-492 item 9 (rotary scans images along X).
  - ADR-503 item 4 (published presets).
  - ADR-626 (rotary lead wrap).
  - ADR-228/ADR-565 and PROJECT.md non-negotiable 21 (warnings, not refusals).
  - Non-negotiables 1, 2 and 5.
  - WORKFLOW F-B17.
- **Lenses run:** L1, L2, L3, L4 and L7, each as its own pass.
  - L5 skipped: the only untrusted input is the rotary block of `.lf2` and machine-profile files. Its validator (`optionalRotarySetup`) was read and holds (see Verified clean).
  - L6 folded into L4 (Test rotation stop, refusal, alarm and disconnect).
- **Counts:** 7 raised → 0 refuted → P1 0 / P2 1 / P3 6 (+ 2 KNOWN re-encountered: 03-P2-3,
  21-P3-2). Refuter (2026-10-22): 7 confirmed, 0 plausible, 0 refuted.
  - Severity changes: P2-2 P2 → P3. Home is not adapted, but every built-in profile ships with
    Home off, the outcome is fail-safe (no beam, ALARM:9, Unlock on the banner), and LightBurn
    behaves the same. See its Refuter line.
  - P2-1 kept at P2, with one correction: the ×1.96 burn comes from the unscaled default on a
    stock controller, with or without the tuned diameter.
  - No refuter-raised finding.

## Headline

The scale maths is right and lives in one place. Chuck scale = motion per turn ÷ (π × object
diameter). Roller scale = motion per turn ÷ (π × roller diameter), independent of the part. Both
match LightBurn's rotary page. Emit, `.rd`, Frame, estimates and the wrap-limit preflight all go
through `machineSpaceJob`, and the Job Review fact, the switch and the wrap preview show the same
numbers.

The two P2s are both about the operator's side of calibration and mode safety, not the transform.

- **P2-1.** On a roller left unscaled (the default), Test rotation's own advice ("adjust the
  measurements") can only be followed by changing the object diameter. The Y scale never reads
  that field. An operator who tunes it until the mark lands gets a wrong-size wrap with matching,
  false preview numbers.
- **P2-2.** Nothing adapts Home to the rotary. A Frame blocked by GRBL's power-on homing lock
  offers only Home. Homing then spins the part looking for a Y switch the rotary cannot reach,
  and ends in ALARM:9. The refuter re-rated this P3 (see its Refuter line).

The P3s:
- positional checks treat rotary Y (rotation) as a bed position: no-go zones, the offset bounds
  check and jog warnings;
- the 3D wrap preview ignores Reverse;
- copy that promises the calibration pattern measures things it cannot;
- test-truth gaps.

## Setting → transform / emitted value → source

| Setting | Transform / emitted value | Code | Source |
|---|---|---|---|
| Chuck, Motion per turn `M`, object Ø `d` | Y scale `M/(π·d)`; emitted Y = `(y − y_min)·scale`; wrap limit `M` | `rotary.ts:60-63,72-74`; `rotary-transform.ts:32-62` | LightBurn: for a chuck the object diameter "affects output" |
| Roller + roller Ø `r` | Y scale `M/(π·r)`, independent of `d`; wrap limit `M·d/r` | `rotary.ts:66-67,72-74` | LightBurn: roller Object Diameter "does not affect output"; Roller Diameter is the driven roller |
| Roller without `r` (default) | Y scale exactly 1; wrap limit `π·d`; Motion per turn greyed out | `rotary.ts:64-66`; `RotarySetupFields.tsx:130-149` | KerfDesk-only "surface-calibrated" mode (ADR-127/373). LightBurn has no equivalent: its roller always uses mm per rotation + roller Ø |
| Reverse rotary direction | Y mirrored inside `[0, extent]`; raster `rowProviderOrder` flipped, storage untouched | `rotary-transform.ts:27-62,102-130` | LightBurn "Mirror Output to Rotary" |
| Active = enabled ∧ measurements valid ∧ not CNC | gate for every consumer | `rotary-job.ts:18-24`; `rotary.ts:88-98` | ADR-127, ADR-373 decision 3 |
| Arcs | stripped to G1 chords (a Y scale makes ellipses); arc row disabled | `rotary-transform.ts:139-147`; `laser-arc-moves.ts:44`; `LaserArcMovesRow.tsx:24-39` | geometry; ADR-432 |
| Image scan angle / cross-hatch | forced to 0° with an `image-scan-angle-rotary` diagnostic | `compile-job-raster.ts:134-146` (`rasterScanRuns`) | ADR-492 item 9 |
| Raster row pitch | follows the scaled bounds: `pixelHeightMm = (maxY−minY)/height` | `emit-raster.ts:195,231` | — |
| Wrap-limit preflight | bounds Y replaced by `[0, wrap]`; warning only | `emit-gcode.ts:296-304`; `preflight.ts:318-327` | ADR-127 (refusal clause superseded by ADR-228) |
| Laser leads | planned in surface space against one circumference `π·d`; only X bed limits | `laser-lead-rotary.ts:22-81` | ADR-626 |
| Laser finish position | set aside (`reason: 'rotary'`), default park | `laser-finish.ts:40` | ADR-493 |
| Test rotation: chuck / roller drive | `$J=G91 G21 Y±M F…`, out, 1 s pause, back | `rotary.ts:79-85`; `rotary-test-rotation.ts:62-84` | LightBurn Test: 360° out, pause, back; for a roller "the roller or wheel must complete the rotation, not the object" |
| Test rotation: object | `Y±wrap` (`scale·π·d`) | same | KerfDesk addition |
| Feed of the test | `clamp(travel·6, 100, 1500)` mm/min, ≤ profile max feed | `rotary-test-rotation.ts:62-84` | ADR-373 decision 5 |
| Strip measure | `d = L/π − t` | `rotary.ts:108-113` | neutral-axis geometry: a strip of thickness `t` wraps at radius `r + t/2` |
| Calibration pattern | 50 × min(20, π·d/2) mm rectangle + centre cross, Line 10 %, 1500 mm/min | `rotary-calibration-pattern.ts:20-71` | — |
| Preset "Creality Rotary Kit Pro, chuck" | chuck, 40 mm per turn, Falcon family only | `rotary-presets.ts:19-28` | manuals.plus returned 403 to the fetch. A Creality forum post relays the same "Chuck … 40" instruction (secondary) |
| Jog warnings | Y bounds become `[0, wrap]` against absolute MPos | `laser-jog-warnings.ts:72-85` | — |
| G-code inspector wrap | Ø `d`, one turn = `wrap` machine mm, fixed direction | `gcode-inspection-source.ts:120-131`; `scene-burn.ts:181-186` | — |
| A axis | never emitted for a laser; laser rotary is Y-port only (A appears only in the CNC wrap study) | grep of `src` | LightBurn also offers Z/A ports; KerfDesk does not, by scope |

## Findings

### P2-1 — Test rotation on an unscaled roller tells the operator to "adjust the measurements", and the only one it can change is the object diameter, which the Y scale ignores; tuning it gives a wrong-size wrap

- **Where:**
  - `src/ui/laser/RotaryTestRotationPanel.tsx:80-86`: an unscaled roller gets only "Turn object once".
  - `src/ui/laser/RotaryTestRotationPanel.tsx:104-108`: "Done. If the mark did not come back to the same place, adjust the measurements and test again."
  - `src/ui/laser/RotarySetupFields.tsx:130-149`: Motion per turn is disabled while unscaled.
  - `src/core/devices/rotary.ts:64-66`: scale is exactly 1.
  - `src/core/devices/rotary.ts:79-85`: the object turn travels `π·d`.
  - `src/ui/laser/rotary-setup-edit.ts:15-38` and `DEFAULT_ROTARY_SETUP`: every new roller starts unscaled.
- **Anchor:**
  - Contract: ADR-373 Consequences, a setup "can be checked by motion alone … and adjusted until one revolution lands on the mark".
  - Contract: ADR-373 Context, which says the common install plugs the roller into the Y output unchanged.
  - Ground truth: LightBurn's rotary page. For a roller, "Object Diameter … does not affect output", and the Test turns the roller, which is corrected through MM Per Rotation.
- **Scenario:** A stock roller plugged into the Y port, with 40 mm of Y per roller turn, a 25 mm
  roller and an 80 mm tumbler. The surface moves 1.963 mm per machine mm.
  1. The operator keeps the default (unscaled), enters Ø80 and presses Turn object once. The test sends 251.3 mm, so the tumbler turns 1.96 times.
  2. The panel says adjust the measurements. Motion per turn is greyed out, and Object diameter is the only field it can mean.
  3. Tuning Ø to 40.74 makes the test travel 128 mm. That is exactly one turn, so the mark lands.
  4. Apply. Every job still emits Y at scale 1, so a 20 mm design burns about 39 mm tall.
  5. The wrap preview, the Rotary switch and Job Review all report a circumference of 128 mm (true: 251 mm) and agree with each other. Nothing flags it.
- **Evidence:** REPRO. `node ../../../node_modules/vitest/vitest.mjs run src/io/gcode/zz-d3-rotary.test.ts` (case R3; copy kept in the scratchpad `d3-repros/`):
  ```
  R3 surface roller d=80: test object-turn travel=251.327 drive=null yScale=1.0000 emitted Y extent for 20 mm design=20.000
  R3 surface roller d tuned to 128/pi: test object-turn travel=128.000 drive=null yScale=1.0000 emitted Y extent for 20 mm design=20.000
  R3 scaled roller rollerD=25 mpr=40 d=80: test object-turn travel=128.000 drive=40 yScale=0.5093 emitted Y extent for 20 mm design=10.186
  ```
  The tuned-Ø test turns the same 128 mm as the correctly scaled roller, but emits twice the Y.
  SOURCE: https://docs.lightburnsoftware.com/2.1/Reference/RotaryMode/RotaryModeGCode/, for a roller the object diameter "does not affect output".
- **Refuter:** CONFIRMED, P2 kept, new. No match in the rolling-v2 or controller-v2 ledgers, and
  `gh pr list --search rotary` lists no open PR.
  - **What would refute it.** Any of these would:
    - LightBurn scaling a roller by object Ø, which would make tuning Ø the right correction;
    - a new roller starting scaled;
    - text that sends an unscaled roller to the toggle after a miss.

    None holds.
  - **LightBurn** (fetched the page above myself):
    - "For Roller style rotaries, Object Diameter does not affect output".
    - The roller Test turns "the roller or wheel driven by the motor", not the object.
    - Roller output comes from MM Per Rotation and Roller Diameter only.
  - **Code.**
    - `rotaryYScale` returns 1 for a roller without `rollerDiameterMm` (`rotary.ts:66`). Every
      consumer reaches it through `machineSpaceJob` (`rotary-job.ts:34`).
    - `DEFAULT_ROTARY_SETUP` (a roller with no roller Ø) seeds Rotary Setup
      (`RotarySetupDialog.tsx:27`) and Machine Setup (`DeviceSetupOptionsStep.tsx:145`).
      `startRotaryEdit` parks `scaled: false`.
    - The only preset is a chuck (`rotary-presets.ts:19-28`), so no roller preset turns scaling
      on.
  - **UI text.** After a miss, three places say "adjust the measurements" and nothing else:
    - `RotaryTestRotationPanel.tsx:107`;
    - tutorial step 3 (`placement-tutorials.ts:198`);
    - `docs/laser-production-workflows.md:15`.

    Some text does tell a stock roller to turn on Scale Y: the toggle's off hint
    (`RotarySetupFields.tsx:111-114`), tutorial step 2 (`placement-tutorials.ts:190`, "a roller
    whose controller moves in motor millimetres") and the workflow doc, line 14. None of it
    appears where the test misses.
  - **REPRO** (temporary Vitest through `emitGcode` and `planRotaryTestRotation`, since deleted;
    copy in the scratchpad as `zz-d3r-rotary.test.ts`). The setup is a stock roller with 40 mm per
    roller turn and a Ø25 roller, so the surface moves 1.963 mm per machine mm. The design is a
    20 mm-tall rectangle.
    ```
    unscaled d=80:     testTravel=251.327 objectTurnsOnStockRoller=1.963 yScale=1.0000 wrap=251.327 emittedY=20.000 burnedSurfaceMm=39.270
    unscaled d=128/pi: testTravel=128.000 objectTurnsOnStockRoller=1.000 yScale=1.0000 wrap=128.000 emittedY=20.000 burnedSurfaceMm=39.270
    scaled r=25 mpr=40 d=80: testTravel=128.000 objectTurnsOnStockRoller=1.000 yScale=0.5093 wrap=128.000 emittedY=10.186 burnedSurfaceMm=20.000
    ```
  - **Correction to the scenario.** The ×1.96 burn comes from the unscaled default on a stock
    controller, and it is the same with or without the tuned Ø.
    - Tuning Ø changes no output byte.
    - It does make Test rotation pass.
    - It also makes the diameter and circumference in Rotary Setup, the switch and Job Review
      describe a 40.7 mm part.
    - So it removes the one pre-burn signal that the setup is wrong.
  - **Severity: P2 kept.**
    - ADR-373's Context calls the stock Y-port roller the common install, and a new roller starts
      unscaled, so an ordinary user gets the failed test.
    - The panel's own advice then gives a passing test and a ×1.96 burn that every on-screen
      figure agrees with.
    - Not P1: the operator changes a measured value by hand, and the wrong size shows on the
      first test burn (tutorial step 5).
    - Not P3: it is neither latent nor polish. The misleading step is in the calibration tool
      itself.
  - **Fix note.** The fix should also reconsider the unscaled default for a new roller.
- **Fix direction:**
  - When an unscaled roller's object turn misses, say that the controller is not surface-calibrated, and point to "Scale Y from the roller diameter" (or `$101`). Do not say "adjust the measurements".
  - Alternatively, offer a measured-turn correction that writes motion per turn rather than the diameter.

### P2-2 — With the rotary on, nothing adapts Home: a Frame blocked by GRBL's homing lock offers only Home, which spins the part looking for a Y switch and ends in ALARM:9

- **Where:**
  - `src/ui/laser/start-blocked-alarm-offers.ts:82-86`: `homingEnabled && homeFromAlarm ? offerHomeCycle() : offerUnlock()`. Unlock is never offered when the profile has homing.
  - `src/ui/laser/start-blocked-alarm-offers.ts:42-47`: the prompt "Home runs the homing cycle to re-establish machine position".
  - `src/ui/laser/start-blocked-alarm-offers.ts:134-158`.
  - `src/ui/state/laser-home-action.ts`: no rotary check.
  - `src/ui/laser/AlarmRecoveryActions.tsx:42-48`: the banner shows Home first, no rotary note.
  - No file outside the rotary UI reads `device.rotary` before homing (grep).
- **Anchor:**
  - Ground truth: gnea/grbl `config.h` `#define HOMING_INIT_LOCK` (on by default), so a `$22=1` controller boots in Alarm.
  - Ground truth: `#define HOMING_CYCLE_1 ((1<<X_AXIS)|(1<<Y_AXIS))`, so X and Y seek their switches together.
  - Ground truth: GRBL alarm 9, "Homing fail. Could not find limit switch within search distances."
  - Supporting (secondary): the LightBurn forum, "The rotary device replaces one of the axis motors, so the engraver can't reach the switch."
  - The area brief asks whether Home is adapted while the rotary is on. It is not.
- **Scenario:** A Sculpfun S30 or Falcon profile with homing on. A roller rotary is plugged into the Y port and the Rotary switch is on. Power-up.
  1. GRBL is alarm-locked by the homing lock. Frame refuses on the alarm and offers Home, with "Make sure the machine is clear".
  2. OK → `$H`. X homes. The Y motor turns the rollers, and the tumbler on them spins at the homing seek rate for up to the search distance (1.5 × `$131` in stock GRBL), then ALARM:9.
  3. Frame is still blocked, and the next Frame offers Home again. Unlock is reachable only from the banner, beside a Home button with no rotary note.
- **Evidence:**
  - READ: the call chain above.
  - SOURCE: https://raw.githubusercontent.com/gnea/grbl/master/grbl/config.h (`HOMING_INIT_LOCK`, `HOMING_CYCLE_1`).
  - SOURCE: https://raw.githubusercontent.com/gnea/grbl/master/doc/csv/alarm_codes_en_US.csv (code 9).
  - SOURCE: https://forum.lightburnsoftware.com/t/alarm-9-homing-fail-with-rotary-installed/167561.
  - SOURCE: https://docs.lightburnsoftware.com/2.1/Reference/RotaryMode/RotaryModeGCode/ (`$20=0` for Alarm:2 "because rotary travel exceeds the Y axis Max Travel").
- **Refuter:** CONFIRMED; **severity P2 → P3**. New: no match in either ledger or in any open PR.
  - **What would refute it.** Any of these would:
    - a rotary check before Home or inside the alarm offer;
    - a homing cycle that skips Y;
    - Unlock offered beside Home.

    None holds.
  - **Primary sources** (fetched myself):
    - gnea/grbl `config.h`: `#define HOMING_INIT_LOCK // Comment to disable` is on by default.
      Its comment says it "sets Grbl into an alarm state upon power up".
    - The same file: `#define HOMING_CYCLE_1 ((1<<X_AXIS)|(1<<Y_AXIS))`.
    - `alarm_codes_en_US.csv`, code 9: "Could not find limit switch within search distances."
    - LightBurn's rotary page says nothing about homing, `$22` or Alarm 9. LightBurn does not
      adapt Home either.
  - **Grep.**
    - Nothing on the home, alarm or unlock path reads `device.rotary`: `laser-home-action.ts`,
      `laser-home-proof.ts`, `start-blocked-alarm-offers.ts`, `AlarmRecoveryActions.tsx`,
      `LaserWindow.tsx`.
    - No rotary text mentions homing.
    - Nothing homes automatically on connect.
  - **REPRO** (temporary Vitest, since deleted; copy in the scratchpad as `zz-d3r-alarm.test.ts`).
    The setup: profile Home on, an active roller rotary, the controller in Alarm, then
    `offerAlarmFixForBlockedStart([STATUS_ALARM_START_MESSAGE])`.
    ```
    P2-2 rotaryActive=true result=unrepaired promptIsHome=true homeCalls=1 unlockCalls=0 promptMentionsRotary=false
    ```
  - **Unlock is still reachable.** The Alarm banner always shows `$X — Unlock` beside Home
    (`AlarmRecoveryActions.tsx:64-72`, wired at `LaserWindow.tsx:228`), and the Console can send
    it too.
  - **Vendor guidance.** Searches found no official xTool, Sculpfun or Ortur page. The only
    evidence is secondary. In
    https://forum.lightburnsoftware.com/t/error-9-after-installing-y-axis-roller/47652, LightBurn
    staff relay Ortur's "$22=0 to turn off homing" for a Y-port roller.
  - **Why P3.**
    - Every built-in profile ships with Home off: `device-profile.ts:408`,
      `brand-laser-profiles.ts:93`, and no other profile sets it. The path needs an operator who
      turned Home on in Machine Setup and left `$22=1` with the rotary fitted. With Home off, the
      same offer is Unlock.
    - The outcome is fail-safe:
      - no beam;
      - the prompt warns that the machine will move;
      - GRBL stops at ALARM:9;
      - the banner's Unlock clears it.

      The cost is a spun part and a retry loop.
    - LightBurn does the same or worse. It has no rotary-aware homing, and its Auto-home on
      startup sends `$H` without a prompt. So this is a guidance gap above parity, not a broken
      contract.
    - The fix direction still stands.
- **Fix direction:** While the rotary mapping is active:
  - the Frame-blocked alarm offer should offer Unlock, with a line that homing cannot work with the rotary on the Y port;
  - Home and the banner's Home should say so before sending `$H`.

### P3-1 — No-go zones are checked against rotary Y, which is rotation, not head position: flat-bed zones raise false collisions on every rotary job and jog

- **Where:**
  - `src/core/preflight/preflight.ts:196-230`: `appendNoGoZoneIssues` runs the rotary-mapped body against `machineBoundsForDevice(project.device)` and flat zones.
  - The bounds check right above it uses `boundsWithHeightOverride` (`preflight.ts:273-282`).
  - `src/ui/state/laser-jog-warnings.ts:35-45,139+`: the jog path does the same.
- **Anchor:** Twin. ADR-127: the mapping "must be applied consistently everywhere the job is measured", and placement preflight is one of those places. The bounds check swaps Y for the wrap; the no-go check does not.
- **Scenario:** A clamp zone at bed X 90–150, Y 0–20. A chuck rotary (360 mm/turn, Ø60) with a 40 × 20 mm rectangle drawn at canvas Y 150–170. The rotary job emits Y 0–38.2, and Job Review shows three "motion crosses no-go zone 'front clamp'" warnings. The head never moves in Y on a rotary. The same project on the flat bed shows none. Warnings only, so it does not refuse.
- **Evidence:** REPRO, the same file, case R1:
  ```
  R1 rotary=false Y range 0..250 issues= []
  R1 rotary=true Y range 0..38.197 issues= ["no-go-zone-collision: Line 10: …","…Line 11…","…Line 12…"]
  ```
- **Refuter:** CONFIRMED, P3 kept, new.
  - **REPRO.** Rebuilt independently through `emitGcode`, with a chuck at 360 mm per turn, Ø60, a
    40 × 20 mm rectangle and a zone at X 90–150, Y 0–20. The flat bed gives `zoneIssues=0`. The
    rotary gives `zoneIssues=3` (Lines 10, 11 and 12).
  - The check can also miss a real crossing: on a rotary the head's bed Y is wherever the gantry
    sits, and no code knows it.
  - Warnings only.
- **Fix direction:** On an active rotary, check zones in X only at an unknown head Y, or skip them with a notice. Do the same in the jog no-go warning. May overlap D5 (`ctl-zones-laser-off-motion`).

### P3-2 — Positional bounds checks treat rotary Y as an absolute position inside `[0, wrap]`: a trusted work offset or an earlier rotation produces false out-of-bed warnings, including on Test rotation's own turns

- **Where:**
  - `src/core/preflight/preflight.ts:273-300` with `321-327`: with a trusted `motionOffset`, emitted Y + offset is compared with `[0, wrap]`.
  - `src/ui/state/laser-jog-warnings.ts:72-85`: `configuredMotionBounds` sets Y to `[0, rotaryYLimitMm]` and compares it with the absolute MPos target. Its own test, `laser-jog-actions.bounds-warning.test.ts:104-123`, codifies this.
  - `src/ui/laser/rotary-test-rotation.ts:79-83`: a test turn is `dy = wrap`.
- **Anchor:** Twin. The rotary output rebases Y to the job's own start (`rotary-transform.ts:1-8`, ADR-127 "rotation is relative"), so only the extent is meaningful. These two checks compare positions.
- **Scenario:**
  1. A User Origin set after the part was rotated gives a bed-frame offset of Y −50. The chuck job (extent 38.2) gets five "Y out of bed: −50 / −11.8" warnings. The same job at offset 0 has none.
  2. On the jog side, after any earlier rotation (MPos Y > 0), pressing "Turn object once" sends `Y+wrap` and toasts "Jog target … is outside the configured machine bounds". Rotary Y has no bounds.
- **Evidence:** REPRO case R2:
  ```
  R2 offset={"x":0,"y":0} … issues= []
  R2 offset={"x":0,"y":-50} … ["out-of-bed: Line 8: Y out of bed: -11.80…","…Line 10: Y out of bed: -50", …]
  ```
  The jog side is READ, plus the existing test above.
  The preflight case needs a resolved native bed frame (homed this session), so it is narrow. The jog case needs only a non-zero MPos Y.
- **Refuter:** CONFIRMED, P3 kept, new.
  - **Jog side**, two lines of evidence:
    - `configuredMotionBounds` returns Y `[0, rotaryYLimitMm]` (`laser-jog-warnings.ts:72-85`).
    - `warnJogTargetOutsideConfiguredBounds` (`:104-123`) compares it with the absolute MPos
      target, and `laser-jog-actions.bounds-warning.test.ts:104-123` pins that comparison from a
      start of Y 50.
  - Test rotation's turns are ordinary jogs (ADR-373 decision 5). From any non-zero MPos Y, one of
    the two turns therefore toasts: out from Y > 0, or back to Y < 0.
  - **Preflight side:** not re-run. It agrees with `findOutOfBoundsCoords(…, { motionOffset })`
    against `boundsWithHeightOverride` (`preflight.ts:273-300`).
- **Fix direction:** On an active rotary, check only the Y extent against the wrap (as the relative envelope already does). Drop the Y position from the jog bounds warning.

### P3-3 — The G-code inspector's "Wrap round the rotary" ignores Reverse, so a reversed setup is shown mirrored, although the control says "as it comes off the machine"

- **Where:**
  - `src/ui/gcode-inspector/gcode-inspection-source.ts:120-131`: passes only `diameterMm` and `wrapYMm`.
  - `src/ui/viewer3d/scene-burn.ts:181-186`: "program Y runs on over the back", one fixed sense.
  - `src/ui/gcode-inspector/burn-grid.ts:267-276`.
  - `src/ui/gcode-inspector/InspectorBurnControl.tsx:45`: the control's title.
  - No inspector file reads `reverseAxis` (grep).
- **Anchor:** Twin. `rotary-transform.ts:27-31`: Reverse mirrors the program so that a rotary spinning the other way burns the design the right way round. The inspector assumes the normal sense.
- **Scenario:** Reverse on, text artwork. The emitted Y is `extent − forward`, and the inspector wraps it in the normal sense, so the text reads backwards on the 3D cylinder. An operator checking the wrap may switch Reverse off and burn it mirrored.
- **Evidence:** READ.
- **Refuter:** CONFIRMED (two reads, not rendered), P3 kept, new.
  - `deviceInspectionLaser` passes only `diameterMm` and `wrapYMm`
    (`gcode-inspection-source.ts:128-130`). A grep finds no `reverseAxis` under
    `src/ui/gcode-inspector` or `src/ui/viewer3d`.
  - Reverse emits the forward program mirrored within `[0, extent]` (`rotary-transform.ts:27-62`).
  - Both settings are meant to burn the right way round on their own hardware. The inspector wraps
    both programs in one sense, so it must show one of them mirrored.
- **Fix direction:** Pass `reverseAxis` into the inspector laser model and flip the wrap sense (or the rows).

### P3-4 — Machine Setup promises that the rotary calibration "measure[s] one full revolution" and shows direction; the pattern is a Y-symmetric rectangle under half a turn, and nothing says what to measure

- **Where:**
  - `src/ui/laser/device-setup/DeviceSetupRotaryFields.tsx:84-87`: "Run the rotary calibration pattern after saving and measure one full revolution before production."
  - `src/ui/laser/device-setup/DeviceSetupRotaryFields.tsx:79`: "Reverse rotary travel only if the calibration test moves in the wrong direction."
  - `src/core/job/rotary-calibration-pattern.ts:20-23,46-71`: the pattern is 50 × min(20, π·d/2) mm, a rectangle and a centre cross.
  - `src/ui/laser/RotarySetupHost.tsx:36-39`: the toast gives only the size.
- **Anchor:**
  - Twin: the copy against the generated pattern.
  - Ground truth: LightBurn, Mirror Output "if output is inverted in the rotation dimension". Inversion is seen on asymmetric output.
  - Test rotation goes out and back, so it cannot show direction either.
- **Scenario:** The operator follows the Machine Setup note. The pattern covers at most half a revolution, so it cannot "measure one full revolution". It is symmetric about its own centre lines, so a mirrored (reversed) burn looks identical. No text says to compare the burned height with the stated 20 mm, or which value to correct.
- **Evidence:** READ.
- **Refuter:** CONFIRMED (deterministic read), P3 kept, new.
  - The pattern is a closed rectangle plus the two centre lines (`rotary-calibration-pattern.ts:46-71`).
    Its height is `min(20, π·d/2)`, at most half a turn, and a Y mirror leaves it unchanged.
  - The copy is at `DeviceSetupRotaryFields.tsx:79` and `:84-87`.
  - The pattern does check scale (a 20 mm target), just not "one full revolution" or direction.
- **Fix direction:**
  - Make the pattern asymmetric in Y (an arrow or "F").
  - State the target height and which field to correct.
  - Reword the Machine Setup note to what the pattern measures.

### P3-5 — Test truth: the shared rotary fixture still says it "requires Labs permission", and no test pairs the rotary with no-go zones, a trusted offset or Home

- **Where:**
  - `src/__fixtures__/rotary-raster-save-project.ts:32`: "Builds the shared Save-path fixture whose raster requires Labs permission." ADR-315 decision 1 removed every Labs/permission gate.
  - The fixture's raster is a uniform 4 × 4 luma, so the four Save/output tests that use it cannot see row order. Rows are covered separately by `rotary-transform-raster.test.ts`.
  - No test combines rotary with `noGoZones`, `preflightMotionOffset` or the alarm Home offer. Any of those would have caught P3-1, P3-2 or P2-2.
- **Anchor:** Contract: ADR-315 decision 1; METHOD L7.
- **Scenario:** A maintainer reading the fixture believes rotary raster Save still depends on Labs. The P2-2 and P3-1/2 paths have no regression test.
- **Evidence:** READ (grep of all 75 rotary test files).
- **Refuter:** CONFIRMED, P3 kept, new.
  - ADR-315 decision 1 (`DECISIONS.md:19858`ff) says "Bytes follow the exact project" with no
    Labs flag, and `docs/laser-production-workflows.md:8` agrees.
  - A grep finds no rotary test that pairs a no-go collision, a `motionOffset` or the alarm offer.
  - The one test that sets both `noGoZones` and `rotary`
    (`machine-settings-coordinate-audit-20260921.test.tsx:56-57`) is a settings-form test, not a
    collision check.
- **Fix direction:** Fix the comment. Add focused tests with the fixes for P2-2, P3-1 and P3-2.

## KNOWN (re-encountered, not raised)

- **03-P2-3** (rolling v2, laser output): an active rotary rebases Y to 0, discarding the Current
  Position / User Origin anchor, and the park returns to the anchor. Re-encountered in:
  - `RotaryWrapPreview.tsx:45-52` ("the emitted job rebases its lowest Y to 0");
  - `prepared-job-metrics.ts:85`, where `parkTarget` comes from the surface job while `frameMotionBounds` comes from the machine-space job, so Job Review's park-outside-frame warning shows this same mismatch.
- **21-P3-2** (rolling v2, LightBurn importers): `.lbdev` import drops `rotaryMode` without listing it.

## Refuted

None. The refuter confirmed all seven findings and re-rated P2-2 to P3.

## Discarded before raising (auditor's own checks)

- **"A roller should scale by object Ø ÷ roller Ø."** Wrong. That ratio counts revolutions, not surface travel. LightBurn says the roller object diameter "does not affect output", and KerfDesk's `M/(π·r)` matches.
- **"An angled image scan (ADR-492) is mis-scaled, because the rotary transform scales scan-frame bounds."**
  - `compile-job-raster.ts:134-146` (`rasterScanRuns`) forces 0° whenever `device.rotary.enabled`.
  - The only gap is the twin `enabled` vs `rotaryAppliesTo` (enabled with invalid measurements), which is unreachable: both validators and both UIs reject non-positive values.
- **"Raster row pitch is not scaled."** Wrong. Rows sit at `bounds.minY + (i + 0.5)·(span/height)` (`emit-raster.ts:195,231`).
- **"The strip formula is off by the thickness."** Wrong. A strip wraps at radius `r + t/2`, so `L = π(d + t)`.
- **"Rotary Setup Apply is not guarded while a job runs, unlike the switch."** Dropped. The running program is frozen, and recovery and second pass read the archived project, so there is no failure scenario.

## Verified clean

- **Formulas and units.**
  - Chuck and roller scale, and wrap limit, match LightBurn's definitions.
  - Diameter is used throughout: no radius, no degrees.
  - Circumference ↔ diameter linking stores the unrounded diameter (`rotary-setup-edit.ts:92-98`).
  - The math tests use independent oracles (`rotary.test.ts`, e.g. `40·80/25 = 128`).
- **One source of truth (ADR-127).** These all call `machineSpaceJob` / `rotaryWrapLimitMm`:
  - G-code emit and `.rd` emit;
  - Frame bounds (`frame-bounds-preview.ts:34`, `required-frame-readiness.ts:47`);
  - the canvas Frame perimeter, which maps back to the surface with the same reverse (`canvas-frame-perimeter.ts:17-37`);
  - the live estimate and Job Review metrics (`live-job-estimate.ts:168`, `prepared-job-metrics.ts:51`);
  - the wrap preflight.
  - Job Review's Rotary fact, the switch title and the wrap preview all use `rotaryYScale` / `rotaryYLimitMm`, so the numbers agree.
- **Transform.**
  - Final-pass burns, lead contours and contour-entry bounds are mapped.
  - Arcs are dropped to chords, and the arc option is disabled in the UI.
  - Reverse mirrors within `[0, extent]` and flips raster traversal without rewinding streamed providers.
  - Byte-identity when inactive: the early return in `rotary-transform.ts:35`, plus the golden digests in `emit-gcode-rotary-roller.test.ts`.
- **Mode-dependent features are set aside on an active rotary.** Positioning light, timed start mark, Artwork centre & LED, canvas start editing, second pass, the laser finish position and the positioned recovery preview. Head move keeps Y and moves X only.
- **Test rotation** (L4/L6).
  - Jogs only, no power word.
  - Refuses under momentary Fire and re-checks Fire before the return.
  - Cancel/Abort epochs suppress the return.
  - Closing the dialog stops motion (`use-rotary-test-rotation.ts:61-69`).
  - A refused turn, alarm or disconnect ends with a reason.
  - Feed is clamped 100–1500 mm/min and to the profile maximum.
  - The chuck's single "Turn chuck once" matches LightBurn's Test; the roller drive turn matches LightBurn's "the roller … must complete the rotation".
- **Rotary switch.** Disabled while a job, motion or controller operation owns the machine. It is one undoable edit, and it expires a completed Frame (`RotaryModeSwitch.frame.test.tsx`).
- **Persistence.** The rotary is part of `project.device`. It is saved in `.lf2` and machine profiles (ADR-127). `optionalRotarySetup` rejects a non-boolean `enabled`, an unknown type, non-positive or non-finite values and a non-boolean `reverseAxis`. Choosing another machine replaces it (`machine-choice-replaces.ts:36`).
- **A axis / `$103`/`$113`.** Not applicable. Laser output never writes an A word, and the laser rotary is Y-port only. The A axis exists only in the CNC wrap study.
- **Preset.** One entry (Creality Rotary Kit Pro, chuck, 40 mm per turn, Falcon family), offered only for that family. Its source text says to check with Test rotation.
- **ADR-315 disclosure.** Exactly one raster warning, only for an active laser rotary with a raster group (`rotary-raster-qualification-warnings.ts`). It changes no bytes and no gate.
- **Refuter spot-checks (2026-10-22).** These hold:
  - roller scale `M/(π·r)` against the LightBurn page;
  - `rasterScanRuns` forcing 0° (`compile-job-raster.ts:134-146`);
  - the arc row disabled (`LaserArcMovesRow.tsx:24-39`);
  - the Fire re-check before the return turn (`rotary-test-rotation.ts:149`);
  - the single chuck preset.

  One citation nit: `rotary-transform.ts:35` is the active identity case (scale 1, no reverse,
  min Y 0). The inactive byte-identity return is `rotary-job.ts:33`.

## Not verified

- **Physical rotary output.** ADR-127 and ADR-373 still mark it CLAIMED. Nothing here was run on hardware.
- **Burn speed on the surface.** Emitted `F` is machine-axis speed, so on a chuck or scaled roller a
  Y-direction stroke moves the surface at `F/scale`. With the Creality preset (scale 0.159 for Ø80),
  that is about 6× the layer speed. The inspector's energy shading models this
  (`use-laser-burn.ts:176-181`), but Job Review does not mention it. LightBurn's documentation is
  silent, and its forum threads disagree, so no anchor was found. Not raised.
- **GRBL soft limits during a rotary job (ALARM:2).** The rebased Y runs 0..+extent. LightBurn's
  page warns about ALARM:2 "because rotary travel exceeds the Y axis Max Travel". The controller-side
  interaction with `$20`/`$131` was not traced.
- **Ruida `.rd` rotary.** Ruida controllers carry their own rotary settings, so double scaling is
  possible. Ruida is out of scope for v3.
- **Firmware rotary modes.** Machines whose firmware remaps a dedicated rotary port (xTool RA2 Pro
  on D-series, some Falcon models) were not checked. The Creality manual page returned 403, and no
  xTool, Sculpfun, Ortur or Atomstack preset exists to check.
- **Recovery after a motion kill.** Resuming a rotary job after one loses the rotation reference.
  That belongs to areas 05/18.
- **Rotary with fill runways at a non-zero hatch angle, or tangential contour entries.** Possible
  laser-off Y excursions below 0 that would raise P3-2-style warnings. Not reproduced.

```json
[
  {"id":"P2-1","severity":"P2","area":"ctl-rotary","file":"src/ui/laser/RotaryTestRotationPanel.tsx","line":104,"anchor":"Contract: ADR-373 Consequences/Context; Ground truth: LightBurn rotary page (roller Object Diameter does not affect output; Test turns the roller)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Unscaled-roller Test rotation says 'adjust the measurements' but only the object diameter is editable, and the Y scale ignores it: tuning it until the mark lands makes the test pass and hides the ~2x wrong-size wrap that the unscaled default gives on a stock Y-port roller, with matching false diameter/circumference figures (refuter correction)"},
  {"id":"P2-2","severity":"P3","area":"ctl-rotary","file":"src/ui/laser/start-blocked-alarm-offers.ts","line":86,"anchor":"Ground truth: gnea/grbl config.h HOMING_INIT_LOCK + HOMING_CYCLE_1, alarm 9","evidence":"REPRO","verdict":"CONFIRMED (re-rated P2->P3 by refuter)","known":false,"summary":"With the rotary on, Home is not adapted: an alarm-blocked Frame offers only Home (never Unlock when homing is on), and $H spins the part on the Y-port rotary until ALARM:9"},
  {"id":"P3-1","severity":"P3","area":"ctl-rotary","file":"src/core/preflight/preflight.ts","line":220,"anchor":"Twin: ADR-127 consistent mapping; bounds check uses wrap override, no-go check does not","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"No-go zones are checked against rotary Y (rotation), giving false collision warnings on rotary jobs and jogs"},
  {"id":"P3-2","severity":"P3","area":"ctl-rotary","file":"src/ui/state/laser-jog-warnings.ts","line":72,"anchor":"Twin: rotary Y is relative (rotary-transform.ts header) vs positional [0,wrap] checks","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Preflight with a trusted offset and jog warnings treat rotary Y as an absolute position in [0,wrap]; false out-of-bed and jog-bounds warnings, including Test rotation turns"},
  {"id":"P3-3","severity":"P3","area":"ctl-rotary","file":"src/ui/gcode-inspector/gcode-inspection-source.ts","line":120,"anchor":"Twin: rotary-transform.ts reverse mirror vs inspector wrap sense","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Inspector 'Wrap round the rotary ... as it comes off the machine' ignores reverseAxis and shows reversed setups mirrored"},
  {"id":"P3-4","severity":"P3","area":"ctl-rotary","file":"src/ui/laser/device-setup/DeviceSetupRotaryFields.tsx","line":85,"anchor":"Twin: copy vs rotary-calibration-pattern.ts; Ground truth: LightBurn Mirror Output","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Machine Setup says the calibration pattern measures one full revolution and shows direction; it is a Y-symmetric rectangle under half a turn with no measuring instructions"},
  {"id":"P3-5","severity":"P3","area":"ctl-rotary","file":"src/__fixtures__/rotary-raster-save-project.ts","line":32,"anchor":"Contract: ADR-315 decision 1; METHOD L7","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Rotary fixture still says its raster requires Labs permission; no test pairs rotary with no-go zones, a trusted offset or the Home offer"}
]
```
