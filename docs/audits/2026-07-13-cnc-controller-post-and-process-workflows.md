> **Historical research archive: 11–13 July 2026.** Published on 6 September 2026.
> Findings, scores, source claims and proposed changes below describe their recorded
> baseline; they have not been revalidated and are not current product or qualification
> evidence. Unimplemented proposals are not adopted policy. The current
> [Frame-first contract](../../PROJECT.md) governs application behaviour. See the
> [archive index](2026-09-06-preserved-audits.md) and [source manifest](2026-09-06-preserved-audits-source-manifest.json).

# CNC Controller, Postprocessor, and Process Workflow Deep Research

**Date:** 2026-07-13
**Status:** Research dossier, tranche 3
**Companions:** `2026-07-13-cnc-software-deep-research-foundation.md`, `2026-07-13-cnc-cam-motion-machine-architecture.md`
**Product mapped:** KerfDesk / LaserForge 2.0 `audit-current-main`

## Executive verdict

The next safe architecture cannot be “generate plausible G-code and show a preview.” It must preserve a versioned semantic contract across five different truths:

```text
CAM operation intent
  -> semantic motion/process events
      -> controller-specific postprocessor
          -> exact posted NC program
              -> controller interpreter/planner
                  -> physical machine and process
```

KerfDesk currently has a deterministic and well-tested GRBL router emitter for its own generated subset. It does **not** yet have a general CNC postprocessor platform or a controller-semantic verifier. Its external-file parser is intentionally a limited geometry preview: unsupported commands are notes, not failures. That means it can omit a dwell or tool change and still render an apparently valid path. The existing re-import test proves that KerfDesk's own emitted cutting footprint survives decimal formatting; it does not prove modal, auxiliary, tool, offset, timing, or controller equivalence.

The product boundary must therefore be explicit:

- preview may be permissive and visually useful;
- validation, streaming eligibility, and restart analysis must fail closed on unsupported semantics;
- every post must declare its controller, process, and machine capabilities;
- every physical process must own its engagement and recovery state machine;
- controller acknowledgements remain flow-control evidence, never physical-completion proof.

The broadest lesson from the workflow research is that there is no universal rule such as “turn energy on only while moving.” A router or mill must establish clearance, reach spindle speed, and then enter stock in a controlled manner. Plasma normally starts the torch while stationary, proves arc transfer, waits through a pierce delay, then moves. A lathe rotates the stock and may couple feed to spindle revolutions. Indexed rotary normally separates indexing from cutting. Simultaneous five-axis motion deliberately coordinates linear and rotary joints. The portable invariant is:

> Each process must prove its own valid engagement transition before material interaction.

## 1. Current KerfDesk controller/post boundary

### 1.1 What is already strong

The current CNC path has several valuable properties:

- `emitGcode` routes CNC projects explicitly to `cncGrblStrategy` and laser projects through controller-specific output strategies (`src/io/gcode/emit-gcode.ts:64-66`).
- The router emitter establishes `G21`, `G90`, and `G94`, retracts to safe Z before initial spindle start, emits spin-up dwell, uses explicit safe-Z transitions, and stops the spindle at completion (`src/core/output/cnc-grbl-strategy.ts:78-102`).
- CNC Start is capability-gated to the GRBL family because controller dialect differences are safety relevant. Marlin and Smoothieware interpret `G4 P` in milliseconds rather than GRBL's seconds (`src/core/controllers/controller-capabilities.ts:60-66`).
- Multi-tool output stops the spindle, parks, pauses at a sender-managed `M0`, and then emits a new spindle start/dwell section (`src/core/output/cnc-grbl-strategy.ts:143-165`).
- Emitted text passes CNC-specific preflight, and deterministic/golden-like tests cover important output invariants.
- Exports contain application/build/emitter provenance plus the assumed GRBL `$30` spindle scale and `$32=0` router mode.
- Controller drivers already isolate realtime commands, status grammars, probing support, homing, WCS support, overrides, transport type, and a dialect-specific motion-settle command.

These are good foundations. They are a controlled GRBL-router implementation, not evidence of generic CNC coverage.

### 1.2 The current file parser is preview-only

`parseGcodeProgram` documents its own scope: XY-plane GRBL-like `G0/G1/G2/G3`, `G20/G21`, `G90/G91`, `G17`, selected spindle/coolant words, and program end. Its modal state contains only motion, units, absolute/incremental position, XYZ, and ended state (`src/io/gcode/parse-gcode-program.ts:42-49`).

Important omissions include:

- active WCS and coordinate transforms;
- G92 offsets;
- tool identity and tool-length compensation;
- cutter-radius compensation;
- arc-center mode `G90.1/G91.1`;
- feed modes `G93/G95`;
- exact-stop/blend modes;
- canned cycles;
- macros, variables, subroutines, and remaps;
- probe semantics;
- synchronized I/O;
- spindle-at-speed, coolant, clamp, or tool-change transactions;
- rotary axes and kinematics.

