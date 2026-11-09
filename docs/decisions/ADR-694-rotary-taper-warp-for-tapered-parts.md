## ADR-694 - Rotary taper warp for tapered parts

**Status:** Accepted. Fixes rolling audit v12 finding X8-P2-2 (missing feature; raised P2, lowered
to P3 by the refuter because nothing claimed taper support)
(`docs/audits/2026-11-09-rolling-v12/X8-rotary-complete.md`). Builds on ADR-127 (rotary Y
mapping, Amendment 1's placement anchor) and ADR-373 (roller diameter, Rotary Setup). Composes with
ADR-127 Amendment 2 (surface feed, rolling audit v12 X8-P1-1), which is being built in parallel.
Project schema 22. Tested in jsdom and by replaying emitted G-code onto a simulated cone. Physical
rotary output remains CLAIMED until a maintainer bench pass. | **Date:** 2026-11-10

### Context

KerfDesk wrapped a design round a part of one diameter. Tumblers and drinking glasses are usually
tapered. With a tumbler that is Ø80 at the rim and Ø70 at the base over 100 mm, and Ø80 entered as
LightBurn advises, a 20 mm square near the base burned 17.75 mm round the part, 11.3 % short. Text
along the cup fanned into a trapezoid. The measuring helper and the rotary tutorial named tapered
parts but never said the result would distort.

LightBurn has a **Taper Warp** tool (Laser Tools → Taper Warp,
https://docs.lightburnsoftware.com/2.1/Reference/TaperWarp/, read 2026-11-10). Its inputs are
**Object Top** (Top, Left or Right: "so LightBurn knows where the top and bottom of the taper
are"), **Top Diameter**, **Length** and **Bottom Diameter**, in millimetres. It "adjusts graphics
to compensate for the difference in diameter between the top and the bottom of the object". It
asks for the part to be held so the surface being engraved is parallel to the bed, and it "does
not account for different focal lengths". LightBurn's rotary pages say to enter the largest
diameter of a tapered part as the Object Diameter
(https://docs.lightburnsoftware.com/2.1/Reference/RotaryMode/RotaryModeDSP/), and its Full Wrap
Tumblers guide points tapered cups to Taper Warp
(https://docs.lightburnsoftware.com/2.1/Guides/FullWrapTumblers/). The pages do not give the
mathematics, which diameter stays unchanged, or how images are treated.

LightBurn applies Taper Warp once, to selected artwork, at design time. The maintainer asked for
this gap to be closed so it applies in every place the design is shown or run: the wrap preview,
Frame, G-code for cut, fill and image, the rotary bounds check and Job Review.

### Decision

1. **Inputs (LightBurn's).** `RotarySetup.taper` is optional: `enabled`, `topDiameterMm`,
   `bottomDiameterMm`, `lengthMm` (top edge to bottom edge, along the side), `topSide` (`left` or
   `right`) and `artworkFromTopMm`. LightBurn's third Object Top choice, Top, has no meaning on a
   Y rotary, whose axis lies along X. Which end is wider follows from the two diameters. The gap
   from the top to the artwork's top-side edge is KerfDesk's addition: LightBurn warps a selection
   in place, while KerfDesk warps at output time and must know where on the part the design lies.
   The operator measures it on the part after Frame.
2. **An output step, not a design edit.** The canvas stays surface-true, as it is for every rotary
   job. `machineSpaceJob` (ADR-127's single source) runs `applyRotaryTaperWarp` and then the
   existing Y scale. Emit (G-code and `.rd`), Frame, the canvas Frame outline, the estimate and
   the bounds check all call it, so they agree. A change in the part needs no change to the
   artwork.
3. **The warp.** The part is held with the engraved side level, so the head runs along the side
   and design X is distance along it, millimetre for millimetre. X is unchanged. Y becomes
   `y' = base + (y − base) · R / r(x)`. Here `r(x)` is the cone's radius at that point along the
   side. It is linear between the two ends and holds its end value past them, where the head is
   off the part anyway. `R` is Object diameter / 2, the radius the Y scale turns surface mm at.
   After the Y scale every point's machine Y is its angle round the part times one constant. So a
   design D mm tall burns D mm round the part at every height, and one turn of surface at any
   height is exactly one turn.
4. **Object diameter follows the wider end.** While the taper is on, Rotary Setup sets Object
   diameter to the wider end and disables the field (Machine Setup disables its copy too). This
   is LightBurn's own advice. On a chuck the output does not depend on it: R cancels against the
   Y scale. On a roller it must be the diameter where the rollers drive the part, and a part whose
   engraved side is level rests on its wider end.
5. **The pivot row.** A placed job's anchor row stays where the part already is (ADR-127
   Amendment 1). An Absolute job is rebased afterwards anyway, so it pivots on its middle row. A
   cone cannot keep both rows round the part level and strokes along the side on one straight
   line up the part. A point `a` mm round the part from the pivot row stays `a` mm from it at every
   height, so a stroke along the side leans by `atan(a · |dr/ds| / r)`: 2.3° at 30 mm from the
   pivot on the Ø80→Ø70 cup. Rows stay level, as a tumbler wrap needs. Anchoring a placed job at
   its centre keeps the lean smallest.
6. **Cut and fill.** Points are warped. An edge with an X extent becomes a curve and is split
   until each chord is within 0.001 mm of it. Arcs become chords, as the Y scale already does. A
   led contour's indices follow its points. Contour-entry bounds are warped by their corners. The
   factor is monotone in X, so the corners bound the result.
7. **Images.** A rotary scans images along X (ADR-492), and each machine row is one angle. The
   warped image is resampled. Output row k, column i, takes the source pixel whose design Y warps
   onto that row at that column's X. Pixels from outside the source are off. Rows keep their pitch
   in warped units, so the image gains as many rows as its Y extent grew. The surface pitch
   between rows is therefore finer than set where the part is narrower than Object diameter, by
   r/R (12.5 % finer at the Ø70 end). Streamed sources (ADR-243) are read forward, each row once,
   through a small window. The warped group is always a lazy row provider, so Frame, bounds and the
   estimate never resample.
8. **Bounds and the preview.** The bounds check reads the emitted program's Y span against one
   turn, which the warp makes the angle round the part, so it is taper-aware unchanged. It stays
   conservative across heights. The Rotary Setup preview gives one turn at the top and at the
   bottom. It checks the artwork's height against one turn where the part is narrowest under the
   artwork, which it finds from the gap and the artwork's width.
9. **Job Review and the switch** name the taper instead of one diameter: "Chuck, taper Ø80 → Ø70 mm
   over 100 mm". An enabled taper that cannot describe a cone makes the rotary's measurements
   unusable, as an unusable diameter already does. Rotary Setup's Apply is disabled and says why,
   and Job Review reads "not applied".
10. **Feed (ADR-127 Amendment 2).** The warp records its cone on the machine-space job as plain
    data (`Job.rotaryTaper`). `rotaryTaperYFactorAt(profile, x)` is the local multiplier on the
    rotary's Y scale. The surface-feed match must use the Y scale times this factor at a move's X,
    including on a surface-calibrated roller whose Y scale is 1. Without a taper the factor is 1.
11. **Saving and old projects.** Project schema 22 carries the taper. Step 21 is the identity: no
    earlier file has one. A 1.0.30 reader refuses a schema 22 file instead of burning a tapered
    part unwarped. Absent or off, the warp returns the same job object, so output is
    byte-identical. A golden set saved and emitted by the published 1.0.30 (five rotary setups,
    three placements, with cut, fill and image) emits the same bytes on this build. ADR-695's
    dedicated rotary axis landed first without a bump of its own; v22 covers both fields. A machine
    profile (`.lfmachine`) with an active taper is written as machine-profile schema 2, ADR-695's
    schema for a dedicated axis, so a reader without tapers refuses it instead of dropping the taper.
12. **Wording.** The strip helper says one reading is right only at that height: measure where
    the artwork goes, or both ends for Tapered part. The tutorial says the same and adds the focus
    advice. Neither promises a perfect burn on a taper.

### Consequences

- A tapered tumbler can be engraved true to size round the part at every height.
- Focus still changes along a taper. As in LightBurn, nothing corrects it, and the refuter judged
  it the larger error on a real tumbler. The guidance says to focus at the middle of the artwork,
  or keep the design short along the part; KerfDesk does not promise a perfect burn on a taper.
- Without the taper, the error depends on where the diameter was measured. The audit's −11.3 %
  assumed LightBurn's largest-diameter advice; KerfDesk's own advice (measure where the artwork
  goes) leaves about ±2 % across a 30 mm logo and ±6.7 % across a full-length wrap on the same cup.
- The G-code inspector's 3D wrap still draws a cylinder of Object diameter, and its dose shading
  does not yet read the taper. This is a follow-up and does not change output.
- The surface-feed match (ADR-127 Amendment 2, PR #1672) must multiply the Y scale by
  `rotaryTaperYFactorAt` at each move; whichever of the two lands second adds it.
- The design is not edited, so turning the taper off restores the untapered output exactly.

### Verification

- `src/io/gcode/emit-gcode-rotary-taper.test.ts` replays emitted G-code onto the Ø80→Ø70 cone in
  the Creality chuck (40 mm per turn). A 20 mm square burns 20.00 mm round the part on both of its
  edges, at the rim and at the base. Without the taper the base square burns 18 and 17.5 mm. One
  turn of surface at five heights runs exactly 40.000 machine mm. The top side and gap are
  honoured. A 230 mm design fits at the rim but warns at the base.
- `src/core/job/rotary-taper-warp.test.ts`: identity, pivot, densified curves, lead indices, the
  inverse used by the canvas Frame outline, raster resampling, forward-only streamed reads and
  descending row order.
- `src/io/gcode/returning-user-rotary-1-0-30.test.ts`: 15 programs byte-identical to 1.0.30, also
  with the taper saved off.
- Rotary Setup (`RotarySetupDialog.taper.test.tsx`), Job Review wording (`rotary-summary.test.ts`)
  and persistence (`project-rotary.test.ts`).
