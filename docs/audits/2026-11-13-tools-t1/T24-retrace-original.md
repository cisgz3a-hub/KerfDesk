# T24 Re-trace Original — auditor report
Tree: origin/main @ 1988481a5. Command id: `tools.retrace-original`.

## Map
- **Command:** Tools → Trace → Re-trace Original… (`src/ui/commands/command-raster-family.ts:79-95`). Enabled when `traceSourceForTracedImage(project, selected) !== null` (`use-app-commands.ts:160`): the selection is a `traced-image` (or a rasterized trace result) whose `traceSourceId` still resolves to a `raster-image`. Disabled text: "Select a traced image whose original raster is still in the project." Tooltip (`raster-command-help.ts:52`): "Re-open Trace Image from the original raster kept behind the selected trace."
- **Action:** `retraceOriginalAction` (`src/ui/commands/image-command-actions.ts:41-66`) → `openImageDialog(liveSource, { replaceTraceId: selected.id, traceSettings })`; missing source → error toast "Original raster for X is missing. Re-trace needs the kept source image."
- **Dialog:** the ordinary Trace dialog (`ImportImageDialog.tsx`), settings restored from the record (ADR-408), Delete Image After trace cleared (`use-trace-dialog-settings.ts:80`). No retrace-specific text in the dialog.
- **Commit:** `commitTraceResult` (`ImportImageDialog.tsx:359-436`) builds a brand-new `TracedImage` with `id = replaceTraceId`, `transform: IDENTITY_TRANSFORM`, no name/powerScale/override carried; placement = `positionTraceOverRasterSource(liveSource, traced)` (`:410`). → `commitTraceOutput` (`trace-output-commit.ts:45`) → store `traceExistingImage` (`import-actions.ts:87`) → `applyTraceToExisting` (`scene-mutations.ts:274-319`): positions over the source (`:288`), `createArtworkOperations` makes a NEW operation (`:295`, id `operation-<id>-2`, `artwork-operation.ts:54,183-201`), `replaceObject` in place (`:306`), `pruneOrphanLayers` removes the old operation (`:310-311`). New laser operations are seeded from the material recipe / defaults (`import-actions.ts` `withFreshCncLayers`, ADR-496). Raster output: `rasterized-trace-mutation.ts:61-70`.
- **ADRs:** 026 (trace overlays its source), 027, 408 (settings travel with the trace; "replaces the selected trace in place"), 455, 673 (+Amd 1, kept picture engraves), 496 (new-operation seeding). WORKFLOW F-E1 step 4 (`WORKFLOW.md:4899-4910`), F-L3 "Edit → re-trace loop" (`WORKFLOW.md:9592-9617`).
- **Changes since 2026-10-16** (git log on the files above): `2b1dd06c9` (major PR feature audit: dependency repair after trace replacement), `f3e535e79`, the ADR-673 series (`7a4c0584c`, `adefa2851`, `47cb82358`, `dea181bf7`, `f3454c270` kept photo engraves, copies keep its settings), `776b32207` (operation colours), `28768335c` (hand tabs), `4749f103b`, `7449c6362`. None touches retrace placement or operation reuse.

## October register re-check
Row #31 ("retained source and normalised intent; real serializer round-trip and shared trace stress; long repeated-save soak absent"): **still holds.** Settings retention, stable trace identity and no duplicate artwork pass on this tree: `ImportImageDialog.retrace-settings`, `image-command-actions`, `command-retrace-original`, `trace-retrace-order`, `retrace-kind-dependencies`, `rasterized-trace-mutation`, `ImportImageDialog.diagonal-contacts`, `trace-removal-references` — 8 files, 41 tests pass. My own run (`zz-t24/t24a.test.ts` case 5): save → reopen → Re-trace opens on the recorded record (`Line Art`, smoothness 0.5, fill style offset), the replacement keeps the same id, one trace, no duplicates. The long repeated-save soak is still absent (not run: memory).

