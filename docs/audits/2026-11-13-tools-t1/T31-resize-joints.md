# T31 Resize Joint Openings — auditor report
Tree: origin/main @ eeac725e8. Command id: `tools.resize-joints`.

## Map
- Command: `src/ui/commands/joint-resize-command.ts` (enabled with any selection) → `CommandShell.tsx:111/215` opens `JointResizeDialogHost.tsx` → `JointResizeDialog.tsx` + `JointResizePreview.tsx`, state in `use-joint-resize-review.ts` (defaults 3 / 3 / 0.1 / 0.1 mm; Apply goes through `proOperationMutationSetter`).
- Store mutation: `src/ui/state/joint-resize-actions.ts` `jointResizeSelectionMutation` (re-runs the analysis on the session's owner, replaces changed objects in place with the same id, one Undo entry "Resize joint openings").
- Core: `src/core/geometry/joint-resize.ts` (validate, extract, resize, `sceneToLocal`), `joint-resize-detection.ts` (enclosed 4-point rectangle, inward U-slot by mouth width, outward tab by depth), `joint-resize-geometry.ts` (orthogonality, simple polygon, contour relation).
- Governing: ADR-570 (reviewable workflows); KXS-09 in `docs/implementation/xtool-workflows-20261007.md`; research note R6 (LightBurn Resize Slots) in `docs/audits/2026-10-15-tools-vector.md:63`. No WORKFLOW.md section names this tool. Placed tabs: ADR-494 and Amendments 2–4 (tabs follow in-place edits).
- Changes since 2026-10-16: only ab3226fd1 (shared helpers, C2-P3-1) and 59069ea1c (stack overflow fix). Tab detection came in bc4cd9eba / e2de7b877 (2026-10-13).
- Guard: the tool accepts only `imported-svg` / `traced-image`. Variable text (`text`) and variable barcodes (`shape`) are refused by kind, and edits keep the object id, so `imageMaskId` dependants follow the new geometry. No `geometryToolSkipReasons` bypass found. Locked objects, compound results, curves, open paths and non-invertible transforms are refused with notices.
- LightBurn (Resize Slots, 2.2 docs): Old/New Material Thickness + Tolerance, with separate *Adjust Slot Depth*, *Adjust Slot Width* and *Adjust Tab Height*. It names box-joint fingers and tenons as targets, does not support internal cutouts (it cannot tell which way to grow them), and needs sharp corners and straight lines.

## October register re-check
Row 38 (2026-10-16 register) recorded a pass with no repaired defect. I re-ran the same case: a 3 mm U-slot set to 3.5 + 0.1 gives 3.6 mm, and Undo/Redo are exact (`t31-core.test.ts` C identity, `t31-store.test.ts` D undo/redo). **Still holds.** Class K-1 (raw `useStore.setState`, 2026-10-21 v2 audit) no longer applies here, because `use-joint-resize-review.ts:65` now uses `proOperationMutationSetter`.

## Checks run
| Check | Method | Result |
|---|---|---|
| U-slot widen, centre, depth, other vertices | script C, analytic | 4.200 (oracle 4.200), centre shift 0, depth unchanged, others 0 |
| Transforms: rot 30 + mirrorY + scale 1.5×0.5; rot 90 ×2; path drawn at 17° | script C | all 4.200, centre fixed; `sceneToLocal` inverts `applyTransform` exactly |
| Two widths in one object (3 and 6) | script C | only the 3 mm slot changes (6.000 kept) |
| Slot 1 mm from a corner | script C | widened; the 1 mm shoulder becomes 0.4 mm and stays valid |
| Tolerance boundaries 3.1 / 2.9 at tol 0.1 | script C | **not detected** (float), see P3-2 |
| Box Generator 60×40×30 T3 → tool T4 vs generator T4 + assembly referee | scripts A, E, F | **does not assemble**, see P1-1 |
| Cutout features (keyway, tooth), nested part in a cutout | scripts B, G | **inside-out classification**, see P2-1 |
| Hand-placed laser tabs, decoded G-code tab spans | scripts D, H, G-code decoded | **tabs move 0.5–5.6 mm on untouched edges**, see P1-2 |
| Inheritance (name, powerScale, operationIds, overrides) | script D, existing test read | kept |
| Undo exact / Redo exact / save→reopen | script D | true / true / identical polylines |
| Decoded G-code before/after (4 tabs 3→4) | script D (decoder from zz-t26) | lit length 244→252 (oracle +8), min Y 37→36 (oracle 36) |
| Kerf | read | the tool never applies kerf, so output kerf runs once on the designed width. No double count |
| Square ambiguity, extra collinear node | script C | 0 candidates, **no notice**, see P3-3 |
| Variable text / barcode / jig / masks | read | refused by kind / edited in place by id; no bypass |

Scripts: `C:\Users\stolk\kd-t1\zz-t31\t31-core.test.ts`, `t31-store.test.ts`, `t31-box.test.ts`, `t31-referee.test.ts`, `t31-hole.test.ts`, `t31-drift.test.ts`, with matching `.log` outputs. Run from the tree root with `node node_modules/vitest/vitest.mjs run --config ../zz-t31/vitest.config.mts --maxWorkers=1 <file>` (`NODE_OPTIONS=--no-experimental-webstorage`).

## Findings

### T31-P1-1: A finger-jointed box resized from 3 to 4 mm burns panels whose fingers have mixed depths, and the box no longer assembles
- Severity P1: wrong burn and wrong size. This is the tool's main use case (LightBurn's "box-joint fingers"), it gives no notice, and the result cannot be assembled.
- Where: `src/core/geometry/joint-resize-detection.ts:88-105` (`rectangularNotch` needs a straight edge parallel to the base on both sides, so the finger at each panel corner is never found) and `:51-84` (receiving notches are matched only by mouth *width*, so a notch whose *depth* is the material thickness is never deepened). LightBurn has a separate "Adjust Slot Depth" for this.
- Repro: `zz-t31\t31-box.test.ts` and `t31-referee.test.ts`. Box Generator 60×40×30 inner, T3, finger 9, clearance 0. Each panel goes through the tool (current 3, thickness 4, fit 0, tol 0.05) with every candidate selected.
  - Bottom panel: 2 of 6 fingers are found. The middle fingers move to y = −1 while the corner fingers stay at y = 0. The result is 66×48; the generator at T4 gives 68×48. The side notches (63,16.33)–(63,29.67) stay 3 deep while the mating Left/Right tabs grow to 4.
  - Front: 66×38 (generator 68×38).
  - The box's own assembly referee (`checkBoxAssembly`) returns 20 issues against the T4 inner spec ("bottom/front: void in joint at 15..51 mm", …) and 14 against an outer spec that keeps 66×46×36. The generator's T4 panels return 0.