The parser rejects `G18/G19` arcs, but most other unimplemented G/M commands are counted as notes and execution continues (`src/io/gcode/parse-gcode-program.ts:199-205`). The test deliberately accepts `G4 P2` and `M6 T2` while noting them as unsupported (`src/io/gcode/parse-gcode-program.test.ts:114-118`).

Concrete failure modes are more serious than an omitted label:

- `G53 G0 X...` can ignore `G53` and preview the target in work rather than machine coordinates;
- `G54-G59`, G92, and tool-length offsets can be omitted while subsequent XYZ motion is drawn from a fabricated coordinate state;
- `G41/G42` can be omitted, changing the cutter-center path;
- a `G81/G83` block can be marked unsupported while its XYZ words still execute under the previously active motion mode, drawing motion that is not the commanded drill cycle;
- macros or subprograms can be skipped while parsing continues after their unknown side effects;
- spindle/coolant state does not determine whether a geometric move is classified as cutting;
- duplicate words, conflicting modal commands, and unused words are not rejected with target-firmware rigor.

That behavior is reasonable for a limited geometric viewer if the limitation is prominent. It is unsafe if the result is described as any of the following:

- posted-program semantic equivalence;
- controller compatibility;
- safe-to-stream validation;
- resume-state reconstruction;
- proof that tool, spindle, dwell, WCS, or offsets are correct.

### 1.3 Re-import “parity” is narrower than its name

The `.nc re-import parity` test emits one KerfDesk pocket, reparses it, and compares the removal-grid footprint and deepest depth (`src/io/gcode/gcode-reimport-parity.test.ts:63-101`). This usefully catches coordinate-formatting or path-loss regressions within the current subset.

It does not compare:

- modal state before every block;
- spindle/coolant/tool events;
- dwell duration;
- WCS/TLO/cutter-comp state;
- rapid versus high-feed semantics;
- controller alarm behavior;
- exact sequencing barriers;
- physical timing or achieved motion.

Rename this concept internally to **geometric re-import footprint parity**. Reserve **post conformance** for a stronger event-by-event proof.

### 1.4 Provenance needs a CNC-specific post identity

The current `EMITTER_REVISION` is `adr-039-raster-gap-rapid-v1`, a laser-oriented revision string (`src/io/gcode/gcode-metadata.ts:23`). CNC exports do receive machine-specific assumption lines, but the artifact does not identify a distinct CNC post package, controller-version range, property set, machine definition revision, or semantic IR hash.

A posted CNC bundle should record at least:

```ts
type PostedProgramIdentity = {
  programHash: string;
  semanticIrHash: string;
  setupRevision: string;
  machineDefinitionRevision: string;
  controllerFamily: string;
  controllerVersionRange: string;
  postprocessorId: string;
  postprocessorRevision: string;
  postEngineRevision: string;
  postProperties: Readonly<Record<string, string | number | boolean>>;
  units: 'mm' | 'inch';
  wcs: string;
  toolAssemblyRevisions: ReadonlyArray<string>;
};
```

### 1.5 One hard-coded post currently covers three different targets

All CNC projects route directly to `cncGrblStrategy`; the ordinary output-strategy selector is bypassed. GRBL 1.1, grblHAL, and FluidNC therefore share the same emitted CNC contract because all three advertise `cncJobs: true`.

That is safe only for a deliberately tiny common subset. The products are not semantically identical:

- legacy GRBL has a fixed, narrow parser: no ordinary `M6`, `G41/G42`, normal `G43 H...`, canned cycles, macros, or subroutines;
- grblHAL can expose cycles, lathe/feed modes, extended offsets, tool change, macros, subprograms, and I/O depending on build, driver, plugins, and configuration;
- FluidNC is GRBL-sender compatible, but its YAML machine configuration, spindle/tool types, and versioned features remain part of the execution contract.

Create versioned target packs such as `grbl-1.1-mill-v1`, `grblhal-<minimum-build>-mill-v1`, and `fluidnc-<minimum-version>-mill-v1`. They may share code, but not an undeclared certification.

## 2. The postprocessor is a semantic compiler

Autodesk's post API is a useful mature reference because it receives operation sections and events such as rapid, linear, circular, cycle, spindle, dwell, work plane, tool, and machine commands. It also exposes machine configuration, circular/helical capabilities, tolerances, rotary limits, inverse-time calculation, and a revisioned property system. Sources: [post configuration](https://cam.autodesk.com/posts/reference/configuration.html), [entry functions](https://cam.autodesk.com/posts/reference/entry_functions.html), and [PostProcessor class](https://cam.autodesk.com/posts/reference/classPostProcessor.html).

The post is therefore not a text template. It is the last compiler stage that decides how machining intent is represented for one controller/machine contract.

### 2.1 Required intermediate events

A useful minimum IR should retain process meaning:

