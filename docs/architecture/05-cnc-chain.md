# 5 — The CNC chain

`compileCncJob` → `cncGrblStrategy` → G-code.
Sources: `src/core/cnc/compile-cnc-job.ts` (424 lines), `src/core/output/cnc-grbl-strategy.ts`
(442 lines).

CNC is governed by **ADR-098** (`DECISIONS.md:4306`), which made router mode a first-class product
track with three scope conditions: all parsers clean-room, `clipper2-ts` the only geometry
dependency, hardware verification on the 4040 via the standing air-cut protocol. UI separation from
laser mode is **ADR-101** gate-and-hide (`DECISIONS.md:4400`).

## The motion contract

The CNC analogue of laser-off-on-travel, stated at `cnc-grbl-strategy.ts:4-9`:

1. **Every XY rapid happens with Z parked at the group's safe height** — the emitter retracts
   before any XY travel, by construction.
2. **Plunges are always `G1` at plunge feed** — never rapids.
3. **A rapid never targets Z below the safe height.**

Enforced twice: by construction in the emitter, then **proven on the final text** by
`findPlungedTravelIssues` (`src/core/invariants/cnc-motion.ts:20`), a modal-Z tracker that flags any
`G0` carrying X/Y while modal Z is below safe height — including the "before any Z was established"
case (`cnc-motion.ts:95-100`), which catches a first-move rapid with unknown Z.

A separate check, `findSpindleStartClearanceIssues` (`cnc-motion.ts:48`), flags `M3` occurring
before any Z clearance was established or below safe height. Its stated purpose
(`cnc-motion.ts:44-47`) is to catch **standalone/imported generators** that start the spindle while
the cutter still rests at the operator's Z0 touch-off point.

## Preamble and postamble

From `emitCncProgram` (`cnc-grbl-strategy.ts:106-130`):

```gcode
G21
G90
G54                      ; canonical WCS — never let a stale G55-G59 redirect a valid program
G94
; tool: <name> (load before starting)     ← multi-tool jobs only
G0 Z<safe>               ; LIFT FIRST
M3 S<rpm>                ; then spin up
G4 P<spinup>             ; dwell for the spindle to reach speed
M7 / M8                  ; coolant, only if configured
```

**The lift-before-spindle ordering is deliberate and load-bearing** (`cnc-grbl-strategy.ts:117-118`):
after Z touch-off the bit rests *on the stock top*; starting the spindle there burns the stock and
can grab. The comment records that Easel's post does the same — lift, then `M3`. A documented parity
point, not an independent invention.

Postamble (`appendPostamble`, `cnc-grbl-strategy.ts:151-163`): retract to the **highest** safe Z any
group used, `M5`, `M9` only if coolant was actually turned on, then park at safe Z.

## Z model

**Z0 = stock top**, set by the operator zeroing the bit before running
(`cnc-grbl-strategy.ts:11-12`). Cutting depths are negative. `S` maps to **spindle RPM**, with `$30`
expected to equal the machine's max RPM (`cnc-grbl-strategy.ts:13`) — the same `$30` the laser path
uses as max power scale, reinterpreted per machine kind.

Work-Z readiness is unusually heavily gated for this codebase, across four ADRs:

| ADR | Rule |
|---|---|
| ADR-171 (`DECISIONS.md:7559`) | Work-Z readiness uses source-qualified, epoch-bound evidence |
| ADR-172 (`:7593`) | **Missing qualified work Z blocks CNC Start** |
| ADR-173 (`:7624`) | Work-Z evidence is bound to the compiled tool plan |
| ADR-203 (`:8676`) | Work-Z recovers only from owned, fresh controller offset readback |