- Oracle: `generateBox` at T4 and the independent assembly referee in `src/core/box/assembly-referee.ts`. Either way, every joint step should be 4 mm deep: 12 steps on the T3 Bottom, of which 8 are left at 3 mm.
- Suggested fix: detect corner fingers and receiving notches by depth (a notch whose depth matches becomes thickness, like LightBurn's Adjust Slot Depth), or refuse/warn when an edge has joint steps of the old depth that were not selected. Add a Box Generator round-trip test with the referee.

### T31-P1-2: Tabs placed by hand slide along the outline after a resize, and the G-code burns them at the new places
- Severity P1: the burn has its tab gaps in a different place, on edges the edit did not touch. This is the same class rated P1 in rolling v8 N3-P1-1 and v9 R3-P1-2. ADR-494 Amendments 2/3 make in-place edits re-measure placed tabs (`withTabsFollowingEdit`).
- Where: `src/core/geometry/joint-resize.ts:265` (`{ ...geometry.object, paths, … }` keeps `laserTabAnchors`/`cncTabAnchors` unchanged, though `pathT` is a share of the contour length). The core test pins the same object (`joint-resize.test.ts`, `laserTabAnchors` `toBe`). The action never calls `withTabsFollowingEdit` and gives no "moved" notice.
- Repro: `zz-t31\t31-store.test.ts` (D). An 80×30 panel with four 8-wide, 3-deep finger tabs; laser tabs placed by hand at (20,55) on the left edge, (60,70) on the top and (100,50) on the right; layer tabs on, tab power 20 %. Resize 3→4 through `jointResizeSelectionMutation`.
  - Tab places after the resize: (20,55.492), (62.295,70), (100,45.738), which is 0.49 / 2.30 / 4.26 mm from where they were placed.
  - The decoded GRBL tab spans move the same way: before (20,55) (60,70) (100,50), after (20,55.492) (62.295,70) (100,45.738).
  - `t31-drift.test.ts`: a 400×200 panel with 40 fingers moves side tabs by 5.556 mm.
- Oracle: the edges the tabs sit on are unchanged (left, top, right), so each tab should stay exactly where it was placed: 0 mm movement, as ADR-494 Amd 2 requires for Delete node and Fillet.
- Suggested fix: pass the result through `withTabsFollowingEdit(before, after)` in `resizeGeometry` or the action, and show the "moved" count as other edits do.

### T31-P2-1: Features of a cutout are classified inside-out, so a keyway is lengthened instead of widened and a material tooth is widened as if it were a slot
- Severity P2: a wrong result under a misleading label ("outward tab", "inward U-slot"). The user reviews each candidate, but the label tells them the opposite of what it is. LightBurn refuses internal cutouts for exactly this reason.
- Where: `joint-resize-detection.ts:66-70`. `outward` is judged from the contour's own winding, not from which side is material, so on a hole contour convex means *opening*. The enclosed-rectangle test (`:29-32`) is "inside any other contour", so a part nested in another part's cutout counts as an opening.
- Repro: `zz-t31\t31-hole.test.ts` and `t31-core.test.ts` (B). The part is 60×40 with a 20×10 window and a 3-wide, 3-deep keyway cut from the window into the material. Settings: thickness 4, fit 0.2.
  - The keyway is listed as `outward-tab w3 d3`. After Apply its corners are (28.5,29) and (31.5,29): 3 wide and 4 deep. Oracle: a 4.2-wide opening at x 27.9..32.1 with depth unchanged.
  - With thickness 3 the keyway is refused as "already match"; the oracle is 3.2 wide.
  - A 3-wide material tooth projecting into the window is listed as `inward-slot` and widened to 3.2, which narrows the window.
  - A 3×20 strip *part* nested inside a 40×30 cutout is listed as `enclosed-rectangle` and widened to 3.2×20.
- Oracle: even-odd nesting depth of the contour (depth 1 = hole, so its convex features are openings; depth 2 = material island).
- Suggested fix: compute each contour's nesting parity and flip `outward` on holes; skip enclosed rectangles at even depth. Alternatively, refuse features on hole contours as LightBurn does.

### T31-P3-1: The candidate list shows a tab's depth as "width" and its width as "depth", and names objects by internal id
- Where: `JointResizeDialog.tsx:131-132` together with `joint-resize-detection.ts:120-126` (`widthMm` = depth for a tab).
- Repro: script D lists an 8-wide, 3-deep tab as "outward tab (depth) · width 3.000 mm · depth 8.000 mm" for object `panel`, although its name is "Front panel".

### T31-P3-2: A width exactly at the tolerance edge is not detected
- Where: `joint-resize-detection.ts:27,71,118` (`Math.abs(w - current) <= tol` in floating point).
- Repro: script C. Widths 3.1 and 2.9 with current 3 and tolerance 0.1 give 0 candidates (|3.1−3| = 0.10000000000000009). Suggested fix: add a small epsilon to the comparison.

### T31-P3-3: Some openings are skipped with no notice
- Repro: script C. An enclosed 3×3.05 rectangle ("square ambiguity") and an enclosed 3×20 rectangle with one extra collinear node both give 0 candidates and an empty notices list. Slot rectangles in a separate object from the outline are not "enclosed" (READ ONLY). The dialog only says "No unambiguous geometric candidates match this width."

### T31-P3-4: The dialog's summary line says depth and centre stay fixed, which is wrong for tabs (READ ONLY)
- Where: `JointResizeDialog.tsx:115-116`. "Depth and the opening centre stay fixed" is shown even when every candidate is a tab, whose depth changes and whose centre moves (`joint-resize.ts:235`). The footnote at :58-62 states the tab behaviour correctly.

### T31-P3-5: Fields are always in millimetres (READ ONLY)
- Where: `JointResizeDialog.tsx:5-24` and `use-joint-resize-review.ts:128`. The labels say "(mm)" and `evaluateNumericEntry` is called without `lengthUnit`, so an inch user must type `in`. The suffix does work.

## Not a defect / limits
- No kerf compensation by design (ADR-570 / dialog text), so the output kerf is applied once to the designed width. No double count.
- The tab target is the bare thickness, without fit allowance, by design (bc4cd9eba, dialog footnote).
- Curved artwork is refused rather than flattened (T26-P2-1 does not apply). Open paths, locked objects, compound results and zero scale are refused with notices. Non-finite and non-positive fields are refused (existing tests).
- The edit keeps the object id, so `imageMaskId` masks and other id-based dependants follow the new geometry. That looks intended; no source replacement, so #1900's repair is not needed.
- Jig artwork copies (`registration-jig-copy:` ids) can be edited in place. I did not check whether the jig regenerates and overwrites them (READ ONLY, not raised).
- Browser dialog check not run: time-boxed, and the dialog was read instead. Cap-scale workload (20 000 points) not benchmarked, as in October.

## Totals
Raised 8; P1 2; P2 1; P3 5; known 0 (class K-1 raw setState from the 2026-10-21 v2 audit is now fixed for this tool and not counted).
