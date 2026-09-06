> **Historical research archive: 11–13 July 2026.** Published on 6 September 2026.
> Findings, scores, source claims and proposed changes below describe their recorded
> baseline; they have not been revalidated and are not current product or qualification
> evidence. Unimplemented proposals are not adopted policy. The current
> [Frame-first contract](../../PROJECT.md) governs application behaviour. See the
> [archive index](2026-09-06-preserved-audits.md) and [source manifest](2026-09-06-preserved-audits-source-manifest.json).

# CNC Motion Control, Drive, Process Dynamics, and Metrology Deep Research

Date: 2026-07-13
Scope: trajectory planning, path blending, kinematics, stepper/servo truth, homing and compensation, milling process load, stock state, interrupted-process re-entry, and implications for KerfDesk
Method: primary controller source and manuals, public CAM/control documentation, manufacturing references, research literature, and current-source audit of `C:\Users\Asus\LaserForge\audit-current-main`

## Executive verdict

A G-code coordinate is not a physical cut. It passes through four different models:

```text
CAM geometry and process intent
-> controller trajectory and path blending
-> joint/drive command and mechanical response
-> cutter/material interaction and evolving stock
```

Each layer can be correct while the next layer fails:

- CAM can generate a geometrically valid path whose tiny segments starve or slow a controller;
- the controller can command the right trajectory while an open-loop stepper loses position;
- the axes can follow accurately while the cutter chatters, deflects, rubs, recuts chips, or breaks;
- the cut can begin correctly and become unrecoverable after stock, tabs, clamps, or the cutter change state.

The central architecture requirement is therefore:

> Keep programmed, planned, commanded, measured, and material state separate. Never promote one to another without evidence.

KerfDesk has useful deterministic foundations: a GRBL-style XY time estimator, native arcs for some circular passes, ramped 3D paths, cut-direction control, a provisional chip-load calculator, a material-removal preview, machine bounds/no-go preflight, and controller settings capture. None is presently a controller or cutting-process proof.

The most important new local findings are:

1. **The CNC ETA is a 2D approximation.** It projects CNC paths to XY, adds analytic Z time, uses one scalar acceleration and maximum feed, and does not reproduce the emitted coordinated XYZ path or controller-specific planner.
2. **Axis limits are collapsed incorrectly for CNC decisions.** `$110/$111` become their greater value in `maxFeed`; CNC preflight and its connected-controller warning compare against that scalar, so a move along the slower axis may be silently controller-clamped.
3. **Ramp requests can silently end in a vertical plunge.** When the requested ramp does not fit the available path, the current generator appends a same-XY descent rather than failing or selecting a legal entry strategy.
4. **The tool/material recommendation lacks physical identity.** The beginner material picker assumes two flutes, while the tool record stores no flute count, cutting length, center-cutting capability, stickout, material, coating, or vendor cutting-data revision. The UI describes the auto-filled result as safe even though the core correctly labels its chart provisional.
5. **Feed capping makes the displayed chip load false.** The calculator first chooses a target chip load, then silently caps feed at `device.maxFeed` without reducing RPM or recomputing the achieved chip load. It returns and displays the original target value even when the commanded values cannot produce it.
6. **The stock preview is planned state, not observed state.** It is reconstructed from commanded paths, and the UI chooses the machine's active-tool kernel for the whole preview rather than the tool attached to each multi-tool operation. It cannot establish what material remains after an interruption.

This tranche does not recommend moving realtime trajectory generation into the desktop. The controller owns deterministic realtime motion. KerfDesk should own semantic process intent, capability negotiation, conservative prediction, conformance testing, evidence, and safe recovery classification.

## 1. Four-layer execution model

### 1.1 CAM/process layer

This layer decides:

- stock, fixture, setup, datum, and remaining material;
- tool assembly and cutting data;
- operations and dependencies;
- roughing versus finishing;
- axial/radial engagement and stock to leave;
- entry, linking, lead-in/out, retract, and re-entry;
- geometric tolerance and surface requirements;
- postprocessor semantics.

It outputs semantic motion, not motor pulses.

### 1.2 Trajectory layer

The controller turns programmed lines/arcs into a time-parameterized path subject to:

- modal path-control mode;
- velocity and acceleration limits;
- junction/corner tolerance;
- lookahead depth;
- jerk or acceleration shaping;
- per-axis and kinematic limits;
- feed/rapid overrides;
- planner/RX capacity;
- interpolation cycle and step-generation limits.

The controller may slow, blend, approximate, merge, or segment the programmed path. `F1000` is a request, not evidence that the cutter actually moved at 1000 mm/min.

### 1.3 Joint/drive/mechanical layer

The controller's time-based command becomes:

- joint positions/velocities;
- step/direction pulses or servo setpoints;
- drive current/torque;
- motor and screw/belt motion;
- actual table/tool-center motion.

Open-loop step count, closed-loop motor position, linear-scale position, and tool-center position are different evidence. Backlash, compliance, thermal growth, squareness, pitch error, following error, lost steps, and structural vibration live here.

### 1.4 Cutting-process and stock layer

Actual motion plus spindle/tool/material state produces:

- instantaneous chip thickness;
- engagement angle and material-removal rate;
- force, torque, power, heat, and deflection;
- chatter or stable cutting;
- chip evacuation or recutting;
- tool wear, pull-out, or breakage;
- evolving stock, part support, and fixture load.

Neither G-code nor axis position alone proves this state. Recovery must reason about all four layers.

## 2. Current KerfDesk motion/process map

### 2.1 Existing strengths

The current source includes:

- `src/core/job/planner.ts`: segment decomposition, GRBL junction-deviation math, two-pass velocity planning, trapezoidal block-time estimate;
- `src/core/job/estimate-duration.ts`: CNC-to-XY projection plus analytic plunge/retract time;
- `src/core/cnc/motion-polish.ts`: optional cut-direction enforcement and along-path ramp generation;
- `src/core/output/cnc-grbl-strategy.ts`: deterministic safe-Z/plunge/cut emission and native G2/G3 for recognized circular arcs;
- `src/core/cnc/feeds-calculator.ts`: editable chip-load-derived starting values;
- `src/core/cnc/pocket-paths.ts`: contour-parallel and raster pockets with bounded stepover;
- `src/core/preflight/cnc-preflight.ts`: feed/RPM/depth/bounds/no-go/plunged-travel checks;
- `src/core/sim/*`: deterministic depth-grid preview with end-mill, ball, and V-tool kernels;
- `src/core/controllers/grbl/parse-settings.ts`: selected rate, acceleration, travel, limit, homing, and junction settings;
- live controller advisories for stock travel and maximum feed.

These are credible product foundations. Their contracts need to be stated precisely.

### 2.2 Current estimator contract

`estimateJobDuration` converts every CNC group into a 2D `CutGroup`:

- contour, arc, and path3d passes become XY polylines;
- every pass is priced at the group's XY feed;
- Z is added separately using `safeZ + abs(entryDepth)`;
- the XY planner uses one scalar device acceleration, junction deviation, and maximum feed;
- the GRBL-style planner does not use the connected target's buffer depth, jerk model, arc interpolation, path mode, per-axis limits, current override, or kinematics.

This creates several mismatches:

- a coordinated XYZ ramp's true path length is longer than its XY projection;
- a ramped pass can be charged a fictitious full retract/plunge even when the emitter remains at the same XY and prior Z;
- a contour depth ladder optimized by the emitter can be priced as repeated full-Z travel;
- vertical stops are invisible to the XY lookahead, so adjacent XY passes may be treated as blendable;
- Z maximum rate/acceleration are not part of the plan;
- native arcs are sampled for the host estimate but remain controller-defined arcs in output;
- feed/rapid overrides and live controller settings changes are absent.

Therefore the ETA is a useful comparative estimate, not predicted physical execution. The UI and stored evidence should name the controller model, inputs, and uncertainty.

### 2.3 Axis-specific limit collapse

The settings collector retains `maxFeedX`, `maxFeedY`, and Z rate/acceleration in its controller snapshot, but the persisted profile collapses:

- `$110/$111` to the **greater** value for `maxFeed`;
- `$120/$121` to the lesser scalar acceleration;
- Z to optional metadata outside the estimator.

For a unit path direction `u`, the coordinated path-rate ceiling is approximately:

```text
v_path <= min_i(v_axis_i / abs(u_i))
```

for every participating axis. A pure move along the slower axis is limited by that axis, not the faster axis. The connected CNC warning currently checks the greater scalar `limits.maxFeed`; the laser warning has a slower-axis helper, but the CNC version does not. Preflight and compilation likewise cap against the scalar device value.

The consequence is not normally an overspeed—the firmware still clamps. It is silent process drift:

- actual feed and chip thickness differ from the programmed recipe;
- ETA is wrong;
- ramp angle and axial feed can differ;
- finish, heat, rubbing, and tool load can change;
- the job transcript cannot explain why the controller ran slower.

### 2.4 Ramp-entry fallback violates the requested process

