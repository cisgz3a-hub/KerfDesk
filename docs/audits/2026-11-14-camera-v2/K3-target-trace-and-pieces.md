# K3 — Camera target, trace and pieces (camera audit v2, `target-trace-and-pieces`)

**Question.** When a camera tool turns the calibrated picture into geometry, does that geometry land on the real target, mark or piece in machine coordinates? And when it does not, what is the operator told? Five tools are in scope:
- **Camera target engrave:** Engrave target (the wizard's transient job) and Add target to canvas, then the read-back by the real calibration;
- **Trace from camera:** the whole bed, and one area;
- **Find pieces and Place selection on each piece:** the fill;
- **Fixture layout:** a fixture saved from a scan and replayed;
- **Print and Cut from the camera:** the marks.

K1 (calibration, K1-P1-1 … K1r-P3-1) and K2 (overlay, K2-P1-1 … K2-P3-1) are not raised again. Where one of them shows up here, it is listed as KNOWN. To keep them out of the K3 figures, most runs hand the app the **exact** truth camera (see Method).

**Tree.** `origin/main` @ `ba08a81af` (read-only export `j42-main`). `git diff --stat ba08a81af origin/main -- src/core/camera src/ui/camera` is empty at `3bbcd4137` (fetched 2026-11-14), so every result also stands on current main.

**Method.**
- **Own truth camera and renderer** (`truth.mts`, written for K3; nothing imported or copied from `zz-k1` / `zz-k2`):
  - lens: Kannala–Brandt (k = −0.035, 0.006, −0.001, 0), f = 1000 px, principal point (642.3, 477.8), 1280 × 960. This is the app's own lens family, so the app can be given the exact truth (`appModel`). The round trip project → ray → plane, and the app's `pixelToBed` / `projectWorldPoint` on the same parameters, agree to 2e-13 mm (`k0-selftest.mts`);
  - pose: camera 450 mm above the bed at (200, 30), looking at (200, 215) on a 400 × 400 bed. That gives 0.44–0.66 mm per pixel;
  - scene: a ray-cast of the bed (dark aluminium honeycomb, a flat grey bed, or a light wood spoilboard), with solid stock at its height. That includes the **side walls** seen from an angle, wood grain, printed or burned ink on the top faces, cast shadows on the bed and specular glare in the picture;
  - rendering: 2 × 2 samples per pixel, a [1 2 1] blur, Gaussian noise σ 1.5, 8-bit RGBA.
- **Real entry points.**
  - Pieces: `scanBedPieces` (`warpFrameToBedImage` + `findPieces`) with the lens and pose that `cameraModelForFrame` hands it. The design frame comes from `designFrame` and the sample from `pieceUnder`. The fill goes through `piecePlacements` → `applySelectionPlacements` (the body of Place selection on each piece). Partial pieces are left out as `piece-scan-store` does. The words come from `pieceSizeLabel` / `pieceNotes`.
  - Fixtures: `captureFixtureTemplate` → `fixturePlacements` → `applySelectionPlacements`, plus `fixtureContextWarnings`.
  - Print and Cut: `locatePrintCutMarks` (warp + `findMarks` + `matchMarkPair` + `orientMarkPair`), `designMarkSizeMm`, `designArtworkBoxes`, `markPairMessage`, `cameraOrientationNote`, `registrationFigures`, `solveTwoPointRegistration` and `applySimilarityProject` (what `prepare-output-snapshot.ts:127` applies at Start).
  - Trace: `buildCameraTraceImage`, the core `traceImageToColoredPaths` with the dialog's default Free preset `Line Art`, and `positionTraceOverRasterSource` (trace placement).
  - Target: `generateCameraBedTarget`, `calibrateFromBedTarget`, `cameraModelFromCalibration`, `calibrationGrade`, `rememberEngravedTarget`, `stampCanvasTargetBurn` and `assumedTarget`.
- **Burn vs truth.** Every placement was compiled with the real `emitGcode`. My parser takes the laser-on moves and maps them back through `toSceneCoords`. Every burned point, sampled every 0.5 mm, is then scored against the true top face of each piece: its margin inside, or how far outside.
- **Runs.** One Node process at a time, `--max-old-space-size=380`, each ending in `process.exit(0)`. Free memory was about 1.8 GB. No Vitest, browser, camera, network, hardware or pnpm.

## Headline

**On simple separate blanks the tools are exact.** Find pieces puts each blank's centre within 0.10–0.42 mm and its angle within 0.05°. The fill burns where it should, and the same holds for a fixture replay, Print and Cut from the camera (0.01–0.07 mm on the marks), the trace (0.39 mm worst) and the Engrave target job (0.00 mm). **What goes wrong is what Find pieces believes a piece is, and one way a calibration target can burn off its rings.**

- **K3-P1-1, touching or close blanks become one piece.** Any two pieces less than about 5 mm apart are merged: touching, 0.5, 2, 3 and 4 mm gaps all merged, while 6 mm separated. The fill centres the design on the seam: 8 coasters gave "Found 4 pieces", and each copy was cut in half across two blanks and the gap between them.
- **K3-P1-2, the design goes to the centre of the piece's rectangle, which can lie off the material.** An L-shaped offcut is entirely missed: the copy burns in the notch, up to 43 mm from the wood. A ring-shaped offcut puts the copy in its hole. A crescent burns half off.
- **K3-P1-3, glare on the bed is found as a piece.** It is ticked by default, and a copy of the design burns on the bare honeycomb, 82 mm from any blank. In centred mode nothing is said.
- **K3-P1-4, a calibration target put on the canvas burns through an active Print-and-Cut registration.** The Start that burns it is still recognised as "burned where the target put them", so the rings calibrate 11–18 mm from where they really are. The new calibration is graded "Accurate on the target; elsewhere up to about 1.6 mm off", while it is really **14 mm off at the bed centre and 22 mm at worst**.
- **K3-P2-1, cast shadows move and grow pieces.** With mild shadows (3 mm stock), a piece's centre moves 0.5–1.75 mm. With long shadows (6 mm stock, low light), it moves 4–6 mm and grows 9 mm. Without a colour reference, the shadows themselves are taken for the pieces, up to 10.5 mm off. Nothing is said.
- **K3-P2-2, centred fill never checks that the design fits the piece.** A 36 × 24 design on a 30 mm blank or a 25 mm disc burns 9.3 mm onto the bed, silently.
- **K3-P2-3, a Print-and-Cut mark that is 20–31 % covered is still accepted.** Its centre is 0.8–1.3 mm off, and the cut misses the print by 0.6–0.9 mm, while the message says "The camera found both marks".
- **K3-P3-1:** a piece within about 3 mm of the bed edge is marked "Partly out of the camera's view", though the camera sees it whole.
- **K3-P3-2:** a non-convex offcut is called "round" and listed as "⌀ 120.5 mm".

**Worst silent placement error, by tool:**
- **Find pieces / fill:** an L offcut burned 43 mm off the material, and glare 82 mm from any piece (P1). Merged blanks are cut across the seam (P1). Long shadows put it 4.3 mm off (strong case, P2).
- **Fixture layout:** replays its scan exactly, so it carries every Find pieces error into each later batch. A jig bumped 3 mm is undetectable by design; the review asks the operator to confirm the alignment.
- **Print and Cut (camera):** a partly covered mark puts the cut 0.86 mm off the print (P2). Uneven printer scaling of 1 % gives 1.63 mm, which two-point registration cannot see. KNOWN K2-P2-1 adds 1.45 mm at the default Material height.
- **Camera target engrave:** the wizard's Engrave target is exact. A canvas target under Print-and-Cut leaves a calibration 22 mm off under a "fair, up to about 1.6 mm" grade (P1).
- **Trace from camera:** 0.39 mm; KNOWN K2-P2-1 gives 2.26 mm at Material height 0.

## Tables

### Find pieces and the fill (`k1-pieces.out.jsonl`, `k1-*.png`)

Model = the exact truth, Material height = the stock's height (3 mm, or 6 mm for "shadow"). The design is a 36 × 24 mm rectangle away from every piece (centred mode), unless the case says otherwise. "dC" is the found rectangle centre against the true centre. "Burn off" is the burned length that falls on no piece, and the worst distance outside any piece.

| Case | Truth | Result | Error | Warned? | Verdict |
|---|---|---|---|---|---|
| Baseline: 80×50, 60×60 @17°, ⌀80, 90×40 @−32° on honeycomb | 4 separate | 4 found, sizes +0.4…1.2 mm (the side wall seen toward the camera) | dC 0.13–0.42, angle ≤0.01°; burn off 0, smallest margin 7.6 mm | — | clean |
| Same, design on piece 1 (sample mode) | 4 | 4, "Your design is on this piece." | burn off 0, margin 5.3 | — | clean |
| Same, Material height 0 (default) | 4 | 4 | dC 0.67–1.37 | no | KNOWN K2-P2-1 |
| Dark walnut on dark honeycomb | 3 | 3 | dC 0.09–0.25 | — | clean |
| Birch on a light wood spoilboard, no reference / reference on a piece | 3 | 3 / 3 | dC 0.29–0.77 | — | clean |
| Square blanks with a dark knot (sample mode) | 4 | 4; knots give headings to some pieces | burn off 0, margin 8.8 | — | clean |
| **Touching pair, touching discs, pairs 0.5 and 2 mm apart** | 8 | **4**, each "100.4 × 50.5 mm at 0.0°" | every copy straddles two blanks; up to 2.63 mm into the gap; margins 0.02–0.45 mm | **no**; "Found 4 pieces." | **K3-P1-1** |
| **Pairs 3 and 4 mm apart** (6 mm separates) | 6 | **4** (3 and 4 merged) | copies on the seam, 1.76 mm into the gap | **no** | **K3-P1-1** |
| Touching set + a lone coaster carrying the design (sample mode) | 9 | 5; merged ones get "Not the same size as the piece your design is on.", still ticked | copies on the seams, 6.87 mm off | flag only | K3-P1-1 |
| **L offcut 120×120 with a 80×80 notch** | 1 | 1, "round", "⌀ 120.5 mm", rectangle centre in the notch | **whole copy off the wood, 43.3 mm away** | **no** | **K3-P1-2**, K3-P3-2 |
| **Ring-shaped offcut ⌀110 / ⌀64 hole** | 1 | 1 | **whole copy in the hole** (0 mm burned on wood) | **no** | **K3-P1-2** |
| Crescent | 1 | 1, rectangle centre 6.5 mm off its area centre | 50 % of the copy off | no | K3-P1-2 |
| Triangle | 1 | 1, rectangle centre 15 mm off its area centre | copy on the wood (margin 6.4) | no | K3-P1-2 (lucky) |
| **Glare on honeycomb (3 spots, peak +120…170 grey)** | 4 | **7: 3 extra** (⌀19.6–21.4 mm), ticked | **3 copies burn on the bed, up to 82 mm from any piece** | **no** (centred); flag only in sample mode | **K3-P1-3** |
| Milder glare (peaks +100 / +80 / +60) | 4 | **5**: the +100 spot (13 × 12 mm) | 1 copy on the bed | **no** | **K3-P1-3** |
| Mild shadow (3 mm stock, shadow 2–3 mm, ×0.6) | 3 | 3, sizes +0.8…2.5 mm | dC 0.23–1.36 (no reference: shrink 2.4–3 mm, dC 1.25–1.75); 70 × 50 design 0.45 mm off a 70 mm blank | no | K3-P2-1 |
| Long shadow (6 mm stock, shadow 7–9 mm, ×0.45), reference on the bed | 3 | 3, sizes **+6…+10 mm** | **dC 4.3–6.3**; 70 × 50 design **4.29 mm off** | **no** | **K3-P2-1** |
| Same, no reference (luma split) | 3 | 3 "pieces" that are **the shadows** | 10.5 mm off | **no** | K3-P2-1 |
| **Design larger than the piece** (36×24 on 30×30 and ⌀25; 70×40 on 60×60 / ⌀80) | 3 / 4 | found right (dC ≤0.4) | **9.32 mm** / 5.14 mm onto the bed | **no** (centred mode has no fit check) | **K3-P2-2** |
| Pieces at the bed edges | 5 | overhang flagged partial and left out (right); **a piece 2 mm from the front edge, fully in view, also "Partly out of the camera's view"**, width +3.4 mm | — | wrong reason | K3-P3-1 |

### Fixture layout (`k5-fixture.out.jsonl`)

| Case | Result | Burn vs truth | Warned? | Verdict |
|---|---|---|---|---|
| Fixture saved from the baseline scan, replayed (centred and sample) | 4 slots; placements equal to the scan's | off 0, margin 7.58 / 5.33 (the same as Find pieces) | none (right) | clean; inherits K3-P1-1…3 |
| Replay at Material height 0 | — | — | "The current surface height … differ from the recorded fixture. Recheck at the actual stock height." | clean |
| No live camera | — | — | "The current camera context is unavailable. Saved geometry is historical placement intent." | clean |
| Jig bumped 3 mm right, 2 mm forward since saving | placed at the saved slots | 3.6 mm off centre (margin 7.58 → 4.29) | only the review tick "I reviewed … actual alignment" | by design (ADR: historical intent, operator verifies) |

### Print and Cut from the camera (`k2-marks.out.jsonl`, `k2-*.png`)

A4 page with two 6 mm rings 10 mm in from opposite corners, 335.9 mm apart. A blue logo block is the artwork, and the cut is a rectangle 3 mm round it. The sheet lies 15 mm right and 12 mm back, turned 2.5°. "Cut" is the worst distance from the burned cut to the true outline round the printed logo.

| Case | Result | Mark error | Cut / page error | Warned? | Verdict |
|---|---|---|---|---|---|
| Rings / crosses 8 mm / dots 5 mm | found, orientation "print" | 0.02–0.04 | cut 0.01–0.03 | — | clean |
| Upside down (180°) | found, "print-flipped" | 0.07 | 0.06 | turn-near-180 note to confirm (right) | clean |
| Turned 90° | found | 0.03 | 0.02 | — | clean |
| Card 3 mm, Material height 3 | found | 0.04 | 0.03 | — | clean |
| Card 3 mm, Material height 0 (default) | found, scale +0.66 % | 2.24 | **1.45** | no; dialog says "at the material height set in the Camera panel" | KNOWN K2-P2-1 |
| Printer 0.5 % uneven (x +0.5, y −0.5) | found, scale −0.20 % | 0.06 | cut 0.43, page 1.66 | no | two-point limit (not raised) |
| Printer 1 % uneven | found | 0.11 | cut 0.96, logo 1.63, page 3.47 | no | two-point limit |
| Printer skew 0.3° | found | 0.07 | cut 0.40, page 0.90 | no | two-point limit |
| **White tape over 20–31 % of a ring (side)** | **found** | **0.81–1.15** | **cut 0.60–0.86**, page 1.2 | **no**: "The camera found both marks …" | **K3-P2-3** |
| **Tape over 20–30 % (top)** | **found** | **0.94–1.28** | **cut 0.63–0.86** | **no** | **K3-P2-3** |
| Tape over a corner 35–45 % | found | 0.39–0.64 | cut 0.29–0.48 | no | K3-P2-3 (small) |
| Cross, 20–30 % of an arm covered | found | 0.37–0.51 | cut 0.28–0.39 | no | within reason |
| Tape over 35–50 % (side) | refused: "found 1 mark-like shape, but no two are 335.9 mm apart …" | — | — | yes | clean |
| Dark magnet touching / over a ring | refused, same message | — | — | yes | clean |
| Toner speck 5 mm from a ring | found | 0.03 | 0.03 | — | clean |

### Camera target engrave (`k3-target.out.jsonl`, `k3-*.png`)

Default sheet: 300 × 200, 5 mm margin, 10 mm rings, target area (55, 105, 290 × 190), 35 rings.

| Case | Result | Error | Warned / told | Verdict |
|---|---|---|---|---|
| Engrave target: the pattern through `emitGcode` at Absolute | 35/35 rings burned | ring centre vs layout 0.00 mm | — | clean |
| Read-back: burned rings rendered on 3 mm plywood → real calibration | 35/35, rms 0.04, max 0.07; **good** | true: centre 0.04, target ≤0.08, whole bed ≤0.45 | estimate "up to about 1.3 mm … bottom-right" (cautious here; K1-P1-1 is the opposite case) | clean |
| **Add target to canvas + an active Print-and-Cut registration (sheet 12 mm right, 8 mm back, 1.5°), Start at Absolute** | the Start applies the registration: rings burn **11.0–18.0 mm** from the layout; `stampCanvasTargetBurn` → **burnSeen: true**; `assumedTarget` → 'engraved', **no refusal** | — | none in Job Review (registration ordinary, Start from Absolute) | **K3-P1-4** |
| Read-back of those rings with the remembered layout | 35/35, rms 0.06, max 0.11; **fair**, "Accurate on the target; elsewhere on the bed up to about 1.6 mm off" | **true: 14.4 mm at the bed centre, 18.6 on the target, 21.9 worst** | — | **K3-P1-4** |

### Trace from camera (`k4-trace.out.jsonl`, `k4-trace.png`)

A star, a ring, a bar and a block drawn in black on a 3 mm white sheet. The Line Art preset was used, and only loops on the sheet are scored (the bed around the sheet traces as dark).

| Case | Bed image | Traced → truth (mean / worst) | Truth → traced worst | Warned? | Verdict |
|---|---|---|---|---|---|
| Whole bed, Material height 3 | 1600 × 1600 at 4 px/mm, bounds 0..400 | 0.05 / 0.39 mm | 0.30 mm | — | clean |
| Height-area region (90,110 230 × 110), 8 px/mm | 1840 × 880 | 0.04 / 0.33 | 0.35 | — | clean |
| Whole bed, Material height 0 (default) | — | 1.02 / **2.26** | 1.88 | no | KNOWN K2-P2-1 |

## Findings

### K3-P1-1 — Blanks closer than about 5 mm are found as one piece, and the fill centres the design on the seam

- **Where:**
  - `src/core/camera/pieces/piece-image.ts:20,29`: the colour is blurred twice with a 2.5 mm box, so gaps up to about 5 mm never cross the split;
  - `src/core/camera/pieces/find-pieces.ts:53,68`: the mask is closed by 1 mm, which bridges gaps up to 2 mm;
  - `piece-components.ts` (4-connected groups): no step separates touching objects;
  - `src/core/camera/pieces/piece-placements.ts:72-81`: the copy goes on the merged rectangle's centre.
- **Anchor:**
  - ADR-442: "lists every piece"; "a batch of blanks: coasters, tags or offcuts laid on the bed by hand";
  - `scan-bed-pieces.ts` header: "places them to a fraction of a millimetre";
  - task rule: artwork placed off the real piece with no warning is P1-class.
- **Evidence:**
  - **REPRO** with `k1-pieces.mts touching` and `gaps`. 8 coasters and discs (touching, 0.5 mm and 2 mm apart) gave "Found 4 pieces." Each merged piece measured 100.3–102.5 × 50.3–51.0 mm. Every copy of the design was split across two blanks, with 0.02–0.45 mm margins and up to 2.63 mm burned into the gap.
  - Gaps of 3 and 4 mm merged too, and 6 mm separated.
  - **READ:** no test covers close pieces (`find-pieces.test.ts` uses well-separated blanks).
- **Scenario:** 12 coasters packed tightly on the honeycomb, the design selected beside them, then Find pieces and Place. Six "pieces" are found, and each copy is cut across two coasters: 12 blanks are ruined.
- **Severity:** P1. The job is ruined, and the only cue is the count and the shape of the outline drawn on the canvas, which is not a warning.
- **Announced?**
  - Centred mode: no.
  - Sample mode: merged pieces get the soft note "Not the same size as the piece your design is on." and stay ticked.
- **Novelty:** new; no earlier audit covered close pieces.
- **Fix direction:**
  - Split by edges, not only by a blurred colour. Keep the blur for the honeycomb, but find the boundary on the unblurred picture, or use a distance-transform / watershed split of the mask.
  - Flag a piece whose outline is much less convex than its hull, or that is twice the size of its neighbours.
  - In centred mode, compare each piece with the others and say when one looks like two.

### K3-P1-2 — The design goes on the centre of each piece's rectangle, which for an offcut can lie off the material: an L in its notch, a ring frame in its hole

- **Where:** `src/core/camera/pieces/piece-placements.ts:72-81` (`placementOn` with no sample: `piece.rect.centre - design.centre`). Nothing checks the landed design against `piece.outline`, and holes are dropped (`find-pieces.ts` "Outer outline").
- **Anchor:** ADR-442 lists "offcuts" among the pieces this is for ("blanks, offcuts, coasters"). The fill promises "the design is centred on each piece".
- **Evidence:** **REPRO** with `k1-pieces.mts offcut`:
  - L offcut: the copy lands wholly in the notch, 0 mm on wood, up to 43.3 mm from it;
  - ring-frame offcut: the copy lands wholly in the hole and burns the bed through it;
  - crescent: about half the copy is off (60.7 of 120 mm burned on wood);
  - triangle: the rectangle centre is 15 mm from the area centre.
  - The panel words are "Found 4 pieces. The design is centred on each piece …" and each piece's move. No note.
- **Scenario:** offcut reuse, the use the ADR names. Several L-shaped or frame-shaped scraps, a logo to put on each: the logo burns on the bed beside or inside the scrap.
- **Severity:** P1, artwork off the material with no warning.
- **Announced?** No.
- **Novelty:** new.
- **Fix direction:**
  - Place on the largest inscribed rectangle or circle of the outline (holes included), or the pole of inaccessibility, not the bounding rectangle's centre.
  - Check that the moved design's box lies inside the outline minus a margin, and say per piece when it does not ("does not fit this piece"). That check also covers K3-P2-2.

### K3-P1-3 — Glare on the bed is found as a piece, ticked by default, and a copy burns on the bare bed

- **Where:**
  - `src/core/camera/pieces/piece-mask.ts` (one Otsu split by colour distance or brightness);
  - `find-pieces.ts:51` (`MIN_PIECE_AREA_MM2` = 100 is the only guard);
  - `piece-scan-store.ts:58` (only partial pieces start left out).
- **Anchor:** the task rule: an extra piece that burns on the bed is P1-class. ADR-442 says "nothing guesses what a piece is", but every detection is ticked.
- **Evidence:** **REPRO** with `k1-pieces.mts glare` and `glare-mild`:
  - three highlights on the aluminium honeycomb (peaks +120 to +170 grey) were found as three extra pieces, ⌀19.6–21.4 mm. Each got a copy of the design, 360 mm of burn on the bed, up to 82 mm from any blank;
  - one highlight at +100 (13 × 12 mm) is enough.
  - In sample mode they get "Not the same size as the piece your design is on." and stay ticked. In centred mode they get nothing.
- **Scenario:** a ring light or a window reflects off the honeycomb. "Found 5 pieces" for 4 blanks; Place; Start burns the logo onto the bed.
- **Severity:** P1.
- **Announced?** No (centred mode); a soft flag (sample mode).
- **Novelty:** new.
- **Fix direction:**
  - Reject components that are much brighter than the bed but have no straight or convex edge structure, or whose colour does not match the other pieces or the reference.
  - Or start pieces unticked when they differ strongly from the majority (size and colour), with the reason shown.
  - At least, say when a piece is far smaller than the rest.

### K3-P1-4 — A calibration target put on the canvas burns through an active Print-and-Cut registration, yet its Start is recorded as "burned where the target put them", so the calibration is 14–22 mm off under a "fair, about 1.6 mm" grade

- **Where:**
  - `src/ui/camera/calibrate/calibration-actions.ts:169-190`: `addCalibrationTargetToCanvas` replaces only the scene; `generated-scene-actions.ts:38` keeps `project.printAndCutTargets`;
  - `src/ui/laser/start-job-source.ts:96` → `print-cut-output.ts:15-29`: an ordinary Start passes the session's registration;
  - `src/io/gcode/prepare-output-snapshot.ts:127`: `applySimilarityProject` moves every object, the rings included;
  - `src/ui/camera/calibrate/canvas-target-burn.ts:45-75,85-100`: `stampCanvasTargetBurn` checks the **unregistered** candidate scene (`frame-trace-flow.ts:216`, `project: context.app.project`) for unmoved rings at Absolute, and sets `burnSeen: true`.
- **Anchor:**
  - ADR-441 Amendment 10 / Y3-P1-2: only a burn seen at Absolute Coordinates, where the target put the rings, is calibrated on;
  - `canvas-target-burn.ts` header: "every ring of the remembered layout, unmoved, burned at Absolute Coordinates".
- **Evidence:** **REPRO** with `k3-target.mts` case B. A registration was solved for a sheet 12 mm right, 8 mm back and turned 1.5°. The real `applySimilarityProject` + `emitGcode` burned the 35 rings 11.0–18.0 mm from the layout. The real `stampCanvasTargetBurn` returned true (`burnSeen: true`), and `assumedTarget` returned source 'engraved' with no refusal. The rings were rendered where they burned and calibrated with the remembered layout: 35/35, rms 0.06 mm, graded **fair**, "Accurate on the target; elsewhere on the bed up to about 1.6 mm off". The true error was 14.4 mm at the bed centre, 18.6 on the target and 21.9 worst. Job Review adds nothing: `collectPrintCutFrameWarnings` speaks only of an unusual scale or turn, or a Start from other than Absolute. **READ** for the Start path.
- **Scenario:** an operator uses Print and Cut (Labs) in a project, then recalibrates the camera from the same project with Add target to canvas → Frame → Start. Every camera placement afterwards (overlay, trace, pieces, marks) is 14–22 mm off.
- **Severity:** P1. It harms every later job, under a grade that says otherwise. The path is narrow (Labs Print and Cut with a captured registration), but there is no reach clause.
- **Announced?** No. The Frame traces the moved rectangle, which is not a warning.
- **Novelty:** new; a sibling of Y3-P1-2 (canvas target burned from another Start-from mode).
- **Fix direction:**
  - Have `stampCanvasTargetBurn` refuse (record a `burnedFrom`-style reason) when the Start carried a Print-and-Cut registration, or any transform between the scene and the program.
  - Or have `addCalibrationTargetToCanvas` clear `printAndCutTargets` in the same undo step, as it already sets Start from to Absolute.
  - Add a test for each.

### K3-P2-1 — Cast shadows move and grow the pieces, silently

- **Where:** `piece-mask.ts` (colour distance to a reference on the bed, or a brightness split) and `find-pieces.ts:68`: a shadow next to a piece joins it, or with no reference becomes the piece.
- **Anchor:** "places them to a fraction of a millimetre" (`scan-bed-pieces.ts` header).
- **Evidence:** **REPRO** with `k1-pieces.mts shadow-mild`, `shadow-mild-noref`, `shadow` and `shadow-noref`:
  - mild shadows (3 mm stock, 2–3 mm shadow at ×0.6): the centre is 0.23–1.36 mm off and sizes grow 0.8–2.5 mm; with no reference, pieces shrink 2.4–3 mm and the centre is 1.25–1.75 mm off;
  - long shadows (6 mm stock, 7–9 mm at ×0.45): the centre is 4.3–6.3 mm off and sizes grow 6–10 mm, so a 70 × 50 design on 80 × 60 blanks burns 4.29 mm off;
  - long shadows with no reference: the shadows themselves are the pieces, 10.5 mm off.
- **Severity:** P2. Mild shadows cost 1–2 mm of a typical margin. The long-shadow case is P1-class, with harsher lighting.
- **Announced?** No.
- **Novelty:** new.
- **Fix direction:** treat the darker-than-bed side as background when a brighter side exists (three-class split), or find edges on the unblurred picture. Say when a piece's outline has a dark band along one side.

### K3-P2-2 — In centred mode the fill never checks that the design fits the piece

- **Where:** `src/ui/camera/pieces/piece-label.ts:22-35` (`pieceNotes`): the only size note compares pieces with the sample, and only in sample mode. `piece-placements.ts:72-81` has no fit check.
- **Anchor:** ADR-442 (the panel shows each piece's size and move "and anything the operator should look at before placing"; `piece-label.ts` header).
- **Evidence:** **REPRO** with `k1-pieces.mts small` and `DESIGN=70x40 baseline`. A 36 × 24 design centred on a 30 mm square and a ⌀25 disc burned 9.32 mm onto the bed. 70 × 40 on 60 × 60 and ⌀80 burned 5.14 mm off. No note.
- **Severity:** P2. The sizes are listed, so the harm is limited, but the off-piece burn is silent.
- **Announced?** No.
- **Novelty:** new.
- **Fix direction:** the inside-the-outline check from K3-P1-2, with a per-piece note "the design is larger than this piece".

### K3-P2-3 — A partly covered Print-and-Cut mark is accepted with its centre up to 1.3 mm off, and the message says both marks were found

- **Where:**
  - `src/core/camera/marks/find-marks.ts:41,43,99,147`: aspect ≤ 1.4 and off-centre ≤ 0.12 × size let a 20–31 % covered ring through, and `weightedCentre` takes the mean of what is left;
  - `print-cut-camera.ts:75`: size window 0.6–1.6 × the design mark;
  - `markPairMessage:191`.
- **Anchor:** ADR-443: the camera fills the same two-point registration a head capture does (jogging by eye is about 0.1 mm, `registration-check.ts`).
- **Evidence:** **REPRO** with `SWEEP=1 k2-marks.mts`. White tape over 20–31 % of a 6 mm ring: the mark is 0.81–1.28 mm off and the cut 0.60–0.86 mm off the print. The message reads "The camera found both marks … print scale +0.12…+0.31 %". Beyond 35 % covered, it is refused with a clear message.
- **Severity:** P2 (under 1 mm on the cut).
- **Announced?** No.
- **Novelty:** new.
- **Fix direction:**
  - Check the found mark against the design mark's size (both sides within about 10 %) and its shape (ring hole centred).
  - Report each mark's own fit, and ask for confirmation when it is poor.

### K3-P3-1 — A piece near the bed edge is "Partly out of the camera's view" though the camera sees it whole

- **Where:** `scan-bed-pieces.ts:40` crops the bed image to the bed, and `piece-components.ts:124` marks anything touching the image edge as partial. The 5 mm blur spreads a piece 2 mm from the edge onto it.
- **Evidence:** **REPRO** (`edges`): a 70 × 40 piece 2 mm from the front edge, fully in view, is flagged partial and left out with "Partly out of the camera's view, so its centre may be off." Its width reads +3.4 mm.
- **Severity:** P3. It is the safe direction, but the reason is wrong and the operator re-ticks it.
- **Fix direction:** picture a margin beyond the bed (the camera sees it), or test partial on the unblurred mask.

### K3-P3-2 — A non-convex offcut is called "round" and listed by a diameter

- **Where:** `find-pieces.ts:104-107` (`shapeOf`): a "squarish" rectangle filled under 86 % is round.
- **Evidence:** **REPRO**: the L offcut is listed as "⌀ 120.5 mm". Round pieces also take no turn in sample mode (`relativeRotationDeg`).
- **Severity:** P3, wrong words.
- **Fix direction:** call a piece round only when its outline is close to its fitted circle.

## KNOWN status

- **K2-P2-1 (Material height starts at 0):** reproduces in every K3 tool, because they all warp at the Camera panel's Material height:
  - pieces: centre 0.67–1.37 mm off on 3 mm stock;
  - Print and Cut: cut 1.45 mm off on 3 mm card (the dialog does say "at the material height set in the Camera panel");
  - trace: 2.26 mm worst.
- **K1-P1-1:** not exercised. The ideal model was used on purpose. On my Kannala–Brandt truth the target read-back estimate was cautious (1.3 mm said, 0.45 mm true).
- **K1-P2-2 / height-only calibrations:** not re-run.
- **Y3-P1-2** (canvas target from another Start-from mode): fixed; K3-P1-4 is a new way around it.

## Verified clean

- **Find pieces on separate blanks:**
  - rectangles, squares, discs and turned blanks on dark honeycomb, dark walnut and low-contrast birch, with and without a reference: centre 0.09–0.77 mm, angle ≤0.08°;
  - the fill (centred and sample) burns inside every blank (smallest margin 5.3–18 mm), through the real `applySelectionPlacements` and `emitGcode`;
  - partial pieces start left out;
  - the 0.4–1.2 mm growth toward the camera is the stock's visible side wall.
- **The bed model is shared:** pieces, marks and trace all go through `warpFrameToBedImage`, which K2 measured against the overlay at 0.02–0.21 mm.
- **Fixture layout:** replays the scan's placements exactly (same margins), warns on a changed surface height or a missing camera context, and needs the alignment-reviewed tick.
- **Print and Cut from the camera:**
  - rings, crosses and dots: 0.01–0.07 mm on the marks, cut ≤0.06 mm;
  - an upside-down sheet is oriented by the print, and a 90° turn read right;
  - a covered mark beyond 35 %, a magnet beside a mark, or a mark out of clear paper is refused with a clear message;
  - a toner speck nearby is harmless.
- **Engrave target:** the wizard's transient job burns every ring at its layout position (0.00 mm), passes no registration, and reads back at 0.04 mm rms (true whole-bed ≤0.45 mm).
- **Trace from camera:** 0.05 mm mean, 0.39 mm worst (whole bed at 4 px/mm and an area at 8 px/mm); the raster bounds equal the pictured bed area.

## Not verified

- The rendered panels and canvas outlines (no browser), Vitest (memory), real cameras and real glare.
- Pieces with a calibrated (not exact) model: K2 already measured the shared warp.
- Head-camera stitches in these tools (K1/H6 area).
- Height areas inside Find pieces.
- Colour-layer and photo trace presets.
- Fixture qualification observations.
- The nudge ring.
- Print and Cut with a third look-alike pair of marks (the message names other pairs).

## Repro files

All in `…\scratchpad\zz-k3\`. Run with `node --max-old-space-size=380 --no-experimental-webstorage --import ./register.mjs <file> [args]`.

- `truth.mts`: truth camera (Kannala–Brandt), exact app model, ray-cast renderer, PNG writer.
- `k0-selftest.mts`: truth round trip and agreement with the app model.
- `k3lib.mts`: scene objects, the G-code burn parser and piece scoring.
- `k1-pieces.mts <scenario> [MatH]`, with env `DESIGN=WxH`, `FIXTURE=1` and `SAVE=1`:
  - scenarios: baseline, baseline-sample, touching, touching-sample, gaps, offcut, edges, lowcontrast(-ref), darkwood, shadow(-noref), shadow-mild(-noref), glare, glare-mild, glare-sample, small, knot;
  - output: `k1-pieces.out.jsonl`, `k5-fixture.out.jsonl`, `k1-*.png`; summary with `node sum1.cjs k1-pieces.out.jsonl`.
- `k2-marks.mts` (env `SWEEP=1` for the cover sweep): `k2-marks.out.jsonl`.
- `k3-target.mts`: `k3-target.out.jsonl`, `k3-A-readback.png`, `k3-B-readback.png`.
- `k4-trace.mts`: `k4-trace.out.jsonl`.

## Counts

| Raised | P1 | P2 | P3 | Known |
|---|---|---|---|---|
| 9 | 4 (K3-P1-1, -2, -3, -4) | 3 (K3-P2-1, -2, -3) | 2 (K3-P3-1, -2) | 1 reproduced (K2-P2-1, in pieces, marks and trace); K1-P1-1 not exercised |

## Refuter (2026-11-14)

**Tree and harness.** Same read-only export `j42-main` (`origin/main` @ `ba08a81af`). `git diff --stat ba08a81af origin/main -- src/core/camera src/ui/camera` at `000e245f0` shows one commit, `a3bb7c100` (K1 fix, ADR-441 Amd 11): `extrapolation-estimate*.ts`, `extrapolation-fixtures.ts` and `calibration-result.ts` (the off-target estimate and its "larger sheet" advice). It touches no pieces, marks, trace, Start or canvas-target code. It changes only the wording of the grade quoted in K3-P1-4, and cannot catch that error (see below). Every result here stands on current main.

My files are in `zz-k3r\`. I read `k3-target.mts` for API shape only. Nothing imports a `zz-k3` file, and no camera is used. My method differs from the auditor's on purpose:
- **Pieces (`rlib.mts`, `rp.mts`).** My own **top-down bed renderer**, drawn straight in bed mm at the app's 2 px/mm on a 400 × 300 bed (800 × 600 px), with 3 × 3 supersampling and σ 2 noise. There is no lens and no warp, so this tests the detector and the fill alone; K2 has already measured the shared warp.
  - Beds: a real **hexagonal** ¼" (6.35 mm) honeycomb with bright foil walls and dark cells, flat grey, and a light MDF spoilboard with low-frequency blotches, optionally scorched (old burns, test grids, kerf lines).
  - Pieces: polygons with holes, plywood grain. Glare is an additive Gaussian. A shadow is the piece's outline offset and multiplied by k.
  - App code: the real `findPieces` (reference = design centre, as `use-find-pieces.ts:70` passes), `pieceUnder`, `piecePlacements`, the real `placedObject` (`array-selection-copies.ts`) and `applyTransform`, then `pieceNotes` / `pieceSizeLabel`. Partial pieces are left out as the store does.
  - Scoring is analytic: each copy's rectangle is sampled every 0.5 mm against the true polygons (share off the wood, worst distance off the wood, and how many true pieces it touches). No G-code.
- **Canvas target (`rt.mts`).** The **real app store**, driven as an operator would:
  - `setPrintAndCutTargets`, Labs `setFeature('printAndCut', true)`, two camera captures in the real `usePrintCutSessionStore` (real epoch and `nativeBedCaptureFrameKey`);
  - then the real `addCalibrationTargetToCanvas(DEFAULT_CALIBRATION_SETTINGS)`;
  - then the real `currentPrintCutOutputRegistration` (what `start-job-source.ts:96` passes), `applySimilarityProject`, the real Job Review lines (`collectPrintCutFrameWarnings`, `cameraTargetStartFromWarning`) and the real `stampCanvasTargetBurn` / `rememberedEngravedTarget`.
- **Marks (`rm.mts`).** My own top-down 6 mm printed ring (1 mm line) at the app's 4 px/mm, covered by white tape from a side, the top or a corner, through the real `findMarks` with the app's 0.6–1.6 × size window.
- **Runs.** One Node process at a time, `--max-old-space-size=380`, each ending in `process.exit(0)`. About 2.6 GB free. No Vitest, browser, camera, network, hardware or pnpm.

### Verdicts

| Finding | Verdict | Severity | Evidence (own) |
|---|---|---|---|
| K3-P1-1 | **CONFIRMED.** Threshold measured: top-down, square-on, 3.5 mm merges and 4.0 separates; at 45° 4 mm merges and 5 separates. A packed tray reads as **one** piece | **P1** | `rp gaps1/2/3`, `rot45`, `coasters` |
| K3-P1-2 | **CONFIRMED**, worse than reported: the L, the ring and a picture-frame offcut all burn **100 % off the wood**, 30–32 mm out | **P1** | `rp offcut` |
| K3-P1-3 | **CONFIRMED** with my own glare model; the only guard is the 100 mm² floor. Sharp highlights (σ ≤ 4 mm) are dropped; broad ones are not | **P1** | `rp glare*` |
| K3-P1-4 | **CONFIRMED through the real store**: Add target to canvas keeps `printAndCutTargets`, the Start applies the registration, Job Review is silent, and the stamp sets `burnSeen: true`. **Labs only**: with Labs off, or no valid captures, the Start is refused | **P1** | `rt` |
| K3-P2-1 | **CONFIRMED, bed-dependent.** Negligible on dark honeycomb (0.1–0.5 mm); **4.1–6.0 mm** off-centre on grey or MDF beds with long shadows; on MDF, shadows tip the split so bare-bed patches become pieces (copies 32.8 mm off the wood) | **P1 (raised)** | `rp shadow` (BED=honeycomb/grey/mdf) |
| K3-P2-2 | **CONFIRMED** (36 × 24 on ⌀25: 9.2 mm onto the bed; 70 × 40 on 30 □: 20.6 mm) | **P2 (kept, not P1)** | `rp small` |
| K3-P2-3 | **CONFIRMED** at the detector: 10–30 % covered → mark centre 0.27–1.09 mm off, accepted | **P2** | `rm` |
| K3-P3-1 | **CONFIRMED** without any side wall: 0.5, 1 and 2 mm from the edge → partial; 3 mm → not | **P3** | `rp edges` |
| K3-P3-2 | **CONFIRMED**: the L reads "⌀ 120.5 mm", shape round | **P3** | `rp offcut` |

**K3-P1-1: CONFIRMED, P1.**
- **Threshold.** Pairs of 50 × 50 blanks on hex honeycomb (`rp.out.jsonl`, `perGap`). It is the same with the reference on the bed and with no reference.

  | Gap (mm) | 0 | 0.5 | 1 | 2 | 3 | 3.5 | 4 | 4.5 | 5 | 6 | 7 |
  |---|---|---|---|---|---|---|---|---|---|---|---|
  | square-on | one, 100.2 long | one, 100.9 | one, 101.4 | one, 102.2 | one, 103.2 | one, 103.7 | two | two | two | two | two |
  | turned 45° | — | — | — | one | one | one | **one**, 104.3 | — | two | two | two (8) |

  On a flat grey bed, 4.5 mm and above separate as well.
- **Mechanism (READ, matches the numbers).**
  - Two box passes of radius 2.5 mm (`piece-image.ts:20,29-31`) make a triangle reaching 5 mm. At the middle of a gap g, the bed's share of the blurred colour is g/5 − g²/100: 0.36 at 2 mm, 0.51 at 3 mm, 0.64 at 4 mm.
  - The split sits halfway between the two sides' means (`piece-mask.ts:107-125`). So below about 3 mm the gap stays on the piece side.
  - The 1 mm close (`find-pieces.ts:53`, `piece-components.ts:79-81`) then bridges the thin band left at 3–3.5 mm.
  - The separable box blur reaches further along a diagonal, which is why a 45° gap needs about 1 mm more.
  - The auditor's "4 mm merged" in a camera view fits the stock's visible side walls narrowing the gap. **"Closer than about 4–5 mm"** is the right wording.
- **Fill (centred mode).** All 6 copies straddle two blanks, up to 1.64 mm into the gap, with no note.
- **Packed layouts.**
  - 12 discs of ⌀90 mm with 1.5 mm gaps → "Found 1 piece", one copy across two discs (3.1 mm into a gap).
  - 15 tiles of 60 × 60 with 1 mm gaps → one piece, one copy.
- **Sample mode.** The design on the left blank of a merged pair puts each copy on one blank of each other pair (0 mm off), so half the blanks get nothing. Only the widest merged piece gets "Not the same size …".
- **Corrections.** The threshold is 3.5–4 mm top-down and about 4–5 mm on turned pieces or in a camera view, not "about 5". The packed-tray case ("Found 1 piece") is more conspicuous than the paired case. The paired case ("Found 4" for 8, each copy on a seam) is the silent harm.
- **Severity: P1 stands.** No note says a piece looks like two. The count and the outline are visible results, not warnings (METHOD §3, G6 clarification).

**K3-P1-2: CONFIRMED, P1.** Centred mode, 36 × 24 design:

| Offcut | Found as | Copy |
|---|---|---|
| L 120 × 120, 40 mm legs | "⌀ 120.5 mm", round | **100 % off the wood**, 32.1 mm out (in the notch) |
| Ring ⌀110 / ⌀64 hole | "⌀ 110.2 mm" | **100 % in the hole**, 31.9 mm from the wood |
| Picture-frame offcut 140 × 100, 20 mm sides | "140.6 × 100.5 mm at 0.0°" | **100 % in the hole**, 29.9 mm |
| Same three, design 20 × 14 | — | still 100 % off the wood, 27–32 mm |
| Convex trapezoid offcut (control) | 158.6 × 50.0 | on the wood |

- READ: `placementOn` (`piece-placements.ts:77-84`) uses `piece.rect.centre` and never `outline` or `centroid`; holes are dropped by `outerOutline` (`piece-components.ts:166-193`).
- The frame offcut is a new case beyond the auditor's: a rectangle the panel lists with its ordinary size, so not even the "round" label hints at it.
- **Severity: P1 stands.** The app holds the outline that shows its centre is off the material, and says nothing.

**K3-P1-3: CONFIRMED, P1.**
- **Setup.** Four plywood blanks on hex honeycomb, plus a sweep of Gaussian highlights, each alone on the bed. A spot is listed as a piece in the scan, ticked:

  | Peak (grey) / σ (mm) | 40–100 / 2.5 | 60–80 / 4 | 120–170 / 1.5 | streak 90 / 2×16 | 60 / 6 | 80 / 6 | **100 / 6** | 60 / 8 | **80 / 8** | **100 / 8** | 50 / 12 | **70 / 12** | **130 / 5** |
  |---|---|---|---|---|---|---|---|---|---|---|---|---|---|
  | Reference on the bed | no | no | no | no | no | no | **yes 11.7 mm** | no | **yes 12.3** | **yes 16.4** | no | **yes 15.2** | **yes 12.0** |
  | No reference | no | no | no | no | no | no | yes 10.8 | no | yes 11.4 | yes 15.7 | no | yes 13.5 | yes 11.7 |
  | Sample (reference on a blank) | no | no | no | no | no | no | no | no | no | yes 14.5 | no | yes 11.5 | yes 11.3 |

- **Size.** The found "pieces" are 108–227 mm², just over `MIN_PIECE_AREA_MM2` = 100 (`find-pieces.ts:51`). There is no colour, edge or consistency test (`piece-mask.ts:27-39` is one two-class split).
- **Burn.** Every glare copy burns 100 % on the bare bed, **124–172 mm** from any blank, with no note in centred mode.
- **Correction.** A sharp highlight (σ ≤ 4 mm, under about 9 mm across) is never found, because the 5 mm blur flattens it. It takes a broad haze (σ ≥ 5 mm at +100 to +130, or σ 12 mm at only +70). That is still an ordinary lamp or window reflection on aluminium.
- **Severity: P1 stands.**

**K3-P1-4: CONFIRMED through the real store, P1** (`rt.out.jsonl`).

| Step (real code) | Result |
|---|---|
| Labs Print and Cut on, `setPrintAndCutTargets`, two camera captures (sheet 9 mm right, 6 mm forward, 1.0°) | registration valid |
| `addCalibrationTargetToCanvas(DEFAULT_CALIBRATION_SETTINGS)` | 35 rings; **`printAndCutTargets` kept**; Start from set to Absolute; `canvasTargetInScene` true |
| `currentPrintCutOutputRegistration(project)` (the Start's input, `start-job-source.ts:96`) | **applied**: turn 1°, translation (12.5, 2.5) |
| `applySimilarityProject` (`prepare-output-snapshot.ts:127`) | rings compile **8.6–13.2 mm** from their layout, turned 1° |
| Job Review: `collectPrintCutFrameWarnings(…, absolute)`, `cameraTargetStartFromWarning(absolute)` | **[] and null** |
| `stampCanvasTargetBurn` with the app's (unregistered) project, as `frame-trace-flow.ts:216` builds the candidate | **true; `burnSeen: true`**, no `burnedFrom` |
| `assumedTarget` (READ `assumed-target.ts:169-174`) | `burnSeen` true → no refusal |
| Control: Labs off | Start **refused** ("Print-and-Cut registration is not valid …") |
| Control: captures cleared | Start **refused** |

- **The calibration error, my own argument (not the auditor's render).** A rigid move of a flat target within its own plane is, in one photo, exactly a move of the camera the other way. The pose fit therefore absorbs it with **no residual**, and every bed point is off by |T(p) − p|.
  - For my transform that is **10.8 mm at the bed centre and 15.7 mm worst**.
  - No residual-based grade can see it, before or after `a3bb7c100`. The auditor's "fair, about 1.6 mm" is the noise grade of a perfect fit.
- **Wizard Engrave target is not affected (READ).** `transient-camera-job.ts:56-67` calls `prepareStartJobSnapshot` with no `registration`, though `...project` carries the targets. That supports the auditor's 0.00 mm.
- **Reach.** Only with Labs Print and Cut on and a valid capture pair from this session, at the same trust epoch and frame key. Otherwise the Start refuses, which is safe. METHOD has no reach clause, so it stays **P1**: the output is wrong and no warning reaches the operator.
- **Side note (not counted).** With Labs off and targets still saved in the project, the canvas target's Start is refused with a Print-and-Cut message that says nothing about the target. The auditor's second fix (clear `printAndCutTargets` in `addCalibrationTargetToCanvas`) fixes both.

**K3-P2-1: CONFIRMED; severity raised to P1, with conditions.** Four 80 × 60 blanks, shadow offset (0.8, 0.6) × length, darkened by k. The cells are the centre error dC in mm; "bed ref" is centred mode.

| Bed | Shadow | bed ref dC | Sample dC | No ref dC | Note |
|---|---|---|---|---|---|
| Hex honeycomb (dark) | 2 / 4 / 8 mm | 0.13–0.50 | 0.13–0.52 | 0.13–0.51 | a darker shadow on a dark bed hardly matters |
| Flat grey | 2 mm ×0.6 | 0.49–0.51 | 0.54–0.57 | 0.59–0.62 | |
| Flat grey | 4 mm ×0.5 | 0.85–0.88 | 0.98–1.01 | 1.03–1.06 | |
| Flat grey | **8 mm ×0.45** | **4.14–4.15**, sizes **+6.9 / +5.4** | 1.16–1.19 | 1.21–1.23 | |
| MDF | 2 mm ×0.6 | 1.25–1.44 | 1.29–1.50 | 1.27–1.45 | |
| MDF | **4 mm ×0.5** | 1.7–4.0, and **3 extra "pieces"** (bed patches about 99 × 48) | 1.85–2.03 | 1.83–2.00 | extras: **copies 32.8 mm off the wood** |
| MDF | **8 mm ×0.45** | **5.76–6.05**, sizes +8 / +7 | 0.93–1.70 | 0.91–1.68 | |

- **Why P1.** It is a silent off-centre burn of 4–6 mm on light beds, and copies on bare MDF when shadows tip the split. Lighting is not an operator setting, unlike K2-P2-1's Material height, and METHOD §3 has no reach clause. That is wrong physical output with no warning.
- The mild case (≤ 2 mm, or a dark honeycomb) would on its own be P2.
- The MDF extras share a root cause with K3r-P1-1 (a two-class split with a third class present). The coordinator may merge them.

**K3-P2-2: CONFIRMED; P2 kept, not P1.**
- **Centred mode.** 36 × 24 on a 30 □ burns 3.0 mm onto the bed (17.8 % of the copy) and on ⌀25 9.2 mm (45 %). 70 × 40 on a 60 □ burns 5.1 mm, on a 30 □ 20.6 mm, on ⌀25 27.8 mm. No note.
- **Sample mode.** When the design itself overhangs its sample piece (36 × 24 on the 30 □), no note says so either. Only the size flag against the other pieces appears.
- **Why not P1.** The position is exactly the documented one: centred, with "moves and turns only, never a scale" (ADR-442 Context). The overhang comes from the operator's design size against a piece size the panel lists in numbers. K3-P1-2 differs: there the app's own outline shows its "centre" is off the material, and the list hides it ("⌀ 120.5"). This is a missing fit check (P2). The same inside-the-outline check fixes both.

**K3-P2-3: CONFIRMED at the detector, P2** (`rm.out.jsonl`, uncovered ring 0.01 mm).

| Covered | 10 % | 15 % | 20 % | 25 % | 28 % | 30 % | 33 %+ |
|---|---|---|---|---|---|---|---|
| side | 0.29 | 0.53 | 0.72 | 0.91 | 1.01 | refused | refused |
| top | 0.27 | 0.50 | 0.74 | 0.93 | 1.02 | **1.09** | refused |
| corner | 0.28 | 0.51 | 0.74 | refused | refused | refused | refused |

- `sizeMm` stays 6.25, because the size is `max(w, h)` (`find-marks.ts:92`), so the 0.6–1.6 × size window can never see a covered side. Only the aspect ≤ 1.4 (`:95`) and the off-centre ≤ 0.12 × size (`:99`) limits stop it, at about 30 %.
- This matches the auditor's 0.8–1.3 mm in a camera view. Under about 1 mm of cut error, and it needs a partly covered mark: P2.

**K3-P3-1: CONFIRMED, P3.** Top-down, no side wall: 50 × 40 pieces 0.5, 1 and 2 mm from the front edge are `partial` (left out, "Partly out of the camera's view"), widths +0.6 / +1.1 / +2.2 mm. At 3, 4 and 6 mm they are not. The blur's edge renormalisation (`piece-image.ts:22-41`) pulls the piece colour onto the last row.

**K3-P3-2: CONFIRMED, P3.** The same L reads "⌀ 120.5 mm", round (`find-pieces.ts:104-107`; fill 0.56 < 0.86 on a squarish rectangle).

### "Exact" claims (spot-check)

- **Find pieces centre 0.1–0.4 mm / ≤ 0.05°:** holds for the detector. Five turned rectangles (0°, 17°, −32°, 45°, 73°) and a ⌀80 disc, top-down on hex honeycomb: centre 0.01–0.12 mm, angle 0.01–0.06°, sizes +0.1…+0.4 mm (`rp accuracy`). The auditor's larger 0.1–0.4 mm includes side walls and warp.
- **Many pieces:** 48 tags of 40 × 25, turned −10…+9°, 8 mm apart: all 48 found, every copy on its tag, 0.51 s.
- **Tiny pieces:** a 9 × 9 tag (81 mm², under the floor) is still found as 10.4 × 10.4, because the blur grows it. A ⌀11 disc reads "square 11.6". Harmless here: the copies landed on them.
- **Print and Cut 0.01–0.07 mm:** an uncovered ring is 0.01 mm at the detector. I did not re-run pair matching or registration.
- **Target engrave 0.00 mm:** READ only. It is the same `prepareStartJobSnapshot` with no registration.
- **Trace 0.39 mm:** not re-run.

### New findings

**K3r-P1-1: On a light spoilboard with old burn marks, Find pieces takes the scorch marks for the pieces. Past about 1.1–1.5 % of the bed scorched, the real blanks are not found at all, even with the design on one, and every copy burns on a scorch mark.**
- **Where:**
  - `src/core/camera/pieces/piece-mask.ts:27-39`: one Otsu split of one feature into two classes;
  - `:153-166`: "the side that owns less of the picture's edge is the pieces";
  - `find-pieces.ts:66`;
  - `PiecesControl.tsx:94,136-139`: with no piece under the design, sample mode silently becomes "The design is centred on each piece".
- **Anchor:**
  - ADR-442 Context: "a batch of blanks: coasters, tags or offcuts";
  - ADR-442 Decision 1: "Otsu's method splits the feature … The side that owns less of the picture's edge is the pieces, because the bed surrounds them".
  - Ground truth: a used spoilboard is scorched. The split assumes two classes, and scorch makes a third, far darker than both.
- **Evidence:** REPRO, `rp mdf`, `mdf2`, `mdf3`. MDF bed (178, 146, 108); four plywood blanks (208, 178, 132; about 50 RGB from the bed). The burns are 15 mm scorched squares or ordinary old marks.

  | Scorched area | Reference none | Reference on blank 2 (sample) |
  |---|---|---|
  | 900 mm² (4 squares) | 4 blanks found | 4 blanks, sample found |
  | **1350 mm²** (6) | 4 blanks | **0 blanks; 6 "pieces" = the scorches; the sample is not found** |
  | 1800 / 2250 / 2700 mm² | **0 blanks**; 8 / 10 / 12 scorches | **0 blanks**; 8 / 10 / 12 scorches |
  | 4 mixed marks (30 × 30, 40 × 12, ⌀18, 60 × 4; 1870 mm²) | **0 blanks, "Found 4 pieces"** = the 4 marks | the same: **"Found 4 pieces"** for 4 blanks; every copy **158 mm** from any blank |

  - In centred mode (reference on the bed), every dark mark becomes an extra ticked piece next to the blanks: one 20 × 20 scorch, a 4 × 4 material-test grid of 8 mm squares, or even two old 0.8 mm kerf outlines. Each copy burns on the bare bed.
  - **Controls:**
    - the same bed with no marks finds the 4 blanks (sizes −1 mm);
    - brighter blanks (birch 232, 208, 168, or white 240, 240, 240) are found up to 2700 mm² of scorch.
- **Scenario.**
  - An operator with a two-year-old MDF spoilboard (cut-through lines, test grids) lays four pine or plywood coasters on it.
  - They put the logo on one and press Find pieces. The panel reads "Found 4 pieces. The design is centred on each piece …", and four ticked rows appear.
  - Place, then Start, burns four logos onto old scorch marks on the spoilboard. No coaster is touched.
  - The outlines on the canvas sit round the scorches, a visible result but no warning.
- **Severity: P1.** It silently produces wrong physical position (METHOD §3). The matching count makes it the most silent of the K3 detection failures.
- **Announced?** No. Sample mode quietly becomes centred mode, and the change in the panel's sentence is the only trace.
- **Novelty:** new. The auditor's low-contrast birch on a wood spoilboard had no scorch. ADR-442 Measured covers honeycomb beds only, and its Consequences owe a photographed corpus.
- **Fix direction:**
  - When the reference lies on a piece, take the pieces as the side that holds the reference, not the side with less edge.
  - Split in three classes (or flag a strongly bimodal "bed" side).
  - Say when the design sits on no found piece although it is on the bed ("the piece under your design was not found").
  - Flag found pieces whose colour is far from the reference or from the majority.
  - Add a scorched-spoilboard fixture.

### Not verified

- The camera path in my piece runs. They are top-down by design; K2 measured the warp, and the auditor's camera runs bracket mine.
- The rendered panel and canvas outlines (no browser) and Vitest.
- Real glare, real shadows and real spoilboards.
- The trace (0.39 mm) and Print-and-Cut pair matching and registration.
- The calibration read-back of the moved canvas rings (replaced by the rigid-motion argument above).
- Fixture replays (they replay the scan, so they inherit everything above).

### Repro files

All in `zz-k3r\`. Run from there with `node --max-old-space-size=380 --no-experimental-webstorage --import ./register.mjs <file> [args]`.
- `rlib.mts`: top-down bed renderer (hex honeycomb, grey, MDF, scorch, glare, shadow), the real `findPieces` / `piecePlacements` / `placedObject` / `pieceNotes`, and analytic copy scoring.
- `rp.mts <scenario>`. Scenarios: gaps1, gaps2, gaps3, rot45, coasters, offcut, small, edges, glare (env `BIG=1`), glare-sample, glare-null, shadow (env `BED=honeycomb|grey|mdf`), mdf, mdf2, mdf3 (env `BLANK=r,g,b`), many, accuracy. Output: `rp.out.jsonl`.
- `rt.mts` → `rt.out.jsonl`: the real store, Print and Cut plus Add target to canvas, the Start registration, Job Review and the stamp.
- `rm.mts` → `rm.out.jsonl`: a partly taped ring through the real `findMarks`.

```json
[
  {"id":"K3-P1-1","verdict":"confirmed","severity":"P1","note":"own top-down hex-honeycomb renderer: square-on 3.5 mm merges / 4.0 separates; 45 deg 4 mm merges / 5 separates; mechanism = 2 box passes r 2.5 mm (bed share at gap centre g/5-g^2/100) + midpoint split + 1 mm close; 12 packed d90 coasters -> 'Found 1 piece'; centred copies straddle two blanks; sample mode leaves half the blanks without a copy; wording 'about 4-5 mm'"},
  {"id":"K3-P1-2","verdict":"confirmed","severity":"P1","note":"L, ring and picture-frame offcuts: all three copies 100% off the wood, 29.9-32.1 mm out (20x14 design too); placementOn uses rect.centre only; holes dropped"},
  {"id":"K3-P1-3","verdict":"confirmed","severity":"P1","note":"own Gaussian glare on hex honeycomb: sigma>=5-6 mm at +100..130, sigma 8 at +80, sigma 12 at +70 -> 108-227 mm2 pieces, ticked, copies 124-172 mm from any blank; sharp highlights (sigma<=4) and streaks are dropped; only guard MIN_PIECE_AREA_MM2=100"},
  {"id":"K3-P1-4","verdict":"confirmed","severity":"P1","note":"real store: addCalibrationTargetToCanvas keeps printAndCutTargets; currentPrintCutOutputRegistration applied; rings compile 8.6-13.2 mm off (9/6 mm, 1 deg); Job Review [] / null; stampCanvasTargetBurn true, burnSeen true; rigid in-plane move = camera move -> zero residual, model off 10.8 mm centre / 15.7 worst; Labs-only (Labs off or no captures -> Start refused); wizard Engrave target passes no registration (READ)"},
  {"id":"K3-P2-1","verdict":"confirmed","severity":"P1","note":"raised: dark honeycomb 0.1-0.5 mm only, but grey bed 8 mm shadow dC 4.1 mm (+6.9 mm size), MDF 8 mm dC 5.8-6.0, MDF 4 mm shadows add 3 bed-patch 'pieces' with copies 32.8 mm off wood (centred mode); lighting is not an operator setting; mild/sample cases alone would be P2; shares root cause with K3r-P1-1"},
  {"id":"K3-P2-2","verdict":"confirmed","severity":"P2","note":"36x24 on d25 9.2 mm, 70x40 on 30 sq 20.6 mm onto the bed; not P1: the position is the documented centring, the sizes are listed, ADR-442 'never a scale'; missing fit check; same fix as K3-P1-2"},
  {"id":"K3-P2-3","verdict":"confirmed","severity":"P2","note":"top-down real findMarks, 6 mm ring: 10-30% covered -> 0.27-1.09 mm, accepted; sizeMm = max(w,h) never sees a covered side; refused only past ~30% by aspect/off-centre"},
  {"id":"K3-P3-1","verdict":"confirmed","severity":"P3","note":"top-down, no side wall: 0.5/1/2 mm from the edge -> partial, 3 mm not"},
  {"id":"K3-P3-2","verdict":"confirmed","severity":"P3","note":"L reads round, '⌀ 120.5 mm'"},
  {"id":"K3r-P1-1","severity":"P1","area":"target-trace-and-pieces","file":"src/core/camera/pieces/piece-mask.ts","line":27,"anchor":"ADR-442 Decision 1 'Otsu's method splits the feature … The side that owns less of the picture's edge is the pieces'; ADR-442 Context 'a batch of blanks'","evidence":"REPRO","known":false,"summary":"On a light MDF spoilboard with old burn marks, plywood blanks (~50 RGB from the bed) are not found once ~1350-1800 mm2 is scorched; the scorch marks are the 'pieces' (e.g. 'Found 4 pieces' for 4 blanks = 4 marks), sample mode silently becomes centred mode, every copy burns on the bed up to 158 mm from any blank; in centred mode any dark mark (20x20 scorch, test grid, old kerf outline) is an extra ticked piece"}
]
```

Refuter counts: raised 1, refuted 0, P1 6, P2 2, P3 2, known 1
