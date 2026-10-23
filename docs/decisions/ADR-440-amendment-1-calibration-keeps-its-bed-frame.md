## ADR-440 Amendment 1 - A calibration keeps the bed frame its target was engraved in (2026-10-22)

**Status:** Accepted. | **Date:** 2026-10-22

### Context

The camera model maps camera pixels to scene millimetres. The engraved target's rings got their
scene positions from the layout. Those positions became places on the bed through the origin
corner and bed size (`toMachineCoords`) and, when the controller proved it, the native bed frame's
offset (`runtimeCoordinatePreparationOptions`). The saved record (decision 4) kept none of these
facts, and decision 5 lists what makes a model unusable (another camera, shape or crop) and stops
there.

Rolling audit v2, finding 12-P2-2, reproduced the result. A front-left 400 × 400 bed was
calibrated, then Machine Setup was corrected to 400 × 410. The same model was kept and drew what
the camera saw at machine Y200 at scene Y200, which now burns at machine Y210, 10 mm off. The
overlay, Trace from camera, Find pieces and camera Print and Cut marks all moved with it. Check
camera reported 0 mm drift, because it labels the rings from the same saved layout. Print and Cut
already keys its head captures on these facts (`nativeBedCaptureFrameKey`).

### Decision

1. **The record keeps its frame.** `CameraModelRecord.bedFrame` holds the origin corner, the bed
   width and height, and the native-to-bed offset when it was known (`core/camera/model/camera-bed-frame.ts`).
   These are the facts `nativeBedCaptureFrameKey` uses. The frame is the one the target's rings were
   placed in. For **Engrave target** it is the frame at engraving, which the engraved-target memory
   now keeps (ADR-441 Amendment 4). For **Check camera** it is the saved calibration's own frame.
   For a layout taken from the settings it is today's frame. A head camera's head position is
   converted into that frame before the fit. Records and remembered targets without a frame keep
   loading. A malformed frame drops the record, as other malformed fields do.
2. **Re-expressed when that is exact.** With the same origin corner, a later change of bed size or
   native offset moves every scene point by one constant. The pose takes that up exactly:
   `tvec' = tvec − R·d`, with the measured rings and a head camera's calibration head position
   moved by `d`. The model in use (`activeCameraModel`) is read through this, so every camera
   feature follows it. A native offset counts only when both frames know it. An unknown offset
   (not homed, no `$$` read) is not evidence that it changed.
3. **Not usable after an origin change.** Another origin corner mirrors the bed, which no camera
   pose can do. The Camera panel says so where the overlay controls were and on the calibration row:
   "Calibrate the camera again, or set the origin back". The overlay, trace, Find pieces, camera
   marks, head capture and the burn check do not use the model. This follows decision 5's other
   unusable cases. It is not a new gate (ADR-228): nothing about Frame or Start changes.
4. **Said when moved.** When the model was moved, the calibration row says on what bed it was made
   and how far its picture moves.
5. A recalibration compares the saved model against the new photo in the frame the new rings
   were placed in, so a frame change does not show up as camera drift.

### Consequences

- A calibration made before this amendment has no frame. It is used as before until the camera is
  calibrated or checked again. **Replaced by Amendment 2:** such a calibration is not used until
  its frame is confirmed or the camera is recalibrated, because a check labelled its target in
  today's frame and saved that frame for good (meta audit M2-P3-3).
- An origin change makes the camera unusable until it is recalibrated or the origin is set back.
  A 180° change (both axes) could be represented as a turn, but it is treated the same way: it is
  rare, and a new calibration is the honest check.
- Code and test evidence only (`camera-bed-frame.test.ts`): the audit's 400 → 410 case now draws
  the point at scene (200, 210), which burns at machine (200, 200) where the camera saw it.
  No camera or machine was used.
