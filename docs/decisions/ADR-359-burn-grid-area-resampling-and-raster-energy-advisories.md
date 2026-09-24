## ADR-359 - Burn-grid area resampling, and advisories for raster energy, stacked copies and adjusted tone (2026-09-23)

**Status:** Accepted. | **Date:** 2026-09-23

### Context

An operator engraved detailed black line art (a feathered wing full of fine
white hatch lines and white stipple). The canvas showed every white line; the
burn filled them in and the middle feather came out solid dark. The operator
described the setting as "extreme quality".

A five-lens investigation traced the whole chain from canvas to G-code, with
every causal finding re-measured by two independent verifiers. It found that
the emitted program is geometrically faithful — every white gap at least one
burn cell wide is an explicit laser-off move at the right X on forward and
reverse rows — and that the loss comes from four places, none of which the
operator could see:

1. **Nearest-neighbour burn-grid resampling (TRC-03 / BQ-3, logged since
   2026-07-10 and never fixed).** `resampleLumaNearest`, the streamed row
   provider and the rotated sampler each gave a burn cell ONE source pixel.
   Line art is imported far denser than the burn grid (a 4000-8000 px wing
   placed at 100-200 mm is 25-60 px/mm against 10 lines/mm), so a white line
   narrower than a cell was deleted outright or kept a whole cell wide,
   depending only on where the sample landed. Measured at 40 px/mm and
   10 lines/mm: 74 % of 1 px lines, 48 % of 2 px lines and 93 % of 1 px dots
   burned solid.
2. **Energy per area scales with lines/mm and nothing says so.** Rows sit
   1/(lines/mm) apart at the layer's unchanged power and speed, so 25 lines/mm
   is 2.5x the dose of 10, and Pass-Through on a dense source (which skips the
   25 lines/mm cap) is 4-6x. Raising lines/mm "for quality" is the same as
   raising power: the char spreads into every white gap. The P preview and the
   canvas stay the same or look sharper. `WARN_RASTER_LINES_PER_MM` existed
   for this and nothing read it. The 4040's 0.16 x 0.18 mm spot is already
   wider than the 0.1 mm default interval.
3. **Stacked copies burn as a union.** Duplicate-then-nudge, a second import
   or a kept old trace leaves several copies on output operations; every copy
   burns, so a white line survives only where it is white in every copy.
4. **The design canvas ignored brightness, contrast and gamma.** They rewrite
   the luma that burns, but the canvas blitted the untouched source, so a
   darkening adjustment reached the material without ever showing on screen.

### Decision

1. **Area-average the burn grid wherever it is coarser than the source, for
   the tone-rendering dithers.** `resampleLuma` / `createLumaRowResampler`
   (`src/core/raster/luma-resample.ts`) give each burn cell the exact
   area-weighted mean of the source pixels it covers on any axis the grid
   downscales, when the layer uses an error-diffusion, ordered or grayscale
   mode (`burnGridKernel`). An axis the grid does not downscale keeps the
   centre sample, byte-identical to the former nearest-neighbour output, so
   upscaled images, Pass-Through and 1:1 grids do not change. The materialized
   and streamed compile paths share one row writer, so they stay byte-identical
   to each other. The image-export and Adjust Image previews use the same
   resampler and kernel, so they match the burn.
2. **Threshold keeps the centre sample.** Averaging a cell and then cutting it
   at 128 erases every stroke of EITHER polarity that covers half a cell or
   less, and posterises pre-dithered or halftone art; the review measured both.
   A centre sample at least keeps a share of the strokes, widened to a cell. So
   Threshold burns exactly as before, and Job Review says so instead
   (`src/ui/laser/raster-threshold-warnings.ts`): when a Threshold image is
   stored at least twice as dense as its burn grid, the warning names the
   detail size that is dropped or widened and points to a dithered mode.
