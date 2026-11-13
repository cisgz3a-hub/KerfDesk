# N3 — Adaptive and pocket (CNC audit v3, `adaptive-and-pocket`)

**Question.** Does every pocket program KerfDesk emits clear what it promises when it is swept through a stock model? The checks cover:
- no kept material cut (walls, islands, outside the pocket) and no cut below the floor;
- no reachable stock left inside the pocket (what the bit could reach but did not);
- tool engagement against the setting: the adaptive "Radial engagement" limit, full-width slotting, plunges into uncut stock at the cutting feed;
- entries: the adaptive helix, the manual helical entry (diameter against the bit, angle), ramps, plunges, and rapids through stock;
- rest machining cutting what the larger bit left, and what it leaves;
- island order and partitions, rim arcs, the cleanup order (ADR-154 Amd 3–4);
- the warnings Job Review gets against what the program actually does;
- ETA against my own move-time bound.

**Tree.** `origin/main` @ `9a0b1a80b` (read-only export `j38-main`).
- `git diff --stat 9a0b1a80b origin/main -- src/core/cnc` is empty (main is at `cf13dd4ab`; only tools-audit docs and non-CNC code moved).
- Adaptive/pocket commits since CNC v1 F2 (2026-10-23): the F2 fixes in #1421 (ADR-154 Amd 4: strips instead of crossing cut lines, cutting order, stranded-stock and early-finish refusals; ADR-153 Amd 1: rest core ring), ADR-154 Amd 5 (fallback shown before Save), the S8 performance work (`same-input-memo.ts`, verifier early refusal).

**Method.**
- **My own oracle** (`n3-sim.ts`). It shares no code with the CAM, the adaptive verifier (`adaptive-pocket-verifier.ts`, `adaptive-pocket-contact.ts`), N1's or N2's readers, or J1's oracle.
  - **G-code reader.** Modal G0/G1/G2/G3 (G17, I/J; arcs split into 0.05 mm chords, helices with linear Z), G90/G91, G20/G21, F. The tool and its diameter come from the emitter's `; cnc tool-id:` / `; cnc tool:` comments. A "pass" starts at every descent from Z ≥ 0 into the stock.
  - **2.5D stock.** A top-Z heightfield in machine coordinates, 0.05 mm cells (0.025 mm for the 1/8" and 1/16" bits), stock top Z0. Every move, rapids included, is swept exactly for a flat end mill: per cell, the reach interval of the segment (a quadratic) and the lowest Z on it (Z is linear, so at an end). V-bits are swept in half-cell sub-steps with the cone profile.
  - **Engagement.** Before each feed move is swept, the leading half of the rim is sampled every 1° at every 0.05 mm of the move, at radius R − one cell (so a rim tangent to an earlier wall is not contact). A rim point is engaged where the stock there stands more than 0.75 mm above the tool bottom (half the depth per pass; "deep") or 0.05 mm ("shallow"). The result is the largest contiguous contact angle θ. I compare θ with θL = acos(1 − L/R), the contact a straight side cut of radial depth L makes, where L is the adaptive "Radial engagement" or, for offset pockets, the stepover. I also report the side-cut equivalent ae = R(1 − cos θ). A slot is θ ≥ 170°.
  - **Calibration** (`n3-selftest.ts`, hand-written G-code, side cut after a slot, 0.05 mm cells): ae 0.16 / 0.3175 / 0.635 / 1.5 / 3.175 mm read 16° / 25° / 37° / 59° / 91° against 18.3° / 25.8° / 36.9° / 58.2° / 90° by geometry; a slot reads 181°; a rapid 0.5 mm into stock is caught.
  - **Region measures.** Even-odd inside test of the drawn loops. Kept cut: a cell outside the pocket (walls, islands) lowered by more than 0.002 mm and more than 0.03 mm from the boundary. Reach: an exact Euclidean distance transform; valid centres lie at least R + one cell from outside, and "reachable" is within R − one cell of a valid centre (conservative both ways). Uncut reachable: reachable cells standing more than 0.02 mm above the floor, grouped into 8-connected patches. Freed parts: material components standing more than 0.1 mm above the stock bottom that do not connect to the untouched stock round the field.
  - **Moves.** Rapids that remove stock; every Z-only feed plunge into stock with its feed and the share of the disk in stock; every descending lateral move (helix, ramp) with its slope and feed.
  - **ETA.** `estimateJobDuration(prepared.job, device, { gcode })` against my lower bound: feed-only time plus rapids at the device's max feed.
