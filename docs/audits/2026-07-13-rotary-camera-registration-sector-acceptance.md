# KerfDesk Rotary, Camera, Registration, and Print-and-Cut Sector Acceptance

**Date:** 2026-07-13

**Baseline:** 2026-07-11 competitive audit, shipped sector score **5.5/10**

**Candidate stack:** PR #58 through PR #83 + `codex/rotary-camera-9-acceptance`

**Status:** Software candidate complete; local full release gate passed; not yet shipped on `main`

## Verdict

The stacked candidate earns **9.1/10** after the full release gate passed. The July 11
baseline predated the discoverable rotary setup, explicit rotary-raster gate, camera calibration and
alignment system, shared output snapshot, and two-point Print-and-Cut workflow now present in the
stack. This acceptance pass closes the remaining software-level gate and validation gaps and proves
the combined workflows in Chromium.

This is a software acceptance score. It does not replace optical measurement on real cameras,
roller/chuck burn tests, or Print-and-Cut registration measurements on physical machines.

## Competitive Boundary

LightBurn exposes roller/chuck rotary setup and an explicit rotary enable state:
[Rotary Mode](https://docs.lightburnsoftware.com/latest/Reference/RotaryMode/). Its camera workflow
separates lens calibration from camera-to-workspace alignment, burns alignment targets, supports
automatic and manual alignment, and validates the result before saving:
[Camera Alignment](https://docs.lightburnsoftware.com/latest/Reference/Cameras/Alignment/). Its
Print-and-Cut workflow uses two corresponding design and machine targets to recover translation,
rotation, and scale, requires trusted reported position, and switches to absolute positioning:
[Print and Cut](https://docs.lightburnsoftware.com/2.1/Reference/PrintAndCut/).

Rayforge documents USB camera calibration, camera-to-machine transforms, and multi-point alignment:
[Camera Integration](https://rayforge.org/docs/machine/camera/) and
[Workpiece Positioning](https://rayforge.org/docs/features/workpiece-positioning/).

KerfDesk's acceptance target is dependable GRBL-family roller/chuck, overhead-camera, and
two-target registration operation. It does not claim LightBurn's complete camera-file ecosystem,
head-mounted camera breadth, DSP/galvo rotary breadth, or physical validation depth.

## Evidence

| Capability | Candidate evidence | Result |
| --- | --- | --- |
| Rotary setup | Labs-gated roller/chuck setup includes enablement, diameter, motion per turn, direction reversal, wrap preview, persistence, and a generated calibration pattern | Accepted |
| Rotary transform | One machine-space transform supplies output, framing, estimates, and placement bounds while rotary-disabled fixtures remain byte-identical | Accepted |
| Rotary raster | A separate dependent Labs opt-in enables raster output; row spacing, bounds, reversal, and one-revolution overflow are tested | Accepted |
| Rotary browser output | Chromium configures a chuck, imports a real generated bitmap, exports G-code, and verifies transformed non-negative Y motion beyond the flat design extent | Accepted |
| Camera sources | USB, RTSP bridge, and machine-camera source paths share capture, diagnostics, overlay, and cleanup contracts | Accepted |
| Lens calibration | Checkerboard detection, pose diversity, sub-pixel corners, distortion solve, residuals, resolution matching, rectification, and persistence are covered | Accepted |
| Camera alignment | Marker generation, burn flow, automatic detection, raw/rectified homography solve, overlay projection, and bed warp are covered | Accepted |
| Camera safety gate | Camera alignment v2 now requires both explicit Labs opt-in and a homing-enabled machine profile; disabling either closes the wizard | Accepted |
| Camera browser workflow | Chromium proves USB and RTSP startup/capture plus the gated alignment wizard through its detection-ready state | Accepted |
| Print-and-Cut math | Two distinct design/machine point pairs solve one similarity transform with translation, rotation, scale, and inverse property coverage | Accepted |
| Print-and-Cut validation | Apply remains disabled until both machine points and distinct live draft targets form a valid transform | Accepted |
| Shared output truth | Preview, frame, estimate, export, and start request the same registered output snapshot; job-origin placement is rejected while registered | Accepted |
| Position trust | Captures are bound to the trusted-position epoch; disconnect, alarm, recovery, reboot, or other trust loss invalidates output | Accepted |
| Registration browser output | Chromium captures two points, exports transformed G-code, then proves disconnect prevents another export before the file picker | Accepted |
| Persistence | Rotary profile data, camera profile/calibration/alignment, and Print-and-Cut design targets round-trip while machine captures remain session-only | Accepted |

## Verification

- TypeScript: passed.
- Targeted ESLint: passed with no warnings or errors.
- Focused sector battery: **68 files, 292 tests passed**.
- Chromium acceptance: **19 workflows passed**, including USB and RTSP cameras, rotary raster
  output, registration export, and stale-position refusal.
- Full repository release gate: `pnpm release:check` passed in **12m02s**, including formatting,
  licenses, dependency audit, the complete product test suite, 19 Chromium workflows, web build,
  Electron main build, and both file-size policies.

The focused camera tests intentionally exercise known failure outcomes whose implementation logs
jsdom's unsupported canvas encoder; those tests passed and the real Chromium camera workflows also
passed.

## Why 9.1

The candidate now covers the complete software journey for this sector: discoverable setup,
explicit experimental gates, persisted machine configuration, calibrated transforms, one shared
prepared-output path, browser-level operation, and fail-closed invalidation. The camera calibration
corpus includes rendered front-facing, rotated, tilted, raw-lens, and rectified fixtures rather than
testing only hand-entered matrices.

The score remains below a perfect result because physical optical accuracy, varying material
heights, roller slip, chuck runout, rotary seam appearance, multiple camera models, camera-settings
import/export, head-mounted cameras, and a representative hardware matrix remain incomplete.

## Score Boundary

- **Shipped `main`: 5.5/10** until the stacked candidate merges and the acceptance suite passes on
  the resulting `main` revision.
- **Stacked software candidate: 9.1/10** with the local full release gate passed.
- Physical camera, rotary, and registration runs remain separate hardware acceptance work.
