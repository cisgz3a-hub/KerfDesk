## ADR-368 - Tapered ball-nose carving bits are a modeled cutter kind (2026-09-24)

**Status:** Accepted; software-verified through unit, compile and emitted G-code tests, hardware
qualification pending. | **Date:** 2026-09-24

Amends ADR-275 items 1, 4, 6 and 8 for one new geometry, and supersedes its consequence that kept
tapered-ball cutters reference-only. Uses ADR-287's tip-diameter field and its read-boundary
contract. Leaves the Frame-first Start contract (ADR-228) unchanged: nothing here adds a Start
guard or turns a warning into a block.

### Context

A tapered ball nose (TBN) is the usual finishing cutter for 3D relief carving on hobby routers: a
small ball tip on a slender taper cuts fine detail, and the taper keeps the tool stiff. The catalog
listed "Tapered ball-nose cutters" as reference-only because no kernel stored the geometry, so an
operator could only approximate one:

- As a ball nose of the tip size, which ignores the taper. On a steep or deep feature the real
  flank reaches the wall before the modeled ball does, so the planned finishing path gouges.
- As a ball nose of the top diameter, which plans the wrong ball and far too coarse a stepover.
- As a V-bit of the taper, which ignores the ball. The virtual cone apex lies `R(1/sin α − 1)`
  below the real tip, so every depth is wrong.

Sellers list a TBN by its tip (as a radius or a diameter), its taper **per side**, its fluted
cutting length and its shank. Amana's titles say "5.4 Deg Tapered Angle"; SpeTool's tables say
"Single Side Degree". The geometry agrees. Read per side, seven of the eight listings checked reach
their 1/4" or 1/8" shank 1% to 7% beyond their listed cutting length. Read as included angles, the
same seven would need about twice that length. Amana 46284's 1° taper stays under its shank either
way. "Cutting diameter" in these listings usually means the tip.

### Decision

1. **A new geometry kind, `tapered-ball-nose`.** It is geometry, not a marketing family, so it
   joins `CncTool.kind` under ADR-275 item 1. Its fields mean:
   - `diameterMm`: the cut diameter at the top of the flutes, the widest cutting diameter. It is
     not the tip.
   - `tipDiameterMm`: the ball diameter, twice the listed tip radius. Required, above 0 and below
     `diameterMm`.
   - `tipAngleDeg`: the included angle of the flank, from 1 through 179 degrees, twice the listed
     per-side angle. This amends ADR-275 item 6: the stored angle describes a flank tangent to a
     ball, not a point cone.
2. **One law.** With `R` the ball radius and `α` the per-side angle, the ball meets the flank at
   radius `R·cos α` and height `R·(1 − sin α)`. Inside that radius the cutting surface is the
   sphere `R − √(R² − r²)`; beyond it the flank rises `1/tan α` per millimetre. Height and slope
   match at the tangent point, so the profile is smooth and nondecreasing. `src/core/cnc-tapered-ball.ts`
   owns the law. Simulator kernels, relief roughing dilation, finishing max-plus, removal stamping
   and the 3D bit preview all read it. Missing or invalid tip or angle data plans and simulates as
   a flat cylinder of the full diameter. That is the widest envelope, so dilation can never go
   deeper than the real cutter would, and it matches ADR-287's treatment of an invalid tip flat.
3. **Relief finishing uses the tip ball.**
   - Row spacing is `2·√(c·(2R − c))` with `R` the tip radius, and the scallop request clamps to
     that radius. The flank is the tangent to the sphere's profile, so it lies below the sphere's
     continuation and the planar cusp can only be lower than requested.
   - The finishing grid resolves the ball as it would a ball nose of the tip diameter:
     `min(row spacing, tip diameter / 10)`.
   - Planning evidence and Job Review's scallop warning name the tip radius. The compiled group,
     its provenance and the emitted `; cnc tool:` comment record the tip diameter.
