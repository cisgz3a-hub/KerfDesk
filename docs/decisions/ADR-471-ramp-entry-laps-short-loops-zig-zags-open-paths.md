## ADR-471 - Ramp entry laps short loops, zig-zags open paths, starts from the level above and discloses the plunges it keeps (2026-09-27)

**Status:** Accepted; software-verified through unit, compile/emit and removal-simulation
checks, hardware qualification pending. | **Date:** 2026-09-27

This decides how the Phase H.9 contour ramp (`applyRampEntry`, WORKFLOW F-CNC18) enters paths
shorter than their ramp, and fixes two defects found with it. The Frame-first Start contract
(ADR-228, PROJECT.md non-negotiable 21) is unchanged: the new Job Review finding is an advisory,
never a refusal.

### Context

ADR-273 Amendment 1 (PR #957) left this open: a generic ramp on a path shorter than the ramp
finishes its descent straight down at the path end, under a `max-angle-deg` header.
`appendRampSpan` walked the path once, then dropped vertically; WORKFLOW F-CNC18 described the
result as "the remainder cuts level on the next lap", which the code never did.

Evidence was taken on main 0f516c35b by compiling with `compileCncJob`, emitting with
`cncGrblStrategy`, and replaying the G-code through a flat-end-mill stock simulation (0.02 mm cells,
3.175 mm end mill, 5 degree ramp):

1. **Closed loops shorter than the ramp plunge.** A 6 mm square pocket, 3 mm deep at 1.5 mm per
   pass, had 5 straight descents below the stock top, the deepest 2.011 mm. Four cut uncut
   stock: two full-width 1.4 mm plunges on the 0.285 mm inner ring (it ramped 0.1 mm first), and
   0.51 mm and 1.5 mm plunges with 46% of the cutter on the outer ring. An inside profile of a 6 mm
   hole plunged 0.725 mm full-width at both levels; a 2 mm engraved circle plunged 0.45 mm.
2. **Open paths kept a sloped floor.** Only closed loops re-cut the ramped span. A 1 mm deep
   engraved line, 5 mm or 30 mm long, was 0.14 mm deep at its start; a 3 mm deep on-path line
   was 1.36 mm shallow there. Against the same job without a ramp, the final stock differed in
   39,750 to 136,225 cells by up to 1.5 mm.
3. **Open-path depth ladders plunged into that slope.** Each level after the first ramped "from
   the level above" at a start the level above had left at the stock top: a full-width 1.5 mm
   plunge.
4. **Pocket ladders ramped from the stock top.** The start rule (`pass.zMm >= previousZ ? 0 :
   previousZ`) fits profiles, which deepen one contour at a time. Pockets cut every ring of a
   level before the next, so every ring after a level's first ramped from Z0: in a 20 mm square
   pocket, 102 of 295 mm of ramping descended through stock the level above had removed, and
   wrapping would multiply it.

The rest of the codebase already wraps short loops: the tabbed-ring ramp in the same function
(`tabbed-ramp-entry.ts`), ADR-278's lap planner (`vcarve-entry.ts`) and ADR-424's relief roughing
ramp. A small hole's untabbed passes therefore plunged while its tabbed passes lapped. ADR-424
also ramps from the level above and plunges a loop shorter than one cut width.

The pocket helix (ADR-152) was weighed as the fallback and rejected: it serves offset pockets
only (no profiles, engraves or open paths), one island-free pocket per layer, with its own
diameters. At its default 2 mm minimum it cannot enter the 6 mm pocket's inner ring (the largest
circle that fits is 1.56 mm), and it retracts and relocates for every ring. It stays the
operator's choice for pockets.

### Decision

`applyRampEntry` (`motion-polish.ts`) chooses where each pass starts; `rampContourPass`
(`contour-ramp-entry.ts`) shapes the entry.

1. **Closed loops lap.** A loop is descended round from its start until the ramp reaches depth,
   lapping as often as the angle needs, then cut one whole lap at depth from that point. A loop
   at least as long as its ramp gives the same G-code as before.
2. **Open paths zig-zag.** An open path cannot be lapped, so it descends forward and back along its
   start an even number of legs, landing on the start at depth, then is cut end to end at depth.
   The legs share the ramp length equally, so each descends at the full angle. This applies to
   every ramped open path, not only short ones, because the old forward ramp left the slope of
   item 2 on all of them.
3. **Each pass ramps from the level above its own path.** The start depth is the level the same
   path (matched by its coordinates, since each depth pass clones the ring) was last cut to, or
   the stock top the first time. Profiles and pockets both cut each path's levels shallow to deep,
   so the stock above that level is gone along the path. Tabbed paths keep their existing rule.
4. **A path too short to ramp along keeps its plunge, disclosed.** When the ramp would have to go
   over a path again (a loop shorter than its ramp, an open path shorter than half of it) and the
   path is shorter than one cut width (`cncLayoutCutWidths(...).wallDiameterMm`; the rougher's
   diameter for rest roughing), the pass stays a contour pass marked `entryPlunge`. The cutter's
   footprint covers such a path wherever it stands, so laps would only slow the plunge. This is
   ADR-424's rule for relief loops. The G-code header adds
   `; cnc entry-advisory: N passes plunge: path shorter than one cut width`, and preflight reports
   the advisory `cnc-ramp-entry-plunge` to Job Review and Save, naming Helical entry for pockets.
   Tiling retains this marker on every clipped contour fragment, including a contour wholly
   inside one tile. Each tile's header counts its marked fragments, rather than reusing the
   original whole-job count. Clipping does not assign the marker to previously unmarked paths.