- **Entry points:** `emitGcode` (the Save path), `prepareOutput`, `detectMachineJobWarnings(prepared.project, null, null, prepared)` plus `detectMinFeatureWarnings` (Job Review's ADR-433 lines), the emit preflight issues and `job.cncCompilation.strategyFallbacks`. The app's own verifier verdict was read with `resolveAdaptivePocketOperation` (`n3-verifier.ts`) for comparison only.
- **Scenes** (design mm): 30 mm square, Ø30 circle, hexagon Ø40, right triangle with 30 mm legs, 5-point star, 40 mm L, 8 × 40 slot, a 0.2 mm-flattened five-lobed blob, 45 × 30 rectangle; 60 × 40 with one 10 mm island, 3 × 3 islands, an island 1 mm from the wall, two islands 4 mm apart, a round island, a ring "O" (Ø24/Ø10 and Ø36/Ø14), nested 60/36/18, two pockets on one layer, 80 × 60 with two offset islands (strip partition); a 40 mm square with a 5 mm arm; a pocket with an 8 mm arm.
- **Settings:** adaptive at 0.05 mm, 10 % (default), 20 %, 25 % and 50 %; offset at 40 / 85 / 110 / 150 %, lifted and stay-down; raster X at 40 / 100 / 110 / 150 %; plunge, ramp 5° and 30°, helix default (8 / 2 / 3°), 20 mm and 15°; depth 3 / 3.2 / 6 / 6.35 / 7 / 12 at 1.5–3 mm per pass; climb and conventional; legacy rest (6.35 → 3.175, 9.525 → 1.588) and stock-aware rest (tolerance 0.01); a pocket then an inside profile with a smaller bit; a 60° V-bit pocket; an undersize-bit replay (programs for 6.35 mm swept with a 6.30 mm cutter).
- **Bits:** `em-6350`, `em-3175`, `em-1588`, `em-9525`, `vb-60`.
- **Not used:** Vitest, pnpm, a browser, hardware, the GRBL simulator. Node stayed under 900 MB.

## Headline

**No kept material cut, no cut below the floor, no rapid into stock and no plunge off the plunge feed, in 96 emitted programs.** Offset, raster, adaptive, island-adaptive, helical, ramped and rest pockets left no reachable stock, apart from the cases below. ETA is 1.02–1.27× my lower bound, never under it.

**One P1 and two P3s are new.**
1. **N3-P1-1. A pocket cut to the stock bottom frees every island inside it, and Job Review says nothing.** Pockets have no tabs, and the through-cut warning is for profiles only. The island comes free during the last ring, which runs round it at F1000.

   | Pocket (stock 6.35 mm unless noted) | Depth | Freed (my bottom-slice flood fill) | Job Review |
   |---|---|---|---|
   | 60 × 40 with a 10 mm island: offset / adaptive / raster X / rest 6.35 → 3.175 | 6.35 | the 100 mm² island, in all four | **nothing** |
   | same, offset | 6.30 (0.05 mm skin) | the island (held by 0.05 mm) | **nothing** |
   | same, offset | 7 | the island | "0.65 mm past the bottom, into the spoilboard" only |
   | letter "O" (Ø24 / Ø10), 1/8" bit; and in 12 mm stock at 12 mm | = stock | the 78.5 mm² counter | **nothing** |
   | Twin: the same loops as **Inside profile**, tabs off | 6.35 | (the island and the strip) | "cuts through the stock … the part and any hole slugs come free on the final pass" |

2. **N3-P3-1. Island-adaptive cells meet with zero overlap.** Each cell's finishing ring stops exactly one radius short of the cut line (`Y331.825` and `Y338.175` either side of the seam at `Y335.000`). The seam is cleared only if the bit is exactly its nominal diameter. Offset rings overlap by 60 % of the bit.
3. **N3-P3-2. Raster pockets above 100 % stepover leave full-depth strips, and legacy rest assumes they were cut.** Offset pockets add core rings at the same stepover and leave nothing. Raster at 110 % leaves 32.9 mm² and at 150 % 100 mm², 3 mm tall. Legacy rest after a 150 % raster rough leaves the same 99.5 mm². The advisory only says the value is outside 10–85 % and to "check the resulting route density".

**The adaptive engagement promise is still not kept (KNOWN AC-6, re-measured).**
- At the default 10 % limit, clearing rings run at 59–76° of deep contact against the 36.9° a side cut at the limit makes. That is a side-cut equivalent of 1.6–2.4 mm against a 0.635 mm "Radial engagement".
- The verifier reads the same programs as 0.53–0.93 mm. It uses r(1 − cos(arc/2)) and a one-cell allowance (0.354 mm on the 1/4" bit). At 50 % it certifies full slots: 72 mm on the L, 21 mm on a 45 × 30 rectangle.
- ADR-154 Amd 3 records both and kept them, so this is not re-raised.

Other KNOWN items were re-observed, not re-raised:
- finishing rings unmeasured: 114° at 90° corners, 181° at 45° corners;
- F2-P3-1: the adaptive chain ignores Cut direction;
- AC-2: adaptive falls back to offset rings for the L, star, slot, blob, round island and "O", with the notice;
- JR-4 and F3-P3-4: helical entry on an island pocket, on a raster pocket, or in a 6–6.4 mm hole drops the layer, and the first message blames the bit width;
- V6-P3-2: stock-aware rest's "Adjust Rough first or disable it".

## Results

### Adaptive engagement (deep contact, at least 0.75 mm of axial stock; 2 levels at 1.5 mm unless noted)

"Rings" are the clearing chain after the helix. "Over θL" is the path length whose contact exceeds the limit's side-cut angle by more than 2°. "Verifier" is the app's own `maxSimulatedEngagementMm`.

| Pocket | Bit, limit (θL) | Rings: max contact / side-cut ae / length over θL | Slot ≥ 170° at F1000 | Finishing / cleanup ring | Verifier (ceiling) |
|---|---|---|---|---|---|
| 30 mm square | 6.35, 0.635 (36.9°) | 59° / 1.57 mm / 19.5 mm | 0 | 114° (corners, KNOWN) | 0.528 (0.989) |
| 30 mm square | 3.175, 0.3175 (36.9°) | 63° / 0.88 mm / 321 mm | 0 | 114° | 0.285 (0.542) |
| Ø30 circle | 6.35 / 3.175, default | 68° / 2.00 / 10.0 mm; 68° / 1.00 / 12.9 mm | 0 | none | 0.652 |
| hexagon Ø40 | 6.35, default | 68° / 2.00 / 8.9 mm | 0 | 73° | 0.613 |
| right triangle 30 mm | 6.35, default | (with ring) | **7.8 mm, 181°** at the 45° corners (`a-tri30-6350.nc:1051,1053`) | finishing ring, KNOWN | 0.565 |
| 30 mm square, depth 6 | 6.35, default | 59° / 1.57 / 38.9 mm (4 levels) | 0 | 114° | — |
| 30 mm square | 6.35, 1.27 (53.1°) | 93° / 3.34 / 31.7 mm | 0 | 114° | 1.10 |
| 30 mm square | 6.35, 3.175 (90°) | 150° / 5.88 / 24.9 mm | 0 | 114° | 2.426 |
| 40 mm L | 6.35, 3.175 | 181° | **72.3 mm** | 114° | **3.175 (saturated)** |
| 45 × 30 rectangle | 6.35, 3.175 | 181° | **21.4 mm** | 114° | — |
| 60 × 40 + 10 mm island (8 cells) | 6.35, default | 73° / 2.26 / 60.7 mm | seeds: 101 mm at **F300**, 181° (disclosed) | 114° at F1000, 1,183 mm (disclosed) | 0.928 |
| 80 × 60, two islands (strips, 7 cells) | 6.35, default | 75° / 2.37 / 55.2 mm | seeds 291 mm at F300 | 114° | — |
| nested 60 / 36 / 18 (9 cells); two pockets | 6.35, default | 66° / 1.90; 61° / 1.66 | 0 at F1000 (F2-P2-1 fix holds) | 114° | — |
| 15 mm square | 6.35, 0.05 (10.2°) | 1° | 0 | 114° | — |

- Every compiled adaptive program had 0 kept cut, 0 over-depth and 0 rapids into stock.
- The helix runs at 3° and F300, with a radius of 0.75 R or less, so it leaves no core.
- Each helix ends without a flat turn at depth, so the first move inward meets up to one turn's drop (0.78 mm on the 1/4" bit) of ramp floor. That is shallow contact only (176–178°), and is not raised.
- Fallbacks: L, star, slot, blob (default load), round island, "O", 3 × 3 islands, island near the wall, and the 1/8" island pocket all cut offset rings. Each was announced (`cnc-adaptive-clearing-invalid`).

### Offset, raster, entries (6.35 mm bit, θL = 78.5° at 40 %)

| Case | Uncut reachable | Plunges / descents | Max contact, slot length at F1000 | Note |
|---|---|---|---|---|
| square, plunge, stay-down / lifted | 0 | 2 / 10 plunges, all F300 | 181°, 4.7 mm (first ring) | expected full-width first ring |
| 10 mm island; islands 4 mm apart; island 1 mm from wall; 5 mm arm | 0 / 3.25 / 0 / 3.46 mm² | F300 | 181° first rings | 3.25 and 3.46 mm² are the mouths of the warned narrow areas (see Refuted) |
| star 1/8" | 0 | F300 | 181°, 72.6 mm | — |
| stepover 85 / 110 / 150 % | 0 / 0 / 0 | F300 | 181° | core rings hold |
| raster X 40 / 100 / 110 / 150 % | 0 / 0 / **32.9** / **100.1 mm²** | F300 | 181° | **N3-P3-2** |
| ramp 5° / 30° | 0 | descents at F1000 / F600 (Z rate ≤ 300) | 147° / 181° ramp | the ramp feed caps the Z rate at the plunge feed |
| helix default 8 / 2 / 3°, 1/4" and 1/8"; 20 mm; 15° | 0 | helix F300, 1.7° / 1.9° / 3.4° (angle is a maximum) | 169–181° rings | 8 mm on the 1/8" bit leaves a Ø4.8 core per level that the rings cut (no worse than the plunge entry's first-ring slot) |
| helix on an island pocket, a raster pocket, Ø6 / Ø6.4 holes | **layer empty** | — | — | KNOWN JR-4 / F3-P3-4 |
| depth 3.2 at 1.5 per pass, offset and adaptive | 0, floor −3.200 exact | — | — | — |
| 60° V-bit pocket, depth 2 | ribs (J1 refuted: shape of the bit) | — | — | not measured further |

### Rest machining

| Case | Rough bit leaves (mm²) | Rest bit: cut / air feed (mm) | Rest max contact | Final uncut |
|---|---|---|---|---|
| 40 mm square + 8 mm arm, 6.35 → 3.175 | 13.0 | 82 / 29 | 113° | 0 |
| same, stepover 85 % | 13.0 | 88 / 37 | 113° | 0 (F2-P2-2 fix holds) |
| same, stock-aware | 13.0 | 362 / 381 (wall re-trace, disclosed) | 114° | 0 |
| L 40, legacy / stock-aware / ramp 5° / raster rough | 10.8 | 70 / 24 … | 113–114° | 0 |
| star, 6.35 → 3.175 | 46.1 | 127 / 63 | 181° for 2.8 mm in the tips | 0 |
| 10 mm island; island 5 mm from wall; islands 4 mm apart | 8.6 / 63.0 / 72.6 | — | ≤ 114° | 0 |
| 30 mm square, 9.525 → 1.588 | 20.5 | 104 / 51 | 169° | 0 |
| raster rough at 150 %, legacy rest | **108.1** | 56 / 22 | — | **99.5 mm² (N3-P3-2)** |
| same, stock-aware | — | full-pocket fallback (stepover > 100 %), disclosed | — | 0 |
| Pocket 6.35 then Inside profile 3.175 (two layers) | 10.8 | — | 114° | 0 |

### ETA

`estimateJobDuration` is 1.019× (30 mm square, adaptive, 1/8") to 1.274× (raster 150 % rest) my lower bound. Typical is 1.03–1.15×. It is never under it.

## Findings

### N3-P1-1 — A pocket cut to the stock bottom frees every island inside it with no warning; pockets get no tabs and the through-cut warning covers profiles only

- **Where:**
  - `src/ui/laser/cnc-through-cut-tab-warnings.ts:145`: `throughCutWarning` returns null unless `isProfileCutType(settings.cutType)`.
  - `:111` warns a non-V-carve layer only when `depthMm > stockThicknessMm` (the spoilboard text), with nothing about islands.
  - `src/ui/laser/cnc-compiled-depth-warnings.ts:113-121` gives stock-bottom warnings to V-carve and relief only.
  - Tabs are scoped to profile cut types (ADR-258; `compile-cnc-layer-passes.ts:362` `contourMajorPasses` `wantsTabs = settings.tabsEnabled && isProfileCutType(...)`).
- **Anchor:**
  - Twin: an Inside profile of the same loops at the same depth warns "cuts through the stock … the part and any hole slugs come free on the final pass" (`cnc-through-cut-tab-warnings.ts:146-150`).
  - Contract: that file's header, "a profile layer whose cut depth reaches … the stock thickness … frees the part — and any interior hole slugs".
  - Precedent: N1 / J1 rate a part cut free with no warning as P1 (J1-P1-1, N1-P2-1→P1, N1-P2-2→P1). N2-P2-3 is the relief twin of the near-bottom skin.
- **Evidence:** REPRO (`n3-e.ts` → `out/e-run1.txt`, `out/e-*.nc/.json`; also `n3-c.ts`, `n3-d.ts`); READ. 60 × 40 mm pocket with a 10 × 10 mm island, 1/4" end mill, 2 mm per pass, 6.35 mm stock:
  - The bottom-slice flood fill finds the island (99.998 mm²) disconnected from the stock for offset, adaptive (island partitions), raster X and two-bit rest. It does the same at 6.30 mm (held by 0.05 mm) and at 7 mm.
  - The letter "O" (Ø24 / Ø10, 1/8") through 6.35 mm, and through 12 mm stock at 12 mm, frees the 78.5 mm² counter.
  - `detectMachineJobWarnings` + `detectMinFeatureWarnings` + preflight: empty in every case, except at 7 mm, which gets only "0.65 mm past the bottom, into the spoilboard".
  - The island is separated by the last ring of the program, which runs round it at full depth and F1000: `out/e-through-isl1-offset.nc:255-262` (`G1 Z-6.350 F300`, then `X51.825 … X68.175` round the island).
  - With no island (a plain square through), nothing comes free.
- **Scenario:** a maker pockets lettering, or a frame with a raised centre, "through" to make a stencil or a fretwork panel. That means Depth = stock thickness, or a hair under "to be safe". The counters of O, A, B, D, P, R, or the centre panel, come loose on the final ring beside the spinning bit, at the cutting feed. Job Review is silent. The same shapes on an Inside profile with tabs off would be warned.
- **Severity: P1.** It harms a job: a kept part is cut free with no tabs, and it can be thrown or caught by the bit. METHOD §3 has no reach clause, and a visible result in Preview is not a warning. This is the same harm, and the same rating, as N1's free-part findings. It holds for every pocket strategy.
- **Announced?** No. The Pocket card says "clear inside". No tooltip, Job Review line or preflight mentions islands or the stock bottom for pockets.
- **Novelty:** new. `grep` over `docs/audits`, `docs/decisions` and `DECISIONS.md` finds no through-pocket or freed-island item. F2 (v1) and J1 measured pockets above the stock bottom only.
- **Fix direction:**
  - Extend the through-cut advisory to pockets whose region has holes (islands): "Layer … cuts N islands free at the stock bottom; pockets have no holding tabs". Treat a floor of 0.1 mm or less as through (ADR-572 Amd 4's cut-free threshold).
  - Say it also when the depth is past the bottom.
  - Optionally leave an onion skin or tabs on island walls.

### N3-P3-1 — Island-adaptive cells meet with zero overlap: each cell's finishing ring stops exactly one radius short of the cut line

- **Where:** `src/core/cnc/adaptive-pocket-islands.ts:105-133` (`cellSequences`). The region is clipped to each cell rectangle, and `sequencesForComponent` insets each cell by exactly R (`adaptive-pocket-sequences.ts:47-51`). The only passes that reach a seam are the two cells' level-0 finishing rings.
- **Anchor:** Twin: offset rings overlap by (1 − stepover) · D (3.81 mm at the defaults). ADR-154 Amd 4 Decision 1 relies on cell corners lying on walls or islands, but says nothing about seam overlap.
- **Evidence:**
  - READ + REPRO (`out/ai-isl1-6350.nc`): either side of the seam at machine `Y335.000`, the cells' finishing rings run at `Y331.825` (`:819-823`) and `Y338.175` (`:3864-3867`). Both are exactly 3.175 from the seam, along the full 18.65 mm.
  - My grid shows a one-cell foil on the four seams (0.615 mm² each), which is resolution: it is zero thickness at nominal.
  - Replayed with a 6.30 mm cutter (`c-undersize-isl1-adaptive`), the foil is real: about 0.05 mm × 3 mm along each seam, 2.94 mm² of reachable stock. The offset twin (`c-undersize-isl1-offset`) leaves 0.
- **Scenario:** a re-sharpened or slightly undersize 1/4" bit (6.30 mm), or a deflecting one, leaves thin full-depth walls across an island pocket's floor where the cells meet.
- **Severity: P3.** It is structural robustness: at the nominal diameter nothing is left.
- **Announced?** No.
- **Novelty:** new. F2-P1-1 was the crossing pin; this is the seam.
- **Fix direction:** inset each cell by R − a small overlap (e.g. 0.1–0.2 mm) along cut lines only, or run the cleanup rings along the cut lines as well as the walls.

### N3-P3-2 — Raster pockets above 100 % stepover leave full-depth strips between rows, offset pockets do not, and legacy rest assumes the strips were cut

- **Where:**
  - `src/core/cnc/pocket-paths.ts:257-292` (`pocketRasterToolpaths`) has no counterpart of `remainingPocketCores` / `coreRing` (`:114-171`).
  - `rest-pocket.ts:135-152` (`remainingStock`) models the rough bit's ideal reach, not its routes.
  - The stepover field is unbounded (`CncLayerAdvancedFields.tsx:243-252`, `positiveOnly`; AUD-100-014).
- **Anchor:** Twin: the offset pocket at the same stepover (core rings, July 1.10). The rest-ladder core fix F2-P2-2 (P2) was the same class. The stock-aware rest refuses stepover over 100 % and falls back.
- **Evidence:** REPRO (`n3-c.ts`, `n3-d.ts`, `n3-f.ts`), 30 mm square, 1/4" bit, depth 3:

  | Stepover | Raster X uncut (3 mm tall) | Offset uncut |
  |---|---|---|
  | 100 % | 0 | — |
  | 110 % | 32.9 mm² (three 0.6 mm strips) | 0 |
  | 150 % | 100.1 mm² | 0 |

  Legacy rest (6.35 → 3.175) after a 150 % raster rough leaves the same 99.5 mm²: the rest bit cuts only the corners. The only advisory is "Stored Stepover … is 150 %, outside the 10–85 % recommended range … Check the resulting route density in Preview".
- **Severity: P3.** It needs a value outside the recommended range, and that value is flagged, although the flag does not say stock is left.
- **Announced?** Partly (the out-of-range advisory).
- **Novelty:** new as measured. v1 F2 listed "raster rows … above 100 %" under Not verified.
- **Fix direction:** add the core/remaining-strip pass to raster pockets, as offset does. Or make the advisory say rows further apart than the bit leave strips standing. Have legacy rest refuse a rough stepover over 100 %, as stock-aware rest does.

## Refuted / not raised

- **"Island adaptive leaves four 0.615 mm² full-depth pins."** These are one-cell foils on the cell seams, zero thickness at nominal (both rings exactly R from the seam). Folded into N3-P3-1.
- **"Offset pockets leave 3.3–3.5 mm² of reachable stock beside narrow features."** It is real geometry. The kerf offsets use Miter joins (`kerf-offset.ts:30`), so the ring does not bulge into the mouth of a 5 mm arm or a 4 mm gap the way a round centre region would (1.05 mm into the arm mouth, 0.6 mm into the gap). But Job Review already says that area "stays uncut" (`MINF: 1 area narrower than the 6.35 mm bit … narrowest 5 mm`). It is the same area. Not raised.
- **"The first lateral move after the adaptive helix meets 176–178° of contact."** That is the helix's ramp floor, at most one turn's drop (0.78 mm) deep. Deep contact (≥ 0.75 mm) there is 0. Not raised.
- **"The default 8 mm helix on the 1/8" bit leaves a Ø4.8 mm core per level."** True, and the rings then cut it. The core is cut at no more than the full-width first ring a plunge entry makes (169° against 181°). The helix angle and diameter are maxima and are honoured. Not raised.
- **"Ramp moves descend at the cutting feed."** The feed is capped so the Z rate does not exceed the plunge feed (5° → F1000, 87 mm/min down; 30° → F600, 300 mm/min down). Not raised.
- **"The adaptive fallback notice says 'Pockets longer than they are wide do this' for a star, a blob or an L."** It is a general sentence (`cnc-strategy-fallback-notice.ts:27-33`), and the main claim (offset rings, full-width first pass) is right. Not raised.
- **"A stored Pocket roughing bit is ignored when the layer is switched to Adaptive."** The UI hides the field for adaptive and nothing cuts with it. Consistent. Not raised.

## KNOWN status

| Item | Status on `9a0b1a80b` |
|---|---|
| AC-6 (09-24), adaptive engagement read as r(1 − cos(arc/2)) plus a one-cell allowance | **Still open, kept by ADR-154 Amd 3.** Default 10 %: rings at 59–76° (side-cut 1.6–2.4 mm) against 36.9° (0.635 mm). The verifier reads 0.53–0.93 mm. At 50 % it certifies a full slot (L: verifier 3.175 = limit; 72 mm of slot at F1000) |
| ADR-154 Amd 3, finishing rings unmeasured | Re-observed: 114° at 90° corners (v1: 99°), 181° for 7.8 mm at the triangle's 45° corners, at F1000 |
| AC-2 / CW-03, single-entry adaptive refuses long pockets | Re-observed and disclosed (ADR-154 Amd 5): L, slot, star, blob, round island, "O", 3 × 3 islands and the 1/8" island pocket cut offset rings |
| F2-P1-1 (crossing pins) | **Fixed, holds** (#1421): an 80 × 60 two-island pocket is planned as 7 strips, with no pin |
| F2-P2-1 (cleanup before clearing) | **Fixed, holds**: nested 60/36/18 and two pockets show no slot at F1000 |
| F2-P2-2 (rest fin above 50 %) | **Fixed, holds**: rest at 85 % leaves 0 |
| F2-P3-1, the adaptive chain ignores Cut direction | **Still open**: Conventional flips the helix (`G3`→`G2`) and the finishing ring; the 2,800-line chain is byte-identical to Climb |
| F2-P3-2 (no ADR for island adaptive) | Fixed by ADR-154 Amd 4 |
| JR-4 (09-24, partly fixed), a failed helix drops the layer | **Still open**: helix on an island pocket or a raster pocket gives an empty layer; the first message is "usually the bit is too wide" |
| F3-P3-4, default helix refused in about 6 mm holes | **Still open**: Ø6 and Ø6.4 with the 1/8" bit drop the layer; Ø5.5 and Ø7 plan |
| V6-P3-2, "Adjust Rough first or disable it" | Re-observed. It is also appended to a *valid* stock-aware rest's disclosure, under code `cnc-rest-machining-invalid` |
| CNG-T05, no pocket stock-to-leave | Unchanged by design (finish allowance is profile-only, `CncFinishAllowanceField.tsx:19`) |
| J1 refuted "V-bit pocket ribs" | Re-observed (60° V-bit, depth 2); the shape of the bit |

## Verified clean

- **Kept material.** 0 mm² cut outside any pocket or into any island in 96 programs. That covers every strategy, entry, rest mode, the two-layer pocket + inside profile, and the undersize replays.
- **Floor.** The deepest stock is exactly −depth (3, 3.2, 6, 6.35, 7, 12). Nothing goes below it.
- **Rapids.** 0 rapids remove stock, including the adaptive retract-and-re-enter between levels (`G1 Z-1.500 F300` down the open bore) and the island cells.
- **Plunges and descents.** Every Z-only feed into stock is at the plunge feed (F300). Every helix is at F300. Seeds and stay-down links are at F300. Ramps cap the Z rate at the plunge feed.
- **Coverage.** 0 reachable stock left by:
  - every compiled adaptive plan, at 0.05 mm to 50 %, including islands, nested, two pockets and strips;
  - offset pockets at 40–150 %, lifted and stay-down, with islands and stars;
  - raster up to 100 %;
  - helical and ramped entries;
  - legacy and stock-aware rest.

  The only exceptions are N3-P3-1, N3-P3-2 and the announced narrow areas.
- **Adaptive containment and helix.** The helix bore (0.75 R + R) stays inside the pocket. The helix is 3°, at most 2.87°, with no core. Entry slopes stay under the set angle in every manual helix (1.7–3.4° against 3–15°).
- **Order.** Sequences run region by region, each region's cleanup after its clearing (ADR-154 Amd 4).
- **Rest only where left.** The legacy rest bit spends 67–75 % of its feed path in stock. The stock-aware rest re-traces walls (disclosed tolerance band). Rest contact is at most 114°, except 181° for 2.8 mm in star tips narrower than the rest bit.
- **ETA.** 1.02–1.27× my lower bound.
- **Determinism** was not re-run; v1 verified it.

## Not verified

- Browser: Preview, the 3D viewer and the rendered Job Review dialog. Warnings were read from `detectMachineJobWarnings`, `detectMinFeatureWarnings` and the emit preflight; Job Review's other sources (reach, park, throughput) were not composed.
- Physical load: contact angle is geometry, not force; no chip-load arithmetic (N6).
- The GRBL simulator and hardware (N5). Island pockets larger than 100 × 60 mm, near the verifier's 1,000,000-cell budget. Text from real fonts (the "O" ring and the curves stand in). Tapered-ball and engraving pockets. Tiled or rotated pockets (N4).
- Vitest was not run; no test file was needed.

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-n3\`. Run each with `node --no-experimental-webstorage --import ./register.mjs <file> [name filter]`. Nothing in the repo or in `j38-main` was touched.

| File | What |
|---|---|
| `n3-sim.ts` | my G-code reader, exact flat / V heightfield sweep, rim-contact measure, distance transform |
| `n3-run.ts` | project builder, `emitGcode` + `prepareOutput` + warnings, measures (kept, floor, reach, uncut patches, freed parts, engagement by pass and feed, plunges, ETA) |
| `n3-selftest.ts` | oracle calibration on hand-written G-code |
| `n3-a.ts` → `out/a-run1.txt` | adaptive matrix: simple pockets, loads, depths, direction |
| `n3-b.ts` → `out/b-run1.txt` | islands, offset / raster, entries, rest, V-bit |
| `n3-c.ts` → `out/c-run1.txt` | through-stock, pocket + inside profile, stepover > 100 %, odd depth, undersize replay |
| `n3-d.ts` → `out/d-run1.txt`; `n3-e.ts` → `out/e-run1.txt` | through-stock freed parts (**N3-P1-1**), rest near walls / islands, helix + raster |
| `n3-f.ts`, `n3-g.ts`, `n3-h.ts` | rest after strip-leaving roughing (**N3-P3-2**); stored rough bit with adaptive / helix; F3-P3-4 re-check |
| `n3-verifier.ts` | the app verifier's own verdicts (AC-6 comparison) |
| `n3-summary.cjs` | the cross-program summary (kept, floor, rapids, plunges, ETA) |
| `out/<case>.nc/.json` | every emitted program and its measures |

## Counts

Raised 3: **P1 1** (N3-P1-1), **P2 0**, **P3 2** (N3-P3-1, N3-P3-2). KNOWN re-observed 9 (AC-6, ADR-154 Amd 3 finishing rings, AC-2, F2-P3-1, JR-4, F3-P3-4, V6-P3-2, CNG-T05, J1 V-bit ribs). Fixes holding: F2-P1-1, F2-P2-1, F2-P2-2, F2-P3-2.

```json
[
  {"id":"N3-P1-1","severity":"P1","area":"adaptive-and-pocket","file":"src/ui/laser/cnc-through-cut-tab-warnings.ts","line":145,"anchor":"Twin: Inside profile of the same loops warns 'the part and any hole slugs come free'; precedent J1-P1-1 / N1 free-part P1s","evidence":"REPRO","known":false,"summary":"A pocket at (or within 0.05 mm of, or past) the stock bottom frees every island in it - offset, adaptive, raster and rest alike (10 mm island, letter O counter) - on the last ring at F1000; pockets have no tabs and Job Review says nothing (past the bottom: spoilboard text only)"},
  {"id":"N3-P3-1","severity":"P3","area":"adaptive-and-pocket","file":"src/core/cnc/adaptive-pocket-islands.ts","line":105,"anchor":"Twin: offset rings overlap by (1-stepover)D","evidence":"REPRO","known":false,"summary":"Island-adaptive cells are inset exactly R from cut lines, so seams are cleared with zero overlap (Y331.825 / Y338.175 round seam Y335.000); a 6.30 mm actual bit leaves 0.05 mm full-depth walls along each seam"},
  {"id":"N3-P3-2","severity":"P3","area":"adaptive-and-pocket","file":"src/core/cnc/pocket-paths.ts","line":257,"anchor":"Twin: offset pocket core rings at the same stepover; F2-P2-2 rest core fix; stock-aware rest refuses >100%","evidence":"REPRO","known":false,"summary":"Raster pockets above 100% stepover leave full-depth strips (110%: 32.9 mm2, 150%: 100 mm2) where offset leaves 0, and legacy rest after such a rough leaves the same 99.5 mm2; the advisory only says the value is out of range"}
]
```

## Refuter (2026-11-13)

**Tree and harness.** Same read-only export `j38-main` (`origin/main` @ `9a0b1a80b`). `git diff --stat 9a0b1a80b origin/main` (now `155b76f74`) is empty over `src/core/cnc`, `src/ui/laser`, `src/io/gcode`, `src/core/min-feature`, `src/core/text`, `src/core/job` and `src/core/geometry`. Every result therefore stands on current main.

My scripts are in `zz-n3r\`. Run each with `node --no-experimental-webstorage --import ./register.mjs <file> [args]`. I read the auditor's `n3-run.ts`, `n3-b.ts` and `n3-c.ts` for API shape only; nothing imports `n3-sim`, `n3-run` or any other auditor script.

- **Own builder** (`r-build.ts`). It builds the project with `createProject` / `createLayer`, emits through `emitGcode` (the Save path) and `prepareOutput`, and reads:
  - `detectMachineJobWarnings(prepared.project, null, null, prepared)` and `detectMinFeatureWarnings`;
  - the emit preflight issues and `strategyFallbacks`;
  - `estimateJobDuration(…, { gcode })`.
- **Own geometry.** None of it is the auditor's, except two layouts I kept because the island-adaptive planner accepts nothing else (noted below):
  - a 70 × 50 plaque with a Ø12 round island and a 16 × 20 triangular island;
  - a "D" letter: a stem plus a half-round bowl, with a 393.8 mm² counter;
  - 70 × 50 with a 12 mm square island;
  - island-adaptive partitions: 50 × 50 with a centred 10 mm island, and 60 × 60 with two 10 mm islands;
  - plain pockets: a 32 mm square, a Ø32 disc, an octagon Ø36, a 44 × 16 L, 44 × 30, and a 36 × 28 rectangle for raster;
  - real glyphs from the bundled Pacifico, Great Vibes, Dancing Script, Allura and Roboto fonts, through `textToPolylines`.
- **Own stock model, a different method** (`r-gc.ts`, `r-poly.ts`). It uses polygon booleans, not a grid.
  - Arcs are flattened to chords with a 0.001 mm sagitta.
  - In the horizontal slice at height z, the removed material is the union of the Minkowski sums of every move's XY path below z with the cutter disc. That is Clipper2 `inflatePaths` with round ends, 0.0005 mm arc tolerance, on a 0.1 µm integer grid. Clipper2 is used as a polygon library only; no CAM function is called.
  - Freed parts are the connected components of (block − swept) in the slice 0.0005 mm above the stock bottom (polytree, exact holes). A flat end mill's swept set only grows downward, so a component that is separate in that slice is a separate solid.
- **Own load measure, a different definition** (`r-ac6.ts`). The radial width of cut is the area a 1 mm chunk of path removes from the slice 0.75 mm above its tool bottom, divided by its XY length.
  - A straight side cut of radial depth ae reads exactly ae, and a slot reads D.
  - Calibration on hand-written G-code (`r-ac6.ts cal`): ae 0.3175 / 0.635 / 1.5875 / 3.175 read 0.318 / 0.635 / 1.587 / 3.175, and every slot reads 6.350.
  - This measures removed material (the average chip width), not the auditor's contact angle. The two agree on straight cuts and differ on curved ones.
- **Not used:** Vitest, pnpm, a browser, hardware, the GRBL simulator. The Node heap stayed ≤ 900 MB, with 2.1–2.8 GB free. One script hit that cap on an empty program before I added a guard; nothing else was affected.

### Verdicts

| Finding | Verdict | Severity | Evidence (own) |
| --- | --- | --- | --- |
| N3-P1-1 | **CONFIRMED, strengthened and narrowed.** The island is not freed on the last ring: the bit keeps cutting at full depth beside it. The 6.30 mm row (0.05 mm skin) is not freed geometrically and belongs to N2-P2-3's class | **P1** at depth ≥ stock; the near-bottom skin row **P2** | `r-p11.ts` → `out/p11.txt`, `out/p11-p11-ad-.txt`; `r-after.ts` → `out/after.txt`; READ `cnc-through-cut-tab-warnings.ts:145`, `compile-cnc-layer-passes.ts:362`, `cnc-tutorials.ts:56`, ADR-106 Amd 2 D3 |
| N3-P3-1 | **CONFIRMED and extended:** a bit only 0.01 mm undersize already leaves a foil | P3 | `r-p31.ts p31` → `out/p31.txt`; READ `adaptive-pocket-islands.ts:105-133`, `adaptive-pocket-sequences.ts:47-51` |
| N3-P3-2 | **CONFIRMED.** Strips start at 105 %, and legacy rest leaves them untouched | P3 | `r-p31.ts p32` → `out/p32.txt`; `r-p32w.ts`; READ `pocket-paths.ts:257-292`, `rest-pocket.ts:135-152`, `CncLayerAdvancedFields.tsx:243-252` |
| AC-6 (KNOWN) | **Re-measured by removal width; not re-rated.** At 10 % the overload is real but modest. The 50 % slot certification is confirmed; it is the decision ADR-154 Amd 3 deferred | KNOWN | `r-ac6.ts` → `out/ac6.txt` |
| JR-4 / F3-P3-4 (KNOWN) | **CONFIRMED and disclosed:** the layer is refused, and the second message names the real cause | KNOWN | `r-jr4.ts` |
| **N3r-P2-1 (new)** | A pocket on **script text** leaves every overlapping glyph join standing as a full-height island; so do profiles, but that half is not raised. V-carve and laser Fill resolve the same text non-zero | **P2** | `r-new.ts text` / `text2` → `out/new-text.txt`, `out/new-text2.txt`; `r-near.ts` → `out/near.txt` |
| **N3r-P2-2 (new)** | A pocket arm, channel or island gap **exactly the bit's width** is left uncut with no warning. 0.01 mm narrower is warned; 0.001 mm wider is cut | **P2** | `r-tie.ts` → `out/tie.txt`; `r-new.ts geom` → `out/new-geom.txt`; READ `min-feature-analysis.ts:186,221` |

**N3-P1-1: CONFIRMED, P1 at depth ≥ stock thickness; strengthened; the 0.05 mm-skin row narrowed to P2.**

Setup: 6.35 mm stock, 1.5 mm per pass, bottom slice 0.0005 mm above the stock bottom (`out/p11.txt`). "Feed after" is the feed run at full depth after the first part comes free; in brackets, the part of it with the tool edge within 0.5 mm of a loose part.

| Pocket (own geometry) | Depth | Pieces in the bottom slice | Freed | Feed after (near a loose part) | Job Review + preflight |
| --- | --- | --- | --- | --- | --- |
| plaque, Ø12 + triangle islands: offset / offset lifted / raster Y / adaptive (falls back to offset, announced) | 6.35 | 3 | **160.0 + 113.0 mm²** | offset **541 mm (144)**; lifted 465 (130); raster 451 (144) | **nothing** |
| same, rest 6.35 → 3.175 | 6.35 | 3 | both | 519 mm (166), across the bit change | **nothing** (only the shared-feed note) |
| same, every strategy | 6.30 / 6.20 | **1** (0.05 / 0.15 mm floor) | none geometrically | — | **nothing** |
| same, every strategy | 7.00 | 3 | both | as at 6.35 | only "0.65 mm past the bottom, into the spoilboard" |
| "D" letter, 1/8" bit: offset; adaptive (falls back); 12 mm stock at 12 | = stock | 2 | **393.8 mm² counter** | 307 mm (87) | **nothing** |
| 12 mm square island: offset / raster X / adaptive (falls back) | 6.35 / 6.30 | 2 / 1 | 144 mm² / none | 713 mm (73) / — | **nothing** |
| 50 × 50, 10 mm island, **true island-adaptive** (8 partitions) | 6.35 / 6.30 | 2 / 1 | 100 mm² / none | 310 mm (60) | **nothing** |
| 60 × 60, two islands, **true island-adaptive** (13 partitions) | 6.35 | 3 | 2 × 100 mm² | **1,837 mm** after the first island frees (4,729 mm of feed in all); 382 mm (120) after the second | **nothing** |
| plaque pocket plus a separate Outside profile with tabs (the usual sign workflow) | 6.35 | 3 | both | 1,065 mm, then the outline | **nothing** |
| twin: the plaque loops as an **Inside profile, tabs off** | 6.35 | 5 | 4 (the part and its slugs) | 5 mm | "cuts through the stock … the part and any hole slugs come free on the final pass" |
| twin: Inside profile, tabs on | 6.35 | 1 | none | — | none (held) |
| control: the plaque without islands | 6.35 | 1 | none | — | none |

- **(a) Does a pocket to the stock bottom free the island?** Yes. In the exact bottom slice the island is a separate polygon in every strategy, so it is a separate solid. Nothing is left under the pocket floor.
- **(b) The 6.30 mm row: not freed geometrically.**
  - The bottom slice is one piece: a 0.05 mm skin under the whole pocket floor holds the island. The auditor reports it as freed because its oracle counts only material more than 0.1 mm thick.
  - A 0.05 mm skin is thinner than ordinary sheet and spoilboard tolerance and will tear, so in practice the island is loose. But this is exactly N2-P2-3's class (a near-bottom floor with no advisory), which the ledger rates **P2**.
  - It should be fixed by that shared advisory (a floor of 0.2 mm or less), not counted in this P1.
- **(c) A realistic choice, and against the app's own contract.**
  - Through pockets are an advertised use. ADR-106 Amd 2 Decision 3 makes the box dialog emit full-depth **pocket** slots, on the premise "A pocket clears the whole slot, so no piece is left for a tab to hold, and pocket operations never take tabs". That premise is false as soon as the region has an island.
  - The Pocket tutorial (`cnc-tutorials.ts:56`) tells the operator "To keep an island, use one compound outline with an inner hole". At depth ≥ stock the island is not kept.
  - Pocketing lettering or a fretwork panel through the stock (stencils, cut-through signs) is ordinary work. Every letter counter (O, A, B, D, P, R, a, b, d, e, g, o, p, q) is such an island.
- **Strengthened: the island is not freed on "the last ring".**
  - In the offset plaque the first island comes free at line 1388 of 1577. The bit then runs another 541 mm at Z−6.35, 144 mm of it with its edge within 0.5 mm of a loose island: the rings round the round island run after it is free.
  - In the two-island adaptive pocket the bit runs **1,837 mm at full depth** after the first island is loose.
  - The warned profile twin frees its slugs with only 5 mm of cutting left. The unwarned pocket case is the more dangerous of the two.
- **Rating: P1 stands.** I tried both ways METHOD §3 allows to lower it, and neither holds:
  - *The output is not wrong.* Depth and position are as set, but the operation's own stated meaning is broken: the island is not kept, and ADR-106's "no piece is left" is false. J1-P2-1, the P2 precedent for "only the twin's warning is missing", frees nothing: a V-carve touches the bottom only along a zero-width line.
  - *A clear warning reaches the operator.* Nothing warns at the bottom. Past it, the spoilboard line says the cut goes below the stock but not that anything comes free. Rolling v3 G6 requires the warning to name the specific mismatch.
  - *Ledger precedent:* a part freed with no warning is P1 (N1-P2-1→P1, N1-P2-2→P1), and here the bit keeps machining beside it.
- **Fix direction:** the auditor's, plus:
  - extend `throughCutWarning`'s contract to pockets whose region has holes;
  - fold the near-bottom skin into the shared advisory for floors of 0.2 mm or less (N2-P2-3 / J1-P2-1);
  - correct ADR-106 Amd 2's premise, or limit it to island-free slots;
  - optionally cut each island's last ring last, so nothing runs beside a loose island.

**N3-P3-1: CONFIRMED P3.** I replayed the island-adaptive programs along the same paths with smaller cutters. The target is the nominal reach, minus the band an undersize bit leaves on every wall (`out/p31.txt`):

| Pocket | R 3.175 (nominal) | R 3.170 (Ø6.34) | R 3.165 | R 3.150 (Ø6.30) | Offset twin at Ø6.30 |
| --- | --- | --- | --- | --- | --- |
| 50 × 50, 10 mm island (8 cells) | 0 | 0.585 mm² in 8 foils, 0.010 × 7.3 mm | 1.171 | **2.940 mm² in 8 foils, 0.05 × 7.36 mm** | 0.000 |
| 60 × 60, two islands (13 cells) | 0 | 1.131 in 10 | 2.264 | **5.675 in 10** (0.05 × 12.4 mm) | 0.001 |

- **Where the foils are.** They sit exactly on the cut lines (machine X50.00, X60.00, Y340.00, Y350.00). So both cells stop exactly R short of each seam, as the auditor read.
- **What causes it.**
  - Runout does not: it widens the effective cut and would clear the foil.
  - An undersize bit does. End mills are commonly ground a few hundredths under nominal, and a re-sharpened bit is smaller still.
  - So can deflection away from the cut on the finishing rings.
- **Severity: P3 stands.** A 0.01–0.05 mm wall, full depth tall, crumbles in wood and leaves a burr or hairline in plastics and aluminium. It is cosmetic.

**N3-P3-2: CONFIRMED P3.** Setup: a 36 × 28 rectangle, 1/4" bit, 3 mm deep, raster Y (`out/p32.txt`):

| Stepover | 95 / 100 % | 105 % | 110 % | 125 % | 150 % | 200 % |
| --- | --- | --- | --- | --- | --- | --- |
| Uncut at the full 3 mm height (mm²) | 0 | **14.6** (3 strips, 0.32 mm wide) | 29.1 (3 × 0.64 mm) | 72.9 | 97.2 | 162.2 |
| Offset at the same stepover | — | — | 0 | — | 0 | — |
| Legacy rest 6.35 → 3.175 after this raster rough | — | — | **29.1, unchanged** | — | **97.2, unchanged** | — |

- **Strips from 105 %.** The rest bit never touches them, because `remainingStock` models the rough bit's ideal reach, not its rows (`rest-pocket.ts:135-152`).
- **The only advisory is the generic one:** "Stored Stepover … is 105%, outside the 10-85% recommended range … Check the resulting route density". It fires from 86 % and reads the same at 100 % (clean) as at 105 % (strips).
- **Severity: P3 stands.** The field is unbounded (`positiveOnly`), but the value is outside the recommended range, the advisory fires, and Preview shows the strips.

**AC-6 (KNOWN): re-measured by removal width; not re-rated.**

How to read the table (`out/ac6.txt`):
- "Clearing chain" leaves out the wall and island finishing rings: any chunk whose ends all lie within R + 0.05 mm of a drawn loop.
- Lengths are lateral moves at F1000 (the cutting feed).
- Widths are in mm; L is the "Radial engagement" limit.

| Pocket, limit L | Width p50 / p90 / p99 / max | Length > 1.1 L | Length > 2 L | Full slot (≥ 0.95 D) at F1000 |
| --- | --- | --- | --- | --- |
| 32 mm square, 10 % (0.635) | 0.32 / 0.84 / 0.87 / 1.87 | 924 of 3,737 mm (25 %) | 15.2 mm | 0 |
| Ø32 disc, 10 % | 0.42 / 0.53 / 0.93 / 1.31 | 57 of 3,209 | 4.5 | 0 |
| octagon Ø36, 10 % | 0.41 / 0.66 / 0.69 / 2.00 | 33 of 3,673 | 18.6 | 0 |
| 50 × 50 + island (8 cells), 10 % | 0.54 / 0.86 / 2.07 / 3.76 | 1,666 of 5,680 (29 %) | 96.3 | 0 (58.4 mm at **F300**: the disclosed seeds) |
| 32 mm square, 25 % (1.5875) | 0.83 / 1.98 / 2.87 / 3.61 | 300 of 1,479 | 3.2 | 0 |
| 32 mm square, 50 % (3.175) | 1.97 / 3.44 / 4.92 / 5.59 | 59 | 0 | 0 |
| **44 × 16 L, 50 %** | 1.59 / 6.35 / 6.35 / 6.35 | 126 | 37.7 | **92.5 mm** (line 192 is a 20 mm straight slot) |
| **44 × 30, 50 %** | 1.59 / 3.44 / 6.35 / 6.35 | 76 | 17 | **22.4 mm** |
| finishing rings (walls and islands), all cases | max 3.75–3.77 at corners | — | — | 0 |

- **At the default 10 %, the setting is close to its promise in removal terms.**
  - The median width is at or below L, because the rings are spaced L/2 apart.
  - On simple pockets p90 is 0.8–1.35 L and p99 is 1.1–1.5 L. Peaks reach 2–3 L for 5–19 mm. The island case reaches 3.3 L at p99.
  - That is far below the auditor's contact-angle equivalent of 1.6–2.4 mm (2.5–3.8 L). On a curved path the contact angle rises while the chip width does not, so the auditor's figure is right for peak chip thickness but overstates the width of material removed.
  - Neither measure finds a slot at 10 %.
- **At 50 %, the slot certification is confirmed independently.** The verifier passes full-width slots at the cutting feed: 92.5 mm and 22.4 mm here, against the auditor's 72 and 21 mm. That follows from its formula: a slot reads r(1 − cos 90°) = r, which equals the limit.
  - ADR-154 Amd 3 (Consequences) already records this: tightening the allowance "would refuse a full slot at engagement limits of 41% of the diameter and more … That needs its own decision."
  - That decision has not been taken. It is the actionable item, not a re-rating.
  - The physical harm is limited: a slot one Depth per pass deep at F1000 is what every offset pocket's first ring cuts.
  - **Keep AC-6 KNOWN.** Route the Amd 3 decision: refuse slots at limits of 41 % or more, or say so in the field.

**JR-4 / F3-P3-4 (KNOWN): CONFIRMED and disclosed** (`r-jr4.ts`).
- **Setup** (own geometry, 1/8" bit for the holes): a pocket with a Ø12 island, a raster pocket, and Ø6.2 and Ø6.8 holes.
- **Result.** With a helical entry, the island pocket, the raster pocket and the Ø6.2 hole produce no cutting moves.
- **What the operator is told.** The preflight lists three issues in order:
  1. `cnc-layer-empty`, "usually the bit is too wide";
  2. `cnc-helix-entry-invalid`, with the true cause: "requires one island-free pocket per layer", "requires the Offset pocket fill method", or "minimum helix diameter does not fit";
  3. `empty-output`.
- Nothing silent is emitted. The Ø6.8 hole plans. The misleading first line is the KNOWN JR-4 wording.

### Challenges to "Verified clean"

All runs are mine, on my own geometry, 3 mm deep unless noted (`r-clean.ts` → `out/clean.txt`, `out/clean-all.log`).
- "Kept cut" counts material cut more than 0.002 mm outside the drawn region.
- "ETA ratio" is `estimateJobDuration` divided by my lower bound.

| Program | Kept cut | Floor | Uncut reachable | Rapids into stock | Plunges off the plunge feed | Descents | ETA ratio |
| --- | --- | --- | --- | --- | --- | --- | --- |
| plaque, offset | 0 | −3.000 | 0 | 0 | 0 | — | 1.084 |
| plaque, offset, conventional, lifted | 0 | −3.000 | 0 | 0 | 0 | — | 1.099 |
| plaque, raster Y | 0 | −3.000 | 0 | 0 | 0 | — | 1.089 |
| plaque, ramp 7° | 0 | −3.000 | 0 | 0 | 0 | 7.0° at F1000 (Z rate 122 mm/min) | 1.080 |
| plaque, rest 6.35 → 3.175 | 0.004 mm², all under 0.01 mm deep (arc fit on the Ø12 island) | −3.000 | 0.018 mm²: four corner cusps of 0.004 mm², about 0.01 mm thick | 0 | 0 | — | 1.149 |
| plaque, stock-aware rest | 0 | −3.000 | 0 | 0 | 0 | — | 1.077 |
| 32 mm square, helix 8/2/3° | 0 | −3.000 | 0 | 0 | 0 | 1.7° at F300 | 1.074 |
| 32 mm square, adaptive | 0 | −3.000 | 0 | 0 | 0 | 2.9° at F300 | 1.030 |
| Ø32 disc, adaptive, 1/8" | 0 | −3.000 | 0 | 0 | 0 | 2.9° at F300 | 1.061 |
| 50 × 50 island, adaptive | 0 | −3.000 | 0 | 0 | 0 | 2.9° at F300 | 1.046 |
| 60 × 60 two islands, adaptive, depth 4.2 | 0 | −4.200 | 0 | 0 | 0 | 2.9° at F300 | 1.041 |
| octagon, adaptive, conventional | 0 | −3.000 | 0 | 0 | 0 | 2.9° at F300 | 1.033 |

- **The rest row is not a defect.** Its 0.004 mm² "kept cut" vanishes at a 0.01 mm threshold (`r-dbg-rest.ts`). Both it and the corner cusps come from fitting arcs against my disc, which is drawn with a 0.005 mm sagitta. Not raised.
- **The headline holds** on independent geometry and an independent model:
  - no kept material is cut, and nothing goes below the floor;
  - no rapid enters stock, and every plunge is at the plunge feed;
  - all reachable stock is cleared;
  - ETA is 1.03–1.15× my lower bound.
- **Wording caveat.** The auditor's claim that every pocket clears what it promises does not hold for script text (N3r-P2-1) or for features exactly the bit's width (N3r-P2-2). Its scenes contained neither.

### New findings

#### N3r-P2-1 — A pocket on script text leaves every overlapping glyph join standing at full height; V-carve and laser Fill resolve the same text non-zero

- **Where:** `src/core/cnc/collect-cnc-contours.ts:42-50` (`layerPolylinesFromContours`).
  - Only `v-carve` and the tapered `inlay-pair` run `mergeTextObjectContours`.
  - Every other cut type, pocket included, "reads the raw pool". The pocket planner resolves that pool even-odd (`pocketContours` / `insetContoursChecked`; `cnc-pocket-stock.ts:43`).
  - In a script font, neighbouring letters join by overlapping two contours wound the same way. Under even-odd the overlap cancels, so each join becomes an island.
- **Anchor:**
  - Twin 1, ADR-286. Its Context says even-odd turns a script join into "a raised bridge of untouched material", and Decision 1 fixes that for V-carve.
  - Twin 2, laser Fill. `layer-fill.ts:231` resolves a text object non-zero by default, and `fill-rule.ts` says "Text geometry is resolved per object under non-zero semantics".
  - Precedent: `2026-10-09-released-cnc-output-audit.md:16` rated the tapered-inlay twin of this ("cancels overlapping text joins") **P2**, and it was fixed the same way.
- **Evidence:** REPRO (`r-new.ts text` / `text2` → `out/new-text.txt`, `out/new-text2.txt`).
  - The text objects come from the real `textToPolylines` on the bundled fonts, with Weld overlaps off (the default).
  - A "lens" is a join's overlap: the non-zero union minus the even-odd union of the compiled contours.
  - The last column gives the distance from the nearest cutting move to each lens centre.

  | Text, bit | Joins | Lens area the bit can reach | Left at full height | Nearest cutting move |
  | --- | --- | --- | --- | --- |
  | Pacifico "Hello" 30 mm, 1/8", offset | 3 | 18.7 mm² | **18.7 mm²** (all of it) | 2.67–2.81 mm (bit radius 1.59) |
  | same, raster Y; same, 1/16" offset | 3 | 18.7 | **18.7** | — |
  | Great Vibes "Anna" 40 mm, 1/16" | 3 | 10.1 | **10.1** | — |
  | Dancing Script "mom" 40 mm, adaptive (falls back) | 2 | 0.9 | **0.9** | — |
  | Roboto "BOAR" (control, no overlaps) | 0 | — | — | — |
  | Pacifico "Hello", **V-carve twin** | 3 | — | carved | **0.20–0.44 mm, at Z−2.95 to −3.22** (`out/near.txt`) |

  - **Job Review is silent about the joins.** Its only line is the general MINF one ("19 areas narrower than the 3.17 mm bit … stay uncut"), which the thin strokes trigger with or without the joins.
  - **Profiles too.** An Inside profile leaves the same lenses standing (`new-text-pacifico-inside`). Rolling v7 L1 called profiles on overlapping text "ambiguous", so only the pocket is raised.
- **Scenario:** recessed script lettering on a sign, pocketed 2 mm deep for a paint fill. At each join (Pacifico's "ll" and "lo") a 2 × 4 mm lens of full-height wood stays in the floor and shows through the paint. V-carving or laser-filling the same text does not do this.
- **Severity: P2.**
  - It is wrong output, unannounced, from bundled fonts at default settings. Its tapered-inlay twin had the same class and rating.
  - It stays below P1: nothing is gouged or freed. The text card's "Weld overlaps" checkbox ("Join script letters", off by default) avoids it, but nothing tells the operator to use it.
- **Announced?** No.
- **Novelty:** new as a raised item.
  - ADR-286 limited the fix to V-carve, and the 2026-10-09 audit extended it to tapered inlay.
  - Rolling v7 L1 left kerf on overlapping text out as "ambiguous".
  - Rolling v8 N5 noted "CNC pockets read the raw contour pool … probably unreachable. Not run." It is reachable: put a text object on a Pocket layer.
- **Fix direction:**
  - Apply `mergeTextObjectContours` to pocket (and to inlay-pair without taper) in `layerPolylinesFromContours`. Keep ADR-286's per-object scope and ADR-270 Amd 1's even-odd between objects.
  - Or warn when a text object on a pocket layer has same-winding overlaps, and point to Weld overlaps.
  - Add a Pacifico pocket case beside ADR-286's V-carve regression test.

#### N3r-P2-2 — A pocket feature exactly the bit's width is left uncut with no warning; 0.01 mm narrower is warned, 0.001 mm wider is cut

- **Where:** the planner and the advisory disagree exactly at the tie.
  - **Planner.** The pocket's centre region is the inset by R (`pocket-paths.ts`, `insetContoursChecked(contours, toolDiameterMm / 2)`), for offset and raster alike. A channel exactly D wide insets to a zero-width line, the polygon library drops it, and that part of the region gets no path.
  - **Advisory.** `src/core/min-feature/min-feature-analysis.ts:186` (`if (closest.distSq >= this.thresholdSq) return true`) and `:221` (`< thresholdMm`) treat a width equal to the bit as enterable, so no warning fires.
- **Anchor:**
  - Twin: the same layout 0.01 mm narrower gets "MINF … 1 area narrower than the 6.35 mm bit … the bit cannot enter it, so it stays uncut".
  - The auditor's own Refuted note relies on this line covering narrow areas ("Job Review already says that area stays uncut").
- **Evidence:** REPRO (`r-tie.ts` → `out/tie.txt`; `r-new.ts geom` → `out/new-geom.txt`). Setup: 1/4" bit, 2 mm deep; offset and raster X give identical results.

  | Feature | Width (mm) | Left at full height | Job Review / preflight |
  | --- | --- | --- | --- |
  | 25 mm arm on a 30 × 40 pocket | 6.34 | (warned) | MINF "stays uncut" |
  | same | **6.35** | **154 mm², the whole arm** (167.4 mm², minus the 13.0 mm² of corner cusps the 6.36 run also leaves) | **none** |
  | same | 6.36 | 13.0 mm² (corners only) | none |
  | island 6.34 mm from a wall | — | (warned) | MINF |
  | island **6.35 mm** from a wall | — | **about 131 mm²** (1,560 of 1,700 mm² cut) | **none** |
  | island 6.36 or 6.5 mm from a wall | — | 0 (1,691 of 1,700 mm² cut) | none |
  | lone slot, 40 mm long, 1/4" bit | 6.34 / **6.35** / 6.351 | all / all / 8.7 mm² at the ends | MINF + `cnc-layer-empty` / `cnc-layer-empty` only (disclosed) / none |
  | lone slot, 1/8" bit | **3.175** / 3.18 | all / 2.3 mm² | `cnc-layer-empty` / none |

- **Scenario:** an operator draws a 1/4" dado, groove or slot-joint arm exactly 6.35 mm wide (the nominal thickness of 1/4" ply) as part of a larger pocket, and cuts it with the 1/4" bit. The bit physically fits, but the program leaves the whole arm at full height and Job Review says nothing.
  - A lone slot of exactly the bit's width is refused with the empty-layer message, so it is disclosed.
  - The silent cases are features joined to a larger pocket, and islands exactly D from a wall.
- **Severity: P2.** It is wrong output with no warning. But it is recoverable: material is left, not removed, and Preview shows it. That matches the other unwarned "uncut stock" findings (F2-P2-2).
- **Announced?** No. MINF's own threshold leaves out the tie.
- **Novelty:** new. No `docs/audits` item covers the exact-width tie for pockets.
- **Fix direction:**
  - Make MINF's width test `<=` with a small tolerance (or `< D + output precision`), so the tie is warned.
  - Or inset by R − ε (e.g. 0.001 mm) in the pocket planner, so a feature exactly D wide gets its centre-line pass, as a real bit of diameter D would cut it.

### Probes with no gap (new-gap search)

- **Thin wall between two pockets** (0.8 mm apart, 5 mm deep, 1/4" bit). The wall is kept exactly (kept cut 0), and both pockets are cleared. MINF's "gap" check covers a bit running outside shapes, not a wall between two pockets. That is a design choice, not a defect.
- **Islands that touch** (a shared edge) or **overlap.** Kept cut is 0. Where two islands overlap, the lens between them is pocketed, because the region is even-odd. That matches laser Fill on non-text art and the ADR-270 convention, so it is not raised (rolling v7 L1 called it ambiguous).
- **Finish allowance stored on a pocket.** It is ignored: the pocket cuts to the drawn wall and floor. That matches CNG-T05 (the allowance is profile-only). KNOWN.
- **Pocket and profile.** These need separate layers, since a layer has one cut type. With a pocket layer and an Outside profile layer (tabs on), the pocket runs first (`p11-plaque-offset-plus-outline`). The islands come free before the outline runs; the part itself stays held by the outline's tabs. That is N3-P1-1 again.
- **Real-font pockets without overlaps** (Roboto "BOAR"). Clean; the narrow stroke areas get the MINF warning.
- **Ramp descents.** 7° at F1000 is a 122 mm/min Z rate, under the plunge feed.

### Not verified

- **Breakage or ejection of a freed island.** The hazard (a loose part beside a running bit) is inferred from geometry, as in N1.
- **The rendered Job Review dialog and Preview.** Warnings were read from `detectMachineJobWarnings`, `detectMinFeatureWarnings` and the emit preflight.
- **The V-carve twin's carved area.** My own V-bit sweep in `r-new.ts` reported 0 mm² of lens carved. That contradicts the direct path distance (0.20–0.44 mm at Z−3), and the V-bit radius grouping in that script is suspect. The twin claim rests on `r-near.ts` and ADR-286, not on that number.
- **F2-P3-1** (the adaptive chain ignores Cut direction) was not re-measured. The conventional octagon ran clean (`out/clean-all.log`).
- **Vitest:** none run.

### Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-n3r\`. Run each with `node --no-experimental-webstorage --import ./register.mjs <file> [args]`. Programs are written to `out\<case>.nc`. Nothing in the repo or in `j38-main` was touched.

| File | Covers | Output |
| --- | --- | --- |
| `r-build.ts` | Own project builder: Save-path emit, prepare, warnings, preflight, fallbacks, ETA | — |
| `r-gc.ts` | Own G-code reader (G0–G3, G90/G91, G20/G21; arcs at 0.001 mm sagitta) | — |
| `r-poly.ts` | Polygon stock model: per-slice swept unions, opening, components | — |
| `r-p11.ts [filter]` | N3-P1-1: through pockets, twins, the first and last freeing line, feed after | `out/p11*.txt` |
| `r-after.ts <nc> <line>` | Full-depth feed after a given line | `out/after.txt` |
| `r-p31.ts p31` / `p32` | N3-P3-1 undersize replays; N3-P3-2 raster stepover and legacy rest | `out/p31.txt`, `out/p32.txt` |
| `r-p32w.ts` | Stepover advisories | stdout |
| `r-ac6.ts [cal\|filter]` | AC-6 removal width and its calibration | `out/ac6*.txt` |
| `r-jr4.ts` | JR-4 / F3-P3-4 disclosure | stdout |
| `r-clean.ts [filter]`, `r-dbg-rest.ts` | Spot checks of "Verified clean" | `out/clean*.txt`, `out/clean-all.log` |
| `r-new.ts text\|text2\|geom`, `r-near.ts` | N3r-P2-1 script joins; new-gap probes | `out/new-*.txt`, `out/near.txt` |
| `r-tie.ts` | N3r-P2-2, the exact-width tie | `out/tie.txt` |
| `r-probe-ad*.ts`, `r-ext.ts`, `r-vlens.ts` | Adaptive acceptance probes; toolpath extents; a superseded lens check | stdout |

```json
{
  "area": "N3",
  "role": "refuter",
  "tree": "9a0b1a80b (no cnc/laser/gcode/min-feature/text/job/geometry diff to origin/main 155b76f74)",
  "verdicts": [
    {"id": "N3-P1-1", "verdict": "CONFIRMED, strengthened, narrowed", "severity": "P1", "evidence": "REPRO polygon bottom slice: plaque (Ø12 + triangle islands), D letter, square island, true island-adaptive 50x50 and 60x60-two: islands separate at depth = stock and past it, offset/raster/adaptive/rest; no Job Review line (7 mm: spoilboard text only); bit keeps cutting at full depth after the first island frees: 541 mm offset (144 mm within 0.5 mm of the loose island), 1,837 mm two-island adaptive; Inside tabs-off twin warns with 5 mm left. 6.30 mm: one piece held by a 0.05 mm skin -> N2-P2-3 class, P2. Anchors: ADR-106 Amd 2 D3 'no piece is left', cnc-tutorials.ts:56 'To keep an island'"},
    {"id": "N3-P3-1", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO replay at R 3.170/3.165/3.150: 0.585/1.171/2.940 mm2 foils on the 8 seams of a 50x50 island-adaptive (10 seams, 5.675 mm2, on 60x60 two-island); offset twin 0"},
    {"id": "N3-P3-2", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO raster Y 36x28: 0 at 100 %, 14.6 mm2 at 105 %, 29.1 at 110 %, 97.2 at 150 %, 162 at 200 %; offset 0; legacy rest leaves the strips unchanged; advisory generic from 86 %"}
  ],
  "known": [
    {"id": "AC-6", "status": "re-measured, not re-rated", "evidence": "removal width at 10 %: p50 0.32-0.54, p90 0.53-0.86, p99 0.69-2.07 mm vs 0.635; 50 %: full slots at F1000 92.5 mm (L) and 22.4 mm (44x30) = ADR-154 Amd 3's deferred decision"},
    {"id": "JR-4 / F3-P3-4", "status": "confirmed, disclosed by preflight second message"},
    {"id": "ADR-154 Amd 3 finishing rings", "status": "re-observed, wall-ring corners remove 3.75 mm/mm"},
    {"id": "AC-2", "status": "re-observed: fallbacks announced (plaque, D, square island, 34x26, 36x30)"},
    {"id": "CNG-T05", "status": "re-observed: finish allowance on a pocket ignored"}
  ],
  "new": [
    {"id": "N3r-P2-1", "severity": "P2", "area": "adaptive-and-pocket", "file": "src/core/cnc/collect-cnc-contours.ts", "line": 42, "anchor": "Twins: ADR-286 V-carve non-zero text union; laser Fill layer-fill.ts:231 resolves text non-zero; precedent 2026-10-09 tapered-inlay twin P2", "evidence": "REPRO textToPolylines on bundled fonts: Pacifico 'Hello' 3 joins 18.7 mm2 left at full height (offset, raster, 1/16in), Great Vibes 'Anna' 10.1 mm2, Dancing Script 'mom' 0.9 mm2; V-carve twin passes 0.20-0.44 mm from each lens centre at Z-2.95..-3.22; Roboto control clean", "known": false, "summary": "A pocket on script text resolves the raw contour pool even-odd, so every same-winding glyph overlap (a script join) becomes an uncut full-height island; V-carve and laser Fill resolve the same text non-zero; no warning (Weld overlaps is the unannounced workaround)"},
    {"id": "N3r-P2-2", "severity": "P2", "area": "adaptive-and-pocket", "file": "src/core/min-feature/min-feature-analysis.ts", "line": 186, "anchor": "Twin: the same feature 0.01 mm narrower gets MINF 'stays uncut'; the CAM insets by exactly R", "evidence": "REPRO 1/4in: 25 mm arm 6.35 wide left whole (154 mm2) with no line, 6.34 warned, 6.36 cut; island 6.35 mm from a wall ~131 mm2 left, no line; lone exact-width slots refused with cnc-layer-empty (disclosed)", "known": false, "summary": "A pocket arm, channel or island gap exactly the bit diameter is not cut (zero-width inset dropped) and MINF treats width == D as enterable, so Job Review is silent"}
  ],
  "counts": {"raised": 5, "refuted": 0, "P1": 1, "P2": 2, "P3": 2, "known": 5}
}
```

Refuter counts: raised 5, refuted 0, P1 1, P2 2, P3 2, known 5
