# Frame and completed-job lifecycle audit

Baseline: `d02cfb112a2628396bfddb605f0729851484d596`, the source of Windows desktop 1.0.6.
Audit and repairs use an isolated checkout; unrelated primary-checkout changes are preserved.

The user's exact physical incident is not established: no controller model, affected project or
installed app version was supplied. Ordinary clean completion did not reproduce incorrect new-job
motion in the controller harness. The audit did reproduce the ten defects below.
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
| P2: a completed preview/time badge survives a different job | Open another nonempty document while G-code hides the 2D workspace, or when replacement idle-marker compilation yields no plan. The previous Complete badge and route remain. | Capture the semantic document context while active and retire only the finished display after execution inputs change, independently of canvas mounting or successful marker preparation. Display cleanup runs after the original settlement notification reaches recovery observers; an integration regression proved that synchronous nested cleanup could otherwise lose the completion receipt and second-pass offer. A replacement execution cannot be retired by the pending cleanup. |
| P3: exact Frame uses deferred-outline status text | Prepare an exact program and dispatch its real Frame. Status incorrectly says the exact job is still being prepared. | Read the actual motion candidate's deferred marker. Cancellation text also avoids claiming no commands were sent after controller setup. |
| P2: mixed artwork Power scale cannot accept 100 | Select artwork with different power scales, clear the Mixed field, then type `100`. The field stays blank and the value is never applied because a hidden baseline of 100 suppresses the commit. | Use the existing nullable mixed-value draft handler. An explicit 100 displays, commits to the selected artwork and persists in Save As. |
| P2: a reduced live power override can carry into the next burn | Cache an `Ov:100,100,100` report, send spindle decrease, then receive a fresh Idle without the intermittent Ov field. Start assumes its cached 100 is current and omits the spindle reset. A newly requested report can also show pre-application 100; coalescing decrease and reset flags leaves actual power at 90%. | Retire old Ov at admitted dispatch, process pending flags through an owned acknowledged boundary, and reset the supported channel unconditionally before its executable window. No percentage is guessed from a command or its write completion. |
| P2: low-power Fire can exceed its capped command | Admit a spindle increase before Fire. The actual-store flag-order oracle produces a pre-application Ov100 report or coalesces increase with reset; nominal Fire S20 becomes effective S22. | Process prior flags through an owned acknowledged boundary, then send a standalone spindle reset before capped Fire-on. Press/release and controller-session ownership fence every continuation. |
| P2: a reset-only Start can replace recovery without transmitting a program | Reject the standalone override reset before the first program window. Sealed recovery replaces the source with a new write-failed capsule at zero program acknowledgements; manual recovery retires its old capsule and leaves its checkpoint marked in flight. Abort during a held reset sends no program but previously returned successful Start. The same reset/return/error classification paths exist at the published baseline, where reduced or unknown Ov enabled the reset. | Distinguish known pre-program failure or cancellation from a genuinely attempted program prefix. Preserve the old recovery source and restore only the attempt's owned checkpoint marker for reset-only failures; retain uncertain transmission and quarantine when an actual program write is attempted. |

## Maintainer-requested Frame policy

[ADR-565](../decisions/ADR-565-frame-remains-valid-for-unchanged-placement.md) records the
explicit request to retain a completed Frame while changing power and speed or repeating a job
at unchanged placement. The reusable proof describes physical coordinates; each Start separately
prepares, reviews and claims the current exact executable program. Move, resize, origin,
registration or controller-session changes invalidate the proof. A speed edit which changes scan
runway coordinates changes the physical footprint and requires another Frame. This is a policy
change requested by the maintainer, separate from the reproduced defects.

[ADR-355 Amendment 1](../decisions/ADR-355-amendment-1-acknowledged-override-baseline.md)
records the override timing correction while preserving the existing Start baseline and Fire cap.

## Scenario checklist

- Clean completion requires the driver drain marker and two fresh Idle reports before the next Frame.
- Acknowledged lines or a single premature Idle cannot release a moving job.
- The next Frame uses current geometry and the settled return point. An unchanged job can retain
  its finished preview until the operator clears it.
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
- Ordinary power/speed edits and unchanged-placement repeat runs retain the completed spatial Frame;
  each Start sends newly reviewed S/F values and claims its own exact artifact.
- Coordinate-neutral device edits retain Frame while fresh review updates S-value scales, air/travel
  commands, timing estimates and no-go warnings. Acceleration and scanning geometry remain spatial
  inputs; the actual newly prepared envelope is checked before every Start.
- Stale display cleanup preserves a clean completion receipt and ignores replacement executions.
- Admitted live override commands retire old Ov data; refused dispatch leaves it intact and late
  completion cannot overwrite a fresh report or another controller session.
- Before new laser output or Fire, the actual-store oracle covers omitted Ov, pre-application
  Ov100 and coalesced reset/adjustment flags. An owned queued acknowledgement separates flag
  batches; ongoing-job override controls retain their established behavior.
- Reset-only refusal or cancellation cannot report accepted output, replace a sealed recovery
  source or strand a manual checkpoint in flight. Actual program-prefix rejection, including a
  connection close before rejection, keeps its established uncertainty record and containment.