3. **Rotated images reduce to the burn-cell pitch, then sample.** A rotated
   cell has no axis-aligned source footprint to area-weight in one step, so
   `prepareRotatedRaster` (`src/core/job/raster-rotated-sample.ts`) area-reduces
   the masked source ONCE per compile or streamed provider to the burn-cell
   pitch along each source axis. On a quarter turn the reduced pixels line up
   with the burn cells exactly, so each cell reads its own area mean, as the
   upright path does, at any density ratio. At any other angle the reduced grid
   is read bilinearly, so no reduced pixel — and no sub-cell line inside it —
   is skipped. A source no denser than the grid (within 1 %, so grid rounding
   never blurs a 1:1 image), Pass-Through (by its own flag, whatever the scale)
   and Threshold read the source untouched with the centre sample,
   byte-identical to the former sampler.
4. **Job Review warns when a raster burns at least 1.5x the energy per area of
   its reference** (`src/ui/laser/raster-energy-warnings.ts`). Energy per area
   is power x lines/mm x passes / speed. With a linked material preset that
   describes an ordinary image operation, the reference is that preset's whole
   dose: the warning lists both settings side by side, so the operator sees
   which of lines/mm, power, speed or passes departs, and gives the absolute
   power (and speed, within max feed) that matches the preset — naming the
   artwork's own override when that is the field to change. Following it clears
   the warning. Without a preset, KerfDesk cannot know what density the power
   and speed were chosen for, so the reference is 10 lines/mm and the advice is
   relative ("use about 40% of that power"). Density is the operation's
   compiled lines/mm, or the source density for Pass-Through. The warning names
   the image and the operation, states the beam overlap when the profile
   declares a spot size, is said once for copies, and is skipped at zero
   burned power.
5. **Job Review warns when two or more copies of one artwork overlap on output
   operations** (`src/ui/laser/stacked-copy-warnings.ts`). Copies are the same
   CONTENT — raster size, mask and a sampled fingerprint of the pixels (or the
   paged asset id), or trace source, grid and path count — not merely the same
   label, with the same rotation, scale and mirroring, sharing at least half
   the smaller footprint. The overlap is measured with the shared rotation
   undone, so rotated copies compare as the rectangles they are, and a
   sort-and-sweep keeps large arrays near linear. The burn test is compile's: a
   raster on an effective Image operation; a trace only where both the
   operation and its effective settings are vector. The trace-source backing
   and operations with output off are excluded.

   These three image advisories come FIRST in the job warnings: Save shows only
   its newest few toasts, and they must not push the older machine warnings out
   of view.
