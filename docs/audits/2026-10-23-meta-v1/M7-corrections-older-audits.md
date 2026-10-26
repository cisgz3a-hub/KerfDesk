# Corrections by meta audit v1 M7 (2026-10-26)

The audits from 2026-09-24 to 2026-10-20 have no ledger, so this file is their ledger. It follows [M7-meta-older-audits.md](M7-meta-older-audits.md), checked against main `adf300522`, and the M7 refuter's verdicts. Each older document also has a dated status line under its title that points here.

IDs are prefixed with the audit date because the old IDs collide: 10-19 F-1..F-10, 10-16 F1..F4, CNC v1 F1..F8, and the 10-20 P-1..P-6. For example, `C0924-MC-2` is MC-2 of the 2026-09-24 CNC audit.

## Status corrections (merged work recorded as open)

| Document | It says | Now |
|---|---|---|
| [2026-09-24 CNC full](../2026-09-24-cnc-full-audit.md) | "Fixes: Draft PR on claude/cnc-audit-te9azb"; 51 status tags | #898 merged 2026-09-24T23:33Z. The tags were never updated, except MC-3. The 2026-09-29 recheck table and this file hold the current status |
| [2026-09-29 CNC second pass](../2026-09-29-cnc-audit-second-pass.md) | "Draft PR #1019"; P2-relief-finish-3 and WA-4 "Open" | #1019 merged 2026-09-29T10:17Z. P2-relief-finish-3 was fixed by #1136 (ADR-580). WA-4 was fixed by #1368 and #1384 (ADR-630 Amd 2) |
| [2026-10-09 released CNC output](../2026-10-09-released-cnc-output-audit.md) | "This candidate has not been merged" | #1109 merged 2026-10-08T23:10Z |
| [2026-10-16 controller pipeline](../2026-10-16-controller-pipeline-audit.md) | "These changes are not yet merged or released" | #1212 merged 2026-10-15T20:02Z |
| [2026-10-19 controller behaviour](../2026-10-19-controller-behaviour-audit.md) | F-5 and F-9 open | Fixed by #1328 (ADR-611 Amd 2). F-1..F-3 were fixed by #1294 (ADR-639) |
| [2026-10-20 controller design](../2026-10-20-controller-design-audit.md) | D-5 open; CS-05 open | D-5 was fixed by #1333 (ADR-648). CS-05 was fixed by #923 on 2026-09-26 (CG-11) |
| [2026-10-20 controller protocol](../2026-10-20-controller-protocol-audit.md) | P-1, P-5, P-6 open; CS-05 open | P-1, P-5 and P-6 were fixed by #1315 (ADR-644). CS-05 was fixed by #923 |
| [2026-09-25 controller full](../2026-09-25-controller-full-audit.md) (line 1775) and `tracks/CN.md:187` | PWM255 "clamps S12000 to full output" | Wrong. A PWM255 or PERCENT Marlin build wraps S to its low byte, so S12000 runs as 224 (ADR-567 Amd 2 item 6). M7-P3-2, below |

## Open items, now tracked

