# Quality audit Q1 — Vector burn quality

- **When:** 2026-10-28 01:45 – 02:40 +0800
- **Tree:** origin/main @ `93334429e` (fetched 2026-10-28 02:20).
  - The audit worktree HEAD is `c54fa8226` (branch `claude/rolling-audit-v5`, docs only).
  - `git diff origin/main` is empty for every cited file: `src/core/devices/{gcode-dialects,laser-arc-moves,device-profile,controller-streaming-mode}.ts`, `src/core/output/**`, `src/core/job/{fill-hatching,fill-sweep-plan,fill-overscan,fill-runway-policy,contour-entry,cut-arc-moves,laser-lead-path,scan-offset,layer-fill,island-fill-motion,toolpath,estimate-duration,compile-job-defaults,automatic-overscan}.ts`, `src/core/motion-planner/**`, `src/core/gcode-time/**`, `src/core/scene/layer.ts`, `src/core/grbl-streaming.ts`, `src/core/controllers/grbl/streamer.ts`, `src/ui/laser/{scan-quality-warnings,job-intent-warnings}.ts` and `src/ui/workspace/draw-preview.ts`. The repros therefore ran on main's code.
- **Scope:** how Line (cut/score) and Fill (scanline and island hatch) operations burn on GRBL.
  - Emission: `src/core/output/{grbl-strategy,grbl-fill-emission,grbl-laser-lines,grbl-laser-arc-moves,grbl-power-modes}.ts`, `src/core/devices/gcode-dialects.ts`.
  - Compile: `src/core/job/{fill-hatching,fill-sweeps,fill-sweep-plan,fill-overscan,fill-runway*,layer-fill,island-fill*,contour-entry,cut-arc-moves,laser-lead-*,scan-offset,automatic-overscan}.ts`, `src/core/geometry/arc-fit/` (read only).
  - Twins: `src/core/job/toolpath.ts` as `draw-preview.ts:214-219` calls it; `src/core/job/estimate-duration.ts`, `src/core/motion-planner/*`, `src/core/gcode-time/*`.
  - Advisories: `src/ui/laser/{scan-quality-warnings,job-intent-warnings}.ts`.
  - Governing: ADR-019, ADR-031/033/034/035, ADR-036, ADR-052 (+ Amd 1), ADR-234, ADR-236, ADR-238 Amd 2/3, ADR-239, ADR-257, ADR-432, ADR-445, ADR-495, ADR-525, ADR-626.
- **Lenses run:**
  - **L2 (ground truth):** gnea/grbl sources and docs downloaded at the pinned SHA; LightBurn 2.0 docs downloaded (cited below).
  - **L6 (failure path):** what happens when the serial link or the planner cannot keep up (starvation, stops), and where the beam stays on while the head stops.
  - **L3 (twins):** canvas Preview toolpath against the emitted G-code; Job Review time against an independent planner.
  - **L1** through the cited ADR clauses. **L7** light (test search for contour exits). L4 and L5 skipped: no untrusted input is specific to this area.
- **Counts:** 3 raised → 0 refuted (auditor 0, refuter 0) → P1 0 / P2 1 / P3 2 (+ 7 KNOWN re-observed). Refuter (2026-10-28 02:35 – 03:30 +0800): 3 CONFIRMED, no severity change. Q6-P2-1 is counted once, for the Neotronics 4040 catalogue profile; its GRBL Compatible half shares Q1-P2-1's cause and is recorded there, not counted again.

## Headline

On the default GRBL Dynamic dialect (M4) vector output burns at the dose it asks for. Traced logos, 3 mm text and 1 mm circles keep a mean line dose of 0.98–1.00, even where GRBL's junction deviation holds the head at 16–30% of the programmed feed. The serial link is never the limit: junction deviation caps the block rate at about 32 blocks/s on 0.025 mm chords, so the peak need is about 130 lines/s and 3.2 kB/s in fixed 0.1 s bins (refuter: 170 lines/s and 4.1 kB/s on a sliding 0.1 s window) against 11.5 kB/s at 115200 baud. Fill interval and angle are exact, holes follow even-odd, and the canvas Preview matches the emitted G-code to 0.0007 mm (0.011 mm with arcs).

The quality loss is where the dialect fires M3:
- **M3 Line output (P2).** The Neotronics 4040 catalogue profile (and GRBL Compatible) cut Line operations at constant power with G1 chords, a tangential entry only on the 4040, and no exit. At the default 1500 mm/min and 500 mm/s², the traced logo's 646 corners peak at a median 3.1× the line dose (p90 4.3×). Path ends reach 2.0–5.2×, and 3 mm text averages 1.54×. The same programs under M4 stay at 0.76–1.30. Nothing warns.
  - Refuter: the 4040's entry exists only when the bed position is known (Save, or a homed machine). The stock profile has homing off, so a live Start skips it (ADR-239 Amd 1, ADR-343) and every contour also starts from rest: start 3.4–3.9×. The GRBL Compatible half is Q1-P2-1's cause.

The two P3s are a one-sided fill edge (the scanline grid puts the fill half an interval off the outline on one axis) and an island-fill time estimate 64% too long.

## Scorecard

"Verdict" is the refuter's: CONFIRMED where it re-ran the row with its own planner and dose model (scratchpad `zz-q6r/`), PLAUSIBLE where it only read it. Spot-smoothed line dose = laser energy per mm of path relative to S/F, smoothed along the path with a 0.15 mm FWHM Gaussian (see Measurement method). Defaults unless stated: a = 500 mm/s², `$11` 0.01 mm, `$12` 0.002 mm, 15-block planner, F1500 (the layer default) or F6000.