`applyRampEntry` computes a required length from drop and angle. If the source path is shorter, it walks the available path and then appends a vertical descent at the last XY point.

This is deterministic, but it silently changes process semantics from “maximum ramp angle” to “ramp as far as possible, then plunge.” The tool record cannot say whether the cutter is center-cutting or may plunge, and preflight does not diagnose the fallback.

For a non-center-cutting tool, a tiny closed contour, a narrow pocket, or a deep first pass, this can damage the cutter or work. A production CAM contract must choose one of:

- legal linear/zig-zag/profile ramp that fits;
- legal helix with diameter/pitch/chip-clearance proof;
- predrilled entry;
- explicitly permitted plunge-capable tool/process;
- blocking `entry-does-not-fit` diagnostic.

It must not silently substitute a more demanding entry mode.

### 2.5 Provisional cutting data is not bound to the tool

The core correctly calls its five-material chip-load table provisional. The beginner-facing material picker nevertheless:

- assumes two flutes;
- applies feed, plunge, and depth-per-pass immediately;
- calls them safe in its title;
- stores only the material key on the layer;
- does not bind the result to flute count, tool revision, stickout, machine rigidity, spindle capability, or a source revision.

The advanced calculator keeps flute count only in component state. `CncTool` stores diameter/kind and optional included angle, so the project cannot later prove which flute count produced the feed.

If a one-flute cutter is physically loaded while the calculation assumed two, actual feed per tooth doubles. If a four-flute cutter is loaded, it halves, which can cause rubbing and heat. Changing the tool, RPM, or machine after applying the preset does not create a formal stale-recipe state.

There is also a direct calculation inconsistency. The function computes:

```text
target feed = RPM × assumed flutes × target chip load
returned feed = min(target feed, device.maxFeed)
```

but it returns `chiploadMm` unchanged. When capped:

```text
achieved chip load = returned feed / (RPM × actual flutes)
```

can be far below the displayed target. That can shift cutting into rubbing/heat, especially in plastics and aluminium. The calculator should either solve RPM/feed jointly within spindle and axis envelopes, report both target and achieved conditions with a blocking mismatch, or refuse the recommendation.

Concrete current-code example: softwood, 6.35 mm tool, two assumed flutes, and 24,000 RPM selects 0.11 mm/tooth, whose target feed is 5,280 mm/min. On a 1,000 mm/min profile the function returns feed 1,000 while still displaying 0.11 mm/tooth; the commanded pair actually yields about 0.0208 mm/tooth before any further controller clamping.

These values should be represented as a versioned recommendation with assumptions and qualification status, never as inherent truth.

### 2.6 Planned removal is not actual remaining stock

The depth-grid simulator stamps commanded cutting paths into nominal stock. This is valuable for design preview and deterministic regression, but it has no observation of:

- controller execution frontier;
- lost steps or deflection;
- tool breakage/pull-out;
- actual stock/fixture location;
- chips or recutting;
- material movement after a part or skeleton is freed;
- partial cut created before an interruption.

Additionally, `useCncRemovalGrid` builds one kernel from `activeCncTool(cncMachine)` for the entire preview. A multi-tool job can therefore visualize all operations with the wrong cutter geometry.

The planned stock model can seed simulation and rest-machining intent. It cannot be restored as physical truth after a disconnect or power loss.

## 3. Path control: exact points, exact stops, and blending

### 3.1 These are different geometric contracts

Path-control modes answer two questions:

1. Must the tool pass through every programmed endpoint?
2. Must it stop at that endpoint?

The useful distinctions are:

- **exact path:** hit the endpoint but carry permissible velocity through the direction change;
- **exact stop:** reach zero velocity at each segment boundary;
- **continuous/blended:** round or simplify junctions within a declared tolerance to preserve velocity.

Vanilla GRBL's junction-deviation calculation limits corner velocity but its own planner comments describe the result as exact-path motion: it still reaches the programmed junction. Setting junction deviation to zero behaves like exact stop. GRBL does not implement a LinuxCNC-style continuous path that geometrically rounds the corner. Source: [GRBL planner source](https://github.com/gnea/grbl/blob/master/grbl/planner.c#L313-L346).

LinuxCNC exposes the distinction explicitly:

- `G61`: exact path, slowing/stopping as required to reach each point;
- `G61.1`: stop at every segment end;
- `G64`: continuous path;
- `G64 P...`: blend within endpoint-deviation tolerance;
- `G64 P... Q...`: additionally merge nearly collinear CAM segments through the naive-CAM detector.

