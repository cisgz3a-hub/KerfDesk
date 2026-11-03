## ADR-357 Amendment 3 - A photo's single-file import decodes, samples and takes its luma in a worker (2026-11-03)

**Status:** Accepted on 2026-11-03 |
**Amends:** ADR-357 decision 6 and its Amendment 2 (decoding in the import worker), extending them
to the single-file Import of a JPEG, PNG, WebP, BMP or still GIF, under PROJECT.md
non-negotiable 9 (Abort reachable from any window state during a job) and the performance budget
of 200 ms for the longest UI block while designing

### Context

Performance audit S1, area S3 (`docs/audits/2026-11-02-performance-s1/S3-save-open-import.md`),
confirmed S3-P2-1. Import decoded a photo, drew it onto a canvas, read it back, composited it over
white and built its luma base64 on the UI thread. The base64 was built by one string append per
pixel, then `btoa`. With no progress or Cancel:

- a 4000 x 3000 phone JPEG blocked the window 1.06-1.10 s (refuter: 785-861 ms);
- the 4096 x 4096 benchmark PNG blocked it 1.30 s;
- a 9 MP TIFF page blocked it 0.85-0.91 s, because the page is re-encoded as PNG and imported
  through the same route.

About half of each block was garbage collection of the 12 million one-character strings. The
refuter showed that chunked encoding gives byte-identical base64 4.4 times faster.

### Decision

1. **The readback and luma run in a short-lived worker.** The UI thread still decodes and draws
   the photo with the loader's own code (`decodeImageOntoCanvas`): the same `<canvas>`, size,
   EXIF turn and browser resize as before. It then takes `createImageBitmap(canvas)`, a snapshot,
   releases the canvas and transfers the snapshot to a worker (`image-luma-worker.ts`). The
   worker draws it 1:1 onto an `OffscreenCanvas`, reads it back, composites over white and takes
   the BT.601 luma in one pass, encodes the base64 and returns only the size and that string. The
   worker is terminated when it answers. With no `Worker`, `OffscreenCanvas` or
   `createImageBitmap`, with a trace-masked source, or when the worker fails, the UI-thread
   loader runs as before; a real decode error is reported as before.
2. **The bytes may not change, so the canvas may not change either.** A first version decoded in
   the worker with `createImageBitmap(file)`. Its PNG luma was identical, but a JPEG drawn at its
   own size differed by 1 in about a third of the bytes. In Chromium (Chrome 156 here, on Intel
   Iris Xe, headless and headed) the loader's accelerated `<canvas>` converts a JPEG's YUV to RGB
   on the GPU, while every CPU route (`createImageBitmap`, `willReadFrequently`, a worker)
   converts it in the decoder. Reading back a snapshot of the loader's own canvas gave 0
   differing bytes at 1600 x 1200 and 4000 x 3000. That is why the drawing stays on the UI
   thread. (It also means the stored luma of a JPEG imported before this change could already
   differ by 1 between a computer whose canvas is accelerated and one whose canvas is not.) The
   composite and luma arithmetic live in one DOM-free module (`rgba-luma.ts`) used by both
   routes.
3. **Encoding never builds a pixel-sized binary string.** `extractLumaBase64` and every other
   caller (camera trace, Image Studio, crop) encode with `bytesToBase64`: native
   `Uint8Array.prototype.toBase64` where the engine has it, otherwise 48 KiB chunks, which give
   the same text because each chunk is a multiple of 3 bytes.
4. **Progress and Cancel.** Every image import now has the import's Esc-to-cancel control. When
   the worker decode runs past 300 ms it shows the existing progress notice ("decoding and
   sampling in worker. Press Esc to cancel."). Cancelling terminates the worker.
5. **It does not reserve the worker memory lane** (ADR-288 Amendment 1), as the PNG import worker
   does not: its allocations are the same ones the UI thread made before, and an import must not
   wait minutes behind a background job preparation or preempt it.

The page-backed and dimension-qualified PNG routes (ADR-283) are unchanged. A TIFF page is still
re-encoded as PNG on the UI thread; only its second decode moved.

### Verification and limits

Unit tests check the worker's bytes against a verbatim copy of the pre-change luma builder on
RGBA with every alpha value, the chunk boundary of the encoder on both routes, every fallback
decision, cancellation, the slow-decode notice, and a count-based guard that a worker decode runs
neither `loadImageAsRawData` nor `extractLumaBase64` on the UI thread.

The browser measurement on a production build (import block for a 12 MP JPEG, the 4096 x 4096
PNG and a TIFF page, and the luma hashes of each fixture against main) is recorded below when run.
