## ADR-663 Amendment 2 - A quick fix for a small camera offset (2026-10-23)

**Status:** Accepted. | **Date:** 2026-10-23

This amends ADR-663 with the helper the maintainer asked for as "Quick nudge fix": "If the picture is
off by a millimetre or two, burn a small mark, click where it really is, and done. No full
recalibration." KerfDesk finds the mark itself, so no click is needed. The calibration fit
(ADR-441), Frame, Start and output do not change, and no guard is added or removed (ADR-228).
Fixing the offset is camera alignment, a Pro tool (ADR-540).

### Context

LightBurn's answer to an overlay that is close but off is to type Width, Height, X Shift and Y Shift
by hand in the Camera Control window. Its troubleshooting names the usual cause: a camera or lid
that has moved a little since alignment. A calibrated KerfDesk camera model is a lens and a pose
(ADR-440). Moving the camera along the bed by d moves every point of its picture by d at every
height, so a pure translation of the pose is an exact fix for a picture that has slid.

### Decision

- **Fix a small offset…** in Camera settings → Calibration opens the wizard in a third mode, **Fix
  camera offset**, for a calibrated camera fixed above the bed. It is not offered for a head camera,
  whose picture is placed by the head (ADR-449).
- **Burn a ring.** The operator puts a clean piece of scrap in the middle of the bed and enters its
  thickness. **Burn the ring** streams one ring of the calibration target's size (10 mm, the same
  ring width) at the bed centre as a temporary job through the usual Frame, review and Start, at the
  wizard's engrave power and speed. **Ring already burned** skips the job.
- **Find it.** **Take photo** finds rings with the calibration's ring detector, maps each through the
  running camera's model at the sheet's top, and keeps those within 25 mm of the burn. One ring gives
  the offset, the burn minus where the picture shows it. None says what to check; more than one
  (an old target on the bed, say) asks for clean scrap rather than guessing.
- **Fix.** Under 0.2 mm, nothing changes ("already lines up"). Up to 10 mm, **Fix** moves the
  saved calibration's pose by the offset: `shiftedPose`, the same translation the bed-frame and head
  camera code use, so the rings it was calibrated on stay where they were engraved. It is saved
  through the machine profile as one Undo step, and the picture is refreshed. Above 10 mm the
  camera has moved more than a nudge should hide; the result offers **Recalibrate…** instead.
- The offset is measured in today's bed frame and applied to the saved record. That is exact,
  because re-expressing a calibration in another bed frame is a translation too (ADR-440
  Amendment 1).

### Consequences

- A lid that closes a little differently, or a camera knocked slightly sideways, is fixed with one
  ring and one photo instead of a full target.
- A camera that tilted or turned is lined up at the middle of the bed only. The fix says so, the
  10 mm limit sends large moves to a new calibration, and the accuracy map keeps showing the
  original calibration's errors.
- One ring about 14 px across was located to within 0.1 mm in a rendered test frame. The fix is not
  checked on the Falcon's camera or any other hardware.
