> **Historical research archive: 11–13 July 2026.** Published on 6 September 2026.
> Findings, scores, source claims and proposed changes below describe their recorded
> baseline; they have not been revalidated and are not current product or qualification
> evidence. Unimplemented proposals are not adopted policy. The current
> [Frame-first contract](../../PROJECT.md) governs application behaviour. See the
> [archive index](2026-09-06-preserved-audits.md) and [source manifest](2026-09-06-preserved-audits-source-manifest.json).

# CNC Coordinate Frames, Multi-Axis Kinematics, and Volumetric Accuracy

Date: 2026-07-13
Scope: coordinate frames, work/tool offsets, indexed and simultaneous rotary machining, forward/inverse kinematics, TCP/RTCP, singularities, feed semantics, post/controller contracts, joint-space verification, calibration, volumetric accuracy, interruption, recovery, and implications for KerfDesk
Method: official controller and CAM documentation, public-source audits, standards abstracts, NIST and manufacturing research, and current-source audit of C:\Users\Asus\LaserForge\audit-current-main

## Executive verdict

An XYZ point is not a machine pose.

A physical cut depends on a complete relationship:

~~~text
programmed cutter pose in the workpiece frame
+ workpiece, fixture, pallet, local, rotated, and scaled frames
+ tool geometry and active length/radius compensation
+ machine topology and calibrated rotary pivots
+ inverse-kinematic branch and rotary turn state
+ active TCP/RTCP or tilted-work-plane mode
+ joint positions, limits, velocity, acceleration, and jerk
+ geometric, thermal, servo, compliance, and compensation state
= actual tool-to-workpiece pose and motion
~~~

The same programmed tool-tip point can have multiple valid machine-axis solutions. Some are outside travel, near a singularity, on the wrong side of a rotary limit, or collision-prone. A solution which is valid at one point may not connect continuously to the next. A program which was safe under an active tool-center transformation can become dangerous after Reset, E-stop, Handle Jog, tool-length change, rehoming, or a controller-specific transformation cancellation.

This makes multi-axis restart substantially harder than ordinary line replay:

- saving XYZABC does not necessarily preserve the inverse-kinematic branch;
- saving a Cartesian tool pose does not preserve multi-turn rotary position;
- re-solving IK can choose a different but pose-equivalent configuration;
- re-enabling TCP/RTCP can change coordinate mapping, invalidate the current work envelope, alarm, or—under controller-specific sequences—command compensating motion;
- a simple “retract Z” can move the wrong physical direction when the working plane or tool frame is rotated;
- a rotary home or unwind can sweep the tool, head, table, stock, or fixture through a collision;
- controller reset behavior changes transformation, tool, and offset state.

The correct software boundary is:

> Programmed pose, nominal kinematic pose, controller joint state, model-estimated/measured pose, and actual physical pose are different facts. Safe execution and recovery require them to be reconciled, not collapsed into one XYZ readout.

KerfDesk currently has an intentionally narrow native CNC model: XYZ only, fixed tool orientation, GRBL-flavored output, and 2D machine bounds. That is a reasonable product scope if it is enforced honestly. The serious problem is at the external-program preview boundary: unsupported coordinate transforms, tool-length modes, feed modes, and A/B/C motion are counted as notes while the file still opens with a success toast and an XYZ-only preview. A plausible but false path is worse than refusing an unsupported program.

The most important newly confirmed local findings are:

1. **The external NC parser silently ignores semantic transforms.** G54-G59, G92, G43/G49, G68, scaling, TCP modes, G93/G95, macros, and many other modal words do not change its state and are only reported as unsupported notes.
2. **A/B/C motion is ignored as geometry.** Only X/Y/Z/I/J/R make a target. A multi-axis block can therefore be displayed as a different or zero motion.
3. **The UI still calls that result a simulation and emits a success toast.** Unsupported notes are appended in parentheses after “Simulating ...”; they do not block the preview or downgrade its evidence.
4. **The machine model has no axes or joints.** It stores a 2D bed, optional informational Z travel, stock, tool records, spindle parameters, and tiling. There is no topology, pivot, rotary limit, joint rate, TCP capability, calibration revision, or kinematic model.
5. **The CNC intermediate representation has position but no orientation.** CncPass carries XY or XYZ points only. It cannot represent a cutter-location record, tool-axis vector, full orientation, IK branch, joint trajectory, path time, or controller transform state.
6. **Bounds and preflight are workspace-XY checks.** There is no Z travel envelope, rotary/joint limit, TCP swept volume, singularity, unwind, or configuration-space collision proof.
7. **The GRBL-family status parser truncates the axis model to XYZ.** grblHAL and FluidNC reuse it even though those firmwares can be built with additional axes; extra position components and non-XYZ limit inputs have no first-class state.
8. **The existing RotarySetup is not CNC rotary support.** It is a laser-only Y-distance substitution for roller/chuck engraving and explicitly does not apply to CNC jobs.
9. **The checkpoint and resume model are XYZ-only.** They carry no joints, rotary turns, branch, TCP mode, WCS transform stack, tool compensation, kinematic/calibration revision, or singularity/limit proof.

This tranche designs the required architecture and verification boundary. It does not add multi-axis execution to KerfDesk and does not modify production code.

## 1. Relationship to earlier research

Earlier dossiers established:

- the distinction between CAM intent, controller trajectory, mechanical response, and cutting process;
- modal/interpreter state and why line numbers do not reconstruct it;
- post-processor and controller capability contracts;
- probing, tool, WCS, and calibration evidence;
- workholding and physical part-state authority.

They also introduced multi-axis as a risk area. This tranche goes deeper by:

- defining the transform and kinematic mathematics;
- separating axis, joint, Cartesian pose, and physical controlled point;
- explaining IK branches, rotary turns, singularities, and feed mapping;
- comparing real TCP/RTCP controller behavior;
- defining calibration, uncertainty, and volumetric-error state;
- auditing the exact KerfDesk parser, IR, status, bounds, and recovery gaps;
- producing a staged architecture and adversarial verification suite.

## 2. Vocabulary that software must keep distinct

### 2.1 Axis and joint are not synonyms

An **axis coordinate** is a programmed coordinate such as X, Y, Z, A, B, C, U, V, or W.

A **joint** is a physical actuator coordinate: a slide, rotary table, tilting head, robot joint, or one side of a gantry.

For trivial Cartesian machines:

~~~text
X axis coordinate <-> joint 0
Y axis coordinate <-> joint 1
Z axis coordinate <-> joint 2
~~~

For nontrivial machines:

- one Cartesian axis can require several joints;
- one joint can influence several Cartesian coordinates;
- two motors can form one ganged axis;
- a head/table rotation changes tool-to-workpiece pose through a pivot;
- parallel or delta machines require nonlinear transforms;
- a display may show work coordinates while physical joints move differently.

