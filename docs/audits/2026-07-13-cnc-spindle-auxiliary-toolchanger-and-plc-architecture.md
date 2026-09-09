> **Historical research archive: 11–13 July 2026.** Published on 6 September 2026.
> Findings, scores, source claims and proposed changes below describe their recorded
> baseline; they have not been revalidated and are not current product or qualification
> evidence. Unimplemented proposals are not adopted policy. The current
> [Frame-first contract](../../PROJECT.md) governs application behaviour. See the
> [archive index](2026-09-06-preserved-audits.md) and [source manifest](2026-09-06-preserved-audits-source-manifest.json).

# CNC Spindle, Auxiliary, Tool-Changer, and PLC Architecture Deep Research

**Date:** 2026-07-13
**Status:** Research dossier, tranche 9
**Product mapped:** KerfDesk / LaserForge 2.0 `audit-current-main` at `e752a9125f02f832144c3b40800840ee5973fcf2`
**Companions:** the eight earlier `2026-07-13-cnc-*` dossiers, especially safety/operator modes, restart/interpreter semantics, and setup/probing/calibration

## Executive verdict

A machining program does not directly operate a spindle, drawbar, coolant pump, vacuum table, dust collector, door lock, or pallet changer. It requests a machine function. A controller/PLC/drive/safety chain must decide whether the request is permitted, perform a multi-step physical transaction, prove its result, and report a completion or fault that means something precise.

```text
part-program intent (M/S/T/H)
  -> interpreter and lookahead ordering
  -> NC/PLC auxiliary-function request
  -> machine sequence and permissives
  -> drive/valve/contactor command
  -> physical actuator/process
  -> sensors and safety chain
  -> accepted / ready / complete / fault evidence
  -> permission for the next semantic operation
```

`M3 S12000` accepted by a line protocol proves none of these physical claims:

- a spindle drive is enabled and healthy;
- the correct direction was achieved;
- actual speed is within tolerance and stable;
- the tool is clamped and retained;
- the spindle is not still oriented/braked;
- extraction/coolant/workholding are ready;
- engaging feed motion is safe.

The live KerfDesk snapshot has a serious exact match for the motivating failure scenario. `buildSurfacingProgram()` tells the operator to set Z0 on the surface, then emits:

```gcode
M3 S...
G4 P...
G0 Z<safe>
```

The cutter is deliberately touching the spoilboard while the spindle starts and dwells. `SurfacingPanel` saves this standalone `.nc` directly, bypassing the normal compiled-job Start/preflight path. Its regression test checks only that M3 occurs before a later negative-Z plunge, so it codifies the wrong boundary rather than proving retract-before-spindle.

The deeper audit found these additional boundaries:

1. **Fresh ordinary CNC output gets the local order right:** retract, command spindle, dwell, then approach. But the spindle dwell is open-loop time, not drive-ready or at-speed evidence.
2. **Manual tool-change continuation and crash resume repeat the same stationary-cutter hazard.** Both emit spindle start/dwell before their first safe-Z motion after the operator may have touched the tool to the stock or after engagement became unknown.
3. **There is no CNC auxiliary capability model.** The controller surface has one `cncJobs` boolean but no spindle feedback/orientation/brake, tool changer, coolant, extraction, vacuum/clamp, pallet, door-lock, auxiliary-I/O, or M-code-dialect contract.
4. **GRBL `FS` spindle display is not an at-speed proof.** Classic GRBL normally reports its internal/commanded spindle value without tachometer feedback. KerfDesk displays it but never qualifies it as actual speed or gates engagement on it.
5. **M0 tool changes are a useful app-owned transaction boundary, but physical completion is only `Idle`.** There is no installed-tool proof, drawbar/clamp confirmation, touch-plate removal, measured length/TLO readback, air pressure, or changer-home state.
6. **Pause/Resume knows feed hold can leave a CNC spindle running, but `~` resume does not requalify spindle/process/workholding after a Door/fault/operator intervention.** Direct hold continuation and crash recovery need different contracts.
7. **Stop and Disconnect command M5/M9 but do not wait for zero speed, coolant pressure decay, extraction overrun, brake state, or safe actuator pose.** Command-off is not physical standstill.
8. **The checkpoint contains no auxiliary state.** It cannot prove spindle direction/speed, process permits, coolant/extraction/vacuum, tool/changer state, door/safety state, or which M-code transaction physically completed.
9. **The checkpoint is deleted before physical job completion.** It disappears when the streamer reaches final acknowledgement-based `done`, before the planner-fenced settle marker and fresh Idle proof. A failure during buffered final cutting, M5, retract, or park can occur after recovery evidence has already been erased.

The target is not a larger list of M-codes. It is a machine-function transaction engine with controller/OEM-specific capability manifests, physical evidence, timeouts, compensation actions, recovery states, and a common `ProcessPermit` consumed before material-engaging motion.

## 1. Five truths for every auxiliary function

### 1.1 Request is not permission

The part program may request M3, M6, M8, a clamp, or a pallet change. A machine function is permitted only if all required state is valid. Examples:

- M3 requires drive ready, tool retained, guard/mode permission, brake/orient release, valid speed range, and no changer intrusion;
- M6 requires spindle stopped/at zero, safe axis pose, coolant/purge policy, adequate air, changer home, valid pockets, and compatible tool geometry;
- unclamp requires spindle/chuck zero speed and a safe work-transfer state;
- pallet change requires safe axes, process off, receiver clear, changer/door permission, and known pallet identity.

### 1.2 Commanded is not accepted

The host can write bytes successfully while the controller rejects the line, the PLC refuses the function, or a safety condition inhibits the output. Acceptance needs a correlated controller/PLC result.

### 1.3 Accepted is not complete

An auxiliary function may acknowledge when queued, when the PLC starts, or only when the physical sequence finishes. That contract is controller and machine-builder specific. Software must not infer it from the text `ok` or from a generic M-code number.

### 1.4 Complete is not ready

An M3 transaction can complete while actual speed is still ramping. A coolant output can be on while pressure/flow is absent. A clamp solenoid can be energized while the part is not retained. A door-close output can be active while the guard is not locked.

### 1.5 Ready is not indefinitely valid

At-speed, pressure, airflow, vacuum, clamp, tool retention, drive health, and door lock can be lost during cutting. A process permit needs continuous monitoring and a declared response to loss, not one startup check.

## 2. Spindle architecture

### 2.1 Separate spindle states

```ts
type SpindleState = {
  requested: 'off' | 'cw' | 'ccw' | 'orient';
  commandedRpm: number | null;
  driveEnabled: Evidence<boolean | 'unknown'>;
  driveReady: Evidence<boolean | 'unknown'>;
  actualRpm: Evidence<number | 'unknown'>;
  actualDirection: Evidence<'cw' | 'ccw' | 'stopped' | 'unknown'>;
  atSpeed: Evidence<boolean | 'unknown'>;
  zeroSpeed: Evidence<boolean | 'unknown'>;
  oriented: Evidence<boolean | 'unknown'>;
  brake: Evidence<'applied' | 'released' | 'unknown'>;
  toolRetained: Evidence<boolean | 'unknown'>;
  fault: SpindleFault | null;
};
```

Requested speed, speed command, VFD output frequency, encoder speed, motor speed, and tool-tip speed are different facts. A sender must not label a controller S field as measured RPM unless the machine profile proves its source.

### 2.2 Start transaction

For a cutter proven disengaged and resting at a known touch-off pose:

```text
prove current pose and retract path
  -> retract with spindle off
  -> prove clearance reached
  -> release spindle brake/orient state
  -> command direction and speed
  -> wait drive-ready + direction + stable at-speed within timeout
  -> establish coolant/extraction/workholding process permit
  -> approach through verified path
  -> permit material-engaging feed
```

For a cutter that may be embedded after a crash/reset, there is no universal automatic sequence. Starting while stationary can grab/burn; retracting an embedded stationary cutter can snap the tool or move the work. The workflow must first classify engagement and route to machine-specific guided recovery.

### 2.3 Timed dwell versus at-speed

A dwell is an open-loop estimate. It does not detect:

- VFD/drive fault or disabled Auto mode;
- wrong belt/gear range;
- command scaling error;
- excessive load or stalled spindle;
- reversed direction;
- a speed override at zero;
- slow cold acceleration;
- loss of phase, encoder, or feedback;
- tool overspeed.

