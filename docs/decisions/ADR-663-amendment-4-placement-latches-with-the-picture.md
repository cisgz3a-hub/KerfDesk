## ADR-663 Amendment 4 - Camera placement turns on with the picture on the canvas (2026-10-27)

**Status:** Accepted. | **Date:** 2026-10-27

Fixes rolling audit v4 H6-P1-1 (P1), `docs/audits/2026-10-27-rolling-v3/H6-camera-placement.md`.
Unit-tested with the real camera helpers, overlay, Start snapshot and Job Review warnings; not
tried on the Falcon's camera.

### Context

Amendment 1 starts a calibrated camera by itself, so "its picture then shows on the canvas
without opening the panel". ADR-228 Amendment 1's Job Review warning ("Camera placement is on, but
Start from is …") reads the camera placement latch. Only four things set the latch: an effect in
the Camera panel's overlay controls, **Refresh picture** (and Alt+C or the after-job refresh), and
**Trace from camera**. A camera that started by itself drew the bed on the canvas and left the
latch off.

The Falcon A1 Pro profile ships with homing off, so a new project starts from User Origin. In the
audit's repro, artwork placed on the auto-started picture at machine X200–220 Y98–118 burned at
X15–35 Y25–45, 199 mm away. Job Review gave only the generic unverified-mapping note, and the
canvas badge said "Relative view". Opening the Camera panel once would have latched placement and
shown the warning.

### Decision

1. **The picture on the canvas latches placement.** The workspace overlay latches camera placement
   whenever it draws a camera picture: a still or the live camera through its calibration, or a
   head camera's joined picture or the burn check's picture, which need none
   (`camera-placement-latch.ts`). It does not matter how the camera started or whether the Camera
   panel was ever opened. Job Review's camera warning then fires exactly as it does after opening
   the panel.
2. **The panel's own latch effect goes.** The overlay now owns the latch. The panel's buttons
   (**Show on canvas**, **Refresh picture**, **Live**) and **Trace from camera** still latch at
   once, as before.
3. **Unchanged.** The latch stays on when the picture is hidden, and **Exit camera placement**
   clears it and hides the picture, so it does not come back by itself. A hidden picture, or a
   camera without a calibration, latches nothing.

### Consequences

- An operator who places artwork on a picture that appeared by itself gets the same Job Review
  warning as one who opened the panel. With the Falcon A1 Pro profile's User Origin, that is the
  case the audit reproduced.
- The warning stays advice (ADR-228). Nothing new gates Frame, Start or output.
- G6-P3-1 (the after-job refresh shows and latches a hidden picture again) is unchanged. It now
  shares the overlay's "a picture is drawn" signal, which a later fix can use.
- WORKFLOW F-CAM2 (camera placement with a relative Start from) says when placement turns on.
