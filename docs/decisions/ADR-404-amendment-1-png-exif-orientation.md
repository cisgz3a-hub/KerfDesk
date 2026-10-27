## ADR-404 Amendment 1 - A PNG turns by its eXIf Orientation, and EXIF is read as Chromium reads it (2026-10-28)

**Status:** Accepted on 2026-10-28 |
**Amends:** ADR-404 decision 1 (which files are turned, and how an Orientation is read) and its
Consequences ("Orientation is read from JPEG only")

### Context

Rolling audit v5, report J6 (adversarial parsers), confirmed J6-P1-1 at P1: a PNG whose eXIf
chunk records an Orientation of 5 to 8 imported squashed, with only a success toast.

- Chromium turns a PNG by its eXIf Orientation. Electron 44 ships Chromium 152.0.7977.130, whose
  PNG decoder is Skia's Rust codec; `SkPngRustCodec.cpp` L358-L367 at the pinned Skia revision
  `e8efd15f` returns the eXIf chunk's origin, and `skia_image_decoder_base.cc` L109 applies it.
- ADR-404's Consequences assumed that if an engine applied a PNG's eXIf, "the image-element route
  still decodes self-consistently". It did not. The loader read a PNG as never turned and sized
  it from IHDR, while the pixels came from Chromium already turned. A 40 x 20 px PNG with
  Orientation 6 landed as a 4 x 2 mm box holding a 20 x 40 grid, each pixel stretched 4:1.
  Above the decode cap, `createImageBitmap` was asked for the stored aspect and returned the
  turned picture squeezed into it. A PNG of 25 MB or more, or past the canvas edge, went to
  KerfDesk's own streaming decoder, which ignored eXIf, so the same picture imported two ways
  depending on its file size. The siblings were embedded SVG PNGs (`svg-embedded-bitmap-size.ts`),
  the remote `import_file`, Trace, Multi-File Trace and the headless trace.

