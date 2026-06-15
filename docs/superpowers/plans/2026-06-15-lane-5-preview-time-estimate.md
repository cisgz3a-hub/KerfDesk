# Lane 5B - Preview Total Time Estimate

Date: 2026-06-15
Repo: LaserForge-2.0
Status: implementation slice

## Research Baseline

LightBurn's Preview window shows job time statistics under the time slider:
cut distance/time, rapid distance/time, and total estimated time. The same
Preview documentation says Preview settings only affect the Preview window and
do not change laser output.

Sources:

- <https://docs.lightburnsoftware.com/2.1/Reference/Preview/>

## Slice Boundary

Add the existing LaserForge live total time estimate to the Preview stats panel.

In scope:

1. Display total estimated time when the existing estimator returns one.
2. Display a clear "large job" or empty-state label for existing estimator
   states.
3. Keep preview distance stats from Lane 5A unchanged.

Deferred:

- Cut-time and rapid-time breakdowns.
- Playback speed.
- Play button.
- Start Here.
- Save Preview Image.
- Shade According to Power.
- Any change to planner math, G-code output, preflight, serial, or streaming.

## Architecture

- Reuse `useJobEstimate()` / `LiveJobEstimate` so Preview uses the same
  estimate truth already used by the Start Job controls.
- Pass the estimate into `PreviewStatsPanel`.
- Keep the panel a pure display surface plus the traversal visibility toggle.

## Tests

1. Preview stats panel renders estimated time when provided.
2. Preview stats panel renders a clear large-job label when the existing
   estimator reports `too-large`.
3. Existing focused toolpath and preview tests stay green.

## Audit Notes

This slice is preview-only. It must not touch `prepareOutput` behavior,
emitted G-code, bounds checks, serial writes, streaming, or controller state.
