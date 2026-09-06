> **Historical research archive: 11–13 July 2026.** Published on 6 September 2026.
> Findings, scores, source claims and proposed changes below describe their recorded
> baseline; they have not been revalidated and are not current product or qualification
> evidence. Unimplemented proposals are not adopted policy. The current
> [Frame-first contract](../../PROJECT.md) governs application behaviour. See the
> [archive index](2026-09-06-preserved-audits.md) and [source manifest](2026-09-06-preserved-audits-source-manifest.json).

# CNC Setup, Probing, Tooling, and Calibration Architecture Deep Research

**Date:** 2026-07-13
**Status:** Research dossier, tranche 8
**Product mapped:** KerfDesk / LaserForge 2.0 `audit-current-main` at `e752a9125f02f832144c3b40800840ee5973fcf2`
**Companions:** the seven earlier `2026-07-13-cnc-*` dossiers, especially motion/process/metrology and interpreter/restart/simulation

## Executive verdict

A CNC setup is not a collection of numbers typed into dialogs. It is a graph of calibrated relationships with evidence, uncertainty, scope, and invalidation rules:

```text
machine reference
  -> machine geometry and compensation revision
  -> fixture/workholding transform
  -> work-coordinate system
  -> stock/part registration
  -> spindle/tool-holder/tool assembly
  -> tool-length/radius compensation
  -> probe/tool-setter calibration
  -> operation-specific measurement results
  -> permitted motion and process envelope
```

Every downstream path assumes some part of that graph. A green probe toast or a remembered `G92 Z0` cannot prove the chain.

The live KerfDesk snapshot already contains useful foundations: a two-stage GRBL touch-plate cycle, bounded travel, explicit ALARM:4/5 handling, per-line command pacing, CNC-only UI, command arbitration against active jobs/motion, homing with a controller settle marker and fresh Idle, WCO caching, persistent G54 controls, work-Z invalidation after resets/tool changes, and focused tests.

The first-pass audit found several high-risk boundaries.

1. **Probe completion is declared before the final retract/park is physically complete.** G38.2 itself is a blocking controller transaction in classic GRBL, but the sequence ends with ordinary G0/G90 lines. Their `ok` responses mean accepted/queued, so `runProbeSequence()` resolves success, clears `probeBusy`, sets `workZZeroKnown`, and enables other commands while the final retract or corner park can still be moving.
2. **The application never parses the authoritative `[PRB:x,y,z:success]` result.** It trusts the line-level `ok`, never records the trigger coordinate or success flag, cannot compare the second touch with the first, and cannot retain a measurement artifact. GRBL explicitly exposes PRB because parser/current/trigger positions are different facts.
3. **Corner probing is not transactional.** The cycle writes Z, then X, then Y offsets as it proceeds. A failure after one leg leaves a partially modified active WCS, possibly G91, and an ambiguous physical pose. The UI reports one failed cycle but has no rollback/reconciliation plan.
4. **The corner-plate model is provisional and uncalibrated.** It assumes a generic plate center 15 mm from the stock corner and side faces flush with the stock, compensates only cutter radius, and stores neither plate identity nor calibrated side offsets. Many real corner plates have lips, walls, recesses, and axis-specific offsets. Plate thickness is a transient UI value reset to a 15 mm default.
5. **`workZZeroKnown` is a boolean and only an advisory gate.** Manual `G92 Z0` and a full multi-leg probe both produce the same `true`; there is no source, timestamp, WCS, tool, plate, calibration, controller epoch, measured coordinate, uncertainty, or expiry. Start lets the operator override the missing-Z warning.
6. **Homing lifecycle is stronger than Start policy.** `$H` is treated as a long blocking operation, followed by a planner-draining marker and fresh Idle before `homingState='confirmed'`. Yet Start never consumes `homingState`, even when `$22` says homing/soft-limit assumptions apply.
7. **WCS ownership is ambiguous.** Native output does not select G54. Persistent-origin commands write P1/G54 without selecting it; touch probing writes P0/the currently active WCS; the console can select G55–G59 or install TLO/G92. The same project can therefore bind to a different frame without changing bytes.
8. **The tool model describes cutting shape, not the installed assembly.** It stores ID/name/kind/diameter and optional angle, but no pocket, holder/gauge line, measured length/radius, stickout, flute length, runout, calibration, loaded-tool evidence, life/breakage state, or controller TLO. Multi-tool output pauses for manual changes but has no durable tool-measurement transaction.

The deeper controller-state audit found four additional P0 boundaries that outrank several of those gaps:

9. **Probe is outside the shared controller-operation arbiter.** It sets only `probeBusy`, writes directly to the connection, and installs an uncorrelated line listener. Start, Console, settings reads, and Disconnect do not gate on `probeBusy`. Another operation's `ok` can advance the probe sequence; Start can create a streamer while the listener is live; Disconnect can close the port during G38.2 without the normal unsafe-active recovery path.
10. **Origin, Z-zero, and alarm truth are committed after transport write, not controller acceptance.** `safeWrite()` resolves after `conn.write()` and merely records a terminal-ack debt. Origin actions immediately infer WCO or set `workZZeroKnown=true`; `$X` clears visual alarm state. A later `error:N` drains the debt but does not roll back the false semantic fact.
11. **Planned tool change and crash resume can start the spindle while the cutter is stationary at the work.** Fresh Start correctly retracts before `M3`, but the post-`M0` continuation and generated resume prefix emit spindle start/dwell before their first safe-Z motion. Idle proves controller motion state, not cutter clearance or disengagement.
12. **Start and Resume do not consume a qualified setup snapshot.** Reference, active WCS, separate XY/Z datum evidence, loaded tool and length, fixture/stock registration, probe calibration, modal/settings hash, and compensation revision are absent from the checkpoint and gates. Resume discards the advisory list that fresh Start presents.

The correct design is a setup-truth ledger plus typed probing/measurement transactions. Raw trigger input, calibrated measurement, offset proposal, offset commit, and subsequent verification must be different states.

## 1. The setup truth model

### 1.1 Reference is not datum

Machine homing/reference establishes an axis coordinate relationship to switches, encoder marks, or absolute encoders. It does not locate the part, stock surface, fixture, tool tip, or probe sphere.

Useful distinct frames include:

```text
joint/encoder frame
machine frame
kinematic world/tool-center frame
fixture frame
work coordinate system (G54...)
stock frame
design/setup frame
tool-gauge frame
probe-stylus frame
```

A transform needs both value and provenance:

```ts
type QualifiedTransform<A, B> = {
  from: A;
  to: B;
  transform: RigidTransform;
  source: EvidenceSource;
  controllerEpoch: string;
  calibrationRevision?: string;
  measuredAt: string;
  uncertainty: UncertaintyBudget;
  applicability: ApplicabilityConditions;
  invalidatedBy: readonly InvalidationRule[];
};
```

### 1.2 Program coordinates are a transform stack

For a three-axis mill/router, the commanded tool point can depend on:

```text
program XYZ
  + active WCS
  + G52/G92 local/global offsets
  + tool-length compensation
  + machine compensation and kinematics
  -> controlled point / joints / motors
```

An origin button must name which layer it changes. “Zero Z” using G92, writing G54 with G10, and applying G43.1 are not interchangeable.

### 1.3 Measurement has five products, not one number

Every probing/setting workflow should retain:

1. **Raw acquisition:** trigger input, sampled machine position, direction, speed, filter/latency, controller time/sequence.
2. **Calibrated observation:** trigger point corrected by the applicable probe/tool-setter calibration.
3. **Derived measurand:** surface, bore center/diameter, corner transform, tool length/radius, or breakage result.
4. **Proposed correction:** WCS/TLO/wear/fixture update with old/new values and tolerance policy.
5. **Committed state:** exact controller write, acknowledgement, readback, controller epoch, operator/program authority, and verification.

Collapsing these into “Probe complete — work zero is set” removes the information needed to diagnose or safely resume.

### 1.4 Repeatability, accuracy, resolution, and uncertainty

- **Resolution** is the smallest reported/countable increment.
- **Repeatability** describes dispersion under specified repeated conditions.
- **Accuracy/trueness** depends on systematic calibration and the reference artifact.
- **Uncertainty** combines relevant components and declares confidence/applicability.

A probe can repeat tightly while measuring the wrong location because stylus radius, pretravel, runout, plate thickness, trigger latency, thermal state, or frame conversion is wrong.

## 2. Probe motion is a controller transaction

### 2.1 G38 variants

LinuxCNC defines:

| Code | Direction | Target transition | Failure behavior |
| --- | --- | --- | --- |
| G38.2 | toward surface | open -> triggered | program error/stop if no trigger |
| G38.3 | toward surface | open -> triggered | no-error result if no trigger |
| G38.4 | away from surface | triggered -> open | program error/stop if no release |
| G38.5 | away from surface | triggered -> open | no-error result if no release |

The move is straight in the commanded multi-axis vector at the active feed. A successful trigger stops motion within the controller's acceleration behavior; the result belongs to the configured controlled point and current coordinate context. LinuxCNC exposes result parameters #5061–#5069 and success #5070. Source: [LinuxCNC G38.n](https://www.linuxcnc.org/docs/html/gcode/g-code.html#sec:G38-probe).

