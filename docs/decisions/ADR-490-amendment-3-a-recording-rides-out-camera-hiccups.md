## ADR-490 Amendment 3 - A recording rides out camera hiccups, and an RTSP camera stays on with no viewer (2026-11-14)

**Status:** Accepted (camera audit v2 findings K4-P2-1, K4-P2-2, K4r-P3-1, K4-P3-1 and K4-P3-2,
confirmed by the area's independent refuter and the audit coordinator on main `ba08a81af`; Y4-P3-1
is the same root as K4-P2-1 and closes with it; the maintainer's standing instruction to fix
confirmed audit findings). Amends Decision 3 (the timelapse) and Decision 1 (the camera stays on),
and ADR-692 Amendment 1's back-off. K4-P2-3 (a new run clears the last recording) is left as
decided until the maintainer answers. | **Date:** 2026-11-14

### Context

- **Hiccups ended the recording (K4-P2-1).** Five failed captures in a row ended the timelapse for
  the rest of the job, and nothing restarted it. Since the bridge's back-off (ADR-692 Amendment 1),
  a failed picture is followed by instant "held back" answers. The recorder retried every 250 ms,
  so two hiccups about a second apart were five failures.
  - A 1 s refusal, a 3 s login page or a 21 s stall ended a 3-hour timelapse for good, while the
    camera came back seconds later.
  - With the overlay polling the same camera, about 1.1 s of refusal or one 10 s stall was enough.
  - The only sign was a note in the Camera panel.
- **A shared failure counted twice (K4r-P3-1).** Requests that joined one fetch of the camera each
  reported its failure, so the back-off doubled once for each.
- **An RTSP camera turned off with its last viewer (K4-P2-2).** The bridge failed a preview session
  when its last connection closed, and when one viewer's ffmpeg exited. The window then turned the
  camera off.
  - Job watch's own burn-check picture, an Alt+C still or the panel closing closes the last
    viewer, so the recording ended mid-job, and the next job had no timelapse and no burn check.
  - Decision 1 and the panel ("The camera stays on while these are ticked") promise the opposite.
- **A size change (K4-P3-1).** In a flat recording, a picture that no longer fitted the calibration
  was fetched again every 250 ms, silently, with "Recording…" still shown.
- **A cut picture (K4-P3-2).** A JPEG cut short with no length, or a matching length, passed the
  bridge and could be kept as a frame.

### Decision

1. **A missed frame is skipped, not counted toward an end.**
   - The next try waits for the next interval, so the bridge's held-back answers are not fetched
     every 250 ms.
   - After three misses in a row, the panel note says frames are being skipped and that the
     recording carries on when pictures come back, and one toast says so.
   - The first frame that comes back clears the note.
   - A picture whose size no longer fits a flat recording is skipped the same way, with its own
     note.
   - A failed worker reply is a missed frame too.
2. **A recording that ends** (the camera turned off or switched) says so in a toast as well as in the
   panel.
3. **The bridge counts a shared failure once.** A failure reported while the camera is already held
   back for it does not lengthen the wait.
4. **A preview session with no viewers is idle, not failed.** It can be claimed again, and costs
   nothing, since each viewer has its own ffmpeg. One viewer's ffmpeg failing fails the shared
   session only when no other viewer is still running.
5. **The bridge refuses a JPEG without its end marker** (FF D9 within its last bytes): "The camera
   sent a picture cut short."

### Consequences

- A timelapse survives Wi-Fi drops, lock screens, reboots and stalls, and resumes by itself. Frames
  during the outage are missing, which the note and toast say.
- Job watch's own pictures, Alt+C and closing the panel no longer turn an RTSP camera off.
- A camera that really fails still shows as failed once its last viewer fails. The window does not
  yet reconnect it by itself; the Reconnect button does (a follow-up).
- K4-P2-3 is unchanged: a new watched run still starts a new timelapse, as Decision 3 says.
- Code and stub-camera evidence only. No real camera, ffmpeg or network was used.

### Verification

- `src/ui/camera/job-watch/timelapse-missed-frames.test.ts`, on a virtual clock:
  - a 10 s outage does not end the recording; it resumes, the note comes and goes, and one toast
    is shown;
  - after a miss the next try waits a full interval;
  - a size change after the first flat frame is skipped at the interval, with its note.
- `electron/rtsp-camera-session.test.ts`:
  - a session whose last viewer closed stays live and can be claimed again;
  - one of two viewers' ffmpeg failing leaves the session live, and the last one fails it.
- `electron/camera-frame-login.test.ts`: two requests sharing one failure wait 1 s, not 2 s, and the
  wait still caps at 16 s.
- `electron/camera-frame-proxy.test.ts`: through the real bridge, a JPEG cut short is refused with a
  502.
