# Speed fixes and measurements — 14 October 2026

This follows the [original audit](2026-10-14-speed-audit.md), using the same checkout base (`03f1da57737ebc58d7cf4e240be6c2225270c690`) and fixtures. Implementation is local on `codex/performance-audit-20261014`. No deployment, package or hardware qualification is included. [ADR-598](../decisions/ADR-598-performance-worker-and-cache-budgets.md) records the memory and ownership decisions. Historical receipt hashes and captured Git status retain its original ADR-597 name; the decision was renumbered to avoid a concurrent PR collision.

## Changes

- Output preparation and CNC design workers transfer packed vector geometry, then reconstruct the complete project in the worker. Queued output requests allocate transfer buffers only when dispatched. Snapshot metadata and emitted output stay exact.
- Manual project Save and trace-part editing take priority in the shared memory lane. Preview/ETA and idle-marker workers retire before yielding, and useful work resumes afterwards. There is still only one active heap in that lane; an active autosave remains non-preemptible.
- Each Preview/ETA consumer owns its cancellation. Closing one view preserves other live consumers; removing the last consumer cancels its work. Late replies and old reservation tokens cannot replace current work.
- Preview joining a running ETA reuses its compilation and estimate. Settled ETA followed by a later Preview still recompiles, deliberately avoiding long-lived compiled geometry.
- Sprite admission keeps a stable useful subset during oversized scans, with the existing pixel budget and a 256-entry metadata bound. Small 9- and 16-object scenes now retain every sprite. Overflow paints directly.
- Nesting validation indexes nearby bounds before applying unchanged exact collision predicates.
- The Design Library catalogue loads on opening its modal, with loading/error dismissal and focus return preserved.

## Actual client dispatch

The new `client-transfer-probe.mjs` runs the real output/design clients in native Chrome. Its baseline compiles the two original client files directly from the audited Git commit. The receiver uses the production unpacker and validates every point and canonical line segment, then returns a small receipt. It does **not** compile or render a job. Three repeated requests follow one cold request per fixture.

| UI-thread client call, warm median | Before | After |
| --- | ---: | ---: |
| Output, 50,000 points | 15.0 ms | 0.6 ms |
| Output, 200,000 points | 68.9 ms | 0.9 ms |
| Output, 1,000,000 points | 505.9 ms | 5.9 ms |
| CNC design, 50,000 points | 15.6 ms | 0.4 ms |
| CNC design, 200,000 points | 64.1 ms | 1.1 ms |
| CNC design, 1,000,000 points | 511.0 ms | 3.8 ms |

The one-million-point output call spends 98.8% less time on the UI thread; design spends 99.3% less. First-time packed calls cost 35.7 ms and 30.6 ms respectively. Receiver unpacking remains real work: warm medians 52.6 ms and 68.3 ms in the worker. Round trips including unpacking and geometry validation fell from 1,149.5 to 75.0 ms and 1,151.3 to 81.4 ms. These are boundary improvements, not whole-program execution speedups.

## Queue and duplicate-work proof

The repeated scheduling audit uses fake workers and a controlled clock, so its times are scheduling evidence rather than wall-clock benchmarks. Previously, withholding a Preview response kept Save queued through 120,000 simulated milliseconds. Save and trace-part editing now dispatch immediately after retiring the background worker, then the original Preview consumers complete on its restarted worker. Peak live workers remains one. ETA-first plus concurrent Preview changes from two compile dispatches to one; Preview-first remains one.

The regression suite also covers repeated preemption, cancellation of a queued restart, multiple independent consumers, scalar ETA retention after a cancelled Preview upgrade, late ETA consumers, stale idle-worker errors, and a synchronous same-key request during lane handoff.

## Nesting and sprite rerun

| Rectangle validation, warm median | Before | After |
| --- | ---: | ---: |
| 1,000 placements | 5.7 ms | 3.08 ms |
| 5,000 placements | 61.8 ms | 10.97 ms |
| 10,000 placements | 243.2 ms | 20.01 ms |

