# LightBurn Optimization Settings Research

Date: 2026-06-05
Scope: research and implementation planning only. No production code was changed for this report.
Repository: `C:\Users\Asus\LaserForge-2.0`

## Executive Summary

LaserForge has a good foundation for Optimization Settings, but it does not yet have the LightBurn workflow.

What exists today:

- `src/io/gcode/prepare-output.ts` is the correct central seam. Preview, Save, Start, and Estimate should all use the same prepared job.
- `src/core/job/optimize-paths.ts` already optimizes `cut` groups with deterministic nearest-neighbor ordering.
- It also already does closed-contour inner-first ordering and open-path reversal when the far endpoint is closer to the cursor.
- Fill and raster groups pass through the optimizer unchanged.

What is missing:

- No user-visible Optimization Settings dialog.
- No project-persisted optimization settings.
- No way to disable optimization.
- No honest LightBurn-style order-rule list.
- No Group/Priority ordering because LaserForge does not yet have stable scene groups or shape priority metadata.
- No remove-overlapping-lines, corner start selection, backlash hiding, or direction-order optimization.

Recommendation:

Build a small, truthful first version. Add a project-level `OptimizationSettings` model, route it through `prepareOutput`, and expose only the settings backed by existing algorithms:

1. `Enable optimization`
2. `Cut inner shapes first`
3. `Reduce travel moves`
4. Optional: `Optimize open path direction`

Do not expose LightBurn options that LaserForge cannot actually honor yet. That would create dangerous operator trust debt.

## Research Sources

Official LightBurn sources used:

- LightBurn Optimization Settings: https://docs.lightburnsoftware.com/latest/Reference/OptimizationSettings/
- LightBurn Laser Window: https://docs.lightburnsoftware.com/latest/Reference/LaserWindow/
- LightBurn Cuts/Layers: https://docs.lightburnsoftware.com/latest/Reference/CutsLayers/
- LightBurn Preview Window: https://docs.lightburnsoftware.com/latest/Reference/PreviewWindow/
- LightBurn Fill Mode behavior is referenced through Cut Settings docs and the repo study in `LIGHTBURN-STUDY.md`.

Local sources used:

- `LIGHTBURN-STUDY.md`
- `PROJECT.md`
- `docs/KARPATHY-LIGHTBURN-MASTER-ROADMAP-2026-06-04.md`
- `src/io/gcode/prepare-output.ts`
- `src/core/job/compile-job.ts`
- `src/core/job/optimize-paths.ts`
- `src/core/job/optimize-paths.test.ts`
- `src/core/job/toolpath.ts`
- `src/core/scene/project.ts`
- `src/io/project/deserialize-project.ts`
- `src/io/project/project-shape-validator.ts`
- `src/ui/laser/LaserWindow.tsx`
- `src/ui/laser/JobControls.tsx`
- `src/ui/state/store.ts`
- `src/ui/state/ui-store.ts`
- `src/ui/workspace/draw-preview.parity.test.ts`

## LightBurn Behavior Model

LightBurn treats Optimization Settings as output ordering and path-planning settings, not as layer power/speed settings.

Verified LightBurn concepts:

- The Laser Window exposes an Optimization Settings control.
- Optimization can be enabled/disabled.
- Disabling optimization means output order follows the drawing/order model instead of optimization reordering.
- Optimization settings can be stored with LightBurn project files.
- Order rules are modeled as an ordered list. LightBurn can order by layer, group, and priority.
- `Order by Layer` follows the Cuts/Layers list order.
- `Order by Group` keeps root-level groups together.
- `Order by Priority` uses shape priority, with priority `0` first.
- `Cut inner shapes first` cuts enclosed closed shapes before their outer closed container. This matters because cutting an outer profile first can let the material move before inner details are cut.
- Travel/path options include reducing travel moves, reducing direction changes, choosing better start points, choosing corners where possible, choosing best direction, hiding backlash, cutting in direction order, and removing overlapping lines with a distance threshold.
- Flood Fill is not an Optimization Settings option in the current docs. It belongs to Fill cut settings. It reduces blank travel for fill engraving, but it is a different workflow and should not be mixed into this feature.
- Preview is the operator-facing way to inspect path order and travel. Optimization settings must be reflected in Preview, not only in emitted G-code.

