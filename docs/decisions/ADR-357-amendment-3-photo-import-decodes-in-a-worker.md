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

1. **The embedded photo route runs in a short-lived worker.** After the header gives the oriented
   size and the burn decode cap, a worker (`image-luma-worker.ts`) calls `createImageBitmap` with
   `imageOrientation: 'from-image'`, resized only when the UI-thread loader would resize. It draws
   the bitmap 1:1 onto an `OffscreenCanvas`, composites over white and takes the BT.601 luma in
   one pass, encodes the base64 and returns only the size and that string. The worker is
   terminated when it answers.
2. **The bytes may not change.** The worker reproduces the loader's grid exactly or declines.
   When the decoded grid differs from the target (an engine that ignored the EXIF Orientation,
   or an unparsed header above the cap that the loader would scale on its canvas), when no worker
   or `OffscreenCanvas` exists, when the source carries a trace mask, or when the worker fails,
   the UI-thread loader takes the file as before. That loader also reports any real decode
   error. The composite and luma arithmetic live in one DOM-free module (`rgba-luma.ts`) that both
   routes use, so the luma bytes, and with them the compiled G-code, are unchanged.
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

MEASUREMENTS_PLACEHOLDER
