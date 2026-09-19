# Job-time estimate remediation

This change reconciles the September 19 job-time audit with current main. The implementation was
extracted from preserved before/after file hashes so the PR contains the timing work without the
original checkout's unrelated changes. The original checkout remains intact.

## Corrected behavior

| Finding | Correction |
| --- | --- |
| TIME-01 | Include serial delivery delay that cannot overlap earlier execution; restart delivery at host-managed tool changes. |
| TIME-02 | Time native emitted CNC pecks, helical entry, XYZ motion and retract policy. |
| TIME-03 | Include emitted dwell and parking; disclose excluded manual tool-change waits. |
| TIME-04 | Carry device cut/travel calibration from prepared Review through Start and live remaining time. |
| TIME-05 | Include known physical XYZ in all placement modes and background cache identity. |
| TIME-06 | Continue timing through sender pause/deceleration until fresh evidence proves physical hold. |
| TIME-07 | Use XYZ junction direction so pure-Z reversals decelerate correctly. |
| TIME-08 | Estimate preloaded large jobs on initial mount and ignore stale background replies. |
| TIME-09 | Follow emitted coordinate/feed precision and controller-native laser-off travel. |
| TIME-10 | Round total seconds before splitting units; show exhausted estimates separately from physical completion. |

The total is calibrated cut motion + calibrated travel motion + deterministic dwell + serial delay
that cannot overlap earlier execution. Manual operator waits are excluded. Preview incorporates
that total in geometric playback without claiming exact per-command event placement.

The existing 25,000-line/segment Start timing budget remains bounded. Unsupported syntax, missing
timing evidence or an exceeded sidecar budget produces an unavailable estimate and does not add a
Start gate. Frame remains the sole ordinary Start policy gate.

## Verification

The timing work was reconciled with the Vitest 4 main branch and the verified native-controller
changes in PR #796. The integrated regression cohort passed 110 test files and 727 tests, covering
the emitted CNC clock, serial overlap, calibration, XYZ placement, physical pause evidence,
background estimates, Inspector precision and duration presentation.

Independent reviews checked the timing mathematics, live UI and worker lifecycle, and native
controller context. Review reproductions exposed and corrected retained-S classification after
M5, loss of arc length in long Float32 routes, and GRBL coordinate parsing at a precision boundary.
Regression expectations use emitted commands and independent kinematic calculations where the
previous tests assumed an analytic path that differed from execution.

The PR records the final type, lint, formatting, build and structural checks. Publication requires
the full release and Chrome browser workflows to pass for the exact proposed commit. Prior dirty
checkout results are not treated as release qualification for this branch.

## Model limits

The motion model uses configured scalar limits. Serial delivery is an earliest-arrival model;
controller RX/ACK behavior, host scheduling, overrides and spindle/material behavior can add time.
No hardware was operated and software tests do not establish physical cycle-time accuracy.
