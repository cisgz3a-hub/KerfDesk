## ADR-096 Amendment 1 - The motion manifest reads Smoothieware's beam the way its laser module does (2026-10-23)

**Status:** Accepted. | **Date:** 2026-10-23

Amends ADR-096 (Smoothieware support) for the motion manifest and the consumers built on it. The
emitted Smoothieware bytes are unchanged.

### Context

`buildMotionManifest` armed the beam only on `M3`, `M4` or `M106`. The Smoothieware strategy
rewrites M3/M4 to `M400` + `M221 S100 P…` and M5 to `M400` + `M221 S0`, because Smoothieware's
laser module ignores M3/M4/M5 and fires any G1/G2/G3 at its S value times the M221 scale
(Laser.cpp; the independent oracle `src/__fixtures__/controllers/smoothie-laser-power-model.ts`
ports it). The manifest therefore read every Smoothieware burn as travel:

- `buildMotionManifest` of a Smoothieware square gave six `travel` blocks; the GRBL square gave
  `travel, process ×4, park`.
- The live canvas drew burns as travel, with no burn glow, trail or job-start marker; the camera
  burn check said "The camera could not see the job's path."; the executable plan counted 0 mm of
  process.

The Inspector already had a Smoothieware power mode (`laserPowerControlForDevice`) and counted the
burns. Rolling audit v2 03-P2-8 found the disagreement on 2026-10-21; meta audit v1 M2 re-checked it
on main on 2026-10-23.

### Decision

1. `BuildMotionManifestOptions.laserPowerControl` takes the Inspector's vocabulary (`spindle`,
   `fan`, `smoothieware`). With `smoothieware` the manifest:
   - treats a G1/G2/G3 as process when its modal S is above zero and the M221 scale is above zero;
   - reads `M221 S` as the percent scale (power-up 100%), never as the motion S;
   - never treats a G0 as a burn, and ignores M3/M4/M5.
   Without it, M3/M4/M106 arm the beam as before, so GRBL, grblHAL, FluidNC, Marlin and CNC
   manifests are unchanged.
2. Callers that know the profile pass `laserPowerControlForDevice(device)`: the canvas motion plan
   (first build and the rebuild for a resumed program), which feeds the live route, burn trail,
   job-start marker and camera burn check; and the laser restart preview, whose worker request now
   carries the sealed profile's value. The executable plan passes `smoothieware` when its emitter is
   the Smoothieware strategy.
3. Mark job start and the painted second pass stay GRBL-family only and keep their M3/M4 reading.
4. The manifest starts S at 0, not Smoothieware's power-up `laser_module_default_power` (0.8): that
   value is configuration and survives between programs, so an unknown start is read as dark.
   KerfDesk's own programs always state S on their burns.

### Consequences

- On Smoothieware the live view shows burns as burns, the burn trail and job-start marker appear,
  the camera check finds the path, and the executable plan reports the burned length.
- No output byte changes, so the emitter revision is not affected by this amendment.

### Verification

- `src/core/job/motion-manifest-smoothieware.test.ts`, failing before this change: a Smoothieware
  square classifies like the GRBL square; its process blocks are exactly the oracle's powered burns,
  line for line; `M221 S0` keeps a G1 S0.5 dark and `M221 S100` re-arms it; a G0 with S is travel;
  the executable plan reports 80 mm of process.
- `src/ui/state/canvas-motion-plan.test.ts`: a Smoothieware canvas plan and its rebuilt plan read
  the burn as process and get a job start.
- `src/ui/laser/laser-recovery-preview-route.test.ts`: the worker request carries the profile's
  beam semantics.
- Code, simulator-oracle and test evidence only. No Smoothieware controller was run.
