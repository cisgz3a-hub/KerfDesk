# LightBurn Parity Audit Verification (Codex) - 2026-06-03

## Scope

This is an audit-only verification pass against the current `LaserForge-2.0` checkout. It reviews `audit/LIGHTBURN-PARITY-AUDIT-2026-06-03.md`, rejects stale or overbroad claims, and cross-references the highest-risk claims against current source plus official LightBurn/GRBL documentation.

No production code was changed in this pass.

Karpathy-style rule used here: reduce each claim to a concrete failure path, verify it from source, reject vague parity wishes, and only propose fixes that can be tested.

## External References Used

- LightBurn Optimization Settings: https://docs.lightburnsoftware.com/latest/Reference/OptimizationSettings/
- LightBurn Image Mode / raster settings: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/ImageMode/
- LightBurn Shared Cut Settings: https://docs.lightburnsoftware.com/latest/Reference/CutSettingsEditor/SharedSettings/
- LightBurn Coordinates and Job Origin: https://docs.lightburnsoftware.com/latest/Reference/CoordinatesOrigin/
- LightBurn Job Control: https://docs.lightburnsoftware.com/latest/GetStarted/JobControl/
- GRBL v1.1 Commands: https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands

## Verdict

The generated LightBurn audit direction is broadly correct, but it needs three important corrections before it becomes an implementation plan:

1. Runtime pause/feed-hold safety belongs in Tier 0. Current `pauseJob` sends only GRBL feed hold (`!`). GRBL documentation says feed hold pauses motion but does not disable spindle/coolant. For a laser, the app must not imply Pause is a safety stop without a verified laser-off policy.
2. Raster ETA undercount is stale in the current tree. Raw planner code skips raster groups, but public duration estimation now wraps jobs with raster sweep groups before estimating.
3. SVG transform support is partially stale in the audit. The current parser has recursive presentation state and transform handling. The remaining confirmed SVG gaps are physical unit handling plus `<use>`/`<symbol>` expansion.

The revised first implementation tier should be:

1. Pause/feed-hold safety policy and tests.
2. Inside-first containment ordering for cuts.
3. Laser-off-on-travel invariant wired into preflight/output gating.

The next tier should cover layer ordering, job-origin UI, raster image settings, M3/M4/min-power design, and primitive shape creation. Features marked out of scope in `PROJECT.md` or `DECISIONS.md` must remain out of scope unless the project owner approves an ADR/scope change.

## Confirmed Findings

### LF-CV-001 - Pause uses feed hold without proving laser-off behavior

Severity: P0 safety

Confidence: High

Module: `src/ui/state/laser-store.ts`, `src/core/controllers/grbl/commands.ts`

Trigger path: Operator presses Pause during an active burn move.

Failure mode: `pauseJob` sends `RT_HOLD` (`!`) and marks the streamer paused. It does not send `M5`, soft-reset, or verify that the controller has extinguished the laser.

Consequence: GRBL feed hold is a motion pause, not a guaranteed spindle/laser-off command. In an unfavorable firmware/configuration/path state, the beam may stay active while the head decelerates or dwells.

Evidence:

- `src/core/controllers/grbl/commands.ts` defines `RT_HOLD = '!'`.
- `src/ui/state/laser-store.ts` sends only `RT_HOLD` in `pauseJob`.
- GRBL docs state feed hold pauses motion and does not disable spindle/coolant.
- LightBurn docs distinguish Pause/Stop and warn that software Stop is convenience, not the only emergency stop method.

Concrete fix:

Write failing tests first for pause behavior during active streaming. Then choose and document one policy:

- Pause is explicitly not a safety stop, with UI copy and mandatory physical E-stop guidance.
- Or Pause becomes a safety-first stop/reset action for LaserForge, using soft-reset/laser-off sequencing and state recovery.

Either way, add hardware verification on scrap at low power before calling the safety behavior proven.

### LF-CV-002 - Cut path optimization lacks inside-first containment ordering

Severity: P0/P1 output correctness

Confidence: High

Module: `src/core/job/optimize-paths.ts`

Trigger path: Cutting nested shapes, such as holes inside a larger outline.

Failure mode: Cut groups are ordered by nearest-neighbor distance, not by polygon containment. Outer contours can be cut before inner contours.

Consequence: Parts can shift, drop, or lose registration before inner details are cut. LightBurn exposes "Cut Inner Shapes First" for this reason.

Evidence:

- `optimizePaths` comments and implementation describe nearest-neighbor ordering.
- No containment/inside-first grouping is present.
- LightBurn Optimization Settings document "Cut Inner Shapes First" to prevent pieces from falling out before internal cuts complete.

Concrete fix:

Add a pure core containment pass for closed cut paths before nearest-neighbor ordering. Start with tests for nested squares, nested holes, open paths, and mixed raster/cut groups. Preserve existing nearest-neighbor optimization inside each containment depth bucket.

