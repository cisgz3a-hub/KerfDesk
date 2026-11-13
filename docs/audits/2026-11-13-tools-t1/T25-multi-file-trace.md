# T25 Multi-File Trace — auditor report
Tree: origin/main @ 1988481a5. Command id: `tools.multi-file-trace`.

## Map
- **Command:** Tools → Trace → Multi-File Trace… (`src/ui/commands/app-menu-groups.ts:150`, `command-families.ts:48-52`) → `CommandShell.tsx:94,219` opens `MultiFileTraceDialogHost`. Pro gate: `edition-command-gate.ts:19` maps it to `advanced-trace`; in Free the invoke becomes `requestProFeature('advanced-trace', invoke)` (the "Advanced tracing" Pro dialog; the browser Free build answers with its Pro-in-desktop edition) and the menu label is marked Pro (`labelProCommands`). Tooltip `raster-command-help.ts:56-60`.
- **Dialog:** `MultiFileTraceDialog.tsx`: Settings (Preset defaults / Last Trace Image settings, `multi-file-trace-settings.ts`), Preset, Format (SVG, DXF, PDF, EPS, GeoJSON), Precision, Size (`TraceSizeFields.tsx`: From file / DPI / Width mm), Page (`TracePageFields.tsx`: Image size / Fit to artwork / A4 / Letter / Custom + margins), Group islands (SVG). *Choose Images…* (`pickPlatformBatchTraceImageFiles`: png, jpg, jpeg, bmp, gif, tif, tiff, pbm, pgm, ppm, pnm) then *Trace…* reserves one output folder (`reserveSaveDirectory`; without a folder API each file gets its own save dialog).
- **Run:** `runChosenMultiFileTrace` → `runMultiFileTrace` / `buildMultiFileTraceExports` (`multi-file-trace-action.ts`) → per file on its turn: TIFF/Netpbm decoded in the import worker (`batch-raster-decode.ts`, ADR-357 Amd 2), other images sized from header (`readImageNaturalSize`) + density from a 1 MiB header prefix (`readImageHeaderDensity`), grid planned as a dialog commit (`planTraceCommitGridFor`, ADR-409) → `traceImagesToVectorFiles` (`src/core/trace/batch-trace.ts`) → `tracedLayers`/`placeTracedLayers` → SVG (`batch-trace-svg.ts`), DXF (`io/dxf/export-dxf.ts:95`), PDF/EPS/GeoJSON (`writeTracedDrawing`) → written at once into the folder (`traceFileWriterForDirectory`, never replaces: `-2`, `-3`). Progress/Cancel panel `MultiFileTraceProgress.tsx`; superseded-trace retry `multi-file-trace-retry.ts`; notice `multi-file-trace-report.ts`.
- **It never touches the workspace:** no scene object, operation or undo entry is made; output is files only. So bed layout, overlapping, "one Undo step" and the T24 snap-back / fresh-operation P1s do not apply to it.
- **ADRs:** 409 (+item 5, batch grid and import size), 431 (batch rules 1–5), 451 (page fit/paper), 454 (Line + fill width), 468 (PDF/EPS/GeoJSON), 357 Amd 2 (scans decode in the import worker), 477 (headless trace parity), 540 (Free/Pro), 656 (save pickers). WORKFLOW F-A9c (`WORKFLOW.md:1572`).
- **Changes since 2026-10-16** (git log to 1988481a5): `995078503` ADR-656 (prepare before the picker), `93334429e` #1484 (scans decode in the import worker, J6-P2-3), `f0a9a8475` (worker-only libraries out of the boot bundle), `ab3226fd1` (shared helpers, C2-P3-1).

## October register re-check
Row #32 ("sequential processing, cancellation, failures; new 1000-file backpressure test with injected decoder/tracer; real batch soak absent"): **still holds.** The tool's suites pass on this tree: 23 files, 146 tests (`multi-file-trace-action*` incl. the 1000-file stream/backpressure tests, `multi-file-trace-write-cancel`, `-settings`, `MultiFileTraceDialog*` (4), `MultiFileTraceProgress`, `batch-raster-decode`, `edition-command-gate`, `core/trace/batch-trace*` (3), `traced-page-box`, `traced-page-paper`, `trace-cli-parity`). My own runs (t25b) confirm sequential order, per-file skips with reasons, and Cancel (nothing written after it, count told). The real batch soak is still absent. Pro gate: mapping and test pass; not re-checked in a browser (memory gate). Rolling v5 J6-P2-3 (UI-thread TIFF decode): still fixed — `batch-raster-decode.ts:41-46` goes through `decodeBatchRasterOffThread`, in place only where no Worker exists.

