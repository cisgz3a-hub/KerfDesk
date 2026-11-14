# K2 — Overlay placement (camera audit v2, `overlay-placement`)

**Question.** Once a camera model exists, does artwork placed on the canvas camera picture burn where the picture shows it? The checks cover:
- the live overlay: the shader (`bed-overlay-shader.ts`) through the workspace view (zoom, pan, device pixel ratio), and the bed image (`bed-image.ts`) that trace and pieces use;
- the Material height and height areas;
- the camera-moved check (view shift, view motion, the reference view, Alt+C refresh);
- a picture of another size, a crop, a digital zoom, a mirrored or turned picture, and an upside-down or front-rail mount;
- the job origin: Absolute with and without a work offset, Current Position, User Origin, a bed-size change and an origin change;
- the rotary, and the #1641 / ADR-228 Amendment 2–3 advice.

K1's calibration-estimate findings (K1-P1-1, K1-P1-2, K1-P2-1, K1-P2-2, K1-P3-1) are not raised again. Where they show up here, they are listed as KNOWN.

**Tree.** `origin/main` @ `ba08a81af` (read-only export `j42-main`). `git diff --stat ba08a81af origin/main -- src/core/camera src/ui/camera` is empty, so every result also stands on current main (`4078a4c7b`).

**Method.**
- **Own truth and renderer** (`k2truth.mts`, written for K2; nothing imported or copied from `zz-k1` / `zz-k1r`):
  - lens: OpenCV Brown–Conrady (k1 −0.30, k2 0.10, k3 −0.012, p1 0.0005, p2 −0.0004), f 800 px, principal point (645, 478), 1280 × 960;
  - pose: camera centre (200, 30) mm, 430 mm above the bed (over the rear edge), look-at the bed point (200, 210), then turns about the camera's own axes and slides of its centre;
  - picture-level changes after the sensor: mirror, 180° turn, and a digital zoom that keeps the output size;
  - inverse: fixed-point undistortion plus a Newton polish. The project → ray → plane round trip is 1.8e-13 mm (`k0-calib.out.jsonl`);
  - scene: the engraved target on a 3 mm sheet, a slat bed (bright blades every 12 mm, a brace every 60 mm), a 25 mm dark frame rail with bright bolts, and a blocky floor around it. Raised pieces carry dark crosses, 24 mm arms 1.6 mm wide. A cylinder lying along X stands in for a rotary tumbler;
  - rendering: 2 × 2 samples per pixel, a [1 2 1] blur, Gaussian noise σ 1.5, 8-bit.
- **Real model.** The app's own `calibrateFromBedTarget` → `cameraModelFromCalibration` → `calibrationGrade` on my rendered photo of the default 300 × 200 sheet (target area 55,105 290 × 190, 10 mm rings, 3 mm sheet).
  - Result: 35/35 rings, 0.04 mm rms, worst ring 0.08 mm, height 431 ± 6 mm (true 430), graded **good**, "may be up to about 1.4 mm off near the bottom-left".
  - Saved as `model-a.json` and reused by every later step.
