# LightBurn node joining: evidence and KerfDesk design

Date: 2026-10-12. Baseline: `864caa3624d7034c466f321163cfbd968355ccd7`. Status: confirmed pre-fix reproduction, local geometry correction, and passing focused tests on `codex/node-join-preserve-curves`. This document does not claim native runtime parity or publication.

## Documented LightBurn behavior

- **Auto-join selected shapes:** select the line/curve segments, then use Edit → Auto-join selected shapes or Alt/Option+J. Endpoints must be within 0.05 mm; connected segments become one path. The documentation suggests Break Apart and retry when suitably close segments do not join. It does not specify endpoint placement, handle adjustment, branch ambiguity, or numerical coincidence rules. [Official LightBurn 2.1 Auto-join documentation](https://docs.lightburnsoftware.com/2.1/Reference/AutoJoinSelectedShapes/)
- **Node editing:** dragging disconnected nodes onto one another joins the adjacent lines into a shared path. Edit Nodes requires ungrouped paths; text, primary shapes, and barcodes must first be converted. This page does not document an explicit two-selected-endpoint Join command, a 0.05 mm node-drag tolerance, a bridge preview, or a handle-preservation policy. [Official LightBurn 2.1 Edit Nodes documentation](https://docs.lightburnsoftware.com/2.1/Reference/EditNodes/#mouse-actions)

These are separate interactions. The automatic tool's documented distance limit is not evidence of the manual node interaction's threshold. KerfDesk's explicit Join design below is its own geometry-preservation contract.

## Saved native evidence and limits

The reviewed records concern installed LightBurn 2.1.02, executable SHA-256 `a0836cc167ff4402e68d35ef3384a2042c4ddb7aa83a428fb754371f4290b0c6`. They are saved static analysis, not observed execution. No new REA session, Ghidra import, binary analysis, or native launch was performed for this document.

| Record | Evidence and bounded relevance |
| --- | --- |
| Close C11, `0x1402e8c80` | `ev_3d9b76af72fb714b5cf3d8ee4f07f6a5125a11e91d814bba15ee74d7f8fcb14a`, external `lightburn-close/11-procedure_pseudo_code.json`: endpoint-gap **closure**, including midpoint and small-gap merge branches. It does not establish Auto-join or node-drag internals. |
| Close C19/C20 | External `lightburn-close/19-targeted-post-merge-trace.json` and `20-targeted-link-provenance.json`, with their Markdown addenda: targeted PE/RTTI/Capstone traces, not additional REA evidence IDs. They qualify closure callbacks and ordinary grouping/array dependencies. They do not identify the Auto-join entry point or qualify native node-join interaction. |
| Trim E11 | `ev_5fce581977389ca58bd5c0edf52287962b638504eebba2bf25cfa46133b2a3c9`, external `lightburn-trim/11-standalone-query.json`: related Trim autojoin modifier/hint context, not a demonstrated endpoint-placement or curve-preservation contract for either joining tool. |

External paths are rooted at `C:/Users/Asus/Tools/rea-install-verification`. A bounded filename/text review of the saved Close and Trim records and the existing joining/closure audits found no directly qualified native Auto-join or node-drag geometry trace. This is a coverage limit of the inspected evidence, not a claim that no such implementation or other evidence exists. See [the Close Path audit](2026-10-11-lightburn-close-path-investigation.md) for C11/C19/C20 qualifications. No decompiled code or LightBurn assets are reused.

## Current KerfDesk behavior and confirmed reproduction

Cross-artwork **Join paths…** already has a configurable physical tolerance, default 0.05 mm. `src/core/geometry/vector-path-join.ts` transforms canonical curves into world coordinates; `path-endpoint-join.ts` matches mutual unique compatible endpoints, preserves curves, and bridges gaps. This is not a proposed new automatic tool.

The separate existing node Join action in `src/ui/workspace/ToolStrip.tsx` calls `joinSelectedCurveNodes`. `src/ui/state/path-node-curve-join-plan.ts` requires exactly two eligible anchors in the same artwork and colored path, joins distinct subpaths or closes one subpath, and supplies an explicit unchanged result for invalid selections. `path-node-curve-command-actions.ts` commits a successful replacement in one Undo step and clears Redo. There is no physical-gap bridge preview in this inspected baseline flow; the preview below is a proposal.

The baseline `src/core/scene/curve-join.ts` compares endpoint coordinates with a local `1e-9` epsilon. The new `src/core/scene/curve-join-scale.test.ts` failed before the correction: Join suppressed a physically distinct bridge and changed the second cubic's implicit start despite preserving its control coordinates.

The independently reproduced **core/store stress fixture** has cubic A from `(10,10)`, through controls `(12,15)` and `(18,15)`, to `(20,10)`; cubic B starts at `(20.5,10)`, has controls `(25,15)` and `(35,15)`, and ends at `(40,10)`. Every stored coordinate is divided by `1e9`, with uniform object scale `1e9`. Thus the approximately `5e-10` local gap represents 0.5 mm physically. The pre-fix joined B midpoint had X `29.999999999999996`, versus the original X `30.062500000000004`: measured drift `0.0625000000000071` mm. This agrees with the cubic start coefficient of one eighth at parameter 0.5. The observed pre-fix record is `C:/Users/Asus/Tools/rea-install-verification/node-join-review/reproduction.json`.

That scale is **outside persisted-project admission**: `src/io/project/project-shape-primitives.ts` sets `MAX_PROJECT_TRANSFORM_SCALE = 100_000`. The 0.5 mm gap and 0.0625 mm displacement therefore establish the core algorithm's behavior under stress, not the magnitude of a defect in an admitted saved project. They also do not establish LightBurn behavior or rendered/native-runtime behavior.

A separate **admitted-project fixture** keeps A's world coordinates above, uses B start `(20.00005,10)` with controls `(25,15)` and `(35,15)` and end `(40,10)`, divides every stored coordinate by `1e5`, and uses uniform scale `1e5`. Its physical gap is 0.00005 mm. An isolated harness using the baseline source measured midpoint X `30.000000000000004`, versus `30.00000625` with the correction: drift `0.000006249999994878408` mm. The actual store regression verifies both before and after projects are accepted by serialize/deserialize, preserves the exact second cubic start, and restores the projects with one Undo/Redo step. This is a numerical fidelity defect; the supported reproduction does not establish a visibly displaced ordinary drawing. The receipt is external `node-join-review/supported-reproduction.json`.

The local core correction replaces epsilon-based coincidence with exact equality of the stored X and Y coordinates. This follows the existing `WORKFLOW.md` F-A5a contract: gaps receive line segments, coincident endpoints do not, and exact cubic/arc geometry is preserved. Independent read-only review of this narrow diff found no actionable defect; endpoint validation, reversal, and source ordering are unchanged. No automatic 0.05 mm tolerance is added to explicit Join. The planner's existing local 0.05 compatibility-materialization tolerance remains untouched; a physical-tolerance upgrade and broader transformed-rendering qualification are separate work.

## Bounded correction and separate interaction proposal

1. Select two eligible open endpoints using the existing same-artwork/same-colored-path eligibility rules. Keep cross-artwork automatic joining separate. Explain invalid selections and leave geometry/history unchanged.
2. A separate interaction proposal is to show the proposed straight bridge and its endpoint distance in physical millimetres before committing. Zoom or endpoint-detail presentation would make a short gap inspectable. A standalone explainer can demonstrate this design, but does not implement or qualify the live product UI. This proposal is not a requirement of the bounded geometry correction.
3. Click **Join** to connect distinct endpoints with a straight segment while retaining every source curve's geometric locus, endpoints, controls, and placement. Reversing traversal may swap cubic handles or arc sweep but must not change the curve. Exactly coincident endpoints add no duplicate edge. Joining a path's own endpoints closes it under the same preservation rule.
4. Commit once; Undo restores the complete prior project and Redo restores the result. Invalid geometry and failed bounded materialization create no history. Regenerate compatibility geometry under the existing materialization policy. The proposed preview would not mutate on selection changes or cancellation; this does not promise a new preview UI in the current correction.

## Completed geometry verification

The initial focused cohort passed **36 tests in five files**, including 12 new regressions. After adding the admission-limit persistence regression, the affected store file passed all **six tests**. Together these runs cover **37 distinct tests**, including 13 new regressions; the unchanged files were not rerun:

- `src/core/scene/curve-join-scale.test.ts`: all four endpoint orientations, independent Bernstein cubic samples, scaled/baked equivalence, rotation/reflection/nonuniform scale, preserved arc start, exact coincidence, and same-curve closure.
- `src/ui/state/path-node-join-scale.test.ts`: the actual store action, regenerated compatibility seams, one-step project Undo/Redo, and atomic rejection of closed paths and non-finite controls.
- Existing `curve-join.test.ts`, `path-node-curve-command-actions.test.ts`, and `path-node-curve-join-plan.test.ts`: reversal including transformed arcs, source-order stability, untouched contours/tab anchors, invalid selection explanations, shape synchronization, and save/reopen coverage. The existing Lock Selection behavior remains allowed; this fix adds no refusal.

The exact commands and production source SHA-256 are recorded in external `node-join-review/verification.json`. Production changes are limited to the coincidence predicate and its comment in `curve-join.ts`; the other code additions are regression tests. Live-product Join-control/browser qualification, a physical-tolerance rendering upgrade, and broader output checks are not claimed by these tests.

The scale-`1e9` cases remain core/store stress coverage outside saved-project admission. The added persistence regression qualifies the scale-`1e5` case only.

## Interactive preview and final checks

The standalone preview at `C:/Users/Asus/.codex/visualizations/2026/10/11/01a12a24-3354-7861-843e-f3656de92805/node-join-preview.html` illustrates the stress fixture, with explicit stress/proposed-interaction labels. It compares old and corrected behavior, scaled and baked coordinates, the bridge and midpoint displacement, and Join/Undo/Redo. It is an independently coded deterministic simulation of the recorded fixture, not the running KerfDesk UI.

Chrome passed four interaction cases: light/dark appearance at widths 736 and 320 pixels, with mobile touch contexts at 320. Checks cover fixture values, Join, Undo/Redo buttons and keyboard, old scaled displacement, old baked preservation, corrected bridge preservation, magnified detail, and responsive bounds. There were zero page errors. A later labels-only qualification was checked at 320 pixels with full status text visible; unchanged action tests were not repeated. Receipts and inspected screenshots are external `node-join-preview-review/results.json` and `narrow-status.json`.

Scoped ESLint and formatting passed for the production change and initial tests. Final TypeScript and static checks after the added persistence regression are recorded in external `node-join-review/typecheck-final-result.json` and the final verification receipt. No dependencies, licence terms, machine policy, hardware state, or published release changed. This later branch remains unmerged.

This investigation concerns drawing geometry only. Native runtime parity, output/hardware qualification, and any broader automatic-joining redesign remain outside its evidence.
