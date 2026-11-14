# T33 Offset Shapes — auditor report
Tree: origin/main @ eeac725e8 (`C:\Users\stolk\kd-t1\t31-main`). Command id: `tools.offset-shapes`.

## Map
- **Command → dialog:** `tools.offset-shapes` (`src/ui/commands/editing-tools-commands.ts`, `tools-vector-menu-ids.ts`) opens `OffsetShapesDialogHost.tsx` → `OffsetShapesDialog.tsx`. The dialog picks its sources with `offsetShapesTargets` (`src/ui/state/offset-shapes-actions.ts:104-120`). Its live preview runs the same core call in the vector worker (`use-vector-op-preview`, ADR-609) and draws it in `OffsetShapesPreview.tsx`. Apply commits that settled result through `reusableOffsetShapes` (`vector-op-prepared.ts:88-101`) only when the sources (by identity), options and ids still match. Otherwise it computes the offset on the main thread.
- **Store:** `offsetShapesSelection` → `offsetShapesMutation` (`offset-shapes-actions.ts:122-178`). It adds each result with `prepareIndependentArtwork(scene, artwork, targets[0])` (:164), which clones the first target's operation. With Delete original objects it calls `removeOriginals` (:180-201), which repairs dependencies (mask and path-text guide), drops the sources from groups, gives the placed-tabs notice and prunes orphan layers. All of this is one undo step.
- **Core:** `src/core/geometry/offset-shapes.ts` uses Clipper2 `inflatePathsD`. Round → Round join. Bevel → Square join (Amd 2). Corner → Miter with limit 4. Open-line caps are Round or Square. Each ColoredPath is unioned under its fill rule. Shapes nested across objects become holes (`nestedSelectionRegion`, Amd 3). The selection is unioned non-zero. Arc tolerance comes from `offset-arc-tolerance.ts` (Amd 1/3).
- **ADRs:** ADR-410 item 3 and Amendments 1, 2, 3 and 5; ADR-103 (the panel offset); ADR-350 Amd 1/2 (the geometry-tool source guard, #1882/#1900); ADR-494 Amd 3 (placed-tabs notice); ADR-609 (worker preview). WORKFLOW F-A6c.
- **Since 2026-10-16:**
  - Amd 2 (Bevel = Square join, square caps), Amd 3 (nested holes, 0.005 mm source flattening) and Amd 5 (nesting cost).
  - ADR-609 worker preview with prepared-result reuse.
  - #1882 (guard via `selectedVectorObjects`) and #1900 (dialog path `offsetShapesTargets` now goes through `geometryToolSources`; replaced-source repair).

## October register re-check
Register row 40 (2026-10-16) covered winding, holes, caps and inward collapse, an outward 1 mm offset giving a new shape, and an exact Undo. All of it still holds:
- Outward and inward areas match the analytic oracles (G1).
- Holes are kept (G2, S2).
- Caps hold the distance (G2 open zigzag).
- Inward collapse is refused with a reason (G3).
- Undo restores the project byte-identically (S1).

## Checks run
| Check | Method | Result |
|---|---|---|
| Transformed rectangle (scale 2×0.5, rot 30/211°, mirror X/Y), 3 corner styles, Both | `t33-geom.test.ts` G1; analytic area oracles: round (W+2)(H+2)−(4−π), bevel −2(1−tan22.5°)², corner (W+2)(H+2), inward (W−2)(H−2) | All within 0.04 mm² (1 µm grid). Edge distance from source 0.997–1.001 (round), max 1.083 (bevel = d/cos22.5°·…), max 1.414 (corner). Distance is world mm after scale, rotate and mirror. |
| Ellipse (scaled circle), rounded rectangle, transformed text "B&8o" (counters, mirror, rotate, scale X), pentagram even-odd and non-zero, open zigzag, overlapping circles, plate + separate hole + island | G2/G4: exact distance-field oracle (point-in-region + segment distance), grid 0.03–0.1 mm | XOR/perimeter ≤ 0.009 mm in every case. Non-zero pentagram (true decagon boundary) and overlapping circles as a union (Amd 3 item 2) match. Edge distances within ±0.025 mm (chord budget). |
| Corner style on 90/45/20/10° tips | G3, edge-distance sampling | Round ≤ 1.001 d; Bevel ≤ 1.356 d; Corner keeps the full mitre to 45° (2.613 d) and squares sharper tips at ≈1.5 d (ADR-410 item 3: limit 4 d). Inward corners stay sharp, as ADR item 3 and LightBurn say. |
| Collapse, partial collapse, inward on open lines, Outer shapes only | G3, S3 | Full collapse is refused with a reason. Both + full collapse gives a notice. Partial collapse and open lines under Inward are **dropped silently** (finding P2-2). Outer shapes only: 1663.134 mm² (oracle 1663.142), inward 1344. |
| Numeric edge cases | G3 | 0, −1, NaN, ∞ and 0.0009 are refused with a reason. 0.001 mm is exact. 1e7 mm runs in 246 ms with 51k points (no hang). NaN vertex gives "operation-failed". Empty input and a single point give "Nothing to offset". A zero-area closed path is outlined as a stroke (23.133 vs 23.142). |
| Decoded G-code: transformed rect, Delete originals | `t33-store.test.ts` S2; decoder from zz-t26 | Lit length is 96.278 / 96.627 / 98.000 mm vs oracle perimeters 96.283 / 96.627 / 98.000 (round/bevel/corner). Plate + hole Both: 396.559 vs 396.566. |
| Inheritance, mixed operations, Undo/Redo, save/reopen | S1, S6 | One object and one operation clone from the **first source in scene order** carry every ring, with that source's powerScale, colour and override (finding P2-1). Undo is exact, Redo is equal, and the reopened file burns the same. The name is dropped. |
| Variable text / registration-jig guard on the dialog path | S4a/S4b: `offsetShapesTargets` (the dialog's own call) | **Fixed by #1900.** Variable text is left out with its notice, delete on or off. The jig is left out with its notice when Delete is on. Without Delete the jig boxes and art are offset as ordinary sources (`'variable'` guard, ADR-350 Amd 2); see P2-1 for what that does with unlocked boxes. |
| Delete originals with image mask, placed tabs, group | S4d | The mask reference is removed with a warning toast. The tabs notice is shown. The source leaves its group (group pruned). Same as Delete. |
| Locked-only selection | S4c | Refused: "Offset needs at least one vector shape." |
| Tree's own suites | `OffsetShapesDialogHost.test.tsx`, `offset-shapes-actions.test.ts`, `offset-shapes.test.ts`, `offset-separate-holes.test.ts` | 40/40 pass. They cover preview = Apply, the disabled Offset button with its reason, and remembered settings. |

Scripts and logs are in `C:\Users\stolk\kd-t1\zz-t33\`: `oracle.ts`, `t33-geom.test.ts`, `t33-geom2.test.ts`, `t33-store.test.ts`, `common.ts`, `decode.ts`, `t33-geom.log` and `t33-store.log`. To run:

`NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config C:/Users/stolk/kd-t1/zz-t33/vitest.config.mts --maxWorkers=1 t33-store`

## Findings

### T33-P2-1: A mixed selection's offsets all go onto one clone of the first source's operation. A cut outline's offset burns as Fill, a guide's offset burns at cut power, and an output-off first source makes the whole offset burn nothing.
- **Severity:** P2. This is a wrong burn with no warning. The canvas does show the result on a new operation, which is why it is not P1, though P1 is arguable for the guide-at-cut-power case. Weld refuses to merge across operations and settings. Union Silhouette asks which operation to use. Offset chooses silently, by scene order.
- **Where:**
  - `src/ui/state/offset-shapes-actions.ts:162-167` passes `targets[0]` for every created object.
  - `src/core/geometry/offset-shapes.ts:96-99, 289-310` builds one object from the unioned selection, with the first source's colour, `powerScale` and `operationOverride`.
  - ADR-410 item 3 says "The results get their own operation cloned from the first source (ADR-103 behaviour)". It was written for a one-source offset and says nothing about selections that span operations.
- **Repro:** `t33-store.test.ts` S1 and S6 (log `t33-store.log`).
  - **Line + Fill:** A is on Line L1 (override power 12 / speed 777, powerScale 50). B is on Fill L2 at 3000 / 30 %. Outward 1 mm, originals kept.
    - Scene order A,B: both rings go on a Line clone. B's offset is cut at F777 S60 (burn after: F777 192.559 mm + F3000 2000).
    - Scene order B,A: both rings go on a Fill clone with powerScale 90. A's cut outline offset is hatched (F3000 S270: 2000 → 7261.964).
  - **Output-off guide + cut part, Delete originals:**
    - Guide first: the burn goes from F400 S950 60.000 mm to **nothing**. The new operation has output=false and there is no toast.
    - Part first: the guide's offset burns at the part's 95 % cut settings (192.559 mm instead of 66.283).
  - **Registration jig:** Select All with unlocked jig boxes (after Unlock All), Offset outward without Delete. All 4 rings land on a clone of the Registration operation (output=false). The art offsets never burn: the burn is 125.592 mm before and after, with no notice. With locked boxes the offset ring becomes an extra non-jig run (jig runs 2 → 3, +138.2 mm). That burns but is outside the piece-by-piece order.
- **Oracle:** The operation the user assigned to each source. Each source's offset should burn with its own source's settings, which is what Weld's per-operation batches and Union Silhouette's explicit choice do.
- **Suggested fix:** Batch the targets by effective operation and settings (Weld's `batchKey`). Offset each batch onto a clone of its own operation. Or refuse or ask, as Union Silhouette does, when the selection spans operations or includes an output-off operation. The panel offset (`offsetVectorObjects`, ADR-103) has the same single-object shape (READ ONLY).

### T33-P2-2: Inward with Delete original objects silently deletes shapes that produced no offset: small shapes that collapse and open lines
- **Severity:** P2 (missing warning; artwork leaves the burn).
  - The tool already warns when the whole inward offset collapses under Both (`offset-shapes-actions.ts:151-160`).
  - It refuses Inward on open lines alone with a reason (`offset-shapes.ts:115-120`).
  - It says nothing when only part of the selection produces nothing. With Delete on, those sources are removed anyway (`removeOriginals` removes every target).
- **Where:**
  - `src/core/geometry/offset-shapes.ts:121-131`: the inward pass drops open paths, and the error fires only when the whole inward result is empty.
  - `src/ui/state/offset-shapes-actions.ts:151, 168`.
- **Repro:** `t33-store.test.ts` S3.
  - **(a)** A 20 mm square and a 2 mm square, Inward 1.5, Delete on: `ok true`. The burn goes from 88.000 to 68.000 mm. The 2 mm square's 8 mm cut is gone. Toasts: none.
  - **(b)** The same selection with Both: the small square gets only an outward ring, and there is no notice.
  - **(c)** A square and a 30 mm open line, Inward 1, Delete on: the burn goes from 110.000 to 72.000 mm. The line is deleted with no offset and no toast.
  - **(d)** The open line alone is refused with "Inward offset needs a closed shape" (control).
- **Oracle:** Inward erosion of a 2 × 2 mm square by 1.5 mm is empty, so nothing replaces it. LightBurn: "You can only create Inward offsets for shapes that are closed". The source should survive or the user should be told.
- **Suggested fix:**
  - Keep (do not delete) any source that contributed nothing to the result, and say so. A simpler alternative is a notice naming how many shapes collapsed or were open lines.
  - Extend the Both notice to partial collapse.

## P3
- **T33-P3-1 (READ ONLY):** The distance must be at least 0.001 mm, but LightBurn documents a 0 distance as a way to "repair odd or broken vectors". KerfDesk refuses 0 with "must be a positive number". This is a parity gap; the ADR does not mention it.
- **T33-P3-2:** Results drop the source's `name`. The source string "Offset outward (1 mm)" is the only label (S1, G3 meta). This is minor, since LightBurn's new shapes are unnamed too.
- **T33-P3-3:** The dialog does not say which operation the results will use. This is a lesser form of P2-1 that a one-line status would cover.
- **T33-P3-4 (READ ONLY):** The distance field takes any size: 1e7 mm is accepted and makes a 20 km outline. It is harmless (246 ms, preview shows it), but there is no bed-size sanity hint.

## Not a defect / limits
- **Corner style squares tips sharper than about 29° at ≈1.5 d** (10° tip: 1.48 d instead of an 11.47 d mitre). ADR-410 item 3 chose the limit of 4 so that spikes do not shoot out of the art.
- **Inward corners stay sharp for every style.** ADR item 3 and the LightBurn page ("only beveled or rounded when they're created in the direction a corner points") agree.
- **Overlapping separate objects union rather than cancel.** ADR-410 Amd 3 item 2 decides this. Separately drawn holes and islands nest correctly (G2: 0.000 XOR).
- **Results are chords, not arcs.** Known (T26-P2-1 family; ADR-410 Amd 1/3 tolerance budget held: edge distance within ±0.025 mm).
- **Variable text and the jig on the dialog path:** fixed by #1900 (S4a/S4b). The T29 pointer can be closed.
- **Mask and guide repair under Delete originals** works with its warning (S4d), as #1900 intended.
- **Not checked:**
  - Browser-driven dialog (free memory was 1.3–1.7 GB, below the 2 GB gate). jsdom suites cover the dialog.
  - CNC (Offset is a vector edit; output is the ordinary path).
  - LightBurn's own layer choice for a mixed selection: its docs are silent, a forum search found nothing, and there is no LightBurn install here.

## Totals
Raised 6; P1 0; P2 2; P3 4; known 1 (T26-P2-1 chord flattening, not re-raised; the T29 pointer on the dialog guard is verified fixed by #1900).
