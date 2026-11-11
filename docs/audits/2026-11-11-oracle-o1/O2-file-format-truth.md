# Oracle audit O1 — area O2 `file-format-truth`

**Date:** 2026-11-11 to 2026-11-12 | **Base:** `origin/main` at `5c9441ba8` | **Method:** [AREAS.md](AREAS.md) steps 1–8

**Scope:**
- Imports: `src/io/dxf`, `src/io/hpgl`, `src/io/stl`, `src/io/tiff`, `src/io/psd` and `src/io/pnm`, plus the UI paths that give each import its physical size.
- Exports: `src/io/vector-formats` (PDF, EPS, GeoJSON) and `src/io/dxf/dxf-writer.ts`, plus `src/core/vector-export` (bulge arcs, decimal grid, contour nesting, SVG path data).
- Out of scope: SVG import, LightBurn and project files.

## Headline

**Raised 14, refuted 0 outright, downgraded to KNOWN 2, contradicted by research 0.** That leaves P1 2, P2 2 and P3 9, plus the 2 KNOWN entries. Every P1 and P2, and four of the P3s, are fixed in PRs with regression tests that fail on `origin/main`.

**Imports.** Nothing produces the wrong physical size, a mirrored drawing, a negative image or wrong colours. Specifically:
- TIFF, PSD and Netpbm resolutions and units are read correctly.
- HP-GL is 40 units/mm and is not mirrored.
- DXF `$INSUNITS`, OCS and INSERT transforms are correct.

The two P1s are narrower:

- **O2-P1-1: unclamped and periodic DXF SPLINEs imported silently in the wrong shape.**
  - AutoCAD saves closed splines as periodic by default, and ezdxf writes the same form.
  - A 10 mm closed periodic cubic came in at 10 mm across instead of 9.17 mm. Open uniform splines were off by up to 27 mm.
  - Fixed in #1777.
- **O2-P1-2: GeoJSON export could fill a hole.**
  - Grid snapping can push one hole vertex across a slanted parent edge. When that vertex happened to be the containment probe, the hole was written as a filled polygon.
  - Rare: it needs a hole within about 0.7 µm of its parent.
  - It is P1 because the table has no reach clause.
  - Fixed in #1779.

The PDF, EPS, SVG and DXF writers are structurally valid. Independent readers written from the specs confirm the size (100 mm = 283.4646 pt), orientation, fill rules, island-in-hole parity and arc direction.

## Oracle plan

I wrote the plan before reading the code closely. Each claim's oracle was then fetched by the research verifier (see Research below). The audit tested 41 claims; the main ones were:

**DXF import** (AutoCAD 2012 DXF Reference):
- LWPOLYLINE/VERTEX bulge = tan(θ/4), negative = clockwise.
- The closing bulge on a closed polyline.
- POLYLINE spline-fit vertex flags: 8 (fit vertex) is drawn, 16 (frame) is not.
- ARC degrees are counter-clockwise.
- ELLIPSE parameters are in radians.
- SPLINE group codes 70–74, 40, 41, 10 and 11.
- OCS arbitrary-axis algorithm (1/64), with extrusion −Z mirroring X.
- INSERT scale, rotation, base point and arrays, including nesting.
- `$INSUNITS`, all 21 codes.
- Unsupported entities are reported, not dropped silently.

**HP-GL/2** (HP PCL 5 Technical Reference, Part II):
- 0.025 mm per plotter unit.
- PA/PR/PU/PD.
- AA/AR/CI with positive sweep = +X toward +Y.
- IP/SC types 0, 1 and 2.
- Separator and terminator rules.
- Y axis up.

**STL**:
- Binary layout 80 + 4 + 50n.
- A binary file whose header begins "solid".
- ASCII variants.
- Units.

