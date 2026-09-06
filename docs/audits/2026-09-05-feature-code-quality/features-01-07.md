# Feature code-quality audit: 1–7

Source: `ccaa3064d9efe904821307f0603ce842d903b586`, matching the website build recorded in the feature inventory and remote `main` at audit start. Source paths below refer to `C:\Users\Asus\.codex\audits\kerfdesk-features-20260905-ccaa3064`. The user's working checkout was not switched or repaired.

This review follows each feature from command/dialog through state mutation and its relevant consumer. It evaluates correctness, state ownership, data preservation, maintainability, responsiveness and meaningful test coverage. It cannot prove an implementation is the best possible. Six new regression probes demonstrate defects on the unchanged source; 144 existing tests in 21 focused suites pass. New probes express the desired invariant, so their six failures are intentional reproduction evidence, not changes to the production suite.

## 1. Projects, artwork import and output

**Assessment: strong ownership and transactional design in the inspected paths. No new confirmed defect.**

The unified dispatcher preserves mixed-file order and captures document ownership before the file picker. Late conversions cannot insert into a replacement document; cancellation and partial failures remain distinct. SVG parsing has a worker path, owned cancellation and a disclosed fallback. Re-import checks the selected source and extension, then requires both the same document and target object before replacement. Project opening has separate request and document identities.

Save captures a version of the project, serializes/validates before writing, and separately determines whether the completion still belongs to the current document and save request. A successful write of an older version does not clear newer edits. The write coordinator reconciles overlapping writes to the same destination so a late old write cannot silently become the final saved content. Autosave separates durable recovery storage, execution-time suppression, and recovery ownership. Recovery storage is not cleared before a replacement has been safely retained. Notes are undoable and no-op updates retain the current state.

Inspected chains include `ui/app/import-dispatch.ts`, `svg-import-action.ts`, `import-image-action.ts`, `reimport-selected-artwork.ts`, `open-project-command.ts`, `project-open-request-owner.ts`, `project-save-action.ts`, `project-save-completion.ts`, `state/project-save-write-coordinator.ts`, `app/file-actions.ts`, `use-autosave.ts`, and `state/project-notes-actions.ts`. Height-map/relief, paged-image editing and downstream output issues are covered under features 11, 12, 22 and 24, rather than counted again here.

Existing tests run: `import-dispatch.test.ts`, `file-actions-save-concurrency.test.ts`, `file-actions-save-version.test.ts`, `file-actions-save-owner-lifecycle.test.ts`. These verify concrete file ordering and stale/concurrent completion behavior. Browser/native save dialogs, all format round-trips, disk-failure recovery, the full STL/DXF decoder, and physical output were not exhaustively requalified. The save coordinator's complexity is justified by its write-order contract; shared owner helpers would be useful elsewhere, rather than a broad rewrite of this working subsystem.

## 2. Selection, editing and object management

**Assessment: generally well factored, with meaningful data-preservation tests. No separate confirmed defect in the inspected selection/clipboard/grouping paths.**

Commands gate selection-dependent operations. Mutation code also rejects stale transforms of locked or hidden-layer objects. Grouping computes transitive closure across overlapping groups rather than relying on only the first matching group. Copy/duplicate/arrays clone the required dependency closure and remap references and group identities; cross-document clipboard insertion treats operation identity differently from same-document paste. Mutations typically make one undo entry and clear redo together.

Numeric transforms use explicit result types. Non-finite values are rejected before mutation. World-axis nonuniform resize of rotated objects is intentionally rejected rather than inventing shear that the transform model cannot represent; the frame-aware helper supports local-axis resizing. That is a documented representational tradeoff, not a newly discovered bug. The flip defect belongs to feature 4. Editing text loses metadata as detailed in feature 6.

Inspected: `commands/edit-command-family.ts`, `state/scene-group-actions.ts`, `scene-clipboard-actions.ts`, `duplicate-scene-selection.ts`, `selection-transform-actions.ts`, `core/scene/selection-transform.ts`, `commands/NumericEditsBar.tsx`, and their immediate consumers. Existing suites run: scene clipboard, scene groups and selection-transform actions. Their tests exercise undo grouping, locked/hidden objects, copy independence, group membership and operation collisions; they do not prove all reference types survive every operation.

## 3. Drawing and measurement

**Assessment: good separation of gesture decisions from scene mutations. No new confirmed defect in the inspected paths.**

