# K1 — Calibration and model (camera audit v2, `calibration-and-model`)

**Question.** After a calibration that KerfDesk calls successful, how far from the overlay does artwork really land on the bed, and does the app ever claim better accuracy than it has? The checks cover:
- the one-photo fit (`calibrateFromBedTarget` → `fitDeterminedLens` → `fitCameraModel`, outlier drop, determined lens terms);
- the camera-to-bed model at the target height, on the bare bed and on thicker material;
- the accuracy the app reports: the ring figures, the grade, the off-target estimate (ADR-441 Amd 9), the canvas tint and the Job Review warning;
- noise, blur, JPEG-like quantisation, dim light, covered rings and wrongly engraved or detected rings;
- wide fisheye lenses, tilted, rolled and off-centre mounts, a 600 × 400 bed, larger sheets;
- the head camera and its stitch;
- Check camera (model drift) and Fix a small offset (nudge);
- saved calibrations round trip.

**Tree.** `origin/main` @ `ba08a81af` (read-only export `j42-main`). `git diff --stat ba08a81af origin/main -- src/core/camera src/ui/camera` is empty: main has not moved under these files.

**Method.**
- **Own truth, own renderer** (`truth.mts`). No app code is used to make a picture or to measure an error:
  - pose: look-at with roll, plus rigid moves about the camera centre;
  - lenses: Brown–Conrady (k1..k3, p1, p2, skew), equisolid, stereographic and equidistant fisheye, and a division lens;
  - inverse: numeric-Jacobian Newton for Brown, closed form for the others; round trip ≤ 6e-11 mm (`k0-selftest.out.jsonl`);
  - scene: the engraved target on a 3 mm sheet with a faint grain, a slat bed (2 mm bright blades every 20 mm), a frame rail, a blocky surround, and raised occluders as 3D boxes;
  - rendering: 3 × 3 supersampling, Gaussian blur σ 0.6 px, vignetting, Gaussian noise σ 2, and optionally 8 × 8 DCT quantisation with the JPEG luminance table.
  - The only app input used is the target layout (`bedTargetLayoutWithRings`), the positions the operator engraves.
- **Real chain** (`harness.mts`): `calibrateFromBedTarget` → `cameraModelFromCalibration` → `calibrationGrade`, `extrapolationEstimate`, `estimateWithin` (the Job Review call), and `shareOutsideTarget`. The inputs are what `photographTarget` passes (`calibration-actions.ts:216-237`): the layout from the target area, sheet thickness 3 mm, and the tape height only when one is typed.
- **True error.** At bed point P and height h: the saved model's pixel for P (`projectWorldPoint`) is pushed through the truth camera's own inverse onto the plane at h, and the distance to P is taken. This is where artwork drawn over P on the overlay really lands.
  - Grid: 5 mm over the whole bed (6,561 points on 400 × 400), wherever both cameras see P inside the frame.
  - Split into on target, off target, bed edge (25 mm strip) and corners (50 mm squares).
  - Heights: 3 mm (the sheet), 0, 20 and 40 mm.