**TIFF 6.0** plus the Adobe Photoshop TIFF Technical Notes:
- II/MM byte order.
- Strips and tiles, including padded edge tiles.
- Compression: none, LZW (code width rises one entry early), Deflate 8 and 32946, PackBits.
- Predictor 2.
- PhotometricInterpretation 0 (must invert), 1, 2, 3 (ColorMap /257), 5.
- Bit depths, ExtraSamples, Orientation.
- ResolutionUnit 1, 2 (default) and 3 for physical size.
- Multi-page files.

**PSD** (Adobe Photoshop File Formats Specification):
- Header, version, depth and colour modes.
- Composite image data, raw and RLE.
- Resource 0x03ED ResolutionInfo (16.16 pixels per inch).

**Netpbm** (netpbm.sourceforge.net, pbm/pgm/ppm/pam):
- Comments end at CR or LF.
- Exactly one whitespace byte after maxval.
- PBM 1 = black.
- maxval above 255 is stored as 2 bytes, most significant first.
- Plain PBM digits need no separators.
- P7 is refused loudly.

**PDF** (ISO 32000-1):
- Every xref entry is exactly 20 bytes.
- Default user space is 1/72 inch.
- MediaBox.
- `f` is nonzero winding and `f*` is even-odd.

**EPS** (Adobe DSC 3.0):
- First line `%!PS-Adobe-3.0 EPSF-3.0`.
- Integer `%%BoundingBox`.
- No forbidden operators.

**GeoJSON** (RFC 7946):
- Ring closure and at least 4 positions.
- Exterior counter-clockwise, holes clockwise.
- No `crs` member.

**SVG 1.1**:
- Arc flags.
- Path grammar.
- width and height in mm match the viewBox.

**Properties:**
- export → our importer, and export → an independent reader written from the spec, preserve geometry within the stated tolerance.
- Physical size and units are kept.
- Arc direction is kept.
- Holes stay holes.
- Nothing is dropped silently.

## Findings

Every finding below was reproduced on the real modules by the auditor, then attacked with a different method by a fresh refuter. The owner re-check (step 5) re-read the P1 and P2 code on `origin/main` at `5c9441ba8`:
- `src/io/dxf/flatten-spline-to-tolerance.ts`
- `src/io/dxf/dxf-entities.ts`
- `src/io/vector-formats/fill-region-rings.ts`
- `src/io/hpgl/hpgl-tokenizer.ts`
- `src/io/hpgl/hpgl-types.ts`
- `src/io/hpgl/hpgl-interpreter.ts`

### O2-P1-1: unclamped and periodic DXF SPLINEs import in the wrong shape (P1, fixed #1777)

- **Where:**
  - `src/io/dxf/flatten-spline-to-tolerance.ts` `bezierPieces` raised only the interior knots to multiplicity `degree`.
  - It then read the first and last spans' controls as Bézier controls. That is true only for a clamped knot vector, where the end knots repeat `degree + 1` times.
  - The stored curve (`polylineToCurveSubpath` of the same points) is what compiles, so the wrong shape is what gets burned.
- **Reproduction** (auditor's hand-written DXF, checked with an independent Cox–de Boor evaluator; refuter re-checked with de Boor's point algorithm and 20,001 samples):

  | Case | Expected | Got | Error |
  |---|---|---|---|
  | Flags 11 (closed + periodic + planar), controls of a 10 × 10 square wrapped by 3, uniform knots 0..10 | starts at (8.333, 1.667) | starts at control point (0, 0) | 2.357 mm |
  | Same, knots −30..70 | — | same as above | — |
  | Open uniform cubic, 100 mm | — | — | 27.1 mm |
  | Clamped controls | — | — | 0.018 mm (correct) |

  No note was shown. The existing "periodic" test used a clamped knot vector, so it encoded the wrong assumption.
