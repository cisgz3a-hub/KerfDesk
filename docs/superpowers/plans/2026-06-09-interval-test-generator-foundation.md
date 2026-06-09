# Interval Test Generator Foundation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Keep this slice pure-core. Do not add UI, presets, labels, or dithered-gradient raster swatches in this patch.

**Goal:** Add a pure Interval Test scene generator that creates simple-fill swatches with varied line interval / hatch spacing.

## Research Anchor

- LightBurn's Interval Test calibrates engraving line spacing for a specific speed/power/material combination. Interval is the distance between raster/fill scan lines, too high leaves gaps, too low overlaps and increases burn time: <https://docs.lightburnsoftware.com/Tools/IntervalTest.html>
- LightBurn's Interval Test settings are Speed, Power, Min/Max Interval, Steps, Size, and Simple Fill or Dithered Image. This foundation implements the documented Simple Fill mode first because LaserForge already models simple filled swatches as `fill` layers with `hatchSpacingMm`: <https://docs.lightburnsoftware.com/Tools/IntervalTest.html>
- LightBurn's own workflow runs Preview, Frame, then Start after generation. LaserForge should keep the generated test as a normal `Scene` so existing Preview, Frame, Save G-code, and Start gates stay shared.

## LaserForge Mapping

- One swatch = one closed square `ImportedSvg`.
- One interval = one `fill` layer with constant speed/power and varying `hatchSpacingMm`.
- `generateIntervalTestGrid(options)` returns a normal `Scene` plus cell metadata.
- Emit order should start with the lowest-risk interval, meaning the largest interval first, because it produces fewer hatch rows at the same speed/power.

## Tasks

### Task 1: Red Tests

- [x] Generator creates one fill layer and one closed square object per step.
- [x] Layers carry constant speed/power and varied `hatchSpacingMm`.
- [x] Generator clamps invalid counts and intervals without creating impossible scenes.
- [x] Compiled output starts from the largest interval swatch.

### Task 2: Implementation

- [x] Add `src/core/job/interval-test-grid.ts`.
- [x] Export generator and types from `src/core/job/index.ts`.
- [x] Keep constants named and local to the generator.
- [x] Reuse scene primitives instead of adding schema or UI state.

### Task 3: Verify

- [x] Run focused interval generator tests.
- [x] Run typecheck, lint, format, file-size, full tests, and build.
- [x] Audit the diff for scope drift.
- [x] Commit and push after verification passes.

## Non-Goals

- No Interval Test dialog yet.
- No labels yet.
- No dithered-gradient image swatches yet.
- No Material Library persistence.
- No hardware usefulness claim until a scrap burn verifies the generated grid.
