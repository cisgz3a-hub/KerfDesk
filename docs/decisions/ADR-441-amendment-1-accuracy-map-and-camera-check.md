## ADR-441 Amendment 1 - An accuracy map on the canvas and a check for a moved camera (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

### Context

ADR-441 measures every engraved ring's error, but only the wizard's result screen showed it. Once
saved, the calibration was one average figure, so the operator could not see which part of the
bed the camera trusts. Nothing answered "has the camera moved?" either: a knocked camera, or a lid
that closes a little differently, shifts the overlay, and the only way to find out was to
recalibrate and compare figures by memory.

### Decision

1. **Saved rings.** `CameraModelAccuracy` (`core/camera/model/camera-model-accuracy.ts`) keeps
   each ring's engraved position, its error vector to the micrometre and whether the fit rejected
   it, plus the target's area on the bed. Both are optional, so a record saved without them still
   loads. When they are present but malformed, the whole record is dropped, as ADR-440 does for
   any other malformed field.
2. **Accuracy map.** **Accuracy map on/off** in the overlay row draws those rings on the workspace
   over the camera picture, through the same view transform. Each ring is coloured as in the
   wizard (green up to 0.25 mm, amber up to 0.6 mm, red beyond), and rejected rings are hollow. A
   dashed outline marks the target's area; outside it the picture is extrapolated, and a legend
   says so. The map only shows information and changes nothing.
3. **Every photo is checked against the saved calibration.** When a calibration is already
   saved, the wizard maps each ring the new photo found through the saved model
   (`core/camera/model/model-drift.ts`) and compares it with where the ring was engraved. The
   result reports the average and worst error and the average shift. The shift is named in canvas
   directions ("2.0 mm to the left and 0.4 mm lower"). The saved model counts as unchanged up to
   max(0.3 mm, 1.5 x its own calibration error), which allows for the new photo's own detection
   noise. A photo from another camera, of another shape or with another crop is not compared, and
   the result says why (`cameraModelForFrame`, ADR-440).
4. **Check camera.** **Check camera…** in the Camera panel opens the wizard at the photo step. It
   uses the saved calibration's target area and target height, so the rings are matched to the
   target that was engraved even if the bed size or the wizard's margin has changed since. The
   photo step says the sheet must lie where it was engraved, because a moved sheet reads the same
   as a moved camera. The result leads with the verdict:
   - When the camera has not moved, **Keep saved calibration** is the suggested button.
   - Otherwise **Save new calibration** is the suggested button.

   Both buttons are always offered (ADR-228). Engraving a new target from the check clears the
   saved area, so the new target's own area is used.

   Older valid records without a saved target area still serve overlay, Trace and ordinary job
   placement. **Check camera** sends those records to calibration setup with an explanation:
   engrave a new target, or confirm the original bed size, margins and sheet thickness before
   choosing **Target already engraved**. It does not guess the old layout from current settings
   and diagnose that difference as camera movement, or replace the saved calibration.

### Not done

There is no automatic check before a job. Without the target on the bed, a camera move can only
be told from the picture itself, by registering the scene against a reference photo. The gantry
and the material both change between photos, so that needs more work than this amendment. A Job
Review warning would also only be as current as the last check.

### Consequences

- A saved calibration carries about a hundred ring entries. That is a few kilobytes in the machine
  profile and in project files.
- Recalibrating now shows how far the old calibration had drifted, without extra steps.