- **Oracle:**
  - DXF Reference, SPLINE: flag 2 = periodic, code 40 = knots.
  - The standard B-spline definition: a curve with unclamped knots does not start on a control point.
  - The fix's regression test uses the closed form of the uniform cubic B-spline, independent of the module:
    - at a knot: (P[k−3] + 4P[k−2] + P[k−1])/6
    - at mid-span: (P[k−3] + 23P[k−2] + 23P[k−1] + P[k])/48
- **Research:**
  - **VERIFIED.** The Autodesk SPLINE command help (AutoCAD LT 2026, `help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-LT/files/GUID-5E7D51E2-…`) says: "By default, closed splines are periodic".
  - The SPLINE group codes are VERIFIED in the DXF 2012 Reference, chapter 6.
  - As an independent implementation, ezdxf's `entities/spline.py` `set_closed()` writes `PERIODIC | CLOSED`, repeats the first `degree` controls and uses uniform unclamped knots.
  - AutoCAD's own DXF bytes for a periodic spline were not seen (the forum copy returned 403).
- **Refuter:** CONFIRMED, raised from P2 to P1, because a default AutoCAD closed spline reaches it.
- **Fix:**
  - Both domain ends are raised to multiplicity `degree` too, using a Boehm-insertion span search that picks the last copy of a repeated knot (Piegl & Tiller A5.1).
  - Only spans inside the domain become pieces.
  - Clamped splines are unchanged.

### O2-P1-2: GeoJSON export fills a hole when grid snapping moves one vertex across (P1, fixed #1779)

- **Where:**
  - `src/io/vector-formats/fill-region-rings.ts` `ringInside` decided containment from the first hole vertex not on the parent's boundary.
  - Rounding to the 0.001 mm grid can push one vertex of a hole that lies wholly inside its parent a fraction of a micrometre across a slanted parent edge.
  - When that vertex was the probe, the hole was classed as an outer ring and written as its own filled `Polygon`.
- **Reproduction:**
  - Even-odd fill: outer `(0,0)(10,3)(10,10)(0,10)`, hole `(5.0016,1.50049)(8,2.6)(8,6)(5.0016,6)`. The hole corner sits 0.31 µm above y = 0.3x and snaps to (5.002, 1.500), just below.
  - 1730 of 14641 fill-parity grid points disagreed with the PDF, which is the whole hole.
  - The refuter rotated the hole's start vertex: only start 0 failed.
  - In a Monte Carlo run with holes 0.2 µm from the parent edge, 3 of 60 polygons failed. At 0.5 µm and above, none failed.
  - About 3,600 contours from the real tracer produced no failures.
- **Oracle:** RFC 7946 §3.1.6 polygon semantics, compared with the even-odd region the PDF `f*` paints (ISO 32000-1 §8.5.3).
- **Research:** VERIFIED for both RFC 7946 §3.1.6 and ISO 32000-1 Table 60 (`f` nonzero, `f*` even-odd).
- **Refuter:** CONFIRMED.
  - The output is grossly wrong, so this is P1 by the table, which has no reach clause. Its reach is very low.
  - The File > Export toast (`src/ui/app/export-artwork-format.ts`) does reach the user. But it says "separate, overlapping polygons", not that a hole became solid.
  - The Multi-File Trace GeoJSON route shows no warning at all (see O2-P3-7).
- **Fix:**
  - Containment is now decided by the majority of up to 15 evenly spaced probes (vertices, then edge midpoints).
  - An even split falls back to the first probe.
  - The cost stays bounded for dense traced layers.

### O2-P2-1: a SPLINE defined only by fit points is dropped with a misleading note (P2, fixed #1784)

- **Where:**
  - `src/io/dxf/dxf-entities.ts` `splineToPolyline` read only code 10.
  - A SPLINE with fit points (11/21, count 74) and no control points was skipped with "spline needs 4 control points, has 0".