| ID | Severity | Summary | Evidence | Status |
|---|---|---|---|---|
| C0929-P2-relief-rough-3 (M7-P1-1) | **P1** (was P2) | Each relief is roughed alone, and out-of-bounds neighbours count as bottomless. Two reliefs 1 mm apart, on one layer or on two operations, cut 2.175 mm into each other at Z-1.5 and Z-3 with no warning. A single relief roughs 3.175 mm past its own edge into bare stock | **READ**: `compile-cnc-relief.ts:99`, `heightmap-tool-offset.ts:14`. M7 + refuter REPRO | fix card proposed |
| C0929-P2-control-1 (M7-P1-2) | P2 (KNOWN; lowered from P1) | On a homed router, a park height that fits the Z travel can still lift Z past its top. Example: park 50 on a 75 mm travel with Z zero 40 mm below the top. No check reads the live work offset. ADR-491 Amd 1 item 3 lists it as a follow-up, with no owner | M7 + refuter REPRO | fix card proposed |
| C0924-CO-3 (M7-P2-3) | P2 | CNC Job Origin anchors on the cutter's reach, not the design. A 0.5 mm V-bit engraving lands 6.35 mm in, against WORKFLOW's rule. The laser side was fixed by #1398 | M7 + refuter REPRO | fix card proposed |
| C0929-P2-preview-2, P2-review-3 (M7-P2-5) | P2 | The preview's park and retract moves differ from the program. Quick Nest spaces CNC parts 2 mm apart, closer than a typical bit | M7 + refuter REPRO | fix card proposed |
| C0924-MC-2 (M7-P2-1) | P2 | Touch-off seeks 25 mm without checking the probe circuit, so a forgotten clip drives the bit into the plate | **READ**: `grbl/probe.ts:72-74, :119`. M7 + refuter | fix card proposed |
| C0929-P2-toolpath-3 (M7-P2-2) | P2 | A closed shape stacked on its exact copy is not cut at all, and the stacked-copy warning skips CNC | M7 + refuter REPRO | fix card proposed |
| C0924-CO-2 (M7-P2-4) | P3 (lowered from P2) | On a CNC profile, the origin picker still invites the homing corner. That mirrors or turns the part, and Job Review says nothing | M7 + refuter | open, no card |
| C0925-CN PWM255 (M7-P3-2) | P3 | Because of the wrong clamp claim, the Marlin CNC export advisory names only G4 P and M0, not the spindle S that wraps | **READ**: `cnc-export-controller-advisory.ts:19-28` | open, no card |
| C1020-CS-05 copy (M7-P3-3) | P3 | On Marlin, the Reset-origin tooltip and toast say `G92.1`, but the app sends a G92 machine-frame restore. `clearOrigin: 'G92.1'` has no reader | **READ**: `OriginRow.tsx:113, :265`; `marlin/driver.ts:81` | open, no card |

## Open items with no owner (M7-P3-4)

These are still true on main and have no fix card, ADR decision or ledger row. Only F-4 (ADR-648 Consequences) and D-4/P-4 (ADR-375 Amd 4) are named in an ADR.

| ID | Summary | Where | Needs |
|---|---|---|---|
| C1019-F-4 | The automatic settings read needs Idle; an Alarm boot reads "Controller reset detected…" | `machine-settings-read-readiness.ts:54-56` | fix |
| C1019-F-6 | Disconnect always sends Ctrl-X | `laser-disconnect-stop.ts:59-70` | maintainer decision (ADR-212). The 10-19 and 10-20 audits disagree on whether LightBurn's reconnect resets the board, so re-fetch that source first |
| C1019-F-7 | One owed reply makes the app recommend Reconnect | `controller-recovery-status.ts:46` | fix |
| C1019-F-8 | Port grants match stored identity only | `electron/serial-port-grants.ts:109` | fix or accept |
| C1019-F-10 | The worker handshake is 2 s | `worker-serial-connection.ts:55` | verify |
| C1020-D-1 | An owned Abort on GRBL-family resets at once (ALARM:3 after every Abort) | `laser-job-stop.ts:258` | maintainer decision |
| C1020-D-2 | One lost reply can stall a job sent one line at a time | `laser-lost-ack-reconcile.ts:205` | maintainer decision |
| C1020-P-2 | Any `error:N` during a job resets the controller, with no Resume | `laser-error-line.ts:207-237` | maintainer decision |
| C1020-D-3 | Marlin job lines carry no `N` line number or checksum, so a `Resend:` ends the job | `streamer.ts:62` (ADR-095) | fix or accept |
| C1020-D-6 | `$C` check mode is a Console command only, so external programs are never vetted | `grbl/console-command.ts:55` | fix or accept |
| C1020-D-7 | There's no "Home when connected" option, so every connect to a homing machine stops at the Alarm banner | — | fix or accept |
| C1020-P-3 | Jog steps cannot queue while a jog runs | — | fix or accept |
| C1020-D-4 / P-4 | grblHAL is never asked `$I` or `0x87` | `grblhal/driver.ts:86-88` (ADR-375 Amd 4) | ADR-tracked |
| CS-02 (07-26) | The handshake never reads `$N` startup blocks, so a reset-based stop can run startup lines nobody checked | 10-20 design audit §4 | fix or accept |
| CS-04 (July) | Marlin M114 is reported as `Idle` | `marlin/response.ts:130` | fix or accept |

## Status unknown

These never appear in a later round and were not re-run: C0924-TP-3, C0924-CO-4, C0929-P2-relief-rough-2, C0929-P2-relief-finish-4, C0929-P2-gcode-2, C0929-WA-1 and C0929-P2-advcam-3. The 2026-09-25 hardware follow-ups were not re-run either: "Decisions to review" items 1, 2 and 4, and HF-1. No hardware was operated.