6. **The design canvas draws an adjusted image in the grey tone that burns**
   (`src/ui/workspace/raster-adjusted-display.ts`): the import's BT.601 luma of
   the source composited over white, put through `applyLumaAdjustments`. Copies
   are cached per source bitmap, then per adjustment (the outer key is the
   scene's own source string, so no frame builds a multi-megabyte key), pruned
   every frame to the pairs still on screen, built in place, and capped at a
   4096 px edge and 128 MiB in total; past the budget an adjusted image draws
   its untouched source, display only. Transparent areas stay clear when the
   curve keeps white unburned and are painted when it darkens white, because
   then they burn. Unadjusted images keep their original colours. The canvas
   shows the image's own adjustments, not an operation's Invert brightness,
   which the P preview shows.
7. **The line-interval and dot-width hints say what they do.** A denser scan
   burns more energy per area at the same power and speed. Dot width correction
   acts only along the scan and cannot widen white lines that run parallel to
   it.

All of these are warnings or display changes. Nothing new refuses a job
(rule 7, ADR-228).

### Consequences

- Downsampled image rasters in the dithered and grayscale modes burn
  differently from before, which is the point: sub-cell white detail becomes
  proportional texture instead of random solid or full-cell lines. Threshold,
  upscaled, 1:1 and Pass-Through output is unchanged.
- Area averaging reads every source pixel, where nearest read one per cell.
  Measured with the minimum of three runs, on this machine under varying
  load: a 36 MP to 6.25 MP downscale costs about 9-14x the nearest kernel
  (roughly 220-350 ms), 9 MP to 4 MP about 5-9x (75-135 ms), and the mildest,
  16 MP to 15.2 MP, about 4-7x (250-460 ms), paid again on each streamed pass.
  Upscaled grids take a direct-lookup fast path and are faster than before.
  A rotated downscale adds one O(source) reduction per compile or provider
  (roughly 90 ms for 12 MP).
- The warnings name physics the software cannot remove. A white line narrower
  than the burned mark still closes. What changes is that the operator is told
  before the material is committed, and is told what setting keeps the
  darkness.

### Alternatives rejected

- **Scale power automatically by 10/(lines/mm).** This would silently change
  what the power field means, break the Interval Test and Material Test
  semantics, and diverge from LightBurn. Offered as advice instead.
- **Seed dot width correction, or inset fills, from the profile spot.** The
  verifiers measured that this erases dark lines and dither dots narrower than
  about the spot. Left as an explicit operator choice.
- **A spot-aware ("kerf") preview.** It needs the real single-row mark width,
  which depends on dose, focus and material, not just the nominal spot. A
  preview built on the nominal spot would be confidently wrong in either
  direction, so it stays a follow-up that needs calibration data.
- **Bilinear upscaling (TRC-03's original plan).** It softens line-art edges
  across several burn cells. Centre sampling on non-downscaled axes keeps
  today's crisp output and existing fixtures byte-identical.

### Verification

- `src/core/job/compile-job-raster-fine-lines.test.ts` drives the real compile
  path with 1-3 px white lines at 40 px/mm and 10 lines/mm, across the scan and
  along it, upright and rotated. Every line must leave white in proportion to
  its width and the white area must hold within 2 points. The across-scan and
  rotated tests FAIL on the former nearest-neighbour code (measured); the tone
  test passes on both by design, because nearest preserves average tone and
  only moves the lines.
- `compile-job-raster-rotated-fidelity.test.ts` pins the rotated cases: thin
  Threshold strokes survive every quarter turn at 300 DPI and 15 px/mm as they
  do upright, and Threshold is never averaged at 20 and 40 px/mm (both
  mutants — Threshold routed to the area kernel upright, or the rotated guard
  removed — fail it, measured); quarter-turned tone images keep every sub-cell
  white line at 11.8, 15, 19, 25 and 35 px/mm and under non-uniform scale;
  1:1 and Pass-Through (also non-uniformly scaled) read the source untouched;
  a 40 px/mm quarter turn reduces to exactly the burn grid; a flat tone stays
  flat at 30 deg.
- `luma-resample.test.ts` checks exact weights, constant input at non-integer
  ratios, byte identity with nearest on non-downscaled axes and for the
  nearest kernel, and streamed-row parity. `compile-job-raster-stream.test.ts`
  pins streamed vs materialized parity for a downscaled source under every
  kernel.
- Warning tests: `raster-energy-warnings.test.ts` (unbound 25 lines/mm, the
  max-feed cap, quiet at 10 and 14, Pass-Through, a preset-bound layer that is
  2.5x hot, clearing once power, speed or the preset match, extra passes shown
  against the preset, the artwork override named, a Pass-Through preset
  ignored, copies said once, zero power, a profile without a spot size, and
  the advisories leading the older warnings), `raster-threshold-warnings.test.ts`
  and `stacked-copy-warnings.test.ts` (content identity, rotation, rotated
  footprints, traces, output off). `raster-adjusted-display.test.ts` covers the
  adjusted grey tone and transparency.
- Two adversarial review rounds (four reviewers each, every finding
  re-reproduced by a separate skeptic) drove the design above: the first found
  the rotated lattice, the Threshold tie, the warning reference and identity
  problems and the cache thrash; the second found the remaining rotated
  quarter-turn loss, the untested Threshold routing, the per-frame cache key
  and the Save toast ordering. All are fixed and pinned by the tests above.
- Live check in the app: a line-art image at brightness -40 draws its white
  lines at luma 149 on the canvas (the burn tone is 153) while an unadjusted
  copy draws them at 248.
- **NOT verified:** no hardware burn. There is no machine here. The physical
  fill-in figures in the context come from a spot model driven by the real
  emitted G-code, not from material. The operator's own lines/mm, power, speed
  and object count are unknown, so which of the causes dominated their burn is
  not established.
