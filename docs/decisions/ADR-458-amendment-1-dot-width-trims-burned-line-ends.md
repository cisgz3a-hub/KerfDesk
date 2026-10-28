## ADR-458 Amendment 1 - Dot Width Correction shortens burned lines, not each power change (2026-10-28)

**Status:** Accepted on 2026-10-28 |
**Amends:** ADR-458 Context item 2 and decision 3, which describe Dot Width Correction as shortening
"each end of an exact-power run". It now shortens each end of a burned line.

### Context

Quality audit Q1, finding Q1-P1-1 (P1, confirmed by an independent refuter; report
`docs/audits/2026-10-27-quality-q1/Q1-raster-tone.md`):

- `rasterPixelRuns` splits a scan row at every change of exact S, and the sweep planner shortened
  every powered run at both ends, with an S0 move between runs.
- A dither or Threshold row holds only full power or 0, so equal neighbours merge and the
  correction only ever met an edge where the beam turns on or off. That is the dot edge it exists
  to pull back.
- Grayscale and Pass-through give neighbouring pixels different non-zero S. Every pixel whose S
  differed from its neighbour's burned only its middle, with a dark gap at each pixel edge, inside
  a line where the beam never switches off. At 10 lines/mm, Dot Width 0.02 / 0.04 mm left a
  Grayscale gradient 0.60 / 0.20 of its energy, and a photo 0.64 / 0.28.
- The canvas Preview, the Photo engraving preview and Job Review show the compiled S without the
  correction (ADR-670 Amendment 1 item 3), so they showed the full tone. The Job Review advisory
  fires only when a one-pixel run vanishes. A tone-calibration wedge, whose flat patches are one
  run per row, lost 0.4%, so calibration could not see the loss either.
- LightBurn 2.0's Image Mode page says the correction works "by shortening the length of engraved
  scan lines" (docs.lightburnsoftware.com/2.0/Reference/CutSettingsEditor/ImageMode/). The field's
  own hint reads "Compensate for physical laser dot width". A beam's width adds nothing where power
  changes inside a lit line.

### Decision

1. **A burned line is the unit.** Along a scan row, a burned line is a stretch of consecutive
   pixels with S > 0. Dot Width Correction shortens it by the correction where the beam turns on
   (after S0 or at the start of the sweep) and where it turns off (before S0 or at the end of the
   sweep). A change between two non-zero powers stays at its pixel edge and is never trimmed.
2. **Ends that pass a narrow run.** When the correction is wider than the exact-power run at a line
   end, the trim passes over it and that run gets no burn. A line no longer than twice the
   correction becomes one dark move, as a removed dot did before.
3. **Dithered output keeps its bytes.** A row of full power or nothing has one exact-power run per
   burned line, so its trims, coordinates and G-code are unchanged. Grayscale and Pass-through rows
   now change power at each pixel edge with no S0 between pixels.
4. **One rule for every reader.** `rasterSweepRunsForPixelRuns` (`core/raster-output`) plans the
   moves for the emitter, the route preview and the duration model, which all read the same sweep
   plan. `forEachRasterRunLostToDotWidthCorrection` applies the same trim to Image Studio's
   dot-width check and its horizontal repair. They report a run as lost only when a line-end trim
   consumes it, or when its whole line vanishes.
5. **The advisory stands.** Job Review's dot-width advice still compares the correction with half
   the horizontal pitch: that is exactly when a one-pixel burned line vanishes or keeps at most
   0.001 mm. Its text now says the correction shortens "each end of a burned line". The three Dot
   Width tooltips say the same, and that power changes inside a line are not trimmed.
6. **Emitter revision.** Grayscale and Pass-through bytes change, so `EMITTER_REVISION` becomes
   `laser-dot-width-line-ends-20261028-v38` (#1487 merged v35; open PRs #1491 and #1494 hold v36 and v37).

### Consequences

- A Grayscale photo with Dot Width Correction now burns the energy the Preview shows, less the
  correction at the two ends of each burned line. The Preview still leaves the correction out, as
  ADR-670 Amendment 1 item 3 says; the remaining difference is the same line-end trim dithers have
  always had.
- A Grayscale project burned with an earlier build at a non-zero Dot Width will burn darker with
  this one, closer to its Preview. A tone curve fitted from a wedge is unaffected: the wedge was
  never cut between pixels.

### Limits

- Whether LightBurn applies the correction in Grayscale at all is not established: its page names
  no modes. KerfDesk keeps the field for every mode and applies this one rule.
- The audit's side note on whether the value is a per-end or a total shortening is left to the
  next quality round; this amendment keeps the per-end value.
- Code and test evidence only. No physical burn or controller run is claimed.

### Tests

- `raster-power-runs.test.ts`: forward and reverse Grayscale lines trimmed only at their ends; two
  lines across a dark gap; an end trim passing a run narrower than the correction; a vanishing
  line; and 400 random on/off rows, which match the earlier per-run trim move for move.
- `grayscale-dot-width-line-ends.test.ts`: the bytes of a Grayscale line with Dot Width; a compiled
  256-pixel Grayscale gradient at 10 lines/mm, emitted by the GRBL strategy, keeps every power move
  and pixel edge with no gaps, and loses only the two end trims of each row at 0.02 and 0.04 mm
  (the previous planner fails it with the audit's 0.60 / 0.20).
- `compile-job-raster-pass-through.test.ts`: four one-millimetre Pass-through greys in one line
  burn 0.75, 1, 1 and 0.75 mm at a 0.25 mm correction, where each burned 0.5 mm before.
- `scan-quality-warnings.test.ts`: the advisory fires for a one-pixel dot the emitter removes and
  stays silent for a Grayscale line that keeps every power.
- `raster-output-run-loss.test.ts`, `editor-horizontal-mask-repair.test.ts` and
  `editor-kerf-output-parity.test.ts`: adjacent Grayscale powers in one line are not losses, and
  the prepared output keeps both; a one-pixel grey line and a run an end trim consumes are, and a
  repair that makes one is still refused.
- Dithered emitter bytes were compared before and after on 768 generated cases (six pitches, four
  offsets, eight corrections, both directions, M3 and M4, compact words, 45° scans): identical.
