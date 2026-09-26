## ADR-238 Amendment 3 - Generic Scan Line overscan stops at the field's 25 mm maximum (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

Amends ADR-238 Amendment 2. Changes nothing in ADR-234's 4040-safe policy.

### Context

Amendment 2 made generic Scan Line apply the operator's stored Overscan in full, where it had been
held to 5 mm. The Overscan field stops at 25 mm, but nothing else did:

- the LightBurn import converts percent × speed with no cap;
- project load accepts any non-negative value.

A LightBurn fill at 1000 mm/s with 5 % overscan became a 50 mm laser-off lead on each side, and
gaps up to 100 mm were crossed at burn feed. With artwork near the bed edge that can reach a soft
limit mid-job, or a hard stop on a machine without limits. The Frame does trace the larger area.
The 2026-09-25 audit of PRs #845-#904 found this (LBG-5).

### Decision

1. Generic Scan Line applies a stored Overscan in full up to `MAX_FILL_OVERSCAN_MM` (25 mm), the
   field's maximum, and applies a larger stored value at 25 mm. Output, preview, Frame bounds, the
   estimate and the heat-risk check all read that one effective length.
2. The LightBurn import stores a converted runway above 25 mm at 25 mm. Its import warning gives
   the converted length and the stored one.
3. Project load keeps whatever value was saved, so opening a project never rewrites it. Job Review
   shows "applied at most 25 mm" beside a stored value above the maximum.

### Consequences

- An imported or hand-edited Overscan can no longer drive the head tens of millimetres past the
  artwork on every sweep.
- A machine that needs more than 25 mm of runway at its speed cannot get it from generic Scan
  Line, the same limit the field already set.
