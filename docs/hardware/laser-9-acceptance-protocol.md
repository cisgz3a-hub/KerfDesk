# KerfDesk Laser 9.0 hardware acceptance protocol

Status: required physical work; not executable in CI or on a machine without the named devices.

This protocol is the release evidence contract for removing Laser 9.0 Labs gates. Automated fixtures prove software behavior, but they do not prove dimensional accuracy, controller timing, optical hard-off, camera stability, or safe recovery on physical equipment.

## Evidence bundle

Create one folder per run under `hardware-evidence/<date>-<device>-<firmware>/`. Do not commit customer artwork, network credentials, camera URLs containing credentials, or serial numbers that identify an owner.

Each run must contain:

- `environment.md`: operator, date, KerfDesk commit, desktop/web build, OS, machine model, controller, firmware, laser module, bed size, rotary model, camera model, and calibration state.
- `project.lf2`: the exact project used for the run.
- `prepared-output.gcode`: exported from the same prepared snapshot used to Start.
- `transcript.txt`: controller transcript from connect through final recovery.
- `measurements.csv`: commanded and measured values with units.
- `result.md`: every case ID, pass/fail, deviations, anomalies, and operator signature.
- Photos with a ruler or calibrated scale for every dimensional coupon.
- Video for motion, pause/recovery, Fire release, disconnect, alarm, and rotary seam cases.

Record failures as evidence. Never repeat a failed motion or Fire case until the cause is understood and the work area is safe.

## Common prerequisites

1. Use suitable enclosure, ventilation, eye protection, fire suppression, and a nonflammable test surface.
2. Verify emergency stop and physical power isolation before connecting KerfDesk.
3. Begin with low-risk card or purpose-made test stock. Fire testing requires a calibrated optical power sensor or photodiode, not combustible material.
4. Home the machine where supported and verify the displayed bed, origin, axes, and units.
5. Keep all Labs features disabled except the single feature under test.
6. Save the project and exported output before Start. Hash both files in `result.md`.
7. A run is invalid if firmware, steps/mm, rotary parameters, camera position, material placement, or KerfDesk commit changes mid-run.

## Measurement rules

- Linear error: `measured mm - commanded mm`.
- Scale error: `abs(linear error) / commanded mm * 100`.
- Registration error: Euclidean distance from commanded target center to measured mark center.
- Rotary circumference error: `abs(measured wrap length - pi * measured diameter)`.
- Seam error: signed physical gap or overlap at the wrap boundary.
- Timing uses frame timestamps or a logic/optical trace, not operator reaction time.
- Repeat each dimensional case three times unless a case specifies five coupons.

Unless a device specification is stricter, the Laser 9.0 candidate acceptance limits are:

| Metric | Limit |
| --- | ---: |
| 100 mm linear vector dimension | `max(0.5 mm, 0.5%)` absolute error |
| Raster rectangle width and height | `max(0.5 mm, 0.5%)` absolute error |
| Rotary wrap length | `max(1.0 mm, 0.5%)` absolute error |
| Rotary seam gap or overlap | 0.5 mm maximum |
| Print-and-cut registration | 1.0 mm maximum per target and 0.5 mm mean across five coupons |
| Camera overlay check points | 2.0 mm maximum at center and four bed quadrants |
| Fire release to optical baseline | 250 ms maximum |

## FAL series: Creality Falcon

Use the supported Creality Falcon profile selected through the complete setup wizard.

| Case | Procedure | Required evidence | Pass condition |
| --- | --- | --- | --- |
| FAL-01 Setup | Connect, read settings, save, reopen, and reconnect. | Profile JSON/project, screenshots, transcript | Controller kind, baud, bed, origin, power scale, and framing feed round-trip exactly. |
| FAL-02 Frame | Frame a 100 x 100 mm rectangle from each supported Start From mode. | Video, transcript, measurements | Laser remains optically off; jog feed equals profile framing feed; bounds remain on bed. |
| FAL-03 Vector | Cut or mark the 100 mm dimensional coupon at low safe power. | Coupon photos and CSV | Both axes meet linear limits and output matches Preview order. |
| FAL-04 Raster | Engrave a 100 x 40 mm bidirectional raster with visible seam markers. | Coupon photos, G-code, CSV | Dimensions meet raster limits; no silent clipping, banding from travel, or unexpected seam. |
| FAL-05 Pause | Pause during vector and raster motion, wait five seconds, then resume. | Continuous video and transcript | No uncontrolled beam dwell; resume continues from the held job without replay or skipped geometry. |
| FAL-06 Alarm recovery | Trigger a safe controller alarm or limit simulation, then Home. | Video and transcript | Job terminates, Start remains blocked, trusted position invalidates, successful Home clears the alarm and restores readiness. |
| FAL-07 Disconnect | Disconnect USB during a low-power air motion test. | Video and transcript | Streaming stops, hard-off commands are attempted, position becomes unknown, and Start remains blocked until recovery. |
| FAL-08 Fire | Hold Fire at the configured cap, then release, blur, navigate, alarm, disconnect, and unmount in separate runs. | Optical trace and transcript | Fire is idle-only and diode-only; measured power never exceeds the cap; every exit reaches baseline within 250 ms. |

