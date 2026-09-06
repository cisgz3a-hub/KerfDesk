> **Historical research archive: 11–13 July 2026.** Published on 6 September 2026.
> Findings, scores, source claims and proposed changes below describe their recorded
> baseline; they have not been revalidated and are not current product or qualification
> evidence. Unimplemented proposals are not adopted policy. The current
> [Frame-first contract](../../PROJECT.md) governs application behaviour. See the
> [archive index](2026-09-06-preserved-audits.md) and [source manifest](2026-09-06-preserved-audits-source-manifest.json).

# CNC Cutting Mechanics, Tooling, and Process Intelligence Deep Research

Date: 2026-07-13
Scope: chip formation, cutter engagement, spindle torque and power, force and deflection, runout, chatter, entry strategy, tool holding, chip evacuation, tool wear and breakage, material-specific planning, and implications for KerfDesk
Method: primary manufacturer data, public control/CAM documentation, manufacturing research, and current-source audit of `C:\Users\Asus\LaserForge\audit-current-main`

## Executive verdict

A feeds-and-speeds number is not a property of a material name or a cutter diameter. It is the result of a particular system:

```text
workpiece material and condition
+ cutter geometry and cutting edges
+ holder, collet, stickout, runout, and balance
+ radial/axial engagement and entry/link strategy
+ spindle torque/power versus actual RPM
+ machine/fixture/tool-point stiffness and dynamics
+ coolant, air, extraction, and chip recutting state
= one qualified process envelope
```

Change one term and the old recipe may no longer be valid. This is why production CAM systems, tool vendors, and CNC controls do not treat `feed`, `RPM`, and `depth per pass` as five independent text boxes. They bind cutting data to a tool assembly, material class, operation, engagement, machine capability, and evidence or provenance.

KerfDesk has valuable geometric foundations, but its present CNC process model is not yet capable of making a physical safety claim. Its tool record contains only identity, kind, diameter, and optional V angle. Its beginner material action assumes two flutes. Its calculator can preserve a displayed target chip load after silently capping feed. A single layer-level recipe is reused for different primary, clearing, and finishing tools. Pocket and relief paths are geometric offsets rather than engagement-controlled paths. Ramp requests may finish with an undeclared vertical plunge. The preview proves planned swept volume at coarse resolution, not force, power, deflection, chatter, chip evacuation, actual stock, or tool condition.

The most important newly confirmed product findings are:

1. **Auxiliary tools inherit the wrong process recipe.** A layer can use a primary bit, a V-carve clearing bit, and a relief finishing bit, but owns only one feed/plunge/RPM/depth/stepover tuple. The compiler applies it unchanged to each tool.
2. **The V-carve "flat" clearing selector accepts non-flat tools.** It excludes only V-bits, so ball-nose and engraving tools can be selected for a stage whose algorithm and label assume a flat clearing cutter.
3. **Drilling has no drill model.** Any tool kind can be used for a drill operation; center-cutting capability, drill diameter, point geometry, flute length, peck limit, feed per revolution, coolant, breakthrough, and chip-packing rules do not exist.
4. **Surfacing is an unqualified standalone recipe.** It uses fixed 2500/600 mm/min, 0.5 mm depth/pass, 40% stepover, and the machine's maximum spindle RPM for every active tool and material. It bypasses the normal job/preflight model, and its current preamble starts the spindle before lifting from Z0.
5. **Ramp capability is disconnected from the tool.** The UI allows up to 45 degrees for every tool; the generator does not know maximum ramp angle, center-cutting capability, flute length, or chip-clearance requirements, and silently finishes a too-short ramp with a vertical descent.
6. **The removal preview is not process simulation.** It uses a single active-tool kernel across the whole job, ignores per-operation tool identity, and contains no feed, RPM, engagement, force, thermal, tool-life, or remaining-stock evidence.

The architectural answer is not a giant universal formula. It is a staged process-intelligence system that reports what is known, what is assumed, what is calculated, what has been tested, and what remains unqualified.

## 1. Relationship to the prior motion/process dossier

The earlier `2026-07-13-cnc-motion-control-drive-process-and-metrology.md` established the four-layer distinction among CAM intent, controller trajectory, mechanical response, and cutter/material interaction. It also established the high-level feed, material-removal, power, deflection, runout, chatter, entry, stock, and adaptive-control gaps.

This tranche goes deeper in three ways:

- it states the exact assumptions behind the useful equations;
- it maps tool, operation, material, and spindle capability into software entities and invalidation rules;
- it audits multi-tool recipes, drilling, surfacing, relief finishing, entry, and preview behavior that a simple feeds calculator cannot qualify.

## 2. The minimum arithmetic and what each result means

Sandvik Coromant's milling definitions provide the baseline relationships:

```text
table feed:          vf = fz * n * zc
feed per tooth:      fz = vf / (n * zc)
cutting speed:       vc = pi * Dcap * n / 1000
material removal:    Q  = ap * ae * vf / 1000
net cutting power:   Pc = ae * ap * vf * kc / (60 * 10^6)
cutting torque:      Mc = Pc * 30,000 / (pi * n)
```

where:

- `vf` is table feed in mm/min;
- `fz` is commanded feed per effective tooth in mm/tooth;
- `n` is actual spindle speed in rpm;
- `zc` is the number of effective teeth participating in the cut;
- `Dcap` is effective cutting diameter at the cutting depth, not always nominal shank diameter;
- `ap` is axial depth of cut in mm;
- `ae` is radial width of cut in mm;
- `Q` is removed volume in cm3/min;
- `kc` is material/process-specific cutting force in N/mm2;
- `Pc` is net cutting power in kW;
- `Mc` is cutting torque in Nm.

