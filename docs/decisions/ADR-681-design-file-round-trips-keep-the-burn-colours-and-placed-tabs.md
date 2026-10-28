## ADR-681 - Design file round trips keep the burn, operation colours and placed tabs

**Status:** Accepted; unit-tested through the real exporters, parsers, store import, paste and
compiler. Not opened in LightBurn, Inkscape or AutoCAD, and not hardware-tested. |
**Date:** 2026-10-28

Fixes rolling audit v7 area L7 findings L7-P1-1, L7-P1-2 and L7-P2-1
(`docs/audits/2026-10-28-rolling-v7/L7-design-io-roundtrip.md`). Amends ADR-468 item 1 and the
colour mapping of ADR-431 and ADR-350 item 5. Frame, Start and the compiled output of any
project are unchanged: only exported files, the import toast and pasted tab anchors change.

### Context

- **The burn pools a Fill operation even-odd.** The compiler resolves each object by itself, then
  combines every object on a Fill operation with even-odd parity (`fill-rule.ts`, ADR-486
  Amendment 2), so a shape drawn inside another on the same operation is a hole. ADR-286 item 2
  and ADR-410 Amendment 3 rely on that. LightBurn does the same: "If you have two shapes set to the
  same layer, and one is inside of the other, … the area between the two outlines will be filled"
  (LightBurn 1.7 Fill Mode,
  https://docs.lightburnsoftware.com/1.7/Reference/CutSettingsEditor/FillMode/).
- **The exports painted each object on its own.** SVG wrote one filled `<path>` per object, and
  ADR-468 item 1 kept PDF, EPS and GeoJSON items "never merged". SVG paints in document order, so
  the file showed a solid plate where KerfDesk burned a ring, and KerfDesk's SVG import, which
  reads a file as SVG paints it, filled the hole: a 40 × 30 plate with a Ø16 circle went from
  999.7 mm² burned to 1200 mm², and a plate with "KERF" lost its knocked-out letters, with no
  message. LightBurn treats shapes exported one by one from a fill layer as a defect: a LightBurn
  forum thread reports its SVG export merging a fill layer's shapes into one filled path, with
  Offset Fill the exception its developer then fixed
  (https://forum.lightburnsoftware.com/t/is-this-svg-export-problem-fixed-in-latest-version/188183,
  read 2026-10-28; LightBurn itself was not run).
- **The exports wrote each path's stored colour.** A drawn shape keeps the colour it was drawn in
  while its operation has another, and Assign selection to operation changes only the binding.
  Three shapes drawn on three operations exported as `#000000`, `#2563eb`, `#2563eb` and came back
  as two operations; a plate and the circle Assigned to its operation left as two colours, so SVG
  and DXF both re-imported two Fill operations and burned the circle twice (1400 mm²). LightBurn:
  "different colors indicate different layers"
  (https://docs.lightburnsoftware.com/1.7/Reference/UI/ColorPalette/). There a shape's colour is
  its layer's by construction, so what it exports is the layer colour (no LightBurn page describes
  export colours on their own).
- **Paste rewrote placed tab anchors.** ADR-494 item 4 keys a placed tab by its path colour and
  makes copy and paste carry it. Paste into another project, and every Saved Artwork insert,
  rewrote each anchor to the new operation's colour while the path kept its own. Whenever the two
  had been equal (every LightBurn `.lbrn` import), the tab stopped counting and the part was cut
  with automatic tabs elsewhere: one placed gap became four. CNC placed anchors stopped resolving
  the same way.

### Decision

1. **Every artwork export writes a path in the colour of the operation it is exported under**
   (`io/svg/export-fill-compounds.ts`): the first scene operation the path uses, the same
   operation whose effective mode decides fill or stroke. A path on no operation keeps its own
   colour. SVG, DXF (one layer per operation colour), PDF, AI, EPS and GeoJSON all follow.
   Operations that share a colour still share it in the file; a file has no other way to name a
   layer.
2. **A Fill operation holding two or more objects is written as one even-odd compound path**, in
   world millimetres, at the place of its first object (SVG `<g id="fill-N">` titled with the
   operation's name; one filled item in PDF, AI, EPS and GeoJSON). Its open contours stay strokes
   in their objects' groups. An object whose own contours already have even-odd parity (a shape,
   ordinary text, any single even-odd path) keeps its exact curves. An object whose own region
   differs (its contours overlap under non-zero, as script text with Weld off does, or two of its
   paths overlap) is written as the region the compiler resolves for it, flattened at the machine
   curve tolerance: its burn, not its outline, is what the operation pools. The test is exact
   because even-odd of all an object's contours always lies inside its resolved region, so equal
   areas mean equal regions. An operation with a single object is written path by path as before.
3. **The SVG import is unchanged.** It reads a file as SVG paints it, so a compound path keeps its
   holes, and a third-party file with one shape painted over another keeps the union it shows.
   The import toast counts distinct colours, not paths.
4. **Paste and Saved Artwork insert leave placed tab anchors as they are.** Paste never recolours
   a path, and anchors are keyed by the path colour (ADR-494 item 4), so laser and CNC placed tabs
   keep counting on the new operation.

### Consequences

- An SVG, PDF, EPS or GeoJSON export of a Fill operation with several objects no longer has one
  element per object; the objects come back as one imported object. Line operations and single
  objects keep their per-object groups. An SVG round trip still merges consecutive same-mode
  elements into one object (L7-P3-3, open), because each imported object gets its own operations.
- Re-importing a file exported before this change still fills holes it painted over.
- The design canvas still paints each object's fill on its own, so it shows a solid plate where
  the burn is a ring. That canvas twin is a separate finding.
- DXF carries no fill rule: text whose glyph outlines overlap still burns its joins as holes when a
  re-imported DXF is set to Fill (L7-P3-1).

### Evidence

`src/ui/app/design-file-round-trip.test.ts` exports through `exportSceneSvg`, `exportSceneDxf`
and `sceneVectorArtwork`, imports through `parseSvg` / `parseDxf` and the store's
`importSvgFragment` / `importSvgObject`, and measures the compiled hatch: the ring, an "O"-shaped
non-zero knock-out and an overlapping non-zero knock-out burn the same area after the round trip,
three drawn operations export as three colours, and the drawn plate with its circle Assigned to
it keeps its hole through SVG and DXF. On the previous exporters all six cases fail (1200 mm²
burned; colours `#000000`, `#2563eb`, `#2563eb`). `src/ui/state/laser-tab-actions.test.ts` pastes
a tabbed part whose path colour equals its operation colour into another project and inserts it
from Saved Artwork into this project and a new one; the laser tab still counts and both the laser
and CNC anchors resolve to the same outline points.
