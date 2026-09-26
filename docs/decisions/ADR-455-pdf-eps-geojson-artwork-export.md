## ADR-455 - Artwork and Multi-File Trace export as PDF, EPS and GeoJSON (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This extends ADR-403 (canonical curves on a millimetre grid, DXF; ADR-440 once integrated). It
changes file export and one PDF import check only: no scene, compile, G-code, Frame or Start path
reads the new code, so the Frame-first contract (PROJECT.md non-negotiable 21, ADRs 228, 230, 232
and 237) is untouched.

### Context

Potrace ships svg, pdf, pdfpage, eps, ps, pgm, dxf, geojson, gimppath and xfig backends. After
ADR-403 the app writes SVG and DXF (and G-code). PDF and EPS are what print shops, sign makers and
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
   layers fill even-odd, except Centerline, where every contour is a stroke.
2. **Placement.** Every writer maps the scene's Y-down frame to a Y-up page whose lower-left corner
   is (0, 0). The page is the exact extent of the drawn curves (derivative roots, arc extrema;
   `curveSubpathBounds`), not their control points, or a caller's rectangle (Multi-File Trace
   uses the traced image's page, as its DXF does). The page is rounded outward to the coordinate
   grid (default 0.001 mm, the Multi-File precision choice otherwise), and every point, including
   control points, is snapped to that grid; a Bezier point therefore moves by at most half a grid
   diagonal. Elliptical arcs become cubics of at most a quarter turn; a zero-radius arc is a line
   and a zero-length arc is dropped (SVG 1.1 F.6.2).
3. **PDF** (`pdf-writer.ts`): 7-bit ASCII PDF 1.4 with Catalog, Pages, one Page, an uncompressed
   content stream and an Info dictionary (Producer, optional Title; no dates, so output is
   deterministic); a cross-reference table of 20-byte entries, trailer, `startxref`, `%%EOF`.
   MediaBox `[0 0 w h]` is the page in points (mm x 72/25.4) rounded up to 0.0001 pt. The stream
   scales user space to millimetres with `cm`, so coordinates print as grid millimetres; `m`,
   `l`, `c` build subpaths, `h` closes closed contours, `f*` (or `f`) fills an item and `S`
   strokes it with a 0.1 mm round-capped, round-joined line, in DeviceRGB (`rg`/`RG`).
4. **EPS** (`eps-writer.ts`): `%!PS-Adobe-3.0 EPSF-3.0`, `%%BoundingBox: 0 0 W H` in whole points
   rounded outward from the exact page, `%%HiResBoundingBox` with the exact page, `%%LanguageLevel:
   2`, a prolog binding `m l c h` to moveto / lineto / curveto / closepath, a millimetre `scale`,
   `eofill` / `fill` / `stroke` per item, lines under 255 characters, `showpage`, `%%EOF`. The page
   geometry is operand-for-operand the PDF's.
5. **GeoJSON** (`geojson-writer.ts`): an RFC 7946 FeatureCollection. GeoJSON has no curves, so
   contours are flattened within a stated tolerance (default 0.01 mm) and then snapped: each
   position lies within tolerance + half a grid diagonal of the true curve. Filled items become
   Polygon / MultiPolygon features: closed contours are grouped by even-odd containment depth
   (ADR-403's `groupContoursWithHoles`, which assumes pairwise nested-or-disjoint contours, as
   traced contours are) into an outer ring and its direct holes; an island inside a hole is its own
   polygon. Rings are closed, have at least four positions, and follow the right-hand rule of
   section 3.1.6 (exterior counterclockwise, holes clockwise, in the y-up frame); a ring that
   collapses on the grid is dropped with its holes. Stroked items become LineString /
   MultiLineString features. Positions are NOT longitude/latitude: RFC 7946 section 4 allows
   another coordinate system only by prior arrangement, so the file states the arrangement in a
   `kerfdesk` foreign member (section 6.1): millimetres, x right, y up, origin at the page's
   lower-left corner, plus the tolerance and grid step. A `bbox` gives the written extent.
   Feature properties carry `color`, `paint` and `fillRule`.
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
- GeoJSON grouping inherits ADR-403's precondition: crossing or duplicate contours in arbitrary
  artwork are not detected and land as separate polygons.