## Checks run
| Check | Method | Result |
|---|---|---|
| Batch output = Trace Image of the same file, same settings (Line Art 300 DPI PNG, no-DPI PNG, 150 DPI JPEG, Smooth, Sharp) | `zz-t25/t25a.test.ts`: real `buildMultiFileTraceExports` (real PNG/JPEG header size + density readers, real tracer, real writers; only the pixel decode injected) vs real Trace dialog `commit` on a raster sized by `rasterImportGeometry` with the same density (T23 harness). Own SVG path reader + scanline region compare; pixel oracle (dark pixel at the file's own DPI) | Page size = import size exactly (33.867 × 25.4, 40 × 30, 67.734 × 50.8 mm); bboxes identical; batch vs single XOR 0.57–1.82 mm², **all within one pixel of an edge (far 0)** — the residue is the commit's laser move simplification; batch vs pixels far mismatch 0 in every case |
| Centerline | t25a case F, Hausdorff of stroke polylines | 0.025 mm (0.29 px) both ways; 28 = 28 subpaths |
| Last Trace Image settings (Line Art, smoothness 0.2, ignore 30 px) | t25a case G | Merged options JSON-identical to the dialog's; batch vs single XOR **0 mm²**; label "the last Trace Image settings (Line Art, 2 adjusted)" |
| DXF | t25a, own LWPOLYLINE reader with bulge arcs | `$INSUNITS 4`, Y flipped back gives the SVG bbox exactly; DXF vs SVG XOR 0–2.7 mm², far 0 |
| Reopen the written SVG | app's `parseSvg` | bounds (0,0)–(page mm), fill rule even-odd kept, no notes |
| Mixed batch of 10: PNG 300 DPI, JPEG 150 DPI, TIFF 100 px/cm, corrupt TIFF, empty PNG, blank PNG, a PDF, PGM, `logo-2.png`, second `scan.tif` (600 DPI) | `zz-t25/t25b.test.ts` case 1: real TIFF/PNM decoders, fake folder with an existing `logo-trace.svg` | Sizes all match the oracle (TIFF cm unit 40 × 30, TIFF 600 DPI 16.934 × 12.7, PGM default 40 × 30). Skips named with reasons (corrupt: "Incomplete TIFF image directory."; empty / PDF: decode failure), blank listed as "no visible paths"; default-DPI file counted; nothing replaced. Workspace untouched (same project object, undo 0 → 0). Name collisions misattribute files (P3-1) |
| Cancel after file 2 written / while file 3 traces | t25b case 2 | Both: 2 of 5 written, nothing after Cancel, toast "Multi-File Trace cancelled. 2 of 5 images were written." Files already written stay in the folder (no workspace change to undo) |
| Size overrides; density beyond the 1 MiB probe | t25b case 3 | Width 100 mm → 100 × 75. DPI 0.01 accepted → 1 016 000 × 762 000 mm page (P3-3). PNG with pHYs after 1.1 MB of text: batch 40 mm (default), Import Image 33.867 mm (P3-2) |
| Trace Image committed while a batch runs | `zz-t25/t25c.test.ts`: real batch (4 files, real tracer) + real dialog commit pressed during file 1 or file 2 | **Dialog commit silently does nothing** (P2-1); batch finishes all 4 |
| Very large files, memory | READ: one decode at a time, decode loaders on each file's turn, `onExport` streaming keeps one export, picker Files are lazy (`handle.getFile()`), `assertSafeDecodeDimensions`, commit-grid pixel budget; the 1000-file tests pass | Not run with real large images (memory gate ~3 GB) |

## Findings
### T25-P2-1: Pressing Trace in Trace Image while a Multi-File Trace runs silently does nothing
- Severity: P2 — a refusal that should not happen, with no message. The batch is designed to leave the editor usable (ADR-431 item 1), but its retry of a superseded trace immediately supersedes the Trace dialog's commit trace. The dialog stays open, no trace lands, no toast, no undo entry; pressing again loses the same race while the batch is mid-file. No work is lost and the batch is unharmed.
- Where: `src/ui/commands/multi-file-trace-retry.ts:24-37` (retries at once); `src/ui/trace/use-trace-worker-client.ts:281-291,316-318` (every new request rejects every pending one); `src/ui/trace/ImportImageDialog.tsx:438-441` (`reportTraceCommitError` returns silently on superseded). READ ONLY companion: `use-trace-preview.ts:161` drops a superseded preview the same way, so an open Trace preview is also knocked out by each batch trace.
- Repro: `C:\Users\stolk\kd-t1\zz-t25\t25c.test.ts` (log `t25c.log`). Batch of 4 PNGs; Trace pressed 5 ms after file 1 starts: "186ms user presses Trace … 533ms dialog commit settled … 759ms batch wrote b1-trace.svg". Dialog: toasts `[]`, dialog closed false, traced objects 0, undo 0. Same when pressed during file 2. Expected: the trace lands (or a clear message).
- Oracle: ADR-431 item 1 ("ordinary editor use cannot end the batch") and the Trace dialog's own contract that Trace places a trace or says why; the same commit with no batch running places one trace (T23).
- Suggested fix: let a batch request not supersede others (a request flag, or a separate worker for the batch), so a foreground trace wins and the batch retries after it; at minimum, a superseded commit toasts "A Multi-File Trace is running — press Trace again when it finishes".

### T25-P3-1: Colliding names attach one image's trace to another image's name
- Severity: P3 — misleading file names; needs two inputs with the same stem plus a `<stem>-2` input. Nothing is overwritten.
- Where: `src/core/trace/batch-trace.ts:315-319` (`uniqueStem` counts the source stem but never reserves the stem it generates).
- Repro: t25b case 1: `logo.png`, `logo.jpg`, …, `logo-2.png` → `logo.jpg` (67.7 mm) is written as `logo-2-trace.svg`, and `logo-2.png` (33.9 mm) as `logo-2-trace-2.svg`; likewise `scan.tif`, `scan.pgm`, `scan.tif` → `scan-trace`, `scan-2-trace`, `scan-3-trace`. The notice does not list which source went to which file.
- Suggested fix: put the extension in a colliding stem (`logo-jpg-trace.svg`) or reserve generated stems in `seen`.

### T25-P3-2: A PNG whose pHYs lies past the 1 MiB probe is sized at 254 DPI and the notice says it has no embedded DPI
- Severity: P3 — documented bounded read (ADR-409 item 5, ADR-477), rare files; but the batch size then differs from Import Image's and the notice is untrue.
- Where: `src/ui/common/image-density.ts:81-90` (`IMAGE_DENSITY_PROBE_BYTES`), `multi-file-trace-report.ts:129-131`.
- Repro: t25b case 3: 300 DPI PNG with 1.1 MB of tEXt before pHYs → batch page 40 mm wide "(default)"; Import Image's `readImageDensity` reads 300 DPI → 33.867 mm.
- Suggested fix: walk PNG chunk headers with `Blob.slice` (8 bytes each, skipping data) up to IDAT, or word the notice "no DPI in the file's first 1 MiB".

### T25-P3-3: The DPI override accepts any value above 0 (0.01 DPI writes a 1 km page) while Width is capped at 10 m
- Severity: P3 — validation inconsistency; output only.
- Where: `src/ui/commands/TraceSizeFields.tsx:69-80` (`min 0`, exclusive) vs `MAX_TRACE_WIDTH_MM` 10 000.
- Repro: t25b case 3: `{kind: 'dpi', dpi: 0.01}` on a 400 × 300 px file → SVG 1 016 000 × 762 000 mm.
- Suggested fix: a sensible DPI floor (for example 1) or reject a resulting side over `MAX_TRACED_PAPER_SIDE_MM`.

### T25-P3-4: Documentation drift (READ ONLY)
- ADR-431 item 4 still says TIFF/Netpbm "decode on the main thread, unlike the worker-based TIFF import" — stale since ADR-357 Amd 2 / #1484 (WORKFLOW F-A9c step 4 is current).
- ADR-409 item 5 says a sized export uses `preserveAspectRatio="none"`; `batch-trace-svg.ts:103` writes `xMidYMid meet`. No visible effect (viewBox and page are the same mm box), but the text is wrong.
- WORKFLOW F-A9c step 2: an invalid Margin makes "Choose Images… wait"; Choose Images is a `type="button"` kit Button, so it is the *Trace…* submit that is blocked.
- Suggested fix: update the three sentences.

### T25-P3-5: Test gap — no test compares a batch file with Trace Image of the same file, or runs Trace Image during a batch
- Severity: P3 — test gap; P2-1 sits behind the second.
- Where: `multi-file-trace-action*.test.ts` inject the tracer or compare with batch-only expectations; `multi-file-trace-action-cancel.test.ts` covers only the batch side of supersession.
- Suggested fix: adopt `zz-t25/t25a.test.ts` (batch vs dialog commit vs pixels, SVG + DXF) and `t25c.test.ts` (commit during a batch) once P2-1 is fixed.

## Not a defect / limits
- **No bed layout, no Undo, no reopen of a project:** the tool writes standalone files and never changes the workspace (verified: same project object, undo 0 → 0). Cancel keeps the files already written, and the toast counts them. T24-P1-1/P1-2 are not inherited.
- **Batch vs single residue (≤ 1.8 mm², all within one pixel of an edge):** the Trace Image commit runs laser move simplification on the placed trace; the export writes the tracer's curves. Both match the pixels with far mismatch 0.
- **Blank image writes no file** and is named in the notice (ADR-431 rule 3, WORKFLOW F-A9c step 3).
- **Unsupported files** (`.pdf`) reached through the picker's "All files" choice become a "Could not read" skip with the browser's decode message. An `.svg` chosen that way was not checked (no browser run).
- **Free users:** the command stays listed with a Pro mark and opens the Advanced tracing Pro dialog; mapping and `edition-command-gate.test.ts` pass. Not re-checked in a browser; no licensing service touched.
- **LightBurn:** has no batch trace; its single Trace Image places on the bed. Not compared further.
- Not checked: real large scans / memory soak (memory gate), BMP/GIF and EXIF-rotated JPEG through the real browser decoder, PDF/EPS/GeoJSON geometry (only page/format tests in the suite), Colour layers and Line + fill in a batch, the dialog and progress panel in a browser, keyboard use.

## Totals
Raised 6; P1 0; P2 1; P3 5; known 0 (October row #32 and rolling v5 J6-P2-3 re-checked, still fixed; T24's P1s do not apply because the batch places nothing on the bed).
