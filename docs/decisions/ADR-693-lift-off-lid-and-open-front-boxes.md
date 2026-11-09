## ADR-693 - Lift-off lid and open-front box styles

**Status:** Accepted (maintainer request, 2026-11-10: "audit my box generator and if it's well
developed with parts that fit right add more boxes"). Builds on ADR-106 (claim-model joinery),
ADR-116 (cutouts, dividers, slide lid; this takes the "lift-off lip lid" it deferred) and ADR-119
(assembled preview). Burn, G-code, Frame and Start are unchanged. | **Date:** 2026-11-10

### Context

The 2026-11-10 audit found the generator's joint model sound: one shared finger sequence per edge,
one owner per corner cube, a uniform −c/4 clearance offset, reachable CNC dogbones, and referees
plus a sampled 3D occupancy test that check the output against the size the operator asked for.
Its one fit defect, the slide lid's back slit, is fixed by ADR-116 Amendment 1. The generator had
three styles: closed, open top and slide lid. Two common boxes were missing: a box with a lid that
lifts straight off, and an open-fronted cubby or shelf unit.

### Decision 1 - Lift-off lid (`lift-lid`, 7 parts)

- An open-top body whose walls stand bottom + cavity + one lip band, plus two loose plates: the
  **Lid** (the full outer footprint, resting on the wall rim) and the **Lid lip** (glued centred
  under the lid, dropping inside the rim to locate it). Outer height = inner + 3T. The entered inner
  height stays the usable cavity under the lip; dividers stop under it.
- The body is built and proved as an ordinary open-top box on a surrogate spec, as the slide lid
  does. Every body joint keeps the ADR-106 proofs.
- Lip fit: the opening is bounded by the walls' inner faces, which are stock faces, not cut edges,
  so the fit offset cannot widen it. The lip is drawn play/2 smaller than the opening, and the fit
  offset takes off another play/2. The total play across the lip is the clearance, as in every
  other joint, with half on each side.
- Clearance must be greater than 0, because the lip has to drop in. The laser default rises to
  0.2 mm when this style is chosen, as it does for the slide lid.
- A new referee (`lift-lid-referee.ts`) checks the lid against the outer footprint, the lip against
  the opening less the full play, and that no wall rises past the rim. The sizes are re-derived from
  the entered dimensions.

### Decision 2 - Open front (`open-front`, 5 parts)

- A closed box without its front panel: a cubby, pigeonhole or shelf unit. The claim model omits
  the front. Corner cubes on the open side go to the top and bottom (Z priority), so the bottom and
  top run straight along the opening and the side walls finish flush with them.
- Depth adds only the back wall: outer depth = inner + T. The entered inner depth runs from the
  opening to the back wall.
- Dividers across the width stand on the bottom as usual. Their front end is a plain edge flush
  with the opening, and they tab only into the back wall. Dividers across the depth would close off
  the opening, so validation rejects them for this style and says why.
- The existing referees cover it: the assembly referee checks every present pair, and the divider
  referee now accepts the open front end only as one flush edge with no tabs.

### Verification

- Unit tests for both builders and the new referee, with negative controls: a lip with no play, a
  lid smaller than the footprint, a wall past the rim, a divider still tabbed at the open front.
- Both styles join the sampled 3D occupancy test (inner and outer dimensions, 0 to 2 dividers, and
  the fuzzed sizes), the CNC tool-reach test, the work estimate bounds, and the benchmark scorecard
  (open front in the seeded corpus and the divider grids; a new `lift-lid` category).
- Physical fit is not software-verifiable. Both styles land CLAIMED with a named hardware check:
  cut a 60 × 40 × 30 mm, T = 3 lift-off lid box and an open-front box with two dividers, then
  assemble them and lift the lid on and off.

### Out of scope

Hinged lids, living-hinge boxes, polygon prisms, drawers sized to an open-front case, finger-jointed
lid skirts and engraved panel labels stay deferred, as ADR-116 lists them.
