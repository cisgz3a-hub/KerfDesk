# Performance audit S1: speed and memory

**Requested:** the maintainer, on 2026-11-02: "design another loop for speed and performance".

**Status:** done 2026-11-06. Approved 2026-11-02 ("yes go"); paused after S3 for the new-user experience audit; resumed at S4 on 2026-11-03. All nine areas ledgered: P1 3 / P2 16 / P3 27. See [LEDGER.md](LEDGER.md#round-result-2026-11-06).

**How this differs from the rolling rounds:** like [Q1](../2026-10-27-quality-q1/AREAS.md), this round measures as well as finds defects. Each area produces:
- a scorecard with one row per operation: input size | median and worst time | longest UI block | peak memory | budget | verdict;
- findings, with auditor, fresh refuter and coordinator re-check as usual;
- a ranked list of the slowest things an ordinary user meets, by how often they meet them rather than by how large the number is.

Finding IDs are `S<area>-P<n>-<k>`. Temp files are `zz-s<N>-*`, and refuter files `zz-s<N>r-*`.

## The rule every speed fix must keep

**A speed fix may not change the burn.** It must prove that compiled G-code is byte-identical on the fixture set. Any fix that simplifies geometry, lowers resolution or adds a limit is a product decision for the maintainer, with its own ADR. It is not a performance fix. This continues ADR-598 and the 2026-09-09 canvas work, which moved work between threads without changing output.

## Budgets (approved 2026-11-02; the maintainer can change them)

| Moment | Budget | Why |
|---|---|---|
| Click, key or typed value to visible response | 100 ms | Feels instant |
| Pan, zoom or drag at 5,000 objects | 33 ms per frame at p95 | About 30 frames a second |
| Longest UI block while designing | 200 ms, or a progress bar and Cancel if the work can take longer | The app must not look hung |
| Longest UI block while a job runs | 50 ms | Abort, status and any window-side streaming share this thread |
| Autosave pause while drawing | 50 ms | It repeats every 30 s |
| Desktop cold start to a usable canvas | 3 s | First impression |
| Web first load to a usable canvas | 3 s on a cached visit; measured and reported on a first visit | Service worker and download differ |
| 2,000-object project, Open and Preview | Open 5 s, Preview 8 s | `e2e/performance.spec.ts` allows only 15 s and 20 s, so it would not notice a doubling |
| Peak memory on a 2,000-object project | 1.5 GB for the whole app | The maintainer's own PC is short of memory |

## Severity

- **P1:** slowness that harms a job or loses work, with no warning. A UI block that delays Abort or leaves the beam lit while a job runs; a crash or out-of-memory that loses work; a job the app cannot finish streaming.
- **P2:** a freeze of 5 s or more on ordinary-sized input with no progress or Cancel; an ordinary operation over three times its budget; a slowdown of two times or more since 1.0.23 with no reason in an ADR.
- **P3:** any other budget miss, poor scaling that ordinary input does not reach, or a missing guard or benchmark.

A freeze on input only a hostile file could produce is judged under METHOD's trust-boundary lens instead, and security holds apply.

## Measurement rules

Numbers on a loaded PC mislead, so these rules bind auditors and refuters alike.

1. **One measuring agent at a time, and no other audit agent running.** This is stricter than the two-agent limit of the rolling rounds. Fix sessions and local test suites also disturb it, so each report records what else was running.
2. **Measure the production build,** never the Vite dev server. Desktop figures use the packaged app where the area needs it.
3. **Discard the first run, and report the median of five** plus the worst. Record free memory and CPU load before each set.
4. **Normalise.** Run a fixed calibration loop before and after each set, and report results as ratios as well as milliseconds. Throw away a set if calibration drifts by more than 15%.
5. **Same machine for comparisons.** Compare main against 1.0.28 (`33bc394c6`) and 1.0.23 (`87ecb4f24`) in the same sitting, using exports kept outside the repro tree.
6. **Fixed inputs only:** the synthetic cases in `scripts/large-file-benchmark-cases.mjs` (50,000 SVG paths, a 4096 × 4096 image), and generators named in the report. No private artwork.
7. **Ordinary sizes first.** Every area measures an everyday size and a large one (for example 200 and 5,000 objects), so a good large-file number cannot hide a bad everyday one.
8. **Never operate hardware.** Job and streaming areas use simulated controllers.

Existing tools to reuse before writing new ones: `scripts/performance-audit/` (`startup-probe`, `hotpath-probe`, `large-trace-canvas-*`, `interaction.e2e.ts`, `packaged-canvas-observer`, `nesting-probe`), `scripts/large-file-bench.mjs`, `scripts/large-file-browser-bench.mjs`, `scripts/trace-bench.mjs`, `scripts/benchmark-cnc-leaders.mjs`, `scripts/benchmark-quantity-nesting.mjs`, and the `*.perf.test.ts` files.

## Areas (run order)

| # | Area id | What to measure | Known leads | Where it starts |
|---|---|---|---|---|
| S1 | `running-job` | UI blocks during a job on every transport; Abort latency; Marlin and network stream throughput against what the controller can take; status, Preview and canvas work during a job; a long job (2M lines) start to finish | K1 and K2 family (#1500, #1515, #1527); J10-P3-2 (Abort regex-scans the queued program, 132 ms at 1M lines) | First, because it is the only area where slowness can harm a burn |
| S2 | `canvas-interaction` | Pan, zoom, drag, marquee, hover glow and handles at 200 / 5,000 / 50,000 objects; a large trace; dense Fill clusters; canvas with an image | N6-P3-3 (Fill pools 413–681 ms a frame at 5,000 overlapping circles, against 50–111 ms before #1511; re-measure after #1526); `canvas-large-artwork-performance-2026-09-09.md` | `hotpath-probe`, `large-trace-canvas-*`, `interaction.e2e.ts` |
| S3 | `save-open-import` | Open, Save and autosave pause; SVG, DXF, `.lbrn`, PDF, images and TIFF; paste; Undo cost and memory | J10 (#1488); `.lbdev` quadratic lookup; `large-file-bench` | `large-file-bench`, `large-file-browser-bench` |
| S4 | `compile-preview` | Compile, Preview and ETA for laser Line, Fill and image at both sizes; Start's preparation time; repeat runs on an unchanged project, which should reuse work | ADR-598, ADR-346; Fill hatching and image-mask perf tests | `*.perf.test.ts`, `e2e/performance.spec.ts` |
| S5 | `trace-image` | Trace time per preset against Potrace 1.16 (test-only) on the Q4 and Q5 sets; Image Studio sliders; dithers; On material preview at 4096 × 4096 and 16 MP | Q5-P3-3 (the cooperative fallback blocks 122–340 ms); #1401; the goal "better than Potrace" now covers quality, so this adds speed | `trace-bench`, `zz-q4`, `zz-q5` |
| S6 | `geometry-commands` | Offset, Weld, Boolean, Optimize Shapes, node edits on a 5,000-node path, align, array, nesting; tight bounds (ADR-677) | N3-P3-1 (Offset: 100 concentric rings 6.6–10 s against 0.11 s before #1501; 300 rings 301 s) | `nesting-probe`, `benchmark-quantity-nesting` |
| S7 | `text` | Typing in a text box, shrink-to-fit frames, variable records, font loading | N4-P3-2 (a 500-character frame blocks the UI 11–17 s on remote and jig edits); a 2,000-character frame takes 70–81 s; ADR-643 | ADR-643's text worker |
| S8 | `cnc-toolpaths` | Adaptive, V-carve, relief, pocket and rest toolpaths at ordinary and large sizes; height-field memory; the 3D preview's frame rate; Cancel reaching the worker promptly | ADR-154, ADR-412 | `benchmark-cnc-leaders` |
| S9 | `startup-memory` | Desktop and web cold start; bundle and chunk sizes; a one-hour scripted session (draw, trace, Preview, Undo) for leaks; workers retired; behaviour with under 1 GB free | ADR-598 budgets; `tsc` and local suites already run out of memory on this PC | `startup-probe`, `packaged-canvas-observer` |

## Machine job time

"Speed" also means how long a burn takes. S4 therefore also reports, for a fixed set of jobs: travel distance against a simple lower bound, time lost to overscan and to the cut order, estimate against a modelled controller, and G-code size. A shorter route must not change the order rules an ADR sets, such as inner shapes before outer ones. Any route change is a burn change, so it goes to the maintainer as a decision, not a fix under the rule above.

## Round result

The ledger totals are joined by:
1. **A top ten** of what to speed up first, ranked by how often a user meets it, how long it takes, and how hard the fix looks.
2. **A trend table:** main against 1.0.28 and 1.0.23 for every scorecard row.
3. **A guard proposal:** the smallest set of benchmarks that belong in CI and the budgets they should hold. Today only one browser test has a time budget, and CI runner timings vary, so the proposal uses ratios or operation counts where it can.

## Fix cards

Each brief states the budget it must reach and shows before and after numbers taken under the rules above. It proves byte-identical G-code, tests every sibling route, and adds a regression guard when one can be made stable.
