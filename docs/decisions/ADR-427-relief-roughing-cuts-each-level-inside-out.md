## ADR-427 - Relief roughing cuts each level from the inside out, in the requested direction (2026-09-27)

**Status:** Accepted; software-verified through compile and removal-simulation tests, hardware
qualification pending. | **Date:** 2026-09-27 | **Amends:** ADR-289 Amendment 1 (where a level's
cleanup paths run) and the 2026-08-31 relief direction remediation (KD-REL, which oriented each
ring alone).

Applies ADR-251 (climb keeps the stock on the right of travel with an M3 spindle) and ADR-252
(holes wind opposite their outer boundary) to relief roughing. The Frame-first Start contract
(ADR-228, PROJECT.md non-negotiable 21) is unchanged: nothing here adds a guard, a refusal or a
warning.

### Context

Relief roughing (ADR-098 H.5, ADR-289) slices a relief into Z levels and fills each level's
region with concentric rings a stepover apart. Since the 2026-08-31 remediation it honours the
layer's cut direction by passing each ring alone through `enforceCutDirection` with the pocket
rule, and a layer without a direction resolves to the default, Climb.

The pocket rule assumes the pocket planner's order: innermost ring first (`pocket-paths.ts`), so
the stock each ring newly removes lies outside it, and counter-clockwise puts it on the right.
Relief roughing cut each level outside in: ring 0 on the region boundary first, then inward.
Every ring after the first met its new stock on its inner side, so under Climb it cut
conventional. Oriented one at a time, island rings never got ADR-252's mirror.

The removal simulator the 3D preview uses measured it. Each compiled pass was stamped alone with
`computeRemovalGrid` and compared with everything cut before it, and the newly removed volume
was split by side of travel (0.1 mm cells, 3.175 mm end mill at 40%, 1.5 mm levels):

- On the pinned snapshot relief the 1.27 mm ring (`X10 Y398.73 → X1.27 → …`, counter-clockwise)
  removed 41 mm³ of new stock, none of it on the right.
- On a 30 mm field around a 10 mm plateau, the rings around the field put 94–100% of their new
  stock on the left, while the rings around the plateau put 98–100% on the right: climb only
  because each was oriented alone. Ring 0 around the plateau put the plateau's wall on the
  conventional side.
- Conventional was the exact mirror, and a front-right (mirrored) machine frame measured the
  same as front-left.