- **"Unwarned".** A grid point whose true error is over 1.5 mm (`GOOD_EXTRAPOLATED_MM`) where `estimateWithin` returns ≤ 1.5 mm or null. At such a point the tint, the grade and Job Review all stay quiet.
- **Default geometry.** 1280 × 960 grey frames, a 400 × 400 bed, the default 300 × 200 sheet with a 5 mm margin, and 10 mm rings.
  - The truth webcam is "Brown std": f 760 px, k1 −0.28, k2 0.08, k3 −0.01, p1 0.0008, p2 −0.0006. It sits 400 mm up over the bed's back edge, aimed at the bed centre.
  - The 1280 × 720 variants of that camera at 420 mm refused the target (`anchors-unclear`: the far rows' rings fall below about 9 px), so 4:3 frames were used.
- **Scripts.**
  - Accuracy matrix: `k1-matrix.mts` (groups a/b/c).
  - Degradations: `k2-degrade.mts` (a/b).
  - Drift and nudge: `k3-nudge-drift.mts`.
  - Head camera and stitch: `k4-head.mts`.
  - Saved round trip, gross label outliers through `fitDeterminedLens`, and extreme fisheye: `k5-saved-outliers.mts`.
  - Root cause: `k6-why.mts`.
  - Full-bed sheet wording: `k7-fullbed.mts`.
- **Memory.** One Node process at a time, `--max-old-space-size=380`. Free memory was 0.9–2.2 GB at the checks. No Vitest, no browser, no camera, no network, no hardware.

## Headline

**On the rings the calibration is honest, and Check camera catches every move tried. Beyond the rings, the Amd 9 estimate that now decides "Accurate enough" under-reads by 2–3× for ordinary centred webcams. After a calibration the app grades good, artwork lands up to 4.5 mm off, and Job Review stays silent.**

- **On target:** the true error stayed at 0.06–0.57 mm worst in every calibrated case without a deliberately bad ring, except the strong-tangential lens B6 (0.84 mm, graded fair). The reported worst ring was within 0.4 mm of it. The ring map's honesty, which Y1 found, still holds.
- **K1-P1-1:** the off-target estimate (ADR-441 Amd 9, the fix for Y1-P2-1) under-reads.
  - Seven of the 35 fixed-camera calibrations that succeeded were graded **"Accurate enough for placing artwork by eye."** with an estimate of 1.14–1.45 mm:
    - centred Brown webcams, standard and strong, a 4° roll and a 300 × 300 sheet;
    - the same camera with a laser head or a clamp over the target, or one ring engraved 2.5 mm off.
  - In those seven the true error was **2.75–4.50 mm** at the bed's top-right corner, rising to 5.13 mm on 40 mm material.
  - Up to 219 grid points (3.3 % of the visible bed) are over 1.5 mm, and **every one of them is unwarned**.
  - In nine more cases the grade was "fair", but Job Review stays silent where the truth is over 1.5 mm. The headline also names the wrong corner: "about 1.9 mm near the bottom-left" while the top-right is 2.9 mm off.
  - Root cause (`k6`):
    - the "other term count" alternatives go through `fitDeterminedLens`, which drops the extra term again and returns the saved fit, so their spread is zero;
    - the half-ring refits measure only the ring noise, so the estimate rises from 1.27 to 1.98 to 2.68 mm as the photo's noise rises, while the truth stays at 3.2–3.5 mm.
- **K1-P1-2:** Fix a small offset bakes a tip into the calibration.
  - A 1° pitch reads 8.7 mm at the bed centre, under the 10 mm limit, so **Fix** is offered.
  - After the fix the target is still up to 2.7 mm off and the bed up to 6.8 mm. The grade stays "Accurate enough".
  - The fix renews the camera-moved reference and marks the camera steady.
  - ADR-663 Amd 2 says "The fix says so"; the Fix screen does not.
  - A 0.5–1° roll gives "The picture already lines up with the ring … Nothing to fix" while the bed is 3.9–5.7 mm off.
- **K1-P2-1:** a full-bed sheet now grades **fair**.
  - It says "up to about 1.8 / 2.8 / 5.3 mm off near the top-left corner" and advises a larger sheet. The truth is 0.30–0.50 mm.
  - ADR-441 Amd 9: "A whole-bed sheet keeps 'Accurate enough'".
- **K1-P2-2:** the "lined up at the target height only" caveat (Amd 7) lives only in the wizard and the settings row.
  - Changing the overlay's Material height to 20 mm on such a calibration puts the picture 7.7 mm off (16.9 mm at 40 mm), with no notice at the Material height control or in Job Review.
- **K1-P3-1:** a head camera reports "Average error 0.00 mm, Worst ring 0.01 mm". The stitched picture it builds is 0.83 mm off at the tile edges, and neighbouring tiles disagree by up to 1.1 mm.
- **Holds:**
  - Check camera flagged all eight moves (0.9–8.8 mm rms on the rings);
  - gross label errors and rings 4 px or more off are dropped;
  - a saved calibration round-trips exactly;
  - blur, a half-covered target and over-wide fisheyes are refused, not misfitted;
  - when the camera height is pinned, the model is exact at other material heights (≤ +0.5 mm at 40 mm).

**Worst placement after a "successful" calibration:**
- graded good: **4.50 mm** at sheet height, 5.13 mm on 40 mm material (A3, centred strong webcam);
- after the app's own Fix: **6.77 mm** (1° pitch);
- after "Nothing to fix": **5.67 mm** (1° roll).

## Accuracy tables

True error over the visible bed at the sheet height (3 mm), mean / p95 / max in mm (5 mm grid, about 6,560 points). "On tgt" is the worst point on the target area. "Reported" is the wizard's Average error / Worst ring. "Est." is `extrapolationEstimate().worstMm`. "Unwarned" counts points with true > 1.5 mm and no estimate over 1.5 mm, out of all points with true > 1.5 mm. "(H)" means `onlyAtTargetHeight`.

### Lens families and mounts (`k1-matrix-*.out.jsonl`)

| Scenario | True mean / p95 / max | On tgt max | Max at 20 / 40 mm | Reported | Grade | Est. | Unwarned | Verdict |
|---|---|---|---|---|---|---|---|---|
| A1 Brown std, centred, 400 up | 0.16 / 0.69 / **3.17** | 0.16 | 3.36 / 3.64 | 0.06 / 0.12 | **good** | 1.27 | **87/87** | **K1-P1-1** |
| A2 Brown mild (k1 −0.12) | 0.13 / 0.43 / 1.29 | 0.12 | 1.53 / 1.84 | 0.06 / 0.14 | fair "3.1 mm" | 3.06 | 0/0 | over-read (safe) |
| A3 Brown strong (k1 −0.36 k2 0.13 k3 −0.02) | 0.26 / 1.14 / **4.50** | 0.29 | 4.76 / 5.13 | 0.07 / 0.16 | **good** | 1.35 | **219/219** | **K1-P1-1** |
| A4 Brown std, 60 mm off-centre | 0.18 / 0.78 / 4.87 | 0.26 | 5.24 / 5.75 | 0.07 / 0.14 | fair "7 mm" | 6.95 | 0/149 | holds |
| A5 Brown std, 100 mm off-centre | 0.29 / 1.23 / 6.45 | 0.57 | 6.93 / 7.56 | 0.07 / 0.14 | fair "7.8 mm" | 7.84 | 0/269 | holds (on target 0.57 vs worst ring 0.14) |
| A6 Brown std, 30° oblique from the back | refused `anchors-unclear` | | | | | | | refusal |
| A7 side mount 40° | 0.16 / 0.55 / 1.36 | 0.35 | 1.46 / 1.59 | 0.08 / 0.16 (26/35) | fair "5.6 mm" | 5.63 | 0/0 | over-read |
| A8 Brown std, centred, roll 4° | 0.15 / 0.51 / **2.75** | 0.12 | 2.94 / 3.22 | 0.06 / 0.14 | **good** | 1.18 | **49/49** | **K1-P1-1** |
| B1 phone, pincushion, straight down 560 up | 0.04 / 0.13 / 0.24 | 0.06 | **7.66 / 16.92** | 0.04 / 0.08 | fair (H) | 0.84 | 0/0 at 3 mm; **6170/6170 at 20 mm** | **K1-P2-2** (fitted height 4,520 ± 27,421 mm) |
| B2 same, tape height 570 (10 mm off) | 0.14 / 0.67 / 1.75 | 0.08 | 2.06 / 2.57 | 0.04 / 0.08 | fair "3.3 mm" | 3.33 | 0/10 | holds |
| B3 equisolid fisheye f520, 300 up | 0.12 / 0.36 / 0.74 | 0.15 | 0.94 / 1.23 | 0.05 / 0.12 | fair (H) | 1.38 | 0/0 | holds |
| B4 stereographic fisheye f430, 280 up | 0.24 / 0.75 / 1.83 | 0.20 | 2.22 / 2.78 | 0.08 / 0.16 | fair (H) | 2.40 | 11/21 | partly unwarned |
| B5 division λ −0.25 | 0.07 / 0.16 / 0.36 | 0.10 | 0.39 / 0.42 | 0.06 / 0.11 | good | 1.40 | 0/0 | holds |
| B6 Brown + strong tangential + skew | 0.56 / 1.97 / 7.31 | 0.84 | 7.46 / 7.71 | 0.15 / 0.36 | fair "10.7 mm" | 10.68 | 0/531 | holds |
| C1 600 × 400 bed, centred 450 up | 0.52 / 2.12 / 7.29 | 0.19 | 7.80 / – | 0.09 / 0.19 | fair "8.4 mm" | 8.37 | 0/882 | holds |
| C2 Brown std, sheet 300 × 300 (49 rings) | 0.14 / 0.63 / **3.03** | 0.42 | 3.22 / – | 0.06 / 0.14 | **good** | 1.35 | **73/73** | **K1-P1-1** |
| C3 full-bed sheet, centred (100 rings) | 0.07 / 0.15 / 0.36 | 0.32 | 0.42 / – | 0.09 / 0.23 | **fair "1.8 mm"** | 1.76 | 0/0 | **K1-P2-1** |
| C4 full-bed sheet, 100 mm off-centre | 0.05 / 0.09 / 0.50 | 0.37 | 0.76 / – | 0.08 / 0.21 | **fair "5.3 mm"** | 5.33 | 0/0 | **K1-P2-1** |
| C6 full-bed sheet, 50 mm off-centre (`k7`) | max 0.30 | | | 0.08 / 0.24 | **fair "2.8 mm"** | 2.76 | | **K1-P2-1** |
| C5 same lens on a 1280 × 720 crop, 430 up | 0.19 / 0.81 / 3.06 | 0.21 | 3.27 / – | 0.05 / 0.09 | fair "2 mm" | 1.96 | 49/99 | K1-P1-1 (Job Review) |
| F equisolid f400 at 260 mm, 10 mm rings | 0.22 / 0.57 / 1.06 | 0.27 | 1.46 / – | 0.07 / 0.15 | fair (H) | 7.06 | 0/0 | holds |
| F equisolid f400, 16 mm rings | 0.53 / 1.38 / 2.51 | 0.51 | 3.09 / – | 0.10 / 0.26 | fair (H) | 5.84 | 0/233 | holds |
| F equidistant f360 at 240 mm, 16 mm rings | 0.57 / 1.46 / 2.62 | 0.54 | 3.29 / – | 0.10 / 0.20 | fair "12.6 mm" | 12.62 | 0/287 | holds |

### Degradations on A1 (`k2-degrade-*.out.jsonl`)

| Scenario | True mean / p95 / max | On tgt max | Reported | Grade | Est. | Unwarned | Verdict |
|---|---|---|---|---|---|---|---|
| D0 clean (noise 2, blur 0.6) | 0.16 / 0.69 / 3.17 | 0.16 | 0.06 / 0.12 | **good** | 1.27 | **87/87** | K1-P1-1 |
| D1 noise σ 6 | 0.17 / 0.73 / 3.25 | 0.17 | 0.07 / 0.15 | fair "2 mm" | 1.98 | 19/98 | estimate tracks the noise, not the lens |
| D2 noise σ 12 | 0.23 / 0.86 / 3.46 | 0.24 | 0.12 / 0.25 | fair "2.7 mm" | 2.68 | 99/123 | same |
| D3 / D4 blur σ 1.0 / 1.4 px | refused `anchors-not-found` | | | | | | KNOWN Y1-P3-3 (message blames a cover) |
| D5 JPEG-like q75 | 0.15 / 0.56 / 2.88 | 0.10 | 0.06 / 0.13 | fair "1.9 mm near bottom-left" | 1.89 | **62/62** | worst is top-right, K1-P1-1 |
| D6 JPEG-like q40 + noise 4 | 0.14 / 0.54 / 2.86 | 0.10 | 0.06 / 0.14 | fair "1.8 mm" | 1.76 | **58/58** | K1-P1-1 |
| D7 dim (gain 0.45, vignette 0.6) | 0.26 / 1.12 / 4.09 | 0.32 | 0.07 / 0.17 | fair "2.3 mm" | 2.35 | 120/208 | K1-P1-1 |
| O1 laser head over the target's right end (33/35) | 0.17 / 0.70 / 3.18 | 0.17 | 0.06 / 0.12 | **good** | 1.26 | **88/88** | K1-P1-1 |
| O2 clamp over a corner (34/35) | 0.17 / 0.68 / 3.12 | 0.15 | 0.06 / 0.11 | **good** | 1.14 | **82/82** | K1-P1-1 |
| O3 left half of the target covered | refused `anchors-not-found` | | | | | | refusal |
| X1 one corner ring engraved 1 mm off | 0.35 / 1.28 / 4.03 | 0.51 | 0.15 / **0.68** | fair "3.3 mm" | 3.32 | 89/221 | worst ring shows it |
| X2 one corner ring 2.5 mm off (dropped) | 0.16 / 0.68 / 3.15 | 0.16 | 0.06 / 0.12 | **good** | 1.45 | **84/84** | outlier handled; K1-P1-1 |
| X3 three edge rings 2.5 mm off (3 dropped) | 0.16 / 0.67 / 3.12 | 0.15 | 0.06 / 0.12 | fair "1.5 mm" | 1.54 | 78/82 | outliers handled |
| X4 one ring 6 mm off (dropped) | 0.16 / 0.62 / 3.03 | 0.14 | 0.06 / 0.12 | fair "2.1 mm" | 2.05 | 9/73 | outliers handled |
| X5 whole column 1.2 mm off (stretched sheet) | 1.33 / 4.50 / 11.26 | 1.87 | 0.27 / 0.69 | fair "Good for rough placement" | 10.64 | 0/2082 | flagged |

Gross label outliers into the real fit (`k5`, A1 correspondences):
- two neighbouring rings swapped: 2 dropped, fit unchanged;
- one ring 4 px off: dropped;
- one ring 1.8 px off (under the 2 px floor, `fit-outliers.ts:6-7`): kept, worst residual 1.29 px, bed worst 3.17 → 4.18 mm;
- five rings of one column 1.8 px off: kept, rms 0.39 px, bed worst 10.4 mm.
- The image-level twin (X5) is graded fair and estimated at 10.6 mm, so the systematic case is flagged, not hidden.

### Drift (Check camera) and nudge (`k3-nudge-drift.out.jsonl`)

The base is A1 (0.06 mm, good). "Old model" is the true error of the saved model after the move. The nudge ring is burned at the bed centre (200, 200), as `nudgeRingCentre` does.

| Move | Check camera (real `modelDriftOnMarks` + rule `max(0.3, 1.5 × rms)`) | Old model on tgt / bed max | Nudge offset → UI | After the nudge, on tgt mean / max | After the nudge, bed p95 / max | Grade after |
|---|---|---|---|---|---|---|
| slide 2 mm | 2.00 rms → moved | 2.11 / 4.80 | 1.95 → Fix | 0.07 / 0.19 | 0.71 / 3.13 | good (as base) |
| slide 3 mm | 3.01 → moved | 3.02 / 3.29 | 2.96 → Fix | 0.04 / 0.16 | 0.71 / 3.31 | good (as base) |
| lid 3 mm lower | 1.70 → moved | 2.59 / 3.24 | 1.56 → Fix | 0.74 / 1.41 | 1.66 / 1.90 | good |
| pitch 0.5° | 4.46 → moved | 5.42 / 7.65 | 4.37 → Fix | 0.57 / 1.38 | 2.52 / **4.12** | **good** |
| pitch 1° | 8.84 → moved | 10.99 / 15.05 | 8.68 → **Fix** | 1.13 / **2.69** | 4.95 / **6.77** | **good** |
| roll 0.5° | 0.91 → moved | 1.74 / 3.82 | 0.06 → **"Nothing to fix"** | 0.88 / 1.79 | 2.33 / **3.88** | good |
| roll 1° | 1.81 → moved | 3.38 / 5.67 | 0.05 → **"Nothing to fix"** | 1.75 / **3.43** | 4.47 / **5.67** | good |
| yaw 0.8° + slide 1 mm | 5.42 → moved | 6.44 / 8.11 | 5.19 → Fix | 0.42 / 1.36 | 1.93 / 3.47 | good |

### Head camera and stitch (`k4-head.out.jsonl`)

The camera rides 30 mm beside the nozzle and is calibrated on the default 40 mm head target (20 rings of 2.35 mm). The stitch covers a 160 × 100 mm region through the real `headCameraView`, `planHeadCaptures` and `modelAtHead`. The truth camera is moved rigidly with the head.

| Case | Reported | Grade | Material | Tile error mean / p95 / max | Seam disagreement p95 / max |
|---|---|---|---|---|---|
| Brown k1 −0.20, straight down, 70 up | 0.003 / 0.005 | fair (H), height 56.8 ± 23.9 (true 70) | 3 mm (target) | 0.01 / 0.04 / 0.07 | 0.04 / 0.07 |
| | | | 6 mm | 0.26 / 0.39 / 0.45 | 0.60 / 0.74 |
| | | | 12 mm | 0.80 / 1.24 / 1.44 | 1.72 / 1.72 |
| Brown k1 −0.30 k2 0.09, 8° tilt, 70 up | **0.004 / 0.008** | **good** + "80 % estimated" | 3 mm | 0.09 / 0.37 / **0.83** | 0.54 / **0.94** |
| | | | 6 mm | 0.08 / 0.33 / 0.77 | 0.45 / 1.12 |
| | | | 12 mm | 0.06 / 0.22 / 0.63 | 0.27 / 0.58 |
| equisolid f600, 60 up | refused `lens-folds` with the larger-target advice | | | | |

## Findings

### K1-P1-1 — The off-target estimate that decides "Accurate enough", the canvas tint and the Job Review warning under-reads 2–3× for ordinary centred webcams. Calibrations graded good put artwork 2.7–4.5 mm off at the bed corners, and nothing warns

- **Where:**
  - `src/core/camera/model/extrapolation-estimate.ts:193-226` (`alternativeLenses`).
    - The other term counts are refitted through `fitDeterminedLens` (`:218`), which drops any term that is not 2σ-significant (`fit-determined-lens.ts:81-86`). With 35–49 rings, the two-term alternative falls back to the saved one-term fit.
    - The only remaining spread is the four half-ring refits.
  - `:53`: `SPREAD_TO_ERROR = 1.5`.
  - `calibration-result.ts:153-162` (`goodOnTheRings`): good when `worstMm ≤ 1.5`.
  - `camera-off-target-warning.ts:30-32`: Job Review.
  - `CameraEstimatedArea.tsx:24-32`: the tint.
- **Anchor:**
  - ADR-441 Amd 9 Decision 1 and 2: the estimate "lands at 0.66–2.1×" the true error, and "Accurate enough" means ring rms ≤ 0.25 **and** an off-target estimate ≤ 1.5 mm.
  - Consequences: a camera whose bed is not well estimated "now says so, with the figure, the place and the fix".
  - The Sheet width tooltip (`CalibrationSetupStep.tsx:54`): "past it the picture is estimated, and the result says how far off it may be there".
  - Measured against an independent truth camera.
- **Evidence:** REPRO (`k1-matrix`, `k2-degrade`, `k6-why`), READ.
  - Seven good-graded calibrations had estimates of 1.14–1.45 mm. Their true worst was 2.75–4.50 mm, so the estimate was 0.30–0.48× the truth, against the ADR's floor of 0.66×.
    - The cases: A1, A3, A8, C2, O1, O2, X2. In each one **every** grid point over 1.5 mm was unwarned (49–219 points, up to 3.3 % of the visible bed).
    - At 40 mm material the same points reach 3.22–5.13 mm.
  - Nine fair-graded cases still leave 9–120 points over 1.5 mm with no Job Review warning (D1, D2, D5, D6, D7, X3, X4, C5, B4).
  - The headline names the wrong region. D5 says "may be up to about 1.9 mm off near the bottom-left corner", while the true worst is 2.88 mm at the top-right corner. That corner's estimate is under 1.5 mm.
  - **Root cause** (`k6-why.out.jsonl`, A1's own rings with the estimate's options):
    - Plain one-term and two-term fits match the rings equally well (0.093 / 0.092 px rms).
    - At the top-right corner the one-term fit is 3.17 mm off; the two-term fit is 0.83 mm off.
    - But `fitDeterminedLens(…, distortionTerms: 2)` returns **one** term ("determinedTerms": 1 for 2, 3 and 4). So the alternative is the saved model again and contributes nothing.
    - The same holds on A3 (one term 4.50 mm, two terms 3.72 mm, determined back to one).
  - **The estimate tracks the photo's noise, not the lens** (D0, D1, D2 on the same camera): noise σ 2 / 6 / 12 gives 1.27 / 1.98 / 2.68 mm, against a true 3.17 / 3.25 / 3.46 mm. The half-ring spread is a variance measure; it cannot see the bias that all the low-order fits share.
  - **Test gap:** `extrapolation-estimate.test.ts:18-50` checks only the four 1280 × 720 `brownWebcam` cameras the factor was tuned on. All four are expected to exceed 1.5 mm, so a camera under the limit with a large true error is never tested.
- **Scenario:**
  1. A diode laser with a 1280 × 960 webcam 400 mm up on the back rail, aimed at the bed centre, with an ordinary barrel lens (A1).
  2. The default A4-size sheet. Calibration finds 35/35 rings: "Average error 0.06 mm, Worst ring 0.12 mm". The headline is **"Accurate enough for placing artwork by eye."** with no tint.
  3. The operator lays a coaster in the top-right corner of the bed and drops artwork on it in the overlay.
  4. Job Review says nothing about the camera. The burn lands **3.2 mm** off on 3 mm stock and 3.6 mm off on 40 mm stock; with a stronger lens (A3) it is 4.5 / 5.1 mm.
- **Severity: P1.** It is a silent position error in KerfDesk's own mapping, under a grade that claims the opposite. It is the same harm as Y1-P2-1 (P1 by its refuter and the coordinator), now reached through the estimate that was meant to fix it. A visible misfit on the picture is not a warning (METHOD §3).
- **Announced?** No. Amd 9 claims the estimate is never below 0.66× the truth.
- **Novelty:** new. The fix for Y1-P2-1 (#1684) is incomplete: its estimate does not hold beyond the cameras it was tuned on.
- **Fix direction:**
  - Make the term alternatives real. Use `fitCameraModel` with the fixed term count, not `fitDeterminedLens`, and keep the fits that pass a sanity bound (no fold in the picture, rms within about 1.2× the saved one). A plain two-term fit is exactly the alternative that disagrees with the saved model where the truth does.
  - Add a family alternative, for example a Brown-style radial fit in the normalised plane, so a bias that every Kannala-Brandt low-order fit shares shows up.
  - Floor the estimate at a model-independent value that grows with the angle past the rings. Report it as a bound, not a spread.
  - Test against cameras the factor was not tuned on: 4:3 frames, a roll, and noise σ 6 / 12, with a property test that `estimate ≥ 0.66 × truth` wherever truth > 1.5 mm.

### K1-P1-2 — Fix a small offset turns a tipped camera into a pure slide: after the Fix the target is still up to 2.7 mm off and the bed 6.8 mm, the grade stays "Accurate enough", and the moved warning is cleared. A rolled camera is told "Nothing to fix"

- **Where:**
  - `src/core/camera/model/nudge.ts:34-58,65-67`: one ring at the bed centre, translation only.
  - `src/ui/camera/calibrate/NudgeSteps.tsx:179-199`: the offer, "Fix moves the camera picture N mm so the ring shows where it burned"; up to `NUDGE_LIMIT_MM` = 10.
  - `src/ui/camera/calibrate/nudge-actions.ts:158,175-176`: after the Fix, `saveViewReference(nudged, …)` and `markCameraSteady()`.
  - The record's `accuracy` is kept, so `calibrationGrade` still reads the pre-move ring figures.
  - `NudgeSteps.tsx:235-241`: "The picture already lines up with the ring … Nothing to fix."
  - The entry from Camera settings, "Fix a small offset…" (`CalibrateCameraControls.tsx:58-64`), has no turned-camera guard. The moved notice hides it when it detects a turn (`CameraMovedNotice.tsx:24,40-49`).
- **Anchor:** ADR-663 Amd 2 Consequences (`:45`): "A camera that tilted or turned is lined up at the middle of the bed only. **The fix says so**, the 10 mm limit sends large moves to a new calibration". The Fix screen does not say so (READ `NudgeSteps.tsx:196-199`).
- **Evidence:** REPRO (`k3-nudge-drift.out.jsonl`, real `detectRingMarks` + `measureNudge` + `nudgedCameraModel` on a rendered single ring, truth error over the bed), READ.
  - Pitch 1°: offset 8.68 mm → Fix. Afterwards: target mean 1.13 / max 2.69 mm; bed p95 4.95 / max 6.77 mm (7.02 at 20 mm). The grade is "Accurate enough for placing artwork by eye."
  - Pitch 0.5°: 4.37 mm → Fix → target max 1.38, bed max 4.12.
  - Roll 0.5° / 1°: the centre ring moves 0.06 / 0.05 mm → "Nothing to fix". The target stays 1.79 / 3.43 mm off and the bed 3.88 / 5.67.
  - Pure slides are fixed exactly (back to the base 0.16–0.19 mm on target), as the ADR says.
- **Scenario:**
  1. The lid is closed hard and the camera tips about 1°.
  2. The operator, or the settings-row button the panel recommends ("run … Fix a small offset once"), burns the nudge ring. "The picture is 8.7 mm off" → **Fix**.
  3. The toast says "Camera picture moved 8.7 mm. Undo puts it back."
  4. The moved-check reference is renewed, so the camera now counts as steady.
  5. The settings row still says "Accurate enough for placing artwork by eye."
  6. Artwork placed on the target area burns up to 2.7 mm off, and near the bed edges up to 6.8 mm off.
- **Severity: P1.** The app's own fix leaves a silent position error larger than any figure it shows. It also silences the one detector (the moved check) that had seen it. The ADR's promised caveat is missing.
- **Announced?** In the ADR, yes; in the UI, no.
- **Novelty:** new. G6-P3-2 (Undo keeps the post-nudge reference) is related but different.
- **Fix direction:**
  - Burn three or more rings (centre plus two far rings), refit the pose with the saved lens fixed (`fitCameraModel` with `fixedLens`, the KNOWN unreachable #1546 item 2 path), and only call it a slide when the far rings agree.
  - Or, after a Fix, keep the moved warning unless the moved check classified the move as a pure slide. Say "lined up at the middle of the bed only" on the Fix screen, as the ADR states.
  - Never answer "Nothing to fix" without a far ring.

### K1-P2-1 — A full-bed calibration sheet now grades "fair: elsewhere on the bed up to about 1.8–5.3 mm off" and advises a larger sheet; the truth is 0.30–0.50 mm

- **Where:**
  - `extrapolation-estimate.ts:111-124`: the worst point outside the target. On a full-bed sheet that is only the 5 mm margin and ring clearance at the bed's corners.
  - `:208-209`: four-term alternatives from 60 rings, refitted through `fitDeterminedLens`.
  - `calibration-result.ts:173-185`: the "Engrave the target on a larger sheet" advice.
- **Anchor:** ADR-441 Amd 9 Consequences (`:81`): "A whole-bed sheet keeps 'Accurate enough'". Its Verification says "a whole-bed sheet stays under the limit". Measured.
- **Evidence:** REPRO `k7-fullbed.out.jsonl`. A centred camera and cameras 50 and 100 mm off-centre, on a 400 × 400 sheet (100/100 rings):
  - the reported figures are 0.08–0.09 / 0.21–0.24 mm;
  - the grade is **fair**: "elsewhere on the bed up to about 1.8 / 2.8 / 5.3 mm off near the top-left corner of the bed. Engrave the target on a larger sheet…";
  - the true worst over the whole bed is 0.36 / 0.30 / 0.50 mm.
- **Scenario:** an operator follows the advice the app gave in K1-P1-1-style cases and engraves a bed-size sheet. The app still says fair, still says up to 5.3 mm, and asks for a larger sheet than the bed. Job Review then warns on corner jobs that are within 0.5 mm.
- **Severity: P2.** A false warning with an impossible remedy. It costs time and teaches operators to ignore the warning that K1-P1-1 needs them to trust. No mis-burn.
- **Announced?** No. **Novelty:** new.
- **Fix direction:** ignore grid points within a ring clearance of the target area, or of the bed edge when the target spans the bed. Never advise a larger sheet when the sheet already covers the bed. Add a Brown-truth full-bed case to the estimate tests (the test fixture has none at 4:3).

### K1-P2-2 — A calibration "lined up at the height of the target sheet only" is used silently at any Material height: 7.7 mm off at 20 mm and 16.9 mm at 40 mm, with no notice at the Material height control or in Job Review

- **Where:**
  - `onlyAtTargetHeight` is read only by `calibration-result.ts:119` (grade) and `CalibrationResultStep.tsx:51`; grep over `src/ui` finds no other reader.
  - `OverlayControls.tsx:115,174-190` (Material height) and `camera-off-target-warning.ts` (Job Review, off-target only) do not read it.
- **Anchor:** twin of ADR-441 Amd 9 Decision 4, which put the off-target estimate into Job Review because "nothing after the wizard read the accuracy". The height caveat from Amd 7 got no such reader. Measured.
- **Evidence:** REPRO B1 (`k1-matrix-b`): a phone straight down 560 mm up.
  - The fit gives a height of 4,520 ± 27,421 mm, graded "fair: Lined up at the height of the 3 mm target sheet only."
  - True error: sheet 0.24 mm, bed 1.60 mm, 20 mm material 7.66 mm, 40 mm material 16.92 mm. Every point at 20 mm is over 1.5 mm and unwarned (6170/6170).
  - The straight-down head camera (`k4`, fitted height 56.8 against a true 70 mm, ± 23.9) gives 1.44 mm with seams of 1.72 mm at 12 mm material.
- **Scenario:**
  1. The wizard's result said to type a tape height. The operator saved anyway, since Save is always offered.
  2. Weeks later they set Material height 20 for a block of wood.
  3. The overlay redraws, and nothing says the calibration cannot place at that height.
  4. The burn is 7.7 mm off.
- **Severity: P2.** The harm is real, but the condition is announced at calibration and stays in the Camera settings row ("Lined up at the height of the 3 mm target sheet only."). The gap is that the notice is not shown where and when the height actually changes.
- **Announced?** At calibration and in the settings row, yes; at use, no.
- **Novelty:** new (Y1 verified the grade, not the later use).
- **Fix direction:** when `onlyAtTargetHeight` is set and the Material height (or any height area) differs from `targetHeightMm` by more than about 1 mm, show a note under Material height. Add a Job Review line for camera-placed jobs, as `cameraOffTargetWarning` does.

### K1-P3-1 — A head camera's accuracy figures are measured on 20 tiny rings in the picture's middle and read "0.00 / 0.01 mm", while its stitched picture is up to 0.83 mm off at the tile edges and tiles disagree by up to 1.1 mm

- **Where:** `CalibrationResultStep.tsx:155-156` shows the in-sample figures. A head camera gets no off-target estimate (`extrapolation-estimate.ts:61`, `calibration-result.ts:196-198`), only the "About 80 % of the picture lies outside the target" sentence.
- **Evidence:** REPRO `k4` (8° tilt, Brown k1 −0.30).
  - Reported 0.004 / 0.008 mm, graded good.
  - True tile error p95 0.37 / max 0.83 mm. Seam disagreement p95 0.54 / max 0.94 mm, and 1.12 mm at 6 mm material.
- **Severity: P3.** The true error stays under the 1.5 mm that "good" stands for, so no burn is misplaced beyond the grade's meaning. The figures overstate precision by about 100×.
- **Novelty:** new. **Fix direction:** show the head camera's figures with "measured on the target only", or estimate the used 80 % of the picture as Amd 9 does for fixed cameras.

## KNOWN status (on `ba08a81af`)

| ID | Was | Status here | Evidence |
|---|---|---|---|
| Y1-P2-1 (P1) | Default sheet graded good while the far bed is mm off | **Fixed by #1684 (ADR-441 Amd 9) for the cameras it was tuned on; still reachable**, see K1-P1-1 | off-centre cameras now grade fair with the right figure (A4, A5, B6, C1); centred ordinary webcams still grade good at 2.7–4.5 mm |
| Y1-P1-1 (P1) | Same-aspect sensor crop used as a resize | Fixed by #1681 (ADR-440 Amd 9); not re-run here (K2's overlay area) | READ `saved-calibration-check.ts:36-41` uses `rescale: 'measuring'` |
| Y1-P2-2 / Y1-P3-2 (P1 / P3) | Moved check misses turns and knocks | Fixed by #1680 (ADR-663 Amd 5); the image check is K2's area. The ring-based Check camera flagged all eight moves here | `k3` |
| Y1-P3-1, Y1-P3-6 | Settings row and margin advice | Fixed with #1684 | READ `calibration-result.ts:153-185` |
| Y1-P3-3 | Soft photo fails as "discs not found … nothing covers them" | **Open, reproduces:** blur σ 1.0 and 1.4 px → `anchors-not-found` | D3, D4 |
| Y1-P3-4, Y1-P3-5 | Covered edge columns graded "other settings"; stale lesson | Not re-run | — |
| Y1 refuter (folded into Y1-P2-1) | On target, between rings, an off-centre camera is 0.66–1.15 mm off against a worst ring of 0.13–0.26 | **Still true, smaller here:** A5 on target 0.57 against worst ring 0.14; B6 0.84 against 0.36; equidistant 16 mm rings 0.54 against 0.20. Amd 9 left it unchanged by design (Consequences) | `k1-matrix`, `k5` |
| #1546 item 1 | Legacy `CameraProfile` / `camera-transform.ts` | Open: still present; only `camera-profile.ts` and the profile normalisers use it | READ |
| #1546 item 2 | `fixedLens` path unreachable | Open: `photographTarget` passes no `lens` (`calibration-actions.ts:217-226`). It is the natural tool for K1-P1-2's fix | READ |
| #1546 item 3 | Accuracy reported in-sample | Open by design; the ring figures are honest on target, the extrapolation is K1-P1-1 | measured |
| #1546 item 6 | `MIN_POINTS_PER_VIEW` (6) against up to 14 free parameters | Open, latent: real calls need ≥ 8 matched rings (`target-match.ts:47`) | READ |
| W4, Y4, Z1 items | USB mute, auto-start, job-watch threading, overlay decode | Outside K1 (K2/K4) | — |
| July 2026 roadmap / rotary sector acceptance | research and rotary registration | Not in K1 scope; no item re-checked | — |

## Verified clean

- **On-target honesty.** In the 30 calibrated fixed-camera cases without a deliberately bad ring, the true worst on target was ≤ 0.57 mm (B6, a strong tangential lens graded fair: 0.84 mm against a 0.36 mm worst ring), and the reported worst ring was within 0.4 mm of it. With a mis-engraved ring (X1) the worst ring (0.68 mm) exceeded the true on-target worst (0.51).
- **Lens families.** Division, equisolid and stereographic fisheye and equidistant lenses are recovered well on target (0.10–0.54 mm). Over-wide lenses are refused with the right advice: `lens-folds` on the 60 mm-high equisolid head camera; `anchors-unclear` / `rings-too-small` style refusals where the rings shrink below about 9 px.
- **Heights when the height is pinned.** Camera height recovered within 0.1–8.5 mm (σ 2.6–9). From the sheet to 40 mm material the error grew by at most +0.5 mm (A1 3.17 → 3.64; B5 0.36 → 0.42). A loose height (σ > 10) is flagged `onlyAtTargetHeight` in every case where it occurred (B1, B3, B4, F, the straight-down head camera).
- **Outliers.**
  - Gross label swaps and rings ≥ 4 px off are dropped and do not move the fit (`k5`).
  - Image-level rings engraved 2.5 and 6 mm off are rejected and shown hollow (X2–X4).
  - Systematic offsets under the floor are visible in the figures (X1 0.68 mm worst ring; X5 "Good for rough placement" and an estimate of 10.6 mm).
- **Noise, JPEG q40–q75, dim light, a laser head or clamp over part of the target:** on-target accuracy unchanged (0.10–0.32 mm). Covering half the target refuses.
- **Check camera.** `modelDriftOnMarks` with the verdict rule `max(0.3, 1.5 × rms)` reported every move tried as moved: slides 2–3 mm, lid 3 mm lower, pitch 0.5–1°, roll 0.5–1°, yaw 0.8°. The rms was 0.9–8.8 mm. The mean shift matched the slide direction.
- **Nudge on a pure slide:** exact (0.16–0.19 mm on target afterwards). The offset sign and size match the slide (1.95 / 2.96 against 2 / 3 mm).
- **Saved calibration round trip:** `JSON` → `normalizeCameraModelRecord` keeps the lens, pose and 35 marks bit-exact. `pixelToBed` differs by 0 mm; grade and estimate are identical (`k5`). Units are millimetres throughout (`camera-model.ts:6-11`). The marks are saved to the micrometre (`camera-model-accuracy.ts:51-73`).
- **Height areas** (READ `height-areas.ts`): the highest area wins and a lower area still wins inside itself. The model handles any surface height exactly (measured above).
- **Head camera at the target height:** straight-down tile error ≤ 0.07 mm, seams ≤ 0.07 mm. `modelAtHead` translates the pose and the rings consistently (READ `head-camera.ts:28-41,47-58`).

## Not verified

- The GPU overlay shader, the image-based camera-moved check (view shift / view motion) and frame-size handling: K2's area. Only the model the shader mirrors was used.
- Real lenses, autofocus breathing, rolling shutter, a warped or not-flat sheet, and an uneven bed.
- 1280 × 720 at the 420 mm geometry refused (`anchors-unclear`), so most cases are 4:3. One 720p case (C5) shows the same under-read (3.06 mm true against an estimate of 1.96, 49 points unwarned).
- The nudge after a move that the image moved-check classifies as turned (K2). The settings-row entry has no such guard either way.
- Vitest was not run (free memory 0.9–2.2 GB).
- The phone and bridge sources, and machine-JPEG cameras.

## Repro files

All in scratchpad `zz-k1\`. Run from that folder with `node --max-old-space-size=380 --no-experimental-webstorage --import ./register.mjs <script>.mts [group]`. The loader is a copy pointed at `j42-main` (esbuild from `j34-main`).

- `truth.mts`: own truth cameras (Brown / fisheye / division), pose and moves, ray caster, blur, noise, JPEG-like quantisation.
- `harness.mts`: the real chain, the true-error grid and the "unwarned" count. `png.mts` is a debug PNG writer; `sum.mjs` summarises the `.jsonl` files.
- `k0-selftest.mts` → `k0-selftest.out.jsonl`: round trip, and a Kannala-Brandt-exact equidistant camera (0.73 mm worst, estimate 0.84).
- `k0-geom.mts`, `k0-debug.mts`, `k0-debug.png`: geometry probe (720p refusals).
- `k1-matrix.mts` → `k1-matrix-{a,b,c}.out.jsonl`: lens families and mounts.
- `k2-degrade.mts` → `k2-degrade-{a,b}.out.jsonl`: noise, blur, JPEG, dim, occluders, mis-engraved rings.
- `k3-nudge-drift.mts` → `k3-nudge-drift.out.jsonl`: Check camera and nudge.
- `k4-head.mts` → `k4-head.out.jsonl`: head camera and stitch.
- `k5-saved-outliers.mts` → `k5-saved-outliers.out.jsonl`: round trip, label outliers, extreme fisheye.
- `k6-why.mts` → `k6-why.out.jsonl`: K1-P1-1 root cause.
- `k7-fullbed.mts` → `k7-fullbed.out.jsonl`: K1-P2-1 wording.

```json
[
  {"id":"K1-P1-1","severity":"P1","area":"calibration-and-model","file":"src/core/camera/model/extrapolation-estimate.ts","line":218,"anchor":"ADR-441 Amd 9 D1/D2 (estimate 0.66-2.1x truth; good = estimate <= 1.5 mm); measured vs independent truth","evidence":"REPRO+READ","known":false,"summary":"Term-count alternatives go through fitDeterminedLens and collapse to the saved 1-term fit; half-ring spread measures noise. 7 good-graded calibrations (centred Brown webcams, roll, 300x300 sheet, covered/mis-engraved rings) estimate 1.14-1.45 mm vs true 2.75-4.50 mm (5.13 at 40 mm); every point >1.5 mm unwarned by grade, tint and Job Review"},
  {"id":"K1-P1-2","severity":"P1","area":"calibration-and-model","file":"src/ui/camera/calibrate/nudge-actions.ts","line":175,"anchor":"ADR-663 Amd 2 Consequences 'lined up at the middle only. The fix says so'","evidence":"REPRO+READ","known":false,"summary":"1 deg pitch: nudge 8.7 mm < 10 mm limit -> Fix; after it target max 2.69, bed max 6.77 mm, grade 'Accurate enough', moved reference renewed and camera marked steady; Fix text omits the caveat. 0.5-1 deg roll -> 'Nothing to fix' with bed 3.9-5.7 mm off"},
  {"id":"K1-P2-1","severity":"P2","area":"calibration-and-model","file":"src/core/camera/model/extrapolation-estimate.ts","line":122,"anchor":"ADR-441 Amd 9 Consequences 'A whole-bed sheet keeps Accurate enough'","evidence":"REPRO","known":false,"summary":"400x400 sheet, 100/100 rings: graded fair 'up to about 1.8/2.8/5.3 mm off' + 'engrave on a larger sheet'; true whole-bed worst 0.36/0.30/0.50 mm"},
  {"id":"K1-P2-2","severity":"P2","area":"calibration-and-model","file":"src/ui/camera/OverlayControls.tsx","line":115,"anchor":"twin of ADR-441 Amd 9 D4 (Job Review reads the accuracy); Amd 7 height caveat","evidence":"REPRO+READ","known":false,"summary":"onlyAtTargetHeight read only by the wizard grade; Material height 20/40 mm on a straight-down calibration: 7.66/16.92 mm off with no notice at the control or in Job Review"},
  {"id":"K1-P3-1","severity":"P3","area":"calibration-and-model","file":"src/ui/camera/calibrate/CalibrationResultStep.tsx","line":155,"anchor":"ADR-441 Amd 4 D4 (grade says what it measured)","evidence":"REPRO","known":false,"summary":"Head camera reports 0.004/0.008 mm (in-sample, 20 rings) while the stitched picture is up to 0.83 mm off and tiles disagree by up to 1.1 mm; no head estimate"}
]
```

## Counts

Raised 5 → P1 2 / P2 2 / P3 1 (+ KNOWN: Y1-P2-1 reopened in part as K1-P1-1; Y1-P3-3 still reproduces; #1546 items 1, 2, 3, 6 open; Y1-P1-1, Y1-P2-2, Y1-P3-1, Y1-P3-2, Y1-P3-6 fixed or outside K1 — 10 known items listed).

## Refuter (2026-11-14)

**Tree and harness.** Same read-only export `j42-main` (`origin/main` @ `ba08a81af`). A read-only `gh api …/commits?path=` over `src/core/camera`, `src/ui/camera` and `src/ui/laser/camera-off-target-warning.ts` lists nothing after 2026-11-12 (#1748, #1767; Amd 9 is `84d3db276`), so every result below stands on current main.

My files are in `zz-k1r\`. I read `truth.mts` and `harness.mts` for API shape only; nothing imports a `zz-k1` file.
- **Own truth (`rt.mts`).** Lenses in OpenCV order: pinhole + Brown (k1, k2, p1, p2, k3) with fy ≠ fx and an off-centre principal point, and the OpenCV fisheye (equidistant θ_d = θ(1 + k1θ² + …)). The pose is a camera centre plus yaw / pitch / roll Euler angles, not a look-at, and moves are rotations about the camera's own axes.
- **Own renderer.** Rays are solved at pixel *corners* (OpenCV fixed-point undistortion plus a finite-difference polish, round trip ≤ 2e-11 px, `r0-self.mts`) and interpolated bilinearly. Each pixel is a 4 × 4 box sample, then a [1 2 1] separable blur (σ ≈ 0.7 px), a 9 % vignette, Gaussian noise σ 2 from xorshift, and 8-bit rounding. The scene is a 205-grey sheet with 62-grey rings, a dark bed with a 25 mm grid, and a machine frame. There are no occluders.
- **Own bed-error measure: forward only.** The truth camera projects bed point P at height h to a pixel. The app's `pixelToBed` maps that pixel back at h to Q, and the error is |Q − P|: the overlay draws the feature at P at Q, and artwork placed on it burns at Q. The measure never inverts the truth lens.
- **Real chain.** `calibrationTargetArea` → `bedTargetLayoutWithRings` → `calibrateFromBedTarget` → `cameraModelFromCalibration` → `calibrationGrade`, `extrapolationEstimate`, and the real **`cameraOffTargetWarning`** (Job Review), with a 60 mm coaster in each bed corner, placement on, Start from Absolute.
  - Nudge: real `detectRingMarks` on a rendered single ring, then `measureNudge` → `nudgedCameraModel`.
  - Check camera: real `calibrateFromBedTarget` on the moved camera's photo of the old target → `checkSavedCalibration` → `savedCalibrationVerdict`.
- **Runs.** Node ≤ 380 MB, one at a time; no Vitest, browser, camera, network or hardware.
  - Scripts that import `calibration-result.ts` keep the event loop alive. My first five runs did not exit after printing, so I stopped those five processes (my own, identified by command line) and added `process.exit(0)`.

### Verdicts

| Finding | Verdict | Severity | Evidence (own) |
|---|---|---|---|
| K1-P1-1 | **CONFIRMED.** Root cause confirmed, with one correction to its mechanism. Widened: even when the grade is *fair*, the estimate puts its maximum in the wrong corner, and Job Review stays silent on the truly worst corner. The "tracks the noise" detail did not reproduce monotonically. The suggested fix needs a guard: a plain two-term fit is not closer to the truth in general | **P1** | `r1-matrix` (a/b1/b2/c), `r2-why` |
| K1-P1-2 | **CONFIRMED** on another lens, mount and set of moves. One nuance: "Nothing to fix" does not renew the moved reference; only Fix does | **P1** | `r3-nudge` |
| K1-P2-1 | **CONFIRMED IN PART.** The centred full-bed case stays *good* here (estimate 1.39 against a true 0.24). The 80 mm off-centre case reproduces (fair "1.6 mm" against 0.30). Widened: a straight-down camera with a typed tape height grades fair "up to about 6 mm" against a true 0.80 mm (7.4×) | P2 | `r5-fullbed-height` a/b |
| K1-P2-2 | **CONFIRMED** in mechanism (READ and REPRO). The size depends on how far the loose height lands: 1.1–5.5 mm here at 20–40 mm, against the auditor's 7.7–16.9 | P2 | `r5-fullbed-height` b, `r1-a` R2 |
| K1-P3-1 | **CONFIRMED, and larger.** With my head-camera truth, the middle 80 % of the picture (the share the stitch uses) is up to **3.84 mm** off (p95 1.84) under "good" and "0.00 / 0.01 mm". This is per tile, not through the blended stitch | **P2** (raised; P1 if the real stitch reproduces > 1.5 mm) | `r7-head` |

**K1-P1-1: CONFIRMED, P1.**

All cases are 1280 × 960 with the default 300 × 200 sheet and 10 mm rings, at sheet height (3 mm). "Silent" is the Job Review result for a 60 mm coaster in the corner where the truth is worst.

| Case | Grade | Estimate (where) | True worst (where) | At 40 mm | Points > 1.5 mm unwarned | Job Review there |
|---|---|---|---|---|---|---|
| R3 strong Brown (k1 −0.34, k2 0.12, k3 −0.018), back rail 400 up | **good** | 1.29 (0, 400) | **2.84** (400, 0) | 3.36 | **64/64** | silent |
| R11 R3 lens, 300 × 300 sheet (44/49 rings) | **good** | 1.25 | **2.68** (400, 0) | 3.18 | **51/51** | silent |
| R12 R3 lens, front rail (camera at y = 430) | **good** | 1.25 (400, 0) | **2.84** (0, 400) | 3.37 | **64/64** | silent |
| R1 standard Brown (k1 −0.27), back rail 410 up | fair "2.2 mm" | 2.21 (0, 400) | 2.21 (400, 0) | 2.70 | 21/27 | **silent** |
| R7 R1 with a 3° roll | fair "2 mm" | 2.03 (0, 400) | 2.80 (400, 0) | 3.31 | **78/78** | **silent** |
| R8 R1 with noise σ 8 | fair "1.5 mm" | 1.52 (0, 400) | 2.55 (400, 0) | 3.06 | **51/51** | **silent** |
| Control: R4 mild (k1 −0.15) | fair "1.7 mm" | 1.74 | 0.48 | 0.60 | 0/0 | over-read (safe) |
| Control: R6 16:9 f640, 90 mm behind (the repo fixture's geometry), no blur | fair "2 mm" | 2.00 | 1.72 | 1.77 | **0/6** | warns |
| Control: R6c 16:9 f900, 480 up | fair "2 mm" | 2.01 | 0.51 | 0.66 | 0/0 | over-read |

- **It reproduces with an independent truth.** Three good-graded calibrations reach 2.68–2.84 mm, or 3.2–3.4 mm at 40 mm, with every point over 1.5 mm unwarned. The estimate is 0.44–0.47× the truth, below Amd 9's 0.66× floor. My magnitudes (2.7–2.8) are smaller than the auditor's 2.75–4.50.
- **Widening: the estimate's map is wrong, not only its size.** At the four corners (top-left, top-right, bottom-left, bottom-right), R3's estimate is 1.06 / 1.04 / 1.29 / 1.09 mm, against a truth of 2.23 / 2.84 / 0.33 / 0.18. It is highest where the truth is lowest.
  - The truth peaks at the bed corners nearest the camera. They lie at the largest image radius: ≈ 490 px, against ≈ 345 px for the far corners.
  - So R1, R7 and R8 grade *fair*, yet the Job Review warning on the worst corner is silent (R7: 78 of 78 points unwarned at up to 2.8 mm). The auditor's "names the wrong corner" (D5) is general, not incidental.
- **Root cause (`r2-why`).** Confirmed, with a correction to how it happens.
  - With 35 rings, the **saved** fit has one term by policy (`bed-calibration.ts:90-98`, `TWO_TERM_MIN_MARKS = 40`), not by significance.
  - `fitDeterminedLens(…, 2)` returns exactly that one-term fit. For R1 and R3 that is because k2 is under 2σ (−0.146 ± 0.10 and −0.107 ± 0.098). For R3t (the same lens without tangential terms) the two-term fit **folds inside the picture** (k2 −0.41), so `fitDeterminedLens:49` skips it.
  - Either way, the term alternative equals the saved model. Only the half-ring refits are left.
- **Corrections to details.**
  - *"The estimate tracks the photo's noise":* not monotonic here. Noise σ 2 → 8 moved the estimate **down**, 2.21 → 1.52 mm, while the truth rose 2.21 → 2.55. The half-fit spread is not related to the lens bias in either direction. That supports the finding's conclusion but not its wording.
  - *"A plain two-term fit would be 0.83 mm at the corner against 3.17":* not general. A plain two-term fit gives R3 1.77 (better than 2.84) but R1 **3.29 (worse than 2.21)**, and R3t **16.55 mm** (it folds). This is exactly Amd 8's reason for one term at fewer than 40 rings.
  - So the fix direction "use `fitCameraModel` with the fixed term count" must keep the fold rejection and use the two-term fit only as a *disagreement* signal. Even then it is not shown to bound the truth. A model-independent floor, or a non-KB family alternative, is the safer half of the fix.
- **Test gap: confirmed (READ).** `extrapolation-estimate.test.ts:18-50` checks four 1280 × 720 `brownWebcam` cameras, all expected over 1.5 mm. My 16:9 control (R6) is the one geometry where the estimate tracks.
- **Severity: P1 stands.** It is a silent position error of 2.7–3.4 mm under "Accurate enough for placing artwork by eye", with Job Review silent at the very place it is worst. That is the same harm as Y1-P2-1, which was rated P1. A visible misfit on the picture is not a warning (METHOD §3).

**K1-P1-2: CONFIRMED, P1.**

The base is my R3 camera: good, rms 0.054, worst 2.81 mm. The nudge ring is 10 mm on an 80 × 80 scrap at the bed centre, 3 mm high.

| Move | Check camera (real verdict) | Old model: target max / bed max | Nudge | After the nudge: target mean / max | Bed max (20 mm) | Points > 1.5 unwarned | Grade after |
|---|---|---|---|---|---|---|---|
| slide 2.5 mm | moved, 2.50 rms | 2.67 / 4.84 | Fix 2.46 | 0.06 / 0.25 | 2.72 (2.94) | 57 (base 63) | good |
| lid 3 mm lower | moved, 1.90 | 2.99 / 4.00 | Fix 1.76 | 0.76 / **1.58** | 2.50 (2.60) | 1515 | good |
| pitch 0.5° | moved, 4.74 | 5.71 / 7.48 | Fix 4.62 | 0.63 / 1.33 | **3.94** (4.28) | 1836 | good |
| pitch 1.0° | moved, 9.41 | 11.56 / 15.17 | **Fix 9.21** | 1.27 / **2.89** | **6.54** (6.71) | **4876** | **good** |
| pitch −0.8° | moved, 7.67 | 9.91 / 13.19 | Fix 7.42 | 1.14 / **2.97** | **6.26** (6.31) | 3346 | good |
| yaw 0.7° | moved, 5.78 | 6.88 / 7.91 | Fix 5.60 | 0.39 / 1.36 | 2.85 (3.00) | 725 | good |
| roll 0.5° | moved, 0.91 | 1.85 / 3.53 | **"Nothing to fix" (0.01)** | (unchanged) 1.85 | 3.53 | — | good |
| roll 1.0° | moved, 1.84 | 3.55 / 5.62 | **"Nothing to fix" (0.01)** | (unchanged) 3.55 | 5.62 | — | good |

- This reproduces the auditor's figures on another lens and mount: pitch 1° → Fix 9.2 mm, target up to 2.9 mm, bed 6.5 mm, grade good.
- READ confirms the rest:
  - `nudge-actions.ts:158-177`: after **Fix**, `saveViewReference(nudged, …)` and `markCameraSteady()` run unconditionally;
  - `NudgeSteps.tsx:196-199` has no "middle of the bed only" text, against ADR-663 Amd 2 `:45` "The fix says so";
  - `CalibrateCameraControls.tsx:58-64` offers Fix from settings with no turn guard.
- **Aggravating (READ).** The image moved check already classifies a turn (`camera-moved-store.ts:104-121`, `cameraMovedTurned`), and its Job Review line says "the camera turned, which Fix a small offset cannot put right". If the operator then uses the settings-row Fix anyway, that Job Review line disappears and nothing replaces it.
- **Nuance.** `NothingToFix` only closes the wizard (`NudgeSteps.tsx:235-251`). It does not renew the reference, so an existing moved warning survives a roll. Its harm is the false "already lines up" message, not a silenced guard.
- **Mitigation that holds.** Check camera still flags every one of these moves afterwards (rms 0.91–9.41 mm, all "moved"). But the operator has just been told the camera is fixed.
- **Severity: P1 stands.** The app's own Fix removes an existing turned-camera warning and leaves a silent 2.9 mm (target) to 6.5 mm (bed) error under "Accurate enough". The disclosure the ADR promised is missing.
  - Against: the Fix improves every case on its old model (15 → 6.5 mm). Without a view reference there was no warning to remove.
  - I would keep P1 because of the removed guard. Without that part, P2.

**K1-P2-1: CONFIRMED IN PART, P2.**

All cases are a 400 × 400 sheet with 100 rings, and need `blur: false` in my renderer (see K1r-P3-1).

| Case | Grade | Estimate | True worst (bed) |
|---|---|---|---|
| FB1 R1 lens, centred, back rail | **good** | 1.39 | 0.24 |
| FB2 R3 strong lens | fair "1.9 mm" | 1.93 | 1.24 (on target 1.01, against a worst ring of 0.52) |
| FB3 R1 lens, 80 mm off-centre | **fair "1.6 mm"** + larger-sheet advice | 1.59 | **0.30** |
| FB4 R1 lens, blurred, 16 mm rings (36/36) | fair "2 mm" | 2.00 | 1.35 |
| SD2 straight down, 560 up, tape height typed 565 (default sheet) | **fair "up to about 6 mm"** + "Engrave … larger sheet"; Job Review warns 5.0–6.0 mm at every corner | 5.95 | **0.80** |

- **Centred case:** not reproduced. Amd 9's whole-bed promise holds for my centred camera, though at 5.8× the truth.
- **Off-centre case:** reproduces (5.3×).
- **FB2:** the fair grade is defensible, since the target itself is 1.0 mm off.
- **Widening (SD2):** the most accurate mount, straight down with the height typed as the wizard asks, gets a 7.4× false alarm, past Amd 9's 2.1× ceiling. Every corner job then warns about 5–6 mm.
- **Severity: P2.** These are false warnings with an impossible or pointless remedy and no mis-burn. They teach operators to ignore the warning that K1-P1-1 needs them to trust.

**K1-P2-2: CONFIRMED, P2.**
- **READ.** `onlyAtTargetHeight` is read only by `calibration-result.ts:119` and `CalibrationResultStep.tsx:51`. `SurfaceHeightControl` (`OverlayControls.tsx:174-200`) and `cameraOffTargetWarning` do not read it.
- **REPRO** (sheet → 20 / 40 mm material):

  | Case | Fitted height | Error at 20 / 40 mm | Points > 1.5 unwarned |
  |---|---|---|---|
  | SD1 straight down, 560 up | 577.6 ± 1,767 | 1.08 / 1.65 | — |
  | SD3 5° tilt, true ≈ 497 up | 389 ± 182 | **2.17 / 5.54** | 3,504 / 6,007 of ~6,500 |
  | R2 13° tilt, 450 up | 439.5 ± 16 | 2.51 / 3.28 | 70 / 242 |

- The size is set by where the loose height lands. The auditor's 4,520 mm draw is at the far end; SD1's lucky 578 mm is at the near end.
- **P2 stands.** The caveat is announced in the wizard and kept in the settings row, but not where the height changes.

**K1-P3-1: CONFIRMED, raised to P2.**
- `r7-head`: Brown k1 −0.30, k2 0.09, k3 −0.01 with tangential terms, 8.5° tilt, 67 mm above the 3 mm sheet, on the default 40 mm head target (20 rings of 2.35 mm).
- The wizard shows 0.0042 / 0.0075 mm, **good**, and "About 85 % of the picture lies outside the target … elsewhere the picture is estimated".
- The truth:
  - on target ≤ 0.02 mm;
  - the middle 60 % of the picture ≤ 0.62 mm;
  - **the middle 80 %, `HEAD_CAMERA_USABLE_FRACTION`, the band the stitch uses: p95 1.84, max 3.84 mm;**
  - the whole frame: max 4.75 mm.
- This is per tile. I did not run `stitchHeadCameraPictures`, whose feathering weights the tile edges down. Whether the live head-camera overlay draws the whole frame (`active-camera-model.ts:57-64` places the full model) is K2's area.
- **Why P2.** On my truth the used band exceeds the 1.5 mm that "good" stands for, so the auditor's "under the grade's meaning" premise does not hold in general. It is the head-camera twin of Y1-P2-1: a caveat with no figure.
  - Amd 9 deliberately left head cameras out ("keeps Amendment 4's advice"), so it is announced in the ADR.
  - P1 if the real stitch reproduces more than 1.5 mm.

### Challenges to "Verified clean"

- **On-target honesty: holds, with one exception.** In the part-sheet cases, the true on-target worst was 0.09–0.34 mm against a worst ring of 0.08–0.14. The exception is FB2 (a strong lens on a full-bed sheet): 1.01 mm against a worst ring of 0.52, a 0.49 mm gap, just over the auditor's "within 0.4". It is graded fair.
- **Check camera flags every move: holds** (`r3-nudge`). Eight moves of mine, including slide, lid, pitch ±, roll 0.5 and 1 and yaw, gave rms 0.91–9.41 mm, all "moved".
- **Saved round trip: holds** (`r8-roundtrip`). After JSON → `normalizeCameraModelRecord`, `pixelToBed` differs by 0 mm at 0, 3 and 40 mm. The 35 marks are identical, and the grade and estimate are identical.
- **Height pinned: holds.** From the sheet to 40 mm the error grew by +0.49 (R1), +0.50 (SD2) and +0.52 mm (R3).
- **Refusals: hold, as refusals.**
  - Soft 16:9 (R6) → `anchors-not-found`, blaming covers (KNOWN Y1-P3-3 message, re-observed).
  - A 45° corner mount (R9) → `anchors-not-found`.
  - The in-family KB fisheye (R5, f520–620) → `anchors-unclear`, from filled holes.
  - Nothing was misfitted.
- **Bad and mis-engraved rings dropped: not re-run.**

### New findings

**K1r-P3-1: The full-bed sheet that the grade and Job Review advise ("Engrave the target on a larger sheet") is refused `anchors-unclear` for an ordinary back-rail 4:3 webcam with mild softness. The refusal's advice never mentions Ring size, which is the setting that fixes it.**
- **Where:**
  - `target-match.ts:100-106` (`discsOffAnchorCells` → `anchors-unclear`);
  - `calibration-result.ts:253-254` (the message);
  - `calibration-result.ts:173-185` (the larger-sheet advice).
- **Anchor:**
  - Twin: the `no-marks` and `rings-too-small` messages (`calibration-result.ts:249`, `ringsTooSmallMessage`) name "engrave larger rings (Engrave settings, Ring size)".
  - ADR-441 Amd 7 (ring size) and Amd 9 Decision 2 (the advice is the fix).
- **Evidence:** REPRO `r6-fbdebug`. The R1 camera, 410 mm up on the back rail, photographs a 400 × 400 sheet with 100 rings of 10 mm, with σ ≈ 0.7 px blur.
  - 95 rings were found and **7 "anchors"**: the 3 true ones (200–242 px² areas) plus 4 far-row rings at v ≈ 652 whose foreshortened holes filled (155–166 px²). The result is `anchors-unclear`.
  - The same photo without blur calibrates 100/100.
  - The same blur with 16 mm rings calibrates 36/36 (FB4).
  - The default 300 × 200 sheet with the same camera and blur calibrates (R1).
- **Scenario:**
  1. A K1-P1-1-type calibration grades fair: "… Engrave the target on a larger sheet".
  2. The operator engraves a bed-size sheet at the default ring size.
  3. It is refused: "Some rings look like solid discs … Light the bed evenly, set the camera to a larger picture size or move it closer … less power".
  4. None of that helps a fixed 1280 × 960 lid camera. The operator gives up on the sheet the app recommended, and keeps the less accurate calibration.
- **Severity: P3.** It is a safe refusal of a designed kind (Amd 6), so no mis-burn. The cost is a wasted engraving and an advice loop.
- **Announced?** Partly. The message names filled holes, but not the ring-size remedy.
- **Novelty:** new. Y1-P3-3 is the blur message for `anchors-not-found`; this is the `anchors-unclear` path, reached through the app's own larger-sheet advice.
- **Fix direction:**
  - add "or engrave larger rings (Engrave settings, Ring size)" to `anchors-unclear`;
  - when the larger-sheet advice fires, propose a ring size that keeps the far rows' holes at least about 5 px;
  - optionally, rank L candidates by disc area, since the true anchors are 25–45 % larger than the filled far rings here.

### Probes with no gap (new-gap search)

- **16:9 / 720p.**
  - The repo fixture's geometry (f640, 90 mm behind, 400 up) calibrates sharp: 35/35, and the estimate tracks (2.00 against 1.72, 0 unwarned).
  - At σ ≈ 0.7 px blur it refuses `anchors-not-found` (20/35 rings, 2 anchors), with the KNOWN Y1-P3-3 message.
  - A narrower f900 at 480 up calibrates.
  - The auditor's 720p refusal is therefore a ring-size and softness refusal, which is safe. Its message is Y1-P3-3, or K1r-P3-1 for the other reason.
- **Very tall mount** (650 up, f1000, R10): calibrates, `onlyAtTargetHeight` (σ 20). Truth ≤ 0.77 mm at the sheet and 1.14 mm at 40 mm, against an estimate of 0.43. Nothing is over 1.5 mm.
- **Off-axis mounts.**
  - The front rail (R12) mirrors the back-rail under-read (good, 2.84 mm).
  - A 45° corner mount (R9) refuses.
  - The auditor's side mount over-reads (safe).
- **Resolution change after calibration (READ).**
  - `cameraModelForFrame` (`camera-model-frame.ts:24-47`) refuses another aspect with a message, and uses a same-aspect size only once a resize is proved (ADR-440 Amd 9, `lensForFrame` 1 % tolerance).
  - Check camera measures an unproved size, not refuses it.
  - No gap in K1; the overlay side is K2's.

### Not verified

- The real `stitchHeadCameraPictures` output for my head camera; my figures are per tile.
- Whether the live head-camera overlay draws the whole frame or only the 80 % band (K2).
- The image-based moved check's classification of my moves (K2). Only the ring-based Check camera was run.
- KB-family fisheye accuracy: my renderer's fisheye frames refused (`anchors-unclear`).
- Mis-engraved rings, occluders and JPEG.
- Vitest was not run.

### Repro files

All in `zz-k1r\`. Run from there with `node --max-old-space-size=380 --no-experimental-webstorage --import ./register.mjs <file> [group]`.
- `rt.mts`: own truth (OpenCV Brown / fisheye, Euler pose, moves) and corner-mesh renderer. `r0-self.mts` is its self-test.
- `rh.mts`: the real chain, the forward-only bed error and the Job Review corner probe.
- `r1-matrix.mts` → `r1-a`, `r1-b1` (R5/R6 refused, R7, R8), `r1-b2` (R6 sharp, R6c), `r1-c` (R9–R12) `.out.jsonl`.
- `r2-why.mts` → `r2-why.out.jsonl`: the alternatives' terms, sigmas and corner errors.
- `r3-nudge.mts` → `r3-nudge.out.jsonl`: Check camera and the nudge.
- `r4-detect.mts` → `r4-detect.out.jsonl`: refusal causes at 16:9 and fisheye.
- `r5-fullbed-height.mts` → `r5-a1-refused` (blurred full-bed refusals), `r5-a` (FB1–FB4), `r5-b` (SD1–SD3) `.out.jsonl`.
- `r6-fbdebug.mts` → `r6-fbdebug.out.jsonl`: K1r-P3-1.
- `r7-head.mts` → `r7-head.out.jsonl`: K1-P3-1.
- `r8-roundtrip.mts` → `r8-roundtrip.out.jsonl`.

```json
[
  {"id":"K1-P1-1","verdict":"confirmed","severity":"P1","note":"own truth: 3 good-graded at 2.68-2.84 mm (3.2-3.4 at 40 mm), estimate 0.44-0.47x; widened: estimate map inverted, Job Review silent at the true-worst corner even when fair (R7 78/78); 2-term alternative collapses by insignificance or fold; plain 2-term fit not closer to truth in general (R1 3.29 vs 2.21, R3t 16.55)"},
  {"id":"K1-P1-2","verdict":"confirmed","severity":"P1","note":"pitch 1 deg: Fix 9.21 -> target 2.89 / bed 6.54 mm, grade good; roll 0.5/1 -> Nothing to fix with bed 3.5/5.6; Fix also clears the turned-camera Job Review line; Nothing-to-fix does not renew the reference"},
  {"id":"K1-P2-1","verdict":"confirmed-in-part","severity":"P2","note":"centred full-bed stays good (1.39 vs 0.24); 80 mm off-centre fair 1.6 vs 0.30; widened: straight-down + typed height fair 'about 6 mm' vs 0.80 (7.4x)"},
  {"id":"K1-P2-2","verdict":"confirmed","severity":"P2","note":"1.1-5.5 mm at 20-40 mm on own straight-down/near-straight cameras; size depends on the loose height draw"},
  {"id":"K1-P3-1","verdict":"confirmed-larger","severity":"P2","note":"head camera good + 0.004/0.008 mm; middle-80% band (stitch) p95 1.84 / max 3.84 mm per tile; P1 if the real stitch exceeds 1.5 mm"},
  {"id":"K1r-P3-1","severity":"P3","area":"calibration-and-model","file":"src/ui/camera/calibrate/calibration-result.ts","line":253,"anchor":"rings-too-small/no-marks messages name Ring size; ADR-441 Amd 9 D2 larger-sheet advice","evidence":"REPRO","known":false,"summary":"Full-bed sheet (the advised remedy) refused anchors-unclear on a back-rail 1280x960 webcam at sigma 0.7 px (4 far-row rings read as anchors); calibrates sharp or with 16 mm rings; the message omits Ring size"}
]
```

Refuter counts: raised 1, refuted 0, P1 2, P2 3, P3 1, known 1
