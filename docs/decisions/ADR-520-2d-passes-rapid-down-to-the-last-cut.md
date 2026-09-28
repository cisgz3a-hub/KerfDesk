## ADR-520 - 2D passes rapid down to just above the cut their earlier passes left (2026-09-28)

**Status:** Accepted; software-verified through unit and stock-simulation tests, hardware
qualification pending (an air cut on the 4040). | **Date:** 2026-09-28

This fixes CW-02 of the 2026-09-27 CNC gap audit (`docs/audits/2026-09-27-cnc-gap-audit.md`),
the rest of its motion batch after ADR-491. It gives 2D operations the air floors ADR-489 defined
for relief roughing; the emitter and the post-emit plunged-travel check are unchanged. The
Frame-first Start contract (ADR-228, PROJECT.md non-negotiable 21) is unchanged: nothing here
blocks, refuses or confirms anything.

### Context

Every depth pass of a profile, engrave or pocket that did not start where the bit already was fed
all the way down from safe Z at the plunge feed. A sheet of 12 parts, 40 x 40 mm, outside profile
through 12 mm at 3 mm per pass with a 1/8" end mill, plunged 108 times, 23% of its 14.9 min, and
most of each plunge was through the slot the pass above had cut. Fusion's Feed height and VCarve's
plunge gap rapid down to just above the cut first.

With profile leads on (the default), every pass starts at its lead-in, away from where the last
pass's lead-out ended, so the bit lifts between passes whether or not "Retract between passes" is
on: turning it off gave byte-identical G-code, with nothing saying why.

### Decision

1. **Air floors on 2D passes** (`src/core/cnc/cnc-pass-air-floors.ts`, applied by
   `cncGroupForPasses`, the one builder of 2D CNC groups). A contour, path3d or arc pass whose
   every segment lies on the path of an earlier pass of its group (within 1e-6 mm, so a ring
   started elsewhere on the same path still counts) gets `airFloorZMm` = that earlier pass's
   highest Z; with several such passes, the lowest. ADR-489's descent then rapids Z-only from safe
   Z to the floor plus 1 mm and feeds the rest.
   - The proof is ADR-489's. A group cuts with one bit; where its tip passed an XY at height z, no
     stock stands above the bit's own shape there, so the same bit at that XY with its tip at z or
     higher touches nothing. Tabs and ramps only raise the earlier pass's highest Z, so they need
     no special case, and a lead is either on both paths or the pass gets no floor.
   - The proof holds on the path, not over a region: a cusp a high stepover leaves between two
     rings is off both paths, so it never stands under a floor. This is where it differs from
     relief roughing's slice-top floors, which a cusp between offset rings can stand above.
   - Arcs and helices count as the circles G2/G3 follows, not the chords of their samples; a
     straight move is never floored by an arc, except a Z-only one at a point of it.
   - A Z-only pass (a drill peck) is floored only where its XY lies on the earlier path.
   - No floor: the first pass along any path, helical entries (they keep their own plunge from
     safe Z), stay-down links and linked rings (reached at depth, ADR-491), and passes that
     already carry one (relief roughing).
   - Recovery jobs still drop every floor and plunge from safe Z (ADR-489); tiled passes are
     rebuilt without them.
2. **"Retract between passes" says what leads do.** On an outside or inside profile with leads,
   the row notes that every pass starts at its lead, so the bit lifts between passes either way,
   and that Profile leads None steps straight down. The checkbox is unchanged. Staying down with
   leads was not built: the straight move from one pass's lead-out to the next lead-in crosses
   waste the leads never cut, so it would slot a full-depth groove at the plunge feed.

### Evidence

Compiled with `compileCncJob`, emitted with `cncGrblStrategy`, time with 3000/1000 mm/min XY/Z
rapids:

| Job | Before | After |
|---|---|---|
| 12 parts, outside profile through 12 mm, 1/8" bit | 14.9 min | 13.8 min |
| same, "Retract between passes" off | 14.9 min | 13.8 min |
| 150 x 100 mm pocket, 6 mm, "Lift between rings" on | 18.9 min | 18.4 min |
| same pocket, stay-down links (ADR-491) | 17.5 min | 17.4 min |

Stock simulation (`cnc-pass-air-floors.stock.test.ts`): every pass of each group cut in order into
a height grid at a tenth of the bit diameter; before each floored pass, no cell within the bit's
reach of its path stands above the bit held at the floor. Fifteen jobs: the 12-part sheet with
tabs and arc leads, a profile with retract off, a ramped inside profile of a circle, an on-path
profile with a finish allowance, an engraved open line, offset pockets with and without lifts, a
raster U, a pocket with an island, ramped, helical-entry and round pockets, drilled holes, and an
island pocket and a raster U at 90% stepover. Pockets above 50% stepover add paths that clear the
cusps between rings, so a further case builds bare rectangle rings at 70% and 95% stepover by
hand: cusps stand above the first depth, every later ring is floored, and nothing stands under a
floor; the same move given a floor by region, across the corner cusps, meets over 1 mm of stock.
Unit tests (`cnc-pass-air-floors.test.ts`) cover re-started rings, leads, longer paths, tabs,
several covering passes, Z-only passes, arcs within and beyond an earlier sweep, chords of an
earlier arc, a ring after a helix and the passes left alone.

### Consequences

- Each depth pass after the first rapids down to 1 mm above the cut before its plunge. A Z axis
  that lost more than 1 mm of steps since the pass above would meet that cut at rapid speed, as it
  already could in relief roughing (ADR-489). Pause and lift, recovery and tiling are unchanged.
- `EMITTER_REVISION` advances to `air-floor-2d-passes-stay-down-park-20260928-v6`.
- Hardware qualification: an air cut, then a profile in scrap, on the 4040.
- Not built here: separate retract and clearance heights per operation (CNG-J04), and floors for
  helical entries.
