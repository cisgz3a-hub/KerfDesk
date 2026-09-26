## ADR-443 - Print and Cut marks found by the camera (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

### Context

Print and Cut (Labs) cuts around artwork printed on paper or vinyl. The design carries two
registration marks, the printer draws them on the sheet, and the operator registers the design on
the sheet by jogging the head onto each printed mark and pressing **Capture head**. A two-point
solve (`solveTwoPointRegistration`) then moves, turns and scales the output. This is how
LightBurn's Print and Cut works too, and jogging a dot onto a mark by eye is the slow and
error-prone part.

ADR-440 gives a top-down picture of the bed in millimetres at the material height (ADR-441 and
its amendments). Those millimetres are the scene frame, which is the same frame a head capture is
converted into (`capturedMachinePointToScene`). So a mark found in the camera picture can fill a
registration point directly, and both marks come from one frame without moving the machine.

### Decision

1. **Finding marks (`core/camera/marks/find-marks.ts`).** The frame is flattened over the whole bed
   at 4 px/mm, coarser only above about four megapixels, at the Camera panel's material height and
   height areas. Then:
   - A pixel is dark when it is below the brightest paper near it by a quarter of that level, and
     by at least 30 grey levels. "Near" is a running maximum over the largest mark size, so the
     bed and the artwork beside a mark do not pull the paper level down the way a mean would.
   - The dark pixels are grouped 8-connected. A group is a mark when it is within the size range,
     its box sides are within 1.4 of each other, and its dark pixels balance within 12 % of its
     size around the box's centre. Rings, crosses, dots and squares all pass this test.
   - The paper around the mark must also be clear. From 1.25 to 2 half-sizes out, at most 3 % may
     be dark, and that band may not leave the picture or what the camera saw. This test is what
     keeps honeycomb holes, sheet edges and most of the artwork out.
   - The centre is the darkness-weighted mean over the mark's box and one pixel around it, so it
     does not depend on where the threshold fell.
2. **Which marks are the targets (`match-mark-pair.ts`).** A printer scales a sheet by a fraction
   of a percent at most, so every pair of found marks whose spacing is within 2 % of the design
   targets' spacing is a candidate. The pair lying nearest the design's targets wins, which also
   decides which mark is target 1. The number of other fitting pairs is reported, so a sheet of
   repeated labels is not mistaken silently.
3. **Mark size.** When both targets sit on the centres of small design objects (at most 30 mm, and
   within 0.5 mm), marks from 0.6 to 1.6 times that size are looked for. Otherwise the range is
   2 to 30 mm.
4. **Dialog (`PrintAndCutDialog`).** Two additions:
   - **Use selected marks** sets both design targets to the centres of the two selected objects,
     the left one first. When two objects are not selected, it says to select the marks first.
   - **Find marks with camera** is shown when there is a saved camera model. It captures a frame
     and fills both registration points, labelled **Camera x, y** instead of **Machine x, y**. It
     reports the measured spacing, the print scale, the turn and any other fitting pairs, or how
     many mark-like shapes it saw when no pair fits.
   - **Capture head** stays. A camera point and a head point can be mixed.
5. **Session.** Camera points go into the same session as head captures. They carry
   `source: 'camera'`, the current position epoch and the current coordinate-frame key. The
   existing rule therefore applies unchanged: after a reconnect, reset or frame change, the
   points must be captured again. With the camera, that is one more click. **Apply registration**
   and the output path are unchanged, and the camera never moves the machine.

No new guards. **Find marks with camera** is disabled without a live camera, like **Find pieces**,
because there is no frame to capture (a transport precondition). Nothing is refused; when no pair
fits, the points stay as they were and the dialog says what it saw.

### Measured

- On rendered flat sheets at 4 px/mm with noise, rings, crosses and dots 6 to 10 mm across are
  found within 0.01 mm. A letter-like ring in the artwork is found too, and pairing by spacing
  leaves it out.
- On a rendered 1280 px fisheye frame from a tilted overhead camera, with an A4 sheet on 3 mm
  material turned 5°, the whole 400 × 400 mm bed takes about 0.6 s in Node. Marks 10 mm across
  are placed within 0.05 to 0.12 mm, and the spacing is within 0.07 %. A thin 8 mm cross in the
  far corner reads 0.32 mm off.

### Consequences

- A camera point is only as good as the calibration, typically a tenth to a few tenths of a
  millimetre (ADR-441's accuracy map shows where). Head capture stays for tighter work, and the
  labels show which point came from where.
- The two-point solve keeps inferring scale, so a printer's scaling is corrected, and the dialog
  shows the scale it measured.
- The thresholds (dark share, clear band, 2 % spacing) come from rendered fixtures. A set of
  photographed sheets under real light, for acceptance on real hardware, is still owed.
- Not in this decision: three-point or skew registration, a command that adds marks to the
  design, vendor-specific mark patterns, and keeping the marks tracked while the sheet moves.
