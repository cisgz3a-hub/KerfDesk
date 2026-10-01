# Frame and completed-job lifecycle audit

Baseline: `d02cfb112a2628396bfddb605f0729851484d596`, the source of Windows desktop 1.0.6.
Audit and repairs use an isolated checkout; unrelated primary-checkout changes are preserved.

The user's exact physical incident is not established: no controller model, affected project or
installed app version was supplied. Ordinary clean completion did not reproduce incorrect new-job
motion in the controller harness. The audit did reproduce the seven defects below.
The user's specific blank-input field was not identified. The independently reproduced numeric
defect concerns mixed artwork Power scale; ordinary power/speed/size/position clear-and-retype
scenarios did not reproduce a general input lock.

## Confirmed findings and repairs

| Finding | Reproduction | Repair |
| --- | --- | --- |
| P1: Smoothieware inch reports change the next Frame's placement | A prior program moves to physical 254,127 mm and ends with G20. Firmware-derived inch reports contain 10,5. A new Current Position Frame returns to 10,5 mm instead of 254,127 mm. | An owned G21 acknowledgement and fresh complete same-session Idle report precede coordinate capture. Old raw status/WCO is discarded; Frame's modal push now captures millimetres. |
| P2: CNC Frame rejects its own Z return | Zero stock-top Z, jog below Z0, then Frame. Motion remains at safe Z, but unchanged pre/post XYZ comparison refuses the permit. Independently rounded inch reports also cause a nonnegative Z restore to change by one physical step and then fail completion. | Carry the actual three-decimal dispatched safe-Z park or restore target through all owned legs. Current-session `$102` supplies the whole-step budget; float32/report rounding is accounted for. Without observed resolution, owned dispatch and settlement remain authoritative. XY/setup comparisons and later Start's actual completed XYZ remain unchanged. |
| P2: an obsolete completion callback recreates an Idle waiter after reboot | Final marker `ok` immediately followed by a GRBL reboot banner, through the actual receive pipeline, leaves a waiter belonging to the retired session. | Bind all settle continuations to operation, controller/transport, stream and run owners before phase changes, waiting, completion or failure cleanup. |
| P2: a failed settle marker later appears Complete | Reject the post-job marker with `error:33`, then report Idle. Transport correctly releases, but the generic Idle fallback changes unavailable timing to Complete. | Only successful owned settlement promotes completion timing. Failure stays unavailable while later Idle can release transport for the next Frame. |
| P2: a completed preview/time badge survives a different job | Open another nonempty document while G-code hides the 2D workspace, or when replacement idle-marker compilation yields no plan. The previous Complete badge and route remain. | Capture the semantic document context while active and retire only the finished display after execution inputs change, independently of canvas mounting or successful marker preparation. |
| P3: exact Frame uses deferred-outline status text | Prepare an exact program and dispatch its real Frame. Status incorrectly says the exact job is still being prepared. | Read the actual motion candidate's deferred marker. Cancellation text also avoids claiming no commands were sent after controller setup. |
| P2: mixed artwork Power scale cannot accept 100 | Select artwork with different power scales, clear the Mixed field, then type `100`. The field stays blank and the value is never applied because a hidden baseline of 100 suppresses the commit. | Use the existing nullable mixed-value draft handler. An explicit 100 displays, commits to the selected artwork and persists in Save As. |

## Scenario checklist

- Clean completion requires the driver drain marker and two fresh Idle reports before the next Frame.
- Acknowledged lines or a single premature Idle cannot release a moving job.
- The next Frame uses current geometry and the settled return point, with the old finished preview retained.
- New canvas, Open and edited artwork prepare current bounds without requiring Done.
- Done clears display only; history, artwork, controller coordinates and Frame policy remain intact.
- Repeated Frame clicks share the current owner; retired workers and late previous replies cannot replace a new motion or permit.
- Exact and deferred preparation retain their separate completion/permit rules.
- Current Position, User Origin and Absolute placement cover nonzero work offsets and report-unit conversions.
- GRBL-family, Marlin and Smoothieware paths use their driver-owned motion and drain commands.
- CNC negative, zero, positive and above-safe-Z starts preserve the stock-clearance contract.
- CNC commanded Z is compared within observed whole-step/report resolution; values outside that
  budget, XY movement, origin drift and later moved Start are refused by the relevant checks.
