## ADR-699 Amendment 1 - A ramped Fill on a rotary scans along X

**Status:** Accepted (rolling audit v14 Z3-P1-1, P1, confirmed; fix requested by the audit
coordinator 2026-11-11). Amends ADR-699 Decision 2 and applies ADR-492 Decision 9 to ramped
Fills. | **Date:** 2026-11-11

### Context

A ramped Fill burns as a raster at its hatch angle (ADR-699 Decision 2). Images on a rotary
scan every pass along X (ADR-492 D9), because the rotary map scales Y and keeps only rows
along X straight. The ramp had no such rule, and the rotary map then read the turned raster's
scan-frame bounds as bed Y in two places:

- `mapRasterGroup` stretched those bounds round the part.
- `jobYRange` took them as the job's lowest bed Y, so every other layer moved too.

The audit measured the result. A 20 mm square ramped at 45° on the A1 Pro's A rotary burned
about 45 mm along and 134° round from where it was drawn, at 116 % dose. A Line layer beside
it moved 160° round the part. On a Y port, 5–20° passed every check and burned in the wrong
place, and 30° or more was refused with a false "wraps N turns".

### Decision

1. **Compilation.** When the rotary is on, a ramped Fill scans every pass along X in one
   direction, as an image does (`rotaryRampLayer`). Its hatch angle, Cross-hatch and angle per
   pass are set aside. When any of them asked for something else, Job Review says so
   (`fill-ramp-scan-angle-rotary`). A ramped Fill already at 0° stays silent. Fills without a
   ramp are vector hatches, which the map scales correctly at any angle, so they are unchanged.
2. **The rotary map never reads scan-frame bounds as bed Y.** `jobYRange` takes a raster's
   extent from its machine-frame corners. `mapRasterGroup` refuses a raster scanned at an
   angle, which compilation can no longer produce, rather than stretch it round the part.
3. **The ramp grid is cropped to the artwork.** The empty one-cell margin around the grid is
   needed only for the distance field. Without the crop it put the raster's bounds a cell below
   the artwork, and a rotary rebasing on the job's lowest Y moved every layer by one line
   interval. The burned cells and every burn move stay byte-identical; only the raster's size
   comment changes.
4. **Wording (Z3-P3-4).** The rotary row-step warning calls a ramped Fill a Fill.

### Consequences

- `emit-gcode-rotary-fill-ramp.test.ts` covers Y-port, A and Z rotaries, from Absolute and
  Current Position. On each, a ramp at 45°, at 30° with Cross-hatch, or with 45° per pass emits
  exactly the 0° program. A Line layer beside a 45° ramp lands where it lands alone.
- The ADR-699 golden snapshots change only in their `; N x M px` comment lines.
- Off the rotary, a ramped Fill keeps its angle as before.