### 2.2 Classic GRBL's exact pipeline

Classic GRBL's `mc_probe_cycle()`:

1. drains all queued commands;
2. configures toward/away input polarity;
3. checks the required initial probe state;
4. queues the probe motion;
5. activates stepper-ISR monitoring;
6. waits until contact/no-contact completes and the machine returns Idle;
7. cancels the remaining probe path and re-synchronizes planner position;
8. records/report the probe position and success;
9. only then returns to the parser and emits `ok`.

The stepper ISR copies `sys_position` at the trigger tick and raises motion cancel. Sources: [GRBL probe input/ISR](https://github.com/gnea/grbl/blob/master/grbl/probe.c) and [GRBL probe cycle](https://github.com/gnea/grbl/blob/master/grbl/motion_control.c).

This means KerfDesk's assumption that a G38.2 `ok` marks that individual probe motion complete is justified for classic GRBL. It does **not** make the ordinary retract/park lines after it completion-fenced.

### 2.3 PRB is required evidence

GRBL `$#` reports:

```text
[PRB:x,y,z:1]  successful trigger
[PRB:x,y,z:0]  unsuccessful/no-error probe
```

PRB is non-persistent across reset. Optional firmware configuration can report it immediately after each successful probe; otherwise `$#` reads it. Source: [GRBL parameter reporting](https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md).

A host should capture PRB, bind it to the exact probe command and controller epoch, verify its success flag and direction/travel bounds, and compare repeated touches. An `ok` alone proves the cycle ended, not which calibrated surface was measured.

### 2.4 Trigger coordinate and stopped coordinate are different

The input changes at one sampled position; physical deceleration/compliance can move the mechanism further before complete standstill. Controllers may report a latched trigger coordinate while their current position later reflects the stopped location. Measurement software must state which one it uses and how calibration at the same direction/speed/filter compensates dynamic pretravel.

Two-stage probing is valuable because the slow second touch reduces direction/speed-dependent error. It is not a substitute for capturing the trigger result, calibrating the sensor/tool/plate, and verifying repeatability.

### 2.5 Initial-state, miss, and stuck-input policy

A robust cycle proves before moving:

- correct probe/tool-setter selected and connected;
- expected inactive/active initial state for toward/away motion;
- spindle/process off;
- valid machine reference and coordinate transform;
- bounded target inside machine limits;
- known clearance to the search start;
- feed and overtravel appropriate for the sensor/stylus/tool;
- no competing motion/command authority.

Failure is not followed by normal setup commands. The transaction enters a recovery state that preserves current modal/offset mutations, blocks further automation, and requires reconciliation.

## 3. Public controller architecture lessons

### 3.1 LinuxCNC: acquisition is motion/HAL, meaning is interpreter/task

The probe input is a HAL signal consumed by realtime motion. The interpreter owns G38 semantics, result parameters, frame conversion, and program error behavior. Tool measurement can cancel TLO with G49, probe, convert the work-coordinate result to machine coordinates, write the tool table with G10 L1, then apply G43. Source: [LinuxCNC probing and tool-height example](https://www.linuxcnc.org/docs/html/gcode/g-code.html#sec:G38-probe).

The architecture separates:

```text
probe electrical signal
  -> realtime latched motion result
  -> interpreter result parameters
  -> measurement macro/cycle
  -> tool/WCS correction proposal
  -> tool table or offset commit
  -> application/readback
```

### 3.2 grblHAL: probe capability is a runtime hardware contract

Current grblHAL can register multiple typed probe inputs, including a default probe, second probe, and tool setter. Capabilities include connected, latchable, watchable/guarded, input polarity, selection, and probe protection outside a probing cycle. Driver/plugin/build determine what actually exists. Source: [grblHAL probe abstraction](https://github.com/grblHAL/core/blob/master/probe.c).

Therefore a sender cannot safely set `probing: true` from the family name alone. It needs reported probe identities/capabilities and must bind a workflow to the chosen input.

### 3.3 FluidNC: configuration owns electrical and machine meaning

FluidNC preserves GRBL-compatible G38 behavior while its runtime machine configuration owns axes, inputs, kinematics, and stepping. A firmware label is not proof that the active YAML contains a usable Z axis, probe pin, polarity, or intended tool setter. The controller configuration identity belongs in the setup evidence.

### 3.4 Tool setters are not interchangeable with work probes

A work probe measures work/fixture features using a calibrated stylus assembly. A fixed tool setter measures the loaded cutting tool relative to the machine/gauge frame. A conductive touch plate uses the cutter itself as the sensing element. Their coordinate transforms, calibration, allowed directions, trigger forces, failure modes, and resulting correction targets differ.

One boolean `probing` capability cannot express these workflows.

### 3.5 LinuxCNC result frame and protection behavior

LinuxCNC stores G38 results in `#5061` through `#5069` in the **current work coordinate system**, with `#5070` as success. The official tool-height example converts between work and machine coordinates before writing the tool table. This differs from GRBL-family PRB, which reports machine-coordinate step position. The adapter, not generic UI code, must own that distinction. Sources: [LinuxCNC G38 reference](https://www.linuxcnc.org/docs/html/gcode/g-code.html#gcode:g38), [interpreter source](https://github.com/LinuxCNC/linuxcnc/blob/master/src/emc/rs274ngc/interp_convert.cc), and [tool compensation](https://linuxcnc.org/docs/master/html/en/gcode/tool-compensation.html).

LinuxCNC's realtime motion layer samples the HAL probe signal, copies Cartesian feedback into the probed position, and aborts trajectory motion. Current motion code can also abort ordinary coordinated motion, homing, or jogs on a probe edge outside a probe operation unless the integrator configures otherwise. HAL debounce can condition the signal, but each added sample produces feed-dependent spatial bias. Filtering therefore belongs in the calibration/uncertainty fingerprint.

Its tool-table operations also express useful intent: G10 L1 writes an absolute entry; L10 calculates in current fixture context; L11 calculates against fixed G59.3, supporting a machine-mounted setter. Probe acquisition remains separate from the persistent tool-table commit and later G43 application.

### 3.6 grblHAL's built-in setter pattern

grblHAL preserves GRBL's synchronized probe structure but records the active G5x identity, can soft-limit the target, supports driver/plugin probe hooks, and may choose normal or faster cancellation. Its semi-automatic tool-change path uses a machine-fixed G59.3 setter location, fast probe, release/retract, slow probe, and a runtime TLO reference. Subsequent tools receive TLO relative to that reference; homing the relevant axis deliberately invalidates it. Sources: [grblHAL motion control](https://github.com/grblHAL/core/blob/master/motion_control.c), [tool change](https://github.com/grblHAL/core/blob/master/tool_change.c), and [probe abstraction](https://github.com/grblHAL/core/blob/master/probe.c).

This is a strong small-controller pattern, but not durable setup truth by itself. G59.3 must be qualified in the current reference epoch; driver `connected` and edge-latching semantics vary; open-loop commanded position is not independent physical feedback; and runtime TLO reference cannot survive reset/homing silently.

### 3.7 FluidNC: event latency, hard stop, and nonstandard auto-offset

FluidNC keeps the GRBL-like cycle but its configuration can define a normal probe pin and separate tool-setter pin whose states are ORed. Result provenance may therefore not reveal which physical input triggered. Normal behavior captures steps then requests controlled cancellation; optional `hard_stop` immediately resets stepper/planner and sets Idle. Hard stop can reduce commanded overshoot while increasing physical-position uncertainty because inertia may continue after open-loop steps cease. Source: [FluidNC Probe.cpp](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Probe.cpp) and [MotionControl.cpp](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/MotionControl.cpp).

Its GPIO changes are detected by polling, queued through an event path, and later handled by probe protocol code. The published ESP32 path has an event rate limit rather than a stable-state debounce. Capture latency is therefore a build/configuration property that should be measured at supported feeds, not assumed equivalent to GRBL's stepper-ISR latch.

FluidNC also adds nonmodal G38.6-G38.9 and a single-axis `P` form that can directly update the active WCS from contact. This narrows a host-side result/write race but makes the probe command itself a persistent coordinate mutation. It must be capability-gated, tied to explicit active-WCS evidence, and read back; it must never be emitted as generic GRBL.

### 3.8 g2core: an explicit completion-fenced state machine

g2core is the strongest example of probe completion discipline in this comparison. Its cycle:

1. validates feed, axes, configured input, and minimum travel;
2. waits for prior planner motion to physically finish;
3. saves units, distance mode, soft-limit state, and per-axis jerk;
4. switches internal probe context and arms the chosen digital input;
5. rejects an already-triggered input;
6. executes the vector and snapshots internal position on input interrupt;
7. requests high-speed feedhold;
8. after stopping, converts the snapshot through forward kinematics;
9. commands a return to the captured contact point;
10. waits for a second planner callback before restoring state and accepting later controller tasks.

Source: [g2core probing state machine](https://github.com/synthetos/g2/blob/edge/g2core/cycle_probing.cpp), [parser](https://github.com/synthetos/g2/blob/edge/g2core/gcode_parser.cpp), and [canonical machine](https://github.com/synthetos/g2/blob/edge/g2core/canonical_machine.cpp).

Unlike GRBL/LinuxCNC, g2core deliberately makes final position return to the reported contact coordinate. Its source comments explicitly fence the race that KerfDesk currently has after final retract/park. Limits remain important: the cycle disables soft limits, does not universally stop spindle/coolant, and a short input pulse can initiate feedhold but release before later success evaluation. Tool/WCS commit is still a separate transaction.

### 3.9 Machinekit: useful separation, historical authority

Machinekit's older LinuxCNC-derived path retains interpreter -> canonical/task -> realtime motion separation, HAL probe input, G38 result parameters, and separate G10/tool-table writes. Its split between realtime HAL, CNC/interpreter, and network UI is architecturally useful. The CNC repository was last pushed in 2020 and the original monorepo is archived, so it is a historical comparison rather than a stronger current semantic authority than LinuxCNC. Sources: [machinekit-cnc](https://github.com/machinekit/machinekit-cnc), [interpreter source](https://github.com/machinekit/machinekit-cnc/blob/master/src/emc/rs274ngc/interp_convert.cc), and [motion source](https://github.com/machinekit/machinekit-cnc/blob/master/src/emc/motion/control.c).

### 3.10 Controller comparison matrix

| Controller | Capture source/path | Result frame | Stop/final pose | Persistent side effect | Host warning |
| --- | --- | --- | --- | --- | --- |
| LinuxCNC | realtime servo motion, Cartesian feedback | current work coordinates | controlled abort; stop differs from contact | G10 tool/WCS separate | convert frames explicitly; filter delay matters |
| GRBL 1.1 | stepper ISR, commanded steps | machine coordinates PRB | controlled cancel; stop can pass contact | G54-G59 persistent; PRB/G92/TLO volatile | parse PRB and read `$#`; open-loop evidence |
| grblHAL | driver probe state + stepper latch | machine coordinates; active G5x tracked | normal/fast cancel by build | hooks and TLO/setter state vary | runtime input/build capability required |
| FluidNC | polled GPIO -> event queue -> protocol capture | GRBL-like machine coordinates | controlled cancel or hard stop | optional G38 `P` can write WCS | input provenance/latency/config are machine-specific |
| g2core | input interrupt snapshot + planner callbacks | converted Cartesian result | feedhold then return to contact; completion fenced | offset/tool writes separate | soft limits disabled during probe; input stability matters |
| Machinekit | realtime motion feedback via HAL | LinuxCNC-like work coordinates | controlled trajectory abort | tool/WCS writes separate | historical implementation; verify target fork |

The minimum capability record for a connected controller must include supported variants/axes, probe and setter input identities, connected-state availability, capture source and scheduling, stop policy, coordinate frame, final-pose relation, no-error semantics, reset volatility, WCS/TLO persistence, outside-cycle protection, and measured input-to-capture latency for that exact build.

## 4. Industrial setup and metrology workflow

### 4.1 Setup is staged

A mature mill setup commonly follows:

```text
reference/qualify machine
  -> load and identify fixture
  -> establish/verify fixture transform
  -> load stock and prove workholding
  -> load tool/probe assemblies
  -> measure/calibrate tool and probe systems
  -> establish WCS/part alignment
  -> verify clearance/stock/fixture assumptions
  -> dry-run or protected first execution
  -> in-process tool/part monitoring
  -> final/independent inspection
```

The sequence is a dependency graph: changing a stylus, tool, holder, fixture, WCS, compensation map, temperature regime, or machine reference invalidates specific downstream evidence.

### 4.2 Haas WIPS pattern

Haas WIPS distinguishes table tool probe and spindle work probe. The documented calibration sequence starts with installation/operation checks, trams/indicates the work probe, calibrates the tool probe, then calibrates spindle-probe length and diameter with known artifacts. Haas warns that work and tool probes have conflicting activation conditions on some machines. Source: [Haas WIPS calibration](https://www.haascnc.com/service/online-operator-s-manuals/wips---interactive-operator-s-manual-supplement/wips---calibration.html).

The software pattern is important: a guided template collects artifact/tool values and generates a controller-native cycle, rather than exposing a raw skip input as “set zero.”

The actual dependency chain is three coupled calibrations: a known straight/round tool calibrates the table tool probe; that calibrated tool then establishes spindle-probe length; a known ring gauge establishes probe radius/XY behavior. The calibration tool must be checked for runout. Haas states that recalibrating with a different calibration tool requires all offsets to be remeasured. Operator tool setup selects the tool-table row/type/dimensions and automatic probe action; work setup jogs the spindle probe near the feature, selects the target work-offset row, enters expected geometry/clearances, and runs the generated cycle. Sources: [Haas WIPS operation](https://www.haascnc.com/service/online-operator-s-manuals/wips---interactive-operator-s-manual-supplement/wips---operation.html) and [WIPS troubleshooting](https://www.haascnc.com/service/troubleshooting-and-how-to/troubleshooting/Wireless-Intuitive-Probe-System-WIPS-Troubleshooting-Guide.html).

Haas' QC20/ballbar workflow separately records certificate/calibrator data, allows at least 30 minutes of thermal acclimatization, fixes feed/test radius, and tests every applicable plane. That is verification of machine motion, not probe calibration. Source: [Haas QC20 procedure](https://www.haascnc.com/service/troubleshooting-and-how-to/how-to/ballbar---qc20-w---analysis.html).

### 4.3 Renishaw calibration pattern

Renishaw treats the probe as one component in a measurement chain. Calibration compensates the constant difference between physical touch and reported trigger. A spindle probe normally requires:

- stylus on-center/runout adjustment;
- length calibration on a known surface;
- stylus-ball radius/trigger calibration in a ring gauge or on a datum sphere;
- spindle-center offset calibration;
- the same relevant orientation, speed/filter, stylus, extension, and machine condition used later.

Recalibration is required after first installation, stylus/filter change, crash or suspected distortion, poor relocation repeatability, mechanical change, and at defined intervals. Sources: [Renishaw machine-tool probe calibration](https://www.renishaw.com/media/pdf/en/16e3072937914b54968e8476692b76e4.pdf) and [RMP400 calibration guidance](https://www.renishaw.com/resourcecentre/download/installation-guide-rmp400-high-accuracy-radio-machine--136431?userLanguage=en).

### 4.4 Tool setting and breakage

Tool setting measures length and/or diameter/radius, then writes geometry or wear offsets. Broken-tool detection is a separate classification with tolerance and retry policy. Contact and non-contact setters have different contamination, speed, edge-profile, runout, and minimum-tool constraints. Source: [Renishaw tool setting software](https://www.renishaw.com/en/tool-setting-software--6251).

A failure can invalidate:

- installed tool identity;
- length/radius/wear correction;
- completion of the preceding operation;
- remaining stock near the failure;
- subsequent operations and inspection results.

It must not merely display a toast and keep the old offset.

### 4.5 SINUMERIK measurement-cycle pattern

SINUMERIK separates workpiece measurement, tool measurement, probe calibration, and offset correction. Workpiece cycles measure edges, corners, holes, bosses, rectangles, and alignment; tool cycles calibrate the setter and determine tool length/radius. Calibration must match the mechanical constellation used for measurement—plane, rotary-axis orientation, tool/probe assembly, and measuring speed. Source: [SINUMERIK measuring cycles](https://cache.industry.siemens.com/dl/files/385/109748385/att_923049/v1/840Dsl_828D_meas_cycles_progr_man_en-US.pdf).

The cycle has explicit safe area, search path, expected dimension/tolerance, repeat count, correction destination, and alarm/result behavior. Raw trigger motion is only the acquisition primitive.

### 4.6 A skip move is not a measurement cycle

Haas G31 is the clearest warning. If the skip input triggers, motion stops and the skip position is captured. If it does not trigger, the machine reaches the programmed endpoint, records that endpoint, and continues. A bare G31 can therefore convert "surface not found" into a plausible-looking coordinate unless surrounding macro logic validates the event. Haas supplies M78/M79 to alarm on unexpected or missing skip signals. Sources: [Haas G31](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dmill.value%3DG31.html) and [Haas M-code list](https://www.haascnc.com/service/service-content/guide-procedures/mill---m-codes.html).

SINUMERIK's complete cycle shows the wrapper a raw skip move needs:

1. calculate a starting pose a bounded distance from the expected surface;
2. move there through a permitted path;
3. probe at the speed associated with the calibration;
4. require the switching edge inside the permitted search window;
5. latch the realtime axis position, brake, delete distance-to-go, and retract;
6. retry or alarm on no edge;
7. fit/validate the result before any correction.

Every acquisition must declare the expected initial and terminal input states, search interval, feed, maximum braking/overtravel distance, and failure reaction. No trigger and trigger-before-motion are explicit failed results, never implicit success.

### 4.7 Protected positioning is reactive protection

Renishaw protected positioning activates the probe during an approach and stops if the stylus unexpectedly deflects. It can signal a path obstruction or a possibly misloaded part. It still assumes a valid stylus length/orientation, a safe initial plane, enough stopping distance, and correctly installed macros. Source: [Renishaw protected-positioning example, pp. 40-43](https://www.renishaw.com/resourcecentre/download?data=136292&lang=en&userLanguage=en).

SINUMERIK warns that the axis must brake within permitted probe deflection. Its example shows that a high approach speed can require millimetres of control-delay, following-error, and deceleration allowance. Therefore:

- protected positioning reacts to unexpected contact;
- geometric collision checking attempts to prevent contact;
- neither proves the other, and neither makes an arbitrary rapid safe.

### 4.8 HEIDENHAIN: typed tables, complete-cycle restart boundaries

TNC 640 probe configuration contains maximum search travel, pre-position clearance, probing feed, rapid pre-position feed, and tracking/orientation behavior. Changing tracking behavior requires recalibration. The 14xx workpiece cycles determine position and orientation under the active kinematics, and can update the active preset or write a datum/preset table row for later activation. The control can reject measurement when physical rotary-axis position disagrees with active 3-D Rotation state. Source: [HEIDENHAIN TNC 640 Measuring Cycles](https://content.heidenhain.de/doku/tnc_guide/pdf_files/TNC640/34059x-16/zyklen_messen/1303409-21.pdf).

The TT tool-cycle family separately calibrates the setter and measures length, radius, or both. Tools may be checked stationary, rotating, or tooth-by-tooth. Tool-table wear tolerances (`LTOL`, `RTOL`) and breakage tolerances (`LBREAK`, `RBREAK`) are separate policy. A breakage indication that is not configured to stop automatically leaves the application responsible for stopping before collision.

TNC restart refuses a mid-program target inside a thread or measuring cycle. Prefix scan is followed by an explicit RESTORE POSITION workflow, and tool-length compensation takes effect only after the tool call and subsequent positioning block. This is strong evidence that the complete measurement cycle, not an individual probe move, is the minimum restart transaction. Sources: [HEIDENHAIN error catalogue](https://content.heidenhain.de/doku/tnc_guide/pdf_files/Fehlermeldungen_TNC/pdf/errors_en.pdf) and [TNC 640 setup/run manual](https://content.heidenhain.de/doku/tnc_guide/pdf_files/TNC640/34059x-16/einrichten/1261174-23.pdf).

### 4.9 FANUC: fix repeatability before compensating

FANUC's public accuracy workflow orders improvement as:

1. mechanical accuracy and repeatability;
2. bidirectional/interpolated pitch compensation;
3. kinematics and tool lengths;
4. straightness, squareness, and sag compensation;
5. thermal compensation;
6. advanced volumetric compensation.

It explicitly warns that electronic compensation cannot adequately correct a repeatability problem. Loose mechanics, intermittent feedback, variable backlash, poor clamping, or contaminated measurement must not be laundered into a correction table. The same source warns that settling, wear, mechanical changes, and especially a crash can invalidate volumetric compensation. Source: [FANUC 5-axis accuracy workflow, pp. 22-26](https://www.fanucamerica.com/docs/default-source/cnc-files/mwa-030-en_01_1511_5-axis.pdf).

FANUC publicly describes manual/automatic work-coordinate and tool-offset measurement in MANUAL GUIDE i, but exact probe macros and results are commonly machine-builder integrations. Public evidence therefore supports the architecture, not portable macro numbers. Source: [FANUC MANUAL GUIDE i](https://www.fanucamerica.com/products/software/manual-guide-i).

### 4.10 BLUM, Renishaw, and Hexagon: measurement has layers

BLUM Quickstart packages combine controller subroutines, calibration, protected traverse, WCS update, tolerance checking, and bounded tool-wear/temperature correction. FormControl X adds PC/server orchestration, optimized paths, collision checks, reporting, SPC, and automatic workpiece alignment. KinematicsPerfect measures a sphere across rotary poses, can check without correction or update kinematic parameters, logs residual behavior, and is explicitly used after collisions or wear. Sources: [BLUM measuring cycles](https://www.blum-novotest.com/us/products/measuring-components/measurement-software/measuring-cycles-for-probes/), [FormControl X](https://www.blum-novotest.com/us/products/measuring-components/measurement-software/formcontrol-x/), and [KinematicsPerfect](https://www.blum-novotest.com/us/products/measuring-components/measurement-software/kinematicsperfect/).

Renishaw Inspection Plus is controller-resident macro software; Set and Inspect/GoProbe are guided generators over those macros, and results are exported through machine variables. Contact setters, non-contact laser setters, and simple broken-tool detectors have different capability envelopes. A broken-tool result can alarm, lock a tool, choose a sister tool, or flag the part, but that response belongs to process policy rather than the sensor. Sources: [Inspection Plus](https://www.renishaw.com/en/inspection-plus-software-for-machining-centres--6094) and [tool-setting technology](https://www.renishaw.com/en/tool-setting-technology--32934).

Hexagon exposes another separation: NC-facing measurement operations, machine-tool inspection/analysis software, and PC-DMIS-backed server quality workflows. Its NC Measure documentation uses explicit probe/stylus configuration and imported calibration records. LASERTRACER plus UNICAL illustrates the external compensation loop: measure from several locations, solve axis geometry/squareness, generate controller-specific tables, transfer them, then perform an independent verification measurement. Sources: [Hexagon NC measurement software](https://hexagon.com/products/product-groups/measurement-inspection-hardware/machine-tool-measurement/nc-measuring-software), [NC Measure manual](https://documentation-be.hexagon.com/bundle/UM_NCM-V02.20-REV01.00-EN/raw/resource/enus/UM_NCM-V02.20-REV01.00-EN.pdf), and [UNICAL](https://hexagon.com/products/unical).

### 4.11 Industrial workflow matrix

| Layer | Controller examples | Owns | Completion evidence |
| --- | --- | --- | --- |
| Electrical/realtime acquisition | GRBL ISR, SINUMERIK NCK, LinuxCNC motion/HAL | edge, latched position, braking/cancel | bound trigger record and stopped state |
| Cycle/macro | WIPS, Inspection Plus, SINUMERIK CYCLE97x, TNC 14xx/48x | approach, retries, feature fit, tolerance | complete cycle result, not one skip move |
| Setup UI | Haas templates, Set and Inspect, TNC tables | artifact/tool/feature choice and parameters | validated intent tied to machine profile |
| Correction policy | controller macro/cycle or supervisory software | null band, limit, target, authorization | old/new values plus readback |
| Quality/SPC | FormControl X, Hexagon, external CMM | trends, correlation, acceptance | traceable report and uncertainty basis |
| Service calibration | laser, ballbar, sphere, kinematic cycles | machine geometry/thermal/kinematic maps | versioned map plus independent verification |

## 5. Calibration and compensation

### 5.1 Compensation is derived state

Examples include:

- steps/encoder scale;
- backlash or bidirectional position map;
- screw/pitch error;
- straightness, angular, and squareness error;
- rotary center/pivot/TCP kinematics;
- spindle/tool/probe offsets;
- thermal growth;
- volumetric correction.

A compensation record requires raw calibration data, artifact/instrument traceability, environmental state, fitting method/version, direction and range, uncertainty/residuals, controller/machine revision, author/approval, activation/readback, and an independent post-application verification.

### 5.2 Do not stack unknown corrections

The same error can be compensated in drive, controller, postprocessor, CAM, sender, or measurement macro. Without ownership, corrections can double-apply or fight. The setup manifest must declare one owner per transform/error term and whether the controller report already includes it.

### 5.3 Calibration versus verification

- **Calibration** estimates/model parameters against a reference.
- **Adjustment/compensation** changes machine behavior or reported coordinates.
- **Verification** independently checks the adjusted result against acceptance criteria.

Using the same observations to fit and “verify” a map only proves the fit reproduced its training data.

### 5.4 Thermal applicability

Temperature changes spindle, screw, frame, stock, fixture, and sensor geometry. A thermal correction needs sensor identity, freshness, valid range, warm-up/load regime, model revision, and uncertainty. If those conditions are unavailable, the correction becomes unavailable; the last numeric value must not remain silently trusted.

SINUMERIK's separation is instructive: sensors feed a PLC-side model, the model produces position-independent and position-dependent parameters, and the NCK applies them at interpolation-cycle rate. Lost reference/synchronization deactivates reference-dependent temperature and position-error compensation. Haas likewise distinguishes model-based predictive thermal compensation from direct ballscrew-growth feedback and states that active compensation maintains inherent accuracy rather than repairing poor base mechanics. Sources: [SINUMERIK Extended Functions](https://support.industry.siemens.com/cs/attachments/58500592/FB2_0309_en_en-US.pdf) and [Haas Active Ballscrew Compensation](https://www.haascnc.com/productivity/product-options/active-bscrew-comp.html).

### 5.5 Correction is a bounded feedback controller

Mature systems do not add every observed deviation directly to an offset. SINUMERIK separates safe-area exceedance, dimensional warning, workpiece tolerance, a null/lower correction band, sliding averages, weighting, and large-deviation behavior. Renishaw Inspection Plus likewise supports a null band, percentage feedback, out-of-tolerance alarm, and an upper limit beyond which no offset changes. Sources: [SINUMERIK measuring cycles, pp. 51-60](https://support.industry.siemens.com/cs/attachments/109820766/828D_meas_cycles_progr_man_0123_en-US.pdf) and [Renishaw Inspection Plus tolerance model, pp. 95-97](https://www.renishaw.com/resourcecentre/download?data=136292&lang=en&userLanguage=en).

The architecture rule is:

> Measurement produces a correction proposal. A separate policy validates magnitude, direction, trend, uncertainty, target register, authorization, maximum single step, and maximum cumulative correction before commit.

An outlier can indicate debris, burr, broken tool, unclamped stock, or machine damage. Treating it as ordinary wear can push the process farther from truth.

### 5.6 Compensation taxonomy

| Layer | Corrects | Validity basis | Must not be confused with |
| --- | --- | --- | --- |
| Tool geometry | length/radius of exact tool assembly | tool, holder, seating, gauge line | wear or machine geometry |
| Tool wear | slow process trend | bounded repeated observations | one-off debris/thermal scatter |
| Work offset/preset | fixture/part pose | unchanged clamping and verified datum | axis error |
| Backlash | repeatable reversal discontinuity | repeatable mechanics and direction | loose/varying mechanics |
| Pitch/LEC | repeatable 1-D position error | referenced axis and current map | straightness/squareness |
| Sag/angularity | cross-axis structural error | load/configuration | thermal drift |
| Kinematic | rotary pivots, vectors, axis relationships | current head/table geometry | position-dependent residual error |
| Volumetric | full-workspace geometric residual | traceable external measurement and current condition | mechanical repeatability |
| Thermal | state-dependent deformation | healthy sensors/model/environment | static volumetric map |
| Process correlation | machine result versus external gauge/CMM | documented correlation | independent acceptance inspection |

The effective machine state must expose the active revision and health of each applicable layer. Path simulation against nominal geometry does not prove that a compensated physical machine follows it.

### 5.7 Measurement uncertainty budget

A result needs an explicit budget at least conceptually equivalent to:

```text
u_result^2 =
  u_artifact^2
  u_artifact_setup^2
  u_probe_repeatability^2
  u_directional_pretravel^2
  u_stylus_bending^2
  u_machine_repeatability^2
  u_encoder_resolution^2
  u_trigger_latency^2
  u_thermal_state^2
  u_surface_coolant_debris^2
  u_fixture_clamping^2
  u_feature_fit^2
```

Expanded uncertainty is `U = k * u_c`, with confidence basis stated. A component specification such as `0.3 micrometre at 2 sigma` is not `+/-0.3 micrometre measurement accuracy`. On-machine inspection is correlated with the same axes that made the part, so an independently distorted coordinate frame can make an incorrect feature appear correct. Strong acceptance claims need traceable artifacts, environmental evidence, and independent correlation.

### 5.8 Invalidation matrix

| Event | State that becomes untrusted | Required recovery |
| --- | --- | --- |
| Reset/power loss inside measurement | edge, point, result variables, commit status | discard transaction; safe recovery; rerun complete cycle |
| Lost reference/synchronization | realized WCS and reference-dependent compensation | re-reference and confirm compensation reactivation |
| Fixture/pallet/stock moved or uncertain | work transform and in-process results | identify and re-register/reprobe |
| Tool changed/reseated | tool length/radius/runout | remeasure exact assembly |
| Tool breakage | tool geometry, last operation, nearby stock | lock tool; inspect uncertain work; measure replacement |
| Probe/stylus/holder changed | qualification in affected planes/directions | recalibrate applicable sets |
| Probe collision/unexpected deflection | stylus, calibration, possibly spindle/kinematics | inspect, recalibrate, and health-check machine as needed |
| Setter or laser alignment changed | setter calibration | recalibrate and independently verify |
| Probe feed/orientation/plane/tracking changed | calibration equivalence | select matching set or recalibrate |
| Crash or machine service | kinematic/volumetric maps | external health check, remeasure, verify residuals |
| Compensation/controller/software revision | downstream coordinate truth | version/read back, verify, requalify dependents |
| Thermal sensor fault/out-of-domain state | thermal correction and precision claim | inhibit/degrade precision mode; verify with artifact |

A restart checkpoint after measurement is durable only after the probe is retracted and non-deflected, the result passed plausibility/tolerance checks, offset mutation is complete and read back, before/after values and calibration IDs are logged, and the controller is at a semantic operation boundary.

## 6. KerfDesk live setup audit

### 6.1 What is already strong

- `buildZProbeLines()` and `buildCornerProbeLines()` use fast seek, backoff, and slow re-touch.
- G38.2 provides bounded travel and controller alarms for already-triggered/no-contact states.
- the runner sends one command at a time and stops on error/alarm;
- UI requires a connected Idle GRBL-family controller and blocks overlapping probe runs;
- job, jog/frame, autofocus, and tool-change setup gates prevent common concurrency conflicts;
- probe failure text tells the operator about ALARM:4/5 and the need to unlock;
- homing uses a long activity-aware timeout, settle marker, and fresh Idle;
- reconnect/reset/alarm/home/release/tool change invalidate work-Z confidence;
- persistent-origin writes are Idle-gated;
- WCO status is cached separately from sparse individual reports;
- focused unit/UI/lifecycle tests exist.

These are useful engineering assets. The findings below concern what those tests do not prove.

### 6.2 P0: probe is outside the controller-operation arbiter

`laser-probe-actions.ts` sets only `probeBusy`; it does not claim `motionOperation` or `controllerOperation`. `runProbeSequence()` writes directly through `conn.write()` and installs a second line listener with no transaction/correlation identity.

The reverse gates omit `probeBusy`:

- Start snapshot and store-level Start gate;
- raw Console gate;
- machine-settings read gate;
- `LaserWindow` machine-operation busy computation and Disconnect UI;
- unsafe Disconnect cleanup, which recognizes only job, motion, or controller operations.

Consequences are protocol corruption, not merely confusing UI:

- Console or settings can produce an `ok` that the probe listener mistakes for its current line, advancing the physical sequence early;
- Start can create the job streamer while the probe listener remains live, giving two consumers ambiguous acknowledgement ownership;
- Disconnect can close the port while G38.2 moves without jog cancel/reset and without the normal unsafe-active notice.

All controller-writing activity needs one exclusive transaction scheduler. Home, jog, frame, origin, probe, Console, settings, streaming, tool change, reset, and Disconnect must have declared exclusivity, acknowledgement ownership, cancellation, timeout, and cleanup semantics.

### 6.3 P0: successful probe returns before final motion settles

For Z-only probing, the last physical motion is `G0 Z<retract>`, followed by `G90`. For corner probing, the last line is a G0 park. `runProbeSequence()` advances on each `ok` and resolves as soon as the final line acknowledges. Ordinary G0 acknowledgement is planner admission, not completion.

The store then executes:

```text
result = ok
  -> workZZeroKnown = true
  -> probeBusy = false
  -> toast “Probe complete”
```

while the machine can still be retracting/parking. Start, console, jog, origin, or another probe may be enabled before a fresh Idle. The sequence needs a controller-specific drain marker plus fresh stable Idle and a controller-operation state that survives timeout/disconnect.

### 6.4 P0/P1: partial offset commit and modal contamination

The XYZ cycle commits Z with G10, then X, then Y. An ALARM/write failure/timeout after any commit leaves the controller partly changed. Failure can also occur while G91 is active, and the runner does not restore or reconcile the prior modal/WCS/offset state.

Correct transaction:

```text
capture controller epoch + $G + $# + pin state
  -> acquire every required contact without committing offsets
  -> validate PRB results/repeatability/geometry
  -> calculate one proposed transform
  -> operator/program approval
  -> commit one intended WCS/TLO update
  -> read back and verify
  -> retract/park + planner drain + fresh Idle
```

If the controller cannot acquire all contacts without intermediate coordinate changes, use an explicit scratch/local frame and a compensation journal with deterministic rollback/recovery.

### 6.5 P1: PRB evidence is discarded

The line classifier can recognize status/alarm/error, but no production parser stores `[PRB:...]`. `runProbeSequence()` ignores all non-ok/non-error/non-alarm lines. It therefore cannot:

- prove which probe motion produced a trigger;
- distinguish latched trigger coordinate from later pose;
- calculate first-touch versus second-touch deviation;
- detect implausible contact direction/travel;
- store a measurement report;
- apply calibrated pretravel/plate offsets;
- bind the result to a controller epoch.

### 6.6 P1: family-level probing capability is too broad

`grblHalDriver` copies classic GRBL capabilities, and `fluidncDriver` inherits them, so `probing: true` is declared for every build/config of those families. grblHAL support can be driver/plugin/input dependent; FluidNC YAML can describe different axes and pins. The device-profile comments already admit some grblHAL laser builds reject G38.2.

Capability negotiation needs axis availability, probe identities, connected/trigger state, polarity, protection/latching, tool-setter versus work-probe role, supported G38 variants, and result/report grammar.

### 6.7 P1: setup geometry is not a calibrated artifact

`probe.ts` labels its corner model provisional. Constants encode:

- plate center = 15 mm from corner;
- side clearance = 35 mm;
- flank drop = 6 mm;
- plate-top clearance = 5 mm;
- final outside park = 5 mm;
- only cutter radius corrects X/Y contact.

The UI exposes only plate thickness, max travel, and bit diameter; values are component-local, not stored with a named plate/calibration. There is no plate side-wall/lip offset, axis-specific trigger correction, diameter/runout measurement, calibration date, or proof that the selected project tool is physically loaded.

### 6.8 P1: boolean work-Z evidence and overridable Start

`workZZeroKnown` becomes true after manual `G92 Z0` acknowledgement or only after the entire corner sequence returns ok. It does not say which WCS, tool, plate, stock, controller session, or contact produced Z0. CNC Start warns but permits “Start anyway.”

For cutting, the required evidence is closer to:

```ts
type WorkSurfaceEvidence = {
  frame: WorkCoordinateSystemIdentity;
  surface: 'stock-top' | 'table' | 'fixture' | 'model-datum';
  source: ManualTouchOff | TouchPlateMeasurement | WorkProbeMeasurement;
  toolAssemblyId: string;
  controllerEpoch: string;
  machineReferenceEpoch: string;
  measuredAt: string;
  uncertaintyMm: number;
  validity: 'qualified' | 'provisional' | 'invalid';
};
```

Cutting Start should require evidence that matches the compiled setup and active tool, not a session boolean.

### 6.9 P1: homing is tracked but not a Start input

`runHomeAction()` correctly holds `homingState='homing'` through `$H`, a settle marker, and fresh Idle; failure returns to `unknown`. `findMachineStartIssues()` checks Idle/alarm/busy state but never `homingState` or `$22`/soft-limit requirements.

The policy must distinguish machines without reference capability from machines configured to require homing. `unknown` is not equivalent to `not applicable`.

### 6.10 P1: active WCS is not established or read back

- persistent origin writes `G10 L20 P1` (G54) but does not select G54;
- probe writes `G10 L20 P0`, meaning whichever WCS happens to be active;
- native CNC prologue does not select G54;
- console can change WCS/G92/TLO;
- `$G`/`$#` are not parsed into Start evidence.

This is a cross-layer setup defect: UI source labels can disagree with controller frame meaning.

### 6.11 P1/P2: tool library has no measurement state

`CncTool` contains cutting kind, nominal diameter, and optional angle. It cannot represent installed assembly, measured geometry, or compensation. Custom tools and feeds live in best-effort local storage beside projects; no controller tool table or loaded-tool state is reconciled.

Manual tool changes therefore rely on an M0 label and operator touch-off, with no tool identity scan, pocket, gauge-line length, measurement result, runout/stickout, breakage status, or readback. Any tool change invalidates the Z boolean, which is correct but too coarse.

### 6.12 P0: origin/Z/alarm facts are recorded before controller acceptance

`laser-safe-write.ts` resolves after the transport write and records how many terminal acknowledgements are owed. It does not wait for the corresponding `ok` or `error`. Several actions interpret that transport success as semantic success:

- Set XY Origin immediately marks the work origin active and infers WCO;
- Zero Z immediately sets `workZZeroKnown=true`;
- tests explicitly expect origin success without a controller `ok`;
- `$X` immediately clears the visual alarm state.

If the controller later returns `error:N`, the untracked-ack count drains and a notice appears, but the origin/Z/alarm fact is not rolled back. Start waits for the debt to reach zero; it does not distinguish accepted from rejected semantic mutation.

Persistent origin is additionally a non-atomic two-command mutation: clear G92, then write G10. Partial acceptance can remove one transform and fail to establish the other.

The evidence phases must be distinct:

```text
commanded -> transport-written -> controller-accepted
  -> read back -> physically/operator qualified
```

A rejection invalidates every dependent fact.

### 6.13 P0: planned tool change and crash resume restart the spindle before clearance

Fresh native CNC Start follows the correct local order: `G0 Z<safe>` precedes `M3`. The multi-tool continuation does not. After M0, the emitter appends spindle start and dwell, then later emits the first safe-Z motion. The current test asserts only that the first _motion_ is a Z retract, so it misses the `M3/G4` already placed before that motion.

`continueToolChange()` requires fresh Idle but not:

- expected physical tool confirmation;
- matching work-Z/tool-length evidence;
- touch plate removal;
- a verified cutter-clear pose;
- offset readback.

`resume-program.ts` emits the same hazardous order: spindle start/dwell, then `G0 Zsafe`. There is no universally safe automatic order when engagement is unknown. If the cutter is proven clear, retract before spindle. If it may be embedded, use a guided manual recovery; starting in place or retracting a stationary embedded cutter can each be destructive.

### 6.14 P0: Start and Resume have no qualified setup snapshot

`homingState` exists, but `MachineStartSnapshot` does not include it. Machine-coordinate placement trusts offsets when homing is configured, rather than when reference is confirmed in the current epoch. Work Z is advisory, and `prepareResume()` discards the warning list returned by common preparation.

The recovery checkpoint records program fingerprint, origin placement, sendable/acknowledged counts, and timestamps. It does not record:

- controller/boot/reference epoch;
- active WCS, G92, and TLO readback;
- separate XY and Z datum evidence;
- loaded tool and measured length;
- stock and fixture registration;
- probe/tool-setter calibration;
- modal/settings/compensation revision;
- last physically committed semantic operation.

There is also an axis-truth bug: `hasCustomOrigin()` treats nonzero Z WCO as a custom origin. The status handler promotes that to `workOriginActive`, and User Origin consumes it as XY proof. A Z-only touch-off can therefore satisfy the XY-origin predicate after a WCO report.

Setup truth must be axis-specific, epoch-bound, and policy-specific. Both fresh Start and Resume must consume the same qualified snapshot, with Resume imposing stricter engagement and semantic-boundary requirements.

### 6.15 P0/P1: raw Console can silently contaminate setup and settings

The Console accepts arbitrary one-line G-code while Idle. It can select G55, enable G43.1, change plane, apply G92/G10, start process outputs, or move. Native CNC output establishes only units, absolute distance, and feed mode; it does not establish/read back plane, active WCS, cutter compensation, TLO, or coolant baseline.

An earlier Console `G55` can make probing update G55, persistent-origin UI update G54 while leaving G55 active, and native output continue in G55. A Console `$32=1` write is also permitted after confirmation, but Console invalidates cached settings only for `$$`, not for a setting write. Start can retain a stale `$32=0` snapshot and approve CNC cutting in laser mode.

Every mutating Console command must either be typed and invalidate its dependent evidence, or force fresh `$G`, `$#`, settings, and status reconciliation before Start.

### 6.16 P1: physical setup geometry remains mostly design intent

Stock is a project rectangle/thickness, not a measured stock instance. Fixtures/no-go zones are 2-D rectangles without height, holder/tool swept volume, identity, revision, or physical-presence confirmation. Stock-footprint checking is advisory and explicitly omits job-placement offsets. Z jog is enabled for CNC projects without an app-side Z envelope or fixture-height gate, and Z-only jog deliberately bypasses XY no-go-zone checks.

Status reports also have no receive timestamp/sequence, so retained Idle/WCO can be consumed without freshness proof. Controller settings are session-cleared on disconnect, but readiness has no controller identity, firmware/build signature, age, or settings hash. Profile merging can fill unreported values from the selected profile and present them alongside read controller facts.

The domain must distinguish _project intent_ from _measured setup instance_. A stock drawing, tool choice, or fixture rectangle becomes machine evidence only after identity/registration/qualification in the current reference epoch.

## 7. Target setup-truth architecture

### 7.0 One controller transaction arbiter

The transport must have one owner for command/response correlation. A transaction declares:

```ts
type ControllerTransaction = {
  id: string;
  kind: 'home' | 'jog' | 'frame' | 'origin' | 'probe' | 'console' |
    'settings' | 'stream' | 'tool-change' | 'reset' | 'disconnect';
  authority: 'exclusive' | 'realtime-sideband';
  expectedResponses: readonly ResponseExpectation[];
  completionFence: CompletionFence;
  cancel: CancellationPolicy;
  timeout: TimeoutPolicy;
  recovery: RecoveryPolicy;
};
```

Status polling and explicitly supported realtime bytes may be sideband; ordinary command acknowledgements, result records, alarms, and cancellation belong to exactly one active transaction. Disconnect is itself a transition that must first bring the active transaction to a known recovery state.

Evidence is not a boolean:

```ts
type Evidence<T> = {
  value: T;
  phase: 'commanded' | 'accepted' | 'read-back' | 'operator-confirmed' | 'measured';
  source: string;
  connectionEpoch: string;
  controllerBootEpoch: string;
  referenceEpoch?: string;
  timestamp: number;
  dependencies: readonly EvidenceId[];
  invalidation: readonly InvalidationRule[];
};
```

### 7.1 Setup manifest

```ts
type QualifiedSetup = {
  setupId: string;
  machine: MachineQualificationRef;
  controller: ControllerBuildConfigRef;
  controllerEpoch: string;
  reference: MachineReferenceEvidence;
  compensation: CompensationBundleRef;
  fixture: FixtureRegistration;
  workFrame: WorkFrameEvidence;
  stock: StockRegistration;
  toolAssemblies: readonly QualifiedToolAssembly[];
  probes: readonly QualifiedProbeAssembly[];
  measurementPolicy: MeasurementPolicy;
  createdAt: string;
  invalidation: readonly InvalidationEvent[];
};
```

Fresh Start and Resume compile that ledger into one immutable `QualifiedSetupSnapshot` containing fresh status/controller identity, per-axis reference confidence, active WCS plus G54-G59/G92/TLO readback, separate XY/Z datums, expected and loaded tool/length evidence, stock/fixture registration, calibration revisions, modal/settings hash, process interlocks, and compensation revisions. Job bytes and checkpoints carry the snapshot fingerprint.

### 7.2 Probe and tool-setter assemblies

```ts
type QualifiedProbeAssembly = {
  id: string;
  role: 'work-probe' | 'tool-setter' | 'conductive-plate' | 'breakage-sensor';
  controllerInput: ProbeInputIdentity;
  stylusOrPlateGeometry: GeometryRevision;
  mountTransform: QualifiedTransform<'mount', 'sensor'>;
  calibration: ProbeCalibrationRevision;
  supportedDirections: readonly ProbeDirection[];
  speedFilterEnvelope: MeasurementEnvelope;
  uncertainty: UncertaintyBudget;
  status: 'qualified' | 'due' | 'invalid';
};
```

### 7.3 Tool assembly

```ts
type QualifiedToolAssembly = {
  assemblyId: string;
  nominalTool: CuttingToolRevision;
  holder: HolderRevision;
  pocketOrManualSlot?: string;
  gaugeLineLength: Measurement<LengthMm>;
  radiusOrDiameter: Measurement<LengthMm>;
  stickout: LengthMm;
  fluteLength: LengthMm;
  runout?: Measurement<LengthMm>;
  controllerOffset: ControllerToolOffsetEvidence;
  loadedEvidence: ToolIdentityEvidence;
  life: ToolLifeState;
  integrity: 'verified' | 'suspect' | 'broken' | 'unknown';
};
```

### 7.4 Measurement transaction

```text
prepare
  -> reconcile controller/modal/reference/setup state
  -> select and test correct sensor
  -> protected move to verified start pose
  -> bounded search acquisition
  -> latch raw trigger result
  -> retract and re-touch as policy requires
  -> validate repeats, direction, travel, tolerances
  -> derive geometry/transform/tool measurement
  -> propose correction
  -> commit/read back atomically
  -> retract/park, drain planner, fresh Idle
  -> publish evidence and invalidate dependents
```

### 7.5 State machine

```ts
type MeasurementState =
  | { kind: 'idle' }
  | { kind: 'preflight'; transaction: MeasurementIntent }
  | { kind: 'positioning'; protectedMove: ProtectedMove }
  | { kind: 'searching'; search: ProbeSearch }
  | { kind: 'latched'; raw: RawProbeObservation }
  | { kind: 'validating'; observations: readonly RawProbeObservation[] }
  | { kind: 'awaiting-correction-approval'; proposal: CorrectionProposal }
  | { kind: 'committing'; proposal: CorrectionProposal }
  | { kind: 'settling'; commit: CorrectionCommit }
  | { kind: 'complete'; evidence: MeasurementEvidence }
  | { kind: 'recovery-required'; incident: MeasurementIncident };
```

Timeout, disconnect, reset, alarm, or unexpected trigger enters `recovery-required`; it never returns directly to idle and never leaves command authority open while motion may continue.

### 7.6 Offset commit contract

Every correction commit records:

- old and proposed values;
- exact target (G54 axis, G92, tool geometry/wear register, dynamic TLO);
- full frame equation and units;
- calibration/measurement IDs;
- tolerances and correction limits;
- exact emitted controller commands;
- acknowledgement and controller readback;
- operator/program authority;
- controller epoch and invalidated downstream artifacts.

## 8. Recommended KerfDesk workflows

### 8.1 Conductive Z plate, first qualified version

1. Select a named calibrated plate profile.
2. Confirm physically loaded tool/assembly.
3. Require known machine/reference policy and intended WCS.
4. Read `$G`, `$#`, and fresh pin state; prove probe input open.
5. Confirm spindle stopped and protected starting clearance.
6. Fast seek with bounded travel.
7. Capture/validate PRB.
8. Retract to proven clearance and drain.
9. Slow re-touch at the plate calibration speed; capture PRB.
10. Compare touch deviation against a repeatability limit.
11. Calculate a WCS/TLO proposal using calibrated plate thickness and the exact trigger coordinate.
12. Commit one explicit target, read it back, retract, settle, and publish evidence.

### 8.2 XYZ corner setup

Use a fully defined plate geometry/profile with side/lip offsets and allowed corners. Acquire contacts without progressively redefining the frame, fit the corner transform, report residuals, then commit a single WCS transform. Reject results if tool diameter/loaded identity, plate seating, approach clearance, or contact consistency is unknown.

### 8.3 Manual tool change

```text
safe retract/park and planner drain
  -> spindle/process off
  -> identify requested and installed tool
  -> measure/touch off with named method
  -> validate/read back tool-length evidence
  -> prove touch plate/setter is removed and cutter is disengaged
  -> retract to clearance while spindle remains off
  -> spindle start/at-speed
  -> verified approach/lead-in
```

Do not use a generic work-Z reset when the machine supports a stable tool-setter/gauge-line model; preserve the work datum and update the tool assembly offset instead.

### 8.4 In-process measurement

Measurement during machining must declare whether it:

- observes only;
- updates wear;
- updates WCS/fixture alignment;
- selects/reworks/rejects a part;
- branches the operation graph.

Every side effect is bounded, logged, and included in restart eligibility. On-machine probing does not automatically replace independent final inspection because the same machine errors can affect both cutting and measurement.

### 8.5 Restart after setup or measurement

Restart is semantic, not line-based. Store the last physically committed operation boundary and the setup fingerprint that made it valid. Never target a line inside a probe, tool-measurement, calibration, compensation-write, or multi-command offset transaction. Prefix interpretation/simulation can reconstruct modal intent; it cannot fabricate a physical trigger, measurement result, operator fixture change, or completed offset commit.

If cutter engagement, reference, active frame, tool, calibration, fixture, or commit state is unknown, route to guided manual recovery:

```text
stop and classify physical engagement
  -> make machine safe under operator control
  -> re-reference if required
  -> reconcile WCS/G92/TLO/modal/compensation state
  -> identify fixture, stock, and loaded tool
  -> remeasure invalidated setup evidence
  -> move through an approved recovery path
  -> re-enter only at a semantic operation boundary
```

## 9. Priorities

### P0

1. Put probe and every other controller writer under one exclusive transaction/acknowledgement arbiter; gate Start, Console, settings, reset, and Disconnect on it.
2. Stop committing origin/Z/alarm facts after transport write. Require correlated acceptance, readback where applicable, and invalidation on rejection.
3. Keep probe authority active until a drain marker and fresh stable Idle after the final retract/park. Timeout/disconnect/ambiguous alarm enters recovery-required rather than clearing busy in `finally`.
4. Fix tool-change continuation and crash-resume order. Require a proven disengaged/cutter-clear state, touch-plate removal, tool identity/length evidence, retract-before-spindle, and at-speed/lead-in policy.
5. Make Start and Resume consume a qualified setup snapshot: reference, WCS, separate XY/Z datums, loaded tool/TLO, stock/fixture, controller/modal/settings/compensation revisions, and freshness.
6. Disable or quarantine progressive XYZ corner offset commits until the cycle is transactional; never present a partial WCS mutation as a valid frame.
7. Remove the overridable work-Z boolean as cutting authority and fix Z-only WCO being treated as XY-origin proof.

### P1

1. Parse and journal PRB result lines, success, trigger position, command identity, and controller epoch.
2. Add `$G`/`$#`/pin reconciliation and select/read back an explicit WCS.
3. Replace family-level probing with runtime build/config/input capability.
4. Add named calibrated plate/probe profiles with persistent geometry, speed, uncertainty, and expiry.
5. Replace `workZZeroKnown` with typed measurement/frame evidence and precise invalidation.
6. Make `$22`/reference policy and `homingState` a Start input where applicable.
7. Separate acquire/validate/propose/commit; retain old/new offset values and rollback/recovery evidence.
8. Extend the tool domain to installed assembly and measured compensation.
9. Type or quarantine raw Console mutations and force reconciliation after any command that can change setup or settings.
10. Add freshness/epoch identity to status, WCO, settings, reference, and measurement evidence.

### P2

1. Tool-setter workflow and controller tool-offset reconciliation.
2. Work-probe edge/corner/bore/boss/plane alignment cycles.
3. Protected positioning with fixture/stock/holder collision envelopes.
4. Repeated-touch statistics, tolerance gates, drift/control charts, and calibration due-state.
5. Tool breakage and life state integrated with operation/stock/recovery invalidation.
6. Machine compensation bundle import/readback and qualification artifacts.

### P3

1. Rotary/5-axis probe calibration and kinematic pivot/TCP identification.
2. Volumetric/thermal compensation with live sensor applicability.
3. In-process adaptive correction with bounded authority and independent verification.
4. Controller-identical measurement-cycle posts and digital-twin/HIL qualification.

## 10. Verification program

### 10.1 Pure geometry and unit tests

- every corner/plate geometry against analytic expected transforms;
- mm/inch and WCS/TLO frame conversion;
- trigger versus stopped-position handling;
- cutter/probe sphere/plate side-offset compensation;
- repeated-contact mean/range/standard deviation and outlier policy;
- uncertainty propagation and tolerance decisions.

### 10.2 Protocol and state-machine fault injection

At every command/response boundary inject:

- PRB before/after ok, missing PRB, success=0, malformed/out-of-range PRB;
- already-active, no-contact, false trigger/bounce, noisy disconnect;
- timeout while searching, retracting, committing, or parking;
- reset/door/E-stop/limit during each phase;
- stale status/PRB from a prior controller epoch;
- failure after Z commit, after X commit, and before Y commit;
- wrong WCS, G91 contamination, G92/TLO present;
- final G0 acknowledged while machine still Run.

Properties:

- no success before controller completion fence;
- no offset correction without validated acquisition;
- no partial commit presented as a valid frame;
- ambiguous failure never returns command authority to idle;
- readback must match the intended target and controller epoch.

### 10.3 Differential controller tests

- classic GRBL simulator/board with immediate PRB enabled and disabled;
- grblHAL builds with default probe, tool setter, multiple probes, protection, and no probe;
- FluidNC machine configs with/without Z/probe and different input polarity;
- LinuxCNC reference programs for G38.2–G38.5, G10, G43/G49, and result parameters.

### 10.4 Electrical and machine tests

- continuity and stuck/open/short inputs;
- electrical noise at spindle/VFD on/off and axis motion;
- probe at multiple speeds/directions/stylus orientations;
- repeated contacts against a traceable artifact;
- plate thickness/side geometry independent measurement;
- tool-setter contamination/chip and broken-tool cases;
- crash/remount/recalibration invalidation;
- cold/warm/loaded thermal states;
- independent check of committed work/tool offsets.

### 10.5 Acceptance artifacts

Retain raw trace, firmware/build/config, exact commands/responses, controller epoch, probe/tool/plate/calibration IDs, machine reference, WCS/TLO before/after, environmental state, repeats/statistics, uncertainty, operator, time, and pass criteria.

### 10.6 Current snapshot verification

The focused baseline run on 2026-07-13 passed **16 test files / 146 tests** covering probe line generation/runner/UI, origins, homing, CNC Start advisories/readiness, GRBL settings/status parsing, family drivers, CNC library persistence, project CNC data, multi-tool emission, and resume generation.

This green baseline does not contradict the findings. The current tests primarily prove command shape, simulated acknowledgement pacing, UI routing, and existing state transitions. They do not inject cross-operation acknowledgement theft, final-G0 admission while motion remains Run, partial controller rejection, stale/mismatched PRB, raw Console modal contamination, disconnect during probe, physical cutter engagement, or qualified setup/readback requirements. One passing ProbePanel test emitted an existing React `act(...)` warning.

## 11. Research source map

### Live KerfDesk evidence

- `src/core/controllers/grbl/probe.ts`: provisional geometry and progressive G10 offset writes.
- `src/ui/state/probe-actions.ts`: direct connection writer, independent line listener, `ok` pacing, and missing PRB/settle binding.
- `src/ui/state/laser-probe-actions.ts`: `probeBusy` state and post-sequence work-Z commit.
- `src/ui/state/laser-safe-write.ts`, `laser-origin-actions.ts`, and `laser-error-line.ts`: transport success versus semantic acceptance.
- `src/ui/laser/start-job-readiness.ts`, `src/ui/state/laser-job-actions.ts`, `src/ui/state/grbl-settings-actions.ts`, and `src/ui/state/laser-console-actions.ts`: reverse-operation gates and setup/settings freshness.
- `src/ui/state/laser-store-helpers.ts` and `src/ui/laser/LaserWindow.tsx`: Disconnect/unsafe-active recognition.
- `src/core/output/cnc-grbl-strategy.ts`, `src/core/cnc/cnc-multi-tool.test.ts`, and `src/core/controllers/grbl/resume-program.ts`: fresh Start versus tool-change/resume spindle-clearance order.
- `src/ui/state/laser-home-action.ts`, `src/ui/job-placement.ts`, and `src/core/recovery/job-checkpoint.ts`: reference lifecycle, placement trust, and checkpoint contents.
- `src/ui/state/laser-status-line.ts`, `src/ui/state/origin-actions.ts`, and `src/ui/job-placement.ts`: WCO inference and axis-conflated custom-origin predicate.
- `src/core/scene/machine.ts`, `src/ui/state/cnc-library-persistence.ts`, and `src/ui/machine/CncSetupPanel.tsx`: nominal tool/stock intent versus installed/measured setup.
- `src/core/controllers/controller-capabilities.ts`, `src/core/controllers/grblhal/driver.ts`, and `src/core/controllers/fluidnc/driver.ts`: family-level probe capability.

### Controller semantics and source

- [LinuxCNC G38 probing](https://www.linuxcnc.org/docs/html/gcode/g-code.html#sec:G38-probe)
- [LinuxCNC tool compensation](https://linuxcnc.org/docs/master/html/en/gcode/tool-compensation.html)
- [GRBL probe input/ISR](https://github.com/gnea/grbl/blob/master/grbl/probe.c)
- [GRBL motion/probe cycle](https://github.com/gnea/grbl/blob/master/grbl/motion_control.c)
- [GRBL `$#`/PRB reporting](https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md)
- [GRBL alarms and G-code errors](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md)
- [grblHAL probe abstraction](https://github.com/grblHAL/core/blob/master/probe.c)
- [grblHAL tool-change/tool-setter flow](https://github.com/grblHAL/core/blob/master/tool_change.c)
- [FluidNC probe implementation](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Probe.cpp)
- [FluidNC motion control](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/MotionControl.cpp)
- [g2core probing state machine](https://github.com/synthetos/g2/blob/edge/g2core/cycle_probing.cpp)
- [Machinekit CNC source](https://github.com/machinekit/machinekit-cnc)

### Industrial measurement and calibration

- [Haas WIPS calibration](https://www.haascnc.com/service/online-operator-s-manuals/wips---interactive-operator-s-manual-supplement/wips---calibration.html)
- [Haas WIPS functions](https://www.haascnc.com/productivity/probe-system/wips-r.html)
- [Haas G31 skip function](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dmill.value%3DG31.html)
- [Haas WIPS operation](https://www.haascnc.com/service/online-operator-s-manuals/wips---interactive-operator-s-manual-supplement/wips---operation.html)
- [SINUMERIK measuring cycles](https://support.industry.siemens.com/cs/attachments/109820766/828D_meas_cycles_progr_man_0123_en-US.pdf)
- [SINUMERIK compensation architecture](https://support.industry.siemens.com/cs/attachments/58500592/FB2_0309_en_en-US.pdf)
- [HEIDENHAIN TNC 640 measuring cycles](https://content.heidenhain.de/doku/tnc_guide/pdf_files/TNC640/34059x-16/zyklen_messen/1303409-21.pdf)
- [FANUC 5-axis accuracy workflow](https://www.fanucamerica.com/docs/default-source/cnc-files/mwa-030-en_01_1511_5-axis.pdf)
- [Renishaw machine-tool probe calibration](https://www.renishaw.com/media/pdf/en/16e3072937914b54968e8476692b76e4.pdf)
- [Renishaw RMP400 calibration](https://www.renishaw.com/resourcecentre/download/installation-guide-rmp400-high-accuracy-radio-machine--136431?userLanguage=en)
- [Renishaw tool setting software](https://www.renishaw.com/en/tool-setting-software--6251)
- [Renishaw probe operation/pretravel](https://www.renishaw.com/en/probe-operation--15811)
- [Renishaw Inspection Plus](https://www.renishaw.com/en/inspection-plus-software-for-machining-centres--6094)
- [BLUM measuring cycles](https://www.blum-novotest.com/us/products/measuring-components/measurement-software/measuring-cycles-for-probes/)
- [BLUM FormControl X](https://www.blum-novotest.com/us/products/measuring-components/measurement-software/formcontrol-x/)
- [Hexagon NC measuring software](https://hexagon.com/products/product-groups/measurement-inspection-hardware/machine-tool-measurement/nc-measuring-software)
- [Hexagon UNICAL](https://hexagon.com/products/unical)

## Final rule

> Never turn a trigger directly into trusted setup state. Acquire, latch, calibrate, validate, propose, commit, read back, settle, and publish evidence—and invalidate every downstream artifact whose assumptions changed.
