# Material Test Generator Foundation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development for the generator and superpowers:verification-before-completion before commit/push.

**Goal:** Add the first pure LightBurn-style Material Test generator foundation without UI, hardware control, or Material Library storage.

**Research Anchor:**

- LightBurn Material Test is a generated grid that can vary Power, Speed, Interval, or Passes, defaults to a 10x10-style grid, and follows Start From / Job Origin placement: <https://docs.lightburnsoftware.com/Tools/MaterialTest.html>
- LightBurn Interval Test is a separate calibration tool for raster line interval after speed/power are known: <https://docs.lightburnsoftware.com/Tools/IntervalTest.html>
- LightBurn Material Library stores reusable presets with Assign vs Link behavior, so LaserForge defers it until generated test grids are hardware-proven: <https://docs.lightburnsoftware.com/UI/MaterialLibrary.html>

## Architecture

- Add `src/core/job/material-test-grid.ts`.
- Return ordinary `Scene` data so Preview, Save G-code, Frame, and Start can share the existing pipeline.
- Represent speed as one fill-mode layer per row.
- Represent power as per-cell `SceneObject.powerScale` against the row layer's maximum power.
- Emit lowest-risk cells first: fastest row first, lowest-power column first.
- Keep labels out of this slice. Text labels need font materialization and can be added in the UI-backed slice after the pure grid is stable.

## Tasks

### Task 1: Red Core Tests

- [x] Test that a 2x3 grid produces two fill layers and six closed-square objects.
- [x] Test that row speeds are fastest-to-slowest and column powers are lowest-to-highest via `powerScale`.
- [x] Test that compiling the generated scene emits the first fill group at fastest speed and lowest power.
- [x] Run the focused test and confirm the module is missing.

### Task 2: Minimal Generator

- [x] Implement deterministic grid validation/clamping.
- [x] Generate row colors, layers, square objects, and metadata.
- [x] Export the generator from `src/core/job/index.ts`.

### Task 3: Verify

- [x] Run focused generator tests.
- [x] Run typecheck, lint, format, file-size, full tests, and build.
- [x] Browser-smoke the local app side-effect-free.
- [x] Commit and push after verification passes.

## Non-Goals

- No dialog or toolbar/menu item yet.
- No text labels yet.
- No Interval Test generator yet.
- No Material Library storage, Assign/Link behavior, or preset files yet.
- No claim of useful settings until a supervised scrap-material burn verifies a generated grid.
