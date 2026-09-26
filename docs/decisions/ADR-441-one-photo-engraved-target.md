## ADR-441 - Calibrate the camera from one photo of a target the laser engraves (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This replaces the printed-checkerboard lens wizard (ADR-108) and the five-marker bed alignment
wizard (ADR-109, F-CAM9) with one wizard that fits the ADR-440 camera model.

### Context

The old setup took two wizards and a printer: capture a printed checkerboard in many poses for the
lens, then burn five markers for a homography. Operators reported the result as useless, and on a
synthetic bed it was: the two fits were independent and each absorbed the other's error.

LightBurn, xTool, Glowforge and Luban calibrate from something the machine itself engraves or from
a factory target. A target the laser engraves is where the laser really fires, so the same marks
calibrate the lens, find the camera's position and map the picture onto the bed, with no
coordinates typed in.

### Decision

1. **Target** (`core/camera/target/bed-target.ts`, `core/job/camera-bed-target-pattern.ts`): rings
   of 10 mm outer diameter every 40 mm across the bed inside a margin, ring width 18 % of the
   diameter, filled on one layer so the hole stays unburned. Three solid discs of the same size
   form an L near the middle: the corner is the origin, the short arm (one step) points along +x and
   the long arm (two steps) along +y. Unequal arms expose a mirrored camera picture, which an equal
   L cannot.
2. **Detection** (`ring-detect.ts`): an adaptive dark mask, connected components, and a ring is a
   component with a hole of plausible size near its centre. A disc is an anchor candidate only when
   rings enclose it (the widest empty arc between its ring neighbours is under 0.8 pi), so marks at
   the sheet's edge and scraps beyond it are not taken for anchors.
3. **Matching** (`target-match.ts`): try anchor L candidates, then grow the grid ring by ring,
   predicting each neighbour from the local step so fisheye curvature is followed, accepting only a
   ring close to the prediction with a similar size. At least 8 rings and a quarter of the target
   must match.
4. **Fit** (`bed-calibration.ts`): the matched rings at the sheet's top surface feed
   `fitCameraModel` (ADR-440); four distortion terms from 30 rings up, two below. The result reports
   each ring's error in bed mm, RMS and worst error, rings found of rings expected, and the camera
   height with its sigma. An optional tape-measured camera height is a prior (sigma 15 mm).
5. **Wizard** (`ui/camera/calibrate/`): Setup (sheet thickness, optional camera height, power,
   speed, margin), then **Engrave target**, which streams the target as a temporary laser job
   (in CNC mode too, per ADR-416) through the normal Frame, review and Start path without touching
   the project or undo history, or **Target already engraved**. The photo step shows the live camera and **Take photo**; the solve runs in a
   worker and can be cancelled. The result shows the grade, the four figures and the photo flattened
   onto the bed with every ring coloured by its error. **Save calibration** is always available: a
   rough fit is described with what to fix, never refused (ADR-228). Saving turns the overlay on.
6. **Grades** describe, they do not gate: good up to 0.25 mm average error, fair up to 0.6 mm,
   rough beyond. Below 60 % of the rings found, the advice says which areas are estimated. When the
   camera height sigma is above 10 mm and no height was entered, the result asks for a tape-measured
   height.

### Measured

On rendered 1280 px fisheye photos of a 390 mm target with a honeycomb bed behind it:

| Case | Rings found | Error on the bed, RMS / worst |
|---|---|---|
| Tilted overhead camera, material at 0, 3, 10 and 25 mm | 100 of 100 | about 0.06 mm / at most 0.27 mm |
| Camera straight down, height typed 15 to 20 mm off, 25 mm material | not recorded | 0.15 to 0.54 mm |
| Camera straight down, no height typed | not recorded | camera height 167 mm instead of 400 mm; 13.5 mm error at 25 mm |

Ring detection took 264 ms and the fit 391 ms on the tilted case, off the main thread.

### Consequences

- One target and one photo replace two wizards and a printer.
- The "Calibrate lens…" and "Align to bed…" buttons, the checkerboard printing, the Labs switch
  and their stores are gone; the Camera panel has one **Calibrate camera…** row that also shows the
  saved calibration's date and average error.
- A straight-down camera needs the tape-measured height for thick material; the wizard asks for it
  only when the photo could not pin the height down.