ADR-172 is one of the few remaining hard Start blocks. Under the frame-first rule (non-negotiable
#21) it survives as a *handoff-consistency* refusal rather than a policy guard — the reviewed
program cannot be the streamed program if its Z reference is unknown. Whether that classification is
honest is a live question; see [07](07-frame-permit-model.md).

## Pass kinds

`CncPass` is a four-arm discriminated union (`appendPass`, `cnc-grbl-strategy.ts:199-217`):

| Kind | Motion | Notes |
|---|---|---|
| `contour` | retract → rapid XY → `G1 Z` plunge → `G1` XY chain | The common case |
| `path3d` | per-vertex XYZ `G1` | Relief, surfacing, ramped entries |
| `arc` | native `G2`/`G3` with I/J | Falls back to sampled `G1` when radius is invalid |
| `helical-contour` | helical arc entry, then contour | ADR-152 |

Two details that matter for correctness:

- **`path3d` vertical segments ride the plunge feed, not the XY cutting feed**
  (`appendPath3dCutMoves`, `cnc-grbl-strategy.ts:414-417`): when a move's X and Y are unchanged, `F`
  switches to plunge and is re-issued as the cutting feed on the next lateral move. Without this a
  same-XY descent would plunge at cutting speed.
- **`arc` guards the degenerate full-circle case** (`cnc-grbl-strategy.ts:343-344`): a `G2`/`G3` whose
  formatted endpoint equals its start is emitted only when it is genuinely a full circle; otherwise
  it degrades to sampled `G1` so the controller cannot misinterpret a zero-sweep arc.

**Successive-depth optimization** (`cnc-grbl-strategy.ts:20-23`, `appendContourPass:295-301`): when
the next pass plunges at the *same* XY the head already occupies, the retract + rapid pair is
skipped and the bit feeds straight down. **ADR-253** (`DECISIONS.md:11820`) then added an opt-in
`retractBetweenPasses` that lifts clear before replunging instead — because stepping Z down in place
re-cuts through chips.

## Motion polish (Phase H.9)

`src/core/cnc/motion-polish.ts` (232 lines). Three transforms, each opt-in:

**Cut direction** — `enforceCutDirection` (line 39). Reverses closed toolpaths whose shoelace
orientation disagrees with the wanted direction; open paths are left alone. Also rotates each closed
path's start to the **midpoint of its longest segment** (`rotateStartToLongestSegment`, line 86) so
entry witness marks land on a flat span instead of a corner — described in code as the v1 lead-in
strategy.

> **This is the handedness risk.** ADR-251 made climb the **default**, so it runs on ordinary jobs.
> The sign of the shoelace area depends on the configured origin. Full analysis in
> [03-coordinates-and-origin.md](03-coordinates-and-origin.md). **UNVERIFIED on hardware.**

**Hole mirroring** — ADR-252 (`DECISIONS.md:7755`). A hole's material lies *outside* its boundary, so
its climb direction is the mirror of the outer boundary's. The code comment
(`motion-polish.ts:46-49`) records what the pre-ADR-252 bug did: forcing one winding on every contour
cut holes the wrong way round **and** destroyed the winding opposition ADR-250 reads to find holes,
which then aimed leads into the kept part. The outer boundary is identified by `dominantWindingSign`
(line 65) — largest absolute area — chosen because winding survives concentric roughing/finishing
offsets where containment depth does not.

**Ramp entry** — `applyRampEntry` (line 114). Converts a contour plunge into a descent *along* the
toolpath at a configured angle, clamped to 45° (`MAX_RAMP_ANGLE_DEG`, line 35). The pass becomes
`path3d`: ramp over the leading span, cut the loop at depth, then **re-cut the ramped span level** so
no slope is left (closed loops only, `appendLevelRampSpan`, line 204). Two bugs are recorded as fixed
in comments: the resume index must be the vertex where the ramp *actually* reached depth, not always
`source[1]` (lines 154-156), and a ramp longer than the path finishes vertically at the end point
(lines 187-189).

**Lead-in/out** — **ADR-250** (`DECISIONS.md:11585`) adds arc/line leads to closed profile cuts,
default-on for profile-outside/inside, no-op elsewhere. Applied at `compile-cnc-job.ts:119-124` via
`applyProfileLeadPasses`, bounded by `machineBoundsForDevice`.

## CNC features and their ADRs

| Feature | Module | ADR |
|---|---|---|
| Depth passes | `depth-passes.ts` | ADR-098 |
| V-carving ladder | `vcarve-ladder.ts`, `vcarve-region-order.ts`, `vcarve-clearance.ts` | ADR-098 H.3, ADR-270 |
| Relief (STL → heightmap) | `compile-cnc-relief.ts` | ADR-098 H.4/H.5/H.8 |
| Tabs (auto + manual) | `cnc-tabs.ts`, `cnc-tab-anchors.ts` | ADR-156 |
| Helical entry | `helical-entry.ts` | ADR-152 |
| Rest machining (2-tool) | `cnc-rest-operation.ts`, `rest-pocket.ts` | ADR-153 |
| Adaptive clearing | `adaptive-pocket*.ts` | ADR-154 |
| Inlay pairs | `inlay-pair*.ts` | ADR-155 |
| Finish allowance | `finish-allowance.ts` | ADR-140 |
| Tiling | `tile-plan.ts` | ADR-098 H.10 |
| Drill/peck | `drill-peck.ts` | ADR-098 H.7 |
| Feeds calculator | `feeds-calculator.ts` | ADR-103 |
| Line-art contour side | `line-art-contours.ts` | ADR-218 |

`capFeed` / `capSpindle` (`compile-cnc-helpers.ts`, imported at `compile-cnc-job.ts:29-30`) clamp
requested feeds and RPM to machine limits at compile time.

## Multi-tool and tool change

A job is multi-tool when its groups carry more than one distinct `toolId`
(`cnc-grbl-strategy.ts:102`). Multi-tool jobs get `M0` change blocks between bit sections; a
single-tool job emits **byte-identically to pre-H.7 output**.

The `M0` handling is the subtlest part of the transport layer, documented at `streamer.ts:39-46`: the
sender **does not send the `M0`**. It stops feeding and leaves the `M0` at the queue head, so GRBL
drains the preceding retract/`M5`/park and settles to **Idle** — the only state in which it will
accept the jog/probe/`G92` the operator needs to re-zero the new bit. A plain GRBL feed-hold (which
is `M0`'s own effect) would leave the controller in **Hold**, where re-zeroing is impossible.
`continueToolChange` (`streamer.ts:254`) drops the `M0` and resumes.

An *imported* `.nc` program's `M0` is an ordinary program pause and streams through unchanged — gated
by `toolChangePause`, set only for KerfDesk-emitted CNC jobs (`streamer.ts:75-78`).

## Recovery

**ADR-215** (`DECISIONS.md:9273`): CNC recovery rewinds to a **pass boundary** and re-enters as a new
sealed job. **ADR-136** (`:6862`) requires that rewind target be a retract-first safe boundary. The
mechanism is `emitCncJobWithPassSpans` (`cnc-grbl-strategy.ts:71`), which emits the ordinary program
while recording each pass's raw-line span. Its doc comment (lines 65-70) states the critical
constraint: byte-identity holds for the same job **and the same emit options** — a current-position
job's `finishPosition` changes its park lines, so resume mapping must re-emit with the run's own
options.

**ADR-143** (`:7079`) disabled executable checkpoint and start-from-line recovery. **ADR-180**
(`:7718`) made generic same-session Resume manual-recovery-only; per project memory that block was
intentional, was later enabled by the maintainer (#392), and amendment 2 (#397, merged as
`3baf5ea5`) made Pause park the spindle via the safety-door byte — **stopping the spindle in place
with no retract**, because `PARKING_ENABLE` is off in stock GRBL. **NOT hardware-verified.**

## What is NOT verified for the CNC chain

Per `PROJECT.md:138`, every Phase H sub-phase is **"Built = code + tests landed, hardware pass still
CLAIMED"**. Specifically unverified:

- **All of H.15–H.18** (rest machining, adaptive clearing, inlay pairs, drag tabs) — hardware CLAIMED.
- **Climb direction correctness** — the P1 above. Unresolvable here - no machine to test on. The origin-by-origin sign algebra in [03](03-coordinates-and-origin.md) is the only evidence available.
- **ADR-180 amendment 2 spindle park** — not hardware-verified.
- **Dimensional accuracy of V-carve, relief, and adaptive paths** — the suite asserts determinism and
  pass structure, never that the carved surface matches the model.

## Cross-reference slot — Phase 2

1. **Lift-before-spindle.** Confirm Easel's post-processor ordering — the code claims parity
   (`cnc-grbl-strategy.ts:117-118`). Verify against Easel's actual output.
2. **Ramp entry.** Do Easel/Carbide ramp by default? At what angle? Ours is opt-in, clamped 45°.
   Default-off may be a real quality gap on hardwood.
3. **Tool change.** How does Easel handle multi-bit jobs — `M0`, `M6`, or program split? Our
   swallow-the-`M0`-to-reach-Idle trick is clever; check whether it is *necessary* or whether they
   found a cleaner route.
4. **Tabs.** Compare tab geometry: ours is height-based with manual anchors (ADR-156). Easel's tabs
   are famously simple — is theirs more reliable?
5. **Depth-per-pass defaults.** Do Easel/Carbide derive stepdown from bit diameter and material? Ours
   comes from the material picker (ADR-111/112) — compare actual numbers for 6 mm ply.
6. **Feeds & speeds.** Compare `feeds-calculator.ts` output against Carbide's published feeds for the
   same bit/material. A systematic offset is a bug we cannot see from inside.
7. **Rest machining / adaptive.** Does Easel offer either? If not these are **our advantages** — but
   they are also the least-verified code in the repo. Weigh accordingly.
8. **Arc output.** Do they emit native `G2`/`G3` or sampled lines? Ours emits arcs with an
   invalid-radius fallback (`cnc-grbl-strategy.ts:340-359`).
