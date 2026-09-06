> **Historical research archive: 11–13 July 2026.** Published on 6 September 2026.
> Findings, scores, source claims and proposed changes below describe their recorded
> baseline; they have not been revalidated and are not current product or qualification
> evidence. Unimplemented proposals are not adopted policy. The current
> [Frame-first contract](../../PROJECT.md) governs application behaviour. See the
> [archive index](2026-09-06-preserved-audits.md) and [source manifest](2026-09-06-preserved-audits-source-manifest.json).

# CNC CAM, Motion, and Machine Architecture Deep Research

**Date:** 2026-07-13
**Status:** Research dossier, tranche 2
**Companion:** `2026-07-13-cnc-software-deep-research-foundation.md`
**Product mapped:** KerfDesk / LaserForge 2.0 `audit-current-main`

## Executive verdict

KerfDesk already has a credible deterministic CNC compiler for a useful subset of router work. It is stronger than a prototype: profiles, pockets, engraving, drilling, tabs, V-carving, relief roughing/finishing, multi-tool sections, ramp entry, climb/conventional direction, safe-Z travel, depth bounds, no-go zones, preflight, preview, and tests are real.

Its next ceiling is architectural, not a missing dropdown. The current model treats a color layer plus `CncLayerSettings` as a machining operation. Mature CAM systems instead treat machining as a revisioned plan:

```text
Machine definition + tool assemblies
  -> Setup
      -> target model
      -> initial and in-process stock
      -> fixtures and keep-outs
      -> WCS/work offset
      -> ordered operations + dependency edges
          -> geometry selection
          -> cutting data
          -> heights/depth plan
          -> strategy
          -> entry/link/exit policy
          -> generated toolpath artifact
              -> semantic motion IR
                  -> postprocessor
                      -> controller-specific NC program
                          -> parse-back verification
                              -> realtime controller
```

Three conclusions govern the design:

1. **Manufacturing intent is not G-code.** Source geometry, setup, stock, fixtures, tools, operations, generated paths, posted output, and physical execution are different artifacts with different validity rules.
2. **A host planner is predictive, not authoritative.** KerfDesk may estimate feed, time, blending, joint motion, and chip load; realtime coordinated motion remains the controller's responsibility.
3. **A desktop sender is not a functional-safety system.** It can refuse commands, sequence prerequisites, mirror status, and preserve evidence. E-stop, guards, STO/contactors/brakes, and safety-rated stopping must work independently of Windows, the app, USB, and GRBL.

## 1. Current KerfDesk CNC model

### 1.1 What is already strong

The local chain is pure and testable:

```text
Project
  -> output-scope validation
  -> compileCncJob
  -> job-origin placement
  -> travel optimization
  -> cncGrblStrategy
  -> emitted-text CNC preflight
  -> streamer/controller driver
```

The current implementation includes:

- rectangular stock with thickness and machine-space XY placement;
- a starter cutter library;
- profile outside/inside/on-path;
- offset and raster pockets;
- shallow engraving;
- V-carving with optional clearance tool;
- explicit peck-drilling motion;
- relief waterline roughing and surface finishing;
- stepdown ladders and stepover;
- profile tabs;
- optional along-path ramp entry;
- climb/conventional orientation for applicable paths;
- inner-before-outer order;
- clearing before cutout profiles;
- contiguous tool sections and manual M0 tool changes;
- spindle RPM cap, dwell, safe Z, park location;
- bed, no-go, depth, non-finite, and plunged-rapid preflight.

The second-wave focused verification passed:

```text
6 test files passed
51 tests passed

compile-cnc-job.test.ts
cnc-multi-tool.test.ts
motion-polish.test.ts
pocket-paths.test.ts
cnc-preflight.test.ts
relief-finishing-compile.test.ts
```

This proves deterministic behavior against the current specification. It does not prove stock engagement, holder/fixture collision, controller blending, spindle feedback, or physical-machine safety.

### 1.2 The architectural limitations

| Area | Current model | Ceiling |
|---|---|---|
| Setup | One project-level CNC config | No multiple setups, WCS plan, target model, fixture set, or flipped/indexed setup relation |
| Operation | CNC settings attached to a color layer | No first-class operation identity, source selector, dependency graph, generated artifact, warnings, or stale state |
| Stock | Rectangular dimensions and material key | No arbitrary stock, in-process stock, rest material, or preceding-setup stock |
| Fixtures | Device no-go zones | No 3D fixture/clamp/holder model or operation-specific keep-out routing |
| Tool | Kind, diameter, optional angle | No flute length/count, corner radius, stickout, holder, tool number/pocket, gauge length, max ramp/plunge, or revisioned cutting data |
| Entry/linking | Optional ramp angle; implicit retract/rapid/plunge | No helix, predrill, lead-in/out, keep-tool-down, stay-down, minimum retract, geometry-aware clearance, or explicit failure when entry does not fit |
| Dependencies | Heuristic clearing/profile/tool grouping | No proof that an optimized tool order preserves rest stock, predrill, setup, measurement, or other prerequisites |
| IR | `CncPass` contour/path3d/arc | Geometry is useful, but process role, stock engagement, restartability, WCS, tool offset, fixture assumptions, and semantic sections are missing |
| Post | One CNC GRBL strategy | No typed post API, controller properties, capability declaration, or posted-program parse-back comparison |
| Motion | GRBL-like host estimate | XY/time predictor, not an execution model; lacks controller path modes, full Z, joint kinematics, feedback, and process engagement |
| Machine class | `laser` or generic `cnc` | Router/mill, lathe, plasma, indexed rotary, simultaneous rotary, and 5-axis have materially different semantics |

