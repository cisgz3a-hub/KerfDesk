# T12 Shear: refuter report
Tree: origin/main @ 856cb3ae1. Command id: `tools.shear`. Scratch: `C:\Users\stolk\kd-t1\zz-t12r`.

## Verdicts

| Claim | Verdict | Level |
|---|---|---|
| T12-P2-1: combined Horizontal and Vertical shear collapses the art at tanα·tanβ = 1 and mirrors and enlarges it beyond, with only "Sheared 1 object." | **CONFIRMED** (rationale and fix partly corrected) | P2 (not P1) |

**What holds.** I reran this with my own method: a polyline-only asymmetric L, world points through the scene's own `applyTransform` rather than the shear code, a Fill and a Line layer, `prepareOutput` advisories, and my own G-code walker.
- 45/45, 30/60 and −45/−45 collapse the L to zero area. A Fill burns **0.000 mm**, or 0.161 mm of specks at 30/60. A Line burns the outline as a doubled straight line.
- 60/60 and 85/85 mirror the art (signed area −2.000× and −129.6×) and enlarge it.
- In all 18 runs `prepareOutput` is ok with **zero advisories**, and the toast is "Sheared 1 object.".
- The dialog defaults to H 15 / V 0. It has no preview element, and for 45/45, 30/60, 60/60 and 85/85 it shows no alert and leaves Shear enabled.
- Neither `shear-actions.ts` nor `ShearDialog.tsx` checks the determinant.

**What I correct.**
1. *The simultaneous form is not a bug in itself, and LightBurn is not the reference for it.*
   - LightBurn has no numeric shear. Its Transform Controls page (2.1) describes drag handles that each skew one axis, and it names no shear angle entry. So "LightBurn composes X then Y" describes drags; it is not a specification for a two-field dialog.
   - The closest analogue with two angle fields is Inkscape's Transform → Skew. It uses the **same simultaneous matrix**: `ObjectSet::skewRelative` builds `Geom::Affine(1, dy, dx, 1, 0, 0)` (`src/selection-chemistry.cpp`). CSS `skew(ax, ay)` does the same, and the October vector audit cites it as R7 for this tool.
   - Inkscape therefore also mirrors past the singular point. But it **refuses the singular case** (`src/util/transform-objects.cpp`, `transform_skew`) with the message "Transform matrix is singular, not used." KerfDesk has no such guard.
   - The defect is the missing singular refusal and the missing warning. Switching to sequential composition would change every combined result (for example, 20/−10 keeps area ×1.064 today), so that switch is a maintainer decision and not the minimal fix.
2. *Documented intent.* No ADR covers Shear itself. ADR-431 covers exact affine curves and ADR-494 Amd 4 covers tabs. The only record of the combined case is `docs/audits/2026-10-15-tools-vector.md:108`, "Simultaneous X/Y shear can itself become singular", and register row #58, "combined X/Y may be singular by construction". Both log it as a known limit with no decision and no ledger row. Neither the help text (`layout-command-help.ts:93`, "horizontally and/or vertically") nor the dialog tells the user that both angles together can flatten or mirror the art.

**Why P2 and not P1.**
- AREAS.md P1 is "wrong burn, wrong size or place". Here the burn matches the canvas exactly: the walker's lit extents equal the canvas box to within 0.1 mm in every case.
- The user has to replace the default V = 0 on purpose.
- The result is drawn as soon as they apply it, and it is obvious. At 60/60 the canvas box goes from 20×10 to 26.9×38.6 and the L appears reversed. At 45/45 the shape becomes a line.
- Undo restores the original exactly.
- That matches P2: "a wrong result the user is likely to notice … or a missing warning". The P2 claim stands because nothing warns in the dialog, the toast, or the pre-emit advisories. A Fill object that burns nothing passes `prepareOutput` silently.

## Evidence (ran)

Run from the tree: `node node_modules/vitest/vitest.mjs run --config ../zz-t12r/vitest.config.mts --maxWorkers=1 r12.test.ts r12dialog.test.tsx r12b.test.ts` with `NODE_OPTIONS=--no-experimental-webstorage`. Free memory was 2.7–2.8 GB. All 3 files and 5 tests passed.

`zz-t12r/r12.log`: an L of area 104 mm² and size 20×10 at (100,100). Area uses world points via `applyTransform`; lit length uses my own G-code walker.

