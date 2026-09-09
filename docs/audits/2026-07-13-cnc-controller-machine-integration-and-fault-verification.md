> **Historical research archive: 11–13 July 2026.** Published on 6 September 2026.
> Findings, scores, source claims and proposed changes below describe their recorded
> baseline; they have not been revalidated and are not current product or qualification
> evidence. Unimplemented proposals are not adopted policy. The current
> [Frame-first contract](../../PROJECT.md) governs application behaviour. See the
> [archive index](2026-09-06-preserved-audits.md) and [source manifest](2026-09-06-preserved-audits-source-manifest.json).

# CNC Controller, Machine Integration, and Fault Verification Deep Research

**Date:** 2026-07-13
**Status:** Research dossier, tranche 4
**Companions:** `2026-07-13-cnc-software-deep-research-foundation.md`, `2026-07-13-cnc-cam-motion-machine-architecture.md`, `2026-07-13-cnc-controller-post-and-process-workflows.md`
**Product mapped:** KerfDesk / LaserForge 2.0 `audit-current-main`

## Executive verdict

The controller-machine boundary is where a plausible desktop application either becomes a credible CNC system or begins making claims it cannot prove.

KerfDesk already handles several host-side hazards carefully: byte-counted GRBL streaming, stale-ack protection, post-job Idle settling, controller reboot detection, alarm/reset cleanup, fresh-Idle gating at manual tool-change holds, probe timeouts, settings readiness, and explicit loss of work-Z confidence. These are meaningful strengths.

The next architectural ceiling is physical evidence. The current application can know that it sent `M3 S12000`, but not that the spindle is rotating clockwise, at 12,000 RPM, or fault-free. It can know that a probe sequence returned `ok`, but it does not persist which probe was connected, its calibration, the measured contact, repeatability, active WCS/tool, or offset readback. It can prompt for a tool change, but it cannot prove the named cutter was loaded, measured, clamped, or compensated. Its simulator deliberately acknowledges commands immediately and applies target positions at command admission, so it cannot test the exact admission-versus-execution uncertainty that makes restart hard.

This tranche also found a separate **P0 in the normal multi-tool path**. After a tool-change pause, the operator is told to touch the new bit to the stock top and set Z0. Continue then emits spindle start and dwell before the next group establishes safe Z. The cutter can therefore start stationary at the stock surface. This is the same engagement-state mistake as crash recovery, reached through an ordinary planned tool change.

The design rule is:

> A command is an intention. A controller status field is evidence only of what that controller defines it to mean. A physical fact requires an independent signal, a validated transaction, or an explicit operator attestation with freshness and invalidation rules.

The correct architecture is not a bag of booleans. It is a transaction engine over evidence-bearing machine state:

```text
request
  -> capability and state preflight
      -> exclusive transaction ownership
          -> safe staging motion
              -> command
                  -> wait for defined controller/physical evidence
                      -> validate measurement/result
                          -> commit new state evidence
                              -> or enter explicit fault/recovery state
```

## 1. Current KerfDesk machine-integration map

### 1.1 Existing strengths

The live source already contains good safety-oriented mechanisms:

- controller drivers separate GRBL, grblHAL, FluidNC, Marlin, Smoothieware, and Ruida transport/capability behavior;
- Start requires a fresh Idle status, no alarm, no concurrent motion/controller operation, and no active job;
- char-counted streaming prevents exceeding the configured RX window;
- untracked acknowledgements cannot be mistaken for job acknowledgements;
- `done` means all lines were acknowledged, while a later Idle/settle proves motion drained;
- a startup banner during a job is treated as an uncommanded controller reboot and terminates the stream;
- alarms wipe acknowledgement debt and invalidate origin/Z/frame evidence;
- disconnect during motion produces a safety notice instead of claiming the machine stopped;
- probing is GRBL-family-only because the response grammar is safety relevant;
- probe sequences use two-stage fast/slow touch-off and stop on GRBL probe alarms;
- a manual tool-change hold waits for its pre-change motion to drain and a fresh Idle report;
- the prior work-Z flag is invalidated when later tool-change boundaries are entered;
- tool-change comments preserve the requested bit label for the operator;
- controller `$30/$32` readiness is checked for router mode and RPM scaling.

The focused tranche-4 verification passed 13 test files and 134 tests covering these mechanisms.

### 1.2 Controller family is not a controller fingerprint

The current connection handshake waits for a line and then primarily collects `$$`. It retains:

- profile-selected controller kind;
- controller kind inferred from a welcome banner;
- a subset of numeric settings;
- timestamp of the last settings read;
- status, WCO, overrides, transcript, and homing/work-zero flags.

It does not create an immutable controller-session identity or automatically bind a job to:

- exact firmware version/build;
- build options and reported RX/planner sizes;
- axes/kinematics;
- enabled plugins/macros;
- FluidNC YAML or grblHAL configuration hash;
- active modal state and WCS/TLO/offset snapshot;
- physical I/O capability and polarity;
- boot epoch versus reconnect to the same still-running controller.

GRBL's `$I`, `$G`, and `$#` expose build information, modal state, work offsets, G92, TLO, and probe data. Its `[OPT:...]` report can include compile options and buffer sizes. Source: [GRBL interface](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md) and [GRBL commands](https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md).

A future fingerprint should be explicit:

```ts
type ControllerSessionFingerprint = {
  sessionId: string;
  bootEpoch: number;
  transport: 'usb-serial' | 'uart' | 'tcp' | 'websocket' | 'sd-card';
  endpointIdentity: string;
  selectedDriver: string;
  detectedFamily: string;
  welcomeBanner: string;
  firmwareVersion: string;
  firmwareBuild: string;
  buildOptions: ReadonlyArray<string>;
  axes: ReadonlyArray<string>;
  plannerBlocks?: number;
  rxBufferBytes?: number;
  configurationHash?: string;
  pluginManifestHash?: string;
  machineProfileRevision: string;
  settingsHash: string;
  capturedAt: string;
};
```

Any startup banner creates a new boot epoch. A transport reconnect without a banner does not prove a new or continuous controller session; it starts in `unreconciled` until status, parser state, offsets, and execution ownership are resolved.

