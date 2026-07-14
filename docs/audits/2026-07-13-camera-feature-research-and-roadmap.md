# KerfDesk camera feature research and implementation roadmap

Date: 2026-07-13
Repository: `C:\Users\Asus\LaserForge-2.0`
Implementation worktree: `C:\Users\Asus\LaserForge\camera-research-main`
Branch: `codex/camera-trust-foundation`
Base: `origin/main` at `11e6cc0457fd2015b42d20e01532b2a6d1f4f896`

## Executive verdict

KerfDesk already has unusually deep camera foundations for a browser/Electron laser application: USB and machine-network sources, fisheye calibration, automatic marker alignment, captured and live overlays, a top-down camera-to-trace path, profile persistence, and extensive synthetic geometry tests.

The main weakness was not missing image processing. It was missing trust contracts around that processing. Before this branch, a valid-looking overlay could be applied after the camera, capture shape, physical coordinate frame, or material plane had changed. The UI also presented local machine-camera controls on hosted web builds where the loopback bridge cannot exist.

This branch converts camera placement from a visual convenience into an explicit machine-coordinate contract. It binds calibration to the real capture source, locks camera placement to absolute coordinates, requires current machine-position trust, records and compensates material surface height, preserves the user's project during alignment burns, and reports an independent marker-spacing error instead of claiming accuracy from four exactly fitted points.

The feature is materially safer and more honest after this work, but real-camera perceptual verification remains mandatory before production sign-off.

## Research baseline

Primary references:

