# 3 — Coordinates, origin, and handedness

The one transform every machine move passes through, and the sign trap it creates.

## Two frames

| Frame | Convention | Where it lives |
|---|---|---|
| **Scene** | `+X` right, `+Y` **down** — SVG / Canvas2D convention | everything above compile |
| **Machine** | Numeric axes start at the configured origin; their physical signs therefore depend on that origin | everything from compile down |

The bridge is a single pure function, `toMachineCoords(p, device)` at
`src/core/devices/origin-transform.ts:21`, with an exact inverse `toSceneCoords` at line 28.
Non-negotiable #2 — *origin honesty* — is this function (`PROJECT.md:304`).

## The five origins

Read from `originTransform` (`origin-transform.ts:49-71`). `bedW`/`bedH` are configured bed
dimensions in mm:

| `origin` | Transform | Effect |
|---|---|---|
| `front-left` | `{ x, bedH − y }` | Y flipped. X unchanged. |
| `front-right` | `{ bedW − x, bedH − y }` | Y flipped **and** X mirrored. |
| `rear-left` | `{ x, y }` | Identity — machine `+Y` already points toward the operator. |
| `rear-right` | `{ bedW − x, y }` | X mirrored only. |
| `center` | `{ x − bedW/2, bedH/2 − y }` | Y flipped about the midline; output spans ±half-bed. |

Design consequence, stated in the module header (`origin-transform.ts:15-16`): **what the user
sees at the top of the canvas lands at the back of the bed for `front-*` origins, and at the
front for `rear-*`.**

`center` is the only origin whose transform is **not its own inverse** — its X axis is
translated, not mirrored — which is why `toSceneCoords` exists as a real inverse rather than a
re-application (`origin-transform.ts:25-27`).

## Where the transform is applied

Verified call sites (grep, excluding tests):

| Caller | Purpose |
|---|---|
| `src/core/job/compile-job.ts:398, 426` | Laser fill contours and line segments |
| `src/core/cnc/collect-cnc-contours.ts:74, 100` | **CNC contours** |
| `src/core/cnc/compile-cnc-relief.ts:136, 174` | CNC relief geometry |
| `src/core/job/frame-bounds.ts:102` | Frame rectangle |
| `src/core/job/raster-bounds.ts:25` | Raster placement |
| `src/ui/workspace/position-laser-click.ts:33` | Click-to-position jog target |

**Both machine kinds go through the same transform.** CNC is not a separate coordinate system —
`collect-cnc-contours.ts:74` applies `toMachineCoords` exactly as the laser path does. That is
the correct design, and it creates the trap below.

## CNC cut direction across machine-frame handedness

`compileCncJob` materializes contours in machine coordinates before cut-direction enforcement.
A shoelace sign in those numbers has the opposite physical meaning when exactly one physical axis
is mirrored, so `machineFrameHandedness` derives the determinant from the same
`jogAxisSignsForOrigin` mapping used by the operator's jog controls:

| Origin | Physical-right → machine X | Physical-away → machine Y | Handedness |
|---|---:|---:|---:|
| `front-left` | +1 | +1 | +1 |
| `front-right` | -1 | +1 | **-1 (mirrored)** |
| `rear-left` | +1 | -1 | **-1 (mirrored)** |
| `rear-right` | -1 | -1 | +1 |
| `center` | +1 | +1 | +1 |

With an M3 spindle viewed from above, climb cutting keeps the material on the **right** of travel.
Therefore an outside-profile climb cut is physically clockwise, while an inside-profile or pocket
climb cut is physically counter-clockwise. Conventional is the inverse. `enforceCutDirection`
converts that physical target into the numeric winding required by the configured origin; holes
retain the opposite winding from their containing outer contour.

**Software status: verified.** `cut-direction-frame-handedness.test.ts` pins the determinant and
the physical winding for all five origins. Adaptive-pocket finish rings and helix entries, general
helical entries, and separate rest-roughing groups now use the same direction contract. This is
source and deterministic test evidence, not a hardware quality claim: chip evacuation, cutter
loading, edge finish, and dimensional results still require a real coupon/air-cut qualification.

ADR-251 makes climb the default, so ordinary profile and pocket output is direction-oriented rather
than byte-identical to the pre-H.9 compiler. `dominantWindingSign` identifies the outer boundary by
largest absolute area because winding survives concentric roughing and finishing offsets where a
simple containment-depth interpretation does not.

## Z — asymmetric by design

There is no shared Z model. Laser mode has **no Z control beyond initial homing**
(`PROJECT.md:524`); CNC is inherently Z-aware. CNC semantics: **Z0 = stock top**, set by the
operator zeroing the bit on the stock before running (`cnc-grbl-strategy.ts:11-12`). Cutting
depths are therefore negative. See [05](05-cnc-chain.md).

## Work-coordinate offsets

The pipeline emits absolute `G90` machine coordinates and lets the controller apply the work
offset at run time — so setting a work origin costs **zero pipeline change** (ADR-021,
`DECISIONS.md:980`; `PROJECT.md:121`). Implementation is `G92 X0 Y0` / `G92.1`; persistent
`G10 L20 P1` was deferred. Both emitters pin `G54` in the preamble so a stale `G55`–`G59`
selection cannot displace the job.

## Bounds

`findOutOfBoundsCoords` (`src/core/invariants/predicates.ts:88`) scans every emitted motion word
against `[0,width] × [0,height]`, tracking modal position so a `G2`/`G3` arc knows its start
point. Arcs get extra treatment: `appendArcBoundsIssue` (line 141) computes true arc extent from
I/J and direction, because **an arc can bow outside the bed while both endpoints sit inside it** —
endpoint-only checking is blind to that. Reachable for CNC output only; the laser strategy emits
no arcs.

Per non-negotiable #21 and ADR-232, calculated bed overhang **may warn but must never refuse**
Frame or Start — the physical Frame is the spatial source of truth. See
[07](07-frame-permit-model.md).

## Cross-reference slot — Phase 2

1. **Origin enumeration.** LightBurn exposes a device origin corner too. Does it offer `center`?
   Does it define `+Y` identically, and does it warn when origin and homing corner disagree?
2. **Cut direction UI.** Do Easel/Carbide expose climb vs conventional? If so, do they express it
   as physical clockwise/counter-clockwise or as machine-number direction?
3. **The coupon question.** Does any competitor doc state which physical direction climb
   corresponds to for an outside profile, in words we can check our sign against?
4. **Hole detection.** How does Easel decide which contour is a hole — winding, containment, or
   explicit user tagging? Ours is largest-area winding (`motion-polish.ts:65`).
5. **Z zero convention.** Do Easel/Carbide default to stock-top or stock-bottom Z zero? Ours is
   stock top, hard-coded. A bottom-referenced competitor default is a real usability gap.
6. **Work offsets.** Does LightBurn use `G92` or `G10 L20`? We deferred the persistent form — if
   they use it, find out what breaks for users after a controller power cycle.
