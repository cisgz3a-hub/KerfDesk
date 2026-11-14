## ADR-443 Amendment 4 - No registration on generated scenes, and whole marks only (2026-11-14)

**Status:** Accepted. | **Date:** 2026-11-14

### Context

Camera audit v2 (area K3, `docs/audits/2026-11-14-camera-v2/K3-target-trace-and-pieces.md`) found
two Print and Cut faults.

- **K3-P1-4.** "Add target to canvas" replaced the scene but kept the project's
  `printAndCutTargets`. With Labs Print and Cut on and both marks captured, the target's ordinary
  Start applied the registration (`currentPrintCutOutputRegistration`, `applySimilarityProject`),
  so the 35 rings burned 8.6–18 mm from their layout, turned. `stampCanvasTargetBurn` checked the
  unregistered scene and still recorded `burnSeen: true`.
  - A move of a flat target within its own plane looks, in one photo, exactly like a move of the
    camera the other way. The pose fit therefore absorbs it with no residual: the calibration was
    graded "fair, about 1.6 mm" while it was 11–22 mm off.
  - Job Review said nothing.
  - With Labs off, the same project's target Start was refused with a Print and Cut message that
    did not mention the target.
- **K3-P2-3.** `findMarks` read a mark's size from its box's longer side only, and allowed an aspect
  of 1.4 and an off-centre of 12 % of the size. A ring 20–30 % under tape was accepted, its centre
  0.8–1.3 mm off, under "The camera found both marks".

### Decision

1. **A generated scene drops the project's Print and Cut marks**
   (`replaceSceneWithGeneratedScene`). This covers the camera target, the focus and tone tests, the
   calibration grids, the scan-offset pattern, the Photo Test Card and the rotary setup scene, all in
   the same Undo step as the new scene. The marks named marks of the design being replaced, so no
   generated pattern is ever moved by their registration. Undo brings the design and its marks back
   together.
2. **A canvas target burned through a registration is refused** (ADR-441 Amendment 10 extended).
   - When the Start that streams the target's rings carries Print and Cut marks (a laser project),
     `stampCanvasTargetBurn` records `burnedRegistered` instead of `burnSeen`.
   - The photo step refuses with "This target's rings were burned through the project's Print and
     Cut registration …", and points to adding the target again or Engrave target.
   - A later plain Absolute Start of the same rings clears it. The wizard's Engrave target was
     already safe: its transient job takes no registration.
3. **Only whole marks are taken** (`find-marks.ts`).
   - Every design mark is symmetric under a quarter turn, so its box is square at any angle.
   - A found mark's box sides may differ by at most 5 % of its size, or 2 px on a small mark (was
     an aspect of 1.4), and its dark centre must lie within 5 % of the size from the box's centre
     (was 12 %). The 2 px are what a tilted fisheye picture, flattened, leaves on a whole 6 mm
     ring.
   - When the design's mark size is known (`print-cut-camera.ts`), each side must also lie within
     10 % of it, plus the same 2 px.
   - A partly covered mark is therefore not found, and the dialog says the camera could not find
     both marks, rather than registering on a centre that is off.

### Measured (synthetic, no camera)

- A 6 mm ring at 4 px/mm, white tape over 15, 20, 25 or 30 % from the side or the top: refused
  (before: accepted up to about 30 %, centre up to 1.09 mm off at the detector). At 10 % it can
  still be taken, its centre within 0.3 mm. The uncovered ring is found within 0.05 mm.
- The tilted-fisheye camera scene still finds both marks and the decoy ring beside them.
- `addCalibrationTargetToCanvas` on a project with Print and Cut marks: the marks are gone, and
  `currentPrintCutOutputRegistration` is undefined, so an ordinary Start burns the rings where the
  target put them. Undo restores the marks.

### Consequences

- A mark printed more than about 10 % off its design size (a "fit to page" print scale, for
  instance) is not found by the camera any more. Capture head still registers on it, and the
  dialog's spacing and print-scale figures show the scale.
- Running a calibration pattern from a Print and Cut project now leaves the project without its
  marks until Undo, or until they are set again with **Use selected marks**.
