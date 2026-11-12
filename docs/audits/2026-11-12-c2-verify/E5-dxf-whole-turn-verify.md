# E5 — DXF whole-turn verify (C2 fix verification)

**Question.** Does #1843 (ADR-700 Amd 5, one whole-turn allowance per unit: `ARC_WRAP_SNAP` = 5e-4 turn, `ELLIPSE_WRAP_SNAP` = 1.55e-3 turn) meet the maintainer's spec of 2026-11-13?
- A full circle or ellipse written with only 1 decimal or 3 significant digits must **not** snap: it imports exactly as its numbers say.
- Angles with 2+ decimals or 4+ significant digits that are within rounding of a whole turn, and at least a turn apart, **must** import as a full turn.
- A genuine arc within one turn must stay exactly as before.

And does it collapse anything new, the way #1820, #1832 and #1839 each did?

**Tree.** `origin/main` @ `0e1a476f5`, read-only export `j37-main`. #1843 is merge `ad5e9fdc6`; its first parent is `8d92bd143`. Between `8d92bd143` and `0e1a476f5`, `src/` differs only in `dxf-curve-sampling.ts`, `dxf-entities.ts` and the new `dxf-printed-angles.test.ts` (`git diff --stat` and `diff -rq`).

Before trees (`git archive`, read only, into `zz-e5\`):

| Folder | Commit | What it is |
|---|---|---|
| `pre1843` | `8d92bd143` (`ad5e9fdc6^1`) | main before #1843 (Amd 4) |
| `pre1832` | `1f016b610` (`f6401fc63^1`) | main before #1832 (the E3-P1-1 baseline) |
| `pre1820` | `92bccd5d3` (`2560a026a^1`) | main before #1820 (the E1-P1-2 baseline) |

**Method.**
- **READ:** #1843's whole diff (`dxf-curve-sampling.ts`, `dxf-entities.ts`, the new test, the ADR). Also read: every caller of the rule, `parse-dxf.ts`, the worker's `parse-dxf-blob.ts` and `packed-dxf-result.ts`, `dxf-import-action.ts`, `remote-control/design-imports.ts`, `reimport-selected-artwork.ts`, `dxf-expand.ts` (INSERT), `dxf-join-touching.ts` and `polyline-closure.ts`.
- **Entry point:** the import worker's own parse, `parseDxfBlob(new Blob([text]))`, then `packDxfResult` → `unpackDxfResult`. That is the path File > Import, re-import, the phone and the MCP design import all take (`parseDxfOffThread`). The main-thread fallback `parseDxf` gave byte-identical geometry on every named case (`mainThread=same`).
- **Measure:** imported polyline length, point count and closed flag. The census also checks the canonical curve, since it compares the full geometry key (points plus curve JSON) between trees.
- **Oracle "as written":** the counter-clockwise sweep of the written decimal text, computed **exactly** (BigInt, 40 places, 2π to 40 places), not in floating point. Its expected length is Simpson-integrated.
- **Writers:** own DXF text.
  - fixed decimals 1–12 and significant digits 3–12;
  - each in four rounding modes: nearest (JS `toFixed` / `toPrecision`), up (ceil), down (floor) and truncation;
  - plain decimal text, never exponents.
- **Starts:**
  - ARC every 0.1° over [−360°, 360°) (7,200), plus 1,000 random;
  - ELLIPSE every 0.002 rad over [−2π, 2π) (6,284), plus 1,000 random.
  - Variants: three more ellipse geometries (ratio 1.0, 0.05 at −115°, 0.75 at 90°) and −Z extrusion, 1,000 random starts each.
  - Every case ran through main and through `pre1843`: 1,802,592 imports per tree (3.6 M in all) across 616 format rows.
- **Not used:** hardware, a browser, pnpm, building, live services, or any PR. Vitest ran once at a time, with an explicit file list and 2.2–2.9 GB free.

## Headline

**#1843 meets the spec for every printing a real `printf` produces, and it fixes E4-P1-1 at 2–3 decimals and 4 significant digits.**
- No full ARC or ELLIPSE written to 2+ decimals or 4+ significant digits, with nearest rounding, truncation or floor, collapses in any of 1.80 M imports per tree.
- Every such pair written at least a turn apart imports closed.
- Genuine arcs within one turn are bit-identical to before #1843 (103,680 imported pairs and 200,000 rule pairs; 0 differ).
- The shipped small cases stay small, and `isFullEllipseSweep` agrees with the sweep (0 of 2,000,000).
- INSERT, MINSERT, mirrored, rotated, −Z and inch blocks, and the phone and MCP path, use the same rule.

Three things remain:
- **E5-P1-1 (residual of E3-P1-1 / E4-P1-1).** A full ELLIPSE written to **4 significant digits rounded up** still imports as a dot when its end is ≥ 10 rad (2 decimals) and its start is not (3 decimals). This is 0.76 % of starts in [0, 2π).
  - Example: `3.717 → 10.01` gives 2 points, 0.189 mm, no note. Before #1832 it was a closed 138.0 mm outline.
  - The written error, 0.00981 rad, exceeds the 0.00974 rad allowance. The ADR's own bound is "off by less than 0.01".
  - No constant can fix it while `0 → 2π + 0.0099` is pinned as a genuine short arc.
- **E5-P3-1 (decision record).** Coarse printing still closes in part, against the literal maintainer answer:
  - 38.3 % of ELLIPSEs at 3 significant digits;
  - 4.2 % of ARCs at 3 significant digits;
  - 1.2–5.1 % of ARCs at 1 decimal with directed rounding or round-half-away ties.

  The ADR announces this. Every such pair is numerically indistinguishable from a Decision 1 printing, and none harms a job.
- **E5-P3-2 (by design).** A whole turn whose printed end rounds **short**, less than a turn apart, stays an open near-full outline. Examples: 61 % of ELLIPSEs at 2 decimals, every `−3.14 → 3.14`, and 89 % at 2 decimals truncated. The spec's "at least a turn apart" excludes these, and Amd 5 Decision 2 announces them. It is unchanged since before #1832.

**Mutants.** The new test kills 11 of 16 own mutants; the older DXF suite kills 6.
- Two survivors violate the spec: ARC allowance ÷3 and ELLIPSE allowance 1.1e-3. Both fail only under directed rounding, which the test does not sample (folded into E5-P1-1).
- Two survivors are equivalent on forward forms: the guard `<` → `<=`, and dropping the far near-full side.
- One is inside the spec: ARC 3e-4.
- The E4 refuter's survivor D2 (near-full snap ×3) is now killed.

## 1. READ — what #1843 changes

- `counterClockwiseSweep(start, end, turn, wrapSnap)` (`dxf-curve-sampling.ts:106-121`):
  - a remainder within the float tolerance, or a sweep within `WHOLE_TURN_SNAP` (1e-4 turn) of full, is a full turn (`:117`, unchanged);
  - angles less than a turn apart return the sweep (`:118`, new early return, the same value as before);
  - otherwise a sweep within `wrapSnap · turn` of zero **or** of a full turn is a full turn (`:119-120`).
- Before (Amd 4), the far branch used 1e-4 for the near-zero side only, so the near-full far side is new as well (`0 → 719.82°` and `0 → −360.1°` now close; see §3).
- `normalizedSweep` passes `ELLIPSE_WRAP_SNAP` (`:124-126`); `arcSweep` passes `ARC_WRAP_SNAP` (`dxf-entities.ts:111`).
- Within one turn the code path is unchanged, so genuine arcs are identical by construction. §3 confirms it.
- Callers: only `arcInOcs` and `ellipseInOcs` (via `sampleEllipse`, `normalizedSweep` and `isFullEllipseSweep`). Bulges, CIRCLE and SPLINE do not use the rule.
- An ARC's polyline is always built open (`dxf-entities.ts:97`). A full ARC closes in `joinTouchingDxfPieces` because its curve ends where it starts (`CLOSURE_EPS_MM` = 1e-4 mm).

## 2. Collapse tables (worker import, main `0e1a476f5`)

Full tables, all 616 rows (grid, geometries, −Z): `out/c1-tables.md`. "Open near-full" means open and at least 97 % of the full length. Under the spec it is not a collapse: angles less than a turn apart.

**2a. Fine printings: 2+ decimals and 4+ significant digits.** Grid set; ARC N = 8,200, ELLIPSE N = 7,284 per row.

| Kind | Printing (all rows for the range) | Full % | Open near-full % | **Dot / partial** | At least a turn apart but not full |
|---|---|---|---|---|---|
| ARC | 2–12 dp, any rounding | 100 | 0 | **0** | 0 |
| ARC | 4 sd near / up / down / trunc | 99.2 / 91.4 / 97.2 / 86.9 | 0.8 / 8.6 / 2.8 / 13.1 | **0** | 0 |
| ARC | 5–12 sd, any rounding | 100 | 0 | **0** | 0 |
| ELLIPSE | 2 dp near / up / down / trunc | 39.1 / 37.7 / 22.6 / 10.7 | 60.9 / 62.3 / 77.4 / 89.3 | **0** | 0 |
| ELLIPSE | 3 dp near / up / down / trunc | 100 / 100 / 100 / 94.4 | 0 / 0 / 0 / 5.6 | **0** | 0 |
| ELLIPSE | 4–12 dp, any rounding | 100 | 0 | **0** | 0 |
| ELLIPSE | 4 sd near / down / trunc | 91.7 / 79.1 / 74.9 | 8.3 / 20.9 / 25.1 | **0** | 0 |
| ELLIPSE | **4 sd up** | 99.5 | 0.5 | **0.05 % dots (4)** | **4** |
| ELLIPSE | 5 sd near / up / down / trunc | 100 / 100 / 99.0 / 99.0 | 0 / 0 / 1.0 / 1.0 | **0** | 0 |
| ELLIPSE | 6–12 sd, any rounding | 100 | 0 | **0** | 0 |

The other geometries and −Z extrusion give the same picture to the row: their only non-zero fine row is ELLIPSE 4 sd up, 4 dots in 1,000 each (`out/c1-geoms.tsv`, `out/c1-ozx.tsv`). Dense probe of 4 sd up, 200,000 starts per range (`c3-directed.mts`):

| Starts | Main | Before #1843 | Before #1832 |
|---|---|---|---|
| [0, 2π) | **0.758 %** dots | 50.2 % | 0 % |
| [−π, π) | 0 % | 22.0 % | 0 % |
| [−2π, 2π) | 0.379 % | 33.8 % | 0 % |
| [−4π, −2π), rounded **down** | 0.758 % | 50.2 % | 0 % |

Every other row of that probe is 0 % on main (4 sd near, down and trunc, 5 sd up, 2 dp up, 3 dp up).

**2b. Coarse printings: 1 decimal and 3 significant digits.** "Closed, not as written" means it imported closed while its exact written sweep is not a whole turn. "Of which new" means it was not closed before #1843.

| Kind | Printing | Dots % | Partial % | Open near-full % | Full, as written % | **Closed, not as written** (of which new) | Other |
|---|---|---|---|---|---|---|---|
| ARC | 1 dp nearest | 0 | 0 | 0 | 100 | **0** | 0 |
| ARC | 1 dp up / down | 0 / 0 | 0 | 12.0 / 5.7 | 86.8 / 89.2 | **102 / 416 = 1.2 / 5.1 %** (all new) | 0 |
| ARC | 1 dp trunc | 0 | 0 | 21.9 | 78.1 | **0** | 0 |
| ARC | 3 sd nearest | 18.3 | 0 | 16.9 | 60.6 | **345 = 4.2 %** (341) | 0 |
| ARC | 3 sd up / down / trunc | 21.6 / 9.9 / 0 | 0 | 12.3 / 24.7 / 58.3 | — | **252 / 112 / 2** (251 / 110 / 0) | 0 |
| ELLIPSE | 1 dp nearest / up / down / trunc | 82.9 / 83.4 / 82.0 / 40.9 | 0 / 0 / 0 / 4.4 | 17.1 / 16.6 / 18.0 / 54.7 | 0 | **0** | 0 |
| ELLIPSE | 3 sd nearest | 7.6 | 0.2 | 53.9 | 0 | **2,792 = 38.3 %** (2,660) | 0 |
| ELLIPSE | 3 sd up / down / trunc | 10.4 / 0.2 / 0 | 6.7 / 0 / 0 | 42.0 / 78.1 / 93.3 | 0 | **40.9 / 21.8 / 6.7 %** | 0 |

- **ELLIPSE at 1 decimal:** every case imports exactly as written, in every rounding mode and geometry. 83 % become dots (`0.0 → 6.3` is a 0.0168 rad arc) and 17 % are open near-full (`−3.1 → 3.1`, 6.2 rad). None snaps. This matches "No, leave as written".
- **ARC at 1 decimal, nearest rounding:** the written numbers are exactly 360° apart, so "as written" is the full circle.
  - With ties rounded half away from zero (JS `toFixed`), `−0.25 → 359.75` prints as `−0.3 → 359.8`, 360.1° apart. That now snaps; it was a 0.1° dot before #1843 (`k1`: 25 % of a 0.25° grid).
  - Directed rounding snaps 1.2–5.1 %. See E5-P3-1.
- **3 significant digits:** every not-as-written closure has a written error within the allowance, so it is numerically a Decision 1 printing. Examples: `−360 → 0.1`, which was a 0.035 mm dot before #1843, and `0.25 → 6.54`. Everything else, dots and partial arcs, is exactly as written ("Other" = 0).
  - The single exception is "Other = 2" on the ratio-0.05 ellipse. That is a 2-point chord of a 0.097 rad arc at the ellipse tip, 0.202 mm against 0.227 mm along the curve: sampling, not the rule.

**2c. Named forms.** `out/c2-forms.txt`, nearest and truncation, every digit count.
- **ARC:** `−180 → 180`, `0 → 360`, `90 → 450`, `−90 → 270` and `45.5 → 405.5` are full at every printing. The one exception is `45.5 → 406` (3 sd), a dot, as written.
- **ELLIPSE `−π → π`:**
  - 3 dp and 4 sd (`−3.142 → 3.142`) now close; they were dots before #1843.
  - 2 dp and 3 sd (`−3.14 → 3.14`, 6.28 rad, less than a turn apart) stay open near-full. The gap is 0.0032 rad, 0.038 mm on the 30 mm ellipse.
  - Truncated 3 dp and 4 sd (`−3.141 → 3.141`) also stay open, with a gap of 0.0012 rad.
- **ELLIPSE `3π/2 → 7π/2`:** `4.71 → 11.00` (2 dp), `4.712 → 10.996` (3 dp) and `4.712 → 11` (4 sd) now close; they were dots before #1843.
- **Reverse-written `s + turn → s`** is outside the spec: less than a turn apart when it collapses.
  - ARC: 0 % dots at every fine printing.
  - ELLIPSE: dots in 8–100 % depending on digits (e.g. `6.283185 → 0`).
  - Identical before #1843 and before #1832; see "Probes with no gap".

## 3. Genuine-arc identity and over-one-turn sweeps (`g1-genuine.mts` → `out/g1-genuine.txt`)

**Within one turn.**
- ARC and ELLIPSE pairs ran from 1e-7 to 1 − 1e-6 turn (61 log-spaced from each end, plus 40 uniform).
- Starts: 40 across the circle, including 0, −0, ±½ turn and ±(turn − 1e-9). Both CCW and CW-written ends.
- Writers: `String(v)`, `%.6f`, `%.3f`, `%.8g`.
- Result: **103,680 imports compared with `pre1843` on points + curve + notes: 0 differ.** Pairs written at least a turn apart are excluded (317 at `%.3f`).
- `m-spec.mts`: 200,000 rule pairs within one turn, `Object.is` equal to `pre1843`: 0 differ.

**Over one turn.** s → s + (m + f)·turn, m = ±1, ±2, ±5, 40 starts:
- ARC: 2,800 changed;
- ELLIPSE: 4,600 changed;
- every one inside the shipped band (f or 1 − f ≤ 5e-4 / 1.55e-3); **0 changed outside it**.

**Named cases** (main / before #1843; closed = C, open = O):

| Case | Before #1843 | Main |
|---|---|---|
| ARC `0 → 450` / `−720 → 90` | 31.39 mm O | same (quarter) |
| ARC `0 → 720`, `0 → −360`, `30 → 30`, `−180 → 180`, `360 → 0` | 125.59 C | same |
| ARC `0 → 720.5` / `0 → 360.5` / `0 → 360.2` / `−10 → 350.2` (pinned) | 0.175 / 0.175 / 0.070 / 0.070 O | **same, small** |
| ARC `0 → 360.18` / `360.19` (band edge) | 0.063 / 0.066 O | same |
| ARC `0 → 360.04` | 0.014 O (dot) | **125.59 C** (in band) |
| ARC `0 → 719.82` / `0 → 719.81` | 125.50 O / 125.50 O | **125.59 C** / 125.50 O |
| ARC `0 → −360.1` | 125.53 O | **125.59 C** (new far near-full side) |
| ARC `0 → 359.99` / `359.96` / `359.9` | C / O / O | same (E4-P3-1 unchanged) |
| ARC `359.99 → 0.01`, `359.9 → 0.1`, `350 → 10`, `0 → −359.99` | 0.007 / 0.070 / 6.98 / 0.003 O | same |
| ELLIPSE `0 → 2π + 0.01` / `+ 0.0099` / `1 → 1 + 4π + 0.0099` (pinned) | 0.120 / 0.119 / 0.259 O | **same, small** |
| ELLIPSE `0 → 2π + 0.00974` | 0.116 O | **138.00 C** (in band) |
| ELLIPSE `0 → 2π + π/2`, `0 → π`, `1 → 2`, `5.5 → 7.0`, `6.2831 → 0.0003` | 34.50 / 69.00 / 28.91 / 24.18 / 0.005 | same |
| ELLIPSE `0 → 6.29`, `0 → 6.284`, `−3.142 → 3.142`, `4.712 → 10.996`, `4.712 → 11.00` | dots 0.010–0.144 | **138.00 C** |
| ELLIPSE `0 → −6.29` | 137.92 O | **138.00 C** (far near-full side) |
| ELLIPSE `0 → 6.28`, `−3.14 → 3.14`, `−3.1 → 3.1` | 137.97 / 137.97 / 137.01 O | same (less than a turn apart) |
| NaN, ±Inf, `abc` (ARC and ELLIPSE) | skipped, "unreadable or out-of-range coordinate value" | same |
| `1e20 → 1e20`, `0 → 1e20`, `0 → 1e308`, ELLIPSE `0 → 1e300` | as before | same |
| −Z: ARC `10 → 100`, `10 → 370`; ELLIPSE `0.5 → 6.7`, `0 → 6.284` | | same, except `0 → 6.284` (dot → C) |

LWPOLYLINE bulges (two half bulges, a 359.99° bulge, a 1e-9 bulge), SPLINE (control-point and closed fit-point) and CIRCLE are byte-identical to before #1843.

## 4. Predicates (`p1-predicate.mts` → `out/p1-predicate.txt`)

- `isFullEllipseSweep(s, e) === (normalizedSweep(s, e) === 2π)`: **0 mismatches in 2,000,000** pairs over six distributions (uniform; near s + turn; near multiples; near-full; near-zero; printed 2–11 significant digits). The sweep was always in (0, 2π].
- An own rule written from the ADR text agrees with main's `normalizedSweep` and `arcSweep` in 2,000,000 of 2,000,000 pairs each.
- The imported closed flag agrees with the rule in 29,945 of 30,000 ELLIPSE and 29,979 of 30,000 ARC imports (radius 0.05–500 mm).
  - Every disagreement is a radius under 0.14 mm. There the open gap (≤ R · 6.3e-4) is under the 1e-4 mm join tolerance, so `joinTouchingDxfPieces` closes it.
  - That is the join rule's own design (ADR-626 Amd 8), not the sweep rule.

## 5. The new test and mutants (`m1-mutants.mjs` → `out/m1-mutants.txt`)

**What the test covers.**
- `dxf-printed-angles.test.ts` (57 tests, pass) samples 1,000 LCG starts in [−turn, turn).
- It covers ARC at 1–12 dp and 4–12 sd, and ELLIPSE at 2–12 dp and 4–12 sd, with **nearest rounding only** (`toFixed` / `toPrecision`), at **function level** (`arcSweep` / `normalizedSweep`). It does not import through the parser.
- The coarse block covers ARC at 3 sd, and ELLIPSE at 1 dp and 3 sd. Its oracle recomputes the shipped allowance, so it checks "within allowance ⇒ full, else as written", not the maintainer's literal "never snaps".
- It does not cover directed rounding, symmetric forms beyond the named cases, reverse-written forms, or INSERT.

**Runs.**
- Baselines: the new test 57 / 57; the DXF list (`dxf-curve-sampling`, `dxf-arc-sweep`, `dxf-join-touching`, `dxf-ocs`, `parse-dxf`, `dxf-entities`, `dxf-native-curves`) 105 / 105.
- Each mutant in `mut\` only; restored and compared byte-equal with `j37-main` (`restored-equal=true` × 16).
- The spec column is the rule-level oracle `m-spec.mts`: grid × 88 printings, pinned cases, audit cases and genuine identity.

| Mutant | New test | DXF list | Spec |
|---|---|---|---|
| A3 ARC allowance ×3 | KILLED (pinned `0 → 360.5/360.2`) | KILLED | violated (3 pinned small cases close) |
| **Ad3 ARC allowance ÷3** | **survived** | survived | **violated: ARC 4 sd up, `−259.2 → 100.9` is a 0.1° dot (189 cases)** |
| Ad2 ARC 3e-4 | survived | survived | holds |
| Ap ARC 5.6e-4 | KILLED | survived | violated (`0 → 360.2` closes) |
| E3 ELLIPSE ×3 | KILLED | KILLED | violated |
| Ed3 ELLIPSE ÷3 | KILLED (2 dp, 4 sd, `0 → 6.29`) | survived | violated |
| **Ed14 ELLIPSE 1.1e-3** | **survived** | survived | **violated: ELLIPSE 4 sd up, `3.728 → 10.02` (128 cases)** |
| Ed15 ELLIPSE 1.0e-3 | KILLED | survived | violated |
| Ep ELLIPSE 1.6e-3 | KILLED (`0 → 2π + 0.01`) | KILLED | violated |
| SW allowances swapped | KILLED | KILLED | violated |
| G "at least a turn apart" guard dropped | KILLED | KILLED | violated (67,340 genuine arcs change) |
| GE guard `<` → `<=` | survived | survived | holds (equivalent) |
| NZ far near-zero side dropped | KILLED | KILLED | violated |
| NF far near-full side dropped | survived | survived | holds on forward forms. It changes only reverse or past-a-turn near-full cases (`0 → −6.29`, `6.29 → 0`), which nothing pins |
| R4 back to Amd 4 | KILLED (11 tests; the ADR says 9) | survived | violated |
| WN near-full snap ×3 (E4 refuter D2) | **KILLED** (coarse block) | survived | violated |

- The new test pins the allowances between the nearest-rounding worst cases and the pinned short arcs:
  - ELLIPSE between 1.085e-3 (`6.29 − 2π`) and 1.59e-3 (`0.01 rad`);
  - ARC between ≈ 1.5e-4 and 5.56e-4.
- Its two spec-violating survivors (Ad3, Ed14) fail only under directed rounding, the same blind spot through which E5-P1-1 reached main.

## 6. Other entry points (`i1-insert.mts` → `out/i1-insert.txt`; READ)

- **Phone and MCP:**
  - `remote-control/design-imports.ts:267-299` sends `application/dxf` to `parseDxfOffThread`, which is the same worker `parseDxfBlob` measured above. The MCP design import (`electron/mcp/design-schemas.ts`) feeds the same remote path.
  - Re-import (`reimport-selected-artwork.ts:69`) and the unified Import (`import-vector-dispatch.ts:37`) call `importDxfFiles`. It takes the worker when a Blob exists, otherwise `parseDxf`, the same entity collector.
  - No other ARC or ELLIPSE reader exists in `src/` or `electron/` (grep).
- **INSERT:**
  - Block content goes through the same `convertReadableEntity` (`dxf-expand.ts:180-196`) before placement.
  - Measured: `6.459 → 366.5` (ARC 4 sd), `123.4 → 483.5`, ELLIPSE `4.712 → 10.996`, `−3.142 → 3.142` and `0 → 6.29`, each inside a block placed plain, mirrored (x scale −1), rotated 30° at scale 2, with a −Z extrusion INSERT, and as a 2×2 MINSERT, each in mm and in inches (`$INSUNITS 1`). Every copy closes at 99.94–100.01 % of its full length; all were dots before #1843.
  - `0 → 6.3` (ELLIPSE 1 dp) stays a 0.15 % dot in every placement, as written.
- **Preview thumbnail:** there is none for DXF. The import dialogs read the parsed object, and the batch-trace "DXF" option is an export.

## Findings

### E5-P1-1 — A full DXF ELLIPSE written to 4 significant digits, rounded up, still imports as a dot (residual of E3-P1-1 / E4-P1-1)

- **Where:** `src/io/dxf/dxf-curve-sampling.ts:93` (`ELLIPSE_WRAP_SNAP = 1.55e-3`, i.e. 0.009739 rad) and `:119-120`.
- **Anchor:**
  - Maintainer spec (2026-11-13): 4+ significant digits within rounding of a whole turn and at least a turn apart MUST import as a full turn.
  - ADR-700 Amd 5 Decision 1: "Radians printed to … 4 or more significant digits are off by less than 0.01". The allowance it sets is 0.0097, not 0.01.
  - Consequences: "Full circles and ellipses import whole from every start angle at the printings in Decision 1."
- **Evidence:**
  - **READ.** At 4 significant digits, an end ≥ 10 rad has 2 decimals and a start in [1, 10) has 3. Rounding both up leaves the written difference up to 0.01 − 0.00019 rad past a turn. Nearest rounding stays under 0.0055, which is why the shipped test, nearest only, passes.
  - **REPRO** (`c3b.mts` → `out/c3b-examples.txt`, worker import):
    - `3.717 → 10.01`: written 0.00981 rad past a turn, **2 points, 0.189 mm, open, no note**. Before #1832: 55 points, closed, 138.00 mm.
    - Also `3.727 → 10.02`, `3.737 → 10.03` … `3.787 → 10.08` (0.191–0.201 mm), and `4.627 → 10.92` on three more geometries (0.196–0.391 mm).
  - **REPRO** (`c3-directed.mts`): 0.758 % of starts in [0, 2π), 0.379 % in [−2π, 2π), 0 % in [−π, π). The same 0.758 % appears rounded down for starts in [−4π, −2π).
  - Before #1843: 50.2 %. Before #1832: 0 %. Every other directed row (4 sd down / trunc, 5 sd up, 2–3 dp up) is 0 % on main.
  - **RUNS:** mutant Ed14 (allowance 1.1e-3) survives the new test and the DXF list, so nothing pins this side.
- **Scenario:** a writer that rounds angles up (ceil) to 4 significant digits exports an oval cut-out whose parameters start in about [3.72, 2π). KerfDesk imports a 0.2 mm dot with no note, and the part is not cut out. The outline imported whole before #1832.
- **Severity:** P1 under METHOD §3: a silent loss of a cut outline, regressed from a correct state, with no reach clause; rated as E3-P1-1 and E4-P1-1 were.
  - The reach is narrow: it needs directed (ceil) rounding, which `printf` does not do. Nearest, truncation and floor on [−2π, 2π) are 0 %.
  - A refuter may argue P2 on plausibility. No exporter is verified either way.
- **Announced?** No. The ADR says Decision 1 printings import whole "from every start angle".
- **Novelty:** residual of KNOWN E3-P1-1 / E4-P1-1, through a rounding mode the fix's test does not sample. Not caused by #1843, which cut it from 50 % to 0.76 %.
- **Fix direction:**
  - No constant allowance works. `3.717 → 10.01` (0.00981 past) and the pinned short arc `0 → 2π + 0.0099` are 0.00009 rad apart.
  - Size the far-turn allowance from the **printed precision of each angle's tag text**, which the importer does have (`tag.value`), for example ulp(start text) + ulp(end text), capped at about 0.02 rad. Use it only when both ends carry ≥ 2 decimals or ≥ 4 significant digits.
    - Full-precision pinned cases (`6.293185307179586`) keep a ulp near 1e-15 and stay small.
    - 1 dp / 3 sd text keeps the maintainer's "as written".
  - Alternatively, the maintainer un-pins `0 → 2π + 0.0099` and the allowance goes to ≥ 1.6e-3 turn.
  - Add a directed-rounding row (4 sd up, 2 dp up/down/trunc) to `dxf-printed-angles.test.ts`.
  - Correct the ADR's "less than 0.01" bound.

### E5-P3-1 — Coarse printing still closes in part, against the literal "No, leave as written"

- **Where:** `dxf-curve-sampling.ts:119-120` (the allowances apply to whatever the printing); `dxf-entities.ts:111`.
- **Anchor:** the maintainer decision (1 dp / 3 sd "must NOT snap … import exactly as their numbers say"). ADR-700 Amd 5 Decision 3 records it, then qualifies it: "a coarse file whose rounding happens to land inside the allowance still closes" and "ARC degrees at 1 decimal stay covered".
- **Evidence (REPRO, `c1-census.mts`, table 2b):** closed but not as written:
  - ELLIPSE 3 sd: 38.3 % (nearest), 40.9 / 21.8 / 6.7 % (up / down / trunc). Almost all are new in #1843 (2,660 of 2,792).
  - ARC 3 sd: 4.2 % (e.g. `−360 → 0.1`, a 0.035 mm dot before #1843, now a closed circle).
  - ARC 1 dp: 1.2 / 5.1 % (up / down), and JS round-half-away ties (`−0.3 → 359.8`).
  - ELLIPSE 1 dp: 0 % in every mode.
  - Every one of these has a written error within the allowance, so it is numerically a Decision 1 printing. No dot or partial arc deviates from "as written".
- **Scenario:** a 3-significant-digit file mixing full ellipses with deliberate short arcs written past a turn (`0 → 6.29` meaning 0.0068 rad). The short arc closes. No real file of that kind is known; every closing case in the census came from a full turn.
- **Severity:** P3. Decision-record drift: the rule cannot see the printing as implemented, so the literal decision is unattainable for numerically identical text. No job harm was found.
- **Announced?** Yes (ADR Decision 3). But the decision quote and the qualification sit side by side, and the maintainer's answer predates the qualification.
- **Novelty:** new with #1843 (the per-unit allowances).
- **Fix direction:**
  - The maintainer confirms the qualification as written (no code change); or
  - the text-precision rule of E5-P1-1 with "1 dp or 3 sd text never wraps". That makes ELLIPSE 3 sd and ARC 1 dp import as written wherever the text betrays the coarse printing; `3.14`-style text stays ambiguous by nature.

### E5-P3-2 — A whole turn whose printed end rounds short stays an open near-full outline (by design)

- **Where:** `dxf-curve-sampling.ts:117-118` (within one turn, only 1e-4 turn closes).
- **Anchor:** ADR-700 Amd 5 Decision 2, which announces it: "A circle whose printed end rounds short … imports as a near-full open arc, not a dot". The spec's "(and at least a turn apart)" also excludes it.
- **Evidence (REPRO, table 2a and `c2-forms`):** open near-full shares:
  - ELLIPSE: 2 dp 60.9 / 62.3 / 77.4 / 89.3 % (near / up / down / trunc); 3 dp trunc 5.6 %; 4 sd 8.3–25.1 %.
  - ARC: 4 sd 0.8–13.1 %.
  - `−π → π` at 2 dp (`−3.14 → 3.14`) is open **every time** (gap 0.0032 rad); truncated at 3 dp (`−3.141 → 3.141`) also every time (gap 0.0012 rad).
  - The gap is R × 0.0032 rad: 0.04 mm on the 30 mm test ellipse, 0.32 mm at R = 100. Truncated 2 dp leaves up to 0.013 rad (1.3 mm at R = 100). ARC 4 sd leaves 0.1° (0.17 mm at R = 100).
  - Unchanged since before #1832 (`k1-known`: ELLIPSE 2 dp truncated is 0 % full on all four trees).
- **Scenario:** an atan2-style writer at 2 decimals exports full ellipses as `−3.14 → 3.14`. Each imports open:
  - Line cuts lose closure, so no kerf offset, inside-first order or lead.
  - The part can keep a microjoint the width of the gap.
  - Fill flags the contour (open-Fill preflight; repair closes gaps up to 0.5 mm).
- **Severity:** P3 (announced trade-off, not a regression).
- **Announced?** Yes (Amd 5 Decision 2).
- **Novelty:** not new; first measured per printing here.
- **Fix direction:** the same text-precision allowance, applied within one turn too. A gap within the printed ulp of both ends closes, so `−3.14 → 3.14` closes while `0 → 359.96` written at full precision stays open (E4-P3-1 unchanged).

## KNOWN — status of every item in scope

| Item | Status on `0e1a476f5` | Evidence |
|---|---|---|
| E1-P1-2 ARC s → s + 360 → dot (regression from #1820) | **Fixed for every printing of 1+ dp and 4+ sd, all rounding modes** (0 % dots; before #1843, 25 % at 1 dp on a 0.25° grid through round-half-away ties). ARC 3 sd still makes 18.3 % dots (21.6 / 9.9 % up / down), as written. That is the maintainer's "leave as written"; before #1820 it was 0 % | c1, k1 |
| E3-P1-1 ELLIPSE 2π rounded up → dot (regression from #1832) | **Fixed for nearest, truncation and floor at 2+ dp and 4+ sd** (0 of 1.80 M imports). **Residual: 4 sd rounded up, E5-P1-1** (0.76 % of [0, 2π)) | c1, c3, c3b |
| E3-P1-2 ARC at 6–12 sd → dot | **Fixed**, including the 4 sd residual the E4 refuter noted (0 % at 4–12 sd in every mode; before #1843 31.9 % at 4 sd on the k1 grid) | c1, k1 |
| E4-P1-1 ELLIPSE 1–3 dp / 3–4 sd → dot, `−π → π` at 3 dp always | **Fixed at 2–3 dp and 4 sd** (`4.712 → 10.996`, `−3.142 → 3.142`, `0.785 → 7.069`, `2.5 → 8.79`, `0 → 6.29`: all closed). **1 dp (82.9 % dots) and 3 sd (7.6 %) remain by maintainer decision** (before #1832: 0 %). Residual: E5-P1-1. Rounding short stays open (E5-P3-2) | c1, c2, g1, k1 |
| E4-P3-1 near-full snap closes gaps under 1e-4 turn | **Unchanged** within a turn (`0 → 359.99` C, `359.96` O). Amd 5 adds the same closure past a turn with the wider allowances: `0 → 719.82°`, `0 → −360.1°` and ELLIPSE `0 → −6.29` now close. That is announced ("within that allowance of a whole turn, or of zero") | g1 |

## Verified clean

- **Spec, fine side:** 0 collapses and 0 "far but not full" across 2–12 dp and 4–12 sd for nearest, floor and truncation, on four ellipse geometries, −Z extrusion and ARC. Starts were on a 0.1° / 0.002 rad grid plus random.
- **Spec, coarse side:** no dot or partial arc deviates from "as written" (the ratio-0.05 chord case is sampling). Closures of coarse text are all within the allowance (E5-P3-1).
- **Genuine arcs:** within one turn, bit-identical to before #1843 (103,680 imports, 200,000 rule pairs). Over one turn, changes only inside the shipped bands (7,400 changed, 0 outside). The pinned small cases stay small.
- **Edge inputs:** NaN, ±Inf, `abc`, `1e20`, `1e308` and equal angles behave as before. −Z extrusion, LWPOLYLINE bulges, SPLINE and CIRCLE are byte-identical.
- **Predicates:** `isFullEllipseSweep` agrees with the sweep (0 / 2 M); an own ADR-text rule agrees with main (0 / 4 M); the import's closed flag follows the rule except below the 1e-4 mm join tolerance.
- **Entry points:** the worker equals the main-thread parse. Phone, MCP and re-import share the worker or collector. INSERT, MINSERT, mirrored, rotated, scaled and inch placements follow the same rule.
- **Test:** the 57 new tests and 105 DXF-suite tests pass. Mutants: 11 / 16 killed by the new test, including WN, the E4 refuter's D2 survivor.

## Probes with no gap (not raised)

- **Reverse-written whole ELLIPSE `s + 2π → s`** (`c2-forms`):
  - Dots at 8–100 % depending on digits (`6.283185 → 0` is 3e-7 rad). The numbers are less than a turn apart, so it is "as written" and outside the spec.
  - Identical before #1843 and before #1832, and no exporter is known to write it. ARC reverse forms do not dot (360 is exact in decimal).
  - The far near-full branch that would close the "past a turn" variant (`6.29 → 0`) is untested (mutant NF survives).
- **Huge angles** (`h1-huge.mts`): equal angles at ≥ 1e14° (ARC) or ≥ 1e16 rad (ELLIPSE) sample a degenerate or open ring, and `1e20 → 1e20` is a 0 mm closed path. This is float precision in sampling, not the rule, and not plausible input.
- **ADR text nits:** "On Amendment 4's rule, 9 of these tests fail" — mutant R4 fails 11. Amd 4's Consequence "whatever the printed precision" is superseded by Amd 5 but not marked.

## Not verified

- **Real exporters' angle formats** (whether any writer rounds up, writes atan2 ranges at 2 decimals, or writes reverse ellipses): nothing downloaded, as for E3 and E4.
- **Hardware:** whether an open near-full outline (E5-P3-2) leaves a microjoint that holds a part.
- **Browser:** no run. The worker's own `parseDxfBlob` ran in Node; the postMessage transfer was replaced by `pack`/`unpack`.
- **The full suite:** only the new test and 7 DXF files ran.

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-e5\`. Run TS from that folder with `node --no-experimental-webstorage --import ./register.mjs <file>`.

| File | What | Output |
|---|---|---|
| `register.mjs`, `ts-resolve.mjs` | Loader (esbuild from `j37-main`; bare imports from `pre1843`, `pre1832`, `pre1820`, `mut` via `j37-main`) | — |
| `pre1843\`, `pre1832\`, `pre1820\` | `git archive` at `8d92bd143`, `1f016b610`, `92bccd5d3` | — |
| `e5-lib.mts` | Writers (4 rounding modes), exact-decimal "as written", DXF text, worker / main-thread import, measure | — |
| `c1-census.mts grid\|geoms\|ozx`, `agg.mjs` | Census, main vs pre-#1843, worker path | `out/c1-*.tsv`, `out/c1-tables.md` |
| `c2-forms.mts` | Named forms per printing; reverse-written census | `out/c2-forms.txt` |
| `c3-directed.mts`, `c3b.mts` | E5-P1-1 directed rounding (3 trees), examples through import | `out/c3-directed.txt`, `out/c3b-examples.txt` |
| `g1-genuine.mts` | Genuine-arc identity, over-turn bands, named cases, bulges, splines | `out/g1-genuine.txt` |
| `p1-predicate.mts` | `isFullEllipseSweep`, own ADR rule, imported closed flag | `out/p1-predicate.txt` |
| `k1-known.mts` | KNOWN census on main / pre1843 / pre1832 / pre1820 | `out/k1-known.tsv` |
| `i1-insert.mts` | INSERT / MINSERT / mirror / rotate / −Z / inches | `out/i1-insert.txt` |
| `h1-huge.mts` | Huge angles | `out/h1-huge.txt` |
| `m-spec.mts`, `m1-mutants.mjs` | Rule-level spec oracle; 16 mutants on `mut\` (Vitest, restored and compared) | `out/m1-mutants.txt`, `out/m1-run.log` |
| `mut\` | `src`, `public`, `scripts` and root configs copied from `j37-main`; `node_modules` is a junction (do not delete recursively) | — |

## Counts

Raised **3**: P1 **1** (E5-P1-1), P2 **0**, P3 **2** (E5-P3-1, E5-P3-2). Known items with a status: **5** (E1-P1-2, E3-P1-1, E3-P1-2, E4-P1-1, E4-P3-1). E5-P1-1 is a residual of E3-P1-1 / E4-P1-1 (not caused by #1843).

```json
{
  "area": "E5",
  "role": "auditor",
  "tree": "0e1a476f5",
  "findings": [
    {"id": "E5-P1-1", "severity": "P1", "evidence": "REPRO worker import: ELLIPSE 3.717 -> 10.01 (4 sd ceil) 2 pt 0.189 mm open, no note; pre-#1832 closed 138.0 mm; 0.758 % of starts in [0, 2pi) (pre-#1843 50.2 %); mutant Ed14 survives", "note": "residual of E3-P1-1/E4-P1-1; directed rounding only; constant allowance cannot fix vs pinned 0 -> 2pi + 0.0099"},
    {"id": "E5-P3-1", "severity": "P3", "evidence": "census: closed-not-as-written ELLIPSE 3 sd 38.3 %, ARC 3 sd 4.2 %, ARC 1 dp up/down 1.2/5.1 %; ELLIPSE 1 dp 0 %", "note": "announced in ADR Decision 3; no job harm"},
    {"id": "E5-P3-2", "severity": "P3", "evidence": "census: ELLIPSE 2 dp open near-full 61-89 %, -3.14 -> 3.14 always open (gap 0.0032 rad)", "note": "announced in ADR Decision 2; unchanged since pre-#1832"}
  ],
  "known": {"E1-P1-2": "fixed (ARC 3 sd dots remain as written)", "E3-P1-1": "fixed except 4 sd ceil (E5-P1-1)", "E3-P1-2": "fixed incl. 4 sd", "E4-P1-1": "fixed at 2-3 dp / 4 sd; 1 dp and 3 sd as written by decision", "E4-P3-1": "unchanged; extended past a turn by design"},
  "counts": {"raised": 3, "P1": 1, "P2": 0, "P3": 2, "known": 5}
}
```

## Refuter (2026-11-13)

**Tree and harness.** Same read-only export `j37-main` (`origin/main` @ `0e1a476f5`; `origin/main` has since moved to `970349413`, which changes nothing under `src/io`). My own scripts are in `zz-e5r\`, run with `node --no-experimental-webstorage --import ./register.mjs <file>` from `zz-e5r`. I read the auditor's scripts for API shape only. Nothing imports or reruns them.
- **Loader:** my own copy, esbuild from `j37-main`. Bare imports from my own trees fall back to `j37-main`'s `node_modules`.
- **Before trees:** my own `git archive` of `src/` (read only) at the exact first parents:
  - `pre1843` = `ad5e9fdc6^1` = `8d92bd143`;
  - `pre1832` = `f6401fc63^1` = `1f016b610`;
  - `pre1820` = `2560a026a^1` = `92bccd5d3`.
  I found each merge with `git log --merges --grep`.
- **DXF:** my own text and shapes, not the auditor's 30 mm ellipse or r = 20 arc.
  - ELLIPSE: centre (100, 80), major axis 50 mm at 20°, ratio 0.5, Ramanujan perimeter 242.21 mm.
  - ARC: centre (60, 60), r = 40 mm.
  - The importer is `parseDxf`. On every named case I also ran the worker's `parseDxfBlob` → `pack` → `unpack` on main, and it gave identical points and curves (`same` × 33).
- **Writers:** my own exact decimal formatter (BigInt over `toPrecision(40)`, not `toFixed` or `toPrecision(p)`). It has five rounding modes: half away from zero, half even, ceil, floor and truncation.
  - Starts lie on a **stratified generic grid** (`(i + 0.5)/N`), deliberately not aligned with any decimal step. The auditor's 0.1° and 0.002 rad grids alias with the printing step (see E5-P3-2 and E5-P3-1).
- **Analysis:** I worked out the size of the written error by hand, not only by census (R2b).
- **Mutants:** my own copy `zz-e5r\mut\` (`src`, `public`, `scripts`, root configs, and a `node_modules` junction).
  - 9 DXF test files (the new test plus `dxf-curve-sampling`, `dxf-arc-sweep`, `parse-dxf`, `dxf-entities`, `dxf-expand`, `dxf-join-touching`, `dxf-ocs`, `dxf-native-curves`): a wider list than the auditor's.
  - `--pool=threads --no-file-parallelism --maxWorkers=1`, run with 1.8 GB of RAM free.
  - Each mutated file was restored and compared byte-equal with `j37-main`.
- **Not used:** hardware, a browser, pnpm, building, live services, downloads, or any PR.

### Verdicts

| Finding | Verdict | Evidence (own) |
|---|---|---|
| E5-P1-1 | **CONFIRMED, P1** (residual of E3-P1-1 / E4-P1-1, a regression from #1832). **Reach proven:** directed rounding only. Under round-to-nearest (either tie rule) or truncation it is 0 %. **Two parts of the fix direction are refuted.** A constant *can* fix it: 1.568e-3 turn passes all 171 tests, including the 0.0099 pin. The ADR's "less than 0.01" bound is correct and needs no change. The text-precision idea runs into `%g` zero stripping | R1, R2, R2b, R5, R7 |
| E5-P3-1 | **CONFIRMED, P3**, mostly forced by the spec itself. 92–98 % of the ELLIPSE 3 sd closures are text that is **also** a 2+ decimal printing, which the spec says must close. The ARC 1 dp directed shares depend on the grid | R3, R8 |
| E5-P3-2 | **CONFIRMED, P3** (by spec and announced), and unchanged on all three trees. **Shares corrected:** ELLIPSE 2 dp nearest is open near-full in **68.15 %** analytically (1 − frac(200π)), not 61 %; the auditor's 0.002 rad grid aliases | R1, R2 |

**Verified-clean claims checked:**
- **Genuine arcs within one turn:** held.
  - Rule level: 394,728 own pairs with `Object.is` against `pre1843`, 0 differ. Starts go to ±100 turns, sweeps from 1e-9 to 1 − 1e-7 turn, and 30 % are printed at 2–13 significant digits.
  - Import level: 2,707 `parseDxf` imports, points, curve and notes identical.
- **Over a turn:** 46,190 changed, **0** outside the shipped bands.
- **Pinned small cases:** stay small (R1, R5).
- **`isFullEllipseSweep`:** 0 mismatches in 300,000. It is the sweep by construction (`dxf-curve-sampling.ts:73-75`).
- **INSERT:** held (R6). On my own block, plain, mirrored, rotated 30° at ×2, −Z and as a 2×2 grid INSERT (codes 70/71) all follow the rule. That includes **E5-P1-1, which collapses in every placement**: 0.34 / 0.68 / 1.35 mm.
  - Note: a literal `MINSERT` entity name is skipped ("1 MINSERT"). DXF writes a grid as INSERT with 70/71, so this is expected.
- **Phone, MCP and re-import:** held (READ).
  - `remote-control/design-imports.ts:290` → `parseDxfOffThread` → `import-worker.ts:61` `parseDxfBlob`.
  - `dxf-import-action.ts:94/106` use `parseDxf` or the worker.
  - No other ARC or ELLIPSE reader exists. KerfDesk's own DXF writer emits only LWPOLYLINE bulges, so a re-import of its own export never meets this rule.

### Per-finding notes

**E5-P1-1: CONFIRMED P1. Reach: directed rounding only. Fix direction corrected.**
- **R1, through `parseDxf` on my ellipse:**

  | ELLIPSE | Written − 2π (rad) | main | pre-#1843 | pre-#1832 |
  |---|---|---|---|---|
  | `3.717 → 10.01` | +0.009815 | **O, 2 points, 0.338 mm, no note** | 0.338 mm | C, 242.13 mm |
  | `4.627 → 10.92` | +0.009815 | **0.490 mm** | same | C |
  | `3.718 → 10.01`, `0 → 6.2928` | +0.008815 / +0.009615 | C | dot | C |
  | `0 → 6.2930853…` (the #1843 pin) | +0.0099 | 0.248 mm (kept short) | same | C |

  - The worker path gives the same result.
  - In INSERTs the dot is copied into every placement (R6).
- **Why only directed rounding reaches it (R2b, arithmetic).**
  - At 4 significant digits, a start in [1, 10) prints 3 decimals and an end ≥ 10 prints 2. The true difference is exactly 2π. So the written difference is a multiple of 0.001, and its error is j·0.001 − 0.000185307.
  - The allowance is 0.0097389 rad. Only **j = 10** (+0.009815) collapses. That needs the end error minus the start error to exceed 0.0097.
  - Under round-to-nearest, |end error| ≤ 0.005 and |start error| ≤ 0.0005, so the error is at most 0.0055. The answer to the brief's "start rounds down and end rounds up" is no: independent nearest rounding cannot reach it.
  - When both ends print 2 decimals (|start| ≥ 10 rad), the error takes only the values {+0.006815, −0.003185} in **every** mode.
- **Census (R2), 20,000 stratified starts per row, rule level:**
  - **ELLIPSE 4 sd ceil:** **0.765 %** on [0, 2π). The analytic value is 0.0185307 × (2π − 3.716815)/2π = **0.757 %**. Also 0.390 % on [−2π, 2π), 0 % on [−π, π) and 1.095 % on [2π, 4π).
  - **ELLIPSE 4 sd floor:** 0.765 % on [−4π, −2π).
  - **0 % everywhere else:**
    - 4 sd with half away, half even or truncation, in every range;
    - every mode at 2 dp, 3 dp and 5 sd.
  - **Worst written error past a turn, over every fine printing (2–8 dp, 4–10 sd), starts in [−4π, 4π):**
    - nearest, half even and truncation: **0.006815 rad** (1.085e-3 turn);
    - ceil and floor: **0.009815 rad** (1.5621e-3 turn).
- **Which real formatters round that way?** C `printf("%.4g")`, JS `toPrecision(4)`, Python `'{:.4g}'` and .NET `"G4"` all round to nearest by default, on the exact binary value. The repo has no fixture, test or doc showing any DXF writer, AutoCAD, ezdxf or otherwise, that prints ELLIPSE parameters with directed rounding. The only DXF writers named in `src/io/dxf/*.test.ts` are ezdxf and AutoCAD, for SPLINE, OCS and INSERT cases. A ceil writer needs explicit `ceil(x·10ⁿ)/10ⁿ` code, or glibc `printf` under `fesetround(FE_UPWARD)`.
- **Severity: P1 stands.**
  - METHOD §3 (clarification 2026-10-23): reach can lower a finding only when it is not reachable today. Any user can open such a file today.
  - A refuter may lower a P1 only by showing the output is not wrong or that a clear warning comes first. Neither holds here:
    - `3.717 → 10.01` is 3 and 2 decimals, an unambiguous "2+ decimals / 4+ significant digits" printing under the maintainer's spec;
    - its 0.009815 error is inside the ADR's own Decision 1 bound ("off by less than 0.01");
    - the import gives no note.
  - The ledger should record its reach as "directed (ceil/floor) rounding only; 0 % under any round-to-nearest or truncation".
- **Fix direction, corrected.**
  - **"No constant can fix it" is refuted.** The written errors are discrete, and the worst fine-printing error is 0.009815 rad (1.5621e-3 turn). The #1843 pin `0 → 2π + 0.0099` is 1.5756e-3 turn. Any `ELLIPSE_WRAP_SNAP` in **[1.563e-3, 1.575e-3]** closes every fine printing in every rounding mode and keeps the pin short.
    - R5 mutant **Kfix = 1.568e-3:** 171 / 171 pass on 9 DXF files.
    - R7, through `parseDxf` with Kfix: `3.717 → 10.01`, `4.627 → 10.92` and `−12.38 → −6.087` close; `0 → 2π + 0.0099` (0.248 mm) and `0 → 2π + 0.01` stay short; `0 → 6.3` (1 dp) stays a dot; and 400,000 4 sd ceil/floor pairs on [−4π, 4π) give 0 dots.
    - Mutant **Kfix2 = 1.585e-3** fails only the two 0.0099 pins, which #1843 itself added. The older `dxf-curve-sampling.test.ts:156` pin (`0 → 2π + 0.01`) still passes.
    - The margin is tight (3.7e-5 rad on each side) but deterministic, because the error set is discrete.
  - **"Correct the ADR's 'less than 0.01' bound" is refuted.** The bound is right (0.009815 < 0.01). The constant, 0.009739, was set below the ADR's own bound. Fix the constant, not the text.
  - **The text-precision allowance works only in a narrow form.**
    - The text is available: `tag.value` is trimmed text, and `arcInOcs` / `ellipseInOcs` hold the tags. Using it means threading an allowance through `counterClockwiseSweep`, `normalizedSweep`, `sampleEllipse` and `isFullEllipseSweep`.
    - But `%g` strips trailing zeros, so the printed decimals do not show the printing. `%.4g` prints 11.00 as `11`, 10.00 as `10` and 0 as `0`.
    - Gated as the auditor words it ("only when both ends carry ≥ 2 decimals or ≥ 4 significant digits"), the rule would regress the named E4 case `4.712 → 11`, which closes today.
    - Taking ulp(`0`) as 1 with the 0.02 cap would close `0 → 6.3`, against the maintainer's 1-decimal decision.
    - A workable form keeps the constant as a floor and widens it only when **each** text shows ≥ 2 decimals or ≥ 4 significant digits. It must also accept exponent text (`1.000e+01`). That is more code than the one-constant fix and buys nothing over it for E5-P1-1.
  - Keep the auditor's test row: a directed-rounding row (4 sd ceil and floor) in `dxf-printed-angles.test.ts`, which also kills Ed14.

**E5-P3-1: CONFIRMED P3. Mostly the spec's own overlap.**
- **R3, closed although the written sweep is not a whole turn,** starts on a stratified grid over [−turn, turn):
  - **ELLIPSE 3 sd:** 33.3 % (nearest), 36.3 / 28.1 / 8.8 % (ceil / floor / trunc). Of these, **94.0 / 94.4 / 97.6 / 92.3 % are text that is also a valid fine printing**: every angle has ≥ 2 decimals or ≥ 4 significant digits.
    - The reason: in [1, 10), 3 significant digits **is** 2 decimals (`6.28`, `6.29`, `3.81`). So "3 sd must not snap" and "2 dp must snap" contradict each other for identical text. The ADR's Decision 3 says so ("the same precision as Decision 1").
    - The only text that shows its coarse printing is a pair with an end ≥ 10 at 1 decimal (`3.71 → 10.0`, `3.81 → 10.1`).
  - **ELLIPSE 1 dp:** 0 % in every mode.
  - **ARC 3 sd:** 4.5 / 3.0 / 1.6 / 0.1 % (near / ceil / floor / trunc).
    - All of them have a 0-decimal end such as `−360 → 0.045`, a 0.045° arc. But `%.4g` also prints −360.0 as `−360`, so even this text is ambiguous.
  - **ARC 1 dp:** 0 % in every mode on generic starts.
    - R8: on **exact** 0.1° starts, ceil and floor give 18.6 %, because the binary value of an already-1-dp angle is re-rounded (`−127.7 → 232.4`).
    - So the auditor's 1.2 / 5.1 % depends on the grid. It needs a source angle that already sits on the 1-dp grid **and** a directed-rounding writer. Nearest rounding gives 0 % either way.
- **Harm:** none found. The arcs that close are under the printing's own step (≤ 0.0097 rad, ≤ 0.18°: a 0.03–0.4 mm arc). For harm, a writer would have to *deliberately* write such a sub-resolution arc with its angles a turn or more apart at 1–3 digits. Closing it then cuts a full ring where the drawing held a speck. No such writer or file is known.
- **Severity:** P3, as rated: decision-record drift, mostly forced by the spec's own overlap.
- **Fix direction:** the maintainer confirms the ADR's qualification. A text rule can separate at most the 2–8 % of ELLIPSE cases whose text is unambiguously coarse.

**E5-P3-2: CONFIRMED P3. Shares corrected.**
- **R1, unchanged on all three trees:**
  - `−3.14 → 3.14` and `0 → 6.28`: O, 242.053 mm on main, `pre1843` and `pre1832`;
  - `−3.141 → 3.141`: O, 242.103 mm;
  - `10.01 → 16.29`: O.
  - The gap on my ellipse is 0.079 mm. The seam at t = ±π moves at the minor semi-axis speed (25 mm/rad), so the gap is 25 × 0.003185.
  - At R = 100 the gap is **0.32 mm**. With a 0.1–0.2 mm kerf that leaves a 0.1–0.2 mm bridge, about the size of a microjoint.
  - The contour stays open, so it gets no kerf offset and no inside-first closure. No note.
- **Shares, R2 on a stratified grid:**
  - **ELLIPSE 2 dp:** **68.1 %** open near-full in nearest, half-even, ceil and floor, on any range. The analytic value is 1 − frac(200π) = 0.68147: the written difference is 6.28 or 6.29. Truncation gives 84.1 % on [−π, π).
  - **ELLIPSE 4 sd nearest:** 17.7 % on [0, 2π) and 0 % on [−π, π).
  - The auditor's 60.9 % and 8.3 % come from a 0.002 rad grid that aliases with the 0.01 printing step.
- **Is `−π → π` plausible?** It is atan2's range, and the repo holds no exporter evidence either way.
  - At 3+ decimals and 4+ significant digits it now closes (`−3.142 → 3.142`, `−3.1416 → 3.1416`), except truncated 3 dp.
  - It stays open only at 2 decimals, or 3 sd, which is identical text.
- **Severity: P3.**
  - The maintainer's spec limits the "must close" rule to angles "at least a turn apart". Amd 5 Decision 2 announces near-full open arcs.
  - The output matches what the decision asks for, so this is a decision trade-off, not a defect (as E4-P3-1 was rated).
- **Worth putting to the maintainer.** An ELLIPSE-only within-one-turn snap of about 5.1e-4 turn would close `−3.14 → 3.14` and `0 → 6.28`, because the 2 dp shortfall is fixed at 0.003185 rad. The cost: gaps up to R × 0.0032 would close silently (0.32 mm at R = 100), which is the deliberate-bridge question of E4-P3-1 again.

### New findings

**E5R-P3-1: A full ARC or ELLIPSE written to 4 significant digits with large angles (ARC end ≥ 1000°, ELLIPSE ≥ 100 rad) collapses under round-to-nearest. That is outside the test's start range, and the spec is ambiguous there.**
- **Where:** `dxf-curve-sampling.ts:91-92` (`ARC_WRAP_SNAP`, `ELLIPSE_WRAP_SNAP`) and `:119-120`. The test's `starts()` covers only [−turn, turn) (`dxf-printed-angles.test.ts:38-45`).
- **Anchor:** maintainer spec: "4+ significant digits within rounding of a whole turn … MUST import as a full turn". Against it, "only 1 decimal … must NOT snap" and ADR Decision 3: "Coarser printing imports as its numbers say".
- **Evidence (REPRO):**
  - **R2:** ARC 4 sd, half away and half even, starts in [360°, 720°): **7.78 %** dots (`640.5 → 1001`, which is 360.5° written); ceil 17.8 %. The worst nearest error is 0.5° = 1.389e-3 turn, and `ARC_WRAP_SNAP` is 5e-4.
  - **R4, through `parseDxf`:**

    | Case | main and pre-#1843 / #1832 | pre-#1820 |
    |---|---|---|
    | ARC `640.5 → 1001` | 2 points, 0.349 mm | open 360.5° overlap, 251.57 mm, so cut whole |
    | ELLIPSE `100.0 → 106.3` | 0.556 mm dot | closed |
    | ELLIPSE `100.4 → 106.7` | 0.430 mm dot | closed |

    - The ARC case is a residual of E1-P1-2 from #1820. The ELLIPSE cases are a residual of E3-P1-1 from #1832.
- **Scenario:** a writer that does not normalise ARC start angles, or ELLIPSE parameters past 16 turns, prints `%.4g`. A full circle becomes a dot with no note.
- **Severity: P3, not P1.** The output is defensible as written.
  - At these magnitudes, 4 significant digits **is** 1 or 0 decimals: `640.5` has 1 decimal and `1001` has none. That is the printing the maintainer said to leave as written. So the spec contradicts itself for this text, and "as its numbers say" is a valid reading.
  - The inputs are also far outside normal practice. AutoCAD-style ARC angles lie in [0°, 360°), and full ellipses start in [0, 2π).
  - It is not caused by #1843, which lowered the ARC share from 10 % to 7.8 %.
- **Announced?** No. The ADR and the test do not mention magnitude.
- **Novelty:** new. The auditor's `h1` probe looked only at ≥ 1e14°.
- **Fix direction:** none, unless the maintainer says 4 sd means "within 4-sd rounding" at any magnitude. The other way is an allowance scaled by |angle| (a relative error), which would also close coarse 1-dp text. Either way, the test's start range should say "within one turn of zero" in a comment.

### Probes with no gap

- **New-gap search in #1843's diff (READ plus the R6 bands):**
  - The early return `Math.abs(difference) < turn` and the far branch change nothing within a turn.
  - The far near-full side (`0 → 719.82°`, `0 → −360.1°`, ELLIPSE `0 → −6.29`) closes only inside the bands (0 of 46,190 changed outside).
  - `arcSweep` keeps its within-turn bit path.
  - NaN, ±Inf and the default `42 = 2π` are unchanged.
  - `ellipseArcCurve` gets the same sweep and closed flag as the polyline.
- **Reverse-written full ELLIPSE:**
  - `6.2832 → 0` is more than a turn apart and closes on the far near-full side.
  - `6.2831 → 0` and `6.283185 → 0` are less than a turn apart and stay a dot, as written.
  - Unchanged in kind, as the auditor said.
- **Mixed nearest rounding** ("start down, end up"): bounded at 0.0055 rad (3 dp start, 2 dp end) and 0.006815 rad (2 dp / 2 dp). Below the allowance (R2b).
- **ARC at 4 sd within [−360°, 360°):** 0 % dots in every mode. The worst error is 0.1° (2.78e-4 turn), under 0.18°.

### Not verified

- **Real exporters' angle formats.** I downloaded nothing, so whether any writer rounds directed, writes −π → π at 2 decimals, or writes ARC angles ≥ 640° is unknown. The repo's tests name only ezdxf and AutoCAD, for other entities.
- **The ADR's "9 of these tests fail on Amendment 4"** (the auditor measured 11). Not re-run.
- **Hardware:** whether a 0.1–0.2 mm post-kerf bridge (E5-P3-2) holds a part.
- **Browser:** no run. The worker parse ran in Node, with `pack` / `unpack` standing in for postMessage.
- **The full suite:** only 9 DXF files ran.

### Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-e5r\`. Run them from that folder.

| File | What it covers | Output |
|---|---|---|
| `register.mjs`, `ts-resolve.mjs` | Own loader (esbuild from `j37-main`; bare imports from own trees via `j37-main`) | — |
| `pre1843\`, `pre1832\`, `pre1820\` | `git archive` of `src/` at `8d92bd143`, `1f016b610`, `92bccd5d3` | — |
| `r-lib.mts` | Own DXF text, measure, exact BigInt formatter (5 rounding modes) | — |
| `r1-cases.mts` | Named cases on three trees, worker equality | `out/r1-cases.txt` |
| `r2-modes.mts [N]` | Rounding-mode census on a stratified grid, rule level, main versus `pre1843` | `out/r2-modes.txt` |
| `r3-coarse.mts [N]` | E5-P3-1 split by ambiguous text; worst fine-printing error per mode | `out/r3-coarse.txt` |
| `r4-big.mts` | E5R-P3-1, large angles on four trees | `out/r4-big.txt` |
| `r5-mutants.mjs [ids]` | B0, Ad3, Ed14, Kfix (1.568e-3), Kfix2 (1.585e-3) on `mut\`, 9 DXF files (restored and compared) | `out/r5-mutants.txt` |
| `r6-identity.mts` | Genuine-arc identity, band check, `isFullEllipseSweep`, INSERT placements | `out/r6-identity.txt` |
| `r7-kfix.mts` | Kfix through `parseDxf` (run with `mut\` mutated, then restored and compared) | `out/r7-kfix.txt` |
| `r8-grid.mts` | ARC 1 dp directed rounding, exact 0.1° grid versus generic | `out/r8-grid.txt` |
| `mut\` | Own copy; `node_modules` is a junction (do not delete recursively) | — |

```json
{
  "area": "E5",
  "role": "refuter",
  "tree": "0e1a476f5",
  "verdicts": [
    {"id": "E5-P1-1", "verdict": "CONFIRMED", "severity": "P1", "evidence": "REPRO r1 parseDxf own ellipse: 3.717->10.01 2 pt 0.338 mm no note (pre-#1832 closed 242.13 mm); worker same; every INSERT placement; r2 4 sd ceil 0.765 % of [0,2pi) (analytic 0.757 %), 0 % for nearest/half-even/trunc in every range; worst fine-printing error 0.009815 rad (ceil/floor) vs 0.006815 (nearest)", "note": "reach directed rounding only; 'no constant can fix' refuted: ELLIPSE_WRAP_SNAP 1.568e-3 passes 171/171 incl. the 0.0099 pin and closes every fine printing; ADR 'less than 0.01' bound is correct; text-precision fix breaks on %g-stripped '11'/'0'"},
    {"id": "E5-P3-1", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO r3: ELLIPSE 3 sd closures 33.3 % (nearest), 92-98 % of them text that is also a 2+ decimal printing; ARC 3 sd 4.5 %; ARC 1 dp 0 % on generic starts (18.6 % directed on an exact 0.1-degree grid, r8)", "note": "spec overlap, no job harm found"},
    {"id": "E5-P3-2", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO r1: -3.14->3.14 open on main/pre1843/pre1832 alike; r2: ELLIPSE 2 dp open near-full 68.1 % (analytic 1 - frac(200pi)), auditor's 61 % is grid aliasing", "note": "by spec and announced; ELLIPSE-only within-turn snap ~5.1e-4 turn is a maintainer question"}
  ],
  "clean_checks": {"genuine": "394,728 rule pairs + 2,707 imports identical to pre1843; over-turn 46,190 changed, 0 outside bands", "isFullEllipseSweep": "0/300,000", "insert": "plain/mirror/rot30x2/-Z/2x2 grid follow the rule (incl. E5-P1-1 collapse)", "entry_points": "phone/MCP/re-import share parseDxfBlob or parseDxf (READ); own DXF writer emits only LWPOLYLINE"},
  "mutants": {"B0": "171/171", "Ad3": "survived 9 files", "Ed14": "survived 9 files", "Kfix 1.568e-3": "171/171 pass", "Kfix2 1.585e-3": "fails only the two #1843 0.0099 pins"},
  "new": [
    {"id": "E5R-P3-1", "severity": "P3", "evidence": "REPRO r2/r4: ARC 4 sd nearest, starts [360,720) deg: 7.78 % dots (640.5->1001 0.349 mm; pre-#1820 cut whole); ELLIPSE 100.0->106.3 dot (pre-#1832 closed)", "note": "at these magnitudes 4 sd is 0-1 decimals, which the maintainer said to leave as written; outside the test's start range; implausible inputs"}
  ],
  "counts": {"raised": 4, "refuted": 0, "P1": 1, "P2": 0, "P3": 3, "known": 5}
}
```

Refuter counts: raised 4, refuted 0, P1 1, P2 0, P3 3, known 5