- **Oracle:** DXF Reference SPLINE, codes 11/21 and 74. The format allows a fit-point-only spline.
- **Research:**
  - VERIFIED for the codes (DXF 2012 Reference, chapter 6, SPLINE).
  - The ezdxf documentation, an independent implementation, says `add_spline(fit_points)` writes this form and that AutoCAD and BricsCAD compute the control points themselves ("tested with AutoCAD 2010").
  - AutoCAD's own saves also write control points, so AutoCAD files are not affected.
- **Refuter:** CONFIRMED at P2. Visible, because of the note, but common in scripted files.
- **Fix:**
  - The C2 cubic through every fit point, with chord-length parameters.
  - Natural end conditions, or the 12/22 and 13/23 tangents when the file gives them; periodic when closed.
  - Flattened by the existing tolerance-certified sampler.
  - Not verified: AutoCAD's exact end conditions between fit points (see Not verified).

### O2-P2-2: an HP-GL file that sets speed, force or pen width is refused completely (P2, fixed #1783, ADR-357 Amendment 5)

- **Where:**
  - `src/io/hpgl/hpgl-tokenizer.ts` and `hpgl-types.ts`: `VS`, `FS`, `PW`, `NP`, `PC`, `WU`, `CR`, `MC`, `TR`, `LA` and `PG` were "unsupported".
  - The whole file was refused with "No partial artwork was imported; convert unsupported content to outlines". That advice is misleading because the content is already outlines.
- **Reproduction:**
  - `IN;VS10;SP1;PU0,0;PD400,0;` gives an error.
  - Each of the 18 attribute commands tested fails the same way.
  - Inkscape's default HPGL output passes. With a speed or force set, it fails.
- **Oracle:** HP PCL 5 Technical Reference Part II (HP-GL/2), chapters 19–22. These commands set device or pen attributes and draw nothing.
- **Research:**
  - VERIFIED from the HP manual (archive copy of HP part 5961-0509). On `PG`, it says the printer ignores it because it "could cause undesirable results when importing plots".
  - Vendor and source evidence for how often files contain these commands:
    - Inkscape's `hpgl_encoder.py` writes `;VS`/`;FS` when speed or force > 0.
    - CorelDRAW's PLT export help offers a per-pen velocity.
- **Refuter:** CONFIRMED at P2.
  - ADR-357 §7 names "text, clipping, PCL wrappers or drawing styles", and PROJECT.md says "unsupported HPGL drawing commands".
  - The refusal of VS, PW and PG came from the rolling-v2 audit's reading (`docs/audits/2026-10-21-rolling-v2/14-vector-importers.md`) and the test that pinned it.
- **Fix:**
  - The ten attribute commands are skipped with one note, and one trailing `PG` is accepted.
  - Drawing after `PG` is refused as `multiple-pages`.
  - `RO`, `IR`, `IW`, `PS` and `CT` stay refused because they change geometry or clipping.
  - Recorded as ADR-357 Amendment 5.

### O2-P3-1: DXF `$INSUNITS` 0 or missing is taken as mm silently, and some defined codes fell back (P3, partly fixed #1786)

- **Where:** `src/io/dxf/dxf-document-stream.ts`.
- **Reproduction:**
  - No header, with `$MEASUREMENT 0` (English): a 10-unit line imports as 10 mm with no note.
  - Codes 3, 7, 8, 11, 12 and 15–20 gave "Unrecognized $INSUNITS N — assuming millimeters".
