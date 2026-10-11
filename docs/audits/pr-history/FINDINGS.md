# Confirmed defects and repairs

This list grows as the audit continues. Status is taken from the live repair ledger; pending review or CI is not completion. See [progress](STATUS.md) and [historical dispositions](DISPOSITIONS.md).

## FND-001: SVG import drops visible children overriding inherited fill or stroke opacity

Repair: [#1139](https://github.com/cisgz3a-hub/KerfDesk/pull/1139). State: pr-open-ci-pending.

Trigger: Import a group with fill-opacity=0 and child rectangle fill-opacity=1, or stroke-opacity equivalents.

Impact: Browser and worker parsers both return null object, zero paths and SVG has no drawable geometry.

Historical origin: #10.

Review follow-ups:

- Invalid winning CSS and duplicate inline declarations discard a valid lower opacity: Confirmed against the first published candidate with Chrome and both importers. Validate declarations before collapsing cascade candidates; retain valid lower values and importance order. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1139#discussion_r4240305758).
- Raw presentation attributes incorrectly accept declaration importance: Confirmed parent-zero / child 1 !important case. Keep attribute property-value syntax separate from CSS declaration priority. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1139#discussion_r4240305762).
- Revert falls back to a same-element author attribute: Confirmed against Chrome. For supported author-only paint-opacity declarations, revert removes author candidates and inherits the parent value. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1139#discussion_r4240305766).
- Comments and malformed numeric tokens change imported visibility: Confirmed comment rejection in the first candidate. Accept surrounding comments without joining number, percent, sign or keyword tokens; reject trailing-dot numbers and clamp large numeric values consistently. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1139#discussion_r4240305771).
- Valid revert-layer incorrectly exposes lower opacity from the same cascade layer: Confirmed in the earlier audit repair. Inline revert-layer now reveals stylesheet opacity, and stylesheet rollback reveals the presentation attribute with importance order preserved. Independently reviewed and published; latest-head hosted CI remains pending. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1139#discussion_r4240364150).
- Valid CSS math opacity is rejected before cascade resolution: Context-free CSS math now retains valid winning opacity, including typed absolute-unit cancellation and scalar functions; invalid numeric types preserve valid lower declarations. Layout-dependent winners retain an explicitly warned opaque approximation because exact visibility requires layout. Fresh imports and replacements both display the warning. Independently reviewed and published; latest-head hosted CI remains pending. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1139#discussion_r4240364155).

The first four follow-ups were corrected in the earlier audit repair. The later rollback, typed math and replacement-warning defects are repaired and published at the recorded follow-up head; required CI is still pending. These audit-repair regressions and older cascade limitations are not attributed wholesale to historical PR #10.

Local evidence: docs/audits/2026-10-11-pr-history/foundation.md. Repair evidence: docs/audits/2026-10-11-pr-history/publication/svg-math-followup.md.

## BITMAP-01: Retain boundary outlines after pixel-coordinate rounding

Repair: [#1140](https://github.com/cisgz3a-hub/KerfDesk/pull/1140). State: pr-open-ci-verified.

Trigger: Convert a 10.01 by 10 mm rectangle to Outlines at 254 DPI

Impact: Bitmap artwork and derived engraving omit a boundary edge

Historical origin: #10.

Local evidence: docs/audits/2026-10-11-pr-history/controller-raster.md. Repair evidence: docs/audits/2026-10-11-pr-history/repair-summary.md.

## EUM-01: Preserve valid imported thicknesses when opening the material editor

Repair: [#1141](https://github.com/cisgz3a-hub/KerfDesk/pull/1141). State: pr-open-ci-verified.

Trigger: Deserialize and import a valid preset with thicknessMm=3.175 (one-eighth-inch stock), open MaterialPresetWizard with that preset, then click native Next. The draft displays 3.17, the number input has step=0.1 and stepMismatch=true, the form is invalid, and clicking Next stays at Step 1 despite the button being enabled.

Impact: The editor cannot edit the valid preset unchanged; the operator must alter the material thickness to a representable tenth, changing the identity used for material matching. Original store value is not mutated merely by opening the wizard.

Historical origin: #14. Both formatting and step constraint blame directly to the new #14 wizard.

Local evidence: docs/audits/2026-10-11-pr-history/early-ui-materials.md. Repair evidence: docs/audits/2026-10-11-pr-history/repair-summary.md.

## EUM-02: Keep the canonical material identity during an unchanged preset edit

Repair: [#1141](https://github.com/cisgz3a-hub/KerfDesk/pull/1141). State: pr-open-ci-verified.

Trigger: Import a valid line/cut preset with material='Birch', materialName='Birch plywood premium', thicknessMm=3. It initially matches job material Birch. Open Edit and click Next/Next/Next/Save without editing. The stored material is replaced with Birch plywood premium; bestRecipeForOperation for the existing Birch job returns undefined.

Impact: An ordinary no-change or description-only edit silently removes the preset from the previous material group and automatic recipe selection. Direct manual Apply remains available.

Historical origin: #14. The metadata rewrite was introduced in #14. The demonstrated auto-recipe consequence is a later descendant behavior (ADR-496), not a claim that automatic assignment shipped in #14.

Local evidence: docs/audits/2026-10-11-pr-history/early-ui-materials.md. Repair evidence: docs/audits/2026-10-11-pr-history/repair-summary.md.

## EUM-03: Update operation metadata when changing a preset's process mode

Repair: [#1141](https://github.com/cisgz3a-hub/KerfDesk/pull/1141). State: pr-open-ci-verified.

Trigger: Edit a saved line/cut preset, choose Fill in Step 2 and finish the wizard. The stored recipe.mode is fill but operation remains cut. bestRecipeForOperation for the same material's Fill operation returns undefined.

Impact: The wizard creates an internally inconsistent preset that the current automatic material recipe selector cannot use for either its old or its chosen process. No operation field is offered to repair this in the wizard.

Historical origin: #14. Existing operation is unconditionally retained by the #14 new builder. Automatic selection manifestation depends on later ADR-496 code.

Local evidence: docs/audits/2026-10-11-pr-history/early-ui-materials.md. Repair evidence: docs/audits/2026-10-11-pr-history/repair-summary.md.

## CCA-001: Append camera preview cache busting outside the proxied camera URL

Repair: [#1142](https://github.com/cisgz3a-hub/KerfDesk/pull/1142). State: pr-open-ci-pending.

Trigger: Detect a machine snapshot camera whose successful frame response takes longer than the 1500 ms preview poll (2.2 s in reproduction, below the bridge 10 s timeout).

Impact: The discovered-machine preview never displays a frame despite successful camera responses. Each tick changes the upstream camera URL, queues a different request, and the browser has superseded that request before its response arrives. Opening the panel can also accumulate extra upstream work.

Historical origin: #33. PR #33 introduced the bridge URL input at MachineCameraSection while retaining NetworkCameraView's pre-existing ?t concatenation. #50 touched this component's click mapping but did not repair the URL composition. Current blame points at a later JSX rewrite; cached #33 patch establishes the integration regression, not initial authorship of the concatenation.

Local evidence: docs/audits/2026-10-11-pr-history/batch-02/camera-canvas-arcs.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-02/camera-repair.md.

## CCA-002: Use the grabbed selected node as the drag reference

Repair: [#1143](https://github.com/cisgz3a-hub/KerfDesk/pull/1143). State: pr-open-ci-pending.

Trigger: Select node A, Shift-add B so B is primary, then plain-drag already-selected A.

Impact: The entire selected node set jumps by the separation from B to A. A 1 mm drag of A at x=0 when B is x=10 instead moves A to -9 and B to 1, distorting the path relative to unselected nodes.

Historical origin: #32. The exact conditional and primary-target group translation are introduced in cached PR #32 patches and survive current main. Current blame is 5b226b9abb; historical GitHub head differs because repository history was rewritten.

Local evidence: docs/audits/2026-10-11-pr-history/batch-02/camera-canvas-arcs.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-02/node-drag-repair.md.

## BRP-01: Reject a stale board correction after Undo replaces the captured outline

Repair: [#1145](https://github.com/cisgz3a-hub/KerfDesk/pull/1145). State: pr-open-ci-pending.

Trigger: Capture a 120 x 80 rectangle over an existing 40 x 40 captured board. Begin bottom-left physical-point correction, then invoke ordinary Undo while setOriginHere is pending. Resolve the origin operation.

Impact: The 40 x 40 outline restored by Undo is silently resized to 120 x 80 by stale completion and the panel displays success. The pending operation has published old geometry into the restored scene instead of retaining the Undo result or reporting stale ownership.

Historical origin: #304. Mocked origin/jog promises only. No firmware state changed and no hardware ran. This lane found the later descendant bug while reviewing #43; #304 has not received a full PR audit.

Local evidence: docs/audits/2026-10-11-pr-history/batch-02/board-rotary-planner.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-02/board-repair.md.

## B02-TRACE-001: Close the final fairing span at its actual corner

Repair: [#1144](https://github.com/cisgz3a-hub/KerfDesk/pull/1144). State: pr-open-ci-pending.

Trigger: A closed measured organic contour with one or more pinned corners reaches fairChainSegments; cyclically shift the equivalent ring to a different first corner or reverse traversal.

Impact: The final ordinary sample is pinned instead of smoothing the full span back to the corner, leaving traversal-dependent texture/kink near the seam. A 4800-point textured rectangle differs by 0.35840233726637066 source pixels under cyclic rotation.

Historical origin: #51.

Local evidence: docs/audits/2026-10-11-pr-history/batch-02/trace.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-02/trace-repair.md.

## B03-CNC-001: Use a valid containment witness for concave helical pockets

Repair: [#1146](https://github.com/cisgz3a-hub/KerfDesk/pull/1146). State: pr-open-ci-pending.

Trigger: One C-shaped island-free polygon [(0,0),(30,0),(30,6),(6,6),(6,24),(30,24),(30,30),(0,30)]; 2 mm cutter, 40% stepover, helix diameters 1 to 2 mm at 5 degrees, depth -1 mm.

Impact: The three generated nested C rings are all inside the legal outer boundary, but their area centroid falls in the open notch. The centroid check incorrectly classifies them as multiple/island geometry. The planner returns the island-free-pocket error and the actual source-region caller returns no passes, dropping a geometrically feasible operation.

Historical origin: #74.

Review follow-ups:

- Repeated full-boundary scans add material dense-pocket planning cost: Confirmed on the first repair: eight rings with 2,048 vertices each rose from roughly 1.15 s before repair to 2.38 s. Reusing the boundary index restores roughly 1.12 s while preserving complete plans and full checks for possible contact. A separate deterministic four-ring, 256-vertex regression reduces full predicates from 768 to 3. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1146#discussion_r4240337078).

The first audit repair added this measured cost. The planner already had quadratic entry-search work; the follow-up does not claim to eliminate that pre-existing worst case or qualify hardware latency.

Local evidence: docs/audits/2026-10-11-pr-history/batch-03/cnc-geometry.json. Repair evidence: docs/audits/2026-10-11-pr-history/publication/helical-performance-repair.md.

## B03-CNC-002: Look up manual tab anchors using the source path color

Repair: [#1147](https://github.com/cisgz3a-hub/KerfDesk/pull/1147). State: pr-open-ci-pending.

Trigger: An imported red 40 x 40 mm square is explicitly bound to a green named profile operation. Place two anchors at path fractions 0.05 and 0.55, with automatic tabs-per-shape still four; use a 6 mm cut with 3 mm depth steps and 2 mm high, 6 mm wide tabs.

Impact: The UI stores and displays anchors by the source red path color. Compilation passes the green operation color to objectTabPoints, so both anchors disappear from collected contours and four automatic tabs replace the two chosen positions. Exported holding-tab placement differs from the editor.

Historical origin: #193.

Local evidence: docs/audits/2026-10-11-pr-history/batch-03/cnc-geometry.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-03/cnc-repairs.md.

## MTX-001: Bind Zero Z acknowledgement to the tool that initiated it

Repair: [#1148](https://github.com/cisgz3a-hub/KerfDesk/pull/1148). State: pr-open-ci-pending.

Trigger: Select the 3.175 mm bit after the 6.35 mm bit, begin Zero Z, and use Ctrl+Z before the controller acknowledges G54 G92 Z0. Undo restores the 6.35 mm bit while the original write is pending.

Impact: The old command records manual-zero evidence for the newly selected 6.35 mm bit. cncWorkZeroToolStartIssue then reports no mismatch for that bit, although it did not own the touch-off. This corrupts tool-specific setup evidence and suppresses the existing Job Review warning; no physical motion or crash was asserted by the probe.

Historical origin: #110. PR #88 created the acknowledged origin transaction callback. The faulty live selectedCncToolId read was added by PR #110 (outside this assigned historical range), whose implementation is a current descendant; no claim that #110 received a complete audit.

Local evidence: docs/audits/2026-10-11-pr-history/batch-03/machine-transactions.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-03/zero-z-repair.md.

## WUX-001: Imported-program playback uses the background project timing

Repair: [#1149](https://github.com/cisgz3a-hub/KerfDesk/pull/1149). State: pr-open-ci-pending.

Trigger: Open a CNC project containing ordinary artwork, inspect a different external program and choose Open in 2D simulator. Same-geometry F60/F6000 programs both inherit the existing project estimate.

Impact: Playback and displayed timing describe unrelated project output, hiding external feed timing differences. No emitted program change is asserted.

Historical origin: #80. PR80 introduced estimate-dependent playback; the displayed project estimate mismatch predates PR80 (Workspace estimate call blame 8f24e8d2d5).

Review follow-ups:

- Incremental arc-center declarations unnecessarily disable imported timing: Explicit incremental arc centers preserve the already-supported route and timing; absolute centers remain unsupported. Independently reviewed and published in 286e7a54eccbfa4cdb4f2ee9988f80ccf6a35ff4; required CI remains pending. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1149#discussion_r4240361096).
- Pausing a trailing dwell makes Play restart the entire route: Play resumes remaining trailing dwell and replays only after actual timeline completion. Independently reviewed and published in 286e7a54eccbfa4cdb4f2ee9988f80ccf6a35ff4; required CI remains pending. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1149#discussion_r4240361100).
- Supported exported dialect words unnecessarily disable imported timing: Only represented G54, Marlin fan and Smoothieware power words pass the source-model validation and retain timing. Independently reviewed and published in 286e7a54eccbfa4cdb4f2ee9988f80ccf6a35ff4; required CI remains pending. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1149#discussion_r4240361105).
- Restart during a leading dwell retains elapsed wait time: An explicit restart revision clears elapsed time even when the scrubber distance is already zero. Independently reviewed and published in 286e7a54eccbfa4cdb4f2ee9988f80ccf6a35ff4; required CI remains pending. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1149#discussion_r4240361108).
- Same-block dwell is scheduled after motion: Ordinary G4 executes before same-block motion in both planning boundaries and preview timestamps; existing cycle dwell representation is preserved. Independently reviewed and published in 286e7a54eccbfa4cdb4f2ee9988f80ccf6a35ff4; required CI remains pending. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1149#discussion_r4240361112).
- Non-finite dwell publishes an infinite estimate and unfinishable playback: Non-finite totals or segments retain geometry and report timing unavailable instead of publishing an unfinishable timeline. Independently reviewed and published in 286e7a54eccbfa4cdb4f2ee9988f80ccf6a35ff4; required CI remains pending. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1149#discussion_r4240361117).

These six cases were reproduced against the first published imported-program timing repair. Their repair remains in the same focused PR; they are not attributed wholesale to historical PR #80. Source and mock playback evidence do not qualify controller hardware.

Local evidence: docs/audits/2026-10-11-pr-history/batch-03/workspace-ux.json. Repair evidence: docs/audits/2026-10-11-pr-history/publication/imported-timing-followup.md.

## B03-VAR-001: Keep the editable current serial inside the persistence integer domain

Repair: [#1150](https://github.com/cisgz3a-hub/KerfDesk/pull/1150). State: pr-open-ci-pending.

Trigger: Enter 10000000000000000 in the current Variable serial input. HTML input validity succeeds and the ordinary React/store edit commits that value.

Impact: Manual Save preparation and autosave preparation reject variables.serialValue until the operator changes or undoes it. The visible editor accepts state that cannot be persisted; existing files are not overwritten with corrupt data.

Historical origin: #58. The current-value Counter originated in PR #58 (e3fb1903c8); #72 preserved it while adding bounded controls; #1041 (2f3c83ab5a) moved the same lower-bound-only rule to DraftNumberInput. This is not newly introduced by #72.

Local evidence: docs/audits/2026-10-11-pr-history/batch-03/root-coverage.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-03/variable-counter-repair.md.
