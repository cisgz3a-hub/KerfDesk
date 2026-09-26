## ADR-444 - Artwork and Multi-File Trace export as PDF, EPS and GeoJSON (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This extends ADR-431 (canonical curves on a millimetre grid, DXF). It
changes file export and one PDF import check only: no scene, compile, G-code, Frame or Start path
reads the new code, so the Frame-first contract (PROJECT.md non-negotiable 21, ADRs 228, 230, 232
and 237) is untouched.

### Context

Potrace ships svg, pdf, pdfpage, eps, ps, pgm, dxf, geojson, gimppath and xfig backends. After
ADR-431 the app writes SVG and DXF (and G-code). PDF and EPS are what print shops, sign makers and
vinyl-cutter software ask for; GeoJSON feeds GIS and scripting tools. The writers below follow the
published specifications only (PDF Reference / ISO 32000-1 restricted to PDF 1.4 features, Adobe
EPSF 3.0 and the PostScript Language Reference Level 2, RFC 7946); no Potrace code or source was
consulted.

### Decision

1. **One painted-item model** (`io/vector-formats/vector-artwork.ts`). Each artwork path becomes a
   filled item (closed contours, with its fill rule: even-odd, or nonzero for text) when its
   layer's effective operation fills, exactly as the SVG exporter decides, and a stroked item
   otherwise; open contours of a filled path are stroked. Items are never merged, so two
   overlapping objects of one colour do not cancel under one even-odd fill. Multi-File Trace
   layers fill even-odd, except Centerline, where every contour is a stroke. A Line + fill
   layer carries its stroke role through page placement and every writer, so a closed pen
   ring remains a stroke and receives the fitted page's stroke allowance.
2. **Placement.** Every writer maps the scene's Y-down frame to a Y-up page whose lower-left corner
   is (0, 0). The page is the exact extent of the drawn curves (derivative roots, arc extrema;
   `curveSubpathBounds`), not their control points, or a caller's rectangle (Multi-File Trace
   uses the traced image's page, as its DXF does). The page is rounded outward to the coordinate
   grid (default 0.001 mm, the Multi-File precision choice otherwise), and every point, including
   control points, is snapped to that grid; a Bezier point therefore moves by at most half a grid
   diagonal. Elliptical arcs become cubics of at most a quarter turn; a zero-radius arc is a line
   and a zero-length arc is dropped (SVG 1.1 F.6.2). The grid page is the geometry's exact
   bounds; PDF and EPS paint on a page built around it (`paintedPageBox`): on the default
   artwork-extent page, if any item is stroked, half the stroke width (0.05 mm, rounded up to
   0.0001 pt) is added on every side so a hairline on the extent edge is not half clipped, and any
   side shorter than 3 pt (PDF 1.4 Reference Appendix C minimum) grows to 3 pt with the artwork
   centred. A caller's page (the traced image) keeps its size apart from that minimum. GeoJSON has
   no ink and uses the grid page itself.
3. **PDF** (`pdf-writer.ts`): 7-bit ASCII PDF 1.4 with Catalog, Pages, one Page, an uncompressed
   content stream and an Info dictionary (Producer, optional Title; no dates, so output is
   deterministic); a cross-reference table of 20-byte entries, trailer, `startxref`, `%%EOF`.
   MediaBox `[0 0 w h]` is the page in points (mm x 72/25.4) rounded up to 0.0001 pt, sized to
   hold the painted ink (item 2). A page side above 14400 units (Appendix C, 5080 mm) is
   written as PDF 1.6 with the smallest integer `/UserUnit` that brings both sides within 14400,
   the content scale divided by the same unit, so the physical size is unchanged; every other
   page stays PDF 1.4 with no `/UserUnit`. The stream scales user space to millimetres and moves the
   artwork to its page offset with `cm`, so coordinates print as grid millimetres; `m`,
   `l`, `c` build subpaths, `h` closes closed contours, `f*` (or `f`) fills an item and `S`
   strokes it with a 0.1 mm round-capped, round-joined line, in DeviceRGB (`rg`/`RG`).
4. **EPS** (`eps-writer.ts`): `%!PS-Adobe-3.0 EPSF-3.0`, `%%BoundingBox: 0 0 W H` in whole points
   rounded outward from the painted page, `%%HiResBoundingBox` with the painted page (item 2),
   `%%LanguageLevel: 2`, a prolog binding `m l c h` to moveto / lineto / curveto / closepath, a
   `translate` to the artwork's page offset when it is not zero, a millimetre `scale`,
   `eofill` / `fill` / `stroke` per item, lines under 255 characters, `showpage`, `%%EOF`. The page
   geometry is operand-for-operand the PDF's.
