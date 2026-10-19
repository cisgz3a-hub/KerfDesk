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
   entries), then its power scale (`effectiveObjectPowerPercent`). An Image shows its range,
   `10–60%`, when its minimum power is above zero; Line and Fill burn at the peak, so they show
   one number. A speed above Output max feed shows the capped speed, marked `(capped)`, because
   compile caps it there.
3. **Each run gets a line.** The operation and each enabled sub-operation, as
   `outputOperationLayers` returns them. Identical lines collapse, at most three show, and the
   rest read `+N more settings`. With more than one line, each starts with its operation's colour
   dot, the colour the hover pulse shows (ADR-620).
4. **Nothing to run says so.** A piece with no operation reads `No operation`; one whose
   operations all have Output off reads `Output off`; a trace's source bitmap, which compile
   always skips, reads `Trace source, not output`.
5. **CNC projects are unchanged.** Power is not a CNC setting, and a CNC feed can come from a
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
- `HoverSizeReadout.test.tsx`: hovering a piece shows `Power 30% · Speed 1500 mm/min`.
- **NOT verified:** on hardware.