4. **Other operations keep their existing contracts.**
   - A TBN is not a V-carve cutter. The existing advisory compatibility warning names it, and V-carve
     planning keeps the wrong-kind 60° fallback instead of reading a few-degree taper as a cone.
   - Flat-bottom stages that require an end mill still refuse it at the existing compile-integrity
     boundary.
   - Profile, pocket and engrave treat it like any other non-flat cutter, with `diameterMm` as the
     offset diameter.
5. **Entry takes the seller's numbers.** The custom-bit form asks for the cut diameter at the top of
   the flutes, the taper per side (0.5 through 89.5 degrees, stored doubled) and the required ball
   tip diameter. Once valid, it states where the modeled taper reaches that diameter so the
   operator can compare it with the listed cutting length. Rows and labels show the tip and the
   per-side angle. The material recipe still reads the diameter band. Its advisory says the recipe
   ignores the ball tip that does most of the cutting.
6. **Eight exact-product catalog rows.** Amana 46280, 46282, 46286 and 46284 and SpeTool W01001,
   W01004, W01006 and W01010 copy their listed tip, per-side taper, cutting length and shank. The
   stored cut diameter is where a tangent taper of that angle ends at the listed cutting length,
   rounded to 0.01 mm and never above the shank. No flute count is copied: the recipe reads the
   widest diameter, and a listed four-flute count would double an already coarse automatic feed. The
   generic reference-only tapered-ball entry is removed. Tip-radius engraving cutters stay
   reference-only until a product's radius is confirmed tangent to its flanks.
7. **The 3D preview models the cutting length.** The profile samples the ball uniformly in angle up
   to the tangent point, then the end of the flank. For a TBN the preview states where the taper
   reaches the cut diameter, instead of disclaiming cutting length as ADR-275 item 8 does for other
   cutters. An incomplete TBN shows the readable fallback instead of the flat approximation.
8. **Persistence.** Project files and the app library keep the kind and a finite `tipDiameterMm`.
   An explicit malformed tip stays visible as invalid rather than becoming a supported shape.
   An older build reads the unknown kind in a project file as an end mill, a conservative flat
   envelope whose name still says what it is. An older build's app library drops the tool.
9. **Picture.** The bit picture is rendered from this law with Amana 46282's geometry
   (`docs/tutorials/bit-renders/bit-tapered-ball-nose.html`) rather than generated. Its three
   upcut flutes, shank length and lighting are illustrative.
10. **Emitter revision** advances to `tapered-ball-nose-20260924-v1`. Output for existing cutter
    kinds is unchanged.

### Consequences

- A relief can be finished with a TBN whose flank is modeled. The planned tip stays out of
  features narrower than the taper at that depth, where a ball-only stand-in would gouge the walls.
- Finishing with a small tip uses a fine grid under a kernel as wide as the top diameter, so it
  costs more compute than a ball nose of the tip size.
- Catalog rows are nominal listing geometry. Tip and taper tolerances, runout, flute count and
  coating are not modeled, and the cutting length is derived rather than measured.
- The recipe's diameter band overstates the cutting width of a small tip. The advisory says so;
  no feed is changed or gated.
- Opening the app library in an older build loses saved tapered ball noses from that library, as
  it would any kind the older build does not know.

### Verification

- Unit tests pin the law: tangent continuity, monotonic rise, the flank below the sphere, and the
  inverse used by the catalog. The kernels, stamping and preview profile follow the same law.
- Relief tests show the tip-ball row spacing. On a 2 mm, 10 mm-deep slot, a TBN finishing path
  stops where the flank meets the rim, while a ball of the tip size reaches the floor.
- Compile tests cover the finishing group, planning evidence and the emitted tool comment,
  including the flat fallback without a tip.
- Persistence, form, label, preview, catalog and warning tests cover entry, round trips and
  disclosure.
- No hardware run was made. A physical cut on the 4040 remains the qualification step.
