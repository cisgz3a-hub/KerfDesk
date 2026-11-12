# T06 Fill Selection — auditor report
Tree: origin/main @ 856cb3ae1 (export at `C:\Users\stolk\kd-t1\t06-main`). Command id: `tools.fill-selection`.

## Map
- Menu: `src/ui/commands/app-menu-groups.ts:156` (Tools → Fill repair); also the workspace context bar's selection row (`src/ui/commands/workspace-context-commands.ts:41`), which renders from the same gated `buildAppCommands` list.
- Command: `src/ui/commands/command-families.ts:69-83`. Enabled when `hasFillableSelection` = `selectionHasVectorObject` (`src/ui/commands/use-app-commands.ts:167`, `selection-command-state.ts:59`): any selected vector, open or closed, locked or not. Disabled text "Select vector artwork first."; tooltip `command-help-topics.ts:206` "Move selected vector artwork to its own Fill layer." No dialog.
- Handler: `tool-command-context.ts:119` → store `fillSelectionSeparately` → `src/ui/state/fill-selection-actions.ts`:
  - `fillSelectionMutation` (54): vector ids of the selection (rasters/reliefs dropped silently).
  - If the selection uses exactly one operation and no unselected artwork uses it → `ensureOperationIsFill` (108-111): `updateLayer(scene, id, { mode: 'fill' })` in place.
  - Otherwise → `isolateSelectionToNewFillOperation` (74-105): `createArtworkOperation` from the FIRST selected object (folds that object's legacy top-level override into the base, `artwork-operation.ts:68`), color-keyed layer defaults, `seedFreshLaserLayer` (ADR-496 recipe) or `seedFreshCncLayer`, `bindSceneObjectToOperations(object, [new])` (replaces every object- and path-level binding), `addLayer` (appended last), then `pruneOrphanLayers` (deletes every operation no artwork uses).
  - One Undo step via `pushUndo`; redo stack cleared.
- CNC: hidden by ADR-101 gate (`machine-command-gate.ts:36`); the action's CNC branch is unreachable from the UI.
- Governing decisions: ADR-101 (CNC gate), ADR-496 §4/§6 (recipes for new operations; "a cut switched to Fill does not engrave at cutting power"), ADR-430/631 (artwork-own settings), LightBurn parity rule (assigning shapes to a layer moves them). No WORKFLOW.md section names the tool.
- Changes since 2026-10-16: `fill-selection-actions.ts` unchanged since 2b6427392 (ADR-496, 2026-09-28). Dependencies changed: `artwork-operation.ts` (776b32207 ink/pulse colours, 7449c6362 S2-P3-3 name cache), `operation-binding.ts` (ab3226fd1 C2-P3-1, 26ead0e8e C2-P3-2). None changes the tool's behaviour.

## October register re-check
Row 53 ("V: isolate shared operations correctly") recorded verification, not a repair: two shapes on one operation → selected one becomes Fill (spacing 0.1, angle 0), the other stays Line, Undo → Line.
- Still holds. `t06-burn.test.ts` case A: after Fill Selection on `a`, operation L is byte-identical (JSON equal), `b` still emits 4 moves, 80.000 mm at S400 F1000 before and after; `a` is hatched on a new op `a Fill` (200 rows, 400.0 mm² vs 400 oracle). Case G: Undo restores the exact project object (same reference); Redo gives a JSON-identical project.

## Checks run
| Check | Method | Result |
|---|---|---|
| Shared op: unselected artwork keeps settings and burn | store action + prepareOutput → G-code decode (`zz-t06/t06-burn.test.ts` A) | Pass: L unchanged, b's moves identical |
| Hatch area vs independent grid oracle (even-odd/non-zero) | `decode.ts` gridArea (0.05 mm) vs lit length × spacing (B) | Pass: ring 1200/1200; mirrored+rotated 30°+2×1 scale ring 2400/2400 and lit bbox = world bbox ±0.02; pentagram 309.7 vs 310.1 even-odd (non-zero would be 448.7); overlapping contours one path 600/600; bowtie 300/300 |
| Two overlapping separate objects selected onto one Fill | (N) | 600 mm² = XOR (union 700): overlap left unburned, LightBurn-like cross-shape even-odd |
| Open paths | (C, K, O) | Open contour omitted from output; preflight `offset-fill-open-contour` refuses the job; open-only also adds "Internal error: G-code generation produced no cuts." No notice from the tool itself (P3-3) |
| Multi-operation artwork (Fill + cut Line), path-level ops | (D) | Both ops replaced by one default Fill op; cut gone (P2-1, P3-6) |
| Already-Fill artwork on a shared Fill op | (H) | Tuned settings replaced by defaults (P2-1) |
| Sole-owner op linked to a cut recipe | `t06-recipe.test.ts` M | Engraves at cut recipe (P1-1) |
| Artwork-own Mode | (I) via `setObjectsOperationOverrideForOperation`, the action the inspector's Mode switch calls | Silent no-op with Undo step (P2-2) |
| Legacy top-level override | (E) | First object's override leaks to other selected artwork (P3-2) |
| Empty manual operation | (F) | Deleted (P3-1) |
| Locked artwork | (F) + read `scene-lock-actions.ts:33`, `scene-group-actions.ts:241`, `layer-actions.ts:236` | Action ignores `locked`, but Lock clears the selection and group/layer selection skip locked artwork: not reachable |
| Output-off operation | (J) | Shared → new op Output on, burns 4000 mm; unshared → stays off, burns 0 (P3-5) |
| Mixed raster + vector | (L) | Raster untouched on Image op, vector moved to Fill |
| Empty / raster-only selection | existing `fill-selection-actions.test.ts`, `command-fill-selection.test.ts` (10 tests pass) | Command disabled; action returns `{}` with no Undo |
| Undo / Redo / Save → reopen | (G) `serializeProject` → `deserializeProject` → G-code | Exact; G-code byte-identical after reopen |
| Cut order | (G) | New Fill op appended after the cut that encloses it; cut moves idx 0..3, fill 4..203, no advisory (P3-4) |
| CNC | read `machine-command-gate.ts:36`, `WorkspaceContextBar.tsx:42` | Hidden in both surfaces |

Free memory 2.9 GB; Vitest at `--maxWorkers=1`; no browser run (the tool has no dialog).

## Findings

### T06-P1-1: Fill Selection on artwork that owns its operation engraves at the linked cut recipe (ADR-496 §6 bypassed)
- Severity P1: wrong burn. In the common case of a drawn shape, which gets its own operation, the whole area is hatched at cut power, speed and passes: about 39× the energy per mm² of the Fill recipe. That risks charring and fire. ADR-496 §6 exists to prevent exactly this ("so a cut switched to Fill does not engrave at cutting power"). The operation also stays linked to the cut preset, so Cut Settings and Job Review name `birch-3-cut` on a Fill.
- Where: `src/ui/state/fill-selection-actions.ts:108-111`. `ensureOperationIsFill` uses a bare `updateLayer(…, { mode: 'fill' })` and never calls `sceneWithModeSwitchRecipe`/`reseedSwitchedLaserLayer` (`src/ui/state/laser-recipe-seeding.ts:87-139`), which `setLayerParam` applies (`layer-param-actions.ts:99`).
- Repro: `C:\Users\stolk\kd-t1\zz-t06\t06-recipe.test.ts` (log `t06-recipe.log`). Library with `birch-3-cut` (Line 90 %, 400 mm/min, 2 passes) and `birch-3-engrave` (Fill 35 %, 3000 mm/min). Job material Birch 3 mm with auto-apply. Draw a 20×10 rectangle (its op links the cut recipe), select it, run Fill Selection.
  - Actual: `fill p90 s400 passes2 preset=birch-3-cut`; G-code 100 rows, S900, F400, 4000 mm lit (two passes).
  - Expected, and what the inspector's Fill switch gives on the same shape: `fill p35 s3000 passes1 preset=birch-3-engrave`; S350, F3000, 2000 mm lit.
- Oracle: ADR-496 §6 and the shipped test `laser-recipe-seeding.test.ts` "switches an untouched operation to the new mode's recipe" (35/3000). Energy ∝ power × passes / speed: 90×2/400 = 0.45 vs 35/3000 = 0.0117, a ratio of 38.6.
- Related, by the same code: with no library, a hand-set cut op (90 %, 300 mm/min) is filled at 90 %/300 (LightBurn also keeps settings on a mode change). The same command on the same artwork gives 30 %/1500 when the operation happens to be shared (isolate path). So the result depends on ownership the user cannot see.
- Suggested fix: build the in-place switch through `sceneWithModeSwitchRecipe(project, updateLayer(...), id, { mode: 'fill' }, library)`, the same path `setLayerParam` takes. Add a regression test beside `fill-selection-actions.test.ts`.

### T06-P2-1: Artwork that already fills, or also has a cut, gets a default Fill op: tuned Fill settings are discarded (and its other operations dropped)
- Severity P2: a wrong result with burn impact that is not obvious. The command reads as "make this fill", and on artwork that already fills it changes the burn.
- Where: `src/ui/state/fill-selection-actions.ts:74-105`. The isolate path always seeds the new op from `createLayer` defaults, layer defaults and recipe. It never copies the Fill op the artwork already uses, and `bindSceneObjectToOperations` (`operation-binding.ts:56-77`) replaces every other binding.
- Repro: `C:\Users\stolk\kd-t1\zz-t06\t06-more.test.ts` case H, and `t06-burn.test.ts` case D (logs `t06-more.log`, `t06-burn.log`).
  - H: a and b share Fill F (25 %, 3000 mm/min, 0.2 mm, 45°). Select a → a's op `fill p30 s1500 sp0.1`, angle 0. Lit length goes 2000 → 4000 mm, S250 → S300, F3000 → F1500. That is 4.8× the energy per mm² (30/(1500×0.1) vs 25/(3000×0.2)).
  - D: one artwork bound to F (Fill 25 %/3000) and C (Line 90 %/300), both unshared. After the command it has one op, `fill p30 s1500`, and both F and C are pruned. The four 30 mm F300 cut moves are gone and the engrave runs at S300/F1500 instead of S250/F3000.
- Oracle: ADR-496 §4 ("Pasted and cloned operations keep the settings they carry"). Also the command's own fast path, which leaves an unshared Fill op unchanged.
- Suggested fix: when the selection already uses a Fill op, isolate by cloning that op's settings (as `clone-artwork-operations.ts` does) and only switch mode/seed for non-Fill sources. Keep, or at least announce, the non-Fill operations the artwork loses.

### T06-P2-2: Artwork-own Mode makes Fill Selection a silent no-op that still flips the operation to Fill and adds an Undo step
- Severity P2: a refusal that should not happen and gives no message. The Cuts list then shows the operation as Fill while the artwork still burns as Line, and every press adds another Undo entry.
- Where: `fill-selection-actions.ts:54-71`/`108-111` ignore `operationOverride`. `operationOverrideForObject` (`src/core/effective-output/effective-output.ts:24-38`) lets `byOperation[L].mode` win. The inspector writes `mode` into the artwork override whenever it edits artwork-own settings (`src/ui/layers/SelectedLaserOperationFields.tsx:47,77`; `object-properties-actions.ts:290`).
- Repro: `t06-more.test.ts` case I. Artwork m alone on Line L. Run `setObjectsOperationOverrideForOperation(['m'], 'L', { power: 20 })`, then `{ mode: 'line' }` (override `{"byOperation":{"L":{"power":20,"mode":"line"}}}`), then Fill Selection.
  - Actual: L.mode = fill; effective `L(line p20)`; lit length 80.0 mm before and after (outline only); dirty true; Undo +1, and +2 after a second press.
  - Expected: m hatched (20×20 → 4000 mm at 0.1 mm), or a notice saying why not.
  - Same with a legacy top-level `{ mode: 'line' }` on a shared op (case E): a new Fill op is created but m2 still burns 3 Line rows.
- Oracle: the tool's contract ("Move selected vector artwork to … Fill") and the effective-operation rule above.
- Suggested fix: clear `mode` (top-level and `byOperation[source]`) from the selected artworks' overrides as part of the same mutation, or refuse with a notice. Never return a changed scene whose effective output is unchanged.

### T06-P3-1: Fill Selection deletes unrelated empty operations
- READ + run. Where: `fill-selection-actions.ts:105` `pruneOrphanLayers` (`scene-mutations.ts:186`) removes every unused op. `assignSelectionToLayer` deliberately keeps operations that were already empty (`layer-actions.ts:213-218`).
- Repro: case F. An empty Fill op E (33 %/4444) the user had set up is gone after Fill Selection on unrelated artwork (layers `L, operation-a`). Undo restores it.
- Fix: prune only operations the selection used before (as `pruneAssignmentOrphans`).

### T06-P3-2: A legacy top-level override on the first selected artwork leaks into the other selected artwork, depending on selection order
- Where: `artwork-operation.ts:68` folds `first`'s override into the new op base. The caller (`fill-selection-actions.ts:80`) then binds every selected object to it.
- Repro: case E. a has `{power:15}` and c has none. Select a then c: c burns at `fill p15`. Select c then a: c burns at `p30`.
- Capped P3: current UI writes `byOperation` overrides. Top-level ones come from legacy or migration paths only (`setSelectedObjectsOperationOverride` has no UI caller), and reachability was not proven.
- Fix: build the op from a plain base, not `effectiveOperationForObject(base, first)`.

### T06-P3-3: The tool accepts open-only or mixed selections without a word; the job is then refused, once with "Internal error"
- Run (C, K, O). Open contours are omitted from Fill, and preflight correctly raises `offset-fill-open-contour` (job refused). For open-only artwork it also says "Internal error: G-code generation produced no cuts." (`src/core/preflight/preflight.ts:237`), which is not an internal error. Fill Selection itself gives no notice although its neighbour "Close Open Fill Contours" exists for exactly this.
- Fix: after the mutation, if `openFillContours(scene, selectedIds)` is non-empty, push a notice that offers Close Open Fill Contours. Suppress `empty-output` when an open-fill issue explains it.

### T06-P3-4: The new Fill op goes last, so an inner engraving runs after the cut that frees the part
- Run (G). An outer 60 mm cut (L, 90 %/300) and an inner square that shared L. Fill Selection appends `operation-inner` after L, so the cut moves are emitted first (idx 0..3) and the fill after (4..203). No advisory.
- LightBurn behaves the same (layer list order), so P3. Suggest inserting the isolated op directly before the operation it was split from.

### T06-P3-5: The Output-off state depends on sharing
- Run (J). Artwork on an Output-off Line op. If the op is shared, the new Fill op has Output on and burns 4000 mm. If unshared, the op keeps Output off and nothing burns. Suggest carrying `output`/`visible` over to the isolated op, or saying so.

### T06-P3-6: Multi-operation and sub-layer artwork silently loses its other operations
- Run (D), with the path-level variant too. A Fill + cut Line artwork, or path-level F/C bindings, ends with only the new Fill op. A shared source op's sub-layers are not copied either (read). This is consistent with the "move" semantics of `assignSelectionToLayer` and LightBurn layers, so P3, but no notice is given. Suggest a notice listing the operations removed.

### T06-P3-7: Test gap
- `fill-selection-actions.test.ts` covers ownership and colour defaults only. It has no case for a recipe-linked mode switch (P1-1), already-Fill/multi-op sources (P2-1), artwork overrides (P2-2, P3-2), empty-operation pruning or open contours.

## Not a defect / limits
- Fill geometry through the real output path matches an independent even-odd grid oracle for holes, self-crossing, overlapping contours and mirrored/rotated/non-uniformly scaled artwork. Text uses non-zero by design (`fill-material-components.ts:57`); I did not build a text object (needs fonts), so text is unchecked.
- Overlapping separate artworks on one Fill leave their overlap unburned (XOR, case N). That is the shared fill-ownership rule (`fill-material-ownership.ts:36`), LightBurn-like, and not specific to this tool. I did not compare it with the canvas preview, because there was no browser run.
- Locked artwork: the action does not check `locked`, but locked artwork cannot be in the selection (Lock clears it; group and layer selection skip locked). Not reachable.
- Raster in a mixed selection is skipped silently. That is by design ("vector artwork"), and the command is disabled for raster-only selections.
- CNC: hidden by ADR-101 in the menu and the context bar.
- I did not check the dialog or keyboard: the tool has none. I made no browser run.

## Totals
Raised 10; P1 1; P2 2; P3 7; known 0. Ledgers, `docs/audits/**` and the T01–T05 reports were searched; the open-only "Internal error" wording echoes the rolling-v2 03 P2-4 message text, but for a different cause.
