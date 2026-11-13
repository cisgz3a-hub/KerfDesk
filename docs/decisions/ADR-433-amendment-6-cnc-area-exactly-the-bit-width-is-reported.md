## ADR-433 Amendment 6 - A CNC area exactly as wide as the bit is reported (2026-11-13)

**Status:** Accepted; software-verified through emitted G-code carved into an independent height
field. | **Date:** 2026-11-13

This amends ADR-433 (and Amendment 1, which sets the CNC threshold to the cut width at depth). Only
Job Review advisory text changes. No G-code changes, and nothing blocks Frame, Start or Save.

### Context

CNC audit v3 area N3 (`docs/audits/2026-11-13-cnc-v3/N3-adaptive-and-pocket.md`, N3r-P2-2, P2):
a pocket arm, channel or island gap exactly the bit's width was left uncut with no warning. A
25 mm × 6.35 mm arm stayed whole under a 6.35 mm bit; an island 6.35 mm from a wall left about
131 mm². The same layout 0.01 mm narrower got "the bit cannot enter it, so it stays uncut", and
0.001 mm wider was cut.

The two halves disagreed exactly at the tie. The pocket planner insets the region by exactly the bit
radius (`pocket-paths.ts`, `adaptive-pocket-sequences.ts`), so an area as wide as the bit collapses
to a zero-width line that the polygon library drops. The minimum-feature check reported only widths
strictly below the threshold.

Cutting the centre line instead would need an inset a hair under the radius for every pocket
strategy, moving every wall's emitted coordinates; that was not taken.

### Decision

1. `MinFeatureRequest` gains `widthTieMm`. Material up to that much wider than the threshold is
   reported. Gaps never take it: the cuts either side of a gap exactly the bit's width meet, so it
   is cut.
2. Every CNC target sets it to `CNC_WIDTH_TIE_MM`, 0.0005 mm: half the 0.001 mm G-code grid. A
   drawn 6.35 mm feature is caught whatever its floating-point error; a 6.351 mm one, which the
   planner cuts, is not.
3. When every reported area is that wide, the Pocket and Inside-profile line says "no wider than"
   and "no tool path enters it, so it stays uncut": the bit would fit, but no path is planned
   there. Narrower areas keep the existing wording.

### Consequences

- `min-feature-cnc-exact-width.test.ts` carves the emitted program: the exact-width arm and the
  island gap are uncut and now warned, an arm 0.001 mm wider is cut and not warned, and an Outside
  profile's gap exactly the bit's width is not reported.
- A lone slot exactly the bit's width, already refused with the empty-layer message, now also gets
  the narrow-area line.
