## ADR-052 Amendment 2 - Every row of a two-way scan moves half the gap, so both directions burn on the design (2026-11-08)

**Status:** Accepted. | **Date:** 2026-11-08

Amends ADR-052's Decision ("We correct reverse rows only") and the alternative it rejected ("Split
the offset half-to-each-direction"), and the sentence of Amendment 1 Decision 2 that says the
compensation "does not change where the artwork burns". Amendment 1's placement rule is unchanged.
Found by the 2026-11-08 pro loop audit (`docs/audits/2026-11-08-pro-loop-v1/L7-scan-offset.md`,
L7-P2-1); the maintainer chose LightBurn's rule on 2026-11-08 ("follow lightburn"). No Frame,
Start, output or licence gate is added or removed (ADR-228, ADR-565).

### Context

ADR-052 moved reverse rows only, on the reasoning that "forward rows and all vector cuts stay at
exact design coordinates". Forward rows do not burn at design coordinates. The firing delay of the
tube or diode driver, and the slack in belts and drives, displace every scan row along its own
travel: forward rows one way, reverse rows the other, by the same distance when the delay is the
same in both directions. That is why the measured gap between the two directions is twice what each
row is off. LightBurn's Scanning Offset guide: "You will need to enter half the measured distance
between lines — LightBurn moves each line by the amount you specify, so each pair of lines only needs
to move half the distance"
([LightBurn 2.2 docs, Scanning Offset Adjustment](https://docs.lightburnsoftware.com/latest/Guides/ScanningOffsetAdjustment/),
fetched 2026-11-08). Its separate Initial Offset exists for an engraving that is still shifted
"relative to vector cuts or engravings".

Moving reverse rows by the whole gap laid them on the forward rows, which stand half the gap off the
design. A calibrated fill or image therefore burned half its table value off its own Line outline
and off every vector cut in the job, along the forward scan direction: 0.15 mm for a 0.3 mm entry.
The coupon could not show it, because it measures the two directions against each other.

### Decision

1. **In a two-way scan every row moves half the table value along its own travel.** Forward rows
   move one way and reverse rows the other (`scanRowShiftAlongTravelMm`, `rasterRowShiftX` in
   `src/core/job/scan-offset.ts`). The gap between the two directions changes by exactly the table
   value, as before, so a table that closed the zipper still closes it, and both directions now
   burn on the design.
2. **The table keeps its meaning.** A stored value is still the full signed forward-to-reverse
   separation with the same sign. A LightBurn Line Shift is still saved doubled, and now moves each
   row by the Line Shift, as LightBurn does.
3. **A fill moves when its hatch has a reverse row; an image when it scans both ways.** A
   unidirectional fill or image is not moved, as before.
4. **Every twin moves together:** fill sweep planning (output, Preview, estimate, heat risk, start
   point, path optimisation), raster emission and toolpath steps, the first process point, Start
   bounds, and burn, motion and Frame bounds. Placement still measures rows at design (Amendment 1).

### Consequences

- With a scan-offset table or a layer offset, every two-way fill and image emits its forward rows
  half the value along their travel and its reverse rows half the value back. Without one, output is
  unchanged.
- Frame and motion bounds reach half the value past each side of a two-way scan instead of the whole
  value past one side.
- Machines calibrated before this change keep their tables and their zipper-free result; their
  calibrated fills and images move half the table value onto the design. The update notes should
  say so.
- The emitter revision advances to `scan-offset-half-each-row-20261111-v45` (v43 was held for this change while it waited; v44 went to ADR-159 Amd 3).
- Code and test evidence only. Nothing was burned or run on a machine.

### Verification

- `src/core/job/scan-offset.test.ts`: the row-shift helpers move both directions half the value,
  change the gap by exactly the value (property test), and leave a one-way scan alone.
- `emit-raster-scan-offset.test.ts`, `grbl-strategy-scan-offset.test.ts`,
  `grbl-strategy-raster-calibration.test.ts`, `job-bounds.test.ts`, `job-placement-bounds.test.ts`,
  `bidirectional-runway-kinematics.test.ts`, `split-runway-controller-grid.test.ts`, the start-point
  and toolpath suites and `prepare-output-scan-offset-placement.test.ts` pin forward and reverse rows
  half a value each side of the design, Preview equal to the emitted program, and bounds that contain
  the emitted rows.
