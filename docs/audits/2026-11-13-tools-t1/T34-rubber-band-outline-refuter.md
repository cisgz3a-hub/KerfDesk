# T34 Rubber-Band Outline — refuter report
Tree: origin/main @ eeac725e8 (`C:\Users\stolk\kd-t1\t31-main`). Command id: `tools.rubber-band-outline`.
Auditor report: `C:\Users\stolk\kd-t1\reports\T34-rubber-band-outline.md`.

**Method.** I wrote my own Vitest file, `C:\Users\stolk\kd-t1\zz-t34r\r34.test.ts`, with my own fixtures:
- a CNC sign built on `benchmarkProject()` with a V60 V-bit and a 6 mm end mill (not the auditor's `cncToolSectionProject`);
- laser projects built from my own polylines.

It drives the real `addRubberBandOutline`, `selectAllObjects`, `offsetShapesSelection`, `undo`/`redo`, and `prepareOutput` → `emitPreparedGcode`.

The G-code is read by my own decoder, `C:\Users\stolk\kd-t1\zz-t34r\gdec.ts`. I did not reuse the auditor's `decode.ts`. It reads two kinds of output:
- **Laser:** lit length per consecutive `F…/S…` run, with M3/M4 on, S > 0, and G1/G2/G3 (arcs sampled).
- **CNC:** XY length below Z 0, the deepest Z, and the swept area. The swept area stamps the tool radius on a 0.2 mm grid: 3 mm for the end mill, and |z|·tan 30° capped at 3 mm for the V60.

Logs:
- `C:\Users\stolk\kd-t1\zz-t34r\r34-R1-R4.log`: R1 to R4, 4/4 pass, 1.94 GB free, `--maxWorkers=1`.
- `C:\Users\stolk\kd-t1\zz-t34r\r34.log`: R5 only, 2.38 GB free.

Run from the tree root:
`NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config C:/Users/stolk/kd-t1/zz-t34r/vitest.config.mts --maxWorkers=1 r34`

## Verdicts

| Claim | Auditor | Verdict | Final |
|---|---|---|---|
| T34-P1-1 CNC outline copies a Pocket/V-carve operation and clears the hull | P1 | **UPHELD, widened.** The commonest trigger is V-carve sign text selected **alone**. The hull is then V-carved at the full bit depth over its whole area, 82.5 m of toolpath, and the letters are erased. The ADR's "new Line operation named Outline" fallback can never run in CNC, because every CNC operation has mode `line`. Nothing warns, and the design canvas draws a plain line. | P1 |
| T34-P2-1 override/power scale dropped; output-off source inherited; silent scene-order choice | P2 | **UPHELD.** The outline burns at F1200/S250, where the source burns at F250/S760 and Offset from the same source keeps F250/S760. Select All with an output-off guide drawn first adds an outline that burns 0 mm, with no advisory. No ADR documents dropping the override. | P2 |
| T34-P3-1 variable-text notice does not say the outline skips it | P3 | CONFIRMED (R4, text and barcode) | P3 |
| T34-P3-2 tiny square refused as "straight line", sliver accepted | P3 | CONFIRMED (READ + arithmetic on `MIN_OUTLINE_AREA_MM2 = 1e-4`) | P3 |
| T34-P3-3 "first selected" is scene order | P3 | CONFIRMED (R1b: the user selected the cut-out first, and the scene-first pocket won). Fold it into the P1-1 / P2-1 fix. | P3 (fold) |
| #1900 / ADR-350 Amd 2 `variable` guard covers this tool | — | CONFIRMED for variable text **and** variable barcode, which the auditor did not run (R4) | — |
| **T34R-P2-1** (new) a Line source with a Fill sub-operation hatches the whole hull | — | REPRO (R5) | P2 |

## Evidence per claim

### T34-P1-1: UPHELD at P1, widened

**Intent.**
- ADR-480 item 3 (`docs/decisions/ADR-480-design-tools-lightburn-gap-batch-5.md:53-59`) says: "the outline takes a copy of the first selected artwork's Line operation settings (the ADR-103 offset rule), or a new Line operation named Outline when nothing selected is on a Line operation."
- The action's header comment (`rubber-band-outline-actions.ts:1-4`) says "so it cuts like the artwork's own outline".
- WORKFLOW F-A6e item 1 repeats "a copy of the first selected Line operation's settings".
- Neither the ADR nor WORKFLOW considers CNC. "Line operation" is a laser concept. In CNC, `createLayer` defaults every operation to mode `line` (`layer.ts:256-267`), so `bindOutline`'s test `primaryOperationForObject(...)?.mode === 'line'` (`rubber-band-outline-actions.ts:99-101`) is always true for CNC. As a result:
  - The "new operation named Outline" fallback is unreachable in CNC.
  - The outline always clones the cut type of the scene-first selected source, including `cnc.cutType`, through `independentOperationForArtwork` (`vector-path-actions.ts:346-366`).
- The tool has no dialog, so nothing shows or lets the user choose the operation or cut type.

**Repro R1.** All rows use my own CNC sign: stock 100×80×12, V60 and end6. "Swept" is the area the tool passes over.

| Case | Outline operation | Outline alone | Oracle: same hull on a fresh operation (project default, On path 1 mm) | Oracle: same hull on the cut-out's Outside path, 12 mm |
|---|---|---|---|---|
| a. two V-carve letters only (hull ≈ 1,800 mm²) | **V-carve (angled bit)**, v60 | cutXY **82,512 mm**, minZ **−5.196**, swept **1,875 mm²** (the whole hull) | 164.7 mm, −1.0, 987 mm² | 748.6 mm, −12.0, 1,117 mm² |
| b. pocket recess first in the scene + cut-out (the user selected the cut-out first) | **Pocket (clear inside)**, end6, 3 mm | cutXY **4,773.6 mm**, minZ −3.0, swept **4,193 mm²** (the hull is 70×60 = 4,200 mm²) | 260.0 mm, 1,553 mm² | 1,136.0 mm, −12.0, 1,697 mm² |
| c. cut-out first in the scene + pocket | Outside path, 12 mm | 1,136.0 mm, −12.0, 1,697 mm² (correct) | — | identical |
| d. pocket only (a convex square) | Pocket | 345.6 mm, −3.0, 393 mm². This re-pockets the same area; no new harm with a convex source. | — | — |
| e. engrave scribe only | Engrave 0.5 mm | 180 mm, −0.5. A shallow trace, not a cut-out, but harmless. | — | — |

- In every row, the toast was the plain "Added a rubber-band outline around N objects (… mm)", and `prepareOutput` returned no advisory.
- Undo restores the identical project object, and Redo is JSON-equal.

**How ordinary the trigger is.**
- Case (a) is the textbook CNC use: a sign whose text V-carves, then "make me a cut line around it".
- Text on a CNC project defaults to V-carve whenever a V-bit is mounted on Pro (`text-layer-policy.ts:7-17`, `cnc-text-defaults.ts`). Users do not have to choose anything unusual.
- Case (b) needs only the pocket to have been drawn before the cut-out, which is the usual design-then-cut-out order. Selection order does not help, because P3-3 makes scene order win.

**Visibility before running.**
- The **design canvas** draws CNC operations as plain outlines. No workspace drawing code reads `cutType`; only `canvas-preparation-policy.ts` and `vcarve-preparation-routing.ts` do. The hull therefore looks exactly like a cut line.
- The **Cuts / Layers row** reads "V-carve (angled bit)" or "Pocket (clear inside) · 3 mm deep" (`LayerRow.tsx:198-200`).
- **Job Review at Start** (ADR-237) shows a card "Rubber-band outline" with a cut-type chip (`JobReviewCncOperationCard.tsx:35-40`). It is a display, not a warning.
- The 3D preview shows the clearing only if the user opens it.

**Grade.** P1 stands.
- The harm is the whole convex area milled, or V-carved 5.2 mm deep. That erases the letters or the part face, a wrong cut that ruins the workpiece.
- The only signal is a cut-type label in the Cuts list and on a Job Review card, with no warning.
- The ledger kept exactly that level of visibility at P1:
  - T24-P1-2: defaults visible in Job Review, generic advisory only.
  - T06-P1-1: Job Review named the wrong preset.
- It re-graded to P2 only when the canvas shows the result (T29-P1-2) or Job Review actively warns (T30-P1-2). Neither happens here.
- One argument for P2: a user making a through-cut must open the new operation to set its depth, and may then notice the cut type. That holds for case (b) at 3 mm, but not when the copied depth already looks right, and not for a decorative border. It does not lower the grade.

**Fix (refined).**
- In CNC, accept as a source only an operation whose `cnc.cutType` starts with `profile`.
- Otherwise create the "Outline" operation the ADR already describes. On CNC that means the project default, On path, or better Outside path. Do not inherit a pocket, V-carve, inlay, drill or relief cut type.
- Add a case with V-carve text alone and one with a pocket first in the scene.
- The same eligibility test should also reject laser sources with enabled Fill or Image sub-operations (T34R-P2-1).

### T34-P2-1: UPHELD at P2

**Override and power scale (R2).**
- The source is a 30×20 plate on "cut" (25 %, 1200 mm/min) with `operationOverride {power 95, speed 250}` and `powerScale 80`. A second, plain 10×10 hole is on the same operation.

| Burn | Decoded |
|---|---|
| source plate alone | `F250/S760` 100.00 mm |
| hole alone | `F1200/S250` 40.00 mm |
| outline operation | `{power 25, speed 1200, output true}`, object override `undefined`, powerScale `undefined` |
| **outline alone** | **`F1200/S250` 132.36 mm**: 33 % of the plate's S at 4.8× its feed, so it will not cut through |
| outline with the hole first in the scene | `F1200/S250`, the same |
| Offset Shapes +1 mm from the same plate | **`F250/S760`** 106.28 mm (keeps the override and powerScale 80) |

**Is dropping the override documented? No.**
- ADR-480 item 3 calls the rule "the ADR-103 offset rule".
- ADR-410 item 3 says the offset results get an operation "cloned from the first source (ADR-103 behaviour)". Offset implements that by copying `operationOverride` and `powerScale` onto the result before `prepareIndependentArtwork` (`offset-shapes.ts:300-303`). Boolean compounds do the same (`boolean-compound.ts:41-44`). Rubber-band is the only caller of `prepareIndependentArtwork` whose artwork carries neither.
- ADR-350 item 2 says base settings replace source overrides **only** for Union Silhouette, and only with an explicit operation choice and a dialog that explains it.
- ADR-540 Amd 3 concerns Pro admission for override-isolated clones and says nothing about dropping overrides.

**Output-off source (R3).**
- Layout: a guide 100×60 on an output-off Line operation, drawn first, plus two parts on "cut" (90 %, 300).
- Select All picks all three (`["guide","a","b"]`).
- Rubber-band then gives an outline operation `{output false, power 10}`.
- Lit length is 180.000 mm before and 180.000 mm after: the outline never burns.
- The toast reads "Added a rubber-band outline around 3 objects (100 × 60 mm)", and `advisories` is `[]`.
- Control, selecting only the two parts: output on, and the outline burns at `F300/S900`.

**Grade.** This matches T33-P2-1, which the T33 refuter upheld at P2 for an operation picked silently by scene order with no warning when output is off. The outline's operation is visible in the Cuts list with its values and output state, and Undo is exact. It stays P2, not P1.

**Fix.**
- Clone from the source's effective settings, as Offset does: copy `operationOverride` and `powerScale` onto the outline before `prepareIndependentArtwork`.
- Skip output-off operations when choosing the source.
- Name the copied operation in the success toast.

### T34-P3-1: CONFIRMED
R4:
- Rect + variable text: info toast "Variable text was left as text: use Bake Variable Text first to fix its value.", and the outline goes round the rect only (0..10).
- Rect + variable barcode: "A variable barcode was left as it is: …", same result.

Neither notice says the band does not go round the left-out object.

### T34-P3-2: CONFIRMED (READ + arithmetic)
`rubber-band-outline.ts:21,30` refuses a hull below 1e-4 mm².
- A 0.008 mm square has area 6.4e-5 mm², so it is refused with "lies on one straight line".
- A 50 × 0.0015 mm sliver has area 0.075 mm², so it is accepted.

The wording is wrong for the square. A minimum-width test would treat both the same way.

### T34-P3-3: CONFIRMED
In R1b the user selected `cutout-1` first, then `recess-1`, but the outline took the scene-first pocket (`scene0.objects.filter(...)`, l.61). This is the mechanism behind P1-1 and P2-1, so fix it with them.

### #1900 / ADR-350 Amd 2 guard: CONFIRMED
`rubber-band-outline-actions.ts:57-67` calls `geometryToolSources(..., 'variable')`, as ADR-350 Amd 2 item 4 says ("Rubber-Band Outline: `variable`").

R4 results:

| Selection | Result |
|---|---|
| variable text alone | refused, `[warning]` notice, `undo=0` |
| variable barcode alone | refused, `[warning]` notice, `undo=0` |
| both together | one combined warning, nothing added |
| either with a rect | outline round the rect only, `[info]` notice |

The menu is still enabled for a variable-only selection (`ctx.hasSelection`), but the refusal explains itself.

## Extra findings

### T34R-P2-1: A source on a Line operation with a Fill sub-operation gives an outline that hatches the whole hull
- **Severity:** P2.
  - It burns outside the art: the gap between the parts is engraved. The bare table would say P1.
  - The design canvas paints Fill pools, sub-operations included (`fill-operations.ts:45` uses `outputOperationLayers`; `draw-scene.ts:342-346`). The filled hull is therefore visible as soon as the tool runs. By the T29-P1-2 precedent that makes it P2.
  - It needs a deliberate Line + Fill sub-operation setup. Sub-operation mode is selectable in `LayerSubLayers.tsx:142-150`.
- **Where:** `rubber-band-outline-actions.ts:99-101` tests only the root operation's mode. `independentOperationForArtwork` (`vector-path-actions.ts:347-352`) copies every sub-layer, Fill included.
- **Repro (R5):**
  - Root "art" Line 80 %/400 with an enabled sub-operation "Engrave" Fill 30 %/3000 at 0.5 mm. Two 10×10 squares, 40 mm apart diagonally.
  - Sources: `F400/S800` 80 mm + `F3000/S300` 400 mm.
  - Outline operation: `mode=line`, subLayers `[{mode: fill, enabled: true}]`.
  - Outline alone: `F400/S800` 140.00 mm + **`F3000/S300` 1,600.00 mm** of hatch across the whole 50×40 mm hull extent.
  - Total lit length: 480.0 mm before, 2,220.0 mm after.
  - The toast is the plain success message.
- **Oracle:** a cut-around outline should burn only its 140 mm perimeter. That is the ADR-480 intent ("Line operation settings"), and LightBurn's documented use is cut lines around artwork.
- **Fix:** the same eligibility fix as P1-1. Accept a source only when its root and every enabled sub-operation is a Line (or a profile, in CNC). Otherwise make the new "Outline" Line operation.

## Not a defect / limits
- **CNC engrave sources (R1e)** give a shallow traced hull. It is not a cut-out, but it is not harmful, and it is the user's own operation.
- **CNC pocket source, convex (R1d)** re-pockets the same square. Harm needs a concave or multi-part selection, as in R1b.
- **Not checked:** the desktop Free path, where cloning a V-carve operation should ask for Pro under ADR-540 Amd 3 (the setter's `committed === false` branch); the browser/menu UI; rotary.
- **Laser hidden-operation sources** (`visible: false`) can be selected only by unusual routes (Select All excludes them). Not pursued.

## Totals
Verdicts: T34-P1-1 UPHELD P1 (widened: V-carve text alone V-carves the whole hull; the Outline fallback is unreachable in CNC); T34-P2-1 UPHELD P2; T34-P3-1, P3-2, P3-3 CONFIRMED P3 (P3-3 folds into the P1-1/P2-1 fix); #1900 / ADR-350 Amd 2 guard CONFIRMED for variable text and variable barcode. Extra raised: 1 (T34R-P2-1 P2: a Line source with a Fill sub-operation hatches the whole hull).