## GRB series: second GRBL-family machine

Use a machine with a different controller or firmware family from the Falcon, such as GRBL 1.1 versus grblHAL.

| Case | Procedure | Pass condition |
| --- | --- | --- |
| GRB-01 Setup | Complete setup, save, reopen, reconnect, and Home. | Profile round-trips and capability gating matches the controller. |
| GRB-02 Frame | Repeat the 100 x 100 mm frame case. | Correct framing feed, beam off, and bounded motion. |
| GRB-03 Stream | Complete vector and raster coupons. | No protocol errors, dropped acknowledgements, or output mismatch. |
| GRB-04 Pause/recovery | Pause/resume, Stop, alarm, disconnect, and Home recovery. | Every transition matches the visible state and hard-off contract. |

## ROT series: roller and chuck

Measure object diameter with calipers at the engraving location. Record roller diameter, chuck steps or mm per rotation, direction, and seam placement.

| Case | Attachment | Procedure | Pass condition |
| --- | --- | --- | --- |
| ROT-01 | Roller | Run the generated calibration pattern in both directions. | Scale meets rotary wrap limit and reverse direction is physically correct. |
| ROT-02 | Roller | Wrap vector geometry across the configured seam. | Seam error is at most 0.5 mm with no clipping or extra revolution. |
| ROT-03 | Roller | Run bidirectional raster across the seam. | Scan spacing is uniform; feed is correct; over-wrap policy is visible and deterministic. |
| ROT-04 | Chuck | Repeat calibration using measured diameter and mm per rotation. | Scale meets rotary wrap limit in normal and reverse direction. |
| ROT-05 | Chuck | Repeat vector and raster seam cases. | Same seam and no-clipping limits as the roller. |
| ROT-06 | Disabled parity | Export the fixed non-rotary fixture before and after rotary testing. | Files are byte-identical to the accepted non-rotary baseline. |

## CAM series: USB and RTSP cameras

Use a printed calibration board with measured square size and a fixed four-corner bed target. Do not move the camera after calibration.

| Case | Source | Procedure | Pass condition |
| --- | --- | --- | --- |
| CAM-01 | USB | Calibrate lens from the required poses, then align to the bed. | Capture succeeds and all five overlay check points meet the camera limit. |
| CAM-02 | USB | Change camera resolution after alignment. | Existing registration is invalidated or explicitly revalidated; stale alignment is never silently reused. |
| CAM-03 | USB | Stop camera, unplug, reconnect, and select it again. | Failure is actionable and recovery produces fresh readable pixels. |
| CAM-04 | RTSP | Connect through the loopback bridge and run Diagnostics. | Bridge, frame proxy, FFmpeg, source, and readable capture all pass. |
| CAM-05 | RTSP | Move a visible marker while capturing ten frames at 500 ms intervals. | Frames visibly advance with no stale sequence longer than two captures. |
| CAM-06 | RTSP | Stop the camera or network mid-preview, then reconnect. | Failure is surfaced; stale pixels are not accepted as a fresh alignment capture; reconnect restores capture. |
| CAM-07 | RTSP | Calibrate and align using the same target as USB. | All five overlay check points meet the camera limit. |

## PAC series: print and cut

Use absolute coordinates on a homed machine. Print five identical two-target sheets with target separation of at least 100 mm and place each sheet at a different translation and rotation on the bed.

For each sheet:

1. Capture the two printed target centers with the machine head.
2. Apply registration and confirm job-origin controls are disabled.
3. Frame and mark at least three verification targets not used to solve registration.
4. Measure every target center error.
5. After one coupon, invalidate trusted position by disconnecting or resetting and prove registration becomes unusable until recaptured.

Pass only when every target is within 1.0 mm, the mean across all five coupons is at most 0.5 mm, no target pair is coincident, and Preview, Frame, export, and Start use the same transformed bounds.

## Labs removal decision

A feature leaves Labs only in a dedicated PR containing:

1. The complete evidence bundle for its named cases.
2. A table of measured results against every threshold.
3. No unresolved safety anomaly or unexplained controller response.
4. Passing `pnpm release:check` at the exact evidence commit.
5. Review confirming that unrelated passing hardware does not unlock the feature.

Rotary vector, rotary raster, low-power Fire, print-and-cut, and camera alignment v2 are independent decisions. A pass for one does not remove another feature's gate.
