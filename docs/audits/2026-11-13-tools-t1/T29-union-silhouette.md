# T29 Union Silhouette — auditor report
Tree: origin/main @ f8c17f8c4. Command id: `tools.union-silhouette`.

## Map
- **Menu:** `vector-boolean-commands.ts:9-25` (enabled when `ctx.canUnionSilhouette`) → `use-app-commands.ts:164` (`unionSilhouetteOperations(...).length > 0`) → `CommandShell.tsx:109` opens `VectorRepairDialogHost` kind `union`.
- **Dialog:** `UnionSilhouetteDialog.tsx` — one select "Result operation" listing every scene operation used by the selection (`selection-command-state.ts:130-149`), default `operations[0]` (`:13`), the note "The result uses only this operation's settings. Individual artwork settings are replaced.", Cancel and "Union shapes" (form submit, Enter works). No preview.
- **Store:** `vector-repair-actions.ts:35-43` `unionSilhouetteSelection` → `unionSelection` (`:56-108`): refuses unless every selected object is an unlocked, non-compound vector (`selectedRepairObjects`, `:159-169`); builds `union-<uuid>` with `unionVectorObjects`; puts it at the earliest scene / artwork-order slot; `removeObjectIdsFromGroups`; `pruneOrphanLayers`; success toast; one undo step (`commitRepair`).
- **Core:** `core/geometry/vector-path-union.ts` → `normalizeVectorObjectRegion` (each object's paths normalised under its own rule: text non-zero, other paths even-odd, then unioned non-zero) → `unionNormalizedRegions` (Clipper `unionD`, non-zero, 0.001 mm). Result: one `imported-svg`, identity transform, one path with the operation's colour, `operationIds: [chosen]`, polylines only.
- **What "silhouette" means here:** the union of each object's *filled region*. Holes inside one object (ring, letter counters) are kept; a separate object lying wholly inside another is swallowed. It is not "outer outline only". ADR-350 item 2 ("Each source's filled region is normalized before union") and WORKFLOW F-A6b item 1 ("combine its filled regions").
- **Governing:** ADR-350 item 2 and Amendment 1 (2026-11-13; names Weld, Booleans, Offset, Dogbone — not Union silhouette); WORKFLOW.md F-A6b; PROJECT.md Phase G note; ADR-494 Amd 3 (placed-tab notices); `docs/audits/2026-09-23-lightburn-geometry-fixes.md`.
- **LightBurn:** nearest is Weld (Boolean Tools page, docs.lightburnsoftware.com/latest/Reference/BooleanTools/): any number of closed shapes, greyed out with open shapes; LightBurn warns that shapes fully inside outer shapes disappear (text inside a ring). The page does not say which layer the result takes; KerfDesk's explicit chosen operation is its own decision (ADR-350).
- **Changes since 2026-10-16** (`git log --since=2026-10-16 f8c17f8c4` on the files above): f3e535e79 (34 audited workflow defects), ef1cd4f85 (ADR-410 Amd 3, offsets), 7449c6362 (S2-P3-3 perf), d9b8abf0b (#1882, Weld guard). **#1882 did not touch Union silhouette:** `unionSilhouetteOperations` and `selectedRepairObjects` do not call `geometryToolSkipReasons` / `geometryToolSources`.

## October register re-check
Register row 36 (`2026-10-16-tools-quality-register.md:70`): "two rectangles → 1 union object; Undo → 2". Still holds: G1 (ADR fixture 60×40 at (40,40)+(70,60)) gives one object, area 4200.000, perimeter 300.000; B1 Undo restores the project byte-identical (`JSON.stringify` equal), Redo equals the result, save/reopen burns the same. No repaired defect regressed.

## Checks run
Scripts in `C:\Users\stolk\kd-t1\zz-t29` (Vitest, jsdom, real store + `prepareOutput` → `emitPreparedGcode`, decoded with the T26/T28 decoder `decode.ts`; region oracle `oracle.ts` = independent scanline winding/parity, no Clipper). Logs next to each file.

| Check | Method | Result |
|---|---|---|
| Overlap, touching edge, corner touch, disjoint | `t29-geom.test.ts` G1-G2: analytic area/perimeter + scanline oracle on result and on decoded burn loops | All exact: 4200/300, 200/60, 200/80, 125/60; XOR 0 |
| Nested separate objects, ring + island, ring + half-hole, one-object triple nest | G3 | Exact (1600/160; 1300/280; 1400/220; 1325/300). Separate nested object swallowed (by design) |
| Text with counters "OB8a" (Roboto), with and without a bar | G4 (`t29-geom-G4.log`) | 10 contours kept (counters kept); area vs non-zero oracle XOR 0.095 / 0.084 mm² |
| Self-crossing pentagram even-odd / non-zero, two overlapping circles | G5 | Matches each object's own rule (XOR ≤ 0.05 mm²). Circles: −1.08 mm², perimeter −0.045 mm from chords (KNOWN T26-P2-1) |
| Rotate + mirror + non-uniform scale; negative scale | G6 | XOR 0.030 mm²; 0 |
| Open path, zero-area polygon, degenerate + real, single object, 0.0004 mm square, 800 rectangles, 2000 mm squares | G7 | Open: menu disabled, store refuses. Zero-area alone: "no closed area" refusal. Degenerate dropped silently with real art (fine). 800 rects 24 ms, XOR 0.79 mm² of 27 804 mm² (scanline step). Huge exact |
| Menu enable rule (locked, empty, unassigned) | G8 | Locked member or empty → disabled; colour-bound art lists its layer |
| Mixed operations, power scale, override, chosen op, undo/redo, save/reopen | `t29-burn.test.ts` B1 | Result burns only at the chosen op (F1000 S800 114 mm, or Fill F3000 S300 3500 mm = 350 mm² / 0.1); override F777 S60 and powerScale 50 dropped as the dialog says; orphan op pruned; undo exact |
| Same op, different path colours (T28-P2-2 twin) | B2 | No colour key: unions, lit 90.000 = union perimeter. Not a defect |
| Variable text + plate; variable text alone | B3 with `prepareOutputSnapshot` and an independent Roboto render of "SN 0042" | **T29-P1-1** |
| Registration jig: art + copies; Select All with unlocked and with locked boxes | B4 with `registrationJigCompilationRuns` and decoded burn order | **T29-P2-1** |
| Image mask shape included in the union | B5: burned raster cells via `compileJob`, decoded bbox, `runPreflight`; Delete and Weld as controls | **T29-P1-2** |
| Placed laser tabs | `t29-tabs.test.ts`, Weld as control | **T29-P2-2** |
| Groups, Boolean compound, metadata, default operation, text-on-path guide | B6, B7 | T29-P3-1..P3-5 |
| Closed-enough open-flagged contour | `t29-edge.test.ts` | Accepted and correct (lit 60); 0.004 mm gap refused consistently by menu and store |
| Dialog labels, Cancel, keyboard | READ `UnionSilhouetteDialog.tsx` | Cancel mutates nothing; Enter submits; see P3-2. No browser run (time-box) |

## Findings

### T29-P1-1: Union silhouette turns variable text into its template glyphs: the braces burn and the serial stops changing
- **Severity P1:** wrong burn on every record, no notice. New twin of T28-P1-1 / T26-P1-1: PR #1882's guard (`geometry-tool-sources.ts`) is not used by this tool.
- **Where:** `selection-command-state.ts:130-149` (`unionSilhouetteOperations` admits any unlocked `isVectorPathObject`, no `geometryToolSkipReasons`); `vector-repair-actions.ts:159-169` (`selectedRepairObjects`, no guard); `vector-path-regions.ts:35` materialises the stored (template) outlines.
- **Repro:** `zz-t29/t29-burn.test.ts` B3 (`t29-burn.log`). Text `SN {{serial:4}}` (Roboto 10 mm, serial 42) + a 4×2 mm plate on op L. Menu is enabled for the variable text alone and with the plate. Before: lit 224.520 mm, burn ends at x 87.241; after Union: lit 363.213 mm, ends at x 110.522. Serial 43 before Union changes the burn (225.472 mm); after Union it does not (363.213 both). Variable text alone (B3b) is also converted, same numbers. Toast only "Created one silhouette using L."
- **Oracle:** independent Roboto render: value "SN 0042" is 37.241 mm wide (49 → 87.241); the template is 60.522 mm (→ 110.522), so the burn after Union is the template.
- **Fix:** use `geometryToolSources(scene, objects, 'replace')` in `selectedRepairObjects`' union path and `geometryToolSkipReasons(scene, 'replace')` in `unionSilhouetteOperations`, with `geometryToolSkippedNotice`; add Union silhouette to ADR-350 Amd 1.

### T29-P1-2: Unioning an image's mask shape deletes the mask without repair or notice: the whole photo burns
- **Severity P1:** burn outside the art (the full rectangle of the photo instead of the masked circle); toast says success, Job Review is silent. Canvas will draw the whole photo again, which may let an attentive user notice (refuter: weigh this).
- **Where:** `vector-repair-actions.ts:89-107`: `unionSelection` removes the sources but, unlike `joinSelection` (`:154`, `repairRemovedObjectReferences`) and Delete (`object-delete-actions.ts`), never runs dependency repair, so `photo.imageMaskId` points at a deleted id. `compile-job-raster.ts:405-408` then finds no mask and burns the photo unmasked; `image-mask-off-image-issues.ts:47-50` skips a missing mask.
- **Repro:** B5. 40×40 mm photo (1 px/mm, 1 line/mm) at (100,100); 20 mm circle `mask` on a non-output Line op over its upper-right; real `applyImageMask('photo','mask')` → 268 burned cells, bbox x 120–140. Select the mask and a 30×6 mm tab (to enlarge the mask), Union silhouette on the mask's op → `imageMaskId=mask` (exists: false), **1361 cells**, bbox x 100–140, y 100.5–139.5 (the whole photo); preflight issue codes `[]`. Control: Delete of the mask clears `imageMaskId` and warns "1 image mask reference was removed…". Weld on the same pair has the same result (1361 cells, dangling id) — not in the T28 ledger; the coordinator may route it with this.
- **Oracle:** unmasked photo = 1361 cells (same compile on the photo alone); a mask that survives must keep the burn within its shape (≤ the circle ∪ tab area).
- **Fix:** either re-point `imageMaskId` (and `pathText.guideObjectId`) from a consumed source to the union result, which is what the user means when enlarging a mask, or at minimum run `repairRemovedObjectReferences` and push `reportDependencyRepairs`, as Join and Delete do. Same for Weld/Booleans.

### T29-P2-1: Union silhouette merges registration-jig artwork with its copies; after Unlock All it also absorbs the jig boxes, which then burn
- **Severity P2:** new twin of T28-P2-1 (the guard #1882 added for Weld is not used here). Breaks the jig's piece-by-piece run; in the unlocked case it burns the registration outlines.
- **Where:** same as P1-1 (no `'replace'` guard); the dialog lists the registration operation and makes it the default when it is first in the layer list (`UnionSilhouetteDialog.tsx:13`).
- **Repro:** B4, two 60 mm boxes, two art circles and one engrave square with jig copies.
  - (a) Art + its copies only: jig runs 2 → 0; source in box A and copies in box B become one object.
  - (c) Normal flow, boxes locked (ADR-606): Select All → menu ops [eng, art] → Union on art: jig runs 4 → 0; decoded order `F1111@A > F2222@A > F1111@B > F2222@B` becomes `F2222@A > F2222@B` (one object, one run).
  - (b) After Unlock All: Select All picks 8/8; menu ops `[registration(out=false), eng, art]` (registration is the default choice). Union on art: boxes 2 → 0, art and engrave vanish inside the box silhouettes, and the burn is 480.000 mm at F2222 S900 — exactly the two 60 mm box outlines — instead of 48 mm engrave + 251.183 mm art. Applying the default instead puts all art on the non-output registration op.
- **Oracle:** `registrationJigCompilationRuns` and decoded order before the edit; 2 × 4 × 60 = 480 mm box perimeter.
- **Fix:** as P1-1 with guard `'replace'` (leaves boxes and jig art out, with the jig notice).

### T29-P2-2: Union silhouette drops tabs placed by hand without the notice Weld gives
- **Severity P2:** missing warning on a cut that holds parts (ADR-494 Amd 3: Weld, Booleans and Offset "say when they drop them"; Dogbone's silent drop was graded P2 as R3-P2-1).
- **Where:** `vector-repair-actions.ts:106` pushes only the success toast; `removedTabsNotice` (`removed-tabs-notice.ts:20`) is never called.
- **Repro:** `t29-tabs.test.ts` (`t29-tabs.log`). Line op with tabs on (2 mm, 4 per shape); A 40×20 with two placed tabs at pathT 0.1/0.6, B overlaps. Union: placed tabs gone (`laserTabAnchors` undefined), the 150 mm outline gets 4 automatic tabs (8 mm gap) at positions the user did not choose; toast "Created one silhouette using L." only. Weld on the same input: same burn, toast "Placed tabs on the welded shapes were removed. Undo restores them."
- **Oracle:** Weld's behaviour under ADR-494 Amd 3; union perimeter 2 × (55 + 20) = 150 mm.
- **Fix:** add `removedTabsNotice(selected, 'combined shapes')` to the union toast.

### T29-P3-1: A live Boolean compound in the selection enables the command, then Apply refuses with a wrong message
- READ + run (B6c): menu ops [L] (enabled); Apply → "Select closed vector shapes and choose one of their operations." `unionSilhouetteOperations` does not exclude `isBooleanCompoundObject` while `selectedRepairObjects` does (`vector-repair-actions.ts:165`). Twin of T26R-P3-1. Fix: exclude compounds in the gate, or say "Expand the compound first".

### T29-P3-2: The default result operation is the first layer in the list, even when it does not output
- B6e: selection on [Guide (output off), L] defaults to Guide; B4b defaults to the registration operation. The option text says "(output off)", so it is visible. Fix: default to the primary selection's operation, or the first output-on one.

### T29-P3-3: A text-on-path guide that is unioned leaves the text pointing at a deleted guide
- B6f: `pathText.guideObjectId` = deleted id; burn of the text unchanged (lit drops only by the outline union, 40 mm). Delete repairs this (`repairDanglingObjectDependencies`). Same root cause as P1-2.

### T29-P3-4: Unioning members of a group takes the result out of the group
- B6a/B7: group {A,B,C,D}, union A+B → group {C,D}, result ungrouped; a three-member group is dissolved. Same as Weld (T28-P3-2). Fix: put the result in the group the sources shared.

### T29-P3-5: The result drops name and licence provenance
- B6d: `name` ('Logo') and `libraryProvenance` (CC-BY credit) gone; source becomes "Union silhouette". Burn unchanged. Same family as T26-P3-1 / T28-P3-1.

### T29-P3-6: Test gap
- No Union silhouette test covers variable text or barcodes, registration jig, image-mask or text-path dependencies, placed tabs, compounds or groups (`vector-path-union.test.ts`, `vector-repair-actions.test.ts`, `VectorRepairDialogHost.test.tsx`).

## Not a defect / limits
- Holes inside one object (ring, counters, island in hole) are kept and separate objects nested inside another are swallowed: ADR-350 item 2 and WORKFLOW F-A6b define the union of filled regions; LightBurn's Weld documents the same swallowing.
- Source operation overrides and power scale are replaced by the chosen operation's base settings: ADR-350 item 2, stated in the dialog.
- Different path colours in one operation (or across operations) union fine: no colour batch key, unlike pre-#1882 Weld.
- Orphan operations are pruned after the union (same as Delete); Undo restores them.
- A zero-area contour beside real art is dropped silently; alone it refuses with "no closed area". Acceptable.
- Curves flattened to chords: KNOWN (T26-P2-1, rolling v7 L1-P3-1) — G5c −1.08 mm² on two 20 mm circles.
- Variable barcodes not run separately (same unguarded path as variable text; covered by the P1-1 fix). CNC artwork and inch units not run: the union is unit-free mm geometry and machine-agnostic. No browser run of the dialog (time-box); dialog checked by reading.

## Totals
Raised 10; P1 2; P2 2; P3 6; known 1 (T26-P2-1 curve chords). P3-4 and P3-5 repeat T28-P3-2 / T28-P3-1 in this tool.
