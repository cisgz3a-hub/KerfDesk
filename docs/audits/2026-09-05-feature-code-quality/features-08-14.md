# Feature code quality audit: areas 08–14

Source: clean archive `C:\Users\Asus\.codex\audits\kerfdesk-features-20260905-ccaa3064`, commit `ccaa3064d9efe904821307f0603ce842d903b586`, matching the live build identified by the parent audit. Source references below use that archive's line numbers, not the older dirty checkout. Feature numbering follows the website feature inventory dated 2026-09-05.

This is an implementation and existing-test review, followed by authorized isolated reproductions. No application source was changed. No browser, provider, account, deployment, controller or hardware actions were performed in this lane. Existing tests were read for guards and counterevidence; the only suite executed was the audit fixture described below.

## Evidence and priorities

The audit fixture ran with `pnpm exec vitest run src/__fixtures__/audit-feature08-14.test.tsx --reporter=verbose`: **17 observed-defect assertions passed**, exit 0, final duration 10.09 s. A passing assertion confirms the undesirable behavior named by that test; it does **not** mean the feature passed acceptance. The first draft had an incorrect fixture import, corrected without changing production code. The archive has no `.git`, so Vite's build-identity probes printed three `not a git repository` messages; test collection and execution completed.

- [Audit fixture copy](C:/Users/Asus/LaserForge-2.0/docs/audits/2026-09-05-feature-code-quality/features-08-14-audit-test.tsx)
- [Final raw test output](C:/Users/Asus/LaserForge-2.0/docs/audits/2026-09-05-feature-code-quality/features-08-14-test-output.txt)

DOM probes rendered production controls in jsdom and inspected constraint validity or dispatched keyboard events. Raster probes used tiny synthetic buffers; the asynchronous encoder test controlled the canvas callback and inspected the actual function's copied PNG input versus its luma output. Image lifecycle tests mock PNG encoding, while exercising real editor/store transitions. Paged-source probes use the real image mutation and hydration functions with an in-memory repository reader. These prove code behavior, not visual fidelity, throughput at production image sizes, or physical output qualification.

Suggested repair order:

| Priority | ID | Concrete defect |
| --- | --- | --- |
| P1 | F12-03 | Image Studio retains the original paged asset after replacing pixels; output hydration uses the old image |
| P1 | F14-01 | Rectangle chamfer drops its carve-layer assignment |
| P2 | F11-01 | Crop Image substitutes white for paged-only image pixels and retains incompatible asset dimensions |
| P2 | F12-04 | Asynchronous image bake can mix PNG and luma from different revisions |
| P2 | F09-01 | Material wizard resets settings that are absent from the current step |
| P2 | F12-01 | Undo/Redo after Apply does not mark image edits dirty |
| P2 | F13-01 | Enter on adjustment Cancel/Reset commits the adjustment |
| P2 | F13-02 | Single-layer adjustment preview ignores opacity/visibility/blend |
| P2 | F14-02 | Deleting the last applied Design Studio entity cannot update project output |
| P2 | F14-03 | Restored unapplied drawing is marked clean and cannot Apply |
| P2 | F08-01 | Reciprocal density fields create a native step mismatch and block OK |
| P2 | F08-02 | Grayscale minimum-power input uses the old maximum power |
| P2 | F09-02 | Material recipe air assist cannot be turned off |
| P2 | F12-02 | Eraser ignores the chosen background color |

F11-01 and F12-03 share a representation boundary but are distinct reachable mutation sites: fixing Image Studio Apply alone will not hydrate Crop Image's missing source pixels. F09-01 and F09-02 can be repaired together through a step-aware form reader. F12-01 affects adjustments too and is counted under Image Studio only.

## 08. Laser cutting and engraving settings

**Verdict: sound state/compile separation; numeric form interaction needs correction.**

The advanced dialog stages a patch until OK and uses the project store's undo transition. `readCutSettingsPatch` bounds power, speed, passes, density, kerf and tabs, and clamps grayscale minimum against the submitted maximum. The body is keyed to stored settings so Reset to Default reseeds uncontrolled inputs. Fill and image density share clear conversions. Existing cut-settings tests exercise commit/cancel, feed limits, mode-specific options and default resets. The numerical core is better protected than the native form's cross-field constraints.

