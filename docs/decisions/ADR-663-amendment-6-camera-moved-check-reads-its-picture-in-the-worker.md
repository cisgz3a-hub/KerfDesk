## ADR-663 Amendment 6 - The camera-moved check reads its picture in the picture worker (2026-11-11)

**Status:** Accepted (rolling audit v14 finding Z1-P2-1, confirmed by the area's independent
refuter and the audit coordinator on main `a1518de75`; the maintainer's standing instruction to fix
confirmed audit findings). Amends Amendments 3 and 5's capture. What the check compares, when it
speaks and its warnings are unchanged. ADR-440 Amendment 11 moves the held picture the same way. |
**Date:** 2026-11-11

### Context

The check runs 3 s after a camera starts or is switched to. Opening the Camera panel starts the
remembered camera (Amendment 1, and `autoStart` is on by default), and the operator may switch
cameras at any time (ADR-446). So an ordinary look at a running job ran the check mid-job.

- Its capture decoded the whole picture on the UI thread (`drawImage` and `getImageData`): 76–141 ms
  at 4K.
- With a view reference kept, the thumbnail of the full picture (`viewThumbnail`) then took another
  47–119 ms at 4K and 152–327 ms at 24 MP on the same thread.
- The comparison of the two thumbnails (the patch matching of Amendment 5) then took 185–290 ms in
  the window. This amendment's own guard found it, once the picture and thumbnail had moved.
- On the window streaming route (ADR-354) that was a lit stop of 71–138 ms. An Abort pressed
  meanwhile waited up to 107 ms. The job-time budget is 50 ms (ADR-598).

### Decision

1. **The check needs a picture's size and its thumbnail, not its pixels.** It takes a view of the
   picture: its own size and its thumbnail at the reference's width. The frame-size check of
   ADR-440 Amendment 9 compares the same thumbnail.
2. **A camera that has just started** is pictured as a bitmap, decoded off the UI thread (ADR-490
   Amendment 2). The bitmap is transferred to the camera picture worker, which makes the thumbnail.
   Only the thumbnail comes back.
3. **The thumbnails are compared in the worker.** The window picks the model and the reference, runs
   the frame-size check, and publishes the verdict. The patch matching runs in the worker. A verdict
   that arrives after the operator has switched to another camera is dropped.
4. **No picture is taken when the camera has no view reference.** The check then says it does not
   know, as before.
5. **A held picture's check** uses the thumbnail the worker made with it (ADR-440 Amendment 11),
   and is compared in the worker the same way.
6. Without the worker, or when it fails, the work is done in the window as before.

### Consequences

- Opening the Camera panel or switching cameras during a job no longer holds the UI thread for the
  check's picture, thumbnail or comparison.
- The frame-size check of ADR-440 Amendment 9 still runs in the window, but only for a picture of
  another size than the calibration's, on the small thumbnails.
- A camera with no reference is no longer pictured 3 s after it starts.
- Code and stub-camera evidence only. No real camera or machine was used.

### Verification

- `src/ui/camera/helpers/moved-check-worker.test.ts`, with a stand-in worker client and a window
  capture that throws:
  - a started camera is found steady, then moved, from the worker's thumbnails and comparison;
  - a verdict that arrives after the camera was switched is dropped;
  - no picture is taken without a reference;
  - the window takes the picture only without the worker.
- `e2e/camera-overlay-mjpeg-ui-thread.e2e.ts` starts a 4K stub bridge camera mid-job with a
  reference saved. It waits for the check to find the camera steady, with no UI task over 50 ms and
  no camera-sized pixel read in the window.
