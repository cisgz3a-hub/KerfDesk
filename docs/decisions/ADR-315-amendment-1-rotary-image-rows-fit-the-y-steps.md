## ADR-315 Amendment 1 - Job Review checks that rotary image rows fit the controller's Y steps (2026-11-10)

**Status:** Accepted. | **Date:** 2026-11-10

Amends ADR-315 Decision 4 ("One exact-job disclosure"). The physical-qualification warning stays
exactly as it is. A rotary job with an image may now get one more warning per image layer, about
row placement. Neither warning changes output, Frame or Start. Rolling audit v12 X8-P2-3 (refuter,
2026-11-09) raised this.

### Context

The controller places every image row on a whole Y step.

- **Flat bed:** one step is 0.0125 mm at 80 steps/mm, which divides any usual line interval.
- **Rotary:** Y is scaled by `k` machine mm per surface mm (ADR-127), so one step turns the part
  `1 / (k · $101)` surface mm.
  - **Ø80 glass in the Creality chuck at `$101 = 80`:** one step is 0.0785 mm. The default 0.1 mm
    line interval is then 1.27 steps, so rows land 0.079 or 0.157 mm apart, a stripe about every
    0.4 mm.
  - **Ø150 bowl:** one step is 0.147 mm, so about a third of the rows land on the row before and
    burn twice.
  - **Other step counts:** `$101 = 100` and `160` band too.

The program commands the right rows, the preview and inspector show even rows, and KerfDesk already
reads `$101`. The missing piece was the check.

LightBurn does not snap the interval. Its docs say nothing about it, and on its forum users fix
rotary banding by making the line interval fit the surface step: circumference divided by steps per
rotation ([forum](https://forum.lightburnsoftware.com/t/banding-lines-artifact-at-splice-edge/191033),
[steps per mm](https://docs.lightburnsoftware.com/1.7/Explainers/StepsPerMM/)).

### Decision

1. **One row-step warning per image layer** (`ui/laser/job-review/rotary-row-step-warnings.ts`).
   - **When:** an active rotary job has an image layer whose row pitch is not within 0.02 of a
     whole number of the live controller's Y steps on the part's surface.
   - **What it says:** the surface step, the line interval in steps, and the effect (the two gaps,
     or the share of rows that burn twice). It names the two intervals that fit, as lines/mm and
     mm: the nearest whole step count below the current interval and the one above it.
2. **When `$101` is unknown.** If the live controller reported no `$101`, one warning says the
   check could not be made and what to set.
   - A caller without a live session (the camera's transient job) checks nothing.
3. **Advisory only.**
   - The line interval is not changed: snapping would change the image's density, and so its
     darkness, without the operator choosing it. LightBurn does not snap either.
   - The `$101` value is read from the live controller when Job Review is built, as ADR-331's
     stream window is.

### Consequences

- The maintainer's photo-on-glass job on the Creality preset now names 12.73 lines/mm (one step) or
  6.37 lines/mm (two steps) before Start.
- Flat-bed, vector-only and CNC jobs, and rotary images whose interval already fits, get no new
  warning.
- **Not verified:** physical banding is predicted from the step model (`lround(y × steps/mm)`), not
  burned. The Falcon Y-port `$101` is assumed, so 80, 100 and 160 are all tested.
