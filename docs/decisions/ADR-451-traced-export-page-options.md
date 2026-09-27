## ADR-451 - Traced export page options and Group islands for SVG export (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This extends the traced-file export of ADR-431 (SVG and DXF) and
ADR-468 (PDF, EPS and GeoJSON). It changes file export only: no scene,
compile, G-code, Frame or Start path reads the new code, so the Frame-first contract (PROJECT.md
non-negotiable 21, ADRs 228, 230, 232 and 237) is untouched.

### Context

A gap audit of the tracer against Potrace 1.16 and LightBurn listed "tight page, margins ...
island grouping" as still behind. Potrace documents `--tight` (remove whitespace around the
input image) and page margins for its page-based backends. Multi-File Trace always wrote the
source image rectangle, rounded outward to the grid, as the page. `exportSceneSvg` already had a
`groupContours` option (each outer contour with its direct holes in its own `<g>`), and Multi-File
Trace SVG offered it, but File > Export artwork as SVG had no way to turn it on. This was written
from Potrace's documented behaviour only; no Potrace source was consulted (ADR-120/123).

### Decision

1. **Page choice in Multi-File Trace** (`core/trace/traced-page-box.ts`). A Page select offers
   *Image size* (the default) and *Fit to artwork*, with a Margin (mm, 0 to 1000) shown for the
   fitted page. The choice is part of the batch output (`BatchTraceOutput.page`); the default
   sends no page option at all.
2. **Image size is unchanged.** `placeTracedLayers` returns the traced layers and the image page
   untouched, so every format is byte-identical to the files written before the choice existed
   (golden files generated from the base commit's code), and a margin is ignored on this page.
3. **Fit to artwork** uses the exact extent of the traced curves (`curveSubpathBounds`:
   derivative roots of each cubic, not its control points), so a curve bulging past its end
   points is inside the page and a control point off the curve does not widen it. Stroked
   artwork (Centerline, and open curves of a filled trace) adds half the widest hairline any
   writer draws: the larger of one source pixel (the SVG stroke) and 0.1 mm (the PDF/EPS
   hairline), so a stroke on the fitted edge is not clipped. The margin is added on every side.
   On a physical page the box is rounded outward to the export grid (the Precision choice), so
   the artwork moves by a whole number of grid steps. A side shorter than 3 pt (1.0583 mm, the
   PDF 1.4 minimum page side that the PDF and EPS writers enforce) grows to 3 pt on whole grid
   steps, centred on the artwork (an odd extra step goes to the high side), so a thin trace such
   as a Centerline straight line gets the same page in every format instead of a 3 pt PDF/EPS
   page around a thinner SVG, DXF or GeoJSON page. A side is never shorter than one grid step.
   The core copies of the 3 pt minimum and the 0.1 mm hairline are pinned to the io writer
   constants by `traced-page.test.ts`, because core cannot import io.
4. **Physical size stays exact.** Only the page and the offset change: the artwork is translated
   so the fitted page's corner is the origin, and millimetres per source pixel (from the image
   density, `rasterImportGeometry`) are unchanged, as is the SVG stroke width of one source pixel.
   A page with no physical size (direct core callers only; the app always knows the density) is
   in pixels and takes the margin in pixels, without a grid.
5. **Every format follows the same page.** SVG: `viewBox="0 0 w h"` and `width`/`height` in mm.
   PDF: `MediaBox [0 0 w h]` in points. EPS: `%%BoundingBox` (integer points, rounded outward) and
   `%%HiResBoundingBox`. DXF has no page, but its origin is the page's lower-left corner, so on a
   fitted page the offset changes: the origin sits the margin (plus any stroke allowance) below
   and left of the artwork, and a DXF stays in register with an SVG or PDF from the same settings.
   GeoJSON is coordinates only; they are measured from the same lower-left corner, so they shift
   the same way. No format records the offset back to the source image; a user who needs
   registration with the image keeps *Image size*.
6. **Group islands for File > Export artwork as SVG.** The command now opens a short *Export SVG*
   dialog with a *Group islands* checkbox (off by default, remembered for the session; Multi-File
   Trace uses the same label and tooltip for its SVG grouping option) and a
   *Choose File...* button that opens the save picker inside the submit click, so the browser's
   user activation still covers it. Checked, the export passes `groupContours: true` to
   `exportSceneSvg`; unchecked, it passes no options, so the file is unchanged. PDF, EPS, DXF and
   GeoJSON have no group structure, so the option is SVG-only, as in Multi-File Trace.
   The SVG writer only splits compounds whose boundaries it can prove simple and separated
   before applying even-odd nesting. Crossing, duplicate or touching boundaries, unsuccessful
   curve flattening, or exhausted bounded analysis retain the original compound in one group.
   Nested nonzero-winding compounds also remain intact; disjoint nonzero islands can split.
   This fallback preserves the original geometry and paint and never refuses an export.
7. **Rotation and stretch are not added.** Potrace's rotation and stretch options exist because
   it has no scene; here the traced artwork is a scene object whose transform (rotate, scale,
   skew) already reaches File > Export artwork in every format. Multi-File Trace writes the
   image as traced.