## 2. What mature CAM architectures teach

### 2.1 FreeCAD CAM: revisioned document objects

FreeCAD's CAM `Job` owns or links model objects, stock, operations, tool controllers, setup-sheet defaults, fixture/work-offset identifiers, and postprocessor settings. Operations are parametric document objects whose generated path is a recomputable result. Sources: [Job.py](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/CAM/Path/Main/Job.py) and [operation base](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/CAM/Path/Op/Base.py).

The common operation base standardizes:

- source geometry;
- tool controller;
- start/final depth and stepdown;
- safe and clearance height;
- supported geometry types;
- coolant and start-point support;
- active/enabled state;
- validation before strategy execution.

This avoids each strategy inventing incompatible meanings for tool, height, and depth.

FreeCAD also makes entry and finishing transforms composable “dressups.” Ramp entry, lead-in/out, tabs, boundary, dogbone, array, drag-knife, and Z correction transform an existing operation path. Relevant sources include [RampEntry](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/CAM/Path/Dressup/Gui/RampEntry.py), [LeadInOut](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/CAM/Path/Dressup/Gui/LeadInOut.py), and [Tags](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/CAM/Path/Dressup/Tags.py).

Reusable lesson: keep strategy generation and entry/link/holding transformations separate, typed, and ordered.

FreeCAD's lower `Path.Command` IR is G-code-like and posts through [Processor.py](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/CAM/Path/Post/Processor.py). It is a practical design, though it loses more high-level machining intent than an event-rich IR.

### 2.2 Kiri:Moto: shared area engine and explicit travel preparation

