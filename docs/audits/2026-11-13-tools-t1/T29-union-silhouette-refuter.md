# T29 Union Silhouette — refuter report
Tree: origin/main @ f8c17f8c4 (read-only). Command id: `tools.union-silhouette`.
Method: my own Vitest file `C:\Users\stolk\kd-t1\zz-t29r\r.test.ts` (jsdom, real store, real gates `unionSilhouetteOperations` / `selectionCanWeld`, real `prepareOutput` / `prepareOutputSnapshot` → `emitPreparedGcode`, real `drawScene` with a recording 2D context) and my own G-code decoder `zz-t29r\gdec.ts` (absolute G0–G3, M3/M4/M5, modal S/F; lit length, bbox, lit runs, lit length outside an analytic region sampled every 0.02 mm). Own fixtures: Tinos instead of Roboto, `LOT-{{serial:3}}` parsed by the real `parseVariableTemplateSource`, square masks with analytic regions, a jig built by the real `applyCenterArtworkInRegistrationJigSet`. Log: `zz-t29r\r.log`. Free memory 3.2–3.4 GB before each run; one worker.

## Verdicts

| Finding | Auditor | Refuter | Why |
|---|---|---|---|
| T29-P1-1 variable text materialised to template glyphs | P1 | **Confirmed P1** | Reproduced on my own fixture; reached by Select All; canvas draws the template both before and after, so nothing shows; Weld (guarded by #1882) refuses the same selection with a notice |
| T29-P1-2 unioned image mask: whole photo burns | P1 | **Re-graded P2** | Burn reproduced (83 % of the lit length outside the mask), but the design canvas stops clipping the photo at the same moment (clip depth 1 → 0), so the canvas shows exactly what burns: "a wrong result the user is likely to notice" plus a missing warning |
| T29-P2-1 jig artwork merged / boxes absorbed | P2 | **Confirmed P2 (narrowed)** | Reproduced; a more ordinary route found (union the pieces of box A only). In the locked-box Select All case the burn order is not materially harmed once everything is on one operation; the harm is loss of jig linkage and boxes that burn different artwork |
| T29-P2-2 placed tabs dropped without notice | P2 | **Confirmed P2** | Reproduced; Weld on the same input gives ADR-494 Amd 3's notice, Union gives none; placed tabs are not drawn outside the tab tool |

## Evidence per claim

### T29-P1-1 — Confirmed P1
- **Code (read):** `selection-command-state.ts:130-149` `unionSilhouetteOperations` filters only `locked` and `isVectorPathObject`; `vector-repair-actions.ts:159-169` `selectedRepairObjects` filters `locked`, `isBooleanCompoundObject`, `isVectorPathObject`. Neither calls `geometryToolSkipReasons` / `geometryToolSources` (`rg` over `src/ui`: the only callers are `selectionCanWeld`/`geometryToolCandidates`, `BooleanDialogHost.tsx:222` and `selectedVectorObjects`). `isVectorPathObject` is `'paths' in object` (`vector-path-tools.ts:63`), which is true for text.
- **Run (R1):** Tinos 8 mm `LOT-{{serial:3}}` at (20, 30) on op L plus a 6×10 tag overlapping its left edge.
  - Gates: union ops (text + tag) `[L]`, (text alone) `[L]`; Weld gate for the text alone `false`.
  - Ordinary route: `selectAllObjects()` → `["VT","TAG"]` → menu enabled → Union on L.
  - Before: serial 7 lit 187.932 mm, bbox x 18 → 49.020; serial 8 lit 198.311 mm (G-code differs).
  - After: result `imported-svg`, `variableTemplate` undefined; serial 7 and 8 both 306.092 mm, bbox x 18 → 75.430, **G-code identical**. Toast only "Created one silhouette using L."
  - Oracle (own Tinos render): "LOT-007" right edge 49.020; template right edge 75.430. The burn after Union is the template glyphs, braces included.
  - Weld control on the same Select All: text kept as variable text, toast "Variable text was left as text: use Bake Variable Text first…".
- **ADR:** ADR-350 Amd 1 item 1 names Weld, Booleans, Offset, Dogbone; its context says "every tool that rebuilds an object's outlines had the same exposure". Union silhouette is an omission, not an accepted exception (only Convert to Path has ADR-386 Amd 2's barcode acceptance).
- **Severity:** wrong burn on every record, nothing on the canvas changes (it draws the stored template either way), no notice. P1, the same grade as T26-P1-1 and T28-P1-1.

### T29-P1-2 — Re-graded to P2
- **Code (read):** `unionSelection` (`vector-repair-actions.ts:56-108`) removes the sources and never calls `repairRemovedObjectReferences`, unlike `joinSelection` (`:152-156`). `compile-job-raster.ts:406-407` finds no mask → burns unmasked; `image-mask-off-image-issues.ts:47-49` skips a missing mask ("A missing mask … masks nothing"). Canvas: `draw-scene.ts:411-415` passes `maskObject: … ?? null`, and `draw-raster.ts` `liveMaskRegion` returns `undefined` for a null mask, so the canvas draws the photo unclipped.
- **Run (R2):** 40×40 px photo, 2 lines/mm, all black, at (50, 50); 16×16 mm square mask on a non-output Guide op centred on it; 6×4 mm ear on the mask's right edge; real `applyImageMask`.
  - Unmasked: lit 3200.000 mm, bbox 50–90 × 50.25–89.75.
  - Masked: lit 512.000 mm, bbox 62–78; lit outside the mask 0.000 mm; canvas clip depth at drawImage 1.
  - Union (gate `[guide]`): `imageMaskId=mask`, live false; lit **3200.000 mm**, **2656.000 mm outside mask ∪ ear**; preflight `[]`, prepareOutput advisories `[]`; **canvas clip depth 0** (whole photo drawn); toast "Created one silhouette using Guide."
  - Save → reopen keeps the dangling id (known T19-P3-3: open does not repair). Undo restores the mask (0.000 mm outside).
  - Delete control: id cleared, lit 3200, warning "1 image mask reference was removed… The image remains editable and unmasked." So Delete burns the same whole photo; the difference is the warning.
- **Earlier checks:** none. No preflight issue, no output advisory, so Job Review is silent. The only signal is the canvas itself, which now shows the whole photo.
- **Grade:** the burn matches the canvas, which changes visibly at the moment of the edit (a 16 mm square becomes a 40 mm photo). That fits the P2 row ("a wrong result the user is likely to notice … or a missing warning"), not P1's silent wrong burn. Precedents agree: H5-P1-1 was P1 because the canvas did *not* show the masks; T16-P2-2 (canvas/burn mismatch) was P2. Caveat for the coordinator: when the mask covers almost the whole photo (e.g. a rounded-corner mask), the canvas change is small (only the corners) and could be missed. The coordinator may keep P1 if that case weighs more. The route (union a mask shape with another shape to grow the mask) is plausible but not common.

### T29-P2-1 — Confirmed P2, narrowed
- **Code (read):** no `'replace'` guard in the union path (as P1-1). Weld's guard (`geometry-tool-sources.ts:50-61`) leaves out the registration boxes and every jig piece.
- **Run (R3/R3e):** two 50 mm registration boxes; S1 (20×10) and S2 (10×20) overlapping on op art; real `applyCenterArtworkInRegistrationJigSet` makes copies in box B (instances boxA:[S1,S2], boxB:[2 copies]); boxes then locked (ADR-606).
  - **(d) More ordinary route, select box A's pieces only:** gate `[art]` (Weld gate false). Union → A lit 216.000 → **162.000** (1 run, union outline), B stays **216.000** (2 runs, both overlapping outlines, interior overlap still cut); jig instances now `boxB:2` only; the union has no `registrationJig` identity. The two pieces now burn different artwork and A is no longer edited through the jig. Weld on the same selection: no change, "The registration jig was left as it is…".
  - **(c) Select All with locked boxes:** 4 objects, gate `[art]`; Union → boxes 2, compiled jig runs 3 → 0. With a single operation the decoded box sequence is unchanged (A>B>A>B with the registration layer on), and the auditor's two-op case becomes one op by the user's choice, so the burn order is not materially harmed here. The harm is the lost jig linkage.
  - (b) After Unlock All the boxes are absorbed. I did not rerun this; the auditor's 480 mm box-outline burn is plausible from the code, and it needs Unlock All first.
- **Grade:** every outcome is visible on the canvas, and Weld refuses the same edits. P2: a missing guard with a visible wrong result.

### T29-P2-2 — Confirmed P2
- **Code (read):** `unionSelection` pushes only the success toast; `removedTabsNotice` (`removed-tabs-notice.ts:20`) is called by Weld/Booleans (`combineSelectionNotingTabs`) and Offset Shapes, not here.
- **Run (R4):** op L tabs on (1.5 mm, 3 per shape). A 30×30 at (10,10) with placed tabs at pathT 0.125 / 0.625; B 10×10 at (35,20).
  - Before: lit 152.500 mm, 5 lit runs (A 2 placed, B 3 automatic).
  - Union: anchors undefined; lit 125.500 of the 130.000 perimeter, 3 runs (3 automatic tabs at positions the user did not choose); toast only the success line.
  - Weld on the same input: same burn, toast "Placed tabs on the welded shapes were removed. Undo restores them."
- **ADR:** ADR-494 Amd 3 item 4 names Weld, Booleans, Offset Shapes; Union is an omission. Placed tabs are drawn only while a tab tool is open (Amd 3 context), so the loss is invisible. N3-P2-1 was P2 for the same gap.

### P3 spot checks
- **P3-1** (compound enables, then refuses): confirmed by reading. The gate lacks `isBooleanCompoundObject`; `selectedRepairObjects:165` excludes it, so the selection-size check returns `[]`.
- **P3-2** (default op): confirmed by reading. `UnionSilhouetteDialog.tsx:13` uses `operations[0]`.
- **P3-3** (text-on-path guide dangling): same root as P1-2 / T29R-P2-1. Fine as P3: plain text keeps its stored geometry.
- **P3-4 / P3-5**: same as T28-P3-2 / T28-P3-1. Not rerun.

## Extra findings

### T29R-P2-1: Weld and Subtract / Intersect / Exclude also orphan an image mask, with no notice at all
- **Severity P2** (same reasoning as the re-graded P1-2: the burn matches the canvas, which visibly unclips; missing warning). Not in the T28 ledger.
- **Where:** `vector-path-actions.ts:181-238` `weldSelectionMutation` and `:241-284` `booleanSelectionMutation` remove the sources (`replaceSelectedAtEarliest` / `removeObject` + `removeObjectIdsFromGroups`) and never call `repairRemovedObjectReferences` / `reportDependencyRepairs`. Their 'replace' guard covers variable data and the jig, not mask or text-guide dependents.
- **Repro (R2, same fixture):** Weld of mask + ear → `welded-paths`, `imageMaskId=mask` live false, lit 3200.000 mm, 2656.000 mm outside mask ∪ ear, preflight `[]`, canvas clip depth 0, **toasts `[]`**. `booleanSelection('subtract')` → `subtract-pat…`, same numbers, toasts `[]`.
- **Oracle:** masked burn 512.000 mm with 0.000 mm outside the mask; analytic mask ∪ ear region.
- **Fix:** one shared fix for Union, Weld and the Booleans. Re-point `imageMaskId` and `pathText.guideObjectId` from a consumed source to the result (what "grow the mask" means), or at least run `repairRemovedObjectReferences` and `reportDependencyRepairs` as Join and Delete do.

### Pointers (not counted): other Tools commands that rebuild or replace outlines without `geometryToolSources`
All READ ONLY:
- **Offset Shapes dialog:** `offset-shapes-actions.ts:97-105` `offsetShapesTargets` (unlocked + `isVectorPathObject`, no variable or jig guard). ADR-350 Amd 1 covers only the store `offsetSelection`, not this dialog path. With "Delete original objects" it also replaces sources.
- **Cut Shapes** (`cut-shapes-actions.ts`), **Trim Shapes** (`trim-shapes-actions.ts`), **Warp / Deform** (`warp-deform-plan.ts`): no `objectVariableTemplate` or guard check found.
- **Rubber-Band Outline** (`rubber-band-outline-actions.ts:58` → `core/geometry/rubber-band-outline.ts`, materialises): adds a new outline, so variable text would give a template-shaped outline.
- `nest-outline.ts` materialises for nesting outlines only (not burned art). Copy Along Path, Convert to Path, Weld, Booleans, Offset (store) and Dogbone are guarded.
- **Join Paths** shares the unguarded `selectedRepairObjects`, but it only joins open endpoints (text glyphs are closed). It does run dependency repair.

## Totals
Verdicts: confirmed 3 (T29-P1-1 P1, T29-P2-1 P2 narrowed, T29-P2-2 P2), re-graded 1 (T29-P1-2 P1 → P2), refuted 0. Extra raised: 1 (T29R-P2-1, Weld and Booleans orphan an image mask). Pointers: 5 tool paths, not counted.
