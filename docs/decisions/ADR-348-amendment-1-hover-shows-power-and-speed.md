## ADR-348 Amendment 1 - Hovering artwork also shows its power and speed (2026-10-19)

**Status:** Accepted. Amends ADR-348 decision 5 (hover size readout). | **Date:** 2026-10-19

### Context

The maintainer asked for the hover readout, which shows a piece's name, size and position, to
show its power and speed too. Checking a setting otherwise means selecting the piece and reading
the operation, which is a click and a look away from the canvas.

### Decision

1. **On a laser, the readout adds the power and speed the piece runs at.** One line reads
   `Power 30% · Speed 1500 mm/min`, below the size and position.
2. **The numbers are what output uses, not only the operation row.** They are resolved the way
   compile does: the piece's own override (`effectiveOperationForObject`, including per-operation
   entries), then its power scale (`effectiveObjectPowerPercent`). A Grayscale image (or one using
   "Use original pixels", which burns as Grayscale) shows its range, `10–60%`, when its minimum
   power is above zero. Every dither burns full power or nothing, and Line and Fill burn at the
   peak, so they show one number: the rule Advanced artwork settings uses for its grayscale
   minimum. A speed above Output max feed shows the capped speed, marked `(capped)`, because
   compile caps it there.
3. **Each run gets a line.** The operation and each enabled sub-operation, as
   `outputOperationLayers` returns them. Identical lines collapse, at most three show, and the
   rest read `+N more settings`. With more than one line, each starts with its operation's colour
   dot, the colour the hover pulse shows (ADR-620).
4. **Nothing to run says so.** A piece with no operation reads `No operation`; one whose
   operations all have Output off reads `Output off`; a trace's source bitmap, which compile
   always skips, reads `Trace source, not output`. Vector artwork on an Image operation, or a
   bitmap on a Line or Fill operation, which compile also skips, reads
   `Not engraved: operation is in Image mode` (or `Line` / `Fill`), in the words of Job Review's
   layer-mode warning. The runs come from `artworkOutputRuns`, the filter Advanced artwork
   settings already applied, so the two cannot disagree about what burns.
5. **Locked artwork answers for itself.** The readout hit-tests with `includeLocked`, like the
   hover pulse (ADR-620), so pointing at a locked piece names it and its settings, not the piece
   beneath it.
6. **The readout stays on the canvas.** Near the right or bottom edge it flips to the pointer's
   other side on that axis, judged by its largest size (320 px wide, one line per setting).
7. **CNC projects are unchanged.** Power is not a CNC setting, and a CNC feed can come from a
   stage or recipe, so the readout adds nothing there rather than a number the job might not use.

### Consequences

- The readout stays a DOM overlay with `pointer-events: none` and `aria-hidden`, still computed
  only after the 140 ms dwell. Resolving settings for one piece is a few lookups.
- The readout's max width grows from 220 to 320 px, so an Image range with a capped speed fits
  on one line.
- No machine gate changes: a completed Frame for the reviewed job remains the sole ordinary Start
  policy gate (ADR-565).

### Verification

- `hover-output-settings.test.ts`: operation power and speed; override and power scale applied;
  Image range and capped speed; enabled sub-operations listed, a disabled one left out; identical
  lines collapsed and the list capped at three; `No operation`, `Output off` and a trace source;
  nothing on CNC.
- `hover-output-settings.test.ts` (audit follow-up): a threshold, ordered or Floyd-Steinberg
  image shows its peak only, while "Use original pixels" shows the range; vector artwork on
  Image and a bitmap on Fill read `Not engraved: …`, also when an artwork override sets the mode.
- `HoverSizeReadout.test.tsx`: hovering a piece shows `Power 30% · Speed 1500 mm/min`; a locked
  piece is named over the piece beneath it; in the canvas's far corner the chip flips to
  `translate(-100%, -100%)`.
- **NOT verified:** on hardware.