Rectangle/ellipse/polygon/star creation separates the live drag draft from the final UUID-bearing shape. Insignificant drags do not create accidental geometry; one final commit selects the new object, clears previous multiselection, records undo and returns to Select. Pen input separates start/append/close outcomes, ignores the second click of a double-click finishing gesture, and requires enough vertices for open/closed paths. Shift constraints use 45-degree geometry. Measurement is pure, with explicit millimetre deltas and normalized angles. Snapping ignores the moving selection and hidden targets, supports grid/object candidates, and offers temporary Ctrl/Cmd bypass.

Node joining validates two compatible endpoints, preserves/reverses curve controls as necessary, synchronizes editable shape geometry, and adjusts affected CNC tab anchors. These are better tests than merely checking whether a toolbar callback fired.

Inspected: `workspace/draw-tool.ts`, `pen-tool.ts`, `measure-tool.ts`, `snapping.ts`, `drag-snap.ts`, `state/draw-shape-mutation.ts`, `path-node-curve-join-plan.ts`, and `core/scene/curve-join.ts`. Existing suites run: draw-tool, pen-tool, measure-tool and path-node-curve-join-plan. Visual snapping at every zoom, device pixel ratio, touch input and all node modes were not browser-qualified. Pure coordinate tests and source inspection are the evidence here.

## 4. Alignment, repetition and nesting

**Assessment: solid undo/dependency structure, but two confirmed geometry/binding defects.**

Alignment and distribution use explicit references and make one undoable edit. Arrays retain dependent-source identities and remap clones. Nesting plans before mutation, requires the same project for insertion, treats locked artwork as obstacles, and keeps complete selected groups together. Outline nesting has explicit work accounting and discloses a bounding-box fallback. No performance guarantee is inferred for arbitrarily large scenes.

**F04-01 — P2, reproduced: horizontal/vertical flip is incorrect for rotated artwork.**

- Source: `src/core/scene/selection-transform.ts:368–390`; transform composition is scale → local mirror → rotation → translation in `core/scene/transform.ts`.
- Trigger: rotate an object 30 degrees, then Arrange → Flip Horizontal.
- Defect: `flipTransformAboutPoint` reflects the object's center in world coordinates but only toggles a local mirror bit. It leaves the rotation unchanged. Reflection in a world axis must also change the orientation; translating the center cannot repair the resulting vertex positions.
- Evidence: a 20 × 10 mm rectangle at `(30,20)` rotated 30 degrees should reflect its tested corner to X `42.320508…`; the implementation returns `47.320508…`. The world Y coordinate also changes incorrectly. Existing flip tests use unrotated artwork and therefore miss this.
- Fix: compose an actual reflection about the selection center into each transform, including rotation and existing mirrors. Preserve the exact world geometry and one undo action.
- Acceptance: every vertex of rotated asymmetric artwork and multiselections equals the mathematical horizontal/vertical reflection; cover existing mirrors, nonuniform scale and flip-twice identity.

**F04-02 — P2, reproduced: Break Apart drops explicit path-operation bindings.**

- Source: `src/ui/state/break-apart-actions.ts:105–111`.
- Trigger: import an SVG with two colors/operations, then Break Apart.
- Defect: `splitPaths` reconstructs each path with only color, stroke width and polyline. It drops `operationIds`, although fresh imports use path-specific operation IDs. The original object is replaced with the split objects.
- Evidence: the fixture starts with operations `operation-parts` and `operation-parts-2`. After splitting, both new parts resolve to **no operations** (`[[],[]]`). The artwork can consequently disappear from prepared output until reassigned. This is not just a missing display label.
- Fix: preserve applicable path metadata and explicitly remap object/dependency/group/run-order references when replacing a source with parts. Avoid restoring legacy color fallback as a substitute for explicit bindings.
- Acceptance: mixed-operation SVG parts retain their respective operation, settings and output membership; undo restores the original. Add tests for shared bindings, curves and groups rather than only part counts.

Inspected: `commands/arrange-command-family.ts`, `state/array-actions.ts`, `array-selection-copies.ts`, `nest-actions.ts`, `break-apart-actions.ts`, `core/nesting/quick-nest.ts`, `outline-compact-nest.ts`. Existing suites run: array-actions, nest-actions, quick-nest and outline-compact-nest, plus selection-transform actions.

## 5. Vector preparation

**Assessment: boolean/weld paths preserve considerably more output metadata than Dogbone. One confirmed defect.**

