> **Historical research archive: 11–13 July 2026.** Published on 6 September 2026.
> Findings, scores, source claims and proposed changes below describe their recorded
> baseline; they have not been revalidated and are not current product or qualification
> evidence. Unimplemented proposals are not adopted policy. The current
> [Frame-first contract](../../PROJECT.md) governs application behaviour. See the
> [archive index](2026-09-06-preserved-audits.md) and [source manifest](2026-09-06-preserved-audits-source-manifest.json).

# CNC Workholding, Fixture, Vacuum, and Part-State Architecture

Date: 2026-07-13
Scope: locating, clamping, supports, vacuum hold-down, spoilboards, tabs, thin stock and walls, fixture collision, part liberation, pallets, tiling, interruption, restart, and implications for KerfDesk
Method: manufacturer guidance, public CAM/controller documentation, manufacturing research, open-source architecture review, and current-source audit of C:\Users\Asus\LaserForge\audit-current-main

## Executive verdict

Workholding is not a clamp icon, a rectangular keep-out, or a sentence telling the operator to secure the stock. It is a changing physical system:

~~~text
stock identity and current geometry
+ fixture, pallet, spoilboard, and support geometry
+ locators and their contact condition
+ clamp or fastener state and preload
+ vacuum zones, seals, pump curve, pressure, and leak topology
+ uncut ligaments, tabs, skins, and already liberated parts
+ cutting-force and inertial wrench over the remaining toolpath
+ workpiece and fixture stiffness, damping, temperature, and residual stress
= one time-bounded claim that the part is located, retained, supported, and safe to machine
~~~

That claim must be reevaluated as material is removed. A job which was secure at the first pocket can become unsafe at the final profile because:

- a through-cut vents a vacuum zone;
- a small part loses most of its effective suction area;
- a tab breaks or an onion skin is cut away;
- the surrounding skeleton becomes flexible;
- a thin wall loses stiffness roughly with the cube of thickness;
- the cutting force reverses direction or develops an upward component;
- a clamp, locator, or pallet is moved;
- heat or released residual stress changes the part's pose;
- the actual head, tool holder, collet, nut, dust shoe, or gantry intersects the fixture even though the tool-center path does not.

The deepest architectural conclusion is:

> Stock geometry, workholding, process mechanics, and execution history are one evolving state machine. A motion, feed, or resume decision is valid only for the physical state in which it was qualified.

KerfDesk has several useful beginnings: explicit stock dimensions and placement, automatic holding tabs, inside-before-outside ordering, no-go-zone visualization, deterministic tiling, a planned-removal preview, and a byte fingerprint for interrupted jobs. None of these currently establishes workholding safety.

The most important newly confirmed implementation findings are:

1. **Tabs can silently disappear.** If one requested tab span is at least the contour perimeter, or merged skip intervals leave no burn segment, the tab splitter returns the original closed contour. The UI still says tabs are enabled, but the emitted profile can cut the part completely free.
2. **Tab height is referenced to commanded cut depth, not the physical stock bottom.** A through-cut allowance therefore consumes some of the intended bridge height. There is no emitted-geometry proof that the requested bridge exists.
3. **No-go zones are 2D tool-center rectangles.** They have no Z height, tool/holder/dust-shoe envelope, fixture mesh, clearance margin, setup identity, or sensor state.
4. **Arc and initial-position collision checks are incomplete.** G2/G3 motion is checked as its endpoint chord, and the first programmed XY move is not checked from the actual machine position.
5. **Stock-fit warnings use centerline bounds.** They can declare an edge path inside stock while half the cutter is outside, and they are advisory rather than part of CNC preflight.
6. **Tiling can invalidate cutting mechanics.** Clipping a closed path creates an open fragment without requalifying entry, support, tabs, or vacuum. A fragment can begin with a plunge into uncut stock.
7. **Registration holes are not a qualified operation.** They use a constant 3 mm depth, inherit the first CNC group's tool and recipe, and are appended after normal tile cutting. They can therefore use an engraving or V tool and run after the stock has already been weakened.
8. **A checkpoint proves program identity, not part-state identity.** It records bytes, acknowledged lines, machine kind, output scope, and origin, but no fixture, stock, clamp, vacuum, tab, tile, pallet, datum, temperature, or remaining-material evidence.
9. **The current CNC resume preamble starts the spindle before the safe-Z retract.** That is unsafe if the interrupted tool remains engaged or its clearance is unknown. It then descends vertically to the recorded depth without a remaining-stock or workholding qualification.

This is a report and architecture tranche. It does not modify production code.

## 1. Workholding has four separate jobs

A safe setup must do all four:

1. **Locate:** establish the workpiece coordinate relationship repeatably.
2. **Retain:** prevent translation, lift, yaw, and overturning under adverse load.
3. **Support:** keep the workpiece sufficiently stiff and prevent unacceptable deformation.
4. **Sense or prove:** establish that the assumed contacts, pressure, clamps, identity, and pose are actually present.

A single clamp can contribute to several jobs, but those jobs must not be conflated. A vise jaw may push a part into a fixed jaw, but the fixed jaw and base should carry the primary load. A vacuum table may supply normal load, but positive stops may be needed for lateral cutting. A tab may retain a part locally but provide poor rotational stiffness. A probe may locate a surface without proving that the part is seated on all supports.

Carr Lane's fixture guidance makes the division explicit: locators should position the workpiece and resist primary machining forces; clamps hold the workpiece against locators and resist secondary forces. It recommends placing clamps at rigid points, usually above supporting elements, so clamping force is absorbed by the locators rather than bending an unsupported workpiece. It also notes that cutting-force direction changes during a cut. See [Carr Lane, locating and clamping principles](https://www.carrlane.com/engineering-resources/fixture-design-principles/locating-clamping-principles/ctl) and [Carr Lane, machining operations and fixture layout](https://www.carrlane.com/engineering-resources/technical-information/power-workholding/design-information/machining-operations-fixture-layout).

### 1.1 Locating is a constraint problem

A rigid body has six independent degrees of freedom: three translations and three rotations. Traditional 3-2-1 location uses:

- three primary supports to establish a plane;
- two secondary locators to establish a direction;
- one tertiary locator to establish the last in-plane position;
- clamps to maintain contact in the remaining unilateral directions.

Carr Lane describes the equivalent twelve signed directions, because each translation and rotation has two senses. The important software point is not the terminology. It is that a workpiece pose is established by a particular contact set. If a chip, bow, damaged locator, or clamp sequence prevents one contact from seating, the expected transform may not exist.

A setup record therefore needs:

- locator identity and geometry;
- nominal contact point or patch;
- constrained direction;
- allowable seating gap;
- surface condition and cleanliness requirement;
- datum relationship;
- measurement evidence and timestamp;
- invalidation event such as unclamp, pallet change, crash, power loss, or temperature excursion.

### 1.2 Retention is a wrench problem, not F divided by friction

At contact i, with force fi at position ri, the contact contributes a force and moment:

~~~text
Gi fi = [ fi ; ri × fi ]
~~~

Quasi-static equilibrium requires:

~~~text
sum(Gi fi) + wcut + winertia + wgravity = 0
~~~

Each unilateral contact must also satisfy:

~~~text
Ni >= 0
norm(ti) <= mui Ni
~~~

where Ni is compressive normal force, ti is tangential contact force, and mui is the applicable lower-bound friction coefficient.

The useful question is not merely “is clamp force greater than cutter force?” It is:

> Does a feasible set of contact forces exist, within actuator, friction, pressure, and separation limits, for every adverse force-and-moment combination along this toolpath?

A first-order friction screen,

~~~text
Fparallel <= mumin sum(Ni)
~~~

cannot prove resistance to:

- overturning moment;
- rotation around one locator;
- local lift-off;
- unequal load sharing;
- compliance that unloads a contact;
- up-cut axial force;
- cutter entry impact;
- an emergency deceleration;
- force direction changing around a contour.

For a serious planner, the retention check can be implemented as a linear program using polyhedral friction cones, or a second-order cone problem using Coulomb cones. The uncertain cutting wrench should be an envelope, not a single nominal vector.

