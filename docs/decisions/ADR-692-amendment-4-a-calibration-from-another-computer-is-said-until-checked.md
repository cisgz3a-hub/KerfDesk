## ADR-692 Amendment 4 - A calibration from another computer is said in Job Review until it is checked (2026-11-15)

**Status:** Accepted. Fixes camera audit v2 K6-P2-1 (P2). Amends Amendment 3, Decision 3 (the notice
lives in the Camera panel and is worded as the same camera). Also closes K6-P3-4 (P3, a local denial
of service, CWE-400, no login use), whose details stay out of the repository until a release carries
the fix. Code and synthetic evidence only. | **Date:** 2026-11-15

### Context

Under Amendment 3, a network camera's calibration made on another computer matches any camera that
answers at the same address. The address alone cannot tell that camera from another one there. Two
owners of the same machine model share a file, the built-in cameras answer at the same fixed address,
and the first machine's calibration is drawn over the second camera. The notice said "It is the same
camera at the same address", and it was shown only in the Camera panel. A camera that starts by
itself draws on the canvas without the panel opening. Job Review said nothing, and the moved check
cannot run without a view kept on this computer.

### Decision

1. **Job Review says it** while camera placement is on: the calibration was made on another computer
   and has not been checked here, and a camera at the same address may be another camera. Run Check
   camera first. It is said in the place of the "camera may have moved" line, which has nothing to
   compare with yet.
2. **The Camera panel notice says the same,** and no longer claims it is the same camera.
3. Both end when this computer keeps a view of the camera: a Check camera that finds it where the
   calibration puts it, or Fix a small offset.

### Consequences

- An unchecked calibration from another computer is said before every Start that uses the camera.
- Nothing is refused: the maintainer's choice stays a notice (ADR-228).

### Verification

`src/ui/camera/panel/CameraElsewhereNotice.test.tsx`:
- Job Review says it for a calibration from elsewhere, and not for one made here;
- it stops once a view is kept;
- the notice no longer says "same camera".