Weld partitions by effective operation and preserves settings/overrides in distinct operations instead of mixing incompatible output. It replaces artwork at its earliest relevant position, updates groups, and prunes only orphaned operations. N-ary intersection and XOR are folded correctly in the current core. Offsets retain source artwork and produce independent operation state. Contour closure measures transformed endpoint tolerance, checks the relevant fill operation, skips locked artwork, and synchronizes polyline shape closure. Conversion to bitmap uses explicit DPI/work estimates and one undoable source replacement; its replacement semantics are documented.

**F05-01 — P2, reproduced: Dogbone collapses all paths onto the first operation.**

- Source: `src/core/geometry/dogbone.ts:63–80`; `src/ui/state/vector-path-actions.ts:318–335`.
- Trigger: switch to CNC mode, then apply Dogbone to one multicolor imported object containing closed contours with different assigned operations.
- Defect: the core unions all rings into one output path. `prepareCollapsedEdit` then assigns that result only to `primaryOperationForObject`, discarding other operation assignments. This contrasts with the current mixed-operation weld implementation.
- Evidence: ordinary two-color imported artwork starts with two resolved operations and ends with only the first after `dogboneSelection(2)`. Regions previously assigned to different operations now use the first operation's settings. The test proves state/binding changes, not a physical machining result.
- Fix: preserve effective-operation partitions through corner relief or expose a deliberate operation-consolidation choice before changing the result. Do not silently choose the first operation for every region. Keep error handling atomic and preserve per-object metadata.
- Acceptance: mixed closed contours retain their effective tool/depth/feed or laser settings after relief; shared layers and sublayers remain correctly bound; undo restores exact sources. Keep the documented corner-overcut geometry variant distinct from directional dogbone/T-bone refinements.

Inspected: `core/geometry/vector-path-booleans.ts`, `dogbone.ts`, `state/vector-path-actions.ts`, `vector-path-weld-plan.ts`, `vector-path-weld-bindings.ts`, `fill-selection-actions.ts`, `close-open-fill-contours-actions.ts`, `convert-to-bitmap.ts`, and `raster/ConvertToBitmapDialog.tsx`. Existing vector-path-actions suite passed. Pixel fidelity of vector-to-bitmap output was not exhaustively compared against reference artwork.

## 6. Text and fonts

**Assessment: good text geometry and variable-data separation; async ownership and metadata preservation need correction.**

Text normalizes Unicode to NFC, checks font and guide availability, sanitizes numeric fields, and separates font loading from pure text geometry. Missing embedded fonts fail visibly. Path/bent text and variable rendering are separate stages. CSV import has request/document ownership. Variable changes are undoable, and automatic sequence advancement checks the expected project. The successful-stream arming race is separately recorded as **F25-1**, without duplicating its count here.

**F06-01 — P2, reproduced: delayed text rendering can insert into another project after Escape.**

- Source: `src/ui/text/AddTextDialog.tsx:74`, `115–144`; `src/ui/common/use-dialog-a11y.ts:84–87`.
- Trigger: submit text while font/rendering is pending, press Escape, then create/open another project before rendering finishes.
- Defect: Cancel is disabled while submitting, but the shared Dialog still permits Escape. `commitText` holds bare store `upsert`/`close` callbacks with no dialog request, document epoch or source-object identity check after the await.
- Evidence: the actual dialog submits against deferred rendering, Escape closes it, a real `newProject()` creates a blank replacement, then completion inserts the old text and marks the replacement dirty. The only mocked boundary is font/render completion; state and dialog behavior are real jsdom components.
- Fix: capture the initiating document and dialog request, invalidate on close/reopen, and publish only to the matching owner. Editing should additionally check that the source object has not been replaced. Scope errors and closing to that owner too.
- Acceptance: delayed success/error after Escape, new/open, or another text dialog performs no stale mutation or closure; normal add/edit still commits once. Aborting fetch is helpful but cannot replace a publication guard.

**F06-02 — P2, reproduced: editing text resets its object power scale.**

- Source: `src/ui/state/scene-mutations.ts:429–442`; text draft construction `AddTextDialog.tsx:126–142`.
- Trigger: give text 50% object power scale, then edit its content and Save.
- Defect: `applyUpsertText` reconstructs the edited object from the text draft and preserves transform/operation bindings only. It drops `powerScale` and other existing object-level metadata not included in the text form.
- Evidence: calling the same actual upsert boundary with the form's draft shape changes the stored scale from `50` to `undefined`, whose effective default is 100%. Content editing thus changes output strength as well as text.
- Fix: merge text-owned fields into the matching existing text object while preserving unrelated object settings, lock, provenance and valid bindings. Explicitly decide metadata that is geometry-dependent instead of broadly dropping it.
- Acceptance: edit text with non-default power/operation overrides and verify unchanged effective output settings, preserved transform and one undo entry; new text still receives fresh defaults.

