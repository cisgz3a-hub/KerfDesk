## ADR-372 - Offline barcode and QR Code generation (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

### Context

ADR-164 adopted bounded offline variable text but left barcode and QR Code
generation out of scope, and ADR-279 (as amended by ADR-350) repeated the
deferral. LightBurn has shipped a barcode tool for years, and the gap audit
lists it as missing: operators engrave serial plates, asset tags, product
labels and QR links, usually in batches where every copy carries a different
number.

Maintainer direction (John, 2026-09-24): "build all from the gap and make
better than lightburn".

A barcode differs from other generated artwork in one way that shapes every
choice below: a wrong code is worse than none. A plate that scans to the
previous serial, or to a mistyped check digit, passes a visual check and fails
in the field. Generation therefore has to be verifiable, and every path that
cannot produce the right code has to stop instead of producing a different one.
KerfDesk is also offline-first and avoids new dependencies.

### Decision

1. **Generate barcodes offline with in-repo encoders; no new dependency.**
   `src/core/barcode` is pure and covers:
   - QR Code model 2 (ISO/IEC 18004): versions 1-40, error correction L, M, Q
     and H, numeric, alphanumeric and byte (UTF-8) segments with shortest mixed
     segmentation, the smallest version that fits, and the mask with the
     lowest standard penalty.
   - Data Matrix ECC 200 (ISO/IEC 16022): the 24 square sizes from 10 x 10 to
     144 x 144 with ASCII encodation (digit pairs, Latin-1 through Upper Shift).
   - Code 128 with the shortest automatic mix of code sets A, B and C (Shift
     included); Code 39 at a 3:1 wide-to-narrow ratio without the optional
     check character; EAN-13, UPC-A and EAN-8, which add the check digit when
     it is omitted and refuse a wrong one.

   GS1 application identifiers (FNC1), ECI, QR Kanji mode, rectangular Data
   Matrix, the C40/Text/Base 256 encodations, full-ASCII Code 39 and other
   symbologies (PDF417, Aztec) are out of scope until someone needs them.
2. **A barcode is a `shape` object with a `barcode` spec.** The spec holds the
   symbology, the data, an optional variable template, the QR error
   correction, the size mode, module size, overall width, bar height, quiet
   zone (in modules), invert and human-readable text. The paths are derived
   from it:
   - Matrix codes become merged outlines traced along module edges: one
     outline per connected dark region, enclosed light regions as holes, and
     regions that touch only at a corner kept apart. 1D codes are one rectangle
     per bar. Every vertex lies on the module lattice, so no edge is rounded or
     approximated.
   - The quiet zone is part of the object's bounds, so arranging, nesting and
     framing keep it clear.
   - Size by module (X-dimension) or by overall width including quiet zones;
     modules stay equal either way. Modules under 0.05 mm are refused. Modules
     under 0.2 mm and quiet zones below the standard (QR Code 4, Data Matrix 1,
     Code 128 and Code 39 10, EAN-13 11, UPC-A 9, EAN-8 7 modules) draw with a
     warning. Data Matrix defaults to 2 modules because engraved edges are
     rarely crisp.
   - **Invert** engraves the light modules and the quiet zone instead, for
     stock that marks lighter than its surface (anodised aluminium, slate,
     painted metal). 1D codes then become a plate with the bars and the text
     as holes.
   - Human-readable text under 1D codes is outlined with the bundled Roboto
     through the same renderer seam as variable text. EAN and UPC codes place
     their digit groups under their halves and extend the guard bars, as GS1
     lays them out.
   - Everything lands in one even-odd path, so holes and inverted text stay
     holes under Fill and in SVG export.
3. **Variable data re-encodes per copy and fails closed.** The data can be a
   template with the same fields as variable text (`{{serial:N}}`, date and
   time, CSV columns, cut settings). The canvas shows the code for the current
   value. Every output path that materializes variable text (Save G-code,
   Start, Frame, previews and estimates through the output snapshot, SVG
   export) evaluates the template for its copy and re-encodes the code. A value
   the symbology cannot carry fails that output with the object and value
   named; the previous copy's code is never engraved in its place. Grid arrays
   with **Advance variables per copy** give each barcode copy its own sequence
   offset, and serial advancement counts barcodes the same way it counts text.
