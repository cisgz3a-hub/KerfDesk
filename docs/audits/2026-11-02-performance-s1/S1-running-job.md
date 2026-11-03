# Performance audit S1 — Running job

- **When:** 2026-11-02, 14:55 – 21:20 +0800.
- **Tree:** origin/main @ `a14c03b97` (worktree `claude/performance-audit-s1`, HEAD `a16c5c00a`, which adds only the empty ledger).
  - Repros ran on a production build of the `j7-main` copy of `a14c03b97` (`vite build`, the repo's own `vite.config.ts` plus an `fflate` alias). Source-mapped attribution used a second build of the same tree with `--sourcemap hidden` (same chunk sizes).
  - **Main moved during the audit** to `c0610b891` (#1541–#1545). `git diff --stat a14c03b97 origin/main` over every file cited below changes only a comment in `job-review-gate.ts`, so every finding holds on `c0610b891`. No PR was open at the end.
  - Trend builds: `git archive` exports of `33bc394c6` (1.0.28) and `87ecb4f24` (1.0.23), plain files outside `j7-main`, built with main's `vite.config.ts` (identical plugin code in both releases), root set to the export, bare imports resolved through this checkout's `node_modules` (**main's dependency versions, not each release's own lockfile**) and the PWA register module stubbed (service workers are blocked in the measuring browser anyway).
- **Machine state:** i7-1260P (12 cores, 16 threads), 16 GB. Free memory 2.5–5.4 GB through the sets; it fell to 0.55 GB once, when a fix session's two `eslint` runs took 4 GB, and the set then running was stopped and discarded.
  - **Other work running:** fix sessions ran `vitest` (up to 8 processes) and `eslint` during roughly half the sitting. `machine-state.log` in the harness records load, free memory and the number of `vitest`/`eslint`/`tsc` processes before every gated set. Sets whose calibration drifted more than 15% are marked in the scorecard; the worst were discarded (`results-disturbed.jsonl`).
  - Calibration loop (40M-step integer mix in the page): 38–55 ms on an idle machine, 56–78 ms lightly loaded, 89–169 ms during the fix sessions' test runs.
- **Temp files:** two `zz-s1-*` build configs in `j7-main` (moved into the harness), and the release exports in `scratchpad\zz-s1-old\`, are deleted. Everything else is the harness in `scratchpad\zz-s1\`, kept for the refuter: scripts, logs, `results.jsonl`, `results-disturbed.jsonl`, profiles, and the five builds (`dist-main`, `dist-main-map`, `dist-main-net`, `dist-33bc394c6`, `dist-87ecb4f24`).
- **Scope:** the renderer while a job streams: USB GRBL worker (ADR-354), window fallback, USB Marlin worker (ADR-676), Pause, Abort, Preview, Console, pan and zoom, Start preparation, throughput, memory, a full job start to finish, and the trend against 1.0.28 and 1.0.23. Prior findings K1, K2, R1-P2-1 and J10-P3-2 were re-measured.
- **Lenses:** L6 (what the beam does when the UI thread is busy at Pause), L4 (pan, zoom, Preview, a synthetic 1.6 s stall), L9 (worker, window, Marlin worker; the network route is Not verified), L3 (Pause against Abort, main against 1.0.28 and 1.0.23).
- **Counts:** 6 raised → 0 refuted → P1 2 / P2 1 / P3 3 (+ 3 KNOWN re-observed). Refuter: confirmed 4, plausible 2, refuted 0. S1-P2-1 raised to P1 (an Abort was measured waiting inside the Preview block). S1-P1-1 stays P1, but it is not purely new since 1.0.28 (see its Refuter line).

## Headline

**At ordinary sizes the running job is clean.** At 18,527 lines no window on any route had a long task over 50 ms while the job ran: idle, status poll, progress, pan, zoom, Preview, Console with the stream shown or hidden. Abort reached the wire in 1–7 ms on every route, idle, during a pan and right after a 1.6 s stall. GRBL Pause took 12–16 ms on the worker. The worker route ran at the controller protocol's ceiling.

**Three things cost a burn or a stop at large sizes.**

- **S1-P1-1 (P1, a regression since 1.0.28).** A Marlin **Pause** on a large job blocks the UI thread for **181–496 ms** between handing the refill back and writing the beam-off.
  - The worker stops refilling at once, so the controller drains and stops. On the fan dialect it stays lit until the `M107` arrives.
  - At 739,048 lines, **24 of 24** Pauses carried the block, and **11 of 24** left the stopped head lit for **181–466 ms**, with nothing on screen saying so.
  - 1.0.28 and 1.0.23, same job and same sitting: no block over 51 ms, lit at most 17 and 9 ms, or 49 and 70 ms with Preview open (10 Pauses each). At 18,527 lines on main: lit 0 ms.
  - The cause is ADR-676 Amendment 2 (#1534). It posts the release first, then scans every remaining line of the program for a beam it might need to switch off.
  - *Refuter:* the scan covers the whole program, sent lines included. 1.0.28 already left the head lit for 346–358 ms on Pauses late in the same job (89%), so #1534 made an existing dwell independent of position rather than creating it.
- **S1-P2-1 (P2).** Opening Preview during a 374,843-line job blocked the UI thread **610–918 ms** in 15 of 15 Preview windows across four sets.
  - On the window route the controller starved for **613–654 ms** in each of them. Under M3 or Marlin that is K1's lit stop.
  - The work is the whole-toolpath timeline and stats, rebuilt on the main thread (`buildPreviewTimeline` → `sumStepLengths` → `unpackToolpathStep`).
  - It did not appear in four later sets taken under heavier load. Nine Aborts pressed after a Preview never landed inside a block, so a delayed Abort is shown only by READ.
  - *Refuter, raised to P1:* two Aborts sent inside a 1.3–1.4 s Preview block reached the controller 1,223 and 1,357 ms after the key. Under load the block comes later, up to 5.8 s after the click, which is outside the auditor's 3.5 s window.
- **S1-P2-2 (P2).** Start preparation blocks the UI thread before the first line:
  - 0.95–2.2 s at 374,843 lines;
  - **4.9 s** at 968,387 lines, with Frame 24 s and Job Review 27 s;
  - the same in 1.0.28 and 1.0.23.

**Memory.**
- A running job costs about 1.8 KB of renderer heap per G-code line.
  - 374,843 lines: heap 0.7 GB, browser 2.1 GB private.
  - 968,387 lines: heap 1.85 GB, browser 3.0 GB, PC free memory down to 1.1 GB.
- No leak: retained heap after a forced GC stayed at 199–202 MB across six Start/Abort cycles.
- A true 2,000,000-line job was not run (S1-P3-1).

**Re-measured prior findings.**
- **R1-P2-1** (Marlin Pause behind the backlog) is fixed at ordinary size: 0 ms lit after a 1.6 s stall, worker route, 5 runs. At large sizes S1-P1-1 replaces it with a worse dwell.
- **J10-P3-2** is now about 10 ms: Marlin Abort at 739,048 lines wrote `M107` at +8 ms and `M410` at +14 ms.
- **K1-P1-1** re-observed in Chromium: Marlin window route, a 1.6 s stall left the head lit for 755–1,515 ms.

**Trustworthiness.** Every number comes from Chromium against a production bundle, with the controller simulated on its own thread. Timings in ms are good to about ±20% on this shared PC, and worse in the sets marked "loaded". The ordering conclusions (block before beam-off, regression since 1.0.28) do not depend on load: they hold in every set.

## Scorecard

Route: **W** = USB GRBL worker (ADR-354, default), **Win** = window fallback (no unique USB identity, opt-out, or worker unavailable), **MW** = USB Marlin worker (ADR-676), fan dialect. "Longest block" is the longest main-thread long task in the window. Median and worst exclude the first run (AREAS rule 3), so n is the kept count. Controller simulator at 1,000 blocks/s and 2 ms reply latency unless stated.

| Operation | Input | Median / worst | Longest UI block | Peak memory | Budget | Verdict |
|---|---|---|---|---|---|---|
| Job running, idle (status poll, progress, head) | 18,527 lines, W / Win / MW | n=5 each | 0 / 0 / 0 ms; timer gap ≤ 17 ms | heap 92 MB | 50 ms | Pass |
| Same | 374,843 lines, W / Win | n=5 | 0 / 0 ms | heap 0.74 GB, browser 2.1 GB private | 50 ms | Pass (memory: S1-P3-1) |
| Same | 968,387 lines, W | n=1 (2 windows) | 0 ms; main thread 47% busy | heap 1.85 GB, browser 3.0 GB | 50 ms | Pass (memory: S1-P3-1) |
| Pan (middle-drag) during job | 18,527, W / Win / MW | n=5 | 0 ms; gap 44–46 ms | — | 50 ms; 33 ms/frame | Pass (frame p95 18 ms) |
| Same | 374,843, W / Win | n=5 | 0 ms; gap 44 / 133 worst (GC) | heap 1.76 GB (uncollected) | 50 ms | Pass |
| Zoom (wheel) during job | 18,527 and 374,843 | n=5 | 0 ms | — | 50 ms | Pass |
| Console open, stream shown / hidden | 18,527 and 374,843 | n=5 / n=3 | 0 ms | — | 50 ms | Pass |
| **Preview open + close during job** | 18,527, W / Win | n=5 | 0 ms | 256 MB | 50 ms | Pass |
| **Same** | **374,843, W** | n=12 (3 sets) | **634–918 ms** (med 646) | heap 1.0 GB | 50 ms | **S1-P2-1** |
| **Same** | **374,843, Win** | n=3 (+rep 0) | **610–673 ms**; controller starved **613–654 ms** | — | 50 ms | **S1-P2-1** |
| Abort, idle: input → first stop byte | 18,527, W / Win / MW | n=5 | 1 / 1 / 2 ms; usable again 0.3 s | — | 100 ms response | Pass |
| Abort during pan | 18,527, W / Win | n=5 | 4–7 ms | — | — | Pass |
| Abort right after a 1.6 s stall | 18,527, W / Win | n=5 | +1–7 ms after the stall ends | — | — | Pass (the stall itself is synthetic) |
| Abort | 374,843, W / Win | n=2+2 | 1–18 ms; usable again 0.4–1.0 s | — | — | Pass |
| Abort, Marlin (J10-P3-2) | 739,048, MW | n=1 | `M107` +8, `M410` +14 ms; no long task | — | — | Pass (was 132 ms at 1M) |
| GRBL Pause: input → door byte `0x84` | 18,527, W / Win | n=5 | 12–16 / 1–2 ms | — | — | Pass |
| GRBL Pause after a 1.6 s stall | 18,527, W | n=5 | door byte 80 ms after the click is handled (idle: 14 ms); head moving meanwhile, lit 0 | — | — | Pass |
| Marlin Pause, lit dwell after the click | 18,527, MW (fan, 150 blocks/s) | n=4×3 (idle, pan, after stall) | 12–24 ms to `M107`; **lit 0 ms** | — | — | Pass (R1-P2-1 fixed) |
| **Marlin Pause, lit dwell** | **739,048, MW (fan, 300 blocks/s)** | n=24 (3 sets) | block **181–496 ms** every time; **lit 181–466 ms in 11/24** | — | — | **S1-P1-1** |
| Start: Frame / click → Job Review / confirm → first line | 18,527, W | n=10+ | 3.2–3.4 s / 0.83–0.85 s / 79–106 ms; longest block 73–95 ms | — | 100 ms response; 200 ms block | Pass, apart from 0.85 s to Review (S4) |
| Same | 374,843, W / Win | n=6 + 6 | 4.3–4.9 s / 5.0–5.4 s / 0.57–0.72 s; **blocks 641–995 ms** | heap +0.65 GB | 200 ms block | **S1-P2-2** |
| Same | 739,048, MW | n=1 | 6.9 s / 7.4 s / 1.28 s; **1,111 ms** | — | 200 ms | **S1-P2-2** |
| Same | 968,387, W | n=1 | **24.5 s / 27.2 s / 2.7 s; 4,903 ms** | browser 3.0 GB | 200 ms | **S1-P2-2** |
| Throughput, worker: lines/s acknowledged | 18,527 | n=5 | 1,096; ideal host 942 | — | controller ceiling | At ceiling (character counting) |
| Throughput, window | 18,527 idle / pan | n=5 | 967 / 741 lines/s; starved ≤ 12 / 36–38 ms | — | — | Pass (−12% / −32%) |
| Throughput, Marlin worker (ping-pong) | 18,527 | n=5 | 433 lines/s at a 2 ms reply latency | — | — | At ping-pong ceiling |
| Main-thread cost per acknowledged line | 18,527 Win / 374,843 W idle / pan / MW | n=5 | 0.24–0.29 / 0.13–0.15 / 0.55–0.70 / 0.27 ms | — | — | Matches ADR-352's ≤ 0.4 ms |
| Full job start to finish | 374,843 lines at 5,000 blocks/s, W | n=1 | 126 s; rate flat 3,389–3,789 lines/s; DOM 1,084 nodes throughout | heap 722–786 MB during, 285 MB after; browser 2.07 GB peak | — | Pass; job-end blocks 148–189 ms (S1-P3-2) |
| Six Start/Abort cycles | 374,843 | 6 | retained heap after GC 199–202 MB | browser 1.1–1.6 GB | — | Pass (no leak) |

### Trend (same sitting; calibration in brackets)

Calibration is in ms; each figure is the median, as above.

| Measure | main `a14c03b97` | 1.0.28 `33bc394c6` | 1.0.23 `87ecb4f24` | Note |
|---|---|---|---|---|
| Abort, idle, 18,527 lines | 4 ms [105→128, loaded] | 2 ms [66→87] | 2 ms [83→75] | Same |
| GRBL Pause → `0x84`, 18,527 | 26 ms [loaded] | 15 ms | 14 ms | Same once normalised; idle main is 14 ms |
| Main thread per line, idle, 18,527 | 0.98 ms [loaded, drift 22%: discard] | 0.46 ms | 0.41 ms | Main's idle-PC value is 0.25 ms (set A-win); no regression shown |
| Main thread per line, idle, 374,843 | 0.29 ms [76→68] | 0.30 ms [65→61] | 0.33 ms [143→124] | Same |
| Start at 374,843: Frame / to Review / longest block | 9.1 s / 10.5 s / 2.1 s | 8.8 s / 11.7 s / 2.7 s | 9.2 s / 10.7 s / 2.2 s | Same (all loaded; idle main is 4.4 / 5.1 / 1.0 s) |
| Preview block, 374,843 | ≤ 61 ms | ≤ 56 ms | ≤ 54 ms | The block did not appear in any trend set; see S1-P2-1 |
| **Marlin Pause at 739,048: block / lit** | **271–440 ms every time / lit 270–435 ms in 4 of 10** | **no block over 51 ms / ≤ 17 ms (≤ 49 with Preview), n=10** | **no block over 51 ms / ≤ 9 ms (≤ 70 with Preview), n=10** | **S1-P1-1: regression from #1534** |

### Measurement method

The harness is in `…\scratchpad\zz-s1\`. Entry points: `run.mjs` (one set), `runset.sh`, `batch*.sh`, `analyze.mjs` (median and worst without rep 0), `map-profile.cjs` (CPU profile → source via the hidden source maps).

1. **Build.** `node node_modules/vite/bin/vite.js build --config zz-s1-vite.config.ts --outDir <dist>`, run in `j7-main` with a heap of 6 GB. For the old releases: `ZZ_OLD=<export> … --config zz-s1-vite-old.config.ts`, run from the export. Copies of both configs are in `zz-s1/`; copy them into the repro tree root to run them. `build-all.sh` re-creates the release exports.
2. **Serve.** `node host.mjs <dist> <port>` serves the bundle with the `_headers` COOP, COEP and CSP. It serves the controller worker at `/zz-sim.worker.js`, and prepends `page-init.js` to `native-serial-stream-worker-*.js`.
3. **Browser.** Playwright 1.61.1 with installed Chrome 156 (`channel: 'chrome'`, headless): 1440 × 900, service workers blocked, `--enable-precise-memory-info`, background throttling off.
4. **Controller.** `sim-core.js` runs on its own Worker thread, reached by a MessagePort from the page (window route) or from the stream worker (worker routes). No measured thread relays its bytes.
   - **GRBL** follows `e2e/fixtures/paced-grbl-serial.js`: 128-byte RX, a 15-block planner, `ok` at admission, the safety-door byte, status with `Ov:`.
   - **Marlin** follows `marlin-fifo-model.ts` and `marlin-sim-queue.ts`: a 4-line ring, a 15-move planner, M106/M107 fan state carried per block, `M410` acting on read.
   - It counts starvation (planner empty mid-job), lit stops (head stopped, beam > 0) and the wall time of the first stop byte.
5. **Fake port.** The fake `SerialPort` carries a USB vendor and product id on the worker route, and none on the window route. Marlin runs start from a stored `kerfdesk.last-machine.v1` (the Generic Marlin laser profile, set to the fan dialect), so they connect as a returning user would.
6. **Inputs.** `gen-project.mjs` builds the e2e harness's ring-grid fill with each tree's own `serializeProject`. Line totals are read from the app: 18,527 (grid 4, 100 mm, 0.1 mm); 374,843 (grid 34, 200 mm, 0.02 mm); 739,048 Marlin fan (same geometry); 208,920 Marlin (grid 18); 968,387 (grid 90, 0.01 mm).
7. **Windows.** Each scenario is a 2.5–3.5 s window. Inside it:
   - a PerformanceObserver collects long tasks;
   - a 10 ms interval measures timer gaps, and rAF measures frame times;
   - CDP `Performance.getMetrics` gives TaskDuration (main-thread busy time per acknowledged line);
   - the simulator's counters give lines/s and starvation.
   Six runs; the first is discarded.
8. **Stops.**
   - Abort is `Ctrl+.`; Pause is a click on **Pause**. Latency runs from the input event's timestamp to the controller's receipt of the first stop byte.
   - The "stall" case blocks the page for 1.6 s and issues the input 150 ms in.
   - "Lit after input" is the time the simulated head sat stopped with the beam above zero, starting at or after the input.
9. **Calibration.** `__ZZ.calibrate()` runs before and after each set.

### Re-running the key repro (S1-P1-1)

`BASE=http://127.0.0.1:4601/ ./runset.sh PL-x usb-worker marlin-2m.lf2 '{"grammar":"marlin","dialect":"fan","blocksPerSecond":300}' plan-pl.json ',"totalLines":400000,"machineDoc":"<zz-s1>/projects/machine-marlin-fan.json"'`

Then read the `litAfterInputMs` and `longTasks` fields of the `pause` rows in `results.jsonl`. For the old releases use ports 4603 and 4604, with the `old-<sha>-*` inputs.

## Findings

### S1-P1-1 — A Marlin Pause on a large job blocks the UI thread for hundreds of ms between stopping the refill and writing the beam-off, so the fan-dialect head stops lit

- **Where:**
  - `src/ui/state/laser-job-pause-resume.ts:109-110`. `releaseHostedRefill` posts `release` to the worker synchronously (`worker-refill-handover.ts:144-152`), then `postBeamOffBehindRelease` runs.
  - `src/ui/state/laser-stream-pause-beam.ts:85-96`. It calls `driver.streamPauseOffLinesFrom(streamer.queued, streamer.queueIndex)` before any `safeWrite`.
  - `src/core/controllers/marlin/stream-pause-beam.ts:78-89`. `marlinStreamPauseOffLinesFrom` calls `someLineFrom(streamLines, sent, litsFan)` and `someLineFrom(…, armsInline)`. Each one walks every remaining line through `wordsForLine` (`:109`, `:146`; `grbl/laser-resume-reentry.ts:218`).
  - On a fan-dialect job the inline test never short-circuits, so the whole remainder of the program is parsed.
- **Anchor:**
  - **Contract.** ADR-676 Amendment 2, Consequences: "A Marlin Pause puts its beam-off on the wire within a message round trip, whatever backlog the window has." The same amendment's comment in `stream-pause-beam.ts:72-77` says "The stop must not wait for them".
  - **Twin.** Abort computes its stop lines **before** it posts the release (`laser-job-stop.ts:164-170`: `noResetStopLines(...)`, then `releaseHostedRefill`, then `writeStopLinesAtOnce`). Pause does the scan **after** it.
  - **Trend.** 1.0.28 and 1.0.23 have no block over 51 ms on the same job (table above).
  - **Ground truth.** K1-P1-1 cites Marlin 2.1.2.8 `planner.cpp` L1388-L1399: with the planner empty the fan follows the current speed and nothing times it out.
- **Scenario:**
  1. A Marlin fan-wired laser (`marlin-fan`) runs a large fill or photo job (here 739,048 lines) on the default worker route.
  2. The operator presses Pause.
  3. The worker stops refilling at once. The main thread then parses the rest of the program for 180–500 ms.
  4. Marlin finishes its 15 planned moves (about 50 ms at 300 moves/s) and stops.
  5. If the stop lands inside a burn, the beam stays at the job's fan power over the stopped head until `M107` is written after the scan. No notice mentions it.
- **Evidence:** **REPRO**, Chromium 156 against the production bundle (`plan-pl.json`, simulator at 300 blocks/s, fan dialect).

  | Set (calibration, ms) | Pauses | Block at the click | Lit dwell after the click |
  |---|---|---|---|
  | B-marlin, idle PC (78) | 3 | 181, 186, 208 ms | 181 ms in 1 |
  | TR-main, same sitting as the trend (93→74) | 7 + 3 with Preview open | 271–440 ms | 270, 435 ms; 344, 384 ms with Preview |
  | PL, lightly loaded (101→89) | 8 + 3 with Preview open | 298–496 ms | 303, 327, 466 ms; 348, 363, 389 ms with Preview |
  | PL, 208,920 lines, loaded (drift 62%: discarded) | 7 + 3 | 115–266 ms | 171–193 ms in 4 |
  | P-marlin, 18,527 lines (46) | 4 idle + 4 pan + 4 after a 1.6 s stall | none | 0 ms |
  | 1.0.28 / 1.0.23 at 739,048 (TR) | 10 / 10 | none over 51 ms | ≤ 17 / ≤ 9 ms; with Preview ≤ 49 / ≤ 70 ms |

  - The source-mapped profile (`prof-pause-marlin-2m.json`) attributes 289 of 292 ms of `runConfirmedPauseJob` to `marlinStreamPauseOffLinesFrom` → `someLineFrom` → `armsInline` → `isInlineModeSwitch` → `wordsForLine`.
  - The pause's `M107` reached the controller at +182 to +469 ms. The job's own `M107` lines stop at the click.
  - The block scales with the lines left: about 0.25–0.4 µs per remaining line on an idle PC.
- **Severity:** **P1** under AREAS ("a UI block that … leaves the beam lit while a job runs") and METHOD §3 (wrong physical output: a stationary lit beam, with no warning). R1-P2-1's raise condition was "a lit stop measured in Chromium"; this meets it through the fix for R1-P2-1 itself.
  - **Reach:** Marlin fan dialect on the default worker route, on jobs large enough that the scan exceeds the planner's drain time. Here that is about 200,000 lines at 300 moves/s; faster rasters drain sooner. On the inline dialect the same scan delays `M5 I`, and Marlin's 1 s laser timeout bounds the dwell.
- **Novelty:** new, and a regression since 1.0.28 introduced by #1534 (ADR-676 Amendment 2, merged 2026-11-02). R1 measured only small jobs.
- **Fix direction** (no G-code change; only the timing of the stop lines moves):
  - **(a)** Compute the off lines before posting the release, as Abort does. The worker then refills during the scan and the head keeps moving.
  - **(b)** Or make the test O(1): record at Start, once, whether the program ever lights the fan or arms the inline beam, and whether it does so from a given index on (a suffix flag array, or the last index that does). The scan is then a lookup.
  - **(c)** Or post both beam-offs unconditionally when a worker holds the refill. The amendment already accepts "a line too many costs one `ok`".
  - Whichever is chosen, add a thread test with a 700k-line fan program asserting that the Pause `M107` is written within one message round trip. The existing 360-line cases cannot see this.
- **Refuter: CONFIRMED. P1 kept. The novelty is corrected: the lit Pause also exists in 1.0.28 (and by code in 1.0.23) for a Pause late in a job.**
  - **What would make it false.** Any one of these would do:
    - the release is posted after the scan;
    - the scan is short;
    - the controller keeps moving through the gap;
    - Marlin switches the fan off when the planner empties.
    None holds:
    - `releaseHostedRefill` is called, and not awaited, at `laser-job-pause-resume.ts:109`. The scan runs at `:110` → `laser-stream-pause-beam.ts:92`, before any `safeWrite` (`:96`).
    - Marlin 2.1.2.8 `planner.cpp` was re-fetched on 2026-11-02. `check_axes_activity()` with no block queued drives the fans from `thermalManager.scaledFanSpeed(i)`, the current speed, and has no timeout. The fetch tool showed no line numbers, so L1388-L1399 is UNVERIFIED as a line range; the behaviour is confirmed.
    - The contract quote is ADR-676 Amendment 2 Consequences, `docs/decisions/ADR-676-amendment-2-…md:79`, verbatim.
  - **Correction on the cost.** The cost is the whole program, not the lines left.
    - `marlinStreamPauseOffLinesFrom` calls `heldInlineBeam`, which walks back over every sent line, because a fan-dialect job has no inline switch. `someLineFrom(…, armsInline)` then walks every remaining line.
    - Node, the tree's own `emitGcode` + `createStreamer` on `marlin-2m.lf2` (739,048 lines, 374,837 with an `m`): `marlinStreamPauseOffLinesFrom` takes **343–363 ms median at every position from 0.2% to 99%** of the job.
  - **Correction on "new since #1534".** 1.0.28's `planMarlinStreamPauseBeam` is unchanged on main (`git diff 33bc394c6 c0610b891` adds only the new function). It walks back over the sent lines before its `M107`, so its cost grows with progress:
    - in Node: 0.7 ms at 0.2%, 34 ms at 10%, 169 ms at 50%, **322 ms at 90%** and 359 ms at 99%;
    - in Chromium, on 1.0.28 at 739,048 lines (set PEL-1028), Pauses 2–10 s into the job had no task over 50 ms. That matches the auditor's trend.
    - After a fast-forward to line 661,200 (89%), all 5 Pauses blocked 314–516 ms, and **2 of 5 left the head lit for 346 and 358 ms**.
    - The MA-1 scan (`d1928d3d4`, 2026-09-25) is an ancestor of both `33bc394c6` and `87ecb4f24`.

    So the large-job lit Pause predates #1534. #1534 made it independent of position, so now every Pause pays for the whole program. The trend row "1.0.28: no block" holds only for Pauses early in a job.
  - **Re-measured on main** (set P739-main, worker route, fan dialect, 300 blocks/s; rep 0 discarded):
    - 739,048 lines: block at the click 283–348 ms on 6 of 6, Pause `M107` at +284 to +349 ms, **lit 281, 299 and 349 ms in 3 of 6**.
    - The planner was already near empty at the click: the dry point came 0–2 ms after it. Marlin's ping-pong at about 430 lines/s, half of them `M106`/`M107`, feeds fewer moves than 300 blocks/s can run. So the dwell is close to the whole scan time, on any PC where the stream is host-bound.
    - Ordinary size, set P20k-main: the same geometry is **29,212 lines** in the fan dialect, not 18,527. No long task, `M107` at +20–26 ms, lit 0 ms in 4 of 6 and 16–17 ms in 2.
  - **Reach.** A 739k-line Marlin job is a photo or dense fill at about 0.02 mm. At the 430 lines/s ping-pong ceiling it runs about 29 minutes, which is long but ordinary for a photo engrave. The dwell grows with program size, about 0.45 µs per line on this PC. Reach cannot lower a P1 (METHOD §3), and the notice ("KerfDesk queued M107 behind them…") is pushed only after the release reply, so it gives no warning of the dwell.
  - **Fix note.** Fix (b) must cover the backward `heldInlineBeam` walk too, because `planMarlinStreamPauseBeam` still runs it later on Resume and on the window route.

### S1-P2-1 — Opening Preview during a large job rebuilds the whole-toolpath timeline on the UI thread: 610–918 ms at 375k lines, and the window route starves the controller for the whole block

- **Where:**
  - `src/ui/workspace/Workspace.tsx:65` → `use-preview-playback.ts:33-40` `useMemo(() => buildPreviewTimeline(toolpath, estimate.breakdown))`.
  - `preview-timeline.ts:18`, `:72` (`previewCategoryTiming`), `:172` (`sumStepLengths`) → `core/job/packed-toolpath-steps.ts:30,104` → `core/job/packed-toolpath.ts:285` (`unpackToolpathStep`).
  - Also on the main thread: `preview-overlays.tsx:58-66` `previewStatusOverlayModel`, `:101-109` / `:171-179` `PreviewStatsPanel` → `core/job/toolpath.ts:197` `summarizeToolpathDistances`, `:210` `passBoundaryFractions`, and `preview-display-decimation.ts:12`.
- **Anchor:**
  - **Contract.** The AREAS budget of 50 ms for the longest UI block while a job runs, because "Abort, status and any window-side streaming share this thread".
  - **Twin.** ADR-598 and ADR-352 moved whole-job work off this thread. The toolpath itself is built in `preview-route-worker`, which the trace shows doing 2 s of work, but the timeline and stats over it are not.
- **Scenario:** a 375k-line fill is running and the operator clicks Preview to check progress.
  - The UI thread then blocks for about 0.65 s. It blocks again each time the timeline input changes while Preview is open (the windows recorded 2–3 long tasks).
  - On the window route the refill stops for the whole block. GRBL's 128-byte buffer and 15 blocks last tens of ms, so the head stops; under M3 or Marlin the beam stays on (K1).
  - On the worker route the job keeps running. An Abort or Pause pressed during the block waits for it (READ: the `Ctrl+.` and **ABORT JOB** handlers run on this thread).
- **Evidence:** **REPRO** of the block.

  | Set (calibration, ms) | Route | Preview windows with a block | Block | Controller starved |
  |---|---|---|---|---|
  | B-usbw (61→73) | W | 4 of 4 | 619–918 ms | ≤ 5 ms |
  | B-win (58→56) | Win | 4 of 4 | 610–673 ms | **613–654 ms** |
  | F-prev, source-mapped build | W | 2 of 2 | 753, 781 ms | ≤ 12 ms |
  | PV (61→89, loaded) | W | 5 of 5 | 634–708 ms | ≤ 6 ms |
  | TR main / 1.0.28 / 1.0.23, PV2 (loaded) | W | 0 of 14 | ≤ 75 ms | — |
  | 18,527 lines (sets A) | W, Win | 0 of 10 | 0 ms | ≤ 32 ms |

  - The profile (`prof-preview-30s.json`) shows, inclusive on the main thread:
    - `unpackToolpathStep` 665 ms;
    - `buildPreviewTimeline` 446 ms (`sumStepLengths` 347 ms);
    - `previewStatusOverlayModel` 111 ms;
    - `previewDisplayDecimation` 107 ms;
    - `summarizeToolpathDistances` 83 ms.
  - **Not shown:**
    - Why the block was absent in the later, more loaded sets. The timeline needs the live estimate and the worker-built toolpath, which a loaded PC may deliver after the 3.5 s window; this was not proved.
    - An Abort timed inside the block. Nine Aborts at 40–2,200 ms after a Preview click, in sets where no block occurred, wrote `0x18` 30–91 ms after the key.
    - 1.0.28 and 1.0.23 were not observed with the block either, so whether this is new is unknown.
- **Severity:** **P2.** On the default route it is an ordinary operation at over ten times its budget during a job. On the window route it is a measured 0.6 s starvation, which K1 turns into a lit stop under M3 or Marlin (Job Review warns of that route's lit stop, ADR-676).
  - **Raise to P1** when an Abort or Pause is measured waiting inside the block, which AREAS names as P1. A 375k-line photo is an ordinary job: ADR-352 Amd 1's incident job was 298k lines.
- **Fix direction:**
  - Compute the timeline and the stats panels in the worker that already builds the preview toolpath, or incrementally in slices, as ADR-352 Amd 1 did for the route raster.
  - Do not recompute them while a job runs unless the toolpath changes.
  - Add a browser guard: Preview opened during a 300k-line job, longest task under 100 ms.
  - Preview output does not reach the G-code.
- **Refuter: CONFIRMED, and RAISED to P1.** The raise condition was met: an Abort pressed inside the Preview block waited for it.
  - **What would make it false.** Either of these would do:
    - the Abort handler runs off the UI thread;
    - the block never coincides with a running job.

    Neither holds. `installAbortShortcut` is a window `keydown` listener (`src/ui/laser/use-job-shortcuts.ts:40-43`), and **ABORT JOB** is a React button on the same thread.
  - **Set PV375-main** (374,843 lines, worker route, 1,000 blocks/s, calibration 66 ms):
    - The driver polled the page with `page.evaluate`. When one did not answer within 60 ms, the UI thread was blocked, and it sent `Ctrl+.` at once.
    - Two Aborts landed inside a Preview block of 1,302 and 1,414 ms. **Key sent → `0x18` at the controller: 1,223 and 1,357 ms.** Each `0x18` arrived 8 ms after its block ended.
    - A third key landed just after a block and took 19 ms.
    - The job kept burning as programmed throughout, because the worker refills.
  - **Method flaw in the auditor's "nine Aborts after a Preview wrote `0x18` 30–91 ms after the key".** For input dispatched over CDP, Chromium stamps `event.timeStamp` when the renderer dispatches the event, not when it is sent.
    - In my two delayed Aborts, `timeStamp` → `0x18` read 4 ms, and the queue time read 2 ms.
    - The auditor's `inputToFirstStopMs` therefore cannot see a key that waits behind a block. A real OS key carries the OS time, so a user does feel the delay.
    - Abort latency must be measured from the send time, as here.
  - **Why the block was absent under heavier load.** The timeline is built only once the worker-built preview toolpath and an `estimated` estimate exist (`use-preview-playback.ts:32-40`). On a slower or busier PC the toolpath arrives after the auditor's 3.5 s window, and closing Preview drops it.
    - Here the first Preview open blocked **1,416 ms starting 5.8 s after the click**.
    - A reopen with the toolpath ready blocked **1,575 ms starting 86 ms after the click**.
    - The blocks also grow with load: 1.4–1.6 s here, against the auditor's 0.6–0.9 s on a quieter PC.
  - **Window route:** not re-measured. The auditor's starvation of 613–654 ms follows from the same block.
  - **Severity.** P1 under AREAS: "A UI block that delays Abort … while a job runs". An operator who opens Preview to check a 375k-line job and then presses Abort gets a stop more than a second late.

### S1-P2-2 — Start preparation blocks the UI thread for 1–2 s at 375k lines and 4.9 s at 968k, with Job Review building its model on the main thread

- **Where** (source-mapped profile `prof-start-2m.json`, inclusive main-thread ms at 374,843 lines):
  - `job-review-gate.ts:87` `runJobReviewGate` 851 → `:188` `modelFor` → `job-review-model.ts:106` `buildJobReviewModel` 793. Under it: `fill-sweep-plan.ts:47` `planFillSweeps` 581, `fill-heat-risk.ts:26` `analyzeFillHeatRisk` 421, `job-review-model.ts:273` `buildStatTiles` 286, `:309` `fillRunwayTiles` 233.
  - `output-preparation-worker-client.ts:294` `handleWorkerMessage` 612 (self time: hydrating the worker's result).
  - `canvas-motion-plan.ts:268` `canvasPlanRetentionKey` 510.
  - `start-job-execution-tracking.ts:51,100`: `currentReplayExecutionSignature` 368, `stageFreshExecutionArtifact` 297 (`job-checkpoint.ts:74` `fingerprintGcode` 249).
- **Anchor:** AREAS budget: 200 ms for the longest UI block while designing, or a progress bar and Cancel. ADR-598 moved compile off this thread; these steps run after it.
- **Scenario:** Frame, then Start, on a 300k-line photo or fill. The window freezes 1–2 s at a time during Frame and before Job Review appears. At 968k lines one task held it for 4.9 s, inside 27 s from Start to Review. Job Review has no Cancel until it opens.
- **Evidence:** **REPRO**.

  | Lines | Frame | Start → Job Review | Confirm → first line | Longest blocks |
  |---|---|---|---|---|
  | 18,527 (W, n=30+) | 3.2–3.4 s | 0.83–0.85 s | 79–106 ms | 73–95 ms |
  | 374,843 (W and Win, idle PC, n=12) | 4.3–4.9 s | 5.0–5.4 s | 0.57–0.72 s | 641–995, 384–471 ms |
  | 739,048 Marlin (n=1) | 6.9 s | 7.4 s | 1.28 s | 1,111, 792 ms |
  | 968,387 (n=1) | 24.5 s | 27.2 s | 2.7 s | **4,903**, 1,742 ms |

  - The same sitting gives 1.0.28 and 1.0.23 the same shape (trend table). This is not a regression.
- **Severity:** P2. An ordinary 300k-line job is over three times the 200 ms budget, with no Cancel during the block. Not 5 s on ordinary input, so not higher. S4 owns Start preparation and should take the fix; it is counted here because S1 item 4 asks for it.
- **Fix direction:**
  - Build the Job Review model (fill sweeps, heat risk, tiles) in the output-preparation worker that already compiled the job, and post the result.
  - Hydrate the transferred preparation lazily.
  - Make `canvasPlanRetentionKey` and the execution signature use the fingerprint the worker already computed instead of re-walking the program.
  - None of this changes the emitted program.
- **Refuter: CONFIRMED. P2 kept.**
  - **What would make it false:** the blocks being short, or a progress display with a Cancel covering them.
  - **At 374,843 lines on main** (sets PV375-main, n=3, calibration 66 ms):

    | Stage | Time | Longest blocks |
    |---|---|---|
    | Frame | 9.9–11.0 s | 1,208–1,523 ms |
    | Start → Job Review | 11.7–13.0 s | **2,179–3,084 ms** |
    | Confirm → first line | 1.4–1.8 s | 925–1,114 ms |

  - **At 739,048 lines** (Marlin): main 12.9 s / 15.2 s / 3.2 s, blocks 2,347 and 1,739 ms. 1.0.28 14.9 s / 16.5 s / 2.6 s, blocks 2,670 and 1,660 ms. Not a regression.
  - **Feedback**, read from the DOM 1.2 s into each stage:
    - Frame shows "Preparing the exact job for Frame…" with a **Cancel**.
    - Between Start and Job Review there is **no progress indicator and no Cancel**. The status line still reads "Ready to start — framed placement unchanged" for 11–13 s, and the UI freezes for 2–3 s at a time.
  - The blocks are over ten times the 200 ms budget on an ordinary large job, with no single freeze of 5 s here, so P2 holds.
 — A running job holds about 1.8 KB of renderer heap per G-code line; a 2-million-line job was not attempted on this PC

- **Where:** the program held by the main-thread streamer (`StreamerState.queued`), the canvas motion plan (`canvas-motion-plan.ts`), the execution artifact and checkpoint (`state/recovery/execution-artifact*.ts`), and the preview toolpath. Not attributed per structure (no heap snapshot).
- **Evidence:** REPRO, `performance.memory` and CDP `Runtime.getHeapUsage` after a forced GC.
  - **374,843 lines:** heap 77 → 730 MB at Start, browser 1.2 → 2.1 GB private.
  - **968,387 lines:** heap 1.85 GB while running, 715 MB retained after GC, browser 3.0 GB, PC free memory 1.1 GB.
  - **No leak:** retained heap after six Start/Abort cycles was 199, 200, 201, 201, 202, 202 MB.
  - **Full 374,843-line job:** heap flat at 722–786 MB, then 285 MB after the job. Throughput flat to the end.
- **Severity:** P3. The budget miss is against AREAS' 1.5 GB whole-app budget, which is set for a 2,000-object project; nothing crashed.
  - **Raise to P1** if a 2,000,000-line job crashes the renderer or cannot finish ("a job the app cannot finish streaming"). Linear extrapolation is about 3.6 GB of heap, near Chromium's renderer heap ceiling. Not run: the 968k job already left the shared PC 1.1 GB free.
- **Fix direction:** keep the program once, as transferred buffers (ADR-354 Amd 3 already does this for the worker), and read lines by index. Drop per-line objects in the canvas plan for jobs past a size. No G-code change.
- **Refuter: PLAUSIBLE. P3 kept. A 2M-line job was not run, and the figure is extrapolated.**
  - **Why it was not run.** Free memory was 1.8–3.2 GB, and the brief's floor is 1 GB. My memory guard stopped the 374,843-line set at **951 MB free**, and a 29k-line set at 916 MB, after another program's Chrome tab grew to 1.3 GB. A 2M-line job, at roughly 6 GB of browser, cannot run on this PC under the rules.
  - **Correction on the per-line figure.** About 1.8 KB per line is the uncollected heap just after Start. What a running job retains after a forced GC is smaller:

    | Job | Heap after GC, idle → running | Retained per line |
    |---|---|---|
    | 374,843 lines | 56 → 267 MB | **0.56 KB** |
    | 739,048 Marlin lines | 57 → 281 MB | **0.30 KB** |

    `jsHeapSizeLimit` is 4,396 MB.
  - **Extrapolation to 2M lines:**
    - a transient peak of about 3.7 GB, which is collectable and below the limit;
    - a retained heap of about 0.6–1.2 GB.

    A renderer out-of-memory is therefore not indicated. The binding limit is system memory: the browser's private bytes grew to 3.0 GB at 968k lines in the auditor's run. A crash was not shown, so the raise condition is not met.

### S1-P3-2 — The end of a long job blocks the UI thread 148–189 ms while the last moves still run

- **Where:** not attributed (one run). It falls between the last line acknowledged and `done`: post-job settle, completion notice and the "Job complete" dialog render.
- **Evidence:** REPRO, n=1 (`L-usbw-375k`, 5,000 blocks/s). The 20 s window holding the end of the job had long tasks of 189 ms, and the next window 148 ms; every earlier window had none. The worker had nothing left to refill, so the controller did not starve.
- **Severity:** P3. Over the 50 ms budget while motion runs, but at a moment with no refill at stake, and measured once.
- **Fix direction:** profile the completion path at 375k lines. Defer the dialog and history writes past the motion's end.
- **Refuter: PLAUSIBLE. P3 kept.** Not re-measured: a 375k-line job run to its end would have held the browser at more than 2 GB for over 2 minutes, with free memory already at the guard. It is n=1 and unattributed. If true, it is at most P3, because no refill is at stake.

### S1-P3-3 — No guard covers job-size scaling of the stop and Preview paths; the big-job harness is opt-in, GRBL-only and dev-server based

- **Where:**
  - `e2e/big-job-run-responsiveness.e2e.ts:50` (`KERFDESK_BIG_JOB_PERF=1`, development build; production needs a dumped project);
  - `in-window-stall-beam.thread.test.ts` and `stall-thread-cases.ts` (360- and 420-line programs);
  - `laser-job-pause-resume` tests (small streams).
- **Anchor:** AREAS "a missing guard or benchmark".
- **Evidence:** READ. S1-P1-1 shipped with a thread test that passes because its program is 360 lines.
- **Fix direction:** the guard proposal below.
- **Refuter: CONFIRMED. P3 kept.**
  - `stall-thread-cases.ts:80,100` build `engraveJob(360)` and `engraveJob(420)`.
  - `e2e/big-job-run-responsiveness.e2e.ts:50` is `test.skip` unless `KERFDESK_BIG_JOB_PERF=1`.
  - `stream-pause-beam.test.ts` has no large program.
  - Both P1s above reproduce only at 375k–739k lines, so nothing in CI could have caught them.
  - Add to the guard proposal: measure Abort latency from the time the key is sent, not from `event.timeStamp` (see S1-P2-1).

## KNOWN re-observed

- **K1-P1-1 (Marlin, window route).** With the worker unavailable (no USB identity), a 1.6 s page stall drained the planner and left the fan-dialect head lit for **755 ms (median) to 1,515 ms (worst)**, 4 runs. On the worker route the same stall gave 0 ms (P sets, Chromium). Job Review's window-route lit-stop advisory (ADR-676) still applies.
- **J10-P3-2.** A Marlin Abort's air-assist regex over the queued program no longer shows. At 739,048 lines `M107` was written at +8 ms and `M410` at +14 ms, with no task over 50 ms (Chromium against J10's 132 ms at 1M lines, which was a cold first call in Node).
- **R1-P2-1.** Fixed by #1534 at ordinary size: 0 ms lit after a 1.6 s stall, 5 runs on the worker route, fan dialect, 150 moves/s. **R1 asked for the real ms per line:** the main thread spends **0.24–0.29 ms** per acknowledged line on the window route at 18,527 lines, 0.13–0.15 ms at 374,843, 0.55–0.70 ms during a pan, and 0.27 ms per forwarded Marlin line. ADR-352's ≤ 0.4 ms holds at idle.

## Refuted

The refuter refuted none of the six findings. The corrections to S1-P1-1's novelty and S1-P3-1's per-line figure are recorded in their Refuter lines.

These are my own suspicions during the sitting:

- **Memory grows with every restarted job.** After five 375k restarts the heap read 1.0–1.6 GB, but that heap was uncollected. A forced GC gives 199–202 MB retained across six cycles.
- **Pause fails over into a reset.** That was a harness artifact. The simulator first decoded wire bytes as windows-1252 (the WHATWG `latin1` label), so `0x84` never arrived, and it first omitted `Ov:`, which the laser path needs as proof that the spindle is off. Fixed before the measured sets.
- **The worker starves the controller.** The worker acknowledged 1,096 lines/s against an ideal host's 942 lines/s (`ideal-host.cjs`, same simulator, 0.3 ms hop) at a 1,000 moves/s controller with 2 ms reply latency. The shortfall from 1,000 moves/s is GRBL's 128-byte character-counting window at 36-byte lines, not the host.
- **Per-line cost grows with job size.** At 968k lines the main thread was 47% busy (0.48 ms per line). That run had a 1.85 GB heap and only two windows; at 375k it was 0.13–0.30 ms. Not established either way (Not verified).

## Verified clean

- On every route at 18,527 lines, no long task over 50 ms while the job ran: idle, pan, zoom, Preview, Console with the stream shown or hidden. Frame p95 17–22 ms.
- **Abort:** 1–7 ms from key to stop byte on the worker, window and Marlin worker routes, idle, during a pan and after a 1.6 s stall. Usable again in 0.3–1.1 s.
- **GRBL Pause after a stall:**
  - The door byte goes out about 80 ms after the click is handled (14 ms idle), because it waits for the worker's `released` reply.
  - The head keeps moving meanwhile, so nothing dwells. ADR-676 Amd 2 lists this as unmeasured; it is now measured.
- **Window route under a pan:** the controller starved at most 36–38 ms per gap at 18,527 lines and 34 ms at 374,843, under the 50 ms budget.
- **Long job:** the 374,843-line job finished. Throughput was flat at 3,389–3,789 lines/s. Heap and DOM count were flat to the end, and the Console and log stayed bounded (DOM 1,084 nodes throughout).
- **Pause → Resume enabled** takes 1.5–1.9 s on GRBL and Marlin at large sizes in all three versions. That is not a regression; the button shows "Pausing…" at once.

## Not verified

- **The network route** (desktop FluidNC/grblHAL, worker and window). The harness is ready but was not run for lack of an idle machine:
  - the `ZZ_S1_NET=1` build `dist-main-net`;
  - `net-routes.mjs`, which uses the real `electron/machine-network-routes.ts`, bridge and session over a real TCP socket;
  - `net-sim-thread.cjs` as the controller.
  R1 covers that route's watchdogs.
- **A true 2,000,000-line job** (S1-P3-1), and Start preparation and memory at that size. The largest job measured was 968,387 lines.
- **Throughput at 115,200 baud** and at ≥ 3,000 moves/s through the app. Only the ideal-host reference was run. Batch 1's throughput sets were stopped to free the machine.
- **A large project on the canvas during a job** (the 5,041-object set). Batch 1 was stopped before it ran.
- **Window-route Marlin Pause at 739k lines:** the window route freezes before it plans, so the scan in S1-P1-1 is not on that path (READ). Not measured.
  - *Refuter:* the window route's own plan (`planMarlinStreamPauseBeam` → `heldInlineBeam`) walks every sent line between the freeze and its `M107`: 322 ms at 90% of this job in Node. A late Pause there has the same dwell as 1.0.28's (READ + Node; not measured in the browser).
- **Abort timed inside a Preview block** (S1-P2-1's raise condition).
- Hardware (never operated), the packaged Electron app, and a real hidden tab.

## Refuter method and machine state

- **When:** 2026-11-02, 21:15 – 21:50 +0800. Fresh context, without the auditor's reasoning.
- **Tree.** `origin/main` is `c0610b891`, the auditor's "main at end". `git diff --stat a14c03b97 origin/main` over every cited file changes only `src/core/job/registration-jig-compilation-runs.ts`, which is not cited. The repro tree's cited sources hash equal to this checkout's. The auditor's `dist-main` and `dist-33bc394c6` were therefore reused, after checking them; they contain the Pause notice code of their tree. No rebuild was needed.
- **Own code** in `scratchpad\zz-s1r\` (deleted at the end):
  - `scan-bench.mjs` and `scan-entry.ts` compile the project with the tree's `emitGcode` and `createStreamer`, then time `marlinStreamPauseOffLinesFrom` and `planMarlinStreamPauseBeam` at 0.2–99% of the job: six runs each, first discarded, after JIT warm-up.
  - `drive.mjs` is a Playwright driver with its own probes: long tasks, input stamps, a calibration loop, and a memory guard that closes the browser below 1 GB free.
    - It measures stop latency from the **Node send time** to the simulator's receipt of the byte, and also from `event.timeStamp`.
    - It detects a UI block by a `page.evaluate` that does not answer within 60 ms.
    - It fast-forwards the simulator (no motion time, no reply latency) to reach late positions in a job.
- **Reused after reading:** the auditor's `host.mjs` (static host with COOP, COEP and CSP), `page-init.js` (fake port; its probes were not used), and `sim-core.js` with `sim-worker-shell.js`.
  - The Marlin fan model was checked against `planner.cpp`: `M106` sets the current speed on parse, and an empty planner leaves the beam at it.
  - The simulator's lit and stop accounting was checked by reading it.
- **Machine state.** i7-1260P, 16 GB. `state.sh` before each set recorded:

  | Set | Free memory | CPU load |
  |---|---|---|
  | A18k-W | 2.6 GB | 45% |
  | P739-main | 3.0 GB | 23% |
  | P20k-main | 3.4 GB | 22% |
  | PEL-1028 | 3.2 GB | 15% |
  | PV375-main | 3.2 GB | 3% |
  | A29k-MW | 1.8 GB | 42% |

  - At the first set, three test or build processes were running (the count includes the probe itself); none at the later sets.
  - Another program's Chrome tab grew to 1.3 GB during the last two sets, and the guard stopped both (951 and 916 MB free).
  - Calibration: 56–74 ms at the end of each set. P739-main and PEL-1028 started at 145 and 135 ms, because the first calibration ran while the page was still compiling. Their timings may read high by up to about 2×. The ordering results (block before beam-off; early against late on 1.0.28) do not depend on it.
- **Spot-checks of two clean claims, both CONFIRMED:**
  - **Abort at ordinary size.** Worker route, 18,527 lines: key sent → `0x18` 4–8 ms; `timeStamp` → `0x18` 2 ms (n=5). Marlin worker, 29,212 lines: key sent → `M107` 12–14 ms (n=2 kept; the guard stopped the set).
  - **Worker throughput.** 943 lines/s acknowledged and 744 moves/s executed at 1,000 blocks/s. The auditor's ideal host, re-run on `capture-grbl.gcode` with the same simulator, gives 906–907 lines/s and 713–714 moves/s (3 runs). The worker matches or beats the ideal host. The planner's short starvation (≤ 14 ms) is GRBL's 128-byte window, not the host.
- **Not done:**
  - the window-route Preview starvation;
  - S1-P3-2;
  - a 2M-line job (memory);
  - a 1.0.23 browser run (the 1.0.23 point is READ: the MA-1 scan is an ancestor).

## Ranked list — what an ordinary user meets, by how often

1. **Start preparation on photo and fill jobs** (S1-P2-2). Every large job: 1–2 s UI freezes and 5 s to Job Review at 375k lines; 0.85 s to Review even at 18k lines.
2. **Pause → Resume available after about 1.5 s** on large jobs. Every Pause on a big job; felt, but announced with "Pausing…".
3. **Preview while a job runs** (S1-P2-1). An operator checking progress on a big job: 0.6–0.9 s freezes.
4. **Marlin Pause on a large fan-dialect job** (S1-P1-1). Rare (large Marlin jobs) but it burns.
5. **Memory on 300k+ line jobs** (S1-P3-1). 2–3 GB for the browser, felt on an 8 GB PC.
6. **The end of a long job** (S1-P3-2). One 0.15–0.2 s hitch.

## Guard proposal

Operation counts or ratios, so CI timing noise does not matter:

1. **Thread test:** a 700k-line Marlin fan program on the worker; Pause writes `M107` within one message round trip. Count the lines `streamPauseOffLinesFrom` visits; it must be O(1) per Pause.
2. **Unit counter:** opening Preview on a 300k-step toolpath during a job must not call `unpackToolpathStep` on the main thread more than a fixed number of times. Wrap and count.
3. **Production-bundle Playwright run** (nightly, not per PR) of this harness's 18,527-line plan on the worker and window routes:
   - longest task during the job < 50 ms;
   - Abort key → `0x18` < 50 ms;
   - worker lines/s ≥ 0.9 × the ideal-host reference.

```json
{
  "area": "S1-running-job",
  "tree": "a14c03b97",
  "main_at_end": "c0610b891",
  "counts": { "raised": 6, "refuted": 0, "P1": 2, "P2": 1, "P3": 3, "known": 3 },
  "refuter": { "confirmed": 4, "plausible": 2, "refuted": 0, "severity_changes": ["S1-P2-1 P2->P1"] },
  "findings": [
    { "id": "S1-P1-1", "severity": "P1", "evidence": "REPRO", "refuter": "CONFIRMED", "title": "Marlin Pause on a large fan-dialect job scans the whole program between refill release and beam-off (283-496 ms); head lit 181-466 ms (main) and 281-349 ms (refuter, 3/6 at 739k lines); #1534 made it position-independent, but 1.0.28 already had it for late-job Pauses (lit 346-358 ms at 89%)" },
    { "id": "S1-P2-1", "severity": "P1", "severity_auditor": "P2", "evidence": "REPRO", "refuter": "CONFIRMED, raised: Abort key sent inside the block reached the controller after 1,223 and 1,357 ms", "title": "Preview during a 375k-line job blocks the UI 0.6-1.6 s (block arrives with the worker toolpath, up to 5.8 s after the click); Abort waits behind it; window route starves 613-654 ms" },
    { "id": "S1-P2-2", "severity": "P2", "evidence": "REPRO", "refuter": "CONFIRMED", "title": "Start preparation blocks 0.95-3.1 s at 375k lines and 4.9 s at 968k; no progress or Cancel between Start and Job Review; same in 1.0.28" },
    { "id": "S1-P3-1", "severity": "P3", "evidence": "REPRO", "refuter": "PLAUSIBLE (2M not run: memory floor; retained heap 0.3-0.56 KB/line, transient ~1.8 KB/line)", "raise_to": "P1 if a 2M-line job crashes", "title": "About 1.8 KB transient renderer heap per job line; 968k lines = 1.85 GB heap, 3.0 GB browser; no leak" },
    { "id": "S1-P3-2", "severity": "P3", "evidence": "REPRO (n=1)", "refuter": "PLAUSIBLE (not re-measured)", "title": "Job end blocks 148-189 ms while the last moves run" },
    { "id": "S1-P3-3", "severity": "P3", "evidence": "READ", "refuter": "CONFIRMED", "title": "No guard for job-size scaling of Pause and Preview; big-job harness opt-in and GRBL-only" }
  ],
  "known_reobserved": ["K1-P1-1", "J10-P3-2", "R1-P2-1"],
  "budgets": { "ui_block_during_job_ms": 50, "ordinary_size_result": "pass on all routes at 18,527 lines" }
}
```
