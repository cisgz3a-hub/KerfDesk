## ADR-441 Amendment 9 - The calibration grade covers the whole bed the camera sees (2026-11-10)

**Status:** Accepted (rolling audit v13 finding Y1-P2-1, rated P1 by its independent refuter and
confirmed by the audit coordinator on main `4c4b98fd0`; Y1-P3-1 and Y1-P3-6 are fixed with it; the
maintainer's standing instruction to fix confirmed audit findings). Amends Amendment 4 Decision 4
(the grade says what it measured) and corrects Amendment 8's Consequences ("Across the rest of the
bed it is within about 1.3 mm"). Advice only: nothing is refused (ADR-228). | **Date:** 2026-11-10

### Context

Amendment 8 made a 300 × 200 mm sheet the default and said the rest of a 400 mm bed stays within
about 1.3 mm. The audit and its refuter calibrated rendered truth cameras through the real chain.
Their lenses came from other families than the fitted Kannala-Brandt model: Brown–Conrady with k3,
tangential terms and skew, division, and equisolid. The results:

- **The far bed was millimetres off while the rings read fine.**
  - The rings read 0.03–0.10 mm.
  - The far bed was 2.6–5.8 mm off for centred cameras (4K, a 30° oblique mount, a 600 × 400
    bed), 3–12 mm off for off-centre ones, and up to 36 mm off with the auditor's lens.
  - Every one of these was graded "Accurate enough for placing artwork by eye".
- **The caveat gave no figure, and its fix couldn't help.** The caveat ("outside the target the
  picture is estimated") gave no size or place. It prescribed "A smaller margin", which adds a few
  millimetres to a 290 × 190 mm area (Y1-P3-6).
- **The settings row dropped the caveat** (Y1-P3-1).
- **Nothing after the wizard read the accuracy.** Job Review, Start and the overlay never did.

### Decision

1. **An estimate of the bed beyond the rings** (`core/camera/model/extrapolation-estimate.ts`).
   - The saved calibration's rings are rebuilt from the record. Each saved error is where the saved
     model put the ring's pixel, so no new field is saved, and old calibrations get the estimate
     too.
   - The rings are refitted:
     - with the other lens-term counts the calibration's own rule allows: one and two terms, and
       four only from 60 rings, because on fewer they bend the picture tens of millimetres past the
       rings (Amendment 8);
     - with the saved term count on each half of the rings alone (left, right, front, back).
   - At each point of a 40-step grid over the bed the camera sees, the estimate is the largest
     distance between where those fits and the saved model put the same pixel, times 1.5.
   - The largest value outside the target, and where it is, is the off-target estimate.
   - On the rendered truth cameras the fits' spread tracked the true error at 0.5–1.5×, and with the
     factor it lands at 0.66–2.1×. Four cases:

     | Camera | True error | Estimate |
     |---|---|---|
     | centred webcam | 1.43 mm | 1.53 mm |
     | strong lens, 100 mm off-centre | 4.45 mm | 6.08 mm |
     | wide pinhole, 100 mm off-centre | 7.77 mm | 11.7 mm |
     | whole-bed sheet | 0.33 mm | 1.22 mm |

   - It is an estimate, and every figure is said as "about".
   - A head camera keeps Amendment 4's advice. Its picture moves with the head, and it gets no
     estimate.
2. **The grade covers the whole bed.**
   - Ring average 0.25 mm or less with an off-target estimate of 1.5 mm or less: **Accurate enough
     for placing artwork by eye**, as before.
   - Over 1.5 mm: tone _fair_, headline **Accurate on the target; elsewhere on the bed up to about
     N mm off.** The headline is also what Camera settings shows, so the row keeps the figure
     (Y1-P3-1).
   - The advice gives the figure and the region, for example "near the top-left corner of the bed",
     in canvas terms. When it is over the limit, the advice says to engrave the target on a larger
     sheet that covers more of the bed. "A smaller margin" is gone, here and in the lens-folds
     message (Y1-P3-6).
3. **The canvas tints the estimated area.** While the camera overlay shows a fixed camera's
   picture, the bed cells whose estimate is over 1.5 mm are tinted, with one line: "Tinted: the
   camera picture is estimated here, not measured, and may be up to about N mm off". Amendment 4
   left this out of scope; it is in scope now.
4. **Job Review.**
   - The Start snapshot carries the running camera's own calibration (`cameraCalibration`).
   - With camera placement on and Start from at Absolute Coordinates, a job whose bounds cover grid
     points estimated over 1.5 mm gets a warning: part of the job lies where the calibration is
     estimated, may burn up to N mm from where it shows, watch the Frame, or use a larger sheet.
   - A relative Start from keeps its own advice (ADR-228 Amendment 1).
5. **The wording elsewhere.** The default-sheet comment and the Sheet width tooltip no longer say
   A4 "calibrates the whole bed well". They say it is exact on the sheet and estimated past it.

### Consequences

- The default sheet stays the default. A camera whose bed beyond it is well estimated still grades
  good, and one that is not now says so, with the figure, the place and the fix.
- A whole-bed sheet keeps "Accurate enough".
- The refuter found a 300 × 300 sheet made one off-centre case worse (two lens terms
  extrapolating). The estimate covers that case too: it reads the fit actually saved.
- The first grade or overlay draw for a calibration costs the refits, about 60–220 ms. After that
  the result is cached per calibration.
- The refuter's on-target point (between rings, an off-centre camera 0.66–1.15 mm off against a
  worst ring of 0.13–0.26 mm) is not changed here. The tint and Job Review read the grid inside
  the target too, so a large spread there is still shown.
- Code and rendered-truth-camera evidence only. No real camera was used.

### Verification

- `src/core/camera/model/extrapolation-estimate.test.ts` calibrates Brown–Conrady truth cameras
  through the real chain (`extrapolation-fixtures.ts`, `brown-truth-camera.ts`):
  - a centred webcam, a strong lens centred and 100 mm off-centre, and a wide pinhole 100 mm
    off-centre each fall within 0.6–2.5× of the true off-target error;
  - a whole-bed sheet stays under the limit;
  - the estimate is small on the target and large at the far corner;
  - a head camera, or a record without its rings, gets none.
- `src/ui/camera/calibrate/calibration-whole-bed.test.tsx` checks:
  - the off-centre calibration grades _fair_ with the figure, the region and the larger-sheet
    advice, and the whole-bed one grades _good_;
  - the lens-folds message no longer asks for a smaller margin;
  - Job Review warns for a corner job at Absolute and not for one on the target, without
    placement, or at a relative Start from;
  - the warning reaches the real `prepareStartJob`;
  - the canvas tint draws for the off-centre calibration and not for the whole-bed one.
