# Document import browser fixtures

These seven small fixtures were authored for KerfDesk's September 2026 import audit. They contain no third-party artwork. `generate.mjs` reproduces them from explicit PDF/HPGL/BMP/GIF bytes and the existing independently encoded TIFF fixture builder in `src/__fixtures__/tiff-document.ts`:

```sh
node e2e/fixtures/document-import-generated/generate.mjs
```

| File | Intended meaning |
| --- | --- |
| `two-pages.pdf` | Two 144 × 72 point pages (50.8 × 25.4 mm): red editable paths, then blue Helvetica text requiring whole-page image fallback. |
| `compatible.ai` | Exactly the same PDF bytes with an AI filename, exercising PDF-compatible Illustrator routing, not general Illustrator support. |
| `legacy.ai` | PostScript-only Illustrator-like input that must be rejected without insertion. |
| `oriented-pages.tif` | Two 2 × 3 grayscale pages at 100 × 200 DPI. Page 2 has orientation 6: clockwise 3 × 2 pixels `[200,100,0,250,150,50]`, 0.381 × 0.508 mm. |
| `density-150x300.bmp` | 8 × 4, black left half and white right half. Independent embedded density axes normalize to 150 × 300 whole DPI under the existing image-density contract. |
| `black-then-white.gif` | Two 64 × 32 frames: black then white. Import must preserve the first frame as a frozen PNG. |
| `ordered-pens.plt` | Plain HPGL with a 40 × 20 mm rectangle and a second pen's horizontal line. No PCL wrapper or unsupported commands. |

The browser tests intercept only the platform file-picker/save boundary. Production parsers, owned PDF/TIFF workers, page selection, image encoding, insertion, Undo/Redo, and project Save As/Open run normally. Cancellation tests hold one real native encoder callback or the worker script request and release it after the actual Cancel/New UI action; they do not stub parsing or inject the desired result.

## Optional pinned upstream corpus

Set `KERFDESK_DOCUMENT_CORPUS_ROOT` to a separately attributed directory containing `fixtures/` and `reference/`. Without it, upstream cases are explicitly skipped; the seven authored fixture cases still run. The test helper verifies input SHA256 values. Donor files are not vendored because their attribution/licensing record belongs with the independent audit corpus.

| Case | Original upstream source | Reference |
| --- | --- | --- |
| E1/E2 | W3C SVG 1.1 suite, `https://www.w3.org/Graphics/SVG/Test/20110816/svg/{paths-data-02-t,masking-path-02-b}.svg` | Corresponding `png/` upstream PNGs. |
| E3/E4 | qpdf commit `54d6053af283bbeb8b325f4886c0f65cc51f2b80`, `qpdf/qtest/qpdf/{boxes,nested-form-xobjects-inline-images}.pdf` | Poppler 26.07.0, `pdftoppm -f N -l N -singlefile -r 72 -cropbox -png`. |
| E5 | Pillow commit `693df7b42c666f88c719f9973be0ad71607328e0`, `Tests/images/multipage.tiff` | Pillow 12.3.0, seek each page and convert to RGBA PNG. |
| E6 | GNU `https://ftp.gnu.org/gnu/hp2xx/hp2xx-3.4.4.tar.gz`, member `hp2xx-3.4.4/hp-tests/spectrum.plt` | Expected rejection of the unmodified ESC/PCL wrapper; no positive rendering claim. |

The prior audit's `provenance.json`, `reference-results.json`, and `external-import-corpus-plan.md` supply downloaded hashes, reference commands, attribution and licence limits. Reference filenames are explicit in `document-import-external.ts`. These cases qualify those exact files and supported/declared rejection paths; they do not establish complete format parity.

PDF comparisons preserve raw whole-image changed-pixel counts, maximum/mean RGB difference and >8/255 difference counts. Because PDF.js and Poppler antialias edges differently, E3 also checks flat-region differences outside a 5 × 5 reference-neighbourhood edge detector (2 pixel radius). Separate coloured-frame correspondence searches only a 3 × 3 neighbourhood (1 pixel radius). Exact dimensions, crop colour, orientation, physical size and all six E4 image patches remain independent assertions. TIFF uses exact RGBA comparison. These tolerances are not pixel-identical rendering claims.

Example with an already running local dev server and a licensed local corpus:

```powershell
$env:PLAYWRIGHT_PORT = '5275'
$env:KERFDESK_DOCUMENT_CORPUS_ROOT = '<corpus-root>'
node node_modules/@playwright/test/cli.js test e2e/document-import-acceptance.e2e.ts --reporter=list --output='<unique-output-directory>'
```