To match Chromium exactly, purpose-built JPEG and PNG files were opened in Chrome
152.0.7977.167 (the app's browser pane, the line Electron 44 ships):

| File | Chromium |
|---|---|
| eXIf Orientation 6 before IDAT | turned, 20 x 40 |
| the same eXIf after IDAT | not turned |
| eXIf data starting with JPEG's `Exif\0\0` | not turned |
| two eXIf chunks, 1 then 6 / 6 then 1 / one with no Orientation then 6 | the first decides: not turned / turned / not turned |
| first eXIf with a bad CRC, then a good one with 6 | turned (the bad one is skipped) |
| Orientation entry with count 2, or type LONG | not turned |
| two IFD0 Orientation entries, 0 then 6 / 6 then 3 | 6 / 6 (the first valid one) |
| Orientation only in the Exif sub-IFD (tag 0x8769), PNG and JPEG | turned |
| IFD0 Orientation 9 or count 2, sub-IFD 6 (JPEG) | turned |
| IFD0 Orientation 1, sub-IFD 6 (JPEG) | not turned |
| 100 kB tEXt chunk, then eXIf 6 | turned |

The last rows showed a second gap: KerfDesk read IFD0 only and treated an invalid Orientation
entry as the end of the search, so a JPEG whose valid Orientation sits in the Exif sub-IFD also
imported squashed.

### Decision

1. **One reader, Chromium's rules.** `io/raster-decode/exif-orientation.ts` reads an EXIF TIFF
   block as Skia's SkExif does: the header must read `II*\0` or `MM\0*`; IFD0's entries are read
   in order and the first Orientation that is exactly one SHORT of 1 to 8 decides; any other
   Orientation entry is skipped; when IFD0 has none, the Exif sub-IFD it points to (one LONG) is
   read the same way. For a PNG, only an eXIf chunk before the first IDAT counts, one with a bad
   CRC is skipped, and the first good one decides even when it records no Orientation. The JPEG
   header reader (`ui/trace/jpeg-header.ts`), the new PNG header reader (`ui/trace/png-header.ts`),
   embedded SVG bitmaps, the streaming PNG import and the headless trace all use it. This replaces
   decision 1's rule that an invalid Orientation entry means 1: it is skipped, as Chromium skips it.
2. **A PNG is sized turned, everywhere a JPEG is.** The loader's safety check, decode cap,
   `createImageBitmap` request, element fallback (which turns the image on the canvas when an
   engine ignores the tag) and `readImageNaturalSize` use a PNG's turned size exactly as decision
   1 does for a JPEG. When the 64 KiB header probe ends before IDAT, behind a large ICC profile
   or text, the rest of the file is read for the eXIf; the import reads the whole file anyway.
3. **pHYs swaps with the axes.** A PNG's pHYs density describes the stored axes, so an
   Orientation that swaps rows and columns swaps its X and Y DPI, as decision 1 does for JFIF and
   EXIF densities.
4. **The streaming import turns too.** The streaming decoder records the first good eXIf before
   IDAT and reports its Orientation before the first row. An Orientation other than 1 keeps the
   sampled luma grid (at most `BURN_MAX_SOURCE_PIXELS` bytes) until the last row and writes it
   turned, so the paged luma, its thumbnail, the size and the density all match the turned
   image. The same picture now imports the same way at any file size.
5. **Embedded SVG bitmaps and the headless trace follow.** An embedded PNG's
   `preserveAspectRatio` fit uses its turned size, and the headless trace turns a PNG before
   tracing it, as the app's import does.

### Consequences

- Projects saved before this keep what they stored, as ADR-404 decided for turned JPEGs: their
  bounds, pixel grid and luma are unchanged, and re-importing the file gives the upright size.
  The re-decode fallbacks use `fitDecodeToStoredGrid`, which also covers a PNG saved on a
  transposed grid.
- Orientations 2 to 4 of an engine that ignores the tag still cannot be detected from the image
  size; the supported engine applies them.
- The streaming decoder still fails an import on any chunk with a bad CRC, as before, where
  Chromium skips a bad ancillary chunk. An eXIf over 1 MiB is read there as recording no
  Orientation.
- Depth-map and relief-heightfield PNGs, which use the same decoder's exact lanes, still read
  their rows as stored. Whether such files ever carry an eXIf was not checked.
- `ui/common/image-density.ts` still walks the JPEG segments and IFD0 for its DPI tags with its
  own loop; merging it onto the shared reader remains a follow-up.
- Code and test evidence, plus the Chrome 152 measurements above. The Electron renderer was not
  run against these files, and no engraving was made.

### Measured before and after

| Case | Before | After |
|---|---|---|
| 40 x 20 PNG, eXIf Orientation 6, 254 DPI | bounds 4 x 2 mm, grid 20 x 40 | bounds 2 x 4 mm, grid 20 x 40 |
| 4000 x 3000 PNG, Orientation 6: decode request | 2048 x 1536 (squashed) | 1536 x 2048 |
| 3 x 2 PNG, Orientation 6, streaming import | 3 x 2, luma as stored | 2 x 3, luma turned |
| PNG pHYs 300 x 150 DPI, Orientation 6 | 300 x 150 | 150 x 300 |
| JPEG, Orientation 6 only in the Exif sub-IFD | 40 x 20 (squashed) | 20 x 40 |
| SVG-embedded PNG 40 x 20, Orientation 6 | fitted as 40 x 20 | fitted as 20 x 40 |

Regression tests: `io/raster-decode/exif-orientation.test.ts`,
`ui/trace/image-loader-png-orientation.test.ts` (Orientations 1 to 8, PNG and JPEG, through
`readImageNaturalSize`, the trace loader and the import geometry),
`ui/import/png-incremental-decoder.test.ts`, `ui/import/png-paged-import.test.ts`,
`io/svg/svg-embedded-bitmap-size.test.ts` and `ui/trace-cli/trace-cli-source.test.ts`.
