# Material Test Dialog Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Keep this slice UI-only plus one store action; do not expand into Material Library or Interval Test.

**Goal:** Expose the pure Material Test grid generator through a minimal Tools menu workflow.

## Research Anchor

- LightBurn opens Material Test from Laser Tools, lets operators configure grid parameters, and can Preview/Frame/Start/Save generated output. LaserForge's first UI slice inserts the generated grid into the normal scene so existing Preview, Frame, Start, and Save G-code paths remain shared: <https://docs.lightburnsoftware.com/Tools/MaterialTest.html>
- LightBurn Material Library is separate Assign/Link preset storage and remains deferred: <https://docs.lightburnsoftware.com/UI/MaterialLibrary.html>

## Tasks

### Task 1: Red Tests

- [x] Command registry exposes `tools.material-test` and runs it through the dirty-project guard.
- [x] Store action replaces the scene with a generated scene, clears selection, pushes undo, and marks dirty.
- [x] Dialog renders the main grid fields and calls `onGenerate` with parsed values.

### Task 2: Implementation

- [x] Add `tools.material-test` to the command registry and command shell callbacks.
- [x] Add a focused generated-scene store action.
- [x] Add `MaterialTestDialog.tsx` with defaults for rows, columns, speed, power, and cell size.
- [x] Wire Generate to `generateMaterialTestGrid` and close the dialog.

### Task 3: Verify

- [x] Run focused command/store/dialog tests.
- [x] Run typecheck, lint, format, file-size, full tests, and build.
- [x] Browser-smoke the local app side-effect-free.
- [x] Commit and push after verification passes.

## Non-Goals

- No labels yet.
- No Interval Test yet.
- No direct Start/Frame controls in the dialog yet.
- No presets, Material Library storage, Assign, or Link.
- No hardware usefulness claim until a scrap burn verifies the generated grid.
