## ADR-410 Amendment 2 - Bevel offsets keep the offset distance at corners and line ends (2026-10-20)

**Status:** Accepted. | **Date:** 2026-10-20

### Context

ADR-410 item 3 maps Bevel to Clipper's bevel join, and gives an open line a butt (flat) end cap
under Bevel because LightBurn does not document caps. Measured on `main` at 99022764a, a 20 mm open
line from x 0 to 20, offset 2 mm outward, gives x -2..22 under Round and Corner but x 0..20 under
Bevel. The flat cap runs straight through both ends of the line. LightBurn presents Offset Shapes
as the way to make "cut lines around engravings", so a Bevel cut around a centreline trace (line
art, a signature) clipped the engraving at every line end.

What LightBurn documents, read on 2026-10-20:

- The Offset Shapes page (`docs.lightburnsoftware.com/latest/Reference/OffsetShapes/`) says that
  "Offset Distance controls the amount the new shape will be offset away from the original". It
  says nothing about the ends of open shapes, and neither does the older Modifier Tools page.
  Forum threads on offsetting a single line (for example "Drawing line offset", 2022) agree that
  an open line offsets into a closed shape around it, but none describes the ends.
- The page's Corner Style figure (`img/Ref-Offset-CornerStyles.png` in the 1.7 docs) draws Round,
  Bevel and Corner around a square. Measured on the 738 × 228 px image, the Bevel outline sits
  32-33 px from the square, its flat sides run on 13 px past each corner of the square (0.40 × the
  distance), and the bevel edge sits 32 px, the full distance, from the corner. A right-angled
  corner cut off square to its bisector at exactly the offset distance leaves flat sides that run
  on by tan 22.5° = 0.41 × the distance, which is Clipper's Square join. Clipper's Bevel join cuts
  between the two offset points instead: its flat sides stop level with the corner, and the cut
  passes 0.71 × the distance from a right-angled corner.

### Decision

1. **Bevel corners.** Bevel uses Clipper's Square join, for closed shapes inward and outward and
   for the bends of open lines. A corner pointing the way of the offset is cut off at exactly the
   offset distance, as LightBurn's figure draws it, so no point of the outline comes nearer the
   shape than the distance.
2. **Bevel line ends.** An open line under Bevel gets a square end cap: the outline runs the offset
   distance past each end. A line end is a 180° turn, and squaring a 180° turn at the distance
   gives that square cap. Corner already has it, because a 180° turn is past its mitre limit.
3. **Round and Corner** are unchanged. LightBurn's figure draws them as Clipper's round and mitre
   joins, and their caps (a half circle and a square) already clear the line's ends by the
   distance.

### Alternatives

- **A square cap with its two corners bevelled.** It would also keep the distance, but LightBurn
  documents no such cap and Clipper has no such end type. It would need geometry of KerfDesk's own
  beside Clipper for no documented gain over the square cap that the Square join gives a 180° turn.
- **Change only the open-line caps and keep Clipper's Bevel join for corners.** Rejected: LightBurn's
  figure cuts the corner at the distance, and the chord join cuts 0.29 × the distance nearer an
  engraving's corner than the user asked for.

### Consequences

- Bevel outlines grow a little. A 10 mm square offset 1 mm outward now has an area of 143.31 mm²
  instead of 142 mm², and a 10 mm line offset 1 mm has 24 mm² instead of 20 mm².
- Bevel and Corner now give the same outline around a straight open line. They still differ at
  every bend and corner.
- Only new offsets change. An offset is stored as a new object, so offsets already saved in a
  project keep their shape. Output, G-code, Frame and Start are untouched.

### Verification

- `src/core/geometry/offset-shapes.test.ts`: the Bevel square's area is 144 - 4 × (1 - tan 22.5°)² / 2,
  and its flat sides run on 2 × tan 22.5° mm past the corners at 2 mm. A 20 mm open line offset
  2 mm spans x -2..22 and y -2..2 under every style. For a straight line, a right-angle bend, a 17°
  hairpin, and an L shape offset both ways, no point on any outline edge (edges, not only their
  vertices, since a flat cap's corners sit exactly at the distance) is nearer the source than the
  distance, less the 0.025 mm machine curve tolerance that Round's chords may take. Each of these
  checks failed on the old mapping.
- `src/ui/commands/OffsetShapesDialogHost.test.tsx`: the dialog preview of a Bevel offset of a 20 mm
  line spans x -2..22 and reports 24.00 × 4.00 mm.
