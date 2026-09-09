> **Historical research archive: 11–13 July 2026.** Published on 6 September 2026.
> Findings, scores, source claims and proposed changes below describe their recorded
> baseline; they have not been revalidated and are not current product or qualification
> evidence. Unimplemented proposals are not adopted policy. The current
> [Frame-first contract](../../PROJECT.md) governs application behaviour. See the
> [archive index](2026-09-06-preserved-audits.md) and [source manifest](2026-09-06-preserved-audits-source-manifest.json).

# CNC Turning, Threading, Mill-Turn, and Multi-Channel Architecture

Date: 2026-07-13
Scope: CNC lathe coordinate systems, turning CAM and posts, fixed-RPM and constant-surface-speed control, feed-per-revolution, spindle feedback, threading, tapping, tool-nose compensation, canned cycles, rotating workholding, live tooling, C/Y/B axes, opposed spindles, part transfer, multi-channel coordination, interruption/restart, verification, and implications for KerfDesk
Method: official controller and machine documentation, public-source audits, tooling/workholding manuals, and direct source inspection of `C:\Users\Asus\LaserForge\audit-current-main`

## Executive verdict

A CNC lathe is not a mill with Y removed.

The stock rotates, cutting speed varies with radius, feed can be coupled to measured spindle revolutions, tool geometry is directional, and the workpiece may be held by a chuck, tailstock, steady rest, subspindle, or two chucks at once. A mill-turn machine can switch the same physical spindle between velocity-controlled turning and position-controlled C-axis service, run a separate live-tool spindle, and coordinate two turrets or channels around shared collision zones.

The minimum physical state of a turning cut is:

~~~text
selected controller dialect and machine configuration
+ main/sub/live spindle identity, direction, speed, phase, and mode
+ X diameter/radius convention and XZ/Y/C/B frame stack
+ selected turret station, insert, tool orientation, geometry, and wear
+ active tool-nose compensation and compensated entry/exit state
+ workholding identity, jaw state, grip force, tailstock/steady-rest state
+ stock diameter, projection, remaining geometry, and rotational inertia
+ feed metric and spindle-feedback validity
+ active canned/synchronized cycle and its internal phase
+ channel ownership, wait/barrier state, and shared-resource locks
= actual tool-to-rotating-workpiece motion and retention margin
~~~

The most important cross-controller discovery is that familiar G-code numbers are not portable turning semantics:

| Code | LinuxCNC meaning | Haas lathe meaning |
| --- | --- | --- |
| G94 | units per minute | end-facing canned cycle |
| G95 | units per spindle revolution | live-tool rigid-tapping canned cycle |
| G98/G99 | canned-cycle retract level | feed per minute / feed per revolution |
| G92 | coordinate-system offset | threading cycle |
| G76 | LinuxCNC-specific multi-pass threading fields and behavior | Haas-specific multi-pass threading fields, settings, and behavior |
| G50 | not the Haas CSS-cap contract | spindle-speed limit on current Haas; historically/configuration-dependently also associated with coordinate-setting dialects |

This is not cosmetic. Interpreting a Haas G95 block as a feed-mode switch, or a Haas G92 threading block as an origin shift, creates a false physical trajectory.

Constant surface speed adds a second safety boundary. As the tool approaches spindle centerline:

~~~text
RPM = surface_speed / circumference
~~~

so commanded RPM tends toward infinity as diameter tends toward zero. Haas explicitly warns that G96 without a G50 maximum can throw the workpiece and damage tooling. The safe cap is not simply machine maximum RPM. It is the minimum validated limit from machine spindle, chuck, jaws, workpiece, fixture, tool, process, imbalance, and current retention state. [Haas G96](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG96.html), [Haas G50](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG50.html)

