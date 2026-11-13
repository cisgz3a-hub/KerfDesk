# T28 Weld — refuter report
Tree: origin/main @ 3293fd15d (read-only). Command id: `tools.weld`. Main checked at origin/main @ 045670634.
Own scratch: `C:\Users\stolk\kd-t1\zz-t28r`:
- `gread.ts`: my own G-code reader. It counts lit G1/G2/G3 moves, extent, (feed, slot) run order, and a 1 µm move fingerprint.
- `r28.test.ts`, log `r28.log`.
- `r28-dialog.test.tsx`, log `r28-dialog.log`.
- My own `vitest.config.mts`.

I did not reuse any of the auditor's scripts or its decoder. My scenes are different too:
- a Tinos serif font, template `No.{{serial:3}}`;
- a Code 128 variable barcode;
- a jig built through the real jig-editor session functions;
- the real dialog reached through a real UI route.

Run from the tree root: `NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config ../zz-t28r/vitest.config.mts --maxWorkers=1 ../zz-t28r/r28.test.ts ../zz-t28r/r28-dialog.test.tsx`. Result 7/7, with 3.0 GB free.

## Verdicts

| Claim | Verdict |
|---|---|
| T28-P1-1 welding variable text burns the template glyphs | **CONFIRMED, P1 kept.** Still on main after #1875. The trigger is wider than reported (no overlap needed). Variable barcodes freeze in the same way. |
| T28-P2-1 Select All → Weld dissolves the registration jig | **CONFIRMED, P2 kept, re-scoped.** In the real jig flow the outlines are locked, so the boxes survive. The jig still dissolves, because sources and jig copies merge: jig runs 4 → 0 and the order changes. Boxes 2 → 0 needs Unlock All first. |
| T28-P2-2 same operation, different path colours do not weld | **CONFIRMED, P2 kept.** Not KNOWN: the rolling 2026-07-17 P3-2 is a different case. "Nothing to weld" is wrong. |
| T28-P2-3 a locked member makes Apply do nothing and say nothing | **Reproduced, RE-GRADED P2 → P3.** No ordinary route puts a locked object into the selection. The only route I found is Unlock All → Select All → Edit jig → Save (see T28R-P3-1). |
| P3-1 … P3-5 | Spot-checked: consistent (details below) |

## Evidence per claim

### T28-P1-1 — CONFIRMED P1
**Is there a path that bakes the value first? No.**
- Apply goes through `weldSelectionMutation` (`vector-path-actions.ts:215-222`), then `weldPlanForSelection`, then `weldVectorObjects` → `normalizeVectorObjectBatches` → `materializeVectorObjectWithin` (`vector-path-tools.ts:77-118`). That reads the object's stored `paths`.
- The stored `paths` of a variable text are the template glyphs. `build-text-object.ts:44-84` renders `content`, the template string.
- No guard for `variableTemplate` or `objectVariableTemplate` exists in any of:
  - `selectionCanWeld` (`selection-command-state.ts:97-104`);
  - `selectedVectorObjects`;
  - `BooleanDialogHost.tsx` (the only filter, at :222, is for locked objects);
  - the weld plan;
  - the core.

**Own repro (R1).** Tinos 8 mm `No.{{serial:3}}`, parsed by the real `parseVariableTemplateSource`, plus a 12 × 0.8 mm bar through the glyph middles, on Line T. Serial 7. The menu is enabled. After Weld: one `imported-svg` "Welded paths", and toasts `[]`.

| | lit mm | max X | fingerprint changes 7 → 8 |
|---|---|---|---|
| Before Weld | 157.432 | 53.316 | yes |
| After Weld | 284.199 | 79.727 | **no** |

- Oracle: an independent render of "No.007" ends at X 53.316. The template ends at X 79.727. After Weld, the burn is the template, and the serial no longer reaches it.

**Wider trigger (R1c).** The variable text does not have to overlap anything.
- Scene: two overlapping rectangles, plus `ID {{serial:4}}` placed apart from them.
- Real `selectAllObjects` → Weld gives one welded object; the text is absorbed with the rest.
- In the text area, max X goes from 119.283 to 136.249, which is exactly the template's max X. Lit length goes from 107.668 to 195.280 mm.
- So any Select All → Weld on a production plate freezes its variable text into braces.

