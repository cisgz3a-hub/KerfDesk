> **Historical research archive: 11–13 July 2026.** Published on 6 September 2026.
> Findings, scores, source claims and proposed changes below describe their recorded
> baseline; they have not been revalidated and are not current product or qualification
> evidence. Unimplemented proposals are not adopted policy. The current
> [Frame-first contract](../../PROJECT.md) governs application behaviour. See the
> [archive index](2026-09-06-preserved-audits.md) and [source manifest](2026-09-06-preserved-audits-source-manifest.json).

# CNC G-code Interpreter, Restart, and Simulation Architecture Deep Research

**Date:** 2026-07-13
**Status:** Research dossier, tranche 7
**Companions:** `2026-07-13-cnc-software-deep-research-foundation.md`, `2026-07-13-cnc-cam-motion-machine-architecture.md`, `2026-07-13-cnc-controller-post-and-process-workflows.md`, `2026-07-13-cnc-controller-machine-integration-and-fault-verification.md`, `2026-07-13-cnc-motion-control-drive-process-and-metrology.md`, `2026-07-13-cnc-safety-architecture-operator-modes-and-human-factors.md`
**Product mapped:** KerfDesk / LaserForge 2.0 `audit-current-main` at `e752a9125f02f832144c3b40800840ee5973fcf2`

## Executive verdict

G-code is not a list of independent movement lines. It is a stateful programming language whose meaning depends on an interpreter world model, fixed within-block execution order, modal groups, coordinate and tool offsets, units, active plane, feed/path modes, tool/process state, variables, control flow, controller configuration, and queued physical execution.

That distinction exposes five high-value findings in the live KerfDesk snapshot.

First, the exact interrupted-router defect that motivated this research is present in production source. Normal CNC output intentionally emits:

```text
G0 Z<safe>
M3 S<rpm>
G4 P<spinup>
```

because a newly zeroed cutter may be touching the stock. The recovery preamble emits the opposite:

```text
M3 S<rpm>
G4 P<spinup>
G0 Z<safe>
```

The same unsafe transition exists after a manual tool change: the operator is told to touch the new bit to stock top and re-zero Z; Continue begins at `M3/G4`; only the next pass retracts. In both flows the cutter can start stationary while touching or embedded in material. This is a **P0**.

The universal rule is not simply “move before spindle.” It is: prove the tool is clear, start the spindle while clear, prove or conservatively wait for operating speed, then execute a collision-checked approach and cutting entry. If a stopped cutter may be buried, neither starting under load nor blindly retracting the stopped cutter is generically safe; that needs a supervised extraction procedure chosen for the tool, material, machine, and fault.

Second, fresh-job output is deterministic as text but not deterministic as controller meaning. The prologue sets `G21 G90 G94`, but not the active plane, WCS, cutter compensation, tool-length compensation, coolant, or other persistent modes. GRBL exposes these as real parser state through `$G` and exposes G54–G59, G92, and TLO data through `$#`. KerfDesk allows arbitrary idle console G-code, so `G18`, `G55`, `G43.1`, or a prior G92 can change how the same output bytes execute. A safe post must either establish a complete semantic baseline or prove and bind the required controller state.

Third, the external `.nc` preview parser is tolerant in a way that creates false geometry. It records unsupported G/M codes as notes, then still executes any X/Y/Z words under the previously active motion mode. Examples:

- `G10 L20 P1 X0 Y0` can be previewed as physical motion although it changes an offset;
- `G92 X0` can be previewed as motion although it changes the coordinate mapping;
- `G43.1 Z10` can be previewed as a Z move although it changes tool-length offset;
- `G53 G0 X...` ignores the machine-coordinate modifier;
- `G81 X... Y... Z... R...` is reduced to one ordinary current-mode move instead of a drilling cycle.

The preview can therefore be smooth, bounded, and visually plausible while representing a different program. Unsupported semantics that can change geometry, process state, or execution order must be fatal or create an unmistakable “partial trace—not verified” result.

Fourth, the material-removal simulator loses important CNC meaning:

- every native and external job is stamped with the single active project tool, even for multi-tool programs;
- `path3d` steps store true 3D length, but Z interpolation advances by XY length divided by that 3D length, so a ramp does not reach its commanded final depth in the simulated grid;
- pure-vertical segments inside a `path3d` step have zero XY distance and never advance the interpolation, so peck drilling beyond the first entry depth is not represented correctly;
- the time estimator similarly projects `path3d` to XY and adds only one analytic plunge/retract pair per pass, omitting internal pecks, spindle dwells, tool-change time, and important transition semantics.

Fifth, the durable checkpoint is deleted at the wrong lifecycle boundary. `streamer = done` means the last line was acknowledged, and `use-job-checkpoint.ts` clears the record at that moment. The separate post-job lifecycle only then sends its planner-draining marker and waits for stable Idle. A host crash in that interval loses the only record while queued physical motion may still be running. The checkpoint must survive until a transactional controller execution fence commits.

The architectural answer is not a larger regular expression. KerfDesk needs one strict semantic pipeline:

```text
source text or native CAM operation graph
  -> dialect-qualified lexer/parser
  -> validated block AST
  -> explicit interpreter world model
  -> ordered canonical machine events
  -> process/motion transaction graph
  -> controller-specific post or controller execution
  -> planner/kinematics/drive realization
  -> source-qualified execution evidence
```

Preview, preflight, time estimate, run journal, and recovery should consume the same canonical event stream. Restart should begin from an operation/recovery checkpoint with reconstructed semantic and physical evidence—not from the first unacknowledged text line.

## 1. Five different meanings of “the program”

### 1.1 Source text

This is the operator-visible G-code file: blocks, comments, line numbers, variables, subroutines, and dialect-specific commands. It is useful for provenance and controller delivery, but line boundaries are not physical checkpoints.

### 1.2 Parsed block

A block is a validated syntax/semantic object. It must preserve:

- source location and exact text;
- every word, including duplicates until validation;
- G/M modal-group membership;
- expressions and parameter references;
- comments/messages;
- dialect and controller capability assumptions;
- whether axis words belong to motion, offset setting, probing, a canned cycle, or another command.

Using `Map<string, number>` too early destroys evidence such as duplicate words and collapses distinct semantics.

### 1.3 Interpreter world model