### Evidence

- `src/io/vector-formats/traced-page.test.ts`: golden files for all five formats on the image
  page (generated with the base commit 2bd01c6cb's code, then checked against this change); the
  image page ignores a margin; a fitted page with a 5 mm margin around a dome whose cubic peaks
  5 mm below its control points gives SVG `viewBox="0 0 60 25"` (control-point bounds would give
  30), a PDF MediaBox and EPS bounding boxes of 60 x 25 mm in points, DXF and GeoJSON coordinates
  measured from the fitted corner, and an unchanged one-pixel SVG stroke with the Centerline
  stroke allowance. A 0.2 mm tall bar with no margin gives SVG `viewBox="0 0 50 1.059"`, the same
  height as the PDF MediaBox and EPS HiResBoundingBox (no centring offset in either), and DXF and
  GeoJSON coordinates on that grown page. The core hairline and minimum-side constants equal the
  io writer constants.
- `src/core/trace/traced-page-box.test.ts`: exact extent, outward grid rounding with a margin,
  the stroke allowance for coarse and fine pixels, the 3 pt minimum side (centred, odd step high,
  a dot, a coarse grid, pixel pages untouched), invalid margins, and the untouched default.
- `src/ui/commands/MultiFileTraceDialog.page.test.tsx`: default sends no page option; Fit to
  artwork shows the margin, sends the page and is remembered; a margin of -2 or 1001 marks the
  field invalid and the form does not submit until it is corrected; a cleared field means no
  margin, so the trace never runs with a margin other than the one shown.
- `src/ui/commands/ExportSvgDialog.test.tsx`, `src/ui/app/export-artwork-svg-group.test.ts`: the
  dialog opens only from the command, exports inside the click, sends no options by default and
  `groupContours: true` when checked, and remembers the choice.
- `e2e/fixtures/composed-svg-browser.ts` (used by the composed-SVG round-trip and import
  acceptance specs) goes through the new dialog and asserts Group islands is off by default.

### Consequences

- File > Export artwork as SVG takes one more click (the options dialog). DXF, PDF, EPS and
  GeoJSON artwork export are unchanged.
- A fitted Multi-File Trace file no longer shares the source image's frame; files of one batch
  each have their own page.
- The fitted page can extend past the image when the margin is larger than the image border.

### Amendment: paper pages and per-side margins (2026-09-27)

The gap backlog still listed Potrace's page-size and per-side margin options (`--pagesize`,
`--margin` with its `-L`/`-R`/`-T`/`-B` sides, taken from the documented CLI only; no Potrace
source was consulted, ADR-120/123) and LightBurn's paper output against Multi-File Trace.

1. **Paper pages.** The Page select (accessible name *Page size*) adds *A4 (210 x 297 mm)*,
   *Letter (8.5 x 11 in)* (215.9 x 279.4 mm) and *Custom size* with *Page width (mm)* and
   *Page height (mm)* fields (above 0, at most 10000 mm). `placeTracedLayers` takes
   `fit: 'paper'` with `paperMm`: the page is exactly that size, portrait, and the artwork's exact
   curve extent (as in Decision 3) is centred on the area inside the margins, moved by a whole
   number of export-grid steps, so a paper file differs from the image-page file by one exact
   offset. Artwork larger than that area stays centred and runs past it; the page never shrinks
   to the artwork and nothing is scaled, so physical size stays exact (Decision 4). Every format
   follows the page as in Decision 5 (SVG viewBox and mm size, PDF MediaBox, EPS bounding boxes,
   DXF and GeoJSON origin at the page's lower-left corner). A page with no physical size, or an
   invalid paper size from a direct core caller, keeps the image page.
2. **Per-side margins.** A *Per-side margins* checkbox replaces the one Margin field with Top,
   Right, Bottom and Left fields (each 0 to 1000 mm, seeded from the shared margin). They apply
   to Fit to artwork (each side's margin added on its own side, then rounded outward as before)
   and to paper pages. `TracedPageLayout.margins` replaces `marginMm` when present; `pageMargins`
   clamps each side as the single margin was clamped.
3. **Defaults are unchanged.** Image size remains the default and sends no page option, and a
   single margin on Fit to artwork is the same layout as before. Golden hashes taken from the
   base commit 7a644d486 match for the image page and the fitted page in SVG, PDF, EPS, DXF and
   GeoJSON.

Evidence: `src/core/trace/traced-page-paper.test.ts` (centring on the grid, asymmetric margins,
oversize artwork, invalid paper, per-side margins on a fitted page),
`src/ui/commands/batch-trace-default-golden.test.ts` (image and fitted pages hash as the base
commit in all five formats), `src/ui/commands/batch-trace-paper-golden.test.ts` (an A4 page with
asymmetric margins is 210 x 297 mm in SVG and PDF and centred to one grid step in DXF), and
`src/ui/commands/MultiFileTraceDialog.paper.test.tsx` (the choices, the custom and per-side
fields, their validation and the page option each sends).