| Metric | KerfDesk | Reference | Auditor reading | Verdict |
|---|---|---|---|---|
| Line segments per mm (G1, 0.025 mm chord tolerance) | circle r 0.5 / 1 / 5 / 25 mm: 3.86 / 2.56 / 1.02 / 0.46; Roboto 3 mm text 3.79, 12 mm 1.45; script 12 mm 1.67; traced logo (100 mm) 1.00 | — | — | CONFIRMED: 3.86 / 2.56 (r 0.5 / 1), text 3.79 / 1.45, logo 1.00 |
| Minimum / median segment, G1 | text 3 mm 0.013 / 0.23 mm; logo 0.033 / 0.54 mm | GRBL drops only zero-step blocks | harmless | CONFIRMED: text 0.013 / 0.230, logo 0.033 / 0.537 |
| Arc output (ADR-432) moves vs G1 moves | circle 3 vs 12–72; text 3 mm 221 vs 446; 12 mm 319 vs 684; logo 1,622 vs 2,011 (min arc move 0.0028 mm) | — | fewer moves; on only for generic profiles naming a controller | CONFIRMED: r 1 circle 3 vs 16, text 221 vs 446, logo 1,622 vs 2,011 |
| Peak line rate needed (0.1 s windows) | ≤ 120 lines/s, ≤ 3.2 kB/s (logo fill on GRBL Compatible) | 115200 baud ≈ 11.5 kB/s; KerfDesk char window 120 B against GRBL RX 128 B | ≥ 3.5× headroom | CONFIRMED with correction: fixed 0.1 s bins 130 lines/s, 3.2 kB/s; sliding 0.1 s window 170 lines/s, 4.1 kB/s (3 mm text 130 lines/s). Headroom ≥ 2.8×, not 3.5× |
| Planner starvation (time vs ideal link) | char-counted: +0.0%; ping-pong 1 ms: +0.0–0.1%; ping-pong 4 ms + 1 ms parse per block: +0.0–0.3% | — | never starves on vector work | PLAUSIBLE: link models not re-run. Refuter check: the 14 queued blocks outlast one line's transfer plus 2 ms by ≥ 33 ms on 6 programs |
| Actual vs programmed feed on the burn, G1 (arcs) | F1500: circle r 1 0.70 (0.84), r 0.5 0.53 (0.73), text 3 mm 0.62 (0.69), logo 0.85 (0.87). F6000: text 3 mm 0.16 (0.19), text 12 mm 0.27 (0.35), logo 0.30 (0.34), circle r 25 0.74 (0.88) | LightBurn 2.0: the laser may not reach the set speed | GRBL junction deviation; arcs 10–40% faster on small radii | CONFIRMED at F1500: circle r 1 0.705 (0.84), r 0.5 0.527, text 3 mm 0.622 (0.695), logo 0.850. F6000 PLAUSIBLE |
| M4 mean line dose (default dialect) | 0.98–1.00 on every cut scenario | GRBL `laser_mode.md` L39: M4 keeps energy along a cut consistent | meets | CONFIRMED: logo 0.998, 3 mm text 0.985 (arcs 0.998), circle r 1 0.986 |
| M4 spot-scale ripple (p01–p99) | 0.78–1.24; length outside ±10%: circle r 1 33% (arcs 10%), text 3 mm 35% (arcs 28%), logo 15% (arcs 12%) | GRBL `stepper.c` L958-962: PWM from the speed at each 10 ms segment end | firmware effect, not KerfDesk | PLAUSIBLE (p01–p99 not re-run; refuter range 0.52–1.61 includes path ends) |
| M4 corners (90°, 150° turns) | 0.76–1.30 within ±0.3 mm; logo median peak 1.19 (p90 1.24) | — | meets | CONFIRMED: 1.19–1.30; logo median 1.19, p90 1.24 |
| **M3 corners (4040 / GRBL Compatible), F1500** | 90°: 3.44×; 150°: 4.46×; logo 646 corners median 3.12× (p10 2.06, p90 4.25); F6000: 13.8× / 17.8× | M4 on the same program 0.76–1.30; GRBL `laser_mode.md` L34: M3 wants lead-in and lead-out | **fails** (Q6-P2-1) | CONFIRMED: 90° 3.43, star tips 4.45; logo median 3.13 (p10 2.06, p90 4.29). 2D spot model: 3.86× vs M4 1.35×. F6000 PLAUSIBLE |
| **M3 mean dose on small features, F1500** | circle r 0.5 1.90×, r 1 1.42× (4040 1.34×); text 3 mm 1.61× (4040 1.54×, 64% of length > 1.25×); logo 1.18× | 1.00 | **fails** (Q6-P2-1) | CONFIRMED: r 0.5 1.90, r 1 1.42 (4040 1.34), text 3 mm 1.61 (4040 1.54, 63% > 1.25), logo 1.18. Spot-free: equals F / mean speed |
| Path start / end, M4 | start ≤ 1.62, end ≥ 0.55 over ≈ 0.025 mm | GRBL segment-end PWM | firmware effect | CONFIRMED: start ≤ 1.61, end ≥ 0.52 |
| **Path start / end, M3** | GRBL Compatible: start 3.3–3.9×, end 2.2–5.2×. 4040: start 1.00 (ADR-239 entry), end 2.0–5.2× | — | **fails** at ends (Q6-P2-1) | CONFIRMED with correction: 4040 start 1.00 only with a known bed position (Save, or homing on). Stock 4040 live Start: 3.39–3.88. 4040 ends 1.6–5.3 |
| Seam of a closed path | end = start (0.000 mm gap or overlap) in G1 and G2/G3; overcut adds exactly its length (1 mm → +1.0 mm per shape) | — | meets | PLAUSIBLE (square seam closes in the bytes; overcut not re-run) |
| Leads (ADR-626) | tangent at the join (arc lead ends heading along the cut; lead-out leaves along it); `auto` puts the square's leads outside; the part's seam is crossed at speed | ADR-626 Decision 2 | meets | PLAUSIBLE (read; off by default, `layer.ts:78-86`) |
| Fill line interval | 0.1 → 0.1000 exact (200 rows / 20 mm); 0.08 → 0.0800 exact; 0.15 at 30° → 0.1495–0.1507; 45° → 0.0990–0.1012 | request | meets (3-decimal rounding) | CONFIRMED: row midpoints 0.1000, 0.3000, 0.1500 at 30°, 0.1000 at 45° |
| Fill angle | 0°, 45°, 90° exact; 30° within 0.11° on the shortest spans | request | meets | CONFIRMED: 0°, 45°, 90° exact; 30° within 0.114° on a 0.116 mm span |
| Cross-hatch | 0° and 90° passes, 200 rows each, exact | LightBurn 2.0: a second pass rotated 90° | parity | CONFIRMED: 200 rows at 0° and 200 at 90° |
| Bidirectional fill | rows alternate 100 / 100; unidirectional 200 / 0 | LightBurn 2.0 Bi-directional Fill | parity | CONFIRMED for bidirectional (100 / 100); unidirectional PLAUSIBLE |
| Fill edge, scan ends | 50% dose exactly on the outline; 50%-darkness edge 0.05 mm outside (spot blur) on both ends | — | meets | CONFIRMED: 50% dose at X 9.997 and 30.002 |
| **Fill edge, scan-normal sides** | interval 0.1: −Y edge 0.095 mm outside, +Y edge 0.005 mm inside; 0.3: 0.07 and 0.17 mm inside (20 mm square burns 19.77 mm tall); cross-hatch 90° pass +0.05 mm in X | symmetric about the outline | one-sided (Q6-P3-1) | CONFIRMED: rows 370.0–389.9 (0.3: 370.2–389.7); 50% dose at 369.95 and 389.95, so 0.05 mm low; darkness offsets PLAUSIBLE |
| Circle fill edge (r 10, 0° and 45°) | mean edge radius 10.03; per angle 9.985–10.08 | 10.00 | meets | PLAUSIBLE |
| Holes and overlaps | ring hole dose 0.000, hole edge 0.06 mm inside the hole; two overlapping squares in one path: overlap 0.000 | even-odd (ADR-019; ADR-270 Amd 1) | meets (overlap cancel KNOWN N9) | PLAUSIBLE |
| Fill uniformity, M4 | 20 mm square F6000 with 5 mm overscan: interior 0.978–1.022 (sd 0.006); Automatic: sd 0.0004; text letters 0.973–1.027; island 0.954–1.047 | uniform | meets | CONFIRMED for the square: 5 mm 0.979–1.023 (sd 0.006); Automatic sd 0.0004. Text and island PLAUSIBLE |
| Fill overscan vs acceleration | needed `v²/2a` = 10.0 mm at F6000; default 5 mm; Automatic 11.0 mm. M4 edge band 0.938 vs 0.915 for a perfect runway | LightBurn 2.0: overscan is a percentage of speed | meets under M4 | CONFIRMED lengths (Automatic runway 11.0 mm in the bytes); edge band PLAUSIBLE |
| Fill under M3 (GRBL Compatible), F6000, 5 mm | edges +21–26% over the first mm, interior up to 1.29; text letters mean 1.12, 40% of pixels > 1.1; Automatic: 1.000 | 1.00 | runway advisory fires (KNOWN, Q1-P2-1 cause) | PLAUSIBLE |
| Fill ordering and travel | snake per scanline, bottom to top; gaps > 5 mm split with rapids. Logo fill 370 s: burn 28%, laser-off feed 65%, rapids 8% | LightBurn 2.0: scan angle 0 progresses bottom to top; Flood Fill trims blank travel | parity; time spent on runways by design | CONFIRMED order and logo fill 370.1 s; split PLAUSIBLE |
| Preview vs G-code (22 cut and fill scenarios) | same path count and order; Hausdorff ≤ 0.0007 mm (G1), ≤ 0.0106 mm (arcs, preview chords at 0.01 mm); lit length equal (G1), within 0.3% (arcs) | identical | meets | CONFIRMED on 9 scenarios: same count and order, Hausdorff ≤ 0.0006 mm (G1), ≤ 0.0105 mm (arcs) |
| Job time estimate vs independent planner | cuts +0–7%; 0° fills +2–6%; 30° hatch +12%; 45° hatch +19%; logo fill +18%; **island fill +64%** | the controller | conservative; island is new (Q6-P3-2), rest KNOWN (E6-K-1, ADR-525) | CONFIRMED: cuts +0.1–7.3%, 0° fills +5%, 30° +12%, 45° +20%, logo fill +18.3%, island +66% |
| Line Min Power | not offered for GRBL vectors | LightBurn 2.0: Min Power only for DSP lasers or Grayscale images | parity (KNOWN N7) | CONFIRMED (source fetched: LightBurn 2.0 Corner Power troubleshooting, GRBL tab) |
| Default power word | M4 for cuts and fills (ADR-257, ADR-036) | LightBurn 2.0: Variable Power (M4) by default, Constant Power optional | parity | CONFIRMED (bytes: DEF `M4`, 4040 cuts `M3`; LightBurn 2.0 Shared Settings fetched) |

