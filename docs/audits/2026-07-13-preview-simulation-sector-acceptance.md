# KerfDesk Preview, Simulation, and Estimates Sector Acceptance

**Date:** 2026-07-13

**Baseline:** 2026-07-11 competitive audit, shipped sector score **8.0/10**

**Candidate stack:** PR #58 through PR #79 + `codex/preview-9-acceptance`

**Status:** Software candidate complete; not yet shipped on `main`

## Verdict

The stacked candidate earns **9.1/10** for Preview, Simulation, and Estimates. The score is based on
observed output parity, acceleration-aware estimates, calibrated machine profiles, adversarial
laser/raster/CNC fixtures, and a real Chromium workflow. It does not claim that software tests prove
physical timing accuracy; representative machines still require measured correlation runs.

## Competitive Boundary

LightBurn's Preview displays the exact route sent to the laser, traversal moves, cut and rapid
distance/time, total time, a time slider, and playback from 0.1x to 40x. Its device settings expose
acceleration and speed-scale controls for timing correction:
[LightBurn Preview](https://docs.lightburnsoftware.com/latest/Reference/Preview/) and
[Additional Settings](https://docs.lightburnsoftware.com/latest/Reference/DeviceSettings/AdditionalSettings/).

Easel's Simulate workflow combines visualized toolpaths with a completion estimate that responds to
tool and cut-setting changes:
[Easel Time Estimates and Toolpaths](https://support.easel.com/hc/en-us/articles/360012453134-Time-Estimates-and-Toolpaths).

VCarve provides video-like toolpath playback, 3D material removal, per-toolpath and total estimates,
rapid-rate configuration, and a measured-job scale factor:
[VCarve Preview Toolpaths](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/Preview%20Toolpaths/index.html)
and
[VCarve Estimating Machining Times](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/Toolpaths%20Summary/index.html).

## Evidence

| Capability | Candidate evidence | Result |
| --- | --- | --- |
| Output parity | Preview consumes the same prepared job as Save, Start, Frame, and Estimate | Accepted |
| Evaluated-job parity | Variable text, selected output, job origin, and print-and-cut registration use the shared asynchronous snapshot | Accepted |
| Laser route | Cut, fill, image sweeps, overscan, blanked gaps, passes, tabs, kerf, layer order, and optimized travel are represented | Accepted |
| CNC route | Retract, rapid, plunge, contour, native arc, helical entry, pass depth, and tool-change ordering are represented | Accepted |
| Route controls | Scrubber, play/pause, restart, traversal toggle, endpoints, head marker, and CNC previous/next pass | Accepted |
| Time-aware playback | Estimated cut and travel time drive route pacing at 1x, 10x, or 40x instead of a fixed animation duration | Accepted |
| Job statistics | Cut, travel, plunge, total distance, total time, cut time, and travel time are visible in Preview | Accepted |
| Motion physics | Per-edge GRBL-style acceleration, junction deviation, lookahead, raster sweeps, CNC plunge/retract, and machine feed limits | Accepted |
| Machine calibration | Independent cut and travel correction factors persist in `.lf2` and `.lfmachine.json`; 1.00 preserves legacy estimates | Accepted |
| Output isolation | Timing calibration affects simulation only and cannot change emitted feed rates or machine motion | Accepted |
| CNC result simulation | Scrubbable 2D removal plus orbitable 3D stock-removal result | Accepted |
| Imported G-code | `.nc`, `.gcode`, and `.tap` can be parsed into the preview simulator; own-export removal agrees at the tested tolerance | Accepted |
| Failure visibility | Empty output, unavailable placement, out-of-bounds content, excessive geometry, and unavailable 3D rendering are explicit | Accepted |
| Performance safety | Cheap pre-counts and bounded raster/removal grids prevent synchronous preview work from consuming unbounded resources | Accepted |
| Real-browser workflow | Edit both calibration factors, open Preview, observe the time breakdown, save, and inspect persisted values | Accepted |

## Verification

- TypeScript: passed.
- Focused ESLint: passed.
- Preview-sector battery: **23 files, 131 tests passed**.
- Persistence and UI battery: **8 files, 83 tests passed**.
- Chromium acceptance: timing calibration and Preview breakdown workflow passed.
- Full repository release gate: passed on the final diff in **503.6 seconds**.

## Why 9.1

The candidate supports the complete preflight inspection loop for both machine families: inspect the
actual prepared route, understand operation order and non-cutting motion, scrub or play the job,
inspect CNC depth removal, see useful distance and time breakdowns, tune estimates to a specific
machine without changing output, reject unsafe or unbounded previews, and reopen externally emitted
CNC programs. The same evaluated geometry feeds Preview and execution, which is the most important
trust contract in this sector.

The score remains below a perfect result because physical timing correlation has not been repeated
across the Falcon and two representative routers, playback apportions each aggregate cut/travel
category by distance rather than reproducing every controller planner tick, and imported G-code
simulation intentionally supports a safe modal subset instead of every vendor macro.

## Score Boundary

- **Shipped `main`: 8.0/10** until the stacked candidate merges and the acceptance suite passes on
  the resulting `main` revision.
- **Stacked software candidate: 9.1/10** after the full release gate passes.
- Physical timing runs remain required for hardware-level confidence and do not become complete from
  this software score.
