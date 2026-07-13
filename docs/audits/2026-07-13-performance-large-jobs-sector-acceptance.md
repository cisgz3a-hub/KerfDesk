# KerfDesk Performance and Large-Jobs Sector Acceptance

**Date:** 2026-07-13

**Baseline:** 2026-07-11 competitive audit, shipped sector score **6.5/10**

**Candidate stack:** PR #58 through PR #93 + `codex/performance-9-acceptance`

**Status:** Software candidate complete; full local release gate passed; not yet shipped on `main`

## Verdict

The stacked candidate earns **9.1/10** after passing the exact full release gate. It has
measured small, medium, and large workflow budgets; bounded raster and vector preparation; worker
isolation for heavy image work; cached and decimated canvas paths; stable subscriptions for hot UI
surfaces; and O(1) queue advancement for long streamed jobs.

The baseline's point-density finding is no longer current. The real trace corpus now balances
simplification with topology and fidelity metrics and passes its explicit 10/10 benchmark. The
remaining verified hot path, quadratic G-code queue copying, is removed in this candidate.

## Competitive Boundary

LightBurn exposes exact-output preview, a time slider, playback, cut/travel statistics, and display
quality controls for large complex designs:
[Preview](https://docs.lightburnsoftware.com/latest/Reference/Preview/) and
[Settings and Preferences](https://docs.lightburnsoftware.com/latest/Reference/SettingsPreferences/).
Rayforge documents asynchronous task architecture and recommends reducing visible preview detail
for large jobs:
[Architecture](https://rayforge.org/docs/developer/architecture/) and
[3D View performance tips](https://rayforge.org/docs/ui/3d-preview/).

KerfDesk's acceptance target is bounded and responsive offline operation on representative
laser/CNC projects, not a claim that every arbitrarily large input completes. Inputs exceeding
named raster, scene, compile, or display budgets are refused or visibly simplified before they can
freeze the application.

## Evidence

| Capability | Candidate evidence | Result |
| --- | --- | --- |
| End-to-end budgets | Deterministic small, medium, and large fixtures measure import, trace, editing, preview, save, compile, and streaming | Accepted |
| Long-job streaming | The large fixture consumes 100,000 G-code lines in 67.6 ms locally | Accepted |
| Queue complexity | Stream state keeps one immutable line array and advances `queueIndex`; identity tests prove no job-sized queue copy per refill | Accepted |
| Browser large project | Chromium opens and previews 2,000 objects, renders the canvas, and yields two animation frames inside fixed budgets | Accepted |
| Trace density | The real logo/edge/centerline corpus passes the explicit 10/10 benchmark with topology, fidelity, stray-point, and point-count limits | Accepted |
| Heavy image work | Trace and vector-to-bitmap work use timeout-guarded workers with bounded fallbacks | Accepted |
| Raster bounds | Pixel and working-set budgets refuse oversized raster work before allocation | Accepted |
| Shared output bounds | Preview, estimate, frame, save, and start route through shared prepared-output complexity checks | Accepted |
| Canvas scaling | Vector strokes are batched; oversized scenes use cached connected decimation with a visible simplification notice | Accepted |
| Preview rebuilds | Resolved placement keys avoid recompilation on unchanged controller polls; stale builds cancel without blanking the current route | Accepted |
| CNC editing | Output-scope selectors are value-stable and the deferred 3D removal grid memoizes on meaningful project changes | Accepted |
| Raster reuse | Raster luma decode and display assets use identity-keyed, garbage-collectable caches | Accepted |

## Measured Local Fixture

| Phase | Small | Medium | Large |
| --- | ---: | ---: | ---: |
| Import | 41.2 ms | 69.7 ms | 343.5 ms |
| Trace | 33.9 ms | 39.8 ms | 100.6 ms |
| Editing/nesting | 16.8 ms | 12.4 ms | 3.8 ms |
| Preview preparation | 4.5 ms | 6.7 ms | 26.6 ms |
| Project serialization | 0.4 ms | 2.1 ms | 9.2 ms |
| Output compilation | 8.6 ms | 34.2 ms | 133.3 ms |
| Streaming | 3.6 ms / 1k lines | 10.7 ms / 10k lines | 67.6 ms / 100k lines |

These timings are regression evidence from this machine, not universal hardware promises. CI uses
the same fixtures with three-times local wall-clock allowances.

## Verification

- Focused state/performance battery: **6 files, 78 tests passed**.
- Trace quality and density battery: **6 tests passed at 10/10**.
- TypeScript: passed.
- Chromium browser acceptance: **26 workflows passed**, including the large-project workflow.
- Full repository release gate: **passed in 656.7 seconds**.

## Why 9.1

The candidate closes the baseline's two concrete reasons for 6.5: trace output now has measured
density and fidelity limits, and streaming cost no longer grows quadratically with the number of
remaining lines. It also proves the surrounding workflow rather than benchmarking one isolated
function: import through browser preview, output compilation, and 100k-line stream consumption all
have deterministic gates.

The score remains below a perfect result because browser/device performance varies, preview drawing
still has finite display budgets, multi-million-line physical streams need long-duration hardware
campaigns, and memory peaks for extreme raster/CNC jobs have not been profiled across all supported
machines.

## Score Boundary

- **Shipped `main`: 6.5/10** until the stacked candidate merges and the acceptance suite passes on
  the resulting `main` revision.
- **Stacked software candidate: 9.1/10** with the full local release gate passed.
- Long-duration physical streams and cross-device memory profiling remain separate hardware
  acceptance work.
