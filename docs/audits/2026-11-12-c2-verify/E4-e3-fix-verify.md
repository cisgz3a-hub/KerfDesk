# E4 — E3 fix verification (C2 fix verification)

**Question.** Do the three fixes for E3's findings hold on `main`, and does any of them create a regression the way #1832 did (E3-P1-1)?
- #1839 (ADR-700 Amd 4): DXF whole-turn tolerance (E3-P1-1, E3-P1-2).
- #1840 (ADR-345 Amd 1, ADR-695 Amd 5): Job Review reuse sees camera facts (E3-P2-1); a Z rotary starts after one Frame (E3-P3-3).
- #1841 (ADR-127 Amd 8): Ruida rotary pieces sweep one way (E3-P2-2).

**Tree.** `origin/main` @ `8d92bd143` (#1841), read-only export `j36-main`. Merges: #1839 `8443bda29`, #1840 `ac4b11370`, #1841 `8d92bd143`. Anchors below are on that tree.

Before trees (`git archive` of `src/`, read only, into `zz-e4\`):

| Folder | Commit | What it is |
|---|---|---|
| `pre1839` | `32d312ac1` | `8443bda29^1`, main before #1839 |
| `pre1840` | `8443bda29` | main before #1840 |
| `pre1841` | `ac4b11370` | main before #1841 |
| `pre1832` | `1f016b610` | main before #1832 (the E3-P1-1 baseline) |
| `pre1833` | `b0e4ee3ce` | main before #1833 (path order, the E1 baseline) |

**Method.**
- **READ:** every changed source file in the three PRs. Those are `dxf-curve-sampling.ts`, `dxf-entities.ts`, `framed-start-preparation.ts`, `job-review-gate.ts`, `required-frame-readiness.ts`, `framed-run-rotary.ts`, `rd-rotary-feed.ts` and `rd-rotary-order.ts`. Also read: the callers of the sweep rule, the Frame gate, the machine-inputs key, the phone review (`prepared-job-review.ts`, `reviewed-job-snapshot.ts`), the `.rd` ETA route, and the four ADR amendments.
- **DXF:** own DXF text through the UI import action `importDxfFiles` (main-thread `parseDxf`, toasts, `importObject`). Path length is measured from the imported polylines, and the imported canonical curve is checked too. Own census over 20,000 golden-ratio starts per row runs through the exported `normalizedSweep` / `arcSweep` / `isFullEllipseSweep` on main, `pre1839` and `pre1832`.
- **Job Review:** an own Vitest file with the real stores, in a copy `zz-e4\mut\` (`node_modules` junction). It counts compiles through a pass-through mock of `prepareCurrentStartJob`. Bundles carry a key taken before the compile, as `prepareFramedStartReview` does. The phone review is driven through `preparedJobReview` while the desktop review is open.
- **Frame gate:** an own GRBL-simulator Vitest file (the repo's `recovery-stress-testing` harness, no hardware). It covers a Z rotary, no rotary, a Y rotary and an A rotary (grblHAL). The test calls `requiredFrameIssueFromStart` directly with the live work offset and with shifted ones. It then changes the controller after the Frame (console `G92 Z3`, `G92 X5`, `G10 L20 P1 Z3`, a Z jog) and presses Start.
- **`.rd`:** Save `.rd` (`emitRdFile`), decoded by an own reader: an inverse table of the 0x88 byte scramble, tokens split on the high bit, move records `0x88–0x8B` / `0xA8–0xAB`, the `0xC9 0x02` speed, and the `0xE7 0x03` / `0xE7 0x07` process bounds. The E3 refuter's reader was read for API shape only.
  - Shapes: 8 (Ø30 circle at 180 sides, 8 rings Ø5 in a 4×2 grid and in a row, two lines of text-like glyph strokes, the same inside a border, stripes round the part, a diamond, a 60×24 rectangle).
  - Variants: 900 and 6000 mm/min, two layers at 600/3000, 2 passes, and Fill.
  - Rotaries: flat, rotary off, chuck 40 mm/turn Ø80, roller 360 mm/turn Ø25 (k > 1).
  - Trees: main, `pre1841`, `pre1833`.
  - ETA: the app's estimate (`estimateJobDuration` with `withRuidaRotaryRoute`), compared with the same clock fed the moves decoded from the bytes.
- **Mutants:** 14 own mutants of the three fixes in `mut\`, each run against the test files the PRs added or changed. Every file was restored and compared equal with `j36-main` after each run.
- **PR tests:** the 9 touched or related test files pass on `mut` (104 tests).
- **Not used:** hardware, a browser, pnpm, building, live services. Vitest ran one file set at a time with 2.2–2.4 GB free.

## Headline

**#1839 reverts the E3-P1-1 regression for 4 or more decimals and 5 or more significant digits, and fixes E3-P1-2 for 5 or more significant digits.** Nothing in the census collapses on main in those classes (ELLIPSE and ARC alike); before #1839, 14–85 % did. Genuine tiny arcs, sweeps over one turn, negative, NaN and Inf angles, and the bulge path are unchanged, and `isFullEllipseSweep` agrees with the sweep everywhere (0 of 200,000). Two things remain:
- **E4-P1-1 (residual of E3-P1-1).** The past-a-whole-turn tolerance (1e-4 turn) is narrower than 3-decimal radians. A full ELLIPSE whose start is not 0, written `%.3f` or `%.4g`, still imports as a dot in 18–24 % of starts. Example: 41 = `4.712`, 42 = `10.996` (3π/2 → 3π/2 + 2π) gives 2 points and 0.02 mm, with no note. Before #1832 it was a closed 138 mm outline. Start 0 is safe at 3 decimals.
- **E4-P3-1.** As ADR-700 Amd 4 announces, any ARC or ELLIPSE within 1e-4 turn of a whole turn now closes. `0 → 359.99°` was a 125.56 mm open arc and is now a closed circle. The gap it removes is 1/1600 of the radius.

**#1840 does what it says, with no regression found.** Camera placement turned on, a camera position confirmed, or both together during an open review now recompile at Confirm (1 compile). The confirmed bundle's warnings equal a fresh compile's (5 = 5 with Start from Current Position, where E3 measured 4 against 5), and a changed warning needs a second click. Nothing changed, or placement turned on and off again, means 0 compiles at Confirm.

The phone reuses the open desktop review (0 compiles). After a camera change it compiles its own read-only review, which shows the 5th warning. It never confirms, starts or changes the desktop review.

The Z-rotary Frame gate leaves Z out only for a Z rotary. Every other check refuses, as the table shows (simulator, 10 cases):

| Change after the Frame | Z rotary | No rotary | Y rotary | A rotary |
|---|---|---|---|---|
| Z offset (gate probe) | passes, as intended | refuses | refuses | refuses |
| X or Y offset (gate probe) | refuses | refuses | refuses | refuses |
| Console `G92 Z3` | refuses | refuses | refuses | refuses |
| Console `G10 L20 P1 Z3` | — | refuses | — | — |
| Console `G92 X5` | refuses | — | — | — |
| Z jog (turning the part) | refuses | — | — | — |

The console and jog rows refuse through the permit's own invalidation. A Z-rotary job after a turn starts after one Frame.

The PR's tests pin only the positive side, though (E4-P3-4). Three mutants survive every touched test:
- F1: Z left out for every job;
- F2: X dropped as well on a Z rotary;
- G3: no key from the framed Start review.

**#1841 holds on its own shapes and is clean on the flat bed.**
- The flat-bed and rotary-off files are byte-identical to before #1841 (32 of 32 files).
- The lit edges, the cut length per speed (the dose bands) and the process bounds are identical to before #1841 in every rotary file.
- No move leaves the process bounds, and no approach move is lit.
- The app's ETA equals the decoded route in every rotary row.
- On circles, rings and free text, burns started against the rotary fell to 0 (from 32–209), and turns fell to at or below the old path order.

Two of its stated consequences do not hold generally:
- **E4-P3-2.** A piece that starts at its part's Y edge cannot get its approach, because the approach is clamped inside the part's Y range. It still starts against the rotary: 1–2 per rectangle or text border, and 5 of 6 for stripes round the part. That is the same as before #1841 and on the flat bed, so it is not a regression; but "every burn starts the way the rotary turns" is not true for these shapes.
- **E4-P3-3.** On a k > 1 roller, a 4×2 grid of small rings travels 22 % more than path order did (ADR: "up to 2 %"). Its ETA rises from 66.9 s (Amd 7) to 100.7 s. The ETA is right; the job is just longer.

## 1. #1839 — DXF whole-turn tolerance (ADR-700 Amd 4)

**READ.**
- `counterClockwiseSweep` (`dxf-curve-sampling.ts:98-107`) gives a full turn in three cases:
  - a remainder within 1e-12 of zero (equal angles, as before);
  - any sweep within `WHOLE_TURN_SNAP = 1e-4` turn of a full turn;
  - a remainder within 1e-4 turn of zero, when `|end − start| ≥ turn`.
- `isFullEllipseSweep` is now `normalizedSweep(...) === FULL_TURN` (`:73-75`).
- `arcSweep` (`dxf-entities.ts:109-119`) keeps its within-one-turn branch bit for bit, except for the new near-full snap, which returns first.
- The callers are only `arcInOcs` and `ellipseInOcs`. Bulges (`bulgeSegment`) do not use the rule.

**E3's sweeps, end to end (`d1-dxf.mts` → `out/d1-main.txt`, `out/d1-pre1839.txt`, `out/d1-pre1832.txt`).** Ellipse: major 30 mm at 30°, ratio 0.4, full outline 138.0 mm. ARC: r = 20, full 125.66 mm.

| Case | main `8d92bd143` | before #1839 | before #1832 |
|---|---|---|---|
| ELLIPSE 0 → 2π rounded **up**, `%.4f`…`%.12f` (`6.2832` … `6.283185307180`) | closed 138.00 mm, all 9 | 0.00 mm for `%.4f`–`%.10f` | closed |
| ELLIPSE 0 → 2π rounded **down**, `%.3f`…`%.12f` | closed 138.00 | `6.283`, `6.2831` open | open / closed |
| ELLIPSE 0 → 2π `%.4g`…`%.15g` (`6.283`, `6.2832`, `6.28319` …) | closed 138.00, all 12 | `6.2832`, `6.28319`, `6.28318531`, `6.2831853072` → 0.00 mm | closed |
| ELLIPSE 0 → `6.284` (`%.3f` up) / `6.29` / `6.28` | 0.01 mm / 0.08 mm / open 137.97 | same | closed / closed / open |
| ELLIPSE s → s + 2π, 360 starts across the circle, `%.4f`–`%.12f`, `%.5g`–`%.14g` | **0 short of 360** in every row | 101–303 of 360 short | — |
| ARC s → s + 360, 360 starts (some negative), `%.3f`–`%.12f`, `%.5g`–`%.14g` | **0 short** | `%.5g`–`%.12g`: 23–64 short | — |

**Census (`d2-census.mts` → `out/d2-census.txt`; 20,000 starts per row, `s` and `s + turn` both printed).** "Dot" means a sweep under 1 % of a turn.

| Format | ELLIPSE dot: main / pre-#1839 / pre-#1832 | ARC dot: main / pre-#1839 / pre-#1832 |
|---|---|---|
| `%.1f` | **83.1** / 83.1 / 0 % | 0 / 0 / 8.6 % |
| `%.2f` | **31.8** / 31.8 / 0 % | 0 / 0 / 7.8 % |
| `%.3f` | **18.5** / 18.5 / 0 % | 0 / 0 / 7.8 % |
| `%.4f` | 0 / 85.3 / 0 % | 0 / 0 / 8.1 % |
| `%.5f`, `%.6f` | 0 / 53.2, 30.7 / 0 % | 0 / 0 / 8.1 % |
| `%.3g` | **39.6** / 39.7 / 0 % | 16.0 / 16.1 / 16.1 % |
| `%.4g` | **23.5** / 34.1 / 0 % | **5.1** / 15.7 / 24.3 % |
| `%.5g` … `%.12g` | 0 / 13.6–68.5 / 0 % | 0 / 5.1–15.9 / 23.5–23.9 % |

**Canonical curve (`d1b-curve.mts`).** `0 → 6.28319` now imports as 4 cubics, closed, the same as exact 2π. `ARC 45.12346 → 405.1235` imports as 5 segments, closed (before #1839: one open segment from about (1e-5, 1e-5) to (0, 0)). So the job's own geometry is whole, not only the preview polyline.

**Regression side.**
- **Genuine tiny arcs within one turn stay tiny.** ARC sweeps of 1e-6, 1e-5, 3e-5, 1e-4, 2e-4, 1e-3 and 1e-2 turn from starts 0, 45.5, 179.25, 359.9999 and −90 all give r·sweep (35 cases, 0 wrong). ELLIPSE sweeps of 1e-6 to 1e-2 turn from 0, 1, 3.14159 and 6.2831 stay tiny (7.5e-5 to 1.66 mm). Across 0°: `359.99 → 0.01` 0.007 mm, `359.999 → 0.001` 0.001 mm, `359.9 → 0.1` 0.07 mm, `350 → 10` 6.98 mm. Unchanged from before #1839.
- **Over one turn:** `0 → 450` is 31.39 mm (a quarter), `−720 → 90` a quarter, `0 → 720` and `0 → −360` full. `0 → 720.5` and `0 → 360.5` are 0.5° arcs (0.175 mm), `0 → 360.04` a 0.04° arc and `0 → 360.03` a full circle (the 1e-4-turn edge). ELLIPSE `0 → 2π + π/2` is 34.50 mm and `0 → 2π + 1e-3 rad` 0.012 mm.
- **Near-full arcs (the announced trade-off).** ARC `0 → 359.964` (gap 0.036°) stays open, 125.549 mm. From `0 → 359.965` up, the arc becomes a closed circle of 125.591 mm. Before #1839, `0 → 359.99` was open, 125.558 mm. The same applies to `10 → 9.99`, `0.01 → 0`, `90 → 449.99` and an ELLIPSE `2π − 0.0006` (closed; −0.0007 stays open). See E4-P3-1.
- **Negative, huge, NaN, Inf:** NaN, ±Inf and `abc` angles are skipped with "unreadable or out-of-range coordinate value" (ARC and ELLIPSE). `1e20 → 1e20` and `0 → 1e20` / `1e308` are full turns, as before. `0 → −359.99` is a 0.01° arc and `0 → −360.01` a full circle (near-full).
- **ELLIPSE partial:** `0 → π` 69.00 mm, `1 → 2` 28.91 mm, `5.5 → 7.0` 24.18 mm, `0 → −π/2` 103.50 mm, `6.2831 → 0.0003` 0.005 mm. All as expected.
- **`isFullEllipseSweep`:** 0 mismatches with `normalizedSweep === 2π` in 200,000 random pairs, and the sweep is always in (0, 2π]. Mutant D4 (back to `>= 2π − 1e-9`) is equivalent: a snapped sweep is exactly 2π, and any other is at least 6.3e-4 short.
- **LWPOLYLINE bulges:** not on the rule. Two half-circle bulges: closed, 125.566 mm. A single 359.99° bulge stays open (125.558 mm), unlike the ARC. Bulge 1e-9: straight. Unchanged.

## 2. #1840 — Job Review reuse and the Z-rotary Frame gate (ADR-345 Amd 1, ADR-695 Amd 5)

### Reuse at Confirm (E3-P2-1)

**READ.**
- `preparedStartReusable` (`job-review-gate.ts:349-357`) now refuses a bundle without `preparedMachineInputsKey` and compares the stored key with the live one.
- Both producers take the key *before* their compile:
  - `prepareFramedStartReview` (`framed-start-preparation.ts:61-67`), only for an ordinary permit;
  - `rebuildCurrentStart` (`job-review-gate.ts:428-430`).
- A reused bundle keeps its key (`:452-459`).
- The laser-second-pass purpose never rebuilds (`refreshFrozenReview`), so its missing key costs nothing.
- The key holds the same laser facts as before (`start-machine-snapshot.ts:24-86`). Only the camera side changed. So no new recompile appears where the old live-vs-live check reused.

**REPRO (`zz-e4-review-probe.test.ts`, 13 tests pass; `out/v1-review-probe.txt`).**

| Placement | Change during the open review | Reused | Compiles at Confirm | Second click | Warnings: confirmed / fresh |
|---|---|---|---|---|---|
| Absolute | nothing | yes | **0** | no | 4 / 4 |
| Absolute | placement on, then off | yes | **0** | no | 4 / 4 |
| Absolute | placement on | no | 1 | no | 4 / 4 |
| Absolute | position confirmed | no | 1 | no | 4 / 4 |
| Absolute | both | no | 1 | no | 4 / 4 |
| Current Position | nothing | yes | **0** | no | 4 / 4 |
| Current Position | placement on, then off | yes | **0** | no | 4 / 4 |
| Current Position | placement on | no | 1 | **yes** | **5 / 5** |
| Current Position | position confirmed | no | 1 | no | 4 / 4 |
| Current Position | both | no | 1 | **yes** | **5 / 5** |
| (no stored key) | nothing | no | 1 | no | — |

**Phone (same file).** With the desktop review open, `preparedJobReview` returns `ready` with the desktop text "describe the program displayed in desktop Job Review", 4 warnings and 0 compiles. After placement turns on, it compiles its own review (1 compile, the "current prepared program" text) with **5** warnings. Throughout:
- the desktop review still shows its first model (1 model);
- `pendingSignal` stays `null`;
- `startJob` is never called;
- the desktop's next Confirm recompiles (5 warnings).

So the phone sees the desktop snapshot only while the key holds, and cannot confirm. The snapshot is published only for a bundle with a key, and read back only while the same owner, model and open state stand (`reviewed-job-snapshot.ts:14-51`).

**What leaves the PC:** the phone gets the same summary fields as its own compile would give: counts, duration, bounds, warnings, and Frame complete or not. The desktop model can also carry the Frame's WCS and no-go disclosures. Nothing else leaves the PC.

**Mutants (§ Mutants):**
- G1 (the old live-vs-live check) is killed by the new recompile rows.
- G2 (the rebuilt key taken *after* the compile) survives. That is a race-only difference: a fact that changes during a compile.
- G3 (no key from the framed Start review) is in the mutant table.

### Z-rotary Frame gate (E3-P3-3)

**READ.**
- `requiredFrameIssueFromPrepared` (`required-frame-readiness.ts:41-56`) zeroes Z in both the recorded and the live work offset, but only when `framesZRotary(prepared.project)`. That is `rotaryOutputAxis(...) === 'Z'`, the same predicate under which `routeRotaryAxisBody` prefixes the job with `G92 Z0` (`rotary-axis-emit.ts:24-37`). So on exactly those jobs, Z's work offset places nothing.
- `isVerifiedFrameValid` compares only x, y and z, and the A offset was never compared.

**REPRO (`zz-e4-frame-z.simulator.test.tsx`, 10 tests; `out/v2-frame-z.txt`).** Each case: a Z jog of 7, an XY jog, Set origin, one Frame.

| Rotary | Recorded / live WCO after the Frame | Gate: live / Z+3 / X+1 / Y+1 / no WCO | After-Frame change → Start |
|---|---|---|---|
| Z (GRBL 1.1) | z 0 / **7** | PASS / **PASS** / refuse / refuse / refuse | none → **streams after one Frame** (`G92 Z0` sent) |
| Z | — | — | console `G92 Z3` → refused, "…origin, or CNC Z reference changed after Frame…" |
| Z | — | — | console `G92 X5` → refused (same) |
| Z | — | — | Z jog (turn) → refused, "Frame this job first…" |
| none | z 0 / 0 | PASS / **refuse** / refuse / refuse / refuse | none → streams; `G92 Z3` and `G10 L20 P1 Z3` → refused |
| Y | z 0 / 0 | PASS / **refuse** / refuse / refuse / refuse | `G92 Z3` → refused |
| A (grblHAL) | z 0 / 0 | PASS / **refuse** / refuse / refuse / refuse | none → streams (`G92 A0`); `G92 Z3` → refused |

So a genuine Z change still revokes on a non-rotary, Y or A job (at the gate itself), and an X or Y change still revokes on a Z rotary. A real Z change after the Frame on a Z rotary is also caught by the permit's own invalidation, before the gate.

Mutants:
- F1 (Z left out for every job) and F2 (X dropped as well) are in the mutant table.
- F3 (the fix reverted) is killed by the new single-Frame test.

## 3. #1841 — Ruida rotary piece order (ADR-127 Amd 8)

**READ.** `rd-rotary-order.ts` (new) and `rd-rotary-feed.ts:63-105`.
- **Sweep:** of the pieces ahead in the rotary's direction that burn that way, the nearest, with "ahead" counted again as travel.
- **Turn once:** the back-sweep's piece, entered by `entryInto`.
- **Cheapest otherwise:** travel plus 5,000 µm per turn, plus 50,000 µm per burn started against the rotary.
- **Approach:** 1,000 µm past the start, clamped to the input part's Y range (`:157-166`).
- **Classes:** the next class is the one holding the sweep's next piece.
- **Head state:** carries across classes and layers.
- **Callers:** only the encoder's `rotaryMotion` calls `splitRdPartsBySurfaceSpeed`, and only when `rotaryFeedMatchFor` matches (a scaled Y rotary). The ETA route (`rd-rotary-timing.ts`) times `encodeRdJob(...).motion`, so the ETA follows the new order by construction.

**REPRO (`d3-rd.mts` → `out/d3-*.txt`, `out/d3-*.json`; `d3-compare.mjs` → `out/d3-compare.txt`).** Own decoder, Save `.rd` bytes, 900 mm/min unless stated. Three columns per cell: path order (pre-#1833) → Amd 7 (pre-#1841) → main.

| Rotary, shape | Turns (Y sign changes, all moves) | Burns started against the last Y direction | Laser-off travel, mm | App ETA = own route from bytes |
|---|---|---|---|---|
| chuck, Ø30 circle (180) | 60 → 66 → **58** | 57 → 32 → **0** | 1,526 → 839 → 865 | 30.65 = 30.65 s |
| chuck, 8 rings Ø5 in a row | 144 → 329 → **144** | 128 → 167 → **0** | 1,287 → 581 → 602 | 45.9 = 45.9 |
| chuck, 8 rings Ø5 4×2 | 162 → 237 → **81** | 137 → 115 → **0** | 900 → 381 → 411 | 39.3 = 39.3 |
| chuck, text-like, 2 lines | 142 → 113 → **52** | 77 → 48 → **0** | 545 → 575 → 507 | 40.7 = 40.7 |
| chuck, text inside a border | 145 → 117 → **58** | 76 → 49 → **2** (both at the border) | 647 → 668 → 509 | 54.0 = 54.0 |
| chuck, rectangle 60×24 | 3 → 2 → 2 | 2 → 1 → **1** (at the edge) | 124 → 64 → 64 | 13.2 = 13.2 |
| chuck, stripes round the part | 5 → 5 → 5 | 5 → 5 → **5** (all at the edge; flat bed 5) | 15 → 15 → 15 | 11.8 = 11.8 |
| chuck, circle, 2 layers 600/3000 | 60 → 66 → 58 | 57 → 32 → 0 | 1,526 → 839 → 865 | 33.3 = 33.3 |
| chuck, text-like, 2 layers | 140 → 125 → 65 | 70 → 53 → **1** | 645 → 651 → 566 | 44.6 = 44.6 |
| chuck, circle ×2 passes | 120 → 226 → 118 | 115 → 33 → 0 | 3,064 → 851 → 1,116 | 58.7 = 58.7 (Amd 7 37.8) |
| roller, Ø30 circle | 54 → 78 → **53** | 52 → 51 → **0** | 6,475 → 3,660 → 6,100 (−5.8 %) | 75.5 = 75.5 |
| roller, 8 rings in a row | 128 → 231 → 127 | 112 → 209 → 0 | 2,560 → 842 → 2,307 (−9.9 %) | 90.7 = 90.7 |
| **roller, 8 rings 4×2** | 144 → 231 → **73** | 120 → 195 → **0** | 2,659 → 1,165 → **3,251 (+22.3 %)** | **100.7** = 100.7 (Amd 7 66.9) |
| roller, text-like, 2 lines | 137 → 86 → 40 | 72 → 32 → 0 | 4,315 → 2,641 → 2,855 (−33.8 %) | 86.2 = 86.2 |
| roller, text-like, 2 layers | 137 → 100 → 54 | 71 → 38 → **2** | 5,086 → 3,356 → 3,523 | 92.0 = 92.0 |
| roller, rectangle / border / stripes | 3→2→2 / 135→88→42 / 5→5→5 | 2→2→**2** / 71→32→**2** / 5→5→**5** (all at the edge) | 295→170→170 / 4,484→2,817→3,181 / 15 | equal |
| roller, 8 rings 4×2 ×2 passes | 288 → 575 → 145 | 240 → 195 → 0 | 5,334 → 1,230 → 6,144 (+15.2 %) | 192.8 = 192.8 |

- "Against" here counts a lit run whose first Y-moving lit step goes the other way from the last Y move before it. The PR's own test counts only a run whose *first* step turns, so this count is the stricter of the two.
- 6000 mm/min rows give the same order (only speeds change).

**What did not change (main against pre-#1841, every rotary row):**
- the multiset of lit edges, undirected: same hash;
- the cut length per decoded speed (the dose bands of ADR-127 Amd 5/7): same;
- the process bounds `0xE7 0x03/0x07`: same.

Also:
- No decoded move lies outside the process bounds (0 in all 74 encoded files), and no malformed move records were found.
- Approach moves are laser-off records only: the lit-edge multiset is unchanged.
- Flat bed and rotary off: **32 of 32 files byte-identical** to before #1841.
- Fill on `.rd` is refused before this code ("Fill/Image raster output … does not support yet"), so Fill and Image do not reach this path.
- Passes: Amd 7 had burned the second pass of a piece right after the first (106 runs for a two-pass circle). Main burns about twice the single-pass runs (224), as path order did (225), so its ETA rises with it (37.8 → 58.7 s).

**Speed (`d4-rd-perf.mts`).** 800 rings (19,200 segments) on a roller encode in 642 ms on main, against 2,116 ms before #1841. The Time tile runs the same encoder, so it got faster, not slower.

## Mutants (own, `d5-mutants.mjs` → `out/d5-mutants.txt`)

Each mutant ran against the PR's test files for its area, with one worker, and every mutated file was restored and compared equal with `j36-main` (`restored=true` in all 14).

| Mutant | Test files | Result | Failing test |
|---|---|---|---|
| D1 `WHOLE_TURN_SNAP` back to 1e-12 | `dxf-curve-sampling`, `dxf-arc-sweep` | **KILLED** | "keeps the full circle 12.3457° → 372.346° written to 6 significant digits" |
| D2 near-zero snap without the one-turn condition | same | **KILLED** | "keeps the small arc 359.99° → 0.01° (0.02°) small" |
| D3 near-full snap removed | same | **KILLED** | "keeps the full circle 372.346° → 12.3457° …" |
| D4 `isFullEllipseSweep` back to `>= 2π − 1e-9` | same | survived (equivalent: a snapped sweep is exactly 2π, any other is at least 6.3e-4 short) | — |
| G1 reuse check back to live-vs-live key | `job-review-gate.recompile`, `.reuse`, `prepared-job-review` | **KILLED** | "recompiles when 'camera placement was turned on'" |
| G2 rebuilt key taken *after* the compile | same | survived (a race-only difference) | — |
| G3 `prepareFramedStartReview` stores no key | same (no `framed-start-preparation` test exists) | **survived** | — |
| F1 Z left out of the Frame check for **every** job | `required-frame-readiness`, `rotary-axis-restart.simulator`, `rotary-axis-abort.simulator` | **survived** | — |
| F2 the Z-rotary check also drops X | same | **survived** | — |
| F3 fix reverted (Z compared on a Z rotary) | same | **KILLED** | "starts after one Frame when the part was turned (C2 verification E3-P3-3)" |
| R1 no approach (always direct) | `rd-rotary-direction`, `rd-rotary-route` | **KILLED** | "a Ø30 circle on a 40 mm/turn chuck, Ø80 glass" |
| R2 approach not clamped | same | **KILLED** | same (bounds assertion) |
| R3 sweep ignores the burn direction | same | **KILLED** | same |
| R4 classes in speed order again (Decision 4) | same | survived | — |

The survivors that matter are F1 and F2 (the safety side of the Frame gate) and G3 (Decision 1 of ADR-345 Amd 1): see E4-P3-4.

## Findings

### E4-P1-1 — A full DXF ELLIPSE with a non-zero start, written to 3 decimals, still imports as a dot (residual of the #1832 regression E3-P1-1)

- **Where:** `src/io/dxf/dxf-curve-sampling.ts:85,104-106`. The past-a-whole-turn branch snaps a remainder to a full turn only below `WHOLE_TURN_SNAP · turn` = 6.28e-4 rad. When `s` and `s + 2π` are each rounded to 3 decimals, their difference can be off by up to 1e-3 rad.
- **Anchor:**
  - E3-P1-1 (P1, regression from #1832): "a full ellipse whatever its digits" before #1832 (`pre1832` `normalizedSweep` clamps any over-full sweep).
  - ADR-700 Amd 4 Decision 1 scopes the snap to "4 or more decimals, or 6 or more significant digits".
  - The E3 refuter's sizing: "δ = 1e-3 turn also covers 3 decimals; 2 decimals need about 2e-3".
- **Evidence:**
  - **REPRO** `d1c-quarter.mts` (UI import `importDxfFiles`; ellipse major 30 mm, ratio 0.4):
    - 41 = `4.712`, 42 = `10.996` (3π/2, `%.3f`): **2 points, open, 0.02 mm, no note**. Before #1832: 55 points, closed, the full outline.
    - 41 = `4.712`, 42 = `11.00` (`%.4g`): **0.14 mm**. Before #1832: closed.
    - Starts 0, π/2, π, −π/2 and 1.0 close at `%.3f`, and every start closes at `%.4f`.
  - **REPRO** `d2-census.mts` (20,000 starts): ELLIPSE dots on main are 18.5 % (`%.3f`), 31.8 % (`%.2f`), 23.5 % (`%.4g`) and 39.6 % (`%.3g`), against **0 %** before #1832 in each. Before #1839 the numbers were the same or worse, so #1839 did not cause this. It just stops short.
  - A related ARC residual: `%.4g` degrees still collapse in 5.1 % (before #1832: 24.3 %). This is E1-P1-2's class, not a regression.
- **Scenario:** a CAD/CAM writer that prints every real to 3 decimals (common for millimetre coordinates) exports an oval cut-out whose parameters do not start at 0, for example after a mirror or a rotation. KerfDesk imports it with no note as a 0.02 mm dot. The outline does not burn and the part is not cut out. It imported whole before #1832.
- **Severity:** P1, as E3-P1-1: a silent loss of a cut outline, on main, regressed from a correct state (METHOD §3, no reach clause). The reach is narrower than E3-P1-1:
  - it needs a non-zero start, 3-decimal (or 4-significant-digit) radians, and an unlucky rounding (about one in five starts);
  - no real exporter's habit is verified, as for E3.
- **Announced?** Partly. ADR-700 Amd 4 says "4 or more decimals … round well inside it". It does not say that 3-decimal ellipses can still become dots.
- **Novelty:** Residual of KNOWN E3-P1-1, through a trigger the fix's tests do not cover (they test 4–10 decimals).
- **Fix direction:**
  - Use a wider tolerance for the past-a-whole-turn branch only, for example 2e-3 turn (0.72°, 0.0126 rad). That covers 2 or more decimals and 4 or more significant digits. It never touches a sweep within one turn, so genuine small arcs stay as they are, and a 0.7° arc written as "s → s + 360.7°" is not a plausible drawing.
  - Keep the near-full snap at 1e-4 (E4-P3-1).
  - Add `4.712 → 10.996` and a seeded `%.3f` / `%.4g` census to `dxf-curve-sampling.test.ts`.

### E4-P3-1 — A deliberately open ARC or ELLIPSE whose gap is under 1e-4 of a turn now imports as a closed circle

- **Where:** `dxf-curve-sampling.ts:105` (`turn - sweep <= snap` with no condition) and `dxf-entities.ts:111`.
- **Evidence:** **REPRO** `d1-dxf.mts`:
  - ARC r = 20, `0 → 359.965 … 359.9999`: closed circle, 125.591 mm (before #1839: open, 125.549–125.561 mm);
  - `0 → 359.964` stays open;
  - ELLIPSE `0 → 2π − 0.0006`: closed (before: open).
- **Scenario:** a ring drawn with a single bridge, kept as one ARC with a 0.03° gap. The gap at radius R is R · 6.3e-4: 0.06 mm at R = 100 and 0.28 mm at R = 450, about a microjoint on a large ring. The ring imports closed and the bridge is gone.
- **Severity:** P3. ADR-700 Amd 4 chose and announced this ("A deliberately open arc whose gap is under 0.036° now imports as a full circle … in practice a rounding artefact"). Below R ≈ 150 mm the gap is under a kerf.
- **Announced?** Yes (ADR-700 Amd 4, Consequences).
- **Novelty:** New behaviour from #1839. The brief's own expectation for `359.99°` ("stay partial") does not hold by design.
- **Fix direction:** none needed unless the maintainer wants bridges on large rings. If wanted, scale the near-full snap with the printed precision (the smaller of 1e-4 turn and 10 ulps of the printed decimals) or tie it to an absolute gap (for example 0.02 mm at the arc's radius).

### E4-P3-2 — `.rd` rotary: a piece that starts at its part's Y edge still starts against the rotary

- **Where:** `src/core/controllers/ruida/rd-rotary-order.ts:157-166`. `entryInto` clamps the approach point to `yRange` (the input part's bounds). For a start at `minY` or `maxY` going inward, the approach equals the start, and the direct, against-the-rotary entry is used.
- **Anchor:** ADR-127 Amd 8 Decision 3 ("every burn starts the way it goes on") and its Consequences ("No burn starts against the rotary").
- **Evidence:** **REPRO** `d3-rd.mts`, against-starts on main:
  - rectangle 60×24: 1 (chuck) and 2 (roller);
  - text inside a border: 2 (both on the border's sides);
  - stripes round the part: 5 of 6.

  All of these are at the part's Y edge, and the counts are equal to before #1841 (and, for stripes, to the flat bed). Two layers of text add 1–2 more (`2 layers 600/3000`), because a layer's own Y range is narrower.
- **Scenario:** a text block with a border on a tumbler. The border's sides span the part's whole Y range, so one of them starts with the rotary's backlash taken up inside the burn. That is the seam Amd 8 meant to remove.
- **Severity:** P3. It is not a regression (same counts before #1841), the seam effect is unverified on hardware, and it is 1–5 burns per job. The ADR's claim is broader than the code.
- **Announced?** No. The ADR says "No burn starts against the rotary".
- **Novelty:** New (the PR's test shapes are closed ovals and circles, which never start at an edge).
- **Fix direction:**
  - Allow the approach to run up to `APPROACH_UM` outside the part's Y range when the rotary's wrap limit and the file's bounds allow it, and widen the declared process bounds by that much.
  - Or, failing that, enter such a piece from its other end when that end is not at an edge.
  - Add a rectangle and a border-with-text row to `rd-rotary-direction.test.ts`, and correct the ADR wording.

### E4-P3-3 — `.rd` rotary on a k > 1 roller: laser-off travel and job time can rise well past the stated "+2 %"

- **Where:** `rd-rotary-order.ts` sweep rule (Decision 1–2): every sweep crosses the whole Y range of the part, which on a k > 1 roller is k times the drawing's height.
- **Anchor:** ADR-127 Amd 8, Consequences: "Travel returns close to the old level there: up to 2 % above it for text-like shapes."
- **Evidence:** **REPRO** `d3-rd.mts`, roller 360 mm/turn Ø25:
  - 8 rings Ø5 in a 4×2 grid: laser-off travel 2,659 (path order) → 1,165 (Amd 7) → **3,251 mm (+22.3 % over path order)**. ETA 66.9 → **100.7 s (+50 % over Amd 7)**.
  - The same with 2 passes: 5,334 → 6,144 mm (+15.2 %).
  - Circle, rings in a row and text: −5.8 % to −33.8 %.
  - The ETA matches the route in every row.
- **Severity:** P3. Time only: nothing burns differently, and the ETA is right. It is the stated trade-off of fewer turns against travel, but the bound in the ADR is not general.
- **Announced?** Partly (the ADR says travel rises on k > 1 rollers, but bounds it at 2 %).
- **Novelty:** New.
- **Fix direction:** either correct the ADR's bound, or cap the sweep's travel: for example, take the cheapest entry when the sweep's next piece is farther than some multiple of the nearest piece. Measure two-row clusters in the test.

### E4-P3-4 — The new tests do not pin the safety side of the Z-rotary Frame exemption, or the Start review's stored key

- **Where:**
  - `src/ui/laser/required-frame-readiness.ts:41-56` and `src/ui/state/framed-run-rotary.ts:46-50`, with their tests `required-frame-readiness.test.ts`, `rotary-axis-restart.simulator.test.tsx` and `rotary-axis-abort.simulator.test.tsx`;
  - `src/ui/laser/framed-start-preparation.ts:61-67,99`.
- **Evidence:** **RUNS** `d5-mutants.mjs`:
  - **F1** (Z left out of the Frame check for every job) and **F2** (the Z-rotary check drops X too) survive all three test files.
  - **G3** (the framed Start review stores no key) survives the gate and phone tests. No `framed-start-preparation` test exists.
  - The code is correct today. **REPRO** `zz-e4-frame-z.simulator.test.tsx`: Z+3 refused on no-rotary, Y and A jobs; X+1 and Y+1 refused on a Z rotary.
- **Scenario:**
  - A later edit that widens the exemption (for example, dropping the `framesZRotary` condition) passes CI. A CNC job's Frame-first check would then stop comparing the Z work offset.
  - That is the cut depth's reference. The permit's own invalidation (51 reset sites, including console and jog) is then the only guard.
  - G3 would quietly make every Start review recompile at Confirm and stop the phone reusing the desktop review (fail-safe).
- **Severity:** P3. Test gaps behind correct code, with defense in depth (METHOD: a test gap is P2 at most). F1 would need a second independent miss to cause harm.
- **Announced?** No.
- **Novelty:** New.
- **Fix direction:**
  - In `required-frame-readiness.test.ts`, add rows: a non-rotary, a Y-rotary and an A-rotary prepared job refuse a Z-only offset change; a Z-rotary job refuses an X-only and a Y-only change.
  - Add a `prepareFramedStartReview` test that the ordinary bundle carries `preparedMachineInputsKey` and that Confirm reuses it when nothing changed.

## KNOWN — status of every item in scope

| Item | Fix | Status on `8d92bd143` | Evidence |
|---|---|---|---|
| E3-P1-1 ELLIPSE 2π rounded up → dot (regression from #1832) | #1839 | **Fixed for 4 or more decimals and 5 or more significant digits** (0 % dots, every start). **Residual at 2–3 decimals / 3–4 significant digits with a non-zero start: E4-P1-1** (18.5–39.6 %; before #1832 0 %) | d1, d1c, d2 |
| E3-P1-2 ARC s → s + 360 at 6–12 significant digits → dot | #1839 | **Fixed** (0 % for `%.5g`–`%.14g` and every `%.Nf`; was 5.1–15.9 %). `%.4g` 5.1 % and `%.3g` 16 % remain (E1-P1-2's class; noted in E4-P1-1) | d1, d2 |
| E3-P2-1 reuse check blind to camera facts | #1840 | **Fixed**: camera changes recompile (1 compile); warnings equal a fresh compile (5 = 5); no change means 0 compiles; the phone reuses only under the same key and cannot confirm | v1 probe; G1 killed |
| E3-P2-2 `.rd` rotary reversals rose | #1841 | **Fixed for the measured shapes**: turns at or below path order (e.g. 162 → 81, 142 → 52); against-starts 0 on circles, rings and text. **Not for edge-starting pieces (E4-P3-2)**; travel +22 % on a roller grid (E4-P3-3) | d3 |
| E3-P3-3 Z rotary needs a second Frame after a turn | #1840 | **Fixed**: streams after one Frame; Z left out only on a Z rotary; X/Y changes and every other rotary still refuse. The safety side is untested (F1/F2 survive: E4-P3-4) | v2 simulator; F3 killed |
| E3-P1-1/P1-2 fix tests | #1839 | Kill D1, D2 and D3. D4 is equivalent | d5 |

## Verified clean

- **#1839:**
  - genuine tiny arcs (1e-6–1e-2 turn, 35 ARC and 20 ELLIPSE cases, across 0°);
  - sweeps over a turn; negative, huge, NaN and Inf angles;
  - ELLIPSE partial parameters, the canonical curve, the bulge path, and the `isFullEllipseSweep` agreement;
  - no caller of the rule outside `dxf-entities.ts`.
- **#1840:**
  - no needless recompile (0 compiles when nothing changed, including placement on then off);
  - recompiles on every camera fact; warnings equal a fresh compile's;
  - a changed model needs a second click; the phone is read-only and key-gated;
  - the Z exemption is only for Z rotaries; the permit's own invalidation still catches console and jog changes;
  - the 104 tests in the 9 touched or related files pass.
- **#1841:**
  - flat bed and rotary off are byte-identical (32 files);
  - lit edges, the dose per speed and the process bounds are identical;
  - no move leaves the bounds, and no approach is lit;
  - ETA = route in every rotary row (74 encoded files); encoding is faster.

## Not verified

- **Hardware:** Ruida seams and backlash (E4-P3-2's harm), and whether a Ruida follows the route ETA.
- **Browser:** the real Job Review dialog, and the phone page (driven at the function level only).
- **"Camera may have moved":** not toggled end to end. It needs a running camera model. Its warning is in the same key (`start-machine-snapshot.ts:69-70`), so READ only.
- **Real exporters' DXF number formats:** as for E3, E4-P1-1 rests on plausible `printf` formats, not files from real tools.
- **The full suite:** only the 9 touched or related test files and the own probes ran.
- **Laser second pass:** its reuse path (`refreshFrozenReview`) by READ only.

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-e4\`. Run TS with `node --no-experimental-webstorage --import ./register.mjs <file> [tree]` from that folder (tree defaults to `../j36-main/src/`; `./pre1839/src/`, `./pre1832/src/`, `./pre1841/src/`, `./pre1833/src/` for before). Vitest files run from `mut\` with `node node_modules/vitest/vitest.mjs run <file> --pool=threads --no-file-parallelism --maxWorkers=1`.

| File | What | Output |
|---|---|---|
| `register.mjs`, `ts-resolve.mjs` | Loader (from `zz-e3r`, re-pointed at `j36-main`; bare imports from `pre18xx` / `mut` resolve through `j36-main`) | — |
| `pre1832\`, `pre1833\`, `pre1839\`, `pre1840\`, `pre1841\` | `git archive` of `src/` at `1f016b610`, `b0e4ee3ce`, `32d312ac1`, `8443bda29`, `ac4b11370` | — |
| `d1-dxf.mts [tree]` | DXF sweeps, regression side, bulges, through `importDxfFiles` | `out/d1-main.txt`, `out/d1-pre1839.txt`, `out/d1-pre1832.txt` |
| `d1b-curve.mts [tree]` | Canonical curve of snapped turns | `out/d1b-main.txt`, `out/d1b-pre1839.txt` |
| `d1c-quarter.mts [tree]` | E4-P1-1 (quarter-turn starts at 3 decimals) | `out/d1c-main.txt`, `out/d1c-pre1832.txt` |
| `d2-census.mts` | Census on three trees; `isFullEllipseSweep` agreement | `out/d2-census.txt` |
| `mut\src\ui\laser\job-review\zz-e4-review-probe.test.ts` | E3-P2-1 reuse, compile counts, phone | `out/v1-review-probe.txt` |
| `mut\src\ui\laser\zz-e4-frame-z.simulator.test.tsx` | E3-P3-3 Frame gate, simulator | `out/v2-frame-z.txt` |
| `d3-rd.mts [tree] [label] [json]`, `d3-compare.mjs` | `.rd` order, own decoder, ETA | `out/d3-*.txt`, `out/d3-*.json`, `out/d3-compare.txt` |
| `d4-rd-perf.mts [tree]` | Encode time | `out/d4-main.txt`, `out/d4-pre1841.txt` |
| `d5-mutants.mjs` | 14 own mutants (mutates `mut\` only, restores, compares) | `out/d5-mutants.txt` |
| — | PR test files on `mut` | `out/v3-pr-tests.txt` |

## Counts

Raised **5**: P1 **1** (E4-P1-1), P2 **0**, P3 **4** (E4-P3-1, E4-P3-2, E4-P3-3, E4-P3-4). Known items with a status: **5** (E3-P1-1, E3-P1-2, E3-P2-1, E3-P2-2, E3-P3-3). E4-P1-1 is a residual of E3-P1-1. E4-P3-2 is a residual of E3-P2-2 (not a regression).

## Refuter (2026-11-12)

**Tree and harness.** Same read-only export `j36-main` (`origin/main` @ `8d92bd143`). Own scripts in `zz-e4r\`, run with `node --no-experimental-webstorage --import ./register.mjs <file> <tree> <label>` from `zz-e4r`. The loader is my own copy: esbuild from `j36-main`, and bare imports from any tree under `zz-e4r` resolve through `j36-main`'s `node_modules`. I read the auditor's scripts for API shape only. Nothing imports or reruns them.
- **Before trees:** my own `git archive` (read only) of `src/` at the exact first parents. `pre1839` = `8443bda29^1` = `32d312ac1`. `pre1840` = `ac4b11370^1` = `8443bda29`. `pre1841` = `8d92bd143^1` = `ac4b11370`. `pre1832` = `f6401fc63^1` = `1f016b610` (#1832's merge, found with `git log --grep "#1832"`). `pre1833` = `e6f1ebcbe^1` = `b0e4ee3ce`.
- **DXF:** `parseDxf` directly. That is the parser behind both the main-thread fallback and, through the same entity collector, the worker's `parseDxfBlob`. The auditor went through `importDxfFiles` instead.
  - The DXF text, the ellipse and the arc are my own: major axis 25 mm at 45°, ratio 0.6, Ramanujan perimeter 127.64 mm; ARC r = 15.
  - Census starts lie on a stratified grid (`(i + 0.5)/N`), not a golden-ratio sequence.
  - The tolerance study (R2) uses my own copy of the sweep rule with the tolerances as parameters. It agrees with main's exported `counterClockwiseSweep` in 200,000 of 200,000 random pairs at 1e-4.
- **`.rd`:** my own reader (R3).
  - Unscrambling uses the textbook form (minus 1, xor 0x88, swap bits 0 and 7), not an inverse table and not the repo's `unswizzleByte`.
  - Record lengths come from an opcode table (0x88/0xA8: 10, 0x89/0xA9: 4, 0x8A/0x8B/0xAA/0xAB: 2), not from a high-bit split.
  - 0 unparsed move records in 90 files.
  - My own shapes, all Ø5 rings unless stated: 4×2 at 8 and 12 mm pitch, 2×4, 3×3, 8×1, 6×2, 4×2 Ø3 rings, one Ø20 ring, a 50×20 rectangle, and that rectangle with 6 rings inside.
  - Rotaries: flat; chuck 40 mm/turn Ø80; a real `type: 'roller'` at 360 mm/turn with a Ø25 roller (k ≈ 4.6; the auditor used a chuck with the same k).
  - ETA: the app's `estimateJobDuration` with `withRuidaRotaryRoute`.
- **Frame gate (R4):** `requiredFrameIssueFromPrepared` called directly with real `prepareOutput` jobs and recorded or live work offsets. No controller, so a different method from the auditor's simulator.
- **Mutants (R5):**
  - my own copy `zz-e4r\mut\` (`src`, `public`, `scripts`, root configs, `node_modules` junction);
  - my own mutant text, run against **wider** file lists than the PRs' own: 12 Frame files, 9 review files, 4 `.rd` files, 3 DXF files;
  - `NODE_OPTIONS=--no-experimental-webstorage` (Node 25 shadows jsdom's `localStorage`; without it, `run-again-review-carry.conditions` and 4 review files fail at baseline);
  - baseline 360 of 360 tests pass, run with `--pool=threads --no-file-parallelism --maxWorkers=1`;
  - every mutated file compared byte-equal with `j36-main` afterwards.
- **Not used:** hardware, a browser, pnpm, building, live services. Vitest ran one file list at a time with 2.3–2.6 GB free.

### Verdicts

| Finding | Verdict | Evidence (own) |
|---|---|---|
| E4-P1-1 | **CONFIRMED, P1, regression from #1832** (residual of E3-P1-1). **Wider than stated:** 1–3 decimals and 3–4 significant digits, and `−π → π` at 3 decimals is a dot every time. **Fix direction corrected:** 2e-3 turn breaks two pinned tests | R1, R1b, R2 |
| E4-P3-1 | **CONFIRMED, P3** (by design, announced). Bites only above R ≈ 160–320 mm (kerf 0.1–0.2 mm) | R1, arithmetic |
| E4-P3-2 | **CONFIRMED, P3** (not a regression; structural under the ADR's own clamp) | R3, READ |
| E4-P3-3 | **CONFIRMED, P3, wider:** up to **+42 %** travel over path order, and ETA **+49–58 %** over main before #1841 on every roller cluster | R3 |
| E4-P3-4 | **CONFIRMED, P3, scope corrected.** F1/F2 survive 12 files, not just 3. **G3 is refuted:** it is killed by 20 tests in 4 existing files. Two new survivors: a keyless bundle reused (K2), and a near-full snap 3× wider (D2) | R5 |

**Verified-clean claims checked:**
- #1839 genuine small arcs: held, unchanged by construction. The far-turn branch needs `|end − start| ≥ turn`, and pinned small cases pass.
- #1840 Z exemption only on a Z rotary: held (R4). A disabled Z rotary and a CNC project whose device still carries a Z rotary also refuse a Z-only change.
- #1841 flat bed byte-identical: held (10 of 10 own flat files, also equal to `pre1833`). Lit length identical in 30 of 30 files across main, `pre1841` and `pre1833`.
- The camera "5 = 5 warnings" and phone rows: held by READ and by mutant K1. Not re-run as a store-level probe.

### Per-finding notes

**E4-P1-1: CONFIRMED P1, regression from #1832, wider than reported.**
- **R1 (parseDxf, my own ellipse).** No row produces any note.

  | ELLIPSE 41 → 42 | main `8d92bd143` | before #1839 | before #1832 |
  |---|---|---|---|
  | `4.712 → 10.996` (3π/2, `%.3f`) | **2 points, 0.020 mm** | 0.020 mm | closed, 127.55 mm |
  | `4.712 → 11.00` (`%.4g`) | **0.120 mm** | 0.120 mm | closed |
  | `0.785 → 7.069` (π/4, `%.3f`) | **0.017 mm** | — | closed |
  | `2.5 → 8.79` (`%.2f`) | **0.131 mm** | — | closed |
  | `−3.142 → 3.142` (−π → π, `%.3f` and `%.4g`) | **0.012 mm** (R1b) | 0.012 mm | closed |
  | `−3.1416 → 3.1416`, `−3.141593 → 3.141593` | closed | **0.000 mm** | closed |
  | `1.571 → 7.854`, `3.142 → 9.425`, `0 → 6.283` | closed | open, near-full | open, near-full |

- **The −π → π case is not "an unlucky start".** π rounds up at 3 decimals and at 4 significant digits (3.142), so a writer that gives full ellipses in atan2's range (−π, π] produces a dot *every time*. The auditor's "about one in five starts" understates the reach for that class of writer.
- **Census (R1, 4,000 stratified starts per row, through parseDxf).**

  | Format | ELLIPSE dot: main / pre-#1839 / pre-#1832 | ARC dot: main / pre-#1839 / pre-#1832 |
  |---|---|---|
  | `%.1f` | **83.1** / 83.1 / 0 % | 0 / 0 / 11.6 % |
  | `%.2f` | **31.9** / 31.9 / 0 % | 0 / 18.2 / 23.4 % |
  | `%.3f` | **18.7** / 18.7 / 0 % | 0 / 0 / 10.4 % |
  | `%.4f` | 0 / 85.5 / 0 % | 0 / 0 / 10.4 % |
  | `%.3g` | **40.6** / 40.7 / 0 % | 12.6 / 12.6 / 12.6 % |
  | `%.4g` | **27.3** / 35.8 / 0 % | **3.9** / 12.7 / 24.2 % |
  | `%.5g`, `%.6g` | 0 / 67.0, 50.9 / 0 % | 0 / 26.1, 0 / 31.3, 10.4 % |

  - `%.3f` matches the analytic share exactly: 1 − frac(2000π) = 0.1853.
  - The auditor's 23.5 % for `%.4g` came from a different start sample; mine is 27.3 % on a uniform grid over [0, 2π).
  - **Every ELLIPSE row from 1 to 3 decimals and from 3 to 4 significant digits is a #1832 regression** (0 % before #1832). The finding's title should say "3 or fewer decimals, 4 or fewer significant digits".
- **ARC at 3 decimals and 4 significant digits.**
  - `%.Nf` degrees: 0 % at every N on main, because 360 is exact in decimal.
  - `%.4g`: still 3.9 % dots (`123.4 → 483.5` is 0.026 mm, the same before #1832). It fell from 24.2 % before #1832, so it is **not a #1832 regression**. It is a residual of KNOWN E1-P1-2 / E3-P1-2.
  - The ledger should mark E3-P1-2 "fixed for 5 or more significant digits; residual at 4" rather than plain "Fixed". That is a status note, not a new finding.
- **Severity.**
  - The output is wrong: the outline is missing, so the part is not cut.
  - Nothing warns: no note, no skipped summary, and "Imported 1 path" as normal.
  - METHOD §3 has no reach clause, so P1 stands, rated as E3-P1-1 was.
- **Safe tolerance (R2): worst rounding error per format, as a share of a turn.**
  - ELLIPSE, rounded up past a turn: `%.1f` 2.7e-3, `%.2f` 1.08e-3, `%.3f` **1.30e-4** (just over main's 1e-4), `%.4f` 2.3e-6, `%.3g` 7.5e-3, `%.4g` 7.7e-4, `%.5g` 8.2e-5.
  - ARC, rounded up past a turn: `%.3g` 1.39e-3, `%.4g` 1.39e-4; under 3e-6 for every `%.Nf`.
- **Candidate rules (R2), 20,000 starts per format, against the small cases the shipped tests pin.**

  | Rule (far-turn tolerance; near-full kept at 1e-4) | Dots left | Pinned small cases made full |
  |---|---|---|
  | main, 1e-4 | E `%.1f` 83 %, `%.2f` 32 %, `%.3f` 19 %, `%.3g` 41 %, `%.4g` 27 %; A `%.3g` 12.5 %, `%.4g` 4.1 % | none |
  | **auditor, 2e-3 for both** | E `%.1f` 83 %, `%.3g` 15.5 % | **ARC `0 → 360.5` and ELLIPSE `0 → 2π + 0.01`** |
  | E3 refuter, 1e-3 for both | E `%.1f`, `%.2f` 32 %, `%.3g` 33 %; A `%.3g` 4.2 % | none |
  | **ELLIPSE 1.5e-3, ARC 5e-4** | E `%.1f`, `%.3g` 15.5 %; A `%.3g` 9.7 % | none |

  - **Correction to the fix direction.** 2e-3 turn does leave arcs within one turn alone, because the branch needs `|end − start| ≥ turn`. But it turns two cases that `dxf-arc-sweep.test.ts:90` and `dxf-curve-sampling.test.ts:157` pin as small arcs into full circles: `0 → 360.5` (1.39e-3 turn) and `0 → 2π + 0.01` (1.59e-3 turn).
  - A **per-unit** far-turn tolerance passes every pinned case and clears `%.2f`, `%.3f` and `%.4g` for ELLIPSE and `%.4g` for ARC. Radians are never exact in decimal, so ELLIPSE gets ≈ 1.5e-3 turn (0.0094 rad). ARC gets ≈ 5e-4 turn (0.18°).
  - `%.1f` and `%.3g` radians cannot be cleared without un-pinning `0 → 2π + 0.01`. That needs a maintainer decision (or ELLIPSE's pre-#1832 rule back, "a positive difference past a turn is the full ellipse", which `normalizedSweep(0, 2π + π/2) ≈ π/2` at `dxf-curve-sampling.test.ts:113` now pins against).
  - Add `−3.142 → 3.142` and `4.712 → 10.996` to the tests.
  - ADR-700 Amd 4's Consequence says circles and ellipses import whole "whatever the printed precision". That is false for 3 decimals and should be corrected with the fix.

**E4-P3-1: CONFIRMED P3.**
- **R1:** ARC r = 15:
  - `0 → 359.99` and `0 → 359.97` import closed, 94.16 mm;
  - `0 → 359.96` stays open;
  - before #1832, all three were open.
- **Gap that disappears:** 2πR · 1e-4 = R · 6.28e-4. That is 0.031 mm at R = 50, 0.063 at R = 100, 0.094 at R = 150, 0.126 at R = 200, 0.188 at R = 300, 0.283 at R = 450 and 0.440 at R = 700.
- **What actually holds the part:** the bridge left after the kerf is the gap minus the kerf.
  - With a 0.1 mm kerf it is 0 below R ≈ 160 mm, 0.09 mm at R = 300 and 0.18 mm at R = 450.
  - With a 0.2 mm kerf it is 0 below R ≈ 320 mm.
- **So the deliberate-bridge scenario needs both of these:**
  - a ring of R ≥ about 300–450 mm (0.6–0.9 m across: a 1300×900 bed or larger);
  - a bridge of 0.1–0.2 mm, drawn as the single gap of one ARC.

  That bridge is below a usable microjoint, and tabs of 0.3 mm and up are never closed, because at R = 450 the snap closes only gaps under 0.283 mm.
- **Severity:** a lost part, in a rare shape. The decision is announced (ADR-700 Amd 4, Consequences), so it stays P3. Not P1/P2: at the radii where the snap closes a gap, the kerf would leave a bridge of at most about 0.1–0.2 mm, which cannot hold a part reliably anyway.

**E4-P3-2: CONFIRMED P3.**
- **R3 (own shapes):**
  - rectangle 50×20: 1 burn against the rotary on the chuck and 2 on the roller, all at the part's Y edge, on main and before #1841 alike;
  - rectangle with 6 rings inside: 113 → **1** (chuck) and 202 → **2** (roller), the remaining ones all at the edge;
  - every ring cluster: 0.
- **Why it is structural (READ, `rd-rotary-order.ts:146-155`).** Take two strokes that both span the part's full Y range, such as a rectangle's sides, which surface-speed classing splits into their own pieces. After the first goes +Y, the second can only be burned −Y from the top, or +Y after a laser-off move down to `minY`. Either way the burn starts against the last turn. Only an approach below `minY` avoids that, and Decision 3 forbids it ("stays inside the part's own Y range").
- **So the ADR contradicts itself:** Decision 3's clamp makes the Consequence "No burn starts against the rotary" impossible for such shapes. That is doc/code drift with no regression, so P3.

**E4-P3-3: CONFIRMED P3, wider than reported.** R3, laser-off travel in mm, path order (`pre1833`) → Amd 7 (`pre1841`) → main, with the app's ETA for Amd 7 → main:

| Roller k ≈ 4.6 | Travel | vs path order | App ETA (s) |
|---|---|---|---|
| 4×2 rings, 8 mm pitch | 3,702 → 1,644 → **4,616** | **+24.7 %** | 89.3 → **137.3** (+54 %) |
| 4×2 rings, 12 mm pitch | 4,260 → 2,357 → **6,039** | **+41.8 %** | 99.9 → **149.0** (+49 %) |
| 2×4 rings | 4,558 → 2,241 → 5,285 | +16.0 % | 97.4 → 144.4 (+48 %) |
| 3×3 rings | 4,593 → 2,103 → 5,685 | +23.8 % | 104.0 → 159.7 (+54 %) |
| 6×2 rings, 7 mm pitch | 5,191 → 2,024 → 6,429 | +23.8 % | 126.9 → 200.2 (+58 %) |
| 4×2 Ø3 rings, 5 mm pitch | 2,248 → 1,020 → 2,876 | +27.9 % | 70.0 → 108.7 (+55 %) |
| 8×1 rings | 3,685 → 1,345 → 3,294 | −10.6 % | 85.3 → 123.8 (+45 %) |
| one Ø20 ring | 2,850 → 1,650 → 2,658 | −6.7 % | 32.6 → 44.6 (+37 %) |
| rect + 6 rings | 3,598 → 1,649 → 3,629 | +0.9 % | 83.1 → 115.6 (+39 %) |

- **Measured against main before #1841** (the brief's question), every roller job with more than one piece got 37–58 % longer, not only the grid. The ADR announces this in kind: its own table shows roller travel rising from Amd 7's level back to path order's.
- **What is not announced:** its bound. "Up to 2 % above it", where "it" is path order's level, fails for any two-row cluster (+16 to +42 %).
- **On the chuck,** travel rose only 4–17 % over Amd 7 and stayed 42–60 % below path order.
- **Turns** fell to at or below path order in all 20 rotary rows, and burns started against the rotary fell to 0 except at the edges (E4-P3-2).
- **Severity:** time only. Lit length is identical, and the ETA follows the route by construction (`rd-rotary-timing.ts:19-20` times `encodeRdJob(...).motion`). So P3 (doc drift plus a performance trade). P2 would need a misleading result, and the ETA is not misleading.
- **Fix direction:** as the auditor says, plus measure the cost against Amd 7 as well as path order in `rd-rotary-direction.test.ts`, and state the roller's ETA rise in the ADR.

**E4-P3-4: CONFIRMED P3, scope corrected.** R5, my own mutants on wider file lists:

| Mutant | What | Files | Result |
|---|---|---|---|
| Z1 | `zRotary` true for every prepared job (≈ F1) | 12 Frame files (78 tests) | **SURVIVED** |
| Z2 | the Z-rotary offset also drops **Y** (≈ F2, other axis) | same | **SURVIVED** |
| K1 | `prepareFramedStartReview` stores no key (= G3) | 9 review files (169 tests) | **KILLED**, 20 tests in 4 files |
| K2 | a bundle **without** a key is reused (Decision 2 of ADR-345 Amd 1 reversed) | same | **SURVIVED** |
| S1 | the sweep does not count "ahead" again | 4 `.rd` files | KILLED (`rd-rotary-direction`, 8 rings) |
| S2 | no extra cost for a burn against the rotary | same | KILLED (6 tests) |
| D1 | near-full snap 10× narrower | 3 DXF files | KILLED |
| D2 | `WHOLE_TURN_SNAP` 3× wider (3e-4) | same | **SURVIVED** |

- **G3 is refuted.** The 4 files that kill K1 are `artwork-light-spatial-edit`, `selected-artwork-light-target`, `frame-artwork-centre-led.simulator` and `frame-assumed-offset-centre-led.simulator`. Their assertion is "The exact prepared program must cross the real serial handoff once" (`out/r5-k1-detail.txt`). The auditor ran G3 only against the gate and phone files.
- **The Frame side stands and is wider:** Z1 and Z2 survive 12 files that include the general Frame-gate suites (`start-job-placement`, `no-homing-frame-gate`, `frame-verification-motion-bounds` and others), not just the PR's 3.
- **New survivors in the same class:**
  - K2: no test pins "a bundle without a key is never reused". In practice it is near-equivalent today. Keyless bundles are transient-camera permits, which the project-identity check already refuses, and laser second passes, which never rebuild.
  - D2: no test pins how *narrow* the near-full snap is. A 3× wider snap passes, closing gaps of up to 0.108°. (It also clears 3-decimal ELLIPSE dots, since their worst error is 1.3e-4.)
- **Severity:** test gaps behind correct code, so P3, as the auditor rated it.
- **Fix direction:** the auditor's rows for F1/F2, plus:
  - a keyless-bundle row in `job-review-gate.reuse.test.ts`;
  - a "`0 → 359.9` stays open" row next to the near-full cases.

### New findings

None as separate findings. The notes above:
- widen E4-P1-1 (−π → π, 1–3 decimals) and correct its fix direction;
- widen E4-P3-3;
- refute the G3 part of E4-P3-4 and add K2 and D2 to it;
- correct the E3-P1-2 status: residual at 4 significant digits.

### Probes with no gap

- **Frame gate on other jobs (R4).** Main against `pre1840`, with gate cells "same / Z+3 / X+1 / Y+1 / Z+3 and X+1 / no WCO":
  - Z rotary: PASS / **PASS** / refuse / refuse / refuse / refuse, against PASS / refuse / … before.
  - No rotary, Y rotary, A rotary, a disabled Z rotary, and a CNC project whose device still holds an enabled Z rotary: unchanged; Z+3 refuses (`rotaryAppliesTo` excludes CNC).
- **Keyless bundles (READ).** These are transient-camera and laser-second-pass permits. The project-identity check refused reuse of a transient bundle before #1840 as well. A laser second pass goes through `refreshFrozenReview` and never rebuilds. So "a Frame permit's own compile is recompiled" changes nothing in practice.
- **Phone snapshot (READ).** `publishReviewedJobSnapshot` refuses a keyless bundle. `snapshotMatchesCurrent` compares the stored key with a fresh live key (`prepared-job-review.ts:164-169`), and the reader has no confirm or start path.
- **Sweep-rule callers.** Only `dxf-entities.ts` and `dxf-curve-sampling.ts` call it. The worker's `parseDxfBlob` shares `createDxfEntityCollector`.
- **`.rd` approach moves.** Lit length is identical across three trees in 30 of 30 files. Flat files are byte-identical across `pre1833`, `pre1841` and main.

### Not verified

- **Hardware:** Ruida seams and backlash (the harm in E4-P3-2), and whether a Ruida follows the route ETA.
- **Process bounds (`0xE7`)** were not decoded by my own reader. The clamp is READ only.
- **The #1840 camera rows** (5 = 5 warnings, 0 needless compiles) and the phone run were not re-run as a store probe. They rest on READ and mutant K1.
- **Simulator:** no simulator run of my own. The R4 gate table is at the function level.
- **Real exporters' radian formats:** unverified, as for E3. The −π → π class is the most plausible trigger.

### Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-e4r\`. Run them from that folder.

| File | What it covers | Output |
|---|---|---|
| `register.mjs`, `ts-resolve.mjs` | Own loader (esbuild from `j36-main`; bare imports from `zz-e4r` trees via `j36-main`) | — |
| `pre1832\`, `pre1833\`, `pre1839\`, `pre1840\`, `pre1841\` | `git archive` of `src/` at `1f016b610`, `b0e4ee3ce`, `32d312ac1`, `8443bda29`, `ac4b11370` | — |
| `r1-dxf.mts <tree> <label> [N]` | E4-P1-1 / E4-P3-1 named cases and the census, through `parseDxf` | `out/r1-main.txt`, `out/r1-pre1839.txt`, `out/r1-pre1832.txt` |
| `r1b-pi.mts <tree> <label>` | Full ELLIPSE −π → π at five precisions | `out/r1b-pi.txt` |
| `r2-rule.mts` | Worst rounding errors per format; candidate tolerances against the pinned cases | `out/r2-rule.txt` |
| `r3-rd.mts <tree> <label>` | `.rd` own reader: travel, turns, against-starts, lit length, ETA | `out/r3-main.txt`, `out/r3-pre1841.txt`, `out/r3-pre1833.txt` |
| `r4-frame-gate.mts <tree> <label>` | Frame gate decision table | `out/r4-main.txt`, `out/r4-pre1840.txt` |
| `r5-mutants.mjs [ids]` | Baselines and 8 own mutants on `mut\` (restored, compared) | `out/r5-mutants.txt`, `out/r5-k1-detail.txt` |

```json
{
  "area": "E4",
  "role": "refuter",
  "tree": "8d92bd143",
  "verdicts": [
    {"id": "E4-P1-1", "verdict": "CONFIRMED", "severity": "P1", "evidence": "REPRO r1/r1b via parseDxf: 4.712->10.996 0.020 mm, -3.142->3.142 0.012 mm, no note; pre-#1832 closed; census ELLIPSE %.1f/%.2f/%.3f 83.1/31.9/18.7 %, %.3g/%.4g 40.6/27.3 %, all 0 % pre-#1832", "note": "regression from #1832, wider than stated; auditor's 2e-3 turn breaks pinned 0->360.5 and 0->2pi+0.01; per-unit far tolerance (ELLIPSE ~1.5e-3, ARC ~5e-4 turn) passes them; ARC %.4g 3.9 % is a residual of E3-P1-2, not #1832"},
    {"id": "E4-P3-1", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO r1: ARC 0->359.99/359.97 closed, 359.96 open; gap R*6.28e-4 leaves a post-kerf bridge only above R ~160-320 mm", "note": "announced by design"},
    {"id": "E4-P3-2", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO r3: rect 1 (chuck) / 2 (roller) against, all at the Y edge, same before #1841; READ: unavoidable under Decision 3's clamp"},
    {"id": "E4-P3-3", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO r3 roller: travel up to +41.8 % over path order (4x2, 12 mm pitch); app ETA +37..58 % over pre-#1841 on every multi-piece roller job", "note": "wider than reported; ETA correct"},
    {"id": "E4-P3-4", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO r5: Z1/Z2 survive 12 Frame files; K1 (=G3) KILLED by 20 tests in 4 files; K2 keyless reuse and D2 snap x3 survive", "note": "G3 part refuted; K2 and D2 added"}
  ],
  "clean_checks": {"#1839": "small arcs within a turn untouched; pinned small cases pass", "#1840": "Z exemption only on an active Z rotary (not disabled, not CNC); phone key-gated (READ)", "#1841": "flat bytes identical (3 trees); lit length identical 30/30; turns at or below path order 20/20"},
  "new": [],
  "counts": {"raised": 5, "refuted": 0, "P1": 1, "P2": 0, "P3": 4, "known": 2}
}
```

Refuter counts: raised 5, refuted 0, P1 1, P2 0, P3 4, known 2