The fix also needs one fact about windings. Marching squares winds ring 0's outer boundary
positive (+400 mm² on the snapshot relief's first level); the offset engine winds the deeper
rings' outer boundaries negative (−305 mm²). Windings can be compared only within one engine
result, so no single orientation call over a level could tell its islands apart.

Three fixes were prototyped and measured with the same instrument, the rings ending where they
start as ADR-289 Amendment 1 makes them. "One-sided" rings remove less than 20% of their new
stock on their other side; the rest are slots.

| Relief, 3.175 mm at 40% | One-sided rings on the requested side: before / A2 / B | Stock cut in full-width slots: A2 / B | All stock on the requested side: before / A2 / B |
| --- | --- | --- | --- |
| 20 mm flat field | 0% (14 of 14 wrong) / 100% / 99% | 47% / 0% | 25% / 78% / 99% |
| 30 mm field around a plateau | 40% (6 of 12 wrong) / 100% / 100% | 54% / 25% | 47% / 73% / 90% |
| Snapshot pyramid, no allowance | 14% (6 of 7 wrong) / 100% / 94% | 80% / 52% | 46% / 61% / 76% |
| 40 × 30 mm hills and a ridge | 23% (12 of 18 wrong) / 99% / 91% | 72% / 5% | 44% / 65% / 90% |

- **A1**, outside in with the outer rings reversed and the island rings kept (ring 0 included),
  fails wherever a level is thinner than the bit. Ring 0 then cuts only the wall's stock, and A1
  puts it on the wrong side: 9% on the requested side with a 6.35 mm end mill at 60%.
- **A2**, outside in with ring 0 on the pocket rule (wall on the climb side) and every later ring
  reversed, puts every one-sided ring on the requested side. But ring 0 slots a full cutter width
  around every region at every level.
- **B**, inside out like the pocket planner with its winding and mirrored islands, puts no
  one-sided ring on the wrong side and moves the slot to the short innermost rings. Ring 0
  becomes the level's last pass, one stepover deep along the wall, with the wall on the climb
  side.

Above a 50% stepover every ring also cuts a sliver on its other side, in either order. With a
6.35 mm end mill at 60%, B put 67–82% of all stock on the requested side, A2 49–71% and the
previous planner 48–60%. Fusion's 3D Offset Roughing reference describes the same order for
constant-Z offset roughing: it "clears each one in stages; from the middle to the edge". The
maintainer chose B on 2026-09-27.

### Decision

1. **Each level is cut from the inside out.** The ADR-289 Amendment 1 cleanup paths come first,
   deepest round first, as the pocket planner cuts its leftover cores first. Then the rings run
   from the innermost to ring 0, the level's boundary. Levels stay depth-major.
2. **One winding convention for every ring.** Before emitting them, the ladder turns each
   engine result, a ring or a cleanup piece, so its outer boundaries wind positive and its holes
   negative (`withOuterContoursPositive`).
3. **One orientation call per relief, with the pocket rule.** The compiler orients every pass of
   a relief in a single `enforceCutDirection` call, so ADR-252's hole mirror reaches the islands.
   Under Climb, outer rings run counter-clockwise and island rings clockwise in the operator's
   view from above. Conventional mirrors both, and a mirrored machine frame is handled by
   `machineFrameHandedness` as for every other cut.
4. **No direction on the layer still means Climb.** A relief's raw windings are a per-ring mix of
   two engines' conventions, not a direction worth keeping. A relief layer normally uses the
   default cut type, whose card shows no direction select.
5. **Geometry is unchanged.** Rings, points, closing moves and start points (the middle of each
   ring's longest segment) are unchanged except where equal-length segments tie. Only the order
   and the direction change. Every ring still retracts and plunges straight down at its start:
   relief roughing has no ramp entry. The one plunge into full stock per region and level moves
   from ring 0, beside the wall, to the innermost ring or a cleanup path mid-region.
6. **Emitter revision** advances to `relief-rings-inside-out-climb-20260927-v1`.

### Consequences

- Every relief roughing job's G-code changes: the order within each level, and the winding of
  island rings. Outer rings keep running counter-clockwise under Climb, but now before the
  boundary. The pinned snapshot keeps its 8 passes: on the first level the 1.27 mm ring and its
  island ring now come before ring 0, and both island rings run clockwise.
- Full-width slotting moves from every level's boundary to its innermost rings and the cleanup
  paths, which now cut into full stock. The boundary ring finishes the terrace wall at one
  stepover's engagement with the wall on the climb side.
- Planning time and path length are unchanged. Rapid travel between rings may change slightly.
- Not changed: a ramp angle on the layer is not applied to relief rings, which plunge. Their
  G-code header still says `; cnc entry: contour-ramp` when one is set, a separate provenance
  defect.
- Not changed: the Cut direction select still appears only on profile and pocket layers, so a
  relief on the default cut type always cuts Climb.
- No hardware run was made and no coupon was cut. A physical cut on the 4040 remains the
  qualification step.

### Verification

- `compile-cnc-relief-cut-direction.test.ts` compiles a 24 mm field around an 8 mm plateau and
  stamps each relief pass in order with the removal simulator at 0.1 mm cells. It covers Climb,
  Conventional and no direction on a front-left machine, and Climb and Conventional on a
  front-right (mirrored) machine:
  - every one-sided ring keeps more than 80% of its new stock on the requested side (measured
    95–100%);
  - rings of both windings are one-sided, so the island mirror is exercised;
  - more than 80% of all removed stock lies on the requested side (measured 89%);
  - a layer with no direction compiles exactly as Climb;
  - each level ends with its boundary ring, which cuts only the wall's stock, on the right under
    Climb.

  Against the previous planner, 6 of these 7 fail: a ring at Z-1.5 keeps 0% of its new stock on
  the requested side, and the boundary ring comes first. The seventh (no direction compiles as
  Climb) held before this change too.
- `relief-roughing.test.ts`: on the pyramid's first level the ladder emits ring 1 before ring 0,
  outer boundaries positive and island rings negative. The previous planner fails it.
- `relief-core-cleanup.test.ts`: the centre ring at 85% winds positive (the offset engine gave
  −0.000009 mm²), and every traced hole lies inside a positive outer boundary. The previous
  planner fails the first part.
- ADR-289 Amendment 1's coverage test still leaves no stock at the seams or the centre.
- The relief roughing G-code snapshot changes only in pass order and island winding.

### References

- Autodesk Fusion, 3D Offset Roughing reference (constant-Z layers cleared from the middle to
  the edge along offset passes; Climb or Conventional maintained relative to the boundaries):
  https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/GUID63F97CC8-99FE-40B7-AFF1-061E826955B3.htm


### Integration with ADR-424 and ADR-450 (2026-09-27)

ADR-424 independently implemented the same inside-out stock-side direction through
`reliefRoughingMotion`, using explicit outline/island stock-side metadata. Keep that
planner, its nearest ready piece scheduling, checked links, slice-top ramps and
ADR-450 flat finishing with bounded depth slices. It supersedes decisions 3 and 5's
single orientation call and one plunging pass per ring; the geometry and physical
cut-side intent remain. This integration retains decision 1's deepest cleanup before
regular rings and decision 2's normalized raw ladder winding. Cleanup's stock-side
metadata now describes the reversed inside-out traversal too.

The removal regression decomposes linked contour passes into their exact closed loops
and cutting links. Every link is stamped in sequence into the prior-stock grid, and
an edge-by-edge assertion proves the decomposition omits no source motion. All seven
stock-side cases already passed on ADR-424 before changing cleanup order. The added
cleanup-first test distinguishes the remaining integration change. Existing ramp,
allowance, link-region and flat-depth tests continue to cover the preserved planner.

Emitter revision is `adaptive-rings-relief-cleanup-first-linked-20260927-v1`, retaining
adaptive closure and relief flat depth-slice provenance. The earlier limitations
about missing roughing ramps/direction controls are historical; ADR-424 supplies them.
Frame policy and hardware qualification are unchanged.