- **Overlay vs truth.**
  - Rendered: a cross at the true bed point P on a 44 × 44 mm piece, rendered by the truth camera. The canvas is drawn by the real `computeView` + `bedOverlayPasses` + `bedOverlayCompositeCoord` (the shader's CPU mirror) at 1100 × 820 CSS px, device pixel ratio 1.25, fit view and a 3.5× zoom panned onto each point. The cross is found on the canvas and converted back to scene mm.
  - Analytic, for grids and moves: the overlay shows P where `pixelToBed(model, truthPixel(P), MaterialHeight)` lands, because the shader samples `model.project(Q)`.
  - The two agree to 0.0–0.46 mm, which is the cross detector's own bias (`k1-place-*.out.jsonl`, `canvasVsAnalytic`).
- **Burn vs truth.** A 6 mm circle goes on each cross where the canvas shows it. The real `emitGcode` writes the program, my parser takes the laser-on moves, and the centre goes through the calibration-time `toSceneCoords`, plus the work offset. Origin modes and work offsets go through the real `resolveJobPlacement` → `runtimeCoordinatePreparationOptions` and the real Job Review text (`cameraPlacementStartFromWarning`, `rotaryCameraWarning`). The A rotary uses the `generic-grblhal` catalog profile.
- **Moved check.**
  - The reference is the real `viewThumbnail(calibration photo, 384)`, which is what `use-calibration-photo.ts:182` saves.
  - The current view is a render of the moved camera over different material.
  - The real `compareViews` is used, with `moved-check.ts`'s rule: measured ≥ `MOVED_MM` (1 mm) means moved; a weak result counts as 'unknown' until `WEAK_CHECKS_FOR_CHANGED` (2) in a row.
  - The true error is the old model on the moved truth camera.
- **Runs.** One Node process at a time, `--max-old-space-size=380`, each ending in `process.exit(0)`. Free memory was about 1.7 GB. No Vitest, browser, camera, network, hardware or pnpm.

## Headline

**The overlay itself is exact: the burn lands on the overlay to 0.00 mm in every case. The shader mirror, the zoomed view, the bed image, work offsets, a bed-size change and every Start-from mode behave as the code says. What goes wrong is what the picture is drawn against.**

- **K2-P1-1:** a live picture is checked for camera moves **once, three seconds after the camera starts**, and never again. A lid closed 0.5° differently, a knock, or a camera setting changed mid-session goes unnoticed while artwork is placed on the live picture:
  - 4.3–7.0 mm off for a 0.5° tip, 13.5 mm for 1°, 38.6 mm for 3°;
  - Job Review is silent, though the detector itself measured each of these to within about 10 %.
  - A view changed beyond recognition (a 1.25× zoom setting, a mirrored or turned picture) reads "weak" on that single check, which counts as "unknown", so even the start check stays silent (up to 102 mm, or a mirrored bed).
- **K2-P1-2:** on an A or Z rotary at Absolute, which the advice says "burns it where it sits on the picture", the picture is drawn at the overlay's Material height (default 0 mm), not at the tumbler's top.
  - An 80 mm tumbler on a chuck (top 85 mm up) burns **17–30 mm along the tumbler** from where its picture shows the artwork.
  - Job Review returns no warning for A/Z at Absolute, and nothing ties Material height to the rotary.
- **K2-P2-1:** Material height starts at **0 mm every session**. It is not saved, and it is not taken from the job's material thickness (ADR-496) or the calibration sheet. The camera auto-starts and draws onto the canvas without the panel opening. On 3 mm stock the overlay is up to 2.6 mm off, on 6 mm 5.1 mm and on 18 mm 16.5 mm, with no notice.
- **K2-P3-1:** the moved check's per-point displacements have the opposite sign to their own documentation. Only magnitudes are used today.

**Worst burn-vs-truth with no warning:**
- rotary tumbler at the advised Absolute: **29.6 mm**;
- live picture after a 1° tip: **13.5 mm**; after a 3° tip: **38.6 mm**; after a 1.25× zoom setting: **102 mm**;
- flat bed, auto-started camera, 6 mm stock: **5.1 mm**;
- KNOWN K1-P1-1 under "good" at the right height: 2.39 mm.

## Tables

### Placement through the real overlay and the real G-code (`k1-place-*.out.jsonl`)

Truth A, Absolute, work offset 0. "Overlay" is where the canvas shows the cross; "burn" is where the circle placed on it burns. Each figure is the distance to the true cross in mm. Burn vs overlay is 0.00 mm in every row.

| Case (material / Material height) | Centre | Target edge | Rear middle | Front middle | Rear-left corner | Rear-right corner | Front-left | Front-right | Warned? | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| 3 mm / 3 mm, fit view | 0.02 | 0.30 | 0.18 | 0.44 | 1.11 | 1.32 | 0.21 | 0.21 | no (good) | clean; corners KNOWN K1-P1-1 |
| 3 mm / 3 mm, 3.5× zoom + pan | 0.02 | 0.29 | 0.18 | 0.44 | 1.11 | 1.33 | 0.20 | 0.20 | no | zoom/pan/DPR clean |
| 3 mm / **0 (default)** | 1.20 | 0.89 | 0.25 | 2.32 | 1.18 | 0.94 | **2.58** | **2.55** | **no** | **K2-P2-1** |
| 6 mm / **0 (default)** | 2.31 | 2.15 | 0.27 | 4.75 | 2.12 | 1.78 | **4.98** | **5.07** | **no** | **K2-P2-1** |
| 18 mm / **0 (default)** | 7.45 | 7.02 | 0.56 | 13.89 | 7.11 | 6.77 | **16.22** | **16.48** | **no** | **K2-P2-1** |

Whole-bed grid, 5 mm, overlay = truth height (`k0-calib.out.jsonl`):
- target: mean 0.03, max 0.16 mm;
- bed at 3 / 0 / 20 / 40 mm: max 2.39 / 2.37 / 2.53 / 2.70 mm, all at the rear-right corner (400, 0), the corner nearest the camera.
- The grade's estimate is 1.4 mm "near the bottom-left": KNOWN K1-P1-1, reproduced on my truth.

Bed image (`warpFrameToBedImage`, trace and pieces) against the overlay: 0.02–0.21 mm (`k6-mounts.out.jsonl`).

### Camera moved after calibration (`k3-moved.out.jsonl`)

"Reported" is the real `compareViews` worst point. "True" is the old model on the moved camera, over the bed at 3 mm. The unmoved baseline has a max of 2.39 mm (K1-P1-1) and a centre of 0.01 mm.

| Move | Check result | Reported worst | True centre / max over bed | Held picture (Refresh, Alt+C): warned? | **Live picture after the start check: warned?** | Verdict |
|---|---|---|---|---|---|---|
| none, new material on the bed | measured | 0.00 | 0.01 / 2.39 | no (right) | no (right) | clean |
| slide 0.5 mm | measured, steady | 0.65 | 0.49 / 2.75 | no | no | under the 1 mm design |
| slide 1 mm | moved | 1.19 | 0.99 / 3.14 | yes | **no** | K2-P1-1 |
| slide 2 mm (y) | moved | 1.98 | 1.98 / 2.33 | yes | **no** | K2-P1-1 |
| lid 2 mm lower | moved | 1.81 | 0.81 / 1.77 | yes | **no** | K2-P1-1 |
| pitch 0.2° | moved | 2.42 | 1.71 / 3.06 | yes | **no** | K2-P1-1 |
| pitch 0.5° | moved | 6.59 | 4.29 / 6.99 | yes | **no** | K2-P1-1 |
| pitch 1° | moved | 13.41 | 8.56 / 13.49 | yes | **no** | K2-P1-1 |
| pitch 3° | moved | 41.69 | 25.38 / 38.58 | yes | **no** | K2-P1-1 |
| pitch 6° (knocked) | moved | 87.86 | 49.89 / 73.76 | yes | **no** | K2-P1-1 |
| roll 0.3° | moved | 1.50 | 0.06 / 2.70 | yes | **no** | K2-P1-1 |
| roll 1° | moved | 5.04 | 0.15 / 5.38 | yes | **no** | K2-P1-1 |
| yaw 0.5° | moved | 5.56 | 4.02 / 5.78 | yes | **no** | K2-P1-1 |
| digital zoom 1.03, same size | moved | 12.61 | 0.28 / 10.62 | yes | **no** | K2-P1-1 |
| digital zoom 1.25, same size | **weak** | — | 2.5 / **102.0** | only from the 2nd held picture | **no, even at start** | K2-P1-1 (b) |
| picture mirrored (camera flip) | **weak** | — | 6.3 / 408 | only from the 2nd held picture | **no, even at start** | K2-P1-1 (b) |
| picture turned 180° | **weak** | — | 20.5 / 739 | only from the 2nd held picture | **no, even at start** | K2-P1-1 (b) |

A narrow camera whose view is 91 % bed (`k7-nosurround.out.jsonl`) still measured: pitch 1° → 8.24 (true max 9.58), slide 3 mm → 3.08 (true 3.01–4.11).

### Job origin, work offset, bed frame (`k4-origin.out.jsonl`, `k4-bedframe.out.jsonl`)

Feature at (300, 140) on 3 mm stock; the overlay at 3 mm shows it at (300.01, 140.03).

| Case | Burn vs truth | Burn vs overlay | Warned? | Verdict |
|---|---|---|---|---|
| Absolute, work offset 0 | 0.03 | 0.00 | no (right) | clean |
| Absolute, G54 offset (12, −7) reported | 0.03 | 0.00 | no (right) | clean: `absoluteProgramOffset` −WCO |
| Current Position, head at (150, 150) | 186 | 186 | **yes**: "burns where Current Position puts it, not where the artwork sits on the camera picture. Choose Absolute…" | clean (said) |
| User Origin at machine (100, 80) | 265 | 265 | **yes**, same wording | clean (said) |
| Bed 400 × 400 → 400 × 420 after calibration | 0.03 | — | note: "KerfDesk moves its picture 20 mm" | clean: model moved with the scene |
| Origin front-left → rear-left | refused | — | "Calibrate the camera again, or set the origin back" | clean |

### Picture size, crop, mount (`k4-size.out.jsonl`, `k6-mounts.out.jsonl`)

| Case | App result | Error if drawn | Verdict |
|---|---|---|---|
| 640 × 480, whole view shrunk | proved `resize`, drawn | 2.39 max (same as 1280 × 960) | clean |
| 640 × 480, middle cut out | `differs`, not drawn, with message | 595 | clean (Y1-P1-1 fixed) |
| 1024 × 768, middle cut out | `differs`, not drawn | 102 | clean |
| 1280 × 720 crop | another shape, not drawn, with message | — | clean |
| Same size, digital zoom / mirror / 180° set **after** calibration | drawn | 10.6 – 739 | K2-P1-1 (only the moved check could see it) |
| Camera hung upside down (roll 180°) | calibrates 35/35, 0.04 mm, fair | target 0.14, bed 2.21 | clean |
| Camera on the front rail looking back | calibrates 35/35, good | target 0.16, bed 2.28 | clean; bed KNOWN K1-P1-1 |
| Picture mirrored at calibration | refused `mirrored-image` | — | clean |

### Rotary (`k4-rotary.out.jsonl`, `k5-rotary-burn.out.jsonl`)

A chuck (A axis, generic grblHAL) turns an 80 mm tumbler. Its axis is 45 mm up at y = 200, so its top line is 85 mm above the bed. The crosses sit on the top line. Absolute is used, which ADR-228 Amendment 3 advises on A/Z.

| Overlay Material height | x = 130 | 200 | 270 | 320 | Job Review (A, Absolute) | Verdict |
|---|---|---|---|---|---|---|
| 0 (default) | −17.25 | 0.01 | +17.26 | **+29.55** | **none** (`rotaryCameraWarning('absolute','A')` = null) | **K2-P1-2** |
| 3 (set for flat stock) | −16.65 | 0.01 | +16.65 | +28.51 | none | **K2-P1-2** |
| 85 (cylinder top) | −0.08 | −0.02 | 0.03 | 0.04 | none | right |

- The burn on A is where the overlay shows the artwork: burnX 112.75 / 287.26 / 349.55, against true 130 / 270 / 320.
- A rendered tumbler gives the same −17.25 / +0.04 / +17.30 / +28.96.
- At 0 mm the top line also shows 42 mm towards the front (y 241.9 against 200). That matters on a Y rotary, where the advice is "jog the head over the artwork on the camera picture".

## Findings

### K2-P1-1 — A live camera picture is checked for moves only once, three seconds after the camera starts. A camera that is knocked, a lid that closes differently, or a camera setting changed while the live picture is on the canvas is never noticed (4–39 mm off for a 0.5–3° tip). A view that no longer matches at start is silent even on that one check

- **Where:**
  - `src/ui/camera/helpers/install-camera-helpers.ts:114-145` (`checkForMoves`): it checks when `overlayStill` changes (`:119-124`), and once `MOVED_CHECK_SETTLE_MS` (3 s, `:148`) after the *source* changes (`:125-139`). Nothing else calls the check (grep: `checkCameraMoved*` is called only from here).
  - `:150-167` (`refreshAfterJobs`): the after-job refresh returns when there is no held picture (`:159`), so a live picture is never refreshed or rechecked after a job.
  - `src/ui/camera/helpers/moved-check-capture.ts:27-39`: the start check takes one picture; a null picture means no check at all.
  - `src/ui/camera/helpers/moved-check.ts:53,211-220`: `WEAK_CHECKS_FOR_CHANGED = 2`; the first weak result publishes 'unknown'.
  - `src/ui/camera/WorkspaceCameraOverlay.tsx:62,152-153`: with no held picture the canvas draws the live camera. The auto-started camera (ADR-663 Amd 1) starts that way: `overlayVisible: true` (`camera-store.ts:153`), and the placement latches (`camera-placement-latch.ts`).
- **Anchor:**
  - ADR-663 Amendment 3 Consequences: "A knocked camera or a lid that closes differently is noticed at the next refresh, **before a job burns in the wrong place**".
  - A live picture has no next refresh: ADR-663 Amendment 1 says "A live picture needs nothing".
  - Amendment 5 Decision: one weak check "may be a hand or a clamp in the way"; two in a row warn. A live picture only ever gets one.
  - Measured against an independent truth camera.
- **Evidence:** READ (above) and REPRO (`k3-moved.mts`).
  - The detector works whenever it runs. Each move of 1 mm or more, or of 0.2° or more, was measured within about 10–20 % of the truth: pitch 0.5° 6.59 against 6.99; 1° 13.41 against 13.49; roll 1° 5.04 against 5.38; yaw 0.5° 5.56 against 5.78; a 1.03× zoom 12.61 against 10.62.
  - The same moves on a live picture after its start check: no further check runs, the moved state stays 'steady' (set at calibration save or by the start check), and Job Review's `cameraMovedStartWarning` has nothing to say.
  - A 1.25× same-size zoom, a mirrored picture and a 180° turned picture give `weak`. On the single start check that is 'unknown': silent, while the overlay is 102–739 mm off. On held pictures, the second Refresh would say "changed".
- **Scenario:**
  1. A diode laser with a lid or mast camera, calibrated (good). KerfDesk opens and the laser connects, so the camera starts by itself and the bed shows on the canvas, live.
  2. The start check runs 3 s later: steady.
  3. The operator opens the lid, or bumps the mast, while laying a sheet down. The camera comes back tipped 0.5–1°. The live picture looks normal: it shows the sheet, just in the wrong place.
  4. They drop artwork onto the sheet in the picture and Start. Job Review shows no camera warning, and the burn is 4–7 mm (0.5°) or 9–13 mm (1°) away from where it showed.
  5. Had they pressed Alt+C, the held picture would have been checked and "The camera may have moved … up to about 13.4 mm" shown.
- **Severity: P1.** A silent position error far beyond the grade's "by eye" accuracy, with no warning, on the default display path (live, auto-started). The ADR's promise ("before a job burns in the wrong place") does not hold for it. A visible misfit on the picture is not a warning (METHOD §3).
- **Announced?** Partly. Amendment 3 lists the triggers (each held picture, and once after start), and Amendment 1 says a live picture needs no refresh. No ADR says that a live picture stays unchecked, and Amendment 3's Consequence claims the opposite.
- **Novelty:** new. Y1-P2-2 / Y1-P3-2 (#1680) fixed *what* the check measures, not *when* it runs.
- **Fix direction:**
  - While a live picture is shown and placement is on, run the existing worker check periodically (it costs about 90 ms in the worker, ADR-663 Amd 5) on a thumbnail from the live element, for example every 15–30 s while idle.
  - Always run it at Frame, Start and Job Review, and say the result in Job Review.
  - Count weak results across time, not only across held pictures, so a view that stays unrecognisable for two checks a few seconds apart says "changed".
  - Add a test that a live source with no held picture is rechecked after it is moved.

### K2-P1-2 — On an A or Z rotary at Absolute (the mode the advice says "burns it where it sits on the picture"), the camera picture is drawn at the overlay's Material height, not at the part's top. An 80 mm tumbler burns 17–30 mm along its length from where the picture shows the artwork, and Job Review is silent

- **Where:**
  - `src/ui/laser/start-job-readiness-policy.ts:203-211` (`rotaryCameraWarning`): A/Z with Absolute returns `null`. The A/Z placed-mode text tells the operator to choose Absolute, because "Absolute Coordinates burns it where it sits on the picture".
  - `src/ui/camera/WorkspaceCameraOverlay.tsx:157-178`: the overlay's height is only `useCameraStore.surfaceHeightMm` (default 0, `camera-store.ts:159`) and the height areas. Nothing in `src/ui/camera` reads the rotary (grep: only the target's "switch Rotary off").
  - `src/core/devices/rotary.ts:28-58`: the rotary setup knows the object's diameter but not its axis height, and nothing prompts for a Material height when the rotary is on.
- **Anchor:**
  - ADR-228 Amendment 3, Consequences: "On an A or Z rotary, a job placed on the camera picture **burns where it shows** from Absolute, and the advice says so."
  - The maintainer's 2026-11-09 request for a perfect round glass / tumbler burn, and the K2 scope "the rotary (#1641 advice)".
  - Measured: the burn against the true mark.
- **Evidence:** REPRO.
  - `k4-modes.mts rotary`: analytic and rendered tumbler. At Material height 0 the crosses at x 130 / 270 / 320 show at 112.75 / 287.26 / 349.55; at 3 mm (left from flat work) at 113.35 / 286.65 / 348.51; at 85 mm at the true x within 0.08 mm.
  - `k5-rotary-burn.mts`: the real `emitGcode` (A axis, `generic-grblhal`, Absolute) burns the artwork at exactly the overlay X: 112.75 / 287.26 / 349.55, so 17.25 / 17.26 / **29.55 mm** from the true marks. Preflight passes. Job Review has nothing for A/Z at Absolute.
  - On a Y rotary the advice is "jog the head over the artwork on the camera picture … then choose Current Position". At 0 mm the picture shows the top line 42 mm forward and stretched 1.27× along X about the camera's nadir, so the head is jogged to a point off the part as well.
- **Scenario:**
  1. A tumbler on a chuck rotary (A axis). Camera placement on, Material height left at 0 or at the 3 mm used for flat work.
  2. The operator drops a 60 mm logo on the tumbler in the picture, about 100 mm right of the camera's centre line. Start from is Absolute, as Job Review advised for A.
  3. Job Review is silent. The logo burns about 17–30 mm along the tumbler from where it was placed, and partly off the printable band.
- **Severity: P1.** It is a silent, large position error on the very path the advice certifies, on a part that is usually one-off (glass, tumblers). Material height is a visible control, but nothing on the rotary path names it. The cylinder's top is 40–120 mm up, where flat-bed habit (0–6 mm) is badly wrong.
- **Announced?** No. Amendment 3 says the opposite.
- **Novelty:** new. W4-P2-1 (#1641) and Y3-P1-1 (Amendment 3) fixed the Start-from advice, not the height the picture is drawn at.
- **Fix direction:**
  - With the rotary on and camera placement latched, have Job Review (and the panel) say that the picture lines up with the part only at its top. Show the number to set ("set Material height to the top of the part: about axis height + diameter / 2"), and stay silent only when the Material height or a height area over the part is within about 1 mm of that.
  - Better: add the rotary's axis height to Rotary Setup (it is a property of the rotary) and default the overlay height from it while the rotary applies.
  - Add a test: the A/Z Absolute advice with Material height 0 and a rotary part warns.

### K2-P2-1 — The overlay's Material height starts at 0 mm in every session (it is not saved, and not taken from the job's material or the calibration sheet). The auto-started overlay is drawn at 0 without the panel opening: on 3 mm stock it is up to 2.6 mm off, on 6 mm 5.1 mm and on 18 mm 16.5 mm, with nothing in Job Review

- **Where:**
  - `src/ui/state/camera-store.ts:159` (`surfaceHeightMm: 0`) and `:183-184`: the only setter is the panel control (grep: `setSurfaceHeightMm` is used only by `OverlayControls.tsx:174-200`). No persistence.
  - `src/core/scene/project.ts:142-146,158`: `jobSetup.laserMaterial.thicknessMm` (ADR-496, set when a library material is chosen) is never read by the camera.
  - `WorkspaceCameraOverlay.tsx:157-178`: the overlay reads only the camera store.
  - ADR-663 Amendment 1: "its picture then shows on the canvas without opening the panel".
- **Anchor:**
  - ADR-440 Consequences: "Material height is exact for the overlay" (exact only when it is set).
  - ADR-663 Context: "Glowforge and xTool make the camera picture the bed: one Refresh, **the material height measured for the operator**".
  - Twin of K1-P2-2: a height condition that nothing at use time reads.
- **Evidence:** REPRO `k1-place.mts 3|6|18 0`, through the real shader mirror and `emitGcode`. Burn = overlay in every case.
  - 3 mm stock: centre 1.20, front corners 2.58 / 2.55 mm.
  - 6 mm: centre 2.31, front corners 4.98 / 5.07 mm.
  - 18 mm: centre 7.45, front corners 16.22 / 16.48 mm.
  - With Material height set right, the same points are 0.02–1.33 mm (the model, `k1-place-3-3`).
  - READ: no Job Review line compares the overlay height with anything.
- **Scenario:**
  1. Next morning KerfDesk opens and the camera starts by itself. The bed shows on the canvas, graded "Accurate enough".
  2. The operator chose "Birch plywood 6 mm" from the material library for the job, and lays the sheet down.
  3. They never open the Camera panel, so the Material height is 0.
  4. Artwork placed on the sheet's front corner in the picture burns 5 mm off; on 18 mm stock, 16 mm off. Nothing warns.
- **Severity: P2.** The harm is real, but the input belongs to the operator and the control is labelled ("top of the material above the bed"). P1 is arguable where the project's job material carries a thickness the overlay ignores; I rate it P2 because nothing in the product promises that link.
- **Announced?** No.
- **Novelty:** new. K1-P2-2 is the calibration-height caveat; this is the overlay's own default.
- **Fix direction:**
  - Default the overlay height from `jobSetup.laserMaterial.thicknessMm` (or the CNC stock thickness) when one is set, else keep the last value per machine.
  - Show the height on the canvas while placement is latched, for example "Camera picture at 0 mm: set Material height".
  - In Job Review, say when the job's material thickness and the overlay height differ by more than about 1 mm on a camera-placed job.

### K2-P3-1 — The moved check's per-point displacements are the negative of what their documentation says

- **Where:**
  - `src/core/camera/model/view-motion.ts:164` ("Where each of bedSamplePoints now shows, less where the calibration puts it") and `:192-193`.
  - `:217`: the fit maps reads-now → was, so `map(p) − p` (`:225-227`) is where a feature that now reads at p truly is, minus p.
  - `camera-moved-store.ts:18` repeats the doc.
- **Evidence:** REPRO `k3-moved.out.jsonl`. Every measured case has reported ≈ −(true).
  - Slide +1 mm x: reported (+1.16, 0), but the overlay shows each point at (−0.99, 0).
  - Pitch 0.5°: reported centre (0, +4.22), true (0, −4.29).
  - Yaw 0.5°: reported (−3.89, 0), true (+4.02, 0).
- **Severity: P3.** Today only magnitudes and differences are used (`worstMm`, `cameraMovedTurned`, `furthestChangeMm`), so nothing is misplaced. A later feature that applies them as a correction (a "fix from the moved check", or prefilling the nudge) would double the error instead of removing it.
- **Novelty:** new. **Fix direction:** flip the sign or the doc, and add a signed test (a +x slide gives a −x displacement in "where it now shows" terms).

## KNOWN status (on `ba08a81af`)

| ID | Was | Status here | Evidence |
|---|---|---|---|
| K1-P1-1 (P1) | Off-target estimate under-reads | **Reproduces through the overlay and the burn** on my truth: graded good, estimate 1.4 mm "near the bottom-left", true 2.39 mm at the rear-right corner. Burn = overlay, so the model error reaches the burn 1:1 | `k0-calib`, `k1-place-3-3-*` |
| K1-P2-2 (P2) | Target-height-only calibration used at any height | Not re-run: my calibration pinned the height (431 ± 6 mm). With the height pinned, 0 → 40 mm adds only +0.31 mm (2.39 → 2.70), as K1 found | `k0-calib` |
| Y1-P1-1 (P1) | Same-aspect sensor crop used as a resize | **Fixed**: crops at 640 × 480 and 1024 × 768 → `differs`, not drawn; a true shrink → `resize`, drawn at model accuracy | `k4-size` |
| Y1-P2-2 / Y1-P3-2 | Moved check misses turns; slide under-read | **Fixed**: rolls 0.3° / 1°, yaw 0.5°, pitch 0.2–6° and slides all measured within about 10–20 % (slides over-read, which is safe) | `k3-moved` |
| W4-P2-1 (#1641) / Y3-P1-1 (ADR-228 Amd 2–3) | Rotary Start-from advice | Present and correct for Start from (A/Z placed modes warn, Absolute advised). **The height gap is new: K2-P1-2** | `k4-rotary` |
| Y3-P1-2 (ADR-441 Amd 10) | Camera target from a placed Start from | Present: `cameraTargetStartFromWarning` (READ `start-job-readiness-policy.ts:136-142`) | READ |
| H6-P1-1 (ADR-663 Amd 4) | Camera placement only latched by the panel | Fixed: latches whenever the canvas draws a picture (`camera-placement-latch.ts`) | READ |
| Z1-P3-2 | Bridge overlay sized from the JPEG header but drawn EXIF-rotated | **Still open** (READ): `machine-frame-feed.ts:88` `jpegSize`; no `imageOrientation` anywhere in `src/ui/camera`. Not re-run | READ |
| W4-P3-1 | A USB camera that stops sending leaves its last picture on the canvas; the note is only in the panel | **Still open** (READ): nothing in `WorkspaceCameraOverlay` or Job Review reads `usbAvailability`. Not re-run (K4) | READ |
| ADR-663 Amd 3/5 "A camera that sees only the bed … cannot be checked" | Announced | Not reached here: a narrow camera with 9 % surround still measured (pitch 1° → 8.24 mm) | `k7-nosurround` |

## Verified clean

- **Overlay = burn.** In every flat-bed case (8 points × 5 height/view settings) the circle placed on the canvas cross burned within 0.00–0.01 mm of where the canvas showed it. `emitGcode` + `toMachineCoords` add nothing.
- **Shader mirror and view.** The canvas detection agreed with the analytic `pixelToBed` to 0.0–0.46 mm (the cross detector's own bias). The fit view, a 3.5× zoom with pan, and device pixel ratio 1.25 give the same answers. The overlay and the workspace canvas share one grid cell (`workspace-preview.css:29-43`) and the same `computeView`.
- **Bed image** (trace, pieces) against the overlay: 0.02–0.21 mm.
- **Height areas:** the shader draws lowest first, so the highest wins (`bed-overlay-shader.ts:198-213`), the same rule as `warpFrameToBedImage` (highest first, first match). READ.
- **Work offsets:** Absolute with a reported G54 offset (12, −7) burns 0.03 mm from the truth via `absoluteProgramOffset` = −WCO.
- **Start from:** Current Position and User Origin move the burn 186 / 265 mm and are warned in the exact words of ADR-228 Amendment 1.
- **Bed frame:** a 20 mm deeper bed after calibration moves the model and keeps the burn at 0.03 mm, with the note "KerfDesk moves its picture 20 mm". An origin change refuses with advice.
- **Picture size:** a shrink is proved and placed; crops are refused; another aspect is refused with a message.
- **Mounts:** upside down (roll 180°) and front rail calibrate and place correctly. A mirrored picture at calibration is refused `mirrored-image`.
- **Moved check when it runs:** every move of 1 mm or 0.2° and up is measured. A 0.5 mm slide (0.49 mm true) stays steady, as designed. New material on the bed reads 0.00 mm. A 9 % surround is enough.

## Not verified

- The GPU shader itself (the CPU mirror was used; ADR-440 records a Chromium match), and the real DOM boxes of the overlay against the canvas. No browser was run.
- The real helper subscription for K2-P1-1 was read, not driven. Driving it needs a live source and `captureSourceFrame` (browser-only). The detector side was run.
- Real lenses, rolling shutter, autofocus breathing (the 1.03× zoom stands in for it), a lid camera's real hinge repeatability, lighting changes.
- Head-camera live overlay during motion: the picture is placed at the latest status position, not the frame's time (`head-position.ts`, `active-camera-model.ts:55-67`). It is transient and only while moving; not measured.
- An Absolute export without a work offset report puts the burn at the controller's stored G54 (13.9 mm in `k4-origin` with (12, −7)). That is general placement (`work-offset-assumption.ts`), not camera-specific, and its warning was not checked here.
- Y rotary burns, tapered tumblers, Ruida/other controllers; Vitest (not run).

## Repro files

All in scratchpad `zz-k2\`. Run from there with `node --max-old-space-size=380 --no-experimental-webstorage --import ./register.mjs <file> [args]`. The loader is the copied `register.mjs` / `ts-resolve.mjs` (esbuild from `j34-main`), with imports pointed at `j42-main`.

- `k2truth.mts`: own truth (Brown–Conrady, look-at pose, turns and slides, picture mirror / 180° / digital zoom), scene and renderer, shrink and crop.
- `k2app.mts`: the real calibration chain, `modelA()` (cached in `model-a.json`), `overlayShows`, `gridStats`.
- `k2burn.mts`: project and circle builders, real `emitGcode`, G-code parser, origin transforms.
- `k0-calib.mts` → `k0-calib.out.jsonl`: self-test, calibration, grade, whole-bed grid.
- `k1-place.mts <material> <MaterialHeight> <fit|zoom>` → `k1-place-{3-3-fit,3-3-zoom,3-0-fit,6-0-fit,18-0-fit}.out.jsonl`: the canvas, the burn and the truth.
- `k3-moved.mts` → `k3-moved.out.jsonl`: moves against the real `compareViews`.
- `k4-modes.mts {origin|bedframe|rotary|size}` → `k4-*.out.jsonl`.
- `k5-rotary-burn.mts` → `k5-rotary-burn.out.jsonl`: A-rotary burn X.
- `k6-mounts.mts` → `k6-mounts.out.jsonl`: upside-down, front rail, mirrored at calibration, bed image.
- `k7-nosurround.mts` → `k7-nosurround.out.jsonl`.

```json
[
  {"id":"K2-P1-1","severity":"P1","area":"overlay-placement","file":"src/ui/camera/helpers/install-camera-helpers.ts","line":114,"anchor":"ADR-663 Amd 3 Consequences 'noticed at the next refresh, before a job burns in the wrong place'; Amd 1 'A live picture needs nothing'; Amd 5 two weak checks","evidence":"READ+REPRO","known":false,"summary":"Moved check runs only on held pictures and once 3 s after a camera starts; a live (default, auto-started) picture is never rechecked, and a weak first check is 'unknown'. Detector measures pitch 0.5/1/3 deg as 6.6/13.4/41.7 mm (true 7.0/13.5/38.6) when run; live overlay stays silent; 1.25x zoom / mirror / 180 setting -> weak -> silent at 102-739 mm"},
  {"id":"K2-P1-2","severity":"P1","area":"overlay-placement","file":"src/ui/laser/start-job-readiness-policy.ts","line":207,"anchor":"ADR-228 Amd 3 Consequences 'On an A or Z rotary, a job placed on the camera picture burns where it shows from Absolute'","evidence":"REPRO+READ","known":false,"summary":"A-rotary tumbler (top 85 mm) with overlay Material height 0/3: artwork burns 17-30 mm along X from where the picture shows it (real emitGcode, grblHAL A); rotaryCameraWarning(A/Z, absolute) = null; nothing ties Material height to the rotary"},
  {"id":"K2-P2-1","severity":"P2","area":"overlay-placement","file":"src/ui/state/camera-store.ts","line":159,"anchor":"ADR-440 'Material height is exact'; ADR-663 context 'material height measured for the operator'; twin of K1-P2-2","evidence":"REPRO+READ","known":false,"summary":"Overlay Material height defaults to 0 every session, unsaved, ignores jobSetup.laserMaterial.thicknessMm; auto-started overlay drawn without the panel: 3/6/18 mm stock -> up to 2.6/5.1/16.5 mm off, no Job Review line"},
  {"id":"K2-P3-1","severity":"P3","area":"overlay-placement","file":"src/core/camera/model/view-motion.ts","line":164,"anchor":"its own doc comment and camera-moved-store.ts:18","evidence":"REPRO","known":false,"summary":"bedMotionFromPatches displacements are -(where the point now shows - where calibrated); only magnitudes used today"}
]
```

## Counts

Raised 4 → P1 2 / P2 1 / P3 1. Known: K1-P1-1 reproduces through the overlay and the burn. Y1-P1-1, Y1-P2-2, Y1-P3-2 and H6-P1-1 are fixed. W4-P2-1, Y3-P1-1 and Y3-P1-2 advice is present. Z1-P3-2 and W4-P3-1 are still open by READ. K1-P2-2 was not re-run. 10 known items are listed.

## Refuter (2026-11-14)

**Tree and harness.** Same read-only export `j42-main` (`origin/main` @ `ba08a81af`). `git diff --stat ba08a81af origin/main` (now `3bbcd4137`) touches only `docs/audits/` (camera v2 plan, K1 ledger, tools T1). Nothing under `src/` changed, so the K1 work has not reached K2's findings, and every result below stands on current main.

My files are in `zz-k2r\`. I read `k3-moved.mts`, `k5-rotary-burn.mts` and `k2burn.mts` for API shape only; nothing imports a `zz-k2` or `zz-k1*` file.
- **Own truth (`rr.mts`).** A Kannala-Brandt lens (k 0.035 / −0.012 / 0.002, fx 905, fy 899, principal point (652.5, 471.25), 1280 × 960), which is the app's own model family. **The saved model is the truth itself** (`appRecord`), so every error below comes from the move, the setting or the height, never from a calibration (K1's area is taken out).
  - Pose: camera centre (196, −22) mm, 440 mm up, over the rear rail. Euler pitch about the camera's x axis (aimed at the bed centre), world yaw 1.2°, roll −0.8°. My own axis-angle conversion gives the app's `rvec`.
  - Own inverse: Newton on θ_d. Self-test (`r0-self`): my projection against the app's `projectWorldPoint` agrees to 2.5e-13 px, and the round trip to 4.8e-13 mm.
  - Scene: the z = 0 plane. The bed is 400 × 300 and carries a seeded "today's material" (grain and dark marks). The surround is fixed: 22 mm rails with bolts every 50 mm, a lip, floor blocks and a cable. An optional cylinder lies along X for a rotary part.
  - Render: 2 × 2 samples, xorshift Gaussian noise σ 2, 8 bit. Picture-level digital zoom, mirror and 180° turn are applied after the sensor.
- **Real code driven.** The real `viewThumbnail` and `compareViews` on my renders. **And, new here, the real `installCameraHelpers` subscription (`checkForMoves`, the timer, `checkStartedCameraMoved`, `checkCameraMovedInWorker`, `publish`/`publishWeak`, the toast) and the real Job Review line `cameraMovedStartWarning`.**
  - The only stub is `captureSourceFrame` as imported by `moved-check-capture.ts`. A loader hook (`ts-resolve-stub.mjs` → `stub-frame-source.mts`) returns my render and counts the captures.
  - A Map shim stands in for `localStorage`. The model goes into `project.device.cameraModel` with the bed frame from `cameraBedFrameNow()`, and the reference is saved with the real `saveViewReference` + `markCameraSteady`, as `use-calibration-photo.ts` does.
  - Without `Worker`/`OffscreenCanvas` in Node, `pictureClient()` is null, so the comparison runs in the window path. The worker path calls the same `compareViews`.
- **Rotary and burns.** The real `pixelToBed` at each Material height (the overlay's shader samples `project(Q, h)`, READ `bed-overlay-shader.ts:216-300`). The real `emitGcode` with the `generic-grblhal` catalog profile on A and Z rotaries, rear-left origin. The real `rotaryCameraWarning` and `cameraPlacementStartFromWarning`.
- **Runs.** One Node process at a time, `--max-old-space-size=380`, each ending in `process.exit(0)`. About 2.2 GB free. No Vitest, browser, camera, network, hardware or pnpm.

### Verdicts

| Finding | Verdict | Severity | Evidence (own) |
|---|---|---|---|
| K2-P1-1 | **CONFIRMED by driving the real helper subscription**, which the auditor only read. Two corrections: "only once" means once per camera *start* (a stop/start or a camera switch checks again, and the weak count carries over between starts); and a mirrored picture is geometry-dependent (here it was measured and warned, though 18× under the truth) | **P1** | `r2-helpers`, `r1-moved` |
| K2-P1-2 | **CONFIRMED** on another camera, on A and Z | **P1** (rate together with K2-P2-1, see below) | `r3-rotary` |
| K2-P2-1 | **CONFIRMED** in mechanism and size. **Novelty and "Announced? No" corrected:** W4 dropped this exact candidate, and Y3 listed it under Verified clean, both citing ADR-441 Amd 2 §5 ("Not saved") | **P2** | `r4-height`, READ |
| K2-P3-1 | **CONFIRMED.** Reported ≈ −true at all five sample points in all 13 measured cases | **P3** | `r1-moved` |

**K2-P1-1: CONFIRMED, P1.**

*The real subscription, driven (`r2-helpers.out.jsonl`).* My camera has a live USB source, as the auto-start sets it; there is no held picture.

| Step | Captures taken by the check | Moved state | Job Review (`cameraMovedStartWarning`) |
|---|---|---|---|
| A0 live source set | 0 | steady (calibration save) | none |
| A1 3 s later: start check, camera unmoved | **1** | steady | none |
| A2 camera tipped 0.8° (true 7.0 mm at the centre, 9.6 mm max). Then 24 s of live use: opacity, visibility and Material height changed 8 times, plus a job reported finished | **1** | **steady** | **none** |
| A3 the same view as a held picture (what Alt+C / Refresh does) | 1 (the held picture is passed in) | **moved 9.73 mm** | "…may show up to about 9.7 mm from where they burn…", plus a toast |
| B1 digital zoom 1.30 set between sessions, first start check | 2 | unknown (weak 1) | **none** (true 108.7 mm max) |
| B2 10 s later, still live | 2 | unknown | **none** |
| B3 camera stopped and started again: second start check | 3 | **changed** (weak 2) | "…no longer matches its calibration…" |
| C1 mirrored picture at start | 4 | moved **24.26 mm** | warns "up to about 24.3 mm" (true **436.7 mm**) |

- **Read, confirming the table.**
  - `install-camera-helpers.ts:116-139`: a check runs only when `overlayStill` changes, or 3 s after the live *source object* changes.
  - The live source object is replaced only by a start, a stop or a switch (`camera-source-actions.ts:170,211,288`). USB mute/unmute changes only `usbAvailability` (`camera-source-lifecycle.ts:41-48`).
  - The auto-start acts only on an idle camera (`auto-start.ts:57`), so a laser reconnect does not recheck a running one.
  - `refreshAfterJobs` returns when there is no held picture (`:159`).
  - No Start, Frame or Job Review path calls a check: `start-machine-snapshot.ts:67` only *reads* the stored state.
- **Answer to "is there any check at Job Review / Start?":** no. Job Review shows whatever the last check published. On the live path that is the 3-second start check. The operator sees nothing: no toast, no panel note, no Job Review line, and the live picture looks normal.
- **Detector accuracy when it does run** (`r1-moved`). Reported worst against the true maximum: pitch 0.4° 4.75 / 4.83, pitch 0.8° 9.73 / 9.61, pitch −1.5° 17.90 / 18.60, pitch 2° 25.01 / 23.66, yaw 0.8° 5.32 / 5.32, roll 0.6° 2.88 / 2.83, lid 3 mm lower 2.52 / 2.62, zoom 1.04 14.38 / 13.19, zoom 1.10 32.67 / 33.64. A 0.6 mm slide reads 0.78 (steady, as designed); 1.5 mm reads 1.40 (moved). New material only: 0.00.
- **Corrections.**
  - *"Checked only once":* once per camera start. With one auto-start per session (the default) that is once a session. But the weak count (`camera-moved-store.ts:39`) is not reset by a start, so a view that stays unrecognisable says "changed" on the next stop/start (B3). It is only reset at a measured result or `markCameraSteady`, and it is in memory, so a new session starts again at 0.
  - *"Mirrored → weak → silent":* geometry-dependent. On my camera, a mirrored picture matched enough patches to be *measured*: 24.3 mm, "turned", Check camera advised. It warns, but at 1/18 of the truth (K2r-P3-1 below). A 1.30× zoom and a 180° turn did read weak, so part (b) stands.
- **ADR status.** Amd 3's Decision lists exactly these triggers ("on each new held picture … and once a few seconds after the camera starts"), so the trigger set is announced. Its Consequence ("noticed at the next refresh, before a job burns in the wrong place") is not true for the live picture, which Amd 1 says needs no refresh.
- **Severity: P1 stands.** It is a silent 4.8–25 mm position error (on my camera, for 0.4–2° tips) on the default display path, and no warning reaches the operator before output (METHOD §3). It is the same harm class as Y1-P2-2, which the v13 refuter raised to P1 ("stays silent on small rotations and knocks").

**K2-P1-2: CONFIRMED, P1.**

The part is a tumbler, Ø 80 mm on a chuck, axis 45 mm up at bed y = 150, so its top line is 85 mm up. My camera's nadir is at x = 196. Each cell is (overlay − true) along X / along Y, mm.

| Overlay Material height | x = 100 | 150 | 196 | 250 | 300 | 350 | Y (all x) |
|---|---|---|---|---|---|---|---|
| 0 (default) | −22.99 | −11.01 | 0.00 | +12.93 | +24.90 | **+36.87** | **+41.18** |
| 3 (left from flat work) | −22.17 | −10.63 | 0.00 | +12.47 | +24.02 | +35.57 | +39.73 |
| 80 (5 mm short of the top) | −1.35 | −0.65 | 0.00 | +0.76 | +1.46 | +2.17 | +2.42 |
| 85 (the top) | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |

- A Ø 12 mm pen, top 46 mm up, at 0: X −11.2 … +18.0 mm, Y +20.1 mm.
- **Burn.** The real `emitGcode` takes an 8 × 8 mm square placed where the overlay at 0 shows the tumbler mark at x = 330 (scene x 362.08). It burns centred at **X 362.08 on both the A and the Z rotary: 32.08 mm along the part from the mark**. Preflight passes.
  - `rotaryCameraWarning('absolute', 'A' | 'Z')` = null, and `cameraPlacementStartFromWarning` with placement on, no `jobOrigin` and axis A or Z = null.
- **Read.**
  - Nothing in `src/ui/camera` reads the rotary, except the target refusal (`calibration-actions.ts:108`).
  - `RotarySetup` (`rotary.ts:28-58`) has the diameter but no axis height.
  - ADR-228 Amd 2 Consequences already say "no camera code reads the rotary", but about the circumference, not the height.
- **The error scales with distance from the camera's nadir.** A part centred under the camera is nearly right along X but still 41 mm off in Y. That matters on a Y rotary, where the advice is to jog the head over the artwork on the picture.
- **Severity: P1, with a consistency note for the coordinator.**
  - It has the same mechanism as K2-P2-1 (the Material height is not at the part's top).
  - What makes this one P1 is that Job Review actively certifies this exact path ("On an A or Z rotary, Absolute Coordinates burns it where it sits on the picture", and ADR-228 Amd 3 Consequences: "burns where it shows").
  - The needed value (axis height + radius, 40–120 mm) is far outside flat-bed habit, and nothing on the rotary path names it.
  - If the coordinator rates K2-P2-1 P1, this stays P1. If K2-P2-1 is kept P2 as an operator setting, the certification is still a reason to keep this one at P1.

**K2-P2-1: CONFIRMED, P2. Novelty corrected.**
- **Repro** (`r4-height`, my exact model, overlay at 0). This is the worst bed point (the front corners, furthest from the rear camera), with the centre in brackets:

  | Stock | Worst (centre) |
  |---|---|
  | 1.5 mm | 1.30 (0.59) |
  | 3 mm | 2.62 (1.18) |
  | 6 mm | 5.27 (2.38) |
  | 12 mm | 10.69 (4.82) |
  | 18 mm | 16.26 (7.34) |
  | 25 mm | 22.96 (10.36) |

  This matches the auditor's 2.6 / 5.1 / 16.5 mm on another camera.
- **Read confirms:**
  - `surfaceHeightMm: 0` (`camera-store.ts:159`), a plain `create` with no persistence;
  - the only setter is `OverlayControls.tsx:115` (fixtures and the job watch only read it);
  - no Job Review line reads it.
- **Correction: it is not new and is partly announced.**
  - ADR-441 Amd 2 Decision 5 ("**Not saved.** Areas live in the camera store next to the material height. They describe what is on the bed now"), and `camera-store.ts:62-69` ("Ephemeral, like the material height").
  - The v11 W4 report dropped this exact candidate ("Material height not seeded from the project's laser material thickness … Dropped because ADR-441 Amd 2 §5 decides heights are 'not saved'").
  - The v13 Y3 report listed "Material height left at 0" under Verified clean, as "the operator's panel setting … designed to be ephemeral".
  - What is genuinely new here:
    - (a) the auto-started overlay is drawn and latches placement without the panel, so the field may never be seen (ADR-663 Amd 1 and Amd 4 postdate ADR-441 Amd 2);
    - (b) `jobSetup.laserMaterial.thicknessMm` is known and unused.
- **Severity: P2.** The output follows a labelled operator setting under an accepted "not saved" decision, which two earlier audits accepted. The decision to seed it from the job material, or to show the height on the canvas while placement is latched, belongs to the maintainer.
  - P1 is arguable on the auto-start path alone, where no input was ever offered. I would not raise it over two prior audit judgements without a maintainer ruling.
  - It is K1-P2-2's twin (P2) on the overlay side.

**K2-P3-1: CONFIRMED, P3.** On my camera, every measured case reports the negative of the true displacement at all five points. For example:

| Case | Reported | True |
|---|---|---|
| slide +1.5 x | (+1.34, 0) | (−1.50, 0) |
| pitch +0.8°, centre | (−0.14, +7.06) | (+0.11, −7.04) |
| yaw 0.8°, centre | (−2.34, +0.07) | (+2.40, −0.07) |
| roll 0.6°, rear-left | (+1.90, −1.82) | (−1.79, +1.92) |

- The only consumers are `furthestChangeMm` (differences) and `cameraMovedTurned` (differences from the centre), both sign-agnostic. The worst magnitude agrees with the truth.

### Challenges to "Verified clean"

- **Overlay = burn on a flat bed: holds.**
  - `r5-burn`: the real `emitGcode` at Absolute for front-left, rear-left, rear-right and front-right origins, at three scene points. Mapped back with `toSceneCoords`, each burns at 0.000 mm from where it was placed. This is a consistency check of the origin transform, not of the controller.
  - The overlay side is the shader's `project(Q, h)` sampling (READ), the same as `pixelToBed` at that height. W4 and the auditor measured the CPU mirror at 0 px / 0.0–0.46 mm.
- **Current Position / User Origin warned: holds.** The real `cameraPlacementStartFromWarning` gives the Amendment 1 text for both. Absolute with no `jobOrigin` gives null.
- **Crop refused vs shrink accepted: holds (READ).**
  - `camera-model-frame.ts:22-47`: another aspect is an issue, and a same-aspect size is used only after `frameRescaleVerdict` = 'resize'.
  - A `crop-and-scale` binding with a different geometry is refused (`:65-67`).
  - The moved check measures an unproved size (`moved-check.ts:178-200`) rather than placing with it.
- **Mirrored at calibration refused: holds (READ):** `target-match.ts:108`.
- **Upside-down and front-rail mounts:** not re-run. They are a calibration question, and with an exact model the overlay maths does not depend on the mount.
- **Moved check "every move of 1 mm or 0.2° and up is measured": holds when it runs** (table above). One exception: a 1.5 mm slide reads 1.40, just over `MOVED_MM`, so slides near 1 mm can read either side.
- **"A camera that sees only the bed cannot be checked":** not re-run. My view is ~45 % surround.

### New findings

**K2r-P3-1: A mirrored camera picture (a flip setting changed after calibration) can be measured as an ordinary move, so the warning gives a number up to 18 times too small.**
- **Where:**
  - `view-motion.ts:388-428` (`compareViews`): patch matches on a mirrored surround can still pass and fit a homography;
  - `camera-moved-store.ts:113-123` (the text "up to about N mm").
- **Evidence:** REPRO `r1-moved`, `r2-helpers` C1. A mirrored picture on my camera gives `measured`, worst 24.27 mm. The truth is 28.8 mm at the centre and **436.7 mm** at the corners.
  - The live start check publishes "moved 24.3 mm".
  - Job Review says "may show up to about 24.3 mm from where they burn", with the turned-camera advice (Check camera or calibrate again), which is the right remedy.
  - The auditor's geometry read the same change as weak instead.
- **Severity: P3.** It does warn, the advice is correct, and nothing is suppressed. Only the stated size misleads. A mirrored picture is unmistakable once looked at.
- **Fix direction:**
  - In `compareViews`, also match the current thumbnail mirrored and turned 180°. When either fits clearly better than the unflipped view, return a distinct "picture flipped" result that says the camera's flip or rotate setting changed.
  - Do not report a size in that case.

### Probes with no gap (new-gap search)

- **Two cameras / switching saved cameras.**
  - A switch replaces the source object, so the new camera gets its own start check (READ `install-camera-helpers.ts:125-139`).
  - A camera with no calibration of its own gets the newest model only as a `source-mismatch` issue, and the overlay refuses to draw (`camera-model-frame.ts:55-56`, `use-bed-overlay-drawing.ts:189-190`).
  - Nuance (not raised): the weak count is shared across cameras. One weak check on camera 1, then one on camera 2, publishes "changed" for camera 2. That is a false alarm in the safe direction.
- **Project reopened on another computer with a different camera.**
  - ADR-440 Amd 3 Decision 3 brings the file's calibration in when none is in use.
  - A USB camera's `sourceId` is per browser profile, and a network camera's fingerprint is an HMAC under a key created on this computer (`camera-resource-identity.ts:13,32`). So another computer's camera is `source-mismatch` or `unbound` and is refused.
  - The view reference is machine-local too, so the moved check would have nothing to compare, but the overlay never draws.
- **Overlay opacity and visibility while placing.** Hiding the picture keeps the latch (`camera-placement-latch.ts`), so the Job Review placement lines stay. In my driven run, opacity and visibility changes did not trigger a check (A2), and are not expected to.
- **Head camera live overlay and stitch.**
  - The live head-camera overlay draws the whole frame through the model at the head (`active-camera-model.ts:55-67`). Only the stitch keeps the middle 80 % (`head-camera-stitch.ts:53`).
  - On K1r's head truth, the whole frame is up to 4.75 mm off against 3.84 mm in the 80 % band. That is KNOWN K1-P3-1 (raised to P2 by K1r), reached here through the live overlay.
  - ADR-449 gives sharpness, not accuracy, as the reason for the 80 %. Not raised again.
- **Still open by READ:**
  - Z1-P3-2: no `imageOrientation` anywhere in `src/ui/camera`.
  - W4-P3-1: `usbAvailability` is read only by the panel (`CameraPreviewCard.tsx`, `UsbCameraSection.tsx`), not by the overlay or Job Review. A muted USB camera's frozen frame stays on the canvas, and no check runs on it either.

### Not verified

- The GPU shader itself and the worker path of the moved check. The worker calls the same `compareViews`; the window path was driven.
- Real lenses, lid hinges, autofocus, lighting changes and a narrow-surround camera.
- Y-rotary burns (only the overlay's Y shift was measured) and tapered parts.
- Vitest was not run.

### Repro files

All in `zz-k2r\`. Run from there with `node --max-old-space-size=380 --no-experimental-webstorage --import ./register.mjs <file>`; `r2-helpers.mts` uses `./register-stub.mjs`.
- `rr.mts`: own KB truth camera (Euler pose, zoom, mirror, 180°), scene and renderer. `r0-self.mts` is its self-test.
- `r1-moved.mts` → `r1-moved.out.jsonl`: the real `compareViews` against the true displacement (15 cases).
- `r2-helpers.mts` (+ `register-stub.mjs`, `ts-resolve-stub.mjs`, `stub-frame-source.mts`) → `r2-helpers.out.jsonl`: the real `installCameraHelpers` subscription, the moved store and the Job Review line.
- `r3-rotary.mts` → `r3-rotary.out.jsonl`: rotary part heights, real `emitGcode` on A and Z, and the Job Review advice.
- `r4-height.mts` → `r4-height.out.jsonl`: flat stock with the overlay at 0.
- `r5-burn.mts` → `r5-burn.out.jsonl`: flat-bed burn for four origins, and the Start-from texts.

```json
[
  {"id":"K2-P1-1","verdict":"confirmed","severity":"P1","note":"real installCameraHelpers driven: 1 capture at start, then pitch 0.8 deg (true 9.6 mm) through 24 s of live use + finished job -> still steady, Job Review null; Alt+C held picture -> moved 9.73 mm + Job Review line; zoom 1.30 -> weak -> unknown, silent (108.7 mm); 'once' is per camera start, weak count carries to the next start ('changed'); mirror geometry-dependent (here measured 24.3 vs 436.7 mm)"},
  {"id":"K2-P1-2","verdict":"confirmed","severity":"P1","note":"own KB camera: 80 mm tumbler top 85 mm, overlay at 0 -> X -23..+37 mm, Y +41 mm; 5 mm short -> up to 2.4 mm; real emitGcode A and Z burns 32.08 mm along the part; rotaryCameraWarning(absolute, A|Z) = null; same mechanism as K2-P2-1, P1 because Job Review certifies this path"},
  {"id":"K2-P2-1","verdict":"confirmed","severity":"P2","note":"1.5/3/6/12/18/25 mm stock at overlay 0 -> 1.30/2.62/5.27/10.69/16.26/22.96 mm; novelty corrected: W4 dropped it, Y3 listed it clean, ADR-441 Amd 2 s5 'Not saved'; new parts are the auto-start path and unused jobSetup.laserMaterial.thicknessMm; maintainer decision"},
  {"id":"K2-P3-1","verdict":"confirmed","severity":"P3","note":"reported = -true at all 5 points in all 13 measured cases; consumers sign-agnostic"},
  {"id":"K2r-P3-1","severity":"P3","area":"overlay-placement","file":"src/core/camera/model/view-motion.ts","line":388,"anchor":"ADR-663 Amd 5 'measures turns'; camera-moved-store.ts:113-123 'up to about N mm'","evidence":"REPRO","known":false,"summary":"A mirrored picture (flip setting changed after calibration) is measured as a 24.3 mm move (true 436.7 mm at the corners); it warns with the right advice but an 18x too small figure; the auditor's geometry read it as weak instead"}
]
```

Refuter counts: raised 1, refuted 0, P1 2, P2 1, P3 2, known 1