Unknown or not fully pinned:

- Some default checkbox states are not text-pinned in the current official docs. Older docs/search summaries indicate defaults such as Order by Layer/Priority, Cut inner first, and Reduce travel, but implementation should not depend on unverified default checkboxes.
- Exact interactions for `Hide Backlash` forcing or disabling other options need a direct LightBurn UI verification before implementation.

## Current LaserForge Behavior

### Output Pipeline

`src/io/gcode/prepare-output.ts` is the right integration point:

```text
Project
  -> runPreEmitPreflight(project)
  -> compileJob(project.scene, project.device)
  -> applyJobOrigin(...)
  -> optimizePaths(...)
  -> prepared Job
```

This is strong architecture. It keeps Preview, Save, Start, and Estimate on the same job truth. Any Optimization Settings implementation must stay on this path.

### Compile Order

`src/core/job/compile-job.ts`:

- Iterates `scene.layers` in order.
- Skips layers where `output` is false.
- Iterates `scene.objects` in array order inside each layer.
- Emits `cut`, `fill`, or `raster` groups according to layer mode.
- Image layers emit one `RasterGroup` per matching raster image.
- Fill layers generate hatch segments before the optimizer stage.

This means LaserForge already has a layer-order baseline.

Important nuance: LightBurn disabled optimization means drawn order. In LaserForge, simply skipping `optimizePaths` gives "compiled layer/object/segment order," not necessarily exact historical drawn order across mixed layers. A first UI must describe that honestly.

### Optimizer

`src/core/job/optimize-paths.ts`:

- Optimizes only `cut` groups.
- Leaves `fill` and `raster` groups unchanged.
- Preserves group order and therefore preserves layer order.
- Uses nearest-neighbor ordering within each cut group.
- Cuts closed contained contours before their containers using containment depth.
- Reverses open paths when entering from the opposite endpoint reduces travel.
- Does not reverse closed contours.
- Skips groups above `MAX_NEAREST_NEIGHBOR_SEGMENTS = 2000` to avoid main-thread freezes.
- Is deterministic.

This is useful, but it is not full LightBurn Optimization Settings.

### Current Test Coverage

`src/core/job/optimize-paths.test.ts` already covers:

- Empty job behavior.
- Two-segment travel improvement.
- Large-group cap.
- Open path reversal.
- Closed path non-reversal.
- Inner-before-outer closed contours.
- Cut duration preservation.
- Determinism.
- Idempotence.
- Metadata preservation.

Weaknesses:

- The "preserves cut content" test mostly checks count, not a canonical segment multiset.
- There is no explicit fill/raster pass-through test.
- There is no settings model test because settings do not exist.
- There is no test for "optimization disabled preserves compiled order."
- There is no multi-layer property test proving optimization cannot accidentally cross layer boundaries.
- Existing preview parity is good but only covers one optimized vector fixture.

## Gap Matrix

| LightBurn capability | LaserForge status | Recommendation |
|---|---|---|
| Enable/disable optimization | Missing. Optimizer is always on for cut groups. | Add project setting and route through `prepareOutput`. |
| Order by Layer | Mostly present through `scene.layers` order. | Make it explicit as the only supported order rule for v1. |
| Order by Group | Missing. No stable group model. | Defer until group/ungroup and grouped transforms exist. |
| Order by Priority | Missing. No Shape Properties priority field. | Defer until object priority metadata exists. |
| Cut inner shapes first | Implemented for closed cut contours, always on. | Expose as a boolean only if tests lock behavior. |
| Reduce travel moves | Implemented for cut groups, always on. | Expose as a boolean. |
| Open path direction optimization | Partially implemented through endpoint reversal. | Expose only with honest wording, or keep internal. |
| Cut in direction order | Missing. | Defer. Needs direction-aware sort/cost model. |
| Reduce direction changes | Missing. | Defer. Needs heading/corner cost in the optimizer. |
| Choose best starting point | Partial only for open path endpoint reversal. Closed loops are not rotated. | Defer full feature until closed-loop rotation exists. |
| Choose corners if possible | Missing. | Defer. Needs corner detection and loop start rotation. |
| Choose best direction | Partial only for open paths. | Defer full feature. |
| Hide backlash | Missing. | Defer. Needs hardware-backed direction/start constraints. |
| Remove overlapping lines | Missing for cut geometry. | Defer. Needs robust geometry splitting/dedup and pass-intent rules. |
| Preview optimized order | Mostly present for vector/fill through `prepareOutput`. Raster scrubber is not modeled. | Keep using `prepareOutput`; add settings-specific parity tests. |
| Persist settings in project | Missing. | Add top-level `Project.optimizationSettings`. |

