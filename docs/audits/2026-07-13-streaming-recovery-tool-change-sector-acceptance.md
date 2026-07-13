# KerfDesk Streaming, Pause, Recovery, and Tool-Change Sector Acceptance

**Date:** 2026-07-13

**Baseline:** 2026-07-11 competitive audit, shipped sector score **7.5/10**

**Candidate stack:** PR #58 through PR #89 + `codex/streaming-recovery-9-acceptance`

**Status:** Software candidate complete; local full release gate passed; not yet shipped on `main`

## Verdict

The stacked candidate earns **9.1/10** after the exact full release gate passed. It now has
controller-aware pause, resume, stop, alarm, and disconnect handling; durable laser checkpoints;
fingerprint-verified laser replay; explicit refusal of unsupervised CNC restart; and a guarded
multi-bit tool-change sequence that cannot restart the spindle until fresh Idle and work-Z evidence
exist.

This is a software acceptance score. It does not replace fault injection on physical controllers,
measurement of buffered motion after a cable loss, or supervised multi-bit cuts on representative
CNC hardware.

## Competitive Boundary

LightBurn exposes Start, Pause/Resume, and permanent Stop as the primary live-job controls and
explicitly warns that software Stop is not a substitute for physical emergency stop or power
cutoff: [Job Control](https://docs.lightburnsoftware.com/latest/GetStarted/JobControl/) and
[Laser Window](https://docs.lightburnsoftware.com/latest/Reference/LaserWindow/). Rayforge likewise
exposes pause and stop during a job and defines driver-level hold, cancel, connection, and status
contracts: [Quick Start](https://rayforge.org/docs/getting-started/quick-start/) and
[Driver Development](https://rayforge.org/docs/developer/driver/).

KerfDesk's acceptance target is deterministic streaming and fail-closed recovery for GRBL-family,
Marlin, and Smoothieware controllers plus supervised GRBL CNC tool changes. It does not claim DSP
controller file queues, vendor cloud recovery, universal firmware restart semantics, or automatic
CNC crash recovery.

## Evidence

| Capability | Candidate evidence | Result |
| --- | --- | --- |
| Controller-aware streaming | Character-counted and simple acknowledgement modes enforce RX limits, preserve send order, ignore comments, and fail on rejected commands | Accepted |
| Pause and resume | GRBL uses realtime hold/resume; controllers without realtime hold pause stream-side and explain that buffered motion may finish | Accepted |
| Stop and hard-off | Stop aborts the stream, sends controller reset/abort as supported, and forces laser/spindle-off handling; the UI directs unsafe conditions to physical E-stop | Accepted |
| Alarm handling | Controller alarms end active work, preserve the reason, invalidate position trust, and require explicit recovery before Start becomes available | Accepted |
| Durable progress | Versioned checkpoints persist the deterministic G-code fingerprint, resolved output scope/origin, acknowledged sendable-line count, and interruption cause | Accepted |
| Checkpoint lifecycle | Progress is monotonic; records survive stop, errors, disconnects, and crashes; only completed work followed by connected physical Idle clears the checkpoint | Accepted |
| Browser cable fault | Chromium starts a real streamed job through fake Web Serial, acknowledges one line, dispatches the native `disconnect` event, and verifies the USB-loss warning and interrupted-job checkpoint | Accepted |
| Laser recovery | Recovery recompiles the project, requires an identical fingerprint and resolved origin, positions with the beam off, and replays from the first unconfirmed sendable line | Accepted |
| CNC recovery refusal | CNC checkpoints remain diagnostic evidence only; automatic checkpoint and arbitrary line restart are rejected before motion because acknowledgements do not prove physical cutting or clearance | Accepted |
| Multi-bit output | Tool transitions retract, stop the spindle, park, identify the next bit, pause with `M0`, and invalidate tracked Z after manual touch-off | Accepted |
| Tool-change continuation | Continue remains disabled until fresh controller Idle and work-Z proof exist; resumed output first raises the cutter to safe Z with the spindle off, then starts and dwells the spindle | Accepted |
| Controller lifecycle corpus | GRBL, Marlin, and Smoothieware simulator suites cover connect, status, pause behavior, alarms, reset, disconnect, and teardown paths | Accepted |
| Operational browser workflow | Chromium proves frame, start, pause, resume, stop, alarm, homing recovery, and independent jog/origin controls in the built application | Accepted |

## Verification

- TypeScript: passed.
- Targeted ESLint: passed with no warnings or errors.
- Focused sector battery: **16 files, 144 tests passed**.
- Chromium acceptance: **20 workflows passed**, including frame/pause/resume/stop/alarm/home and
  the new cable-disconnect checkpoint workflow.
- Full repository release gate: `pnpm release:check` passed in **9m50s**, including repository
  guards, formatting, licenses, dependency audit, the complete product test suite, 20 Chromium
  workflows, web build, Electron main build, and both file-size policies.

## Why 9.1

The candidate closes the software-level gaps behind the baseline 7.5: interruption causes are
durable and visible, recovery decisions are machine-kind specific, laser replay is tied to exact
compiled bytes and placement, unsafe CNC automation is refused, and tool changes enforce both
machine-state and cutter-clearance prerequisites. Browser evidence now crosses the real Web Serial
disconnect listener instead of directly mutating application state.

The score remains below a perfect result because USB adapters and firmware vary, controller
acknowledgements are not proof of physical execution, buffered motion after link loss depends on
hardware, power-loss behavior is controller-specific, and supervised CNC recovery and tool changes
still need representative physical-machine campaigns.

## Score Boundary

- **Shipped `main`: 7.5/10** until the stacked candidate merges and the acceptance suite passes on
  the resulting `main` revision.
- **Stacked software candidate: 9.1/10** with the local full release gate passed.
- Physical disconnect, reset, E-stop, laser restart, and CNC tool-change campaigns remain separate
  hardware acceptance work.
