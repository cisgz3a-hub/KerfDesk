# T38 Warp — auditor report
Tree: origin/main @ 975631408. Command id: `tools.warp`.

## Map
- **Menu → command:** `src/ui/commands/warp-deform-commands.ts` (`tools.warp`, enabled by `canWarpSelection` = `selectionHasUnlockedVectorObject`, `warp-deform-command-context.ts:17`) → `startWarpDeformTool('warp')` (`src/ui/workspace/warp-deform-tool.ts:51`).
- **Interactive mode:** the session store `src/ui/state/warp-deform-session.ts` holds the box and 4 handles. Handle hit, drag and Shift-parallelogram are in `warp-deform-tool.ts:106-170`. The cage is drawn by `drawWarpDeformHandles`. The hint bar `src/ui/workspace/WarpDeformHint.tsx` has Reset handles, Cancel and Apply. Enter applies and Esc cancels, from a capture-phase listener. The live preview is `src/ui/workspace/use-warp-deform-preview.ts` (`warpDeformPreview`), and it uses the same plan as Apply.
- **Plan:** `src/ui/state/warp-deform-plan.ts`. `warpDeformTargets` takes unlocked vector objects and skips boolean compounds and variable text. Imported and traced artwork, and drawn polylines, keep their object and transform. Text and other drawn shapes go through `materializeVectorObject` and become `imported-svg`. Tabs pass through `withTabsFollowingMap` (ADR-494 Amd 4).
- **Core maths:** `src/core/geometry/warp-deform-map.ts`. `warpMap` uses a homography (from the camera solver) from the unit box onto the 4 handles, with exact corners. When the handles are not a convex quad with w > 0 at all corners, it falls back to the bilinear map. `src/core/geometry/warp-deform-paths.ts` flattens curves within the tolerance budget, maps the points, and splits pieces adaptively when the map does not keep lines straight. It refuses atomically past the segment budget, at depth 12, or on a non-finite result.
- **Store mutation:** `src/ui/state/warp-deform-actions.ts` (`applyWarpDeformMutation`). It makes one undo step and a toast that counts the warped and converted objects, plus the images, locked objects and variable text it left alone.
- **Governing:** ADR-498 §3 (LBG-T06), ADR-494 Amd 4 (tabs follow bends), ADR-350 Amd 2 (Warp/Deform guard: variable text only; a variable barcode is bent at its shown value), ADR-386 Amd 2. WORKFLOW.md F-A6f item 3 (line 857) and the tabs paragraph at line 1283. Help: `src/ui/help/warp-deform-command-help.ts`.
- **Changes since 2026-10-16** (`git log` on the warp files): 10ce95b1a (say why a bend is refused while dragging), f3e535e79 (34 audited editing defects), 28768335c (tabs follow bends, #1533 / ADR-494 Amd 4), 416d4e82d (lint), 7e02b344d (ADR-706), 89385f65b (ADR-350 Amd 2 guard: variable text skipped with a notice).
- **LightBurn:** I could not read the docs. docs.lightburnsoftware.com refused the fetch, and the legacy page returned 404. LightBurn parity is therefore not checked beyond ADR-498's own description.

## October register re-check
Row 45 (Warp): the 0.926 mm enlargement error and the silent coarse fallback were repaired.
- **Still fixed.** `warp-deform-accuracy-budget.test.ts`, `warp-deform-map.test.ts`, `warp-deform-paths.test.ts`, `warp-deform-actions.test.ts`, `warp-deform-conversion-budget.test.ts` and `warp-deform-variable-barcode.test.ts` all pass: 6 files, 53 tests.
- **Own oracle (S16).** I took a 2 mm circle and enlarged it about 100× with a perspective drag. The two-way Hausdorff distance to the analytic projective image of the true circle is 0.036 mm. A bilinear 100× case gives 0.025 mm. Both are within 0.05 mm. The over-budget refusal is atomic: the plan returns `failure` and Apply changes nothing (code read, and covered by the conversion-budget test).

## Checks run
All scripted checks use the real store (`startWarpDeformTool` → `setHandles` → `applyWarpDeformTool`) and compare against an independent oracle. The homography is Heckbert's closed form for the unit square onto a quad; the bilinear map is written out by hand. Script: `C:\Users\stolk\kd-t1\zz-t38\t38-warp.test.ts`. Log: `zz-t38\t38-evidence.log`.

| Check | Method | Result |
|---|---|---|
| S1 identity (no drag) | store Apply | Same project reference, no undo entry, toast "The handles have not moved…". A 1e-6 mm drag moves each point by at most 1.0e-6 mm. |
| S2 one corner +40/−20 on a 100×50 rectangle (61 vertices) | oracle homography, vertices and edge midpoints | Largest vertex error 6.4e-14 mm; edge midpoints on the outline (0 mm). Preview is byte-identical to Apply. |
| S2 G-code | `prepareOutput` → emit → own decoder | Lit length 300 → 372.044 mm, oracle perimeter 372.044. Every lit vertex is 0 mm from the oracle quad. |
| S2 history | Undo / Redo / serialize → deserialize | Undo restores the same object, Redo gives the same project, reopen gives the same world geometry. |
| S3 ellipse 60×40 under perspective | analytic ellipse → oracle, two-way Hausdorff | 0.026 / 0.026 mm (≤ 0.05). Toast names the conversion and the flattened curves. |
| S4 concave quad, crossed (bow-tie), mirrored handles | bilinear oracle, crossings, signed area, Fill G-code | Geometry matches the oracle exactly. Concave and crossed handles are applied **with no warning**; the bow-tie has 1 self-crossing and signed area 0, and Fill burns both lobes (P3-1). |
| S4c concave fallback: a diagonal must bend | bilinear oracle | 33 points, chord sag 11.151 mm, Hausdorff 0.014 mm. |
| S6 text "Ag8" (Roboto) | oracle on densified glyphs | Becomes `imported-svg`, keeps `name` and `powerScale`; Hausdorff 0.037 / 0.034 mm. |
| S7 variable text | store | Text alone: no session; the notice names Bake Variable Text. Mixed with a rectangle: the text is unchanged (same reference), the rectangle is warped, and the notice says so. **Guard holds; no `{{serial}}` glyphs.** |
| S8/S9 image + locked + rectangle | store | Image and locked object unchanged (same reference). The box covers only the rectangle. Toast counts both. |
| S10 two objects | oracle | One envelope over both (box 100..200 × 100..140); each object at 0 mm Hausdorff. |
| S11 rotated 35°, mirrorX, scale 2.5×0.8 | oracle on world points | Transform kept; largest vertex error 3.2e-14 mm. Lit length 191.364 mm against 191.363 mm. |
| S12 five placed laser tabs, corner dragged 60 mm | G-code tab-gap centres against the oracle map of each old tab place | All 5 gaps within 0.000 mm (e.g. mid-right (223.077, 130.769)). **R3-P2-2 (tabs moved up to 46 mm) is fixed.** |
| S13 single registration box + art, both selected | store, `findRegistrationBoxes`, G-code | The box becomes `imported-svg`: boxes 1 → 0, and its outline now burns warped. No notice (P2-1). |
| S13b two-box jig, Select All, a 5 mm drag | `registrationJigCompilationRuns`, decoded burn order | Boxes 2 → 0, jig runs 4 → 0. Order `F1111@A > F2222@A > F1111@B > F2222@B` becomes `F2222@A > F2222@B > F1111@A > F1111@B`. Toast: "Warped 6 objects. 6 drawn shapes were converted…" (P2-1). |
| S14 drawn rectangle with name, power scale, override, op ids; Cancel | store | Cancel leaves the same project and no undo entry. After Apply, name, powerScale, operationOverride and operationIds are kept; only `spec` and `color` are dropped (the conversion is by design). |
| S15 object deleted mid-session | store | "Nothing to warp…", no undo entry. |
| Variable QR (in-tree test plus logging) | `vb.test.tsx`, G-code before and after serial advance | After Warp/Deform the template is gone and the G-code is identical at serial 2 and 3. The only message is "1 drawn shape was converted to paths first." (P2-2) |
| In-tree suites | Vitest, 1 worker | 6 files / 53 tests pass. |
| Image mask / text-on-path guide | READ | Warp keeps the object id, so `imageMaskId` and `guideObjectId` still resolve. A warped mask clips the image to the warped outline. Path text is not re-laid when its guide changes; this is the same for every guide edit. |

## Findings

### T38-P2-1: Warp dissolves the registration jig: boxes 2 → 0, jig runs 4 → 0, burn order goes from per-piece to per-operation, with no notice
- **Severity P2:** the same defect and grade as T26-P2-2 (Convert to Path, fixed by #1875) and T28-P2-1 (Weld). Registration boxes are unlocked by design (`registration-box.ts`, "movable/removable"), so Select All → Warp takes them. The jig bar disappears and the per-piece burn order is lost. The toast only counts "drawn shapes converted".
- **Where:** `src/ui/state/warp-deform-plan.ts:65-77` (`warpDeformTargets`) and `:130` (`prepareWarpDeform`) have no `isRegistrationBox` or jig check. `:184-190` (`convertAndWarp`) materializes the box `shape` into an `imported-svg`, and boxes are recognised only as `kind === 'shape'` (`registration-layer.ts:46-52`).
- **Repro:** `zz-t38\t38-warp.test.ts` S13b. The setup is two 60 mm boxes, an ellipse source with its copy, and an engrave rectangle with its copy (the T26-E scene). Select All, start Warp, drag the top-right handle (+5, −3) and Apply.
  - Actual: `findRegistrationBoxes` 2 → 0 and `registrationJigCompilationRuns` 4 → 0. Burn order `F1111@A > F2222@A > F1111@B > F2222@B` → `F2222@A > F2222@B > F1111@A > F1111@B`.
  - S13 (one box): boxes 1 → 0, and the box outline burns warped (lit 560 → 603.777 mm).
  - Expected: the boxes are left as they are, with a notice, as Convert to Path now does.
- **Oracle:** `registrationJigCompilationRuns` and decoded G-code before and after. T26-P2-2 is the ledger precedent.
- **Suggested fix:** skip `isRegistrationBox` objects in `warpDeformTargets` / `prepareWarpDeform` and add "The registration jig outlines were left as they are." to the notice. Jig piece artwork should be left alone too, or warped per box. With one envelope over every box, each box's copy bends differently, so the pieces stop matching (READ; follows from the S10 one-envelope result).

### T38-P2-2: Warp/Deform freezes a variable barcode at its current serial and says only "1 drawn shape was converted to paths first"
- **Severity P2, a missing warning.** ADR-350 Amd 2 accepts that the barcode is bent at the value the canvas shows. It does not cover saying nothing. After Apply every record burns the same code, and the notice reads as an ordinary shape conversion. Precedent: T32-P2-1 (Prepare Stamp freezes variable data). T26-P3-2 was a decision row for the Convert to Path stored code. The refuter may re-grade this to P3 on ADR-350 Amd 2.
- **Where:** `src/ui/state/warp-deform-actions.ts:94-121`. `leftAlone` and `warpDeformNotice` count a barcode only as `convertedShapes`. `warp-deform-plan.ts:58-63` documents the bake.
- **Repro:** `zz-t38\vb.test.tsx`, a copy of `warp-deform-variable-barcode.test.ts` with logging. Insert a QR `SN-{{serial:4}}`, advance the serial to 2, Warp (or Deform) with all handles moved (+10, +5), Apply, then advance the serial and compile again. Output in `zz-t38\vb.log`:
  - `hasTemplate:false`, `gcodeSameAcrossSerials:true` for both grids.
  - Toast "Warped 1 object. 1 drawn shape was converted to paths first."
  - Expected: a notice that the barcode now keeps value SN-0002 for every record, pointing to Bake Variable Text; or the barcode left alone, like Weld and the Booleans.
- **Oracle:** G-code comparison across serials. Before Warp it differs per serial (`beforeVsAfterAdvanceDiffer:true`); after Warp it is identical.
- **Suggested fix:** count variable barcodes in `leftAlone` / the plan and add "…now keeps its current value (SN-0002) for every record; use Bake Variable Text…". Alternatively use the `variable` guard (`geometryToolSources`).

### T38-P3-1: Crossed or concave handles apply silently; the bow-tie gives a self-crossing outline and the concave case is no longer "perspective"
- Crossed handles (TR↔BR swapped): the outline has 1 self-crossing and signed area 0, and a Fill burns both lobes (lit 5000 mm at 0.5 mm spacing = 2500 mm²).
- Concave handles: the map quietly switches to bilinear (`warp-deform-map.ts:114-139`). Straight lines then bend (a diagonal sags 11.151 mm), although the tooltip says "in perspective".
- Neither case is refused or warned; the preview does show the result. Script S4/S4c.
- Suggestion: a hint line while the handles are crossed or concave, e.g. "Handles crossed: the outline will fold over itself."

### T38-P3-2: Warp is enabled for a selection of only variable text, then refuses on start
- `canWarpSelection` uses `isConvertibleVector` (`warp-deform-command-context.ts:17`, `selection-command-state.ts:77`). ADR-350 Amd 1 asks that guarded tools gate only on the objects they will rebuild.
- Start then refuses with a clear notice (S7). This is a wording and gating issue with no harm.

### T38-P3-3: Test gap
- No Warp test covers registration boxes or jig artwork, the crossed/concave fallback notice, or the variable-barcode notice wording.

## Not a defect / limits
- **Curves become fine lines.** ADR-498 rejects keeping exact curves through Warp (not linear maps). T26-P2-1 (KNOWN) concerned Convert to Path only. The measured error is within 0.05 mm (S3 0.026, S6 0.037, S16 0.036 mm).
- **Box from flattened bounds.** The handle box comes from the flattened polyline bounds (ellipse minX 100.049, not 100). The same box drives the map, preview and Apply, so nothing burns wrong.
- **One envelope for a multi-selection.** By design, and it matches the selection-wide handles. Groups are selected as their members.
- **Variable text guard (#1882 / #1900 / ADR-350 Amd 2) holds.** No template glyphs are built (S7).
- **Tabs (rolling v9 R3-P2-2) are fixed.** 0.000 mm on all 5 tabs (S12).
- **Path text and image masks.** Warp keeps ids, so the dependents still resolve (READ). Path text not following a reshaped guide is general behaviour, not Warp's.
- **Drawn-shape conversion drops `registrationJig` explicit identity** (materialize). This is the same as Convert to Path, KNOWN under T26-P3-1 (metadata). Copies carry their identity in their ids.
- **Not checked:** LightBurn's documented behaviour (docs fetch refused); a browser run of the hint and keys (`WarpDeformHint.test.tsx` and `warp-deform-tool.test.ts` exist, not rerun, to stay within memory); inch units (Warp has no numeric fields); performance with thousands of objects (conversion-budget test only).

## Totals
Raised 5; P1 0; P2 2; P3 3; known 2 (T26-P2-1 curve flattening by design for Warp per ADR-498; T26-P3-1 metadata `registrationJig` drop). Rolling v9 R3-P2-2 is confirmed fixed.
