# ExecutablePlan mathematical contract

**Governing decision:** ADR-271.

**Machine-readable schema:**
[`../schemas/executable-plan-v1.schema.json`](../schemas/executable-plan-v1.schema.json).

**Status:** v1 sidecar is implemented; the dynamics, routing, consumer migration, calibrated
models, and physical coupons below are staged requirements, not shipped claims.

## 1. Purpose and evidence boundary

`ExecutablePlan` is the proposed single ordered description of commanded motion and controller
events. The first version is a compatibility bridge over today's emitter. It proves that a typed
semantic sidecar can be generated from the exact current program and serialized back without one
character changing. It does **not** prove that a machine reaches the commanded coordinates.

The contract separates four kinds of evidence:

1. **Lexical:** exact G-code characters and UTF-8 bytes.
2. **Semantic:** units, modal state, ordered geometry, intent, events, bounds, and terminal state.
3. **Protocol:** controller streaming, acknowledgements, alarms, hold, and recovery epochs.
4. **Physical:** tracking under load, backlash, missed steps, spindle/power behavior, heat, and
   material result.

This document and automated tests can establish only the first three. Physical claims require the
controlled qualification in section 12.

### Current source-confirmed control boundary

The current tree does not expose a runtime cutting-resistance or axis-load measurement to the host
math pipeline. CNC feed, plunge feed, and spindle RPM are persisted layer settings and compile into
fixed group values (`src/core/scene/machine.ts`, `src/core/cnc/compile-cnc-job.ts`). The existing
"adaptive optimal load" is a deterministic 2D radial-engagement geometry limit
(`src/core/cnc/adaptive-pocket.ts` and `adaptive-pocket-verifier.ts`), not measured force, torque,
axis current, vibration, or chatter, and it does not vary feed at runtime.

GRBL status parsing receives reported coordinates, commanded/reported feed and spindle fields,
override percentages, pins, and accessory/fault state (`src/core/controllers/grbl/status-parser.ts`).
Those values feed display, freshness, readiness, and route reconciliation. Override bytes are sent
only by explicit operator actions (`src/ui/state/override-actions.ts`); the streamer transmits the
already emitted lines and does not rewrite feed from load (`src/core/controllers/grbl/streamer.ts`).

Likewise, `MPos`, `WPos`, and `WCO` are controller status coordinates, not identified axis-encoder
samples. The host does not compare them with the plan and emit corrective motion. The grblHAL
`A:E` value is a boolean spindle-encoder fault boundary, not continuous axis position or cutting-
load feedback. A particular machine/controller may implement internal closed-loop hardware, but
that is hardware/firmware capability outside what the current host source can prove. Therefore a
wood-only position shift cannot be attributed to one cause from CurveDesk source alone.

## 2. v1 construction

Let:

- `J` be the prepared current `Job`;
- `D` be the selected device/controller profile;
- `O` be the existing emit options;
- `E0(J,D,O) = G` be today's deterministic emitter and its exact G-code string;
- `B1(G,K,C) = P1` be the v1 sidecar builder for machine kind `K` and emitter `C`; and
- `S1(P1)` be the v1 plan serializer.

The compatibility invariant is:

```text
S1(B1(E0(J,D,O), K, C)) = E0(J,D,O)
```

and, for UTF-8 encoding `U`:

```text
U(S1(P1)) = U(G)
```

v1 satisfies this by retaining `G` as `compatibility.exactProgram`. That lexical carrier is an
explicit transitional cost. It prevents a migration from silently reformatting coordinates,
comments, whitespace, line endings, modal words, or controller dialect. A later native plan
serializer may remove the carrier only after every supported dialect has byte-pinned parity.

The opt-in composition in `src/io/gcode/executable-plan-emission.ts` always emits `G` first. A
sidecar error is returned as sidecar evidence; it does not rewrite `G`, change preflight, or create
a Start refusal.

## 3. Canonical state

Every v1 plan has:

- schema identity `curvedesk.executable-plan`, version `1`;
- a machine kind and selected emitter;
- canonical millimetres and absolute work coordinates;
- an explicit v1 initial-position assumption `(0,0,0)`;
- an ordered finite motion sequence `M = (m1, ..., mn)`;
- ordered non-motion controller events;
- all-motion and process-only bounds;
- distance totals by intent;
- terminal position, spindle mode, coolant state, and program-end observation; and
- the lossless legacy lexical carrier.

