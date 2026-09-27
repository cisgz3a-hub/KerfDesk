## ADR-431 - Vector export writes canonical curves on a millimetre grid, and DXF (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This extends ADR-350 (artwork SVG export) and ADR-358 (composed SVG round trip). It changes file
export only: no scene, compile, G-code, Frame or Start path reads the new code, so the Frame-first
contract (PROJECT.md non-negotiable 21, ADRs 228, 230, 232 and 237) is untouched.

### Context

Tracer gap review, export formats (2026-09-25). Potrace 1.16 ships ten output backends, among them
SVG, PDF, EPS, DXF and GeoJSON. On the base (`fa8939b8d`):

- **Tools → Multi-File Trace** wrote `<stem>-trace.svg` through `coloredPathsToSvg`: absolute
  `M/L/Z` polylines in source pixels from the dense compatibility polylines. It never read
  `ColoredPath.curves` (the canonical geometry since ADR-391), was fixed to the Line Art preset, and
  threw for the whole batch when any one image traced to nothing.
- **File → Export artwork as SVG** (`exportSceneSvg`) wrote canonical curves at full float
  precision (`String(value)`, so values such as `0.30000000000000004` reached the file) and sized
  the page from the curves' control points, so a bulging cubic enlarged the page.
- There was no DXF writer. The app imports DXF (`src/io/dxf`).

Measured on the two tracer test images (1254 x 1254 px, Line Art, placed at the import density,
125.4 mm square), base Multi-File output: owl 2,837,203 bytes with 186,964 `L` commands,
hummingbird 1,699,567 bytes with 112,343.

### Decision

1. **Shared, pure writers** in `core/vector-export/`:
   - `decimal-grid.ts` snaps a coordinate to an integer multiple of a power-of-ten step and prints
     it from that integer, so text carries no binary noise. Default step 0.001 mm.
   - `svg-path-data.ts` writes line/cubic subpaths as relative commands (`m l h v c z`) whose
     arguments are integer grid differences, so relative writing cannot accumulate rounding: every
     written point is exactly its snapped point. A subpath containing an elliptical arc is written
     absolute at full precision, because an arc's centre is ill-conditioned when its radii approach
     half the chord and a micrometre endpoint move could move the drawn arc much further.
   - `affine-curves.ts` maps curves through an affine matrix exactly (an ellipse maps to an ellipse
     through the singular values of `L · R(phi) · diag(rx, ry)`; a reflection flips the sweep flag)
     and bounds them exactly (`curveSubpathBounds`: derivative roots of each cubic, axis extrema of
     each arc).
   - `contour-nesting.ts` groups closed contours into islands: nesting depth by containment, even
     depth is an outer contour, each odd-depth hole belongs to its smallest container. A whole
     contour's containment is decided by its first vertex not on the other boundary.
   - `bulge-rings.ts` turns a curve into LWPOLYLINE vertices: lines exact; circular arcs as one
     exact bulge `tan(theta/4)`; cubics subdivided at midpoints until both control points lie within
     the tolerance of the chord segment (the curve lies in its control hull and distance to a
     segment is convex, so every chord stays within the tolerance of the curve, and vice versa);
     elliptical arcs through the shared parametric flattener, whose sagitta bound on the major
     circle bounds the ellipse.
2. **Artwork SVG export** (`exportSceneSvg`) takes `{ precisionMm, groupContours }`. Precision is in
   world millimetres (default 0.001; `null` keeps exact coordinate values, though the path text is
   still the new compact form and the page is still the exact curve extent). Coordinates stay in
   each object's local frame under its matrix, on a local grid of step at most `precision / gain`
   with `gain` the matrix's largest singular value. World points are therefore not on a world grid;
   each lies within half a world grid diagonal of its true position. The page is the exact extent
   of the geometry actually written, rounded outward onto the grid, with the historical 0.01 mm
   minimum for a zero-height line.
