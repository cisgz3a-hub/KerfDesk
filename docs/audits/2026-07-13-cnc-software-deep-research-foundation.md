> **Historical research archive: 11–13 July 2026.** Published on 6 September 2026.
> Findings, scores, source claims and proposed changes below describe their recorded
> baseline; they have not been revalidated and are not current product or qualification
> evidence. Unimplemented proposals are not adopted policy. The current
> [Frame-first contract](../../PROJECT.md) governs application behaviour. See the
> [archive index](2026-09-06-preserved-audits.md) and [source manifest](2026-09-06-preserved-audits-source-manifest.json).

# CNC Software Deep Research Foundation

**Date:** 2026-07-13
**Status:** Living research dossier, tranche 1
**Product mapped:** KerfDesk / LaserForge 2.0 snapshot in `audit-current-main`
**Primary worked problem:** safe continuation after an interrupted CNC job

## Executive conclusion

CNC software is not one program and G-code is not the whole system. A credible CNC product is a chain of independently stateful systems:

1. design and manufacturing intent;
2. CAM operations and toolpath generation;
3. post-processing into a controller-specific program;
4. an interpreter and its modal state;
5. a sender and transport buffers;
6. a controller motion planner;
7. step generation or servo control;
8. spindle, coolant, tool, probe, clamp, door, and safety I/O;
9. the actual physical machine, fixture, stock, and cutter.

Most dangerous recovery bugs come from treating one layer's state as proof of another. A sender knowing that GRBL acknowledged line 8 does not prove the machine physically completed line 8. Reconstructing G-code modal state does not prove the correct tool is loaded, the work offset survived, the axes are referenced, the cutter is clear, or a clamp-free approach path exists.

The first concrete finding is therefore a **P0 CNC recovery defect** in the current snapshot: the implementation offers a checkpoint-driven restart using acknowledged GRBL lines as the resume index and can emit spindle start while a cutter may still be buried. The correct response is not merely to swap two G-code lines. Automatic CNC checkpoint resume should be disabled until the product has execution-fenced safe checkpoints, hard reference/work-zero/tool gates, a supervised clearance/extraction phase, and a geometry-aware re-entry plan.

## 1. Correcting the motivating example

The motivating statement was approximately: “a CNC machine should have motion before starting the spindle, otherwise the bit can get stuck.” That identifies a real hazard but the general rule needs refinement.

For a router or mill, the normal safe sequence is:

1. establish that the cutter is clear of stock and fixtures;
2. move to a verified clearance position if it is safe to do so;
3. command the spindle at the required direction and RPM;
4. wait for an actual at-speed signal when the hardware supports it, or use a validated conservative delay when it does not;
5. start the cutting entry move using a suitable plunge, ramp, helix, or existing lead-in;
6. enter the unfinished path with the correct feed, compensation, coolant, tool, and work offset active.

The spindle will normally be stationary in XYZ while it accelerates. That is not itself unsafe. The unsafe state is **starting or moving a cutter whose physical engagement state is not known**.

If power, the controller, the spindle, or the sender stopped while the cutter was buried, both naive choices can be hazardous:

- starting the spindle under load can stall, grab, burn, loosen, or break the cutter;
- retracting or moving a stopped cutter through material can snap it, pull the workpiece, lose steps, or damage the spindle.

That condition requires an explicit operator-guided recovery state. It must not share the ordinary Cycle Start or feed-hold Resume path.

Laser semantics are different: travel must occur with energy off, and energy should be enabled at or on the marking motion. Plasma differs again: torch height, arc establishment, pierce timing, kerf re-entry, and THC state are part of restart. A single generic “spindle/laser power” resume algorithm is therefore structurally unsafe.

## 2. Four different operations that products often call “resume”

| Operation | Controller continuity | Position confidence | Correct product behavior |
|---|---:|---:|---|
| Feed hold / Cycle Start | Controller and planner remain alive | Normally retained | Pause new execution, preserve modal and physical state, then continue the same queue. Do not rebuild the program. |
| Program stop / tool check / door pause | Controller remains alive but auxiliaries or axes may change | Conditional | Record what changed, restore axes in a controlled order, restore spindle/coolant/tool state, then continue. |
| Sender/app disconnect while controller remains alive | Controller may keep executing buffered motion | Ambiguous without a synchronization fence | Reconnect and reconcile controller state. Never equate the last host acknowledgement with the executed block. |
| Reset, alarm, E-stop, controller power loss, or axis stall | Planner is lost; reference and offsets may be invalid | Lost or suspect | Enter recovery mode: inspect, reference/home as required, re-establish work/tool offsets, select a safe restart boundary, stage the approach, and require operator confirmation. |

