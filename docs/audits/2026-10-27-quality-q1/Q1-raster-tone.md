# Quality audit Q1 — Raster tone

- **When:** 2026-10-27 23:30 – 2026-10-28 00:10 +0800   **Tree:** origin/main @ `09f7c0087` (worktree
  `claude/rolling-audit-v5`; `git diff origin/main` is empty for every cited file, so repros ran on
  main's code).
- **Scope:** brightness → S on the Image path: `src/core/raster/{image-processing,luma-adjust,photo-tone-curve,luma-sharpen,dither,controller-power-scale,emit-raster,emit-raster-sweep,raster-sweep-plan,preview-data}.ts`,
  `src/core/raster-output/raster-power-runs.ts`, `src/core/job/{compile-job-raster,automatic-overscan,operation-cut-extras,compile-job-defaults}.ts`,
  `src/core/output/{grbl-strategy,laser-power-scale-version}.ts`, `src/core/devices/gcode-dialects.ts`.
  Twins: `src/ui/workspace/{compiled-raster-preview,draw-raster-preview}.ts`, `src/ui/raster/photo-engraving-preview.ts`,
  `src/ui/laser/{scan-quality-warnings,job-intent-warnings}.ts`, the Image fields in
  `src/ui/layers/{CutSettingsImageFields,LayerImageFields}.tsx`.
  Governing: ADR-670 (+ Amd 1, 2), ADR-671, ADR-495, ADR-257, ADR-567 (+ Amd 1, 2), ADR-028 Amd 1.
- **Lenses run:** L2 (GRBL source and LightBurn docs fetched and pinned), L3 (Preview, Photo
  engraving preview and dither paths against the emitted bytes), L1 (ADR-670/671 formulas and
  claims), L7 light. L4–L6 skipped: no untrusted input or failure path is specific to tone mapping.
- **Refuter:** 2026-10-28, fresh context, origin/main @ `99f570ead`. The cited directories are
  identical to `09f7c0087`, and the worktree copies match origin/main. The refuter wrote its own
  Vitest repro, G-code parser and GRBL planner model, and re-fetched the pinned GRBL and LightBurn
  sources.
- **Counts:** 3 raised → refuter: 3 confirmed, 0 plausible, 0 refuted → P1 2 / P2 0 / P3 1
  (+ 4 KNOWN re-observed). Q1-P2-1 keeps its ID and is raised to P1 (see its Refuter line).

## Headline

The brightness → S mapping itself is exact. On a 16-step wedge every emitted S is within half an
S step of the documented formula, on GRBL, grblHAL and FluidNC, at `$30`=1000 and 255. This holds
for min/max power, Negative, gamma, brightness/contrast, the ADR-670 tone curve and sharpening. The
canvas Preview and the Photo engraving preview match the emitted S pixel for pixel.

The quality losses are downstream of that mapping, where the G-code meets motion and the beam:
- **Dot Width Correction + Grayscale (P1):** Dot Width Correction cuts every Grayscale power
  change, not only the ends of the burn. A Grayscale photo with Dot Width 0.02 mm at 10 lines/mm
  burns 36% less energy than the Preview shows, and 72% less at 0.04 mm. Nothing warns, and a
  tone-calibration wedge cannot see it.
- **GRBL Compatible rasters (P1, raised from P2 by the refuter):** this dialect burns images with
  M3. On 8-bit GRBL its 15-block look-ahead holds dithered rows at about 37 mm/s when 100 mm/s is
  asked for, at the profile's default 500 mm/s². Constant power then gives the photo about 1.8×
  its intended dose, and nothing tells the operator.

Under the default M4, acceleration and short overscan cost at most about 5.6% of dose over the
first 0.2 mm of a row.

## Scorecard

"Verdict" is the refuter's: CONFIRMED means the refuter re-ran it independently; PLAUSIBLE means it was not re-run. "Auditor reading" is the auditor's own comparison.
FS = full scale. Wedge: luma 0, 17, …, 255; 16 px per step at 10 lines/mm. Astronaut: the
160 × 160 face crop at (150, 20) of the 512 px fixture, burned 1:1 at 10 lines/mm.

| Metric | KerfDesk value | Reference / target | Auditor reading | Verdict |
|---|---|---|---|---|
| Grayscale wedge, emitted vs intended S, `$30`=1000 (100/0, 60/10; GRBL, grblHAL; FluidNC 33/7) | max 0.033% FS, mean 0.021% | ≤ half an S step (0.05% FS) | meets | CONFIRMED (re-run on GRBL at 100/0 and 60/10: max 0.033% FS; grblHAL and FluidNC not re-run) |
| Same at `$30`=255 (profile 255, connected `$30`=255 over profile 1000, FluidNC 255) | max 0.196% FS, mean 0.086%; three paths byte-identical | ≤ half an S step (0.196% FS) | meets | PLAUSIBLE (not re-run) |
| Monotonicity | 15 of 15 wedge cases monotone; 0 reversals across 255 gradient steps in 8 cases | non-increasing S as luma rises | meets | PLAUSIBLE (not re-run) |
| Distinct levels on a 0–255 gradient | 256 S → 252 GRBL PWM levels (100/0); 129 PWM levels at 60/10 for both 1000 and 255; gamma 2: 192; tone curve: 194 | stock GRBL 8-bit PWM (`spindle_control.c` L213) | meets (firmware-bound) | CONFIRMED for 100/0 and 60/10 (recounted from `spindle_control.c` L213: 252 and 129 levels); gamma and curve counts not re-run |
| Clipping, black end | luma 0 → exactly S_max in every case | Max Power for pure black | meets | CONFIRMED (wedge: luma 0 → S1000 at 100/0, S600 at 60/10) |
| Clipping, white end | luma 255 → S0 whatever Min Power; at 60/10 luma 254 → S102 and 255 → S0, a jump 51× one level step (≈ 2 S) | LightBurn 2.0: "Min Power for the lightest shades"; KerfDesk hint: "maps luma between Min Power and Power" | differs (KNOWN 20-K-3) | CONFIRMED (wedge at 60/10: 238 → S133, 255 → S0); KNOWN, stays P3 |
| Gamma (0.5, 2) vs `255·(v/255)^(1/γ)` (ADR-671 item 1) | max 0.047% FS | formula | meets | PLAUSIBLE (not re-run) |
| Brightness 20 / contrast 30 / gamma 1.4 vs ADR-671 single-rounding formula | max 0.045% FS; 5 of 16 steps clip to S0 (formula says so) | formula | meets | PLAUSIBLE (not re-run) |
| ADR-670 curve vs independent piecewise-linear evaluation of its points | max 0.049% FS; with Negative too | ADR-670 item 4/5 | meets | PLAUSIBLE (not re-run) |
| Negative symmetry `S_neg(L) = S_pos(255−L)` | 0 S difference at 100/0 and 60/10 | exact | meets | PLAUSIBLE (not re-run) |
| Sharpen mean tone shift, face, 2:1 | 30%/0.7: 0.008 level; 80%/1: 0.11; 200%/1: 0.55; 500%/3: 3.6 | ADR-671: "under 0.1 level" at 30% | meets | PLAUSIBLE (not re-run) |
| Curve before vs after burn-grid resample (ADR-670 item 5) | 1:1: 0.06 level mean; 2:1: −0.21 mean, 24 max; 4:1: −0.70 mean, 27 max | ADR-670: "a second-order difference" | mean meets; per-cell max does not (Q1-P3-1) | CONFIRMED (own repro, curve fitted by `fitPhotoToneCurve` from a 1 − (1 − c)² dot gain: 0.064; 0.426, −0.21, max 24; 0.847, −0.70, max 27) |
| Dither dose linearity (simulated, ideal motion) | Jarvis, FS, Stucki, Blue Noise: max \|dose − (1 − L/255)\| ≤ 0.005; Ordered 0.028 (17 levels) | coverage = 1 − L/255 | meets | PLAUSIBLE (not re-run) |
| Simulated burn tone, uncalibrated (model below) | wedge mean +0.18 darker than linear intent for every mode; face MAE 0.216 (Jarvis), 0.247 (Grayscale) | material saturation is what ADR-670 calibrates | expected | PLAUSIBLE (not re-run) |
| Simulated burn tone after an ADR-670 curve fitted from the simulator's own 11-patch wedge | face MAE 0.216 → 0.020 (Jarvis), 0.247 → 0.011 (Grayscale); correlation 0.952 → 0.988 / 0.963 → 0.999 | ADR-670 perceptual fixture: 0.164 → 0.017 | meets | PLAUSIBLE (not re-run) |
| Canvas Preview vs emitted S (face, Grayscale 60/10 and Jarvis + curve + sharpen + gamma) | 0 of 25,600 px differ | identical (ADR-670 V&L, ADR-671 item 3) | meets | CONFIRMED for Grayscale 60/10 and Jarvis 70% + gamma 1.4 (`compiledRasterPreview` of a separate `compileJob` vs S at each pixel centre of the emitted bytes: 0 of 25,600 each); curve + sharpen variant not re-run |
| Photo engraving preview vs emitted S (relative marks) | 0 of 25,600 px differ; with connected `$30`=255 over profile 1000: ≤ 1 grey level (rounding) | identical | meets | PLAUSIBLE (not re-run) |
| Raster power word | M4 on GRBL Dynamic, GRBL Raster, Neotronics 4040 Safe, grblHAL, FluidNC; **M3 on GRBL Compatible** | GRBL laser_mode.md: M4 keeps energy per length constant | M3 path: Q1-P2-1 | CONFIRMED (bytes: GRBL Compatible arms M3, GRBL Dynamic M4; other dialects from `gcode-dialects.ts`) |
| Row-edge dose, 6000 mm/min, a = 500 mm/s², default 5 mm overscan (10 mm needed) | M4: +1.3% / +5.6% on the first two 0.1 mm px, then ≤ 5% (entry 70.7 mm/s); M3: +34% / +41% at entry / exit, 82 px over +5% | uniform | M4 meets; M3 advised (runway warning fires) | PLAUSIBLE (not re-run) |
| Same with automatic overscan (11 mm) | 1.000 at both edges, M4 and M3 | uniform | meets | PLAUSIBLE (not re-run) |
| M4 with overscan 0 | first px +55%, last px −45% (GRBL updates PWM from segment-end speed, `stepper.c` L958-962) | uniform | advised (runway warning fires) | PLAUSIBLE (not re-run) |
| Dithered 50% row at 6000, 8-bit GRBL look-ahead (15 blocks), 201 blocks per 20 mm row | head ≈ 37 mm/s; dose ratio M4 0.993, **M3 2.61**; face M3 1.79 (midtones 1.91) | constant dose | M3 fails, no advisory (Q1-P2-1) | CONFIRMED (independent planner model on the emitted bytes: 50% row M3 2.614, M4 0.993; face M3 1.793, M4 0.990; block-boundary speed √(2·500·1.4 mm) = 37.4 mm/s) |
| Dot Width Correction, Grayscale, energy vs Dot Width 0 | gradient 0.60 / 0.20; face 0.64 / 0.28 (Dot Width 0.02 / 0.04 mm) | trims the ends of the burned line only | fails (Q1-P1-1) | CONFIRMED (own repro: gradient 0.600 / 0.200; face 0.638 / 0.276; Jarvis 0.785 / 0.570) |
| Overscan model | auto: `v²/2a × 1.1`, axis-share for angles (ADR-495); default fixed 5 mm plus a runway advisory | LightBurn 2.0: "Overscanning distance is calculated as a percentage of Speed." | physically better than a linear % | PLAUSIBLE (not re-checked) |

### Measurement method

**Bytes.** Temporary Vitest files built a `RasterImage` and an Image operation, and ran
`prepareOutput` → `emitPreparedGcode`, the shipped Save/Start path. They then parsed the text and
read the S of the powered G1 covering each pixel centre. Ran one file at a time:
`node ../../../node_modules/vitest/vitest.mjs run src/io/gcode/zz-q1-*.test.ts`.

**Simulator.** An independent G-code burn simulator (temporary `.mjs`) imported nothing from
KerfDesk. Its model:
- **Power.** Power is linear in S/S_full, with no `$31` and no diode threshold.
- **M4 dose.** Under M4, GRBL multiplies S by `current_speed / programmed_rate` once per step
  segment. A segment lasts at most 10 ms (`DT_SEGMENT`, `ACCELERATION_TICKS_PER_SECOND` 100) and
  is cut at block ends. It uses the speed at the segment end (gnea/grbl `stepper.c` L958-962).
- **M3 dose.** M3 holds S.
- **Motion.** Each collinear G1 run between stops is a rest-to-rest trapezoid at a, capped at F.
  The `plannerBlocks: 15` runs also cap speed at `√(2a·d)`, where d is the distance to the end of
  the 15th buffered block. This follows from GRBL planning the last buffered block to a stop
  (`planner.c` L128-142; `planner.h` L27-31: 16 slots, 15 usable).
- **Deposit.** Dose per length is P/v, normalised so full power at F is 1 per mm. It is deposited
  on a 0.02 mm grid and blurred with a Gaussian spot (FWHM 0.15 mm). Area dose is normalised so a
  solid full-power patch at a 0.1 mm interval is D = 1.
- **Darkness.** Darkness is `1 − exp(−D·ln 20)`, so solid full power gives 0.95.

The tone numbers depend on this model. The S, dose and twin numbers do not.

## Findings

### Q1-P1-1 — Dot Width Correction trims every Grayscale power change, so a Grayscale photo burns 36–72% less energy than the Preview shows, with no warning

- **Where:**
  - `src/core/raster-output/raster-power-runs.ts:31-44`: the row is split at every change of
    exact S.
  - `src/core/raster-output/raster-power-runs.ts:57-70`: each run with S > 0 is shortened by the
    correction at both ends, with an S0 gap in between.
  - `src/core/raster/raster-sweep-plan.ts:132-151`: this is applied to every pixel run.
  - The field is offered whatever the dither:
    - `src/ui/layers/CutSettingsImageFields.tsx:66-74`;
    - `src/ui/layers/LayerImageFields.tsx:66-67, 327`;
    - Adjust Image;
    - for Pass-through, `CutSettingsImageFields.tsx:211` says "Dot Width still apply".
- **Anchor:**
  - **Twin.** A dither emits only S_max or 0, so equal neighbours merge and the correction only
    ever meets a beam on/off edge. That is the dot edge it is meant to pull back. Grayscale gives
    neighbouring pixels different non-zero S, so the same code cuts inside a beam that never
    switches off. The Preview and the Photo engraving preview show the compiled S without any
    correction (`compiled-raster-preview.ts:25-44`), so they show the uncut tone.
  - **Contract.** The field hint (`CutSettingsImageFields.tsx:73`) reads "Compensate for physical
    laser dot width when raster engraving". The beam's width adds nothing at a change of power
    inside a lit line.
  - **Ground truth.** LightBurn 2.0 Image Mode says Dot Width Correction compensates "by shortening
    the length of engraved scan lines"
    (https://docs.lightburnsoftware.com/2.0/Reference/CutSettingsEditor/ImageMode/, fetched
    2026-10-27). That is the line, not each power step. Whether LightBurn applies it in Grayscale at
    all is **UNVERIFIED**: the page does not say.
- **Scenario:** A Grayscale photo (or a Pass-through greyscale source) is set to Dot Width 0.02 mm
  at 10 lines/mm, a typical value for a 0.1 mm interval.
  - Every 0.1 mm pixel whose S differs from its neighbour's burns only its middle 0.06 mm, with
    0.04 mm dark between pixels.
  - The Preview, the Photo engraving preview and Job Review all show the full tone.
  - The scan-quality advisory (`scan-quality-warnings.ts:96-111`) fires only when a 1-pixel run
    vanishes (remaining ≤ 0.001 mm), so at 0.02 or 0.04 it is silent.
  - An ADR-670 tone wedge cannot catch it. Its flat patches are one run per row, so it loses
    0.4% (Dot Width 0.02) where the photo loses 36%. Calibrating therefore leaves the photo
    uncorrected.
- **Evidence:** REPRO.
  - Bytes, 6 px Grayscale ramp `[0,40,80,120,160,200]`, Dot Width 0:
    `G1X50F1500 … | X50.1S1000 | X50.2S843 | X50.3S686 | …`. With Dot Width 0.02:
    `X50.02 | X50.08S1000 | X50.1S0 | X50.12 | X50.18S843 | X50.2S0 | X50.22 | X50.28S686 | X50.3S0 …`.
    The control, Threshold on the same ramp, is cut only at the run ends: `X50.02 | X50.38S1000 | X50.4S0`.
  - Energy (Σ S × burned length) relative to Dot Width 0:

    | Input and mode | Dot Width 0.02 mm | Dot Width 0.04 mm |
    |---|---|---|
    | 256 px gradient, Grayscale | 0.600 | 0.200 |
    | Face, Grayscale | 0.638 | 0.276 |
    | Flat 128, Grayscale (one run per row) | 0.996 | 0.992 |
    | Face, Jarvis (intended trimming at dot edges) | 0.785 | 0.570 |

  - Simulated mean darkness on the face, Grayscale: 0.655 → 0.512 → 0.269.
  - Job Review advisories for the Dot Width 0.02 ramp: only the bidirectional scan-offset notice.
- **Refuter:** **CONFIRMED, stays P1.**
  - **What would make it false:**
    - Dot Width is not reachable in Grayscale;
    - an ADR accepts the Grayscale tone loss;
    - a warning reaches the operator;
    - or the Preview already shows the correction.
  - **What I checked:** none of those holds.
  - **Own repro** (temporary Vitest, `prepareOutput` → `emitPreparedGcode`, own G-code parser):
    - The ramp bytes match the Evidence line byte for byte, including the Threshold control.
    - Energy ratios: gradient 0.600 / 0.200; face Grayscale 0.638 / 0.276; face Jarvis
      0.785 / 0.570.
    - The flat-patch ratio depends on patch width (1 − 2·DWC / width). The report's
      0.996 / 0.992 is a 10 mm patch. A 4 mm patch gives 0.990 / 0.980.
  - **Reachable.** The field has no dither condition:
    - `CutSettingsImageFields.tsx:66-76`;
    - `LayerImageFields.tsx:66-67, 299-310`;
    - `compile-job-raster.ts:209` clamps it only to the line interval.
  - **No warning.** `dotWidthWarning` (`scan-quality-warnings.ts:96-111`) returns null unless
    `pitch − 2·DWC ≤ 0.001 mm`.
  - **ADRs.** No ADR introduced Dot Width Correction; it was commit `2e1c83199`, with no ADR.
    - Its own code contract, `emit-raster.ts:82-83` (code comment, not ADR text), says
      "Shortens non-zero scan runs at both ends". In Grayscale the code shortens every exact-S
      run, not every non-zero run.
    - ADR-458 Context (L21) only describes the code: "shortens each end of an exact-power run". It
      uses that to reason about isolated pixels vanishing and never mentions Grayscale tone.
    - ADR-359 item 7 says only that the correction "acts only along the scan".
    - ADR-670 Amd 1 item 3 confirms the Preview leaves the correction out: it "act[s] when G-code
      is written and do[es] not change the Preview grid".
    - No ADR limits the field to dithered or Threshold modes, or accepts the Grayscale loss.
  - **LightBurn.**
    - The 2.0 Image Mode page (versioned URL above, re-fetched 2026-10-28) says "shortening the
      length of engraved scan lines". It names no modes, so LightBurn's Grayscale behaviour stays
      **UNVERIFIED**.
    - The only staff statements found are about dithering and Threshold. On Threshold, LightBurn
      (Oz) wrote on 2022-03-30: "It does, and it only affects horizontal width"
      (https://forum.lightburnsoftware.com/t/dot-width-correction/63182?page=2, fetched
      2026-10-28; live link, not archived).
    - If LightBurn trims Grayscale the same way, that is parity, but the severity does not change:
      the KerfDesk Preview shows the uncut tone, and nothing warns.
  - **Severity.** P1 under the AREAS quality severity: the tone differs from the Preview, depends
    on texture, and gets no warning.
  - **Side observation (not a finding, UNVERIFIED).** The same 2022-03-21 post by Oz calls the
    value "the total amount to shorten the line". KerfDesk trims the full value at each end, so 2×
    in total. LightBurn's 2.0 page says the ideal value is "about half the total thickness of the
    laser's beam", which fits a per-end trim. The two LightBurn sources disagree, so this is left
    for Q2.
- **Fix direction:** Apply the correction only where the beam turns on or off, at the ends of each
  contiguous non-zero span. That is what it does for dithers today. Alternatively, hide the field
  for Grayscale and Pass-through and say so. Pin either choice with a Grayscale test.

### Q1-P2-1 (P1, raised by the refuter) — GRBL Compatible burns images with M3; on 8-bit GRBL its look-ahead slows dithered rows and constant power over-doses them about 1.8×, with no advisory

- **Where:**
  - `src/core/devices/gcode-dialects.ts:109-117`: `grbl-compatible` sets
    `rasterPowerMode: 'constant'`, while its description (`:111`) promises only "constant-power
    vector cuts". The description is not shown in Machine Setup, which shows only the label
    (`DeviceSetupConnectionOptions.tsx:159-161`).
  - `src/core/output/grbl-strategy.ts:341` takes the raster word from `dialect.rasterPowerMode`.
  - `src/ui/laser/scan-quality-warnings.ts:48-71` and `job-intent-warnings.ts:43-52` advise only
    on the row-entry runway, not on in-row slowdown.
- **Anchor:**
  - **Ground truth**, gnea/grbl @ `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e`:
    - `doc/markdown/laser_mode.md` L32: M3 "keeps the laser power as programmed, regardless if
      the machine is moving, accelerating, or stopped".
    - L39: M4 "ensures the amount of laser energy along a cut is consistent".
    - `grbl/planner.h` L27-31: `BLOCK_BUFFER_SIZE 16`.
    - `grbl/planner.c` L128-142: the newest block is planned to stop.
    - L441-443: collinear junctions are not limited.
  - **Twin:** the Preview and the time estimate model the programmed feed.
  - **Contract:** ADR-257 keeps `grbl-compatible` constant for cuts, saying its "label and
    description already promise constant-power cuts". Nothing records that images run M3 too.
- **Scenario:**
  - **Setup.** An 8-bit GRBL 1.1 machine on the GRBL Compatible dialect, with KerfDesk's default
    acceleration of 500 mm/s². It engraves a Jarvis photo at 10 lines/mm and 6000 mm/min, with
    automatic overscan so the row entries are clean.
  - **Why it slows.** Each run of 1–2 dots is one G1, so 15 buffered blocks hold about 1.5 mm.
    GRBL must be able to stop inside that distance, so it cruises at about 37 mm/s instead of
    100 mm/s.
  - **What M3 does.** M3 holds S, so dithered and grayscale areas get about 2.6× their energy per
    millimetre. Solid areas, which are long blocks, reach full speed and get 1×.
  - **What the operator sees.** Midtones burn far darker than the Preview, and the
    midtone-to-solid relation is distorted. Job Review shows only the scan-offset notice.
  - **Default dialect.** The same job on GRBL Dynamic (M4) keeps its dose (0.993), because GRBL
    lowers power with the speed.
- **Evidence:** REPRO (emitted bytes, plus the simulator's firmware-derived motion model) and
  SOURCE.
  - Bytes: the wedge on `grbl-compatible` arms `M3`; every other GRBL-family dialect arms `M4`.
  - 50% Jarvis, 200 × 4 px, 6000 mm/min, auto overscan 11 mm: 201 blocks per row; mid-row speed
    37.4 mm/s.

    | Look-ahead | M4 dose ratio | M3 dose ratio |
    |---|---|---|
    | 15 blocks | 0.993 | 2.613 |
    | 127 blocks | 1.000 | 1.000 |

  - Face, Jarvis, whole image, 15-block look-ahead:

    | Feed | M3 dose ratio | M3 midtone dose ratio | M4 dose ratio |
    |---|---|---|---|
    | 1500 | 1.000 | 1.000 | 1.000 |
    | 3000 | 1.021 | 1.032 | 0.996 |
    | 6000 | 1.794 | 1.910 | 0.996 |

    At 6000 the simulated mean darkness rises from 0.627 to 0.774.
  - `detectJobIntentWarnings` at 6000 returns only "Bidirectional scan output at 6000 mm/min has no
    saved scan-offset table…".
  - Reach: catalogue profiles do not use this dialect. grblHAL's default 100-block planner (ADR
    record at DECISIONS.md L13720) does not starve at these settings.
- **Auditor's open points:**
  - That stock 8-bit GRBL keeps the planner full at this block rate. 115200 baud carries about
    1,000 compact lines per second, which is more than the 370 blocks per second needed.
  - Whether LightBurn's GRBL-M3 device (ADR-257 Context item 2) behaves identically. That would be
    parity, not a reason to stay silent.
- **Refuter:** **CONFIRMED; severity raised P2 → P1.**
  - **What would make it false:**
    - GRBL plans further ahead than 15 blocks;
    - collinear blocks still slow down;
    - the link, not the planner, sets the speed and spares M3;
    - images on this dialect arm M4;
    - or a warning exists.
  - **Pinned GRBL source** (gnea/grbl @ `bfb67f0c`, re-fetched 2026-10-28):
    - `planner.h` L26-32: 16 slots (15 with line numbers).
    - `plan_check_full_buffer` (`planner.c` L250-254) treats `tail == next_head` as full, so 15
      blocks are usable.
    - `planner.c` L141-142: the newest block's entry is `2·a·mm` from a zero exit.
    - L441-443: a straight junction is "infinite".
    - `stepper.c` L958-962: M4 scales by `current_speed`. M3 does not, because
      `is_pwm_rate_adjusted` is set only for M4.
  - **Own planner model** (independent `.mjs`; reverse pass from the newest block, planned to a
    stop; junction deviation 0.01 mm; run on this repo's emitted bytes):

    | Case | M3 dose ratio | M4 dose ratio |
    |---|---|---|
    | 50% Jarvis row, 15 blocks | 2.614 | 0.993 |
    | Same, 14 blocks | 2.713 | — |
    | Same, 16 blocks | 2.524 | — |
    | Same, 127 blocks | 1.000 | — |
    | Face, 6000 mm/min | 1.793 | 0.990 |
    | Face, 3000 mm/min | 1.021 | — |

    - The block-boundary speed is √(2·500·14·0.1) = 37.4 mm/s, as claimed.
    - Sensitivity to the machine's real `$120`:

      | `$120` | 50% row, M3 | Face, M3 |
      |---|---|---|
      | 1000 mm/s² | 1.85 | 1.29 |
      | 2500 mm/s² | 1.17 | 1.002 |

      So the size follows acceleration. KerfDesk's own default of 500 mm/s², the value its runway
      advisory also uses, gives the reported numbers.
  - **Serial link.** This dialect keeps the verbose spelling (`compactMotionWords: false`). Lines
    average 15.8 bytes (`G1 X50.100 S1000`), so 115200 baud carries about 730 lines/s, not about
    1,000. That is still about twice the roughly 380 blocks/s needed. A starved link would only
    slow the head further, which makes M3 worse and leaves M4 unchanged.
  - **M3 on purpose.** Yes, for firmware without M4:
    - the code comment `gcode-dialects.ts:112-114` (code, not ADR text);
    - ADR-257 Decision: "the escape hatch for firmware without dynamic power (GRBL 1.1e and older,
      where M4 does not exist)".
    - LightBurn 2.1 GRBL Configuration
      (https://docs.lightburnsoftware.com/2.1/Guides/GRBLConfiguration/, fetched 2026-10-28):
      "GRBL 1.1e or older (GRBL 1.0, GRBL 0.9, etc) must use the GRBL-M3 device".
    - On that firmware M3 is unavoidable. The defect is the missing advice, not the power word.
    - ADR-257 discusses cuts only, and nothing records the raster consequence.
  - **Reach** (it cannot lower P1, METHOD §3):
    - the dialect is selectable in Machine Setup by label only;
    - it is required for GRBL 1.1e or older;
    - KerfDesk itself recommends "GRBL Compatible (constant-power)" to FluidNC owners with `$32=0`
      (`controller-readiness-messages.ts:25`).
  - **No warning.**
    - `scanQualityWarnings` covers only the entry runway and isolated-pixel loss.
    - `job-intent-warnings.ts` names M3 only for traced vector output (L255-282).
    - ADR-331 Context already records that stock-GRBL dithers run below the programmed feed ("a 0.1
      mm dither outruns above roughly 5000 mm/min"), but nothing turns that into M3 dose advice.
  - **LightBurn's GRBL-M3 raster behaviour:** not verified. It would be parity, not a warning.
  - **Severity.** P1 under AREAS "Severity for quality":
    - a 50% dithered row gets 2.6× its energy and a photo 1.8×, the AREAS example of "a 50% grey
      that burns as 80%";
    - the app promises its Preview (ADR-670 Amd 1 item 3: Preview "shows the tones the G-code
      burns");
    - no warning reaches the operator.
    - Neither lowering test of METHOD §3 is met.
- **Fix direction:**
  - Under a constant-power raster, warn when the feed exceeds what the controller's look-ahead
    sustains for the image's run lengths, roughly `√(2·a·15·mean run)`, and suggest GRBL Dynamic
    or a lower speed.
  - State in the dialect's visible text that images also run at constant power.

### Q1-P3-1 — The tone curve runs before the burn-grid resample; on 2:1–4:1 reductions it moves mean tone by under 1 level but individual textured cells by up to 27 levels

- **Where:**
  - `src/core/raster/image-processing.ts:17-28`: `prepareImageLuma` applies the curve at source
    resolution.
  - `src/core/job/compile-job-raster.ts:318-329`: area resample to the burn grid afterwards.
- **Anchor:** Contract.
  - ADR-670 Decision 5 places the curve "after brightness, contrast, gamma and Negative, before
    resampling and dithering". It records the cost: "for texture finer than the burn grid the
    correction is therefore averaged after the curve rather than before, a second-order
    difference".
  - The code comment `photo-tone-curve.ts:4-5` (its own `file:line`, not ADR text) says the
    inverse "is applied to the luma the ditherer sees".
  - The wedge (Decision 2) measures flat patches, which are burn-grid tones.
- **Scenario:** A calibrated photo is placed smaller than its pixels, which is the normal case for
  a phone photo at 10 lines/mm.
  - In hair and eyelash cells, the mean of the curved source pixels differs from the curve of
    their mean, which is what the wedge calibrated.
  - The flat-patch calibration therefore does not hold there.
  - With the steep dot-gain curve tested, the mean bias is small. Single cells move up to 27
    levels, which is roughly 10% of full tone.
- **Evidence:** REPRO (face, Grayscale, dot-gain curve). Burn-grid luma with the curve applied
  before the resample (shipped), against the curve applied after it:

  | Reduction | Mean \|Δ\| | Mean signed Δ | Max \|Δ\| |
  |---|---|---|---|
  | 1:1 | 0.064 | — | 0.1 |
  | 2:1 | 0.426 | −0.21 | 24 |
  | 4:1 | 0.847 | −0.70 | 27 |

  Δ is in levels.
- **Auditor's open question:** ADR-670 already names this as a limit. Is the per-cell maximum
  still "second order"?
- **Refuter:** **CONFIRMED, stays P3.**
  - **Own repro.**
    - Setup: temporary Vitest. The face is compiled through `compileJob` with a curve fitted by
      `fitPhotoToneCurve` from a 1 − (1 − c)² dot-gain wedge. That is compared with my own exact
      2×2 / 4×4 box mean followed by `applyPhotoToneCurve`.
    - Mean |Δ|: 0.064 at 1:1, 0.426 at 2:1, 0.847 at 4:1.
    - Mean signed Δ: +0.005, −0.206, −0.703. Max: 0.1, 24, 27. The table matches.
  - **Order in the code.** The curve runs at source resolution (`image-processing.ts:17-28`),
    before `resampleLuma` (`compile-job-raster.ts:318-329`).
  - **ADR quote.** ADR-670 Decision 5's quote is verbatim (ADR-670 L57-66).
  - **Severity.**
    - It stays P3 because ADR-670 Decision 5 accepts this order, and the mean error is under 1
      level.
    - The new information is the per-cell size: up to about 10% of full tone in sub-grid texture,
      mostly toward under-correction (the signed mean is negative).
    - That meets "second order" for tone, not for detail, so it is a measurable improvement
      opportunity, not a defect.
- **Fix direction:** Apply the curve on the burn grid, after the resample and before the sharpen.
  That needs ADR-670 and ADR-671 amendments, because ADR-671 item 2 places sharpening after
  calibrated luma. Otherwise state the per-cell size of the difference in ADR-670.

## KNOWN re-observed

- **Q1-P3-K1 (20-K-3, BQ-18), white burns S0 whatever Min Power is.**
  - Code: `dither.ts:120-122, 209-210`.
  - Re-measured at 60/10: luma 254 → S102, luma 255 → S0, and about 2 S per level elsewhere.
  - New anchors since 20-K-3:
    - KerfDesk's own picker hint (`LayerImageFields.tsx:172`): "Grayscale maps luma between Min
      Power and Power".
    - LightBurn 2.0 Image Mode: "using Min Power for the lightest shades and Max Power for the
      darkest" (versioned URL above).
    - LightBurn's pinned docs mirror (`LightBurnSoftware/Documentation@1741e66e9b2a583d00e5630da6b953ca9382ebf4`
      `EngravingImages.md` L43): "The minimum power of the laser for pure white."
  - Visible consequence: a JPEG background of 250–255 burns as speckle. About 1 in 6 pixels is
    blank and the rest burn at about 10%.
  - Still a maintainer decision, now with a measured cost.
  - **Refuter: KNOWN, CONFIRMED, stays P3.**
    - **Wedge.** My own wedge at 60/10 gives 238 → S133 and 255 → S0. The code
      (`dither.ts:120-122, 207-210`) gives 254 → round(100 + 500/255) = S102.
    - **Sources.** Both LightBurn quotes were re-fetched verbatim on 2026-10-28: the 2.0 page, and
      the mirror at `1741e66e` L43.
    - **Not P1.** The Preview shows the same S: the twin check above found 0 of 25,600 pixels
      differ. A speckled near-white background is therefore visible in the Preview before the
      burn; it is not a hidden tone change.
    - **Not P2.** A visible difference from LightBurn appears only when Min Power > 0. Rolling v2
      and BQ-18 recorded white → S0 as a deliberate choice for clean highlights.
    - **Hint drift.** The picker hint "maps luma between Min Power and Power" is P3 doc drift.
    - **"About 1 in 6 blank."** That figure depends on the JPEG's noise and was not re-measured.
- **Q1-P3-K2 (20-K-4, ADR-390 Consequences), the mapping is linear in sRGB bytes.**
  - Grayscale maps sRGB bytes linearly to S, just as dithers set coverage from the bytes.
  - LightBurn's developer, as forum user "LightBurn (Oz)", posted on 2019-06-17
    (https://forum.lightburnsoftware.com/t/min-max-power-clip-or-scale/4567/4, fetched
    2026-10-27, no archive): the 8-bit value is "mapped from min power to max power
    non-linearly" via "the sRGB power curve". This is a forum post, not docs.
  - ADR-670 calibration absorbs either convention. The scorecard shows it does under the simulator.
  - **Refuter: KNOWN, stays P3.** I re-fetched the forum post on 2026-10-28. Both quoted fragments
    are verbatim, dated 2019-06-17, by LightBurn (Oz).
- **Q1-P3-K3 (controller v4 E1-P3-2), the `$31` advisory points the wrong way.** Not re-run.
  E1-P2-1 (FluidNC fractional S) is fixed: FluidNC emits whole S on power-scale v4 (ADR-567
  Amd 2). Re-measured: `fluidnc-1000 33/7` emits `330,313,…,87`; `fluidnc-255` emits
  `153,145,…,34`.
  - **Refuter: KNOWN, stays P3.** Anchor checked: `controller-readiness.ts:295-300` still raises
    `min-power-nonzero`. The message was not re-run.
- **Q1-P3-K4 (20-K-1 / F20), Save Processed Bitmap dithers the image-oriented grid.** Not re-measured.
  - **Refuter: KNOWN, stays P3.** Anchor checked: `processed-bitmap.ts:100-110` dithers the masked
    luma. Not re-measured.

## Refuted

- **"The default 5 mm overscan over-burns row edges."** Not under M4.
  - At 6000 mm/min and 500 mm/s² the head enters the burn at 70.7 of 100 mm/s. GRBL's M4 scaling
    keeps the dose within +5.6% over the first 0.2 mm.
  - The remaining error is GRBL's segment-end PWM update, not KerfDesk.
  - Under M3 the runway advisory already fires ("needs about 10 mm").
- **"The canvas Preview disagrees with the emitted S when the connected `$30` differs from the
  profile."** My first comparison read the output group against the profile's S max. The real
  canvas compiles from the profile and differs from the bytes by at most 1 grey level (rounding).
- **"Sharpening shifts photo tone."** 0.008 level at 30%/0.7, as ADR-671 claims. Larger shifts
  appear only at 200–500%, where clipping is expected.
- **"Negative with Min Power is asymmetric."** It is exact: S_neg(L) = S_pos(255−L) at 60/10.

## Verified clean

- **Formulas.**
  - The S mapping `round(sMin + (255−v)/255·(sMax−sMin))` with v=255 → 0 (`dither.ts:198-213`).
  - Gamma `(v/255)^(1/γ)` and the brightness/contrast order with one final rounding
    (`luma-adjust.ts:25-42`, ADR-671 item 1).
  - Negative after the adjustments and the curve after Negative (`image-processing.ts:17-28`,
    ADR-670 item 5).
  - All to within half an S step on GRBL, grblHAL and FluidNC.
- **`$30` scaling.** A profile at 255 and a connected `$30`=255 over profile 1000 give
  byte-identical rasters. `$30`=1000 gives 256 distinct S on a gradient, and the controller's
  8-bit PWM keeps 252 of them.
- **Curve fit (ADR-670 item 4).** It inverts the measured response in the right direction.
  Calibrating against the independent simulator's own wedge cuts face MAE about 10× (Jarvis) and
  about 22× (Grayscale).
- **Twins.**
  - The canvas Preview (`draw-raster-preview.ts` → `compiledRasterPreview`) and the Photo
    engraving preview both read the compiled group.
  - With curve, sharpen, gamma and power 60–70%, they match the emitted S on all 25,600 face
    pixels.
  - The preview cache key now includes the curve (G9-P2-1 fixed by #1464) and sharpening.
- **Dither dose.** Jarvis, Floyd–Steinberg, Stucki and Blue Noise deliver `1 − L/255` within
  0.005 per wedge step through the emitted G-code. Ordered is within its 17-level quantisation.
- **Power words and overscan.**
  - Images arm M4 on every dynamic dialect, grblHAL and FluidNC, with a dark `S0` runway at both
    ends (`emit-raster-sweep.ts:144-162`).
  - Automatic overscan is `v²/2a × 1.1` with the axis share for angled scans (ADR-495;
    `automatic-overscan.ts:39-56`), the right physics for GRBL's per-axis acceleration limit.
  - At 6000 mm/min it gives 11 mm, and both edges simulate at 1.000 under M4 and M3.
  - The manual-overscan runway advisory fires whenever `v²/2a` exceeds the runway.
- **Internal white gaps.** Gaps of 5 mm or less are swept at feed with S0. Wider gaps split with
  collinear G1/G0/G1 joins, which GRBL does not slow (`planner.c` L441-443).

## Not verified

- **No burn.** Nothing was engraved and no controller was run. Darkness numbers come from a stated
  saturating model with a 0.15 mm spot. Real diode thresholds, `$31`, char and heat build-up are
  not modelled.
- **LightBurn's own Grayscale behaviour** with Dot Width Correction, and its Grayscale transfer
  curve in current versions. Only a 2019 forum post was found.
- **Marlin inline lasers.** They run images at continuous power (ADR-398 Amd 1, E1 table), so
  Q1-P2-1's look-ahead physics likely applies on 8-bit Marlin too. Neither Marlin nor
  Smoothieware was run.
- **FluidNC's configured `planner_blocks` and grblHAL builds below 100 blocks.** Their look-ahead
  was not checked.
- **The job time estimate under look-ahead slowdown** (the M4 photo at 6000 runs at about 37 mm/s
  on 8-bit GRBL): handed to Q6.
- **Rotated and angled-scan tone** (bilinear sampling) and **scan offset**: Q2.
- **The streamed compile path** (> 4 M px) was not run. Dot Width Correction is applied at emit
  time, so both paths share Q1-P1-1.
- **Refuter additions.**
  - **LightBurn's GRBL-M3 device on images.** Whether it also uses M3 for rasters, and whether it
    warns, was not verified.
  - **8-bit GRBL parse and plan time per line.** It was not measured. If the AVR cannot plan
    about 380 lines/s, the planner starves and the M3 over-dose in Q1-P2-1 grows; M4 is
    unaffected.
  - **Dot Width size convention.** KerfDesk trims the full value at each end. LightBurn (Oz,
    forum, 2022-03-21) calls the value "the total amount to shorten the line", while the 2.0 docs
    suggest a per-end reading. Not resolved; for Q2.

```json
[
  {"id":"Q1-P1-1","severity":"P1","area":"raster-tone","file":"src/core/raster-output/raster-power-runs.ts","line":57,"anchor":"Twin: dithers only meet Dot Width Correction at beam on/off edges and Preview/Photo engraving preview show uncorrected compiled S; Contract: CutSettingsImageFields.tsx:73 'Compensate for physical laser dot width'; Ground truth: LightBurn 2.0 ImageMode 'shortening the length of engraved scan lines' (Grayscale behaviour UNVERIFIED)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Dot Width Correction shortens every exact-S run, so in Grayscale/Pass-through it cuts a dark gap at every power change: a Grayscale photo at 0.02/0.04 mm burns 0.64/0.28 of the energy the Preview shows, with no advisory; a flat-patch tone wedge cannot see it"},
  {"id":"Q1-P2-1","severity":"P1","area":"raster-tone","file":"src/core/devices/gcode-dialects.ts","line":117,"anchor":"Ground truth: gnea/grbl@bfb67f0 laser_mode.md L32/L39 (M3 holds power, M4 keeps energy per length), planner.h L26-32 (16-slot buffer, 15 usable per plan_check_full_buffer planner.c L250-254), planner.c L141-142 (last block planned to stop), L441-443 (collinear unlimited); Twin: Preview (ADR-670 Amd 1 item 3 'shows the tones the G-code burns') and runway advisory model programmed feed; Contract: dialect description and ADR-257 promise constant-power cuts only","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"GRBL Compatible arms M3 for images; on 8-bit GRBL the 15-block look-ahead holds dithered rows at ~37 mm/s of 100 (a = 500 mm/s2, the profile default), so constant power gives a photo 1.79x dose (midtones 1.91x, 50% dither row 2.61x) at 6000 mm/min with no advisory; M4 keeps 0.99x. Refuter raised P2 -> P1 (AREAS quality severity: burn darker than the Preview, no warning; reach cannot lower P1)"},
  {"id":"Q1-P3-1","severity":"P3","area":"raster-tone","file":"src/core/raster/image-processing.ts","line":24,"anchor":"Contract: ADR-670 Decision 5 (curve before resampling and dithering; recorded as 'a second-order difference'); Decision 2 wedge measures flat burn-grid patches","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Tone curve applied at source resolution before the burn-grid resample: mean burn-grid tone moves -0.21 (2:1) and -0.70 (4:1) levels, but single textured cells up to 24-27 levels from the calibrated curve-of-mean"},
  {"id":"Q1-P3-K1","severity":"P3","area":"raster-tone","file":"src/core/raster/dither.ts","line":210,"anchor":"Ground truth: LightBurn 2.0 ImageMode 'Min Power for the lightest shades'; Contract: LayerImageFields.tsx:172 'Grayscale maps luma between Min Power and Power'","evidence":"REPRO","verdict":"CONFIRMED","known":"rolling-v2 20-K-3 / 2026-07-17 BQ-18","summary":"Grayscale white burns S0 regardless of Min Power: at 60/10 luma 254 -> S102, 255 -> S0 (51x a normal step); near-white JPEG backgrounds burn as speckle"},
  {"id":"Q1-P3-K2","severity":"P3","area":"raster-tone","file":"src/core/raster/dither.ts","line":209,"anchor":"ADR-390 Consequences; LightBurn (Oz) forum 2019-06-17 'mapped from min power to max power non-linearly'","evidence":"SOURCE","verdict":"CONFIRMED","known":"rolling-v2 20-K-4 (ADR-390 Consequences)","summary":"Grayscale and dithers map sRGB bytes linearly to power/coverage; LightBurn's developer describes an sRGB curve; ADR-670 calibration absorbs either"},
  {"id":"Q1-P3-K3","severity":"P3","area":"raster-tone","file":"src/core/preflight/controller-readiness.ts","line":294,"anchor":"gnea/grbl spindle_control.c rpm_min mapping","evidence":"READ","verdict":"PLAUSIBLE","known":"controller v4 E1-P3-2 (E1-P2-1 FluidNC truncation verified fixed by ADR-567 Amd 2)","summary":"$31 advisory still says low powers may burn hotter; not re-run"},
  {"id":"Q1-P3-K4","severity":"P3","area":"raster-tone","file":"src/ui/raster/processed-bitmap.ts","line":106,"anchor":"Twin: compile orients then dithers","evidence":"READ","verdict":"PLAUSIBLE","known":"2026-07-17 F20 / rolling-v2 20-K-1","summary":"Save Processed Bitmap dithers the image-oriented grid; not re-measured"}
]
```