3. **Multi-File Trace** opens a small dialog first (preset, SVG or DXF, precision 0.1 / 0.01 /
   0.001 / 0.0001 mm, and for SVG an option to put each shape and its holes in their own `<g>`);
   its primary button then opens the file picker, as the first await in the click handler. Each
   image is written from `ColoredPath.curves` in millimetres on the source image's page (its size
   rounded outward onto the grid, so edge geometry is never clipped), keeping the paint rules
   (filled closed curves even-odd without stroke, Centerline and open curves stroked one source
   pixel wide, the width printed within 0.05% of its value so a pixel finer than the grid never
   becomes a zero-width stroke) and the `<stem>-trace.<ext>` naming. An image with no visible
   geometry writes nothing and is named in the completion message; the other images are still
   written.
   `traceImagesToVectorFiles` also accepts a loader in place of a decoded image, matching the
   native-resolution branch's additive change to the same job type.
4. **DXF writer** (`io/dxf/dxf-writer.ts`), written from Autodesk's published DXF reference: ASCII
   AC1018, `$INSUNITS` 4 (millimetres), the minimal R13+ table, block and object structure with
   unique handles and owners, one closed or open LWPOLYLINE per contour, one layer per colour named
   `RGB_RRGGBB` carrying the nearest ACI (62) and the exact true colour (420). Y is mirrored to the
   DXF's Y-up frame. The drawing's lower-left corner is the origin for artwork export; for a traced
   page it is the page's lower-left corner, so files in one batch share the image's frame. Curve
   tolerance 0.01 mm (a tenth of a typical 0.1 mm laser spot); coordinates on the same 0.001 mm grid.
   **File → Export artwork as DXF...** sits beside the SVG command; bitmaps and reliefs have no DXF
   form, are left out and are counted in a warning.

### Consequences

- File sizes, owl / hummingbird, same trace, 125.4 mm page (serialization time in a Node harness):

  | Output | owl bytes | hummingbird bytes | Time (ms) |
  |---|---|---|---|
  | Base Multi-File SVG (pixel polylines) | 2,837,203 | 1,699,567 | - |
  | SVG, 0.001 mm (default) | 1,331,011 | 1,102,807 | 170 to 325 |
  | SVG, 0.01 mm | 1,041,023 | 863,716 | 180 to 296 |
  | SVG, 0.1 mm | 657,495 | 515,815 | 158 to 246 |
  | SVG, 0.001 mm, grouped (425 / 551 islands) | 1,360,811 | 1,141,451 | 539 to 1,382 |
  | DXF, 0.001 mm | 3,553,054 | 2,616,634 | 158 to 293 |
  | DXF, 0.01 mm | 3,247,839 | 2,388,325 | 145 to 269 |

  The default file is 53% (owl) and 35% (hummingbird) smaller than the base file at the same
  resolution: the base rounded pixel coordinates to 0.01 px, which is 0.001 mm at this density, but
  wrote every sample of the dense polylines as an absolute `L` command. The new file writes the
  canonical curves as relative grid differences.
- Round trip on both images: the written SVG was parsed back with the app's path parser and
  matched subpath for subpath (2,187 and 1,397). The largest point move was 7.063e-4 mm at 0.001 mm
  (bound 7.071e-4, half the grid diagonal), 7.065e-3 at 0.01 and 7.047e-2 at 0.1. Each DXF imported
  back through `parseDxf` with the same number of rings and no importer notes.
- Potrace 1.16, run out of process on a plain luma-128 threshold of the same images at 254 dpi
  (the same 0.1 mm pixel; different trace geometry, so only indicative): its SVG, on its fixed
  0.1 pt (about 0.035 mm) grid, is 937,614 / 687,947 bytes with about 276,000 / 198,000 numbers,
  against this writer's 260,485 / 215,521 numbers at 0.01 mm. Its DXF is 10,864,955 / 7,775,805
  bytes, about three times these DXF files. At equal precision the SVG sizes are close; Potrace's
  is smaller at its coarser default grid, and 0.1 mm here is smaller than both.
- Artwork SVG export changes text but not geometry beyond the grid: coordinates are relative and
  rounded to 0.001 mm, and the page no longer includes control points outside the curve. Arc
  subpaths and image clips keep exact absolute data.
