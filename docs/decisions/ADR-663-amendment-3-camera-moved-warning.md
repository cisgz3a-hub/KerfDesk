## ADR-663 Amendment 3 - A warning when the camera seems to have moved (2026-10-23)

**Status:** Accepted. | **Date:** 2026-10-23

This amends ADR-663 with the last helper the maintainer asked for: "'Camera moved?' warning — tell
you when the calibration is probably off, with a one-click Check." It only advises: it never
blocks Frame, Start, output or any camera tool, and no guard is added or removed (ADR-228).

### Context

LightBurn's troubleshooting puts an overlay that drifts between sessions down to the camera or lid
having moved since alignment, and asks the operator to notice it. A calibrated KerfDesk camera
already says where the bed is in every picture (ADR-440), so it can tell the bed from what surrounds
it: the machine's frame, an enclosure's walls, the table. That surround stays put while material
comes and goes on the bed. If it has shifted in the picture, the camera has moved.

### Decision

- **A reference view.** When the camera's view is known to match its calibration, KerfDesk keeps a
  384-pixel-wide grey thumbnail of it on this computer, one per camera and calibration. That is
  when a calibration is saved (from the calibration photo itself), when **Check camera…** finds it
  has not moved and the operator keeps it, and right after a nudge fix (Amendment 2). A calibration
  saved before this change has none until one of those happens; Camera settings says so.
- **The check.** It runs on each new held picture (Refresh picture, Alt+C, after a job), with no
  extra capture, and once a few seconds after the camera starts. Only a calibrated camera fixed
  above the bed is checked. Each thumbnail pixel is mapped through the camera model, and only
  those that see the bed plane more than 10 mm outside the bed are compared. Their Sobel edge maps
  are matched by normalised cross-correlation over shifts of up to 16 pixels: half size first, then
  full size within 2 pixels of that, refined to a fraction of a pixel. Edges, not brightness, are
  compared, so a light switched on reads as no move.
- **When it speaks.** The surround must be at least 4 % of the view, and the best match must
  score at least 0.6. If so, the shift is turned into millimetres at the middle of the bed. At
  1 mm or more, the everyday Camera panel shows **The camera may have moved, by about N mm**, with
  **Fix a small offset…**, **Check camera…** and **Dismiss** (quiet for that calibration). One
  toast says the same when the panel is closed. Any weaker match, a camera that sees too little
  around the bed, or a head camera, says nothing.

### Consequences

- A knocked camera or a lid that closes differently is noticed at the next refresh, before a job
  burns in the wrong place, with the fix one click away.
- A camera that sees only the bed, or a plain surround, cannot be checked; the helper stays silent
  rather than guess. A thumbnail pixel spans about 2 mm of a 400 mm bed, so moves well under a
  millimetre go unremarked.
- The thresholds are KerfDesk's own and checked on synthetic views only, not on the Falcon's
  camera or any other hardware.
