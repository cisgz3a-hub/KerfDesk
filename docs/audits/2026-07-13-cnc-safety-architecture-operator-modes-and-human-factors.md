> **Historical research archive: 11–13 July 2026.** Published on 6 September 2026.
> Findings, scores, source claims and proposed changes below describe their recorded
> baseline; they have not been revalidated and are not current product or qualification
> evidence. Unimplemented proposals are not adopted policy. The current
> [Frame-first contract](../../PROJECT.md) governs application behaviour. See the
> [archive index](2026-09-06-preserved-audits.md) and [source manifest](2026-09-06-preserved-audits-source-manifest.json).

# CNC Safety Architecture, Operator Modes, and Human Factors Deep Research

**Date:** 2026-07-13
**Status:** Research dossier, tranche 6
**Companions:** `2026-07-13-cnc-software-deep-research-foundation.md`, `2026-07-13-cnc-cam-motion-machine-architecture.md`, `2026-07-13-cnc-controller-post-and-process-workflows.md`, `2026-07-13-cnc-controller-machine-integration-and-fault-verification.md`, `2026-07-13-cnc-motion-control-drive-process-and-metrology.md`
**Product mapped:** KerfDesk / LaserForge 2.0 `audit-current-main`

## Executive verdict

KerfDesk has a thoughtful host-side motion application, but it is not—and should not pretend to be—the safety control system of a CNC machine.

That is the central finding of this tranche. The Electron application, Windows, USB/TCP transport, ordinary controller firmware, and application state can all fail in ways that make them unsuitable as the sole implementation of an emergency stop, guard interlock, safe speed, safe standstill, or restart-prevention function. A credible machine architecture puts those functions in a validated safety chain: safety-rated input devices, safety relay or safety PLC, safe drive functions/contactors/brakes where required, and independent feedback. The desktop application observes that chain, makes conservative normal-operation requests, explains state, records evidence, and refuses unsafe work; it does not manufacture safety truth from a serial status string.

The live application also collapses different operator actions into dangerously similar words:

- **Pause** may mean GRBL feed hold or merely stop host transmission while buffered motion continues.
- **Stop** may mean controller soft reset, or it may only queue spindle/coolant-off commands behind already-buffered work.
- **Recover controller** always sends a soft reset, even when the displayed problem was a disconnect, controller error, or uncertain physical state.
- **Unlock** sends `$X` after an alarm without proving that the initiating cause is cleared.
- reconnecting clears the visible safety notice before the machine has been reconciled.
- the checkpoint banner still offers line-based continuation without reconstructing the physical engagement and machine state required for safe re-entry.

None of those actions is necessarily wrong as an operational command. The problem is semantic and architectural: operational hold, program stop, abort/reset, guard stop, emergency stop, energy isolation, alarm acknowledgement, cause clearance, safety reset, and Cycle Start are distinct events with different owners and evidence.

The correct product model is an orthogonal state machine, not one `streamer.status` field:

```text
machine operating mode
× program execution state
× normal motion state
× safety-function state
× controller/alarm state
× reference and position confidence
× process state (spindle, coolant, extraction, clamp, tool)
× recovery transaction phase
× operator authority and physical presence
```

The most important practical rule is:

> Clearing a cause, acknowledging an alarm, resetting a safety function, restoring controller readiness, reconstructing process state, and authorizing new motion are separate steps. No one step may silently perform the others.

For the interrupted-cut example that began this research, the safe answer is therefore not “resume from a saved line.” It is a recovery transaction with machine-specific authorization: make the machine safe; reconcile position, tool, workholding, guard, spindle, and controller state; reconstruct the required modal/process state; generate a clearance/re-entry path; prove spindle readiness before material engagement; and require a distinct Cycle Start. Some failures make automatic continuation impossible and require controlled abandonment or re-machining.

The precise invariant corrects a common misconception:

> The cutter must be proved clear of stock, fixtures, clamps, and people. The spindle may then start while the axes remain stationary in that verified clear pose. Prove at-speed; only then begin a controlled approach and cutting entry.

“Axes must move before the spindle starts” is not a universal CNC rule. Moving during spindle acceleration can introduce another hazard. The prohibited condition is spindle start while the cutter is engaged or the clearance pose is unverified.

## 1. Scope and standards boundary

### 1.1 This is design research, not a conformity certificate

This dossier is an engineering map. It does not declare that a particular machine is compliant, determine a required Performance Level or Safety Integrity Level, replace a machine-specific risk assessment, or approve an electrical design. Those conclusions require the complete machine, intended use, reasonably foreseeable misuse, hazard analysis, applicable law and Type-C standard, schematics, component data, calculations, commissioning tests, and validation by competent people.

The standards hierarchy matters:

- **ISO 12100** supplies the general risk-assessment and risk-reduction method.
- Type-B standards cover cross-machine subjects such as emergency stop, guards, interlocking, unexpected start, and safety-related control systems.
- a Type-C standard supplies requirements for a particular machine class and takes precedence for hazards it covers.
- local law, electrical codes, workplace rules, and the actual destination market still apply.

