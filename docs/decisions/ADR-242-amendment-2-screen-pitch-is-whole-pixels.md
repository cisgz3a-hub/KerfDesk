## ADR-242 Amendment 2 - Image Studio's screen pitch is whole pixels (2026-11-12)

**Status:** Accepted. Amends ADR-242 Amendment 1 (screens track tone on the pixel grid). Fixes
Oracle audit O1 finding O6-P3-1 (P3). Compile, Frame, Start and output policy are unchanged. |
**Date:** 2026-11-12

### Context

Amendment 1 gave Halftone (Dots) and Line Screen (Newsprint) a threshold array at 0° and 90°, so
coverage tracks ink to the nearest 1/s² and solid black stays solid. That holds only for a whole
pixel pitch s. The pitch fields step by 1 px, but their number boxes only clamp, so a typed
decimal reached the screen unchanged. With a fractional pitch the cells land on the pixel grid
unevenly, the array is skipped, and the spot test ties again. The audit measured these errors on
flat patches:

| Pitch | Line, max error | Dots, max error |
|---|---|---|
| 4.5 px, 0° | 11.0% | 8.7% |
| 8.5 px, 0° | 5.9% | 3.2% |
| 7.07 px, 45° | 7.7% | 7.6% |

A 6.4 px line screen also left solid black only 96.9% black. Whole-pixel pitches were within
1/(2s²) on the axes and within 0.55% at 45°.

### Decision

`halftoneScreenInPlace` rounds the pitch to whole pixels (minimum 2), so it matches the step the
fields offer. A typed 4.5 screens exactly as 5, and an integer pitch screens exactly as before.

### Consequences

- Every pitch the dialog accepts keeps Amendment 1's guarantees: tone to the nearest 1/s², and
  solid black stays solid.
- Output changes only for a typed fractional pitch, which now screens as the nearest whole pitch.