The fourth case is not “resume.” It is **restart and re-entry**.

For legacy GRBL, an ordinary live pause should use the controller's retained state: stop host transmission, send realtime feed hold `!`, wait for `Hold:0` (deceleration complete), then resume with `~`. Mill-mode feed hold deliberately leaves the spindle and coolant on, avoiding an automatic spindle stop while the cutter may remain engaged. If accessories must stop, GRBL's safety-door/parking flow is the closer model: controlled deceleration, retract/park, accessory stop, then accessory restore with delays and return motion. A sender-generated `M5` is not equivalent. Sources: [GRBL realtime commands](https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md) and [GRBL parking configuration](https://github.com/gnea/grbl/blob/master/grbl/config.h).

## 3. The state model a CNC product needs

### 3.1 Program artifact state

- exact source project revision;
- exact posted G-code bytes and post-processor identity/version;
- machine definition and kinematics;
- operation, setup, stock, fixture, and tool-library revisions;
- selected WCS and setup origin;
- manufacturing order and dependencies between operations.

### 3.2 Interpreter/modal state

At minimum, restart analysis must understand more than G20/G21, G90/G91, M3/M4/M5, F, S, and XYZ:

- active motion mode and plane;
- units and distance mode;
- arc-center mode;
- feed mode, including units/minute, inverse time, and units/revolution;
- coordinate system selection and temporary offsets;
- tool selection, tool-length compensation, and cutter compensation;
- path-control mode;
- canned cycles, cycle return mode, and active subroutine/call context;
- spindle direction/speed and CSS where applicable;
- coolant, mist, air, vacuum, and auxiliary outputs;
- scaling, rotation, mirroring, polar/cylindrical transforms, and kinematic transforms;
- lathe diameter/radius mode and spindle synchronization;
- controller/vendor extensions and macro variables.

The NIST RS274/NGC interpreter report is the foundational public language reference: [NISTIR 6556](https://www.nist.gov/publications/nist-rs274ngs-interpreter-version-3).

### 3.3 Sender/transport state

- source line versus normalized/sendable line identity;
- bytes in the operating-system and USB/serial layers;
- controller RX-buffer admission;
- lines parsed and accepted;
- blocks in the look-ahead planner;
- execution watermark, if one exists;
- outstanding realtime commands;
- error/alarm ownership and cancellation semantics.

GRBL's documented `ok` means a line was accepted and either executed or scheduled. Its parser state can be ahead of the motion physically being executed. GRBL also has a separate look-ahead planner buffer. The official interface documentation is explicit about this distinction: [GRBL v1.1 interface](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md).

### 3.4 Controller state

- referenced/homed axes and position-valid flags;
- machine position, work position, and WCO;
- planner and segment buffers;
- active override values;
- limit, probe, door, E-stop, and drive-fault inputs;
- spindle command, measured RPM, and at-speed state;
- motion mode: idle, run, hold, jog, home, alarm, sleep, door, tool change;
- tool changer, coolant, vacuum, clamp, and auxiliary state.

### 3.5 Physical truth

This is the final authority and cannot always be inferred from software:

- where every axis physically is;
- whether an open-loop stepper lost motion;
- whether the workpiece or fixture moved;
- whether the correct tool is installed, intact, and measured;
- whether the cutter is engaged in material;
- whether the spindle is rotating at the requested speed;
- whether clamps, dust shoe, probe, or loose stock occupy the planned path;
- what material has already been removed;
- whether a previous cut created a safe lead-in or an unsafe slot wall;
- whether the machine has enough clearance to execute the synthetic approach.

The core design rule is: **software may make a recovery decision only from the weakest confidence level that affects it.** A correct modal replay cannot upgrade unknown physical truth into a safe state.

## 4. What strong products and controllers actually do

### 4.1 Tormach PathPilot

PathPilot does not present mid-program restart as one generic action. It offers distinct lead-in choices:

- no preparation, explicitly not recommended partway through a cut;
- restore with a linear lead-in from an operator-selected current position;
- restore with a Z-plunge lead-in via G30 clearance.

It also requires machine referencing after power-on, E-stop, collision, or axis stall/fault. This is important: semantic program restoration is downstream of physical reference restoration, not a substitute for it. Source: [PathPilot tools and features](https://knowledgebase.tormach.com/24r/pathpilot-tools-and-features-24r).

### 4.2 MASSO

MASSO's Jump to Line workflow instructs the operator to home after power-off, E-stop, or position loss; select a point a few lines before the stop; process the earlier program; review calculated parameters; and confirm staged axis moves with Cycle Start. It warns against jumping into active cutter compensation. Source: [MASSO Resuming Program or Jump to Line](https://docs.masso.com.au/getting-started-guides/machining-with-masso/resuming-program-or-jump-to-line).

Its plasma-specific recovery is even more revealing: the torch can travel along the prior cut path with the torch off and reignite at a chosen resume point. That is a process-specific recovery plan, not a universal line-replay algorithm. Source: [MASSO Plasma-Cut Resume](https://docs.masso.com.au/wiring-and-setup/plasma-cut-resume).

### 4.3 Haas

Haas Setting 36 scans the preceding program to reconstruct tools, offsets, G/M codes, and axis positions before restart. It refuses a restart point where cutter compensation is active and requires starting before G41/G42 or after G40. Source: [Haas Setting 36 — Program Restart](https://www.haascnc.com/service/codes-settings.type%3Dsetting.machine%3Dmill.value%3DS36.html).

### 4.4 Siemens SINUMERIK

SINUMERIK distinguishes block search with calculation, with approach, without calculation, and program-test search. The modes differ in whether program state is calculated, auxiliary functions are emitted, and the contour is approached. REPOS/manual positioning and multiple Cycle Start confirmations are part of the workflow. “Without calculation” requires all needed state to be programmed from the target block. Sources: [SINUMERIK milling operating manual](https://support.industry.siemens.com/cs/attachments/64895700/BHFsl_0212_en_en-US.pdf) and [turning manual](https://cache.industry.siemens.com/dl/files/681/109763681/att_972859/v1/808D_ADV_turning_op_man_1218_en-US.pdf).

### 4.5 Mach4

Mach4's Run From Here asks the operator to jog near the desired start, presents distance-to-go, provides explicit axis moves to the start position, and scans the prior program to restore interpreter state. Source: [Mach4 Operation Manual](https://www.machsupport.com/wp-content/uploads/2014/05/Operation%20Manual.pdf).

### 4.6 Universal Gcode Sender

UGS implements restart as a G-code processor, not merely a line slice. It parses skipped lines to reconstruct modal state; computes a skipped-region clearance; creates an approach to the prior endpoint; restores spindle/coolant/feed; plunges under feed; and only then appends the selected command. Source anchors are `ugs-core/.../gcode/processors/RunFromProcessor.java` and its tests in the [UGS repository](https://github.com/winder/Universal-G-Code-Sender).

UGS's approach is useful reference code, but it still cannot prove physical position, tool identity, engagement, fixtures, or workpiece state. Sender-side reconstruction remains one part of a larger recovery protocol.

## 5. Consensus architecture behind these workflows

The recurring pattern is:

```text
project/setup truth
        |
        v
CAM operations -> toolpaths -> simulation/verification -> post processor
                                                     |
                                                     v
                                         immutable NC program
                                                     |
                                                     v
operator workflow -> sender/task executive -> interpreter -> motion planner
       |                    |                   |             |
       |                    |                   |             v
       |                    |                   |       realtime motion/I/O
       |                    |                   |             |
       +-------------- safety and state reconciliation <-----+
                                                     |
                                                     v
                                             physical machine
```

LinuxCNC makes these boundaries unusually visible. The task/interpreter side is non-realtime, motion executes in a realtime context, and HAL connects control functions and hardware through typed pins/signals. The controller publishes motion status back across an explicit boundary. Source: [LinuxCNC code notes](https://www.linuxcnc.org/docs/html/code/code-notes.html).

GRBL compresses interpreter, planner, and step generation into firmware while a host sender owns file streaming and UX. That makes the host/controller boundary smaller but more hazardous to misunderstand: an `ok` is flow-control evidence, not a completed-motion receipt.

### 5.1 LinuxCNC: the reference control architecture

LinuxCNC is the highest-value public architecture to study because it exposes the separation between UI, task execution, language interpretation, motion, I/O, and hardware:

```text
UI / remote client
  -> NML command and status channels
  -> Task state machine
  -> RS274 interpreter
  -> canonical machining operations
  -> motion planner and I/O executor
  -> HAL components, pins, and signals
  -> drives, sensors, spindle, tool changer, and safety hardware
```

The Task executor does not assume that reading or interpreting a source block means it has physically executed. Canonical operations are dispatched through preconditions and postconditions such as motion queue availability/completion, I/O completion, dwell completion, tool-changer acknowledgement, spindle orientation, and spindle-at-speed. This is the architecture KerfDesk currently lacks at the sender/controller boundary. Source anchors: [Task executor](https://github.com/LinuxCNC/linuxcnc/blob/master/src/emc/task/emctaskmain.cc), [canonical commands](https://github.com/LinuxCNC/linuxcnc/blob/master/src/emc/task/emccanon.cc), [trajectory planner](https://github.com/LinuxCNC/linuxcnc/tree/master/src/emc/tp), [motion controller](https://github.com/LinuxCNC/linuxcnc/tree/master/src/emc/motion), and [interpreter](https://github.com/LinuxCNC/linuxcnc/tree/master/src/emc/rs274ngc).

LinuxCNC's UI documentation also treats run-from-line as a risky reconstruction feature. QtDragon warns that it does not start the spindle or confirm the tool; AXIS recommends caution and starting at a rapid segment. Sources: [QtDragon run from line](https://linuxcnc.org/docs/stable/html/gui/qtdragon.html#_run_from_line) and [AXIS](https://linuxcnc.org/docs/html/gui/axis.html).

### 5.2 Legacy GRBL: compact firmware with multiple state horizons

```text
serial ISR
  -> protocol line loop
  -> G-code parser and modal state
  -> look-ahead planner ring buffer
  -> step-segment preparation
  -> timer ISR and step pins
```

The parser can be at the target of a newly admitted command while physical motion is still executing an earlier block. The planner and segment buffers add further horizons. Source anchors: [protocol.c](https://github.com/gnea/grbl/blob/master/grbl/protocol.c), [gcode.c](https://github.com/gnea/grbl/blob/master/grbl/gcode.c), [planner.c](https://github.com/gnea/grbl/blob/master/grbl/planner.c), and [stepper.c](https://github.com/gnea/grbl/blob/master/grbl/stepper.c).

Normal mill-mode spindle/coolant changes synchronize the planner, but legacy GRBL has no general hardware spindle-at-speed input. A post must use an appropriate dwell unless external control guarantees at-speed. Laser mode intentionally changes synchronization and power behavior; it is not a minor option on the same milling sequence.

### 5.3 grblHAL and FluidNC: capabilities belong to the controller profile

grblHAL retains GRBL protocol compatibility while splitting a portable core from hardware drivers and plugins. Depending on the build it can add more axes, kinematics, ATC/manual tool change, modal save/restore, spindle-synchronized motion, SD execution, and spindle-at-speed timeout. These capabilities are driver/build dependent and must be negotiated, not inferred merely from the `grblHAL` name. Sources: [grblHAL core](https://github.com/grblHAL/core), [HAL contract](https://github.com/grblHAL/core/blob/master/hal.h), and [state machine](https://github.com/grblHAL/core/blob/master/state_machine.c).

FluidNC models an ESP32 machine as a YAML-configured graph of kinematics, motors, pins, spindles, VFDs, and tool changers, with serial/network/file job sources. On-controller files remove some host-streaming uncertainty, but a file cursor is still not a durable physical checkpoint. Sources: [FluidNC](https://github.com/bdring/FluidNC), [MachineConfig](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Machine/MachineConfig.h), [job execution](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Job.cpp), and [spindle abstraction](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Spindles/Spindle.h).

### 5.4 Sender architectures: useful separation with a common trap

UGS separates supervisory controller state, byte-counted communication, controller-family implementations, a G-code parser/state model, and UI plugins. CNCjs separates browser UI, a Node server, controller-specific runners, workflow, sender, and serial connection. bCNC separates a G-code/geometric model, sender queues, controller plugins, probe/control UI, and canvas.

All are useful references, but all expose the same architectural limit: a sender's active-command or response cursor is normally an acknowledgement cursor, not a physical-execution cursor.

- [UGS AbstractController](https://github.com/winder/Universal-G-Code-Sender/blob/master/ugs-core/src/com/willwinder/universalgcodesender/AbstractController.java)
- [UGS BufferedCommunicator](https://github.com/winder/Universal-G-Code-Sender/blob/master/ugs-core/src/com/willwinder/universalgcodesender/communicator/BufferedCommunicator.java)
- [CNCjs Workflow](https://github.com/cncjs/cncjs/blob/master/src/server/lib/Workflow.js)
- [CNCjs Sender](https://github.com/cncjs/cncjs/blob/master/src/server/lib/Sender.js)
- [bCNC Sender](https://github.com/vlachoudis/bCNC/blob/master/bCNC/Sender.py)
- [bCNC generic controller](https://github.com/vlachoudis/bCNC/blob/master/bCNC/controllers/_GenericController.py)

### 5.5 FreeCAD CAM: offline manufacturing truth stops at the NC program

FreeCAD CAM provides a clear offline chain: CAD model -> Job containing model/stock/tools/setup/fixtures -> ordered operations and dressups -> machine-neutral Path commands -> target post-processor -> G-code. Simulation can validate toolpath geometry and material removal, but it cannot prove switches, spindle feedback, lost steps, omitted clamps, or controller timing.

This is a valuable product boundary: CAM should produce explicit setup and process truth, while live-control software must own machine-state validation. Sources: [FreeCAD CAM workflow](https://reqrefusion.github.io/FreeCAD-Documentation-html/wiki/CAM_Workbench.html), [Job.py](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/CAM/Path/Main/Job.py), and [postprocessor framework](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/CAM/Path/Post/Processor.py).

## 6. Current KerfDesk/LaserForge architecture

The snapshot has several strong structural decisions:

- `Project` is persisted manufacturing/design intent.
- `prepareOutput` is the shared compile/place/optimize path.
- CNC and laser compile through separate machine-kind branches.
- `emitGcode` selects a Z-aware CNC strategy and then runs post-emit preflight.
- controller drivers and capabilities isolate firmware dialects.
- the GRBL streamer has explicit queued/in-flight/completed state.
- pure invariants, unit tests, snapshots, and property tests cover output behavior.

The end-to-end local path is broadly:

```text
Project
  -> validate output scope
  -> compileCncJob / compileJob
  -> apply job origin
  -> optimize paths
  -> cncGrblStrategy / controller output strategy
  -> CNC or laser preflight
  -> streamer
  -> controller driver / serial transport
  -> firmware parser and planner
  -> physical motion
```

That separation is a good foundation. The defect is localized in the recovery model crossing these boundaries without enough evidence.

## 7. P0 local findings

### P0-1: CNC checkpoint resume confuses acknowledgement with execution

`src/core/recovery/job-checkpoint.ts` correctly comments that `ackedLines` means parsed into the RX buffer, not executed. `runCheckpointResumeFlow` nevertheless maps that count directly to the first resume line.

Consequences:

- after sender failure while the controller remains alive, the controller may continue executing beyond the host's last observed state;
- after controller power loss, acknowledged planner blocks may never have executed;
- the resume preamble can reconstruct a future XYZ/feed state and skip material that was never cut;
- the number of affected blocks is controller, program, streaming, and timing dependent, not safely summarized as “a few lines.”

This requires semantic execution fences, not a wording change.

### P0-2: CNC restart can command spindle start while the tool may be engaged

`cncResumeBody` currently emits the restored M3/M4 and a spin-up dwell before `G0 Z<safe>`. If the interruption occurred mid-cut and the cutter remains buried, the spindle starts under load.

Simply moving `G0 Z<safe>` before M3 is not a general fix: dragging a stopped cutter out of stock may also be unsafe. The resume flow first needs a verified `toolClear` / `recoveryClearanceEstablished` state. Unknown engagement must route to supervised manual recovery.

### P0-3: position and Z-zero confidence are not hard resume gates

CNC work-Z confidence is advisory-only on ordinary Start. The checkpoint-resume preparation discards warning output and later shows a generic confirm. A CNC restart can therefore proceed without a hard proof that the work coordinate system and stock-top Z remain valid.

After power loss, E-stop, collision, axis stall, alarm with possible position loss, or uncommanded physical movement, resume must require:

- axes referenced/homed or another explicitly validated position-restoration method;
- the original WCS identified and restored;
- work Z re-probed or explicitly re-established;
- the correct tool loaded and tool length known;
- fixtures/stock verified unchanged;
- a safe approach plan reviewed.

### P0-4: the modal replay surface is too small for imported CNC programs

The local parser restores a limited subset and refuses G91/G53/G28/G30, which is safer than guessing. It still does not model the full state needed for general external G-code, including cutter/tool-length compensation, planes, canned cycles, coordinate systems, feed modes, macros, subroutines, transforms, and process auxiliaries.

The product should either:

- restrict restart to KerfDesk-generated programs with a formally defined restartable dialect; or
- implement/borrow a much more complete interpreter and validate it against a conformance corpus.

General imported-program restart should remain disabled until then.

## 8. Proposed recovery architecture

### 8.1 Replace line checkpoints with semantic safe checkpoints

A safe checkpoint is not every accepted line. It is an operation boundary deliberately emitted or recognized where restart assumptions are simple and testable, for example:

- tool is retracted to a known clearance plane;
- no cutter compensation or canned cycle is active;
- tool, WCS, units, plane, feed mode, and auxiliaries are recorded;
- the exact posted program and operation identity are immutable;
- the controller has passed an execution fence and is physically idle;
- a known approach/lead-in exists for the next operation.

For GRBL, a synchronization dwell can force the planner to empty before the following acknowledgement, but the product still needs an explicit fence protocol and status reconciliation. A fence should be inserted at sparse, safe semantic boundaries, not between every contour segment.

### 8.2 Persist a recovery manifest

Suggested manifest fields:

```ts
type RecoveryManifest = {
  schemaVersion: number;
  programFingerprint: string;
  postProcessorId: string;
  postProcessorRevision: string;
  machineProfileFingerprint: string;
  machineKind: 'router' | 'mill' | 'lathe' | 'laser' | 'plasma';
  setupId: string;
  operationId: string;
  checkpointId: string;
  sourceLine: number;
  normalizedBlockId: string;
  machinePositionAtFence?: AxisVector;
  workCoordinateSystem: string;
  workOffset: AxisVector;
  toolId: string;
  toolLengthOffset?: number;
  modalSnapshot: ModalSnapshot;
  clearancePlane: number;
  approachPlanId: string;
  fenceCompleted: boolean;
  controllerSessionId: string;
};
```

This is evidence for a recovery decision, not permission by itself.

### 8.3 Use an explicit recovery state machine

```text
Interrupted
   |
   v
Classify stop ------------------------------------+
   |                                               |
   | controlled hold, same live controller         | reset/power/alarm/unknown
   v                                               v
Continue same queue                         Recovery inspection
                                                   |
                                                   v
                                      Physical engagement known?
                                         | yes-clear      | no/buried
                                         v                v
                               Reference/offset proof   Manual extraction
                                         |                |
                                         +-------+--------+
                                                 v
                                      Select semantic checkpoint
                                                 |
                                                 v
                                     Dry-run interpreter/state restore
                                                 |
                                                 v
                                    Validate tool/WCS/Z/fixtures/bounds
                                                 |
                                                 v
                                    Stage Z-clearance and XY approach
                                                 |
                                                 v
                                   Spindle command -> at-speed proof
                                                 |
                                                 v
                                      Controlled lead-in / recut
                                                 |
                                                 v
                                            Resume operation
```

### 8.4 Gate by interruption class

| Stop evidence | Allowed action |
|---|---|
| Same controller session, feed hold active, planner preserved, no operator jog | Realtime Cycle Start/Resume only. |
| Same session, planned tool-change or door-recovery flow, tracked jog-back | Restore the tracked changes in staged order, then continue. |
| Sender reconnect, controller session unchanged, execution fence known | Reconcile status and resume from a proven semantic checkpoint only. |
| Soft reset, alarm, E-stop, power loss, axis stall, collision, tool break, work movement, unknown session | No automatic resume. Full reference/setup/re-entry workflow required. |

## 9. Machine-specific sequencing invariants

### Router/mill

- no XY rapid below a verified clearance plane;
- no cutting entry until spindle direction, command, and at-speed state are satisfied;
- do not start or retract an engaged stopped cutter automatically;
- select a lead-in, ramp, helix, or already-cleared path rather than a blind full-depth plunge when possible;
- cutter compensation and canned cycles require restart from their safe activation boundary;
- restore tool identity and length before any Z motion based on work coordinates;
- coolant, vacuum, chip extraction, and clamps are state, not UI decoration.

### Lathe

- spindle speed is part of axis motion for G95, threading, CSS, and synchronized cycles;
- chuck state, tool/turret index, stock projection, spindle direction, and encoder index matter;
- line replay without spindle synchronization proof is categorically unsafe for threading;
- restart needs lathe-specific contour approach and clearance, not router logic.

### Laser

- source off through every non-marking travel;
- no positive constant-power dwell while stationary;
- re-entry may need overlap/backtrack to avoid gaps, balanced against double-burn risk;
- exhaust, air assist, enclosure/door, focus, and material-fire state matter.

### Plasma

- torch-off path replay can establish a re-entry point;
- arc-ok, pierce delay, pierce height, cut height, THC state, and kerf lead-in are required state;
- restarting directly inside a cut differs from starting at a pierce/lead-in;
- consumable and breakaway-head state must be verified.

## 10. Engineering invariants and tests to add

### Immediate safety policy

1. Disable automatic CNC checkpoint resume in production.
2. Keep ordinary feed-hold Resume separate and working; it is not the same feature.
3. Label the remaining manual feature “Restart from safe point,” not “Resume.”
4. Require a CNC-specific recovery checklist and hard blockers.
5. Restrict restart to generated, restartable-dialect programs until the interpreter is expanded.

### Pure invariants

- a CNC restart program cannot emit M3/M4 unless clearance is already established by the recovery plan;
- a CNC restart cannot emit XY motion until Z-clearance proof exists;
- a restart cannot descend unless tool identity, tool length, WCS, work Z, and target depth are known;
- no restart point may be inside active cutter compensation, canned cycles, or unsupported modal contexts;
- acknowledged host lines are never named “completed” or used as an execution watermark;
- any controller session change invalidates execution progress;
- imported G-code with unsupported words fails closed;
- laser, plasma, router/mill, and lathe recovery planners are separate strategies.

### Model-based and property tests

- generate random modal programs and compare the restart interpreter with a trusted interpreter;
- inject disconnects at every transport/planner/execution boundary in a controller simulator;
- vary RX and planner capacities to prove no host-ack assumption leaks into executed progress;
- property-test that all synthetic approaches remain above fixture/no-go geometry until the declared entry segment;
- verify tool changes, G54-G59 selection, G43/G49, G40/G41/G42, G80/canned cycles, G93/G94/G95, planes, subprograms, and macros fail or restore correctly;
- test power loss after acknowledgement but before execution;
- test app loss while the controller completes all buffered blocks;
- test workpiece movement, lost steps, broken tool, changed tool length, and stale WCO as mandatory refusal paths.

### Hardware fault matrix

Run with sacrificial stock or air-cut fixtures and record controller transcript, measured motion, spindle feedback, and video:

- app crash only;
- USB disconnect only;
- controller reset;
- controller power loss;
- VFD/spindle fault;
- feed hold at safe travel and mid-cut;
- soft limit, hard limit, probe alarm, and door event;
- E-stop during rapid, plunge, cut, and retract;
- axis stall/lost steps;
- tool break and manual tool replacement;
- operator jog after interruption;
- changed or cleared G92/G54 offset;
- machine re-home with unchanged workpiece;
- workpiece or fixture movement.

## 11. Long-term CNC research map

This dossier is the first tranche. The ongoing research should be organized into evidence packages rather than product feature lists.

### Track A — control architecture

- LinuxCNC Task/Interpreter/Motion/HAL/NML architecture;
- GRBL, grblHAL, FluidNC, and µCNC parser/planner/realtime contracts;
- LinuxCNC versus firmware-controller responsibility boundaries;
- sender flow control, reconnect, idempotence, and execution fencing;
- stepper open-loop versus servo feedback and following error.

### Track B — CAM and geometry

- operation graph, stock model, fixtures, setups, WCS, and manufacturing models;
- contouring, pockets, drilling, facing, V-carve, engraving, surfacing;
- ramp, helix, plunge, rest machining, adaptive/trochoidal clearing;
- tabs, bridges, onion skin, dogbones, inlays, two-sided and indexed work;
- 3D roughing/finishing, scallop, parallel, pencil, rest, collision avoidance;
- lead-in/out, cutter compensation, smoothing, arc fitting, and tolerance budgets;
- 4/5-axis kinematics, singularities, rotary limits, and post-processing.

### Track C — machine setup and metrology

- homing/reference systems and coordinate persistence;
- G53 and G54-G59, G92, tool-length and wear offsets;
- probes, tool setters, edge finding, work alignment, rotation, and skew;
- backlash, squareness, steps/mm, volumetric error, and compensation;
- spindle/VFD configuration, encoder feedback, and at-speed interlocks;
- fixtures, clamps, vacuum, doors, dust collection, coolant, and chip management.

### Track D — motion planning and process physics

- look-ahead, acceleration, jerk, junction deviation, exact stop/blending;
- feed per tooth, chip load, surface speed, material removal, deflection, chatter;
- spindle power/torque envelopes and tool engagement;
- controller cycle time, segmentation, arc handling, and path tolerance;
- lathe synchronization and threading;
- plasma arc/THC and laser dynamic-power contrasts.

### Track E — safety and assurance

- ISO 12100 risk assessment and risk reduction;
- ISO 13849-1 safety-related control systems;
- IEC 60204-1 electrical equipment of machines;
- ISO 19085-1 and ISO 19085-3 for woodworking CNC routers;
- ISO 16090-1 for relevant metalworking machine classes;
- safety functions versus convenience software; E-stop and interlocks must not depend on a desktop app;
- hazard analysis, FMEA/STPA, traceable safety requirements, and physical validation.

The current public standard scopes are available from [ISO 12100](https://www.iso.org/cms/%20render/live/en/sites/isoorg/contents/data/standard/05/15/51528.html?browse=tc), [ISO 13849-1:2023](https://www.iso.org/standard/73481.html), [IEC 60204-1](https://webstore.iec.ch/en/publication/26037), [ISO 19085-3:2021](https://www.iso.org/standard/75953.html), and [ISO 16090-1:2022](https://www.iso.org/standard/81558.html). Full normative text is licensed and should be acquired legitimately before making compliance claims.

### Track F — operator workflow and UX

- setup sheets and preflight checklists;
- novice versus expert disclosure without weakening hard gates;
- single block, optional stop, block delete, dry run, feed/rapid override;
- restart preview showing every synthetic move and restored state;
- physical-control priority, door/E-stop semantics, alarm recovery;
- audit log: program, profile, tool, setup, operator confirmation, and controller transcript.

### Track G — verification and digital twin

- interpreter conformance corpus;
- post-processor golden files;
- geometric and material-removal simulation;
- machine kinematic simulation and collision detection;
- controller transcript simulators and fault injection;
- hardware-in-the-loop test rigs;
- reproducible bug artifacts: project + posted program + profile + transcript + video.

## 12. Source hierarchy for future decisions

Use sources in this order:

1. applicable safety standards and machine/controller manufacturer manuals;
2. controller firmware source and official protocol documentation;
3. CNC language/interpreter specifications such as NISTIR 6556;
4. public source of mature CNC control and sender projects;
5. vendor operator manuals for commercial workflow behavior;
6. CAM/post-processor documentation and validated sample output;
7. books, research papers, training material, and expert articles;
8. forums only for failure discovery, never as sole authority for safety behavior.

Every research claim should be labeled as one of:

- **confirmed-source:** directly documented or visible in source;
- **confirmed-test:** reproduced in code, simulator, or hardware;
- **inference:** reasoned from multiple sources but not directly documented;
- **hypothesis:** needs a targeted experiment;
- **machine-specific:** must not be generalized to another controller/process.

## 13. Verification performed in this tranche

The current snapshot's focused recovery tests were run without changing product code:

```text
4 test files passed
39 tests passed

src/core/controllers/grbl/resume-program.test.ts
src/core/recovery/job-checkpoint.test.ts
src/ui/laser/CheckpointResumeBanner.test.tsx
src/ui/laser/start-job-flow.test.ts
```

These tests confirm the implementation matches its current specification. They do not validate physical safety, execution position, or restart behavior on a real machine.

## 14. Immediate decision record

Until the recovery architecture above exists:

- ordinary feed-hold Resume remains a controller continuation feature;
- laser restart must stay energy-off during travel and use laser-specific overlap rules;
- CNC crash/power-loss restart is a supervised recovery workflow, not automatic resume;
- CNC checkpoint progress based on GRBL acknowledgements is not an executed-motion record;
- unknown cutter engagement, unknown reference, unknown Z0, changed tool, changed work offset, or unsupported modal state must refuse restart;
- the product should not advertise crash-safe CNC resume in its current form.

This is the first concrete lesson from the broader research goal: **the quality of CNC software depends less on how many operations it lists than on whether it preserves the boundary between intended program state and verified physical machine state.**
