# Camera, Place Board and Print and Cut software workflow completion

These follow-up checks extend the previous prerequisite-only observations with real component workflows using explicit simulated inputs. They do not establish camera/device permissions, physical lens accuracy, real board dimensions, controller transport behaviour, material cutting or physical registration accuracy. No hardware was connected or operated.

## Research and design checks

- Camera calibration: the [OpenCV fisheye model](https://docs.opencv.org/4.13.0/db/d58/group__calib3d__fisheye.html) defines camera pose, angular distortion and conversion into image coordinates. The final audit fixture renders a noisy 1280 × 720 image of 100 rings through a known distorted camera, PNG-encodes the pixels and runs the real image decode, calibration worker, result review and profile-save path. It also checks the saved model against 50 independent points away from calibration marks at 0 and 12 mm heights, with maximum mapping error below 0.4 mm. A small fitted residual alone is not a physical accuracy certificate.
- Print and Cut: [LightBurn's two-target workflow](https://docs.lightburnsoftware.com/latest/Reference/PrintAndCut/) provides the comparator for translation, rotation and scale. The test captures two corresponding positions, checks the resulting similarity mapping, reopens it, and disables it. On the default 400 mm bed with bottom-left machine origin, machine Y20 maps to scene Y380, so design Y10 produces a translation of +370 mm. Two points cannot establish sheet shear or local print distortion.
- Place Board: the repository's captured-board contract owns the geometry, outline identity and coordinate epoch together. The test captures all four rectangle corners, commits the outline, corrects its top-right point and checks that a changed position epoch refuses further verification of stale coordinates. No new hardware or Frame policy is introduced; ordinary execution retains the existing completed-Frame contract.

## Test surface

`e2e/fixtures/registration-audit.html` is a development-only acceptance surface, imported by no production entry. It uses the real `CameraCalibrationWizard`, `BoardCapturePanel` and `PrintAndCutDialogHost`. Its visibly labelled simulator terminates origin and jog requests in memory and records them as simulated commands. The synthetic camera is a locally encoded image, with no network camera or media-device access.

The same visible controls support direct computer use. `e2e/registration-tools-audit.e2e.ts` contains the repeatable browser assertions. Browser receipts and direct computer-use observations are recorded by the integrating audit; they must be distinguished from the synthetic input and unit-test evidence below.

## Automated verification

The three browser workflows in `registration-tools-audit.e2e.ts` passed in 58.4 seconds (Camera 15.7 s, Place Board 5.4 s, Print and Cut 5.3 s; remaining time is browser/server setup). The first harness run exposed only test-layout, ambiguous-selector and coordinate-oracle mistakes; those were corrected before this passing run. Targeted ESLint passed for the new harness and browser test.

Seven focused suites passed, 77 tests total, on this follow-up source:

- `src/core/camera/target/bed-calibration.test.ts`
- `src/ui/camera/calibrate/calibration-actions.test.ts`
- `src/ui/camera/calibrate/CameraCalibrationWizard.test.tsx`
- `src/ui/laser/PrintAndCutDialog.test.tsx`
- `src/ui/laser/print-cut-camera-host.test.tsx`
- `src/ui/laser/board-capture/BoardCapturePanel.verification.test.tsx`
- `src/ui/laser/board-capture/BoardCapturePanel.correction-ownership.test.tsx`

These include noisy/mirrored/missing-anchor camera cases, ownership changes, stale registration state, circle fitting and rectangle/circle correction. This is bounded adversarial testing, not a real-device endurance run. The existing source fixes remained valid; this follow-up did not identify an additional production defect in these three tools.

Direct computer use found that the initial 960 × 540 synthetic image produced only 88 detected rings and a 10 × 9 layout warning despite a small fitting residual. Independent quantized-pixel regression tests reproduce that warning at 960 pixels and verify that 1280 pixels detects at least 95 rings without a layout mismatch. Both fits map the independent points within 0.4 mm. This isolates undersampling of the far outer row in the fixture; the production warning correctly calls attention to the incomplete observed layout. The final browser assertion requires both the absence of this warning and the independent mapping bound, rather than treating RMS alone as qualification. Both fixture regression tests pass. The strengthened Camera browser case passed in 9.6 seconds (30.9 seconds including browser/server setup). These browser runs used the list reporter: detailed passing output is in the tool transcript, and only `.last-run.json` is persisted in their artifact directories; passing screenshot attachments were not retained by that reporter.

## Direct interaction procedure

1. Camera: choose **Camera calibration workflow**, **Target already engraved**, **Take photo**, inspect the result and **Save calibration**. Require the successful accuracy headline and no target-layout mismatch warning. The saved observation must contain found marks and RMS below 0.3 mm; the visible independent maximum mapping error must be below 0.4 mm on this synthetic target.
2. Place Board: choose its workflow, set/capture positions 10,20 → 110,20 → 110,80 → 10,80. Confirm 100 × 60 mm, then **Create board outline**. Under **Physically check board**, choose **Top-right**, **No, adjust it**, then **Corrected position 111,80** and **Use current head position & update board**. The width becomes 101 mm. **Invalidate position epoch** must disable further point checks with a recapture message.
3. Print and Cut: choose its workflow. Capture the first head position, use **Second print mark 390,20**, capture the second, and apply. Observe scale 1 and translation (0,370), reopen and confirm retained captured points, then **Disable** and confirm no output registration remains.
