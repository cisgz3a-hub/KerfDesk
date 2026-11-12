## ADR-127 Amendment 6 - The old-project rotary notice reads a Fill's real hatch angles (2026-11-12)

**Status:** Accepted. | **Date:** 2026-11-12

Amends ADR-127 Amendment 4, Decision 2. Code quality audit C2 D6 raised this; the refuter rated it
P2.

### Context

To decide whether a 1.0.30 project's rotary burn changed, Amendment 4 reads the directions each
operation burns in. For a Fill with a cross-hatch, or with an angle change between passes, it added a
flat 90° (straight round the part) beside the hatch. The compiler does something else:

- A cross-hatch runs at the hatch angle plus 90° (`fill-hatching-cache.ts`).
- Turned passes run at the base angle plus one step per pass (`fillHatchPassRuns`).

So the notice over-stated the change. On a 40 mm-per-turn chuck with an Ø80 glass (k = 0.159), the
refuter measured from compiled strokes:

| Fill               | Notice said | Real change |
| ------------------ | ----------- | ----------- |
| 45° cross-hatch    | 6.28×       | 1.40×       |
| 30° cross-hatch    | 6.28×       | 1.93×       |
| 3 passes, 30° turn | 6.28×       | 3.32×       |

The notice asks the operator to retune. An operator who lowered power by 6.28× would under-burn.

### Decision

A scanline Fill's directions are the angles of its pass runs (`fillHatchPassRuns`). A cross-hatch
adds each run's angle plus 90°. The dose change of each direction and the threshold are as in
Amendment 4.

### Consequences

- The notice now gives 1.40×, 1.93× and 3.32× for the three cases above.
- A 0° cross-hatch still gives 6.28×, because its second hatch runs straight round the part.
- Tests compute the expected change from the angles alone, independent of the code.