LinuxCNC warns that plain `G64` prioritizes speed without a distance bound; it recommends declaring path control in each file. Source: [LinuxCNC G61/G64 reference](https://linuxcnc.org/docs/html/gcode/g-code.html#gcode:g64).

Because blending can trim endpoints, a line endpoint is not automatically a physical checkpoint. Clearance verification must sweep the blended path, tool, and holder. Generated clearance-critical programs should reject bare/unbounded G64 unless an exact target-specific proof exists.

### 3.2 Audited controller comparison

| Controller | Path behavior | Lookahead | Motion law | Feed modes | Kinematics |
|---|---|---:|---|---|---|
| GRBL 1.1 | exact vertices; `$11` limits junction speed; no G64 blend | 16 planner blocks normally, effectively 15 with line numbers | trapezoidal/triangular constant acceleration | G93/G94 | Cartesian, compile-time CoreXY |
| grblHAL | GRBL-style exact path by default; G64 remains an explicitly disabled development feature in audited core | default 100, dynamically configurable subject to memory | GRBL trapezoids; optional compile-time jerk path is off by default | G93/G94; G95 only with actual-RPM-capable spindle path | configuration-specific CoreXY/delta/polar/wall-plotter and other modules |
| FluidNC | GRBL-style exact path; G61 accepted; G61.1/G64 unsupported in audited commit | YAML `planner_blocks` 10–120, default 16 | GRBL-derived trapezoidal planner | G93/G94 | runtime YAML Cartesian/CoreXY/Midtbot/delta/wall-plotter |
| LinuxCNC 2.9.10 | G61 exact path, G61.1 exact stop, default G64 geometric blend, G64 P/Q bounded blend/simplification | default 50-segment optimization depth | trapezoidal/constant acceleration plus geometric blends | G93/G94/G95 and synchronized motion | pluggable Cartesian/joint kinematics |
| LinuxCNC development 2026-07-12 | same path modes | same architecture | optional Ruckig-backed S-curve/jerk planning under development | same | same |

Primary source anchors: [GRBL planner](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/planner.c), [grblHAL planner](https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/planner.c), [grblHAL defaults](https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/config.h), [FluidNC planner](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/Planner.cpp), [FluidNC parser](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/GCode.cpp), [LinuxCNC 2.9.10 trajectory planner](https://github.com/LinuxCNC/linuxcnc/blob/v2.9.10/src/emc/tp/tp.c), and [development Ruckig integration](https://github.com/LinuxCNC/linuxcnc/blob/f767337cc3bc079f4a1a0f4d6b82a1a816b6acc8/src/emc/tp/ruckig_wrapper.c).

The exact commit/configuration belongs in certification. In particular, a current development-branch S-curve is not a stable LinuxCNC 2.9 feature, and optional grblHAL jerk support cannot be inferred from its banner.

### 3.3 Geometry tolerance is part of process intent

A global tolerance cannot represent all operations:

- roughing may permit larger contour deviation;
- finishing needs a surface/chordal tolerance;
- drilling, probing, tapping, thread synchronization, dwell, corners intended as sharp, and semantic checkpoints require exact behavior;
- clearance moves may blend only if the entire swept volume stays clear;
- tab boundaries, lead transitions, and stock-to-leave changes need semantic fences.

Exact stop is not universally safer for cutting. Stopping at every dense CAM segment can leave witness marks, rub/heat the tool, repeatedly reload it during acceleration, and make cycle time explode. The safe choice is an operation-specific, bounded path policy—not globally maximum blending or globally maximum stopping.

The semantic IR should attach:

```ts
type PathControlIntent = {
  mode: 'exact-stop' | 'exact-path' | 'blend';
  maxPathDeviationMm: number;
  maxChordErrorMm: number;
  preserveEndpoints: boolean;
  preserveAt: readonly ('entry' | 'exit' | 'tab' | 'probe' | 'checkpoint' | 'sync')[];
};
```

The post then maps the intent to the exact target:

- GRBL: geometry is normally exact-path, with speed controlled indirectly through `$11` and acceleration;
- LinuxCNC: `G61/G61.1/G64 P/Q`;
- grblHAL/FluidNC: only features proven by the negotiated build/configuration;
- controllers with proprietary tolerance/smoothing modes: target-specific mapping and certification.

Never emit a foreign path-mode word merely because another controller uses it.

### 3.4 Tolerance budget must be allocated end to end

Final part error is not equal to CAM chord error. Budget contributors include:

```text
source/model approximation
+ CAM tessellation/chord error
+ post rounding/arc fitting
+ controller blend/path tolerance
+ interpolation/step quantization
+ servo following error or lost motion
+ backlash/compliance/thermal/geometric error
+ cutter runout/deflection/wear
+ stock/fixture/probe uncertainty
```

They do not always add linearly, but treating each as if it owns the entire part tolerance guarantees surprises. A process plan should allocate and record them, then verify the critical dimensions by metrology.

## 4. Lookahead, velocity, acceleration, and jerk

### 4.1 GRBL's actual planner

For each linearized block, GRBL:

1. converts the target to integer step counts;
2. derives the realized move vector from those steps;
3. scales path maximum rate and acceleration so no individual axis exceeds its setting;
4. computes a maximum junction speed from the adjacent directions, acceleration, and `$11`;
5. runs reverse and forward planning over buffered blocks;
6. generates trapezoidal/triangular velocity segments for the stepper ISR;
7. replans buffered velocity when feed/rapid override changes.

Sources: [GRBL planner](https://github.com/gnea/grbl/blob/master/grbl/planner.c), [step-segment generator](https://github.com/gnea/grbl/blob/master/grbl/stepper.c), and [junction-deviation setting](https://github.com/gnea/grbl/blob/master/doc/markdown/settings.md#11---junction-deviation-mm).

The axis scaling matters. GRBL computes each block from its direction vector and each axis's maximum rate/acceleration. A host scalar is not equivalent.

### 4.2 Lookahead is finite and arrival-dependent

The controller can only plan what has reached its planner buffer. Lookahead quality depends on:

- available planner blocks;
- host streaming latency and parser throughput;
- arc segmentation performed inside the controller;
- local file versus USB/Wi-Fi execution;
- number and length of CAM segments;
- controller interpolation cycle;
- realtime reporting/network traffic;
- macros or synchronized I/O that create fences.

If the planner starves, the machine must decelerate toward the end of known motion. It cannot assume a future collinear block will arrive. At best this lengthens time and marks a surface; at worst aggressive short-segment motion creates repeated acceleration, vibration, heat, or lost steps.

LinuxCNC documents a default 50-segment optimization depth and explains that short segments below roughly `desired velocity × servo period` can cause slowdown. Its naive-CAM tolerance can merge nearly collinear segments, trading geometry against throughput. Source: [LinuxCNC trajectory configuration](https://linuxcnc.org/docs/html/config/ini-config.html#_traj_section).

A release corpus therefore needs both geometric and throughput stress cases:

- long lines;
- many collinear microsegments;
- alternating short segments;
- dense arcs/splines;
- feed changes at every block;
- simultaneous XYZ;
- worst transport and status-report rate;
- local-file and host-streamed variants.

### 4.3 Acceleration is not jerk

A trapezoidal velocity profile has constant acceleration segments but instantaneous acceleration changes at their boundaries. That implies theoretically unbounded jerk. Mechanics filter the command, but excitation can still produce ringing, following error, lost steps, or surface marks.

Jerk-limited/S-curve planners bound the rate of acceleration change. They can reduce excitation and permit higher practical acceleration on flexible machines, but they require more state, lookahead, and target-specific tuning. They do not make a weak frame rigid or prove a stable cut.

Controller families differ:

- upstream GRBL uses acceleration-limited trapezoidal planning, not a general configurable jerk-limited motion law;
- current grblHAL has optional/configuration-dependent jerk settings and has continued changing that implementation, including exceptions for jog, probe, and spindle-synchronized motion;
- LinuxCNC's trajectory and servo layers depend on its configured planner, servo period, axes/joints, and HAL drive loop;
- FluidNC behavior is tied to the exact build and YAML machine configuration.

Source: [grblHAL current changelog](https://github.com/grblHAL/core/blob/master/changelog.md).

KerfDesk must record the exact target motion model. A generic `accelMmPerSec2` plus `$11` cannot predict every controller family.

### 4.4 Overrides change both time and process

GRBL replans remaining buffered blocks when feed/rapid override changes, but already prepared step segments are immutable. Override and hold response therefore has executor lead/latency; it is not instantaneous at the physical cutter.

Feed override is not a harmless UI multiplier. It changes:

- actual feed per tooth;
- chip thickness and heat;
- cutting force and tool deflection;
- material-removal rate;
- entry/plunge load;
- the controller's buffered velocity plan.

Spindle override changes surface speed and, unless feed follows it, chip load. Feed and spindle override should be logged as time series and either linked by a declared process policy or surfaced as a changed cutting condition.

Rapid override affects clearance timing but must not be treated as cutting feed. System motion, probing, threading, and controller-specific synchronized moves may ignore or restrict overrides.

## 5. Coordinated axes, kinematics, and feed modes

### 5.1 Programmed feed has a mode

At minimum:

- `G94`: units per minute along the coordinated path;
- `G93`: inverse time, with the block intended to complete in `1/F` minutes;
- `G95`: units per spindle revolution where supported;
- rapid motion: axis/kinematic maximums, not ordinary `F`.

In G93, each motion block carries its own duration. Splitting one inverse-time block into several and copying the same F multiplies total duration; an internal arc segmenter must preserve the source block's total time.

G95 requires actual spindle-speed coupling, not only a commanded S word. Stock GRBL and the audited FluidNC commit do not support it. grblHAL support depends on an actual-RPM-capable spindle driver. LinuxCNC consumes spindle speed feedback. A host must not translate G95 to fixed G94 using nominal RPM and claim equivalence; droop would change chip load. Threading/rigid tapping additionally require spindle position/index synchronization, not merely feed per revolution.

Rotary axes complicate path length because degrees cannot be combined with millimetres without a machine/tool-center metric. Multi-axis controls use kinematics and rotary radius/tool-center transforms; a desktop scalar Euclidean estimator cannot guess this.

Upstream GRBL supports G93/G94 but not a general industrial multi-axis tool-center-control contract. grblHAL and FluidNC add configuration-dependent axes and kinematics. LinuxCNC explicitly notes that its trajectory planner works in Cartesian axis space and the motion layer must still catch joint-limit violations produced by non-identity kinematics. Source: [LinuxCNC axis/joint constraints](https://linuxcnc.org/docs/html/config/ini-config.html#_joint__section).

KerfDesk's current generated CNC is deliberately G94, but the recovery scanner silently ignores G93/G94/G95, G61/G64, G2/G3 arc state, cutter compensation, and other modal contexts. Automatic checkpoint resume is already unsafe for generated jobs; this confirms it must fail closed for imported or future richer dialects rather than treating an unrecognized mode as restored.

### 5.2 Per-axis constraints apply to every vector

For a Cartesian linear move with unit direction `u`, the path limit is derived from every participating axis. The same principle applies to acceleration. For CoreXY, gantries, robots, deltas, or rotary tool-center control, transforms must map path motion to motor/joint motion first.

FluidNC demonstrates why the target model matters. Its CoreXY kinematics transform Cartesian movement into two coupled motor coordinates and adjust feed for motor-space versus Cartesian distance. Its parallel-delta implementation subdivides a Cartesian move by configured kinematic segment length, transforms each point, and adjusts feed for motor-space motion. One G-code block can therefore become many position-dependent joint blocks. Sources: [FluidNC CoreXY](https://github.com/bdring/FluidNC/tree/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/Kinematics) and [parallel-delta segmentation](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/Kinematics/ParallelDelta.cpp).

Required machine data:

```ts
type AxisExecutionContract = {
  axis: string;
  units: 'mm' | 'deg';
  maxVelocity: number;
  maxAcceleration: number;
  maxJerk?: number;
  minLimit: number;
  maxLimit: number;
  driveType: 'open-loop-stepper' | 'closed-loop-stepper' | 'servo';
  feedbackLocation: 'none' | 'motor' | 'screw' | 'linear-scale' | 'external';
};
```

The controller remains authoritative. The host uses this model for validation, conservative ETA, visualization, and certification matching.

### 5.3 Coordinated ramp feed must be decomposed

For an XYZ ramp commanded at path feed `v`:

```text
v_xy = v * horizontal_length / 3d_length
v_z  = v * abs(delta_z) / 3d_length
```

The actual path feed is then further limited by the target's axis constraints. A CAM process may separately specify ramp feed and maximum axial descent, rather than reusing contour feed.

KerfDesk currently emits coordinated ramp points at the ordinary cutting feed and uses plunge feed only for a pure-vertical remainder. It has no independent ramp feed, maximum axial feed during ramping, or controller-derived vector constraint.

## 6. Arcs, tessellation, short segments, and controller throughput

### 6.1 Native curves and linearized paths are not equivalent

Native G2/G3 can reduce program size and host bandwidth, but the controller still internally interpolates arcs using its own tolerance/cycle. Small linear segments expose CAM tessellation explicitly but consume parser/planner bandwidth and may create repeated junction limits.

Important properties include:

- geometric chord error;
- endpoint and center rounding;
- minimum segment length;
- controller arc tolerance and correction cadence;
- full-circle and near-semicircle numeric behavior;
- helical interpolation support;
- plane support;
- maximum arc radius/turns;
- blend behavior at line/arc and arc/arc junctions.

KerfDesk emits native XY arcs for recognized circular passes and samples invalid/unsupported cases to G1. The host ETA samples arcs regardless. The estimated block structure therefore differs from the controller's internal arc segmentation.

GRBL and FluidNC derive internal arc chords from the configured arc tolerance and repeatedly feed those chords into the ordinary planner. In simplified form, segment count grows roughly as:

```text
N = floor(abs(0.5 * sweep * radius) / sqrt(tolerance * (2 * radius - tolerance)))
```

The chord lies inside the analytic circle; upstream GRBL notes that diameter can be smaller by up to twice the tolerance. Lower tolerance improves geometry but creates more short blocks and can reduce attainable speed. Sources: [GRBL arc generator](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c) and [FluidNC motion control](https://github.com/bdring/FluidNC/blob/94e8adbbc17fde3e29d025e4c91b8dbcf76109e3/FluidNC/src/MotionControl.cpp).

This creates an especially important acknowledgement result:

- for an ordinary G1, `ok` can arrive after planner admission while physical motion has not begun—acknowledgement is ahead of the cutter;
- for one long G2/G3 expanded into many blocks, the generator may wait for planner space while earlier chords execute, and final `ok` arrives only after expansion—acknowledgement can be behind the cutter.

Kinematic segmentation and canned cycles can create the same one-line-to-many-block behavior. An acknowledged-line recovery frontier therefore has an error of unknown sign, not merely a fixed delay.

### 6.2 Post rounding is a safety-relevant transformation

KerfDesk rounds coordinates to 0.001 mm. For most hobby routers that is below machine resolution, but the contract still needs:

- zero-length elimination after formatting;
- arc start/end/radius consistency after formatting;
- preservation of closed-loop topology;
- no thin wall or tab disappearance;
- no path crossing a fixture/no-go boundary due to combined tolerances;
- stable results across unit conversion.

The final emitted text—not only pre-rounded geometry—must be re-parsed and checked.

KerfDesk's shared arc sampler declares 0.05 mm chord tolerance but also refuses angular steps finer than 1 degree. Above roughly 1,313 mm radius, the 1-degree floor becomes the limiting rule; at 2,000 mm radius the possible sagitta is about 0.076 mm. This is not material on the current 400 mm machine but breaks the global “maximum 0.05 mm” claim for future large-format work. The sampler should either enforce tolerance without that floor or expose the actual achieved bound in provenance.

### 6.3 Planner starvation is not only a transport concern

Required data rate grows roughly with blocks per unit distance times path speed. A smooth-looking curve represented by thousands of tiny lines can exhaust parser, network, and planner throughput even when the raw baud rate seems adequate.

Certification should report:

- minimum sustained accepted blocks/second;
- minimum line bytes/second by transport;
- actual planner depth;
- worst-case status/report overhead;
- minimum segment time without starvation;
- behavior when starvation begins;
- surface/position result after the stress run.

The post can reduce load through certified arc fitting, spline support, collinear merging within tolerance, or local-file execution. It must not loosen geometry silently.

## 7. Position truth and drive topology

### 7.1 CNC position is a chain, not one number

Keep at least:

```text
trajectory-command position
-> controller motor command
-> emitted step count or servo setpoint
-> motor-shaft encoder position
-> screw/table/load-scale position
-> tool-center point relative to workpiece
```

Every downstream frontier can diverge while upstream values look correct. The sensor location determines what is observable.

### 7.2 Stock GRBL `MPos` is not measured position

Upstream GRBL's realtime report converts `sys_position` counts to machine units. The step ISR updates those counts when it generates step pulses. No encoder appears in that evidence path. A stalled motor, skipped step, loose coupling, racked gantry, unpowered drive, or moved workpiece does not correct `MPos`. Sources: [GRBL report](https://github.com/gnea/grbl/blob/master/grbl/report.c), [position conversion](https://github.com/gnea/grbl/blob/master/grbl/system.c), and [step-generated position](https://github.com/gnea/grbl/blob/master/grbl/stepper.c).

GRBL's settings documentation says a hard-limit stop likely loses steps and, without feedback, the controller cannot guarantee position. Source: [GRBL limits and settings](https://github.com/gnea/grbl/blob/master/doc/markdown/settings.md).

Therefore:

- label GRBL coordinates `controller estimate` or `emitted-step position`;
- do not call them measured or actual;
- receiving the same coordinate after reconnect does not restore physical trust;
- hard limit, uncontrolled reset during motion, motor-power loss, detected stall, manual movement, or gantry-side fault invalidates physical position.

### 7.3 “Closed loop” must name both loop and observer

| Topology | Loop closes at | Detects | Still blind to |
|---|---|---|---|
| Open-loop stepper | nowhere | emitted pulses only | stall, motor power, coupling, screw, table, TCP |
| Drive-closed stepper | motor encoder inside drive | rotor lag and possibly drive alarm/in-position | coupling, backlash, screw, table, TCP; host sees nothing if signals unwired |
| Controller servo with motor encoder | motor shaft and CNC | commanded-versus-motor error | mechanics after encoder and TCP error |
| Full-closed axis | linear scale/load | table position at scale line | Abbe/angular error, structure, spindle/tool/work motion |
| Independent metrology | external instrument/artifact | measured behavior at tested point/condition | untested volume, temperature, load, and later drift |

LinuxCNC's stepper documentation explicitly separates open-loop steppers, drive-internal closed-loop systems, alarm feedback, and controller-visible encoder feedback. Its `stepgen.position-fb` is a generated-pulse counter, not a motor sensor. Sources: [LinuxCNC stepper topology](https://linuxcnc.org/docs/html/integrator/steppers.html) and [HAL tutorial](https://www.linuxcnc.org/docs/html/hal/tutorial.html).

A machine pack needs both:

```ts
feedbackTopology:
  | 'open-loop'
  | 'drive-motor-encoder'
  | 'controller-motor-encoder'
  | 'controller-load-scale'
  | 'dual-loop';

hostObservability:
  | 'none'
  | 'alarm-only'
  | 'in-position-window'
  | 'motor-position'
  | 'load-position-and-following-error';
```

A “closed-loop stepper” connected only through step/direction with no alarm feedback is open-loop from KerfDesk's perspective.

### 7.4 Command, feedback, and following error

LinuxCNC exposes the mature separation:

- `joint.N.motor-pos-cmd`;
- `joint.N.motor-pos-fb`;
- `joint.N.f-error`;
- active following-error limit and tripped state;
- amplifier/drive fault input.

Its allowed error can grow with velocity from `MIN_FERROR` toward `FERROR`; exceeding the envelope disables motion/drive outputs. This avoids treating normal dynamic lag at high speed like stationary positioning error. Sources: [LinuxCNC motion pins](https://linuxcnc.org/docs/html/man/man9/motion.9.html) and [following-error configuration](https://linuxcnc.org/docs/html/config/ini-config.html).

But even a following-error number inherits its feedback topology. Motor feedback can be perfect while a coupling slips. Load-scale feedback can be perfect at the scale line while tool/work deflection changes the cut.

KerfDesk currently has one global `homingState` (`unknown | homing | confirmed`) and controller-reported position. It has no per-joint reference epoch, feedback source, following error, drive alarm, or gantry alignment state.

## 8. Homing, reference, limits, and gantry squaring

### 8.1 Homing is a bounded transaction

```text
unreferenced
-> preconditions
-> release active switch if permitted
-> fast search
-> controlled stop
-> backoff until released
-> slow latch
-> optional encoder-index search
-> assign home offset
-> final home move
-> joint/gantry validation
-> referenced(referenceEpoch)
```

Every phase needs maximum time/distance, expected input edges, drive-fault handling, and abort state. A switch already active must either be handled by a documented release move or fail before blind travel. A successful repeat should fall inside a configured window.

LinuxCNC supports switch search, slow latch, encoder index, absolute encoders, homing order, and synchronized final moves. Its `VOLATILE_HOME` concept explicitly drops reference when power is removed for axes that cannot retain trustworthy position. Source: [LinuxCNC homing configuration](https://www.linuxcnc.org/docs/2.8/html/config/ini-homing.html).

Homing proves a reference sequence completed. It does not prove pitch accuracy, backlash, squareness over travel, tool length, work location, fixture rigidity, or TCP accuracy.

### 8.2 Index and absolute encoders still need qualification

An incremental encoder index is one repeatable mark, not automatically a unique machine coordinate. A coarse switch commonly identifies the neighborhood before the index refines the latch.

Absolute/distance-coded feedback can reduce reference travel, but software must still prove:

- encoder identity/configuration;
- valid diagnostic bits;
- accepted encoder-to-machine offset;
- plausible position in the envelope;
- redundant-sensor agreement where present;
- no motion downstream of the sensor.

HEIDENHAIN distinguishes absolute, ordinary incremental, and distance-coded reference behavior. Source: [HEIDENHAIN encoder interfaces](https://www.heidenhain.com/fileadmin/pdf/en/01_Products/Prospekte/PR_Interfaces_ID1078628_en.pdf).

### 8.3 Hard and soft limits

- A hard limit is a physical input and stop request; it does not prove sufficient stopping distance before a mechanical crash.
- A soft limit is a coordinate constraint and only works while reference/configuration/position remain valid.
- Neither models holder, spindle nose, dust shoe, stock, clamp, fixture, rotary swept volume, or cable-chain collision.

Represent separately:

```text
machine travel envelope
kinematic joint envelope
scene collision envelope(tool + holder + spindle + fixture + stock)
```

For non-identity kinematics, even a legal Cartesian path can violate a joint limit; LinuxCNC documents that the motion layer must detect this during execution. Source: [LinuxCNC axis/joint limits](https://linuxcnc.org/docs/html/config/ini-config.html#_joint__section).

### 8.4 Dual-motor gantry squaring

Two motors receiving cloned steps are not two measured joints. Either side can stall independently.

True homing-based squaring requires:

- independently controlled motors during homing;
- one sensor per side;
- separate bounded search/latch evidence;
- calibrated switch offset defining square;
- maximum permissible side difference;
- synchronized return to coupled motion;
- invalidation after either drive fault/power loss, hard limit, manual racking, or unknown reset.

Upstream GRBL's optional dual-axis feature is designed for self-squaring with separate switches, shared axis settings, and a bounded second-switch search. Normal GRBL status still does not expose two measured side positions. Source: [GRBL dual-axis configuration](https://github.com/gnea/grbl/blob/master/grbl/config.h).

LinuxCNC represents gantry motors as separate joints during reference and supports synchronized final homing. Source: [LinuxCNC gantry component](https://linuxcnc.org/docs/html/man/man9/gantry.9.html).

## 9. Compensation, calibration, and uncertainty

### 9.1 Compensation is versioned calibrated state

Possible corrections include:

- scalar backlash;
- directional position-dependent screw/pitch maps;
- axis straightness and angular error;
- inter-axis squareness;
- kinematic/volumetric error;
- thermal growth;
- spindle/tool/probe offsets.

Compensation can reduce systematic error. It cannot repair loose bearings, unstable preload, cracked coupling, random missed steps, cutting-force deflection, stick-slip, or moving fixtures.

LinuxCNC supports scalar backlash or directional compensation maps and warns that compensation can create reversal acceleration demands. Source: [LinuxCNC compensation configuration](https://linuxcnc.org/docs/html/config/ini-config.html).

Bind every map to:

```text
machine and axis identity
reference method/epoch
feedback topology
units and direction convention
instrument/artifact identity and uncertainty
environment/temperature/load range
controller/kinematic configuration
map hash/version
independent verification result
```

Never enable a map before reference is valid or change it during a job.

### 9.2 A linear scale does not prove tool-center accuracy

Classic three-axis machine geometry includes axis positioning, straightness, angular, and inter-axis squareness errors. Sensor offset from the cutting line creates Abbe error:

```text
Abbe error = offset × sin(angular error)
```

The workpiece, spindle, holder, and tool also deflect. A scale can close one motion loop without eliminating volumetric/TCP error. Sources: [Renishaw QC20-W machine-error model](https://www.renishaw.com/media/pdf/en/093c4b638fb745e782b689880f7743e1.pdf) and [Abbe error definition](https://www.renishaw.com/en/laser-encoders-glossary--38615).

### 9.3 Thermal compensation needs live applicability evidence

Motor, spindle, cutting, and ambient heat change geometry. A thermal model requires sensor identity, freshness, plausible range, warm-up state, model version, uncertainty, and bounded fallback. A missing or implausible sensor must make the compensation unavailable rather than silently freezing the last value.

NIST treats thermal compensation as an in-process measurement/model problem with uncertainty, not a permanent constant. Source: [NIST thermal-deformation measurement and compensation](https://www.nist.gov/publications/process-optical-measurement-and-compensation-machine-tool-thermal-deformations).

## 10. Probe and independent metrology

### 10.1 Probe repeatability is not absolute accuracy

A probe has physical stylus radius plus electronic pretravel and direction-dependent behavior. Calibration needs known artifacts and must be tied to stylus, extension, orientation, speed/filter, and mount.

Store separately:

- raw trigger coordinates;
- calibrated/compensated measurement;
- repeated-touch spread;
- artifact and calibration revision;
- uncertainty;
- machine thermal/reference state.

Recalibrate after stylus change, remount, crash, suspicious repeatability, or interval expiry. Sources: [Renishaw machine-tool probe calibration](https://www.renishaw.com/media/pdf/en/16e3072937914b54968e8476692b76e4.pdf) and [probe pretravel behavior](https://www.renishaw.com/en/probe-operation--15811).

On-machine probing shares the machine's own geometric errors. It can repeat the same error and report a perfect feature. Independent measurement is required to separate machine geometry from process error. Source: [NIST process-intermittent inspection methodology](https://www.nist.gov/publications/methodology-compensating-errors-detected-process-intermittent-inspection).

### 10.2 Ballbar and laser answer different questions

A ballbar measures circular radial deviation in both directions and is highly effective for backlash, reversal spikes, servo mismatch, squareness, scale mismatch, stick-slip, and circular interpolation diagnosis. It is not a full absolute linear/volumetric map. Source: [Renishaw ballbar testing](https://www.renishaw.com/en/ballbar-testing-explained--6818).

A laser interferometer can measure traceable linear displacement and, with appropriate optics, angular error, straightness, and squareness. Environmental compensation matters. Correct workflow is baseline with compensation off, bidirectional measurement, map generation, application, and independent full remeasurement. Sources: [Renishaw XL-80](https://www.renishaw.com/en/xl-80-laser-system--8268) and [CARTO compensation workflow](https://www.renishaw.com/resourcecentre/download?data=121187&lang=en&userLanguage=en).

Qualification artifacts must retain raw readings, environment, instrument calibration, fixture/setup, controller configuration, compensation hash, uncertainty, and pass criteria.

## 11. Cutting-process physics

### 11.1 First-order milling equations

Sandvik's published metric relationships are a useful planning base:

```text
surface speed:       vc = pi * Dcap * n / 1000
feed per tooth:      fz = vf / (n * zc)
material removal:    Q  = ap * ae * vf / 1000
net cutting power:   Pc = ap * ae * vf * kc / (60 * 10^6)
cutting torque:      Mc = 30000 * Pc / (pi * n) = 9550 * Pc / n
```

where `Dcap` is effective cutting diameter at contact, `n` actual RPM, `zc` effective teeth, `ap` axial engagement, `ae` radial engagement, and `kc` material/chip-thickness-dependent specific cutting force. Sources: [Sandvik milling formulas](https://cdn.sandvik.coromant.com/files/sitecollectiondocuments/services/metal-cutting-e-learning/formulas-and-definitions/formulas-and-deinitions-for-milling-metric-enu.pdf) and [specific cutting force](https://www.sandvik.coromant.com/en-us/knowledge/materials/specific-cutting-force).

These equations predict a recipe; they do not observe the process. The physically relevant chip load is time-varying:

```text
fz_actual(t) = path_feed_actual(t) / (rpm_actual(t) * effective_teeth)
```

Consequences:

- controller corner slowdown at fixed RPM reduces chip thickness and can cause rubbing/heat;
- spindle bog at unchanged feed raises chip thickness and force;
- feed and spindle overrides change the process;
- runout creates unequal per-flute load even when average `fz` looks correct;
- short features may never reach programmed feed;
- a stationary cutter touching material repeatedly rubs the same surface.

For plastics and routers, chips carry heat out of the cut. Onsrud warns that low feed, corner dwell, and repeated rubbing can reweld plastic. Source: [Onsrud plastic-routing guidance](https://onsrud.com/articles/Fixturing-and-Routing-of-Plastics-with-CNC.asp).

### 11.2 Engagement and chip thickness

Feed per tooth is not identical to instantaneous chip thickness. In a simplified peripheral cut:

```text
h(phi) ~= fz * sin(phi)
engagement angle ~= acos(1 - 2 * ae / D)
```

- full slotting approaches 180-degree engagement;
- low radial engagement creates radial chip thinning;
- internal corners can spike engagement even with constant programmed stepover;
- too-thick chips overload the edge;
- too-thin chips create friction, heat, and wear.

Source: [Seco mechanical-load guidance](https://www.secotools.com/article/controlling_mechanical_loads_in_milling_operations).

An engagement-aware scheduler needs actual/represented stock intersection, cutter geometry, axial/radial engagement, runout, actual feed/RPM, machine power/torque, and compliance. Generic corner slowdown alone is insufficient: the controller may already slow for curvature/acceleration, and applying a second blind reduction can over-thin the chip.

Fusion exposes the professional pattern: Adaptive Clearing varies stepover to bound “Optimal Load,” minimum cutting radius avoids burying the tool in corners, feed optimization uses angle/radius/distance controls, and rest machining consumes prior stock state. Sources: [Fusion Adaptive Clearing](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/GUID09E44604-DAD8-47D6-ADC6-C100869DE724.htm), [2D Adaptive](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/2D-ADAPTIVE-READ.htm), and [corner feed optimization](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/GUIDEA850013-D826-408E-B076-C613834A77F3.htm).

### 11.3 Slotting versus adaptive/trochoidal roughing

Full slotting combines high engagement, force, heat, weak chip escape, and recutting. Trochoidal/adaptive roughing aims to use smaller radial engagement, deeper axial engagement, and smoothly changing tool-center motion.

Its success depends on:

- accurate stock state;
- radial-chip-thinning compensation;
- spindle torque/power;
- holder/tool rigidity;
- chip evacuation;
- machine acceleration and block throughput.

Seco explicitly notes that trochoidal milling needs adequate machine speed, torque, and acceleration because of its many small moves. Source: [Seco trochoidal slot milling](https://www.secotools.com/article/trochoidal_slot_milling).

On a low-acceleration GRBL router, a mathematically correct trochoid may never reach its scheduled feed. A simple curvature bound is:

```text
v <= sqrt(a_normal_max * radius)
```

Short triangular moves and planner starvation reduce it further. Offline process scheduling must intersect cutting limits with controller/machine dynamic limits.

### 11.4 Spindle power and torque are curves

The spindle model needs:

- minimum usable and maximum RPM;
- continuous/short-duration torque versus RPM;
- power/current/thermal duty;
- VFD/drive limits;
- actual-speed/load feedback;
- at-speed tolerance;
- permitted tool diameter and balance.

A cut can fit nominal kW while exceeding low-speed torque. Conversely, average spindle load may look safe while one flute or one corner is overloaded. Power is only one limit; chatter, tool/work deflection, holder load, evacuation, and controller dynamics may dominate.

### 11.5 Deflection and stickout

For a simplified cantilever tool:

```text
deflection proportional to F * L^3 / (E * D^4)
```

Small stickout changes matter enormously. Tool assembly identity must include cutter, holder/collet, gauge length, stickout, flute/cutting length, and condition. Deflection changes dimensions and remaining stock, then changes engagement on the next pass. Source: [open tool-deflection model](https://pmc.ncbi.nlm.nih.gov/articles/PMC6190321/).

### 11.6 Runout and per-edge load

Runout gives flutes different effective radii. One edge takes a larger chip and wears faster while another rubs. When runout approaches nominal chip thickness, average chip-load calculations become misleading, especially for small router cutters. Source: [Tamura and Matsumura runout study](https://doi.org/10.1016/j.procir.2017.03.268).

Tool qualification should record measured runout at a stated distance, holder/collet, torque/assembly method, and uncertainty.

### 11.7 Chatter is regenerative dynamics

Regenerative chatter occurs when one tooth leaves waviness that changes the chip of later teeth. Stability depends on:

- tool-holder-spindle-workpiece frequency response;
- cutting-force coefficients;
- radial/axial engagement;
- flute count/pitch;
- spindle speed;
- stickout and fixture/workpiece state.

A stability-lobe diagram maps stable depth/RPM regions. Reducing feed alone is not a universal fix; changing RPM, depth, engagement, stickout, or stiffness may be more effective. Foundational source: [Altintas and Budak, Analytical Prediction of Stability Lobes in Milling](https://doi.org/10.1016/S0007-8506(07)62342-7).

A tap-test/FRF and lobe model are configuration-specific and uncertain. Tool, holder, gauge length, workholding, temperature, and machine state changes invalidate reuse.

## 12. Entry, cutting direction, auxiliaries, and tool condition

### 12.1 Entry is a process transaction

Vertical plunge is valid only when the tool is center-cutting/drill-capable, axial cutting data permits it, chips can escape, the center path is clear, and spindle/Z thrust are adequate.

Professional CAM separates:

- predrill;
- plunge outside stock;
- linear/profile/zig-zag ramp;
- helix or tapered helix;
- entry lead;
- ramp feed and axial descent per revolution;
- minimum/maximum helix diameter;
- holder/shaft clearance.

Fusion warns that too-small helix diameters can create jerky motion, poor evacuation, and tool breakage. Source: [Fusion Adaptive entry reference](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/GUIDA73542E9-ED9C-4BD9-A87D-3A0ECA8BEB41.htm).

Invariant:

> If the requested entry cannot fit, block or require an explicit validated alternative. Never silently fall back to a vertical plunge.

### 12.2 The user's spindle-start example, stated exactly

A spindle may—and normally should—accelerate while XYZ is stationary if the cutter is proven clear of material. The dangerous state is spindle start/dwell while engagement is `engaged` or `unknown`.

```text
prove cutter clear
-> prove required dust/coolant/air ready
-> start spindle in free space
-> verify direction and at-speed or validated open-loop delay
-> move through proven-clear volume
-> deliberate entry using legal lead/ramp/helix/predrill
-> begin bounded-engagement cutting
```

“Move before spindle start” is not the invariant: dragging an unpowered cutter through stock can also break it.

### 12.3 Climb/conventional depends on the machine and pass

With M3 and a rigid, backlash-controlled setup, climb milling commonly gives thick-to-thin chips and less entry rubbing. Conventional starts near zero chip thickness and can rub before biting. Source: [Sandvik milling application guide](https://cdn.sandvik.coromant.com/files/sitecollectiondocuments/downloads/global/technical%20guides/en-gb/c-2920-034.pdf).

But direction depends on spindle direction, inside/outside/material side, backlash, rigidity, tool geometry, workholding, and rough/finish intent. KerfDesk's top-view M3 direction logic is a geometric convenience; the machine contract must prove spindle direction and process applicability.

Entry direction is separate. Rolling/tangential entry or reduced entry feed can build engagement gradually. Source: [Sandvik cutter path and chip formation](https://www.sandvik.coromant.com/en-us/knowledge/milling/cutter-path-and-chip-formation).

### 12.4 Auxiliaries are process preconditions

Each operation declares dust/coolant/mist/air/vacuum policy:

```text
required | optional | prohibited
feedback requirement
start timeout and stability interval
minimum flow/pressure
fault response
post-run delay
```

Examples:

- wood/MDF extraction affects fire, finish, chips, and workholding;
- plastic can reweld when chips remain or feed falls too low;
- a downcut cutter in a blind slot can pack chips;
- aluminium can weld onto the edge without suitable evacuation/lubrication;
- some insert/tool combinations prefer dry cutting and may suffer from intermittent coolant.

After interruption, chip condition is unknown until inspected or sensed. `chipPathClear` and `extractionReady` are recovery evidence, not assumptions.

### 12.5 Tool life and breakage

A useful tool-life record combines cutting time/distance, material-removal volume, material/operation, load distribution, coolant regime, entries, plunge/slot exposure, measured length/radius/runout, and inspections.

Haas Advanced Tool Management uses calls, holes, feed time, total time, maximum load, remaining life, and duplicate tools, while warning that load limits are unsuitable during rapid speed/feed changes. Source: [Haas Advanced Tool Management](https://www.haascnc.com/service/online-operator-s-manuals/mill-operator-s-manual/mill---operation.html).

A broken-tool event invalidates tool identity/offset, stock truth near and after the failure, affected operation completion, and possibly WCS/fixture/part. It is never repaired by loading a duplicate and resuming the next line.

## 13. Stock state, operation dependencies, and interrupted re-entry

### 13.1 Remaining stock is a first-class artifact

Professional systems support stock from setup geometry, prior operations/setups, bodies, or files; rest machining limits later paths to represented remaining material. Fusion and PowerMill expose these concepts explicitly. Sources: [Fusion setup stock](https://help.autodesk.com/view/fusion360/ENU/?guid=MFG-REF-SETUP-STOCK), [Fusion Adaptive rest machining](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/GUID09E44604-DAD8-47D6-ADC6-C100869DE724.htm), and [PowerMill stock models](https://help.autodesk.com/cloudhelp/2024/ENU/PWRM-ReferenceHelp/files/GUID-D10996C7-829C-4ABF-987B-DB70A58BAAFA.htm).

Represent:

```text
planned stock
committed stock after proven semantic operations
observed/measured stock, if any
uncertain removal volume after interruption
stock-confidence and workpiece-transform confidence
part/tab/vacuum attachment state
```

Normal CAM simulation assumes prior paths ran as simulated. That assumption is invalid after an ambiguous crash.

For a partial operation, a conservative upper bound can be:

```text
remainingStockUpperBound = initialStock - definitelyRemovedVolume
```

A recovery path generated against that superset will not encounter more stock than modeled only if reference, tool, fixture, and workpiece transform remain valid. Otherwise recovery is operator-supervised inspection/re-setup.

### 13.2 Operation DAG and immutable stock revisions

Each semantic operation should consume a stock revision and produce another:

```text
setup stock
-> roughing output stock
-> rest roughing output stock
-> semi-finish output stock
-> finish output stock
-> inspection result
```

Dependencies also include tool, datum, fixture, auxiliary, and metrology revisions. Editing an upstream operation invalidates downstream paths and predictions.

Representations can be hybrid:

- exact 2D polygon slices for pockets/profiles and engagement;
- heightfield for top-down relief;
- voxel/SDF or swept volume for general visualization/uncertainty;
- analytic features where exact geometry is available.

### 13.3 Recovery unit is semantic, not a line

```ts
type ProcessCheckpoint = {
  operationId: string;
  restartChunkId: string;
  programAndPostHash: string;
  toolAssemblyRevision: string;
  materialRevision: string;
  inputStockRevision: string;
  committedOutputStockRevision: string;
  uncertainStockDelta: unknown;
  workAndToolDatumEpochs: readonly string[];
  machineReferenceEpoch: string;
  requiredAuxiliaries: readonly string[];
  entryRecipe: string;
  processEnvelope: string;
  cutterClearEvidence: string;
};
```

Commit only after the semantic chunk completed, controller execution was fenced/drained, the cutter reached a defined clear pose, and no position/tool/process fault occurred.

| Operation | Defensible recovery unit | Unsafe shortcut |
|---|---|---|
| Profile | previous complete depth/contour, tangential re-entry from clear/waste side | blind plunge at interrupted XY |
| Pocket/adaptive | stock-aware recovery/rest operation with bounded engagement | slice remaining G-code |
| Full slot | predrilled/cleared entry or ramp through confirmed cleared slot | full-width plunge at frontier |
| Drilling | restart complete hole/peck after retract, chip clear, tool check | resume halfway down hole |
| Surfacing | previous complete lane, approach from outside stock | start while touching face |
| Relief finish | prior retract-linked pass with same qualified assembly | arbitrary XYZ line |
| V-carve/engrave | complete feature/contour because Z is geometry-coupled | line-number depth |
| Through-cut/tabs | only after attachment/tab/vacuum proof | assume freed part stayed fixed |

Public controller “run from line” features reconstruct modal/tool/offset state but cannot prove physical remaining stock. PathPilot exposes multiple lead-in modes; Haas scans prior state and restricts cutter-compensation restarts; SINUMERIK distinguishes block search with and without calculation. Sources: [PathPilot start-line modes](https://knowledgebase.tormach.com/1100m/pathpilot-tools-and-features-1100m), [Haas Setting 36](https://www.haascnc.com/service/codes-settings.type%3Dsetting.machine%3Dmill.value%3DS36.html), and [SINUMERIK block search](https://mall.industry.siemens.com/mall/collaterals/files/179/pdf/ENG_931336.pdf).

These are state-restoration patterns, not proof that an arbitrary physical restart is safe.

## 14. Adaptive feed and process telemetry

### 14.1 Offline and online optimization are distinct

Offline CAM can schedule:

```text
F_segment <= min(
  chip-thickness/tool limit,
  force/power/torque limit,
  deflection/chatter limit,
  engagement/evacuation limit,
  axis velocity/acceleration/jerk limit,
  controller block-rate limit
)
```

Online controller logic may then apply a bounded override from measured load or other signals.

LinuxCNC exposes `M52`/`motion.adaptive-feed` as a realtime scalar from 0 to 1 combined with ordinary feed override and programmed rate. It supplies the mechanism, not the machining algorithm. Source: [LinuxCNC M52 adaptive feed](https://www.linuxcnc.org/docs/2.7/html/gcode/m-code.html#mcode:m52).

### 14.2 Online load control requirements

Required properties:

- baseline by exact tool/material/operation;
- actual RPM and sensor freshness/plausibility;
- bounded override and slew rate;
- phase awareness for air, spindle acceleration, entry, cut, exit, and tool change;
- filtering without hiding severe spikes;
- overload/anomaly trips;
- safe fallback on frozen/missing sensor;
- no feed increase beyond offline process envelope.

Low load is ambiguous: it may mean air cutting, broken tool, missing stock, lost steps, or failed sensor. It must not automatically command more feed. A severe load spike must not reduce feed toward zero indefinitely because rubbing/heat can worsen.

Realtime adaptation belongs in controller/PLC motion time, not Electron/USB polling. KerfDesk may configure, log, visualize, and request a validated controller-owned adaptive contract.

### 14.3 Process telemetry

Synchronize:

- programmed/planned/commanded/measured feed;
- programmed/commanded/measured RPM;
- feed/spindle/rapid overrides;
- spindle power/current/torque/load and axis load;
- vibration/audio where qualified;
- auxiliary pressure/flow/state;
- tool/operation/stock revision;
- controller queue/execution state;
- monotonic timestamps.

Telemetry supports diagnosis and tool life. It does not retroactively prove cutter geometry, stock position, or part quality without calibration and inspection.

## 15. Required KerfDesk domain architecture

### 15.1 Controller target contract

```ts
type TrajectoryContract = {
  targetId: string;
  firmwareConfigHash: string;
  pathModes: readonly string[];
  defaultPathMode: string;
  axes: readonly AxisExecutionContract[];
  kinematicsId: string;
  plannerBlocks: number | null;
  rxBytes: number | null;
  interpolationPeriodSec: number | null;
  accelerationLaw: 'trapezoidal' | 'jerk-limited' | 'other' | 'unknown';
  junctionModel: string;
  arcModel: string;
  supportedFeedModes: readonly string[];
  overrideSemantics: string;
  sustainedBlockRateQualification: string | null;
};
```

This is negotiated/matched against the exact controller fingerprint. It is not inferred from “GRBL-compatible.”

Collision and limit analysis must include dynamic stopping/response allowance. A first-order trapezoidal lower bound is:

```text
stopping distance >= v^2 / (2 * available_deceleration) + v * total_latency
```

where latency includes controller/executor lead and input/safety-chain response. Jerk-limited motion needs a longer target-specific calculation. This dynamic envelope is separate from static bed bounds.

### 15.2 Tool assembly and cutting-data revision

```ts
type ToolAssemblyRevision = {
  id: string;
  cutterGeometry: string;
  materialAndCoating: string;
  nominalDiameterMm: number;
  measuredDiameterMm?: number;
  effectiveTeeth: number;
  fluteLengthMm: number;
  centerCutting: boolean;
  holderAndCollet: string;
  stickoutMm: number;
  gaugeLengthMm?: number;
  maxRampAngleDeg?: number;
  helixDiameterRangeMm?: readonly [number, number];
  plungeCapability: string;
  measuredRunoutMm?: number;
  condition: 'qualified' | 'worn' | 'suspect' | 'broken' | 'unknown';
  measurementRevision: string;
  cuttingDataRevision: string;
};
```

### 15.3 Machine process envelope

```ts
type MachineProcessEnvelope = {
  trajectoryContract: TrajectoryContract;
  feedbackTopology: string;
  spindlePowerTorqueCurve: string;
  spindleFeedback: string;
  holderSpindleEnvelope: string;
  auxiliaryCapabilities: readonly string[];
  rigidityOrQualificationClass: string;
  thermalStateRequirements: string;
  qualificationEpoch: string;
};
```

### 15.4 Operation process contract

```ts
type OperationProcessContract = {
  operationId: string;
  strategy: string;
  inputStockRevision: string;
  toolAssemblyRevision: string;
  materialRevision: string;
  geometricAndPathTolerance: string;
  engagementEnvelope: string;
  chipThicknessAndSurfaceSpeedTargets: string;
  powerTorqueDeflectionLimits: string;
  entryExitAndReentryPolicy: string;
  auxiliaryPolicy: string;
  checkpointPolicy: string;
  predictedActualProcess: string;
  qualificationState: 'qualified' | 'provisional' | 'invalid' | 'unknown';
};
```

### 15.5 Axis/reference/compensation truth

```ts
type AxisTruth = {
  axis: string;
  commandPosition?: number;
  controllerEstimate?: number;
  motorFeedback?: number;
  loadFeedback?: number;
  feedbackSource: string;
  feedbackFreshness: string;
  followingError?: number;
  driveFaults: readonly string[];
  referenceState: 'unknown' | 'homing' | 'referenced' | 'faulted';
  referenceEpoch?: string;
  limitState: string;
  compensationRevision?: string;
};
```

Separate gantry alignment and compensation truth carry their own epochs. The UI labels each coordinate by evidence source.

### 15.6 Stock revisions and uncertainty

```ts
type StockTruth = {
  plannedRevision: string;
  lastCommittedRevision: string;
  observedRevision?: string;
  uncertainRemovalVolume?: string;
  confidence: 'planned' | 'execution-fenced' | 'measured' | 'uncertain';
  workpieceTransformEpoch: string;
  attachmentState: 'proven' | 'operator-confirmed' | 'unknown';
};
```

Never serialize a preview grid as “what the machine has cut” without an execution/measurement provenance label.

## 16. Fault taxonomy and evidence invalidation

### 16.1 Trajectory faults

- unsupported/mismatched path mode;
- axis constraint or kinematic joint violation;
- planner starvation;
- block-rate overflow;
- arc/tessellation error;
- controller configuration change;
- override outside process envelope;
- unexpected stop/blend at semantic boundary.

Invalidate predicted timing/process and possibly operation completion.

### 16.2 Drive/mechanical faults

- hard limit or uncontrolled stop;
- open-loop lost steps;
- following error;
- drive/encoder/amplifier fault;
- coupling/screw slip;
- gantry side divergence;
- gravity-axis drift;
- manual movement/motor release;
- compensation or reference change.

Invalidate affected axis reference/position, gantry alignment, stock transform, operation completion, and automatic recovery.

### 16.3 Cutting-process faults

- spindle not at speed/direction wrong;
- torque/power overload or unexpected load loss;
- chatter/vibration outside qualified band;
- chip evacuation/coolant/extraction failure;
- cutter wear, pull-out, breakage, or runout change;
- fixture/workpiece movement;
- part/tab/skeleton release;
- unknown engagement during interruption.

Invalidate tool, stock, fixture, and operation evidence according to the fault—not merely the current G-code line.

## 17. Verification and certification program

### L0 — formula, unit, and property tests

- dimensional/formula cases against published references;
- commanded/achieved chip-load separation after every feed/RPM/axis cap;
- actual-flute versus assumed-flute mismatch;
- per-axis vector velocity/acceleration constraint properties;
- path tolerance and rounding composition;
- radial engagement/corner fixtures;
- deflection `L^3/D^4` scaling;
- homing/reference/compensation event permutations;
- no state transition can increase evidence after reconnect/fault without a qualifying transaction.

### L1 — CAM/process golden corpus

- full slot and low-engagement adaptive path;
- internal corner near cutter radius;
- tiny contour shorter than requested ramp;
- legal/illegal helix and predrill alternatives;
- narrow/deep pocket and holder collision;
- thin wall and long stickout;
- ball/V/flat tool contact geometry;
- multi-tool rest machining with correct per-operation kernel;
- partial/uncertain prior stock;
- tabbed through-cut and freed part;
- low-acceleration, low-block-rate machine.

Required invariants:

- no implicit plunge fallback;
- no claimed chip load inconsistent with actual commanded pair;
- engagement stays inside operation contract;
- re-entry stays in proven-clear volume until deliberate engagement;
- every stock mutation produces an immutable revision;
- no predicted state is labelled measured.

### L2 — exact-controller differential tests

For each fingerprinted target:

- parse/check the final program;
- compare host and target block/path interpretation;
- stress native arcs versus linearized equivalents;
- measure block throughput and planner-starvation behavior;
- vary feed/rapid/spindle overrides;
- test axis-specific limits and simultaneous XYZ;
- verify exact-stop/path/blend semantics;
- capture command/status/step traces.

The generic host estimator cannot certify another target's trajectory.

### L3 — multi-frontier virtual plant

Independently model:

```text
program blocks
controller RX/parser/planner/executor
commanded joint motion
generated steps or servo setpoints
motor feedback
load/table feedback
tool-center/fixture/work transform
stock removal and tool condition
```

Inject stall, coupling slip, gantry racking, encoder freeze, following error, controller starvation, spindle load loss, tool breakage, fixture movement, and ambiguous interruption. An upstream state must never be promoted across a deliberately inserted downstream fault.

### L4 — electrical/controller bench

Use exact controller/drives/motors with controlled USB/power/reset, home/limit/index/drive-fault injection, independent encoder/step capture, dummy spindle/VFD load, and monotonic UART/logic traces.

Cover:

- reset during every homing phase;
- stuck/missing/bouncing switch and index;
- motor/drive enable loss;
- alarm feedback disconnected;
- following error around threshold;
- planner starvation by every supported transport;
- at-speed/load/auxiliary sensor freeze/fault;
- host and controller power-loss combinations.

### L5 — machine air-cut and loaded dynamics

- independently measure actual feed/position/RPM;
- block an open-loop axis to prove lost-step detection policy;
- overload closed-loop drive and verify latched alarm;
- slip coupling downstream of motor encoder;
- rack gantry and re-square;
- validate hard-limit stopping margin;
- trace commanded versus measured motion at corners/microsegments;
- perform cold/warm homing repeatability runs;
- test vibration/FRF and safe acceleration bounds.

### L6 — cutting and interrupted-process tests

Use sacrificial material and instrument actual RPM/feed/load/auxiliaries. Inject interruption during clear approach, spindle acceleration, ramp/helix, slot, internal corner, adaptive path, tool-buried state, retract, chip failure, load-sensor failure, and tool breakage.

Release invariants:

```text
M3/M4 forbidden when engagement is engaged or unknown
automatic retract forbidden when a stopped cutter may be buried
cutting entry forbidden until spindle-at-speed policy is satisfied
restart forbidden without tool/datum/reference/stock/fixture evidence
online override never exceeds offline process envelope
sensor failure cannot increase feed
```

### L7 — metrology qualification

- at least 30 home cycles per axis/gantry side across cold/warm states;
- ballbar at multiple radii, planes, directions, and feeds;
- laser/interferometric bidirectional axis measurement;
- angular/straightness/squareness measurement;
- probe calibration against known artifacts;
- compensation disabled baseline, application, and independent remeasurement;
- representative part inspection independent of the CNC.

Retain raw data, environment, instrument calibration, uncertainty, app/controller/profile/compensation hashes, tool assembly, operator, and pass criteria.

## 18. KerfDesk priorities from this tranche

### P0 — preserve existing recovery P0s

1. Keep automatic acknowledged-line CNC checkpoint resume disabled.
2. Fix normal multi-tool continuation so cutter clearance is proven before spindle start/dwell after re-zero.
3. Never automatically spin or retract a cutter whose engagement is unknown.

### P0 — new process-correctness findings

1. Remove the silent ramp-to-vertical-plunge fallback; block or select an explicitly legal entry.
2. Do not display target chip load after feed capping as if it were achieved. Coordinate feed/RPM within the envelope or diagnose failure.
3. Remove “safe” language from unqualified provisional material recommendations and bind every applied recipe to persisted assumptions.
4. Never label GRBL `MPos` actual/measured position; invalidate reference/position after the applicable hard-limit, reset, drive-power, stall, or gantry fault.

### P1

1. Add exact target trajectory contracts: axes, kinematics, path mode, planner depth, acceleration/jerk, arc model, overrides, and block-rate qualification.
2. Replace scalar CNC feed/acceleration decisions with per-axis/vector constraints including Z.
3. Replace the global homing flag with per-joint reference epochs and typed invalidation.
4. Add feedback topology, drive fault, following error, gantry alignment, and compensation provenance.
5. Expand `CncTool` into a qualified assembly with effective teeth, stickout, holder, center-cutting/entry limits, length, runout, condition, and cutting-data revision.
6. Add separate target versus achieved chip load/surface speed/MRR/power estimates with uncertainty and staleness.
7. Add immutable operation and stock revisions; mark planned versus execution-fenced versus measured state.
8. Fix multi-tool removal preview to use the tool attached to each operation.
9. Label ETA as a target-specific estimate and model emitted XYZ, per-axis limits, process fences, and overrides.

### P2

1. Add stock/engagement-aware adaptive and rest machining before online adaptive feed.
2. Add first-class entry/link/lead/re-entry strategies with geometry/process validation.
3. Add controller-owned adaptive-feed contracts and synchronized process telemetry.
4. Build the multi-frontier virtual plant and physical HIL fixtures.
5. Establish homing, ballbar, laser, probe, spindle, and loaded-cut qualification bundles.

## 19. Verification performed for this tranche

Current-source audit covered:

```text
src/core/controllers/grbl/parse-settings.ts
src/core/controllers/grbl/status-parser.ts
src/core/cnc/compile-cnc-job.ts
src/core/cnc/feeds-calculator.ts
src/core/cnc/motion-polish.ts
src/core/cnc/pocket-paths.ts
src/core/job/estimate-duration.ts
src/core/job/planner.ts
src/core/job/toolpath.ts
src/core/output/cnc-grbl-strategy.ts
src/core/preflight/cnc-preflight.ts
src/core/scene/machine.ts
src/core/sim/removal-grid.ts
src/core/sim/stamp-toolpath.ts
src/core/sim/tool-kernels.ts
src/ui/layers/CncMaterialRow.tsx
src/ui/layers/FeedsCalculatorRow.tsx
src/ui/laser/cnc-machine-limit-warnings.ts
src/ui/state/laser-home-action.ts
src/ui/state/laser-store.ts
src/ui/workspace/use-cnc-removal-grid.ts
```

Focused verification:

```text
13 test files passed
143 tests passed
Prettier check passed
```

The tests prove current functions match their encoded contracts. Several findings are exactly those contracts—the short-ramp vertical fallback and feed capping are tested/intentional behavior—not accidental test failures. The tests do not prove controller trajectory, physical position, chip load, stock removal, or machine accuracy.

## Final rules

```text
programmed feed != achieved feed
programmed path != controller trajectory
controller position != measured table position
measured table position != tool/work relative position
target chip load != actual chip load
planned stock != actual remaining stock
homed != geometrically accurate
closed-loop != host-observable
low spindle load != safe air cutting
line restored != process restored
```

KerfDesk should expose which side of each inequality it knows, the evidence source and timestamp, the model/uncertainty used for prediction, and the exact events that invalidate it.