4. **Insert and edit through one dialog.** **Tools → Barcode...** (also in the
   toolbar's More menu) opens a dialog with type, data, variable data, error
   correction, size, bar height, quiet zone, invert and text. It re-encodes on
   every change and previews the outlines black on white, so the preview can be
   scanned from the screen. Invalid data shows the reason inline and disables
   **Insert**. A new code lands centred on the bed, unscaled, on its own Fill
   operation; the operation stays Fill even when layer defaults would start it
   as a line, because only filled modules scan. Double-clicking a barcode, or
   **Edit barcode...** in the artwork panel, reopens the dialog and replaces the
   code in place, keeping its placement, bindings and per-object settings. Each
   is one undo step.
5. **No schema bump.** The loader validates every barcode field and range, and
   validates the template with the variable-text validator. Builds that predate
   this decision already reject the unknown shape kind with a clear message, so
   a project containing barcodes fails closed in them; a bump would only move
   that failure while touching migration code that other work is changing.
6. **No machine-output change.** Barcodes compile through the existing Fill and
   Line operations. Frame-first (PROJECT.md rule 21; ADR-228, ADR-230, ADR-232,
   ADR-237) is unchanged, and nothing here adds a Start block.

### Consequences

- Operators can make QR Codes, Data Matrix codes and retail or industrial 1D
  codes offline, serialise them across an array or a CSV file, and check them
  before burning.
- Beyond matching LightBurn's barcode tool: the outlines are exact merged
  contours on the module lattice, so Fill has no internal seams to double-burn
  and Line mode traces only real edges; invert also knocks the text out; the
  quiet zone is part of the object; the preview can be scanned before burning;
  and a variable value that cannot be encoded stops the job instead of reaching
  the material.
- The encoders are hand-written, so their correctness rests on the tests below.
- Scaling a barcode on the canvas scales its modules with it; the dialog's
  size applies before that scale. Converting to path turns it into ordinary
  artwork that no longer re-encodes.
- Human-readable text needs the font at insert and at output. If it cannot be
  drawn, the dialog stays open with the reason, and output fails.

### Alternatives rejected

- **An npm encoder** (qrcode, bwip-js, zxing-js). Each adds a dependency and a
  licence review for a small, well-specified algorithm, and each returns
  per-module squares or a bitmap that would still need the outline and layout
  work above.
- **One square per module.** Thousands of touching rectangles overlap along
  shared edges, so a Fill burns every seam twice and a Line pass outlines every
  module.
- **Encode only at Start.** The canvas would then show no scannable code, and
  the operator could not check a design before running it.

### Verification

- `src/core/barcode/reed-solomon.test.ts`, `qr-tables.test.ts`,
  `qr-segments.test.ts`, `qr-encode.test.ts`: generator polynomials, ISO/IEC
  18004 Annex I and thonky.com worked examples, the full block and format
  tables, ZXing's payload and interleave vectors, two complete reference
  symbols including the chosen mask, the penalty minimum and every capacity
  boundary.
- `data-matrix-encode.test.ts`: published ASCII, pad and check-codeword vectors,
  ZXing's 12 x 12 placement matrix, and placement invariants for every size.
- `linear-codes.test.ts`: Code 128 values and code-set choices, Code 39 and
  EAN/UPC module strings from ZXing, check digits and guard bars.
- `barcode-layout.test.ts`, `materialize-barcode.test.ts`: the drawn outlines are
  sampled back into modules at module centres under even-odd fill and decoded by
  reference decoders in `src/__fixtures__/barcode/`, written from the standards
  and independent of the encoders; quiet zones, lattice alignment, invert,
  sizing and text placement are checked the same way.
- `src/io/gcode/materialize-variable-barcode.test.ts`,
  `src/ui/state/prepare-variable-array-barcode.test.ts`: per-copy re-encoding
  (decoded), sequence offsets, failure on an unencodable value, and SVG export.
- `src/io/project/project-barcode.test.ts`: save/load round trips for every
  symbology and variable templates, and rejection of each malformed field.
- `src/ui/barcode/*.test.ts(x)`, `src/ui/state/barcode-insert-mutation.test.ts`:
  the dialog, insert and edit, and the command wiring through the menu audit.
