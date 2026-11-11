## ADR-440 Amendment 11 - Camera pictures for the overlay are shrunk and read in the picture worker (2026-11-11)

**Status:** Accepted (rolling audit v14 findings Z1-P1-1 and Z1-P2-2, confirmed by the area's
independent refuter and the audit coordinator on main `a1518de75`; the maintainer's standing
instruction to fix confirmed audit findings). Corrects Amendment 10's Decision 1, which said a
bridge picture is decoded off the UI thread "already shrunk to what the canvas shows". It also moves
the held picture (Alt+C, Refresh picture, the refresh after a job) to the camera picture worker of
ADR-490 Amendment 2. ADR-663 Amendment 6 does the same for the camera-moved check. | **Date:**
2026-11-11

### Context

- **The shrink ran on the UI thread (Z1-P1-1).** Amendment 10 decoded each bridge picture with
  `createImageBitmap(blob, { resizeWidth })` in the window.
  - Chromium decodes on a pool thread, but it shrinks on the thread that receives the bitmap. The
    refuter's trace showed the scale as one task on the renderer's main thread: 157–243 ms for a 4K
    picture shrunk to 1,920 px. In Electron 44 (Chromium 152) it was 98–166 ms.
  - The overlay asks for 1.5 × the canvas's device width, capped at 1,920 px. A maximised full-HD
    window gets the cap: 1,917 px, so even a 1,920 px camera was shrunk by 3 px at full cost.
  - During a job on a 1920 × 1080 window, a 4K RTSP camera held the UI thread 24–31 % of the time.
    An Abort landing in a block waited 106–118 ms for the key. On the window streaming route
    (ADR-354), the head stopped lit for up to 208–407 ms, against 52–64 ms with the overlay hidden.
  - A 1080p camera was hit too: 38–40 blocks of 69–72 ms (p50) in 20 s.
  - Amendment 10's guard ran idle at Playwright's 1280 × 720 window, where the shrink is to 1,340 px
    and sits near the budget, so it passed.
- **Alt+C during a job (Z1-P2-2).** The held picture was decoded to pixels in the window
  (`drawImage` and `getImageData`), then its full 4K RGBA was copied and uploaded to WebGL on every
  draw. At 4K that was a 251 ms block, then a 131 ms one, with a 148 ms lit stop on the window route.
- **The budget.** The performance audit's job-time budget is 50 ms for the longest UI block.
  Abort is sent from the UI thread (ADR-598).

### Decision

1. **The overlay's shrink runs in the camera picture worker.**
   - The worker receives the picture's bytes, decodes and shrinks them with
     `createImageBitmap(blob, { resizeWidth, resizeQuality: 'medium' })`, and hands the bitmap back
     without a copy. In a worker the shrink is done on the worker's thread.
   - The window never asks for a shrink. Without the worker (no `Worker`, `OffscreenCanvas` or
     `createImageBitmap`), or when the worker fails, the picture is decoded at full size, which
     browsers do off the UI thread, and the GPU scales it.
2. **No shrink that saves under a tenth of the width** (`picture-worker/picture-size.ts`). A
   1,920 px camera on a canvas asking for 1,917 px is drawn as it is.
3. **The held picture is read in the worker.**
   - Alt+C, Refresh picture and the refresh after a job take the camera's picture as a bitmap,
     which is decoded off the UI thread as in ADR-490 Amendment 2, and transfer it to the worker.
   - The worker returns three things without a copy:
     - the picture's pixels, which the still's other users (the quick nudge fix, the moved check's
       fallback) keep needing;
     - a copy at most 1,920 px wide for the overlay to draw;
     - the moved check's thumbnail, when the camera has a view reference.
   - The copy and the thumbnail travel beside the pixels (`camera/still-capture.ts`), so the camera
     store and every caller keep the picture they had. The overlay draws the copy; the picture's
     own size still places it.
   - Without the worker, or when it fails, the picture is taken in the window as before.
4. **Calibration, Trace from camera, Find pieces, print-and-cut and Camera diagnostics are
   unchanged.** They are design-time tools and keep their in-window capture.

### Consequences

- A camera's overlay, a camera started mid-job and Alt+C no longer hold the UI thread for a
  shrink, a full-picture read or a 4K upload. Abort, Pause and the window route's refill do not
  wait for them.
- In the guard, a job streamed to the paced GRBL stand-in in a 1920 × 1080 window. A 4K stub
  camera was started mid-job with the overlay shown; its moved check found it steady, and Alt+C held
  a 3,840 px still. Measured on a loaded Windows PC:

  | Build | Tasks over 50 ms | Shrinks in the window | Camera-sized pixel reads in the window |
  |---|---|---|---|
  | This amendment, without ADR-663 Amendment 6's comparison move | 79, 127, 279, 407 and 782 ms; attribution put two in the moved check's comparison | 0 | 0 |
  | This amendment with ADR-663 Amendment 6 (three runs) | **none** | **0** | **0** |

  The overlay uploaded 21–22 times for 91–101 parts served at the job's pace.
- Drawing a held 4K picture uploads a 1,920 px copy on each draw (a pan or zoom), not the whole
  4K RGBA.
- No Job Review line is added for the camera: the overlay no longer stops a window-route stream.
- Code and stub-camera evidence only. No real camera or machine was used.

### Verification

- `e2e/camera-overlay-mjpeg-ui-thread.e2e.ts` runs a real job on the paced GRBL stand-in (the
  window route) in a 1920 × 1080 window. It then starts a 4K stub bridge camera on 127.0.0.1 with
  the overlay shown and a view reference saved, lets the moved check run, and presses Alt+C. It
  checks that:
  - the overlay drew the stream and the still;
  - the window never shrank a picture or read a camera-sized picture's pixels;
  - no UI task ran over 50 ms;
  - the job was still streaming throughout.
- `src/ui/camera/overlay/machine-frame-feed-worker.test.ts`: a 4K picture is shrunk in the worker
  and never in the window, a 1,920 px picture is not shrunk for a 1,917 px canvas, and a picture is
  decoded at full size without the worker or when it fails.
- `src/ui/camera/helpers/moved-check-worker.test.ts`: a held picture comes with its overlay copy
  and thumbnail, the check uses that thumbnail, and the window takes the picture only when the
  worker fails.
