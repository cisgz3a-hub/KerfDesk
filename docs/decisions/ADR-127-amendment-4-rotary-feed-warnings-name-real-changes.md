## ADR-127 Amendment 4 - The rotary feed warning and the old-project notice name only changes a burn can show (2026-11-11)

**Status:** Accepted. | **Date:** 2026-11-11

Amends ADR-127 Amendment 3. Rolling audit v14 Z3-P3-2 and Z3-P3-3 raised these, and its refuter
confirmed them.

### Context

- **Z3-P3-2.** On a taper, the warp leans rows that run along X away from its pivot row. At a layer
  speed equal to the Max feed, each of those rows is held back by a hair.
  - The warning fired on any rise above 1. It said "They burn up to 100 % … set this layer to 5999
    mm/min" where the measured dose was 100.0 %.
  - It also added "most at the narrow end" whenever a taper was on.
  - The A/Z axis-rate warning (ADR-695 Amendment 1) used the same test.
- **Z3-P3-3.** The old-project notice fired for any 1.0.30 rotary project with line, cut or fill
  output, and printed `1 / k`.
  - A 0° Fill, or lines along X, emit the same bytes as 1.0.30, yet the notice said "up to 6.28×".
  - A placeholder roller held at the Max feed changed by 0.25×, but the notice said 0.22×.

### Decision

1. **A rise must show.** Both warnings fire only when the rise rounds above 100 %. "most at the
   narrow end of the taper" is said only when the worst held move is in the narrow half of the
   taper.
2. **The notice reads the strokes.** For each object and output operation, the notice takes the
   directions it burns:
   - a Fill's hatch (and across it for a cross-hatch or a turned pass);
   - an imported outline's own edges;
   - for any other object, a stroke round the part.

   For each direction it takes the dose change `max(Ls / Lm, speed / Max feed)`. The notice is
   raised only when some change exceeds 1 %. It names the largest increase on a `k < 1` rotary and
   the smallest on `k > 1`.

### Consequences

- A tapered 0° Fill at the Max feed no longer warns. A real hold still does, with its narrow-end
  words when they are true.
- A 1.0.30 project that only fills at 0°, or only burns along X, opens without the notice.
- The placeholder-roller case now says "as little as 0.25×".
- The notice reads geometry, not a compiled job. Text, shapes and other objects are assumed to have
  strokes round the part, so their notice can still fire when, say, a text is all horizontal.