5. **No new refusal.** An impossible lap count throws a `RangeError` at the ECMAScript Array
   length limit, as the tabbed ramp does; nothing smaller is refused.
6. After integration with independent stage recipes, narrowed cutter widths and scan timing,
   `EMITTER_REVISION` advances to `adaptive-relief-ramp-laps-cut-width-scan-timing-20260927-v1`.
   The finishing-stage wrapper retains each pass's cutting recipe around the ramp transform,
   and the minimum retraced path uses the same full-depth cutter width as its wall layout.
   The tiled-provenance repair subsequently advances the integrated revision to
   `trace-arcs-relief-width-ramp-tiles-contact-air-scan-v2-20260927-v8`, retaining the prior
   trace, native arc, relief, cutter-width, contact, air-repeat and scan provenance. Only
   the previously omitted plunge disclosure changes; emitted machine commands are unchanged.

The maintainer chose items 2 and 4 over the alternatives on 2026-09-27: lapping loops shorter
than one cut width too (ADR-278's rule: no plunge left, but the 0.285 mm ring would take 15 laps
per level with the whole cutter bottom engaged), and zig-zagging only open paths shorter than their
ramp (longer ones would keep the slope and the plunge into it).

### Consequences

Same probe, before and after:

| Case (5 degrees, 3.175 mm end mill) | Plunges into stock | Floor short of target |
|---|---|---|
| 6 mm pocket, 3 mm at 1.5 mm | 4 (4.81 mm) to 2 (3.0 mm, disclosed) | - |
| 20 mm pocket, 3 mm at 1.5 mm | 5 (4.11 mm) to 0; ramp in cleared stock 102 mm to 0 | - |
| 6 mm hole, inside profile | 2 (1.45 mm) to 0 | - |
| 2 mm circle, 1 mm engrave | 1 (0.45 mm) to 0 | - |
| 5 mm and 30 mm lines, 1 mm engrave | 1 and 0 to 0 | 0.86 mm to 0 |
| 5 mm and 30 mm on-path lines, 3 mm at 1.5 mm | 3 and 1 to 0 | 1.36 mm to 0 |

- Final stock is unchanged by the entry: against the same job without a ramp, 0 cells differ for
  the pockets, the hole, the engraves and the on-path lines. Profiles are not comparable that way,
  because without a ramp they get ADR-250 leads.
- Byte-identical: jobs without a ramp, and closed loops at least as long as their ramp (a 3 mm
  circle outside profile and a 20 mm square inside profile were compared).
- Open paths travel one more ramp length per level (17.1 mm at 5 degrees and 1.5 mm per pass).
  Level starts after the first now descend straight through cleared stock to the level above at
  the plunge feed, as relief roughing does (ADR-424).
- A pocket whose innermost ring is shorter than the cutter still plunges into it on every level.
  The header and Job Review now say so; Helical entry is the way to enter it without a plunge.

Not changed, recorded for follow-up:

- The contour ramp is not emission-accurate: rounding to 0.001 mm can steepen short segments past
  the header's angle (5.43 degrees under a 5 degree header on a 64-segment 2.8 mm circle; 5.33
  before this change). ADR-278 budgets Z in coordinate quanta to prevent this.
- Contour ramps ride the cutting feed, so above `asin(plunge / feed)` (17.5 degrees at the
  1000/300 mm/min defaults) their Z rate exceeds the plunge rate. ADR-424's relief ramps use
  `z-rate-capped`.
- Relief roughing (ADR-424) plunges loops shorter than one cut width under the same header without
  the `entryPlunge` marker, and tiled contour ramps keep `max-angle-deg` although a clipped piece
  can start mid-ramp.
- A pocket with the adaptive strategy (whose card shows Ramp entry), an inlay pair, or a drill layer
  carrying a ramp angle records `; cnc entry: contour-ramp; max-angle-deg: N` although none of them
  applies the ramp: reproduced on 0f516c35b, where an adaptive 30 mm pocket plunged 3 times under
  that line.

### Verification

- `contour-ramp-entry.test.ts`: a loop lapped at the angle, then one whole lap at depth; an open
  path zig-zagged back to its start, then cut end to end; the plunge kept and marked under one cut
  width, while a path the ramp fits along once still ramps; a pocket ladder ramped from the level
  above; the reported 6 mm pocket through the compiler, the emitter (no ramp finishes straight
  down, the advisory line) and preflight (an advisory, not a compile-integrity code). All seven
  fail against the previous compiler.
- `motion-polish.test.ts`, `tabbed-ramp-entry.test.ts` and `cnc-tab-ramp.test.ts` pass unchanged.
- `contour-ramp-stage-integration.test.ts` compiles short inside profiles with independent
  finishing recipes through both lapping and disclosed-plunge paths. It checks separate depth
  ladders, emitted feed/plunge/spindle values, a complete lap at depth and the narrowed V-bit
  wall geometry and ramp threshold after integration with ADR-457 and ADR-368 Amendment 3.
- `tile-ramp-provenance.test.ts` runs the actual ramp planner, tiler and emitter for a sub-width
  contour contained in one tile and split across two tiles. Each file discloses its marked
  plunges at the configured feed, while every non-comment command matches the same tile with
  its markers removed. An unmarked contour stays unmarked even when split. Both disclosure
  cases fail against the previous tiler.
- NOT verified: air cuts, material cuts, or any hardware. There is no machine for this project.