- Grouping is opt-in and exact only for contours that are pairwise nested or disjoint, which every
  traced contour is. It does not detect crossing or identical contours: under even-odd those land
  in separate `<path>`s and their overlap is filled where one path would cancel it, and for nonzero
  text glyphs whose contours cross, a contour can land in a different island than the fill rule
  implies. Multi-File Trace output is therefore safe; the scene exporter's `groupContours` option
  has no UI control.
- Tests: `vector-export.test.ts` (grid printing and outward rounding, exact arc transform under
  shear and mirror, cubic bounds by derivative roots, bulge signs, island grouping and a shared
  saddle vertex); `export-scene-svg-precision.test.ts` (exact page extent, outward page rounding,
  golden relative path data, grouping, importer read-back, extreme object scales held to the world
  grid); `batch-trace.test.ts` (curves not polylines, precision goldens, grouping golden, skipped
  blank images, loader jobs, DXF hand-off, a stroke finer than half a grid step, outward page
  size); `multi-file-trace-action.test.ts` (a batch with one blank image writes the others and
  reports the skip; chosen preset; DXF files);
  `export-dxf.test.ts` (round trip through `parseDxf` within 0.01 + 0.001 mm by Hausdorff distance
  per colour under rotation, mirror and non-uniform scale; exact circle bulges; units, version and
  unique handles; omitted bitmaps; traced-page registration); `export-artwork-dxf.test.ts` (an
  image-only selection warns before the save picker); `MultiFileTraceDialog.test.tsx` (the picker
  opens inside the submit, and the chosen preset, format and precision reach the batch).
- Not verified here: opening the DXF in AutoCAD, LibreCAD or another CAD/CAM program, and rendered
  comparison in an independent vector editor. Those remain acceptance steps, as in ADR-350. The
  file carries no LAYOUT or PLOTSETTINGS objects, no BLOCK_RECORD layout pointers (340) and no
  LAYER plot-style handles (390); if a strict AutoCAD-family reader refuses it, add `ACAD_LAYOUT`
  with Model and Layout1 or write AC1015 with the same content.

Not part of this decision: PDF, EPS, PostScript and GeoJSON writers; fitting arcs to cubics for
DXF bulges; a tight page (Potrace `--tight`) for traced files; a precision control for the scene
export commands (they use the 0.001 mm default).

### Amendment: retain Edge line paint across traced export (2026-09-27)

The canonical-curve batch writer introduced here retained Centerline's line role but omitted
Edge Detection. This regressed ADR-407's paint contract: a closed Edge result previewed and
committed as a line, but exported as a fill. The omission also reached the drawing-writer
handoff added by ADR-468 and the fitted-page stroke allowance added by ADR-451.

`core/trace/trace-paint.ts` now owns the preview/export paint decision. Centerline and Edge
stroke every contour. Hybrid keeps its per-path stroke/fill roles; other modes fill closed
contours and stroke open contours. The batch layer carries the line role through scaling and
page placement, and visibility uses travel length for line roles, including zero-area closed
travel. The SVG writer and the PDF/EPS/GeoJSON handoff apply the same role. Fitting a page
includes Edge's stroke allowance. Native canonical curves, export grids, source-pixel SVG
stroke width and PDF/EPS hairline width are unchanged.

Regression evidence includes actual default Edge Detection output through SVG, PDF, EPS and
GeoJSON on both image and fitted pages; canonical closed cubics in SVG/PDF/EPS; zero-area closed
travel and open contours; and Centerline, filled-contour and per-path Hybrid controls. Tests
inspect actual SVG paint, PDF/EPS paint operators and GeoJSON geometry/paint, not just injected
writer options (`traced-paint-intent.test.ts`). The core batch and page tests also cover the
writer handoff, nonempty travel and stroke padding. Preview paint remains unchanged.

### Amendment: Multi-File Trace skips bad files, writes as it goes and can be cancelled (2026-09-27)