At 10,000 placements this is a 12.2× speedup and a 91.8% reduction. The new three-sample range is 19.57–21.03 ms. The fixture and exact validity assertion are unchanged. The new tests compare decisions with brute-force validation across seeded geometry and tolerance boundaries; indexing never decides validity by itself.

Sprite paint counts over three complete passes changed from `[9, 9, 9]` to `[9, 0, 0]`, and from `[16, 16, 16]` to `[16, 0, 0]`. The eight-object control remains `[8, 0, 0]`. Warm passes measured 0–0.1 ms for these tiny sprites, but paint counts are the main evidence: the probe does not measure GPU completion or full-app FPS. Separate tests cover oversized pixel/entry budgets, stale-entry reclamation, empty passes and failed zoom growth.

The lower-priority multi-anchor editing algorithm is unchanged. Its audit timings are retained as a control; this patch targets the larger confirmed costs.

## Full-app and startup rerun

All four mixed-canvas interaction trials reached rendered readiness. The fourth is CPU-profiled and excluded from the three-sample medians, matching the original audit.

| Full desktop-renderer interaction | Before median | After median | After range |
| --- | ---: | ---: | ---: |
| G-code 3D view rendered ready | 2,228 ms | 2,395 ms | 2,221–4,686 ms |
| Refresh rendered ready | 371 ms | 344 ms | 340–432 ms |
| Initial maximum heartbeat gap | 98.9 ms | 90.7 ms | 77.9–101.7 ms |
| Initial longest Long Task | 72 ms | 57 ms | 55–66 ms |

Refresh is 7.3% lower in this small sample, but initial readiness is 7.5% higher and the first new trial is a clear slower sample. It is retained, not discarded. These results do not establish a general end-to-end speedup. The development renderer still includes worker/module loading and first-use rendering costs. There were no observed Long Tasks during Refresh. The project-copy improvements above use a much larger geometry fixture and isolate the affected boundary.

The existing browser suite passed **9/9 cases**, compared with 8/9 originally. The heavy-canvas initial heartbeat gap was 706.5 ms, below that test's 1,000 ms budget; the longest Long Task was 74 ms. The removal-grid case passed at 963.1 ms maximum heartbeat gap. Passing these relatively loose budgets does not establish smooth frame presentation, and a single rerun does not prove the original intermittent gap is eliminated.

The serial core performance suite passed **32 tests, with one existing skip**. Connected-script compilation/emission took 5,916.5 ms versus 6,003.9 ms, retaining the exact 1,100,098-byte output and SHA-256 `6213711b652de729c1d4c57f905817bf39eab2ef86e8d8a1627f37ba20a6dbc6`. This algorithm fixture is a correctness/control measurement, not a claimed compiler speedup.

| Browser component pipeline, median | Before | After | After range |
| --- | ---: | ---: | ---: |
| 50,000-contour SVG | 5,667 ms | 4,996 ms | 4,689–5,370 ms |
| Embedded sparse 4096² image | 4,844 ms | 4,330 ms | 4,243–4,528 ms |
| Paged sparse 4096² image | 5,475 ms | 7,025 ms | 6,804–7,533 ms |

All pipeline fixture hashes, compiled harness/worker module hashes, and geometry/G-code output hashes match the baseline. These particular component paths are therefore unchanged controls: neither their faster SVG/image samples nor the 28.3% slower paged sample is attributable to changed executable bytes in this patch. The variation reinforces the need for repeated measurements on the target workload; the paged result is retained as a remaining performance concern.

The final production build reached the welcome/workspace surface in a median **1,092 ms** (1,091–1,095 ms), versus 1,169 ms in the original audit: 6.6% lower in this local sample. Initial JavaScript fell from **1,933,805 to 1,917,675 gzip bytes**, a 16,130-byte / 0.83% reduction. Total subresources were 2,075,955 compressed bytes. This remains well above the 1 MB JavaScript target. The shared workbench/core/I/O chunks still dominate, and the offline inventory remains 412 entries / 32,215.77 KiB uncompressed.