### Measurement method

**Programs (real compile → emit).** Three temporary Vitest files built projects and ran `prepareOutput` → `emitPreparedGcode`, the Save/Start path. For each program they also wrote:
- `estimateJobDuration(prepared.job, device, { gcode })`, the Job Review estimate;
- `buildToolpath(prepared.job, { scanningOffsets, bedSizeMm })`, called the way `draw-preview.ts:214-219` calls it.

Devices:
- **DEF:** `DEFAULT_DEVICE_PROFILE` (GRBL Dynamic, no controller kind, so no arcs);
- **ARC:** DEF with `controllerKind: 'grbl-v1.1'`, which turns arcs on (generic vendor);
- **CMP:** DEF with `grbl-v1.1` and `grbl-compatible`;
- **N40:** `NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE`, dialect `neotronics-4040-safe`.

Every profile uses a = 500 mm/s², `$11` = 0.01 mm, max feed 6000 mm/min (`device-profile.ts:379-415`).

Geometry:
- circles r 0.5, 1, 2.5, 5, 10, 25 mm drawn as 4 cubics;
- Roboto "B8OQRS@%&" at 3 and 12 mm, and Pacifico "Wedding Café" at 12 mm, from `textToPolylines`, placed in an imported SVG;
- a 20 mm square, a 10-point star (r 15 and 5), an open zigzag and an open line;
- the Arch House logo traced with Line Art at 100 mm, as `arch-house-laser-arcs.test.ts` does;
- fills: square, square with a hole, two overlapping squares, a circle at 0° and 45°, "B8O", cross-hatch, intervals 0.08 and 0.3 mm, 0.15 mm at 30°, unidirectional, island style, a scan-offset table, and Automatic overscan.

**Independent simulator** (`sim.mjs`, imports nothing from KerfDesk; written from gnea/grbl @ `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e`):
- **Parser:** G0–G3, X/Y/I/J/F/S, M3/M4/M5 (a state change drains the planner even in laser mode, `gcode.c` L941-947, `spindle_control.c` L277-282). Full-line comments are not sent; trailing comments are, as `streamer.ts:140-151` sends them.
- **Arcs:** `mc_arc` chords, `floor(|½·θ·r| / √($12·(2r − $12)))` (`motion_control.c` L109-110).
- **Planner:** a ring of 15 blocks including the executing one (`planner.h` L27-31, `plan_check_full_buffer` L250-254).
  - A block added to an empty ring starts from rest (`planner.c` L399-404).
  - The newest block is planned to stop (L141-142).
  - Junction speed is `√(a_j·$11·sinθ/2 / (1 − sinθ/2))`; collinear is unlimited and reversal is 0 (L430-451).
  - Acceleration and rapid rate are limited per axis (`limit_value_by_axis_maximum`, L388).
  - Entry is capped by both neighbours' nominal speeds (L274-280).
  - Motion is integrated at 0.1 ms; reverse and forward passes re-run on every insert.
- **Link:**
  - Wire at 115200 baud, 8N1.
  - `char`: KerfDesk's 120-byte window (`grbl-streaming.ts:1`).
  - `pingpong`: one line in flight (`controller-streaming-mode.ts`, the FluidNC policy).
  - The `ok` is 4 bytes plus a one-way USB latency of 1 ms (stress case: 4 ms, plus 1 ms CPU per planner block).
- **Laser:** GRBL step segments of at most 10 ms (`DT_SEGMENT`, `stepper.c` L26; `ACCELERATION_TICKS_PER_SECOND` 100, `config.h` L297), cut at block ends.
  - M4: S × speed-at-segment-end / F (`stepper.c` L742-747, L958-962).
  - M3: S, updated at every block change (L845).
  - G0 and S0 blocks are dark.
- **Line dose:** energy is binned every 0.005 mm of burn path and divided by S/F. It is smoothed along each continuous lit path with a 0.15 mm FWHM Gaussian (wrapping closed loops), normalised by the in-path kernel weight so that path ends read the motion effect, not the spot's falloff.
- **Fill bitmap:** energy is deposited bilinearly on a 0.02 mm grid, scaled so a nominal fill at the layer interval reads 1, then blurred with the same spot. Darkness is `1 − exp(−D·ln 20)`, as in Q1. The edge is where darkness falls to half the interior's.

**Sources** (downloaded 2026-10-28; quotes are paraphrased unless in quotation marks):
- gnea/grbl @ `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e`: `grbl/planner.c`, `planner.h`, `stepper.c`, `motion_control.c`, `gcode.c`, `spindle_control.c`, `serial.h`, `config.h`, `defaults.h`, `doc/markdown/laser_mode.md`, `doc/markdown/interface.md` (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/planner.c and siblings). `defaults.h` L51-52: `$11` 0.01 mm, `$12` 0.002 mm. `serial.h` L26-27: RX buffer 128 bytes; `interface.md` L31 and L39 describe send-response and character counting against it.
- LightBurn 2.0 docs: https://docs.lightburnsoftware.com/2.0/Reference/CutSettingsEditor/SharedSettings/ (Speed note, Min Power, Constant Power Mode), https://docs.lightburnsoftware.com/2.0/Reference/CutSettingsEditor/FillMode/ (Bi-directional Fill, Cross-Hatch, Overscanning, Scan Angle, Flood Fill), https://docs.lightburnsoftware.com/2.0/Explainers/Overscanning/ and https://docs.lightburnsoftware.com/2.0/Guides/ScanningOffsetAdjustment/. Live versioned pages, not archived.