Inspected: `text/AddTextDialog.tsx`, `use-text-dialog-fields.ts`, `font-loader.ts`, `render-text-geometry.ts`, `render-variable-text.ts`, `state/variable-data-actions.ts`, `core/variables` entry points, and the upsert boundary. Existing AddTextDialog and variable-data-actions suites passed; they do not include these ownership/metadata cases. Every font/script's glyph quality and imported font licensing are outside this code-quality pass.

## 7. Operations, layers and run order

**Assessment: explicit operation identities and canonical run order are strong, but Make unique changes effective settings.**

Fresh same-color artwork receives independent operations; multicolor imports use explicit path assignments. Sharing, adding and making operations unique are separate actions. Sublayers are cloned rather than aliased. Bulk CNC depth changes validate the entire compatible target set before mutation and skip V-carve's non-fixed role. Run units group only identical complete operation lists; exact numbered order is persisted separately from raw scene order and has atomic undo.

**F07-01 — P2, reproduced: Make unique discards the selected artwork's effective override.**

- Source: `src/ui/state/operation-actions.ts:164–195`; UI promise `src/ui/layers/SelectedOperationInspector.tsx:168`.
- Trigger: two artworks share an operation; one has an effective power/speed override. Select it and choose **Make unique**.
- Defect: the new operation copies the raw shared layer, while `clearOperationOverride(object)` removes the selected artwork's override. The button promises a copy of its operation settings, and the same inspector displays effective settings, but those values are not materialized or preserved.
- Evidence: shared base power 30%, selected artwork effective power 10% and speed 1234; after making unique the actual effective operation returns to base power 30%. The independent operation exists, but its output settings changed.
- Current UI reachability was independently checked: rasterized tracing can retain a source and share its Image operation while assigning the derived artwork its own override (`rasterized-trace-mutation.ts:55–59,140–153`). The inspector displays and edits that override. A negative source with a non-negative traced result can consequently regain inversion when made unique; overrides are not merely legacy test data.
- Fix: preserve object overrides or materialize effective settings into independent operation(s), including sublayers, while respecting different selected overrides and material-binding semantics. Only an explicit reassignment/reset should discard settings.
- Acceptance: sharing → per-object override → Make unique preserves effective root/sublayer output and the unselected artwork's settings; undo restores sharing and exact overrides.

Inspected: `state/operation-actions.ts`, `artwork-order-actions.ts`, `layers/SelectedOperationInspector.tsx`, `ArtworkRunOrderPanel.tsx`, `artwork-run-order-view-model.ts`, `core/artwork-order.ts`, `artwork-run-units.ts` and relevant compile-order tests. Existing operation-actions, artwork-order-actions and compile-job-artwork-order suites passed.

**Maintainability/performance follow-up:** `artwork-run-order-view-model.ts:79–84` compiles a job synchronously during React row-model computation, excluding only V-carve. Reusing a prepared job/effective-step index would avoid coupling ordinary panel rendering to expensive compilation. This is a source-confirmed architecture concern; no new measured freeze or separate correctness defect is claimed for this path.

## Verification and limitations

- [Existing suite output](existing-suites-01-07.log): **21 files, 144 tests passed**, 33.52 seconds.
- [Audit regression fixture](audit-feature01-07.test.tsx) and [output](repro-01-07.log): **six expected-invariant failures**, one per finding above, against unchanged application source. The final run took 9.20 seconds. An initial text fixture dispatched Escape to the wrong DOM node; it was corrected to dispatch from the dialog's textarea before recording the confirmed failure.
- Independent adversarial review confirmed all six findings. Dogbone's fixture was additionally switched to CNC mode and rerun alone: [CNC output](repro-dogbone-cnc.log), the same operation-loss failure, 9.94 seconds. This is a refined reachability check for F05-01, not a seventh finding.
- The extracted archive has no `.git`; Vite's build-label lookup prints three Git warnings. Vitest loads and runs normally. These warnings are not application findings.
- No full `release:check`, packaged build, new full browser pass, provider call or hardware operation was performed. Existing passing tests support the stated invariants, not a claim that all feature paths are correct.
