# Interval Test Dialog Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:test-driven-development. Keep this slice UI insertion only. Do not add labels, direct Start/Frame controls, presets, or dithered-image swatches in this patch.

**Goal:** Expose the pure Interval Test generator through a minimal Tools menu workflow.

## Research Anchor

- LightBurn opens Interval Test from Laser Tools and varies line interval for a chosen speed/power/material combination: <https://docs.lightburnsoftware.com/Tools/IntervalTest.html>
- LightBurn's generated tests then use normal Preview, Frame, Start, and Save flows. LaserForge should insert the generated interval scene into the normal workspace so existing Preview, Frame, Start, and Save G-code paths remain shared.

## Tasks

### Task 1: Red Tests

- [x] Command registry exposes `tools.interval-test` and runs it through the dirty-project guard.
- [x] Dialog renders interval controls and calls `onGenerate` with parsed values.

### Task 2: Implementation

- [x] Add `tools.interval-test` to the command registry and command shell callbacks.
- [x] Add `IntervalTestDialog.tsx` with defaults for steps, speed, power, interval min/max, swatch size, and gap.
- [x] Wire Generate to `generateIntervalTestGrid`, replace the scene, close the dialog, and toast success.
- [x] Reuse shared calibration field/styles.

### Task 3: Verify

- [x] Run focused command/dialog tests.
- [x] Run typecheck, lint, format, file-size, full tests, and build.
- [x] Browser-smoke the local app side-effect-free.
- [x] Commit and push after verification passes.

## Non-Goals

- No labels yet.
- No direct Start/Frame controls in the dialog yet.
- No dithered-gradient image swatches yet.
- No Material Library persistence.
- No hardware usefulness claim until a scrap burn verifies the generated interval grid.