LinuxCNC exposes `spindle.N.at-speed`; motion waits before the first feed after spindle start/speed change and before spindle-synchronized motion. The signal can come from a VFD at-speed output or a tolerance comparison between commanded and encoder speed. Source: [LinuxCNC core spindle pins](https://linuxcnc.org/docs/stable/html/config/core-components.html) and [spindle-at-speed example](https://linuxcnc.org/docs/html/examples/spindle.html).

Important nuance: at-speed normally gates engagement/feed, not every rapid. A safe controller can retract/traverse while the spindle accelerates, provided the path is clear and the cutter cannot touch material. The operation graph, not a blanket delay, defines the boundary.

SINUMERIK exposes the policy at NC level. `MD35500 $MA_SPIND_ON_SPEED_AT_IPO_START` can stop path interpolation until spindle speed lies inside programmed tolerance, or stop path axes before the last G0 preceding machining and continue only after speed proof. `WAITS` can block for spindle position, standstill, or programmed speed. If the enable is missing and the spindle cannot rotate, the wait remains unsatisfied rather than treating the command as success. Source: [SINUMERIK Basic Functions, spindle coordination](https://support.industry.siemens.com/cs/attachments/109752348/840Dsl_basic_fct_man_1217_en-US.pdf).

### 2.4 Speed stability and loss response

An at-speed policy needs:

- absolute/relative tolerance;
- settle time inside tolerance;
- startup timeout;
- low-speed and high-speed exceptions;
- override handling;
- direction proof;
- feedback freshness and sensor health;
- response to loss during cutting.

Loss response may be feed hold, controlled retract, controlled stop, or immediate drive inhibit depending on process and risk. A host toast is not the response channel for a time-critical condition.

### 2.5 Stop, coast, brake, and zero speed

M5 or drive-disable is a command. A spindle can coast for seconds or minutes. Tool change, door unlock, clamp release, probing with a stationary stylus, or operator access may require independently proven zero speed. Braking can be regenerative/dynamic/mechanical and can be unavailable after raw power removal.

Safe ordering is machine-specific:

```text
remove material-engaging feed
  -> command spindle stop
  -> maintain extraction/coolant/purge as required
  -> monitor deceleration and drive health
  -> prove zero speed
  -> orient and apply brake if required
  -> only then permit tool release/guard access/actuator intrusion
```

SINUMERIK provides a dedicated `spindle in position` interface for tool change. It is asserted only when the spindle is referenced/synchronized, exact-stop-fine is reached, and the programmed orientation is reached. Siemens documents this specifically to prevent a spindle entering a changer at the wrong orientation after interruption. Haas likewise separates spindle stopped, at-speed, drive fault, and orientation faults; it alarms if speed is nonzero during tool change. Sources: [SINUMERIK Basic Functions](https://support.industry.siemens.com/cs/attachments/109752348/840Dsl_basic_fct_man_1217_en-US.pdf) and [Haas spindle-drive troubleshooting](https://www.haascnc.com/service/troubleshooting-and-how-to/troubleshooting/spindle-drive---how-it-works-and-troubleshooting-guide.html).

### 2.6 Orientation is a transaction

LinuxCNC M19 takes a target angle and timeout. It asserts orient request, waits for `is-oriented`, faults on `orient-fault`, then marks the spindle locked and applies the brake. M3/M4/M5 cancel orient/locked state. Source: [LinuxCNC M19](https://linuxcnc.org/docs/stable/html/gcode/m-code.html#sec:M19).

Haas M19 likewise targets a fixed or optional programmed angle. Tool-change documentation shows why orientation cannot be replayed blindly during recovery: the operator must cancel orientation if rotating the spindle would collide with the double arm. Sources: [Haas M19](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dmill.value%3DM19.html) and [Haas side-mount tool-changer recovery](https://www.haascnc.com/service/troubleshooting-and-how-to/how-to/mill---side-mount-tool-changer---manual-recovery.html).

## 3. NC, PLC, drive, and safety ownership

### 3.1 Responsibility split

| Layer | Owns | Must not own alone |
| --- | --- | --- |
| CAM/post | semantic intent and ordering | physical actuator truth |
| Host/sender | transport, job transaction, evidence UI | time-critical interlocks |
| NC/interpreter | program order, motion, auxiliary requests | machine-builder actuator sequence |
| machine PLC/ladder | tool changer, clamps, coolant, doors, permissives | safety function unless safety-rated |
| spindle/servo drive | motor control, faults, feedback, braking | whole-machine collision/process policy |
| safety PLC/relay | E-stop, guards, safe torque/speed/stop functions | ordinary production sequencing |
| sensors/actuators | physical observation/action | semantic interpretation by themselves |

The safety chain must remain authoritative if the desktop host freezes, disconnects, or sends a wrong line.

SINAMICS illustrates why safety state must be typed: STO removes torque-producing power; SS1 performs controlled deceleration followed by STO; SOS monitors standstill while control remains active; SBC provides a two-channel brake-control output but does not prove the mechanical brake itself. These states have different implications for spindle coast, gravity axes, tool change, and access. Source: [SINAMICS S120 Safety Integrated](https://support.industry.siemens.com/cs/attachments/109781722/S120_safety_fct_man_0620_en-US.pdf).

SINUMERIK also warns that ordinary NC/PLC outputs are not automatically forced to every required safe state by the NC E-stop sequence; the machine builder must implement the output reaction. Reset requires deliberate release/acknowledgement and must not itself restart. A host must never assume that controller Reset deenergizes every external relay or accessory.

### 3.2 Auxiliary-function handshake

SINUMERIK documents the general pattern: NCK outputs M/S/T/H/D/F auxiliary functions to the PLC; the PLC user program performs machine switching; the block is not complete until motion and required auxiliary acknowledgements are complete. This prevents later functions from overtaking unfinished machine actions. Source: [SINUMERIK auxiliary-function architecture](https://support.industry.siemens.com/cs/attachments/109783227/840Dsl_plc_fct_man_1020_en-US.pdf).

A robust handshake needs:

```ts
type AuxiliaryTransaction = {
  id: string;
  function: MachineFunction;
  requestedAtProgramBoundary: SemanticBoundary;
  preconditions: readonly QualifiedCondition[];
  command: ControllerSpecificCommand;
  accepted: ControllerEvidence;
  physicalPhases: readonly MachinePhase[];
  completion: CompletionPredicate;
  timeout: Duration;
  faultMap: ReadonlyMap<MachineFaultCode, RecoveryClass>;
  compensation: CompensationAction;
  recovery: RecoveryProcedureRef;
};
```

Each acknowledgement must say whether it means request received, action started, actuator reached, transaction complete, or merely no immediate error.

SINUMERIK distinguishes auxiliary functions managed by PLC handshakes from functions that are merely transferred without functional acknowledgement. Managed groups require transfer and end-of-function acknowledgement before dependent block progression. This distinction belongs in the dialect manifest; “sent to PLC” is not “mechanism complete.”

Haas M29 is a concrete external handshake: it raises an output, pauses program execution, waits for M-Fin, then clears the output and continues; Reset aborts the wait. Source: [Haas M29/M-Fin](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dmill.value%3DM29.html). Haas also documents relay banks whose outputs do not automatically turn off on Reset, E-stop, or alarm. Every output therefore needs an explicit reset/E-stop/power-loss policy. Source: [Haas M-code relay behavior](https://www.haascnc.com/service/troubleshooting-and-how-to/reference-documents/m-code-relay-function---ngc.html).

### 3.3 I/O timing classes

LinuxCNC makes the distinction explicit:

- M62/M63 queue digital changes synchronized to the beginning of the next motion; with no following motion they do not occur;
- M64/M65 change immediately when received and break blending;
- M67 is motion-synchronized analog output;
- M68 is immediate analog output;
- M66 waits on an input state/edge with a timeout but is non-realtime and not for timing-critical capture.

Source: [LinuxCNC M62-M68 and M66](https://linuxcnc.org/docs/stable/html/gcode/m-code.html#sec:M62-M65).

This is why "output on" is not one primitive. Dust extraction lead time, laser power synchronized with path start, clamp confirmation, and a service light require different semantics.

### 3.4 User M-codes are machine dialect

LinuxCNC M100-M199 run configured external executables and pause G-code until the program exits; a nonzero exit stops execution. Script exit still proves only what the script itself verifies. Haas optional user M functions can wait for an M-Fin input. SINUMERIK assigns unreserved M/H functions through the machine-builder PLC. The same number can mean different hardware on different machines.

Therefore custom M-codes require an OEM/versioned dialect manifest with parameter schema, timing, completion meaning, side effects, restart behavior, and authority—not a free-text preamble field.

## 4. Public-controller architecture lessons

### 4.1 LinuxCNC spindle and I/O

LinuxCNC exposes command pins (`on`, `forward`, `reverse`, speed command), feedback (`revs`, encoder/index), at-speed, inhibit, brake, orientation request/ack/fault, and multiple spindles. Motion owns realtime/synchronized behavior; `iocontrol` owns non-realtime coolant, lube, enable, and tool-change exchange with HAL. Source: [LinuxCNC core components](https://linuxcnc.org/docs/stable/html/config/core-components.html).

This separation is valuable: the interpreter does not pretend that M3 itself is tachometer proof, and the machine integrator must wire the physical feedback/permissives.

### 4.2 LinuxCNC tool-change protocol

A T word asserts tool-prepare with requested number/pocket. External HAL/ladder asserts prepared. M6 asserts tool-change; completion requires tool-changed. LinuxCNC documents that M6 stops the spindle but does not turn off coolant automatically and does not apply tool length—M9 and G43 remain explicit program responsibilities. Source: [LinuxCNC M6](https://linuxcnc.org/docs/stable/html/gcode/m-code.html#sec:M6).

IO Control V2 was added specifically to fix abort/completion races and inconsistent pocket/tool views. It handshakes NC-originated aborts and changer faults, carries reason codes, and demands a consistent completed-versus-aborted state. Source: [LinuxCNC I/O Control V2](https://linuxcnc.org/docs/html/config/iov2.html).

That is the correct small-system lesson: tool change is a protocol between two state machines, not one boolean or a delay.

### 4.3 GRBL-family limitations

Classic GRBL's M3/M4/M5 and M7/M8/M9 normally control pins/PWM through open-loop firmware state. It has no standard tool table, M6 changer transaction, spindle encoder/at-speed protocol, coolant pressure feedback, clamp/pallet model, or general PLC handshake. `FS` is normally the planner/commanded spindle value. A host cannot manufacture industrial readiness from this grammar.

The source makes this exact: realtime status prints `sys.spindle_speed`; `spindle_compute_pwm_value()` derives that variable from programmed RPM, override, configured min/max, and the PWM model immediately before writing the PWM output. No tachometer measurement is involved. Sources: [GRBL realtime report](https://github.com/gnea/grbl/blob/master/grbl/report.c) and [GRBL spindle control](https://github.com/gnea/grbl/blob/master/grbl/spindle_control.c).

grblHAL and FluidNC can expose richer driver/plugin/configuration behavior, auxiliary inputs, tool-change hooks, and custom M-codes, but capability is build- and machine-configuration-specific. The sender needs runtime/OEM evidence, not family-name inheritance.

### 4.4 g2core and Machinekit

g2core's callback/state-machine discipline demonstrates that planner and machine transactions can fence completion before later work is admitted. Machinekit preserves the LinuxCNC-style split among interpreter/task, realtime motion/HAL, and network UI. Both reinforce that transport acknowledgement and physical completion are separate layers.

### 4.5 Public-controller comparison

| Controller | Spindle qualification | Auxiliary timing | Tool change | Restart warning |
| --- | --- | --- | --- | --- |
| LinuxCNC | `at-speed` gates first feed/synchronized moves; M19 has ack/fault/timeout | true next-motion M62/M63/M67; immediate M64/M65/M68; blocking M66 | prepare/change acknowledgements; IOV2 abort/fault handshake | waits can be unbounded without integrator watchdog; physical state must be requalified |
| grblHAL | planner drain then at-speed polling or delay; alarm on timeout | true next-motion and immediate classes; driver M66 | core manual/semi-auto plus driver/plugin ATC hooks | change state is runtime; source flags warm-reset survival as unresolved |
| FluidNC | planner drain plus configured speed-scaled fixed delay | M62/M63/M67 drain then change now, not next-motion; M66 wait modes mostly absent | macro/ATC delegation; generic base/failure propagation incomplete | reset turns outputs off; macro state is not durable |
| g2core | planner callback plus optional fixed dwell | spindle/coolant are ordered planner callbacks | M6 only updates logical tool number | modal bookkeeping does not prove physical tool/accessory state |
| Machinekit | older LinuxCNC-derived HAL/motion model | LinuxCNC-like synchronized I/O | IOV2-style handshakes/fault latch | useful historical design; current LinuxCNC is implementation authority |

### 4.6 grblHAL: richer spindle and door restore

`spindle_set_state_synced()` drains previous motion, then waits through driver spindle state. If the driver advertises at-speed and tolerance, core polls every 200 ms; configured on-delay becomes the timeout, with a 60-second default when zero. Timeout turns the spindle off and raises a spindle alarm. Without feedback it uses fixed on/off delay. Sources: [grblHAL spindle control](https://github.com/grblHAL/core/blob/master/spindle_control.c) and [G-code execution](https://github.com/grblHAL/core/blob/master/gcode.c).

Unlike LinuxCNC, normal grblHAL M3 waits before later motion, so acceleration cannot overlap a safe rapid. This still does not make M3 safe while buried: clearance must precede the command.

grblHAL also has a strong safety-door restore lifecycle: controlled hold, optional parking retract, spindle/coolant off, door-close proof, explicit Cycle Start, spindle requalification, coolant restore, unpark/slow plunge, then resume. Reopening the door restarts the restoration sequence. Source: [grblHAL state machine](https://github.com/grblHAL/core/blob/master/state_machine.c).

Its user-M-code plugin API can choose planner synchronization, and M66 execution is driver-delegated. Those semantics must appear in the machine manifest. Core manual/semi-auto tool change synchronizes, stops process outputs, requires homing, and uses safe positions, but the source itself contains an unresolved note about surviving warm reset.

### 4.7 FluidNC: familiar syntax, different contracts

FluidNC drains motion for spindle state and applies configured spin-up/down delay scaled by requested fraction of maximum speed. Current generic core does not expose a LinuxCNC/grblHAL-style at-speed acknowledgement. Source: [FluidNC spindle implementation](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Spindles/Spindle.cpp).

Its auxiliary dialect is critically different:

- M62/M63/M67 drain prior motion and then change the output immediately; they are **not** attached to the next motion;
- M64/M65/M68 change immediately without the drain;
- M66 immediate read works, but edge/high/low timeout waits are rejected and remain unimplemented in current source.

Sources: [FluidNC user outputs](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Machine/UserOutputs.cpp) and [user inputs](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Machine/UserInputs.cpp). A post that assumes LinuxCNC timing because the M-code number matches can mistime a torch, valve, clamp, camera trigger, or air output.

Reset turns off spindle, coolant, and user outputs. M6 delegates to an ATC or macro, while the generic ATC base is a stub and macro-failure propagation is incomplete. The current manual-ATC source also demonstrates the user's hazard: it returns Z to a saved position before restoring the spindle. If that Z is in material, the stationary cutter re-enters first and M3 follows. Source: [FluidNC manual ATC](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/ToolChangers/atc_manual.cpp).

### 4.8 g2core: planner-ordered but not physically acknowledged

g2core queues spindle and coolant through planner callbacks, preserving order with motion. Optional fixed spindle dwell depends on continuous-mode/planner context. It has no generic at-speed input or M19 acknowledgement in the examined core. M6 currently queues a callback that copies selected tool to current tool; it does not operate a physical changer. Sources: [g2core spindle](https://github.com/synthetos/g2/blob/edge/g2core/spindle.cpp), [coolant](https://github.com/synthetos/g2/blob/edge/g2core/coolant.cpp), and [canonical machine](https://github.com/synthetos/g2/blob/edge/g2core/canonical_machine.cpp).

Its synchronous/asynchronous JSON commands can extend machine functions, but custom side effects still need declared planner synchronization, timeout, cancellation/reset, idempotency, and completion proof.

### 4.9 LinuxCNC wait gaps remain integrator responsibilities

LinuxCNC's basic at-speed gate, tool prepare/change acknowledgements, and M100-M199 external programs do not impose universal watchdog timeouts. A missing sensor can wait indefinitely; a user process can hang; a backgrounded script can return before physical completion. M19 is stronger because it includes explicit timeout and fault. Flexibility does not remove the need for a commissioned machine-level timeout/recovery design.

## 5. Automatic tool changing

### 5.1 M6 is a compound physical transaction

Representative ATC flow:

```text
resolve requested tool and pocket
  -> validate tool/pocket/weight/adjacent-clearance data
  -> finish current semantic operation
  -> retract to qualified tool-change corridor
  -> stop coolant/TSC and run purge as required
  -> command spindle stop; prove zero speed
  -> orient/lock spindle; prove orientation
  -> prove air/hydraulic pressure and changer home
  -> prepare/index requested pocket; prove position
  -> move axes to tool-change pose; prove pose
  -> unclamp; prove drawbar/tool release
  -> exchange; prove arm/carousel intermediate states
  -> clamp; prove retention and tool-in-spindle identity
  -> return changer home; prove clear
  -> commit pocket/tool inventory atomically
  -> load/measure/apply tool compensation
  -> restore required process state
  -> publish complete boundary
```

Every arrow can fault. Recovery must know the last physically proven state, not replay M6 from its first line.

SINUMERIK makes the authority split explicit: NC owns tool/magazine data and creates the transfer job; the PLC controls magazine, gripper, mechanical sequencing, safety interlocks, and tool-changer collision prevention. The PLC can acknowledge many intermediate tool-position changes (the documented system supports up to 60 acknowledgement steps), with only one valid acknowledgement active at a time. The last intermediate/end acknowledgement is retained so the PLC can restart/reconcile a tool-change job after Reset. Source: [SINUMERIK Tool Management](https://support.industry.siemens.com/cs/attachments/109803122/828D_tool_manage_fct_man_0721_en-US.pdf?download=true).

This is the durable checkpoint model KerfDesk needs for identity-bearing mechanisms: persist the last **acknowledged physical transfer phase**, compare it to live sensors after restart, and enter recovery-required on disagreement.

### 5.2 Tool inventory is physical state

The controller's pocket table is a claim about reality. Random-pocket changers move tools between pockets; fixed changers retain assigned positions. A power loss, dropped tool, empty pocket, manual removal, or interrupted arm can make the table wrong. Commit inventory only after clamp/transfer/home proof, and preserve a journal sufficient to reconcile partial exchange.

An electrospindle also supplies physical proofs beyond “M6 done.” One public Hiteco specification exposes tool lock, clamp-open, spindle-rotation, and piston-back sensors plus taper-cleaning and air-seal supplies. The exact sensors vary, but the pattern is universal: installed tool, drawbar, piston, rotation, and air state are distinct inputs. Source: [Hiteco electrospindle specification](https://www.hiteco.net/network-siti-locali/hiteco/layout%20schede%20tecniche/90L0899147A_rev01_scheda%20tecnica.pdf).

### 5.3 Haas recovery is sensor- and pose-specific

Haas first attempts automatic recovery, then exposes manual, separately gated component actions: arm forward/reverse, pocket up/down, carousel left/right, spindle orient, and tool release. It warns against spindle orientation if the arm would interfere. Completion requires checking actual spindle tool and current pocket against the control display, then testing ATC forward. Source: [Haas side-mount recovery](https://www.haascnc.com/service/troubleshooting-and-how-to/how-to/mill---side-mount-tool-changer---manual-recovery.html).

This is not "clear alarm and run M6 again." It is a guided reconciliation of physical pose, sensors, inventory, and collision risk.

Okuma publicly describes a comparable model: an ATC may contain roughly thirty hidden internal steps; after power loss, E-stop, or Reset, the operator can single-step the ATC forward or backward until it reaches a stable state. Automatic pallet recovery follows the same idea. Source: [Okuma OSP recovery overview](https://www.okuma.com/podcasts/shop-matters-ep-12-top-osp-control-features).

### 5.4 Air, contamination, and geometry are part of the state machine

Haas documents low air pressure/volume, tool clamp/unclamp sensors, carousel/arm proximity sensors, spindle orientation, chips, worn mechanisms, and safe tool-change position as distinct failure sources. Heavy/large tools also require pocket distribution and adjacent-clearance rules. Sources: [Haas umbrella tool changer](https://www.haascnc.com/service/online-operator-s-manuals/mill-operator-s-manual/mill---umbrella-tool-changer.html) and [tool-changer troubleshooting](https://www.haascnc.com/service/online-manuals/mill-tool-changer---service-manual/tool-changer-troubleshooting-guides.html).

### 5.5 Manual and automatic M6 are different machine contracts

PathPilot chooses a configured tool-change method. With an ATC and assigned tools, M6 runs the automatic sequence. Without an ATC or when the tool is not stored in it, the control prompts for a manual change. PathPilot commonly programs G30/M998 clearance before tool change and recommends G43 with M6 because changing the physical tool and applying its length remain separate semantic facts. Sources: [PathPilot interface](https://knowledgebase.tormach.com/pcnc-1100/pathpilot-interface-pcnc-1100) and [post-processor guidelines](https://knowledgebase.tormach.com/15l/pathpilot-post-processor-guidelines).

One post therefore cannot infer M6 behavior from the controller brand alone. The machine profile must identify manual/ATC mode, changer/pocket inventory, clearance strategy, and length-compensation policy.

## 6. Coolant, air, extraction, chips, and lubrication

### 6.1 Output state is not process readiness

For each auxiliary process distinguish:

```text
requested -> output energized -> actuator running
  -> pressure/flow/airflow/vacuum achieved
  -> stable process-ready -> continuously healthy
  -> commanded off -> safe decay/purge/overrun complete
```

M7/M8 normally express command state only. A pressure switch, flow sensor, VFD feedback, airflow sensor, tank level, filter differential, or operator qualification may be needed for readiness.

### 6.2 Process-specific sequencing

- flood coolant may need pump lead time and level/flow monitoring;
- through-spindle coolant may require spindle stop, union/precharge, pressure proof, purge, and different tool-change behavior;
- air blast may need limited duty and must not aerosolize hazardous material;
- dust extraction needs airflow before cutting and overrun after spindle stop to clear duct/tooling;
- chip conveyors have direction, obstruction, current, and duty-cycle constraints;
- lubrication low level/pressure may inhibit production but not all recovery motion.

Haas TSC documentation makes the compound nature explicit: M88 can stop the spindle, start the pump, wait for pressure, then restart; M89 stops spindle/pump and purges; M6 with TSC active turns it off and purges before tool change. Source: [Haas TSC behavior](https://www.haascnc.com/content/dam/haascnc/en/service/manual/supplement/english---vr-series-operator%27s-manual-supplement---2004.pdf).

Modern Haas TSC and Through-Tool Air Blast diagnostics expose pressure-related faults separately. High-pressure coolant must be off before tool/turret change, and pressure loss is a process fault—not simply an output-state mismatch. Sources: [Haas M88/M89](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dlathe.value%3DM88.html), [TSC troubleshooting](https://www.haascnc.com/service/troubleshooting-and-how-to/troubleshooting/tsc-1000-troubleshooting-guide.html), and [TAB troubleshooting](https://www.haascnc.com/service/troubleshooting-and-how-to/troubleshooting/through-tool-air-blast--tab----troubleshooting-guide.html).

Chip conveyors illustrate the narrow case where bounded automatic retry is physically designed: Haas detects overcurrent, briefly reverses to clear a jam, and retries only to a configured limit. Source: [Haas chip conveyor](https://www.haascnc.com/service/online-manuals/chip-and-coolant---service-manual/standard-belt-chip-conveyor.html). This does not generalize to ATC, clamps, pallets, or doors, where blind retry under contradictory sensors can cause collision.

### 6.3 Manual/Auto ownership

Physical selector switches commonly choose Off/Manual/Auto. Software must prove Auto authority before assuming an M-code controls the device. A UI light can mean output command, not actual pump/collector/vacuum state. Manual overrides must invalidate program-owned process evidence or be incorporated into a declared arbitration model.

### 6.4 Shutdown is not one M9

Stopping every auxiliary immediately may be wrong. Extraction can require overrun; TSC requires purge; coolant may need to remain during deceleration; vacuum workholding must remain until cutter and axes are safe; lubrication can continue independently. Stop contracts must be per function and interruption cause.

### 6.5 Router extraction and dust hood are motion constraints

A router dust system has at least four distinct parts: collector/fan, duct/damper, flexible hose, and hood/skirt. "Collector on" does not prove airflow at the cutter. Blockage, full bin/filter, collapsed hose, closed damper, lifted hood, or failed contactor can remove capture while the output remains energized.

The hood also changes collision geometry and tool-change permission. MASSO's documented linear-tool-changer interface includes a `Dust hood UP OK` input, a hood-control output, spindle-clean air, drawbar status, and tool-in-place input. Unused inputs can be configured away, which reinforces that the effective contract is the commissioned machine configuration. Source: [MASSO linear tool changer](https://docs.masso.com.au/wiring-and-setup/tool-changers/mill-tool-changers/linear-tool-changer-type-2?ln=en).

A qualified router operation should declare:

```text
collector command and Auto authority
  -> airflow/pressure proof and startup timeout
  -> hood position valid for cutting
  -> continuous airflow monitoring
  -> hood-up confirmation before ATC/tool access
  -> extraction overrun after spindle stop
```

For combustible wood/composite dust, output command alone is especially inadequate. Extraction, isolation/abort gates, and airflow need commissioned interlocks. OSHA requires local exhaust/conveying at woodworking dust sources; NFPA public material describes interlocked isolation/abort behavior. Sources: [OSHA combustible-dust directive](https://www.osha.gov/sites/default/files/enforcement/directives/CPL_03-00-008.pdf) and [NFPA 660 public material](https://docinfofiles.nfpa.org/files/AboutTheCodes/660/664_F2024_CMD_WOO_FD_PIResponses.pdf).

### 6.6 Spindle warm-up is not per-job spin-up

Spin-up gets a spindle from zero to commanded RPM for the next cut. Warm-up controls bearing/lubricant/thermal condition after cold start or long idle. ShopBot's ATC guide prescribes a nine-minute staged-speed warm-up before ATC work and again after long idle. Source: [ShopBot ATC installation guide](https://shopbottools.com/wp-content/uploads/2024/09/SBG00140-ATC-Installation-Guide.pdf).

The machine model should track warm-up due/complete evidence separately from M3 at-speed. A three-second dwell cannot replace a bearing warm-up routine.

## 7. Workholding, guards, and pallets

### 7.1 Clamp and vacuum state

Workholding needs identity and evidence:

```ts
type WorkholdingPermit = {
  fixtureId: string;
  mode: 'mechanical' | 'pneumatic' | 'hydraulic' | 'vacuum' | 'hybrid';
  commanded: 'clamped' | 'released';
  positionConfirmed: Evidence<boolean | 'unknown'>;
  pressureOrVacuum: Evidence<number | 'unknown'>;
  threshold: number;
  stableForMs: number;
  partPresence: Evidence<boolean | 'unknown'>;
  validForOperation: OperationSet;
};
```

The command must be interlocked in both directions: do not start spindle/motion with insufficient workholding, and do not release while spindle/motion can endanger the part/operator. Loss during cutting is a process fault that invalidates stock pose and restart eligibility.

MASSO provides a useful negative example: its chuck-clamp documentation says it prevents spindle start when open but also warns that a program can continue with the spindle off, causing damage. A denied actuator command must fail the semantic transaction, not merely display a warning while program execution advances. Source: [MASSO M10 clamp semantics](https://docs.masso.com.au/supported-m-codes/m10-chuck-or-rotary-table-clamp-on?ln=en).

Centroid's CNC12 virtual panel explicitly interlocks Flood, Mist, Vacuum, Router Dust Collection, and Router Vacuum Hold Down with an Auto/Manual ownership selector. That is the correct control distinction, although command ownership still does not prove physical pressure/flow. Source: [Centroid CNC12 VCP manual](https://www.centroidcnc.com/centroid_diy/downloads/centroid_vcp_users_manual.pdf).

Vacuum force also depends on sealed area and leakage, not pump name alone. A small/offcut part can become unsafe as surrounding material is cut away or the tool breaks through the spoilboard. Qualification should use the actual setup/operation envelope and continuously monitor vacuum where the process depends on it. Workholding loss invalidates stock pose and the remaining-stock model even if the controller stops immediately.

Haas workholding functions illustrate fail-closed monitoring. M90 enables fixture-clamp input monitoring so missing clamp proof when spindle is commanded becomes an alarm. M70/M71 clamp/unclamp include spindle-inhibit checks, and temporary bypasses are restored by power cycle, program end, alarm, Reset, or later workholding commands. Sources: [Haas M90/M91](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dmill.value%3DM90.html) and [M70/M71](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dmill.value%3DM71.html).

Pressure source is not always clamp pressure. Haas explicitly distinguishes hydraulic accumulator pressure from actual vise pressure. The evidence model must bind the measured variable to the physical retaining function rather than accepting any pressure sensor as proof. Source: [Haas UMC hydraulic workholding](https://www.haascnc.com/service/online-manuals/umc-series/umc---workholding.html).

### 7.2 Door and guard state

`Door`/hold status is not a complete guard contract. Distinguish:

- door physically closed;
- guard locked;
- safety function active;
- safe speed/limited motion mode;
- reset required;
- process permission;
- ordinary NC program hold.

Guard unlocking may require spindle zero speed and stopped hazardous auxiliaries. Closing a door must not itself initiate restart. Safety reset and Cycle Start remain separate deliberate actions.

Haas auto-door sequencing waits for program stop/end and spindle stop before opening. Automated M-code use additionally depends on a cell-safe/light-curtain interface. Source: [Haas Auto Door](https://www.haascnc.com/service/codes-settings.type%3Dsetting.machine%3Dmill.value%3DS131.html). Mist/dust extraction can require an additional rundown delay before unlock; guard release is a physical hazard-decay transaction, not a UI state flip.

### 7.3 Pallet changes

A pallet transaction binds mechanics to production data:

```text
finish operation and stop process
  -> safe retract and prove changer corridor
  -> unclamp current pallet and prove release
  -> transfer/exchange with guarded zone control
  -> clean receiver if required
  -> identify incoming pallet
  -> clamp and prove retention/pressure
  -> load matching WCS/setup/program/tool plan
  -> verify part-ready and setup fingerprint
  -> release machining permit
```

Haas M50 can select a pallet, while M50 P0 extracts without loading so a wash-down/receiver-cleaning program can run before the next pallet. Source: [Haas M50 pallet change](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dmill.value%3DM50.html).

Pallet identity, clamp state, WCS, program, and stock/part record must be one transaction. A generic `M50 complete` without identity/readback is insufficient.

Haas service material exposes the underlying physical sequence: confirm clamped, move Z/B to safe positions, unclamp, establish hydraulic pressure, lift the H-frame, rotate while air blast clears chips, lower, clamp, and prove final clamp/identity. Separate inputs cover CW/CCW, frame up/down, clamp/unclamp, air and hydraulic state; phase-specific timeouts distinguish lift, rotate, lower, and illegal switch combinations. Source: [Haas pallet changer troubleshooting](https://www.haascnc.com/service/troubleshooting-and-how-to/troubleshooting/pallet-changer---ngc---troubleshooting-guide.html).

Recovery exposes individual lift, unclamp, blast, slide, and rotate actions. Some machines must ask whether the arm physically carries a pallet because that fact changes the collision-clearance offset; answering incorrectly can cause collision. Source: [Haas pallet-pool recovery](https://www.haascnc.com/service/online-operator-s-manuals/hmc---pallet-pool---operator-s-service-manual/hmc--pallet-pool---operation.html). Human input in recovery is evidence that must be explicitly requested, not inferred from the last output command.

## 8. Interruptions and recovery

### 8.1 Direct feed-hold continuation

A short, same-session feed hold can legitimately preserve a running spindle and coolant. Resume may be a controller Cycle Start only if:

- the controller still owns the hold;
- reference and program queue remain valid;
- guard/process state did not invalidate the job;
- spindle direction/at-speed and workholding are healthy;
- no tool/fixture/stock/operator intervention occurred.

### 8.2 Door, drive, pressure, or process fault

These are not ordinary pauses. Clear the cause, reconcile machine state, re-establish permissions, and use the OEM-defined restart path. If the process stopped while the cutter remained engaged, the recovery must classify engagement before spindle or axis motion.

### 8.3 Interrupted tool or pallet change

Never resume at the next G-code line and never blindly replay the M-code. Enter a dedicated recovery state that reads all available sensors, displays the current mechanism pose, restricts commands to safe state-specific actions, reconciles inventory/identity, and requires a test/complete boundary.

### 8.4 Power loss/reset

Treat as unknown unless retained/absolute evidence proves otherwise:

- spindle coast/zero speed;
- tool clamped and identity;
- changer arm/carousel/pocket pose;
- clamp/vacuum/pallet state;
- valve/contactor outputs;
- coolant pressure and purge phase;
- extraction/vacuum availability;
- program-side auxiliary completion;
- machine reference and WCS realization.

### 8.5 Program-state reconstruction is not mechanism recovery

FANUC Program Restart can search to a target block, and its auxiliary-output option can replay encountered M/S/T/B intent in sequence. That reconstructs the program's requested state; it cannot prove an interrupted arm, clamp, pallet, brake, door, pump, or tool transfer reached its endpoint. Sources: [FANUC CNC function catalogue](https://www.fanucamerica.com/docs/default-source/cnc-files/brochures/cnc-function-catalogue.pdf) and [auxiliary replay catalogue](https://www.fanucamerica.com/docs/default-source/cnc-files/cnc-function-catalog.pdf).

HEIDENHAIN likewise separates startup/reference/PLC state, machine-builder tool management, block scan, tool/M-function restoration, staged return-to-contour positioning, and repeated operator starts. Sources: [TNC 640 startup/setup](https://content.heidenhain.de/doku/tnc_guide/pdf_files/TNC640/34059x-18/einrichten/1261174-25.pdf) and [TNC7 block-scan/restart](https://content.heidenhain.de/doku/tnc_guide/pdf_files/TNC7_go/81762x-20/tncguide/1441440_00_A_02.pdf).

### 8.6 Recovery policy after ambiguous interruption

1. Enter `recovery-required`; never auto-Cycle-Start.
2. Re-establish the safety-chain state.
3. Determine reference validity per axis; home only through the machine procedure.
4. Read all mechanism sensors and physical identities.
5. Compare them with the last acknowledged transaction phase.
6. Reconcile tool, pocket, pallet, fixture, door, brake, and auxiliary state.
7. Complete or reverse mechanisms with guarded phase-specific actions.
8. Revalidate tool/WCS/TLO and workholding.
9. Restore auxiliaries and wait for physical readiness.
10. Classify cutter engagement; establish clearance through an approved procedure.
11. Start spindle off material and prove at-speed.
12. Return through a collision-checked approach/lead-in.
13. Resume only at a semantic checkpoint.

## 9. KerfDesk live auxiliary audit

### 9.1 Strong foundations

- ordinary native CNC output retracts before initial M3;
- it retracts before spindle speed changes and ends with safe-Z retract then M5;
- pre-tool-change tail retracts, stops spindle, parks, and drains to a fresh Idle;
- the streamer turns app-generated M0 into a structured hold rather than filling past it;
- tool-change entry invalidates work-Z evidence and temporarily permits guarded setup actions;
- controller settings preflight blocks CNC when `$32=1` or `$30` mismatches machine spindle maximum;
- spindle RPM and spin-up dwell are finite/range checked in key compile paths;
- Door/Hold/Tool controller states are parsed;
- Stop/reset cleanup deliberately issues M5/M9 through the controller driver;
- job streaming distinguishes acknowledgement debt and final Idle better than a naive line sender.

These are useful pieces. They do not yet form a qualified physical-machine transaction.

### 9.2 P0: standalone surfacing starts the spindle on the touched surface

`src/core/cnc/surfacing.ts` emits M3 and G4 before `G0 Z<safe>`. Its own header and `SurfacingPanel` tell the operator to zero Z on the surface first. This creates stationary spindle startup with the cutter touching material—the exact grab/burn/stall scenario that ordinary CNC output already fixed.

The focused test asserts M3 is before the first negative-Z plunge, but never asserts safe-Z retract precedes M3. The generated file is written directly by `SurfacingPanel` and does not pass through normal `prepareOutput`, CNC preflight, metadata, Start readiness, or controller verification.

Required contract:

```gcode
G21
G90
G94
G0 Z<safe>
M3 S...
<at-speed proof or explicit open-loop policy>
G0 X0 Y0
G1 Z...
```

The standalone export must share the normal CNC safety/metadata/preflight bundle.

### 9.3 P0: tool-change and crash-resume prefixes start before retract

`cnc-grbl-strategy.ts` appends M3/G4 immediately after the swallowed M0; only later does the first group motion force G0 Zsafe. The UI explicitly tells the operator to touch the new bit to the stock top. `resume-program.ts` likewise emits spindle start/dwell before G0 Zsafe.

Idle and drained acknowledgements prove the pre-change park, not post-change cutter clearance. Continue requires no tool identity, clamp, touch-plate removal, Z/TLO readback, or disengagement evidence.

### 9.4 P0: recovery checkpoint is deleted before physical job completion

The checkpoint advances from streamer acknowledgement counts, and `job-checkpoint.ts` explicitly states that acknowledged means admitted to the controller RX buffer, not executed. When the streamer first reaches `done`, `use-job-checkpoint.ts` deletes the checkpoint immediately. That occurs before `laser-post-job-settle.ts` sends its planner-fenced marker and observes the required fresh Idle reports.

If the app, serial link, or controller fails after the final line acknowledgement but while buffered cutting, M5, retract, or park is still executing, the only recovery record has already been erased. Checkpoint deletion must be tied to the same physical/semantic completion boundary that releases machine authority, not to stream admission completion.

The resume banner compounds the problem by describing acknowledged progress as “motion lines confirmed” even though its explanatory copy admits those lines may not have executed. The UI should distinguish submitted, accepted, physically committed, and completed semantic operations.

### 9.5 P0/P1: spin-up is time-only and spindle control is undeclared

`spindleSpinupSec` is the only readiness parameter. Native jobs, surfacing, tool-change continuation, and crash resume emit G4. There is no drive-ready input, actual-RPM source, tolerance/stability window, timeout fault, direction proof, zero-speed evidence, or mid-cut loss policy.

`StatusReport.spindle` parses GRBL `FS`, and `StatusDisplay` renders it as S. The value is not classified as command versus feedback and is not consumed by Start/Resume/engagement gates.

### 9.6 P1: controller capabilities cannot describe a CNC machine

`ControllerCapabilities` includes `cncJobs: boolean`, probing, homing, WCS, settings, and generic transport controls. It cannot express:

- spindle control/feedback/orientation/brake/zero-speed;
- CNC coolant/TSC/air/extraction/lube/chip handling;
- manual versus automatic auxiliary ownership;
- M6/ATC type and handshake;
- drawbar/tool-retention inputs;
- workholding clamp/vacuum/pressure;
- guard lock/safety state;
- pallet changer/identity;
- synchronous/immediate/waiting I/O;
- OEM custom M-code dialect.

`grblHalDriver` and `fluidncDriver` inherit broad family capabilities, so even richer machine-specific plugins/configurations cannot be represented honestly.

### 9.7 P1: app-owned manual tool change stops at Idle

The structured M0 boundary is good sender engineering. But the completion predicate is controller Idle plus empty in-flight queue. The app cannot prove the requested tool was installed, a drawbar/collet is secure, the tool was measured, Z/TLO matches, the plate was removed, or the cutter is clear. It also treats every lone M0 in app-generated CNC as a manual tool-change boundary and cannot express controller-owned M6/ATC.

### 9.8 P1: Pause/Resume does not requalify process state

For CNC, Pause sends realtime feed hold and intentionally leaves the spindle running. That is correct for a short ordinary hold. Resume sends `~` and continues streaming. It does not distinguish operator Pause from Door, drive fault, coolant/vacuum loss, prolonged hold, or physical intervention, and it does not re-check spindle/process/workholding state.

### 9.9 P1: Stop/Disconnect ends command state, not physical hazards

Soft reset and M5/M9 cleanup remove controller commands. The UI/store clears software air state. There is no wait for actual spindle zero, VFD fault reset, coolant/TSC purge, extraction overrun, vacuum retention until axes are clear, brake application, or tool-changer home. The driver field remains named `stopLaserLines` even for CNC, hiding different mechanical consequences.

### 9.10 P1: CNC auxiliaries are absent

Device profile air-assist M7/M8 is designed for laser jobs. CNC output emits no coolant, air, extraction, vacuum, lubrication, conveyor, or process-ready policy. The machine model contains spindle max/spin-up and cutting geometry, but no auxiliary definitions or feedback bindings.

### 9.11 P1: status and checkpoint evidence are insufficient

GRBL status parsing covers machine state, XYZ/WCO, F/S, a small pin subset, and overrides. It omits general auxiliary inputs and has no receive timestamp/sequence. The recovery checkpoint has no spindle/process/tool/changer/workholding/pallet evidence or machine-function journal. Prefix interpretation can reconstruct requested M state, not physical completion.

### 9.12 P2: source comments disagree with current safe order

The top-of-file `cnc-grbl-strategy.ts` comment still documents `M3/G4` before `G0 Zsafe`, while the implementation correctly retracts first. Safety contracts should be executable assertions and accurate documentation; stale comments can seed later regressions or copied generators such as surfacing.

### 9.13 P1: Resume reconstructs spindle request but not auxiliaries

`resume-program.ts` scans M3/M4/M5 and S to reconstruct requested spindle state. It does not track M7/M8/M9 or any OEM auxiliary. A laser job interrupted inside an air-assisted section can resume without reissuing the air command; a future CNC coolant/extraction feature would have the same defect.

Even for spindle state, prefix interpretation recovers program intent, not actual direction, speed, drive health, or whether the last M3 physically took effect. Auxiliary restoration must be a qualified transaction assembled from semantic program state plus live machine evidence.

### 9.14 P1: raw Console bypasses process truth

The guarded Console still permits arbitrary one-line M3/M4/M5/M7/M8/M9 and custom M-codes while Idle. These commands neither update a qualified spindle/auxiliary model nor invalidate dependent evidence. The user can start a spindle, energize an output, change a clamp/pallet function on richer firmware, then Start with an app snapshot that does not know it happened.

Raw Console needs typed side-effect classification and machine-dialect authority. Unknown machine functions should invalidate process/setup evidence and require reconciliation before automated motion.

### 9.15 P1: manual air UI commits after transport write

`setAirAssistEnabled()` sets `airAssistOn` after the connection write resolves, not after correlated controller acceptance or output readback. Job-emitted M7/M8/M9 is not reconciled with that boolean. The UI can therefore show ON after an eventual error or show stale manual state after a clean job changed the same output.

This repeats the setup-truth problem from tranche eight: commanded, accepted, output-active, and process-ready are separate evidence phases.

### 9.16 P1: overrides persist outside Start qualification

Feed, rapid, and spindle overrides are parsed and displayed, but they are not inputs to Start readiness or the checkpoint. A CNC job can inherit a non-100% spindle override or feed override from a prior operation without an explicit review. An at-speed signal may also compare against the overridden target rather than the programmed S value.

The setup snapshot must record active overrides and policy: normalize to 100%, require confirmation, or treat the effective values as intentional qualified process parameters.

### 9.17 P1: existing preflight cannot express retract-before-spindle

CNC preflight checks numeric RPM limits and motion geometry but has no invariant for cutter-clearance motion before spindle start from a touch-off pose. Its nominal `GOOD_GCODE` fixture itself places M3 before the safe-Z retract, so a new ordering check would reveal that the baseline test encodes the unsafe sequence.

The invariant cannot be merely “some G0 Z exists before the first plunge.” It needs operation semantics:

- fresh touch-off Start: prove retract-before-spindle;
- tool-change touch-off: prove plate removal/tool/Z and retract-before-spindle;
- short feed-hold: preserve qualified running spindle;
- crash recovery: engagement unknown, automatic prefix prohibited until classified.

## 10. Target machine-function architecture

### 10.1 Machine capability manifest

```ts
type MachineFunctionManifest = {
  machineId: string;
  controllerBuild: ControllerBuildIdentity;
  plcRevision?: string;
  driveRevisions: readonly DriveIdentity[];
  spindle: SpindleCapability;
  toolChange: ManualToolChangeCapability | AtcCapability | null;
  coolant: readonly AuxiliaryProcessCapability[];
  extraction: AuxiliaryProcessCapability | null;
  workholding: readonly WorkholdingCapability[];
  guard: GuardCapability;
  pallets: PalletCapability | null;
  io: IoTimingCapability;
  dialect: MachineMCodeDialect;
  safetyAuthority: SafetyAuthorityDescription;
};
```

The manifest is OEM/build/configuration-specific and commissioned against hardware. Controller family is only one input.

### 10.2 Process permit

```ts
type ProcessPermit = {
  operationId: string;
  setupFingerprint: string;
  tool: QualifiedToolAssemblyRef;
  spindle: QualifiedSpindleState;
  workholding: WorkholdingPermit;
  guard: GuardPermit;
  auxiliaries: readonly QualifiedAuxiliaryState[];
  machineReferenceEpoch: string;
  controllerEpoch: string;
  issuedAt: number;
  expiresOn: readonly InvalidationEvent[];
};
```

Material-engaging motion requires a current permit. Rapid recovery/clearance motion uses a separate permit with different requirements.

### 10.3 Machine-function state machine

```text
idle
  -> requested
  -> preflight
  -> accepted
  -> actuating
  -> waiting-for-feedback
  -> ready/complete

failure branches:
  rejected
  timed-out
  faulted-before-motion
  faulted-mid-sequence
  completion-ambiguous
  recovery-required
```

Only ready/complete publishes downstream evidence. Cancellation and disconnect preserve the last known phase and compensation action.

### 10.4 Semantic execution graph

Compile G-code into operations rather than treating lines as restart units:

```text
SafeRetract
SpindleStartAndQualify
AuxiliaryStartAndQualify
Approach
MaterialEngagement
MachiningOperation
Disengage
SpindleStopAndStandstill
ToolChangeTransaction
PalletChangeTransaction
```

Checkpoints attach only to completed semantic nodes with setup/process fingerprints.

### 10.5 Machine-owned recovery procedures

Each fault class references a versioned recovery procedure specifying:

- required mode and safety state;
- actual sensor observations;
- permitted manual component actions;
- collision/engagement warnings;
- inventory/setup reconciliation;
- proof of completion;
- whether reference, WCS, tool, offsets, or stock become invalid;
- safe re-entry node.

### 10.6 Non-negotiable invariants

1. Commanded is never equivalent to physically complete.
2. Complete is never automatically equivalent to safe for the next operation.
3. Sensor truth overrides cached command state; contradiction enters recovery.
4. CNC program restart and machine-mechanism recovery are separate workflows.
5. Persist the last acknowledged physical transfer phase, not only the last M-code.
6. Tool, pocket, pallet, fixture, and loaded-arm identity must be reconciled after ambiguity.
7. Timeouts are phase-local and report expected state, observed state, command, elapsed time, and allowed recovery choices.
8. Blind retry is limited to explicitly designed idempotent/bounded mechanisms such as conveyor jam reversal.
9. ATC, pallet, clamp, brake, and door motion are not blindly retried under unknown or contradictory sensors.
10. Temporary bypasses are scoped, visible, automatically restored, and unavailable to ordinary job programs.
11. E-stop/reset/door close never restarts motion by itself.
12. Every external output declares behavior on Reset, E-stop, disconnect, and power loss.
13. Cutter-engaged recovery is a distinct hazardous mode, never ordinary Resume.

## 11. Priorities for KerfDesk

### P0

1. Fix standalone surfacing order so safe-Z retract precedes M3/dwell, and route its export through shared CNC metadata/preflight/invariant checks.
2. Fix manual tool-change continuation and crash-resume prefixes: no spindle start until cutter-clear/disengagement and tool/Z/TLO/plate-removal requirements are satisfied.
3. Split direct feed-hold continuation from crash/door/fault recovery; never use one Resume action for both.
4. Retain the recovery checkpoint until planner/process completion and a physically settled semantic boundary—not merely until all lines are acknowledged.
5. Require a declared manual/relay/PWM/VFD spindle contract. Before engagement, require at-speed evidence or an explicit operator/validated open-loop qualification; a generic elapsed dwell is not proof the spindle started.

### P1

1. Add a machine-function capability manifest and process-permit model.
2. Add controller/OEM-specific auxiliary transaction/acknowledgement semantics.
3. Extend tool change into a physical setup transaction with tool identity, retention, measurement, clearance, and readback evidence.
4. Add zero-speed/standstill semantics for access, tool change, and Stop/Disconnect completion.
5. Add CNC coolant/extraction/workholding models with feedback, lead/lag, and fault response.
6. Add status freshness, auxiliary input identity, and a machine-function journal to checkpoints.
7. Rename/generalize laser-specific stop/air abstractions before using them as CNC safety evidence.
8. Reconstruct and requalify coolant/extraction/air/workholding state during Resume; prefix simulation alone is not evidence.
9. Type Console M-code side effects and invalidate/reconcile process truth after raw mutations.
10. Include active feed/rapid/spindle overrides in Start and recovery policy.

### P2

1. ATC protocol with pocket inventory journaling and state-specific recovery.
2. TSC/purge, coolant-pressure, dust-airflow, chip, and lube transactions.
3. Vacuum/pneumatic/hydraulic workholding qualification and continuous-loss response.
4. Door/guard/safety-controller evidence adapter without weakening hardware authority.
5. Pallet identity, clamp, WCS, setup, and program binding.
6. Synchronous/immediate/waiting I/O and typed OEM M-code dialects.

### P3

1. Multi-spindle, spindle synchronization, tapping/threading, and orientation workflows.
2. Production-cell robot/loader/part-presence/quality handshakes.
3. Condition monitoring for spindle vibration, tool retention, coolant/filter, vacuum, and predictive maintenance.
4. HIL qualification against commissioned machine PLC/drive/safety configurations.

## 12. Verification program

### 12.1 Pure program invariants

- every cutter-touching Start/Continue path proves allowed clearance before spindle start;
- engaging feed is impossible without a current process permit;
- spindle reversal requires zero-speed transition unless drive contract proves otherwise;
- M6/pallet/clamp transactions cannot be checkpointed mid-sequence;
- offset/tool/pallet inventory commits occur only after physical completion evidence;
- standalone generators use the same safety pipeline as normal jobs.

### 12.2 Protocol and state-machine fault injection

At every phase inject:

- request rejection and late error;
- acknowledgement without output change;
- output change without feedback;
- stuck/contradictory sensors;
- slow startup and timeout;
- loss of at-speed/pressure/vacuum mid-cut;
- door/hold/E-stop/reset/disconnect;
- power loss at every ATC/clamp/pallet phase;
- stale completion from a previous transaction/epoch;
- inventory mismatch and missing tool/pallet;
- cleanup/purge/overrun failure.

Properties:

- no later semantic operation overtakes an incomplete auxiliary transaction;
- ambiguous completion enters recovery-required;
- a denied spindle/clamp/process command stops program progression;
- command-off never masquerades as physical standstill;
- recovery never blindly replays a compound M-code;
- Restart cannot fabricate physical process evidence from prefix simulation.

### 12.3 HIL and machine acceptance

- commanded versus measured spindle ramp across speeds, loads, directions, and overrides;
- at-speed tolerance/settle/loss and startup timeout;
- zero-speed/coast/brake timing;
- tool clamp/unclamp, air pressure, pocket/arm/carousel sensors and every recovery pose;
- coolant/TSC pressure, purge, leakage, level and filter faults;
- extraction airflow and overrun;
- vacuum/clamp loss while safe and while cutting;
- door/safety mode and reset transitions;
- pallet identity/clamp/program/WCS mismatch;
- power-cycle and communication loss in every transaction phase.

### 12.4 Current focused baseline

The verification bundle should cover at least:

- `src/core/cnc/surfacing.test.ts`;
- `src/core/output/cnc-grbl-strategy.test.ts`;
- `src/core/cnc/cnc-multi-tool.test.ts`;
- `src/core/controllers/grbl/resume-program.test.ts`;
- `src/core/controllers/grbl/streamer-tool-change.test.ts`;
- `src/ui/state/laser-store-tool-change.test.ts` or current equivalents;
- `src/ui/laser/JobRunControls.tool-change.test.tsx`;
- `src/ui/state/laser-store-air-assist-safety.test.ts`;
- `src/core/controllers/grbl/status-parser.test.ts`;
- `src/core/preflight/controller-readiness.test.ts`;
- lifecycle simulator/reset/disconnect tests.

The focused run on 2026-07-13 passed **19 test files / 188 tests**. It covered surfacing, native CNC emission, multi-tool ordering, resume generation, tool-change streaming/UI/store behavior, air-assist cleanup, status parsing, controller readiness, Start readiness, checkpoint storage, post-job settle, untracked-ack ownership, and GRBL/Marlin/Smoothieware lifecycle simulators.

This green result confirms current behavior, including the unsafe surfacing/tool-change/resume ordering that several assertions presently accept. It does not provide spindle feedback, physical cutter-engagement evidence, ATC/PLC/HIL coverage, or auxiliary readiness. The JobRunControls tool-change tests emitted existing React `act(...)` environment warnings.

## 13. Research source map

### Public controller architecture

- [LinuxCNC M-codes](https://linuxcnc.org/docs/stable/html/gcode/m-code.html)
- [LinuxCNC core components and spindle/I/O pins](https://linuxcnc.org/docs/stable/html/config/core-components.html)
- [LinuxCNC spindle feedback/at-speed example](https://linuxcnc.org/docs/html/examples/spindle.html)
- [LinuxCNC I/O Control V2](https://linuxcnc.org/docs/html/config/iov2.html)
- [LinuxCNC tool compensation/tool I/O](https://linuxcnc.org/docs/master/html/en/gcode/tool-compensation.html)
- [Classic GRBL realtime status source](https://github.com/gnea/grbl/blob/master/grbl/report.c)
- [Classic GRBL open-loop spindle source](https://github.com/gnea/grbl/blob/master/grbl/spindle_control.c)
- [grblHAL spindle control](https://github.com/grblHAL/core/blob/master/spindle_control.c)
- [grblHAL safety-door state machine](https://github.com/grblHAL/core/blob/master/state_machine.c)
- [grblHAL tool change](https://github.com/grblHAL/core/blob/master/tool_change.c)
- [FluidNC spindle](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Spindles/Spindle.cpp)
- [FluidNC user outputs](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Machine/UserOutputs.cpp)
- [FluidNC user inputs](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Machine/UserInputs.cpp)
- [FluidNC manual ATC](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/ToolChangers/atc_manual.cpp)
- [g2core spindle planner callback](https://github.com/synthetos/g2/blob/edge/g2core/spindle.cpp)
- [g2core coolant planner callback](https://github.com/synthetos/g2/blob/edge/g2core/coolant.cpp)

### Industrial/OEM machine workflows

- [SINUMERIK PLC Function Manual](https://support.industry.siemens.com/cs/attachments/109783227/840Dsl_plc_fct_man_1020_en-US.pdf)
- [SINUMERIK Basic Functions](https://support.industry.siemens.com/cs/attachments/109752348/840Dsl_basic_fct_man_1217_en-US.pdf)
- [SINUMERIK Tool Management](https://support.industry.siemens.com/cs/attachments/109803122/828D_tool_manage_fct_man_0721_en-US.pdf?download=true)
- [SINAMICS S120 Safety Integrated](https://support.industry.siemens.com/cs/attachments/109781722/S120_safety_fct_man_0620_en-US.pdf)
- [Haas M19 spindle orientation](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dmill.value%3DM19.html)
- [Haas side-mount tool-changer recovery](https://www.haascnc.com/service/troubleshooting-and-how-to/how-to/mill---side-mount-tool-changer---manual-recovery.html)
- [Haas umbrella tool changer](https://www.haascnc.com/service/online-operator-s-manuals/mill-operator-s-manual/mill---umbrella-tool-changer.html)
- [Haas tool-changer troubleshooting](https://www.haascnc.com/service/online-manuals/mill-tool-changer---service-manual/tool-changer-troubleshooting-guides.html)
- [Haas spindle-drive feedback/faults](https://www.haascnc.com/service/troubleshooting-and-how-to/troubleshooting/spindle-drive---how-it-works-and-troubleshooting-guide.html)
- [Haas M50 pallet change](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dmill.value%3DM50.html)
- [Haas pallet-changer troubleshooting](https://www.haascnc.com/service/troubleshooting-and-how-to/troubleshooting/pallet-changer---ngc---troubleshooting-guide.html)
- [Haas pallet-pool recovery](https://www.haascnc.com/service/online-operator-s-manuals/hmc---pallet-pool---operator-s-service-manual/hmc--pallet-pool---operation.html)
- [Haas M31/M33 chip conveyor](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dmill.value%3DM31.html)
- [Haas M29/M-Fin handshake](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dmill.value%3DM29.html)
- [Haas workholding monitoring](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dmill.value%3DM90.html)
- [Haas auto-door contract](https://www.haascnc.com/service/codes-settings.type%3Dsetting.machine%3Dmill.value%3DS131.html)
- [Haas through-spindle coolant diagnostics](https://www.haascnc.com/service/troubleshooting-and-how-to/troubleshooting/tsc-1000-troubleshooting-guide.html)
- [Haas bounded chip-conveyor retry](https://www.haascnc.com/service/online-manuals/chip-and-coolant---service-manual/standard-belt-chip-conveyor.html)
- [MASSO chuck/clamp interlock](https://docs.masso.com.au/supported-m-codes/m10-chuck-or-rotary-table-clamp-on?ln=en)
- [MASSO linear tool-changer I/O](https://docs.masso.com.au/wiring-and-setup/tool-changers/mill-tool-changers/linear-tool-changer-type-2?ln=en)
- [PathPilot post-processor machine functions](https://knowledgebase.tormach.com/15l/pathpilot-post-processor-guidelines)
- [PathPilot tool-change modes](https://knowledgebase.tormach.com/pcnc-1100/pathpilot-interface-pcnc-1100)
- [Centroid CNC12 virtual control panel](https://www.centroidcnc.com/centroid_diy/downloads/centroid_vcp_users_manual.pdf)
- [ShopBot ATC installation/warm-up](https://shopbottools.com/wp-content/uploads/2024/09/SBG00140-ATC-Installation-Guide.pdf)
- [Hiteco electrospindle sensor example](https://www.hiteco.net/network-siti-locali/hiteco/layout%20schede%20tecniche/90L0899147A_rev01_scheda%20tecnica.pdf)
- [Okuma OSP mechanism recovery overview](https://www.okuma.com/podcasts/shop-matters-ep-12-top-osp-control-features)
- [FANUC program restart catalogue](https://www.fanucamerica.com/docs/default-source/cnc-files/brochures/cnc-function-catalogue.pdf)
- [HEIDENHAIN TNC 640 startup/setup](https://content.heidenhain.de/doku/tnc_guide/pdf_files/TNC640/34059x-18/einrichten/1261174-25.pdf)
- [OSHA combustible-dust directive](https://www.osha.gov/sites/default/files/enforcement/directives/CPL_03-00-008.pdf)
- [NFPA 660 public wood-dust material](https://docinfofiles.nfpa.org/files/AboutTheCodes/660/664_F2024_CMD_WOO_FD_PIResponses.pdf)

### Live KerfDesk evidence

- `src/core/cnc/surfacing.ts` and `src/ui/machine/SurfacingPanel.tsx`;
- `src/core/output/cnc-grbl-strategy.ts`;
- `src/core/controllers/grbl/resume-program.ts` and `streamer.ts`;
- `src/ui/state/laser-job-actions.ts`, `laser-stream-ack.ts`, and `laser-store-helpers.ts`;
- `src/core/controllers/controller-capabilities.ts`;
- `src/core/controllers/grbl/status-parser.ts` and `src/ui/state/laser-status-line.ts`;
- `src/core/scene/machine.ts` and `src/core/devices/device-profile.ts`;
- `src/core/recovery/job-checkpoint.ts`, `src/ui/app/use-job-checkpoint.ts`, and `src/ui/laser/CheckpointResumeBanner.tsx`;
- `src/core/controllers/grbl/console-command.ts` and `src/ui/state/laser-console-actions.ts`;
- `src/ui/state/override-actions.ts` and `src/ui/laser/OverrideControls.tsx`;
- `src/ui/state/laser-store.ts` and laser air-assist output/tests;
- `src/core/preflight/cnc-preflight.ts` and its fixtures;
- focused tests named in section 12.4.

## 14. Source and portability cautions

- Haas M-code details vary by model, option, and software revision. Treat the cited sequences as evidence of transaction structure, not portable post output.
- SINUMERIK supplies NC/PLC interfaces and tool-management infrastructure; the machine builder still owns the actual PLC sequence, collision interlocks, sensors, and recovery UI.
- LinuxCNC is an integration framework. HAL/ladder wiring determines whether at-speed, tool-change, coolant, door, and safety signals are real or bypassed.
- grblHAL behavior depends on driver/plugin compile and machine configuration; FluidNC behavior depends on YAML, pins, macros, and exact build.
- Classic GRBL has open-loop spindle command state. Its `FS` S value is not tachometer evidence.
- Okuma's public discussion supports single-step recovery architecture but is not an internal ATC state specification.
- NFPA public-input material is useful architecture evidence but is not a substitute for the applicable adopted standard, hazard analysis, and local authority requirements.
- Safety PLC/drive functions require certified hardware/configuration and machine validation. A desktop implementation must consume status without claiming safety authority.

## Final rule

> Do not advance a machining program because an M-code was sent. Advance only when the machine-specific transaction is permitted, accepted, physically complete, read back where possible, continuously healthy where required, and safe for the next semantic operation.