The zero initial position is a parsing basis, not a claim about the live head position. Consumer
migration must bind a runtime position/evidence epoch before recovery or live motion uses the plan.

## 4. Motion geometry

Each motion `mi` contains an ordered point sequence:

```text
Pi = (pi,0, pi,1, ..., pi,ki),  ki >= 1
```

where every coordinate is finite. Its polyline length is:

```text
Li = sum(j = 0 .. ki-1) ||pi,j+1 - pi,j||2
```

and cumulative route coordinates satisfy:

```text
routeStart1 = 0
routeEndi   = routeStarti + Li
routeStarti+1 = routeEndi
totalRoute = routeEndn, or 0 when n = 0
```

The parser's modal position makes adjacent commanded motions continuous:

```text
pi,ki = pi+1,0
```

unless a future schema introduces an explicit discontinuity event. No implicit teleport is valid.

Arc commands remain identified as clockwise or counter-clockwise, while v1 stores their sampled
path plus the lossless lexical command. A native arc primitive, including plane, centre/radius,
turn count, and helical Z law, is required before the compatibility carrier can be retired.

## 5. Intent and terminal parking

Motion intent is one of:

- `travel`: material-off repositioning;
- `process`: laser/spindle-energized material motion;
- `plunge`: decreasing-Z vertical motion;
- `retract`: increasing-Z vertical motion; or
- `park`: an explicit terminal or pause-boundary repositioning motion.

Intent and command mode are independent. In particular, a laser-off `G1 ... S0` is feed-mode
travel, not process motion. A full-circle arc has equal endpoints but non-zero route and must not be
misclassified as a vertical plunge. Terminal parking is represented as a real final node/motion,
never inferred later by a preview.

## 6. Bounds and totals

For point set `Q`, bounds are component-wise extrema:

```text
xmin = min(q.x), xmax = max(q.x)
ymin = min(q.y), ymax = max(q.y)
zmin = min(q.z), zmax = max(q.z)
```

`allMotionMm` uses every motion point. `processMm` uses only `process` motion points. Empty sets
produce `null`, not invented zero-sized boxes. Intent totals are disjoint sums, and:

```text
routeMm = travelMm + processMm + plungeMm + retractMm + parkMm
```

within normal floating-point accumulation error.

## 7. Semantic parity verifier

The v1 builder and verifier reuse three existing, differently purposed readers instead of adding a
fourth parser:

- controller/recovery-oriented `buildMotionManifest` supplies sendable-line identity and intent;
- Inspector `buildGcodeRenderModel` supplies modal command mode, feed/power, events, and an
  independently expanded endpoint stream; and
- clean-room simulator `parseGcodeProgram` supplies the adversarial endpoint sequence.

A plan is accepted only when:

1. the manifest and Inspector assign motion to the same raw lines;
2. their start/end coordinates agree after the Inspector's documented Float32 storage round trip;
3. the serializer returns the exact current program;
4. raw-line counts agree with the clean-room parser;
5. every ordered clean-room start/end pair agrees within `1e-6 mm`; and
6. a second pure build is structurally identical.

`1e-6 mm` is a software comparison tolerance only. It is not machine resolution, backlash
allowance, kerf tolerance, or evidence of physical accuracy. Current emitters format commanded
coordinates to three decimal places; the verifier compares readers of those already formatted
commands.

## 8. Versioned dynamics contract (staged, not implemented)

A later plan version must identify a versioned dynamics record for both controller and each axis:

```text
AxisDynamics = {
  vmax,                 positive speed limit
  amax,                 positive acceleration limit or unknown
  jmax,                 positive jerk limit or unknown
  commandResolution,    controller command quantum
  feedbackKind          open-loop | encoder-reported | closed-loop-controller
}
```

For path unit direction `u`, an axis-projected speed bound is:

```text
vpath,max = min over axes k with |uk| > 0 of (vk,max / |uk|)
```

and the analogous acceleration bound is:

```text
apath,max = min over known axes k with |uk| > 0 of (ak,max / |uk|)
```

Controller planner semantics—look-ahead, junction law, buffer depth, feed-override behavior, and
supported arc modes—must be versioned alongside the axis values. Two profiles with the same axis
numbers but different planners are not interchangeable.

For old profiles, unknown dynamics remain explicitly unknown. The conservative fallback is:

- retain today's emitted feed and existing fixed runway behavior;
- keep current profile maximum-feed caps;
- never raise feed or shorten a runway based on an invented acceleration/jerk value; and
- mark dynamics-dependent ETA/margin fields unavailable.

