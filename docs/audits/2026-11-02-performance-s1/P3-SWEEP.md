# Performance audit S1 — P3 sweep (S1–S6)

**Requested:** the maintainer, 2026-11-05: "fix the P3s". This table holds every P3 of reports S1–S7, and the KNOWN items those reports recommend fixing, with where each one stands on `main`. S8 and S9 add their own rows when those areas finish.

**Rules held by every fix** ([AREAS.md](AREAS.md)): a speed fix may not change the burn or the committed geometry (G-code, traced paths or result hashes byte-identical on the fixture set); before and after are the median of five plus the worst, production bundle, with the calibration loop before and after each set; each fix adds a guard that counts work or checks a worker boundary, not wall-clock time. Route or burn changes, lower resolution and new limits are listed as maintainer decisions instead.

**Measurement note (2026-11-05):** the PC had no quiet window all day (four fix sessions; the S7 auditor stopped its own queue at 08:13 for the same reason). Sets therefore ran under AREAS rule 4 as written: base and fix alternate round by round in one process, the calibration loop runs before and after, and a set whose calibration drifted more than 15% was thrown away and run again (up to three times). Absolute times read high by the calibration ratio shown; compare the ratios.

## Table

| ID | Title | Budget | Status |
|---|---|---|---|
| S1-P3-1 | About 1.8 KB of transient renderer heap per job line; 968k lines = 1.85 GB heap, 3.0 GB browser; no leak | 1.5 GB whole app | _pending_ |
| S1-P3-2 | The end of a long job blocks the UI thread 148–189 ms while the last moves run | 50 ms while a job runs | _pending_ |
| S1-P3-3 | No guard for job-size scaling of Pause and Preview; the big-job harness is opt-in and GRBL-only | a guard | _pending_ |
| S2-P3-1 | Every edit of a small Fill design re-estimates the job on the UI thread: 185–251 ms at 200 objects | 200 ms block | **Already fixed (#1575).** ADR-598 Amd 4: ordinary jobs of 2,000 outline and fill units or more prepare in the worker for the ETA as for Preview, Frame, Start and Save (`ordinaryOutputPrefersWorker`, `live-job-estimate.ts:82,111`); mix-200 is 54k units |
| S2-P3-2 | The 50,000-path trace re-resolves every path every frame and repaints its sprite on every resize step | 33 ms frame, 200 ms block | _pending_ |
| S2-P3-3 | Thousands selected: a box per object per frame and selection-wide panel recomputes; drag-all commit 207–300 ms at 5,000 | 200 ms block | _pending_ |
| S2-P3-4 | The canvas probes time only JavaScript, so GPU-bound frames are invisible | a guard | _pending_ |
| S3-P3-1 | Projects of 25 MiB or more are read one character at a time: a 90 MB photo project opens in 8.4–8.8 s | Open 5 s | _this sweep_ |
| S3-P3-2 | Large vector results block the UI on arrival: SVG 50k 801–863 ms, PDF 20k, Open 10,000 objects | 200 ms block | _pending_ |
| S4-P2-1 (P3) | Everyday jobs under 20,000 units compile on the UI thread for Preview, Frame, Start, ETA and Save separately | 200 ms block | **Already fixed (#1575)** (ADR-598 Amd 4) |
| S4-P3-1 | Photo Preview compiles the raster on the UI thread: 100 mm 203–212 ms, bed-sized 673–737 ms | 200 ms block | _this sweep_ |
| S4-P3-2 | Save G-code re-prepares the whole program for an unchanged project: bed photo 16.2 then 15.5 s | reuse | **Already fixed (#1575).** `app/save-emission-reuse.ts` keeps the last emitted Save per project and exact request; repeated Save of a 100 mm photo 2,120 → 64 ms |
| S4-P3-3 | The ETA stops at every rapid/feed junction, which GRBL 1.1 laser mode does not: 200-object mix 3 h 05 min against 1 h 51 min modelled | — | **Fixed by this sweep (#1585)** (maintainer approved 2026-11-05: "Use GRBL laser model"; ADR-255 Amd 3). Laser jobs on GRBL 1.1 and grblHAL with `$32=1` blend a rapid/feed junction by junction deviation; CNC, `$32=0`, FluidNC, Marlin, Smoothieware and Ruida keep the stop. On S4's eight fixture projects G-code is byte-identical and the estimate moves: mix-200 3 h 05 min → 1 h 52 min (−39.7 %; S4's independent model 1 h 51 min), line-200 −1.8 %, fill-200 and fill-5000 −0.6 %, CNC 0.0 % |
| S5-P3-1 | Sharp traces large pages 1.7–2.6 × slower than 1.0.28 for identical paths: the clean-art check prepares the source again | within 1.1 × 1.0.28 | _this sweep_ |
| S5-P3-2 | The cooperative fallback (no trace worker) still traces in stretches of 205–285 ms | 200 ms block | _pending_ |
| S5-P3-3 | Pressing Trace on a 12 MP photo or 4096 page decodes the source on the UI thread: 335–342 ms block | 100 ms on commit | _this sweep_ |
| S6-P3-1 | Outer shapes only pays the whole nesting-depth search: 100 rings 443 ms against 67 ms in 1.0.23, same output | within 1.5 × 1.0.23 | **Fixed by this sweep (#1583)** (ADR-410 Amd 5). Depths try the deepest enclosing ring first. Engine, S6 harness, base vs fix alternating, same result hash: 100 rings 824 → 35 ms (worst 1,596 → 87), 300 rings 6,776 → 108 ms (calibration 118–126 and 84–242 ms, so about 3 × a quiet PC; 1.0.23 was 26–36 ms at 100 rings on a quiet PC, about 11 ms here when scaled) |
| S6-P3-2 | Exclude folds the selection one shape at a time: 500 shapes 2.5 s, 2,000 shapes 55 s | 2,000 shapes under 5 s | **Maintainer decision** (below) |
| S6-P3-3 | Optimize / Combine Shapes' before/after preview rebuilds every outline on the UI thread: 2,000 outlines 262–328 ms | 100 ms opening task | _this sweep_ |
| S7-P3-1 | Shrink-to-fit re-shapes every line prefix through opentype.js: a 200-character paragraph previews 1.4–1.55 s after each key (text worker) | 100 ms response | _pending_ (S7 ledgered by #1584; memoized line shaping gave identical outlines 3.5–5.7 × faster) |
| S7-P3-2 | A 2,000-character frame rebuilds its preview SVG path on every key: 51–280 ms a key, typing falls 1.2 s behind | 100 ms response | _pending_ |

### Machine job time (S4's route and overscan section)

| Item | Status |
|---|---|
| Cut order / nearest start point | **Maintainer decision: keep** (2026-11-05). The route is unchanged. |
| Overscan defaults | **Maintainer decision: keep** (2026-11-05). |

### KNOWN items the reports recommend fixing

| ID | Title | Status |
|---|---|---|
| N4-P3-2 (S7 KNOWN) | Remote and jig edits lay text frames out on the UI thread: a 500-character frame 3.8–4.2 s, 2,000 characters 23–24 s (Node) | _pending_ (S7-P3-1's memoization helps; moving the layout to the text worker removes the freeze). The S7 P2s belong to a separate card |
| N3-P3-1 (S6 KNOWN) | Offset's nesting step grows with the cube of the nesting depth: 100 rings 1.5 s, 300 rings 31 s | **Fixed by this sweep (#1583)** (ADR-410 Amd 5). When every ring keeps 4 µm clear of every other edge, a level is painted only against the rings it can change. Same result hash on every S6 fixture; a seeded test compares with the level-by-level painter on 250 scenes (1,500 run locally). Offset 100 rings 3,801 → 391 ms, Offset outlines row 3,352 → 359 ms (calibration 108–128 ms); 300 rings 78 s → 2.6 s in a smoke run (timed set below when it lands). 20 everyday shapes and 200 overlapping circles unchanged (ratios 1.04 and 1.12, inside noise) |

The other KNOWN items in S1–S6 are re-observations of P1/P2 findings fixed elsewhere (S1-P2-2, S2-P2-1/2, S3-P2-3), items owned by other audits (Q4-P2-1 trace speed against Potrace, K1-P1-1's window route, 21-P3-7), or confirmations that a fix holds (J10-P3-2, J10-P3-3, R1-P2-1).

## Maintainer decisions

### S4-P3-3 — The time estimate stops at every rapid/feed junction

**Decided 2026-11-05: approved ("Use GRBL laser model"), scoped to GRBL 1.1 and grblHAL with `$32=1`; Marlin and CNC keep their model until checked. Fixed in this sweep (ADR-255 Amendment 3).** The analysis that went to the maintainer:

- **What it is:** `src/core/motion-planner/junction.ts:10-15` plans every junction where a G0 meets a G1 at zero speed. GRBL 1.1 in laser mode (`$32=1`) does not stop there: `gcode.c:868-929` skips `spindle_sync` for laser motion, and `planner.c:399-449` takes the junction speed from junction deviation alone (S4's READ and its refuter's, gnea/grbl `bfb67f0c7`).
- **What changes if it is fixed:** only the number shown (the ETA badge, Job Review's time, the estimate in a saved job). The G-code, the route and the burn do not change. On S4's seven jobs the estimate drops 0.2–6.6 %, and on the 200-object mix, whose Fill rows hop over the circles 10,903 times, from 3 h 05 min to 1 h 51 min (−40 %).
- **Why it is not a speed fix:** it changes what users see, and a controller that does stop would then be under-estimated. It needs a decision per dialect and an ADR amendment to the motion-planner ADR.
- **Recommendation: do it, for GRBL-family dialects with laser mode on.** Plan a collinear G0 ↔ G1 junction like any other junction when the dialect is GRBL 1.1 or grblHAL **and** the controller reports `$32=1` (the app reads it since #1567). Keep the stop for `$32=0` (GRBL then syncs on S changes), for Marlin, Smoothieware and FluidNC until each is checked against its own firmware source, and for unknown controllers. A hardware air-run on one GRBL machine, timing the mix against the new estimate, would confirm it.

### S6-P3-2 — Exclude folds the selection one shape at a time

- **What it is:** `runBooleanOp` (`vector-path-booleans.ts:186-196`) XORs the shapes in canonical order, each against everything so far, so the work grows with the square of the selection: 500 shapes 2.5 s, 2,000 shapes 55 s, in the worker with "Updating preview…" and a working Cancel.
- **What was tried (this sweep):** a balanced pairwise fold (XOR is associative). On S6's fixtures it is 13 × faster at 500 shapes (6.2 s → 0.47 s on the loaded PC) and returns **the same region with the same vertices**: XOR area of the two results 0, both 33,990 vertices at 500 shapes, none on one side only. But clipper groups the touching pieces into rings differently (1,162 rings against 509 at 500 shapes, 469 against 203 at 200). A ring is one cut contour, so the cut order and the contours' start points change: a route change, which AREAS sends to the maintainer. Folding pairwise and finishing with main's last XOR did not restore main's rings.
- **Recommendation: accept the balanced fold, with an ADR-410 amendment** stating that Exclude's result is the same region but may be split into rings differently from before. Exclude results saved in projects keep their stored geometry; only new Exclude operations change. Until then Exclude stays as it is, and its `Updating preview…` status could become a percentage (a polish item, not part of this sweep).