### LF-CV-003 - Laser-off-on-travel invariant is not wired into preflight

Severity: P1 safety defense-in-depth

Confidence: High

Module: `src/core/invariants/predicates.ts`, `src/core/preflight/preflight.ts`, `src/io/gcode/emit-gcode.ts`

Trigger path: A future output strategy or regression emits travel moves with nonzero laser power.

Failure mode: `findLaserOnTravelIssues` exists, but current preflight imports and runs only bounds checking. The laser-off travel predicate is tested but not used as a preflight/output gate.

Consequence: A future emitter regression could pass compile/preflight without failing the app-level safety gate.

Evidence:

- `findLaserOnTravelIssues` is defined in `src/core/invariants/predicates.ts`.
- `runPreflight` imports `findOutOfBoundsCoords` but not `findLaserOnTravelIssues`.
- Current GRBL strategy emits `S0` on `G0`, so this is a defense-in-depth gap, not proof that current output is unsafe.

Concrete fix:

Wire `findLaserOnTravelIssues` into preflight or `emitGcode` as a hard gate. Add a failing test using an intentionally bad G-code string or test strategy that emits `G0 ... S###`.

### LF-CV-004 - Start From / Job Origin UI is hardcoded instead of LightBurn-like

Severity: P1 workflow correctness

Confidence: High

Module: `src/core/job/job-origin.ts`, `src/ui/laser/start-job-readiness.ts`

Trigger path: User expects to place a job from center, corner, current position, or another LightBurn-style origin.

Failure mode: Core has a 9-anchor type, but default constants are front-left and start readiness uses `USER_ORIGIN_JOB_PLACEMENT`. There is no exposed Start From mode or 9-dot UI.

Consequence: Users can frame/start from the wrong location, especially when coming from LightBurn habits.

Evidence:

- `JobOriginAnchor` includes 9 positions.
- `ABSOLUTE_JOB_PLACEMENT` and `USER_ORIGIN_JOB_PLACEMENT` both use front-left.
- LightBurn Coordinates/Origin docs expose Absolute Coords, Current Position, User Origin, Stored Position, plus the 9-dot Job Origin selector.

Concrete fix:

Expose a small Job Origin control first: absolute/user-origin mode plus 9-anchor selection. Treat Current Position and Stored Position as separate ADR/workflow items because they depend on trustworthy live machine state.

### LF-CV-005 - Raster engraving settings are too thin versus LightBurn image mode

Severity: P1 output fidelity

Confidence: High

Module: `src/core/raster/dither.ts`, `src/core/scene/layer.ts`, `src/ui/layers/LayerRow.tsx`, `src/core/trace/dither-trace.ts`

Trigger path: User imports an image and expects LightBurn-like tonal/dither control.

Failure mode: Raster engraving exposes only `threshold`, `floyd-steinberg`, and `grayscale`, while the trace path already has many more dither kernels. Tonal controls and scan settings are limited.

Consequence: Engraved output can diverge from LightBurn expectations, especially for logos, small text, and photo-like images.

Evidence:

- Raster dither type is limited to three modes.
- Trace dither code includes a broader 13-mode set.
- LightBurn Image Mode docs list multiple image modes and controls such as overscanning, line interval/DPI, and image adjustments.

Concrete fix:

Promote deterministic dither kernels from trace into the raster engrave path where they make sense for S-value output. Add layer schema/UI coverage, golden pixel tests, and one hardware burn comparison before expanding more modes.

### LF-CV-006 - Layer reorder and priority controls are absent

Severity: P1 workflow/output ordering

Confidence: High

Module: `src/ui/state/store.ts`, `src/ui/layers/CutsLayersPanel.tsx`, `src/core/job/compile-job.ts`

Trigger path: User needs one layer to cut/engrave before another.

Failure mode: Layers render in existing order and layer settings can be patched, but there is no reorder/priority action or UI.

Consequence: Output order is driven by import/internal order instead of an operator-visible cut plan. This blocks a key LightBurn workflow.

Evidence:

- `setLayerParam` updates layer parameters but not order/priority.
- `CutsLayersPanel` maps layers without reorder controls.
- LightBurn Optimization Settings document order by layer and order by priority.

Concrete fix:

Add `moveLayer` and optional `priority` in scene state, UI up/down controls, and compile-order tests. Keep it simple: layer order first, priority later if needed.

### LF-CV-007 - Min Power and M3/M4 policy needs an ADR, not a naive field

Severity: P1 output and firmware compatibility

Confidence: Medium-high

Module: `src/core/scene/layer.ts`, `src/core/output/grbl-strategy.ts`, `src/core/raster/emit-raster.ts`

Trigger path: User tunes vector corners or grayscale behavior expecting LightBurn-like Min Power and laser mode choices.

Failure mode: LaserForge currently models one power value per layer and fixed modal choices. Adding Min Power without firmware-mode handling can create misleading controls.

Consequence: Users may think they are controlling dynamic power when firmware settings such as `$31` and M3/M4 behavior determine the actual effect.

