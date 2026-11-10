## ADR-440 Amendment 10 - A bridge camera's overlay picture is decoded off the UI thread, once per picture (2026-11-10)

**Status:** Accepted (rolling audit v13 finding Y4-P1-2, raised by the area's independent refuter
and confirmed by the audit coordinator on main `8493f590c`; the maintainer's standing instruction
to fix confirmed audit findings). Amends how the live overlay draws a bridge camera (RTSP and
machine JPEG). USB cameras are unchanged. | **Date:** 2026-11-10

### Context

The overlay drew an RTSP camera from the bridge's MJPEG `<img>`. Such an image repaints in place and
tells the page nothing when a new picture arrives, so the overlay sampled it about 30 times a second
(`STREAM_FRAME_MS = 33`). Each time it uploaded the whole picture to WebGL with `texImage2D`, which
decodes and copies it on the UI thread, changed or not.

With a calibrated 4K RTSP camera and the overlay shown, as it is by default, the refuter measured
this during jobs:

- The UI thread was held 97–98 % of the time, in 60–95 ms tasks.
- Abort waited 65–83 ms.
- On the window streaming route (ADR-354), the stream sent 109–119 lines in 15–20 s, against 3,803
  with the overlay hidden.
- With `M3`, the beam stayed on over a stopped head for 4–11 s, with single stops of 5.3–5.5 s.

A polled 4K JPEG (a laser's own camera, a phone) cost a 59–82 ms task per poll in the same way.

This amendment's own guard reproduced it on main: 152 uploads for 105 pictures, and 152 tasks of
54–134 ms in about 10 s.

### Decision

1. **A frame feed for bridge cameras** (`overlay/machine-frame-feed.ts`).
   - The overlay reads the RTSP preview with `fetch` and splits ffmpeg's `mpjpeg` parts by their
     Content-Length (`overlay/mjpeg-parts.ts`). A part without a length is cut at the JPEG's end
     marker. Chunks are kept as they arrive and joined once per part.
   - A machine JPEG camera is polled with `fetch` at its interval.
   - Each new picture is decoded by `createImageBitmap` from its bytes, which browsers do off the
     UI thread, already shrunk to what the canvas shows: 1.5 × the canvas's device width, at most
     1920 px.
2. **One upload per new picture.**
   - The overlay draws a bitmap frame only when a new bitmap arrives. Nothing is re-uploaded on a
     timer.
   - The picture's own size, read from the JPEG's frame header, is what the camera model is
     applied to. The texture is sampled by normalised coordinates, so a smaller bitmap places the
     picture exactly as before.
3. **Backpressure and job-time pacing.**
   - One decode runs at a time. Pictures that arrive meanwhile are dropped, except the newest.
   - Pictures are taken at most every 100 ms, or every 500 ms while a job streams.
4. **The `<img>` stays where people look at it.** The Camera panel's preview is unchanged. Only the
   overlay's hidden `<img>` for bridge cameras is gone; a USB camera still draws from its `<video>`
   on presented frames.

### Consequences

- In the guard (a 4K MJPEG stub at 10 pictures a second on 127.0.0.1, a calibrated overlay), the
  overlay made 100 uploads for 100 pictures with no task over 50 ms. Main's code fails the same
  guard.
- A bridge camera's overlay now opens its own connection to the bridge, as the hidden `<img>` did.
- A 4K USB camera's `<video>` upload is not changed here. It was not measured slow (1080p USB gave
  no long task).
- Code and stub-camera evidence only. No real camera or machine was used.

### Verification

- `e2e/camera-overlay-mjpeg-ui-thread.e2e.ts`: a 4K MJPEG stub on 127.0.0.1, with a calibrated
  model at 3840 × 2160. It checks that no long task is over 50 ms, and that uploads number at most
  the pictures served (and more than 10).
- `src/ui/camera/overlay/mjpeg-parts.test.ts`: parts across any chunking, a part without a length,
  a part held until whole, and the JPEG size read.
- `src/ui/camera/overlay/machine-frame-feed.test.ts`: one decode at a time, newest kept, display
  width, the job interval, and no feed for USB.
- `src/ui/camera/WorkspaceCameraOverlay.test.tsx`: a bridge camera is drawn once per picture from
  the bitmap, at its own frame size, and not on a timer.
