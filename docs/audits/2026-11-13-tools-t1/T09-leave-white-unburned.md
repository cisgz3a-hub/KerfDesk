# T09 Leave White Unburned — auditor report
Tree: origin/main @ 856cb3ae1. Command id: `tools.leave-white-unburned` (menu label **Leave Imported White Unburned**; Job Review button **Leave white unburned**).

## Map
- **Command:** `src/ui/commands/fill-repair-commands.ts:36-53` → `ctx.leaveWhiteUnburned` / `ctx.canLeaveWhiteUnburned` (`src/ui/commands/tool-command-context.ts:122-125`; enabled when `countBurningImportedWhites(scene) > 0`). It acts on the whole scene, not the selection. Disabled tooltip: "No imported SVG burns solid white over a darker fill."
- **Action:** `leaveSavedWhiteUnburned` in `src/ui/state/saved-white-knockout.ts:79-116`: one Undo step "Leave white unburned"; the Undo copy marks the white `whiteInk: 'kept'`; success toast "N white shapes are left unburned. Undo burns them again." The Job Review button (`src/ui/laser/job-review/LeaveWhiteUnburnedButton.tsx`) calls the same action. The open notice and the review row are in `src/ui/state/saved-white-notice.ts`.
- **Core:** `src/core/geometry/burning-imported-white.ts` groups the parts (`svgImportGroups`: parts that share `svgImport.id` form one group; every part without `svgImport` is a group of its own), checks the Fill mode (`isSavedFillPart`), skips parts with Output off and counts them. `src/core/geometry/white-fill-knockout.ts` does the Clipper2 difference by paint order. That difference runs only between parts with an identical `transform` (`sameTransform`, line 117). `src/ui/state/import-white-knockout.ts:105-149` (`withWhiteKept`, `withoutRemovedParts`) removes orphaned operations.
- **Governing decisions:** ADR-686 plus Amendments 1–4. Amendment 2 added this command (#1617, `6af46c61a`, 2026-11-08). Amendment 4 handles copies and makes the count exact (#1651, `7e67e13e4`, 2026-11-09). The original knock-out came in #1556 (`4749f103b`). `WORKFLOW.md` has no section on this tool.
- **New since the October register:** the 2026-10-16 register and its vector/fill-repair part (`2026-10-15-tools-vector.md`) have no row for this tool and do not mention white or knock-out.

## October register re-check
There is no October row: the tool did not exist on 2026-10-16. Instead I re-checked the earlier ledger fixes that cover this tool. V2-P2-1 (offer for older logos), V7-P2-1 (only solid white is paper), V7-P2-2 (Re-import keeps settings) and X2-P1-1 (copies) are all still fixed for **single-part** logos. A1–A9, C1, G3, G7 and G8 below show the count, the knock-out and the burn are right. X2-P1-1 has a residual for multi-part logos: see T09-P1-1.

## Checks run
Script: `C:\Users\stolk\kd-t1\zz-t09\t09-burn.test.ts` (log `t09-burn.log`). It uses the real store, `importAsOlderBuild` (what 1.0.29 saved) and the real `prepareOutput` → `emitPreparedGcode`, then decodes the lit G1 moves. **Oracle (independent):** a point should burn only if the last-painted Fill shape that contains it, in the artwork before the tool, is not paper white. I sampled each hatch row every 0.02 mm and split its lit length into "good" (oracle burns) and "bad" (oracle says bare material). Expected area comes from a 0.1 mm grid. Hatch spacing is 0.1 mm. A residual "bad" of 20–100 mm is row-edge sampling (one row on each hole edge).

| Check | Method | Result |
|---|---|---|
| A1 white diamond over black square | oracle + G-code | bad 4,030 → 30 mm; good 6,970 against oracle 6,990. Pass |
| A2 white background under black circle | oracle | bad 12,864 → 0.5; circle whole (3,132.7 against 3,137.2). Pass |
| A3 nested B/W/B/W | oracle 1,000 mm² | total 10,000 mm = 1,000 mm² exactly; bad 100 (edges). Pass |
| A4 white bar across two darker shapes | oracle | bad 7,899 → 53; good 7,670 against 7,725. Pass |
| A5 white partly over dark / A8 white sharing an edge | oracle | Pass (3,000 / 4,000 mm, as expected) |
| A9 white letters on a plate (U3 plate) | oracle | 10,860 mm = oracle 10,860. Pass |
| C1 rotated 30°, mirrored, scaled 2×1 | oracle in world coordinates | 14,000.2 against 14,000.1, bad 0. Pass |
| C2 multi-part import rotated 37° and flipped together (store actions) | oracle | transforms stay equal; pass |
| C3 multi-part import, white part alone nudged 5 mm | oracle | white removed but nothing cut: bad 2,070 mm (T09-P3-1) |
| D1/D2/G9 Duplicate, Paste, Array of a multi-part older logo | oracle + count | **copies keep burning their white** (T09-P1-1) |
| E1/G2 Line op on the dark part only | line-op lit length | 120 → **176.57 mm**: the diamond outline is now cut (T09-P2-1) |
| H1 Line op on the white part only | line-op lit length | 56.57 → **0**, and the operation is deleted (T09-P2-1) |
| G1 Add operation (Line) on a whole single-part logo | line-op lit length | 176.57 → 176.57. Pass |
| G3 after Break Apart | oracle | parts keep `svgImport`; pass |
| G4 grouped multi-part logo | groups after | white part leaves both groups cleanly; selection pruned. Pass |
| G5 `#fefefe` / G6 white stroke | count | count 0, tool disabled, burn unchanged (by design, ADR-686 Not covered) |
| B1/B2 fresh import: translucent white, gradient under white | count | count 0 (Amd 1 marks); after Undo, a `kept` white is not counted. Pass |
| G7 translucent white saved by 1.0.29 (no marks) | oracle | cut out as paper. Known limit (Amd 4 Not covered) |
| G8 white and dark on one shared Fill op | oracle | bad 2,030 → 30. Pass |
| H2 locked logo | read + run | knocked out; `locked` kept (T09-P3-3) |
| Count is exact (single-part cases) | count, return value, white paths removed, toast | all equal (1/1/1, 2/2/2); count after = 0. Pass. Multi-part copies: not exact (T09-P1-1) |
| Undo / Redo | G-code and scene JSON | Undo gives the same G-code and scene as before (apart from the `kept` marks, by design) and count 0; Redo gives an identical scene. Pass |
| Save / reopen | `serializeProject` → `deserializeProject` → G-code | identical G-code, count 0; a second run returns 0 and pushes no Undo step. Pass |
| Re-import keeps the knock-out (Amd 3) | read only | covered by `svg-white-fill-knockout-v10.integration.test.ts` "V7-P2-2"; not rerun (memory budget) |
| LightBurn reference | web | docs.lightburnsoftware.com refused the fetch from this PC; relied on ADR-686's reading of 2026-11-03 (see limits) |

## Findings

### T09-P1-1: Copies of a multi-part older logo keep burning their white over the black, while the count, toast, notice and Job Review say it is gone
- **Severity:** P1. It harms the job: the white is burned a second time over the black, which is the X2-P1-1 failure (P1). The tool reports success and then hides every warning (count after = 0, so the open notice, the Job Review row and the Tools command all go away).
- **Cause:** the SVG parser starts a new part whenever a stroked element or an image comes between filled ones (`src/io/svg/svg-import-entries.ts:33-57`; 1.0.29 `df2279e26` splits the same way). An ordinary logo with an outline stroke between its fills therefore becomes a dark-fill part, a line part and a white-fill part. Duplicate, Paste and Array drop `svgImport`. Amendment 4 Decision 1 makes **each** such part its own group (`src/core/geometry/burning-imported-white.ts:29-44`). The copied white part's group has no darker fill, so `knockOutWhiteFills` returns null (`white-fill-knockout.ts:97`). The copy is neither counted nor knocked out.
- **Repro:** `zz-t09/t09-burn.test.ts`, tests D and G9. The SVG has a black 30 mm square, a blue `<line>` stroke, then a white diamond of 200 mm².
  - **Array ×3 (G9):** before the tool the count is **1** for 3 logos. The tool returns 1, the toast reads "1 white shape is left unburned", white paths go 3 → 2, and the count after is 0. Lit length where the oracle says bare material: 12,210 → **8,210 mm** (about 4,105 mm per copy: the diamond burned twice). Expected about 70 mm per logo, as on the original.
  - **Duplicate (D1) and Paste (D2):** count 1, bad 8,140 → **4,140 mm**, expected about 70.
- **Oracle:** paint-order sampling of the pre-tool artwork in world coordinates; diamond area 200 mm² at 0.1 mm spacing ≈ 2,000 mm per burn.
- **Suggested fix:** copying several parts of one import should give the copies one shared fresh group id (for example a fresh `svgImport.id` with the same mode and a placement that matches the copy). Alternatively, `svgImportGroups` could group `svgImport`-less parts that were copied together. Add a multi-part logo to `svg-white-fill-knockout-v12.integration.test.ts`.

### T09-P2-1: The knock-out rewrites paths that also feed a Line operation: a dark part's cut gains the hole outline, and a white part's cut is deleted with its operation
- **Severity:** P2. The output is wrong with no word about it: the toast only says "N white shapes are left unburned". One Undo restores it and Preview shows the new outline. The route is narrow: an older project, plus a Line operation bound to only one of the parts. The refuter may weigh P1 for half (a), since a through-cut drops the diamond out of the piece.
- **Where:** `src/core/geometry/white-fill-knockout.ts:108-125`. The dark path is replaced for **all** its bindings, its Line binding included. Line 109-111 nulls a white path whatever its other bindings are. `src/ui/state/import-white-knockout.ts:134-141` then deletes the operation it orphaned.
- **Repro:** `zz-t09/t09-burn.test.ts`, tests G and H. Both use the multi-part older logo. The Line operation is added through the store's `addOperationForSelection` and set to Line, power 77 %.
  - **(a) G2:** select only the black badge part and add the Line op. Line-op lit length goes from **120.00 mm to 176.57 mm**: the diamond's 56.57 mm outline is now cut. E1 does the same with a path-level binding on a single-part logo: 60 → 116.6 mm of non-row moves.
  - **(b) H1:** select only the white diamond part and add a Line op (scoring or cutting the diamond outline). Line-op lit length goes from **56.57 mm to 0**, and the operation `operation-logo-2-2` with its settings disappears from the operation list. Undo brings both back.
  - **Control (G1):** a Line op added to a whole single-part logo cuts 176.57 → 176.57 mm, unchanged.
- **Oracle:** a Line operation's outline should not change because a Fill knock-out ran: square perimeter 120 mm, diamond perimeter 4·√200 = 56.57 mm.
- **Suggested fix:** apply the knock-out only to Fill bindings. Where a dark or white path also uses a non-Fill operation, keep an unchanged copy of it bound to those operations. Name any operation that is removed in the toast.

### T09-P3-1: A white part moved apart from its import is dropped without cutting the fill under it
- **Severity:** P3. The route is narrow, and the canvas after the tool matches the burn.
- **Where:** `src/core/geometry/white-fill-knockout.ts:117` (`sameTransform`) and line 110 (the white is removed regardless).
- **Repro:** C3. Multi-part older logo with the white part alone nudged 5 mm, still overlapping the square. The tool says "1 white shape is left unburned", and lit length inside the white's current outline is **2,070 mm** (expected about 0). Before the tool it was 4,070.
- **Suggested fix:** knock out in world coordinates when the transforms differ (bake both transforms), or leave such a white in place and leave it out of the count.

### T09-P3-2: Naming and docs
- The menu says "Leave Imported White Unburned", Job Review says "Leave white unburned" and the T1 register says "Leave White Unburned".
- `WORKFLOW.md` has no section on this tool.
- The success toast does not mention the operations it removes; this matters for P2-1(b).
- READ ONLY.

### T09-P3-3: Locked artwork is rewritten without mention
- **Repro:** H2. A locked logo is knocked out (the lock flag is kept).
- Locked artwork is "skipped by normal selection and transform tools" (`scene-object.ts:184-186`). This is a project-wide repair, so it is arguably by design, but neither the toast nor the tooltip says it includes locked parts.
- **Test gap:** no test covers multi-part logos or Line bindings in `svg-white-fill-knockout-v10/v12` tests.

## Not a defect / limits
- **Near-white, white strokes and only ink white:** `#fefefe`, white strokes and imports whose only white is ink are not offered the tool (G5, G6, B1). This is by ADR-686 Not covered and Amendment 1.
- **See-through white saved by 1.0.29:** it is cut out as paper (G7). This is the documented Amendment 4 limit; the open notice says so.
- **Unrelated white removed:** a white shape that overlaps nothing (for example a white background painted first) is removed and counted. By ADR-686 Decision 1 it is paper.
- **Kept white:** a white the operator kept with Undo, or a fresh import whose white was knocked out, is never offered again (B2, F). This is by design.
- **Re-import (Amd 3):** not rerun here, to keep within the memory budget. It is covered by the existing V7-P2-2 tests.
- **Not checked:** multi-sheet projects (the tool acts on the active scene), inch units (no numeric field) and the browser dialog (no dialog; the memory gate was not met).
- **LightBurn:** docs.lightburnsoftware.com refused the fetch from this PC, so I did not re-read it. ADR-686 (read 2026-11-03) says LightBurn:
  - matches imported colours to its palette, which has no white, so white lands on a light pink layer;
  - fills nested shapes on one layer only between the outlines (even-odd);
  - engraves the inner area twice when the shapes are on two layers;
  - has staff advising users to leave the white area out of the shape or use the Mask tool.

  So LightBurn does not "ignore white". It burns white as a colour. KerfDesk's knock-out deliberately does what LightBurn's advice asks the user to do by hand.

## Totals
Raised 5; P1 1; P2 1; P3 3; known 0. T09-P1-1 is a residual of X2-P1-1 (fixed by #1651) on multi-part logos that X2 did not test, so it is not counted as known.
