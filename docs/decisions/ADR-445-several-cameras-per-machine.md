## ADR-445 - Several cameras per machine, each with its own calibration (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

### Context

A machine profile saved one camera model (ADR-440). Many machines have more than one camera: a
Falcon or xTool with a built-in lid camera plus a USB camera over a larger bed, or two USB
cameras over one large bed. Calibrating the second camera replaced the first camera's
calibration. Switching back meant engraving and photographing the target again. LightBurn 2.1
keeps several cameras per device (the LightBurn gap list's LBG-M13).

Each saved model already records the camera it was fitted on (its capture binding: source kind,
id and, for network cameras, a keyed query fingerprint). A model used with another camera
already refuses with "belongs to a different camera".

### Decision

1. **Storage.** `DeviceProfile.cameraModel` stays the newest calibration, so older KerfDesk
   versions still read it. The calibrations of the machine's other cameras go in
   `otherCameraModels`, each bound to its camera. Projects and machine profile files carry the
   list. An invalid entry, or one with no capture binding, is dropped on project load, and a
   machine profile file with one is refused, like an invalid `cameraModel`.
2. **Which model is used (`core/camera/model/saved-cameras.ts`, `ui/camera/active-camera-model.ts`).**
   Every camera feature (overlay, accuracy map, trace, Find pieces, Print and Cut marks, Check
   camera) reads the model through `activeCameraModel`. That is the running camera's own
   calibration, matched by source kind and id (plus query for network cameras). A camera with no
   calibration of its own, or no camera running, gets the newest. With a running camera that
   calibration then reports that it belongs to another camera, exactly as before. A calibration
   saved before cameras were recorded (no binding) counts as any camera's own, as it did.
3. **Saving.** A new calibration becomes the newest and replaces only the earlier calibration of
   the same camera, plus any unbound one, which no camera could select again. The result step says
   when the other cameras' calibrations are kept. The saved-calibration comparison (ADR-441
   Amendment 1) compares against this camera's own calibration only.
4. **Panel.** **Calibrated cameras** lists each saved calibration with its camera, date and
   average error, and marks the one in use. It appears once there is a second camera to tell
   apart: two calibrations, or a running camera that has none of its own. **Forget** removes one
   as an undoable profile edit. The camera setup steps and **Recalibrate** / **Check camera** look
   at the running camera's own calibration.

No new gate: a camera without its own calibration shows the same factual message as before.

### Consequences

- Switching between calibrated cameras needs no recalibration, and each keeps its own accuracy
  map and Check camera target.
- One camera at a time drives the overlay. Showing two cameras at once over one bed (a stitched
  overlay) is a later step, as are head cameras and phones (batch 6 of the camera plan).
- A USB camera is recognised by the browser's device id. A browser that changes it (cleared site
  data) sees an uncalibrated camera; its old calibration stays listed and can be forgotten.
