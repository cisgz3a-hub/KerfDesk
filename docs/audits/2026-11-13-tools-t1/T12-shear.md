# T12 Shear — auditor report
Tree: origin/main @ 856cb3ae1. Command id: `tools.shear`.

## Map
- Menu: `src/ui/commands/app-menu-groups.ts:162` (Tools → Fill repair) → spec `SHEAR` `src/ui/commands/layout-commands.ts:176-182` → `ctx.shear` = `openShearDialog` (`src/ui/commands/design-tools-command-context.ts:62`).
- Dialog: `src/ui/commands/ShearDialog.tsx` — two number fields (Horizontal 15, Vertical 0), `parseAngle` rejects empty / non-finite / |a| > 85, refuses 0/0, calls `useStore.shearSelection(ax, ay)`.
- Action: `src/ui/state/shear-actions.ts` `shearMutation` — selection minus locked → `isPathEditable` targets (imported SVG, traced image, drawn polyline); pivot = centre of `combinedBBox(targets)` (line 46/54); per object `localBakeMatrix(T, W) = T⁻¹·W·T` (`src/core/geometry/shear-bake.ts:62-66`), `bakeCurves` → `transformCurveSubpathExact` (`src/core/vector-export/affine-curves.ts`, ADR-431: lines/cubics by points, elliptical arcs re-derived from singular values, sweep flipped when det < 0); polylines re-flattened at 0.05 mm (`materializeCurves`); placed tabs follow through the same map (`withTabsFollowingMap`, ADR-494 Amd 4); one undo step; toast.
- World map: `worldShear` (`shear-bake.ts:49-53`) is the **simultaneous** matrix `[[1, tanα],[tanβ, 1]]` about the pivot: x' = x + tanα·(y−cy), y' = y + tanβ·(x−cx).
- Governing: ADR-431 (exact affine curves), ADR-494 Amd 4 (tabs follow Shear/Warp/Deform), WORKFLOW.md:1262 ("Shear, Warp and Deform carry each tab through the same map as its outline"). Help: `src/ui/help/layout-command-help.ts:90-94`.
- Since 2026-10-16 (git log on origin/main): 8c771ce56 (dialog refuses empty/invalid angles instead of reading 0), b247d1747 / 313cea95a / 28768335c (tabs follow edits; shear now maps tabs, rolling v9 R3-P2-2 fix). Created b1c2ea6e3 (2026-10-13).

