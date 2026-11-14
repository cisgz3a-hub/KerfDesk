# T39 Deform — auditor report
Tree: origin/main @ 975631408. Command id: `tools.deform`.

## Map
- **Menu → command:** `src/ui/commands/warp-deform-commands.ts:20-27` (`tools.deform`, tooltip "Drag a grid of 16 handles to bend the selection smoothly"). It is enabled by `canWarpSelection`, the same gate as Warp. It calls `startWarpDeformTool('deform')` (`src/ui/workspace/warp-deform-tool.ts:51`).
- **Interactive mode:** the code is shared with Warp (see T38).
  - `useWarpDeformSession` holds the box and 16 handles in row order from minY, each row from minX (`initialWarpDeformHandles`, `warp-deform-map.ts:59-79`).
  - A drag moves only the handle that was grabbed. The Shift parallelogram applies to Warp only (`draggedWarpDeformHandles`, `warp-deform-tool.ts:146-165`).
  - The cage is the control polygon: every row and column of handles joined by straight lines (`cageLines`, `:216-229`).
  - The hint (`WarpDeformHint.tsx`, `DEFORM_HINT`) gives Reset handles, Cancel and Apply. Enter applies and Esc cancels.
  - The preview `warpDeformPreview` uses the same plan as Apply.
- **Core maths:** `deformMap` (`src/core/geometry/warp-deform-map.ts:136-163`).
  - It is **one bicubic tensor-product Bézier patch** over the whole box, with the 16 handles as its control points. It is not a per-cell bilinear mesh, so there are no cell borders and the map is smooth (C∞) everywhere.
  - Corners are answered exactly (`withExactCorners`).
  - `featureSizeMm` is min(w, h)/3 and `keepsLinesStraight` is false, so every straight piece is split adaptively by `warpWorldPoints` / `splitPiece` (`warp-deform-paths.ts`) to within 0.02 mm. Curves are re-flattened at (0.05 − 0.005 − 0.02)/stretch, where stretch comes from a 9×9 sampled Jacobian (`warpDeformStretch`).
  - The bend is refused atomically on budget, at depth 12, or on a non-finite result.
