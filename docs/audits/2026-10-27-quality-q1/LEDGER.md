# Quality audit Q1 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md), with the quality severity and references in [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| Q1 | Raster tone | 09f7c0087 (refuter 99f570ead) | [Q1-raster-tone.md](Q1-raster-tone.md) | 3 | 0 | 2 (P2-1 raised) | 0 | 1 | 4 |

## Scorecards (headline metrics per area)

| Area | Metric | KerfDesk | Reference | Verdict |
|---|---|---|---|---|
| Q1 | Brightness → S on a 16-step wedge, `$30` = 1000 / 255 (GRBL, grblHAL, FluidNC) | within 0.033% / 0.196% of full scale | the documented formula (ADR-390, ADR-567) | pass |
| Q1 | Canvas Preview and Photo engraving preview against the emitted S (Grayscale 60/10; Jarvis + gamma) | 0 of 25,600 pixels differ | pixel-exact | pass |
| Q1 | Dose under M4, 8-bit GRBL look-ahead, face at 6000 mm/min | 0.99× | 1.00× (GRBL `laser_mode.md`: M4 keeps energy per length) | pass |
| Q1 | Dose under M3 (GRBL Compatible), same job | face 1.79×, 50% dither row 2.61× | 1.00× | **fails** (Q1-P2-1, P1) |
| Q1 | Grayscale face energy with Dot Width Correction 0.02 / 0.04 mm, against 0 | 0.64 / 0.28 | about 1.0 (trims the ends of the burned line only) | **fails** (Q1-P1-1) |
| Q1 | Dose lost to acceleration and overscan under M4 | at most 5.6%, over the first 0.2 mm of a row | — | pass |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| Q1-P1-1 | Q1 | **Dot Width Correction trims every Grayscale power change**, not only the ends of the burned line. A dither emits only full power or 0, so the correction meets only beam on/off edges. Grayscale (and Pass-through) gives neighbouring pixels different non-zero S, so each pixel whose S differs from its neighbour burns only its middle, with an S0 gap between pixels. A Grayscale photo at Dot Width 0.02 / 0.04 mm (10 lines/mm) burns 0.64 / 0.28 of the energy the Preview, the Photo engraving preview and Job Review show. The only advisory fires when a one-pixel run vanishes, and a tone-calibration wedge (flat patches, one run per row) loses 0.4%, so calibrating cannot see it. LightBurn 2.0 says the correction works "by shortening the length of engraved scan lines" | **READ**: `rasterPixelRuns` splits a row at every change of exact S (`raster-power-runs.ts:31-44`); `rasterSweepRunsForPixelRun` shortens each S > 0 run at both ends, with S0 between (`:46-70`); `dotWidthWarning` returns null unless the remaining run ≤ the controller grid (`scan-quality-warnings.ts:96-111`). Auditor + refuter REPRO (gradient 0.600 / 0.200, face 0.638 / 0.276, Jarvis 0.785 / 0.570) | fix card proposed |
| Q1-P2-1 (P1) | Q1 | **GRBL Compatible burns images with M3, with no advisory.** On 8-bit GRBL the 15-block look-ahead plans the newest block to stop, so a dithered row of short blocks runs at about 37 mm/s when 100 mm/s is asked for (`$120` = 500 mm/s², KerfDesk's profile default). Constant power then gives a photo 1.79× its intended dose, and a 50% dither row 2.61×; M4 keeps 0.99×. The Preview shows the intended tone. M3 itself is deliberate: ADR-257 keeps this dialect as the fallback for GRBL 1.1e and older, which have no M4. The defect is the missing advice. Size depends on the real acceleration (1.002× at 2500 mm/s²). Raised from P2: a burn darker than the Preview, with no warning | **READ**: `grbl-compatible` sets `rasterPowerMode: 'constant'` (`gcode-dialects.ts:107-123`); `git grep grbl-compatible` in `src/ui`, `src/core/preflight` and `src/core/job` finds tests only, so no advisory names it. **SOURCE**: gnea/grbl `bfb67f0` `laser_mode.md`, `planner.h`, `planner.c`. Auditor + refuter REPRO (independent planner models on the emitted bytes) | fix card proposed |