| Pair | Oracle det | Area ratio | Canvas box | Fill lit mm (before 1040) | Line lit mm (before 60) | Advisories | Toast |
|---|---|---|---|---|---|---|---|
| 15/0 | 1 | 1.000 | 21.07×10 | 1040 | 60.7 | none | Sheared 1 object. |
| 20/−10 | 1.064 | 1.064 | 21.46×13.53 | 1106.8 | 61.9 | none | same |
| 44/45 | 0.0343 | 0.0343 | 23.86×24 | 35.8 (sliver) | 84.4 | none | same |
| 45/45 | 0 | 0.000 | 24×24 | **0.000** | 84.85 (doubled line) | none | same |
| 30/60 | 0 | 0.000 | 22.31×38.64 | **0.161** (specks) | 103.1 | none | same |
| 60/60 | −2 | **−2.000 (mirrored)** | 26.93×38.64 | 2080 | 120.0 | none | same |
| 85/85 | −129.6 | **−129.6 (mirrored)** | 118.3×232.6 | 134 832 | 688.4 | none | same |
| −45/−45 | 0 | 0.000 | 30×30 | **0.000** | 84.85 | none | same |
| 45/−45 | 2 | 2.000 | 24×30 | 2080 | 84.85 | none | same |

Every run left 1 undo step. The area ratio matched the oracle 1 − tanα·tanβ to 6 decimals.

`zz-t12r/r12dialog.log`:
- Defaults: H=15, V=0.
- The dialog contains no canvas, svg or img (no preview). Its text is "Slants the selection about its centre, up to 85° each way…", with no mention of combined angles.
- 45/45, 30/60, 60/60 and 85/85: Shear enabled, `alert=null`.

External sources: LightBurn 2.1 Transform Controls (docs.lightburnsoftware.com/2.1/Reference/TransformControls/). Inkscape master `src/selection-chemistry.cpp` (`skewRelative`) and `src/util/transform-objects.cpp` (`transform_skew` singular refusal).

**Suggested fix (revised):**
- In both `ShearDialog` and `shearMutation`, refuse when |1 − tanα·tanβ| < ε, with a message as Inkscape does.
- Have the dialog say so, for example "Horizontal and vertical together would flatten the artwork", or warn when the product is ≥ 1 (mirrored result).
- Add tests for 45/45, 30/60, 60/60 and 44/45.
- Keep the simultaneous form unless the maintainer chooses sequential composition.

## Extra findings

### T12R-P3-1: Shear does nothing and says nothing when every selected target is refused inside the loop
- **Severity P3:** nothing changes and nothing burns wrong. The only case a user can reach is a legacy polyline shape that is ambiguous across several sub-paths, which is rare. The result is a silent no-op, unlike the drawn-rectangle case, which gets a "convert first" toast.
- **Where:** `src/ui/state/shear-actions.ts:57-58` (`localBakeMatrix(...) === null` returns the object) and `:68` (`synchronizePolylineShapeGeometry(...) === null` returns the object). When `sheared === 0`, `:86` returns `state` without a toast. Such objects are also not counted in `skipped` (`:45`), so a mixed selection says "Sheared 1 object." and does not mention the unchanged object.
- **Repro (ran, `zz-t12r/r12b.log`):**
  - A polyline shape with a second sub-path, alone, sheared 30/0: toast "", undo 0, project unchanged.
  - An imported object with scaleX 0, alone, sheared 30/0: toast "", undo 0. This case is probably not reachable from the UI.
  - Control: a normal drawn polyline sheared 30/0 gives box 20 → 25.774 (oracle 20 + 10·tan30 = 25.774), worst vertex deviation 0.0000 mm, spec points 4 → 4, and the object stays `shape`.
- **Oracle:** the rule in the same action, that a selection with nothing shearable gets a toast (`:47-51`).
- **Suggested fix:** count refusals inside the loop as skipped, and toast "Nothing was sheared: …" when `sheared === 0`.

## Not a defect / limits
- **Sketch and part-generator sources:** an imported SVG that keeps `constrainedSketch` or `partGenerator` keeps that source after a shear. Its editor already flags `replacesManualGeometry` / `geometryMismatch` before regenerating, as it does for every path edit, so this is not specific to Shear.
- **Re-trace in place** replaces sheared traced paths. That is an explicit user action, Undo restores the paths, and it is the same for every path edit.
- **Opposite-sign pairs** (45/−45 gives area ×2, not mirrored) enlarge the art. This is how the simultaneous form behaves (Inkscape does the same). It belongs under the same warning, not a separate finding.
- **No browser run** (memory gate). Job Review UI text was not checked visually. I relied on the `prepareOutput` advisories, which feed the pre-emit findings, and they were empty in every case.

## Totals
Verdicts: T12-P2-1 CONFIRMED at P2 (not P1). Its LightBurn parity rationale and its sequential-composition fix are corrected: the minimal fix is a singular refusal plus a warning, as Inkscape has. Extra findings raised: 1 (P1 0, P2 0, P3 1).