## Karpathy-Style Implementation Plan

Principle: make the data model truthful first, then expose the smallest UI that maps to real code. No fake controls.

### P0: Lock Current Behavior Before Changing It

Add tests before implementation:

- `optimizePaths(defaultSettings)` equals current `optimizePaths(job)` output.
- Fill groups pass through structured-equal.
- Raster groups pass through structured-equal.
- Multi-layer jobs preserve group/layer order.
- Optimized cut geometry has the same canonical cut multiset, allowing only sequence changes and allowed open-path reversal.
- Emitted G-code after optimization still has no laser-on travel and preserves safe mode boundaries.
- Preview toolpath equals `buildToolpath(prepareOutput(project).job)` for settings on and off.

This avoids breaking the current burn path while adding controls.

### P1: Add a Project-Level Settings Model

Create a pure settings module, likely:

```ts
export type OptimizationSettings = {
  readonly enabled: boolean;
  readonly orderByLayer: true;
  readonly cutInnerShapesFirst: boolean;
  readonly reduceTravelMoves: boolean;
  readonly optimizeOpenPathDirection: boolean;
};
```

Recommended defaults:

```ts
export const DEFAULT_OPTIMIZATION_SETTINGS = {
  enabled: true,
  orderByLayer: true,
  cutInnerShapesFirst: true,
  reduceTravelMoves: true,
  optimizeOpenPathDirection: true,
} as const;
```

Why defaults are true:

- They preserve current LaserForge output.
- They avoid surprise output changes when opening existing `.lf2` files.
- They match the practical intent of the current optimizer.

Where to store:

- Add `optimizationSettings` to `Project`, not `Scene`, `Layer`, `Job`, `ui-store`, or save-only options.
- `Project` is persisted. `Job` is a pure derivation and should remain unpersisted.
- `ui-store` should only hold ephemeral dialog open/closed state.

Schema approach:

- Use the existing additive-with-default pattern in `deserialize-project.ts`.
- Add optional shape validation in `project-shape-validator.ts`.
- A schema version bump is not required if missing settings backfill to current behavior, but an ADR should state that older builds will ignore new settings.

### P2: Thread Settings Through the Output Seam

Change:

```text
prepareOutput(project)
  -> optimizePaths(placed, project.optimizationSettings)
```

Add:

- `optimizePaths(job, settings = DEFAULT_OPTIMIZATION_SETTINGS)`
- `enabled=false` returns the job in compiled order.
- `reduceTravelMoves=false` disables nearest-neighbor travel reordering.
- `cutInnerShapesFirst=false` disables containment-depth bucketing.
- `optimizeOpenPathDirection=false` disables open path reversal.

Important wording:

The first implementation should not promise exact LightBurn "drawn order." It should say "compiled layer/object order" or "layer order, no cut-path optimization" until LaserForge tracks object creation order and cross-layer draw order precisely.

### P3: Add a Small Dialog Near Job Controls

Place the UI near the Laser/job workflow, because LightBurn exposes Optimization Settings from the Laser window and because the setting affects output/start behavior.

Recommended components:

- `src/ui/optimization/OptimizationSettingsDialog.tsx`
- `src/ui/optimization/OptimizationSettingsButton.tsx`
- small `ui-store` fields for dialog open/close only
- a project-store action such as `setOptimizationSettings(patch)`

Do not put these controls into each `LayerRow`; the settings are global output planning, not per-layer cut settings.

Dialog v1:

- Enable optimization
- Cut inner shapes first
- Reduce travel moves
- Optimize open path direction, if we decide the wording is clear enough
- Disabled future options listed as "not yet supported" only if useful, otherwise leave them out.

Safety/UI rules:

- Do not let the dialog cover or block Stop during an active job.
- Disable edits while streaming, paused, errored recovery, framing, jogging, homing, or autofocus is active.
- If a job is already prepared/streaming, settings changes affect future output only.
- Changing these settings should mark the project dirty and be undoable because they change emitted G-code.

### P4: Add Preview Evidence

Use the existing Preview, not a separate optimizer preview. Add a compact status badge such as:

```text
Optimization: on, layer order, inner-first, reduce travel
```

Optional later:

- show cut-order numbers for a capped number of segments
- show travel distance before/after for selected vector-only jobs

Do not add this until tests prove Preview, Save, Start, and Estimate all use the same prepared job.

### P5: Defer Advanced LightBurn Parity

Defer these until the underlying model exists:

- Group ordering
- Priority ordering
- Remove overlapping lines
- Best start point for closed loops
- Choose corners
- Choose best direction for closed loops
- Reduce direction changes
- Hide backlash
- Direction-order cuts
- Full 2-opt
- Fill/Raster travel optimizations
- Flood Fill

Reasons:

- Group/Priority require scene metadata that does not exist.
- Remove-overlap is geometry surgery, not simple ordering. It can accidentally remove intentional repeated passes or layered duplicate cuts.
- Backlash and direction tuning require hardware proof, not just code tests.
- Flood Fill belongs to Fill settings, not Optimization Settings.
- Full 2-opt can become expensive and needs a worker or careful cap before exposing it on large traces.

## Verification Plan

### Unit Tests

- `src/core/job/optimize-paths.test.ts`
  - settings defaults preserve current behavior
  - disabled preserves compiled order
  - fill/raster pass-through
  - cut-inner toggle
  - reduce-travel toggle
  - open-path reversal toggle
  - deterministic output
  - canonical cut-geometry preservation

- `src/io/gcode/prepare-output.test.ts`
  - project settings route into optimizer
  - default project output unchanged
  - disabled optimization affects prepared job
  - over-budget raster preflight still blocks before compile/optimization

- `src/ui/workspace/draw-preview.parity.test.ts`
  - preview equals prepared output for settings on and off

- Project IO tests
  - new project includes defaults
  - old `.lf2` missing optimization settings backfills defaults
  - partial/malformed optimization settings validate or normalize correctly
  - save/load roundtrip preserves settings

- Store/UI tests
  - changing settings marks project dirty
  - undo/redo works
  - dialog Apply/Cancel behavior
  - dialog disabled during active job/motion states

### G-code Safety Tests

- No laser-on travel after optimization.
- `M3`/`M4` mode boundaries are preserved.
- `S0`/`M5` safety transitions are preserved.
- Coordinates remain in bed bounds.
- Fill/raster emitted bytes are unchanged unless a setting explicitly targets them.

### Hardware Proof

Run on scrap material:

1. Nested inner/outer contour fixture.
2. Bad-order line-cut fixture.
3. Mixed raster/fill/cut fixture.
4. Custom-origin fixture.
5. Large trace above optimizer cap.

Capture:

- `.lf2`
- emitted G-code
- Preview screenshot
- controller `$30`, `$31`, `$32`
- material, speed, power, passes
- before/after burn photos
- measured dimensions

Pass criteria:

- Inner contours cut before outer shells.
- No travel burn marks.
- No unexpected missing/double-cut geometry.
- Preview order matches burn order.
- Fill/raster alignment does not move when optimization settings change.

## Final Recommendation

Build Optimization Settings in this order:

1. Strengthen optimizer tests.
2. Add project-level `OptimizationSettings` with defaults preserving current output.
3. Thread settings through `prepareOutput`.
4. Expose only real toggles in a small Laser-window dialog.
5. Add preview parity and G-code safety tests.
6. Defer full LightBurn parity until group, priority, overlap removal, and backlash models exist.

This follows the useful version of Karpathy's rule for this codebase: make the hidden state explicit, make the smallest behavior switch testable, and never present a control that is not backed by real verified behavior.
