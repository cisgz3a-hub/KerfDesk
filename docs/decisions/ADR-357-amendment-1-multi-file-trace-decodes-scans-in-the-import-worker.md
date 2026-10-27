## ADR-357 Amendment 1 - Multi-File Trace decodes TIFF and Netpbm scans in the import worker (2026-10-28)

**Status:** Accepted on 2026-10-28 |
**Amends:** ADR-357 decision 6 ("TIFF decoding is a lazy worker"), extending it to Multi-File
Trace (ADR-431), under PROJECT.md non-negotiable 9 (Abort reachable from any window state during
a job)

### Context

Rolling audit v5, report J6 (adversarial parsers), confirmed J6-P2-3: Multi-File Trace (Pro)
decoded TIFF and Netpbm scans on the renderer's UI thread (`batch-raster-decode.ts`), then
resampled each to its working grid there too. File > Import decodes the same TIFF in its own
worker; the batch did not.

- The real TIFF decoder takes about 0.6 to 1.0 us per pixel (2000 x 2000 grey: 2.5 s), so a
  24 MP scan froze the window for about 15 to 24 s per file and a 16384 x 16384 page for minutes.
  Netpbm took seconds only at extreme sizes.
- The batch can run during a job. Streaming continues in its own worker, but the Abort button and
  Ctrl+. are on the frozen thread.

### Decision

1. **The decode runs in the import worker.** A `batch-raster` request carries the file itself
   (a Blob, as every import worker request does) and its format. The worker reads it, decodes
   TIFF page 1 or the Netpbm image with the same decoders as before, and transfers the RGBA back.
2. **So does every resample.** Each working grid the batch asks for (the preview grid, the
   finer commit grid of ADR-409, or the fallback) is a `resample-rgba` request. The decoded pixels
   are copied to the worker rather than transferred, so the batch keeps its decode for a later
   grid; the resampled pixels are transferred back.
3. **Cancel stops it.** Both requests take the batch's AbortSignal. Cancelling rejects the request
   and, when the worker is already on it, terminates the worker, as for every import worker
   request; the next request starts a fresh worker.
4. **Where no Worker exists** (the node test environment), the same code runs in place.

### Consequences

- The UI thread no longer decodes or resamples a scan. It still copies a decode to the worker for
  each resample (about 96 MB for a 24 MP scan) and holds the decode while its file is traced, as
  it did before.
- Batch requests share the import worker's queue, so a scan waits behind another import's parse,
  and a long DXF import waits behind a scan.
- PNG and JPEG in the batch keep the browser's own decode (`createImageBitmap`), as before.
- Code and test evidence. The worker path was exercised through the import worker client with a
  stand-in worker; no timing was taken in the Electron renderer.
