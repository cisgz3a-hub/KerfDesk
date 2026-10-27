## ADR-440 Amendment 7 - The camera target and the nudge ring compile with Start's controller evidence (2026-10-27)

**Status:** Accepted. | **Date:** 2026-10-27

### Context

Amendment 1's Context says the target's rings become places on the bed "when the controller proved
it, [through] the native bed frame's offset (`runtimeCoordinatePreparationOptions`)". Its Decision 1
says that for **Engrave target** the calibration's frame "is the frame at engraving". ADR-567 says
fresh laser output uses the `$30` of a connected GRBL v1.1, grblHAL or FluidNC session.

Rolling audit v4, area H1, found that **Engrave target** and the nudge ring (ADR-663 Amendment 2)
met neither. An independent refuter confirmed it on main `a59f74ff9`.

- **H1-P1-1 (P1).** Both rings stream as a transient job (`transient-camera-job.ts`). It compiled
  against a hand-built machine snapshot instead of Start's `machineSnapshot`. That snapshot had no
  `connected`, `controllerSettings`, `controllerSettingsObservation`, `activeControllerCommandSet`
  or `laserModuleReport`.
  - **Position.** Without the observation stamp, `resolveNativeBedFrame` returned null, so the
    program had no native offset. Take a homed stock GRBL (`$23=0` or `3`, both with negative
    travel X[-400, 0] Y[-400, 0]) on a front-left 400 × 400 bed. The target's Frame jogged to
    X70–330 Y115–285, 70–330 mm past the end of travel; the nudge ring's went to X190–210. The same
    rings added to the canvas and Started burned at X-325 to -75. With GRBL's default `$20=0` the
    `$J` Frame is accepted, so the head is driven into the axis ends. Switches only at the homing
    end cannot stop that, even with `$21=1`. Meanwhile the calibration recorded the frame with its
    native offset (`cameraBedFrameFor`), so record and program disagreed.
  - **Power.** Without `connected`, the rings used the profile S range. At `$30=255` under a
    profile S1000, 35 % was S350, which GRBL saturates to full power, against S89 from the canvas.
  - **Warnings.** The only position warning was the generic "mapping is unverified". It is false
    after homing, the step's own advice (ADR-441 Amendment 5), and it never named the off-travel
    target. Every ring burn also carried the false "no current controller power range was
    verified".
  - **Further.** A Falcon A1 Pro's vendor bed frame (`hasVendorPositiveContract`) and Smoothieware's
    laser-module check (`laserModuleReport`) were dropped the same way.
- **H1-P3-1 (P3).** **Inspect current G-code** and the canvas **G-code 3D** view compiled through
  `saveGcodeContext`, which had no `connected`, while the Save dialog built its own context with
  it. A connected `$30=255` under profile S1000 showed S500/S300 where Save and Start wrote
  S128/S77. Controller audit v4 E1-P3-1 (the burn shading divides by the profile S max) assumed
  these bytes used `$30`. Fixing the bytes alone would have shaded them against the wrong range.
- **H1-P3-2 (P3).** The **Run G-code file** review compared a program's S with the profile S max,
  although its context field is documented as `$30`. KerfDesk's own connected Save at profile S255
  and `$30=1000` was flagged "above this laser's S max of 255 … may be a router program". The
  reverse mismatch got no S warning.
- **H1-P3-3 (P3).** The parity test fed Save with Start's own `machineSnapshot`, and the camera
  test mocked `prepareStartJobSnapshot`. A builder that dropped a field passed every test.

### Decision

1. **The camera rings compile with Start's snapshot.** The transient camera job passes
   `machineSnapshot(project, laser, camera)` and overrides only `cameraPlacementActive: true`.
   **Engrave target** and the nudge ring therefore compile with the evidence a canvas Start of the
   same rings uses: the connection, this session's settings and build reads, the vendor command
   set and the laser module. Their program, Frame and S words are those of that Start. This makes
   Amendment 1 Decision 1 true for the program as well as the record. The job keeps Absolute
   Coordinates and the whole output scope, as before. Nothing new refuses: an off-travel Frame
   from an unknown mapping stays a warning (ADR-228). A later field added to Start's snapshot
   reaches the camera rings without a second edit.
2. **Save and the Inspector share one context builder.** `currentSaveGcodeContext`
   (`src/ui/app/save-gcode-context.ts`) builds the context for the Save dialog, Save G-code,
   **Inspect current G-code** and the canvas G-code view. Only the Save dialog adds the
   variable-text advance. The Inspector therefore shows the S words Save writes and Start streams.
3. **The Inspector shades against the range it compiled in.** `handleInspectCurrentGcode` passes
   the S max of the compile (`laserPowerPreparationOptions` on the same context) to
   `projectInspectionContext`, which uses it as the burn laser's `maxPowerS`. This settles
   E1-P3-1 for a connected `$30`; its Marlin fan part (`M106` is always 0–255) is unchanged and
   stays open.
4. **The Run review judges S against the live range.** **Run G-code file** passes
   `liveLaserMaxPowerS(device, laser)` as `laserMaxPowerS`: the `$30` read this session from a
   connected GRBL-family controller, else the profile. The warning text is unchanged and stays a
   warning.

### Consequences

- On a homed negative-workspace GRBL, or a force-origin build homing away from the bed origin,
  **Engrave target** and the nudge ring now Frame and burn inside the travel, where the canvas Start
  of the same rings would. They burn at the connected `$30` range. Machines whose native and bed
  coordinates agree see only the power change, and only when `$30` differs from the profile.
- The confirm before the ring burn no longer shows the false unverified-mapping or unverified-power
  warnings when the session has proved both. When it has not, they still show, as for any Start.
- A connected Inspector view now shows the bytes Start sends and shades them against that range.
  Disconnected, it uses the profile, as before.
- Evidence: `transient-camera-job.compile.test.ts` compiles the real target and ring through
  `engraveCalibrationTarget` and `engraveNudgeRing`, and the same rings through Add target to canvas
  and `prepareCurrentStartJob`. It covers stock GRBL with `$23=0` and `$23=3`, and force-origin
  front-left, all at `$30=255` under profile S1000. The programs are byte-identical, the Frames lie
  inside the travel, and the S word is 89. All four cases fail on the previous snapshot.
  `save-gcode-context.test.ts` drives the real Save and Inspector builders, and fails with the old
  builder (S300 against Start's S77). `RunGcodeFileDialog.test.tsx` covers both directions of the
  `$30` mismatch. The parity test in `connected-laser-power-scale.audit.test.tsx` now builds Save's
  context with the real builder.
- Code and test evidence only. No machine, camera or Falcon A1 Pro was used.
