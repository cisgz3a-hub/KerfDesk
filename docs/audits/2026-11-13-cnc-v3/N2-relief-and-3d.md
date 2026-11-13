# N2 — Relief and 3D (CNC audit v3, `relief-and-3d`)

**Question.** Does every relief program KerfDesk emits carve the surface it promises when it is swept through a stock model? The checks cover:
- no gouge below the intended surface;
- no cut past the relief depth, the stock bottom or the relief's footprint;
- the stated scallop, and the 3D roughing allowance;
- no rapid move into stock, and plunges at the plunge feed;
- rest finishing cutting only where the previous bit left material, and covering all of it;
- two-sided halves meeting;
- Job Review warnings matching the real conditions at the stock bottom, at thin tabs and outside the stock.

**Tree.** `origin/main` @ `9a0b1a80b` (read-only export `j38-main`).
- Relief commits since the last audits (F6 on 2026-10-23, X6 on 2026-11-09) are:
  - `1deb6fab5` (#1420): two-sided sides follow the stock; curved rails are accepted;
  - `9a2bf6b13` (#1452): ADR-412 Amd 2, the footprint wall;
  - `856782389` (#1622): ADR-580 Amd 2, the pixel-centre surface;
  - `a5abca493` (#1643);
  - `cfbcc9663`, the X6 fixes: ADR-572 Amd 4 and ADR-421 Amd 3;
  - the C2 refactors `ab3226fd1` and `26ead0e8e`.
- `gh pr list --state open` returned 0 open PRs.

**Method.**
- **My own oracle** (`n2-sim.ts`, `n2-oracle.ts`). It shares no code with the CAM, with N1's `n1-reader.ts`, with J1's oracle, with the X6 or X6r simulators, or with `relief-gcode-stock.test-support.ts`.
  - **G-code reader.** Modal G0/G1/G2/G3, G90/G91, G20/G21 and F. The tool comes from the emitter's `; cnc tool-id:` comment, and the operation from `; cnc operation:`.
  - **Heightfield stock.** A top-Z grid of 0.05 mm cells (0.025 mm for the flat checks, 0.1 mm for two-sided), in machine coordinates.
  - **Exact sweep of every move, rapids included.** For each cell, a quadratic gives the reach interval of the move's XY segment. The lowest tool bottom over that interval is the minimum of the convex `z(t) + profile(d(t))`: in closed form when Z is constant, otherwise by golden section.
  - **Cutter profiles.** Flat, ball, V / truncated-cone engraver, and tapered ball (tip ball tangent to the flank). Each is solid above its profile out to radius R.
  - **3D allowance check.** The roughing moves are swept a second time with the cutter Minkowski-dilated by a ball of the allowance. It is exact for the flat and the ball, and numeric for the others.
- **Reference surfaces, all my own.**
  - Height maps: the upper envelope of both triangulations of the pixel centres, with a half-pixel clamped border (ADR-580 Amd 2's stated surface). The analytic surface is recorded too, for information.
  - STL: a max-Z raster of the triangles, with empty cells on the floor or the top.
  - Masks: excluded cells are kept at Z0.
  - Two-sided: the mesh's own piecewise-linear top and bottom (the same diagonal as the STL I wrote). Side B is mapped back through my own physical-flip equations (mirror X across the stock width for a flip around Y; mirror Y for a flip around X; plus the side-B origin).
- **Measures** per program:
  - **Gouge:** reference − stock. "Robust" takes the lowest reference within one cell, which absorbs grid error on one-pixel walls.
  - **Over-depth:** the deepest stock Z; cells cut outside the footprint.
  - **Residual against the reference,** by slope band, inside an interior band of 2.5 mm.
  - **Excess over the ideal.** The ideal is the last finishing bit drop-cut on the reference, with the outside held at the stock top, then swept, on a 0.1 mm lattice. This separates "the bit cannot reach" from "the program left it".
  - **Load:** the fresh stock above the tip under the centre line, read before each lateral feed move. I report the total length over Depth per pass + 0.05 mm, the longest continuous stretch, and the maximum.
  - **Moves:** rapids that remove stock, and the feed of every plunge.
  - **ETA:** `estimateJobDuration` against my lower bound (feed-only time + rapids at 6000 mm/min + G4 dwells).
- **Entry points:**
  - `emitGcode` (the Save path) and `prepareOutput`;
  - `detectMachineJobWarnings(prepared.project, …, prepared)`;
  - `job.cncCompilation.reliefPlans`;
  - `estimateJobDuration`;
  - the real store action `reliefTwoSidedActions(set).splitReliefForTwoSides` over a minimal state.
- **Scenes:** analytic height maps of 20–24 mm at 0.05–0.2 mm pixels, 16-bit (one 8-bit):
  - dome on a floor;
  - bowl;
  - 45° cone with a sharp apex;
  - egg-crate;
  - vertical terraces;
  - knife ridge plus a 0.2 mm rib;
  - a slot, a pit and a channel;
  - a 6 mm square pocket;
  - flats and ramps;
  - bumps; a groove.

  STL: a grid dome, a cone, a box on a plate, and a disc with empty top / empty floor. Plus a masked dome, rotated / scaled / mirrored reliefs, a projection plaque and a closed two-sided solid.
- **Bits:** the starter `em-3175`, `em-6350`, `bn-3175`, `bn-1588`, `bn-6350`, `em-1588` and `vb-60-3175`. Added tools: a tapered ball (1 mm tip, 10°, 3.175 mm; and 1 mm, 20°, 6.35 mm), a 30° engraver with a 0.3 mm flat, a 1 mm ball, and 1.58 / 1.60 mm balls.
- **READ:**
  - `compile-cnc-relief.ts`, `compile-cnc-relief-finishing.ts`, `compile-cnc-relief-rest.ts`, `compile-cnc-relief-rest-step-down.ts`;
  - `cnc-relief-group.ts`, `cnc-air-floor.ts`, `cnc-pass-air-floors.ts`, `relief-air-floor-proof.ts`, `cnc-grbl-entry-descent.ts`;
  - `relief-roughing-reach.ts`, `relief-finishing-strategy.ts`, `heightfield-to-heightmap.ts` (mask path), `relief-two-sided-split.ts`, `relief-two-sided-stock.ts`, `cnc-two-sided-setup.ts`, `relief-two-sided-actions.ts`;
  - `cnc-compiled-depth-warnings.ts`, `cnc-projection-stock-warnings.ts`, `cnc-relief-planning-warnings.ts`, `machine-job-warnings.ts`, `ReliefAdvancedCncControls.tsx`;
  - ADR-412 Amd 2, ADR-421 Amd 3, ADR-580 Amd 2.
- **Not used:** Vitest, pnpm, a browser, hardware, the GRBL simulator. Node peaked well under 1 GB, with 2.5–3.2 GB free.

## Headline

**No gouge, no over-depth, no cut outside the footprint, no rapid into stock, and no plunge off the plunge feed, in 117 emitted programs.**
- The worst robust gouge is 0.001 mm and the worst vertical one 0.03 mm, measured against my own pixel-centre and mesh surfaces. A few larger vertical values are one-pixel walls whose robust and normal depth is ≤ 0.004 mm, not gouges.
- Roughing keeps its full 0.5 mm in 3D. Flat finishing on flats keeps exactly the stated scallop (0.025 and 0.005 mm).
- Two-sided halves meet within 0.02 mm (median), with a ≥ 1.00 mm web, including after the stock is edited to 12.5 or 18 mm.
- The X6 projection fixes hold on new geometry.

**Three P2s and one P3 are new.** All four are about bit load or warnings, not geometry.
1. **N2-P2-1. Narrowing finishing bits slot the unroughed edge band.** The rule that steps a small bit down in the edge band (ADR-421 Amd 3, X6-P2-3) uses the bit's nominal diameter. A tapered ball, V-bit or engraver therefore counts as "large" and cuts the band full depth on its first row, with no level and usually no note:

   | Bit | Run | Under the centre | Feed |
   |---|---|---|---|
   | Tapered ball, 1 mm tip | 22.1 mm at Z−2.335 | up to 2.82 mm | F1000 |
   | 30° engraver | 21.3 mm | up to 4.28 mm | F1000 |

   A plain 1 mm ball on the same cone gets 3 levels and 0.50 mm.
2. **N2-P2-2. Rest finishing with the starter 1/4" ball → 1/16" ball pair slots the edge band the 1/4" ball could not reach:** 6.7 mm at Z−4, F1000, up to 3.72 mm under the centre, with no level and no note. The small-bit test is `radius < allowance + cell`. In the rest stage that is 0.794 < 0.79375, false by 0.25 µm. A 1.58 mm ball gets 84 mm² flagged, 2 levels and 1.50 mm.
3. **N2-P2-3. A relief whose floor stops a hair above the stock bottom gets no warning.**

   | Depth in 6.35 mm stock | Floor left | Warning |
   |---|---|---|
   | 6.35 | 0 | "reaches the configured stock bottom" |
   | 6.36 | −0.01 | "past the bottom" |
   | 6.349 / 6.34 / 6.30 | 0.001 / 0.01 / 0.05 mm | nothing |

   The 6.30 case on a raised plate holds the part by a 0.05 mm skin.
4. **N2-P3-1. At defaults, rest finishing plans coarser rows than the finish it follows** (rest scallop 0.05 against finish 0.025). On a bumpy 16 mm relief, the rest program leaves more than 0.05 mm over a plain 1/16" finish on 21 % of the interior (worst 0.31 mm). With the rest scallop set to 0.025 it leaves 0 %.

KNOWN items were re-observed, not re-raised:
- F6-P3-1: the rest-prediction budget now falls back at 20 × 20 mm with 1/4" → 1/16".
- K-3: V-bit and engraver rows leave the allowance, and ridges of 1.1–1.9 mm on slopes.
- ADR-423 / K-4: raster leaves walls parallel to the rows.
- X6-P3-1: the reach-threshold slack lets a 1/4" or 1/8" ball take 2.0 mm along an edge after `em-6350` roughing.

## Results by strategy

The full per-program table (64 matrix programs) is `out/matrix-table.md`. Below, "excess" is stock above the ideal for that bit (the bit dropped on the reference). "Load" is finishing-move stock above the tip under the centre over Depth per pass (1.5 mm), given as total length / longest stretch / maximum. Every program had 0 cells cut outside the footprint, 0 rapids into stock, and every plunge at F300.

### Finishing tools across the analytic height maps (raster X unless noted)

| Bit / strategy | Worst gouge, vertical / robust (mm) | Excess p95 on gentle slopes (2–45°) | Excess p95 on flats | Load over dpp (worst case) | Notes |
|---|---|---|---|---|---|
| `bn-3175` raster | 0.008 / 0.001 | 0.019–0.16 | 0.02–0.31 | 0 | Flats beside walls parallel to the rows keep slivers (ADR-423, KNOWN). Egg-crate troughs tighter than the ball: 0.13–0.16 |
| `bn-3175` raster + waterline | 0.007 / 0.001 | 0.01–0.05 | 0.012–0.074 | 0 | Closes the parallel-wall slivers (dome 0.122 → 0.024) |
| `bn-3175` raster Y | 0.004 / 0 | 0.019–0.24 | 0.12–0.23 | 0 | Mirror of X |
| `bn-1588` | 0.006 / 0 | 0.022–0.047 | 0.028–0.053 | 0 (edge band stepped, X6-P2-3 fix) | — |
| `em-1588` | 0.012 / 0 | 0.07–0.33 | 0–0.18 | 0 | Rows 0.4·D (KNOWN K-3 class) |
| `vb-60-3175` | 0.003 / 0 | 0.44–1.13 | 0.5–1.0 | cone 11.9 / 3.9 / 2.20; sine 12.9 / 3.6 / 2.47 | K-3 ridges re-observed; edge band, **N2-P2-1** |
| tapered ball, 1 mm tip, 10° | 0.009 / 0 | 0.02–0.06 | 0.022–0.03 | **cone 23.6 / 22.1 / 2.82**; steps 6.2 / 6.2 / 2.31; dome 12.7 / 5.6 / 2.31 | **N2-P2-1** |
| 30° engraver, 0.3 flat | 0.005 / 0 | 0.45–1.87 | 0.5–1.63 | **cone 33.4 / 21.3 / 4.28**; ridge 27.5 / 4.5 / 3.26 | K-3 ridges; **N2-P2-1** |
| `bn-3175` + roughing-bit flats (ADR-450) | 0.006 / 0.001 | as raster | 0.031 (steps) | 0 | Roughing comes to the flats exactly (3D allowance 0 there, by design) |
| `bn-3175`, fine step 0.5 / ramp 10° / allowance 0 | 0.004 / 0 | as raster | as raster | 0 | Ramp: no plunge off F300 |

### Flats and ramps (`n2-flat.ts`, 0.025 mm cells): the scallop law holds exactly

| Surface | Bit, scallop | Residual p50 / p95 / max (mm) |
|---|---|---|
| flat | `bn-3175`, 0.025 | 0.006 / 0.023 / **0.025** |
| flat | `bn-3175`, 0.005 | 0.001 / 0.005 / **0.005** |
| flat | `bn-1588`, 0.025 | 0.006 / 0.022 / 0.025 |
| ramp ≈ 5° (rows across) | `bn-3175` / `bn-1588`, 0.025 | 0.006 / 0.023 / 0.025–0.026 |

### Extra routes (`out/extra.txt`)

| Case | Gouge vertical / robust | Deepest | Load over dpp | Result |
|---|---|---|---|---|
| 6 mm square pocket, Depth per pass 1, finish `bn-3175` / `em-3175` with allowance 0 / ramp 5° / roughing-bit flats | 0.03 / 0 | −6.000 | 0 | Air-floor rapids present; 0 rapids into stock |
| 8-bit dome | 0.004 / 0 | −4.000 | 0 | clean |
| Masked dome, `bn-3175` / `vb-60-3175` | 0 / 0 | −2.154 / −3.097 | 0 / 1.0 mm (corner) | No cut in the excluded area. A 2 mm trench narrower than both bits is left; the ball cannot fit (conservative mask cells, ADR-580 Amd 2) |
| Dome rotated 30° / scaled 1.5 × 1 / mirrored | 0.004 / 0 | −4.000 | 0 | Footprint followed exactly; 0 cells outside |
| STL dome, box (raster and waterline), disc with empty floor / top | ≤ 0.004 / 0. Disc wall: 1.27 vertical, 0.03 normal, 0 robust | −4 / −5 / −3 / −0.002 | 0 | The empty-cell rule is honoured |
| STL cone, `vb-60` / tapered | 0.002 / 0 | −5.000 | 12.5 / 5.7 / 1.98; **23.7 / 22.0 / 2.46** | **N2-P2-1** on an STL too |

### Rest finishing

| Case | Rest bit load over dpp | Rest plan | Note |
|---|---|---|---|
| dome 20 mm: `em-6350` → `bn-6350` → `bn-1588` | **7.96 / 6.69 / 3.72 at Z−4, F1000** (row along the edge band, 1.18 mm in) | fallback (budget), no `predecessorMissedAreaMm2`, no levels | **N2-P2-2** |
| same, rest `bn-1580` (1.58 mm) | 0 / 0 / 1.50 | 84 mm² missed, 2 levels | note names the levels |
| same, rest `bn-1600` | 7.86 / 6.69 / 3.70 | none | **N2-P2-2** |
| cone 24 mm, `bn-1588` / `bn-1580` | 1.13 / 1.00 / 4.68 vs 0 / 0 / 0.89 (56 mm², 3 levels) | fallback | **N2-P2-2** |
| groove 12 mm (`bn-6350` → `bn-1588`, default rest scallop) | 0.05 mm | selected 1,199 cells | leaves a wall sliver of about 0.1 mm × full height that a 0.025 rest does not (**N2-P3-1**) |
| bumps 16 mm (same) | 0 | selected 13,455 cells | 12,141 / 57,600 interior cells > 0.05 mm above a plain 1/16" finish; worst 0.314 (**N2-P3-1**). With rest scallop 0.025: **0 cells** |
| steps 24 × 20 (`bn-6350` → `bn-1588`) | 1.0 / 1.0 / 2.68 | selected, no fallback | ok (corner) |
| dome / sine / cone / slots + waterline, 20–24 mm | — | **fallback: "exceeded its work budget"** | KNOWN F6-P3-1, now at 20 mm |

### Stock bottom (`out/bottom.txt`): what Job Review's warnings say

| Relief depth / stock (mm) | Deepest emitted Z | Floor left | Stock-bottom warning |
|---|---|---|---|
| 6.35 / 6.35, and 6 / 6, 12 / 12, 3 / 3; V-bit, `em-1588` and engraver at 6.35 / 6.35 | −depth | 0 | "reaches the configured stock bottom … Relief paths have no holding tabs" |
| 6.36 / 6.35, 6.4 / 6.35 | −6.36, −6.40 | −0.01, −0.05 | "… mm past the bottom, into the spoilboard" |
| **6.349 / 6.35, 6.34 / 6.35, 6.30 / 6.35, 11.95 / 12, 5.95 / 6** | as set | **0.001 to 0.05** | **none (N2-P2-3)** |
| **raised 10 × 10 plate on a 6.30 floor in 6.35 stock** | −6.300 | **0.05** | **none** |
| roughing only, 6.35 / 6.35 or 6.4 / 6.35 | −5.85, −5.90 | 0.50, 0.45 | none. Correct: the program does not reach the bottom |

### Two-sided (`out/twosided.txt`): 20 × 12 × 10 mm closed solid with a domed top and a recess in the bottom; split 5, web 1, margin 4

| Variant | Side A / B deepest | Part thickness − model (p50 / max) | Worst gouge, top / bottom | Web in the margin (min / p50) | Through cells | Warnings |
|---|---|---|---|---|---|---|
| 14 mm stock, flip Y | −7 / −6 | 0.022 / 0.73 (raster on the dome's rim) | 0.003 / 0.023 | 1.000 / 1.546 | 0 | — |
| Flip X | −7 / −6 | 0.023 / 0.73 | 0.003 / 0.051 | 1.000 | 0 | — |
| Side B origin (7, 3) | same | 0.022 | 0.003 / 0.023 | 1.000 | 0 | — |
| Model rotated 30° | same | 0.023 | 0.003 / 0.037 | 1.000 | 0 | — |
| Split on 14, stock then 12.5 | −6.25 / −5.25 | 0.022 | 0.003 / 0.023 | 1.000 | 0 | — |
| Split on 14, stock then 18 | −9 / −8 | 0.022 | 0.003 / 0.023 | 1.000 | 0 | — |
| 8 mm stock (model 10) | −4 / −3 | −0.99 (capped, as warned) | — | 1.000 | 0 | "thicker than the 8 mm stock: both stock faces cut it down, so the part comes out 8 mm thick" |

### Projection onto a relief (`out/proj.txt`): X6 fixes, independent geometry (40 mm plaque, 26 mm square on path)

| Case | Bridges measured on the loop | Warning |
|---|---|---|
| Floor 4 in 6, Vd 2.5 | 4 × 6 mm × 2.00 | spoilboard 0.50 only. Correct |
| Floor 5.7 in 6, Vd 1 | 4 × 6 mm × 0.30–0.32 | "holding tabs are only 0.3 mm thick, not the 2 mm set" ✓ |
| Floor 5.95 in 6 | 4 × 6 mm × 0.05–0.07 | "cuts 1 closed shape through … tab windows leave no more than 0.1 mm" ✓ |
| Floor 6 in 6 | none (≤ 0.02) | the cut-free note plus the relief note "reaches the configured stock bottom" ✓ |
| Engrave Vd 1 at 0.5 per pass, roughing-only relief | worst single move 0.50 mm ✓ (X6-P2-1 fix) | — |
| Same, relief finished later (default bit order) | worst 1.00 mm | the order warning names the first-pass load ✓ |

### ETA

Across all 117 programs, `estimateJobDuration` comes to **1.04–1.17×** my lower bound (feed-only time + rapids at 6000 mm/min + G4 dwells). It is never below it. Example: dome / `bn-3175` is 297 s, against 229 s feed + 26 s rapid + 6 s dwell.

## Findings

### N2-P2-1 — Narrowing finishing bits (tapered ball, V-bit, engraver) cut the unroughed edge band full depth: the small-bit rule reads the nominal diameter

- **Where:**
  - `src/core/cnc/compile-cnc-relief.ts:295-296`. The reach check gets `minWidthMm: nextTool.diameterMm / 2` and `nextToolRadiusMm: nextTool.diameterMm / 2`. For a tapered ball or a V-bit, `diameterMm` is the widest cut (3.175 mm), not the tip.
  - `src/core/relief/relief-roughing-reach.ts:79-82`. `smallNext = nextRadius < allowance + cell` is false (1.5875 against 0.5 + 0.397 = 0.897). So the envelope keeps eroding the edge band, and the band counts as "side-milled".
- **Anchor:**
  - Contract: ADR-421 Amendment 3, Decision 2 and Context: "That holds only for a bit whose centre stays out of the strip … A smaller bit rides with its centre in the strip".
  - Twin: ADR-368 Amendment 3, "narrowing bits cut width at depth". The layout code already uses the effective width at depth for these bits.
  - Twin: a ball of the same 1 mm tip is stepped down.
- **Evidence:** REPRO (`n2-narrow.ts` → `out/narrow.txt`; `n2-matrix.ts` → `out/matrix-run2.txt`; `n2-extra.ts` → `out/extra.txt`); READ. 1/8" end-mill roughing at 1.5 mm per pass, allowance 0.5, then the named finishing bit, raster X.

  | Relief | Finishing bit | Fresh under the centre, over dpp: total / longest stretch / max | Plan | Note |
  |---|---|---|---|---|
  | cone 24 mm (floor to the edge) | **1 mm ball** (`bn-1000`) | 0 / 0 / 0.50 | roughing missed 57 mm², **3 levels** | yes |
  | same | **tapered ball 1 mm tip, 10°, 3.175** | **23.6 / 22.1 / 2.82 mm**: one row 0.66 mm from the edge at Z−2.335, F1000 | nothing missed, no levels | **none** |
  | same | 30° engraver, 0.3 flat | **33.4 / 21.3 / 4.28** (row 0.98 mm in, F1000) | none | none |
  | same | 60° V-bit 1/8" | 11.9 / 3.9 / 2.20 | none | none |
  | same | tapered ball 1 mm tip, 20°, 6.35 | 1.6 / 0.9 / 1.92 | none | none |
  | STL cone | tapered ball 1 mm tip, 10° | 23.7 / 22.0 / 2.46 | none | none |
  | terraces 24 × 20 | tapered ball / engraver | 6.2 / 6.2 / 2.31; 7.7 / 6.1 / 3.00 | none | none |
  | dome 20 mm | tapered ball / engraver | 12.7 / 5.6 / 2.31; 18.0 / 6.1 / 3.35 | roughing missed 49 mm², 2 levels | yes, but the note says "the 3.175 mm finishing bit cuts it first in 2 step-down levels", and the edge row still runs full depth |

  The rows sit in the edge band. Roughing keeps its allowance plus the contour clearance off the footprint wall (ADR-412 Amd 2), so that strip is still at the stock top. The tapered tip descends to the outside law's limit, `−h(0.66) = −2.335`, through stock at Z0. For example, `out/narrow-cone-tb-10-1.nc:561`: `X50.664 → X73.302 Y349.336 Z-2.335 F1000`.
- **Scenario:** a maker finishes a depth-map relief (background floor to the image edge) with a tapered ball nose, the usual 3D finishing bit, after the default 1/8" roughing. On the first row along the edge, the 1 mm tip slots 2.3–2.8 mm deep at full feed for the whole edge length. The engraver goes to 4.3 mm. Job Review either says nothing, or says the finishing bit steps down.
- **Severity: P2.**
  - It is the X6-P2-3 / W6-P2-2 harm, cutter load: up to 2.8 × the tip diameter axially at full feed, on the most fragile relief bit.
  - Under meta v1 M6, cutter load with no wrong depth or gouge is P2 at most. My simulator shows no gouge (robust 0).
- **Announced?** No. ADR-421 Amd 3 speaks of "a small finishing ball" and a "1/8" ball"; narrowing bits are not mentioned.
- **Novelty:** new.
  - X6-P2-3 and its fix measured balls only.
  - X6 checked a V-bit and an end mill only in interior channels.
  - `git grep` over `docs/audits` finds no edge-band case with a tapered ball, V-bit or engraver.
  - The fix's tests (`prepare-relief-x6-followups.test.ts`) use balls.
- **Fix direction:**
  - For narrowing bits (`tapered-ball-nose`, `v-bit`, `engraving`), pass the effective radius at one Depth per pass to `minWidthMm` and `nextToolRadiusMm` (ADR-368 Amd 3's width at depth), or the tip radius.
  - Name the narrowing bit's edge band in the reach note.

### N2-P2-2 — Rest finishing with the starter 1/4" → 1/16" ball pair slots the band the 1/4" ball left: the small-bit test fails by 0.25 µm

- **Where:**
  - `src/core/cnc/compile-cnc-relief-rest-step-down.ts:50-56`. The rest sweep runs `reliefRoughingReach` with `allowanceMm: 0`, `nextToolRadiusMm: rest.diameterMm / 2` (0.794), on a grid of `finishing.diameterMm / 8` (6.35 / 8 = 0.79375).
  - `src/core/relief/relief-roughing-reach.ts:79-81`. `smallNext = 0.794 < 0.79375` is false, so the edge band is "side-milled".
  - The threshold (`dpp + 0 + 0.794 = 2.29 mm`) also passes over the 1.9 mm the 1/4" ball left in the floor between the dome and the edge.
- **Anchor:**
  - Contract: ADR-421 Amd 3, Decision 1 ("The rest bit then cuts what they missed in levels of the rest stage's own depth per pass") and Decision 2 (the edge band).
  - Consequences: "Edge band: no 1/16" finishing move has more than a pass under its centre along the edge band (2.96 mm before)".
  - Twin: a 1.58 mm ball (radius 0.790) on the same relief.
- **Evidence:** REPRO (`n2-restedge.ts` → `out/restedge.txt`, `dbg-edge2.ts`, `dbg-rest.ts`); READ.

  | Relief (20 mm dome / 24 mm cone, floor to the edge) | Rest bit | Rest load over dpp: total / stretch / max | Rest plan (`reliefPlans`) | Note |
  |---|---|---|---|---|
  | dome | `bn-1588` (starter) | **7.96 / 6.69 / 3.72 mm**: row 1.18 mm from the edge, X 0.9→19.2 at Z−4, F1000 (`out/restedge-dome-bn-1588.nc:5018`); 0.45 mm of it over 2 × dpp | no `predecessorMissedAreaMm2`, no levels | none |
  | dome | `bn-1580` | 0 / 0 / 1.50 | **84 mm² missed, 2 levels** | "the finishing bit cannot reach about 84 mm² … The 1.58 mm rest bit cuts it first in 2 levels" |
  | dome | `bn-1600` | 7.86 / 6.69 / 3.70 | none | none |
  | cone | `bn-1588` | 1.13 / 1.00 / **4.68** | none | none |
  | cone | `bn-1580` | 0 / 0 / 0.89 | 56 mm², 3 levels | yes |

  Stock across the edge band at local X 10 (`dbg-edge2.ts`): after the 1/4" ball, Z −0.22 / −0.87 / −1.27 / −1.83 / −2.16 at 0.2 / 0.8 / 1.18 / 2.0 / 3.5 mm from the edge. After rest: −4.0. The 1/4" ball cannot enter the 4 mm gap between the dome's foot and the footprint wall.
- **Scenario:** the starter rest set-up (Rough 1/4" EM, finish 1/4" ball, rest 1/16" ball, all three in the starter catalogue) on a relief whose floor meets its edge. The 1/16" ball runs 6.7 mm of the edge at up to 3.7 mm (2.3 × D) under its centre at F1000. A 1.58 mm ball would have been stepped down.
- **Severity: P2.** Cutter load on a 1/16" ball, the X6-P2-2 / X6-P2-3 class (P2, meta v1 M6). No depth or gouge is wrong.
- **Announced?** No. ADR-421 Amd 3 Decision 2's "With a bit as large as the strip or larger, nothing changes" is literally followed. Its Consequences claim the 1/16" edge band is fixed, which holds only after a 1/8" end mill (strip 0.897).
- **Novelty:** new. It was introduced with `cfbcc9663`, whose tests pair the 1/16" ball with a 1/8" predecessor.
- **Fix direction:**
  - In the rest stage, the band a ball leaves is its own fillet, not an allowance strip: treat any rest bit smaller than the predecessor as "small".
  - Or compare with a tolerance, or against the predecessor's radius rather than one cell.
  - Measure missed stock against the rest Depth per pass without the cell slack where the predecessor ball could not reach (the X6-P3-1 slack is what hides the gap's 1.9 mm here).

### N2-P2-3 — A relief floor a hair above the stock bottom gets no warning; only an exact match or a deeper cut warns

- **Where:** `src/ui/laser/cnc-compiled-depth-warnings.ts:119-120`. The relief warning fires only when `emittedDepthMm > representedStockMm`, or (with `warnAtStockBottom`) when `emittedDepthMm === representedStockMm`, compared at output precision (0.001 mm).
- **Anchor:**
  - Contract: the warning's own text, "if this geometry separates a part, confirm workholding". It exists for the floor at the stock bottom.
  - Twin: ADR-572 Amd 4 / `cnc-projection-stock-warnings.ts`, where a floor that leaves ≤ 0.1 mm counts as cut free and tabs under 1 mm (`THIN_TAB_MM`) are named.
  - Twin: J1-P2-1, V-carve at the stock bottom with no warning (P2).
- **Evidence:** REPRO (`n2-bottom.ts` → `out/bottom.txt`, emitted G-code read by my reader); READ. 20 mm dome on a floor, 1/8" ball finish:

  | Relief depth / stock | Floor left (from the emitted deepest Z) | Warning |
  |---|---|---|
  | 6.35 / 6.35 | 0 | "reaches the configured stock bottom" |
  | **6.349 / 6.35** | **0.001 mm** | **none** |
  | **6.30 / 6.35** | **0.05 mm** | **none** |
  | **11.95 / 12, 5.95 / 6** | **0.05 mm** | **none** |
  | 6.36 / 6.35 | −0.01 | "past the bottom, into the spoilboard" |
  | **raised 10 × 10 mm part on a 6.30 floor in 6.35 stock** | **0.05 mm skin round the part** | **none** |
- **Scenario:** a maker carves a pierced design as a relief and sets its depth a touch under the board's thickness to be safe (6.3 in 6.35 mm). A 0.05 mm skin holds nothing, so the parts break free near the end of finishing, beside the spinning bit. At 6.35 the app would have warned about workholding. At 6.30 it says nothing.
- **Severity: P2.** The depth is the operator's, and the program is right. What fails is the advisory: it cuts off at exact equality, so the near-equal case (common, and a deliberate "safety" margin) is silent. That matches J1-P2-1's twin (P2), and METHOD §3 P2 ("real defect with limited harm").
- **Announced?** No.
- **Novelty:** new as a finding. The X6 refuter mentioned it in passing in X6-P1-1's evidence ("so T4 (a 0.05 mm floor) gets no note at all"). The X6 fix (ADR-572 Amd 4) covered projected tabs only.
- **Fix direction:** warn when the relief leaves less than a threshold. ADR-572 Amd 4 uses 0.1 mm for "cut free" and 1 mm for thin, so 0.1 mm, or a fraction of the stock. Say "leaves only N mm under the floor".

### N2-P3-1 — At defaults, rest finishing plans coarser rows than the finish it refines (rest scallop 0.05 against finish scallop 0.025)

- **Where:**
  - `src/core/cnc/compile-cnc-relief-rest.ts:105`: `reliefRestScallopMm ?? reliefScallopMm ?? 0.05`.
  - The finish reads `reliefScallopMm ?? DEFAULT_RELIEF_SCALLOP_MM (0.025)` (`compile-cnc-relief-finishing.ts:122`, `relief-finishing.ts:56`).
  - The UI shows the same 0.05 (`ReliefAdvancedCncControls.tsx:87`).
- **Anchor:** Twin: the finishing stage's default, and the plain 1/16" finish of the same relief. Contract: the rest stage exists to finish what the larger ball left. Its fallback default makes it coarser than the finish whenever Finish scallop is left untouched (absent).
- **Evidence:** REPRO (`n2-restcov.ts` → `out/restcov.txt`, `dbg-restmap.ts`, `dbg-groove.ts`, `dbg-row.ts`); READ. 1/8" EM rough → `bn-6350` finish → `bn-1588` rest, defaults:

  | Relief | Rest scallop | Interior cells left > 0.05 mm above a plain `bn-1588` finish | Worst | Excess over ideal p95 (2–20° / 20–45°) |
  |---|---|---|---|---|
  | bumps 16 mm | 0.05 (default) | **12,141 / 57,600 (21 %)**, in every trough | 0.314 | 0.336 / 0.266 |
  | bumps 16 mm | 0.025 | **0** | 0 | 0.079 / 0.107 (= plain finish) |
  | groove 12 mm | 0.05 (default) | 2,082 / 25,600: a ~0.1 mm wall sliver at the cell positions, and the end wall | 2.565 (vertical) | — |
  | groove 12 mm | 0.025 | 0 | 0 | — |
- **Severity: P3.** It is a default, and the field shows it (0.05), so no result is misleading. It is structural: the finer, later stage defaults to a scallop twice the earlier stage's. In concave areas tighter than the bit, the difference grows to 0.3 mm.
- **Announced?** The value is shown in the field. No note says it is coarser than the finish.
- **Novelty:** new. F6 verified rest coverage at 0.025 explicitly ("rest coverage when the prediction runs").
- **Fix direction:** default the rest scallop to the finishing scallop's effective value (`reliefScallopMm ?? DEFAULT_RELIEF_SCALLOP_MM`), in both compile and UI.

## Refuted / not raised

- **"Every two-sided split raises a false 'Reliefs … overlap … Move them apart' warning."** I saw it first in my own harness, which passed the authored project to `detectMachineJobWarnings`. Every caller passes `prepared.project`, which is reduced to the active side. With that, it is gone (it matches rolling v3 G5's refutation). Not raised.
- **"The finishing bit takes 3.8 mm under its centre in the 5 mm channel"** (`slots-bn16`, 1.07 mm stretch; `slots-bn16wl`, 1.45 mm). These are inside corners of the channel end, the sliver ADR-421 Amd 2 drops on purpose. Not raised.
- **"Rest leaves 2.5 mm in the groove"** (vertical). This is a ~0.1 mm horizontal sliver on a vertical wall. It is folded into N2-P3-1 (it disappears at rest scallop 0.025).
- **Masked dome trench left uncut, no roughing, no note.** The 2 mm included trench is narrower than both bits. ADR-580 Amd 2 keeps masked fields on conservative cells, so the ball is held off the mask edge. Not raised. ADR-580 Amd 2 states that masked maps stay conservative; the leftover, though, is not named in Job Review (see Not verified).
- **Scallop excess of 0.13–0.34 mm in egg-crate and bump troughs whose concave radius (0.5–1.1 mm) is smaller than the ball.** The scallop law does not apply where the ball cannot fit; any raster leaves this. Not raised.

## KNOWN status (from F6 / X6 and earlier)

| Item | Status on `9a0b1a80b` |
|---|---|
| F6-P1-1, two-sided split froze the stock | **Fixed, holds** (#1420): stock edits 14 → 12.5 / 18 give side depths −6.25 / −5.25 and −9 / −8, part error p50 0.022, web 1.000, 0 through cells |
| F6-P2-1 / 16-P2-1, depth-map slope stand-off | **Fixed** (#1622, ADR-580 Amd 2): ball raster on ramps leaves ≤ the scallop (0.025 / 0.005); robust gouge 0 against my pixel-centre surface |
| F6-P3-1, rest prediction budget | **Still open, re-observed, now at 20 mm.** 1/4" → 1/16" falls back on 20 × 20 (dome), 24 × 24 (sine, cone) and 24 × 20 + waterline (slots); a plain 24 × 20 (steps), 16 and 12 mm select. Disclosed in Job Review |
| F6-P3-2, rest point reduction | Fixed (#1622) |
| F6-P3-3, curved rails | Fixed (#1420); not re-run |
| K-1, crease chord | Documented (ADR-580 Amd 2); robust gouge 0 on the ridge and the 0.2 mm rib |
| K-3 / 16-P2-1 non-ball rows 0.4·D | **Re-observed:** `vb-60` and the engraver leave the 0.5 allowance on flats (p50 0.5) and ridges of 0.8–1.1 (V60) and 1.5–1.9 mm (engraver) on slopes; `em-1588` 0.07–0.33 |
| K-4 / ADR-423, raster on slopes and walls parallel to the rows | Re-observed: raster `bn-3175` dome flats p95 0.122 against 0.024 with waterline |
| X6-P1-1, X6-P2-1, X6-P3-2 (projection) | **Fixed, hold** on new geometry (table above) |
| X6-P2-2, rest step-down in a groove | Fixed for the groove; **the edge-band sibling is N2-P2-2** |
| X6-P2-3, small ball in the edge band | Fixed for balls under the strip (`bn-1588` after `em-3175`: 0 over dpp); **narrowing bits are N2-P2-1** |
| X6-P3-1, reach threshold slack | **Still open** (P3 sweep). Re-observed: `bn-6350` after `em-6350` takes 2.0 mm under the centre for 5.1 mm along the edge; `bn-3175` after `em-6350` takes 2.0 mm for 3.2 mm |

## Verified clean

- **Gouge.** Robust gouge ≤ 0.001 mm in all 117 programs. Vertical ≤ 0.03 mm except one-pixel or vertical walls (STL disc 1.27 vertical, 0.03 normal, 0 robust). This covers:
  - every bit: ball, flat, V, engraver, tapered ball;
  - raster X/Y and raster + waterline;
  - fine step, ramps, allowance 0 and roughing-bit flats;
  - rest, masks, 8-bit, rotate / scale / mirror, STL, two-sided.
- **Depth and footprint.** The deepest emitted Z equals −relief depth in every program. No cut below it, and **0 cells cut outside the footprint** (ADR-412 Amd 2 holds, including rotated and scaled reliefs).
- **Roughing 3D allowance.** The dilated sweep finds 0 cells closer than 0.5 mm (to 5 µm) in every roughing program. The exception is ADR-450 roughing-bit flats, which by design come to the flat height.
- **Rapids and plunges.**
  - 0 rapids remove stock in any program, including relief air-floor descents (`G0 Z-0.500` in the terraces) and two-sided sides.
  - Every Z-only descent is at the plunge feed (F300).
- **Scallop law.** On flats and gentle ramps the residual maximum equals the stated scallop exactly (0.025 / 0.005); p50 is 0.006.
- **Two-sided registration.** Flip around Y or X, a side-B origin, and a 30° rotation give halves meeting within the scallop (bottom gouge ≤ 0.051 mm) and a 1.000 mm web. An 8 mm stock under a 10 mm model is warned.
- **Projection (X6 fixes).** Thin tabs are named at 0.3 mm; cut free at ≤ 0.07 mm; a roughed-only relief's first pass ≤ 0.50 mm; the order warning fires.
- **Stock warnings.** Past the bottom (from 0.01 mm) and exactly at the bottom are both reported with the emitted depth. A relief whose toolpaths leave the stock XY gets "outside the … stock".
- **ETA.** 1.04–1.17× my lower bound, never under it.

## Not verified

- Browser: Job Review cards, Preview banners and the 3D viewers were not rendered. Warnings were read from `detectMachineJobWarnings` and plans from `reliefPlans`.
- Reliefs larger than 24 mm (memory and time), rails, sculpt and authoring documents.
- Two-sided with V or tapered bits, or with raster + waterline.
- Waterline with tapered balls on masks.
- Whether Job Review names a masked area that no bit can enter (the masked dome had no note at all).
- Hardware and the GRBL simulator (N5). Physical load claims (P2-1, P2-2) are inferred from the fresh stock under the centre and the feed, not measured force.
- Vitest was not run. No test file was needed.

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-n2\`. Run each with `node --no-experimental-webstorage --import ./register.mjs <file> [filter]`. Nothing in the repo or in `j38-main` was touched.

| File | What |
|---|---|
| `n2-sim.ts` | my G-code reader and exact heightfield sweep (flat, ball, V / engraver, tapered ball; dilation) |
| `n2-oracle.ts` | references (pixel-centre envelope, mesh raster), gouge / residual / ideal-excess / allowance / load / rapid / plunge / ETA measures |
| `n2-scene.ts` | depth-map, mesh, layer and project builders; `emitGcode` + `prepareOutput` + warnings |
| `n2-matrix.ts` → `out/matrix-run2.txt`, `out/matrix-table.md`, `out/<case>.json/.nc` | 7 surfaces × 15 strategies |
| `n2-extra.ts` → `out/extra.txt` | pocket and air floors, 8-bit, mask, transforms, STL |
| `n2-flat.ts` | scallop law on flats and ramps |
| `n2-narrow.ts` → `out/narrow.txt` | **N2-P2-1** |
| `n2-restedge.ts` → `out/restedge.txt`, `dbg-edge2.ts`, `dbg-rest.ts` | **N2-P2-2** |
| `n2-bottom.ts` → `out/bottom.txt` | **N2-P2-3** |
| `n2-restcov.ts` → `out/restcov.txt`, `dbg-restmap.ts`, `dbg-groove.ts`, `dbg-row.ts` | **N2-P3-1** and rest coverage |
| `n2-twosided.ts` → `out/twosided.txt` | real split action, both sides, physical flip |
| `n2-proj.ts` → `out/proj.txt` | projection tabs and load |

## Counts

Raised 4: P1 0, P2 3 (N2-P2-1, N2-P2-2, N2-P2-3), P3 1 (N2-P3-1).

Known re-observed, not raised: 5 (F6-P3-1, K-3, K-4 / ADR-423, X6-P3-1, K-1).

```json
[
  {"id":"N2-P2-1","severity":"P2","area":"relief-and-3d","file":"src/core/cnc/compile-cnc-relief.ts","line":296,"anchor":"ADR-421 Amd 3 D2 (a bit whose centre rides in the strip steps down); twin ADR-368 Amd 3 width at depth; twin 1 mm ball steps down","evidence":"REPRO n2-narrow.ts: cone 24 mm, tapered ball 1 mm tip 10deg: 22.1 mm row at Z-2.335 F1000, 2.82 mm under centre, no missed area, no levels, no note; 1 mm ball: 57 mm2, 3 levels, 0.50; engraver 30deg 21.3 mm / 4.28; V60 3.9 / 2.20; STL cone tb 22.0 / 2.46","known":false,"summary":"Narrowing finishing bits (tapered ball, V-bit, engraver) slot the unroughed edge band full depth because the X6-P2-3 small-bit rule uses diameterMm/2"},
  {"id":"N2-P2-2","severity":"P2","area":"relief-and-3d","file":"src/core/cnc/compile-cnc-relief-rest-step-down.ts","line":55,"anchor":"ADR-421 Amd 3 D1/D2 and its edge-band Consequence; twin 1.58 mm ball","evidence":"REPRO n2-restedge.ts: dome 20 mm em-6350/bn-6350/bn-1588: rest row Z-4 F1000 6.69 mm stretch, 3.72 under centre, no predecessor missed area, no levels, no note; bn-1580: 84 mm2, 2 levels, 1.50; bn-1600 = bn-1588; cone bn-1588 4.68 max; smallNext 0.794 < 0.79375 false","known":false,"summary":"Rest finishing with the starter 1/4in -> 1/16in balls slots the edge band the 1/4in ball left; the strict small-bit test misses by 0.25 um"},
  {"id":"N2-P2-3","severity":"P2","area":"relief-and-3d","file":"src/ui/laser/cnc-compiled-depth-warnings.ts","line":120,"anchor":"warning's own workholding text; twin ADR-572 Amd 4 (0.1 mm cut free, 1 mm thin); twin J1-P2-1","evidence":"REPRO n2-bottom.ts: depth 6.349/6.34/6.30 in 6.35, 11.95 in 12, 5.95 in 6 and a raised plate on a 6.30 floor: floor 0.001-0.05 mm, no warning; 6.35/6.35 and 6.36/6.35 warn","known":"mentioned in passing by X6 refuter (T4), not raised or fixed","summary":"A relief floor a hair above the stock bottom gets no warning; only exact equality or a deeper cut warns"},
  {"id":"N2-P3-1","severity":"P3","area":"relief-and-3d","file":"src/core/cnc/compile-cnc-relief-rest.ts","line":105,"anchor":"twin finishing default 0.025 (relief-finishing.ts:56)","evidence":"REPRO n2-restcov.ts: bumps 16 mm default rest leaves >0.05 above a plain 1/16 finish on 12,141/57,600 interior cells (worst 0.314); rest scallop 0.025 -> 0 cells; groove 12 mm 2,082 -> 0","known":false,"summary":"Rest scallop defaults to 0.05 while the finish it refines defaults to 0.025"}
]
```

## Refuter (2026-11-13)

**Tree and harness.** Same read-only export `j38-main` (`origin/main` @ `9a0b1a80b`). `git diff --stat 9a0b1a80b origin/main` (now `3293fd15d`) over `src/core/relief`, `src/core/cnc` and `src/ui/laser` is empty, so the findings stand on current main. Own scripts are in `zz-n2r\`. Run them with `node --no-experimental-webstorage --import ./register.mjs <file>`. The auditor's `n2-scene.ts` and `n2-narrow.ts` were read for API shape only; nothing imports `n2-sim`, `n2-oracle` or any auditor script.
- **Own builder** (`r-build.ts`): analytic depth functions → 16-bit `testReliefHeightfield` → `relief` object; `createProject` / `createLayer`; `emitGcode` + `prepareOutput` + `detectMachineJobWarnings(prepared.project, …, prepared)`; plans from `job.cncCompilation.reliefPlans`.
- **Own surfaces** (none of the auditor's), each with its floor running to the relief edge:
  - a 40° square pyramid (24 × 24, 5 deep);
  - an elliptical dome on a floor (22 × 18, 4 deep);
  - a raised 12 × 6 bar on a 3 mm floor ("plaque");
  - a two-period sinusoid ("bump", 16 × 16);
  - an island map (bar + raised ring) for the stock bottom.
- **Own stock model, a different method** (`r-sim.ts`). It is a sampled Z-buffer, not an exact per-move sweep.
  - Cells are 0.04 mm. Every move is sampled at ≤ 0.8 cell along XY and ≤ 0.02 mm in Z.
  - At each sample the tool kernel is stamped: flat, ball, V, engraver (flat + cone), or tapered ball (tangent ball and flank). All are written from the definitions, not from the CAM.
- **Own load measure, a different definition.** Each cell remembers its height before the current **row** (feed moves with no rapid, no Z-only move and no XY turn over 60°). When the row ends:
  - **Under the centre** is what the row removed at the tool-centre cell.
  - **Cross-section** is ∫ across the tool width, on the perpendicular through the sample, of what the row removed (mm²).
  - The cross-section is compared with **slot@dpp**: a full-width slot one Depth per pass deep with the same bit. That is 1.48 mm² for the 1 mm-tip tapered ball, 0.83 for the 0.5 mm tip, 1.05 for the engraver, 2.11 for the 1/16" ball and 1.39 for a 1 mm ball.
  - **Calibration:** the stepped 1 mm ball and 1/16" ball on the pyramid read exactly **1.500** under the centre (= Depth per pass).
  - **Caveat:** on steep 3D descents the row metric can overstate a single maximum, because a later, deeper sample in the same row lowers an earlier centre cell. I therefore quote the longest stretch at constant Z, which is robust, and use maxima only where a dump confirms them (`r-dump.ts`).
- **Not used:** Vitest, pnpm, a browser, hardware, the GRBL simulator. Node heap ≤ 900 MB, with 2.5 GB free.

### Verdicts

| Finding | Verdict | Severity | Evidence (own) |
| --- | --- | --- | --- |
| N2-P2-1 | **CONFIRMED**, extended (a 0.5 mm-tip tapered ball; it still happens when levels are planned) | P2 | `r-p21.ts` → `out/p21.txt`, `r-dump.ts`, `r-area.ts`; READ `compile-cnc-relief.ts:291-297`, `relief-roughing-reach.ts:77-93` |
| N2-P2-2 | **CONFIRMED, cause sharpened:** an exact tie, not 0.25 µm of rounding | P2 (P1 considered) | `r-p22.ts` → `out/p22.txt`; READ `compile-cnc-relief-rest-step-down.ts:21,46,50-56`, `cnc-tool-starters.ts:63-67` |
| N2-P2-3 | **CONFIRMED** | P2 | `r-p23.ts` → `out/p23.txt`; READ `cnc-compiled-depth-warnings.ts:111-133` |
| N2-P3-1 | **CONFIRMED** (at defaults, rest equals a plain 1/16" finish at 0.05 scallop) | P3 | `r-p31.ts` → `out/p31.txt`; READ `compile-cnc-relief-rest.ts:105`, `ReliefAdvancedCncControls.tsx:87`, `CncLayerToolFields.tsx:59` |
| **N2r-P2-1 (new)** | A small ball slots the allowance strip along an **interior** wall parallel to the rows | P2 | `r-wall.ts` → `out/wall*.txt`; `out/p21.txt` (plaque) |

**N2-P2-1: CONFIRMED P2.** Setup: 1/8" end-mill roughing (default), Depth per pass 1.5, allowance 0.5, raster X. Each cell gives the longest run with more than 1.55 mm under the centre, the largest under-centre value, and the largest cross-section against slot@dpp:

| Surface | 1 mm ball (twin) | 1/16" ball | Tapered, 1 mm tip, 10° | Tapered, 0.5 mm tip, 7.5° | Engraver 30°, 0.3 flat | `vb-60-3175` |
| --- | --- | --- | --- | --- | --- | --- |
| pyramid | 0 / **1.50** / 1.04× (3 levels, note) | 0 / **1.50** (3 levels) | **23.65 mm / 2.79 / 2.9×**, no level, no note | **23.80 / 3.39 / 2.7×** | 13.34 / 4.75 / 5.1× | 13.47 / 3.87 / 6.1× |
| ellipse dome | 1.85 / 1.62 (2 levels) | 0.84 (2 levels) | **6.63 / 4.00 / 3.3×, with 2 levels and the note** | 7.67 / 4.00 / 3.5× | 4.04 / 4.00 / 4.5× | 2.70 / 3.13 / 3.2× |
| plaque | (see N2r-P2-1) | 0.51 | 23.65 / 2.74 / 1.7× | 23.80 / 2.99 / 2.3× | 12.37 / 3.00 / 3.1× | 0.59 / 2.35 |

- **The edge row itself** (`r-dump.ts` on `p21-pyramid-r-tb1.nc`, lines 281-326):
  - Y359.336, 0.66 mm from the edge, X40.14 → 63.77 at Z−2.335, F1000.
  - Under the centre: mean **2.30**, max 2.31. Cross-section: mean 1.82 mm², max 2.47 mm².
  - At the row ends (descents to Z−5) it reaches 2.79 under the centre and 4.31 mm².
  - This matches the auditor's 22.1 mm / Z−2.335 / up to 2.82, from an independent model on independent geometry.
- **Two extensions:**
  - **A 0.5 mm-tip tapered ball** (a common detail size) is worse: 23.8 mm at up to 3.4 mm under the centre (6.8 × its tip), 2.7 × its slot@dpp.
  - **On the ellipse the plan does step down** ("roughing missed 50 mm², 2 levels") and the note fires. But the note names "the 3.175 mm finishing bit", and the tapered ball still runs 6.6 mm with up to 4.0 mm under the centre. The levels follow the missed region planned for the nominal diameter (`minWidthMm` / `nextToolRadiusMm` = 1.5875). The opening shrinks that region away from the band the tip actually rides in.
- **Severity: P2 stands, not P1.** The numbers below come from the repo's own guide (`feeds-calculator.ts:45-61`): chip load 0.02–0.03 mm/tooth for bits ≤ 1.5 mm and 0.04–0.06 for bits ≤ 3.175 mm; Depth per pass 0.4–0.5 × D.
  - **Feed.** F1000 at 12000 rpm on 2 flutes is 0.042 mm/tooth, 1.4–2 × the chart for a 1 mm cutter. The app already says "uses the generic starter feeds" for this layer.
  - **Depth at the tip.** 2.3–2.8 mm is 4.6–7 × the guide's 0.4–0.5 mm for a 1 mm tip. 3.4 mm on a 0.5 mm tip is about 14 ×.
  - **Cross-section.** It is only 1.2–1.7 × (along the 23 mm run) to 2.9 × (at the row ends) the 1.5 mm pass the app already plans for the same bit. The tapered body is 1.32 mm across at 2.3 mm above the tip and 1.41 mm at 2.8 mm (`r-area.ts`), so the load sits on a widening core, not on a 1 mm neck.
  - **Engraver and V-bit.** They take 3–6 × their per-pass section, but a full-depth single pass of a 3.175 mm V or engraver is ordinary V-carve practice.
  - **Geometry.** There is no gouge and no wrong depth: my robust gouge is 0 on every run (`out/clean.txt`).
  - **Conclusion.** Breakage is plausible for the 0.5 mm tip at these feeds, not likely for the 1 mm tip. This is the cutter-load class that meta v1 M6 keeps at P2 (X6-P2-2 at 3 × D, X6-P2-3 and W6-P2-2 are all P2). Raising it would need M6 overturned.
- **Fix direction:** the auditor's. In addition, plan the levels from the tip radius (or the radius at one Depth per pass). The note should name the bit by kind and tip, not "the 3.175 mm finishing bit".

**N2-P2-2: CONFIRMED P2. The cause is an exact tie, not rounding.**
- **The tie.**
  - `cnc-tool-starters.ts:63-67` stores the starter 1/16" ball as 1.588 mm (radius 0.794).
  - The rest grid is `finishing.diameterMm / 8` (`compile-cnc-relief-rest-step-down.ts:21,46`), so 6.35 / 8 = 0.79375 mm.
  - The test is `smallNext = nextRadius < stripMm` with `allowanceMm: 0` (`:51-56` → `relief-roughing-reach.ts:79-81`).
  - The **exact** 1/16" radius, 1/32" = 0.79375 mm, also equals 1/4" ÷ 8. So the true bit ties the threshold, and the strict `<` makes it "large".
  - Any rest ball a quarter of the finishing ball's diameter sits on this tie: 1/16" after 1/4", 1/32" after 1/8", 1/8" after 1/2".
- **Own repro** (`out/p22.txt`): em-6350 → bn-6350 → rest, Depth per pass 1.5, ellipse dome with its floor to the edge.

  | Rest bit | Longest run with more than 1.55 under the centre | Max | Cross-section vs slot@dpp | Plan | Rest note |
  | --- | --- | --- | --- | --- | --- |
  | `bn-1588` (starter, 1.588 mm) | **8.70 mm at Z−4, F1000** | 3.76 | 5.31 vs 2.11 mm² (2.5 ×) | fallback, no missed area, no levels | none |
  | exact 1/16" (1.5875 mm) | **8.70 mm at Z−4, F1000** | 3.76 | 2.5 × | same | none |
  | 1.587 mm (0.5 µm smaller) | 0.22 mm | — | 1.03 × | **66 mm² missed, 2 levels** | "The 1.587 mm rest bit cuts it first in 2 step-down levels" |
  | `bn-3175` (1/8") | 7.32 mm at Z−4 | 3.06 | 2.0 × | none | none |

- **The rule is wider than the tie.** Any rest bit with a radius of at least the finishing bit's diameter / 8 is assumed to side-mill the band the 1/4" ball left. That is why a 1/8" ball takes 3.06 mm (2.0 × Depth per pass) for 7.3 mm.
- **Second contributor, KNOWN.** With Depth per pass 0.5 the 1/16" ball does get levels (55 mm², 6 levels). Even so, 4.8 mm still runs at Z−4 with more than 0.55 mm under the centre, and 2.8 mm of it with more than twice Depth per pass. The rest threshold carries one rest-grid cell of slack, 0.79 mm. That is X6-P3-1, magnified because the grid is the finishing bit's diameter / 8.
- **Severity: P2, P1 considered.**
  - **For P1:** a 1/16" ball 3.76 mm deep (2.4 × D) at 0.042 mm/tooth is 4.7–6.3 × the repo's own depth guide (0.6–0.8 mm). It is a classic snap case, and the three starter bits reach it with no note.
  - **For P2:** X6-P2-2 (the same bit, 4.72 mm deep, 3 × D, 18 mm long) was confirmed at P2 under meta v1 M6 by its refuter. Nothing here is deeper or longer.
  - It stays **P2** for consistency. It is flagged to the coordinator as the strongest candidate in this area if M6 is ever revisited for small bits.
- **Fix direction:** the auditor's first option (in the rest stage, any rest bit smaller than the finishing ball counts as "small"). A tolerance alone would fix 1/16" but not the 1/8" row.

**N2-P2-3: CONFIRMED P2.** Setup: an island map (a raised bar and a raised ring on a floor that runs to the edge), `bn-3175` finish. The deepest Z is from my own parser (`out/p23.txt`).

| Depth / stock | Floor left | Stock-bottom or workholding warning |
| --- | --- | --- |
| 6.35 / 6.35 | 0.000 | "reaches the configured stock bottom … confirm workholding" |
| 6.349, 6.345, 6.30, 6.25, 6.20 / 6.35 | 0.001 / 0.005 / 0.050 / 0.100 / 0.150 | **none** |
| 17.9 / 18, 2.95 / 3, 12.65 / 12.7 | 0.10 / 0.05 / 0.05 | **none** |
| 6.30 / 6.35, `em-3175` finish | 0.050 | none |
| 6.30 / 6.35, roughing only | 0.550 | none (correct) |

- READ `cnc-compiled-depth-warnings.ts:119-120`: only equality at output precision, or a deeper cut, warns.
- **Kept at P2, not P1.**
  - The depth is the operator's and is emitted exactly.
  - A 0.05 mm skin under raised islands is within ordinary sheet and spoilboard tolerance. The X6 refuter put the "effectively free" band at ≤ 0.2 mm, so the islands can break free under the bit.
  - But no app text claims they are held, since relief paths carry no tabs. That differs from F3-P1-1 / X6-P1-1, where Job Review listed tabs.
  - The harm is a missing advisory beside its exact-match twin: the same class as J1-P2-1, which is P2 and was confirmed by the N1 refuter.
- **Fix direction:** the auditor's, extended to cover floors of 0.1–0.2 mm (the 6.25 and 6.20 rows are silent too).

**N2-P3-1: CONFIRMED P3.**
- **Setup:** bump 16 × 16 (two sine periods, with troughs tighter than the 1/4" ball); em-6350 → bn-6350 → `bn-1588` rest (`out/p31.txt`).
- **Rows:** at defaults the rest plan uses 0.555 mm rows (scallop 0.05), against 0.395 mm for a plain 1/16" finish (scallop 0.025).
- **Result:** the rest program's final stock is cell-for-cell the same as a plain 1/16" finish at scallop 0.05. Compared with a plain 1/16" finish at the default 0.025:
  - rest at defaults leaves more than 0.05 mm extra on 21,144 / 76,176 interior cells (27.8 %), worst **0.56 mm**;
  - a plain 1/16" finish at scallop 0.05 gives the same: 27.9 %, worst 0.56;
  - rest at scallop 0.025 gives **0 cells**.
- The auditor's 21 % / 0.31 mm is the same effect on a different surface.
- It is a visible default (`ReliefAdvancedCncControls.tsx:87` shows 0.05 for rest; `CncLayerToolFields.tsx:59` shows 0.025 for the finish), so it stays P3.

### Challenges to "Verified clean"

All runs are mine (`r-clean.ts` → `out/clean.txt`, `out/clean-rough-only.txt`), measured on my Z-buffer against the analytic surface:

| Program | Gouge vertical / robust | Deepest vs depth | Cells cut outside the footprint | Plunges off F300 | Rapid removal | ETA ÷ (feed-only + dwell) |
| --- | --- | --- | --- | --- | --- | --- |
| ellipse `bn-3175` | 0.005 / 0 | −4.000 / 4 | 0 | 0 / 75 | 0 | 1.27 |
| pyramid `bn-3175` raster + waterline | 0.018 / 0 | −5.000 / 5 | 0 | 0 / 71 | 0 | 1.10 |
| plaque `em-1588` | 0.76 (wall cells) / 0 | −3.000 / 3 | 0 | 0 / 32 | 0 | 1.23 |
| bump `bn-1588` raster Y | 0.004 / 0 | −3.349 (troughs tighter than the ball) | 0 | 0 / 65 | 0 | 1.23 |
| bump rest (1/4" → 1/16") | 0.004 / 0 | −3.360 | 0 | 0 / 7 | 0 | 1.23 |
| ellipse tapered ball + 10° ramp | 0.045 / 0 | −4.000 | 0 | 0 / 129 | 0 | 1.20 |
| ellipse, roughing only | 0 / 0 | −3.500 (= −4 + 0.5) | 0 | 0 / 12 | 0 | 1.54 |
| pyramid, roughing only, allowance 0.8 | 0 / 0 | −4.200 (= −5 + 0.8) | 0 | 0 / 9 | 0 | 1.30 |

- **Roughing 3D allowance:** held. I measured the distance from every cut stock-top cell to the sampled target surface. The minimum is **0.500** at allowance 0.5 and **0.800** at allowance 0.8.
- **Not re-run:** scallop on flats, two-sided registration after stock edits, and the projection X6 fixes (see Not verified). The flats claim is indirectly consistent: the stepped 1 mm and 1/16" balls read exactly one Depth per pass.
- **Wording caveat on the Headline:** "all four are about bit load or warnings" holds. But N2-P2-1's dome row and my ellipse show that a **planned and announced** step-down can still leave the narrowing bit's edge row overloaded. For these bits, the note does not reliably mean the load is handled.

### New findings

#### N2r-P2-1 — A small finishing ball slots the allowance strip along an interior wall parallel to the rows; the X6-P2-3 fix covers only the map edge

- **Where:** `src/core/relief/relief-roughing-reach.ts:82-93`.
  - With a small next bit, the envelope shrinks to that bit's radius, so the strip beside a wall becomes raw "missed".
  - `opened()` then erodes it with a disk of `round(minWidthMm / 2 / cell)` ≥ 1 cell.
  - Only the **map edge** survives that, through `edgeCells` (`:191-197`). A 1–2-cell strip beside an island's wall is opened away, so no level is planned there.
  - This cause is READ (likely); the behaviour itself is REPRO.
- **Anchor:**
  - The module's own header (`:63-68`): "A smaller bit rides with its centre in the strip".
  - ADR-421 Amd 3 Context ("the strip within the allowance plus one cell of a wall, or of the relief's edge") and Decision 2.
  - The Job Review note the same program prints: "cuts it first in 1 step-down level of one depth per pass".
  - Twin: the same 1 mm ball at the map edge is stepped (1.50 under the centre on the pyramid).
- **Evidence:** REPRO (`r-wall.ts` → `out/wall.txt`, `out/wall-wl.txt`, `out/wall-a02.txt`, `out/wall-em.txt`; `out/p21.txt`, plaque). A 12 × 6 bar raised to the stock top on a 3 mm floor; default em-3175 roughing, Depth per pass 1.5, raster X:

  | Finishing bit / variant | Run along the long wall with more than 1.55 under the centre | Max under the centre | Plan / note |
  | --- | --- | --- | --- |
  | 1 mm ball, bar at 4 phases (offsets 0 / 0.1 / 0.2 / 0.3 mm) | **9.97 mm at Z−3.000, F1000** in every phase (row 0.53–0.74 mm from the wall) | 2.83–3.00 | 50 mm² missed, 1 level; the note says "1 step-down level of one depth per pass" |
  | 1 mm ball, raster + waterline | 10.0 mm at Z−3 | 2.81 | same |
  | 1 mm ball, allowance 0.2 | 9.97 mm at Z−3 | 3.00 | 19 mm², 1 level |
  | `bn-1588`, 2 mm ball, `em-1000`, `em-1588` | 0 | ≤ 0.53 | levels; held |

  - **G-code** (`out/p21-plaque-r-bn1.nc:4799-4800`): `X40.507 Y347.471 Z-3.000` → `X63.458 Y347.471 Z-3.000 F1000`.
  - The only Z−1.5 levels on that row are at X40.7–41.5 and X62.5–63.1 (`:1071-1084`), near the map edges. There are none along the wall (X46–58).
  - My dump of that row: 2.99 mean / 3.00 max under the centre. The cross-section is 2.03 mm², 1.46 × the 1 mm ball's slot@dpp of 1.39.
- **Scenario:** raised lettering or a raised border on a depth-map plaque, detailed with a 1 mm ball. The row beside each horizontal stroke slots the full letter height at F1000. That is 3 mm: 3 × D, and 2 × Depth per pass. Meanwhile Job Review says the bit steps down one Depth per pass at a time.
- **Severity: P2.**
  - It is the X6-P2-3 cutter-load class (meta v1 M6). There is no gouge (robust 0) and no wrong depth, but the note promises a load the program does not keep.
  - The 1 mm ball is user-added. The starter 1/16" ball and the starter `em-1000` / `em-1588` were not caught in four phases.
  - Narrowing bits are hit too: the plaque engraver run, 12.4 mm at Z−3, falls inside N2-P2-1.
- **Announced?** No. ADR-421 Amd 3's Consequences claim only the edge band.
- **Novelty:** new.
  - X6-P2-3 and its fix tests measure the map edge only.
  - The auditor's walls are perpendicular to the rows (`steps`) or the walls of recesses (`slots`). The 1.07 mm `slots-bn16` stretch was read as corners.
  - `docs/audits` has no wall case with a ball under 1.5 mm.
- **Fix direction:**
  - Keep the strip beside walls through the opening, the way `edgeCells` keeps the map edge. That is, count cells within `nextRadius` of a cell whose envelope is the wall's top as "in the mask" for erosion.
  - Or skip the opening for raw cells whose stock stands more than one Depth per pass above the target under a small bit.
  - Add a raised-island case with a 1 mm ball to `prepare-relief-x6-followups.test.ts`.

### Probes with no gap (new-gap search)

- **Steep walls, ball against flat finishing:** clean on the plaque's vertical walls with `em-1588` (robust gouge 0, cut to −3.000) and on the pyramid's 40° faces with `bn-3175` waterline. The end mills `em-1000` / `em-1588` did not slot the interior-wall strip: their rows fall outside it.
- **Relief plus a cut-out profile (READ only):** `compile-cnc-job.ts:6-10,203-206` orders every clearing group, relief included, before any profile group. A through-cut with tabs therefore cannot run before the relief inside it. The laser-only `cut-before-engraving.ts` skips CNC groups, which CNC does not need. Not run.
- **Relief plus tabs:** relief paths carry no tabs, and the exact-bottom warning says so. Covered under N2-P2-3.
- **Origin at the stock bottom:** not applicable. `cnc-machining-setup.ts:23,33` fixes `zDatum: 'stock-top'`.
- **Reach and holder clearance:** KNOWN and disclosed, not raised.
  - `cnc-program-reach.ts:28-36` returns nothing unless fixtures exist or a job tool records reach data, and no starter bit does.
  - The relief kernels ignore `shankDiameterMm`. That is documented as "metadata only; its transition is not modeled" (`CncBitPreviewToast.tsx:226-232`; ADR-572 Amd 1 line 29; ADR-412 and its Amd 2).
- **Rest beside an interior wall:** on the plaque, rest takes up to 2.3 mm along the bar for 12.4 mm (`p22-plaque-*`), even with a "small" 1.587 mm rest bit. That is within the threshold slack (1.5 + 0.79), so it is X6-P3-1, not new.

### Not verified

- **Not re-run:** scallop on flats, two-sided registration after stock edits, and the projection X6 fixes. I relied on the auditor's evidence; my flats agree indirectly.
- **Physical load and breakage:** inferred from the removed cross-section and the repo's chip-load and depth guide, not from measured force. No vendor data was fetched (no live services).
- **A starter 1/16" ball in the interior-wall strip:** not ruled out. Four phases 0.1 mm apart did not catch it, but a strip of allowance + one cell (0.897 mm) would allow it.
- **Job Review:** the dialog was not rendered; warnings were read from `detectMachineJobWarnings`.
- **Vitest:** none run.

### Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-n2r\`. Run each with `node --no-experimental-webstorage --import ./register.mjs <file> [args]`. Programs are written to `out\<case>.nc`. Nothing in the repo or in `j38-main` was touched.

| File | Covers | Output |
| --- | --- | --- |
| `r-build.ts` | Own relief and project builder; emit, prepare, warnings, plans | — |
| `r-sim.ts` | Own parser; sampled Z-buffer with own cutter profiles; per-row removal (under the centre, cross-section); slot@dpp | — |
| `r-surf.ts` | Pyramid, ellipse dome, plaque | — |
| `r-p21.ts [surface] [bits]` | N2-P2-1 | `out/p21.txt` |
| `r-dump.ts <nc> [op] [lim] [dpp]` | Longest over-limit stretches of a saved program | stdout |
| `r-area.ts` | Slot cross-sections and widths per bit | stdout |
| `r-p22.ts` | N2-P2-2: the tie, a 1/8" rest bit, Depth per pass 0.5 | `out/p22.txt` |
| `r-p23.ts` | N2-P2-3 | `out/p23.txt` |
| `r-p31.ts` | N2-P3-1 | `out/p31.txt` |
| `r-wall.ts [tag] [bits] [offsets] [json]` | N2r-P2-1 | `out/wall*.txt` |
| `r-clean.ts [filter]` | Spot checks of "Verified clean" | `out/clean*.txt` |

```json
{
  "area": "N2",
  "role": "refuter",
  "tree": "9a0b1a80b (no relief/cnc/laser diff to origin/main 3293fd15d)",
  "verdicts": [
    {"id": "N2-P2-1", "verdict": "CONFIRMED", "severity": "P2", "evidence": "REPRO own Z-buffer: pyramid, tapered 1 mm tip: 23.65 mm at Z-2.335 F1000, 2.30 mean / 2.79 max under centre, 1.2-2.9x slot@dpp, no level or note; 0.5 mm tip: 23.8 mm / 3.39; ellipse: 2 levels and the note, yet 6.6 mm at up to 4.0; 1 mm and 1/16in balls: 1.50 (stepped)"},
    {"id": "N2-P2-2", "verdict": "CONFIRMED", "severity": "P2", "considered": "P1 (kept for M6 consistency with X6-P2-2)", "evidence": "REPRO: exact 1/16in (1.5875) behaves as the starter 1.588: 8.7 mm at Z-4 F1000, 3.76 under centre, 2.5x slot, no levels or note; 1.587: 66 mm2, 2 levels; 1/8in rest ball: 7.3 mm / 3.06; radius 0.79375 == 6.35/8 is an exact tie under strict <"},
    {"id": "N2-P2-3", "verdict": "CONFIRMED", "severity": "P2", "evidence": "REPRO island map: floors of 0.001-0.15 mm (6.35, 18, 3 and 12.7 mm stock) give no warning; a floor of exactly 0 warns"},
    {"id": "N2-P3-1", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO bump: rest at defaults == a plain 1/16in finish at 0.05 scallop: 27.8 % of cells > 0.05 above a plain 0.025 finish, worst 0.56; rest scallop 0.025 -> 0"}
  ],
  "new": [
    {"id": "N2r-P2-1", "severity": "P2", "area": "relief-and-3d", "file": "src/core/relief/relief-roughing-reach.ts", "line": 88, "anchor": "module header :63-68 and ADR-421 Amd 3 Context/D2 (the strip beside a wall); twin: the same bit is stepped at the map edge; the Job Review note claims one-dpp levels", "evidence": "REPRO r-wall.ts: raised bar on a 3 mm floor, 1 mm ball: 9.97 mm at Z-3.000 F1000, 2.83-3.00 under centre, in 4 phases, with waterline and with allowance 0.2; levels only near the map edges; 1/16in ball, 2 mm ball, em-1000 and em-1588 clean", "known": false, "summary": "A finishing ball under about 1.5 mm slots the allowance strip along an interior wall parallel to the rows; the X6-P2-3 fix keeps only the map-edge strip through the opening"}
  ],
  "counts": {"raised": 5, "refuted": 0, "P1": 0, "P2": 4, "P3": 1, "known": 5}
}
```

Refuter counts: raised 5, refuted 0, P1 0, P2 4, P3 1, known 5