## Checks run
| Check | Method | Result |
|---|---|---|
| Re-trace after the user moved / rotated / scaled / mirrored the TRACE | `zz-t24/t24a.test.ts` case 1, `t24b.test.ts` case 1: real `retraceOriginalAction` → real dialog `commit` → store → `prepareOutput` → G-code (decode replaced by synthetic pixels, T23 harness) | Trace snaps back over the source: transform `{x 200, y 150, scale 0.05, rot 90}` → `{x 20, y 20, scale 0.1, rot 0}`; burn box (185.5–198.5, 151.1–169.3) → (22–58.6, 23.1–49). **T24-P1-1** |
| Operation settings, per-object override, power scale, name after Re-trace | t24a cases 1–2, t24b case 1 | Old operation "art" (power 80, speed 600, passes 2) pruned; new "art 2" (power 30, speed 1500, passes 1, new colour). Per-operation override `{power 12, hatch 0.3}`, powerScale 40, name "Coaster logo" all dropped. Max S 800 → 300. **T24-P1-2** |
| Copies (Duplicate) | t24a case 3, t24b case 2 | Copy shares `traceSourceId` and the original's operation; Re-trace of a copy replaces only the copy (original object `===` unchanged) but moves it back over the photo: blank 2 burn 2199 mm → 0 mm, 2199 mm now over the photo; copy on a new default operation. Unmoved original + re-traced copy stack exactly (two operations, no stacked-copy advisory: preflight codes `[]`). Part of P1-1/P1-2 |
| Group, draw order | t24a case 2 | Group membership and `objects` order kept exactly |
| Node edits on the trace | t24a case 2 (one polyline removed: 13 → 12) | Re-trace restores 13: edits discarded, as a re-trace must; no warning (P3-1) |
| Source edited in Image Studio | t24a case 4 (`applyEditedImage`) | Re-trace opens the live, edited object (F-L3 intends this) |
| Source moved, trace not | t24a case 4 | Trace follows the source transform (ADR-026) |
| Source deleted | t24a case 4 | Command disabled; action toast "Original raster for art.png is missing…", nothing opened |
| Undo / Redo | t24a case 1 | One undo entry; Undo restores the identical project (`===` and JSON-equal); Redo re-applies |
| Save / reopen | t24a case 5, existing suite | Record restored, id stable; operation still reset (P1-2) |
| LightBurn reference | READ (ADR-408 Context, citing the tracer-gap brief) | LightBurn's Trace Image cannot re-trace a committed trace; no outside behaviour to copy. Not re-verified on the web this session |