5. **GeoJSON** (`geojson-writer.ts`): an RFC 7946 FeatureCollection. GeoJSON has no curves, so
   contours are flattened within a stated tolerance (default 0.01 mm) and then snapped: each
   position lies within tolerance + half a grid diagonal of the true curve. Filled items become
   Polygon / MultiPolygon features describing the region the item's own fill rule paints, the
   region PDF `f*` / `f` and EPS `eofill` / `fill` paint (`fill-region-rings.ts`). On the snapped
   integer rings, for nested-or-disjoint contours, a point's winding number is the sum of the
   orientations of the rings containing it and its even-odd count their number; a ring is a
   boundary exactly when "filled" differs on its two sides. A boundary with the fill inside is an
   outer ring, one with the fill outside is a hole of the nearest enclosing boundary, and a
   non-boundary ring (a same-winding contour nested in another under nonzero, as in text and
   SVG-imported fills) is dropped, so it does not become a hole. An island inside a hole is its
   own polygon. Crossing, self-crossing or duplicate contours break that model; they are detected
   exactly on the grid rings (segment intersection and undecidable containment), not merged by a
   polygon union: each resulting polygon becomes its own feature with `"unmerged": true`, so no
   MultiPolygon claims OGC validity it lacks, and the export toast counts those shapes and says
   they are not merged as the PDF fill shows. Rings are closed, have at least four positions, and follow the right-hand rule of
   section 3.1.6 (exterior counterclockwise, holes clockwise, in the y-up frame); a ring that
   collapses on the grid is dropped with its holes. Stroked items become LineString /
   MultiLineString features. Positions are NOT longitude/latitude: RFC 7946 section 4 allows
   another coordinate system only by prior arrangement, so the file states the arrangement in a
   `kerfdesk` foreign member (section 6.1): millimetres, x right, y up, origin at the page's
   lower-left corner, plus the tolerance and grid step. A `bbox` gives the written extent.
   Feature properties carry `color`, `paint` and `fillRule`. Generic GIS tools ignore the foreign
   member, so the success toast and the command help also say the file is millimetres, not
   longitude/latitude, and not georeferenced (RFC 7946 section 4); artwork taller than 90 mm
   would otherwise read as out-of-range latitudes. No degree scaling is offered: it would distort
   the drawing's units, which are the point of the export.
6. **Commands.** File → Export artwork as PDF... / EPS... / GeoJSON... sit beside the SVG and DXF
   commands and follow the DXF flow: capture the artwork and clock before the picker, warn without
   asking for a name when the selection has no vector artwork, outline variable text, count left-out
   bitmaps and reliefs. Multi-File Trace's Format choice gains PDF, EPS and GeoJSON (one select,
   no new controls); files are `<name>-trace.<format>`.
7. **PDF import checks a curve's extent, not its control points.** A round trip through the app's
   PDF importer (`io/pdf/pdf-vector-page.ts`, PDF.js operators) fell back to the rendered page for
   the sample artwork: the importer rejected any path point beyond the page, including cubic
   control points, and a tight artwork page routinely has control points outside it. It now tests
   a cubic's (or quadratic's) exact extent after the page transform; a curve that truly leaves the
   page still falls back.

### Evidence

- `src/io/vector-formats/vector-formats.test.ts`: golden files (`__golden__/sample-artwork.pdf`,
  `.eps`, `.geojson`) for a rounded square with a square hole and a circular hole holding an island,
  plus an open wave whose control points reach about 7 mm beyond the curve. The PDF test walks the xref
  (every entry 20 bytes and pointing at `N 0 obj`, `startxref` at `xref`, stream `/Length` exact)
  and loads the file with PDF.js (`stopAtErrors`) through the app's importer, which returns vector
  paths in both colours. MediaBox and both EPS bounding boxes are checked against an independently
  solved extent (the wave's extrema from 6t^2 - 6t + 1 = 0): never smaller, at most one grid step
  plus 0.0001 pt larger, and about 7 mm shorter than the control-point hull. GeoJSON rings are closed,
  oriented, holes lie inside their outer ring, the island inside the circular hole, and every
  circle position within 0.01 mm + half a grid diagonal of radius 4.
- `src/io/vector-formats/vector-formats-fill-page.test.ts` (review follow-up): under nonzero a
  same-winding nested pair is one solid polygon (as PDF writes `f`) and an opposite-winding one
  cuts a hole; under even-odd a nested contour is a hole whatever its winding; windings sum
  through several nesting levels; crossing contours become separate `unmerged` features and are
  counted, while disjoint and corner-touching contours stay one MultiPolygon; self-crossing and
  duplicate rings are reported; containment is decided past shared vertices. A stroked rectangle
  and a lone horizontal line keep their whole hairline inside MediaBox and both EPS bounding
  boxes, the line's page is at least 3 pt tall, fill-only artwork and caller pages get no margin,
  pages up to 14400 units stay PDF 1.4, and a 6000 mm page is PDF 1.6 with `/UserUnit` and every
  MediaBox side within 14400.
- `src/io/pdf/pdf-vector-page.test.ts`: a curve whose control points leave the page but whose
  extent does not imports as vectors; one that truly leaves the page still falls back.
- `src/ui/app/export-artwork-format.test.ts`, `src/core/trace/batch-trace.test.ts`: command flow,
  file names, the picker refusal and the Multi-File hand-off (page size, Centerline strokes).

### Consequences

- PDF and EPS keep curves at the grid precision; GeoJSON is a flattened approximation by design.
- PDF content is uncompressed (no FlateDecode) to keep the writer synchronous and dependency-free;
  a large trace makes a proportionally large PDF. EPS carries no preview image.
- Traced files use a fixed 0.1 mm stroke for Centerline and open contours, where the traced SVG
  draws one source pixel wide.
- GeoJSON regions are exact for nested-or-disjoint contours under either fill rule. Crossing,
  self-crossing or duplicate contours (overlapping user shapes, some glyphs, messy imports) are
  detected and written as separate, overlapping `unmerged` features with a warning, not merged:
  a polygon union with winding bookkeeping was judged too large for this export. Consumers that
  need one valid geometry must union those features themselves.
- GeoJSON coordinates are millimetres and the file is not georeferenced; this is stated in the
  file, the help and the toast.
- An exported PDF or EPS page can be up to 0.05 mm per side larger than the geometry, and never
  smaller than 3 pt; the exact geometry bounds remain the GeoJSON `bbox` and the grid page.