**Sanity checks.** A 50 mm line at F1500 from rest takes 2.050 s (analytic 2.05 s). KerfDesk's estimate matches the model to 0–1% on circles and exactly (1.000) on the 4040 fills, which have no G0. The model's dose numbers depend on the stated spot and PWM model; the speed, block-rate and geometry numbers do not.

**Temporary files** (all deleted after the run; rebuild from the description above):
- `src/io/gcode/zz-q6-gen.test.ts`: circles, text, corners, leads and overcut, fills on DEF, ARC, CMP and N40. It exports `circle`, `poly`, `projectWith`, `curvesPath` and `dump`.
- `src/io/gcode/zz-q6-logo.test.ts`: the traced logo, as Line on the four devices at F1500 and F6000, and as Fill on DEF and CMP.
- `src/io/gcode/zz-q6-gen2.test.ts`: text fill on CMP (5 mm and Automatic), a scan-offset table `{6000 mm/min: 0.1 mm}`, island fill, a 0.3 mm interval, Fill and Line layers on one square, and unshifted text fills used as the bitmap mask.
- Command: `node ../../../node_modules/vitest/vitest.mjs run src/io/gcode/zz-q6-<name>.test.ts`.

Scratchpad (kept): `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-q6\`, holding:
- `sim.mjs`, `analyze.mjs` (line dose, ends, corners), `batch.mjs`, `fillsim.mjs`, `fillstats.mjs`, `shapes.mjs`, `island.mjs`, `hatch.mjs` (interval and angle from the G-code), `twin.mjs` (Preview vs G-code), `times.mjs`, `breakdown.mjs`, `rate.mjs` (peak rates, link models), `leadprobe.mjs` (dose at the lead joins);
- `grbl-src\` (pinned GRBL files), `lb\` (LightBurn pages), `out\` (programs, estimates, Preview toolpaths).

Refuter (kept in scratchpad `zz-q6r\`):
- **Pinned sources.** It re-fetched the gnea/grbl files at `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e` into `grbl\`; all 10 are byte-identical to the auditor's copies. It also fetched the LightBurn 2.0 Shared Settings, Line Mode and Corner Power pages into `lb\`.
- **Its own scripts.** It shares no code with the auditor's:
  - `plan.mjs`: a GRBL parser, a 15-block or unlimited planner, and M3 / M4 dose at 10 ms segment-end PWM;
  - `analyze.mjs`, `rate.mjs`, `twin.mjs`, `hatch.mjs`, `fill2d.mjs`, `corner2d.mjs`.
- **Its own programs.** Temporary repo tests `src/io/gcode/zz-q6r-gen.test.ts` and `zz-q6r-logo.test.ts` (both deleted) wrote programs to `out\` through `prepareOutput` → `emitPreparedGcode`, with `estimateJobDuration` and `buildToolpath`.

## Findings

### Q6-P2-1 — M3 Line output (Neotronics 4040 catalogue profile, GRBL Compatible) over-burns every corner and path end 2–5× at default settings, with no exit runway and no advice

- **Where:**
  - `src/core/devices/gcode-dialects.ts:109-115` and `:142-145`: `grbl-compatible` and `neotronics-4040-safe` set `cutPowerMode: 'constant'`. The 4040 dialect is the catalogue profile's (`device-profile.ts` `NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE`, `gcodeDialect: 'neotronics-4040-safe'`).
  - `src/core/output/grbl-power-modes.ts:23-30`: Line groups get M3 from the dialect.
  - `src/core/output/grbl-strategy.ts:138-157, 215-247`: the 4040 gets the ADR-239 tangential entry. After the last burn point nothing is written; the next line is the laser-off travel, so the head decelerates to the travel junction at full power.
  - `src/core/devices/laser-arc-moves.ts:28-33`: the 4040 dialect never gets arcs, and `:37-41`: GRBL Compatible has them off by default. Small curves stay as 0.025 mm-tolerance G1 chords, which junction deviation slows further.
  - `src/ui/laser/job-intent-warnings.ts:255-282` names M3 only for traced Line output, and only as "can cut if power/speed are too aggressive". `scan-quality-warnings.ts` covers Fill and Image only.
- **Anchor:**
  - **Ground truth**, gnea/grbl @ `bfb67f0` `doc/markdown/laser_mode.md`:
    - L32: M3 holds the programmed power whether the machine moves, accelerates or stops (paraphrased).
    - L34, verbatim in part: "add lead-in and lead-out motions around the line you want to cut". GRBL gives this to prevent scorching under M3.
    - `planner.c` L430-451: junction speed at a 90° corner with `$11` 0.01 and 500 mm/s² is 3.47 mm/s, so a 25 mm/s cut slows about 7× there.
  - **Contract:**
    - ADR-257 Context (DECISIONS.md L13063-13066) states the rule that M3 without a runway is "exactly the configuration GRBL says will scorch". Its Decision (L13077-13083) keeps both dialects on M3 and defers the 4040 to "its own hardware pass". It adds no runway or advice for them.
    - ADR-239 (DECISIONS.md L11463-11535) gives the 4040 contour an entry only. Its Context names the powered start as the 4040's uneven-burn mechanism; the mirrored powered end is not addressed.
  - **Twin:** the Preview draws a uniform line, and Job Review shows the programmed speed.
- **Scenario:** A 4040 owner on the catalogue profile scores a traced logo, or small text, with a Line operation at the default 1500 mm/min.
  - Every corner and the end of every contour burn darker blobs, and 3 mm lettering burns about 1.5× darker than larger lines on the same layer.
  - The Preview, Job Review and the advisories say nothing.
  - On GRBL Compatible (required for GRBL ≤ 1.1e, ADR-257), the starts blob too, because there is no entry.
- **Evidence:** REPRO (emitted bytes through the independent planner and laser model above).
  - Corner and end peaks (spot-smoothed line dose; M4 = the same geometry on GRBL Dynamic):

    | Program, F1500, a = 500 | 90° corner | 150° turn | Path start | Path end | Mean |
    |---|---|---|---|---|---|
    | 4040, square / star / zigzag / line | 3.44 | 4.46 | 1.00 | 2.02–5.18 | 1.05 |
    | GRBL Compatible, same | 3.44 | 4.46 | 3.34–3.85 | 2.20–5.18 | 1.05 |
    | GRBL Dynamic (M4), same | 0.76–1.30 | 0.76–1.29 | ≤ 1.62 | ≥ 0.56 | 1.00 |

  - Traced logo, 4040, F1500: 646 junctions turning ≥ 30°.
    - Peaks: median 3.12×, p10 2.06×, p90 4.25×.
    - Mean 1.17×; 15.7% of the path is over 1.25×.
    - M4 on the same logo: median peak 1.19×, mean 1.00.
  - Small features under M3 at F1500 (mean dose; share of the path over 1.25×):

    | Feature | 4040 | GRBL Compatible |
    |---|---|---|
    | 3 mm text | 1.54×; 64% | 1.61× |
    | Circle r 1 mm | 1.34× | 1.42× |
    | Circle r 0.5 mm | — | 1.90× |
    | 12 mm text | 1.11× | 1.13× |

    At F6000 these become 6.1× (3 mm text) and 3.2× (logo), with 90° corners at 13.8×.
  - Sensitivity to the machine's real `$120` (4040, F1500):
    - a = 1000: 90° corner 2.44×, 3 mm text mean 1.20×, logo max 3.58×;
    - a = 2000: 90° corner 1.73×, 3 mm text mean 1.07×, logo max 2.54×.
  - Exit-runway check: a copy of the 4040 corner program with a 5 mm tangential `G1 … F1500 S0` after each contour brings every open-path end from 2.02–5.18 to 1.00. Corners are unchanged (3.44); only M4 or a lower speed removes those.
- **Novelty:**
  - Q1-P2-1 raised the GRBL Compatible M3 cause for rasters (look-ahead slowdown in dithered rows). This finding is the vector consequence: corners, ends and small curves under junction-deviation slowdown, and it adds the 4040 catalogue profile, whose rasters and fills are M4 and so outside Q1-P2-1.
  - The 2026-07-10 full sweep noted M3 "corner dwell" when every dialect cut with M3; ADR-257 fixed the default dialect only.
  - No test covers a contour exit (`git grep` for exit runways in `src/core/output` and `src/core/job` finds none).
- **Auditor's open point:** whether the 1.5× whole-feature dose on 3 mm text (not only corners) meets the P1 tone test ("burn differs in tone from what the app shows, with no warning"). It is rated P2 here because the AREAS examples place corner blobs at P2, and ADR-257 records M3 for these dialects as deliberate.
- **Fix direction:** mirror ADR-239 with a feed-matched laser-off exit runway on M3 contours, which removes the end blobs. Add a Job Review advisory for M3 Line operations that states the corner speed drop at the saved acceleration and suggests M4 (layer override, ADR-190) or a lower speed. Run the 4040 hardware pass ADR-257 deferred.
- **Refuter verdict: CONFIRMED, P2 (unchanged). Counted for the 4040 only.**
  - **What would make it false, and what was checked:**
    - *Not M3 on the 4040.* False. The emitted bytes for a square on the catalogue profile are `M3 S0` … `G1 X30.000 Y390.000 F1500 S300` … `M5`, with no move after the last burn.
    - *A deliberate, decided exit.* No. ADR-239 (DECISIONS.md L11463-11535) decides an entry only. Its Decision and Consequences never mention the contour end.
      - ADR-257 Decision keeps both dialects on M3, the 4040 pending "its own hardware pass". Its Alternatives defer lead-in/lead-out "for now" for the default dialect only.
      - ADR-398 Decision 1 accepts the lit job-end drain (`M5` after the last burn) as "inherent to M3". An exit move would make that drain dark too.
      - Laser leads (ADR-626) would move the blobs off the part, but they are off by default (`layer.ts:78-86`).
    - *A warning exists.* None names corners, ends or dose under M3. Checked:
      - `job-intent-warnings.ts:255-275`: traced Line output only;
      - `scan-quality-warnings.ts`: Fill and Image only;
      - `CutPowerModeField.tsx`: a tooltip, "Constant emits M3";
      - no power-word fact in `src/ui/laser/job-review` (`grblPowerModeWordsForJob` has no UI consumer).
      - The only related fact is the skipped-entry line below. It names the start mechanism, not the over-burn.
    - *A model artefact.* No.
      - **Corner speed.** The refuter re-derived it from `planner.c` L430-451 and `limit_value_by_axis_maximum`.
      - **Independent model.** The refuter wrote its own planner and dose model (`zz-q6r/plan.mjs`). It imports nothing from KerfDesk or the auditor and runs on the refuter's own compile → emit (`zz-q6r-gen`, `zz-q6r-logo`). Its logo motion bytes are identical to the auditor's.
      - **Timing check.** A 50 mm line takes 2.050 s.
      - **Results.**
        - Square 90° corner: 3.43×. Star tip: 4.45×.
        - Logo, 4040: 646 corners, median 3.13×, p10 2.06×, p90 4.29×. Mean 1.168×; 15.5% of the path is over 1.25×.
        - 3 mm text: 1.536× (4040) and 1.609× (GRBL Compatible); 63% of the 4040 path is over 1.25×.
        - Circle r 1: 1.336× (4040) and 1.418× (GRBL Compatible). Circle r 0.5: 1.899× (GRBL Compatible).
        - The same motion under M4: corners 1.19–1.30×, means 0.985–1.00.
      - **Without the spot.** The mean M3 dose is simply F divided by the mean speed (3 mm text runs at 0.622 of F), so the means do not depend on the spot model.
      - **2D spot check.** A 2D Gaussian spot model with no path smoothing gives the square's corners 3.86× the mid-edge dose under M3, against 1.35× under M4.
      - **Acceleration.** At a = 1000 the 90° corner is 2.43× and 3 mm text 1.195×; at a = 2000 they are 1.72× and 1.07×. The logo peak is still 2.5×.
      - **Exit runway.** The refuter added its own 5 mm exit to the 4040 programs. Simple-shape ends go to 1.00, but 3 mm text only drops from 1.54× to 1.49×: the whole-feature dose comes from junction slowdown, not from the ends.
  - **Corrections:**
    - **4040 start.** The 4040's "start 1.00" holds only when the bed position is known: Save (Absolute), or a homed machine.
      - The catalogue profile inherits `homing.enabled: false`, so `resolveNativeBedFrame` returns null (`native-bed-frame.ts:101`). Live Start then sets `contourEntryBounds: null` (`job-placement.ts:206`) and the entry is skipped (ADR-239 Amd 1, ADR-343).
      - Refuter repro with `contourEntryBounds: null`: square start 3.39×, star 3.88×, 3 mm text 1.67–4.94×. That matches GRBL Compatible.
      - Job Review then shows, in warning tone, "Not added · … each contour starts burning from rest" (`job-review-contour-entry-facts.ts:43-45`). It says nothing about dose, corners or ends.
    - **90° junction speed.** The anchor's 3.47 mm/s applies only when the corner's bisector lies on an axis. An axis-aligned square's junction vector is diagonal, so GRBL allows 500 × √2 mm/s² and 4.13 mm/s, a 6.0× slowdown. The auditor's dose numbers already used the per-axis rule.
    - **4040 path ends.** They span 1.6–5.3× in the refuter's runs; the logo's lowest end is 1.61×.
  - **De-duplication with Q1-P2-1.**
    - **GRBL Compatible half: same cause.** The dialect deliberately runs M3 with no advice. Q1-P2-1's advisory fix should cover Line output, so that half is recorded under Q1-P2-1 and not counted here.
    - **4040 half: a separate cause.** The catalogue profile's M3 cut default (ADR-257 deferral), ADR-239's entry-only runway, and the entry skipped on every live stock job. The 4040's rasters and fills are M4, so Q1-P2-1 does not reach it.
  - **Severity: P2, not P1.**
    - **Why not P1.** The quality P1 test needs a burn that differs from what the app shows or promises.
      - A Line operation shows no tone. The Preview draws the toolpath in the layer colour, and `draw-preview.ts` has no power-to-tone mapping.
      - The power delivered is the power the app states: the layer's S held constant, as the dialect description and the power-mode tooltip ("Constant emits M3") say.
      - The over-dose is GRBL's documented M3 behaviour (`laser_mode.md` L32). ADR-257 names this risk and keeps M3 on both dialects.
      - Q1-P2-1 rose to P1 because the raster Preview shows a grey tone and the burn is darker than that tone. Line output has no shown tone to contradict.
    - **Why P2 holds.** The whole-feature 1.5× on 3 mm text is the same junction mechanism summed over a feature that is almost all junctions. It is a visible quality defect against the reference: darker small lettering, corner blobs and end blobs.
      - LightBurn 2.0 recommends M4 for GRBL. Its Shared Settings page says "It's generally best to stick with the default of Variable Power mode" (https://docs.lightburnsoftware.com/2.0/Reference/CutSettingsEditor/SharedSettings/, fetched 2026-10-28). Constant Power is an opt-in for LaserGRBL-style behaviour.
      - LightBurn's leads are optional (2.0 Line Mode). Its 2.0 Corner Power troubleshooting page (https://docs.lightburnsoftware.com/2.0/Troubleshooting/JobQuality/CornerPower/) gives no M3-specific corner advice for GRBL. Its GRBL advice covers under-powered corners at low acceleration.
      - The 4040 profile names GRBL 1.1 (`controllerKind: 'grbl-v1.1'`), so the reference default for it is M4.

### Q6-P3-1 — Scanline fill rows sit on a global grid with a half-open boundary, so the fill is offset from the outline by up to one interval on the scan-normal axis

- **Where:** `src/core/job/fill-hatching.ts:133` (`yStart = ceil(minY / spacing) · spacing`) and `:138-139` (the last row must be below `maxY − 1e-6`, half-open).
- **Anchor:** Twin. A Line outline of the same shape is emitted on the outline (`Fill + Line` layers, as traced Line + Fill output uses, ADR-454). The Fill coverage is centred on the outline along the scan, but not across it.
- **Scenario:** A 20 × 20 mm square on whole-millimetre coordinates, at the default 0.1 mm interval.
  - Rows land at 370.0 … 389.9 mm (machine Y). The bottom row sits on the edge, and no row sits on the top edge.
  - The burn's −Y edge is 0.095 mm outside the outline and its +Y edge 0.005 mm inside. Along the scan both ends are 0.05 mm outside (spot blur), so the fill is shifted half an interval toward −Y against its own outline.
  - At 0.3 mm the rows are 370.2 … 389.7. Both edges fall inside (0.07 and 0.17 mm), and the square burns 19.77 mm tall.
  - The 90° cross-hatch pass shifts +0.05 mm in X.
  - The Preview shows the same rows, so this is visible before the burn, but only as hatch lines.
- **Evidence:** REPRO. Bitmap edges from `fillstats.mjs` on `fill-sq-DEF-f6000` and `fill-sp03-DEF-f6000`; row offsets from `hatch.mjs` (`firstOff 370.0000 lastOff 389.9000`; for 0.3 mm, `370.2000 / 389.7000`).
- **Novelty:** the root (the global grid) is KNOWN as BQ-15 / F12 (thin features between grid lines vanish). The one-sided edge offset and the shortened coarse fill are new symptoms. The grid itself is a deliberate seam-avoidance choice (`fill-hatching.ts:130-132`).
- **Reference:** LightBurn's row phase is not documented in the pages fetched (UNVERIFIED).
- **Fix direction:** keep the shared grid but phase it at `(k + ½)·interval`, so a shape on whole-interval coordinates gets symmetric coverage. Alternatively, include a row that lands within `interval/2` of the top edge. Pin the edge positions in a fill test.
- **Refuter verdict: CONFIRMED, P3 (unchanged).**
  - **What would make it false:**
    - a decided row phase: no ADR decides it, only the code comment `fill-hatching.ts:130-132`;
    - or the rows not being where the report says.
  - **Rows.** The refuter's own compile → emit puts rows at 370.000 … 389.900 (200 rows), and at 370.2 … 389.7 for 0.3 mm. The 90° cross-hatch pass runs −30.0 … −10.1 on its own axis.
  - **Dose model.** The refuter's 2D dose model (`zz-q6r/fill2d.mjs`, M4, 0.15 mm spot) puts the 50% dose level at Y 369.95 and 389.95, against an outline at 370 and 390. Along the scan it is at X 9.997 and 30.002. So the coverage is shifted 0.05 mm (half an interval) toward −Y, while the scan ends sit on the outline.
  - **Darkness edges.** The auditor's 0.095 / 0.005 mm edges come from its darkness transform and were not re-run. The one-interval asymmetry is the same under either metric.
  - **Why P3, not higher.** The shift equals ½ interval. That is the ±½-cell tolerance the Q2 scorecard uses for raster position, and the Preview shows the same rows.

### Q6-P3-2 — The Job Review estimate prices a full stop at both ends of every Island Fill burn, so island fills read 64% longer than GRBL runs them

- **Where:**
  - `src/core/motion-planner/junction.ts:11-15`: any rapid↔feed junction is a stop.
  - Island Fill on non-4040 profiles has no feed-matched runway policy (`layer-fill.ts:62,80`), so its sweeps take the legacy plan with `runwayMotion: 'rapid'` (`fill-sweep-plan.ts:73-74, 103-116`) and runways capped at half the burn (`fill-overscan.ts:99-107`, ADR-033 Decision 1). They are written as `G0` collinear with the burn (`grbl-fill-emission.ts:113`). Bytes: `G0 X9.167 Y391.300 S0` / `G1X10.537Y391.3F6000S300` / `G0 X11.222 Y391.300 S0`.
- **Anchor:**
  - **Twin:** ADR-525 says the estimate models the controller's planner.
  - **Contract:** ADR-033 Decision 1 (DECISIONS.md L1790-1792) states that GRBL "still decelerates to the burn feed by `burnStart` across the collinear junction". That means no stop, and `planner.c` L430-451 has no rapid/feed distinction.
  - ADR-525 Consequences accepted the stop as the source of a 1.5–4.2% excess on rasters. On island fill it is not second order.
- **Scenario:** "B8O" at 12 mm, Island Fill, F6000, Default 400×400.
  - Job Review: 135.4 s (cut 38.3 s). Independent planner: 82.5 s (burn 12.8 s).
  - Scanline fill of the same text: 54.2 s against 51.5 s (+5%).
- **Evidence:** REPRO (`times.mjs`, `breakdown.mjs`).
- **Severity:** P3. The estimate is long, not short, and it changes no output.
- **Fix direction:** let a collinear G0↔G1 junction carry speed in `junctionVelocity`, as it already does for feed-matched `G1 S0` runways (`junction.ts:12-15, 36-41`). Alternatively, emit island runways as `G1 … S0` at feed, as Scan Line does.
- **Refuter verdict: CONFIRMED, P3 (unchanged).**
  - **What would make it false:**
    - GRBL stopping at a G0↔G1 junction. It does not: `planner.c` L274-280 and L430-451 cap a collinear junction only by the two nominal speeds;
    - or the stop being a decided rule. It is a deliberate conservative rule (`junction.ts:11-13`; ADR-525 Consequences), which is why this stays P3 (an improvement).
  - **Bytes.** The refuter's own Island Fill program writes the capped runways as collinear `G0`: `G0 X10.000 Y271.400 S0` / `G1X13.518Y271.4F6000S300` / `G0 X15.277 Y271.400 S0`.
  - **Island Fill.** Job Review gives 132.8 s (cut 38.3 s). The refuter's planner gives 79.9 s (burn 12.8 s), +66%, with the same result at a 15-block or unlimited look-ahead.
  - **Scanline fill of the same text.** 52.2 s against 49.5 s (+5%).
  - The refuter's text sits at a different bed position from the auditor's, so the totals differ by 2–3 s. The cut and burn figures match the auditor's exactly.

## KNOWN re-observed

- **Q6-K1 (Q1-P2-1), GRBL Compatible fills run M3.**
  - F6000 with the default 5 mm overscan (10.0 mm needed): the first mm of every row reads 1.21–1.26, and the interior reaches 1.29.
  - "B8O": 40% of letter pixels are over 1.1, max 1.39.
  - Automatic overscan (ADR-495) gives 1.000. The runway advisory (`scan-quality-warnings.ts:48-71`) fires, so fills are advised. Cuts are not (Q6-P2-1).
- **Q6-K2 (controller v4 E6-K-1 / PV-1 / rolling-v2 18 K-2), one scalar acceleration and max rate.** GRBL gives a diagonal a√2. New sizes for fills: 30° hatch +12%, 45° hatch +19% (106.0 s against 89.0 s for the same circle that takes 105.7 s against 99.2 s at 0°).
- **Q6-K3 (ADR-525 Consequences, decided), the G0↔G1 stop.**
  - Traced logo fill +18% (437.8 s against 370.2 s).
  - Cut programs +0–7%: text +6–7%, logo +3.8% at F1500 and +6.6% at F6000. The 4040 has no G0: +0.2–0.9% on cuts, exact on fills.
- **Q6-K4 (BQ-21 / register H1; ADR-052), scan-offset sign.**
  - A table value of +0.1 mm at F6000 moves reverse rows along their own travel: `G1X9.9Y370.1` where the forward row is `X10…X30`.
  - LightBurn 2.0 (Scanning Offset Adjustment) has the user enter half the measured separation and moves each line.
  - KerfDesk moves only reverse rows, by the full value (ADR-052).
  - The Preview carries the same shift (twin exact). The physical sign is still hardware-pending.
- **Q6-K5 (N9; ADR-019, ADR-270 Amd 1), even-odd cancels a same-path overlap.** Re-measured: overlap dose 0.000, each square alone 0.999.
- **Q6-K6 (N7), no Min Power for GRBL vectors.** Parity: LightBurn 2.0 Shared Settings shows Min Power "only shown when you're using a DSP laser" or for Grayscale images (https://docs.lightburnsoftware.com/2.0/Reference/CutSettingsEditor/SharedSettings/, fetched 2026-10-28).
- **Q6-K7 (BQ-15 / F12), thin features between grid rows vanish.** Same root as Q6-P3-1; not re-measured.

## Refuted

- **"Dense traced or text polylines starve GRBL over 115200 baud."**
  - With 0.025 mm chords, junction deviation sets the speed, so the block rate needed is about `√(a·$11/8) / chord sag` ≈ 32 blocks/s at a = 500.
  - The measured peak is 120 lines/s and 3.2 kB/s, against 11.5 kB/s. Refuter: fixed 0.1 s bins give 130 lines/s and 3.2 kB/s (logo fill, GRBL Compatible); a sliding 0.1 s window gives 170 lines/s and 4.1 kB/s. That is still ≥ 2.8× headroom, so this stays refuted.
  - Ping-pong at 4 ms latency plus 1 ms CPU per block adds ≤ 0.3% time.
- **"M4 lines burn unevenly where the head slows."** The mean is 0.98–1.00 at 16–30% of the programmed feed. The ±20% spot-scale ripple comes from GRBL's segment-end PWM update (`stepper.c` L958-962) and applies to any sender. Arcs reduce it (circle r 1: 33% → 10% of length outside ±10%).
- **"The default 5 mm fill overscan darkens fill edges at F6000."** Not under M4. The edge band is 0.938, against 0.915 for a full-speed entry; the difference is the GRBL segment effect.
- **"Closed contours leave a seam gap or overlap."** The last point equals the first in G1 and arc output. Under M4 the seam reads 0.77–1.26, the same as any junction.
- **"Preview fill lines or cut order differ from the G-code."** Same path count and start order in all 22 scenarios; Hausdorff ≤ 0.0007 mm (0.011 mm with arcs).
- **"Fill interval drifts at angles."** The worst row gap is 0.0007 mm off at 30°, from 3-decimal rounding.

## Verified clean

- **Power words.** M4 for cuts, fills and images on GRBL Dynamic and GRBL Raster. On the 4040: cuts M3, fills and images M4. GRBL Compatible: M3 throughout (`gcode-dialects.ts`, bytes). A per-layer override wins (`grbl-power-modes.ts:23-30`).
- **Arcs.**
  - On for a generic profile naming GRBL 1.1, grblHAL or FluidNC.
  - Off for the built-in Default 400×400, brand profiles, GRBL Compatible and the 4040 (ADR-432 Decision 3).
  - Where on, they cut moves by 19–96%, raise small-radius speed 10–40%, and execute within 0.0106 mm of the Preview.
  - `G17` is in the preamble when arcs are written.
- **Planner and look-ahead.** Junction deviation, not the 15-block ring, sets the vector slowdown: a 100-block ring changes the simulated burn time by 0% on the G1 programs and by at most 0.9% on the arc programs (traced logo at F6000: 59.80 s against 59.28 s). KerfDesk's estimate models both (ADR-525) and matches the independent model to 0–1% on circles.
- **Fill runways.**
  - Generic Scan Line gets a feed-matched `G1 S0` runway of the full Overscan at both ends of every sweep.
  - Split gaps up to 2 × Overscan share one meeting point crossed at feed; wider gaps get a rapid (ADR-238 Amd 2, ADR-445).
  - The 4040 is unidirectional without verified offsets, at 5.4× the generic time (580.7 s against 108 s), by its policy.
  - Automatic overscan is `v²/2a × 1.1` (11.0 mm at F6000).
- **Leads.** Arc leads join tangentially at both ends. `auto` puts an outer contour's leads outside. With leads, the M3 start and end blobs move onto the leads: the part's seam reads 1.000 within 0.3 mm on the 4040 and on GRBL Dynamic (`leadprobe.mjs`).
- **Fill topology.** Even-odd for pooled layers (`fill-rule.ts:5-13`); the ring's hole burns 0.000.

## Not verified

- **No burn.** Nothing was engraved and no controller ran. Dose numbers depend on a linear power model, a 0.15 mm Gaussian spot and GRBL's 10 ms segment rule. Diode thresholds, `$31`, heat and char are not modelled.
  - Under M4 the apex of a 90° corner at F1500 and 30% runs at 4.2% PWM, and a 150° star tip at 1.6%. Real diodes may not fire there (LightBurn's "Corners Are Too Dark, Too Light, Or Missing" troubleshooting covers this).
- **8-bit GRBL CPU time.** Not measured. `mc_arc` at `$12` 0.002 mm feeds the planner about 395 chords/s on small radii without serial traffic; whether an ATmega328p keeps up was not checked. The link stress used 1 ms per block.
- **Other firmware.** FluidNC and grblHAL builds with other planner sizes, and Marlin and Smoothieware vector output, were not run.
- **LightBurn.** Not verified:
  - its fill row phase;
  - its GRBL-M3 device's corner behaviour;
  - whether it writes G2/G3 for GRBL.
- **Hatch angle and origin corner.** The hatch angle is applied in machine coordinates. Whether a given angle looks the same on screen for a rear-left or right origin as for front-left was not checked.
- **Island Fill under M3.** Runways are capped at half the burn (`fill-overscan.ts:107`), while the runway advisory reports "at most" the full Overscan. Not measured.
- **Other fill modes.** Offset (Follow Shape) fill, multi-pass `passAngleStepDeg` and tabs were not run.

```json
[
  {"id":"Q6-P2-1","severity":"P2","area":"vector-burn-quality","file":"src/core/devices/gcode-dialects.ts","line":145,"anchor":"Ground truth: gnea/grbl@bfb67f0 laser_mode.md L32/L34 (M3 holds power; lead-in and lead-out to prevent scorching), planner.c L430-451 (junction speed); Contract: ADR-257 Context L13063-13066 and Decision L13077-13083 (keeps both dialects on M3, deferred 4040 hardware pass), ADR-239 (entry only); Twin: Preview uniform line","evidence":"REPRO","verdict":"CONFIRMED","known":"cause of the GRBL Compatible half is Q1-P2-1 (recorded there, not counted here); the 4040 catalogue profile (M3 cuts, entry-only runway, entry skipped on live stock jobs) is new","summary":"M3 Line output on the Neotronics 4040 catalogue profile and GRBL Compatible: at default F1500/500 mm/s2, 90-degree corners peak 3.44x spot-smoothed line dose, 150-degree turns 4.46x, traced-logo corners median 3.12x (p90 4.25x), path ends 2.0-5.2x (4040 starts 1.00 via ADR-239 entry, no exit), 3 mm text 1.54x mean; M4 on the same programs 0.76-1.30; no advisory; a 5 mm laser-off exit runway brings ends to 1.00. Refuter: own planner/dose model reproduces (90-degree 3.43x, logo median 3.13x, 3 mm text 1.536x 4040 / 1.609x GRBL Compatible, 2D spot 3.86x vs M4 1.35x); stock 4040 live Start skips the ADR-239 entry (homing off, contourEntryBounds null) so starts are 3.39-3.88x too; counted for the 4040 only; P2 kept (Line output shows no tone; delivered power is the stated constant S)"},
  {"id":"Q6-P3-1","severity":"P3","area":"vector-burn-quality","file":"src/core/job/fill-hatching.ts","line":133,"anchor":"Twin: Line outline of the same shape (Fill + Line, ADR-454) is on the outline; Fill coverage centred along the scan but not across it","evidence":"REPRO","verdict":"CONFIRMED","known":"root shared with BQ-15 / F12 (global grid; thin features vanish)","summary":"Scanline rows on a global multiple-of-interval grid with a half-open top: a 20 mm square at 0.1 mm burns 0.095 mm outside its -Y edge and 0.005 mm inside its +Y edge (half an interval off); at 0.3 mm both edges fall inside (0.07/0.17 mm), 19.77 mm tall; the 90-degree cross-hatch pass shifts +0.05 mm in X. Refuter: rows 370.000-389.900 (0.3 mm: 370.2-389.7); 2D 50% dose level at Y 369.95 / 389.95 vs X 9.997 / 30.002"},
  {"id":"Q6-P3-2","severity":"P3","area":"vector-burn-quality","file":"src/core/motion-planner/junction.ts","line":14,"anchor":"Twin: ADR-525 estimate models the controller planner; Contract: ADR-033 Decision 1 (GRBL carries feed across the collinear G0 runway); Ground truth: planner.c L430-451 has no rapid/feed junction rule","evidence":"REPRO","verdict":"CONFIRMED","known":"cause is the decided G0/G1 stop (ADR-525 Consequences, controller v4 E6); the island-fill size is new","summary":"Island Fill writes its capped runways as G0 collinear with each short burn; the estimator stops at every G0/G1 junction, so 'B8O' Island Fill at F6000 estimates 135.4 s against 82.5 s from an independent GRBL planner (+64%); scanline fill of the same text is +5%. Refuter: own placement 132.8 s vs 79.9 s (+66%), cut 38.3 s vs burn 12.8 s; scanline +5%"},
  {"id":"Q6-K1","severity":"P1","area":"vector-burn-quality","file":"src/core/devices/gcode-dialects.ts","line":116,"anchor":"Q1-P2-1","evidence":"REPRO","verdict":"KNOWN","known":"Q1-P2-1","summary":"GRBL Compatible fills run M3: F6000 with 5 mm overscan, row edges 1.21-1.26, letters 40% of pixels over 1.1 (max 1.39); Automatic overscan 1.000; runway advisory fires"},
  {"id":"Q6-K2","severity":"P2","area":"vector-burn-quality","file":"src/core/gcode-time/segment-blocks.ts","line":35,"anchor":"planner.c limit_value_by_axis_maximum","evidence":"REPRO","verdict":"KNOWN","known":"controller v4 E6-K-1 / PV-1 / rolling-v2 18 K-2","summary":"Scalar acceleration in estimates: 30-degree hatch +12%, 45-degree hatch +19%"},
  {"id":"Q6-K3","severity":"P3","area":"vector-burn-quality","file":"src/core/motion-planner/junction.ts","line":11,"anchor":"ADR-525 Consequences (decided G0/G1 stop)","evidence":"REPRO","verdict":"KNOWN","known":"ADR-525; controller v4 E6","summary":"Traced logo fill estimate +18% (437.8 vs 370.2 s); cut programs +0-7%"},
  {"id":"Q6-K4","severity":"P3","area":"vector-burn-quality","file":"src/core/job/scan-offset.ts","line":121,"anchor":"ADR-052; LightBurn 2.0 Scanning Offset Adjustment (enter half the separation)","evidence":"REPRO","verdict":"KNOWN","known":"2026-07-17 BQ-21 / H1","summary":"A +0.1 mm table value moves reverse fill rows along their travel (X9.9..29.9); Preview matches; physical sign hardware-pending"},
  {"id":"Q6-K5","severity":"P3","area":"vector-burn-quality","file":"src/core/job/fill-rule.ts","line":12,"anchor":"ADR-019; ADR-270 Amd 1","evidence":"REPRO","verdict":"KNOWN","known":"2026-07-17 N9","summary":"Even-odd cancels a same-path overlap: overlap dose 0.000"},
  {"id":"Q6-K6","severity":"P3","area":"vector-burn-quality","file":"src/core/scene/layer.ts","line":25,"anchor":"LightBurn 2.0 Shared Settings: Min Power only for DSP lasers or Grayscale images","evidence":"SOURCE","verdict":"KNOWN","known":"2026-07-17 N7","summary":"No vector Min Power on GRBL: LightBurn parity"},
  {"id":"Q6-K7","severity":"P3","area":"vector-burn-quality","file":"src/core/job/fill-hatching.ts","line":133,"anchor":"global scanline grid","evidence":"READ","verdict":"KNOWN","known":"2026-07-17 BQ-15 / F12","summary":"Thin features between grid rows vanish; same root as Q6-P3-1; not re-measured"}
]
```