- **Plan / mutation:** `src/ui/state/warp-deform-plan.ts` and `warp-deform-actions.ts`, shared with Warp. The undo label is "Deform", and the notice says "Deformed N objects…".
- **Governing:** ADR-498 §3 (LBG-T06: "a 4×4 grid mapped with a bicubic Bézier patch that reproduces the identity until a handle moves"; crossing handles are applied), ADR-494 Amd 4 (tabs follow the bend) and ADR-350 Amd 2. WORKFLOW.md F-A6f item 3 (line 857) and line 1283. Help: `src/ui/help/warp-deform-command-help.ts:14-18`.
- **Changes since 2026-10-16:** the same commits as T38 (10ce95b1a, f3e535e79, 28768335c / #1533, 416d4e82d, 7e02b344d, 89385f65b). None is Deform-only.
- **LightBurn:** the docs page `docs.lightburnsoftware.com/2.1/Reference/WarpDeform/` was readable this time. It says:
  - Deform Selection moves "the 16 handles at the intersections of the overlaid grid".
  - Shift while dragging keeps horizontal symmetry, and Alt/Option keeps vertical symmetry.
  - "Double-click on a handle to reset it."
  - It does not say how the shape follows the handles. The 1.4.00 release notes, as summarised by search (the page itself could not be fetched), say Ctrl or Shift give a symmetric edit.

## October register re-check
Row 46 (Deform) repaired the tolerance floor and stretch cap and bounded the subdivision; the register still lists "sampled estimates remain a limitation".
- **Still fixed.** Six in-tree files pass (66 tests): `warp-deform-map`, `warp-deform-accuracy-budget`, `warp-deform-paths`, `bent-outline-tabs`, `warp-deform-tool` and `WarpDeformHint`.
- **Own oracle.** I enlarged a 2 mm circle 100×, 200× and 400× with a skewed grid (D11). The Hausdorff distance to the oracle-mapped **stored cubic curve** is 0.025 mm at every factor (budget 0.05). Nothing was refused and the result is not coarse.
- **The sampled stretch is not broken.** I placed a small circle where the stretch peaks between the 9×9 samples, at (u, v) = (1/3, 1/3) and (1/16, 1/16) with extreme handles (D4c). The Hausdorff distances are 0.007 and 0.018 mm.
- **Register screenshot case** (top-edge interior handle dragged): D3-edge-top matches the oracle within 0.019 mm, and the signed area is 6749.8 against the oracle's 6750.

## Checks run
Script: `C:\Users\stolk\kd-t1\zz-t39\t39-deform.test.ts`. It drives the real store: `startWarpDeformTool('deform')` → `setHandles` → `warpDeformPreview` / `applyWarpDeformTool`.

The oracle is my own **de Casteljau** evaluation: each row's cubic at u, then the column cubic at v. It does not use the app's Bernstein sum.

The G-code goes through `prepareOutput` → `emitPreparedGcode` and is decoded with `zz-t39\decode.ts` (a copy of the T26 decoder).

Logs: `zz-t39\t39-evidence-D1-D9.log`, `t39-evidence-D9-D10.log` and `t39-evidence-D11.log`. All runs used one worker with 1.9 to 2.2 GB free.

| Check | Method | Result |
|---|---|---|
| D1 identity (no drag) | store Apply | Same project, no undo step, toast "The handles have not moved…". The evenly spaced grid reproduces the identity in the oracle within 2.8e-14 mm. |
| D1 1e-6 mm nudge of an interior handle | vertices | Largest move 7.1e-14 mm. |
| D1 all 16 handles translated (+10, +5) | vertices | Error 9.5e-14 mm (affine precision). |
| D1 affine grid (shear + scale) | Hausdorff | 0 mm. A 4-corner rectangle stays 4 corners: nothing is split, and straight lines stay straight. |
| D2 one interior handle (index 5) +20/+15 over a 100×60 rectangle and 10 grid lines crossing u, v = 1/3 and 2/3 | oracle, two-way Hausdorff, turning angles | Every line is within 0.016–0.020 mm. There is no kink or gap at the 1/3 and 2/3 "cell borders": it is one patch, and the output turning stays smooth. The rectangle outline is unchanged (the boundary depends only on boundary handles), as the oracle says. |
| D2 preview vs Apply | JSON compare | Identical. |
| D2 G-code | decoded lit moves | Lit length 1120 → 1122.277 mm against the oracle's 1122.287. Every lit vertex is 0.000 mm off the oracle curves. |
| D2 history | Undo / Redo / serialize → deserialize | Undo restores both objects (same references), Redo gives the same project, and reopening gives the same world geometry. |
| D3 top-edge handle −30; interior fold (+80/+50); crossed columns; mirrored grid; corner dragged inside | oracle, crossings, signed area, Fill G-code | All match the oracle within 0.02 mm and burn without issues. The mirror gives signed area −6000, and Fill burns the same area. |
| D9 folds and twists with interior lines and a circle | oracle | Lines within 0.020 mm and the circle within 0.009 mm. No self-crossings, no refusal. |
| D4a ellipse 60×40, three handles | analytic ellipse → oracle | Hausdorff 0.020 mm. The toast names the conversion and the flattened curves. |
| D4b / D10 / D11 2 mm circle enlarged 100–400× | oracle | Against the stored cubic: 0.025 mm at 100×, 200× and 400×. Against the analytic circle: 0.041, 0.065 and 0.131 mm. The difference is the drawn ellipse's own quarter-cubic error (2.7e-4·r) magnified, which is KNOWN as rolling v7 L2-P3-1 and is not Deform's. |
| D5 text "Ag8" (Roboto) | oracle on the densified glyphs | Becomes `imported-svg`, keeps `name` and `powerScale`; Hausdorff 0.019 mm. |
| D5 image + locked + 2-member group + rectangle | store | Image and locked object unchanged (same references). The group record is kept. One box (100..170 × 100..160) covers the three vector objects, each within 0.017–0.020 mm. The toast counts the image and the locked object. |
| D5 rotated 35°, mirrorX, scale 2.5×0.8 | oracle on world points | Transform kept; Hausdorff 0.019 mm. Lit 182.998 mm against the oracle's 183.000. |
| D5 drawn rounded rectangle: Cancel, Reset handles, Apply | store | Cancel leaves the same project with no undo step and ends the session. Reset handles → Apply says "not moved" and leaves the same project. After Apply, `name`, `powerScale` and `operationOverride` are kept; only `spec` and `color` are dropped (conversion by design). The selection is kept. |
| D5 Shift on Deform | `draggedWarpDeformHandles` | Only the grabbed handle moves; there is no symmetry mode (P3-1). |
| D6 five placed laser tabs; edge bulge, and interior + corner drag | oracle-mapped tab places against decoded gap centres | Errors 0.000–0.023 mm, with 5 gaps before and after. **R3-P2-2 is fixed for Deform.** |
| D7 horizontal line, vertical line, zero-length dot, 0.01 mm triangle | store, oracle | The box opens to 10% of the long side, or 1 mm. The results are finite, within 0.018 mm of the oracle, with one undo step each. |
| D8 400 objects, 3 handles | store, oracle on 4 samples | Preview plus Apply took 15 ms; worst error 0.001 mm. |
| In-tree suites | Vitest, 1 worker | 6 files / 66 tests pass. |
| Dependants (image mask, path-text guide) | READ | Deform keeps object ids (`materializeVectorObject(object, object.id, …)`), so dependants still resolve. This is shared with Warp; see T38. |

## Findings

### T39-P3-1: Deform lacks LightBurn's symmetric drag (Shift / Alt) and its per-handle reset (double-click)
- **Severity P3:** a parity gap with no burn harm. The live preview shows every drag.
- **Where:** `src/ui/workspace/warp-deform-tool.ts:146-165`. `keepParallelogram` is honoured only when `grid === 'warp'`; Deform has no modifier. `resetWarpDeformHandles` (`:84-88`) resets all 16 handles, and there is no per-handle reset.
- **Repro:** D5-shift. `draggedWarpDeformHandles('deform', …, keepParallelogram = true)` changes only index 5.
- **Oracle:** the LightBurn 2.1 Warp/Deform page says "Hold Shift while dragging a handle to maintain horizontal symmetry", Alt/Option keeps vertical symmetry, and "Double-click on a handle to reset it." The maintainer's rule is "research what LightBurn does and copy".
- **Suggested fix:** on Deform, Shift mirrors the drag to the handle's horizontal mirror partner (column 3 − c) and Alt to its vertical partner (row 3 − r). A double-click on a handle puts that one handle back. Add both to the hint.

### T39-P3-2: The hint and tooltip do not say that the 12 non-corner handles are control points the artwork does not reach
- **Severity P3:** wording only.
  - Dragging an interior handle 25 mm moves the artwork under it by 4.94 mm, which is (4/9)² ≈ 20% of the drag. An edge handle moves its edge by at most 44%.
  - The cage is drawn as straight lines through the handles (`cageLines`). That reads as a 3×3 mesh of cells the artwork follows, but the artwork follows a smooth Bézier patch that passes only through the 4 corners.
  - This is by design (ADR-498 §3; `warp-deform-map.test.ts:151-164` asserts the (4/9)² factor), and the preview shows the true result, so nothing burns unexpectedly.
- **Where:** `WarpDeformHint.tsx:22-23` (`DEFORM_HINT`) and `warp-deform-command-help.ts:14-18`.
- **Repro:** D2, `artAtHandleMovedMm` 4.938 for a 25 mm handle drag (20, 15). The oracle de Casteljau value at (u, v) = (1/3, 1/3) is the same.
- **Suggested fix:** add to the hint something like "Handles pull the artwork smoothly; only the corner handles sit on it."

## Not a defect / limits
- **No cell borders.** Deform is one bicubic Bézier patch (ADR-498), so there are no per-cell kinks or gaps. The D2 lines crossing u, v = 1/3 and 2/3 are within 0.02 mm of the oracle.
- **Folded or crossed control grids** are applied and match the oracle (D3, D9). ADR-498 item 3 accepts them ("The user sees the preview, so nothing is refused").
- **Interior handles leave a plain rectangle outline unchanged.** The boundary of a Bézier patch depends only on its 12 boundary handles. This is correct maths, and the preview shows it (D3-fold-interior: 0 mm change).
- **A circle enlarged 200–400× is 0.065–0.131 mm off the analytic circle.** The cause is the drawn ellipse's quarter-cubic error (2.7253e-4·r), magnified with the circle. Measured against the stored cubic, Deform is 0.025 mm at every scale. **KNOWN:** rolling v7 L2-P3-1 (`docs/audits/2026-10-28-rolling-v7/L2-shapes-dimensions.md:196`).
- **Shared Warp/Deform items:**
  - Registration jig dissolved after Unlock All: T38-P2-1 → P3.
  - Variable barcode frozen: T38-P2-2 → P3, a decision row with T26-P3-2 under ADR-350 Amd 2.
  - Curves flattened: by design (ADR-498).
  - Variable text skipped: guard holds.
  These apply to Deform unchanged and are **KNOWN**; not re-raised. Warp enabled on variable-text-only selections (T38-P3-2) uses the same gate for Deform.
- **Images are skipped** with a notice (ADR-498). LightBurn's page does not say whether images deform.
- **Handles of a thin selection crowd together.** A 100 mm line gets a 10 mm box, so the handle rows are 3.3 mm apart. The handle hit test takes the nearest handle, so a precise click still grabs the right one; at low zoom the user must zoom in. Not raised.
- **Not checked:**
  - A browser run of the hint and keys: the in-tree `WarpDeformHint.test.tsx` passes, and I stayed within the memory budget.
  - Performance beyond 400 objects.
  - CNC tabs (laser tabs only; the in-tree `bent-outline-tabs.test.ts` covers CNC for Deform).

## Totals
Raised 2; P1 0; P2 0; P3 2; known 4:
- rolling v7 L2-P3-1 (ellipse quarter-cubic error, magnified by enlargement);
- T38-P2-1 → P3 (jig after Unlock All);
- T38-P2-2 → P3 / T26-P3-2 (variable barcode frozen, ADR-350 Amd 2);
- curves flattened by design (ADR-498; T26-P2-1).

Rolling v9 R3-P2-2 is confirmed fixed for Deform: tab errors are 0.000–0.023 mm.
