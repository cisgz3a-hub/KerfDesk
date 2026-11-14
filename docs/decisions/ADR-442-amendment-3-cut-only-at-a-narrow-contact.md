## ADR-442 Amendment 3 - Cut only at a narrow contact or a seam; a knot is wood, not a hole (2026-11-15)

**Status:** Accepted. | **Date:** 2026-11-15

### Context

Amendment 2 cut pieces apart wherever two deep regions met. Each had to rise 3 mm above the depth
where they met and reach 5 mm from the bed. Camera audit v2 area K6
(`docs/audits/2026-11-14-camera-v2/K6-camera-fix-verify.md`) found that this splits ordinary blanks
(**K6-P1-2**, P1, a regression from #1925):

- bone-shaped tags (two 30 mm lobes, 14 mm neck), two-ball and snowman ornaments, peanut, guitar
  and hourglass offcuts each became two pieces, so every blank got two copies;
- a 70 mm square with a dark knot at its middle became two pieces. The knot was read as a hole,
  which left a ring of depth around it to split along, and its clean neighbours were flagged
  "larger";
- a 100 mm clock blank with an 8 mm centre hole became three pieces.

**K6-P3-1:** a knot off the middle stayed a hole, so the fit check left that blank out with "the
design runs 4.9 mm off this piece". And with the design on a merged pair flagged "larger", the
panel told the operator to put the design on a piece it was already on.

### Decision

1. **A neck is cut only at a narrow contact or across a seam** (`piece-split.ts`). Two solid blanks
   laid against each other touch at a point or along a sliver, or lie a hairline apart. They are
   never joined through solid wood as wide as a bone tag's waist. Two flooded regions therefore stay
   apart only when each reaches at least 5 mm from the bed, and either:
   - the depth where they meet (the contact's half-width) is at most 0.4 of the shallower region's
     depth. Two discs touching meet through the sliver the blur and the close bridge beside the
     touch, about √(gap × radius) wide. Measured: 0.18–0.31 for coasters 40–90 mm across (the most
     on a low-contrast MDF bed), against 0.48 for a bone tag and 0.51 for a snowman ornament.
     Peanut, guitar and hourglass offcuts are wider still; or
   - within 2.5 mm of where they meet, the pieces' feature dips at least halfway from their level
     down to the split. That is the seam of blanks laid 1 mm apart that the close bridged. Filled
     knots (point 2) do not count, and neither does a meeting across one flat top (at 0.95 of the
     depth or more).

   The first, highest meeting of two regions decides. Lower meetings along the same seam may miss
   its dip, and they no longer join what it kept apart. When in doubt pieces stay whole: a merged
   pair is doubted by its size, while a cut blank would take two copies.
2. **A hole is where the bed shows through** (`piece-holes.ts`). After cleaning, every region the
   mask leaves out that a single piece encloses is compared with the bed's colour. When it differs,
   the region is the piece's own material (a knot, a burn, a printed mark) and is filled in. This
   happens before the depth, the neck cut, the holes and the placement point are measured.
   - The colour is judged on the region's core (pixels with no piece pixel beside them), so the wood
     blurred into its edge does not count. A thin gap between blanks has no core and is never
     filled.
   - The tolerance is the bed's own pixel-by-pixel spread (its 95th percentile), so a honeycomb's
     bright walls and dark cells seen through a gap still count as bed.
   - A real hole, such as a clock blank's, shows the bed and stays a hole.
   - A region enclosed by more than one piece (a mark between blanks touching at their corners) is
     never filled, so it joins nothing.
3. **The design on a doubtful piece** (`PiecesControl`). When the design sits on a piece left out as
   doubtful and no copy fits, the panel says so: the piece may not be one piece. It does not tell
   the operator to put the design on a piece.

### Measured (synthetic top-down scenes, no camera)

- **Waisted blanks, six of each:** bone tags, peanut, guitar and snowman offcuts give 6 pieces and
  one copy per blank (#1925: 12 pieces, 2 copies each). Hourglass offcuts: 2 for 2.
- **Knot and hole:** 70 mm squares with a dark knot at the middle give 6 pieces, with no hole, no
  doubt and the placement point at the centre. On 100 mm blanks with an 8 mm hole showing the bed,
  the hole is kept.
- **Amendment 2's cases hold:**
  - pairs on honeycomb separate from 2 mm;
  - 12 packed coasters (1.5 mm gaps) give 12 pieces, and 15 tiles 1 mm apart give 15;
  - L, ring and frame offcuts, the glare sweep, scorched MDF in every mode and long shadows are
    unchanged;
  - the 48 turned tags and the accuracy set are unchanged.

### Consequences

- A product made of two lobes joined by a bridge narrower than about 0.4 of the lobes' depth is
  still read as two pieces touching. So is a blank with a dark crack or line fully across it.
- If blanks touch along a wider contact with no visible seam, they stay one piece. In a batch they
  are doubted "larger" and start left out.
- On a honeycomb bed a dark knot can still match the bed's spread and stay a hole. That is the safe
  direction: the fit check leaves the piece out with its reason, and the neck rule no longer
  splits around it.
- A centred design on a clock blank still goes to the point of the wood furthest from every edge,
  beside the hole (Amendment 2). Whether a design should cover a small hole is a maintainer
  question the audit left open.