Inspected: `src/ui/layers/{CutSettingsDialog,CutSettingsCommonFields,CutSettingsFillFields,CutSettingsFillDensityFields,CutSettingsImageFields,CutSettingsDefaultActions,LayerRowCutSettings,LayerRowFields}.tsx`, `cut-settings-draft.ts`, `use-cut-settings-launcher.ts`; store layer/default actions; `src/core/job/{compile-job-raster,vector-group-fields}.ts`; shared `Dialog.tsx`; `CutsLayersPanel.cut-settings.test.tsx` and related density/default test cases.

**F08-01 — P2, confirmed and reproduced: valid density choices make OK unsubmitable.**

- Source: [CutSettingsFillDensityFields.tsx:19](https://github.com/cisgz3a-hub/KerfDesk/blob/ccaa3064d9efe904821307f0603ce842d903b586/src/ui/layers/CutSettingsFillDensityFields.tsx#L19), image counterpart `CutSettingsImageFields.tsx:104`; form `CutSettingsDialog.tsx:33`.
- Trigger: enter 300 Lines/Inch in Fill or 300 DPI in Image. The synchronized interval becomes `0.0847` mm, displayed to four decimals, while its number input requires `step=0.001`. It has `validity.stepMismatch=true`; real OK `.click()` never invokes onApply in both rendered cases.
- Countercheck: core conversion accepts that density, but it cannot run because native validation precedes submit. The form has no `noValidate`; changing only the reader cannot fix this.
- Scoped fix: make the displayed reciprocal interval and its declared step compatible, or use `step="any"` with explicit bounded validation. Preserve requested physical density rather than silently rounding it to a different density.
- Acceptance: enter 300 plus non-round reciprocal values through each of the two density controls, submit by click and Enter, and assert the intended saved density and no invalid sibling fields.

**F08-02 — P2, confirmed and reproduced: grayscale minimum power is limited by stale layer power.**

- Source: [CutSettingsImageFields.tsx:44](https://github.com/cisgz3a-hub/KerfDesk/blob/ccaa3064d9efe904821307f0603ce842d903b586/src/ui/layers/CutSettingsImageFields.tsx#L44).
- Trigger: layer Power 20%, open advanced Image/Grayscale, change Power to 80%, then Min Power to 50%. Min Power still has `max=20`; it becomes `rangeOverflow`, and OK cannot apply the otherwise valid 50–80 pair.
- Countercheck: the reader correctly clamps against draft Power. The power field is uncontrolled and no draft maximum is passed to the image fields, so that core guard does not correct the native input constraint.
- Scoped fix: carry draft power to the minimum-power input and reconcile the minimum when the maximum is reduced.
- Acceptance: rendered cases increasing and reducing maximum power, including valid intermediate minimum values, persist a consistent pair through native submit.

## 09. Material recipes and saved libraries

**Verdict: explicit linking and persistence are useful; existing-recipe editing is not lossless.**

Library apply/link/refresh operations validate target and recipe existence, preserve provenance and revision bindings, and use project undo for layer changes. The UI distinguishes unavailable libraries from changed revisions and disables refresh when the binding belongs to another library. The collection persistence path reconciles active-library edits into saved libraries; storage errors are surfaced. Import/export has cancellation/error handling. The major defect is reusing a whole-layer FormData reader for a wizard that renders only one step at a time.

Inspected: `src/ui/material-library/MaterialLibraryPanel.tsx`, `SavedLibrariesDialog.tsx`, `SavedLibraryRow.tsx`, `material-binding-status.ts`, persistence/collection helpers, all wizard step/recipe/reducer implementations; `src/ui/state/{material-library-actions,material-preset-actions,saved-libraries-actions}.ts`; material-library file actions; `src/core/material-library/material-library.ts`. Existing wizard component/reducer, saved-library persistence, binding and file-action tests were inspected. Existing wizard tests principally cover new presets and identity validation, not edit-roundtrip retention across all modes.

**F09-01 — P2, confirmed and reproduced: Next silently resets details not rendered on that step.**

- Source: [wizard-recipe.ts:36](https://github.com/cisgz3a-hub/KerfDesk/blob/ccaa3064d9efe904821307f0603ce842d903b586/src/ui/material-library/wizard/wizard-recipe.ts#L36); invoked at `MaterialPresetWizard.tsx:55–60`; boolean/style reads at `cut-settings-draft.ts:79–81,100–103,125–131`.
- Trigger: edit an existing preset and advance through unchanged Cut Settings. That step has only mode/power/speed/passes/air. Line presets lose enabled tabs and skip-inner flags; Fill presets lose FollowShape/offset style and bidirectional/crosshatch flags; Image presets lose negative, bidirectional and pass-through flags. They are already reset when the Details step opens and can be saved that way.
- Countercheck: numeric fields have fallbacks, but the relevant booleans use `data.has`, and fill style falls back to an empty string which parses to scanline. Recipe capture intentionally excludes visible/output, so those unrelated layer-only fields were not counted as recipe defects.
- Scoped fix: have each step patch only the fields it owns, distinguishing an unchecked present control from a control absent on this step.
- Acceptance: no-op edit-and-save roundtrip of nondefault Line, Fill and Image presets must preserve every owned recipe setting; changing one control must not change unrelated details.

**F09-02 — P2, confirmed and reproduced: recipe air assist cannot be cleared.**

- Source: [cut-settings-draft.ts:45](https://github.com/cisgz3a-hub/KerfDesk/blob/ccaa3064d9efe904821307f0603ce842d903b586/src/ui/layers/cut-settings-draft.ts#L45); reachable checkbox `WizardCutSettingsStep.tsx:46`.
- Trigger: edit a preset with air assist true, uncheck Recipe Air, then Next/Save. An unchecked checkbox is absent from FormData, and the reader falls back to the old `true` value.
- Scoped fix: in the settings-step patch, write the current checkbox state explicitly. Keep absence fallback for callers that do not expose air assist.
- Acceptance: true→false survives the remaining wizard steps, Save/reopen and application to a layer; false→true and untouched absent fields also work.

An export completion racing a later library edit was considered but not promoted: the inspected dirty flag is not a demonstrated data-loss boundary, and collection autosave separately preserves the current library. No provider-dependent material recommendations were assessed.

## 10. Design Library

**Verdict: no confirmed defect in the inspected shipped insertion route.**

Search/filter/selection state is separated from imported artwork. Library content goes through SVG parsing, retains provenance, receives fresh insertion identities, and uses ordinary import/undo allocation. Async insertion combines the project-document owner with the exact open-dialog request; close/reopen or a replacement project prevents an obsolete load from inserting or closing a newer dialog. Busy state prevents duplicate concurrent additions, and errors remain visible. Dialog focus/escape handling and the separately actionable Add control have meaningful existing tests.

Inspected: `src/ui/library/{DesignLibraryDialog,DesignLibraryControls,DesignLibraryGrid,DesignLibraryDetails,LibraryPreview}.tsx`, `design-library-filter.ts`, `library-entry-insert.ts`, `library-entry-provenance.ts`, `library-round-stroke.ts`; ordinary `object-insert-actions.ts`/scene import mutation. Tests inspected: `DesignLibraryDialog.test.tsx`, `library-entry-insert.test.ts`, `library-insertion-identity.test.ts`, and provenance/stroke cases. The two explicit deferred insertion tests reject both replacement documents and retired dialog requests.

No new audit test was added merely to restate this implementation. Library artwork geometry was not exhaustively visually inspected; remote source links, every catalog item and downstream machine behavior were not exercised. “No confirmed defect” is limited to the inspected route, not a complete catalog qualification.

## 11. Tracing and bitmap preparation

**Verdict: trace ownership is careful; Crop Image misses the paged-image representation.**

Trace commit captures dialog request, document epoch and exact source ownership. Late success/failure cannot modify or close a new request; rasterized trace checks operation inputs again after async bitmap work. CNC fairing uses committed placement, and rasterized output preserves its Image operation rather than copying unrelated defaults. Mask application/removal uses project undo, and asynchronous crop checks both image and mask identity before publishing. Existing tests cover reopened trace requests, changed documents/sources, deferred crop ownership, trace registration, raster operation routing and mask geometry.

Inspected: `src/ui/trace/ImportImageDialog.tsx`, preview/worker client paths, `trace-commit-ownership.ts`, `trace-output-commit.ts`; `src/ui/commands/{image-command-actions,multi-file-trace-action}.ts`; `src/ui/state/{image-mask-actions,import-actions,rasterized-trace-mutation}.ts`; `src/ui/raster/{crop-image,AdjustImageDialog}.tsx/.ts` and preview/draft helpers; source resolution/hydration. Tests inspected include `ImportImageDialog.ownership-workflow.test.tsx`, `trace-commit-ownership.test.ts`, trace workflow/raster-output cases, `image-command-actions.test.ts`, `crop-image.test.ts`, and mask/state tests.

**F11-01 — P2, confirmed and reproduced: mask crop of a paged-only raster loses source pixels.**

- Source: [crop-image.ts:41](https://github.com/cisgz3a-hub/KerfDesk/blob/ccaa3064d9efe904821307f0603ce842d903b586/src/ui/raster/crop-image.ts#L41), fallback `crop-image.ts:121–128`, result spread at `:49–57`; direct caller `image-command-actions.ts:94`.
- Trigger: import a PNG that uses the qualified paged path (>25 MiB), apply a closed image mask, then Crop Image. This import intentionally supplies `imageAsset` without embedded `lumaBase64`. The crop function never hydrates it; missing luma becomes an all-white buffer. It also retains the original imageAsset after shrinking pixel dimensions.
- Evidence: an 8×8 paged-only raster cropped to 4×8 produced 32 white luma bytes and retained `sampledWidth=8`. No repository source read occurs in this route. The changed dimensions subsequently conflict with hydration/project validation. The image/mask ownership checks protect the destination but not the pixels being cropped.
- Scoped fix: hydrate the source under the existing request owner before cropping, and atomically replace or retire its old paged representation. Do not treat absent required pixels as white success.
- Acceptance: a paged non-white image with a partly overlapping mask produces the same pixels/bounds as an embedded equivalent; save/reopen, trace and output preparation consume those pixels; undo restores the source and asset references.

Trace algorithm fidelity across photographs, backend fallbacks, worker timeout behavior at large scale and actual multi-file save dialogs remain unverified at runtime.

## 12. Image Studio

**Verdict: strong request ownership and local undo architecture; output consistency has important gaps.**

Open/decode/Apply requests own the document epoch and exact source image. Stashed sessions cannot be reused in replacement documents. Late requests are retired; Apply reconciles the owner while preserving edits made after the requested revision. Session history is scoped to layers, crop/resize updates physical bounds, and the project receives one undo entry. Selection masks clamp paint, fill and adjustments. Text/resize dialogs have their own owners and existing deferred/keyboard tests. These strengths do not repair missing dirty state, conflicting raster representations or a mutable encoder input.

Inspected: `ImageEditorHost.tsx`, `ImageEditorOverlay.tsx`, `ImageEditorTopBar.tsx`, `EditorToolStrip.tsx`, `EditorCanvas.tsx`, `LayersPanel.tsx`, editor store/lifecycle/ownership/decode, session/crop/resize/layer/transform/fill/retouch bridges, pointer/drag/shortcut paths, adjustment/resize/text dialog stores; `src/ui/state/image-edit-actions.ts`; paged-source/import/hydration consumers. Existing session/store/lifecycle, layer, resize, text, Apply-and-Trace, pointer, and `ImageStudioAccessibility.test.tsx` cases were inspected. No full production-size paint benchmark was performed.

**F12-03 — P1, confirmed and reproduced: Apply leaves old paged assets authoritative.**

- Source: [image-edit-actions.ts:43](https://github.com/cisgz3a-hub/KerfDesk/blob/ccaa3064d9efe904821307f0603ce842d903b586/src/ui/state/image-edit-actions.ts#L43); `paged-raster-hydration.ts:62–100`; output caller `save-gcode-emission.ts:107`.
- Trigger: import a paged PNG, edit in Image Studio, Apply. The mutation spreads the old image including `imageAsset` and writes new embedded dataUrl/luma. Preparation hydrates by the old imageAsset, replacing the new luma and display bytes with old pages/thumbnail. Trace/source reopen likewise prioritizes the old source asset. If the edit resized/cropped, hydration rejects the mismatch between the new dimensions and old manifest.
- Evidence: the real mutation retained the exact old manifest; real hydration replaced an all-white edited luma with the original all-black pages. A 4×8 resized result retaining an 8×8 manifest failed with `expects 32 luma bytes but references 64`. Existing image-edit tests use embedded-only inputs, while hydration tests separately prove original paged behavior; neither tests the crossing.
- Scoped fix: Apply must commit one authoritative representation: either new paged assets or embedded fields with the obsolete imageAsset removed, preserving old references in project undo and asset lifecycle ownership.
- Acceptance: edit/crop/resize a paged source, Apply, save/reopen, reopen Image Studio, trace and prepare/export output. All consumers must use the edited pixels/dimensions; undo restores the original asset without deleting an asset still referenced by undo.

**F12-04 — P2, confirmed and reproduced: PNG and luma can contain different image revisions.**

- Source: [image-editor-decode.ts:31](https://github.com/cisgz3a-hub/KerfDesk/blob/ccaa3064d9efe904821307f0603ce842d903b586/src/ui/image-editor/image-editor-decode.ts#L31), late luma read at `:41`; `compositeSession` returns the mutable active buffer on the single-layer fast path.
- Trigger: Apply a normal single-layer edit, then paint/Undo while PNG encoding awaits. `putImageData` copies the earlier pixels; after two awaits, `extractLumaBase64` reads the now-mutated `doc.data`. Paint/undo actions are still reachable while Applying.
- Evidence: the real encoder copied a white pixel into PNG input, then a controlled late mutation made emitted luma black (`AA==`). Request ownership does not freeze a mutable pixel buffer. The implementation correctly leaves later edits dirty, but that does not make the first emitted pair internally consistent.
- Scoped fix: freeze one revision for both encodings, e.g. copy/derive luma synchronously alongside the PNG snapshot before awaiting.
- Acceptance: hold the encoder callback, mutate the editor, release it, and compare PNG-decoded pixels against emitted luma. Both must represent the same requested revision while the subsequent edit remains dirty.

**F12-01 — P2, confirmed and reproduced: Undo/Redo after Apply is not applyable.**

- Source: [editor-session.ts:370](https://github.com/cisgz3a-hub/KerfDesk/blob/ccaa3064d9efe904821307f0603ce842d903b586/src/ui/image-editor/editor-session.ts#L370), redo at `:381`; `ImageEditorTopBar.tsx:59`; lifecycle early return `image-editor-lifecycle.ts:169`.
- Trigger: paint → Apply → Undo. Pixels change but `dirtySinceApply` stays false. Apply is disabled; the action itself skips a new bake. Apply & Trace can therefore use the earlier project image. `undoScoped`/`redoScoped` do not repair the flag.
- Scoped fix: mark an applied undo/redo transition dirty, or compare against a stored applied revision. Leave no-op undo clean.
- Acceptance: Apply → Undo → Apply and Apply → Undo → Apply → Redo → Apply both publish the visible pixels; no-op history actions do not create unnecessary project writes.

**F12-02 — P2, confirmed and reproduced: eraser ignores background color.**

- Source: [editor-session.ts:293](https://github.com/cisgz3a-hub/KerfDesk/blob/ccaa3064d9efe904821307f0603ce842d903b586/src/ui/image-editor/editor-session.ts#L293); store passes the selected background at `image-editor-store.ts:243`; tool/color descriptions promise it at `EditorToolStrip.tsx:22,102`.
- Trigger: choose a non-white background and erase. The store passes that color, but `commitStroke` replaces it with WHITE. A selected RGB(17,34,51) erased to RGB(255,255,255).
- Countercheck: `editor-session.test.ts:66` explicitly locks in the older white-only behavior. That is conflicting product evidence, not coverage that vindicates the current UI contract.
- Scoped fix: use the caller-selected eraser color consistently and update the obsolete test contract.
- Acceptance: changing/swapping background changes eraser pixels; brush still uses foreground; undo restores the erased pixels, including selection-clamped strokes.

## 13. Image adjustments and filters

**Verdict: bounded pixel operations and undo are clear; preview and keyboard contracts diverge from commit.**

The catalog has explicit parameter ranges and total dispatch for the shipped adjustment/filter IDs. LUT operations and kernels apply selection masks with alpha weighting, and blur reads surrounding pixels while limiting writes to the selected region. Preview clones pixels and commit records one scoped history entry. Existing LUT, level, blur, curve and adjustment/session/store tests cover calculations and non-destructive previews. UI controls bound numeric input. The following failures occur at composition and input-event boundaries, not in the tested basic filter math.

Inspected: `src/ui/image-editor/{editor-adjustments,editor-adjust-session,adjust-dialog-store}.ts`, `AdjustDialog.tsx`, `EditorAdjustMenus.tsx`, `EditorCanvas.tsx` preview consumption, LayersPanel opacity path; `src/core/image-adjust/{lut,levels,gaussian-blur}.ts` and related catalog runners. Existing `editor-adjust-session.test.ts`, `editor-adjustments.test.ts`, `adjust-dialog-store.test.ts`, relevant core filter tests and accessibility/keyboard tests were read.

**F13-01 — P2, confirmed and reproduced: Enter on Cancel commits.**

- Source: [AdjustDialog.tsx:48](https://github.com/cisgz3a-hub/KerfDesk/blob/ccaa3064d9efe904821307f0603ce842d903b586/src/ui/image-editor/AdjustDialog.tsx#L48).
- Trigger: adjust a parameter, focus Cancel, press Enter. The button's keydown bubbles to the panel, whose unconditional Enter handler calls commit before native button activation. Reset has the same problem. The rendered Cancel probe changed pixels and added history.
- Countercheck: the outer editor shortcut handler respects native activation targets, but the inner panel intercepts first and stops propagation. Existing Resize/Text tests protect native button semantics; the adjustment panel does not use that guard.
- Scoped fix: preserve Enter activation for buttons/links and reserve submit behavior for appropriate panel/input targets; use the existing keyboard-target helper or a form with explicit submit semantics.
- Acceptance: Enter and Space on Cancel discard, Reset resets without commit, OK commits once, and an intended Enter shortcut from a numeric field still works.

**F13-02 — P2, confirmed and reproduced: one-layer preview bypasses composition.**

- Source: [editor-adjust-session.ts:67](https://github.com/cisgz3a-hub/KerfDesk/blob/ccaa3064d9efe904821307f0603ce842d903b586/src/ui/image-editor/editor-adjust-session.ts#L67).
- Trigger: use Layers to reduce the sole layer's opacity, then preview an adjustment. The function returns the adjusted raw clone solely because layer count is one, ignoring visibility/opacity/blend. Commit and Apply use `compositeSession`, which considers those properties. The 50%-opacity case previewed black but committed composite was gray.
- Scoped fix: use the same compositor after substituting the adjusted buffer; retain a fast path only under the same full-opacity, visible, normal-layer conditions.
- Acceptance: preview equals post-OK composite for one and multiple layers, including hidden, partial-opacity and non-normal blending, with and without selections.

Not promoted: switching active layers while an adjustment is open may expose additional stale-preview behavior because the preview effect does not depend on session revisions. This was not reproduced in the final fixture and should not be counted as a confirmed finding. Filter throughput, perceptual quality and screen-reader announcements were not tested end to end.

## 14. Design Studio

**Verdict: useful geometry/state boundaries; metadata and apply lifecycle need correction.**

Only implemented rail tools are reachable: Select, Line, Polyline, Rectangle, Circle, Arc, Fillet and Chamfer. Planned tools are filtered from rails and shortcuts. Typed geometry passes finite/degenerate-value checks; resize derives each frame from the pre-gesture geometry; move/resize commit a single history step. Selection and active layer are reconciled after undo. Apply replaces previously owned artwork and reuses operations, preserving settings the main workspace owns. CNC cutter controls reflect Startup Setup rather than silently creating a second tool authority. Persistence keeps the sketch and apply record, and the overlay uses modal focus/key isolation.

Inspected: DesignStudio host/overlay/top bar/tool catalog/rails, pointer/point-sequence/draft/corner/resize/entity-edit/session/history/layer/store/persistence modules, layer settings and 3D carve/simulate sources; `src/ui/state/{design-apply-mutation,design-apply-record,object-insert-actions}.ts`; core design layer/geometry adapters. Existing entity-edit, point-sequence, corner, resize, history/session/storage/store, shortcut, layer-settings and reapply tests were inspected. Current tests check repeat Apply and persistence independently but miss the transitions below.

**F14-01 — P1, confirmed and reproduced: rectangle chamfer changes carve-layer routing.**

- Source: [design-corner-apply.ts:96](https://github.com/cisgz3a-hub/KerfDesk/blob/ccaa3064d9efe904821307f0603ce842d903b586/src/ui/design-studio/design-corner-apply.ts#L96); fallback `src/core/design/layers/layer-edit.ts:32–38`.
- Trigger: draw/assign a sharp rectangle on a nondefault layer with a different depth/cut type, then Chamfer. Rectangle-to-path conversion preserves id and construction but omits layerId. The resulting path is routed to the first design layer for preview and Apply, changing its operation settings.
- Evidence: a rectangle on custom `deep` layer became a path with undefined layerId, and `entityDesignLayer` resolved the default layer. Existing corner tests use unassigned rectangles; path operations retain metadata and do not repair the missing field from this conversion.
- Scoped fix: preserve geometry-independent entity metadata when converting a rectangle to a path.
- Acceptance: chamfer on a nondefault layer preserves layer id, construction and identity; 3D preview and Apply retain cut type/depth/tool routing; undo restores the parametric rectangle on the same layer.

**F14-02 — P2, confirmed and reproduced: empty reapply leaves deleted artwork in the project.**

- Source: [use-design-apply.ts:34](https://github.com/cisgz3a-hub/KerfDesk/blob/ccaa3064d9efe904821307f0603ce842d903b586/src/ui/design-studio/use-design-apply.ts#L34), button gating at `:53`; mutation early return `design-apply-mutation.ts:70`.
- Trigger: Apply a drawing, delete its final output entity (or make all remaining entities construction), then attempt Apply. Both Apply controls are disabled; the mutation also returns before removing the previous apply's objects. Old cuttable artwork remains despite the now-empty Studio drawing.
- Countercheck: no-op on an initially empty sketch is intentional and tested. This defect requires an existing apply record; that makes clearing previous output a real edit.
- Scoped fix: permit an empty replacement when the session owns surviving previously applied artwork, remove only that artwork/now-empty owned operations, and return an empty apply record in one undoable transition.
- Acceptance: deleting final/all output clears only this Studio's earlier output; unrelated objects/operations remain; project undo restores it; a never-applied empty drawing remains a no-op.

**F14-03 — P2, confirmed and reproduced: restored unapplied work is marked clean.**

- Source: [design-session.ts:145](https://github.com/cisgz3a-hub/KerfDesk/blob/ccaa3064d9efe904821307f0603ce842d903b586/src/ui/design-studio/design-session.ts#L145); persisted type `design-session-storage.ts:32`; apply eligibility `use-design-apply.ts:53`.
- Trigger: create or edit a drawing without applying it, allow it to persist, reload and reopen Design Studio. Restore calls `createDesignSession` and never restores pending-apply state, so the visible drawing has `dirtySinceApply=false`; Apply is disabled until a new edit is made.
- Countercheck: geometry is retained; this is lost pending state, not wholesale drawing deletion. Existing storage tests assert clean restoration for a previously applied drawing but do not distinguish never-applied or subsequently edited work.
- Scoped fix: persist pending-apply state or derive it from a durable applied-sketch identity, with backward compatibility for existing saved sessions.
- Acceptance: never-applied and edited-since-apply drawings survive reload with Apply available; truly unchanged applied drawings restore clean; applying after reload updates previous artwork without duplication.

3D/WebGL rendering, simulation material/tool changes during an in-flight run, real pointer-device cancellation and geometric accuracy across the full range of dimensions remain runtime qualification gaps. No new defect was inferred merely from those untested scenarios.

## Integration notes

Every finding above has a reachable source chain plus an observed-defect reproduction. The fixture verifies small deterministic cases only; it is intentionally not added to the production suite and should not be merged as passing product tests. Repair acceptance tests should invert the undesirable invariants and use appropriate end-to-end coverage for output pixels and form behavior.

The most useful shared refactors are narrowly motivated by the defects: one owned step-to-recipe mapping, one authoritative raster representation transition, one immutable Apply pixel snapshot, and metadata-preserving geometry conversions. Broad style rewrites, unrelated test expansion and speculative performance changes are not recommended by this audit.