The NIST interpreter begins by constructing a world model containing interpreter parameters, machine state, and tool-carousel data. It reads a complete line into an internal representation, then executes its meaning by updating state and emitting canonical machining functions. The interpreter does not drive hardware directly; the controller queues and executes the resulting commands. Source: [NISTIR 6556, The NIST RS274/NGC Interpreter](https://www.nist.gov/publications/nist-rs274ngc-interpreter-version-3).

A useful world model includes at least:

```ts
type InterpreterWorld = {
  dialect: DialectIdentity;
  source: SourceCursor;
  units: 'mm' | 'inch';
  distanceMode: 'absolute' | 'incremental';
  arcDistanceMode: 'absolute-center' | 'incremental-center';
  activePlane: 'XY' | 'XZ' | 'YZ';
  feedMode: 'inverse-time' | 'units-per-minute' | 'units-per-revolution';
  pathMode: ExactPathOrBlendState;
  motionMode: MotionMode;
  activeWcs: WorkCoordinateSystem;
  wcsOffsets: ReadonlyMap<WorkCoordinateSystem, AxisVector>;
  localOffset: AxisVector;
  globalOffset: AxisVector;
  toolLengthComp: ToolLengthCompState;
  cutterComp: CutterCompState;
  programmedPosition: AxisVector;
  canonicalToolTipPosition: AxisVector;
  selectedTool: ToolIdentity | null;
  activeTool: ToolIdentity | null;
  spindle: SpindleCommandState;
  coolant: CoolantCommandState;
  overrides: OverridePolicy;
  cannedCycle: CannedCycleState | null;
  variables: ParameterStore;
  callStack: ReadonlyArray<CallFrame>;
  programState: ProgramFlowState;
};
```

### 1.4 Canonical machine events

The NIST architecture translates complex language into simpler canonical functions such as:

- set units/origin/plane/feed/path mode;
- straight traverse/feed and arc feed;
- dwell;
- probe;
- spindle speed/start/stop/orient;
- select/change tool and apply tool-length offset;
- coolant and override control;
- program stop/end.

A peck cycle becomes multiple simple traverse/feed events. A postprocessor can target a simple controller by expanding cycles, while a richer post can preserve a native canned cycle—without changing the upstream operation meaning.

### 1.5 Planned and physically executed motion

Canonical events still are not motor motion. The controller applies look-ahead, path blending, acceleration limits, kinematics, step/servo interpolation, I/O timing, overrides, and machine-specific logic. A host `ok` can mean that a block was parsed/admitted while earlier planner and stepper work remains.

Therefore, these cursors must remain distinct:

```text
source parsed
canonical events generated
controller admitted/acknowledged
planner queued
current executing block
motion physically settled
process result verified
```

## 2. RS274/NGC semantic foundations

### 2.1 Modal groups are simultaneous state dimensions

The [NIST interpreter report](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=823374) defines modal groups for motion, plane, distance, feed mode, units, cutter compensation, tool-length offset, cycle return, coordinate system, path control, program flow, spindle, coolant, and overrides. One member from many groups is active at the same time.

The important implication is:

> Restoring `G90`, `G21`, and the last XYZ is not restoring the interpreter.

A restart engine must know which modes affect the chosen tail, which were established before it, which physical effects already occurred, and which cannot safely be recreated automatically.

### 2.2 Within-block order is semantic

RS274 does not execute words simply left to right. The NIST/LinuxCNC order applies feed mode/rate, spindle speed, tool selection/change, spindle/coolant, dwell, plane, units, compensations, WCS, path/distance/cycle-return modes, non-modal offset/reference operations, then motion, and finally program stop.

Source: [LinuxCNC G-code order of execution](https://www.linuxcnc.org/docs/2.4/html/gcode_overview.html) and [NISTIR 6556](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=823374).

A parser should:

1. lex the entire block;
2. detect duplicates and modal-group conflicts;
3. resolve expressions/parameters using defined buffering semantics;
4. validate that each word is legal for the selected commands and machine axes;
5. apply the standard/dialect execution phases;
6. emit ordered canonical events atomically or reject the whole block.

That demands an ordered block AST. A `Map<letter, value>` is structurally unable to represent duplicate-word errors, ordered parameter assignments, or source spans for each occurrence. NIST/LinuxCNC semantics also stage parameter writes: in `#3=6 G1 X#3`, the move reads the old value of `#3`; the assignment becomes visible after expressions on that block have been evaluated. Text order is not execution order, but text occurrences and parameter staging still have to be preserved.

The current KerfDesk parser violates this model in several concrete ways:

- `readWords` overwrites `X1 X2` with the last X instead of rejecting the duplicate;
- G/M keys collapse identical repetitions, while different codes from the same modal group are applied in textual order instead of rejected;
- `G1 X10 M2` ends the program before it emits the move, although the defined execution phases put motion before program stop;
- unsupported words become notes even when they own the axis words or change later interpretation.

Those are language-semantic defects, not merely missing preview decorations.

### 2.3 Coordinate meaning is a transform stack

The effective tool/work relationship can involve:

```text
programmed coordinates
  -> scale/rotation/local transform where supported
  -> active work-coordinate offset (G54-G59.x)
  -> local/global offsets such as G52/G92
  -> tool-length compensation
  -> machine coordinates
  -> kinematic transform
  -> joint positions
```

`G53` temporarily requests machine-coordinate motion; it is not an ordinary modal WCS. `G10` and `G92` can consume axis words without commanding motion. G43/G43.1 alter the relationship between programmed position and tool tip. This is exactly why an axis-word regex cannot determine motion by itself.

GRBL documents `$#` as the readout for G54–G59, G28/G30, G92, TLO, and probe parameters, and `$G` as its active parser state including WCS, plane, units, distance/feed modes, TLO, spindle/coolant, tool, S, and F. Source: [GRBL v1.1 commands](https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md).

Coordinate behavior is dialect-specific. LinuxCNC applies G52/G92 after the WCS transform and can persist G92 state across startup; classic GRBL treats G92 differently across reset. LinuxCNC also permits WCS rotation through `G10 L2 ... R`. Therefore neither a saved placement object nor a remembered work XYZ proves the live transform stack. `G43`/`G43.1` can change the controlled-point/tool-tip relationship without an immediate move, and loaded tool, selected tool, and active tool-length offset are three different facts.

### 2.4 Plane affects far more than arc drawing

G17/G18/G19 select XY/XZ/YZ semantics for arcs and can affect cutter compensation and canned cycles. A post that emits XY `G2/G3` must establish G17 or prove it. KerfDesk currently emits native XY arcs but does not emit G17, so a prior console `G18`/`G19` makes the file non-self-defining.

### 2.5 Feed mode changes the dimension of F

- G94: units per minute;
- G93: inverse time per block;
- G95: units per spindle revolution on controllers that support it.

The same numeric `F300` can mean entirely different motion. KerfDesk correctly emits G94 for fresh native jobs, but the preview and recovery model should retain feed mode explicitly. Spindle-synchronized operations, tapping, and threading introduce a motion/process coupling that cannot be recovered from XYZ alone.

G95 is still not threading synchronization. LinuxCNC G33 waits on spindle-at-speed/index feedback so repeated passes align, while G33.1 coordinates rigid-tap feed, reversal, and withdrawal. A restart planner must reject mid-thread/mid-tap continuation and return to a complete controller-specific pass/cycle boundary with encoder phase evidence.

### 2.6 Path control changes the physical path

Exact-path/exact-stop and blended-continuous modes determine whether the controller must pass through programmed vertices or may round within a tolerance. Controller look-ahead and junction-deviation settings further change velocity and geometric deviation. A CAM preview of nominal geometry is not a controller trajectory proof.

This affects clearance invariants directly. Under blended trajectory control, the controller may begin the XY component of `G0 X... Y...` before a preceding `G0 Zsafe` reaches its exact endpoint. Proving only that every lateral rapid block _ends_ at safe Z is insufficient. The post/verifier must either introduce a documented synchronization/exact-stop boundary, prove the target controller makes that junction exact, or evaluate the full bounded blended trajectory against the clearance envelope. GRBL documents a short `G4` as a planner-synchronization technique; that is useful at deliberately selected safe barriers, not as a substitute for trajectory reasoning everywhere. Sources: [LinuxCNC trajectory control](https://linuxcnc.org/docs/stable/html/user/user-concepts.html) and [GRBL streaming synchronization](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md).

### 2.7 Cutter compensation is a geometric state machine

G41/G42 is not simply “offset this polyline.” Entry/exit moves, active plane, tool-radius register, inside-corner feasibility, lead length, side selection, and controller dialect matter. Restarting inside active compensation can gouge or alarm because the controller lacks a valid lead-in history. Mature block-restart systems either reconstruct from an earlier safe boundary or refuse the target.

KerfDesk currently applies tool-radius compensation offline in CAM, which is a sensible simple-controller design. Its restart/preview parsers should nevertheless reject controller-side G41/G42 rather than ignore it.

Commercial restart restrictions confirm the hazard: Haas Program Restart scans earlier program state but alarms when the requested target is inside active G41/G42, and LinuxCNC QtPlasmaC refuses Run From Line when prior cutter compensation is active. Safe policy is to restart before compensation is enabled and replay its lead-in, or after a valid G40 departure—never synthesize a direct entry into the compensated contour. Sources: [Haas Setting 36](https://www.haascnc.com/service/codes-settings.type%3Dsetting.machine%3Dmill.value%3DS36.html) and [QtPlasmaC Run From Line](https://www.linuxcnc.org/docs/stable/html/plasma/qtplasmac.html).

### 2.8 Canned cycles and control flow expand one line into many events

Drilling cycles combine preliminary motion, R plane, depth, dwell/peck, repeat, and G98/G99 return policy. Subprograms, loops, conditionals, variables, expressions, remaps, and user M-codes can expand dynamically or depend on controller/machine state.

Line count is therefore not event count, planner block count, or executed-motion count. A restart target inside a cycle or subroutine needs an expanded execution identity such as call stack + invocation + canonical event index, not just source line.

For LinuxCNC milling cycles, R and Z may be sticky, G90/G91 changes how XYZ/R are interpreted, the cycle captures an initial plane, and G98 versus G99 changes the final return height. The physical interruption point can be approach, an individual peck, chip-clearance retract, re-entry, bottom dwell, or final retract—none of which is named by the source line. The usual safe unit is the complete hole/cycle invocation. A simple-controller post may expand it into canonical motions, but must preserve those sticky and retract semantics. Source: [LinuxCNC canned cycles](https://www.linuxcnc.org/docs/html/gcode/g-code.html#_g80_g89_canned_cycles).

Macros make source-line identity still weaker. LinuxCNC O-code has scoped parameters, calls, loops, conditionals, recursion, return values, and a distinct Fanuc-style M98/M99 model. The same line can execute many times with different variables and machine inputs. A resumable execution cursor therefore needs call stack, invocation, loop iteration, parameter snapshot, and canonical-event identity; input-dependent programs may be non-resumable offline. Source: [LinuxCNC O-code](https://www.linuxcnc.org/docs/html/gcode/o-code.html).

### 2.9 Arcs, helices, splines, and target precision

G2/G3 meaning depends on plane, direction, endpoint distance mode, independent IJK distance mode, IJK-versus-R form, helical-axis movement, full/multi-turn support, and the target controller's radial mismatch rule. LinuxCNC recommends center-form arcs, supports P multi-turn arcs, and documents why R-form arcs near 180°/360° are numerically ill-conditioned. Stateful G5/G5.1/G5.2/G5.3 splines add prior-tangent or NURBS-block state, so a line inside a spline chain is not an independent restart point. Source: [LinuxCNC G2/G3 and spline reference](https://www.linuxcnc.org/docs/html/gcode/g-code.html).

KerfDesk has two specific mismatches:

- `ARC_RADIUS_TOLERANCE_MM = 0.127` is a single fixed acceptance threshold. Classic GRBL's parser applies a millimetre lower threshold plus relative and upper radial-error limits; the local comment appears to interpret its small millimetre threshold as inches, widening it by about 25.4×. A preview can therefore accept an arc the target rejects.
- imported helical arcs store Z change, but the step length is only planar `abs(sweep) * radius`; axial helix distance is missing. Duration/progress are consequently short even when endpoint geometry looks right.

Target-exact parser validation should be differential-tested against the supported firmware build, not approximated by one cross-controller tolerance.

### 2.10 Complete state is larger than modal state

For recovery, the interpreter snapshot must be joined with facts the language model cannot prove:

| Interpreter/controller state | Physical/process evidence |
| --- | --- |
| motion, plane, units, distance and IJK modes | actual machine/joint position and homing confidence |
| active WCS, G52/G92 and TLO | datum/fixture/tool measurement still valid |
| cutter/path/retract/feed/spindle modes | actual loaded tool/assembly and holder |
| F/S/T/H/D and spindle/coolant commands | spindle at-speed, coolant/process response |
| active cycle/spline/compensation state | cutter engaged, broken, jammed, or clear |
| call stack, variables and execution cursor | planner drained and motion physically settled |

An interpreter world model may already show the commanded endpoint while the motion controller is still traversing toward it. That is why UI, interpreter, controller-accepted, planner, and physical progress need different types and labels.

## 3. Public controller architecture lessons

### 3.1 LinuxCNC separates interpretation, coordination, real-time motion, and hardware

LinuxCNC documents four broad components: EMCTASK, EMCMOT, EMCIO, and user interfaces. Task coordinates the interpreter, motion, and discrete I/O. The non-real-time interpreter/task emits queued messages; the real-time motion controller consumes waypoints, applies trajectory planning and kinematics, and interfaces through HAL. Source: [LinuxCNC Code Notes](https://linuxcnc.org/docs/html/code/code-notes.html).

The separation is important:

```text
UI
  -> Task/program ownership and interpreter read-ahead
      -> canonical/NML command queue
          -> realtime trajectory planner
              -> kinematics
                  -> joint control/HAL
                      -> hardware
```

Queue-busting operations force already-generated canonical commands to execute and then synchronize the interpreter world model with the external machine. This is a better model than letting a UI infer that “parsed through line N” means the machine has reached it.

The detailed path is instructive: the interpreter emits typed canonical calls such as `STRAIGHT_FEED`; `emccanon.cc` converts frames and builds typed trajectory/I/O commands; EMCTASK appends them to `interp_list`, waits for each command's preconditions, issues it, then waits for postconditions; the realtime motion side admits waypoints to the trajectory planner, samples them in the servo cycle, applies inverse kinematics, and writes joint commands through HAL. LinuxCNC consequently exposes read line, Task line, executing motion ID, interpreter/executor state, queue depth, commanded/actual pose, homed/in-position, and I/O completion as different facts. Sources: [canonical interface](https://github.com/LinuxCNC/linuxcnc/blob/master/src/emc/nml_intf/canon.hh), [Task executor](https://github.com/LinuxCNC/linuxcnc/blob/master/src/emc/task/emctaskmain.cc), [motion command handler](https://github.com/LinuxCNC/linuxcnc/blob/master/src/emc/motion/command.c), and [realtime control](https://github.com/LinuxCNC/linuxcnc/blob/master/src/emc/motion/control.c).

One important limit remains: for non-identity kinematics, a Cartesian path that satisfies axis-space limits can still violate a joint limit during inverse kinematics. Professional preflight therefore needs both tool/work-space and joint/motor-space checks. Source: [LinuxCNC kinematics](https://linuxcnc.org/docs/html/motion/kinematics.html).

### 3.2 GRBL deliberately fuses a smaller language with embedded planning

GRBL's protocol loop parses complete lines, its G-code parser validates and converts motion, the planner buffers/look-ahead plans blocks, and the stepper subsystem prepares and executes time-critical segments. Realtime characters are handled outside the ordinary line stream.

GRBL intentionally omits macros, variables, and most canned cycles while supporting primary motion, arcs/helices, coordinate systems, probing, offsets, and a compact modal model. Its documented planner contains up to 16 motion blocks on the classic AVR build; its serial RX buffer and planner queue mean acknowledgement is not physical completion. Sources: [GRBL repository](https://github.com/gnea/grbl), [streaming interface](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md), [gcode.c](https://github.com/gnea/grbl/blob/master/grbl/gcode.c), [planner.c](https://github.com/gnea/grbl/blob/master/grbl/planner.c), and [stepper.c](https://github.com/gnea/grbl/blob/master/grbl/stepper.c).

The character-counting protocol maximizes look-ahead fill but allows later buffered commands to continue being parsed after the host receives an error. GRBL explicitly recommends prechecking in `$C` check mode for that reason. KerfDesk's application preflight is useful, but controller check-mode validation against the exact connected fingerprint is a separate gate.

Classic GRBL actually exposes four internal stages even before physical feedback:

```text
serial bytes
  -> transactionally parsed block
  -> mutable look-ahead planner block
  -> immutable prepared step segment
  -> timer-ISR step pulses
```

Adding a line can replan earlier mutable blocks through reverse/forward acceleration passes, while prepared segments can no longer be changed. Feed hold is a controller state machine that decelerates and replans the partial block; merely stopping host writes leaves the already buffered future running. Reset clears the queued future and GRBL warns that position may have been lost if motion was active.

### 3.3 grblHAL separates portable semantics from drivers and plugins

[grblHAL](https://github.com/grblHAL/core) keeps a shared C core for parser, protocol, reporting, planner, spindle/probe/settings, then connects it to processor-specific drivers through a hardware abstraction layer. Plugins can subscribe to events, add M-codes/settings, implement ATC/auxiliary behavior, networking, SD execution, WebUI, and other machine features without modifying the core.

This improves portability, but it means “grblHAL” is not one semantic target. The official support table marks many G/M codes as driver/configuration/plugin dependent; protocol extensions and new machine states can require a compatible sender. Even planner capacity can be a runtime/build setting. A sender therefore needs a fingerprint of core build + driver + plugins + settings + reported capabilities, not a family-name dropdown.

The interface itself is a useful model: core initializes a versioned HAL contract with capability fields and required function pointers, then the driver owns streams, timers/step pulses, control/limit/probe inputs, spindle/coolant, storage, IRQ and atomic operations. Typed callbacks cover state, reports, probing, tool change, at-speed, homing, filesystems, and user codes. Plugin power also creates risk: callback ordering and ISR/foreground context must be declared and conformance-tested for every safety-relevant extension. Sources: [grblHAL `hal.h`](https://github.com/grblHAL/core/blob/master/hal.h) and [core handlers](https://github.com/grblHAL/core/blob/master/core_handlers.h).

### 3.4 FluidNC makes the machine graph runtime-configurable

[FluidNC](https://github.com/bdring/FluidNC) is an ESP32-focused controller with an object-oriented hierarchical design, hardware abstractions for spindles/motors/drivers, runtime YAML machine configuration, multiple tool types, networking, storage, and an embedded WebUI while retaining day-to-day GRBL sender compatibility.

The architectural lesson is not to copy its UI into the desktop app. It is that controller meaning depends on a loaded machine definition: axes, kinematics, motors, limits, spindles, I/O, and tool-changing behavior can differ without recompiling the firmware. KerfDesk must ingest or bind that machine configuration and reject stale assumptions after a controller/config change.

FluidNC also provides a concrete command-ownership pattern. Serial, network, WebUI, and file/SD producers converge on a protocol task; an `activeChannel` token serializes one line at a time, and an active file job receives priority so competing line sources cannot interleave. Interrupt-originated events are queued for complex processing outside ISR context. KerfDesk should apply the same rule across job runner, console, macros, pendant, and remote UI: one arbiter owns controller writes. Sources: [FluidNC protocol](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Protocol.cpp) and [main task setup](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Main.cpp).

### 3.5 g2core treats host communication and jerk-limited planning as first-class

[g2core](https://github.com/synthetos/g2) supports up to nine axes, JSON request/response/status interfaces, serial flow control, jerk-controlled third-order motion planning, configurable planner queue/segment timing, multiple kinematics/processor targets, and a separate Motate hardware abstraction layer.

Its published implementation describes sub-millisecond motion segments whose velocity evolves across the segment. This is a reminder that “one G-code block” is transformed through planner blocks and time slices before steps. Host JSON/status sophistication makes state more observable, but still does not turn protocol acceptance into settled physical motion.

g2core's strongest pattern is execution provenance. It distinguishes the canonical read-ahead model, a full model snapshot copied into each planner buffer, and the runtime model for the buffer actually executing. Motion and synchronized non-motion callbacks share one ordered ring, so later parser state cannot overwrite the context that explains current execution. Its feed hold is also a multi-phase state machine—request, segment synchronization, deceleration, hold finalization, holding, and release—separate from queue flush. Sources: [canonical machine](https://github.com/synthetos/g2/blob/master/g2core/canonical_machine.cpp), [planner](https://github.com/synthetos/g2/blob/master/g2core/planner.cpp), and [controller scheduler](https://github.com/synthetos/g2/blob/master/g2core/controller.cpp).

### 3.6 Machinekit generalizes LinuxCNC's controller/HAL split

[Machinekit Code Notes](https://www.machinekit.io/docs/code/code_notes/) retains the EMCTASK/EMCMOT/EMCIO separation: task interprets and coordinates, the real-time motion controller consumes waypoints, discrete I/O owns spindle/coolant/auxiliary behavior, and HAL connects real-time/user-space components to hardware. Its [HAL model](https://www.machinekit.io/docs/hal/basic_hal/) supports explicitly scheduled components in fast base and slower servo threads, while the motion component exposes homed, in-position, limit, velocity, and timing/overrun signals.

This is the strongest architectural contrast with a desktop sender. Machine state is a typed signal graph and coordinated controller state, not a collection of UI booleans. KerfDesk does not need to become a real-time controller, but its adapter contract should preserve the same separations and evidence levels.

Machinekit's historical monorepo is archived and current work is split across `machinekit-hal` and `machinekit-cnc`; its Machinetalk/ZeroMQ/Protobuf direction shows that remote front ends can be clients without owning realtime machine truth. It also exposes a security lesson: discovery/network control must have authentication, authority arbitration, replay/session protection, and local-presence policy before it becomes a production CNC boundary.

### 3.7 Cross-controller comparison

| System | Interpretation/coordination | Motion/planning | Hardware/configuration boundary | Host implication |
| --- | --- | --- | --- | --- |
| LinuxCNC | rich RS274 interpreter + EMCTASK | real-time EMCMOT, kinematics, joints | HAL + INI/HAL machine config | use explicit task/motion/I/O and queue-buster semantics |
| classic GRBL | compact parser/protocol in firmware | small look-ahead planner + stepper segments | compile-time AVR-oriented port | `ok` is buffer admission; bind exact firmware/settings |
| grblHAL | portable extended GRBL core | configurable look-ahead core | driver HAL + plugins + runtime settings | fingerprint build/driver/plugins/capabilities |
| FluidNC | GRBL-compatible parser around machine objects | ESP32 planner/stepping tasks | runtime YAML object graph + networking/WebUI | qualify the loaded config, not just version text |
| g2core | G-code + JSON command/status model | jerk-limited multi-axis planner/segments | Motate + board/machine compile configuration | distinguish JSON receipt, planner state, and execution |
| Machinekit | EMCTASK/interpreter | real-time EMCMOT and component threads | networkable/instantiable HAL components | model machine evidence as signals and coordinated state |

The shared lesson is a strict boundary chain:

```text
source program
  -> dialect-qualified interpreter
  -> canonical operations/events
  -> planner admission and look-ahead
  -> realtime trajectory/segments
  -> drives/I/O
  -> measured physical state
```

No public architecture collapses these into a reliable “last acknowledged line.” KerfDesk should keep each boundary observable and avoid claiming downstream completion from upstream progress.

### 3.8 Evidence lifecycle to copy into KerfDesk

Every command/operation should retain one immutable identity while its evidence advances:

```text
created
  -> semantic validation passed
  -> emitted/sent
  -> transport accepted
  -> controller parsed
  -> planner queued
  -> executing
  -> controller motion complete
  -> effect observed/verified
```

Not every controller can prove every step. Missing stages remain `unknown`; they are never inferred from a later UI label. Reset creates a new controller epoch and invalidates all accepted-but-uncompleted assumptions from the old epoch. Console, hold/resume, cancel, abort/reset, and physical E-stop are different authorities and transitions, not synonyms for “stop.”

## 4. KerfDesk live semantic audit

### 4.1 The native CAM-to-output pipeline has strong foundations

KerfDesk already does several things well:

- one pure `prepareOutput` path feeds preview, estimate, Save, and Start;
- scene-to-job compilation is deterministic;
- CNC passes distinguish constant-Z contours, per-vertex XYZ paths, and arcs;
- the emitter enforces retract-before-XY-travel and feed-only plunges;
- native arcs use `G2/G3` with I/J when valid and fall back to sampled G1;
- toolpaths are ordered clearing-before-profile and inside-before-outside;
- multi-tool groups are collected into contiguous tool sections;
- final text is checked for non-finite coordinates, bounds, no-go zones, buried rapid travel, and over-depth cuts;
- program fingerprints prevent a changed project from silently reusing old line numbering;
- the checkpoint type explicitly admits that `ok` is parse/admission evidence, not execution.

These are substantial assets. The weaknesses arise where a compact geometric IR is asked to stand in for a complete interpreter/process world model.

### 4.2 Native `Job` is geometry-rich but event-poor

`CncGroup` contains tool ID/name/diameter, feed, plunge, RPM, spin-up, safe Z, parking, and passes. `CncPass` carries contour/path3d/arc geometry. Missing first-class events include:

- program semantic sections and safe restart boundaries;
- explicit WCS/plane/offset/TLO assumptions;
- spindle/coolant/extraction/vacuum/clamp transactions and proof requirements;
- tool-change boundary identity and completion evidence;
- entry/link/retract intent;
- stock-before/stock-after and engagement envelope;
- fixture/holder/collet collision geometry;
- checkpoint/restart policy;
- controller capability/dialect requirements per event.

The emitter currently infers a tool change when adjacent groups have different tool keys. That makes text generation possible but leaves preview, recovery, journal, and verification without the same semantic event.

### 4.3 Fresh-job prologue is not a complete semantic baseline

`src/core/output/cnc-grbl-strategy.ts` emits:

```text
G21
G90
G94
G0 Z<safe>
M3 S<rpm>
G4 P<spinup>
```

It does not establish or verify:

- G17 plane for XY arcs;
- intended WCS such as G54;
- G40 cutter compensation off;
- G49 tool-length compensation off, or an explicit intended TLO;
- G92/local offset policy;
- coolant state;
- path-control assumptions;
- selected/active tool identity;
- controller build/dialect and startup-block behavior.

This is not hypothetical. `prepareConsoleCommand` accepts arbitrary one-line G-code while idle. A user can send `G18`, `G55`, `G43.1 Z...`, or other modal commands, then run a native job. Production code can query `$G` and `$#` only through the manual console; it does not parse and qualify them as Start evidence.

The persistent-origin flow writes `G10 L20 P1 X0 Y0` to G54 but never selects G54. If another WCS is active, the new origin is written to one coordinate system while the job continues in another. Comments that describe `G92.1` as returning to the underlying G54 are true only if G54 is active.

### 4.4 Start, manual tool change, and crash recovery disagree on spindle order

Normal Start was correctly hardened:

```text
retract from touch-off pose
  -> start spindle
  -> dwell for spin-up
  -> travel and enter cut
```

But `cncResumeBody()` does:

```text
start spindle
  -> dwell
  -> retract
  -> rapid XY
  -> feed directly back to recorded depth
```

The manual tool-change block similarly emits `M0`, then `M3/G4`, while the tracked Z is invalidated and only the next pass emits its retract. These are both direct stationary-engagement defects.

KerfDesk's M0 interception is a private sender protocol, not a universal tool-change semantic. LinuxCNC M6 stops the spindle and changes the selected tool but does not automatically apply the new length offset and may leave coolant on; Haas M06 has different positioning, spindle orientation, and coolant side effects. The application therefore needs an explicit transaction rather than inferring completion from an ordinary program stop:

```text
expected tool
  -> spindle/process stopped and clearance/park proved
  -> operator changes tool
  -> tool identity confirmed
  -> touch-off/probe and offset committed
  -> stationary retract to clearance completes
  -> spindle starts at clearance and reaches speed
  -> generated approach/lead-in
```

Sources: [LinuxCNC M6](https://linuxcnc.org/docs/stable/html/gcode/m-code.html) and [Haas M06](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dmill.value%3DM06.html).

Even after reversing that order, feeding straight to the old depth at one XY is not a general re-entry strategy. The point may contain uncut stock, a wall, a tab, a ramp, or a broken tool. Recovery needs remaining-stock-aware clearance and lead-in geometry.

### 4.5 Resume parser reconstructs only a narrow shadow state

`src/core/controllers/grbl/resume-program.ts` tracks:

- G20/G21;
- G90, and rejects G91;
- G0/G1 motion mode;
- M3/M4/M5 and S;
- modal F;
- last literal X/Y/Z;
- most recent downward G1 feed.

It rejects G53/G28/G30, which is good. It does not model:

- active plane and G2/G3 modal mode;
- WCS identity and offsets;
- G92/G52/TLO;
- cutter compensation;
- arc-center mode;
- path-control mode;
- coolant/extraction;
- active tool/tool-change completion;
- M0/M1 cause and operator transaction;
- program end/call stack/cycles;
- actual versus commanded position;
- remaining stock or engagement.

Three further defects follow from that shadow model:

- the selected target block's own semantics are not considered when building the preamble; selecting an `M5` line can cause the preamble to start the spindle only for the replay tail to stop it immediately;
- the synthetic retract/return blocks leave the interpreter in their G0/G1 motion mode, but the original tail may begin with bare axis words that inherited a different G0/G1/G2/G3/cycle mode;
- CNC-versus-laser recovery is inferred from whether a Z value was observed, even though machine/process identity must be explicit.

Its word regex also omits several legal numeric spellings such as a leading `+`, leading-decimal values, exponents, and whitespace between letter and value. The native emitter happens to use a narrow canonical spelling; the function is not a general G-code interpreter.

For inch programs, `safeZMm` and `plungeMmPerMin` options are emitted after `G20` without conversion, so 5 mm becomes 5 inches and 300 mm/min becomes 300 in/min. Native KerfDesk CNC output always uses G21, but this demonstrates why units belong in typed quantities rather than ambient text state.

### 4.6 Acknowledgement checkpoints are transport evidence

`JobCheckpoint` stores a deterministic text fingerprint, sendable/acknowledged counts, machine kind, output scope, resolved origin, and time. That is useful forensic data. It cannot establish:

- which planner blocks executed;
- where deceleration stopped after an interruption;
- actual tool-tip pose;
- whether the controller rebooted or retained buffers;
- tool/workholding/stock condition;
- whether a tool change completed;
- remaining stock and valid re-entry geometry;
- spindle/auxiliary state;
- reference/WCS/TLO confidence.

Mapping “first unacknowledged” to a raw source line is therefore not a CNC recovery checkpoint. It may replay too early or too late and can split a semantic operation.

GRBL's protocol documentation is explicit that `ok` can mean a command was parsed and set to be executed, not that physical motion has completed. If the host fails while the controller remains powered, queued motion can continue after the last persisted host cursor; if controller power is lost, acknowledged planner blocks can disappear before execution. The existing periodic persistence lag can also move the saved cursor backward. These uncertainties do not cancel predictably, so the first-unacknowledged line is neither a conservative lower nor upper bound on removed material.

### 4.7 The terminal checkpoint is deleted before the execution fence

`use-job-checkpoint.ts` clears the durable record as soon as the streamer reaches `done`, which means all stream lines have acknowledged. Only after that transition does `beginPostJobSettle()` send the controller-specific planner-draining marker and wait for two fresh stable Idle reports.

The timeline is therefore:

```text
last ordinary line acknowledged
  -> streamer = done
  -> checkpoint deleted
  -> settle marker sent/acknowledged
  -> stable Idle proved
```

A host crash in the middle leaves no checkpoint while queued motion may still be executing. The comments and tests call a `done` resume “physically complete,” but the separate settle design proves that assumption is false. The record must remain transactionally durable until the execution fence commits; a crash between intent and commit must produce an explicit uncertain segment.

### 4.8 Checkpoint identity and persistence are too weak for recovery authority

The checkpoint uses a 32-bit FNV-1a text fingerprint plus counts and re-compiles the project on resume. That is useful change detection, not a collision-resistant immutable job package. It is stored best-effort in local storage, write failures are swallowed, progress is throttled in 25-ack intervals, and there is no exact compiled-program blob, controller reset epoch, firmware/config fingerprint, tool/offset/fixture/stock snapshot, or semantic operation ID.

Replaying the deliberately stale region is not generically conservative. It may widen a finished contour, remove tabs, repeat a probe/tool/offset action, re-enter a thin wall, or collide with stock changed after the prior pass. Recovery authority needs a content-addressed exact job artifact (for example SHA-256/BLAKE3 plus immutable bytes) and transactional checkpoint records—not merely reproducible text and a line count.

### 4.9 External `.nc` parser can silently change program meaning

`parseGcodeProgram` declares a preview-only GRBL subset. The dangerous behavior is not that the subset is small; it is that unsupported commands are often non-fatal while their axis words still feed ordinary motion.

The algorithm:

```text
apply recognized modal G/M effects
record every unrecognized G/M as a note
if X/Y/Z/I/J/R exists:
  resolve a target using current absolute/relative state
  execute current G0/G1/G2/G3 mode
```

This violates the RS274 rule that axis words can belong to non-motion commands and that group-0 axis commands suspend modal group-1 motion for the block.

It also:

- assumes initial XYZ = machine/program zero;
- assumes G0, G21, G90 without requiring a prologue or machine snapshot;
- stores duplicate non-G/M words by last value;
- does not reject two commands from the same modal group;
- ignores WCS/G92/TLO/cutter compensation/cycles/macros/subprograms;
- records spindle/coolant as geometry-free no-ops;
- stops at M2/M30 but lacks M0/M1 semantics;
- maps every feed move to a cut regardless of whether spindle/process is active.

The current UI labels the result “Simulating,” and unsupported commands appear only in a toast note. That is too strong. The result should be one of:

```ts
type ProgramAnalysis =
  | { kind: 'verified'; canonical: CanonicalProgram; assumptions: ProvenAssumptions }
  | { kind: 'partial-trace'; trace: DiagnosticTrace; blockers: SemanticGap[] }
  | { kind: 'rejected'; diagnostics: Diagnostic[] };
```

No material-removal or collision claim should be made from `partial-trace`.

### 4.10 Re-import parity tests only a friendly self-generated pocket

The `.nc re-import parity` test emits one native square pocket, parses it, and compares a heightfield footprint/depth. That is useful for the supported happy path. It does not cover:

- WCS/G92/TLO/plane contamination;
- unsupported group-0 axis commands;
- canned cycles or subprogram expansion;
- multi-tool programs;
- tool changes and process state;
- `path3d` ramp/peck depth;
- fixtures/holder/rapid collision;
- controller dialects;
- physical execution or restart.

The test name should remain scoped to “native subset pocket geometry parity.”

### 4.11 Removal grid has a path3d interpolation defect

`toolpath-cnc.ts` correctly assigns a `path3d` cut step its full 3D arc length and only stores an XY projection plus a start/end Z span. `stamp-toolpath.ts` then walks XY distance but divides it by the full 3D length to interpolate Z.

For a segment from `(0,0,-0.5)` to `(3,4,-2.5)`:

```text
XY length = 5
3D length = sqrt(29) = 5.385...
simulated final interpolation t = 5 / 5.385 = 0.928...
simulated final Z ≈ -2.357, not -2.5
```

For a pure-vertical internal segment, XY length is zero, so Z does not advance at all. A multi-peck drill is represented by a first entry plunge plus a zero-XY `path3d` cut; later peck depths are absent from the removal grid.

The fix is architectural: preserve per-vertex XYZ in simulation steps or store per-segment 3D length and interpolate by 3D progress. A single XY polyline plus one global Z span is insufficient.

### 4.12 One tool kernel is applied to every group

`useCncRemovalGrid` and `Cnc3DPane` call `kernelForTool(activeCncTool(machine), ...)` once for the entire toolpath. `ToolpathStep` does not carry tool/assembly identity. A two-stage V-carve, rough/finish relief, drill-plus-profile, or imported multi-tool program is therefore rendered using the wrong cutter for some or most steps.

Each canonical cutting event needs tool assembly identity, and the simulator must select the corresponding kernel per event.

### 4.13 Duration estimate is a useful approximation with missing semantics

The estimator projects CNC passes into XY blocks, applies a GRBL-style junction-deviation look-ahead model, and adds one plunge/retract term per pass. It omits or approximates:

- full 3D path length and internal Z moves;
- peck cycles;
- same-XY depth chaining actually used by the emitter;
- native arc dynamics;
- spindle acceleration/dwell;
- manual tool-change time;
- probing/inspection/optional stops;
- controller-specific limits, per-axis acceleration/jerk, kinematics, and override history.

The UI should call this a motion estimate with a confidence/model declaration, not a predicted completion time.

## 5. Verification and simulation hierarchy

### 5.1 Nominal path trace

Draws canonical tool-center motion. It can answer “what path was requested?” only if interpretation is complete. It does not prove stock removal, holder clearance, machine collision, or controller realization.

### 5.2 Material-removal simulation

Applies tool geometry to evolving stock. Common models include:

- 2.5D heightfield/depth map—fast, good for three-axis top-down cutting, unable to represent undercuts or multiple surfaces at one XY;
- voxel/volumetric—general removal and remaining stock, resolution/memory tradeoff;
- solid B-rep/CSG—geometrically rich, expensive and numerically delicate;
- distance-field/octree/adaptive methods—trade detail for scalable spatial refinement.

KerfDesk's grid is an appropriate first 2.5D model, but it must preserve per-event tool and XYZ semantics before it can support restart decisions.

### 5.3 Machine simulation

Adds axes, kinematics, travel limits, rotary wrapping, head/spindle/holder, fixture, stock, table, guards, and tool changer. It evaluates swept volumes and joint-space behavior, not just tool-tip geometry.

### 5.4 Controller/dialect verification

Interprets the exact posted file with the target controller's semantics or an independently validated model. Controller check mode catches syntax/capability errors but still may not execute machine PLC logic, macros, probing, ATC, or physical I/O.

### 5.5 Physical proof

Air cut, reduced rapid, single block, distance-to-go, supervised first cut, and measurement close the gap from models to machine. A green software simulation is never a safety certificate.

### 5.6 Evidence/proof ladder

The word “simulation” should be replaced by a declared proof level and model confidence:

| Level | Evidence product | It can support | It cannot establish |
| --- | --- | --- | --- |
| 0 | text/parser acceptance | syntax accepted by that parser | target semantics or motion |
| 1 | tool-center path trace | nominal interpreted geometry | tool/stock/fixture/physical execution |
| 2 | controller-semantic trace | modal/cycle/macro canonical actions for a matched dialect | collision or removal |
| 3 | material-removal model | predicted remaining stock, overcut/rest material at model resolution | machine-component collision or actual stock |
| 4 | kinematic/collision model | modeled tool/holder/fixture/machine interference | unmodeled clamps, drift, actual motion |
| 5 | controller-identical digital twin | NC/PLC/controller behavior plus the exact modeled machine | real workholding/tool damage/missed motion |
| 6 | real-machine air run/single block/reduced rapid | controller and machine motion under the current setup | cutting-force behavior or final part |
| 7 | in-process sensing/metrology | sensor-covered physical/process/workpiece evidence | anything outside coverage |

Claims are cumulative and question-specific. A Level 3 stock model may answer “is this lead-in predicted to cross remaining stock?” while still saying nothing about a clamp collision that requires Level 4.

### 5.7 Public simulator and controller comparison

| System | What it actually models | Restart behavior | Limitation/lesson |
| --- | --- | --- | --- |
| LinuxCNC AXIS/Vismach | RS274 canonical preview; separate HAL-driven kinematic animation | generic Run From Selected Line carries warnings; specialized QtPlasmaC refuses subroutines/active compensation and can synthesize a lead-in | semantic preview, kinematics, and execution status remain separate; AXIS estimates omit important dynamics |
| Haas | controller graphics plus earlier-block state scan | Setting 36 scans tools/offsets/G/M/positions; Run–Stop–Jog Continue stages operator-chosen unobstructed return, XY/rotary then Z, with further Cycle Start | state restoration plus staged re-entry, still dependent on operator clearance judgment |
| SINUMERIK | optional controller-identical NC/PLC digital twin, machine/tool/holder/fixture/removal/collision | block-search modes separate calculation, accumulated side-effect action blocks, approach, and resumed execution | side-effect-free scan + explicit action log + separately approved approach |
| HEIDENHAIN TNC7 | controller plus optional exact machine twin/DCM | block scan, restore machine/tool/spindle/tilt state, display axis-sequenced return, multiple NC Starts | restoration, positioning, and cutting continuation are visible phases |
| PathPilot | LinuxCNC-derived semantic/controller view | no preparation, operator-positioned lead-in, or G30-clearance lead-in; the first is discouraged mid-cut | restart policy is contextual, not one preamble |
| MASSO | controller-native stored processed-line cursor and recalculated parameters | re-home when reference is lost; Z-to-home, lateral axes, Z final, operator confirmation at stages; process-specific plasma retrace | a durable controller cursor is stronger than host `ok`, yet still not removal proof |
| UGS/gSender | host prefix scan, reconstructed modal state/position, inferred clearance | synthetic retract/XY/return/spindle/dwell/tail workflows | useful comparative implementations, but no physical stock/fixture/execution-fence proof |
| CAMotics | 3-axis interpreter, tools, cuboid stock, implicit/swept-tool field, adaptive sampled surface | partial-time stock recomputation, no recovery engine | strong expected-stock visualization; no holder/fixture/machine/controller truth |
| FreeCAD CAM | legacy heightfield stamping and newer GPU swept-path visual subtraction | offline expected-material preview | fast 2.5D/visual models, not durable controller-identical collision truth |

Primary sources: [LinuxCNC AXIS](https://linuxcnc.org/docs/html/gui/axis.html), [QtPlasmaC Run From Line](https://www.linuxcnc.org/docs/stable/html/plasma/qtplasmac.html), [Haas Setting 36](https://www.haascnc.com/service/codes-settings.type%3Dsetting.machine%3Dmill.value%3DS36.html), [Haas operation workflow](https://www.haascnc.com/service/online-operator-s-manuals/mill-operator-s-manual/mill---operation.html), [SINUMERIK Run MyVirtual Machine](https://www.siemens.com/en-us/products/sinumerik/run-my-virtual-machine/), [HEIDENHAIN Digital Twin](https://www.heidenhain.com/service/services/digital-twin), [PathPilot tools/features](https://knowledgebase.tormach.com/1500mx/pathpilot-tools-and-features-1500mx), [MASSO Jump to Line](https://docs.masso.com.au/getting-started-guides/machining-with-masso/resuming-program-or-jump-to-line), [UGS RunFromProcessor](https://github.com/winder/Universal-G-Code-Sender/blob/4d0745986041032cb6b30fb8e41b31c1cbcae3a9/ugs-core/src/com/willwinder/universalgcodesender/gcode/processors/RunFromProcessor.java), [gSender Start From Line](https://github.com/Sienci-Labs/gsender/blob/43f841edf89bc346163af10f6b0087d56ca9fadb/src/app/src/features/JobControl/StartFromLine.tsx), [CAMotics manual](https://camotics.org/manual.html), and [FreeCAD VolSim](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/PathSimulator/App/VolSim.h).

### 5.8 Material-removal algorithms solve different questions

- **Heightfield/Z-map:** one surface height per XY cell. Fast and appropriate for three-axis top-down routing; cannot represent undercuts, caves, or multiple occupied intervals.
- **Dexel/multi-dexel/tri-dexel:** one or more occupied depth intervals along rays. Better topology and common in engagement/removal research.
- **Voxel:** full 3D occupancy and simple collision queries; memory/compute scale cubically with resolution.
- **B-rep/CSG/swept solid:** potentially precise geometry; repeated robust Boolean subtraction is computationally and numerically difficult.
- **Implicit/signed-distance/adaptive field:** combines stock and swept-tool scalar fields, spatial acceleration, adaptive sampling, and isosurface extraction. CAMotics follows this family.
- **GPU depth/stencil:** excellent interactive visualization, but often not a durable queryable remaining-stock truth model.

Remaining stock needs an explicit recurrence:

```text
stock[k + 1] = stock[k] - cuttingEnvelope(event[k], toolAssembly[k])
```

and separate outputs for expected remaining stock, target material, gouge/overcut, uncut/rest material, and uncertainty. Engagement/force simulation is a further layer—entry/exit angle, axial/radial immersion, tooth chip thickness, force/deflection/wear/chatter. The first recovery milestone should be conservative occupied-space and remaining-stock rejection, not an elaborate force model.

### 5.9 Uncertain stock is first-class after an uncommitted segment

At a durable execution fence, predicted stock can advance from state N to N+1. If the host/controller fails after segment intent but before the fence commits, that swept region is neither safely “uncut” nor safely “removed.” Recovery must retain both possibilities as an uncertainty envelope and reject any extraction, transfer, or re-entry that relies on choosing the convenient one.

Even controller `Idle`/empty planner does not prove material was removed: an open-loop axis may have stalled, a tool may have broken, the spindle may not have reached speed, or the stock/fixture may have shifted. Those facts require independent physical evidence.

## 6. Deterministic recovery architecture

### 6.1 Restart unit is an operation checkpoint

A restartable boundary should be generated by CAM/interpreter semantics, for example:

- before an operation;
- after safe retract and process stop;
- between depth levels when the next entry is regenerated;
- after a fully committed tool change/probe transaction;
- at a controller-reported synchronization point with physical evidence.

Never split:

- inside cutter compensation entry/exit;
- inside a canned cycle or macro invocation without expanded identity;
- inside a tool-change/ATC transaction;
- between spindle command and at-speed proof;
- inside a ramp/helix where remaining-stock entry is unknown;
- at an acknowledgement cursor alone.

### 6.2 Checkpoint contents

```ts
type RecoveryCheckpoint = {
  programIdentity: ProgramAndPostFingerprint;
  controllerSession: ControllerFingerprint;
  sourceCursor: ExpandedExecutionCursor;
  semanticState: InterpreterWorldSnapshot;
  canonicalEventIndex: number;
  operationId: string;
  toolAssembly: ToolAssemblyEvidence;
  coordinateEvidence: CoordinateFrameEvidence;
  commandedPose: AxisVector;
  actualPoseEvidence: PositionEvidence;
  processEvidence: ProcessStateEvidence;
  stockStateRef: StockSnapshotIdentity;
  fixtureStateRef: FixtureSnapshotIdentity;
  safeBoundaryProof: SafeBoundaryEvidence;
  createdAt: string;
};
```

The controller session, safety state, and physical evidence can invalidate the checkpoint without changing the file bytes.

### 6.3 Recovery planning phases

```text
classify interruption and make machine safe
  -> identify last trustworthy evidence horizon
  -> reconcile controller/interpreter/machine/physical state
  -> re-prove reference, WCS, TLO, tool, fixture, stock, and process
  -> choose an earlier semantic restart boundary if needed
  -> recompute remaining stock from verified completed operations
  -> generate retract/clearance/return/re-entry canonical events
  -> simulate against stock, fixture, holder, and machine
  -> establish complete controller modal baseline
  -> stage motion with explicit operator gates
  -> start spindle in verified clearance
  -> prove at-speed
  -> execute controlled lead-in/ramp/helix into known cleared stock
  -> continue the operation under a new run identity
```

### 6.4 Recovery is a new program

The safest design treats recovery output as a newly generated, signed/provenance-bearing program with:

- reference to the interrupted run and checkpoint;
- explicit assumptions;
- regenerated semantic prologue;
- clearance and approach geometry;
- bounded restart region;
- recovery-specific preview and approval;
- separate run journal.

Appending the original tail verbatim after a synthetic preamble hides assumptions and makes validation harder.

### 6.5 Side-effect-free prefix scan and explicit restoration

Industrial block-search systems show the right split. Interpret the skipped prefix against a captured environment, but suppress physical M/T/S/coolant/PLC/probe side effects. Produce:

```text
semantic state at candidate boundary
  + ordered action log that would need restoration
  + eligibility diagnostics
  + approach requirements
```

Then authorize state restoration, auxiliary actions, positioning, spindle start, approach, and cutting continuation as separate phases. An unsupported macro/remap/input, active compensation, unresolved cycle, or incomplete tool/probe transaction makes the boundary ineligible rather than “best effort.”

### 6.6 Transactional execution fences

For a GRBL-class controller, safe recovery cannot be reconstructed continuously from ordinary acknowledgements. Generated jobs should introduce sparse semantic commit boundaries:

1. Persist `segment-intent(checkpoint N -> N+1)` before streaming it.
2. Stream only the semantic segment; do not queue later work past its fence.
3. Send the firmware-specific planner-draining marker.
4. Wait for marker acknowledgement plus fresh stable Idle/in-position evidence.
5. Persist `segment-committed(N+1)` and its predicted stock transition atomically.
6. Only then admit the next segment.

This deliberately trades some look-ahead/performance at operation-safe boundaries for a bounded uncertainty window. The fence proves controller/planner completion only under its stated no-fault assumptions; it is not material-removal proof.

### 6.7 Physical evidence reconciler

```ts
type PhysicalEvidence = {
  controllerEpoch: 'same' | 'reset' | 'unknown';
  reference: 'valid' | 're-homed' | 'unknown';
  machinePose: Evidence<Pose>;
  workOffsets: Evidence<Offsets>;
  toolIdentity: Evidence<ToolId>;
  toolLength: Evidence<LengthMm>;
  toolIntegrity: 'verified' | 'unknown';
  toolClearance: 'verified-clear' | 'possibly-engaged' | 'unknown';
  stockRegistration: Evidence<Transform>;
  fixtureRegistration: Evidence<Transform>;
  spindle: 'stopped' | 'at-speed' | 'commanded-only' | 'unknown';
  guardsAndSafety: Evidence<SafetySnapshot>;
};
```

Unknown fails closed. Power loss, E-stop, hard limit, collision, axis stall, tool break, workholding movement, spindle fault, or an unknown controller epoch must not enter automatic restart. A possibly buried cutter requires a supervised extraction procedure; neither starting it under load nor dragging it out while stopped is a universal safe action.

### 6.8 Staged operator authority

The UI should expose distinct actions:

- **Resume feed hold:** same live controller session and retained planner.
- **Recover interrupted job:** opens evidence reconciliation and planning; it does not move.
- **Execute clearance/restoration:** staged non-cutting transaction.
- **Start spindle / confirm at-speed:** separate energy transition.
- **Execute approach / continue cutting:** final staged authority.
- **Abort/reset:** invalidates assumptions and is never labeled Resume.

Every synthetic recovery event must be visible in preview, signed into the run journal, interruptible, and itself recoverable only through the same evidence rules.

## 7. Target KerfDesk semantic architecture

### 7.1 One strict parser and canonical IR

```ts
type CanonicalEvent =
  | SetUnitsEvent
  | SelectPlaneEvent
  | SelectCoordinateSystemEvent
  | SetOffsetEvent
  | SetToolCompEvent
  | SetPathModeEvent
  | SetFeedModeEvent
  | SelectToolEvent
  | ChangeToolEvent
  | SpindleTransactionEvent
  | AuxiliaryTransactionEvent
  | TraverseEvent
  | FeedEvent
  | ArcEvent
  | ProbeTransactionEvent
  | ProgramStopEvent
  | ProgramEndEvent
  | SemanticBarrierEvent;
```

Native CAM should compile to the same semantic events directly. Imported G-code should reach them through a dialect-qualified interpreter. Posts consume them. Preview, invariants, duration, journal, and recovery observe them.

### 7.2 Preserve intent above canonical events

Canonical motion alone is still too low-level for editing/replanning. Keep an operation graph above it:

```text
ManufacturingOperation
  -> setup/frame/tool/stock/fixture requirements
  -> entry/link/retract policy
  -> cutting strategy and geometry
  -> restart policy and safe boundaries
  -> canonical event expansion
```

This preserves the difference between a ramp entry, pocket loop, peck drill, finish pass, tool change, and clearance move even if they all eventually become G0/G1/G2/G3.

### 7.3 Typed quantities and frames

Avoid ambient units and naked vectors:

```ts
type LengthMm = number & { readonly __unit: 'mm' };
type FeedMmPerMin = number & { readonly __unit: 'mm/min' };
type SpindleRpm = number & { readonly __unit: 'rpm' };

type FramedPose<F extends CoordinateFrame> = {
  frame: F;
  axes: AxisVector;
};
```

Convert at parser/post boundaries. Never pass `safeZMm` into an inch-mode text emitter without explicit conversion.

### 7.4 Semantic prologue contract

Each post declares:

- which state it establishes in text;
- which state must be proved from the controller/machine;
- which state is forbidden;
- reset/startup-block assumptions;
- WCS/TLO/tool policy;
- units, plane, distance, arc, feed, path, compensation, coolant, spindle defaults;
- controller capability/version fingerprint.

For the current GRBL router policy, a conservative candidate is conceptually:

```text
qualify controller build/settings/modal/offset state
select G54 (or the explicitly bound intended WCS)
G17 G21 G90 G91.1 G94 G40 G49
establish/verify G92 policy
M5 M9
retract while spindle stopped from a proved-clear move policy
M3 S...
wait/prove at-speed
```

The exact line must be validated against the supported GRBL/grblHAL/FluidNC capability matrix and the application's chosen zeroing model. A textual “safety line” cannot resolve an unknown embedded cutter or unknown TLO by itself.

### 7.5 Simulation event payload

Every cutting step should retain:

```ts
type SimulationSegment = {
  eventId: string;
  operationId: string;
  toolAssemblyId: string;
  processState: ProcessState;
  from: Vec3;
  to: Vec3;
  curve: LineOrArcOrSpline;
  feedMode: FeedMode;
  commandedFeed: number;
  engagementIntent: 'air' | 'entry' | 'cut' | 'retract' | 'probe';
  source: SourceSpan;
};
```

This fixes per-tool kernels, exact 3D interpolation, process-aware cut classification, time estimation, and restart provenance together.

### 7.6 Immutable content-addressed job package

```ts
type JobPackage = {
  exactProgramBytesRef: BlobReference;
  programDigest: Sha256;
  emitterRevision: string;
  dialectAndPostRevision: string;
  operationGraphDigest: Sha256;
  controllerBuildConfigDigest: Sha256;
  machineProfileDigest: Sha256;
  toolTableDigest: Sha256;
  initialOffsetsDigest: Sha256;
  stockFixtureModelDigest: Sha256;
};
```

Recompilation can be a diagnostic, but recovery must refer to exact immutable bytes and the exact semantic artifacts that authorized them. Store large artifacts in a transactional content-addressed store rather than a best-effort local-storage slot.

### 7.7 One command arbiter and controller epoch

All job, console, jog, probing, tool-change, pendant, macro, and remote commands flow through one authority that knows the active mode and evidence consequences. The adapter emits a new controller epoch on reset/reboot/reconnect, invalidating queued/accepted/completion assumptions from the previous epoch according to controller-specific rules.

The lifecycle record should distinguish:

```text
validated -> sent -> accepted -> queued -> executing -> motion-complete -> effect-verified
```

and retain the source/canonical identity, modal snapshot, target build, transport session, evidence, and invalidation cause at every transition.

### 7.8 Controller adapter capability contract

Each supported controller reports or is qualified for:

- firmware/build/config/plugin identity;
- RX/planner capacity and line/operation identity support;
- hold/resume/cancel/reset/unlock semantics;
- homing/reference and position evidence;
- actual spindle-speed/at-speed capability;
- door/E-stop/motor-fault signals;
- kinematics ownership and supported axes;
- tool-change, probing, SD execution, and synchronized I/O;
- semantic dialect, startup/reset modal behavior, offsets, and persistent state;
- planner-drain/in-position barrier semantics.

An adapter may honestly answer `unsupported` or `unknown`. The UI must not synthesize confidence from a machine-family label.

## 8. Prioritized KerfDesk actions

### P0 — stop unsafe or false continuation

1. Disable CNC checkpoint and manual start-from-line execution until a qualified recovery engine exists.
2. At minimum, reverse recovery/tool-change continuation order so clearance/retract is established before spindle start; do not treat this alone as sufficient recovery.
3. Do not clear the terminal checkpoint at streamer `done`; retain it until the post-job planner-drain + stable-Idle fence commits.
4. Make CNC work-Z/reference/tool state hard blockers, not advisories.
5. Replace “motion lines confirmed” with transport-accurate acknowledgement wording and separate feed-hold Resume from interrupted-job Recovery.
6. Reject external preview when an unsupported command can alter coordinates, motion expansion, tool/process state, or control flow. Do not simulate it under the prior motion mode.
7. Block recovery M3/M4 until tool clearance is verified; route possible engagement to a supervised extraction playbook.

### P1 — semantic correctness foundation

1. Create a strict block lexer/parser with duplicate/modal-group/word-ownership validation.
2. Implement an explicit interpreter world model and canonical event IR.
3. Make native CAM compile to operation and canonical events before post text.
4. Add a versioned controller/post capability contract and complete semantic prologue.
5. Query/parse `$I`, `$G`, and `$#`; bind Start to controller boot/config/modal/offset evidence.
6. Select and verify the intended WCS; fix persistent-origin flows that write G54 without selecting it.
7. Preserve per-segment XYZ and tool assembly in the simulation IR.
8. Fix `path3d` Z interpolation and pure-vertical peck removal.
9. Apply the correct tool kernel per event/group.
10. Replace the 32-bit recompilation fingerprint with an immutable content-addressed job package and controller epoch.
11. Route console/job/jog/probe/tool-change writes through one command arbiter.

### P2 — professional verification and recovery

1. Add expanded cycles/subprogram execution identity and semantic barriers.
2. Add remaining-stock snapshots at operation boundaries.
3. Add fixture, holder, collet, spindle/head, and machine swept-volume checks.
4. Add controller check-mode verification of the exact posted file.
5. Build operation-level recovery planning with regenerated clearance/lead-in.
6. Add modal/canonical differential tests against LinuxCNC or another reference interpreter for the supported subset.
7. Add controller-specific golden programs and hardware-in-loop traces.
8. Add model confidence and unsupported-semantics reporting to every preview/estimate.
9. Add two-phase operation-boundary execution fences and uncertain-stock records.
10. Add side-effect-free prefix scanning with an explicit restoration action log and eligibility decision.

### P3 — advanced controller semantics

1. Canned cycles, macro/subprogram expansion, variables, conditionals, and remap policy.
2. G93/G95, spindle synchronization, rigid tapping, threading, and multiple spindles.
3. 3+2/5-axis transforms, TCP/RTCP, singularity/joint-limit-aware simulation.
4. Adaptive/rest machining driven by evolving stock and engagement.
5. Digital-twin calibration from controller/drive/metrology traces.

## 9. Verification program

### 9.1 Parser conformance corpus

Include positive and negative blocks for:

- legal numeric formats, comments, checksums/line numbers where supported;
- duplicate words and same-modal-group conflicts;
- fixed within-block order;
- G53/G10/G52/G92/WCS/TLO word ownership;
- planes and arc-center modes;
- G93/G94/G95;
- G61/G64;
- G40/G41/G42 entry/exit;
- G81–G89 plus G98/G99;
- M0/M1/M2/M30, tool/spindle/coolant events;
- variables/expressions/subprogram call identity;
- unsupported command severity.

### 9.2 Metamorphic semantic tests

- whitespace/case/comments do not change canonical events;
- legal reordering of text words within one block does not change the defined ordered result;
- mm/inch equivalent programs produce identical canonical millimeter geometry and time dimensions;
- absolute/incremental equivalent programs match;
- I/J and R-form equivalent arcs match within tolerance;
- expanded canned cycle matches native cycle canonical events;
- post parse-back matches source canonical events for the supported post contract.

### 9.3 Adversarial preview tests

Assert that these never become ordinary current-mode motion:

```text
G10 L20 P1 X0 Y0
G92 X0 Y0
G43.1 Z10
G53 G0 X0
G81 X10 Y10 Z-5 R2
G41 D1 X10
O100 call
```

If unsupported, they must reject or block material-removal claims.

### 9.4 Simulation ground truth

- per-vertex path3d ramps reach every commanded Z;
- pure-vertical multi-peck cycles reach the deepest commanded depth;
- two tools with different diameters/shapes stamp different correct regions;
- multi-tool native program equals per-operation analytic union;
- arcs/helices match analytic sweep and Z interpolation;
- scrub progress is monotonic in event execution distance/time;
- fixtures/holders collide under constructed swept-volume cases;
- remaining stock after operation N becomes the input for N+1.

### 9.5 Restart fault injection

Interrupt at every semantic boundary and within every transaction:

- before/after spindle command and at-speed proof;
- during retract, rapid, entry, cut, ramp, helix, and peck;
- inside cutter compensation/cycle/subprogram;
- before/during/after M0/M6/tool change/probe;
- controller reset, host loss, communication loss, E-stop, guard, drive fault;
- changed WCS/G92/TLO/tool/fixture/stock/controller boot;
- stale/forged acknowledgement and execution cursors.

The property is not “resume completed.” It is:

> Every accepted recovery has a complete evidence chain and produces a newly verified clearance/process/re-entry program; every missing or contradictory fact causes refusal or a bounded manual recovery playbook.

### 9.6 Live regression baseline for this audit

The focused suites covering the audited implementation paths all pass on snapshot `e752a9125f02f832144c3b40800840ee5973fcf2`:

```text
12 test files passed
110 tests passed
```

Suites run:

- `resume-program.test.ts`
- `job-checkpoint.test.ts`
- `parse-gcode-program.test.ts`
- `gcode-reimport-parity.test.ts`
- `toolpath-cnc.test.ts`
- `stamp-toolpath.test.ts`
- `estimate-duration.test.ts`
- `cnc-grbl-strategy.test.ts`
- `cnc-multi-tool.test.ts`
- `use-job-checkpoint.test.ts`
- `laser-post-job-settle.test.ts`
- `laser-controller-lifecycle.test.ts`

This matters because the P0 ordering defects and simulator blind spots are present **despite** green tests. Existing assertions encode the current behavior but do not prove the cross-layer physical contract. For example, the tool-change test checks that the first _motion_ after M0 is a Z lift, but it does not reject `M3` and spin-up dwell occurring before that motion.

The additional checkpoint/lifecycle suites explicitly assert that `done` clears the durable checkpoint while post-job settling is still in its dwell/Idle phases. That is strong regression evidence for the terminal checkpoint race, not a speculative reading.

## 10. Research source map

### Language and interpreter semantics

- [NIST RS274/NGC Interpreter Version 3](https://www.nist.gov/publications/nist-rs274ngc-interpreter-version-3)
- [NISTIR 6556 PDF](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=823374)
- [LinuxCNC G-code overview and quick reference](https://linuxcnc.org/docs/html/gcode.html)
- [LinuxCNC current G-code overview](https://www.linuxcnc.org/docs/2.9/html/gcode/overview.html)
- [LinuxCNC coordinate systems](https://linuxcnc.org/docs/scratch/html/gcode/coordinates.html)
- [GRBL v1.1 commands and parser state](https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md)

### Public controller architecture

- [LinuxCNC Code Notes](https://linuxcnc.org/docs/html/code/code-notes.html)
- [LinuxCNC HAL introduction](https://linuxcnc.org/docs/html/man/man3/intro.3hal.html)
- [LinuxCNC core motion components](https://linuxcnc.org/docs/stable/html/config/core-components.html)
- [GRBL repository](https://github.com/gnea/grbl)
- [GRBL streaming interface](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md)
- [GRBL parser](https://github.com/gnea/grbl/blob/master/grbl/gcode.c)
- [GRBL planner](https://github.com/gnea/grbl/blob/master/grbl/planner.c)
- [GRBL stepper preparation/execution](https://github.com/gnea/grbl/blob/master/grbl/stepper.c)
- [LinuxCNC canonical interface](https://github.com/LinuxCNC/linuxcnc/blob/master/src/emc/nml_intf/canon.hh)
- [LinuxCNC Task executor](https://github.com/LinuxCNC/linuxcnc/blob/master/src/emc/task/emctaskmain.cc)
- [LinuxCNC realtime motion control](https://github.com/LinuxCNC/linuxcnc/blob/master/src/emc/motion/control.c)
- [grblHAL core and capability overview](https://github.com/grblHAL/core)
- [grblHAL hardware contract](https://github.com/grblHAL/core/blob/master/hal.h)
- [FluidNC repository and architecture overview](https://github.com/bdring/FluidNC)
- [FluidNC protocol arbiter](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Protocol.cpp)
- [g2core repository](https://github.com/synthetos/g2)
- [g2core canonical machine](https://github.com/synthetos/g2/blob/master/g2core/canonical_machine.cpp)
- [g2core planner](https://github.com/synthetos/g2/blob/master/g2core/planner.cpp)
- [Machinekit Code Notes](https://www.machinekit.io/docs/code/code_notes/)

### Restart and block-search behavior

- [Haas Setting 36 Program Restart](https://www.haascnc.com/service/codes-settings.type%3Dsetting.machine%3Dmill.value%3DS36.html)
- [Haas mill operation and Run–Stop–Jog–Continue](https://www.haascnc.com/service/online-operator-s-manuals/mill-operator-s-manual/mill---operation.html)
- [LinuxCNC QtPlasmaC Run From Line](https://www.linuxcnc.org/docs/stable/html/plasma/qtplasmac.html)
- [Tormach PathPilot recovery/lead-in policies](https://knowledgebase.tormach.com/1500mx/pathpilot-tools-and-features-1500mx)
- [MASSO milling Jump to Line](https://docs.masso.com.au/getting-started-guides/machining-with-masso/resuming-program-or-jump-to-line)
- [MASSO process-specific plasma recovery](https://docs.masso.com.au/wiring-and-setup/plasma-cut-Resume?ln=en)
- [SINUMERIK Run MyVirtual Machine](https://www.siemens.com/en-us/products/sinumerik/run-my-virtual-machine/)
- [HEIDENHAIN Digital Twin](https://www.heidenhain.com/service/services/digital-twin)
- [UGS RunFromProcessor implementation](https://github.com/winder/Universal-G-Code-Sender/blob/4d0745986041032cb6b30fb8e41b31c1cbcae3a9/ugs-core/src/com/willwinder/universalgcodesender/gcode/processors/RunFromProcessor.java)
- [gSender Start From Line UI](https://github.com/Sienci-Labs/gsender/blob/43f841edf89bc346163af10f6b0087d56ca9fadb/src/app/src/features/JobControl/StartFromLine.tsx)

### Simulation and material-removal models

- [CAMotics manual](https://camotics.org/manual.html)
- [CAMotics simulation runner](https://github.com/CauldronDevelopmentLLC/CAMotics/blob/e84665f2fa9d1151f03282ac7e01320bc65e015b/src/camotics/sim/SimulationRun.cpp)
- [CAMotics swept-tool field](https://github.com/CauldronDevelopmentLLC/CAMotics/blob/e84665f2fa9d1151f03282ac7e01320bc65e015b/src/camotics/sim/ToolSweep.cpp)
- [FreeCAD legacy VolSim heightfield](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/PathSimulator/App/VolSim.h)
- [FreeCAD GPU mill simulation](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/PathSimulator/AppGL/MillSimulation.cpp)
- [OpenCAMLib geometry algorithms](https://opencamlib.readthedocs.io/en/latest/)

Pinned public-code snapshots used where links include revisions: CAMotics `e84665f2`, FreeCAD `85c1848a`, UGS `4d074598`, gSender `43f841ed`. LinuxCNC, grblHAL, FluidNC, g2core, and Machinekit links point at their documented current/master architecture and must be re-qualified when implementing against a specific release.

## Final architecture rule

> Parse once into an explicit world model and canonical event stream; preserve operation, tool, stock, coordinate, process, and execution evidence through every downstream layer. A source line, host acknowledgement, nominal preview, or remembered XYZ is never by itself a physical restart state.