Kiri:Moto keeps an ordered operation list, runs strategy code in a worker pipeline, then prepares/routes the resulting motion before export. Sources: [operation base](https://github.com/GridSpace/grid-apps/blob/master/src/kiri/mode/cam/core/op.js), [slice pipeline](https://github.com/GridSpace/grid-apps/blob/master/src/kiri/mode/cam/work/slice.js), and [motion preparation](https://github.com/GridSpace/grid-apps/blob/master/src/kiri/mode/cam/work/prepare.js).

Several operations reuse a shared area engine for Z levels, offsets, clearing, tab clipping, travel boundaries, depth-first order, and path joining. This is a strong middle ground: user-visible operations remain distinct while geometric machinery stays shared.

Its travel-preparation phase is particularly relevant:

- operation transitions retract to computed safe Z;
- XY changes occur after the retract;
- tool shadows and boundaries can force up-and-over routing;
- a requested rapid that would cross stock is converted to controlled cutting/plunge behavior;
- large within-stock transitions trigger safe routing;
- tool, feed, plunge, spindle, and operation metadata stay attached until export.

The export layer then emits machine macros, tools, spindle, dwell, operation sections, rapids, feeds, arcs, and footer. Source: [export.js](https://github.com/GridSpace/grid-apps/blob/master/src/kiri/mode/cam/work/export.js).

Kiri's limitations—rectangular stock and a linear rather than dependency-aware operation list—show exactly where a small-CAM architecture begins to strain.

### 2.3 Autodesk Fusion Manufacture: the strongest domain boundary

A Fusion subtractive setup combines machine, operation type, target model, WCS/origin, stock, fixture geometry, postprocessor, and work offset. Source: [Setup reference](https://help.autodesk.com/view/fusion360/ENU/?guid=GUID6614D39D-114D-424A-ABDF-F97BC6D5D88F).

Operations consistently separate:

- Tool: assembly, feeds, spindle, coolant;
- Geometry: selected faces/edges/sketches, containment, rest source;
- Heights: clearance, retract, feed, top, bottom;
- Passes: stepover, stepdown, stock to leave, smoothing;
- Linking: retract policy, safe distance, keep-tool-down, leads, ramp, and entry.

Source: [operation parameter overview](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-OVERVIEW-BROWSE-PARAMETERS.htm).

This is not UI organization only. Each group controls a different correctness boundary.

Fusion's entry/linking options show why a single `rampEntryDeg` cannot scale:

- full, minimum, and shortest-path retracts;
- keep-tool-down limits;
- radial/axial safe distances;
- rapid-to-high-feed substitution;
- straight and circular lead-in/out;
- plunge, zig-zag, profile, smooth-profile, helix, and predrill entry;
- maximum ramp angle and axial descent per turn.

The [Contour Finishing reference](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/GUIDEA850013-D826-408E-B076-C613834A77F3.htm) warns that shortest-path links can be unsafe when a controller executes dog-leg G0. A post may need to emit high-feed linear motion. This is direct evidence that machine semantics belong in the post capability contract.

Fusion's adaptive clearing models engagement, minimum corner radius, stock to leave, cavity behavior, and rest machining. Remaining stock is a computed artifact, not a synonym for smaller-tool diameter. Sources: [Adaptive Clearing](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/GUID09E44604-DAD8-47D6-ADC6-C100869DE724.htm) and [rest machining between setups](https://help.autodesk.com/view/fusion360/ENU/?guid=MFG-CONTINUE-REST-MACHINING).

When source geometry changes, operations become stale and require regeneration. Warnings, errors, and out-of-date state are distinct. Source: [Fusion warnings and errors](https://help.autodesk.com/view/fusion360/ENU/?guid=Fusion_CAM_reference_cam_browser_operation_warnings_html).

Fusion's post boundary is event-rich. Intermediate NC events call hooks such as `onSection`, `onRapid`, `onLinear`, `onCircular`, `onCycle`, `onDwell`, `onSpindleSpeed`, and machine-command callbacks. Sources: [post configuration](https://cam.autodesk.com/posts/reference/configuration.html) and [entry functions](https://cam.autodesk.com/posts/reference/entry_functions.html).

The post therefore still knows operation sections and process events. It is not merely formatting an array of points.

### 2.4 Vectric: practical 2D/2.5D production modeling

Vectric's simpler flat toolpath list still has strong shop-floor features:

- tool geometry separate from cutting data by tool/material/machine;
- material thickness, XY datum, surface/bed Z zero, safe rapid Z, and home;
- job sheets repeating setup truth for operator verification;
- profiles inside/outside/on-vector;
- inner paths before outer paths;
- 2D and 3D tabs;
- smooth, zig-zag, and spiral ramps;
- straight/circular/tangential leads;
- raster/offset pockets;
- multi-tool pocket rest machining;
- keep-out regions for clamps and screws.

Sources: [Vectric user guide](https://docs.vectric.com/docs/V12.5/VCarvePro/ENU/Help/page/user-guide/index.html), [profile toolpath](https://docs.vectric.com/docs/V12.5/VCarveDesktop/ENU/Help/form/uiProfileMachineForm/index.html), [pocketing](https://docs.vectric.com/docs/V12.5/VCarvePro/ENU/Help/form/uiPocketMachineForm/), and [keep-out zones](https://docs.vectric.com/docs/V12.5/VCarvePro/ENU/Help/form/KeepOutZonesForm/index.html).

Its vector selector is especially useful: an operation may retain the rule “closed vectors on layer Pocket,” re-resolve it after artwork edits, and preserve it in a template. Source: [Vector Selector](https://docs.vectric.com/docs/V12.0/VCarvePro/ENU/Help/form/vector-selector/).

KerfDesk's color-based geometry selection resembles the beginning of this model but lacks an explicit saved selector, resolved entity set, and staleness proof.

### 2.5 Carbide Create and CAMotics: verification traps

Carbide Create supports linking toolpaths to layers and expressions tied to material thickness. It also disclosed an important problem: its built-in simulation used pre-post toolpath data, so postprocessor rounding differences appeared only in an external simulator. Sources: [Carbide Create v7](https://carbide3d.com/blog/carbide-create-v7/) and [Carbide Create 527](https://carbide3d.com/blog/carbide-create-527/).

CAMotics canonicalizes posted code through interpreter -> unit adapter -> motion linearizer -> optional planner -> normalized toolpath -> swept-volume simulation. Sources: [ToolPathTask](https://github.com/CauldronDevelopmentLLC/CAMotics/blob/master/src/camotics/sim/ToolPathTask.cpp) and [ToolPath](https://github.com/CauldronDevelopmentLLC/CAMotics/blob/master/src/gcode/ToolPath.h).

Its published limitations—no fixture/shaft collision, rapid-through-stock, lathe, or full multi-axis assurance—are an essential lesson: simulation coverage must be declared. A rendered toolpath is not proof of safety. Source: [CAMotics](https://camotics.org/).

## 3. Recommended manufacturing domain model

```ts
type ManufacturingPlan = {
  readonly partGeometryRevision: string;
  readonly machineProfiles: ReadonlyArray<MachineProfileRef>;
  readonly toolAssemblies: ReadonlyArray<ToolAssemblyRef>;
  readonly setups: ReadonlyArray<ManufacturingSetup>;
  readonly ncPrograms: ReadonlyArray<NcProgramSpec>;
};

type ManufacturingSetup = {
  readonly id: string;
  readonly targetModelRevision: string;
  readonly machineProfileRevision: string;
  readonly stock: StockDefinition;
  readonly fixtures: ReadonlyArray<FixtureModelRef>;
  readonly keepOuts: ReadonlyArray<KeepOutVolume>;
  readonly wcsFrame: CoordinateFrame;
  readonly controllerWorkOffset: 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59';
  readonly operationOrder: ReadonlyArray<string>;
  readonly dependencyEdges: ReadonlyArray<OperationDependency>;
  readonly revision: string;
};

type OperationSpec = {
  readonly id: string;
  readonly kind: OperationKind;
  readonly geometrySelector: GeometrySelector;
  readonly toolAssemblyRevision: string;
  readonly cuttingData: CuttingData;
  readonly heights: OperationHeights;
  readonly depthPlan: DepthPlan;
  readonly strategy: StrategyParameters;
  readonly entry: EntryPolicy;
  readonly linking: LinkingPolicy;
  readonly exit: ExitPolicy;
  readonly stockInput: StockInputRef;
  readonly mustRunAfter: ReadonlyArray<string>;
  readonly enabled: boolean;
  readonly revision: string;
};

type GeneratedToolpath = {
  readonly operationRevision: string;
  readonly resolvedGeometry: ReadonlyArray<ResolvedGeometryRef>;
  readonly stockInputHash: string;
  readonly warnings: ReadonlyArray<CamDiagnostic>;
  readonly errors: ReadonlyArray<CamDiagnostic>;
  readonly motion: SemanticMotionProgram;
  readonly bounds: Bounds3d;
  readonly estimatedTime: number;
  readonly staleReason?: string;
};

type PostedProgram = {
  readonly operationArtifacts: ReadonlyArray<string>;
  readonly postprocessorRevision: string;
  readonly machineProfileRevision: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly ncText: string;
  readonly parsedCanonicalMotion: CanonicalMotion;
  readonly verification: PostVerificationReport;
};
```

### 3.1 Geometry selection and staleness

Preserve both query intent and the resolution used:

```text
selector:
  closed vectors on layer "Pocket"

resolved at generation:
  entity IDs + topology/geometry hashes
```

An operation becomes stale when:

- selected IDs disappear;
- a rule resolves to a different set;
- topology or geometry hashes change;
- setup/WCS/stock/fixture changes;
- cutter or holder revision changes;
- upstream in-process stock changes;
- strategy, entry, linking, or post assumptions change.

Stale toolpaths must block posting. A warning that allows stale export is not enough.

### 3.2 Operation dependencies

Order alone cannot express:

```text
roughing -> in-process stock -> rest roughing -> finishing
predrill -> legal entry -> pocket/adaptive
pocket -> established floor -> engraving at that floor
inner profile -> outer profile/cutout
setup A -> transformed stock -> flipped setup B
tool measurement -> tool-length validity -> cutting operations
```

The UI may retain drag-and-drop order, but optimizer reordering must be a topological sort that respects explicit dependencies. “Minimize tool changes” is never permitted to move a consumer before the operation/artifact it consumes.

### 3.3 Tool assembly

The tool model needs separate revisions for:

- cutter type and geometry;
- cutting diameter and corner radius;
- flute count and flute length;
- overall length, stickout, and gauge length;
- holder/collet geometry;
- tool number, pocket, and controller offset;
- maximum axial/radial engagement;
- ramp/helix/plunge capability;
- material-specific feeds, chip load, surface speed, coolant, and notes;
- measurement state and wear correction.

Tool diameter alone is insufficient for collision, entry, feeds, and tool-change recovery.

### 3.4 Evolving stock and fixtures

In-process stock should be an immutable artifact keyed by:

- initial stock revision;
- setup/WCS revision;
- fixture revision;
- upstream operation artifact hashes;
- tool geometry revisions;
- tolerance/resolution.

Rest machining consumes this artifact. It should not be implemented as “rerun with a smaller tool.”

Fixture and keep-out models must affect:

- cutting reachability;
- retract and traverse routing;
- cutter, shaft, holder, head, table, and rotary collision;
- machine-coordinate recovery moves;
- setup sheets and operator verification.

## 4. Semantic motion IR and postprocessor contract

KerfDesk should retain analytic and semantic information until posting:

```text
Program
  SetupSection
    SelectWCS
    ToolSection
      ToolChange
      ApplyToolOffset
      OperationSection
        ModalContract
        SpindleCommand
        WaitForSpindleReady
        CoolantOrExtractionCommand
        SafeRetract
        Traverse
        EntryMove
        CuttingMove
        LinkingMove
        ExitMove
        SafeCheckpoint
      SpindleStop
```

Motion nodes should preserve:

- line, arc, helix, spline, or orientation curve;
- machine- versus work-coordinate intent;
- rapid intent versus actual controller representation;
- traverse, plunge, ramp, helix, lead, cut, tab, retract, probe, and dwell role;
- expected stock engagement and allowed material intersection;
- tool-center versus compensated-contour semantics;
- setup/operation/pass/contour provenance;
- fixture and clearance assumptions;
- restartability and checkpoint identity;
- spindle synchronization and feed mode.

The postprocessor may choose G0, high-feed G1, G41/G42, an expanded drilling sequence, or a canned cycle. It must not erase the safety meaning or silently substitute a less-safe strategy.

### Post capability contract

A post should declare:

- controller family/version and dialect;
- supported axes and kinematics;
- linear versus dog-leg rapid behavior;
- path-control modes;
- line/arc/helix/spline support;
- canned cycles and compensation;
- work offsets and tool offsets;
- spindle/coolant/extraction commands;
- at-speed support or dwell fallback;
- tool-change capability;
- feed modes and rotary representation;
- probing/macros/subprograms;
- restart/checkpoint support;
- numeric precision and tolerance.

Every post needs versioned properties, golden inputs/outputs, parse-back comparison, and controller simulator/hardware fixtures.

### Four verification layers

1. geometric toolpath preview;
2. stock-removal plus fixture/holder simulation;
3. postprocessed NC parse-back and comparison with semantic IR;
4. controller/machine behavior, limits, and hardware evidence.

Each layer must publish what it does not cover.

## 5. Entry, linking, and recovery

Entry/link/exit is a first-class subsystem because it controls peak tool load, witness marks, collisions, and recoverability.

### Entry policy examples

- vertical plunge only when the cutter and material permit it;
- along-path ramp with validated length and angle;
- zig-zag ramp;
- circular or helical ramp with diameter, pitch, and clearance proof;
- predrilled entry tied to a dependency;
- lead-in from outside stock or already-cleared material;
- rest-stock-aware re-entry.

If a requested ramp or helix does not fit, the system should emit a blocking diagnostic or require an explicit fallback. It must not silently change to a vertical plunge.

### Linking policy examples

- full retract to clearance;
- minimum retract within a proven clear volume;
- stay-down/keep-tool-down under a maximum distance and stock proof;
- boundary-following link;
- high-feed linear replacement for unsafe dog-leg rapid;
- fixture-aware up-and-over route;
- operation transition that forces safe checkpoint and accessory state.

### Restart granularity

- Drill: whole-hole boundary, never mid-peck.
- Profile: generated lead-in with overlap, never arbitrary interrupted segment.
- Pocket: depth/pass, island, or stock-state boundary.
- Adaptive: saved stock layer or regeneration from remaining stock.
- V-carve/relief: continuous stroke or verified scanline/waterline boundary.
- Tool-change/probe: replay the complete state-establishing section.
- Cutter compensation: restart before a valid compensation lead-in, never inside active G41/G42.
- Lathe synchronized motion: never generic line restart inside G33/G76.

The first dossier's P0 remains: if a stopped cutter may be engaged, neither automatic spindle start nor dead-cutter motion is generally safe. Recovery must first establish physical clearance under a supervised process.

## 6. Realtime motion planning

### 6.1 GRBL look-ahead

Legacy GRBL's default planner ring has 16 blocks, or 15 when line numbers are compiled in. A reverse pass limits entry speed to what can decelerate to downstream exit speed, and a forward pass limits what can accelerate from upstream speed. Source: [planner.h](https://github.com/gnea/grbl/blob/master/grbl/planner.h) and [planner.c](https://github.com/gnea/grbl/blob/master/grbl/planner.c).

The constant-acceleration relation is:

```text
v_entry_max^2 = v_exit^2 + 2 * a * length
```

Consequences:

- short blocks often never reach programmed feed;
- look-ahead distance matters, not only block count;
- sender starvation makes the newest plan terminate toward zero and creates slowdown;
- overly dense CAM tessellation harms throughput and surface quality;
- `ok` still does not mean the cutter reached the target.

### 6.2 Junction deviation is not path-tolerance blending

GRBL `$11` uses a virtual tangent-circle model to set junction speed while still passing through the programmed junction. It is corner-speed aggressiveness, not a guaranteed geometric deviation allowance equivalent to LinuxCNC `G64 P`. Source: [GRBL planner](https://github.com/gnea/grbl/blob/master/grbl/planner.c) and [settings](https://github.com/gnea/grbl/blob/master/doc/markdown/settings.md).

LinuxCNC distinguishes:

- `G61`: exact path;
- `G61.1`: exact stop;
- `G64`: continuous blend without specified bound;
- `G64 P`: blend within a declared path tolerance;
- `G64 P Q`: additionally simplify nearly collinear short CAM segments.

Source: [LinuxCNC user concepts](https://linuxcnc.org/docs/html/user/user-concepts.html).

Machine profiles must not map `$11` to `G64 P` or present them as the same setting.

### 6.3 Acceleration and jerk

Legacy GRBL uses constant-acceleration triangular/trapezoidal profiles. Acceleration changes instantaneously at phase boundaries, so jerk is mathematically unbounded there. Source: [GRBL stepper](https://github.com/gnea/grbl/blob/master/grbl/stepper.c).

Current grblHAL has optional compile-time finite-jerk support, with exceptions for jog, probe/system motion, and spindle-synchronized motion. Source: [grblHAL planner](https://github.com/grblHAL/core/blob/master/planner.c) and [changelog](https://github.com/grblHAL/core/blob/master/changelog.md).

LinuxCNC 2.10/master adds an optional S-curve planner while trapezoidal remains the default. This is version-specific and must be negotiated. Source: [Integrator Concepts](https://www.linuxcnc.org/docs/devel/html/en/config/integrator-concepts.html).

A predictive model must use the same profile for stopping distance, soft limits, feed hold, and estimate. Adding a smoothing filter after trapezoidal planning is not equivalent.

### 6.4 Feed hold

GRBL `!` performs coordinated deceleration, may consume multiple blocks, retains a partial block, and replans the remainder from zero on `~`. Normal mill-mode hold leaves spindle and coolant on. Reset/hard limit is a different state and can invalidate position. Sources: [commands](https://github.com/gnea/grbl/blob/master/doc/markdown/commands.md), [stepper](https://github.com/gnea/grbl/blob/master/grbl/stepper.c), and [planner](https://github.com/gnea/grbl/blob/master/grbl/planner.c).

Same-session feed hold should remain a controller operation. The app should not synthesize pause by sending M5 and later rebuilding G-code.

## 7. Geometry and tolerance budget

GRBL internally segments arcs before step execution. Its arc tolerance bounds chord-to-circle error; tighter tolerance increases internal segments, planner work, and short-block exposure. Source: [motion_control.c](https://github.com/gnea/grbl/blob/master/grbl/motion_control.c).

KerfDesk needs separate tolerances:

```text
source/CAD tessellation
+ CAM offset and stock-model tolerance
+ smoothing/spline-fit error
+ postprocessor arc-fit error
+ controller arc chord error
+ controller path-blend allowance
+ step quantization or servo following error
+ backlash/compliance/tool deflection
= possible physical contour error
```

These values should never be collapsed into one ambiguous “precision” field.

Keep analytic arcs/helices/splines in the IR as long as possible. Flatten only when a post/controller requires it, with a declared tolerance and segment-density budget.

## 8. Kinematics and machine classes

### 8.1 Feedback classes

```text
openLoopCommanded
driveClosedLoop
controllerClosedLoop
```

GRBL's internal position counts commanded steps, not measured carriage motion. It cannot detect lost steps. A drive that closes its own encoder loop but only reports an alarm is different from a controller that consumes encoder position and owns following-error protection.

The UI and recovery model must state which class applies.

### 8.2 Homing and limits

Machine profiles should include:

- separate/shared home and limit switches;
- polarity and wiring expectation;
- seek/latch directions and rates;
- debounce and pull-off;
- index pulse;
- home sequence;
- dual-motor gantry/auto-square behavior;
- machine and joint soft limits;
- absolute-encoder reference policy.

Soft limits are only trustworthy after valid reference. Hard-limit, reset, stall, or drive fault may invalidate position.

### 8.3 Four and five axes

Indexed 3+1 and simultaneous 4-axis are different processes. The latter needs mixed linear/rotary feed semantics, collision simulation, and controller support. `G93` inverse-time feed is often appropriate for mixed-axis moves. Source: [LinuxCNC feed modes](https://linuxcnc.org/docs/html/gcode/g-code.html#gcode:g93-g94-g95).

Five-axis needs the actual head/table kinematic transform, pivot offsets, tool length, rotary limits, solution continuity, and singularity management. A Cartesian-valid endpoint does not prove a joint-valid path. Sources: [LinuxCNC kinematics](https://linuxcnc.org/docs/html/motion/kinematics.html) and [5-axis kinematics](https://linuxcnc.org/docs/html/motion/5-axis-kinematics.html).

Required checks include:

- forward/inverse kinematic round-trip;
- continuous IK branch selection;
- rotary wrapping;
- joint position/velocity/acceleration/jerk across the full segment;
- tool-center-point error;
- near-singularity refusal/reorientation;
- full machine, head, table, fixture, holder, and stock collision.

### 8.4 Lathe

Lathe cannot be modeled as a router with X/Z labels.

- `G95` feed per revolution requires measured spindle speed.
- CSS changes RPM with diameter and requires an RPM cap.
- G33/G76 threading needs speed plus index feedback and phase-aligned motion.
- Rigid tapping needs synchronized reversal.
- chuck state, turret/tool identity, diameter/radius mode, stock projection, and spindle direction matter.

Sources: [LinuxCNC feed modes](https://linuxcnc.org/docs/html/gcode/g-code.html#gcode:g93-g94-g95) and [G33](https://linuxcnc.org/docs/html/gcode/g-code.html#gcode:g33).

## 9. Process physics and predicted achieved feed

For milling:

```text
feed = chip_load_per_tooth * RPM * effective_flutes
material_removal_rate = axial_depth * radial_width * feed / 1000
```

Source: [Sandvik milling formulas](https://cdn.sandvik.coromant.com/files/sitecollectiondocuments/services/metal-cutting-e-learning/formulas-and-definitions/formulas-and-deinitions-for-milling-metric-enu.pdf).

Actual chip load varies with the controller's achieved velocity:

```text
actual_chip_load(t) ~= actual_feed(t) / (actual_RPM(t) * effective_flutes)
```

Implications:

- corner slowdown reduces chip thickness and can create rubbing/heat;
- feed hold drives chip thickness to zero at one cutter location;
- independent feed override changes chip load;
- spindle bog under fixed G94 feed increases chip load;
- dense short segments may keep the cut below its intended regime;
- “slower” is not universally safer.

CAM owns stock engagement. The controller owns kinematic execution but normally does not know remaining material. Adaptive clearing is therefore a stock-aware CAM strategy, not a special feed setting. Source: [Fusion 2D Adaptive](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/2D-ADAPTIVE-READ.htm).

Useful predictive views:

- programmed versus predicted achieved feed;
- distance below 90/75/50 percent of target;
- predicted chip-load band;
- high-engagement corners;
- segment-length histogram and starvation risk;
- RPM/feed override interaction;
- spindle torque/power envelope when known.

These remain predictions, not tool-load safety guarantees.

## 10. Machine I/O and functional-safety boundary

### 10.1 Standards ownership

- [ISO 12100](https://www.iso.org/standard/51528.html): general risk assessment and risk reduction.
- [ISO 13849-1:2023](https://www.iso.org/standard/73481.html): design/integration of safety-related control-system parts.
- [ISO 13849-2:2012](https://www.iso.org/standard/53640.html): validation by analysis and test.
- [IEC 62061:2021](https://webstore.iec.ch/en/publication/59927): machinery functional-safety lifecycle.
- [IEC 60204-1](https://webstore.iec.ch/en/publication/26037): electrical/electronic/programmable machine equipment.
- [IEC 61800-5-2](https://webstore.iec.ch/en/publication/24556): safety-related drive systems/functions such as STO.
- [ISO 14119:2024](https://www.iso.org/standard/75942.html): guard interlocking and defeat resistance.
- [ISO 13850:2015](https://www.iso.org/standard/59970.html): emergency-stop principles.
- [ISO 19085-1](https://www.iso.org/standard/77655.html) and [ISO 19085-3](https://www.iso.org/standard/75953.html): woodworking-machine and CNC-router safety.
- [ISO 16090-1](https://www.iso.org/standard/81558.html): applicable metal/noncombustible machining centres and mills; it excludes wood-like materials.

Public scopes establish the research map, not compliance. Full licensed text, the actual machine design, and competent assessment are needed for PLr/SIL, category, stopping-time, diagnostic-coverage, and validation claims.

Do not confuse IEC stop Categories 0/1/2 with ISO 13849 architecture Categories B/1/2/3/4.

### 10.2 Required boundary

```text
dual-channel E-stop ─┐
guard/interlock ─────┼─> safety relay/PLC ─> SS1/STO/contactors/brake
safety sensors ──────┘          |
                                +-> auxiliary status -> controller -> KerfDesk

KerfDesk -> normal run/hold/stop -> controller -> motion and process I/O
```

The safety chain must reach its safe state when KerfDesk, Windows, USB, or GRBL has failed.

KerfDesk should never call its UI Stop an emergency stop.

### 10.3 Stop behavior

- Category 0: immediate power removal/drive disable; motion can coast.
- Category 1: controlled deceleration followed by power removal.
- Category 2: controlled stop with power retained for holding.

Source: [Rockwell stopping sequences](https://www.rockwellautomation.com/en-tr/docs/studio-5000-logix-designer/38-00/contents-ditamap/instruction-set/cip-axis-attributes/stopping-and-braking-attributes/stopping-sequences.html).

Risk assessment selects the stop. Immediate torque removal is not automatically safest: a spindle can coast and a gravity Z axis can fall. Reset must not cause automatic restart.

### 10.4 I/O ownership matrix

| Function | KerfDesk | Realtime controller | Hardware/safety system |
|---|---|---|---|
| E-stop | Display, log, refuse | Mirror/inhibit ordinary commands | Dual-channel sensing, safe stop, STO/contactors/brake, monitored reset |
| Guard | Block and explain | Report/stop ordinary cycle | Interlock/guard lock/restart prevention |
| Spindle | Require fresh proof | Consume ready/RPM/direction/fault | VFD/encoder feedback; safety drive if required |
| Drive fault | Diagnose/invalidate | Immediate stop | Drive fault output and safe disable |
| Home/limits | Model confidence | Realtime homing/limit reaction | Switches/encoders and appropriate wiring |
| Watchdog | Diagnose host stall | Heartbeat supervision | External charge pump removes enables |
| Clamp | Checklist unless proved | Consume pressure/position proof | Sensor/interlock where release can eject work |
| Dust/coolant/vacuum | Command/display | Consume flow/pressure proof | Independent response where risk requires |
| Probe | Guide and validate | Deterministic bounded cycle | Probe/tool-setter mechanics and input |
| ATC | Orchestrate formal states | Deterministic state machine | Clamp/orient/pocket/pressure sensors and PLC where needed |

Capabilities need provenance/freshness, not booleans:

```text
unsupported
configured
controller-reported
hardware-proven
safety-rated
```

### 10.5 Spindle/VFD state

Separate:

- run command;
- requested and measured direction;
- requested and measured RPM;
- ready/at-speed;
- VFD fault;
- STO/safety state.

`M3 S...` proves a command. `G4` proves elapsed time. Neither proves measured speed. LinuxCNC's `spindle.N.at-speed` demonstrates the correct execution predicate. Sources: [core components](https://linuxcnc.org/docs/stable/html/config/core-components.html) and [spindle example](https://linuxcnc.org/docs/html/examples/spindle.html).

### 10.6 Probe and ATC

A probe cycle needs inactive-before-start proof, bounded travel/speed, deterministic already-active/no-contact failure, validated contact result, retract/re-touch policy, correct calibration, and refusal after ambiguity.

An ATC needs a controller/PLC handshake for safe position, spindle zero/orientation, pressure, unclamp/clamp proof, pocket position, tool presence, identity/length, and timeout at every transition. KerfDesk's current M0 flow is manual tool change, not ATC.

## 11. Prioritized KerfDesk architecture work

### P0 — release/safety blockers

1. Disable automatic CNC crash/power-loss resume based on ACK count.
2. Require supervised recovery for unknown cutter engagement.
3. Never continue after E-stop, guard opening, reset, VFD/drive fault, power loss, or position loss without full requalification.
4. State explicitly that UI Stop, GRBL hold, and host watchdog are not emergency-stop safety functions.
5. Do not claim machine-level safety without independent validated E-stop/guard/STO architecture.

### P1 — foundational domain seams

1. First-class `ManufacturingSetup`.
2. First-class `OperationSpec` plus generated artifact and stale engine.
3. Geometry selector with resolved entity/topology hashes.
4. Explicit operation dependencies and in-process stock artifacts.
5. Rich tool assembly and measurement/offset state.
6. Typed entry/link/exit strategies with no silent fallback.
7. Semantic analytic motion IR.
8. Versioned postprocessor capability contract and parse-back verifier.
9. Machine/controller capability model with provenance/freshness.
10. Separate router/mill, lathe, plasma, indexed rotary, and simultaneous multi-axis processes.

### P2 — advanced CAM and prediction

1. Fixture/holder/head collision and clearance routing.
2. Stock-aware rest machining.
3. Adaptive/trochoidal clearing with engagement target.
4. Predrill/helix/lead entry dependencies.
5. Controller-aware path/blend/tolerance preview.
6. Achieved-feed and chip-load prediction.
7. Multiple/flipped/indexed setups.
8. Kinematic joint-space preflight.
9. VFD/drive/guard/watchdog integrations where hardware supports them.

### P3 — higher machine classes

1. Indexed 3+1 with explicit setup transforms.
2. Simultaneous rotary with inverse-time feed and collision model.
3. Five-axis TCP, IK continuity, rotary limits, and singularity handling.
4. Lathe-specific CAD/CAM/control domain with CSS/G95/threading feedback.
5. Formal ATC interface and controller/PLC handshake.

## 12. Verification program

### CAM/domain

- geometry selector invalidation and stale blocking;
- dependency-preserving tool optimization;
- stock artifact hashes and rest-material accuracy;
- impossible entry fails instead of plunging;
- fixture-aware retract/link routes;
- holder/shaft/head collisions;
- post golden outputs and semantic parse-back.

### Planner/tolerance

- triangle/trapezoid/S-curve profile oracle;
- every junction angle and axis-limited diagonal;
- buffer starvation and override changes;
- G61/G61.1/G64 behavior;
- line/arc/helix/spline tolerance corpus;
- combined tolerance budget;
- feed hold at every motion phase and queue boundary.

### Feedback/homing/kinematics

- pulse counts, pulse width, direction timing, jitter;
- open-loop stall never presented as measured truth;
- following-error and drive fault;
- home switch bounce/stuck/missed/wrong polarity;
- dual-motor gantry one-side failure;
- FK/IK round-trip, branch continuity, rotary wrap, joint limits, singularities;
- lathe RPM modulation, index loss, CSS cap, G33/G76 phase.

### Machine safety and fault injection

- app crash, OS sleep, USB unplug, corrupt/lost responses;
- E-stop during rapid, plunge, and high-inertia spindle motion;
- guard open at worst-case stopping distance;
- stuck/cross-shorted safety channel and welded final element;
- VFD never-at-speed, wrong direction, and mid-cut fault;
- drive alarm/reference invalidation;
- probe stuck active/no contact/bounce;
- clamp/tool-clamp/dust/coolant proof loss;
- controller heartbeat loss;
- brownout and power return with no automatic restart.

Evidence should include program/profile hashes, controller transcript, measured motion/RPM, logic-analyzer or drive trace where relevant, and synchronized video.

## 13. Final design rule

The next version of KerfDesk should not grow by appending more fields to `CncLayerSettings` until the manufacturing-plan seam exists. The present pure compiler is worth preserving, but it should become a generator beneath first-class setups and operations.

The target architecture is:

```text
revisioned manufacturing intent
  -> generated semantic toolpath
  -> controller-specific post
  -> parsed verification artifact
  -> safety-aware sender
  -> realtime controller
  -> independently protected physical machine
```

That architecture makes advanced CAM, reliable simulation, safe recovery, controller diversity, and defensible machine integration possible without confusing any one layer for the whole CNC system.