The deferred library chunk was absent from initial requests, fetched on opening the library, and rendered successfully. Closing restored focus to its opener. The [final screenshot](./2026-10-14-speed-fixes/startup.library.png) waits for decoded previews and disables their brief opacity transition for capture. Two earlier runs of the same bundle, retained as `startup-first.json` and `startup-image-ready.json`, had medians of 1,077 and 1,083 ms; reruns tightened this visual check only, after the timed phases. Across all nine unprofiled startup samples the range is 1,072.5–1,154.2 ms. No page errors occurred. Each fourth CPU-profiled trial is excluded.

## Verification and remaining work

The final focused runs total **375 passing tests in 61 files, with one existing skip**, plus **13 passing browser cases**. Coverage includes output transfer/detachment and exact G-code, Start/Frame snapshot consistency, ownership and cancellation, one-heap priority, active ETA promotion, sprite bounds, nesting parity, lazy modal failure/focus, existing worker workflows, and core performance controls. Main-project and audit TypeScript checks, changed-code ESLint, formatting, file-size policy, ADR numbering and the web production build passed. This is targeted verification, not the full release gate or the entire repository test suite. The build retains its existing large-chunk and HarfBuzz browser-externalisation warnings.

The largest measured copying and nesting costs, queue starvation by disposable background work, duplicate ETA/Preview compilation, and the reproduced sprite scan eviction are addressed. Cold packing and worker reconstruction still take time. Active autosave cannot be interrupted, and repeated interactive requests may restart background computation. Large sprite overflow still paints directly. A later Preview after an already-settled ETA deliberately recompiles.

Remaining priorities are the startup payload above budget, variable initial 3D readiness, paged-image throughput, and longer-session memory/frame measurements. Source-only concerns from the original audit still need targeted measurements before algorithm changes. None of these local results qualifies installed Electron, lower-end devices, WAN startup, continuous FPS, physical controllers or hardware timing.

## Evidence

The [evidence manifest](./2026-10-14-speed-fixes/manifest.json) records the final changed-source and audit-tool hashes, base commit, branch, receipt hashes, test results, browser measurements, screenshots and CPU profiles. Its source-state field explicitly identifies this as uncommitted local implementation; the base Git hash alone does not contain these fixes. JSON receipts are whitespace-normalised for repository formatting. Full working logs remain at `C:/Users/Asus/.codex/tmp/speed-fixes-20261014-2272`.

## Reproduce

Use an otherwise idle audit process slot; leave the user's other applications untouched. Do not run timing probes alongside tests, lint or builds.

```powershell
node scripts/performance-audit/client-transfer-probe.mjs --baseline --baseline-ref 03f1da57737ebc58d7cf4e240be6c2225270c690 --out <before.json>
node scripts/performance-audit/client-transfer-probe.mjs --out <after.json>
node scripts/performance-audit/hotpath-probe.mjs --out <hotpaths.json>
node scripts/performance-audit/nesting-probe.mjs --out <nesting.json>
pnpm exec vitest run --config scripts/performance-audit/vitest.config.ts
$env:PLAYWRIGHT_PORT = '5197' # Choose an unused local port.
pnpm exec playwright test --config scripts/performance-audit/playwright.config.ts
node scripts/large-file-browser-bench.mjs --runs 3 --out <pipeline.json>
node --max-old-space-size=4096 node_modules/vite/bin/vite.js build
node scripts/performance-audit/startup-probe.mjs --out <startup.json> --verify-library
```

`--baseline-ref` pins the two baseline client files to the audited commit; without it, `--baseline` uses HEAD. Browser component probes exclude full UI rendering and hardware. Startup uses local precompressed HTTP with service workers blocked, not WAN download or packaged Electron. Full-app interaction telemetry uses the desktop-mode development renderer and waits for actual G-code viewport readiness.
