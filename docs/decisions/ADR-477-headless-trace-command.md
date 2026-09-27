## ADR-477 - Headless trace command (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

This adds a command-line front end to the Multi-File Trace pipeline (ADR-409, ADR-451,
ADR-468). It runs outside the app: no scene, compile, G-code, Frame or Start path reads the
new code, so the Frame-first contract (PROJECT.md non-negotiable 21, ADRs 228, 230, 232 and
237) is untouched.

### Context

Shops that script Potrace (`potrace -s input.pbm -o out.svg`) could not move that workflow to
the KerfDesk tracer: tracing needed the app, a browser decode and a save dialog. Potrace's
documented command line (its man page, used as a behaviour reference only; no Potrace source
was consulted) reads PNM/BMP from a file or standard input, writes to a file or standard
output, and takes a backend and tracing parameters as flags.

### Decision

1. **One pipeline.** `src/ui/trace-cli/run-trace-cli.ts` traces one image with
   `traceImagesToVectorFiles` and the writers Multi-File Trace passes it
   (`tracedLayersToDxf`, `writeTracedDrawing`), so for the same pixels, size and options SVG,
   DXF, PDF, EPS and GeoJSON come out byte for byte as the app writes them (which pixels
   reach the tracer is point 3's and point 4's business). Output defaults are the Multi-File Trace dialog's:
   precision 0.001 mm, contours ungrouped, the image page (`--page artwork --margin <mm>` is
   ADR-451's artwork page).
2. **Trace settings are the Trace dialog's.** `--preset` takes the dialog's visible presets
   (any case; dashes or underscores for spaces). Every Trace dialog override in
   `TRACE_OVERRIDE_RULES` has one flag (`--cutoff`, `--threshold`, `--ignore-less-than`,
   `--smoothness`, `--optimize`, `--diagonal-contacts`, `--[no-]invert`, ...); a new override
   without a flag is a type error. Values outside the control's range are refused (exit 2),
   not clamped. The preset and overrides merge through `mergeLightBurnTraceSettings`, as in
   the dialog. Line + fill's `--max-stroke-width` (mm) converts through the image's density,
   as the dialog converts it through the placement; without it the preset's own gate holds,
   as in Multi-File Trace.
3. **Decoding without a browser.** `src/io/raster-decode/` picks a decoder from the magic
   bytes, never the file name, so standard input needs no hint: PNG (every colour type and
   depth, tRNS, Adam7; inflate through the web-standard `DecompressionStream`), JPEG through
   the decoder pdf.js already ships to the app (`pdfjs-dist`, Apache-2.0), BMP (palette,
   16/24/32-bit, bit fields), TIFF through the app's TIFF importer (`tiff`, MIT; first page,
   oriented) and Potrace's Netpbm P1-P6. No dependency is added and none is GPL. The CLI then
   prepares pixels as the import does: EXIF Orientation turns a JPEG upright, RGB is
   composited onto white with alpha kept, and the size in millimetres comes from the density
   Multi-File Trace reads (PNG pHYs, JPEG JFIF/EXIF, BMP, from the same 1 MiB header prefix
   `readImageHeaderDensity` reads, unreadable meaning none), a TIFF's resolution tags, or
   `--dpi`, else 254 dpi. The decoders apply no colour management: PNG gAMA/iCCP/cHRM and
   JPEG ICC profiles, which the browser converts, are ignored. pdf.js's JPEG decoder uses a
   different IDCT and chroma upsampling than the libjpeg-turbo decode in Chromium and
   Electron, so JPEG pixels differ: on the test fixture by at most 12.5 luma levels (about
   one on average), at saturated colour edges; a pixel
   near the cutoff can land on the other side of it and move traced edges by a pixel.
4. **Grid.** The CLI traces the stored pixel grid (up to 268 megapixels). The app's
   Multi-File Trace instead decodes through the browser at the preview cap
   (`PREVIEW_MAX_EDGE_PX`, 2048 px on the long edge) and may re-trace on a finer commit grid
   planned from the machine's spot size. For images at or under the cap the two are the same
   trace. Above it the CLI scales the pixel-unit settings (Ignore less than, despeckle,
   Minimum line, gap joins, Line + fill's preset stroke gate) from the preview grid to the
   stored grid with `traceOptionsForCommitGrid`, as the app does for its commit grid, so a
   given `--ignore-less-than` drops the same physical specks the dialog drops; the geometry
   is then a finer trace than the app's, not the same bytes.
5. **Running it.** `pnpm trace [options] [input]`, or the package `bin` `kerfdesk-trace`
   (`scripts/trace-cli.mjs`), which loads `scripts/trace-cli.ts` through Vite's SSR module
   loader, a dev dependency, so the source that runs is the app's and no bundle step can go
   stale. Exit status: 0 traced, 1 unreadable image or failed trace, 2 invalid options, 3
   nothing to draw (no file written). `--help` prints every flag from the same tables the
   parser reads.

### Consequences

- `src/ui/commands/trace-cli-parity.test.ts` hashes the CLI's SVG against
  `buildMultiFileTraceExports` (with its natural-size planning branch running) for Line
  Art, Smooth and Centerline on opaque synthetic PNGs, and for a PNG with a 300 dpi pHYs, a
  PNG whose transparent ground carries black RGB (traced by luma and with Trace
  transparency) and a BMP with pixels-per-metre. It catches a drift in PNG/BMP decoding,
  embedded density, alpha compositing, option merge or writer defaults. It does not model
  the browser's decode: it hands the app side the straight-alpha pixels the PNG stores.
- Exact parity holds for 8-bit sRGB PNG, BMP and Netpbm images up to 2048 px on the long
  edge. Partly transparent pixels can differ by a unit from a browser decode, whose canvas
  premultiplies alpha; JPEG pixels differ as point 3 says, bounded by a test against a
  libjpeg-turbo reference decode (`decode-jpeg-reference.test.ts`); colour-managed images differ by their profile.
- Start-up costs a few seconds while Vite transforms the source; batch many images from one
  shell loop, or use Multi-File Trace in the app.
- Not included: Potrace's own flag spellings (`-t`, `-a`, `-O`), the pgm, gimppath and xfig
  backends, and multi-image batches from one invocation.