Threading and rigid tapping are phase-coupled transactions, not ordinary feed moves. LinuxCNC G33 waits for spindle-at-speed and the spindle index so successive passes align, then uses encoder phase and axis acceleration to schedule entry. G33.1 includes synchronized entry, spindle reversal, overshoot while rotation reverses, synchronized return, a second reversal, and final repositioning. A saved Z coordinate cannot reconstruct any of that. [LinuxCNC G33/G33.1](https://linuxcnc.org/docs/stable/html/gcode/g-code.html#gcode:g33)

Dual-spindle handoff is likewise a transaction:

~~~text
prove both chuck configurations and clearance
-> orient or bring both spindles to compatible speed
-> synchronize speed and phase
-> approach subspindle
-> clamp receiving chuck and prove clamp
-> transfer axial load / establish seating
-> unclamp releasing chuck and prove release
-> separate under controlled ownership
-> cancel synchronization at the controller-defined boundary
-> switch active spindle, offsets, channel ownership, and part-state identity
~~~

An interruption between clamp and release can leave the part held by both spindles, neither spindle, or one unproved chuck. Line replay must not decide which.

KerfDesk currently implements a GRBL router product, not turning. That boundary is reasonable if it remains explicit. The external preview correctly rejects explicit G18/G19 planes, but it can still accept a lathe file which relies on controller startup plane/defaults or contains only linear X/Z/cycle-address motion. It then treats G7/G8, G96/G97, G50, G98/G99, tool compensation, threading cycles, spindle selection, C-axis mapping, chuck M-codes, and multi-channel constructs as nonfatal notes while the UI reports a successful “simulation.” Its generic checkpoint model also calls every spindle machine `cnc`, and its recovery scanner would treat any Z-aware program as a router: it ignores lathe modes, starts one M3/M4 spindle, performs a router safe-Z move, travels in XY, and feeds Z back to a recorded depth. That routine must never be generalized to turning.

The most important newly confirmed findings are:

1. **Dialect and machine class are inseparable.** Even Haas mill and Haas lathe reuse G95/G76 for different operations.
2. **CSS safety is a workholding calculation.** The maximum is the qualified minimum across spindle, chuck, actual jaws, stock, support, balance, and process—not the motor nameplate.
3. **Threading/tapping are phase transactions.** Their physical stop/reversal points and legal restart boundaries do not follow source-line boundaries.
4. **Part transfer changes material topology and ownership.** Chuck commands require asynchronous proof and transaction commit.
5. **Multi-channel block search can execute coordination and PLC-facing auxiliary functions.** It is not a read-only scan.
6. **Persistent wait markers can survive Reset/NC Start.** Barrier epochs must prevent stale release.
7. **Public implementations expose layer-boundary defects.** The pinned LinuxCNC/Machinekit same-block G7/G8+G76 path appears to convert cycle quantities twice; the evidence is source-confirmed but not runtime reproduced.
8. **grblHAL turning features are conditional and partly experimental.** Accepting the words does not prove feedback hardware or complete semantics.
9. **FreeCAD's current CAM tree is not a native turning stack.** Its machine-model work does not change that implementation boundary.
10. **KerfDesk's current external preview can create a plausible but false lathe route.** It should refuse unsupported turning semantics.

The engineering boundary is:

> A lathe program is safe only under an exact controller dialect, machine topology, spindle/workholding state, tool-orientation model, expanded cycle semantics, and verified physical setup. A plausible XZ plot is not evidence of a turning process.

This tranche is research and architecture. It does not add lathe execution to KerfDesk and does not modify production code.

## 1. Relationship to earlier research

Earlier dossiers established:

- modal interpreter state and why source-line replay is incomplete;
- spindle command versus proved physical spindle state;
- controller/post capability contracts;
- cutting mechanics, chip load, tool life, and process monitoring;
- workholding as executable setup state;
- multi-axis frames, kinematics, and branch-aware recovery.

They touched turning only to identify the gap. This tranche goes deeper by:

- comparing actual lathe dialects rather than grouping all RS274-style controls;
- modeling cylindrical stock and rotating workholding;
- tracing CSS, feed-per-revolution, encoder phase, threading, and tapping;
- separating spindle velocity mode, orientation, C-axis servo mode, and live tooling;
- treating dual-spindle transfer and multi-channel waits as distributed transactions;
- auditing public implementations and current KerfDesk boundaries;
- defining a turning-specific state model, recovery policy, and adversarial tests.

## 2. Turning coordinate and topology model

### 2.1 Workpiece-relative convention

Conventional turning uses:

- Z along the spindle centerline;
- X radial to the centerline, commonly programmed as diameter;
- G18 XZ plane for contour arcs;
- an implicit Y direction which determines G2/G3 viewing convention;
- C as spindle angular position when the main spindle is used as a servo axis;
- Y and B where the machine has off-center or swiveling milling capability.

The software must state whether coordinates represent tool motion relative to stock or physical slide direction. Front-turret and rear-turret machines can produce opposite-looking physical motion and arc direction while following the same workpiece-relative convention.

LinuxCNC's lathe documentation warns that enabling a lathe display does not select G18; the program or startup configuration must do so. It also documents front/back tool layouts and the imaginary Y-axis direction used to interpret arcs. [LinuxCNC lathe configuration](https://linuxcnc.org/docs/html/config/lathe-config.html), [LinuxCNC lathe user information](https://linuxcnc.org/docs/2.8/html/lathe/lathe-user.html)

Required machine data includes:

~~~text
spindle centerline and positive Z direction
front/rear turret side and axis signs
X display/programming convention
main, sub, and live spindle frames
turret and station transforms
tool-block, holder, insert, and gauge geometry
chuck, jaws, tailstock, steady rest, stock, and finished-part geometry
channel-to-axis/spindle/resource ownership
~~~

### 2.2 Diameter and radius modes

In LinuxCNC:

- G7 selects diameter programming;
- G8 selects radius programming;
- G8 is the documented power-up default;
- under G7, an X word is a diameter but arc-center I remains a radius-style offset in ordinary XZ arc programming;
- LinuxCNC G76 explicitly changes the interpretation of I/J/K between G7 diameter and G8 radius modes.

See [LinuxCNC G7/G8](https://linuxcnc.org/docs/stable/html/gcode/g-code.html#gcode:g7) and [LinuxCNC G76](https://linuxcnc.org/docs/stable/html/gcode/g-code.html#gcode:g76).

Software must type these quantities rather than infer them from letters:

~~~text
DiameterPosition
RadiusPosition
RadialIncrement
DiameterIncrement
ArcCenterOffset
ThreadDepthRadius
ThreadDepthDiameter
~~~

The dangerous implementation is a generic `x: number` plus a modal `diameterMode` applied indiscriminately to every X-like value. Controller documentation must define each address in each cycle.

Haas NGC adds another state layer:

- Setting 285 defines the default X convention;
- G171 overrides to radius programming;
- G172 overrides to diameter programming;
- M00/M01 retain the override;
- M02/M30 restore the configured default;
- G112 makes X a radius quantity inside XY-to-XC interpolation regardless of ordinary lathe mode;
- roughing-cycle addresses can mix radial and diameter allowances in the same cycle.

See [Haas G172](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG172.html), [Haas Setting 285](https://www.haascnc.com/service/codes-settings.type%3Dsetting.machine%3Dlathe.value%3DS285.html), and [Haas G71](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3Dg71.html).

SINUMERIK supports channel-level `DIAMON`, `DIAM90`, and `DIAMOF`, axis-specific diameter modes, non-modal diameter/radius expressions, and machine-data selection of the transverse axis. The correct state can therefore be per channel, per axis, and per expression—not one global Boolean. [SINUMERIK ONE NC Programming](https://support.industry.siemens.com/cs/attachments/109988086/ONE_ncprogramming_progr_man_0325_en-US.pdf)

### 2.3 Machine topology is not only XZ

Common configurations include:

- two-axis slant-bed lathe;
- lathe with tailstock or programmable quill;
- two-turret lathe;
- main plus opposed subspindle;
- live-tool C-axis lathe;
- Y-axis turning center;
- B-axis mill-turn with swiveling milling spindle;
- Swiss-type sliding headstock with guide bushing;
- multi-channel machine with simultaneous upper/lower turret and main/sub operations.

Each adds shared resources and collision pairs. A machine definition needs physical carriers, not a flat list of X/Z/C/Y/B letters.

## 3. Turning CAM and manufacturing workflow

### 3.1 Setup owns cylindrical facts

A turning setup should contain:

~~~text
raw stock profile, diameter, bore, length, and material
stick-out / chuck insertion / bar remnant
main or subspindle setup identity
chuck and jaw geometry, clamp mode, pressure, and qualified RPM envelope
tailstock, center, steady-rest, guide-bushing, and bar-feeder state
part zero and spindle centerline
cutoff/transfer allowance and finished-part ownership
tool/turret inventory and interference envelopes
~~~

The stock is not a rectangular height field. Turning stock is a surface of revolution until milling, eccentricity, jaws, flats, or prior operations make it non-axisymmetric.

### 3.2 Operations are semantically different

Turning CAM should distinguish:

- facing;
- OD rough/finish turning;
- ID boring;
- profiling and tapering;
- grooving and recessing;
- parting/cutoff;
- drilling/reaming from spindle centerline;
- tapping;
- single-point threading;
- live-tool axial/radial drilling and milling;
- engraving/cylindrical interpolation;
- deburring and chamfering;
- part transfer and second-operation setup.

Each operation needs its own entry, exit, chip-control, collision, workholding, and restart contract.

Parting is a structural state transition, not just a groove. Before cutoff, the part belongs to the main-stock chain; after cutoff it may be supported by a subspindle or catcher, or become uncontrolled. The program must prove where the separated part will go.

### 3.3 Turning intermediate representation

A strong machine-independent IR should not start as G-code:

~~~text
TurningOperation {
  operationKind
  setupId
  spindleId
  turretId
  toolAssemblyId
  stockStateIn
  stockStateOut
  contourInPartFrame
  controlledPoint
  feedIntent
  surfaceSpeedIntent
  entryExitPolicy
  compensationIntent
  synchronizationIntent
  workholdingRequirements
  restartBoundaryPolicy
}
~~~

The post/controller layer maps this to diameter/radius convention, cycle syntax, tool offsets, spindle selection, feedback modes, and machine/chuck commands.

## 4. Tool, insert, and compensation state

### 4.1 The nominal tool point is not the cutting contact

A lathe insert has:

- nose radius;
- tool-tip orientation;
- front and back clearance angles;
- approach/lead angle;
- rake and edge preparation;
- geometry offset;
- wear offset;
- holder and boring-bar envelope.

LinuxCNC's tool table carries radius, front angle, back angle, and orientation. Its G41.1/G42.1 can accept tool diameter and lathe orientation explicitly. [LinuxCNC lathe tool data](https://linuxcnc.org/docs/2.8/html/lathe/lathe-user.html), [LinuxCNC tool compensation](https://linuxcnc.org/docs/master/html/en/gcode/tool-compensation.html)

The same insert radius with the wrong orientation number can compensate to the wrong quadrant. Front/rear turret and OD/ID use change which side of the path is material.

G41/G42 mean left/right relative to directed contour motion, not simply OD/ID. SINUMERIK cutting-edge positions and LinuxCNC lathe orientations affect compensation construction; moving a physically similar tool to a rear/lower turret can invert the required path relationship. [SINUMERIK Tools](https://support.industry.siemens.com/cs/attachments/109974248/828D_tools_fct_man_0724_en-US.pdf), [LinuxCNC tool compensation](https://linuxcnc.org/docs/stable/html/gcode/tool-compensation.html)

### 4.2 Geometry and wear are separate

Store separately:

~~~text
tool assembly and holder geometry
measured X/Z geometry offsets
insert nose radius and orientation
front/back angles
wear corrections
life/load state and edge identity
turret station and duplicate-tool mapping
calibration/touch-off revision
~~~

A wear correction changes the controller's interpreted cutting location and future motion; it does not move a stationary tool. Replacing an insert or holder changes the physical assembly and requires measurement/requalification.

### 4.3 Compensation entry and exit are transactions

Tool-nose compensation needs a valid lead-in long enough to establish the compensated path and a lead-out which cancels without gouging. Corners depend on the following move, so the current block alone is insufficient.

Restart is unsafe:

- inside active G41/G42 without reconstructed lookahead;
- on the compensation activation block;
- before the required entry motion completes;
- during cancellation or a corner whose endpoint depends on the next block;
- after tool/wear/orientation state changed.

## 5. Spindle speed modes and constant surface speed

### 5.1 Fixed RPM

G97 commonly selects fixed-RPM mode, but the exact modal group, reset behavior, spindle selection, and S-word interpretation remain controller-specific.

Fixed RPM is usually appropriate for:

- drilling on spindle centerline;
- tapping/threading where a stable synchronized speed is required;
- live-tool operations with separate spindle commands;
- transfer/synchronization preparation;
- recovery and prove-out sequences where predictable kinetic energy matters.

### 5.2 Constant surface speed mathematics

Metric:

~~~text
RPM = (1000 * Vc_m_per_min) / (pi * diameter_mm)
~~~

Imperial:

~~~text
RPM = (12 * Vc_ft_per_min) / (pi * diameter_in)
    approximately 3.82 * SFM / diameter_in
~~~

As diameter approaches zero, RPM diverges. A CSS command therefore requires:

~~~text
effective_rpm_cap = min(
  machine spindle limit,
  chuck limit for the actual jaw configuration,
  workpiece/fixture balance limit,
  workpiece retention limit,
  tailstock/steady-rest/guide-bushing limit,
  tool/process limit,
  setup-qualified limit
)
~~~

Haas says G96 increases RPM as X approaches zero and warns that omitting G50 can throw parts and damage tooling. LinuxCNC accepts a D maximum on G96 and requires the coordinate-system X0, including tool offsets, to be the center of rotation. [Haas G96](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG96.html), [LinuxCNC G96/G97](https://linuxcnc.org/docs/stable/html/gcode/g-code.html#gcode:g96-g97)

### 5.3 CSS depends on frames and feedback

The control must know the current cutting radius. Errors arise from:

- wrong centerline X zero;
- diameter/radius confusion;
- wrong active spindle after G14/G15-style swap;
- stale tool X offset;
- live-tool versus turning-spindle selection;
- CSS retained across an unexpected reset/search state;
- commanded rather than actual spindle-speed assumptions.

LinuxCNC's motion interface uses actual `spindle.M.speed-in` for G96 and G95. It pauses for `spindle.M.at-speed` before the first feed after spindle start/speed change and, in CSS, at every rapid-to-feed transition. [LinuxCNC motion spindle pins](https://linuxcnc.org/docs/stable/html/man/man9/motion.9.html)

SINUMERIK proves that G96 cannot be modeled as only a spindle-mode flag:

- G96 combines CSS with revolutional-feed semantics;
- G961 combines CSS with linear-feed semantics;
- G962 preserves the selected feed type while enabling CSS;
- G97/G971/G972 are corresponding constant-RPM forms;
- `LIMS[...]` limits the selected master spindle;
- `SCC[axis]` selects the geometry reference axis;
- if G95 was not already active, entering G96's revolutional-feed behavior requires a new F value.

See [SINUMERIK ONE NC Programming](https://support.industry.siemens.com/cs/attachments/109988086/ONE_ncprogramming_progr_man_0325_en-US.pdf).

### 5.4 CSS is coupled to workholding

Power-chuck grip force decreases with RPM because jaw centrifugal force opposes OD clamping. Chuck maximum RPM is qualified with a specified jaw mass, center of gravity, drawbar pull, lubrication, jaw position, and grip measurement. Tall/heavy jaws or poor lubrication can materially lower dynamic grip.

Kitagawa and LMC/Haas chuck manuals define allowable maximum speed under specific standard-jaw conditions and state that dynamic grip may fall to roughly one-third of maximum static grip at the rated boundary. They require the process RPM to remain within both required gripping force and chuck speed limits. [Kitagawa QJR manual](https://kitagawa.global/media/technical/manu_QJR_en.pdf), [LMC ZA chuck manual](https://www.haascnc.com/content/dam/haascnc/en/service/reference/chuck/lmc-za---chuck-manual.pdf)

Haas further warns that a power loss can reduce clamping pressure and shift the workpiece, and requires checking the workpiece afterward. [Haas lathe operator manual](https://www.haascnc.com/content/dam/haascnc/en/service/manual/operator/english---lathe-ngc---operator%27s-manual---2020.pdf)

Therefore a restart after power loss must invalidate both datum and retention evidence even if encoder positions recover.

## 6. Feed semantics and dialect collisions

### 6.1 Feed per minute versus feed per revolution

Feed per revolution targets chip load as spindle speed varies:

~~~text
linear_feed = feed_per_revolution * actual_RPM
~~~

It requires the correct spindle identity and valid actual-speed feedback. A nominal S word is not proof. If spindle speed droops, a host-side conversion from feed/rev to fixed feed/min changes chip load and is not equivalent.

### 6.2 Same codes, different machines

#### LinuxCNC

- G94: units per minute;
- G95: units per revolution using actual spindle speed;
- G98/G99: return to initial/R plane for canned cycles;
- G92: coordinate-system offset;
- G76: multi-pass threading with P pitch, Z endpoint, I/J/K radial/diameter semantics, degression, compound angle, spring passes, and optional entry/exit taper.

#### Haas lathe

- G98: feed per minute;
- G99: feed per revolution;
- G94: end-facing cycle;
- G95: live-tool rigid-tapping cycle;
- G92: threading cycle;
- G76: multi-pass threading with Haas address/setting semantics;
- G50: maximum spindle-speed limit for CSS on current Haas controls.

See the [LinuxCNC quick reference](https://linuxcnc.org/docs/html/gcode.html) and [Haas lathe G-code list](https://www.haascnc.com/service/service-content/guide-procedures/lathe---g-codes.html).

Machine class matters even inside one vendor family: on a Haas mill G95 is feed per revolution and G76 is fine boring, unlike the Haas lathe meanings above. A profile key must therefore include controller generation **and machine class**, not merely `haas-ngc`.

### 6.3 Required dialect key

Every program, preview, checkpoint, and post must bind to:

~~~text
controller family
controller software generation/version
machine builder and model
installed options
parameter/setting revision
post identity and revision
active channel/spindle mapping
~~~

File extension, code-letter frequency, or “Fanuc-like” is not enough.

## 7. Spindle-synchronized threading

### 7.1 G95 is not thread phase synchronization

Feed-per-revolution maintains average pitch but does not guarantee that separate passes begin at the same angular phase. Multi-pass single-point threading needs:

- spindle position feedback;
- a once-per-revolution index or equivalent absolute phase reference;
- actual spindle speed;
- spindle-at-speed proof;
- deterministic phase alignment;
- axis acceleration/velocity feasibility;
- controller ownership of the synchronized trajectory.

### 7.2 LinuxCNC G33 evidence

LinuxCNC G33:

- accepts distance per revolution K;
- can select a spindle;
- waits for spindle index and at-speed so repeated passes align;
- uses spindle speed and machine acceleration to schedule axis acceleration after the index pulse;
- requires `spindle.N.revs`, `spindle.N.index-enable`, and `spindle.N.at-speed` connections;
- rejects a requested synchronized move which exceeds linear velocity limits.

See [LinuxCNC G33](https://linuxcnc.org/docs/stable/html/gcode/g-code.html#gcode:g33) and [spindle feedback wiring](https://linuxcnc.org/docs/html/examples/spindle.html).

### 7.3 Multi-pass G76 is an expanded trajectory

LinuxCNC G76 includes:

- drive line and thread peak;
- initial and full depth;
- degression/pass schedule;
- compound infeed angle;
- spring passes;
- entry/exit taper;
- rapid and synchronized segments;
- selected spindle and index synchronization.

Its documentation warns that without an exit taper the exit is not spindle-synchronized; changing spindle speed between passes can make the exit consume more angular travel and create a heavy cut. It also requires a safe post-cycle move for internal threads. [LinuxCNC G76](https://linuxcnc.org/docs/stable/html/gcode/g-code.html#gcode:g76)

Haas G76 uses different fields and settings, including tool angle, first-cut depth, thread height, finish allowance, minimum cut, cutting method, and chamfer settings. [Haas G76](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG76.html)

The verifier must expand the exact controller cycle before proving:

- every pass start/exit;
- flank load and depth schedule;
- chuck/tool clearance;
- acceleration and phase feasibility;
- relief-groove adequacy;
- resulting stock removal.

### 7.4 Haas G32 is an atomic synchronized sequence

Haas G32:

- establishes encoder synchronization on its first block;
- maintains synchronization across a multi-block G32 sequence;
- performs no automatic return;
- defers Single Block and Feed Hold until the sequence ends;
- ignores feed override;
- requires Haas G99 feed per revolution;
- must not change spindle RPM during the sequence;
- remains modal until another group-01 motion replaces it.

See [Haas G32](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG32.html).

The requested stop line and the physical stop point can differ. Checkpoint boundaries must follow the controller's atomic sequence, not UI line highlighting.

### 7.5 SINUMERIK thread recovery is operation-specific

SINUMERIK supports constant-lead G33, changing-lead G34/G35, run-in/run-out controls, G331/G332 rigid tapping, and technology cycles such as CYCLE84/CYCLE840. It also provides `LFON` fast thread retraction which can respond to NC stop, selected alarms, or a fast input and retract along a configured vector/position. The function does not generally apply to G331/G332 tapping.

See [SINUMERIK ONE NC Programming](https://support.industry.siemens.com/cs/attachments/109988086/ONE_ncprogramming_progr_man_0325_en-US.pdf), [SINUMERIK thread fast retraction](https://support.industry.siemens.com/cs/attachments/109777373/ONE_axes_fct_man_1219_en-US.pdf), and the [SINUMERIK cycle catalog](https://support.industry.siemens.com/cs/attachments/109988149/MC_ncprogramming_progr_man_0325_en-US.pdf).

This is the right architectural pattern: an embedded thread tool needs a controller/process-specific escape primitive, not ordinary feed hold plus generic jog.

### 7.6 FANUC option boundary

FANUC public material confirms encoder-phase-based synchronous/thread cutting, multiple lathe G-code systems, and optional thread retract/repair, variable-speed threading, rigid tapping, and multi-lead functions. It does not publish enough exact syntax/reset behavior to define one universal FANUC profile. “FANUC-compatible” must remain a refusal boundary until the exact series, selected G-code system, machine-builder manual, and installed options are known. [FANUC CNC function catalog](https://www.fanucamerica.com/docs/default-source/cnc-files/cnc-function-catalog.pdf), [FANUC 0i-F](https://www.fanucamerica.com/products/series/0i-f)

### 7.7 Restart rule for threads

Never resume:

- in the middle of a synchronized threading move;
- between hidden passes of a canned cycle;
- after spindle index/encoder trust is lost;
- after tool wear/geometry or work offset changes;
- after the workpiece shifted in the chuck;
- at a source line which omits the complete cycle state.

The safe automatic boundary is normally before the complete threading cycle with:

1. datum and workholding requalified;
2. the same insert/edge and offsets verified;
3. spindle index, direction, feedback, and cap proven;
4. a collision-free approach to the cycle start;
5. controller-specific phase acquisition;
6. a decision whether re-cutting prior passes is physically acceptable.

If the existing thread phase relative to the spindle/workpiece cannot be recovered, repeating the cycle can cross-thread. Manual inspection or scrapping may be the only honest outcome.

## 8. Tapping and spindle reversal

Rigid tapping is a compound state machine, not simply `feed = pitch * RPM`.

LinuxCNC G33.1 performs:

~~~text
wait for index and synchronized entry
-> feed to depth in phase with spindle
-> command spindle reversal
-> continue synchronized motion while spindle decelerates and reverses
-> synchronized return
-> command second reversal
-> continue while spindle reverses
-> final unsynchronized reposition to the start coordinate
~~~

It warns that specifying off-axis coordinates can create a coordinated diagonal synchronized move rather than a straight tap. [LinuxCNC G33.1](https://linuxcnc.org/docs/stable/html/gcode/g-code.html#gcode:g33.1)

LinuxCNC G74/G84, by contrast, are floating-holder tapping cycles and explicitly do not use synchronized motion. They disable overrides, feed using a precomputed rate, stop/reverse, dwell, and retract. [LinuxCNC G74/G84](https://linuxcnc.org/docs/stable/html/gcode/g-code.html#gcode:g84)

Haas lathe G95 is a face live-tool rigid-tapping cycle and requires Haas G99 feed-per-revolution mode plus a prior S command. This is a concrete example of why the code number alone cannot define behavior. [Haas G95](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG95.html)

Restart is permitted only before the complete tap transaction or after a proved full withdrawal. A tap stopped in the hole has a physical thread-phase constraint and may require machine-builder recovery.

## 9. Roughing, finishing, groove, and facing cycles

Canned cycles hide motion. G70/G71/G72/G73/G74/G75/G90/G92/G94 and vendor cycles can generate:

- rapid approach;
- repeated radial or axial passes;
- clearance/retract moves;
- profile following;
- compensation transitions;
- pecks and dwells;
- chamfers and finish allowances;
- subroutine/profile execution.

The same code number can mean another operation on a mill or another controller. A simulator which draws only the block endpoint omits most of the cut.

Required cycle architecture:

~~~text
parsed controller-specific cycle
-> validated parameter object
-> explicit expanded canonical trajectory
-> stock-removal simulation
-> collision/dynamics/workholding checks
-> provenance link back to source block and post revision
~~~

The expansion should be independent from the post implementation where practical so the verifier does not reproduce the same defect.

## 10. Rotating workholding and stock authority

### 10.1 Retention is speed-dependent

The workholding model needs:

~~~text
chuck/collet/fixture identity and revision
OD versus ID clamping
jaw material, mass, height, center of gravity, and bored profile
jaw stroke position and contact length
hydraulic/pneumatic pressure and proved clamp signal
static and dynamic grip evidence
maximum qualified RPM curve
stock mass, inertia, imbalance, projection, and cutting load
tailstock/steady-rest/guide-bushing support
maintenance/lubrication evidence
~~~

Haas's current weight guidance says machine/chuck weight tables are estimates, not proof of a safe setup; work longer than roughly 3:1 length-to-diameter needs support consideration, and holding force decreases as speed rises. [Haas lathe workpiece limits](https://www.haascnc.com/service/troubleshooting-and-how-to/reference-documents/lathe-work-piece-weight-limits.html)

### 10.2 Clamp command is not clamp proof

Store separately:

- commanded chuck state;
- pressure command;
- pressure/position feedback;
- clamp-complete interlock;
- actual part seating/runout evidence;
- timestamp and power/hydraulic epoch.

Haas notes that decreasing programmable chuck pressure does not reduce grip on an already-clamped chuck until it is stopped, unclamped, and reclamped. A state model which stores only the latest pressure setpoint can therefore misstate physical grip. [Haas programmable chuck pressure](https://www.haascnc.com/productivity/product-options/prog-chuck-pressure.html)

### 10.3 Tailstock and steady rest are motion actors

They are not Boolean accessories. Their state includes:

- quill/body position;
- clamp/retract state;
- force/pressure;
- part contact proof;
- allowable RPM/load;
- collision envelope;
- ownership by channel/operation;
- sequencing with tool and subspindle motion.

Recovery must not retract a tailstock or steady rest merely because the saved program later would have done so. Physical part support may depend on it.

## 11. Live tooling and C-axis state transitions

### 11.1 One spindle can have different control identities

The main spindle may operate as:

- a velocity-controlled turning spindle;
- an oriented, braked spindle for indexed drilling;
- a position-controlled C axis coordinated with X/Y/Z;
- a follower or leader in dual-spindle synchronization.

These are mutually constrained modes, not one `spindleOn` flag.

A safe transition can require:

~~~text
stop turning spindle
-> prove zero/acceptable speed
-> orient to a known phase
-> engage C-axis drive/coupling
-> prove engagement
-> release/apply spindle brake as required
-> enter position-control mode
-> establish angular coordinate and compensation
~~~

Returning to turning reverses the transaction and must prove C-axis disengagement before ordinary M3/M4 speed control.

Haas training material describes M154 as C-axis/milling mode and M155 as turning-spindle mode; Reset disengages the C axis on the documented configuration. The machine should orient and prove engagement, and service procedures identify encoder and mechanical engagement as fault sources. [Haas Y-axis lathe training](https://service.haascnc.com/sites/default/files/Locked/1/Y-Axis%20Lathe%20Applications%20Training.pdf), [Haas C-axis test procedure](https://www.haascnc.com/service/troubleshooting-and-how-to/how-to/lathe---c-axis---test-procedure.html)

LinuxCNC exposes the orientation handshake as separate request, requested angle, `is-oriented` acknowledgement, locked/brake state, and fault input; M3/M4/M5 clear the orientation/lock state. This is the correct general pattern: accepting M19 is not proof that the spindle physically oriented. [LinuxCNC spindle orientation pins](https://linuxcnc.org/docs/stable/html/man/man9/motion.9.html)

### 11.2 Live-tool spindle is a separate actor

On Haas lathes:

- M133 starts live tooling forward;
- M134 starts it reverse;
- M135 stops it;
- P supplies live-tool RPM.

See [Haas live-tool commands](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dlathe.value%3DM134.html).

Software must keep separate:

~~~text
mainTurningSpindle
subTurningSpindle
liveToolSpindleByTurretOrHead
~~~

An unqualified S/M3 model can start the wrong spindle after a spindle swap or channel change.

### 11.3 Coordinate mapping changes motion

Haas G112 converts programmed Cartesian XY into X/C motion. G107 maps a linear path around a cylinder using a declared radius/diameter and plane contract. [Haas G112](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG112.html), [Haas lathe G107](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG107.html)

In the documented G112 workflow:

- the part spindle is not continuously turning;
- Haas G98 feed per minute is required;
- X is treated as radius;
- direct C commands are not allowed while mapping is active;
- paths should not cross spindle center.

These are admission rules, not display preferences.

The verifier needs:

- cylinder diameter/radius and frame;
- C-axis wrap and turn state;
- mapping activation/cancellation behavior;
- plane and cutter-compensation behavior;
- live-tool controlled point;
- full holder/turret/chuck swept volumes;
- controller reset/program-end retention.

Mapping must be expanded to physical X/Y/Z/C joint motion before bounds or collision claims.

## 12. Dual-spindle and part-transfer architecture

### 12.1 The part has an ownership state machine

~~~text
HeldByMain
ApproachingSub
HeldByBothUnverified
HeldByBothVerified
TransferLoadEstablished
HeldBySubReleasePending
HeldBySub
SeparatedToCatcher
UncontrolledOrUnknown
~~~

The state is physical, not inferred only from executed M-codes.

### 12.2 Synchronized spindle control

Haas G199:

- synchronizes RPM of two spindles;
- can establish a phase offset with R;
- first matches velocity, then adjusts orientation;
- ignores independent speed/position commands to the following spindle while synchronized;
- leaves the spindle M-codes independently controlled;
- remains active until G198, including the documented power-cycle behavior;
- can retain synchronization through Reset/E-stop until the spindles stop;
- is recommended after both spindles have first been brought to speed, otherwise acceleration can be slow.

See [Haas G199](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG199.html) and [Haas dual-spindle programming](https://www.haascnc.com/service/online-operator-s-manuals/lathe-operator-s-manual/lathe---options-programming.html).

This is a vivid reset lesson: “power cycled” does not universally mean “modal synchronization cleared.” The exact controller/manual/version is authoritative.

### 12.3 Safe handoff transaction

A controller-independent handoff model is:

1. Verify the operation's transfer checkpoint and remaining stock geometry.
2. Retract every tool, probe, catcher, steady rest, and turret from the transfer envelope.
3. Verify both chuck/jaw configurations, clamp modes, pressure capability, and part seating geometry.
4. Establish main/sub work offsets and centerline alignment.
5. Start/orient both spindles under the controller's required sequence.
6. Synchronize speed and phase; prove error is inside limits.
7. Approach in a collision-checked axis mode and at a controlled speed.
8. Seat the receiving chuck without uncontrolled axial loading.
9. Command receiving clamp and prove clamp/pressure/position.
10. Establish dual-hold load state and, if required, perform pull/seat verification.
11. Command releasing chuck open and prove release.
12. Separate while preserving the correct leader/follower and axis ownership.
13. Cancel synchronization at a controller-approved boundary.
14. Switch part ownership, active spindle, work coordinate, channel, and stock model atomically.

Timeout or disagreement at steps 8-12 must enter an explicit transfer-fault state. It must not retry clamp/open motion blindly.

### 12.4 Phase is geometry

For ordinary round stock, angular phase may appear irrelevant. It becomes essential for:

- non-round jaws and jaw interference;
- transferred milled flats/holes/features;
- polygonal/eccentric parts;
- second-side feature clocking;
- hex stock;
- spindle-oriented probing;
- gear/spline/thread alignment.

The checkpoint needs main/sub angular positions, phase-offset contract, synchronization error, and the part-to-each-chuck transform.

### 12.5 Active-spindle swap changes coordinates and compensation

On Haas, G14 does more than choose another spindle. It routes ordinary main-spindle commands and canned cycles to the secondary spindle, changes which spindle supplies feed-per-revolution, enables Z-axis mirroring, and changes the tool-nose-direction/measurement requirements. G15 cancels the swap; Reset and program end also cancel it on the documented control. Haas warns that incorrect tool measurement or compensation under G14 can crash the machine. [Haas G14/G15](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG14.html)

Recovery must preserve or deliberately reconstruct:

- logical-to-physical spindle mapping;
- mirroring and part frame;
- active work offset;
- feed-per-revolution spindle source;
- CSS spindle source;
- tool orientation and nose compensation;
- whether Reset already canceled the swap.

## 13. Multi-channel execution as a distributed system

### 13.1 Independent interpreters share one machine

Multi-channel machines can run separate NC programs or streams for:

- upper turret;
- lower turret;
- main spindle;
- subspindle;
- milling head;
- loader/bar feeder/robot.

Each channel has its own program counter, modal state, lookahead, tool, offsets, and pending auxiliary commands. They share axes, spindles, chucks, collision zones, power limits, coolant, and the physical workpiece.

### 13.2 Wait codes are barriers, not comments

A synchronization mark means:

~~~text
channel A arrives at barrier k
channel B arrives at barrier k
all required resource states satisfy the barrier contract
-> release participants
~~~

Failure modes include:

- one channel waits for a mark the other skipped;
- incompatible mark ordering creates deadlock;
- one channel faults while holding a shared resource;
- Reset moves one channel's program counter but not another's physical state;
- block search reconstructs different sides of the same transfer;
- an operator restarts one channel while another still owns the spindle or collision zone;
- a timeout releases motion without proving why the peer failed.

SINUMERIK provides concrete semantics:

- `WAITM` exact-stops the preceding block, sets a marker in its own channel, waits for named partner markers, and deletes the marker after synchronization;
- `WAITMC` avoids braking when partner markers are already present, so it cannot be treated as a guaranteed physical standstill;
- `SETM` sets coordination markers without stopping the local channel and remains valid after channel Reset and NC Start;
- `CLEARM` explicitly removes markers and likewise has defined persistence behavior.

See the [SINUMERIK Extended Functions manual](https://support.industry.siemens.com/cs/attachments/109752347/840Dsl_extended_fct_man_1217_en-US.pdf).

Persistent markers need a software recovery epoch. Otherwise a stale pre-fault `SETM` can falsely satisfy a post-restart barrier.

### 13.3 Resource ownership model

~~~text
SharedResource {
  resourceId
  ownerChannel
  requestedBy
  lockMode
  physicalState
  commandState
  evidenceState
  acquisitionEpoch
  releasePreconditions
  faultPolicy
}
~~~

Resources include:

- main/sub/live spindles;
- X/Y/Z/B/C axes and compound slides;
- turret indexers;
- chucks and tailstock;
- transfer zone;
- collision envelopes;
- probe/tool-setter arms;
- parts catcher;
- bar feeder/loader;
- coolant and chip evacuation where interaction matters.

### 13.4 Deadlock analysis belongs before posting

Represent channel/resource coordination as a wait-for graph. Reject:

- cycles in resource acquisition;
- mismatched barrier IDs or counts;
- barriers which are unreachable under a branch;
- release paths that depend on a channel after that channel can terminate;
- recovery paths which cannot acquire a collision-free configuration.

Runtime timeouts are fault detection, not a deadlock strategy.

The scheduler should generate WAIT instructions from a validated dependency/resource graph. WAIT text must not be the source of truth. Siemens programSYNC similarly aligns channel operations and wait markers for cycle-time analysis; optimization remains subordinate to resource exclusion and collision/workholding constraints. [SINUMERIK programSYNC overview](https://support.industry.siemens.com/cs/attachments/109813154/828D_840Dsl_Operate_Turning_offer_ov_0822_en-US.pdf)

### 13.5 Multi-channel block search can have physical side effects

SINUMERIK documents that program-test block search can suppress axis motion while still:

- executing WAIT coordination;
- performing axis exchange and variable writes;
- involving partner channels;
- outputting auxiliary functions to the PLC;
- creating REPOS offsets for later NC Start.

Whether an emitted auxiliary function moves a chuck, turret, spindle, tailstock, or peripheral depends on the OEM PLC. See the [SINUMERIK multi-channel block-search manual](https://support.industry.siemens.com/cs/attachments/109310641/IHA_0309_en.pdf).

Therefore block search is an active reconstruction procedure, not a read-only scan. It needs a machine-specific side-effect policy and physical-state reconciliation before Cycle Start.

## 14. Auxiliary automation and material flow

### 14.1 Bar feeder

Bar-feed state includes:

- bar identity/material/diameter/length/remnant;
- feeder mode and channel ownership;
- collet/chuck open/closed proof;
- pusher position and force;
- spindle liner/support configuration;
- feed length and stop/probe confirmation;
- remnant/end-of-bar state;
- allowed spindle RPM for unsupported bar length.

Unexpected bar whip is a rotating-mass hazard. The software cannot choose RPM from cutting data alone.

### 14.2 Part catcher and unload

The catcher has position, capacity, timing, collision envelope, and part-state consequences. Deploying it too early can collide with tools/chuck; too late loses the part. A cycle which finishes without proving unload may leave the next bar-feed operation attempting to occupy the same space.

Haas documents multiple catcher configurations and device positions; these must be separate swept volumes rather than one Boolean. [Haas parts catcher](https://www.haascnc.com/productivity/product-options/pcat.html)

Haas G105 bar-feed state includes push length, part-plus-cutoff length, minimum clamping length, cutoff program, and optional new-bar spindle orientation. These values change retention and collision behavior, so a generic `barFeed()` M-function is insufficient. [Haas G105](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG105.html)

Tailstock and steady-rest devices likewise have machine-specific position, clamp, feedback, and recovery procedures. [Haas tailstock](https://www.haascnc.com/service/online-manuals/haas-box-way-lathe---operator-s---service-manual/tow-along-tailstock.html), [Haas steady rest](https://www.haascnc.com/service/online-manuals/haas-box-way-lathe---operator-s---service-manual/haas-box-way---steady-rest.html)

### 14.3 Chips are part of reliability

Long stringy turning chips can:

- wrap stock or chuck;
- strike the probe/tool;
- block part seating during transfer;
- foul jaw contact;
- prevent catcher operation;
- damage finish or cause fire with some materials.

Chip-breaking geometry, feed/depth, coolant, peck/withdrawal behavior, and operator inspection are process-state inputs.

## 15. Verification and digital-twin evidence

### 15.1 Required evidence layers

1. CAM contour and stock-removal intent.
2. Controller-specific posted program.
3. Expanded canned-cycle and macro/subprogram trajectory.
4. Channel/barrier/resource schedule.
5. Axis/spindle phase trajectory.
6. Machine/tool/holder/chuck/jaw/stock collision model.
7. Workholding and speed/force envelope.
8. Measured machine/setup evidence.
9. Controlled dry run or reduced-risk prove-out.

### 15.2 Simulation must include rotating and moving bodies

Collision pairs include:

- tool/holder/turret versus chuck/jaws;
- boring bar versus bore/back wall;
- lower versus upper turret;
- main versus subspindle nose/chuck;
- tailstock/steady rest versus turrets/tools;
- transferred stock/part versus every carrier;
- live tool versus turning spindle and C-axis mapping;
- catcher/probe/loader versus active machine envelopes.

Endpoint checking is insufficient. Fast turret index, spindle approach, jaw phase, and C-axis unwinds require swept-volume checks.

### 15.3 Stock state is shared across channels

The simulator needs one authoritative material state with serialized or physically consistent concurrent removal. A second channel cannot assume stock which another channel has already removed, nor can it assume a part is transferred before the transaction commits.

### 15.4 Final-NC verification must understand the dialect

A safe verifier should compare:

~~~text
controller modal state per channel
expanded cycle motions
spindle selection, speed, phase, and feedback requirements
axis and controlled-point path
tool-nose-compensated contour
stock-removal result
workholding ownership and force/RPM margin
channel wait/resource sequence
collision and dynamic limits
    restart-safe transaction boundaries
~~~

Siemens machine kits combine the machine/kinematic model, post, and G-code-driven simulation; NX likewise emphasizes posted-code and synchronized multi-channel verification. Okuma's Collision Avoidance System models the machine and runs ahead of motion, with setup guidance including chuck, fixture, headstock, turret, tailstock, catcher, and steady rest. These industrial workflows support one rule: the digital twin is a versioned executable machine kit, not an animated tool line. [Siemens machine-kit simulation](https://www.siemens.com/en-us/products/janus-engineering-machine-kit-simulation/), [NX postprocessing and simulation](https://www.siemens.com/en-us/products/nx-manufacturing/cam-software/postprocessing-simulation/), [Okuma Collision Avoidance System](https://www.okuma.com/collision-avoidance-system)

## 16. Interruption and restart taxonomy

### 16.1 Same-session feed hold

May preserve:

- interpreter and lookahead;
- cycle internal phase;
- spindle synchronization;
- channel barriers;
- chuck and part state.

It is still not automatically safe if spindle feedback, hydraulic pressure, axis following, or workholding evidence changes.

### 16.2 Abort/reset/power loss

May invalidate:

- spindle phase/index epoch;
- CSS/feed mode;
- C-axis engagement and brake state;
- channel ownership/barriers;
- chuck pressure and part seating;
- tool/wear offsets;
- stock state and datum;
- subspindle synchronization;
- part ownership.

Block search adds another state transition. It may reconstruct interpreter state while executing coordination and PLC-facing auxiliary functions. It cannot prove chuck pressure, part seating, material continuity, spindle phase, C-axis engagement, or peer-channel ownership.

### 16.3 Turning checkpoint

~~~text
program/post/dialect/machine-kit hashes
channel program counters and modal states
expanded cycle ID and atomic substate
actual/commanded axes and homing epochs
main/sub/live spindle modes, speed, phase, index, and feedback epochs
CSS/fixed-RPM mode, caps, feed metric, selected spindle
turret station, physical tool, insert edge, geometry, wear, orientation
tool-nose compensation state and lookahead context
work offsets and part/spindle transforms
main/sub chuck command, feedback, pressure, seating, and grip evidence
tailstock/steady-rest/bar-feeder/catcher states
part ownership and transfer transaction state
stock/material-removal state and cutoff status
channel barriers and shared-resource ownership
collision/workholding/verification revisions
tool-workpiece contact state
~~~

### 16.4 Recovery classes

#### Tool clear, part retained, no synchronized cycle

Potentially recoverable after state requalification, safe turret/spindle positioning, controlled spindle start, and a new approach/lead-in.

#### Tool in contact or embedded

Automatic restart is blocked. Starting the rotating stock can break the insert, move/eject the part, or drive a broken tool into the chuck. Moving a stationary tool may also damage the part/tool. Use a machine/process-specific extraction procedure.

#### Inside G33/G76/thread/tap

Block automatic mid-transaction resume. Return only to a complete cycle boundary, unless the exact controller explicitly exposes and proves a restartable pass checkpoint. In either case spindle phase, datum, tool, and existing-thread compatibility must be proven.

#### During parting

Determine whether the part is still attached, partially attached, supported by subspindle/catcher, or free. Vision/inspection/operator evidence may be required.

#### During spindle transfer

Freeze automatic unclamp/separation. Prove which chuck holds the part and whether both are loaded before any motion.

#### Multi-channel wait/fault

Reconstruct all participating channels and resource ownership together. Never resume one channel from a saved line independently.

### 16.5 Generic recovery sequence

1. Preserve fault-time command and actual evidence before reset where possible.
2. Classify tool contact, part ownership, cutoff, thread/tap, and transfer states.
3. Prove hydraulic/pneumatic/workholding condition and inspect after power loss.
4. Re-establish axis and spindle encoder/index trust.
5. Reconcile every channel, barrier, resource lock, turret, tool, offset, and spindle mode.
6. Independently verify part position/runout/datum where risk demands it.
7. Compute a collision-free machine configuration with spindle energy off or in the required controlled mode.
8. Extract/retract only through an approved operation-specific path.
9. Restore fixed RPM/CSS cap/feed/spindle selection under the exact dialect.
10. Start the required spindle while clear and prove actual speed/phase.
11. Re-enter with a planned lead-in or restart the complete atomic cycle.
12. Observe reduced-risk motion and verify workholding/thread/feature continuity.
13. Commit channel/part ownership only after all evidence passes.

### 16.6 Real controller restart mechanisms are not equivalent

#### Haas Run-Stop-Jog-Continue

Current Haas documentation describes Feed Hold leaving the spindle turning, saving linear/rotary positions, allowing jog/spindle/insert intervention, and later returning axes in a controller-selected order at reduced rapid. It warns that changing the tool or its offsets is unsafe because the stored return uses the old offsets, and the return does not retrace the operator's jog-away path. Published revisions describe different return ordering, so software cannot encode one Haas-wide return trajectory. [Haas lathe operation](https://www.haascnc.com/service/online-operator-s-manuals/lathe-operator-s-manual/lathe---operation.html)

Haas's public Setting 36 reference—published under the **mill** scope—scans tools, offsets, selected G/M state, and positions, refuses a selected start inside active cutter compensation, and processes only a documented M-code subset. It is useful evidence that Haas program-restart scanning is selective, but it is not proof of identical lathe behavior; the exact lathe/control manual remains required. [Haas mill Setting 36](https://www.haascnc.com/service/codes-settings.type%3Dsetting.machine%3Dmill.value%3DS36.html)

#### LinuxCNC Run From Line and modal save

QtDragon's official Run From Line documentation says the operator remains responsible for machine state, does not start the spindle, does not confirm the tool, handles subroutines poorly, and recommends selecting a rapid line. LinuxCNC M70/M72 can save/restore many modal states—including G7/G8, G96/G97, feed mode, compensation, tool offsets, spindle command, coolant, and overrides—but this is a program modal stack, not a persisted physical checkpoint. [LinuxCNC QtDragon](https://linuxcnc.org/docs/stable/html/gui/qtdragon.html), [LinuxCNC M70/M72](https://linuxcnc.org/docs/stable/html/gcode/m-code.html)

#### SINUMERIK REPOS and block search

SINUMERIK REPOS saves interruption coordinates and can return after manual withdrawal, but the operator must first establish collision-free conditions; automatic return may be a straight-line path. Its block-search modes differ in state calculation and approach behavior, can omit modal state in skipped external calls, and still require the correct physical tool. [SINUMERIK Turning REPOS](https://support.industry.siemens.com/cs/attachments/109812223/ONE_turning_op_man_0722_en-US.pdf), [SINUMERIK Turning block search](https://support.industry.siemens.com/cs/attachments/109817056/ONE_turning_op_man_0123_en-US.pdf)

These features are operator/controller workflows, not proof that arbitrary host-side line replay is safe.

## 17. Current KerfDesk source audit

Snapshot: `C:\Users\Asus\LaserForge\audit-current-main` at `e752a9125f02f832144c3b40800840ee5973fcf2`.

### 17.1 Product machine kind is only laser versus generic CNC

`src/core/scene/machine.ts` defines:

~~~text
MachineKind = 'laser' | 'cnc'
~~~

The CNC configuration stores router-oriented safe Z, fixed spindle ceiling/spin-up, stock slab, tool library, and GRBL settings. There is no process class for lathe/mill-turn, no chuck/turret/channel/spindle graph, and no diameter/radius or CSS contract.

The machine catalog explicitly contains approximate bed sizes and router/spindle ceilings. This is honest router scope, not a lathe machine definition.

### 17.2 CNC IR cannot represent turning

`src/core/job/job.ts` defines CNC passes as:

- XY contour at constant Z depth;
- XYZ path;
- XY arc at constant Z.

Each group has one fixed `spindleRpm` and `spindleSpinupSec`. It cannot represent:

- cylindrical stock or XZ turning contour;
- diameter/radius quantity types;
- spindle identity or CSS;
- feed/revolution or phase synchronization;
- tool-nose orientation/compensation;
- canned/thread/tap transactions;
- chuck/turret/tailstock/subspindle state;
- live tool or C-axis mapping;
- multiple channels.

### 17.3 Native emitter is intentionally GRBL-router-specific

`src/core/output/cnc-grbl-strategy.ts` emits:

~~~text
G21
G90
G94
G0 Z<safe>
M3 S<fixed rpm>
G4 P<spinup>
XYZ router motion
~~~

It has no turning dialect. This is acceptable while machine compatibility prevents lathe use.

### 17.4 External preview can falsely visualize lathe files

`src/io/gcode/parse-gcode-program.ts` tracks only:

- G0-G3;
- G20/G21;
- G90/G91;
- G17;
- M2/M30;
- M3-M9 as geometric no-ops.

It creates geometry only from X/Y/Z/I/J/R. It does not execute:

- G18 XZ arc semantics;
- G7/G8 diameter/radius mode;
- G96/G97/G50 CSS;
- Haas G98/G99 feed semantics;
- LinuxCNC G94/G95 feed semantics;
- G41/G42 tool-nose compensation;
- G33/G76/G92 threading;
- G70-G75/G90/G94 turning cycles;
- tool/turret selection;
- spindle selection/swap/synchronization;
- C/Y/B axis or G107/G112 mapping;
- chuck, tailstock, catcher, or channel commands.

G18/G19 produce a fatal parser error. Most other unsupported modal words become notes and parsing continues. `src/ui/app/gcode-open-action.ts` opens the preview and emits a success toast beginning `Simulating ...` when any motion remains.

Consequences:

- a lathe X/Z line without an explicit fatal plane word can be rendered under router XY-plus-Z semantics;
- X may be plotted as radius even when programmed as diameter;
- an XZ arc which relies on a controller default plane can be interpreted as an XY/helical arc or fail for the wrong reason;
- G76's hidden passes vanish;
- G95/G98/G99/G92 semantics are ignored while their X/Z address words can still create geometry;
- live-tool/C-axis paths are absent;
- a convincing route can bear little relationship to the machine path.

This should fail closed by dialect/capability, not merely append notes.

### 17.5 Status cannot represent a turning cell

`src/core/controllers/grbl/status-parser.ts` carries:

- XYZ position;
- one feed value;
- one spindle value;
- one set of overrides;
- GRBL-style pins.

It has no:

- spindle phase/index/at-speed quality;
- multiple spindle identities;
- spindle servo/turning/sync mode;
- chuck/turret/tailstock/channel state;
- tool compensation or CSS state;
- transfer/resource ownership.

### 17.6 Checkpoint collapses all spindle machines to `cnc`

`src/core/recovery/job-checkpoint.ts` stores:

- G-code text/hash;
- sendable/acked counts;
- machine kind `laser | cnc`;
- 2D placement;
- timestamps/resume flag.

It contains none of the turning checkpoint state in section 16.

### 17.7 Current resume algorithm is a router-only sequence

`src/core/controllers/grbl/resume-program.ts`:

- tracks G20/G21, G0/G1, M3/M4/M5, S/F, and XYZ;
- rejects G91/G53/G28/G30;
- silently ignores most other G/M semantics;
- decides a program is CNC/router merely because it has a Z word;
- starts the saved M3/M4 spindle and dwells;
- commands `G0 Z<safe>`;
- travels to saved XY;
- feeds Z back to recorded depth.

For a lathe this is nonsensical and potentially dangerous:

- Z is the spindle axis, not router retract height;
- X is radial/diameter, not bed X;
- there may be no Y;
- G96 S is surface speed, not RPM;
- Haas G99 or LinuxCNC G95 changes feed meaning;
- the relevant spindle may be sub/live, not M3 main;
- a G76/G33/G95 cycle cannot be resumed from endpoint state;
- chuck and part ownership are unknown.

The correct guard is an explicit `router-grbl` program/machine contract, not inference from Z presence.

### 17.8 Local verdict

KerfDesk should not add scattered lathe codes to the existing parser or emitter. A safe path requires a separate process product:

~~~text
LatheMachineKit
TurningOperation IR
ControllerLatheDialect
TurningPost
TurningCycleExpander
TurningVerifier
TurningRecoveryPlanner
~~~

Until then:

1. imported turning/mill-turn files must not receive success-styled simulation;
2. the CNC label should remain explicitly router/mill, not imply all CNC;
3. resume must remain limited to generated, hashed, exact-dialect router programs;
4. external unsupported semantics must fail closed when they affect motion/process evidence.

## 18. Public-source architecture evidence

Pinned revisions:

| Project | Commit | Role |
| --- | --- | --- |
| LinuxCNC | [`f767337`](https://github.com/LinuxCNC/linuxcnc/commit/f767337cc3bc079f4a1a0f4d6b82a1a816b6acc8) | full interpreter, canonical/task layer, real-time planner, spindle feedback |
| FreeCAD CAM | [`85c1848`](https://github.com/FreeCAD/FreeCAD/commit/85c1848ad61439255b0f2ddb8fbf86342de4eaac) | CAM generation and postprocessing |
| grblHAL core | [`09f8ba5`](https://github.com/grblHAL/core/commit/09f8ba597abf54bc23da2bf2176065b84c94a4d2) | embedded controller with conditional lathe/threading features |
| Machinekit | [`ef46939`](https://github.com/machinekit/machinekit/commit/ef46939b490bfa029c9d25474cc2e35543c9ac8e) | archived LinuxCNC-derived controller |

### 18.1 LinuxCNC separates interpreter, motion, and hardware evidence

LinuxCNC provides the strongest public end-to-end turning reference in this tranche:

- the RS274 interpreter owns dialect/modal/cycle semantics;
- canonical motion commands carry synchronized intent into the motion layer;
- real-time motion consumes spindle position/speed/at-speed/index signals;
- HAL binds those signals to the actual encoder and drive;
- tool data and lathe orientation are explicit;
- simulation configurations exercise lathe programs.

Its motion interface exposes multiple numbered spindles and separate signals for command, actual speed, revolutions, index enable, orientation, lock, amplifier fault, and at-speed. [LinuxCNC motion interface](https://linuxcnc.org/docs/stable/html/man/man9/motion.9.html)

This is materially stronger than a sender which observes only `M3 S...` text and one RPM display.

### 18.2 LinuxCNC source-level details

The public implementation should be understood as a chain:

~~~text
RS274 parser/interpreter
-> canonical synchronized-spindle/cycle commands
-> task/motion command queue
-> trajectory planner and spindle synchronization
-> HAL spindle encoder/index/at-speed pins
-> physical drive and feedback
~~~

The important architectural property is that G33/G76 are not converted to a fixed linear feed by the host. Spindle phase remains a live real-time input to motion.

At the pinned revision:

- G95 selects `UNITS_PER_REVOLUTION`, records the selected spindle, and invalidates the prior F value in [`interp_convert.cc`](https://github.com/LinuxCNC/linuxcnc/blob/f767337cc3bc079f4a1a0f4d6b82a1a816b6acc8/src/emc/rs274ngc/interp_convert.cc#L2824-L2852);
- G33 wraps the move with position synchronization, while G76 enters `convert_threading_cycle` and expands each pass into retract/reposition, override control, position sync, cut, optional taper, sync stop, and retract ([G33/G76 dispatch](https://github.com/LinuxCNC/linuxcnc/blob/f767337cc3bc079f4a1a0f4d6b82a1a816b6acc8/src/emc/rs274ngc/interp_convert.cc#L5496-L5547), [pass expansion](https://github.com/LinuxCNC/linuxcnc/blob/f767337cc3bc079f4a1a0f4d6b82a1a816b6acc8/src/emc/rs274ngc/interp_convert.cc#L5631-L5773));
- the canonical layer distinguishes velocity synchronization for G95 from position synchronization for G33/G76 and recalculates CSS when work/G92/tool offsets change ([`emccanon.cc`](https://github.com/LinuxCNC/linuxcnc/blob/f767337cc3bc079f4a1a0f4d6b82a1a816b6acc8/src/emc/task/emccanon.cc#L519-L547), [CSS mapping](https://github.com/LinuxCNC/linuxcnc/blob/f767337cc3bc079f4a1a0f4d6b82a1a816b6acc8/src/emc/task/emccanon.cc#L2968-L2998));
- the real-time planner uses actual RPM for velocity sync and angular position/revolutions plus error correction for position sync, gating initial phase acquisition on at-speed and index ([`tp.c`](https://github.com/LinuxCNC/linuxcnc/blob/f767337cc3bc079f4a1a0f4d6b82a1a816b6acc8/src/emc/tp/tp.c#L3510-L3644));
- reverse execution refuses synchronized and rigid-tap segments ([`tp.c`](https://github.com/LinuxCNC/linuxcnc/blob/f767337cc3bc079f4a1a0f4d6b82a1a816b6acc8/src/emc/tp/tp.c#L3482-L3484)).

This is a reusable separation: interpreter cycle expansion, canonical synchronization intent, real-time phase control, and hardware feedback are distinct layers.

### 18.3 Public-code caveat

Open code is auditable but not automatically safe on a machine:

- a valid interpreter still depends on correct HAL wiring;
- `at-speed` can be incorrectly tied true;
- index/revolution scaling can be wrong;
- simulated lathe configs do not prove a physical spindle or chuck;
- OEM/user custom M-codes can change workholding behavior;
- accepted but unimplemented/undefined cycles must be rejected by admission policy.

LinuxCNC documents G87/G88 as accepted but unimplemented/undefined in the current manual. A parser accepting a code is therefore not proof of usable motion semantics. [LinuxCNC canned cycles](https://linuxcnc.org/docs/stable/html/gcode/g-code.html#gcode:g87)

### 18.4 LinuxCNC source findings

#### High-confidence defect path: same-block G7/G8 plus G76

At `f767337`, `convert_lathe_diameter_mode` scales G76 I/J/K when the diameter-mode transition is parsed ([source](https://github.com/LinuxCNC/linuxcnc/blob/f767337cc3bc079f4a1a0f4d6b82a1a816b6acc8/src/emc/rs274ngc/interp_convert.cc#L2721-L2779)). Later, `convert_threading_cycle` divides those values again whenever diameter mode is active ([source](https://github.com/LinuxCNC/linuxcnc/blob/f767337cc3bc079f4a1a0f4d6b82a1a816b6acc8/src/emc/rs274ngc/interp_convert.cc#L5702-L5706)). The pinned G76 tests set mode before the cycle and do not cover a same-block transition ([tests](https://github.com/LinuxCNC/linuxcnc/tree/f767337cc3bc079f4a1a0f4d6b82a1a816b6acc8/tests/interp/g76)).

Evidence classification: source-confirmed double-conversion path with missing regression coverage; not runtime reproduced in this tranche. The precise emitted/physical result should be reproduced in a LinuxCNC build before filing upstream.

The architectural lesson is broader: quantity conversion should occur once at a typed boundary. Modal conversion and cycle expansion must not both mutate the same raw address values.

#### Additional findings

- invalid G76 spindle selection reports an unrelated “Invalid D-number” diagnostic at [`interp_convert.cc:5534`](https://github.com/LinuxCNC/linuxcnc/blob/f767337cc3bc079f4a1a0f4d6b82a1a816b6acc8/src/emc/rs274ngc/interp_convert.cc#L5534);
- segment activation appears to iterate over all configured spindles for at-speed gating even though the synchronized segment selects one spindle ([`tp.c`](https://github.com/LinuxCNC/linuxcnc/blob/f767337cc3bc079f4a1a0f4d6b82a1a816b6acc8/src/emc/tp/tp.c#L3514-L3521)); this is a source-level multi-spindle defect candidate, not runtime-confirmed;
- the documented unsynchronized G76 exit and RPM-change hazard remain intentional behavior which software must surface rather than hide.

### 18.5 grblHAL audit

grblHAL recognizes G33, G76, G95, G96/G97, and G7/G8 at `09f8ba5`, but support is conditional:

- `SPINDLE_SYNC_ENABLE` is off by default and marked experimental; an encoder-capable driver/board or supported stepper-spindle feedback path is required ([`config.h`](https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/config.h#L537-L545));
- pulses-per-revolution defaults to zero, disabling synchronization, and at-speed wait has no timeout in the documented configuration block ([`config.h`](https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/config.h#L1210-L1219));
- G95 requires live spindle data and the planner recomputes velocity from actual RPM ([`gcode.c`](https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/gcode.c#L2413-L2414), [`planner.c`](https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/planner.c#L732-L742));
- G33/G76 force synchronization and G76 expands into explicit passes in [`motion_control.c`](https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/motion_control.c#L670-L823);
- the step ISR locks axis position to spindle angular position with pitch and PID timing correction ([`stepper.c`](https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/stepper.c#L322-L375));
- CSS derives RPM from radial position, surface speed, tool offset, and maximum RPM ([`planner.c`](https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/planner.c#L464-L481)).

Concrete limitations/TODOs:

1. thread taper pitch following and initial acceleration-distance compensation are explicitly unfinished ([`motion_control.c`](https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/motion_control.c#L675-L711));
2. G7/G8 semantics retain an implementation-specification TODO ([`gcode.c`](https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/gcode.c#L1484-L1489));
3. G96 transition handling contains unresolved S0/RPM-restore questions ([`gcode.c`](https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/gcode.c#L2416-L2436));
4. feed hold is delayed/disabled during a synchronized G76 cut so phase is preserved, increasing stop distance ([`motion_control.c`](https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/motion_control.c#L733-L766));
5. synchronized-feed validation checks Z maximum despite multi-axis G33 drive lines, a source-level tapered-move validation limitation ([`gcode.c`](https://github.com/grblHAL/core/blob/09f8ba597abf54bc23da2bf2176065b84c94a4d2/gcode.c#L1016-L1040)).

Verdict: grblHAL is valuable evidence that embedded phase locking is possible, but its lathe path is capability-gated and explicitly experimental. KerfDesk must not infer support merely because a grblHAL connection accepts the words.

### 18.6 FreeCAD CAM audit

At `85c1848`, FreeCAD's in-tree CAM pipeline remains milling-focused:

- its feeds/speeds roadmap lists turning/lathe work as deferred/out of scope ([roadmap](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/Roadmap/Epics/FeedsAndSpeeds.md#L225));
- current operations use manually entered horizontal/vertical feed and spindle speed rather than a turning process model ([roadmap](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/Roadmap/Epics/FeedsAndSpeeds.md#L36-L50));
- the LinuxCNC post describes itself as a three-axis-mill post ([`linuxcnc_post.py`](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/Path/Post/scripts/linuxcnc_post.py#L465-L480));
- it contains a source-level defect candidate in the annotated G84/G74 transformation: the post emits G33.1, an explicit spindle reversal, and another G33.1, while LinuxCNC G33.1 already performs synchronized entry, reversal, return, a second reversal, and finishes at the original coordinate ([`linuxcnc_post.py`](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/Path/Post/scripts/linuxcnc_post.py#L194-L284)); this likely duplicates the tap transaction but was not runtime reproduced in this tranche;
- its ordinary compatibility allowlist does not make G33/G76/G95/G96 a native generated turning stack ([`linuxcnc_post.py`](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/Path/Post/scripts/linuxcnc_post.py#L331-L388)).

This is a scope limitation, not a defect. It demonstrates that a general CAM project and a machine model do not automatically constitute turning support.

### 18.7 Machinekit provenance audit

Machinekit is archived and its pinned 2020 turning path is an older LinuxCNC-derived architecture. It uses canonical G95 feed synchronization, expands G33/G76 through the interpreter, gates position sync on at-speed/index in the planner, and uses the same CSS max-RPM/factor/X-offset structure.

It also contains the same same-block G7/G8 plus G76 double-conversion path ([modal conversion](https://github.com/machinekit/machinekit/blob/ef46939b490bfa029c9d25474cc2e35543c9ac8e/src/emc/rs274ngc/interp_convert.cc#L2059-L2113), [cycle conversion](https://github.com/machinekit/machinekit/blob/ef46939b490bfa029c9d25474cc2e35543c9ac8e/src/emc/rs274ngc/interp_convert.cc#L4722-L4728)).

Its current value is provenance: it shows how a quantity-conversion defect can be inherited across forks and persist when regression tests omit modal-transition blocks. It is not an independent modern implementation target.

## 19. Proposed turning/mill-turn architecture

### 19.1 Versioned machine kit

~~~text
TurningMachineKit {
  machineIdentity
  controllerContract
  postRevision
  verifierRevision
  geometryRevision
  calibrationRevision

  coordinateConvention
  axesAndCarriers
  channels
  turrets
  spindles
  workholdingDevices
  auxiliaries
  collisionModel
  resourceGraph
}
~~~

Machine, post, controller, simulation, and recovery models must be one compatible versioned kit. A post must not silently use different chuck/spindle/channel assumptions from the verifier.

### 19.2 Spindle actor

~~~text
SpindleActor {
  spindleId
  role: main | sub | liveTool | auxiliary
  mode: stopped | velocity | orienting | oriented | cAxis | synchronizedLeader | synchronizedFollower | fault
  commandDirection
  commandSpeed
  actualSpeed
  angularPosition
  indexEpoch
  atSpeedEvidence
  orientationEvidence
  rpmLimitEnvelope
  selectedByChannel
  driveFault
}
~~~

`commandSpeed` and `actualSpeed` must remain separate. Angular phase needs an epoch so a power cycle or encoder re-reference cannot be mistaken for continuous phase.

### 19.3 Workholding actor

~~~text
WorkholdingActor {
  deviceId
  kind: chuck | collet | tailstock | steadyRest | guideBushing | fixture
  commandState
  feedbackState
  clampMode: OD | ID | axial | support
  pressureOrForce
  seatingEvidence
  gripModelRevision
  qualifiedRpmEnvelope
  maintenanceEpoch
  partId
}
~~~

### 19.4 Tool and turret state

~~~text
TurningToolState {
  turretId
  station
  toolAssemblyId
  insertEdgeId
  holderGeometryRevision
  noseRadius
  orientation
  frontAngle
  backAngle
  geometryOffsetXZ
  wearOffsetXZ
  compensationMode
  measurementEpoch
}
~~~

The active physical station, programmed T code, tool table entry, and compensation source must agree.

### 19.5 Part and stock state

~~~text
TurningPartState {
  partId
  material
  currentStockGeometry
  heldBy
  transformToMainChuck
  transformToSubChuck
  cutoffState
  transferTransactionId
  featurePhase
  datumEvidence
  inspectionEvidence
}
~~~

### 19.6 Controller dialect contract

~~~text
LatheDialectContract {
  family
  version
  machineBuilderRevision
  unitsAndIntegerParsing
  diameterRadiusModes
  feedModes
  cssModesAndCaps
  threadAndTapCycles
  roughFinishGrooveCycles
  toolOffsetAndCompensationRules
  spindleSelectionAndSwap
  cAxisAndMappingModes
  chuckTailstockAuxCommands
  multiChannelWaitSemantics
  resetProgramEndBlockSearchMatrix
}
~~~

### 19.7 Expanded transaction IR

The interpreter should lower controller syntax into typed transactions:

~~~text
CanonicalTurningAction =
  | AxisMove
  | SpindleModeChange
  | SynchronizedMove
  | ThreadCycle
  | TapCycle
  | RoughingCycle
  | CompensationTransition
  | TurretIndex
  | WorkholdingCommand
  | SpindleSyncTransaction
  | PartTransferTransaction
  | ChannelBarrier
  | AuxiliaryTransaction
~~~

Each transaction declares:

- physical preconditions;
- resources acquired;
- hidden/expanded trajectory;
- evidence required for commit;
- legal interruption points;
- rollback or fault policy;
- resulting part/stock state.

### 19.8 Evidence-aware execution

Use a three-state evidence model:

~~~text
Commanded
ObservedButUnqualified
ProvedWithinContract
~~~

For example, an M110-like subchuck clamp command is only `Commanded`; a clamp switch makes it `ObservedButUnqualified`; pressure, seating, timing, part identity, and configured clamp mode may be needed for `ProvedWithinContract`.

## 20. Safety and correctness invariants

### P0: current false-assurance boundary

1. An unsupported lathe dialect or semantic cannot produce success-styled simulation.
2. G18, G7/G8, G96/G97, feed modes, compensation, cycles, and spindle/channel commands are fatal to an XYZ-only preview unless implemented exactly.
3. Imported files are bound to a selected dialect/version; no heuristic fallback authorizes motion.
4. The current resume generator accepts only hashed KerfDesk router output under its exact emitter revision.
5. `cnc` UI language does not imply lathe/mill-turn support.

### P1: single-spindle turning

6. X diameter/radius and every cycle-specific radial quantity are typed explicitly.
7. G18/frame/front-rear turret conventions are declared before motion.
8. Active tool station, physical assembly, orientation, geometry, and wear agree.
9. Tool-nose compensation has validated entry, lookahead, and exit.
10. CSS always has an explicit setup-qualified RPM cap.
11. The CSS cap does not exceed machine, chuck/jaw, stock, tool, or workholding limits.
12. CSS centerline uses the active work/tool frame and selected spindle.
13. Feed-per-revolution uses valid actual speed from the selected spindle.
14. Every rapid-to-feed after a spindle change proves at-speed under the controller contract.
15. Thread/tap motion requires valid index, phase, speed, direction, and axis feasibility.
16. Thread/tap/canned cycles are expanded before collision and restart analysis.
17. No automatic restart occurs inside a synchronized or hidden multi-pass cycle.
18. A power/hydraulic loss invalidates part seating, grip, and datum evidence.
19. Parting cannot commit until post-cut part ownership is proved.

### P2: live-tool and C-axis

20. Turning-spindle, oriented, braked, C-axis, and sync modes are mutually consistent.
21. C-axis engagement/disengagement is a proved transaction.
22. Main, sub, and live-tool spindle commands are never collapsed into one spindle state.
23. G107/G112-style mapping includes cylinder geometry, wrap, plane, and reset semantics.
24. Mapped motion is converted to joint/swept-volume motion before verification.

### P3: dual-spindle and multi-channel

25. A part-transfer transaction has explicit receiving and releasing chuck proofs.
26. No chuck opens unless another qualified retention path owns the part or separation is intended and contained.
27. Synchronized spindle leader, follower, phase offset, and retention across reset are explicit.
28. Part ownership and work offset switch atomically after physical transfer commit.
29. Barrier/wait graphs are complete and deadlock-free across every reachable branch.
30. A channel cannot resume while peer/resource state is unknown.
31. Shared collision-zone and spindle ownership is exclusive or explicitly coordinated.
32. Every auxiliary action which can collide or change support is in the resource graph.
33. `WAITMC` is not used where a physical exact stop is required.
34. Every persistent coordination marker carries a barrier/recovery epoch and is cleared or regenerated after reset.
35. Phase correction finishes before incompatible jaws/fixtures enter their interference zone.
36. Every irreversible auxiliary command has completion feedback, timeout, and a named fault state.
37. At least one proved retention/support path remains until intentional contained release.
38. No generic straight-line return to an interruption point is authorized without swept-volume proof.
39. Stored return coordinates are invalidated by tool, geometry, wear, or work-offset changes.
40. C-axis engagement requires actual zero speed plus orientation/engagement feedback; turning acceleration requires proved disengagement and brake release.
41. Thread and tap restart begins at a complete controller-approved phase-acquisition boundary.

## 21. Adversarial verification matrix

### 21.1 Dialect collision corpus

- LinuxCNC G94 versus Haas G94;
- LinuxCNC G95 versus Haas G95;
- LinuxCNC G98/G99 versus Haas G98/G99;
- LinuxCNC G92 versus Haas G92;
- LinuxCNC and Haas G76 parameter sets;
- G50 limit versus coordinate-setting dialect/configuration;
- identical text under wrong dialect must be rejected, never silently reinterpreted.

### 21.2 Coordinate and geometry

- G7/G8 with identical X values;
- front versus rear turret;
- positive/negative X tool side;
- G18 arcs with I/K;
- diameter X with radius I;
- OD versus ID contour;
- main versus subspindle mirrored frame;
- G14/G15-style spindle swap;
- geometry/wear offset update.
- Haas G171/G172 persistence across M00 versus reset at M30;
- G112 radius semantics overriding ordinary lathe X mode;
- SINUMERIK simultaneous channel/axis/expression-specific diameter states.

### 21.3 CSS and workholding

- X approaching zero with cap;
- missing cap;
- stale centerline/tool offset;
- cap above chuck qualification;
- heavy/tall jaw derating;
- OD versus ID grip;
- pressure loss/power cycle;
- commanded versus actual speed disagreement;
- spindle-at-speed never arrives;
- wrong spindle selected for CSS.

### 21.4 Feed and spindle feedback

- feed/rev under speed droop;
- zero/invalid speed feedback;
- spindle direction reversal;
- speed override under synchronized cycle;
- multiple spindle selector;
- G94/G95/G98/G99 resets;
- rapid-to-feed at-speed barrier.

### 21.5 Threading/tapping

- encoder index missing;
- phase discontinuity after reset;
- axis velocity infeasible for RPM/pitch;
- tapered G33;
- G76 OD/ID and G7/G8;
- same-block G7/G8 plus G76 versus prior-block mode selection;
- G76 entry/exit taper and relief groove;
- RPM change between hidden passes;
- internal thread final clearance;
- rigid tap reversal overshoot;
- stop at bottom of tap;
- resume attempt inside any atomic phase;
- selected-spindle synchronization with another configured spindle not at speed;
- grblHAL taper/run-in and multi-axis G33 validation;
- delayed feed-hold stop distance during a synchronized pass.

### 21.6 Compensation and cycles

- compensation on wrong tool orientation;
- insufficient lead-in;
- inside/outside corner lookahead;
- restart on activation/cancel block;
- hidden roughing pass collision;
- cycle profile subroutine branch;
- controller setting changes cycle behavior;
- accepted-but-unimplemented cycle.

### 21.7 Live tool and mapping

- C-axis requested while spindle rotating;
- engagement feedback missing;
- reset during C-axis mode;
- main spindle M3 while C-axis engaged;
- wrong live-tool P/S speed source;
- G112 X/C wrap crossing;
- G112 path crossing spindle center is rejected;
- G107 wrong radius/plane;
- holder-to-chuck collision during mapped move.

### 21.8 Transfer and multi-channel

- phase mismatch/jaw collision;
- receiving clamp fails;
- releasing clamp opens early;
- power loss while both chucks hold;
- power loss after release before separation;
- cutoff before subchuck proof;
- barrier ID mismatch;
- reversed barrier order/deadlock;
- one channel reset at barrier;
- stale persistent SETM marker after Reset/NC Start;
- WAITMC used where an exact stop is required;
- block search replaying a chuck/peripheral PLC auxiliary function;
- shared axis/resource double ownership;
- resume one channel while peer is mid-cycle.

### 21.9 Property/state-machine tests

- no reachable state has both chucks open while the part is expected retained;
- transfer commit is impossible without receiving proof;
- resource lock graph remains acyclic;
- every atomic cycle has declared safe interruption boundaries;
- all dialect code groups are mutually exclusive as documented;
- generated CSS program always declares a cap before G96;
- thread trajectory preserves phase across all passes in one epoch;
- parser/verifier disagreement blocks release.

## 22. Focused implementation order for KerfDesk

### Slice A: make existing scope honest

1. Rename user-facing generic CNC claims to router/mill where appropriate.
2. Add a supported-semantics classifier to external preview.
3. Refuse G18, G7/G8, G96/G97, G33/G76, turning cycles, C-axis mapping, spindle swap/sync, and channel constructs.
4. Downgrade any unsupported preview from success to explicit non-simulation evidence.
5. Bind recovery to native emitter revision and `router-grbl` program kind.
6. Add adversarial dialect-collision tests.

### Slice B: research-grade turning core

1. Typed diameter/radius and XZ geometry.
2. Cylindrical stock-removal model.
3. Turning tool/orientation/offset model.
4. One versioned dialect parser and cycle expander.
5. Final-NC verifier with no hardware execution.

### Slice C: single-spindle fixed-RPM lathe

1. Exact supported machine/controller kit.
2. Facing/OD/ID/groove/drill operations.
3. Tool/turret/workholding setup and collision proof.
4. Fixed-RPM and explicit feed mode only.
5. Hardware commissioning with air-cut/soft-stock evidence.

### Slice D: CSS and synchronized cycles

1. Setup-qualified dynamic RPM envelope.
2. Actual spindle speed/index/phase evidence.
3. G95-equivalent feed/rev under exact dialect.
4. G33/G76/rigid-tap expander and atomic recovery policy.
5. Workholding/encoder fault injection.

### Slice E: live tooling and C axis

1. Separate spindle actors.
2. Orientation/brake/C-axis engagement state machine.
3. Mapping and joint-space verification.
4. Full turret/holder/chuck collision model.

### Slice F: dual spindle and multi-channel

1. Part-ownership state machine.
2. Synchronized spindle contract.
3. Transactional handoff with physical proofs.
4. Channel scheduler, barriers, resource graph, and deadlock analysis.
5. Coordinated multi-channel restart only.

Skipping directly to Slice F by adding G/M codes would create a sender, not a safe mill-turn system.

## 23. Source-quality and evidence boundary

Official controller documentation applies to the named control generation/options; OEM parameters and machine-builder PLC logic can alter details.

Public source proves implemented paths only at the audited revision and configuration. A compile-time option or HAL signal name does not prove a physical encoder/interlock is wired correctly.

Workholding manuals publish limits under stated jaw, lubrication, pressure, and geometry conditions. They are not universal safe RPMs for arbitrary jaws/parts.

Tooling handbooks provide process guidance, not machine-specific collision or retention proof.

Simulation proves only what its dialect, geometry, cycle, channel, and physical-state models contain.

Local KerfDesk findings are source-confirmed at the named snapshot and require revalidation if the checkout advances.

Relevant standards reinforce the system boundary:

- [ISO 23125:2015](https://www.iso.org/standard/65500.html) covers turning machines including CNC turning centers, multi-spindle machines, integral workholding, handling, and chip-handling devices;
- [ISO 16090-1:2022](https://www.iso.org/standard/81558.html) covers machining centers, transfer machines, powered clamping, workpiece handling, tool changing, and additional turning capability.

Applying either standard requires the complete text, risk assessment, machine-builder design evidence, and competent validation; an abstract is not a compliance checklist.

## 24. Primary and high-signal references

### LinuxCNC

- [G-code reference](https://linuxcnc.org/docs/stable/html/gcode/g-code.html)
- [Lathe configuration](https://linuxcnc.org/docs/html/config/lathe-config.html)
- [Lathe user information](https://linuxcnc.org/docs/2.8/html/lathe/lathe-user.html)
- [Spindle control and encoder wiring](https://linuxcnc.org/docs/html/examples/spindle.html)
- [Motion and spindle HAL interface](https://linuxcnc.org/docs/stable/html/man/man9/motion.9.html)
- [Tool compensation](https://linuxcnc.org/docs/master/html/en/gcode/tool-compensation.html)

### Haas

- [Lathe G-code list](https://www.haascnc.com/service/service-content/guide-procedures/lathe---g-codes.html)
- [G96 constant surface speed](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG96.html)
- [G50 spindle speed limit](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG50.html)
- [G76 threading cycle](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG76.html)
- [G32 synchronized threading](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG32.html)
- [G95 live-tool rigid tapping](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG95.html)
- [G171/G172 diameter-radius override](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG172.html)
- [Setting 285 X programming mode](https://www.haascnc.com/service/codes-settings.type%3Dsetting.machine%3Dlathe.value%3DS285.html)
- [G199 synchronized spindle control](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG199.html)
- [G14/G15 secondary spindle swap](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG14.html)
- [Dual-spindle programming](https://www.haascnc.com/service/online-operator-s-manuals/lathe-operator-s-manual/lathe---options-programming.html)
- [G112 XY-to-XC interpolation](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG112.html)
- [G107 cylindrical mapping](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dlathe.value%3DG107.html)
- [Live-tool spindle commands](https://www.haascnc.com/service/codes-settings.type%3Dmcode.machine%3Dlathe.value%3DM134.html)
- [Lathe workpiece limits](https://www.haascnc.com/service/troubleshooting-and-how-to/reference-documents/lathe-work-piece-weight-limits.html)
- [Lathe operator manual](https://www.haascnc.com/content/dam/haascnc/en/service/manual/operator/english_lathe_interactive_manual_print_version_2023.pdf)

### Workholding and tooling

- [Kitagawa QJR chuck manual](https://kitagawa.global/media/technical/manu_QJR_en.pdf)
- [LMC ZA chuck manual](https://www.haascnc.com/content/dam/haascnc/en/service/reference/chuck/lmc-za---chuck-manual.pdf)
- [Sandvik Coromant Turning Handbook](https://www.sandvik.coromant.com/api/publications/view?fileName=C-1020-18.pdf&url=92df68b7-b8c0-494d-b290-e27f540b5885.pdf)
- [Sandvik threading application guide](https://cdn2.sandvik.coromant.com/files/a53b485b-be0f-019d-8100-3f0d1619b9fa/5370939c-6de5-4b34-a938-2fa290a42316/c-2920-031.pdf)

### Public repositories

- [LinuxCNC at `f767337`](https://github.com/LinuxCNC/linuxcnc/commit/f767337cc3bc079f4a1a0f4d6b82a1a816b6acc8)
- [grblHAL core at `09f8ba5`](https://github.com/grblHAL/core/commit/09f8ba597abf54bc23da2bf2176065b84c94a4d2)
- [FreeCAD at `85c1848`](https://github.com/FreeCAD/FreeCAD/commit/85c1848ad61439255b0f2ddb8fbf86342de4eaac)
- [Machinekit at `ef46939`](https://github.com/machinekit/machinekit/commit/ef46939b490bfa029c9d25474cc2e35543c9ac8e)

### Multi-channel, simulation, and standards

- [SINUMERIK ONE NC Programming](https://support.industry.siemens.com/cs/attachments/109988086/ONE_ncprogramming_progr_man_0325_en-US.pdf)
- [SINUMERIK thread fast retraction](https://support.industry.siemens.com/cs/attachments/109777373/ONE_axes_fct_man_1219_en-US.pdf)
- [SINUMERIK Extended Functions](https://support.industry.siemens.com/cs/attachments/109752347/840Dsl_extended_fct_man_1217_en-US.pdf)
- [SINUMERIK multi-channel block search](https://support.industry.siemens.com/cs/attachments/109310641/IHA_0309_en.pdf)
- [SINUMERIK programSYNC overview](https://support.industry.siemens.com/cs/attachments/109813154/828D_840Dsl_Operate_Turning_offer_ov_0822_en-US.pdf)
- [Siemens machine-kit simulation](https://www.siemens.com/en-us/products/janus-engineering-machine-kit-simulation/)
- [NX postprocessing and simulation](https://www.siemens.com/en-us/products/nx-manufacturing/cam-software/postprocessing-simulation/)
- [Okuma Collision Avoidance System](https://www.okuma.com/collision-avoidance-system)
- [FANUC CNC function catalog](https://www.fanucamerica.com/docs/default-source/cnc-files/cnc-function-catalog.pdf)
- [ISO 23125:2015](https://www.iso.org/standard/65500.html)
- [ISO 16090-1:2022](https://www.iso.org/standard/81558.html)

## 25. Verification performed

Evidence lanes:

1. official controller/machine documentation for Haas, LinuxCNC, SINUMERIK, FANUC, Okuma, and Mazak evidence boundaries;
2. official workholding, tooling, digital-twin, and standards scope material;
3. pinned public-source audits of LinuxCNC `f767337`, grblHAL `09f8ba5`, FreeCAD `85c1848`, and Machinekit `ef46939`;
4. direct source audit of KerfDesk at `e752a9125f02f832144c3b40800840ee5973fcf2`;
5. independent technical-consistency review covering controller scope, cycle boundaries, public-source evidence classification, and restart claims.

Local verification:

- 14 focused Vitest files passed, 133 tests total;
- parser, external-preview state, native CNC emitter, status, recovery, checkpoint, machine model/catalog, bounds, rotary, and preflight suites were included;
- the exact dossier passes Prettier check;
- named local source paths were rechecked;
- UTF-8/mojibake scan is clean; the only TODO tokens deliberately cite upstream grblHAL implementation comments, not unfinished dossier work;
- `git diff --check` passes;
- no tracked production file was changed.

Evidence limitations are explicit:

- the LinuxCNC/Machinekit G7/G8+G76 double-conversion path and multi-spindle at-speed behavior are source-level findings, not runtime reproductions;
- the FreeCAD double-G33.1 tap expansion is a source-level defect candidate, not a runtime reproduction;
- proprietary controller behavior is claimed only where public official material supports it;
- controller options, OEM PLC logic, actual wiring, and physical workholding still require machine-specific verification.

The focused tests verify current KerfDesk behavior. They do not implement turning or close the false-assurance boundary identified here.

## 26. Final engineering rule

Do not ask only:

> Does this file draw the intended XZ contour?

Ask:

> Under the exact lathe dialect, diameter/radius convention, tool orientation and wear, spindle/feed/phase state, CSS and dynamic workholding limit, expanded cycle trajectory, chuck/part ownership, live-tool/C-axis mode, and multi-channel resource schedule, does the posted program produce a collision-free, retained, synchronized, and recoverable physical process?

If the software cannot answer, it must refuse the claim. A two-dimensional lathe plot can be useful for visualization; it must never be presented as proof of machine behavior.