A gap audit against LightBurn's batch trace and Potrace's many-file CLI found four Multi-File
Trace gaps: one unreadable file aborted the whole batch, every export was held in memory until
the last file was traced and then offered through one save dialog each, there was no progress or
Cancel, TIFF and Netpbm inputs were refused, and the batch always used a preset's defaults. This
changes the batch command only; no scene, compile, G-code, Frame or Start path reads it, so the
Frame-first contract (PROJECT.md non-negotiable 21, ADRs 228, 230, 232 and 237) is untouched.

1. **Per-file failures are skips.** A file whose decode or trace still fails after its fallback
   (the preview grid of ADR-409) becomes a `decode-failed` or `trace-failed` skip carrying the
   error message, and the other files are still traced and written. The batch notice names them
   ("Could not read 1 image (b.png: <message>); it was skipped.") and uses the error style only when nothing
   was written. Cancel and a superseded request still end the whole batch. Trace notices are keyed
   by the file's position, so a skipped file cannot move a notice onto its neighbour.
2. **One folder, written as each file finishes.** The dialog has two steps: *Choose Images...*
   opens the image picker, and the primary *Trace...* button reserves the output folder with
   `reserveSaveDirectory` as its first await (as Save Tiled G-code does), because each
   file-system picker needs its own user activation. Each export is written into that folder as
   soon as it is traced and then dropped, so at most one export is held in memory. Without a
   folder picker (the platform has none, or the web adapter throws because
   `showDirectoryPicker` is missing) each file is offered through its own save dialog, as before.
   Cancelling the folder picker starts nothing.
3. **Progress and Cancel.** A non-modal *Multi-File Trace progress* status panel shows "Tracing i
   of N" with a *Cancel Multi-File Trace* button. Cancel aborts an `AbortController` whose signal
   is checked before each file and passed into `traceImagesToVectorFiles` and the trace worker.
   Nothing is written after Cancel, not even a file that finished tracing, and the notice says how
   many files were written.
4. **TIFF and Netpbm input.** The picker also accepts `.tif`/`.tiff` (page 1, through
   `io/tiff`'s `decodeTiffPage`, sized by its resolution tags) and `.pbm`/`.pgm`/`.ppm`/`.pnm`
   (P1 to P6, `io/pnm/decode-pnm.ts`, sized at the default DPI). Each is decoded once and resampled
   to the planned maximum edge, as the browser loader does for other images. They decode on the
   main thread, unlike the worker-based TIFF import.
5. **Settings choice.** A *Trace settings* select offers *Preset defaults* (the previous
   behaviour, byte for byte) or *Last Trace Image settings*, shown only when the scene holds a
   trace that recorded its dialog settings (ADR-408). The newest such snapshot is restored as
   Re-trace restores it and merged with `mergeLightBurnTraceSettings`, turn policy included, as the
   Trace dialog merges it. Line + fill's millimetre stroke width is converted on each file's
   preview grid (ADR-454). The snapshot's crop boundary, fill style and raster or vector output
   belong to that one image and are not applied. The batch notice names the settings used.

Evidence: `src/core/trace/batch-trace-skip.test.ts`, `multi-file-trace-action-skip.test.ts`
(a middle file that cannot be decoded, a trace failure after the fallback, cancel still fails the
batch); `multi-file-trace-action-stream.test.ts` (in-order writes holding one export, nothing
written after Cancel, the written count); `MultiFileTraceProgress.test.tsx`;
`MultiFileTraceDialog.test.tsx` (each picker inside its own click);
`MultiFileTraceDialog.fallback.test.tsx` (per-file save dialogs with no folder picker or a
throwing one, nothing started when the folder picker is cancelled);
`multi-file-trace-action-formats.test.ts` and `src/io/pnm/decode-pnm.test.ts` (TIFF and PBM in
one batch, resampling to the planned edge, a corrupt TIFF skipped, P1 to P6 decoding);
`multi-file-trace-settings.test.ts` (newest record, the Trace dialog's merge, unchanged preset
defaults, the notice). The whole vitest run over `src/ui/commands`, `src/core/trace` and
`src/io` passes.
