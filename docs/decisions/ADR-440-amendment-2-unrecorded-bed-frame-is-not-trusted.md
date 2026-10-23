## ADR-440 Amendment 2 - A calibration saved without its bed frame is not trusted until the frame is confirmed (2026-10-23)

**Status:** Accepted. | **Date:** 2026-10-23

### Context

Amendment 1 made a calibration keep the bed frame its target's rings were placed in. Its
Consequences accepted one gap: "A calibration made before this amendment has no frame. It is used
as before until the camera is calibrated or checked again." That covers every calibration saved by
KerfDesk 1.0.21 or earlier.

The meta audit of 2026-10-23, finding M2-P3-3, showed that the remedy it named does not work.

- **Used as before** means read in today's bed frame. After a bed change since the calibration,
  that is the 12-P2-2 fault again: a calibration made on a 400 × 400 bed draws what the camera saw
  at machine Y200 at scene Y200, which burns at machine Y210 once the bed is set to 400 × 410.
- **Check camera** labelled the saved target's rings in today's frame too (`knownBedFrame ??
  frameNow`), so it reported about 0 mm of drift.
- **Saving that refit** recorded today's frame on a fit whose rings were placed in the old one.
  That wrong frame is then permanent. The meta audit's refuter reproduced the end result: the burn
  lands at Y210 instead of Y200, even after the bed is set back to 400.

`camera-bed-frame.test.ts` asserted the gap ("for older records without a frame").

### Decision

1. **No frame, no use.** `cameraModelInBedFrame` treats a calibration with no `bedFrame` like one
   from another origin corner: it is not usable, with a reason. The overlay, Trace from camera,
   Find pieces, camera marks, head capture, the burn check and Fix a small offset therefore do not
   use it, and they say why. This follows decision 5's other unusable cases. It is not a new gate
   (ADR-228): nothing about Frame or Start changes. The reason the Camera panel shows is:
   "This camera was calibrated before KerfDesk recorded the bed it was calibrated on, so KerfDesk
   cannot tell whether its picture still lines up with the burn. If Machine Setup still has the
   origin … and the bed at … mm, as when the camera was calibrated, choose Confirm bed and origin in the Camera
   panel. If either has changed since, calibrate the camera again."
2. **Confirm bed and origin.** Beside that reason, on the overlay controls and in Camera settings, a
   **Confirm bed and origin** button records Machine Setup's current origin corner and bed size on the
   calibration (`withConfirmedBedFrame`). The native-to-bed offset stays unknown, so a later
   offset does not move the picture (Amendment 1, decision 2). The button records the operator's
   word that Machine Setup is unchanged since the calibration. It replaces the calibration where it
   is saved (`withReplacedCameraModel`), so the newest calibration stays the newest. It is one
   profile change and can be undone. It only accepts a saved calibration, so it is not camera
   alignment and does not ask for Pro (ADR-540: a saved calibration keeps working in Free).
3. **Check camera never invents the frame.** `openCheck` checks a calibration only when both its
   target layout and its bed frame were saved. A calibration without a frame opens the setup step
   instead, with the reason and the two ways on: confirm the bed and check again, or recalibrate.
   The saved calibration is unchanged. `assumedTarget` takes a saved target only together with its
   frame (`KnownTarget`), so no code path can label the saved rings in today's frame.
4. **A new calibration is unchanged.** Engraving a new target, or photographing a target engraved
   since Amendment 1, records the frame exactly as before.

### Consequences

- Every calibration from KerfDesk 1.0.21 or earlier stops drawing its picture until the operator
  chooses Confirm bed and origin or recalibrates. That is one click for a machine whose setup has not
  changed. For one whose bed or origin was changed since, the reason says to recalibrate, which is
  the only honest fix: KerfDesk cannot know the old frame.
- An operator who confirms a bed that was in fact changed gets the 12-P2-2 offset back. The reason
  names the origin and bed size being confirmed, so the choice is made with them in view.
- A remembered engraved target without a frame (ADR-441 Amendment 4) still takes today's origin
  with its remembered bed size. That is a fresh calibration of a target the operator chose, not a
  refit of a saved one, and is left as it is.
- Code and test evidence only. `camera-bed-frame.test.ts` now asserts that a calibration without a
  frame is not used, before or after a bed change, and that a confirmed one follows a later bed
  change exactly. `CameraCalibrationWizard.test.tsx` asserts that Check camera does not check or
  re-stamp one. No camera or machine was used.
