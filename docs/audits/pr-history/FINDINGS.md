# Confirmed defects and repairs

This list grows as the audit continues. Status is taken from the live repair ledger; pending review or CI is not completion. See [progress](STATUS.md) and [historical dispositions](DISPOSITIONS.md).

## FND-001: SVG import drops visible children overriding inherited fill or stroke opacity

Repair: [#1139](https://github.com/cisgz3a-hub/KerfDesk/pull/1139). State: merged-ci-verified.

Recorded CI: passed at commit 2f212738870ccdbea45e739acd05a5c0bfe389e8.

Trigger: Import a group with fill-opacity=0 and child rectangle fill-opacity=1, or stroke-opacity equivalents.

Impact: Browser and worker parsers both return null object, zero paths and SVG has no drawable geometry.

Historical origin: #10.

Review follow-ups:

- Invalid winning CSS and duplicate inline declarations discard a valid lower opacity: Confirmed against the first published candidate with Chrome and both importers. Validate declarations before collapsing cascade candidates; retain valid lower values and importance order. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1139#discussion_r4240305758).
- Raw presentation attributes incorrectly accept declaration importance: Confirmed parent-zero / child 1 !important case. Keep attribute property-value syntax separate from CSS declaration priority. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1139#discussion_r4240305762).
- Revert falls back to a same-element author attribute: Confirmed against Chrome. For supported author-only paint-opacity declarations, revert removes author candidates and inherits the parent value. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1139#discussion_r4240305766).
- Comments and malformed numeric tokens change imported visibility: Confirmed comment rejection in the first candidate. Accept surrounding comments without joining number, percent, sign or keyword tokens; reject trailing-dot numbers and clamp large numeric values consistently. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1139#discussion_r4240305771).
- Valid revert-layer incorrectly exposes lower opacity from the same cascade layer: Confirmed in the earlier audit repair. Inline revert-layer now reveals stylesheet opacity, and stylesheet rollback reveals the presentation attribute with importance order preserved. Independently reviewed and published. Required CI is tracked at the current repair head. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1139#discussion_r4240364150).
- Valid CSS math opacity is rejected before cascade resolution: Context-free CSS math now retains valid winning opacity, including typed absolute-unit cancellation and scalar functions; invalid numeric types preserve valid lower declarations. Layout-dependent winners retain an explicitly warned opaque approximation because exact visibility requires layout. Fresh imports and replacements both display the warning. Independently reviewed and published. Required CI is tracked at the current repair head. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1139#discussion_r4240364155).
- Valid variable-containing opacity declaration is discarded before the cascade winner is resolved: Confirmed valid variable winner was discarded before cascade resolution. The published repair preserves syntactically valid variable-containing winners as unresolved, imports them with opacity 1 and explicitly warns that CSS variables or layout-dependent values may hide source artwork that is included. Invalid syntax retains valid lower candidates. Full custom-property substitution remains outside scope. Source review, 1259 isolated tests and 12 real production-worker cases passed. Required CI is tracked at the current repair head. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1139#discussion_r4240505326).
- Valid environment opacity winner is discarded and malformed nested environment syntax survives: Independently reproduced against published a4c1968. Retain syntactically valid env() winners as qualified unresolved opacity, validate nested var/env fallback syntax, and explicitly warn that custom or environment values can hide artwork imported fully opaque. Full substitution remains outside scope. Independently reviewed and published. Required CI is tracked at the current repair head. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1139#discussion_r4240569209).
- Unsupported dimension escapes validation through a scalar opacity function: Independent lower-zero sign(1fr) tests exposed geometry that Chrome hides. Reject failed typed arguments except legitimate round/clamp keyword slots; preserve supported typed cancellation and scalar functions. This separately reproduced defect is distinct from the original flex-ratio interoperability claim. Independently reviewed and published. Required CI is tracked at the current repair head.
- Typed attribute opacity winners are discarded before computed-value substitution: Syntactically valid typed attr() winners now use the disclosed opaque approximation instead of exposing a lower zero. Invalid syntax preserves valid lower declarations. The related real worker entity mismatch is repaired by consuming already-decoded Attr.value once for paint-opacity CSS, without a second decoder or changes to sanitization. Full attribute lookup/substitution is not claimed. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1139#discussion_r4240648365).
- Escaped important identifiers are not recognized as declaration priority: Declaration importance is recognized from final decoded delimiter/identifier tokens, including escaped important spelling, with property-value and raw-attribute validation kept separate. Independent browser and parser controls pass. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1139#discussion_r4240648371).

Cascade, rollback, typed-math, replacement-warning and variable-winner follow-ups are published at the recorded review heads. The variable defect was found while reviewing the audit repair; its historical introduction was not established and is not assigned to PR #10. The separate intermediate Infinity/NaN claim did not reproduce and is rejected candidate DISP-042, not a repaired defect. Environment substitution and unsupported scalar arguments were reproduced against the current repair, not attributed to PR #10. Flex-ratio compatibility is DISP-043. Typed attribute winners and escaped importance are confirmed follow-ups; their related worker XML entity mismatch is recorded with the attribute repair. The rollback report is rejected in DISP-045, relative sign precision is DISP-044, and the distinct jsdom sanitizer artifact is DISP-046.

Local evidence: docs/audits/2026-10-11-pr-history/foundation.md. Repair evidence: docs/audits/2026-10-11-pr-history/publication/heartbeat-0718-svg-repair-report.md.

## BITMAP-01: Retain boundary outlines after pixel-coordinate rounding

Repair: [#1140](https://github.com/cisgz3a-hub/KerfDesk/pull/1140). State: merged-ci-verified.

Recorded CI: passed at commit 297d3f547217c338fec8d6c6b7d77847c32cf0fc.

Trigger: Convert a 10.01 by 10 mm rectangle to Outlines at 254 DPI

Impact: Bitmap artwork and derived engraving omit a boundary edge

Historical origin: #10.

Local evidence: docs/audits/2026-10-11-pr-history/controller-raster.md. Repair evidence: docs/audits/2026-10-11-pr-history/repair-summary.md.

## EUM-01: Preserve valid imported thicknesses when opening the material editor

Repair: [#1141](https://github.com/cisgz3a-hub/KerfDesk/pull/1141). State: merged-ci-verified.

Recorded CI: passed at commit 0e0a5f2f8f0381cb46daf097151af17499e21e27.

Trigger: Deserialize and import a valid preset with thicknessMm=3.175 (one-eighth-inch stock), open MaterialPresetWizard with that preset, then click native Next. The draft displays 3.17, the number input has step=0.1 and stepMismatch=true, the form is invalid, and clicking Next stays at Step 1 despite the button being enabled.

Impact: The editor cannot edit the valid preset unchanged; the operator must alter the material thickness to a representable tenth, changing the identity used for material matching. Original store value is not mutated merely by opening the wizard.

Historical origin: #14. Both formatting and step constraint blame directly to the new #14 wizard.

Local evidence: docs/audits/2026-10-11-pr-history/early-ui-materials.md. Repair evidence: docs/audits/2026-10-11-pr-history/repair-summary.md.

## EUM-02: Keep the canonical material identity during an unchanged preset edit

Repair: [#1141](https://github.com/cisgz3a-hub/KerfDesk/pull/1141). State: merged-ci-verified.

Recorded CI: passed at commit 0e0a5f2f8f0381cb46daf097151af17499e21e27.

Trigger: Import a valid line/cut preset with material='Birch', materialName='Birch plywood premium', thicknessMm=3. It initially matches job material Birch. Open Edit and click Next/Next/Next/Save without editing. The stored material is replaced with Birch plywood premium; bestRecipeForOperation for the existing Birch job returns undefined.

Impact: An ordinary no-change or description-only edit silently removes the preset from the previous material group and automatic recipe selection. Direct manual Apply remains available.

Historical origin: #14. The metadata rewrite was introduced in #14. The demonstrated auto-recipe consequence is a later descendant behavior (ADR-496), not a claim that automatic assignment shipped in #14.

Local evidence: docs/audits/2026-10-11-pr-history/early-ui-materials.md. Repair evidence: docs/audits/2026-10-11-pr-history/repair-summary.md.

## EUM-03: Update operation metadata when changing a preset's process mode

Repair: [#1141](https://github.com/cisgz3a-hub/KerfDesk/pull/1141). State: merged-ci-verified.

Recorded CI: passed at commit 0e0a5f2f8f0381cb46daf097151af17499e21e27.

Trigger: Edit a saved line/cut preset, choose Fill in Step 2 and finish the wizard. The stored recipe.mode is fill but operation remains cut. bestRecipeForOperation for the same material's Fill operation returns undefined.

Impact: The wizard creates an internally inconsistent preset that the current automatic material recipe selector cannot use for either its old or its chosen process. No operation field is offered to repair this in the wizard.

Historical origin: #14. Existing operation is unconditionally retained by the #14 new builder. Automatic selection manifestation depends on later ADR-496 code.

Local evidence: docs/audits/2026-10-11-pr-history/early-ui-materials.md. Repair evidence: docs/audits/2026-10-11-pr-history/repair-summary.md.

## CCA-001: Append camera preview cache busting outside the proxied camera URL

Repair: [#1142](https://github.com/cisgz3a-hub/KerfDesk/pull/1142). State: merged-ci-verified.

Recorded CI: passed at commit 335b6e8438f2694b005c906bce761894cc479e98.

Trigger: Detect a machine snapshot camera whose successful frame response takes longer than the 1500 ms preview poll (2.2 s in reproduction, below the bridge 10 s timeout).

Impact: The discovered-machine preview never displays a frame despite successful camera responses. Each tick changes the upstream camera URL, queues a different request, and the browser has superseded that request before its response arrives. Opening the panel can also accumulate extra upstream work.

Historical origin: #33. PR #33 introduced the bridge URL input at MachineCameraSection while retaining NetworkCameraView's pre-existing ?t concatenation. #50 touched this component's click mapping but did not repair the URL composition. Current blame points at a later JSX rewrite; cached #33 patch establishes the integration regression, not initial authorship of the concatenation.

Local evidence: docs/audits/2026-10-11-pr-history/batch-02/camera-canvas-arcs.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-02/camera-repair.md.

## CCA-002: Use the grabbed selected node as the drag reference

Repair: [#1143](https://github.com/cisgz3a-hub/KerfDesk/pull/1143). State: merged-ci-verified.

Recorded CI: passed at commit b8389a0f7f9318e6750a0d7482ffa127aa4f293e.

Trigger: Select node A, Shift-add B so B is primary, then plain-drag already-selected A.

Impact: The entire selected node set jumps by the separation from B to A. A 1 mm drag of A at x=0 when B is x=10 instead moves A to -9 and B to 1, distorting the path relative to unselected nodes.

Historical origin: #32. The exact conditional and primary-target group translation are introduced in cached PR #32 patches and survive current main. Current blame is 5b226b9abb; historical GitHub head differs because repository history was rewritten.

Local evidence: docs/audits/2026-10-11-pr-history/batch-02/camera-canvas-arcs.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-02/node-drag-repair.md.

## BRP-01: Reject a stale board correction after Undo replaces the captured outline

Repair: [#1145](https://github.com/cisgz3a-hub/KerfDesk/pull/1145). State: merged-ci-verified.

Recorded CI: passed at commit 27f118da6cca51f64ec7e69b6cdd1ee1926e2084.

Trigger: Capture a 120 x 80 rectangle over an existing 40 x 40 captured board. Begin bottom-left physical-point correction, then invoke ordinary Undo while setOriginHere is pending. Resolve the origin operation.

Impact: The 40 x 40 outline restored by Undo is silently resized to 120 x 80 by stale completion and the panel displays success. The pending operation has published old geometry into the restored scene instead of retaining the Undo result or reporting stale ownership.

Historical origin: #304. Mocked origin/jog promises only. No firmware state changed and no hardware ran. This lane found the later descendant bug while reviewing #43; #304 has not received a full PR audit.

Local evidence: docs/audits/2026-10-11-pr-history/batch-02/board-rotary-planner.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-02/board-repair.md.

## B02-TRACE-001: Close the final fairing span at its actual corner

Repair: [#1144](https://github.com/cisgz3a-hub/KerfDesk/pull/1144). State: merged-ci-verified.

Recorded CI: passed at commit b0a45672e8846e58910c06db3fbf286d60ebe96e.

Trigger: A closed measured organic contour with one or more pinned corners reaches fairChainSegments; cyclically shift the equivalent ring to a different first corner or reverse traversal.

Impact: The final ordinary sample is pinned instead of smoothing the full span back to the corner, leaving traversal-dependent texture/kink near the seam. A 4800-point textured rectangle differs by 0.35840233726637066 source pixels under cyclic rotation.

Historical origin: #51.

Local evidence: docs/audits/2026-10-11-pr-history/batch-02/trace.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-02/trace-repair.md.

## B03-CNC-001: Use a valid containment witness for concave helical pockets

Repair: [#1146](https://github.com/cisgz3a-hub/KerfDesk/pull/1146). State: merged-ci-verified.

Recorded CI: passed at commit 04545ed92f6bbf4366b99be9d22ec21a53dda4b2.

Trigger: One C-shaped island-free polygon [(0,0),(30,0),(30,6),(6,6),(6,24),(30,24),(30,30),(0,30)]; 2 mm cutter, 40% stepover, helix diameters 1 to 2 mm at 5 degrees, depth -1 mm.

Impact: The three generated nested C rings are all inside the legal outer boundary, but their area centroid falls in the open notch. The centroid check incorrectly classifies them as multiple/island geometry. The planner returns the island-free-pocket error and the actual source-region caller returns no passes, dropping a geometrically feasible operation.

Historical origin: #74.

Review follow-ups:

- Repeated full-boundary scans add material dense-pocket planning cost: Confirmed on the first repair: eight rings with 2,048 vertices each rose from roughly 1.15 s before repair to 2.38 s. Reusing the boundary index restores roughly 1.12 s while preserving complete plans and full checks for possible contact. A separate deterministic four-ring, 256-vertex regression reduces full predicates from 768 to 3. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1146#discussion_r4240337078).

The first audit repair added this measured cost. The planner already had quadratic entry-search work; the follow-up does not claim to eliminate that pre-existing worst case or qualify hardware latency.

Local evidence: docs/audits/2026-10-11-pr-history/batch-03/cnc-geometry.json. Repair evidence: docs/audits/2026-10-11-pr-history/publication/helical-performance-repair.md.

## B03-CNC-002: Look up manual tab anchors using the source path color

Repair: [#1147](https://github.com/cisgz3a-hub/KerfDesk/pull/1147). State: merged-ci-verified.

Recorded CI: passed at commit be8d56612aeb6c20131ff2c1ca8eeb00a2770307.

Trigger: An imported red 40 x 40 mm square is explicitly bound to a green named profile operation. Place two anchors at path fractions 0.05 and 0.55, with automatic tabs-per-shape still four; use a 6 mm cut with 3 mm depth steps and 2 mm high, 6 mm wide tabs.

Impact: The UI stores and displays anchors by the source red path color. Compilation passes the green operation color to objectTabPoints, so both anchors disappear from collected contours and four automatic tabs replace the two chosen positions. Exported holding-tab placement differs from the editor.

Historical origin: #193.

Local evidence: docs/audits/2026-10-11-pr-history/batch-03/cnc-geometry.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-03/cnc-repairs.md.

## MTX-001: Bind Zero Z acknowledgement to the tool that initiated it

Repair: [#1148](https://github.com/cisgz3a-hub/KerfDesk/pull/1148). State: merged-ci-verified.

Recorded CI: passed at commit 4cecefc2f99271f2ec3d6a88781d659bcad2122f.

Trigger: Select the 3.175 mm bit after the 6.35 mm bit, begin Zero Z, and use Ctrl+Z before the controller acknowledges G54 G92 Z0. Undo restores the 6.35 mm bit while the original write is pending.

Impact: The old command records manual-zero evidence for the newly selected 6.35 mm bit. cncWorkZeroToolStartIssue then reports no mismatch for that bit, although it did not own the touch-off. This corrupts tool-specific setup evidence and suppresses the existing Job Review warning; no physical motion or crash was asserted by the probe.

Historical origin: #110. PR #88 created the acknowledged origin transaction callback. The faulty live selectedCncToolId read was added by PR #110 (outside this assigned historical range), whose implementation is a current descendant; no claim that #110 received a complete audit.

Local evidence: docs/audits/2026-10-11-pr-history/batch-03/machine-transactions.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-03/zero-z-repair.md.

## WUX-001: Imported-program playback uses the background project timing

Repair: [#1149](https://github.com/cisgz3a-hub/KerfDesk/pull/1149). State: merged-ci-verified.

Recorded CI: passed at commit 4dc690605f80ef27dac35b95e0d0371856ad19f4.

Trigger: Open a CNC project containing ordinary artwork, inspect a different external program and choose Open in 2D simulator. Same-geometry F60/F6000 programs both inherit the existing project estimate.

Impact: Playback and displayed timing describe unrelated project output, hiding external feed timing differences. No emitted program change is asserted.

Historical origin: #80. PR80 introduced estimate-dependent playback; the displayed project estimate mismatch predates PR80 (Workspace estimate call blame 8f24e8d2d5).

Review follow-ups:

- Incremental arc-center declarations unnecessarily disable imported timing: Explicit incremental arc centers preserve the already-supported route and timing; absolute centers remain unsupported. Independently reviewed and published in 286e7a54eccbfa4cdb4f2ee9988f80ccf6a35ff4. Required CI is tracked at the current repair head. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1149#discussion_r4240361096).
- Pausing a trailing dwell makes Play restart the entire route: Play resumes remaining trailing dwell and replays only after actual timeline completion. Independently reviewed and published in 286e7a54eccbfa4cdb4f2ee9988f80ccf6a35ff4. Required CI is tracked at the current repair head. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1149#discussion_r4240361100).
- Supported exported dialect words unnecessarily disable imported timing: Only represented G54, Marlin fan and Smoothieware power words pass the source-model validation and retain timing. Independently reviewed and published in 286e7a54eccbfa4cdb4f2ee9988f80ccf6a35ff4. Required CI is tracked at the current repair head. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1149#discussion_r4240361105).
- Restart during a leading dwell retains elapsed wait time: An explicit restart revision clears elapsed time even when the scrubber distance is already zero. Independently reviewed and published in 286e7a54eccbfa4cdb4f2ee9988f80ccf6a35ff4. Required CI is tracked at the current repair head. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1149#discussion_r4240361108).
- Same-block dwell is scheduled after motion: Ordinary G4 executes before same-block motion in both planning boundaries and preview timestamps; existing cycle dwell representation is preserved. Independently reviewed and published in 286e7a54eccbfa4cdb4f2ee9988f80ccf6a35ff4. Required CI is tracked at the current repair head. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1149#discussion_r4240361112).
- Non-finite dwell publishes an infinite estimate and unfinishable playback: Non-finite totals or segments retain geometry and report timing unavailable instead of publishing an unfinishable timeline. Independently reviewed and published in 286e7a54eccbfa4cdb4f2ee9988f80ccf6a35ff4. Required CI is tracked at the current repair head. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1149#discussion_r4240361117).
- Clearing inactive preview repeatedly updates state with an unstable scheduler: Hosted CI exhausted a test worker. The exact unfinished test injects a fresh scheduler; independent capped probes reproduce all three modes. The repair returns the existing already-empty state for the same owner, preserving real owner changes, route clearing and cancellation. The default application scheduler is stable; this is not a claim that every ordinary mount exhausts memory. Independently reviewed and published. Required CI is tracked at the current repair head.
- Live ETA counts an already-completed same-block dwell: A trusted midpoint after G4 P3 plus motion retained three extra seconds of remaining time. Current-line dwell progress removes the completed wait while preserving exact route boundaries, future and trailing dwells, calibration and serial time. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1149#discussion_r4240671071).
- Parser-only dwell metadata violates the closed executable-plan v1 schema: Assembly now creates the declared kind/line/seconds dwell shape. Original render-model events retain ordering metadata for internal timing; the v1 schema and exact executable program bytes remain unchanged. [Review finding](https://github.com/cisgz3a-hub/KerfDesk/pull/1149#discussion_r4240671073).

These six cases were reproduced against the first published imported-program timing repair. Their repair remains in the same focused PR; they are not attributed wholesale to historical PR #80. Source and mock playback evidence do not qualify controller hardware. The inactive-clear object update was introduced by this audit repair, and is tracked as a CI follow-up rather than a new historical PR #80 defect. The same-block live-progress and v1 event-projection defects are descendants of this audit repair, not newly attributed historical PR #80 defects.

Local evidence: docs/audits/2026-10-11-pr-history/batch-03/workspace-ux.json. Repair evidence: docs/audits/2026-10-11-pr-history/publication/heartbeat-0737-timing-repair.md.

## B03-VAR-001: Keep the editable current serial inside the persistence integer domain

Repair: [#1150](https://github.com/cisgz3a-hub/KerfDesk/pull/1150). State: merged-ci-verified.

Recorded CI: passed at commit 5db629ff40eb51254d39695cce9bee3fdb850109.

Trigger: Enter 10000000000000000 in the current Variable serial input. HTML input validity succeeds and the ordinary React/store edit commits that value.

Impact: Manual Save preparation and autosave preparation reject variables.serialValue until the operator changes or undoes it. The visible editor accepts state that cannot be persisted; existing files are not overwritten with corrupt data.

Historical origin: #58. The current-value Counter originated in PR #58 (e3fb1903c8); #72 preserved it while adding bounded controls; #1041 (2f3c83ab5a) moved the same lower-bound-only rule to DraftNumberInput. This is not newly introduced by #72.

Local evidence: docs/audits/2026-10-11-pr-history/batch-03/root-coverage.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-03/variable-counter-repair.md.

## B04-DIAGNOSTIC-001: Opt-in Edge diagnostics use copied settings that differ from the app defaults they claim

Repair: [#1152](https://github.com/cisgz3a-hub/KerfDesk/pull/1152). State: merged-ci-verified.

Recorded CI: passed at commit b121d97e71c17f4eed04373d68f54de925c0386d.

Trigger: Run the Edge smoothness or small-letter diagnostics with TRACE_AUDIT=1 and no operator override.

Impact: The diagnostic helpers force a 3-pixel minimum instead of the fresh app default of 12, retaining short closed contours that the app drops and undermining their claimed default-path comparisons. This is a developer diagnostic fidelity defect, not a demonstrated application tracing regression.

Historical origin: See attribution. The two discovery helpers originated at original-history 0f5668c6ff5795addf7bd41e2e27dee26d287d6e (rewritten history 871bb3acd5b9ca3106890603a1595dd1e206c51b), when the preset already used 12 and fresh UI overrides were empty. PR #18 changed only opt-in gating. Independent review identified the same false-current-default copy in _new-problems-audit.test.ts; the explicit historical region-enhancement scenario keeps its inputs.

Local evidence: docs/audits/2026-10-11-pr-history/batch-04/early-supporting-diffs.md. Repair evidence: docs/audits/2026-10-11-pr-history/batch-04/trace-diagnostic-author.md.

## B05-CONSOLE-001: Combined tool and XY mutations retain stale XY origin evidence

Repair: [#1162](https://github.com/cisgz3a-hub/KerfDesk/pull/1162). State: pr-open-ci-pending.

Recorded CI: pending at commit 05573b3c311e0bb8b3ea5ff89a0d8c6f989e5d2a.

Trigger: G92 X0 T2 or G92.1 G49

Impact: Stale XY setup authority and misleading current origin state. Console already clears Frame trace/permit, so this does not demonstrate an old-permit Start bypass.

Historical origin: #94. {"originalHistoricalHead":"46ec73a56ae405d344672597de4b8ada80e38276","rewrittenIntroduction":"e1c6d14e0","currentPersistence":"Tool-first ordering unchanged; later #187 adds accessory branches only."}

Local evidence: docs/audits/2026-10-11-pr-history/batch-05/lane-a.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-05/repair-console-author.json.

## B05-CONSOLE-002: Firmware-equivalent GRBL numeric spellings preserve stale work Z

Repair: [#1162](https://github.com/cisgz3a-hub/KerfDesk/pull/1162). State: pr-open-ci-pending.

Recorded CI: pending at commit 05573b3c311e0bb8b3ea5ff89a0d8c6f989e5d2a.

Trigger: G092 Z0 or G 92 Z0

Impact: After a fresh position, CNC Frame planning still considers the old stock-top reference current and builds an absolute safe-Z retract/return against a mutated Z0; Job Review work-Z advisory also sees stale proof. Current Frame permit is invalidated, so no claim of direct prior-permit reuse.

Historical origin: #94. {"rewrittenIntroduction":"e1c6d14e0","currentPersistence":"Original command regex/comment replacement unchanged through #187."}

Local evidence: docs/audits/2026-10-11-pr-history/batch-05/lane-a.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-05/repair-console-author.json.

## B05-C-REALTIME-COMMENTS: Saved G-code comments preserve GRBL realtime command bytes

Repair: [#1161](https://github.com/cisgz3a-hub/KerfDesk/pull/1161). State: pr-open-ci-failed.

Recorded CI: failed at commit 72dbd3b37bcd125f14dd221cbc51d5ebbe5edbca.

Trigger: Profile name Shop!~ exported with ordinary build metadata; a sender transmits comments verbatim.

Impact: Preflight succeeds and profile comment retains ! then ~; upstream GRBL RX interprets feed hold and cycle start before line/comment parsing. Unsupported Unicode becomes ?, triggering status requests. Saved files sent by an external sender preserving comment bytes. Own streamer filters full-line comments. No physical-machine qualification or hardware operation.

Historical origin: #541. User-controlled profile comment exposure introduced in #541 (b813865131); unsupported Unicode fallback to '?' added in #898 (91c1adefa0). Discovered while tracing checkpoint #10 descendants, not introduced by that checkpoint.

Local evidence: docs/audits/2026-10-11-pr-history/batch-05/lane-c.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-05/repair-comment-author.json.

## B05-CONSOLE-003: Console WCS spellings and comments leave a stale G54 selection

Repair: [#1162](https://github.com/cisgz3a-hub/KerfDesk/pull/1162). State: pr-open-ci-pending.

Recorded CI: pending at commit 05573b3c311e0bb8b3ea5ff89a0d8c6f989e5d2a.

Trigger: Known activeWcs G54, then Console selects G55 using G055, G 55, G55X0, G55 (G54), or G55 ; G54.

Impact: The physical Frame can remain in G55 while canonical emitted execution expects G54. Existing coordinate evidence invalidation does not repair the stale activeWcs cache.

Historical origin: #923. GitHub commit-to-pulls API associates rewritten introduction 5eb28354d1804f7159ef86cbe2fc7d33849d6c40 with PR923; title Controller audit 2026-09-25: fix every confirmed controller finding; merge_commit_sha eaf62efe283d036c0192e0ea009df912ece72cb9; head ab9954213b83988201a6d75ef2e2334b5841e777.

Local evidence: docs/audits/2026-10-11-pr-history/batch-05/console-wcs-finding.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-05/repair-console-author.json.

## B05-CONSOLE-004: Fractional Console tool words preserve stale work-Z evidence

Repair: [#1162](https://github.com/cisgz3a-hub/KerfDesk/pull/1162). State: pr-open-ci-pending.

Recorded CI: pending at commit 05573b3c311e0bb8b3ea5ff89a0d8c6f989e5d2a.

Trigger: Send accepted GRBL T2.5, T+002.5 or T 2 . 5, alone or combined with G92 X0.

Impact: Accepted numeric tool identity changes preserve work-Z proof and reference epoch, unlike equivalent canonical T2. This is inconsistent coordinate-evidence invalidation; stock GRBL only tracks the tool number, so no physical tool-motion claim is made.

Historical origin: #94. Original PR94 tool regex admits integer T words only; the first batch05 lexical normalization still retained that restriction.

Local evidence: docs/audits/2026-10-11-pr-history/batch-05/console-fractional-tool-finding.json. Repair evidence: docs/audits/2026-10-11-pr-history/batch-05/console-fractional-tool-author.json.