The fingerprint payload differs by family:

- **GRBL 1.1:** welcome banner, `$I` `[VER:]` and `[OPT:<codes>,<planner>,<RX>]`, `$$`, `$N`, `$G`, `$#`, and a full status report.
- **grblHAL:** extended build report including `[VER:]`, `[OPT:]`, `[AXS:]`, `[NEWOPT:]`, `[DRIVER:]`, plugin names/versions, compatibility level, full settings, axes/homed mask, probes/toolsetter, tool-change mode, parking, safety inputs, spindle/VFD, and local-file capabilities.
- **FluidNC:** version/git/MCU, machine name, configuration filename, `$Config/Dump`, startup configuration, axes/kinematics, planner blocks, control/probe/toolsetter inputs, parking, spindles/speed maps/delays, ATC or `m6_macro`, channels, storage, and current job state.

FluidNC's runtime configuration is authoritative; its source explicitly notes that a short compile-option report cannot describe the machine. Sources: [FluidNC build report](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Report.cpp) and [machine configuration](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Machine/MachineConfig.cpp).

### 1.3 Current GRBL-family drivers overgeneralize

`grblHalDriver` is currently a shallow clone of `grblDriver` with a new label/kind. `fluidncDriver` is the same clone with settings marked read-only and the GRBL setup panel disabled. Consequently all three inherit the same CNC, probing, realtime, WCS, homing, and override booleans.

That describes wire compatibility, not machine capability. A grblHAL build may have tool-change macros, extended cycles, multiple spindles, spindle-at-speed, auxiliary ports, SD execution, plugins, or none of them. FluidNC behavior depends on firmware version and YAML machine configuration. Legacy GRBL safety-door parking, M7, line-number reporting, and several status fields are compile-time options.

Replace broad booleans with a negotiated capability manifest containing provenance:

```ts
type CapabilityEvidence<T> = {
  value: T;
  source: 'firmware-report' | 'configuration' | 'machine-profile' | 'operator' | 'inferred';
  confidence: 'confirmed' | 'assumed' | 'unknown' | 'contradicted';
  sessionId?: string;
  observedAt?: string;
  invalidatedBy: ReadonlyArray<string>;
};
```

Family differences that affect execution authorization:

| Area | GRBL 1.1 | grblHAL | FluidNC |
|---|---|---|---|
| Language | fixed narrow GRBL set | configurable superset with cycles, modes, M6, macros and I/O depending on build/plugins | GRBL base plus runtime-configured tools/I/O/macros; current source still omits some grblHAL/LinuxCNC features |
| Axes/kinematics | upstream XYZ | driver/build dependent | YAML/kinematics dependent |
| Tool change | T tracked, M6 unsupported | disabled/ignored/manual/semiautomatic/ATC modes | configured C++ changer, `m6_macro`, manual changer, or simple tool selection |
| Probe | one input | probe/toolsetter/secondary possible | probe/toolsetter pins and protection behavior |
| Spindle proof | command only | driver/plugin may supply VFD/encoder/at-speed | spindle-class dependent |
| Local jobs | none | SD/littlefs plugin dependent | SD/local flash and nested macro jobs |
| Network ownership | one upstream serial stream | plugin dependent | USB, WebSocket, Telnet, HTTP and local job channels |

