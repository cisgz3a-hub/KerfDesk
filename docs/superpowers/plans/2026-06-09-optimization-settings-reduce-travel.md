# Optimization Settings Reduce Travel Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Keep this slice honest: expose only the optimization LaserForge already implements. Do not add inner-first, priority, direction-order, backlash, overlap removal, or material-library behavior in this patch.

**Goal:** Add a LightBurn-style Optimization Settings entry point with one real setting: Reduce travel moves.

## Research Anchor

- LightBurn Optimization Settings controls cut order and pathing. Its default includes Order by Layer and Reduce travel moves, and the Preview window is used to inspect the effect: <https://docs.lightburnsoftware.com/OptimizationSettings.html>
- LightBurn describes Reduce travel moves as ordering cuts by proximity to reduce non-cutting travel. LaserForge already implements nearest-neighbor travel reduction in `optimizePaths`, preserving layer order.
- LaserForge's `prepareOutput` is the shared path for Preview, Save, Start, and live estimate. The setting must feed that shared path, not only one consumer.

## Tasks

### Task 1: Red Core Tests

- [x] `prepareOutput` defaults to the current optimized behavior.
- [x] `prepareOutput` preserves compiled/user order when `project.optimization.reduceTravelMoves` is `false`.
- [x] Old `.lf2` files without `optimization` deserialize with `reduceTravelMoves: true`; malformed values are rejected or normalized safely.

### Task 2: Core Implementation

- [x] Add `ProjectOptimizationSettings` with default `{ reduceTravelMoves: true }`.
- [x] Normalize older projects and validate the optional saved shape.
- [x] Route `prepareOutput` through `optimizePaths` only when the setting is enabled.

### Task 3: Red UI Tests

- [x] Command registry exposes `tools.optimization-settings`.
- [x] Store action updates the project optimization setting, marks dirty, and supports undo.
- [x] Dialog renders Reduce travel moves and submits the checkbox state.

### Task 4: UI Implementation

- [x] Add `OptimizationSettingsDialog.tsx`.
- [x] Add store action to update project optimization settings.
- [x] Wire a Tools menu command to open the dialog.

### Task 5: Verify

- [x] Run focused core/store/dialog/command tests.
- [x] Run typecheck, lint, format, file-size, full tests, and build.
- [x] Browser-smoke the local app side-effect-free.
- [x] Commit and push after verification passes.

## Non-Goals

- No full LightBurn Optimization Settings parity claim.
- No cut-inner-shapes-first until containment is reliable and tested.
- No priority/group ordering until object priority/group model exists.
- No Material Library or preset storage in this slice.