- Missing or stale Z-resolution evidence does not introduce a new Frame policy gate.
- Mixed Power scale accepts explicit 100, preserves blank/incomplete drafts and commits only to
  the captured selection; ordinary layer/toolbar/machine fields cover native keyboard retyping.
- Marker rejection, silence, cancellation, reboot and replacement-owner cleanup preserve the new session.
- Finished overlays clear on document changes with G-code visible or idle planning unavailable.
- Same-job selection, notes and machine-label edits retain completion; active and interrupted runs retain their established presentation.
- Pointer and trailing-status updates do not repeatedly calculate document signatures.
- Full renderer scenarios finish a job, modify/open artwork, Frame the new bounds, review Start, run and finish again.

Each item is backed by focused regression files and the applicable existing controller/UI suites.
At the final local source state:

- The integrated CNC/completion/settings slice passed 175 tests across six files. Its independent
  stock-GRBL float32/planner and quantization slice passed 87 cases.
- Mixed-input and shared draft regressions passed 58 tests across five files.
- Ten real Chromium app scenarios passed: five finish/Frame/controller flows and five native
  clear-and-retype/settings/persistence flows.
- Type checking, E2E type checking/discovery and the targeted lint/format checks passed.

The complete release gate, exact PR/main checks and hosted Windows installer qualification are
separate publication requirements. Their results must be taken from the corresponding release
evidence, not inferred from these controller/browser results.

## Research basis

- [GRBL interface](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface): acknowledgement is distinct from planner completion; WPos = MPos - WCO, with `$13` applying to position and WCO values.
- [GRBL jogging](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Jogging): explicit G90/G21 overrides each `$J` command without modifying the parser's modal state, and cancellation needs a causal synchronization boundary.
- [GRBL planner](https://github.com/gnea/grbl/blob/master/grbl/planner.c): absolute targets are rounded to whole steps using the configured steps/mm.
- [GRBL printing](https://github.com/gnea/grbl/blob/master/grbl/print.c) and [unit constant](https://github.com/gnea/grbl/blob/master/grbl/nuts_bolts.h): position formatting uses float32 arithmetic and a finite inch-conversion constant. An independent oracle covers step-derived positions and intermediate rounding rather than JavaScript `toFixed` alone.
- [Marlin M400](https://marlinfw.org/docs/gcode/M400.html): the drain command waits for all planner moves to finish.
- [Smoothieware Kernel](https://github.com/Smoothieware/Smoothieware/blob/edge/src/libs/Kernel.cpp): Idle and running MPos/WPos use `Robot::from_millimeters`.
- [Smoothieware Robot](https://github.com/Smoothieware/Smoothieware/blob/edge/src/modules/robot/Robot.cpp): G20/G21 changes inch mode; M120/M121 saves/restores it.

The Smoothieware reproduction adds the upstream unit-report and modal-stack rules missing from the
existing simulator. It is an independent protocol oracle, not a claim that every firmware build is
qualified. GRBL, grblHAL and FluidNC driver-selection cases share the GRBL-family simulator; native
firmware-specific behavior is a separate qualification boundary.

## Limits

No physical machine, laser, spindle, camera or material was operated. Browser scenarios use fake
Web Serial to verify the real renderer and wire commands, not physical motion. Hosted Windows
installer/native smoke checks prove packaging and upgrade behavior separately from controller tests.
Neither green CI nor publication establishes hardware qualification or identifies the user's exact
physical failure without the affected controller/project.

Rounded reports cannot distinguish every displacement inside their precision interval. Unknown Z
resolution is not presented as numerical target verification. The completed actual position stays
the Start reference, including after controller precision or missing-setting fallback. This is
software evidence for the audited protocol models, not a physical accuracy or stock-clearance
certification.
