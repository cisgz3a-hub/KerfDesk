## ADR-440 Amendment 3 - The camera calibration belongs to the machine, not the project file (2026-10-25)

**Status:** Accepted. | **Date:** 2026-10-25

### Context

ADR-440 stores the camera model on the machine profile. The app saves that profile for the next
session (ADR-500 Amendment 1), and every project file also carries a copy of it. Opening a file
replaces the profile in use with the file's copy. When the file is for the same machine, no
machine notice appears.

A test of this path showed the loss. Calibrate the camera, then open a file saved before the
calibration. The calibration disappears from the session with no message. The next machine edit
then saves the file's profile, without the calibration, as the app's machine, and the calibration
is gone for good. A file holding an older calibration swaps it in the same way.

### Decision

1. Opening a file for the machine already in use (same profile id, name and bed size, as in
   ADR-400 Amendment 1) keeps that machine's `cameraModel` and `otherCameraModels`. The file's
   copies are ignored.
2. When the file held a calibration of its own that differs, an info toast says so: `This file's
   camera calibration was not used: the camera keeps your machine's current calibration.` A file
   with no calibration opens silently.
3. With no camera calibration in use, the file's copy comes in, as before. That covers a new
   computer, or a profile reset.
4. A file for another machine still brings its whole machine, calibration included, behind the
   machine notice. **Keep current machine** restores the current profile, calibration included.
5. Saving a project still writes the machine's current calibration into the file.

### Consequences

- A calibration survives restarts, updates, New and opening any file for the same machine. It
  goes only when the operator recalibrates, chooses another machine, or clears the app's data.
- A file can no longer bring an older calibration back for the same machine. The way to return to
  an older calibration is to calibrate again.
- Evidence: `src/ui/app/camera-calibration-open.test.tsx`. Without the change, its two
  file-opening cases fail. Code evidence only; no camera was used.
