## ADR-357 Amendment 4 - A PNG at its own size decodes as a bitmap, off the UI thread (2026-11-10)

**Status:** Accepted on 2026-11-10 |
**Amends:** ADR-357 Amendment 3 decision 2 ("the bytes may not change, so the canvas may not
change either"), narrowing which source the loader draws on that canvas, under the performance
budget of 200 ms for the longest UI block while designing

### Context

PR #1401 made a dense trace's laser conditioning cooperative. Measured after it, a Trace commit
that decodes the source at a finer grid than the preview (ADR-409) still blocked the window while
`decodeImageOntoCanvas` ran. The loader decodes a resized image with `createImageBitmap`, off the
UI thread, but an image already at its decode size took the `<img>` route. Chromium decodes an
`<img>` lazily, so the PNG's decode ran inside `createImageBitmap(canvas)`, the snapshot that
Amendment 3 hands to a worker. For the 1254 px `centerline-stress-test-20260909.png` upscaled to
3010 x 3010 px, that one task took 175-882 ms in headless Chrome on the maintainer's 16-core
desktop, depending on load from other work on the machine.

Amendment 3 kept every decode on the loader's own canvas because a JPEG drawn at its own size
differs by 1 in about a third of its bytes between the accelerated canvas (GPU YUV to RGB) and a
`createImageBitmap(file)` decode. Its first version had already found PNG luma identical either
way.

### Decision

1. **A PNG at its own size is decoded by `createImageBitmap(file, { imageOrientation:
   'from-image' })`**, as a resized image already is, and that bitmap is drawn on the loader's
   canvas, snapshotted and read back in the worker exactly as before. Only the decode moves off
   the UI thread. The canvas, the snapshot and the readback are unchanged.
2. **A JPEG keeps the `<img>` route.** The GPU YUV difference above still applies. Any other
   format the header reader does not recognise also keeps it.
3. **So does a PNG with an embedded colour profile** (an `iCCP` or `cICP` chunk before the
   image data, or a header that cannot be read through to it). On Windows Chrome with a GPU
   canvas a Display P3 PNG matched on both routes, but on CI's Linux Chrome 29,408 of its
   244,412 bytes differed: the profile is converted differently for an `<img>` drawn on a
   canvas than for a bitmap decode. `gAMA`, `cHRM` and `sRGB` matched on both.
4. **An engine that ignores the image's Orientation still falls back.** If the bitmap comes
   back with the stored (unturned) aspect, it is closed and the `<img>` route turns the image,
   as the resized route already does.

### Verification and limits

- **Same pixels.** In Chrome 157 (headless, Playwright), `e2e/png-own-size-decode-parity.e2e.ts`
  compares the loader's route against the previous `<img>` route for 18 PNG kinds: 8- and 16-bit
  grey, RGB and RGBA, palette with tRNS, grey-alpha, gAMA 1.8 and 2.2, sRGB, cHRM, a Display P3
  ICC profile, Adam7 at 8 and 16 bits, eXIf Orientation 6 and 3, and a two-frame APNG. Every
  byte matches on Windows and on CI's Linux runner, and the test checks which route each file
  took: every kind as a bitmap except the Display P3 file, which keeps the `<img>`. At the commit
  grid above, the committed trace's `paths` had the same SHA-256 as on `origin/main`.
- **The block.** In runs alternating between the two builds, the decode task at that commit
  took 97-876 ms on `origin/main` (six runs) and 8-11 ms with this change (three runs), or
  149 ms in one run while other work held the PC's CPUs at about 70%. What stays on the UI thread
  is drawing the bitmap and the snapshot's readback from the canvas.
- Not verified: Firefox and Safari, which take the bitmap route wherever their
  `createImageBitmap` accepts the options (one that rejects them keeps the `<img>` route); the
  packaged desktop app; a PC without GPU canvas acceleration.