```ts
type ManufacturingEvent =
  | { kind: 'section-start'; operationId: string; setupId: string }
  | { kind: 'select-wcs'; wcs: string }
  | { kind: 'select-tool'; toolAssemblyId: string; toolNumber: number }
  | { kind: 'apply-tool-length'; offset: number }
  | { kind: 'spindle'; direction: 'cw' | 'ccw'; rpm: number }
  | { kind: 'await-spindle-at-speed'; timeoutMs: number }
  | { kind: 'auxiliary'; name: string; state: boolean; synchronization: 'immediate' | 'with-motion' }
  | { kind: 'rapid-intent'; target: Pose; clearanceClass: string }
  | { kind: 'feed'; target: Pose; feed: FeedContract; engagement: Engagement }
  | { kind: 'arc'; plane: Plane; end: Pose; center: Vec3; toleranceMm: number }
  | { kind: 'cycle'; cycle: CycleIntent }
  | { kind: 'probe'; probe: ProbeIntent }
  | { kind: 'checkpoint'; recoveryClass: RecoveryClass }
  | { kind: 'section-end'; operationId: string };
```

This lets a post choose among controller representations without losing the safety intent. For example, a drill cycle may become `G83` on one control and explicit peck motion on GRBL. A rapid intent may become `G0` or a high-feed `G1` on a machine whose `G0` is dog-leg. Cutter compensation may be expanded in CAM or emitted as `G41/G42`, but that choice must be declared and verified.

### 2.2 Modal state is part of correctness