- **Oracle:** DXF Reference HEADER, which lists 21 `$INSUNITS` codes and says `$MEASUREMENT` 0 = English, 1 = Metric. Research: VERIFIED. The Reference calls `$INSUNITS` the "Default drawing units for AutoCAD DesignCenter blocks", so mm for 0 is a defensible guess.
- **Refuter:** CONFIRMED at P3.
- **Fix (#1786):** every defined code now scales by its unit.
- **Listed for the maintainer, not changed:** a note when the units are 0 or missing, possibly naming inches when `$MEASUREMENT` is 0. LightBurn documents a "DXF units" fallback setting for files without units.

### O2-P3-2: SPLINE knot values were checked against the coordinate-size cap (P3, fixed #1777)

- **Where:** `src/io/dxf/dxf-entities.ts` `DXF_SCALED_LENGTH_CODES` included code 40, which on a SPLINE is a knot value, not a length.
- **Reproduction:** an inch file with knots 0..50000 was skipped with "unreadable or out-of-range coordinate value".
- **Oracle:** DXF Reference SPLINE, where 40 is a knot value. Research: VERIFIED.
- **Refuter:** CONFIRMED at P3. AutoCAD knots are chord lengths, so only arbitrary-parameter exporters reach this.

### O2-P3-3: baseline TIFF PackBits, CCITT 1-D and 4-bit are refused (P3, listed)

- **Where:** `src/io/tiff/tiff-page.ts` and `tiff-pixel-layout.ts`.
- **Behaviour:**
  - PackBits gives "Re-save it as LZW or uncompressed".
  - 4-bit and 2-bit grayscale and palette images give "Unsupported TIFF bit depth for this sample format", which offers no way out.
- **Oracle:** TIFF 6.0 baseline. "Baseline TIFF readers must handle all three compression schemes" (none, CCITT 1-D, PackBits), and 4-bit is an allowed baseline grayscale depth. Research: VERIFIED (TIFF 6.0, Sections 3–5).
- **Refuter:** CONFIRMED at P3.
  - macOS Preview and GIMP offer PackBits, but not by default.
  - The fix is about 50–80 lines (`tiff` 7.1.3 throws inside `TIFFDecoder.uncompress`), so it is not cheap. Listed.

### O2-P3-4: Netpbm header comments ending in CR break the headless decoder (P3, fixed #1786)

- **Where:** `src/io/raster-decode/decode-bmp-pnm.ts`, which ended comments only at LF. The in-app `src/io/pnm` decoder was already correct.
- **Reproduction:** `P5\r# hi\r1 1\r255\r` followed by the byte 66 gives "The PNM header is malformed."
- **Oracle:** pbm(5): a comment runs to "the next carriage return or newline". Research: VERIFIED (netpbm.sourceforge.net/doc/pbm.html).
- **Refuter:** CONFIRMED at P3. Only the headless trace CLI (ADR-477) reaches this.

### O2-P3-5: a binary STL with trailing bytes is refused (P3, listed)

- **Where:** `src/io/stl/parse-stl.ts:19`, `parse-stl-binary.ts:43-50` and `parse-stl-blob.ts`.
- **Behaviour:** a valid 1-triangle file with 2 extra zero bytes gives "truncated or padded: 1 triangles need 134 bytes, file has 136".
- **Oracle:** the binary STL layout defines no trailer. Research: UNSOURCED for a primary source; the Library of Congress format description is secondary, since the 1989 3D Systems original is not online.
- **Refuter:** CONFIRMED. No exporter that pads was found.
- **Listed:** accepting the file with a warning changes what imports.

### O2-P3-6: on a traced page, EPS `%%BoundingBox` and the PDF MediaBox exclude half the stroke at the page edge (P3, listed)

- **Where:** `src/io/vector-formats/vector-artwork.ts` `paintedPageBox`. When a caller gives a page, the stroke margin is set to 0.
- **Reproduction:**
  - `writeTracedDrawing('eps')` with a 10 × 10 mm page and a stroke from (0,0) to (10,10) gives `%%BoundingBox 0 0 29 29`.
  - The ink runs from −0.1417 pt, so the MediaBox clips half of the 0.1 mm hairline.
- **Oracle:** DSC 3.0 `%%BoundingBox` and the EPSF 3.0 rule that it must enclose all marks. Research: DSC VERIFIED; EPSF 3.0 (TN 5002) UNSOURCED, as it could not be fetched.
- **Refuter:** CONFIRMED at P3. It affects only Centerline or stroke output that touches the image border.
- **Listed:** it changes the exported page size.

### O2-P3-7: GeoJSON silently drops dots, and the Multi-File Trace route drops its warning (P3, listed)

- **Where:** `src/io/vector-formats/geojson-writer.ts:196` and `traced-drawing.ts:29`.
- **Behaviour:**
  - A zero-length stroked subpath is written by PDF as a round-cap dot. ISO 32000-1 §8.5.3.2 says it then paints a filled circle. GeoJSON drops it with no message.
  - Two identical even-odd contours paint nothing in PDF but two filled polygons in GeoJSON. They are flagged `unmerged`, and the toast blames "crossing outlines".
  - `writeTracedDrawing` returns only `.text`, so the Multi-File Trace and trace-CLI GeoJSON routes show no `unmerged` warning at all.
- **Research:** VERIFIED for ISO 32000-1 §8.5.3.2 and RFC 7946.
- **Refuter:** CONFIRMED at P3.
- **Listed:** the toast wording and a union fallback for coincident rings are UI and behaviour choices.

### O2-P3-8: SVG path data for subpaths with an arc printed exponents (P3, fixed #1786)

- **Where:** `src/core/vector-export/svg-path-data.ts` `exactNumber` (`String(value)`).
- **Reproduction:** a rounded corner with float noise gives `M1.2246467991473532e-16 2L0 8.000000000000002A2 2 0 0 0 2 10…`.
- **Oracle:** SVG 1.1 path grammar. Research: VERIFIED that exponents are legal. UNSOURCED that any consumer rejects them; web access was blocked for the refuter.
- **Refuter:** CONFIRMED in principle at P3. The app's own shape tools never produced an exponent in 100 tries; imported or hand-built arcs can.
- **Fix:** the shortest round-trip decimal without an exponent. The geometry is unchanged.

### O2-P3-9: an HP-GL file wrapped in PCL fails with a cryptic message (P3, listed)

- **Where:** `src/io/hpgl/hpgl-tokenizer.ts`.
- **Behaviour:** a file that starts `ESC%-1B…` fails with "Expected a two-letter command" at character 1 "(%)".
- **ADR:** ADR-357 §7 deliberately refuses PCL wrappers. Only the message is at issue.
- **Listed:** strip the wrapper, or name it in the error.

## Known (not re-raised)

- **DXF circles, arcs, bulges and ellipses import as 90° cubics.**
  - The radial error is 2.725e-4·r, which exceeds the 0.025 mm compile tolerance above r ≈ 92 mm (0.136 mm at r = 500).
  - This is the project-wide `parametricEllipseCurve` convention, already recorded in ADR-159 Amendment 2 and in audit **L2-P3-1** (`docs/audits/2026-10-28-rolling-v7/L2-shapes-dimensions.md`).
  - New evidence: the DXF import reaches it too.
- **PDF and EPS arcs are written as quarter-turn cubics with the same 2.7e-4·r error.**
  - The auditor's premise that `vector-artwork.ts:73` claims the grid tolerance for arcs was refuted. That comment and ADR-468 claim half a grid diagonal for snapping only. ADR-468 separately records that arcs become cubics of at most a quarter turn, and its test notes record the 0.136 mm deviation.
  - Shapes from the app's own ellipse and rounded-rectangle tools are already 4 cubics in the scene, so for them the PDF reproduces the scene exactly.

## Refuted

No finding was refuted outright. One premise was refuted: the PDF/EPS arc "tolerance claim" (see Known).

## Verified clean

Each item is checked against its oracle with an independent fixture or reader. Except where an item says otherwise, the research verifier VERIFIED its source.

### DXF import

- **Bulges:** negative bulge passes through (5,5) with 0 error. The closing bulge is applied when the polyline is closed and ignored when open, for LWPOLYLINE and 2D POLYLINE alike.
- **OCS, extrusion −Z:** ARC, CIRCLE, LWPOLYLINE, 2D POLYLINE and INSERT are mirrored as the arbitrary-axis algorithm requires. An ELLIPSE with −Z and parameters 0..π/2 ends at (10, 17.5), as derived.
- **INSERT:** base point plus X scale −2 plus 30° plus a 3 × 2 array: 6 copies within 8e-14. Spacing is rotated but not scaled. Nested INSERTs compose correctly, and a mirrored INSERT keeps arc direction.
- **Units:** `$INSUNITS` 1, 2, 5, 0 and missing give 25.4, 304.8, 10, 1 and 1. An ARC with end < start wraps through 0°.
- **POLYLINE flags:** a 70=4 POLYLINE draws fit vertices (70=8) and skips frame points (70=16).
- **Parsing:** CRLF, 999 comments and group codes with leading spaces all parse.
- **Unsupported entities:** TEXT, MTEXT, HATCH, DIMENSION, SOLID, 3DFACE and POINT each appear in the skipped summary.
- **Rational splines:** clamped rational splines are exact (quarter circle |r − 10| < 1e-5).

### DXF export

- **Structure:**
  - AC1018 with HEADER (`$ACADVER`, `$HANDSEED`), CLASSES, the 9 tables, the model and paper space blocks, and the OBJECTS root dictionary. That meets ezdxf's documented minimum for R2000 and later.
  - Handles are unique, with no dangling owners.
  - LWPOLYLINE has its subclass markers.
- **Units and accuracy:**
  - `$INSUNITS 4` and `$MEASUREMENT 1` match the mm coordinates.
  - Y is mirrored, bulge signs are correct, and |bulge| ≤ 1.
  - Hausdorff error is ≤ 0.0084 mm against the truth, read by an independent reader, and the round trip through our importer is ≤ 0.0115 mm.
- **Decimal grid:** never flips a bulge, keeps a 1 µm ring, and does not make a 0.8 µm slot self-touch.

### HP-GL

- 40 units per mm.
- Not mirrored: an L-shape lands as expected, and AA0,0,90 passes within 1e-6 mm of the counter-clockwise 45° point.
- PR persists.
- PU and PD with lists of points.
- Lowercase commands, glued mnemonics, sign-separated numbers.
- CI returns the pen to the centre.
- IP/SC types 0, 1 and 2 give 100 × 50, 100 × 100 and 10 mm.
- EA, RA, PM and FP carry the fill rule with a note.
- PE is refused loudly.

### STL

- A binary file whose header starts "solid … facet" is detected as binary in both paths.
- ASCII with uppercase keywords, CRLF, tabs, exponent numbers, a BOM and two solids all parse.
- The heightmap Y is flipped consistently.
- mm is stated in the toast.
- Research: the units claim is UNSOURCED, because STL defines none.

### TIFF

- **Byte order:** II and MM. BigTIFF is refused loudly.
- **Physical size:**
  - 300 dpi inch: 0.1693 mm for 2 px.
  - Missing ResolutionUnit means inch.
  - Unit 3 (cm) at 40/20 px/cm gives 25 × 25 mm end to end, through `tiff-artwork-source.ts:89` to the scene bounds.
  - Unequal X/Y resolution works.
  - Unit 1 (none) uses the default 254 dpi and tells the user.
- **Photometric:**
  - WhiteIsZero is inverted at 1, 8 and 16 bit.
  - Palette: 65535 → 255, laid out R, then G, then B.
  - 16-bit LE and BE; float32.
- **Alpha:** associated and unassociated alpha composite over white.
- **Compression:**
  - LZW crosses 512, 1024 and 2048, including predictor 2 at 8 and 16 bit.
  - Deflate 8 and 32946.
- **Layout:**
  - Edge tiles: 0 bad pixels.
  - Orientation 3, 6 and 8, with the DPI axes swapped.
  - Multi-page files use page 1 and expose the page count.

### PSD

- 0x03ED is read as 16.16 PPI, including when the display unit is PPCM, for fractional values, and with unequal X/Y.
- Raw and RLE (with −128 as a no-op).
- Merged alpha is un-matted from white.
- A 4th channel with layers is treated as a selection.
- 16-bit, Bitmap, Indexed, CMYK, Duotone and PSB are refused loudly.
- Research: the ResolutionInfo layout is UNSOURCED. Adobe's spec defers to the Photoshop API Guide, which could not be fetched; secondary sources agree.

### Netpbm

- P1 with no separators.
- P4 with padded rows, 1 = black.
- maxval 65535 and 1000 scale correctly.
- Exactly one delimiter byte after maxval.
- A comment straight after maxval.
- Concatenated images: the first is used.
- P7 is refused.

### PDF

- Every xref entry is 20 bytes, ending in a space then LF.
- Each offset lands on `N 0 obj`, and entry 0 is `65535 f`.
- `/Size` and `startxref` are correct, and stream `/Length` is exact.
- MediaBox 283.4646 pt for 100 mm. 1e5 mm uses UserUnit 20.
- Hairline 0.28346 pt = 0.1 mm.
- `f*` for even-odd and `f` for nonzero (text). Paint parity has 0 mismatches for donut, island-in-hole and both winding cases.

### EPS

- Exact first line.
- An integer `%%BoundingBox` that encloses all marks on the artwork page.
- `%%HiResBoundingBox`: research UNSOURCED, as it is not in DSC 3.0.
- `%%EndComments`, no forbidden operators, one `showpage`, lines ≤ 250 characters, ASCII.

### GeoJSON

- Valid JSON. Rings are closed with at least 4 positions.
- Exterior counter-clockwise and holes clockwise. RFC 7946 makes this a MUST for producers; readers SHOULD NOT reject.
- bbox, no NaN, no exponents, no `crs` member.
- Within 0.01 mm plus the grid.
- mm, not degrees, is disclosed.

### SVG export

- width and height in mm equal the viewBox.
- Arcs are exact (2e-16) with sweep 0 and 1 and under mirror/rotate/scale.
- Every `d` parses under the full grammar.

## Not verified

- **AutoCAD's own DXF bytes for a periodic SPLINE.** Evidence for O2-P1-1 is Autodesk's help (primary) and ezdxf (an independent implementation); no AutoCAD file was inspected.
- **Periodic SPLINE knot count n + 1.** ezdxf cites Autodesk developer documentation that a periodic spline's knot vector has control count + 1 entries. The import's length check would reject that form with a "knot count" note. No DXF file in that form was found, so it is not raised.
- **AutoCAD's end conditions for fit-point splines.** The O2-P2-1 fix uses natural ends with chord-length parameters, and interpolates the fit points exactly.
- **PSD CMYK inversion and Bitmap bit polarity.** Adobe's spec does not document them. KerfDesk refuses both modes, so nothing is decoded wrongly.
- **LightBurn's DXF unit detection.** It documents "Auto-detect units if possible" plus a fallback, but not which header variable it reads.

## Fix pull requests

| PR | Findings | State at writing |
|---|---|---|
| #1777 | O2-P1-1, O2-P3-2 | auto-merge (MERGE) on, CI running |
| #1779 | O2-P1-2 | auto-merge (MERGE) on, CI running |
| #1783 | O2-P2-2, ADR-357 Amendment 5 | auto-merge (MERGE) on, CI running |
| #1784 | O2-P2-1 | auto-merge (MERGE) on, CI running |
| #1786 | O2-P3-1 (codes), O2-P3-4, O2-P3-8 | auto-merge (MERGE) on, CI running |

Listed for the maintainer, not changed: O2-P3-1 (the note when units are missing), O2-P3-3, O2-P3-5, O2-P3-6, O2-P3-7 and O2-P3-9.
