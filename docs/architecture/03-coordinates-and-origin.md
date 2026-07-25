# 3 — Coordinates, origin, and handedness

The one transform every machine move passes through, and the sign trap it creates.

## Two frames

| Frame | Convention | Where it lives |
|---|---|---|
| **Scene** | `+X` right, `+Y` **down** — SVG / Canvas2D convention | everything above compile |
| **Machine** | `+X` to the operator's right, `+Y` **away from the operator** — GRBL convention | everything from compile down |

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

## The handedness trap — CNC cut direction

The highest-value finding in this set for anyone comparing us to Easel.

**Setup.** `compileCncJob` materializes contours in *machine* coordinates
(`compile-cnc-job.ts:68` → `collectLayerContours(sourceObjects, layer, device)`). Cut-direction
enforcement then runs on those already-transformed polylines, deciding climb vs conventional from
the **shoelace signed area** (`src/core/cnc/motion-polish.ts:39-60`, via `signedAreaMm2`).

**Reasoning it encodes** (`motion-polish.ts:7-15`): with an M3 top-view-clockwise spindle, climb
cutting keeps material on the **left** of travel — so outside-profile climb = CCW,
inside/pocket climb = CW. `wantsCounterClockwise` (`motion-polish.ts:79-83`) implements exactly
that, and ADR-252 (`DECISIONS.md:7755`) mirrors it for holes because a hole's material lies
*outside* its boundary.

**The trap.** Mirroring exactly one axis **flips the sign of the shoelace area**. Counting axis
flips each origin applies relative to the scene frame:

| Origin | X mirrored | Y flipped | Net flips | Shoelace sign vs scene |
|---|---|---|---|---|
| `front-left` | no | yes | 1 (odd) | **inverted** |
| `front-right` | yes | yes | 2 (even) | preserved |
| `rear-left` | no | no | 0 (even) | preserved |
| `rear-right` | yes | no | 1 (odd) | **inverted** |
| `center` | translate | yes | 1 (odd) | **inverted** |

So "CCW in machine coordinates" is **not** the same physical direction as "CCW as the operator
sees it on canvas", and which way it lands depends on the configured origin. Because
`enforceCutDirection` reasons in machine space about a physical spindle rotation, the mapping
from `climb` to an actual chip-load direction is origin-dependent.

**Status: UNRESOLVED AND UNVERIFIED.** This matches the concern held in project memory as *"CNC
frame left-handed on 2 origins"* and the P1 of the 2026-07-25 CNC full-chain audit (*"possible
climb inversion, `motion-polish.ts:78-82`, cut a coupon first"*). Nothing in this session
verified it either way on hardware. The table above is derived from the code and sign algebra,
**not** from a cut test.

Compounding factors:

- ADR-251 (`DECISIONS.md:11702`) made **climb the default** for profile cuts, so this path is on
  by default; output is no longer byte-identical to pre-H.9 jobs (`motion-polish.ts:3-5`).
- ADR-250's lead placement *reads winding opposition* to find holes (`motion-polish.ts:46-49`),
  so a sign error propagates into lead geometry, aiming leads into the kept part.
- `dominantWindingSign` (`motion-polish.ts:65-77`) infers the outer boundary from the
  largest-area contour — winding-based, not containment-based, chosen because winding survives
  concentric roughing/finishing offsets where containment depth does not.

**The verification that would settle it** (CANNOT be performed - no machine to test on): cut a two-feature coupon — one outer profile, one
interior hole — on a `front-left` machine and confirm chip ejection and edge finish match climb
on both. Repeat with origin set to `rear-left`. If the coupon differs between origins, the
inversion is real.

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
   in *scene* terms ("clockwise on screen") or *machine* terms? Scene-relative wording is strong
   evidence our machine-space reasoning sits at the wrong altitude.
3. **The coupon question.** Does any competitor doc state which physical direction climb
   corresponds to for an outside profile, in words we can check our sign against?
4. **Hole detection.** How does Easel decide which contour is a hole — winding, containment, or
   explicit user tagging? Ours is largest-area winding (`motion-polish.ts:65`).
5. **Z zero convention.** Do Easel/Carbide default to stock-top or stock-bottom Z zero? Ours is
   stock top, hard-coded. A bottom-referenced competitor default is a real usability gap.
6. **Work offsets.** Does LightBurn use `G92` or `G10 L20`? We deferred the persistent form — if
   they use it, find out what breaks for users after a controller power cycle.
