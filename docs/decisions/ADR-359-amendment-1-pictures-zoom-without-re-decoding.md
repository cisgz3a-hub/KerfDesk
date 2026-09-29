## ADR-359 Amendment 1 - Pictures zoom without re-decoding: decoded display copies and halved levels (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

### Context

The maintainer reported that zooming in on a picture on the design canvas can be jittery and
laggy. It was reproduced in headless Chromium 141 (Playwright, 1440 x 1000 window) with generated
4000 x 3000 and 6000 x 4000 JPEGs and a 4000 x 3000 PNG, imported the ordinary way, then zoomed
with real wheel input from the fitted view to 8x, out, and in again. Traces of the first zoom-in
showed the canvas stalling inside single frames on the renderer main thread:

- **Lazy `<img>` decoding.** The design canvas blitted each picture's `HTMLImageElement`. Chromium
  decodes such an image lazily, at the size the draw needs, inside the canvas flush, and decodes
  it again at a larger size when a zoom needs more pixels. With the 6000 x 4000 JPEG the first
  zoom-in spent 946 ms in three `Decode Image` tasks on the software canvas, the longest 588 ms,
  and 718 ms in three `GpuImageDecodeCache::DecodeImage` tasks on the GPU canvas. Once the cache
  held the full decode the next zoom was smooth, until the cache let it go: with the 4000 x 3000
  JPEG on the GPU canvas the second zoom-in stalled again.
- **Main-thread rescaling of decoded copies.** An adjusted picture already draws a decoded canvas
  (item 6), yet on the GPU canvas its first zoom-in still spent 223 ms in two CPU rescales:
  Chromium uploads a source drawn below half its size at a smaller power-of-two level and scales
  it on the main thread first, again at every new level.
- **Dropped wheel notches.** Chromium merges wheel events that arrive within one frame into one
  event carrying the summed delta. The wheel handler zoomed one 1.1 step per event whatever its
  delta, so ten notches sent back to back arrived as six events and zoomed six steps. The slower
  the frames, the more notches merge, so the zoom lost the most input exactly when a picture made
  the frames slow.

### Decision

1. **A plain picture draws a decoded display copy.** A picture that is not a trace-source backing
   and burns without adjustments is drawn from a copy that `createImageBitmap` decodes once from
   the source bytes, off the main thread (`src/ui/workspace/raster-display-bitmap.ts`). The bytes
   come from the data URL with `Uint8Array.fromBase64` where the engine has it (`atob`
   otherwise); `fetch` is not used because production CSP blocks `data:` in `connect-src`. The
   copy is decoded with `imageOrientation: 'from-image'` so it turns like the `<img>`, and is
   capped at a 4096 px edge like the adjusted copies, with a bilinear resize. All copies together
   stay within 48 Mpx (192 MiB of RGBA). Until the copy lands, where it comes back at a size other
   than the `<img>`'s, where decoding fails, and past the budget, the canvas draws the `<img>` as
   before. Copies are pruned each frame with the objects that draw them plain, as the adjusted
   copies are.
2. **Every decoded picture source is drawn from a halved level near its size on screen.** The
   decoded copy, the adjusted grey copy and the tinted trace-source backing are each blitted from
   the smallest of their successively halved copies that is still at least the picture's size on
   screen (`src/ui/workspace/raster-display-levels.ts`), so each draw is between half and full size
   of the bitmap it reads and Chromium keeps using that bitmap as it is. A level is one half-size
   bilinear blit of the level above, a 2x2 box average, on a CPU canvas so building it never
   uploads the larger bitmap. Levels are built when first needed, kept until their source is
   dropped, and stop at 32 px. The destination rectangle, and so placement, clipping and
   registration with the selection box, is unchanged.
3. **A wheel event zooms by the notches it carries.** One 1.1 step per 100 px of `deltaY` in pixel
   mode, per 3 lines in line mode and per page in page mode, rounded, at least one step as before
   and at most ten (`wheelZoomSteps`, `src/ui/workspace/use-workspace-wheel.ts`).

Display only. Compile, hit-testing, Preview and output never read a display copy or a level.

### Consequences

- The measured stalls are gone. See Verification for the before and after figures.
- One-time costs move to load, where the canvas is not being zoomed. Turning the base64 of a
  10 MB JPEG into a Blob takes about 35 ms on the main thread with `fromBase64`, which the desktop
  app's Chromium has (about 100 ms with the `atob` fallback). A picture above 4096 px pays for its
  capping resize inside `createImageBitmap`, 155 to 180 ms of main-thread work for 6000 x 4000; a
  picture at or below 4096 px decodes entirely off the main thread. The first halving of a
  4096 px copy takes about 30 ms and the next about 6 ms. In the app, importing the
  6000 x 4000 JPEG gained one main-thread task of 78 to 180 ms, 0.5 to 0.8 s after the picture
  appeared (five runs), after an import that holds the main thread for about 5 s with or without
  this change; the 4000 x 3000 JPEG showed no added task over 50 ms (one run each). On a GPU
  canvas each level is uploaded once, 35 to 50 ms for a copy of about 4000 px.
- Memory: a plain picture holds its decoded copy plus a third again for its levels while it is on
  the canvas, instead of Chromium's evictable decode cache holding what the current zoom needs.
  The budget bounds it; later pictures fall back to the `<img>`.
- At deep zoom a picture larger than 4096 px shows its capped copy, softer than the source by
  its natural edge over 4096. Item 6 already accepted this cap for adjusted pictures.