Evidence:

- Layer model contains a single main power value.
- LightBurn Shared Settings expose Speed, Max Power, and Min Power, with notes about firmware support.
- Existing project decisions have hardcoded M3/M4 strategy boundaries.

Concrete fix:

Write an ADR for Min Power, M3/M4, and GRBL laser-mode assumptions. Only then add schema/UI/output changes and tests for vector constant power, dynamic power, and raster grayscale.

### LF-CV-008 - SVG import audit is partially stale; units and `<use>` remain real gaps

Severity: P2 import fidelity

Confidence: High for remaining gaps

Module: `src/io/svg/parse-svg.ts`, `src/io/svg/shape-to-polylines.ts`

Trigger path: Import SVGs that rely on physical units, symbols, or `<use>` references.

Failure mode: The audit's "no transforms" claim is stale. Current parser handles recursive presentation state and common transforms. Remaining gaps include unit-aware width/height scaling and `<use>`/`<symbol>` expansion.

Consequence: Some SVG imports will scale incorrectly or omit reused symbol content.

Evidence:

- `parse-svg.ts` includes `presentationStateFor`, `parseTransform`, and recursive traversal.
- Width/height parsing uses `Number.parseFloat`, which drops units.
- No confirmed `<use>`/`href`/symbol expansion path was found.

Concrete fix:

Add parser tests for `mm`, `cm`, `in`, `px`, `viewBox`, `<defs>`, `<symbol>`, and `<use href>`. Implement only the failing cases and update comments that imply full support.

### LF-CV-009 - Raster ETA undercount claim is stale in current tree

Severity: Resolved/monitor

Confidence: High

Module: `src/core/job/planner.ts`, `src/core/job/estimate-duration.ts`

Trigger path: Estimating duration for raster jobs.

Failure mode claimed by audit: Planner skips raster groups, so raster ETA is undercounted.

Current finding: The raw planner still skips raster groups, but public duration estimation calls `jobWithRasterSweeps(job)` before estimating.

Consequence: The broad audit claim should not be used as a current finding. Accuracy can still be improved, but it is not the same defect.

Evidence:

- `planner.ts` skips raw raster groups intentionally.
- `estimateJobDuration` wraps jobs with raster sweep groups.
- Raster duration tests exist in the current tree.

Concrete fix:

Keep raster ETA tests and add hardware calibration later. Do not spend Tier 0 time fixing a stale defect.

### LF-CV-010 - Shape creation is absent, but advanced editing remains out of scope

Severity: P1 foundation / P3 advanced parity

Confidence: High

Module: `src/core/scene/scene-object.ts`, `src/ui/common/Toolbar.tsx`, `PROJECT.md`, `DECISIONS.md`

Trigger path: User expects to draw rectangles, circles, lines, or edit nodes like LightBurn.

Failure mode: Scene object types cover imported SVG, text, traced image, and raster image. Toolbar supports import/text/image/trace/convert/G-code flows, not primitive drawing.

Consequence: LaserForge cannot perform many basic layout edits without round-tripping through external tools.

Evidence:

- No primitive rectangle/ellipse/line object kind was found.
- Project docs mark boolean ops, node editing, offset/kerf, tabs/bridges, lead-in/out, DXF/PDF import, camera, rotary, and variable text as out of scope or not authorized by parity language.

Concrete fix:

Split scope carefully. Add primitive parametric shapes and grouping only if the project owner wants that foundation. Do not schedule boolean/node/offset/kerf/camera/DXF/PDF work without an explicit scope decision.

## Revised Implementation Order

### Tier 0 - Safety and irreversible output mistakes

1. Pause/feed-hold safety policy and tests.
2. Inside-first containment ordering for closed cut paths.
3. Laser-off-on-travel invariant wired into preflight/output gating.

### Tier 1 - Operator workflow parity

1. Layer reorder.
2. Job Origin 9-dot UI plus absolute/user-origin mode.
3. Raster dither/settings expansion for the engrave path.
4. Min Power / M3-M4 ADR before implementation.
5. Primitive shape foundation if approved.

### Tier 2 - Import/render fidelity

1. SVG units and `<use>`/`<symbol>` support.
2. Perceptual preview/export comparison harness.
3. Raster tonal controls and additional calibrated modes.

### Excluded Until Scope Changes

Boolean ops, node editing, offset/kerf compensation, tabs/bridges, lead-in/out, arrays, variable text, camera alignment, rotary, DXF import, and PDF import remain out of scope unless `PROJECT.md` / ADR scope changes are approved.

## Final Audit Judgment

Use the generated LightBurn audit as a source of candidate gaps, not as an implementation queue. The strongest confirmed queue is small and testable:

1. Make pause semantics honest and safe.
2. Prevent outer-first cut ordering.
3. Gate emitted G-code against laser-on travel.
4. Then add the missing operator controls that directly affect job placement and cut order.