## October register re-check
Row #58 ("affine curves and local transform baking; ±85° and singular source checks; combined X/Y may be singular by construction"):
- 15° X shear widens by h·tan15 and Undo is exact — still true: 20×10 square → 22.68×10 (oracle 20 + 10·tan15 = 22.68); Undo restores the project JSON byte-for-byte; Redo reproduces it byte-for-byte (`zz-t12/t12.log`, "burn / history / file").
- ±85° bound: still enforced in dialog and action (85.0001, NaN, ±Infinity, 0/0 → no change, no undo step).
- Singular **source** transform (scaleX 0) → `localBakeMatrix` null, object skipped: still covered by `shear-bake.test.ts`.
- "Combined X/Y may be singular by construction": still true and still unguarded — see T12-P2-1. The register recorded it as a limit; no refusal, warning or ledger finding followed.
- Rolling v9 R3-P2-2 (shear kept each tab's fraction; tabs moved up to 16.7 mm): **fixed** — two laser tabs on a rotated square, shear (30,−15): tab world positions vs W(original tab) differ by 0.0000 mm; anchors re-fractioned 0.3→0.3165, 0.8→0.8165.

## Checks run
| Check | Method | Result |
|---|---|---|
| Geometry vs exact affine oracle: 5 shapes (line square, 2-arc circle, rotated ellipse rx12 ry5 @30°, cubic blob, open large arc) × 5 placements (identity, rot30, mirrorX, scale 2×0.5, rot40+scale 1.5×0.7+mirrorY) × 10 angle pairs | own SVG F.6.5 arc sampler + own placement, oracle W applied to dense world samples about the selection-box centre, symmetric Hausdorff (`zz-t12/t12.test.ts`, `geo12.ts`) | All non-singular cases exact: stored curves ≤ 0.05 mm (residual is my sampler's chord error on 115 mm eccentric arcs), stored polylines ≤ 0.11 mm (0.05 mm flatten × object scale 2). Shear is in **world axes** for rotated/mirrored/non-uniformly scaled art, as the dialog says. Arcs stay `elliptical-arc` segments (rotated ellipses correctly re-derived), never endpoint-only. |
| Area | own shoelace on samples | Single-axis shear keeps area (ratio 1.0000). Combined: ratio = 1 − tanα·tanβ exactly (20/−10 → 1.0642; 60/60 → −2.000; 44/45 → 0.0343; 45/45 → 0). |
| Eccentric arcs (r 1 and r 10 arcs at 85°, minor radius 0.087) | stored arc params, flattened polylines and G-code vs oracle (`t12c.test.ts`) | Burn within 0.025 mm of oracle; stored polylines within 0.05 mm. |
| Burn | `prepareOutput` → `emitPreparedGcode`, own decoder (machine Y = 400 − scene Y) | 4 cases (circle on rot40/scale/mirror at 30°, ellipse on scale2×0.5 at Y40°, cubic mirrored at 85°, circle at 60/60): every oracle point within 0.025–0.030 mm of a lit move. |
| Fill hatching after shear | Fill layer, own point-in-polygon on lit endpoints | Circle on rot40+scale+mirrorY, X30°: 442 lit endpoints, worst 0.0002 mm outside the oracle outline; lit length 3290.89 vs 3291.36 before (area kept). |
| Tabs | resolver world points vs W(tab) | 0.0000 mm (see above). |
| Undo / Redo | JSON compare | Exact both ways in all 4 burn cases. |
| Save / reopen | `serializeProject` → `deserializeProject`, re-burn | Shear baked into paths, transform unchanged; reopened curves identical (0.000000 mm), reopened G-code identical to oracle within 0.025 mm. |
| Inputs | store action | NaN, ±Infinity, 85.0001, 0/0 refused silently (dialog shows the message); 1e-12 accepted. |
| Mixed / locked / non-path selections | store action | Drawn rectangle, text, images skipped and named in toast; locked objects skipped without mention (T12-P3-2); pivot ignores skipped objects (T12-P3-1); a drawn-rectangle-only selection gets the "convert first" toast and no undo step. |
| Raster images | read + toast | Not path-editable → skipped and reported, never silently sheared. |
| Existing suites | Vitest, 3 files | `shear-bake`, `shear-actions`, `ShearDialog`: 5/5 pass. |
| LightBurn | docs (Transform Controls, 2.0/2.1) | LightBurn shears by dragging a Shear handle: top/bottom handle skews vertically, left/right horizontally — one axis per drag, so repeated drags compose sequentially (det = 1 every time). |

## Findings

### T12-P2-1: Combined Horizontal + Vertical shear collapses artwork to a line at tanα·tanβ = 1 and mirrors it beyond, with "Sheared 1 object."
- **Severity P2:** a wrong result with no warning; the user is likely to notice it on the canvas, and Undo restores it. The refuter could argue P1 for the mirror case, because mirrored art burns mirrored and nothing says so.
- **Where:** `src/core/geometry/shear-bake.ts:49-53` (`worldShear` builds the simultaneous matrix `[[1,kx],[ky,1]]`, det = 1 − kx·ky); `src/ui/state/shear-actions.ts:40` and `:54-61` check each angle against ±85° but never the determinant. `localBakeMatrix` only rejects a singular *source* transform. The dialog (`ShearDialog.tsx:44-50`) accepts any pair within ±85°.
- **Repro** (`C:\Users\stolk\kd-t1\zz-t12\t12.test.ts`, log `t12.log`). Run from the tree: `node node_modules/vitest/vitest.mjs run --config ../zz-t12/vitest.config.mts --maxWorkers=1 t12.test.ts`.
  - **45/45** (any pair with tanα·tanβ = 1, e.g. 30/60): a closed 20×10 square on a Fill layer becomes area 0.0000, stored bounds 30×30, Fill burns **0.00 mm** where it burned 2000 mm before. A Ø20 circle on a Line layer becomes a doubled straight line: it burns **56.57 mm** where a circle would burn 62.83 mm, and its area is 0. The toast says only "Sheared 1 object.".
  - **44/45:** area ratio 0.0343, so the art turns into a sliver.
  - **60/60:** det = −2. Every result is mirrored (area sign −2.000) and twice the size: the square's Fill lit length goes 2000 → 4000 mm (×2.000). At 85/85, det = −129.6: area ×129.6, mirrored, 134×239 mm from a 20×10 square.
- **Oracle:** the exact maps above match the tool's own output to 0.0000 mm, so the maths is right; the transform is the problem. LightBurn's documented Shear (Transform Controls) skews one axis per handle drag. Doing X then Y in sequence gives `[[1,kx],[ky,1+kx·ky]]`, whose det is 1 for every pair within ±85°: the area is kept, nothing collapses and nothing mirrors. The help text "Slant the selected vector artwork horizontally and/or vertically" does not warn of mirroring or collapse either.
- **Suggested fix:** compose the two shears in sequence (X then Y, area-preserving, as LightBurn's drags do), or refuse in the dialog and action when 1 − tanα·tanβ ≤ ε (with a message). Add tests for 45/45, 60/60 and 44/45.
- **Prior notice:** register row #58 and `docs/audits/2026-10-15-tools-vector.md:108` noted that "simultaneous X/Y shear can itself become singular" as a limit. Neither raised nor fixed it, and no ledger lists it.

### T12-P3-1: The pivot is the centre of the shearable objects only, not "the centre of the selection" that the dialog and tooltip promise
- **Severity P3:** the behaviour can be defended. The result shows on the canvas before any burn, and the wording does not match.
- **Where:** `src/ui/state/shear-actions.ts:46,54` (`combinedBBox(targets)` after skipped objects are filtered out); dialog text `ShearDialog.tsx:85` and tooltip `layout-command-help.ts:93`.
- **Repro** (ran, `t12.log` "mixed selection"): a 20×10 imported square at (50,50) plus a drawn 10×40 rectangle at (150,20), shear X 30°.
  - The tool pivots at (60,55), the square's centre, and matches that oracle to 0.0000 mm.
  - The selection-box centre is (105,40). A shear about it would put the square 8.66 mm further along X.
- **Suggested fix:** say "about the centre of the artwork it shears" in both texts, or pivot on the whole selection box.

### T12-P3-2: Locked objects in the selection are skipped without a word, and the skip note tells users to convert images to paths
- **Severity P3:** wording only.
- **Where:** `shear-actions.ts:41-44,79-82`. Locked objects are filtered out before `skipped` is counted. The note says "convert text, shapes and images to paths", but an image can only be traced, not converted.
- **Repro** (ran): select an imported square plus a locked imported square, shear X 30°. The toast says "Sheared 1 object.", with no mention of the locked one, which stays unchanged.
- **Suggested fix:** count locked objects in the note ("1 locked object was left unchanged"), and say "trace images" instead of converting them.

### T12-P3-3 (READ ONLY): A path whose sheared curves fail to re-flatten is left unsheared, while the rest of the object is sheared and counted
- **Severity P3, READ ONLY:** I could not build a repro. Shearing my 60k- and 75k-segment arc and cubic chains *reduced* their flattened counts, so the 200,000-segment budget was never reached.
- **Where:** `shear-actions.ts:64`. `materializeCurves(path, curves) ?? path`: if `flattenCurveSubpath` fails for any sub-path, that whole path keeps its unsheared geometry. The object still counts as sheared and the toast says nothing.
- **Suggested fix:** skip the whole object, or refuse the shear, when any path fails to materialise, and say so in the toast.

## Not a defect / limits
- **Arcs are exact.** Shearing a circle gives a rotated ellipse with correct radii, rotation and sweep, including under mirror (det < 0 flips the sweep), non-uniform scale and 85° (minor radius 0.087 mm). The export marker symbol is stripped (`plainSegment`), so files stay serialisable. This is the T10/T11 failure mode, and it does not occur here.
- **Pivot for objects square to the bed.** `transformedBBox` uses `object.bounds` for objects square to the bed and the geometry extent for rotated ones, so the pivot equals the visible selection box as long as `bounds` is current. Shear rewrites `bounds` via `boundsForPaths`. A 28 mm deviation seen once in my probe came from my own hand-written wrong `bounds` (test artefact), not from the tool.
- **Text, drawn rectangles/ellipses and raster images** are deliberately left alone and named in the toast. The dialog text says so (ADR in the file header). Nothing is sheared silently.
- **Positive-angle direction** (positive Horizontal moves points with larger scene Y, toward the front of the bed, to +X) is undocumented in the dialog. I did not verify the on-screen orientation (no browser run), so nothing is raised.
- **No browser run** (memory gate about 2.7 GB, so the brief said not to). Keyboard use, focus and Cancel are only read: Cancel calls `close` and changes nothing. A 1e-12° shear is accepted and creates an undo step with no visible change (not raised).
- **Out-of-bed results:** an 85° shear of a 20 mm part reached X −70 mm in G-code, with `prepareOutput` ok. Bed bounds are preflight's job, not this tool's. Not raised here.

## Totals
Raised 4; P1 0; P2 1; P3 3; known 0. T12-P2-1 was noted as a limit, not a finding, in register row #58 and `2026-10-15-tools-vector.md:108`. Rolling v9 R3-P2-2 (tabs) is re-checked and fixed.