[ISO 12100:2010](https://www.iso.org/standard/51528.html) remains current as of this research and defines the machinery risk-assessment/risk-reduction method. [ISO 13849-1:2023](https://www.iso.org/standard/73481.html) addresses safety-related parts of control systems, including software, while the current consolidated [IEC 62061:2021+A1:2024+A2:2026](https://webstore.iec.ch/en/publication/112847) addresses design, integration, and validation of machinery safety-related control systems. Neither selects the safety functions or target integrity for this machine; those come from risk assessment and applicable Type-C requirements.

### 1.2 Router versus metal machining centre

KerfDesk can control different processes, so “CNC” is not a sufficient standards classification.

- [ISO 16090-1:2022](https://www.iso.org/standard/81558.html) covers metal/non-combustible-material milling machines, machining centres, and transfer machines. It explicitly excludes wood and materials with similar physical characteristics.
- [ISO 19085-1:2021](https://www.iso.org/standard/77655.html) gives common safety requirements for woodworking machinery.
- [ISO 19085-3:2021](https://www.iso.org/standard/75953.html) specifically covers NC/CNC boring and routing machines processing wood and several related/composite materials. A replacement draft is under development, so its status must be refreshed during a real design project.

For a desktop CNC router cutting wood or wood-like stock, ISO 19085-1 plus ISO 19085-3 is the closer Type-C starting point. ISO 16090 remains useful comparative evidence for industrial CNC operating concepts, but it must not be represented as the sole applicable product standard.

### 1.3 Laws and editions are moving targets

The [EU Machinery Regulation 2023/1230](https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX%3A32023R1230) contains particularly clear control-system principles: faults and foreseeable human error must not create hazardous situations; stop commands take priority; emergency stop remains available across modes; releasing an emergency-stop device permits but does not cause restart; operating modes with defeated safeguards need restricted authority, sustained action, reduced-risk conditions, and suppression of linked automatic sequences; power or communication restoration must not cause unexpected start. Its main application date is a legal question outside this dossier, but these are strong architecture requirements.

For North American machines, [NFPA 79:2024](https://link.nfpa.org/all-publications/79/2024) is a current electrical standard for industrial machinery, and OSHA rules and workplace practices also apply. [IEC 60204-1:2016+A1:2021](https://webstore.iec.ch/en/publication/71256) is the international electrical-equipment-of-machines reference. A product team must build a jurisdiction matrix instead of mixing clauses informally.

## 2. Safety is a machine property, not a UI feature

### 2.1 Three-step risk reduction

The practical ISO 12100 order is:

1. eliminate or reduce hazards by inherently safe design;
2. use safeguarding and complementary protective measures for residual hazards;
3. provide information for use, training, warnings, and PPE for residual risk.

A dialog that says “use the physical E-stop” is step 3. It cannot replace step 1 or 2. Likewise, a red software button is not an emergency stop merely because it is prominent.

### 2.2 Define each safety function from sensor to final element

Every claimed safety function needs an explicit specification:

```text
hazard and initiating condition
  -> input device(s)
  -> safety logic
  -> output/final switching element(s)
  -> safe state and maximum response time
  -> feedback/diagnostics
  -> reset and restart behavior
  -> required PLr or SIL
  -> proof/periodic test and validation evidence
```

Examples include:

- emergency stop of axes and spindle;
- guard-open stop and prevention of restart;
- guard locking until spindle/run-down hazard has ended;
- prevention of unexpected startup after power/communication restoration;
- safely limited setup speed/direction;
- safe standstill while an operator is inside a protected space;
- safe control of a gravity-loaded Z brake;
- extraction, coolant, vacuum clamp, or fire-protection interlocks where their loss creates unacceptable risk.

The required integrity is assigned per function, not to “the machine” as one number. [ISO 13849-2:2012](https://www.iso.org/standard/53640.html) requires validation by analysis and testing of the specified functions, architecture/category, and achieved Performance Level. [IEC 62061 consolidated edition 2.2](https://webstore.iec.ch/en/publication/112847) likewise includes lifecycle, verification, validation, parameterization, configuration management, and periodic testing—not just a relay selection exercise.

### 2.3 The desktop application is outside the safety chain by default

KerfDesk may:

- request an ordinary hold or controlled program stop;
- observe a non-safety mirror of guard/E-stop/STO state;
- block Start more conservatively than the machine controller;
- explain why motion is inhibited;
- preserve event/evidence history;
- prepare a recovery transaction;
- require acknowledgement and a deliberate normal Cycle Start.

It must not be the only means that:

- detects an E-stop or guard opening;
- removes torque from an axis/spindle;
- monitors safe speed, standstill, direction, or position;
- prevents unexpected restart;
- holds a vertical axis against gravity;
- verifies a guard is closed/locked;
- decides that a safety chain is healthy after a fault.

Windows scheduling, process crashes, UI freezes, USB buffering, serial disconnect, stale status, TCP routing, firmware interpretation, and software updates are all common-cause and systematic-failure paths. Calling the result “safety” without the required lifecycle and validated architecture creates false assurance.

## 3. Stop vocabulary: nine different events

### 3.1 The application needs precise names

| Term | Purpose | Typical behavior | Can resume directly? | Owner |
| --- | --- | --- | --- | --- |
| Feed hold | Temporarily suspend normal program motion | Controller decelerates/holds; process state may remain active | Often, after defined checks | CNC controller |
| Program stop | End/suspend at an intended program boundary | Coordinated process/motion sequence | From defined program state | CNC/controller workflow |
| Controlled stop | Bring hazardous motion to rest under control | Decelerated stop | Depends on stop type and cause | Controller/drive |
| Abort | Terminate current program execution | Planner flush/reset may lose modal or position confidence | No blind resume | CNC/controller |
| Normal machine stop | Render affected machine functions safe | Stop has priority over Start; actuators may be de-energized | New Start only | Machine control |
| Guard stop | Protective-device demand | Safety-rated stop and inhibit while access is unsafe | Only after guard/reset/start policy | Safety system |
| Emergency stop | Avert actual or impending danger | Fastest risk-reducing stop without adding hazard | Never by release alone | Safety system/operator |
| Energy isolation | Make intervention safe from all hazardous energy | disconnect, lock/tag, dissipate/secure stored energy, verify | Formal restoration process | Authorized person |
| Safety reset | Acknowledge restored protective function after cause is cleared | Resets a latched safety demand; does not start motion | Separate Cycle Start required | Located/authorized reset control |

The words in the UI must describe what the selected controller and machine actually do. If a driver lacks realtime feed hold, a button cannot honestly say “Pause” without stating that already-buffered motion will continue. If Stop only queues `M5/M9` behind in-flight G-code, it cannot promise immediate spindle/beam cessation.

### 3.2 Stop categories are behavior, not button labels

IEC 60204-1 defines stop categories commonly summarized as:

- **Category 0:** stop by immediate removal of power to machine actuators—an uncontrolled stop;
- **Category 1:** controlled stop with power available to achieve the stop, then removal of actuator power;
- **Category 2:** controlled stop with actuator power left available.

Which category reduces risk is machine- and hazard-specific. Category 0 can allow a heavy spindle or axis to coast, drop, or lose controlled braking. Category 1 may stop faster and more predictably, but its controlled path and subsequent energy removal must themselves satisfy the safety-function design. Category 2 retains energy and is appropriate only where the risk assessment and safe monitoring justify it.

Drive functions make this concrete. The [Siemens SINAMICS Safety Integrated manual](https://cache.industry.siemens.com/dl/files/722/109781722/att_1031219/v1/S120_safety_fct_man_0620_en-US.pdf) states that STO prevents torque-producing energy, SS1 brakes and then invokes STO, SOS monitors standstill while the drive remains under closed-loop control, and SS2 brakes then enters SOS. It maps SS1 to Category 1 and SS2/SOS to Category 2 implementations. These are safety-rated drive subfunctions; ordinary drive “OFF” commands, `M5`, GRBL hold, or Ctrl-X are not interchangeable with them.

### 3.3 STO does not mean “the machine is harmless”

Safe Torque Off prevents the drive from generating torque. It does not necessarily:

- brake a rotating spindle;
- stop it before a person reaches the tool;
- electrically isolate the drive/motor;
- prevent gravity from dropping a Z axis;
- secure a suspended load;
- stop motion caused by external force;
- remove pneumatic, hydraulic, vacuum, thermal, or stored energy;
- prove that a cutter has stopped.

The Siemens manual explicitly shows that an STO-selected motor can coast to rest and that the power unit/motor are not electrically isolated. SS1 adds controlled deceleration before STO. A vertical axis may additionally require safe brake control, a suitable holding brake, brake diagnostics/test, counterbalance, or mechanical restraint. A spindle-access guard may need locking and safe speed/standstill evidence rather than a simple “spindle command = 0” bit.

### 3.4 E-stop is complementary and latched

[ISO 13850:2015](https://www.iso.org/standard/59970.html) gives general emergency-stop design principles. It explicitly treats emergency stop as a function independent of energy type and does not make it a substitute for risk reduction such as guarding.

The EU Machinery Regulation states that emergency stop must remain operational in every mode, be clearly identifiable and accessible, stop the hazardous process as quickly as possible without adding risk, latch the stop demand, and only permit restart after release. [Pilz's standards FAQ](https://www.pilz.com/en-US/support/faq/standards/articles/180045) summarizes the same critical sequence: reset at the actuated device by intentional human action, only after the hazard is removed; release must not automatically restart the machine; a separate voluntary Start is required.

Therefore:

```text
E-stop actuated
  -> safety outputs reach their specified safe state
  -> E-stop remains latched
  -> initiating hazard is investigated and removed
  -> operator twists/pulls the physical device to release it
  -> safety reset is performed from an appropriate visible location
  -> controller/machine recovery and reference reconciliation occur
  -> separate Cycle Start authorizes normal motion
```

No desktop “Recover” button may compress that sequence.

## 4. Guards, access, and unexpected start

### 4.1 A door indication is not yet a guard safety function

[ISO 14120:2015](https://www.iso.org/standard/59545.html) covers guard design/construction. [ISO 14119:2024](https://www.iso.org/standard/75942.html) covers selection and design of guard interlocking devices and measures against foreseeable defeat. It explicitly routes safety-related signal processing to ISO 14118, ISO 13849-1, and IEC 62061.

A GRBL status `Door` token is valuable controller evidence, but on its own it does not establish:

- the sensor type and wiring architecture;
- detection of shorts, cross faults, welded contacts, actuator defeat, or bypass;
- guard position versus guard locking;
- the stopping-time versus access-time calculation;
- that the spindle or axes actually reached a safe state;
- the safety chain's PL/SIL;
- reset location and visibility;
- whether multiple access points mask one another's faults.

KerfDesk should display it as reported controller state, not certify “guard safe.” A separate machine integration can expose a non-safety diagnostic mirror of the validated guard chain with provenance and freshness.

### 4.2 Guard opening is a transaction with phases

An industrial guard cycle can require:

```text
access requested
  -> normal process stops or safety stop is demanded
  -> hazardous motion/run-down reaches validated safe condition
  -> guard unlock permission becomes true
  -> operator opens guard
  -> machine remains inhibited during access
  -> guard closes and lock feedback returns
  -> cause/access area is checked
  -> safety reset at a suitable location
  -> machine/controller state is reconciled
  -> separate Cycle Start
```

The UI should show these phases. “Door” is not a single boolean that can be cleared by a soft reset.

### 4.3 Unexpected start includes more than electrical power restoration

[ISO 14118:2017](https://www.iso.org/standard/66460.html) covers prevention of unexpected startup from electrical, hydraulic, pneumatic, stored/gravity, and external energy. That is directly relevant to desktop CNC recovery:

- reconnecting USB must not reissue a stale Start;
- controller reboot must not restore outputs from cached app intent;
- a queued `~` or Cycle Start must not survive a mode/guard transition;
- power restoration must not automatically start spindle, coolant, extraction, or axes;
- an app update/reload must not cause a motion command;
- a vertical axis must not fall merely because drive torque disappears;
- releasing E-stop or closing a guard must not start motion;
- restoration of a network connection must not execute delayed remote commands.

OSHA's [machine-guarding guidance](https://www.osha.gov/etools/machine-guarding/introduction/safety-considerations) also distinguishes ordinary stopping from hazardous-energy control: servicing can require shutdown, isolation, lock/tag, relief of stored energy, verification, restoration inspection, and notification. E-stop, STO, Stop, and software disconnect are not lockout/tagout.

### 4.4 Guard distance and guard locking use different evidence

[ISO 13857:2019](https://www.iso.org/standard/69569.html) addresses static reach distances through, under, or over protective structures. [ISO 13855:2024](https://www.iso.org/standard/80590.html) addresses safeguard positioning from human approach and stopping performance. [ISO 13854:2017](https://www.iso.org/standard/66459.html) addresses minimum gaps for crushing hazards. These calculations do not substitute for one another and do not cover every hazard such as ejection, dust, fire, heat, or mechanical failure.

For a movable guard that can be reached before a spindle runs down, guard locking may be required until a safety-rated standstill condition or validated run-down time is satisfied. The total response/stopping time includes:

- sensor and input response;
- safety logic/task time;
- safety-network watchdog where used;
- output and drive response;
- braking/coast mechanics at worst credible speed, inertia, load, temperature, voltage, and wear;
- measurement uncertainty and required margin.

One nominal VFD deceleration parameter or a stopwatch observation is not a validated stopping-time basis.

## 5. Operating modes and authority

### 5.1 Mode must be orthogonal to program state

Industrial CNCs do not treat “paused” as a complete description. At minimum KerfDesk needs separate concepts for:

- physical/machine mode selector state;
- application-requested operating context;
- controller interpreter mode;
- program execution state;
- motion state;
- safety-function state;
- stop/fault cause;
- reference confidence;
- recovery phase;
- operator role/authorization.

A proposed top-level mode vocabulary is:

| Mode | Intended use | Typical command sources | Protective policy |
| --- | --- | --- | --- |
| Power off / isolated | service with hazardous energy isolated | none | lockout/tagout and stored-energy control |
| Disabled / safety inhibited | energized diagnostics, no hazardous actuation | safety system only | STO/other safe state active |
| Manual/Jog | setup from local station | local held jog/handwheel | bounded speed/distance; no program auto-start |
| Setup with safeguarded access | exceptional adjustment | local enabling device + hold-to-run | authorized physical selection, reduced-risk motion, linked sequences disabled |
| MDI | deliberate single/block command | local operator | machine-ready and guard policy enforced |
| Automatic | normal program execution | Cycle Start | safeguards active; program owns motion/process sequence |
| Recovery | restore evidence after interruption/fault | guided recovery transaction | no generic resume; phase- and evidence-gated commands |
| Maintenance/service | competent authorized work | service tools | separate risk-control procedure; not a software convenience toggle |

The [EU Machinery Regulation mode-selection requirements](https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX%3A32023R1230) are a useful baseline: when modes require different protective measures, selection must be lockable or otherwise restricted by operator category; one selection corresponds to one mode; a mode that permits operation with a displaced guard must disable other modes, require sustained action, limit hazardous functions to reduced-risk conditions, and prevent linked automatic sequences.

A dropdown in KerfDesk is not a safety-rated mode selector. It can request or mirror a mode, but a machine that relies on changed protective measures needs an appropriate physical/authorized and validated implementation.

### 5.2 Three-position enabling devices are not simple deadman buttons

Setup motion inside a protected space is commonly paired with reduced speed and a three-position enabling device:

```text
released       -> stop/inhibit
middle enabled -> permitted while deliberately held
fully squeezed -> stop/inhibit (panic response)
```

The enabling device permits a defined action; it does not by itself initiate movement. Motion normally also requires a sustained direction/jog command. The system must prevent bypass and linked automatic motion. A mouse button, keyboard key, or touchscreen press does not have equivalent safety properties.

### 5.3 Locality and presence matter

Start, reset, guard unlock, jog, and setup commands have different presence requirements. A good operator model asks:

- Can the person see the complete hazard zone?
- Can another person be inside or behind the machine?
- Is the control at the affected station?
- Is the operator physically holding an enabling control?
- Can another control station issue conflicting motion?
- Is remote control permitted for this mode and function?
- Did the machine announce impending automatic motion audibly/visibly where needed?

The application should not offer remote Start/Reset merely because the transport supports TCP. Remote observation, job transfer, and diagnostics are different privileges from remote hazardous motion.

## 6. Reset, acknowledgement, unlock, and restart

### 6.1 The six-gate sequence

The minimum conceptual sequence after a protective stop or fault is:

1. **Stop achieved:** the specified safety output state is reached.
2. **Cause cleared:** E-stop released, guard closed/locked, limit freed safely, drive fault repaired, access zone checked.
3. **Safety reset:** the safety system accepts the restored inputs; no motion starts.
4. **Fault acknowledgement:** controller/drive diagnostics are acknowledged where appropriate.
5. **Machine recovery:** axes/reference/process state are reconciled; a safe recovery plan is prepared.
6. **Cycle Start:** a separate deliberate action authorizes motion.

Some incidents require energy isolation and maintenance before step 2. Some invalidate position and require homing. Some leave a tool embedded in material and prohibit ordinary homing until a manual extraction plan is completed. Some require spindle coast-down or brake proof before access.

### 6.2 `$X` is not safety reset

GRBL `$X` clears an alarm lock so the controller can accept commands. It does not prove:

- the E-stop or limit circuit is healthy;
- a guard is closed and locked;
- the operator has checked the hazard area;
- lost position has been restored;
- the cutter is free of stock;
- the spindle is stopped or ready;
- the safety chain is reset;
- the prior program can continue.

KerfDesk currently presents **Home** and **$X Unlock** for broad alarm conditions. The UI should instead route typed causes to cause-specific recovery playbooks. Unlock should be an explicit controller action after prerequisites, never a universal “make ready” button.

There is also a concrete visual-state bug in `src/ui/state/laser-store.ts`: `unlockAlarm()` writes `$X` and then immediately sets `alarmCode: null` and `homingState: 'unknown'`. A successful serial write is treated as visual alarm clearance without waiting for fresh controller status or proof that the initiating input/cause is inactive. The correct sequence is:

```text
alarm active
  -> operator acknowledges the event
  -> prerequisites/cause-clearance checks
  -> controller recovery command sent
  -> recovery-awaiting-fresh-status
  -> cause reported inactive and controller state reconciled
  -> reference/process restoration as required
  -> ready for a separate Start
```

Never use `$X write succeeded -> alarm hidden -> ready`.

### 6.3 Ctrl-X is not “recover machine”

GRBL soft reset is useful for aborting controller operation and restoring a parser baseline. It may also invalidate planned motion, modal state, work evidence, and machine position depending on machine/controller behavior. It cannot release a physical E-stop, reset a safety relay, close a guard, stop a coasting spindle, or prove that the workspace is clear.

KerfDesk's generic **Recover controller** action currently sends Ctrl-X for every safety notice. Rename and narrow it to something like **Reset controller interpreter**, state its consequences, and enable it only when that action matches the typed fault playbook.

## 7. Safe drive and motion functions

### 7.1 A practical function vocabulary

The [IEC 61800-5-2:2016](https://webstore.iec.ch/en/publication/24556) family defines functional-safety considerations for safety-related power-drive systems. Common functions include:

| Function | Meaning in practice | CNC example |
| --- | --- | --- |
| STO | Prevent torque generation | inhibit axis/spindle drive after stop |
| SS1 | Safely controlled/monitored deceleration, then STO | rapid risk-reducing spindle/axis stop |
| SS2 | Safely decelerate, then SOS | stop but retain active position control |
| SOS | Safely monitor standstill with drive energized | operator access where torque must hold axis |
| SLS | Safely monitor a speed limit | setup/jog with access |
| SSM | Safe indication that speed is below a threshold | permit guard unlock after spindle run-down |
| SDI | Safely monitor permitted direction | setup motion away from pinch/cutter hazard |
| SLP | Safely limit position/range | restricted maintenance zone |
| SBC/SBT | Safe brake control/test | gravity-loaded Z axis |

Availability, definitions, response, feedback requirements, encoder dependence, and achievable integrity are product-specific. Never infer a safety function from an ordinary encoder readout or firmware speed estimate.

### 7.2 Normal control and safety control must cooperate without sharing a single failure

A common architecture is:

```text
normal CNC/app command ───────────────> motion controller ─────> drive command
                                                       │
guard / E-stop / enabling device ──> safety logic ─────┼─────> STO/SS1/SLS/SBC
                                                       │
safe feedback <──────────────── safety drive/sensors ──┘
```

The safety function can override normal control. Normal control can request a graceful deceleration, but the safety path independently enforces its reaction and timing. Feedback is not merely echoed command state.

### 7.3 Redundancy is not two copies of the same unsafe signal

Two software booleans derived from one controller packet are one channel. Two contacts wired in series without adequate diagnostics can mask faults. Two application processes on the same PC share power, OS, transport, and code. Safety architecture considers:

- category/structure;
- diagnostic coverage;
- dangerous failure rate and mission time;
- common-cause failures;
- discrepancy timing;
- fault reaction;
- systematic capability and software process;
- component suitability and environmental ratings;
- proof tests, test intervals, and bypass management.

The Siemens drive example uses two-channel safety parameterization and safe inputs/PROFIsafe—not duplicate UI observations. The exact PL/SIL calculation belongs to the machine safety design and validation file.

### 7.4 Spindle evidence has levels

These facts are not interchangeable:

| Evidence | What it proves |
| --- | --- |
| `M3` was sent/acknowledged | command accepted within controller protocol semantics |
| ordinary VFD Run output | drive reports an operational run condition |
| measured RPM | a process sensor reports rotation/speed within its ordinary diagnostic design |
| safety-rated speed/standstill | a validated safety subsystem may use it for the specified personnel-protection function |

Spindle hazards include cutter/holder ejection, overspeed, imbalance, breakage, contact during run-down, entanglement, buried-tool restart, drive/contactor failure, fire/hot-tool conditions, and voltage remaining after STO. A guard-unlock policy cannot be based on `M5`, elapsed dwell, GRBL `FS`, or “job complete” unless the machine-specific safety design validates that evidence path.

### 7.5 Automatic tool changer recovery is a machine transaction

An ATC combines spindle orientation, Z/tool-change pose, clamp/unclamp, springs, pneumatic energy, arm/carousel/pocket motion, tool identity, and operator access. An interruption can leave a tool in the spindle, arm, or pocket; a clamp partly actuated; a carousel misindexed; or a controller table inconsistent with physical reality.

Never replay `M6` after an unknown interruption. Enter `ATCRecoveryRequired` and reconcile:

- spindle tool and commanded tool;
- arm-side tool(s) and orientation;
- active pocket and carousel position;
- clamp/unclamp and drawbar feedback;
- spindle orientation;
- Z/tool-change reference;
- air pressure and stored-energy state;
- guard/access state.

Haas implements ATC recovery as a dedicated guided transaction; incorrect answers about the physical tool/pocket state can drop a tool or crash the mechanism. Source: [Haas side-mount tool-changer recovery](https://www.haascnc.com/service/troubleshooting-and-how-to/how-to/mill---side-mount-tool-changer---manual-recovery.html).

Manual recovery should expose one bounded mechanism action at a time under the machine's validated setup/protective policy. Missing or contradictory sensors mean stop and maintenance, not inference.

### 7.6 Pneumatic and stored-energy state

Turning a valve output off does not prove a pneumatic actuator is safe. Trapped volumes, pilot-operated valves, check valves, springs, gravity, pressure reaccumulation, shared supplies, and exhaust behavior can all cause motion. Machine-specific measures can include:

- lockable air isolation;
- monitored dump/exhaust valves;
- pressure sensing and proof of discharge;
- mechanical support/blocking;
- fail-safe clamp mechanics;
- controlled exhaust;
- prevention of movement when pressure returns;
- service procedures for residual energy.

Vacuum workholding deserves the same treatment. Loss of vacuum may turn a normal toolpath into workpiece ejection; “pump commanded on” is not clamp proof. The safety/function requirement depends on the machine, material, cutter forces, enclosure, and risk assessment.

## 8. Human factors: make the safe action the comprehensible action

### 8.1 The HMI must answer five questions

At any stop or inhibition, the operator should be able to tell:

1. **What happened?** Feed hold, guard opened, E-stop, drive fault, limit, disconnect, controller reboot, or host stall.
2. **What is still hazardous?** Spindle coasting, axis torque enabled, Z unsupported, tool embedded, extraction off, position unknown.
3. **Who owns the stop?** Safety hardware, controller, drive, application, or operator isolation procedure.
4. **What evidence is missing?** Guard lock, safety reset, fresh Idle, homing, spindle-at-zero, tool verification, clearance path.
5. **What is the next permitted action?** Inspect, isolate, release device, reset safety, home, jog in setup mode, rebuild recovery plan, or abandon job.

“Controller not ready” is not adequate when a person is deciding whether to put a hand near a cutter.

### 8.2 Latches should follow hazards, not notification convenience

KerfDesk's safety notice can be dismissed and is cleared on fresh connection. A hazard-related event should instead create an incident/recovery record with:

- immutable event type and timestamp;
- connection/controller boot epoch;
- last trustworthy position/reference/process evidence;
- safety input snapshot with provenance and freshness;
- commands outstanding and acknowledged;
- operator acknowledgements and authority;
- required recovery playbook;
- explicit resolution evidence.

The banner may be hidden, but the machine-readiness latch must remain until its resolution conditions are true. Dismissal is a view preference, not a state transition.

### 8.3 Avoid alarm floods and ambiguous color

Alarm priority should reflect required operator response, not internal subsystem importance. Use persistent text and symbols rather than color alone. Suppress derivative alarms when one root event explains them, but preserve diagnostics. Distinguish:

- safety demand active;
- safety fault/diagnostic failure;
- controller alarm;
- process fault;
- warning/advisory;
- operator action required.

Do not label an ordinary software control “Emergency Stop.” Do not use the same red treatment for irreversible abort and harmless validation errors. Do not put `$X Unlock` as the visually dominant action before explaining why the alarm occurred.

### 8.4 Bypasses require governance

Any override, guard bypass, maintenance key, reduced-speed exemption, or simulated input needs:

- explicit authorized role;
- physical or controlled activation;
- time/operation scope;
- unmistakable indication at every relevant station;
- restriction of incompatible modes;
- audit record;
- automatic expiry where appropriate;
- validation that defeat is not the easy production workaround.

OSHA notes that safeguards that obstruct work tend to be overridden. That is a design signal: improve workholding, loading, visibility, access, chip extraction, and setup workflow; do not normalize bypass.

## 9. Industrial controller workflow comparison

The controller comparison is not about copying a pendant. It shows which state distinctions have survived decades of real machine operation.

### 9.1 Cross-controller matrix

| Control | Explicit modes and proof controls | Hold/stop distinctions | Restart/recovery design | Main lesson for KerfDesk |
| --- | --- | --- | --- | --- |
| Haas | Setup/Edit/Operation contexts; Handle Jog, Zero Return, MDI, Memory, Graphics, Single Block, Optional Stop, Block Delete | Feed Hold stops axes but normally leaves spindle running; Reset, Stop, E-stop, and Cycle Start are separate | Run–Stop–Jog–Continue stores the interruption point, stages a reduced-speed return, stops again, then needs another Cycle Start; tool-changer recovery is a dedicated wizard | Screen, operating mode, execution state, and recovery are separate; return is staged and operator-gated |
| LinuxCNC | Manual, MDI, Auto; E-stop and machine power separate; Run, Step, Pause, Resume, Stop, optional pause, block skip | Program execution is normally blocked before homing; commanded/actual and machine/relative coordinates are distinct | Run From Selected Line is explicitly cautioned and restricted; it is not universal recovery | Keep controller mode and coordinate/evidence meanings explicit even if UI auto-switches modes |
| Siemens SINUMERIK | JOG, REF POINT, REPOS, MDI, AUTO, TEACH IN; multiple single-block definitions; program test, dry run, reduced rapid | RESET, CYCLE STOP, CYCLE START, protective/safety functions, and program controls are distinct | REPOS manages displacement away from an interrupted contour; Safety Integrated can require position agreement; mode change itself must not cause action | “Single block,” “dry run,” “referenced,” and “reset” each need precise semantics |
| HEIDENHAIN | Manual, handwheel, positioning/MDI, Program Run Single Block, Full Sequence, Programming, Test Run | NC Start advances distinct restoration/motion phases | Block scan reconstructs program state, presents tool/spindle/axis state, and requires separate NC Start presses through return positioning | Restart is a state-reconstruction and reposition transaction, not a line seek |
| PathPilot | Ref/home, MDI/run controls, current/start/next block, distance-to-go | Feed Hold leaves spindle running; Stop stops axes/spindle and rewinds; Reset restores modal baseline/alarms | Set Start Line scans modal state but deliberately does not start spindle/coolant; operator owns physical preparation | Be honest about what software reconstructs and what remains operator responsibility |
| MASSO | Homing, staged Jump to Line, Jogback, controller alarms | E-stop input is an indication; physical circuit must disable drives/spindle/actuators | Processes file state, then stages machine-home/Z and individual axis returns with separate Cycle Start presses; faults require cause removal and often re-homing | Safety hardware, cause clearance, reference recovery, and staged motion are separate gates |

### 9.2 Haas: hold, jog-away, and return are one qualified session

Haas explicitly separates pendant functions:

- `FEED HOLD` stops programmed axis motion while the spindle remains running;
- `CYCLE START` begins or releases an eligible held transaction;
- `RESET` clears/rewinds controller state;
- physical `E-STOP` disables hazardous machine functions;
- `SINGLE BLOCK`, `OPTION STOP`, and `BLOCK DELETE` alter program execution in visibly different ways;
- `RECOVER` enters a dedicated tool-changer recovery flow.

Haas also warns that feed hold does not universally stop every synchronized operation, dwell timer, or auxiliary behavior. Source: [Haas control pendant](https://www.haascnc.com/service/online-operator-s-manuals/mill-operator-s-manual/mill---control-pendant.html).

The Haas Run–Stop–Jog–Continue flow is valuable because it records an interruption pose, lets the operator jog away, returns X/Y/rotary at reduced rate and then Z, stops again in feed hold, and requires another Cycle Start to resume. It warns not to change tools or offsets, does not claim to reverse the jog-away path, and can scan program state. Source: [Haas mill operation](https://www.haascnc.com/service/online-operator-s-manuals/mill-operator-s-manual/mill---operation.html).

This is not crash recovery. It is a carefully bounded transaction within a still-qualified controller session. If the controller reboots, position is lost, the tool changes, or safety state becomes unknown, the assumptions no longer hold.

Haas Setup mode is selected by a physical key. Door-open operation restricts automatic program execution, spindle start, tool change, zero return, and rapid home while permitting tightly bounded setup functions. Source: [Haas Run/Setup door rules](https://www.haascnc.com/service/troubleshooting-and-how-to/reference-documents/door-rules---run---setup-mode.html). A screen toggle in KerfDesk is not equivalent.

### 9.3 LinuxCNC: mode and reference are explicit

LinuxCNC's primary controller modes are Manual, MDI, and Auto. Homing normally occurs in Manual; file execution belongs to Auto; typed G-code belongs to MDI. AXIS sometimes switches mode to support an action, but the internal state remains real and command eligibility follows it. Source: [LinuxCNC user introduction](https://linuxcnc.org/docs/html/user/user-intro.html).

By default, program/MDI work is blocked before homing. `NO_FORCE_HOMING=1` relaxes that check, and the documentation warns that the controller then does not know joint travel limits. Source: [LinuxCNC INI configuration](https://linuxcnc.org/docs/html/config/ini-config.html).

AXIS exposes E-stop, machine power, Run, Step, Pause, Resume, Stop, optional pause, and block skip separately. It also distinguishes commanded versus actual position and machine versus relative coordinates. Its Run From Selected Line feature is caution-marked and unsuitable for some program structures such as subroutine-containing programs. Source: [LinuxCNC AXIS manual](https://linuxcnc.org/docs/html/gui/axis.html).

The lesson is not that LinuxCNC's feature is universally safe; it is that modes and coordinate meanings remain explicit even in an open, flexible controller.

### 9.4 Siemens: REPOS, proof modes, and exact single-block semantics

SINUMERIK separates JOG, REF POINT, REPOS, MDI, AUTO, TEACH IN, and single-block variants. REPOS is specifically about restoring displacement after leaving an interrupted contour; it is not generic jog plus Resume.

`RESET` stops program processing and reinitializes the NCK for a new execution context. `CYCLE STOP` pauses eligible processing. `CYCLE START` starts or continues. Single-block variants can stop at different semantic boundaries, including or excluding internal cycle blocks. Source: [SINUMERIK ONE milling operating manual](https://support.industry.siemens.com/cs/attachments/109925735/ONE_milling_op_man_0124_en-US.pdf).

SINUMERIK also distinguishes:

- program test with axes stationary;
- dry execution using substituted feed;
- reduced rapid;
- optional stop;
- handwheel offset;
- skip levels;
- multiple single-block granularities.

Therefore “simulation,” “test,” “dry run,” “air cut,” and “single block” are not one feature.

Siemens Safety Integrated emphasizes that selecting a mode must not itself initiate machine action and that, if setup mode removes one protective function, another suitable safety function must replace it. Source: [Siemens Safety Integrated application manual](https://support.industry.siemens.com/cs/attachments/81366718/application_manual_sirius_safety_integrated_en-US.pdf?download=true).

### 9.5 HEIDENHAIN: block scan is a staged restoration transaction

HEIDENHAIN separates Manual, Electronic Handwheel, MDI-style positioning, Program Run Single Block, Program Run Full Sequence, Programming, and Test Run.

Its block-scan workflow calculates program state to a target, restores/reviews tool, spindle, and tilted-axis conditions, presents the required axis-return sequence, and uses separate NC Start actions to advance restoration and reposition phases. Source: [HEIDENHAIN TNC7 setup and program run](https://content.heidenhain.de/doku/tnc_guide/pdf_files/TNC7_basic/81762x-20/einrichten/1410286-22.pdf).

HEIDENHAIN also warns that Test Run can omit PLC positioning, tool-change macros, and M-function movements, so a successful simulation is not proof of every physical behavior. Source: [HEIDENHAIN Test Run guidance](https://content.heidenhain.de/doku/tnc_guide/pdf_files/TNC128/77184x-07/einrichten/1263174-20.pdf).

KerfDesk should express proof levels honestly:

1. parse success;
2. geometric preview;
3. bounds/no-go analysis;
4. machine-configuration simulation;
5. controller interpreter test without motion;
6. physical air cut/dry run;
7. reduced-rapid single-block proof;
8. supervised first material cut;
9. qualified repeat production.

### 9.6 PathPilot: explicit limits of Set Start Line

PathPilot requires referencing after power-up, E-stop, position loss, collision, or axis stall/fault, and recommends Z first to clear the work before lateral movement. Source: [PathPilot tools and features](https://knowledgebase.tormach.com/1100m/pathpilot-tools-and-features-1100m).

Its controls distinguish:

- Feed Hold: motion pauses; spindle remains running;
- Stop: axes and spindle stop, program rewinds, but modal details may remain;
- Reset: exits E-stop/reset context, restores modal baseline, clears eligible alarms, rewinds;
- Cycle Start: becomes the expected action after defined holds such as `M01`, single block, and manual tool change.

Set Start Line scans backward to restore modal state such as WCS/path mode, but it does not turn on spindle or coolant. The operator is explicitly responsible for preparing the correct physical state before Cycle Start. Source: [PathPilot interface](https://knowledgebase.tormach.com/pcnc-1100/pathpilot-interface-pcnc-1100).

That feature is operator-dependent, but its evidence boundary is honest: reconstructed interpreter state is not reconstructed physical state.

### 9.7 MASSO: one Cycle Start per return phase

MASSO Jump to Line requires re-homing after power/E-stop/position loss, processes the file to reconstruct program parameters, lets the operator review the result, moves Z to machine home, then stages individual return moves with separate Cycle Start actions and brings Z into position last. It restricts restarts inside cutter compensation. Source: [MASSO Jump to Line](https://docs.masso.com.au/getting-started-guides/machining-with-masso/resuming-program-or-jump-to-line).

Jogback similarly records the inspection departure point and stages X/Y/A/B/Z return. Source: [MASSO Jogback](https://docs.masso.com.au/getting-started-guides/machining-with-masso/keyboard-and-key-shortcuts/jog-back?ln=en).

MASSO alarm workflows require clearing the physical drive/air/spindle/coolant cause and frequently re-homing before production. Source: [MASSO controller alarms](https://docs.masso.com.au/getting-started-guides/machining-with-masso/graphical-interface/controller-alarms). It also states that its controller E-stop input is status indication while the physical E-stop circuit must disable drives, spindle, and actuators. Source: [MASSO safe work practices](https://docs.masso.com.au/quick-start-guides/safe-work-practices).

### 9.8 Cross-controller conclusion

Industrial controls consistently reject the idea that one “Resume” verb can safely cover every interruption. KerfDesk should use cause-specific actions:

- **Resume feed hold**;
- **Execute next single block**;
- **Continue after optional stop**;
- **Complete manual tool change**;
- **Return X/Y at reduced rapid**;
- **Return Z to approach plane**;
- **Start spindle in verified clearance**;
- **Begin controlled re-entry**;
- **Start recovered program**.

Each button should preview its next consequential physical action. For example:

> Next Cycle Start moves X and Y at 5% rapid to the stored return point. Z and spindle remain unchanged.

That is materially safer than “Continue?”

## 10. KerfDesk live implementation audit

### 10.1 What is already good

The current application has real strengths that should be preserved:

- active jobs own the command channel and block setup/jog/console interleaving;
- GRBL realtime feed hold and cycle start are used when supported;
- CNC pause intentionally does not turn the spindle off, avoiding a stopped cutter during direct feed-hold resume;
- stream-side pause warns that buffered controller motion can continue;
- Stop guidance tells the operator to use the physical E-stop if unsafe;
- hard limits, controller reboot, disconnect, write failure, and stream stalls create blunt safety notices;
- alarms and reboot can invalidate coordinate/reference evidence;
- fresh Idle is required at important stream and tool-change boundaries;
- homing and work-zero confidence are not assumed after every fault;
- wake locks and unload-stop attempts reduce common desktop failure exposure;
- controller family/capability separation prevents some unsupported commands.

These are credible normal-control safeguards. The recommendation is to describe them accurately, not discard them because they are not safety-rated.

### 10.2 Stop behavior differs by driver

`src/ui/state/laser-job-actions.ts` currently implements:

- **Pause:** realtime `!` when the driver supports hold; otherwise only host transmission pauses and controller-buffered motion drains.
- **Resume:** realtime `~` where supported and stream refill.
- **Stop with soft reset:** Ctrl-X, local stream reset, then delayed `M5/M9` cleanup after reboot/welcome synchronization.
- **Stop without soft reset:** stop sending new work and queue `stopLaserLines` after in-flight lines.

`src/ui/laser/JobRunControls.tsx` labels Stop as halting the job and forcing the beam off, but the non-reset path is not immediate and neither path is a safety-rated stop. CNC spindle/coast behavior is also different from laser emission. The UI should be generated from an explicit stop contract:

```ts
type OperationalStopContract = {
  command: 'feed-hold' | 'controlled-program-stop' | 'abort-reset' | 'stream-stop';
  bufferedMotionMayContinue: boolean;
  plannerWillBeFlushed: boolean;
  controllerReboots: boolean;
  processOffCommandTiming: 'immediate-realtime' | 'after-reset-banner' | 'queued-after-buffer';
  invalidatesPositionConfidence: boolean;
  invalidatesModalConfidence: boolean;
  isSafetyRated: false;
};
```

Show the selected behavior before the operator needs it. A machine profile should state the physical E-stop/guard response separately.

`src/ui/laser/use-job-shortcuts.ts` also describes software Stop as a “panic path.” Remove that phrase. A keyboard shortcut routed through Electron/Windows/serial is a useful ordinary abort shortcut, not a panic guarantee or E-stop.

### 10.3 Safety notice is presentation state, not incident state

`src/ui/state/laser-safety-notice.ts` creates strong warning copy, but `src/ui/laser/SafetyNoticeBanner.tsx` offers generic **Recover controller** and **Dismiss** actions. `clearSafetyNotice` removes the warning without changing readiness evidence. `src/ui/state/laser-connection-actions.ts` clears the notice immediately after a successful port open, before machine-state reconciliation.

This yields an unsafe human-factors pattern:

```text
physical uncertainty
  -> prominent warning
  -> reconnect/dismiss
  -> warning disappears
  -> physical uncertainty still exists
```

Replace it with a typed, latched `MachineIncident` and a separate dismissible notification projection. Successful transport connection may add evidence; it must not resolve the incident.

The notices repeatedly suggest “physical E-stop or power cutoff.” That generic fallback can itself be wrong: raw power removal may produce a long spindle coast, remove controlled braking, or let a gravity-loaded Z fall. Prefer “use the machine's validated hardware emergency stop or emergency-disconnect procedure,” and let the machine builder document the physical reaction.

### 10.4 Raw GRBL state is incomplete safety evidence

`src/core/controllers/grbl/status-parser.ts` parses Idle, Run, Hold, Jog, Alarm, Door, Check, Home, Sleep, and Tool, plus a limited pin set. It deliberately ignores hold/reset/cycle-start pin letters because they were not relevant to framing. It does not provide a general safety-chain model for E-stop, drive faults, guard lock, safe-speed state, brake state, or arbitrary safety I/O.

`src/ui/state/laser-status-line.ts` reacts to Alarm/Sleep by invalidating important state and handles Hold/Door for stall logic, but it does not implement a guard-access lifecycle or safety reset. Fresh `Idle` proves only the controller status semantics for that driver/session; it cannot prove guard closure, spindle standstill, tool clearance, position validity, or safety reset.

The app needs evidence with source and freshness:

```ts
type Evidence<T> = {
  value: T;
  source: 'operator' | 'controller' | 'safety-plc-mirror' | 'drive' | 'sensor' | 'derived';
  observedAt: number;
  sessionId: string;
  expiresAt?: number;
  quality: 'safety-rated-external' | 'diagnostic' | 'operator-attested' | 'inferred';
};
```

The HMI must never upgrade diagnostic or inferred evidence into a safety-rated claim.

### 10.5 Alarm handling needs cause-specific playbooks

`src/core/controllers/grbl/alarm-codes.ts` maps vanilla GRBL and selected grblHAL alarms. Alarm 10 is described as E-stop asserted; 11 requires homing; 12 is a limit; 13 is probe protection. `src/ui/laser/LaserWindow.tsx` can offer both Home and `$X Unlock` broadly.

Problems:

- alarm numbers vary by firmware/build and must be tied to a controller fingerprint;
- an E-stop cannot be resolved by software unlock;
- homing may be unsafe while a tool is embedded or the guard is open;
- a hard limit may require controlled motion off the switch in an authorized manual mode;
- probe protection may have physically stopped motion and should not universally preserve position confidence;
- one-click Home does not prove the machine is clear to move.

Define playbooks per typed cause and machine profile. Each playbook declares permitted commands, operator checks, reference impact, required physical mode, guard policy, and completion evidence.

### 10.6 Sleep and reset carry mechanical consequences

`$SLP` can release stepper holding torque. On a router this may allow Z to fall, a gantry to rack, or axes to move under load. A generic capability boolean such as `sleep` is insufficient. The machine profile needs a mechanical consequence declaration and the UI should disable sleep unless the machine builder has assessed it.

Ctrl-X on unload is a useful best effort but browser teardown cannot guarantee delivery. The machine's physical safety must remain acceptable when the desktop disappears without sending anything.

### 10.7 Checkpoint resume remains a P0

`src/ui/laser/CheckpointResumeBanner.tsx` offers continuation from saved acknowledged progress. Acknowledgement proves protocol admission/completion only within the streamer's defined semantics; it does not prove the cutter's physical location, material engagement, spindle state, modal reconstruction, coordinate validity, workholding, tool condition, or clearance.

The banner currently describes acknowledged lines as “motion lines confirmed.” That wording is too strong. The controller may have acknowledged parsing/admission under its protocol while physical motion completion, cutting, and remaining-stock state are unproved.

The correct immediate product action is to disable generic CNC checkpoint resume. Preserve the checkpoint as forensic/recovery input. A future machine-specific recovery planner may use it after full reconciliation and regenerated safe approach/re-entry.

## 11. Target ownership architecture

### 11.1 Layer contract

| Layer | Owns | Must not claim |
| --- | --- | --- |
| Mechanical design | enclosures, chip/projectile containment, braking/counterbalance, workholding, access geometry | that software compensates for missing physical protection |
| Safety devices | E-stop, guard switch/lock, enabling device, safety sensors | normal program semantics |
| Safety relay/PLC | safety logic, latching, discrepancy/fault handling, reset policy, safe outputs | CAM/job correctness |
| Safety drive/final elements | STO/SS1/SLS/SOS/brake/contactors and feedback | that a normal command proves actual safe state |
| CNC/controller | trajectory, interpreter, normal hold/abort, limits, homing, modal state | safety rating unless explicitly designed/validated for it |
| KerfDesk | job preparation, normal command requests, conservative gating, evidence UX, incident and recovery orchestration | physical safety truth from ordinary transport |
| Operator/authorized maintenance | inspection, cause clearance, tool/workholding setup, physical reset/start, isolation procedure | hidden automatic reconstruction without evidence |

### 11.2 Recommended integration boundary

A practical first machine integration can expose read-only diagnostic mirrors to KerfDesk:

```ts
type MachineSafetyMirror = {
  eStop: Evidence<'active' | 'released' | 'unknown'>;
  guard: Evidence<'open' | 'closed' | 'locked' | 'unknown'>;
  safetyResetRequired: Evidence<boolean>;
  safeMotionState: Evidence<'STO' | 'SS1' | 'SOS' | 'SLS' | 'normal' | 'unknown'>;
  spindleStandstill: Evidence<boolean | 'unknown'>;
  axisBrake: Evidence<'applied' | 'released' | 'fault' | 'unknown'>;
  safetySystemHealthy: Evidence<boolean | 'unknown'>;
  activeMode: Evidence<'manual' | 'setup' | 'mdi' | 'auto' | 'service' | 'unknown'>;
};
```

The hardwired safety chain remains authoritative even if this mirror freezes or lies. The app treats stale/unknown as not ready for normal Start. Write access to safety parameters or reset requires a separately engineered interface; it should not be added as a convenience REST endpoint.

### 11.3 Safety relay, safety PLC, and ordinary controller are different tools

| Technology | Appropriate role | Important limitation |
| --- | --- | --- |
| Safety relay | Small fixed functions such as an E-stop chain, one guard, redundant contactors/STO | Limited zoning, mode logic, safe motion, diagnostics, and distributed I/O |
| Safety PLC/controller | Multiple zones/guards, safe mode selection, tool changers, distributed safety I/O, safety networking, complex reset/fault policy | Needs certified hardware/toolchain, safety task, signatures, configuration control, calculation, commissioning, and validation |
| Safety drive | STO/SS1/SS2/SOS/SLS/SDI/SBC and related drive feedback | Only one subsystem; does not validate sensors, guard logic, mechanics, or the complete function |
| Ordinary PLC/CNC | Trajectory, M-code process sequencing, ordinary limits/interlocks, diagnostics | Must remain subordinate to independent safety permission |
| KerfDesk | Job/CAM workflow, conservative refusal, evidence and recovery guidance | No PL/SIL credit by default |

A safety PLC is not an ordinary PLC running a carefully written task. For example, the [GuardLogix safety reference manual](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/1756-rm012_-en-p.pdf) separates the safety task from standard tasks and documents safety-partner, configuration-signature, I/O, verification, and validation requirements.

### 11.4 Diagnostics and final-element monitoring

“Dual channel” is not a sufficient claim. A credible design considers:

- channel discrepancy timing;
- cross-short and short-to-supply detection, often using different test pulses;
- OSSD/pulse-tested input behavior;
- redundant safety outputs and final elements;
- connection quality and watchdogs;
- common power, connector, routing, environment, and software failures;
- periodic diagnostics/proof tests;
- mechanically linked feedback where contactors are final elements;
- safe brake command and mechanical brake-capability testing where needed.

External Device Monitoring illustrates the full chain:

```text
safety output de-energizes K1 and K2
  -> both contactors must physically open
  -> force-guided mirror contacts must return
  -> missing feedback becomes a latched fault
  -> reset is refused
```

If K1 welds, K2 may still remove energy, but EDM must prevent silent reset. Two application booleans derived from the same GRBL packet do not provide redundancy or diagnostics.

### 11.5 Safety-system state machine

The machine safety controller may expose a diagnostic projection such as:

| State | Meaning |
| --- | --- |
| `unknown-powerup` | Outputs safe; diagnostics, I/O, signatures, and feedback not qualified |
| `safe-latched` | Safe outputs active after demand, power restoration, or loss of qualification |
| `stopping` | A monitored SS1/SS2 or equivalent stop is executing; timeout escalates |
| `demand-latched` | E-stop/guard/protective demand remains recorded |
| `fault-latched` | Discrepancy, EDM, feedback, watchdog, network, or internal fault |
| `reset-eligible` | Inputs coherent, demand cleared, standstill/guard/EDM conditions true; outputs still safe |
| `ready` | A monitored local reset edge was accepted; motion has not started |
| `running` | Normal controller may operate while safety functions remain active |

KerfDesk mirrors this state; it does not drive its transitions. Releasing E-stop or closing the guard goes at most toward `reset-eligible`. Safety reset goes to `ready`. A separate normal Cycle Start goes to running. CNC recovery evidence remains an additional gate after safety readiness.

### 11.6 Safety networks are qualified endpoints over an untrusted channel

CIP Safety, PROFIsafe, and FSoE use “black channel” principles: the ordinary network can delay, duplicate, reorder, corrupt, or misroute packets, while certified safety endpoints detect faults using mechanisms such as sequence/session identifiers, safety addresses, CRC/redundant data, timestamps/data age, watchdogs, and reaction-time limits.

- [ODVA CIP Safety](https://www.odva.org/technology-standards/distinct-cip-services/cip-safety/) describes the CIP safety service and endpoint model.
- [PROFIsafe system description](https://www.profibus.com/fileadmin/media/downloadsection/technical_description_%26_books/PROFsafe_System_Description_engl_2016_Update.pdf) describes F-addresses, monitoring, CRC, watchdog, and substitute safe-value behavior.
- [EtherCAT implementation guide](https://www.ethercat.org/download/documents/ETG2200_V3i2i2_G_R_EtherCATImplementationGuide.pdf) describes FSoE integration concepts.

An Ethernet adapter, Modbus register, or WebSocket does not become safety-rated because it transports a `ready` bit. KerfDesk's mirror should therefore carry source identity, safety logic signature, boot epoch, sequence, source/receive time, quality, active demands, and faults. Missing/stale/untrusted becomes `unknown`, never retained green readiness.

```ts
type SafetySnapshot = {
  sourceId: string;
  logicSignature: string | null;
  bootEpoch: string;
  sequence: number;
  sourceTime: number;
  receivedTime: number;
  quality: 'valid' | 'stale' | 'faulted' | 'untrusted' | 'unavailable';
  state:
    | 'unknown'
    | 'stopping'
    | 'safe-latched'
    | 'fault-latched'
    | 'reset-eligible'
    | 'ready'
    | 'running';
  estopDemand: boolean | null;
  guardDemand: boolean | null;
  guardLocked: boolean | null;
  stoActive: boolean | null;
  safeStandstill: boolean | null;
  edmHealthy: boolean | null;
  resetRequired: boolean | null;
  faults: ReadonlyArray<string>;
};
```

The complete safety reaction time still includes sensor, input, safety task, network timeout, output, drive, and mechanical stopping. Protocol diagnostics do not replace cybersecurity against a malicious authorized endpoint.

## 12. Orthogonal application state model

### 12.1 Proposed state domains

```ts
type MachineState = {
  transport: TransportState;
  controllerSession: ControllerSessionState;
  operatingMode: OperatingModeState;
  safety: SafetyMirrorState;
  program: ProgramExecutionState;
  motion: MotionState;
  process: ProcessState;
  reference: ReferenceConfidenceState;
  incident: MachineIncident | null;
  recovery: RecoveryTransaction | null;
  authority: OperatorAuthorityState;
};
```

Do not derive all of these from one enum. Valid combinations matter: `program=held`, `motion=stationary`, `spindle=running`, `safety=normal`, `reference=confirmed` is a normal CNC feed hold. `program=aborted`, `motion=unknown`, `spindle=unknown`, `safety=E-stop-active`, `reference=invalid` is an incident. Both would currently look loosely like “paused/not streaming.”

### 12.2 Readiness is a proof result

```ts
type ReadinessDecision = {
  allowed: boolean;
  operation: 'jog' | 'home' | 'probe' | 'start-job' | 'resume-hold' | 'recovery-step';
  evidenceUsed: ReadonlyArray<Evidence<unknown>>;
  blockers: ReadonlyArray<{
    code: string;
    message: string;
    owner: 'operator' | 'safety-system' | 'controller' | 'drive' | 'application';
    nextAction?: string;
  }>;
};
```

Every hazardous command asks for readiness specific to that operation. `Idle` is not a universal ready bit. Home, jog, probe, automatic Start, hold-resume, and crash recovery need different prerequisites.

### 12.3 Incidents are append-only evidence

```ts
type MachineIncident = {
  id: string;
  kind:
    | 'emergency-stop'
    | 'guard-demand'
    | 'hard-limit'
    | 'drive-fault'
    | 'controller-reset'
    | 'transport-loss'
    | 'host-stall'
    | 'process-fault'
    | 'unknown-stop';
  openedAt: number;
  snapshots: ReadonlyArray<MachineEvidenceSnapshot>;
  causeState: 'active' | 'reported-cleared' | 'verified-cleared' | 'unknown';
  safetyResetState: 'required' | 'complete' | 'not-applicable' | 'unknown';
  referenceImpact: 'preserved' | 'must-verify' | 'invalid';
  processImpact: 'known-safe' | 'must-verify' | 'unknown';
  playbookId: string;
  resolution?: IncidentResolution;
};
```

Reconnect adds a snapshot. It does not delete the incident.

## 13. Recovery workflow for an interrupted CNC cut

### 13.1 Safe default

Immediately after interruption:

1. If there is danger, use the machine's physical protective measures/E-stop; do not rely on the app.
2. Treat axes, spindle, tool engagement, reference, queued commands, and workholding as unknown unless independently proved.
3. Do not automatically send Home, `$X`, `~`, spindle start, or checkpoint G-code.
4. If the cutter is embedded, use a machine-specific manual extraction/isolation procedure.
5. Open a recovery transaction; never return directly to `ready` because transport reconnects.

### 13.2 Evidence reconciliation

The recovery planner must establish:

- exact controller and boot session;
- stop cause and safety-chain state;
- actual axis/reference confidence and whether steppers/servos could have moved;
- active work coordinate system, offsets, units, plane, distance/feed modes, tool length compensation, and rotation/scaling;
- installed tool identity, stick-out/length, condition, and clamp;
- workpiece and fixture integrity;
- spindle stopped/ready feedback and commanded direction/speed contract;
- material engagement and clearance geometry;
- program checkpoint semantics and already-cut stock state;
- extraction/coolant/vacuum clamp readiness;
- guard/access status and operator authorization.

Unknown evidence blocks automatic continuation. The planner may offer a safe diagnostic/manual playbook instead.

### 13.3 Re-entry transaction

If continuation is permitted by the machine-specific risk assessment:

```text
abort old execution and clear stale command authority
  -> restore/re-prove reference without crossing the embedded-tool hazard
  -> reconstruct modal and process state explicitly
  -> select a geometric recovery point, not an acknowledged line number
  -> generate retract/clearance/approach geometry against remaining stock
  -> move to safe clearance with spindle off when mechanically valid
  -> command spindle in correct direction and speed
  -> verify spindle ready/at-speed within timeout
  -> perform lead-in/ramp/helical re-entry appropriate to the cut
  -> require deliberate Cycle Start
  -> monitor the resumed segment with an immutable recovery record
```

The exact order of “move clear” and “start spindle” depends on whether the cutter is embedded and what motion is possible without rotation. This is why a universal resume algorithm is unsafe.

## 14. Cybersecurity and remote operation

Safety and security are different disciplines, but a security compromise can cause a hazardous command. The EU Machinery Regulation now explicitly requires resistance to accidental/intentional corruption of safety-relevant connection/software and evidence of intervention. ISO 13849-1 notes that security can affect safety functions even though it does not specify security controls.

[CISA's industrial remote-access guidance](https://www.cisa.gov/sites/default/files/2023-01/RP_Managing_Remote_Access_S508NC.pdf) recommends defense in depth, controlled intermediaries rather than direct exposure, strong access control, restricted scope, monitoring, and logging. For KerfDesk:

- never expose controller or machine safety endpoints directly to the internet;
- separate view/diagnose/upload permissions from jog/start/reset permissions;
- require local machine mode and presence for hazardous commands;
- make remote command expiry/idempotency explicit so delayed packets cannot execute later;
- bind commands to controller boot/session and machine identity;
- cryptographically protect update artifacts and safety-relevant configuration;
- keep an append-only audit of remote actions and parameter changes;
- design loss of cloud/app/network as a conservative normal-control failure, while the independent safety chain remains effective;
- threat-model malicious G-code, postprocessors, macros, plugins, and imported machine profiles.

Remote E-stop over an ordinary network is not a replacement for the physical safety function. A remote normal Stop can be useful, but its latency/failure semantics must be honest.

## 15. Prioritized product actions

### P0 — before claiming credible CNC recovery

1. Disable generic CNC checkpoint resume. Keep checkpoints as forensic/recovery evidence only.
2. Remove the generic **Recover controller** action from safety notices; replace it with typed incident playbooks.
3. Stop clearing hazard-related incidents on reconnect or banner dismissal.
4. Separate `feed hold`, `stream pause`, `abort/reset`, and `physical E-stop required` in UI and telemetry.
5. Require a distinct spindle-ready proof and clearance/re-entry plan before any recovery engagement move.
6. Make `$X Unlock`, Home, and Cycle Start separate gates; never offer one as a universal recovery action.
7. Make per-axis reference confidence and CNC work-Z production blockers, with explicit invalidation causes; one global homing boolean and an advisory work-Z warning are insufficient.
8. Replace generic Resume/Continue with stop-cause-specific actions and a preview of the next physical consequence.

### P1 — state and machine-integration foundation

1. Add orthogonal operating-mode, safety-mirror, incident, process, reference, and recovery states.
2. Add source/freshness/quality metadata to all physical evidence.
3. Create controller-session fingerprints and bind all commands/checkpoints/incidents to a boot epoch.
4. Add machine-profile stop contracts and mechanical consequence fields for sleep, torque loss, spindle coast, Z gravity, guard access, and brake behavior.
5. Create cause-specific recovery playbooks for E-stop, guard, hard limit, soft limit, probe protection, drive fault, controller reboot, disconnect, and host stall.
6. Add a read-only safety-system diagnostic integration boundary; fail normal Start conservatively on stale/unknown evidence.

### P2 — industrial operator model

1. Implement explicit Manual/Jog, MDI, Automatic, and Recovery workspaces; mirror physical Setup/Service selection rather than simulating it.
2. Add localized start/reset/authority policy and prevent conflicting command stations.
3. Model spindle-at-speed, zero-speed, extraction/coolant/vacuum clamp, tool, and workholding transactions.
4. Add alarm shelving/root-cause grouping without permitting readiness latches to disappear.
5. Add immutable event, acknowledgement, bypass, parameter-change, and recovery logs.
6. Design remote access as a separately permissioned/readiness-gated subsystem.

### P3 — validation and safety lifecycle support

1. Add machine risk-assessment and safety-function specification artifacts tied to machine profile versions.
2. Store PL/SIL calculation references, safety schematics, component versions, safety parameters, checksums, and validation reports outside normal operator-editable settings.
3. Support commissioning/periodic-test checklists without representing the desktop result as the safety system's own proof.
4. Track safety configuration changes and force revalidation when relevant hardware, firmware, parameters, stopping times, mechanics, or software change.

## 16. Verification strategy

### 16.1 Tests KerfDesk can own

- state-model property tests: no reset/reconnect/dismiss transition reaches Start-ready without required evidence;
- driver contract tests for exact Pause/Stop/Abort semantics;
- stale/future/duplicate command rejection across controller boot epochs;
- typed incident/playbook tests for every alarm and disconnect class;
- power/app/network loss simulations showing no automatic command replay;
- recovery property tests proving spindle start and at-speed evidence precede engagement;
- geometric tests for retract, clearance, approach, remaining-stock avoidance, and lead-in;
- UI tests that distinguish operational Stop from physical E-stop;
- authorization tests for local/remote/manual/setup/automatic commands;
- audit-log immutability and configuration-version tests.

### 16.2 Machine validation needs physical testing

- measured stopping time under worst credible load/speed/tool and degraded supply conditions;
- E-stop at every operating mode and phase;
- guard opening, guard locking, run-down, and reset-location tests;
- channel faults, shorts, open circuits, welded contactors, discrepancy and diagnostic reaction;
- encoder/sensor mismatch and safe-drive monitoring violation;
- STO/SS1/SOS/SLS/SBC behavior including gravity axis and brake faults;
- power brownout/restoration, controller reboot, PC crash, USB/network loss/reconnection;
- stuck keyboard/mouse/touch input and conflicting command stations;
- safety-fieldbus interruption and stale diagnostic mirrors;
- bypass activation, indication, expiry, and audit;
- restart prevention after every protective event;
- periodic proof-test procedure and traceable results.

The acceptance criterion is the specified safety function and response time, not “the UI showed red.”

## 17. Verification of the live snapshot

This tranche made no product-code changes. It inspected the linked `audit-current-main` source and verified the existing behavior with:

```text
pnpm test --
  src/core/controllers/grbl/status-parser.test.ts
  src/ui/laser/CheckpointResumeBanner.test.tsx
  src/ui/laser/SafetyNoticeBanner.test.tsx
  src/ui/laser/start-job-readiness.test.ts
  src/ui/state/laser-store.test.ts
  src/ui/state/laser-store-pause-safety.test.ts
  src/ui/state/laser-store-sleep-recovery.test.ts
  src/ui/state/laser-store-active-job-command-guard.test.ts
```

Result: **8 test files, 97 tests passed**.

The dossier itself passed:

```text
pnpm exec prettier --check \
  docs/audits/2026-07-13-cnc-safety-architecture-operator-modes-and-human-factors.md
```

The tests confirm the implementation described here; they do not convert normal-control behavior into a safety-rated function or invalidate the audit findings.

## 18. Research gaps for later tranches

- Obtain and study the full applicable Type-C clauses for the exact target router configurations and intended materials.
- Build a jurisdiction matrix for EU, US/Canada, China, UK, Australia/New Zealand, and other intended markets.
- Audit industrial CNC operator manuals in greater depth for restart-from-block, block search, retract/reposition, and operator-responsibility language.
- Study fire/extraction safety for wood dust, composites, laser, and unattended operation as separate hazard domains.
- Study spindle/tool ejection, tooling standards, balance, overspeed, and guard containment.
- Study vacuum-clamp loss, workpiece ejection, and safety-related pressure/vacuum monitoring.
- Study robot/automatic loading integration and cell-level E-stop zoning.
- Model safe tool-change architecture, including spindle orientation, tool-release prevention, carousel access, and retention confirmation.
- Develop formal hazard-to-safety-function traceability and validation templates for a reference KerfDesk machine.

## 19. Source map

### Standards and regulators

- [ISO 12100:2010 — risk assessment and risk reduction](https://www.iso.org/standard/51528.html)
- [ISO 13849-1:2023 — safety-related control systems](https://www.iso.org/standard/73481.html)
- [ISO 13849-2:2012 — validation](https://www.iso.org/standard/53640.html)
- [IEC 62061:2021+A1:2024+A2:2026 — functional safety of machinery control systems](https://webstore.iec.ch/en/publication/112847)
- [IEC 60204-1:2016+A1:2021 — electrical equipment of machines](https://webstore.iec.ch/en/publication/71256)
- [IEC 61800-5-2:2016 — safety-related power-drive systems](https://webstore.iec.ch/en/publication/24556)
- [ISO 13850:2015 — emergency stop](https://www.iso.org/standard/59970.html)
- [ISO 14118:2017 — prevention of unexpected startup](https://www.iso.org/standard/66460.html)
- [ISO 14119:2024 — guard interlocking](https://www.iso.org/standard/75942.html)
- [ISO 14120:2015 — guards](https://www.iso.org/standard/59545.html)
- [ISO 13855:2024 — safeguard positioning and approach](https://www.iso.org/standard/80590.html)
- [ISO 13857:2019 — safety distances against reach](https://www.iso.org/standard/69569.html)
- [ISO 13854:2017 — minimum gaps against crushing](https://www.iso.org/standard/66459.html)
- [ISO 19085-1:2021 — woodworking machinery common requirements](https://www.iso.org/standard/77655.html)
- [ISO 19085-3:2021 — CNC boring/routing machines](https://www.iso.org/standard/75953.html)
- [ISO 16090-1:2022 — metal machining centres and milling machines](https://www.iso.org/standard/81558.html)
- [EU Machinery Regulation 2023/1230](https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX%3A32023R1230)
- [NFPA 79:2024](https://link.nfpa.org/all-publications/79/2024)
- [OSHA machine guarding and hazardous-energy guidance](https://www.osha.gov/etools/machine-guarding/introduction/safety-considerations)

### Manufacturer and security implementation evidence

- [Siemens SINAMICS S120 Safety Integrated Function Manual](https://cache.industry.siemens.com/dl/files/722/109781722/att_1031219/v1/S120_safety_fct_man_0620_en-US.pdf)
- [Rockwell GuardLogix safety reference manual](https://literature.rockwellautomation.com/idc/groups/literature/documents/rm/1756-rm012_-en-p.pdf)
- [Pilz emergency-stop reset/restart FAQ](https://www.pilz.com/en-US/support/faq/standards/articles/180045)
- [ODVA CIP Safety](https://www.odva.org/technology-standards/distinct-cip-services/cip-safety/)
- [PROFIsafe system description](https://www.profibus.com/fileadmin/media/downloadsection/technical_description_%26_books/PROFsafe_System_Description_engl_2016_Update.pdf)
- [EtherCAT/FSoE implementation guide](https://www.ethercat.org/download/documents/ETG2200_V3i2i2_G_R_EtherCATImplementationGuide.pdf)
- [CISA ICS recommended practices](https://www.cisa.gov/resources-tools/resources/ics-recommended-practices)
- [CISA configuring and managing ICS remote access](https://www.cisa.gov/sites/default/files/2023-01/RP_Managing_Remote_Access_S508NC.pdf)

### CNC operator and recovery manuals

- [Haas mill operation](https://www.haascnc.com/service/online-operator-s-manuals/mill-operator-s-manual/mill---operation.html)
- [Haas control pendant](https://www.haascnc.com/service/online-operator-s-manuals/mill-operator-s-manual/mill---control-pendant.html)
- [Haas Run/Setup door rules](https://www.haascnc.com/service/troubleshooting-and-how-to/reference-documents/door-rules---run---setup-mode.html)
- [Haas tool-changer recovery](https://www.haascnc.com/service/troubleshooting-and-how-to/how-to/mill---side-mount-tool-changer---manual-recovery.html)
- [LinuxCNC user introduction](https://linuxcnc.org/docs/html/user/user-intro.html)
- [LinuxCNC AXIS manual](https://linuxcnc.org/docs/html/gui/axis.html)
- [SINUMERIK ONE milling operating manual](https://support.industry.siemens.com/cs/attachments/109925735/ONE_milling_op_man_0124_en-US.pdf)
- [HEIDENHAIN TNC7 setup and program run](https://content.heidenhain.de/doku/tnc_guide/pdf_files/TNC7_basic/81762x-20/einrichten/1410286-22.pdf)
- [PathPilot interface](https://knowledgebase.tormach.com/pcnc-1100/pathpilot-interface-pcnc-1100)
- [MASSO Jump to Line](https://docs.masso.com.au/getting-started-guides/machining-with-masso/resuming-program-or-jump-to-line)
- [MASSO safe work practices](https://docs.masso.com.au/quick-start-guides/safe-work-practices)

## Final design rule

> KerfDesk may orchestrate normal CNC work and recovery only from explicit, fresh evidence. The machine's independent safety system must remain capable of preventing or terminating hazardous behavior when KerfDesk, Windows, the network, the controller session, the operator workflow, or the imported job is wrong.
