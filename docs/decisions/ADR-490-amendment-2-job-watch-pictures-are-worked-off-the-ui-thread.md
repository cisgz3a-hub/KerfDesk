## ADR-490 Amendment 2 - Job watch and remote stills read, flatten and encode pictures off the UI thread (2026-11-10)

**Status:** Accepted (rolling audit v13 findings Y4-P1-1 and Y4-P2-1, confirmed by the area's
independent refuter and the audit coordinator on main `8493f590c`; the maintainer's standing
instruction to fix confirmed audit findings). Amends ADR-490's capture path and ADR-585's
`get_camera_snapshot`. ADR-598 Amendment 5 records the worker against the job-time budget. |
**Date:** 2026-11-10

### Context

While a job ran, the timelapse and the burn check's before picture did all their picture work on
the UI thread. Each read the frame's pixels (`drawImage` and `getImageData`), flattened it onto the
bed (a per-pixel warp) and encoded a JPEG (`putImageData`, a scaled `drawImage`, `toBlob`).

- **Blocks per picture.** With a 4K camera, a 12 or 24 MP phone picture, or a calibrated whole-bed
  job, each picture held the thread 70–300 ms. The before picture at Start took up to 278 ms.
- **Abort waited.** Abort is sent from the UI thread (ADR-598). An Abort pressed inside a block
  waited 55–205 ms on the worker route, which is 6–20 mm more lit travel at 6,000 mm/min.
- **The window route stopped.** On the window streaming route (ADR-354), each block also drained
  the controller: with `M3` the head stopped lit for up to 373 ms a frame.
- **The budget.** The performance audit's job-time budget is 50 ms for the longest UI block.
- **Remote stills (Y4-P2-1).** A phone or MCP still was decoded and encoded the same way, 62–195 ms
  a 4K still, and a polling client could take one every 0.5 s.

### Decision

1. **A camera picture worker** (`ui/camera/picture-worker/`). It reads a frame's pixels with an
   `OffscreenCanvas`, flattens them with the same pure-core warp (`warpFrameToBedImage`), and
   encodes the JPEG with `convertToBlob`. One module worker serves every request in turn.
2. **The UI thread only fetches and posts.**
   - A bridge camera's frame is fetched as before. `createImageBitmap(blob)` turns it into a
     bitmap; browsers decode that off the UI thread.
   - A USB camera's frame becomes a bitmap from its video.
   - The bitmap is transferred to the worker, so no copy is made.
   - The camera model is still fitted to the frame's size on the UI thread (`flattenSpecFor`, with
     ADR-440 Amendment 9's size check), because that is a few arithmetic steps.
3. **What goes through it.**
   - Each timelapse frame while the job runs, flattened or plain, by the existing rules: a first
     frame that cannot be flattened turns the recording plain.
   - The burn check's before picture at Start. Its pixels come back, transferred, for the
     comparison at the end.
   - Remote stills, at quality 0.8 down to 0.35 until one fits a response.
   - The final frame and the comparison after the job keep their in-window path, as ADR-490
     already announces: "The check runs in the app window when the job ends".
4. **Remote stills are paced on the PC.** At most one is in flight, and they come at most once a
   second. Requests that overlap share one still.
5. **Where workers are missing** (no `Worker`, `OffscreenCanvas` or `createImageBitmap`), the
   in-window path stays as it was.

### Consequences

- In the browser guard, the worker path made 20 pictures in 4 s, a flattened frame and a still in
  turn. It had no long task, and key handlers started within 0.6 ms. The old in-window path made
  4 pictures with blocks of 136–298 ms. The guard uses a 4K stub camera on 127.0.0.1, the
  timelapse's whole-bed flatten and a still, with key presses every 130 ms.
- Abort, Pause and the window route's refill no longer wait behind job watch or a remote still.
- A client polling stills gets at most one a second.
- Code and stub-camera evidence only. No real camera or machine was used.

### Verification

- `e2e/camera-pictures-off-ui-thread.e2e.ts` runs the in-window control and then the worker path.
  It asserts that the control blocks the thread past 50 ms, and that the worker path has no long
  task and every key handler starts within 50 ms.
- `src/ui/camera/job-watch/picture-worker-watch.test.ts` checks, with a stand-in client, that the
  timelapse flattens and encodes in the worker, that an uncalibrated camera gets plain frames,
  that a first frame that cannot be flattened turns the recording plain, and the before picture
  and its unseen-region message. The window's own capture and encode are never called.
- `src/ui/remote-control/machine-camera-worker.test.ts` checks the still encoded in the worker at
  1024 px, overlapping requests sharing one still, and the one-second pacing.