Relevant research includes [dynamic clamping-force generation](https://doi.org/10.1080/002075499190509), [optimal fixturing verification](https://doi.org/10.1109/TASE.2004.835601), and [fixture-workpiece flexible multibody analysis](https://doi.org/10.1016/S0890-6955(99)00067-X).

### 1.3 More clamp force can make the part worse

Increasing preload can:

- elastically bend thin stock;
- buckle a wall;
- crush wood, foam, honeycomb, or a soft polymer;
- indent a functional surface;
- change a bore or flatness while clamped;
- increase friction but reduce free-state dimensional accuracy;
- overload the fixture or fastener.

A deformation-aware model begins with:

~~~text
K(q) u = fclamp + fcut + fthermal + fresidual
~~~

The stiffness K depends on the current remaining material q and on which contacts are open, sticking, or sliding. A safe setup needs both:

- a lower bound on retention;
- an upper bound on allowed contact pressure, clamp force, and deformation.

The software should distinguish:

- machining error while the part is elastically deflected by cutting force;
- springback after the cutting force disappears;
- geometry change after unclamping;
- permanent damage or local yielding.

### 1.4 Clamp torque, force, and holding capacity are different quantities

For a screw clamp, a relation such as:

~~~text
T approximately K F d
~~~

can estimate preload only when the nut factor K is qualified for the exact thread, lubricant, coating, washer, reuse state, corrosion, and device geometry. Most applied torque is consumed by friction, so the same indicated torque can produce materially different clamp force. See [Atlas Copco, tightening technique](https://www.atlascopco.com/en-us/itba/local/web-courses/tightening-technique/lesson-1-why-is-tightening-technique-important).

The product model must distinguish:

- input torque;
- resulting clamp preload;
- device holding capacity;
- locator/contact capacity;
- external process load.

Carr Lane explicitly distinguishes clamp force from holding capacity. See [Carr Lane, toggle-clamp force and capacity](https://www.carrlane.com/engineering-resources/technical-information/manual-workholding/how-do-toggle-clamps-work/holding-capacity-clamping-force).

Production setup data should record:

- exact clamp manufacturer/model and revision;
- clamping height and geometry;
- manufacturer force/torque or force/pressure curve;
- permitted minimum and maximum force;
- thread and lubrication condition;
- torque-tool identity and calibration due date;
- specified tightening sequence;
- verification evidence.

Kurt warns against impact tools, extensions, breaker bars, or hammering on its vise handle, and describes jaw-lift effects from asymmetric loading. See the [Kurt DX4 manual](https://www.kurtworkholding.com/wp-content/uploads/2020/05/DX4-Manual.pdf). Römheld documentation likewise shows clamping force changing with geometry and recommends controlled torque for repeatability. See [Römheld vise documentation](https://ws.roemheld.de/it/download/G97BBZA7Pv?filename=WS54501_EN_0822.PDF).

### 1.5 A clamp command is not clamp evidence

Useful observations can include:

- open/unclamped switch;
- locked or clamped-range switch;
- workpiece-seat confirmation;
- hydraulic/pneumatic pressure;
- drawbar or pull-stud engagement;
- actuator travel;
- sensor plausibility, freshness, and agreement.

Römheld recommends combining seat, clamped-range, and pressure signals before releasing machining. See [Römheld workholding monitoring](https://ws.roemheld.de/en/download/qROwmpWKBv?filename=B1486_EN_0723.PDF). Jergens zero-point modules expose separate open and locked sensors; spring-locked designs also demonstrate why loss of actuator pressure does not have one universal mechanical meaning. See [Jergens monitored zero-point modules](https://www.jergensinc.com/en/product/zps-clamping-modules-with-sensors).

Software must model each device's failure semantics. “Signal true” is not enough without:

- expected state;
- sensor source;
- timestamp and freshness limit;
- diagnostic coverage;
- plausible transition sequence;
- behavior on disagreement or power loss.

Stale, contradictory, or implausible workholding evidence must fail closed.

## 2. Vacuum hold-down is a fluid network plus a contact system

The theoretical normal force is:

~~~text
Fvac = deltaP × Aeffective
~~~

Available frictional resistance is no greater than:

~~~text
Ffriction <= mumin × Fvac
~~~

Those two equations are only a starting screen.

Schmalz advises using the worst load case, a safety factor of at least 1.5 for smooth dense surfaces and 2 or greater for critical, porous, rough, heterogeneous, or oiled workpieces. It explicitly says the actual friction coefficient must be determined by test rather than assumed universally. See [Schmalz, theoretical holding force](https://www.schmalz.com/en-us/support/know-how/vacuum-knowledge/the-vacuum-system-and-its-components/system-design-calculation-example/theoretical-holding-force-of-a-suction-cup).

AMF states that the operating vacuum should be checked continuously, heavy-duty cutting should use stops, and secure location should be checked before machining. Its pressure sensor can stop the machine when vacuum drops. See [AMF Vacuum Clamping Systems](https://www.amf.de/media/wysiwyg/cms/downloadcenter/en-Vacuum-Clamping-Systems.pdf).

### 2.1 High-vacuum and high-flow systems fail differently

Two broad router workflows should not share one generic “vacuum on” state:

**High-vacuum, lower-flow pods or gasketed fixtures**

- high differential pressure over a deliberately sealed area;
- sensitive to a seal breach or imperfect surface;
- each pod or zone may support one part;
- through-cut placement must preserve each sealed circuit.

**Lower-vacuum, high-flow universal spoilboard systems**

- porous spoilboard intentionally leaks;
- pump capacity and flow maintain pressure despite distributed leakage;
- cutting through opens additional leaks;
- small parts have little area and may become unsafe first;
- masking unused area materially changes capacity.

ShopBot's vacuum hold-down guide distinguishes conventional high-vacuum/low-flow fixtures from universal bleeder-board systems and explains that leakage, part area, and through-cuts change hold-down behavior. See [ShopBot Vacuum Hold Down System](https://shopbottools.com/wp-content/uploads/2024/01/ShopBotVacuumHoldDownSystem.pdf).

### 2.2 Effective area changes during the job

The useful area is not the original stock footprint:

~~~text
Aeffective(q) = area still sealed to an active vacuum source at stock state q
~~~

A through-cut can:

- vent a zone directly to atmosphere;
- isolate a finished part from the port;
- split one sealed region into several components;
- connect a large leak to previously healthy zones;
- release the surrounding skeleton while leaving only a small part area;
- uncover spoilboard grooves;
- create a leakage path through porous or warped material.

Therefore the pump condition must hold throughout the process:

~~~text
Qpump(deltaP) >= Qleak(q, deltaP)
~~~

Checking pressure once before Start is not sufficient. The application needs either:

- a conservative predictive model of leak topology plus continuous sensor enforcement; or
- a declared operator-qualified process envelope, with pressure thresholds and stop behavior.

### 2.3 Vacuum must pass force, moment, deformation, and fault checks

For each relevant state, check:

- lateral sliding at lower-bound friction;
- axial lift from an up-cut tool or chip evacuation;
- overturning and yaw moments;
- center of pressure within the supported/sealed footprint;
- local sheet deflection into grooves or voids;
- minimum pressure and adequate pump flow;
- stop/shear-key capacity;
- pressure-decay time after pump or power loss;
- sensor diagnostic coverage and stale-signal behavior;
- whether a released part can be pulled into the cutter or extraction system.

Vacuum itself applies a distributed load. A thin sheet can remain “held” while being bowed into a spoilboard groove, producing dimensional error. Retention and accuracy are separate claims.

### 2.4 Vacuum state model

Minimum entities:

~~~text
VacuumSystem
  pump curve and source identity
  reservoir and check valve
  safe pressure range
  pressure-decay response
  sensor identity and diagnostic state

VacuumZone
  polygon or surface
  ports and manifold connectivity
  gasket or seal path
  spoilboard permeability
  valves and active state
  positive stops

VacuumQualification
  expected sealed components
  minimum effective area per part
  predicted worst leakage
  measured pressure and timestamp
  proof test or provenance
  invalidation events
~~~

## 3. Tabs, skins, ligaments, and part liberation

Autodesk describes tabs as intentionally retained stock that holds the part and allows rectangular or triangular shape, width, height, automatic placement, and manual placement. See [Fusion tabs reference](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-REF-2D-CONTOUR-TABS.htm).

Geometric existence is necessary but not mechanical sufficiency.

### 3.1 First-order tab mechanics

For a rectangular tab of width b, remaining thickness h, and unsupported length l:

~~~text
shear screen:       Vallow approximately tauallow b h
bending screen:     Mallow approximately sigmaallow b h^2 / 6
local stiffness:    k approximately 3 E I / l^3
~~~

These are optimistic because real tabs have:

- cutter-radius notches;
- cyclic loading and vibration;
- unequal load sharing;
- wood grain, laminate direction, voids, or polymer creep;
- prior tool marks and damage;
- load applied close to one tab;
- changing leverage as the last ligament is cut.

The planner needs material-specific allowables or a declared “unqualified” state. It must never imply that four equal-spaced tabs are universally safe.

### 3.2 Tabs need force-aware placement

Equal spacing can place tabs:

- on sharp corners;
- beside a narrow neck;
- all on weak grain direction;
- where the cutter produces maximum moment;
- under a clamp or dust shoe;
- in a feature that will be removed by another operation;
- inside a tile seam;
- over a vacuum leak boundary.

Placement should consider:

- predicted cutting force and moment history;
- part mass and inertia;
- tab material/direction and actual remaining height;
- distance between tabs and resistance to rotation;
- final-liberation direction;
- cleanup accessibility;
- nearby features, clamps, seams, and vacuum zones;
- manual overrides with simulation evidence.

### 3.3 Model the support graph

Represent the evolving stock as a graph:

~~~text
nodes
  finished part islands
  slug islands
  surrounding skeleton
  fixture or table
  clamps and fasteners
  vacuum zones

edges
  uncut ligaments
  tabs
  onion skins
  fasteners
  contact/friction paths
  vacuum retention paths
~~~

Every material-removal event can update connectivity, stiffness, and capacity. A part is mechanically liberated when no qualified path remains between it and the fixture, not merely when a contour's last source line is acknowledged.

The support graph also enables sequencing:

- machine internal features before exterior liberation;
- perform high-force roughing before weakening the skeleton;
- machine fragile or small parts late;
- preserve temporary ribs, floors, tabs, or skins;
- open vacuum zones late;
- assign a low-force final-liberation operation;
- stop and require operator collection where a part cannot be retained after release.

### 3.4 Onion skin is not a generic tab

An onion skin is a continuous thin floor. Its strengths are distributed area and no local gaps; its weaknesses include:

- thickness error from stock variation, warp, probing error, or spoilboard variation;
- peel or membrane failure;
- heat and fuzz in wood/composites;
- difficult cleanup;
- vacuum leakage if the skin is pierced;
- uncertain support if the skin is already partially cut.

The system should store nominal skin thickness, minimum measured thickness, material, and uncertainty. If stock thickness uncertainty is larger than the desired skin, the software cannot claim it exists without probing or measurement.

## 4. Thin sheets, thin walls, and changing dynamics

For an isotropic thin plate:

~~~text
Dplate = E t^3 / [12 (1 - nu^2)]
~~~

For a wall approximated as a cantilever:

~~~text
delta = F L^3 / (3 E I)
I = b t^3 / 12
~~~

Compliance therefore grows approximately with t to the minus third power. Halving thickness can increase bending deflection about eightfold before boundary-condition changes are counted.

### 4.1 The blank and the nearly finished part are different machines

Relative tool-workpiece dynamics can be written:

~~~text
M(q) xddot + C(q) xdot + K(q) x
  = Fcut [x(t - T) - x(t)]

T = 60 / (n Z)
~~~

The remaining-stock state q changes:

- mass;
- stiffness;
- modal frequencies and mode shapes;
- fixture contact state;
- damping;
- tab and support capacity.

A chatter test or stable recipe qualified on the blank is not automatically valid for a nearly finished wall. Research demonstrates position- and geometry-dependent stability in thin-wall milling. See [time-varying thin-wall milling stability](https://doi.org/10.1155/2016/3984186), [workpiece dynamics during milling](https://doi.org/10.1016/j.cirp.2022.04.057), and [thin-wall machining review](https://pmc.ncbi.nlm.nih.gov/articles/PMC6630719/).

### 4.2 Process strategies software should understand

- rough symmetrically when residual stress is important;
- alternate sides or layers to limit imbalance;
- finish supported regions before removing adjacent stock;
- preserve a temporary floor, rib, web, or sacrificial frame;
- use staged wall finishing rather than full-depth exposure;
- reduce radial/axial engagement as stiffness falls;
- change climb/conventional direction when force direction would load a flexible wall adversely;
- use a distributed or profile-matching support for delicate geometry;
- distinguish the clamped machining shape from the free-state finished shape.

### 4.3 Thermal and residual-stress state

Free thermal expansion is:

~~~text
epsilonthermal = alpha deltaT
deltaL = alpha L deltaT
~~~

A temperature gradient through thickness produces curvature. Restrained thermal stress has a scale of E alpha deltaT, subject to actual constraints.

Material removal can also release bulk residual stress. Thin aerospace parts may remove most of the original stock, and asymmetric removal can cause large distortion even with modest instantaneous cutting force. See [residual-stress redistribution in thin-wall machining](https://doi.org/10.1016/S1000-9361(11)60325-7) and [machining stress and initial geometry](https://pmc.ncbi.nlm.nih.gov/articles/PMC7143653/).

An interruption adds a time dimension:

- a hot part cools;
- a vacuum seal relaxes;
- polymer creeps;
- clamp preload changes;
- the fixture and stock expand or contract differently;
- residual-stress springback continues after a release cut.

A hot single-point probe result is not proof of a cold final pose.

## 5. Fixture collision requires swept volumes and setup state

A clamp is not a 2D forbidden rectangle. Collision participants include:

- cutter flutes and shank;
- tool holder, collet, nut, and gauge line;
- spindle nose;
- dust shoe, brush, coolant nozzle, probe, and extraction hardware;
- gantry, Z carriage, table, rotary, and machine enclosure;
- clamps, fasteners, vises, jaws, stops, pins, vacuum pods, spoilboard screws;
- workpiece and current in-process stock.

### 5.1 The required geometry

Each setup should bind:

- fixture component meshes or conservative primitives;
- machine-coordinate transform and uncertainty;
- component state such as jaw open/closed or swing clamp retracted/extended;
- tool assembly geometry for each operation;
- machine kinematics;
- clearance and uncertainty margins;
- active time interval or operation phase.

Collision is a swept-volume query:

~~~text
swept(machine + tool assembly, trajectory, state)
  intersect
fixture + stock + machine
~~~

For 2.5D routers, conservative cylinders and boxes can provide a useful first stage, but Z height and tool/holder radius are non-negotiable. For arcs, the actual arc must be swept; an endpoint chord is not equivalent.

### 5.2 Initial and uncommanded motion matter

Preflight must include:

- current measured head pose to the first commanded pose;
- homing and recovery moves;
- tool-change position;
- probing and touch-off moves;
- retract and re-entry paths;
- controller-generated or post-generated linking motion;
- jog, frame, and click-to-position motion;
- feed-hold deceleration and fault-stop uncertainty where relevant.

A safe NC file cannot prove a safe approach if the software does not know where the machine starts.

### 5.3 Preview and verification are different

Autodesk distinguishes animation from verification. Its machine simulation can use machine kinematics and the post processor and report machine-stock, machine-fixture, and machine-machine collisions, axis overtravel, and rapid cutting. The lighter non-machine view is less representative. See [Fusion manufacturing simulation](https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-REF-SIMULATION).

The product lesson is to label evidence honestly:

- path preview;
- stock-removal approximation;
- conservative tool-envelope check;
- machine-kinematic collision verification;
- workholding mechanics qualification;
- physical dry run or proven production process.

These are not interchangeable badges.

## 6. What mature CAM and controls model

### 6.1 Fusion: setup is a first-class manufacturing object

Fusion's setup workflow binds:

- machine;
- bodies/model;
- work coordinate orientation and origin;
- stock size and shape;
- WCS output offset;
- operations;
- optionally fixtures and machine simulation context.

See [Fusion, create a setup](https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-CREATE-SETUP). Fusion also exposes automatic in-process stock so the simulated result of preceding operations can feed later visualization and remaining-stock reasoning. See [Fusion Automatic In-Process Stock](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-IN_PROCESS_STOCK.htm).

This is still not a proof of real clamp preload, vacuum pressure, or actual stock pose. The architecture lesson is the setup boundary: machine, WCS, stock, fixture, tool assembly, operations, and post context belong together and must invalidate dependent results when changed.

### 6.2 Industrial controls can interlock clamp state

Haas M90 enables fixture-clamp input monitoring; when the configured input indicates incomplete clamping and the spindle is commanded on, the control raises a fixture-clamp alarm. M91 disables monitoring. See [Haas M90/M91](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dmill.value%3DM90.html).

This small feature carries a large lesson:

- a clamp expectation has a lifecycle;
- its sensor has a configured identity;
- spindle permission can depend on it;
- the monitoring state is explicit and auditable;
- a missing clamp is a control fault, not a dismissible tooltip.

KerfDesk should support controller-native interlocks where available and must not replace safety-rated hardware with browser logic.

### 6.3 Open systems are valuable architecture references

FreeCAD Path/CAM is useful because it exposes a setup-like Job object, stock, fixtures, tools/controllers, operations, postprocessing, and simulation in public source. Its value here is architectural auditability, not a claim that every workholding risk is solved. See the [FreeCAD repository](https://github.com/FreeCAD/FreeCAD) and its Path/CAM sources.

LinuxCNC is useful at the controller boundary because work offsets, interpreter state, external I/O, probing, remapping, and HAL/ClassicLadder integrations are public. It demonstrates how machine and auxiliary state can be explicit, but a generic controller still cannot infer real part retention from G-code alone. See [LinuxCNC documentation](https://linuxcnc.org/docs/stable/html/).

CAMotics is useful as an open NC simulation reference, but geometric stock simulation is not fixture mechanics or physical-state evidence. See the [CAMotics repository](https://github.com/CauldronDevelopmentLLC/CAMotics).

The correct conclusion is not “copy product X.” It is:

- use a first-class setup object;
- separate planned geometry from measured physical state;
- preserve current in-process stock;
- model full tool/fixture envelopes;
- expose controller interlocks;
- make restart a new qualification transaction.

### 6.4 FreeCAD CAM: setup aggregation, terminology traps, and tab fallback

FreeCAD's public CAM sources make several boundaries visible:

- the Job aggregates cloned models, a stock solid, operations, tools, a setup sheet, and a Fixtures list;
- in this context, Fixtures is primarily a list of work-coordinate identifiers such as G54/G55, not necessarily physical vise/clamp solids;
- stock can be constructed as a box, bounding box, or cylinder and is used for planned visualization;
- tags are a geometric path dress-up with width, height, position, angle, radius, and enabled state;
- probing creates motion intent but post/controller behavior still determines what is measured and committed.

This is a terminology hazard: “fixture” may mean coordinate offset in one subsystem and collision/workholding hardware in another.

The tag failure behavior is especially instructive. In public source, problematic tags may be disabled, and an exception can clear the dress-up tags and fall back to the undressed source path. A technically valid full-depth path may therefore survive after the intended retention feature is lost. The production rule should be the opposite: required support loss is a hard compile/post error.

Sources: [FreeCAD Job.py](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/CAM/Path/Main/Job.py), [Stock.py](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/CAM/Path/Main/Stock.py), [Fixture.py](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/CAM/Path/Main/Gui/Fixture.py), [Tags.py](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/CAM/Path/Dressup/Tags.py), [Probe.py](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/CAM/Path/Op/Probe.py), and [simulation roadmap](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/CAM/Roadmap/Functionality/Simulation%20and%20Verification.md).

### 6.5 CAMotics and Kiri:Moto: useful visualization, incomplete fixture truth

CAMotics projects combine NC files, tools, and cuboid workpiece stock. Its documented tool length refers to the cutting region rather than a full holder/shaft/machine assembly. There is no documented first-class physical clamp, pallet, holder, or machine model. It is valuable for material-removal visualization and basic NC sanity, but a CAMotics pass is not fixture-clearance evidence. Sources: [CAMotics manual](https://camotics.org/manual.html), [supported G-code](https://camotics.org/gcode.html), and [repository](https://github.com/CauldronDevelopmentLLC/CAMotics).

Kiri:Moto exposes ordered CAM operations, stock, origin, tools, device/process/controller profiles, animation, and tabs. Its profiles can include raw macro text for header, footer, spindle, dwell, and tool change. Public documentation does not show an equivalent first-class clamp/fixture/keep-out state, and an open request asks for vise-jaw exclusion outside the stock boundary. Sources: [Kiri:Moto repository](https://github.com/GridSpace/grid-apps), [CAM interface](https://docs.grid.space/kiri-moto/CAM/interface/), [machine setup](https://docs.grid.space/kiri-moto/CAM/machines/), and [vise-jaw keep-out request](https://github.com/gridspace/grid-apps/issues/475).

Raw macros are an architectural boundary. They are untyped controller side effects. A generic simulator cannot safely infer their preconditions, modal effects, auxiliary motion, or workholding result unless those effects are modeled explicitly.

### 6.6 bCNC and LinuxCNC: coordinate/probe state is not physical setup state

bCNC supports probing, XY probe grids/autolevel, tool probing, camera/G92 workflows, and tool-change policies. An autolevel map is a host-side surface transform tied to:

- one physical stock placement;
- its map origin;
- one WCS/local-offset epoch;
- the exact compensated output.

Disconnect, rehoming, reclamping, or a coordinate change can make a numerically valid map physically stale. Sources: [bCNC repository](https://github.com/vlachoudis/bCNC) and [ProbePage.py](https://github.com/vlachoudis/bCNC/blob/master/bCNC/ProbePage.py).

LinuxCNC persists G54-G59.3 offsets in its VAR file. G10 can assign offsets, probe results are exposed in numbered parameters, and G92/G52 share registers with persistence behavior that must be understood. The official run-from-line warning states that earlier state is not fully reconstructed. Sources: [LinuxCNC coordinate systems](https://linuxcnc.org/docs/stable/html/gcode/coordinates.html), [G-code reference](https://www.linuxcnc.org/docs/html/gcode/g-code.html), and [LinuxCNC user manual](https://www.linuxcnc.org/docs/2.6/pdf/LinuxCNC_User_Manual.pdf).

A persisted offset number proves neither:

- machine homing epoch;
- actual fixture/pallet identity;
- part seating;
- unchanged local rotations or G92/G52;
- valid probe map;
- unchanged clamp/vacuum/support state.

### 6.7 Higher-end commercial patterns: richer digital twins, still planned state

Siemens NX CAM publicly describes:

- workpiece, fixture, tool/holder, and machine digital-twin context;
- operation-by-operation in-process workpiece;
- workholding-device libraries and placement;
- part-to-holder relationships;
- G-code-driven machine simulation with material removal.

Sources: [NX integrated setup](https://blogs.sw.siemens.com/nx-manufacturing/cad-cam-integration-nx-cam/), [automatic in-process workpiece](https://blogs.sw.siemens.com/nx-manufacturing/let-nx-cam-create-your-in-process-material-models-automatically/), [workholding-device management](https://blogs.sw.siemens.com/nx-manufacturing/whats-new-in-cam-for-nx-2512-integrated-work-holding-device-management/), and [G-code-driven machine simulation](https://blogs.sw.siemens.com/nx-manufacturing/ev-component-manufacturing-part-4/).

Mastercam publicly describes probing for work offsets, in-process inspection, warning/stop behavior, and fixture-misalignment correction using coordinate-system rotation. Its guidance to move to safe Z before applying or canceling a rotation illustrates why transforms are safety-relevant modal state. Sources: [Mastercam probing](https://www.mastercam.com/solutions/add-ons/mastercam-probing/) and [fixture-misalignment correction](https://www.mastercam.com/community/blog/mastercam-probing-how-to-correct-fixture-misalignment-with-coordinate-system-rotation/).

These systems show a strong digital architecture, but the same evidence boundary remains: the digital twin is planned state until physical identity, seating, pressure, probe, and sensor results reconcile it with the machine.

## 7. Tiling and re-indexing are multi-setup transactions

Sliding a long sheet and re-zeroing XY is not merely a geometric transform. Each tile is a new physical setup with:

- stock orientation and face;
- pallet/fixture identity;
- registration feature identity;
- pin/hole fit and clearance;
- clamp/vacuum state;
- tile-specific WCS;
- Z datum;
- already removed material;
- remaining tabs and support skeleton;
- execution history.

### 7.1 Registration features require their own process

A qualified registration-hole operation needs:

- dedicated tool identity and geometry;
- material-compatible drill strategy;
- hole diameter and tolerance;
- pin diameter, fit class, and insertion depth;
- stock and backing thickness;
- breakthrough and spoilboard allowance;
- chip evacuation;
- collision-free location;
- sequence before the stock is weakened;
- proof that the holes remain intact and accessible in the next setup.

A constant depth and inherited arbitrary tool are not enough.

### 7.2 Clipping a toolpath changes its semantics

When a closed contour is clipped to a tile:

- it becomes an open path;
- its lead-in and ramp may be removed;
- the new first point may lie in uncut stock;
- its tab placement can be cut away or duplicated;
- cut direction and compensation assumptions can change;
- overlap may recut a released edge;
- vacuum/support topology changes at the seam.

The planner must regenerate or requalify the operation after clipping. It cannot assume that geometrically intersecting the old path with a rectangle preserves safe entry and support.

### 7.3 Tile execution state machine

Suggested states:

~~~text
planned
  -> registration_features_created
  -> tile_fixture_prepared
  -> tile_identity_confirmed
  -> pins_or_datums_verified
  -> clamping_qualified
  -> tile_wcs_qualified
  -> dry_run_or_clearance_verified
  -> cutting
  -> tile_complete
  -> transfer_authorized
~~~

Every transition records evidence. A tile resume must prove the same tile, orientation, registration, WCS, and stock revision. “Row 2, column 1” is not a physical identity.

## 8. Interruption and restart

The execution cursor is only one part of restart state.

After interruption, potentially unknown state includes:

- machine position and axis trust;
- tool identity, length, breakage, and engagement;
- spindle state;
- clamp preload and seated contacts;
- vacuum pressure, valves, sealed area, and leak topology;
- fixture, pallet, tile, and workpiece identity;
- part translation, rotation, lift, or bow;
- tab and ligament integrity;
- chips or coolant under locators;
- stock temperature;
- remaining stock and released islands;
- work offset and probe validity;
- current structural dynamics.

### 8.1 Program identity versus physical-state authority

A deterministic fingerprint answers:

> Is this the same sequence of bytes?

It does not answer:

> Is this the same physical stock, in the same pose, on the same fixture, with the same support and retention state?

Both must pass. Physical-state authority should be represented by an evidence-bearing claim:

~~~text
PhysicalCheckpoint
  setupId and setupRevision
  fixtureAssemblyId and measured transform
  palletId, tileId, stockId, partId
  inProcessStockRevision
  supportGraphRevision
  expected intact tabs, skins, and ligaments
  required clamp states and evidence
  required vacuum zones, pressure, and evidence
  WCS and multi-datum probe result
  tool assembly and tool-length evidence
  thermal/soak condition where relevant
  maximum position uncertainty
  createdAt and invalidation events
~~~

### 8.2 Safe restart protocol

1. Stop and make energy state safe.
2. Establish machine-position trust, normally by homing or an equivalent qualified procedure.
3. Identify the fixture, pallet, workpiece, face, and tile.
4. Confirm required clamps, fasteners, stops, vacuum zones, pressure, and sensors.
5. Inspect tabs, skins, support skeleton, and liberated parts.
6. Probe multiple independent datums to detect translation and rotation; one point is insufficient.
7. Compare results with checkpoint tolerances.
8. reconstruct or verify in-process stock and remaining material.
9. Re-run fixture/tool/machine swept-volume checks from the actual current head pose.
10. Recalculate workholding and fragile-region process limits.
11. Select a controlled re-entry path with spindle/tool behavior appropriate to whether the cutter is clear, touching, or embedded.
12. Require operator authorization for the regenerated plan.

Automatic resume should be refused when:

- part or fixture identity is unknown;
- the workpiece was unclamped or re-clamped without requalification;
- a pallet or tile changed;
- tab/skin/support integrity is unknown;
- vacuum history or current capacity is inadequate;
- part pose is outside tolerance;
- actual stock cannot be reconciled with the expected state;
- tool condition or length is unknown;
- the system cannot produce a collision-free re-entry;
- the part was already mechanically liberated.

### 8.3 Embedded-tool interruption

The user's original example belongs here. If power or control is lost while a cutter is engaged:

- starting the spindle while stationary can rub, catch, or jam the bit;
- retracting a stopped cutter can also bind or damage the part;
- moving laterally before spindle speed is established can create a full-width unplanned cut;
- starting while vacuum/clamps are unqualified can throw the part;
- restarting at the old depth can cut already removed air, an uncut cusp, or a shifted wall.

There is no universal sequence. The recovery depends on:

- tool type and material;
- whether the cutter is actually embedded;
- known/unknown axis position;
- spindle ability to start under contact;
- safe retract direction;
- remaining-stock geometry;
- workholding state.

The software must classify the recovery and stop pretending one generated preamble is safe for every router interruption.

## 9. Current KerfDesk source audit

Snapshot audited: C:\Users\Asus\LaserForge\audit-current-main at e752a9125f02f832144c3b40800840ee5973fcf2.

### 9.1 Stock is only a box plus material label

src/core/scene/machine.ts:22-38 defines stock thickness, width, height, XY origin offset, and optional material key. It has no:

- stock identity or revision;
- measured thickness map or uncertainty;
- actual pose evidence;
- fixture or pallet;
- clamps, fasteners, stops, or supports;
- vacuum zones or pressure;
- spoilboard;
- remaining-stock topology;
- part-island identity;
- thermal state.

The comment at lines 25-27 explicitly describes leaving the stock footprint as an advisory and makes clamps/offcuts the operator's responsibility. That is a valid UI policy only if the product does not claim safe-to-write based on incomplete geometry.

### 9.2 Automatic tabs can report success while cutting a closed profile

src/core/geometry/tabs-bridges.ts:69-87 returns the original closed polyline when:

- the tab size is at least the whole perimeter;
- the polyline is otherwise not splittable.

Lines 76-79 also return the original closed polyline if no skip or burn segment survives. The failure mode is dangerous: “tabs enabled” becomes “burn the entire contour” rather than a blocked plan or a fully retained contour.

Tab centers are evenly distributed at src/core/geometry/tabs-bridges.ts:137-148. There is no curvature, corner, grain, support, clamp, vacuum, force, or manual-placement model.

src/core/cnc/cnc-tabs.ts:21-29 derives the tab top from requested cut depth. src/core/cnc/cnc-tabs.ts:37-44 adds one tool diameter to the skip width and applies tabs to every closed contour, including hole slugs. The tool-width compensation and slug intent are useful, but:

- there is no check that split geometry contains the requested bridges;
- the reference is cut floor, not stock bottom;
- through-cut allowance reduces actual bridge height above the real bottom;
- tab strength and connectivity are unknown.

src/ui/layers/CncLayerAdvancedFields.tsx:260-293 labels tab height as material left from the cut floor and offers only height, width, and count. The warning in src/ui/laser/cnc-through-cut-tab-warnings.ts is advisory and triggers only when tabs are disabled. It cannot detect enabled-but-absent or mechanically inadequate tabs.

### 9.3 No-go zones do not describe fixtures

src/core/devices/device-profile.ts:86-94 defines an enabled XY rectangle only. src/ui/laser/SafetyZonesPanel.tsx describes those rectangles as machine-coordinate keep-outs for clamps and fixtures.

src/core/preflight/no-go-zones.ts:

- stores only XY points and rectangles at lines 15-27;
- checks straight line/rectangle intersection at lines 121-128;
- parses only X and Y endpoints at lines 75-86 and 106-118;
- skips a collision check when current is null at lines 94-104.

Consequences:

- Z clearance is ignored;
- cutter radius, shank, holder, spindle, and dust-shoe envelopes are ignored;
- arcs are reduced to endpoint chords;
- the first approach is not checked from actual machine position;
- fixture transform uncertainty and setup identity are absent;
- a high safe crossing can false-alarm while a low holder collision can be missed.

### 9.4 CNC preflight overstates its evidence

src/core/preflight/cnc-preflight.ts:1-15 says an empty issue list means safe-to-write. Its checks cover:

- output presence;
- scalar depth/feed/RPM validity;
- depth versus stock thickness and allowance;
- bed bounds;
- the 2D no-go scan;
- rapid/plunge invariants;
- nonempty output;
- final-text depth.

Those are useful program invariants. They do not establish:

- workholding capacity;
- fixture/workpiece identity or pose;
- clamp or vacuum state;
- full swept-volume clearance;
- tab materialization or strength;
- support connectivity and part liberation;
- actual stock;
- start pose;
- tiling registration;
- restart state.

The result should be named program preflight or geometry preflight until physical prerequisites are represented separately.

### 9.5 Stock warnings ignore cutter envelope

src/ui/laser/cnc-stock-warnings.ts computes the stock rectangle and compares it with job bounds. The warning remains advisory. CNC job bounds in src/core/job/job-bounds.ts are derived from path points, not a swept cutter/holder radius. An on-path or engraving centerline at the stock edge can therefore “fit” while the cutter removes material outside the stock or strikes a clamp/spoilboard.

### 9.6 Tiling mutates operations without process requalification

src/core/cnc/tile-plan.ts:1-8 says the operator slides stock, re-zeros XY, and uses shared registration holes. Lines 80-90 first append clipped CNC groups and then append registration.

The registration operation at lines 261-293:

- copies the first CNC group;
- forces cutType to drill;
- uses its tool identity, RPM, plunge, safe Z, and other recipe fields;
- uses a constant 3 mm depth;
- appends the holes after the tile's cutting groups.

No pin diameter, hole diameter, fit, dedicated drill, backing material, stock thickness, breakthrough, collision, or accessibility is modeled.

The path clipping can turn closed passes into open fragments. It preserves interpolated Z geometry, which is good, but does not regenerate:

- safe entry/ramp;
- lead-in;
- tab/support strategy;
- vacuum topology;
- final-liberation order;
- holder/fixture clearance.

There is no tile execution transaction or evidence that the operator loaded the intended tile, orientation, registration, and WCS.

### 9.7 Checkpoint and resume omit physical state

src/core/recovery/job-checkpoint.ts:44-68 stores:

- schema version;
- G-code fingerprint;
- sendable/acknowledged lines;
- resume-in-flight;
- machine kind;
- output scope and resolved origin;
- timestamps.

It explicitly notes that an acknowledgement means parsed into the RX buffer, not executed. That is an important distinction. But the checkpoint has no physical-state fields.

src/core/controllers/grbl/resume-program.ts:174-193 currently:

1. commands spindle and dwell;
2. then retracts to safe Z;
3. rapids to recorded XY;
4. plunges vertically to recorded depth;
5. restores feed.

This sequence assumes the cutter can safely start where it stopped, the safe-Z retract is unobstructed, the recorded XY/depth is still physically valid, and the old part/support state remains true. Those assumptions are not proved.

## 10. Proposed architecture

### 10.1 Core entities

~~~text
ManufacturingSetup
  id, revision, machineId
  WCS definition and qualification
  StockInstance
  FixtureAssembly
  ToolAssemblies
  operation plan
  post/controller context
  provenance and invalidation graph

StockInstance
  serial/identity
  material and batch
  nominal geometry
  measured thickness/pose map
  uncertainty
  in-process stock revision
  topology/support graph
  thermal state

FixtureAssembly
  pallet/base/spoilboard identity
  measured transform
  locators and supports
  clamps/fasteners
  vacuum systems/zones
  collision geometry and state

ToolAssembly
  cutter, shank, holder, collet/nut
  gauge length and measured length
  collision envelope
  process qualifications

PartIsland
  intended part or slug
  current geometry
  support connections
  retention demand/capacity
  liberated state

WorkholdingPermit
  setup and stock revision
  operation interval
  required contact/clamp/vacuum state
  force/moment envelope
  capacity margins
  sensor/probe evidence
  expiresOn/invalidation events
~~~

### 10.2 Separate four types of truth

| Truth | Example | Source |
| --- | --- | --- |
| Design truth | Clamp should be at X/Y/Z with 2 kN preload | setup plan |
| Command truth | M-code commanded clamp or vacuum | emitted program/controller |
| Observed truth | Pressure switch active, probe transform measured | sensor/probe evidence |
| Physical inference | Part remains retained for this force envelope | qualification engine |

One must never silently substitute for another. A clamp command is not confirmation. A pressure signal is not proof of effective sealed area. A CAD fixture mesh is not proof of its actual pose.

### 10.3 Invalidation graph

Derived artifacts should record their dependencies:

~~~text
toolpath
  depends on model, stock, tool, operation, WCS

collision verification
  depends on toolpath, machine, tool assembly, fixture state/transform

workholding permit
  depends on stock revision, support graph, contacts, vacuum, force envelope

resume permit
  depends on program identity, execution cursor, physical checkpoint,
  actual head pose, tool condition, and re-entry path
~~~

Change any dependency and the status becomes stale. The UI should show stale/unknown explicitly rather than retaining a green check.

### 10.4 Capability tiers

**Tier 0: honest manual declaration**

- stock dimensions and identity;
- fixture/clamp/vacuum checklist;
- 3D/Z-aware keep-outs;
- tool diameter/holder clearance;
- explicit unqualified warnings;
- no autonomous resume.

**Tier 1: deterministic geometric qualification**

- setup object;
- fixture primitives/meshes;
- tool assembly swept volumes;
- stock/topology updates;
- tab materialization proof;
- tile transactions;
- actual start-pose collision scan.

**Tier 2: sensed physical qualification**

- clamp inputs;
- pressure/vacuum sensors;
- probe-based multi-datum pose;
- pallet/tool identity;
- measured stock thickness;
- timestamped evidence and invalidation.

**Tier 3: mechanics-aware planning**

- cutting wrench envelope;
- contact/retention solver;
- vacuum leak topology;
- tab/skin capacity;
- thin-part stiffness/dynamics;
- force-aware sequencing and automatic derating.

Do not wait for Tier 3 before fixing Tier 0/P0 false assurances.

## 11. Safety invariants

### P0: false-safe and dangerous execution

1. Tabs enabled must never emit a fully closed final through-cut unless the plan explicitly says no retaining bridge is required.
2. Emitted tab geometry must prove minimum actual bridge width and height relative to measured/qualified stock bottom.
3. CNC Start must not claim physical safety from 2D centerline no-go rectangles.
4. Collision checking must include actual start pose, Z, cutter radius, and a conservative holder envelope.
5. Arc collision must follow the arc, not its chord.
6. Registration features must use an explicit qualified tool/recipe and execute before operations that depend on them.
7. A clipped tile operation must be regenerated or requalified for entry, tabs, support, and collision.
8. Resume must not start an embedded or possibly embedded spindle/tool using a universal preamble.
9. Resume must require a physical-state permit in addition to byte identity.
10. Vacuum-dependent cutting must have a minimum-pressure response and, for heavy lateral work, qualified positive stops or equivalent shear retention.

### P1: architecture and evidence

1. Introduce ManufacturingSetup and StockInstance identity/revision.
2. Add FixtureAssembly and ToolAssembly geometry.
3. Build support/topology state and part-island liberation events.
4. Store clamp/vacuum requirements and observed evidence.
5. Make stock-fit checks use swept cutter envelope and join preflight.
6. Make tile execution a transactional multi-setup workflow.
7. Separate program preflight, collision verification, workholding qualification, and operator authorization.
8. Add invalidation dependencies and stale-state UI.

### P2: process intelligence

1. Force/moment envelope and contact feasibility.
2. Vacuum network/leak simulation.
3. Tab/skin strength screening.
4. Thin-part stiffness and changing dynamics.
5. thermal/residual-stress-aware planning.
6. Production evidence and process-capability feedback.

## 12. Verification matrix

### 12.1 Tabs and support

- requested tab span equals or exceeds perimeter;
- several tab intervals merge to cover the whole perimeter;
- tab size is NaN, zero, negative, or extreme;
- small inner slug and small outer part;
- through-cut allowance consumes intended tab height;
- warped/thickness-varying stock makes a nominal skin disappear;
- one tab breaks and remaining load redistributes;
- tabs placed near corners, thin necks, tile seams, clamps, and vacuum boundaries;
- internal features are sequenced after exterior support is weakened;
- final contour liberates a part into the cutter.

### 12.2 Collision

- high-Z travel safely crosses a short clamp;
- low-Z holder crosses it while cutter center misses;
- cutter radius overlaps a zone while centerline is outside;
- arc bows into a fixture although its chord does not;
- chord intersects a fixture although the arc does not;
- first move from actual parked pose crosses a clamp;
- dust shoe or collet collides before the cutter;
- fixture transform error consumes clearance;
- clamp changes state between operations;
- restart path is checked from actual head pose.

### 12.3 Vacuum

- sealed area falls 80 to 90 percent after profiles;
- one kerf vents a shared manifold;
- one small part isolates from the port;
- porous stock increases leakage;
- pump power loss and pressure decay;
- stuck-high, stale, missing, or implausible sensor;
- lateral cutting at lower-bound wet/oily friction;
- up-cut force and overturning at maximum lever arm;
- thin sheet bows into table channels;
- unused table area is unmasked;
- pressure is valid before Start but fails after a through-cut.

### 12.4 Fixture mechanics

- one locator not seated;
- chips under the primary datum;
- one clamp 30 percent below nominal preload;
- excessive clamp force distorts the part;
- load reverses direction around a contour;
- emergency deceleration adds inertial load;
- high-force entry occurs farthest from a stop;
- clamping sequence changes seating;
- free-state part fails tolerance after unclamp.

### 12.5 Thin parts

- half the wall thickness with old recipe reused;
- adjacent support stock removed early;
- chatter-stable blank becomes unstable near finish;
- asymmetric roughing releases residual stress;
- part pauses hot and resumes cold;
- vacuum or clamps print through thin stock;
- single-point probe passes despite rotated/bowed part.

### 12.6 Tiling and restart

- clipped closed contour begins with vertical plunge into stock;
- tab lies on seam and is removed in both tiles;
- registration uses V-bit/engraving tool;
- constant 3 mm registration depth is too shallow or too deep;
- holes run after the tile is weakened;
- wrong tile or 180-degree stock orientation;
- pin clearance creates accumulated skew;
- operator re-zeros XY but not Z;
- same G-code fingerprint with different pallet/fixture/stock;
- part re-clamped at different force;
- checkpoint line acknowledged but not executed;
- part already liberated before interruption;
- cutter stopped embedded;
- tool changed but length evidence is stale.

## 13. Focused implementation order for KerfDesk

### Slice A: remove current false-safe behavior

1. Make tab-split failure explicit and block through-cut output.
2. Verify final emitted tab width/height against stock bottom and allowance.
3. Rename current result to program/geometry preflight.
4. Add start-pose input and conservative 3D tool envelope to fixture zones.
5. Sweep arcs correctly.
6. Move registration to an explicit qualified pre-operation and refuse inherited arbitrary tools.
7. Block resume when the cutter may be embedded; require an operator recovery classification.

### Slice B: first-class setup

1. Add ManufacturingSetup, StockInstance, FixtureAssembly, and ToolAssembly.
2. Add fixture primitives/mesh transform and Z-aware state.
3. Bind job compilation, simulation, post, checkpoint, and tiling to setup revision.
4. Make stock-fit use swept tool geometry.
5. Add evidence status: planned, observed, qualified, stale, unknown.

### Slice C: topology and multi-setup state

1. Build part-island/support graph from intended through-cuts.
2. Track tabs, skins, fasteners, and vacuum-zone connectivity.
3. Emit liberation events and sequence high-force work before them.
4. Implement tile/setup identity and transfer transactions.
5. Extend checkpoint with physical state and invalidation.

### Slice D: mechanics and sensing

1. Clamp/vacuum sensor integration.
2. Multi-datum probing and pose covariance/tolerance.
3. Vacuum capacity/leak topology.
4. Force/moment workholding screen.
5. Thin-part stiffness/process derating.

Every slice should land with adversarial tests and explicit evidence boundaries.

## 14. Production qualification and operating workflow

### 14.1 Process qualification

1. Identify stock, material condition, tolerance, surface condition, and temperature range.
2. Define locators, supports, clamps, fasteners, seals, spoilboard, and vacuum topology.
3. Generate a six-axis cutting/inertial load envelope, including entry, exit, drilling thrust, ramp, acceleration, and relevant fault transients.
4. Solve retention, lift, sliding, overturning, contact pressure, and deformation margins.
5. Simulate every topology-changing cut, not only the final stock.
6. Check machine, tool assembly, fixture, support, and stock collision over actual postprocessed motion.
7. Select clamp torque/pressure, vacuum pressure/flow, leakage, and sensor thresholds.
8. Perform measured clamp-force and leak/stability qualification.
9. Run the worst qualified operation under controlled guarding and observation.
10. Record pressure, flow, spindle load, vibration/displacement where applicable, and finished-part results.
11. Freeze the approved setup, stock, tool, CAM, post, and controller revisions.

### 14.2 Setup release

1. Verify fixture, pallet, soft-jaw, spoilboard, and program identities/revisions.
2. Clean locators, support faces, zero-point faces, pods, gasket channels, and stock.
3. Inspect seals, hoses, filters, separators, jaws, threads, fasteners, and friction surfaces.
4. Verify spoilboard flatness and stock thickness/warp.
5. Confirm torque-tool and sensor calibration.
6. Seat and tighten the workpiece in the qualified order.
7. Confirm seat, locked, clamp-range, and pressure evidence.
8. Evacuate active zones and perform the specified leak/stability test.
9. Measure pressure at the workpiece circuit, not only at the pump.
10. Probe independent datums and relevant stock surfaces.
11. Reconcile observations with the setup's assumptions.
12. Perform a dry, frame, or reduced-risk clearance check appropriate to the machine.
13. Release machining only when all required evidence is current.

### 14.3 Runtime supervision

Monitor, as applicable:

- clamp/seat state;
- vacuum at pump, reservoir, manifold, zone, or pod;
- pressure rate of change and leakage flow;
- pump saturation/duty;
- valve state;
- filter and separator condition;
- sensor plausibility and freshness;
- expected stock/support topology stage;
- spindle load, vibration, or other secondary anomaly signals.

If holding margin is lost:

1. prevent new cutting motion;
2. execute the machine-specific controlled-stop response;
3. retract only if the remaining holding state makes retraction safer;
4. transition spindle and auxiliary energy to the qualified state;
5. invalidate the setup and checkpoint;
6. require inspection, re-clamping, leak test, and datum recovery;
7. refuse automatic continuation from the interrupted block.

### 14.4 Inspection and maintenance

Before each setup:

- clean seating surfaces;
- inspect seals, pods, jaws, hoses, fasteners, and spoilboard;
- verify torque-tool calibration;
- test required sensors;
- perform the vacuum stability test.

Per batch or shift:

- record achieved pressure and evacuation time;
- compare leakage with baseline;
- inspect filters and separators;
- inspect tabs/skins and part-movement evidence;
- check pallet/zero-point repeatability;
- review near-threshold events.

Periodically:

- measure actual clamp force;
- test pressure switches, seat, and lock sensors;
- test reservoir hold time and pump-failure response;
- replace seals and friction pads;
- surface or replace spoilboards;
- verify fixture flatness/stiffness;
- calibrate pressure, flow, displacement, and torque instruments;
- requalify after material, coolant, cutter, feed, fixture, post, CAM, or controller changes.

## 15. Standards and guarding boundary

The public standard abstracts establish scope; implementation requires access to and engineering review of the full applicable standards:

- [ISO 16090-1:2022](https://www.iso.org/standard/81558.html) covers safety for milling machines and machining centres, including powered workpiece clamping within its scope.
- [ISO 19085-3:2021](https://www.iso.org/standard/75953.html) covers numerically controlled boring/routing machines with mechanical, pneumatic, hydraulic, or vacuum clamping within its scope.
- [OSHA 29 CFR 1910.212](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.212) requires guarding against point-of-operation hazards, rotating parts, flying chips, and similar hazards.

A workholding proof does not replace:

- guarding or enclosure;
- emergency-stop and safe-control design;
- spindle/tool containment;
- dust, chip, coolant, fire, and electrical controls;
- competent setup and inspection;
- machine-specific manufacturer requirements;
- formal risk assessment.

KerfDesk is not a safety-rated controller. Browser/application logic may coordinate evidence and refuse unsafe workflows, but must not be represented as a replacement for hardware interlocks or safety functions.

## 16. Source-quality and evidence boundary

Manufacturer sources used here explain intended fixture and vacuum behavior. They do not certify a particular KerfDesk setup.

Academic equations are models whose validity depends on material, boundary conditions, contact, and measurement. They should drive conservative checks and qualification workflows, not marketing claims of automatic safety.

Commercial software documentation shows workflow and represented entities. It does not prove that a product detects every physical hazard.

Open repositories are architecture references and should be audited at a specific revision before any implementation decision. Public code is not automatically safe code.

The local findings are source-confirmed at the snapshot named above. They should be revalidated before implementation if the checkout advances.

## 17. Primary and high-signal references

### Fixture design and mechanics

- [Carr Lane, locating and clamping principles](https://www.carrlane.com/engineering-resources/fixture-design-principles/locating-clamping-principles/ctl)
- [Carr Lane, machining operations and fixture layout](https://www.carrlane.com/engineering-resources/technical-information/power-workholding/design-information/machining-operations-fixture-layout)
- [Carr Lane, toggle-clamp force and capacity](https://www.carrlane.com/engineering-resources/technical-information/manual-workholding/how-do-toggle-clamps-work/holding-capacity-clamping-force)
- [Atlas Copco, tightening technique](https://www.atlascopco.com/en-us/itba/local/web-courses/tightening-technique/lesson-1-why-is-tightening-technique-important)
- [NIST flexible-fixture analysis](https://tsapps.nist.gov/publication/get_pdf.cfm?pub_id=820215)
- [Dynamic clamping-force generation](https://doi.org/10.1080/002075499190509)
- [Optimal fixturing verification](https://doi.org/10.1109/TASE.2004.835601)
- [Fixture-workpiece flexible multibody analysis](https://doi.org/10.1016/S0890-6955(99)00067-X)

### Vacuum

- [AMF Vacuum Clamping Systems](https://www.amf.de/media/wysiwyg/cms/downloadcenter/en-Vacuum-Clamping-Systems.pdf)
- [Schmalz, theoretical holding force](https://www.schmalz.com/en-us/support/know-how/vacuum-knowledge/the-vacuum-system-and-its-components/system-design-calculation-example/theoretical-holding-force-of-a-suction-cup)
- [ShopBot Vacuum Hold Down System](https://shopbottools.com/wp-content/uploads/2024/01/ShopBotVacuumHoldDownSystem.pdf)

### CAM, controls, and public repositories

- [Fusion, create a setup](https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-CREATE-SETUP)
- [Fusion manufacturing simulation](https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-REF-SIMULATION)
- [Fusion Automatic In-Process Stock](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-IN_PROCESS_STOCK.htm)
- [Fusion tabs reference](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-REF-2D-CONTOUR-TABS.htm)
- [Haas M90/M91 fixture-clamp monitoring](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dmill.value%3DM90.html)
- [FreeCAD repository](https://github.com/FreeCAD/FreeCAD)
- [LinuxCNC documentation](https://linuxcnc.org/docs/stable/html/)
- [CAMotics repository](https://github.com/CauldronDevelopmentLLC/CAMotics)
- [Kiri:Moto repository](https://github.com/GridSpace/grid-apps)
- [bCNC repository](https://github.com/vlachoudis/bCNC)
- [NX workholding-device management](https://blogs.sw.siemens.com/nx-manufacturing/whats-new-in-cam-for-nx-2512-integrated-work-holding-device-management/)

### Thin parts, dynamics, and residual stress

- [Thin-wall machining review](https://pmc.ncbi.nlm.nih.gov/articles/PMC6630719/)
- [Time-varying thin-wall milling stability](https://doi.org/10.1155/2016/3984186)
- [Workpiece dynamics during milling](https://doi.org/10.1016/j.cirp.2022.04.057)
- [Fixture contact stiffness and damping](https://doi.org/10.1177/09544054221138165)
- [Residual-stress redistribution in thin-wall machining](https://doi.org/10.1016/S1000-9361(11)60325-7)
- [Machining stress and initial geometry](https://pmc.ncbi.nlm.nih.gov/articles/PMC7143653/)

### Standards

- [ISO 16090-1:2022](https://www.iso.org/standard/81558.html)
- [ISO 19085-3:2021](https://www.iso.org/standard/75953.html)
- [OSHA 29 CFR 1910.212](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.212)

## 18. Verification performed

Documentation:

- Prettier check passed on this dossier.
- Source links were reviewed against the cited manufacturer, official documentation, public repository, standards-abstract, or research pages.
- Local findings were checked against the exact current snapshot and line locations named in section 9.

Focused regression command covered the existing workholding-adjacent suites:

~~~text
pnpm test -- \
  src/core/job/compile-job-tabs-bridges.test.ts \
  src/core/controllers/grbl/resume-program.test.ts \
  src/core/job/job-bounds.test.ts \
  src/core/cnc/tile-plan.test.ts \
  src/core/cnc/compile-cnc-job.test.ts \
  src/core/geometry/tabs-bridges.test.ts \
  src/core/recovery/job-checkpoint.test.ts \
  src/core/preflight/no-go-zones.test.ts \
  src/core/preflight/cnc-preflight.test.ts \
  src/ui/laser/cnc-through-cut-tab-warnings.test.ts \
  src/ui/laser/cnc-stock-warnings.test.ts \
  src/ui/app/use-job-checkpoint.test.ts \
  src/ui/workspace/draw-scene-no-go-zones.test.ts \
  src/ui/workspace/draw-no-go-zones.test.ts \
  src/ui/laser/SafetyZonesPanel.test.tsx \
  src/ui/state/job-checkpoint-storage.test.ts
~~~

Result: 16 test files passed, 103 tests passed.

Those tests show that current intended behavior is internally consistent. They do not refute the audit findings because the critical adversarial cases are absent, including:

- tab span at least equal to perimeter;
- merged tab spans covering the whole contour;
- actual tab height relative to stock bottom and through-cut allowance;
- arc-versus-chord fixture collision;
- initial motion from measured machine pose;
- holder/dust-shoe/Z-aware fixture collision;
- registration-tool qualification and registration-before-cut order;
- clipped-path entry and support requalification;
- physical-state checkpoint and embedded-tool recovery.

## 19. Final engineering rule

Do not ask only:

> Is the toolpath inside the stock and are tabs enabled?

Ask:

> For this identified stock revision, fixture state, support graph, tool assembly, cutting-wrench envelope, and measured pose, does a qualified retention and clearance path exist through every remaining operation and through the proposed recovery path?

If the software cannot answer, it must say “unknown” and require a controlled qualification step. It must never translate missing physical evidence into a green safety result.
