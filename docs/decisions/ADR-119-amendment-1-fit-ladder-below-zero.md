## ADR-119 Amendment 1 - The fit ladder can start below zero, and the margins orient the strips (2026-11-12)

**Status:** Accepted (Oracle audit O1, area O4, finding O4-P2-1; standing instruction to fix confirmed P2 findings). | **Date:** 2026-11-12

### Context

ADR-106 and ADR-116 leave laser kerf to the cutting layer: the generator draws nominal panels and the
compile-time kerf offset widens outlines and narrows holes. A new layer's kerf offset is 0
(`LAYER_DEFAULTS.kerfOffsetMm`). On such a layer the beam removes about half the kerf from every
cut edge, so each tab comes out one kerf narrower and each notch one kerf wider than drawn: the
physical play of a joint drawn with clearance `c` is about `c + kerf`.

The Box Generator already accepts a negative clearance for closed, open-top and open-front boxes
(`|c| < min(cell, T)/2`, "a negative c grows tabs into a press fit"). The Box Fit Test did not:
it refused a ladder start below 0 and its default ladder runs 0.05 to 0.30 mm. On a laser layer
without a kerf offset every rung was therefore loose by at least the kerf, and no rung could
press right, although ADR-119 promises that the rung that feels right is the number to type.

For comparison, boxes.py bakes its own kerf correction into every part: its `burn` setting is
half the kerf, defaults to 0.1 mm, and "bigger values make a tighter fit" (boxes.py user manual).
MakerCase offers a kerf compensation choice whose default is none.

ADR-119 Decision 1 also describes "i+1 index nicks (1 mm square)" under each rung. The shipped
coupon never cut them: any small notch has reflex corners the CNC relief pass would sliver, so
the rungs are identified by the strip's asymmetric margins (half a finger at the start, two
fingers at the end), as the code and the dialog text say.

### Decision

1. The ladder start may be negative. The same bound as the Box Generator applies at both ends:
   the first rung must satisfy `-start < min(f, T)/2` and the top rung `top < min(f, T)/2`. A
   non-finite start is refused. Rung `i` keeps the production law (tab `f − cᵢ/2`, notch
   `f + cᵢ/2`), so a negative rung has a wider tab and a narrower notch.
2. The Ladder start field no longer carries a native minimum of 0; core validation bounds it.
3. On a laser the dialog says to cut the strips on the layer the box will use, and that a first
   rung that is already loose means the layer is not compensating for kerf: start the ladder below
   0 or set the layer's kerf offset.
4. The default ladder is unchanged (0.05 mm start, 0.05 mm step, 6 rungs). Whether a laser
   should default to a ladder that straddles zero is left to the maintainer.
5. Rungs are identified by the margins only. The index nicks of Decision 1 are withdrawn.

### Consequences

- A laser user with no kerf offset can find the press fit the Box Generator can cut, in one
  coupon, instead of being stuck at a loose rung 0.
- Coupons with a start of 0 or more are byte-identical to before.
- Regression tests: `fit-coupon.test.ts` (negative ladder geometry and bounds) and
  `BoxFitTestDialog.test.tsx` (negative start accepted, kerf hint shown).