This fallback preserves compatibility; it does not certify that an old profile is physically safe.

## 9. Calculated runway and feed derating (staged, not implemented)

With a calibrated conservative acceleration `aeff > 0`, entry speed `v0`, requested process speed
`vr`, and available straight runway `d`, the constant-acceleration lower-bound calculation is:

```text
drequired = max(0, (vr^2 - v0^2) / (2 aeff))
vreachable = sqrt(max(0, v0^2 + 2 aeff d))
vcommand = min(vr, vpath,max, vreachable)
feedCommand = 60 vcommand
```

Deceleration to terminal speed uses the same energy equation in reverse. A controller with a known
jerk limit must use a conservative jerk-limited S-curve solver; the constant-acceleration equation
must not be presented as jerk-aware. Curves divide available distance by curvature/junction limits
before applying the bound.

Runway shortfall and derating are plan annotations and Job Review advisories. They do not become a
second ordinary Start gate. A plan may refuse only when execution is unsupported or internally
inconsistent—for example, a required command cannot be represented for the selected controller.

## 10. Precedence-aware routing (staged, not implemented)

Let tasks form a directed acyclic precedence graph `H = (V,E)`. A route is valid only when every
edge `(a,b)` places task `a` before task `b`. Each task may expose a finite set of legal orientations
with explicit entry and exit states. A terminal park is a mandatory final node.

For small `|V| <= Nexact`, the router must use an exact dynamic program or branch-and-bound search
over precedence-valid states and orientations. `Nexact` is versioned and justified by deterministic
corpus measurements, not wall-clock promises.

For larger jobs, the router must repeatedly choose only from the topologically ready set. Its cost
and tie-break tuple is deterministic:

```text
(unsupported violations, verified dynamics penalty, estimated time, travel distance, stable id)
```

Uncalibrated thermal or cutting-load guesses cannot contribute a reliability penalty. The large
router may use bounded look-ahead, but identical input/profile/version must always produce identical
ordering and terminal parking.

## 11. Thermal and CNC-load models (field-evidence gate)

No thermal or cutting-load number is valid merely because geometry, feed, spindle command, or
material labels exist. A model may enter the plan only after a versioned calibration dataset records
at least:

- machine/controller/profile identity and firmware/settings;
- material, thickness, tool/beam configuration, spindle/power state, and environmental controls;
- commanded motion plus independently observed outcome;
- repetitions, uncertainty, rejected runs, and calibration date; and
- the exact model version and validity domain.

Outside that domain the result is `unavailable`, not extrapolated confidence. Online adaptation is
permitted only when the controller exposes trustworthy measured load or position feedback and the
transport binds it to the correct plan/evidence epoch. Host-side inference must not be called
closed-loop correction.

## 12. Qualification ladder

| Stage | Evidence | May prove | Cannot prove |
|---|---|---|---|
| Schema/corpus | JSON shape, adversarial fixtures | versioning and representability | machine behavior |
| Differential simulation | three readers plus controller simulators | geometry, modal semantics, determinism | tracking under load |
| Protocol simulation | buffer, `ok`, alarm, hold/resume, reconnect faults | transport and recovery properties | mechanics/material result |
| De-energized air run | observed motion with tool/beam off | basic coordinate direction and gross path | load retention or cut quality |
| Instrumented coupons | encoder/indicator/logged settings and controlled material | calibration, tracking, backlash, load/thermal response | behavior outside tested domain |
| Repeated production coupon | blind repeats and acceptance measurements | repeatability for that bounded setup | universal reliability |

Physical coupons must include asymmetric repeated glyphs, long traverses followed by reversals,
corner/acceleration ladders, depth/load ladders for CNC, thermal-density ladders for laser, and an
explicit terminal-park witness. Air and material runs must use the same plan identity so divergence
can be attributed rather than guessed. Hardware motion requires separate operator authorization;
this ADR authorizes no machine operation.

## 13. Consumer migration order

After v1 parity is stable, one pull request at a time moves these consumers to the same plan:

1. preview and motion overlays;
2. calculated bounds;
3. ETA/timeline;
4. Frame geometry generation while preserving physical Frame as the sole ordinary Start permit;
5. recovery manifests and resume epochs; and
6. native plan-first dialect serialization.

Each migration must compare old and new behavior on the adversarial corpus and retain a rollback
path until parity is demonstrated. No consumer may silently construct a competing motion order.