- Up to that cap the canvas looks as before. Screenshots of the 4000 x 3000 JPEG at 70, 150 and
  470 % zoom were pixel-identical before and after; the same JPEG tagged with EXIF orientations 3
  and 6 turned the same way and differed by at most 5 of 255 per channel. The 6000 x 4000 JPEG
  differed by 1 to 4 of 255 on average, most at the deepest zoom, where its copy is capped.
- A fast spin on a device that reports large deltas zooms up to ten steps per event instead of
  one. Trackpads and high-resolution wheels, whose deltas are below a notch, are unchanged.

### Alternatives rejected

- **A full-resolution `ImageBitmap` without levels.** It removed the software stalls, but on the
  GPU canvas Chromium still rescaled it on the main thread at each new level (two tasks of 281
  and 198 ms in a standalone test).
- **`createImageBitmap(blob, { resizeWidth, resizeHeight })` for every level.** The decode runs
  off the main thread but the resize does not (about 160 ms for the capped copy of a 24 MP JPEG
  with `resizeQuality: 'low'`, 520 to 710 ms with `'medium'`), and each level would decode the
  file again.
- **Decoding at full size and capping with a canvas blit.** 104 to 123 ms of main-thread work
  instead of about 160 ms, but with a transient 96 MB full decode and a second code path, for a
  cost paid once per picture.
- **A worker with `OffscreenCanvas` capping the copy and building the levels.** It would take the
  remaining one-time main-thread work away (about 190 ms for a 24 MP picture, most of it the
  capping resize), but it adds a worker, a message protocol and pixels in flight between threads,
  for a cost paid once per picture rather than on every zoom.
- **Coalescing redraws to animation frames.** Chromium already delivers wheel events at most once
  per frame; the stalls were inside single frames.

### Verification

- `raster-display-levels.test.ts` sweeps a 4000 x 3000 source through a zoom and checks that every
  draw reads a level between half and full of its size, that each level is built once from the
  level above as a half-size bilinear blit on a CPU canvas, that an `<img>` is never copied, and
  that releasing a source frees its levels.
- `raster-display-bitmap.test.ts` checks one decode of the data URL's bytes with
  `imageOrientation: 'from-image'`, one redraw request when it lands, the 4096 px cap, the
  fallback to the `<img>` without retrying (another size, undecodable bytes, a utf-8 SVG, no
  `createImageBitmap`), pruning of a ready and a still-decoding copy, and the pixel budget.
- `draw-raster-decoded-display.test.ts` checks that `drawRasterImage` blits the `<img>` until the
  copy lands, then the copy, then a halved level when the picture is small, and that adjusted and
  trace-source pictures request no copy.
- `use-workspace-wheel.test.tsx` checks that a merged three-notch event zooms three steps, that a
  sub-notch delta still zooms one, and the pixel, line and page cases and bounds of
  `wheelZoomSteps`.
- Browser measurements used throwaway Playwright scripts that are not part of the repository:
  headless Chromium 141, a 1440 x 1000 window, the picture imported with the Import command and
  left 12 s to settle at the fitted view, then 25 wheel notches in, 25 out and 25 in again at the
  canvas centre. Long tasks come from a `longtask` PerformanceObserver, decodes and rescales from
  a trace of the same run; GPU runs used SwiftShader. The first zoom-in from the fitted view:

  | Picture                         | Canvas   | Before                                                     | After                                         |
  | ------------------------------- | -------- | ---------------------------------------------------------- | --------------------------------------------- |
  | 6000 x 4000 JPEG                | software | 3 long tasks, 1027 ms, longest 612 ms; 3 decodes, 946 ms   | no long task; no decode                       |
  | 6000 x 4000 JPEG                | GPU      | 5 long tasks, 900 ms, longest 313 ms; 3 decodes, 718 ms    | no long task; no decode                       |
  | 6000 x 4000 JPEG, brightness 20 | GPU      | 2 long tasks, 262 ms, longest 146 ms; 2 rescales, 223 ms   | no long task; no rescale                      |
  | 4000 x 3000 JPEG                | software | 2 long tasks, 143 ms, longest 73 ms                        | no long task                                  |
  | 4000 x 3000 JPEG                | GPU      | 2 long tasks, 292 ms; 2 more, 180 ms, on the next zoom-in  | 1 long task, 66 ms; none on the next zoom-in  |
  | 4000 x 3000 PNG                 | software | 1 long task, 62 ms                                         | 1 long task, 56 ms                            |
  | 6000 x 4000 JPEG, Preview       | software | no long task                                               | no long task                                  |

  After the change no run's trace showed an image decode or rescale on the main thread, only two
  texture uploads per GPU run, 39 to 56 ms in all. Across the later zoom-out and zoom-in the after
  runs had two more long tasks, 111 ms (GPU, 6000 x 4000) and 83 ms (Preview, a layer paint),
  neither holding a decode or rescale; before, only the 4000 x 3000 GPU run had any. On the
  software canvas the slowest wheel notch of the 6000 x 4000 first zoom-in took 626 ms to be
  handled before and 63 ms after. Ten notches sent back to back zoomed six steps before and ten
  after. The machine was shared with other work, so durations vary between runs; the decode and
  rescale counts do not.
- Not verified here: real GPU hardware and the packaged Electron app. GPU runs used SwiftShader,
  whose software GL makes every frame slow in the GPU process whatever the picture; the figures
  that matter from those runs are the main-thread tasks.