Each item is backed by focused regression files and the applicable existing controller/UI suites.
At the initial repair head `a99f7805787428dde4ecce8b6a04fd7d0a483038`, before the new Frame policy
and live-power fix:

- The integrated CNC/completion/settings slice passed 175 tests across six files. Its independent
  stock-GRBL float32/planner and quantization slice passed 87 cases.
- Mixed-input and shared draft regressions passed 58 tests across five files.
- Ten real Chromium app scenarios passed: five finish/Frame/controller flows and five native
  clear-and-retype/settings/persistence flows.
- Type checking, E2E type checking/discovery and the targeted lint/format checks passed.

That initial head did not pass all hosted browser checks. The completion-display integration
regression described above was repaired with deferred retirement. During the expanded reusable-Frame
integration, the existing second-pass cancellation regression also failed: review replaced the
immutable permit object, so its Cancel/Edit handler could revoke the original object while the
replacement remained armed. Transient review now keeps the original current/readiness-validated
permit and refuses a replacement prepared object. The original durable-handoff cancellation,
immutable archive and no-program-write assertions pass. Ordinary Start still creates the exact
permit for its freshly reviewed program. These are integration repairs, not additional findings
at the published 1.0.6 baseline.

The complete integration suite also exposed a Current Position replay regression: after moving the
head and completing a new Frame, review incorrectly reapplied the completed run's old origin and
fingerprint. Review now follows the newly framed placement. Replay still rechecks the completed
job's execution inputs after review, before claiming or recording a Start. A power edit during
replay review refuses the replay and preserves the spatial Frame for ordinary Start; the original
moved-head replay and provenance assertions remain unchanged.

The expanded focused checks include:

- 93 spatial identity, process edit, repeat, review and UI cases across eight files.
- 73 live-power Start/Fire/fresh-status cases, including the independent realtime flag-order oracle.
- 42 ordinary/transient Start boundary cases and two immutable prepared-object refusal cases.
- 13 completion-during-Start and unknown-laser-mode review cases. Their fixtures acknowledge only
  the owned Start control prefix; program, later settlement and replacement-owner assertions remain.
- 14 terminal display/recovery notification cases proving that cleanup preserves the completed receipt.
- 81 Start/power/recovery boundary cases, including ten reset-only failure, cancellation and
  owned-record regressions. Existing program-prefix, connection-close, hosted-arm and replacement
  uncertainty scenarios retain their original protection.
- Twelve real Chromium Frame/process-setting and next-job scenarios, including the actual Machine
  Setup save, latest emitted S/F values, retained Frame and coordinate invalidation.
- Twenty-one recovery browser scenarios passed across the main run and the focused rerun of the
  unchanged-placement repeat case. Their control acknowledgements are counted separately from
  streamed program progress.
- Eight completion, Workbench and recovery browser scenarios passed across the six-case run and
  two focused recovery reruns. The two recovery fixtures initially withheld the new control-fence
  acknowledgement while waiting for a later periodic status query, correctly causing a timeout
  before any program was sent. They now answer the actual held control fence first. These recovery
  paths are separate from ordinary Start's final fresh-status qualification.
- E2E type checking and scoped lint/format checks passed after those fixture corrections.
- The complete suite exposed eight affected fixture/replay files, with 21 failing cases. Besides
  the Current Position replay repair, the fixtures now acknowledge only the actual Start control
  fence and advance simulated time through that acknowledgement. Their existing program,
  Pause/Resume, recovery, advisory and no-wire assertions remain intact. The integrated 13-file
  slice passed 67 cases; the three Current Position replay cases also passed after checking that
  a changed-job refusal produces one warning.
- The final focused Chromium rerun passed the unchanged-placement edited burn/replay and dense
  Sharp trace after Home with a nonzero work offset. The trace fixture uses the current readiness
  text and independently asserts that Start is enabled; geometry, worker, repeated-click and
  no-coordinate-reset assertions remain unchanged. E2E type checking passed with the same files.

Initial focused checks must not be reported as final release qualification. Controller fixtures
explicitly distinguish the newly acknowledged Start control fence from program and completion
acknowledgements; the complete suite remains the integration check for those fixture changes.

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
- [LightBurn S-value maximum](https://docs.lightburnsoftware.com/latest/Reference/DeviceSettings/BasicSettings/#s-value-max): the configured scale for 100% must match the controller's maximum S value.
- [GRBL laser mode](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Laser-Mode): dynamic M4 power varies with actual versus programmed motion speed; M3 and M4 remain the user's selected output modes.
- [GRBL realtime protocol](https://github.com/gnea/grbl/blob/master/grbl/protocol.c): spindle overrides multiply programmed S, and status reports are observations rather than acknowledgements for individual realtime bytes.

The output audit covers Line, Fill and Image jobs, S-value maxima 255, 1000 and 10000,
artwork scale and scoped overrides, project round trips and explicit Constant/Dynamic modes.
Commanded 100% is not a measurement of emitted optical power. A scale mismatch, reduced override,
M4 motion scaling or a physical laser issue can have different causes; the user's machine model
and incident settings have not been supplied.

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