- [LightBurn camera troubleshooting](https://docs.lightburnsoftware.com/latest/Troubleshooting/CameraTroubleshooting/) explicitly warns that changing material thickness changes the camera-to-work distance and causes misalignment.
- [LightBurn Cameras window](https://docs.lightburnsoftware.com/latest/Reference/Cameras/CamerasWindow/) establishes the expected capture/update-overlay workflow.
- [OpenCV homography tutorial](https://docs.opencv.org/master/d9/dab/tutorial_homography.html) describes planar homography, pose recovery when camera intrinsics are known, and the limitations of a single plane.
- [OpenCV camera calibration and 3D reconstruction](https://docs.opencv.org/master/d9/d0c/group__calib3d.html) documents homography decomposition and positive-depth ambiguity checks.
- [OpenCV solvePnP documentation](https://docs.opencv.org/master/d5/d1f/calib3d_solvePnP.html) documents planar pose estimation from known world points and camera intrinsics.

The research conclusion is simple: a camera overlay is safe for machine placement only when five identities remain consistent:

1. camera source;
2. capture geometry and resize/crop behavior;
3. lens-correction pixel basis;
4. machine absolute coordinate frame;
5. physical surface plane.

If any identity changes, KerfDesk must compensate it mathematically or refuse precision placement with a specific recovery instruction.

## Current architecture map

| Concern | Main implementation | Persistence | Trust boundary |
| --- | --- | --- | --- |
| USB capture | `src/platform/web/web-camera.ts` | preferred camera ID only | browser media-device identity and actual track settings |
| Machine JPEG / RTSP | camera bridge plus `src/ui/camera/frame-source.ts` | sanitized source URL/profile | loopback bridge, private-network proxy, FFmpeg |
| Lens calibration | `src/core/camera/*calibrat*` and camera wizard | `DeviceProfile.cameraCalibration` | camera identity, resolution/aspect, rectified basis |
| Bed alignment | marker detector, homography solver, align wizard | `DeviceProfile.cameraAlignment` | capture binding, plane height, independent marker check |
| Workspace overlay | `WorkspaceCameraOverlay.tsx` | overlay preferences are ephemeral | source binding, basis, height compensation, view transform |
| Camera trace | `trace-from-camera.ts` | traced raster becomes project content | same binding/basis/height geometry as overlay |
| Start / Frame | laser readiness and placement flow | placement latch is ephemeral | absolute coordinates and trusted machine position |

## Changes implemented in this branch

### 1. Camera placement is a machine-safety mode

- Showing or updating an aligned overlay activates Camera Placement.
- Camera Placement forces and locks `Start from: Absolute Coordinates`.
- Hiding the overlay does not silently remove the placement contract.
- The operator must explicitly choose `Exit camera placement`.
- Homing-capable machines require a completed Home in the current session.
- Machines without homing require an explicit bed-coordinate confirmation tied to the controller position epoch.
- Reconnect, reset, alarm, sleep, or homing invalidates that manual confirmation.
- Start and Frame use the same pure safety decision.
- Start and Frame also refuse when the saved camera geometry cannot serve the selected material surface.

### 2. Calibration and alignment are bound to the real source

New capture metadata records:

- source kind (`usb`, `machine-jpeg`, or `machine-rtsp`);
- sanitized source identity;
- width and height;
- resize mode (`none`, `crop-and-scale`, or `unknown`).

Rules:

- a different camera is rejected;
- a changed aspect ratio is rejected;
- crop-and-scale captures require exact geometry;
- same-aspect pure resizing can be rescaled safely;
- old unbound calibration/alignment records require setup to be run again;
- RTSP credentials, query tokens, and fragments are not persisted.

Overlay and Trace now share the same binding decisions, eliminating a class where one path accepted pixels the other rejected.

### 3. Material-height and parallax compensation

The alignment wizard records the physical height of the burned marker surface above the machine bed. The Camera panel records the current material's top-surface height.

For a rectified alignment with known camera intrinsics, KerfDesk:

1. inverts the camera-to-plane homography;
2. removes camera intrinsics;
3. recovers an orthonormal camera pose for the alignment plane;
4. translates the plane along machine Z by the material-height delta;
5. rebuilds and inverts the projected plane homography;
6. applies the result consistently to overlay and Trace.

Synthetic tilted-camera tests project points on an elevated plane and recover their true machine XY to numerical precision.

Safe fallback behavior:

- the original homography remains valid on the exact alignment plane;
- height changes require lens calibration and a rectified alignment;
- legacy alignments without a recorded plane height are refused for precision placement;
- raw/manual alignment can still be used on its original bed plane but cannot claim parallax correction.

### 4. Independent alignment-quality evidence

Four homography points always fit themselves exactly, so their residual is not an accuracy measurement. The existing marker design has a fifth patch: two origin patches whose midpoint becomes one solve point.

KerfDesk now retains both independently detected origin-pair endpoints. After solving, it compares their mapped positions with their known physical spacing and stores the average error in millimetres.

This check correctly distinguishes the synthetic paths:

- raw distorted alignment: approximately `2.48 mm` independent error;
- rectified alignment: below `0.8 mm` in the existing rendered fixture.

The value is shown to the operator with a scrap-verification warning. It is evidence, not a fabricated guarantee; no hard production threshold is imposed before real-camera data exists.

### 5. Non-destructive alignment-marker jobs

The marker burn is compiled from a temporary in-memory project and passes through the standard readiness, preflight, confirmation, and streaming path.

It no longer replaces the user's scene. Tests assert that scene identity, undo history, and dirty state remain unchanged.

### 6. Hosted web capability honesty

On a hosted Cloudflare Pages origin:

- USB camera remains available;
- machine-camera detection and RTSP controls are not presented as locally usable;
- the UI explains that KerfDesk Desktop is required for the local bridge;
- the bridge is not probed automatically;
- the diagnostics panel does not show a false red bridge failure.

Localhost development, Electron, and explicit mock environments retain bridge controls.

### 7. Network preview freshness and secret hygiene

- machine/RTSP previews expose loading, live, stale, and failure states;
- precision actions still perform a fresh frame fetch rather than trusting a stale preview pixel;
- stored RTSP preferences remove credentials and token-bearing query strings;
- legacy stored preferences are scrubbed when read.

## UX after this branch

The intended operator workflow is:

1. Select a USB camera, or use Desktop for a machine camera / RTSP source.
2. Calibrate the lens with the exact camera and capture shape.
3. Start Align to bed.
4. Enter the real height of the marker sheet or fixture above the bed.
5. Burn the temporary marker job or confirm the pattern already exists.
6. Detect markers and review the independent error in millimetres.
7. Enter the current material's top-surface height in Camera.
8. Update the overlay. KerfDesk reports whether perspective correction is active.
9. Place artwork in the absolute bed coordinate frame.
10. Home the machine, or explicitly confirm bed coordinates on a no-homing machine.
11. Frame and Start. Both refuse stale position or unusable camera geometry.
12. Exit Camera Placement after camera-positioned work is complete.

## Remaining roadmap

### P0: physical verification before release

- Run a gridded placement coupon on the real target camera and machine.
- Test at the alignment height and at several material heights.
- Record XY error at corners, edges, and center.
- Verify both landscape and 180-degree camera mounting.
- Verify reconnect/reset/alarm invalidation on hardware.
- Verify USB device IDs across browser/desktop restarts.
- Verify machine JPEG and RTSP freshness with a deliberately stalled source.

Acceptance target should be chosen from measured hardware capability, not invented in code. Store the fixture captures and results so future calibration changes have a real regression corpus.

### P1: stronger fiducials and bed-wide validation

- Replace the minimal checker-patch constellation with coded fiducials or another unambiguous design.
- Add one or more independent interior verification targets.
- Solve from more than four points with robust outlier rejection instead of an exact four-point fit.
- Report RMS, maximum, and per-region error.
- Display a bed heat map so an operator can see where the camera is trustworthy.
- Block precision placement only after hardware-derived thresholds exist.

### P1: calibration lifecycle

- Add named camera setups per machine and mounting position.
- Show camera source, resolution, calibration date, alignment date, plane height, and error in one setup card.
- Add export/import of camera setup diagnostics without secrets.
- Add explicit invalidation reasons after camera or machine-profile edits.
- Offer a short verification flow instead of forcing full recalibration when only a confidence check is needed.

### P2: performance and live experience

- Move live lens rectification and bed warp to WebGL/WebGPU where supported.
- Keep the CPU reference path for correctness and fallback.
- Add frame-age and processing-time telemetry.
- Use adaptive preview resolution while preserving full-resolution precision captures.
- Avoid presenting a raw live overlay when the saved alignment is rectified.

### P2: camera-assisted production features

- region-of-interest Trace from camera;
- offcut detection and nesting assistance;
- reusable material silhouettes;
- multi-camera or stitched-bed support for machines larger than one field of view;
- before/after job snapshots and optional time-lapse;
- head-mounted camera stitching as a separate workflow, not an overload of fixed-camera alignment.

### P2: bridge pairing and policy

- Replace broad hosted-origin trust with explicit desktop pairing or a short-lived local capability token.
- Keep private-network egress restrictions and redirect refusal.
- Show the exact bridge origin and source being accessed.
- Add rate and concurrency diagnostics for FFmpeg-backed sources.

## Verification ledger

Completed during implementation:

- focused camera suites covering source binding, calibration persistence, overlays, auto-align, platform capability, storage scrubbing, placement safety, Start, Frame, marker jobs, and height compensation;
- TypeScript typecheck;
- ESLint on all changed TypeScript/TSX files;
- Prettier checks;
- full repository release gate through tests, Playwright, web build, Electron build, license audit, dependency audit, and size checks;
- the first full gate found only an unnecessary camera barrel-export increase; direct imports restored the export ratchet to its baseline allowance.

Final mechanical status:

- the final source diff passed `pnpm release:check` in 12m43s;
- the only change after that run was this verification-ledger sentence;

Still required on physical hardware:

- real-camera perceptual alignment;
- real machine Frame/Start validation;
- elevated-material coupon validation.

## Release recommendation

The mechanical release gate passes. Label the camera feature as hardware-verified only after the P0 coupon and lifecycle checks are recorded. The software geometry is now strongly tested, but unit tests cannot prove that a physical camera mount is rigid, a lens has not shifted, a bridge frame is truly current, or a controller's coordinate frame matches the bed.