Source: [Sandvik Coromant, milling formulas and definitions](https://cdn.sandvik.coromant.com/files/sitecollectiondocuments/services/metal-cutting-e-learning/formulas-and-definitions/formulas-and-deinitions-for-milling-metric-enu.pdf).

These are necessary, not sufficient. Each formula has an evidence boundary:

| Quantity | What software may calculate | What it must not silently assume |
| --- | --- | --- |
| `fz` | command-derived feed per effective tooth | actual chip thickness, equal tooth loading, or stable cutting |
| `vc` | surface speed at an effective diameter | constant surface speed over a ball or V tool |
| `Q` | nominal rectangular engagement volume | actual stock engagement through corners, islands, prior cuts, or runout |
| `Pc` | first-order net cutting power | motor input power, low-speed spindle availability, transient peak, or thermal duty |
| `Mc` | first-order cutting torque | available spindle torque after drive, belt, efficiency, and RPM limits |

The UI should use names such as `commandedFeedPerTooth`, `estimatedMaxChipThickness`, and `estimatedNetCuttingPower`, not the unqualified words "chip load" and "power".

## 3. Commanded feed per tooth is not chip thickness

### 3.1 Effective teeth, not catalog flute count

The textbook equation uses effective teeth `zc`. Catalog flute count can differ from effective teeth when:

- runout loads one edge more than another;
- a ball/V/tapered geometry engages different radii along the edge;
- chip packing prevents an edge from cutting freely;
- an insert or flute is damaged;
- a multi-edge tool is used in a narrow or partial engagement;
- the actual spindle speed droops under load;
- the controller clamps table feed below the command.

Software should preserve both catalog flute count and qualified effective tooth count. If only nominal flutes are known, the result is a recommendation with lower confidence.

### 3.2 Radial chip thinning

For a 90-degree peripheral end mill with radial engagement `ae <= D/2`, zero runout, constant feed, and the usual circular tooth path, the maximum chip-thickness factor can be written:

```text
phi_e = arccos(1 - 2*ae/D)
h_max = fz * sin(phi_e)
      = fz * sqrt(1 - (1 - 2*ae/D)^2)
```

At `ae = 0.1D`, `h_max` is only `0.6 * fz`. A recipe that blindly preserves `fz` at low radial engagement may rub rather than form the intended chip. Conversely, compensating feed for chip thinning and then entering a slot or internal corner without reducing feed can create a large load spike.

The expression above is not universal. Lead angle, cutter shape, helix, runout, tool deflection, climb/conventional direction, and `ae > D/2` change the result. The software contract must name the model used.

Sandvik explicitly treats chip thickness as a function of feed per tooth and engagement/approach angle, and notes that low radial engagement reduces chip thickness: [application guidance](https://cdn.sandvik.coromant.com/files/sitecollectiondocuments/downloads/global/technical%20guides/en-gb/c-2920-034.pdf) and [chip-thinning overview](https://go.sandvik.coromant.com/saam-us-2108-wbn-chip_thinning_LP-Registration.html).

### 3.3 Internal corners and slot transitions

A constant stepover value does not imply constant engagement. An offset pocket path can move from a light side cut into:

- a full-width slot;
- a concave corner with a much larger engagement arc;
- a narrow channel where previous rings leave more stock than expected;
- an island neck or cusp;
- uncut stock after a missing or interrupted earlier pass.

The same feed can therefore move from reasonable to overload while every layer setting remains numerically unchanged. Engagement-controlled roughing solves this by deriving a path from evolving stock and a maximum engagement objective, not by merely spacing offsets at a percentage of diameter.

### 3.4 Minimum chip thickness and rubbing

At small scale, the cutting edge radius is not negligible relative to commanded chip thickness. Below a tool/material-dependent minimum, the edge ploughs or rubs before it shears. Heat, force, work hardening, poor finish, and rapid wear can increase even while nominal `fz` decreases. This is why "slow it down" is not a universal safe response and why runout becomes especially important on small cutters.

KerfDesk currently has no edge radius, minimum chip-thickness model, actual RPM, or runout. Its smallest-band recommendation should remain explicitly provisional until those data exist.

### 3.5 Maximum versus average chip thickness

Tool data may target maximum chip thickness `h_max` or average chip thickness `h_m`; they are not interchangeable. Under the same ideal 90-degree peripheral assumptions and engagement angle `theta`:

```text
h_max = fz * sin(theta)                    when theta <= pi/2
h_max = fz                                 when theta > pi/2
h_mean = fz * (1 - cos(theta)) / theta
```

Preserving a target maximum at low engagement uses `fz = h_target/sin(theta)`. Preserving a target average uses `fz = h_mean_target*theta/(1-cos(theta))`. Applying one compensation to data specified in the other convention can overload a cutter. The recipe schema must store which chip-thickness definition the source uses.

### 3.6 Mechanistic force model

A higher-fidelity milling model divides each engaged flute into axial slices and separates shear/cutting from edge/ploughing force:

```text
dFt = (Ktc*h + Kte) * dz
dFr = (Krc*h + Kre) * dz
dFa = (Kac*h + Kae) * dz
```

The `K*c` terms normally have units of N/mm2; the `K*e` edge terms have units of N/mm. Each slice is transformed from tangential/radial/axial coordinates into machine coordinates and summed over engaged teeth. This exposes facts hidden by a mean `kc` model:

- force remains as nominal chip thickness approaches zero because the edge still rubs/ploughs;
- force coefficients depend on cutter geometry, rake, edge preparation, coating, material, speed, coolant, and wear;
- helix causes different axial slices to enter at different angular phases;
- force and torque are tooth-periodic, so peak load can fail while average power passes;
- coefficients need calibrated tool-material tests and uncertainty, not a universal material constant.

An open derivation and wear-monitoring application is available in [Milling Tool Wear Monitoring via Multichannel Cutting Force Coefficients](https://www.mdpi.com/2075-1702/12/4/249). A public study implementation, [leekunhwee/ForceCalculation](https://github.com/leekunhwee/ForceCalculation), demonstrates entry/exit geometry, axial slicing, helix lag, six-coefficient forces, coordinate transforms, torque, and coefficient identification. It is useful for study but has no declared reusable license and lacks runout, minimum-chip, compliance, evolving-stock, and spindle-envelope models.

### 3.7 Exact chip geometry when the sine model fails

`h = fz*sin(phi)` assumes feed is small relative to radius, circular tooth paths, equal pitch/radius, rigid geometry, no runout, and a surface left by the immediately preceding tooth. The actual tooth path is trochoidal. With micro-tools, high feed-to-radius ratio, unequal pitch, or significant runout, chip thickness is the positive normal distance from the current cutting edge to the complete previously swept stock envelope.

Published micro-milling work reports material error in the circular approximation as `fz/R` becomes large and shows that one unloaded tooth can leave accumulated stock for a later tooth. KerfDesk should keep the sine model as a transparent low-cost estimate, then switch to swept-envelope analysis when the tool/process falls outside its stated validity.

## 4. Surface speed and effective cutting diameter

For a square end mill, nominal diameter is often an acceptable first-order `Dcap`. It is not for every tool:

- a ball nose cuts at a diameter that varies with axial contact; surface speed approaches zero at its tip;
- a V-bit's cutting radius changes continuously with depth;
- an engraving tool may have a tiny effective diameter at the programmed depth;
- a tapered or chamfer tool has depth-dependent diameter;
- tool wear and runout change the effective swept radius.

This matters directly to relief finishing. KerfDesk calculates ball-nose scallop spacing geometrically, but uses the same layer spindle/feed recipe for rough and finish tools and contains no effective-diameter or tilt/contact model. A nominal 6 mm ball tool at 12,000 rpm does not imply the same cutting speed at its center as at its equator.

A future process evaluator should calculate a range:

```text
effectiveDiameterRange(operation, tool, contactGeometry)
surfaceSpeedRange(actualRpm, effectiveDiameterRange)
```

and warn when a tool path rides too near a ball tip or V apex for the qualified recipe.

## 5. Material-removal rate, spindle torque, and power

### 5.1 A maximum RPM is not a spindle capability model

KerfDesk stores only `spindleMaxRpm` and spin-up time. That cannot answer:

- minimum controllable/stable cutting speed;
- continuous and intermittent torque versus rpm;
- continuous and peak power;
- overload duration and thermal duty;
- commanded versus measured RPM under load;
- VFD/current/drive limit state;
- whether clockwise direction and actual speed are confirmed;
- whether the router is manual-speed, relay-only, PWM-scaled, or closed-loop.

For many routers and VFD spindles, available torque and cooling are strongly speed dependent. A feed/RPM solver must compare required torque/power against curves at the proposed speed, including a margin, rather than against a single nameplate maximum.

### 5.2 Process capacity check

A useful first-order offline evaluation is:

```text
requiredPower = model(ap, ae, vf, materialSpecificCuttingForce)
requiredTorque = requiredPower * 30,000 / (pi * rpm)

powerMargin = availableContinuousPower(rpm) - requiredPower/efficiency
torqueMargin = availableContinuousTorque(rpm) - requiredTorque/efficiency
```

The result should be `qualified`, `warning`, `over-capacity`, or `unknown`. Unknown material coefficients or spindle curves must not collapse to green.

### 5.3 Acceleration and transient engagement

The arithmetic assumes steady cutting. Short segments may never reach programmed feed, while corners and entry transitions create transient forces. Actual chip formation depends on controller acceleration, path blending, and spindle speed under load. Offline process prediction therefore needs the emitted controller trajectory or a conservative bound, not only geometric path length.

### 5.4 Continuous, intermittent, and peak limits

Spindle feasibility needs multiple checks:

```text
mean cutting power <= continuous S1 power at RPM
thermal duty <= applicable intermittent/S6 envelope
peak tooth torque <= drive/motor/spindle/holder peak limit
cutting torque + acceleration torque + friction <= available motor torque
```

Below base speed, many motor/spindle systems are approximately constant torque, so available power falls with speed. Above base speed they are commonly approximately constant power, so available torque falls as `9550*P/n`, until further electrical/mechanical limits intervene. Peak or acceleration current is not a continuous cutting rating. Belt/gear ratio, efficiency, drive limits, cooling, and duty all matter.

Mean MRR power cannot expose tooth impact, runout overload, bending force, or chatter. The process evaluator should retain both mean and peak estimates and state whether the spindle curve is manufacturer-declared, measured, or unknown.

## 6. Force, deflection, and dimensional error

A first-order cutter-as-cantilever estimate is:

```text
delta = F * L^3 / (3 * E * I)
I = pi * D^4 / 64
```

where `F` is lateral cutting force, `L` is unsupported length, `E` is elastic modulus, and `I` is the second moment for a solid circular section.

This equation exposes the dominant scaling:

- deflection grows with the cube of stickout;
- it falls roughly with the fourth power of diameter;
- flute relief makes a real cutter less stiff than a solid cylinder;
- holder, collet, spindle, gantry, fixture, and workpiece compliance add to the loop;
- cutting force varies with engagement and chip thickness.

The correct software entity is therefore a **tool assembly**, not a cutter diameter. It needs measured or declared stickout, gauge length, holder/collet, flute length, neck diameter, and preferably an assembly compliance or tool-point frequency-response reference.

This is not only a surface-finish concern. Deflection changes engagement and chip thickness, can pull a tool into climb-cut material, creates wall taper, and can drive regenerative chatter.

## 7. Runout, balance, holding, and pull-out

### 7.1 Runout changes tooth loading

Spindle error motion, taper/holder condition, collet contamination, cutter shank error, and assembly alignment all contribute to tool-tip runout. When runout is significant relative to feed per tooth, one edge can carry most of the cut while another rubs. Nominal flute count then overstates effective teeth and understates the peak chip per loaded tooth.

Haas identifies damaged holders and excessive end-mill runout as causes of finish and spindle problems and gives a service check of 0.0003 in (0.0076 mm) maximum tool runout in its troubleshooting context: [Mill spindle troubleshooting guide](https://www.haascnc.com/service/troubleshooting-and-how-to/troubleshooting/mill---spindle---troubleshooting-guide.html). A separate Haas taper-maintenance procedure gives a taper TIR limit of 0.0002 in (0.005 mm): [spindle taper maintenance](https://www.haascnc.com/service/troubleshooting-and-how-to/how-to/vmc---spindle---taper---maintenance.html).

These are machine-specific service references, not universal acceptance limits. Software should store the machine/tool-assembly requirement and measured result with instrument, timestamp, temperature, and setup.

### 7.2 Balance is an assembly property

At high speed, balance applies to the holder, collet/nut, cutter, and installed position as an assembly. Haas requires balanced tooling of grade G2.5 or better for its 10,000-rpm-and-above warm-up guidance and warns not to exceed tooling recommendations: [spindle run-in and warm-up programs](https://www.haascnc.com/service/troubleshooting-and-how-to/reference-documents/mill---spindle---programs--run-in--warm-up--break-in-.html).

The application must not infer safe RPM from cutter diameter alone. A tool assembly needs:

- holder/interface and collet/nut identifiers;
- balanced grade and maximum qualified RPM;
- cutter stickout and orientation witness if balance depends on assembly position;
- shank engagement and clamping procedure;
- holder/cutter vendor limits;
- runout measurement and date;
- condition/invalidation after crash, slip, tool change, or disassembly.

### 7.3 Pull-out and axial force

Helix angle, ramping, plunging, and aggressive slotting create axial load. Collet condition, shank engagement, holder style, torque, contamination, and tool geometry determine pull-out resistance. A software process envelope should include a qualified maximum axial load or a conservative operation restriction. It should invalidate the assembly after suspected slip or crash rather than merely asking whether the same tool ID is selected.

### 7.4 The complete assembly owns the RPM limit

The allowed RPM is the weakest-link intersection:

```text
rpmAllowed = min(
  machine limit,
  spindle limit,
  cutter limit,
  holder limit,
  collet/nut limit,
  pull-stud/retention limit,
  extension/adapter limit,
  assembly balance qualification,
  recipe/process-media limit
)
```

A bare `G2.5` label is not enough. Store residual unbalance or the exact qualified RPM, assembly configuration, certificate, and applicable standard. Any component change or reseating can invalidate the result. [ISO 16084](https://www.iso.org/standard/68452.html) addresses maximum rotational speed and residual unbalance for rotating tool systems; BIG DAISHOWA explains why balance grade without the complete-system context can mislead in its [ISO 16084 balancing paper](https://www.bigdaishowa.com/sites/default/files/2020-03/BIG%20KAISER%20Balancing%20According%20to%20ISO%2016084.pdf).

### 7.5 Runout and clamping measurements need context

A TIR value is incomplete without measurement distance, method, orientation, temperature, and repeated-seating result. SCHUNK's published `<= 0.003 mm` precision-collet value, for example, is stated at `2.5 x D` and under its defined assembly conditions: [SCHUNK ER25 example](https://schunk.com/no/en/tools/toolholder-quickfinder/er-precision-collet-chuck/er-25-p-cat-40x4-/p/000000000001349018).

Insertion and torque are also component-specific. REGO-FIX generally calls for at least two-thirds collet engagement, while Onsrud publishes a different routing-system recommendation. This proves the data model needs manufacturer instructions and applied-torque evidence, not one global percentage or torque. Too little can permit slip/pull-out; too much can damage components and worsen runout.

### 7.6 Tool data exchange should separate item from assembly

[ISO 13399-1](https://www.iso.org/standard/36757.html) establishes a common model/dictionary approach for cutting-tool data, with separate concepts for cutting items, tool items, adaptive items, and assemblies. KerfDesk should mirror that separation even if it does not initially implement the full standard. A catalog cutter, a physical cutter asset, a holder/collet set, and one measured installed assembly version are different objects with different lifecycle and invalidation rules.

## 8. Chatter and stability lobes

Chatter is not simply "too much feed." Regenerative chatter couples the waviness left by one tooth pass to the next tooth's chip thickness. Stability depends on:

- tool/holder/spindle/machine/workpiece frequency response at the cutting point;
- spindle speed and tooth-passing frequency;
- axial depth and radial immersion;
- cutting force coefficients for the tool/material/process;
- tool geometry, pitch, helix, and overhang;
- direction-dependent structural dynamics and fixture state.

The classic Altintas/Budak analytical model requires structural transfer functions, cutting coefficients, radial immersion, and tooth count; it predicts chatter-free axial depth versus spindle speed. NIST similarly describes stability lobes as maximum chatter-free axial depth versus spindle speed and shows that tool-holder-spindle dynamics and tool overhang change the result: [NIST repeatability study](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=823028) and [tool-length-dependent stability surfaces](https://www.nist.gov/publications/tool-length-dependent-stability-surfaces).

### 8.1 Regenerative-delay model

For tooth interval `T = 60/(n*Z)`, the dynamic part of chip thickness contains the displacement difference between the present tool/work state and the waviness left one tooth earlier:

```text
hd,j(t) = [x(t)-x(t-T)]*sin(phi_j)
        + [y(t)-y(t-T)]*cos(phi_j)
```

The structural system becomes a time-periodic delay differential equation:

```text
M*q_ddot + C*q_dot + K*q
  = F(q(t)-q(t-T), toothAngle(t), axialDepth)
```

This is why spindle speed can move a cut into or out of stability without changing feed or geometry: speed changes the phase between current vibration and the previously generated surface. Lower RPM is not monotonically safer.

The Altintas-Budak zero-order solution uses eigenvalues of the averaged directional cutting matrix multiplied by the tool-point frequency-response function to calculate limiting axial depth and matching spindle-speed branches. Low radial immersion, variable pitch/helix, runout, loss of contact, process damping, nonlinear forces, and flexible workpieces need multi-frequency, semi-discretization, or time-domain methods. An accessible full derivation is [Altintas, Chatter Stability of Machining Operations](https://academy.cba.mit.edu/classes/computer_machining/chatter.pdf).

### 8.2 Dynamics are per assembly and state

NIST measured tool-point dynamics changing with spindle warm-up, spindle orientation, repeated holder insertion, tool-holder reassembly, nominally identical holders, and tightening torque. A stability map is therefore evidence for an exact machine/pose/spindle/holder/tool/stickout/clamp/temperature state, not a timeless machine property.

The robust software output is the stable intersection across measured/model uncertainty, with a margin. Reassembly, changed stickout, crash, suspected slip, holder change, or thermal state outside the qualified band invalidates the map.

### 8.3 Chatter detection is order-aware

Normal milling already contains spindle-order, tooth-passing, and harmonic energy. Runout often produces once-per-revolution imbalance. A useful online detector must:

1. use measured RPM and effective tooth count;
2. order-track and discount expected spindle/tooth harmonics;
3. inspect residual energy and sidebands near identified structural modes;
4. require persistence/growth rather than one threshold crossing;
5. condition the baseline on path-positioned engagement and entry/exit state;
6. distinguish chatter from an abrupt per-tooth breakage signature.

If changing speed in response, motion must first leave/hold the cut under a validated policy. Feed must then be recomputed to preserve chip thickness and the new RPM must be revalidated against surface-speed, torque, power, stability, and at-speed constraints. Bounded failed attempts end in retract/fault, not indefinite automatic searching.

### 8.4 Public research-code audit

Three public/inspectable references are useful for understanding, not direct product authority:

- [leekunhwee/ForceCalculation](https://github.com/leekunhwee/ForceCalculation) is a readable MATLAB implementation of axial slicing, helix lag, mechanistic forces, torque, coordinate transforms, and coefficient identification. It has no declared reusable license and lacks runout, compliance feedback, evolving stock, spindle duty, and uncertainty.
- [Milling-Chatter-Modeling](https://github.com/zhenzhuzz/Milling-Chatter-Modeling) is an MIT-licensed educational MATLAB implementation of time-varying delay equations, semi-discretization, and adaptive-speed concepts. It is a useful algorithm scaffold, not independent validation of a production detector/control loop.
- Dystamill's published research describes a C++ 2.5D dynamic milling framework with tool/workpiece discretization, mechanistic forces, modal dynamics, regenerative delay, periodic entry, surface update, and stability-lobe generation: [technical paper](https://docnum.umons.ac.be/Access/WebOpenAccess/GetDocument.aspx?Filename=10.1007_s00170-018-2357-3.pdf&GuidTicket=8be73150-c29e-464a-9565-7075670e7b18). Its historical source-host availability and license must be verified before any reuse.

The clean-room lesson is architectural: engagement, force, structural dynamics, surface evolution, and controller adaptation are separate modules with separately calibrated inputs. Copying a MATLAB formula into a feed calculator would not reproduce the validated system.

Therefore:

- a generic material chart cannot identify a stable RPM;
- reducing RPM can move a cut into a less stable lobe;
- changing stickout or holder invalidates a prior stability map;
- low radial engagement does not eliminate dynamic risk;
- a "magic RPM" learned on one assembly must carry that assembly and setup identity.

KerfDesk should begin with honest uncertainty and data capture, not pretend to compute stability lobes from diameter. A practical maturity path is:

1. collect tool assembly, stickout, RPM, engagement, load, sound/vibration observations, and result;
2. support operator-qualified stable/unstable regions with provenance;
3. add optional accelerometer/spindle-load signatures;
4. only later add FRF/force-coefficient stability models.

## 9. Entry strategy is a tool/material/geometry contract

### 9.1 Entry choices

A production CAM model distinguishes:

- vertical plunge;
- linear ramp;
- zig-zag ramp;
- profile ramp;
- helical interpolation;
- predrilled entry;
- entry from a known open boundary or previously cleared region;
- plunge milling with a tool explicitly designed for it.

Each has constraints. A legal helix needs enough center-path diameter, radial clearance, pitch per revolution, axial depth, chip evacuation, and a cutter rated for helical interpolation. A legal linear ramp needs enough path length for the requested angle and the tool's maximum ramp capability. A vertical plunge requires center-cutting/end geometry and an appropriate axial feed.

Harvey Performance says helical entry requires a programmed helix diameter greater than roughly 110-120% of cutter diameter in its general guidance and states that vertical entry requires a center-cutting tool because chip evacuation is difficult: [Most Common Methods of Tool Entry](https://www.harveyperformance.com/in-the-loupe/types-tool-entry/). Kennametal publishes tool-specific ramp angles, helical hole ranges, and axial pitch/depth limits, demonstrating that these are cutter data, not a global 45-degree UI range: [KSOM Mini application data](https://www.kennametal.com/us/en/products/fam.ksom-mini-shell-mill-metric.100000506.html) and [ramping overview](https://www.kennametal.com/ca/en/resources/blog/metal-cutting/importance-of-ramping-in-milling.html).

### 9.2 No silent fallback

If a requested entry does not fit, software must choose among explicit alternatives:

```text
validated requested entry
validated alternate entry selected by policy
predrill dependency
operator-confirmed plunge-capable process
blocking entry-does-not-fit diagnostic
```

It must not partially ramp and then hide a vertical plunge at the end. Process semantics must survive compile and postprocessing.

### 9.3 Recovery entry

An interrupted job is harder because the tool and stock may already be engaged. Safe restart is not "turn spindle on, then continue at the next line." The recovery system must classify:

- cutter clear and position/datum known;
- cutter clear but stock changed;
- cutter engaged but freely rotatable;
- cutter buried or trapped;
- cutter/tool condition unknown;
- fixture/part/support state changed;
- chips packed or coolant/extraction unavailable.

If engagement is unknown, automatic spindle start or retract is forbidden. If the tool is clear and the restart will re-enter stock, the resume path needs the same validated entry and engagement transition as a fresh operation: approach in known clearance, establish spindle/auxiliary readiness, enter through air or a proven cleared corridor, ramp/helix/lead-in under the qualified envelope, and only then rejoin the cut.

## 10. Cut direction is not only polygon orientation

For a clockwise M3 spindle, climb versus conventional direction depends on which side of the path contains material. KerfDesk correctly distinguishes outside from inside/pocket orientation for closed contours. A complete decision also needs:

- actual spindle direction;
- machine backlash and rigidity;
- fixture and thin-wall support;
- cutter geometry and manufacturer recommendation;
- remaining stock on the engaged side;
- entry/exit roll and corner behavior;
- surface-finish and pull-in risk.

The geometric direction can be correct while the process choice is wrong for a loose/backlash-prone hobby router or a weakly held part. The UI should describe climb/conventional as a qualified operation decision, not merely a motion preference.

## 11. Chip evacuation and auxiliary process state

Chips are part of the process state. Recutting raises heat and force, damages finish, and can break a tool even when nominal feed/RPM are reasonable. The required strategy depends on material and operation:

- deep slot versus open side cut;
- pocket depth and evacuation path;
- flute count and flute volume;
- upcut/downcut/compression geometry;
- air blast, mist, flood, through-tool coolant, or vacuum;
- chip size, adhesion, dust, and fire/toxicity hazards;
- peck/retract policy and dwell;
- enclosure and extraction capability.

KerfDesk's CNC group has no coolant/extraction/chip-evacuation intent. The project has a laser-oriented air-assist mechanism elsewhere, but CNC output does not bind an operation to `off`, air, mist, flood, vacuum, or an external manual prerequisite. A process recipe is incomplete without this state and its readiness evidence.

## 12. Tool wear, breakage, and adaptive control

### 12.1 Tool life needs an exposure model

Time alone is weak. Useful tool-life accounting distinguishes at least:

- engaged cutting time versus rapid/air time;
- material and hardness/condition;
- effective cutting speed and chip thickness;
- engagement/MRR/load exposure;
- interrupted cuts and entry events;
- thermal/auxiliary state;
- tool assembly and edge identity;
- wear correction or measured diameter/length;
- crash, overload, slip, and breakage events.

Siemens tool management can monitor effective operating time, quantity, and wear, and associates monitoring with an active cutting edge. Its documentation notes that life time is normally counted during interpolated path motion rather than `G00`: [SINUMERIK tool management](https://cache.industry.siemens.com/dl/files/223/64914223/att_108950/v1/FBWsl_0212_en.pdf). This is materially better than decrementing life while a tool ID is merely selected.

### 12.2 Reference-load monitoring

HEIDENHAIN documents load monitoring that records a reference operation and compares actual spindle/motor loads, with separate wear and breakage thresholds and reactions: [MANUALplus 620](https://endat.heidenhain.com/fileadmin/pdf/en/01_Products/Prospekte/PR_MANUALplus_620_OEM_ID743682_en.pdf). Siemens describes adaptive monitoring that changes feed to maintain load and protect tools: [Adaptive Control & Monitoring](https://www.siemens.com/en-us/products/machinum/adaptive-control-monitoring/).

The important architecture is:

```text
offline envelope sets absolute bounds
controller-synchronized reference identifies expected load by operation/segment
online monitor may reduce feed inside the envelope
sensor loss, desynchronization, or unknown stock cannot increase feed
breakage/overload response is controller/PLC-owned and deterministic
host records evidence; it is not the realtime safety loop
```

Spindle current is not a perfect force sensor, but research shows it can support force-coefficient and wear estimation when calibrated: [CIRP Journal, monitoring in-process force coefficients and tool wear](https://www.sciencedirect.com/science/article/pii/S1755581722000724).

### 12.3 Low load is ambiguous

A low load can mean:

- a cleared air cut;
- broken or missing tool;
- spindle stopped while motion continues;
- lost axis position or stock absent;
- low engagement by design;
- failed current/load sensor.

Adaptive software must combine load with synchronized motion, spindle speed, operation phase, stock expectation, and sensor validity. Low load must never be interpreted as permission to increase feed without context.

### 12.4 Separate overload, chatter, wear, and breakage

These conditions need different residuals and reactions:

| Observation after engagement conditioning | Likely class | Conservative reaction |
| --- | --- | --- |
| high load with expected tooth-synchronous shape | overload or more stock | bounded feed derating; stop if absolute limit persists |
| growing non-synchronous energy near structural mode | chatter | controlled hold/retract; change RPM/engagement/tool setup |
| abrupt new per-tooth imbalance, missing-tooth, or release spike | chipping/breakage | immediate safe stop and inspection |
| slow rise in fitted edge/ploughing coefficients | wear | planned replacement and offset/quality check |
| unexpectedly low load | air cut, broken/missing tool, lost position, absent stock, or sensor failure | do not accelerate; reconcile process state |

NIST has published pipelines using operation-segmented audio/acceleration spectra and combined controller/audio/vibration features for tool-condition prediction: [sensor-data pipeline](https://www.nist.gov/publications/data-processing-pipeline-prediction-milling-machine-tool-condition-raw-sensor-data) and [generalized manufacturing-signal features](https://www.nist.gov/publications/generalized-method-featurization-manufacturing-signals-application-tool-condition). These support the architecture, but a trained model remains scoped to its machines, tools, materials, sensors, and data distribution.

## 13. Material-specific planning is not five labels

The current five families—softwood, hardwood, plywood/MDF, acrylic, and aluminum—are useful beginner categories, but each hides process-changing variation.

### 13.1 Wood, plywood, and MDF

Relevant differences include:

- species, density, moisture, resin, knots, and grain direction;
- solid wood versus veneer layers, adhesive, voids, and fiberboard;
- upcut/downcut/compression geometry and surface-side tearout;
- dust extraction and chip packing;
- heat/burning at insufficient chip formation;
- workholding and sheet lift;
- tool wear from glue/mineral contamination in sheet goods.

"Plywood/MDF" should not imply identical chip, dust, edge-finish, and tool-wear behavior.

### 13.2 Acrylic and thermoplastics

Relevant differences include cast versus extruded sheet, melting/softening range, chip welding, flute polish/geometry, air evacuation, heat concentration, and coolant compatibility. Too little chip formation can melt rather than cut; recutting packed chips can weld material to the tool.

### 13.3 Aluminum

Alloy/temper, cutter geometry/coating, chip evacuation, lubrication, machine rigidity, spindle torque, and workholding are decisive. A value that works for wrought aluminum with a polished single-flute cutter and mist cannot be promoted to all aluminum on a dry, low-rigidity router.

### 13.4 Composites and hazardous materials

Fiber orientation, delamination, abrasive wear, respirable dust, electrical conductivity, resin, and prohibited coolant can dominate. The software needs explicit material hazards and required controls, not only a chip-load number.

Wood, plastic, composite, and finely divided aluminum dust can also be combustible or incompatible with the same collector. A recipe must name required extraction, collector compatibility, housekeeping, and material prohibitions. It must never infer that a wood-dust system is suitable for aluminum or conductive composite dust. Authoritative starting references include [OSHA combustible-dust guidance](https://www.osha.gov/enforcement/directives/cpl-03-00-006), [OSHA wood-dust guidance](https://www.osha.gov/etools/woodworking/production/wood-dust), and [OSHA aluminum-dust interpretation](https://www.osha.gov/laws-regs/standardinterpretations/2009-10-08).

### 13.5 Recipe provenance

Every recommendation should carry:

```text
source/vendor/document/revision
material class, grade/condition, and uncertainty
cutter SKU/geometry/coating and effective teeth
holder/stickout/runout assumptions
operation and engagement bounds
spindle/machine capability assumptions
coolant/extraction requirements
starting-value versus tested-on-machine status
operator/site qualification and last successful evidence
```

Without these fields, a saved "Ply rough" preset is a bag of numbers that can be applied to the wrong tool, material, or machine without warning.

## 14. Current KerfDesk process model

### 14.1 Tool identity is too small

`src/core/scene/machine.ts:13-20` stores:

```text
id, name, kind, diameterMm, optional tipAngleDeg
```

It has no:

- catalog SKU, revision, vendor, units, or geometry source;
- flute count or effective teeth;
- center-cutting/plunge/ramp/helix capability;
- maximum axial/radial engagement;
- flute length, reach, neck, shank, corner radius, helix, or rake;
- upcut/downcut/compression direction;
- substrate, coating, or material compatibility;
- holder, collet, stickout, balance, maximum RPM, or pull-out capacity;
- measured runout, length/diameter offsets, wear, condition, or life;
- qualified recipes or evidence.

The custom-bit form at `src/ui/machine/CncLibraryPanels.tsx:54-71` can only collect name, kind, diameter, and optional tip angle, so the missing physics cannot be reconstructed later.

### 14.2 Calculator result can be internally inconsistent

`src/core/cnc/feeds-calculator.ts:110-135`:

1. selects target chip load from material and diameter band;
2. computes `rawFeed = rpm * roundedFlutes * chipload`;
3. caps feed to machine `maxFeed`;
4. derives plunge and depth/pass;
5. returns the original target `chiploadMm`.

`src/ui/layers/FeedsCalculatorRow.tsx:120-123` displays that original target next to the capped feed. If 1440 mm/min is capped to 1000 at unchanged 12,000 rpm and two flutes, achieved commanded feed per tooth is 0.0417 mm/tooth, not the displayed 0.060.

The correct solver must either:

- coordinate RPM down to preserve target feed per tooth inside spindle/feed limits;
- report both target and achieved values plus the limiting constraint;
- reject the combination if RPM cannot be reduced safely;
- offer a different effective-tooth/tool/engagement strategy.

### 14.3 Material actions make an unstored two-flute assumption

`src/ui/layers/CncMaterialRow.tsx:13-15` and `src/ui/state/cnc-project-material.ts:18-21` hard-code two flutes. The tool schema cannot confirm or persist that assumption. Selecting a one-flute or three-flute cutter of the same diameter can make the applied feed materially wrong while the saved project still appears fully specified.

### 14.4 Feed presets omit their applicability

`src/ui/state/cnc-library-persistence.ts:14-22` stores only:

```text
feed, plunge, RPM, depth/pass, stepover
```

It omits tool, material, operation, machine, stickout, flute count, coolant, engagement, provenance, and qualification. `feedPresetPatch` applies the tuple to any layer without compatibility checks.

### 14.5 One layer recipe drives multiple tools

`CncLayerSettings` owns one `feedMmPerMin`, `plungeMmPerMin`, `spindleRpm`, `depthPerPassMm`, and `stepoverPercent`, while it can also name:

- `toolId` for the main operation;
- `vClearToolId` for V-carve floor clearing;
- `reliefFinishToolId` for relief finishing.

`src/core/cnc/compile-cnc-job.ts:189-225` builds the clearing group with the clearing tool's identity and diameter but the layer's unchanged process tuple. `src/core/cnc/compile-cnc-relief.ts:64-88,94-137` does the same for rough and finish tools. There is no per-operation recipe recomputation or validation.

This is a high-severity correctness defect in the process model. A 1/8-inch V-bit recipe can be applied to a 1/4-inch floor-clearing tool, and a roughing end-mill recipe can be applied to a small ball-nose finisher. Geometry changes; cutting data does not.

### 14.6 The "flat" clearing selector is not flat-only

`src/ui/layers/CncLayerToolFields.tsx` defines clearing candidates as every tool whose kind is not `v-bit`. It therefore includes ball-nose and engraving tools. The compiler then uses `pocketToolpathRings`, which assumes a flat pocket floor in its semantic contract.

The selector should require a capability such as `flatBottomClearing=true` and a compatible cutting-data envelope, not infer from a negative kind check.

### 14.7 Drilling is an operation without a compatible tool type

The tool-kind union has no drill. `drillPeckPasses` converts every closed shape into a bounding-box-center peck path and the compiler executes it at layer plunge feed. Preflight checks neither tool kind nor center-cutting capability.

Missing drill semantics include:

- drill versus end-mill helical hole versus center drill;
- requested hole diameter and tolerance;
- tool fit and point geometry;
- feed per revolution;
- peck increment independent of generic depth/pass;
- full retract versus chip-break retract;
- rapid-to-clearance and approach allowance;
- dwell, coolant, flute evacuation, breakthrough, and backing material;
- maximum depth/flute length and tool runout;
- material-specific cycle and controller support.

This operation should be considered unqualified until a drill/axial-entry capability model and preflight exist.

### 14.8 Ramp entry is global and can lie

`src/core/cnc/motion-polish.ts:31-32,87-109` clamps every request into 0.5-45 degrees without consulting the tool. Lines 154-157 append a same-XY final descent when the path is too short. The UI exposes this as an angle, not a requested maximum with a fit result.

Required output metadata should state:

```text
requestedEntry
compiledEntry
toolCapabilityUsed
availableLength/helixDiameter
requiredLength/pitch
fallbackPolicy
validationResult
```

### 14.9 Pocket and relief roughing are geometric, not engagement controlled

`pocketToolpathRings` emits inward offsets at a clamped 10-85% diameter stepover and orders them inner-first. Raster pockets use fixed hatch spacing. Relief roughing uses contour waterlines and inward rings. None derives remaining stock per segment, engagement angle, corner feed reduction, chip-thinning compensation, spindle load, or rest material from a previous tool.

The algorithms can produce geometrically valid swept volume while exposing the cutter to abrupt engagement changes. This is not a criticism of deterministic geometry; it is a boundary on the word "safe."

### 14.10 Surfacing bypasses the process model

`src/ui/machine/SurfacingPanel.tsx:18-20,94-104` hard-codes:

```text
feed 2500 mm/min
plunge 600 mm/min
depth/pass 0.5 mm
stepover 40%
RPM = spindleMaxRpm
```

for every active cutter and material. It writes a standalone file rather than a semantic job passed through normal CNC preflight. `src/core/cnc/surfacing.ts:85-104` emits `M3`/dwell before the first `G0 Zsafe`, the stationary-cutter ordering already identified as a P0 in the auxiliary-system tranche.

Surfacing needs a real operation record, qualified facing tool, stock/material, spindle envelope, entry/exit plan, boundary overshoot/tool-radius policy, dust/coolant prerequisite, preview, and the same final-output invariants as other jobs.

### 14.11 Preview proves geometry only and is wrong for multi-tool cuts

`src/core/sim/stamp-toolpath.ts` stamps tool shape along planned cutting steps into a depth grid. It never reads feed, RPM, material, spindle, load, force, deflection, runout, or chip state. `src/ui/workspace/use-cnc-removal-grid.ts` and `Cnc3DPane.tsx` choose `activeCncTool(machine)` once for the entire toolpath, so multi-tool jobs use the wrong kernel for every non-active tool.

A future simulator must keep separate products:

1. geometric swept-volume preview;
2. evolving-stock/engagement analysis;
3. controller trajectory simulation;
4. process load/stability estimate;
5. measured execution/stock evidence.

Combining them into one green preview would hide uncertainty.

### 14.12 Preflight checks scalar validity, not a process envelope

`src/core/preflight/cnc-preflight.ts:91-135` verifies positive depth/feed, scalar max feed/RPM, stock depth, and V-bit kind. It does not check:

- recipe/tool/material compatibility;
- flute/effective-tooth assumptions;
- achieved feed per tooth after caps;
- surface speed, MRR, torque, or power;
- radial/axial engagement or corner overload;
- tool reach/flute length/stickout/deflection;
- center cutting, ramp, helix, or drill capability;
- holder max RPM/balance/runout/pull-out;
- spindle minimum speed/torque curve or actual RPM feedback;
- coolant/extraction/chip evacuation;
- tool life, condition, or breakage evidence;
- dynamic stability or fixture/workpiece compliance.

Passing current preflight means the generated coordinates and scalar settings satisfy the encoded software contract. It does not mean the cut is physically qualified.

## 15. Proposed process-intelligence architecture

### 15.1 Core entities

```ts
type CutterDefinition = {
  id: string;
  vendor?: string;
  sku?: string;
  revision?: string;
  kind: ToolKind;
  cuttingDiameterMm: number;
  shankDiameterMm?: number;
  fluteCount?: number;
  effectiveTeeth?: number;
  fluteLengthMm?: number;
  overallLengthMm?: number;
  cornerRadiusMm?: number;
  tipAngleDeg?: number;
  helixHand?: 'upcut' | 'downcut' | 'neutral' | 'compression';
  substrate?: string;
  coating?: string;
  capabilities: ToolCapabilities;
  source: EvidenceRef;
};

type ToolCapabilities = {
  centerCutting: TriState;
  flatBottomClearing: TriState;
  drilling: TriState;
  linearRamp: TriState;
  helicalRamp: TriState;
  maxRampAngleDeg?: number;
  helixDiameterRatio?: Range;
  maxAxialDepthMm?: number;
  maxRadialEngagementMm?: number;
  maxRpm?: number;
};

type ToolAssembly = {
  id: string;
  cutterId: string;
  holderId?: string;
  colletId?: string;
  stickoutMm?: number;
  gaugeLengthMm?: number;
  measuredRunoutMm?: Measurement;
  lengthOffsetMm?: Measurement;
  diameterOffsetMm?: Measurement;
  balanceGrade?: string;
  qualifiedMaxRpm?: number;
  condition: 'new' | 'serviceable' | 'worn' | 'suspect' | 'broken' | 'unknown';
  life: ToolLifeState;
  evidence: EvidenceRef[];
};

type WorkMaterial = {
  family: string;
  grade?: string;
  condition?: string;
  hardness?: Measurement;
  stockForm?: string;
  anisotropy?: string;
  hazards: MaterialHazard[];
  coefficients?: ProcessCoefficientSet;
  evidence: EvidenceRef[];
};

type SpindleCapability = {
  controlMode: 'manual' | 'relay' | 'open-loop-command' | 'closed-loop';
  minQualifiedRpm?: number;
  maxQualifiedRpm: number;
  continuousTorqueCurve?: Curve;
  peakTorqueCurve?: Curve;
  continuousPowerCurve?: Curve;
  peakPowerCurve?: Curve;
  peakDurationSec?: number;
  clockwiseConfirmed: TriState;
  atSpeedFeedback: FeedbackCapability;
  loadFeedback: FeedbackCapability;
  warmupPolicy?: WarmupPolicy;
};

type MachiningOperation = {
  id: string;
  setupRevision: string;
  stockRevisionIn: string;
  stockRevisionOut: string;
  toolAssemblyId: string;
  materialId: string;
  strategy: OperationStrategy;
  cuttingData: CuttingData;
  engagementPolicy: EngagementPolicy;
  entry: EntryStrategy;
  links: LinkStrategy;
  auxiliaries: AuxiliaryPolicy;
  dependencies: OperationDependency[];
  qualification: ProcessQualification;
};
```

Unknown fields remain unknown. Parsers must not invent two flutes, center-cutting capability, balance, or torque curves.

### 15.2 Operation-local cutting data

Each tool-bearing operation owns its own process data. A V-carve with a clearing stage becomes at least two operations:

```text
clear flat floors with ToolAssembly A + Recipe A
V-carve walls/details with ToolAssembly B + Recipe B
```

Relief rough and relief finish likewise have separate tool assemblies and recipes. Layer color is presentation grouping, not a process-data boundary.

### 15.3 Process-envelope result

```ts
type ProcessEnvelopeResult = {
  status: 'qualified' | 'warning' | 'blocked' | 'unknown';
  modelRevision: string;
  commandedFeedPerTooth?: Range;
  estimatedMaxChipThickness?: Range;
  surfaceSpeed?: Range;
  materialRemovalRate?: Range;
  cuttingPower?: Range;
  cuttingTorque?: Range;
  deflection?: Range;
  stability?: 'qualified-stable' | 'observed-stable' | 'unknown' | 'risk';
  limitingConstraints: ConstraintResult[];
  assumptions: Assumption[];
  evidence: EvidenceRef[];
  invalidatedBy: InvalidationRule[];
};
```

The evaluator must distinguish three kinds of statement:

- **hard fact:** e.g. the selected holder's declared max RPM;
- **model result:** e.g. estimated power using a named coefficient set;
- **empirical qualification:** e.g. this exact assembly/setup completed a test coupon inside limits.

### 15.4 Stock and engagement engine

The next major CAM capability after honest recipes should be evolving-stock analysis:

```text
stock revision
-> subtract prior qualified swept volumes
-> intersect next tool sweep with remaining stock
-> compute engagement along the emitted path
-> identify slot/corner/re-entry/load transitions
-> apply feed schedule within offline envelope
-> emit stock/engagement witnesses for simulation and recovery
```

Rest machining uses the previous stock revision and prior tool geometry to cut only material the smaller/current tool must remove. It is also required for honest restart: expected remaining stock at the resume boundary must be explicit.

### 15.5 Constraint solver behavior

Given a target tool/material/operation, the solver should:

1. choose target chip-thickness/surface-speed ranges from provenance;
2. calculate effective diameter and teeth assumptions;
3. intersect spindle RPM, holder RPM, machine feed, axis, and controller limits;
4. calculate engagement-aware feed and entry limits;
5. evaluate MRR, torque, power, reach, deflection, chip evacuation, and stability evidence;
6. return the feasible region and the active limiting constraint;
7. refuse a green result when required evidence is unknown.

This is more useful than returning one magic feed. A beginner UI can select a conservative point inside the feasible region while preserving an expandable explanation.

### 15.6 Physical assembly and qualification identity

Start authorization should resolve a magazine pocket or T-number to a current physical assembly version and measured offsets. A T-number is a controller reference, not proof of cutter/holder/collet/stickout/runout/wear identity.

Recommended identity chain:

```text
catalog cutter definition
-> physical cutter asset/lot/resharpen state
-> identified holder + collet + nut + adapters + retention parts
-> measured assembly version (gauge length, stickout, diameter, TIR, torque, balance)
-> controller pocket/T-number and length/radius offsets
-> operation-local recipe and qualification
```

Reseating, regrinding, replacing a component, changing stickout, crash/breakage, suspect pull-out, or offset remeasurement creates or invalidates an assembly revision. The old successful recipe does not silently follow the T-number.

### 15.7 Source-priority policy

Recommendation sources should be ranked, not averaged:

```text
exact cutter SKU + exact material/operation manufacturer data
> same manufacturer tool family with declared interpolation
> qualified shop/machine test for the exact assembly
> industry handbook/chart with explicit assumptions
> generic family chart
> heuristic or unknown-source value
```

Persist source/calculator version, URL/document revision, units, complete input snapshot, output, extrapolation, and qualification status. Manufacturer calculators themselves demonstrate the required dimensionality: [Harvey Machining Advisor Pro](https://www.harveyperformance.com/machining-advisor-pro/), [Onsrud cutting-data portal](https://onsrud.com/Forms/Cutting-Data-Recommendations.asp), and [Seco safe cutting-data workflow](https://www.secotools.com/article/how_to_calculate_safe_cutting_data).

## 16. Production qualification workflow

A trustworthy workflow is an evidence pipeline, not one preflight dialog:

1. **Identify material and stock.** Record exact grade/condition/lot/construction, thickness, hazards, workholding surfaces, and stock revision.
2. **Select exact cutter and permitted operation.** Confirm SKU/geometry, effective teeth, center-cutting/ramp/helix/drill permissions, reach, and vendor cutting-data revision.
3. **Build the physical assembly.** Clean mating surfaces; identify holder/collet/nut/adapters/retention parts; apply component-specific insertion and torque instructions.
4. **Measure the assembly.** Record gauge length, stickout, diameter, TIR at a named distance/method, repeat seating if required, and verify balance/weakest-link RPM.
5. **Qualify machine readiness.** Confirm spindle warm-up/break-in lifecycle, chiller/cooling, actual direction and at-speed policy, air/coolant/extraction, workholding/vacuum, datum, and controller state.
6. **Solve and preflight the process.** Evaluate achieved chip-thickness window, engagement, entry, reach, evacuation, MRR, continuous/peak torque/power, deflection, stability evidence, collisions, and operation dependencies.
7. **Simulate distinct truths.** Check geometry/swept volume, evolving stock/engagement, target-controller motion, and process-envelope results without collapsing them into one green status.
8. **Prove out from known clearance.** Use a test coupon or sacrificial stock, coordinated feed/RPM overrides or reduced engagement, bounded observation, and no automatic promotion of overrides.
9. **Inspect the first article.** Use a planned characteristic list and suitable measurement method; capture dimensional, surface, tool, load, vibration, and auxiliary evidence.
10. **Release an immutable recipe.** Bind the actual machine/spindle configuration, program/post hashes, material lot/class, fixture/vacuum state, assembly version, media/extraction, inspection plan, and approved envelope.
11. **Monitor production.** Compare synchronized RPM/load/vibration/toolsetter/quality data with the qualified operation-position baseline; update tool exposure and condition.
12. **Requalify after changes.** A risk-sensitive hash change opens a documented full/partial requalification decision rather than silently continuing.

A practical `qualificationScopeHash` covers:

```text
machine and spindle config
+ controller/post/program revision
+ exact material and stock class
+ fixture/vacuum/setup revision
+ physical tool assembly version
+ media/extraction policy
+ inspection plan
```

[IAQG 9102](https://iaqg.org/standard/9102-first-article-inspection-requirement/) provides a standardized first-article/evidence model and change-driven re-accomplishment concept. Renishaw's process-control framework separates machine capability, process setting, in-process control, and post-process monitoring: [When do I probe?](https://www.renishaw.com/en/when-do-i-probe--12477).

Spindle readiness is part of this lifecycle. Haas, Tormach, Hiteco, and ShopBot publish different warm-up, break-in, duty, cooling, and process-media sequences. KerfDesk must store a machine/spindle-specific policy and completed evidence, not invent one universal warm-up routine.

## 17. Maturity levels for KerfDesk

### Level 0 - transparent arithmetic

- Persist flute count/effective teeth and all calculator assumptions.
- Report target and achieved feed per tooth after every cap.
- Calculate surface speed, nominal MRR, and limiting constraints.
- Remove "safe" wording from unqualified charts.
- Bind saved presets to tool/material/operation/machine applicability.
- Split multi-tool stages into operation-local recipes.

### Level 1 - capability-aware CAM

- Add tool reach, flute length, center-cutting, ramp/helix/drill capability, max RPM, holder/stickout, and auxiliaries.
- Block impossible ramp/helix/drill entries; never silently plunge.
- Add spindle torque/power curves and process-capacity checks.
- Add material grade/condition/hazards and vendor provenance.
- Fix multi-tool geometric preview.

### Level 2 - evolving stock and engagement

- Add stock revisions, rest machining, segment engagement, corner/slot transitions, and engagement-controlled roughing.
- Schedule feed inside offline bounds.
- Validate recovery approach/re-entry against expected remaining stock.

### Level 3 - measured qualification

- Record actual RPM, synchronized spindle/axis load, overrides, and auxiliary state.
- Store runout, stickout, tool condition, test coupons, and successful envelopes.
- Detect drift from a reference operation and apply controller-owned protective reactions.

### Level 4 - dynamics and adaptive process control

- Add optional FRF/stability-lobe workflow tied to exact tool assembly/setup.
- Add calibrated force/deflection models and uncertainty.
- Use realtime adaptive feed only inside prequalified offline bounds with fail-safe sensor policy.

## 18. Product priorities

### P0 - preserve earlier stationary-cutter and recovery gates

1. Lift the cutter before surfacing spindle start/dwell.
2. Do not automatically start, retract, or continue a cutter whose engagement is unknown.
3. Do not treat an acknowledged G-code line as restored cutting-process state.

### P0 - process truth

1. Stop applying one layer recipe to V-clear, relief rough, and relief finish tools. Give every tool-bearing operation its own cutting data and validation.
2. Remove the silent short-ramp vertical-plunge fallback. Block or compile a separately validated alternate entry.
3. Never display target chip load as achieved after feed/RPM/controller capping. Report both values and the limiting constraint.
4. Disable or explicitly mark drill operations unqualified until the selected tool has axial-entry/drilling capability and the cycle validates reach, peck, feed/rev, and evacuation.
5. Route surfacing through the normal semantic job, preview, process recipe, and final-output preflight path; remove fixed universal cutting data.

### P1

1. Expand `CncTool` into cutter definition plus tool assembly, holder, stickout, runout, balance, life, and condition.
2. Persist flute/effective-tooth assumptions; eliminate hidden two-flute defaults.
3. Add material grade/condition/hazard and source/revision provenance.
4. Replace unscoped feed presets with qualified tool-material-operation recipes.
5. Add tool-specific entry capabilities and geometry-fit proof for plunge/ramp/helix/predrill.
6. Add spindle minimum RPM plus torque/power curves and compare required versus available capacity.
7. Add operation-local coolant/air/vacuum/extraction policy and readiness evidence.
8. Fix multi-tool removal preview to select the tool kernel per operation.
9. Surface actual commanded feed per tooth, surface speed, MRR, capacity margin, and uncertainty in UI/preflight.

### P2

1. Add evolving stock, rest machining, and engagement-aware roughing/feed scheduling.
2. Add tool reach/flute-length/holder collision and deflection checks.
3. Add test-coupon qualification and successful-envelope history.
4. Add controller-synchronized load/RPM monitoring, reference signatures, and tool-condition events.
5. Add optional FRF/stability workflows for advanced users and machine builders.

## 19. Verification strategy

### 18.1 Pure formula and constraint tests

- target versus achieved feed per tooth after rounding and caps;
- actual RPM tolerance and spindle droop;
- radial chip-thinning boundaries at 0, 0.1D, 0.5D, and slotting;
- effective diameter for square, ball, V, and tapered tools;
- MRR/power/torque unit and bound checks;
- missing coefficients/curves return unknown, never zero or green;
- holder max RPM and spindle curve intersection;
- stickout/deflection sensitivity and uncertainty;
- recipe applicability and invalidation.

### 18.2 Geometry/process adversarial tests

- narrow pocket where requested helix does not fit;
- contour shorter than requested ramp;
- internal corner engagement spike;
- transition from low-engagement side cut to slot;
- island neck and rest material;
- entry into already-cleared versus uncut stock;
- V-clear and relief finish with different tool diameters/flutes/RPM limits;
- ball nose near zero effective diameter;
- drill with non-center-cutting end mill;
- peck deeper than flute length;
- stock changed after interrupted operation.

### 18.3 Golden post/process invariants

```text
compiled tool identity == operation recipe tool assembly
compiled entry == validated entry
no undeclared entry fallback
commanded feed/RPM inside qualified envelope
holder/tool/spindle RPM limits all satisfied
spindle and required auxiliaries ready before engagement
engagement unknown => no automatic spin/retract/re-entry
sensor invalid => adaptive feed cannot increase
stock revision consumed == stock revision validated
```

### 18.4 Bench and cutting qualification

- independently measure RPM under no-load and cut load;
- measure tool runout at defined distance and after tool changes;
- weigh/measure removed volume versus nominal MRR;
- capture spindle current/load and accelerometer/audio signatures;
- test engagement transitions, slotting, corners, ramp, helix, and drilling;
- measure wall/feature error versus modeled deflection;
- run stickout/RPM/depth sweeps to map stable/unstable zones;
- inject chip evacuation loss, spindle droop, tool slip, tool breakage, and sensor freeze;
- perform interrupted-cut recovery tests with clear, engaged, buried, and unknown tools.

Every result should retain app build, controller firmware/settings, post revision, machine/setup, material lot, tool/holder/collet, stickout, runout, RPM/load trace, auxiliaries, environment, measurement method, and pass criteria.

## 20. Current-source verification performed

Current-source audit covered:

```text
src/core/cnc/compile-cnc-job.ts
src/core/cnc/compile-cnc-relief.ts
src/core/cnc/drill-peck.ts
src/core/cnc/feeds-calculator.ts
src/core/cnc/motion-polish.ts
src/core/cnc/pocket-paths.ts
src/core/cnc/surfacing.ts
src/core/cnc/vcarve-clearance.ts
src/core/cnc/vcarve-ladder.ts
src/core/job/job.ts
src/core/job/toolpath-types.ts
src/core/output/cnc-grbl-strategy.ts
src/core/preflight/cnc-preflight.ts
src/core/relief/relief-finishing.ts
src/core/relief/relief-roughing.ts
src/core/scene/machine.ts
src/core/sim/stamp-toolpath.ts
src/core/sim/tool-kernels.ts
src/ui/layers/CncLayerToolFields.tsx
src/ui/layers/CncMaterialRow.tsx
src/ui/layers/FeedsCalculatorRow.tsx
src/ui/machine/CncLibraryPanels.tsx
src/ui/machine/SurfacingPanel.tsx
src/ui/state/cnc-library-persistence.ts
src/ui/state/cnc-project-material.ts
src/ui/workspace/Cnc3DPane.tsx
src/ui/workspace/use-cnc-removal-grid.ts
```

Focused verification:

```text
14 test files passed
110 tests passed
Prettier check passed
```

The tests prove that the current implementation matches its encoded contracts. They do not prove physical chip thickness, spindle capacity, tool/holder integrity, toolpath engagement, force, deflection, chatter stability, chip evacuation, tool condition, or actual remaining stock.

## Final rules

```text
material family != qualified work material
cutter diameter != tool assembly
flute count != effective teeth
feed per tooth != actual chip thickness
target chip load != achieved chip load
spindle max RPM != spindle process capability
geometric stepover != bounded engagement
valid coordinates != feasible cut
planned swept volume != actual remaining stock
same tool ID != same stickout/runout/condition
low load != safe air cutting
spindle commanded != spindle ready
resume line found != cutter can safely re-enter
```

KerfDesk should expose the evidence and uncertainty on each side of these inequalities. That is the difference between a convenient G-code generator and trustworthy CNC process software.
