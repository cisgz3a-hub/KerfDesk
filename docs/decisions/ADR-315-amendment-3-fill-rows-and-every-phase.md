## ADR-315 Amendment 3 - A 0° Fill's rows are checked against the rotary's steps, and offered intervals must fit at every phase (2026-11-11)

**Status:** Accepted. | **Date:** 2026-11-11

Amends ADR-315 Amendments 1 and 2. The check stays advisory. Rolling audit v14 area Z3 raised these
(Z3-P2-1, Z3-P3-1 and Z3-P3-4), and its refuter confirmed them.

### Context

- **Z3-P2-1.** A scanline Fill's hatch lines that run along X are rows round the part, written to
  3 decimals and stepped like an image's rows. The check looked only at image layers. On an Ø150 bowl
  in the Creality chuck, the default 0.1 mm hatch burns 96 of 300 rows twice. On Ø80 a 0.05 mm hatch
  burns 218 of 600 twice. Job Review said nothing, while an image at the same pitch warned.
- **Z3-P3-1.** An offered interval was judged with work zero on a whole step only. The A1 Pro's
  one-step 0.0784 mm drifts half a step across a photo. At about half the places a photo can sit, one
  or two rows double, and the warning then stays silent.
- **Z3-P3-4.** The warning named layers by their internal id ("Image layer operation-…"). It also
  called a ramped Fill an image and pointed at its line interval.

### Decision

1. **Fills are checked too.** For every scanline or island Fill group, the check reads the rotary
   positions of its hatch lines that run along X from the machine-space job. Those positions already
   include the placement anchor, Reverse and any taper. The rows go through the same 3-decimal and
   step model.
   - A cross-hatch's other pass and any angled hatch are not rows.
   - The advice is worded on the Fill's **Interval**. Candidate Intervals are hatch rows `n` steps
     apart, checked as typed at 4 decimals.
2. **Every phase.** An interval is offered only when its rows land evenly at 8 phases across one
   step, so wherever the artwork puts work zero against the grid. When none does, the closest is
   named, with the doubled-row count of its worst phase.
3. **Names.** The warning looks up the layer's name, as the Max-feed warnings do. A ramped Fill is
   called a Fill layer and advised on its Interval.

### Consequences

- An Ø150 bowl with a 0° Fill now warns: "Fill layer … so 96 of its 300 rows land on the row before
  and burn twice". On Ø80 at the default hatch, the Interval it names lands every row when typed.
- The A1 Pro is now offered 0.1569 mm (2 steps) only, which is clean at every phase.
- On Ø150 at 80 steps/mm, the closest image interval now reports its worst phase: 15 of 204 rows,
  where phase 0 alone gave 7.