**Notice or Job Review warning? None.**
- Toasts are `[]` (R1, R1c).
- After Weld the project holds no variable data (`project still has variable data after weld: false`). No variable-data check can fire after that. The output snapshot reports nothing unusual.
- The canvas drew the stored template glyphs before Weld too (T26 refuter's finding), so the canvas does not change. The dialog preview also shows template glyphs.

**Variable barcodes behave the same (R1b).**
- Code 128 `LOT-{{serial:3}}`, inserted at serial 41 (stored code LOT-041). A tab overlaps the bars, both on Fill F.
- Before Weld, the burn changes with the serial.
- After Weld, serial 42 and serial 43 give the same fingerprint (`4530:9c5f829f`). It equals, move for move, the weld of a **plain LOT-041** code. It does not equal the weld of a plain LOT-042 code (`4530:c8bb287`).
- So every later piece burns the insert-time code: a valid, scannable but **duplicate** serial, with no warning.

**ADR-386 Amd 2 does not cover Weld.**
- Its acceptance is one line in Consequences: "Convert to Path still converts the stored code". It names Convert to Path only.
- If the maintainer extends that acceptance to Weld, the barcode half becomes by-design. The text half stands either way, because braces are not a valid value. The T26 refuter made the same point for Convert.

**Main.**
- `git diff 3293fd15d origin/main` on the Weld files shows one change only: `vector-path-actions.ts` moves `convertSelectionToPathMutation` out to `convert-to-path-mutation.ts`.
- On main, `convert-to-path-mutation.ts` skips variable text and registration boxes in Convert to Path only.
- `git grep objectVariableTemplate|isRegistrationBox` on main finds no hit in any Weld file (`vector-path-actions.ts`, `vector-path-weld-plan.ts`, `vector-path-selection.ts`, `selection-command-state.ts`, `BooleanDialogHost.tsx`, `core/geometry/vector-path-weld*.ts`).
- **Weld is still affected on main.**

**Severity:** P1 kept: a wrong burn with no sign. The fix should cover both variable text and variable barcodes, or the ADR should say that barcodes are accepted for Weld.

### T28-P2-1 — CONFIRMED P2, re-scoped
**My attempt to refute.** The auditor built boxes with `createRegistrationBox`, so they were unlocked. In the app, the main canvas gets its outlines only from the jig editor:
- `addRegistrationBox` has no UI caller;
- `commitJigEditorSession` always runs `lockOutlines` (`jig-editor-session.ts:221`);
- ADR-606: "Saving still locks outlines on the main canvas".

`selectAllObjects` skips locked objects, so the "boxes 2 → 0" part needs the operator to unlock on purpose first.

**What still happens in the real flow (R2).** I built the jig with the real `createJigEditorSession` → `changeJigDraft` (art: two overlapping d16 circles on `art` F2222, and a 5 mm square on `eng` F1111) → `replaceJigLayout` (1 × 2) → `selectJigObjects` → `centerJigArtwork` → `commitJigEditorSession`. Then the real `setRegistrationOutput('artwork')`.
- After the save: 2 boxes, both locked; 3 sources and 3 `registration-jig-copy:` objects; 4 jig runs.
- Select All picks 6 of 8 (boxes not included). Weld is enabled.
- After Weld: one `welded-paths` object, and both boxes are kept, but **jig runs 4 → 0**, with toasts `[]`.
- The decoded run order changes:
  - before: `F1111@A > F2222@A > F1111@B > F2222@B`, which is piece by piece, as `registrationJigCompilationRuns` promises ("one piece finishes before the next starts");
  - after: `F1111@A > F1111@B > F2222@A > F2222@B`.
- The weld also merges each slot's copy with the source, so the jig editor no longer has per-slot copies to keep in step.

**The auditor's version (R2u).** Unlock All → Select All (8) → Weld: boxes 2 → 0 and jig runs 0. This matches the report, but it needs the deliberate unlock.

**Fix note:** skipping registration boxes, as #1875 does for Convert, is **not enough** for Weld. The common case has locked boxes and fails through the copies. Weld must not merge a jig source with its copies in other slots: weld within each slot, or refuse jig copies with a notice.

**Severity:** P2 kept. The geometry stays in place and Undo works, but the jig's per-piece order is lost with no warning.

### T28-P2-2 — CONFIRMED P2 (not KNOWN)
**Colour is invisible for bound paths:**
- The canvas paints bound paths in the **operation's** colour (`object-display.ts:244-248`). `path.color` is used only when no operation resolves.
- Output follows `operationIds` (`sceneObjectUsesOperation`).
- `recolorLayer` deliberately leaves explicitly bound artwork alone (`scene.ts:118-139`), and binding keeps the path colour (`operation-binding.ts:69-80`).
- In LightBurn, colour *is* the layer, so "same layer, different colour" cannot happen there. Within a layer, LightBurn's Weld merges everything.

**R3a, the real Assign to operation:**
- B (red, L2) is assigned to L1 with `assignSelectionToLayer('L1')`. B now has ops `["L1"]` but path colour `#ff0000`, and L2 is pruned.
- The canvas paints both A and B in `#000000`.
- Weld A + B: unchanged, and the toast says "Nothing to weld: no selected shapes overlap within the same operation and settings." That is false: they share one operation and the same settings.
- Control R3b (B drawn black, same geometry): welds, lit 200 → 150.000. Analytic union perimeter: 150.

**R3c, Line burn of a mixed selection.** A and C are black and B is red, all on L1 Line and overlapping.
- After Weld, the object holds 2 ColoredPaths, and lit goes 300 → **230.000** mm. The union outline oracle is 150.
- 230 is exactly perimeter(A ∪ C) + perimeter(B) = 130 + 100. So B's full outline is still cut **inside** the merged shape.
- The canvas shows this inner line.

**Is there a reason for the colour key? None found.**
- The key is needed only for legacy colour-bound paths with no `operationIds`, where colour *is* the operation.
- The existing test "preserves distinct color and operation batches" uses distinct operations. It never asserts the same operation with different colours.

**Is it KNOWN? No.**
- Rolling 2026-07-17 core-geometry-booleans P3-2 is about cross-colour = **cross-layer** Weld, from the time when colour was the layer. ADR-350 item 2 later settled that case: Weld keeps operation partitions.
- The same-operation, different-colour case exists only since schema-v3 bindings. It is a different trigger with a false refusal, so it is not KNOWN.

**Severity:** P2 kept. A refusal that should not happen, with a wrong message; in the mixed case, an extra inner cut that the user is likely to see.

### T28-P2-3 — reproduced, RE-GRADED to P3
**Reachability (`r28-dialog.test.tsx`, test 1).** Every ordinary route keeps locked objects out of the selection:
- `selectAllObjects` (`store-actions.ts:282-287`);
- canvas click (`hit-test.ts:141`);
- marquee (`selection-marquee.ts:22`);
- the design tree (the locked row's button is disabled, `DesignRowButtons.tsx:32`);
- group expansion (`selectionCandidate`, `scene-group-actions.ts:234-242`);
- `lockSelection` (clears the selection);
- Undo and Redo (`visibleSelectionState`, `store-actions.ts:390-412`);
- remote control (`not_editable`).

Log:
- Select All gives `["a","b"]`.
- Selecting the locked `c` never selects it.
- After `lockSelection` the selection is `[]`.

**The one route I found (test 2):**
1. First jig save: the outline is locked.
2. Unlock All, then Select All: `["registration-box","a","b"]`.
3. Edit jig, then Save (real `commitJigEditorSession`).
4. Result: the selection is still `["registration-box","a","b"]`, but `registration-box` is now **locked**.

Then I drove the real `BooleanDialogHost`:
- Menu enabled `true`.
- Status: "Apply replaces the source objects. Undo restores them."; Apply is not disabled.
- After clicking Apply: project unchanged, dialog still open, toasts `[]`.

So the auditor's behaviour is real.

**Why P3:**
- It needs that four-step sequence.
- Nothing is burned wrongly, and Cancel or deselecting recovers.
- The root cause is the jig save restoring a selection that holds locked objects (T28R-P3-1), not Weld.

The missing message is still worth fixing in the P3 sweep: make the dialog/store skip locked members, as the preview already does.

### P3 spot-checks
- **P3-1:** confirmed by reading. `commonObjectMetadata` (`vector-path-weld.ts:157-170`) copies only `locked`, `operationOverride` and `powerScale`. Name, provenance and `whiteInk` are dropped.
- **P3-2:** confirmed by reading. `vector-path-actions.ts:261` removes the sources from groups and never adds the result. The Boolean mutation does the same (`:300-305`).
- **P3-3:** plausible by reading. `isClosedPolygon` needs `MIN_CLOSED_POINTS` after normalising, so a zero-height rectangle fails with the `open-contours` error (`vector-path-regions.ts:45-53`). I did not run it.
- **P3-4:** consistent with ADR-350 item 2 and ADR-540 Amd 3. Only the missing notice is a defect.
- **P3-5:** agreed. No existing test covers variable data, jig copies, same-operation colours or locked members.

## Extra findings

### T28R-P3-1: Jig editor Save gives back a main selection that contains outlines it has just locked
- **Severity:** P3. It breaks the app-wide rule that locked objects are never selected (`visibleSelectionState`). It is the only route I found into T28-P2-3's state, and Delete then removes a locked outline. Undo restores it, and the outline is shown as selected.
- **Where:** `src/ui/workspace/registration-jig/jig-editor-session.ts:221-231`. It locks with `lockOutlines` and then restores `selectedJigIds(state)`, filtered only by `live`, not by `locked`.
- **Repro (ran):** `r28-dialog.test.tsx` test 2, log `r28-dialog.log`.
  - Unlock All → Select All → Edit jig → Save gives `locked yet selected ["registration-box"]`.
  - The real Delete path (`selection-delete-action.ts`) then gives boxes 1 → 0.
- **Fix:** filter the restored selection with `visibleSelectionState` (drop locked or hidden ids). Optionally also make `removeSceneObjects` skip locked ids.

## Totals
Verdicts: P1 1 confirmed (T28-P1-1, scope widened to non-overlapping text and to variable barcodes; still on main), P2 2 confirmed (T28-P2-1 re-scoped, T28-P2-2), 1 re-graded P2 → P3 (T28-P2-3), 0 refuted; P3s consistent. Extra raised: 1 (P3 1: T28R-P3-1). Known: none new (rolling 2026-07-17 P3-2 judged a different trigger; rolling v7 L1-P3-1 as auditor).