## Findings
### T24-P1-1: Re-trace throws away where the user put the trace and snaps it back over the source image
- Severity: P1 — burn in the wrong place and at the wrong size. A trace moved onto the workpiece and scaled to fit burns back at the photo's position and size; a moved copy (two coasters) leaves its blank unburned and burns over the photo. The success toast reads like a fresh trace and says nothing about the move.
- Where: `src/ui/trace/ImportImageDialog.tsx:378-391,410` (new object with `IDENTITY_TRANSFORM`, placement taken only from the source); `src/ui/state/scene-mutations.ts:287-288,306` (`positionTraceOverRasterSource` then `replaceObject`, the old trace's transform never read).
- Repro: `C:\Users\stolk\kd-t1\zz-t24\t24b.test.ts` (log `t24b.log`). Photo 40 × 30 mm at (20, 20); trace set to x 200, y 150, scale 0.05 (half size), rotation 90 → G-code burn box X 185.5–198.5, Y 151.1–169.3. After Re-trace Original with unchanged settings, burn box X 22–58.6, Y 23.1–49 (full size, over the photo). Two coasters: original at (100, 100), copy at (200, 100); after re-tracing the copy, blank 1 2199 mm, **blank 2 0 mm** (was 2199), over the photo 2199 mm. Toast: "Traced art.png — 1 color, source kept". Also `t24a.test.ts` case 1 with rotation 30 + mirror X.
- Oracle: the same codebase's in-place replacement contract, `applyReimport` (`scene-mutations.ts:344-351`): "keep id and transform so the user's chosen position/scale/rotation survives". ADR-408 calls Re-trace "replaces the selected trace in place". WORKFLOW F-L3 only promises registration while the trace still sits on its source.
- Suggested fix: carry the user's offset: new transform = old trace transform ∘ (old placement over the source)⁻¹ ∘ new placement, so an unmoved trace stays registered and a moved one stays where the user put it. Alternatively ask "Keep the trace's position / Place over the picture" when they differ.

### T24-P1-2: Re-trace replaces the trace's operation with a new default one and drops per-object settings, so the job burns with different power, speed and passes
- Severity: P1 — wrong burn. Tuned power/speed/passes, per-operation overrides (power, hatch, tabs) and the power scale are lost without a warning. Only the Cuts panel shows it, as a new operation ("art 2", new colour).
- Where: `src/ui/state/scene-mutations.ts:295-311` (`createArtworkOperations` on the replacement, then `pruneOrphanLayers` deletes the old operation); `src/core/scene/artwork-operation.ts:54,183-201` (old id taken → `operation-<id>-2`); `ImportImageDialog.tsx:378-391` (no `name`, `powerScale`, `operationOverride`, `operationIds` carried). Test `trace-retrace-order.test.ts:89-91` asserts the prune only for a raster→vector kind change.
- Repro: `zz-t24/t24b.test.ts` case 1: operation "art" set to power 80, speed 600, passes 2 (G-code max S 800, 1240 burn moves). After Re-trace: "art 2" power 30, speed 1500, passes 1, max S 300, 610 burn moves. `t24a.test.ts` case 1: power 77/2222/3 → 30/1500/1, powerScale 40 → none, name "Coaster logo" → none; case 2: override `{byOperation: {…: {power 12, hatchSpacingMm 0.3}}}` → none. A copy that shared the original's operation moves to its own default operation (case 3).
- Oracle: `applyReimport` keeps operation bindings by colour (`inheritPathOperationIds`, `scene-mutations.ts:352-357`; ADR-358); ADR-408 frames Re-trace as an in-place replacement that changes "no … output path".
- Suggested fix: rebind the new paths to the old trace's operation ids (by colour, as `inheritPathOperationIds` does; fall back to a new operation only for colours the old trace lacked) and carry `name`, `powerScale` and per-operation overrides. If the mode must change (for example Line Art → Centerline), say so in the toast.

### T24-P3-1: Nothing tells the user that Re-trace replaces the selected trace or what it discards
- Severity: P3 — wording. The dialog has no retrace mode text, and the toast is the fresh-trace one ("Traced art.png — 1 color, source kept"). Node edits (13 → 12 polylines restored to 13 in t24a case 2), the name, and with the P1s unfixed the placement and operation, go without a word. Undo restores them exactly.
- Where: `ImportImageDialog.tsx` (no `replaceTraceId`-dependent copy); `trace-output-commit.ts:191-211`.
- Suggested fix: dialog subtitle "Replaces <name>; node edits to it are discarded" and a "Re-traced <name>" toast.

### T24-P3-2: Test gap — no test re-traces a trace that was moved, tuned or overridden
- Severity: P3 — test gap behind P1-1/P1-2.
- Where: `ImportImageDialog.retrace-settings.test.tsx`, `trace-retrace-order.test.ts`, `rasterized-trace-mutation.test.ts` all use `IDENTITY_TRANSFORM` traces with untouched operations.
- Suggested fix: adopt `zz-t24/t24b.test.ts` (moved + tuned trace, two-coaster copy) as the G-code-level regression once the fix lands.

## Not a defect / limits
- **Source edited in Image Studio:** Re-trace uses the current, edited picture, not the as-imported original. This is what WORKFLOW F-L3 intends; the command name "Original" means the kept raster, not the unedited one.
- **Source moved, trace untouched:** the trace follows the source (ADR-026, trace-commit-ownership allows transform-only source changes). By design.
- **Locked trace:** a direct store call re-traces a locked trace and returns it unlocked, but Lock Selection clears the selection and locked artwork cannot be selected (WORKFLOW "Edge — locked object"). So the command is not reachable on a locked trace in the UI. Not raised.
- **Node edits lost:** a re-trace regenerates geometry from pixels, so this is inherent; only the missing notice is raised (P3-1).
- **Group membership and draw order** survive (replace in place). **Undo/Redo** exact.
- **LightBurn:** per ADR-408 it has no re-trace of a committed trace, so there is no outside behaviour to compare. Not re-verified this session.
- Not checked: Raster scan output re-trace end to end (jsdom canvas stub; rasterized results keep the source's Image operation via `rasterized-trace-mutation.ts`, read only); CNC re-trace; the dialog in a browser and keyboard use (memory gate, no browser run); the long repeated-save soak from the October row.

## Totals
Raised 4; P1 2; P2 0; P3 2; known 0 (no earlier ledger lists Re-trace placement or operation loss; T12 refuter noted only that re-trace replaces sheared paths, by design).