LinuxCNC explicitly separates Cartesian positions from joint positions and implements machine-specific forward and inverse kinematics. See [LinuxCNC kinematics](https://www.linuxcnc.org/docs/html/motion/kinematics.html).

### 2.2 Position, direction, and orientation

A point has three translational degrees of freedom.

A full rigid-body pose has:

- position: three degrees of freedom;
- orientation: three degrees of freedom.

For a rotationally symmetric milling cutter, the tool-axis direction often defines only two orientation degrees of freedom because spin around the cutter axis is supplied by the spindle. But roll still matters when:

- the tool or holder is asymmetric;
- an angle head is used;
- a probe/stylus is asymmetric;
- coolant, cable, or sensor direction matters;
- collision geometry is not rotationally symmetric;
- tool posture or side-cutting orientation is programmed.

A data type named Vec3 cannot distinguish “position” from “direction.” Use explicit types.

### 2.3 Controlled point and cutting point

Possible points include:

- spindle gauge line;
- tool-reference point;
- tool center point or tool tip;
- ball-center point;
- side-cutting contact point;
- probe stylus center;
- actual cutter contact point on a surface.

TCP control maintains a declared controlled point. It does not automatically model the instantaneous contact point for every cutter shape. Tool-radius, 3D compensation, posture control, and CAM contact geometry are separate layers.

### 2.4 Machine, base, work, fixture, tool, and local frames

At minimum distinguish:

- machine base frame;
- individual joint/link frames;
- spindle/head frame;
- gauge-line frame;
- holder frame;
- tool/TCP frame;
- pallet/fixture frame;
- workpiece frame;
- programmed WCS;
- temporary/local frame;
- tilted/rotated working plane;
- probe/artifact frame.

“Origin” is not a sufficient data type. It must name which transform edge is being changed.

## 3. Homogeneous-transform foundation

Adopt one explicit convention:

~~~text
^A T_B = [ ^A R_B   ^A p_B ]
         [    0        1    ]
~~~

This transform maps a homogeneous column-vector point expressed in frame B into frame A:

~~~text
^A p = ^A T_B ^B p
~~~

Composition:

~~~text
^A T_C = ^A T_B ^B T_C
~~~

Inverse:

~~~text
(^A T_B)^-1 = ^B T_A
             = [ R^T  -R^T p ]
               [  0      1   ]
~~~

Rotation invariants:

~~~text
R^T R = I
det(R) = +1
~~~

LinuxCNC's five-axis documentation uses homogeneous transformations to derive representative table/table kinematics and explicitly starts from cutter-tip position plus cutter orientation. See [LinuxCNC five-axis kinematics](https://linuxcnc.org/docs/stable/html/motion/5-axis-kinematics.html).

NIST's machine-tool compensation work likewise uses transform chains to represent nominal geometry and error transforms. See [NISTIR 5236](https://nvlpubs.nist.gov/nistpubs/Legacy/IR/nistir5236.pdf).

### 3.1 Relative tool-to-workpiece pose

When both tool and workpiece move on different branches:

~~~text
^W T_T(q) = (^B T_W(qwork))^-1 ^B T_T(qtool)
~~~

This relative transform is the machining result.

Machine XYZ alone is not enough because:

- a table rotation moves the workpiece branch;
- a head rotation moves the tool branch;
- a mixed machine moves both;
- the same joint coordinate has different workpiece meaning after a fixture transform;
- installing a different physical tool assembly changes the physical tip pose at the same joint display;
- changing only tool-length compensation changes the controller's interpreted TCP and subsequent commanded motion, not the stationary physical tip.

### 3.2 Transform order is safety-critical

Rotation and translation do not commute:

~~~text
R T(p) != T(p) R
~~~

Common implementation errors:

- applying G92 before rather than after WCS;
- rotating a translation about the machine origin instead of the intended pivot;
- applying tool length in machine Z rather than tool-axis direction;
- mixing passive coordinate-frame rotation with active physical rotation;
- transposing a rotation because row/column conventions differ;
- treating degrees as radians;
- changing left/right multiplication order;
- serializing a transform without its frame direction.

Every transform must carry:

- source frame;
- destination frame;
- convention;
- units;
- revision;
- provenance;
- uncertainty;
- validity state.

## 4. Forward kinematics

Forward kinematics maps joint state to tool-to-workpiece pose:

~~~text
x = f(q, theta, Ttool, Twork, C, temperature)
~~~

where:

- q is joint position;
- theta is nominal/calibrated kinematic geometry;
- Ttool is tool/holder/TCP geometry;
- Twork is fixture/workpiece transform;
- C is active compensation state.

A serial chain can be represented with the product of exponentials:

~~~text
T(q) = exp([S1]q1) exp([S2]q2) ... exp([Sn]qn) M
~~~

Machine tools are often clearer as a transform graph because tool and workpiece occupy different branches.

### 4.1 Nominal versus actual kinematics

A useful physical model is:

~~~text
Tactual(q,T) = product_i [ Tnominal_i(qi) E_i(qi,T) ]
~~~

The error transforms E can include:

- linear positioning error;
- straightness;
- pitch, yaw, and roll;
- axis squareness;
- rotary zero and angular positioning;
- pivot location and axis direction;
- radial, axial, and tilt error motion;
- thermal drift;
- compensation tables.

Order matters. Error transforms generally do not commute.

### 4.2 Pose error

Avoid subtracting Euler angles. Define:

~~~text
Epose = Tdesired^-1 Tactual
xierror = log(Epose)^vee
~~~

This produces a local translation/rotation error twist and avoids representation discontinuities.

## 5. Inverse kinematics and branch state

Inverse kinematics solves:

~~~text
find q such that f(q) = xdesired
~~~

For common five-axis milling, xdesired may be TCP position plus a tool-axis direction rather than a full six-degree pose.

### 5.1 Why multiple solutions exist

Equivalent solutions can arise from:

- head/table “elbow” alternatives;
- positive versus negative tilt;
- C, C+360 degrees, C-360 degrees, and multi-turn equivalents;
- a pole where the secondary rotary angle becomes underdetermined;
- symmetric machine topologies;
- tool-axis-only tasks with free spin;
- controller-specific orientation parameterization.

Siemens documents multiple rotary solutions and turn/configuration state through controller-specific solution information such as STAT/TU. See the [SINUMERIK transformations function manual](https://support.industry.siemens.com/cs/attachments/109801200/840Dsl_transformations_fct_man_0721_en-US.pdf).

### 5.2 Pointwise nearest solution is not enough

Choosing the nearest IK solution independently at each cutter-location point can cause:

- a 180/360-degree rotary flip;
- a discontinuity in commanded velocity;
- collision;
- a later dead end at a joint limit;
- needless rewinds;
- passage through a singularity;
- cable, hose, or slip-ring overtravel.

Branch selection is a path problem:

1. enumerate feasible solutions at each path sample;
2. assign branch IDs and rotary turn counts;
3. connect only dynamically and collision-feasible transitions;
4. search for a continuous path with future limit/singularity margin;
5. reserve explicit reorientation/rewind regions.

A path-edge cost can include:

~~~text
C =
  wq * joint_motion
  + ws * singularity_penalty
  + wl * joint_limit_penalty
  + wc * collision_penalty
  + wa * acceleration_or_jerk_penalty
  + wr * rewind_future_cost
~~~

### 5.3 Branch and turn count are persistent state

Store separately:

- normalized rotary coordinate;
- physical multi-turn coordinate;
- controller display coordinate;
- branch identifier;
- solution-selection flags;
- winding/cable state;
- last continuous solution.

Normalizing every angle to minus/plus 180 degrees destroys real state.

## 6. Machine topologies

### 6.1 Three-axis Cartesian

- fixed tool orientation;
- tool and workpiece branches translate;
- usually identity axis/joint mapping;
- still depends on WCS, tool length, squareness, backlash, and volumetric error.

### 6.2 Indexed rotary: 3+1 and 3+2

Workflow:

~~~text
retract to a qualified clearance
-> stop or transition process state
-> unclamp rotary where applicable
-> move rotary joint(s)
-> confirm position and clamp
-> establish tilted frame/DWO/WCS
-> verify clearance and tool/work transforms
-> perform ordinary 3-axis cutting in the indexed orientation
~~~

Indexed motion and cutting motion are separate phases. It is simpler than simultaneous machining but still requires:

- rotary pivot calibration;
- joint/fixture collision;
- clamp/unclamp interlock;
- workplane transform;
- tool length;
- axis limits and unwind policy;
- restart state.

Haas G254 Dynamic Work Offset is explicitly intended for 3+1/3+2 positioning, not simultaneous contouring. See [Haas G254 DWO](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dmill.value%3DG254.html).

### 6.3 Simultaneous four/five-axis

Linear and rotary joints move while cutting. The system must preserve:

- tool-tip/contact path;
- tool orientation;
- joint continuity;
- commanded feed at the intended controlled point;
- full machine/tool/fixture clearance;
- rotary velocity/acceleration/jerk;
- singularity and limit margins.

### 6.4 Head, table, and mixed machines

**Table/table**

- workpiece rotates;
- large parts have large lever arms and swept volumes;
- workholding and rotary torque matter;
- tool branch may remain simple.

**Head/head**

- tool and holder rotate;
- tool length directly amplifies pivot error;
- cable/hose and spindle-head collision matter;
- workpiece may stay fixed.

**Head/table**

- both branches move;
- relative pose requires both chains;
- branch selection and collision are more complex.

The same XYZABC program is not portable among these topologies without a controller-level part-centric transform or a machine-specific post.

## 7. Orientation representation and interpolation

### 7.1 Euler/RPY angles

Advantages:

- familiar;
- compact;
- controller syntax may require them.

Risks:

- order-dependent;
- parameterization singularities;
- discontinuities at wrapping boundaries;
- componentwise interpolation does not generally follow a shortest rotation;
- the same orientation has multiple angle triples.

Treat Euler/RPY as I/O, not the canonical internal representation.

### 7.2 Rotation matrices

Advantages:

- explicit frame transform;
- composition is direct.

Requirements:

- maintain orthonormality;
- determinant +1;
- re-orthogonalize carefully after numerical drift.

### 7.3 Quaternions

Advantages:

- compact;
- stable interpolation;
- no Euler gimbal lock.

Requirements:

- normalize;
- q and -q are the same orientation;
- choose interpolation sign/arc continuously;
- quaternion continuity does not guarantee machine-joint continuity.

### 7.4 Tool-axis vectors

A unit tool-axis vector is a strong cutter-location representation for symmetric milling tools. LinuxCNC describes CAM cutter-location data as cutter-tip position plus cutter-orientation vector. Siemens supports orientation vectors, Euler angles, RPY, and controller-specific references such as workpiece versus machine system. See [SINUMERIK five-axis reference](https://support.industry.siemens.com/cs/attachments/109762409/SIN_WF5_0918_en-US.pdf).

But a direction vector does not specify roll. The model must say whether roll is:

- irrelevant;
- held from the previous solution;
- chosen to avoid collision/limits;
- explicitly programmed.

### 7.5 Interpolation contract

The path must declare:

- interpolation space: joint, tool axis, full orientation, work frame;
- geometric path: straight, great-circle/geodesic, spline, controller-specific;
- orientation tolerance;
- maximum angular rate;
- branch policy;
- controller versus post ownership.

Two endpoints do not uniquely specify the physical intermediate path.

## 8. Jacobian, singularities, and conditioning

Differential kinematics:

~~~text
V = J(q) qdot
~~~

For a five-axis milling task, use a reduced task Jacobian:

- three TCP translational components;
- two orientation-tangent components.

Including meaningless spin about an axisymmetric cutter can manufacture a false singularity.

With singular-value decomposition:

~~~text
J = U Sigma V^T
~~~

Near a singularity:

- the smallest singular value approaches zero;
- a small requested pose change can require very large joint motion;
- rotary direction can become unstable;
- feed collapses or following error rises;
- orientation can flip between equivalent solutions.

Indicators:

~~~text
sigma_min
kappa = sigma_max / sigma_min
manipulability = sqrt(det(J J^T))
~~~

### 8.1 Scale mixed units before conditioning

A Jacobian may mix:

- millimeters and radians;
- linear and angular TCP velocity;
- linear and rotary joint velocity.

A raw condition number is meaningless until a characteristic length and joint/task scaling are declared:

~~~text
Jscaled = Sx J Wq^-1
~~~

Changing millimeters to meters or degrees to radians must not arbitrarily change a safety verdict.

### 8.2 Damped inverse

One bounded inverse is:

~~~text
qdot =
  J^T (J J^T + lambda^2 I)^-1 Vdesired
~~~

This regularizes singular amplification but does not by itself enforce joint-velocity limits. The instantaneous twist-rate residual is:

~~~text
r_twist = Vdesired - J qdot
~~~

Joint limits still require constrained IK and path/feed scheduling. The twist-rate residual is not pose error; evaluate accumulated deviation over time or use a pose residual such as `Log(Tdesired^-1 T(q))`. Translation and rotation need declared scaling and separate tolerances. Damping is not permission to silently alter a cutter path.

### 8.3 Controller/post singularity handling

Autodesk's current post API exposes singularity handling with:

- activation cone;
- required rotary-angle change;
- tool-axis adjustment tolerance;
- linearization tolerance;
- linear versus rotary linearization methods.

It can add points and adjust tool axis to stay within tolerance while reducing large rotary motion near the pole. See [Autodesk MachineConfiguration](https://cam.autodesk.com/posts/reference/classMachineConfiguration.html).

The lesson is that “avoid singularity” is not one Boolean. It requires:

- definition of the singular set;
- activation margin;
- allowed path/orientation deviation;
- joint-rate limits;
- linearization policy;
- evidence that the modified path remains within process tolerance.

## 9. Feed and time semantics

Let a cutter path be parameterized by s and IK produce q(s):

~~~text
qdot = qs * sdot

qddot = qss * sdot^2 + qs * sddot

qjerk =
  qsss * sdot^3
  + 3 qss * sdot * sddot
  + qs * sjerk
~~~

Velocity-only path limit:

~~~text
sdot_max = min_i(qdot_i_max / abs(qs_i))
~~~

Acceleration and jerk add coupled constraints. Near singularity, qs can grow and the achievable TCP feed collapses.

### 9.1 G94 units per minute

Meaning depends on controller and controlled point.

LinuxCNC documents a hierarchy: if XYZ moves, feed is based on Cartesian XYZ distance and rotary axes coordinate their start/finish; pure rotary behavior uses angular units. See [LinuxCNC feed modes](https://linuxcnc.org/docs/html/gcode/g-code.html#gcode:g93-g94-g95).

Under controller TCP, G94 may refer to tool-tip speed relative to workpiece. FANUC describes G43.4 TCP allowing feed-per-minute at the tool tip and automatically limiting for the constraining axis. See [FANUC five-axis workflow](https://www.fanucamerica.com/docs/default-source/cnc-files/mwa-030-en_01_1511_5-axis.pdf).

### 9.2 G93 inverse time

In inverse-time mode:

~~~text
block duration minutes = 1 / F
F = 1 / block_minutes
~~~

LinuxCNC requires an F word on every G1/G2/G3 block in G93. Inverse time gives intended block duration but does not override physical joint limits.

For desired controlled-point speed v and block path length L:

~~~text
block_time = L / v
F_inverse_minutes = v / L
~~~

The correct L depends on:

- controller TCP ownership;
- tool-tip versus machine-axis path;
- linear/angular metric;
- orientation interpolation;
- tool length/pivot radius;
- post/controller convention.

### 9.3 Degrees per minute and hybrid metrics

Some posts/controllers use:

- degrees/minute for pure rotary;
- weighted rotary distance;
- diameter/radius conversion;
- DPM/FPM combinations;
- pulse-weight ratios.

Autodesk's post API exposes inverse-time, degrees/minute, feed-per-minute, maximum feed, tolerance, and pulse-weight settings because the correct output is machine/control specific.

### 9.4 Lookahead and block density

CAM often approximates curves with short line segments. Physical execution depends on:

- controller block-processing rate;
- lookahead depth;
- smoothing/tolerance mode;
- acceleration/jerk;
- singularity/limit deceleration;
- orientation discontinuities.

If blocks arrive faster than the interpreter/controller can process them, feed falls even when axis mechanics could go faster. Path densification around a singularity can therefore fix geometric tolerance while creating a block-rate failure.

### 9.5 G95 and controller-specific feed metrics

LinuxCNC's G95 feed-per-revolution mode requires a valid actual-speed input from the correct physical spindle and requires a newly declared F value when switching between G94 and G95. Other controls require their exact manuals/contracts. In all cases, G95 alone is not evidence of rigid spindle/axis synchronization. Siemens' `FGROUP`/`FGREF`, HEIDENHAIN's TCP-versus-axis feed choices, and LinuxCNC's XYZ-versus-pure-rotary behavior show why a numeric F word without a named controlled point and metric is incomplete.

A post/controller contract must therefore identify whether feed means TCP speed, XYZ-only Cartesian speed, physical-axis contour speed, an equivalent-radius rotary metric, inverse block time, or feed per revolution tied to a named spindle.

## 10. Real controller TCP/RTCP semantics

### 10.1 Haas G234 TCPC

Haas G234 combines:

- active work offset;
- machine rotary zero point (MRZP);
- tool length offset;
- rotary state.

It maintains programmed tool-tip position through rotary **feed** moves.

Critical official details:

- rotary axes must be at zero before activation on the documented workflow;
- G234 cancels the previous H code and requires H on the G234 block;
- G43/G44/G49 and several operator actions cancel it;
- Reset, E-stop, Handle Jog, List Program, M02, and M30 cancel it;
- M00/M01 do not;
- tool-tip position is not maintained during rapid rotary moves;
- Haas says not to program rapid rotary motion while TCPC is active;
- activating G234 rotates the work envelope and can cause immediate overtravel near limits;
- Haas recommends establishing a new XYZ after activation.

See [Haas G234 TCPC](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dmill.value%3DG234.html).

These details destroy any generic resume assumption. A recovery routine must know whether G234 survived the exact interruption/operator action, whether the H offset is still valid, and whether reactivation is safe at the current joint pose.

### 10.2 Haas G254 DWO

G254 is intended for indexed 3+1/3+2 work. It uses MRZP and active work offset to compensate part location across rotary indexing. It has its own cancellation behavior and constraints. See [Haas G254 DWO](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dmill.value%3DG254.html).

Do not treat DWO and TCPC as synonyms:

- DWO: indexed working-plane/location compensation;
- TCPC: simultaneous tool-tip control.

### 10.3 Siemens TRAORI

TRAORI activates an orientation transformation:

- XYZ refer to tool-tip position;
- rotary effects on tool tip are compensated by linear axes;
- tool length is taken from tool data;
- feed refers to tool-tip motion relative to workpiece;
- orientation can be programmed independently of machine rotary coordinates.

Siemens warns that, depending on machine configuration, activating TRAORI can reset active zero offset or tool-edge compensation; it recommends reactivating them afterward. See [SINUMERIK mold-making 3-to-5-axis manual](https://support.industry.siemens.com/cs/attachments/109762409/SIN_WF5_0918_en-US.pdf).

The controller supports multiple orientation representations and reference systems. That flexibility increases the state which a post, simulator, and restart engine must reconstruct.

The transformation manual makes two further distinctions which a generic `tcp: true` flag cannot express:

- `TRAORI_DYN` performs interpolator compensation so the TCP follows the programmed path during orientation change;
- `TRAORI_STAT` and `PTPWOC` do not provide the same dynamic tool-tip path guarantee.

Siemens also exposes multiple kinematic solutions and rotary variants through solution state such as `STAT` and `TU`. A Cartesian pose reached after block search can therefore be physically different from the interrupted pose even when XYZ and tool orientation match. Pole handling may reduce feed, alarm, freeze one rotary, or deliberately change orientation interpolation inside configured pole tolerances. These are realized-path semantics, not merely diagnostics. See the [SINUMERIK transformations function manual](https://support.industry.siemens.com/cs/attachments/109801200/840Dsl_transformations_fct_man_0721_en-US.pdf).

### 10.4 FANUC G43.4/G43.5 family

FANUC describes TCP as translating a part-program tool-tip path into machine linear/rotary positions and maintaining the tool center as orientation changes. Its part-centric workflow combines:

- workpiece setting error compensation;
- TCP;
- tilted working plane;
- probing/kinematic calibration;
- controller lookahead/smoothing.

See [FANUC five-axis machining](https://www.fanucamerica.com/cnc-applications/5-axis) and [FANUC five-axis workflow](https://www.fanucamerica.com/docs/default-source/cnc-files/mwa-030-en_01_1511_5-axis.pdf).

### 10.5 HEIDENHAIN M128/TCPM

HEIDENHAIN documents:

- M128/TCPM tool-center behavior;
- tool-coordinate-system orientation;
- configurable path/axis control;
- 3D tool compensation;
- dynamic collision monitoring using machine-builder-defined objects;
- optional liftoff behavior at NC stop;
- kinematic calibration/optimization.

See [TNC 640 Programming Manual](https://content.heidenhain.de/doku/tnc_guide/pdf_files/TNC640/34059x-18/bhb/892903-2C.pdf) and [TNC 640 ISO Programming Manual](https://content.heidenhain.de/doku/tnc_guide/pdf_files/TNC640/34059x-18/diniso/892909-2C.pdf).

`FUNCTION TCPM` exposes several independent choices:

- `F TCP` versus `F CONT`: tool-tip-relative feed versus axis-contouring feed;
- `AXIS POS` versus `AXIS SPAT`: physical rotary positions versus spatial orientation;
- `PATHCTRL AXIS` versus `PATHCTRL VECTOR`: physical-axis interpolation versus tool-vector interpolation;
- guide/reference-point choices such as tip-to-tip and tip-to-center.

The interpolation choice can alter the physical rotary endpoint and the machined flank surface. HEIDENHAIN error documentation also identifies cases where vector interpolation cannot produce smooth rotary motion because of pole geometry, limits, or machine kinematics. See [TNC error messages](https://content.heidenhain.de/doku/tnc_guide/pdf_files/Fehlermeldungen_TNC/pdf_mls19/Errors_en_SW19.pdf).

### 10.6 Portable lesson

“TCP supported” is insufficient capability metadata. Store:

- exact controller family/version/options;
- activation/cancellation commands;
- required axis state before activation;
- work/tool offset interactions;
- rapid versus feed behavior;
- reset/jog/tool-change behavior;
- orientation representation;
- feed contract;
- branch/rewind ownership;
- post revision and verified sample.

The contract must also state whether the transformation is dynamic or static, which point defines feed, which orientation interpolation applies, whether rapid rotary preserves the TCP, and which state survives Reset, E-stop, program end, mode change, jog, or tool change.

## 11. CAM, post, and simulation contract

### 11.1 Cutter-location data should remain machine-independent until posting

A strong intermediate representation contains:

- cutter point;
- tool-axis or full orientation;
- contact/tolerance metadata;
- feed intent at a named controlled point;
- operation/process semantics.

The post/controller mapping then owns:

- machine topology;
- axis signs and pivots;
- branch selection;
- rotary preference/ranges;
- TCP/DWO/TWP capability;
- inverse-time/DPM calculation;
- unwind/retract/reconfigure;
- controller codes.

### 11.2 Autodesk post API

Autodesk exposes:

- table/head role;
- rotary axis vector and offset;
- angular range, cyclic behavior, and preference;
- TCP enablement;
- XYZ/ABC feasibility;
- mapping between tool direction and ABC;
- tool-length head compensation;
- rotary optimization;
- singularity handling and linearization;
- machine rewinds;
- safe retract/plunge feeds and distances;
- stock expansion for rewind clearance;
- inverse-time/DPM/FPM calculation;
- maximum block-processing speed.

See [MachineConfiguration](https://cam.autodesk.com/posts/reference/classMachineConfiguration.html), [PostProcessor](https://cam.autodesk.com/posts/reference/classPostProcessor.html), and [entry functions](https://cam.autodesk.com/posts/reference/entry_functions.html).

This is strong evidence that a production post is a kinematic program generator, not a string template.

### 11.3 Rewind/retract/reconfigure

When a rotary nears a limit, the system may need:

~~~text
leave cut under a defined lead-out
-> stop or transition spindle/process state as required
-> retract along a verified collision-free path
-> move/unwind rotary joints
-> remap/reseed branch and turn state
-> restore tool/work transforms
-> approach along a verified path
-> re-enter cut under a lead-in
~~~

Changing an angle by plus/minus 360 without physical motion is only valid when the controller and axis semantics support coordinate reset independently of real winding state.

### 11.4 Machine simulation must use the final NC semantics

A CAM tool-axis preview can miss:

- post-selected branch;
- controller-side IK;
- TCP activation/cancellation;
- actual unwind;
- controller smoothing;
- machine/tool/fixture collision;
- joint rate/limit violations.

The highest-value verification uses:

- exact machine definition;
- exact postprocessed program;
- controller-accurate modal/transform behavior;
- complete tool/holder/fixture/stock geometry;
- joint-space trajectory.

NX and FANUC describe G-code/control-aware digital-twin workflows for this reason. A CAM-only path and the final controller trajectory are different evidence levels.

### 11.5 Autodesk/Fusion architecture findings

Fusion's machine definition is a parented kinematic tree of head, table, linear, rotary, and static carrier components. Its post API represents axis vector and pivot, head/table ownership, range or cyclic behavior, TCP capability, angular preference, feed/rapid limits, and resolution. It also exposes primary/secondary ABC solutions, current-state-aware mapping, singularity cones and linearization, inverse-time/DPM/FPM feed modes, and safe retract/reconfigure callbacks.

This yields several reusable design rules:

1. axes are physical parented joints, not an unordered `A/B/C` list;
2. a direction-only tool axis leaves roll underdetermined;
3. IK selection must consider the current joint state and whether the complete section fits travel;
4. rewind is a retract/re-index/restore/re-entry transaction, not angle normalization;
5. splitting a G93 move requires recomputing inverse time on every generated block;
6. the machine definition and post must not silently disagree about kinematics.

See [Fusion machine kinematics](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-MACHINE-KINEMATICS.htm), [Machine Builder](https://help.autodesk.com/view/fusion360/ENU/index.html?guid=MFG-MACHINE-BUILDER-TASK), [MachineConfiguration](https://cam.autodesk.com/posts/reference/classMachineConfiguration.html), and [PostProcessor](https://cam.autodesk.com/posts/reference/classPostProcessor.html).

### 11.6 NX and Mastercam workflow findings

Siemens NX's strongest public architecture is a versioned machine kit/digital twin containing geometry, kinematics, controller behavior, post, and G-code-driven simulation. Siemens explicitly distinguishes toolpath-driven from final-G-code-driven evidence because controller IK selection and post-added home, tool-change, safe-position, and auxiliary moves affect real motion. It also analyzes rotary overtravel, velocity, reversal, and path segment density. See [NX controller-aware simulation](https://blogs.sw.siemens.com/nx-manufacturing/how-nx-cam-simulation-capabilities-validate-machines-and-processes/), [G-code-driven machine simulation](https://blogs.sw.siemens.com/nx-manufacturing/Theme-of-the-Month-Machine-Tool-Simulation/), and [Post Hub machine kits](https://blogs.sw.siemens.com/nx-manufacturing/80000-nx-cam-postprocessor-downloads-a-new-milestone-for-post-hub/).

Mastercam publicly separates World, Work, Tool, and Construction planes, and packages machine definition, control definition, and post files together. It distinguishes indexed 3+2 from simultaneous motion and requires fixture/stock/machine simulation plus comparison of posted data against the actual control. The public material establishes the workflow, but not enough algorithmic detail to audit its singularity, branch, unwind, or inverse-time implementation. See the [Mastercam core blueprint](https://www.mastercam.com/wp-content/uploads/2023/03/Core-Blueprint-2023.pdf), [multiaxis blueprint](https://www.mastercam.com/wp-content/uploads/2023/03/Multiaxis-Blueprint-2023.pdf), and [post-processing guide](https://www.mastercam.com/community/blog/post-processing-for-cad-cam-software-your-complete-guide/).

### 11.7 FreeCAD public-source audit

The official FreeCAD repository was audited at commit [`85c1848ad61439255b0f2ddb8fbf86342de4eaac`](https://github.com/FreeCAD/FreeCAD/commit/85c1848ad61439255b0f2ddb8fbf86342de4eaac), dated 2026-07-12.

Its emerging CAM machine model is useful: it has a base frame, parented linear/rotary axes, joint origin/vector, head/table role, range and velocity, branch preference, wrap strategy, and TCP/DWO capability metadata. The indexed orientation solver includes forward-kinematic validation, candidate expansion, present-state costing, and primary/flip alternatives. See the [machine model](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/Machine/models/machine.py), [orientation solver](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/Path/Base/Generator/rotation.py), and [solver tests](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/CAMTests/TestPathRotationGenerator.py).

The audited implementation is not yet an industrial simultaneous-five-axis reference:

1. It implements indexed 3+2: one workplane vector is solved, a bare `G0` ABC block is emitted, the geometry is rotated Z-up, and an ordinary 3-axis operation follows.
2. `solve_orientation()` accepts current joint state, but the operation integration does not propagate the previous physical ABC state, so continuity across operations is not established.
3. Successful solutions currently hard-code `singular=false`; no conditioning or singularity margin is calculated.
4. The generic nonstandard two-axis solver is unimplemented, more than two rotaries fail, and chain traversal is incomplete for general branching machines.
5. Indexing does not itself prove a machine-coordinate retract, holder/fixture clearance, rotary unlock/lock sequence, or controller-specific TWP/TCP transaction.
6. TCP/DWO capability fields are model/editor metadata, not motion-generation behavior.
7. `REZERO` adds a `rotary_rezero` annotation, but no audited post consumes it to emit the required controller reset; modulo output can therefore lose physical winding semantics.
8. The base processor recognizes G93 but formats F as ordinary units-per-minute data rather than computing block duration and forcing F on every inverse-time cutting block.
9. A source/test contradiction around inch-mode ABC formatting suggests angular and linear quantities still need explicit types; this is a regression candidate, not a confirmed runtime defect until executed in a FreeCAD environment.

See the [operation integration](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/Path/Op/Base.py), [rotary wrap generator](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/Path/Base/Generator/rotary_wrap.py), and [post core](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/Path/Post/Processor.py).

Verdict: FreeCAD is a high-value open reference for an early indexed-machine model and for concrete failure modes at subsystem boundaries. It should not be treated as proof of simultaneous multi-axis safety or controller-accurate restart.

## 12. Calibration and volumetric accuracy

### 12.1 Four state layers

Keep distinct:

1. programmed pose;
2. nominal machine pose from ideal kinematics;
3. model-estimated or measured pose, together with its uncertainty;
4. actual physical tool-to-workpiece pose after geometric error, compensation, thermal state, servo behavior, compliance, tool, fixture, and cutting load.

Uncertainty limits knowledge of the physical pose; it does not physically move the machine.

### 12.2 Conventional geometric errors

Each nominal linear axis has six position-dependent rigid-body error motions:

- positioning;
- two straightness components;
- pitch;
- yaw;
- roll.

Three linear axes produce 18 intra-axis terms. Three inter-axis squareness terms form the familiar 21-error model.

Five-axis machines add:

- rotary angular positioning;
- radial, axial, and tilt error motion;
- pivot-location error;
- rotary-axis direction/link error;
- rotary/linear squareness;
- speed-induced axis shifts;
- thermally induced axis shifts.

NIST's 2023 review classifies machine errors as intra-axis, inter-axis/link, and resulting volumetric errors. See [NIST machine-tool calibration review](https://www.nist.gov/publications/machine-tool-calibration-measurement-modeling-and-compensation-machine-tool-errors).

### 12.3 Rotary pivot error

For point p rotating about unit axis u through pivot c:

~~~text
p(q) = c + Ru(q)(p0 - c)
~~~

Pivot error contribution:

~~~text
delta_p approximately (I - Ru(q)) delta_c
~~~

Small angular-axis error:

~~~text
delta_p approximately delta_theta cross r
~~~

The lever arm r means tiny angular/pivot errors become large TCP errors for long tools, large fixtures, or distant parts.

Haas gives a concrete sensitivity example: 0.0005 inch MRZP X error can create 0.001 inch mismatch between features machined at B+90 and B-90. See [Haas MRZP and safe zones](https://www.haascnc.com/service/online-manuals/umc-series/umc---mrzp.html).

### 12.4 Calibration workflow

1. Establish traceable instrument/artifact state.
2. Warm and stabilize the machine according to procedure.
3. Measure across a pose set with sufficient spatial and angular excitation.
4. Fit only observable parameters.
5. inspect design-matrix singular values and parameter covariance.
6. reject outliers only under a documented rule.
7. verify on independent held-out poses.
8. apply compensation.
9. independently verify the compensated result.
10. version the model, data, temperature, instrument, and validity domain.

BLUM KinematicsPerfect measures a calibration sphere across rotary poses, estimates spatial deviation, updates kinematic parameters, and supports checks after collision or wear. See [BLUM KinematicsPerfect](https://www.blum-novotest.com/us/products/measuring-components/measurement-software/kinematicsperfect/).

### 12.5 Metrology methods

| Method | Useful evidence | Important boundary |
| --- | --- | --- |
| Laser interferometer | linear positioning; suitable optics add straightness/angular errors | environment, cosine/Abbe alignment, one measured path |
| Multi-axis laser | simultaneous linear, straightness, pitch/yaw/roll along a slide | still needs inter-axis and rotary characterization |
| Ballbar | circular contouring, backlash, reversal, scale/squareness, servo health | composite result, not full volumetric identification |
| R-test/chase-the-ball | rotary/linear relative TCP error and pivot/link identification | artifact/probe geometry, pose observability, uncertainty |
| AxiSet/KinematicsOpt-style sphere cycle | fast rotary-pivot health/correction | focused check, not complete machine dynamics |
| Laser tracker | large-volume 3D network measurement | line of sight, tracker angular/range/eccentricity errors |
| On-machine probe | automated health checks and datum recovery | same machine error chain; probe pretravel/lobing |
| Finished test piece | end-to-end cutting under real process | conflates machine, tool, fixture, material, temperature |

### 12.6 Standards map

- [ISO 230-1:2012](https://www.iso.org/cms/%20render/live/en/sites/isoorg/contents/data/standard/04/64/46449.html): geometric accuracy under no-load/quasi-static conditions.
- [ISO 230-2:2014](https://www.iso.org/cms/%20render/live/en/sites/isoorg/contents/data/standard/05/52/55295.html): linear/rotary positioning accuracy and repeatability.
- [ISO 230-3:2020](https://www.iso.org/standard/73291.html): thermal effects.
- [ISO 230-4:2022](https://www.iso.org/standard/79155.html): circular and constant-radius coordinated-axis tests.
- [ISO 230-6:2002](https://www.iso.org/standard/30762.html): body/face diagonal displacement tests.
- [ISO 230-7:2015](https://www.iso.org/standard/56624.html): rotary-axis error motion and speed-induced axis shifts; rotary positioning accuracy belongs to ISO 230-2 and thermal effects to ISO 230-3.
- [ISO/TR 230-9:2005](https://www.iso.org/cms/%20render/live/en/sites/isoorg/contents/data/standard/03/91/39165.html): uncertainty estimation for ISO 230 tests.
- [ISO 230-10:2022](https://www.iso.org/standard/78909.html): probing-system measuring performance.
- [ISO 10791-6:2014](https://www.iso.org/cms/%20render/live/en/sites/isoorg/contents/data/standard/04/64/46440.html): speed and simultaneous interpolation accuracy.
- [ISO 10791-7:2020](https://www.iso.org/cms/live/live/es/sites/isoorg/contents/data/standard/07/38/73814.html): finished test pieces for three-to-five-axis machining.

Standards scopes are complementary. Passing a no-load geometry test does not prove high-speed cutting, workholding, thermal, or process performance.

## 13. Measurement uncertainty and compensation validity

For measurement model:

~~~text
y = f(x1, ..., xn)
~~~

First-order covariance propagation:

~~~text
Sigma_y approximately Jf Sigma_x Jf^T
~~~

Scalar combined uncertainty:

~~~text
uc^2(y) =
  sum(ci^2 ui^2)
  + 2 sum(ci cj u(xi,xj))
~~~

Expanded uncertainty:

~~~text
U = k uc
~~~

See [NIST Technical Note 1297](https://www.nist.gov/pml/nist-technical-note-1297) and the [JCGM GUM](https://www.bipm.org/documents/20126/2071204/JCGM_100_2008_E.pdf/cb0ef43f-baa5-11cf-3f85-4dcd86f77bd6?download=true).

Important contributors:

- instrument calibration;
- resolution and repeatability;
- cosine and Abbe alignment;
- air temperature/pressure/humidity;
- machine/artifact temperature and CTE;
- probe pretravel and lobing;
- sphere/target calibration;
- fixture stability;
- encoder interpolation;
- servo following error;
- thermal drift during measurement;
- model-form error;
- parameter covariance;
- compensation interpolation.

An illustrative scalar, symmetric guard-band rule is:

~~~text
abs(predicted_error) + U <= allowed_error
~~~

This is not a general multi-axis pose rule. Production acceptance should be component-wise or covariance-aware, and must not combine translation and rotation without a declared metric/scaling and separate tolerances.

### 13.1 Compensation is bounded evidence

A compensation map is valid only inside its qualified:

- joint-position domain;
- work-volume domain;
- temperature/warm-up domain;
- speed/direction domain;
- tool/pivot configuration;
- machine revision;
- time/maintenance state.

Compensation does not cure:

- nonrepeatable backlash;
- looseness;
- vibration;
- following error;
- cutting-load deflection;
- crash damage;
- thermal state outside the model;
- bad workholding;
- stale tool/fixture geometry.

Extrapolation must be blocked or explicitly degraded. Every map update needs independent verification.

## 14. Interruption and restart

### 14.1 Required checkpoint state

~~~text
actual and commanded joint positions
encoder/reference/homing epoch
following error and axis health
rotary branch ID and turn counts
controller solution flags such as STAT/TU
active kinematic/TCP/DWO/TWP transformation
complete machine/work/local/scaled/rotated frame stack
tool ID, holder/TCP geometry, and length/radius offsets
fixture/workpiece identity and transform
kinematic-model and compensation-map revisions
calibration and current thermal state
current cutter-location path parameter
orientation interpolation state
feed mode and block-time semantics
planner/execution frontier
collision/singularity/joint-limit proof revision
workholding and physical part-state evidence
~~~

### 14.2 Why XYZABC is insufficient

The same displayed pose can map to:

- a different multi-turn rotary position;
- another IK branch;
- a collision-prone head/table configuration;
- different physical TCP after tool-length change;
- different pose after MRZP/calibration change;
- different pose after work/local-frame change;
- an extreme near-singular joint solution.

### 14.3 Safe recovery sequence

1. Preserve fault-time actual joint and transformation state before clearing it where possible.
2. Re-establish encoder/reference trust for every joint.
3. Revalidate fixture, workpiece, tool, workholding, and datum.
4. Restore or deliberately reconstruct frames, tool data, TCP/DWO/TWP, compensation, and controller modes.
5. Compute a model-estimated TCP pose from measured joints, tool data, and the qualified kinematic/calibration model.
6. Compare that estimate with the saved checkpoint under an uncertainty-aware rule and obtain independent physical measurement when the risk/tolerance requires it.
7. Seed IK with the saved branch and turn state.
8. Re-evaluate joint limits, singularity, collision, speed, acceleration, and jerk over the recovery path.
9. Move to a machine-specific clearance configuration without assuming machine Z is tool-axis retract.
10. Re-enable transformations only at a controller-approved pose and sequence.
11. Use a planned lead-in before the interrupted cut.
12. Apply the correct motion-before-cutting-energy rule for tool/material state.
13. Observe reduced-feed recovery motion and expected joint/TCP behavior.
14. Resume production only after the state proofs pass.

### 14.4 Automatic resume refusal

Refuse when:

- any joint is unreferenced;
- branch/turn state is unknown;
- tool, work, or kinematic revision changed;
- TCP/DWO/TWP survival cannot be established;
- compensation or thermal validity changed;
- workpiece/workholding/datum evidence is invalid;
- pose residual plus uncertainty exceeds tolerance;
- the recovery crosses a singularity, joint limit, or unverified collision region;
- no safe re-entry path exists.

### 14.5 Reset, block search, and run-from-line are different operations

Controller behavior is not portable:

- LinuxCNC documents that M2/M30 reset work coordinate system, plane, distance mode, G94, overrides, cutter compensation, spindle, motion mode, and coolant; its older official user manual warns that run-from-line does not process prior lines and may cause errors or crashes.
- Siemens can configure which transformation is active after Reset and whether it is retained after Reset/program end. Block search can reconstruct controller state while still arriving on a different IK solution.
- HEIDENHAIN has explicit TCPM reset behavior, with machine/manual-version constraints around machine-coordinate moves, tool changes, and coupled rotary mechanisms.
- Haas G234 survives M00/M01 but is canceled by Reset, E-stop, Handle Jog, List Program, M2/M30, G43/G44/G49; G28/G29/G53/M06 ignore it. Haas Program Restart scans earlier blocks to reconstruct selected state, but that does not prove the physical setup.

See the [LinuxCNC M-code reference](https://linuxcnc.org/docs/stable/html/gcode/m-code.html), [SINUMERIK transformations manual](https://support.industry.siemens.com/cs/attachments/109801200/840Dsl_transformations_fct_man_0721_en-US.pdf), [Haas G234](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dmill.value%3DG234.html), and [Haas Setting 36 Program Restart](https://www.haascnc.com/service/codes-settings.type%3Dsetting.machine%3Dmill.value%3DS36.html).

The architecture must distinguish:

- same-session feed hold/resume, where queue and interpolation state may remain intact;
- abort/reset/power-loss recovery, where interpreter and physical state must be reconciled;
- block search/program restart, where scanning can reconstruct modal state but cannot prove homing, joint turns, tool contact, workholding, calibration, or operator changes.

### 14.6 Embedded tool on multi-axis

The original interrupted-router problem becomes more complex:

- spindle start at standstill may jam an embedded tool;
- machine-Z retract may not follow the tool axis;
- tool-axis retract can require coordinated XYZABC motion;
- TCP may have been canceled by the interruption;
- a rotary move can drag the stopped cutter through material;
- rehoming a rotary can sweep the stock/fixture into the tool.

There is no universal preamble. Recovery needs a classified physical state and machine/controller-specific procedure.

## 15. Current KerfDesk source audit

Snapshot audited: C:\Users\Asus\LaserForge\audit-current-main at e752a9125f02f832144c3b40800840ee5973fcf2.

### 15.1 The native CNC model is fixed-orientation XYZ

src/core/job/job.ts defines:

- contour: XY plus constant Z;
- path3d: per-vertex XYZ;
- arc: XY plus constant Z.

CncPass has no:

- tool-axis vector;
- orientation matrix/quaternion;
- A/B/C/U/V/W;
- joint coordinates;
- controlled-point identity;
- branch/turn state;
- block time/inverse feed;
- orientation tolerance;
- transform context.

The comment calls XYZ “machine coordinates,” while Z is also defined relative to stock top. That mixes machine/work/stock terminology which becomes untenable beyond fixed-orientation 3-axis output.

### 15.2 The machine definition is not a kinematic machine

src/core/scene/machine.ts:123-152 defines:

- safe Z;
- spindle maximum/spin-up;
- park XY;
- stock;
- tools;
- active tool;
- optional tiling.

src/core/devices/device-profile.ts adds:

- 2D bed width/height;
- optional informational Z travel;
- one collapsed max feed/acceleration;
- origin/homing;
- controller kind/capabilities.

It has no:

- joint list or axis mapping;
- linear/rotary type;
- axis vectors/pivots;
- head/table topology;
- per-joint limits/rates/acceleration/jerk;
- cyclic/multi-turn policy;
- TCP/DWO/TWP options;
- kinematic or compensation revision;
- tool/holder transform;
- rotary calibration.

src/core/cnc/cnc-machine-catalog.ts stores approximate 2D work area and spindle ceiling only.

### 15.3 Machine bounds are only XY

src/core/devices/machine-bounds.ts defines width, height, and min/max X/Y.

src/core/job/job-bounds.ts projects CNC passes to XY.

CNC preflight therefore cannot prove:

- Z machine travel;
- rotary/joint limits;
- joint-space feasibility;
- head/table swept volumes;
- singularity margin;
- unwind path;
- transformed work envelope;
- position-dependent TCP reach.

### 15.4 RotarySetup is a laser substitution, not CNC rotary

src/core/devices/rotary.ts maps design-space Y surface distance to emitted machine Y for a laser roller/chuck attachment.

src/core/job/rotary-job.ts explicitly returns false for CNC projects.

This implementation is useful for laser rotary engraving but provides no evidence of:

- A/B/C axis output;
- indexed rotary clamping;
- simultaneous rotary interpolation;
- cutter-location orientation;
- pivot compensation;
- joint-space collision.

The UI/documentation must not let the shared word “rotary” imply CNC rotary capability.

### 15.5 External G-code preview silently ignores transformations

src/io/gcode/parse-gcode-program.ts:42-50 stores only:

- motion G0-G3;
- unit scale;
- absolute/relative;
- X/Y/Z;
- ended.

Lines 140-146 recognize a target only when X/Y/Z/I/J/R appears.

Lines 152-190 implement only:

- G0-G3;
- G20/G21;
- G90/G91;
- G17;
- M2/M30;
- spindle/coolant no-ops.

Lines 192-208 count every other G/M mode as unsupported but continue. Therefore these can be ignored while the preview remains “ok”:

- G53;
- G54-G59;
- G10/G52/G92;
- G43/G43.1/G49;
- G68/G69 and tilted frames;
- G93/G94/G95;
- cutter compensation;
- cycles/subprograms/macros;
- controller TCP/DWO/TWP modes;
- controller-specific transformations.

A/B/C words are parsed into the word map but never included in target detection or resolution. A rotary-only move disappears. A mixed XYZABC move becomes XYZ-only.

This is not conservative simulation.

### 15.6 The success toast overstates the preview

src/ui/app/gcode-open-action.ts:

1. opens the parsed toolpath;
2. builds a parenthetical list of unsupported notes;
3. emits a success toast beginning “Simulating ...”.

The preview is accepted before the unsupported semantic modes are classified by risk.

At minimum, geometry-changing unsupported constructs must be fatal:

- frames/offsets/rotation/scaling;
- tool compensation;
- non-XYZ axes;
- TCP/DWO/TWP;
- macros/subprograms/cycles with motion;
- unmodeled planes;
- feed modes when time/kinematics are claimed.

Benign unsupported metadata can remain notes only when it cannot affect geometry or execution.

### 15.7 Existing tests encode permissive fallback

src/io/gcode/parse-gcode-program.test.ts:107-118 explicitly expects unsupported G4 and M6 to be counted rather than rejected.

There are no focused parser tests for:

- G54/G92 changing coordinate mapping;
- G43 changing controlled point;
- G68 rotating a path;
- G93 changing time semantics;
- A/B/C rotary motion;
- TCP modes;
- multi-turn axes.

### 15.8 GRBL-family status loses additional axes

src/core/controllers/grbl/status-parser.ts:55-83 stores MPos/WPos/WCO as exactly x/y/z.

pickAxisField at lines 166-189 destructures only the first three comma-separated components. Extra axis positions are not represented.

Pins store only X/Y/Z limits plus probe and door.

src/core/controllers/grblhal/driver.ts and src/core/controllers/fluidnc/driver.ts spread the GRBL driver and parser behavior. grblHAL can be compiled for additional axes and documents sender reconfiguration for up to six axes; recent core supports configurable axis mappings. See [grblHAL core](https://github.com/grblHAL/core) and [grblHAL changelog](https://github.com/grblHAL/core/blob/master/changelog.md).

KerfDesk has no negotiated:

- axis count/order;
- linear versus rotary unit;
- homed state per extra joint;
- extra-axis position;
- extra limit input;
- kinematics/configuration identity.

### 15.9 Settings detection is XYZ/XY-collapsed

src/core/controllers/grbl/parse-settings.ts:

- reads X/Y max rate and collapses them;
- reads X/Y acceleration and collapses them;
- reads X/Y/Z travel/rate metadata;
- ignores additional-axis configuration and rotary designation.

src/ui/machine/cnc-detected-apply.ts applies only spindle max and bed X/Y.

For a grblHAL/FluidNC machine, a banner family is not evidence of axis topology or kinematics.

### 15.10 Native emitter is explicitly three-axis GRBL

src/core/output/cnc-grbl-strategy.ts emits:

~~~text
G21
G90
G94
XYZ G0/G1/G2/G3
~~~

It performs a good three-axis fresh-start action at lines 84-88: lift to safe height before spindle start.

It has no post/machine topology, tool orientation, rotary output, TCP activation, branch, or joint-space verification. That is acceptable if the product capability remains “fixed-orientation 3-axis GRBL router” and external imports outside that subset are refused.

### 15.11 Checkpoint and resume cannot reconstruct kinematics

src/core/recovery/job-checkpoint.ts stores program fingerprint, acknowledged-line frontier, machine kind, 2D output placement/origin, and timestamps.

src/core/controllers/grbl/resume-program.ts stores modal:

- units;
- spindle;
- G0/G1;
- S/F;
- X/Y/Z;
- inferred plunge feed.

It rejects G91 and G53/G28/G30, but does not reject or reconstruct:

- WCS/G92/local/rotated/scaled frames;
- tool length/cutter compensation;
- G93/G95;
- A/B/C;
- TCP/DWO/TWP;
- branch/turn state;
- kinematic/calibration state.

For native current output these constructs are absent. For any future imported, post-generated, or multi-axis output, line replay must remain disabled until the semantic and physical checkpoint exists.

## 16. Proposed architecture

### 16.1 Core model

~~~text
MachineKinematicModel
  id and revision
  controller/model/post binding
  base frame
  transform graph
  joints
  tool branch
  workpiece branch
  supported task/orientation model
  TCP/DWO/TWP capabilities
  calibration and compensation model
  thermal/validity domain

Joint
  id and display axis
  type: linear | rotary
  physical actuator mapping
  axis direction and pivot/origin
  sign and zero convention
  unit
  hard/soft limits
  cyclic and multi-turn behavior
  velocity/acceleration/jerk limits
  homing/reference behavior
  encoder/feedback evidence

FrameNode
  id and semantic role

TransformEdge
  from and to
  nominal transform
  commanded transform source
  calibrated error transform
  thermal/position compensation
  covariance/uncertainty
  revision and validity

ToolAssembly
  holder and cutter geometry
  gauge transform
  TCP/contact model
  length/radius offsets
  revision and uncertainty

CutterLocation
  position in named work frame
  tool-axis or full orientation
  controlled point
  position/orientation tolerance
  feed intent and mode
  operation identity

IKSolution
  joint vector
  branch ID
  rotary turn counts
  pose residual
  joint-limit margin
  singular values/condition
  collision margin

KinematicPathProof
  cutter-location interval
  chosen branch/turn path
  max joint velocity/acceleration/jerk
  minimum singularity/limit/collision margin
  predicted TCP error and uncertainty
  controller/post assumptions
  result and invalidation dependencies
~~~

### 16.2 Parser evidence levels

~~~text
Level 0: lexical listing only
Level 1: modal canonical interpretation for declared dialect
Level 2: cutter-location path in work/tool frames
Level 3: machine-specific post/controller joint trajectory
Level 4: swept machine/tool/fixture/stock verification
Level 5: calibrated physical prediction with uncertainty
~~~

The UI must never call Level 1 “machine simulation.”

### 16.3 Explicit current capability

KerfDesk's near-term declaration should be:

~~~text
Native CNC:
  fixed-orientation 3-axis XYZ
  GRBL-family subset
  G21/G90/G94
  G0/G1 and supported XY arcs
  no CNC rotary/TCP/multi-axis

External preview:
  same declared semantic subset only
  reject geometry-changing unsupported modes
~~~

This improves truth without pretending to implement five-axis machining.

## 17. Safety and correctness invariants

### P0: current false-assurance boundary

1. External NC preview must fail on unmodeled A/B/C/U/V/W motion.
2. It must fail on unmodeled WCS/local/rotated/scaled frame changes.
3. It must fail on unmodeled tool-length/cutter/TCP/DWO/TWP compensation.
4. It must fail on macros, cycles, or subprograms whose motion cannot be expanded.
5. A partial parser result must never receive a generic “simulation succeeded” status.
6. Preview capability and omissions must remain visible with the artifact.
7. CNC rotary must not be inferred from the laser RotarySetup.
8. Native multi-axis execution and resume remain disabled.

### P1: machine and semantic architecture

1. Every transform has named frames, direction, units, revision, and source.
2. Machine axes and physical joints are separate.
3. Tool-to-workpiece pose is computed from both branches.
4. Tool assembly and controlled point are explicit.
5. Controller capability includes exact TCP/DWO/TWP/feed/reset semantics.
6. Post and machine definitions are revision-bound.
7. Joint-space limits and swept volumes are verified after posting.
8. Branch and turn state are first-class.
9. Feed is verified after IK against joint dynamics.
10. Compensation and calibration are validity-bounded evidence.

### P2: simultaneous multi-axis

1. IK enumerates relevant branches.
2. Branch selection is path-level.
3. No implicit branch change during cutting.
4. Singularity metrics are scaled and physically grounded.
5. Damped/adjusted IK reports path residual.
6. Orientation interpolation is explicit and continuous.
7. Rewind/reconfigure has a verified retract and re-entry transaction.
8. Exact final NC is controller/machine simulated.
9. Restart preserves/revalidates joints, branch, turns, transforms, tool, calibration, and physical part state.

## 18. Adversarial verification matrix

### 18.1 Transform mathematics

- identity/inverse/composition properties;
- noncommuting rotation/translation order;
- active versus passive rotation;
- row versus column convention;
- left/right-handed axis definition;
- degree/radian and inch/mm conversion;
- quaternion normalization and q/-q equivalence;
- rotation orthogonality and determinant;
- asymmetric fixture catches frame reversal.

### 18.2 Parser and preview

- distinct nonzero G54/G55 offsets, or a G10 offset update, make identical XYZ produce different physical paths;
- G92 shifts coordinates without motion;
- G43 changes controlled point;
- G68 rotates path;
- G51 scaling changes envelope;
- G93 changes block timing;
- A-only/B-only/C-only motion;
- mixed XYZABC block;
- G234/G43.4/M128/TRAORI modes;
- subprogram/macro-generated rotary motion;
- unsupported mode cannot produce success styling;
- benign comment/metadata remains allowed.

### 18.3 FK/IK

- randomized FK -> IK -> FK round trips;
- enumerate all branches;
- equivalent plus/minus 360 and multi-turn solutions;
- head/head, table/table, and mixed topology;
- tool-axis-only task with arbitrary roll;
- unreachable pose;
- joint-limit boundary;
- pose-feasible but collision-infeasible solution;
- path-continuous versus pointwise-nearest discrimination.

### 18.4 Jacobian/singularity

- analytic versus central-difference Jacobian;
- exact pole singularity;
- near-pole rotary velocity amplification;
- scaled condition invariant under unit change;
- damped inverse bounded joint rate and measured residual;
- lookahead decelerates before singularity;
- path modification stays inside orientation/position tolerance;
- block density remains within controller throughput.

### 18.5 Feed and dynamics

- pure linear G94;
- pure rotary G94;
- mixed linear/rotary without TCP;
- G93 every motion block has F;
- zero/tiny path-length inverse-time edge;
- long tool/pivot lever arm;
- one rotary joint becomes limiting;
- acceleration and jerk through branch curvature;
- feed override does not violate rotary acceleration;
- controller smoothing changes path inside/outside tolerance.

### 18.6 Rotary limits and rewinds

- cyclic unlimited axis;
- limited axis near both ends;
- cable-limited multi-turn axis;
- preferred direction conflicts with future reach;
- safe retract unavailable at current pose;
- unwind collides with fixture;
- work envelope overtravels on TCP activation;
- rapid rotary under Haas G234 is rejected;
- branch reseed after unwind remains continuous.

### 18.7 Calibration and uncertainty

- recover injected pivot/axis-direction error from sphere samples;
- detect ill-conditioned pose set;
- report parameter covariance;
- held-out-pose verification;
- thermal drift during measurement;
- probe lobing and artifact-radius uncertainty;
- compensation interpolation edge;
- block extrapolation outside valid domain;
- crash/maintenance invalidates map;
- long-tool TCP sensitivity.

### 18.8 Status and capability

- grblHAL three, four, five, and six-axis MPos reports;
- axis order/configuration negotiation;
- rotary versus linear unit designation;
- extra-axis homed/limit state;
- controller config changes without firmware-family change;
- stale machine/post/calibration revision;
- parser refuses unknown axis cardinality.

### 18.9 Restart

- Reset cancels TCP while M00 preserves it;
- Handle Jog changes transformation state;
- same Cartesian pose resolves to different branch;
- turn count lost while normalized angle matches;
- tool length changed;
- WCS/local rotation changed;
- calibration/MRZP revision changed;
- thermal validity expired;
- rotary is unreferenced;
- embedded tool needs tool-axis rather than machine-Z recovery;
- safe recovery cannot be found;
- no cutting energy before the qualified re-entry motion.

## 19. Focused implementation order for KerfDesk

### Slice A: make current preview honest

1. Classify unsupported words by semantic impact.
2. Hard-fail external preview on frames, compensation, extra axes, TCP, and generated motion not modeled.
3. Rename evidence from simulator to fixed-orientation path preview where appropriate.
4. Persist/show coverage and omissions throughout the preview.
5. Add adversarial tests for G54/G92/G43/G68/G93/A/B/C.

### Slice B: explicit three-axis machine contract

1. Add axis/joint descriptors for XYZ.
2. Separate machine, work, stock, and tool frames.
3. Add Z machine travel/limits and per-axis rates.
4. Bind controller configuration identity.
5. Make status cardinality/config mismatches block CNC readiness.

### Slice C: indexed rotary only

1. Add one explicit CNC rotary joint.
2. Add pivot, limits, clamp, and indexed-state model.
3. Add tilted workplane/DWO/post contract.
4. Implement retract-index-clamp-verify-cut transaction.
5. Add joint/fixture collision and calibration evidence.

### Slice D: simultaneous multi-axis research prototype

1. Cutter-location IR with orientation/tolerance.
2. FK/IK and all-branch enumeration.
3. path-level branch optimization.
4. singularity and joint-dynamic feed proof.
5. machine-specific post and controller TCP contract.
6. exact NC machine simulation.
7. no production execution until recovery/verification gates exist.

### Slice E: physical accuracy and recovery

1. calibration/compensation artifact model;
2. uncertainty/validity domains;
3. joint/branch/turn-aware checkpoint;
4. controller-specific transform reconstruction;
5. collision-free recovery waypoint and lead-in;
6. workholding/datum/tool/thermal requalification.

## 20. Source-quality and evidence boundary

Official controller manuals establish documented behavior for named controls/options. OEM machine builders can configure or override details; the exact installed machine/options/version remain authoritative.

CAM/post APIs show available representations and algorithms, not proof that every post uses them correctly.

Public repository findings are revision-specific and should be revalidated before implementation.

Standards abstracts define scope, not the full test procedure. Applying a standard requires the full document, suitable equipment, uncertainty analysis, and competent metrology.

Kinematic/calibration equations are models. Physical execution adds servo, structure, thermal, tool, workholding, cutting, and measurement effects.

The local findings are source-confirmed at the named snapshot and must be revalidated if the checkout advances.

## 21. Primary and high-signal references

### Controller kinematics

- [LinuxCNC five-axis kinematics](https://linuxcnc.org/docs/stable/html/motion/5-axis-kinematics.html)
- [LinuxCNC general kinematics](https://www.linuxcnc.org/docs/html/motion/kinematics.html)
- [LinuxCNC feed modes](https://linuxcnc.org/docs/html/gcode/g-code.html#gcode:g93-g94-g95)
- [LinuxCNC machining-center coordinate conventions](https://linuxcnc.org/docs/html/gcode/machining-center.html)
- [LinuxCNC M-code/reset behavior](https://linuxcnc.org/docs/stable/html/gcode/m-code.html)
- [Haas G234 TCPC](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dmill.value%3DG234.html)
- [Haas G254 DWO](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dmill.value%3DG254.html)
- [Haas G93 inverse time](https://www.haascnc.com/service/codes-settings.type%3Dgcode.machine%3Dmill.value%3DG93.html)
- [Haas Setting 36 Program Restart](https://www.haascnc.com/service/codes-settings.type%3Dsetting.machine%3Dmill.value%3DS36.html)
- [Haas MRZP and safe zones](https://www.haascnc.com/service/online-manuals/umc-series/umc---mrzp.html)
- [SINUMERIK mold-making 3-to-5-axis manual](https://support.industry.siemens.com/cs/attachments/109762409/SIN_WF5_0918_en-US.pdf)
- [SINUMERIK transformations function manual](https://support.industry.siemens.com/cs/attachments/109801200/840Dsl_transformations_fct_man_0721_en-US.pdf)
- [FANUC five-axis machining](https://www.fanucamerica.com/cnc-applications/5-axis)
- [FANUC five-axis workflow](https://www.fanucamerica.com/docs/default-source/cnc-files/mwa-030-en_01_1511_5-axis.pdf)
- [HEIDENHAIN TNC 640 Programming Manual](https://content.heidenhain.de/doku/tnc_guide/pdf_files/TNC640/34059x-18/bhb/892903-2C.pdf)
- [HEIDENHAIN TNC error messages](https://content.heidenhain.de/doku/tnc_guide/pdf_files/Fehlermeldungen_TNC/pdf_mls19/Errors_en_SW19.pdf)

### CAM and posts

- [Autodesk MachineConfiguration](https://cam.autodesk.com/posts/reference/classMachineConfiguration.html)
- [Autodesk PostProcessor](https://cam.autodesk.com/posts/reference/classPostProcessor.html)
- [Autodesk post entry functions](https://cam.autodesk.com/posts/reference/entry_functions.html)
- [Fusion machines for manufacturing](https://help.autodesk.com/view/fusion360/ENU/?contextId=MFG-MACHINES)
- [Fusion multi-axis overview](https://help.autodesk.com/view/fusion360/ENU/?guid=MFG-MULTI-AXIS-MILLING-OVERVIEW)
- [Fusion machine kinematics](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/MFG-MACHINE-KINEMATICS.htm)
- [NX controller-aware simulation](https://blogs.sw.siemens.com/nx-manufacturing/how-nx-cam-simulation-capabilities-validate-machines-and-processes/)
- [Mastercam multiaxis blueprint](https://www.mastercam.com/wp-content/uploads/2023/03/Multiaxis-Blueprint-2023.pdf)
- [FreeCAD machine model at audited commit](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/Machine/models/machine.py)
- [FreeCAD orientation solver at audited commit](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/Path/Base/Generator/rotation.py)
- [FreeCAD rotary wrap at audited commit](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/Path/Base/Generator/rotary_wrap.py)
- [FreeCAD post core at audited commit](https://github.com/FreeCAD/FreeCAD/blob/85c1848ad61439255b0f2ddb8fbf86342de4eaac/src/Mod/CAM/Path/Post/Processor.py)

### Metrology and mathematics

- [NIST machine-tool calibration review](https://www.nist.gov/publications/machine-tool-calibration-measurement-modeling-and-compensation-machine-tool-errors)
- [NISTIR 5236](https://nvlpubs.nist.gov/nistpubs/Legacy/IR/nistir5236.pdf)
- [Modern Robotics](https://modernrobotics.northwestern.edu/chapters/introduction/)
- [BLUM KinematicsPerfect](https://www.blum-novotest.com/us/products/measuring-components/measurement-software/kinematicsperfect/)
- [Renishaw XR20 rotary calibration](https://www.renishaw.com/en/xr20-rotary-axis-calibrator--15763)
- [NIST Technical Note 1297](https://www.nist.gov/pml/nist-technical-note-1297)
- [JCGM GUM](https://www.bipm.org/documents/20126/2071204/JCGM_100_2008_E.pdf/cb0ef43f-baa5-11cf-3f85-4dcd86f77bd6?download=true)

### Standards abstracts

- [ISO 230-1](https://www.iso.org/cms/%20render/live/en/sites/isoorg/contents/data/standard/04/64/46449.html)
- [ISO 230-2](https://www.iso.org/cms/%20render/live/en/sites/isoorg/contents/data/standard/05/52/55295.html)
- [ISO 230-3](https://www.iso.org/standard/73291.html)
- [ISO 230-4](https://www.iso.org/standard/79155.html)
- [ISO 230-6](https://www.iso.org/standard/30762.html)
- [ISO 230-7](https://www.iso.org/standard/56624.html)
- [ISO/TR 230-9](https://www.iso.org/cms/%20render/live/en/sites/isoorg/contents/data/standard/03/91/39165.html)
- [ISO 230-10](https://www.iso.org/standard/78909.html)
- [ISO 10791-6](https://www.iso.org/cms/%20render/live/en/sites/isoorg/contents/data/standard/04/64/46440.html)
- [ISO 10791-7](https://www.iso.org/cms/live/live/es/sites/isoorg/contents/data/standard/07/38/73814.html)

## 22. Verification performed

This dossier was checked through five independent evidence lanes:

1. official controller and CAM documentation for LinuxCNC, Haas, SINUMERIK, FANUC, HEIDENHAIN, Fusion, NX, and Mastercam;
2. a commit-pinned public-source audit of FreeCAD at `85c1848ad61439255b0f2ddb8fbf86342de4eaac`;
3. kinematic, Jacobian, calibration, uncertainty, NIST, and ISO scope review;
4. direct source inspection of the KerfDesk snapshot at `e752a9125f02f832144c3b40800840ee5973fcf2`.
5. a separate technical-consistency review of the mathematics, metrology language, controller claims, and test design, with its corrections applied.

Local verification:

- 14 focused Vitest files passed, 142 tests total;
- parser, CNC emitter, GRBL status/settings, resume, checkpoint, bounds, rotary, arc, and CNC preflight suites were included;
- the exact dossier passes Prettier check;
- all named local source paths were rechecked for existence;
- unfinished drafting-marker scan was clean;
- `git diff --check` passed;
- no tracked production files were changed.

The tests verify current behavior; they do not make the unsupported multi-axis semantics safe. In particular, permissive external-parser tests confirm the evidence gap described in section 15 rather than closing it.

## 23. Final engineering rule

Do not ask only:

> Does the preview show the intended XYZ path?

Ask:

> Under the exact machine topology, frame stack, tool geometry, controller transformation, IK branch, rotary turn state, calibration revision, thermal domain, and joint constraints, does the final posted program produce a continuous, collision-free, dynamically feasible, and sufficiently accurate tool-to-workpiece path—and can that complete state be re-established after interruption?

If the software cannot answer, it must refuse the unsupported claim. A convincing XYZ animation must never be used as evidence of multi-axis machine motion.
