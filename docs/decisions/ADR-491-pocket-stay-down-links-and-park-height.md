## ADR-491 - Pockets step over at depth instead of lifting between rings, and the bit lifts to a park height before parking (2026-09-27)

**Status:** Accepted; software-verified through unit, compile/emit and removal-simulation checks,
hardware qualification pending (an air cut on the 4040). | **Date:** 2026-09-27

This fixes CW-01 and CW-07 of the 2026-09-27 CNC gap audit
(`docs/audits/2026-09-27-cnc-gap-audit.md`), the first half of its motion batch. The Frame-first
Start contract (ADR-228, PROJECT.md non-negotiable 21) is unchanged: nothing here blocks, refuses
or confirms anything.

### Context

**CW-01.** An offset pocket cut one ring, lifted to safe Z, rapided about one stepover and plunged
straight down at the plunge feed for the next ring; raster rows did the same for every row. On main
8e037c2f a 150 x 100 mm pocket, 6 mm deep with a 1/4" end mill, lifted and plunged 57 times (offset)
or 114 times (raster), 10% and 18% of its run time; a 40 x 30 mm pocket with a 1/8" bit spent 30%.
Every plunge went into partly uncut stock. Fusion ("Keep Tool Down"), VCarve ("Optimized
Pocketing for Fewer Retracts"), Carbide Create and Easel step over at depth.

The lift was deliberate: the maintainer built it to take load off the bit and let the spindle
recover between rings. Asked on 2026-09-27, he chose to stay down with a slow step, keeping the
lift as an option.

**CW-07.** The job end and every bit change lifted only to safe Z (3.81 mm by default) before the
rapid to the park position, so a clamp taller than that stood in the way.

### Decision

1. **Stay-down links** (`src/core/cnc/pocket-stay-down-links.ts`). Within one depth level of an
   offset, raster, helical-entry or rest-roughing pocket, a ring or row that starts within one bit
   diameter of where the previous one ended is reached by a two-point `path3d` link at that depth,
   fed at the plunge feed (`lateralFeed: 'plunge'`, `stayDownLink: true`), instead of a lift and
   re-plunge. The plunge feed is the "slow step": the one moment of wider engagement stays light.
   - A closed ring is re-started at its point nearest the bit (keeping its direction); a start
     within 0.01 mm of a vertex snaps onto it, so no sliver segment pushes the ring to a finer
     coordinate format. An open raster row runs as planned, or reversed when only its far end is
     in reach (raster rows already alternate direction).
   - A link is kept only when its tool centre stays at least the wall radius (less the 5 micron the
     offsets themselves round by) from every edge of the pocket's own source contours, islands
     included. Both ends lie on rings inside the pocket, so such a link never cuts a wall, an
     island or stock outside the pocket. Anything else keeps the lift.
   - Pockets with islands or arms plan their rings and rows across all pieces of a level at once,
     so the plan hops between pieces. A waiting pass may be cut earlier to link when every pass
     still waiting ahead of it lies more than one bit diameter away (bounding boxes): the two cuts
     share no stock, so each removes exactly the material it would have under the same load. The
     search looks at most 64 waiting passes ahead. With no linkable pass, the plan's next pass runs
     with its own entry, exactly as before.
   - Levels are never linked to each other: every depth still enters on its own, with the layer's
     plunge, ramp or helix. A linked helical-entry ring becomes a plain ring at depth, and a linked
     ring is marked `stayDownEntry` so ramp entry leaves it alone.
   - A ramped ring followed by a link descends into its start from one ramp length before it, so
     its lap at depth ends where the link leaves from (`rampContourPass(..., endAtStart)`).
   - V-carve clearance and inlay pockets are not linked: their allowed tool-centre region differs
     from the source contours, so this clearance check could not prove a link safe there.
   - Adaptive pockets keep their own linking.
2. **"Lift between rings"** (`CncLayerSettings.pocketLiftBetweenRings`, Entry & travel, offset and
   raster pockets). Off (absent) links; on restores the old lift and re-plunge exactly.
3. **Park height** (`CncMachineParams.parkZMm`, Machine Setup next to the park position; carried on
   `CncGroup.parkZMm` and the CNC sub-profile). The job end and each bit-change hold retract to it
   instead of safe Z before the park move; the spindle stops after the lift. It applies whether or
   not a park position is set. Absent keeps safe Z, and a height at or below safe Z adds nothing
   (the retract every job already makes comes first). It is not given a default: a lift past the
   top of the Z travel stalls the axis, and a Z that lost steps at the top would cut the next job
   deeper, so only the operator can say how much room the machine has.
4. `EMITTER_REVISION` advances to `relief-ramp-plunges-stay-down-park-20260927-v2`.

### Evidence

Compiled with `compileCncJob`, emitted with `cncGrblStrategy`, 1/4" end mill, 6 mm deep at 2 mm
per pass unless noted; time is feed-limited with 3000/1000 mm/min XY/Z rapids.

| Job | Plunges, lift -> stay down | Run time |
|---|---|---|
| 150 x 100 mm pocket, offset | 57 -> 3 | 18.9 -> 17.5 min |
| same, raster | 114 -> 3 | 21.7 -> 18.7 min |
| 80 mm circle | 45 -> 3 | 7.2 -> 6.1 min |
| 40 x 30 mm, 1/8" bit, 2.5 mm per pass | 33 -> 3 | 4.0 -> 3.0 min |
| 100 x 60 mm with a 40 x 30 mm island | 30 -> 12 | 6.3 -> 5.4 min |
| U shape, raster | 135 -> 6 | 11.1 -> 5.6 min |
| 60 x 40 mm, 5 degree ramp | 21 -> 3 | 3.8 -> 3.0 min |
| 60 x 40 mm, helical entry | 21 -> 3 | 5.3 -> 3.2 min |

Removal simulation (`computeRemovalGrid`, 0.25 mm cells) of 14 pockets with and without links
(offset, raster, island offset, round island raster, L, U raster, five-slot comb offset and raster,
star, two adjacent pockets, circle, ramp, helix, rest roughing): no cell differs by more than
0.01 mm in either direction. The links cut nothing the lifts did not.

### Consequences

- Pause, resume and recovery see more, shorter passes; a resume at a linked ring enters it from
  safe Z as every ring did before, and the link passes start on stock already cut.
- The pocket header's `passes:` count includes the links.
- Hardware qualification: an air cut, then a pocket in scrap, on the 4040 before this counts as
  done.
- Not built here: CW-02 (entries from safe Z at the plunge feed) builds on ADR-489's air floor and
  follows separately.