Sources: [GRBL parser](https://github.com/gnea/grbl/blob/master/grbl/gcode.c), [grblHAL supported commands](https://github.com/grblHAL/core), [FluidNC G-code](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/GCode.cpp), and [FluidNC protocol](https://github.com/bdring/FluidNC/blob/main/FluidNC/src/Protocol.cpp).

### 1.4 Status is incomplete and controller-defined

The current GRBL status parser records machine state, XYZ machine/work position, feed, spindle value, WCO, selected input pins, and overrides. It deliberately does not parse buffer availability or executing line number. It also treats the `FS` spindle value as a number without distinguishing commanded RPM from encoder-measured RPM.

For legacy GRBL, `FS` is commanded spindle state, not an independent tachometer proof. Therefore:

```text
status.spindle == 12000
does not imply
physical spindle at 12000 RPM
```

Likewise, GRBL's position is controller step-count state, not measured carriage position. It cannot prove the absence of missed steps.

The state model must distinguish:

- commanded versus measured position;
- commanded versus measured spindle speed;
- parser modal state versus executor state;
- host-sent, controller-accepted, planner-buffered, motion-started, and motion-completed;
- controller door/probe/limit input from safety-rated hardware state.

`Bf:<planner free>,<RX free>` is a queue snapshot; an arc and a modal-only line consume different resources. `Ln:` is the line number attached to a currently executing planner block when enabled, not a durable last-completed line. These fields should be parsed for diagnostics, but never converted into checkpoint completion.

## 2. Execution truth and synchronization

### 2.1 Five progress frontiers

For each semantic operation or NC block, retain separate frontiers:

```text
hostPrepared
hostWritten
controllerAccepted
controllerExecutionFenced
physicalEvidenceCommitted
```

- `hostWritten` means the OS/transport accepted bytes.
- GRBL `ok` advances `controllerAccepted`; it does not mean physical completion.
- a target-defined synchronization fence followed by Idle may establish `controllerExecutionFenced` for all prior commands;
- a spindle-at-speed input, probe result, tool-changed handshake, or operator inspection may establish physical evidence.

Do not synthesize the final three from a single acknowledgement counter.

For legacy GRBL, the official isolated fence is a dwell such as `G4 P0.01`: the dwell synchronizes the planner before its acknowledgement. It is valid only when the sender has stopped issuing later blocks, sends the fence alone, and waits for its `ok`. If later commands were already queued, the boundary is contaminated. The fence still proves nothing about actual spindle speed, workholding, or lost steps. Source: [GRBL synchronization guidance](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md#synchronization).

### 2.2 Buffer reports help flow control, not recovery truth

GRBL can optionally report planner/RX availability through `Bf:` and current executing line through `Ln:` when compiled/configured. These fields are useful for diagnostics and flow-control reconciliation. They do not by themselves create durable restart checkpoints:

- a line number may identify a block currently executing but not its material-contact progress;
- controller power loss erases the planner;
- position may be lost even when the file cursor is known;
- tool, stock, fixture, offset, and auxiliary state remain external facts.

### 2.3 Reconnect reconciliation

After transport loss:

1. stop new writes;
2. preserve the last transcript, job hash, and all progress frontiers;
3. reconnect without assuming the controller stopped;
4. identify whether the controller rebooted;
5. query status, parser modes, offsets, build/configuration identity, and job source;
6. determine whether the same program is still running locally/on SD/network;
7. require an execution fence before claiming a stable boundary;
8. classify the outcome:

   - same live session, still running;
   - same live session, safely held;
   - same live session, idle at a proven fence;
   - reset/rebooted;
   - another sender/job owns the controller;
   - unknown.

Only the third case can support automated continuation from a semantic checkpoint, and only when physical setup evidence remains valid.

Execution ownership must be a first-class field:

```ts
type ExecutionOwner =
  | 'none'
  | 'kerfdesk-host-stream'
  | 'controller-local-file'
  | 'tool-change-or-macro'
  | 'other-client'
  | 'unknown';
```

grblHAL may run SD/littlefs jobs and file-backed macros. FluidNC can run SD/local-flash jobs while USB, WebSocket, Telnet, and HTTP clients remain connected; realtime commands may arrive from another channel. KerfDesk must refuse a new host stream until ownership is proven `none`.

A physical reconnect should enter `quarantined`, not Ready. The first query should be a realtime status byte, not a newline command that could complete an ambiguous partial RX prefix left before disconnection. If the controller is Run/Hold, only allowlisted realtime status/hold/stop actions are legal. Once motion is controlled, clear ambiguous RX through the target-defined abort/reset procedure, observe the new boot epoch, and renegotiate the entire fingerprint. This reset is not automatic permission to continue; it normally invalidates position and job state.

### 2.4 Lessons from public senders

The studied senders contain useful pieces, but none supplies physical restart truth:

- UGS separates controller lifecycle, buffered communication, connection, and controller-specific parsing. Its processed-command event remains protocol completion, not physical position. Source: [UGS backend architecture](https://winder.github.io/ugs_website/dev/backend_development/).
- CNCjs appends a wait barrier and observes stable Idle after all acknowledgements, but it can be configured to ignore a parser error and its close path destroys the controller session rather than reconciling a still-running machine. Sources: [CNCjs GRBL controller](https://github.com/cncjs/cncjs/blob/fb39c0d82fa95fa399ecfe27495a720fc7f2b8c1/src/server/controllers/Grbl/GrblController.js#L978-L994) and [error path](https://github.com/cncjs/cncjs/blob/fb39c0d82fa95fa399ecfe27495a720fc7f2b8c1/src/server/controllers/Grbl/GrblController.js#L635-L671).
- bCNC has an explicit WAIT condition that requires outstanding lines to drain and controller motion state to settle, while its fake-GRBL tests immediately acknowledge and report Idle. Sources: [bCNC sender](https://github.com/vlachoudis/bCNC/blob/8bcaac0f0f7b2200353d28e64b0e8e62eb6ad0ba/bCNC/Sender.py#L717-L858) and [test fixtures](https://github.com/vlachoudis/bCNC/tree/8bcaac0f0f7b2200353d28e64b0e8e62eb6ad0ba/tests).
- gSender reconstructs modal state and stages Z/spindle/XY for operator-assisted Start From Line, but its suggested restart comes from estimated line progress and recommends overlap. It is a heuristic UX, not execution telemetry. Sources: [gSender recovery preamble](https://github.com/Sienci-Labs/gsender/blob/43f841edf89bc346163af10f6b0087d56ca9fadb/src/server/controllers/Grbl/GrblController.js#L1559-L1670), [estimated progress](https://github.com/Sienci-Labs/gsender/blob/43f841edf89bc346163af10f6b0087d56ca9fadb/src/server/lib/Sender.js#L275-L299), and [recovery UI](https://github.com/Sienci-Labs/gsender/blob/43f841edf89bc346163af10f6b0087d56ca9fadb/src/app/src/features/JobControl/StartFromLine.tsx#L142-L177).

## 3. Probe transactions

### 3.1 Work probe and tool setter are different instruments

A touch plate or work probe establishes part/fixture coordinates. A fixed tool setter measures cutter length relative to a machine reference. Conflating them causes offset errors across tool changes.

PathPilot explicitly separates probe and electronic tool setter configuration. It requires testing the input before proceeding, calibrating the setter/reference, storing a machine-coordinate setter position, and remeasuring non-repeatable collet tools after removal. Sources: [PathPilot electronic tool setter](https://knowledgebase.tormach.com/xstech/how-do-i-use-the-electronic-tool-setter), [Probe and ETS setup](https://knowledgebase.tormach.com/770mx/probe-ets-setup), and [PathPilot tools and features](https://knowledgebase.tormach.com/24r/pathpilot-tools-and-features-24r).

Required device model:

```ts
type ProbeDevice = {
  id: string;
  kind: 'work-probe' | 'touch-plate' | 'fixed-tool-setter' | 'broken-tool-sensor';
  inputChannel: string;
  activeState: 'high' | 'low';
  normallyClosed: boolean;
  debounceMs: number;
  calibrationRevision: string;
  calibrationValueMm: number;
  calibrationUncertaintyMm: number;
  repeatabilityLimitMm: number;
  machinePosition?: { x: number; y: number; z: number };
  safeApproach: ProbeApproachPolicy;
};
```

### 3.2 Complete probing transaction

```text
controller/session identified
-> machine referenced if machine-coordinate staging is needed
-> no job motion / exclusive probe transaction
-> expected tool and probe device selected
-> spindle and hazardous auxiliaries off
-> input circuit test: released and triggered states both observed
-> current WCS/TLO/modal state captured
-> approach path checked against machine, stock, and fixtures
-> rapid only to a proven clearance waypoint
-> fast probe at fixed programmed feed
-> controller reports successful contact and measured coordinates
-> backoff
-> slow repeat probe
-> repeatability/delta validated
-> calculated offset checked against plausible limits
-> offset written
-> offset and modal state read back
-> retract and restore declared final modes
-> commit evidence bound to session, tool, WCS, and calibration
```

LinuxCNC exposes successful probe coordinates and result state, and its documentation shows how tool-length measurement depends on active work offsets and TLO. Source: [LinuxCNC G38 and tool compensation](https://linuxcnc.org/docs/master/html/en/gcode/tool-compensation.html) and [G-code probing reference](https://linuxcnc.org/docs/html/gcode/g-code.html).

All studied controller implementations synchronize earlier motion and capture an actual probe result. A sender should validate `[PRB:...:1]` or the target-specific success result; `ok` alone says the probe block completed without a parser-level error, but is not a sufficient cross-controller measurement record.

### 3.3 Failure states

Probe failures must be typed:

- input already triggered before motion;
- no contact within travel;
- contact outside the expected window;
- coarse/slow results disagree;
- input opens/closes intermittently;
- controller alarm/reset;
- transport timeout while motion may continue;
- soft/hard limit;
- configured plate/setter calibration missing or stale;
- computed offset implausible;
- readback mismatch;
- probe/clip not removed after completion.

Timeout is not a normal failure response: the machine may still be moving. The transaction enters `motion-state-unknown` and exposes Stop/E-stop guidance.

### 3.4 Local probing gaps

KerfDesk's current Z/corner builder is stronger than a one-shot touch: it uses fast seek, backoff, slow retouch, thickness/radius compensation, and an explicit final `G90`. The runner recognizes error, alarm, and timeout.

However:

- `zProbePresent` is only a boolean, not a calibrated instrument;
- the runner accepts arbitrary prepared lines and marks work Z known after any all-`ok` sequence;
- the pure runner permits a null status snapshot, although the current button requires Idle;
- spindle-off state is not a transaction precondition;
- no released/triggered input test is required before motion;
- input release is not verified after either backoff;
- it does not persist `[PRB:...]`, contact coordinates, repeatability, or readback;
- a successful sequence commits only `workZZeroKnown: true`, without tool/WCS/probe/calibration provenance;
- corner-probe lateral and absolute positioning is not verified against fixture/no-go swept volumes;
- the timeout path warns that motion may continue but does not own a deterministic controller abort/reconciliation transaction;
- Z, X, and Y offsets are written during individual legs rather than staged, so a later failure can leave a partially modified WCS;
- failure between the `G91` and final `G90` lines can leave the controller in incremental distance mode;
- the command sequence changes persistent work offsets but does not capture/read back the exact active WCS contract.

The present feature should be described as a GRBL touch-plate convenience workflow, not measurement traceability or tool-setter support.

### 3.5 Fixed tool setter is a different instrument

A work probe locates stock or a fixture. A fixed tool setter measures the loaded tool against a calibrated machine-coordinate reference. Its transaction needs:

```text
machine reference trusted
-> exact tool/holder identity known
-> fixed setter calibration current
-> spindle stopped
-> machine-coordinate safe approach
-> input released and circuit tested
-> coarse contact, retract, release proof, slow contact
-> measured gauge length staged
-> plausibility and repeatability checks
-> TLO applied/read back
-> tool record and controller state committed atomically
```

Do not implement this by relabelling the current touch-plate button. The profile needs a setter position/envelope, protected approach path, trigger calibration, overtravel policy, and measurement uncertainty. MASSO's public workflow illustrates the distinct fixed-location/tool-length role. Source: [MASSO tool setter operation](https://docs.masso.com.au/wiring-and-setup/touch-plate/how-tool-setter-works).

### 3.6 Broken-tool checks must not destroy the last good offset

A post-operation broken-tool check compares a new setter measurement with a qualified baseline. It is a diagnostic transaction, not automatically a replacement measurement. Detect at least:

- missing contact or severe shortening;
- unexpected length increase, which may indicate chips or a false trigger;
- repeatability outside tolerance;
- tool identity mismatch;
- setter/calibration change since the baseline.

On failure, preserve the prior qualified offset, mark the tool and interrupted operation suspect, and require inspection. Tormach documents a practical setter-based breakage check; Renishaw describes tool-setting and broken-tool detection as related but separately governed measurement functions. Sources: [Tormach tool breakage detection](https://knowledgebase.tormach.com/770m/tool-breakage-detection) and [Renishaw tool-setting software](https://www.renishaw.com/en/tool-setting-software--6251).

## 4. Tool identity, length, and manual change

### 4.1 A tool is an assembly

The current `CncTool` records ID, name, kind, diameter, and optional tip angle. Professional execution needs:

- cutter geometry and material/coating;
- flute count and cutting length;
- holder/collet identity and dimensions;
- stickout/gauge length;
- tool number, controller offset, and magazine pocket;
- maximum RPM and process limits;
- measurement revision and uncertainty;
- life/usage/broken state;
- physical identity method: operator, barcode/RFID, pocket, or probe.

### 4.2 Manual tool-change transaction

```text
post-defined semantic boundary
-> stop feeding before boundary
-> retract and park fully executed
-> controller Idle execution fence
-> spindle command off
-> spindle stopped evidence or conservative wait
-> operator makes spindle safe
-> requested tool identity displayed
-> physical tool replaced and clamped
-> identity confirmed
-> tool length measured or work Z explicitly re-established
-> offset/readback validated
-> probe/keys removed and enclosure restored
-> spindle re-enabled and at-speed proven
-> next section released
```

LinuxCNC's manual tool-change component uses explicit `tool-change`/`tool-changed` request-acknowledge signals. Its documentation notes that this basic flow is most useful with presettable tools; if every tool needs touch-off, split programs may be more appropriate. Sources: [HAL manual tool change](https://linuxcnc.org/docs/html/man/man1/hal_manualtoolchange.1.html) and [HAL examples](https://www.linuxcnc.org/docs/stable/html/hal/hal-examples.html).

### 4.3 Local manual-change gap

KerfDesk's sender-managed `M0` interception correctly prevents the `M0` from entering GRBL's planner and waits for pre-change retract/park to drain. It invalidates work Z on later boundary transitions and tells the operator to re-zero.

But Continue is currently gated only by drained/fresh Idle—not by:

- `workZZeroKnown` re-established after the change;
- tool identity confirmation;
- measurement/offset readback;
- spindle-safe or tool-clamped proof;
- probe/key removal;
- the named tool's physical presence.

There is also an edge case: when the initial stream reaches the first tool-change hold synchronously because every pre-`M0` line fits the RX window, the transition-specific work-Z invalidation in `advanceStream` is bypassed. The initial Start path sets the hold and label but does not itself clear work-Z evidence.

The existing focused test explicitly demonstrates Continue after fresh Idle without re-zero. That proves current behavior, not safe completion of the requested transaction.

More seriously, the emitted order is:

```text
G0 Z<safe>
M5
G0 X<park> Y<park>
; operator loads tool and re-zeros Z on stock top
M0                 ; intercepted by KerfDesk
M3 S<rpm>
G4 P<spinup>
G0 Z<safe>         ; emitted later because head.z was invalidated
```

Fresh job start correctly retracts before `M3`. Planned post-tool-change continuation does not. If the operator followed the prompt exactly, the new cutter may be touching or slightly engaged when the spindle starts and dwells. Merely requiring `workZZeroKnown` would not fix the order; the transaction also needs explicit `toolClear` evidence before spindle start.

This assumption exists in other public software and should be understood precisely. FluidNC's optional `atc_manual` class saves the pre-`M6` XYZ, retracts, changes and probes the tool, applies `G43.1`, returns to saved XY and saved Z with the spindle off, and only then issues `M3`. gSender's current standard and flexible re-zero wizards similarly return XY/Z before restoring the spindle. These flows depend on a post contract that every planned `M6` is located at a clear pose; they are not safe templates for arbitrary restart. Sources: [FluidNC optional manual ATC transaction](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/ToolChangers/atc_manual.cpp#L52-L150), [opt-in configuration](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/example_configs/4x_2209_atc_class.yaml#L151-L172), [gSender standard wizard](https://github.com/Sienci-Labs/gsender/blob/43f841edf89bc346163af10f6b0087d56ca9fadb/src/app/src/wizards/manualToolchange.tsx#L126-L132), and [flexible wizard](https://github.com/Sienci-Labs/gsender/blob/43f841edf89bc346163af10f6b0087d56ca9fadb/src/app/src/wizards/semiautoToolchange.tsx#L211-L217).

### 4.4 Work zero is currently advisory

For a fresh CNC Start, missing work Z is a warning rather than a blocker. The application says it cannot prove controller state, but allowing Start converts unknown Z into an operator-risk decision. A professional mode should require one of:

- session-bound work-Z evidence from manual zero/probe;
- verified persistent WCS/TLO readback;
- explicit advanced override recorded in the job log.

## 5. Automatic tool changer transaction

ATC support is not `M6` text support. It is a controller/PLC state machine.

LinuxCNC separates `T` preparation from `M6` change through `tool-prepare/tool-prepared` and `tool-change/tool-changed` handshakes. It exposes selected tool, pocket, and current tool state to external logic. Sources: [LinuxCNC tool I/O](https://linuxcnc.org/docs/master/html/en/gcode/tool-compensation.html), [IOCONTROL](https://www.linuxcnc.org/docs/2.8/html/man/man1/io.1.html), and [LinuxCNC code notes](https://linuxcnc.org/docs/html/code/code-notes.html).

Typical ATC transaction:

```text
requested tool/pocket validated
-> magazine prepares requested pocket
-> prepare-complete proof
-> current operation fully fenced
-> safe tool-change pose reached
-> spindle stopped and oriented
-> spindle orientation locked/braked
-> air/hydraulic pressure valid
-> current tool presence identified
-> arm/carousel at expected state
-> drawbar unclamp command
-> unclamp proof
-> exchange motion
-> drawbar clamp command
-> clamp proof
-> arm/carousel retracted and locked
-> requested tool/pocket presence proof
-> tool length/broken-tool check
-> controller tool table/current tool committed
-> tool-changed acknowledgement
```

Every step needs timeout, sensor contradiction handling, and a safe abort state. A desktop application may configure, display, log, and request the transaction. Realtime sequencing and proof belong in the controller/PLC, not React timers or USB round-trips.

The transaction also needs an explicit irreversible boundary. Before unclamp, ordinary abort can normally return to a known tool-loaded state. Once drawbar release or exchange motion begins, recovery must be phase-specific and may require manual changer recovery rather than automatic rollback. LinuxCNC's remap model exposes controller-side prolog/body/epilog logic for customized `M6`; Haas publishes a separate manual recovery procedure because interrupted changer mechanics cannot be safely reduced to “retry M6.” Sources: [LinuxCNC remapped tool change](https://linuxcnc.org/docs/stable/html/remap/remap.html#remap:remapping-tool-change) and [Haas side-mount tool-changer recovery](https://www.haascnc.com/service/troubleshooting-and-how-to/how-to/mill---side-mount-tool-changer---manual-recovery.html).

## 6. Spindle and VFD contract

### 6.1 Commanded speed is not actual speed

The minimum spindle model separates:

```ts
type SpindleEvidence = {
  command: { enabled: boolean; direction: 'cw' | 'ccw'; rpm: number };
  drive: { ready: boolean; running: boolean; faultCode?: string };
  measuredRpm?: number;
  atSpeed: boolean | 'unsupported' | 'unknown';
  oriented?: boolean;
  brakeApplied?: boolean;
  source: string;
  sessionId: string;
  observedAt: string;
};
```

LinuxCNC's `spindle.N.at-speed` input blocks the first feed after spindle start/speed change until feedback is within tolerance. It may come from a VFD digital output or encoder comparison. LinuxCNC also defines explicit orient request, oriented acknowledgement, orient fault, locked, and brake state for M19. Sources: [LinuxCNC spindle control](https://linuxcnc.org/docs/html/examples/spindle.html) and [core spindle pins](https://linuxcnc.org/docs/stable/html/config/core-components.html).

### 6.2 Valid spindle-start sequence

```text
cutter engagement proven clear
-> VFD/drive ready and fault-free
-> direction/RPM command
-> running feedback
-> measured RPM within declared tolerance, or validated fallback dwell
-> required dust/coolant/vacuum ready
-> controlled cutting entry
```

If feedback exists, dwell becomes a timeout/fault bound rather than proof. If feedback does not exist, the machine profile may declare a conservative validated spin-up curve/dwell, but the UI must label the evidence as assumed.

### 6.3 GRBL-family differences

Legacy GRBL normally provides PWM/enable/direction command but no generic spindle tachometer or at-speed input. Safety-door parking and spindle/coolant restore delays are compile-time options. Source: [GRBL configuration](https://github.com/gnea/grbl/blob/master/grbl/config.h).

grblHAL can support VFDs, multiple spindles, encoder feedback, at-speed tolerance, spin-up timeout, tool-change modes, and plugin-specific behavior. These are version/driver/plugin/configuration dependent, not consequences of the word `grblHAL`. Source: [grblHAL core](https://github.com/grblHAL/core) and [changelog](https://github.com/grblHAL/core/blob/master/changelog.md).

FluidNC similarly binds actual spindles and I/O through YAML machine configuration. The correct profile must name the selected spindle implementation and configuration revision.

Current grblHAL adds a useful pattern: configured spin-up time is a delay when no feedback exists, but becomes an at-speed timeout when spindle feedback is enabled, raising a fault when speed is not reached. That distinction belongs in KerfDesk's machine contract.

FluidNC's Modbus VFD layer likewise separates commanded state from device feedback and can poll status/speed/error registers when the selected VFD implementation provides them. This is an exact spindle-class/configuration capability, not a generic FluidNC guarantee. Source: [FluidNC VFD feedback path](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/Spindles/VFDSpindle.cpp#L138-L164).

### 6.4 Spindle stop is also a transaction

`M5` acknowledgement is not proof that a high-inertia spindle is stationary. Tool release, tool touch-off, manual access, and orientation require:

```text
stop command accepted
-> running output clears
-> measured RPM reaches the declared stopped threshold
-> threshold remains stable for the configured interval
-> brake/orient state reaches its required proof
```

With no feedback, the profile can use a measured conservative coast-down delay, but must expose that as assumed evidence. A timeout or contradictory VFD state blocks tool access and ATC continuation.

## 7. Auxiliaries and discrete I/O

Model each auxiliary independently:

- flood, mist, air blast;
- dust collector;
- vacuum table or zone valves;
- coolant pressure/flow/level;
- lubrication level/pressure;
- pneumatic/hydraulic pressure;
- clamps and unclamp proof;
- enclosure/door;
- spindle/chiller/temperature;
- tool presence and breakage;
- probe selection relay.

Required fields:

```ts
type AuxiliaryChannel = {
  id: string;
  commandMode: 'gcode' | 'controller-io' | 'plc' | 'manual';
  synchronization: 'immediate' | 'planner-synchronized' | 'transactional';
  safeState: boolean;
  feedback: 'none' | 'digital' | 'analog' | 'protocol';
  requiredFor: ReadonlyArray<string>;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
  faultPolicy: 'block-start' | 'feed-hold' | 'controlled-stop' | 'external-safety-stop';
};
```

Do not map every output to “air assist.” `M7`, `M8`, `M9`, synchronized M-codes, and vendor extensions have different timing and wiring semantics.

Auxiliaries can also change collision geometry and workholding validity. A dust hood may need confirmed retraction before a tool exchange; a chuck or vacuum fixture losing clamp proof invalidates safe motion even when the axes and spindle are otherwise ready. Public controller documentation illustrates both patterns: [MASSO dust-hood sequencing](https://docs.masso.com.au/wiring-and-setup/tool-changers/mill-tool-changers-beta/dust-hood) and [MASSO chuck-clamp control](https://docs.masso.com.au/wiring-and-setup/setup-and-calibration/chuck-clamp).

The software model should distinguish three owners:

- desktop-requested and controller-synchronized normal auxiliaries;
- controller/PLC-owned realtime machine sequences;
- safety-relay/safety-PLC functions that the desktop may observe but must never own.

Loss of a process auxiliary such as coolant may request a controlled stop. Loss of safety-rated workholding or guard proof may require an independent stop path. The policy comes from the machine risk assessment, not from the M-code number.

## 8. Door, E-stop, limits, and functional safety

### 8.1 Desktop/controller safety is supervisory

KerfDesk may:

- refuse Start;
- show interlock state;
- request hold/stop;
- sequence normal recovery;
- log events and state;
- prevent known-invalid commands.

It must not be the only path for:

- emergency stop;
- guard-door removal of hazardous energy;
- spindle STO/contactors;
- brake application;
- axis drive disable;
- pneumatic/hydraulic dump;
- safety-rated speed/position monitoring.

Those functions must survive Windows hangs, app crashes, USB loss, controller firmware faults, and sender bugs.

### 8.2 Feed hold, safety door, and E-stop differ

- ordinary GRBL feed hold decelerates motion while mill spindle/coolant normally remain active;
- GRBL safety-door behavior decelerates, disables auxiliaries, optionally parks, then restores them with delays and reverses the park sequence;
- E-stop removes hazardous motion/energy according to the machine's safety design and invalidates execution/reference evidence.

GRBL's safety-door input and parking are compile-time/OEM features. They are useful machine-control behaviors but are not by themselves safety-rated. Sources: [GRBL realtime commands](https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md) and [GRBL configuration](https://github.com/gnea/grbl/blob/master/grbl/config.h).

### 8.3 Limit and homing evidence

Homing establishes controller reference only when:

- the correct switch/input exists and is healthy;
- direction, sequence, debounce, pull-off, travel, and kinematics match the machine;
- the home cycle completed without stall/slip;
- subsequent drive disable, collision, step loss, or manual motion has not invalidated it.

Soft limits depend on that reference and the configured envelope. Hard limits detect a switch event, not which commanded motion or physical collision occurred. Unlocking an alarm does not restore position confidence.

## 9. Fault model

### 9.1 Transport faults

- failure before any bytes leave the host;
- partial line/frame write;
- bytes delivered but response lost;
- duplicate/replayed data after reconnect;
- port closes while the controller continues buffered work;
- network client disconnects while an on-controller file continues;
- serial noise or invalid encoding;
- wrong baud/driver/controller family;
- second sender takes ownership.

### 9.2 Controller faults

- parser rejection after earlier blocks were accepted;
- RX overflow or sender/accounting mismatch;
- planner full/stalled;
- watchdog/reset/banner during execution;
- alarm flushes queued motion;
- safety door or hold with intermediate substate;
- hard/soft limit;
- homing failure;
- probe already triggered/no contact;
- VFD fault/not-at-speed;
- tool-change handshake timeout;
- SD/network file error;
- firmware/plugin/configuration changed between runs.

### 9.3 Physical faults

- lost steps or servo following error;
- axis stall/collision;
- slipping stock or fixture;
- cutter breakage/pull-out;
- wrong tool/holder/offset;
- spindle direction reversed or commanded RPM mismatched;
- clamp/door/pressure sensor contradiction;
- dust/coolant/vacuum failure;
- probe plate or wrench left in envelope;
- power loss with cutter engaged;
- material or skeleton shifts during interrupted work.

Each fault declares which evidence it invalidates and which actions remain legal.

## 10. Verification ladder

### L0 — pure state-machine tests

Deterministic reducers for streamer, transactions, capability negotiation, modal interpretation, and evidence invalidation. Inject every event at every transition.

The transport fixture must operate at byte boundaries, not only at whole command boundaries. It should split writes after every byte, fragment/coalesce reads, fail before a write or after any valid prefix, close after newline but before acknowledgement, deliver an old `ok` into a new connection epoch, toggle DTR/RTS, change port identity, and emit duplicate, malformed, or unterminated replies. Required invariants include:

- no later program bytes after an ambiguous failure;
- an old-epoch reply cannot settle a new-epoch command;
- a partial RX prefix cannot combine with a reconnect query or program line;
- terminal error/alarm/disconnect cannot become success through late replies.

### L1 — real target parser

- legacy GRBL `$C` check mode;
- LinuxCNC standalone `rs274`;
- exact grblHAL/FluidNC build parser or check mode;
- corrupted, conflicting, unsupported, boundary, and fuzzed programs.

This proves parser acceptance, not physical behavior.

Use exact public implementation layers where available. The grblHAL Simulator compiles the real controller core, supports fake serial/Telnet, block/step traces, and limit injection; FluidNC separates fast host unit tests from hardware fixture tests because the former do not cover the RTOS, UART, step generation, or real motion. Sources: [grblHAL Simulator scope](https://github.com/grblHAL/Simulator#what-can-you-do-with-grblhal-sim), [FluidNC fixture tests](https://github.com/bdring/FluidNC/tree/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/fixture_tests), and [FluidNC unit-test scope](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/test/UnitTests.md).

Check mode itself is a transaction:

1. require Idle and no local job/macro owner;
2. capture the pre-check fingerprint;
3. enter check mode and observe `Check`;
4. stream with strict stop-on-first-error;
5. exit check mode through the target-defined reset;
6. wait for the new banner/boot epoch;
7. renegotiate fingerprint, modes, and offsets.

Do not reuse pre-check volatile state. GRBL check mode suppresses ordinary motion, dwell, spindle, coolant, and probing, but cannot validate physical I/O. Extension platforms need extra caution: configured tool-change or macro paths may not share one universal “no side effects” guarantee.

### L2 — controller-in-loop bench

Real controller, no hazardous machine motion:

- USB/UART/TCP interruption;
- buffer saturation;
- reset/alarm/door/limit/probe inputs;
- simulated spindle/VFD feedback and faults;
- I/O polarity and timing;
- boot/configuration fingerprint capture;
- on-controller file ownership and reconnect.

The bench needs controlled USB data/power interruption, reset/DTR/RTS control, switchable probe/limit/door/E-stop/spindle-fault inputs, a step-pulse counter or encoder model, dummy VFD/relay loads, and a logic analyzer on host TX/RX plus step/dir, spindle, coolant, reset, and fault signals.

### L3 — machine air-cut

Spindle disabled or safe dummy tool where possible:

- homing and envelope;
- offsets/tool setter/probe;
- tool-change staging;
- door/hold/resume;
- soft/hard limit behavior;
- path/rapid/override conformance;
- controller versus measured motion.

### L4 — auxiliary/process proof

- spindle direction, RPM curve, at-speed, stop time, and fault;
- coolant/dust/vacuum pressure/flow;
- clamp and ATC sensors;
- thermal/continuous-run behavior;
- measured signals with timestamps or oscilloscope/logic capture.

LinuxCNC provides a strong public model for this layer: simulator configurations, writable HAL inputs, exact-output functional tests, `sampler`/`halsampler`, and separate commanded position, feedback position, following-error, limit, amplifier-fault, and spindle-at-speed signals. Sources: [LinuxCNC test framework](https://www.linuxcnc.org/docs/stable/html/code/writing-tests.html), [test tree](https://github.com/LinuxCNC/linuxcnc/tree/master/tests), [HAL tools](https://linuxcnc.org/docs/stable/html/hal/tools.html), and [motion feedback/fault pins](https://linuxcnc.org/docs/stable/html/man/man9/motion.9.html).

### L5 — sacrificial material and recovery

- representative cutting loads;
- feed hold and same-session return;
- controller/host/power loss at semantic checkpoints;
- supervised buried-cutter recovery;
- tool break/length changes;
- partial-operation restart and inspection;
- retained program/profile/transcript/video/metrology bundle.

## 11. Current simulator truth gap

KerfDesk's `grbl-sim-machine` documents deliberate simplifications:

- acknowledgements are immediate instead of blocked by planner availability;
- target position is applied when the command is admitted, not when motion finishes;
- motion is represented by a scheduled timer rather than acceleration/planner execution;
- spindle state is simplified and the status generator reports spindle zero while Idle;
- there is no coolant, probe-contact geometry, door parking, RX overflow, line execution frontier, VFD feedback, lost steps, or physical I/O.

This simulator is valuable for UI lifecycle regression. It cannot validate:

- acceptance versus execution frontiers;
- buffered-motion recovery;
- position timing;
- stationary spindle spin-up;
- planner/RX backpressure;
- physical or auxiliary safety.

Build a second, explicitly higher-fidelity firmware model rather than silently changing the fast UI fixture. Its scheduler should model:

```text
serial RX bytes
-> line buffer
-> parser acceptance/ok
-> planner blocks
-> executor blocks
-> step/servo position
-> status snapshots
```

Every queue must be independently pausable, resettable, and fault-injectable.

Property tests should cut the connection after every byte, after a complete line before `ok`, after `ok` before motion, mid-block, after all acknowledgements but before stable Idle, and during spindle start, clearance, plunge, and engagement. Cable loss must disconnect only the host transport while queued controller execution continues.

Run identity must use SHA-256 over the exact UTF-8 wire bytes, plus the post revision and complete machine/setup/controller fingerprint. The current 32-bit FNV-style identifier over application strings is useful for accidental mismatch detection but is not a safety-grade identity.

## 12. Release certification matrix

For every supported controller/machine pack, publish:

| Evidence | Required artifact |
|---|---|
| Target identity | firmware/build/plugin/configuration fingerprint |
| Post contract | post ID/version/properties and supported semantic IR |
| Parser | golden, differential, metamorphic, and fuzz results |
| Streaming | buffer, acknowledgement, reset, alarm, and reconnect traces |
| Motion | homing, limits, path, rapid, override, and measured-position results |
| Probe | wiring test, calibration, repeatability, failure and readback results |
| Spindle | command/direction/RPM/at-speed/stop/fault measurements |
| Tool change | manual/ATC transaction and every timeout/fault branch |
| Auxiliaries | output timing, feedback, and safe-state proof |
| Safety boundary | independent E-stop/guard/STO design evidence and disclaimer |
| Recovery | feed-hold, disconnect, reset, power-loss, and process re-entry tests |
| Traceability | exact job/profile/program/transcript/video/metrology bundle |

Certification is scoped. A pass for `GRBL 1.1h + manual router + no spindle feedback` does not certify grblHAL, FluidNC, an ATC, or a different VFD wiring.

Minimum release rows include normal stream/barrier/Idle; ambiguous partial write; host process kill; disconnect while the controller continues; parser error with stuffed RX; hard and soft limit; reset while idle and moving; controller brownout; lost step/following error; spindle-at-speed failure; probe and tool-change faults; unknown-engagement CNC recovery; and reconnect to the wrong controller, build, or configuration.

Record monotonic timestamps for transmit intent, write resolution, received bytes, parsed events, status snapshots, state transitions, and physical signals. Synchronize the UART/logic trace and video with a fixture-driven LED/GPIO pulse. A green UI screenshot is not certification.

## 13. KerfDesk priorities

### P0

1. Disable automatic CNC acknowledged-line checkpoint resume, as identified in tranche 1.
2. Disable or repair normal planned multi-tool continuation: after re-zero, establish proven tool clearance before `M3/M4` and spin-up dwell.
3. Gate manual tool-change Continue on completed tool/Z/tool-clear evidence, not only fresh Idle.
4. Ensure the first synchronously-entered tool-change hold invalidates prior work-Z evidence.
5. Make CNC work-Z unknown a blocking readiness item or an explicit logged advanced override.
6. Treat probe timeout/disconnect as motion-state-unknown requiring abort/reconciliation.

### P1

1. Add controller session/boot identity and automatic `$I/$G/$#` reconciliation.
2. Keep a connected CNC controller `identified-but-unqualified` until its full fingerprint matches a machine/post pack; a family banner is not execution authorization.
3. Replace GRBL-family blanket capabilities with version/configuration-derived manifests.
4. Separate commanded and measured spindle/position state.
5. Introduce typed probe devices, calibration, result/readback, and provenance.
6. Expand the tool model to assemblies, offsets, holders, measurement, and physical identity.
7. Implement machine transactions with request/ack/timeout/fault/commit semantics.
8. Add spindle/VFD feedback capability and at-speed gate where hardware supports it.

### P2

1. Add explicit auxiliary/I/O channels and feedback policies.
2. Implement professional manual tool-change and fixed tool-setter workflows.
3. Add first-article mode and execution logging.
4. Add high-fidelity controller queue/executor simulator and fault matrix.
5. Establish controller-in-loop and machine air-cut fixtures.

### Later

1. ATC only through a controller/PLC handshake pack.
2. Safety-door parking only after exact build/configuration negotiation.
3. grblHAL/FluidNC advanced features only in versioned target packs.
4. Closed-loop/servo machines only with measured-position/following-error integration.

## 14. Verification performed for this tranche

Current-source audit covered:

```text
src/core/controllers/controller-capabilities.ts
src/core/controllers/controller-driver.ts
src/core/controllers/grbl/status-parser.ts
src/core/controllers/grbl/parse-settings.ts
src/core/controllers/grbl/probe.ts
src/core/controllers/grbl/streamer.ts
src/core/controllers/grblhal/driver.ts
src/core/controllers/fluidnc/driver.ts
src/core/devices/device-profile.ts
src/core/scene/machine.ts
src/ui/state/probe-actions.ts
src/ui/state/laser-probe-actions.ts
src/ui/state/laser-job-actions.ts
src/ui/state/laser-stream-ack.ts
src/ui/state/laser-connection-actions.ts
src/ui/state/laser-line-handler.ts
src/ui/state/laser-store.ts
src/ui/laser/ProbeControls.tsx
src/ui/laser/start-job-readiness.ts
src/__fixtures__/controllers/grbl-sim-machine.ts
src/__fixtures__/controllers/grbl-simulator.ts
```

Focused verification:

```text
13 test files passed
134 tests passed
```

This proves the current implementation behaves according to its tests. The explicit simulator limitations and missing physical evidence mean it does not prove machine-level conformance.

## Final rule

Never let a convenient software state silently stand in for a physical fact:

```text
sent M3 != spindle turning
reported S != measured RPM
ok != motion complete
Idle != tool correct
M6 prompt accepted != tool clamped
probe ok != calibrated offset committed
controller position != measured axis position
door input != safety-rated guard function
```

KerfDesk should show exactly which side of each equality it knows, where that evidence came from, how fresh it is, and what event invalidates it.
