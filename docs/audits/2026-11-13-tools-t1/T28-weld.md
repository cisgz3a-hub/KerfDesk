# T28 Weld — auditor report
Tree: origin/main @ 3293fd15d. Command id: `tools.weld`. Re-checked on origin/main @ 155b76f74 (2026-11-13 13:47): no commit since the tree touches the Weld files. The only nearby change is c883e25e9 (#1875), which fixes Convert to Path only.

## Map
- **Menu → dialog:** `tools.weld` (`src/ui/commands/command-families.ts:160-176`). It is enabled by `selectionCanWeld` (`selection-command-state.ts:97-104`): at least one unlocked vector object, and every unlocked one has only closed contours. The command runs `openBooleanDialog('weld')` (`tool-command-context.ts:109`).
- **Dialog:** `BooleanDialogHost.tsx`. "Weld within each operation" previews in the vector worker (ADR-609). The review names absorbed sources and refuses "Nothing to weld" (ADR-609 Amd 2, ADR-653 Amd 2). Apply calls `weldSelection(options)`.
- **Store:** `vector-path-actions.ts:107-120` → `weldSelectionMutation` (`:215-273`). It refuses silently when any selected object is locked (`:222`), takes a matching worker plan or plans in thread (`vector-op-prepared.ts:156-169`), and refuses when nothing merges (`weldChangesOutlines`). The result goes at the earliest position, the sources leave their groups, orphan operations are pruned, and a tabs notice is shown (`removed-tabs-notice.ts`, ADR-494 Amd 3).
- **Plan:** `vector-path-weld-plan.ts`. Objects are bucketed per operation and per effective settings. An object with a power scale or an override gets a cloned "<op> (Weld)" operation with its settings baked in (ADR-350 item 2, ADR-540 Amd 3). Bindings are in `vector-path-weld-bindings.ts`.
- **Core:** `core/geometry/vector-path-weld.ts`. Each ColoredPath is normalised under its own fill rule (`vector-path-regions.ts`; text is non-zero). Then a Clipper2 `unionD` NonZero runs per batch key (colour, operation, stroke), at 1 µm precision. The result is one `imported-svg` "Welded paths" with an identity transform and polylines only.
- **Governing:** ADR-103 G1 ("Weld = union"), ADR-350 item 2 (Weld keeps operation partitions), ADR-540 Amd 3, ADR-494 Amd 3, ADR-609 + Amd 2, ADR-653 Amd 2, ADR-321 (text Weld overlaps is a different feature). WORKFLOW F-CNC22 ("Empty" item 2, "Edge — Weld absorbs enclosed shapes").
- **LightBurn (docs 2.2, Reference/BooleanTools):** Weld is "similarly to Boolean Union" for any number of shapes. All shapes "must be closed shapes", and with open shapes the tool is greyed out. Content inside a ring can disappear. The page does not say which layer the result takes, and does not cover text or variable text.

## October register re-check
- Row 35: two rectangles in one operation become 1 object, and Undo gives back 2. **Still fixed.** Case a: 2 → 1 object, area 350.000 / perimeter 90.000 (analytic 350 / 90). D2: Undo restores the exact project object (`===`), and Redo gives an identical scene.

## Checks run
| Check | Method | Result |
|---|---|---|
| Overlap, touching, corner-touch, gap 0.5 µm, ring + bar, absorbed inner circle, island in a ring hole, disjoint + pair, identical duplicates | `t28-geom.test.ts` G1. Oracle: each source burned alone through `prepareOutput` → G-code → own decoder (`decode.ts`), chained into loops, filled under the source's own rule, unioned on an exact scanline interval grid (`oracle.ts`); plus analytic areas | All match. Symmetric difference ≤ 0.001 mm². Rects 350/90 exact; two r10 circles 504.406 (analytic 505.52 less chord loss), perimeter 83.731 (analytic 83.78); ring + bar 1062.195 (analytic 1062.208). Edge-touch merges (400/100). Corner-touch and 0.5 µm gap give "Nothing to weld". |
| Rotate 30°/−25°, mirror X/Y, non-uniform 2×0.5, 1.5×1.2, 3×1 | G1 f | 740.735 vs 740.745, xor 0.026 mm² (flattening) |
| Self-crossing: pentagram even-odd and non-zero, bow-tie, one path of two overlapping squares (even-odd hole) | G2 | Weld keeps each source's rule. Even-odd star 324.967 (centre stays a hole, 5 contours); non-zero star 463.722 (1 contour); xor ≤ 0.032 mm² |
| Text: Roboto "OAB8" + underline bar (counters) | G3 | 438.170 vs 438.175, counters kept (8 contours) |
| Script fonts that overlap themselves, Weld overlaps off, rotated 12° + mirrored: Pacifico, Great Vibes, Alex Brush "Wedding Love" | G3 + Fill burn | Areas match the non-zero oracle (xor ≤ 0.004). Fill hatch before/after: 4882.087/4882.069, 1854.352/1854.354, 1478.130/1478.130 mm |
| 300 overlapping circles, 1000 mm rects, 0.01 mm squares, zero-area sliver, zero-height rectangle | G4 | 300 → 1 object in 34 ms, exact. Huge and tiny exact. Sliver dropped. Zero-height rect refuses the whole weld (T28-P3-3) |
| Variable text `SN {{serial:4}}` + bar crossing the S | `t28-more.test.ts` A2, `prepareOutputSnapshot` with a Roboto renderer, decoded | **P1** (T28-P1-1) |
| Select All → Weld with 2 registration boxes + jig copies; jig art + copies only | `t28-burn.test.ts` B, real `selectAllObjects` | **P2** (T28-P2-1) |
| Mixed operations (L1 + L2 overlapping) | C1 | Correct: L1 120 → 90 mm union, L2 60 mm unchanged, F/S per operation unchanged |
| Power scale 50 % (2 shapes) + unscaled shape | C2 | Burn identical: S400 part welded (120 → 90 mm), S800 untouched. New operation "L1 (Weld)" P40, no notice (T28-P3-4) |
| Override power 12 / speed 777 | C3 | F777 S120 kept. Editing L1 afterwards no longer reaches the welded art (T28-P3-4) |
| Object on Fill + Line operations | C4 | Fill 3000 → 3500 mm hatch (overlap now filled: 350 mm² union); Line 120 → 90 |
| Same operation, different colours (Assign to operation; operation recolour) | `t28-more.test.ts` E, E3 | **P2** (T28-P2-2) |
| Locked shape in the selection | `t28-burn.test.ts` D3 + dialog render `t28-dialog.test.tsx` (with an unlocked control) | **P2** (T28-P2-3) |
| Open path in the selection | D4 | Menu disabled; the store refuses with a toast. Matches LightBurn (greyed out) |
| Groups, name, licence provenance, kept white, placed tabs | D1, D5, D6 | Tabs notice shown. Group, name, provenance and `whiteInk` lost (T28-P3-1, T28-P3-2) |
| Undo / Redo | D2 | Exact |
| Existing suites: vector-path-weld, -weld-change, -weld-plan, -weld-state, BooleanDialogHost (+ weld-worker), removed-tabs-notice | Vitest, 7 files | 67/67 pass. None covers variable text, registration boxes, mixed colours in one operation, or locked members in the dialog |

## Findings

### T28-P1-1: Welding variable text burns the template glyphs ("SN {{serial:4}}") instead of the record value, and the serial stops changing
- **Severity:** P1, wrong burn with no sign. The canvas draws the stored template both before and after, and no toast is shown. Every later record burns the same braces. This is the twin of T26-P1-1. #1875 fixed only Convert to Path, and the T26 refuter only pointed at Weld (READ ONLY, not counted), so this is new for Weld.
- **Where:** `vector-path-regions.ts:35` (`materializeVectorObjectWithin` takes the text's stored `paths`, which are the rendered template) via `vector-path-weld.ts:79`. There is no `variableTemplate` check in `selectionCanWeld` (`selection-command-state.ts:97-104`), `selectedVectorObjects` (`vector-path-selection.ts:37`) or `weldSelectionMutation` (`vector-path-actions.ts:215+`). The output path re-renders only `kind: 'text'` with a template, and the welded `imported-svg` is plain geometry.
- **Repro:** `C:\Users\stolk\kd-t1\zz-t28\t28-more.test.ts` A2, log `t28-more-AE.log`. Roboto 10 mm `SN {{serial:4}}` at (50, 50), serial 42, plus a 8 × 1.5 mm bar crossing the S, both on Line L. The menu is enabled.
  - Before Weld: lit 231.520 mm, bbox x 48–87.241.
  - After Weld: one `imported-svg` "Welded paths", lit 360.693 mm, bbox x 48–110.522. Toasts [].
  - Serial 43: before Weld, lit 232.472 (it changes); after Weld, lit 360.693 (it does not change).
- **Oracle:** an independent render of "SN 0042" ends at x 87.241, and the template ends at x 110.522. The burn moved from the value to the braces. LightBurn says converted variable text is "no longer substituted"; it does not burn template codes.
- **Suggested fix:** skip or refuse variable text (and variable barcodes) in Weld, with the notice #1875 added ("Bake Variable Text first"). Or bake it to the current value first. Apply the same guard to the other `materializeVectorObject` callers.

### T28-P2-1: Select All → Weld dissolves the registration jig: boxes 2 → 0, jig runs 4 → 0, and the burn order changes from piece-by-piece to operation-by-operation
- **Severity:** P2, same class as T26-P2-2. The geometry still burns in the same places, but the jig panel no longer sees boxes, and the run order the jig contract promises ("one piece finishes before the next starts") is lost with no warning.
- **Where:** registration boxes are unlocked `shape` objects. `selectAllObjects` includes them, and `weldSelectionMutation` (`vector-path-actions.ts:215-273`) welds them like any shape: every selected object, boxes included, ends up in one "welded" object. The jig copies are welded with their sources too, so `registrationJigCompilationRuns` finds nothing.
- **Repro:** `C:\Users\stolk\kd-t1\zz-t28\t28-burn.test.ts` B, log `t28-burn.log`. Two `createRegistrationBox` boxes; art made of two overlapping circles (op art, F2222) and an engrave square (op eng, F1111), with jig copies in box B.
  - Select All picks 8 of 8, and Weld is enabled.
  - After Weld: one object `welded-p…`, boxes 2 → 0, jig runs 4 → 0.
  - Decoded order before: F1111@A > F2222@A > F1111@B > F2222@B. After: F1111@A > F1111@B > F2222@A > F2222@B.
  - B2, welding only the art and its jig copies (boxes not selected): jig runs 2 → 0, and the sources and copies become one object.
- **Oracle:** the `registrationJigCompilationRuns` contract, and the decoded order before Weld.
- **Suggested fix:** do as #1875 does for Convert to Path: leave registration boxes (and captured-board boxes) out of Weld. Weld jig sources and copies only within the same box, or refuse jig copies with a notice.

### T28-P2-2: Shapes in the same operation with the same settings do not weld when their path colours differ: a false "Nothing to weld", or a partial weld
- **Severity:** P2, a refusal that should not happen, with a message that is wrong ("no selected shapes overlap within the same operation and settings"). In a mixed selection, the off-colour shape stays as a separate overlapping contour inside the welded object, so a Line operation cuts through the merged shape. The canvas shows this.
- **Where:** `vector-path-weld.ts:86` and `:143-155`. `batchKey` includes `color.toLowerCase()`, so `unionD` runs per colour even when the paths have explicit `operationIds`. Schema-v3 bindings make colour display-only:
  - `assignSelectionToLayer` → `bindSceneObjectToOperations` keeps the path colour (`operation-binding.ts:69-80`);
  - `recolorLayer` deliberately does not recolour bound artwork (`scene.ts:118-139`).
- **Repro:** `C:\Users\stolk\kd-t1\zz-t28\t28-more.test.ts`. Logs: `t28-more-AE.log` (E1, E2) and `t28-more.log` (E3).
  - E1: A (black, L1) and B (red, L2) overlap 50 mm². The real store action `assignSelectionToLayer('L1')` on B gives B `operationIds ["L1"]`, colour `#ff0000`. Weld A+B: unchanged, and the toast is "Nothing to weld…". Lit stays 120 mm; the union perimeter oracle is 90.
  - E2: recolour L1 to blue with the real `setLayerColor`. A stays black, and a new blue L1 shape overlapping it again gives "Nothing to weld".
  - E3: a mixed selection gives a welded object with two ColoredPaths (#000000, #ff0000), and B's outline survives inside the union.
- **Oracle:** analytic union of the overlapping rectangles (area 350, perimeter 90), and WORKFLOW F-CNC22, which says Weld joins shapes "within the same operation and output settings". Colour is neither of those for bound paths.
- **Related (known, different trigger):** rolling 2026-07-17 core-geometry-booleans P3-2, "cross-color Weld", which was deferred for LightBurn verification when colour still was the layer.
- **Suggested fix:** for paths with explicit operation bindings, leave colour out of the batch key and take the first source's colour for the result. Keep the colour key only for legacy colour-bound paths.

### T28-P2-3: With a locked shape in the selection, Weld is enabled and previews a result, but Apply does nothing and says nothing
- **Severity:** P2, a refusal that should not happen, with the warning missing. The dialog stays open on "Apply replaces the source objects", and pressing Apply changes nothing.
- **Where:**
  - `selectionCanWeld` ignores locked objects (`selection-command-state.ts:101`), and the dialog previews only the unlocked ones (`BooleanDialogHost.tsx:222`).
  - The store then refuses the whole selection when any member is locked, without a toast (`vector-path-actions.ts:222`).
- **Repro:** `C:\Users\stolk\kd-t1\zz-t28\t28-dialog.test.tsx`, log `t28-dialog.log`. Squares a and b overlap, square c is locked, and all three are selected.
  - The menu is enabled. Dialog status: "Apply replaces the source objects. Undo restores them."; Apply is not disabled.
  - After Apply: the project is unchanged, the dialog is still open, toasts [].
  - Control, the same scene with c unlocked: Apply welds and the dialog closes.
  - Store level (`t28-burn.test.ts` D3) also gives no change and no toast.
- **Oracle:** the menu's own reason text ("Select unlocked closed vector contours first.") and the preview disagree with Apply. LightBurn does not let locked shapes into a selection at all.
- **Suggested fix:** let the store weld the unlocked members, as the preview does and as Convert to Path skips locked objects. Or disable the command/Apply with "Unlock … or leave it out of the selection".

### T28-P3-1: The welded result drops each source's name, licence provenance (CC-BY credit) and kept-white choice
- **Repro:** `t28-burn.test.ts` D1/D5/D6, `t28-burn.log`.
  - Names "Left plate"/"Right plate" become undefined.
  - `libraryProvenance` (CC-BY creator) is undefined after Weld.
  - A `whiteInk: 'kept'` white path becomes undefined. The burn is unchanged: Fill 1500 → 1750 mm, the overlap now filled as a union. The saved-white knock-out would then ask again.
- **Where:** `weldBatches` / `commonObjectMetadata` (`vector-path-weld.ts:110-135,157-170`) copy only colour, operations, stroke, lock, override and power. This is the same family as T26-P3-1 (Convert to Path).
- **Fix:** carry provenance (all creators) and `whiteInk` when every source agrees.

### T28-P3-2: Welding two members of a three-member group removes the group
- **Repro:** D1. Group G = {A, C, E}. Weld A + C → groups `[]`; the welded object and E are both ungrouped.
- **Where:** `vector-path-actions.ts:261` removes the sources from groups, and the result is never added back.
- **Fix:** put the result in the group the sources shared.

### T28-P3-3: A zero-height rectangle in the selection refuses the whole Weld with "need closed contours only"
- **Repro:** `t28-geom.test.ts` G4 o, `t28-geom-G124.log`. A 20 × 0 rectangle plus a 20 × 10 rectangle gives an unchanged scene and the toast "Boolean, offset, and weld operations need closed contours only." The shape is closed; it has no area. A zero-area SVG sliver, by contrast, is silently dropped and the weld goes on (o2).
- **Fix:** drop zero-area closed contours as o2 does, or word the toast for them.

### T28-P3-4: Weld silently creates a frozen copy of the operation when sources carry a power scale or an override
- **Repro:** C2/C3. A new operation "L1 (Weld)" (P40, or P12/F777) appears with no notice. Changing L1's power 80 → 20 afterwards leaves the welded art at S120. Before Weld, a 50 % object followed L1.
- **Why not a defect:** the burn at the moment of Weld is identical, and the isolation is by design (ADR-350 item 2, ADR-540 Amd 3). Only the missing notice is raised.
- **Fix:** add a notice such as "Weld made 'L1 (Weld)' to keep the 50 % power; it no longer follows L1".

### T28-P3-5: Test gap
- No Weld test covers variable text or barcodes, registration boxes or jig copies, two colours in one bound operation, a locked member through the dialog, group membership, or provenance/`whiteInk`.

## Not a defect / limits
- **Absorbed inner shapes** (circle inside a circle → 1254.963 = the outer only) are the documented filled union (WORKFLOW F-CNC22 Edge; LightBurn says the same). The island inside a ring hole is kept (e2).
- **Corner-only touching and a 0.5 µm gap** do not merge ("Nothing to weld"). The result is still two regions, and LightBurn behaves the same for disjoint shapes.
- **Fill before Weld XORs overlapping objects** (C4: 3000 mm hatch = 300 mm² rather than 350). That is the Fill rule. Weld changes the Fill burn on purpose.
- **Open paths are refused**, as LightBurn does (greyed out).
- **Script and unwelded text** keep their non-zero coverage exactly (G3), so ADR-286 holds.
- **Known, re-observed, not counted again:** rolling v7 **L1-P3-1**. Weld results keep only chords (0.025 mm), so scaling the result later magnifies the flattening, and native G2/G3 arcs are lost. This is the same as T26-P2-1 for Convert to Path. I did not re-measure it.
- **T27 lead (filtered-scene output side):** not applicable (READ). Weld never prepares output on a filtered scene; kerf and lead sides are decided later by `prepareOutput` on the whole scene. I did not measure kerf after Weld.
- **Not checked:**
  - Save and reopen of a welded project (READ: plain `imported-svg` plus an ordinary layer);
  - the browser UI (the dialog was rendered in jsdom only);
  - the Free/Pro admission path (ADR-540 Amd 3);
  - CNC operations.
- **Scratch:** `C:\Users\stolk\kd-t1\zz-t28\` holds `t28-geom.test.ts` (G1/G2/G4 log `t28-geom-G124.log`, G3 log `t28-geom.log`), `t28-burn.test.ts` (`t28-burn.log`), `t28-more.test.ts` (`t28-more-AE.log`, `t28-more.log`), `t28-dialog.test.tsx` (`t28-dialog.log`), `oracle.ts` and `decode.ts`. Some cases were switched to `it.skip` after their logs were saved. Run with `node node_modules/vitest/vitest.mjs run --config ../zz-t28/vitest.config.mts --maxWorkers=1 ../zz-t28/<file>` from the tree root.

## Totals
Raised 9; P1 1; P2 3; P3 5; known 1 (rolling v7 L1-P3-1, chord-only results; T28-P2-2 is related to rolling 2026-07-17 core-geometry-booleans P3-2, deferred).
