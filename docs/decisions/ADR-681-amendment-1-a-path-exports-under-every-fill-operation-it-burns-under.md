## ADR-681 Amendment 1 - A path exports under every Fill operation it burns under (2026-11-02)

**Status:** Accepted on 2026-11-02; unit-tested through the real exporters, parsers, store import and
compiler. Not opened in LightBurn, Inkscape or AutoCAD, not printed on paper, and not
hardware-tested. |
**Amends:** ADR-681 decisions 1 and 2 |
**With:** ADR-683 Amendment 2, which gives the canvas the same rule

### Context

Rolling audit v9 R5-P2-1 (`docs/audits/2026-11-02-rolling-v9/R5-fix-fill-canvas.md`): ADR-681
Decision 1 says "A path's operation is the first scene operation it uses". So the code followed its
words, and the words fall short of the decision's purpose, a design file keeps what burns. Add
operation on a plate's circle binds it to a second Fill operation. The canvas and the burn show the
circle engraved; Print and SVG wrote one even-odd compound with the circle as a hole, and no group
for "Operation 2". Importing that file and burning it lost the circle. A circle bound Line then Fill
never joined the Fill's compound at all, and an Output-off first binding decided a path's paint.

### Decision

1. **A path's compounds are the Fill operations it burns under**, by the rule the job and the canvas
   use (`fillOperationsAmong`, ADR-683 Amendment 2 item 1), over every operation it uses, hidden or
   not, because a hidden operation with Output on burns. A path on two Fill operations is in both
   compounds, each with its own parity and colour; an Output-off operation beside an Output-on one is
   left out. A path with no output at all is written under its first operation, as before.
2. **A path is written under the first scene operation it uses that outputs, else the first it
   uses.** That operation still decides fill or stroke and its colour in its own object's group. A
   Line-first path keeps its stroke there, and its closed contours also go in the Fill's compound.
3. **A compound is written for one object when the object cannot paint it itself:** its path burns
   under another operation too, or its own group strokes it. One object on one operation is still
   written path by path, as before.
4. **Every operation a path burns under counts for colours,** so a path in two compounds names two
   operations: each is written in its own colour unless its colour alone names it (Decision 1).
5. **A compound holds one compile run,** so a jig copy's region does not make a hole in an ordinary
   object's in the file, as neither does in the job.
6. **DXF writes the path on each operation's layer** (once per colour, or its copies cancel).

### Consequences

- SVG, Print, PDF, AI, EPS, GeoJSON and DXF show what the canvas and the burn do for multi-bound
  artwork. Files of single-bound artwork are unchanged.
- A re-imported compound comes back as its own operation, as Decision 2 already says of compounds. A
  file written before this keeps its hole.

### Evidence

`src/ui/app/design-file-round-trip.test.ts`, through the real Add operation, `exportSceneSvg`,
`exportSceneDxf`, `sceneVectorArtwork` and the importers: the Add operation circle writes two compounds
in two colours and burns the same area after SVG and DXF round trips; the other formats get the same
two items; with Operation 2 Output off, one compound with the hole, and the same burn after a round
trip; Line then Fill writes the outline and the Fill, on a plate and alone. Print takes the same SVG
string (`print-artwork.ts`, read, not printed).