The NIST RS274/NGC model and LinuxCNC make clear that NC programs are modal state machines, not independent lines. Sources: [NIST RS274/NGC interpreter](https://www.nist.gov/publications/nist-rs274ngs-interpreter-version-3) and [LinuxCNC G-code reference](https://linuxcnc.org/docs/html/gcode.html).

NIST also demonstrates that execution order inside a block is semantic rather than textual. Feed mode/rate, spindle speed, tool selection/change, spindle/coolant, dwell, plane, units, compensation, coordinate system, path/distance/cycle modes, motion, and program stops have a defined processing order. A verifier cannot reproduce that with a regex that applies words in whichever order they appear.

At minimum, a verifier must track:

| State group | Examples | Failure if reconstructed incorrectly |
|---|---|---|
| Motion | G0/G1/G2/G3/cycles | wrong path or cycle continuation |
| Plane | G17/G18/G19 | arcs/cycles interpreted in wrong plane |
| Units | G20/G21 | 25.4x scale error |
| Distance | G90/G91 | absolute move becomes incremental or vice versa |
| Arc-center | G90.1/G91.1 | wrong arc center |
| Feed mode | G93/G94/G95 | inverse-time, units/minute, or units/revolution confusion |
| WCS | G54-G59 and extensions | wrong part datum |
| Temporary offsets | G52/G92 variants | hidden coordinate shift |
| Tool length | G43/G43.1/G49 | wrong physical Z |
| Cutter comp | G40/G41/G42 | wrong side/offset and unsafe restart |
| Path control | G61/G64 | exact stop versus blended corners |
| Spindle | M3/M4/M5 + S | direction/speed mismatch |
| Coolant/auxiliary | M7/M8/M9 and extensions | missing process support |
| Tool | T/M6/H/D | wrong cutter or compensation |
| Program control | M0/M1/M2/M30/subroutines | wrong execution boundary |

GRBL supports a smaller but still meaningful subset: `G54-G59`, all three arc planes, `G93/G94`, `G43.1/G49`, and parser-state reporting through `$G`. Source: [GRBL supported G-code and parser state](https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md).

KerfDesk's current CNC emitter avoids many of these modes by expanding cycles and using a simple absolute metric program. That is a strength of a **restricted generated dialect**. It must not be confused with permission to accept arbitrary imported CNC programs.

The generated safety block should state every assumption on which that restricted dialect relies. In addition to `G21 G90 G94`, a future setup-owned post should explicitly establish the selected WCS and, when consistent with the target contract, `G17`, `G40`, `G49`, and `G80`. It should also end with controller-appropriate coolant/spindle shutdown and program end. Do not blindly force G54: the setup must own WCS selection.

Arcs require post-format validation. KerfDesk formats CNC coordinates to three decimals, while its preview parser allows radius disagreement up to 0.127 mm. GRBL's firmware applies a much tighter conditional radius test. After formatting, recompute the target's arc validity from emitted numbers; increase precision, split, linearize within the declared chordal budget, or refuse output.

### 2.3 A capability declaration, not a controller name

One “GRBL compatible” label is insufficient. A post/machine pack should declare:

- supported controller family and tested firmware versions;
- axis set and kinematic topology;
- units and coordinate-system support;
- arc planes, center format, radius limits, full-circle behavior, and tolerance;
- feed modes and override behavior;
- exact-stop/blending behavior;
- rapid interpolation behavior;
- tool-change ownership: none, sender/manual, fixed setter, or ATC;
- spindle command, direction, speed range, at-speed proof, and dwell fallback;
- coolant, dust, vacuum, mist, air, clamp, and door semantics;
- probe grammar and failure behavior;
- canned cycles, cutter compensation, TLO, macros, and subroutines;
- line length, numeric precision, program naming, checksum, and storage rules;
- synchronization fences and what an acknowledgement proves;
- restartable dialect and recovery boundaries;
- unsupported commands that must fail posting or streaming.

### 2.4 Four different verifications

Do not collapse these into one green check:

1. **CAM verification:** intended cutter path against stock and fixture.
2. **Post conformance:** posted events are semantically equivalent to the IR within declared tolerances.
3. **Controller conformance:** target firmware accepts and executes the declared dialect as modeled.
4. **Physical prove-out:** the real machine, offsets, tools, fixtures, auxiliaries, and process behave correctly.

## 3. Post conformance test architecture

### 3.1 Golden event programs

Every post needs small, reviewable fixtures for:

- startup and shutdown;
- each supported plane and arc form;
- full circles and helices;
- units and absolute/incremental transitions;
- WCS selection and temporary offsets;
- tool length and tool change;
- spindle/coolant/auxiliary sequencing;
- drill/peck/tap cycles or their expansion;
- exact-stop/blending modes;
- probing and failure paths;
- rotary index or multi-axis movement where supported;
- optional stop, program stop, and program end;
- recovery checkpoints.

Golden text is necessary but not sufficient. It catches output drift, not semantic equivalence.

### 3.2 Independent semantic parse-back

Parse the exact posted file with a target-dialect interpreter that is independent from the emitter. Compare canonical events:

```text
semantic IR
  -> post
      -> exact NC text
          -> independent target parser
              -> canonical executed-event trace
                  -> semantic/tolerance comparison
```

Unknown or unsupported state is fatal for conformance. A separate permissive preview parser may still show partial geometry, but it must produce `previewOnly: true` and enumerate lost semantics.

### 3.3 Differential and metamorphic tests

Useful test families include:

- compare the post's parse-back with LinuxCNC, GRBL source behavior, or an approved controller simulator;
- convert mm to inches and prove the physical path remains invariant;
- translate WCS while keeping machine-space motion equivalent;
- split/merge collinear feed blocks without changing the canonical path;
- toggle modal re-emission without changing semantics;
- linearize an arc within a declared tolerance and compare swept volume;
- perturb decimal precision around controller resolution and alarm thresholds;
- inject resets, alarms, communication loss, and full planner buffers at every synchronization boundary;
- prove that unsupported G/M codes, macros, planes, or cycles fail closed.

For legacy GRBL, stream every corpus file through the real firmware's `$C` check mode. It invokes the target parser without motion, dwell, spindle, or coolant. For LinuxCNC dialects, use the standalone `rs274` interpreter as a differential oracle. grblHAL and FluidNC require exact versioned builds or their native parser/check harness; a generic GRBL emulator cannot certify extensions.

### 3.4 Hardware fixtures

For each supported machine pack, retain:

- controller/firmware version;
- machine configuration and parameter dump;
- exact program hash;
- serial/network transcript;
- measured spindle/auxiliary signals;
- measured motion or high-speed video where relevant;
- expected alarms and limits;
- sacrificial-air-cut and stock-cut results.

No software test can prove clamp placement, tool identity, lost-step absence, spindle direction, or actual stock engagement.

## 4. Complete open-router workflow

An open router normally relies on a visible operator, manual clamps, manual dust handling, and sometimes a manually switched router. The workflow must expose those responsibilities rather than pretending the controller owns them.

### 4.1 CAM and job preparation

1. Define stock size/thickness, XY datum, Z-zero convention, safe clearance, fixture/keep-out geometry, and start/park position.
2. Order operations deliberately: rough before finish, internal features before outer cutout, engraving before release, and cutout last with tabs or other workholding continuity.
3. Validate tool diameter, cutting length, stickout, stepdown, stepover, entry capability, feed, plunge, and RPM.
4. Simulate cutting, rapids, plunges, retracts, and linking.
5. Select the exact machine post. Manual-tool machines often require one file per tool; a combined file needs a defined sender-managed tool-change transaction.
6. Freeze source project, exact posted file, post revision, and setup sheet together.

Vectric's workflow and job sheet explicitly record stock, datum, home, rapid clearance, toolpath sequence, tools, feeds, plunges, speeds, and time. Sources: [Vectric workflow](https://docs.vectric.com/docs/V12.5/VCarvePro/ENU/Help/page/user-guide/index.html), [save toolpaths](https://docs.vectric.com/docs/V12.5/VCarvePro/ENU/Help/form/Save%20Toolpaths/index.html), and [job sheet](https://docs.vectric.com/docs/V12.5/Aspire/ENU/Help/form/create-job-sheet/index.html).

### 4.2 Physical setup

- inspect cutter, collet, spindle/router, drive system, cables, switches, and dust hose;
- secure stock and verify its orientation;
- verify clamps, screws, probe plates, and hoses are outside cutting and traverse paths;
- test dust extraction/vacuum where used;
- clear the envelope and keep E-stop/feed hold accessible.

Fixture geometry in CAM must agree with reality. Vectric keep-out zones can represent clamps/screws, but safe Z must separately clear obstacles. Source: [Vectric keep-out zones](https://docs.vectric.com/docs/V12.5/VCarvePro/ENU/Help/form/KeepOutZonesForm/index.html).

### 4.3 Reference, WCS, and tool evidence

1. Connect and identify the controller/firmware.
2. Home or initialize if reference switches exist.
3. Load the correct tool.
4. Establish XY and Z work zero using the same convention as CAM.
5. Test the probe circuit before enabling probe motion.
6. Remove the touch plate and clip from the envelope.
7. Measure tool length at the defined point if a fixed setter is used.

Carbide's BitSetter model separates work Z-zero from relative tool-length measurement. An unmeasured physical tool change can leave the old length active and cause a deep plunge. Sources: [BitSetter workflow](https://carbide3d.com/blog/bitsetter-changes-carbide-motion/) and [unexpected Z plunges](https://carbide3d.com/blog/unexpected-z-axis-plunges/).

Hard invariant:

> Any physical tool change invalidates active tool-length evidence until measurement or explicit offset confirmation succeeds.

### 4.4 Loaded-program proof and first entry

1. Load the exact posted file.
2. Confirm hash/revision, post, units, tools, speeds, feeds, bounds, and min/max Z.
3. Preview the loaded program, not only the pre-post CAM path.
4. Compare program origin/dimensions with the physical setup.
5. Run an elevated outline/frame.
6. Confirm clearance from clamps, screws, stock, hoses, and travel limits.
7. Acknowledge spindle/VFD, dust, and vacuum state.
8. Start with reduced feed/rapid where supported and supervise the first entry and first full-depth cut.

gSender exposes a visualizer, program statistics, soft-limit warnings, probing checks, and an Outline operation. Source: [gSender workflow](https://resources.sienci.com/view/gs-using-gsender/?print=print).

### 4.5 Router Start gate

```text
posted program verified
+ controller idle and compatible
+ reference confidence
+ WCS confidence
+ tool identity/length confidence
+ stock and fixture confirmation
+ probe removed
+ dust/vacuum state acknowledged
+ spindle ownership/arming known
+ clearance-frame result
= Start enabled
```

### 4.6 Manual tool-change transaction

```text
controlled stop at safe location
-> spindle disabled and physically safe
-> tool replaced and secured
-> tool identity confirmed
-> length measured or Z re-established
-> offset applied and verified
-> spindle re-enabled
-> resume at a complete post-defined section
```

KerfDesk's existing `M0` sender interception is the beginning of this transaction. It does not yet prove physical tool identity, new length, or offset application.

## 5. Complete enclosed-mill workflow

An enclosed mill may own spindle, coolant, ATC, probes, tool offsets, door interlocks, lubrication, chip handling, and richer recovery state. It needs a different capability profile and UI.

### 5.1 Digital planning

The setup binds machine, target model, stock, fixtures, WCS, tools, ordered operations, post, properties, and output program. Fusion's persistent NC Program groups operations/setups with a retained post and can produce a setup sheet. Sources: [Fusion setup](https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-CREATE-SETUP), [NC Program](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-NC-PROGRAM-OVERVIEW.htm), and [setup sheet](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-REF-NC-PROGRAM-SETUP-SHEET.htm).

Typical order:

1. establish datum surfaces and rough stock;
2. rough major volumes;
3. rest rough;
4. semi-finish;
5. drill/tap/ream while workholding is strong;
6. finish critical geometry;
7. deburr/chamfer;
8. probe/inspect;
9. release or part-off last.

### 5.2 Startup and reference

1. Release E-stop and clear alarms.
2. Verify the automatic reference path is clear.
3. Close/validate enclosure and interlocks.
4. Reference axes; use the machine-prescribed safe order.
5. Warm the spindle when required.
6. Verify lubrication, air, coolant, chip evacuation, probe, and tool changer.

PathPilot requires referencing after power-up, E-stop, collision, stall, or lost position and tells operators to reference Z first for clearance. Source: [PathPilot tools and features](https://knowledgebase.tormach.com/24r/pathpilot-tools-and-features-24r).

### 5.3 Fixture, WCS, tools, and offsets

- install/qualify vise, fixture, soft jaws, and stock;
- clean contact surfaces and prove clamping/support;
- establish the intended G54/G55/etc.;
- load tool assemblies into the correct pockets;
- verify holder, stickout, cutting length, diameter, and identity;
- measure tool length and diameter/wear offsets;
- compare controller values with the setup sheet.

Haas separates work offsets and tool offsets; PathPilot likewise requires replacement tools to be remeasured and the correct length offset applied. Sources: [Haas mill part setup](https://www.haascnc.com/service/online-operator-s-manuals/mill-operator-s-manual/mill---part-setup.html) and [PathPilot offset workflow](https://knowledgebase.tormach.com/24r/pathpilot-tools-and-features-24r).

### 5.4 First-article prove-out

1. Parse/load and review controller alarms.
2. Run controller graphics without machine motion.
3. Verify program, WCS, tool, H/D offsets, stock, and fixture.
4. Use an elevated/dry run only when the process permits.
5. Reduce rapid override.
6. Single-block through tool change, WCS/TLO activation, spindle/coolant, first approach, and first entry.
7. Use feed/spindle override conservatively.
8. Stop at planned inspection points.
9. Inspect the first critical feature.
10. Release automatic production only after the first article passes.

Haas exposes separate Single Block, Optional Stop, feed/spindle/rapid overrides, Feed Hold, Reset, Graphics, and E-stop controls. Feed Hold and E-stop have different effects. Haas Safe Run may reduce consequences but explicitly does not prevent all crashes. Sources: [Haas mill operation](https://www.haascnc.com/service/online-operator-s-manuals/mill-operator-s-manual/mill---operation.html) and [control pendant](https://www.haascnc.com/service/online-operator-s-manuals/mill-operator-s-manual/mill---control-pendant.html).

### 5.5 Production and completion evidence

Keep visible and loggable:

- program/operation and remaining time;
- axis and spindle load;
- tool life and breakage state;
- coolant, chip, air, and enclosure state;
- active WCS/T/H/D and override values;
- pauses, optional stops, alarms, and recovery actions;
- inspection results and wear-offset changes;
- produced/scrapped count and actual cycle time.

At program end, stop process auxiliaries, reach the machine-defined safe state, inspect the part, record tool/offset changes and alarms, and bind the result to the exact job bundle.

## 6. Interruption and recovery UX

Never label every interruption “Resume.” Use distinct actions:

- **Continue Feed Hold** — same live controller/planner state, no invalidating intervention.
- **Return to Interrupted Position** — controller-owned jog-away workflow with retained state.
- **Resume After Tool Change** — complete tool transaction and post-defined continuation.
- **Begin Supervised Recovery** — position/tool/engagement evidence is suspect.
- **Restart Operation with Lead-In** — a new CAM/post recovery path.
- **Abandon Job** — no safe or economical recovery.

Mature controls reveal the assumptions:

- Haas Run-Stop-Jog-Continue retains the interrupted position, permits controlled jog-away, forbids tool/offset changes, and stages the return before continuing. This is same-session continuation, not power-loss recovery. Source: [Haas operation](https://www.haascnc.com/service/online-operator-s-manuals/mill-operator-s-manual/mill---operation.html).
- PathPilot exposes no-preparation, linear lead-in, and Z-plunge lead-in modes instead of pretending a line number is enough. Source: [PathPilot start-line modes](https://knowledgebase.tormach.com/1300pl/pathpilot-tools-and-features-1300pl).
- MASSO rehomes after lost position, processes prior state, stages axes with separate operator confirmations, moves Z last into the interrupted position, and disallows Jump to Line inside cutter compensation. Source: [MASSO Jump to Line](https://docs.masso.com.au/getting-started-guides/machining-with-masso/resuming-program-or-jump-to-line).
- LinuxCNC UIs warn about subroutines, tool state, spindle state, and run-from-line assumptions. Sources: [AXIS](https://linuxcnc.org/docs/html/gui/axis.html) and [QtDragon](https://linuxcnc.org/docs/stable/html/gui/qtdragon.html).

### 6.1 Tool engagement is first-class state

```ts
type ToolEngagementEvidence =
  | { state: 'clear'; source: 'controller-sequence' | 'operator-inspection'; at: string }
  | { state: 'engaged'; source: 'controller-sequence' | 'operator-inspection'; at: string }
  | { state: 'unknown'; reason: string };
```

If spindle power was lost while engagement is `unknown` or `engaged`, automatic spindle start and automatic retract are both blocked. A supervised mechanical-clearance procedure must establish `clear` before software stages a recovery approach.

### 6.2 Operation-level recovery classes

Every operation should declare one:

- `native-feedhold-resumable`;
- `operation-boundary-resumable`;
- `process-reentry-required`;
- `supervised-recovery-only`;
- `non-resumable`.

Examples:

| Operation | Minimum safe restart boundary |
|---|---|
| Drill/peck | complete hole boundary |
| Profile | generated lead-in with overlap on known side |
| Pocket | pass/depth/island boundary with remaining-stock state |
| Adaptive roughing | regenerated remaining-stock toolpath |
| Finish contour | complete stroke/loop boundary |
| Probe | replay complete probe transaction |
| Tool change | replay complete tool/offset transaction |
| Threading | complete synchronized pass/cycle group |
| Plasma contour | new scrap-side pierce/lead-in |

## 7. Process-specific architectures

### 7.1 Router and three-axis mill

```text
referenced
-> work/fixture/tool evidence valid
-> clearance established
-> spindle command
-> at-speed proof or validated dwell
-> auxiliaries ready
-> controlled approach and entry
-> cutting
-> retract clear
-> stop or tool-change transaction
```

Key invariants:

- no spindle start with an uncertain buried cutter;
- no XY rapid without clearance evidence;
- spindle direction/RPM, tool, WCS, fixture, and stock match the operation;
- lost execution truth requires new re-entry, not the last acknowledged line.

### 7.2 Lathe

```text
chuck/workholding proven
-> turret station indexed and clamped
-> tool geometry/wear/tip orientation active
-> work Z face and spindle-center X valid
-> safe X/Z approach
-> G97 fixed RPM or bounded G96 CSS
-> spindle at speed
-> G94/G95 turning or G33/G76 synchronization
-> OD/ID-specific retract
-> safe turret-index pose
```

Lathe-only state includes:

- diameter versus radius mode (`G7/G8`);
- cylindrical stock, chuck/jaw state, tailstock/subspindle, and stock projection;
- turret station separately from offset/edge identity;
- tool geometry, nose radius, and tip orientation;
- CSS with a valid spindle center and maximum RPM;
- feed per revolution with spindle feedback;
- spindle-indexed threading/tapping transactions.

LinuxCNC documents diameter/radius mode, feed modes, CSS, synchronized motion, and threading cycles. It requires spindle feedback for coordinated motion and CSS. Sources: [LinuxCNC G-code](https://www.linuxcnc.org/docs/html/gcode/g-code.html) and [spindle control](https://linuxcnc.org/docs/html/examples/spindle.html).

Hard boundaries:

- accepting X/Z/M3 syntax is not lathe support;
- never restart midway through a `G33` synchronized pass or inside a `G76` cycle;
- after loss of state, restart a generated pass/cycle group with verified chuck, tool, modes, offsets, RPM cap, and safe OD/ID approach.

### 7.3 Plasma

```text
material recipe loaded
-> safe traverse
-> pierce point
-> initial height sense
-> pierce/transfer height
-> torch on
-> Arc OK with timeout/retry
-> pierce dwell
-> optional puddle jump
-> cut height and lead-in
-> cut velocity reached
-> THC/anti-dive enabled
-> contour cut
-> torch off
-> safe-height retract
```

Plasma-only state includes:

- kerf, amperage, gas/cut mode, consumables, pierce height/delay, cut height/feed, voltage, and puddle-jump recipe;
- Arc OK/transfer proof and start failure handling;
- THC as a feedback loop, not a fixed Z offset;
- low-velocity/void anti-dive;
- torch breakaway and tip-up/collision state;
- synchronized versus immediate output events;
- scrap-side knowledge for recovery lead-ins.

Stationary torch-on is normally intentional for piercing. QtPlasmaC exposes a detailed process state machine, cut recovery, paused motion, Arc OK, pierce timing, THC, and anti-dive. Sources: [QtPlasmaC](https://www.linuxcnc.org/docs/stable/html/plasma/qtplasmac.html), [PLASMAC component](https://linuxcnc.org/docs/html/man/man9/plasmac.9.html), and [Hypertherm THC explanation](https://www.hypertherm.com/resources/more-resources/articles/torch-height-control-for-plasma-cutting/).

Hard boundaries:

- accepting M3/M5 and XY motion is not plasma support;
- recovery is by contour/process segment, not raw line;
- a new pierce/lead-in belongs in scrap and rejoins with defined overlap;
- cutter compensation, subroutines, lost scrap-side topology, or shifted skeleton may make automatic recovery impossible.

### 7.4 Indexed rotary: 3+1 and 3+2

```text
linear operation complete
-> machine-aware retract
-> cancel prior transform as required
-> unclamp rotary
-> index
-> in-position and clamp proof
-> activate transformed frame
-> explicit XYZ positioning
-> ordinary milling approach/cut
-> retract and cancel transform
```

Required state:

- rotary center/MRZP, sign, zero, angular limits, wrapping policy;
- clamp/unclamp proof;
- swept stock/fixture envelope;
- active transformed work frame;
- post/controller support for the chosen indexing representation.

Rotary motion and cutting motion are separate phases. Indexed rotary should be KerfDesk's first rotary CNC scope; simultaneous cutting must remain rejected.

### 7.5 Simultaneous four/five-axis

```text
machine topology/calibration loaded
-> tool gauge/pivot data valid
-> work frame and rotary centers valid
-> TCP/RTCP contract active
-> cutter-location position + orientation path
-> inverse kinematics and branch selection
-> singularity/limit/rewind analysis
-> full-machine collision verification
-> simultaneous cutting
-> controlled retract/reconfigure
```

A portable path is cutter-tip position plus tool-axis orientation, not merely XYZABC. Machine topology determines the joint motion. Equivalent tool orientations can map to different joint branches with different limit, cable-wrap, and collision futures. Mixed linear/angular motion requires a declared feed contract such as controller TCP handling or block-by-block `G93` inverse time.

LinuxCNC documents topology-specific forward/inverse kinematics; Autodesk exposes rotary optimization, inverse time, singularity handling, and rewind configuration. Sources: [LinuxCNC five-axis kinematics](https://linuxcnc.org/docs/stable/html/motion/5-axis-kinematics.html), [LinuxCNC KINS](https://www.linuxcnc.org/docs/html/man/man9/kins.9.html), and [Autodesk MachineConfiguration](https://cam.autodesk.com/posts/reference/classMachineConfiguration.html).

Hard boundaries:

- adding A/B/C words is not multi-axis support;
- toolpath-only preview is not machine verification;
- arbitrary restart after lost joint/TCP state is prohibited;
- a safe recovery waypoint must contain the kinematic branch, transforms, feed mode, offsets, tool state, and a revalidated retract/reconfigure path.

## 8. Product capability boundaries

### 8.1 Shared core

KerfDesk can share:

- immutable job/setup/operation graph;
- geometry, topology, stock, and fixture references;
- versioned machine, tool, process, post, and controller profiles;
- evidence-bearing state: `known`, `assumed`, `stale`, `lost` with provenance/time;
- controller transport, telemetry, alarms, event log, and functional hold/stop abstractions;
- capability negotiation and preflight framework;
- simulation interface, but not one universal simulation implementation;
- recovery intent and audit trail;
- semantic operation checkpoints.

### 8.2 Separate modules

```text
ManufacturingCore
  + MillingProcess
  + LatheProcess
  + PlasmaProcess
  + IndexedRotaryCapability
  + SimultaneousMultiAxisProcess
  + optional WaterjetProcess
```

Do not inherit process sequencing through a generic “power tool” abstraction. Share orchestration and evidence types; specialize engagement, simulation, post, controller I/O, and recovery.

### 8.3 Minimum machine classes

For the current milling/router scope:

1. open manual-router;
2. sender-controlled router/VFD;
3. enclosed manual-tool mill;
4. enclosed ATC mill.

Profiles declare spindle ownership/feedback, door/interlock, dust/coolant/vacuum, probe/tool setter, homing, tool change, override, and recovery capabilities.

## 9. Priorities for KerfDesk

### P0 — recovery truth

1. Disable automatic CNC checkpoint resume from acknowledged line counts.
2. Treat external G-code as non-restartable unless it passes a formally supported dialect verifier.
3. Add `toolEngagement` evidence and supervised-clearance recovery.
4. Separate feed-hold continuation from restart/re-entry.

### P1 — honest controller/post boundary

1. Rename or label re-import results as geometry-preview-only.
2. Make unsupported semantic words fatal for streaming/restart eligibility.
3. Introduce CNC-specific post identity/revision and exact program hash.
4. Create a semantic event IR and target capability declaration.
5. Keep the initial supported generated dialect narrow: GRBL-family, 3-axis router, metric absolute coordinates, explicit motion, manual tool change.
6. Expand the generated safety block from setup-owned WCS and declared modal assumptions.
7. Validate arcs after numeric formatting against the exact target tolerance.

### P2 — professional router workflow

1. Persist setup/WCS/fixture/tool evidence with provenance/freshness.
2. Add setup sheets and exact posted-program review.
3. Make tool change a measured transaction.
4. Add clearance outline, first-article mode, and intent-specific stop/recovery UI.
5. Log program, offsets, tools, overrides, alarms, recovery, and inspection.

### P3 — post conformance platform

1. Golden event corpus.
2. Independent dialect parse-back.
3. Semantic/tolerance comparator.
4. Controller simulators and fault injection.
5. Hardware fixtures per supported firmware/machine pack.

### Later capability order

1. Harden three-axis router/mill.
2. Add sender-controlled spindle and tool-setter transactions.
3. Add enclosed/manual-tool mill capabilities.
4. Add indexed 3+1/3+2 only after swept-volume and transform verification.
5. Build plasma and lathe as separate process products if desired.
6. Keep simultaneous multi-axis disabled until topology, kinematics, collision, post, controller, and recovery-waypoint contracts exist.

## 10. Verification performed for this tranche

Current-source audit covered:

```text
src/io/gcode/parse-gcode-program.ts
src/io/gcode/parse-gcode-program.test.ts
src/io/gcode/gcode-reimport-parity.test.ts
src/io/gcode/emit-gcode.ts
src/io/gcode/gcode-metadata.ts
src/core/output/cnc-grbl-strategy.ts
src/core/controllers/controller-capabilities.ts
src/core/controllers/controller-driver.ts
src/core/controllers/grbl/resume-program.ts
src/core/controllers/grbl/streamer.ts
src/core/devices/gcode-dialects.ts
```

Focused tests:

```text
6 test files passed
53 tests passed

parse-gcode-program
gcode-reimport-parity
cnc-grbl-strategy
resume-program
GRBL-family controller capabilities
streamer tool-change handling
```

Research sources were weighted in this order:

1. controller and machine-vendor manuals;
2. controller firmware source and official protocol documentation;
3. standards and interpreter documentation;
4. mature CAM/postprocessor APIs and source;
5. sender/operator documentation;
6. secondary material only for context.

## Final architecture rule

The safe unit is not a G-code file. It is a versioned, evidence-bearing manufacturing bundle:

```text
setup + stock + fixture + operation graph + tools + process recipe
+ machine definition + controller contract + post revision/properties
+ exact NC program + parse-back report + prove-out evidence
+ live state provenance + recovery policy + execution log
```

KerfDesk should be deliberately excellent at one declared machine/process/controller envelope before broadening. Within that envelope it can provide strong automation. Outside it, the correct behavior is an explicit capability refusal—not a plausible preview followed by hopeful execution.
